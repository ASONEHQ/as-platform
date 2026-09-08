import { cashMovementDirection, type CashMovementType } from '../cash/cash.types.js';
import type { FinancialExportRawRow, ReportsRepository } from './reports.repository.js';
import {
  ReportsError,
  type AccessReport,
  type CurrencyAmount,
  type CustomersReport,
  type EmployeesReport,
  type FinancialReport,
  type InventoryReport,
  type KardexExportRow,
  type PartiesReport,
  type PromotionsReport,
  type ReportFilter,
  type SalesExportRow,
  type SalesReport,
} from './reports.types.js';

// Same fixed-point money convention every other module in this codebase
// uses (see `cash.service.ts`/`purchasing.service.ts`'s own identical
// `MONEY_SCALE`/`moneyUnits`/`formatMoney` trio) — sum in bigint scaled
// units, format once at the boundary. Every string this module ever feeds
// into `moneyUnits` is itself the result of a non-negative SQL
// `sum`/count column (or another `formatMoney` output), so the "always
// non-negative input" assumption these two functions share with their
// `cash.service.ts` counterpart always holds here too.
const MONEY_SCALE = 10_000n;
function moneyUnits(value: string): bigint {
  const [whole = '', fraction = ''] = value.split('.');
  const wholeDigits = whole.length === 0 ? '0' : whole;
  const fractionDigits = fraction.padEnd(4, '0').slice(0, 4);
  return BigInt(wholeDigits) * MONEY_SCALE + BigInt(fractionDigits.length === 0 ? '0' : fractionDigits);
}
function formatMoney(units: bigint): string {
  const negative = units < 0n;
  const magnitude = negative ? -units : units;
  const whole = magnitude / MONEY_SCALE;
  const fraction = (magnitude % MONEY_SCALE).toString().padStart(4, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fraction}`;
}

function subtractByCurrency(minuend: readonly CurrencyAmount[], subtrahend: readonly CurrencyAmount[]): CurrencyAmount[] {
  const totals = new Map<string, bigint>();
  for (const entry of minuend) totals.set(entry.currencyCode, (totals.get(entry.currencyCode) ?? 0n) + moneyUnits(entry.amount));
  for (const entry of subtrahend) totals.set(entry.currencyCode, (totals.get(entry.currencyCode) ?? 0n) - moneyUnits(entry.amount));
  return [...totals.entries()].map(([currencyCode, units]) => ({ currencyCode, amount: formatMoney(units) }));
}

function isKnownMovementType(value: string): value is CashMovementType {
  return value in cashMovementDirection;
}

/** Folds movement totals by direction, using the SAME
 * `cashMovementDirection` table `CashService.summary()`/`closeSession()`
 * import from `cash.types.ts` — never a second, redeclared copy. */
function foldMovementTotalsByDirection(
  totals: readonly { movementType: string; currencyCode: string; amount: string }[],
): CurrencyAmount[] {
  const perCurrency = new Map<string, bigint>();
  for (const total of totals) {
    if (!isKnownMovementType(total.movementType)) continue; // defensive: never a fabricated movement type.
    const direction = cashMovementDirection[total.movementType];
    const signedUnits = moneyUnits(total.amount) * BigInt(direction);
    perCurrency.set(total.currencyCode, (perCurrency.get(total.currencyCode) ?? 0n) + signedUnits);
  }
  return [...perCurrency.entries()].map(([currencyCode, units]) => ({ currencyCode, amount: formatMoney(units) }));
}

function validateDate(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ReportsError('validation_error', `${field} must be an ISO date (YYYY-MM-DD).`);
  if (Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) throw new ReportsError('validation_error', `${field} is not a valid date.`);
}

function validateRange(filter: ReportFilter): void {
  validateDate(filter.dateFrom, 'date_from');
  validateDate(filter.dateTo, 'date_to');
  if (filter.dateFrom > filter.dateTo) throw new ReportsError('validation_error', 'date_from must not be after date_to.');
}

function csvEscape(value: string): string {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function csvRow(values: readonly string[]): string {
  return values.map(csvEscape).join(',') + '\r\n';
}

export class ReportsService {
  public constructor(private readonly repository: ReportsRepository) {}

  // --- Sales --------------------------------------------------------------

  public async salesReport(companyId: string, branchIds: readonly string[], filter: ReportFilter): Promise<SalesReport> {
    validateRange(filter);
    const [salesTotals, refundsTotals] = await Promise.all([
      this.repository.salesTotals(companyId, branchIds, filter),
      this.repository.refundsTotals(companyId, branchIds, filter),
    ]);
    const grossSales = salesTotals.map((row) => ({ currencyCode: row.currencyCode, amount: row.grossSales }));
    const refundsTotal = refundsTotals.map((row) => ({ currencyCode: row.currencyCode, amount: row.refundsTotal }));
    const transactionCount = salesTotals.reduce((sum, row) => sum + row.transactionCount, 0);
    const refundCount = refundsTotals.reduce((sum, row) => sum + row.refundCount, 0);
    const averageTicket = salesTotals
      .filter((row) => row.transactionCount > 0)
      .map((row) => ({
        currencyCode: row.currencyCode,
        amount: formatMoney(moneyUnits(row.grossSales) / BigInt(row.transactionCount)),
      }));
    return {
      dateFrom: filter.dateFrom,
      dateTo: filter.dateTo,
      branchId: filter.branchId ?? null,
      transactionCount,
      grossSales,
      refundCount,
      refundsTotal,
      netSales: subtractByCurrency(grossSales, refundsTotal),
      averageTicket,
    };
  }

  public async salesExportCsv(companyId: string, branchIds: readonly string[], filter: ReportFilter): Promise<string> {
    validateRange(filter);
    const rows = await this.repository.salesExportRows(companyId, branchIds, filter);
    return buildSalesCsv(rows);
  }

  // --- Financial ------------------------------------------------------------

  public async financialReport(companyId: string, branchIds: readonly string[], filter: ReportFilter): Promise<FinancialReport> {
    validateRange(filter);
    const [movementTotals, closedSessions, sessionsOpenedCount] = await Promise.all([
      this.repository.cashMovementTotals(companyId, branchIds, filter),
      this.repository.closedSessionTotals(companyId, branchIds, filter),
      this.repository.sessionsOpenedCount(companyId, branchIds, filter),
    ]);
    return {
      dateFrom: filter.dateFrom,
      dateTo: filter.dateTo,
      branchId: filter.branchId ?? null,
      movementTotals,
      netCashMovement: foldMovementTotalsByDirection(movementTotals),
      closedSessions,
      sessionsOpenedCount,
    };
  }

  public async financialExportCsv(companyId: string, branchIds: readonly string[], filter: ReportFilter): Promise<string> {
    validateRange(filter);
    const rows = await this.repository.financialExportRows(companyId, branchIds, filter);
    return buildFinancialCsv(rows);
  }

  /** Recomputes the exact same fold restricted to a single session's own
   * movements — used by this module's integration test to assert this
   * report can never silently diverge from the real, already-persisted
   * `cash_sessions.expected_closing_amount` (`CashService.closeSession()`'s
   * own fold). Not on any HTTP route — a test-support entry point only. */
  public async netCashMovementForSession(companyId: string, cashSessionId: string): Promise<string> {
    const movements = await this.repository.cashMovementsForSession(companyId, cashSessionId);
    let units = 0n;
    for (const movement of movements) {
      if (!isKnownMovementType(movement.movementType)) continue;
      units += moneyUnits(movement.amount) * BigInt(cashMovementDirection[movement.movementType]);
    }
    return formatMoney(units);
  }

  // --- Inventory ------------------------------------------------------------

  public async inventoryReport(companyId: string, branchIds: readonly string[], filter: ReportFilter): Promise<InventoryReport> {
    validateRange(filter);
    const [balances, inventoryValue, movementVolume] = await Promise.all([
      this.repository.inventoryBalanceTotals(companyId, branchIds, filter.branchId),
      this.repository.inventoryValueByCurrency(companyId, branchIds, filter.branchId),
      this.repository.inventoryMovementVolume(companyId, branchIds, filter),
    ]);
    return {
      dateFrom: filter.dateFrom,
      dateTo: filter.dateTo,
      branchId: filter.branchId ?? null,
      trackedVariantCount: balances.trackedVariantCount,
      quantityOnHandTotal: balances.quantityOnHandTotal,
      quantityReservedTotal: balances.quantityReservedTotal,
      quantityInTransitTotal: balances.quantityInTransitTotal,
      outOfStockVariantCount: balances.outOfStockVariantCount,
      inventoryValue,
      movementVolume,
    };
  }

  // --- Customers ------------------------------------------------------------

  public async customersReport(companyId: string, filter: { dateFrom: string; dateTo: string }): Promise<CustomersReport> {
    validateRange({ ...filter });
    const [customersByStatus, newCustomersInRange, membershipsByStatus, newMembershipsInRange, activeLoyaltyAccountCount] =
      await Promise.all([
        this.repository.customersByStatus(companyId),
        this.repository.newCustomersInRange(companyId, filter),
        this.repository.membershipsByStatus(companyId),
        this.repository.newMembershipsInRange(companyId, filter),
        this.repository.activeLoyaltyAccountCount(companyId),
      ]);
    return {
      dateFrom: filter.dateFrom,
      dateTo: filter.dateTo,
      totalCustomers: customersByStatus.reduce((sum, row) => sum + row.count, 0),
      customersByStatus,
      newCustomersInRange,
      membershipsByStatus,
      newMembershipsInRange,
      activeLoyaltyAccountCount,
    };
  }

  // --- Employees ------------------------------------------------------------

  public async employeesReport(companyId: string, branchIds: readonly string[], filter: ReportFilter): Promise<EmployeesReport> {
    validateRange(filter);
    const [employeesByStatus, punchTotals, distinctEmployeesPunched, payroll] = await Promise.all([
      this.repository.employeesByStatus(companyId, branchIds, filter.branchId),
      this.repository.punchTotals(companyId, branchIds, filter),
      this.repository.distinctEmployeesPunched(companyId, branchIds, filter),
      this.repository.closedPayrollTotals(companyId, branchIds, filter),
    ]);
    const clockInCount = punchTotals.find((row) => row.punchType === 'clock_in')?.count ?? 0;
    const clockOutCount = punchTotals.find((row) => row.punchType === 'clock_out')?.count ?? 0;
    return {
      dateFrom: filter.dateFrom,
      dateTo: filter.dateTo,
      branchId: filter.branchId ?? null,
      employeesByStatus,
      clockInCount,
      clockOutCount,
      distinctEmployeesPunched,
      closedPayrollTotals: payroll.map((row) => ({ currencyCode: row.currencyCode, amount: row.total })),
      closedPayrollPeriodCount: payroll.reduce((sum, row) => sum + row.periodCount, 0),
    };
  }

  // --- Parties ------------------------------------------------------------

  public async partiesReport(companyId: string, branchIds: readonly string[], filter: ReportFilter): Promise<PartiesReport> {
    validateRange(filter);
    const [reservationsByStatus, bookedRevenue, collectedRevenue, activeRoomCount, roomsBookedCount] = await Promise.all([
      this.repository.partyReservationsByStatus(companyId, branchIds, filter),
      this.repository.partyBookedRevenue(companyId, branchIds, filter),
      this.repository.partyCollectedRevenue(companyId, branchIds, filter),
      this.repository.activeRoomCount(companyId, branchIds, filter.branchId),
      this.repository.roomsBookedCount(companyId, branchIds, filter),
    ]);
    return {
      dateFrom: filter.dateFrom,
      dateTo: filter.dateTo,
      branchId: filter.branchId ?? null,
      reservationsByStatus,
      bookedRevenue,
      collectedRevenue,
      activeRoomCount,
      roomsBookedCount,
    };
  }

  // --- Promotions ------------------------------------------------------------

  // TASK 14.5 (Wave 3, Phase 7, Item 4) — the 8th real report area, over
  // the SAME real `coupon_redemptions`/`sale_discounts` tables
  // `PromotionsService` itself already writes to at sale time (see
  // `reports.types.ts`'s own doc comment on `PromotionsReport`).
  public async promotionsReport(
    companyId: string,
    branchIds: readonly string[],
    filter: ReportFilter,
  ): Promise<PromotionsReport> {
    validateRange(filter);
    const [redemptionTotals, discountTotals, topCoupons] = await Promise.all([
      this.repository.couponRedemptionTotals(companyId, branchIds, filter),
      this.repository.discountTotalsBySourceType(companyId, branchIds, filter),
      this.repository.topCoupons(companyId, branchIds, filter),
    ]);
    const promotionTotals = discountTotals.filter((row) => row.sourceType === 'promotion');
    const couponTotals = discountTotals.filter((row) => row.sourceType === 'coupon');
    return {
      dateFrom: filter.dateFrom,
      dateTo: filter.dateTo,
      branchId: filter.branchId ?? null,
      couponRedemptionCount: redemptionTotals.reduce((sum, row) => sum + row.count, 0),
      couponRedemptionsTotal: redemptionTotals.map((row) => ({ currencyCode: row.currencyCode, amount: row.total })),
      promotionDiscountCount: promotionTotals.reduce((sum, row) => sum + row.count, 0),
      promotionDiscountTotal: promotionTotals.map((row) => ({ currencyCode: row.currencyCode, amount: row.total })),
      couponDiscountCount: couponTotals.reduce((sum, row) => sum + row.count, 0),
      couponDiscountTotal: couponTotals.map((row) => ({ currencyCode: row.currencyCode, amount: row.total })),
      topCoupons,
    };
  }

  // --- Inventory Kardex export ------------------------------------------------

  // TASK 14.5 (Wave 3, Phase 7, Item 2) — see `reports.types.ts`'s own doc
  // comment on `KardexExportRow` for the deliberate CSV-not-PDF scoping
  // decision.
  public async kardexExportCsv(
    companyId: string,
    branchIds: readonly string[],
    filter: ReportFilter,
    productVariantId?: string,
  ): Promise<string> {
    validateRange(filter);
    const rows = await this.repository.kardexExportRows(companyId, branchIds, { ...filter, productVariantId });
    return buildKardexCsv(rows);
  }

  // --- Access ------------------------------------------------------------

  public async accessReport(companyId: string, branchIds: readonly string[], filter: ReportFilter): Promise<AccessReport> {
    validateRange(filter);
    const [eventTotals, currentOccupancy] = await Promise.all([
      this.repository.accessEventTotals(companyId, branchIds, filter),
      this.repository.currentOccupancy(companyId, branchIds, filter.branchId),
    ]);
    return {
      dateFrom: filter.dateFrom,
      dateTo: filter.dateTo,
      branchId: filter.branchId ?? null,
      entryCount: eventTotals.find((row) => row.eventType === 'entry')?.count ?? 0,
      exitCount: eventTotals.find((row) => row.eventType === 'exit')?.count ?? 0,
      currentOccupancy,
    };
  }
}

function buildSalesCsv(rows: readonly SalesExportRow[]): string {
  let csv = csvRow([
    'sale_id',
    'sale_number',
    'branch_id',
    'status',
    'occurred_at',
    'completed_at',
    'subtotal',
    'discount_total',
    'tax_total',
    'total',
    'currency_code',
    'customer_display_name',
  ]);
  for (const row of rows) {
    csv += csvRow([
      row.id,
      row.saleNumber,
      row.branchId,
      row.status,
      row.occurredAt.toISOString(),
      row.completedAt === null ? '' : row.completedAt.toISOString(),
      row.subtotal,
      row.discountTotal,
      row.taxTotal,
      row.total,
      row.currencyCode,
      row.customerDisplayName ?? '',
    ]);
  }
  return csv;
}

function buildKardexCsv(rows: readonly KardexExportRow[]): string {
  let csv = csvRow([
    'movement_id',
    'movement_number',
    'movement_type',
    'branch_id',
    'occurred_at',
    'posted_at',
    'reference_type',
    'reference_id',
    'movement_reason_code',
    'line_number',
    'product_variant_id',
    'sku',
    'product_name',
    'quantity',
    'unit_of_measure_code',
    'base_quantity',
    'unit_cost',
    'extended_cost',
    'currency_code',
    'source_location_id',
    'destination_location_id',
    'line_reason_code',
  ]);
  for (const row of rows) {
    csv += csvRow([
      row.movementId,
      row.movementNumber,
      row.movementType,
      row.branchId,
      row.occurredAt.toISOString(),
      row.postedAt === null ? '' : row.postedAt.toISOString(),
      row.referenceType ?? '',
      row.referenceId ?? '',
      row.movementReasonCode ?? '',
      String(row.lineNumber),
      row.productVariantId,
      row.sku,
      row.productName,
      row.quantity,
      row.unitOfMeasureCode,
      row.baseQuantity,
      row.unitCost ?? '',
      row.extendedCost ?? '',
      row.currencyCode ?? '',
      row.sourceLocationId ?? '',
      row.destinationLocationId ?? '',
      row.lineReasonCode ?? '',
    ]);
  }
  return csv;
}

function buildFinancialCsv(rows: readonly FinancialExportRawRow[]): string {
  let csv = csvRow([
    'movement_id',
    'branch_id',
    'cash_session_id',
    'movement_type',
    'direction',
    'amount',
    'currency_code',
    'category',
    'reason_code',
    'occurred_at',
  ]);
  for (const row of rows) {
    const direction = isKnownMovementType(row.movementType) ? cashMovementDirection[row.movementType] : 1;
    csv += csvRow([
      row.id,
      row.branchId,
      row.cashSessionId,
      row.movementType,
      String(direction),
      row.amount,
      row.currencyCode,
      row.category ?? '',
      row.reasonCode,
      row.occurredAt.toISOString(),
    ]);
  }
  return csv;
}
