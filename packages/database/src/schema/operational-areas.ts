import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, index, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { companyIdColumn, createdAtColumn, idColumn, updatedAtColumn } from './common.js';
import { companyMemberships } from './identity.js';
import { branches, companies } from './organizations.js';

/**
 * TASK 16.15 — "operational area": a generic, tenant-configured grouping of
 * cash registers WITHIN one branch, answering "where was this money
 * collected" (Taquilla/Cafetería/Eventos for one park; Admissions/Food/
 * Events for another; anything else for a completely different business —
 * never a fixed, hardcoded set anywhere in shared code). Deliberately NOT
 * the same axis as `product_categories.operational_group` (`catalog.ts`) —
 * that answers "what kind of product was sold" and is already narrowly
 * constrained to `'cafeteria'`; a Cafetería REGISTER can sell anything in
 * the catalog (souvenirs, tickets), so equating the two would be wrong.
 * This table exists purely so `cash_registers.operational_area_id` (see
 * `cash.ts`) has something real to point at, and so a branch-consolidated
 * view can group registers meaningfully without inventing area names.
 *
 * Mirrors `cash_registers`' own code/normalizedCode/status/audit-column
 * shape verbatim (see that table's own doc comment) — same conventions,
 * same active-only uniqueness pattern, nothing novel invented here.
 * Nullable on `cash_registers` (backfill-safe): an existing register never
 * loses its area-less "Sin área" state just because this table now exists
 * (§35).
 */
export const operationalAreaStatuses = ['active', 'inactive'] as const;

export const operationalAreas = pgTable(
  'operational_areas',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').notNull(),
    code: text('code').notNull(),
    normalizedCode: text('normalized_code').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'),
    createdBy: uuid('created_by').notNull(),
    updatedBy: uuid('updated_by').notNull(),
    version: bigint('version', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('operational_areas_company_id_id_uq').on(table.companyId, table.id),
    unique('operational_areas_company_branch_id_uq').on(table.companyId, table.branchId, table.id),
    uniqueIndex('operational_areas_company_branch_code_active_uq')
      .on(table.companyId, table.branchId, table.normalizedCode)
      .where(sql`${table.status} = 'active'`),
    foreignKey({
      columns: [table.companyId, table.branchId],
      foreignColumns: [branches.companyId, branches.id],
      name: 'operational_areas_branch_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.createdBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'operational_areas_created_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.updatedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'operational_areas_updated_by_membership_fk',
    }).onDelete('restrict'),
    index('operational_areas_company_branch_idx').on(table.companyId, table.branchId),
    index('operational_areas_company_status_idx').on(table.companyId, table.status),
    check('operational_areas_code_nonblank_ck', sql`length(btrim(${table.code})) > 0`),
    check(
      'operational_areas_normalized_code_ck',
      sql`length(${table.normalizedCode}) > 0 and ${table.normalizedCode} = lower(btrim(${table.normalizedCode}))`,
    ),
    check('operational_areas_name_nonblank_ck', sql`length(btrim(${table.name})) > 0`),
    check('operational_areas_status_ck', sql`${table.status} in ('active','inactive')`),
    check('operational_areas_version_ck', sql`${table.version} >= 1`),
  ],
);

export type OperationalArea = typeof operationalAreas.$inferSelect;
