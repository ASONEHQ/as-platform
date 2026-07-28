import { createHash, randomUUID } from 'node:crypto';

import { normalizeCatalogCode } from '@asone/database';

import type {
  InventoryBalanceReadRepository,
  InventoryLocationRepository,
  InventoryMovementReadRepository,
} from './inventory.repository.js';
import type {
  InventoryLocation,
  InventoryMutationContext,
  InventoryPage,
  LocationStatus,
  LocationType,
} from './inventory.types.js';
import { InventoryApplicationError } from './inventory.types.js';

export interface LocationCreate {
  id?: string;
  branchId: string;
  code: string;
  name: string;
  description?: string | null;
  locationType: LocationType;
  status?: LocationStatus;
  allowsReceiving?: boolean;
  allowsIssuing?: boolean;
  isDefault?: boolean;
}
export interface LocationPatch {
  name?: string;
  description?: string | null;
  status?: LocationStatus;
  allowsReceiving?: boolean;
  allowsIssuing?: boolean;
  isDefault?: boolean;
}

function hash(value: Readonly<Record<string, unknown>>): string {
  return createHash('sha256')
    .update(JSON.stringify(Object.fromEntries(Object.entries(value).sort())))
    .digest('hex');
}
function text(value: string, field: string): string {
  const clean = value.trim();
  if (clean.length === 0)
    throw new InventoryApplicationError('resource_conflict', `${field} cannot be blank.`);
  return clean;
}
function description(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const clean = value.trim();
  return clean.length === 0 ? null : clean;
}
function assertConsistent(
  locationType: LocationType,
  status: LocationStatus,
  isDefault: boolean,
  receiving: boolean,
  issuing: boolean,
): void {
  if (status !== 'active' && (isDefault || receiving || issuing))
    throw new InventoryApplicationError(
      'inventory_location_inactive',
      'Inactive and retired locations cannot be default or permit inventory directions.',
    );
  if (locationType === 'virtual' && (receiving || issuing))
    throw new InventoryApplicationError(
      'inventory_location_inactive',
      'Virtual locations cannot receive or issue physical inventory.',
    );
}

export class InventoryLocationService {
  public constructor(private readonly repository: InventoryLocationRepository) {}

  public list(
    companyId: string,
    branchIds: readonly string[],
    input: Parameters<InventoryLocationRepository['list']>[2],
  ): Promise<InventoryPage<InventoryLocation>> {
    return this.repository.list(companyId, branchIds, input);
  }

  public create(
    context: InventoryMutationContext,
    key: string,
    input: LocationCreate,
  ): Promise<{ value: InventoryLocation; replayed: boolean }> {
    const status = input.status ?? 'active';
    const normalized = {
      id: input.id ?? null,
      branchId: input.branchId,
      code: text(input.code, 'code'),
      normalizedCode: normalizeCatalogCode(input.code),
      name: text(input.name, 'name'),
      description: description(input.description),
      locationType: input.locationType,
      status,
      allowsReceiving: input.allowsReceiving ?? true,
      allowsIssuing: input.allowsIssuing ?? true,
      isDefault: input.isDefault ?? false,
    };
    assertConsistent(
      normalized.locationType,
      normalized.status,
      normalized.isDefault,
      normalized.allowsReceiving,
      normalized.allowsIssuing,
    );
    return this.repository.transaction(async (client) => {
      if (!(await this.repository.branchExists(client, context.companyId, input.branchId)))
        throw new InventoryApplicationError('branch_not_found', 'The branch was not found.');
      return this.repository.idempotentCreate(client, context, key, hash(normalized), async () => {
        const value = await this.repository.insert(client, {
          ...context,
          ...normalized,
          id: input.id ?? randomUUID(),
        });
        await this.repository.auditAndPublish(client, context, value, 'inventory_location.created');
        return value;
      });
    });
  }

  public patch(
    context: InventoryMutationContext,
    permittedBranchIds: readonly string[],
    id: string,
    expectedVersion: bigint,
    patch: LocationPatch,
  ): Promise<InventoryLocation> {
    return this.repository.transaction(async (client) => {
      const current = await this.repository.lock(client, context.companyId, id);
      if (current === null)
        throw new InventoryApplicationError(
          'inventory_location_not_found',
          'The inventory location was not found.',
        );
      if (!permittedBranchIds.includes(current.branchId))
        throw new InventoryApplicationError(
          'inventory_location_not_found',
          'The inventory location was not found.',
        );
      if (current.version !== expectedVersion)
        throw new InventoryApplicationError('version_conflict', 'The location version changed.');
      const status = patch.status ?? current.status;
      const isDefault = patch.isDefault ?? (status === 'active' && current.isDefault);
      const allowsReceiving =
        patch.allowsReceiving ?? (status === 'active' && current.allowsReceiving);
      const allowsIssuing = patch.allowsIssuing ?? (status === 'active' && current.allowsIssuing);
      assertConsistent(current.locationType, status, isDefault, allowsReceiving, allowsIssuing);
      if (
        status !== 'active' &&
        (await this.repository.hasRetirementDependencies(client, context.companyId, id))
      )
        throw new InventoryApplicationError(
          'resource_conflict',
          'The location has unresolved inventory operations.',
        );
      const value = await this.repository.update(client, {
        ...context,
        id,
        expectedVersion,
        name: patch.name === undefined ? current.name : text(patch.name, 'name'),
        description:
          patch.description === undefined ? current.description : description(patch.description),
        status,
        allowsReceiving,
        allowsIssuing,
        isDefault,
      });
      await this.repository.auditAndPublish(client, context, value, 'inventory_location.updated');
      return value;
    });
  }
}

export class InventoryBalanceReadService {
  public constructor(private readonly repository: InventoryBalanceReadRepository) {}
  public async list(
    companyId: string,
    branchIds: readonly string[],
    includeCost: boolean,
    input: Parameters<InventoryBalanceReadRepository['list']>[2],
  ): Promise<InventoryPage<Readonly<Record<string, unknown>>>> {
    const page = await this.repository.list(companyId, branchIds, input);
    if (includeCost) return page;
    return {
      ...page,
      items: page.items.map(
        ({ average_unit_cost: _cost, currency_code: _currency, ...item }) => item,
      ),
    };
  }
}

export class InventoryMovementReadService {
  public constructor(private readonly repository: InventoryMovementReadRepository) {}
  public list(
    companyId: string,
    branchIds: readonly string[],
    input: Parameters<InventoryMovementReadRepository['list']>[2],
  ): Promise<InventoryPage<Readonly<Record<string, unknown>>>> {
    return this.repository.list(companyId, branchIds, input);
  }
}
