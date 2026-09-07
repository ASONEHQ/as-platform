import { randomUUID } from 'node:crypto';

import type { DatabaseClient } from '@asone/database';

import {
  PromotionError,
  type CouponBenefitType,
  type CouponRow,
  type PromotionBenefitType,
  type PromotionMutationContext,
  type PromotionRow,
} from './promotions.types.js';

/** Structurally identical to `RefundTransaction`/`SaleTransaction` on
 * purpose — see ADR-0013's original rationale, reused verbatim across
 * every module that has followed since (TASK 12.9 is no exception: a
 * real `pg` client passed from `sales.service.ts`'s own transaction
 * satisfies this too, letting `SalesService.createSale` hand its
 * transaction client straight to this repository for redemption/
 * discount-row writes without an adapter). */
export interface PromotionTransaction {
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

const PROMOTION_COLUMNS =
  'p.id,p.company_id,p.name,p.description,p.active,p.starts_at,p.ends_at,p.days_of_week,p.time_from,p.time_to,' +
  'p.priority,p.stackable,p.benefit_type,p.benefit_percentage_basis_points,p.benefit_fixed_amount,' +
  'p.benefit_nxm_buy_quantity,p.benefit_nxm_pay_quantity,p.min_quantity,p.min_subtotal,p.usage_limit_total,' +
  'p.combinable_with_coupons,p.created_by,p.updated_by,p.version,p.created_at,p.updated_at';
const PROMOTION_SCOPE_SELECT = `
  coalesce(array_agg(distinct pb.branch_id) filter (where pb.branch_id is not null), '{}') as branch_ids,
  coalesce(array_agg(distinct pp.product_id) filter (where pp.product_id is not null), '{}') as product_ids,
  coalesce(array_agg(distinct pc.category_id) filter (where pc.category_id is not null), '{}') as category_ids`;
const PROMOTION_SCOPE_JOIN = `
  left join promotion_branches pb on pb.company_id=p.company_id and pb.promotion_id=p.id
  left join promotion_products pp on pp.company_id=p.company_id and pp.promotion_id=p.id
  left join promotion_categories pc on pc.company_id=p.company_id and pc.promotion_id=p.id`;

const COUPON_COLUMNS =
  'id,company_id,code,normalized_code,description,benefit_type,benefit_percentage_basis_points,benefit_fixed_amount,' +
  'active,starts_at,ends_at,min_subtotal,usage_limit_total,promotion_id,created_by,updated_by,version,created_at,updated_at';

interface PromotionDb {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  active: boolean;
  starts_at: Date | string | null;
  ends_at: Date | string | null;
  days_of_week: number[] | null;
  time_from: string | null;
  time_to: string | null;
  priority: number;
  stackable: boolean;
  benefit_type: PromotionBenefitType;
  benefit_percentage_basis_points: number | null;
  benefit_fixed_amount: string | null;
  benefit_nxm_buy_quantity: number | null;
  benefit_nxm_pay_quantity: number | null;
  min_quantity: string | null;
  min_subtotal: string | null;
  usage_limit_total: number | null;
  combinable_with_coupons: boolean;
  created_by: string;
  updated_by: string;
  version: string;
  created_at: Date | string;
  updated_at: Date | string;
  branch_ids: string[];
  product_ids: string[];
  category_ids: string[];
}
interface CouponDb {
  id: string;
  company_id: string;
  code: string;
  normalized_code: string;
  description: string | null;
  benefit_type: CouponBenefitType;
  benefit_percentage_basis_points: number | null;
  benefit_fixed_amount: string | null;
  active: boolean;
  starts_at: Date | string | null;
  ends_at: Date | string | null;
  min_subtotal: string | null;
  usage_limit_total: number | null;
  promotion_id: string | null;
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

function promotion(row: PromotionDb): PromotionRow {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    description: row.description,
    active: row.active,
    startsAt: row.starts_at === null ? null : new Date(row.starts_at),
    endsAt: row.ends_at === null ? null : new Date(row.ends_at),
    daysOfWeek: row.days_of_week,
    timeFrom: row.time_from,
    timeTo: row.time_to,
    priority: row.priority,
    stackable: row.stackable,
    benefitType: row.benefit_type,
    benefitPercentageBasisPoints: row.benefit_percentage_basis_points,
    benefitFixedAmount: row.benefit_fixed_amount,
    benefitNxmBuyQuantity: row.benefit_nxm_buy_quantity,
    benefitNxmPayQuantity: row.benefit_nxm_pay_quantity,
    minQuantity: row.min_quantity,
    minSubtotal: row.min_subtotal,
    usageLimitTotal: row.usage_limit_total,
    combinableWithCoupons: row.combinable_with_coupons,
    branchIds: row.branch_ids,
    productIds: row.product_ids,
    categoryIds: row.category_ids,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    version: BigInt(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
function coupon(row: CouponDb): CouponRow {
  return {
    id: row.id,
    companyId: row.company_id,
    code: row.code,
    normalizedCode: row.normalized_code,
    description: row.description,
    benefitType: row.benefit_type,
    benefitPercentageBasisPoints: row.benefit_percentage_basis_points,
    benefitFixedAmount: row.benefit_fixed_amount,
    active: row.active,
    startsAt: row.starts_at === null ? null : new Date(row.starts_at),
    endsAt: row.ends_at === null ? null : new Date(row.ends_at),
    minSubtotal: row.min_subtotal,
    usageLimitTotal: row.usage_limit_total,
    promotionId: row.promotion_id,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    version: BigInt(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
export interface ResolvedPricingProduct {
  productId: string;
  categoryId: string | null;
  variantId: string | null;
  productVersion: bigint;
  name: string;
  skuSnapshot: string | null;
  taxCode: string;
  status: string;
  price: { amount: string; currencyCode: string } | null;
}

export interface CreatePromotionInput {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  active: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  daysOfWeek: readonly number[] | null;
  timeFrom: string | null;
  timeTo: string | null;
  priority: number;
  stackable: boolean;
  benefitType: PromotionBenefitType;
  benefitPercentageBasisPoints: number | null;
  benefitFixedAmount: string | null;
  benefitNxmBuyQuantity: number | null;
  benefitNxmPayQuantity: number | null;
  minQuantity: string | null;
  minSubtotal: string | null;
  usageLimitTotal: number | null;
  combinableWithCoupons: boolean;
  branchIds: readonly string[];
  productIds: readonly string[];
  categoryIds: readonly string[];
  createdBy: string;
  timestamp: Date;
}

export class PromotionsRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async transaction<T>(callback: (client: PromotionTransaction) => Promise<T>): Promise<T> {
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
    client: PromotionTransaction,
    context: PromotionMutationContext,
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
        throw new PromotionError('validation_error', 'The idempotency key was used with another request.');
      return { value: decode(existing.response_body), replayed: true };
    }
    const id = randomUUID();
    await client.query(
      `insert into idempotency_keys
       (id,company_id,key,operation,request_hash,expires_at,created_at)
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
    client: PromotionTransaction,
    context: PromotionMutationContext,
    input: {
      action: string;
      resourceType: 'promotion' | 'coupon';
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
    // Company-wide, not branch-scoped — `promotions`/`coupons` have no
    // `branch_id` column of their own (they may span several branches or
    // none in particular), so `outbox_events.branch_id` stays null here,
    // matching every other company-wide (never branch-owned) resource
    // this codebase already publishes outbox events for.
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

  // --- Promotions ----------------------------------------------------------

  public async insertPromotion(client: PromotionTransaction, input: CreatePromotionInput): Promise<PromotionRow> {
    await client.query(
      `insert into promotions
       (id,company_id,name,description,active,starts_at,ends_at,days_of_week,time_from,time_to,priority,stackable,
        benefit_type,benefit_percentage_basis_points,benefit_fixed_amount,benefit_nxm_buy_quantity,
        benefit_nxm_pay_quantity,min_quantity,min_subtotal,usage_limit_total,combinable_with_coupons,
        created_by,updated_by,created_at,updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$22,$23,$23)`,
      [
        input.id,
        input.companyId,
        input.name,
        input.description,
        input.active,
        input.startsAt,
        input.endsAt,
        input.daysOfWeek === null ? null : [...input.daysOfWeek],
        input.timeFrom,
        input.timeTo,
        input.priority,
        input.stackable,
        input.benefitType,
        input.benefitPercentageBasisPoints,
        input.benefitFixedAmount,
        input.benefitNxmBuyQuantity,
        input.benefitNxmPayQuantity,
        input.minQuantity,
        input.minSubtotal,
        input.usageLimitTotal,
        input.combinableWithCoupons,
        input.createdBy,
        input.timestamp,
      ],
    );
    await this.setPromotionScopes(client, input.companyId, input.id, {
      branchIds: input.branchIds,
      productIds: input.productIds,
      categoryIds: input.categoryIds,
    });
    // Read back on the SAME transaction client, never `this.database.pool`
    // — the insert above is still uncommitted, so a separate pool
    // connection cannot see it yet (read-committed isolation). A real
    // bug found and fixed while writing this method's own integration
    // test — see ADR-0016.
    const created = await this.promotion(input.companyId, input.id, client);
    if (created === null) throw new Error('Promotion insertion did not return a row.');
    return created;
  }

  private async setPromotionScopes(
    client: PromotionTransaction,
    companyId: string,
    promotionId: string,
    scopes: { branchIds: readonly string[]; productIds: readonly string[]; categoryIds: readonly string[] },
  ): Promise<void> {
    await client.query(`delete from promotion_branches where company_id=$1 and promotion_id=$2`, [
      companyId,
      promotionId,
    ]);
    await client.query(`delete from promotion_products where company_id=$1 and promotion_id=$2`, [
      companyId,
      promotionId,
    ]);
    await client.query(`delete from promotion_categories where company_id=$1 and promotion_id=$2`, [
      companyId,
      promotionId,
    ]);
    // Sequential, never `Promise.all` — every one of these shares the
    // same transaction `client` (see `refunds.service.ts`'s identical
    // precedent for why `pg` cannot run two concurrent queries on one
    // connection).
    for (const branchId of scopes.branchIds) {
      await client.query(
        `insert into promotion_branches (id,company_id,promotion_id,branch_id) values ($1,$2,$3,$4)`,
        [randomUUID(), companyId, promotionId, branchId],
      );
    }
    for (const productId of scopes.productIds) {
      await client.query(
        `insert into promotion_products (id,company_id,promotion_id,product_id) values ($1,$2,$3,$4)`,
        [randomUUID(), companyId, promotionId, productId],
      );
    }
    for (const categoryId of scopes.categoryIds) {
      await client.query(
        `insert into promotion_categories (id,company_id,promotion_id,category_id) values ($1,$2,$3,$4)`,
        [randomUUID(), companyId, promotionId, categoryId],
      );
    }
  }

  public async updatePromotion(
    client: PromotionTransaction,
    companyId: string,
    id: string,
    expectedVersion: bigint,
    input: Partial<Omit<CreatePromotionInput, 'id' | 'companyId' | 'createdBy' | 'timestamp'>> & {
      updatedBy: string;
      timestamp: Date;
    },
  ): Promise<PromotionRow> {
    const current = await this.lockPromotion(client, companyId, id);
    if (current === null) throw new PromotionError('resource_not_found', 'The promotion was not found.');
    if (current.version !== expectedVersion)
      throw new PromotionError('version_conflict', 'The promotion was modified by another request.');
    const next = { ...current, ...input };
    await client.query(
      `update promotions set
        name=$1, description=$2, active=$3, starts_at=$4, ends_at=$5, days_of_week=$6, time_from=$7, time_to=$8,
        priority=$9, stackable=$10, benefit_type=$11, benefit_percentage_basis_points=$12, benefit_fixed_amount=$13,
        benefit_nxm_buy_quantity=$14, benefit_nxm_pay_quantity=$15, min_quantity=$16, min_subtotal=$17,
        usage_limit_total=$18, combinable_with_coupons=$19, updated_by=$20, version=version+1, updated_at=$21
       where company_id=$22 and id=$23`,
      [
        next.name,
        next.description,
        next.active,
        next.startsAt,
        next.endsAt,
        next.daysOfWeek === null ? null : [...next.daysOfWeek],
        next.timeFrom,
        next.timeTo,
        next.priority,
        next.stackable,
        next.benefitType,
        next.benefitPercentageBasisPoints,
        next.benefitFixedAmount,
        next.benefitNxmBuyQuantity,
        next.benefitNxmPayQuantity,
        next.minQuantity,
        next.minSubtotal,
        next.usageLimitTotal,
        next.combinableWithCoupons,
        input.updatedBy,
        input.timestamp,
        companyId,
        id,
      ],
    );
    if (input.branchIds !== undefined || input.productIds !== undefined || input.categoryIds !== undefined) {
      await this.setPromotionScopes(client, companyId, id, {
        branchIds: input.branchIds ?? current.branchIds,
        productIds: input.productIds ?? current.productIds,
        categoryIds: input.categoryIds ?? current.categoryIds,
      });
    }
    const updated = await this.promotion(companyId, id, client);
    if (updated === null) throw new Error('Promotion update did not return a row.');
    return updated;
  }

  public async lockPromotion(
    client: PromotionTransaction,
    companyId: string,
    id: string,
  ): Promise<PromotionRow | null> {
    // `for update` cannot combine with the scope-aggregating `group by`
    // in one statement (PostgreSQL rejects it outright) — lock the bare
    // `promotions` row first, then read the full shape (with scopes)
    // through this same transaction client, which already holds the
    // lock by the time that second read runs.
    const locked = result<{ id: string }>(
      await client.query(`select id from promotions where company_id=$1 and id=$2 for update`, [companyId, id]),
    ).rows[0];
    if (locked === undefined) return null;
    return this.promotion(companyId, id, client);
  }

  public async promotion(
    companyId: string,
    id: string,
    client?: PromotionTransaction,
  ): Promise<PromotionRow | null> {
    const queryable = client ?? this.database.pool;
    const row = result<PromotionDb>(
      await queryable.query(
        `select ${PROMOTION_COLUMNS}, ${PROMOTION_SCOPE_SELECT}
         from promotions p ${PROMOTION_SCOPE_JOIN}
         where p.company_id=$1 and p.id=$2
         group by p.id`,
        [companyId, id],
      ),
    ).rows[0];
    return row === undefined ? null : promotion(row);
  }

  /** Every promotion whose OWN `active` flag is true AND — in the same
   * query, never N+1 — whose `usage_limit_total` (when set) has not yet
   * been reached, counting its own completed `sale_discounts` rows.
   * Schedule/branch/product/category eligibility is evaluated by
   * `pricing.service.ts` from the returned rows, never re-filtered here
   * (this is a plain read; the pure engine is the one place that
   * eligibility logic lives — see ADR-0016). This read is intentionally
   * NOT row-locked even when called from inside a real sale-creation
   * transaction — see ADR-0016 "Coupon concurrency" for why a
   * promotion's own usage limit (unlike a coupon's) does not get the
   * same strict locked-redemption treatment. */
  public async activePromotions(companyId: string, client?: PromotionTransaction): Promise<PromotionRow[]> {
    const queryable = client ?? this.database.pool;
    const rows = result<PromotionDb>(
      await queryable.query(
        `select ${PROMOTION_COLUMNS}, ${PROMOTION_SCOPE_SELECT}
         from promotions p ${PROMOTION_SCOPE_JOIN}
         left join lateral (
           select count(*)::int as usage_count from sale_discounts sd
           where sd.company_id=p.company_id and sd.source_type='promotion' and sd.source_id=p.id
         ) usage on true
         where p.company_id=$1 and p.active=true
           and (p.usage_limit_total is null or usage.usage_count < p.usage_limit_total)
         group by p.id, usage.usage_count`,
        [companyId],
      ),
    ).rows;
    return rows.map(promotion);
  }

  public async listPromotions(
    companyId: string,
    input: { cursor?: string; limit: number; active?: boolean },
  ): Promise<{ items: PromotionRow[]; nextCursor: string | null }> {
    const where = ['p.company_id=$1'];
    const values: unknown[] = [companyId];
    if (input.active !== undefined) {
      values.push(input.active);
      where.push(`p.active=$${String(values.length)}`);
    }
    if (input.cursor !== undefined) {
      const decoded = decodePromotionCursor(input.cursor);
      values.push(decoded.createdAt, decoded.id);
      where.push(`(p.created_at,p.id)<($${String(values.length - 1)},$${String(values.length)})`);
    }
    values.push(input.limit + 1);
    const rows = result<PromotionDb>(
      await this.database.pool.query(
        `select ${PROMOTION_COLUMNS}, ${PROMOTION_SCOPE_SELECT}
         from promotions p ${PROMOTION_SCOPE_JOIN}
         where ${where.join(' and ')}
         group by p.id
         order by p.created_at desc, p.id desc limit $${String(values.length)}`,
        values,
      ),
    ).rows;
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit).map(promotion);
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last !== undefined ? encodePromotionCursor(last.createdAt, last.id) : null,
    };
  }

  /** Locked count of this promotion's own completed usage — every
   * `sale_discounts` row with `source_type='promotion'` and
   * `source_id=promotionId` that actually persisted (i.e. a real,
   * committed Sale). Locking the promotion row itself (`lockPromotion`,
   * called by the caller BEFORE this) is what makes a concurrent
   * re-check of `usage_limit_total` safe — mirrors
   * `RefundsRepository.refundedQuantitiesForSaleItems`'s identical
   * locked-parent-then-count pattern. */
  public async promotionUsageCount(
    client: PromotionTransaction,
    companyId: string,
    promotionId: string,
  ): Promise<number> {
    const row = result<{ count: string }>(
      await client.query(
        `select count(*)::text as count from sale_discounts
         where company_id=$1 and source_type='promotion' and source_id=$2`,
        [companyId, promotionId],
      ),
    ).rows[0];
    return row === undefined ? 0 : Number(row.count);
  }

  // --- Coupons ---------------------------------------------------------------

  public async insertCoupon(
    client: PromotionTransaction,
    input: {
      id: string;
      companyId: string;
      code: string;
      normalizedCode: string;
      description: string | null;
      benefitType: CouponBenefitType;
      benefitPercentageBasisPoints: number | null;
      benefitFixedAmount: string | null;
      active: boolean;
      startsAt: Date | null;
      endsAt: Date | null;
      minSubtotal: string | null;
      usageLimitTotal: number | null;
      promotionId: string | null;
      createdBy: string;
      timestamp: Date;
    },
  ): Promise<CouponRow> {
    const row = result<CouponDb>(
      await client.query(
        `insert into coupons
         (id,company_id,code,normalized_code,description,benefit_type,benefit_percentage_basis_points,
          benefit_fixed_amount,active,starts_at,ends_at,min_subtotal,usage_limit_total,promotion_id,
          created_by,updated_by,created_at,updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15,$16,$16)
         returning ${COUPON_COLUMNS}`,
        [
          input.id,
          input.companyId,
          input.code,
          input.normalizedCode,
          input.description,
          input.benefitType,
          input.benefitPercentageBasisPoints,
          input.benefitFixedAmount,
          input.active,
          input.startsAt,
          input.endsAt,
          input.minSubtotal,
          input.usageLimitTotal,
          input.promotionId,
          input.createdBy,
          input.timestamp,
        ],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Coupon insertion did not return a row.');
    return coupon(row);
  }

  public async updateCoupon(
    client: PromotionTransaction,
    companyId: string,
    id: string,
    expectedVersion: bigint,
    input: {
      description?: string | null;
      active?: boolean;
      startsAt?: Date | null;
      endsAt?: Date | null;
      minSubtotal?: string | null;
      usageLimitTotal?: number | null;
      updatedBy: string;
      timestamp: Date;
    },
  ): Promise<CouponRow> {
    const current = await this.lockCoupon(client, companyId, id);
    if (current === null) throw new PromotionError('resource_not_found', 'The coupon was not found.');
    if (current.version !== expectedVersion)
      throw new PromotionError('version_conflict', 'The coupon was modified by another request.');
    const row = result<CouponDb>(
      await client.query(
        `update coupons set
          description=coalesce($1,description), active=coalesce($2,active), starts_at=$3, ends_at=$4,
          min_subtotal=$5, usage_limit_total=$6, updated_by=$7, version=version+1, updated_at=$8
         where company_id=$9 and id=$10
         returning ${COUPON_COLUMNS}`,
        [
          input.description === undefined ? null : input.description,
          input.active ?? null,
          input.startsAt === undefined ? current.startsAt : input.startsAt,
          input.endsAt === undefined ? current.endsAt : input.endsAt,
          input.minSubtotal === undefined ? current.minSubtotal : input.minSubtotal,
          input.usageLimitTotal === undefined ? current.usageLimitTotal : input.usageLimitTotal,
          input.updatedBy,
          input.timestamp,
          companyId,
          id,
        ],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Coupon update did not return a row.');
    return coupon(row);
  }

  public async lockCoupon(client: PromotionTransaction, companyId: string, id: string): Promise<CouponRow | null> {
    const row = result<CouponDb>(
      await client.query(`select ${COUPON_COLUMNS} from coupons where company_id=$1 and id=$2 for update`, [
        companyId,
        id,
      ]),
    ).rows[0];
    return row === undefined ? null : coupon(row);
  }

  public async coupon(companyId: string, id: string): Promise<CouponRow | null> {
    const row = result<CouponDb>(
      await this.database.pool.query(`select ${COUPON_COLUMNS} from coupons where company_id=$1 and id=$2`, [
        companyId,
        id,
      ]),
    ).rows[0];
    return row === undefined ? null : coupon(row);
  }

  /** Unlocked lookup by normalized code — used for E-PRICING-1's own
   * quote/preview, which is explicitly allowed to be stale (Part B
   * "never trust a stale quote blindly" — the REAL redemption path
   * always re-validates under lock, see `lockCouponByCode`). */
  public async couponByNormalizedCode(companyId: string, normalizedCode: string): Promise<CouponRow | null> {
    const row = result<CouponDb>(
      await this.database.pool.query(
        `select ${COUPON_COLUMNS} from coupons where company_id=$1 and normalized_code=$2`,
        [companyId, normalizedCode],
      ),
    ).rows[0];
    return row === undefined ? null : coupon(row);
  }

  /** The concurrency-authoritative lookup — locks the coupon row itself
   * (`for update`) inside the caller's own mutation transaction, so a
   * concurrent redemption of the SAME coupon serializes here rather than
   * racing (Part J: "a coupon with 1 remaining redemption cannot be
   * consumed twice"). */
  public async lockCouponByNormalizedCode(
    client: PromotionTransaction,
    companyId: string,
    normalizedCode: string,
  ): Promise<CouponRow | null> {
    const row = result<CouponDb>(
      await client.query(
        `select ${COUPON_COLUMNS} from coupons where company_id=$1 and normalized_code=$2 for update`,
        [companyId, normalizedCode],
      ),
    ).rows[0];
    return row === undefined ? null : coupon(row);
  }

  public async listCoupons(
    companyId: string,
    input: { cursor?: string; limit: number; active?: boolean },
  ): Promise<{ items: CouponRow[]; nextCursor: string | null }> {
    const where = ['company_id=$1'];
    const values: unknown[] = [companyId];
    if (input.active !== undefined) {
      values.push(input.active);
      where.push(`active=$${String(values.length)}`);
    }
    if (input.cursor !== undefined) {
      const decoded = decodePromotionCursor(input.cursor);
      values.push(decoded.createdAt, decoded.id);
      where.push(`(created_at,id)<($${String(values.length - 1)},$${String(values.length)})`);
    }
    values.push(input.limit + 1);
    const rows = result<CouponDb>(
      await this.database.pool.query(
        `select ${COUPON_COLUMNS} from coupons where ${where.join(' and ')}
         order by created_at desc, id desc limit $${String(values.length)}`,
        values,
      ),
    ).rows;
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit).map(coupon);
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last !== undefined ? encodePromotionCursor(last.createdAt, last.id) : null,
    };
  }

  /** Locked count of a coupon's own completed redemptions — the caller
   * must already hold `lockCouponByNormalizedCode`'s row lock before
   * calling this for the count to mean anything under concurrency. */
  public async couponRedemptionCount(
    client: PromotionTransaction,
    companyId: string,
    couponId: string,
  ): Promise<number> {
    const row = result<{ count: string }>(
      await client.query(`select count(*)::text as count from coupon_redemptions where company_id=$1 and coupon_id=$2`, [
        companyId,
        couponId,
      ]),
    ).rows[0];
    return row === undefined ? 0 : Number(row.count);
  }

  public async insertCouponRedemption(
    client: PromotionTransaction,
    input: { companyId: string; branchId: string; couponId: string; saleId: string; amount: string; timestamp: Date },
  ): Promise<void> {
    await client.query(
      `insert into coupon_redemptions (id,company_id,branch_id,coupon_id,sale_id,amount,redeemed_at)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [randomUUID(), input.companyId, input.branchId, input.couponId, input.saleId, input.amount, input.timestamp],
    );
  }

  /** Released when the sale that reserved it is cancelled before
   * completion (Part J — "a failed/abandoned payment must not
   * permanently consume a coupon"), called from `SalesService.cancelSale`
   * inside that same existing cancellation transaction. A no-op (0 rows
   * affected) when the sale never redeemed a coupon at all. */
  public async deleteCouponRedemptionsForSale(
    client: PromotionTransaction,
    companyId: string,
    saleId: string,
  ): Promise<void> {
    await client.query(`delete from coupon_redemptions where company_id=$1 and sale_id=$2`, [companyId, saleId]);
  }

  // --- Sale discounts (the immutable applied-discount audit trail) ---------

  public async insertSaleDiscounts(
    client: PromotionTransaction,
    rows: readonly {
      companyId: string;
      branchId: string;
      saleId: string;
      saleItemId: string | null;
      sourceType: 'promotion' | 'coupon' | 'manual' | 'reward';
      sourceId: string | null;
      labelSnapshot: string;
      reasonCode: string | null;
      amount: string;
      basisPoints: number | null;
      createdBy: string;
      timestamp: Date;
    }[],
  ): Promise<void> {
    for (const row of rows) {
      await client.query(
        `insert into sale_discounts
         (id,company_id,branch_id,sale_id,sale_item_id,source_type,source_id,label_snapshot,reason_code,amount,
          basis_points,created_by,created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          randomUUID(),
          row.companyId,
          row.branchId,
          row.saleId,
          row.saleItemId,
          row.sourceType,
          row.sourceId,
          row.labelSnapshot,
          row.reasonCode,
          row.amount,
          row.basisPoints,
          row.createdBy,
          row.timestamp,
        ],
      );
    }
  }

  public async saleDiscountsForSale(
    companyId: string,
    saleId: string,
  ): Promise<
    {
      id: string;
      saleItemId: string | null;
      sourceType: 'promotion' | 'coupon' | 'manual' | 'reward';
      sourceId: string | null;
      labelSnapshot: string;
      reasonCode: string | null;
      amount: string;
      basisPoints: number | null;
    }[]
  > {
    const rows = result<{
      id: string;
      sale_item_id: string | null;
      source_type: 'promotion' | 'coupon' | 'manual';
      source_id: string | null;
      label_snapshot: string;
      reason_code: string | null;
      amount: string;
      basis_points: number | null;
    }>(
      await this.database.pool.query(
        `select id,sale_item_id,source_type,source_id,label_snapshot,reason_code,amount,basis_points
         from sale_discounts where company_id=$1 and sale_id=$2 order by created_at asc`,
        [companyId, saleId],
      ),
    ).rows;
    return rows.map((row) => ({
      id: row.id,
      saleItemId: row.sale_item_id,
      sourceType: row.source_type,
      sourceId: row.source_id,
      labelSnapshot: row.label_snapshot,
      reasonCode: row.reason_code,
      amount: row.amount,
      basisPoints: row.basis_points,
    }));
  }

  // --- Product resolution for pricing (mirrors `SalesRepository
  // .resolveProductLines` exactly, plus `category_id` — deliberately a
  // second, independent query rather than importing that one: every
  // module in this codebase resolves its own cross-module reads directly
  // (see `RefundsRepository.saleItemsForSale` vs. reusing `sales`'s own
  // repository), never depends on another module's repository for a
  // fetch a plain query already answers) ------------------------------

  public async resolveProductLines(
    client: PromotionTransaction,
    companyId: string,
    branchId: string,
    productIds: readonly string[],
  ): Promise<Map<string, ResolvedPricingProduct>> {
    if (productIds.length === 0) return new Map();
    const [productsResult, pricesResult] = await Promise.all([
      client.query(
        `select p.id as product_id, p.category_id, p.tax_code, p.status, p.version, p.name,
                pv.id as variant_id, pv.sku as variant_sku
         from products p
         left join product_variants pv
           on pv.company_id=p.company_id and pv.product_id=p.id
              and pv.is_default=true and pv.status<>'retired'
         where p.company_id=$1 and p.id=any($2::uuid[])`,
        [companyId, productIds],
      ),
      client.query(
        `select distinct on (product_id) product_id, amount, currency_code
         from product_prices
         where company_id=$1
           and product_id=any($2::uuid[])
           and status='active'
           and valid_from<=now()
           and (valid_until is null or valid_until>now())
           and (branch_id=$3::uuid or branch_id is null)
         order by product_id, (branch_id is not null) desc, valid_from desc`,
        [companyId, productIds, branchId],
      ),
    ]);
    const products = result<{
      product_id: string;
      category_id: string | null;
      tax_code: string;
      status: string;
      version: string;
      name: string;
      variant_id: string | null;
      variant_sku: string | null;
    }>(productsResult);
    const prices = result<{ product_id: string; amount: string; currency_code: string }>(pricesResult);
    const priceByProduct = new Map(
      prices.rows.map((row) => [row.product_id, { amount: row.amount, currencyCode: row.currency_code }]),
    );
    return new Map(
      products.rows.map((row) => [
        row.product_id,
        {
          productId: row.product_id,
          categoryId: row.category_id,
          variantId: row.variant_id,
          productVersion: BigInt(row.version),
          name: row.name,
          skuSnapshot: row.variant_sku,
          taxCode: row.tax_code,
          status: row.status,
          price: priceByProduct.get(row.product_id) ?? null,
        },
      ]),
    );
  }

  /** Read-only variant of `resolveProductLines` for a quote/preview,
   * which never opens a transaction (it writes nothing) — uses the pool
   * directly rather than requiring a caller to synthesize a transaction
   * client just to satisfy a parameter type. */
  public resolveProductLinesReadOnly(
    companyId: string,
    branchId: string,
    productIds: readonly string[],
  ): Promise<Map<string, ResolvedPricingProduct>> {
    return this.resolveProductLines(this.database.pool, companyId, branchId, productIds);
  }

  /** Unlocked count for a quote/preview's own coupon evaluation — same
   * "explicitly allowed to be stale" reasoning as
   * `couponByNormalizedCode` (Part B). */
  public async unlockedCouponRedemptionCount(companyId: string, couponId: string): Promise<number> {
    const row = result<{ count: string }>(
      await this.database.pool.query(
        `select count(*)::text as count from coupon_redemptions where company_id=$1 and coupon_id=$2`,
        [companyId, couponId],
      ),
    ).rows[0];
    return row === undefined ? 0 : Number(row.count);
  }

  /** `branches.timezone` — a real, required, already-validated IANA
   * timezone column (ADR-0016 "Branch/timezone semantics"), never
   * guessed or defaulted to server UTC. */
  public async branchTimezone(companyId: string, branchId: string): Promise<string | null> {
    const row = result<{ timezone: string }>(
      await this.database.pool.query(`select timezone from branches where company_id=$1 and id=$2`, [
        companyId,
        branchId,
      ]),
    ).rows[0];
    return row === undefined ? null : row.timezone;
  }

  private mapDatabaseError(error: unknown): unknown {
    switch (constraint(error)) {
      case 'coupons_company_normalized_code_uq':
        return new PromotionError('validation_error', 'This coupon code is already in use.');
      case 'coupon_redemptions_company_coupon_sale_uq':
        return new PromotionError('resource_conflict', 'This coupon was already redeemed for this sale.');
      default:
        return error;
    }
  }
}

export function encodePromotionCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify([createdAt.toISOString(), id]), 'utf8').toString('base64url');
}
export function decodePromotionCursor(cursor: string): { createdAt: Date; id: string } {
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
    throw new PromotionError('validation_error', 'The cursor is invalid.');
  }
}
