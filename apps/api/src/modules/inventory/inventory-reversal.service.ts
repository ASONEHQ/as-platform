import { createHash } from 'node:crypto';

import { createUuidV7 } from '@asone/database';

import type { DraftSqlClient } from './inventory-drafts.repository.js';
import type { DraftMovement, DraftMovementLine } from './inventory-drafts.types.js';
import { InventoryDraftError } from './inventory-drafts.types.js';
import type { BalanceKey, LockedBalance } from './inventory-posting.repository.js';
import {
  formatInventoryDecimal,
  INVENTORY_QUANTITY_MAX,
  inventoryBalanceKey,
  inventoryDecimal,
  inventoryDecimalNonnegative,
  sortInventoryBalanceKeys,
} from './inventory-posting.service.js';
import type { InventoryReversalRepository } from './inventory-reversal.repository.js';
import type { InventoryMutationContext } from './inventory.types.js';

export interface ReverseMovementInput {
  reasonCode: string;
  note: string | null;
}

interface BalanceChange {
  balance: LockedBalance;
  delta: bigint;
  previous: bigint;
  next: bigint;
  version: bigint;
}

function requestHash(value: object): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function normalizedNote(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? null : trimmed;
}

export class InventoryReversalService {
  public constructor(private readonly repository: InventoryReversalRepository) {}

  public reverse(
    context: InventoryMutationContext,
    branches: readonly string[],
    movementId: string,
    expectedVersion: bigint,
    idempotencyKey: string,
    input: ReverseMovementInput,
  ): Promise<{ value: Readonly<Record<string, unknown>>; replayed: boolean }> {
    const normalized = {
      movementId,
      expectedVersion: expectedVersion.toString(),
      reasonCode: input.reasonCode.trim(),
      note: normalizedNote(input.note),
    };
    return this.repository.transaction((client) =>
      this.repository.posting.drafts.idempotent(
        client,
        context,
        'inventory_movement.reverse',
        idempotencyKey,
        requestHash(normalized),
        201,
        async () => {
          const original = await this.required(client, context.companyId, branches, movementId);
          this.eligible(original);
          if (original.version !== expectedVersion)
            throw new InventoryDraftError('version_conflict', 'The movement version changed.');
          const originalLines = await this.validLines(client, context.companyId, original);
          if (originalLines.length === 0)
            throw new InventoryDraftError('movement_has_no_lines', 'The movement has no lines.');

          const inverseLines = originalLines.map((line) => ({
            ...line,
            sourceLocationId: line.destinationLocationId,
            destinationLocationId: line.sourceLocationId,
            unitCost: null,
            extendedCost: null,
            currencyCode: null,
            metadata: null,
          }));
          const deltas = this.aggregate(original, inverseLines);
          const keys = sortInventoryBalanceKeys(
            [...deltas.values()].map(({ balanceKey }) => balanceKey),
          );
          const existing = await this.repository.posting.lockBalances(client, keys);
          const existingKeys = new Set(existing.map(inventoryBalanceKey));
          const inbound = keys.filter(
            (balanceKey) =>
              !existingKeys.has(inventoryBalanceKey(balanceKey)) &&
              (deltas.get(inventoryBalanceKey(balanceKey))?.delta ?? 0n) > 0n,
          );

          const reversalId = createUuidV7();
          const reversal = await this.repository.insertReversal(client, context, {
            id: reversalId,
            movementNumber: `IMV-${reversalId.replaceAll('-', '').toLowerCase()}`,
            original,
            reasonCode: normalized.reasonCode,
            note: normalized.note,
          });
          await this.repository.insertReversalLines(
            client,
            context,
            reversal.id,
            normalized.reasonCode,
            inverseLines,
          );
          await this.repository.posting.createInboundBalances(
            client,
            inbound,
            reversal.id,
            context.timestamp,
          );
          const balances = await this.repository.posting.lockBalances(client, keys);
          const byKey = new Map(balances.map((balance) => [inventoryBalanceKey(balance), balance]));
          const changes: BalanceChange[] = [];
          for (const balanceKey of keys) {
            const key = inventoryBalanceKey(balanceKey);
            const balance = byKey.get(key);
            if (balance === undefined)
              throw new InventoryDraftError(
                'inventory_balance_not_found',
                'The inventory balance was not found.',
              );
            const delta = deltas.get(key)?.delta ?? 0n;
            const previous = inventoryDecimalNonnegative(balance.quantityOnHand);
            const reserved = inventoryDecimalNonnegative(balance.quantityReserved);
            const next = previous + delta;
            if (next < 0n || next < reserved)
              throw new InventoryDraftError(
                'insufficient_inventory',
                'Available inventory is insufficient.',
              );
            if (next > INVENTORY_QUANTITY_MAX)
              throw new InventoryDraftError('numeric_overflow', 'The result exceeds range.');
            const balanceVersion = await this.repository.posting.updateBalance(client, {
              ...balance,
              newQuantity: formatInventoryDecimal(next),
              movementId: reversal.id,
              timestamp: context.timestamp,
            });
            changes.push({ balance, delta, previous, next, version: balanceVersion });
          }

          const updatedOriginal = await this.repository.markOriginalReversed(
            client,
            context,
            original,
            reversal.id,
          );
          const evidence = changes.map(({ balance, delta }) => ({
            inventory_location_id: balance.locationId,
            product_variant_id: balance.variantId,
            delta_quantity_on_hand: formatInventoryDecimal(delta),
          }));
          const relationship = {
            original_movement_id: original.id,
            original_movement_number: original.movementNumber,
            reversal_movement_id: reversal.id,
            reversal_movement_number: reversal.movementNumber,
            reason_code: normalized.reasonCode,
            note: normalized.note,
          };
          await this.repository.posting.drafts.audit(client, context, {
            action: 'inventory_movement.reversal_created',
            movement: reversal,
            metadata: relationship,
          });
          await this.repository.posting.drafts.audit(client, context, {
            action: 'inventory_movement.reversed',
            movement: updatedOriginal,
            metadata: {
              ...relationship,
              previous_status: 'posted',
              status: 'reversed',
              affected_balances: evidence,
            },
          });
          await this.repository.posting.outbox(client, context, {
            eventType: 'inventory.movement.created',
            aggregateType: 'inventory_movement',
            aggregateId: reversal.id,
            aggregateVersion: reversal.version,
            branchId: reversal.branchId,
            payload: {
              company_id: context.companyId,
              branch_id: reversal.branchId,
              movement_id: reversal.id,
              movement_number: reversal.movementNumber,
              movement_type: 'reversal',
              reversal_of_movement_id: original.id,
              original_movement_id: original.id,
              posted_at: context.timestamp.toISOString(),
              actor_id: context.actorId,
              correlation_id: context.correlationId,
            },
          });
          await this.repository.posting.outbox(client, context, {
            eventType: 'inventory.movement_reversed',
            aggregateType: 'inventory_movement',
            aggregateId: original.id,
            aggregateVersion: updatedOriginal.version,
            branchId: original.branchId,
            payload: {
              company_id: context.companyId,
              branch_id: original.branchId,
              original_movement_id: original.id,
              original_movement_number: original.movementNumber,
              reversal_movement_id: reversal.id,
              reversal_movement_number: reversal.movementNumber,
              reversed_at: context.timestamp.toISOString(),
              actor_id: context.actorId,
              correlation_id: context.correlationId,
            },
          });
          for (const change of changes) {
            const reserved = inventoryDecimalNonnegative(change.balance.quantityReserved);
            await this.repository.posting.outbox(client, context, {
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
                previous_quantity_on_hand: formatInventoryDecimal(change.previous),
                delta_quantity_on_hand: formatInventoryDecimal(change.delta),
                new_quantity_on_hand: formatInventoryDecimal(change.next),
                quantity_reserved: formatInventoryDecimal(reserved),
                available_quantity: formatInventoryDecimal(change.next - reserved),
                original_movement_id: original.id,
                reversal_movement_id: reversal.id,
                reversal_movement_number: reversal.movementNumber,
                occurred_at: context.timestamp.toISOString(),
                correlation_id: context.correlationId,
              },
            });
          }
          return {
            original_movement_id: original.id,
            original_status: 'reversed',
            original_version: Number(updatedOriginal.version),
            reversal_movement_id: reversal.id,
            reversal_movement_number: reversal.movementNumber,
            reversal_status: 'posted',
            reversal_version: Number(reversal.version),
            reversed_at: context.timestamp.toISOString(),
            affected_balance_count: changes.length,
          };
        },
      ),
    );
  }

  private async required(
    client: DraftSqlClient,
    companyId: string,
    branches: readonly string[],
    movementId: string,
  ): Promise<DraftMovement> {
    const movement = await this.repository.posting.drafts.lock(
      client,
      companyId,
      branches,
      movementId,
    );
    if (movement === null)
      throw new InventoryDraftError('inventory_movement_not_found', 'The movement was not found.');
    return movement;
  }

  private eligible(movement: DraftMovement): void {
    if (movement.status === 'reversed' || movement.reversedByMovementId !== null)
      throw new InventoryDraftError(
        'movement_already_reversed',
        'The movement has already been reversed.',
      );
    if (movement.status !== 'posted')
      throw new InventoryDraftError('invalid_movement_state', 'The movement is not posted.');
    if (
      !['opening_balance', 'adjustment'].includes(movement.movementType) ||
      movement.reversalOfMovementId !== null
    )
      throw new InventoryDraftError(
        'inventory_movement_not_reversible',
        'The movement cannot be reversed through this command.',
      );
  }

  private async validLines(
    client: DraftSqlClient,
    companyId: string,
    movement: DraftMovement,
  ): Promise<readonly DraftMovementLine[]> {
    const lines = await this.repository.posting.lines(client, companyId, movement.id);
    for (const line of lines) {
      inventoryDecimal(line.quantity);
      inventoryDecimal(line.baseQuantity);
      const valid = await this.repository.posting.validateLineReferences(
        client,
        companyId,
        movement.branchId,
        line,
      );
      const direction =
        (line.sourceLocationId === null) !== (line.destinationLocationId === null) &&
        line.sourceLocationId !== line.destinationLocationId;
      if (!valid || !direction)
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
        throw new InventoryDraftError('invalid_movement_line', 'A movement line is invalid.');
      const balanceKey = {
        companyId: movement.companyId,
        branchId: movement.branchId,
        locationId,
        variantId: line.productVariantId,
      };
      const key = inventoryBalanceKey(balanceKey);
      const amount = inventoryDecimal(line.baseQuantity);
      const delta = line.sourceLocationId === null ? amount : -amount;
      const current = values.get(key);
      values.set(key, { balanceKey, delta: (current?.delta ?? 0n) + delta });
    }
    return values;
  }
}
