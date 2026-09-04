import { randomUUID } from 'node:crypto';

/**
 * TASK 12.6 — Part A: posts exactly one `sale_consumption` inventory
 * movement for a Sale's stock-tracked lines, at the one authoritative
 * moment a Sale actually becomes `completed` — see
 * `SalesRepository.trySettleSale`, the only caller, which invokes this
 * *inside its own transaction*, immediately after (and only when) it has
 * just transitioned the Sale to `completed` for the first time.
 *
 * Design decisions (see docs/adr/ADR-0013-sale-inventory-posting.md for
 * the full rationale):
 *
 * - **A1 (posting moment)**: inside the Sale-settlement transaction, not
 *   an outbox-driven async coordinator — no outbox *consumer* exists
 *   anywhere in this codebase yet (`apps/worker` is an intentionally
 *   empty skeleton: "no processing is configured"), so building one would
 *   be new infrastructure, not reuse of an existing pattern. The
 *   settlement transaction is already the established boundary for every
 *   other "Sale becomes completed" side effect (`sale.completed`
 *   audit+outbox itself is written the same way, synchronously, in the
 *   same transaction).
 * - **A2 (movement type)**: a new `sale_consumption` movement type — no
 *   sale-specific type already existed; `issue` is too generic to let a
 *   manager separate "sold" from "manually issued/written off" later.
 * - **A3 (location)**: the branch's own single active default
 *   `inventory_location` (`is_default=true`) — proven, not assumed: every
 *   one of the 6 seeded branches has exactly one. If a branch genuinely
 *   has none, this throws rather than guessing one.
 * - **A4 (variant identity)**: `sale_items.product_variant_id`, resolved
 *   and frozen at sale-creation time (see `sales.repository.ts`'s
 *   `resolveProductLines`), never re-derived from `product_id` at posting
 *   time.
 * - **A5 (negative stock)**: preserves the exact existing policy already
 *   enforced by `InventoryPostingService.post()` — on-hand may never go
 *   below zero or below the reserved quantity. Extended uniformly here
 *   rather than carving out a sales-specific exception (seller inventing
 *   new accounting behavior is explicitly out of scope) — a stock
 *   conflict throws and rolls back the *entire* settlement transaction,
 *   including the payment capture. This is a deliberate, documented
 *   trade-off (see the ADR); it does not invent an alternative.
 * - **A6 (idempotency)**: two independent guarantees. Application-level —
 *   `trySettleSale` only calls this once, exactly when `settled` first
 *   becomes `true` (already idempotent by construction: a sale outside
 *   `pending_payment` is left untouched on any retry). Database-level —
 *   `inventory_movements_sale_reference_uq`, a partial unique index on
 *   `(company_id, reference_id) where reference_type='sale'`, makes a
 *   second `sale_consumption` movement for the same sale a constraint
 *   violation even if the application guard were ever bypassed.
 * - **A7 (audit/outbox)**: reuses the exact canonical event names
 *   `inventory.movement.created`/`inventory.stock.changed` already
 *   established by `InventoryPostingRepository`/`docs/REALTIME_EVENTS.md`
 *   ("TASK 09.4 ... the single canonical stock-change fact") — no new
 *   event type. `movement_type: 'sale_consumption'` in the payload is
 *   what distinguishes this from any other posted movement.
 */

export interface SaleConsumptionTransaction {
  query(sql: string, values?: readonly unknown[]): Promise<unknown>;
}

export interface SaleConsumptionContext {
  companyId: string;
  actorId: string;
  correlationId: string;
  timestamp: Date;
}

export interface SaleConsumptionSale {
  id: string;
  branchId: string;
  saleNumber: string;
}

/** The minimum a sale line must carry for posting — a subset of
 * `SaleItemRow`, deliberately not the whole row, so this module never
 * depends on sales-module types. */
export interface SaleConsumptionItem {
  productVariantId: string | null;
  quantity: string;
  nameSnapshot: string;
}

export type SaleConsumptionErrorCode = 'inventory_location_not_found' | 'insufficient_inventory';

export class SaleInventoryPostingError extends Error {
  public constructor(
    public readonly code: SaleConsumptionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SaleInventoryPostingError';
  }
}

const QUANTITY_SCALE = 1_000_000n; // numeric(19,6) — matches sale_items.quantity and inventory_balances exactly.

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
  tracks_inventory: boolean;
  unit_of_measure_code: string;
}

/**
 * Returns `{ posted: false, movementId: null }` (a legitimate, expected
 * outcome — not an error) when the Sale has no stock-tracked lines at
 * all: no variant identity, a retired/deleted variant, or a variant that
 * simply does not track inventory (admissions, services, memberships).
 * Throws `SaleInventoryPostingError` — which rolls back the caller's
 * whole transaction — only for a genuine posting problem (missing
 * location, insufficient stock); see this module's own doc comment for
 * why that trade-off was chosen deliberately rather than invented ad hoc.
 */
export async function postSaleConsumption(
  client: SaleConsumptionTransaction,
  context: SaleConsumptionContext,
  sale: SaleConsumptionSale,
  items: readonly SaleConsumptionItem[],
): Promise<{ posted: boolean; movementId: string | null }> {
  const variantIds = [
    ...new Set(
      items
        .map((item) => item.productVariantId)
        .filter((id): id is string => id !== null),
    ),
  ];
  if (variantIds.length === 0) return { posted: false, movementId: null };

  const variantRows = result<VariantLookup>(
    await client.query(
      `select id, tracks_inventory, unit_of_measure_code
       from product_variants
       where company_id=$1 and id=any($2::uuid[])`,
      [context.companyId, variantIds],
    ),
  ).rows;
  const variantById = new Map(variantRows.map((row) => [row.id, row]));

  const trackedLines = items
    .filter(
      (item): item is SaleConsumptionItem & { productVariantId: string } =>
        item.productVariantId !== null,
    )
    .map((item) => ({ item, variant: variantById.get(item.productVariantId) }))
    .filter(
      (
        entry,
      ): entry is {
        item: SaleConsumptionItem & { productVariantId: string };
        variant: VariantLookup;
      } => entry.variant?.tracks_inventory === true,
    );
  if (trackedLines.length === 0) return { posted: false, movementId: null };

  const location = result<{ id: string }>(
    await client.query(
      `select id from inventory_locations
       where company_id=$1 and branch_id=$2 and is_default=true and status='active'`,
      [context.companyId, sale.branchId],
    ),
  ).rows[0];
  if (location === undefined)
    throw new SaleInventoryPostingError(
      'inventory_location_not_found',
      'No active default inventory location is configured for this branch.',
    );

  const movementId = randomUUID();
  const movementNumber = `IMV-${movementId.replaceAll('-', '').toLowerCase()}`;
  await client.query(
    `insert into inventory_movements
     (id,company_id,branch_id,movement_number,movement_type,status,reference_type,reference_id,
      source_document_number,version,occurred_at,posted_at,posted_by,created_by,created_at,updated_at)
     values ($1,$2,$3,$4,'sale_consumption','posted','sale',$5,$6,1,$7,$7,$8,$8,$7,$7)`,
    [
      movementId,
      context.companyId,
      sale.branchId,
      movementNumber,
      sale.id,
      sale.saleNumber,
      context.timestamp,
      context.actorId,
    ],
  );

  const stockChanges: { variantId: string; previous: bigint; delta: bigint; next: bigint; balanceId: string; balanceVersion: bigint }[] = [];
  let lineNumber = 0;
  for (const { item, variant } of trackedLines) {
    lineNumber += 1;
    const balance = result<{
      id: string;
      quantity_on_hand: string;
      quantity_reserved: string;
      version: string;
    }>(
      await client.query(
        `select id, quantity_on_hand::text, quantity_reserved::text, version::text
         from inventory_balances
         where company_id=$1 and branch_id=$2 and inventory_location_id=$3 and product_variant_id=$4
         for update`,
        [context.companyId, sale.branchId, location.id, variant.id],
      ),
    ).rows[0];
    const onHand = balance === undefined ? 0n : decimalUnits(balance.quantity_on_hand);
    const reserved = balance === undefined ? 0n : decimalUnits(balance.quantity_reserved);
    const consumeUnits = decimalUnits(item.quantity);
    const next = onHand - consumeUnits;
    // A6/A5: preserves the exact same block-negative policy
    // `InventoryPostingService.post()` already enforces for every other
    // movement type — never invented fresh for sales.
    if (next < 0n || next < reserved)
      throw new SaleInventoryPostingError(
        'insufficient_inventory',
        `Available inventory is insufficient for "${item.nameSnapshot}".`,
      );
    if (balance === undefined) {
      // Unreachable in practice: onHand defaults to 0, so any positive
      // consumeUnits already throws above. Kept explicit rather than
      // silently no-op'd, so a future refactor can't accidentally let a
      // missing balance row through as a free pass.
      throw new SaleInventoryPostingError(
        'insufficient_inventory',
        `Available inventory is insufficient for "${item.nameSnapshot}".`,
      );
    }
    await client.query(
      `update inventory_balances set quantity_on_hand=$2, version=version+1, last_movement_id=$3, updated_at=$4
       where id=$1`,
      [balance.id, formatDecimal(next), movementId, context.timestamp],
    );
    await client.query(
      `insert into inventory_movement_lines
       (id,company_id,inventory_movement_id,line_number,product_variant_id,source_location_id,
        destination_location_id,quantity,unit_of_measure_code,base_quantity,created_at)
       values ($1,$2,$3,$4,$5,$6,null,$7,$8,$7,$9)`,
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
    stockChanges.push({
      variantId: variant.id,
      previous: onHand,
      delta: -consumeUnits,
      next,
      balanceId: balance.id,
      balanceVersion: BigInt(balance.version) + 1n,
    });
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
        movement_type: 'sale_consumption',
        reference_type: 'sale',
        reference_id: sale.id,
        line_count: trackedLines.length,
      }),
      context.timestamp,
    ],
  );

  // A7: the exact same canonical outbox events every other posted
  // movement emits — see this module's own doc comment.
  await client.query(
    `insert into outbox_events
     (event_id,company_id,branch_id,event_type,schema_version,aggregate_type,
      aggregate_id,aggregate_version,correlation_id,payload,occurred_at,available_at,created_at)
     values ($1,$2,$3,'inventory.movement.created',1,'inventory_movement',$4,1,$5,$6::jsonb,$7,$7,$7)`,
    [
      randomUUID(),
      context.companyId,
      sale.branchId,
      movementId,
      context.correlationId,
      JSON.stringify({
        company_id: context.companyId,
        branch_id: sale.branchId,
        movement_id: movementId,
        movement_number: movementNumber,
        movement_type: 'sale_consumption',
        status: 'posted',
        posted_at: context.timestamp.toISOString(),
        actor_id: context.actorId,
        correlation_id: context.correlationId,
        line_count: trackedLines.length,
        reference_type: 'sale',
        reference_id: sale.id,
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
        sale.branchId,
        change.balanceId,
        change.balanceVersion.toString(),
        context.correlationId,
        JSON.stringify({
          company_id: context.companyId,
          branch_id: sale.branchId,
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
