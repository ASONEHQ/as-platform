import { randomUUID } from 'node:crypto';

import type { DatabaseClient, ProductTaxCode } from '@asone/database';

import { postSaleConsumption } from '../inventory/sale-consumption.js';

import {
  SaleError,
  type SaleItemRow,
  type SaleMutationContext,
  type SaleRow,
  type SaleStatus,
} from './sales.types.js';

/** Structurally identical to `PaymentTransaction`
 * (apps/api/src/modules/payments/payments.repository.ts) on purpose: a
 * real `pg` client passed from either module's own `transaction()`
 * satisfies both, so `PaymentService` can hand its transaction client
 * straight to `SalesRepository.trySettleSale` (and vice versa were it ever
 * needed) with no adapter. */
export interface SaleTransaction {
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
/** Exact `numeric(19,4)` decimal-string comparison via `BigInt` — ADR-0001
 * prohibits `Number()` for authoritative money, and `trySettleSale` below
 * decides whether a sale is actually paid off, so this must never be a
 * floating-point comparison. */
/** TASK 12.6 Part B: encodes the `(occurred_at, id)` seek key as one
 * opaque, base64url-encoded string — never a bare timestamp/id a client
 * could parse or forge into a different valid-looking value. */
function encodeSaleCursor(occurredAt: Date, id: string): string {
  return Buffer.from(JSON.stringify([occurredAt.toISOString(), id]), 'utf8').toString('base64url');
}
function decodeSaleCursor(cursor: string): { occurredAt: Date; id: string } {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 2 ||
      typeof decoded[0] !== 'string' ||
      typeof decoded[1] !== 'string'
    )
      throw new Error('malformed');
    const occurredAt = new Date(decoded[0]);
    if (Number.isNaN(occurredAt.getTime())) throw new Error('malformed');
    return { occurredAt, id: decoded[1] };
  } catch {
    throw new SaleError('validation_error', 'The cursor is invalid.');
  }
}

function moneyUnits(value: string): bigint {
  const [whole = '', fraction = ''] = value.split('.');
  const wholeDigits = whole.length === 0 ? '0' : whole;
  const fractionDigits = fraction.padEnd(4, '0').slice(0, 4);
  return BigInt(wholeDigits) * 10_000n + BigInt(fractionDigits.length === 0 ? '0' : fractionDigits);
}

interface SaleDb {
  id: string;
  company_id: string;
  branch_id: string;
  cash_register_id: string | null;
  cash_session_id: string | null;
  device_id: string | null;
  sync_operation_id: string | null;
  customer_id: string | null;
  customer_display_name: string | null;
  sale_number: string;
  status: SaleStatus;
  currency_code: string;
  subtotal: string;
  discount_total: string;
  tax_total: string;
  total: string;
  paid_total: string;
  change_total: string;
  occurred_at: Date | string;
  completed_at: Date | string | null;
  cancelled_at: Date | string | null;
  cancelled_by: string | null;
  reason_code: string | null;
  note: string | null;
  created_by: string;
  version: string;
  created_at: Date | string;
  updated_at: Date | string;
}
interface SaleItemDb {
  id: string;
  company_id: string;
  branch_id: string;
  sale_id: string;
  line_number: number;
  product_id: string | null;
  product_variant_id: string | null;
  product_version: string | null;
  sku_snapshot: string | null;
  name_snapshot: string;
  quantity: string;
  unit_price: string;
  subtotal: string;
  discount_total: string;
  discount_basis_points: number;
  tax_total: string;
  line_total: string;
  tax_snapshot: Readonly<Record<string, unknown>> | null;
  created_at: Date | string;
}
interface IdempotencyDb {
  request_hash: string;
  response_body: unknown;
}
interface ProductLookupDb {
  product_id: string;
  category_id: string | null;
  variant_id: string | null;
  tax_code: ProductTaxCode;
  status: string;
  version: string;
  name: string;
  variant_sku: string | null;
}
interface PriceLookupDb {
  product_id: string;
  amount: string;
  currency_code: string;
}

const SALE_COLUMNS =
  'id,company_id,branch_id,cash_register_id,cash_session_id,device_id,sync_operation_id,customer_id,customer_display_name,sale_number,status,currency_code,subtotal,discount_total,tax_total,total,paid_total,change_total,occurred_at,completed_at,cancelled_at,cancelled_by,reason_code,note,created_by,version,created_at,updated_at';
const SALE_ITEM_COLUMNS =
  'id,company_id,branch_id,sale_id,line_number,product_id,product_variant_id,product_version,sku_snapshot,name_snapshot,quantity,unit_price,subtotal,discount_total,discount_basis_points,tax_total,line_total,tax_snapshot,created_at';

function sale(row: SaleDb): SaleRow {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    cashRegisterId: row.cash_register_id,
    cashSessionId: row.cash_session_id,
    deviceId: row.device_id,
    syncOperationId: row.sync_operation_id,
    customerId: row.customer_id,
    customerDisplayName: row.customer_display_name,
    saleNumber: row.sale_number,
    status: row.status,
    currencyCode: row.currency_code,
    subtotal: row.subtotal,
    discountTotal: row.discount_total,
    taxTotal: row.tax_total,
    total: row.total,
    paidTotal: row.paid_total,
    changeTotal: row.change_total,
    occurredAt: new Date(row.occurred_at),
    completedAt: row.completed_at === null ? null : new Date(row.completed_at),
    cancelledAt: row.cancelled_at === null ? null : new Date(row.cancelled_at),
    cancelledBy: row.cancelled_by,
    reasonCode: row.reason_code,
    note: row.note,
    createdBy: row.created_by,
    version: BigInt(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
function saleItem(row: SaleItemDb): SaleItemRow {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    saleId: row.sale_id,
    lineNumber: row.line_number,
    productId: row.product_id,
    productVariantId: row.product_variant_id,
    productVersion: row.product_version === null ? null : BigInt(row.product_version),
    skuSnapshot: row.sku_snapshot,
    nameSnapshot: row.name_snapshot,
    quantity: row.quantity,
    unitPrice: row.unit_price,
    subtotal: row.subtotal,
    discountTotal: row.discount_total,
    discountBasisPoints: row.discount_basis_points,
    taxTotal: row.tax_total,
    lineTotal: row.line_total,
    taxSnapshot: row.tax_snapshot,
    createdAt: new Date(row.created_at),
  };
}
export interface ResolvedProductLine {
  productId: string;
  // TASK 12.9 — additive: the product's own `category_id`, needed for
  // category-scoped promotion eligibility (`pricing.service.ts`). Never
  // used for anything display-facing on the frozen sale-item snapshot
  // itself (`sale_items` has no `category_id` column — a later category
  // reassignment never rewrites history).
  categoryId: string | null;
  // TASK 12.6: the default variant resolved *at sale-creation time* —
  // see sales.ts's `saleItems.productVariantId` doc comment for why this
  // is captured now rather than re-derived later. `null` only when the
  // product genuinely has no active default variant (defensive; not
  // expected once `product` itself resolved, since every active product
  // in this domain has one — see `product_variants_product_default_active_uq`).
  variantId: string | null;
  productVersion: bigint;
  name: string;
  skuSnapshot: string | null;
  taxCode: ProductTaxCode;
  status: string;
  price: { amount: string; currencyCode: string } | null;
}

export class SalesRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async transaction<T>(callback: (client: SaleTransaction) => Promise<T>): Promise<T> {
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

  public async idempotent<T>(
    client: SaleTransaction,
    context: SaleMutationContext,
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
        throw new SaleError('idempotency_conflict', 'The idempotency key was used with another request.');
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
    client: SaleTransaction,
    context: SaleMutationContext,
    input: {
      action: string;
      resourceType: 'sale';
      resourceId: string;
      eventType: string;
      version: bigint;
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
       (event_id,company_id,event_type,schema_version,aggregate_type,aggregate_id,aggregate_version,
        correlation_id,payload,occurred_at)
       values ($1,$2,$3,1,$4,$5,$6,$7,$8::jsonb,$9)`,
      [
        randomUUID(),
        context.companyId,
        input.eventType,
        input.resourceType,
        input.resourceId,
        input.version.toString(),
        context.correlationId,
        JSON.stringify(input.payload),
        context.timestamp,
      ],
    );
  }

  // --- Product/price resolution (server money authority) ---------------

  /** Resolves every input product id, in two batched queries (never
   * per-line), against the SAME transaction connection the sale is about
   * to be inserted on — a consistent read within the create transaction,
   * not a pre-transaction lookup that could race a concurrent price
   * change. Mirrors `ProductCatalogRepository.effectivePrices`'s exact
   * "most specific active price" query shape (branch override before
   * company default) rather than inventing a second pricing rule. */
  public async resolveProductLines(
    client: SaleTransaction,
    companyId: string,
    branchId: string,
    productIds: readonly string[],
  ): Promise<Map<string, ResolvedProductLine>> {
    if (productIds.length === 0) return new Map();
    // Two genuinely concurrent queries on this one transaction connection
    // (not two sequential `await`s wrapped in a `Promise.all` that would
    // only look parallel).
    const [productsResult, pricesResult] = await Promise.all([
      client.query(
        `select p.id as product_id, p.category_id, p.tax_code, p.status, p.version, p.name,
                pv.id as variant_id, pv.sku as variant_sku
         from products p
         left join product_variants pv
           on pv.company_id=p.company_id and pv.product_id=p.id
              and pv.is_default=true and pv.status<>'retired'
         where p.company_id=$1 and p.id=any($2::uuid[])`,
        [companyId, productIds],
      ),
      client.query(
        `select distinct on (product_id) product_id, amount, currency_code
         from product_prices
         where company_id=$1
           and product_id=any($2::uuid[])
           and status='active'
           and valid_from<=now()
           and (valid_until is null or valid_until>now())
           and (branch_id=$3::uuid or branch_id is null)
         order by product_id, (branch_id is not null) desc, valid_from desc`,
        [companyId, productIds, branchId],
      ),
    ]);
    const products = result<ProductLookupDb>(productsResult);
    const prices = result<PriceLookupDb>(pricesResult);
    const priceByProduct = new Map(
      prices.rows.map((row) => [row.product_id, { amount: row.amount, currencyCode: row.currency_code }]),
    );
    return new Map(
      products.rows.map((row) => [
        row.product_id,
        {
          productId: row.product_id,
          categoryId: row.category_id,
          variantId: row.variant_id,
          productVersion: BigInt(row.version),
          name: row.name,
          skuSnapshot: row.variant_sku,
          taxCode: row.tax_code,
          status: row.status,
          price: priceByProduct.get(row.product_id) ?? null,
        },
      ]),
    );
  }

  // --- Sales -------------------------------------------------------------

  public async insertSale(
    client: SaleTransaction,
    input: SaleMutationContext & {
      id: string;
      branchId: string;
      deviceId: string | null;
      // TASK 13.0 — Part G/AB: both null together for a walk-in sale;
      // `customerDisplayName` is the frozen snapshot at THIS moment, never
      // re-read from the customer record later.
      customerId: string | null;
      customerDisplayName: string | null;
      saleNumber: string;
      currencyCode: string;
      subtotal: string;
      discountTotal: string;
      taxTotal: string;
      total: string;
      // TASK 14.3 (Wave 1, Part B.4) — optional, frozen at creation; see
      // `SaleRow.note`'s own doc comment.
      note: string | null;
    },
  ): Promise<SaleRow> {
    const row = result<SaleDb>(
      await client.query(
        `insert into sales
         (id,company_id,branch_id,device_id,customer_id,customer_display_name,sale_number,status,currency_code,
          subtotal,discount_total,tax_total,total,occurred_at,created_by,note,created_at,updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,'pending_payment',$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)
         returning ${SALE_COLUMNS}`,
        [
          input.id,
          input.companyId,
          input.branchId,
          input.deviceId,
          input.customerId,
          input.customerDisplayName,
          input.saleNumber,
          input.currencyCode,
          input.subtotal,
          input.discountTotal,
          input.taxTotal,
          input.total,
          input.timestamp,
          input.actorId,
          input.note,
          input.timestamp,
        ],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Sale insertion did not return a row.');
    return sale(row);
  }

  public async insertSaleItem(
    client: SaleTransaction,
    input: {
      id: string;
      companyId: string;
      branchId: string;
      saleId: string;
      lineNumber: number;
      productId: string | null;
      productVariantId: string | null;
      productVersion: bigint | null;
      skuSnapshot: string | null;
      nameSnapshot: string;
      quantity: string;
      unitPrice: string;
      subtotal: string;
      // TASK 12.9 — additive, both default to "no discount" when omitted
      // so every pre-existing call site (a sale with no eligible
      // promotion/coupon/manual discount) keeps compiling and behaving
      // identically to before this task.
      discountTotal?: string;
      discountBasisPoints?: number;
      taxTotal: string;
      lineTotal: string;
      taxSnapshot: Readonly<Record<string, unknown>> | null;
      timestamp: Date;
    },
  ): Promise<SaleItemRow> {
    const row = result<SaleItemDb>(
      await client.query(
        `insert into sale_items
         (id,company_id,branch_id,sale_id,line_number,product_id,product_variant_id,product_version,
          sku_snapshot,name_snapshot,quantity,unit_price,subtotal,discount_total,discount_basis_points,
          tax_total,line_total,tax_snapshot,created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19)
         returning ${SALE_ITEM_COLUMNS}`,
        [
          input.id,
          input.companyId,
          input.branchId,
          input.saleId,
          input.lineNumber,
          input.productId,
          input.productVariantId,
          input.productVersion === null ? null : input.productVersion.toString(),
          input.skuSnapshot,
          input.nameSnapshot,
          input.quantity,
          input.unitPrice,
          input.subtotal,
          input.discountTotal ?? '0.0000',
          input.discountBasisPoints ?? 0,
          input.taxTotal,
          input.lineTotal,
          input.taxSnapshot === null ? null : JSON.stringify(input.taxSnapshot),
          input.timestamp,
        ],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Sale item insertion did not return a row.');
    return saleItem(row);
  }

  public async sale(companyId: string, id: string): Promise<SaleRow | null> {
    const row = result<SaleDb>(
      await this.database.pool.query(`select ${SALE_COLUMNS} from sales where company_id=$1 and id=$2`, [
        companyId,
        id,
      ]),
    ).rows[0];
    return row === undefined ? null : sale(row);
  }

  public async saleItems(companyId: string, saleId: string): Promise<SaleItemRow[]> {
    const rows = result<SaleItemDb>(
      await this.database.pool.query(
        `select ${SALE_ITEM_COLUMNS} from sale_items
         where company_id=$1 and sale_id=$2 order by line_number asc`,
        [companyId, saleId],
      ),
    ).rows;
    return rows.map(saleItem);
  }

  // --- Sales history (TASK 12.6 Part B / E075) --------------------------

  /** The stable, newest-first list-page query — exactly E075's own
   * "stable `(occurred_at,id)` cursor". `PaymentRepository.listPayments`'s
   * simpler single-column `id`-cursor is *not* reused here: that
   * shortcut only works because a UUID that happens to be monotonic with
   * creation time makes a single-column cursor already chronological —
   * true for `createUuidV7()`-generated ids elsewhere in this codebase
   * (inventory movements, bootstrap identities), but `sales.id` is a
   * plain `crypto.randomUUID()` (see `SalesService.createSale`), so `id`
   * alone carries no time information at all. `(occurred_at, id)` is
   * therefore genuinely necessary here, not just doc-aspirational —
   * `id` still breaks ties for two sales sharing one `occurred_at`
   * timestamp. `encodeSaleCursor`/`decodeSaleCursor` below hold that pair
   * in one opaque string, matching this codebase's own "cursor is an
   * opaque value, never a bare column" convention. */
  public async listSales(
    companyId: string,
    branchIds: readonly string[],
    input: {
      limit: number;
      cursor?: string;
      branchId?: string;
      status?: SaleStatus;
      occurredFrom?: Date;
      occurredTo?: Date;
      createdBy?: string;
      saleNumber?: string;
      paymentMethod?: string;
      // TASK 13.0 — Part F/AA: Customer Detail's "recent sales" reuses
      // this exact existing query, never a duplicate/parallel one — still
      // scoped by the caller's own `branchIds` above, so a customer's
      // history never leaks a sale from a branch the actor cannot access.
      customerId?: string;
    },
  ): Promise<{ items: SaleRow[]; nextCursor: string | null }> {
    const values: unknown[] = [companyId, branchIds];
    const where = ['company_id=$1', 'branch_id=any($2::uuid[])'];
    if (input.branchId !== undefined) {
      values.push(input.branchId);
      where.push(`branch_id=$${String(values.length)}`);
    }
    if (input.customerId !== undefined) {
      values.push(input.customerId);
      where.push(`customer_id=$${String(values.length)}`);
    }
    if (input.status !== undefined) {
      values.push(input.status);
      where.push(`status=$${String(values.length)}`);
    }
    if (input.occurredFrom !== undefined) {
      values.push(input.occurredFrom);
      where.push(`occurred_at>=$${String(values.length)}`);
    }
    if (input.occurredTo !== undefined) {
      values.push(input.occurredTo);
      where.push(`occurred_at<$${String(values.length)}`);
    }
    if (input.createdBy !== undefined) {
      values.push(input.createdBy);
      where.push(`created_by=$${String(values.length)}`);
    }
    if (input.saleNumber !== undefined) {
      // Folio search is a case-insensitive substring match — a cashier
      // types part of what's printed on a ticket, never the exact
      // 37-character canonical value.
      values.push(`%${input.saleNumber}%`);
      where.push(`sale_number ilike $${String(values.length)}`);
    }
    if (input.paymentMethod !== undefined) {
      // A sale can carry more than one payment row; "paid by X" means at
      // least one *captured* payment used that method — never a pending
      // or failed attempt, and never a join that could duplicate a sale
      // row for having several payments.
      values.push(input.paymentMethod);
      where.push(
        `exists(select 1 from payments p where p.company_id=sales.company_id and p.sale_id=sales.id and p.status='captured' and p.payment_method=$${String(values.length)})`,
      );
    }
    if (input.cursor !== undefined) {
      const decoded = decodeSaleCursor(input.cursor);
      values.push(decoded.occurredAt, decoded.id);
      where.push(
        `(occurred_at,id)<($${String(values.length - 1)},$${String(values.length)})`,
      );
    }
    values.push(input.limit + 1);
    const rows = result<SaleDb>(
      await this.database.pool.query(
        `select ${SALE_COLUMNS} from sales where ${where.join(' and ')}
         order by occurred_at desc, id desc limit $${String(values.length)}`,
        values,
      ),
    ).rows;
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit).map(sale);
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last !== undefined ? encodeSaleCursor(last.occurredAt, last.id) : null,
    };
  }

  /** Batched summary data for exactly the sale IDs on one list page —
   * branch name, cashier display name, item count, and the distinct set
   * of *captured* payment methods — never one query per row. Missing
   * branch/cashier data (defensive; not expected once the sale itself
   * resolved) degrades to `null`/empty, never a thrown error, so a list
   * page always renders. */
  public async listSummaries(
    companyId: string,
    saleIds: readonly string[],
  ): Promise<
    Map<
      string,
      { branchName: string | null; cashierName: string | null; itemCount: number; paymentMethods: string[] }
    >
  > {
    if (saleIds.length === 0) return new Map();
    const [branchResult, countResult, methodResult] = await Promise.all([
      this.database.pool.query(
        `select s.id, b.name as branch_name, u.display_name as cashier_name
         from sales s
         left join branches b on b.company_id=s.company_id and b.id=s.branch_id
         left join users u on u.id=s.created_by
         where s.company_id=$1 and s.id=any($2::uuid[])`,
        [companyId, saleIds],
      ),
      this.database.pool.query(
        `select sale_id, count(*)::text as item_count from sale_items
         where company_id=$1 and sale_id=any($2::uuid[]) group by sale_id`,
        [companyId, saleIds],
      ),
      this.database.pool.query(
        `select distinct sale_id, payment_method from payments
         where company_id=$1 and sale_id=any($2::uuid[]) and status='captured'`,
        [companyId, saleIds],
      ),
    ]);
    const branchRows = result<{ id: string; branch_name: string | null; cashier_name: string | null }>(branchResult);
    const countRows = result<{ sale_id: string; item_count: string }>(countResult);
    const methodRows = result<{ sale_id: string; payment_method: string }>(methodResult);
    const countBySale = new Map(countRows.rows.map((row) => [row.sale_id, Number(row.item_count)]));
    const methodsBySale = new Map<string, string[]>();
    for (const row of methodRows.rows) {
      const list = methodsBySale.get(row.sale_id) ?? [];
      list.push(row.payment_method);
      methodsBySale.set(row.sale_id, list);
    }
    return new Map(
      branchRows.rows.map((row) => [
        row.id,
        {
          branchName: row.branch_name,
          cashierName: row.cashier_name,
          itemCount: countBySale.get(row.id) ?? 0,
          paymentMethods: methodsBySale.get(row.id) ?? [],
        },
      ]),
    );
  }

  /** TASK 12.8 Part Q: derives each sale's refund state
   * (`not_refunded`/`partially_refunded`/`fully_refunded`) purely from
   * the immutable `refunds`/`refund_items` records — never by mutating
   * `sales.status` (see ADR-0015 "corrected original sale stays
   * historically completed"). The per-line "is every sold unit
   * refunded" comparison is done in SQL as an exact `numeric`
   * comparison (`refunded_quantity >= si.quantity`), never in JS with
   * `Number()`, matching ADR-0001. Only `completed` refunds count — a
   * `requested`/`approved` refund that hasn't actually posted its
   * inventory/cash/payment effects yet must never flip a sale's
   * displayed state. Batched like `listSummaries` above (one query for
   * however many sale ids the caller — list or single-sale detail —
   * needs), never one query per sale. */
  public async refundStatesForSales(
    companyId: string,
    saleIds: readonly string[],
  ): Promise<Map<string, 'not_refunded' | 'partially_refunded' | 'fully_refunded'>> {
    if (saleIds.length === 0) return new Map();
    const queryResult = await this.database.pool.query(
      `select si.sale_id,
              bool_or(coalesce(ref.refunded_quantity, 0) > 0) as any_refunded,
              bool_and(coalesce(ref.refunded_quantity, 0) >= si.quantity) as fully_refunded
       from sale_items si
       left join (
         select ri.sale_item_id, sum(ri.quantity) as refunded_quantity
         from refund_items ri
         join refunds r on r.company_id = ri.company_id and r.id = ri.refund_id and r.status = 'completed'
         where ri.company_id = $1
         group by ri.sale_item_id
       ) ref on ref.sale_item_id = si.id
       where si.company_id = $1 and si.sale_id = any($2::uuid[])
       group by si.sale_id`,
      [companyId, saleIds],
    );
    const rows = result<{ sale_id: string; any_refunded: boolean; fully_refunded: boolean }>(queryResult).rows;
    return new Map(
      rows.map((row) => [
        row.sale_id,
        row.fully_refunded ? 'fully_refunded' : row.any_refunded ? 'partially_refunded' : 'not_refunded',
      ]),
    );
  }

  /** TASK 12.5B: the receipt's "who/where" — company display name,
   * branch name/address, and the cashier's own display name (the user
   * who created the sale, `sales.created_by`). One direct join against
   * `companies`/`branches`/`users`, mirroring this codebase's established
   * "query the table you need directly" convention (e.g.
   * `PaymentRepository.validateDevice` against `devices`) rather than
   * depending on another module's repository for three columns. Scoped
   * by `company_id` alone (like `sale()` above) — the caller
   * (`sales.routes.ts`) has already resolved/authorized the sale itself
   * via `SalesService.sale`, so this is never called with an
   * unauthorized `saleId`. Returns `null` only if the sale itself
   * vanished between that resolution and this call (defensive, not
   * expected in practice). */
  public async receiptOrganization(
    companyId: string,
    saleId: string,
  ): Promise<{
    companyName: string;
    branchName: string;
    branchAddress: Readonly<Record<string, unknown>> | null;
    cashierId: string;
    cashierName: string;
  } | null> {
    const row = result<{
      company_name: string;
      branch_name: string;
      branch_address: Readonly<Record<string, unknown>> | null;
      cashier_id: string;
      cashier_name: string;
    }>(
      await this.database.pool.query(
        `select c.display_name as company_name, b.name as branch_name, b.address as branch_address,
                u.id as cashier_id, u.display_name as cashier_name
         from sales s
         join companies c on c.id = s.company_id
         join branches b on b.company_id = s.company_id and b.id = s.branch_id
         join users u on u.id = s.created_by
         where s.company_id = $1 and s.id = $2`,
        [companyId, saleId],
      ),
    ).rows[0];
    if (row === undefined) return null;
    return {
      companyName: row.company_name,
      branchName: row.branch_name,
      branchAddress: row.branch_address,
      cashierId: row.cashier_id,
      cashierName: row.cashier_name,
    };
  }

  public async lockSale(
    client: SaleTransaction,
    companyId: string,
    branchIds: readonly string[],
    id: string,
  ): Promise<SaleRow | null> {
    const row = result<SaleDb>(
      await client.query(
        `select ${SALE_COLUMNS} from sales
         where company_id=$1 and id=$2 and branch_id=any($3::uuid[]) for update`,
        [companyId, id, branchIds],
      ),
    ).rows[0];
    return row === undefined ? null : sale(row);
  }

  /** Unscoped-by-branch lock — used only by `SalesRepository` callers
   * that have already resolved (and will themselves verify) the sale's
   * branch, e.g. `PaymentService.createPayment`'s explicit branch-match
   * check before it ever creates a payment against this sale. */
  public async lockSaleById(client: SaleTransaction, companyId: string, id: string): Promise<SaleRow | null> {
    const row = result<SaleDb>(
      await client.query(`select ${SALE_COLUMNS} from sales where company_id=$1 and id=$2 for update`, [
        companyId,
        id,
      ]),
    ).rows[0];
    return row === undefined ? null : sale(row);
  }

  public async updateSaleStatus(
    client: SaleTransaction,
    companyId: string,
    id: string,
    expectedVersion: bigint,
    input: {
      status: SaleStatus;
      timestamp: Date;
      completedAt?: Date;
      cancelledAt?: Date;
      cancelledBy?: string;
      reasonCode?: string;
    },
  ): Promise<SaleRow> {
    const row = result<SaleDb>(
      await client.query(
        `update sales set
           status=$3,
           completed_at=coalesce($4,completed_at),
           cancelled_at=coalesce($5,cancelled_at),
           cancelled_by=coalesce($6,cancelled_by),
           reason_code=coalesce($7,reason_code),
           version=version+1,
           updated_at=$8
         where company_id=$1 and id=$2 and version=$9
         returning ${SALE_COLUMNS}`,
        [
          companyId,
          id,
          input.status,
          input.completedAt ?? null,
          input.cancelledAt ?? null,
          input.cancelledBy ?? null,
          input.reasonCode ?? null,
          input.timestamp,
          expectedVersion.toString(),
        ],
      ),
    ).rows[0];
    if (row === undefined) throw new SaleError('version_conflict', 'The sale version changed.');
    return sale(row);
  }

  /** TASK 12.7 Part E: stamps the sale's own `cash_register_id`/
   * `cash_session_id` FKs the moment its first cash payment actually
   * settles against a real open session — never at sale creation (a Sale
   * doesn't know its payment method yet) and never for a card sale (this
   * is only ever called from `PaymentService.createCashPayment`). No
   * version check: this always runs on the same already-locked row
   * `createCashPayment` locked moments earlier in the same transaction,
   * and setting the same values again on an idempotency replay is a
   * harmless no-op — see ADR-0014. */
  public async attachCashSession(
    client: SaleTransaction,
    companyId: string,
    id: string,
    input: { cashRegisterId: string; cashSessionId: string },
  ): Promise<void> {
    await client.query(
      `update sales set cash_register_id=$3,cash_session_id=$4,version=version+1
       where company_id=$1 and id=$2`,
      [companyId, id, input.cashRegisterId, input.cashSessionId],
    );
  }

  /** The payment → sale coordination point (see ADR-0009). Locks the
   * sale, sums every `captured` payment already recorded against it, and
   * — only while the sale is still `pending_payment` and the sum covers
   * `total` — completes it, auditing/publishing `sale.completed` in the
   * same transaction as the caller's own payment-side write. Idempotent
   * by construction: a sale already outside `pending_payment` (already
   * completed by an earlier duplicate approval, or cancelled) is left
   * untouched and `settled` comes back `false`, so calling this twice for
   * the same approval (a replayed provider callback, two workers) never
   * double-finalizes. */
  public async trySettleSale(
    client: SaleTransaction,
    context: SaleMutationContext,
    saleId: string,
  ): Promise<{ sale: SaleRow; settled: boolean }> {
    const current = await this.lockSaleById(client, context.companyId, saleId);
    if (current === null) throw new SaleError('resource_not_found', 'The sale was not found.');
    if (current.status !== 'pending_payment') return { sale: current, settled: false };
    const captured = result<{ total: string | null }>(
      await client.query(
        `select sum(amount)::text as total from payments
         where company_id=$1 and sale_id=$2 and status='captured'`,
        [context.companyId, saleId],
      ),
    ).rows[0];
    const capturedTotal = captured?.total ?? '0';
    if (moneyUnits(capturedTotal) < moneyUnits(current.total)) return { sale: current, settled: false };
    const updated = await this.updateSaleStatus(client, context.companyId, saleId, current.version, {
      status: 'completed',
      timestamp: context.timestamp,
      completedAt: context.timestamp,
    });
    await this.auditAndPublish(client, context, {
      action: 'sale.completed',
      resourceType: 'sale',
      resourceId: updated.id,
      eventType: 'sale.completed',
      version: updated.version,
      payload: {
        sale_id: updated.id,
        branch_id: updated.branchId,
        sale_number: updated.saleNumber,
        total: updated.total,
        status: updated.status,
        version: updated.version.toString(),
      },
    });
    // TASK 12.6 — Part A: inventory sale-consumption posting, exactly
    // once, exactly here — the one moment a Sale genuinely, newly
    // transitions to `completed` (never on a replay: `settled` is only
    // `true` the first time this branch runs at all, per this method's
    // own doc comment). Same transaction as the completion above, so a
    // stock conflict (see `sale-consumption.ts`'s own doc comment for why
    // that trade-off is deliberate) rolls back the whole settlement,
    // including the payment capture the caller is still inside of.
    const items = await this.saleItemsForTransaction(client, context.companyId, updated.id);
    await postSaleConsumption(
      client,
      {
        companyId: context.companyId,
        actorId: context.actorId,
        correlationId: context.correlationId,
        timestamp: context.timestamp,
      },
      { id: updated.id, branchId: updated.branchId, saleNumber: updated.saleNumber },
      items.map((item) => ({
        productVariantId: item.productVariantId,
        quantity: item.quantity,
        nameSnapshot: item.nameSnapshot,
      })),
    );
    return { sale: updated, settled: true };
  }

  /** Transaction-scoped sibling of `saleItems()` above — that method
   * reads through `this.database.pool` (a fresh connection), which would
   * not see this same transaction's own uncommitted `sale_items` rows (or
   * would deadlock waiting on the row lock `insertSaleItem` never
   * actually holds past its own statement, but would still be a *second*
   * connection observing a *separate* snapshot). `trySettleSale` needs the
   * items visible *within* its own transaction, immediately before
   * posting inventory consumption for them. */
  private async saleItemsForTransaction(
    client: SaleTransaction,
    companyId: string,
    saleId: string,
  ): Promise<SaleItemRow[]> {
    const rows = result<SaleItemDb>(
      await client.query(
        `select ${SALE_ITEM_COLUMNS} from sale_items
         where company_id=$1 and sale_id=$2 order by line_number asc`,
        [companyId, saleId],
      ),
    ).rows;
    return rows.map(saleItem);
  }

  private mapDatabaseError(error: unknown): unknown {
    switch (constraint(error)) {
      case 'sales_company_branch_number_uq':
        return new SaleError('validation_error', 'This sale number was already used.');
      case 'sales_branch_scope_fk':
        return new SaleError('validation_error', 'The branch was not found.');
      case 'sales_device_scope_fk':
        return new SaleError('validation_error', 'The device was not found.');
      case 'sale_items_sale_scope_fk':
      case 'sale_items_product_scope_fk':
        return new SaleError('validation_error', 'A sale line referenced an invalid record.');
      default:
        return error;
    }
  }
}
