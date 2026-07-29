import type { FastifyInstance, FastifyRequest } from 'fastify';

import { AppError } from '@asone/errors';

import { responseMeta, successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requirePermission } from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import type {
  DraftHeaderInput,
  DraftHeaderPatch,
  DraftLineInput,
  DraftLinePatch,
  InventoryDraftService,
} from './inventory-drafts.service.js';
import { movementJson } from './inventory-drafts.service.js';
import { InventoryDraftError } from './inventory-drafts.types.js';
import type { InventoryMutationContext } from './inventory.types.js';

interface MovementParams {
  movement_id: string;
}
interface LineParams extends MovementParams {
  line_id: string;
}
interface HeaderBody {
  branch_id: string;
  movement_type: 'opening_balance' | 'adjustment';
  occurred_at?: string;
  reason_code?: string | null;
  reference_type?: string | null;
  reference_id?: string | null;
  source_document_number?: string | null;
  notes?: string | null;
}
type HeaderPatchBody = Partial<HeaderBody>;
interface CancelBody {
  reason_code: string;
  note?: string | null;
}
interface LineBody {
  product_variant_id: string;
  source_inventory_location_id?: string | null;
  destination_inventory_location_id?: string | null;
  quantity: string;
  unit_of_measure_code: string;
  reason_code?: string | null;
  metadata?: Readonly<Record<string, unknown>> | null;
}
type LinePatchBody = Partial<LineBody>;
interface LinesQuery {
  cursor?: string;
  limit?: number;
}

const nullableText = (maxLength: number) =>
  ({ anyOf: [{ type: 'string', maxLength }, { type: 'null' }] }) as const;
const paramsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['movement_id'],
  properties: { movement_id: { type: 'string', format: 'uuid' } },
} as const;
const lineParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['movement_id', 'line_id'],
  properties: {
    movement_id: { type: 'string', format: 'uuid' },
    line_id: { type: 'string', format: 'uuid' },
  },
} as const;
const headerProperties = {
  branch_id: { type: 'string', format: 'uuid' },
  movement_type: { type: 'string', enum: ['opening_balance', 'adjustment'] },
  occurred_at: { type: 'string', format: 'date-time' },
  reason_code: nullableText(64),
  reference_type: nullableText(64),
  reference_id: { anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] },
  source_document_number: nullableText(128),
  notes: nullableText(2000),
} as const;
const lineProperties = {
  product_variant_id: { type: 'string', format: 'uuid' },
  source_inventory_location_id: {
    anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }],
  },
  destination_inventory_location_id: {
    anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }],
  },
  quantity: { type: 'string', pattern: '^(?:0|[1-9]\\d*)(?:\\.\\d{1,6})?$' },
  unit_of_measure_code: { type: 'string', minLength: 1, maxLength: 32 },
  reason_code: nullableText(64),
  metadata: {
    anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
  },
} as const;
const errorSchema = { type: 'object', additionalProperties: true } as const;
const errors = {
  400: errorSchema,
  401: errorSchema,
  403: errorSchema,
  404: errorSchema,
  409: errorSchema,
  422: errorSchema,
} as const;

function mutationContext(
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
function etag(value: string | undefined): bigint {
  const match = /^"([1-9]\d*)"$/u.exec(value ?? '');
  if (match?.[1] === undefined)
    throw new AppError({
      code: 'validation_error',
      message: 'If-Match must contain a strong positive version ETag.',
      statusCode: 400,
    });
  return BigInt(match[1]);
}
function idempotencyKey(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new AppError({
      code: 'validation_error',
      message: 'Idempotency-Key is required.',
      statusCode: 400,
    });
  return value;
}
async function draftErrors<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    if (!(error instanceof InventoryDraftError)) throw error;
    const notFound = [
      'branch_not_found',
      'inventory_movement_line_not_found',
      'inventory_movement_not_found',
      'product_variant_not_found',
      'unit_of_measure_not_found',
    ].includes(error.code);
    const unprocessable = [
      'invalid_inventory_location',
      'invalid_movement_direction',
      'invalid_movement_type',
    ].includes(error.code);
    throw new AppError({
      code: error.code,
      message: error.message,
      statusCode: notFound ? 404 : unprocessable ? 422 : 409,
    });
  }
}
function header(body: HeaderBody | HeaderPatchBody): DraftHeaderInput | DraftHeaderPatch {
  return {
    ...(body.branch_id === undefined ? {} : { branchId: body.branch_id }),
    ...(body.movement_type === undefined ? {} : { movementType: body.movement_type }),
    ...(body.occurred_at === undefined ? {} : { occurredAt: new Date(body.occurred_at) }),
    ...(body.reason_code === undefined ? {} : { reasonCode: body.reason_code }),
    ...(body.reference_type === undefined ? {} : { referenceType: body.reference_type }),
    ...(body.reference_id === undefined ? {} : { referenceId: body.reference_id }),
    ...(body.source_document_number === undefined
      ? {}
      : { sourceDocumentNumber: body.source_document_number }),
    ...(body.notes === undefined ? {} : { notes: body.notes }),
  };
}
function line(body: LineBody | LinePatchBody): DraftLineInput | DraftLinePatch {
  return {
    ...(body.product_variant_id === undefined ? {} : { productVariantId: body.product_variant_id }),
    ...(body.source_inventory_location_id === undefined
      ? {}
      : { sourceLocationId: body.source_inventory_location_id }),
    ...(body.destination_inventory_location_id === undefined
      ? {}
      : { destinationLocationId: body.destination_inventory_location_id }),
    ...(body.quantity === undefined ? {} : { quantity: body.quantity }),
    ...(body.unit_of_measure_code === undefined
      ? {}
      : { unitOfMeasureCode: body.unit_of_measure_code }),
    ...(body.reason_code === undefined ? {} : { reasonCode: body.reason_code }),
    ...(body.metadata === undefined ? {} : { metadata: body.metadata }),
  };
}

export function registerInventoryDraftRoutes(
  app: FastifyInstance,
  authentication: AuthService,
  drafts: InventoryDraftService,
): void {
  app.post<{ Body: HeaderBody }>(
    '/api/v1/inventory/movements',
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
          required: ['branch_id', 'movement_type'],
          properties: headerProperties,
        },
        response: { 201: { type: 'object', additionalProperties: true }, ...errors },
      },
    },
    async (request, reply) =>
      draftErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'inventory.adjust');
        const result = await drafts.create(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          header(request.body) as DraftHeaderInput,
        );
        if (result.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .code(201)
          .header('etag', `"${String(result.value.version)}"`)
          .send(successResponse(result.value, request.requestContext));
      }),
  );

  app.get<{ Params: MovementParams }>(
    '/api/v1/inventory/movements/:movement_id',
    {
      schema: {
        tags: ['inventory'],
        params: paramsSchema,
        response: { 200: errorSchema, ...errors },
      },
    },
    async (request, reply) =>
      draftErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'inventory.read');
        const value = await drafts.get(
          auth.companyId,
          auth.permittedBranchIds,
          request.params.movement_id,
        );
        return reply
          .header('etag', `"${value.version.toString()}"`)
          .send(successResponse(movementJson(value), request.requestContext));
      }),
  );

  app.patch<{ Params: MovementParams; Body: HeaderPatchBody }>(
    '/api/v1/inventory/movements/:movement_id',
    {
      schema: {
        tags: ['inventory'],
        params: paramsSchema,
        headers: {
          type: 'object',
          required: ['if-match'],
          properties: { 'if-match': { type: 'string' } },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: headerProperties,
        },
        response: { 200: errorSchema, ...errors },
      },
    },
    async (request, reply) =>
      draftErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'inventory.adjust');
        const value = await drafts.patch(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          request.params.movement_id,
          etag(request.headers['if-match']),
          header(request.body),
        );
        return reply
          .header('etag', `"${value.version.toString()}"`)
          .send(successResponse(movementJson(value), request.requestContext));
      }),
  );

  app.post<{ Params: MovementParams; Body: CancelBody }>(
    '/api/v1/inventory/movements/:movement_id/cancel',
    {
      schema: {
        tags: ['inventory'],
        params: paramsSchema,
        headers: {
          type: 'object',
          required: ['if-match', 'idempotency-key'],
          properties: {
            'if-match': { type: 'string' },
            'idempotency-key': { type: 'string', minLength: 1 },
          },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['reason_code'],
          properties: {
            reason_code: { type: 'string', minLength: 1, maxLength: 64 },
            note: nullableText(1000),
          },
        },
        response: { 200: errorSchema, ...errors },
      },
    },
    async (request, reply) =>
      draftErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'inventory.adjust');
        const result = await drafts.cancel(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          request.params.movement_id,
          etag(request.headers['if-match']),
          idempotencyKey(request.headers['idempotency-key']),
          request.body.reason_code,
          request.body.note,
        );
        if (result.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .header('etag', `"${String(result.value.version)}"`)
          .send(successResponse(result.value, request.requestContext));
      }),
  );

  app.get<{ Params: MovementParams; Querystring: LinesQuery }>(
    '/api/v1/inventory/movements/:movement_id/lines',
    {
      schema: {
        tags: ['inventory'],
        params: paramsSchema,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cursor: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
          },
        },
        response: { 200: errorSchema, ...errors },
      },
    },
    async (request, reply) =>
      draftErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'inventory.read');
        const page = await drafts.listLines(
          auth.companyId,
          auth.permittedBranchIds,
          request.params.movement_id,
          auth.permissions.includes('inventory.cost.read'),
          {
            limit: request.query.limit ?? 50,
            ...(request.query.cursor === undefined ? {} : { cursor: request.query.cursor }),
          },
        );
        return reply.send({
          data: page.items,
          meta: {
            ...responseMeta(request.requestContext),
            page: { next_cursor: page.nextCursor, has_more: page.nextCursor !== null },
          },
        });
      }),
  );

  app.post<{ Params: MovementParams; Body: LineBody }>(
    '/api/v1/inventory/movements/:movement_id/lines',
    {
      schema: {
        tags: ['inventory'],
        params: paramsSchema,
        headers: {
          type: 'object',
          required: ['if-match', 'idempotency-key'],
          properties: {
            'if-match': { type: 'string' },
            'idempotency-key': { type: 'string', minLength: 1 },
          },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['product_variant_id', 'quantity', 'unit_of_measure_code'],
          properties: lineProperties,
        },
        response: { 201: errorSchema, ...errors },
      },
    },
    async (request, reply) =>
      draftErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'inventory.adjust');
        const result = await drafts.addLine(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          request.params.movement_id,
          etag(request.headers['if-match']),
          idempotencyKey(request.headers['idempotency-key']),
          line(request.body) as DraftLineInput,
          auth.permissions.includes('inventory.cost.read'),
        );
        if (result.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .code(201)
          .header('etag', `"${String(result.value.version)}"`)
          .send(successResponse(result.value, request.requestContext));
      }),
  );

  app.patch<{ Params: LineParams; Body: LinePatchBody }>(
    '/api/v1/inventory/movements/:movement_id/lines/:line_id',
    {
      schema: {
        tags: ['inventory'],
        params: lineParamsSchema,
        headers: {
          type: 'object',
          required: ['if-match'],
          properties: { 'if-match': { type: 'string' } },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: lineProperties,
        },
        response: { 200: errorSchema, ...errors },
      },
    },
    async (request, reply) =>
      draftErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'inventory.adjust');
        const result = await drafts.patchLine(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          request.params.movement_id,
          request.params.line_id,
          etag(request.headers['if-match']),
          line(request.body),
          auth.permissions.includes('inventory.cost.read'),
        );
        return reply
          .header('etag', `"${result.version.toString()}"`)
          .send(
            successResponse(
              { line: result.line, version: Number(result.version) },
              request.requestContext,
            ),
          );
      }),
  );

  app.delete<{ Params: LineParams }>(
    '/api/v1/inventory/movements/:movement_id/lines/:line_id',
    {
      schema: {
        tags: ['inventory'],
        params: lineParamsSchema,
        headers: {
          type: 'object',
          required: ['if-match'],
          properties: { 'if-match': { type: 'string' } },
        },
        response: { 200: errorSchema, ...errors },
      },
    },
    async (request, reply) =>
      draftErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'inventory.adjust');
        const result = await drafts.deleteLine(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          request.params.movement_id,
          request.params.line_id,
          etag(request.headers['if-match']),
        );
        return reply.header('etag', `"${result.version.toString()}"`).send(
          successResponse(
            {
              movement_id: result.movementId,
              deleted_line_id: result.deletedLineId,
              version: Number(result.version),
            },
            request.requestContext,
          ),
        );
      }),
  );
}
