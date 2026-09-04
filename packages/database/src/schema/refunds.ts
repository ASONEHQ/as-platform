import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  check,
  foreignKey,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { companyIdColumn, createdAtColumn, idColumn } from './common.js';
import { cashSessions } from './cash.js';
import { devices } from './devices.js';
import { companyMemberships } from './identity.js';
import { payments } from './payments.js';
import { sales, saleItems } from './sales.js';
import { branches, companies } from './organizations.js';

/**
 * TASK 12.8 — the `refunds`/`refund_items` domain `docs/CORE_DATA_MODEL.md`
 * §6.6 and `docs/API_CONTRACTS.md` §5/§6/§7/§17/§21.4 already reserved and
 * fully specified — exact field lists, permission codes (`refund.*`),
 * error codes (`sale_not_refundable` etc.), the exact 6-state/8-transition
 * machine, and endpoint contracts (E081–E087) — none of it invented fresh
 * here. See ADR-0015 for the full reconciliation, including the two
 * deliberate scope decisions (self-approve-or-reject-outright instead of a
 * separate approval workflow; a corrected original sale stays historically
 * `completed`, never a project-invented 6th `sales.status` value).
 */

// §21.4: exactly 6 states. This implementation's own `POST /refunds`
// either lands directly in `approved` (actor holds both `refund.create`
// and `refund.approve` — the canonical "requester may self-approve by
// policy" transition) or throws `refund_approval_required` outright with
// nothing persisted — so `pending_approval` and `rejected` stay
// structurally valid but unexercised by this pass, the same documented
// choice `sales.ts` already made for its own `draft`/`rejected` states.
export const refundStatuses = [
  'requested',
  'pending_approval',
  'approved',
  'completed',
  'cancelled',
  'rejected',
] as const;

// CORE_DATA_MODEL §12: "Returns create explicit restock, damage,
// quarantine, or no-restock movements according to disposition." No
// disposition-selection UI exists in this pass (see ADR-0015) — every
// refund item is assigned `restock` (stock-tracked variant) or
// `no_restock` (everything else) server-side; `damage`/`quarantine` stay
// structurally valid for a future manual-disposition feature.
export const refundItemDispositions = ['restock', 'damage', 'quarantine', 'no_restock'] as const;

export const refunds = pgTable(
  'refunds',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').notNull(),
    saleId: uuid('sale_id').notNull(),
    // Populated only at completion, and only for a cash refund — the
    // CURRENT open session performing the refund, never the original
    // sale's (possibly long-closed) session. See ADR-0015 "Current vs
    // original CashSession".
    cashSessionId: uuid('cash_session_id'),
    // Beyond §6.6's own field list: the specific original `payments` row
    // this refund reverses (for a full refund) or partially corrects
    // (for a partial one) — resolved and frozen at *completion* time, not
    // creation time (which original payment is even eligible depends on
    // what's still captured when the cashier actually confirms). Nullable
    // until then.
    paymentId: uuid('payment_id'),
    refundNumber: text('refund_number').notNull(),
    status: text('status').notNull().default('requested'),
    // Beyond §6.6's own field list: the payment method this refund pays
    // back through — always derived from the original captured payment,
    // never a client choice (ADR-0015 "no refund-method override"). Frozen
    // at creation time so the receipt/preview can show it before
    // completion.
    refundMethod: text('refund_method').notNull(),
    reasonCode: text('reason_code').notNull(),
    reasonNote: text('reason_note'),
    currencyCode: char('currency_code', { length: 3 }).notNull(),
    subtotal: numeric('subtotal', { precision: 19, scale: 4 }).notNull(),
    taxTotal: numeric('tax_total', { precision: 19, scale: 4 }).notNull(),
    total: numeric('total', { precision: 19, scale: 4 }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
    createdBy: uuid('created_by').notNull(),
    approvedBy: uuid('approved_by'),
    deviceId: uuid('device_id'),
    syncOperationId: uuid('sync_operation_id'),
    version: bigint('version', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
    createdAt: createdAtColumn(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('refunds_company_id_id_uq').on(table.companyId, table.id),
    unique('refunds_company_branch_id_uq').on(table.companyId, table.branchId, table.id),
    unique('refunds_company_branch_number_uq').on(table.companyId, table.branchId, table.refundNumber),
    foreignKey({
      columns: [table.companyId, table.branchId],
      foreignColumns: [branches.companyId, branches.id],
      name: 'refunds_branch_scope_fk',
    }).onDelete('restrict'),
    // Hard-enforced same-branch as the original sale — §6.6 says
    // "normally original sale branch"; this implementation makes it exact
    // rather than leaving a cross-branch exception unbuilt-but-implied.
    foreignKey({
      columns: [table.companyId, table.branchId, table.saleId],
      foreignColumns: [sales.companyId, sales.branchId, sales.id],
      name: 'refunds_sale_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.branchId, table.cashSessionId],
      foreignColumns: [cashSessions.companyId, cashSessions.branchId, cashSessions.id],
      name: 'refunds_cash_session_scope_fk',
    }).onDelete('restrict'),
    // `payments` only has `unique(company_id, id)` (see payments.ts) — no
    // `(company_id, branch_id, id)` triple to target, so this stays a
    // 2-column FK, matching every other cross-module reference to
    // `payments` in this codebase.
    foreignKey({
      columns: [table.companyId, table.paymentId],
      foreignColumns: [payments.companyId, payments.id],
      name: 'refunds_payment_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.deviceId],
      foreignColumns: [devices.companyId, devices.id],
      name: 'refunds_device_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.createdBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'refunds_created_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.approvedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'refunds_approved_by_membership_fk',
    }).onDelete('restrict'),
    index('refunds_company_branch_idx').on(table.companyId, table.branchId),
    index('refunds_company_sale_idx').on(table.companyId, table.saleId),
    index('refunds_company_status_idx').on(table.companyId, table.status),
    index('refunds_company_occurred_idx').on(table.companyId, table.occurredAt, table.id),
    check('refunds_number_nonblank_ck', sql`length(btrim(${table.refundNumber})) > 0`),
    check('refunds_currency_code_ck', sql`${table.currencyCode} ~ '^[A-Z]{3}$'`),
    check(
      'refunds_status_ck',
      sql`${table.status} in ('requested','pending_approval','approved','completed','cancelled','rejected')`,
    ),
    check(
      'refunds_method_ck',
      sql`${table.refundMethod} in ('cash','card_terminal','card_manual','other')`,
    ),
    check('refunds_reason_code_nonblank_ck', sql`length(btrim(${table.reasonCode})) > 0`),
    check('refunds_subtotal_ck', sql`${table.subtotal} >= 0`),
    check('refunds_tax_total_ck', sql`${table.taxTotal} >= 0`),
    // §6.6: "positive total".
    check('refunds_total_positive_ck', sql`${table.total} > 0`),
    check('refunds_arithmetic_ck', sql`${table.total} = ${table.subtotal} + ${table.taxTotal}`),
    check(
      'refunds_completed_fields_ck',
      sql`(${table.status} <> 'completed'
          and ${table.completedAt} is null)
        or (${table.status} = 'completed'
          and ${table.completedAt} is not null and ${table.paymentId} is not null)`,
    ),
    check(
      'refunds_cash_session_only_when_cash_ck',
      sql`${table.cashSessionId} is null or ${table.refundMethod} = 'cash'`,
    ),
    check('refunds_version_ck', sql`${table.version} >= 1`),
  ],
);

/** Immutable quantity/value link from a refund to the original sale item —
 * §6.6 `refund_items`. Never independently mutable; inventory effects are
 * separate movements (`inventory_movements` with `reference_type='refund'`
 * — see ADR-0015). */
export const refundItems = pgTable(
  'refund_items',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').notNull(),
    refundId: uuid('refund_id').notNull(),
    saleItemId: uuid('sale_item_id').notNull(),
    quantity: numeric('quantity', { precision: 19, scale: 6 }).notNull(),
    subtotal: numeric('subtotal', { precision: 19, scale: 4 }).notNull(),
    taxTotal: numeric('tax_total', { precision: 19, scale: 4 }).notNull(),
    lineTotal: numeric('line_total', { precision: 19, scale: 4 }).notNull(),
    restockDisposition: text('restock_disposition').notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    unique('refund_items_company_id_id_uq').on(table.companyId, table.id),
    // §6.6: "Unique (company_id,refund_id,sale_item_id) unless split
    // disposition is later approved" — no split-disposition feature
    // exists in this pass, so this is a hard uniqueness.
    unique('refund_items_refund_sale_item_uq').on(table.companyId, table.refundId, table.saleItemId),
    foreignKey({
      columns: [table.companyId, table.refundId],
      foreignColumns: [refunds.companyId, refunds.id],
      name: 'refund_items_refund_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.saleItemId],
      foreignColumns: [saleItems.companyId, saleItems.id],
      name: 'refund_items_sale_item_scope_fk',
    }).onDelete('restrict'),
    index('refund_items_refund_idx').on(table.companyId, table.refundId),
    index('refund_items_sale_item_idx').on(table.companyId, table.saleItemId),
    check('refund_items_quantity_ck', sql`${table.quantity} > 0`),
    check('refund_items_subtotal_ck', sql`${table.subtotal} >= 0`),
    check('refund_items_tax_total_ck', sql`${table.taxTotal} >= 0`),
    check('refund_items_line_total_ck', sql`${table.lineTotal} >= 0`),
    check(
      'refund_items_line_arithmetic_ck',
      sql`${table.lineTotal} = ${table.subtotal} + ${table.taxTotal}`,
    ),
    check(
      'refund_items_disposition_ck',
      sql`${table.restockDisposition} in ('restock','damage','quarantine','no_restock')`,
    ),
  ],
);

// §6.6/Part F durable idempotency: a completed refund can never post a
// second `cash_refund` cash movement or a second inventory `return`
// movement — see `cash_movements_refund_reference_uq` (cash.ts) and
// `inventory_movements_refund_reference_uq` (inventory.ts), both partial
// unique indexes on those tables' existing generic `reference_type='refund'`/
// `reference_id` columns, mirroring ADR-0013/ADR-0014's identical pattern.

export type Refund = typeof refunds.$inferSelect;
export type RefundItem = typeof refundItems.$inferSelect;
