import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  check,
  foreignKey,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { companyIdColumn, createdAtColumn, idColumn, updatedAtColumn } from './common.js';
import { devices } from './devices.js';
import { companyMemberships } from './identity.js';
import { branches, companies } from './organizations.js';

/**
 * TASK 12.7 — the `cash_registers`/`cash_sessions`/`cash_movements`
 * domain `docs/CORE_DATA_MODEL.md` §6.3 and `docs/API_CONTRACTS.md`
 * §5/§20/§21.1 (E038–E048) already reserved and fully specified —
 * field lists, permission codes (`cash_register.*`/`cash_session.*`/
 * `cash_movement.create`), error codes (`cash_session_required` etc.),
 * and the exact 3-state `cash_sessions` machine — none of it invented
 * fresh here. See ADR-0014 for the full reconciliation, including the
 * one deliberate resolution of an explicitly-open question (§19 item 5:
 * "which operations may occur without an open cash session").
 */

export const cashRegisterStatuses = ['active', 'inactive', 'retired'] as const;
// §21.1: exactly 3 states. `closing` is a real, contract-specified
// intermediate ("closure command claimed") that can fail back to `open`
// — kept structurally valid even though this implementation's own
// closure command (no external provider dependency, unlike a payment
// capture) completes it within one transaction; see ADR-0014.
export const cashSessionStatuses = ['open', 'closing', 'closed'] as const;
// The exact EX05 example (`movement_type: "cash_out"`) plus the task's
// own justified set — `closing_adjustment` deliberately omitted: the
// closed session's own `discrepancy_amount` field already records the
// count/expected difference, so a redundant ledger row would duplicate
// that fact rather than add a new one (see ADR-0014).
// TASK 12.8 adds `cash_refund` — system-posted, exactly mirroring
// `cash_sale`'s own precedent (never client-postable through
// `POST /cash-sessions/{id}/movements`, which still accepts only
// `cash_in`/`cash_out`), the drawer-out fact a completed cash refund
// produces. See ADR-0015.
export const cashMovementTypes = ['opening_float', 'cash_sale', 'cash_in', 'cash_out', 'cash_refund'] as const;

export const cashRegisters = pgTable(
  'cash_registers',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').notNull(),
    code: text('code').notNull(),
    normalizedCode: text('normalized_code').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'),
    deviceId: uuid('device_id'),
    createdBy: uuid('created_by').notNull(),
    updatedBy: uuid('updated_by').notNull(),
    version: bigint('version', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    unique('cash_registers_company_id_id_uq').on(table.companyId, table.id),
    unique('cash_registers_company_branch_id_uq').on(table.companyId, table.branchId, table.id),
    uniqueIndex('cash_registers_company_branch_code_active_uq')
      .on(table.companyId, table.branchId, table.normalizedCode)
      .where(sql`${table.status} <> 'retired' and ${table.deletedAt} is null`),
    foreignKey({
      columns: [table.companyId, table.branchId],
      foreignColumns: [branches.companyId, branches.id],
      name: 'cash_registers_branch_scope_fk',
    }).onDelete('restrict'),
    // `devices` has no `(company_id, branch_id, id)` unique constraint to
    // target (its own `branch_id` is nullable — no other FK in this
    // codebase references devices by more than `(company_id, id)`
    // either; see `payments.ts`/`sales.ts`/`sessions.ts`). "Device branch
    // must match" (CORE_DATA_MODEL §6.3) is therefore an application-level
    // check (`CashRegisterService`), the same way `payment_terminals`
    // already validates its own device's branch in TASK 12.4A.
    foreignKey({
      columns: [table.companyId, table.deviceId],
      foreignColumns: [devices.companyId, devices.id],
      name: 'cash_registers_device_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.createdBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'cash_registers_created_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.updatedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'cash_registers_updated_by_membership_fk',
    }).onDelete('restrict'),
    index('cash_registers_company_branch_idx').on(table.companyId, table.branchId),
    index('cash_registers_company_status_idx').on(table.companyId, table.status),
    check('cash_registers_code_nonblank_ck', sql`length(btrim(${table.code})) > 0`),
    check(
      'cash_registers_normalized_code_ck',
      sql`length(${table.normalizedCode}) > 0 and ${table.normalizedCode} = lower(btrim(${table.normalizedCode}))`,
    ),
    check('cash_registers_name_nonblank_ck', sql`length(btrim(${table.name})) > 0`),
    check(
      'cash_registers_status_ck',
      sql`${table.status} in ('active','inactive','retired')`,
    ),
    check('cash_registers_version_ck', sql`${table.version} >= 1`),
    check(
      'cash_registers_retirement_ck',
      sql`(${table.status} = 'retired' and ${table.deletedAt} is not null)
        or (${table.status} <> 'retired' and ${table.deletedAt} is null)`,
    ),
  ],
);

export const cashSessions = pgTable(
  'cash_sessions',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').notNull(),
    cashRegisterId: uuid('cash_register_id').notNull(),
    openedBy: uuid('opened_by').notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true, mode: 'date' }).notNull(),
    openingAmount: numeric('opening_amount', { precision: 19, scale: 4 }).notNull(),
    currencyCode: char('currency_code', { length: 3 }).notNull(),
    status: text('status').notNull().default('open'),
    closedBy: uuid('closed_by'),
    closedAt: timestamp('closed_at', { withTimezone: true, mode: 'date' }),
    declaredClosingAmount: numeric('declared_closing_amount', { precision: 19, scale: 4 }),
    expectedClosingAmount: numeric('expected_closing_amount', { precision: 19, scale: 4 }),
    discrepancyAmount: numeric('discrepancy_amount', { precision: 19, scale: 4 }),
    // Part J: AS POS V1's own `modal-cierre-caja` ("Cierre de caja —
    // Arqueo") canonically collects a bills/coins breakdown before
    // arriving at "Total contado" — confirmed present, so implemented
    // here per Part J's own instruction. It is optional supporting detail
    // for how the cashier reached `declaredClosingAmount`, never a second
    // source of truth: the backend validates
    // `sum(value * quantity) = declared_closing_amount` (service layer)
    // before persisting it, and it is written once, atomically, with the
    // rest of the closure. See ADR-0014.
    denominationCounts: jsonb('denomination_counts'),
    version: bigint('version', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('cash_sessions_company_id_id_uq').on(table.companyId, table.id),
    unique('cash_sessions_company_branch_id_uq').on(table.companyId, table.branchId, table.id),
    // §10 invariant 5 / CORE_DATA_MODEL "at most one open session per
    // register" — enforced at the database level (a partial unique
    // index over `status in ('open','closing')`, not only `'open'`, so
    // a session mid-closure still blocks a second concurrent open).
    uniqueIndex('cash_sessions_register_active_uq')
      .on(table.companyId, table.cashRegisterId)
      .where(sql`${table.status} in ('open','closing')`),
    foreignKey({
      columns: [table.companyId, table.branchId],
      foreignColumns: [branches.companyId, branches.id],
      name: 'cash_sessions_branch_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.branchId, table.cashRegisterId],
      foreignColumns: [cashRegisters.companyId, cashRegisters.branchId, cashRegisters.id],
      name: 'cash_sessions_register_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.openedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'cash_sessions_opened_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.closedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'cash_sessions_closed_by_membership_fk',
    }).onDelete('restrict'),
    index('cash_sessions_company_branch_idx').on(table.companyId, table.branchId),
    index('cash_sessions_company_register_idx').on(table.companyId, table.cashRegisterId),
    index('cash_sessions_company_status_idx').on(table.companyId, table.status),
    check(
      'cash_sessions_status_ck',
      sql`${table.status} in ('open','closing','closed')`,
    ),
    check('cash_sessions_currency_code_ck', sql`${table.currencyCode} ~ '^[A-Z]{3}$'`),
    check('cash_sessions_opening_amount_ck', sql`${table.openingAmount} >= 0`),
    check(
      'cash_sessions_declared_amount_ck',
      sql`${table.declaredClosingAmount} is null or ${table.declaredClosingAmount} >= 0`,
    ),
    check('cash_sessions_version_ck', sql`${table.version} >= 1`),
    check(
      'cash_sessions_closure_fields_ck',
      sql`(${table.status} <> 'closed'
          and ${table.closedAt} is null and ${table.closedBy} is null
          and ${table.declaredClosingAmount} is null and ${table.expectedClosingAmount} is null
          and ${table.discrepancyAmount} is null)
        or (${table.status} = 'closed'
          and ${table.closedAt} is not null and ${table.closedBy} is not null
          and ${table.declaredClosingAmount} is not null and ${table.expectedClosingAmount} is not null
          and ${table.discrepancyAmount} is not null)`,
    ),
    // `denomination_counts` is always optional (the cashier may skip the
    // breakdown), but when present it can only ever exist on a closed
    // session, and it must be a JSON array (never a bare object/scalar).
    check(
      'cash_sessions_denomination_counts_ck',
      sql`${table.denominationCounts} is null
        or (${table.status} = 'closed' and jsonb_typeof(${table.denominationCounts}) = 'array')`,
    ),
  ],
);

export const cashMovements = pgTable(
  'cash_movements',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').notNull(),
    cashSessionId: uuid('cash_session_id').notNull(),
    movementType: text('movement_type').notNull(),
    // §6.3: `amount > 0` always — direction is derived from
    // `movement_type` (see `cash.ts`'s `cashMovementDirection` in the
    // API module), never from the sign of this column.
    amount: numeric('amount', { precision: 19, scale: 4 }).notNull(),
    currencyCode: char('currency_code', { length: 3 }).notNull(),
    reasonCode: text('reason_code').notNull(),
    note: text('note'),
    // TASK 14.4 (Wave 2, Part F.1) — recovers the legacy's real distinct
    // Retiro/Gasto/Ingreso-extra categorization (see
    // `docs/LEGACY_FUNCTIONAL_PARITY.md`'s Caja section) as a real
    // reporting/UX dimension ON TOP OF the existing, unchanged, real
    // `cash_in`/`cash_out` direction — never a second amount/direction
    // source of truth. Nullable and only ever meaningful for a
    // client-postable `cash_in`/`cash_out` movement (never set on
    // `opening_float`/`cash_sale`/`cash_refund`, which are already fully
    // self-describing via `movement_type`).
    category: text('category'),
    // TASK 12.7 Part F: beyond CORE_DATA_MODEL §6.3's baseline field
    // list — a `cash_sale` movement's durable link back to the captured
    // cash Payment it came from, the exact "uniqueness/reference boundary
    // between payment / sale / cash ledger movement" Part F requires.
    // Deliberately keyed by *payment*, not *sale*: a Sale can in
    // principle receive more than one payment (a split payment), and each
    // captured cash Payment must get its own drawer movement — keying by
    // `sale_id` would wrongly block a legitimate second cash payment on
    // the same sale. Paired nullable, mirroring
    // `inventory_movements.reference_type`/`reference_id`; only ever
    // populated for `movement_type='cash_sale'` (a manual cash_in/cash_out
    // has no originating payment).
    referenceType: text('reference_type'),
    referenceId: uuid('reference_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdBy: uuid('created_by').notNull(),
    deviceId: uuid('device_id'),
    reversalOfId: uuid('reversal_of_id'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    unique('cash_movements_company_id_id_uq').on(table.companyId, table.id),
    // TASK 12.7 Part F: the database-level idempotency guarantee — a
    // second `cash_sale` movement for the same captured cash Payment is a
    // constraint violation, mirroring `inventory_movements_sale_reference_uq`
    // (ADR-0013) exactly.
    uniqueIndex('cash_movements_payment_reference_uq')
      .on(table.companyId, table.referenceId)
      .where(sql`${table.referenceType} = 'payment'`),
    // TASK 12.8 (Part F/L): the identical durable guarantee for a
    // completed refund's own cash-out fact — a second `cash_refund`
    // movement for the same refund is a constraint violation, mirroring
    // the payment-reference index immediately above.
    uniqueIndex('cash_movements_refund_reference_uq')
      .on(table.companyId, table.referenceId)
      .where(sql`${table.referenceType} = 'refund'`),
    foreignKey({
      columns: [table.companyId, table.branchId],
      foreignColumns: [branches.companyId, branches.id],
      name: 'cash_movements_branch_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.cashSessionId],
      foreignColumns: [cashSessions.companyId, cashSessions.id],
      name: 'cash_movements_session_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.createdBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'cash_movements_created_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.reversalOfId],
      foreignColumns: [table.companyId, table.id],
      name: 'cash_movements_reversal_of_scope_fk',
    }).onDelete('restrict'),
    index('cash_movements_company_session_idx').on(table.companyId, table.cashSessionId),
    index('cash_movements_company_branch_idx').on(table.companyId, table.branchId),
    index('cash_movements_company_type_idx').on(table.companyId, table.movementType),
    index('cash_movements_session_occurred_idx').on(
      table.companyId,
      table.cashSessionId,
      table.occurredAt,
      table.id,
    ),
    index('cash_movements_company_reference_idx').on(
      table.companyId,
      table.referenceType,
      table.referenceId,
    ),
    check(
      'cash_movements_type_ck',
      sql`${table.movementType} in ('opening_float','cash_sale','cash_in','cash_out','cash_refund')`,
    ),
    check('cash_movements_amount_positive_ck', sql`${table.amount} > 0`),
    check('cash_movements_currency_code_ck', sql`${table.currencyCode} ~ '^[A-Z]{3}$'`),
    check('cash_movements_reason_code_nonblank_ck', sql`length(btrim(${table.reasonCode})) > 0`),
    check(
      'cash_movements_category_ck',
      sql`${table.category} is null or ${table.category} in ('withdrawal', 'expense', 'external_income', 'other')`,
    ),
    // A category, when present, must match a real direction it can
    // actually describe — `withdrawal`/`expense` only ever make sense on
    // a `cash_out`; `external_income` only on a `cash_in`. `other` is
    // valid on either.
    check(
      'cash_movements_category_direction_ck',
      sql`${table.category} is null
        or ${table.category} = 'other'
        or (${table.category} in ('withdrawal', 'expense') and ${table.movementType} = 'cash_out')
        or (${table.category} = 'external_income' and ${table.movementType} = 'cash_in')`,
    ),
    check(
      'cash_movements_not_self_reversal_ck',
      sql`${table.reversalOfId} is null or ${table.reversalOfId} <> ${table.id}`,
    ),
    check(
      'cash_movements_reference_pair_ck',
      sql`(${table.referenceType} is null) = (${table.referenceId} is null)`,
    ),
  ],
);

/**
 * TASK 14.4 (Wave 2, Part F.3) — "Corte parcial," recovered from
 * `docs/LEGACY_FUNCTIONAL_PARITY.md`'s Caja section: a real mid-shift
 * snapshot that does NOT close the session (`cash_sessions.status`
 * never changes because of this). Deliberately a pure, persisted,
 * audited SNAPSHOT of the already-authoritative `GET .../summary`
 * computation at the moment it was taken — never a second drawer-
 * balance source of truth; the live summary endpoint remains the one
 * real-time calculation, this table only remembers what it said at a
 * point in time, for history/print/audit.
 */
export const cashSessionPartialCloses = pgTable(
  'cash_session_partial_closes',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').notNull(),
    cashSessionId: uuid('cash_session_id').notNull(),
    takenAt: timestamp('taken_at', { withTimezone: true, mode: 'date' }).notNull(),
    openingAmount: numeric('opening_amount', { precision: 19, scale: 4 }).notNull(),
    cashSalesTotal: numeric('cash_sales_total', { precision: 19, scale: 4 }).notNull(),
    cashInTotal: numeric('cash_in_total', { precision: 19, scale: 4 }).notNull(),
    cashOutTotal: numeric('cash_out_total', { precision: 19, scale: 4 }).notNull(),
    expectedCash: numeric('expected_cash', { precision: 19, scale: 4 }).notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    unique('cash_session_partial_closes_company_id_id_uq').on(table.companyId, table.id),
    foreignKey({
      columns: [table.companyId, table.branchId],
      foreignColumns: [branches.companyId, branches.id],
      name: 'cash_session_partial_closes_branch_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.cashSessionId],
      foreignColumns: [cashSessions.companyId, cashSessions.id],
      name: 'cash_session_partial_closes_session_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.createdBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'cash_session_partial_closes_created_by_membership_fk',
    }).onDelete('restrict'),
    index('cash_session_partial_closes_company_session_idx').on(table.companyId, table.cashSessionId, table.takenAt),
  ],
);

export type CashRegister = typeof cashRegisters.$inferSelect;
export type CashSession = typeof cashSessions.$inferSelect;
export type CashMovement = typeof cashMovements.$inferSelect;
export type CashSessionPartialClose = typeof cashSessionPartialCloses.$inferSelect;
