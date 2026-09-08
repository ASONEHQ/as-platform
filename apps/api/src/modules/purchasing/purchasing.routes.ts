import type { FastifyInstance, FastifyRequest } from 'fastify';

import { responseMeta, successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requireBranchAccess, requirePermission } from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import { idempotencyKey } from '../catalog/catalog.schemas.js';
import { withPurchaseErrors } from './purchasing.http-errors.js';
import type { PurchasingService } from './purchasing.service.js';
import type { DirectPurchaseMovementSummary, DirectPurchaseRow, PurchaseMutationContext } from './purchasing.types.js';

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
): PurchaseMutationContext {
  return {
    companyId,
    actorId,
    requestId: request.requestContext.requestId,
    correlationId: request.requestContext.correlationId,
    timestamp: new Date(),
    deviceId: request.requestContext.deviceId,
  };
}

function directPurchaseHttp(
  value: DirectPurchaseRow,
  movement?: DirectPurchaseMovementSummary,
): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    branch_id: value.branchId,
    supplier_name: value.supplierName,
    product_variant_id: value.productVariantId,
    quantity: value.quantity,
    unit_cost: value.unitCost,
    currency_code: value.currencyCode,
    total_cost: value.totalCost,
    purchase_date: value.purchaseDate,
    notes: value.notes,
    inventory_movement_id: value.inventoryMovementId,
    created_by: value.createdBy,
    created_at: value.createdAt.toISOString(),
    ...(movement === undefined
      ? {}
      : {
          inventory_movement: {
            id: movement.movementId,
            movement_number: movement.movementNumber,
            status: movement.status,
            posted_at: movement.postedAt?.toISOString() ?? null,
            current_quantity_on_hand: movement.currentQuantityOnHand,
          },
        }),
  };
}

export function registerPurchasingRoutes(
  app: FastifyInstance,
  authentication: AuthService,
  service: PurchasingService,
): void {
  // POST /api/v1/direct-purchases — "Compra Directa" (TASK 14.3, Wave 1 Part C).
  app.post<{
    Body: {
      id?: string;
      branch_id: string;
      supplier_name?: string | null;
      product_variant_id: string;
      quantity: string;
      unit_cost: string;
      currency_code: string;
      purchase_date: string;
      notes?: string | null;
    };
  }>(
    '/api/v1/direct-purchases',
    {
      schema: {
        tags: ['purchasing'],
        headers: idempotencyHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['branch_id', 'product_variant_id', 'quantity', 'unit_cost', 'currency_code', 'purchase_date'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            branch_id: { type: 'string', format: 'uuid' },
            supplier_name: { anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }] },
            product_variant_id: { type: 'string', format: 'uuid' },
            quantity: { type: 'string', pattern: '^(?:0|[1-9]\\d*)(?:\\.\\d{1,6})?$' },
            unit_cost: { type: 'string', pattern: '^(?:0|[1-9]\\d*)(?:\\.\\d{1,4})?$' },
            currency_code: { type: 'string', minLength: 3, maxLength: 3 },
            purchase_date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            notes: { anyOf: [{ type: 'string', maxLength: 2000 }, { type: 'null' }] },
          },
        },
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPurchaseErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'purchase.create');
        requireBranchAccess(authentication, auth, request.body.branch_id);
        const created = await service.recordDirectPurchase(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          {
            ...(request.body.id === undefined ? {} : { id: request.body.id }),
            branchId: request.body.branch_id,
            supplierName: request.body.supplier_name ?? null,
            productVariantId: request.body.product_variant_id,
            quantity: request.body.quantity,
            unitCost: request.body.unit_cost,
            currencyCode: request.body.currency_code,
            purchaseDate: request.body.purchase_date,
            notes: request.body.notes ?? null,
          },
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        const movement = await service.movementSummary(auth.companyId, created.value);
        return reply
          .code(201)
          .send(successResponse(directPurchaseHttp(created.value, movement), request.requestContext));
      }),
  );

  // GET /api/v1/direct-purchases/:id.
  app.get<{ Params: Params }>(
    '/api/v1/direct-purchases/:id',
    {
      schema: {
        tags: ['purchasing'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPurchaseErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'purchase.read');
        const value = await service.directPurchase(auth.companyId, auth.permittedBranchIds, request.params.id);
        const movement = await service.movementSummary(auth.companyId, value);
        return reply.send(successResponse(directPurchaseHttp(value, movement), request.requestContext));
      }),
  );

  // GET /api/v1/direct-purchases — paginated, filterable list.
  app.get<{
    Querystring: {
      cursor?: string;
      limit?: number;
      branch_id?: string;
      product_variant_id?: string;
      purchase_date_from?: string;
      purchase_date_to?: string;
    };
  }>(
    '/api/v1/direct-purchases',
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
            product_variant_id: { type: 'string', format: 'uuid' },
            purchase_date_from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            purchase_date_to: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPurchaseErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'purchase.read');
        const query = request.query;
        if (query.branch_id !== undefined) requireBranchAccess(authentication, auth, query.branch_id);
        const page = await service.listDirectPurchases(auth.companyId, auth.permittedBranchIds, {
          limit: query.limit ?? 50,
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(query.branch_id === undefined ? {} : { branchId: query.branch_id }),
          ...(query.product_variant_id === undefined ? {} : { productVariantId: query.product_variant_id }),
          ...(query.purchase_date_from === undefined ? {} : { purchaseDateFrom: query.purchase_date_from }),
          ...(query.purchase_date_to === undefined ? {} : { purchaseDateTo: query.purchase_date_to }),
        });
        return reply.send({
          data: page.items.map((item) => directPurchaseHttp(item)),
          meta: { ...responseMeta(request.requestContext), page: { next_cursor: page.nextCursor, has_more: page.nextCursor !== null } },
        });
      }),
  );
}
