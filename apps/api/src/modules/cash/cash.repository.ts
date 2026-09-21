import { randomUUID } from 'node:crypto';

import type { DatabaseClient } from '@asone/database';

import {
  CashError,
  cashMovementDirection,
  type CashAuditLogEntry,
  type CashMovementCategory,
  type CashMovementRow,
  type CashMovementType,
  type CashMutationContext,
  type CashPartialCloseOperationalSummary,
  type CashPaymentMethodTotal,
  type CashRegisterRow,
  type CashSessionPartialCloseRow,
  type CashSessionRow,
  type CashSessionStatus,
  type DenominationCount,
} from './cash.types.js';

/** Structurally identical to `SaleTransaction`/`PaymentTransaction` on
 * purpose — a real transaction client from any of the three modules
 * satisfies all of them, so `PaymentService.createCashPayment` can hand
 * its own transaction straight to `CashRepository`'s movement-posting
 * methods with no adapter (mirrors ADR-0013's `SaleConsumptionTransaction`
 * exactly). */
export interface CashTransaction {
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
const MONEY_SCALE = 10_000n;
function moneyUnits(value: string): bigint {
  const [whole = '', fraction = ''] = value.split('.');
  const wholeDigits = whole.length === 0 ? '0' : whole;
  const fractionDigits = fraction.padEnd(4, '0').slice(0, 4);
  return BigInt(wholeDigits) * MONEY_SCALE + BigInt(fractionDigits.length === 0 ? '0' : fractionDigits);
}
function formatMoney(units: bigint): string {
  const negative = units < 0n;
  const magnitude = negative ? -units : units;
  const whole = magnitude / MONEY_SCALE;
  const fraction = (magnitude % MONEY_SCALE).toString().padStart(4, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fraction}`;
}

const REGISTER_COLUMNS =
  'id,company_id,branch_id,code,name,status,device_id,created_by,updated_by,version,created_at,updated_at,deleted_at';
const SESSION_COLUMNS =
  'id,company_id,branch_id,cash_register_id,opened_by,opened_at,opening_amount,currency_code,status,closed_by,closed_at,declared_closing_amount,expected_closing_amount,discrepancy_amount,denomination_counts,cash_sales_total,cash_sales_count,cash_in_total,cash_out_total,withdrawal_total,expense_total,external_income_total,cash_refund_total,cash_refund_count,payment_method_totals,operational_summary,discrepancy_reason,version,created_at,updated_at';
const MOVEMENT_COLUMNS =
  'id,company_id,branch_id,cash_session_id,movement_type,amount,currency_code,reason_code,note,reference_type,reference_id,occurred_at,created_by,device_id,reversal_of_id,created_at,category';
const PARTIAL_CLOSE_COLUMNS =
  'id,company_id,branch_id,cash_session_id,taken_at,opening_amount,cash_sales_total,cash_in_total,cash_out_total,expected_cash,created_by,created_at,operational_summary';

interface RegisterDb {
  id: string;
  company_id: string;
  branch_id: string;
  code: string;
  name: string;
  status: string;
  device_id: string | null;
  created_by: string;
  updated_by: string;
  version: string;
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
}
interface SessionDb {
  id: string;
  company_id: string;
  branch_id: string;
  cash_register_id: string;
  opened_by: string;
  opened_at: Date | string;
  opening_amount: string;
  currency_code: string;
  status: string;
  closed_by: string | null;
  closed_at: Date | string | null;
  declared_closing_amount: string | null;
  expected_closing_amount: string | null;
  discrepancy_amount: string | null;
  denomination_counts: unknown;
  cash_sales_total: string | null;
  cash_sales_count: number | null;
  cash_in_total: string | null;
  cash_out_total: string | null;
  withdrawal_total: string | null;
  expense_total: string | null;
  external_income_total: string | null;
  cash_refund_total: string | null;
  cash_refund_count: number | null;
  payment_method_totals: unknown;
  operational_summary: CashPartialCloseOperationalSummary | null;
  discrepancy_reason: string | null;
  version: string;
  created_at: Date | string;
  updated_at: Date | string;
}
interface MovementDb {
  id: string;
  company_id: string;
  branch_id: string;
  cash_session_id: string;
  movement_type: string;
  amount: string;
  currency_code: string;
  reason_code: string;
  note: string | null;
  reference_type: string | null;
  reference_id: string | null;
  occurred_at: Date | string;
  created_by: string;
  device_id: string | null;
  reversal_of_id: string | null;
  created_at: Date | string;
  category: string | null;
}
interface PartialCloseDb {
  id: string;
  company_id: string;
  branch_id: string;
  cash_session_id: string;
  taken_at: Date | string;
  opening_amount: string;
  cash_sales_total: string;
  cash_in_total: string;
  cash_out_total: string;
  expected_cash: string;
  created_by: string;
  created_at: Date | string;
  operational_summary: CashPartialCloseOperationalSummary | null;
}
interface IdempotencyDb {
  request_hash: string;
  response_body: unknown;
}

function register(row: RegisterDb): CashRegisterRow {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    code: row.code,
    name: row.name,
    status: row.status as CashRegisterRow['status'],
    deviceId: row.device_id,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    version: BigInt(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    deletedAt: row.deleted_at === null ? null : new Date(row.deleted_at),
  };
}
function denominationCounts(raw: unknown): readonly DenominationCount[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  return raw
    .filter(
      (entry): entry is { value: unknown; quantity: unknown } => typeof entry === 'object' && entry !== null,
    )
    .map((entry) => ({ value: String((entry as { value: unknown }).value), quantity: Number((entry as { quantity: unknown }).quantity) }));
}
function paymentMethodTotals(raw: unknown): readonly CashPaymentMethodTotal[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  return raw
    .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
    .map((entry) => ({
      method: String(entry.method),
      grossSalesTotal: String(entry.grossSalesTotal),
      refundsTotal: String(entry.refundsTotal),
      netTotal: String(entry.netTotal),
      ticketCount: Number(entry.ticketCount),
    }));
}
function session(row: SessionDb): CashSessionRow {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    cashRegisterId: row.cash_register_id,
    openedBy: row.opened_by,
    openedAt: new Date(row.opened_at),
    openingAmount: row.opening_amount,
    currencyCode: row.currency_code,
    status: row.status as CashSessionStatus,
    closedBy: row.closed_by,
    closedAt: row.closed_at === null ? null : new Date(row.closed_at),
    declaredClosingAmount: row.declared_closing_amount,
    expectedClosingAmount: row.expected_closing_amount,
    discrepancyAmount: row.discrepancy_amount,
    denominationCounts: denominationCounts(row.denomination_counts),
    cashSalesTotal: row.cash_sales_total,
    cashSalesCount: row.cash_sales_count,
    cashInTotal: row.cash_in_total,
    cashOutTotal: row.cash_out_total,
    withdrawalTotal: row.withdrawal_total,
    expenseTotal: row.expense_total,
    externalIncomeTotal: row.external_income_total,
    cashRefundTotal: row.cash_refund_total,
    cashRefundCount: row.cash_refund_count,
    paymentMethodTotals: paymentMethodTotals(row.payment_method_totals),
    operationalSummary: row.operational_summary ?? null,
    discrepancyReason: row.discrepancy_reason,
    version: BigInt(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
function movement(row: MovementDb): CashMovementRow {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    cashSessionId: row.cash_session_id,
    movementType: row.movement_type as CashMovementType,
    amount: row.amount,
    currencyCode: row.currency_code,
    reasonCode: row.reason_code,
    note: row.note,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    occurredAt: new Date(row.occurred_at),
    createdBy: row.created_by,
    deviceId: row.device_id,
    reversalOfId: row.reversal_of_id,
    createdAt: new Date(row.created_at),
    category: row.category === null ? null : (row.category as CashMovementCategory),
  };
}
function partialClose(row: PartialCloseDb): CashSessionPartialCloseRow {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    cashSessionId: row.cash_session_id,
    takenAt: new Date(row.taken_at),
    openingAmount: row.opening_amount,
    cashSalesTotal: row.cash_sales_total,
    cashInTotal: row.cash_in_total,
    cashOutTotal: row.cash_out_total,
    expectedCash: row.expected_cash,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
    operationalSummary: row.operational_summary ?? null,
  };
}

export class CashRepository {
  public constructor(private readonly database: DatabaseClient) {}

  /** TASK 16.11A — the company's own authoritative currency (the same
   * value `business.currency`'s own `resolveDefault` reads —
   * `settings.catalog.ts`'s `companyString('business.currency', (company)
   * => company.currencyCode, ...)`), read directly rather than going
   * through the full settings-resolution service: `companies.currency_code`
   * IS the value that resolver reads, `business.currency` has no branch
   * override, and a cash session's own currency is a company-wide fact,
   * never a per-branch one. Used as `openSession`'s default so a session
   * is tagged with the tenant's REAL configured currency (which the
   * platform's own provisioning already allows as any 3-letter ISO code,
   * not just MXN/USD) instead of a hardcoded literal. */
  public async companyCurrencyCode(client: CashTransaction, companyId: string): Promise<string> {
    const row = result<{ currency_code: string }>(
      await client.query('select currency_code from companies where id=$1', [companyId]),
    ).rows[0];
    if (row === undefined) throw new CashError('resource_not_found', 'The company was not found.');
    return row.currency_code;
  }

  /** TASK 16.13A — the branch's own real, configured IANA timezone
   * (`branches.timezone`), used so `reservationsOccurringToday` compares
   * `party_reservations.event_date` against the calendar day AS THE
   * BRANCH ITSELF OBSERVES IT, never a blind UTC day boundary. Read
   * directly (not through a settings resolver — a branch's timezone is
   * its own column, not a resolved setting). The column is only ever
   * checked non-blank at the DB level (`branches_timezone_nonblank_ck`)
   * — never assumed to already be a valid IANA zone here; the caller
   * (`CashService.partialClose`) re-validates with `isValidIanaTimezone`
   * before use, exactly like `SalesService.createSale` already does for
   * the same reason (see that function's own doc comment history). */
  public async branchTimezone(companyId: string, branchId: string): Promise<string> {
    const row = result<{ timezone: string }>(
      await this.database.pool.query('select timezone from branches where company_id=$1 and id=$2', [
        companyId,
        branchId,
      ]),
    ).rows[0];
    if (row === undefined) throw new CashError('resource_not_found', 'The branch was not found.');
    return row.timezone;
  }

  public async transaction<T>(callback: (client: CashTransaction) => Promise<T>): Promise<T> {
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
    client: CashTransaction,
    context: CashMutationContext,
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
        throw new CashError('idempotency_conflict', 'The idempotency key was used with another request.');
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
    client: CashTransaction,
    context: CashMutationContext,
    input: {
      action: string;
      resourceType: 'cash_register' | 'cash_session' | 'cash_movement' | 'cash_session_partial_close';
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

  // --- Registers ---------------------------------------------------------

  public async insertRegister(
    client: CashTransaction,
    input: {
      id: string;
      companyId: string;
      branchId: string;
      code: string;
      name: string;
      deviceId: string | null;
      actorId: string;
      timestamp: Date;
    },
  ): Promise<CashRegisterRow> {
    const row = result<RegisterDb>(
      await client.query(
        `insert into cash_registers
         (id,company_id,branch_id,code,normalized_code,name,status,device_id,created_by,updated_by,created_at,updated_at)
         values ($1,$2,$3,$4,$5,$6,'active',$7,$8,$8,$9,$9)
         returning ${REGISTER_COLUMNS}`,
        [
          input.id,
          input.companyId,
          input.branchId,
          input.code,
          input.code.toLowerCase(),
          input.name,
          input.deviceId,
          input.actorId,
          input.timestamp,
        ],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Register insertion did not return a row.');
    return register(row);
  }

  public async register(companyId: string, id: string): Promise<CashRegisterRow | null> {
    const row = result<RegisterDb>(
      await this.database.pool.query(
        `select ${REGISTER_COLUMNS} from cash_registers where company_id=$1 and id=$2 and deleted_at is null`,
        [companyId, id],
      ),
    ).rows[0];
    return row === undefined ? null : register(row);
  }

  public async listRegisters(
    companyId: string,
    branchIds: readonly string[],
    input: { limit: number; cursor?: string; branchId?: string; status?: string; deviceId?: string },
  ): Promise<{ items: CashRegisterRow[]; nextCursor: string | null }> {
    const values: unknown[] = [companyId, branchIds];
    const where = ['company_id=$1', 'branch_id=any($2::uuid[])', 'deleted_at is null'];
    if (input.branchId !== undefined) {
      values.push(input.branchId);
      where.push(`branch_id=$${String(values.length)}`);
    }
    if (input.status !== undefined) {
      values.push(input.status);
      where.push(`status=$${String(values.length)}`);
    }
    if (input.deviceId !== undefined) {
      values.push(input.deviceId);
      where.push(`device_id=$${String(values.length)}`);
    }
    if (input.cursor !== undefined) {
      values.push(input.cursor);
      where.push(`id>$${String(values.length)}`);
    }
    values.push(input.limit + 1);
    const rows = result<RegisterDb>(
      await this.database.pool.query(
        `select ${REGISTER_COLUMNS} from cash_registers where ${where.join(' and ')}
         order by id asc limit $${String(values.length)}`,
        values,
      ),
    ).rows;
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit).map(register);
    return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
  }

  public async lockRegister(client: CashTransaction, companyId: string, id: string): Promise<CashRegisterRow | null> {
    const row = result<RegisterDb>(
      await client.query(
        `select ${REGISTER_COLUMNS} from cash_registers where company_id=$1 and id=$2 and deleted_at is null for update`,
        [companyId, id],
      ),
    ).rows[0];
    return row === undefined ? null : register(row);
  }

  public async assignDevice(
    client: CashTransaction,
    companyId: string,
    id: string,
    expectedVersion: bigint,
    input: { deviceId: string | null; timestamp: Date; updatedBy: string },
  ): Promise<CashRegisterRow> {
    const row = result<RegisterDb>(
      await client.query(
        `update cash_registers set device_id=$3,updated_by=$4,updated_at=$5,version=version+1
         where company_id=$1 and id=$2 and version=$6
         returning ${REGISTER_COLUMNS}`,
        [companyId, id, input.deviceId, input.updatedBy, input.timestamp, expectedVersion.toString()],
      ),
    ).rows[0];
    if (row === undefined) throw new CashError('version_conflict', 'The register version changed.');
    return register(row);
  }

  // --- Sessions ------------------------------------------------------------

  public async insertSession(
    client: CashTransaction,
    input: CashMutationContext & {
      id: string;
      branchId: string;
      cashRegisterId: string;
      openingAmount: string;
      currencyCode: string;
    },
  ): Promise<CashSessionRow> {
    const row = result<SessionDb>(
      await client.query(
        `insert into cash_sessions
         (id,company_id,branch_id,cash_register_id,opened_by,opened_at,opening_amount,currency_code,status,created_at,updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'open',$6,$6)
         returning ${SESSION_COLUMNS}`,
        [
          input.id,
          input.companyId,
          input.branchId,
          input.cashRegisterId,
          input.actorId,
          input.timestamp,
          input.openingAmount,
          input.currencyCode,
        ],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Session insertion did not return a row.');
    return session(row);
  }

  public async session(companyId: string, id: string): Promise<CashSessionRow | null> {
    const row = result<SessionDb>(
      await this.database.pool.query(`select ${SESSION_COLUMNS} from cash_sessions where company_id=$1 and id=$2`, [
        companyId,
        id,
      ]),
    ).rows[0];
    return row === undefined ? null : session(row);
  }

  public async lockSession(client: CashTransaction, companyId: string, id: string): Promise<CashSessionRow | null> {
    const row = result<SessionDb>(
      await client.query(`select ${SESSION_COLUMNS} from cash_sessions where company_id=$1 and id=$2 for update`, [
        companyId,
        id,
      ]),
    ).rows[0];
    return row === undefined ? null : session(row);
  }

  /** The open session for one register — at most one row can ever match
   * (`cash_sessions_register_active_uq`), so this is a safe, unambiguous
   * lookup, never a "pick the first" guess. */
  public async openSessionForRegister(
    client: CashTransaction | null,
    companyId: string,
    cashRegisterId: string,
  ): Promise<CashSessionRow | null> {
    const runner = client ?? this.database.pool;
    const row = result<SessionDb>(
      await runner.query(
        `select ${SESSION_COLUMNS} from cash_sessions
         where company_id=$1 and cash_register_id=$2 and status='open'`,
        [companyId, cashRegisterId],
      ),
    ).rows[0];
    return row === undefined ? null : session(row);
  }

  /** Every currently-open session for a branch — used to resolve "the"
   * session for a cash payment when the caller doesn't name a register
   * explicitly. Zero rows means no open register; more than one means the
   * branch genuinely has multiple concurrently-open registers and the
   * caller must disambiguate — never silently picked. */
  public async openSessionsForBranch(
    client: CashTransaction | null,
    companyId: string,
    branchId: string,
  ): Promise<readonly CashSessionRow[]> {
    const runner = client ?? this.database.pool;
    const rows = result<SessionDb>(
      await runner.query(
        `select ${SESSION_COLUMNS} from cash_sessions
         where company_id=$1 and branch_id=$2 and status='open'
         order by opened_at asc`,
        [companyId, branchId],
      ),
    ).rows;
    return rows.map(session);
  }

  public async listSessions(
    companyId: string,
    branchIds: readonly string[],
    input: {
      limit: number;
      cursor?: string;
      branchId?: string;
      cashRegisterId?: string;
      openedBy?: string;
      status?: string;
      openedFrom?: Date;
      openedTo?: Date;
    },
  ): Promise<{ items: CashSessionRow[]; nextCursor: string | null }> {
    const values: unknown[] = [companyId, branchIds];
    const where = ['company_id=$1', 'branch_id=any($2::uuid[])'];
    if (input.branchId !== undefined) {
      values.push(input.branchId);
      where.push(`branch_id=$${String(values.length)}`);
    }
    if (input.cashRegisterId !== undefined) {
      values.push(input.cashRegisterId);
      where.push(`cash_register_id=$${String(values.length)}`);
    }
    if (input.openedBy !== undefined) {
      values.push(input.openedBy);
      where.push(`opened_by=$${String(values.length)}`);
    }
    if (input.status !== undefined) {
      values.push(input.status);
      where.push(`status=$${String(values.length)}`);
    }
    if (input.openedFrom !== undefined) {
      values.push(input.openedFrom);
      where.push(`opened_at>=$${String(values.length)}`);
    }
    if (input.openedTo !== undefined) {
      values.push(input.openedTo);
      where.push(`opened_at<$${String(values.length)}`);
    }
    if (input.cursor !== undefined) {
      const decoded = decodeCashCursor(input.cursor);
      values.push(decoded.occurredAt, decoded.id);
      where.push(`(opened_at,id)<($${String(values.length - 1)},$${String(values.length)})`);
    }
    values.push(input.limit + 1);
    const rows = result<SessionDb>(
      await this.database.pool.query(
        `select ${SESSION_COLUMNS} from cash_sessions where ${where.join(' and ')}
         order by opened_at desc, id desc limit $${String(values.length)}`,
        values,
      ),
    ).rows;
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit).map(session);
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last !== undefined ? encodeCashCursor(last.openedAt, last.id) : null,
    };
  }

  public async transitionSessionStatus(
    client: CashTransaction,
    companyId: string,
    id: string,
    expectedVersion: bigint,
    status: CashSessionStatus,
    timestamp: Date,
  ): Promise<CashSessionRow> {
    const row = result<SessionDb>(
      await client.query(
        `update cash_sessions set status=$3,updated_at=$4,version=version+1
         where company_id=$1 and id=$2 and version=$5
         returning ${SESSION_COLUMNS}`,
        [companyId, id, status, timestamp, expectedVersion.toString()],
      ),
    ).rows[0];
    if (row === undefined) throw new CashError('version_conflict', 'The session version changed.');
    return session(row);
  }

  public async closeSession(
    client: CashTransaction,
    companyId: string,
    id: string,
    expectedVersion: bigint,
    input: {
      closedBy: string;
      closedAt: Date;
      declaredClosingAmount: string;
      expectedClosingAmount: string;
      discrepancyAmount: string;
      denominationCounts: readonly DenominationCount[] | null;
      // TASK 16.14 — the frozen commercial final-close snapshot; see
      // `packages/database/src/schema/cash.ts`'s own doc comment on these
      // columns for why each is persisted rather than only ever
      // recomputed from `cash_movements` on read.
      cashSalesTotal: string;
      cashSalesCount: number;
      cashInTotal: string;
      cashOutTotal: string;
      withdrawalTotal: string;
      expenseTotal: string;
      externalIncomeTotal: string;
      cashRefundTotal: string;
      cashRefundCount: number;
      paymentMethodTotals: readonly CashPaymentMethodTotal[];
      operationalSummary: CashPartialCloseOperationalSummary | null;
      discrepancyReason: string | null;
    },
  ): Promise<CashSessionRow> {
    const row = result<SessionDb>(
      await client.query(
        `update cash_sessions set
           status='closed',
           closed_by=$3,
           closed_at=$4,
           declared_closing_amount=$5,
           expected_closing_amount=$6,
           discrepancy_amount=$7,
           denomination_counts=$8::jsonb,
           cash_sales_total=$10,
           cash_sales_count=$11,
           cash_in_total=$12,
           cash_out_total=$13,
           withdrawal_total=$14,
           expense_total=$15,
           external_income_total=$16,
           cash_refund_total=$17,
           cash_refund_count=$18,
           payment_method_totals=$19::jsonb,
           operational_summary=$20::jsonb,
           discrepancy_reason=$21,
           updated_at=$4,
           version=version+1
         where company_id=$1 and id=$2 and version=$9
         returning ${SESSION_COLUMNS}`,
        [
          companyId,
          id,
          input.closedBy,
          input.closedAt,
          input.declaredClosingAmount,
          input.expectedClosingAmount,
          input.discrepancyAmount,
          input.denominationCounts === null ? null : JSON.stringify(input.denominationCounts),
          expectedVersion.toString(),
          input.cashSalesTotal,
          input.cashSalesCount,
          input.cashInTotal,
          input.cashOutTotal,
          input.withdrawalTotal,
          input.expenseTotal,
          input.externalIncomeTotal,
          input.cashRefundTotal,
          input.cashRefundCount,
          JSON.stringify(input.paymentMethodTotals),
          input.operationalSummary === null ? null : JSON.stringify(input.operationalSummary),
          input.discrepancyReason,
        ],
      ),
    ).rows[0];
    if (row === undefined) throw new CashError('version_conflict', 'The session version changed.');
    return session(row);
  }

  // --- Movements -----------------------------------------------------------

  public async insertMovement(
    client: CashTransaction,
    input: {
      id: string;
      companyId: string;
      branchId: string;
      cashSessionId: string;
      movementType: CashMovementType;
      amount: string;
      currencyCode: string;
      reasonCode: string;
      note: string | null;
      referenceType: string | null;
      referenceId: string | null;
      occurredAt: Date;
      createdBy: string;
      deviceId: string | null;
      /** TASK 14.4 (Wave 2, Part F.1) — optional; `undefined`/omitted
       * behaves exactly like `null` (system-posted movements and
       * uncategorized manual movements never pass this). */
      category?: CashMovementCategory | null;
      /** TASK 16.11 (§6) — set only by `reverseMovement`'s own compensating
       * insert; every other caller omits it (`null`). */
      reversalOfId?: string | null;
    },
  ): Promise<CashMovementRow> {
    const row = result<MovementDb>(
      await client.query(
        `insert into cash_movements
         (id,company_id,branch_id,cash_session_id,movement_type,amount,currency_code,reason_code,note,
          reference_type,reference_id,occurred_at,created_by,device_id,created_at,category,reversal_of_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$12,$15,$16)
         returning ${MOVEMENT_COLUMNS}`,
        [
          input.id,
          input.companyId,
          input.branchId,
          input.cashSessionId,
          input.movementType,
          input.amount,
          input.currencyCode,
          input.reasonCode,
          input.note,
          input.referenceType,
          input.referenceId,
          input.occurredAt,
          input.createdBy,
          input.deviceId,
          input.category ?? null,
          input.reversalOfId ?? null,
        ],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Movement insertion did not return a row.');
    return movement(row);
  }

  /** TASK 16.11 (§6) — loads and locks one movement for a same-transaction
   * reversal, scoped to both company and session (never a bare id lookup)
   * so a reversal can never reach across a tenant or session boundary. */
  public async lockMovement(
    client: CashTransaction,
    companyId: string,
    cashSessionId: string,
    id: string,
  ): Promise<CashMovementRow | null> {
    const row = result<MovementDb>(
      await client.query(
        `select ${MOVEMENT_COLUMNS} from cash_movements
         where company_id=$1 and cash_session_id=$2 and id=$3 for update`,
        [companyId, cashSessionId, id],
      ),
    ).rows[0];
    return row === undefined ? null : movement(row);
  }

  /** True if any movement already reverses `movementId` — the app-level
   * pre-check backing `cash_movements_reversal_of_uq`'s own DB-level
   * guarantee (see `mapDatabaseError`), so a second reversal attempt gets
   * a clean domain error instead of a raw constraint violation. */
  public async hasReversal(client: CashTransaction, companyId: string, movementId: string): Promise<boolean> {
    const row = result<{ exists: boolean }>(
      await client.query(
        `select exists(select 1 from cash_movements where company_id=$1 and reversal_of_id=$2) as exists`,
        [companyId, movementId],
      ),
    ).rows[0];
    return row?.exists === true;
  }

  /** ADR-0013's exact same pattern applied to cash: posts one `cash_sale`
   * movement for a captured cash Payment, exactly once — the database's
   * own `cash_movements_payment_reference_uq` partial unique index is the
   * durable idempotency boundary (see cash.ts), not just this call being
   * reached only once. Keyed by *payment* id, not sale id, so a Sale that
   * legitimately receives more than one payment (a split payment) can
   * still get one drawer movement per captured cash payment — see
   * cash.ts's own doc comment on `referenceType`. */
  public async postCashSaleMovement(
    client: CashTransaction,
    context: CashMutationContext,
    input: {
      cashSessionId: string;
      branchId: string;
      amount: string;
      currencyCode: string;
      paymentId: string;
      saleNumber: string;
    },
  ): Promise<CashMovementRow> {
    return this.insertMovement(client, {
      id: randomUUID(),
      companyId: context.companyId,
      branchId: input.branchId,
      cashSessionId: input.cashSessionId,
      movementType: 'cash_sale',
      amount: input.amount,
      currencyCode: input.currencyCode,
      reasonCode: 'cash_sale',
      note: input.saleNumber,
      referenceType: 'payment',
      referenceId: input.paymentId,
      occurredAt: context.timestamp,
      createdBy: context.actorId,
      deviceId: context.deviceId ?? null,
    });
  }

  /** TASK 12.8 (Part F/G): the identical pattern applied to a completed
   * cash refund's own drawer-out fact — posted to the *current* open
   * session performing the refund (never the original sale's, possibly
   * long-closed, session — see ADR-0015 "Current vs original
   * CashSession"). Keyed by *refund* id — `cash_movements_refund_reference_uq`
   * is the durable, database-level idempotency boundary, not just this
   * call being reached only once. */
  public async postRefundMovement(
    client: CashTransaction,
    context: CashMutationContext,
    input: {
      cashSessionId: string;
      branchId: string;
      amount: string;
      currencyCode: string;
      refundId: string;
      refundNumber: string;
    },
  ): Promise<CashMovementRow> {
    return this.insertMovement(client, {
      id: randomUUID(),
      companyId: context.companyId,
      branchId: input.branchId,
      cashSessionId: input.cashSessionId,
      movementType: 'cash_refund',
      amount: input.amount,
      currencyCode: input.currencyCode,
      reasonCode: 'cash_refund',
      note: input.refundNumber,
      referenceType: 'refund',
      referenceId: input.refundId,
      occurredAt: context.timestamp,
      createdBy: context.actorId,
      deviceId: context.deviceId ?? null,
    });
  }

  public async movementsForSession(companyId: string, cashSessionId: string): Promise<CashMovementRow[]> {
    const rows = result<MovementDb>(
      await this.database.pool.query(
        `select ${MOVEMENT_COLUMNS} from cash_movements
         where company_id=$1 and cash_session_id=$2 order by occurred_at asc, id asc`,
        [companyId, cashSessionId],
      ),
    ).rows;
    return rows.map(movement);
  }

  public async listMovements(
    companyId: string,
    cashSessionId: string,
    input: { limit: number; cursor?: string; movementType?: CashMovementType },
  ): Promise<{ items: CashMovementRow[]; nextCursor: string | null }> {
    const values: unknown[] = [companyId, cashSessionId];
    const where = ['company_id=$1', 'cash_session_id=$2'];
    if (input.movementType !== undefined) {
      values.push(input.movementType);
      where.push(`movement_type=$${String(values.length)}`);
    }
    if (input.cursor !== undefined) {
      const decoded = decodeCashCursor(input.cursor);
      values.push(decoded.occurredAt, decoded.id);
      where.push(`(occurred_at,id)>($${String(values.length - 1)},$${String(values.length)})`);
    }
    values.push(input.limit + 1);
    const rows = result<MovementDb>(
      await this.database.pool.query(
        `select ${MOVEMENT_COLUMNS} from cash_movements where ${where.join(' and ')}
         order by occurred_at asc, id asc limit $${String(values.length)}`,
        values,
      ),
    ).rows;
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit).map(movement);
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last !== undefined ? encodeCashCursor(last.occurredAt, last.id) : null,
    };
  }

  /** §H / Part H — the backend-authoritative expected-cash formula:
   * `sum(amount * direction)` over every ledger movement in the session,
   * exact `BigInt` fixed-point arithmetic (ADR-0001) — never a running
   * mutable counter, never derived by summing `sales` directly (a session
   * can carry non-sale movements a sale-only sum would miss). */
  public async expectedCash(companyId: string, cashSessionId: string): Promise<string> {
    const movements = await this.movementsForSession(companyId, cashSessionId);
    let units = 0n;
    for (const item of movements) {
      units += moneyUnits(item.amount) * BigInt(cashMovementDirection[item.movementType]);
    }
    return formatMoney(units);
  }

  // --- Partial closes ("corte parcial") (TASK 14.4 Wave 2 Part F.3) -------

  /** Inserts one persisted snapshot row of an already-computed
   * `summary()` result. Deliberately takes the figures as plain input
   * rather than re-computing them — the caller (`CashService.partialClose`)
   * is the single place that folds `movementsForSession`, exactly
   * mirroring `closeSession`'s own division of responsibility. Never
   * touches `cash_sessions.status`. */
  public async insertPartialClose(
    client: CashTransaction,
    input: {
      id: string;
      companyId: string;
      branchId: string;
      cashSessionId: string;
      takenAt: Date;
      openingAmount: string;
      cashSalesTotal: string;
      cashInTotal: string;
      cashOutTotal: string;
      expectedCash: string;
      createdBy: string;
      operationalSummary: CashPartialCloseOperationalSummary | null;
    },
  ): Promise<CashSessionPartialCloseRow> {
    const row = result<PartialCloseDb>(
      await client.query(
        `insert into cash_session_partial_closes
         (id,company_id,branch_id,cash_session_id,taken_at,opening_amount,cash_sales_total,cash_in_total,cash_out_total,expected_cash,created_by,created_at,operational_summary)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$5,$12::jsonb)
         returning ${PARTIAL_CLOSE_COLUMNS}`,
        [
          input.id,
          input.companyId,
          input.branchId,
          input.cashSessionId,
          input.takenAt,
          input.openingAmount,
          input.cashSalesTotal,
          input.cashInTotal,
          input.cashOutTotal,
          input.expectedCash,
          input.createdBy,
          input.operationalSummary === null ? null : JSON.stringify(input.operationalSummary),
        ],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Partial-close insertion did not return a row.');
    return partialClose(row);
  }

  /** The audit trail Part F.3 requires — every snapshot ever taken for
   * this session, oldest first (matching every other history list this
   * module already exposes as chronological, e.g. `movementsForSession`). */
  public async partialClosesForSession(
    companyId: string,
    cashSessionId: string,
  ): Promise<CashSessionPartialCloseRow[]> {
    const rows = result<PartialCloseDb>(
      await this.database.pool.query(
        `select ${PARTIAL_CLOSE_COLUMNS} from cash_session_partial_closes
         where company_id=$1 and cash_session_id=$2 order by taken_at asc, id asc`,
        [companyId, cashSessionId],
      ),
    ).rows;
    return rows.map(partialClose);
  }

  // --- Operational summary ("Resumen operativo") (TASK 16.13) --------------

  /** Computes the reporting-only "how's the business doing" breakdown for
   * a partial cut — Ventas/Taquilla, Cafetería/Snacks (an authoritatively-
   * classified SUBSET of Taquilla, never additive on top of it), and
   * Eventos/Fiestas (a genuinely separate domain — see below). Real SQL
   * `sum`/`count`/`group by` throughout, mirroring
   * `DashboardRepository.outstandingPartyBalances`'s own established
   * cross-domain-read convention exactly (a repository reading another
   * module's tables directly for a read-only aggregate report, never a
   * new cross-service dependency). Called from inside `CashService.
   * partialClose`'s transaction but — exactly like `movementsForSession`
   * above — reads through the plain pool, not the transaction client;
   * this mirrors that method's own precedent rather than inventing a
   * stricter isolation guarantee the rest of this module doesn't have.
   *
   * Double-counting analysis (TASK 16.13 §4/§17):
   *  - `pos` is every `sales` row for this branch, any payment method,
   *    completed within the window — genuinely independent of the
   *    session's own cash-only `expectedCash` fold above.
   *  - `cafeteria` is computed from `sale_items.operational_group_
   *    snapshot='cafeteria'` — a SUBSET of the exact same `sales` rows
   *    `pos` already counted, at line-item granularity. It is never
   *    summed into `pos`'s own total; the two numbers are presented
   *    side by side, subset and superset. TASK 16.13A: this now reads
   *    the FROZEN per-line snapshot recorded at sale-creation time
   *    (`SalesService.createSale`), never a live join to
   *    `products`/`product_categories` — a later admin reassignment of
   *    a product's category can never rewrite a historical report. The
   *    one exception is `cafeteria.available` below, which intentionally
   *    DOES read the LIVE `product_categories` table — it answers "is
   *    Cafetería configured at all right now," a present-tense
   *    configuration question, not a historical-classification one.
   *  - `events` is built entirely from `party_reservations`/
   *    `party_reservation_payments`. A party deposit/payment is recorded
   *    via `PartyReservationsService.recordPayment`, which posts directly
   *    to `cash_movements` (`reference_type='party_reservation'`) and
   *    NEVER inserts a `sales`/`sale_items` row — confirmed by schema
   *    inspection, not assumed. `events` can therefore never double-count
   *    against `pos`/`cafeteria`, and vice versa.
   *
   * `asOfDate` (used for `reservationsOccurringToday`) is the caller's
   * own pre-computed branch-LOCAL calendar date string — TASK 16.13A
   * fixed a UTC-day-boundary bug by moving that computation to
   * `CashService.partialClose`, which resolves the branch's own IANA
   * `timezone` first; this method itself stays timezone-agnostic, just
   * comparing `event_date` to whatever date string it's given. */
  public async operationalSummary(
    companyId: string,
    branchId: string,
    windowStart: Date,
    windowEnd: Date,
    asOfDate: string,
  ): Promise<CashPartialCloseOperationalSummary> {
    const [
      posResult,
      cafeteriaAvailableResult,
      cafeteriaResult,
      eventsCreatedResult,
      eventsCancelledResult,
      eventsPaymentsResult,
      eventsCollectedForNewResult,
      eventsOccurringTodayResult,
    ] = await Promise.all([
      this.database.pool.query(
        `select
           (select count(*) from sales where company_id=$1 and branch_id=$2 and status='completed' and completed_at>=$3 and completed_at<=$4) as ticket_count,
           (select coalesce(sum(total),0) from sales where company_id=$1 and branch_id=$2 and status='completed' and completed_at>=$3 and completed_at<=$4) as gross_sales,
           (select coalesce(sum(total),0) from refunds where company_id=$1 and branch_id=$2 and status='completed' and completed_at>=$3 and completed_at<=$4) as refunds_total`,
        [companyId, branchId, windowStart, windowEnd],
      ),
      this.database.pool.query(
        `select exists(select 1 from product_categories where company_id=$1 and operational_group='cafeteria') as available`,
        [companyId],
      ),
      this.database.pool.query(
        // TASK 16.13A — classification now reads `sale_items.
        // operational_group_snapshot` directly, the FROZEN fact
        // recorded at sale-creation time — never a live join back to
        // `products`/`product_categories`, which drifts the moment an
        // admin later reassigns a product's category. This also removes
        // TASK 16.13's own previously-documented limitation (§13 of its
        // report) about category reassignment affecting historical
        // reports.
        `select
           (select count(distinct si.sale_id)
            from sale_items si join sales s on s.company_id=si.company_id and s.id=si.sale_id
            where si.company_id=$1 and si.branch_id=$2 and si.operational_group_snapshot='cafeteria'
              and s.status='completed' and s.completed_at>=$3 and s.completed_at<=$4) as ticket_count,
           (select coalesce(sum(si.quantity),0)
            from sale_items si join sales s on s.company_id=si.company_id and s.id=si.sale_id
            where si.company_id=$1 and si.branch_id=$2 and si.operational_group_snapshot='cafeteria'
              and s.status='completed' and s.completed_at>=$3 and s.completed_at<=$4) as units_sold,
           (select coalesce(sum(si.line_total),0)
            from sale_items si join sales s on s.company_id=si.company_id and s.id=si.sale_id
            where si.company_id=$1 and si.branch_id=$2 and si.operational_group_snapshot='cafeteria'
              and s.status='completed' and s.completed_at>=$3 and s.completed_at<=$4) as gross_sales,
           (select coalesce(sum(ri.line_total),0)
            from refund_items ri join refunds r on r.company_id=ri.company_id and r.id=ri.refund_id
            join sale_items si on si.company_id=ri.company_id and si.id=ri.sale_item_id
            where ri.company_id=$1 and ri.branch_id=$2 and si.operational_group_snapshot='cafeteria'
              and r.status='completed' and r.completed_at>=$3 and r.completed_at<=$4) as refunds_total`,
        [companyId, branchId, windowStart, windowEnd],
      ),
      this.database.pool.query(
        `select count(*) as count, coalesce(sum(quoted_total),0) as contracted_value
         from party_reservations
         where company_id=$1 and branch_id=$2 and created_at>=$3 and created_at<=$4 and status<>'cancelled'`,
        [companyId, branchId, windowStart, windowEnd],
      ),
      this.database.pool.query(
        `select count(*) as count from party_reservations
         where company_id=$1 and branch_id=$2 and cancelled_at>=$3 and cancelled_at<=$4`,
        [companyId, branchId, windowStart, windowEnd],
      ),
      this.database.pool.query(
        `select
           coalesce(sum(amount_snapshot) filter (where purpose='deposit'),0) as deposits_collected,
           coalesce(sum(amount_snapshot),0) as total_collected
         from party_reservation_payments
         where company_id=$1 and branch_id=$2 and created_at>=$3 and created_at<=$4`,
        [companyId, branchId, windowStart, windowEnd],
      ),
      this.database.pool.query(
        `select coalesce(sum(p.amount_snapshot),0) as collected
         from party_reservation_payments p
         join party_reservations r on r.company_id=p.company_id and r.id=p.reservation_id
         where p.company_id=$1 and p.branch_id=$2
           and r.created_at>=$3 and r.created_at<=$4 and p.created_at<=$4`,
        [companyId, branchId, windowStart, windowEnd],
      ),
      this.database.pool.query(
        `select count(*) as count from party_reservations
         where company_id=$1 and branch_id=$2 and event_date=$3::date and status<>'cancelled'`,
        [companyId, branchId, asOfDate],
      ),
    ]);
    const posRow = result<{ ticket_count: string; gross_sales: string; refunds_total: string }>(posResult).rows[0];
    const cafeteriaAvailableRow = result<{ available: boolean }>(cafeteriaAvailableResult).rows[0];
    const cafeteriaRow = result<{
      ticket_count: string;
      units_sold: string;
      gross_sales: string;
      refunds_total: string;
    }>(cafeteriaResult).rows[0];
    const eventsCreatedRow = result<{ count: string; contracted_value: string }>(eventsCreatedResult).rows[0];
    const eventsCancelledRow = result<{ count: string }>(eventsCancelledResult).rows[0];
    const eventsPaymentsRow = result<{ deposits_collected: string; total_collected: string }>(
      eventsPaymentsResult,
    ).rows[0];
    const eventsCollectedForNewRow = result<{ collected: string }>(eventsCollectedForNewResult).rows[0];
    const eventsOccurringTodayRow = result<{ count: string }>(eventsOccurringTodayResult).rows[0];

    const posGross = moneyUnits(posRow?.gross_sales ?? '0');
    const posRefunds = moneyUnits(posRow?.refunds_total ?? '0');
    const cafeteriaGross = moneyUnits(cafeteriaRow?.gross_sales ?? '0');
    const cafeteriaRefunds = moneyUnits(cafeteriaRow?.refunds_total ?? '0');
    const contractedValue = moneyUnits(eventsCreatedRow?.contracted_value ?? '0');
    const collectedForNew = moneyUnits(eventsCollectedForNewRow?.collected ?? '0');
    const outstandingForNew = contractedValue - collectedForNew;

    return {
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      pos: {
        grossSales: formatMoney(posGross),
        refundsTotal: formatMoney(posRefunds),
        netSales: formatMoney(posGross - posRefunds),
        ticketCount: Number(posRow?.ticket_count ?? '0'),
      },
      cafeteria: {
        available: cafeteriaAvailableRow?.available ?? false,
        grossSales: formatMoney(cafeteriaGross),
        refundsTotal: formatMoney(cafeteriaRefunds),
        netSales: formatMoney(cafeteriaGross - cafeteriaRefunds),
        ticketCount: Number(cafeteriaRow?.ticket_count ?? '0'),
        unitsSold: cafeteriaRow?.units_sold ?? '0',
      },
      events: {
        reservationsCreated: Number(eventsCreatedRow?.count ?? '0'),
        contractedValue: formatMoney(contractedValue),
        collectedForNewReservations: formatMoney(collectedForNew),
        outstandingForNewReservations: formatMoney(outstandingForNew < 0n ? 0n : outstandingForNew),
        depositsCollected: eventsPaymentsRow?.deposits_collected ?? '0.0000',
        totalCollected: eventsPaymentsRow?.total_collected ?? '0.0000',
        cancelledCount: Number(eventsCancelledRow?.count ?? '0'),
        reservationsOccurringToday: Number(eventsOccurringTodayRow?.count ?? '0'),
      },
    };
  }

  /** TASK 16.14 §6 — "Ventas por método de pago": real captured-payment
   * totals grouped by `payments.payment_method`, for the SAME
   * `[windowStart, windowEnd]`/branch scope `operationalSummary` above
   * already uses (so "Ventas / Taquilla" and this breakdown describe the
   * identical underlying sales activity, just sliced two different ways
   * — by business category there, by tender here). Deliberately reads
   * `payments`/`refunds` directly, NEVER `cash_movements` — a card/other
   * sale has no cash-drawer footprint at all (only a `cash`-tendered
   * payment ever posts a `cash_sale` movement), so this must stay a
   * wholly separate query from `expectedCash`'s ledger fold, and the two
   * are allowed — expected — to disagree (see this task's own
   * `docs/LEGACY_FUNCTIONAL_PARITY.md` section for the full "why these
   * are different numbers" explanation this task requires).
   *
   * Only a method that genuinely appears in a captured payment OR a
   * completed refund within the window is ever returned — never a
   * fabricated zero row for a method nothing produced (e.g. the POS's
   * own inert "Transfer" button, which has no backend `payment_method`
   * counterpart at all — see `pos_shell.dart`'s `_PosPayGrid`). */
  public async paymentMethodTotals(
    companyId: string,
    branchId: string,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<readonly CashPaymentMethodTotal[]> {
    // Filters on captured_at is not null, deliberately never status=
    // 'captured': a payment that was captured and later fully refunded
    // transitions its own status to 'reversed', but captured_at itself is
    // never cleared on that transition (see PaymentRepository.
    // updatePaymentStatus's own coalesce($6,captured_at)) — gross sales
    // must reflect the historical fact that the sale happened, never make
    // a fully-refunded sale silently vanish from its own gross total. The
    // refund itself is still fully, separately accounted for below.
    const rows = result<{ method: string; gross_sales_total: string; refunds_total: string; ticket_count: string }>(
      await this.database.pool.query(
        `with sales_by_method as (
           select p.payment_method as method, coalesce(sum(p.amount),0) as gross, count(*) as ticket_count
           from payments p
           join sales s on s.company_id=p.company_id and s.id=p.sale_id
           where p.company_id=$1 and s.branch_id=$2 and p.captured_at is not null
             and p.captured_at>=$3 and p.captured_at<=$4
           group by p.payment_method
         ),
         refunds_by_method as (
           select refund_method as method, coalesce(sum(total),0) as refunds
           from refunds
           where company_id=$1 and branch_id=$2 and status='completed'
             and completed_at>=$3 and completed_at<=$4
           group by refund_method
         )
         select
           coalesce(s.method, r.method) as method,
           coalesce(s.gross,0) as gross_sales_total,
           coalesce(r.refunds,0) as refunds_total,
           coalesce(s.ticket_count,0) as ticket_count
         from sales_by_method s
         full outer join refunds_by_method r on r.method = s.method
         order by 1`,
        [companyId, branchId, windowStart, windowEnd],
      ),
    ).rows;
    return rows.map((row) => {
      const gross = moneyUnits(row.gross_sales_total);
      const refunds = moneyUnits(row.refunds_total);
      return {
        method: row.method,
        grossSalesTotal: formatMoney(gross),
        refundsTotal: formatMoney(refunds),
        netTotal: formatMoney(gross - refunds),
        ticketCount: Number(row.ticket_count),
      };
    });
  }

  // --- Audit trail ("Bitácora") (TASK 16.11 §13) ---------------------------

  /** Projects the existing `audit_log` table down to one cash session's own
   * lifecycle — its own `cash_session` row, plus every `cash_movement`/
   * `cash_session_partial_close` row that belongs to it (joined by id,
   * since `audit_log` itself only ever carries the mutated entity's own id,
   * never a session id for those two entity types). Never a second write
   * path: this only ever reads rows `auditAndPublish` already wrote.
   *
   * TASK 16.11A §3 — SCOPE BOUNDARY, documented on purpose: this is the
   * cash SESSION's own operational audit trail (open/manual movement/
   * reversal/partial-close/close) — it is NOT a complete financial
   * timeline. A `cash_sale` movement's own evidence lives in the payment
   * domain's audit rows (`resourceType: 'payment'`/`'payment_attempt'`,
   * written by `PaymentService.createCashPayment`), which this method
   * deliberately never composes in: doing so would mean surfacing
   * payment-internals action names inside a cash-drawer log, and would
   * duplicate evidence that already has its own authoritative home (the
   * sale/payment's own history) — see `cash.integration.test.ts`'s own
   * "never shows a cash_sale as a cash_movement audit entry" test, which
   * pins this as intentional. */
  public async auditLogForSession(
    companyId: string,
    cashSessionId: string,
    limit: number,
  ): Promise<CashAuditLogEntry[]> {
    const rows = result<{
      id: string;
      branch_id: string | null;
      actor_type: string;
      actor_id: string | null;
      action: string;
      entity_type: string;
      entity_id: string | null;
      metadata: Readonly<Record<string, unknown>>;
      occurred_at: string;
    }>(
      await this.database.pool.query(
        `select id,branch_id,actor_type,actor_id,action,entity_type,entity_id,metadata,occurred_at
         from audit_log
         where company_id=$1
           and (
             (entity_type='cash_session' and entity_id=$2)
             or (entity_type='cash_movement' and entity_id in (
               select id from cash_movements where company_id=$1 and cash_session_id=$2
             ))
             or (entity_type='cash_session_partial_close' and entity_id in (
               select id from cash_session_partial_closes where company_id=$1 and cash_session_id=$2
             ))
           )
         order by occurred_at asc, id asc
         limit $3`,
        [companyId, cashSessionId, limit],
      ),
    ).rows;
    return rows.map((row) => ({
      id: row.id,
      branchId: row.branch_id,
      actorType: row.actor_type,
      actorId: row.actor_id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      metadata: row.metadata,
      occurredAt: new Date(row.occurred_at),
    }));
  }

  private mapDatabaseError(error: unknown): unknown {
    switch (constraint(error)) {
      case 'cash_registers_company_branch_code_active_uq':
        return new CashError('validation_error', 'This register code was already used.');
      case 'cash_sessions_register_active_uq':
        return new CashError('cash_session_already_open', 'The register already has an open session.');
      case 'cash_movements_payment_reference_uq':
        return new CashError('validation_error', 'A cash movement for this payment was already recorded.');
      // Defense in depth only — `CashService.reverseMovement` already
      // checks `hasReversal` server-side before this insert is ever
      // attempted, so a real request should never reach this constraint
      // (only a genuine race between two concurrent reversal attempts
      // would, and that race is exactly what this index exists to close).
      case 'cash_movements_reversal_of_uq':
        return new CashError('cash_movement_already_reversed', 'This movement was already reversed.');
      // Defense in depth only — `CashService.createMovement` already
      // validates the exact same rule server-side before this insert is
      // ever attempted (see `validateMovementCategory`), so a real
      // request should never reach this constraint.
      case 'cash_movements_category_ck':
      case 'cash_movements_category_direction_ck':
        return new CashError('validation_error', 'The category is not valid for this movement type.');
      default:
        return error;
    }
  }
}

/** Same opaque `(occurred_at, id)` cursor shape ADR-0013 established for
 * sales history — reused verbatim rather than inventing a second cursor
 * format for a structurally identical newest/oldest-first list need. */
export function encodeCashCursor(occurredAt: Date, id: string): string {
  return Buffer.from(JSON.stringify([occurredAt.toISOString(), id]), 'utf8').toString('base64url');
}
export function decodeCashCursor(cursor: string): { occurredAt: Date; id: string } {
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
    throw new CashError('validation_error', 'The cursor is invalid.');
  }
}
