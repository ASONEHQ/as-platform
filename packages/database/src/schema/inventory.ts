import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
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
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { productVariants, unitsOfMeasure } from './catalog.js';
import { companyIdColumn, createdAtColumn, idColumn, updatedAtColumn } from './common.js';
import { companyMemberships } from './identity.js';
import { branches, companies } from './organizations.js';

export const inventoryLocationTypes = [
  'main',
  'sales_floor',
  'cafeteria',
  'event_storage',
  'damaged',
  'returns',
  'transit',
  'virtual',
] as const;

export const inventoryLocationStatuses = ['active', 'inactive', 'retired'] as const;

export const inventoryMovementTypes = [
  'opening_balance',
  'receipt',
  'issue',
  'return',
  'adjustment',
  'transfer_shipment',
  'transfer_receipt',
  'reversal',
] as const;

export const inventoryMovementStatuses = [
  'draft',
  'pending',
  'posted',
  'cancelled',
  'reversed',
] as const;

export const inventoryQuantityPrecision = 19;
export const inventoryQuantityScale = 6;
export const inventoryCostPrecision = 19;
export const inventoryCostScale = 4;

export const inventoryLocations = pgTable(
  'inventory_locations',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').notNull(),
    code: varchar('code', { length: 64 }).notNull(),
    normalizedCode: varchar('normalized_code', { length: 64 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    description: varchar('description', { length: 1000 }),
    locationType: text('location_type').notNull(),
    status: text('status').notNull().default('active'),
    allowsReceiving: boolean('allows_receiving').notNull().default(true),
    allowsIssuing: boolean('allows_issuing').notNull().default(true),
    isDefault: boolean('is_default').notNull().default(false),
    version: bigint('version', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
    createdBy: uuid('created_by').notNull(),
    updatedBy: uuid('updated_by').notNull(),
  },
  (table) => [
    unique('inventory_locations_company_id_id_uq').on(table.companyId, table.id),
    unique('inventory_locations_company_branch_id_id_uq').on(
      table.companyId,
      table.branchId,
      table.id,
    ),
    uniqueIndex('inventory_locations_company_branch_code_active_uq')
      .on(table.companyId, table.branchId, table.normalizedCode)
      .where(sql`${table.status} <> 'retired' and ${table.deletedAt} is null`),
    uniqueIndex('inventory_locations_company_branch_default_active_uq')
      .on(table.companyId, table.branchId)
      .where(
        sql`${table.isDefault} is true and ${table.status} = 'active' and ${table.deletedAt} is null`,
      ),
    foreignKey({
      columns: [table.companyId, table.branchId],
      foreignColumns: [branches.companyId, branches.id],
      name: 'inventory_locations_branch_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.createdBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'inventory_locations_created_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.updatedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'inventory_locations_updated_by_membership_fk',
    }).onDelete('restrict'),
    index('inventory_locations_company_idx').on(table.companyId),
    index('inventory_locations_branch_idx').on(table.companyId, table.branchId),
    index('inventory_locations_company_status_idx').on(table.companyId, table.status),
    index('inventory_locations_company_type_idx').on(table.companyId, table.locationType),
    index('inventory_locations_company_normalized_code_idx').on(
      table.companyId,
      table.normalizedCode,
    ),
    index('inventory_locations_active_idx')
      .on(table.companyId, table.branchId, table.locationType)
      .where(sql`${table.status} = 'active' and ${table.deletedAt} is null`),
    check('inventory_locations_code_nonblank_ck', sql`length(btrim(${table.code})) > 0`),
    check(
      'inventory_locations_normalized_code_ck',
      sql`length(${table.normalizedCode}) > 0 and ${table.normalizedCode} = lower(btrim(${table.normalizedCode}))`,
    ),
    check('inventory_locations_name_nonblank_ck', sql`length(btrim(${table.name})) > 0`),
    check(
      'inventory_locations_type_ck',
      sql`${table.locationType} in ('main','sales_floor','cafeteria','event_storage','damaged','returns','transit','virtual')`,
    ),
    check('inventory_locations_status_ck', sql`${table.status} in ('active','inactive','retired')`),
    check('inventory_locations_version_ck', sql`${table.version} >= 1`),
    check(
      'inventory_locations_retirement_ck',
      sql`(${table.status} = 'retired' and ${table.deletedAt} is not null)
        or (${table.status} <> 'retired' and ${table.deletedAt} is null)`,
    ),
    check(
      'inventory_locations_direction_flags_ck',
      sql`(${table.status} = 'active' or (not ${table.allowsReceiving} and not ${table.allowsIssuing}))
        and (${table.locationType} <> 'virtual' or (not ${table.allowsReceiving} and not ${table.allowsIssuing}))`,
    ),
    check(
      'inventory_locations_default_active_ck',
      sql`not ${table.isDefault} or (${table.status} = 'active' and ${table.deletedAt} is null)`,
    ),
  ],
);

export const inventoryMovements = pgTable(
  'inventory_movements',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').notNull(),
    movementNumber: varchar('movement_number', { length: 64 }).notNull(),
    movementType: text('movement_type').notNull(),
    status: text('status').notNull().default('draft'),
    reasonCode: varchar('reason_code', { length: 64 }),
    referenceType: varchar('reference_type', { length: 64 }),
    referenceId: uuid('reference_id'),
    sourceDocumentNumber: varchar('source_document_number', { length: 128 }),
    notes: varchar('notes', { length: 2000 }),
    version: bigint('version', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
    postedAt: timestamp('posted_at', { withTimezone: true, mode: 'date' }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'date' }),
    reversedAt: timestamp('reversed_at', { withTimezone: true, mode: 'date' }),
    reversalOfMovementId: uuid('reversal_of_movement_id'),
    reversedByMovementId: uuid('reversed_by_movement_id'),
    createdBy: uuid('created_by').notNull(),
    updatedBy: uuid('updated_by'),
    postedBy: uuid('posted_by'),
    cancelledBy: uuid('cancelled_by'),
    reversedBy: uuid('reversed_by'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('inventory_movements_company_id_id_uq').on(table.companyId, table.id),
    unique('inventory_movements_company_number_uq').on(table.companyId, table.movementNumber),
    uniqueIndex('inventory_movements_reversal_of_posted_uq')
      .on(table.companyId, table.reversalOfMovementId)
      .where(
        sql`${table.reversalOfMovementId} is not null and ${table.status} in ('posted','reversed')`,
      ),
    foreignKey({
      columns: [table.companyId, table.branchId],
      foreignColumns: [branches.companyId, branches.id],
      name: 'inventory_movements_branch_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.reversalOfMovementId],
      foreignColumns: [table.companyId, table.id],
      name: 'inventory_movements_reversal_of_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.reversedByMovementId],
      foreignColumns: [table.companyId, table.id],
      name: 'inventory_movements_reversed_by_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.createdBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'inventory_movements_created_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.updatedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'inventory_movements_updated_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.postedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'inventory_movements_posted_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.cancelledBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'inventory_movements_cancelled_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.reversedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'inventory_movements_reversed_by_membership_fk',
    }).onDelete('restrict'),
    index('inventory_movements_company_idx').on(table.companyId),
    index('inventory_movements_branch_idx').on(table.companyId, table.branchId),
    index('inventory_movements_company_type_idx').on(table.companyId, table.movementType),
    index('inventory_movements_company_status_idx').on(table.companyId, table.status),
    index('inventory_movements_company_occurred_idx').on(
      table.companyId,
      table.occurredAt,
      table.id,
    ),
    index('inventory_movements_company_posted_idx').on(table.companyId, table.postedAt),
    index('inventory_movements_company_reference_idx').on(
      table.companyId,
      table.referenceType,
      table.referenceId,
    ),
    index('inventory_movements_reversal_of_idx').on(table.companyId, table.reversalOfMovementId),
    index('inventory_movements_company_created_idx').on(table.companyId, table.createdAt),
    index('inventory_movements_open_idx')
      .on(table.companyId, table.branchId, table.status)
      .where(sql`${table.status} in ('draft','pending')`),
    index('inventory_movements_posted_date_idx')
      .on(table.companyId, table.branchId, table.postedAt)
      .where(sql`${table.status} in ('posted','reversed')`),
    index('inventory_movements_unreversed_posted_idx')
      .on(table.companyId, table.id)
      .where(sql`${table.status} = 'posted' and ${table.reversedByMovementId} is null`),
    check(
      'inventory_movements_number_nonblank_ck',
      sql`length(btrim(${table.movementNumber})) > 0`,
    ),
    check(
      'inventory_movements_type_ck',
      sql`${table.movementType} in ('opening_balance','receipt','issue','return','adjustment','transfer_shipment','transfer_receipt','reversal')`,
    ),
    check(
      'inventory_movements_status_ck',
      sql`${table.status} in ('draft','pending','posted','cancelled','reversed')`,
    ),
    check('inventory_movements_version_ck', sql`${table.version} >= 1`),
    check(
      'inventory_movements_reference_pair_ck',
      sql`(${table.referenceType} is null) = (${table.referenceId} is null)`,
    ),
    check(
      'inventory_movements_reversal_type_ck',
      sql`(${table.movementType} = 'reversal') = (${table.reversalOfMovementId} is not null)`,
    ),
    check(
      'inventory_movements_not_self_reversal_ck',
      sql`(${table.reversalOfMovementId} is null or ${table.reversalOfMovementId} <> ${table.id})
        and (${table.reversedByMovementId} is null or ${table.reversedByMovementId} <> ${table.id})`,
    ),
    check(
      'inventory_movements_lifecycle_ck',
      sql`(${table.status} in ('draft','pending')
          and ${table.postedAt} is null and ${table.postedBy} is null
          and ${table.cancelledAt} is null and ${table.cancelledBy} is null
          and ${table.reversedAt} is null and ${table.reversedBy} is null
          and ${table.reversedByMovementId} is null)
        or (${table.status} = 'posted'
          and ${table.postedAt} is not null and ${table.postedBy} is not null
          and ${table.cancelledAt} is null and ${table.cancelledBy} is null
          and ${table.reversedAt} is null and ${table.reversedBy} is null
          and ${table.reversedByMovementId} is null)
        or (${table.status} = 'cancelled'
          and ${table.postedAt} is null and ${table.postedBy} is null
          and ${table.cancelledAt} is not null and ${table.cancelledBy} is not null
          and ${table.reversedAt} is null and ${table.reversedBy} is null
          and ${table.reversedByMovementId} is null)
        or (${table.status} = 'reversed'
          and ${table.postedAt} is not null and ${table.postedBy} is not null
          and ${table.cancelledAt} is null and ${table.cancelledBy} is null
          and ${table.reversedAt} is not null and ${table.reversedBy} is not null
          and ${table.reversedByMovementId} is not null)`,
    ),
  ],
);

export const inventoryBalances = pgTable(
  'inventory_balances',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').notNull(),
    inventoryLocationId: uuid('inventory_location_id').notNull(),
    productVariantId: uuid('product_variant_id').notNull(),
    quantityOnHand: numeric('quantity_on_hand', {
      precision: inventoryQuantityPrecision,
      scale: inventoryQuantityScale,
    })
      .notNull()
      .default('0'),
    quantityReserved: numeric('quantity_reserved', {
      precision: inventoryQuantityPrecision,
      scale: inventoryQuantityScale,
    })
      .notNull()
      .default('0'),
    quantityInTransit: numeric('quantity_in_transit', {
      precision: inventoryQuantityPrecision,
      scale: inventoryQuantityScale,
    })
      .notNull()
      .default('0'),
    averageUnitCost: numeric('average_unit_cost', {
      precision: inventoryCostPrecision,
      scale: inventoryCostScale,
    })
      .notNull()
      .default('0'),
    currencyCode: char('currency_code', { length: 3 }),
    version: bigint('version', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
    lastMovementId: uuid('last_movement_id'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('inventory_balances_company_location_variant_uq').on(
      table.companyId,
      table.inventoryLocationId,
      table.productVariantId,
    ),
    foreignKey({
      columns: [table.companyId, table.branchId, table.inventoryLocationId],
      foreignColumns: [
        inventoryLocations.companyId,
        inventoryLocations.branchId,
        inventoryLocations.id,
      ],
      name: 'inventory_balances_location_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.productVariantId],
      foreignColumns: [productVariants.companyId, productVariants.id],
      name: 'inventory_balances_variant_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.lastMovementId],
      foreignColumns: [inventoryMovements.companyId, inventoryMovements.id],
      name: 'inventory_balances_last_movement_scope_fk',
    }).onDelete('restrict'),
    index('inventory_balances_company_variant_idx').on(table.companyId, table.productVariantId),
    index('inventory_balances_company_location_idx').on(table.companyId, table.inventoryLocationId),
    index('inventory_balances_branch_idx').on(table.companyId, table.branchId),
    index('inventory_balances_availability_idx').on(
      table.companyId,
      table.branchId,
      sql`(${table.quantityOnHand} - ${table.quantityReserved})`,
    ),
    index('inventory_balances_updated_idx').on(table.companyId, table.updatedAt),
    index('inventory_balances_last_movement_idx').on(table.companyId, table.lastMovementId),
    check('inventory_balances_on_hand_ck', sql`${table.quantityOnHand} >= 0`),
    check('inventory_balances_reserved_ck', sql`${table.quantityReserved} >= 0`),
    check('inventory_balances_in_transit_ck', sql`${table.quantityInTransit} >= 0`),
    check(
      'inventory_balances_reserved_on_hand_ck',
      sql`${table.quantityReserved} <= ${table.quantityOnHand}`,
    ),
    check('inventory_balances_average_cost_ck', sql`${table.averageUnitCost} >= 0`),
    check(
      'inventory_balances_currency_ck',
      sql`(${table.averageUnitCost} = 0 and ${table.currencyCode} is null)
        or (${table.currencyCode} is not null and ${table.currencyCode} ~ '^[A-Z]{3}$')`,
    ),
    check('inventory_balances_version_ck', sql`${table.version} >= 1`),
  ],
);

export const inventoryMovementLines = pgTable(
  'inventory_movement_lines',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    inventoryMovementId: uuid('inventory_movement_id').notNull(),
    lineNumber: integer('line_number').notNull(),
    productVariantId: uuid('product_variant_id').notNull(),
    sourceLocationId: uuid('source_location_id'),
    destinationLocationId: uuid('destination_location_id'),
    quantity: numeric('quantity', {
      precision: inventoryQuantityPrecision,
      scale: inventoryQuantityScale,
    }).notNull(),
    unitOfMeasureCode: text('unit_of_measure_code')
      .notNull()
      .references(() => unitsOfMeasure.code, { onDelete: 'restrict' }),
    baseQuantity: numeric('base_quantity', {
      precision: inventoryQuantityPrecision,
      scale: inventoryQuantityScale,
    }).notNull(),
    unitCost: numeric('unit_cost', {
      precision: inventoryCostPrecision,
      scale: inventoryCostScale,
    }),
    extendedCost: numeric('extended_cost', {
      precision: inventoryCostPrecision,
      scale: inventoryCostScale,
    }),
    currencyCode: char('currency_code', { length: 3 }),
    reasonCode: varchar('reason_code', { length: 64 }),
    metadata: jsonb('metadata').$type<Readonly<Record<string, unknown>>>(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    unique('inventory_movement_lines_company_movement_line_uq').on(
      table.companyId,
      table.inventoryMovementId,
      table.lineNumber,
    ),
    foreignKey({
      columns: [table.companyId, table.inventoryMovementId],
      foreignColumns: [inventoryMovements.companyId, inventoryMovements.id],
      name: 'inventory_movement_lines_movement_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.productVariantId],
      foreignColumns: [productVariants.companyId, productVariants.id],
      name: 'inventory_movement_lines_variant_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.sourceLocationId],
      foreignColumns: [inventoryLocations.companyId, inventoryLocations.id],
      name: 'inventory_movement_lines_source_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.destinationLocationId],
      foreignColumns: [inventoryLocations.companyId, inventoryLocations.id],
      name: 'inventory_movement_lines_destination_scope_fk',
    }).onDelete('restrict'),
    index('inventory_movement_lines_movement_idx').on(table.companyId, table.inventoryMovementId),
    index('inventory_movement_lines_variant_idx').on(table.companyId, table.productVariantId),
    index('inventory_movement_lines_source_idx').on(table.companyId, table.sourceLocationId),
    index('inventory_movement_lines_destination_idx').on(
      table.companyId,
      table.destinationLocationId,
    ),
    check('inventory_movement_lines_line_number_ck', sql`${table.lineNumber} >= 1`),
    check('inventory_movement_lines_quantity_ck', sql`${table.quantity} > 0`),
    check('inventory_movement_lines_base_quantity_ck', sql`${table.baseQuantity} > 0`),
    check(
      'inventory_movement_lines_direction_ck',
      sql`(${table.sourceLocationId} is not null or ${table.destinationLocationId} is not null)
        and (${table.sourceLocationId} is null or ${table.destinationLocationId} is null or ${table.sourceLocationId} <> ${table.destinationLocationId})`,
    ),
    check(
      'inventory_movement_lines_cost_ck',
      sql`${table.unitCost} is null or ${table.unitCost} >= 0`,
    ),
    check(
      'inventory_movement_lines_extended_cost_ck',
      sql`${table.extendedCost} is null or ${table.extendedCost} >= 0`,
    ),
    check(
      'inventory_movement_lines_cost_currency_ck',
      sql`(${table.unitCost} is null and ${table.extendedCost} is null and ${table.currencyCode} is null)
        or (${table.unitCost} is not null and ${table.extendedCost} is not null and ${table.currencyCode} ~ '^[A-Z]{3}$')`,
    ),
    check(
      'inventory_movement_lines_metadata_ck',
      sql`${table.metadata} is null
        or (jsonb_typeof(${table.metadata}) = 'object' and octet_length(${table.metadata}::text) <= 8192)`,
    ),
  ],
);

export type InventoryLocation = typeof inventoryLocations.$inferSelect;
export type NewInventoryLocation = typeof inventoryLocations.$inferInsert;
export type InventoryBalance = typeof inventoryBalances.$inferSelect;
export type NewInventoryBalance = typeof inventoryBalances.$inferInsert;
export type InventoryMovement = typeof inventoryMovements.$inferSelect;
export type NewInventoryMovement = typeof inventoryMovements.$inferInsert;
export type InventoryMovementLine = typeof inventoryMovementLines.$inferSelect;
export type NewInventoryMovementLine = typeof inventoryMovementLines.$inferInsert;
