import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  type CheckBuilder,
  foreignKey,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { companyIdColumn, createdAtColumn, idColumn, updatedAtColumn } from './common.js';
import { users } from './identity.js';
import { branches, companies } from './organizations.js';

interface SettingCheckColumns {
  readonly key: AnyPgColumn;
  readonly value: AnyPgColumn;
  readonly valueType: AnyPgColumn;
  readonly status: AnyPgColumn;
  readonly isSecret: AnyPgColumn;
  readonly version: AnyPgColumn;
  readonly deletedAt: AnyPgColumn;
}

const settingChecks = (prefix: string, table: SettingCheckColumns): CheckBuilder[] => [
  check(`${prefix}_key_nonblank_ck`, sql`length(btrim(${table.key})) > 0`),
  check(`${prefix}_value_type_ck`, sql`${table.valueType} in ('string', 'boolean', 'integer')`),
  check(`${prefix}_status_ck`, sql`${table.status} in ('active', 'retired')`),
  check(`${prefix}_version_ck`, sql`${table.version} >= 2`),
  check(`${prefix}_not_secret_ck`, sql`${table.isSecret} is false`),
  check(
    `${prefix}_retirement_ck`,
    sql`(${table.status} = 'active' and ${table.deletedAt} is null) or (${table.status} = 'retired' and ${table.deletedAt} is not null)`,
  ),
  check(
    `${prefix}_value_structure_ck`,
    sql`(${table.valueType} = 'string' and jsonb_typeof(${table.value}) = 'string')
      or (${table.valueType} = 'boolean' and jsonb_typeof(${table.value}) = 'boolean')
      or (${table.valueType} = 'integer' and jsonb_typeof(${table.value}) = 'number'
        and (${table.value} #>> '{}')::numeric = trunc((${table.value} #>> '{}')::numeric))`,
  ),
];

export const companySettings = pgTable(
  'company_settings',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    key: text('key').notNull(),
    value: jsonb('value').$type<boolean | number | string>().notNull(),
    valueType: text('value_type').notNull(),
    status: text('status').notNull().default('active'),
    isSecret: boolean('is_secret').notNull().default(false),
    version: bigint('version', { mode: 'bigint' })
      .notNull()
      .default(sql`2`),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    unique('company_settings_company_key_uq').on(table.companyId, table.key),
    ...settingChecks('company_settings', table),
  ],
);

export const branchSettings = pgTable(
  'branch_settings',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').notNull(),
    key: text('key').notNull(),
    value: jsonb('value').$type<boolean | number | string>().notNull(),
    valueType: text('value_type').notNull(),
    status: text('status').notNull().default('active'),
    isSecret: boolean('is_secret').notNull().default(false),
    version: bigint('version', { mode: 'bigint' })
      .notNull()
      .default(sql`2`),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    unique('branch_settings_company_branch_key_uq').on(table.companyId, table.branchId, table.key),
    foreignKey({
      columns: [table.companyId, table.branchId],
      foreignColumns: [branches.companyId, branches.id],
      name: 'branch_settings_branch_scope_fk',
    }).onDelete('restrict'),
    ...settingChecks('branch_settings', table),
  ],
);

export type CompanySetting = typeof companySettings.$inferSelect;
export type NewCompanySetting = typeof companySettings.$inferInsert;
export type BranchSetting = typeof branchSettings.$inferSelect;
export type NewBranchSetting = typeof branchSettings.$inferInsert;
