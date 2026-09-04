import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@asone/errors';

import type { AuthService } from '../auth/auth.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import type { SalesService } from '../sales/sales.service.js';
import { registerPaymentRoutes } from './payments.routes.js';
import type { PaymentService } from './payments.service.js';

const companyId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const branchId = '00000000-0000-4000-8000-000000000003';
const paymentId = '00000000-0000-7000-8000-000000000004';
const attemptId = '00000000-0000-7000-8000-000000000005';
const terminalId = '00000000-0000-7000-8000-000000000006';
const deviceId = '00000000-0000-4000-8000-000000000007';
const saleId = '00000000-0000-7000-8000-000000000008';
const apps: FastifyInstance[] = [];

function saleValue(): Readonly<Record<string, unknown>> {
  return {
    id: saleId,
    branchId,
    saleNumber: `SALE-${saleId.replaceAll('-', '')}`,
    status: 'pending_payment',
    currencyCode: 'MXN',
    subtotal: '10.0000',
    discountTotal: '0.0000',
    taxTotal: '0.0000',
    total: '10.0000',
    version: 1n,
  };
}

// TASK 12.5A: the full `SaleRow`-shaped value `PaymentService.createCashPayment`
// itself returns (unlike `saleValue()` above, which only mocks the flat
// shape the nested E078 route reads off `SalesService.sale`) — every
// field `saleReceiptHttp` reads (including the `Date` objects it calls
// `.toISOString()` on) must be present.
function cashSaleValue(): Readonly<Record<string, unknown>> {
  return {
    id: saleId,
    companyId,
    branchId,
    cashRegisterId: null,
    cashSessionId: null,
    deviceId: null,
    syncOperationId: null,
    saleNumber: `SALE-${saleId.replaceAll('-', '')}`,
    status: 'completed',
    currencyCode: 'MXN',
    subtotal: '10.0000',
    discountTotal: '0.0000',
    taxTotal: '0.0000',
    total: '10.0000',
    paidTotal: '0.0000',
    changeTotal: '0.0000',
    occurredAt: new Date('2026-08-01T00:00:00.000Z'),
    completedAt: new Date('2026-08-01T00:00:05.000Z'),
    cancelledAt: null,
    cancelledBy: null,
    reasonCode: null,
    createdBy: userId,
    version: 2n,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:05.000Z'),
  };
}
function terminalValue(): Readonly<Record<string, unknown>> {
  return {
    id: terminalId,
    companyId,
    branchId,
    deviceId,
    provider: 'unassigned',
    providerTerminalId: null,
    capabilities: null,
    status: 'assigned',
    version: 1n,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}
function paymentValue(): Readonly<Record<string, unknown>> {
  return {
    id: paymentId,
    companyId,
    branchId,
    saleId,
    paymentMethod: 'cash',
    amount: '10.0000',
    currencyCode: 'MXN',
    provider: null,
    terminalId: null,
    status: 'pending',
    reasonCode: null,
    metadata: null,
    createdBy: userId,
    authorizedAt: null,
    capturedAt: null,
    failedAt: null,
    reversedAt: null,
    version: 1n,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}
function attemptValue(): Readonly<Record<string, unknown>> {
  return {
    id: attemptId,
    companyId,
    paymentId,
    attemptNumber: 1,
    terminalId: null,
    status: 'created',
    providerReference: null,
    declineReason: null,
    metadata: null,
    requestedAt: new Date('2026-08-01T00:00:00.000Z'),
    respondedAt: null,
    version: 1n,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

async function fixture(permissions: string[]): Promise<{
  app: FastifyInstance;
  service: Record<string, ReturnType<typeof vi.fn>>;
  salesService: Record<string, ReturnType<typeof vi.fn>>;
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
    createTerminal: vi.fn(() => Promise.resolve({ value: terminalValue(), replayed: false })),
    terminal: vi.fn(() => Promise.resolve(terminalValue())),
    listTerminals: vi.fn(() => Promise.resolve({ items: [terminalValue()], nextCursor: null })),
    createPayment: vi.fn(() =>
      Promise.resolve({ value: { payment: paymentValue(), attempt: attemptValue() }, replayed: false }),
    ),
    createCashPayment: vi.fn(() =>
      Promise.resolve({
        value: {
          payment: { ...paymentValue(), status: 'captured', amount: '10.0000' },
          attempt: { ...attemptValue(), status: 'approved', respondedAt: new Date('2026-08-01T00:00:05.000Z') },
          sale: cashSaleValue(),
          tenderedAmount: '20.0000',
          changeAmount: '10.0000',
        },
        replayed: false,
      }),
    ),
    payment: vi.fn(() => Promise.resolve({ payment: paymentValue(), attempts: [attemptValue()] })),
    listPayments: vi.fn(() => Promise.resolve({ items: [paymentValue()], nextCursor: null })),
    retryAttempt: vi.fn(() => Promise.resolve({ value: attemptValue(), replayed: false })),
    transitionAttempt: vi.fn(() => Promise.resolve({ value: attemptValue(), replayed: false })),
    cancelPayment: vi.fn(() => Promise.resolve({ value: paymentValue(), replayed: false })),
    reversePayment: vi.fn(() => Promise.resolve({ value: paymentValue(), replayed: false })),
  };
  const salesService = {
    sale: vi.fn(() => Promise.resolve({ sale: saleValue(), items: [] })),
  };
  registerPaymentRoutes(
    app,
    authentication,
    service as unknown as PaymentService,
    salesService as unknown as SalesService,
  );
  await app.ready();
  return { app, service, salesService };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe('payment and terminal HTTP routes (TASK 12.4A)', () => {
  it('registers a terminal under device.register and rejects without it', async () => {
    const allowed = await fixture(['device.register']);
    const ok = await allowed.app.inject({
      method: 'POST',
      url: '/api/v1/payment-terminals',
      headers: { authorization: 'Bearer token', 'idempotency-key': 'terminal-1' },
      payload: { branch_id: branchId, device_id: deviceId },
    });
    expect(ok.statusCode).toBe(201);
    expect(allowed.service.createTerminal).toHaveBeenCalledTimes(1);

    const denied = await fixture(['payment.create']);
    const rejected = await denied.app.inject({
      method: 'POST',
      url: '/api/v1/payment-terminals',
      headers: { authorization: 'Bearer token', 'idempotency-key': 'terminal-1' },
      payload: { branch_id: branchId, device_id: deviceId },
    });
    expect(rejected.statusCode).toBe(403);
    expect(denied.service.createTerminal).not.toHaveBeenCalled();
  });

  it('lists and reads terminals under device.read', async () => {
    const { app, service } = await fixture(['device.read']);
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/payment-terminals',
      headers: { authorization: 'Bearer token' },
    });
    expect(list.statusCode).toBe(200);
    expect(service.listTerminals).toHaveBeenCalledTimes(1);
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/payment-terminals/${terminalId}`,
      headers: { authorization: 'Bearer token' },
    });
    expect(detail.statusCode).toBe(200);
  });

  it('creates a payment under payment.create and rejects without it', async () => {
    const allowed = await fixture(['payment.create']);
    const ok = await allowed.app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: { authorization: 'Bearer token', 'idempotency-key': 'payment-1' },
      payload: {
        branch_id: branchId,
        sale_id: saleId,
        payment_method: 'cash',
        amount: '10.00',
        currency_code: 'MXN',
      },
    });
    expect(ok.statusCode).toBe(201);
    expect(allowed.service.createPayment).toHaveBeenCalledTimes(1);
    expect(allowed.service.createPayment).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ saleId }),
    );

    const denied = await fixture(['payment.read']);
    const rejected = await denied.app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: { authorization: 'Bearer token', 'idempotency-key': 'payment-1' },
      payload: {
        branch_id: branchId,
        sale_id: saleId,
        payment_method: 'cash',
        amount: '10.00',
        currency_code: 'MXN',
      },
    });
    expect(rejected.statusCode).toBe(403);
  });

  it('rejects a payment for a branch the actor cannot access', async () => {
    const { app } = await fixture(['payment.create']);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: { authorization: 'Bearer token', 'idempotency-key': 'payment-branch' },
      payload: {
        branch_id: '00000000-0000-4000-8000-00000000ffff',
        sale_id: saleId,
        payment_method: 'cash',
        amount: '10.00',
        currency_code: 'MXN',
      },
    });
    expect(response.statusCode).toBe(403);
  });

  it('creates a payment via the nested E078 route, resolving branch_id from the sale itself', async () => {
    const { app, service, salesService } = await fixture(['payment.create']);
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/sales/${saleId}/payments`,
      headers: { authorization: 'Bearer token', 'idempotency-key': 'sale-payment-1' },
      payload: { payment_method: 'cash', amount: '10.00', currency_code: 'MXN' },
    });
    expect(response.statusCode).toBe(201);
    expect(salesService.sale).toHaveBeenCalledTimes(1);
    expect(service.createPayment).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ saleId, branchId }),
    );
  });

  it('reads and lists payments under payment.read', async () => {
    const { app, service } = await fixture(['payment.read']);
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/payments/${paymentId}`,
      headers: { authorization: 'Bearer token' },
    });
    expect(detail.statusCode).toBe(200);
    expect(service.payment).toHaveBeenCalledTimes(1);
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/payments',
      headers: { authorization: 'Bearer token' },
    });
    expect(list.statusCode).toBe(200);
  });

  it('records a retry attempt and an attempt transition under payment.create', async () => {
    const { app, service } = await fixture(['payment.create']);
    const retry = await app.inject({
      method: 'POST',
      url: `/api/v1/payments/${paymentId}/attempts`,
      headers: { authorization: 'Bearer token', 'idempotency-key': 'retry-1' },
    });
    expect(retry.statusCode).toBe(201);
    expect(service.retryAttempt).toHaveBeenCalledTimes(1);
    const transition = await app.inject({
      method: 'POST',
      url: `/api/v1/payment-attempts/${attemptId}/transitions`,
      headers: { authorization: 'Bearer token', 'idempotency-key': 'transition-1' },
      payload: { status: 'approved' },
    });
    expect(transition.statusCode).toBe(200);
    expect(service.transitionAttempt).toHaveBeenCalledTimes(1);
  });

  it('rejects an unrecognized attempt status at the schema boundary before it ever reaches the service', async () => {
    const { app, service } = await fixture(['payment.create']);
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/payment-attempts/${attemptId}/transitions`,
      headers: { authorization: 'Bearer token', 'idempotency-key': 'transition-bad' },
      payload: { status: 'not_a_real_status' },
    });
    expect(response.statusCode).toBe(400);
    expect(service.transitionAttempt).not.toHaveBeenCalled();
  });

  it('cancels a payment under payment.create', async () => {
    const { app, service } = await fixture(['payment.create']);
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/payments/${paymentId}/cancellations`,
      headers: { authorization: 'Bearer token', 'idempotency-key': 'cancel-1' },
      payload: { reason_code: 'customer_changed_mind' },
    });
    expect(response.statusCode).toBe(200);
    expect(service.cancelPayment).toHaveBeenCalledTimes(1);
  });

  it('reverses a payment under payment.reverse — payment.create alone is not enough', async () => {
    const allowed = await fixture(['payment.reverse']);
    const ok = await allowed.app.inject({
      method: 'POST',
      url: `/api/v1/payments/${paymentId}/reversals`,
      headers: { authorization: 'Bearer token', 'idempotency-key': 'reverse-1' },
      payload: { reason_code: 'operator_error' },
    });
    expect(ok.statusCode).toBe(200);
    expect(allowed.service.reversePayment).toHaveBeenCalledTimes(1);

    const denied = await fixture(['payment.create']);
    const rejected = await denied.app.inject({
      method: 'POST',
      url: `/api/v1/payments/${paymentId}/reversals`,
      headers: { authorization: 'Bearer token', 'idempotency-key': 'reverse-1' },
      payload: { reason_code: 'operator_error' },
    });
    expect(rejected.statusCode).toBe(403);
  });

  it('returns idempotency-replayed header when the service reports a replay', async () => {
    const { app, service } = await fixture(['payment.create']);
    service.createPayment?.mockResolvedValueOnce({
      value: { payment: paymentValue(), attempt: attemptValue() },
      replayed: true,
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: { authorization: 'Bearer token', 'idempotency-key': 'payment-replay' },
      payload: {
        branch_id: branchId,
        sale_id: saleId,
        payment_method: 'cash',
        amount: '10.00',
        currency_code: 'MXN',
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.headers['idempotency-replayed']).toBe('true');
  });

  it('requires an Idempotency-Key header on every mutation route', async () => {
    const { app } = await fixture(['payment.create']);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: { authorization: 'Bearer token' },
      payload: {
        branch_id: branchId,
        sale_id: saleId,
        payment_method: 'cash',
        amount: '10.00',
        currency_code: 'MXN',
      },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('cash payment HTTP route (TASK 12.5A)', () => {
  it('records a cash payment under payment.create — the same permission as every other payment method — and rejects without it', async () => {
    const allowed = await fixture(['payment.create']);
    const ok = await allowed.app.inject({
      method: 'POST',
      url: `/api/v1/sales/${saleId}/cash-payments`,
      headers: { authorization: 'Bearer token', 'idempotency-key': 'cash-route-1' },
      payload: { tendered_amount: '20.00' },
    });
    expect(ok.statusCode).toBe(201);
    expect(allowed.service.createCashPayment).toHaveBeenCalledTimes(1);
    expect(allowed.service.createCashPayment).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ saleId, tenderedAmount: '20.00' }),
    );
    expect(ok.json()).toMatchObject({
      data: {
        status: 'captured',
        tendered_amount: '20.0000',
        change_amount: '10.0000',
        sale: { id: saleId, status: 'completed', items: [] },
      },
    });

    const denied = await fixture(['payment.read']);
    const rejected = await denied.app.inject({
      method: 'POST',
      url: `/api/v1/sales/${saleId}/cash-payments`,
      headers: { authorization: 'Bearer token', 'idempotency-key': 'cash-route-1' },
      payload: { tendered_amount: '20.00' },
    });
    expect(rejected.statusCode).toBe(403);
    expect(denied.service.createCashPayment).not.toHaveBeenCalled();
  });

  it('requires an Idempotency-Key header', async () => {
    const { app, service } = await fixture(['payment.create']);
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/sales/${saleId}/cash-payments`,
      headers: { authorization: 'Bearer token' },
      payload: { tendered_amount: '20.00' },
    });
    expect(response.statusCode).toBe(400);
    expect(service.createCashPayment).not.toHaveBeenCalled();
  });

  it('rejects a request with no tendered_amount at the schema boundary before it ever reaches the service', async () => {
    const { app, service } = await fixture(['payment.create']);
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/sales/${saleId}/cash-payments`,
      headers: { authorization: 'Bearer token', 'idempotency-key': 'cash-route-missing-amount' },
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(service.createCashPayment).not.toHaveBeenCalled();
  });

  it('returns idempotency-replayed header when the service reports a replay', async () => {
    const { app, service } = await fixture(['payment.create']);
    service.createCashPayment?.mockResolvedValueOnce({
      value: {
        payment: { ...paymentValue(), status: 'captured' },
        attempt: { ...attemptValue(), status: 'approved' },
        sale: cashSaleValue(),
        tenderedAmount: '20.0000',
        changeAmount: '10.0000',
      },
      replayed: true,
    });
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/sales/${saleId}/cash-payments`,
      headers: { authorization: 'Bearer token', 'idempotency-key': 'cash-route-replay' },
      payload: { tendered_amount: '20.00' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.headers['idempotency-replayed']).toBe('true');
  });

  it('never accepts a client-supplied amount/total field — the schema has no such property', async () => {
    const { app, service } = await fixture(['payment.create']);
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/sales/${saleId}/cash-payments`,
      headers: { authorization: 'Bearer token', 'idempotency-key': 'cash-route-no-amount-field' },
      payload: { tendered_amount: '20.00', amount: '1.00', total: '1.00' },
    });
    // `additionalProperties: false` rejects the extra fields outright.
    expect(response.statusCode).toBe(400);
    expect(service.createCashPayment).not.toHaveBeenCalled();
  });
});
