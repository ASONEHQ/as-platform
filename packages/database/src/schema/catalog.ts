import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { companyIdColumn, createdAtColumn, idColumn, updatedAtColumn } from './common.js';
import { companyMemberships } from './identity.js';
import { companies } from './organizations.js';

export const productCategories = pgTable(
  'product_categories',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    parentId: uuid('parent_id'),
    code: text('code').notNull(),
    normalizedCode: text('normalized_code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(0),
    status: text('status').notNull().default('active'),
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
    unique('product_categories_company_id_id_uq').on(table.companyId, table.id),
    unique('product_categories_company_code_uq').on(table.companyId, table.normalizedCode),
    foreignKey({
      columns: [table.companyId, table.parentId],
      foreignColumns: [table.companyId, table.id],
      name: 'product_categories_parent_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.createdBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'product_categories_created_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.updatedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'product_categories_updated_by_membership_fk',
    }).onDelete('restrict'),
    index('product_categories_company_parent_idx').on(table.companyId, table.parentId),
    index('product_categories_company_status_idx').on(table.companyId, table.status),
    check('product_categories_code_nonblank_ck', sql`length(btrim(${table.code})) > 0`),
    check(
      'product_categories_normalized_code_ck',
      sql`length(${table.normalizedCode}) > 0 and ${table.normalizedCode} = lower(btrim(${table.normalizedCode}))`,
    ),
    check('product_categories_name_nonblank_ck', sql`length(btrim(${table.name})) > 0`),
    check('product_categories_sort_order_ck', sql`${table.sortOrder} >= 0`),
    check(
      'product_categories_status_ck',
      sql`${table.status} in ('active', 'inactive', 'retired')`,
    ),
    check('product_categories_version_ck', sql`${table.version} >= 1`),
    check(
      'product_categories_retirement_ck',
      sql`(${table.status} = 'retired' and ${table.deletedAt} is not null)
        or (${table.status} <> 'retired' and ${table.deletedAt} is null)`,
    ),
    check(
      'product_categories_not_self_parent_ck',
      sql`${table.parentId} is null or ${table.parentId} <> ${table.id}`,
    ),
  ],
);

export const brands = pgTable(
  'brands',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    normalizedCode: text('normalized_code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    status: text('status').notNull().default('active'),
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
    unique('brands_company_id_id_uq').on(table.companyId, table.id),
    unique('brands_company_code_uq').on(table.companyId, table.normalizedCode),
    foreignKey({
      columns: [table.companyId, table.createdBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'brands_created_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.updatedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'brands_updated_by_membership_fk',
    }).onDelete('restrict'),
    index('brands_company_status_idx').on(table.companyId, table.status),
    check('brands_code_nonblank_ck', sql`length(btrim(${table.code})) > 0`),
    check(
      'brands_normalized_code_ck',
      sql`length(${table.normalizedCode}) > 0 and ${table.normalizedCode} = lower(btrim(${table.normalizedCode}))`,
    ),
    check('brands_name_nonblank_ck', sql`length(btrim(${table.name})) > 0`),
    check('brands_status_ck', sql`${table.status} in ('active', 'inactive', 'retired')`),
    check('brands_version_ck', sql`${table.version} >= 1`),
    check(
      'brands_retirement_ck',
      sql`(${table.status} = 'retired' and ${table.deletedAt} is not null)
        or (${table.status} <> 'retired' and ${table.deletedAt} is null)`,
    ),
  ],
);

export const unitsOfMeasure = pgTable(
  'units_of_measure',
  {
    code: text('code').primaryKey(),
    name: text('name').notNull(),
    dimension: text('dimension').notNull(),
    quantityScale: integer('quantity_scale').notNull(),
    conversionFactorToBase: numeric('conversion_factor_to_base', {
      precision: 19,
      scale: 6,
    }).notNull(),
    status: text('status').notNull().default('active'),
  },
  (table) => [
    check('units_of_measure_code_nonblank_ck', sql`length(btrim(${table.code})) > 0`),
    check('units_of_measure_name_nonblank_ck', sql`length(btrim(${table.name})) > 0`),
    check('units_of_measure_dimension_ck', sql`${table.dimension} in ('count', 'mass', 'volume')`),
    check('units_of_measure_quantity_scale_ck', sql`${table.quantityScale} between 0 and 6`),
    check('units_of_measure_conversion_factor_ck', sql`${table.conversionFactorToBase} > 0`),
    check('units_of_measure_status_ck', sql`${table.status} in ('active', 'retired')`),
  ],
);

export const products = pgTable(
  'products',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    categoryId: uuid('category_id'),
    brandId: uuid('brand_id'),
    code: text('code').notNull(),
    normalizedCode: text('normalized_code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    productType: text('product_type').notNull(),
    tracksInventory: boolean('tracks_inventory').notNull(),
    status: text('status').notNull().default('draft'),
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
    unique('products_company_id_id_uq').on(table.companyId, table.id),
    unique('products_company_code_uq').on(table.companyId, table.normalizedCode),
    foreignKey({
      columns: [table.companyId, table.categoryId],
      foreignColumns: [productCategories.companyId, productCategories.id],
      name: 'products_category_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.brandId],
      foreignColumns: [brands.companyId, brands.id],
      name: 'products_brand_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.createdBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'products_created_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.updatedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'products_updated_by_membership_fk',
    }).onDelete('restrict'),
    index('products_company_category_idx').on(table.companyId, table.categoryId),
    index('products_company_brand_idx').on(table.companyId, table.brandId),
    index('products_company_status_idx').on(table.companyId, table.status),
    check('products_code_nonblank_ck', sql`length(btrim(${table.code})) > 0`),
    check(
      'products_normalized_code_ck',
      sql`length(${table.normalizedCode}) > 0 and ${table.normalizedCode} = lower(btrim(${table.normalizedCode}))`,
    ),
    check('products_name_nonblank_ck', sql`length(btrim(${table.name})) > 0`),
    check(
      'products_type_ck',
      sql`${table.productType} in ('simple', 'variable', 'kit', 'service')`,
    ),
    check('products_status_ck', sql`${table.status} in ('draft', 'active', 'inactive', 'retired')`),
    check('products_version_ck', sql`${table.version} >= 1`),
    check(
      'products_retirement_ck',
      sql`(${table.status} = 'retired' and ${table.deletedAt} is not null)
        or (${table.status} <> 'retired' and ${table.deletedAt} is null)`,
    ),
    check(
      'products_non_inventory_type_ck',
      sql`${table.productType} not in ('service', 'kit') or ${table.tracksInventory} is false`,
    ),
  ],
);

export const productOptionDefinitions = pgTable(
  'product_option_definitions',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    productId: uuid('product_id').notNull(),
    code: text('code').notNull(),
    normalizedCode: text('normalized_code').notNull(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    status: text('status').notNull().default('active'),
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
    unique('product_option_definitions_company_id_id_uq').on(table.companyId, table.id),
    unique('product_option_definitions_product_id_id_uq').on(
      table.companyId,
      table.productId,
      table.id,
    ),
    unique('product_option_definitions_product_code_uq').on(
      table.companyId,
      table.productId,
      table.normalizedCode,
    ),
    foreignKey({
      columns: [table.companyId, table.productId],
      foreignColumns: [products.companyId, products.id],
      name: 'product_option_definitions_product_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.createdBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'product_option_definitions_created_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.updatedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'product_option_definitions_updated_by_membership_fk',
    }).onDelete('restrict'),
    index('product_option_definitions_product_status_idx').on(
      table.companyId,
      table.productId,
      table.status,
    ),
    check('product_option_definitions_code_nonblank_ck', sql`length(btrim(${table.code})) > 0`),
    check(
      'product_option_definitions_normalized_code_ck',
      sql`length(${table.normalizedCode}) > 0 and ${table.normalizedCode} = lower(btrim(${table.normalizedCode}))`,
    ),
    check('product_option_definitions_name_nonblank_ck', sql`length(btrim(${table.name})) > 0`),
    check('product_option_definitions_sort_order_ck', sql`${table.sortOrder} >= 0`),
    check(
      'product_option_definitions_status_ck',
      sql`${table.status} in ('active', 'inactive', 'retired')`,
    ),
    check('product_option_definitions_version_ck', sql`${table.version} >= 1`),
    check(
      'product_option_definitions_retirement_ck',
      sql`(${table.status} = 'retired' and ${table.deletedAt} is not null)
        or (${table.status} <> 'retired' and ${table.deletedAt} is null)`,
    ),
  ],
);

export const productOptionValues = pgTable(
  'product_option_values',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    productId: uuid('product_id').notNull(),
    optionDefinitionId: uuid('option_definition_id').notNull(),
    code: text('code').notNull(),
    normalizedCode: text('normalized_code').notNull(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    status: text('status').notNull().default('active'),
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
    unique('product_option_values_company_id_id_uq').on(table.companyId, table.id),
    unique('product_option_values_definition_id_id_uq').on(
      table.companyId,
      table.productId,
      table.optionDefinitionId,
      table.id,
    ),
    unique('product_option_values_definition_code_uq').on(
      table.companyId,
      table.optionDefinitionId,
      table.normalizedCode,
    ),
    foreignKey({
      columns: [table.companyId, table.productId],
      foreignColumns: [products.companyId, products.id],
      name: 'product_option_values_product_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.productId, table.optionDefinitionId],
      foreignColumns: [
        productOptionDefinitions.companyId,
        productOptionDefinitions.productId,
        productOptionDefinitions.id,
      ],
      name: 'product_option_values_definition_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.createdBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'product_option_values_created_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.updatedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'product_option_values_updated_by_membership_fk',
    }).onDelete('restrict'),
    index('product_option_values_definition_status_idx').on(
      table.companyId,
      table.optionDefinitionId,
      table.status,
    ),
    check('product_option_values_code_nonblank_ck', sql`length(btrim(${table.code})) > 0`),
    check(
      'product_option_values_normalized_code_ck',
      sql`length(${table.normalizedCode}) > 0 and ${table.normalizedCode} = lower(btrim(${table.normalizedCode}))`,
    ),
    check('product_option_values_name_nonblank_ck', sql`length(btrim(${table.name})) > 0`),
    check('product_option_values_sort_order_ck', sql`${table.sortOrder} >= 0`),
    check(
      'product_option_values_status_ck',
      sql`${table.status} in ('active', 'inactive', 'retired')`,
    ),
    check('product_option_values_version_ck', sql`${table.version} >= 1`),
    check(
      'product_option_values_retirement_ck',
      sql`(${table.status} = 'retired' and ${table.deletedAt} is not null)
        or (${table.status} <> 'retired' and ${table.deletedAt} is null)`,
    ),
  ],
);

export const productVariants = pgTable(
  'product_variants',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    productId: uuid('product_id').notNull(),
    sku: text('sku').notNull(),
    normalizedSku: text('normalized_sku').notNull(),
    name: text('name'),
    unitOfMeasureCode: text('unit_of_measure_code')
      .notNull()
      .references(() => unitsOfMeasure.code, { onDelete: 'restrict' }),
    quantityScale: integer('quantity_scale').notNull(),
    tracksInventory: boolean('tracks_inventory').notNull(),
    standardCost: numeric('standard_cost', { precision: 19, scale: 4 }).notNull().default('0'),
    currencyCode: char('currency_code', { length: 3 }).notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    optionSignature: char('option_signature', { length: 64 }).notNull(),
    status: text('status').notNull().default('active'),
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
    unique('product_variants_company_id_id_uq').on(table.companyId, table.id),
    unique('product_variants_product_id_id_uq').on(table.companyId, table.productId, table.id),
    uniqueIndex('product_variants_company_sku_active_uq')
      .on(table.companyId, table.normalizedSku)
      .where(sql`${table.status} <> 'retired' and ${table.deletedAt} is null`),
    uniqueIndex('product_variants_product_default_active_uq')
      .on(table.companyId, table.productId)
      .where(
        sql`${table.isDefault} is true and ${table.status} <> 'retired' and ${table.deletedAt} is null`,
      ),
    uniqueIndex('product_variants_product_option_signature_active_uq')
      .on(table.companyId, table.productId, table.optionSignature)
      .where(sql`${table.status} <> 'retired' and ${table.deletedAt} is null`),
    foreignKey({
      columns: [table.companyId, table.productId],
      foreignColumns: [products.companyId, products.id],
      name: 'product_variants_product_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.createdBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'product_variants_created_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.updatedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'product_variants_updated_by_membership_fk',
    }).onDelete('restrict'),
    index('product_variants_product_status_idx').on(table.companyId, table.productId, table.status),
    check('product_variants_sku_nonblank_ck', sql`length(btrim(${table.sku})) > 0`),
    check(
      'product_variants_normalized_sku_ck',
      sql`length(${table.normalizedSku}) > 0 and ${table.normalizedSku} = lower(btrim(${table.normalizedSku}))`,
    ),
    check('product_variants_quantity_scale_ck', sql`${table.quantityScale} between 0 and 6`),
    check('product_variants_standard_cost_ck', sql`${table.standardCost} >= 0`),
    check('product_variants_currency_code_ck', sql`${table.currencyCode} ~ '^[A-Z]{3}$'`),
    check('product_variants_option_signature_ck', sql`${table.optionSignature} ~ '^[0-9a-f]{64}$'`),
    check('product_variants_status_ck', sql`${table.status} in ('active', 'inactive', 'retired')`),
    check('product_variants_version_ck', sql`${table.version} >= 1`),
    check(
      'product_variants_retirement_ck',
      sql`(${table.status} = 'retired' and ${table.deletedAt} is not null and ${table.isDefault} is false)
        or (${table.status} <> 'retired' and ${table.deletedAt} is null)`,
    ),
  ],
);

export const productVariantOptionValues = pgTable(
  'product_variant_option_values',
  {
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    productId: uuid('product_id').notNull(),
    productVariantId: uuid('product_variant_id').notNull(),
    optionDefinitionId: uuid('option_definition_id').notNull(),
    optionValueId: uuid('option_value_id').notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    primaryKey({
      columns: [table.companyId, table.productVariantId, table.optionDefinitionId],
      name: 'product_variant_option_values_pk',
    }),
    unique('product_variant_option_values_value_uq').on(
      table.companyId,
      table.productVariantId,
      table.optionValueId,
    ),
    foreignKey({
      columns: [table.companyId, table.productId, table.productVariantId],
      foreignColumns: [productVariants.companyId, productVariants.productId, productVariants.id],
      name: 'product_variant_option_values_variant_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.productId, table.optionDefinitionId],
      foreignColumns: [
        productOptionDefinitions.companyId,
        productOptionDefinitions.productId,
        productOptionDefinitions.id,
      ],
      name: 'product_variant_option_values_definition_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.productId, table.optionDefinitionId, table.optionValueId],
      foreignColumns: [
        productOptionValues.companyId,
        productOptionValues.productId,
        productOptionValues.optionDefinitionId,
        productOptionValues.id,
      ],
      name: 'product_variant_option_values_value_scope_fk',
    }).onDelete('restrict'),
    index('product_variant_option_values_product_idx').on(table.companyId, table.productId),
    index('product_variant_option_values_value_idx').on(table.companyId, table.optionValueId),
  ],
);

export const productBarcodes = pgTable(
  'product_barcodes',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    productVariantId: uuid('product_variant_id').notNull(),
    barcodeType: text('barcode_type').notNull(),
    barcode: text('barcode').notNull(),
    normalizedBarcode: text('normalized_barcode').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    status: text('status').notNull().default('active'),
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
    unique('product_barcodes_company_id_id_uq').on(table.companyId, table.id),
    uniqueIndex('product_barcodes_company_barcode_active_uq')
      .on(table.companyId, table.normalizedBarcode)
      .where(sql`${table.status} <> 'retired' and ${table.deletedAt} is null`),
    uniqueIndex('product_barcodes_variant_primary_active_uq')
      .on(table.companyId, table.productVariantId)
      .where(
        sql`${table.isPrimary} is true and ${table.status} <> 'retired' and ${table.deletedAt} is null`,
      ),
    foreignKey({
      columns: [table.companyId, table.productVariantId],
      foreignColumns: [productVariants.companyId, productVariants.id],
      name: 'product_barcodes_variant_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.createdBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'product_barcodes_created_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.updatedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'product_barcodes_updated_by_membership_fk',
    }).onDelete('restrict'),
    index('product_barcodes_variant_status_idx').on(
      table.companyId,
      table.productVariantId,
      table.status,
    ),
    check('product_barcodes_barcode_nonblank_ck', sql`length(btrim(${table.barcode})) > 0`),
    check(
      'product_barcodes_normalized_barcode_nonblank_ck',
      sql`length(${table.normalizedBarcode}) > 0`,
    ),
    check(
      'product_barcodes_type_ck',
      sql`${table.barcodeType} in ('ean13', 'upca', 'code128', 'qr', 'internal')`,
    ),
    check('product_barcodes_status_ck', sql`${table.status} in ('active', 'inactive', 'retired')`),
    check('product_barcodes_version_ck', sql`${table.version} >= 1`),
    check(
      'product_barcodes_retirement_ck',
      sql`(${table.status} = 'retired' and ${table.deletedAt} is not null and ${table.isPrimary} is false)
        or (${table.status} <> 'retired' and ${table.deletedAt} is null)`,
    ),
  ],
);

export type ProductCategory = typeof productCategories.$inferSelect;
export type Brand = typeof brands.$inferSelect;
export type UnitOfMeasure = typeof unitsOfMeasure.$inferSelect;
export type Product = typeof products.$inferSelect;
export type ProductOptionDefinition = typeof productOptionDefinitions.$inferSelect;
export type ProductOptionValue = typeof productOptionValues.$inferSelect;
export type ProductVariant = typeof productVariants.$inferSelect;
export type ProductVariantOptionValue = typeof productVariantOptionValues.$inferSelect;
export type ProductBarcode = typeof productBarcodes.$inferSelect;
