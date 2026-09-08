import { randomUUID } from 'node:crypto';

import type { DatabaseClient } from '@asone/database';

import { SupplierError, type SupplierMutationContext, type SupplierRow, type SupplierStatus } from './suppliers.types.js';

/** Structurally identical to `PurchaseTransaction`/`CustomerTransaction` —
 * see ADR-0013's original rationale, reused verbatim across every module
 * that has followed since (this codebase's established (non-)convention:
 * every module keeps its own small copy, never a shared one). */
export interface SupplierTransaction {
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

const SUPPLIER_COLUMNS =
  'id,company_id,name,contact_name,phone,email,notes,status,created_by,updated_by,created_at,updated_at';

interface SupplierDb {
  id: string;
  company_id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  status: SupplierStatus;
  created_by: string;
  updated_by: string;
  created_at: Date | string;
  updated_at: Date | string;
}
interface IdempotencyDb {
  request_hash: string;
  response_body: unknown;
}

function supplier(row: SupplierDb): SupplierRow {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    contactName: row.contact_name,
    phone: row.phone,
    email: row.email,
    notes: row.notes,
    status: row.status,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export interface InsertSupplierInput {
  id: string;
  companyId: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  createdBy: string;
  timestamp: Date;
}

export interface UpdateSupplierFields {
  name?: string;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  status?: SupplierStatus;
  updatedBy: string;
  timestamp: Date;
}

export interface ListSuppliersOptions {
  status: SupplierStatus | null;
  cursor: { createdAt: Date; id: string } | null;
  limit: number;
}

export class SuppliersRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async transaction<T>(callback: (client: SupplierTransaction) => Promise<T>): Promise<T> {
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

  /** Same shape as `PurchasingRepository.idempotent` — a durable advisory
   * lock scoped to `(company, operation, key)`, an `idempotency_keys` row
   * inserted BEFORE `create()` runs, and a replay short-circuit on a
   * matching hash. Reserved for the create mutation only, per this wave's
   * explicit instruction. */
  public async idempotent<T>(
    client: SupplierTransaction,
    context: SupplierMutationContext,
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
        throw new SupplierError('idempotency_conflict', 'The idempotency key was used with another request.');
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

  /** Company-wide, never branch-scoped — a supplier belongs to the
   * company, not a single branch, exactly like `CustomersRepository.
   * auditAndPublish` (Part A precedent for this same company-only
   * dimension). */
  public async auditAndPublish(
    client: SupplierTransaction,
    context: SupplierMutationContext,
    input: {
      action: string;
      resourceType: 'supplier';
      resourceId: string;
      eventType: string;
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
       values ($1,$2,null,$3,1,$4,$5,1,$6,$7::jsonb,$8,$8,$8)`,
      [
        randomUUID(),
        context.companyId,
        input.eventType,
        input.resourceType,
        input.resourceId,
        context.correlationId,
        JSON.stringify(input.payload),
        context.timestamp,
      ],
    );
  }

  public async insertSupplier(client: SupplierTransaction, input: InsertSupplierInput): Promise<SupplierRow> {
    const row = result<SupplierDb>(
      await client.query(
        `insert into suppliers
         (id,company_id,name,contact_name,phone,email,notes,status,created_by,updated_by,created_at,updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,'active',$8,$8,$9,$9)
         returning ${SUPPLIER_COLUMNS}`,
        [
          input.id,
          input.companyId,
          input.name,
          input.contactName,
          input.phone,
          input.email,
          input.notes,
          input.createdBy,
          input.timestamp,
        ],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Supplier insertion did not return a row.');
    return supplier(row);
  }

  public async updateSupplier(
    client: SupplierTransaction,
    companyId: string,
    id: string,
    fields: UpdateSupplierFields,
  ): Promise<SupplierRow> {
    const assignments: string[] = [];
    const values: unknown[] = [];
    let index = 1;
    const set = (column: string, value: unknown): void => {
      assignments.push(`${column}=$${String(index)}`);
      values.push(value);
      index += 1;
    };
    if (fields.name !== undefined) set('name', fields.name);
    if (fields.contactName !== undefined) set('contact_name', fields.contactName);
    if (fields.phone !== undefined) set('phone', fields.phone);
    if (fields.email !== undefined) set('email', fields.email);
    if (fields.notes !== undefined) set('notes', fields.notes);
    if (fields.status !== undefined) set('status', fields.status);
    set('updated_by', fields.updatedBy);
    set('updated_at', fields.timestamp);
    const companyParam = index;
    values.push(companyId);
    index += 1;
    const idParam = index;
    values.push(id);
    const updated = result<{ id: string }>(
      await client.query(
        `update suppliers set ${assignments.join(',')}
         where company_id=$${String(companyParam)} and id=$${String(idParam)}
         returning id`,
        values,
      ),
    ).rows[0];
    if (updated === undefined) throw new SupplierError('resource_not_found', 'The supplier was not found.');
    const row = await this.supplier(client, companyId, id);
    if (row === null) throw new Error('Supplier update did not return a row.');
    return row;
  }

  public async supplier(
    client: SupplierTransaction | null,
    companyId: string,
    id: string,
  ): Promise<SupplierRow | null> {
    const row = result<SupplierDb>(
      await (client ?? this.database.pool).query(
        `select ${SUPPLIER_COLUMNS} from suppliers where company_id=$1 and id=$2`,
        [companyId, id],
      ),
    ).rows[0];
    return row === undefined ? null : supplier(row);
  }

  /** Part — the pre-insert/pre-update conflict check. Exact-match, never
   * case-insensitive — matches `suppliers_company_name_uq`'s own exact
   * `text` unique index precisely, so this pre-check and the database's
   * own constraint can never disagree about what counts as a duplicate. */
  public async supplierByName(
    client: SupplierTransaction | null,
    companyId: string,
    name: string,
  ): Promise<SupplierRow | null> {
    const row = result<SupplierDb>(
      await (client ?? this.database.pool).query(
        `select ${SUPPLIER_COLUMNS} from suppliers where company_id=$1 and name=$2`,
        [companyId, name],
      ),
    ).rows[0];
    return row === undefined ? null : supplier(row);
  }

  public async listSuppliers(companyId: string, options: ListSuppliersOptions): Promise<SupplierRow[]> {
    const conditions = ['company_id=$1'];
    const values: unknown[] = [companyId];
    let index = 2;
    if (options.status !== null) {
      conditions.push(`status=$${String(index)}`);
      values.push(options.status);
      index += 1;
    }
    if (options.cursor !== null) {
      conditions.push(`(created_at,id) < ($${String(index)},$${String(index + 1)})`);
      values.push(options.cursor.createdAt, options.cursor.id);
      index += 2;
    }
    values.push(options.limit + 1);
    const rows = result<SupplierDb>(
      await this.database.pool.query(
        `select ${SUPPLIER_COLUMNS} from suppliers
         where ${conditions.join(' and ')}
         order by created_at desc, id desc
         limit $${String(index)}`,
        values,
      ),
    ).rows;
    return rows.map(supplier);
  }

  private mapDatabaseError(error: unknown): unknown {
    switch (constraint(error)) {
      case 'suppliers_company_name_uq':
        return new SupplierError('resource_conflict', 'A supplier with this name already exists.');
      default:
        return error;
    }
  }
}

/** Same opaque `(created_at, id)` cursor shape ADR-0013/ADR-0014 already
 * established for every other "reverse-chronological" list — reused
 * verbatim (each module keeps its own small copy). */
export function encodeSupplierCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify([createdAt.toISOString(), id]), 'utf8').toString('base64url');
}
export function decodeSupplierCursor(cursor: string): { createdAt: Date; id: string } {
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
    throw new SupplierError('validation_error', 'The cursor is invalid.');
  }
}
