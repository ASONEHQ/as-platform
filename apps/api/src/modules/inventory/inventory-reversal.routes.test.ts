import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@asone/errors';

import type { AuthService } from '../auth/auth.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { registerInventoryReversalRoutes } from './inventory-reversal.routes.js';
import type { InventoryReversalService } from './inventory-reversal.service.js';

const companyId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const branchId = '00000000-0000-4000-8000-000000000003';
const movementId = '00000000-0000-7000-8000-000000000004';
const reversalId = '00000000-0000-7000-8000-000000000005';
const apps: FastifyInstance[] = [];

async function fixture(
  permissions: readonly string[],
  replayed = false,
): Promise<{
  app: FastifyInstance;
  service: { reverse: ReturnType<typeof vi.fn> };
}> {
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
  apps.push(app);
  app.addHook('onRequest', (request, _reply, done) => {
    request.requestContext = {
      requestId: 'request',
      correlationId: 'correlation',
      companyId: undefined,
      branchId: undefined,
      userId: undefined,
      sessionId: undefined,
      deviceId: undefined,
    };
    done();
  });
  app.setErrorHandler((error, request, reply) =>
    error instanceof AppError
      ? reply.code(error.statusCode).send({
          error: { code: error.code },
          meta: { request_id: request.requestContext.requestId },
        })
      : typeof error === 'object' && error !== null && 'validation' in error
        ? reply.code(400).send({ error: { code: 'validation_error' } })
        : reply.code(500).send({ error: { code: 'internal_error' } }),
  );
  const auth: AuthContext = {
    companyId,
    userId,
    membershipId: userId,
    sessionId: userId,
    expiresAt: new Date(Date.now() + 60_000),
    permissions,
    permittedBranchIds: [branchId],
  };
  const authentication = {
    authenticate: vi.fn(() => Promise.resolve(auth)),
    requirePermission: vi.fn((_context: AuthContext, permission: string) => {
      if (!permissions.includes(permission))
        throw new AppError({ code: 'permission_denied', message: 'Denied', statusCode: 403 });
    }),
  } as unknown as AuthService;
  const service = {
    reverse: vi.fn(() =>
      Promise.resolve({
        value: {
          original_movement_id: movementId,
          original_status: 'reversed',
          original_version: 4,
          reversal_movement_id: reversalId,
          reversal_movement_number: `IMV-${reversalId.replaceAll('-', '')}`,
          reversal_status: 'posted',
          reversal_version: 1,
          reversed_at: '2026-07-29T20:00:00.000Z',
          affected_balance_count: 2,
        },
        replayed,
      }),
    ),
  };
  registerInventoryReversalRoutes(
    app,
    authentication,
    service as unknown as InventoryReversalService,
  );
  await app.ready();
  return { app, service };
}

afterEach(async () => Promise.all(apps.splice(0).map(async (app) => app.close())));

describe('inventory reversal E071 HTTP route', () => {
  it('requires inventory.reverse and returns the updated original ETag', async () => {
    const denied = await fixture(['inventory.adjust', 'inventory.approve']);
    expect(
      (
        await denied.app.inject({
          method: 'POST',
          url: `/api/v1/inventory/movements/${movementId}/reversals`,
          headers: {
            authorization: 'Bearer token',
            'if-match': '"3"',
            'idempotency-key': 'reverse',
          },
          payload: { reason_code: 'ENTRY_ERROR' },
        })
      ).statusCode,
    ).toBe(403);

    const { app, service } = await fixture(['inventory.reverse']);
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/inventory/movements/${movementId}/reversals`,
      headers: {
        authorization: 'Bearer token',
        'if-match': '"3"',
        'idempotency-key': 'reverse',
      },
      payload: { reason_code: ' ENTRY_ERROR ', note: ' operator correction ' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.headers.etag).toBe('"4"');
    expect(response.body).not.toContain('cost');
    expect(service.reverse).toHaveBeenCalledWith(
      expect.objectContaining({ companyId, actorId: userId }),
      [branchId],
      movementId,
      3n,
      'reverse',
      { reasonCode: 'ENTRY_ERROR', note: 'operator correction' },
    );
  });

  it('rejects missing command headers, invalid ids, empty reasons, and unknown fields', async () => {
    const { app } = await fixture(['inventory.reverse']);
    const requests = [
      app.inject({
        method: 'POST',
        url: `/api/v1/inventory/movements/${movementId}/reversals`,
        headers: { authorization: 'Bearer token' },
        payload: { reason_code: 'ERROR' },
      }),
      app.inject({
        method: 'POST',
        url: '/api/v1/inventory/movements/not-a-uuid/reversals',
        headers: {
          authorization: 'Bearer token',
          'if-match': '"1"',
          'idempotency-key': 'invalid',
        },
        payload: { reason_code: 'ERROR' },
      }),
      app.inject({
        method: 'POST',
        url: `/api/v1/inventory/movements/${movementId}/reversals`,
        headers: {
          authorization: 'Bearer token',
          'if-match': '"1"',
          'idempotency-key': 'empty',
        },
        payload: { reason_code: '   ' },
      }),
      app.inject({
        method: 'POST',
        url: `/api/v1/inventory/movements/${movementId}/reversals`,
        headers: {
          authorization: 'Bearer token',
          'if-match': '"1"',
          'idempotency-key': 'unknown',
        },
        payload: { reason_code: 'ERROR', metadata: {} },
      }),
    ];
    expect((await Promise.all(requests)).map(({ statusCode }) => statusCode)).toEqual([
      400, 400, 400, 400,
    ]);
  });

  it('preserves the 201 body and ETag for exact replay', async () => {
    const { app } = await fixture(['inventory.reverse'], true);
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/inventory/movements/${movementId}/reversals`,
      headers: {
        authorization: 'Bearer token',
        'if-match': '"3"',
        'idempotency-key': 'replay',
      },
      payload: { reason_code: 'ERROR', note: null },
    });
    expect(response.statusCode).toBe(201);
    expect(response.headers.etag).toBe('"4"');
    expect(response.headers['idempotency-replayed']).toBe('true');
  });
});
