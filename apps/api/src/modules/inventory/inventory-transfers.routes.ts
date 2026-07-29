import type { FastifyInstance, FastifyRequest } from 'fastify';

import { AppError } from '@asone/errors';

import { responseMeta, successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requirePermission } from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import type {
  TransferCancelInput,
  TransferCreateInput,
  TransferDecisionInput,
  TransferListInput,
  TransferNoteInput,
} from './inventory-transfers.service.js';
import { transferJson } from './inventory-transfers.service.js';
import type { InventoryTransferService } from './inventory-transfers.service.js';
import { InventoryTransferError } from './inventory-transfers.types.js';
import type { InventoryMutationContext } from './inventory.types.js';

interface Params {
  transfer_id: string;
}
interface ListQuery {
  cursor?: string;
  limit?: number;
  status?: TransferListInput['status'];
  branch_id?: string;
  product_variant_id?: string;
  requested_from?: string;
  requested_to?: string;
}
interface CreateBody {
  source_branch_id: string;
  destination_branch_id: string;
  source_location_id: string;
  destination_location_id: string;
  transit_location_id: string;
  notes?: string | null;
  lines: {
    product_variant_id: string;
    quantity: string;
    unit_of_measure_code: string;
    notes?: string | null;
  }[];
}
interface DecisionBody {
  decision: 'approve' | 'reject';
  reason_code?: string;
  note?: string | null;
}
interface NoteBody {
  note?: string | null;
}
interface CancelBody extends NoteBody {
  reason_code: string;
}

const nullableText = (maxLength: number) =>
  ({ anyOf: [{ type: 'string', maxLength }, { type: 'null' }] }) as const;
const params = {
  type: 'object',
  additionalProperties: false,
  required: ['transfer_id'],
  properties: { transfer_id: { type: 'string', format: 'uuid' } },
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
  422: { type: 'object', additionalProperties: true },
} as const;
const noteBody = {
  type: 'object',
  additionalProperties: false,
  properties: { note: nullableText(2000) },
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
    if (!(error instanceof InventoryTransferError)) throw error;
    const statusCode =
      error.code === 'resource_not_found'
        ? 404
        : ['validation_error', 'invalid_movement_line', 'numeric_overflow'].includes(error.code)
          ? 422
          : 409;
    throw new AppError({ code: error.code, message: error.message, statusCode });
  }
}
function createInput(body: CreateBody): TransferCreateInput {
  return {
    sourceBranchId: body.source_branch_id,
    destinationBranchId: body.destination_branch_id,
    sourceLocationId: body.source_location_id,
    destinationLocationId: body.destination_location_id,
    transitLocationId: body.transit_location_id,
    ...(body.notes === undefined ? {} : { notes: body.notes }),
    lines: body.lines.map((line) => ({
      productVariantId: line.product_variant_id,
      quantity: line.quantity,
      unitOfMeasureCode: line.unit_of_measure_code,
      ...(line.notes === undefined ? {} : { notes: line.notes }),
    })),
  };
}

export function registerInventoryTransferRoutes(
  app: FastifyInstance,
  authentication: AuthService,
  service: InventoryTransferService,
): void {
  app.get<{ Querystring: ListQuery }>(
    '/api/v1/inventory/transfers',
    {
      schema: {
        tags: ['inventory'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cursor: { type: 'string', minLength: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            status: {
              type: 'string',
              enum: ['requested', 'approved', 'shipped', 'received', 'rejected', 'cancelled'],
            },
            branch_id: { type: 'string', format: 'uuid' },
            product_variant_id: { type: 'string', format: 'uuid' },
            requested_from: { type: 'string', format: 'date-time' },
            requested_to: { type: 'string', format: 'date-time' },
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
          ...(request.query.status === undefined ? {} : { status: request.query.status }),
          ...(request.query.branch_id === undefined ? {} : { branchId: request.query.branch_id }),
          ...(request.query.product_variant_id === undefined
            ? {}
            : { variantId: request.query.product_variant_id }),
          ...(request.query.requested_from === undefined
            ? {}
            : { requestedFrom: new Date(request.query.requested_from) }),
          ...(request.query.requested_to === undefined
            ? {}
            : { requestedTo: new Date(request.query.requested_to) }),
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
    '/api/v1/inventory/transfers',
    {
      schema: {
        tags: ['inventory'],
        headers: mutationHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: [
            'source_branch_id',
            'destination_branch_id',
            'source_location_id',
            'destination_location_id',
            'transit_location_id',
            'lines',
          ],
          properties: {
            source_branch_id: { type: 'string', format: 'uuid' },
            destination_branch_id: { type: 'string', format: 'uuid' },
            source_location_id: { type: 'string', format: 'uuid' },
            destination_location_id: { type: 'string', format: 'uuid' },
            transit_location_id: { type: 'string', format: 'uuid' },
            notes: nullableText(2000),
            lines: {
              type: 'array',
              minItems: 1,
              maxItems: 1000,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['product_variant_id', 'quantity', 'unit_of_measure_code'],
                properties: {
                  product_variant_id: { type: 'string', format: 'uuid' },
                  quantity: { type: 'string', pattern: '^(?:0|[1-9]\\d*)(?:\\.\\d{1,6})?$' },
                  unit_of_measure_code: { type: 'string', minLength: 1, maxLength: 32 },
                  notes: nullableText(2000),
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
        requirePermission(authentication, auth, 'inventory.transfer');
        const result = await service.create(
          context(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          key(request.headers['idempotency-key']),
          createInput(request.body),
        );
        if (result.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .code(201)
          .header('etag', `"${String(result.value.version)}"`)
          .send(successResponse(result.value, request.requestContext));
      }),
  );

  app.get<{ Params: Params }>(
    '/api/v1/inventory/transfers/:transfer_id',
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
          request.params.transfer_id,
        );
        return reply
          .header('etag', `"${value.version.toString()}"`)
          .send(successResponse(transferJson(value), request.requestContext));
      }),
  );

  const transition = (
    route: string,
    permission: string,
    bodySchema: Readonly<Record<string, unknown>>,
    execute: (
      serviceValue: InventoryTransferService,
      contextValue: InventoryMutationContext,
      branches: readonly string[],
      id: string,
      expected: bigint,
      idempotencyKey: string,
      body: unknown,
    ) => Promise<{ value: Readonly<Record<string, unknown>>; replayed: boolean }>,
  ): void => {
    app.post<{ Params: Params; Body: object }>(
      route,
      {
        schema: {
          tags: ['inventory'],
          params,
          headers: transitionHeaders,
          body: bodySchema,
          response: { 200: { type: 'object', additionalProperties: true }, ...errors },
        },
      },
      async (request, reply) =>
        toHttp(async () => {
          const auth = await requireAuthenticatedUser(request, authentication);
          requirePermission(authentication, auth, permission);
          const result = await execute(
            service,
            context(request, auth.companyId, auth.userId),
            auth.permittedBranchIds,
            request.params.transfer_id,
            version(request.headers['if-match']),
            key(request.headers['idempotency-key']),
            request.body,
          );
          if (result.replayed) reply.header('idempotency-replayed', 'true');
          return reply
            .header('etag', `"${String(result.value.version)}"`)
            .send(successResponse(result.value, request.requestContext));
        }),
    );
  };

  transition(
    '/api/v1/inventory/transfers/:transfer_id/approvals',
    'inventory.approve',
    {
      type: 'object',
      additionalProperties: false,
      required: ['decision'],
      properties: {
        decision: { type: 'string', enum: ['approve', 'reject'] },
        reason_code: { type: 'string', minLength: 1, maxLength: 64 },
        note: nullableText(2000),
      },
    },
    (value, ctx, branches, id, expected, idempotencyKey, requestBody) => {
      const body = requestBody as DecisionBody;
      return value.decision(ctx, branches, id, expected, idempotencyKey, {
        decision: body.decision,
        ...(body.reason_code === undefined ? {} : { reasonCode: body.reason_code }),
        ...(body.note === undefined ? {} : { note: body.note }),
      } satisfies TransferDecisionInput);
    },
  );
  transition(
    '/api/v1/inventory/transfers/:transfer_id/shipments',
    'inventory.transfer',
    noteBody,
    (value, ctx, branches, id, expected, idempotencyKey, body) =>
      value.ship(ctx, branches, id, expected, idempotencyKey, body as TransferNoteInput),
  );
  transition(
    '/api/v1/inventory/transfers/:transfer_id/receipts',
    'inventory.receive',
    noteBody,
    (value, ctx, branches, id, expected, idempotencyKey, body) =>
      value.receive(ctx, branches, id, expected, idempotencyKey, body as TransferNoteInput),
  );
  transition(
    '/api/v1/inventory/transfers/:transfer_id/cancellations',
    'inventory.transfer',
    {
      type: 'object',
      additionalProperties: false,
      required: ['reason_code'],
      properties: {
        reason_code: { type: 'string', minLength: 1, maxLength: 64 },
        note: nullableText(2000),
      },
    },
    (value, ctx, branches, id, expected, idempotencyKey, requestBody) => {
      const body = requestBody as CancelBody;
      return value.cancel(ctx, branches, id, expected, idempotencyKey, {
        reasonCode: body.reason_code,
        ...(body.note === undefined ? {} : { note: body.note }),
      } satisfies TransferCancelInput);
    },
  );
}
