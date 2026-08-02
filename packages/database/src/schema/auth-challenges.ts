import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { devices } from './devices.js';
import { users } from './identity.js';
import { companies } from './organizations.js';
import { createdAtColumn, idColumn, updatedAtColumn } from './common.js';

export const authLoginChallengeStatuses = [
  'pending',
  'consumed',
  'expired',
  'invalidated',
] as const;

export const authLoginChallengeClientTypes = ['browser', 'mobile', 'pos'] as const;

export const authLoginChallenges = pgTable(
  'auth_login_challenges',
  {
    id: idColumn(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    tokenHash: text('token_hash').notNull(),
    status: text('status').notNull().default('pending'),
    eligibleCompanyIds: uuid('eligible_company_ids').array().notNull(),
    selectedCompanyId: uuid('selected_company_id').references(() => companies.id, {
      onDelete: 'restrict',
    }),
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'restrict' }),
    clientType: text('client_type').notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true, mode: 'date' }),
    invalidatedAt: timestamp('invalidated_at', { withTimezone: true, mode: 'date' }),
    requestId: uuid('request_id'),
    correlationId: uuid('correlation_id'),
    metadata: jsonb('metadata').$type<Readonly<Record<string, unknown>>>(),
    version: integer('version').notNull().default(1),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('auth_login_challenges_token_hash_uq').on(table.tokenHash),
    index('auth_login_challenges_user_status_idx').on(table.userId, table.status),
    index('auth_login_challenges_status_updated_idx').on(table.status, table.updatedAt),
    index('auth_login_challenges_pending_expiry_idx')
      .on(table.expiresAt)
      .where(sql`${table.status} = 'pending'`),
    index('auth_login_challenges_created_at_idx').on(table.createdAt),
    index('auth_login_challenges_device_status_idx')
      .on(table.deviceId, table.status)
      .where(sql`${table.deviceId} is not null`),
    check('auth_login_challenges_token_hash_ck', sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check(
      'auth_login_challenges_status_ck',
      sql`${table.status} in ('pending', 'consumed', 'expired', 'invalidated')`,
    ),
    check(
      'auth_login_challenges_client_type_ck',
      sql`${table.clientType} in ('browser', 'mobile', 'pos')`,
    ),
    check(
      'auth_login_challenges_eligible_companies_ck',
      sql`cardinality(${table.eligibleCompanyIds}) > 0`,
    ),
    check(
      'auth_login_challenges_selected_company_ck',
      sql`${table.selectedCompanyId} is null or ${table.selectedCompanyId} = any(${table.eligibleCompanyIds})`,
    ),
    check(
      'auth_login_challenges_attempts_ck',
      sql`${table.attemptCount} >= 0 and ${table.maxAttempts} > 0 and ${table.attemptCount} <= ${table.maxAttempts}`,
    ),
    check('auth_login_challenges_version_ck', sql`${table.version} >= 1`),
    check('auth_login_challenges_expiry_ck', sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      'auth_login_challenges_timestamps_ck',
      sql`${table.updatedAt} >= ${table.createdAt}
        and (${table.consumedAt} is null or ${table.consumedAt} >= ${table.createdAt})
        and (${table.invalidatedAt} is null or ${table.invalidatedAt} >= ${table.createdAt})`,
    ),
    check(
      'auth_login_challenges_lifecycle_ck',
      sql`(${table.status} = 'pending' and ${table.consumedAt} is null and ${table.invalidatedAt} is null and ${table.selectedCompanyId} is null)
        or (${table.status} = 'consumed' and ${table.consumedAt} is not null and ${table.invalidatedAt} is null and ${table.selectedCompanyId} is not null)
        or (${table.status} = 'expired' and ${table.consumedAt} is null and ${table.invalidatedAt} is null and ${table.selectedCompanyId} is null)
        or (${table.status} = 'invalidated' and ${table.consumedAt} is null and ${table.invalidatedAt} is not null and ${table.selectedCompanyId} is null)`,
    ),
    check(
      'auth_login_challenges_metadata_ck',
      sql`${table.metadata} is null or (jsonb_typeof(${table.metadata}) = 'object' and pg_column_size(${table.metadata}) <= 4096)`,
    ),
  ],
);

export type AuthLoginChallenge = typeof authLoginChallenges.$inferSelect;
export type NewAuthLoginChallenge = typeof authLoginChallenges.$inferInsert;
