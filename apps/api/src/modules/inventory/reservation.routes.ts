import type { FastifyInstance, FastifyRequest } from 'fastify';

import { AppError } from '@asone/errors';

import { responseMeta, successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requirePermission } from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import type {
  ReservationCreateInput,
  ReservationListInput,
  ReservationReleaseInput,
} from './reservation.service.js';
import { reservationJson } from './reservation.service.js';
import type { InventoryReservationService } from './reservation.service.js';
import { InventoryReservationError } from './reservation.types.js';
import type { InventoryMutationContext } from './inventory.types.js';

interface Params {
  reservation_id: string;
}
interface ListQuery {
  cursor?: string;
  limit?: number;
  branch_id?: string;
  status?: ReservationListInput['status'];
  owner_type?: ReservationListInput['ownerType'];
  owner_id?: string;
  location_id?: string;
  product_variant_id?: string;
  expires_before?: string;
  created_from?: string;
  created_to?: string;
}
interface CreateBody {
  branch_id: string;
  owner_type: ReservationCreateInput['ownerType'];
  owner_id: string;
  expires_at?: string | null;
  lines: {
    location_id: string;
    product_variant_id: string;
    quantity: string;
    unit_of_measure_code: string;
  }[];
}
interface ReleaseBody {
  action: ReservationReleaseInput['action'];
  reason_code: string;
  note?: string | null;
}

const reservationParams = {
  type: 'object',
  additionalProperties: false,
  required: ['reservation_id'],
  properties: { reservation_id: { type: 'string', format: 'uuid' } },
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
    if (!(error instanceof InventoryReservationError)) throw error;
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

export function registerInventoryReservationRoutes(
  app: FastifyInstance,
  authentication: AuthService,
  service: InventoryReservationService,
): void {
  app.get<{ Querystring: ListQuery }>(
    '/api/v1/inventory/reservations',
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
            status: {
              type: 'string',
              enum: ['active', 'confirmed', 'released', 'expired', 'cancelled'],
            },
            owner_type: { type: 'string', enum: ['pos_cart', 'event', 'booking', 'order'] },
            owner_id: { type: 'string', minLength: 1, maxLength: 128 },
            location_id: { type: 'string', format: 'uuid' },
            product_variant_id: { type: 'string', format: 'uuid' },
            expires_before: { type: 'string', format: 'date-time' },
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
          ...(request.query.status === undefined ? {} : { status: request.query.status }),
          ...(request.query.owner_type === undefined
            ? {}
            : { ownerType: request.query.owner_type }),
          ...(request.query.owner_id === undefined ? {} : { ownerId: request.query.owner_id }),
          ...(request.query.location_id === undefined
            ? {}
            : { locationId: request.query.location_id }),
          ...(request.query.product_variant_id === undefined
            ? {}
            : { variantId: request.query.product_variant_id }),
          ...(request.query.expires_before === undefined
            ? {}
            : { expiresBefore: new Date(request.query.expires_before) }),
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
    '/api/v1/inventory/reservations',
    {
      schema: {
        tags: ['inventory'],
        headers: mutationHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['branch_id', 'owner_type', 'owner_id', 'lines'],
          properties: {
            branch_id: { type: 'string', format: 'uuid' },
            owner_type: { type: 'string', enum: ['pos_cart', 'event', 'booking', 'order'] },
            owner_id: { type: 'string', minLength: 1, maxLength: 128 },
            expires_at: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
            lines: {
              type: 'array',
              minItems: 1,
              maxItems: 1000,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['location_id', 'product_variant_id', 'quantity', 'unit_of_measure_code'],
                properties: {
                  location_id: { type: 'string', format: 'uuid' },
                  product_variant_id: { type: 'string', format: 'uuid' },
                  quantity: { type: 'string', pattern: '^(?:0|[1-9]\\d*)(?:\\.\\d{1,6})?$' },
                  unit_of_measure_code: { type: 'string', minLength: 1, maxLength: 32 },
                },
              },
            },
          },
        },
        response: { 201: { type: 'object', additionalProperties: true }, ...errors },
      },
    },
    async (request, reply) =>
      toHttp(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'inventory.reservation.manage');
        const result = await service.create(
          context(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          key(request.headers['idempotency-key']),
          {
            branchId: request.body.branch_id,
            ownerType: request.body.owner_type,
            ownerId: request.body.owner_id,
            ...(request.body.expires_at === undefined
              ? {}
              : {
                  expiresAt:
                    request.body.expires_at === null ? null : new Date(request.body.expires_at),
                }),
            lines: request.body.lines.map((line) => ({
              locationId: line.location_id,
              productVariantId: line.product_variant_id,
              quantity: line.quantity,
              unitOfMeasureCode: line.unit_of_measure_code,
            })),
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
    '/api/v1/inventory/reservations/:reservation_id',
    {
      schema: {
        tags: ['inventory'],
        params: reservationParams,
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
          request.params.reservation_id,
        );
        return reply
          .header('etag', `"${value.version.toString()}"`)
          .send(successResponse(reservationJson(value), request.requestContext));
      }),
  );

  const transition = (
    route: string,
    bodySchema: Readonly<Record<string, unknown>>,
    execute: (
      contextValue: InventoryMutationContext,
      branches: readonly string[],
      id: string,
      expectedVersion: bigint,
      idempotencyKey: string,
      body: object,
    ) => Promise<{ value: Readonly<Record<string, unknown>>; replayed: boolean }>,
  ): void => {
    app.post<{ Params: Params; Body: object }>(
      route,
      {
        schema: {
          tags: ['inventory'],
          params: reservationParams,
          headers: transitionHeaders,
          body: bodySchema,
          response: { 200: { type: 'object', additionalProperties: true }, ...errors },
        },
      },
      async (request, reply) =>
        toHttp(async () => {
          const auth = await requireAuthenticatedUser(request, authentication);
          requirePermission(authentication, auth, 'inventory.reservation.manage');
          const result = await execute(
            context(request, auth.companyId, auth.userId),
            auth.permittedBranchIds,
            request.params.reservation_id,
            version(request.headers['if-match']),
            key(request.headers['idempotency-key']),
            request.body as object,
          );
          if (result.replayed) reply.header('idempotency-replayed', 'true');
          return reply
            .header('etag', `"${String(result.value.version)}"`)
            .send(successResponse(result.value, request.requestContext));
        }),
    );
  };

  transition(
    '/api/v1/inventory/reservations/:reservation_id/confirmations',
    { type: 'object', additionalProperties: false, maxProperties: 0 },
    (ctx, branches, id, expected, idempotencyKey) =>
      service.confirm(ctx, branches, id, expected, idempotencyKey),
  );
  transition(
    '/api/v1/inventory/reservations/:reservation_id/releases',
    {
      type: 'object',
      additionalProperties: false,
      required: ['action', 'reason_code'],
      properties: {
        action: { type: 'string', enum: ['release', 'expire', 'cancel'] },
        reason_code: { type: 'string', minLength: 1, maxLength: 64 },
        note: { anyOf: [{ type: 'string', maxLength: 2000 }, { type: 'null' }] },
      },
    },
    (ctx, branches, id, expected, idempotencyKey, body) => {
      const value = body as ReleaseBody;
      return service.release(ctx, branches, id, expected, idempotencyKey, {
        action: value.action,
        reasonCode: value.reason_code,
        ...(value.note === undefined ? {} : { note: value.note }),
      });
    },
  );
}
