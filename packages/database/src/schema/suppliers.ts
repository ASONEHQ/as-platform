import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { companyIdColumn, createdAtColumn, idColumn, updatedAtColumn } from './common.js';
import { companyMemberships } from './identity.js';
import { companies } from './organizations.js';

/**
 * TASK 14.4 (Wave 2, Part C.1) — real supplier records, recovered from
 * `docs/LEGACY_FUNCTIONAL_PARITY.md`'s Compras/Proveedores section (a
 * real, if shallow, CRUD contact list in the legacy product — no
 * fake/placeholder mechanism here to worry about, unlike the legacy's
 * own formal Purchase Order workflow). Company-scoped, never
 * branch-scoped (a supplier relationship is with the business, not one
 * physical location) — matching the legacy's own real behavior.
 */
export const supplierStatuses = ['active', 'inactive'] as const;

export const suppliers = pgTable(
  'suppliers',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    contactName: text('contact_name'),
    phone: text('phone'),
    email: text('email'),
    notes: text('notes'),
    status: text('status').notNull().default('active'),
    createdBy: uuid('created_by').notNull(),
    updatedBy: uuid('updated_by').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('suppliers_company_id_id_uq').on(table.companyId, table.id),
    uniqueIndex('suppliers_company_name_uq').on(table.companyId, table.name),
    foreignKey({
      columns: [table.companyId, table.createdBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'suppliers_created_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.updatedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'suppliers_updated_by_membership_fk',
    }).onDelete('restrict'),
    index('suppliers_company_status_idx').on(table.companyId, table.status),
    check('suppliers_name_nonblank_ck', sql`length(btrim(${table.name})) > 0`),
    check('suppliers_status_ck', sql`${table.status} in ('active', 'inactive')`),
    check(
      'suppliers_email_format_ck',
      sql`${table.email} is null or ${table.email} ~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'`,
    ),
  ],
);

export type Supplier = typeof suppliers.$inferSelect;
export type NewSupplier = typeof suppliers.$inferInsert;
