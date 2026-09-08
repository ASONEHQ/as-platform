import { randomUUID } from 'node:crypto';

import type { DatabaseClient } from '@asone/database';

import {
  AccessError,
  type AccessCredentialKind,
  type AccessCredentialRow,
  type AccessCredentialStatus,
  type AccessEventRow,
  type AccessEventType,
  type AccessMutationContext,
} from './access.types.js';

/** Structurally identical to `HeldSaleCartTransaction`/`PurchaseTransaction`
 * on purpose — see those files' own doc comments; this codebase's
 * established "structurally identical transaction interface" convention,
 * reused verbatim rather than a project-invented variant. */
export interface AccessTransaction {
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

// `created_at` (not `issued_at`) is the real DB column name behind the
// TS-side `issuedAt` field — `packages/database/src/schema/access.ts`
// builds it with the shared `createdAtColumn()` helper, which always
// names the column `created_at` regardless of the TS property name (see
// `common.ts`). Never renamed at the SQL layer; only the row-mapping
// function below re-labels it.
const ACCESS_CREDENTIAL_COLUMNS =
  'id,company_id,branch_id,code,credential_kind,sale_id,customer_id,allows_reentry,status,currently_inside,created_at,issued_by,voided_at,voided_by';
const ACCESS_EVENT_COLUMNS = 'id,company_id,branch_id,credential_id,event_type,occurred_at,created_by,created_at';

interface AccessCredentialDb {
  id: string;
  company_id: string;
  branch_id: string;
  code: string;
  credential_kind: string;
  sale_id: string | null;
  customer_id: string | null;
  allows_reentry: string;
  status: string;
  currently_inside: string;
  created_at: Date | string;
  issued_by: string;
  voided_at: Date | string | null;
  voided_by: string | null;
}
interface AccessEventDb {
  id: string;
  company_id: string;
  branch_id: string;
  credential_id: string;
  event_type: string;
  occurred_at: Date | string;
  created_by: string;
  created_at: Date | string;
}
interface IdempotencyDb {
  request_hash: string;
  response_body: unknown;
}

/** The one place the DB's `text` `'true'|'false'` flags cross over into
 * real TS `boolean`s — see `access.types.ts`'s own doc comment on
 * `AccessCredentialRow`. Every other field is a plain, honest 1:1
 * mapping, no sentinel of any kind. */
function accessCredential(row: AccessCredentialDb): AccessCredentialRow {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    code: row.code,
    credentialKind: row.credential_kind as AccessCredentialKind,
    saleId: row.sale_id,
    customerId: row.customer_id,
    allowsReentry: row.allows_reentry === 'true',
    status: row.status as AccessCredentialStatus,
    currentlyInside: row.currently_inside === 'true',
    issuedAt: new Date(row.created_at),
    issuedBy: row.issued_by,
    voidedAt: row.voided_at === null ? null : new Date(row.voided_at),
    voidedBy: row.voided_by,
  };
}
function accessEvent(row: AccessEventDb): AccessEventRow {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    credentialId: row.credential_id,
    eventType: row.event_type as AccessEventType,
    occurredAt: new Date(row.occurred_at),
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
  };
}

export class AccessRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async transaction<T>(callback: (client: AccessTransaction) => Promise<T>): Promise<T> {
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

  /** Copied verbatim from `HeldSaleCartsRepository.idempotent`/
   * `PurchasingRepository.idempotent` — same advisory-lock-then-insert-
   * placeholder-then-fill pattern, never a project-invented variant. Used
   * for credential issuance (a duplicate issuance request must not create
   * two credentials) and for voiding (see `access.service.ts`'s own doc
   * comment on why `scan` deliberately does NOT use this). */
  public async idempotent<T>(
    client: AccessTransaction,
    context: AccessMutationContext,
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
        throw new AccessError('idempotency_conflict', 'The idempotency key was used with another request.');
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

  /** Mirrors `PurchasingRepository.auditAndPublish`/`HeldSaleCartsRepository.
   * auditAndPublish` exactly. `access_credentials`/`access_events` have no
   * `version` column at all (every state transition is already CAS-guarded
   * by its own `WHERE` clause — see `markEntry`/`markExit`/`markVoid`
   * below), so `aggregateVersion` is a fixed per-action-type generation
   * number (1=issued, 2=entry, 3=exit, 4=voided), mirroring
   * `held_sale_carts`' own established "no real version column, so pass a
   * fixed constant" precedent. TASK 14.5 (Wave 3) extends the generation
   * enum with `5n` (unvoided) — the one genuinely new transition this
   * wave adds; every prior generation number (1=issued, 2=entry, 3=exit,
   * 4=voided) is unchanged. */
  public async auditAndPublish(
    client: AccessTransaction,
    context: AccessMutationContext,
    input: {
      action: string;
      resourceType: 'access_credential' | 'access_event';
      resourceId: string;
      eventType: string;
      branchId: string;
      generation: 1n | 2n | 3n | 4n | 5n;
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
        input.generation.toString(),
        context.correlationId,
        JSON.stringify(input.payload),
        context.timestamp,
      ],
    );
  }

  // --- Issue ---------------------------------------------------------------

  public async insertCredential(
    client: AccessTransaction,
    input: {
      id: string;
      companyId: string;
      branchId: string;
      code: string;
      credentialKind: AccessCredentialKind;
      saleId: string;
      customerId: string | null;
      allowsReentry: boolean;
      issuedBy: string;
      timestamp: Date;
    },
  ): Promise<AccessCredentialRow> {
    const row = result<AccessCredentialDb>(
      await client.query(
        `insert into access_credentials
         (id,company_id,branch_id,code,credential_kind,sale_id,customer_id,allows_reentry,status,currently_inside,created_at,issued_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'issued','false',$9,$10)
         returning ${ACCESS_CREDENTIAL_COLUMNS}`,
        [
          input.id,
          input.companyId,
          input.branchId,
          input.code,
          input.credentialKind,
          input.saleId,
          input.customerId,
          input.allowsReentry ? 'true' : 'false',
          input.timestamp,
          input.issuedBy,
        ],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Access credential insertion did not return a row.');
    return accessCredential(row);
  }

  // --- Read ------------------------------------------------------------------

  /** Plain, non-transactional read — for the `GET /:id` detail endpoint
   * and any other read-only lookup outside a mutation. Mutations that
   * need to re-read a credential mid-transaction use `credentialInTx`
   * below instead, on the SAME connection/transaction. */
  public async credential(companyId: string, id: string): Promise<AccessCredentialRow | null> {
    const row = result<AccessCredentialDb>(
      await this.database.pool.query(
        `select ${ACCESS_CREDENTIAL_COLUMNS} from access_credentials where company_id=$1 and id=$2`,
        [companyId, id],
      ),
    ).rows[0];
    return row === undefined ? null : accessCredential(row);
  }

  /** Same lookup as `credential` above, but run on the transaction's own
   * connection — used by `access.service.ts` (a) to read a credential's
   * current state before a void attempt, and (b) to re-read it after a
   * losing CAS `UPDATE` (`markEntry`/`markExit`/`markVoid` all returning
   * `null`) to report the honest, specific reason (`credential_void`,
   * `already_inside`, `not_inside`, `reentry_not_allowed`,
   * `credential_currently_inside`) rather than a generic conflict. */
  public async credentialInTx(client: AccessTransaction, companyId: string, id: string): Promise<AccessCredentialRow | null> {
    const row = result<AccessCredentialDb>(
      await client.query(`select ${ACCESS_CREDENTIAL_COLUMNS} from access_credentials where company_id=$1 and id=$2`, [
        companyId,
        id,
      ]),
    ).rows[0];
    return row === undefined ? null : accessCredential(row);
  }

  /** Company-scoped ONLY (never branch-scoped here) — the whole point of
   * `wrong_branch` being its own distinct rejection (see `access.types.ts`)
   * is that a code from another branch of the SAME company must be found
   * and cleanly rejected as "wrong branch", never silently reported as
   * "not found" (which would look identical to an actually-unknown code,
   * losing real diagnostic signal for gate staff). A code from a
   * DIFFERENT company is correctly invisible here — `credential_not_found`
   * — since `access_credentials_company_code_uq` only guarantees
   * uniqueness within one company; the same literal code string could
   * coincidentally exist for another tenant. */
  public async credentialByCode(
    client: AccessTransaction,
    companyId: string,
    code: string,
  ): Promise<AccessCredentialRow | null> {
    const row = result<AccessCredentialDb>(
      await client.query(`select ${ACCESS_CREDENTIAL_COLUMNS} from access_credentials where company_id=$1 and code=$2`, [
        companyId,
        code,
      ]),
    ).rows[0];
    return row === undefined ? null : accessCredential(row);
  }

  /** Plain, non-transactional lookup-by-code — TASK 14.5 (Wave 3) addition,
   * for the `GET /access-credentials/by-code` endpoint (find a wristband
   * by its physical UID and see its current status). Same company-scoped-
   * only shape as `credentialByCode` above (see that method's own doc
   * comment on why cross-branch is a real, distinct `wrong_branch`
   * rejection rather than a silent "not found") — here left to the
   * service layer to translate into `resource_not_found` for a
   * different-branch match, mirroring `credential()`'s own precedent. */
  public async credentialByCodeLookup(companyId: string, code: string): Promise<AccessCredentialRow | null> {
    const row = result<AccessCredentialDb>(
      await this.database.pool.query(
        `select ${ACCESS_CREDENTIAL_COLUMNS} from access_credentials where company_id=$1 and code=$2`,
        [companyId, code],
      ),
    ).rows[0];
    return row === undefined ? null : accessCredential(row);
  }

  // --- State transitions (all CAS-guarded — see this class's own doc
  // comment on `auditAndPublish` and `access.service.ts`'s own doc
  // comment on `scan` for the full concurrency reasoning) -----------------

  /**
   * `currentlyInside=false -> true`. The `where` clause is the ENTIRE
   * race-free guarantee, exactly mirroring `HeldSaleCartsRepository.
   * claimCart`'s own `WHERE status='held'` CAS pattern: two concurrent
   * entry attempts on the SAME credential both reach this statement, but
   * Postgres serializes the row-level `UPDATE` — the first commits
   * `currently_inside='true'`, and the second then finds zero matching
   * rows (its own `currently_inside='false'` predicate is no longer true)
   * and gets back `undefined`, never a duplicate entry event and never a
   * negative/inconsistent state.
   *
   * The trailing `and (...)` clause enforces the re-entry policy
   * atomically in the SAME statement (not a separate pre-check + a
   * second write, which would itself be a TOCTOU race): a single-use
   * credential (`allows_reentry='false'`) additionally requires that no
   * `exit` event has ever been recorded for it yet — once one has, this
   * `UPDATE` matches zero rows and the service layer reports
   * `reentry_not_allowed`.
   */
  public async markEntry(
    client: AccessTransaction,
    companyId: string,
    id: string,
    branchId: string,
  ): Promise<AccessCredentialRow | null> {
    const row = result<AccessCredentialDb>(
      await client.query(
        `update access_credentials
         set currently_inside='true'
         where company_id=$1 and id=$2 and branch_id=$3 and status='issued' and currently_inside='false'
           and (allows_reentry='true' or not exists (
             select 1 from access_events ae
             where ae.company_id=$1 and ae.credential_id=$2 and ae.event_type='exit'
           ))
         returning ${ACCESS_CREDENTIAL_COLUMNS}`,
        [companyId, id, branchId],
      ),
    ).rows[0];
    return row === undefined ? null : accessCredential(row);
  }

  /** `currentlyInside=true -> false`. Same CAS shape as `markEntry` — the
   * `currently_inside='true'` predicate in the `WHERE` clause is the
   * whole guarantee; a losing concurrent exit attempt (or an exit attempt
   * when nobody is actually inside) matches zero rows and the service
   * layer reports `not_inside`. */
  public async markExit(client: AccessTransaction, companyId: string, id: string, branchId: string): Promise<AccessCredentialRow | null> {
    const row = result<AccessCredentialDb>(
      await client.query(
        `update access_credentials
         set currently_inside='false'
         where company_id=$1 and id=$2 and branch_id=$3 and status='issued' and currently_inside='true'
         returning ${ACCESS_CREDENTIAL_COLUMNS}`,
        [companyId, id, branchId],
      ),
    ).rows[0];
    return row === undefined ? null : accessCredential(row);
  }

  /** `status='issued' -> 'void'`. The `currently_inside='false'` guard in
   * the `WHERE` clause is this task's own chosen policy made race-safe:
   * voiding a currently-inside credential is rejected outright (see
   * `access.types.ts`'s own doc comment on `credential_currently_inside`)
   * — never a silent implicit exit. A concurrent entry scan racing this
   * void attempt is resolved exactly like every other CAS transition
   * here: whichever `UPDATE` commits first wins; the loser matches zero
   * rows and the service layer re-reads the row to report the honest
   * current reason. */
  public async markVoid(
    client: AccessTransaction,
    companyId: string,
    id: string,
    input: { voidedAt: Date; voidedBy: string },
  ): Promise<AccessCredentialRow | null> {
    const row = result<AccessCredentialDb>(
      await client.query(
        `update access_credentials
         set status='void', voided_at=$3, voided_by=$4
         where company_id=$1 and id=$2 and status='issued' and currently_inside='false'
         returning ${ACCESS_CREDENTIAL_COLUMNS}`,
        [companyId, id, input.voidedAt, input.voidedBy],
      ),
    ).rows[0];
    return row === undefined ? null : accessCredential(row);
  }

  /** `status='void' -> 'issued'`. TASK 14.5 (Wave 3) addition — the one
   * genuinely NEW lifecycle transition this wave adds (see
   * `packages/database/src/schema/access.ts`'s own doc comment): the
   * legacy's real `desbloquearPulsera()` reactivates a blocked wristband,
   * and "block" reuses this table's existing `void` transition (see
   * `AccessService.voidCredential`), so "unblock" must be the reverse —
   * `voided_at`/`voided_by` are cleared (never left stale) so the
   * `access_credentials_voided_fields_ck` constraint (`status='void'`
   * iff both are set) stays satisfied for real, not just superficially.
   * Same CAS shape as `markVoid`/`markEntry`/`markExit`: the
   * `status='void'` predicate in the `WHERE` clause is the entire
   * race-free guarantee — a losing concurrent unvoid attempt (or one
   * against an already-`issued` credential) matches zero rows and the
   * service layer re-reads to report the honest `credential_not_void`
   * reason. No `currently_inside` guard is needed here (unlike `markVoid`
   * guarding against voiding while inside) because
   * `access_credentials_void_not_inside_ck` already guarantees a `void`
   * row can never be `currently_inside='true'` in the first place. */
  public async markUnvoid(
    client: AccessTransaction,
    companyId: string,
    id: string,
  ): Promise<AccessCredentialRow | null> {
    const row = result<AccessCredentialDb>(
      await client.query(
        `update access_credentials
         set status='issued', voided_at=null, voided_by=null
         where company_id=$1 and id=$2 and status='void'
         returning ${ACCESS_CREDENTIAL_COLUMNS}`,
        [companyId, id],
      ),
    ).rows[0];
    return row === undefined ? null : accessCredential(row);
  }

  // --- Events (immutable, append-only) --------------------------------------

  public async insertEvent(
    client: AccessTransaction,
    input: {
      id: string;
      companyId: string;
      branchId: string;
      credentialId: string;
      eventType: AccessEventType;
      occurredAt: Date;
      createdBy: string;
    },
  ): Promise<AccessEventRow> {
    const row = result<AccessEventDb>(
      await client.query(
        `insert into access_events (id,company_id,branch_id,credential_id,event_type,occurred_at,created_by,created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$6)
         returning ${ACCESS_EVENT_COLUMNS}`,
        [input.id, input.companyId, input.branchId, input.credentialId, input.eventType, input.occurredAt, input.createdBy],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Access event insertion did not return a row.');
    return accessEvent(row);
  }

  /** Newest-first, paginated — the same opaque `(created_at,id)`-style
   * cursor shape `SalesRepository.listSales`/`HeldSaleCartsRepository.
   * listCarts` already established (here `(occurred_at,id)`, since
   * `occurred_at` — not `created_at` — is the real chronological fact for
   * an immutable event). */
  public async listEvents(
    companyId: string,
    branchIds: readonly string[],
    input: {
      limit: number;
      cursor?: string;
      branchId?: string;
      credentialId?: string;
      occurredFrom?: Date;
      occurredTo?: Date;
    },
  ): Promise<{ items: AccessEventRow[]; nextCursor: string | null }> {
    const values: unknown[] = [companyId, branchIds];
    const where = ['company_id=$1', 'branch_id=any($2::uuid[])'];
    if (input.branchId !== undefined) {
      values.push(input.branchId);
      where.push(`branch_id=$${String(values.length)}`);
    }
    // TASK 14.5 (Wave 3) addition — a single wristband/ticket's own event
    // history (`GET /access-events?credential_id=`), used by the lookup-
    // by-code UI to show a wristband's real activate/entry/exit/block/
    // unblock trail rather than the whole branch's feed.
    if (input.credentialId !== undefined) {
      values.push(input.credentialId);
      where.push(`credential_id=$${String(values.length)}`);
    }
    if (input.occurredFrom !== undefined) {
      values.push(input.occurredFrom);
      where.push(`occurred_at>=$${String(values.length)}`);
    }
    if (input.occurredTo !== undefined) {
      values.push(input.occurredTo);
      where.push(`occurred_at<=$${String(values.length)}`);
    }
    if (input.cursor !== undefined) {
      const decoded = decodeAccessCursor(input.cursor);
      values.push(decoded.at, decoded.id);
      where.push(`(occurred_at,id)<($${String(values.length - 1)},$${String(values.length)})`);
    }
    values.push(input.limit + 1);
    const rows = result<AccessEventDb>(
      await this.database.pool.query(
        `select ${ACCESS_EVENT_COLUMNS} from access_events where ${where.join(' and ')}
         order by occurred_at desc, id desc limit $${String(values.length)}`,
        values,
      ),
    ).rows;
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit).map(accessEvent);
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last !== undefined ? encodeAccessCursor(last.occurredAt, last.id) : null,
    };
  }

  /** "Who's inside right now" — filters on `currently_inside='true'`
   * exactly the same way `access_credentials_company_branch_inside_idx`
   * is shaped to serve (see the schema file's own doc comment on that
   * index), paginated with the same opaque cursor convention as
   * `listEvents` above (here keyed on `issuedAt`/`created_at`, since
   * `currentlyInside` credentials have no other stable chronological
   * column to order by). */
  public async listCurrentlyInside(
    companyId: string,
    branchIds: readonly string[],
    input: { limit: number; cursor?: string; branchId?: string },
  ): Promise<{ items: AccessCredentialRow[]; nextCursor: string | null }> {
    const values: unknown[] = [companyId, branchIds];
    const where = ["company_id=$1", 'branch_id=any($2::uuid[])', "currently_inside='true'"];
    if (input.branchId !== undefined) {
      values.push(input.branchId);
      where.push(`branch_id=$${String(values.length)}`);
    }
    if (input.cursor !== undefined) {
      const decoded = decodeAccessCursor(input.cursor);
      values.push(decoded.at, decoded.id);
      where.push(`(created_at,id)<($${String(values.length - 1)},$${String(values.length)})`);
    }
    values.push(input.limit + 1);
    const rows = result<AccessCredentialDb>(
      await this.database.pool.query(
        `select ${ACCESS_CREDENTIAL_COLUMNS} from access_credentials where ${where.join(' and ')}
         order by created_at desc, id desc limit $${String(values.length)}`,
        values,
      ),
    ).rows;
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit).map(accessCredential);
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last !== undefined ? encodeAccessCursor(last.issuedAt, last.id) : null,
    };
  }

  /** The real, live occupancy count — `count(*) where currently_inside=
   * 'true'`, exactly the index `access_credentials_company_branch_inside_idx`
   * is shaped to serve. Structurally CANNOT go negative: it is a `count`
   * of rows matching a CAS-guarded boolean flag, never a separately
   * incremented/decremented counter that could drift or underflow (see
   * the schema file's own doc comment) — confirmed by this module's own
   * integration test rather than merely asserted here. */
  public async occupancyCount(companyId: string, branchId: string): Promise<number> {
    const row = result<{ count: string }>(
      await this.database.pool.query(
        `select count(*)::text as count from access_credentials
         where company_id=$1 and branch_id=$2 and currently_inside='true'`,
        [companyId, branchId],
      ),
    ).rows[0];
    return row === undefined ? 0 : Number(row.count);
  }

  private mapDatabaseError(error: unknown): unknown {
    switch (constraint(error)) {
      case 'access_credentials_sale_scope_fk':
        return new AccessError('validation_error', 'The sale was not found for this branch.');
      case 'access_credentials_customer_scope_fk':
        return new AccessError('validation_error', 'The customer was not found.');
      // TASK 14.5 (Wave 3): only ever reached for a CLIENT-supplied
      // (wristband) code — a server-generated ticket code's own collision
      // is caught and retried inside `AccessService.issueCredential`'s
      // own savepoint loop before it can ever reach here.
      case 'access_credentials_company_code_uq':
        return new AccessError('code_already_in_use', 'This code is already in use by another credential.');
      default:
        return error;
    }
  }
}

export function encodeAccessCursor(at: Date, id: string): string {
  return Buffer.from(JSON.stringify([at.toISOString(), id]), 'utf8').toString('base64url');
}
export function decodeAccessCursor(cursor: string): { at: Date; id: string } {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 2 ||
      typeof decoded[0] !== 'string' ||
      typeof decoded[1] !== 'string'
    )
      throw new Error('malformed');
    const at = new Date(decoded[0]);
    if (Number.isNaN(at.getTime())) throw new Error('malformed');
    return { at, id: decoded[1] };
  } catch {
    throw new AccessError('validation_error', 'The cursor is invalid.');
  }
}
