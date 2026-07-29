import { createHash } from 'node:crypto';

import { createUuidV7 } from '@asone/database';

import type { DraftSqlClient } from './inventory-drafts.repository.js';
import {
  formatInventoryDecimal,
  inventoryBalanceKey,
  inventoryDecimal,
  inventoryDecimalNonnegative,
  INVENTORY_QUANTITY_MAX,
  sortInventoryBalanceKeys,
} from './inventory-posting.service.js';
import type { LockedBalance } from './inventory-posting.repository.js';
import type { InventoryTransferRepository } from './inventory-transfers.repository.js';
import type {
  InventoryTransfer,
  InventoryTransferLine,
  InventoryTransferStatus,
} from './inventory-transfers.types.js';
import { InventoryTransferError } from './inventory-transfers.types.js';
import type { InventoryMutationContext, InventoryPage } from './inventory.types.js';

export interface TransferCreateInput {
  sourceBranchId: string;
  destinationBranchId: string;
  sourceLocationId: string;
  destinationLocationId: string;
  transitLocationId: string;
  notes?: string | null;
  lines: readonly {
    productVariantId: string;
    quantity: string;
    unitOfMeasureCode: string;
    notes?: string | null;
  }[];
}
export interface TransferDecisionInput {
  decision: 'approve' | 'reject';
  reasonCode?: string;
  note?: string | null;
}
export interface TransferNoteInput {
  note?: string | null;
}
export interface TransferCancelInput extends TransferNoteInput {
  reasonCode: string;
}
export interface TransferListInput {
  limit: number;
  cursor?: string;
  status?: InventoryTransferStatus;
  branchId?: string;
  variantId?: string;
  requestedFrom?: Date;
  requestedTo?: Date;
}

function hash(value: object): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function text(value: string | null | undefined, max: number): string | null {
  if (value === undefined || value === null) return null;
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  if (normalized.length > max)
    throw new InventoryTransferError('validation_error', 'Text is too long.');
  return normalized;
}
function transferJson(
  value: InventoryTransfer,
  includeLines = true,
): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    transfer_number: value.transferNumber,
    status: value.status,
    source_branch_id: value.sourceBranchId,
    destination_branch_id: value.destinationBranchId,
    source_location_id: value.sourceLocationId,
    destination_location_id: value.destinationLocationId,
    transit_location_id: value.transitLocationId,
    notes: value.notes,
    version: Number(value.version),
    requested_at: value.requestedAt.toISOString(),
    approved_at: value.approvedAt?.toISOString() ?? null,
    shipped_at: value.shippedAt?.toISOString() ?? null,
    received_at: value.receivedAt?.toISOString() ?? null,
    rejected_at: value.rejectedAt?.toISOString() ?? null,
    cancelled_at: value.cancelledAt?.toISOString() ?? null,
    requested_by: value.requestedBy,
    approved_by: value.approvedBy,
    shipped_by: value.shippedBy,
    received_by: value.receivedBy,
    rejected_by: value.rejectedBy,
    cancelled_by: value.cancelledBy,
    shipment_movement_id: value.shipmentMovementId,
    receipt_movement_id: value.receiptMovementId,
    ...(includeLines ? { lines: value.lines.map(lineJson) } : {}),
  };
}
function lineJson(value: InventoryTransferLine): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    line_number: value.lineNumber,
    product_variant_id: value.productVariantId,
    quantity: value.requestedQuantity,
    shipped_quantity: value.shippedQuantity,
    received_quantity: value.receivedQuantity,
    rejected_quantity: value.rejectedQuantity,
    unit_of_measure_code: value.unitOfMeasureCode,
    notes: value.notes,
  };
}
function branchesAllowed(
  permitted: readonly string[],
  value: Pick<InventoryTransfer, 'sourceBranchId' | 'destinationBranchId'>,
  mode: 'either' | 'both' | 'destination',
): boolean {
  if (mode === 'destination') return permitted.includes(value.destinationBranchId);
  if (mode === 'both')
    return (
      permitted.includes(value.sourceBranchId) && permitted.includes(value.destinationBranchId)
    );
  return permitted.includes(value.sourceBranchId) || permitted.includes(value.destinationBranchId);
}

export class InventoryTransferService {
  public constructor(private readonly repository: InventoryTransferRepository) {}

  public async create(
    context: InventoryMutationContext,
    branches: readonly string[],
    key: string,
    input: TransferCreateInput,
  ): Promise<{ value: Readonly<Record<string, unknown>>; replayed: boolean }> {
    const normalized = {
      ...input,
      notes: text(input.notes, 2000),
      lines: input.lines.map((line) => ({ ...line, notes: text(line.notes, 2000) })),
    };
    if (!branches.includes(input.sourceBranchId) || !branches.includes(input.destinationBranchId))
      throw new InventoryTransferError('resource_not_found', 'A transfer resource was not found.');
    if (
      input.sourceLocationId === input.destinationLocationId ||
      input.transitLocationId === input.sourceLocationId ||
      input.transitLocationId === input.destinationLocationId ||
      input.lines.length === 0
    )
      throw new InventoryTransferError('validation_error', 'The transfer is invalid.');
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'inventory_transfer.create',
        key,
        hash(normalized),
        201,
        async () => {
          await this.validateHeader(client, context.companyId, normalized);
          const seen = new Set<string>();
          for (const line of normalized.lines) {
            if (seen.has(line.productVariantId))
              throw new InventoryTransferError(
                'validation_error',
                'Transfer lines must be unique.',
              );
            seen.add(line.productVariantId);
            const quantity = inventoryDecimal(line.quantity);
            const variant = await this.repository.variant(
              client,
              context.companyId,
              line.productVariantId,
            );
            if (
              variant?.unit !== line.unitOfMeasureCode ||
              !this.compatibleScale(line.quantity, variant.quantityScale) ||
              quantity <= 0n
            )
              throw new InventoryTransferError(
                'invalid_movement_line',
                'A transfer line is invalid.',
              );
          }
          const id = createUuidV7();
          const created = await this.repository.insert(client, context, {
            id,
            transferNumber: `ITR-${id.replaceAll('-', '').toLowerCase()}`,
            sourceBranchId: normalized.sourceBranchId,
            destinationBranchId: normalized.destinationBranchId,
            sourceLocationId: normalized.sourceLocationId,
            destinationLocationId: normalized.destinationLocationId,
            transitLocationId: normalized.transitLocationId,
            notes: normalized.notes,
            lines: normalized.lines.map((line) => ({ ...line, id: createUuidV7() })),
          });
          await this.recordTransition(client, context, created, 'created', null, null);
          return transferJson(created);
        },
      ),
    );
  }

  public async list(
    companyId: string,
    branches: readonly string[],
    input: TransferListInput,
  ): Promise<InventoryPage<Readonly<Record<string, unknown>>>> {
    const page = await this.repository.list(companyId, branches, input);
    return {
      items: page.items.map((value) => transferJson(value, false)),
      nextCursor: page.nextCursor,
    };
  }

  public async get(
    companyId: string,
    branches: readonly string[],
    id: string,
  ): Promise<InventoryTransfer> {
    const value = await this.repository.find(companyId, branches, id);
    if (value === null)
      throw new InventoryTransferError('resource_not_found', 'The transfer was not found.');
    return value;
  }

  public decision(
    context: InventoryMutationContext,
    branches: readonly string[],
    id: string,
    expectedVersion: bigint,
    key: string,
    input: TransferDecisionInput,
  ): Promise<{ value: Readonly<Record<string, unknown>>; replayed: boolean }> {
    const reasonCode = text(input.reasonCode, 64);
    const note = text(input.note, 2000);
    if (input.decision === 'reject' && reasonCode === null)
      throw new InventoryTransferError('validation_error', 'reason_code is required.');
    return this.simpleTransition(
      context,
      branches,
      id,
      expectedVersion,
      key,
      `inventory_transfer.${input.decision}`,
      'requested',
      input.decision === 'approve' ? 'approved' : 'rejected',
      note,
      reasonCode,
      'both',
    );
  }

  public cancel(
    context: InventoryMutationContext,
    branches: readonly string[],
    id: string,
    expectedVersion: bigint,
    key: string,
    input: TransferCancelInput,
  ): Promise<{ value: Readonly<Record<string, unknown>>; replayed: boolean }> {
    const reasonCode = text(input.reasonCode, 64);
    if (reasonCode === null)
      throw new InventoryTransferError('validation_error', 'reason_code is required.');
    return this.simpleTransition(
      context,
      branches,
      id,
      expectedVersion,
      key,
      'inventory_transfer.cancel',
      ['requested', 'approved'],
      'cancelled',
      text(input.note, 2000),
      reasonCode,
      'both',
    );
  }

  public ship(
    context: InventoryMutationContext,
    branches: readonly string[],
    id: string,
    expectedVersion: bigint,
    key: string,
    input: TransferNoteInput,
  ): Promise<{ value: Readonly<Record<string, unknown>>; replayed: boolean }> {
    return this.stockTransition(
      context,
      branches,
      id,
      expectedVersion,
      key,
      'shipped',
      text(input.note, 2000),
    );
  }

  public receive(
    context: InventoryMutationContext,
    branches: readonly string[],
    id: string,
    expectedVersion: bigint,
    key: string,
    input: TransferNoteInput,
  ): Promise<{ value: Readonly<Record<string, unknown>>; replayed: boolean }> {
    return this.stockTransition(
      context,
      branches,
      id,
      expectedVersion,
      key,
      'received',
      text(input.note, 2000),
    );
  }

  private simpleTransition(
    context: InventoryMutationContext,
    branches: readonly string[],
    id: string,
    expectedVersion: bigint,
    key: string,
    operation: string,
    expectedStatus: InventoryTransferStatus | readonly InventoryTransferStatus[],
    nextStatus: 'approved' | 'rejected' | 'cancelled',
    note: string | null,
    reasonCode: string | null,
    scope: 'both',
  ): Promise<{ value: Readonly<Record<string, unknown>>; replayed: boolean }> {
    const requestHash = hash({
      id,
      expectedVersion: expectedVersion.toString(),
      nextStatus,
      reasonCode,
      note,
    });
    return this.repository.transaction((client) =>
      this.repository.idempotent(client, context, operation, key, requestHash, 200, async () => {
        const current = await this.requiredLock(client, context.companyId, id);
        this.authorize(branches, current, scope);
        this.versionAndState(current, expectedVersion, expectedStatus);
        const updated = await this.repository.transition(client, context, current, {
          status: nextStatus,
        });
        await this.recordTransition(
          client,
          context,
          updated,
          nextStatus,
          current.status,
          reasonCode,
          undefined,
          note,
        );
        return transferJson(updated);
      }),
    );
  }

  private stockTransition(
    context: InventoryMutationContext,
    branches: readonly string[],
    id: string,
    expectedVersion: bigint,
    key: string,
    nextStatus: 'shipped' | 'received',
    note: string | null,
  ): Promise<{ value: Readonly<Record<string, unknown>>; replayed: boolean }> {
    const requestHash = hash({ id, expectedVersion: expectedVersion.toString(), note });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        `inventory_transfer.${nextStatus === 'shipped' ? 'ship' : 'receive'}`,
        key,
        requestHash,
        200,
        async () => {
          const current = await this.requiredLock(client, context.companyId, id);
          this.authorize(branches, current, nextStatus === 'received' ? 'destination' : 'both');
          this.versionAndState(
            current,
            expectedVersion,
            nextStatus === 'shipped' ? 'approved' : 'shipped',
          );
          await this.validateFrozenLocations(client, current);
          const movementId = createUuidV7();
          const movementNumber = `IMV-${movementId.replaceAll('-', '').toLowerCase()}`;
          await this.repository.insertMovement(client, context, {
            id: movementId,
            movementNumber,
            type: nextStatus === 'shipped' ? 'transfer_shipment' : 'transfer_receipt',
            branchId:
              nextStatus === 'shipped' ? current.sourceBranchId : current.destinationBranchId,
            transfer: current,
            note,
            sourceLocationId:
              nextStatus === 'shipped' ? current.sourceLocationId : current.transitLocationId,
            destinationLocationId:
              nextStatus === 'shipped' ? current.transitLocationId : current.destinationLocationId,
          });
          const balances = await this.mutateBalances(
            client,
            context,
            current,
            movementId,
            nextStatus,
          );
          const updated = await this.repository.transition(client, context, current, {
            status: nextStatus,
            movementId,
          });
          await this.recordTransition(
            client,
            context,
            updated,
            nextStatus,
            current.status,
            null,
            movementId,
            note,
          );
          for (const change of balances)
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
                quantity_on_hand: change.onHand,
                quantity_in_transit: change.inTransit,
                movement_id: movementId,
                occurred_at: context.timestamp.toISOString(),
                correlation_id: context.correlationId,
              },
            });
          return {
            ...transferJson(updated),
            movement_id: movementId,
            movement_number: movementNumber,
            affected_balances: balances.map((value) => ({
              balance_id: value.balance.id,
              version: Number(value.version),
            })),
          };
        },
      ),
    );
  }

  private async mutateBalances(
    client: DraftSqlClient,
    context: InventoryMutationContext,
    transferValue: InventoryTransfer,
    movementId: string,
    mode: 'shipped' | 'received',
  ): Promise<
    readonly {
      balance: LockedBalance;
      version: bigint;
      onHand: string;
      inTransit: string;
    }[]
  > {
    const keys = sortInventoryBalanceKeys(
      transferValue.lines.flatMap((line) => [
        {
          companyId: context.companyId,
          branchId:
            mode === 'shipped' ? transferValue.sourceBranchId : transferValue.destinationBranchId,
          locationId:
            mode === 'shipped' ? transferValue.sourceLocationId : transferValue.transitLocationId,
          variantId: line.productVariantId,
        },
        {
          companyId: context.companyId,
          branchId: transferValue.destinationBranchId,
          locationId:
            mode === 'shipped'
              ? transferValue.transitLocationId
              : transferValue.destinationLocationId,
          variantId: line.productVariantId,
        },
      ]),
    );
    const unique = [...new Map(keys.map((value) => [inventoryBalanceKey(value), value])).values()];
    const inboundLocationId =
      mode === 'shipped' ? transferValue.transitLocationId : transferValue.destinationLocationId;
    await this.repository.createInboundBalances(
      client,
      unique.filter((value) => value.locationId === inboundLocationId),
      movementId,
      context.timestamp,
    );
    const balances = await this.repository.lockBalances(client, unique);
    const byKey = new Map(balances.map((value) => [inventoryBalanceKey(value), value]));
    const amounts = new Map<string, bigint>();
    for (const line of transferValue.lines) {
      const amount = inventoryDecimal(
        mode === 'shipped' ? line.requestedQuantity : line.shippedQuantity,
      );
      for (const key of unique.filter((value) => value.variantId === line.productVariantId))
        amounts.set(inventoryBalanceKey(key), amount);
    }
    const changes = [];
    for (const key of unique) {
      const balance = byKey.get(inventoryBalanceKey(key));
      if (balance === undefined)
        throw new InventoryTransferError(
          'inventory_balance_not_found',
          'An inventory balance was not found.',
        );
      const amount = amounts.get(inventoryBalanceKey(key)) ?? 0n;
      let onHand = inventoryDecimalNonnegative(balance.quantityOnHand);
      let inTransit = inventoryDecimalNonnegative(balance.quantityInTransit);
      const reserved = inventoryDecimalNonnegative(balance.quantityReserved);
      const isFirst =
        key.locationId ===
        (mode === 'shipped' ? transferValue.sourceLocationId : transferValue.transitLocationId);
      if (mode === 'shipped') {
        if (isFirst) {
          if (onHand - reserved < amount)
            throw new InventoryTransferError(
              'insufficient_inventory',
              'Available inventory is insufficient.',
            );
          onHand -= amount;
        } else inTransit += amount;
      } else if (isFirst) {
        if (inTransit < amount)
          throw new InventoryTransferError(
            'transfer_quantity_exceeded',
            'Transit inventory is insufficient.',
          );
        inTransit -= amount;
      } else onHand += amount;
      if (onHand > INVENTORY_QUANTITY_MAX || inTransit > INVENTORY_QUANTITY_MAX)
        throw new InventoryTransferError('numeric_overflow', 'The result exceeds range.');
      const onHandText = formatInventoryDecimal(onHand);
      const inTransitText = formatInventoryDecimal(inTransit);
      const version = await this.repository.updateTransferBalance(client, {
        balance,
        onHand: onHandText,
        inTransit: inTransitText,
        movementId,
        timestamp: context.timestamp,
      });
      changes.push({ balance, version, onHand: onHandText, inTransit: inTransitText });
    }
    return changes;
  }

  private async validateHeader(
    client: DraftSqlClient,
    companyId: string,
    input: TransferCreateInput,
  ): Promise<void> {
    const branches = await Promise.all([
      this.repository.branchExists(client, companyId, input.sourceBranchId),
      this.repository.branchExists(client, companyId, input.destinationBranchId),
    ]);
    const [source, destination, transit] = await Promise.all([
      this.repository.location(client, companyId, input.sourceBranchId, input.sourceLocationId),
      this.repository.location(
        client,
        companyId,
        input.destinationBranchId,
        input.destinationLocationId,
      ),
      this.repository.location(
        client,
        companyId,
        input.destinationBranchId,
        input.transitLocationId,
      ),
    ]);
    if (
      !branches.every(Boolean) ||
      source === null ||
      destination === null ||
      transit === null ||
      !source.issuing ||
      !destination.receiving ||
      transit.type !== 'transit'
    )
      throw new InventoryTransferError('resource_not_found', 'A transfer resource was not found.');
  }

  private async validateFrozenLocations(
    client: DraftSqlClient,
    value: InventoryTransfer,
  ): Promise<void> {
    const [source, destination, transit] = await Promise.all([
      this.repository.location(
        client,
        value.companyId,
        value.sourceBranchId,
        value.sourceLocationId,
      ),
      this.repository.location(
        client,
        value.companyId,
        value.destinationBranchId,
        value.destinationLocationId,
      ),
      this.repository.location(
        client,
        value.companyId,
        value.destinationBranchId,
        value.transitLocationId,
      ),
    ]);
    if (
      source === null ||
      destination === null ||
      transit === null ||
      !source.issuing ||
      !destination.receiving ||
      transit.type !== 'transit'
    )
      throw new InventoryTransferError('resource_not_found', 'A transfer location was not found.');
  }

  private async requiredLock(
    client: DraftSqlClient,
    companyId: string,
    id: string,
  ): Promise<InventoryTransfer> {
    const value = await this.repository.lock(client, companyId, id);
    if (value === null)
      throw new InventoryTransferError('resource_not_found', 'The transfer was not found.');
    return value;
  }

  private authorize(
    branches: readonly string[],
    value: InventoryTransfer,
    scope: 'either' | 'both' | 'destination',
  ): void {
    if (!branchesAllowed(branches, value, scope))
      throw new InventoryTransferError('resource_not_found', 'The transfer was not found.');
  }

  private versionAndState(
    value: InventoryTransfer,
    version: bigint,
    expected: InventoryTransferStatus | readonly InventoryTransferStatus[],
  ): void {
    if (value.version !== version)
      throw new InventoryTransferError('version_conflict', 'The transfer version changed.');
    if (!(Array.isArray(expected) ? expected : [expected]).includes(value.status))
      throw new InventoryTransferError(
        'transfer_invalid_transition',
        'The transfer transition is invalid.',
      );
  }

  private compatibleScale(value: string, scale: number): boolean {
    const fraction = value.split('.')[1] ?? '';
    return fraction.length <= scale;
  }

  private async recordTransition(
    client: DraftSqlClient,
    context: InventoryMutationContext,
    value: InventoryTransfer,
    action: string,
    previousStatus: InventoryTransferStatus | null,
    reasonCode: string | null,
    movementId?: string,
    note?: string | null,
  ): Promise<void> {
    const status = action === 'created' ? 'requested' : action;
    const metadata = {
      previous_status: previousStatus,
      status,
      reason_code: reasonCode,
      note: note ?? null,
      movement_id: movementId ?? null,
    };
    await this.repository.audit(client, context, value, `inventory_transfer.${action}`, metadata);
    await this.repository.outbox(client, context, {
      eventType: `inventory.transfer.${action}`,
      aggregateType: 'inventory_transfer',
      aggregateId: value.id,
      aggregateVersion: value.version,
      branchId: value.sourceBranchId,
      payload: {
        company_id: context.companyId,
        source_branch_id: value.sourceBranchId,
        destination_branch_id: value.destinationBranchId,
        transfer_id: value.id,
        transfer_number: value.transferNumber,
        status,
        version: Number(value.version),
        movement_id: movementId ?? null,
        actor_id: context.actorId,
        request_id: context.requestId,
        correlation_id: context.correlationId,
        occurred_at: context.timestamp.toISOString(),
      },
    });
    if (movementId !== undefined)
      await this.repository.outbox(client, context, {
        eventType: 'inventory.movement.created',
        aggregateType: 'inventory_movement',
        aggregateId: movementId,
        aggregateVersion: 1n,
        branchId: action === 'shipped' ? value.sourceBranchId : value.destinationBranchId,
        payload: {
          company_id: context.companyId,
          branch_id: action === 'shipped' ? value.sourceBranchId : value.destinationBranchId,
          movement_id: movementId,
          movement_type: action === 'shipped' ? 'transfer_shipment' : 'transfer_receipt',
          status: 'posted',
          transfer_id: value.id,
          actor_id: context.actorId,
          correlation_id: context.correlationId,
        },
      });
  }
}

export { transferJson };
