import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { companyIdColumn, createdAtColumn, idColumn, updatedAtColumn } from './common.js';
import { products } from './catalog.js';
import { companyMemberships } from './identity.js';
import { branches, companies } from './organizations.js';

/**
 * TASK 13.0 — `docs/CORE_DATA_MODEL.md` §2 and `docs/API_CONTRACTS.md` §1
 * both explicitly deferred "customers, Rewards, ... memberships" pending an
 * approved customer model; this module IS that approval — see ADR-0017 for
 * the full design. Genuinely new domain: no prior schema, permission, route,
 * or event exists anywhere in this repository (confirmed by forensic search
 * before writing a line of this file).
 *
 * Deliberate naming choice: `company_memberships` (`identity.ts`) already
 * means STAFF/tenant membership — an authenticated user's membership in a
 * company. To avoid colliding with that established concept, the
 * customer-facing loyalty entitlement here is named `customer_memberships`
 * (never bare "memberships"), and its catalog/definition table is
 * `membership_plans` (never bare "plans" or "memberships").
 *
 * Every entity here is COMPANY-scoped, never branch-scoped as its identity
 * boundary — `docs/CORE_DATA_MODEL.md` §20 anticipates this exactly
 * ("Rewards and memberships may reference companies, branches, users or
 * future customers..."). Branch-specific eligibility, where it exists, is
 * modeled as an optional join table (empty = all branches), mirroring
 * `promotion_branches` exactly (`promotions.ts`).
 *
 * Deliberate one-directional dependency: this file imports `catalog.ts`,
 * `identity.ts`, `organizations.ts` — never `sales.ts`. `sales.ts` imports
 * THIS file (for `sales.customer_id`), so the reverse import would create a
 * circular schema dependency Drizzle's eager `foreignKey()` composite-key
 * evaluation cannot support. Two columns that conceptually reference a sale
 * (`customer_memberships.source_sale_id`, `loyalty_ledger.source_id` for a
 * `'sale'` source) are therefore plain, unenforced `uuid` columns —
 * validated at the service layer before insert — exactly the same
 * documented trade-off `sales.ts` itself already makes for its own
 * `sync_operation_id` ("a plain, unenforced column today rather than a
 * fabricated FK").
 */

export const customerStatuses = ['active', 'inactive', 'archived'] as const;
export const membershipStatuses = ['pending', 'active', 'expired', 'cancelled'] as const;
export const loyaltyUnitTypes = ['stamp', 'point'] as const;
export const loyaltyLedgerEntryTypes = ['earn', 'redeem', 'adjustment', 'expiration'] as const;
export const loyaltyLedgerSourceTypes = ['sale', 'manual', 'expiration_job'] as const;

/** The canonical, company-scoped customer identity — Part A/B. Never the
 * same table as `users` (staff/operators); a customer is a commercial guest
 * or member, has no login, and is never conflated with `company_memberships`.
 * `normalized_email`/`normalized_phone` are computed by the service layer
 * (`phone-normalization.ts`, matching `users.normalized_email`'s own
 * app-computed-then-checked convention) and are what the two partial unique
 * indexes below actually protect — Part D's duplicate/conflict policy is
 * enforced here, at the database, not merely in application code. */
export const customers = pgTable(
  'customers',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    firstName: text('first_name').notNull(),
    lastName: text('last_name'),
    displayName: text('display_name').notNull(),
    email: text('email'),
    normalizedEmail: text('normalized_email'),
    phone: text('phone'),
    normalizedPhone: text('normalized_phone'),
    phoneCountryCode: char('phone_country_code', { length: 2 }),
    birthDate: date('birth_date', { mode: 'string' }),
    status: text('status').notNull().default('active'),
    notes: text('notes'),
    createdBy: uuid('created_by').notNull(),
    updatedBy: uuid('updated_by').notNull(),
    version: bigint('version', { mode: 'bigint' }).notNull().default(sql`1`),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('customers_company_id_id_uq').on(table.companyId, table.id),
    // A plain UNIQUE constraint over a nullable column treats every NULL as
    // distinct in Postgres — a customer with no email/phone on file is
    // never compared against another for that field; dedup only ever fires
    // on a real, normalized value in common (Part C/D).
    unique('customers_company_normalized_email_uq').on(table.companyId, table.normalizedEmail),
    unique('customers_company_normalized_phone_uq').on(table.companyId, table.normalizedPhone),
    foreignKey({
      columns: [table.companyId, table.createdBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'customers_created_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.updatedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'customers_updated_by_membership_fk',
    }).onDelete('restrict'),
    index('customers_company_status_idx').on(table.companyId, table.status),
    index('customers_company_display_name_idx').on(table.companyId, table.displayName),
    check('customers_first_name_nonblank_ck', sql`length(btrim(${table.firstName})) > 0`),
    check('customers_display_name_nonblank_ck', sql`length(btrim(${table.displayName})) > 0`),
    check('customers_status_ck', sql`${table.status} in ('active', 'inactive', 'archived')`),
    check(
      'customers_normalized_email_ck',
      sql`${table.normalizedEmail} is null or (length(${table.normalizedEmail}) > 0 and ${table.normalizedEmail} = lower(btrim(${table.normalizedEmail})))`,
    ),
    check(
      'customers_email_format_ck',
      sql`${table.email} is null or ${table.email} ~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'`,
    ),
    // E.164: a leading '+', a nonzero first digit, 7-15 digits total —
    // Part C. Never derived from a guessed country; the service layer only
    // ever writes a value here when it could confidently produce one.
    check(
      'customers_normalized_phone_ck',
      sql`${table.normalizedPhone} is null or ${table.normalizedPhone} ~ '^\\+[1-9]\\d{6,14}$'`,
    ),
    check(
      'customers_phone_country_code_ck',
      sql`${table.phoneCountryCode} is null or ${table.phoneCountryCode} ~ '^[A-Z]{2}$'`,
    ),
    check(
      'customers_birth_date_ck',
      sql`${table.birthDate} is null or ${table.birthDate} <= current_date`,
    ),
    check('customers_version_ck', sql`${table.version} >= 1`),
  ],
);

/** Part U — an opaque, server-generated, non-sequential, revocable QR
 * identity. Never encodes email/phone/name; the token is a pure lookup key
 * (a random 32-byte value, base64url-encoded by the service layer). At most
 * one ACTIVE token per customer at a time — rotation is revoke-then-issue,
 * never mutate-in-place, so history is preserved and a leaked/revoked token
 * can never be silently reactivated. This same `active` token also serves
 * as Part V's Wallet-foundation "stable public pass identifier" — no fake
 * Apple/Google Wallet integration is built; this is only the durable,
 * revocable public id such a pass would eventually carry. */
export const customerQrTokens = pgTable(
  'customer_qr_tokens',
  {
    id: idColumn(),
    companyId: companyIdColumn(),
    customerId: uuid('customer_id').notNull(),
    token: text('token').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: createdAtColumn(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    unique('customer_qr_tokens_token_uq').on(table.token),
    foreignKey({
      columns: [table.companyId, table.customerId],
      foreignColumns: [customers.companyId, customers.id],
      name: 'customer_qr_tokens_customer_scope_fk',
    }).onDelete('restrict'),
    index('customer_qr_tokens_customer_idx').on(table.companyId, table.customerId),
    // Only ONE active token per customer, enforced at the database — a
    // rotation must revoke the old row (status='revoked') in the same
    // transaction it inserts the new one.
    uniqueIndex('customer_qr_tokens_company_customer_active_uq')
      .on(table.companyId, table.customerId)
      .where(sql`${table.status} = 'active'`),
    check('customer_qr_tokens_token_nonblank_ck', sql`length(btrim(${table.token})) >= 16`),
    check('customer_qr_tokens_status_ck', sql`${table.status} in ('active', 'revoked')`),
    check(
      'customer_qr_tokens_revoked_at_ck',
      sql`(${table.status} = 'revoked') = (${table.revokedAt} is not null)`,
    ),
  ],
);

/** Part J — the PRODUCT/RULE definition (never an issued entitlement).
 * Optionally sellable through the existing catalog/Sale pipeline via
 * `product_id` (a real product, `product_type='service'` in every seed
 * used by this task — no second payment system, no fabricated SKU). Branch
 * eligibility is an optional join table, `membership_plan_branches`, empty
 * meaning "all branches" — the exact `promotion_branches` convention. */
export const membershipPlans = pgTable(
  'membership_plans',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description'),
    active: boolean('active').notNull().default(true),
    productId: uuid('product_id'),
    durationDays: integer('duration_days'),
    benefitDescription: text('benefit_description'),
    createdBy: uuid('created_by').notNull(),
    updatedBy: uuid('updated_by').notNull(),
    version: bigint('version', { mode: 'bigint' }).notNull().default(sql`1`),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('membership_plans_company_id_id_uq').on(table.companyId, table.id),
    // A sellable product backs at most one plan — never ambiguous which
    // plan a sold line item should activate.
    unique('membership_plans_company_product_uq').on(table.companyId, table.productId),
    foreignKey({
      columns: [table.companyId, table.productId],
      foreignColumns: [products.companyId, products.id],
      name: 'membership_plans_product_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.createdBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'membership_plans_created_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.updatedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'membership_plans_updated_by_membership_fk',
    }).onDelete('restrict'),
    index('membership_plans_company_active_idx').on(table.companyId, table.active),
    check('membership_plans_name_nonblank_ck', sql`length(btrim(${table.name})) > 0`),
    check(
      'membership_plans_duration_days_ck',
      sql`${table.durationDays} is null or ${table.durationDays} > 0`,
    ),
    check('membership_plans_version_ck', sql`${table.version} >= 1`),
  ],
);

export const membershipPlanBranches = pgTable(
  'membership_plan_branches',
  {
    id: idColumn(),
    companyId: companyIdColumn(),
    membershipPlanId: uuid('membership_plan_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    unique('membership_plan_branches_company_plan_branch_uq').on(
      table.companyId,
      table.membershipPlanId,
      table.branchId,
    ),
    foreignKey({
      columns: [table.companyId, table.membershipPlanId],
      foreignColumns: [membershipPlans.companyId, membershipPlans.id],
      name: 'membership_plan_branches_plan_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.branchId],
      foreignColumns: [branches.companyId, branches.id],
      name: 'membership_plan_branches_branch_scope_fk',
    }).onDelete('restrict'),
    index('membership_plan_branches_plan_idx').on(table.companyId, table.membershipPlanId),
  ],
);

/** Part J/K/L/M — the ISSUED entitlement. `pending|active|expired|cancelled`
 * only — no invented states. A POS-purchased membership is inserted
 * DIRECTLY as `'active'` at the exact moment `SalesRepository.trySettleSale`
 * newly transitions the originating Sale to `completed` (never created
 * earlier, so "no activation before payment" is structural, not a runtime
 * check — see ADR-0017 "Activation boundary"); `'pending'` remains valid for
 * a future admin-issued membership whose `starts_at` is in the future.
 * Renewal creates a NEW row (never mutates `expires_at` in place) chained
 * via `renewed_from_membership_id` — consistent with this codebase's
 * existing "a settled commercial fact is never rewritten" convention
 * (refunds are a new fact against an immutable Sale; this is the same
 * shape) — see ADR-0017 "Renewal". */
export const customerMemberships = pgTable(
  'customer_memberships',
  {
    id: idColumn(),
    companyId: companyIdColumn(),
    customerId: uuid('customer_id').notNull(),
    membershipPlanId: uuid('membership_plan_id').notNull(),
    membershipNumber: text('membership_number').notNull(),
    status: text('status').notNull().default('pending'),
    startsAt: timestamp('starts_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    issuedAt: timestamp('issued_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    // Deliberately NOT a formal FK to `sales` — see this file's own header
    // comment on the one-directional schema-dependency constraint.
    // Validated at the service layer (same company, sale exists) before
    // insert.
    sourceSaleId: uuid('source_sale_id'),
    renewedFromMembershipId: uuid('renewed_from_membership_id'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'date' }),
    cancelledReason: text('cancelled_reason'),
    createdBy: uuid('created_by').notNull(),
    version: bigint('version', { mode: 'bigint' }).notNull().default(sql`1`),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('customer_memberships_company_id_id_uq').on(table.companyId, table.id),
    unique('customer_memberships_company_number_uq').on(table.companyId, table.membershipNumber),
    // Idempotent issuance: a retried/replayed settlement of the same sale
    // can never issue a second membership for the same plan.
    unique('customer_memberships_company_sale_plan_uq').on(
      table.companyId,
      table.sourceSaleId,
      table.membershipPlanId,
    ),
    foreignKey({
      columns: [table.companyId, table.customerId],
      foreignColumns: [customers.companyId, customers.id],
      name: 'customer_memberships_customer_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.membershipPlanId],
      foreignColumns: [membershipPlans.companyId, membershipPlans.id],
      name: 'customer_memberships_plan_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.renewedFromMembershipId],
      foreignColumns: [table.companyId, table.id],
      name: 'customer_memberships_renewed_from_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.createdBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'customer_memberships_created_by_membership_fk',
    }).onDelete('restrict'),
    index('customer_memberships_customer_idx').on(table.companyId, table.customerId),
    index('customer_memberships_company_status_idx').on(table.companyId, table.status),
    check(
      'customer_memberships_status_ck',
      sql`${table.status} in ('pending', 'active', 'expired', 'cancelled')`,
    ),
    check('customer_memberships_number_nonblank_ck', sql`length(btrim(${table.membershipNumber})) > 0`),
    check(
      'customer_memberships_window_ck',
      sql`${table.expiresAt} is null or ${table.startsAt} < ${table.expiresAt}`,
    ),
    check(
      'customer_memberships_cancelled_ck',
      sql`(${table.status} = 'cancelled') = (${table.cancelledAt} is not null and ${table.cancelledReason} is not null)`,
    ),
    check('customer_memberships_version_ck', sql`${table.version} >= 1`),
  ],
);

/** Part S — a minimal, TYPED program configuration (never arbitrary
 * executable JSON — Part S is explicit about this). `earning_rule_type`
 * has exactly one implemented value today (`'per_completed_sale'`),
 * reserved-but-extensible the same way `products.product_type='kit'`
 * already is in this codebase. `reward_threshold`/`reward_description` are
 * informational/progress-display only (Part T: no durable reward
 * entitlement is issued by this task — deliberately deferred, documented
 * in ADR-0017). No company has automatic earning unless it explicitly
 * creates AND activates a program — "no invisible business rule" (Part R). */
export const loyaltyPrograms = pgTable(
  'loyalty_programs',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    active: boolean('active').notNull().default(false),
    unitType: text('unit_type').notNull(),
    earningRuleType: text('earning_rule_type').notNull().default('per_completed_sale'),
    earnQuantityPerSale: integer('earn_quantity_per_sale').notNull().default(1),
    minimumSaleTotal: numeric('minimum_sale_total', { precision: 19, scale: 4 }),
    rewardThreshold: integer('reward_threshold'),
    rewardDescription: text('reward_description'),
    createdBy: uuid('created_by').notNull(),
    updatedBy: uuid('updated_by').notNull(),
    version: bigint('version', { mode: 'bigint' }).notNull().default(sql`1`),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('loyalty_programs_company_id_id_uq').on(table.companyId, table.id),
    foreignKey({
      columns: [table.companyId, table.createdBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'loyalty_programs_created_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.updatedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'loyalty_programs_updated_by_membership_fk',
    }).onDelete('restrict'),
    index('loyalty_programs_company_active_idx').on(table.companyId, table.active),
    check('loyalty_programs_name_nonblank_ck', sql`length(btrim(${table.name})) > 0`),
    check('loyalty_programs_unit_type_ck', sql`${table.unitType} in ('stamp', 'point')`),
    check(
      'loyalty_programs_earning_rule_type_ck',
      sql`${table.earningRuleType} in ('per_completed_sale')`,
    ),
    check('loyalty_programs_earn_quantity_ck', sql`${table.earnQuantityPerSale} > 0`),
    check(
      'loyalty_programs_minimum_sale_total_ck',
      sql`${table.minimumSaleTotal} is null or ${table.minimumSaleTotal} >= 0`,
    ),
    check(
      'loyalty_programs_reward_threshold_ck',
      sql`${table.rewardThreshold} is null or ${table.rewardThreshold} > 0`,
    ),
    check('loyalty_programs_version_ck', sql`${table.version} >= 1`),
  ],
);

/** Part P — 1:1 with a customer within a company. No mutable balance
 * column lives here; balance is always DERIVED from `loyalty_ledger`
 * (Part Q) via a `SUM(quantity)` read — never a cached counter this task
 * would have to keep transactionally consistent by hand. */
export const loyaltyAccounts = pgTable(
  'loyalty_accounts',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    customerId: uuid('customer_id').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('loyalty_accounts_company_id_id_uq').on(table.companyId, table.id),
    unique('loyalty_accounts_company_customer_uq').on(table.companyId, table.customerId),
    foreignKey({
      columns: [table.companyId, table.customerId],
      foreignColumns: [customers.companyId, customers.id],
      name: 'loyalty_accounts_customer_scope_fk',
    }).onDelete('restrict'),
    check('loyalty_accounts_status_ck', sql`${table.status} in ('active', 'closed')`),
  ],
);

/** Part Q — the append-only ledger. Never `UPDATE`d/`DELETE`d by this
 * codebase; a correction is always a new, signed row (`entry_type =
 * 'adjustment'`). `source_id` is a plain unenforced column when
 * `source_type = 'sale'` (see this file's header comment on the
 * one-directional schema-dependency constraint); the idempotency guarantee
 * for automatic earning comes from the partial unique index below, not
 * from a formal FK. `unit_type` is stored per-entry (not re-derived from
 * `loyalty_program_id`, which may be null for a manual entry, or may have
 * its own `unit_type` changed later) — a frozen fact at the moment it was
 * earned, mirroring `sale_discounts.basis_points`'s own "snapshot, don't
 * re-derive from a mutable definition" convention. */
export const loyaltyLedger = pgTable(
  'loyalty_ledger',
  {
    id: idColumn(),
    companyId: companyIdColumn(),
    loyaltyAccountId: uuid('loyalty_account_id').notNull(),
    loyaltyProgramId: uuid('loyalty_program_id'),
    branchId: uuid('branch_id'),
    entryType: text('entry_type').notNull(),
    quantity: integer('quantity').notNull(),
    unitType: text('unit_type').notNull(),
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id'),
    reason: text('reason'),
    actorId: uuid('actor_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    // One automatic 'earn' per (program, sale) — a retried/replayed sale
    // settlement can never double-earn.
    unique('loyalty_ledger_company_program_sale_uq').on(
      table.companyId,
      table.loyaltyProgramId,
      table.sourceType,
      table.sourceId,
    ),
    foreignKey({
      columns: [table.companyId, table.loyaltyAccountId],
      foreignColumns: [loyaltyAccounts.companyId, loyaltyAccounts.id],
      name: 'loyalty_ledger_account_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.loyaltyProgramId],
      foreignColumns: [loyaltyPrograms.companyId, loyaltyPrograms.id],
      name: 'loyalty_ledger_program_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.branchId],
      foreignColumns: [branches.companyId, branches.id],
      name: 'loyalty_ledger_branch_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.actorId],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'loyalty_ledger_actor_membership_fk',
    }).onDelete('restrict'),
    index('loyalty_ledger_account_occurred_idx').on(
      table.companyId,
      table.loyaltyAccountId,
      table.occurredAt,
    ),
    index('loyalty_ledger_program_idx').on(table.companyId, table.loyaltyProgramId),
    check(
      'loyalty_ledger_entry_type_ck',
      sql`${table.entryType} in ('earn', 'redeem', 'adjustment', 'expiration')`,
    ),
    check('loyalty_ledger_quantity_ck', sql`${table.quantity} <> 0`),
    check('loyalty_ledger_unit_type_ck', sql`${table.unitType} in ('stamp', 'point')`),
    check(
      'loyalty_ledger_source_type_ck',
      sql`${table.sourceType} in ('sale', 'manual', 'expiration_job')`,
    ),
    // A manual entry always carries a reason and the admin who made it; an
    // automatic entry never fabricates either.
    check(
      'loyalty_ledger_manual_fields_ck',
      sql`(${table.sourceType} <> 'manual') or (${table.reason} is not null and length(btrim(${table.reason})) > 0 and ${table.actorId} is not null)`,
    ),
  ],
);

export type Customer = typeof customers.$inferSelect;
export type CustomerQrToken = typeof customerQrTokens.$inferSelect;
export type MembershipPlan = typeof membershipPlans.$inferSelect;
export type MembershipPlanBranch = typeof membershipPlanBranches.$inferSelect;
export type CustomerMembership = typeof customerMemberships.$inferSelect;
export type LoyaltyProgram = typeof loyaltyPrograms.$inferSelect;
export type LoyaltyAccount = typeof loyaltyAccounts.$inferSelect;
export type LoyaltyLedgerEntry = typeof loyaltyLedger.$inferSelect;
