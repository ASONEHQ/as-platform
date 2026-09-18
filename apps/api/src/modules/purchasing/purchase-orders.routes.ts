import type { FastifyInstance, FastifyRequest } from 'fastify';

import { responseMeta, successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requireBranchAccess, requirePermission } from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import { idempotencyKey } from '../catalog/catalog.schemas.js';
import { withPurchaseOrderErrors } from './purchase-orders.http-errors.js';
import type { PurchaseOrdersService } from './purchase-orders.service.js';
import type {
  PurchaseOrderMovementSummary,
  PurchaseOrderRow,
  PurchaseOrderMutationContext,
} from './purchase-orders.types.js';

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
// Same decimal-string shapes `direct-purchases`' own `quantity`/`unit_cost`
// body schemas use — see `purchasing.routes.ts`.
const QUANTITY_PATTERN = '^(?:0|[1-9]\\d*)(?:\\.\\d{1,6})?$';
const MONEY_PATTERN = '^(?:0|[1-9]\\d*)(?:\\.\\d{1,4})?$';
const DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';

function mutationContext(
  request: FastifyRequest,
  companyId: string,
  actorId: string,
): PurchaseOrderMutationContext {
  return {
    companyId,
    actorId,
    requestId: request.requestContext.requestId,
    correlationId: request.requestContext.correlationId,
    timestamp: new Date(),
    deviceId: request.requestContext.deviceId,
  };
}

function purchaseOrderHttp(
  value: PurchaseOrderRow,
  movement?: PurchaseOrderMovementSummary,
): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    order_number: value.orderNumber,
    branch_id: value.branchId,
    status: value.status,
    supplier_name: value.supplierName,
    supplier_id: value.supplierId,
    order_date: value.orderDate,
    expected_date: value.expectedDate,
    currency_code: value.currencyCode,
    total_cost: value.totalCost,
    notes: value.notes,
    submitted_at: value.submittedAt?.toISOString() ?? null,
    submitted_by: value.submittedBy,
    received_at: value.receivedAt?.toISOString() ?? null,
    received_by: value.receivedBy,
    cancelled_at: value.cancelledAt?.toISOString() ?? null,
    cancelled_by: value.cancelledBy,
    receipt_movement_id: value.receiptMovementId,
    version: value.version.toString(),
    created_by: value.createdBy,
    created_at: value.createdAt.toISOString(),
    updated_at: value.updatedAt.toISOString(),
    lines: value.lines.map((line) => ({
      id: line.id,
      line_number: line.lineNumber,
      product_variant_id: line.productVariantId,
      ordered_quantity: line.orderedQuantity,
      received_quantity: line.receivedQuantity,
      unit_cost: line.unitCost,
      line_total: line.lineTotal,
      notes: line.notes,
    })),
    ...(movement === undefined
      ? {}
      : {
          inventory_movement: {
            id: movement.movementId,
            movement_number: movement.movementNumber,
            status: movement.status,
            posted_at: movement.postedAt?.toISOString() ?? null,
            lines: movement.lines.map((line) => ({
              product_variant_id: line.productVariantId,
              current_quantity_on_hand: line.currentQuantityOnHand,
            })),
          },
        }),
  };
}

export function registerPurchaseOrdersRoutes(
  app: FastifyInstance,
  authentication: AuthService,
  service: PurchaseOrdersService,
): void {
  // POST /api/v1/purchase-orders — TASK 12.2.
  app.post<{
    Body: {
      id?: string;
      branch_id: string;
      supplier_name?: string | null;
      supplier_id?: string | null;
      order_date: string;
      expected_date?: string | null;
      currency_code: string;
      notes?: string | null;
      lines: {
        product_variant_id: string;
        ordered_quantity: string;
        unit_cost: string;
        notes?: string | null;
      }[];
    };
  }>(
    '/api/v1/purchase-orders',
    {
      schema: {
        tags: ['purchasing'],
        headers: idempotencyHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['branch_id', 'order_date', 'currency_code', 'lines'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            branch_id: { type: 'string', format: 'uuid' },
            supplier_name: { anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }] },
            supplier_id: { anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] },
            order_date: { type: 'string', pattern: DATE_PATTERN },
            expected_date: { anyOf: [{ type: 'string', pattern: DATE_PATTERN }, { type: 'null' }] },
            currency_code: { type: 'string', minLength: 3, maxLength: 3 },
            notes: { anyOf: [{ type: 'string', maxLength: 2000 }, { type: 'null' }] },
            // Deliberately no `minItems: 1` here — an empty array is
            // rejected by `PurchaseOrdersService.createPurchaseOrder`'s
            // own `purchase_order_empty_lines` domain error instead, so
            // the client always gets that specific, documented error
            // code rather than a generic schema-validation message (see
            // this task's own error-code table).
            lines: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['product_variant_id', 'ordered_quantity', 'unit_cost'],
                properties: {
                  product_variant_id: { type: 'string', format: 'uuid' },
                  ordered_quantity: { type: 'string', pattern: QUANTITY_PATTERN },
                  unit_cost: { type: 'string', pattern: MONEY_PATTERN },
                  notes: { anyOf: [{ type: 'string', maxLength: 2000 }, { type: 'null' }] },
                },
              },
            },
          },
        },
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPurchaseOrderErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'purchase.create');
        requireBranchAccess(authentication, auth, request.body.branch_id);
        const created = await service.createPurchaseOrder(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          {
            ...(request.body.id === undefined ? {} : { id: request.body.id }),
            branchId: request.body.branch_id,
            supplierName: request.body.supplier_name ?? null,
            supplierId: request.body.supplier_id ?? null,
            orderDate: request.body.order_date,
            expectedDate: request.body.expected_date ?? null,
            currencyCode: request.body.currency_code,
            notes: request.body.notes ?? null,
            lines: request.body.lines.map((line) => ({
              productVariantId: line.product_variant_id,
              orderedQuantity: line.ordered_quantity,
              unitCost: line.unit_cost,
              notes: line.notes ?? null,
            })),
          },
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        const movement = await service.movementSummary(auth.companyId, created.value);
        return reply
          .code(201)
          .send(successResponse(purchaseOrderHttp(created.value, movement), request.requestContext));
      }),
  );

  // GET /api/v1/purchase-orders/:id.
  app.get<{ Params: Params }>(
    '/api/v1/purchase-orders/:id',
    {
      schema: {
        tags: ['purchasing'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPurchaseOrderErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'purchase.read');
        const value = await service.purchaseOrder(auth.companyId, auth.permittedBranchIds, request.params.id);
        const movement = await service.movementSummary(auth.companyId, value);
        return reply.send(successResponse(purchaseOrderHttp(value, movement), request.requestContext));
      }),
  );

  // GET /api/v1/purchase-orders — paginated, filterable, light list.
  app.get<{
    Querystring: {
      cursor?: string;
      limit?: number;
      branch_id?: string;
      status?: string;
      supplier_id?: string;
      order_date_from?: string;
      order_date_to?: string;
    };
  }>(
    '/api/v1/purchase-orders',
    {
      schema: {
        tags: ['purchasing'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cursor: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            branch_id: { type: 'string', format: 'uuid' },
            status: {
              type: 'string',
              enum: ['draft', 'submitted', 'partially_received', 'received', 'cancelled'],
            },
            supplier_id: { type: 'string', format: 'uuid' },
            order_date_from: { type: 'string', pattern: DATE_PATTERN },
            order_date_to: { type: 'string', pattern: DATE_PATTERN },
          },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPurchaseOrderErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'purchase.read');
        const query = request.query;
        if (query.branch_id !== undefined) requireBranchAccess(authentication, auth, query.branch_id);
        const page = await service.listPurchaseOrders(auth.companyId, auth.permittedBranchIds, {
          limit: query.limit ?? 50,
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(query.branch_id === undefined ? {} : { branchId: query.branch_id }),
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.supplier_id === undefined ? {} : { supplierId: query.supplier_id }),
          ...(query.order_date_from === undefined ? {} : { orderDateFrom: query.order_date_from }),
          ...(query.order_date_to === undefined ? {} : { orderDateTo: query.order_date_to }),
        });
        return reply.send({
          data: page.items.map((item) => ({
            id: item.id,
            order_number: item.orderNumber,
            branch_id: item.branchId,
            status: item.status,
            supplier_name: item.supplierName,
            supplier_id: item.supplierId,
            order_date: item.orderDate,
            expected_date: item.expectedDate,
            currency_code: item.currencyCode,
            total_cost: item.totalCost,
            line_count: item.lineCount,
            created_at: item.createdAt.toISOString(),
          })),
          meta: { ...responseMeta(request.requestContext), page: { next_cursor: page.nextCursor, has_more: page.nextCursor !== null } },
        });
      }),
  );

  // POST /api/v1/purchase-orders/:id/submit.
  app.post<{ Params: Params; Body: Record<string, never> }>(
    '/api/v1/purchase-orders/:id/submit',
    {
      schema: {
        tags: ['purchasing'],
        headers: idempotencyHeaders,
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
        body: { type: 'object', additionalProperties: false },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPurchaseOrderErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'purchase.create');
        const submitted = await service.submitPurchaseOrder(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          request.params.id,
          idempotencyKey(request.headers['idempotency-key']),
        );
        if (submitted.replayed) reply.header('idempotency-replayed', 'true');
        return reply.send(successResponse(purchaseOrderHttp(submitted.value), request.requestContext));
      }),
  );

  // POST /api/v1/purchase-orders/:id/receive — deliberately the ONLY
  // receiving event a PO ever gets; see `purchase-orders.service.ts`'s
  // own doc comment on `receivePurchaseOrder`.
  app.post<{
    Params: Params;
    Body: { lines: { purchase_order_line_id: string; received_quantity: string }[] };
  }>(
    '/api/v1/purchase-orders/:id/receive',
    {
      schema: {
        tags: ['purchasing'],
        headers: idempotencyHeaders,
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['lines'],
          properties: {
            // Deliberately no `minItems: 1` — see the create endpoint's
            // own identical comment above; an empty array is rejected by
            // `purchase_order_empty_receipt` instead.
            lines: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['purchase_order_line_id', 'received_quantity'],
                properties: {
                  purchase_order_line_id: { type: 'string', format: 'uuid' },
                  received_quantity: { type: 'string', pattern: QUANTITY_PATTERN },
                },
              },
            },
          },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPurchaseOrderErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'purchase.receive');
        const received = await service.receivePurchaseOrder(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          request.params.id,
          idempotencyKey(request.headers['idempotency-key']),
          {
            lines: request.body.lines.map((line) => ({
              purchaseOrderLineId: line.purchase_order_line_id,
              receivedQuantity: line.received_quantity,
            })),
          },
        );
        if (received.replayed) reply.header('idempotency-replayed', 'true');
        const movement = await service.movementSummary(auth.companyId, received.value);
        return reply.send(successResponse(purchaseOrderHttp(received.value, movement), request.requestContext));
      }),
  );

  // POST /api/v1/purchase-orders/:id/cancel — never touches inventory.
  app.post<{ Params: Params; Body: { reason?: string | null } }>(
    '/api/v1/purchase-orders/:id/cancel',
    {
      schema: {
        tags: ['purchasing'],
        headers: idempotencyHeaders,
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { reason: { anyOf: [{ type: 'string', maxLength: 2000 }, { type: 'null' }] } },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPurchaseOrderErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'purchase.create');
        const cancelled = await service.cancelPurchaseOrder(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          request.params.id,
          idempotencyKey(request.headers['idempotency-key']),
          request.body.reason ?? null,
        );
        if (cancelled.replayed) reply.header('idempotency-replayed', 'true');
        const movement = await service.movementSummary(auth.companyId, cancelled.value);
        return reply.send(successResponse(purchaseOrderHttp(cancelled.value, movement), request.requestContext));
      }),
  );
}
