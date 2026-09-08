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

    const [salesReport, accessReport, inventoryReport, reservationsPage, roomsPage, openSessionsPage, registersPage, outstandingTotals, clockedInEmployeeCount] =
      await Promise.all([
        this.reportsService.salesReport(companyId, branchIds, filter),
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
      currentOccupancy: accessReport.currentOccupancy,
      partyReservationCount: partyReservations.length,
      partyReservations,
      openCashSessionCount: openCashSessions.length,
      openCashSessions,
      outstandingPartyBalances,
      clockedInEmployeeCount,
      outOfStockVariantCount: inventoryReport.outOfStockVariantCount,
    };
  }
}
