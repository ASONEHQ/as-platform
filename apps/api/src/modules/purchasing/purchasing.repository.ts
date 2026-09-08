import { randomUUID } from 'node:crypto';

import type { DatabaseClient } from '@asone/database';

import { PurchaseError, type PurchaseMutationContext, type DirectPurchaseRow } from './purchasing.types.js';

/** Structurally identical to `RefundTransaction`/`CashTransaction`/
 * `SaleTransaction` on purpose — see ADR-0013's original rationale,
 * reused verbatim across every module that has followed since. */
export interface PurchaseTransaction {
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

const DIRECT_PURCHASE_COLUMNS =
  'id,company_id,branch_id,supplier_name,product_variant_id,quantity,unit_cost,currency_code,total_cost,purchase_date,notes,inventory_movement_id,created_by,created_at';

interface DirectPurchaseDb {
  id: string;
  company_id: string;
  branch_id: string;
  supplier_name: string | null;
  product_variant_id: string;
  quantity: string;
  unit_cost: string;
  currency_code: string;
  total_cost: string;
  purchase_date: string;
  notes: string | null;
  inventory_movement_id: string;
  created_by: string;
  created_at: Date | string;
}
interface IdempotencyDb {
  request_hash: string;
  response_body: unknown;
}

function directPurchase(row: DirectPurchaseDb): DirectPurchaseRow {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    supplierName: row.supplier_name,
    productVariantId: row.product_variant_id,
    quantity: row.quantity,
    unitCost: row.unit_cost,
    currencyCode: row.currency_code,
    totalCost: row.total_cost,
    purchaseDate: row.purchase_date,
    notes: row.notes,
    inventoryMovementId: row.inventory_movement_id,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
  };
}

export class PurchasingRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async transaction<T>(callback: (client: PurchaseTransaction) => Promise<T>): Promise<T> {
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

  /** Same shape as `RefundsRepository.idempotent` — a durable advisory
   * lock scoped to `(company, operation, key)`, an `idempotency_keys` row
   * inserted BEFORE `create()` runs, and a replay short-circuit on a
   * matching hash. If `create()` throws (e.g. an invalid
   * `product_variant_id`), the whole enclosing transaction — including
   * this very `idempotency_keys` insert — rolls back via
   * `transaction()`'s own catch, so a failed attempt leaves no trace to
   * replay against; a genuinely later retry with the same key starts
   * completely fresh. */
  public async idempotent<T>(
    client: PurchaseTransaction,
    context: PurchaseMutationContext,
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
        throw new PurchaseError('idempotency_conflict', 'The idempotency key was used with another request.');
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
    client: PurchaseTransaction,
    context: PurchaseMutationContext,
    input: {
      action: string;
      resourceType: 'direct_purchase';
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

  public async insertDirectPurchase(
    client: PurchaseTransaction,
    input: {
      id: string;
      companyId: string;
      branchId: string;
      supplierName: string | null;
      productVariantId: string;
      quantity: string;
      unitCost: string;
      currencyCode: string;
      totalCost: string;
      purchaseDate: string;
      notes: string | null;
      inventoryMovementId: string;
      createdBy: string;
      timestamp: Date;
    },
  ): Promise<DirectPurchaseRow> {
    const row = result<DirectPurchaseDb>(
      await client.query(
        `insert into direct_purchases
         (id,company_id,branch_id,supplier_name,product_variant_id,quantity,unit_cost,currency_code,
          total_cost,purchase_date,notes,inventory_movement_id,created_by,created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         returning ${DIRECT_PURCHASE_COLUMNS}`,
        [
          input.id,
          input.companyId,
          input.branchId,
          input.supplierName,
          input.productVariantId,
          input.quantity,
          input.unitCost,
          input.currencyCode,
          input.totalCost,
          input.purchaseDate,
          input.notes,
          input.inventoryMovementId,
          input.createdBy,
          input.timestamp,
        ],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Direct purchase insertion did not return a row.');
    return directPurchase(row);
  }

  public async directPurchase(
    companyId: string,
    branchIds: readonly string[],
    id: string,
  ): Promise<DirectPurchaseRow | null> {
    const row = result<DirectPurchaseDb>(
      await this.database.pool.query(
        `select ${DIRECT_PURCHASE_COLUMNS} from direct_purchases
         where company_id=$1 and id=$2 and branch_id=any($3::uuid[])`,
        [companyId, id, branchIds],
      ),
    ).rows[0];
    return row === undefined ? null : directPurchase(row);
  }

  /** The linked movement's identity/status plus, when a balance row still
   * exists for this exact variant/location, its current on-hand quantity
   * — a simple point-in-time join, never a historical reconstruction of
   * "the balance immediately after this specific movement" (this
   * codebase's `inventory_balances` keeps no such per-movement snapshot
   * anywhere else either — see `InventoryPostingService.post`'s own
   * `affected_balance_count` response, which likewise never reports one). */
  public async movementSummary(
    companyId: string,
    movementId: string,
    productVariantId: string,
    branchId: string,
  ): Promise<{
    movementId: string;
    movementNumber: string;
    status: string;
    postedAt: Date | null;
    currentQuantityOnHand: string | null;
  } | null> {
    const row = result<{
      id: string;
      movement_number: string;
      status: string;
      posted_at: Date | string | null;
      quantity_on_hand: string | null;
    }>(
      await this.database.pool.query(
        `select m.id, m.movement_number, m.status, m.posted_at,
                (select b.quantity_on_hand::text from inventory_balances b
                 join inventory_locations l on l.company_id=b.company_id and l.id=b.inventory_location_id
                 where b.company_id=m.company_id and b.branch_id=$3 and b.product_variant_id=$4
                   and l.is_default=true and l.status='active'
                 limit 1) quantity_on_hand
         from inventory_movements m
         where m.company_id=$1 and m.id=$2`,
        [companyId, movementId, branchId, productVariantId],
      ),
    ).rows[0];
    if (row === undefined) return null;
    return {
      movementId: row.id,
      movementNumber: row.movement_number,
      status: row.status,
      postedAt: row.posted_at === null ? null : new Date(row.posted_at),
      currentQuantityOnHand: row.quantity_on_hand,
    };
  }

  public async listDirectPurchases(
    companyId: string,
    branchIds: readonly string[],
    input: {
      limit: number;
      cursor?: string;
      branchId?: string;
      productVariantId?: string;
      purchaseDateFrom?: string;
      purchaseDateTo?: string;
    },
  ): Promise<{ items: DirectPurchaseRow[]; nextCursor: string | null }> {
    const values: unknown[] = [companyId, branchIds];
    const where = ['company_id=$1', 'branch_id=any($2::uuid[])'];
    if (input.branchId !== undefined) {
      values.push(input.branchId);
      where.push(`branch_id=$${String(values.length)}`);
    }
    if (input.productVariantId !== undefined) {
      values.push(input.productVariantId);
      where.push(`product_variant_id=$${String(values.length)}`);
    }
    if (input.purchaseDateFrom !== undefined) {
      values.push(input.purchaseDateFrom);
      where.push(`purchase_date>=$${String(values.length)}`);
    }
    if (input.purchaseDateTo !== undefined) {
      values.push(input.purchaseDateTo);
      where.push(`purchase_date<=$${String(values.length)}`);
    }
    if (input.cursor !== undefined) {
      const decoded = decodeDirectPurchaseCursor(input.cursor);
      values.push(decoded.createdAt, decoded.id);
      where.push(`(created_at,id)<($${String(values.length - 1)},$${String(values.length)})`);
    }
    values.push(input.limit + 1);
    const rows = result<DirectPurchaseDb>(
      await this.database.pool.query(
        `select ${DIRECT_PURCHASE_COLUMNS} from direct_purchases where ${where.join(' and ')}
         order by created_at desc, id desc limit $${String(values.length)}`,
        values,
      ),
    ).rows;
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit).map(directPurchase);
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last !== undefined ? encodeDirectPurchaseCursor(last.createdAt, last.id) : null,
    };
  }

  private mapDatabaseError(error: unknown): unknown {
    switch (constraint(error)) {
      case 'direct_purchases_movement_uq':
        return new PurchaseError(
          'validation_error',
          'A direct purchase for this inventory movement was already recorded.',
        );
      default:
        return error;
    }
  }
}

/** Same opaque `(created_at, id)` cursor shape ADR-0013/ADR-0014 already
 * established for every other "reverse-chronological" list — reused
 * verbatim (each module keeps its own small copy, matching this
 * codebase's established discipline; see `refunds.repository.ts`'s
 * identical `encodeRefundCursor`/`decodeRefundCursor` pair). */
export function encodeDirectPurchaseCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify([createdAt.toISOString(), id]), 'utf8').toString('base64url');
}
export function decodeDirectPurchaseCursor(cursor: string): { createdAt: Date; id: string } {
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
    throw new PurchaseError('validation_error', 'The cursor is invalid.');
  }
}
