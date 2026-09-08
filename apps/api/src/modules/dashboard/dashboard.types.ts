import type { CurrencyAmount } from '../reports/reports.types.js';

/**
 * TASK 14.5 (Wave 3, Phase 2) — "Dashboard" (today at a glance). Recovered
 * from the legacy `AS POS V1.html`'s own `renderDashboard()` (see
 * `docs/LEGACY_FUNCTIONAL_PARITY.md` §12: "Dashboard (sales trend, today's
 * parties, memberships, alerts) | REAL, computed from live in-memory
 * arrays"). This module is a THIN read-only aggregation layer over
 * already-authoritative modules — it never re-implements their SQL, only
 * composes their already-real query results (`ReportsService.salesReport`/
 * `accessReport`/`inventoryReport`, `CashService.listSessions`/
 * `listRegisters`, `PartyReservationsService.listReservations`,
 * `PartyRoomsService.listRooms`) plus exactly two genuinely NEW aggregate
 * queries this module owns because no existing endpoint already exposes
 * them (`DashboardRepository.outstandingPartyBalances`/
 * `clockedInEmployeeCount` — see that file's own doc comment for why).
 *
 * TASK 14.5A (final legacy parity correction) adds the two remaining
 * genuinely-real `renderDashboard()` figures that Wave 3 Phase 2
 * deliberately deferred:
 *  - "vs. yesterday" percent change (`vsAyer` in the legacy,
 *    `comparativoAyer:ventasDia[5].ventas` → `renderDashboard()` lines
 *    10823/10832-10836) — a real percent-change computed from a real
 *    prior-day sales total, reusing `ReportsService.salesReport` for
 *    yesterday exactly as it is already reused for today (never a second,
 *    divergent sales query). `pctChange` is `null` (never a fabricated 0)
 *    when yesterday had zero real sales — the legacy's own honest "Sin
 *    datos de ayer" case (see `salesTrend` in `dashboard.service.ts`).
 *  - birthday alerts (`generarAlertas()` lines 10957-10976 — an exact
 *    month/day match against each customer's real `birth_date`) — real
 *    customers whose birth date matches the requested `date`'s month/day,
 *    company-scoped (the `customers` table's own identity boundary is
 *    COMPANY-scoped only — see `customers.ts`'s header comment — mirroring
 *    `outstandingPartyBalances`'s identical company-wide scope decision
 *    for the same structural reason).
 * Active-membership count (`kpi-mems` in the legacy) remains out of this
 * task's scope — not requested by TASK 14.5A either.
 */

export interface DashboardPartyReservation {
  readonly id: string;
  readonly roomId: string;
  /** `null` only if the room lookup itself came back empty (never
   * fabricated — see `dashboard.service.ts`'s room-name join). */
  readonly roomName: string | null;
  readonly customerDisplayName: string | null;
  readonly celebrantName: string | null;
  readonly startTime: string;
  readonly endTime: string;
  readonly status: string;
}

/** One currency's real today-vs-yesterday sales comparison — mirrors the
 * legacy `vsAyer` computation exactly (see this file's header comment).
 * `todayTotal`/`yesterdayTotal` are the exact same ADR-0001 decimal-string
 * money representation `CurrencyAmount.amount` uses everywhere else in
 * this codebase. */
export interface DashboardSalesTrendEntry {
  readonly currencyCode: string;
  readonly todayTotal: string;
  readonly yesterdayTotal: string;
  /** `null` only when yesterday's real total for this currency was zero —
   * never a fabricated 0 or `NaN` (see this file's header comment). */
  readonly pctChange: number | null;
}

/** A real customer whose `birth_date` month/day matches the requested
 * `date` — see this file's header comment. Minimal exposure by design
 * (id + display name only), matching the legacy's own minimal
 * `cumpleHoy.map(c=>c.nombre)` — never the full birth date/year. */
export interface DashboardBirthdayCustomer {
  readonly id: string;
  readonly displayName: string;
}

export interface DashboardOpenCashSession {
  readonly cashSessionId: string;
  readonly cashRegisterId: string;
  /** `null` only if the register lookup came back empty (e.g. a register
   * outside the requested branch scope — never fabricated). */
  readonly cashRegisterName: string | null;
  readonly cashRegisterCode: string | null;
  readonly branchId: string;
  readonly openedAt: string;
  readonly openingAmount: string;
  readonly currencyCode: string;
}

export interface DashboardSummary {
  /** 'YYYY-MM-DD' — the single day this summary was computed for. */
  readonly date: string;
  readonly branchId: string | null;

  /** Reuses `ReportsService.salesReport` for a single-day range — only
   * `completed` sales count, exactly like the Sales report. */
  readonly salesTransactionCount: number;
  readonly salesGrossTotal: readonly CurrencyAmount[];

  /** Real today-vs-yesterday percent change per currency — see this
   * file's header comment and `dashboard.service.ts`'s `salesTrend`. */
  readonly salesTrendVsYesterday: readonly DashboardSalesTrendEntry[];

  /** Reuses `ReportsService.accessReport`'s own live, present-moment
   * `currentOccupancy` snapshot (never date-filtered). */
  readonly currentOccupancy: number;

  /** Today's party reservations (`event_date = date`), scoped the same
   * way `PartyReservationsService.listReservations` already scopes every
   * other caller — never re-implemented. */
  readonly partyReservationCount: number;
  readonly partyReservations: readonly DashboardPartyReservation[];

  /** Currently-open cash sessions for the requested scope, straight off
   * `CashService.listSessions({status:'open'})` — never recomputed. */
  readonly openCashSessionCount: number;
  readonly openCashSessions: readonly DashboardOpenCashSession[];

  /** Sum of (quoted_total - payments) for reservations that are not yet
   * cancelled/completed, company-wide across every branch the caller's
   * session permits (NOT date-windowed — see `dashboard.service.ts`'s own
   * doc comment for why "outstanding" is treated as a standing balance,
   * not a single day's figure). */
  readonly outstandingPartyBalances: readonly CurrencyAmount[];

  /** Employees whose most recent punch for `date` is `clock_in` (i.e. no
   * later `clock_out` the same day) — see
   * `DashboardRepository.clockedInEmployeeCount`'s own doc comment. */
  readonly clockedInEmployeeCount: number;

  /** Reuses `ReportsService.inventoryReport`'s own real, already-computed
   * `outOfStockVariantCount` (a live snapshot, never date-filtered) as the
   * one inventory "alert" backed by an existing, real threshold rule
   * (quantity_on_hand = 0) — see `docs/LEGACY_FUNCTIONAL_PARITY.md` §4.
   * No new low-stock threshold concept is invented here. */
  readonly outOfStockVariantCount: number;

  /** Real customers whose `birth_date` month/day matches `date` — see
   * this file's header comment and `DashboardRepository.birthdaysOn`. */
  readonly birthdaysToday: readonly DashboardBirthdayCustomer[];
}

export type DashboardErrorCode = 'validation_error' | 'resource_not_found';

export class DashboardError extends Error {
  constructor(
    readonly code: DashboardErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DashboardError';
  }
}
