import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@asone/errors';

import type { AuthService } from '../auth/auth.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { registerReadinessRoutes } from './readiness.routes.js';
import type { ReadinessService } from './readiness.service.js';
import type { TenantReadiness } from './readiness.types.js';

const companyId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const branchId = '00000000-0000-4000-8000-000000000003';
const foreignBranchId = '00000000-0000-4000-8000-000000000009';
const apps: FastifyInstance[] = [];

const readiness: TenantReadiness = {
  evaluatedAt: '2026-09-21T12:00:00.000Z',
  company: {
    id: companyId,
    name: 'Generic Merchant',
    currencyCode: 'USD',
    timezone: 'America/New_York',
    administrationReady: true,
    checks: [
      { code: 'company_active', scope: 'company', required: true, status: 'ok', surface: 'company', count: null, items: [] },
    ],
  },
  branches: [
    {
      branchId,
      code: 'B1',
      name: 'Generic Branch',
      checks: [
        {
          code: 'product_prices',
          scope: 'branch',
          required: true,
          status: 'warning',
          surface: 'prices',
          count: 1,
          items: [{ id: 'p1', label: 'Product X' }],
        },
      ],
      stages: [{ key: 'sale', ready: false, blockedBy: ['product_prices'] }],
    },
  ],
};

async function fixture(permissions: string[]): Promise<{ app: FastifyInstance; evaluate: ReturnType<typeof vi.fn> }> {
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
      ? reply.code(error.statusCode).send({ error: { code: error.code }, meta: { request_id: request.requestContext.requestId } })
      : typeof error === 'object' && error !== null && 'validation' in error
        ? reply.code(400).send({ error: { code: 'validation_error' } })
        : reply.code(500).send({ error: { code: 'internal_error' } }),
  );
  const authContext: AuthContext = {
    companyId,
    userId,
    membershipId: userId,
    sessionId: userId,
    expiresAt: new Date(Date.now() + 60_000),
    permissions,
    permittedBranchIds: [branchId],
  };
  const authentication = {
    authenticate: vi.fn(() => Promise.resolve(authContext)),
    requirePermission: vi.fn((_context: AuthContext, permission: string) => {
      if (!permissions.includes(permission))
        throw new AppError({ code: 'permission_denied', message: 'Denied', statusCode: 403 });
    }),
    requireBranchAccess: vi.fn((_context: AuthContext, requested: string) => {
      if (requested !== branchId)
        throw new AppError({ code: 'branch_access_denied', message: 'Denied', statusCode: 403 });
    }),
  } as unknown as AuthService;
  const evaluate = vi.fn(() => Promise.resolve(readiness));
  registerReadinessRoutes(app, authentication, { evaluate } as unknown as ReadinessService);
  await app.ready();
  return { app, evaluate };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe('GET /api/v1/readiness (TASK 16.17)', () => {
  it('is denied without branch.read and never reaches the evaluator', async () => {
    const { app, evaluate } = await fixture(['sale.read']);
    const response = await app.inject({ method: 'GET', url: '/api/v1/readiness', headers: { authorization: 'Bearer token' } });
    expect(response.statusCode).toBe(403);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('returns the evaluator result in the wire (snake_case) shape, scoped to the caller\'s own company and branches', async () => {
    const { app, evaluate } = await fixture(['branch.read']);
    const response = await app.inject({ method: 'GET', url: '/api/v1/readiness', headers: { authorization: 'Bearer token' } });
    expect(response.statusCode).toBe(200);
    // The company id and permitted branches come from the SESSION, never the request.
    expect(evaluate).toHaveBeenCalledWith(companyId, [branchId], undefined);
    const data = response.json().data;
    expect(data.company).toMatchObject({ id: companyId, currency_code: 'USD', administration_ready: true });
    expect(data.branches[0]).toMatchObject({
      branch_id: branchId,
      stages: [{ key: 'sale', ready: false, blocked_by: ['product_prices'] }],
    });
    expect(data.branches[0].checks[0]).toMatchObject({
      code: 'product_prices',
      required: true,
      status: 'warning',
      surface: 'prices',
      count: 1,
      items: [{ id: 'p1', label: 'Product X' }],
    });
  });

  it('accepts a branch_id inside the actor\'s scope and refuses one outside it', async () => {
    const { app, evaluate } = await fixture(['branch.read']);
    const ok = await app.inject({ method: 'GET', url: `/api/v1/readiness?branch_id=${branchId}`, headers: { authorization: 'Bearer token' } });
    expect(ok.statusCode).toBe(200);
    expect(evaluate).toHaveBeenCalledWith(companyId, [branchId], branchId);
    const denied = await app.inject({ method: 'GET', url: `/api/v1/readiness?branch_id=${foreignBranchId}`, headers: { authorization: 'Bearer token' } });
    expect(denied.statusCode).toBe(403);
  });

  it('rejects a malformed branch_id and any unknown query parameter', async () => {
    const { app } = await fixture(['branch.read']);
    expect((await app.inject({ method: 'GET', url: '/api/v1/readiness?branch_id=not-a-uuid', headers: { authorization: 'Bearer token' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/v1/readiness?company_id=someone-else', headers: { authorization: 'Bearer token' } })).statusCode).toBe(400);
  });
});
