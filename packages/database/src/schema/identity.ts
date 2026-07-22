import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { companyIdColumn, createdAtColumn, idColumn, updatedAtColumn } from './common.js';
import { branches, companies } from './organizations.js';

export const users = pgTable(
  'users',
  {
    id: idColumn(),
    email: text('email').notNull(),
    normalizedEmail: text('normalized_email').notNull(),
    displayName: text('display_name').notNull(),
    status: text('status').notNull().default('pending'),
    passwordHash: text('password_hash'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('users_normalized_email_uq').on(table.normalizedEmail),
    index('users_status_idx').on(table.status),
    check('users_email_nonblank_ck', sql`length(btrim(${table.email})) > 0`),
    check(
      'users_normalized_email_ck',
      sql`${table.normalizedEmail} = lower(btrim(${table.normalizedEmail})) and length(${table.normalizedEmail}) > 0`,
    ),
    check('users_display_name_nonblank_ck', sql`length(btrim(${table.displayName})) > 0`),
    check(
      'users_status_ck',
      sql`${table.status} in ('pending', 'active', 'suspended', 'disabled')`,
    ),
    check(
      'users_password_hash_nonblank_ck',
      sql`${table.passwordHash} is null or length(btrim(${table.passwordHash})) >= 20`,
    ),
  ],
);

export const companyMemberships = pgTable(
  'company_memberships',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('active'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('company_memberships_company_id_id_uq').on(table.companyId, table.id),
    unique('company_memberships_company_user_uq').on(table.companyId, table.userId),
    unique('company_memberships_company_id_user_uq').on(table.companyId, table.id, table.userId),
    index('company_memberships_user_idx').on(table.userId),
    index('company_memberships_company_status_idx').on(table.companyId, table.status),
    check(
      'company_memberships_status_ck',
      sql`${table.status} in ('invited', 'active', 'suspended', 'disabled')`,
    ),
  ],
);

export const roles = pgTable(
  'roles',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    code: text('code').notNull(),
    description: text('description'),
    status: text('status').notNull().default('active'),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('roles_company_id_id_uq').on(table.companyId, table.id),
    unique('roles_company_code_uq').on(table.companyId, table.code),
    index('roles_company_idx').on(table.companyId),
    index('roles_company_status_idx').on(table.companyId, table.status),
    check('roles_name_nonblank_ck', sql`length(btrim(${table.name})) > 0`),
    check('roles_code_nonblank_ck', sql`length(btrim(${table.code})) > 0`),
    check('roles_status_ck', sql`${table.status} in ('active', 'inactive', 'retired')`),
  ],
);

export const permissions = pgTable(
  'permissions',
  {
    id: idColumn(),
    code: text('code').notNull(),
    description: text('description').notNull(),
    domain: text('domain').notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    unique('permissions_code_uq').on(table.code),
    index('permissions_domain_idx').on(table.domain),
    check('permissions_code_format_ck', sql`${table.code} ~ '^[a-z][a-z0-9_]*[.][a-z][a-z0-9_]*$'`),
    check('permissions_description_nonblank_ck', sql`length(btrim(${table.description})) > 0`),
    check('permissions_domain_nonblank_ck', sql`length(btrim(${table.domain})) > 0`),
  ],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    roleId: uuid('role_id').notNull(),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn(),
  },
  (table) => [
    primaryKey({
      columns: [table.companyId, table.roleId, table.permissionId],
      name: 'role_permissions_pk',
    }),
    foreignKey({
      columns: [table.companyId, table.roleId],
      foreignColumns: [roles.companyId, roles.id],
      name: 'role_permissions_role_scope_fk',
    }).onDelete('restrict'),
    index('role_permissions_role_idx').on(table.companyId, table.roleId),
    index('role_permissions_permission_idx').on(table.permissionId),
  ],
);

export const userRoles = pgTable(
  'user_roles',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    membershipId: uuid('membership_id').notNull(),
    roleId: uuid('role_id').notNull(),
    branchId: uuid('branch_id'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    unique('user_roles_company_id_id_uq').on(table.companyId, table.id),
    foreignKey({
      columns: [table.companyId, table.membershipId],
      foreignColumns: [companyMemberships.companyId, companyMemberships.id],
      name: 'user_roles_membership_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.roleId],
      foreignColumns: [roles.companyId, roles.id],
      name: 'user_roles_role_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.branchId],
      foreignColumns: [branches.companyId, branches.id],
      name: 'user_roles_branch_scope_fk',
    }).onDelete('restrict'),
    uniqueIndex('user_roles_company_scope_uq')
      .on(table.companyId, table.membershipId, table.roleId)
      .where(sql`${table.branchId} is null`),
    uniqueIndex('user_roles_branch_scope_uq')
      .on(table.companyId, table.membershipId, table.roleId, table.branchId)
      .where(sql`${table.branchId} is not null`),
    index('user_roles_membership_idx').on(table.companyId, table.membershipId),
    index('user_roles_role_idx').on(table.companyId, table.roleId),
    index('user_roles_branch_idx').on(table.companyId, table.branchId),
  ],
);

export type User = typeof users.$inferSelect;
export type CompanyMembership = typeof companyMemberships.$inferSelect;
export type Role = typeof roles.$inferSelect;
export type Permission = typeof permissions.$inferSelect;
