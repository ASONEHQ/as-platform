import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@asone/errors';

import type { AuthService } from '../auth/auth.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { registerRewardRoutes } from './rewards.routes.js';
import type { RewardsService } from './rewards.service.js';

const companyId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const branchId = '00000000-0000-4000-8000-000000000003';
const programId = '00000000-0000-7000-8000-000000000004';
const customerId = '00000000-0000-7000-8000-000000000005';
const entitlementId = '00000000-0000-7000-8000-000000000006';
const tokenId = '00000000-0000-7000-8000-000000000007';
const apps: FastifyInstance[] = [];

function entitlementValue(overrides?: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return {
    id: entitlementId,
    companyId,
    customerId,
    loyaltyAccountId: 'account-1',
    loyaltyProgramId: programId,
    rewardType: 'vip_pass',
    status: 'available',
    issuedAt: new Date('2026-09-04T00:00:00.000Z'),
    expiresAt: null,
    redeemedAt: null,
    redeemedBy: null,
    redeemedBranchId: null,
    revokedAt: null,
    revokedBy: null,
    revokedReason: null,
    sourceType: 'loyalty_threshold',
    sourceLedgerEntryId: null,
    cycleNumber: 1,
    createdBy: userId,
    version: 1n,
    createdAt: new Date('2026-09-04T00:00:00.000Z'),
    updatedAt: new Date('2026-09-04T00:00:00.000Z'),
    ...overrides,
  };
}
function tokenValue(overrides?: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return {
    id: tokenId,
    companyId,
    rewardEntitlementId: entitlementId,
    token: 'opaque-token-value-not-pii',
    status: 'active',
    createdAt: new Date('2026-09-04T00:00:00.000Z'),
    revokedAt: null,
    ...overrides,
  };
}

/** Mirrors `loyalty.routes.test.ts`/`memberships.routes.test.ts`'s exact
 * fixture shape: a real Fastify instance, a stubbed `AuthService`, and a
 * fully mocked service layer (`vi.fn()` per method) — never a real DB at
 * this level. `rewards.routes.ts` only calls the route-level
 * `requirePermission` guard for 5 of its 8 routes (list, manual-issue,
 * get, redeem, revoke); the 3 presentation-token routes rely entirely on
 * `RewardsService`'s OWN internal `reward.read` check (see
 * `rewards.service.ts`), so the mocked service functions below replicate
 * that exact internal check to prove the (perhaps surprising) real
 * behavior: a caller missing `reward.read` on those 3 routes gets a 400
 * `validation_error` from `RewardError`/`mapRewardError`, NOT a 403 — see
 * this file's own describe block for those routes. */
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
  // Replicates `RewardsService`'s own `requirePermission` for the 3 token
  // routes only — see this fixture's own doc comment above.
  function requireRewardRead(): void {
    if (!permissions.includes('reward.read'))
      throw new AppError({ code: 'validation_error', message: 'This actor is not authorized (reward.read).', statusCode: 400 });
  }
  const service = {
    entitlementsForCustomer: vi.fn(() => Promise.resolve([entitlementValue()])),
    issueManual: vi.fn(() => Promise.resolve({ value: entitlementValue({ sourceType: 'manual', cycleNumber: null }), replayed: false })),
    entitlement: vi.fn(() => Promise.resolve(entitlementValue())),
    redeem: vi.fn(() =>
      Promise.resolve({ value: entitlementValue({ status: 'redeemed', redeemedAt: new Date(), redeemedBy: userId }), replayed: false }),
    ),
    revoke: vi.fn(() => Promise.resolve(entitlementValue({ status: 'revoked', revokedAt: new Date(), revokedBy: userId, revokedReason: 'Test' }))),
    issueToken: vi.fn(() => {
      requireRewardRead();
      return Promise.resolve(tokenValue());
    }),
    activeToken: vi.fn(() => {
      requireRewardRead();
      return Promise.resolve(tokenValue());
    }),
    resolveToken: vi.fn(() => {
      requireRewardRead();
      return Promise.resolve(entitlementValue());
    }),
  };
  registerRewardRoutes(app, authentication, service as unknown as RewardsService);
  await app.ready();
  return { app, service };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe('rewards HTTP routes (TASK 13.1)', () => {
  describe('GET /api/v1/customers/:customerId/reward-entitlements', () => {
    it('rejects unauthenticated requests', async () => {
      const { app } = await fixture(['reward.read']);
      const response = await app.inject({ method: 'GET', url: `/api/v1/customers/${customerId}/reward-entitlements` });
      expect(response.statusCode).toBe(401);
    });

    it('requires reward.read and rejects without it', async () => {
      const denied = await fixture([]);
      const rejected = await denied.app.inject({
        method: 'GET',
        url: `/api/v1/customers/${customerId}/reward-entitlements`,
        headers: { authorization: 'Bearer token' },
      });
      expect(rejected.statusCode).toBe(403);
    });

    it('returns a list carrying both status and effective_status', async () => {
      const { app, service } = await fixture(['reward.read']);
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/customers/${customerId}/reward-entitlements`,
        headers: { authorization: 'Bearer token' },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<{ data: { status: string; effective_status: string }[] }>();
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.status).toBe('available');
      expect(body.data[0]?.effective_status).toBe('available');
      expect(service.entitlementsForCustomer).toHaveBeenCalledTimes(1);
    });
  });

  describe('POST /api/v1/customers/:customerId/reward-entitlements (manual issuance)', () => {
    it('rejects unauthenticated requests', async () => {
      const { app } = await fixture(['reward.issue']);
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/customers/${customerId}/reward-entitlements`,
        headers: { 'idempotency-key': 'issue-1' },
        payload: { loyalty_program_id: programId, reason_code: 'vip' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('issues under reward.issue and rejects without it', async () => {
      const allowed = await fixture(['reward.issue']);
      const ok = await allowed.app.inject({
        method: 'POST',
        url: `/api/v1/customers/${customerId}/reward-entitlements`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'issue-1' },
        payload: { loyalty_program_id: programId, reason_code: 'vip' },
      });
      expect(ok.statusCode).toBe(201);
      const body = ok.json<{ data: { status: string; effective_status: string; source_type: string } }>();
      expect(body.data.status).toBe('available');
      expect(body.data.effective_status).toBe('available');
      expect(body.data.source_type).toBe('manual');

      const denied = await fixture(['reward.read']);
      const rejected = await denied.app.inject({
        method: 'POST',
        url: `/api/v1/customers/${customerId}/reward-entitlements`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'issue-1' },
        payload: { loyalty_program_id: programId, reason_code: 'vip' },
      });
      expect(rejected.statusCode).toBe(403);
    });

    it('requires the idempotency-key header at the schema boundary', async () => {
      const { app, service } = await fixture(['reward.issue']);
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/customers/${customerId}/reward-entitlements`,
        headers: { authorization: 'Bearer token' },
        payload: { loyalty_program_id: programId, reason_code: 'vip' },
      });
      expect(response.statusCode).toBe(400);
      expect(service.issueManual).not.toHaveBeenCalled();
    });

    it('requires reason_code at the schema boundary', async () => {
      const { app, service } = await fixture(['reward.issue']);
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/customers/${customerId}/reward-entitlements`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'issue-bad' },
        payload: { loyalty_program_id: programId },
      });
      expect(response.statusCode).toBe(400);
      expect(service.issueManual).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/reward-entitlements/:id', () => {
    it('rejects unauthenticated requests', async () => {
      const { app } = await fixture(['reward.read']);
      const response = await app.inject({ method: 'GET', url: `/api/v1/reward-entitlements/${entitlementId}` });
      expect(response.statusCode).toBe(401);
    });

    it('requires reward.read and rejects without it', async () => {
      const denied = await fixture([]);
      const rejected = await denied.app.inject({
        method: 'GET',
        url: `/api/v1/reward-entitlements/${entitlementId}`,
        headers: { authorization: 'Bearer token' },
      });
      expect(rejected.statusCode).toBe(403);
    });

    it('returns the entitlement with both status and effective_status, and an etag', async () => {
      const { app } = await fixture(['reward.read']);
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/reward-entitlements/${entitlementId}`,
        headers: { authorization: 'Bearer token' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers.etag).toBe('"1"');
      const body = response.json<{ data: { id: string; status: string; effective_status: string } }>();
      expect(body.data.id).toBe(entitlementId);
      expect(body.data.status).toBe('available');
      expect(body.data.effective_status).toBe('available');
    });
  });

  describe('POST /api/v1/reward-entitlements/:id/redeem', () => {
    it('rejects unauthenticated requests', async () => {
      const { app } = await fixture(['reward.redeem']);
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/reward-entitlements/${entitlementId}/redeem`,
        headers: { 'idempotency-key': 'redeem-1' },
        payload: {},
      });
      expect(response.statusCode).toBe(401);
    });

    it('requires reward.redeem and rejects without it', async () => {
      const allowed = await fixture(['reward.redeem']);
      const ok = await allowed.app.inject({
        method: 'POST',
        url: `/api/v1/reward-entitlements/${entitlementId}/redeem`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'redeem-1' },
        payload: {},
      });
      expect(ok.statusCode).toBe(200);
      const body = ok.json<{ data: { status: string; effective_status: string } }>();
      expect(body.data.status).toBe('redeemed');
      expect(body.data.effective_status).toBe('redeemed');

      const denied = await fixture(['reward.read']);
      const rejected = await denied.app.inject({
        method: 'POST',
        url: `/api/v1/reward-entitlements/${entitlementId}/redeem`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'redeem-1' },
        payload: {},
      });
      expect(rejected.statusCode).toBe(403);
    });

    it('requires the idempotency-key header at the schema boundary', async () => {
      const { app, service } = await fixture(['reward.redeem']);
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/reward-entitlements/${entitlementId}/redeem`,
        headers: { authorization: 'Bearer token' },
        payload: {},
      });
      expect(response.statusCode).toBe(400);
      expect(service.redeem).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/v1/reward-entitlements/:id/revoke', () => {
    it('rejects unauthenticated requests', async () => {
      const { app } = await fixture(['reward.revoke']);
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/reward-entitlements/${entitlementId}/revoke`,
        headers: { 'if-match': '"1"' },
        payload: { reason: 'Fraud' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('requires reward.revoke and rejects without it', async () => {
      const allowed = await fixture(['reward.revoke']);
      const ok = await allowed.app.inject({
        method: 'POST',
        url: `/api/v1/reward-entitlements/${entitlementId}/revoke`,
        headers: { authorization: 'Bearer token', 'if-match': '"1"' },
        payload: { reason: 'Fraud' },
      });
      expect(ok.statusCode).toBe(200);
      const body = ok.json<{ data: { status: string; effective_status: string } }>();
      expect(body.data.status).toBe('revoked');
      expect(body.data.effective_status).toBe('revoked');

      const denied = await fixture(['reward.read']);
      const rejected = await denied.app.inject({
        method: 'POST',
        url: `/api/v1/reward-entitlements/${entitlementId}/revoke`,
        headers: { authorization: 'Bearer token', 'if-match': '"1"' },
        payload: { reason: 'Fraud' },
      });
      expect(rejected.statusCode).toBe(403);
    });

    it('requires the if-match header at the schema boundary', async () => {
      const { app, service } = await fixture(['reward.revoke']);
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/reward-entitlements/${entitlementId}/revoke`,
        headers: { authorization: 'Bearer token' },
        payload: { reason: 'Fraud' },
      });
      expect(response.statusCode).toBe(400);
      expect(service.revoke).not.toHaveBeenCalled();
    });

    it('requires a non-blank reason at the schema boundary', async () => {
      const { app, service } = await fixture(['reward.revoke']);
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/reward-entitlements/${entitlementId}/revoke`,
        headers: { authorization: 'Bearer token', 'if-match': '"1"' },
        payload: { reason: '' },
      });
      expect(response.statusCode).toBe(400);
      expect(service.revoke).not.toHaveBeenCalled();
    });
  });

  // Part L/X — these 3 routes never call the route-level `requirePermission`
  // guard themselves (see `rewards.routes.ts`); enforcement happens INSIDE
  // `RewardsService`'s own methods instead, and a `RewardError('validation_
  // error', …)` maps (via `mapRewardError`) to a 400, not a 403. This is a
  // real, intentional asymmetry with the other 5 routes above, not a test
  // gap — see this describe block's own assertions.
  describe('POST /api/v1/reward-entitlements/:id/presentation-token', () => {
    it('rejects unauthenticated requests', async () => {
      const { app } = await fixture(['reward.read']);
      const response = await app.inject({ method: 'POST', url: `/api/v1/reward-entitlements/${entitlementId}/presentation-token` });
      expect(response.statusCode).toBe(401);
    });

    it('issues a token carrying no route-level permission check (403); missing reward.read surfaces as a 400 from the service layer instead', async () => {
      const allowed = await fixture(['reward.read']);
      const ok = await allowed.app.inject({
        method: 'POST',
        url: `/api/v1/reward-entitlements/${entitlementId}/presentation-token`,
        headers: { authorization: 'Bearer token' },
      });
      expect(ok.statusCode).toBe(201);
      const body = ok.json<{ data: { token: string; reward_entitlement_id: string } }>();
      expect(body.data.reward_entitlement_id).toBe(entitlementId);
      expect(typeof body.data.token).toBe('string');

      const denied = await fixture([]);
      const rejected = await denied.app.inject({
        method: 'POST',
        url: `/api/v1/reward-entitlements/${entitlementId}/presentation-token`,
        headers: { authorization: 'Bearer token' },
      });
      expect(rejected.statusCode).toBe(400);
    });
  });

  describe('GET /api/v1/reward-entitlements/:id/presentation-token/active', () => {
    it('rejects unauthenticated requests', async () => {
      const { app } = await fixture(['reward.read']);
      const response = await app.inject({ method: 'GET', url: `/api/v1/reward-entitlements/${entitlementId}/presentation-token/active` });
      expect(response.statusCode).toBe(401);
    });

    it('returns the active token when reward.read is present; a 400 (not 403) when it is missing', async () => {
      const allowed = await fixture(['reward.read']);
      const ok = await allowed.app.inject({
        method: 'GET',
        url: `/api/v1/reward-entitlements/${entitlementId}/presentation-token/active`,
        headers: { authorization: 'Bearer token' },
      });
      expect(ok.statusCode).toBe(200);

      const denied = await fixture([]);
      const rejected = await denied.app.inject({
        method: 'GET',
        url: `/api/v1/reward-entitlements/${entitlementId}/presentation-token/active`,
        headers: { authorization: 'Bearer token' },
      });
      expect(rejected.statusCode).toBe(400);
    });
  });

  describe('POST /api/v1/reward-entitlements/resolve-token', () => {
    it('rejects unauthenticated requests', async () => {
      const { app } = await fixture(['reward.read']);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/reward-entitlements/resolve-token',
        payload: { token: 'a-token-value-long-enough' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('takes { token } in the body with no params, and returns the resolved entitlement', async () => {
      const { app, service } = await fixture(['reward.read']);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/reward-entitlements/resolve-token',
        headers: { authorization: 'Bearer token' },
        payload: { token: 'a-token-value-long-enough' },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<{ data: { id: string; status: string; effective_status: string } }>();
      expect(body.data.id).toBe(entitlementId);
      expect(body.data.status).toBe('available');
      expect(body.data.effective_status).toBe('available');
      expect(service.resolveToken).toHaveBeenCalledWith(expect.anything(), 'a-token-value-long-enough');
    });

    it('rejects a token shorter than the schema minimum, without reaching the service', async () => {
      const { app, service } = await fixture(['reward.read']);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/reward-entitlements/resolve-token',
        headers: { authorization: 'Bearer token' },
        payload: { token: 'short' },
      });
      expect(response.statusCode).toBe(400);
      expect(service.resolveToken).not.toHaveBeenCalled();
    });

    it('a 400 (not 403) when reward.read is missing', async () => {
      const denied = await fixture([]);
      const rejected = await denied.app.inject({
        method: 'POST',
        url: '/api/v1/reward-entitlements/resolve-token',
        headers: { authorization: 'Bearer token' },
        payload: { token: 'a-token-value-long-enough' },
      });
      expect(rejected.statusCode).toBe(400);
    });
  });
});
