import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@asone/errors';

import type { AuthService } from '../auth/auth.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import type { PaymentService } from '../payments/payments.service.js';
import { registerSaleRoutes } from './sales.routes.js';
import type { SalesService } from './sales.service.js';

const companyId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const branchId = '00000000-0000-4000-8000-000000000003';
const saleId = '00000000-0000-7000-8000-000000000004';
const productId = '00000000-0000-4000-8000-000000000005';
const apps: FastifyInstance[] = [];

function saleValue(): Readonly<Record<string, unknown>> {
  return {
    id: saleId,
    branchId,
    cashRegisterId: null,
    cashSessionId: null,
    deviceId: null,
    saleNumber: `SALE-${saleId.replaceAll('-', '')}`,
    status: 'pending_payment',
    currencyCode: 'MXN',
    subtotal: '40.0000',
    discountTotal: '0.0000',
    taxTotal: '6.4000',
    total: '46.4000',
    paidTotal: '0.0000',
    changeTotal: '0.0000',
    occurredAt: new Date('2026-08-01T00:00:00.000Z'),
    completedAt: null,
    cancelledAt: null,
    cancelledBy: null,
    reasonCode: null,
    version: 1n,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}
function saleItemValue(): Readonly<Record<string, unknown>> {
  return {
    id: '00000000-0000-7000-8000-000000000006',
    saleId,
    lineNumber: 1,
    productId,
    productVersion: 1n,
    skuSnapshot: 'SKU-1',
    nameSnapshot: 'Product',
    quantity: '1.000000',
    unitPrice: '40.0000',
    subtotal: '40.0000',
    discountTotal: '0.0000',
    taxTotal: '6.4000',
    lineTotal: '46.4000',
    taxSnapshot: { tax_code: 'IVA_GENERAL', basis_points: 1600 },
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

// TASK 12.5B.
function organizationValue(): Readonly<Record<string, unknown>> {
  return {
    companyName: 'Payments Co.',
    branchName: 'Main',
    branchAddress: null,
    cashierId: userId,
    cashierName: 'Cash Ier',
  };
}
function cashPaymentValue(): Readonly<Record<string, unknown>> {
  return {
    id: '00000000-0000-7000-8000-000000000007',
    companyId,
    branchId,
    saleId,
    paymentMethod: 'cash',
    amount: '46.4000',
    currencyCode: 'MXN',
    provider: null,
    terminalId: null,
    status: 'captured',
    reasonCode: null,
    metadata: { tendered_amount: '50.0000', change_amount: '3.6000' },
    createdBy: userId,
    authorizedAt: null,
    capturedAt: new Date('2026-08-01T00:05:00.000Z'),
    failedAt: null,
    reversedAt: null,
    version: 2n,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:05:00.000Z'),
  };
}

async function fixture(
  permissions: string[],
  paymentsOverride?: Readonly<Record<string, unknown>>[],
): Promise<{
  app: FastifyInstance;
  service: Record<string, ReturnType<typeof vi.fn>>;
  paymentService: Record<string, ReturnType<typeof vi.fn>>;
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
    createSale: vi.fn(() =>
      Promise.resolve({ value: { sale: saleValue(), items: [saleItemValue()] }, replayed: false }),
    ),
    sale: vi.fn(() => Promise.resolve({ sale: saleValue(), items: [saleItemValue()] })),
    cancelSale: vi.fn(() => Promise.resolve({ value: saleValue(), replayed: false })),
    receiptOrganization: vi.fn(() => Promise.resolve(organizationValue())),
    // TASK 12.6 Part B.
    listSales: vi.fn(() => Promise.resolve({ items: [saleValue()], nextCursor: null })),
    listSummaries: vi.fn(() =>
      Promise.resolve(
        new Map([[saleId, { branchName: 'Main', cashierName: 'Cash Ier', itemCount: 1, paymentMethods: ['cash'] }]]),
      ),
    ),
  };
  const paymentService = {
    listPayments: vi.fn(() =>
      Promise.resolve({ items: paymentsOverride ?? [cashPaymentValue()], nextCursor: null }),
    ),
    payment: vi.fn(() => Promise.resolve({ payment: cashPaymentValue(), attempts: [] })),
  };
  registerSaleRoutes(
    app,
    authentication,
    service as unknown as SalesService,
    paymentService as unknown as PaymentService,
  );
  await app.ready();
  return { app, service, paymentService };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe('sale HTTP routes (TASK 12.4A.1)', () => {
  it('creates a sale under sale.create and rejects without it', async () => {
    const allowed = await fixture(['sale.create']);
    const ok = await allowed.app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: { authorization: 'Bearer token', 'idempotency-key': 'sale-1' },
      payload: { branch_id: branchId, items: [{ product_id: productId, quantity: '1' }] },
    });
    expect(ok.statusCode).toBe(201);
    expect(allowed.service.createSale).toHaveBeenCalledTimes(1);

    const denied = await fixture(['sale.read']);
    const rejected = await denied.app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: { authorization: 'Bearer token', 'idempotency-key': 'sale-1' },
      payload: { branch_id: branchId, items: [{ product_id: productId, quantity: '1' }] },
    });
    expect(rejected.statusCode).toBe(403);
    expect(denied.service.createSale).not.toHaveBeenCalled();
  });

  it('rejects a sale for a branch the actor cannot access', async () => {
    const { app } = await fixture(['sale.create']);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: { authorization: 'Bearer token', 'idempotency-key': 'sale-branch' },
      payload: {
        branch_id: '00000000-0000-4000-8000-00000000ffff',
        items: [{ product_id: productId, quantity: '1' }],
      },
    });
    expect(response.statusCode).toBe(403);
  });

  it('rejects an empty item list at the schema boundary before it ever reaches the service', async () => {
    const { app, service } = await fixture(['sale.create']);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: { authorization: 'Bearer token', 'idempotency-key': 'sale-empty' },
      payload: { branch_id: branchId, items: [] },
    });
    expect(response.statusCode).toBe(400);
    expect(service.createSale).not.toHaveBeenCalled();
  });

  it('reads a sale under sale.read and rejects without it', async () => {
    const allowed = await fixture(['sale.read']);
    const ok = await allowed.app.inject({
      method: 'GET',
      url: `/api/v1/sales/${saleId}`,
      headers: { authorization: 'Bearer token' },
    });
    expect(ok.statusCode).toBe(200);
    expect(allowed.service.sale).toHaveBeenCalledTimes(1);
    expect(ok.json()).toMatchObject({ data: { items: [expect.anything()] } });

    const denied = await fixture(['sale.create']);
    const rejected = await denied.app.inject({
      method: 'GET',
      url: `/api/v1/sales/${saleId}`,
      headers: { authorization: 'Bearer token' },
    });
    expect(rejected.statusCode).toBe(403);
  });

  it('reads a receipt under sale.read (same permission as sale detail) and rejects without it', async () => {
    const allowed = await fixture(['sale.read']);
    const ok = await allowed.app.inject({
      method: 'GET',
      url: `/api/v1/sales/${saleId}/receipt`,
      headers: { authorization: 'Bearer token' },
    });
    expect(ok.statusCode).toBe(200);
    expect(allowed.service.sale).toHaveBeenCalledTimes(1);
    expect(allowed.service.receiptOrganization).toHaveBeenCalledTimes(1);
    expect(allowed.paymentService.listPayments).toHaveBeenCalledTimes(1);
    expect(ok.json()).toMatchObject({
      data: {
        sale: { id: saleId, sale_number: `SALE-${saleId.replaceAll('-', '')}`, total: '46.4000' },
        business: { company_name: 'Payments Co.', branch_name: 'Main' },
        cashier: { id: userId, display_name: 'Cash Ier' },
        items: [{ name_snapshot: 'Product', quantity: '1.000000' }],
        payments: [
          {
            payment_method: 'cash',
            status: 'captured',
            amount: '46.4000',
            tendered_amount: '50.0000',
            change_amount: '3.6000',
            provider: null,
            provider_reference: null,
          },
        ],
      },
    });

    const denied = await fixture(['sale.create']);
    const rejected = await denied.app.inject({
      method: 'GET',
      url: `/api/v1/sales/${saleId}/receipt`,
      headers: { authorization: 'Bearer token' },
    });
    expect(rejected.statusCode).toBe(403);
  });

  it("never fetches attempt data for a cash payment's receipt line, and fetches it only for a card_terminal payment", async () => {
    const cardPayment = {
      ...cashPaymentValue(),
      id: '00000000-0000-7000-8000-000000000009',
      paymentMethod: 'card_terminal',
      provider: 'mercado_pago',
      terminalId: '00000000-0000-7000-8000-00000000000a',
      metadata: null,
    };
    const { app, paymentService } = await fixture(['sale.read'], [cashPaymentValue(), cardPayment]);
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/sales/${saleId}/receipt`,
      headers: { authorization: 'Bearer token' },
    });
    expect(response.statusCode).toBe(200);
    // Exactly one `payment()` lookup — for the card_terminal leg only.
    expect(paymentService.payment).toHaveBeenCalledTimes(1);
    expect(paymentService.payment).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      cardPayment.id,
    );
  });

  it('cancels a sale under sale.cancel and rejects without it', async () => {
    const allowed = await fixture(['sale.cancel']);
    const ok = await allowed.app.inject({
      method: 'POST',
      url: `/api/v1/sales/${saleId}/cancellations`,
      headers: { authorization: 'Bearer token', 'idempotency-key': 'sale-cancel-1' },
      payload: { reason_code: 'customer_changed_mind' },
    });
    expect(ok.statusCode).toBe(200);
    expect(allowed.service.cancelSale).toHaveBeenCalledTimes(1);

    const denied = await fixture(['sale.create']);
    const rejected = await denied.app.inject({
      method: 'POST',
      url: `/api/v1/sales/${saleId}/cancellations`,
      headers: { authorization: 'Bearer token', 'idempotency-key': 'sale-cancel-1' },
      payload: { reason_code: 'customer_changed_mind' },
    });
    expect(rejected.statusCode).toBe(403);
  });

  it('returns idempotency-replayed header when the service reports a replay', async () => {
    const { app, service } = await fixture(['sale.create']);
    service.createSale?.mockResolvedValueOnce({
      value: { sale: saleValue(), items: [saleItemValue()] },
      replayed: true,
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: { authorization: 'Bearer token', 'idempotency-key': 'sale-replay' },
      payload: { branch_id: branchId, items: [{ product_id: productId, quantity: '1' }] },
    });
    expect(response.statusCode).toBe(201);
    expect(response.headers['idempotency-replayed']).toBe('true');
  });

  it('requires an Idempotency-Key header on every mutation route', async () => {
    const { app } = await fixture(['sale.create']);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: { authorization: 'Bearer token' },
      payload: { branch_id: branchId, items: [{ product_id: productId, quantity: '1' }] },
    });
    expect(response.statusCode).toBe(400);
  });

  // TASK 12.6 Part B (E075).
  describe('GET /api/v1/sales — sales history list', () => {
    it('lists under sale.read and rejects without it', async () => {
      const allowed = await fixture(['sale.read']);
      const ok = await allowed.app.inject({
        method: 'GET',
        url: '/api/v1/sales',
        headers: { authorization: 'Bearer token' },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({
        data: [expect.objectContaining({ id: saleId, branch_name: 'Main', payment_methods: ['cash'] })],
      });
      expect(allowed.service.listSales).toHaveBeenCalledTimes(1);
      expect(allowed.service.listSummaries).toHaveBeenCalledTimes(1);

      const denied = await fixture(['sale.create']);
      const rejected = await denied.app.inject({
        method: 'GET',
        url: '/api/v1/sales',
        headers: { authorization: 'Bearer token' },
      });
      expect(rejected.statusCode).toBe(403);
      expect(denied.service.listSales).not.toHaveBeenCalled();
    });

    it('rejects a branch_id filter outside the authorized branch list — never trusted client-side', async () => {
      const { app, service } = await fixture(['sale.read']);
      const rejected = await app.inject({
        method: 'GET',
        url: `/api/v1/sales?branch_id=${'0'.repeat(8)}-0000-4000-8000-000000000099`,
        headers: { authorization: 'Bearer token' },
      });
      expect(rejected.statusCode).toBe(403);
      expect(service.listSales).not.toHaveBeenCalled();
    });

    it('passes every documented filter straight through to the service, and defaults limit to 50', async () => {
      const { app, service } = await fixture(['sale.read']);
      const response = await app.inject({
        method: 'GET',
        url:
          `/api/v1/sales?branch_id=${branchId}&status=completed&occurred_from=2026-08-01T00:00:00.000Z` +
          `&occurred_to=2026-08-31T00:00:00.000Z&created_by=${userId}&sale_number=SALE-abc&payment_method=cash&cursor=abc`,
        headers: { authorization: 'Bearer token' },
      });
      expect(response.statusCode).toBe(200);
      expect(service.listSales).toHaveBeenCalledWith(companyId, [branchId], {
        limit: 50,
        cursor: 'abc',
        branchId,
        status: 'completed',
        occurredFrom: new Date('2026-08-01T00:00:00.000Z'),
        occurredTo: new Date('2026-08-31T00:00:00.000Z'),
        createdBy: userId,
        saleNumber: 'SALE-abc',
        paymentMethod: 'cash',
      });
    });

    it('rejects an unknown query parameter and an out-of-range limit', async () => {
      const { app } = await fixture(['sale.read']);
      const unknownParam = await app.inject({
        method: 'GET',
        url: '/api/v1/sales?register_id=not-a-documented-filter',
        headers: { authorization: 'Bearer token' },
      });
      expect(unknownParam.statusCode).toBe(400);
      const outOfRangeLimit = await app.inject({
        method: 'GET',
        url: '/api/v1/sales?limit=1000',
        headers: { authorization: 'Bearer token' },
      });
      expect(outOfRangeLimit.statusCode).toBe(400);
    });

    it('is read-only — never calls a mutation method on the service', async () => {
      const { app, service } = await fixture(['sale.read']);
      await app.inject({ method: 'GET', url: '/api/v1/sales', headers: { authorization: 'Bearer token' } });
      expect(service.createSale).not.toHaveBeenCalled();
      expect(service.cancelSale).not.toHaveBeenCalled();
    });
  });
});
