import { randomUUID } from 'node:crypto';

import type { DatabaseClient } from '@asone/database';

import {
  PaymentError,
  type AttemptTransitionInput,
  type PaymentAttemptRow,
  type PaymentAttemptStatus,
  type PaymentMutationContext,
  type PaymentRow,
  type PaymentStatus,
  type PaymentTerminalRow,
  type TerminalStatus,
} from './payments.types.js';

export interface PaymentTransaction {
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

interface TerminalDb {
  id: string;
  company_id: string;
  branch_id: string;
  device_id: string;
  provider: string;
  provider_terminal_id: string | null;
  capabilities: Readonly<Record<string, unknown>> | null;
  status: TerminalStatus;
  version: string;
  created_at: Date | string;
  updated_at: Date | string;
}
interface PaymentDb {
  id: string;
  company_id: string;
  branch_id: string;
  sale_id: string;
  payment_method: PaymentRow['paymentMethod'];
  amount: string;
  currency_code: string;
  provider: string | null;
  terminal_id: string | null;
  status: PaymentStatus;
  reason_code: string | null;
  metadata: Readonly<Record<string, unknown>> | null;
  created_by: string;
  authorized_at: Date | string | null;
  captured_at: Date | string | null;
  failed_at: Date | string | null;
  reversed_at: Date | string | null;
  version: string;
  created_at: Date | string;
  updated_at: Date | string;
}
interface AttemptDb {
  id: string;
  company_id: string;
  payment_id: string;
  attempt_number: number;
  terminal_id: string | null;
  status: PaymentAttemptStatus;
  provider_reference: string | null;
  decline_reason: string | null;
  metadata: Readonly<Record<string, unknown>> | null;
  requested_at: Date | string;
  responded_at: Date | string | null;
  version: string;
  created_at: Date | string;
  updated_at: Date | string;
}
interface IdempotencyDb {
  request_hash: string;
  response_body: unknown;
}

const TERMINAL_COLUMNS =
  'id,company_id,branch_id,device_id,provider,provider_terminal_id,capabilities,status,version,created_at,updated_at';
const PAYMENT_COLUMNS =
  'id,company_id,branch_id,sale_id,payment_method,amount,currency_code,provider,terminal_id,status,reason_code,metadata,created_by,authorized_at,captured_at,failed_at,reversed_at,version,created_at,updated_at';
const ATTEMPT_COLUMNS =
  'id,company_id,payment_id,attempt_number,terminal_id,status,provider_reference,decline_reason,metadata,requested_at,responded_at,version,created_at,updated_at';

function terminal(row: TerminalDb): PaymentTerminalRow {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    deviceId: row.device_id,
    provider: row.provider,
    providerTerminalId: row.provider_terminal_id,
    capabilities: row.capabilities,
    status: row.status,
    version: BigInt(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
function payment(row: PaymentDb): PaymentRow {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    saleId: row.sale_id,
    paymentMethod: row.payment_method,
    amount: row.amount,
    currencyCode: row.currency_code,
    provider: row.provider,
    terminalId: row.terminal_id,
    status: row.status,
    reasonCode: row.reason_code,
    metadata: row.metadata,
    createdBy: row.created_by,
    authorizedAt: row.authorized_at === null ? null : new Date(row.authorized_at),
    capturedAt: row.captured_at === null ? null : new Date(row.captured_at),
    failedAt: row.failed_at === null ? null : new Date(row.failed_at),
    reversedAt: row.reversed_at === null ? null : new Date(row.reversed_at),
    version: BigInt(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
function attempt(row: AttemptDb): PaymentAttemptRow {
  return {
    id: row.id,
    companyId: row.company_id,
    paymentId: row.payment_id,
    attemptNumber: row.attempt_number,
    terminalId: row.terminal_id,
    status: row.status,
    providerReference: row.provider_reference,
    declineReason: row.decline_reason,
    metadata: row.metadata,
    requestedAt: new Date(row.requested_at),
    respondedAt: row.responded_at === null ? null : new Date(row.responded_at),
    version: BigInt(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class PaymentRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async transaction<T>(callback: (client: PaymentTransaction) => Promise<T>): Promise<T> {
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
    client: PaymentTransaction,
    context: PaymentMutationContext,
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
        throw new PaymentError(
          'idempotency_conflict',
          'The idempotency key was used with another request.',
        );
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
    client: PaymentTransaction,
    context: PaymentMutationContext,
    input: {
      action: string;
      resourceType: 'payment_terminal' | 'payment' | 'payment_attempt';
      resourceId: string;
      eventType: string;
      version: bigint;
      payload: Readonly<Record<string, unknown>>;
      /** TASK 12.4B.1: a webhook-driven transition has no human actor —
       * defaults to `'user'` (unchanged behavior) for every existing
       * caller. */
      actorType?: 'user' | 'system';
    },
  ): Promise<void> {
    await client.query(
      `insert into audit_log
       (id,company_id,actor_type,actor_id,action,entity_type,entity_id,request_id,correlation_id,metadata,occurred_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`,
      [
        randomUUID(),
        context.companyId,
        input.actorType ?? 'user',
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

  // --- Terminals -----------------------------------------------------

  public async validateDevice(
    client: PaymentTransaction,
    companyId: string,
    branchId: string,
    deviceId: string,
  ): Promise<void> {
    const row = result<{ status: string; device_type: string }>(
      await client.query(
        `select status,device_type from devices where company_id=$1 and id=$2 and branch_id=$3`,
        [companyId, deviceId, branchId],
      ),
    ).rows[0];
    if (row === undefined)
      throw new PaymentError(
        'validation_error',
        'The device was not found in the requested branch.',
      );
    if (row.device_type !== 'card_terminal')
      throw new PaymentError('validation_error', 'The device is not a card_terminal device.');
    if (row.status !== 'active' && row.status !== 'pending')
      throw new PaymentError('validation_error', 'The device is revoked or disabled.');
  }

  public async insertTerminal(
    client: PaymentTransaction,
    input: PaymentMutationContext & {
      id: string;
      branchId: string;
      deviceId: string;
      provider: string;
      providerTerminalId: string | null;
      capabilities: Readonly<Record<string, unknown>> | null;
    },
  ): Promise<PaymentTerminalRow> {
    const row = result<TerminalDb>(
      await client.query(
        `insert into payment_terminals
         (id,company_id,branch_id,device_id,provider,provider_terminal_id,capabilities,status,created_at,updated_at)
         values ($1,$2,$3,$4,$5,$6,$7::jsonb,'assigned',$8,$8)
         returning ${TERMINAL_COLUMNS}`,
        [
          input.id,
          input.companyId,
          input.branchId,
          input.deviceId,
          input.provider,
          input.providerTerminalId,
          input.capabilities === null ? null : JSON.stringify(input.capabilities),
          input.timestamp,
        ],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Payment terminal insertion did not return a row.');
    return terminal(row);
  }

  public async terminal(companyId: string, id: string): Promise<PaymentTerminalRow | null> {
    const row = result<TerminalDb>(
      await this.database.pool.query(
        `select ${TERMINAL_COLUMNS} from payment_terminals where company_id=$1 and id=$2`,
        [companyId, id],
      ),
    ).rows[0];
    return row === undefined ? null : terminal(row);
  }

  public async lockTerminal(
    client: PaymentTransaction,
    companyId: string,
    id: string,
  ): Promise<PaymentTerminalRow | null> {
    const row = result<TerminalDb>(
      await client.query(
        `select ${TERMINAL_COLUMNS} from payment_terminals where company_id=$1 and id=$2 for update`,
        [companyId, id],
      ),
    ).rows[0];
    return row === undefined ? null : terminal(row);
  }

  public async listTerminals(
    companyId: string,
    branchIds: readonly string[],
    input: { limit: number; cursor?: string; branchId?: string; status?: TerminalStatus },
  ): Promise<{ items: PaymentTerminalRow[]; nextCursor: string | null }> {
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
    if (input.cursor !== undefined) {
      values.push(input.cursor);
      where.push(`id>$${String(values.length)}`);
    }
    values.push(input.limit + 1);
    const rows = result<TerminalDb>(
      await this.database.pool.query(
        `select ${TERMINAL_COLUMNS} from payment_terminals where ${where.join(' and ')}
         order by id asc limit $${String(values.length)}`,
        values,
      ),
    ).rows;
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit).map(terminal);
    return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
  }

  // --- Payments --------------------------------------------------------

  public async insertPayment(
    client: PaymentTransaction,
    input: PaymentMutationContext & {
      id: string;
      branchId: string;
      saleId: string;
      paymentMethod: PaymentRow['paymentMethod'];
      amount: string;
      currencyCode: string;
      provider: string | null;
      terminalId: string | null;
      metadata: Readonly<Record<string, unknown>> | null;
    },
  ): Promise<PaymentRow> {
    const row = result<PaymentDb>(
      await client.query(
        `insert into payments
         (id,company_id,branch_id,sale_id,payment_method,amount,currency_code,provider,
          terminal_id,status,metadata,created_by,created_at,updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10::jsonb,$11,$12,$12)
         returning ${PAYMENT_COLUMNS}`,
        [
          input.id,
          input.companyId,
          input.branchId,
          input.saleId,
          input.paymentMethod,
          input.amount,
          input.currencyCode,
          input.provider,
          input.terminalId,
          input.metadata === null ? null : JSON.stringify(input.metadata),
          input.actorId,
          input.timestamp,
        ],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Payment insertion did not return a row.');
    return payment(row);
  }

  public async payment(companyId: string, id: string): Promise<PaymentRow | null> {
    const row = result<PaymentDb>(
      await this.database.pool.query(
        `select ${PAYMENT_COLUMNS} from payments where company_id=$1 and id=$2`,
        [companyId, id],
      ),
    ).rows[0];
    return row === undefined ? null : payment(row);
  }

  public async lockPayment(
    client: PaymentTransaction,
    companyId: string,
    branchIds: readonly string[],
    id: string,
  ): Promise<PaymentRow | null> {
    const row = result<PaymentDb>(
      await client.query(
        `select ${PAYMENT_COLUMNS} from payments
         where company_id=$1 and id=$2 and branch_id=any($3::uuid[]) for update`,
        [companyId, id, branchIds],
      ),
    ).rows[0];
    return row === undefined ? null : payment(row);
  }

  /** TASK 12.5A: the server-authoritative "how much has this sale already
   * collected" figure — the same `sum(amount) where status='captured'`
   * query `SalesRepository.trySettleSale` already runs to decide whether
   * a sale can complete (see its own comment), duplicated here rather
   * than imported so this module stays self-contained the same way its
   * sibling money helpers already are (see `payments.service.ts`). Must
   * be called against a `client` that is already holding the sale row's
   * `for update` lock (see `PaymentService.createCashPayment`) so the sum
   * observes every payment committed so far and none created afterward. */
  public async capturedTotalForSale(
    client: PaymentTransaction,
    companyId: string,
    saleId: string,
  ): Promise<string> {
    const row = result<{ total: string | null }>(
      await client.query(
        `select sum(amount)::text as total from payments
         where company_id=$1 and sale_id=$2 and status='captured'`,
        [companyId, saleId],
      ),
    ).rows[0];
    return row?.total ?? '0';
  }

  public async updatePaymentStatus(
    client: PaymentTransaction,
    companyId: string,
    id: string,
    expectedVersion: bigint,
    input: {
      status: PaymentStatus;
      reasonCode: string | null;
      timestamp: Date;
      authorizedAt?: Date;
      capturedAt?: Date;
      failedAt?: Date;
      reversedAt?: Date;
    },
  ): Promise<PaymentRow> {
    const row = result<PaymentDb>(
      await client.query(
        `update payments set
           status=$3,
           reason_code=$4,
           authorized_at=coalesce($5,authorized_at),
           captured_at=coalesce($6,captured_at),
           failed_at=coalesce($7,failed_at),
           reversed_at=coalesce($8,reversed_at),
           version=version+1,
           updated_at=$9
         where company_id=$1 and id=$2 and version=$10
         returning ${PAYMENT_COLUMNS}`,
        [
          companyId,
          id,
          input.status,
          input.reasonCode,
          input.authorizedAt ?? null,
          input.capturedAt ?? null,
          input.failedAt ?? null,
          input.reversedAt ?? null,
          input.timestamp,
          expectedVersion.toString(),
        ],
      ),
    ).rows[0];
    if (row === undefined)
      throw new PaymentError('version_conflict', 'The payment version changed.');
    return payment(row);
  }

  public async listPayments(
    companyId: string,
    branchIds: readonly string[],
    input: {
      limit: number;
      cursor?: string;
      branchId?: string;
      status?: PaymentStatus;
      saleId?: string;
    },
  ): Promise<{ items: PaymentRow[]; nextCursor: string | null }> {
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
    if (input.saleId !== undefined) {
      values.push(input.saleId);
      where.push(`sale_id=$${String(values.length)}`);
    }
    if (input.cursor !== undefined) {
      values.push(input.cursor);
      where.push(`id>$${String(values.length)}`);
    }
    values.push(input.limit + 1);
    const rows = result<PaymentDb>(
      await this.database.pool.query(
        `select ${PAYMENT_COLUMNS} from payments where ${where.join(' and ')}
         order by id asc limit $${String(values.length)}`,
        values,
      ),
    ).rows;
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit).map(payment);
    return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
  }

  // --- Attempts --------------------------------------------------------

  public async nextAttemptNumber(
    client: PaymentTransaction,
    companyId: string,
    paymentId: string,
  ): Promise<number> {
    const row = result<{ next: number }>(
      await client.query(
        `select coalesce(max(attempt_number),0)+1 next from payment_attempts
         where company_id=$1 and payment_id=$2`,
        [companyId, paymentId],
      ),
    ).rows[0];
    return row?.next ?? 1;
  }

  public async insertAttempt(
    client: PaymentTransaction,
    input: PaymentMutationContext & {
      id: string;
      paymentId: string;
      attemptNumber: number;
      terminalId: string | null;
      status: PaymentAttemptStatus;
      metadata: Readonly<Record<string, unknown>> | null;
    },
  ): Promise<PaymentAttemptRow> {
    const row = result<AttemptDb>(
      await client.query(
        `insert into payment_attempts
         (id,company_id,payment_id,attempt_number,terminal_id,status,metadata,requested_at,created_at,updated_at)
         values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$8,$8)
         returning ${ATTEMPT_COLUMNS}`,
        [
          input.id,
          input.companyId,
          input.paymentId,
          input.attemptNumber,
          input.terminalId,
          input.status,
          input.metadata === null ? null : JSON.stringify(input.metadata),
          input.timestamp,
        ],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Payment attempt insertion did not return a row.');
    return attempt(row);
  }

  public async attempt(companyId: string, id: string): Promise<PaymentAttemptRow | null> {
    const row = result<AttemptDb>(
      await this.database.pool.query(
        `select ${ATTEMPT_COLUMNS} from payment_attempts where company_id=$1 and id=$2`,
        [companyId, id],
      ),
    ).rows[0];
    return row === undefined ? null : attempt(row);
  }

  public async lockAttempt(
    client: PaymentTransaction,
    companyId: string,
    id: string,
  ): Promise<PaymentAttemptRow | null> {
    const row = result<AttemptDb>(
      await client.query(
        `select ${ATTEMPT_COLUMNS} from payment_attempts where company_id=$1 and id=$2 for update`,
        [companyId, id],
      ),
    ).rows[0];
    return row === undefined ? null : attempt(row);
  }

  public async attemptsForPayment(
    companyId: string,
    paymentId: string,
  ): Promise<PaymentAttemptRow[]> {
    const rows = result<AttemptDb>(
      await this.database.pool.query(
        `select ${ATTEMPT_COLUMNS} from payment_attempts
         where company_id=$1 and payment_id=$2 order by attempt_number asc`,
        [companyId, paymentId],
      ),
    ).rows;
    return rows.map(attempt);
  }

  public async findAttemptByProviderReference(
    companyId: string,
    providerReference: string,
  ): Promise<PaymentAttemptRow | null> {
    const row = result<AttemptDb>(
      await this.database.pool.query(
        `select ${ATTEMPT_COLUMNS} from payment_attempts
         where company_id=$1 and provider_reference=$2`,
        [companyId, providerReference],
      ),
    ).rows[0];
    return row === undefined ? null : attempt(row);
  }

  /**
   * TASK 12.4B.1: the one deliberately *unscoped* lookup in this
   * repository — a webhook notification carries no AS tenant context at
   * all (Mercado Pago has no concept of an AS company/branch), so there
   * is no `company_id` to scope by yet at the moment the webhook needs to
   * find out which attempt it is even about. Safe specifically because:
   * (a) `provider_reference` is Mercado Pago's own globally-unique order
   * id, never guessable and never exposed to Flutter; (b) this lookup
   * only ever *identifies* a row — every subsequent read/write uses that
   * row's own real `company_id`/`branch_id`, never anything the webhook
   * body itself supplied; (c) the authoritative order data is always
   * re-fetched from Mercado Pago's own `GET /v1/orders/{id}` before any
   * state changes, never trusted from the notification body. See
   * ADR-0010 "never trust provider_reference alone without scoping."
   */
  public async findAttemptCompanyByProviderReference(providerReference: string): Promise<{
    attemptId: string;
    companyId: string;
    branchId: string;
    paymentId: string;
    amount: string;
    currencyCode: string;
  } | null> {
    const row = result<{
      attempt_id: string;
      company_id: string;
      branch_id: string;
      payment_id: string;
      amount: string;
      currency_code: string;
    }>(
      await this.database.pool.query(
        `select pa.id as attempt_id, pa.company_id, p.branch_id, p.id as payment_id, p.amount, p.currency_code
         from payment_attempts pa
         join payments p on p.company_id = pa.company_id and p.id = pa.payment_id
         where pa.provider_reference = $1`,
        [providerReference],
      ),
    ).rows[0];
    if (row === undefined) return null;
    return {
      attemptId: row.attempt_id,
      companyId: row.company_id,
      branchId: row.branch_id,
      paymentId: row.payment_id,
      amount: row.amount,
      currencyCode: row.currency_code,
    };
  }

  public async updateAttemptStatus(
    client: PaymentTransaction,
    companyId: string,
    id: string,
    expectedVersion: bigint,
    input: AttemptTransitionInput & { timestamp: Date; responded: boolean },
  ): Promise<PaymentAttemptRow> {
    const row = result<AttemptDb>(
      await client.query(
        `update payment_attempts set
           status=$3,
           provider_reference=coalesce($4,provider_reference),
           decline_reason=coalesce($5,decline_reason),
           metadata=coalesce($6::jsonb,metadata),
           responded_at=case when $7 then $8 else responded_at end,
           version=version+1,
           updated_at=$8
         where company_id=$1 and id=$2 and version=$9
         returning ${ATTEMPT_COLUMNS}`,
        [
          companyId,
          id,
          input.status,
          input.providerReference ?? null,
          input.declineReason ?? null,
          input.metadata === undefined ? null : JSON.stringify(input.metadata),
          input.responded,
          input.timestamp,
          expectedVersion.toString(),
        ],
      ),
    ).rows[0];
    if (row === undefined)
      throw new PaymentError('version_conflict', 'The payment attempt version changed.');
    return attempt(row);
  }

  private mapDatabaseError(error: unknown): unknown {
    switch (constraint(error)) {
      case 'payment_attempts_company_provider_reference_uq':
        return new PaymentError(
          'duplicate_provider_reference',
          'This provider reference was already recorded for another attempt.',
        );
      case 'payment_terminals_company_device_uq':
        return new PaymentError(
          'validation_error',
          'This device is already registered as a payment terminal.',
        );
      case 'payments_terminal_scope_fk':
        return new PaymentError('validation_error', 'The terminal was not found.');
      case 'payments_sale_scope_fk':
        return new PaymentError(
          'sale_branch_mismatch',
          'The sale was not found for this company and branch.',
        );
      case 'payments_branch_scope_fk':
      case 'payment_terminals_branch_scope_fk':
        return new PaymentError('validation_error', 'The branch was not found.');
      default:
        return error;
    }
  }
}
