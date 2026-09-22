import { randomUUID } from 'node:crypto';

/**
 * TASK 14.3 Part A.5 (Calcetas/socks inventory) — the real, one-way stock
 * deduction the legacy's own `descontarCalcetasFiesta()` performed
 * against `DB.tienda` via `registrarKardex` (recovery doc Capability 11),
 * rebuilt against this platform's real inventory ledger. Deliberately the
 * same shape as `sale-consumption.ts`/`sale-return.ts` (module-level
 * function taking a bare `{query}` transaction client, not a class —
 * see those modules' own doc comments for the shared rationale): a
 * single-line `issue` movement, posted at the one authoritative moment
 * `PartyReservationsService.deductSock` decides to post it (only when
 * `productVariantId` is set AND `stockDeducted='pending'` — the caller's
 * own row lock on `party_reservation_socks` is what makes this
 * idempotent/guarded against a double-post, since no partial unique index
 * exists for this reference on `inventory_movements` — see that service
 * method's own doc comment).
 *
 * - **Movement type**: `issue` — CORE_DATA_MODEL §12's own generic
 *   "manually issued/written off" type (not `sale_consumption`, which is
 *   reserved for an actual completed Sale; not `return`, which is
 *   inbound). No party-specific movement type exists or is invented here.
 * - **Direction**: quantity is consumed (`source_location_id` set,
 *   `destination_location_id` null), the branch's own single active
 *   default `inventory_location` — the exact same resolution
 *   `sale-consumption.ts` uses.
 * - **Negative stock**: the same block-negative policy every other
 *   posting path in this codebase enforces (never invented fresh here).
 */

export interface PartySockDeductionTransaction {
  query(sql: string, values?: readonly unknown[]): Promise<unknown>;
}

export interface PartySockDeductionContext {
  companyId: string;
  actorId: string;
  correlationId: string;
  timestamp: Date;
}

export interface PartySockDeductionReservation {
  id: string;
  branchId: string;
  reservationNumber: string;
}

export interface PartySockDeductionSock {
  id: string;
  productVariantId: string;
  quantity: number;
  size: string;
}

export type PartySockDeductionErrorCode = 'inventory_location_not_found' | 'insufficient_inventory';

export class PartySockDeductionError extends Error {
  public constructor(
    public readonly code: PartySockDeductionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PartySockDeductionError';
  }
}

/** TASK 16.20A (Part 7-9) — a real, one-way-per-call, compensating
 * correction for an already-issued sock line: posts a DELTA-only
 * movement (never re-posts/edits/deletes the original `issue` movement,
 * which stays exactly as it was — Part 7's own "old movements remain
 * immutable" requirement). `deltaQuantity` is the caller's already-
 * computed `correctedQuantity - currentIssuedQuantity`:
 * - positive (upward correction, more was actually delivered than
 *   recorded) posts ANOTHER `issue` movement for the extra amount,
 *   subject to the exact same insufficient-inventory guard as the
 *   original deduction;
 * - negative (downward correction, less was actually delivered) posts
 *   a `return` movement (CORE_DATA_MODEL §12's own canonical "goods
 *   physically came back" type — the same one `sale-return.ts` uses,
 *   and for the identical reason: `reversal` requires
 *   `reversal_of_movement_id` and a uniqueness constraint permitting at
 *   most ONE reversal per original movement, which would make a SECOND
 *   later correction of the same sock line impossible; `return` carries
 *   the same real traceability — same `reference_type`/`reference_id`
 *   as the original `issue` — without that one-shot limitation), always
 *   restoring stock (never insufficiency-checked — stock can only go up
 *   on a return).
 * `PartyReservationsService.correctSock` is the only caller and is
 * responsible for computing `deltaQuantity` from a FRESH, row-locked
 * read of `issuedQuantity` (never a client-submitted delta) — that lock
 * is what makes a concurrent second correction serialize correctly and
 * a retried identical request naturally idempotent (delta recomputes to
 * `0` and this function is simply not called again — see that method's
 * own doc comment). */
export async function postPartySockCorrection(
  client: PartySockDeductionTransaction,
  context: PartySockDeductionContext,
  reservation: PartySockDeductionReservation,
  sock: { id: string; productVariantId: string; size: string },
  deltaQuantity: number,
): Promise<{ movementId: string }> {
  if (deltaQuantity === 0) throw new PartySockDeductionError('insufficient_inventory', 'There is nothing to correct.');
  const variant = result<{ id: string; unit_of_measure_code: string }>(
    await client.query(
      `select id, unit_of_measure_code from product_variants where company_id=$1 and id=$2`,
      [context.companyId, sock.productVariantId],
    ),
  ).rows[0];
  if (variant === undefined)
    throw new PartySockDeductionError('inventory_location_not_found', 'The sock size has no valid inventory variant.');

  const location = result<{ id: string }>(
    await client.query(
      `select id from inventory_locations
       where company_id=$1 and branch_id=$2 and is_default=true and status='active'`,
      [context.companyId, reservation.branchId],
    ),
  ).rows[0];
  if (location === undefined)
    throw new PartySockDeductionError(
      'inventory_location_not_found',
      'No active default inventory location is configured for this branch.',
    );

  const isReturn = deltaQuantity < 0;
  const movementType = isReturn ? 'return' : 'issue';
  const magnitudeUnits = decimalUnits(String(Math.abs(deltaQuantity)));

  const movementId = randomUUID();
  const movementNumber = `IMV-${movementId.replaceAll('-', '').toLowerCase()}`;
  await client.query(
    `insert into inventory_movements
     (id,company_id,branch_id,movement_number,movement_type,status,reference_type,reference_id,
      source_document_number,version,occurred_at,posted_at,posted_by,created_by,created_at,updated_at)
     values ($1,$2,$3,$4,$5,'posted','party_reservation_sock',$6,$7,1,$8,$8,$9,$9,$8,$8)`,
    [
      movementId,
      context.companyId,
      reservation.branchId,
      movementNumber,
      movementType,
      sock.id,
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
  const next = isReturn ? onHand + magnitudeUnits : onHand - magnitudeUnits;
  if (balance === undefined || (!isReturn && (next < 0n || next < reserved)))
    throw new PartySockDeductionError(
      'insufficient_inventory',
      `Available inventory is insufficient to correct sock size "${sock.size}".`,
    );

  await client.query(
    `update inventory_balances set quantity_on_hand=$2, version=version+1, last_movement_id=$3, updated_at=$4 where id=$1`,
    [balance.id, formatDecimal(next), movementId, context.timestamp],
  );
  await client.query(
    `insert into inventory_movement_lines
     (id,company_id,inventory_movement_id,line_number,product_variant_id,source_location_id,
      destination_location_id,quantity,unit_of_measure_code,base_quantity,created_at)
     values ($1,$2,$3,1,$4,$5,$6,$7,$8,$7,$9)`,
    [
      randomUUID(),
      context.companyId,
      movementId,
      variant.id,
      isReturn ? null : location.id,
      isReturn ? location.id : null,
      formatDecimal(magnitudeUnits),
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
        movement_type: movementType,
        reference_type: 'party_reservation_sock',
        reference_id: sock.id,
        correction_delta: String(deltaQuantity),
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
        movement_type: movementType,
        status: 'posted',
        posted_at: context.timestamp.toISOString(),
        actor_id: context.actorId,
        correlation_id: context.correlationId,
        reference_type: 'party_reservation_sock',
        reference_id: sock.id,
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
        delta_quantity_on_hand: formatDecimal(isReturn ? magnitudeUnits : -magnitudeUnits),
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

export async function postPartySockDeduction(
  client: PartySockDeductionTransaction,
  context: PartySockDeductionContext,
  reservation: PartySockDeductionReservation,
  sock: PartySockDeductionSock,
): Promise<{ movementId: string }> {
  const variant = result<{ id: string; unit_of_measure_code: string }>(
    await client.query(
      `select id, unit_of_measure_code from product_variants where company_id=$1 and id=$2`,
      [context.companyId, sock.productVariantId],
    ),
  ).rows[0];
  if (variant === undefined)
    throw new PartySockDeductionError('inventory_location_not_found', 'The sock size has no valid inventory variant.');

  const location = result<{ id: string }>(
    await client.query(
      `select id from inventory_locations
       where company_id=$1 and branch_id=$2 and is_default=true and status='active'`,
      [context.companyId, reservation.branchId],
    ),
  ).rows[0];
  if (location === undefined)
    throw new PartySockDeductionError(
      'inventory_location_not_found',
      'No active default inventory location is configured for this branch.',
    );

  const movementId = randomUUID();
  const movementNumber = `IMV-${movementId.replaceAll('-', '').toLowerCase()}`;
  await client.query(
    `insert into inventory_movements
     (id,company_id,branch_id,movement_number,movement_type,status,reference_type,reference_id,
      source_document_number,version,occurred_at,posted_at,posted_by,created_by,created_at,updated_at)
     values ($1,$2,$3,$4,'issue','posted','party_reservation_sock',$5,$6,1,$7,$7,$8,$8,$7,$7)`,
    [
      movementId,
      context.companyId,
      reservation.branchId,
      movementNumber,
      sock.id,
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
  const consumeUnits = decimalUnits(String(sock.quantity));
  const next = onHand - consumeUnits;
  if (balance === undefined || next < 0n || next < reserved)
    throw new PartySockDeductionError(
      'insufficient_inventory',
      `Available inventory is insufficient for sock size "${sock.size}".`,
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
      String(sock.quantity),
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
        reference_type: 'party_reservation_sock',
        reference_id: sock.id,
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
        reference_type: 'party_reservation_sock',
        reference_id: sock.id,
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
