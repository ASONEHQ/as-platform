import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@asone/errors';

import type { AuthService } from '../auth/auth.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { registerRefundRoutes } from './refunds.routes.js';
import type { RefundsService } from './refunds.service.js';

const companyId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const branchId = '00000000-0000-4000-8000-000000000003';
const saleId = '00000000-0000-7000-8000-000000000004';
const refundId = '00000000-0000-7000-8000-000000000005';
const saleItemId = '00000000-0000-7000-8000-000000000006';
const refundItemId = '00000000-0000-7000-8000-000000000007';
const cashSessionId = '00000000-0000-7000-8000-000000000008';
const paymentId = '00000000-0000-7000-8000-000000000009';
const apps: FastifyInstance[] = [];

function refundValue(overrides?: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return {
    id: refundId,
    companyId,
    branchId,
    saleId,
    cashSessionId: null,
    paymentId: null,
    refundNumber: 'REF-1',
    status: 'approved',
    refundMethod: 'cash',
    reasonCode: 'customer_changed_mind',
    reasonNote: null,
    currencyCode: 'MXN',
    subtotal: '10.0000',
    taxTotal: '1.6000',
    total: '11.6000',
    occurredAt: new Date('2026-09-04T09:00:00.000Z'),
    completedAt: null,
    createdBy: userId,
    approvedBy: userId,
    deviceId: null,
    version: 1n,
    createdAt: new Date('2026-09-04T09:00:00.000Z'),
    updatedAt: new Date('2026-09-04T09:00:00.000Z'),
    ...overrides,
  };
}

function refundItemValue(): Readonly<Record<string, unknown>> {
  return {
    id: refundItemId,
    companyId,
    branchId,
    refundId,
    saleItemId,
    quantity: '1.000000',
    subtotal: '10.0000',
    taxTotal: '1.6000',
    lineTotal: '11.6000',
    restockDisposition: 'restock',
    createdAt: new Date('2026-09-04T09:00:00.000Z'),
  };
}

function balanceValue(): Readonly<Record<string, unknown>> {
  return {
    saleId,
    refundable: true,
    blockedReason: null,
    lines: [
      {
        saleItemId,
        nameSnapshot: 'Widget',
        soldQuantity: '3.000000',
        refundedQuantity: '0.000000',
        refundableQuantity: '3.000000',
        unitPrice: '3.3333',
      },
    ],
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
    refundableBalance: vi.fn(() => Promise.resolve(balanceValue())),
    createRefund: vi.fn(() => Promise.resolve({ value: refundValue(), replayed: false })),
    refund: vi.fn(() => Promise.resolve(refundValue())),
    refundItems: vi.fn(() => Promise.resolve([refundItemValue()])),
    listRefunds: vi.fn(() => Promise.resolve({ items: [refundValue()], nextCursor: null })),
    completeRefund: vi.fn(() =>
      Promise.resolve({
        value: refundValue({ status: 'completed', completedAt: new Date('2026-09-04T09:05:00.000Z'), cashSessionId, paymentId, version: 2n }),
        replayed: false,
      }),
    ),
  };
  registerRefundRoutes(app, authentication, service as unknown as RefundsService);
  await app.ready();
  return { app, service };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe('refund HTTP routes (TASK 12.8)', () => {
  describe('GET /api/v1/sales/:sale_id/refundable-balance (E081)', () => {
    it('reads under refund.read and rejects without it', async () => {
      const allowed = await fixture(['refund.read']);
      const ok = await allowed.app.inject({
        method: 'GET',
        url: `/api/v1/sales/${saleId}/refundable-balance`,
        headers: { authorization: 'Bearer token' },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({
        data: { sale_id: saleId, refundable: true, lines: [expect.objectContaining({ sale_item_id: saleItemId })] },
      });

      const denied = await fixture(['refund.create']);
      const rejected = await denied.app.inject({
        method: 'GET',
        url: `/api/v1/sales/${saleId}/refundable-balance`,
        headers: { authorization: 'Bearer token' },
      });
      expect(rejected.statusCode).toBe(403);
      expect(denied.service.refundableBalance).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/v1/refunds (E082)', () => {
    const payload = {
      sale_id: saleId,
      reason_code: 'customer_changed_mind',
      items: [{ sale_item_id: saleItemId, quantity: '1' }],
    };

    it('creates under refund.create and rejects without it', async () => {
      const allowed = await fixture(['refund.create']);
      const ok = await allowed.app.inject({
        method: 'POST',
        url: '/api/v1/refunds',
        headers: { authorization: 'Bearer token', 'idempotency-key': 'refund-1' },
        payload,
      });
      expect(ok.statusCode).toBe(201);
      expect(allowed.service.createRefund).toHaveBeenCalledTimes(1);
      expect(ok.json()).toMatchObject({
        data: { id: refundId, status: 'approved', items: [expect.objectContaining({ sale_item_id: saleItemId })] },
      });

      const denied = await fixture(['refund.read']);
      const rejected = await denied.app.inject({
        method: 'POST',
        url: '/api/v1/refunds',
        headers: { authorization: 'Bearer token', 'idempotency-key': 'refund-1' },
        payload,
      });
      expect(rejected.statusCode).toBe(403);
      expect(denied.service.createRefund).not.toHaveBeenCalled();
    });

    it('requires an Idempotency-Key header', async () => {
      const { app } = await fixture(['refund.create']);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/refunds',
        headers: { authorization: 'Bearer token' },
        payload,
      });
      expect(response.statusCode).toBe(400);
    });

    it('requires at least one item — an empty items array is rejected at the schema boundary', async () => {
      const { app, service } = await fixture(['refund.create']);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/refunds',
        headers: { authorization: 'Bearer token', 'idempotency-key': 'refund-empty' },
        payload: { ...payload, items: [] },
      });
      expect(response.statusCode).toBe(400);
      expect(service.createRefund).not.toHaveBeenCalled();
    });

    it('rejects a malformed quantity at the schema boundary before it reaches the service', async () => {
      const { app, service } = await fixture(['refund.create']);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/refunds',
        headers: { authorization: 'Bearer token', 'idempotency-key': 'refund-badqty' },
        payload: { ...payload, items: [{ sale_item_id: saleItemId, quantity: 'not-a-number' }] },
      });
      expect(response.statusCode).toBe(400);
      expect(service.createRefund).not.toHaveBeenCalled();
    });

    it('never accepts a client-submitted refund total or method — only sale_id/reason/items are in the request body', async () => {
      const { app, service } = await fixture(['refund.create']);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/refunds',
        headers: { authorization: 'Bearer token', 'idempotency-key': 'refund-noauth-total' },
        payload: { ...payload, total: '0.01', refund_method: 'card_terminal' },
      });
      // additionalProperties: false rejects the extraneous fields outright.
      expect(response.statusCode).toBe(400);
      expect(service.createRefund).not.toHaveBeenCalled();
    });

    it('reports idempotency replay via response header', async () => {
      const { app, service } = await fixture(['refund.create']);
      service.createRefund?.mockResolvedValueOnce({ value: refundValue(), replayed: true });
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/refunds',
        headers: { authorization: 'Bearer token', 'idempotency-key': 'refund-replay' },
        payload,
      });
      expect(response.statusCode).toBe(201);
      expect(response.headers['idempotency-replayed']).toBe('true');
    });
  });

  describe('GET /api/v1/refunds/:id (E083)', () => {
    it('reads under refund.read and rejects without it', async () => {
      const allowed = await fixture(['refund.read']);
      const ok = await allowed.app.inject({
        method: 'GET',
        url: `/api/v1/refunds/${refundId}`,
        headers: { authorization: 'Bearer token' },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.headers.etag).toBe('"1"');
      expect(ok.json()).toMatchObject({ data: { id: refundId, items: [expect.objectContaining({ id: refundItemId })] } });

      const denied = await fixture(['refund.create']);
      const rejected = await denied.app.inject({
        method: 'GET',
        url: `/api/v1/refunds/${refundId}`,
        headers: { authorization: 'Bearer token' },
      });
      expect(rejected.statusCode).toBe(403);
    });
  });

  describe('GET /api/v1/refunds (E084)', () => {
    it('lists under refund.read and rejects without it', async () => {
      const allowed = await fixture(['refund.read']);
      const ok = await allowed.app.inject({
        method: 'GET',
        url: '/api/v1/refunds',
        headers: { authorization: 'Bearer token' },
      });
      expect(ok.statusCode).toBe(200);
      expect(allowed.service.listRefunds).toHaveBeenCalledTimes(1);

      const denied = await fixture(['refund.create']);
      const rejected = await denied.app.inject({
        method: 'GET',
        url: '/api/v1/refunds',
        headers: { authorization: 'Bearer token' },
      });
      expect(rejected.statusCode).toBe(403);
      expect(denied.service.listRefunds).not.toHaveBeenCalled();
    });

    it('passes every documented filter straight through to the service, and defaults limit to 50', async () => {
      const { app, service } = await fixture(['refund.read']);
      const response = await app.inject({
        method: 'GET',
        url:
          `/api/v1/refunds?branch_id=${branchId}&sale_id=${saleId}&status=completed` +
          `&occurred_from=2026-09-01T00:00:00.000Z&occurred_to=2026-09-30T00:00:00.000Z&cursor=abc`,
        headers: { authorization: 'Bearer token' },
      });
      expect(response.statusCode).toBe(200);
      expect(service.listRefunds).toHaveBeenCalledWith(companyId, [branchId], {
        limit: 50,
        cursor: 'abc',
        branchId,
        saleId,
        status: 'completed',
        occurredFrom: new Date('2026-09-01T00:00:00.000Z'),
        occurredTo: new Date('2026-09-30T00:00:00.000Z'),
      });
    });

    it('rejects a branch_id filter outside the authorized branch list', async () => {
      const { app, service } = await fixture(['refund.read']);
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/refunds?branch_id=${'0'.repeat(8)}-0000-4000-8000-000000000099`,
        headers: { authorization: 'Bearer token' },
      });
      expect(response.statusCode).toBe(403);
      expect(service.listRefunds).not.toHaveBeenCalled();
    });

    it('rejects an unknown query parameter and an out-of-range limit', async () => {
      const { app } = await fixture(['refund.read']);
      const unknownParam = await app.inject({
        method: 'GET',
        url: '/api/v1/refunds?foo=not-a-documented-filter',
        headers: { authorization: 'Bearer token' },
      });
      expect(unknownParam.statusCode).toBe(400);
      const outOfRangeLimit = await app.inject({
        method: 'GET',
        url: '/api/v1/refunds?limit=1000',
        headers: { authorization: 'Bearer token' },
      });
      expect(outOfRangeLimit.statusCode).toBe(400);
    });

    it('is read-only — never calls a mutation method on the service', async () => {
      const { app, service } = await fixture(['refund.read']);
      await app.inject({ method: 'GET', url: '/api/v1/refunds', headers: { authorization: 'Bearer token' } });
      expect(service.createRefund).not.toHaveBeenCalled();
      expect(service.completeRefund).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/v1/refunds/:id/completion (E086)', () => {
    it('completes under refund.complete and rejects without it', async () => {
      const allowed = await fixture(['refund.complete']);
      const ok = await allowed.app.inject({
        method: 'POST',
        url: `/api/v1/refunds/${refundId}/completion`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'complete-1' },
        payload: {},
      });
      expect(ok.statusCode).toBe(200);
      expect(allowed.service.completeRefund).toHaveBeenCalledTimes(1);
      expect(ok.json()).toMatchObject({ data: { status: 'completed', payment_id: paymentId, cash_session_id: cashSessionId } });

      const denied = await fixture(['refund.read']);
      const rejected = await denied.app.inject({
        method: 'POST',
        url: `/api/v1/refunds/${refundId}/completion`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'complete-1' },
        payload: {},
      });
      expect(rejected.statusCode).toBe(403);
      expect(denied.service.completeRefund).not.toHaveBeenCalled();
    });

    it('requires an Idempotency-Key header — completion must never be retried blindly', async () => {
      const { app } = await fixture(['refund.complete']);
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/refunds/${refundId}/completion`,
        headers: { authorization: 'Bearer token' },
        payload: {},
      });
      expect(response.statusCode).toBe(400);
    });

    it('passes an optional cash_register_id straight through to the service', async () => {
      const { app, service } = await fixture(['refund.complete']);
      const registerId = '00000000-0000-7000-8000-00000000000a';
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/refunds/${refundId}/completion`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'complete-reg' },
        payload: { cash_register_id: registerId },
      });
      expect(response.statusCode).toBe(200);
      expect(service.completeRefund).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        refundId,
        { cashRegisterId: registerId },
      );
    });

    it('reports idempotency replay via response header — a retried completion never posts twice', async () => {
      const { app, service } = await fixture(['refund.complete']);
      service.completeRefund?.mockResolvedValueOnce({
        value: refundValue({ status: 'completed', completedAt: new Date('2026-09-04T09:05:00.000Z'), version: 2n }),
        replayed: true,
      });
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/refunds/${refundId}/completion`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'complete-replay' },
        payload: {},
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['idempotency-replayed']).toBe('true');
    });

    it('never accepts a client-submitted status — only cash_register_id is in the request body', async () => {
      const { app, service } = await fixture(['refund.complete']);
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/refunds/${refundId}/completion`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'complete-noauth-status' },
        payload: { status: 'completed' },
      });
      // additionalProperties: false rejects the extraneous field outright.
      expect(response.statusCode).toBe(400);
      expect(service.completeRefund).not.toHaveBeenCalled();
    });
  });
});
