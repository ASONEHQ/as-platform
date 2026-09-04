import { randomBytes, randomUUID } from 'node:crypto';

import type { DatabaseClient } from '@asone/database';

import {
  CustomerError,
  type CustomerQrTokenRow,
  type CustomerMutationContext,
  type CustomerRow,
  type CustomerStatus,
} from './customers.types.js';

/** Structurally identical to `PromotionTransaction`/`SaleTransaction` —
 * see ADR-0017 "Repository conventions"; reused verbatim, never shared,
 * matching this codebase's own established (non-)convention. */
export interface CustomerTransaction {
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

const CUSTOMER_COLUMNS =
  'id,company_id,first_name,last_name,display_name,email,normalized_email,phone,normalized_phone,' +
  'phone_country_code,birth_date,status,notes,created_by,updated_by,version,created_at,updated_at';

interface CustomerDb {
  id: string;
  company_id: string;
  first_name: string;
  last_name: string | null;
  display_name: string;
  email: string | null;
  normalized_email: string | null;
  phone: string | null;
  normalized_phone: string | null;
  phone_country_code: string | null;
  birth_date: string | null;
  status: CustomerStatus;
  notes: string | null;
  created_by: string;
  updated_by: string;
  version: string;
  created_at: Date | string;
  updated_at: Date | string;
}
interface IdempotencyDb {
  request_hash: string;
  response_body: unknown;
}
interface QrTokenDb {
  id: string;
  company_id: string;
  customer_id: string;
  token: string;
  status: 'active' | 'revoked';
  created_at: Date | string;
  revoked_at: Date | string | null;
}

function customer(row: CustomerDb): CustomerRow {
  return {
    id: row.id,
    companyId: row.company_id,
    firstName: row.first_name,
    lastName: row.last_name,
    displayName: row.display_name,
    email: row.email,
    normalizedEmail: row.normalized_email,
    phone: row.phone,
    normalizedPhone: row.normalized_phone,
    phoneCountryCode: row.phone_country_code,
    birthDate: row.birth_date,
    status: row.status,
    notes: row.notes,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    version: BigInt(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
function qrToken(row: QrTokenDb): CustomerQrTokenRow {
  return {
    id: row.id,
    companyId: row.company_id,
    customerId: row.customer_id,
    token: row.token,
    status: row.status,
    createdAt: new Date(row.created_at),
    revokedAt: row.revoked_at === null ? null : new Date(row.revoked_at),
  };
}

export interface InsertCustomerInput {
  id: string;
  companyId: string;
  firstName: string;
  lastName: string | null;
  displayName: string;
  email: string | null;
  normalizedEmail: string | null;
  phone: string | null;
  normalizedPhone: string | null;
  phoneCountryCode: string | null;
  birthDate: string | null;
  notes: string | null;
  createdBy: string;
  timestamp: Date;
}

export interface UpdateCustomerFields {
  firstName?: string;
  lastName?: string | null;
  displayName?: string;
  email?: string | null;
  normalizedEmail?: string | null;
  phone?: string | null;
  normalizedPhone?: string | null;
  phoneCountryCode?: string | null;
  birthDate?: string | null;
  status?: CustomerStatus;
  notes?: string | null;
  updatedBy: string;
  timestamp: Date;
}

export interface ListCustomersOptions {
  search: string | null;
  status: CustomerStatus | null;
  cursor: { createdAt: Date; id: string } | null;
  limit: number;
}

export class CustomersRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async transaction<T>(callback: (client: CustomerTransaction) => Promise<T>): Promise<T> {
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
    client: CustomerTransaction,
    context: CustomerMutationContext,
    operation: string,
    key: string,
    requestHash: string,
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
        throw new CustomerError('validation_error', 'The idempotency key was used with another request.');
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
    await client.query(`update idempotency_keys set response_body=$1::jsonb where id=$2`, [
      JSON.stringify(value, jsonValue),
      id,
    ]);
    return { value, replayed: false };
  }

  public async auditAndPublish(
    client: CustomerTransaction,
    context: CustomerMutationContext,
    input: {
      action: string;
      resourceType: 'customer' | 'customer_qr_token';
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
        // Part W — PII (name/email/phone/birth date) never rides in an
        // audit metadata payload; only ids and non-sensitive facts.
        JSON.stringify(input.payload, jsonValue),
        context.timestamp,
      ],
    );
    // Company-wide, never branch-scoped — a customer belongs to the
    // company, not a single branch (Part A).
    await client.query(
      `insert into outbox_events
       (event_id,company_id,branch_id,event_type,schema_version,aggregate_type,aggregate_id,aggregate_version,
        correlation_id,payload,occurred_at,available_at,created_at)
       values ($1,$2,null,$3,1,$4,$5,$6,$7,$8::jsonb,$9,$9,$9)`,
      [
        randomUUID(),
        context.companyId,
        input.eventType,
        input.resourceType,
        input.resourceId,
        input.version.toString(),
        context.correlationId,
        JSON.stringify(input.payload, jsonValue),
        context.timestamp,
      ],
    );
  }

  // --- Customers -------------------------------------------------------

  /** Part D — pre-insert conflict check. Never a substitute for the DB's
   * own unique constraints (concurrent creation is still caught by
   * `mapDatabaseError`); this is what lets the service return a rich,
   * actionable conflict (which existing customer id) instead of a bare
   * constraint-violation message. */
  public async customerByNormalizedEmail(
    client: CustomerTransaction | null,
    companyId: string,
    normalizedEmail: string,
  ): Promise<CustomerRow | null> {
    const row = result<CustomerDb>(
      await (client ?? this.database.pool).query(
        `select ${CUSTOMER_COLUMNS} from customers where company_id=$1 and normalized_email=$2`,
        [companyId, normalizedEmail],
      ),
    ).rows[0];
    return row === undefined ? null : customer(row);
  }

  public async customerByNormalizedPhone(
    client: CustomerTransaction | null,
    companyId: string,
    normalizedPhone: string,
  ): Promise<CustomerRow | null> {
    const row = result<CustomerDb>(
      await (client ?? this.database.pool).query(
        `select ${CUSTOMER_COLUMNS} from customers where company_id=$1 and normalized_phone=$2`,
        [companyId, normalizedPhone],
      ),
    ).rows[0];
    return row === undefined ? null : customer(row);
  }

  public async insertCustomer(client: CustomerTransaction, input: InsertCustomerInput): Promise<CustomerRow> {
    await client.query(
      `insert into customers
       (id,company_id,first_name,last_name,display_name,email,normalized_email,phone,normalized_phone,
        phone_country_code,birth_date,status,notes,created_by,updated_by,created_at,updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active',$12,$13,$13,$14,$14)`,
      [
        input.id,
        input.companyId,
        input.firstName,
        input.lastName,
        input.displayName,
        input.email,
        input.normalizedEmail,
        input.phone,
        input.normalizedPhone,
        input.phoneCountryCode,
        input.birthDate,
        input.notes,
        input.createdBy,
        input.timestamp,
      ],
    );
    const created = await this.customer(client, input.companyId, input.id);
    if (created === null) throw new Error('Customer insertion did not return a row.');
    return created;
  }

  public async updateCustomer(
    client: CustomerTransaction,
    companyId: string,
    id: string,
    expectedVersion: bigint,
    fields: UpdateCustomerFields,
  ): Promise<CustomerRow> {
    const assignments: string[] = [];
    const values: unknown[] = [];
    let index = 1;
    const set = (column: string, value: unknown): void => {
      assignments.push(`${column}=$${String(index)}`);
      values.push(value);
      index += 1;
    };
    if (fields.firstName !== undefined) set('first_name', fields.firstName);
    if (fields.lastName !== undefined) set('last_name', fields.lastName);
    if (fields.displayName !== undefined) set('display_name', fields.displayName);
    if (fields.email !== undefined) set('email', fields.email);
    if (fields.normalizedEmail !== undefined) set('normalized_email', fields.normalizedEmail);
    if (fields.phone !== undefined) set('phone', fields.phone);
    if (fields.normalizedPhone !== undefined) set('normalized_phone', fields.normalizedPhone);
    if (fields.phoneCountryCode !== undefined) set('phone_country_code', fields.phoneCountryCode);
    if (fields.birthDate !== undefined) set('birth_date', fields.birthDate);
    if (fields.status !== undefined) set('status', fields.status);
    if (fields.notes !== undefined) set('notes', fields.notes);
    set('updated_by', fields.updatedBy);
    set('updated_at', fields.timestamp);
    set('version', (expectedVersion + 1n).toString());
    const companyParam = index;
    values.push(companyId);
    index += 1;
    const idParam = index;
    values.push(id);
    index += 1;
    const versionParam = index;
    values.push(expectedVersion.toString());
    const updated = result<{ id: string }>(
      await client.query(
        `update customers set ${assignments.join(',')}
         where company_id=$${String(companyParam)} and id=$${String(idParam)} and version=$${String(versionParam)}
         returning id`,
        values,
      ),
    ).rows[0];
    if (updated === undefined) {
      const current = await this.customer(client, companyId, id);
      if (current === null) throw new CustomerError('resource_not_found', 'The customer was not found.');
      throw new CustomerError('version_conflict', 'The customer was modified by another request.');
    }
    const row = await this.customer(client, companyId, id);
    if (row === null) throw new Error('Customer update did not return a row.');
    return row;
  }

  public async customer(
    client: CustomerTransaction | null,
    companyId: string,
    id: string,
  ): Promise<CustomerRow | null> {
    const row = result<CustomerDb>(
      await (client ?? this.database.pool).query(
        `select ${CUSTOMER_COLUMNS} from customers where company_id=$1 and id=$2`,
        [companyId, id],
      ),
    ).rows[0];
    return row === undefined ? null : customer(row);
  }

  public async listCustomers(companyId: string, options: ListCustomersOptions): Promise<CustomerRow[]> {
    const conditions = ['company_id=$1'];
    const values: unknown[] = [companyId];
    let index = 2;
    if (options.status !== null) {
      conditions.push(`status=$${String(index)}`);
      values.push(options.status);
      index += 1;
    }
    if (options.search !== null) {
      const term = options.search.trim();
      conditions.push(
        `(display_name ilike $${String(index)} or normalized_email=$${String(index + 1)} or normalized_phone=$${String(index + 2)})`,
      );
      values.push(`%${term}%`, term.toLowerCase(), term);
      index += 3;
    }
    if (options.cursor !== null) {
      conditions.push(`(created_at,id) < ($${String(index)},$${String(index + 1)})`);
      values.push(options.cursor.createdAt, options.cursor.id);
      index += 2;
    }
    values.push(options.limit + 1);
    const rows = result<CustomerDb>(
      await this.database.pool.query(
        `select ${CUSTOMER_COLUMNS} from customers
         where ${conditions.join(' and ')}
         order by created_at desc, id desc
         limit $${String(index)}`,
        values,
      ),
    ).rows;
    return rows.map(customer);
  }

  // --- QR tokens ---------------------------------------------------------

  /** Part U — a fresh, opaque, cryptographically random token. Never
   * derived from customer data (no email/phone/name encoded), never
   * sequential. */
  public async issueQrToken(
    client: CustomerTransaction,
    companyId: string,
    customerId: string,
    timestamp: Date,
  ): Promise<CustomerQrTokenRow> {
    await client.query(
      `update customer_qr_tokens set status='revoked', revoked_at=$3
       where company_id=$1 and customer_id=$2 and status='active'`,
      [companyId, customerId, timestamp],
    );
    const id = randomUUID();
    const token = randomBytes(24).toString('base64url');
    await client.query(
      `insert into customer_qr_tokens (id,company_id,customer_id,token,status,created_at)
       values ($1,$2,$3,$4,'active',$5)`,
      [id, companyId, customerId, token, timestamp],
    );
    const row = result<QrTokenDb>(
      await client.query(`select id,company_id,customer_id,token,status,created_at,revoked_at
         from customer_qr_tokens where id=$1`, [id]),
    ).rows[0];
    if (row === undefined) throw new Error('QR token issuance did not return a row.');
    return qrToken(row);
  }

  public async activeQrTokenForCustomer(companyId: string, customerId: string): Promise<CustomerQrTokenRow | null> {
    const row = result<QrTokenDb>(
      await this.database.pool.query(
        `select id,company_id,customer_id,token,status,created_at,revoked_at
         from customer_qr_tokens where company_id=$1 and customer_id=$2 and status='active'`,
        [companyId, customerId],
      ),
    ).rows[0];
    return row === undefined ? null : qrToken(row);
  }

  /** Server-side lookup by the opaque token alone — a QR scan never
   * carries or requires a company id, so this is intentionally NOT
   * company-scoped in its `where` clause; the caller (a route handler
   * still behind normal authentication) re-derives the acting company
   * from the resolved row and rejects a cross-company scan explicitly —
   * see `customers.routes.ts`. */
  public async customerByQrToken(token: string): Promise<CustomerQrTokenRow | null> {
    const row = result<QrTokenDb>(
      await this.database.pool.query(
        `select id,company_id,customer_id,token,status,created_at,revoked_at
         from customer_qr_tokens where token=$1`,
        [token],
      ),
    ).rows[0];
    return row === undefined ? null : qrToken(row);
  }

  /** `company_settings.customers.default_country_code` — Part C. Reuses
   * the existing typed settings mechanism rather than a new `companies`
   * column (see ADR-0017 "Phone normalization"). Empty string means "not
   * configured" — the caller must never substitute a guessed default. */
  public async defaultCountryCode(companyId: string): Promise<string | null> {
    const row = result<{ value: unknown }>(
      await this.database.pool.query(
        `select value from company_settings
         where company_id=$1 and key='customers.default_country_code' and status='active'`,
        [companyId],
      ),
    ).rows[0];
    if (row === undefined) return null;
    const value = typeof row.value === 'string' ? row.value : null;
    return value === null || value.length === 0 ? null : value;
  }

  // `customer_identity_conflict` is reserved for the SERVICE-layer
  // cross-match case (`CustomersService.assertNoConflict`): email matches
  // one existing customer AND phone matches a DIFFERENT one. A single DB
  // unique-constraint violation is always just one field colliding with
  // one existing row — structurally the SAME fact `assertNoConflict`
  // itself reports as `resource_conflict` when it catches it first; this
  // mapping must produce the identical code for the same fact caught
  // later (a race that slips past the pre-check), never a different one
  // depending on timing.
  private mapDatabaseError(error: unknown): unknown {
    switch (constraint(error)) {
      case 'customers_company_normalized_email_uq':
        return new CustomerError('resource_conflict', 'A customer with this email already exists.');
      case 'customers_company_normalized_phone_uq':
        return new CustomerError('resource_conflict', 'A customer with this phone number already exists.');
      default:
        return error;
    }
  }
}

export function encodeCustomerCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify([createdAt.toISOString(), id]), 'utf8').toString('base64url');
}
export function decodeCustomerCursor(cursor: string): { createdAt: Date; id: string } {
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
    throw new CustomerError('validation_error', 'The cursor is invalid.');
  }
}
