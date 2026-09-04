import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@asone/errors';

import type { AuthService } from '../auth/auth.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { registerLoyaltyRoutes } from './loyalty.routes.js';
import type { LoyaltyService } from './loyalty.service.js';

const companyId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const branchId = '00000000-0000-4000-8000-000000000003';
const programId = '00000000-0000-7000-8000-000000000004';
const customerId = '00000000-0000-7000-8000-000000000005';
const apps: FastifyInstance[] = [];

function programValue(overrides?: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return {
    id: programId,
    companyId,
    name: 'Stamps',
    active: true,
    unitType: 'stamp',
    earningRuleType: 'per_completed_sale',
    earnQuantityPerSale: 1,
    minimumSaleTotal: null,
    rewardThreshold: 5,
    rewardDescription: 'Free 6th visit',
    createdBy: userId,
    updatedBy: userId,
    version: 1n,
    createdAt: new Date('2026-09-04T00:00:00.000Z'),
    updatedAt: new Date('2026-09-04T00:00:00.000Z'),
    ...overrides,
  };
}

async function fixture(
  permissions: string[],
): Promise<{ app: FastifyInstance; service: Record<string, ReturnType<typeof vi.fn>> }> {
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
    requireBranchAccess: vi.fn(() => undefined),
  } as unknown as AuthService;
  const service = {
    createProgram: vi.fn(() => Promise.resolve({ value: programValue(), replayed: false })),
    updateProgram: vi.fn(() => Promise.resolve(programValue({ version: 2n }))),
    listPrograms: vi.fn(() => Promise.resolve([programValue()])),
    summary: vi.fn(() =>
      Promise.resolve({
        account: { id: 'acct-1', companyId, customerId, status: 'active', createdAt: new Date(), updatedAt: new Date() },
        balances: [{ programId, unitType: 'stamp', balance: 3 }],
        ledger: [],
      }),
    ),
    adjust: vi.fn(() =>
      Promise.resolve({
        value: {
          id: 'entry-1',
          companyId,
          loyaltyAccountId: 'acct-1',
          loyaltyProgramId: null,
          branchId: null,
          entryType: 'adjustment',
          quantity: 5,
          unitType: 'point',
          sourceType: 'manual',
          sourceId: null,
          reason: 'Goodwill',
          actorId: userId,
          occurredAt: new Date(),
          createdAt: new Date(),
        },
        replayed: false,
      }),
    ),
  };
  registerLoyaltyRoutes(app, authentication, service as unknown as LoyaltyService);
  await app.ready();
  return { app, service };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe('loyalty HTTP routes (TASK 13.0)', () => {
  describe('POST /api/v1/loyalty-programs', () => {
    it('creates under loyalty.manage and rejects without it', async () => {
      const allowed = await fixture(['loyalty.manage']);
      const ok = await allowed.app.inject({
        method: 'POST',
        url: '/api/v1/loyalty-programs',
        headers: { authorization: 'Bearer token', 'idempotency-key': 'prog-1' },
        payload: { name: 'Stamps', unit_type: 'stamp' },
      });
      expect(ok.statusCode).toBe(201);

      const denied = await fixture(['loyalty.read']);
      const rejected = await denied.app.inject({
        method: 'POST',
        url: '/api/v1/loyalty-programs',
        headers: { authorization: 'Bearer token', 'idempotency-key': 'prog-1' },
        payload: { name: 'Stamps', unit_type: 'stamp' },
      });
      expect(rejected.statusCode).toBe(403);
    });
  });

  describe('GET /api/v1/customers/:customerId/loyalty', () => {
    it('returns backend-derived balances, never a fake "reward available" without an entitlement', async () => {
      const { app, service } = await fixture(['loyalty.read']);
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/customers/${customerId}/loyalty`,
        headers: { authorization: 'Bearer token' },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<{ data: { balances: { balance: number }[] } }>();
      expect(body.data.balances[0]?.balance).toBe(3);
      expect(service.summary).toHaveBeenCalledTimes(1);
    });
  });

  describe('POST /api/v1/customers/:customerId/loyalty/adjust — separately permissioned (Part Y)', () => {
    it('requires loyalty.adjust specifically — loyalty.manage alone is not enough', async () => {
      const denied = await fixture(['loyalty.manage', 'loyalty.read']);
      const rejected = await denied.app.inject({
        method: 'POST',
        url: `/api/v1/customers/${customerId}/loyalty/adjust`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'adjust-1' },
        payload: { quantity: 5, unit_type: 'point', reason: 'Goodwill' },
      });
      expect(rejected.statusCode).toBe(403);

      const allowed = await fixture(['loyalty.adjust']);
      const ok = await allowed.app.inject({
        method: 'POST',
        url: `/api/v1/customers/${customerId}/loyalty/adjust`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'adjust-1' },
        payload: { quantity: 5, unit_type: 'point', reason: 'Goodwill' },
      });
      expect(ok.statusCode).toBe(201);
    });

    it('rejects a blank reason at the schema boundary', async () => {
      const { app, service } = await fixture(['loyalty.adjust']);
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/customers/${customerId}/loyalty/adjust`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'adjust-bad' },
        payload: { quantity: 5, unit_type: 'point', reason: '' },
      });
      expect(response.statusCode).toBe(400);
      expect(service.adjust).not.toHaveBeenCalled();
    });
  });
});
