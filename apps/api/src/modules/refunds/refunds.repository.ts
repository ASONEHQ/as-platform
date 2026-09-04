import { randomUUID } from 'node:crypto';

import type { DatabaseClient } from '@asone/database';

import {
  RefundError,
  type RefundItemDisposition,
  type RefundItemRow,
  type RefundMutationContext,
  type RefundRow,
  type RefundStatus,
} from './refunds.types.js';

/** Structurally identical to `SaleTransaction`/`PaymentTransaction`/
 * `CashTransaction` on purpose — see ADR-0013's original rationale, reused
 * verbatim across every module that has followed since. */
export interface RefundTransaction {
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

const REFUND_COLUMNS =
  'id,company_id,branch_id,sale_id,cash_session_id,payment_id,refund_number,status,refund_method,reason_code,reason_note,currency_code,subtotal,tax_total,total,occurred_at,completed_at,created_by,approved_by,device_id,version,created_at,updated_at';
const REFUND_ITEM_COLUMNS =
  'id,company_id,branch_id,refund_id,sale_item_id,quantity,subtotal,tax_total,line_total,restock_disposition,created_at';

interface RefundDb {
  id: string;
  company_id: string;
  branch_id: string;
  sale_id: string;
  cash_session_id: string | null;
  payment_id: string | null;
  refund_number: string;
  status: RefundStatus;
  refund_method: RefundRow['refundMethod'];
  reason_code: string;
  reason_note: string | null;
  currency_code: string;
  subtotal: string;
  tax_total: string;
  total: string;
  occurred_at: Date | string;
  completed_at: Date | string | null;
  created_by: string;
  approved_by: string | null;
  device_id: string | null;
  version: string;
  created_at: Date | string;
  updated_at: Date | string;
}
interface RefundItemDb {
  id: string;
  company_id: string;
  branch_id: string;
  refund_id: string;
  sale_item_id: string;
  quantity: string;
  subtotal: string;
  tax_total: string;
  line_total: string;
  restock_disposition: RefundItemDisposition;
  created_at: Date | string;
}
interface IdempotencyDb {
  request_hash: string;
  response_body: unknown;
}

function refund(row: RefundDb): RefundRow {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    saleId: row.sale_id,
    cashSessionId: row.cash_session_id,
    paymentId: row.payment_id,
    refundNumber: row.refund_number,
    status: row.status,
    refundMethod: row.refund_method,
    reasonCode: row.reason_code,
    reasonNote: row.reason_note,
    currencyCode: row.currency_code,
    subtotal: row.subtotal,
    taxTotal: row.tax_total,
    total: row.total,
    occurredAt: new Date(row.occurred_at),
    completedAt: row.completed_at === null ? null : new Date(row.completed_at),
    createdBy: row.created_by,
    approvedBy: row.approved_by,
    deviceId: row.device_id,
    version: BigInt(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
function refundItem(row: RefundItemDb): RefundItemRow {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    refundId: row.refund_id,
    saleItemId: row.sale_item_id,
    quantity: row.quantity,
    subtotal: row.subtotal,
    taxTotal: row.tax_total,
    lineTotal: row.line_total,
    restockDisposition: row.restock_disposition,
    createdAt: new Date(row.created_at),
  };
}

/** The minimum a locked `sales` row carries for refund eligibility —
 * deliberately not `SaleRow` (this module never imports the sales
 * module's types, the same "raw cross-module table read, no cross-module
 * type import" pattern `sale-consumption.ts` and
 * `SalesRepository.listSummaries` already established). */
export interface RefundableSaleRow {
  id: string;
  companyId: string;
  branchId: string;
  status: string;
  saleNumber: string;
  currencyCode: string;
  total: string;
}

/** One original sold line, exactly as needed to compute an exact partial
 * (or full) reversal — `unitPrice` and `taxSnapshot.basis_points` are the
 * frozen commercial snapshot Part C requires; never re-read from today's
 * catalog. */
export interface RefundableSaleItemRow {
  id: string;
  saleId: string;
  productVariantId: string | null;
  nameSnapshot: string;
  quantity: string;
  unitPrice: string;
  taxSnapshot: { tax_code?: string; basis_points?: number } | null;
}

export interface CapturedPaymentRow {
  id: string;
  saleId: string;
  branchId: string;
  paymentMethod: 'cash' | 'card_terminal' | 'card_manual' | 'other';
  amount: string;
  status: string;
  terminalId: string | null;
  provider: string | null;
}

export class RefundsRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async transaction<T>(callback: (client: RefundTransaction) => Promise<T>): Promise<T> {
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
    client: RefundTransaction,
    context: RefundMutationContext,
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
        throw new RefundError('idempotency_conflict', 'The idempotency key was used with another request.');
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
    client: RefundTransaction,
    context: RefundMutationContext,
    input: {
      action: string;
      resourceType: 'refund';
      resourceId: string;
      eventType: string;
      branchId: string;
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
       (event_id,company_id,branch_id,event_type,schema_version,aggregate_type,aggregate_id,aggregate_version,
        correlation_id,payload,occurred_at,available_at,created_at)
       values ($1,$2,$3,$4,1,$5,$6,$7,$8,$9::jsonb,$10,$10,$10)`,
      [
        randomUUID(),
        context.companyId,
        input.branchId,
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

  // --- Cross-module sale reads (raw table access, no cross-module type
  // import — the exact same discipline `sale-consumption.ts` and
  // `SalesRepository.listSummaries` already established). ---------------

  /** Locks the original `sales` row for the duration of refund creation —
   * the serialization boundary Part B/L requires: every concurrent
   * `POST /refunds` attempt against the *same* sale blocks here until the
   * first one commits or rolls back, so the cumulative-quantity check
   * below is race-free without a trigger. */
  public async lockSaleForRefund(
    client: RefundTransaction,
    companyId: string,
    branchIds: readonly string[],
    saleId: string,
  ): Promise<RefundableSaleRow | null> {
    const row = result<{
      id: string;
      company_id: string;
      branch_id: string;
      status: string;
      sale_number: string;
      currency_code: string;
      total: string;
    }>(
      await client.query(
        `select id,company_id,branch_id,status,sale_number,currency_code,total::text
         from sales where company_id=$1 and id=$2 and branch_id=any($3::uuid[]) for update`,
        [companyId, saleId, branchIds],
      ),
    ).rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      companyId: row.company_id,
      branchId: row.branch_id,
      status: row.status,
      saleNumber: row.sale_number,
      currencyCode: row.currency_code,
      total: row.total,
    };
  }

  /** A plain, unlocked read of the original sale — used only by E081's
   * own preview (`RefundsService.refundableBalance`); `createRefund`
   * re-locks and re-validates for real (`lockSaleForRefund`) before
   * committing anything. */
  public async saleForRead(
    companyId: string,
    branchIds: readonly string[],
    saleId: string,
  ): Promise<RefundableSaleRow | null> {
    const row = result<{
      id: string;
      company_id: string;
      branch_id: string;
      status: string;
      sale_number: string;
      currency_code: string;
      total: string;
    }>(
      await this.database.pool.query(
        `select id,company_id,branch_id,status,sale_number,currency_code,total::text
         from sales where company_id=$1 and id=$2 and branch_id=any($3::uuid[])`,
        [companyId, saleId, branchIds],
      ),
    ).rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      companyId: row.company_id,
      branchId: row.branch_id,
      status: row.status,
      saleNumber: row.sale_number,
      currencyCode: row.currency_code,
      total: row.total,
    };
  }

  /** The unlocked counterpart to `refundedQuantitiesForSaleItems` — same
   * query, reads straight from the pool (no transaction client) for
   * E081's own preview. */
  public async refundedQuantitiesForSaleItemsUnlocked(
    companyId: string,
    saleItemIds: readonly string[],
  ): Promise<Map<string, string>> {
    if (saleItemIds.length === 0) return new Map();
    const rows = result<{ sale_item_id: string; refunded: string }>(
      await this.database.pool.query(
        `select ri.sale_item_id, coalesce(sum(ri.quantity),0)::text as refunded
         from refund_items ri
         join refunds r on r.company_id=ri.company_id and r.id=ri.refund_id
         where ri.company_id=$1 and ri.sale_item_id=any($2::uuid[]) and r.status in ('approved','completed')
         group by ri.sale_item_id`,
        [companyId, saleItemIds],
      ),
    ).rows;
    return new Map(rows.map((row) => [row.sale_item_id, row.refunded]));
  }

  public async saleItemsForSale(
    companyId: string,
    saleId: string,
  ): Promise<readonly RefundableSaleItemRow[]> {
    const rows = result<{
      id: string;
      sale_id: string;
      product_variant_id: string | null;
      name_snapshot: string;
      quantity: string;
      unit_price: string;
      tax_snapshot: { tax_code?: string; basis_points?: number } | null;
    }>(
      await this.database.pool.query(
        `select id,sale_id,product_variant_id,name_snapshot,quantity::text,unit_price::text,tax_snapshot
         from sale_items where company_id=$1 and sale_id=$2 order by line_number asc`,
        [companyId, saleId],
      ),
    ).rows;
    return rows.map((row) => ({
      id: row.id,
      saleId: row.sale_id,
      productVariantId: row.product_variant_id,
      nameSnapshot: row.name_snapshot,
      quantity: row.quantity,
      unitPrice: row.unit_price,
      taxSnapshot: row.tax_snapshot,
    }));
  }

  /** Cumulative quantity already refunded per sale item — counts only
   * `approved`/`completed` refunds (Part B: "never allow cumulative
   * returns greater than original sold quantity"). Must be called against
   * a client already holding `lockSaleForRefund`'s row lock so the sum is
   * race-free against a concurrent second refund attempt on this sale. */
  public async refundedQuantitiesForSaleItems(
    client: RefundTransaction,
    companyId: string,
    saleItemIds: readonly string[],
  ): Promise<Map<string, string>> {
    if (saleItemIds.length === 0) return new Map();
    const rows = result<{ sale_item_id: string; refunded: string }>(
      await client.query(
        `select ri.sale_item_id, coalesce(sum(ri.quantity),0)::text as refunded
         from refund_items ri
         join refunds r on r.company_id=ri.company_id and r.id=ri.refund_id
         where ri.company_id=$1 and ri.sale_item_id=any($2::uuid[]) and r.status in ('approved','completed')
         group by ri.sale_item_id`,
        [companyId, saleItemIds],
      ),
    ).rows;
    return new Map(rows.map((row) => [row.sale_item_id, row.refunded]));
  }

  /** Whether each sale-item variant tracks inventory — drives the
   * server-derived `restock`/`no_restock` disposition (Part I: no
   * disposition-selection UI exists in this pass). */
  public async trackedVariantIds(
    companyId: string,
    variantIds: readonly string[],
  ): Promise<ReadonlySet<string>> {
    if (variantIds.length === 0) return new Set();
    const rows = result<{ id: string }>(
      await this.database.pool.query(
        `select id from product_variants where company_id=$1 and id=any($2::uuid[]) and tracks_inventory=true`,
        [companyId, variantIds],
      ),
    ).rows;
    return new Set(rows.map((row) => row.id));
  }

  /** The sale's own single captured payment — this codebase never builds
   * split payments (confirmed by inspection: `Sale` has no
   * multi-payment UI/contract anywhere), so "the captured payment for a
   * sale" is unambiguous today. Returns `null` for a sale with no
   * captured payment at all (should be unreachable for a `completed`
   * sale, per invariant 10, but never assumed). */
  public async capturedPaymentForSale(
    companyId: string,
    saleId: string,
  ): Promise<CapturedPaymentRow | null> {
    const row = result<{
      id: string;
      sale_id: string;
      branch_id: string;
      payment_method: CapturedPaymentRow['paymentMethod'];
      amount: string;
      status: string;
      terminal_id: string | null;
      provider: string | null;
    }>(
      await this.database.pool.query(
        `select id,sale_id,branch_id,payment_method,amount::text,status,terminal_id,provider
         from payments where company_id=$1 and sale_id=$2 and status='captured'
         order by created_at asc limit 1`,
        [companyId, saleId],
      ),
    ).rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      saleId: row.sale_id,
      branchId: row.branch_id,
      paymentMethod: row.payment_method,
      amount: row.amount,
      status: row.status,
      terminalId: row.terminal_id,
      provider: row.provider,
    };
  }

  // --- Refunds -------------------------------------------------------------

  public async insertRefund(
    client: RefundTransaction,
    input: {
      id: string;
      companyId: string;
      branchId: string;
      saleId: string;
      refundNumber: string;
      status: RefundStatus;
      refundMethod: RefundRow['refundMethod'];
      reasonCode: string;
      reasonNote: string | null;
      currencyCode: string;
      subtotal: string;
      taxTotal: string;
      total: string;
      occurredAt: Date;
      createdBy: string;
      approvedBy: string | null;
      deviceId: string | null;
    },
  ): Promise<RefundRow> {
    const row = result<RefundDb>(
      await client.query(
        `insert into refunds
         (id,company_id,branch_id,sale_id,refund_number,status,refund_method,reason_code,reason_note,
          currency_code,subtotal,tax_total,total,occurred_at,created_by,approved_by,device_id,created_at,updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18)
         returning ${REFUND_COLUMNS}`,
        [
          input.id,
          input.companyId,
          input.branchId,
          input.saleId,
          input.refundNumber,
          input.status,
          input.refundMethod,
          input.reasonCode,
          input.reasonNote,
          input.currencyCode,
          input.subtotal,
          input.taxTotal,
          input.total,
          input.occurredAt,
          input.createdBy,
          input.approvedBy,
          input.deviceId,
          input.occurredAt,
        ],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Refund insertion did not return a row.');
    return refund(row);
  }

  public async insertRefundItem(
    client: RefundTransaction,
    input: {
      id: string;
      companyId: string;
      branchId: string;
      refundId: string;
      saleItemId: string;
      quantity: string;
      subtotal: string;
      taxTotal: string;
      lineTotal: string;
      restockDisposition: RefundItemDisposition;
      timestamp: Date;
    },
  ): Promise<RefundItemRow> {
    const row = result<RefundItemDb>(
      await client.query(
        `insert into refund_items
         (id,company_id,branch_id,refund_id,sale_item_id,quantity,subtotal,tax_total,line_total,restock_disposition,created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         returning ${REFUND_ITEM_COLUMNS}`,
        [
          input.id,
          input.companyId,
          input.branchId,
          input.refundId,
          input.saleItemId,
          input.quantity,
          input.subtotal,
          input.taxTotal,
          input.lineTotal,
          input.restockDisposition,
          input.timestamp,
        ],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Refund item insertion did not return a row.');
    return refundItem(row);
  }

  public async refund(companyId: string, branchIds: readonly string[], id: string): Promise<RefundRow | null> {
    const row = result<RefundDb>(
      await this.database.pool.query(
        `select ${REFUND_COLUMNS} from refunds where company_id=$1 and id=$2 and branch_id=any($3::uuid[])`,
        [companyId, id, branchIds],
      ),
    ).rows[0];
    return row === undefined ? null : refund(row);
  }

  public async refundItems(companyId: string, refundId: string): Promise<RefundItemRow[]> {
    const rows = result<RefundItemDb>(
      await this.database.pool.query(
        `select ${REFUND_ITEM_COLUMNS} from refund_items where company_id=$1 and refund_id=$2`,
        [companyId, refundId],
      ),
    ).rows;
    return rows.map(refundItem);
  }

  public async lockRefund(
    client: RefundTransaction,
    companyId: string,
    branchIds: readonly string[],
    id: string,
  ): Promise<RefundRow | null> {
    const row = result<RefundDb>(
      await client.query(
        `select ${REFUND_COLUMNS} from refunds
         where company_id=$1 and id=$2 and branch_id=any($3::uuid[]) for update`,
        [companyId, id, branchIds],
      ),
    ).rows[0];
    return row === undefined ? null : refund(row);
  }

  public async completeRefund(
    client: RefundTransaction,
    companyId: string,
    id: string,
    expectedVersion: bigint,
    input: { paymentId: string; cashSessionId: string | null; completedAt: Date },
  ): Promise<RefundRow> {
    const row = result<RefundDb>(
      await client.query(
        `update refunds set
           status='completed',
           payment_id=$3,
           cash_session_id=$4,
           completed_at=$5,
           updated_at=$5,
           version=version+1
         where company_id=$1 and id=$2 and version=$6
         returning ${REFUND_COLUMNS}`,
        [companyId, id, input.paymentId, input.cashSessionId, input.completedAt, expectedVersion.toString()],
      ),
    ).rows[0];
    if (row === undefined) throw new RefundError('version_conflict', 'The refund version changed.');
    return refund(row);
  }

  public async listRefunds(
    companyId: string,
    branchIds: readonly string[],
    input: {
      limit: number;
      cursor?: string;
      branchId?: string;
      saleId?: string;
      status?: string;
      occurredFrom?: Date;
      occurredTo?: Date;
    },
  ): Promise<{ items: RefundRow[]; nextCursor: string | null }> {
    const values: unknown[] = [companyId, branchIds];
    const where = ['company_id=$1', 'branch_id=any($2::uuid[])'];
    if (input.branchId !== undefined) {
      values.push(input.branchId);
      where.push(`branch_id=$${String(values.length)}`);
    }
    if (input.saleId !== undefined) {
      values.push(input.saleId);
      where.push(`sale_id=$${String(values.length)}`);
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
    if (input.cursor !== undefined) {
      const decoded = decodeRefundCursor(input.cursor);
      values.push(decoded.occurredAt, decoded.id);
      where.push(`(occurred_at,id)<($${String(values.length - 1)},$${String(values.length)})`);
    }
    values.push(input.limit + 1);
    const rows = result<RefundDb>(
      await this.database.pool.query(
        `select ${REFUND_COLUMNS} from refunds where ${where.join(' and ')}
         order by occurred_at desc, id desc limit $${String(values.length)}`,
        values,
      ),
    ).rows;
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit).map(refund);
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last !== undefined ? encodeRefundCursor(last.occurredAt, last.id) : null,
    };
  }

  private mapDatabaseError(error: unknown): unknown {
    switch (constraint(error)) {
      case 'refunds_company_branch_number_uq':
        return new RefundError('validation_error', 'This refund number was already used.');
      case 'refund_items_refund_sale_item_uq':
        return new RefundError('validation_error', 'This sale item was already listed on this refund.');
      case 'cash_movements_refund_reference_uq':
        return new RefundError('validation_error', 'A cash movement for this refund was already recorded.');
      case 'inventory_movements_refund_reference_uq':
        return new RefundError('validation_error', 'An inventory movement for this refund was already recorded.');
      default:
        return error;
    }
  }
}

/** Same opaque `(occurred_at, id)` cursor shape ADR-0013/ADR-0014 already
 * established — reused verbatim. */
export function encodeRefundCursor(occurredAt: Date, id: string): string {
  return Buffer.from(JSON.stringify([occurredAt.toISOString(), id]), 'utf8').toString('base64url');
}
export function decodeRefundCursor(cursor: string): { occurredAt: Date; id: string } {
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
    throw new RefundError('validation_error', 'The cursor is invalid.');
  }
}
