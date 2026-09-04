import type { FastifyInstance, FastifyRequest } from 'fastify';

import { responseMeta, successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requireBranchAccess, requirePermission } from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import { idempotencyKey } from '../catalog/catalog.schemas.js';
import { withRefundErrors } from './refunds.http-errors.js';
import type { RefundsService } from './refunds.service.js';
import type { RefundItemRow, RefundMutationContext, RefundRow } from './refunds.types.js';

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

function mutationContext(
  request: FastifyRequest,
  companyId: string,
  actorId: string,
  actorPermissions: readonly string[],
): RefundMutationContext {
  return {
    companyId,
    actorId,
    actorPermissions,
    requestId: request.requestContext.requestId,
    correlationId: request.requestContext.correlationId,
    timestamp: new Date(),
    deviceId: request.requestContext.deviceId,
  };
}

function refundHttp(value: RefundRow, items?: readonly RefundItemRow[]): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    branch_id: value.branchId,
    sale_id: value.saleId,
    cash_session_id: value.cashSessionId,
    payment_id: value.paymentId,
    refund_number: value.refundNumber,
    status: value.status,
    refund_method: value.refundMethod,
    reason_code: value.reasonCode,
    reason_note: value.reasonNote,
    currency_code: value.currencyCode,
    subtotal: value.subtotal,
    tax_total: value.taxTotal,
    total: value.total,
    occurred_at: value.occurredAt.toISOString(),
    completed_at: value.completedAt?.toISOString() ?? null,
    created_by: value.createdBy,
    approved_by: value.approvedBy,
    version: Number(value.version),
    ...(items === undefined
      ? {}
      : {
          items: items.map((item) => ({
            id: item.id,
            sale_item_id: item.saleItemId,
            quantity: item.quantity,
            subtotal: item.subtotal,
            tax_total: item.taxTotal,
            line_total: item.lineTotal,
            restock_disposition: item.restockDisposition,
          })),
        }),
  };
}

export function registerRefundRoutes(app: FastifyInstance, authentication: AuthService, service: RefundsService): void {
  // E081.
  app.get<{ Params: { sale_id: string } }>(
    '/api/v1/sales/:sale_id/refundable-balance',
    {
      schema: {
        tags: ['refunds'],
        params: { type: 'object', required: ['sale_id'], properties: { sale_id: { type: 'string' } } },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withRefundErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'refund.read');
        const balance = await service.refundableBalance(auth.companyId, auth.permittedBranchIds, request.params.sale_id);
        return reply.send(
          successResponse(
            {
              sale_id: balance.saleId,
              refundable: balance.refundable,
              blocked_reason: balance.blockedReason,
              lines: balance.lines.map((line) => ({
                sale_item_id: line.saleItemId,
                name_snapshot: line.nameSnapshot,
                sold_quantity: line.soldQuantity,
                refunded_quantity: line.refundedQuantity,
                refundable_quantity: line.refundableQuantity,
                unit_price: line.unitPrice,
              })),
            },
            request.requestContext,
          ),
        );
      }),
  );

  // E082.
  app.post<{
    Body: {
      id?: string;
      sale_id: string;
      reason_code: string;
      reason_note?: string;
      items: { sale_item_id: string; quantity: string }[];
    };
  }>(
    '/api/v1/refunds',
    {
      schema: {
        tags: ['refunds'],
        headers: idempotencyHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['sale_id', 'reason_code', 'items'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            sale_id: { type: 'string', format: 'uuid' },
            reason_code: { type: 'string', minLength: 1, maxLength: 200 },
            reason_note: { type: 'string', maxLength: 500 },
            items: {
              type: 'array',
              minItems: 1,
              maxItems: 200,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['sale_item_id', 'quantity'],
                properties: {
                  sale_item_id: { type: 'string', format: 'uuid' },
                  quantity: { type: 'string', pattern: '^(?:0|[1-9]\\d*)(?:\\.\\d{1,6})?$' },
                },
              },
            },
          },
        },
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withRefundErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'refund.create');
        const created = await service.createRefund(
          mutationContext(request, auth.companyId, auth.userId, auth.permissions),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          {
            ...(request.body.id === undefined ? {} : { id: request.body.id }),
            saleId: request.body.sale_id,
            reasonCode: request.body.reason_code,
            ...(request.body.reason_note === undefined ? {} : { reasonNote: request.body.reason_note }),
            items: request.body.items.map((item) => ({ saleItemId: item.sale_item_id, quantity: item.quantity })),
          },
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        const items = await service.refundItems(auth.companyId, auth.permittedBranchIds, created.value.id);
        return reply
          .code(201)
          .header('etag', `"${created.value.version.toString()}"`)
          .send(successResponse(refundHttp(created.value, items), request.requestContext));
      }),
  );

  // E083.
  app.get<{ Params: Params }>(
    '/api/v1/refunds/:id',
    {
      schema: {
        tags: ['refunds'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withRefundErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'refund.read');
        const value = await service.refund(auth.companyId, auth.permittedBranchIds, request.params.id);
        const items = await service.refundItems(auth.companyId, auth.permittedBranchIds, value.id);
        return reply
          .header('etag', `"${value.version.toString()}"`)
          .send(successResponse(refundHttp(value, items), request.requestContext));
      }),
  );

  // E084 — also what both the dedicated "Devoluciones" history view and
  // a Sale Detail's "returns for this sale" section call (via `sale_id`).
  app.get<{
    Querystring: {
      cursor?: string;
      limit?: number;
      branch_id?: string;
      sale_id?: string;
      status?: string;
      occurred_from?: string;
      occurred_to?: string;
    };
  }>(
    '/api/v1/refunds',
    {
      schema: {
        tags: ['refunds'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cursor: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            branch_id: { type: 'string', format: 'uuid' },
            sale_id: { type: 'string', format: 'uuid' },
            status: {
              type: 'string',
              enum: ['requested', 'pending_approval', 'approved', 'completed', 'cancelled', 'rejected'],
            },
            occurred_from: { type: 'string', format: 'date-time' },
            occurred_to: { type: 'string', format: 'date-time' },
          },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withRefundErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'refund.read');
        const query = request.query;
        if (query.branch_id !== undefined) requireBranchAccess(authentication, auth, query.branch_id);
        const page = await service.listRefunds(auth.companyId, auth.permittedBranchIds, {
          limit: query.limit ?? 50,
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(query.branch_id === undefined ? {} : { branchId: query.branch_id }),
          ...(query.sale_id === undefined ? {} : { saleId: query.sale_id }),
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.occurred_from === undefined ? {} : { occurredFrom: new Date(query.occurred_from) }),
          ...(query.occurred_to === undefined ? {} : { occurredTo: new Date(query.occurred_to) }),
        });
        return reply.send({
          data: page.items.map((item) => refundHttp(item)),
          meta: { ...responseMeta(request.requestContext), page: { next_cursor: page.nextCursor, has_more: page.nextCursor !== null } },
        });
      }),
  );

  // E086.
  app.post<{ Params: Params; Body: { cash_register_id?: string } }>(
    '/api/v1/refunds/:id/completion',
    {
      schema: {
        tags: ['refunds'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        headers: idempotencyHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { cash_register_id: { type: 'string', format: 'uuid' } },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withRefundErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'refund.complete');
        const completed = await service.completeRefund(
          mutationContext(request, auth.companyId, auth.userId, auth.permissions),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          request.params.id,
          {
            ...(request.body.cash_register_id === undefined ? {} : { cashRegisterId: request.body.cash_register_id }),
          },
        );
        if (completed.replayed) reply.header('idempotency-replayed', 'true');
        const items = await service.refundItems(auth.companyId, auth.permittedBranchIds, completed.value.id);
        return reply
          .header('etag', `"${completed.value.version.toString()}"`)
          .send(successResponse(refundHttp(completed.value, items), request.requestContext));
      }),
  );
}
