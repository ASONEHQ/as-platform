import { randomUUID } from 'node:crypto';

/**
 * TASK 12.8 — Part H: posts exactly one `return` inventory movement
 * restoring the stock-tracked lines of a completed refund, at the one
 * authoritative moment a refund actually completes — see
 * `RefundsService.completeRefund`, the only caller, which invokes this
 * *inside its own transaction*.
 *
 * Deliberately the mirror image of `sale-consumption.ts`'s
 * `postSaleConsumption` (same location resolution, same balance-locking
 * discipline, same audit/outbox shape) — see that module's own doc
 * comment for the shared rationale, and ADR-0015 for what's different
 * here specifically:
 *
 * - **Movement type**: `return` — CORE_DATA_MODEL §12's own canonical
 *   type for "goods physically came back," not `reversal`. `reversal`
 *   requires `reversal_of_movement_id` (a hard, exact-equality check
 *   constraint), and `inventory_movements_reversal_of_posted_uq` permits
 *   at most *one* reversal ever against a given original movement —
 *   which would make a second, independent, later partial return of the
 *   same multi-line `sale_consumption` movement impossible. `return` +
 *   `reference_type='refund'`/`reference_id=refund.id` carries the same
 *   traceability without that limitation (each refund gets its own new
 *   movement, however many partial returns a sale eventually has).
 * - **Direction**: quantity is *added* back (`destination_location_id`
 *   set, `source_location_id` null) — the exact inverse of consumption's
 *   `source_location_id` set, `destination_location_id` null — and never
 *   throws for "insufficient inventory" (stock can only go up here).
 * - **Idempotency**: `inventory_movements_refund_reference_uq` (Part
 *   F/L) — a second `return` movement for the same refund is a
 *   constraint violation, mirroring `inventory_movements_sale_reference_uq`
 *   exactly.
 */

export interface SaleReturnTransaction {
  query(sql: string, values?: readonly unknown[]): Promise<unknown>;
}

export interface SaleReturnContext {
  companyId: string;
  actorId: string;
  correlationId: string;
  timestamp: Date;
}

export interface SaleReturnRefund {
  id: string;
  branchId: string;
  refundNumber: string;
}

/** One returned line — a subset of `RefundItemRow` plus the variant
 * identity/name it needs, deliberately not the whole row (this module
 * never depends on the refunds module's types, matching
 * `sale-consumption.ts`'s own "no cross-module type import" discipline). */
export interface SaleReturnItem {
  productVariantId: string | null;
  quantity: string;
  nameSnapshot: string;
}

export type SaleReturnErrorCode = 'inventory_location_not_found';

export class SaleInventoryReturnError extends Error {
  public constructor(
    public readonly code: SaleReturnErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SaleInventoryReturnError';
  }
}

const QUANTITY_SCALE = 1_000_000n; // numeric(19,6) — matches sale_items.quantity/inventory_balances.

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

interface VariantLookup {
  id: string;
  unit_of_measure_code: string;
}

/**
 * Returns `{ posted: false, movementId: null }` — a legitimate outcome,
 * not an error — when [items] has no stock-tracked variant lines at all
 * (every item was a non-stock admission/service/membership, or the
 * refund's own disposition logic already excluded it). Throws
 * `SaleInventoryReturnError` only for a genuine posting problem (no
 * active default location for the branch) — the caller's whole refund
 * transaction rolls back, exactly like `postSaleConsumption`'s own
 * documented trade-off.
 */
export async function postSaleReturn(
  client: SaleReturnTransaction,
  context: SaleReturnContext,
  refund: SaleReturnRefund,
  items: readonly SaleReturnItem[],
): Promise<{ posted: boolean; movementId: string | null }> {
  const variantIds = [
    ...new Set(items.map((item) => item.productVariantId).filter((id): id is string => id !== null)),
  ];
  if (variantIds.length === 0) return { posted: false, movementId: null };

  const variantRows = result<VariantLookup>(
    await client.query(
      `select id, unit_of_measure_code
       from product_variants
       where company_id=$1 and id=any($2::uuid[])`,
      [context.companyId, variantIds],
    ),
  ).rows;
  const variantById = new Map(variantRows.map((row) => [row.id, row]));

  const restockLines = items
    .filter((item): item is SaleReturnItem & { productVariantId: string } => item.productVariantId !== null)
    .map((item) => ({ item, variant: variantById.get(item.productVariantId) }))
    .filter((entry): entry is { item: SaleReturnItem & { productVariantId: string }; variant: VariantLookup } =>
      entry.variant !== undefined,
    );
  if (restockLines.length === 0) return { posted: false, movementId: null };

  const location = result<{ id: string }>(
    await client.query(
      `select id from inventory_locations
       where company_id=$1 and branch_id=$2 and is_default=true and status='active'`,
      [context.companyId, refund.branchId],
    ),
  ).rows[0];
  if (location === undefined)
    throw new SaleInventoryReturnError(
      'inventory_location_not_found',
      'No active default inventory location is configured for this branch.',
    );

  const movementId = randomUUID();
  const movementNumber = `IMV-${movementId.replaceAll('-', '').toLowerCase()}`;
  await client.query(
    `insert into inventory_movements
     (id,company_id,branch_id,movement_number,movement_type,status,reference_type,reference_id,
      source_document_number,version,occurred_at,posted_at,posted_by,created_by,created_at,updated_at)
     values ($1,$2,$3,$4,'return','posted','refund',$5,$6,1,$7,$7,$8,$8,$7,$7)`,
    [
      movementId,
      context.companyId,
      refund.branchId,
      movementNumber,
      refund.id,
      refund.refundNumber,
      context.timestamp,
      context.actorId,
    ],
  );

  const stockChanges: {
    variantId: string;
    previous: bigint;
    delta: bigint;
    next: bigint;
    balanceId: string;
    balanceVersion: bigint;
  }[] = [];
  let lineNumber = 0;
  for (const { item, variant } of restockLines) {
    lineNumber += 1;
    const balance = result<{
      id: string;
      quantity_on_hand: string;
      version: string;
    }>(
      await client.query(
        `select id, quantity_on_hand::text, version::text
         from inventory_balances
         where company_id=$1 and branch_id=$2 and inventory_location_id=$3 and product_variant_id=$4
         for update`,
        [context.companyId, refund.branchId, location.id, variant.id],
      ),
    ).rows[0];
    const restoreUnits = decimalUnits(item.quantity);
    if (balance === undefined) {
      // No prior balance row for this variant at this location (should be
      // unreachable in practice — the original sale's own consumption
      // would have created one — but handled explicitly rather than
      // silently no-op'd): create it starting from the restored quantity.
      const balanceId = randomUUID();
      await client.query(
        `insert into inventory_balances
         (id,company_id,branch_id,inventory_location_id,product_variant_id,quantity_on_hand,
          quantity_reserved,quantity_in_transit,average_unit_cost,version,last_movement_id,created_at,updated_at)
         values ($1,$2,$3,$4,$5,$6,0,0,0,1,$7,$8,$8)`,
        [
          balanceId,
          context.companyId,
          refund.branchId,
          location.id,
          variant.id,
          item.quantity,
          movementId,
          context.timestamp,
        ],
      );
      stockChanges.push({
        variantId: variant.id,
        previous: 0n,
        delta: restoreUnits,
        next: restoreUnits,
        balanceId,
        balanceVersion: 1n,
      });
    } else {
      const onHand = decimalUnits(balance.quantity_on_hand);
      const next = onHand + restoreUnits;
      await client.query(
        `update inventory_balances set quantity_on_hand=$2, version=version+1, last_movement_id=$3, updated_at=$4
         where id=$1`,
        [balance.id, formatDecimal(next), movementId, context.timestamp],
      );
      stockChanges.push({
        variantId: variant.id,
        previous: onHand,
        delta: restoreUnits,
        next,
        balanceId: balance.id,
        balanceVersion: BigInt(balance.version) + 1n,
      });
    }
    await client.query(
      `insert into inventory_movement_lines
       (id,company_id,inventory_movement_id,line_number,product_variant_id,source_location_id,
        destination_location_id,quantity,unit_of_measure_code,base_quantity,created_at)
       values ($1,$2,$3,$4,$5,null,$6,$7,$8,$7,$9)`,
      [
        randomUUID(),
        context.companyId,
        movementId,
        lineNumber,
        variant.id,
        location.id,
        item.quantity,
        variant.unit_of_measure_code,
        context.timestamp,
      ],
    );
  }

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
        movement_type: 'return',
        reference_type: 'refund',
        reference_id: refund.id,
        line_count: restockLines.length,
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
      refund.branchId,
      movementId,
      context.correlationId,
      JSON.stringify({
        company_id: context.companyId,
        branch_id: refund.branchId,
        movement_id: movementId,
        movement_number: movementNumber,
        movement_type: 'return',
        status: 'posted',
        posted_at: context.timestamp.toISOString(),
        actor_id: context.actorId,
        correlation_id: context.correlationId,
        line_count: restockLines.length,
        reference_type: 'refund',
        reference_id: refund.id,
      }),
      context.timestamp,
    ],
  );
  for (const change of stockChanges) {
    await client.query(
      `insert into outbox_events
       (event_id,company_id,branch_id,event_type,schema_version,aggregate_type,
        aggregate_id,aggregate_version,correlation_id,payload,occurred_at,available_at,created_at)
       values ($1,$2,$3,'inventory.stock.changed',1,'inventory_balance',$4,$5,$6,$7::jsonb,$8,$8,$8)`,
      [
        randomUUID(),
        context.companyId,
        refund.branchId,
        change.balanceId,
        change.balanceVersion.toString(),
        context.correlationId,
        JSON.stringify({
          company_id: context.companyId,
          branch_id: refund.branchId,
          balance_id: change.balanceId,
          inventory_location_id: location.id,
          product_variant_id: change.variantId,
          previous_quantity_on_hand: formatDecimal(change.previous),
          delta_quantity_on_hand: formatDecimal(change.delta),
          new_quantity_on_hand: formatDecimal(change.next),
          movement_id: movementId,
          movement_number: movementNumber,
          occurred_at: context.timestamp.toISOString(),
          correlation_id: context.correlationId,
        }),
        context.timestamp,
      ],
    );
  }

  return { posted: true, movementId };
}
