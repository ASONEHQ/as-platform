import type { FastifyInstance } from 'fastify';

import { successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requireBranchAccess, requirePermission } from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import type { CurrencyAmount } from '../reports/reports.types.js';
import { withDashboardErrors } from './dashboard.http-errors.js';
import type { DashboardService } from './dashboard.service.js';
import type {
  DashboardBirthdayCustomer,
  DashboardOpenCashSession,
  DashboardPartyReservation,
  DashboardSalesTrendEntry,
  DashboardSummary,
} from './dashboard.types.js';

/**
 * TASK 14.5 (Wave 3, Phase 2) — Dashboard ("today at a glance"). Mirrors
 * `reports.routes.ts`'s own established shape exactly: a plain
 * `register<X>Routes(app, authentication, service)` function, JSON-
 * schema-validated query params, the same `successResponse(...)`
 * envelope. Gated by the SAME coarse `report.read` permission the Report
 * Center already uses — this endpoint is exactly that kind of broad,
 * low-risk, read-only aggregate view (see this task's own instruction);
 * no new, narrower permission code is introduced.
 */

const errorSchema = { type: 'object', additionalProperties: true } as const;
const commonErrors = { 400: errorSchema, 401: errorSchema, 403: errorSchema, 404: errorSchema } as const;
const responseSchema = { type: 'object', additionalProperties: true } as const;

interface SummaryQuerystring {
  date: string;
  branch_id?: string;
}

const summaryQuerystringSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['date'],
  properties: {
    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    branch_id: { type: 'string', format: 'uuid' },
  },
} as const;

function currencyAmountHttp(entry: CurrencyAmount): Readonly<Record<string, unknown>> {
  return { currency_code: entry.currencyCode, amount: entry.amount };
}

function partyReservationHttp(entry: DashboardPartyReservation): Readonly<Record<string, unknown>> {
  return {
    id: entry.id,
    room_id: entry.roomId,
    room_name: entry.roomName,
    customer_display_name: entry.customerDisplayName,
    celebrant_name: entry.celebrantName,
    start_time: entry.startTime,
    end_time: entry.endTime,
    status: entry.status,
  };
}

function salesTrendHttp(entry: DashboardSalesTrendEntry): Readonly<Record<string, unknown>> {
  return {
    currency_code: entry.currencyCode,
    today_total: entry.todayTotal,
    yesterday_total: entry.yesterdayTotal,
    pct_change: entry.pctChange,
  };
}

function birthdayCustomerHttp(entry: DashboardBirthdayCustomer): Readonly<Record<string, unknown>> {
  return { id: entry.id, display_name: entry.displayName };
}

function openCashSessionHttp(entry: DashboardOpenCashSession): Readonly<Record<string, unknown>> {
  return {
    cash_session_id: entry.cashSessionId,
    cash_register_id: entry.cashRegisterId,
    cash_register_name: entry.cashRegisterName,
    cash_register_code: entry.cashRegisterCode,
    branch_id: entry.branchId,
    opened_at: entry.openedAt,
    opening_amount: entry.openingAmount,
    currency_code: entry.currencyCode,
  };
}

function summaryHttp(summary: DashboardSummary): Readonly<Record<string, unknown>> {
  return {
    date: summary.date,
    branch_id: summary.branchId,
    sales: {
      transaction_count: summary.salesTransactionCount,
      gross_total: summary.salesGrossTotal.map(currencyAmountHttp),
      trend_vs_yesterday: summary.salesTrendVsYesterday.map(salesTrendHttp),
    },
    occupancy: { current_occupancy: summary.currentOccupancy },
    parties: {
      count: summary.partyReservationCount,
      reservations: summary.partyReservations.map(partyReservationHttp),
      upcoming_count: summary.upcomingPartyReservationCount,
      status_breakdown: summary.partyStatusBreakdown,
      revenue_today: summary.eventRevenueToday.map(currencyAmountHttp),
      deposits_collected_today: summary.depositsCollectedToday.map(currencyAmountHttp),
      completed_today: summary.completedPartyReservationsToday,
      cancelled_today: summary.cancelledPartyReservationsToday,
    },
    cash_sessions: {
      open_count: summary.openCashSessionCount,
      sessions: summary.openCashSessions.map(openCashSessionHttp),
    },
    outstanding_party_balances: summary.outstandingPartyBalances.map(currencyAmountHttp),
    employee_attendance: { clocked_in_count: summary.clockedInEmployeeCount },
    inventory_alerts: { out_of_stock_variant_count: summary.outOfStockVariantCount },
    birthdays_today: {
      count: summary.birthdaysToday.length,
      customers: summary.birthdaysToday.map(birthdayCustomerHttp),
    },
  };
}

export function registerDashboardRoutes(app: FastifyInstance, authentication: AuthService, service: DashboardService): void {
  // GET /api/v1/dashboard/summary.
  app.get<{ Querystring: SummaryQuerystring }>(
    '/api/v1/dashboard/summary',
    { schema: { tags: ['dashboard'], querystring: summaryQuerystringSchema, response: { 200: responseSchema, ...commonErrors } } },
    async (request, reply) =>
      withDashboardErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'report.read');
        if (request.query.branch_id !== undefined) requireBranchAccess(authentication, auth, request.query.branch_id);
        const summary = await service.summary(auth.companyId, auth.permittedBranchIds, {
          date: request.query.date,
          ...(request.query.branch_id === undefined ? {} : { branchId: request.query.branch_id }),
        });
        return reply.send(successResponse(summaryHttp(summary), request.requestContext));
      }),
  );
}
