import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { companyIdColumn, createdAtColumn, idColumn, updatedAtColumn } from './common.js';
import { branches, companies } from './organizations.js';

export const devices = pgTable(
  'devices',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id'),
    name: text('name').notNull(),
    deviceType: text('device_type').notNull(),
    status: text('status').notNull().default('pending'),
    publicKey: text('public_key'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('devices_company_id_id_uq').on(table.companyId, table.id),
    foreignKey({
      columns: [table.companyId, table.branchId],
      foreignColumns: [branches.companyId, branches.id],
      name: 'devices_branch_scope_fk',
    }).onDelete('restrict'),
    index('devices_company_idx').on(table.companyId),
    index('devices_company_branch_idx').on(table.companyId, table.branchId),
    index('devices_company_status_idx').on(table.companyId, table.status),
    check('devices_name_nonblank_ck', sql`length(btrim(${table.name})) > 0`),
    check(
      'devices_type_ck',
      sql`${table.deviceType} in ('pos', 'kiosk', 'admin', 'worker', 'display', 'other')`,
    ),
    check(
      'devices_status_ck',
      sql`${table.status} in ('pending', 'active', 'revoked', 'disabled')`,
    ),
    check(
      'devices_branch_required_ck',
      sql`${table.deviceType} not in ('pos', 'kiosk', 'display') or ${table.branchId} is not null`,
    ),
    check(
      'devices_revocation_consistency_ck',
      sql`${table.status} <> 'revoked' or ${table.revokedAt} is not null`,
    ),
  ],
);

export type Device = typeof devices.$inferSelect;
