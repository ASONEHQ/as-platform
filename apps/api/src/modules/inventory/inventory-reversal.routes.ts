import type { FastifyInstance, FastifyRequest } from 'fastify';

import { AppError } from '@asone/errors';

import { successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requirePermission } from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import { InventoryDraftError } from './inventory-drafts.types.js';
import type { InventoryReversalService } from './inventory-reversal.service.js';
import type { InventoryMutationContext } from './inventory.types.js';

interface Params {
  movement_id: string;
}
interface Body {
  reason_code: string;
  note?: string | null;
}

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

function idempotencyKey(value: string | string[] | undefined): string {
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
    const unprocessable = ['invalid_movement_line', 'numeric_overflow'].includes(error.code);
    throw new AppError({
      code: error.code,
      message: error.message,
      statusCode: unprocessable ? 422 : statusCode,
    });
  }
}

export function registerInventoryReversalRoutes(
  app: FastifyInstance,
  authentication: AuthService,
  service: InventoryReversalService,
): void {
  app.post<{ Params: Params; Body: Body }>(
    '/api/v1/inventory/movements/:movement_id/reversals',
    {
      schema: {
        tags: ['inventory'],
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['movement_id'],
          properties: { movement_id: { type: 'string', format: 'uuid' } },
        },
        headers: {
          type: 'object',
          required: ['if-match', 'idempotency-key'],
          properties: {
            'if-match': { type: 'string' },
            'idempotency-key': { type: 'string', minLength: 1, maxLength: 255 },
          },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['reason_code'],
          properties: {
            reason_code: { type: 'string', minLength: 1, maxLength: 64, pattern: '.*\\S.*' },
            note: { anyOf: [{ type: 'string', maxLength: 1000 }, { type: 'null' }] },
          },
        },
        response: {
          201: {
            type: 'object',
            additionalProperties: true,
            properties: {
              data: {
                type: 'object',
                additionalProperties: false,
                required: [
                  'original_movement_id',
                  'original_status',
                  'original_version',
                  'reversal_movement_id',
                  'reversal_movement_number',
                  'reversal_status',
                  'reversal_version',
                  'reversed_at',
                  'affected_balance_count',
                ],
                properties: {
                  original_movement_id: { type: 'string', format: 'uuid' },
                  original_status: { const: 'reversed' },
                  original_version: { type: 'integer', minimum: 2 },
                  reversal_movement_id: { type: 'string', format: 'uuid' },
                  reversal_movement_number: {
                    type: 'string',
                    pattern: '^IMV-[0-9a-f]{32}$',
                  },
                  reversal_status: { const: 'posted' },
                  reversal_version: { const: 1 },
                  reversed_at: { type: 'string', format: 'date-time' },
                  affected_balance_count: { type: 'integer', minimum: 1 },
                },
              },
            },
          },
          400: { type: 'object', additionalProperties: true },
          401: { type: 'object', additionalProperties: true },
          403: { type: 'object', additionalProperties: true },
          404: { type: 'object', additionalProperties: true },
          409: { type: 'object', additionalProperties: true },
          422: { type: 'object', additionalProperties: true },
        },
      },
    },
    async (request, reply) =>
      errorsToHttp(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'inventory.reverse');
        const trimmedNote = request.body.note?.trim();
        const result = await service.reverse(
          context(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          request.params.movement_id,
          expectedVersion(request.headers['if-match']),
          idempotencyKey(request.headers['idempotency-key']),
          {
            reasonCode: request.body.reason_code.trim(),
            note: trimmedNote === undefined || trimmedNote === '' ? null : trimmedNote,
          },
        );
        if (result.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .code(201)
          .header('etag', `"${String(result.value.original_version)}"`)
          .send(successResponse(result.value, request.requestContext));
      }),
  );
}
