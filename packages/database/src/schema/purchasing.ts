import { sql } from 'drizzle-orm';
import {
  bigint,
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

import { productVariants } from './catalog.js';
import { companyIdColumn, createdAtColumn, idColumn, updatedAtColumn } from './common.js';
import { companyMemberships } from './identity.js';
import { inventoryMovements } from './inventory.js';
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

export const purchaseOrderStatuses = [
  'draft',
  'submitted',
  'partially_received',
  'received',
  'cancelled',
] as const;

/**
 * TASK 12.2 — the formal Purchase Order workflow, deliberately NOT built
 * alongside `direct_purchases` (TASK 14.3) — see that table's own doc
 * comment for why the legacy `saveCompra()` PO flow was explicitly
 * excluded from that wave. This is a genuinely separate commercial
 * record with its own multi-status lifecycle (draft → submitted →
 * partially_received/received, or cancelled from any of the first
 * three) — mirroring `inventory_transfers`'s own established lifecycle
 * pattern exactly: a `status` text column, a per-status timestamp/actor
 * pair for each transition, a `_lifecycle_ck` tying them all together,
 * and a `version` bigint column for optimistic concurrency (used by the
 * HTTP layer's own `If-Match`/ETag convention, same as
 * `inventory_transfers`/`inventory_movements`).
 *
 * Deliberately only ONE receiving event per PO (see
 * `purchase-order-receipt.ts`'s own doc comment) — `inventory_transfers`,
 * the most mature comparable feature in this codebase, likewise never
 * supports genuine multi-event partial receiving, so a PO that lands on
 * `partially_received` is terminal: it can only be cancelled afterward,
 * never received again. That specific restraint is enforced by the
 * SERVICE layer's transition guard (which knows the PRIOR state a
 * transition came from), not by this table's own CHECK constraint alone
 * — a raw CHECK cannot express "only from status X", only "the current
 * row's columns are internally consistent for whatever status it holds
 * right now".
 */
export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').notNull(),
    // `PO-<32 lowercase hex chars>` — generated at the SERVICE layer from
    // the row's own `id`, exactly like `ITR-`/`IMV-`/`SALE-` elsewhere in
    // this codebase (see `PurchaseOrdersService.createPurchaseOrder`).
    // Never a separately-coordinated sequence.
    orderNumber: text('order_number').notNull(),
    status: text('status').notNull().default('draft'),
    // Nullable, frozen snapshot — same pattern as `direct_purchases.
    // supplierName`/`supplierId` (see that table's own doc comment for
    // the full "freeze the name at write time when linked" rationale,
    // mirrored exactly here by `PurchaseOrdersService`).
    supplierName: text('supplier_name'),
    supplierId: uuid('supplier_id'),
    orderDate: text('order_date').notNull(),
    expectedDate: text('expected_date'),
    currencyCode: text('currency_code').notNull(),
    // Sum of `purchase_order_lines.line_total` — recomputed server-side on
    // every write that can affect it, never client-supplied.
    totalCost: numeric('total_cost', { precision: 19, scale: 4 }).notNull().default('0'),
    notes: text('notes'),
    submittedAt: timestamp('submitted_at', { withTimezone: true, mode: 'date' }),
    submittedBy: uuid('submitted_by'),
    // Set once, by the single receiving event, regardless of whether that
    // event's outcome is `partially_received` or `received` — this PO
    // design has no second receiving event, so "when receiving happened"
    // is always this one timestamp/actor pair (see this table's own doc
    // comment and `purchase-order-receipt.ts`).
    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' }),
    receivedBy: uuid('received_by'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'date' }),
    cancelledBy: uuid('cancelled_by'),
    receiptMovementId: uuid('receipt_movement_id'),
    version: bigint('version', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
    createdBy: uuid('created_by').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('purchase_orders_company_id_id_uq').on(table.companyId, table.id),
    unique('purchase_orders_company_number_uq').on(table.companyId, table.orderNumber),
    foreignKey({
      columns: [table.companyId, table.branchId],
      foreignColumns: [branches.companyId, branches.id],
      name: 'purchase_orders_branch_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.supplierId],
      foreignColumns: [suppliers.companyId, suppliers.id],
      name: 'purchase_orders_supplier_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.receiptMovementId],
      foreignColumns: [inventoryMovements.companyId, inventoryMovements.id],
      name: 'purchase_orders_receipt_movement_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.createdBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'purchase_orders_created_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.submittedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'purchase_orders_submitted_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.receivedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'purchase_orders_received_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.cancelledBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'purchase_orders_cancelled_by_membership_fk',
    }).onDelete('restrict'),
    index('purchase_orders_company_branch_idx').on(table.companyId, table.branchId),
    index('purchase_orders_company_status_idx').on(table.companyId, table.status),
    index('purchase_orders_company_supplier_idx').on(table.companyId, table.supplierId),
    index('purchase_orders_company_order_date_idx').on(table.companyId, table.orderDate),
    index('purchase_orders_company_receipt_movement_idx').on(
      table.companyId,
      table.receiptMovementId,
    ),
    check('purchase_orders_order_number_nonblank_ck', sql`length(btrim(${table.orderNumber})) > 0`),
    check(
      'purchase_orders_status_ck',
      sql`${table.status} in ('draft','submitted','partially_received','received','cancelled')`,
    ),
    check('purchase_orders_currency_code_ck', sql`${table.currencyCode} ~ '^[A-Z]{3}$'`),
    check('purchase_orders_total_cost_nonnegative_ck', sql`${table.totalCost} >= 0`),
    check('purchase_orders_version_ck', sql`${table.version} >= 1`),
    check(
      'purchase_orders_lifecycle_ck',
      sql`(${table.status} = 'draft'
          and ${table.submittedAt} is null and ${table.submittedBy} is null
          and ${table.receivedAt} is null and ${table.receivedBy} is null
          and ${table.cancelledAt} is null and ${table.cancelledBy} is null
          and ${table.receiptMovementId} is null)
        or (${table.status} = 'submitted'
          and ${table.submittedAt} is not null and ${table.submittedBy} is not null
          and ${table.receivedAt} is null and ${table.receivedBy} is null
          and ${table.cancelledAt} is null and ${table.cancelledBy} is null
          and ${table.receiptMovementId} is null)
        or (${table.status} = 'partially_received'
          and ${table.submittedAt} is not null and ${table.submittedBy} is not null
          and ${table.receivedAt} is not null and ${table.receivedBy} is not null
          and ${table.cancelledAt} is null and ${table.cancelledBy} is null
          and ${table.receiptMovementId} is not null)
        or (${table.status} = 'received'
          and ${table.submittedAt} is not null and ${table.submittedBy} is not null
          and ${table.receivedAt} is not null and ${table.receivedBy} is not null
          and ${table.cancelledAt} is null and ${table.cancelledBy} is null
          and ${table.receiptMovementId} is not null)
        or (${table.status} = 'cancelled'
          and ${table.cancelledAt} is not null and ${table.cancelledBy} is not null
          and (${table.receivedAt} is null) = (${table.receiptMovementId} is null)
          and (${table.receivedBy} is null) = (${table.receiptMovementId} is null))`,
    ),
  ],
);

export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type NewPurchaseOrder = typeof purchaseOrders.$inferInsert;

/**
 * One line per ordered `product_variant_id` within a `purchase_orders`
 * row — mirrors `inventory_transfer_lines`'s own established shape
 * (`requested_quantity`/`shipped_quantity`/`received_quantity` triad,
 * here narrowed to the two this domain needs: `ordered_quantity`/
 * `received_quantity`, since a PO has no separate "shipped" concept of
 * its own). `line_total` is server-computed (`ordered_quantity *
 * unit_cost`), never client-supplied — see
 * `PurchaseOrdersService.createPurchaseOrder`.
 */
export const purchaseOrderLines = pgTable(
  'purchase_order_lines',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    purchaseOrderId: uuid('purchase_order_id').notNull(),
    lineNumber: integer('line_number').notNull(),
    productVariantId: uuid('product_variant_id').notNull(),
    orderedQuantity: numeric('ordered_quantity', { precision: 19, scale: 6 }).notNull(),
    receivedQuantity: numeric('received_quantity', { precision: 19, scale: 6 })
      .notNull()
      .default('0'),
    unitCost: numeric('unit_cost', { precision: 19, scale: 4 }).notNull(),
    // `ordered_quantity * unit_cost`, server-computed — see this table's
    // own doc comment.
    lineTotal: numeric('line_total', { precision: 19, scale: 4 }).notNull(),
    notes: text('notes'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('purchase_order_lines_company_order_line_uq').on(
      table.companyId,
      table.purchaseOrderId,
      table.lineNumber,
    ),
    // No duplicate variant within one PO — same discipline
    // `inventory_transfer_lines_company_transfer_variant_uq` established.
    unique('purchase_order_lines_company_order_variant_uq').on(
      table.companyId,
      table.purchaseOrderId,
      table.productVariantId,
    ),
    foreignKey({
      columns: [table.companyId, table.purchaseOrderId],
      foreignColumns: [purchaseOrders.companyId, purchaseOrders.id],
      name: 'purchase_order_lines_order_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.productVariantId],
      foreignColumns: [productVariants.companyId, productVariants.id],
      name: 'purchase_order_lines_variant_scope_fk',
    }).onDelete('restrict'),
    index('purchase_order_lines_order_idx').on(table.companyId, table.purchaseOrderId),
    index('purchase_order_lines_variant_idx').on(table.companyId, table.productVariantId),
    check('purchase_order_lines_line_number_ck', sql`${table.lineNumber} >= 1`),
    check('purchase_order_lines_ordered_quantity_ck', sql`${table.orderedQuantity} > 0`),
    check(
      'purchase_order_lines_received_quantity_ck',
      sql`${table.receivedQuantity} >= 0 and ${table.receivedQuantity} <= ${table.orderedQuantity}`,
    ),
    check('purchase_order_lines_unit_cost_nonnegative_ck', sql`${table.unitCost} >= 0`),
    check('purchase_order_lines_line_total_nonnegative_ck', sql`${table.lineTotal} >= 0`),
  ],
);

export type PurchaseOrderLine = typeof purchaseOrderLines.$inferSelect;
export type NewPurchaseOrderLine = typeof purchaseOrderLines.$inferInsert;
