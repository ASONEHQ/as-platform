import { randomUUID } from 'node:crypto';

import type { DatabaseClient } from '@asone/database';

import {
  CashError,
  cashMovementDirection,
  type CashMovementRow,
  type CashMovementType,
  type CashMutationContext,
  type CashRegisterRow,
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
  'id,company_id,branch_id,cash_register_id,opened_by,opened_at,opening_amount,currency_code,status,closed_by,closed_at,declared_closing_amount,expected_closing_amount,discrepancy_amount,denomination_counts,version,created_at,updated_at';
const MOVEMENT_COLUMNS =
  'id,company_id,branch_id,cash_session_id,movement_type,amount,currency_code,reason_code,note,reference_type,reference_id,occurred_at,created_by,device_id,reversal_of_id,created_at';

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
  };
}

export class CashRepository {
  public constructor(private readonly database: DatabaseClient) {}

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
      resourceType: 'cash_register' | 'cash_session' | 'cash_movement';
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
    },
  ): Promise<CashMovementRow> {
    const row = result<MovementDb>(
      await client.query(
        `insert into cash_movements
         (id,company_id,branch_id,cash_session_id,movement_type,amount,currency_code,reason_code,note,
          reference_type,reference_id,occurred_at,created_by,device_id,created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$12)
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
        ],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Movement insertion did not return a row.');
    return movement(row);
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

  private mapDatabaseError(error: unknown): unknown {
    switch (constraint(error)) {
      case 'cash_registers_company_branch_code_active_uq':
        return new CashError('validation_error', 'This register code was already used.');
      case 'cash_sessions_register_active_uq':
        return new CashError('cash_session_already_open', 'The register already has an open session.');
      case 'cash_movements_payment_reference_uq':
        return new CashError('validation_error', 'A cash movement for this payment was already recorded.');
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
