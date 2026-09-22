import type { CashService } from '../cash/cash.service.js';
import type { PartyReservationsService } from '../parties/party-reservations.service.js';
import type { PartyRoomsService } from '../parties/party-rooms.service.js';
import type { ReportsService } from '../reports/reports.service.js';
import type { CurrencyAmount } from '../reports/reports.types.js';
import type { DashboardRepository } from './dashboard.repository.js';
import {
  DashboardError,
  type DashboardOpenCashSession,
  type DashboardPartyReservation,
  type DashboardSalesTrendEntry,
  type DashboardSummary,
} from './dashboard.types.js';

// Same fixed-point money convention every other module in this codebase
// uses (see `reports.service.ts`'s own identical doc comment/trio) — a
// private copy per module is the established pattern here, not a
// violation of it.
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

function validateDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new DashboardError('validation_error', 'date must be an ISO date (YYYY-MM-DD).');
  if (Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) throw new DashboardError('validation_error', 'date is not a valid date.');
}

/** The calendar day immediately before `date` (UTC, matching
 * `validateDate`'s own UTC parsing) — TASK 14.5A's "yesterday" for the
 * sales trend comparison, never the device/server wall clock (the whole
 * summary is already parameterized by `date`, so "yesterday" is always
 * relative to THAT date, exactly like the legacy's own `ventasDia[5]`
 * kept a rolling per-day array indexed off "today"). */
function previousIsoDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}

/** Real today-vs-yesterday percent change per currency — mirrors the
 * legacy `renderDashboard()`'s own
 * `vsAyer=ayer>0?Math.round((ventasHoy-ayer)/ayer*100):0` (lines
 * 10832-10836) exactly, EXCEPT `pctChange` is `null` (never a fabricated
 * 0) when yesterday had zero real sales — the legacy's own honest "Sin
 * datos de ayer" case, which its `0` fallback actually threw away; this
 * port keeps the "no data" distinction the legacy's own UI already made
 * elsewhere. Bigint-scaled money throughout (this file's own
 * `MONEY_SCALE` trio) — `Number(...)` conversion only at the very last
 * step, for the same real-valued (never money-precision-sensitive)
 * `Math.round` percentage the legacy itself computed. */
function salesTrend(
  todayTotals: readonly CurrencyAmount[],
  yesterdayTotals: readonly CurrencyAmount[],
): DashboardSalesTrendEntry[] {
  const todayByCurrency = new Map(todayTotals.map((entry) => [entry.currencyCode, entry.amount]));
  const yesterdayByCurrency = new Map(yesterdayTotals.map((entry) => [entry.currencyCode, entry.amount]));
  const currencies = [...new Set([...todayByCurrency.keys(), ...yesterdayByCurrency.keys()])].sort();
  return currencies.map((currencyCode) => {
    const todayUnits = moneyUnits(todayByCurrency.get(currencyCode) ?? '0');
    const yesterdayUnits = moneyUnits(yesterdayByCurrency.get(currencyCode) ?? '0');
    const pctChange = yesterdayUnits === 0n ? null : Math.round((Number(todayUnits - yesterdayUnits) / Number(yesterdayUnits)) * 100);
    return {
      currencyCode,
      todayTotal: formatMoney(todayUnits),
      yesterdayTotal: formatMoney(yesterdayUnits),
      pctChange,
    };
  });
}

/**
 * TASK 14.5 (Wave 3, Phase 2) — see `dashboard.types.ts`'s own doc comment
 * for the full rationale. This service does no SQL of its own beyond the
 * two genuinely-new aggregates in `DashboardRepository` — every other
 * figure is read straight off an already-constructed Wave 1/2 service
 * instance (the SAME instance `register-plugins.ts` already built for
 * that module's own routes, never a second/duplicate one), so this module
 * can never silently diverge from what `GET /api/v1/reports/sales`,
 * `GET /api/v1/cash-sessions`, etc. themselves report for the same
 * scope/date.
 */
export class DashboardService {
  public constructor(
    private readonly repository: DashboardRepository,
    private readonly reportsService: ReportsService,
    private readonly cashService: CashService,
    private readonly partyReservationsService: PartyReservationsService,
    private readonly partyRoomsService: PartyRoomsService,
  ) {}

  public async summary(
    companyId: string,
    branchIds: readonly string[],
    input: { date: string; branchId?: string },
  ): Promise<DashboardSummary> {
    validateDate(input.date);
    const filter = { dateFrom: input.date, dateTo: input.date, ...(input.branchId === undefined ? {} : { branchId: input.branchId }) };
    const yesterdayDate = previousIsoDate(input.date);
    const yesterdayFilter = { dateFrom: yesterdayDate, dateTo: yesterdayDate, ...(input.branchId === undefined ? {} : { branchId: input.branchId }) };

    const [
      salesReport,
      yesterdaySalesReport,
      accessReport,
      inventoryReport,
      reservationsPage,
      roomsPage,
      openSessionsPage,
      registersPage,
      outstandingTotals,
      clockedInEmployeeCount,
      birthdaysToday,
      partyKpis,
    ] = await Promise.all([
      this.reportsService.salesReport(companyId, branchIds, filter),
      // Same real `salesReport` service/query as today's figure above —
      // never a second, divergent sales aggregation (this task's own
      // instruction) — just pointed at yesterday's date instead.
      this.reportsService.salesReport(companyId, branchIds, yesterdayFilter),
      this.reportsService.accessReport(companyId, branchIds, filter),
      this.reportsService.inventoryReport(companyId, branchIds, filter),
      this.partyReservationsService.listReservations(companyId, branchIds, {
        limit: 100,
        eventDateFrom: input.date,
        eventDateTo: input.date,
        ...(input.branchId === undefined ? {} : { branchId: input.branchId }),
      }),
      // Company-wide room lookup (never branch-filtered here) so a
      // reservation's room name can always be resolved regardless of
      // which single branch the caller is currently viewing.
      this.partyRoomsService.listRooms(companyId, branchIds, { limit: 200 }),
      this.cashService.listSessions(companyId, branchIds, {
        limit: 100,
        status: 'open',
        ...(input.branchId === undefined ? {} : { branchId: input.branchId }),
      }),
      this.cashService.listRegisters(companyId, branchIds, {
        limit: 200,
        ...(input.branchId === undefined ? {} : { branchId: input.branchId }),
      }),
      this.repository.outstandingPartyBalances(companyId, branchIds),
      this.repository.clockedInEmployeeCount(companyId, branchIds, input.branchId, input.date),
      this.repository.birthdaysOn(companyId, input.date),
      this.repository.partyKpis(companyId, branchIds, input.branchId, input.date),
    ]);

    const roomNameById = new Map(roomsPage.items.map((room) => [room.id, room.name]));
    const registerById = new Map(registersPage.items.map((register) => [register.id, register]));

    const partyReservations: DashboardPartyReservation[] = reservationsPage.items.map((reservation) => ({
      id: reservation.id,
      roomId: reservation.roomId,
      roomName: roomNameById.get(reservation.roomId) ?? null,
      customerDisplayName: reservation.customerDisplayName,
      celebrantName: reservation.celebrantName,
      startTime: reservation.startTime,
      endTime: reservation.endTime,
      status: reservation.status,
    }));

    const openCashSessions: DashboardOpenCashSession[] = openSessionsPage.items.map((session) => {
      const register = registerById.get(session.cashRegisterId);
      return {
        cashSessionId: session.id,
        cashRegisterId: session.cashRegisterId,
        cashRegisterName: register?.name ?? null,
        cashRegisterCode: register?.code ?? null,
        branchId: session.branchId,
        openedAt: session.openedAt.toISOString(),
        openingAmount: session.openingAmount,
        currencyCode: session.currencyCode,
      };
    });

    const outstandingPartyBalances: CurrencyAmount[] = outstandingTotals.map((entry) => ({
      currencyCode: entry.currencyCode,
      amount: formatMoney(moneyUnits(entry.quotedTotal) - moneyUnits(entry.paidTotal)),
    }));

    return {
      date: input.date,
      branchId: input.branchId ?? null,
      salesTransactionCount: salesReport.transactionCount,
      salesGrossTotal: salesReport.grossSales,
      salesTrendVsYesterday: salesTrend(salesReport.grossSales, yesterdaySalesReport.grossSales),
      currentOccupancy: accessReport.currentOccupancy,
      partyReservationCount: partyReservations.length,
      partyReservations,
      openCashSessionCount: openCashSessions.length,
      openCashSessions,
      outstandingPartyBalances,
      upcomingPartyReservationCount: partyKpis.upcomingReservationCount,
      partyStatusBreakdown: partyKpis.statusBreakdown,
      eventRevenueToday: partyKpis.eventRevenueToday,
      depositsCollectedToday: partyKpis.depositsCollectedToday,
      completedPartyReservationsToday: partyKpis.completedTodayCount,
      cancelledPartyReservationsToday: partyKpis.cancelledTodayCount,
      clockedInEmployeeCount,
      outOfStockVariantCount: inventoryReport.outOfStockVariantCount,
      birthdaysToday,
    };
  }
}
