import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { companyIdColumn, createdAtColumn, idColumn, updatedAtColumn } from './common.js';
import { companyMemberships } from './identity.js';
import { branches, companies } from './organizations.js';
import { devices } from './devices.js';
import { sales } from './sales.js';

/**
 * TASK 12.4A — payment and terminal foundation.
 *
 * Reconciled against the already-designed contract rather than invented
 * fresh: `docs/API_CONTRACTS.md` §16 (E073-E080) and §21.3 already define
 * `payments` as the authoritative payment record (child of a future
 * `sales` row, permissions `payment.create`/`payment.read`/
 * `payment.reverse`) with an exact 5-state machine —
 * `pending → authorized|captured|failed`, `authorized → captured|failed`,
 * `captured → reversed` — which this table implements verbatim (see the
 * `payments_status_ck` check below). §24 "Open decisions" item 7
 * ("Electronic payment provider state mapping, authorization/capture
 * policy, and webhook contracts") is explicitly still open, so this
 * schema deliberately supports *both* legal paths through the machine
 * (immediate capture and authorize-then-capture) rather than silently
 * choosing one.
 *
 * `payment_attempts` is new — the contract does not yet define it — but
 * directly answers the task's own request to evaluate a child entity for
 * retries instead of mutating one provider transaction repeatedly. It
 * carries the finer-grained terminal-interaction lifecycle
 * (`created → awaiting_terminal → processing → approved|declined|
 * cancelled|timed_out|failed`) that a physical terminal reports through,
 * one attempt per try, so retrying a declined/timed-out payment creates a
 * new attempt row rather than overwriting evidence of the failed one.
 *
 * `payment_terminals` deliberately does not duplicate the existing
 * `devices` table's identity/connectivity concerns (status, last_seen_at,
 * public_key) — it is a 1:1 payment-specific extension of a `devices` row
 * (scoped FK), the same "attributes of a concrete X live in X's own
 * table" pattern already used for `product_prices` against `products`
 * (see docs/API_CONTRACTS.md §14.1/§14.2).
 *
 * No table in this file ever stores card PAN, CVV, or raw magnetic-stripe
 * data — see ADR-0008 for the full security boundary.
 *
 * TASK 12.4A.1: `payments.sale_id` is now a real, required, scoped
 * foreign key to `sales` (see sales.ts and ADR-0009). The provisional,
 * unenforced `sale_reference` column from TASK 12.4A is deprecated and no
 * longer used by any application code, but is kept declared here (nullable,
 * dead) rather than dropped — see the column's own comment below and
 * ADR-0009 for why.
 */

export const paymentTerminals = pgTable(
  'payment_terminals',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').notNull(),
    deviceId: uuid('device_id').notNull(),
    // 'unassigned' until a real provider is authorized and paired — see
    // ADR-0008 and the "Provider Integration Readiness" report section;
    // never defaults to a specific vendor.
    provider: text('provider').notNull().default('unassigned'),
    providerTerminalId: text('provider_terminal_id'),
    capabilities: jsonb('capabilities').$type<Readonly<Record<string, unknown>>>(),
    status: text('status').notNull().default('unassigned'),
    version: bigint('version', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('payment_terminals_company_id_id_uq').on(table.companyId, table.id),
    unique('payment_terminals_company_device_uq').on(table.companyId, table.deviceId),
    foreignKey({
      columns: [table.companyId, table.branchId],
      foreignColumns: [branches.companyId, branches.id],
      name: 'payment_terminals_branch_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.deviceId],
      foreignColumns: [devices.companyId, devices.id],
      name: 'payment_terminals_device_scope_fk',
    }).onDelete('restrict'),
    index('payment_terminals_company_branch_idx').on(table.companyId, table.branchId),
    index('payment_terminals_company_status_idx').on(table.companyId, table.status),
    check('payment_terminals_provider_nonblank_ck', sql`length(btrim(${table.provider})) > 0`),
    check(
      'payment_terminals_status_ck',
      sql`${table.status} in ('unassigned', 'assigned', 'active', 'disabled')`,
    ),
    check(
      'payment_terminals_capabilities_object_ck',
      sql`${table.capabilities} is null or jsonb_typeof(${table.capabilities}) = 'object'`,
    ),
    check('payment_terminals_version_ck', sql`${table.version} >= 1`),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').notNull(),
    // DEPRECATED (TASK 12.4A.1): the TASK 12.4A provisional, unenforced
    // placeholder. No longer read or written by application code — `sale_id`
    // below is the real, required, scoped foreign key to `sales` (see
    // `payments_sale_scope_fk` and ADR-0009). This column is kept in the
    // schema, forever unused, rather than dropped: this repository's own
    // migration policy (`src/scripts/check-migrations.ts`) categorically
    // forbids a `DROP COLUMN` statement anywhere in migration history, with
    // no override, so an unused column is the correct, safe way to retire
    // it — matching the project's established additive-only convention.
    saleReference: uuid('sale_reference'),
    // `sale_id` was added nullable first (migration 0013, a pure ADD
    // COLUMN — the textbook-safe, portable way to add a required column,
    // correct whether or not the table already has rows) and is now
    // finalized NOT NULL here (migration 0014), alongside
    // `payments_sale_scope_fk` below.
    saleId: uuid('sale_id').notNull(),
    paymentMethod: text('payment_method').notNull(),
    amount: numeric('amount', { precision: 19, scale: 4 }).notNull(),
    currencyCode: char('currency_code', { length: 3 }).notNull(),
    // Snapshot of the terminal's provider at payment time; null for cash.
    provider: text('provider'),
    terminalId: uuid('terminal_id'),
    status: text('status').notNull().default('pending'),
    reasonCode: text('reason_code'),
    metadata: jsonb('metadata').$type<Readonly<Record<string, unknown>>>(),
    createdBy: uuid('created_by').notNull(),
    authorizedAt: timestamp('authorized_at', { withTimezone: true, mode: 'date' }),
    capturedAt: timestamp('captured_at', { withTimezone: true, mode: 'date' }),
    failedAt: timestamp('failed_at', { withTimezone: true, mode: 'date' }),
    reversedAt: timestamp('reversed_at', { withTimezone: true, mode: 'date' }),
    version: bigint('version', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('payments_company_id_id_uq').on(table.companyId, table.id),
    foreignKey({
      columns: [table.companyId, table.branchId],
      foreignColumns: [branches.companyId, branches.id],
      name: 'payments_branch_scope_fk',
    }).onDelete('restrict'),
    // The load-bearing tenant/branch-consistency constraint: `sales` has
    // `unique(company_id, branch_id, id)`, so this FK can only match a
    // sale that truly has this exact company AND branch — a payment
    // whose branch_id doesn't match its sale's real branch simply has no
    // row to reference and fails at insert time.
    foreignKey({
      columns: [table.companyId, table.branchId, table.saleId],
      foreignColumns: [sales.companyId, sales.branchId, sales.id],
      name: 'payments_sale_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.terminalId],
      foreignColumns: [paymentTerminals.companyId, paymentTerminals.id],
      name: 'payments_terminal_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.createdBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'payments_created_by_membership_fk',
    }).onDelete('restrict'),
    index('payments_company_branch_idx').on(table.companyId, table.branchId),
    index('payments_company_status_idx').on(table.companyId, table.status),
    index('payments_company_sale_idx').on(table.companyId, table.saleId),
    check('payments_amount_positive_ck', sql`${table.amount} > 0`),
    check('payments_currency_code_ck', sql`${table.currencyCode} ~ '^[A-Z]{3}$'`),
    check(
      'payments_method_ck',
      sql`${table.paymentMethod} in ('cash', 'card_terminal', 'card_manual', 'other')`,
    ),
    // §21.3's exact five states — never a project-invented name.
    check(
      'payments_status_ck',
      sql`${table.status} in ('pending', 'authorized', 'captured', 'failed', 'reversed')`,
    ),
    check(
      'payments_terminal_required_ck',
      sql`(${table.paymentMethod} = 'card_terminal') = (${table.terminalId} is not null)`,
    ),
    check(
      'payments_authorized_at_ck',
      sql`${table.status} <> 'authorized' or ${table.authorizedAt} is not null`,
    ),
    check(
      'payments_captured_at_ck',
      sql`${table.status} <> 'captured' or ${table.capturedAt} is not null`,
    ),
    check('payments_failed_at_ck', sql`${table.status} <> 'failed' or ${table.failedAt} is not null`),
    check(
      'payments_reversed_at_ck',
      sql`${table.status} <> 'reversed' or ${table.reversedAt} is not null`,
    ),
    check('payments_version_ck', sql`${table.version} >= 1`),
    check(
      'payments_metadata_object_ck',
      sql`${table.metadata} is null or jsonb_typeof(${table.metadata}) = 'object'`,
    ),
  ],
);

export const paymentAttempts = pgTable(
  'payment_attempts',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    paymentId: uuid('payment_id').notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    terminalId: uuid('terminal_id'),
    status: text('status').notNull().default('created'),
    // The provider/terminal's own transaction or reference identifier —
    // used to correlate a future provider callback to this exact attempt
    // and to make callback handling idempotent (see ADR-0008).
    providerReference: text('provider_reference'),
    declineReason: text('decline_reason'),
    metadata: jsonb('metadata').$type<Readonly<Record<string, unknown>>>(),
    requestedAt: timestamp('requested_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    respondedAt: timestamp('responded_at', { withTimezone: true, mode: 'date' }),
    version: bigint('version', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('payment_attempts_company_id_id_uq').on(table.companyId, table.id),
    unique('payment_attempts_payment_number_uq').on(
      table.companyId,
      table.paymentId,
      table.attemptNumber,
    ),
    foreignKey({
      columns: [table.companyId, table.paymentId],
      foreignColumns: [payments.companyId, payments.id],
      name: 'payment_attempts_payment_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.terminalId],
      foreignColumns: [paymentTerminals.companyId, paymentTerminals.id],
      name: 'payment_attempts_terminal_scope_fk',
    }).onDelete('restrict'),
    // A provider transaction/reference id, once present, must uniquely
    // identify one attempt — the load-bearing constraint that makes a
    // duplicate provider callback replay-safe at the database level, not
    // just in application code.
    unique('payment_attempts_company_provider_reference_uq').on(
      table.companyId,
      table.providerReference,
    ),
    index('payment_attempts_payment_idx').on(table.companyId, table.paymentId),
    index('payment_attempts_status_idx').on(table.companyId, table.status),
    check('payment_attempts_attempt_number_ck', sql`${table.attemptNumber} >= 1`),
    check(
      'payment_attempts_status_ck',
      sql`${table.status} in ('created', 'awaiting_terminal', 'processing', 'approved', 'declined', 'cancelled', 'timed_out', 'failed')`,
    ),
    check(
      'payment_attempts_responded_at_ck',
      sql`${table.status} not in ('approved', 'declined', 'cancelled', 'timed_out', 'failed') or ${table.respondedAt} is not null`,
    ),
    check('payment_attempts_version_ck', sql`${table.version} >= 1`),
    check(
      'payment_attempts_metadata_object_ck',
      sql`${table.metadata} is null or jsonb_typeof(${table.metadata}) = 'object'`,
    ),
  ],
);

export type PaymentTerminal = typeof paymentTerminals.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type PaymentAttempt = typeof paymentAttempts.$inferSelect;
