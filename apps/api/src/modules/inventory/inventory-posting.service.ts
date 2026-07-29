import { createHash } from 'node:crypto';

import type {
  BalanceKey,
  InventoryPostingRepository,
  LockedBalance,
} from './inventory-posting.repository.js';
import type { DraftMovement, DraftMovementLine } from './inventory-drafts.types.js';
import { InventoryDraftError } from './inventory-drafts.types.js';
import type { InventoryMutationContext } from './inventory.types.js';

const SCALE = 1_000_000n;
const MAX = 9_999_999_999_999n * SCALE + 999_999n;
function decimal(value: string): bigint {
  const match = /^(\d{1,19})(?:\.(\d{1,6}))?$/u.exec(value);
  if (match?.[1] === undefined)
    throw new InventoryDraftError('invalid_movement_line', 'A movement quantity is invalid.');
  const result = BigInt(match[1]) * SCALE + BigInt((match[2] ?? '').padEnd(6, '0'));
  if (result <= 0n)
    throw new InventoryDraftError('invalid_movement_line', 'A quantity is invalid.');
  if (result > MAX) throw new InventoryDraftError('numeric_overflow', 'A quantity exceeds range.');
  return result;
}
function format(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  return `${sign}${String(absolute / SCALE)}.${String(absolute % SCALE).padStart(6, '0')}`;
}
function hash(value: object): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function state(movement: DraftMovement, expected: 'draft' | 'pending'): void {
  if (movement.status === expected) return;
  if (movement.status === 'posted')
    throw new InventoryDraftError('movement_already_posted', 'The movement is posted.');
  if (movement.status === 'cancelled')
    throw new InventoryDraftError('movement_already_cancelled', 'The movement is cancelled.');
  if (movement.status === 'reversed')
    throw new InventoryDraftError('movement_already_reversed', 'The movement is reversed.');
  throw new InventoryDraftError('invalid_movement_state', 'The movement state is invalid.');
}
function version(movement: DraftMovement, expected: bigint): void {
  if (movement.version !== expected)
    throw new InventoryDraftError('version_conflict', 'The movement version changed.');
}
function key(value: BalanceKey): string {
  return `${value.companyId}:${value.branchId}:${value.locationId}:${value.variantId}`;
}
function sorted(values: readonly BalanceKey[]): BalanceKey[] {
  return [...values].sort((a, b) => key(a).localeCompare(key(b)));
}

export class InventoryPostingService {
  public constructor(private readonly repository: InventoryPostingRepository) {}

  public submit(
    context: InventoryMutationContext,
    branches: readonly string[],
    movementId: string,
    expectedVersion: bigint,
    idempotencyKey: string,
  ): Promise<{ value: Readonly<Record<string, unknown>>; replayed: boolean }> {
    const requestHash = hash({ movementId, expectedVersion: expectedVersion.toString() });
    return this.repository.transaction((client) =>
      this.repository.drafts.idempotent(
        client,
        context,
        'inventory_movement.submit',
        idempotencyKey,
        requestHash,
        200,
        async () => {
          const movement = await this.required(client, context.companyId, branches, movementId);
          state(movement, 'draft');
          version(movement, expectedVersion);
          const lines = await this.validLines(client, context.companyId, movement);
          if (lines.length === 0)
            throw new InventoryDraftError('movement_has_no_lines', 'The movement has no lines.');
          const updated = await this.repository.transition(client, context, movement, 'pending');
          await this.repository.drafts.audit(client, context, {
            action: 'inventory_movement.submitted',
            movement: updated,
            metadata: {
              movement_number: updated.movementNumber,
              previous_status: 'draft',
              status: 'pending',
            },
          });
          return this.response(updated);
        },
      ),
    );
  }

  public post(
    context: InventoryMutationContext,
    branches: readonly string[],
    movementId: string,
    expectedVersion: bigint,
    idempotencyKey: string,
  ): Promise<{ value: Readonly<Record<string, unknown>>; replayed: boolean }> {
    const requestHash = hash({ movementId, expectedVersion: expectedVersion.toString() });
    return this.repository.transaction((client) =>
      this.repository.drafts.idempotent(
        client,
        context,
        'inventory_movement.post',
        idempotencyKey,
        requestHash,
        200,
        async () => {
          const movement = await this.required(client, context.companyId, branches, movementId);
          state(movement, 'pending');
          version(movement, expectedVersion);
          const lines = await this.validLines(client, context.companyId, movement);
          if (lines.length === 0)
            throw new InventoryDraftError('movement_has_no_lines', 'The movement has no lines.');
          const deltas = this.aggregate(movement, lines);
          const keys = sorted([...deltas.values()].map(({ balanceKey }) => balanceKey));
          const existing = await this.repository.lockBalances(client, keys);
          const existingKeys = new Set(existing.map((value) => key(value)));
          const inbound = keys.filter(
            (value) => !existingKeys.has(key(value)) && (deltas.get(key(value))?.delta ?? 0n) > 0n,
          );
          await this.repository.createInboundBalances(
            client,
            inbound,
            movement.id,
            context.timestamp,
          );
          const balances = await this.repository.lockBalances(client, keys);
          const byKey = new Map(balances.map((value) => [key(value), value]));
          const changes: {
            balance: LockedBalance;
            delta: bigint;
            previous: bigint;
            next: bigint;
            version: bigint;
          }[] = [];
          for (const balanceKey of keys) {
            const delta = deltas.get(key(balanceKey))?.delta ?? 0n;
            const balance = byKey.get(key(balanceKey));
            if (balance === undefined)
              throw new InventoryDraftError(
                'inventory_balance_not_found',
                'The inventory balance was not found.',
              );
            const previous = decimalNonnegative(balance.quantityOnHand);
            const reserved = decimalNonnegative(balance.quantityReserved);
            const next = previous + delta;
            if (next < 0n || next < reserved)
              throw new InventoryDraftError(
                'insufficient_inventory',
                'Available inventory is insufficient.',
              );
            if (next > MAX)
              throw new InventoryDraftError('numeric_overflow', 'The result exceeds range.');
            const newVersion = await this.repository.updateBalance(client, {
              ...balance,
              newQuantity: format(next),
              movementId: movement.id,
              timestamp: context.timestamp,
            });
            changes.push({ balance, delta, previous, next, version: newVersion });
          }
          const updated = await this.repository.transition(client, context, movement, 'posted');
          const evidence = changes.map(({ balance, delta }) => ({
            inventory_location_id: balance.locationId,
            product_variant_id: balance.variantId,
            delta_quantity_on_hand: format(delta),
          }));
          await this.repository.drafts.audit(client, context, {
            action: 'inventory_movement.posted',
            movement: updated,
            metadata: {
              movement_number: updated.movementNumber,
              previous_status: 'pending',
              status: 'posted',
              affected_balances: evidence,
            },
          });
          await this.repository.outbox(client, context, {
            eventType: 'inventory.movement.created',
            aggregateType: 'inventory_movement',
            aggregateId: updated.id,
            aggregateVersion: updated.version,
            branchId: updated.branchId,
            payload: {
              company_id: context.companyId,
              branch_id: updated.branchId,
              movement_id: updated.id,
              movement_number: updated.movementNumber,
              movement_type: updated.movementType,
              status: 'posted',
              posted_at: updated.postedAt?.toISOString(),
              actor_id: context.actorId,
              correlation_id: context.correlationId,
              line_count: lines.length,
            },
          });
          for (const change of changes) {
            const reserved = decimalNonnegative(change.balance.quantityReserved);
            await this.repository.outbox(client, context, {
              eventType: 'inventory.stock.changed',
              aggregateType: 'inventory_balance',
              aggregateId: change.balance.id,
              aggregateVersion: change.version,
              branchId: change.balance.branchId,
              payload: {
                company_id: context.companyId,
                branch_id: change.balance.branchId,
                balance_id: change.balance.id,
                inventory_location_id: change.balance.locationId,
                product_variant_id: change.balance.variantId,
                previous_quantity_on_hand: format(change.previous),
                delta_quantity_on_hand: format(change.delta),
                new_quantity_on_hand: format(change.next),
                quantity_reserved: format(reserved),
                available_quantity: format(change.next - reserved),
                movement_id: updated.id,
                movement_number: updated.movementNumber,
                occurred_at: context.timestamp.toISOString(),
                correlation_id: context.correlationId,
              },
            });
          }
          return {
            ...this.response(updated),
            posted_at: updated.postedAt?.toISOString(),
            affected_balance_count: changes.length,
          };
        },
      ),
    );
  }

  private async required(
    client: Parameters<Parameters<InventoryPostingRepository['transaction']>[0]>[0],
    companyId: string,
    branches: readonly string[],
    id: string,
  ): Promise<DraftMovement> {
    const movement = await this.repository.drafts.lock(client, companyId, branches, id);
    if (movement === null)
      throw new InventoryDraftError('inventory_movement_not_found', 'The movement was not found.');
    if (!['opening_balance', 'adjustment'].includes(movement.movementType))
      throw new InventoryDraftError('invalid_movement_type', 'The movement type is invalid.');
    return movement;
  }

  private async validLines(
    client: Parameters<Parameters<InventoryPostingRepository['transaction']>[0]>[0],
    companyId: string,
    movement: DraftMovement,
  ): Promise<readonly DraftMovementLine[]> {
    const lines = await this.repository.lines(client, companyId, movement.id);
    for (const line of lines) {
      decimal(line.quantity);
      decimal(line.baseQuantity);
      const valid = await this.repository.validateLineReferences(
        client,
        companyId,
        movement.branchId,
        line,
      );
      const direction =
        movement.movementType === 'opening_balance'
          ? line.sourceLocationId === null && line.destinationLocationId !== null
          : (line.sourceLocationId === null) !== (line.destinationLocationId === null);
      if (!valid || !direction || line.sourceLocationId === line.destinationLocationId)
        throw new InventoryDraftError('invalid_movement_line', 'A movement line is invalid.');
    }
    return lines;
  }

  private aggregate(
    movement: DraftMovement,
    lines: readonly DraftMovementLine[],
  ): Map<string, { balanceKey: BalanceKey; delta: bigint }> {
    const values = new Map<string, { balanceKey: BalanceKey; delta: bigint }>();
    for (const line of lines) {
      const locationId = line.sourceLocationId ?? line.destinationLocationId;
      if (locationId === null)
        throw new InventoryDraftError('invalid_movement_direction', 'Direction is invalid.');
      const balanceKey = {
        companyId: movement.companyId,
        branchId: movement.branchId,
        locationId,
        variantId: line.productVariantId,
      };
      const amount = decimal(line.baseQuantity);
      const delta = line.sourceLocationId === null ? amount : -amount;
      const current = values.get(key(balanceKey));
      values.set(key(balanceKey), { balanceKey, delta: (current?.delta ?? 0n) + delta });
    }
    return values;
  }

  private response(movement: DraftMovement): Readonly<Record<string, unknown>> {
    return {
      movement_id: movement.id,
      movement_number: movement.movementNumber,
      status: movement.status,
      version: Number(movement.version),
    };
  }
}

function decimalNonnegative(value: string): bigint {
  if (value.startsWith('-'))
    throw new InventoryDraftError('invalid_movement_line', 'A balance quantity is invalid.');
  if (value === '0' || /^0\.0+$/u.test(value)) return 0n;
  return decimal(value);
}
