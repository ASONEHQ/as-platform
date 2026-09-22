import { randomUUID } from 'node:crypto';

/**
 * TASK 16.20 (Part E — event snack/drink inventory) — the real, one-way
 * stock deduction for a party reservation's snack/drink line, mirroring
 * `party-sock-deduction.ts` almost exactly (see that module's own doc
 * comment for the shared rationale: module-level function taking a bare
 * `{query}` transaction client, not a class, so it composes inside the
 * caller's own transaction). Confirmed by the forensic audit
 * (`docs/LEGACY_FUNCTIONAL_PARITY.md`) that NEITHER the legacy app NOR
 * ACCESS GO before this task ever posted a real inventory movement for a
 * snack — this closes that gap using the exact same ledger, movement
 * type, and locking discipline socks already use in production.
 *
 * - **Movement type**: `issue` — same generic "manually issued" type
 *   `party-sock-deduction.ts` uses; no snack-specific movement type is
 *   invented.
 * - **Reference**: `reference_type='party_reservation_snack'`,
 *   `reference_id=<snack.id>` — a brand-new `reference_type` value needs
 *   zero schema migration (see `inventory_movements.reference_type`'s own
 *   free-text design, confirmed by the catalog/inventory audit).
 * - **Idempotency**: same tier-1 guarantee as socks — the caller
 *   (`PartyReservationsService.deductSnack`) takes the row lock on
 *   `party_reservation_snacks` and checks `stockDeducted='pending'` AFTER
 *   acquiring it; no partial unique index exists for this reference either,
 *   for the identical reason `party-sock-deduction.ts` documents.
 * - **Negative stock**: the same block-negative policy every other
 *   posting path in this codebase enforces.
 */

export interface PartySnackDeductionTransaction {
  query(sql: string, values?: readonly unknown[]): Promise<unknown>;
}

export interface PartySnackDeductionContext {
  companyId: string;
  actorId: string;
  correlationId: string;
  timestamp: Date;
}

export interface PartySnackDeductionReservation {
  id: string;
  branchId: string;
  reservationNumber: string;
}

export interface PartySnackDeductionSnack {
  id: string;
  productVariantId: string;
  quantity: string;
  nameSnapshot: string;
}

export type PartySnackDeductionErrorCode = 'inventory_location_not_found' | 'insufficient_inventory';

export class PartySnackDeductionError extends Error {
  public constructor(
    public readonly code: PartySnackDeductionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PartySnackDeductionError';
  }
}

const QUANTITY_SCALE = 1_000_000n; // numeric(19,6) — matches inventory_balances exactly.

function decimalUnits(value: string): bigint {
  const [whole = '', fraction = ''] = value.split('.');
  const wholeDigits = whole.length === 0 ? '0' : whole;
  const fractionDigits = fraction.padEnd(6, '0').slice(0, 6);
  return BigInt(wholeDigits) * QUANTITY_SCALE + BigInt(fractionDigits.length === 0 ? '0' : fractionDigits);
}
function formatDecimal(units: bigint): string {
  const negative = units < 0n;
  const magnitude = negative ? -units : units;
  const whole = magnitude / QUANTITY_SCALE;
  const fraction = (magnitude % QUANTITY_SCALE).toString().padStart(6, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fraction}`;
}

interface QueryResult<T> {
  rows: T[];
}
function result<T>(value: unknown): QueryResult<T> {
  return value as QueryResult<T>;
}

export async function postPartySnackDeduction(
  client: PartySnackDeductionTransaction,
  context: PartySnackDeductionContext,
  reservation: PartySnackDeductionReservation,
  snack: PartySnackDeductionSnack,
): Promise<{ movementId: string }> {
  const variant = result<{ id: string; unit_of_measure_code: string }>(
    await client.query(
      `select id, unit_of_measure_code from product_variants where company_id=$1 and id=$2`,
      [context.companyId, snack.productVariantId],
    ),
  ).rows[0];
  if (variant === undefined)
    throw new PartySnackDeductionError(
      'inventory_location_not_found',
      'The snack has no valid inventory variant.',
    );

  const location = result<{ id: string }>(
    await client.query(
      `select id from inventory_locations
       where company_id=$1 and branch_id=$2 and is_default=true and status='active'`,
      [context.companyId, reservation.branchId],
    ),
  ).rows[0];
  if (location === undefined)
    throw new PartySnackDeductionError(
      'inventory_location_not_found',
      'No active default inventory location is configured for this branch.',
    );

  const movementId = randomUUID();
  const movementNumber = `IMV-${movementId.replaceAll('-', '').toLowerCase()}`;
  await client.query(
    `insert into inventory_movements
     (id,company_id,branch_id,movement_number,movement_type,status,reference_type,reference_id,
      source_document_number,version,occurred_at,posted_at,posted_by,created_by,created_at,updated_at)
     values ($1,$2,$3,$4,'issue','posted','party_reservation_snack',$5,$6,1,$7,$7,$8,$8,$7,$7)`,
    [
      movementId,
      context.companyId,
      reservation.branchId,
      movementNumber,
      snack.id,
      reservation.reservationNumber,
      context.timestamp,
      context.actorId,
    ],
  );

  const balance = result<{ id: string; quantity_on_hand: string; quantity_reserved: string; version: string }>(
    await client.query(
      `select id, quantity_on_hand::text, quantity_reserved::text, version::text
       from inventory_balances
       where company_id=$1 and branch_id=$2 and inventory_location_id=$3 and product_variant_id=$4
       for update`,
      [context.companyId, reservation.branchId, location.id, variant.id],
    ),
  ).rows[0];
  const onHand = balance === undefined ? 0n : decimalUnits(balance.quantity_on_hand);
  const reserved = balance === undefined ? 0n : decimalUnits(balance.quantity_reserved);
  const consumeUnits = decimalUnits(snack.quantity);
  const next = onHand - consumeUnits;
  if (balance === undefined || next < 0n || next < reserved)
    throw new PartySnackDeductionError(
      'insufficient_inventory',
      `Available inventory is insufficient for snack "${snack.nameSnapshot}".`,
    );

  await client.query(
    `update inventory_balances set quantity_on_hand=$2, version=version+1, last_movement_id=$3, updated_at=$4 where id=$1`,
    [balance.id, formatDecimal(next), movementId, context.timestamp],
  );
  await client.query(
    `insert into inventory_movement_lines
     (id,company_id,inventory_movement_id,line_number,product_variant_id,source_location_id,
      destination_location_id,quantity,unit_of_measure_code,base_quantity,created_at)
     values ($1,$2,$3,1,$4,$5,null,$6,$7,$6,$8)`,
    [
      randomUUID(),
      context.companyId,
      movementId,
      variant.id,
      location.id,
      snack.quantity,
      variant.unit_of_measure_code,
      context.timestamp,
    ],
  );

  await client.query(
    `insert into audit_log
     (id,company_id,actor_type,actor_id,action,entity_type,entity_id,correlation_id,metadata,occurred_at)
     values ($1,$2,'user',$3,'inventory_movement.posted','inventory_movement',$4,$5,$6::jsonb,$7)`,
    [
      randomUUID(),
      context.companyId,
      context.actorId,
      movementId,
      context.correlationId,
      JSON.stringify({
        movement_number: movementNumber,
        movement_type: 'issue',
        reference_type: 'party_reservation_snack',
        reference_id: snack.id,
      }),
      context.timestamp,
    ],
  );
  await client.query(
    `insert into outbox_events
     (event_id,company_id,branch_id,event_type,schema_version,aggregate_type,
      aggregate_id,aggregate_version,correlation_id,payload,occurred_at,available_at,created_at)
     values ($1,$2,$3,'inventory.movement.created',1,'inventory_movement',$4,1,$5,$6::jsonb,$7,$7,$7)`,
    [
      randomUUID(),
      context.companyId,
      reservation.branchId,
      movementId,
      context.correlationId,
      JSON.stringify({
        company_id: context.companyId,
        branch_id: reservation.branchId,
        movement_id: movementId,
        movement_number: movementNumber,
        movement_type: 'issue',
        status: 'posted',
        posted_at: context.timestamp.toISOString(),
        actor_id: context.actorId,
        correlation_id: context.correlationId,
        reference_type: 'party_reservation_snack',
        reference_id: snack.id,
      }),
      context.timestamp,
    ],
  );
  await client.query(
    `insert into outbox_events
     (event_id,company_id,branch_id,event_type,schema_version,aggregate_type,
      aggregate_id,aggregate_version,correlation_id,payload,occurred_at,available_at,created_at)
     values ($1,$2,$3,'inventory.stock.changed',1,'inventory_balance',$4,$5,$6,$7::jsonb,$8,$8,$8)`,
    [
      randomUUID(),
      context.companyId,
      reservation.branchId,
      balance.id,
      (BigInt(balance.version) + 1n).toString(),
      context.correlationId,
      JSON.stringify({
        company_id: context.companyId,
        branch_id: reservation.branchId,
        balance_id: balance.id,
        inventory_location_id: location.id,
        product_variant_id: variant.id,
        previous_quantity_on_hand: formatDecimal(onHand),
        delta_quantity_on_hand: formatDecimal(-consumeUnits),
        new_quantity_on_hand: formatDecimal(next),
        movement_id: movementId,
        movement_number: movementNumber,
        occurred_at: context.timestamp.toISOString(),
        correlation_id: context.correlationId,
      }),
      context.timestamp,
    ],
  );

  return { movementId };
}
