import { randomUUID } from 'node:crypto';

import type { DatabaseClient } from '@asone/database';

import {
  PurchaseOrderError,
  type PurchaseOrderListRow,
  type PurchaseOrderLineRow,
  type PurchaseOrderMutationContext,
  type PurchaseOrderMovementLineSummary,
  type PurchaseOrderMovementSummary,
  type PurchaseOrderRow,
} from './purchase-orders.types.js';

/**
 * TASK 12.2 — deliberately its OWN small, independent copy of the
 * `transaction`/`idempotent`/`auditAndPublish` boilerplate, exactly like
 * `PurchasingRepository`/`SuppliersRepository` each keep their own — see
 * `SuppliersRepository`'s own doc comment: "this codebase's established
 * (non-)convention: every module keeps its own small copy, never a
 * shared one." `PurchasingRepository.auditAndPublish`'s own `resourceType`
 * parameter is narrowly typed to the literal `'direct_purchase'`, so it
 * cannot be reused as-is for `'purchase_order'` without either widening
 * that literal (touching an already-shipped, unrelated module) or
 * duplicating this same small amount of plumbing — this file follows the
 * codebase's own already-established precedent and duplicates it.
 */
export interface PurchaseOrderTransaction {
  query(sql: string, values?: readonly unknown[]): Promise<unknown>;
}

interface QueryResult<T> {
  rows: T[];
}
function result<T>(value: unknown): QueryResult<T> {
  return value as QueryResult<T>;
}
function constraint(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'constraint' in error
    ? String((error as { constraint?: unknown }).constraint)
    : undefined;
}
function jsonValue(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

const PURCHASE_ORDER_COLUMNS =
  'id,company_id,branch_id,order_number,status,supplier_name,supplier_id,order_date,expected_date,currency_code,total_cost,notes,submitted_at,submitted_by,received_at,received_by,cancelled_at,cancelled_by,receipt_movement_id,version,created_by,created_at,updated_at';
const PURCHASE_ORDER_LINE_COLUMNS =
  'id,line_number,product_variant_id,product_name_snapshot,variant_name_snapshot,sku_snapshot,ordered_quantity,received_quantity,unit_cost,line_total,notes';

interface PurchaseOrderDb {
  id: string;
  company_id: string;
  branch_id: string;
  order_number: string;
  status: string;
  supplier_name: string | null;
  supplier_id: string | null;
  order_date: string;
  expected_date: string | null;
  currency_code: string;
  total_cost: string;
  notes: string | null;
  submitted_at: Date | string | null;
  submitted_by: string | null;
  received_at: Date | string | null;
  received_by: string | null;
  cancelled_at: Date | string | null;
  cancelled_by: string | null;
  receipt_movement_id: string | null;
  version: string;
  created_by: string;
  created_at: Date | string;
  updated_at: Date | string;
}
interface PurchaseOrderLineDb {
  id: string;
  line_number: number;
  product_variant_id: string;
  product_name_snapshot: string;
  variant_name_snapshot: string | null;
  sku_snapshot: string | null;
  ordered_quantity: string;
  received_quantity: string;
  unit_cost: string;
  line_total: string;
  notes: string | null;
}
export interface PurchaseOrderVariantLookup {
  id: string;
  tracksInventory: boolean;
  productNameSnapshot: string;
  variantNameSnapshot: string | null;
  skuSnapshot: string;
}
interface IdempotencyDb {
  request_hash: string;
  response_body: unknown;
}

function purchaseOrderLine(row: PurchaseOrderLineDb): PurchaseOrderLineRow {
  return {
    id: row.id,
    lineNumber: row.line_number,
    productVariantId: row.product_variant_id,
    productNameSnapshot: row.product_name_snapshot,
    variantNameSnapshot: row.variant_name_snapshot,
    skuSnapshot: row.sku_snapshot,
    orderedQuantity: row.ordered_quantity,
    receivedQuantity: row.received_quantity,
    unitCost: row.unit_cost,
    lineTotal: row.line_total,
    notes: row.notes,
  };
}

function purchaseOrder(row: PurchaseOrderDb, lines: readonly PurchaseOrderLineRow[]): PurchaseOrderRow {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    orderNumber: row.order_number,
    status: row.status,
    supplierName: row.supplier_name,
    supplierId: row.supplier_id,
    orderDate: row.order_date,
    expectedDate: row.expected_date,
    currencyCode: row.currency_code,
    totalCost: row.total_cost,
    notes: row.notes,
    submittedAt: row.submitted_at === null ? null : new Date(row.submitted_at),
    submittedBy: row.submitted_by,
    receivedAt: row.received_at === null ? null : new Date(row.received_at),
    receivedBy: row.received_by,
    cancelledAt: row.cancelled_at === null ? null : new Date(row.cancelled_at),
    cancelledBy: row.cancelled_by,
    receiptMovementId: row.receipt_movement_id,
    version: BigInt(row.version),
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    lines,
  };
}

export interface InsertPurchaseOrderLineInput {
  productVariantId: string;
  productNameSnapshot: string;
  variantNameSnapshot: string | null;
  skuSnapshot: string | null;
  orderedQuantity: string;
  unitCost: string;
  lineTotal: string;
  notes: string | null;
}

export interface InsertPurchaseOrderInput {
  id: string;
  companyId: string;
  branchId: string;
  orderNumber: string;
  supplierName: string | null;
  supplierId: string | null;
  orderDate: string;
  expectedDate: string | null;
  currencyCode: string;
  totalCost: string;
  notes: string | null;
  createdBy: string;
  timestamp: Date;
  lines: readonly InsertPurchaseOrderLineInput[];
}

export interface ReceivePurchaseOrderLineUpdate {
  purchaseOrderLineId: string;
  receivedQuantity: string;
}

export class PurchaseOrdersRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async transaction<T>(callback: (client: PurchaseOrderTransaction) => Promise<T>): Promise<T> {
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      const value = await callback(client);
      await client.query('commit');
      return value;
    } catch (error) {
      await client.query('rollback');
      throw this.mapDatabaseError(error);
    } finally {
      client.release();
    }
  }

  /** Same shape as `PurchasingRepository.idempotent`/`SuppliersRepository.
   * idempotent` — see this file's own top-of-file doc comment for why this
   * is its own independent copy rather than a shared one. */
  public async idempotent<T>(
    client: PurchaseOrderTransaction,
    context: PurchaseOrderMutationContext,
    operation: string,
    key: string,
    requestHash: string,
    resourceType: string,
    decode: (value: unknown) => T,
    create: () => Promise<T & { id: string }>,
  ): Promise<{ value: T; replayed: boolean }> {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
      `${context.companyId}:${operation}:${key}`,
    ]);
    const existing = result<IdempotencyDb>(
      await client.query(
        `select request_hash,response_body from idempotency_keys
         where company_id=$1 and operation=$2 and key=$3`,
        [context.companyId, operation, key],
      ),
    ).rows[0];
    if (existing !== undefined) {
      if (existing.request_hash !== requestHash || existing.response_body === null)
        throw new PurchaseOrderError('idempotency_conflict', 'The idempotency key was used with another request.');
      return { value: decode(existing.response_body), replayed: true };
    }
    const id = randomUUID();
    await client.query(
      `insert into idempotency_keys
       (id,company_id,key,operation,request_hash,expires_at,created_at)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        id,
        context.companyId,
        key,
        operation,
        requestHash,
        new Date(context.timestamp.getTime() + 86_400_000),
        context.timestamp,
      ],
    );
    const value = await create();
    await client.query(
      `update idempotency_keys set response_status=201,response_body=$2::jsonb,
       resource_type=$3,resource_id=$4,completed_at=$5 where id=$1`,
      [id, JSON.stringify(value, jsonValue), resourceType, value.id, context.timestamp],
    );
    return { value, replayed: false };
  }

  public async auditAndPublish(
    client: PurchaseOrderTransaction,
    context: PurchaseOrderMutationContext,
    input: {
      action: string;
      resourceType: 'purchase_order';
      resourceId: string;
      eventType: string;
      branchId: string;
      payload: Readonly<Record<string, unknown>>;
    },
  ): Promise<void> {
    await client.query(
      `insert into audit_log
       (id,company_id,actor_type,actor_id,action,entity_type,entity_id,request_id,correlation_id,metadata,occurred_at)
       values ($1,$2,'user',$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
      [
        randomUUID(),
        context.companyId,
        context.actorId,
        input.action,
        input.resourceType,
        input.resourceId,
        context.requestId,
        context.correlationId,
        JSON.stringify(input.payload),
        context.timestamp,
      ],
    );
    await client.query(
      `insert into outbox_events
       (event_id,company_id,branch_id,event_type,schema_version,aggregate_type,aggregate_id,aggregate_version,
        correlation_id,payload,occurred_at,available_at,created_at)
       values ($1,$2,$3,$4,1,$5,$6,1,$7,$8::jsonb,$9,$9,$9)`,
      [
        randomUUID(),
        context.companyId,
        input.branchId,
        input.eventType,
        input.resourceType,
        input.resourceId,
        context.correlationId,
        JSON.stringify(input.payload),
        context.timestamp,
      ],
    );
  }

  public async insertPurchaseOrder(
    client: PurchaseOrderTransaction,
    input: InsertPurchaseOrderInput,
  ): Promise<PurchaseOrderRow> {
    const row = result<PurchaseOrderDb>(
      await client.query(
        `insert into purchase_orders
         (id,company_id,branch_id,order_number,status,supplier_name,supplier_id,order_date,expected_date,
          currency_code,total_cost,notes,created_by,created_at,updated_at)
         values ($1,$2,$3,$4,'draft',$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
         returning ${PURCHASE_ORDER_COLUMNS}`,
        [
          input.id,
          input.companyId,
          input.branchId,
          input.orderNumber,
          input.supplierName,
          input.supplierId,
          input.orderDate,
          input.expectedDate,
          input.currencyCode,
          input.totalCost,
          input.notes,
          input.createdBy,
          input.timestamp,
        ],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Purchase order insertion did not return a row.');

    const lines: PurchaseOrderLineRow[] = [];
    for (const [index, line] of input.lines.entries()) {
      const lineRow = result<PurchaseOrderLineDb>(
        await client.query(
          `insert into purchase_order_lines
           (id,company_id,purchase_order_id,line_number,product_variant_id,product_name_snapshot,
            variant_name_snapshot,sku_snapshot,ordered_quantity,received_quantity,unit_cost,line_total,
            notes,created_at,updated_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10,$11,$12,$13,$13)
           returning ${PURCHASE_ORDER_LINE_COLUMNS}`,
          [
            randomUUID(),
            input.companyId,
            input.id,
            index + 1,
            line.productVariantId,
            line.productNameSnapshot,
            line.variantNameSnapshot,
            line.skuSnapshot,
            line.orderedQuantity,
            line.unitCost,
            line.lineTotal,
            line.notes,
            input.timestamp,
          ],
        ),
      ).rows[0];
      if (lineRow === undefined) throw new Error('Purchase order line insertion did not return a row.');
      lines.push(purchaseOrderLine(lineRow));
    }
    return purchaseOrder(row, lines);
  }

  public async purchaseOrder(
    companyId: string,
    branchIds: readonly string[],
    id: string,
  ): Promise<PurchaseOrderRow | null> {
    return this.purchaseOrderVia(this.database.pool, companyId, branchIds, id);
  }

  /** Creation-time variant lookup — lets `PurchaseOrdersService.
   * createPurchaseOrder` reject a nonexistent or non-tracked variant
   * outright when a PO is first drafted (distinct `purchase_order_
   * product_variant_not_found`/`purchase_order_non_tracked_variant`
   * codes), rather than only discovering the problem much later at
   * receive time the way `postPurchaseOrderReceipt` necessarily does (it
   * only ever reports one merged code, mirroring `postDirectPurchaseReceipt`
   * exactly — see that file's own doc comment). */
  /** Also resolves the current product/variant display identity in the
   * SAME query (never a second round-trip) — the caller freezes it onto
   * the new `purchase_order_lines` row as `product_name_snapshot`/
   * `variant_name_snapshot`/`sku_snapshot` at creation time (see
   * `PurchaseOrdersService.createPurchaseOrder`'s own doc comment). */
  public async productVariant(companyId: string, id: string): Promise<PurchaseOrderVariantLookup | null> {
    const row = result<{
      id: string;
      tracks_inventory: boolean;
      product_name: string;
      variant_name: string | null;
      sku: string;
    }>(
      await this.database.pool.query(
        `select pv.id, pv.tracks_inventory, pv.name as variant_name, pv.sku, p.name as product_name
         from product_variants pv
         join products p on p.company_id = pv.company_id and p.id = pv.product_id
         where pv.company_id=$1 and pv.id=$2`,
        [companyId, id],
      ),
    ).rows[0];
    return row === undefined
      ? null
      : {
          id: row.id,
          tracksInventory: row.tracks_inventory,
          productNameSnapshot: row.product_name,
          variantNameSnapshot: row.variant_name,
          skuSnapshot: row.sku,
        };
  }

  /** Locks the `purchase_orders` row `FOR UPDATE` — used by every
   * transition (submit/receive/cancel) so two concurrent transition
   * attempts against the SAME purchase order (even with different
   * `Idempotency-Key`s, which `idempotent()`'s own advisory lock does not
   * serialize against each other) can never race past each other's
   * status check. */
  public async purchaseOrderForUpdate(
    client: PurchaseOrderTransaction,
    companyId: string,
    branchIds: readonly string[],
    id: string,
  ): Promise<PurchaseOrderRow | null> {
    const row = result<PurchaseOrderDb>(
      await client.query(
        `select ${PURCHASE_ORDER_COLUMNS} from purchase_orders
         where company_id=$1 and id=$2 and branch_id=any($3::uuid[])
         for update`,
        [companyId, id, branchIds],
      ),
    ).rows[0];
    if (row === undefined) return null;
    const lines = result<PurchaseOrderLineDb>(
      await client.query(
        `select ${PURCHASE_ORDER_LINE_COLUMNS} from purchase_order_lines
         where company_id=$1 and purchase_order_id=$2 order by line_number asc`,
        [companyId, id],
      ),
    ).rows;
    return purchaseOrder(row, lines.map(purchaseOrderLine));
  }

  private async purchaseOrderVia(
    executor: { query: (sql: string, values?: readonly unknown[]) => Promise<unknown> },
    companyId: string,
    branchIds: readonly string[],
    id: string,
  ): Promise<PurchaseOrderRow | null> {
    const row = result<PurchaseOrderDb>(
      await executor.query(
        `select ${PURCHASE_ORDER_COLUMNS} from purchase_orders
         where company_id=$1 and id=$2 and branch_id=any($3::uuid[])`,
        [companyId, id, branchIds],
      ),
    ).rows[0];
    if (row === undefined) return null;
    const lines = result<PurchaseOrderLineDb>(
      await executor.query(
        `select ${PURCHASE_ORDER_LINE_COLUMNS} from purchase_order_lines
         where company_id=$1 and purchase_order_id=$2 order by line_number asc`,
        [companyId, id],
      ),
    ).rows;
    return purchaseOrder(row, lines.map(purchaseOrderLine));
  }

  /** Re-selects by (company_id, id) ONLY, deliberately without a
   * `branch_id=any(...)` filter — used ONLY internally, right after a
   * transition's own `update`, on a row whose branch scoping was already
   * verified earlier in the very same call (`purchaseOrderForUpdate`, via
   * the caller's own `permittedBranchIds`). An empty/irrelevant branch
   * list would otherwise make `branch_id=any('{}')` always false and
   * incorrectly report "not found" right after a successful update. */
  private async purchaseOrderById(
    executor: { query: (sql: string, values?: readonly unknown[]) => Promise<unknown> },
    companyId: string,
    id: string,
  ): Promise<PurchaseOrderRow | null> {
    const row = result<PurchaseOrderDb>(
      await executor.query(
        `select ${PURCHASE_ORDER_COLUMNS} from purchase_orders where company_id=$1 and id=$2`,
        [companyId, id],
      ),
    ).rows[0];
    if (row === undefined) return null;
    const lines = result<PurchaseOrderLineDb>(
      await executor.query(
        `select ${PURCHASE_ORDER_LINE_COLUMNS} from purchase_order_lines
         where company_id=$1 and purchase_order_id=$2 order by line_number asc`,
        [companyId, id],
      ),
    ).rows;
    return purchaseOrder(row, lines.map(purchaseOrderLine));
  }

  public async submitPurchaseOrder(
    client: PurchaseOrderTransaction,
    context: PurchaseOrderMutationContext,
    id: string,
  ): Promise<PurchaseOrderRow> {
    await client.query(
      `update purchase_orders set status='submitted',submitted_at=$3,submitted_by=$4,
       version=version+1,updated_at=$3
       where company_id=$1 and id=$2`,
      [context.companyId, id, context.timestamp, context.actorId],
    );
    const row = await this.purchaseOrderById(client, context.companyId, id);
    if (row === null) throw new Error('Purchase order submission returned no row.');
    return row;
  }

  /** [notes] is the FINAL value to persist — the caller
   * (`PurchaseOrdersService.cancelPurchaseOrder`) already merges any
   * cancellation reason into the existing `notes` before calling this, so
   * this is a plain overwrite, never a `coalesce`. */
  public async cancelPurchaseOrder(
    client: PurchaseOrderTransaction,
    context: PurchaseOrderMutationContext,
    id: string,
    notes: string | null,
  ): Promise<PurchaseOrderRow> {
    await client.query(
      `update purchase_orders set status='cancelled',cancelled_at=$3,cancelled_by=$4,
       notes=$5,version=version+1,updated_at=$3
       where company_id=$1 and id=$2`,
      [context.companyId, id, context.timestamp, context.actorId, notes],
    );
    const row = await this.purchaseOrderById(client, context.companyId, id);
    if (row === null) throw new Error('Purchase order cancellation returned no row.');
    return row;
  }

  public async applyReceipt(
    client: PurchaseOrderTransaction,
    context: PurchaseOrderMutationContext,
    id: string,
    status: 'received' | 'partially_received',
    receiptMovementId: string,
    lines: readonly ReceivePurchaseOrderLineUpdate[],
  ): Promise<PurchaseOrderRow> {
    for (const line of lines)
      await client.query(
        `update purchase_order_lines set received_quantity=received_quantity+$3,updated_at=$4
         where company_id=$1 and id=$2`,
        [context.companyId, line.purchaseOrderLineId, line.receivedQuantity, context.timestamp],
      );
    await client.query(
      `update purchase_orders set status=$3,received_at=$4,received_by=$5,receipt_movement_id=$6,
       version=version+1,updated_at=$4
       where company_id=$1 and id=$2`,
      [context.companyId, id, status, context.timestamp, context.actorId, receiptMovementId],
    );
    const row = await this.purchaseOrderById(client, context.companyId, id);
    if (row === null) throw new Error('Purchase order receipt returned no row.');
    return row;
  }

  /** Point-in-time current quantity on hand for every distinct variant in
   * [productVariantIds], at the branch's own active default location —
   * same simple join `PurchasingRepository.movementSummary` uses, never a
   * historical "balance as of this movement" reconstruction (this
   * codebase keeps no such per-movement snapshot anywhere). */
  public async movementSummary(
    companyId: string,
    branchId: string,
    movementId: string,
    productVariantIds: readonly string[],
  ): Promise<PurchaseOrderMovementSummary | null> {
    const movement = result<{ id: string; movement_number: string; status: string; posted_at: Date | string | null }>(
      await this.database.pool.query(
        `select id, movement_number, status, posted_at from inventory_movements
         where company_id=$1 and id=$2`,
        [companyId, movementId],
      ),
    ).rows[0];
    if (movement === undefined) return null;
    const balances = result<{ product_variant_id: string; quantity_on_hand: string | null }>(
      await this.database.pool.query(
        `select v.id product_variant_id,
                (select b.quantity_on_hand::text from inventory_balances b
                 join inventory_locations l on l.company_id=b.company_id and l.id=b.inventory_location_id
                 where b.company_id=$1 and b.branch_id=$2 and b.product_variant_id=v.id
                   and l.is_default=true and l.status='active'
                 limit 1) quantity_on_hand
         from unnest($3::uuid[]) v(id)`,
        [companyId, branchId, productVariantIds],
      ),
    ).rows;
    const lines: PurchaseOrderMovementLineSummary[] = balances.map((balance) => ({
      productVariantId: balance.product_variant_id,
      currentQuantityOnHand: balance.quantity_on_hand,
    }));
    return {
      movementId: movement.id,
      movementNumber: movement.movement_number,
      status: movement.status,
      postedAt: movement.posted_at === null ? null : new Date(movement.posted_at),
      lines,
    };
  }

  public async listPurchaseOrders(
    companyId: string,
    branchIds: readonly string[],
    input: {
      limit: number;
      cursor?: string;
      branchId?: string;
      status?: string;
      supplierId?: string;
      orderDateFrom?: string;
      orderDateTo?: string;
    },
  ): Promise<{ items: PurchaseOrderListRow[]; nextCursor: string | null }> {
    const values: unknown[] = [companyId, branchIds];
    const where = ['po.company_id=$1', 'po.branch_id=any($2::uuid[])'];
    if (input.branchId !== undefined) {
      values.push(input.branchId);
      where.push(`po.branch_id=$${String(values.length)}`);
    }
    if (input.status !== undefined) {
      values.push(input.status);
      where.push(`po.status=$${String(values.length)}`);
    }
    if (input.supplierId !== undefined) {
      values.push(input.supplierId);
      where.push(`po.supplier_id=$${String(values.length)}`);
    }
    if (input.orderDateFrom !== undefined) {
      values.push(input.orderDateFrom);
      where.push(`po.order_date>=$${String(values.length)}`);
    }
    if (input.orderDateTo !== undefined) {
      values.push(input.orderDateTo);
      where.push(`po.order_date<=$${String(values.length)}`);
    }
    if (input.cursor !== undefined) {
      const decoded = decodePurchaseOrderCursor(input.cursor);
      values.push(decoded.createdAt, decoded.id);
      where.push(`(po.created_at,po.id)<($${String(values.length - 1)},$${String(values.length)})`);
    }
    values.push(input.limit + 1);
    const rows = result<
      PurchaseOrderDb & { line_count: string }
    >(
      await this.database.pool.query(
        `select po.${PURCHASE_ORDER_COLUMNS.split(',').join(',po.')},
                (select count(*)::text from purchase_order_lines pol
                 where pol.company_id=po.company_id and pol.purchase_order_id=po.id) line_count
         from purchase_orders po where ${where.join(' and ')}
         order by po.created_at desc, po.id desc limit $${String(values.length)}`,
        values,
      ),
    ).rows;
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit).map((row) => ({
      id: row.id,
      branchId: row.branch_id,
      orderNumber: row.order_number,
      status: row.status,
      supplierName: row.supplier_name,
      supplierId: row.supplier_id,
      orderDate: row.order_date,
      expectedDate: row.expected_date,
      currencyCode: row.currency_code,
      totalCost: row.total_cost,
      lineCount: Number(row.line_count),
      createdAt: new Date(row.created_at),
    }));
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last !== undefined ? encodePurchaseOrderCursor(last.createdAt, last.id) : null,
    };
  }

  private mapDatabaseError(error: unknown): unknown {
    switch (constraint(error)) {
      case 'purchase_order_lines_company_order_variant_uq':
        return new PurchaseOrderError(
          'purchase_order_duplicate_variant',
          'A line for this product variant already exists on this purchase order.',
        );
      default:
        return error;
    }
  }
}

/** Same opaque `(created_at, id)` cursor shape used across this codebase
 * — see `purchasing.repository.ts`'s own identical
 * `encodeDirectPurchaseCursor`/`decodeDirectPurchaseCursor` pair. */
export function encodePurchaseOrderCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify([createdAt.toISOString(), id]), 'utf8').toString('base64url');
}
export function decodePurchaseOrderCursor(cursor: string): { createdAt: Date; id: string } {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 2 ||
      typeof decoded[0] !== 'string' ||
      typeof decoded[1] !== 'string'
    )
      throw new Error('malformed');
    const createdAt = new Date(decoded[0]);
    if (Number.isNaN(createdAt.getTime())) throw new Error('malformed');
    return { createdAt, id: decoded[1] };
  } catch {
    throw new PurchaseOrderError('validation_error', 'The cursor is invalid.');
  }
}
