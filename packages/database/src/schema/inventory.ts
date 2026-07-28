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

export const inventoryTransferStatuses = [
  'requested',
  'approved',
  'shipped',
  'partially_received',
  'received',
  'rejected',
  'cancelled',
  'remainder_rejected',
] as const;

export const inventoryReservationStatuses = [
  'active',
  'confirmed',
  'released',
  'expired',
  'cancelled',
] as const;

export const inventoryReservationOwnerTypes = ['pos_cart', 'event', 'booking', 'order'] as const;

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

export const inventoryTransfers = pgTable(
  'inventory_transfers',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    transferNumber: varchar('transfer_number', { length: 64 }).notNull(),
    status: text('status').notNull().default('requested'),
    sourceBranchId: uuid('source_branch_id').notNull(),
    destinationBranchId: uuid('destination_branch_id').notNull(),
    sourceLocationId: uuid('source_location_id').notNull(),
    destinationLocationId: uuid('destination_location_id').notNull(),
    transitLocationId: uuid('transit_location_id'),
    requestedAt: timestamp('requested_at', { withTimezone: true, mode: 'date' }).notNull(),
    approvedAt: timestamp('approved_at', { withTimezone: true, mode: 'date' }),
    shippedAt: timestamp('shipped_at', { withTimezone: true, mode: 'date' }),
    firstReceivedAt: timestamp('first_received_at', { withTimezone: true, mode: 'date' }),
    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' }),
    rejectedAt: timestamp('rejected_at', { withTimezone: true, mode: 'date' }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'date' }),
    remainderRejectedAt: timestamp('remainder_rejected_at', {
      withTimezone: true,
      mode: 'date',
    }),
    requestedBy: uuid('requested_by').notNull(),
    approvedBy: uuid('approved_by'),
    shippedBy: uuid('shipped_by'),
    receivedBy: uuid('received_by'),
    rejectedBy: uuid('rejected_by'),
    cancelledBy: uuid('cancelled_by'),
    remainderRejectedBy: uuid('remainder_rejected_by'),
    shipmentMovementId: uuid('shipment_movement_id'),
    receiptMovementId: uuid('receipt_movement_id'),
    notes: varchar('notes', { length: 2000 }),
    version: bigint('version', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('inventory_transfers_company_id_id_uq').on(table.companyId, table.id),
    unique('inventory_transfers_company_number_uq').on(table.companyId, table.transferNumber),
    foreignKey({
      columns: [table.companyId, table.sourceBranchId],
      foreignColumns: [branches.companyId, branches.id],
      name: 'inventory_transfers_source_branch_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.destinationBranchId],
      foreignColumns: [branches.companyId, branches.id],
      name: 'inventory_transfers_destination_branch_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.sourceBranchId, table.sourceLocationId],
      foreignColumns: [
        inventoryLocations.companyId,
        inventoryLocations.branchId,
        inventoryLocations.id,
      ],
      name: 'inventory_transfers_source_location_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.destinationBranchId, table.destinationLocationId],
      foreignColumns: [
        inventoryLocations.companyId,
        inventoryLocations.branchId,
        inventoryLocations.id,
      ],
      name: 'inventory_transfers_destination_location_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.destinationBranchId, table.transitLocationId],
      foreignColumns: [
        inventoryLocations.companyId,
        inventoryLocations.branchId,
        inventoryLocations.id,
      ],
      name: 'inventory_transfers_transit_location_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.shipmentMovementId],
      foreignColumns: [inventoryMovements.companyId, inventoryMovements.id],
      name: 'inventory_transfers_shipment_movement_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.receiptMovementId],
      foreignColumns: [inventoryMovements.companyId, inventoryMovements.id],
      name: 'inventory_transfers_receipt_movement_scope_fk',
    }).onDelete('restrict'),
    ...(
      [
        [table.requestedBy, 'requested_by'],
        [table.approvedBy, 'approved_by'],
        [table.shippedBy, 'shipped_by'],
        [table.receivedBy, 'received_by'],
        [table.rejectedBy, 'rejected_by'],
        [table.cancelledBy, 'cancelled_by'],
        [table.remainderRejectedBy, 'remainder_rejected_by'],
      ] as const
    ).map(([actor, name]) =>
      foreignKey({
        columns: [table.companyId, actor],
        foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
        name: `inventory_transfers_${name}_membership_fk`,
      }).onDelete('restrict'),
    ),
    index('inventory_transfers_company_idx').on(table.companyId),
    index('inventory_transfers_company_status_idx').on(table.companyId, table.status),
    index('inventory_transfers_source_branch_idx').on(table.companyId, table.sourceBranchId),
    index('inventory_transfers_destination_branch_idx').on(
      table.companyId,
      table.destinationBranchId,
    ),
    index('inventory_transfers_source_location_idx').on(table.companyId, table.sourceLocationId),
    index('inventory_transfers_destination_location_idx').on(
      table.companyId,
      table.destinationLocationId,
    ),
    index('inventory_transfers_requested_idx').on(table.companyId, table.requestedAt),
    index('inventory_transfers_shipped_idx').on(table.companyId, table.shippedAt),
    index('inventory_transfers_received_idx').on(table.companyId, table.receivedAt),
    index('inventory_transfers_shipment_movement_idx').on(
      table.companyId,
      table.shipmentMovementId,
    ),
    index('inventory_transfers_receipt_movement_idx').on(table.companyId, table.receiptMovementId),
    index('inventory_transfers_open_idx')
      .on(table.companyId, table.status, table.requestedAt)
      .where(sql`${table.status} in ('requested','approved','shipped','partially_received')`),
    index('inventory_transfers_pending_receipt_idx')
      .on(table.companyId, table.destinationBranchId, table.shippedAt)
      .where(sql`${table.status} in ('shipped','partially_received')`),
    check(
      'inventory_transfers_number_nonblank_ck',
      sql`length(btrim(${table.transferNumber})) > 0`,
    ),
    check(
      'inventory_transfers_status_ck',
      sql`${table.status} in ('requested','approved','shipped','partially_received','received','rejected','cancelled','remainder_rejected')`,
    ),
    check(
      'inventory_transfers_locations_different_ck',
      sql`${table.sourceLocationId} <> ${table.destinationLocationId}
        and (${table.transitLocationId} is null
          or (${table.transitLocationId} <> ${table.sourceLocationId}
            and ${table.transitLocationId} <> ${table.destinationLocationId}))`,
    ),
    check(
      'inventory_transfers_movements_different_ck',
      sql`${table.shipmentMovementId} is null or ${table.receiptMovementId} is null
        or ${table.shipmentMovementId} <> ${table.receiptMovementId}`,
    ),
    check('inventory_transfers_version_ck', sql`${table.version} >= 1`),
    check(
      'inventory_transfers_lifecycle_ck',
      sql`(${table.status} = 'requested'
          and ${table.approvedAt} is null and ${table.approvedBy} is null
          and ${table.shippedAt} is null and ${table.shippedBy} is null
          and ${table.firstReceivedAt} is null and ${table.receivedAt} is null and ${table.receivedBy} is null
          and ${table.rejectedAt} is null and ${table.rejectedBy} is null
          and ${table.cancelledAt} is null and ${table.cancelledBy} is null
          and ${table.remainderRejectedAt} is null and ${table.remainderRejectedBy} is null)
        or (${table.status} = 'approved'
          and ${table.approvedAt} is not null and ${table.approvedBy} is not null
          and ${table.shippedAt} is null and ${table.shippedBy} is null
          and ${table.firstReceivedAt} is null and ${table.receivedAt} is null and ${table.receivedBy} is null
          and ${table.rejectedAt} is null and ${table.rejectedBy} is null
          and ${table.cancelledAt} is null and ${table.cancelledBy} is null
          and ${table.remainderRejectedAt} is null and ${table.remainderRejectedBy} is null)
        or (${table.status} = 'shipped'
          and ${table.approvedAt} is not null and ${table.approvedBy} is not null
          and ${table.shippedAt} is not null and ${table.shippedBy} is not null
          and ${table.firstReceivedAt} is null and ${table.receivedAt} is null and ${table.receivedBy} is null
          and ${table.rejectedAt} is null and ${table.rejectedBy} is null
          and ${table.cancelledAt} is null and ${table.cancelledBy} is null
          and ${table.remainderRejectedAt} is null and ${table.remainderRejectedBy} is null)
        or (${table.status} = 'partially_received'
          and ${table.approvedAt} is not null and ${table.approvedBy} is not null
          and ${table.shippedAt} is not null and ${table.shippedBy} is not null
          and ${table.firstReceivedAt} is not null and ${table.receivedAt} is null
          and ${table.rejectedAt} is null and ${table.rejectedBy} is null
          and ${table.cancelledAt} is null and ${table.cancelledBy} is null
          and ${table.remainderRejectedAt} is null and ${table.remainderRejectedBy} is null)
        or (${table.status} = 'received'
          and ${table.approvedAt} is not null and ${table.approvedBy} is not null
          and ${table.shippedAt} is not null and ${table.shippedBy} is not null
          and ${table.firstReceivedAt} is not null and ${table.receivedAt} is not null and ${table.receivedBy} is not null
          and ${table.rejectedAt} is null and ${table.rejectedBy} is null
          and ${table.cancelledAt} is null and ${table.cancelledBy} is null
          and ${table.remainderRejectedAt} is null and ${table.remainderRejectedBy} is null)
        or (${table.status} = 'rejected'
          and ${table.approvedAt} is null and ${table.approvedBy} is null
          and ${table.shippedAt} is null and ${table.shippedBy} is null
          and ${table.firstReceivedAt} is null and ${table.receivedAt} is null and ${table.receivedBy} is null
          and ${table.rejectedAt} is not null and ${table.rejectedBy} is not null
          and ${table.cancelledAt} is null and ${table.cancelledBy} is null
          and ${table.remainderRejectedAt} is null and ${table.remainderRejectedBy} is null)
        or (${table.status} = 'cancelled'
          and ${table.shippedAt} is null and ${table.shippedBy} is null
          and ${table.firstReceivedAt} is null and ${table.receivedAt} is null and ${table.receivedBy} is null
          and ${table.rejectedAt} is null and ${table.rejectedBy} is null
          and ${table.cancelledAt} is not null and ${table.cancelledBy} is not null
          and ${table.remainderRejectedAt} is null and ${table.remainderRejectedBy} is null)
        or (${table.status} = 'remainder_rejected'
          and ${table.approvedAt} is not null and ${table.approvedBy} is not null
          and ${table.shippedAt} is not null and ${table.shippedBy} is not null
          and ${table.firstReceivedAt} is not null and ${table.receivedAt} is null
          and ${table.rejectedAt} is null and ${table.rejectedBy} is null
          and ${table.cancelledAt} is null and ${table.cancelledBy} is null
          and ${table.remainderRejectedAt} is not null and ${table.remainderRejectedBy} is not null)`,
    ),
  ],
);

export const inventoryTransferLines = pgTable(
  'inventory_transfer_lines',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    inventoryTransferId: uuid('inventory_transfer_id').notNull(),
    lineNumber: integer('line_number').notNull(),
    productVariantId: uuid('product_variant_id').notNull(),
    requestedQuantity: numeric('requested_quantity', {
      precision: inventoryQuantityPrecision,
      scale: inventoryQuantityScale,
    }).notNull(),
    shippedQuantity: numeric('shipped_quantity', {
      precision: inventoryQuantityPrecision,
      scale: inventoryQuantityScale,
    })
      .notNull()
      .default('0'),
    receivedQuantity: numeric('received_quantity', {
      precision: inventoryQuantityPrecision,
      scale: inventoryQuantityScale,
    })
      .notNull()
      .default('0'),
    rejectedQuantity: numeric('rejected_quantity', {
      precision: inventoryQuantityPrecision,
      scale: inventoryQuantityScale,
    })
      .notNull()
      .default('0'),
    unitOfMeasureCode: text('unit_of_measure_code')
      .notNull()
      .references(() => unitsOfMeasure.code, { onDelete: 'restrict' }),
    notes: varchar('notes', { length: 2000 }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('inventory_transfer_lines_company_transfer_line_uq').on(
      table.companyId,
      table.inventoryTransferId,
      table.lineNumber,
    ),
    unique('inventory_transfer_lines_company_transfer_variant_uq').on(
      table.companyId,
      table.inventoryTransferId,
      table.productVariantId,
    ),
    foreignKey({
      columns: [table.companyId, table.inventoryTransferId],
      foreignColumns: [inventoryTransfers.companyId, inventoryTransfers.id],
      name: 'inventory_transfer_lines_transfer_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.productVariantId],
      foreignColumns: [productVariants.companyId, productVariants.id],
      name: 'inventory_transfer_lines_variant_scope_fk',
    }).onDelete('restrict'),
    index('inventory_transfer_lines_transfer_idx').on(table.companyId, table.inventoryTransferId),
    index('inventory_transfer_lines_variant_idx').on(table.companyId, table.productVariantId),
    index('inventory_transfer_lines_discrepancy_idx')
      .on(table.companyId, table.inventoryTransferId, table.updatedAt)
      .where(sql`${table.receivedQuantity} + ${table.rejectedQuantity} < ${table.shippedQuantity}`),
    index('inventory_transfer_lines_updated_idx').on(table.companyId, table.updatedAt),
    check('inventory_transfer_lines_line_number_ck', sql`${table.lineNumber} >= 1`),
    check('inventory_transfer_lines_requested_ck', sql`${table.requestedQuantity} > 0`),
    check('inventory_transfer_lines_shipped_ck', sql`${table.shippedQuantity} >= 0`),
    check('inventory_transfer_lines_received_ck', sql`${table.receivedQuantity} >= 0`),
    check('inventory_transfer_lines_rejected_ck', sql`${table.rejectedQuantity} >= 0`),
    check(
      'inventory_transfer_lines_totals_ck',
      sql`${table.shippedQuantity} <= ${table.requestedQuantity}
        and ${table.receivedQuantity} + ${table.rejectedQuantity} <= ${table.shippedQuantity}`,
    ),
  ],
);

export const inventoryReservations = pgTable(
  'inventory_reservations',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').notNull(),
    reservationNumber: varchar('reservation_number', { length: 64 }).notNull(),
    ownerType: varchar('owner_type', { length: 32 }).notNull(),
    ownerId: varchar('owner_id', { length: 128 }).notNull(),
    status: text('status').notNull().default('active'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true, mode: 'date' }),
    releasedAt: timestamp('released_at', { withTimezone: true, mode: 'date' }),
    expiredAt: timestamp('expired_at', { withTimezone: true, mode: 'date' }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'date' }),
    createdBy: uuid('created_by').notNull(),
    confirmedBy: uuid('confirmed_by'),
    releasedBy: uuid('released_by'),
    expiredBy: uuid('expired_by'),
    cancelledBy: uuid('cancelled_by'),
    version: bigint('version', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('inventory_reservations_company_id_id_uq').on(table.companyId, table.id),
    unique('inventory_reservations_company_branch_id_id_uq').on(
      table.companyId,
      table.branchId,
      table.id,
    ),
    unique('inventory_reservations_company_number_uq').on(table.companyId, table.reservationNumber),
    foreignKey({
      columns: [table.companyId, table.branchId],
      foreignColumns: [branches.companyId, branches.id],
      name: 'inventory_reservations_branch_scope_fk',
    }).onDelete('restrict'),
    ...(
      [
        [table.createdBy, 'created_by'],
        [table.confirmedBy, 'confirmed_by'],
        [table.releasedBy, 'released_by'],
        [table.expiredBy, 'expired_by'],
        [table.cancelledBy, 'cancelled_by'],
      ] as const
    ).map(([actor, name]) =>
      foreignKey({
        columns: [table.companyId, actor],
        foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
        name: `inventory_reservations_${name}_membership_fk`,
      }).onDelete('restrict'),
    ),
    index('inventory_reservations_company_idx').on(table.companyId),
    index('inventory_reservations_branch_idx').on(table.companyId, table.branchId),
    index('inventory_reservations_status_idx').on(table.companyId, table.status),
    index('inventory_reservations_owner_idx').on(table.companyId, table.ownerType, table.ownerId),
    index('inventory_reservations_expires_idx').on(table.companyId, table.expiresAt),
    index('inventory_reservations_created_idx').on(table.companyId, table.createdAt),
    index('inventory_reservations_active_idx')
      .on(table.companyId, table.branchId, table.expiresAt)
      .where(sql`${table.status} = 'active'`),
    index('inventory_reservations_expiration_worker_idx')
      .on(table.expiresAt, table.id)
      .where(sql`${table.status} = 'active' and ${table.expiresAt} is not null`),
    check(
      'inventory_reservations_number_nonblank_ck',
      sql`length(btrim(${table.reservationNumber})) > 0`,
    ),
    check(
      'inventory_reservations_owner_type_ck',
      sql`${table.ownerType} in ('pos_cart','event','booking','order')`,
    ),
    check('inventory_reservations_owner_id_ck', sql`length(btrim(${table.ownerId})) > 0`),
    check(
      'inventory_reservations_status_ck',
      sql`${table.status} in ('active','confirmed','released','expired','cancelled')`,
    ),
    check('inventory_reservations_version_ck', sql`${table.version} >= 1`),
    check(
      'inventory_reservations_lifecycle_ck',
      sql`(${table.status} = 'active'
          and ${table.confirmedAt} is null and ${table.confirmedBy} is null
          and ${table.releasedAt} is null and ${table.releasedBy} is null
          and ${table.expiredAt} is null and ${table.expiredBy} is null
          and ${table.cancelledAt} is null and ${table.cancelledBy} is null)
        or (${table.status} = 'confirmed'
          and ${table.confirmedAt} is not null and ${table.confirmedBy} is not null
          and ${table.releasedAt} is null and ${table.releasedBy} is null
          and ${table.expiredAt} is null and ${table.expiredBy} is null
          and ${table.cancelledAt} is null and ${table.cancelledBy} is null)
        or (${table.status} = 'released'
          and ${table.confirmedAt} is null and ${table.confirmedBy} is null
          and ${table.releasedAt} is not null and ${table.releasedBy} is not null
          and ${table.expiredAt} is null and ${table.expiredBy} is null
          and ${table.cancelledAt} is null and ${table.cancelledBy} is null)
        or (${table.status} = 'expired'
          and ${table.expiresAt} is not null
          and ${table.confirmedAt} is null and ${table.confirmedBy} is null
          and ${table.releasedAt} is null and ${table.releasedBy} is null
          and ${table.expiredAt} is not null and ${table.expiredBy} is not null
          and ${table.cancelledAt} is null and ${table.cancelledBy} is null)
        or (${table.status} = 'cancelled'
          and ${table.confirmedAt} is null and ${table.confirmedBy} is null
          and ${table.releasedAt} is null and ${table.releasedBy} is null
          and ${table.expiredAt} is null and ${table.expiredBy} is null
          and ${table.cancelledAt} is not null and ${table.cancelledBy} is not null)`,
    ),
  ],
);

export const inventoryReservationLines = pgTable(
  'inventory_reservation_lines',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    inventoryReservationId: uuid('inventory_reservation_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    inventoryLocationId: uuid('inventory_location_id').notNull(),
    lineNumber: integer('line_number').notNull(),
    productVariantId: uuid('product_variant_id').notNull(),
    reservedQuantity: numeric('reserved_quantity', {
      precision: inventoryQuantityPrecision,
      scale: inventoryQuantityScale,
    }).notNull(),
    consumedQuantity: numeric('consumed_quantity', {
      precision: inventoryQuantityPrecision,
      scale: inventoryQuantityScale,
    })
      .notNull()
      .default('0'),
    releasedQuantity: numeric('released_quantity', {
      precision: inventoryQuantityPrecision,
      scale: inventoryQuantityScale,
    })
      .notNull()
      .default('0'),
    unitOfMeasureCode: text('unit_of_measure_code')
      .notNull()
      .references(() => unitsOfMeasure.code, { onDelete: 'restrict' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('inventory_reservation_lines_company_reservation_line_uq').on(
      table.companyId,
      table.inventoryReservationId,
      table.lineNumber,
    ),
    unique('inventory_reservation_lines_company_reservation_location_variant_uq').on(
      table.companyId,
      table.inventoryReservationId,
      table.inventoryLocationId,
      table.productVariantId,
    ),
    foreignKey({
      columns: [table.companyId, table.branchId, table.inventoryReservationId],
      foreignColumns: [
        inventoryReservations.companyId,
        inventoryReservations.branchId,
        inventoryReservations.id,
      ],
      name: 'inventory_reservation_lines_reservation_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.productVariantId],
      foreignColumns: [productVariants.companyId, productVariants.id],
      name: 'inventory_reservation_lines_variant_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.branchId, table.inventoryLocationId],
      foreignColumns: [
        inventoryLocations.companyId,
        inventoryLocations.branchId,
        inventoryLocations.id,
      ],
      name: 'inventory_reservation_lines_location_scope_fk',
    }).onDelete('restrict'),
    index('inventory_reservation_lines_reservation_idx').on(
      table.companyId,
      table.inventoryReservationId,
    ),
    index('inventory_reservation_lines_variant_idx').on(table.companyId, table.productVariantId),
    index('inventory_reservation_lines_location_idx').on(
      table.companyId,
      table.inventoryLocationId,
    ),
    index('inventory_reservation_lines_active_quantity_idx')
      .on(table.companyId, table.inventoryLocationId, table.productVariantId)
      .where(
        sql`${table.reservedQuantity} > ${table.consumedQuantity} + ${table.releasedQuantity}`,
      ),
    index('inventory_reservation_lines_updated_idx').on(table.companyId, table.updatedAt),
    check('inventory_reservation_lines_line_number_ck', sql`${table.lineNumber} >= 1`),
    check('inventory_reservation_lines_reserved_ck', sql`${table.reservedQuantity} > 0`),
    check('inventory_reservation_lines_consumed_ck', sql`${table.consumedQuantity} >= 0`),
    check('inventory_reservation_lines_released_ck', sql`${table.releasedQuantity} >= 0`),
    check(
      'inventory_reservation_lines_totals_ck',
      sql`${table.consumedQuantity} + ${table.releasedQuantity} <= ${table.reservedQuantity}`,
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
export type InventoryTransfer = typeof inventoryTransfers.$inferSelect;
export type NewInventoryTransfer = typeof inventoryTransfers.$inferInsert;
export type InventoryTransferLine = typeof inventoryTransferLines.$inferSelect;
export type NewInventoryTransferLine = typeof inventoryTransferLines.$inferInsert;
export type InventoryReservation = typeof inventoryReservations.$inferSelect;
export type NewInventoryReservation = typeof inventoryReservations.$inferInsert;
export type InventoryReservationLine = typeof inventoryReservationLines.$inferSelect;
export type NewInventoryReservationLine = typeof inventoryReservationLines.$inferInsert;
