import type { FastifyInstance } from 'fastify';

import { successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requireBranchAccess, requirePermission } from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import type { CashCardReconciliation, CashPaymentMethodTotal } from '../cash/cash.types.js';
import type { BranchConsolidationService } from './branch-consolidation.service.js';
import { withBranchConsolidationErrors } from './branch-consolidation.http-errors.js';
import type {
  BranchConsolidationRegister,
  BranchConsolidationResult,
  BranchConsolidationTotals,
} from './branch-consolidation.types.js';

interface Params {
  id: string;
}

const errorSchema = { type: 'object', additionalProperties: true } as const;
const commonErrors = { 400: errorSchema, 401: errorSchema, 403: errorSchema, 404: errorSchema } as const;
const responseSchema = { type: 'object', additionalProperties: true } as const;

function paymentMethodTotalsHttp(values: readonly CashPaymentMethodTotal[]): readonly Readonly<Record<string, unknown>>[] {
  return values.map((line) => ({
    method: line.method,
    gross_sales_total: line.grossSalesTotal,
    refunds_total: line.refundsTotal,
    net_total: line.netTotal,
    ticket_count: line.ticketCount,
  }));
}
function cardReconciliationHttp(value: CashCardReconciliation | null): Readonly<Record<string, unknown>> | null {
  if (value === null) return null;
  return {
    system_gross_total: value.systemGrossTotal,
    system_refund_total: value.systemRefundTotal,
    system_net_total: value.systemNetTotal,
    terminal_entries: value.terminalEntries.map((entry) => ({
      id: entry.id,
      label: entry.label,
      amount: entry.amount,
      reference: entry.reference,
      note: entry.note,
    })),
    terminal_total: value.terminalTotal,
    difference: value.difference,
    status: value.status,
    note: value.note,
  };
}
function registerHttp(value: BranchConsolidationRegister): Readonly<Record<string, unknown>> {
  return {
    register_id: value.registerId,
    register_code: value.registerCode,
    register_name: value.registerName,
    operational_area_id: value.operationalAreaId,
    status: value.status,
    cash_session_id: value.cashSessionId,
    opened_at: value.openedAt,
    closed_at: value.closedAt,
    opening_amount: value.openingAmount,
    cash_sales_total: value.cashSalesTotal,
    cash_in_total: value.cashInTotal,
    cash_out_total: value.cashOutTotal,
    expected_cash: value.expectedCash,
    counted_cash: value.countedCash,
    discrepancy_amount: value.discrepancyAmount,
    payment_method_totals: paymentMethodTotalsHttp(value.paymentMethodTotals),
    card_reconciliation: cardReconciliationHttp(value.cardReconciliation),
  };
}
function totalsHttp(value: BranchConsolidationTotals): Readonly<Record<string, unknown>> {
  return {
    cash_opening_total: value.cashOpeningTotal,
    cash_sales_total: value.cashSalesTotal,
    cash_in_total: value.cashInTotal,
    cash_out_total: value.cashOutTotal,
    expected_cash_total: value.expectedCashTotal,
    counted_cash_total: value.countedCashTotal,
    cash_difference_total: value.cashDifferenceTotal,
    payment_method_totals: paymentMethodTotalsHttp(value.paymentMethodTotals),
    card_system_net_total: value.cardSystemNetTotal,
    card_terminal_total: value.cardTerminalTotal,
    card_difference_total: value.cardDifferenceTotal,
    open_register_count: value.openRegisterCount,
    closing_register_count: value.closingRegisterCount,
    closed_register_count: value.closedRegisterCount,
    no_session_register_count: value.noSessionRegisterCount,
    discrepant_register_count: value.discrepantRegisterCount,
    card_pending_or_discrepant_register_count: value.cardPendingOrDiscrepantRegisterCount,
  };
}
function resultHttp(value: BranchConsolidationResult): Readonly<Record<string, unknown>> {
  return {
    branch_id: value.branchId,
    business_date: value.businessDate,
    window_start: value.windowStart,
    window_end: value.windowEnd,
    registers: value.registers.map(registerHttp),
    areas: value.areas.map((area) => ({
      operational_area_id: area.operationalAreaId,
      operational_area_name: area.operationalAreaName,
      cash_sales_total: area.cashSalesTotal,
      register_count: area.registerCount,
    })),
    totals: totalsHttp(value.totals),
  };
}

/** TASK 16.15 — "Consolidado de sucursal": read-only, gated by
 * `branch_consolidation.read` (deliberately separate from
 * `cash_session.read`, which only ever implies "my own session" — see
 * that permission's own doc comment in `technical-permissions.ts`). */
export function registerBranchConsolidationRoutes(
  app: FastifyInstance,
  authentication: AuthService,
  service: BranchConsolidationService,
): void {
  app.get<{ Params: Params; Querystring: { date?: string } }>(
    '/api/v1/branches/:id/consolidation',
    {
      schema: {
        tags: ['branch-consolidation'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withBranchConsolidationErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'branch_consolidation.read');
        requireBranchAccess(authentication, auth, request.params.id);
        const result = await service.consolidate(
          auth.companyId,
          auth.permittedBranchIds,
          auth.permittedRegisterIds ?? null,
          request.params.id,
          request.query.date,
        );
        return reply.send(successResponse(resultHttp(result), request.requestContext));
      }),
  );
}
