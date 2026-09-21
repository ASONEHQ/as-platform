import type { FastifyInstance, FastifyRequest } from 'fastify';

import { responseMeta, successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requireBranchAccess, requirePermission } from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import { idempotencyKey } from '../catalog/catalog.schemas.js';
import { withCashErrors } from './cash.http-errors.js';
import type { CashService } from './cash.service.js';
import type {
  CashCardReconciliation,
  CashMovementRow,
  CashMutationContext,
  CashPartialCloseOperationalSummary,
  CashPaymentMethodTotal,
  CashRegisterRow,
  CashSessionPartialCloseRow,
  CashSessionRow,
} from './cash.types.js';

interface Params {
  id: string;
}

const errorSchema = { type: 'object', additionalProperties: true } as const;
const commonErrors = {
  400: errorSchema,
  401: errorSchema,
  403: errorSchema,
  404: errorSchema,
  409: errorSchema,
} as const;
const responseSchema = { type: 'object', additionalProperties: true } as const;
const idempotencyHeaders = {
  type: 'object',
  required: ['idempotency-key'],
  properties: { 'idempotency-key': { type: 'string', minLength: 1, maxLength: 255 } },
} as const;

function mutationContext(request: FastifyRequest, companyId: string, actorId: string): CashMutationContext {
  return {
    companyId,
    actorId,
    requestId: request.requestContext.requestId,
    correlationId: request.requestContext.correlationId,
    timestamp: new Date(),
    deviceId: request.requestContext.deviceId,
  };
}

function registerHttp(value: CashRegisterRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    branch_id: value.branchId,
    code: value.code,
    name: value.name,
    status: value.status,
    device_id: value.deviceId,
    version: Number(value.version),
    created_at: value.createdAt.toISOString(),
    updated_at: value.updatedAt.toISOString(),
  };
}
function paymentMethodTotalsHttp(
  value: readonly CashPaymentMethodTotal[] | null,
): readonly Readonly<Record<string, unknown>>[] | null {
  // Loose check on purpose — see `operationalSummaryHttp`'s own doc
  // comment: a real DB row is always exactly `null` when absent, but a
  // test fixture predating this field may carry `undefined` instead;
  // both mean "no payment-method breakdown to show."
  if (value == null) return null;
  return value.map((line) => ({
    method: line.method,
    gross_sales_total: line.grossSalesTotal,
    refunds_total: line.refundsTotal,
    net_total: line.netTotal,
    ticket_count: line.ticketCount,
  }));
}
// TASK 16.14A — same defensive `== null` loose check as
// `paymentMethodTotalsHttp`/`operationalSummaryHttp` above, for the exact
// same reason (a real DB row is always exactly `null` when absent; an
// older test fixture may carry `undefined`).
function cardReconciliationHttp(value: CashCardReconciliation | null): Readonly<Record<string, unknown>> | null {
  if (value == null) return null;
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
function sessionHttp(value: CashSessionRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    branch_id: value.branchId,
    cash_register_id: value.cashRegisterId,
    opened_by: value.openedBy,
    opened_at: value.openedAt.toISOString(),
    opening_amount: value.openingAmount,
    currency_code: value.currencyCode,
    status: value.status,
    closed_by: value.closedBy,
    closed_at: value.closedAt?.toISOString() ?? null,
    declared_closing_amount: value.declaredClosingAmount,
    expected_closing_amount: value.expectedClosingAmount,
    discrepancy_amount: value.discrepancyAmount,
    // Part J — optional bills/coins breakdown behind the same
    // declared_closing_amount; null when the cashier skipped it.
    denomination_counts:
      value.denominationCounts === null
        ? null
        : value.denominationCounts.map((line) => ({ value: line.value, quantity: line.quantity })),
    // TASK 16.14 — the frozen commercial final-close snapshot; every
    // field is `null` for an open/closing session, or for any session
    // closed before this task existed (see the schema column's own doc
    // comment). Never fabricated zeros — the Flutter client must render
    // an honest "not available" for `null`, exactly like it already does
    // for a pre-TASK-16.13 partial close's `operational_summary: null`.
    cash_sales_total: value.cashSalesTotal,
    cash_sales_count: value.cashSalesCount,
    cash_in_total: value.cashInTotal,
    cash_out_total: value.cashOutTotal,
    withdrawal_total: value.withdrawalTotal,
    expense_total: value.expenseTotal,
    external_income_total: value.externalIncomeTotal,
    cash_refund_total: value.cashRefundTotal,
    cash_refund_count: value.cashRefundCount,
    payment_method_totals: paymentMethodTotalsHttp(value.paymentMethodTotals),
    // Reused verbatim — the exact same nested camelCase->snake_case
    // mapper `partialCloseHttp` already uses below, never a second,
    // slightly-different copy (TASK 16.13's own HTTP-mapper bug, caught
    // during that task's live verification, is exactly the class of
    // mistake reusing this function here avoids reintroducing).
    operational_summary: operationalSummaryHttp(value.operationalSummary),
    discrepancy_reason: value.discrepancyReason,
    card_reconciliation: cardReconciliationHttp(value.cardReconciliation),
    version: Number(value.version),
  };
}
function movementHttp(value: CashMovementRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    cash_session_id: value.cashSessionId,
    movement_type: value.movementType,
    amount: value.amount,
    currency_code: value.currencyCode,
    reason_code: value.reasonCode,
    note: value.note,
    reference_type: value.referenceType,
    reference_id: value.referenceId,
    occurred_at: value.occurredAt.toISOString(),
    created_by: value.createdBy,
    reversal_of_id: value.reversalOfId,
    // TASK 14.4 (Wave 2, Part F.1) — orthogonal to movement_type; null
    // for system-posted movements and any uncategorized cash_in/cash_out.
    category: value.category,
  };
}
// TASK 16.13 — the nested "Resumen operativo" object was previously
// passed through verbatim from `CashRepository.operationalSummary`'s own
// camelCase TS shape, never converted to this API's snake_case wire
// convention (only the outer `operational_summary` key itself was). Fixed
// here, matching every other HTTP mapper in this file.
function operationalSummaryHttp(
  value: CashPartialCloseOperationalSummary | null,
): Readonly<Record<string, unknown>> | null {
  // Loose check on purpose: a real DB row's `operational_summary` is
  // always exactly `null` when absent, but a few pre-TASK-16.13 test
  // fixtures construct a partial-close value without the field at all
  // (`undefined` at runtime despite the stricter TS type) — both mean
  // the same thing here, "no snapshot to show."
  if (value == null) return null;
  return {
    window_start: value.windowStart,
    window_end: value.windowEnd,
    pos: {
      gross_sales: value.pos.grossSales,
      refunds_total: value.pos.refundsTotal,
      net_sales: value.pos.netSales,
      ticket_count: value.pos.ticketCount,
    },
    cafeteria: {
      available: value.cafeteria.available,
      gross_sales: value.cafeteria.grossSales,
      refunds_total: value.cafeteria.refundsTotal,
      net_sales: value.cafeteria.netSales,
      ticket_count: value.cafeteria.ticketCount,
      units_sold: value.cafeteria.unitsSold,
    },
    events: {
      reservations_created: value.events.reservationsCreated,
      contracted_value: value.events.contractedValue,
      collected_for_new_reservations: value.events.collectedForNewReservations,
      outstanding_for_new_reservations: value.events.outstandingForNewReservations,
      deposits_collected: value.events.depositsCollected,
      total_collected: value.events.totalCollected,
      cancelled_count: value.events.cancelledCount,
      reservations_occurring_today: value.events.reservationsOccurringToday,
    },
  };
}
function partialCloseHttp(value: CashSessionPartialCloseRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    cash_session_id: value.cashSessionId,
    taken_at: value.takenAt.toISOString(),
    opening_amount: value.openingAmount,
    cash_sales_total: value.cashSalesTotal,
    cash_in_total: value.cashInTotal,
    cash_out_total: value.cashOutTotal,
    expected_cash: value.expectedCash,
    created_by: value.createdBy,
    created_at: value.createdAt.toISOString(),
    // TASK 16.13 — `null` for any partial close taken before this column
    // existed; the client must render "operational breakdown
    // unavailable" for `null`, never synthesize zeros.
    operational_summary: operationalSummaryHttp(value.operationalSummary),
  };
}

export function registerCashRoutes(app: FastifyInstance, authentication: AuthService, service: CashService): void {
  // E039.
  app.post<{ Body: { id?: string; branch_id: string; code: string; name: string; device_id?: string } }>(
    '/api/v1/cash-registers',
    {
      schema: {
        tags: ['cash'],
        headers: idempotencyHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['branch_id', 'code', 'name'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            branch_id: { type: 'string', format: 'uuid' },
            code: { type: 'string', minLength: 1, maxLength: 64 },
            name: { type: 'string', minLength: 1, maxLength: 160 },
            device_id: { type: 'string', format: 'uuid' },
          },
        },
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withCashErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'cash_register.manage');
        requireBranchAccess(authentication, auth, request.body.branch_id);
        const created = await service.createRegister(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          {
            ...(request.body.id === undefined ? {} : { id: request.body.id }),
            branchId: request.body.branch_id,
            code: request.body.code,
            name: request.body.name,
            ...(request.body.device_id === undefined ? {} : { deviceId: request.body.device_id }),
          },
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .code(201)
          .header('etag', `"${created.value.version.toString()}"`)
          .send(successResponse(registerHttp(created.value), request.requestContext));
      }),
  );

  // E038.
  app.get<{ Querystring: { cursor?: string; limit?: number; branch_id?: string; status?: string; device_id?: string } }>(
    '/api/v1/cash-registers',
    {
      schema: {
        tags: ['cash'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cursor: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            branch_id: { type: 'string', format: 'uuid' },
            status: { type: 'string', enum: ['active', 'inactive', 'retired'] },
            device_id: { type: 'string', format: 'uuid' },
          },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withCashErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'cash_register.read');
        const query = request.query;
        if (query.branch_id !== undefined) requireBranchAccess(authentication, auth, query.branch_id);
        const page = await service.listRegisters(auth.companyId, auth.permittedBranchIds, {
          limit: query.limit ?? 50,
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(query.branch_id === undefined ? {} : { branchId: query.branch_id }),
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.device_id === undefined ? {} : { deviceId: query.device_id }),
        });
        return reply.send({
          data: page.items.map(registerHttp),
          meta: { ...responseMeta(request.requestContext), page: { next_cursor: page.nextCursor, has_more: page.nextCursor !== null } },
        });
      }),
  );

  // E040.
  app.get<{ Params: Params }>(
    '/api/v1/cash-registers/:id',
    {
      schema: {
        tags: ['cash'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withCashErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'cash_register.read');
        const value = await service.register(auth.companyId, auth.permittedBranchIds, request.params.id);
        return reply
          .header('etag', `"${value.version.toString()}"`)
          .send(successResponse(registerHttp(value), request.requestContext));
      }),
  );

  // E041.
  app.put<{ Params: Params; Body: { device_id: string | null; reason_code: string } }>(
    '/api/v1/cash-registers/:id/device-assignment',
    {
      schema: {
        tags: ['cash'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        headers: { type: 'object', properties: { 'if-match': { type: 'string' } } },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['reason_code'],
          properties: {
            device_id: { type: ['string', 'null'], format: 'uuid' },
            reason_code: { type: 'string', minLength: 1, maxLength: 200 },
          },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withCashErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'cash_register.manage');
        const ifMatch = request.headers['if-match'];
        const expectedVersion = BigInt(typeof ifMatch === 'string' ? ifMatch.replaceAll('"', '') : '0');
        const updated = await service.assignDevice(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          request.params.id,
          expectedVersion,
          request.body.device_id,
        );
        return reply
          .header('etag', `"${updated.version.toString()}"`)
          .send(successResponse(registerHttp(updated), request.requestContext));
      }),
  );

  // E042.
  app.post<{ Body: { id?: string; cash_register_id: string; opening_amount: string; currency_code?: string } }>(
    '/api/v1/cash-sessions',
    {
      schema: {
        tags: ['cash'],
        headers: idempotencyHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['cash_register_id', 'opening_amount'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            cash_register_id: { type: 'string', format: 'uuid' },
            opening_amount: { type: 'string', pattern: '^(?:0|[1-9]\\d*)(?:\\.\\d{1,4})?$' },
            currency_code: { type: 'string', minLength: 3, maxLength: 3 },
          },
        },
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withCashErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'cash_session.open');
        const created = await service.openSession(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          {
            ...(request.body.id === undefined ? {} : { id: request.body.id }),
            cashRegisterId: request.body.cash_register_id,
            openingAmount: request.body.opening_amount,
            ...(request.body.currency_code === undefined ? {} : { currencyCode: request.body.currency_code }),
          },
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .code(201)
          .header('etag', `"${created.value.version.toString()}"`)
          .send(successResponse(sessionHttp(created.value), request.requestContext));
      }),
  );

  // E043.
  app.get<{ Querystring: { cash_register_id: string } }>(
    '/api/v1/cash-sessions/current',
    {
      schema: {
        tags: ['cash'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          required: ['cash_register_id'],
          properties: { cash_register_id: { type: 'string', format: 'uuid' } },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withCashErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'cash_session.read');
        const current = await service.currentSession(auth.companyId, auth.permittedBranchIds, request.query.cash_register_id);
        return reply.send(successResponse(current === null ? null : sessionHttp(current), request.requestContext));
      }),
  );

  // Sales-history-shaped addition (Part L) — not individually numbered
  // E038-E048, reconciled the same way TASK 12.6's `GET /sales` was.
  app.get<{
    Querystring: {
      cursor?: string;
      limit?: number;
      branch_id?: string;
      cash_register_id?: string;
      opened_by?: string;
      status?: string;
      opened_from?: string;
      opened_to?: string;
    };
  }>(
    '/api/v1/cash-sessions',
    {
      schema: {
        tags: ['cash'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cursor: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            branch_id: { type: 'string', format: 'uuid' },
            cash_register_id: { type: 'string', format: 'uuid' },
            opened_by: { type: 'string', format: 'uuid' },
            status: { type: 'string', enum: ['open', 'closing', 'closed'] },
            opened_from: { type: 'string', format: 'date-time' },
            opened_to: { type: 'string', format: 'date-time' },
          },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withCashErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'cash_session.read');
        const query = request.query;
        if (query.branch_id !== undefined) requireBranchAccess(authentication, auth, query.branch_id);
        const page = await service.listSessions(auth.companyId, auth.permittedBranchIds, {
          limit: query.limit ?? 50,
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(query.branch_id === undefined ? {} : { branchId: query.branch_id }),
          ...(query.cash_register_id === undefined ? {} : { cashRegisterId: query.cash_register_id }),
          ...(query.opened_by === undefined ? {} : { openedBy: query.opened_by }),
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.opened_from === undefined ? {} : { openedFrom: new Date(query.opened_from) }),
          ...(query.opened_to === undefined ? {} : { openedTo: new Date(query.opened_to) }),
        });
        return reply.send({
          data: page.items.map(sessionHttp),
          meta: { ...responseMeta(request.requestContext), page: { next_cursor: page.nextCursor, has_more: page.nextCursor !== null } },
        });
      }),
  );

  // E044.
  app.get<{ Params: Params }>(
    '/api/v1/cash-sessions/:id',
    {
      schema: {
        tags: ['cash'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withCashErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'cash_session.read');
        const value = await service.session(auth.companyId, auth.permittedBranchIds, request.params.id);
        return reply
          .header('etag', `"${value.version.toString()}"`)
          .send(successResponse(sessionHttp(value), request.requestContext));
      }),
  );

  // E048 — also the persisted cash-cut summary (Part K): same shape,
  // read at any time (open or closed) since it's always computed fresh
  // from ledger facts, never a separately-stored summary row.
  app.get<{ Params: Params }>(
    '/api/v1/cash-sessions/:id/summary',
    {
      schema: {
        tags: ['cash'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withCashErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'cash_session.read');
        const value = await service.summary(auth.companyId, auth.permittedBranchIds, request.params.id);
        return reply.send(
          successResponse(
            {
              session: sessionHttp(value.session),
              opening_amount: value.openingAmount,
              cash_sales_total: value.cashSalesTotal,
              cash_sales_count: value.cashSalesCount,
              cash_in_total: value.cashInTotal,
              cash_out_total: value.cashOutTotal,
              // TASK 14.4 (Wave 2, Part F.2) — new named breakdowns, each
              // a strict subset already folded into cash_in_total/
              // cash_out_total above; expected_cash is unaffected.
              withdrawal_total: value.withdrawalTotal,
              expense_total: value.expenseTotal,
              external_income_total: value.externalIncomeTotal,
              // TASK 16.14 — already folded into expected_cash (direction
              // -1); now also surfaced as its own named total, mirroring
              // withdrawal_total/expense_total/external_income_total's
              // own precedent exactly.
              cash_refund_total: value.cashRefundTotal,
              cash_refund_count: value.cashRefundCount,
              expected_cash: value.expectedCash,
              // TASK 16.14A — live preview of the same per-method
              // breakdown a final close freezes; see
              // `CashSessionSummary.paymentMethodTotals`'s own doc
              // comment. Reuses the exact same mapper `sessionHttp` uses
              // for the frozen version, never a second one.
              payment_method_totals: paymentMethodTotalsHttp(value.paymentMethodTotals),
            },
            request.requestContext,
          ),
        );
      }),
  );

  // E045.
  app.post<{
    Params: Params;
    Body: {
      id?: string;
      movement_type: 'cash_in' | 'cash_out';
      amount: string;
      reason_code: string;
      note?: string;
      category?: 'withdrawal' | 'expense' | 'external_income' | 'other';
    };
  }>(
    '/api/v1/cash-sessions/:id/movements',
    {
      schema: {
        tags: ['cash'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        headers: idempotencyHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['movement_type', 'amount', 'reason_code'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            movement_type: { type: 'string', enum: ['cash_in', 'cash_out'] },
            amount: { type: 'string', pattern: '^(?:0|[1-9]\\d*)(?:\\.\\d{1,4})?$' },
            reason_code: { type: 'string', minLength: 1, maxLength: 64 },
            note: { type: 'string', maxLength: 500 },
            // TASK 14.4 (Wave 2, Part F.1) — optional; the service layer
            // validates this is compatible with movement_type using the
            // exact same rule as the DB's own
            // cash_movements_category_direction_ck, before any write.
            category: { type: 'string', enum: ['withdrawal', 'expense', 'external_income', 'other'] },
          },
        },
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withCashErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'cash_movement.create');
        const created = await service.createMovement(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          request.params.id,
          {
            ...(request.body.id === undefined ? {} : { id: request.body.id }),
            movementType: request.body.movement_type,
            amount: request.body.amount,
            reasonCode: request.body.reason_code,
            ...(request.body.note === undefined ? {} : { note: request.body.note }),
            ...(request.body.category === undefined ? {} : { category: request.body.category }),
          },
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        return reply.code(201).send(successResponse(movementHttp(created.value), request.requestContext));
      }),
  );

  // TASK 16.11 (§6) — "Never delete posted financial movements.
  // Corrections must use reversal/compensating architecture." Same
  // permission as posting the manual movement being corrected
  // (`cash_movement.create`) — a reversal is itself a new movement, posted
  // by the same operator role, never a privileged "undo".
  app.post<{ Params: { id: string; movementId: string }; Body: { reason_code: string; note?: string } }>(
    '/api/v1/cash-sessions/:id/movements/:movementId/reverse',
    {
      schema: {
        tags: ['cash'],
        params: {
          type: 'object',
          required: ['id', 'movementId'],
          properties: { id: { type: 'string' }, movementId: { type: 'string' } },
        },
        headers: idempotencyHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['reason_code'],
          properties: {
            reason_code: { type: 'string', minLength: 1, maxLength: 200 },
            note: { type: 'string', maxLength: 500 },
          },
        },
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withCashErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'cash_movement.create');
        const reversed = await service.reverseMovement(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          request.params.id,
          request.params.movementId,
          {
            reasonCode: request.body.reason_code,
            ...(request.body.note === undefined ? {} : { note: request.body.note }),
          },
        );
        if (reversed.replayed) reply.header('idempotency-replayed', 'true');
        return reply.code(201).send(successResponse(movementHttp(reversed.value), request.requestContext));
      }),
  );

  // E046.
  app.get<{ Params: Params; Querystring: { cursor?: string; limit?: number; type?: string } }>(
    '/api/v1/cash-sessions/:id/movements',
    {
      schema: {
        tags: ['cash'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cursor: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            type: { type: 'string', enum: ['opening_float', 'cash_sale', 'cash_in', 'cash_out'] },
          },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withCashErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'cash_session.read');
        const query = request.query;
        const page = await service.listMovements(auth.companyId, auth.permittedBranchIds, request.params.id, {
          limit: query.limit ?? 50,
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(query.type === undefined ? {} : { movementType: query.type as 'opening_float' | 'cash_sale' | 'cash_in' | 'cash_out' }),
        });
        return reply.send({
          data: page.items.map(movementHttp),
          meta: { ...responseMeta(request.requestContext), page: { next_cursor: page.nextCursor, has_more: page.nextCursor !== null } },
        });
      }),
  );

  // E047.
  app.post<{
    Params: Params;
    Body: {
      declared_closing_amount: string;
      denomination_counts?: { value: string; quantity: number }[];
      discrepancy_reason?: string;
      card_reconciliation?: {
        entries: { label: string; amount: string; reference?: string; note?: string }[];
        note?: string;
      };
    };
  }>(
    '/api/v1/cash-sessions/:id/closures',
    {
      schema: {
        tags: ['cash'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        headers: idempotencyHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['declared_closing_amount'],
          properties: {
            declared_closing_amount: { type: 'string', pattern: '^(?:0|[1-9]\\d*)(?:\\.\\d{1,4})?$' },
            // Part J — optional; the backend still requires this to sum
            // exactly to declared_closing_amount (never trusted as a
            // second, separately-authoritative total).
            denomination_counts: {
              type: 'array',
              minItems: 1,
              maxItems: 11,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['value', 'quantity'],
                properties: {
                  value: { type: 'string', pattern: '^(?:0|[1-9]\\d*)(?:\\.\\d{1,4})?$' },
                  quantity: { type: 'integer', minimum: 0 },
                },
              },
            },
            // TASK 16.14 §12 — optional explanation for a non-zero
            // discrepancy; NEVER required (see `CashService.closeSession`'s
            // own doc comment) — this schema never conditions the close
            // on the size of any eventual discrepancy.
            discrepancy_reason: { type: 'string', minLength: 1, maxLength: 1000 },
            // TASK 16.14A §7/§10 — optional. The PRESENCE of this key
            // (even with an empty `entries` array) is itself the "operator
            // attempted reconciliation" signal — see
            // `CashCardReconciliationStatus`'s own doc comment for why a
            // request that omits this key entirely produces `pending`,
            // never `reconciled` with a fabricated zero total.
            card_reconciliation: {
              type: 'object',
              additionalProperties: false,
              required: ['entries'],
              properties: {
                entries: {
                  type: 'array',
                  maxItems: 20,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['label', 'amount'],
                    properties: {
                      label: { type: 'string', minLength: 1, maxLength: 200 },
                      amount: { type: 'string', pattern: '^(?:0|[1-9]\\d*)(?:\\.\\d{1,4})?$' },
                      reference: { type: 'string', maxLength: 200 },
                      note: { type: 'string', maxLength: 500 },
                    },
                  },
                },
                note: { type: 'string', maxLength: 1000 },
              },
            },
          },
        },
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withCashErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'cash_session.close');
        const closed = await service.closeSession(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          request.params.id,
          {
            declaredClosingAmount: request.body.declared_closing_amount,
            ...(request.body.denomination_counts === undefined
              ? {}
              : { denominationCounts: request.body.denomination_counts }),
            ...(request.body.discrepancy_reason === undefined
              ? {}
              : { discrepancyReason: request.body.discrepancy_reason }),
            ...(request.body.card_reconciliation === undefined
              ? {}
              : { cardReconciliation: request.body.card_reconciliation }),
          },
        );
        if (closed.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .code(201)
          .header('etag', `"${closed.value.version.toString()}"`)
          .send(successResponse(sessionHttp(closed.value), request.requestContext));
      }),
  );

  // TASK 14.4 (Wave 2, Part F.3) — "Corte parcial." Permission choice
  // documented in TASK 14.4's own report: `cash_movement.create` (not
  // `cash_session.read`, and deliberately NOT `cash_session.close`) —
  // this is a real mutation (it creates a persisted snapshot row and is
  // idempotency-key-gated exactly like every other write in this module),
  // performed by the same operator role that already posts cash_in/
  // cash_out movements during a shift, and it must stay reachable to
  // someone who explicitly cannot close the session.
  app.post<{ Params: Params }>(
    '/api/v1/cash-sessions/:id/partial-close',
    {
      schema: {
        tags: ['cash'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        headers: idempotencyHeaders,
        body: { type: 'object', additionalProperties: false, properties: {} },
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withCashErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'cash_movement.create');
        const created = await service.partialClose(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          request.params.id,
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        return reply.code(201).send(successResponse(partialCloseHttp(created.value), request.requestContext));
      }),
  );

  // The audit trail Part F.3 requires — read-only, never mutates.
  app.get<{ Params: Params }>(
    '/api/v1/cash-sessions/:id/partial-closes',
    {
      schema: {
        tags: ['cash'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withCashErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'cash_session.read');
        const items = await service.partialCloses(auth.companyId, auth.permittedBranchIds, request.params.id);
        return reply.send({
          data: items.map(partialCloseHttp),
          meta: responseMeta(request.requestContext),
        });
      }),
  );

  // TASK 16.11 (§13) — "Bitácora": a real, read-only view over the
  // `audit_log` rows this module already writes on every mutation (open/
  // movement/reversal/partial-close/close), scoped to one session. Gated
  // by `audit.read` — already granted to every system role by the TASK
  // 16.10B sync, never before enforced by any route in this codebase.
  app.get<{ Params: Params; Querystring: { limit?: number } }>(
    '/api/v1/cash-sessions/:id/audit-log',
    {
      schema: {
        tags: ['cash'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { limit: { type: 'integer', minimum: 1, maximum: 200 } },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withCashErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'audit.read');
        const items = await service.auditLog(
          auth.companyId,
          auth.permittedBranchIds,
          request.params.id,
          request.query.limit ?? 100,
        );
        return reply.send({
          data: items.map((item) => ({
            id: item.id,
            branch_id: item.branchId,
            actor_type: item.actorType,
            actor_id: item.actorId,
            action: item.action,
            entity_type: item.entityType,
            entity_id: item.entityId,
            metadata: item.metadata,
            occurred_at: item.occurredAt.toISOString(),
          })),
          meta: responseMeta(request.requestContext),
        });
      }),
  );
}
