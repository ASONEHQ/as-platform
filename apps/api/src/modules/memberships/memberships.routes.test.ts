import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@asone/errors';

import type { AuthService } from '../auth/auth.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { registerMembershipRoutes } from './memberships.routes.js';
import type { MembershipsService } from './memberships.service.js';

const companyId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const branchId = '00000000-0000-4000-8000-000000000003';
const planId = '00000000-0000-7000-8000-000000000004';
const customerId = '00000000-0000-7000-8000-000000000005';
const membershipId = '00000000-0000-7000-8000-000000000006';
const apps: FastifyInstance[] = [];

function planValue(overrides?: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return {
    id: planId,
    companyId,
    name: 'Mensual',
    description: null,
    active: true,
    productId: null,
    durationDays: 30,
    benefitDescription: null,
    // TASK 16.21 — the structured benefit fields `planHttp()` now
    // serializes; defaulted to "no benefit configured" here so every
    // pre-existing test in this file keeps passing unchanged.
    benefitType: null,
    benefitPercentageBasisPoints: null,
    benefitFixedAmount: null,
    benefitProductIds: [],
    benefitCategoryIds: [],
    branchIds: [],
    createdBy: userId,
    updatedBy: userId,
    version: 1n,
    createdAt: new Date('2026-09-04T00:00:00.000Z'),
    updatedAt: new Date('2026-09-04T00:00:00.000Z'),
    ...overrides,
  };
}
function membershipValue(overrides?: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return {
    id: membershipId,
    companyId,
    customerId,
    membershipPlanId: planId,
    membershipNumber: 'MEM-00000001',
    status: 'active',
    startsAt: new Date('2026-09-04T00:00:00.000Z'),
    expiresAt: new Date('2026-10-04T00:00:00.000Z'),
    issuedAt: new Date('2026-09-04T00:00:00.000Z'),
    sourceSaleId: null,
    renewedFromMembershipId: null,
    cancelledAt: null,
    cancelledReason: null,
    createdBy: userId,
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
    createPlan: vi.fn(() => Promise.resolve({ value: planValue(), replayed: false })),
    updatePlan: vi.fn(() => Promise.resolve(planValue({ version: 2n }))),
    plan: vi.fn(() => Promise.resolve(planValue())),
    listPlans: vi.fn(() => Promise.resolve([planValue()])),
    membershipsForCustomer: vi.fn(() => Promise.resolve([membershipValue()])),
    issueMembership: vi.fn(() => Promise.resolve({ value: membershipValue(), replayed: false })),
    renewMembership: vi.fn(() => Promise.resolve({ value: membershipValue({ id: 'renewed-1' }), replayed: false })),
    cancelMembership: vi.fn(() => Promise.resolve(membershipValue({ status: 'cancelled' }))),
    validate: vi.fn(() => Promise.resolve({ valid: true, reason: null, membership: membershipValue(), eligibleBranch: true })),
  };
  registerMembershipRoutes(app, authentication, service as unknown as MembershipsService);
  await app.ready();
  return { app, service };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe('memberships HTTP routes (TASK 13.0)', () => {
  describe('POST /api/v1/membership-plans', () => {
    it('creates under membership.manage and rejects without it', async () => {
      const allowed = await fixture(['membership.manage']);
      const ok = await allowed.app.inject({
        method: 'POST',
        url: '/api/v1/membership-plans',
        headers: { authorization: 'Bearer token', 'idempotency-key': 'plan-1' },
        payload: { name: 'Mensual' },
      });
      expect(ok.statusCode).toBe(201);

      const denied = await fixture(['membership.read']);
      const rejected = await denied.app.inject({
        method: 'POST',
        url: '/api/v1/membership-plans',
        headers: { authorization: 'Bearer token', 'idempotency-key': 'plan-1' },
        payload: { name: 'Mensual' },
      });
      expect(rejected.statusCode).toBe(403);
    });
  });

  describe('POST /api/v1/membership-plans — benefit fields (TASK 16.21)', () => {
    it('passes structured benefit fields through to the service and echoes them back in the response', async () => {
      const productId = '00000000-0000-4000-8000-000000000010';
      const { app, service } = await fixture(['membership.manage']);
      service.createPlan = vi.fn(() =>
        Promise.resolve({
          value: planValue({
            benefitType: 'percentage_discount',
            benefitPercentageBasisPoints: 1500,
            benefitProductIds: [productId],
          }),
          replayed: false,
        }),
      );
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/membership-plans',
        headers: { authorization: 'Bearer token', 'idempotency-key': 'plan-benefit-1' },
        payload: {
          name: 'VIP',
          benefit_type: 'percentage_discount',
          benefit_percentage_basis_points: 1500,
          benefit_product_ids: [productId],
        },
      });
      expect(response.statusCode).toBe(201);
      expect(service.createPlan).toHaveBeenCalledWith(
        expect.anything(),
        'plan-benefit-1',
        expect.objectContaining({
          benefitType: 'percentage_discount',
          benefitPercentageBasisPoints: 1500,
          benefitProductIds: [productId],
        }),
      );
      const body = response.json<{ data: { benefit_type: string; benefit_percentage_basis_points: number; benefit_product_ids: string[] } }>();
      expect(body.data.benefit_type).toBe('percentage_discount');
      expect(body.data.benefit_percentage_basis_points).toBe(1500);
      expect(body.data.benefit_product_ids).toEqual([productId]);
    });

    it('rejects an out-of-range benefit_percentage_basis_points at the schema boundary, never reaching the service', async () => {
      const { app, service } = await fixture(['membership.manage']);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/membership-plans',
        headers: { authorization: 'Bearer token', 'idempotency-key': 'plan-benefit-bad-1' },
        payload: { name: 'Bad', benefit_type: 'percentage_discount', benefit_percentage_basis_points: 20_000 },
      });
      expect(response.statusCode).toBe(400);
      expect(service.createPlan).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/customers/:customerId/memberships', () => {
    it('lists a customer\'s memberships', async () => {
      const { app, service } = await fixture(['membership.read']);
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/customers/${customerId}/memberships`,
        headers: { authorization: 'Bearer token' },
      });
      expect(response.statusCode).toBe(200);
      expect(service.membershipsForCustomer).toHaveBeenCalledTimes(1);
    });
  });

  describe('POST /api/v1/customers/:customerId/memberships (manual issuance)', () => {
    it('issues under membership.issue and rejects without it', async () => {
      const allowed = await fixture(['membership.issue']);
      const ok = await allowed.app.inject({
        method: 'POST',
        url: `/api/v1/customers/${customerId}/memberships`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'issue-1' },
        payload: { membership_plan_id: planId },
      });
      expect(ok.statusCode).toBe(201);

      const denied = await fixture(['membership.manage']);
      const rejected = await denied.app.inject({
        method: 'POST',
        url: `/api/v1/customers/${customerId}/memberships`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'issue-1' },
        payload: { membership_plan_id: planId },
      });
      expect(rejected.statusCode).toBe(403);
    });
  });

  describe('POST /api/v1/customer-memberships/:id/cancel', () => {
    it('requires a non-empty reason at the schema boundary', async () => {
      const { app, service } = await fixture(['membership.manage']);
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/customer-memberships/${membershipId}/cancel`,
        headers: { authorization: 'Bearer token', 'if-match': '"1"' },
        payload: {},
      });
      expect(response.statusCode).toBe(400);
      expect(service.cancelMembership).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/v1/memberships/validate — Part N: server-authoritative', () => {
    it('returns the backend\'s own validity decision, never something Flutter could compute itself', async () => {
      const { app, service } = await fixture(['membership.read']);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/memberships/validate',
        headers: { authorization: 'Bearer token' },
        payload: { customer_id: customerId, branch_id: branchId },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<{ data: { valid: boolean } }>();
      expect(body.data.valid).toBe(true);
      expect(service.validate).toHaveBeenCalledTimes(1);
    });
  });
});
