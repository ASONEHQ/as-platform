import type { FastifyInstance, FastifyRequest } from 'fastify';

import { AppError } from '@asone/errors';

import { responseMeta, successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requirePermission } from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import type { InventoryCountService } from './inventory-counts.service.js';
import { inventoryCountJson } from './inventory-counts.service.js';
import { InventoryCountError } from './inventory-counts.types.js';
import type { InventoryMutationContext } from './inventory.types.js';

interface Params {
  count_id: string;
}
interface LineParams extends Params {
  product_variant_id: string;
}
interface ListQuery {
  cursor?: string;
  limit?: number;
  branch_id?: string;
  location_id?: string;
  status?: 'draft' | 'counting' | 'submitted' | 'approved' | 'applied' | 'cancelled';
  created_from?: string;
  created_to?: string;
}
interface CreateBody {
  branch_id: string;
  location_id: string;
  scope: { type: 'all_balanced_variants' | 'explicit_variants'; product_variant_ids?: string[] };
  reason_code: string;
  note?: string | null;
  metadata?: Readonly<Record<string, unknown>> | null;
}
interface LineBody {
  counted_quantity: string;
  unit_of_measure_code: string;
  metadata?: Readonly<Record<string, unknown>> | null;
}
interface CancelBody {
  reason_code: string;
  note?: string | null;
}

const params = {
  type: 'object',
  additionalProperties: false,
  required: ['count_id'],
  properties: { count_id: { type: 'string', format: 'uuid' } },
} as const;
const lineParams = {
  type: 'object',
  additionalProperties: false,
  required: ['count_id', 'product_variant_id'],
  properties: {
    count_id: { type: 'string', format: 'uuid' },
    product_variant_id: { type: 'string', format: 'uuid' },
  },
} as const;
const mutationHeaders = {
  type: 'object',
  required: ['idempotency-key'],
  properties: { 'idempotency-key': { type: 'string', minLength: 1, maxLength: 255 } },
} as const;
const transitionHeaders = {
  type: 'object',
  required: ['if-match', 'idempotency-key'],
  properties: {
    'if-match': { type: 'string' },
    'idempotency-key': { type: 'string', minLength: 1, maxLength: 255 },
  },
} as const;
const ifMatchHeaders = {
  type: 'object',
  required: ['if-match'],
  properties: { 'if-match': { type: 'string' } },
} as const;
const empty = { type: 'object', additionalProperties: false, maxProperties: 0 } as const;
const errors = {
  400: { type: 'object', additionalProperties: true },
  401: { type: 'object', additionalProperties: true },
  403: { type: 'object', additionalProperties: true },
  404: { type: 'object', additionalProperties: true },
  409: { type: 'object', additionalProperties: true },
} as const;
function context(
  request: FastifyRequest,
  companyId: string,
  actorId: string,
): InventoryMutationContext {
  return {
    companyId,
    actorId,
    requestId: request.requestContext.requestId,
    correlationId: request.requestContext.correlationId,
    timestamp: new Date(),
  };
}
function key(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new AppError({
      code: 'validation_error',
      message: 'Idempotency-Key is required.',
      statusCode: 400,
    });
  return value;
}
function version(value: string | undefined): bigint {
  const match = /^"([1-9]\d*)"$/u.exec(value ?? '');
  if (match?.[1] === undefined)
    throw new AppError({
      code: 'validation_error',
      message: 'If-Match must contain a strong positive version ETag.',
      statusCode: 400,
    });
  return BigInt(match[1]);
}
async function toHttp<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    if (!(error instanceof InventoryCountError)) throw error;
    const statusCode =
      error.code === 'resource_not_found' ? 404 : error.code === 'validation_error' ? 400 : 409;
    throw new AppError({
      code: error.code,
      message: error.message,
      statusCode,
      ...(error.details === undefined ? {} : { details: error.details }),
    });
  }
}
export function registerInventoryCountRoutes(
  app: FastifyInstance,
  authentication: AuthService,
  service: InventoryCountService,
): void {
  app.get<{ Querystring: ListQuery }>(
    '/api/v1/inventory/counts',
    {
      schema: {
        tags: ['inventory'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cursor: { type: 'string', minLength: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            branch_id: { type: 'string', format: 'uuid' },
            location_id: { type: 'string', format: 'uuid' },
            status: {
              type: 'string',
              enum: ['draft', 'counting', 'submitted', 'approved', 'applied', 'cancelled'],
            },
            created_from: { type: 'string', format: 'date-time' },
            created_to: { type: 'string', format: 'date-time' },
          },
        },
        response: { 200: { type: 'object', additionalProperties: true }, ...errors },
      },
    },
    async (request, reply) =>
      toHttp(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'inventory.read');
        const page = await service.list(auth.companyId, auth.permittedBranchIds, {
          limit: request.query.limit ?? 50,
          ...(request.query.cursor === undefined ? {} : { cursor: request.query.cursor }),
          ...(request.query.branch_id === undefined ? {} : { branchId: request.query.branch_id }),
          ...(request.query.location_id === undefined
            ? {}
            : { locationId: request.query.location_id }),
          ...(request.query.status === undefined ? {} : { status: request.query.status }),
          ...(request.query.created_from === undefined
            ? {}
            : { createdFrom: new Date(request.query.created_from) }),
          ...(request.query.created_to === undefined
            ? {}
            : { createdTo: new Date(request.query.created_to) }),
        });
        return reply.send({
          ...successResponse(page.items, request.requestContext),
          meta: {
            ...responseMeta(request.requestContext),
            page: { next_cursor: page.nextCursor, has_more: page.nextCursor !== null },
          },
        });
      }),
  );
  app.post<{ Body: CreateBody }>(
    '/api/v1/inventory/counts',
    {
      schema: {
        tags: ['inventory'],
        headers: mutationHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['branch_id', 'location_id', 'scope', 'reason_code'],
          properties: {
            branch_id: { type: 'string', format: 'uuid' },
            location_id: { type: 'string', format: 'uuid' },
            scope: {
              type: 'object',
              additionalProperties: false,
              required: ['type'],
              properties: {
                type: { type: 'string', enum: ['all_balanced_variants', 'explicit_variants'] },
                product_variant_ids: {
                  type: 'array',
                  minItems: 1,
                  maxItems: 1000,
                  uniqueItems: true,
                  items: { type: 'string', format: 'uuid' },
                },
              },
            },
            reason_code: { type: 'string', minLength: 1, maxLength: 64 },
            note: { anyOf: [{ type: 'string', maxLength: 2000 }, { type: 'null' }] },
            metadata: { anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
          },
        },
        response: { 201: { type: 'object', additionalProperties: true }, ...errors },
      },
    },
    async (request, reply) =>
      toHttp(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'inventory.count');
        const result = await service.create(
          context(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          key(request.headers['idempotency-key']),
          {
            branchId: request.body.branch_id,
            locationId: request.body.location_id,
            scope: {
              type: request.body.scope.type,
              ...(request.body.scope.product_variant_ids === undefined
                ? {}
                : { productVariantIds: request.body.scope.product_variant_ids }),
            },
            reasonCode: request.body.reason_code,
            ...(request.body.note === undefined ? {} : { note: request.body.note }),
            ...(request.body.metadata === undefined ? {} : { metadata: request.body.metadata }),
          },
        );
        if (result.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .code(201)
          .header('etag', `"${String(result.value.version)}"`)
          .send(successResponse(result.value, request.requestContext));
      }),
  );
  app.get<{ Params: Params }>(
    '/api/v1/inventory/counts/:count_id',
    {
      schema: {
        tags: ['inventory'],
        params,
        response: { 200: { type: 'object', additionalProperties: true }, ...errors },
      },
    },
    async (request, reply) =>
      toHttp(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'inventory.read');
        const value = await service.get(
          auth.companyId,
          auth.permittedBranchIds,
          request.params.count_id,
        );
        return reply
          .header('etag', `"${value.version.toString()}"`)
          .send(successResponse(inventoryCountJson(value), request.requestContext));
      }),
  );
  const transition = (
    route: string,
    permission: 'inventory.count' | 'inventory.approve',
    execute: (
      ctx: InventoryMutationContext,
      branches: readonly string[],
      id: string,
      v: bigint,
      k: string,
    ) => Promise<{ value: Readonly<Record<string, unknown>>; replayed: boolean }>,
  ): void => {
    app.post<{ Params: Params; Body: Record<string, never> }>(
      route,
      {
        schema: {
          tags: ['inventory'],
          params,
          headers: transitionHeaders,
          body: empty,
          response: { 200: { type: 'object', additionalProperties: true }, ...errors },
        },
      },
      async (request, reply) =>
        toHttp(async () => {
          const auth = await requireAuthenticatedUser(request, authentication);
          requirePermission(authentication, auth, permission);
          const result = await execute(
            context(request, auth.companyId, auth.userId),
            auth.permittedBranchIds,
            request.params.count_id,
            version(request.headers['if-match']),
            key(request.headers['idempotency-key']),
          );
          if (result.replayed) reply.header('idempotency-replayed', 'true');
          return reply
            .header('etag', `"${String(result.value.version)}"`)
            .send(successResponse(result.value, request.requestContext));
        }),
    );
  };
  transition('/api/v1/inventory/counts/:count_id/starts', 'inventory.count', (ctx, b, id, v, k) =>
    service.start(ctx, b, id, v, k),
  );
  app.put<{ Params: LineParams; Body: LineBody }>(
    '/api/v1/inventory/counts/:count_id/lines/:product_variant_id',
    {
      schema: {
        tags: ['inventory'],
        params: lineParams,
        headers: ifMatchHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['counted_quantity', 'unit_of_measure_code'],
          properties: {
            counted_quantity: { type: 'string', pattern: '^(?:0|[1-9]\\d*)(?:\\.\\d{1,6})?$' },
            unit_of_measure_code: { type: 'string', minLength: 1, maxLength: 32 },
            metadata: { anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
          },
        },
        response: { 200: { type: 'object', additionalProperties: true }, ...errors },
      },
    },
    async (request, reply) =>
      toHttp(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'inventory.count');
        const value = await service.recordLine(
          context(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          request.params.count_id,
          request.params.product_variant_id,
          version(request.headers['if-match']),
          {
            countedQuantity: request.body.counted_quantity,
            unitOfMeasureCode: request.body.unit_of_measure_code,
            ...(request.body.metadata === undefined ? {} : { metadata: request.body.metadata }),
          },
        );
        return reply
          .header('etag', `"${String(value.version)}"`)
          .send(successResponse(value, request.requestContext));
      }),
  );
  transition(
    '/api/v1/inventory/counts/:count_id/submissions',
    'inventory.count',
    (ctx, b, id, v, k) => service.submit(ctx, b, id, v, k),
  );
  transition(
    '/api/v1/inventory/counts/:count_id/approvals',
    'inventory.approve',
    (ctx, b, id, v, k) => service.approve(ctx, b, id, v, k),
  );
  transition(
    '/api/v1/inventory/counts/:count_id/applications',
    'inventory.approve',
    (ctx, b, id, v, k) => service.apply(ctx, b, id, v, k),
  );
  app.post<{ Params: Params; Body: CancelBody }>(
    '/api/v1/inventory/counts/:count_id/cancellations',
    {
      schema: {
        tags: ['inventory'],
        params,
        headers: transitionHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['reason_code'],
          properties: {
            reason_code: { type: 'string', minLength: 1, maxLength: 64 },
            note: { anyOf: [{ type: 'string', maxLength: 2000 }, { type: 'null' }] },
          },
        },
        response: { 200: { type: 'object', additionalProperties: true }, ...errors },
      },
    },
    async (request, reply) =>
      toHttp(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'inventory.count');
        const result = await service.cancel(
          context(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          request.params.count_id,
          version(request.headers['if-match']),
          key(request.headers['idempotency-key']),
          {
            reasonCode: request.body.reason_code,
            ...(request.body.note === undefined ? {} : { note: request.body.note }),
          },
        );
        if (result.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .header('etag', `"${String(result.value.version)}"`)
          .send(successResponse(result.value, request.requestContext));
      }),
  );
}
