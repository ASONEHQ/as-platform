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
