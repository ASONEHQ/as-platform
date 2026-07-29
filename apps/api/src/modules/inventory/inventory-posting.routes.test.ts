import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@asone/errors';

import type { AuthService } from '../auth/auth.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { registerInventoryPostingRoutes } from './inventory-posting.routes.js';
import type { InventoryPostingService } from './inventory-posting.service.js';

const companyId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const branchId = '00000000-0000-4000-8000-000000000003';
const movementId = '00000000-0000-7000-8000-000000000004';
const apps: FastifyInstance[] = [];

async function fixture(permissions: readonly string[]): Promise<{
  app: FastifyInstance;
  service: { submit: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
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
    submit: vi.fn(() =>
      Promise.resolve({
        value: {
          movement_id: movementId,
          movement_number: `IMV-${movementId.replaceAll('-', '')}`,
          status: 'pending',
          version: 2,
        },
        replayed: false,
      }),
    ),
    post: vi.fn(() =>
      Promise.resolve({
        value: {
          movement_id: movementId,
          movement_number: `IMV-${movementId.replaceAll('-', '')}`,
          status: 'posted',
          version: 3,
          posted_at: '2026-07-29T18:00:00.000Z',
          affected_balance_count: 1,
        },
        replayed: false,
      }),
    ),
  };
  registerInventoryPostingRoutes(
    app,
    authentication,
    service as unknown as InventoryPostingService,
  );
  await app.ready();
  return { app, service };
}

afterEach(async () => Promise.all(apps.splice(0).map(async (app) => app.close())));

describe('inventory posting E153-E154 HTTP routes', () => {
  it('submits with strict command headers and returns its strong ETag', async () => {
    const { app, service } = await fixture(['inventory.adjust']);
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/inventory/movements/${movementId}/submit`,
      headers: {
        authorization: 'Bearer token',
        'if-match': '"1"',
        'idempotency-key': 'submit',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"2"');
    expect(service.submit).toHaveBeenCalledWith(
      expect.objectContaining({ companyId, actorId: userId }),
      [branchId],
      movementId,
      1n,
      'submit',
    );
  });

  it('posts only with inventory.approve and exposes no costs', async () => {
    const denied = await fixture(['inventory.adjust']);
    expect(
      (
        await denied.app.inject({
          method: 'POST',
          url: `/api/v1/inventory/movements/${movementId}/post`,
          headers: {
            authorization: 'Bearer token',
            'if-match': '"2"',
            'idempotency-key': 'post',
          },
        })
      ).statusCode,
    ).toBe(403);
    const allowed = await fixture(['inventory.approve']);
    const response = await allowed.app.inject({
      method: 'POST',
      url: `/api/v1/inventory/movements/${movementId}/post`,
      headers: {
        authorization: 'Bearer token',
        'if-match': '"2"',
        'idempotency-key': 'post',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"3"');
    expect(response.body).not.toContain('cost');
  });

  it('rejects missing headers, invalid UUIDs, and unknown bodies', async () => {
    const { app } = await fixture(['inventory.adjust', 'inventory.approve']);
    const missing = await app.inject({
      method: 'POST',
      url: `/api/v1/inventory/movements/${movementId}/submit`,
      headers: { authorization: 'Bearer token' },
    });
    expect(missing.statusCode).toBe(400);
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/movements/not-a-uuid/post',
      headers: {
        authorization: 'Bearer token',
        'if-match': '"1"',
        'idempotency-key': 'invalid',
      },
    });
    expect(invalid.statusCode).toBe(400);
    const body = await app.inject({
      method: 'POST',
      url: `/api/v1/inventory/movements/${movementId}/post`,
      headers: {
        authorization: 'Bearer token',
        'if-match': '"1"',
        'idempotency-key': 'body',
      },
      payload: { unknown: true },
    });
    expect(body.statusCode).toBe(400);
  });
});
