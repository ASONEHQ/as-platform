import { sql } from 'drizzle-orm';
import { check, foreignKey, index, numeric, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';

import { companyIdColumn, createdAtColumn, idColumn } from './common.js';
import { companyMemberships } from './identity.js';
import { branches, companies } from './organizations.js';
import { suppliers } from './suppliers.js';

/**
 * TASK 14.3 (Wave 1, Part C) — "Compra Directa," recovered from
 * `docs/LEGACY_FUNCTIONAL_PARITY.md`'s Compras section, which is the
 * ONE purchasing-domain feature the forensic audit confirmed was
 * genuinely end-to-end in the legacy product (unlike its formal
 * Purchase Order workflow, whose own `saveCompra()` discarded the
 * entered line items — deliberately NOT rebuilt in this wave, per the
 * task's own explicit instruction).
 *
 * This is a thin, real commercial record ALONGSIDE a real inventory
 * movement — never a parallel stock-mutation path. `inventoryMovementId`
 * is NOT NULL: a `direct_purchases` row can only ever exist once its
 * companion `inventory_movements` row (movement_type='receipt',
 * reference_type='direct_purchase') has actually been posted — see
 * `PurchasingService.recordDirectPurchase`, which creates both inside a
 * single transaction via the platform's existing, already-proven
 * `InventoryPostingService`. No stock mutation without ledger
 * traceability, per the task's own explicit instruction.
 */
export const directPurchases = pgTable(
  'direct_purchases',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').notNull(),
    // Nullable: a genuine cash-and-carry restock (e.g. a quick grocery
    // run) has no formal supplier record — recovery doc's own note that
    // the legacy's "Proveedor / Tienda" field on this exact flow was
    // free text precisely because a supplier isn't always known/real.
    supplierName: text('supplier_name'),
    // TASK 14.4 (Wave 2, Part C.2) — an optional real link to a
    // `suppliers` row. `supplierName` above remains the frozen,
    // historical SNAPSHOT at purchase time (mirrors `sales.
    // customer_display_name`'s own established precedent) — a later
    // rename/deactivation of the supplier record never rewrites past
    // purchase history. When `supplierId` is set, `supplierName` is
    // populated from that supplier's real name at write time, never
    // re-derived live on read.
    supplierId: uuid('supplier_id'),
    productVariantId: uuid('product_variant_id').notNull(),
    quantity: numeric('quantity', { precision: 19, scale: 6 }).notNull(),
    unitCost: numeric('unit_cost', { precision: 19, scale: 4 }).notNull(),
    currencyCode: text('currency_code').notNull(),
    totalCost: numeric('total_cost', { precision: 19, scale: 4 }).notNull(),
    purchaseDate: text('purchase_date').notNull(),
    notes: text('notes'),
    inventoryMovementId: uuid('inventory_movement_id').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    unique('direct_purchases_company_id_id_uq').on(table.companyId, table.id),
    // The database-level idempotency guarantee — a second direct
    // purchase can never silently double-post the same inventory
    // movement, mirroring `inventory_movements_sale_reference_uq`'s own
    // established pattern.
    unique('direct_purchases_movement_uq').on(table.companyId, table.inventoryMovementId),
    foreignKey({
      columns: [table.companyId, table.branchId],
      foreignColumns: [branches.companyId, branches.id],
      name: 'direct_purchases_branch_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.supplierId],
      foreignColumns: [suppliers.companyId, suppliers.id],
      name: 'direct_purchases_supplier_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.createdBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'direct_purchases_created_by_membership_fk',
    }).onDelete('restrict'),
    index('direct_purchases_company_branch_idx').on(table.companyId, table.branchId),
    index('direct_purchases_company_variant_idx').on(table.companyId, table.productVariantId),
    index('direct_purchases_company_supplier_idx').on(table.companyId, table.supplierId),
    check('direct_purchases_quantity_positive_ck', sql`${table.quantity} > 0`),
    check('direct_purchases_unit_cost_nonnegative_ck', sql`${table.unitCost} >= 0`),
    check('direct_purchases_currency_code_ck', sql`${table.currencyCode} ~ '^[A-Z]{3}$'`),
    check('direct_purchases_total_cost_nonnegative_ck', sql`${table.totalCost} >= 0`),
  ],
);

export type DirectPurchase = typeof directPurchases.$inferSelect;
export type NewDirectPurchase = typeof directPurchases.$inferInsert;
