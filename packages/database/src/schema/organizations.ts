import { sql } from 'drizzle-orm';
import { char, check, index, jsonb, pgTable, text, unique } from 'drizzle-orm/pg-core';

import { companyIdColumn, createdAtColumn, idColumn, updatedAtColumn } from './common.js';

export const companies = pgTable(
  'companies',
  {
    id: idColumn(),
    legalName: text('legal_name').notNull(),
    displayName: text('display_name').notNull(),
    slug: text('slug').notNull(),
    status: text('status').notNull().default('active'),
    timezone: text('timezone').notNull(),
    currencyCode: char('currency_code', { length: 3 }).notNull(),
    locale: text('locale').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('companies_slug_uq').on(table.slug),
    unique('companies_id_scope_uq').on(table.id),
    index('companies_status_idx').on(table.status),
    check('companies_legal_name_nonblank_ck', sql`length(btrim(${table.legalName})) > 0`),
    check('companies_display_name_nonblank_ck', sql`length(btrim(${table.displayName})) > 0`),
    check('companies_slug_format_ck', sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`),
    check('companies_status_ck', sql`${table.status} in ('active', 'suspended', 'closed')`),
    check('companies_timezone_nonblank_ck', sql`length(btrim(${table.timezone})) > 0`),
    check('companies_currency_code_ck', sql`${table.currencyCode} ~ '^[A-Z]{3}$'`),
    check('companies_locale_nonblank_ck', sql`length(btrim(${table.locale})) > 0`),
  ],
);

export const branches = pgTable(
  'branches',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    code: text('code').notNull(),
    status: text('status').notNull().default('active'),
    timezone: text('timezone').notNull(),
    address: jsonb('address').$type<Readonly<Record<string, unknown>>>(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('branches_company_id_id_uq').on(table.companyId, table.id),
    unique('branches_company_code_uq').on(table.companyId, table.code),
    index('branches_company_idx').on(table.companyId),
    index('branches_company_status_idx').on(table.companyId, table.status),
    check('branches_name_nonblank_ck', sql`length(btrim(${table.name})) > 0`),
    check('branches_code_nonblank_ck', sql`length(btrim(${table.code})) > 0`),
    check('branches_status_ck', sql`${table.status} in ('active', 'inactive', 'closed')`),
    check('branches_timezone_nonblank_ck', sql`length(btrim(${table.timezone})) > 0`),
    check(
      'branches_address_object_ck',
      sql`${table.address} is null or jsonb_typeof(${table.address}) = 'object'`,
    ),
  ],
);

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type Branch = typeof branches.$inferSelect;
export type NewBranch = typeof branches.$inferInsert;
