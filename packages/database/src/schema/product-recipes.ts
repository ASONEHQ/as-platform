import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  numeric,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { productVariants, unitsOfMeasure } from './catalog.js';
import { companyIdColumn, createdAtColumn, idColumn, updatedAtColumn } from './common.js';
import { companyMemberships } from './identity.js';
import { companies } from './organizations.js';

export const productRecipeQuantityPrecision = 19;
export const productRecipeQuantityScale = 6;

// TASK 16.32 — the recipe (bill-of-materials) header attached to a single
// sellable `product_variants` row (never `products` — a variable
// product's different variants, e.g. Pizza Chica/Mediana/Grande, may need
// different recipes, and `sale_items.product_variant_id` is already the
// frozen identity `sale-consumption.ts` posts against, so keying recipes
// the same way needs no extra join at consumption time). Deliberately not
// versioned/soft-deleted: editing a recipe's components changes what a
// FUTURE sale consumes; a past sale's actual consumption is already an
// immutable historical fact captured in that sale's own
// `inventory_movement_lines.metadata` (see `sale-consumption.ts`'s Part B
// doc comment and `docs/PRODUCT_RECIPES.md`, Phase 29) — there is nothing
// for a recipe version history to protect that isn't already protected.
export const productRecipes = pgTable(
  'product_recipes',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    productVariantId: uuid('product_variant_id').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    version: bigint('version', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    createdBy: uuid('created_by').notNull(),
    updatedBy: uuid('updated_by').notNull(),
  },
  (table) => [
    unique('product_recipes_company_id_id_uq').on(table.companyId, table.id),
    // Exactly one recipe per variant — replaced in place (PUT), never
    // multiple historical rows (see the table's own doc comment above).
    unique('product_recipes_company_variant_uq').on(table.companyId, table.productVariantId),
    foreignKey({
      columns: [table.companyId, table.productVariantId],
      foreignColumns: [productVariants.companyId, productVariants.id],
      name: 'product_recipes_variant_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.createdBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'product_recipes_created_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.updatedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'product_recipes_updated_by_membership_fk',
    }).onDelete('restrict'),
    index('product_recipes_company_variant_idx').on(table.companyId, table.productVariantId),
    index('product_recipes_company_active_idx')
      .on(table.companyId, table.productVariantId)
      .where(sql`${table.isActive} is true`),
    check('product_recipes_version_ck', sql`${table.version} >= 1`),
  ],
);

// TASK 16.32 — one ingredient line of a recipe. `componentVariantId` is
// itself an ordinary `product_variants` row (this schema has never had a
// separate "inventory item" concept — see `docs/PRODUCT_RECIPES.md` §1 —
// an ingredient is just a variant that is never rung up at the register).
// `quantity`/`unitOfMeasureCode` are the amount AS AUTHORED (e.g. "180",
// "g"), which may differ from the ingredient variant's own storage unit
// (e.g. purchased/stocked in "kg") — `sale-consumption.ts` converts
// between the two at consumption time via `units_of_measure`'s existing
// `conversion_factor_to_base`, rejecting a mismatched dimension (Phase 5).
export const productRecipeComponents = pgTable(
  'product_recipe_components',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    recipeId: uuid('recipe_id').notNull(),
    componentVariantId: uuid('component_variant_id').notNull(),
    quantity: numeric('quantity', {
      precision: productRecipeQuantityPrecision,
      scale: productRecipeQuantityScale,
    }).notNull(),
    unitOfMeasureCode: text('unit_of_measure_code')
      .notNull()
      .references(() => unitsOfMeasure.code, { onDelete: 'restrict' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    createdBy: uuid('created_by').notNull(),
    updatedBy: uuid('updated_by').notNull(),
  },
  (table) => [
    unique('product_recipe_components_company_id_id_uq').on(table.companyId, table.id),
    // TASK 16.32 (Phase 8): duplicate ingredient rows on the same recipe
    // are rejected outright rather than silently merged — see
    // `docs/PRODUCT_RECIPES.md` for the reasoning.
    unique('product_recipe_components_recipe_variant_uq').on(
      table.companyId,
      table.recipeId,
      table.componentVariantId,
    ),
    foreignKey({
      columns: [table.companyId, table.recipeId],
      foreignColumns: [productRecipes.companyId, productRecipes.id],
      name: 'product_recipe_components_recipe_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.componentVariantId],
      foreignColumns: [productVariants.companyId, productVariants.id],
      name: 'product_recipe_components_variant_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.createdBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'product_recipe_components_created_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.updatedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'product_recipe_components_updated_by_membership_fk',
    }).onDelete('restrict'),
    index('product_recipe_components_recipe_idx').on(table.companyId, table.recipeId),
    index('product_recipe_components_variant_idx').on(table.companyId, table.componentVariantId),
    check('product_recipe_components_quantity_ck', sql`${table.quantity} > 0`),
  ],
);
