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

export const inventoryCountStatuses = [
  'draft',
  'counting',
  'submitted',
  'approved',
  'applied',
  'cancelled',
] as const;

export const inventoryCountScopeTypes = ['all_balanced_variants', 'explicit_variants'] as const;

export const inventoryReconciliationFindingTypes = [
  'balance_on_hand_drift',
  'balance_reserved_drift',
  'balance_in_transit_drift',
  'last_movement_mismatch',
  'missing_balance',
  'orphan_balance',
  'invalid_posted_movement',
  'invalid_reversal_relationship',
  'transfer_movement_mismatch',
  'reservation_movement_mismatch',
  'count_application_mismatch',
  'missing_outbox_event',
  'missing_audit_record',
  'unsupported_or_unknown',
] as const;

export const inventoryReconciliationFindingSeverities = ['info', 'warning', 'critical'] as const;

export const inventoryReconciliationFindingStatuses = [
  'open',
  'acknowledged',
  'resolved',
  'dismissed',
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
    unique('inventory_movements_company_branch_id_id_uq').on(
      table.companyId,
      table.branchId,
      table.id,
    ),
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

export const inventoryCounts = pgTable(
  'inventory_counts',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').notNull(),
    inventoryLocationId: uuid('inventory_location_id').notNull(),
    countNumber: varchar('count_number', { length: 36 }).notNull(),
    status: text('status').notNull().default('draft'),
    scopeType: text('scope_type').notNull(),
    scopeDefinition: jsonb('scope_definition').$type<Readonly<Record<string, unknown>>>().notNull(),
    baselineAt: timestamp('baseline_at', { withTimezone: true, mode: 'date' }),
    lockAcquiredAt: timestamp('lock_acquired_at', { withTimezone: true, mode: 'date' }),
    lockExpiresAt: timestamp('lock_expires_at', { withTimezone: true, mode: 'date' }),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    startedBy: uuid('started_by'),
    submittedAt: timestamp('submitted_at', { withTimezone: true, mode: 'date' }),
    submittedBy: uuid('submitted_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true, mode: 'date' }),
    approvedBy: uuid('approved_by'),
    appliedAt: timestamp('applied_at', { withTimezone: true, mode: 'date' }),
    appliedBy: uuid('applied_by'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'date' }),
    cancelledBy: uuid('cancelled_by'),
    applicationMovementId: uuid('application_movement_id'),
    reasonCode: varchar('reason_code', { length: 64 }).notNull(),
    note: varchar('note', { length: 2000 }),
    metadata: jsonb('metadata').$type<Readonly<Record<string, unknown>>>(),
    version: bigint('version', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('inventory_counts_company_id_id_uq').on(table.companyId, table.id),
    unique('inventory_counts_company_branch_id_id_uq').on(
      table.companyId,
      table.branchId,
      table.id,
    ),
    unique('inventory_counts_company_number_uq').on(table.companyId, table.countNumber),
    uniqueIndex('inventory_counts_active_location_uq')
      .on(table.companyId, table.inventoryLocationId)
      .where(sql`${table.status} in ('counting','submitted','approved')`),
    foreignKey({
      columns: [table.companyId, table.branchId],
      foreignColumns: [branches.companyId, branches.id],
      name: 'inventory_counts_branch_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.branchId, table.inventoryLocationId],
      foreignColumns: [
        inventoryLocations.companyId,
        inventoryLocations.branchId,
        inventoryLocations.id,
      ],
      name: 'inventory_counts_location_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.branchId, table.applicationMovementId],
      foreignColumns: [
        inventoryMovements.companyId,
        inventoryMovements.branchId,
        inventoryMovements.id,
      ],
      name: 'inventory_counts_application_movement_scope_fk',
    }).onDelete('restrict'),
    ...(
      [
        [table.startedBy, 'started_by'],
        [table.submittedBy, 'submitted_by'],
        [table.approvedBy, 'approved_by'],
        [table.appliedBy, 'applied_by'],
        [table.cancelledBy, 'cancelled_by'],
      ] as const
    ).map(([actor, name]) =>
      foreignKey({
        columns: [table.companyId, actor],
        foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
        name: `inventory_counts_${name}_membership_fk`,
      }).onDelete('restrict'),
    ),
    index('inventory_counts_company_status_idx').on(table.companyId, table.status),
    index('inventory_counts_branch_status_idx').on(table.companyId, table.branchId, table.status),
    index('inventory_counts_location_status_idx').on(
      table.companyId,
      table.inventoryLocationId,
      table.status,
    ),
    index('inventory_counts_lock_expiry_idx')
      .on(table.lockExpiresAt, table.id)
      .where(sql`${table.status} in ('counting','submitted','approved')`),
    index('inventory_counts_created_idx').on(table.companyId, table.createdAt, table.id),
    check('inventory_counts_number_ck', sql`${table.countNumber} ~ '^CNT-[0-9a-f]{32}$'`),
    check(
      'inventory_counts_status_ck',
      sql`${table.status} in ('draft','counting','submitted','approved','applied','cancelled')`,
    ),
    check(
      'inventory_counts_scope_type_ck',
      sql`${table.scopeType} in ('all_balanced_variants','explicit_variants')`,
    ),
    check(
      'inventory_counts_scope_definition_ck',
      sql`jsonb_typeof(${table.scopeDefinition}) = 'object'`,
    ),
    check('inventory_counts_reason_code_ck', sql`length(btrim(${table.reasonCode})) > 0`),
    check(
      'inventory_counts_metadata_ck',
      sql`${table.metadata} is null or jsonb_typeof(${table.metadata}) = 'object'`,
    ),
    check('inventory_counts_version_ck', sql`${table.version} >= 1`),
    check(
      'inventory_counts_actor_timestamp_pairs_ck',
      sql`(${table.startedAt} is null) = (${table.startedBy} is null)
        and (${table.submittedAt} is null) = (${table.submittedBy} is null)
        and (${table.approvedAt} is null) = (${table.approvedBy} is null)
        and (${table.appliedAt} is null) = (${table.appliedBy} is null)
        and (${table.cancelledAt} is null) = (${table.cancelledBy} is null)`,
    ),
    check(
      'inventory_counts_lock_pair_ck',
      sql`(${table.lockAcquiredAt} is null) = (${table.lockExpiresAt} is null)
        and (${table.lockExpiresAt} is null or ${table.lockExpiresAt} > ${table.lockAcquiredAt})`,
    ),
    check(
      'inventory_counts_lifecycle_ck',
      sql`(${table.status} = 'draft'
          and ${table.baselineAt} is null and ${table.lockAcquiredAt} is null
          and ${table.startedAt} is null and ${table.submittedAt} is null
          and ${table.approvedAt} is null and ${table.appliedAt} is null
          and ${table.cancelledAt} is null and ${table.applicationMovementId} is null)
        or (${table.status} = 'counting'
          and ${table.baselineAt} is not null and ${table.lockAcquiredAt} is not null
          and ${table.startedAt} is not null and ${table.submittedAt} is null
          and ${table.approvedAt} is null and ${table.appliedAt} is null
          and ${table.cancelledAt} is null and ${table.applicationMovementId} is null)
        or (${table.status} = 'submitted'
          and ${table.baselineAt} is not null and ${table.lockAcquiredAt} is not null
          and ${table.startedAt} is not null and ${table.submittedAt} is not null
          and ${table.approvedAt} is null and ${table.appliedAt} is null
          and ${table.cancelledAt} is null and ${table.applicationMovementId} is null)
        or (${table.status} = 'approved'
          and ${table.baselineAt} is not null and ${table.lockAcquiredAt} is not null
          and ${table.startedAt} is not null and ${table.submittedAt} is not null
          and ${table.approvedAt} is not null and ${table.appliedAt} is null
          and ${table.cancelledAt} is null and ${table.applicationMovementId} is null)
        or (${table.status} = 'applied'
          and ${table.baselineAt} is not null and ${table.lockAcquiredAt} is not null
          and ${table.startedAt} is not null and ${table.submittedAt} is not null
          and ${table.approvedAt} is not null and ${table.appliedAt} is not null
          and ${table.cancelledAt} is null)
        or (${table.status} = 'cancelled'
          and ${table.approvedAt} is null and ${table.appliedAt} is null
          and ${table.cancelledAt} is not null and ${table.applicationMovementId} is null)`,
    ),
    check(
      'inventory_counts_application_movement_ck',
      sql`${table.applicationMovementId} is null or ${table.status} = 'applied'`,
    ),
  ],
);

export const inventoryCountLines = pgTable(
  'inventory_count_lines',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').notNull(),
    inventoryCountId: uuid('inventory_count_id').notNull(),
    productVariantId: uuid('product_variant_id').notNull(),
    unitOfMeasureCode: text('unit_of_measure_code')
      .notNull()
      .references(() => unitsOfMeasure.code, { onDelete: 'restrict' }),
    expectedQuantity: numeric('expected_quantity', {
      precision: inventoryQuantityPrecision,
      scale: inventoryQuantityScale,
    }).notNull(),
    countedQuantity: numeric('counted_quantity', {
      precision: inventoryQuantityPrecision,
      scale: inventoryQuantityScale,
    }),
    baselineBalanceVersion: bigint('baseline_balance_version', { mode: 'bigint' }).notNull(),
    baselineLastMovementId: uuid('baseline_last_movement_id'),
    firstCountedAt: timestamp('first_counted_at', { withTimezone: true, mode: 'date' }),
    lastCountedAt: timestamp('last_counted_at', { withTimezone: true, mode: 'date' }),
    countedBy: uuid('counted_by'),
    version: bigint('version', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
    metadata: jsonb('metadata').$type<Readonly<Record<string, unknown>>>(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('inventory_count_lines_company_count_variant_uq').on(
      table.companyId,
      table.inventoryCountId,
      table.productVariantId,
    ),
    foreignKey({
      columns: [table.companyId, table.branchId, table.inventoryCountId],
      foreignColumns: [inventoryCounts.companyId, inventoryCounts.branchId, inventoryCounts.id],
      name: 'inventory_count_lines_count_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.productVariantId],
      foreignColumns: [productVariants.companyId, productVariants.id],
      name: 'inventory_count_lines_variant_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.branchId, table.baselineLastMovementId],
      foreignColumns: [
        inventoryMovements.companyId,
        inventoryMovements.branchId,
        inventoryMovements.id,
      ],
      name: 'inventory_count_lines_baseline_movement_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.countedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'inventory_count_lines_counted_by_membership_fk',
    }).onDelete('restrict'),
    index('inventory_count_lines_count_idx').on(table.companyId, table.inventoryCountId),
    index('inventory_count_lines_variant_idx').on(table.companyId, table.productVariantId),
    index('inventory_count_lines_incomplete_idx')
      .on(table.companyId, table.inventoryCountId)
      .where(sql`${table.countedQuantity} is null`),
    index('inventory_count_lines_baseline_movement_idx').on(
      table.companyId,
      table.baselineLastMovementId,
    ),
    check('inventory_count_lines_expected_ck', sql`${table.expectedQuantity} >= 0`),
    check(
      'inventory_count_lines_counted_ck',
      sql`${table.countedQuantity} is null or ${table.countedQuantity} >= 0`,
    ),
    check('inventory_count_lines_baseline_version_ck', sql`${table.baselineBalanceVersion} >= 1`),
    check('inventory_count_lines_version_ck', sql`${table.version} >= 1`),
    check(
      'inventory_count_lines_metadata_ck',
      sql`${table.metadata} is null or jsonb_typeof(${table.metadata}) = 'object'`,
    ),
    check(
      'inventory_count_lines_counting_evidence_ck',
      sql`(${table.countedQuantity} is null
          and ${table.firstCountedAt} is null and ${table.lastCountedAt} is null and ${table.countedBy} is null)
        or (${table.countedQuantity} is not null
          and ${table.firstCountedAt} is not null and ${table.lastCountedAt} is not null and ${table.countedBy} is not null
          and ${table.lastCountedAt} >= ${table.firstCountedAt})`,
    ),
  ],
);

export const inventoryReconciliationFindings = pgTable(
  'inventory_reconciliation_findings',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id'),
    inventoryLocationId: uuid('inventory_location_id'),
    productVariantId: uuid('product_variant_id'),
    aggregateType: varchar('aggregate_type', { length: 64 }).notNull(),
    aggregateId: varchar('aggregate_id', { length: 128 }).notNull(),
    findingType: varchar('finding_type', { length: 64 }).notNull(),
    severity: varchar('severity', { length: 16 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('open'),
    identityKey: varchar('identity_key', { length: 512 }).notNull(),
    fingerprintSha256: char('fingerprint_sha256', { length: 64 }).notNull(),
    detectorVersion: varchar('detector_version', { length: 64 }).notNull(),
    correlationId: uuid('correlation_id'),
    snapshotAt: timestamp('snapshot_at', { withTimezone: true, mode: 'date' }).notNull(),
    firstDetectedAt: timestamp('first_detected_at', { withTimezone: true, mode: 'date' }).notNull(),
    lastDetectedAt: timestamp('last_detected_at', { withTimezone: true, mode: 'date' }).notNull(),
    occurrenceCount: bigint('occurrence_count', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
    expectedSummary: jsonb('expected_summary').$type<Readonly<Record<string, unknown>>>().notNull(),
    actualSummary: jsonb('actual_summary').$type<Readonly<Record<string, unknown>>>().notNull(),
    evidence: jsonb('evidence').$type<Readonly<Record<string, unknown>>>().notNull(),
    metadata: jsonb('metadata').$type<Readonly<Record<string, unknown>>>(),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true, mode: 'date' }),
    acknowledgedBy: uuid('acknowledged_by'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
    resolvedBy: uuid('resolved_by'),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true, mode: 'date' }),
    dismissedBy: uuid('dismissed_by'),
    resolutionReasonCode: varchar('resolution_reason_code', { length: 64 }),
    resolutionNote: varchar('resolution_note', { length: 1000 }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    version: bigint('version', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
  },
  (table) => [
    unique('inventory_reconciliation_findings_company_id_id_uq').on(table.companyId, table.id),
    uniqueIndex('inventory_reconciliation_findings_active_identity_uq')
      .on(table.companyId, table.identityKey)
      .where(sql`${table.status} in ('open','acknowledged')`),
    foreignKey({
      columns: [table.companyId, table.branchId],
      foreignColumns: [branches.companyId, branches.id],
      name: 'inventory_reconciliation_findings_branch_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.inventoryLocationId],
      foreignColumns: [inventoryLocations.companyId, inventoryLocations.id],
      name: 'inventory_reconciliation_findings_location_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.branchId, table.inventoryLocationId],
      foreignColumns: [
        inventoryLocations.companyId,
        inventoryLocations.branchId,
        inventoryLocations.id,
      ],
      name: 'inventory_reconciliation_findings_branch_location_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.productVariantId],
      foreignColumns: [productVariants.companyId, productVariants.id],
      name: 'inventory_reconciliation_findings_variant_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.acknowledgedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'inventory_reconciliation_findings_acknowledged_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.resolvedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'inventory_reconciliation_findings_resolved_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.dismissedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'inventory_reconciliation_findings_dismissed_by_membership_fk',
    }).onDelete('restrict'),
    index('inventory_reconciliation_findings_company_status_severity_idx').on(
      table.companyId,
      table.status,
      table.severity,
    ),
    index('inventory_reconciliation_findings_company_type_status_idx').on(
      table.companyId,
      table.findingType,
      table.status,
    ),
    index('inventory_reconciliation_findings_company_branch_status_idx').on(
      table.companyId,
      table.branchId,
      table.status,
    ),
    index('inventory_reconciliation_findings_company_location_status_idx').on(
      table.companyId,
      table.inventoryLocationId,
      table.status,
    ),
    index('inventory_reconciliation_findings_company_variant_status_idx').on(
      table.companyId,
      table.productVariantId,
      table.status,
    ),
    index('inventory_reconciliation_findings_company_aggregate_idx').on(
      table.companyId,
      table.aggregateType,
      table.aggregateId,
    ),
    index('inventory_reconciliation_findings_last_detected_idx').on(table.lastDetectedAt),
    index('inventory_reconciliation_findings_snapshot_idx').on(table.snapshotAt),
    index('inventory_reconciliation_findings_detector_version_idx').on(table.detectorVersion),
    index('inventory_reconciliation_findings_open_critical_idx')
      .on(table.companyId, table.lastDetectedAt)
      .where(sql`${table.status} in ('open','acknowledged') and ${table.severity} = 'critical'`),
    check(
      'inventory_reconciliation_findings_aggregate_type_ck',
      sql`length(btrim(${table.aggregateType})) > 0 and ${table.aggregateType} = lower(btrim(${table.aggregateType}))`,
    ),
    check(
      'inventory_reconciliation_findings_aggregate_id_ck',
      sql`length(btrim(${table.aggregateId})) > 0`,
    ),
    check(
      'inventory_reconciliation_findings_type_ck',
      sql`${table.findingType} in ('balance_on_hand_drift','balance_reserved_drift','balance_in_transit_drift','last_movement_mismatch','missing_balance','orphan_balance','invalid_posted_movement','invalid_reversal_relationship','transfer_movement_mismatch','reservation_movement_mismatch','count_application_mismatch','missing_outbox_event','missing_audit_record','unsupported_or_unknown')`,
    ),
    check(
      'inventory_reconciliation_findings_severity_ck',
      sql`${table.severity} in ('info','warning','critical')`,
    ),
    check(
      'inventory_reconciliation_findings_status_ck',
      sql`${table.status} in ('open','acknowledged','resolved','dismissed')`,
    ),
    check(
      'inventory_reconciliation_findings_identity_key_ck',
      sql`length(btrim(${table.identityKey})) > 0 and ${table.identityKey} = lower(btrim(${table.identityKey}))`,
    ),
    check(
      'inventory_reconciliation_findings_fingerprint_ck',
      sql`${table.fingerprintSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'inventory_reconciliation_findings_detector_version_ck',
      sql`length(btrim(${table.detectorVersion})) > 0`,
    ),
    check(
      'inventory_reconciliation_findings_detection_time_ck',
      sql`${table.firstDetectedAt} <= ${table.lastDetectedAt} and ${table.snapshotAt} <= ${table.lastDetectedAt}`,
    ),
    check(
      'inventory_reconciliation_findings_occurrence_count_ck',
      sql`${table.occurrenceCount} >= 1`,
    ),
    check('inventory_reconciliation_findings_version_ck', sql`${table.version} >= 1`),
    check(
      'inventory_reconciliation_findings_updated_at_ck',
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
    check(
      'inventory_reconciliation_findings_expected_summary_ck',
      sql`jsonb_typeof(${table.expectedSummary}) = 'object' and octet_length(${table.expectedSummary}::text) <= 8192`,
    ),
    check(
      'inventory_reconciliation_findings_actual_summary_ck',
      sql`jsonb_typeof(${table.actualSummary}) = 'object' and octet_length(${table.actualSummary}::text) <= 8192`,
    ),
    check(
      'inventory_reconciliation_findings_evidence_ck',
      sql`jsonb_typeof(${table.evidence}) = 'object' and octet_length(${table.evidence}::text) <= 8192`,
    ),
    check(
      'inventory_reconciliation_findings_metadata_ck',
      sql`${table.metadata} is null or (jsonb_typeof(${table.metadata}) = 'object' and octet_length(${table.metadata}::text) <= 8192)`,
    ),
    check(
      'inventory_reconciliation_findings_lifecycle_ck',
      sql`(
        ${table.status} = 'open'
        and ${table.acknowledgedAt} is null and ${table.acknowledgedBy} is null
        and ${table.resolvedAt} is null and ${table.resolvedBy} is null
        and ${table.dismissedAt} is null and ${table.dismissedBy} is null
        and ${table.resolutionReasonCode} is null and ${table.resolutionNote} is null
      ) or (
        ${table.status} = 'acknowledged'
        and ${table.acknowledgedAt} is not null and ${table.acknowledgedBy} is not null
        and ${table.resolvedAt} is null and ${table.resolvedBy} is null
        and ${table.dismissedAt} is null and ${table.dismissedBy} is null
        and ${table.resolutionReasonCode} is null and ${table.resolutionNote} is null
      ) or (
        ${table.status} = 'resolved'
        and ${table.resolvedAt} is not null and ${table.resolvedBy} is not null
        and ${table.dismissedAt} is null and ${table.dismissedBy} is null
      ) or (
        ${table.status} = 'dismissed'
        and ${table.dismissedAt} is not null and ${table.dismissedBy} is not null
        and ${table.resolvedAt} is null and ${table.resolvedBy} is null
        and ${table.resolutionReasonCode} is not null
        and length(btrim(${table.resolutionReasonCode})) > 0
      )`,
    ),
  ],
);

export type InventoryLocation = typeof inventoryLocations.$inferSelect;
export type NewInventoryLocation = typeof inventoryLocations.$inferInsert;
export type InventoryReconciliationFinding = typeof inventoryReconciliationFindings.$inferSelect;
export type NewInventoryReconciliationFinding = typeof inventoryReconciliationFindings.$inferInsert;
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
export type InventoryCount = typeof inventoryCounts.$inferSelect;
export type NewInventoryCount = typeof inventoryCounts.$inferInsert;
export type InventoryCountLine = typeof inventoryCountLines.$inferSelect;
export type NewInventoryCountLine = typeof inventoryCountLines.$inferInsert;
