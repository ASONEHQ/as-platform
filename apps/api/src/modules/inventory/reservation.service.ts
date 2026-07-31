import { createHash } from 'node:crypto';

import { createUuidV7 } from '@asone/database';

import type { DraftSqlClient } from './inventory-drafts.repository.js';
import type { LockedBalance } from './inventory-posting.repository.js';
import {
  formatInventoryDecimal,
  inventoryBalanceKey,
  inventoryDecimal,
  inventoryDecimalNonnegative,
  sortInventoryBalanceKeys,
} from './inventory-posting.service.js';
import type {
  InventoryReservation,
  InventoryReservationOwnerType,
  InventoryReservationStatus,
} from './reservation.types.js';
import { InventoryReservationError } from './reservation.types.js';
import type {
  InventoryReservationRepository,
  ReservationCommandResult,
} from './reservation.repository.js';
import type { InventoryMutationContext, InventoryPage } from './inventory.types.js';

export interface ReservationCreateInput {
  branchId: string;
  ownerType: InventoryReservationOwnerType;
  ownerId: string;
  expiresAt?: Date | null;
  lines: readonly {
    locationId: string;
    productVariantId: string;
    quantity: string;
    unitOfMeasureCode: string;
  }[];
}
export interface ReservationListInput {
  limit: number;
  cursor?: string;
  branchId?: string;
  status?: InventoryReservationStatus;
  ownerType?: InventoryReservationOwnerType;
  ownerId?: string;
  locationId?: string;
  variantId?: string;
  expiresBefore?: Date;
  createdFrom?: Date;
  createdTo?: Date;
}
export interface ReservationReleaseInput {
  action: 'release' | 'expire' | 'cancel';
  reasonCode: string;
  note?: string | null;
}

interface BalanceChange {
  balance: LockedBalance;
  previousOnHand: string;
  previousReserved: string;
  onHand: string;
  reserved: string;
  version: bigint;
}

function hash(value: object): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function bounded(value: string | null | undefined, max: number): string | null {
  if (value === undefined || value === null) return null;
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  if (normalized.length > max)
    throw new InventoryReservationError('validation_error', 'Text is too long.');
  return normalized;
}
function quantity(value: string): bigint {
  try {
    return inventoryDecimal(value);
  } catch {
    throw new InventoryReservationError('validation_error', 'A reservation quantity is invalid.');
  }
}
function remaining(value: {
  reservedQuantity: string;
  consumedQuantity: string;
  releasedQuantity: string;
}): string {
  return formatInventoryDecimal(
    inventoryDecimalNonnegative(value.reservedQuantity) -
      inventoryDecimalNonnegative(value.consumedQuantity) -
      inventoryDecimalNonnegative(value.releasedQuantity),
  );
}
export function reservationJson(
  value: InventoryReservation,
  includeLines = true,
): Readonly<Record<string, unknown>> {
  const locations = [...new Set(value.lines.map((line) => line.locationId))].sort();
  return {
    id: value.id,
    reservation_number: value.reservationNumber,
    branch_id: value.branchId,
    owner_type: value.ownerType,
    owner_id: value.ownerId,
    status: value.status,
    expires_at: value.expiresAt?.toISOString() ?? null,
    version: Number(value.version),
    created_at: value.createdAt.toISOString(),
    updated_at: value.updatedAt.toISOString(),
    confirmed_at: value.confirmedAt?.toISOString() ?? null,
    released_at: value.releasedAt?.toISOString() ?? null,
    expired_at: value.expiredAt?.toISOString() ?? null,
    cancelled_at: value.cancelledAt?.toISOString() ?? null,
    created_by: value.createdBy,
    confirmed_by: value.confirmedBy,
    released_by: value.releasedBy,
    expired_by: value.expiredBy,
    cancelled_by: value.cancelledBy,
    confirmation_movement_id: value.confirmationMovementId,
    line_count: value.lines.length,
    location_count: locations.length,
    location_ids: locations,
    ...(includeLines
      ? {
          lines: value.lines.map((line) => ({
            id: line.id,
            line_number: line.lineNumber,
            location_id: line.locationId,
            product_variant_id: line.productVariantId,
            quantity: line.reservedQuantity,
            consumed_quantity: line.consumedQuantity,
            released_quantity: line.releasedQuantity,
            remaining_quantity: remaining(line),
            unit_of_measure_code: line.unitOfMeasureCode,
          })),
        }
      : {}),
  };
}

export class InventoryReservationService {
  public constructor(private readonly repository: InventoryReservationRepository) {}

  public create(
    context: InventoryMutationContext,
    branches: readonly string[],
    key: string,
    input: ReservationCreateInput,
  ): Promise<{ value: Readonly<Record<string, unknown>>; replayed: boolean }> {
    const ownerId = bounded(input.ownerId, 128);
    if (!branches.includes(input.branchId))
      throw new InventoryReservationError(
        'resource_not_found',
        'A reservation resource was not found.',
      );
    if (
      ownerId === null ||
      input.lines.length === 0 ||
      (input.expiresAt !== undefined &&
        input.expiresAt !== null &&
        input.expiresAt.getTime() <= context.timestamp.getTime())
    )
      throw new InventoryReservationError('validation_error', 'The reservation is invalid.');
    const normalized = {
      branchId: input.branchId,
      ownerType: input.ownerType,
      ownerId,
      expiresAt: input.expiresAt?.toISOString() ?? null,
      lines: input.lines.map((line) => ({
        ...line,
        quantity: formatInventoryDecimal(quantity(line.quantity)),
      })),
    };
    return this.repository
      .transaction((client) =>
        this.repository.idempotent(
          client,
          context,
          'inventory_reservation.create',
          key,
          hash(normalized),
          async () => {
            if (!(await this.repository.branchExists(client, context.companyId, input.branchId)))
              throw new InventoryReservationError(
                'resource_not_found',
                'A reservation resource was not found.',
              );
            const seen = new Set<string>();
            for (const line of normalized.lines) {
              const identity = `${line.locationId}:${line.productVariantId}`;
              if (seen.has(identity))
                throw new InventoryReservationError(
                  'validation_error',
                  'Reservation lines must be unique.',
                );
              seen.add(identity);
              const [locationValid, variant] = await Promise.all([
                this.repository.location(
                  client,
                  context.companyId,
                  input.branchId,
                  line.locationId,
                ),
                this.repository.variant(client, context.companyId, line.productVariantId),
              ]);
              const fraction = (line.quantity.split('.')[1] ?? '').replace(/0+$/u, '');
              if (!locationValid || variant === null)
                throw new InventoryReservationError(
                  'resource_not_found',
                  'A reservation resource was not found.',
                );
              if (
                variant.unit !== line.unitOfMeasureCode ||
                fraction.length > variant.quantityScale
              )
                throw new InventoryReservationError(
                  'validation_error',
                  'A reservation line is invalid.',
                );
            }
            const keys = sortInventoryBalanceKeys(
              normalized.lines.map((line) => ({
                companyId: context.companyId,
                branchId: input.branchId,
                locationId: line.locationId,
                variantId: line.productVariantId,
              })),
            );
            const balances = await this.repository.lockBalances(client, keys);
            if (balances.length !== keys.length)
              throw new InventoryReservationError(
                'insufficient_inventory',
                'Available inventory is insufficient.',
              );
            const byKey = new Map(balances.map((value) => [inventoryBalanceKey(value), value]));
            const lineByKey = new Map(
              normalized.lines.map((line) => [
                inventoryBalanceKey({
                  companyId: context.companyId,
                  branchId: input.branchId,
                  locationId: line.locationId,
                  variantId: line.productVariantId,
                }),
                line,
              ]),
            );
            const changes: BalanceChange[] = [];
            for (const balanceKey of keys) {
              const balance = byKey.get(inventoryBalanceKey(balanceKey));
              const line = lineByKey.get(inventoryBalanceKey(balanceKey));
              if (balance === undefined || line === undefined)
                throw new InventoryReservationError(
                  'inventory_balance_conflict',
                  'An inventory balance changed.',
                );
              const amount = quantity(line.quantity);
              const onHand = inventoryDecimalNonnegative(balance.quantityOnHand);
              const reserved = inventoryDecimalNonnegative(balance.quantityReserved);
              if (onHand - reserved < amount)
                throw new InventoryReservationError(
                  'insufficient_inventory',
                  'Available inventory is insufficient.',
                );
              const nextReserved = formatInventoryDecimal(reserved + amount);
              const version = await this.repository.updateBalance(client, {
                balance,
                onHand: balance.quantityOnHand,
                reserved: nextReserved,
                movementId: null,
                timestamp: context.timestamp,
              });
              changes.push({
                balance,
                previousOnHand: balance.quantityOnHand,
                previousReserved: balance.quantityReserved,
                onHand: balance.quantityOnHand,
                reserved: nextReserved,
                version,
              });
            }
            const id = createUuidV7();
            const created = await this.repository.insert(client, context, {
              id,
              branchId: input.branchId,
              reservationNumber: `RES-${id.replaceAll('-', '').toLowerCase()}`,
              ownerType: input.ownerType,
              ownerId,
              expiresAt: input.expiresAt ?? null,
              lines: normalized.lines.map((line) => ({ ...line, id: createUuidV7() })),
            });
            await this.record(client, context, created, 'created', null, null, null, changes);
            return { status: 201, value: reservationJson(created) };
          },
        ),
      )
      .then(({ value, replayed }) => ({ value, replayed }));
  }

  public async list(
    companyId: string,
    branches: readonly string[],
    input: ReservationListInput,
  ): Promise<InventoryPage<Readonly<Record<string, unknown>>>> {
    const page = await this.repository.list(companyId, branches, input);
    return {
      items: page.items.map((value) => reservationJson(value, false)),
      nextCursor: page.nextCursor,
    };
  }

  public async get(
    companyId: string,
    branches: readonly string[],
    id: string,
  ): Promise<InventoryReservation> {
    const value = await this.repository.find(companyId, branches, id);
    if (value === null)
      throw new InventoryReservationError('resource_not_found', 'The reservation was not found.');
    return value;
  }

  public async confirm(
    context: InventoryMutationContext,
    branches: readonly string[],
    id: string,
    expectedVersion: bigint,
    key: string,
  ): Promise<{ value: Readonly<Record<string, unknown>>; replayed: boolean }> {
    const outcome = await this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'inventory_reservation.confirm',
        key,
        hash({ id, expectedVersion: expectedVersion.toString() }),
        async () => {
          const current = await this.required(client, context.companyId, branches, id);
          this.versionAndActive(current, expectedVersion);
          if (this.isExpired(current, context.timestamp))
            return this.expireOutcome(client, context, current);
          const movementId = createUuidV7();
          const movementNumber = `IMV-${movementId.replaceAll('-', '').toLowerCase()}`;
          await this.repository.insertIssueMovement(
            client,
            context,
            current,
            movementId,
            movementNumber,
          );
          const changes = await this.mutate(client, context, current, 'confirm', movementId);
          const updated = await this.repository.transition(client, context, current, 'confirmed');
          await this.record(
            client,
            context,
            updated,
            'confirmed',
            'active',
            null,
            movementId,
            changes,
          );
          return {
            status: 200,
            value: {
              ...reservationJson(updated),
              confirmation_movement_id: movementId,
              confirmation_movement_number: movementNumber,
              affected_balances: changes.map((change) => ({
                balance_id: change.balance.id,
                version: Number(change.version),
              })),
            },
          };
        },
      ),
    );
    return this.unwrap(outcome);
  }

  public async release(
    context: InventoryMutationContext,
    branches: readonly string[],
    id: string,
    expectedVersion: bigint,
    key: string,
    input: ReservationReleaseInput,
  ): Promise<{ value: Readonly<Record<string, unknown>>; replayed: boolean }> {
    const reasonCode = bounded(input.reasonCode, 64);
    const note = bounded(input.note, 2000);
    if (reasonCode === null)
      throw new InventoryReservationError('validation_error', 'reason_code is required.');
    const outcome = await this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        `inventory_reservation.${input.action}`,
        key,
        hash({
          id,
          expectedVersion: expectedVersion.toString(),
          action: input.action,
          reasonCode,
          note,
        }),
        async () => {
          const current = await this.required(client, context.companyId, branches, id);
          this.versionAndActive(current, expectedVersion);
          const expired = this.isExpired(current, context.timestamp);
          if (input.action === 'expire' && !expired)
            throw new InventoryReservationError(
              'validation_error',
              'The reservation has not expired.',
            );
          if (expired && input.action !== 'expire')
            return this.expireOutcome(client, context, current);
          const status =
            input.action === 'release'
              ? 'released'
              : input.action === 'cancel'
                ? 'cancelled'
                : 'expired';
          const changes = await this.mutate(client, context, current, 'release', null);
          const updated = await this.repository.transition(client, context, current, status);
          await this.record(
            client,
            context,
            updated,
            status,
            'active',
            reasonCode,
            null,
            changes,
            note,
          );
          return { status: 200, value: reservationJson(updated) };
        },
      ),
    );
    return this.unwrap(outcome);
  }

  private async expireOutcome(
    client: DraftSqlClient,
    context: InventoryMutationContext,
    current: InventoryReservation,
  ): Promise<{ status: number; value: Readonly<Record<string, unknown>> }> {
    const changes = await this.mutate(client, context, current, 'release', null);
    const updated = await this.repository.transition(client, context, current, 'expired');
    await this.record(client, context, updated, 'expired', 'active', 'expired', null, changes);
    return {
      status: 409,
      value: { ...reservationJson(updated), error_code: 'reservation_expired' },
    };
  }

  private unwrap(outcome: ReservationCommandResult): {
    value: Readonly<Record<string, unknown>>;
    replayed: boolean;
  } {
    if (outcome.status === 409)
      throw new InventoryReservationError('reservation_expired', 'The reservation has expired.', {
        reservation: outcome.value,
        replayed: outcome.replayed,
      });
    return { value: outcome.value, replayed: outcome.replayed };
  }

  private async mutate(
    client: DraftSqlClient,
    context: InventoryMutationContext,
    value: InventoryReservation,
    mode: 'confirm' | 'release',
    movementId: string | null,
  ): Promise<readonly BalanceChange[]> {
    const keys = sortInventoryBalanceKeys(
      value.lines.map((line) => ({
        companyId: context.companyId,
        branchId: value.branchId,
        locationId: line.locationId,
        variantId: line.productVariantId,
      })),
    );
    const balances = await this.repository.lockBalances(client, keys);
    if (balances.length !== keys.length)
      throw new InventoryReservationError(
        'inventory_balance_conflict',
        'An inventory balance changed.',
      );
    const byKey = new Map(balances.map((balance) => [inventoryBalanceKey(balance), balance]));
    const lineByKey = new Map(
      value.lines.map((line) => [
        inventoryBalanceKey({
          companyId: context.companyId,
          branchId: value.branchId,
          locationId: line.locationId,
          variantId: line.productVariantId,
        }),
        line,
      ]),
    );
    const changes: BalanceChange[] = [];
    for (const key of keys) {
      const balance = byKey.get(inventoryBalanceKey(key));
      const line = lineByKey.get(inventoryBalanceKey(key));
      if (balance === undefined || line === undefined)
        throw new InventoryReservationError(
          'inventory_balance_conflict',
          'An inventory balance changed.',
        );
      const amount = inventoryDecimalNonnegative(remaining(line));
      const previousOnHand = inventoryDecimalNonnegative(balance.quantityOnHand);
      const previousReserved = inventoryDecimalNonnegative(balance.quantityReserved);
      if (previousReserved < amount || (mode === 'confirm' && previousOnHand < amount))
        throw new InventoryReservationError(
          'inventory_balance_conflict',
          'An inventory balance changed.',
        );
      const onHand = formatInventoryDecimal(
        mode === 'confirm' ? previousOnHand - amount : previousOnHand,
      );
      const reserved = formatInventoryDecimal(previousReserved - amount);
      const version = await this.repository.updateBalance(client, {
        balance,
        onHand,
        reserved,
        movementId,
        timestamp: context.timestamp,
      });
      changes.push({
        balance,
        previousOnHand: balance.quantityOnHand,
        previousReserved: balance.quantityReserved,
        onHand,
        reserved,
        version,
      });
    }
    return changes;
  }

  private async required(
    client: DraftSqlClient,
    companyId: string,
    branches: readonly string[],
    id: string,
  ): Promise<InventoryReservation> {
    const value = await this.repository.lock(client, companyId, id);
    if (value === null || !branches.includes(value.branchId))
      throw new InventoryReservationError('resource_not_found', 'The reservation was not found.');
    return value;
  }

  private versionAndActive(value: InventoryReservation, expectedVersion: bigint): void {
    if (value.version !== expectedVersion)
      throw new InventoryReservationError('version_conflict', 'The reservation version changed.');
    if (value.status !== 'active')
      throw new InventoryReservationError(
        'reservation_already_completed',
        'The reservation is already complete.',
      );
  }

  private isExpired(value: InventoryReservation, now: Date): boolean {
    return value.expiresAt !== null && value.expiresAt.getTime() <= now.getTime();
  }

  private async record(
    client: DraftSqlClient,
    context: InventoryMutationContext,
    value: InventoryReservation,
    action: 'created' | 'confirmed' | 'released' | 'expired' | 'cancelled',
    previousStatus: InventoryReservationStatus | null,
    reasonCode: string | null,
    movementId: string | null,
    changes: readonly BalanceChange[],
    note: string | null = null,
  ): Promise<void> {
    await this.repository.audit(client, context, value, `inventory_reservation.${action}`, {
      previous_status: previousStatus,
      new_status: value.status,
      movement_id: movementId,
      reason_code: reasonCode,
      note,
      request_id: context.requestId,
      correlation_id: context.correlationId,
    });
    const locations = [...new Set(value.lines.map((line) => line.locationId))].sort();
    await this.repository.outbox(client, context, {
      eventType: `inventory.reservation.${action}`,
      aggregateType: 'inventory_reservation',
      aggregateId: value.id,
      aggregateVersion: value.version,
      branchId: value.branchId,
      payload: {
        company_id: context.companyId,
        branch_id: value.branchId,
        reservation_id: value.id,
        owner_type: value.ownerType,
        owner_id: value.ownerId,
        status: value.status,
        location_ids: locations,
        location_count: locations.length,
        line_count: value.lines.length,
        movement_id: movementId,
        reason_code: reasonCode,
        version: Number(value.version),
        occurred_at: context.timestamp.toISOString(),
        correlation_id: context.correlationId,
      },
    });
    if (movementId !== null)
      await this.repository.outbox(client, context, {
        eventType: 'inventory.movement.created',
        aggregateType: 'inventory_movement',
        aggregateId: movementId,
        aggregateVersion: 1n,
        branchId: value.branchId,
        payload: {
          company_id: context.companyId,
          branch_id: value.branchId,
          movement_id: movementId,
          movement_type: 'issue',
          status: 'posted',
          reservation_id: value.id,
          actor_id: context.actorId,
          correlation_id: context.correlationId,
        },
      });
    for (const change of changes)
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
          previous_quantity_on_hand: change.previousOnHand,
          previous_quantity_reserved: change.previousReserved,
          quantity_on_hand: change.onHand,
          quantity_reserved: change.reserved,
          quantity_available: formatInventoryDecimal(
            inventoryDecimalNonnegative(change.onHand) -
              inventoryDecimalNonnegative(change.reserved),
          ),
          movement_id: movementId,
          reservation_id: value.id,
          correlation_id: context.correlationId,
        },
      });
  }
}
