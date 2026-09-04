import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@asone/errors';

import type { AuthService } from '../auth/auth.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { registerPromotionRoutes } from './promotions.routes.js';
import type { PromotionsService } from './promotions.service.js';

const companyId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const branchId = '00000000-0000-4000-8000-000000000003';
const promotionId = '00000000-0000-7000-8000-000000000004';
const couponId = '00000000-0000-7000-8000-000000000005';
const productId = '00000000-0000-7000-8000-000000000006';
const apps: FastifyInstance[] = [];

function promotionValue(overrides?: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return {
    id: promotionId,
    companyId,
    name: 'Promo 1',
    description: null,
    active: true,
    startsAt: null,
    endsAt: null,
    daysOfWeek: null,
    timeFrom: null,
    timeTo: null,
    priority: 0,
    stackable: false,
    benefitType: 'percentage',
    benefitPercentageBasisPoints: 1000,
    benefitFixedAmount: null,
    benefitNxmBuyQuantity: null,
    benefitNxmPayQuantity: null,
    minQuantity: null,
    minSubtotal: null,
    usageLimitTotal: null,
    combinableWithCoupons: true,
    branchIds: [],
    productIds: [],
    categoryIds: [],
    createdBy: userId,
    updatedBy: userId,
    version: 1n,
    createdAt: new Date('2026-09-04T00:00:00.000Z'),
    updatedAt: new Date('2026-09-04T00:00:00.000Z'),
    ...overrides,
  };
}
function couponValue(overrides?: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return {
    id: couponId,
    companyId,
    code: 'SAVE10',
    normalizedCode: 'SAVE10',
    description: null,
    benefitType: 'percentage',
    benefitPercentageBasisPoints: 1000,
    benefitFixedAmount: null,
    active: true,
    startsAt: null,
    endsAt: null,
    minSubtotal: null,
    usageLimitTotal: null,
    promotionId: null,
    createdBy: userId,
    updatedBy: userId,
    version: 1n,
    createdAt: new Date('2026-09-04T00:00:00.000Z'),
    updatedAt: new Date('2026-09-04T00:00:00.000Z'),
    ...overrides,
  };
}
function quoteResultValue(): Readonly<Record<string, unknown>> {
  return {
    currencyCode: 'MXN',
    lines: [
      {
        lineIndex: 0,
        productId,
        productVariantId: null,
        productVersion: 1n,
        categoryId: null,
        skuSnapshot: null,
        nameSnapshot: 'Widget',
        quantity: '1.000000',
        quantityUnits: 1_000_000n,
        unitPriceUnits: 1_000_000n,
        taxCode: 'IVA_GENERAL',
        taxBasisPoints: 1600,
        grossSubtotalUnits: 1_000_000n,
        discountUnits: 100_000n,
        discountBasisPoints: 1000,
        netSubtotalUnits: 900_000n,
        taxUnits: 144_000n,
        lineTotalUnits: 1_044_000n,
      },
    ],
    appliedDiscounts: [
      { sourceType: 'promotion', sourceId: promotionId, label: 'Promo 1', reasonCode: null, basisPoints: 1000, amountUnits: 100_000n, lineIndex: 0 },
    ],
    subtotalUnits: 1_000_000n,
    discountTotalUnits: 100_000n,
    taxTotalUnits: 144_000n,
    totalUnits: 1_044_000n,
    rejectedCoupons: [],
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
    requireBranchAccess: vi.fn((_context: AuthContext, requestedBranchId: string) => {
      if (requestedBranchId !== branchId)
        throw new AppError({ code: 'branch_access_denied', message: 'Denied', statusCode: 403 });
    }),
  } as unknown as AuthService;
  const service = {
    createPromotion: vi.fn(() => Promise.resolve({ value: promotionValue(), replayed: false })),
    updatePromotion: vi.fn(() => Promise.resolve(promotionValue({ version: 2n }))),
    promotion: vi.fn(() => Promise.resolve(promotionValue())),
    listPromotions: vi.fn(() => Promise.resolve({ items: [promotionValue()], nextCursor: null })),
    createCoupon: vi.fn(() => Promise.resolve({ value: couponValue(), replayed: false })),
    updateCoupon: vi.fn(() => Promise.resolve(couponValue({ version: 2n }))),
    coupon: vi.fn(() => Promise.resolve(couponValue())),
    listCoupons: vi.fn(() => Promise.resolve({ items: [couponValue()], nextCursor: null })),
    quote: vi.fn(() => Promise.resolve(quoteResultValue())),
  };
  registerPromotionRoutes(app, authentication, service as unknown as PromotionsService);
  await app.ready();
  return { app, service };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe('promotions/coupons/quote HTTP routes (TASK 12.9)', () => {
  describe('POST /api/v1/promotions', () => {
    const payload = { name: 'Promo 1', benefit_type: 'percentage', benefit_percentage_basis_points: 1000 };

    it('creates under promotion.manage and rejects without it', async () => {
      const allowed = await fixture(['promotion.manage']);
      const ok = await allowed.app.inject({
        method: 'POST',
        url: '/api/v1/promotions',
        headers: { authorization: 'Bearer token', 'idempotency-key': 'promo-1' },
        payload,
      });
      expect(ok.statusCode).toBe(201);
      expect(allowed.service.createPromotion).toHaveBeenCalledTimes(1);

      const denied = await fixture(['promotion.read']);
      const rejected = await denied.app.inject({
        method: 'POST',
        url: '/api/v1/promotions',
        headers: { authorization: 'Bearer token', 'idempotency-key': 'promo-1' },
        payload,
      });
      expect(rejected.statusCode).toBe(403);
      expect(denied.service.createPromotion).not.toHaveBeenCalled();
    });

    it('requires an Idempotency-Key header', async () => {
      const { app } = await fixture(['promotion.manage']);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/promotions',
        headers: { authorization: 'Bearer token' },
        payload,
      });
      expect(response.statusCode).toBe(400);
    });

    it('rejects an unknown benefit_type at the schema boundary', async () => {
      const { app, service } = await fixture(['promotion.manage']);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/promotions',
        headers: { authorization: 'Bearer token', 'idempotency-key': 'promo-bad' },
        payload: { name: 'Bad', benefit_type: 'not-a-real-type' },
      });
      expect(response.statusCode).toBe(400);
      expect(service.createPromotion).not.toHaveBeenCalled();
    });

    it('reports idempotency replay via response header', async () => {
      const { app, service } = await fixture(['promotion.manage']);
      service.createPromotion?.mockResolvedValueOnce({ value: promotionValue(), replayed: true });
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/promotions',
        headers: { authorization: 'Bearer token', 'idempotency-key': 'promo-replay' },
        payload,
      });
      expect(response.statusCode).toBe(201);
      expect(response.headers['idempotency-replayed']).toBe('true');
    });
  });

  describe('GET /api/v1/promotions', () => {
    it('lists under promotion.read and rejects without it', async () => {
      const allowed = await fixture(['promotion.read']);
      const ok = await allowed.app.inject({
        method: 'GET',
        url: '/api/v1/promotions',
        headers: { authorization: 'Bearer token' },
      });
      expect(ok.statusCode).toBe(200);
      expect(allowed.service.listPromotions).toHaveBeenCalledTimes(1);

      const denied = await fixture(['promotion.manage']);
      const rejected = await denied.app.inject({
        method: 'GET',
        url: '/api/v1/promotions',
        headers: { authorization: 'Bearer token' },
      });
      expect(rejected.statusCode).toBe(403);
      expect(denied.service.listPromotions).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/promotions/:id', () => {
    it('reads under promotion.read and rejects without it', async () => {
      const allowed = await fixture(['promotion.read']);
      const ok = await allowed.app.inject({
        method: 'GET',
        url: `/api/v1/promotions/${promotionId}`,
        headers: { authorization: 'Bearer token' },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.headers.etag).toBe('"1"');

      const denied = await fixture(['promotion.manage']);
      const rejected = await denied.app.inject({
        method: 'GET',
        url: `/api/v1/promotions/${promotionId}`,
        headers: { authorization: 'Bearer token' },
      });
      expect(rejected.statusCode).toBe(403);
    });
  });

  describe('PUT /api/v1/promotions/:id', () => {
    it('updates under promotion.manage, using the if-match version, and rejects without it', async () => {
      const allowed = await fixture(['promotion.manage']);
      const ok = await allowed.app.inject({
        method: 'PUT',
        url: `/api/v1/promotions/${promotionId}`,
        headers: { authorization: 'Bearer token', 'if-match': '"1"' },
        payload: { active: false },
      });
      expect(ok.statusCode).toBe(200);
      expect(allowed.service.updatePromotion).toHaveBeenCalledWith(
        expect.anything(),
        promotionId,
        1n,
        expect.objectContaining({ active: false }),
      );

      const denied = await fixture(['promotion.read']);
      const rejected = await denied.app.inject({
        method: 'PUT',
        url: `/api/v1/promotions/${promotionId}`,
        headers: { authorization: 'Bearer token', 'if-match': '"1"' },
        payload: { active: false },
      });
      expect(rejected.statusCode).toBe(403);
      expect(denied.service.updatePromotion).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/v1/coupons', () => {
    const payload = { code: 'SAVE10', benefit_type: 'percentage', benefit_percentage_basis_points: 1000 };

    it('creates under coupon.manage and rejects without it', async () => {
      const allowed = await fixture(['coupon.manage']);
      const ok = await allowed.app.inject({
        method: 'POST',
        url: '/api/v1/coupons',
        headers: { authorization: 'Bearer token', 'idempotency-key': 'coupon-1' },
        payload,
      });
      expect(ok.statusCode).toBe(201);
      expect(allowed.service.createCoupon).toHaveBeenCalledTimes(1);

      const denied = await fixture(['coupon.read']);
      const rejected = await denied.app.inject({
        method: 'POST',
        url: '/api/v1/coupons',
        headers: { authorization: 'Bearer token', 'idempotency-key': 'coupon-1' },
        payload,
      });
      expect(rejected.statusCode).toBe(403);
      expect(denied.service.createCoupon).not.toHaveBeenCalled();
    });

    it('requires an Idempotency-Key header', async () => {
      const { app } = await fixture(['coupon.manage']);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/coupons',
        headers: { authorization: 'Bearer token' },
        payload,
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /api/v1/coupons and /:id', () => {
    it('lists and reads under coupon.read, and rejects without it', async () => {
      const allowed = await fixture(['coupon.read']);
      const list = await allowed.app.inject({
        method: 'GET',
        url: '/api/v1/coupons',
        headers: { authorization: 'Bearer token' },
      });
      expect(list.statusCode).toBe(200);
      const detail = await allowed.app.inject({
        method: 'GET',
        url: `/api/v1/coupons/${couponId}`,
        headers: { authorization: 'Bearer token' },
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.headers.etag).toBe('"1"');

      const denied = await fixture(['coupon.manage']);
      const rejected = await denied.app.inject({
        method: 'GET',
        url: '/api/v1/coupons',
        headers: { authorization: 'Bearer token' },
      });
      expect(rejected.statusCode).toBe(403);
    });
  });

  describe('PUT /api/v1/coupons/:id', () => {
    it('updates under coupon.manage and rejects without it', async () => {
      const allowed = await fixture(['coupon.manage']);
      const ok = await allowed.app.inject({
        method: 'PUT',
        url: `/api/v1/coupons/${couponId}`,
        headers: { authorization: 'Bearer token', 'if-match': '"1"' },
        payload: { active: false },
      });
      expect(ok.statusCode).toBe(200);

      const denied = await fixture(['coupon.read']);
      const rejected = await denied.app.inject({
        method: 'PUT',
        url: `/api/v1/coupons/${couponId}`,
        headers: { authorization: 'Bearer token', 'if-match': '"1"' },
        payload: { active: false },
      });
      expect(rejected.statusCode).toBe(403);
      expect(denied.service.updateCoupon).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/v1/sales/pricing-quotes', () => {
    const payload = { branch_id: branchId, items: [{ product_id: productId, quantity: '1' }] };

    it('quotes under sale.create and rejects without it', async () => {
      const allowed = await fixture(['sale.create']);
      const ok = await allowed.app.inject({
        method: 'POST',
        url: '/api/v1/sales/pricing-quotes',
        headers: { authorization: 'Bearer token' },
        payload,
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({ data: { discount_total: '10.0000', total: '104.4000' } });

      const denied = await fixture(['promotion.read']);
      const rejected = await denied.app.inject({
        method: 'POST',
        url: '/api/v1/sales/pricing-quotes',
        headers: { authorization: 'Bearer token' },
        payload,
      });
      expect(rejected.statusCode).toBe(403);
      expect(denied.service.quote).not.toHaveBeenCalled();
    });

    it('rejects a branch outside the authorized branch list', async () => {
      const { app, service } = await fixture(['sale.create']);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sales/pricing-quotes',
        headers: { authorization: 'Bearer token' },
        payload: { ...payload, branch_id: '00000000-0000-4000-8000-00000000ffff' },
      });
      expect(response.statusCode).toBe(403);
      expect(service.quote).not.toHaveBeenCalled();
    });

    it('never requires Idempotency-Key — it is a plain read, never a mutation', async () => {
      const { app } = await fixture(['sale.create']);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sales/pricing-quotes',
        headers: { authorization: 'Bearer token' },
        payload,
      });
      expect(response.statusCode).toBe(200);
    });

    it('requires discount.apply when manual_discount is present, even with sale.create', async () => {
      const { app, service } = await fixture(['sale.create']);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sales/pricing-quotes',
        headers: { authorization: 'Bearer token' },
        payload: {
          ...payload,
          manual_discount: { scope: 'ticket', type: 'percentage', value: '1000', reason_code: 'x' },
        },
      });
      expect(response.statusCode).toBe(403);
      expect(service.quote).not.toHaveBeenCalled();
    });

    it('never accepts a client-submitted discount amount or total — only branch/items/coupon_codes/manual_discount are in the body', async () => {
      const { app, service } = await fixture(['sale.create']);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sales/pricing-quotes',
        headers: { authorization: 'Bearer token' },
        payload: { ...payload, total: '0.01', discount_total: '999.0000' },
      });
      // additionalProperties: false rejects the extraneous fields outright.
      expect(response.statusCode).toBe(400);
      expect(service.quote).not.toHaveBeenCalled();
    });
  });
});
