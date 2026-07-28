import type { FastifyInstance, FastifyRequest } from 'fastify';

import { AppError } from '@asone/errors';

import { responseMeta, successResponse } from '../../http/response.js';
import {
  requireAuthenticatedUser,
  requireBranchAccess,
  requirePermission,
} from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import type {
  InventoryBalanceReadService,
  InventoryLocationService,
  InventoryMovementReadService,
  LocationCreate,
  LocationPatch,
} from './inventory.service.js';
import type {
  InventoryLocation,
  InventoryMutationContext,
  LocationStatus,
  LocationType,
} from './inventory.types.js';
import { InventoryApplicationError } from './inventory.types.js';

const locationTypes = [
  'main',
  'sales_floor',
  'cafeteria',
  'event_storage',
  'damaged',
  'returns',
  'transit',
  'virtual',
] as const;
const locationStatuses = ['active', 'inactive', 'retired'] as const;
const movementTypes = [
  'opening_balance',
  'receipt',
  'issue',
  'return',
  'adjustment',
  'transfer_shipment',
  'transfer_receipt',
  'reversal',
] as const;
const movementStatuses = ['draft', 'pending', 'posted', 'cancelled', 'reversed'] as const;
const errorSchema = { type: 'object', additionalProperties: true } as const;
const errors = {
  400: errorSchema,
  401: errorSchema,
  403: errorSchema,
  404: errorSchema,
  409: errorSchema,
} as const;
const pageResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['data', 'meta'],
  properties: {
    data: { type: 'array', items: { type: 'object', additionalProperties: true } },
    meta: { type: 'object', additionalProperties: true },
  },
} as const;
const locationBodyProperties = {
  name: { type: 'string', minLength: 1, maxLength: 160 },
  description: { anyOf: [{ type: 'string', maxLength: 1000 }, { type: 'null' }] },
  status: { type: 'string', enum: locationStatuses },
  allows_receiving: { type: 'boolean' },
  allows_issuing: { type: 'boolean' },
  is_default: { type: 'boolean' },
} as const;

interface LocationListQuery {
  cursor?: string;
  limit?: number;
  branch_id?: string;
  type?: LocationType;
  status?: LocationStatus;
}
interface LocationCreateBody {
  id?: string;
  branch_id: string;
  code: string;
  name: string;
  description?: string | null;
  location_type: LocationType;
  status?: LocationStatus;
  allows_receiving?: boolean;
  allows_issuing?: boolean;
  is_default?: boolean;
}
interface LocationPatchBody {
  name?: string;
  description?: string | null;
  status?: LocationStatus;
  allows_receiving?: boolean;
  allows_issuing?: boolean;
  is_default?: boolean;
}
interface LocationParams {
  location_id: string;
}
interface BalanceQuery {
  cursor?: string;
  limit?: number;
  branch_id?: string;
  location_id?: string;
  product_variant_id?: string;
  changed_after?: string;
}
interface MovementQuery {
  cursor?: string;
  limit?: number;
  branch_id?: string;
  status?: string;
  type?: string;
  location_id?: string;
  product_variant_id?: string;
  reference_type?: string;
  reference_id?: string;
  occurred_from?: string;
  occurred_to?: string;
}

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
function locationHttp(value: InventoryLocation): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    branch_id: value.branchId,
    code: value.code,
    name: value.name,
    description: value.description,
    location_type: value.locationType,
    status: value.status,
    allows_receiving: value.allowsReceiving,
    allows_issuing: value.allowsIssuing,
    is_default: value.isDefault,
    version: Number(value.version),
    created_at: value.createdAt.toISOString(),
    updated_at: value.updatedAt.toISOString(),
    deleted_at: value.deletedAt?.toISOString() ?? null,
  };
}
function ifMatch(value: string | undefined): bigint {
  const match = /^"([1-9]\d*)"$/u.exec(value ?? '');
  if (match?.[1] === undefined)
    throw new AppError({
      code: 'validation_error',
      message: 'If-Match must contain a strong positive version ETag.',
      statusCode: 400,
    });
  return BigInt(match[1]);
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
async function inventoryErrors<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    if (!(error instanceof InventoryApplicationError)) throw error;
    const status =
      error.code === 'inventory_location_not_found' || error.code === 'branch_not_found'
        ? 404
        : 409;
    throw new AppError({
      code: error.code,
      message: error.message,
      statusCode: status,
      ...(error.details === undefined ? {} : { details: error.details }),
    });
  }
}

export function registerInventoryRoutes(
  app: FastifyInstance,
  authentication: AuthService,
  locations: InventoryLocationService,
  balances: InventoryBalanceReadService,
  movements: InventoryMovementReadService,
): void {
  app.get<{ Querystring: LocationListQuery }>(
    '/api/v1/inventory/locations',
    {
      schema: {
        tags: ['inventory'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cursor: { type: 'string', format: 'uuid' },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            branch_id: { type: 'string', format: 'uuid' },
            type: { type: 'string', enum: locationTypes },
            status: { type: 'string', enum: locationStatuses },
          },
        },
        response: { 200: pageResponse, ...errors },
      },
    },
    async (request, reply) =>
      inventoryErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'inventory.read');
        if (request.query.branch_id !== undefined)
          requireBranchAccess(authentication, auth, request.query.branch_id);
        const page = await locations.list(auth.companyId, auth.permittedBranchIds, {
          limit: request.query.limit ?? 50,
          ...(request.query.cursor === undefined ? {} : { cursor: request.query.cursor }),
          ...(request.query.branch_id === undefined ? {} : { branchId: request.query.branch_id }),
          ...(request.query.type === undefined ? {} : { locationType: request.query.type }),
          ...(request.query.status === undefined ? {} : { status: request.query.status }),
        });
        return reply.send({
          data: page.items.map(locationHttp),
          meta: {
            ...responseMeta(request.requestContext),
            page: { next_cursor: page.nextCursor, has_more: page.nextCursor !== null },
          },
        });
      }),
  );

  app.post<{ Body: LocationCreateBody }>(
    '/api/v1/inventory/locations',
    {
      schema: {
        tags: ['inventory'],
        headers: {
          type: 'object',
          required: ['idempotency-key'],
          properties: { 'idempotency-key': { type: 'string', minLength: 1, maxLength: 255 } },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['branch_id', 'code', 'name', 'location_type'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            branch_id: { type: 'string', format: 'uuid' },
            code: { type: 'string', minLength: 1, maxLength: 64 },
            name: locationBodyProperties.name,
            description: locationBodyProperties.description,
            location_type: { type: 'string', enum: locationTypes },
            status: locationBodyProperties.status,
            allows_receiving: locationBodyProperties.allows_receiving,
            allows_issuing: locationBodyProperties.allows_issuing,
            is_default: locationBodyProperties.is_default,
          },
        },
        response: { 201: { type: 'object', additionalProperties: true }, ...errors },
      },
    },
    async (request, reply) =>
      inventoryErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'inventory_location.manage');
        requireBranchAccess(authentication, auth, request.body.branch_id);
        const input: LocationCreate = {
          branchId: request.body.branch_id,
          code: request.body.code,
          name: request.body.name,
          locationType: request.body.location_type,
          ...(request.body.id === undefined ? {} : { id: request.body.id }),
          ...(request.body.description === undefined
            ? {}
            : { description: request.body.description }),
          ...(request.body.status === undefined ? {} : { status: request.body.status }),
          ...(request.body.allows_receiving === undefined
            ? {}
            : { allowsReceiving: request.body.allows_receiving }),
          ...(request.body.allows_issuing === undefined
            ? {}
            : { allowsIssuing: request.body.allows_issuing }),
          ...(request.body.is_default === undefined ? {} : { isDefault: request.body.is_default }),
        };
        const result = await locations.create(
          context(request, auth.companyId, auth.userId),
          key(request.headers['idempotency-key']),
          input,
        );
        if (result.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .code(201)
          .header('etag', `"${result.value.version.toString()}"`)
          .send(successResponse(locationHttp(result.value), request.requestContext));
      }),
  );

  app.patch<{ Params: LocationParams; Body: LocationPatchBody }>(
    '/api/v1/inventory/locations/:location_id',
    {
      schema: {
        tags: ['inventory'],
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['location_id'],
          properties: { location_id: { type: 'string', format: 'uuid' } },
        },
        headers: {
          type: 'object',
          required: ['if-match'],
          properties: { 'if-match': { type: 'string' } },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: locationBodyProperties,
        },
        response: { 200: { type: 'object', additionalProperties: true }, ...errors },
      },
    },
    async (request, reply) =>
      inventoryErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'inventory_location.manage');
        const patch: LocationPatch = {
          ...(request.body.name === undefined ? {} : { name: request.body.name }),
          ...(request.body.description === undefined
            ? {}
            : { description: request.body.description }),
          ...(request.body.status === undefined ? {} : { status: request.body.status }),
          ...(request.body.allows_receiving === undefined
            ? {}
            : { allowsReceiving: request.body.allows_receiving }),
          ...(request.body.allows_issuing === undefined
            ? {}
            : { allowsIssuing: request.body.allows_issuing }),
          ...(request.body.is_default === undefined ? {} : { isDefault: request.body.is_default }),
        };
        const value = await locations.patch(
          context(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          request.params.location_id,
          ifMatch(request.headers['if-match']),
          patch,
        );
        return reply
          .header('etag', `"${value.version.toString()}"`)
          .send(successResponse(locationHttp(value), request.requestContext));
      }),
  );

  app.get<{ Querystring: BalanceQuery }>(
    '/api/v1/inventory/balances',
    {
      schema: {
        tags: ['inventory'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cursor: { type: 'string', format: 'uuid' },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            branch_id: { type: 'string', format: 'uuid' },
            location_id: { type: 'string', format: 'uuid' },
            product_variant_id: { type: 'string', format: 'uuid' },
            changed_after: { type: 'string', format: 'date-time' },
          },
        },
        response: { 200: pageResponse, ...errors },
      },
    },
    async (request, reply) => {
      const auth = await requireAuthenticatedUser(request, authentication);
      requirePermission(authentication, auth, 'inventory.read');
      if (request.query.branch_id !== undefined)
        requireBranchAccess(authentication, auth, request.query.branch_id);
      const page = await balances.list(
        auth.companyId,
        auth.permittedBranchIds,
        auth.permissions.includes('inventory.cost.read'),
        {
          limit: request.query.limit ?? 50,
          ...(request.query.cursor === undefined ? {} : { cursor: request.query.cursor }),
          ...(request.query.branch_id === undefined ? {} : { branchId: request.query.branch_id }),
          ...(request.query.location_id === undefined
            ? {}
            : { locationId: request.query.location_id }),
          ...(request.query.product_variant_id === undefined
            ? {}
            : { productVariantId: request.query.product_variant_id }),
          ...(request.query.changed_after === undefined
            ? {}
            : { changedAfter: new Date(request.query.changed_after) }),
        },
      );
      return reply.send({
        data: page.items,
        meta: {
          ...responseMeta(request.requestContext),
          page: { next_cursor: page.nextCursor, has_more: page.nextCursor !== null },
        },
      });
    },
  );

  app.get<{ Querystring: MovementQuery }>(
    '/api/v1/inventory/movements',
    {
      schema: {
        tags: ['inventory'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cursor: { type: 'string', format: 'uuid' },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            branch_id: { type: 'string', format: 'uuid' },
            status: { type: 'string', enum: movementStatuses },
            type: { type: 'string', enum: movementTypes },
            location_id: { type: 'string', format: 'uuid' },
            product_variant_id: { type: 'string', format: 'uuid' },
            reference_type: { type: 'string', minLength: 1, maxLength: 64 },
            reference_id: { type: 'string', format: 'uuid' },
            occurred_from: { type: 'string', format: 'date-time' },
            occurred_to: { type: 'string', format: 'date-time' },
          },
        },
        response: { 200: pageResponse, ...errors },
      },
    },
    async (request, reply) => {
      const auth = await requireAuthenticatedUser(request, authentication);
      requirePermission(authentication, auth, 'inventory.read');
      if (request.query.branch_id !== undefined)
        requireBranchAccess(authentication, auth, request.query.branch_id);
      const page = await movements.list(auth.companyId, auth.permittedBranchIds, {
        limit: request.query.limit ?? 50,
        ...(request.query.cursor === undefined ? {} : { cursor: request.query.cursor }),
        ...(request.query.branch_id === undefined ? {} : { branchId: request.query.branch_id }),
        ...(request.query.status === undefined ? {} : { status: request.query.status }),
        ...(request.query.type === undefined ? {} : { movementType: request.query.type }),
        ...(request.query.location_id === undefined
          ? {}
          : { locationId: request.query.location_id }),
        ...(request.query.product_variant_id === undefined
          ? {}
          : { productVariantId: request.query.product_variant_id }),
        ...(request.query.reference_type === undefined
          ? {}
          : { referenceType: request.query.reference_type }),
        ...(request.query.reference_id === undefined
          ? {}
          : { referenceId: request.query.reference_id }),
        ...(request.query.occurred_from === undefined
          ? {}
          : { occurredFrom: new Date(request.query.occurred_from) }),
        ...(request.query.occurred_to === undefined
          ? {}
          : { occurredTo: new Date(request.query.occurred_to) }),
      });
      return reply.send({
        data: page.items,
        meta: {
          ...responseMeta(request.requestContext),
          page: { next_cursor: page.nextCursor, has_more: page.nextCursor !== null },
        },
      });
    },
  );
}
