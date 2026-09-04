import type { FastifyInstance, FastifyRequest } from 'fastify';

import { responseMeta, successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requireBranchAccess, requirePermission } from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import { idempotencyKey } from '../catalog/catalog.schemas.js';
import { withCashErrors } from './cash.http-errors.js';
import type { CashService } from './cash.service.js';
import type { CashMovementRow, CashMutationContext, CashRegisterRow, CashSessionRow } from './cash.types.js';

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
              expected_cash: value.expectedCash,
            },
            request.requestContext,
          ),
        );
      }),
  );

  // E045.
  app.post<{ Params: Params; Body: { id?: string; movement_type: 'cash_in' | 'cash_out'; amount: string; reason_code: string; note?: string } }>(
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
          },
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        return reply.code(201).send(successResponse(movementHttp(created.value), request.requestContext));
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
          },
        );
        if (closed.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .code(201)
          .header('etag', `"${closed.value.version.toString()}"`)
          .send(successResponse(sessionHttp(closed.value), request.requestContext));
      }),
  );
}
