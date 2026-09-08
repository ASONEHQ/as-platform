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
 * Two legacy dashboard fields are DELIBERATELY NOT ported here:
 *  - "vs. yesterday" percent change (`vsAyer` in the legacy) — this task's
 *    own instruction #4 forbids ever fabricating a trend/growth
 *    percentage on a first-real-metrics screen; the legacy's own value was
 *    real (computed from a real prior-day total), but reproducing a
 *    percent-vs-yesterday comparison was never asked for and this module
 *    sticks to exactly the metric list the task specifies.
 *  - active-membership count (`kpi-mems` in the legacy) — not in this
 *    task's required metric list either; omitted rather than guessed at.
 * Neither omission is because the underlying legacy figure was fake (both
 * were real, per §12) — they are simply out of this task's explicit scope.
 * The two admitted-fake legacy BI-tab fields (`prom_estancia`=95,
 * always-0 water-park occupancy — §12's *Business Intelligence tab* row,
 * not the *Dashboard* row) were never part of `renderDashboard()` itself
 * and are correctly absent from Wave 2's report center already; nothing
 * new to exclude here.
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
