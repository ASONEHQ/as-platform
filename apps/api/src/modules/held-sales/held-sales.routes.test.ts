import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@asone/errors';

import type { AuthService } from '../auth/auth.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { registerHeldSaleCartRoutes } from './held-sales.routes.js';
import type { HeldSaleCartsService } from './held-sales.service.js';

const companyId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const branchId = '00000000-0000-4000-8000-000000000003';
const cartId = '00000000-0000-7000-8000-000000000004';
const productId = '00000000-0000-4000-8000-000000000005';
const apps: FastifyInstance[] = [];

function cartValue(overrides?: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return {
    id: cartId,
    branchId,
    cashRegisterId: null,
    customerId: null,
    label: null,
    items: [{ productId, quantity: '1' }],
    status: 'held',
    createdBy: userId,
    resumedAt: null,
    resumedBy: null,
    resumedSaleId: null,
    discardedAt: null,
    discardedBy: null,
    createdAt: new Date('2026-09-07T00:00:00.000Z'),
    ...overrides,
  };
}

/** Mirrors `cash.routes.test.ts`'s own fixture shape exactly — a real
 * Fastify app, a real (stubbed) `AuthService.requirePermission`/
 * `requireBranchAccess`, and a fully mocked service, so this file proves
 * `held_sale.manage` is genuinely required by every route at the HTTP
 * layer (TASK 14.3 Wave 1 Part B.1's own mandatory "permission checks"
 * coverage) — never by trusting the service layer alone. */
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
    createCart: vi.fn(() => Promise.resolve({ value: cartValue(), replayed: false })),
    listCarts: vi.fn(() => Promise.resolve({ items: [cartValue()], nextCursor: null })),
    cart: vi.fn(() => Promise.resolve(cartValue())),
    // TASK 14.3A: resuming (claimed), NOT resumed — no real sale exists
    // until `linkSale` (see `held-sales.service.ts`'s own doc comment).
    resumeCart: vi.fn(() => Promise.resolve({ value: cartValue({ status: 'resuming' }), replayed: false })),
    linkSale: vi.fn(() =>
      Promise.resolve({ value: cartValue({ status: 'resumed', resumedSaleId: '00000000-0000-7000-8000-000000000099' }), replayed: false }),
    ),
    releaseCart: vi.fn(() => Promise.resolve({ value: cartValue({ status: 'held' }), replayed: false })),
    discardCart: vi.fn(() => Promise.resolve({ value: cartValue({ status: 'discarded' }), replayed: false })),
  };
  registerHeldSaleCartRoutes(app, authentication, service as unknown as HeldSaleCartsService);
  await app.ready();
  return { app, service };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe('held sale cart HTTP routes (TASK 14.3 Wave 1 Part B.1)', () => {
  describe('POST /api/v1/held-sale-carts', () => {
    it('creates under held_sale.manage and rejects without it', async () => {
      const allowed = await fixture(['held_sale.manage']);
      const ok = await allowed.app.inject({
        method: 'POST',
        url: '/api/v1/held-sale-carts',
        headers: { authorization: 'Bearer token', 'idempotency-key': 'held-1' },
        payload: { branch_id: branchId, items: [{ product_id: productId, quantity: '1' }] },
      });
      expect(ok.statusCode).toBe(201);
      expect(allowed.service.createCart).toHaveBeenCalledTimes(1);

      const denied = await fixture([]);
      const rejected = await denied.app.inject({
        method: 'POST',
        url: '/api/v1/held-sale-carts',
        headers: { authorization: 'Bearer token', 'idempotency-key': 'held-1' },
        payload: { branch_id: branchId, items: [{ product_id: productId, quantity: '1' }] },
      });
      expect(rejected.statusCode).toBe(403);
      expect(denied.service.createCart).not.toHaveBeenCalled();
    });

    it('requires a non-empty items array at the HTTP layer (clean 400, not a raw DB error)', async () => {
      const { app, service } = await fixture(['held_sale.manage']);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/held-sale-carts',
        headers: { authorization: 'Bearer token', 'idempotency-key': 'held-empty' },
        payload: { branch_id: branchId, items: [] },
      });
      expect(response.statusCode).toBe(400);
      expect(service.createCart).not.toHaveBeenCalled();
    });

    it('requires an Idempotency-Key header', async () => {
      const { app } = await fixture(['held_sale.manage']);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/held-sale-carts',
        headers: { authorization: 'Bearer token' },
        payload: { branch_id: branchId, items: [{ product_id: productId, quantity: '1' }] },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /api/v1/held-sale-carts', () => {
    it('lists under held_sale.manage and rejects without it', async () => {
      const allowed = await fixture(['held_sale.manage']);
      const ok = await allowed.app.inject({
        method: 'GET',
        url: '/api/v1/held-sale-carts',
        headers: { authorization: 'Bearer token' },
      });
      expect(ok.statusCode).toBe(200);

      const denied = await fixture([]);
      const rejected = await denied.app.inject({
        method: 'GET',
        url: '/api/v1/held-sale-carts',
        headers: { authorization: 'Bearer token' },
      });
      expect(rejected.statusCode).toBe(403);
    });
  });

  describe('GET /api/v1/held-sale-carts/:id', () => {
    it('reads under held_sale.manage and rejects without it', async () => {
      const allowed = await fixture(['held_sale.manage']);
      const ok = await allowed.app.inject({
        method: 'GET',
        url: `/api/v1/held-sale-carts/${cartId}`,
        headers: { authorization: 'Bearer token' },
      });
      expect(ok.statusCode).toBe(200);

      const denied = await fixture([]);
      const rejected = await denied.app.inject({
        method: 'GET',
        url: `/api/v1/held-sale-carts/${cartId}`,
        headers: { authorization: 'Bearer token' },
      });
      expect(rejected.statusCode).toBe(403);
    });
  });

  describe('POST /api/v1/held-sale-carts/:id/resume', () => {
    it('resumes under held_sale.manage and rejects without it', async () => {
      const allowed = await fixture(['held_sale.manage']);
      const ok = await allowed.app.inject({
        method: 'POST',
        url: `/api/v1/held-sale-carts/${cartId}/resume`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'held-resume-1' },
      });
      expect(ok.statusCode).toBe(200);
      // TASK 14.3A: resuming (claimed), not the terminal resumed state.
      expect(ok.json()).toMatchObject({ data: { status: 'resuming' } });

      const denied = await fixture([]);
      const rejected = await denied.app.inject({
        method: 'POST',
        url: `/api/v1/held-sale-carts/${cartId}/resume`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'held-resume-1' },
      });
      expect(rejected.statusCode).toBe(403);
      expect(denied.service.resumeCart).not.toHaveBeenCalled();
    });

    it('requires an Idempotency-Key header', async () => {
      const { app } = await fixture(['held_sale.manage']);
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/held-sale-carts/${cartId}/resume`,
        headers: { authorization: 'Bearer token' },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /api/v1/held-sale-carts/:id/link-sale', () => {
    it('links under held_sale.manage and rejects without it', async () => {
      const allowed = await fixture(['held_sale.manage']);
      const ok = await allowed.app.inject({
        method: 'POST',
        url: `/api/v1/held-sale-carts/${cartId}/link-sale`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'held-link-1' },
        payload: { sale_id: '00000000-0000-7000-8000-000000000099' },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({ data: { resumed_sale_id: '00000000-0000-7000-8000-000000000099' } });

      const denied = await fixture([]);
      const rejected = await denied.app.inject({
        method: 'POST',
        url: `/api/v1/held-sale-carts/${cartId}/link-sale`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'held-link-1' },
        payload: { sale_id: '00000000-0000-7000-8000-000000000099' },
      });
      expect(rejected.statusCode).toBe(403);
      expect(denied.service.linkSale).not.toHaveBeenCalled();
    });

    it('requires sale_id in the body', async () => {
      const { app, service } = await fixture(['held_sale.manage']);
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/held-sale-carts/${cartId}/link-sale`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'held-link-2' },
        payload: {},
      });
      expect(response.statusCode).toBe(400);
      expect(service.linkSale).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/v1/held-sale-carts/:id/release', () => {
    it('releases under held_sale.manage and rejects without it', async () => {
      const allowed = await fixture(['held_sale.manage']);
      const ok = await allowed.app.inject({
        method: 'POST',
        url: `/api/v1/held-sale-carts/${cartId}/release`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'held-release-1' },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({ data: { status: 'held' } });

      const denied = await fixture([]);
      const rejected = await denied.app.inject({
        method: 'POST',
        url: `/api/v1/held-sale-carts/${cartId}/release`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'held-release-1' },
      });
      expect(rejected.statusCode).toBe(403);
      expect(denied.service.releaseCart).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/v1/held-sale-carts/:id/discard', () => {
    it('discards under held_sale.manage and rejects without it', async () => {
      const allowed = await fixture(['held_sale.manage']);
      const ok = await allowed.app.inject({
        method: 'POST',
        url: `/api/v1/held-sale-carts/${cartId}/discard`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'held-discard-1' },
        payload: { reason: 'cliente se fue' },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({ data: { status: 'discarded' } });

      const denied = await fixture([]);
      const rejected = await denied.app.inject({
        method: 'POST',
        url: `/api/v1/held-sale-carts/${cartId}/discard`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'held-discard-1' },
        payload: { reason: 'cliente se fue' },
      });
      expect(rejected.statusCode).toBe(403);
      expect(denied.service.discardCart).not.toHaveBeenCalled();
    });

    it('accepts a discard with no reason at all (optional field)', async () => {
      const { app, service } = await fixture(['held_sale.manage']);
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/held-sale-carts/${cartId}/discard`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'held-discard-2' },
        payload: {},
      });
      expect(response.statusCode).toBe(200);
      expect(service.discardCart).toHaveBeenCalledTimes(1);
    });
  });
});
