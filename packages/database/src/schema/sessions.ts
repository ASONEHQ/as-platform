import { sql } from 'drizzle-orm';
import {
  integer,
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
import { devices } from './devices.js';
import { companyMemberships, users } from './identity.js';
import { branches, companies } from './organizations.js';

export const sessions = pgTable(
  'sessions',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    userId: uuid('user_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    branchId: uuid('branch_id'),
    deviceId: uuid('device_id'),
    tokenHash: text('token_hash').notNull(),
    status: text('status').notNull().default('active'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    tokenFamilyId: uuid('token_family_id').notNull(),
    tokenGeneration: integer('token_generation').notNull().default(0),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
    reuseDetectedAt: timestamp('reuse_detected_at', { withTimezone: true, mode: 'date' }),
    revocationReason: text('revocation_reason'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('sessions_token_hash_uq').on(table.tokenHash),
    foreignKey({
      columns: [table.companyId, table.branchId],
      foreignColumns: [branches.companyId, branches.id],
      name: 'sessions_branch_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'sessions_user_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.membershipId, table.userId],
      foreignColumns: [
        companyMemberships.companyId,
        companyMemberships.id,
        companyMemberships.userId,
      ],
      name: 'sessions_membership_context_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.deviceId],
      foreignColumns: [devices.companyId, devices.id],
      name: 'sessions_device_scope_fk',
    }).onDelete('restrict'),
    index('sessions_company_idx').on(table.companyId),
    index('sessions_company_user_idx').on(table.companyId, table.userId),
    index('sessions_membership_idx').on(table.companyId, table.membershipId),
    index('sessions_token_family_idx').on(table.tokenFamilyId),
    index('sessions_company_status_idx').on(table.companyId, table.status),
    index('sessions_expires_at_idx').on(table.expiresAt),
    check('sessions_token_hash_length_ck', sql`length(btrim(${table.tokenHash})) >= 32`),
    check('sessions_status_ck', sql`${table.status} in ('active', 'expired', 'revoked')`),
    check('sessions_expiry_ck', sql`${table.expiresAt} > ${table.createdAt}`),
    check('sessions_token_generation_ck', sql`${table.tokenGeneration} >= 0`),
    check(
      'sessions_revocation_consistency_ck',
      sql`${table.status} <> 'revoked' or ${table.revokedAt} is not null`,
    ),
  ],
);

export const sessionRefreshTokens = pgTable(
  'session_refresh_tokens',
  {
    id: idColumn(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'restrict' }),
    tokenHash: text('token_hash').notNull(),
    generation: integer('generation').notNull(),
    status: text('status').notNull().default('active'),
    issuedAt: createdAtColumn(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    rotatedAt: timestamp('rotated_at', { withTimezone: true, mode: 'date' }),
    reusedAt: timestamp('reused_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    unique('session_refresh_tokens_hash_uq').on(table.tokenHash),
    unique('session_refresh_tokens_session_generation_uq').on(table.sessionId, table.generation),
    index('session_refresh_tokens_session_idx').on(table.sessionId),
    check('session_refresh_tokens_hash_length_ck', sql`length(btrim(${table.tokenHash})) >= 32`),
    check('session_refresh_tokens_generation_ck', sql`${table.generation} >= 0`),
    check(
      'session_refresh_tokens_status_ck',
      sql`${table.status} in ('active', 'rotated', 'revoked', 'reused')`,
    ),
    check('session_refresh_tokens_expiry_ck', sql`${table.expiresAt} > ${table.issuedAt}`),
  ],
);

export type Session = typeof sessions.$inferSelect;
export type SessionRefreshToken = typeof sessionRefreshTokens.$inferSelect;
