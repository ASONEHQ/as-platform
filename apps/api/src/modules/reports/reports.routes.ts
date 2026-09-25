import type { FastifyInstance } from 'fastify';

import { successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requireBranchAccess, requirePermission } from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import { withReportsErrors } from './reports.http-errors.js';
import type { ReportsService } from './reports.service.js';
import type {
  AccessReport,
  CurrencyAmount,
  CustomersReport,
  EmployeesReport,
  FinancialReport,
  HourlySales,
  InventoryReport,
  PartiesReport,
  PaymentMethodTotal,
  PromotionsReport,
  ReportFilter,
  SalesReport,
  StatusCount,
  TopCoupon,
  TopProduct,
} from './reports.types.js';

/**
 * TASK 14.4 (Wave 2, Part D) — Report Center HTTP surface. Mirrors
 * `purchasing.routes.ts`'s own established shape exactly: a plain
 * `register<X>Routes(app, authentication, service)` function (no Fastify
 * plugin/encapsulation), JSON-schema-validated query params, and the same
 * `successResponse(...)` envelope. A single coarse `report.read`
 * permission code gates every endpoint here (already seeded — see
 * `packages/database/src/seeds/technical-permissions.ts`); each
 * underlying query still only returns what the actor's own
 * `companyId`/`permittedBranchIds` already allow (see
 * `reports.repository.ts`) — there is no cross-tenant report view.
 */

const errorSchema = { type: 'object', additionalProperties: true } as const;
const commonErrors = {
  400: errorSchema,
  401: errorSchema,
  403: errorSchema,
  404: errorSchema,
} as const;
const responseSchema = { type: 'object', additionalProperties: true } as const;

interface ReportQuerystring {
  date_from: string;
  date_to: string;
  branch_id?: string;
}

const reportQuerystringSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['date_from', 'date_to'],
  properties: {
    date_from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    date_to: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    branch_id: { type: 'string', format: 'uuid' },
  },
} as const;

interface CompanyReportQuerystring {
  date_from: string;
  date_to: string;
}

// `customers` carries no branch dimension in this schema (see
// `reports.types.ts`'s own `CustomersReport` doc comment) — its
// querystring deliberately omits `branch_id` rather than silently
// accepting and ignoring one.
const companyReportQuerystringSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['date_from', 'date_to'],
  properties: {
    date_from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    date_to: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
  },
} as const;

function reportFilter(query: ReportQuerystring): ReportFilter {
  return {
    dateFrom: query.date_from,
    dateTo: query.date_to,
    ...(query.branch_id === undefined ? {} : { branchId: query.branch_id }),
  };
}

function currencyAmountHttp(entry: CurrencyAmount): Readonly<Record<string, unknown>> {
  return { currency_code: entry.currencyCode, amount: entry.amount };
}

function statusCountHttp(entry: StatusCount): Readonly<Record<string, unknown>> {
  return { status: entry.status, count: entry.count };
}

function hourlySalesHttp(entry: HourlySales): Readonly<Record<string, unknown>> {
  return {
    hour: entry.hour,
    currency_code: entry.currencyCode,
    transaction_count: entry.transactionCount,
    gross_sales: entry.grossSales,
  };
}

function topProductHttp(entry: TopProduct): Readonly<Record<string, unknown>> {
  return {
    product_id: entry.productId,
    name: entry.name,
    quantity_sold: entry.quantitySold,
    currency_code: entry.currencyCode,
    revenue: entry.revenue,
  };
}

function salesReportHttp(report: SalesReport): Readonly<Record<string, unknown>> {
  return {
    date_from: report.dateFrom,
    date_to: report.dateTo,
    branch_id: report.branchId,
    transaction_count: report.transactionCount,
    gross_sales: report.grossSales.map(currencyAmountHttp),
    refund_count: report.refundCount,
    refunds_total: report.refundsTotal.map(currencyAmountHttp),
    net_sales: report.netSales.map(currencyAmountHttp),
    average_ticket: report.averageTicket.map(currencyAmountHttp),
    sales_by_hour: report.salesByHour.map(hourlySalesHttp),
    top_products: report.topProducts.map(topProductHttp),
  };
}

function paymentMethodTotalHttp(entry: PaymentMethodTotal): Readonly<Record<string, unknown>> {
  return {
    payment_method: entry.paymentMethod,
    currency_code: entry.currencyCode,
    amount: entry.amount,
    count: entry.count,
  };
}

function financialReportHttp(report: FinancialReport): Readonly<Record<string, unknown>> {
  return {
    date_from: report.dateFrom,
    date_to: report.dateTo,
    branch_id: report.branchId,
    movement_totals: report.movementTotals.map((entry) => ({
      movement_type: entry.movementType,
      currency_code: entry.currencyCode,
      amount: entry.amount,
      count: entry.count,
    })),
    net_cash_movement: report.netCashMovement.map(currencyAmountHttp),
    closed_sessions: report.closedSessions.map((entry) => ({
      currency_code: entry.currencyCode,
      session_count: entry.sessionCount,
      declared_closing_total: entry.declaredClosingTotal,
      expected_closing_total: entry.expectedClosingTotal,
      discrepancy_total: entry.discrepancyTotal,
    })),
    sessions_opened_count: report.sessionsOpenedCount,
    payment_method_totals: report.paymentMethodTotals.map(paymentMethodTotalHttp),
  };
}

function inventoryReportHttp(report: InventoryReport): Readonly<Record<string, unknown>> {
  return {
    date_from: report.dateFrom,
    date_to: report.dateTo,
    branch_id: report.branchId,
    tracked_variant_count: report.trackedVariantCount,
    quantity_on_hand_total: report.quantityOnHandTotal,
    quantity_reserved_total: report.quantityReservedTotal,
    quantity_in_transit_total: report.quantityInTransitTotal,
    out_of_stock_variant_count: report.outOfStockVariantCount,
    inventory_value: report.inventoryValue.map(currencyAmountHttp),
    movement_volume: report.movementVolume.map((entry) => ({
      movement_type: entry.movementType,
      movement_count: entry.movementCount,
      total_base_quantity: entry.totalBaseQuantity,
    })),
  };
}

function customersReportHttp(report: CustomersReport): Readonly<Record<string, unknown>> {
  return {
    date_from: report.dateFrom,
    date_to: report.dateTo,
    total_customers: report.totalCustomers,
    customers_by_status: report.customersByStatus.map(statusCountHttp),
    new_customers_in_range: report.newCustomersInRange,
    memberships_by_status: report.membershipsByStatus.map(statusCountHttp),
    new_memberships_in_range: report.newMembershipsInRange,
    active_loyalty_account_count: report.activeLoyaltyAccountCount,
  };
}

function employeesReportHttp(report: EmployeesReport): Readonly<Record<string, unknown>> {
  return {
    date_from: report.dateFrom,
    date_to: report.dateTo,
    branch_id: report.branchId,
    employees_by_status: report.employeesByStatus.map(statusCountHttp),
    clock_in_count: report.clockInCount,
    clock_out_count: report.clockOutCount,
    distinct_employees_punched: report.distinctEmployeesPunched,
    closed_payroll_totals: report.closedPayrollTotals.map(currencyAmountHttp),
    closed_payroll_period_count: report.closedPayrollPeriodCount,
  };
}

function partiesReportHttp(report: PartiesReport): Readonly<Record<string, unknown>> {
  return {
    date_from: report.dateFrom,
    date_to: report.dateTo,
    branch_id: report.branchId,
    reservations_by_status: report.reservationsByStatus.map(statusCountHttp),
    booked_revenue: report.bookedRevenue.map(currencyAmountHttp),
    collected_revenue: report.collectedRevenue.map(currencyAmountHttp),
    active_room_count: report.activeRoomCount,
    rooms_booked_count: report.roomsBookedCount,
  };
}

function topCouponHttp(entry: TopCoupon): Readonly<Record<string, unknown>> {
  return { coupon_id: entry.couponId, code: entry.code, redemption_count: entry.redemptionCount };
}

function promotionsReportHttp(report: PromotionsReport): Readonly<Record<string, unknown>> {
  return {
    date_from: report.dateFrom,
    date_to: report.dateTo,
    branch_id: report.branchId,
    coupon_redemption_count: report.couponRedemptionCount,
    coupon_redemptions_total: report.couponRedemptionsTotal.map(currencyAmountHttp),
    promotion_discount_count: report.promotionDiscountCount,
    promotion_discount_total: report.promotionDiscountTotal.map(currencyAmountHttp),
    coupon_discount_count: report.couponDiscountCount,
    coupon_discount_total: report.couponDiscountTotal.map(currencyAmountHttp),
    top_coupons: report.topCoupons.map(topCouponHttp),
  };
}

function accessReportHttp(report: AccessReport): Readonly<Record<string, unknown>> {
  return {
    date_from: report.dateFrom,
    date_to: report.dateTo,
    branch_id: report.branchId,
    entry_count: report.entryCount,
    exit_count: report.exitCount,
    current_occupancy: report.currentOccupancy,
    average_stay_minutes: report.averageStayMinutes,
  };
}

export function registerReportsRoutes(app: FastifyInstance, authentication: AuthService, service: ReportsService): void {
  // GET /api/v1/reports/sales.
  app.get<{ Querystring: ReportQuerystring }>(
    '/api/v1/reports/sales',
    { schema: { tags: ['reports'], querystring: reportQuerystringSchema, response: { 200: responseSchema, ...commonErrors } } },
    async (request, reply) =>
      withReportsErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'report.read');
        if (request.query.branch_id !== undefined) requireBranchAccess(authentication, auth, request.query.branch_id);
        const report = await service.salesReport(auth.companyId, auth.permittedBranchIds, reportFilter(request.query));
        return reply.send(successResponse(salesReportHttp(report), request.requestContext));
      }),
  );

  // GET /api/v1/reports/sales/export.csv — real underlying rows, never
  // just the aggregate.
  app.get<{ Querystring: ReportQuerystring }>(
    '/api/v1/reports/sales/export.csv',
    { schema: { tags: ['reports'], querystring: reportQuerystringSchema, response: { ...commonErrors } } },
    async (request, reply) =>
      withReportsErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'report.read');
        if (request.query.branch_id !== undefined) requireBranchAccess(authentication, auth, request.query.branch_id);
        const csv = await service.salesExportCsv(auth.companyId, auth.permittedBranchIds, reportFilter(request.query));
        return reply
          .header('content-type', 'text/csv; charset=utf-8')
          .header(
            'content-disposition',
            `attachment; filename="sales-report-${request.query.date_from}-${request.query.date_to}.csv"`,
          )
          .send(csv);
      }),
  );

  // GET /api/v1/reports/financial — reconciles against the real cash
  // ledger (see `reports.service.ts`'s own doc comment on
  // `foldMovementTotalsByDirection`).
  app.get<{ Querystring: ReportQuerystring }>(
    '/api/v1/reports/financial',
    { schema: { tags: ['reports'], querystring: reportQuerystringSchema, response: { 200: responseSchema, ...commonErrors } } },
    async (request, reply) =>
      withReportsErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'report.read');
        if (request.query.branch_id !== undefined) requireBranchAccess(authentication, auth, request.query.branch_id);
        const report = await service.financialReport(auth.companyId, auth.permittedBranchIds, reportFilter(request.query));
        return reply.send(successResponse(financialReportHttp(report), request.requestContext));
      }),
  );

  // GET /api/v1/reports/financial/export.csv.
  app.get<{ Querystring: ReportQuerystring }>(
    '/api/v1/reports/financial/export.csv',
    { schema: { tags: ['reports'], querystring: reportQuerystringSchema, response: { ...commonErrors } } },
    async (request, reply) =>
      withReportsErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'report.read');
        if (request.query.branch_id !== undefined) requireBranchAccess(authentication, auth, request.query.branch_id);
        const csv = await service.financialExportCsv(auth.companyId, auth.permittedBranchIds, reportFilter(request.query));
        return reply
          .header('content-type', 'text/csv; charset=utf-8')
          .header(
            'content-disposition',
            `attachment; filename="financial-report-${request.query.date_from}-${request.query.date_to}.csv"`,
          )
          .send(csv);
      }),
  );

  // GET /api/v1/reports/inventory.
  app.get<{ Querystring: ReportQuerystring }>(
    '/api/v1/reports/inventory',
    { schema: { tags: ['reports'], querystring: reportQuerystringSchema, response: { 200: responseSchema, ...commonErrors } } },
    async (request, reply) =>
      withReportsErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'report.read');
        if (request.query.branch_id !== undefined) requireBranchAccess(authentication, auth, request.query.branch_id);
        const report = await service.inventoryReport(auth.companyId, auth.permittedBranchIds, reportFilter(request.query));
        return reply.send(successResponse(inventoryReportHttp(report), request.requestContext));
      }),
  );

  // GET /api/v1/reports/inventory/kardex.csv — TASK 14.5 (Wave 3, Phase 7,
  // Item 2): real `inventory_movement_lines` rows, the honest CSV port of
  // AS POS V1's real Kardex PDF export (see `reports.types.ts`'s own doc
  // comment on `KardexExportRow` for the deliberate CSV-not-PDF scoping
  // decision). Registered ahead of nothing parametric in this module — no
  // route-shadowing risk (mirrors how `product-catalog.routes.ts` reasons
  // about its own `export.csv` literal path).
  app.get<{ Querystring: ReportQuerystring & { product_variant_id?: string } }>(
    '/api/v1/reports/inventory/kardex.csv',
    {
      schema: {
        tags: ['reports'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          required: ['date_from', 'date_to'],
          properties: {
            date_from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            date_to: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            branch_id: { type: 'string', format: 'uuid' },
            product_variant_id: { type: 'string', format: 'uuid' },
          },
        },
        response: { ...commonErrors },
      },
    },
    async (request, reply) =>
      withReportsErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'report.read');
        if (request.query.branch_id !== undefined) requireBranchAccess(authentication, auth, request.query.branch_id);
        const csv = await service.kardexExportCsv(
          auth.companyId,
          auth.permittedBranchIds,
          reportFilter(request.query),
          request.query.product_variant_id,
        );
        return reply
          .header('content-type', 'text/csv; charset=utf-8')
          .header(
            'content-disposition',
            `attachment; filename="kardex-${request.query.date_from}-${request.query.date_to}.csv"`,
          )
          .send(csv);
      }),
  );

  // GET /api/v1/reports/promotions — TASK 14.5 (Wave 3, Phase 7, Item 4):
  // the 8th real report area.
  app.get<{ Querystring: ReportQuerystring }>(
    '/api/v1/reports/promotions',
    { schema: { tags: ['reports'], querystring: reportQuerystringSchema, response: { 200: responseSchema, ...commonErrors } } },
    async (request, reply) =>
      withReportsErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'report.read');
        if (request.query.branch_id !== undefined) requireBranchAccess(authentication, auth, request.query.branch_id);
        const report = await service.promotionsReport(auth.companyId, auth.permittedBranchIds, reportFilter(request.query));
        return reply.send(successResponse(promotionsReportHttp(report), request.requestContext));
      }),
  );

  // GET /api/v1/reports/customers — company-scoped only, no `branch_id`.
  app.get<{ Querystring: CompanyReportQuerystring }>(
    '/api/v1/reports/customers',
    {
      schema: { tags: ['reports'], querystring: companyReportQuerystringSchema, response: { 200: responseSchema, ...commonErrors } },
    },
    async (request, reply) =>
      withReportsErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'report.read');
        const report = await service.customersReport(auth.companyId, {
          dateFrom: request.query.date_from,
          dateTo: request.query.date_to,
        });
        return reply.send(successResponse(customersReportHttp(report), request.requestContext));
      }),
  );

  // GET /api/v1/reports/employees.
  app.get<{ Querystring: ReportQuerystring }>(
    '/api/v1/reports/employees',
    { schema: { tags: ['reports'], querystring: reportQuerystringSchema, response: { 200: responseSchema, ...commonErrors } } },
    async (request, reply) =>
      withReportsErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'report.read');
        if (request.query.branch_id !== undefined) requireBranchAccess(authentication, auth, request.query.branch_id);
        const report = await service.employeesReport(auth.companyId, auth.permittedBranchIds, reportFilter(request.query));
        return reply.send(successResponse(employeesReportHttp(report), request.requestContext));
      }),
  );

  // GET /api/v1/reports/parties.
  app.get<{ Querystring: ReportQuerystring }>(
    '/api/v1/reports/parties',
    { schema: { tags: ['reports'], querystring: reportQuerystringSchema, response: { 200: responseSchema, ...commonErrors } } },
    async (request, reply) =>
      withReportsErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'report.read');
        if (request.query.branch_id !== undefined) requireBranchAccess(authentication, auth, request.query.branch_id);
        const report = await service.partiesReport(auth.companyId, auth.permittedBranchIds, reportFilter(request.query));
        return reply.send(successResponse(partiesReportHttp(report), request.requestContext));
      }),
  );

  // GET /api/v1/reports/access.
  app.get<{ Querystring: ReportQuerystring }>(
    '/api/v1/reports/access',
    { schema: { tags: ['reports'], querystring: reportQuerystringSchema, response: { 200: responseSchema, ...commonErrors } } },
    async (request, reply) =>
      withReportsErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'report.read');
        if (request.query.branch_id !== undefined) requireBranchAccess(authentication, auth, request.query.branch_id);
        const report = await service.accessReport(auth.companyId, auth.permittedBranchIds, reportFilter(request.query));
        return reply.send(successResponse(accessReportHttp(report), request.requestContext));
      }),
  );
}
