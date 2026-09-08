import { randomUUID } from 'node:crypto';

import type { DatabaseClient } from '@asone/database';

import {
  HeldSaleCartError,
  type HeldSaleCartItem,
  type HeldSaleCartMutationContext,
  type HeldSaleCartRow,
  type HeldSaleCartStatus,
} from './held-sales.types.js';

/** Structurally identical to `SaleTransaction`/`CashTransaction` on
 * purpose — see those files' own doc comments. */
export interface HeldSaleCartTransaction {
  query(sql: string, values?: readonly unknown[]): Promise<unknown>;
}

interface QueryResult<T> {
  rows: T[];
}
function result<T>(value: unknown): QueryResult<T> {
  return value as QueryResult<T>;
}
function jsonValue(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

interface HeldSaleCartDb {
  id: string;
  company_id: string;
  branch_id: string;
  cash_register_id: string | null;
  customer_id: string | null;
  label: string | null;
  items: unknown;
  status: string;
  created_by: string;
  claimed_at: Date | string | null;
  claimed_by: string | null;
  resumed_at: Date | string | null;
  resumed_by: string | null;
  resumed_sale_id: string | null;
  discarded_at: Date | string | null;
  discarded_by: string | null;
  created_at: Date | string;
}
interface IdempotencyDb {
  request_hash: string;
  response_body: unknown;
}

const HELD_SALE_CART_COLUMNS =
  'id,company_id,branch_id,cash_register_id,customer_id,label,items,status,created_by,claimed_at,claimed_by,resumed_at,resumed_by,resumed_sale_id,discarded_at,discarded_by,created_at';

function parseItems(raw: unknown): readonly HeldSaleCartItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
    .map((entry) => ({ productId: String(entry.productId), quantity: String(entry.quantity) }));
}

/** TASK 14.3A (Wave 1 hardening) — a plain, honest 1:1 mapping. Every
 * column here holds a real value or a genuine SQL NULL — no sentinel,
 * no translation. `resumedSaleId` is `null` in every state except the
 * real, terminal `'resumed'`, where it always holds a real sale id (see
 * `packages/database/src/schema/held-sales.ts`'s own top doc comment for
 * the full state-machine reasoning this replaced the earlier
 * self-referential-sentinel design with). */
function heldSaleCart(row: HeldSaleCartDb): HeldSaleCartRow {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    cashRegisterId: row.cash_register_id,
    customerId: row.customer_id,
    label: row.label,
    items: parseItems(row.items),
    status: row.status as HeldSaleCartStatus,
    createdBy: row.created_by,
    claimedAt: row.claimed_at === null ? null : new Date(row.claimed_at),
    claimedBy: row.claimed_by,
    resumedAt: row.resumed_at === null ? null : new Date(row.resumed_at),
    resumedBy: row.resumed_by,
    resumedSaleId: row.resumed_sale_id,
    discardedAt: row.discarded_at === null ? null : new Date(row.discarded_at),
    discardedBy: row.discarded_by,
    createdAt: new Date(row.created_at),
  };
}

export class HeldSaleCartsRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async transaction<T>(callback: (client: HeldSaleCartTransaction) => Promise<T>): Promise<T> {
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      const value = await callback(client);
      await client.query('commit');
      return value;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Copied verbatim from `CashRepository.idempotent`/`SalesRepository.
   * idempotent` — same advisory-lock-then-insert-placeholder-then-fill
   * pattern, never a project-invented variant. */
  public async idempotent<T>(
    client: HeldSaleCartTransaction,
    context: HeldSaleCartMutationContext,
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
        throw new HeldSaleCartError('idempotency_conflict', 'The idempotency key was used with another request.');
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

  /** Mirrors `CashRepository.auditAndPublish` exactly (a real `branch_id`
   * on every event, like every other branch-scoped resource in this
   * codebase) — `held_sale_carts` has no `version` column at all (no
   * optimistic-concurrency needed: every state transition here is
   * already CAS-guarded by its own `status='held'`/`status='resumed'`
   * `WHERE` clause, see `markResumed`/`markDiscarded`/`linkSale` below),
   * so `aggregate_version` is a fixed per-transition generation number
   * (1=created, 2=resumed/discarded, 3=linked), mirroring
   * `cash_movements`' own established "no real version column, so pass a
   * fixed constant" precedent (`CashService.createMovement`'s
   * `version: 1n`). */
  public async auditAndPublish(
    client: HeldSaleCartTransaction,
    context: HeldSaleCartMutationContext,
    input: {
      action: string;
      resourceId: string;
      eventType: string;
      branchId: string;
      generation: 1n | 2n | 3n;
      payload: Readonly<Record<string, unknown>>;
    },
  ): Promise<void> {
    await client.query(
      `insert into audit_log
       (id,company_id,actor_type,actor_id,action,entity_type,entity_id,request_id,correlation_id,metadata,occurred_at)
       values ($1,$2,'user',$3,$4,'held_sale_cart',$5,$6,$7,$8::jsonb,$9)`,
      [
        randomUUID(),
        context.companyId,
        context.actorId,
        input.action,
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
       values ($1,$2,$3,$4,1,'held_sale_cart',$5,$6,$7,$8::jsonb,$9,$9,$9)`,
      [
        randomUUID(),
        context.companyId,
        input.branchId,
        input.eventType,
        input.resourceId,
        input.generation.toString(),
        context.correlationId,
        JSON.stringify(input.payload),
        context.timestamp,
      ],
    );
  }

  // --- Create ------------------------------------------------------------

  public async insertCart(
    client: HeldSaleCartTransaction,
    input: {
      id: string;
      companyId: string;
      branchId: string;
      cashRegisterId: string | null;
      customerId: string | null;
      label: string | null;
      items: readonly HeldSaleCartItem[];
      createdBy: string;
      timestamp: Date;
    },
  ): Promise<HeldSaleCartRow> {
    const row = result<HeldSaleCartDb>(
      await client.query(
        `insert into held_sale_carts
         (id,company_id,branch_id,cash_register_id,customer_id,label,items,status,created_by,created_at)
         values ($1,$2,$3,$4,$5,$6,$7::jsonb,'held',$8,$9)
         returning ${HELD_SALE_CART_COLUMNS}`,
        [
          input.id,
          input.companyId,
          input.branchId,
          input.cashRegisterId,
          input.customerId,
          input.label,
          JSON.stringify(input.items),
          input.createdBy,
          input.timestamp,
        ],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Held sale cart insertion did not return a row.');
    return heldSaleCart(row);
  }

  // --- Read ----------------------------------------------------------------

  public async cart(companyId: string, id: string): Promise<HeldSaleCartRow | null> {
    const row = result<HeldSaleCartDb>(
      await this.database.pool.query(
        `select ${HELD_SALE_CART_COLUMNS} from held_sale_carts where company_id=$1 and id=$2`,
        [companyId, id],
      ),
    ).rows[0];
    return row === undefined ? null : heldSaleCart(row);
  }

  public async lockCart(client: HeldSaleCartTransaction, companyId: string, id: string): Promise<HeldSaleCartRow | null> {
    const row = result<HeldSaleCartDb>(
      await client.query(
        `select ${HELD_SALE_CART_COLUMNS} from held_sale_carts where company_id=$1 and id=$2 for update`,
        [companyId, id],
      ),
    ).rows[0];
    return row === undefined ? null : heldSaleCart(row);
  }

  /** Newest-first, paginated — the same opaque `(created_at,id)` cursor
   * shape `SalesRepository.listSales`/`CashRepository.listSessions`
   * already established, reused rather than a bespoke third format. */
  public async listCarts(
    companyId: string,
    branchIds: readonly string[],
    input: { limit: number; cursor?: string; branchId?: string; status?: HeldSaleCartStatus; cashRegisterId?: string },
  ): Promise<{ items: HeldSaleCartRow[]; nextCursor: string | null }> {
    const values: unknown[] = [companyId, branchIds];
    const where = ['company_id=$1', 'branch_id=any($2::uuid[])'];
    if (input.branchId !== undefined) {
      values.push(input.branchId);
      where.push(`branch_id=$${String(values.length)}`);
    }
    if (input.status !== undefined) {
      values.push(input.status);
      where.push(`status=$${String(values.length)}`);
    }
    if (input.cashRegisterId !== undefined) {
      values.push(input.cashRegisterId);
      where.push(`cash_register_id=$${String(values.length)}`);
    }
    if (input.cursor !== undefined) {
      const decoded = decodeHeldSaleCartCursor(input.cursor);
      values.push(decoded.createdAt, decoded.id);
      where.push(`(created_at,id)<($${String(values.length - 1)},$${String(values.length)})`);
    }
    values.push(input.limit + 1);
    const rows = result<HeldSaleCartDb>(
      await this.database.pool.query(
        `select ${HELD_SALE_CART_COLUMNS} from held_sale_carts where ${where.join(' and ')}
         order by created_at desc, id desc limit $${String(values.length)}`,
        values,
      ),
    ).rows;
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit).map(heldSaleCart);
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last !== undefined ? encodeHeldSaleCartCursor(last.createdAt, last.id) : null,
    };
  }

  // --- State transitions ---------------------------------------------------

  /** `held -> resuming` — the real, honest first half of the two-step
   * handshake (TASK 14.3A). `status='held'` in the `WHERE` clause is the
   * whole race-free claim guarantee (no `version` column exists on this
   * table to `if-match` against): a concurrent second claim attempt
   * simply finds zero rows to update and gets back `undefined`, exactly
   * like a version-conflict would elsewhere — deterministic, and never a
   * duplicate claim. Sets ONLY `claimed_at`/`claimed_by`; `resumed_at`/
   * `resumed_by`/`resumed_sale_id` stay genuinely NULL — no sale exists
   * yet, and this row says so honestly. */
  public async claimCart(
    client: HeldSaleCartTransaction,
    companyId: string,
    id: string,
    input: { claimedAt: Date; claimedBy: string },
  ): Promise<HeldSaleCartRow | null> {
    const row = result<HeldSaleCartDb>(
      await client.query(
        `update held_sale_carts
         set status='resuming', claimed_at=$3, claimed_by=$4
         where company_id=$1 and id=$2 and status='held'
         returning ${HELD_SALE_CART_COLUMNS}`,
        [companyId, id, input.claimedAt, input.claimedBy],
      ),
    ).rows[0];
    return row === undefined ? null : heldSaleCart(row);
  }

  /** `resuming -> resumed` — the real, terminal second half. `status=
   * 'resuming'` in the `WHERE` clause is the CAS guard: callable exactly
   * once per cart (a concurrent or repeated second call finds the row no
   * longer `'resuming'` and matches zero rows). Sets `resumed_at`/
   * `resumed_by`/`resumed_sale_id` together, atomically, to a real,
   * already-verified sale id — never a placeholder of any kind. */
  public async linkSale(
    client: HeldSaleCartTransaction,
    companyId: string,
    id: string,
    saleId: string,
    input: { resumedAt: Date; resumedBy: string },
  ): Promise<HeldSaleCartRow | null> {
    const row = result<HeldSaleCartDb>(
      await client.query(
        `update held_sale_carts
         set status='resumed', resumed_at=$4, resumed_by=$5, resumed_sale_id=$3
         where company_id=$1 and id=$2 and status='resuming'
         returning ${HELD_SALE_CART_COLUMNS}`,
        [companyId, id, saleId, input.resumedAt, input.resumedBy],
      ),
    ).rows[0];
    return row === undefined ? null : heldSaleCart(row);
  }

  /** `resuming -> held` — TASK 14.3A's explicit recovery rule for an
   * abandoned claim (a cashier claimed a cart, then genuinely never
   * finished checkout — no automatic/background expiry, no hidden
   * magic: a real, permission-gated, audited action, matching this
   * task's own "do not over-engineer this into a distributed workflow
   * system" instruction). `claimed_at`/`claimed_by` are deliberately
   * NOT cleared here — see the schema's own top doc comment for why. */
  public async releaseCart(
    client: HeldSaleCartTransaction,
    companyId: string,
    id: string,
  ): Promise<HeldSaleCartRow | null> {
    const row = result<HeldSaleCartDb>(
      await client.query(
        `update held_sale_carts
         set status='held'
         where company_id=$1 and id=$2 and status='resuming'
         returning ${HELD_SALE_CART_COLUMNS}`,
        [companyId, id],
      ),
    ).rows[0];
    return row === undefined ? null : heldSaleCart(row);
  }

  /** Discardable from either `held` (never claimed) or `resuming`
   * (claimed, then abandoned without releasing first) — a manager
   * cleaning up a stuck claim can discard it directly without an extra
   * release round-trip. Never discardable once `resumed` (a real sale
   * already exists from it). */
  public async markDiscarded(
    client: HeldSaleCartTransaction,
    companyId: string,
    id: string,
    input: { discardedAt: Date; discardedBy: string },
  ): Promise<HeldSaleCartRow | null> {
    const row = result<HeldSaleCartDb>(
      await client.query(
        `update held_sale_carts
         set status='discarded', discarded_at=$3, discarded_by=$4
         where company_id=$1 and id=$2 and status in ('held','resuming')
         returning ${HELD_SALE_CART_COLUMNS}`,
        [companyId, id, input.discardedAt, input.discardedBy],
      ),
    ).rows[0];
    return row === undefined ? null : heldSaleCart(row);
  }
}

export function encodeHeldSaleCartCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify([createdAt.toISOString(), id]), 'utf8').toString('base64url');
}
export function decodeHeldSaleCartCursor(cursor: string): { createdAt: Date; id: string } {
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
    throw new HeldSaleCartError('validation_error', 'The cursor is invalid.');
  }
}
