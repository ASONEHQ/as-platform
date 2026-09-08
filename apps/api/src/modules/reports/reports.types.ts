/**
 * TASK 14.4 (Wave 2, Part D) — "Reportes / BI" (Report Center). Recovered
 * from `docs/LEGACY_FUNCTIONAL_PARITY.md`'s Reportes/BI section — the
 * legacy version's per-area reports (Ventas/Financiero/Inventario/
 * Clientes/Empleados/Fiestas/Accesos) were "REAL, mostly computed via
 * array reduces," EXCEPT for two fields admittedly hardcoded even in the
 * legacy itself (`prom_estancia=95` and a water-park occupancy metric
 * hardcoded to 0 — see that document's own §12 classification). Neither
 * of those two, nor any other invented metric, is reproduced anywhere in
 * this module: every figure below is computed fresh, with real SQL
 * aggregation, from this platform's own already-authoritative tables
 * (sales/refunds, cash_movements/cash_sessions, inventory_balances/
 * inventory_movements, customers/customer_memberships/loyalty_accounts,
 * employees/time_clock_punches/payroll_period_lines, party_reservations/
 * party_reservation_payments/party_rooms, access_credentials/
 * access_events). Where the legacy had a metric with no real backing data
 * source in the current schema (e.g. average-stay duration), it is simply
 * OMITTED here — never replaced with a placeholder or a fabricated number.
 *
 * Every report is scoped by the caller's own `companyId` and
 * `permittedBranchIds` (never a project-invented "admin sees everything"
 * bypass) — mirrors every other Wave 1/2 module's own established
 * `requirePermission`/branch-array-filter convention exactly (see
 * `purchasing.routes.ts`). A single coarse `report.read` permission code
 * (already seeded — see `packages/database/src/seeds/technical-
 * permissions.ts`) gates every endpoint in this module; the underlying
 * queries are what actually restrict which company/branch rows come back.
 */

export interface ReportDateRange {
  /** 'YYYY-MM-DD', inclusive. Required on every report — no report here
   * ever silently defaults to "all time." */
  readonly dateFrom: string;
  /** 'YYYY-MM-DD', inclusive. */
  readonly dateTo: string;
}

export interface ReportFilter extends ReportDateRange {
  readonly branchId?: string | undefined;
}

/** Money is always kept PER CURRENCY — this platform is multi-tenant and
 * a report must never silently sum two different currencies into one
 * meaningless total. In practice, a single company almost always operates
 * in one currency, so these arrays usually carry exactly one entry — but
 * the shape never assumes that. */
export interface CurrencyAmount {
  readonly currencyCode: string;
  readonly amount: string;
}

export interface StatusCount {
  readonly status: string;
  readonly count: number;
}

// --- Sales ------------------------------------------------------------

export interface SalesReport {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly branchId: string | null;
  /** Only `status='completed'` sales count as real revenue — a
   * `pending_payment`/`cancelled`/`rejected` sale never contributes here
   * (per this task's own instruction: only completed/non-void rows are
   * real revenue). */
  readonly transactionCount: number;
  readonly grossSales: readonly CurrencyAmount[];
  /** Only `status='completed'` refunds — a `requested`/`rejected`/
   * `cancelled` refund never actually paid money back. */
  readonly refundCount: number;
  readonly refundsTotal: readonly CurrencyAmount[];
  readonly netSales: readonly CurrencyAmount[];
  readonly averageTicket: readonly CurrencyAmount[];
}

export interface SalesExportRow {
  readonly id: string;
  readonly saleNumber: string;
  readonly branchId: string;
  readonly status: string;
  readonly occurredAt: Date;
  readonly completedAt: Date | null;
  readonly subtotal: string;
  readonly discountTotal: string;
  readonly taxTotal: string;
  readonly total: string;
  readonly currencyCode: string;
  readonly customerDisplayName: string | null;
}

// --- Financial ----------------------------------------------------------

export interface CashMovementTotal {
  readonly movementType: string;
  readonly currencyCode: string;
  readonly amount: string;
  readonly count: number;
}

export interface ClosedSessionTotal {
  readonly currencyCode: string;
  readonly sessionCount: number;
  readonly declaredClosingTotal: string;
  readonly expectedClosingTotal: string;
  readonly discrepancyTotal: string;
}

export interface FinancialReport {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly branchId: string | null;
  /** Every `cash_movements` row in range, grouped by (movement_type,
   * currency_code) via real SQL `sum`/`group by` — never more than one
   * row fetched per group regardless of how many individual movements
   * exist in the range. */
  readonly movementTotals: readonly CashMovementTotal[];
  /** `movementTotals` folded by direction using the SAME
   * `cashMovementDirection` table `CashService.summary()`/`closeSession()`
   * use — imported directly from `../cash/cash.types.js`, never
   * re-declared — so this can never silently diverge from the real
   * cash-session summary endpoint. For any cash session that both opened
   * AND closed fully inside this date range, restricting this same fold
   * to just that session's own movements reproduces that session's own
   * `expected_closing_amount` exactly (asserted directly in this module's
   * integration test). */
  readonly netCashMovement: readonly CurrencyAmount[];
  /** Sessions actually CLOSED within the range — real, already-computed
   * figures read straight off `cash_sessions` (never recomputed/guessed
   * here), the same values `CashService.closeSession()` persisted at
   * closing time. */
  readonly closedSessions: readonly ClosedSessionTotal[];
  readonly sessionsOpenedCount: number;
}

export interface FinancialExportRow {
  readonly id: string;
  readonly branchId: string;
  readonly cashSessionId: string;
  readonly movementType: string;
  readonly amount: string;
  readonly direction: 1 | -1;
  readonly currencyCode: string;
  readonly category: string | null;
  readonly reasonCode: string;
  readonly occurredAt: Date;
}

// --- Inventory ------------------------------------------------------------

export interface InventoryMovementVolume {
  readonly movementType: string;
  readonly movementCount: number;
  readonly totalBaseQuantity: string;
}

export interface InventoryReport {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly branchId: string | null;
  /** A live, present-moment snapshot of `inventory_balances` — never
   * date-filtered. No historical "balance as of a past date"
   * reconstruction exists anywhere in this platform; fabricating one here
   * would violate this task's own "never invent a data source" rule, so
   * the date range below applies only to `movementVolume`. */
  readonly trackedVariantCount: number;
  readonly quantityOnHandTotal: string;
  readonly quantityReservedTotal: string;
  readonly quantityInTransitTotal: string;
  readonly outOfStockVariantCount: number;
  readonly inventoryValue: readonly CurrencyAmount[];
  readonly movementVolume: readonly InventoryMovementVolume[];
}

// --- Customers ------------------------------------------------------------

export interface CustomersReport {
  readonly dateFrom: string;
  readonly dateTo: string;
  /** No branch dimension — `customers` is a company-scoped identity in
   * this schema (see `packages/database/src/schema/customers.ts`'s own
   * doc comment); this report never fabricates a per-branch split the
   * data model doesn't have. */
  readonly totalCustomers: number;
  readonly customersByStatus: readonly StatusCount[];
  readonly newCustomersInRange: number;
  readonly membershipsByStatus: readonly StatusCount[];
  readonly newMembershipsInRange: number;
  readonly activeLoyaltyAccountCount: number;
}

// --- Employees ------------------------------------------------------------

export interface EmployeesReport {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly branchId: string | null;
  readonly employeesByStatus: readonly StatusCount[];
  readonly clockInCount: number;
  readonly clockOutCount: number;
  readonly distinctEmployeesPunched: number;
  /** Payroll totals for periods already CLOSED (`payroll_periods.status
   * = 'closed'`) whose own `[period_start, period_end]` window overlaps
   * the requested range — never a draft/open period's figures, which are
   * explicitly still-mutable estimates, not settled payroll fact. */
  readonly closedPayrollTotals: readonly CurrencyAmount[];
  readonly closedPayrollPeriodCount: number;
}

// --- Parties ------------------------------------------------------------

export interface PartiesReport {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly branchId: string | null;
  /** Filtered by `event_date` (the business-relevant date), not
   * `created_at`. */
  readonly reservationsByStatus: readonly StatusCount[];
  /** `quoted_total` for non-cancelled reservations whose event falls in
   * range — the booked/quoted figure, frozen at booking time. */
  readonly bookedRevenue: readonly CurrencyAmount[];
  /** The real cash actually collected in range, from
   * `party_reservation_payments` (each row a real, already-posted
   * `cash_movements` fact — see that table's own doc comment) — filtered
   * by when the payment was recorded, independent of the event date. */
  readonly collectedRevenue: readonly CurrencyAmount[];
  readonly activeRoomCount: number;
  readonly roomsBookedCount: number;
}

// --- Access ------------------------------------------------------------

export interface AccessReport {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly branchId: string | null;
  readonly entryCount: number;
  readonly exitCount: number;
  /** A live, present-moment snapshot (`currently_inside = 'true'`) — not
   * date-filtered, for the same "never fabricate history" reason
   * `InventoryReport`'s balances are not. */
  readonly currentOccupancy: number;
}

// --- Errors ------------------------------------------------------------

/** Both codes already exist in `packages/errors`' `InfrastructureErrorCode`
 * union — no new error code is needed for this module (see this task's
 * final report). */
export type ReportsErrorCode = 'validation_error' | 'resource_not_found';

export class ReportsError extends Error {
  constructor(
    readonly code: ReportsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ReportsError';
  }
}
