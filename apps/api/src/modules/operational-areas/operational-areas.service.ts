import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';

import type { OperationalAreasRepository } from './operational-areas.repository.js';
import { OperationalAreaError, type OperationalAreaMutationContext, type OperationalAreaRow } from './operational-areas.types.js';

function nonBlank(value: string, field: string): string {
  const clean = value.trim();
  if (clean.length === 0) throw new OperationalAreaError('validation_error', `${field} cannot be blank.`);
  if (clean.length > 200) throw new OperationalAreaError('validation_error', `${field} is too long.`);
  return clean;
}
function hash(value: object): string {
  return createHash('sha256')
    .update(JSON.stringify(Object.fromEntries(Object.entries(value).sort())))
    .digest('hex');
}
function decodeArea(raw: unknown): OperationalAreaRow {
  const value = raw as Omit<OperationalAreaRow, 'version' | 'createdAt' | 'updatedAt'> & {
    version: string;
    createdAt: string;
    updatedAt: string;
  };
  return { ...value, version: BigInt(value.version), createdAt: new Date(value.createdAt), updatedAt: new Date(value.updatedAt) };
}

/** TASK 16.15 — CRUD for `operational_areas`: a generic, tenant-configured
 * grouping of registers within one branch. See
 * `packages/database/src/schema/operational-areas.ts`'s own doc comment
 * for the full rationale (never conflated with `product_categories.
 * operational_group`). Never hardcodes a tenant's own area names anywhere
 * — every string here is operator-entered `code`/`name`. */
export class OperationalAreasService {
  public constructor(private readonly repository: OperationalAreasRepository) {}

  public async create(
    context: OperationalAreaMutationContext,
    branchIds: readonly string[],
    key: string,
    input: { id?: string; branchId: string; code: string; name: string },
  ): Promise<{ value: OperationalAreaRow; replayed: boolean }> {
    if (!branchIds.includes(input.branchId))
      throw new OperationalAreaError('validation_error', 'The branch is not authorized for this actor.');
    const code = nonBlank(input.code, 'code');
    const name = nonBlank(input.name, 'name');
    const id = input.id ?? randomUUID();
    const requestHash = hash({ branchId: input.branchId, code, name, id: input.id ?? null });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'operational_area.create',
        key,
        requestHash,
        'operational_area',
        decodeArea,
        async () => {
          const created = await this.repository.insert(client, {
            id,
            companyId: context.companyId,
            branchId: input.branchId,
            code,
            name,
            actorId: context.actorId,
            timestamp: context.timestamp,
          });
          await this.repository.auditAndPublish(client, context, {
            action: 'operational_area.created',
            resourceType: 'operational_area',
            resourceId: created.id,
            eventType: 'operational_area.created',
            branchId: created.branchId,
            version: created.version,
            payload: { area_id: created.id, branch_id: created.branchId, code: created.code, name: created.name },
          });
          return created;
        },
      ),
    );
  }

  public async area(companyId: string, branchIds: readonly string[], id: string): Promise<OperationalAreaRow> {
    const value = await this.repository.area(companyId, id);
    if (value === null || !branchIds.includes(value.branchId))
      throw new OperationalAreaError('resource_not_found', 'The operational area was not found.');
    return value;
  }

  public list(
    companyId: string,
    branchIds: readonly string[],
    input: Parameters<OperationalAreasRepository['list']>[2],
  ): ReturnType<OperationalAreasRepository['list']> {
    return this.repository.list(companyId, branchIds, input);
  }

  public async update(
    context: OperationalAreaMutationContext,
    branchIds: readonly string[],
    id: string,
    expectedVersion: bigint,
    input: { name?: string; status?: 'active' | 'inactive' },
  ): Promise<OperationalAreaRow> {
    return this.repository.transaction(async (client) => {
      const current = await this.repository.lock(client, context.companyId, id);
      if (current === null || !branchIds.includes(current.branchId))
        throw new OperationalAreaError('resource_not_found', 'The operational area was not found.');
      const name = input.name === undefined ? undefined : nonBlank(input.name, 'name');
      const updated = await this.repository.update(client, context.companyId, id, expectedVersion, {
        ...(name === undefined ? {} : { name }),
        ...(input.status === undefined ? {} : { status: input.status }),
        updatedBy: context.actorId,
        timestamp: context.timestamp,
      });
      await this.repository.auditAndPublish(client, context, {
        action: 'operational_area.updated',
        resourceType: 'operational_area',
        resourceId: updated.id,
        eventType: 'operational_area.updated',
        branchId: updated.branchId,
        version: updated.version,
        payload: { area_id: updated.id, name: updated.name, status: updated.status, version: updated.version.toString() },
      });
      return updated;
    });
  }
}
