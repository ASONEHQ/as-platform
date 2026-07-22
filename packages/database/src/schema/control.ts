import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';

import { companyIdColumn, createdAtColumn, idColumn } from './common.js';
import { branches, companies } from './organizations.js';

export const auditLog = pgTable(
  'audit_log',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id'),
    actorType: text('actor_type').notNull(),
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    requestId: text('request_id'),
    correlationId: text('correlation_id'),
    metadata: jsonb('metadata')
      .$type<Readonly<Record<string, unknown>>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.companyId, table.branchId],
      foreignColumns: [branches.companyId, branches.id],
      name: 'audit_log_branch_scope_fk',
    }).onDelete('restrict'),
    index('audit_log_company_occurred_idx').on(table.companyId, table.occurredAt),
    index('audit_log_company_branch_occurred_idx').on(
      table.companyId,
      table.branchId,
      table.occurredAt,
    ),
    index('audit_log_entity_idx').on(table.companyId, table.entityType, table.entityId),
    index('audit_log_correlation_idx').on(table.companyId, table.correlationId),
    check('audit_log_actor_type_ck', sql`${table.actorType} in ('user', 'device', 'system')`),
    check('audit_log_action_nonblank_ck', sql`length(btrim(${table.action})) > 0`),
    check('audit_log_entity_type_nonblank_ck', sql`length(btrim(${table.entityType})) > 0`),
    check('audit_log_metadata_object_ck', sql`jsonb_typeof(${table.metadata}) = 'object'`),
  ],
);

export const outboxEvents = pgTable(
  'outbox_events',
  {
    eventId: uuid('event_id').primaryKey().$defaultFn(uuidv7),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id'),
    eventType: text('event_type').notNull(),
    schemaVersion: integer('schema_version').notNull().default(1),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    aggregateVersion: bigint('aggregate_version', { mode: 'bigint' }).notNull(),
    correlationId: text('correlation_id'),
    causationId: uuid('causation_id'),
    payload: jsonb('payload').$type<Readonly<Record<string, unknown>>>().notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
    availableAt: timestamp('available_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    foreignKey({
      columns: [table.companyId, table.branchId],
      foreignColumns: [branches.companyId, branches.id],
      name: 'outbox_events_branch_scope_fk',
    }).onDelete('restrict'),
    index('outbox_events_pending_idx')
      .on(table.availableAt, table.eventId)
      .where(sql`${table.publishedAt} is null`),
    index('outbox_events_available_idx').on(table.availableAt),
    index('outbox_events_aggregate_idx').on(
      table.companyId,
      table.aggregateType,
      table.aggregateId,
      table.aggregateVersion,
    ),
    index('outbox_events_company_branch_idx').on(table.companyId, table.branchId),
    check('outbox_events_type_nonblank_ck', sql`length(btrim(${table.eventType})) > 0`),
    check('outbox_events_schema_version_ck', sql`${table.schemaVersion} > 0`),
    check(
      'outbox_events_aggregate_type_nonblank_ck',
      sql`length(btrim(${table.aggregateType})) > 0`,
    ),
    check('outbox_events_aggregate_version_ck', sql`${table.aggregateVersion} > 0`),
    check('outbox_events_attempts_ck', sql`${table.attempts} >= 0`),
    check(
      'outbox_events_payload_ck',
      sql`jsonb_typeof(${table.payload}) = 'object' and ${table.payload} <> '{}'::jsonb`,
    ),
    check(
      'outbox_events_publication_time_ck',
      sql`${table.publishedAt} is null or ${table.publishedAt} >= ${table.occurredAt}`,
    ),
  ],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    key: text('key').notNull(),
    operation: text('operation').notNull(),
    requestHash: text('request_hash').notNull(),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    resourceType: text('resource_type'),
    resourceId: uuid('resource_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: createdAtColumn(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    unique('idempotency_keys_company_operation_key_uq').on(
      table.companyId,
      table.operation,
      table.key,
    ),
    index('idempotency_keys_company_idx').on(table.companyId),
    index('idempotency_keys_expires_at_idx').on(table.expiresAt),
    check('idempotency_keys_key_nonblank_ck', sql`length(btrim(${table.key})) > 0`),
    check('idempotency_keys_operation_nonblank_ck', sql`length(btrim(${table.operation})) > 0`),
    check('idempotency_keys_request_hash_ck', sql`length(btrim(${table.requestHash})) >= 32`),
    check(
      'idempotency_keys_response_status_ck',
      sql`${table.responseStatus} is null or ${table.responseStatus} between 100 and 599`,
    ),
    check(
      'idempotency_keys_response_body_size_ck',
      sql`${table.responseBody} is null or octet_length(${table.responseBody}::text) <= 65536`,
    ),
    check('idempotency_keys_expiry_ck', sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      'idempotency_keys_completed_at_ck',
      sql`${table.completedAt} is null or (${table.completedAt} >= ${table.createdAt} and ${table.completedAt} <= ${table.expiresAt})`,
    ),
  ],
);

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type OutboxEvent = typeof outboxEvents.$inferSelect;
export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
