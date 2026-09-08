import type { FastifyInstance, FastifyRequest } from 'fastify';

import { responseMeta, successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requireBranchAccess, requirePermission } from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import { idempotencyKey } from '../catalog/catalog.schemas.js';
import { withHeldSaleCartErrors } from './held-sales.http-errors.js';
import type { HeldSaleCartsService } from './held-sales.service.js';
import type { HeldSaleCartMutationContext, HeldSaleCartRow, HeldSaleCartStatus } from './held-sales.types.js';

interface Params {
  id: string;
}
interface ListQuery {
  cursor?: string;
  limit?: number;
  branch_id?: string;
  status?: HeldSaleCartStatus;
  cash_register_id?: string;
}
interface ItemBody {
  product_id: string;
  quantity: string;
}
interface CreateBody {
  id?: string;
  branch_id: string;
  cash_register_id?: string;
  customer_id?: string;
  label?: string;
  items: ItemBody[];
}
interface DiscardBody {
  reason?: string;
}
interface LinkSaleBody {
  sale_id: string;
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
  actorPermissions?: readonly string[],
): HeldSaleCartMutationContext {
  return {
    companyId,
    actorId,
    ...(actorPermissions === undefined ? {} : { actorPermissions }),
    requestId: request.requestContext.requestId,
    correlationId: request.requestContext.correlationId,
    timestamp: new Date(),
  };
}

function cartHttp(value: HeldSaleCartRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    branch_id: value.branchId,
    cash_register_id: value.cashRegisterId,
    customer_id: value.customerId,
    label: value.label,
    items: value.items.map((item) => ({ product_id: item.productId, quantity: item.quantity })),
    status: value.status,
    created_by: value.createdBy,
    claimed_at: value.claimedAt?.toISOString() ?? null,
    claimed_by: value.claimedBy,
    resumed_at: value.resumedAt?.toISOString() ?? null,
    resumed_by: value.resumedBy,
    // `null` in every state except the real, terminal `'resumed'` — a
    // plain, honest reflection of the database column, never a
    // sentinel (TASK 14.3A) — see `held-sales.types.ts`'s own doc
    // comment on `HeldSaleCartRow.resumedSaleId`.
    resumed_sale_id: value.resumedSaleId,
    discarded_at: value.discardedAt?.toISOString() ?? null,
    discarded_by: value.discardedBy,
    created_at: value.createdAt.toISOString(),
  };
}

export function registerHeldSaleCartRoutes(
  app: FastifyInstance,
  authentication: AuthService,
  service: HeldSaleCartsService,
): void {
  // Suspend / hold a cart.
  app.post<{ Body: CreateBody }>(
    '/api/v1/held-sale-carts',
    {
      schema: {
        tags: ['held-sales'],
        headers: idempotencyHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['branch_id', 'items'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            branch_id: { type: 'string', format: 'uuid' },
            cash_register_id: { type: 'string', format: 'uuid' },
            customer_id: { type: 'string', format: 'uuid' },
            label: { type: 'string', minLength: 1, maxLength: 200 },
            items: {
              type: 'array',
              minItems: 1,
              maxItems: 200,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['product_id', 'quantity'],
                properties: {
                  product_id: { type: 'string', format: 'uuid' },
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
      withHeldSaleCartErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'held_sale.manage');
        requireBranchAccess(authentication, auth, request.body.branch_id);
        const created = await service.createCart(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          {
            ...(request.body.id === undefined ? {} : { id: request.body.id }),
            branchId: request.body.branch_id,
            ...(request.body.cash_register_id === undefined ? {} : { cashRegisterId: request.body.cash_register_id }),
            ...(request.body.customer_id === undefined ? {} : { customerId: request.body.customer_id }),
            ...(request.body.label === undefined ? {} : { label: request.body.label }),
            items: request.body.items.map((item) => ({ productId: item.product_id, quantity: item.quantity })),
          },
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        return reply.code(201).send(successResponse(cartHttp(created.value), request.requestContext));
      }),
  );

  // List — defaults to `status='held'` (the "what's currently paused"
  // view) unless the caller explicitly asks for another status.
  app.get<{ Querystring: ListQuery }>(
    '/api/v1/held-sale-carts',
    {
      schema: {
        tags: ['held-sales'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cursor: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            branch_id: { type: 'string', format: 'uuid' },
            status: { type: 'string', enum: ['held', 'resuming', 'resumed', 'discarded'] },
            cash_register_id: { type: 'string', format: 'uuid' },
          },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withHeldSaleCartErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'held_sale.manage');
        const query = request.query;
        if (query.branch_id !== undefined) requireBranchAccess(authentication, auth, query.branch_id);
        const page = await service.listCarts(auth.companyId, auth.permittedBranchIds, {
          limit: query.limit ?? 50,
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(query.branch_id === undefined ? {} : { branchId: query.branch_id }),
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.cash_register_id === undefined ? {} : { cashRegisterId: query.cash_register_id }),
        });
        return reply.send({
          data: page.items.map(cartHttp),
          meta: {
            ...responseMeta(request.requestContext),
            page: { next_cursor: page.nextCursor, has_more: page.nextCursor !== null },
          },
        });
      }),
  );

  app.get<{ Params: Params }>(
    '/api/v1/held-sale-carts/:id',
    {
      schema: {
        tags: ['held-sales'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withHeldSaleCartErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'held_sale.manage');
        const value = await service.cart(auth.companyId, auth.permittedBranchIds, request.params.id);
        return reply.send(successResponse(cartHttp(value), request.requestContext));
      }),
  );

  // The real recovery action — first half of the two-step handshake with
  // `link-sale` below. Claims the cart (`held -> resuming`); see
  // `HeldSaleCartsService.resumeCart`'s own doc comment for the full
  // TASK 14.3A state-machine reasoning.
  app.post<{ Params: Params }>(
    '/api/v1/held-sale-carts/:id/resume',
    {
      schema: {
        tags: ['held-sales'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        headers: idempotencyHeaders,
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withHeldSaleCartErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'held_sale.manage');
        const resumed = await service.resumeCart(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          request.params.id,
          idempotencyKey(request.headers['idempotency-key']),
        );
        if (resumed.replayed) reply.header('idempotency-replayed', 'true');
        return reply.send(successResponse(cartHttp(resumed.value), request.requestContext));
      }),
  );

  // Optional second call — backfills `resumed_sale_id` once the client
  // has actually created the real sale from the resumed items.
  app.post<{ Params: Params; Body: LinkSaleBody }>(
    '/api/v1/held-sale-carts/:id/link-sale',
    {
      schema: {
        tags: ['held-sales'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        headers: idempotencyHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['sale_id'],
          properties: { sale_id: { type: 'string', format: 'uuid' } },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withHeldSaleCartErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'held_sale.manage');
        const linked = await service.linkSale(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          request.params.id,
          idempotencyKey(request.headers['idempotency-key']),
          request.body.sale_id,
        );
        if (linked.replayed) reply.header('idempotency-replayed', 'true');
        return reply.send(successResponse(cartHttp(linked.value), request.requestContext));
      }),
  );

  // TASK 14.3A (Wave 1 hardening) — the explicit recovery action for an
  // abandoned claim: `resuming -> held`, making the cart available to
  // be claimed again. No automatic/background expiry — see
  // `HeldSaleCartsService.releaseCart`'s own doc comment.
  app.post<{ Params: Params }>(
    '/api/v1/held-sale-carts/:id/release',
    {
      schema: {
        tags: ['held-sales'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        headers: idempotencyHeaders,
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withHeldSaleCartErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'held_sale.manage');
        const released = await service.releaseCart(
          mutationContext(request, auth.companyId, auth.userId, auth.permissions),
          auth.permittedBranchIds,
          request.params.id,
          idempotencyKey(request.headers['idempotency-key']),
        );
        if (released.replayed) reply.header('idempotency-replayed', 'true');
        return reply.send(successResponse(cartHttp(released.value), request.requestContext));
      }),
  );

  // Permission: the base `held_sale.manage` gate above is required on
  // every route; discarding someone else's held cart additionally
  // requires `sale.cancel` — enforced inside
  // `HeldSaleCartsService.discardCart` itself (it alone knows the cart's
  // `createdBy`), mirroring `POST /sales/:id/cancellations`'s own
  // permission shape.
  app.post<{ Params: Params; Body: DiscardBody }>(
    '/api/v1/held-sale-carts/:id/discard',
    {
      schema: {
        tags: ['held-sales'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        headers: idempotencyHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { reason: { type: 'string', minLength: 1, maxLength: 200 } },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withHeldSaleCartErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'held_sale.manage');
        const discarded = await service.discardCart(
          mutationContext(request, auth.companyId, auth.userId, auth.permissions),
          auth.permittedBranchIds,
          request.params.id,
          idempotencyKey(request.headers['idempotency-key']),
          request.body.reason,
        );
        if (discarded.replayed) reply.header('idempotency-replayed', 'true');
        return reply.send(successResponse(cartHttp(discarded.value), request.requestContext));
      }),
  );
}
