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
