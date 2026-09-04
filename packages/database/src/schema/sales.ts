import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { companyIdColumn, createdAtColumn, idColumn, updatedAtColumn } from './common.js';
import { cashRegisters, cashSessions } from './cash.js';
import { products, productVariants } from './catalog.js';
import { devices } from './devices.js';
import { companyMemberships } from './identity.js';
import { branches, companies } from './organizations.js';

/**
 * TASK 12.4A.1 — the minimum production-safe persisted Sale aggregate
 * required to own payments, reconciled against
 * `docs/CORE_DATA_MODEL.md` §6.6 (`sales`/`sale_items`) and
 * `docs/API_CONTRACTS.md` §21.2's exact 5-state/7-transition machine —
 * neither invented fresh. See ADR-0009 for the full design rationale and
 * the deliberate deviations from §6.6's field list documented below.
 *
 * `cash_register_id`/`cash_session_id` are nullable — §6.6 marks them
 * required (`*`), but a Sale is created (in `pending_payment`) before any
 * payment method is even chosen, so it cannot yet know whether a cash
 * session will ever apply (see ADR-0014: only *cash* payment confirmation
 * requires an open session, not sale creation or a card payment).
 * TASK 12.7 makes both real, scoped FKs to the now-existing
 * `cash_registers`/`cash_sessions` tables (`packages/database/src/schema/cash.ts`)
 * — populated by `SalesRepository.trySettleSale` the moment a cash
 * payment actually settles the sale against a real open session; still
 * `null` for a card sale, a not-yet-completed sale, or any historical
 * pre-TASK-12.7 sale (see ADR-0014's "legacy" policy). `device_id` is
 * nullable too: the current CAJERO session is a browser session, not a
 * registered POS device (see docs/REALTIME_EVENTS.md §4.1 — "browser ...
 * clients bind [device_id] only when their authenticated session policy
 * requires it"), so requiring one here would make sale creation
 * impossible from the actual current session shape. All three are real,
 * scoped-FK columns today — never fabricated relationships.
 */
export const sales = pgTable(
  'sales',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').notNull(),
    cashRegisterId: uuid('cash_register_id'),
    cashSessionId: uuid('cash_session_id'),
    deviceId: uuid('device_id'),
    // §6.6's `sync_operation_id uuid` (nullable there too) — reserved the
    // same way as the three columns above: no `sync_operations` table
    // exists in this schema yet (ADR-0003's offline command sync is
    // designed but unimplemented), so this stays a plain, unenforced
    // column today rather than a fabricated FK.
    syncOperationId: uuid('sync_operation_id'),
    // Derived from `id`, matching the exact established convention
    // already used for `inventory_movements.movement_number`
    // (`IMV-${id...}`) — no separate sequence/counter needed.
    saleNumber: text('sale_number').notNull(),
    // §21.2's exact 5 states. Creation lands directly in
    // 'pending_payment' (see ADR-0009) — 'draft' and 'rejected' remain
    // structurally valid but unexercised by this pass.
    status: text('status').notNull().default('pending_payment'),
    currencyCode: char('currency_code', { length: 3 }).notNull(),
    subtotal: numeric('subtotal', { precision: 19, scale: 4 }).notNull(),
    discountTotal: numeric('discount_total', { precision: 19, scale: 4 }).notNull().default(sql`0`),
    taxTotal: numeric('tax_total', { precision: 19, scale: 4 }).notNull(),
    total: numeric('total', { precision: 19, scale: 4 }).notNull(),
    paidTotal: numeric('paid_total', { precision: 19, scale: 4 }).notNull().default(sql`0`),
    changeTotal: numeric('change_total', { precision: 19, scale: 4 }).notNull().default(sql`0`),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'date' }),
    cancelledBy: uuid('cancelled_by'),
    reasonCode: text('reason_code'),
    createdBy: uuid('created_by').notNull(),
    version: bigint('version', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('sales_company_id_id_uq').on(table.companyId, table.id),
    // The load-bearing triple-key: `payments.(company_id,branch_id,
    // sale_id)` can only ever reference a sale that genuinely has that
    // exact company+branch+id combination — a payment can never attach
    // to another branch's (or company's) sale, enforced by Postgres
    // itself, not just application code.
    unique('sales_company_branch_id_uq').on(table.companyId, table.branchId, table.id),
    unique('sales_company_branch_number_uq').on(table.companyId, table.branchId, table.saleNumber),
    foreignKey({
      columns: [table.companyId, table.branchId],
      foreignColumns: [branches.companyId, branches.id],
      name: 'sales_branch_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.deviceId],
      foreignColumns: [devices.companyId, devices.id],
      name: 'sales_device_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.branchId, table.cashRegisterId],
      foreignColumns: [cashRegisters.companyId, cashRegisters.branchId, cashRegisters.id],
      name: 'sales_cash_register_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.branchId, table.cashSessionId],
      foreignColumns: [cashSessions.companyId, cashSessions.branchId, cashSessions.id],
      name: 'sales_cash_session_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.createdBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'sales_created_by_membership_fk',
    }).onDelete('restrict'),
    index('sales_company_branch_idx').on(table.companyId, table.branchId),
    index('sales_company_status_idx').on(table.companyId, table.status),
    check('sales_number_nonblank_ck', sql`length(btrim(${table.saleNumber})) > 0`),
    check('sales_currency_code_ck', sql`${table.currencyCode} ~ '^[A-Z]{3}$'`),
    check(
      'sales_status_ck',
      sql`${table.status} in ('draft', 'pending_payment', 'completed', 'cancelled', 'rejected')`,
    ),
    check('sales_subtotal_ck', sql`${table.subtotal} >= 0`),
    check('sales_discount_total_ck', sql`${table.discountTotal} >= 0`),
    check('sales_tax_total_ck', sql`${table.taxTotal} >= 0`),
    check('sales_total_ck', sql`${table.total} >= 0`),
    check('sales_paid_total_ck', sql`${table.paidTotal} >= 0`),
    check('sales_change_total_ck', sql`${table.changeTotal} >= 0`),
    check(
      'sales_arithmetic_ck',
      sql`${table.total} = ${table.subtotal} - ${table.discountTotal} + ${table.taxTotal}`,
    ),
    check(
      'sales_completed_at_ck',
      sql`${table.status} <> 'completed' or ${table.completedAt} is not null`,
    ),
    check(
      'sales_cancelled_at_ck',
      sql`${table.status} <> 'cancelled' or (${table.cancelledAt} is not null and ${table.cancelledBy} is not null)`,
    ),
    check('sales_version_ck', sql`${table.version} >= 1`),
  ],
);

/** Immutable commercial snapshot of one sold line — §6.6 `sale_items`.
 * `product_id` is nullable (a product may later be deleted or retired;
 * the sale's own history must never depend on it still existing), but
 * when present is a real scoped FK — never a fabricated reference.
 * §6.6's own field list has no `product_variant_id` on this table, and
 * the *commercial* snapshot fields (`sku_snapshot`/`name_snapshot`/
 * `unit_price`) genuinely don't need one — they are frozen at sale time
 * and never re-read from the variant again.
 *
 * TASK 12.6 adds `product_variant_id` anyway, for a different reason:
 * inventory-consumption posting (`inventory_movement_lines.product_variant_id`
 * is a required, non-nullable FK) needs a durable, *reproducible* variant
 * identity for each sold line, not a convenience field. `product_id`
 * alone is not safe for that: `resolveProductLines` resolves *today's*
 * default variant, and while every product in this domain happens to
 * have exactly one variant today, the schema itself allows a product to
 * carry several (`ProductCatalogService.createVariant`) with the
 * "default" reassignable over time (`product_variants_product_default_active_uq`
 * only enforces *one active default at a time*, not that it never
 * changes) — so re-deriving "the variant" from `product_id` at a later
 * posting moment is not guaranteed to reproduce the exact variant that
 * was actually resolved and priced at sale-creation time. Storing the
 * resolved variant id at that same moment (`resolveProductLines` now
 * also returns it — see `sales.repository.ts`) closes that gap.
 * Nullable, mirroring `product_id`'s own nullability (a variant may
 * later be retired), and never used to re-derive `sku_snapshot`/
 * `name_snapshot`/`unit_price`, all of which remain the sale's own
 * frozen commercial snapshot — display-facing history is unaffected by
 * this column's addition. */
export const saleItems = pgTable(
  'sale_items',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').notNull(),
    saleId: uuid('sale_id').notNull(),
    lineNumber: integer('line_number').notNull(),
    productId: uuid('product_id'),
    productVariantId: uuid('product_variant_id'),
    productVersion: bigint('product_version', { mode: 'bigint' }),
    skuSnapshot: text('sku_snapshot'),
    nameSnapshot: text('name_snapshot').notNull(),
    quantity: numeric('quantity', { precision: 19, scale: 6 }).notNull(),
    unitPrice: numeric('unit_price', { precision: 19, scale: 4 }).notNull(),
    subtotal: numeric('subtotal', { precision: 19, scale: 4 }).notNull(),
    discountTotal: numeric('discount_total', { precision: 19, scale: 4 }).notNull().default(sql`0`),
    taxTotal: numeric('tax_total', { precision: 19, scale: 4 }).notNull(),
    lineTotal: numeric('line_total', { precision: 19, scale: 4 }).notNull(),
    taxSnapshot: jsonb('tax_snapshot').$type<Readonly<Record<string, unknown>>>(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    unique('sale_items_company_id_id_uq').on(table.companyId, table.id),
    unique('sale_items_sale_line_uq').on(table.companyId, table.saleId, table.lineNumber),
    foreignKey({
      columns: [table.companyId, table.saleId],
      foreignColumns: [sales.companyId, sales.id],
      name: 'sale_items_sale_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.productId],
      foreignColumns: [products.companyId, products.id],
      name: 'sale_items_product_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.productVariantId],
      foreignColumns: [productVariants.companyId, productVariants.id],
      name: 'sale_items_product_variant_scope_fk',
    }).onDelete('restrict'),
    index('sale_items_sale_idx').on(table.companyId, table.saleId),
    check('sale_items_line_number_ck', sql`${table.lineNumber} >= 1`),
    check('sale_items_quantity_ck', sql`${table.quantity} > 0`),
    check('sale_items_unit_price_ck', sql`${table.unitPrice} >= 0`),
    check('sale_items_subtotal_ck', sql`${table.subtotal} >= 0`),
    check('sale_items_tax_total_ck', sql`${table.taxTotal} >= 0`),
    check('sale_items_line_total_ck', sql`${table.lineTotal} >= 0`),
    check('sale_items_name_nonblank_ck', sql`length(btrim(${table.nameSnapshot})) > 0`),
    check(
      'sale_items_tax_snapshot_object_ck',
      sql`${table.taxSnapshot} is null or jsonb_typeof(${table.taxSnapshot}) = 'object'`,
    ),
  ],
);

export type Sale = typeof sales.$inferSelect;
export type SaleItem = typeof saleItems.$inferSelect;
