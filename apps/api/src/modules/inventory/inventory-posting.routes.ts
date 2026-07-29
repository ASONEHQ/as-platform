import type { FastifyInstance, FastifyRequest } from 'fastify';

import { AppError } from '@asone/errors';

import { successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requirePermission } from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import { InventoryDraftError } from './inventory-drafts.types.js';
import type { InventoryPostingService } from './inventory-posting.service.js';
import type { InventoryMutationContext } from './inventory.types.js';

interface Params {
  movement_id: string;
}
const params = {
  type: 'object',
  additionalProperties: false,
  required: ['movement_id'],
  properties: { movement_id: { type: 'string', format: 'uuid' } },
} as const;
const headers = {
  type: 'object',
  required: ['if-match', 'idempotency-key'],
  properties: {
    'if-match': { type: 'string' },
    'idempotency-key': { type: 'string', minLength: 1, maxLength: 255 },
  },
} as const;
const resultProperties = {
  movement_id: { type: 'string', format: 'uuid' },
  movement_number: { type: 'string', pattern: '^IMV-[0-9a-f]{32}$' },
  version: { type: 'integer', minimum: 1 },
} as const;
const errors = {
  400: { type: 'object', additionalProperties: true },
  401: { type: 'object', additionalProperties: true },
  403: { type: 'object', additionalProperties: true },
  404: { type: 'object', additionalProperties: true },
  409: { type: 'object', additionalProperties: true },
  422: { type: 'object', additionalProperties: true },
} as const;

function expectedVersion(value: string | undefined): bigint {
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
async function errorsToHttp<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    if (!(error instanceof InventoryDraftError)) throw error;
    const statusCode = error.code === 'inventory_movement_not_found' ? 404 : 409;
    const unprocessable = [
      'invalid_inventory_location',
      'invalid_movement_direction',
      'invalid_movement_line',
      'invalid_movement_type',
      'numeric_overflow',
    ].includes(error.code);
    throw new AppError({
      code: error.code,
      message: error.message,
      statusCode: unprocessable ? 422 : statusCode,
    });
  }
}

export function registerInventoryPostingRoutes(
  app: FastifyInstance,
  authentication: AuthService,
  service: InventoryPostingService,
): void {
  app.post<{ Params: Params; Body: unknown }>(
    '/api/v1/inventory/movements/:movement_id/submit',
    {
      schema: {
        tags: ['inventory'],
        params,
        headers,
        response: {
          200: {
            type: 'object',
            additionalProperties: true,
            properties: {
              data: {
                type: 'object',
                additionalProperties: false,
                required: ['movement_id', 'movement_number', 'status', 'version'],
                properties: {
                  ...resultProperties,
                  status: { const: 'pending' },
                },
              },
            },
          },
          ...errors,
        },
      },
    },
    async (request, reply) =>
      errorsToHttp(async () => {
        if (request.body !== undefined)
          throw new AppError({
            code: 'validation_error',
            message: 'This command does not accept a request body.',
            statusCode: 400,
          });
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'inventory.adjust');
        const result = await service.submit(
          context(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          request.params.movement_id,
          expectedVersion(request.headers['if-match']),
          key(request.headers['idempotency-key']),
        );
        if (result.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .header('etag', `"${String(result.value.version)}"`)
          .send(successResponse(result.value, request.requestContext));
      }),
  );

  app.post<{ Params: Params; Body: unknown }>(
    '/api/v1/inventory/movements/:movement_id/post',
    {
      schema: {
        tags: ['inventory'],
        params,
        headers,
        response: {
          200: {
            type: 'object',
            additionalProperties: true,
            properties: {
              data: {
                type: 'object',
                additionalProperties: false,
                required: [
                  'movement_id',
                  'movement_number',
                  'status',
                  'version',
                  'posted_at',
                  'affected_balance_count',
                ],
                properties: {
                  ...resultProperties,
                  status: { const: 'posted' },
                  posted_at: { type: 'string', format: 'date-time' },
                  affected_balance_count: { type: 'integer', minimum: 0 },
                },
              },
            },
          },
          ...errors,
        },
      },
    },
    async (request, reply) =>
      errorsToHttp(async () => {
        if (request.body !== undefined)
          throw new AppError({
            code: 'validation_error',
            message: 'This command does not accept a request body.',
            statusCode: 400,
          });
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'inventory.approve');
        const result = await service.post(
          context(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          request.params.movement_id,
          expectedVersion(request.headers['if-match']),
          key(request.headers['idempotency-key']),
        );
        if (result.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .header('etag', `"${String(result.value.version)}"`)
          .send(successResponse(result.value, request.requestContext));
      }),
  );
}
