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
    // TASK 16.14 — "CERRAR CAJA" commercial final close. Every column
    // below is nullable and, like `denomination_counts` above, can ONLY
    // ever be non-null on a `closed` row (see the asymmetric check
    // constraints below) — but unlike `denomination_counts`, these are
    // never optional-by-choice for a NEW close: `CashService.closeSession`
    // always populates them going forward. They stay nullable purely for
    // backward compatibility with every session closed before this task
    // (§25) — an old closed row simply has all of them `null`, and the
    // API/UI must render an honest "not available for this close" rather
    // than fabricate zeros. None of these columns are ever read back into
    // `expected_closing_amount`/`discrepancy_amount` — those two remain
    // computed exclusively from the immutable `cash_movements` ledger, and
    // stay the single source of cash-truth exactly as before this task.
    //
    // Financial breakdown — a frozen mirror of `CashSessionSummary`'s own
    // shape (`CashService.summary`), reused verbatim rather than
    // reinvented, plus the two new `cash_refund_*` fields that summary()
    // itself gains in this task (a movement-type bucket that was already
    // folded into `expected_cash` but never separately surfaced before).
    // Freezing these here (rather than only relying on `cash_movements`
    // being immutable once closed, which would also be mathematically
    // safe) matches this table's own existing convention: the row is
    // meant to be self-contained historical evidence, readable without a
    // join, exactly like `declared_closing_amount`/`expected_closing_
    // amount`/`discrepancy_amount` already are.
    cashSalesTotal: numeric('cash_sales_total', { precision: 19, scale: 4 }),
    cashSalesCount: integer('cash_sales_count'),
    cashInTotal: numeric('cash_in_total', { precision: 19, scale: 4 }),
    cashOutTotal: numeric('cash_out_total', { precision: 19, scale: 4 }),
    withdrawalTotal: numeric('withdrawal_total', { precision: 19, scale: 4 }),
    expenseTotal: numeric('expense_total', { precision: 19, scale: 4 }),
    externalIncomeTotal: numeric('external_income_total', { precision: 19, scale: 4 }),
    cashRefundTotal: numeric('cash_refund_total', { precision: 19, scale: 4 }),
    cashRefundCount: integer('cash_refund_count'),
    // Commercial payment-method summary (TASK 16.14 §6) — real captured
    // `payments` totals grouped by `payment_method`, for the SAME
    // `[opened_at, closed_at]` window as `operational_summary` below.
    // Deliberately NEVER read by `expected_closing_amount`/
    // `discrepancy_amount` (cash-drawer truth is `cash_movements`-only) —
    // this is the separate, explicitly-labeled "sales by tender" report
    // the task requires never be confused with expected cash. An array of
    // `{method, gross_sales_total, refunds_total, net_total, ticket_count}`
    // — only methods that genuinely appear in captured payments/completed
    // refunds for the window are ever included, never a fabricated
    // "Transferencia" line (the POS's own Transfer button is inert —
    // see `pos_shell.dart`'s `_PosPayGrid` doc comment).
    paymentMethodTotals: jsonb('payment_method_totals').$type<
      readonly Readonly<{
        method: string;
        grossSalesTotal: string;
        refundsTotal: string;
        netTotal: string;
        ticketCount: number;
      }>[]
    >(),
    // The exact same "Resumen operativo" snapshot shape TASK 16.13 already
    // established on `cash_session_partial_closes.operational_summary` —
    // reused, not reinvented, for the SAME `[opened_at, closed_at]`
    // window. See that column's own doc comment for the full double-
    // counting analysis, which applies identically here.
    operationalSummary: jsonb('operational_summary').$type<Readonly<Record<string, unknown>>>(),
    // TASK 16.14 §12 — an OPTIONAL, free-text explanation for a non-zero
    // `discrepancy_amount`. Never required to close (this task's own
    // instruction: "do not invent a tolerance," "do not prevent close
    // solely because there is a difference") — the backend never
    // conditions the close transition on this field's presence, size of
    // `discrepancy_amount`, or anything else. When present, it is
    // immutable audit evidence exactly like every other closure field.
    discrepancyReason: text('discrepancy_reason'),
    // TASK 16.14A — "CONCILIACIÓN DE TARJETAS": comparing ACCESS GO's own
    // recorded card-payment totals (from `payments`/`refunds`, the exact
    // same `card_terminal`+`card_manual` rows already summed into
    // `payment_method_totals` above) against what a physical card
    // terminal's own settlement/lote ticket reports — entered manually by
    // the operator, never fetched from any terminal API (Mercado Pago
    // stays paused; this is not a processor integration). Same asymmetric
    // nullable pattern as every other TASK 16.14 column: only settable
    // when `status = 'closed'`, never required even then. Unlike
    // `payment_method_totals`, this IS always populated by
    // `CashService.closeSession` going forward — even a session with zero
    // card sales gets a `status: 'not_applicable'` object here, never a
    // fabricated pending/reconciled state — so `null` unambiguously means
    // "closed before this task." One JSONB blob (terminal entries are
    // free-text label/amount/reference/note — no `payment_terminals` FK:
    // that table is a device-pairing registry for a live processor
    // integration, and requiring every branch to register a device just
    // to log a settlement ticket would be exactly the "unnecessary
    // hardware-management system" this task says not to build) rather
    // than a child table, mirroring `operational_summary`'s own
    // self-contained-JSON convention. See `cash.types.ts`'s
    // `CashCardReconciliation` for the exact shape and
    // `docs/LEGACY_FUNCTIONAL_PARITY.md`'s TASK 16.14A section for the
    // full system-total/difference/status semantics.
    cardReconciliation: jsonb('card_reconciliation').$type<Readonly<Record<string, unknown>>>(),
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
    // TASK 16.14 — every new commercial-close field mirrors
    // `denomination_counts`'s own asymmetric pattern exactly: each can
    // ONLY exist on a closed row, but is never REQUIRED to (a session
    // closed before this task, or by future code that somehow skips one,
    // stays a valid row with that field `null` — never a constraint
    // violation, never a fabricated value). Never a symmetric
    // all-or-nothing group like `cash_sessions_closure_fields_ck` above,
    // deliberately, for that backward-compatibility reason.
    check(
      'cash_sessions_cash_refund_total_ck',
      sql`${table.cashRefundTotal} is null or ${table.status} = 'closed'`,
    ),
    check(
      'cash_sessions_cash_refund_count_ck',
      sql`${table.cashRefundCount} is null or ${table.status} = 'closed'`,
    ),
    check(
      'cash_sessions_financial_breakdown_ck',
      sql`(${table.cashSalesTotal} is null and ${table.cashSalesCount} is null
          and ${table.cashInTotal} is null and ${table.cashOutTotal} is null
          and ${table.withdrawalTotal} is null and ${table.expenseTotal} is null
          and ${table.externalIncomeTotal} is null)
        or ${table.status} = 'closed'`,
    ),
    check(
      'cash_sessions_payment_method_totals_ck',
      sql`${table.paymentMethodTotals} is null
        or (${table.status} = 'closed' and jsonb_typeof(${table.paymentMethodTotals}) = 'array')`,
    ),
    check(
      'cash_sessions_operational_summary_ck',
      sql`${table.operationalSummary} is null or ${table.status} = 'closed'`,
    ),
    // A discrepancy reason, when present, must be real text — never an
    // empty/whitespace-only string silently accepted (mirrors
    // `cash_movements_reason_code_nonblank_ck`'s own convention).
    check(
      'cash_sessions_discrepancy_reason_ck',
      sql`${table.discrepancyReason} is null
        or (${table.status} = 'closed' and length(btrim(${table.discrepancyReason})) > 0)`,
    ),
    // TASK 16.14A — same shape as `cash_sessions_payment_method_totals_ck`:
    // only ever non-null on a closed row, and when present must be a real
    // JSON object (never a bare array/scalar).
    check(
      'cash_sessions_card_reconciliation_ck',
      sql`${table.cardReconciliation} is null
        or (${table.status} = 'closed' and jsonb_typeof(${table.cardReconciliation}) = 'object')`,
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
    // TASK 16.11 — the database-level guarantee that a given manual
    // movement can never be reversed twice (`reversal_of_id` was already
    // a real column, but nothing previously stopped two separate
    // compensating rows from both pointing at the same original
    // movement). Mirrors the payment/refund reference-uniqueness indexes
    // immediately above exactly.
    uniqueIndex('cash_movements_reversal_of_uq')
      .on(table.companyId, table.reversalOfId)
      .where(sql`${table.reversalOfId} is not null`),
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
    // TASK 16.13 — "Resumen operativo" (Ventas/Taquilla, Cafetería/Snacks,
    // Eventos/Fiestas): a frozen SNAPSHOT of the operational-sales report
    // computed at `taken_at`, mirroring every other column on this table
    // exactly (never recalculated when a historical partial close is
    // reopened later — see `CashRepository.operationalSummary`). Purely
    // additive reporting alongside the pre-existing cash-truth columns
    // above; never read by any expected-cash/discrepancy computation.
    // Nullable so every pre-TASK-16.13 row (and any row inserted before
    // this column existed) stays valid and readable — a `null` here means
    // "no operational snapshot was taken," never "all zeros."
    operationalSummary: jsonb('operational_summary').$type<Readonly<Record<string, unknown>>>(),
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
