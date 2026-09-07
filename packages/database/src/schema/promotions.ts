import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { companyIdColumn, createdAtColumn, idColumn, updatedAtColumn } from './common.js';
import { productCategories, products } from './catalog.js';
import { loyaltyPrograms, rewardEntitlements } from './customers.js';
import { companyMemberships } from './identity.js';
import { branches, companies } from './organizations.js';
import { saleItems, sales } from './sales.js';

/**
 * TASK 12.9 — `docs/CORE_DATA_MODEL.md` §2 ("Excluded") and
 * `docs/API_CONTRACTS.md` §1 ("Excluded") both explicitly name "advanced
 * promotions" as out of scope for the core platform contract — unlike
 * TASK 12.8's `refunds`, this domain is NOT pre-specified anywhere; it is
 * a genuinely new module that owns its own schema/migrations, reconciled
 * instead against what those documents DO already reserve:
 * `sales.discount_total`/`sale_items.discount_total` (present since
 * ADR-0009, always `'0.0000'` until this task), and `sales`'s own
 * `sales_arithmetic_ck` (`total = subtotal - discount_total + tax_total`)
 * — the authoritative discount/tax ordering this whole engine must
 * produce. See ADR-0016 for the full design, including the exact
 * priority/stacking algorithm, the NxM proportional-refund-allocation
 * decision, and every deliberate scope exclusion (no combo/bundle domain
 * — `products.product_type = 'kit'` stays a reserved-but-unexploded
 * value exactly as it already was; no customer-identity-dependent
 * conditions — age/membership/frequency — since no customer model
 * exists yet, matching `docs/CORE_DATA_MODEL.md`'s own deferral).
 */

export const promotionBenefitTypes = ['percentage', 'fixed_amount', 'fixed_price', 'quantity_nxm'] as const;
export const couponBenefitTypes = ['percentage', 'fixed_amount'] as const;
export const discountSourceTypes = ['promotion', 'coupon', 'manual'] as const;

/** The rule primitives themselves — never a JSON "evaluate arbitrary
 * logic" column. `starts_at`/`ends_at`/`days_of_week`/`time_from`/
 * `time_to` are evaluated against the SALE'S OWN BRANCH timezone
 * (`branches.timezone`, already a real, required column — see
 * ADR-0016 "Branch/timezone semantics"), never server UTC.
 * `days_of_week` uses ISO 8601 weekday numbers (1=Monday…7=Sunday),
 * matching PostgreSQL's own `extract(isodow from ...)`. */
export const promotions = pgTable(
  'promotions',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description'),
    active: boolean('active').notNull().default(true),
    startsAt: timestamp('starts_at', { withTimezone: true, mode: 'date' }),
    endsAt: timestamp('ends_at', { withTimezone: true, mode: 'date' }),
    daysOfWeek: integer('days_of_week').array(),
    timeFrom: text('time_from'),
    timeTo: text('time_to'),
    // Higher priority is preferred first among eligible promotions.
    // `stackable=false` (the default — matching every promotion AS POS
    // V1 itself ever applies: at most one at a time) means the winning
    // promotion blocks every other automatic promotion once selected;
    // `stackable=true` means it may ALSO combine with other
    // `stackable=true` promotions (both sides must opt in) — see
    // ADR-0016 "Priority/stacking". Deliberately a single boolean, not a
    // separate `exclusive`/`stackable` pair — those would be two names
    // for the same axis and could disagree with each other.
    priority: integer('priority').notNull().default(0),
    stackable: boolean('stackable').notNull().default(false),
    benefitType: text('benefit_type').notNull(),
    benefitPercentageBasisPoints: integer('benefit_percentage_basis_points'),
    benefitFixedAmount: numeric('benefit_fixed_amount', { precision: 19, scale: 4 }),
    benefitNxmBuyQuantity: integer('benefit_nxm_buy_quantity'),
    benefitNxmPayQuantity: integer('benefit_nxm_pay_quantity'),
    minQuantity: numeric('min_quantity', { precision: 19, scale: 6 }),
    minSubtotal: numeric('min_subtotal', { precision: 19, scale: 4 }),
    usageLimitTotal: integer('usage_limit_total'),
    // Mirrors AS POS V1's own `promo.compatibilidad.combinableConCupones`
    // (confirmed by reading `AS POS V1.html` directly) — the single
    // source of truth for promotion/coupon combinability; no mirrored
    // flag exists on `coupons` (V1's own coupon editor never exposes
    // one either).
    combinableWithCoupons: boolean('combinable_with_coupons').notNull().default(true),
    createdBy: uuid('created_by').notNull(),
    updatedBy: uuid('updated_by').notNull(),
    version: bigint('version', { mode: 'bigint' }).notNull().default(sql`1`),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('promotions_company_id_id_uq').on(table.companyId, table.id),
    foreignKey({
      columns: [table.companyId, table.createdBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'promotions_created_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.updatedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'promotions_updated_by_membership_fk',
    }).onDelete('restrict'),
    index('promotions_company_active_idx').on(table.companyId, table.active),
    check('promotions_name_nonblank_ck', sql`length(btrim(${table.name})) > 0`),
    check(
      'promotions_benefit_type_ck',
      sql`${table.benefitType} in ('percentage','fixed_amount','fixed_price','quantity_nxm')`,
    ),
    // Exactly the fields the selected `benefit_type` needs, and no
    // others — never a partially-populated benefit that a careless
    // reader could misinterpret.
    check(
      'promotions_benefit_fields_ck',
      sql`(${table.benefitType} = 'percentage'
            and ${table.benefitPercentageBasisPoints} is not null and ${table.benefitPercentageBasisPoints} > 0
              and ${table.benefitPercentageBasisPoints} <= 10000
            and ${table.benefitFixedAmount} is null
            and ${table.benefitNxmBuyQuantity} is null and ${table.benefitNxmPayQuantity} is null)
        or (${table.benefitType} in ('fixed_amount','fixed_price')
            and ${table.benefitFixedAmount} is not null and ${table.benefitFixedAmount} >= 0
            and ${table.benefitPercentageBasisPoints} is null
            and ${table.benefitNxmBuyQuantity} is null and ${table.benefitNxmPayQuantity} is null)
        or (${table.benefitType} = 'quantity_nxm'
            and ${table.benefitNxmBuyQuantity} is not null and ${table.benefitNxmPayQuantity} is not null
              and ${table.benefitNxmPayQuantity} > 0 and ${table.benefitNxmBuyQuantity} > ${table.benefitNxmPayQuantity}
            and ${table.benefitPercentageBasisPoints} is null and ${table.benefitFixedAmount} is null)`,
    ),
    check('promotions_priority_ck', sql`${table.priority} >= 0`),
    check(
      'promotions_validity_window_ck',
      sql`${table.startsAt} is null or ${table.endsAt} is null or ${table.startsAt} < ${table.endsAt}`,
    ),
    check(
      'promotions_days_of_week_ck',
      sql`${table.daysOfWeek} is null or ${table.daysOfWeek} <@ array[1,2,3,4,5,6,7]`,
    ),
    check(
      'promotions_time_from_format_ck',
      sql`${table.timeFrom} is null or ${table.timeFrom} ~ '^([01]\\d|2[0-3]):[0-5]\\d$'`,
    ),
    check(
      'promotions_time_to_format_ck',
      sql`${table.timeTo} is null or ${table.timeTo} ~ '^([01]\\d|2[0-3]):[0-5]\\d$'`,
    ),
    check('promotions_min_quantity_ck', sql`${table.minQuantity} is null or ${table.minQuantity} > 0`),
    check('promotions_min_subtotal_ck', sql`${table.minSubtotal} is null or ${table.minSubtotal} >= 0`),
    check(
      'promotions_usage_limit_total_ck',
      sql`${table.usageLimitTotal} is null or ${table.usageLimitTotal} > 0`,
    ),
    check('promotions_version_ck', sql`${table.version} >= 1`),
  ],
);

/** Branch scope — empty (no rows) means every one of the company's
 * branches is eligible, matching AS POS V1's own `sucursales:
 * []`-means-"Todas" convention. A real join table with a real FK, like
 * `user_branch_access` — never a bare `uuid[]` column, so a branch
 * cannot be scoped by an id that doesn't (or no longer) exists. */
export const promotionBranches = pgTable(
  'promotion_branches',
  {
    id: idColumn(),
    companyId: companyIdColumn(),
    promotionId: uuid('promotion_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    unique('promotion_branches_company_promotion_branch_uq').on(
      table.companyId,
      table.promotionId,
      table.branchId,
    ),
    foreignKey({
      columns: [table.companyId, table.promotionId],
      foreignColumns: [promotions.companyId, promotions.id],
      name: 'promotion_branches_promotion_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.branchId],
      foreignColumns: [branches.companyId, branches.id],
      name: 'promotion_branches_branch_scope_fk',
    }).onDelete('restrict'),
    index('promotion_branches_promotion_idx').on(table.companyId, table.promotionId),
  ],
);

/** Product scope — empty means "not restricted by specific product id"
 * (still possibly restricted by category, see [promotionCategories]).
 * Both empty means every product is eligible. */
export const promotionProducts = pgTable(
  'promotion_products',
  {
    id: idColumn(),
    companyId: companyIdColumn(),
    promotionId: uuid('promotion_id').notNull(),
    productId: uuid('product_id').notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    unique('promotion_products_company_promotion_product_uq').on(
      table.companyId,
      table.promotionId,
      table.productId,
    ),
    foreignKey({
      columns: [table.companyId, table.promotionId],
      foreignColumns: [promotions.companyId, promotions.id],
      name: 'promotion_products_promotion_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.productId],
      foreignColumns: [products.companyId, products.id],
      name: 'promotion_products_product_scope_fk',
    }).onDelete('restrict'),
    index('promotion_products_promotion_idx').on(table.companyId, table.promotionId),
    index('promotion_products_product_idx').on(table.companyId, table.productId),
  ],
);

/** Category scope — a product is eligible under this promotion if it is
 * listed in [promotionProducts] OR its own `category_id` is listed
 * here; both empty means every product is eligible (see ADR-0016). */
export const promotionCategories = pgTable(
  'promotion_categories',
  {
    id: idColumn(),
    companyId: companyIdColumn(),
    promotionId: uuid('promotion_id').notNull(),
    categoryId: uuid('category_id').notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    unique('promotion_categories_company_promotion_category_uq').on(
      table.companyId,
      table.promotionId,
      table.categoryId,
    ),
    foreignKey({
      columns: [table.companyId, table.promotionId],
      foreignColumns: [promotions.companyId, promotions.id],
      name: 'promotion_categories_promotion_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.categoryId],
      foreignColumns: [productCategories.companyId, productCategories.id],
      name: 'promotion_categories_category_scope_fk',
    }).onDelete('restrict'),
    index('promotion_categories_promotion_idx').on(table.companyId, table.promotionId),
    index('promotion_categories_category_idx').on(table.companyId, table.categoryId),
  ],
);

/** A durable, server-side coupon — standalone benefit fields (never a
 * bare pointer requiring a promotion to mean anything), matching AS POS
 * V1's own coupon model exactly (`tipo: porcentaje|fijo`). `promotionId`
 * is an optional future linkage — structurally valid, unexercised by
 * this pass (no evidence V1 itself ever links one; see ADR-0016). No
 * branch-restriction table exists for coupons — V1's own coupon editor
 * has no branch field either, only its promotion editor does. */
export const coupons = pgTable(
  'coupons',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    normalizedCode: text('normalized_code').notNull(),
    description: text('description'),
    benefitType: text('benefit_type').notNull(),
    benefitPercentageBasisPoints: integer('benefit_percentage_basis_points'),
    benefitFixedAmount: numeric('benefit_fixed_amount', { precision: 19, scale: 4 }),
    active: boolean('active').notNull().default(true),
    startsAt: timestamp('starts_at', { withTimezone: true, mode: 'date' }),
    endsAt: timestamp('ends_at', { withTimezone: true, mode: 'date' }),
    minSubtotal: numeric('min_subtotal', { precision: 19, scale: 4 }),
    usageLimitTotal: integer('usage_limit_total'),
    promotionId: uuid('promotion_id'),
    createdBy: uuid('created_by').notNull(),
    updatedBy: uuid('updated_by').notNull(),
    version: bigint('version', { mode: 'bigint' }).notNull().default(sql`1`),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('coupons_company_id_id_uq').on(table.companyId, table.id),
    unique('coupons_company_normalized_code_uq').on(table.companyId, table.normalizedCode),
    foreignKey({
      columns: [table.companyId, table.promotionId],
      foreignColumns: [promotions.companyId, promotions.id],
      name: 'coupons_promotion_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.createdBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'coupons_created_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.updatedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'coupons_updated_by_membership_fk',
    }).onDelete('restrict'),
    index('coupons_company_active_idx').on(table.companyId, table.active),
    check('coupons_code_nonblank_ck', sql`length(btrim(${table.code})) > 0`),
    check(
      'coupons_normalized_code_ck',
      sql`length(${table.normalizedCode}) > 0 and ${table.normalizedCode} = upper(btrim(${table.normalizedCode}))`,
    ),
    check('coupons_benefit_type_ck', sql`${table.benefitType} in ('percentage','fixed_amount')`),
    check(
      'coupons_benefit_fields_ck',
      sql`(${table.benefitType} = 'percentage'
            and ${table.benefitPercentageBasisPoints} is not null and ${table.benefitPercentageBasisPoints} > 0
              and ${table.benefitPercentageBasisPoints} <= 10000
            and ${table.benefitFixedAmount} is null)
        or (${table.benefitType} = 'fixed_amount'
            and ${table.benefitFixedAmount} is not null and ${table.benefitFixedAmount} >= 0
            and ${table.benefitPercentageBasisPoints} is null)`,
    ),
    check(
      'coupons_validity_window_ck',
      sql`${table.startsAt} is null or ${table.endsAt} is null or ${table.startsAt} < ${table.endsAt}`,
    ),
    check('coupons_min_subtotal_ck', sql`${table.minSubtotal} is null or ${table.minSubtotal} >= 0`),
    check(
      'coupons_usage_limit_total_ck',
      sql`${table.usageLimitTotal} is null or ${table.usageLimitTotal} > 0`,
    ),
    check('coupons_version_ck', sql`${table.version} >= 1`),
  ],
);

/** One redemption per (coupon, sale) — the durable, database-level
 * concurrency guarantee for Part J: a coupon with exactly one remaining
 * redemption cannot be consumed twice by concurrent checkouts, because
 * `PromotionsService.redeemCoupon` locks the coupon row (`for update`)
 * and counts existing rows here inside the SAME transaction as the sale
 * that consumes it — mirroring `RefundsRepository`'s locked
 * cumulative-quantity read exactly. Created at sale-creation time;
 * released (deleted) if that same sale is later cancelled before
 * completion — see ADR-0016 "Coupon concurrency" for why sale
 * creation+cancellation (both pre-existing lifecycle boundaries) is the
 * chosen reservation window, never a bespoke new one. */
export const couponRedemptions = pgTable(
  'coupon_redemptions',
  {
    id: idColumn(),
    companyId: companyIdColumn(),
    branchId: uuid('branch_id').notNull(),
    couponId: uuid('coupon_id').notNull(),
    saleId: uuid('sale_id').notNull(),
    amount: numeric('amount', { precision: 19, scale: 4 }).notNull(),
    redeemedAt: timestamp('redeemed_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('coupon_redemptions_company_coupon_sale_uq').on(table.companyId, table.couponId, table.saleId),
    foreignKey({
      columns: [table.companyId, table.couponId],
      foreignColumns: [coupons.companyId, coupons.id],
      name: 'coupon_redemptions_coupon_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.branchId, table.saleId],
      foreignColumns: [sales.companyId, sales.branchId, sales.id],
      name: 'coupon_redemptions_sale_scope_fk',
    }).onDelete('restrict'),
    index('coupon_redemptions_coupon_idx').on(table.companyId, table.couponId),
    index('coupon_redemptions_sale_idx').on(table.companyId, table.saleId),
    check('coupon_redemptions_amount_ck', sql`${table.amount} >= 0`),
  ],
);

/** The immutable, itemized breakdown of every discount actually applied
 * to a Sale — one row per distinct application (a ticket-wide manual
 * discount or coupon is one row with `sale_item_id` null; a per-line
 * promotion is one row per affected line). This is what Sale Detail's
 * "exactly which commercial adjustments were applied" (Part V) and the
 * receipt's discount lines read from — never re-derived from a
 * promotion/coupon that might since have changed or been deleted (see
 * ADR-0016 D-snapshot immutability). `basis_points` is populated only
 * for a percentage-shaped source (including NxM, expressed as its
 * equivalent rate — see ADR-0016 "NxM refund allocation") and is what
 * `refunds.service.ts`'s `computeLineReversal` uses to recompute an
 * exact, proportional partial-refund amount without ever re-reading
 * this table (the rate is ALSO copied onto `sale_items.discount_basis_
 * points` for that reason — this table is the audit/receipt trail, not
 * the refund computation's own source). */
export const saleDiscounts = pgTable(
  'sale_discounts',
  {
    id: idColumn(),
    companyId: companyIdColumn(),
    branchId: uuid('branch_id').notNull(),
    saleId: uuid('sale_id').notNull(),
    saleItemId: uuid('sale_item_id'),
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id'),
    labelSnapshot: text('label_snapshot').notNull(),
    reasonCode: text('reason_code'),
    amount: numeric('amount', { precision: 19, scale: 4 }).notNull(),
    basisPoints: integer('basis_points'),
    createdBy: uuid('created_by').notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    foreignKey({
      columns: [table.companyId, table.branchId, table.saleId],
      foreignColumns: [sales.companyId, sales.branchId, sales.id],
      name: 'sale_discounts_sale_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.saleItemId],
      foreignColumns: [saleItems.companyId, saleItems.id],
      name: 'sale_discounts_sale_item_scope_fk',
    }).onDelete('restrict'),
    index('sale_discounts_sale_idx').on(table.companyId, table.saleId),
    index('sale_discounts_sale_item_idx').on(table.companyId, table.saleItemId),
    // TASK 13.2 — `'reward'` added, mirroring `'promotion'`/`'coupon'`'s
    // own shape exactly (a reward's `source_id` is the entitlement id it
    // came from, see `sale_discounts_source_fields_ck` below).
    check('sale_discounts_source_type_ck', sql`${table.sourceType} in ('promotion','coupon','manual','reward')`),
    check('sale_discounts_amount_ck', sql`${table.amount} >= 0`),
    check(
      'sale_discounts_basis_points_ck',
      sql`${table.basisPoints} is null or (${table.basisPoints} >= 0 and ${table.basisPoints} <= 10000)`,
    ),
    check('sale_discounts_label_nonblank_ck', sql`length(btrim(${table.labelSnapshot})) > 0`),
    // A promotion/coupon/reward source always carries the id it came
    // from and never a reason code (that's a manual-discount-only
    // field); a manual source always carries a reason code and never a
    // source id — the two shapes are never blurred together.
    check(
      'sale_discounts_source_fields_ck',
      sql`(${table.sourceType} in ('promotion','coupon','reward') and ${table.sourceId} is not null and ${table.reasonCode} is null)
        or (${table.sourceType} = 'manual' and ${table.sourceId} is null and ${table.reasonCode} is not null)`,
    ),
  ],
);

/** TASK 13.2 (ADR-0019 "Sale reward snapshot"/"Discount accounting") —
 * the reward-specific LIFECYCLE record `sale_discounts` deliberately
 * does not carry (that table is an immutable, append-only arithmetic
 * audit trail with no status concept at all — every row it holds is
 * simply "applied", forever). This table answers a DIFFERENT question:
 * "does settlement of THIS Sale still need to consume an entitlement,
 * and which one" — `applied` (attached at Sale creation, not yet
 * consumed) → `consumed` (the Sale genuinely settled and
 * `RewardsService` durably redeemed the entitlement in the SAME
 * transaction) or `released` (the Sale was cancelled before ever
 * settling — the entitlement was never touched and remains available
 * for a different Sale).
 *
 * `benefit_amount_snapshot` is a READ-CONVENIENCE COPY of the exact
 * amount `sale_discounts` (source_type='reward', same sale_item_id)
 * already recorded from the SAME pricing computation in the SAME
 * transaction — `sale_discounts`/`sale_items.discount_total` remain the
 * ONE arithmetic authority; this column is never independently computed
 * and never disagrees with it by construction (Part H "avoid double-
 * storage contradictions").
 *
 * Exactly one usage row per Sale (`UNIQUE(company_id, sale_id)`) — this
 * task's scope is one attached reward per Sale (Part O: "cashier can
 * select one"). Concurrency safety (Part F) is NOT enforced here at
 * all — this table never blocks a second Sale from also attaching the
 * SAME entitlement while it is still `available` (both previews, and
 * even both Sale creations, may legitimately reference it). The single
 * real serialization point is `reward_entitlements`' own row lock inside
 * `RewardsService`'s existing, already-concurrency-tested redemption
 * path (ADR-0018 Part G/J) — reused as-is at settlement, never
 * duplicated here. */
export const saleRewardUsages = pgTable(
  'sale_reward_usages',
  {
    id: idColumn(),
    companyId: companyIdColumn(),
    branchId: uuid('branch_id').notNull(),
    saleId: uuid('sale_id').notNull(),
    saleItemId: uuid('sale_item_id').notNull(),
    rewardEntitlementId: uuid('reward_entitlement_id').notNull(),
    loyaltyProgramId: uuid('loyalty_program_id').notNull(),
    rewardType: text('reward_type').notNull(),
    benefitType: text('benefit_type').notNull(),
    benefitAmountSnapshot: numeric('benefit_amount_snapshot', { precision: 19, scale: 4 }).notNull(),
    status: text('status').notNull().default('applied'),
    createdAt: createdAtColumn(),
    consumedAt: timestamp('consumed_at', { withTimezone: true, mode: 'date' }),
    releasedAt: timestamp('released_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    unique('sale_reward_usages_company_sale_uq').on(table.companyId, table.saleId),
    foreignKey({
      columns: [table.companyId, table.branchId, table.saleId],
      foreignColumns: [sales.companyId, sales.branchId, sales.id],
      name: 'sale_reward_usages_sale_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.saleItemId],
      foreignColumns: [saleItems.companyId, saleItems.id],
      name: 'sale_reward_usages_sale_item_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.rewardEntitlementId],
      foreignColumns: [rewardEntitlements.companyId, rewardEntitlements.id],
      name: 'sale_reward_usages_entitlement_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.loyaltyProgramId],
      foreignColumns: [loyaltyPrograms.companyId, loyaltyPrograms.id],
      name: 'sale_reward_usages_program_scope_fk',
    }).onDelete('restrict'),
    index('sale_reward_usages_sale_idx').on(table.companyId, table.saleId),
    index('sale_reward_usages_entitlement_idx').on(table.companyId, table.rewardEntitlementId),
    check('sale_reward_usages_reward_type_ck', sql`${table.rewardType} in ('vip_pass')`),
    check(
      'sale_reward_usages_benefit_type_ck',
      sql`${table.benefitType} in ('percentage_discount','fixed_amount_discount','fixed_price','free_eligible_item')`,
    ),
    check('sale_reward_usages_benefit_amount_ck', sql`${table.benefitAmountSnapshot} >= 0`),
    check('sale_reward_usages_status_ck', sql`${table.status} in ('applied','consumed','released')`),
    check('sale_reward_usages_consumed_at_ck', sql`(${table.status} = 'consumed') = (${table.consumedAt} is not null)`),
    check('sale_reward_usages_released_at_ck', sql`(${table.status} = 'released') = (${table.releasedAt} is not null)`),
  ],
);

export type Promotion = typeof promotions.$inferSelect;
export type PromotionBranch = typeof promotionBranches.$inferSelect;
export type PromotionProduct = typeof promotionProducts.$inferSelect;
export type PromotionCategory = typeof promotionCategories.$inferSelect;
export type SaleRewardUsage = typeof saleRewardUsages.$inferSelect;
export type Coupon = typeof coupons.$inferSelect;
export type CouponRedemption = typeof couponRedemptions.$inferSelect;
export type SaleDiscount = typeof saleDiscounts.$inferSelect;
