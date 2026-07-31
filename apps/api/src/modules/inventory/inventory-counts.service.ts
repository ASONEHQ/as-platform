import { createHash } from 'node:crypto';

import { createUuidV7 } from '@asone/database';

import type { LockedBalance } from './inventory-posting.repository.js';
import {
  formatInventoryDecimal,
  inventoryBalanceKey,
  inventoryDecimalNonnegative,
  sortInventoryBalanceKeys,
} from './inventory-posting.service.js';
import type { InventoryCountRepository } from './inventory-counts.repository.js';
import type {
  InventoryCount,
  InventoryCountScopeType,
  InventoryCountStatus,
} from './inventory-counts.types.js';
import { InventoryCountError } from './inventory-counts.types.js';
import type { InventoryMutationContext, InventoryPage } from './inventory.types.js';

export interface CountCreateInput {
  branchId: string;
  locationId: string;
  scope: { type: InventoryCountScopeType; productVariantIds?: readonly string[] };
  reasonCode: string;
  note?: string | null;
  metadata?: Readonly<Record<string, unknown>> | null;
}
export interface CountListInput {
  limit: number;
  cursor?: string;
  branchId?: string;
  locationId?: string;
  status?: InventoryCountStatus;
  createdFrom?: Date;
  createdTo?: Date;
}
export interface CountLineInput {
  countedQuantity: string;
  unitOfMeasureCode: string;
  metadata?: Readonly<Record<string, unknown>> | null;
}
export interface CountCancelInput {
  reasonCode: string;
  note?: string | null;
}

const MAX = 9_999_999_999_999_999_999_999_999n;
function hash(value: object): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function bounded(value: string | null | undefined, max: number, required = false): string | null {
  if (value === undefined || value === null) {
    if (required) throw new InventoryCountError('validation_error', 'A required value is missing.');
    return null;
  }
  const normalized = value.trim();
  if ((required && normalized.length === 0) || normalized.length > max)
    throw new InventoryCountError('validation_error', 'Text is invalid.');
  return normalized.length === 0 ? null : normalized;
}
function requiredText(value: string | null | undefined, max: number): string {
  const normalized = bounded(value, max, true);
  if (normalized === null)
    throw new InventoryCountError('validation_error', 'A required value is missing.');
  return normalized;
}
function exact(value: string): bigint {
  try {
    return inventoryDecimalNonnegative(value);
  } catch {
    throw new InventoryCountError('validation_error', 'The quantity is invalid.');
  }
}
function number(id: string): string {
  return `CNT-${id.replaceAll('-', '')}`;
}
function movementNumber(id: string): string {
  return `IMV-${id.replaceAll('-', '')}`;
}
function difference(line: InventoryCount['lines'][number]): bigint {
  return line.countedQuantity === null
    ? 0n
    : exact(line.countedQuantity) - exact(line.expectedQuantity);
}
function summary(value: InventoryCount): Readonly<Record<string, unknown>> {
  let positive = 0n,
    negative = 0n,
    changed = 0,
    uncounted = 0;
  for (const line of value.lines) {
    if (line.countedQuantity === null) {
      uncounted++;
      continue;
    }
    const delta = difference(line);
    if (delta > 0n) {
      positive += delta;
      changed++;
    } else if (delta < 0n) {
      negative -= delta;
      changed++;
    }
  }
  return {
    line_count: value.lines.length,
    uncounted_line_count: uncounted,
    discrepancy_line_count: changed,
    positive_difference_quantity: formatInventoryDecimal(positive),
    negative_difference_quantity: formatInventoryDecimal(negative),
  };
}
export function inventoryCountJson(
  value: InventoryCount,
  includeLines = true,
): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    count_number: value.countNumber,
    branch_id: value.branchId,
    location_id: value.locationId,
    status: value.status,
    scope: { type: value.scopeType, ...value.scopeDefinition },
    reason_code: value.reasonCode,
    note: value.note,
    version: Number(value.version),
    baseline_at: value.baselineAt?.toISOString() ?? null,
    lock_acquired_at: value.lockAcquiredAt?.toISOString() ?? null,
    lock_expires_at: value.lockExpiresAt?.toISOString() ?? null,
    started_at: value.startedAt?.toISOString() ?? null,
    started_by: value.startedBy,
    submitted_at: value.submittedAt?.toISOString() ?? null,
    submitted_by: value.submittedBy,
    approved_at: value.approvedAt?.toISOString() ?? null,
    approved_by: value.approvedBy,
    applied_at: value.appliedAt?.toISOString() ?? null,
    applied_by: value.appliedBy,
    cancelled_at: value.cancelledAt?.toISOString() ?? null,
    cancelled_by: value.cancelledBy,
    application_movement_id: value.applicationMovementId,
    created_at: value.createdAt.toISOString(),
    updated_at: value.updatedAt.toISOString(),
    summary: summary(value),
    ...(includeLines
      ? {
          lines: value.lines.map((line) => ({
            id: line.id,
            product_variant_id: line.productVariantId,
            unit_of_measure_code: line.unitOfMeasureCode,
            expected_quantity: line.expectedQuantity,
            counted_quantity: line.countedQuantity,
            difference_quantity:
              line.countedQuantity === null ? null : formatInventoryDecimal(difference(line)),
            first_counted_at: line.firstCountedAt?.toISOString() ?? null,
            last_counted_at: line.lastCountedAt?.toISOString() ?? null,
            counted_by: line.countedBy,
            version: Number(line.version),
          })),
        }
      : {}),
  };
}

export class InventoryCountService {
  public constructor(private readonly repository: InventoryCountRepository) {}
  public async list(
    companyId: string,
    branches: readonly string[],
    input: CountListInput,
  ): Promise<InventoryPage<Readonly<Record<string, unknown>>>> {
    if (input.branchId !== undefined && !branches.includes(input.branchId))
      return { items: [], nextCursor: null };
    const page = await this.repository.list(companyId, branches, input);
    return {
      items: page.items.map((value) => inventoryCountJson(value, false)),
      nextCursor: page.nextCursor,
    };
  }
  public async get(
    companyId: string,
    branches: readonly string[],
    id: string,
  ): Promise<InventoryCount> {
    const value = await this.repository.find(companyId, branches, id);
    if (value === null)
      throw new InventoryCountError('resource_not_found', 'The inventory count was not found.');
    return value;
  }
  public create(
    context: InventoryMutationContext,
    branches: readonly string[],
    key: string,
    input: CountCreateInput,
  ): Promise<{ value: Readonly<Record<string, unknown>>; replayed: boolean }> {
    const reasonCode = requiredText(input.reasonCode, 64);
    const note = bounded(input.note, 2000);
    if (!branches.includes(input.branchId))
      throw new InventoryCountError('resource_not_found', 'The count scope was not found.');
    const ids = input.scope.productVariantIds ?? [];
    if (
      input.scope.type === 'explicit_variants' &&
      (ids.length === 0 || new Set(ids).size !== ids.length)
    )
      throw new InventoryCountError(
        'validation_error',
        'Explicit scope variants must be nonempty and unique.',
      );
    if (input.scope.type === 'all_balanced_variants' && ids.length > 0)
      throw new InventoryCountError('validation_error', 'The scope is invalid.');
    const requestHash = hash({ input: { ...input, reasonCode, note } });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'inventory_count.create',
        key,
        requestHash,
        async () => {
          if (
            !(await this.repository.location(
              client,
              context.companyId,
              input.branchId,
              input.locationId,
            ))
          )
            throw new InventoryCountError(
              'resource_not_found',
              'The count location was not found.',
            );
          if (input.scope.type === 'explicit_variants') {
            const variants = await this.repository.variants(client, context.companyId, ids);
            if (variants.length !== ids.length)
              throw new InventoryCountError('resource_not_found', 'A count variant was not found.');
          }
          const id = createUuidV7();
          const created = await this.repository.insert(client, context, {
            id,
            branchId: input.branchId,
            locationId: input.locationId,
            number: number(id),
            scopeType: input.scope.type,
            scopeDefinition:
              input.scope.type === 'explicit_variants'
                ? { product_variant_ids: [...ids].sort() }
                : {},
            reasonCode,
            note,
            metadata: input.metadata ?? null,
          });
          await this.repository.audit(client, context, created, 'inventory_count.created', {
            previous_status: null,
            new_status: 'draft',
          });
          await this.event(client, context, created, 'inventory.count.created', {
            status: 'draft',
            scope_type: created.scopeType,
          });
          return { status: 201, value: inventoryCountJson(created) };
        },
      ),
    );
  }
  public start(
    context: InventoryMutationContext,
    branches: readonly string[],
    id: string,
    version: bigint,
    key: string,
  ): Promise<{ value: Readonly<Record<string, unknown>>; replayed: boolean }> {
    return this.command(
      context,
      branches,
      id,
      version,
      key,
      'inventory_count.start',
      'draft',
      async (client, current) => {
        if (
          !(await this.repository.location(
            client,
            context.companyId,
            current.branchId,
            current.locationId,
          ))
        )
          throw new InventoryCountError('resource_not_found', 'The count location was not found.');
        try {
          const updated = await this.repository.transition(client, context, current, 'counting');
          await this.repository.materialize(client, context, updated);
          const value = await this.required(client, context.companyId, branches, id);
          await this.repository.audit(client, context, value, 'inventory_count.started', {
            previous_status: 'draft',
            new_status: 'counting',
            line_count: value.lines.length,
          });
          await this.event(client, context, value, 'inventory.count.started', {
            status: 'counting',
            baseline_at: value.baselineAt?.toISOString(),
            line_count: value.lines.length,
            lock_expires_at: value.lockExpiresAt?.toISOString(),
          });
          return value;
        } catch (error) {
          if (this.constraint(error, 'inventory_counts_active_location_uq'))
            throw new InventoryCountError(
              'inventory_count_in_progress',
              'Another count protects this location.',
            );
          throw error;
        }
      },
    );
  }
  public async recordLine(
    context: InventoryMutationContext,
    branches: readonly string[],
    id: string,
    variantId: string,
    version: bigint,
    input: CountLineInput,
  ): Promise<Readonly<Record<string, unknown>>> {
    const amount = exact(input.countedQuantity);
    return this.repository.transaction(async (client) => {
      const current = await this.required(client, context.companyId, branches, id);
      this.version(current, version);
      this.state(current, 'counting', 'count_not_editable');
      this.lock(current, context.timestamp);
      const line = current.lines.find((value) => value.productVariantId === variantId);
      if (line === undefined)
        throw new InventoryCountError('resource_not_found', 'The count line was not found.');
      if (line.unitOfMeasureCode !== input.unitOfMeasureCode)
        throw new InventoryCountError(
          'validation_error',
          'The unit of measure does not match the snapshot.',
        );
      const variant = (await this.repository.variants(client, context.companyId, [variantId]))[0];
      const decimals = input.countedQuantity.split('.')[1]?.length ?? 0;
      if (variant?.unit !== input.unitOfMeasureCode || decimals > variant.quantityScale)
        throw new InventoryCountError(
          'validation_error',
          'The quantity is incompatible with the variant.',
        );
      const updated = await this.repository.recordLine(
        client,
        context,
        current,
        variantId,
        formatInventoryDecimal(amount),
        input.unitOfMeasureCode,
        input.metadata ?? null,
      );
      await this.repository.audit(client, context, updated, 'inventory_count.line_recorded', {
        product_variant_id: variantId,
        counted_quantity: formatInventoryDecimal(amount),
      });
      return inventoryCountJson(updated);
    });
  }
  public submit(
    context: InventoryMutationContext,
    branches: readonly string[],
    id: string,
    version: bigint,
    key: string,
  ): Promise<{ value: Readonly<Record<string, unknown>>; replayed: boolean }> {
    return this.command(
      context,
      branches,
      id,
      version,
      key,
      'inventory_count.submit',
      'counting',
      async (client, current) => {
        this.lock(current, context.timestamp);
        if (await this.repository.incomplete(client, context.companyId, id))
          throw new InventoryCountError(
            'count_has_incomplete_lines',
            'Every count line must be recorded.',
          );
        const updated = await this.repository.transition(client, context, current, 'submitted');
        await this.repository.audit(client, context, updated, 'inventory_count.submitted', {
          previous_status: 'counting',
          new_status: 'submitted',
          summary: summary(updated),
        });
        await this.event(client, context, updated, 'inventory.count.submitted', {
          status: 'submitted',
          summary: summary(updated),
        });
        return updated;
      },
    );
  }
  public approve(
    context: InventoryMutationContext,
    branches: readonly string[],
    id: string,
    version: bigint,
    key: string,
  ): Promise<{ value: Readonly<Record<string, unknown>>; replayed: boolean }> {
    return this.command(
      context,
      branches,
      id,
      version,
      key,
      'inventory_count.approve',
      'submitted',
      async (client, current) => {
        this.lock(current, context.timestamp);
        await this.noDrift(client, current);
        const updated = await this.repository.transition(client, context, current, 'approved');
        await this.repository.audit(client, context, updated, 'inventory_count.approved', {
          previous_status: 'submitted',
          new_status: 'approved',
          summary: summary(updated),
        });
        await this.event(client, context, updated, 'inventory.count.approved', {
          status: 'approved',
          summary: summary(updated),
        });
        return updated;
      },
    );
  }
  public apply(
    context: InventoryMutationContext,
    branches: readonly string[],
    id: string,
    version: bigint,
    key: string,
  ): Promise<{ value: Readonly<Record<string, unknown>>; replayed: boolean }> {
    return this.command(
      context,
      branches,
      id,
      version,
      key,
      'inventory_count.apply',
      'approved',
      async (client, current) => {
        this.lock(current, context.timestamp);
        await this.noDrift(client, current);
        const deltas = current.lines
          .map((line) => ({ line, delta: difference(line) }))
          .filter((value) => value.delta !== 0n);
        const movementId = deltas.length === 0 ? null : createUuidV7();
        const keys = sortInventoryBalanceKeys(
          deltas.map(({ line }) => ({
            companyId: context.companyId,
            branchId: current.branchId,
            locationId: current.locationId,
            variantId: line.productVariantId,
          })),
        );
        const existing = await this.repository.lockBalances(client, keys);
        const existingKeys = new Set(existing.map(inventoryBalanceKey));
        const inbound = keys.filter(
          (value) =>
            !existingKeys.has(inventoryBalanceKey(value)) &&
            (deltas.find((d) => d.line.productVariantId === value.variantId)?.delta ?? 0n) > 0n,
        );
        if (movementId !== null) {
          const movementLines = deltas.map(({ line, delta }) => ({
            variantId: line.productVariantId,
            quantity: formatInventoryDecimal(delta < 0n ? -delta : delta),
            unit: line.unitOfMeasureCode,
            delta,
          }));
          await this.repository.insertMovement(
            client,
            context,
            current,
            movementId,
            movementNumber(movementId),
            movementLines,
          );
        }
        if (movementId !== null)
          await this.repository.createInboundBalances(
            client,
            inbound,
            movementId,
            context.timestamp,
          );
        const balances = await this.repository.lockBalances(client, keys);
        const byKey = new Map(balances.map((value) => [inventoryBalanceKey(value), value]));
        const changes: {
          balance: LockedBalance;
          previous: bigint;
          next: bigint;
          delta: bigint;
          version: bigint;
        }[] = [];
        if (movementId !== null) {
          for (const { line, delta } of deltas) {
            const balance = byKey.get(
              inventoryBalanceKey({
                companyId: context.companyId,
                branchId: current.branchId,
                locationId: current.locationId,
                variantId: line.productVariantId,
              }),
            );
            if (balance === undefined)
              throw new InventoryCountError(
                'inventory_reconciliation_required',
                'The inventory snapshot changed.',
              );
            const previous = inventoryDecimalNonnegative(balance.quantityOnHand);
            const reserved = inventoryDecimalNonnegative(balance.quantityReserved);
            const next = previous + delta;
            if (next < 0n || next < reserved)
              throw new InventoryCountError(
                'insufficient_inventory',
                'Available inventory is insufficient.',
              );
            if (next > MAX)
              throw new InventoryCountError('numeric_overflow', 'The result exceeds range.');
            const nextVersion = await this.repository.updateBalance(client, {
              ...balance,
              newQuantity: formatInventoryDecimal(next),
              movementId,
              timestamp: context.timestamp,
            });
            changes.push({ balance, previous, next, delta, version: nextVersion });
          }
        }
        const updated = await this.repository.transition(client, context, current, 'applied', {
          movementId,
        });
        await this.repository.audit(client, context, updated, 'inventory_count.applied', {
          previous_status: 'approved',
          new_status: 'applied',
          movement_id: movementId,
          summary: summary(updated),
        });
        await this.event(client, context, updated, 'inventory.count.completed', {
          status: 'applied',
          movement_id: movementId,
          summary: summary(updated),
        });
        if (movementId !== null) {
          await this.repository.outbox(client, context, {
            eventType: 'inventory.movement.created',
            aggregateType: 'inventory_movement',
            aggregateId: movementId,
            aggregateVersion: 1n,
            branchId: updated.branchId,
            payload: {
              company_id: context.companyId,
              branch_id: updated.branchId,
              movement_id: movementId,
              movement_number: movementNumber(movementId),
              movement_type: 'adjustment',
              status: 'posted',
              reference_type: 'inventory_count',
              reference_id: updated.id,
              correlation_id: context.correlationId,
            },
          });
          for (const change of changes)
            await this.repository.outbox(client, context, {
              eventType: 'inventory.stock.changed',
              aggregateType: 'inventory_balance',
              aggregateId: change.balance.id,
              aggregateVersion: change.version,
              branchId: updated.branchId,
              payload: {
                company_id: context.companyId,
                branch_id: updated.branchId,
                balance_id: change.balance.id,
                inventory_location_id: change.balance.locationId,
                product_variant_id: change.balance.variantId,
                previous_quantity_on_hand: formatInventoryDecimal(change.previous),
                delta_quantity_on_hand: formatInventoryDecimal(change.delta),
                new_quantity_on_hand: formatInventoryDecimal(change.next),
                quantity_reserved: change.balance.quantityReserved,
                available_quantity: formatInventoryDecimal(
                  change.next - inventoryDecimalNonnegative(change.balance.quantityReserved),
                ),
                movement_id: movementId,
                correlation_id: context.correlationId,
              },
            });
        }
        return updated;
      },
    );
  }
  public cancel(
    context: InventoryMutationContext,
    branches: readonly string[],
    id: string,
    version: bigint,
    key: string,
    input: CountCancelInput,
  ): Promise<{ value: Readonly<Record<string, unknown>>; replayed: boolean }> {
    const reason = requiredText(input.reasonCode, 64);
    const note = bounded(input.note, 2000);
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'inventory_count.cancel',
        key,
        hash({ id, version: version.toString(), reason, note }),
        async () => {
          const current = await this.required(client, context.companyId, branches, id);
          this.version(current, version);
          if (!['draft', 'counting', 'submitted'].includes(current.status))
            throw new InventoryCountError(
              current.status === 'applied' ? 'count_already_applied' : 'count_not_editable',
              'The count cannot be cancelled.',
            );
          const updated = await this.repository.transition(client, context, current, 'cancelled', {
            reasonCode: reason,
            note,
          });
          await this.repository.audit(client, context, updated, 'inventory_count.cancelled', {
            previous_status: current.status,
            new_status: 'cancelled',
            reason_code: reason,
            note,
          });
          await this.event(client, context, updated, 'inventory.count.cancelled', {
            status: 'cancelled',
            reason_code: reason,
          });
          return { status: 200, value: inventoryCountJson(updated) };
        },
      ),
    );
  }
  private command(
    context: InventoryMutationContext,
    branches: readonly string[],
    id: string,
    version: bigint,
    key: string,
    operation: string,
    expected: InventoryCountStatus,
    execute: (
      client: Parameters<Parameters<InventoryCountRepository['transaction']>[0]>[0],
      current: InventoryCount,
    ) => Promise<InventoryCount>,
  ): Promise<{ value: Readonly<Record<string, unknown>>; replayed: boolean }> {
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        operation,
        key,
        hash({ id, version: version.toString() }),
        async () => {
          const current = await this.required(client, context.companyId, branches, id);
          this.version(current, version);
          this.state(
            current,
            expected,
            expected === 'submitted'
              ? 'count_not_approvable'
              : expected === 'approved'
                ? 'count_not_applicable'
                : 'count_not_editable',
          );
          const updated = await execute(client, current);
          return { status: 200, value: inventoryCountJson(updated) };
        },
      ),
    );
  }
  private async required(
    client: Parameters<Parameters<InventoryCountRepository['transaction']>[0]>[0],
    companyId: string,
    branches: readonly string[],
    id: string,
  ): Promise<InventoryCount> {
    const value = await this.repository.lock(client, companyId, branches, id);
    if (value === null)
      throw new InventoryCountError('resource_not_found', 'The inventory count was not found.');
    return value;
  }
  private version(value: InventoryCount, expected: bigint): void {
    if (value.version !== expected)
      throw new InventoryCountError('version_conflict', 'The inventory count version changed.');
  }
  private state(
    value: InventoryCount,
    expected: InventoryCountStatus,
    code: 'count_not_editable' | 'count_not_approvable' | 'count_not_applicable',
  ): void {
    if (value.status !== expected)
      throw new InventoryCountError(
        value.status === 'applied' ? 'count_already_applied' : code,
        'The inventory count state is invalid.',
      );
  }
  private lock(value: InventoryCount, at: Date): void {
    if (value.lockExpiresAt === null || value.lockExpiresAt.getTime() <= at.getTime())
      throw new InventoryCountError('count_lock_expired', 'The inventory count lock expired.');
  }
  private async noDrift(
    client: Parameters<Parameters<InventoryCountRepository['transaction']>[0]>[0],
    value: InventoryCount,
  ): Promise<void> {
    const current = await this.repository.currentBalances(client, value);
    const byVariant = new Map(current.map((row) => [row.variantId, row]));
    for (const line of value.lines) {
      const row = byVariant.get(line.productVariantId);
      const expectedExists = line.metadata?.baseline_balance_exists !== false;
      if (
        row?.exists !== expectedExists ||
        row.version !== line.baselineBalanceVersion ||
        row.lastMovementId !== line.baselineLastMovementId ||
        exact(row.quantity) !== exact(line.expectedQuantity)
      )
        throw new InventoryCountError(
          'inventory_reconciliation_required',
          'The inventory snapshot changed.',
        );
    }
  }
  private event(
    client: Parameters<Parameters<InventoryCountRepository['transaction']>[0]>[0],
    context: InventoryMutationContext,
    value: InventoryCount,
    eventType: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    return this.repository.outbox(client, context, {
      eventType,
      aggregateType: 'inventory_count',
      aggregateId: value.id,
      aggregateVersion: value.version,
      branchId: value.branchId,
      payload: {
        company_id: context.companyId,
        branch_id: value.branchId,
        count_id: value.id,
        count_number: value.countNumber,
        inventory_location_id: value.locationId,
        version: Number(value.version),
        correlation_id: context.correlationId,
        ...payload,
      },
    });
  }
  private constraint(error: unknown, name: string): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'constraint' in error &&
      (error as { constraint?: unknown }).constraint === name
    );
  }
}
