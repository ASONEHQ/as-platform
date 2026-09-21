/** §21.1's exact 3 states — never a project-invented name. */
export type CashSessionStatus = 'open' | 'closing' | 'closed';
export const cashSessionStatuses: readonly CashSessionStatus[] = ['open', 'closing', 'closed'];

export type CashRegisterStatus = 'active' | 'inactive' | 'retired';

// TASK 12.8 adds `cash_refund` — system-posted, mirroring `cash_sale`'s
// own precedent exactly (never client-postable through
// `POST /cash-sessions/{id}/movements`). See ADR-0015.
export type CashMovementType = 'opening_float' | 'cash_sale' | 'cash_in' | 'cash_out' | 'cash_refund';
export const cashMovementTypes: readonly CashMovementType[] = [
  'opening_float',
  'cash_sale',
  'cash_in',
  'cash_out',
  'cash_refund',
];
/** Direction encodes the ledger's sign; `cash_movements.amount` itself is
 * always stored positive (`amount > 0`, per CORE_DATA_MODEL §6.3). */
export const cashMovementDirection: Readonly<Record<CashMovementType, 1 | -1>> = {
  opening_float: 1,
  cash_sale: 1,
  cash_in: 1,
  cash_out: -1,
  cash_refund: -1,
};

// TASK 14.4 (Wave 2, Part F.1) — a real reporting/UX dimension ON TOP OF
// the existing, unchanged `cash_in`/`cash_out` direction (never a second
// amount/direction source of truth — `category` never changes
// `movementType`, `amount`, or `cashMovementDirection`). Nullable, and
// only ever meaningful on a client-postable `cash_in`/`cash_out`
// movement — see `packages/database/src/schema/cash.ts`'s
// `cash_movements_category_ck`/`cash_movements_category_direction_ck`,
// which this exact set and direction pairing mirrors verbatim.
export type CashMovementCategory = 'withdrawal' | 'expense' | 'external_income' | 'other';
export const cashMovementCategories: readonly CashMovementCategory[] = [
  'withdrawal',
  'expense',
  'external_income',
  'other',
];
/** The exact direction each category is valid for — `null` means "either
 * direction" (`other`). Mirrors `cash_movements_category_direction_ck`
 * exactly; kept as one small table rather than scattered if/else so the
 * DB check and the pre-DB validation can never quietly drift apart. */
export const cashMovementCategoryDirection: Readonly<Record<CashMovementCategory, CashMovementType | null>> = {
  withdrawal: 'cash_out',
  expense: 'cash_out',
  external_income: 'cash_in',
  other: null,
};

export interface CashRegisterRow {
  id: string;
  companyId: string;
  branchId: string;
  code: string;
  name: string;
  status: CashRegisterStatus;
  deviceId: string | null;
  createdBy: string;
  updatedBy: string;
  version: bigint;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** One denomination line from the Part J cash count (bills/coins). `value`
 * is a canonical money string (e.g. `"500.0000"`), never a float. */
export interface DenominationCount {
  value: string;
  quantity: number;
}

/** The exact bill/coin set AS POS V1's own `modal-cierre-caja` ("Cierre de
 * caja — Arqueo") canonically counts (its `DENOMINACIONES` array) —
 * confirmed present, so reused verbatim rather than inventing a new set
 * (Part J). Ordered highest to lowest, matching V1's own display order. */
export const canonicalCashDenominationsMXN: readonly string[] = [
  '1000.0000',
  '500.0000',
  '200.0000',
  '100.0000',
  '50.0000',
  '20.0000',
  '10.0000',
  '5.0000',
  '2.0000',
  '1.0000',
  '0.5000',
];

/** TASK 16.11 — the real, standard US cash-drawer bill/coin set (bills
 * $100 down to $1, coins quarter/dime/nickel/penny). AS Platform is a
 * multi-tenant SaaS whose own `business.currency` company setting
 * already allows `'MXN' | 'USD'` (see `settings.catalog.ts`) — a USD
 * tenant closing a cash session was, before this task, unconditionally
 * rejected against the MXN set (every real US bill/coin would fail
 * `validateDenominationCounts`'s "is not a recognized MXN denomination"
 * check). Never merged with the MXN set — a real till only ever counts
 * one currency's physical notes/coins at a time. */
export const canonicalCashDenominationsUSD: readonly string[] = [
  '100.0000',
  '50.0000',
  '20.0000',
  '10.0000',
  '5.0000',
  '1.0000',
  '0.2500',
  '0.1000',
  '0.0500',
  '0.0100',
];

/** Selects the real, closed denomination set for a session's own
 * `currency_code` — never a blind MXN default. Only `MXN`/`USD` are
 * approved anywhere in this platform today (`business.currency`'s own
 * catalog allowlist); an unsupported currency is refused with a clear
 * validation error rather than silently falling back to the wrong
 * country's bills/coins. Smallest-sensible, in-code lookup — no new
 * settings key or migration: the session's `currency_code` (itself
 * already resolved from the tenant's own configured currency at
 * session-open time) is the sole, already-authoritative input. */
export function canonicalCashDenominationsForCurrency(currencyCode: string): readonly string[] {
  switch (currencyCode) {
    case 'MXN':
      return canonicalCashDenominationsMXN;
    case 'USD':
      return canonicalCashDenominationsUSD;
    default:
      throw new CashError(
        'validation_error',
        `No approved cash-denomination set exists for currency "${currencyCode}".`,
      );
  }
}

/** TASK 16.14 — one payment method's real captured-sales totals for the
 * `[opened_at, closed_at]` window of a final close, derived from `payments`
 * (never fabricated): `grossSalesTotal` is every payment of this `method`
 * that was EVER captured (`captured_at is not null` — a fully-refunded
 * payment's own `status` later becomes `reversed`, but its `captured_at`
 * is never cleared, so a refunded sale never silently vanishes from its
 * own gross total); `refundsTotal` is every `completed` refund whose own
 * `refund_method` equals this `method`; `netTotal = grossSalesTotal -
 * refundsTotal`. Deliberately NOT the same figure as `expectedCash`/
 * `discrepancyAmount` — those come exclusively from `cash_movements` and
 * this comes exclusively from `payments`/`refunds`; see this task's own
 * `docs/LEGACY_FUNCTIONAL_PARITY.md` section for the full "why these two
 * numbers are allowed to differ" explanation. Only methods that genuinely
 * appear in the window are ever present — never a fabricated zero row for
 * an inert method like "transfer" (see `pos_shell.dart`'s `_PosPayGrid`). */
export interface CashPaymentMethodTotal {
  readonly method: string;
  readonly grossSalesTotal: string;
  readonly refundsTotal: string;
  readonly netTotal: string;
  readonly ticketCount: number;
}

/** TASK 16.14A — one operator-entered physical card-terminal settlement
 * line ("Terminal / referencia" + "Total del ticket"). Free-text `label`
 * (e.g. "BBVA", "Clip", "Terminal 2") — deliberately never a foreign key
 * into `payment_terminals` (that table is a device-pairing registry for a
 * live processor integration; requiring a registered device per branch
 * just to log a settlement ticket would be the "unnecessary hardware-
 * management system" this task explicitly says not to build). No PCI-
 * sensitive field exists here or anywhere in this shape — never a card
 * number, CVV, expiration, or cardholder name (§19). */
export interface CashCardReconciliationEntry {
  readonly id: string;
  readonly label: string;
  readonly amount: string;
  readonly reference: string | null;
  readonly note: string | null;
}

/** `not_applicable` — the session had zero card sales (`systemGrossTotal`
 * is `0`); the operator was never asked to reconcile anything (§10/§6).
 * `pending` — card sales exist but the operator omitted reconciliation
 * entirely (the request carried no `card_reconciliation` key at all) —
 * distinct from `reconciled`/`discrepancy` below, which both require the
 * operator to have explicitly submitted a (possibly empty) entries list.
 * `reconciled` — `terminalTotal - systemNetTotal = 0`. `discrepancy` —
 * that difference is non-zero. Never a client-supplied value — computed
 * exclusively by `CashService.closeSession` from server-authoritative
 * data (§6/§8). */
export type CashCardReconciliationStatus = 'not_applicable' | 'pending' | 'reconciled' | 'discrepancy';

/** TASK 16.14A — "CONCILIACIÓN DE TARJETAS": the frozen final-close
 * comparison of ACCESS GO's own recorded card-payment totals against
 * what the physical card terminal(s) reported. `systemGrossTotal`/
 * `systemRefundTotal`/`systemNetTotal` are derived from the SAME
 * `payment_method_totals` rows already computed for `card_terminal` and
 * `card_manual` (§15 — both belong to terminal settlement: `card_manual`
 * is an operator-recorded card charge with no live processor round-trip,
 * exactly the "physical terminal but no API integration" case this
 * feature reconciles), never a second query. Structurally, completely
 * independent of `expected_closing_amount`/`discrepancy_amount` above —
 * this object is never read by, and never writes to, the cash-drawer
 * math (§3). See `docs/LEGACY_FUNCTIONAL_PARITY.md`'s TASK 16.14A section
 * for the full semantics writeup. */
export interface CashCardReconciliation {
  readonly systemGrossTotal: string;
  readonly systemRefundTotal: string;
  readonly systemNetTotal: string;
  readonly terminalEntries: readonly CashCardReconciliationEntry[];
  readonly terminalTotal: string;
  /** `terminalTotal - systemNetTotal`. Positive = terminal reports more
   * than the system ("Sobrante en terminal"); negative = terminal reports
   * less ("Faltante en terminal"). */
  readonly difference: string;
  readonly status: CashCardReconciliationStatus;
  /** Optional free-text explanation, offered whenever `difference !== 0`
   * (never required — §9/§30 "do not invent a tolerance" applies here
   * exactly as it does to the cash discrepancy reason). */
  readonly note: string | null;
}

export interface CashSessionRow {
  id: string;
  companyId: string;
  branchId: string;
  cashRegisterId: string;
  openedBy: string;
  openedAt: Date;
  openingAmount: string;
  currencyCode: string;
  status: CashSessionStatus;
  closedBy: string | null;
  closedAt: Date | null;
  declaredClosingAmount: string | null;
  expectedClosingAmount: string | null;
  discrepancyAmount: string | null;
  denominationCounts: readonly DenominationCount[] | null;
  // TASK 16.14 — the frozen commercial final-close snapshot. Every field
  // below is `null` for a session closed before this task, for a session
  // still `open`/`closing`, or (financial breakdown fields only) in the
  // vanishingly unlikely event a future code path closes a session
  // without them — the API/UI must render "not available for this close"
  // for `null`, never a fabricated zero. See
  // `packages/database/src/schema/cash.ts`'s own doc comment on these
  // columns for the full backward-compatibility rationale.
  cashSalesTotal: string | null;
  cashSalesCount: number | null;
  cashInTotal: string | null;
  cashOutTotal: string | null;
  withdrawalTotal: string | null;
  expenseTotal: string | null;
  externalIncomeTotal: string | null;
  cashRefundTotal: string | null;
  cashRefundCount: number | null;
  paymentMethodTotals: readonly CashPaymentMethodTotal[] | null;
  operationalSummary: CashPartialCloseOperationalSummary | null;
  discrepancyReason: string | null;
  // TASK 16.14A — `null` only for a session closed before this task (or
  // still open/closing); every close going forward always populates it,
  // even with zero card sales (`status: 'not_applicable'`) — see this
  // type's own doc comment.
  cardReconciliation: CashCardReconciliation | null;
  version: bigint;
  createdAt: Date;
  updatedAt: Date;
}

export interface CashMovementRow {
  id: string;
  companyId: string;
  branchId: string;
  cashSessionId: string;
  movementType: CashMovementType;
  amount: string;
  currencyCode: string;
  reasonCode: string;
  note: string | null;
  referenceType: string | null;
  referenceId: string | null;
  occurredAt: Date;
  createdBy: string;
  deviceId: string | null;
  reversalOfId: string | null;
  createdAt: Date;
  /** TASK 14.4 (Wave 2, Part F.1) — orthogonal to `movementType`; `null`
   * for every system-posted movement and for a manual `cash_in`/
   * `cash_out` the caller chose not to categorize. */
  category: CashMovementCategory | null;
}

/** TASK 16.13 — "Resumen operativo": a reporting-only breakdown of how the
 * business/park is doing during a partial-cut window, deliberately
 * SEPARATE from the cash-truth figures above (`expectedCash` etc.) —
 * never read by any expected-cash/discrepancy computation, and never
 * capable of changing one. Every money field is independently netted
 * (gross minus its own domain's refunds/cancellations) so nothing here
 * ever implies a bigger total than reality — see
 * `docs/LEGACY_FUNCTIONAL_PARITY.md`'s TASK 16.13 section for the exact
 * double-counting analysis this shape encodes.
 *
 * `pos` and `cafeteria` are NOT additive: `cafeteria` is the
 * authoritatively-classified SUBSET of `pos.netSales` that belongs to a
 * category tagged `operational_group = 'cafeteria'` (see
 * `packages/database/src/schema/catalog.ts`), not a second revenue
 * stream on top of it. `events` is a genuinely separate domain — party
 * deposits/payments post to `cash_movements` with
 * `reference_type='party_reservation'`, never to `sales`, so it can never
 * overlap with `pos`/`cafeteria` (see `CashRepository.eventsOperationalSummary`'s
 * own doc comment). */
export interface CashPartialCloseOperationalSummary {
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly pos: {
    readonly grossSales: string;
    readonly refundsTotal: string;
    readonly netSales: string;
    readonly ticketCount: number;
  };
  readonly cafeteria: {
    /** `false` when this company has no category tagged
     * `operational_group = 'cafeteria'` at all — the UI must show "not
     * configured," never a misleading `$0`. */
    readonly available: boolean;
    readonly grossSales: string;
    readonly refundsTotal: string;
    readonly netSales: string;
    readonly ticketCount: number;
    readonly unitsSold: string;
  };
  readonly events: {
    /** Reservations CREATED within [windowStart, windowEnd] — "sold this
     * shift," never conflated with `reservationsOccurringToday`. */
    readonly reservationsCreated: number;
    /** Sum of `quoted_total` for those same (non-cancelled) reservations —
     * accounts-receivable-shaped, never presented as collected revenue. */
    readonly contractedValue: string;
    /** Payments collected so far, but ONLY toward those same
     * window-created reservations. */
    readonly collectedForNewReservations: string;
    /** `contractedValue - collectedForNewReservations`, floored at the
     * fixed-point level, never negative by construction. */
    readonly outstandingForNewReservations: string;
    /** All deposit-purpose payments recorded in the window, for ANY
     * reservation (not only window-created ones) — "cash the events desk
     * took in this shift." */
    readonly depositsCollected: string;
    /** All payments (deposit + balance + additional) recorded in the
     * window, for any reservation. */
    readonly totalCollected: string;
    /** Reservations cancelled (`cancelled_at`) within the window. */
    readonly cancelledCount: number;
    /** Reservations whose `event_date` is the calendar day of `takenAt`,
     * excluding cancelled — "the park is hosting N parties today,"
     * deliberately NOT the same metric as `reservationsCreated`. */
    readonly reservationsOccurringToday: number;
  };
}

/** TASK 14.4 (Wave 2, Part F.3) — "Corte parcial": a persisted, audited
 * SNAPSHOT of exactly what `CashService.summary()` said at `takenAt`.
 * Never a second drawer-balance source of truth — the live `summary()`
 * computation remains the one real-time calculation; this row only
 * remembers what it said, for history/print/audit. Taking one never
 * changes `cashSessions.status`. */
export interface CashSessionPartialCloseRow {
  id: string;
  companyId: string;
  branchId: string;
  cashSessionId: string;
  takenAt: Date;
  openingAmount: string;
  cashSalesTotal: string;
  cashInTotal: string;
  cashOutTotal: string;
  expectedCash: string;
  createdBy: string;
  createdAt: Date;
  // TASK 16.13 — `null` for every partial close taken before this column
  // existed (and for any row where the operational query legitimately
  // found nothing to report). The UI must render "operational breakdown
  // unavailable" for `null`, never synthesize zeros.
  operationalSummary: CashPartialCloseOperationalSummary | null;
}

/** TASK 16.11 (§13) — "Bitácora": one already-real `audit_log` row
 * (written by every `auditAndPublish` call this module already makes),
 * surfaced read-only and scoped to a single cash session's own lifecycle.
 * Never a second, parallel logging mechanism — this is a projection of
 * the existing table, not a new source of truth. */
export interface CashAuditLogEntry {
  id: string;
  branchId: string | null;
  actorType: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Readonly<Record<string, unknown>>;
  occurredAt: Date;
}

export interface CashMutationContext {
  companyId: string;
  actorId: string;
  requestId: string;
  correlationId: string;
  timestamp: Date;
  deviceId?: string | undefined;
}

export type CashErrorCode =
  | 'validation_error'
  | 'idempotency_conflict'
  | 'resource_not_found'
  | 'version_conflict'
  | 'cash_session_required'
  | 'cash_session_already_open'
  | 'cash_session_not_open'
  | 'cash_session_closed'
  // TASK 16.11 (§6) — "Never delete posted financial movements.
  // Corrections must use reversal/compensating architecture." A manual
  // cash_in/cash_out can be reversed; a system-posted movement
  // (opening_float/cash_sale/cash_refund) cannot — its own correction
  // path lives elsewhere (e.g. the sale/refund it mirrors), never here.
  | 'cash_movement_not_reversible'
  // The DB's own cash_movements_reversal_of_uq partial unique index is
  // the durable boundary; this code is the friendly pre-check surfaced
  // before that constraint would otherwise fire.
  | 'cash_movement_already_reversed';

export class CashError extends Error {
  constructor(
    readonly code: CashErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CashError';
  }
}
