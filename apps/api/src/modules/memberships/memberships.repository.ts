import { randomBytes, randomUUID } from 'node:crypto';

import type { DatabaseClient } from '@asone/database';

import {
  MembershipError,
  type CustomerMembershipRow,
  type MembershipMutationContext,
  type MembershipPlanRow,
  type MembershipStatus,
} from './memberships.types.js';

/** Structurally identical to `PromotionTransaction`/`SaleTransaction` — a
 * real `pg` client from `PaymentsService`'s own settlement transaction
 * satisfies this too, so `activateFromSale` below can be handed that
 * client directly with no adapter, matching `SalesService`'s existing
 * cross-module transaction-sharing convention exactly. */
export interface MembershipTransaction {
  query(sql: string, values?: readonly unknown[]): Promise<unknown>;
}

interface QueryResult<T> {
  rows: T[];
}
function result<T>(value: unknown): QueryResult<T> {
  return value as QueryResult<T>;
}
interface IdempotencyDb {
  request_hash: string;
  response_body: unknown;
}
function constraint(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'constraint' in error
    ? String((error as { constraint?: unknown }).constraint)
    : undefined;
}
function jsonValue(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

const PLAN_COLUMNS =
  'mp.id,mp.company_id,mp.name,mp.description,mp.active,mp.product_id,mp.duration_days,mp.benefit_description,' +
  'mp.benefit_type,mp.benefit_percentage_basis_points,mp.benefit_fixed_amount,' +
  'mp.created_by,mp.updated_by,mp.version,mp.created_at,mp.updated_at';
// TASK 16.21 — three independent one-to-many joins aggregated in the
// SAME query, mirroring `PROMOTION_SCOPE_SELECT`/`_JOIN`'s own proven
// shape exactly: `array_agg(distinct ...)` per dimension safely
// de-duplicates the row fan-out each extra join causes, rather than
// requiring three separate round trips.
const PLAN_SCOPE_SELECT = `
  coalesce(array_agg(distinct mpb.branch_id) filter (where mpb.branch_id is not null), '{}') as branch_ids,
  coalesce(array_agg(distinct mpbp.product_id) filter (where mpbp.product_id is not null), '{}') as benefit_product_ids,
  coalesce(array_agg(distinct mpbc.category_id) filter (where mpbc.category_id is not null), '{}') as benefit_category_ids`;
const PLAN_SCOPE_JOIN = `
  left join membership_plan_branches mpb on mpb.company_id=mp.company_id and mpb.membership_plan_id=mp.id
  left join membership_plan_benefit_products mpbp on mpbp.company_id=mp.company_id and mpbp.membership_plan_id=mp.id
  left join membership_plan_benefit_categories mpbc on mpbc.company_id=mp.company_id and mpbc.membership_plan_id=mp.id`;

interface PlanDb {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  active: boolean;
  product_id: string | null;
  duration_days: number | null;
  benefit_description: string | null;
  benefit_type: 'percentage_discount' | 'fixed_amount_discount' | 'fixed_price' | null;
  benefit_percentage_basis_points: number | null;
  benefit_fixed_amount: string | null;
  created_by: string;
  updated_by: string;
  version: string;
  created_at: Date | string;
  updated_at: Date | string;
  branch_ids: string[];
  benefit_product_ids: string[];
  benefit_category_ids: string[];
}
const MEMBERSHIP_COLUMNS =
  'id,company_id,customer_id,membership_plan_id,membership_number,status,starts_at,expires_at,issued_at,' +
  'source_sale_id,renewed_from_membership_id,cancelled_at,cancelled_reason,created_by,version,created_at,updated_at';
interface MembershipDb {
  id: string;
  company_id: string;
  customer_id: string;
  membership_plan_id: string;
  membership_number: string;
  status: MembershipStatus;
  starts_at: Date | string;
  expires_at: Date | string | null;
  issued_at: Date | string;
  source_sale_id: string | null;
  renewed_from_membership_id: string | null;
  cancelled_at: Date | string | null;
  cancelled_reason: string | null;
  created_by: string;
  version: string;
  created_at: Date | string;
  updated_at: Date | string;
}

function plan(row: PlanDb): MembershipPlanRow {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    description: row.description,
    active: row.active,
    productId: row.product_id,
    durationDays: row.duration_days,
    benefitDescription: row.benefit_description,
    benefitType: row.benefit_type,
    benefitPercentageBasisPoints: row.benefit_percentage_basis_points,
    benefitFixedAmount: row.benefit_fixed_amount,
    benefitProductIds: row.benefit_product_ids,
    benefitCategoryIds: row.benefit_category_ids,
    branchIds: row.branch_ids,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    version: BigInt(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
function membership(row: MembershipDb): CustomerMembershipRow {
  return {
    id: row.id,
    companyId: row.company_id,
    customerId: row.customer_id,
    membershipPlanId: row.membership_plan_id,
    membershipNumber: row.membership_number,
    status: row.status,
    startsAt: new Date(row.starts_at),
    expiresAt: row.expires_at === null ? null : new Date(row.expires_at),
    issuedAt: new Date(row.issued_at),
    sourceSaleId: row.source_sale_id,
    renewedFromMembershipId: row.renewed_from_membership_id,
    cancelledAt: row.cancelled_at === null ? null : new Date(row.cancelled_at),
    cancelledReason: row.cancelled_reason,
    createdBy: row.created_by,
    version: BigInt(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export interface InsertPlanInput {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  active: boolean;
  productId: string | null;
  durationDays: number | null;
  benefitDescription: string | null;
  benefitType: 'percentage_discount' | 'fixed_amount_discount' | 'fixed_price' | null;
  benefitPercentageBasisPoints: number | null;
  benefitFixedAmount: string | null;
  benefitProductIds: readonly string[];
  benefitCategoryIds: readonly string[];
  branchIds: readonly string[];
  createdBy: string;
  timestamp: Date;
}
export interface UpdatePlanFields {
  name?: string;
  description?: string | null;
  active?: boolean;
  productId?: string | null;
  durationDays?: number | null;
  benefitDescription?: string | null;
  benefitType?: 'percentage_discount' | 'fixed_amount_discount' | 'fixed_price' | null;
  benefitPercentageBasisPoints?: number | null;
  benefitFixedAmount?: string | null;
  benefitProductIds?: readonly string[];
  benefitCategoryIds?: readonly string[];
  branchIds?: readonly string[];
  updatedBy: string;
  timestamp: Date;
}
export interface InsertMembershipInput {
  id: string;
  companyId: string;
  customerId: string;
  membershipPlanId: string;
  membershipNumber: string;
  status: MembershipStatus;
  startsAt: Date;
  expiresAt: Date | null;
  issuedAt: Date;
  sourceSaleId: string | null;
  renewedFromMembershipId: string | null;
  createdBy: string;
  timestamp: Date;
}

export class MembershipsRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async transaction<T>(callback: (client: MembershipTransaction) => Promise<T>): Promise<T> {
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
    client: MembershipTransaction,
    context: MembershipMutationContext,
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
        throw new MembershipError('validation_error', 'The idempotency key was used with another request.');
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
    client: MembershipTransaction,
    context: MembershipMutationContext,
    input: {
      action: string;
      resourceType: 'membership_plan' | 'customer_membership';
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

  // --- Membership plans --------------------------------------------------

  public async insertPlan(client: MembershipTransaction, input: InsertPlanInput): Promise<MembershipPlanRow> {
    await client.query(
      `insert into membership_plans
       (id,company_id,name,description,active,product_id,duration_days,benefit_description,
        benefit_type,benefit_percentage_basis_points,benefit_fixed_amount,
        created_by,updated_by,created_at,updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13,$13)`,
      [
        input.id,
        input.companyId,
        input.name,
        input.description,
        input.active,
        input.productId,
        input.durationDays,
        input.benefitDescription,
        input.benefitType,
        input.benefitPercentageBasisPoints,
        input.benefitFixedAmount,
        input.createdBy,
        input.timestamp,
      ],
    );
    await this.replaceBranchScope(client, input.companyId, input.id, input.branchIds);
    await this.replaceBenefitScope(client, input.companyId, input.id, input.benefitProductIds, input.benefitCategoryIds);
    const created = await this.plan(client, input.companyId, input.id);
    if (created === null) throw new Error('Membership plan insertion did not return a row.');
    return created;
  }

  public async updatePlan(
    client: MembershipTransaction,
    companyId: string,
    id: string,
    expectedVersion: bigint,
    fields: UpdatePlanFields,
  ): Promise<MembershipPlanRow> {
    const assignments: string[] = [];
    const values: unknown[] = [];
    let index = 1;
    const set = (column: string, value: unknown): void => {
      assignments.push(`${column}=$${String(index)}`);
      values.push(value);
      index += 1;
    };
    if (fields.name !== undefined) set('name', fields.name);
    if (fields.description !== undefined) set('description', fields.description);
    if (fields.active !== undefined) set('active', fields.active);
    if (fields.productId !== undefined) set('product_id', fields.productId);
    if (fields.durationDays !== undefined) set('duration_days', fields.durationDays);
    if (fields.benefitDescription !== undefined) set('benefit_description', fields.benefitDescription);
    if (fields.benefitType !== undefined) set('benefit_type', fields.benefitType);
    if (fields.benefitPercentageBasisPoints !== undefined)
      set('benefit_percentage_basis_points', fields.benefitPercentageBasisPoints);
    if (fields.benefitFixedAmount !== undefined) set('benefit_fixed_amount', fields.benefitFixedAmount);
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
        `update membership_plans set ${assignments.join(',')}
         where company_id=$${String(companyParam)} and id=$${String(idParam)} and version=$${String(versionParam)}
         returning id`,
        values,
      ),
    ).rows[0];
    if (updated === undefined) {
      const current = await this.plan(client, companyId, id);
      if (current === null) throw new MembershipError('resource_not_found', 'The membership plan was not found.');
      throw new MembershipError('version_conflict', 'The membership plan was modified by another request.');
    }
    if (fields.branchIds !== undefined) await this.replaceBranchScope(client, companyId, id, fields.branchIds);
    // TASK 16.21 (Part 18 "historical snapshot safety") — scope is only
    // ever touched when the caller supplied AT LEAST ONE of the two
    // arrays; `undefined` for both means "leave the existing scope
    // alone" — mirrors `LoyaltyService.updateProgram`'s own identical
    // "explicit choice, never inferred from omission" convention.
    if (fields.benefitProductIds !== undefined || fields.benefitCategoryIds !== undefined)
      await this.replaceBenefitScope(
        client,
        companyId,
        id,
        fields.benefitProductIds ?? [],
        fields.benefitCategoryIds ?? [],
      );
    const row = await this.plan(client, companyId, id);
    if (row === null) throw new Error('Membership plan update did not return a row.');
    return row;
  }

  private async replaceBenefitScope(
    client: MembershipTransaction,
    companyId: string,
    planId: string,
    productIds: readonly string[],
    categoryIds: readonly string[],
  ): Promise<void> {
    await client.query('delete from membership_plan_benefit_products where company_id=$1 and membership_plan_id=$2', [
      companyId,
      planId,
    ]);
    for (const productId of productIds) {
      await client.query(
        `insert into membership_plan_benefit_products (id,company_id,membership_plan_id,product_id,created_at)
         values ($1,$2,$3,$4,now())`,
        [randomUUID(), companyId, planId, productId],
      );
    }
    await client.query('delete from membership_plan_benefit_categories where company_id=$1 and membership_plan_id=$2', [
      companyId,
      planId,
    ]);
    for (const categoryId of categoryIds) {
      await client.query(
        `insert into membership_plan_benefit_categories (id,company_id,membership_plan_id,category_id,created_at)
         values ($1,$2,$3,$4,now())`,
        [randomUUID(), companyId, planId, categoryId],
      );
    }
  }

  private async replaceBranchScope(
    client: MembershipTransaction,
    companyId: string,
    planId: string,
    branchIds: readonly string[],
  ): Promise<void> {
    await client.query('delete from membership_plan_branches where company_id=$1 and membership_plan_id=$2', [
      companyId,
      planId,
    ]);
    for (const branchId of branchIds) {
      await client.query(
        `insert into membership_plan_branches (id,company_id,membership_plan_id,branch_id,created_at)
         values ($1,$2,$3,$4,now())`,
        [randomUUID(), companyId, planId, branchId],
      );
    }
  }

  public async plan(
    client: MembershipTransaction | null,
    companyId: string,
    id: string,
  ): Promise<MembershipPlanRow | null> {
    const row = result<PlanDb>(
      await (client ?? this.database.pool).query(
        `select ${PLAN_COLUMNS}, ${PLAN_SCOPE_SELECT}
         from membership_plans mp ${PLAN_SCOPE_JOIN}
         where mp.company_id=$1 and mp.id=$2
         group by mp.id`,
        [companyId, id],
      ),
    ).rows[0];
    return row === undefined ? null : plan(row);
  }

  public async planByProductId(companyId: string, productId: string): Promise<MembershipPlanRow | null> {
    const row = result<PlanDb>(
      await this.database.pool.query(
        `select ${PLAN_COLUMNS}, ${PLAN_SCOPE_SELECT}
         from membership_plans mp ${PLAN_SCOPE_JOIN}
         where mp.company_id=$1 and mp.product_id=$2
         group by mp.id`,
        [companyId, productId],
      ),
    ).rows[0];
    return row === undefined ? null : plan(row);
  }

  public async listPlans(companyId: string, active: boolean | null): Promise<MembershipPlanRow[]> {
    const conditions = ['mp.company_id=$1'];
    const values: unknown[] = [companyId];
    if (active !== null) {
      conditions.push('mp.active=$2');
      values.push(active);
    }
    const rows = result<PlanDb>(
      await this.database.pool.query(
        `select ${PLAN_COLUMNS}, ${PLAN_SCOPE_SELECT}
         from membership_plans mp ${PLAN_SCOPE_JOIN}
         where ${conditions.join(' and ')}
         group by mp.id
         order by mp.created_at desc`,
        values,
      ),
    ).rows;
    return rows.map(plan);
  }

  // --- Customer memberships -----------------------------------------------

  public async insertMembership(
    client: MembershipTransaction,
    input: InsertMembershipInput,
  ): Promise<CustomerMembershipRow | null> {
    const inserted = result<{ id: string }>(
      await client.query(
        `insert into customer_memberships
         (id,company_id,customer_id,membership_plan_id,membership_number,status,starts_at,expires_at,issued_at,
          source_sale_id,renewed_from_membership_id,created_by,created_at,updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
         on conflict on constraint customer_memberships_company_sale_plan_uq do nothing
         returning id`,
        [
          input.id,
          input.companyId,
          input.customerId,
          input.membershipPlanId,
          input.membershipNumber,
          input.status,
          input.startsAt,
          input.expiresAt,
          input.issuedAt,
          input.sourceSaleId,
          input.renewedFromMembershipId,
          input.createdBy,
          input.timestamp,
        ],
      ),
    ).rows[0];
    // `on conflict ... do nothing` — a retried/replayed sale settlement
    // returns no row here (see ADR-0017 "Membership purchase idempotency");
    // the caller treats `null` as "already issued, nothing new to do".
    if (inserted === undefined) return null;
    return this.membership(client, input.companyId, inserted.id);
  }

  public async membership(
    client: MembershipTransaction | null,
    companyId: string,
    id: string,
  ): Promise<CustomerMembershipRow | null> {
    const row = result<MembershipDb>(
      await (client ?? this.database.pool).query(
        `select ${MEMBERSHIP_COLUMNS} from customer_memberships where company_id=$1 and id=$2`,
        [companyId, id],
      ),
    ).rows[0];
    return row === undefined ? null : membership(row);
  }

  public async membershipsForCustomer(companyId: string, customerId: string): Promise<CustomerMembershipRow[]> {
    const rows = result<MembershipDb>(
      await this.database.pool.query(
        `select ${MEMBERSHIP_COLUMNS} from customer_memberships
         where company_id=$1 and customer_id=$2 order by issued_at desc`,
        [companyId, customerId],
      ),
    ).rows;
    return rows.map(membership);
  }

  public async lockMembership(
    client: MembershipTransaction,
    companyId: string,
    id: string,
  ): Promise<CustomerMembershipRow | null> {
    const locked = result<{ id: string }>(
      await client.query(`select id from customer_memberships where company_id=$1 and id=$2 for update`, [
        companyId,
        id,
      ]),
    ).rows[0];
    if (locked === undefined) return null;
    return this.membership(client, companyId, id);
  }

  public async updateMembershipStatus(
    client: MembershipTransaction,
    companyId: string,
    id: string,
    expectedVersion: bigint,
    fields: { status: MembershipStatus; cancelledAt: Date | null; cancelledReason: string | null; timestamp: Date },
  ): Promise<CustomerMembershipRow> {
    const updated = result<{ id: string }>(
      await client.query(
        `update customer_memberships
         set status=$1, cancelled_at=$2, cancelled_reason=$3, updated_at=$4, version=$5
         where company_id=$6 and id=$7 and version=$8
         returning id`,
        [
          fields.status,
          fields.cancelledAt,
          fields.cancelledReason,
          fields.timestamp,
          (expectedVersion + 1n).toString(),
          companyId,
          id,
          expectedVersion.toString(),
        ],
      ),
    ).rows[0];
    if (updated === undefined) throw new MembershipError('version_conflict', 'The membership was modified by another request.');
    const row = await this.membership(client, companyId, id);
    if (row === null) throw new Error('Membership status update did not return a row.');
    return row;
  }

  public generateMembershipNumber(): string {
    return `MEM-${randomBytes(5).toString('hex').toUpperCase()}`;
  }

  private mapDatabaseError(error: unknown): unknown {
    switch (constraint(error)) {
      case 'customer_memberships_company_number_uq':
        return new MembershipError('resource_conflict', 'This membership number is already in use.');
      case 'membership_plans_company_product_uq':
        return new MembershipError('resource_conflict', 'This product already backs another membership plan.');
      default:
        return error;
    }
  }
}
