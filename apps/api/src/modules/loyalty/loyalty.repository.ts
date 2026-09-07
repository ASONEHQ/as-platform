import { randomUUID } from 'node:crypto';

import type { DatabaseClient } from '@asone/database';

import {
  LoyaltyError,
  type LoyaltyAccountRow,
  type LoyaltyBalance,
  type LoyaltyEntrySourceType,
  type LoyaltyEntryType,
  type LoyaltyLedgerEntryRow,
  type LoyaltyMutationContext,
  type LoyaltyProgramRow,
  type LoyaltyRewardBenefitType,
  type LoyaltyRewardType,
  type LoyaltyUnitType,
} from './loyalty.types.js';

/** Structurally identical to every other module's transaction interface
 * in this codebase — a real `pg` client from `PaymentsService`'s own
 * settlement transaction satisfies this too. */
export interface LoyaltyTransaction {
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
function constraint(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'constraint' in error
    ? String((error as { constraint?: unknown }).constraint)
    : undefined;
}
interface IdempotencyDb {
  request_hash: string;
  response_body: unknown;
}

// TASK 13.2 — `lp.` prefixed and joined against the two new reward-scope
// tables (mirrors `promotions.repository.ts`'s own `PROMOTION_COLUMNS`/
// `PROMOTION_SCOPE_SELECT`/`PROMOTION_SCOPE_JOIN` shape exactly, right
// down to the `group by lp.id` — Postgres' own primary-key functional-
// dependency rule, not a full column list). Every existing call site
// (`program()`, `listPrograms()`) picks up the scope for free; none of
// them needed a second, parallel query.
const PROGRAM_COLUMNS =
  'lp.id,lp.company_id,lp.name,lp.active,lp.unit_type,lp.earning_rule_type,lp.earn_quantity_per_sale,lp.minimum_sale_total,' +
  'lp.reward_threshold,lp.reward_description,lp.reward_type,lp.reward_expiration_days,lp.reward_repeatable,' +
  'lp.reward_benefit_type,lp.reward_benefit_percentage_basis_points,lp.reward_benefit_fixed_amount,' +
  'lp.created_by,lp.updated_by,lp.version,lp.created_at,lp.updated_at';
const PROGRAM_SCOPE_SELECT =
  ",coalesce(array_agg(distinct lprp.product_id) filter (where lprp.product_id is not null), '{}') as reward_scope_product_ids" +
  ",coalesce(array_agg(distinct lprc.category_id) filter (where lprc.category_id is not null), '{}') as reward_scope_category_ids";
const PROGRAM_SCOPE_JOIN = `
  left join loyalty_program_reward_products lprp on lprp.company_id=lp.company_id and lprp.loyalty_program_id=lp.id
  left join loyalty_program_reward_categories lprc on lprc.company_id=lp.company_id and lprc.loyalty_program_id=lp.id`;
interface ProgramDb {
  id: string;
  company_id: string;
  name: string;
  active: boolean;
  unit_type: LoyaltyUnitType;
  earning_rule_type: 'per_completed_sale';
  earn_quantity_per_sale: number;
  minimum_sale_total: string | null;
  reward_threshold: number | null;
  reward_description: string | null;
  reward_type: LoyaltyRewardType | null;
  reward_expiration_days: number | null;
  reward_repeatable: boolean;
  reward_benefit_type: LoyaltyRewardBenefitType | null;
  reward_benefit_percentage_basis_points: number | null;
  reward_benefit_fixed_amount: string | null;
  reward_scope_product_ids: string[];
  reward_scope_category_ids: string[];
  created_by: string;
  updated_by: string;
  version: string;
  created_at: Date | string;
  updated_at: Date | string;
}
interface AccountDb {
  id: string;
  company_id: string;
  customer_id: string;
  status: 'active' | 'closed';
  created_at: Date | string;
  updated_at: Date | string;
}
const LEDGER_COLUMNS =
  'id,company_id,loyalty_account_id,loyalty_program_id,branch_id,entry_type,quantity,unit_type,' +
  'source_type,source_id,reason,actor_id,occurred_at,created_at';
interface LedgerDb {
  id: string;
  company_id: string;
  loyalty_account_id: string;
  loyalty_program_id: string | null;
  branch_id: string | null;
  entry_type: LoyaltyEntryType;
  quantity: number;
  unit_type: LoyaltyUnitType;
  source_type: LoyaltyEntrySourceType;
  source_id: string | null;
  reason: string | null;
  actor_id: string | null;
  occurred_at: Date | string;
  created_at: Date | string;
}

function program(row: ProgramDb): LoyaltyProgramRow {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    active: row.active,
    unitType: row.unit_type,
    earningRuleType: row.earning_rule_type,
    earnQuantityPerSale: row.earn_quantity_per_sale,
    minimumSaleTotal: row.minimum_sale_total,
    rewardThreshold: row.reward_threshold,
    rewardDescription: row.reward_description,
    rewardType: row.reward_type,
    rewardExpirationDays: row.reward_expiration_days,
    rewardRepeatable: row.reward_repeatable,
    rewardBenefitType: row.reward_benefit_type,
    rewardBenefitPercentageBasisPoints: row.reward_benefit_percentage_basis_points,
    rewardBenefitFixedAmount: row.reward_benefit_fixed_amount,
    rewardScopeProductIds: row.reward_scope_product_ids,
    rewardScopeCategoryIds: row.reward_scope_category_ids,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    version: BigInt(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
function account(row: AccountDb): LoyaltyAccountRow {
  return {
    id: row.id,
    companyId: row.company_id,
    customerId: row.customer_id,
    status: row.status,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
function ledgerEntry(row: LedgerDb): LoyaltyLedgerEntryRow {
  return {
    id: row.id,
    companyId: row.company_id,
    loyaltyAccountId: row.loyalty_account_id,
    loyaltyProgramId: row.loyalty_program_id,
    branchId: row.branch_id,
    entryType: row.entry_type,
    quantity: row.quantity,
    unitType: row.unit_type,
    sourceType: row.source_type,
    sourceId: row.source_id,
    reason: row.reason,
    actorId: row.actor_id,
    occurredAt: new Date(row.occurred_at),
    createdAt: new Date(row.created_at),
  };
}

export interface InsertProgramInput {
  id: string;
  companyId: string;
  name: string;
  active: boolean;
  unitType: LoyaltyUnitType;
  earnQuantityPerSale: number;
  minimumSaleTotal: string | null;
  rewardThreshold: number | null;
  rewardDescription: string | null;
  rewardType: LoyaltyRewardType | null;
  rewardExpirationDays: number | null;
  rewardRepeatable: boolean;
  rewardBenefitType: LoyaltyRewardBenefitType | null;
  rewardBenefitPercentageBasisPoints: number | null;
  rewardBenefitFixedAmount: string | null;
  createdBy: string;
  timestamp: Date;
}
export interface UpdateProgramFields {
  name?: string;
  active?: boolean;
  unitType?: LoyaltyUnitType;
  earnQuantityPerSale?: number;
  minimumSaleTotal?: string | null;
  rewardThreshold?: number | null;
  rewardDescription?: string | null;
  rewardType?: LoyaltyRewardType | null;
  rewardExpirationDays?: number | null;
  rewardRepeatable?: boolean;
  rewardBenefitType?: LoyaltyRewardBenefitType | null;
  rewardBenefitPercentageBasisPoints?: number | null;
  rewardBenefitFixedAmount?: string | null;
  updatedBy: string;
  timestamp: Date;
}
export interface InsertLedgerEntryInput {
  id: string;
  companyId: string;
  loyaltyAccountId: string;
  loyaltyProgramId: string | null;
  branchId: string | null;
  entryType: LoyaltyEntryType;
  quantity: number;
  unitType: LoyaltyUnitType;
  sourceType: LoyaltyEntrySourceType;
  sourceId: string | null;
  reason: string | null;
  actorId: string | null;
  timestamp: Date;
}

export class LoyaltyRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async transaction<T>(callback: (client: LoyaltyTransaction) => Promise<T>): Promise<T> {
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

  // TASK 13.1 — `updateProgram`'s partial-update path cannot always know
  // ahead of time whether a caller's new field combination still
  // satisfies `loyalty_programs_reward_pair_ck` (that would require
  // reading the current row first); this is the clean fallback so a
  // genuinely inconsistent partial update still surfaces as an honest
  // `validation_error`, never a raw constraint-violation message.
  private mapDatabaseError(error: unknown): unknown {
    if (constraint(error) === 'loyalty_programs_reward_pair_ck')
      return new LoyaltyError('validation_error', 'reward_threshold and reward_type must be set together.');
    if (constraint(error) === 'loyalty_programs_reward_benefit_requires_reward_ck')
      return new LoyaltyError('validation_error', 'reward_benefit_type requires reward_type to already be set.');
    if (constraint(error) === 'loyalty_programs_reward_benefit_value_ck')
      return new LoyaltyError('validation_error', 'The reward benefit value does not match its benefit type.');
    return error;
  }

  public async idempotent<T>(
    client: LoyaltyTransaction,
    context: LoyaltyMutationContext,
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
        `select request_hash,response_body from idempotency_keys where company_id=$1 and operation=$2 and key=$3`,
        [context.companyId, operation, key],
      ),
    ).rows[0];
    if (existing !== undefined) {
      if (existing.request_hash !== requestHash || existing.response_body === null)
        throw new LoyaltyError('validation_error', 'The idempotency key was used with another request.');
      return { value: decode(existing.response_body), replayed: true };
    }
    const id = randomUUID();
    await client.query(
      `insert into idempotency_keys (id,company_id,key,operation,request_hash,expires_at,created_at)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [id, context.companyId, key, operation, requestHash, new Date(context.timestamp.getTime() + 86_400_000), context.timestamp],
    );
    const value = await create();
    await client.query(`update idempotency_keys set response_body=$1::jsonb where id=$2`, [
      JSON.stringify(value, jsonValue),
      id,
    ]);
    return { value, replayed: false };
  }

  public async auditAndPublish(
    client: LoyaltyTransaction,
    context: LoyaltyMutationContext,
    input: {
      action: string;
      resourceType: 'loyalty_program' | 'loyalty_account' | 'loyalty_ledger_entry';
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
        JSON.stringify(input.payload, jsonValue),
        context.timestamp,
      ],
    );
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

  // --- Programs (Part S) ---------------------------------------------------

  public async insertProgram(client: LoyaltyTransaction, input: InsertProgramInput): Promise<LoyaltyProgramRow> {
    await client.query(
      `insert into loyalty_programs
       (id,company_id,name,active,unit_type,earning_rule_type,earn_quantity_per_sale,minimum_sale_total,
        reward_threshold,reward_description,reward_type,reward_expiration_days,reward_repeatable,
        reward_benefit_type,reward_benefit_percentage_basis_points,reward_benefit_fixed_amount,
        created_by,updated_by,created_at,updated_at)
       values ($1,$2,$3,$4,$5,'per_completed_sale',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16,$17,$17)`,
      [
        input.id,
        input.companyId,
        input.name,
        input.active,
        input.unitType,
        input.earnQuantityPerSale,
        input.minimumSaleTotal,
        input.rewardThreshold,
        input.rewardDescription,
        input.rewardType,
        input.rewardExpirationDays,
        input.rewardRepeatable,
        input.rewardBenefitType,
        input.rewardBenefitPercentageBasisPoints,
        input.rewardBenefitFixedAmount,
        input.createdBy,
        input.timestamp,
      ],
    );
    const created = await this.program(client, input.companyId, input.id);
    if (created === null) throw new Error('Loyalty program insertion did not return a row.');
    return created;
  }

  /** TASK 13.2 (Part B) — a straightforward delete-then-reinsert of this
   * program's reward scope, inside the SAME transaction `insertProgram`/
   * `updateProgram` just ran in. A program's scope is small (a handful
   * of products/categories at most) and changes rarely enough that a
   * diff-based partial update would add real complexity for no real
   * benefit — this mirrors the simplest correct pattern already used
   * elsewhere in this codebase for small many-to-many scope sets
   * (`membership_plan_branches`). Called ONLY when the caller actually
   * supplied scope ids (`undefined` means "leave the existing scope
   * alone" on an update; `createProgram` always calls this, even with
   * empty arrays, to establish the row's initial — possibly empty —
   * scope explicitly). */
  public async replaceRewardScope(
    client: LoyaltyTransaction,
    companyId: string,
    loyaltyProgramId: string,
    scope: { productIds: readonly string[]; categoryIds: readonly string[] },
    timestamp: Date,
  ): Promise<void> {
    await client.query(`delete from loyalty_program_reward_products where company_id=$1 and loyalty_program_id=$2`, [
      companyId,
      loyaltyProgramId,
    ]);
    await client.query(`delete from loyalty_program_reward_categories where company_id=$1 and loyalty_program_id=$2`, [
      companyId,
      loyaltyProgramId,
    ]);
    for (const productId of scope.productIds) {
      await client.query(
        `insert into loyalty_program_reward_products (id,company_id,loyalty_program_id,product_id,created_at)
         values ($1,$2,$3,$4,$5)
         on conflict on constraint loyalty_program_reward_products_company_program_product_uq do nothing`,
        [randomUUID(), companyId, loyaltyProgramId, productId, timestamp],
      );
    }
    for (const categoryId of scope.categoryIds) {
      await client.query(
        `insert into loyalty_program_reward_categories (id,company_id,loyalty_program_id,category_id,created_at)
         values ($1,$2,$3,$4,$5)
         on conflict on constraint loyalty_program_reward_categories_company_program_category_uq do nothing`,
        [randomUUID(), companyId, loyaltyProgramId, categoryId, timestamp],
      );
    }
  }

  public async updateProgram(
    client: LoyaltyTransaction,
    companyId: string,
    id: string,
    expectedVersion: bigint,
    fields: UpdateProgramFields,
  ): Promise<LoyaltyProgramRow> {
    const assignments: string[] = [];
    const values: unknown[] = [];
    let index = 1;
    const set = (column: string, value: unknown): void => {
      assignments.push(`${column}=$${String(index)}`);
      values.push(value);
      index += 1;
    };
    if (fields.name !== undefined) set('name', fields.name);
    if (fields.active !== undefined) set('active', fields.active);
    if (fields.unitType !== undefined) set('unit_type', fields.unitType);
    if (fields.earnQuantityPerSale !== undefined) set('earn_quantity_per_sale', fields.earnQuantityPerSale);
    if (fields.minimumSaleTotal !== undefined) set('minimum_sale_total', fields.minimumSaleTotal);
    if (fields.rewardThreshold !== undefined) set('reward_threshold', fields.rewardThreshold);
    if (fields.rewardDescription !== undefined) set('reward_description', fields.rewardDescription);
    if (fields.rewardType !== undefined) set('reward_type', fields.rewardType);
    if (fields.rewardExpirationDays !== undefined) set('reward_expiration_days', fields.rewardExpirationDays);
    if (fields.rewardRepeatable !== undefined) set('reward_repeatable', fields.rewardRepeatable);
    if (fields.rewardBenefitType !== undefined) set('reward_benefit_type', fields.rewardBenefitType);
    if (fields.rewardBenefitPercentageBasisPoints !== undefined)
      set('reward_benefit_percentage_basis_points', fields.rewardBenefitPercentageBasisPoints);
    if (fields.rewardBenefitFixedAmount !== undefined) set('reward_benefit_fixed_amount', fields.rewardBenefitFixedAmount);
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
        `update loyalty_programs set ${assignments.join(',')}
         where company_id=$${String(companyParam)} and id=$${String(idParam)} and version=$${String(versionParam)}
         returning id`,
        values,
      ),
    ).rows[0];
    if (updated === undefined) {
      const current = await this.program(client, companyId, id);
      if (current === null) throw new LoyaltyError('resource_not_found', 'The loyalty program was not found.');
      throw new LoyaltyError('version_conflict', 'The loyalty program was modified by another request.');
    }
    const row = await this.program(client, companyId, id);
    if (row === null) throw new Error('Loyalty program update did not return a row.');
    return row;
  }

  public async program(client: LoyaltyTransaction | null, companyId: string, id: string): Promise<LoyaltyProgramRow | null> {
    const row = result<ProgramDb>(
      await (client ?? this.database.pool).query(
        `select ${PROGRAM_COLUMNS}${PROGRAM_SCOPE_SELECT} from loyalty_programs lp ${PROGRAM_SCOPE_JOIN}
         where lp.company_id=$1 and lp.id=$2 group by lp.id`,
        [companyId, id],
      ),
    ).rows[0];
    return row === undefined ? null : program(row);
  }

  public async listPrograms(companyId: string, active: boolean | null): Promise<LoyaltyProgramRow[]> {
    const rows =
      active === null
        ? result<ProgramDb>(
            await this.database.pool.query(
              `select ${PROGRAM_COLUMNS}${PROGRAM_SCOPE_SELECT} from loyalty_programs lp ${PROGRAM_SCOPE_JOIN}
               where lp.company_id=$1 group by lp.id order by lp.created_at desc`,
              [companyId],
            ),
          ).rows
        : result<ProgramDb>(
            await this.database.pool.query(
              `select ${PROGRAM_COLUMNS}${PROGRAM_SCOPE_SELECT} from loyalty_programs lp ${PROGRAM_SCOPE_JOIN}
               where lp.company_id=$1 and lp.active=$2 group by lp.id order by lp.created_at desc`,
              [companyId, active],
            ),
          ).rows;
    return rows.map(program);
  }

  public async activePrograms(companyId: string): Promise<LoyaltyProgramRow[]> {
    return this.listPrograms(companyId, true);
  }

  // --- Accounts (Part P) ---------------------------------------------------

  /** TASK 13.1 — `client` accepted (and defaults to the pool when `null`)
   * so `RewardsService` can read an account that may have been created
   * moments earlier in the SAME uncommitted transaction (`getOrCreateAccount`
   * below), mirroring `CustomersRepository.customer`'s identical
   * client-or-pool convention. */
  public async accountByCustomerId(
    client: LoyaltyTransaction | null,
    companyId: string,
    customerId: string,
  ): Promise<LoyaltyAccountRow | null> {
    const row = result<AccountDb>(
      await (client ?? this.database.pool).query(
        `select id,company_id,customer_id,status,created_at,updated_at
         from loyalty_accounts where company_id=$1 and customer_id=$2`,
        [companyId, customerId],
      ),
    ).rows[0];
    return row === undefined ? null : account(row);
  }

  /** Lazily creates the account on first touch — Part P: a customer MAY
   * have a loyalty account, never every customer automatically. */
  public async getOrCreateAccount(
    client: LoyaltyTransaction,
    companyId: string,
    customerId: string,
    timestamp: Date,
  ): Promise<LoyaltyAccountRow> {
    const existing = result<AccountDb>(
      await client.query(
        `select id,company_id,customer_id,status,created_at,updated_at
         from loyalty_accounts where company_id=$1 and customer_id=$2`,
        [companyId, customerId],
      ),
    ).rows[0];
    if (existing !== undefined) return account(existing);
    const id = randomUUID();
    await client.query(
      `insert into loyalty_accounts (id,company_id,customer_id,status,created_at,updated_at)
       values ($1,$2,$3,'active',$4,$4)
       on conflict on constraint loyalty_accounts_company_customer_uq do nothing`,
      [id, companyId, customerId, timestamp],
    );
    const row = result<AccountDb>(
      await client.query(
        `select id,company_id,customer_id,status,created_at,updated_at
         from loyalty_accounts where company_id=$1 and customer_id=$2`,
        [companyId, customerId],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Loyalty account creation did not return a row.');
    return account(row);
  }

  // --- Ledger (Part Q) ------------------------------------------------------

  /** `on conflict ... do nothing` on the automatic-earn idempotency index
   * — a retried/replayed sale settlement returns `null`, treated by the
   * caller as "already earned, nothing new to do" (mirrors
   * `MembershipsRepository.insertMembership` exactly). Manual entries
   * (`source_type='manual'`) never collide with this index (their
   * `source_id` is always null, and Postgres treats every null as
   * distinct), so they always succeed. */
  public async insertLedgerEntry(
    client: LoyaltyTransaction,
    input: InsertLedgerEntryInput,
  ): Promise<LoyaltyLedgerEntryRow | null> {
    const inserted = result<{ id: string }>(
      await client.query(
        `insert into loyalty_ledger
         (id,company_id,loyalty_account_id,loyalty_program_id,branch_id,entry_type,quantity,unit_type,
          source_type,source_id,reason,actor_id,occurred_at,created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
         on conflict on constraint loyalty_ledger_company_program_sale_uq do nothing
         returning id`,
        [
          input.id,
          input.companyId,
          input.loyaltyAccountId,
          input.loyaltyProgramId,
          input.branchId,
          input.entryType,
          input.quantity,
          input.unitType,
          input.sourceType,
          input.sourceId,
          input.reason,
          input.actorId,
          input.timestamp,
        ],
      ),
    ).rows[0];
    if (inserted === undefined) return null;
    const row = result<LedgerDb>(
      await client.query(`select ${LEDGER_COLUMNS} from loyalty_ledger where company_id=$1 and id=$2`, [
        input.companyId,
        inserted.id,
      ]),
    ).rows[0];
    if (row === undefined) throw new Error('Loyalty ledger insertion did not return a row.');
    return ledgerEntry(row);
  }

  public async ledgerForAccount(companyId: string, accountId: string, limit: number): Promise<LoyaltyLedgerEntryRow[]> {
    const rows = result<LedgerDb>(
      await this.database.pool.query(
        `select ${LEDGER_COLUMNS} from loyalty_ledger
         where company_id=$1 and loyalty_account_id=$2
         order by occurred_at desc, id desc
         limit $3`,
        [companyId, accountId, limit],
      ),
    ).rows;
    return rows.map(ledgerEntry);
  }

  /** Part Q — the balance is always this `SUM(quantity)`, grouped per
   * program (a null `loyalty_program_id` groups every manual entry not
   * tied to a specific program together). Never a cached counter. */
  public async balances(companyId: string, accountId: string): Promise<LoyaltyBalance[]> {
    const rows = result<{ loyalty_program_id: string | null; unit_type: LoyaltyUnitType; balance: string }>(
      await this.database.pool.query(
        `select loyalty_program_id, unit_type, sum(quantity)::text as balance
         from loyalty_ledger
         where company_id=$1 and loyalty_account_id=$2
         group by loyalty_program_id, unit_type`,
        [companyId, accountId],
      ),
    ).rows;
    return rows.map((row) => ({
      programId: row.loyalty_program_id,
      unitType: row.unit_type,
      balance: Number(row.balance),
    }));
  }

  /** TASK 13.1 (ADR-0018 "Threshold semantics") — the durable input to
   * cycle-crossing math: the CUMULATIVE `entry_type='earn'` sum for one
   * (account, program), deliberately excluding adjustments/redemptions/
   * expirations (Part E: reward issuance leaves the earned-unit balance
   * untouched — a manual credit is not a "qualifying earn"). `client`
   * accepted so this reads the just-inserted earn row within the SAME
   * settlement transaction, never a stale pre-commit snapshot. */
  public async cumulativeEarnedUnits(
    client: LoyaltyTransaction,
    companyId: string,
    loyaltyAccountId: string,
    loyaltyProgramId: string,
  ): Promise<number> {
    const row = result<{ total: string | null }>(
      await client.query(
        `select sum(quantity)::text as total from loyalty_ledger
         where company_id=$1 and loyalty_account_id=$2 and loyalty_program_id=$3 and entry_type='earn'`,
        [companyId, loyaltyAccountId, loyaltyProgramId],
      ),
    ).rows[0];
    return row?.total === null || row?.total === undefined ? 0 : Number(row.total);
  }
}
