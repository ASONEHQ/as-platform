import { createHmac } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerRequestContext } from '../../../plugins/request-context.js';
import type { PaymentService } from '../payments.service.js';
import { PaymentError } from '../payments.types.js';
import { registerMercadoPagoWebhookRoutes } from './mercado-pago.webhook.routes.js';
import type { PaymentProvider, ProviderOrderSnapshot } from './payment-provider.js';

const secret = 'test-webhook-secret';
const apps: FastifyInstance[] = [];

function sign(dataId: string, requestId: string, ts: string): string {
  const template = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  return createHmac('sha256', secret).update(template).digest('hex');
}

function order(overrides: Partial<ProviderOrderSnapshot> = {}): ProviderOrderSnapshot {
  return {
    providerOrderId: 'ORD00001',
    orderStatus: 'created',
    orderStatusDetail: 'created',
    transactionId: null,
    transactionStatus: null,
    transactionStatusDetail: null,
    paidAmount: null,
    currencyCode: null,
    raw: {},
    ...overrides,
  };
}

function attempt(status: string, id = 'attempt-1'): Readonly<Record<string, unknown>> {
  return {
    id,
    companyId: 'company-1',
    paymentId: 'payment-1',
    attemptNumber: 1,
    terminalId: 'terminal-1',
    status,
    providerReference: null,
    declineReason: null,
    metadata: null,
    requestedAt: new Date(),
    respondedAt: null,
    version: 1n,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function fixture(options?: {
  ownerResult?: { attemptId: string; companyId: string; branchId: string; paymentId: string; amount: string; currencyCode: string } | null;
  getOrderResult?: ProviderOrderSnapshot;
  currentAttemptStatus?: string;
  transitionError?: Error;
}): Promise<{
  app: FastifyInstance;
  paymentService: { attemptOwnerByProviderReference: ReturnType<typeof vi.fn>; payment: ReturnType<typeof vi.fn>; transitionAttempt: ReturnType<typeof vi.fn> };
  mercadoPagoProvider: { getOrder: ReturnType<typeof vi.fn> };
}> {
  const app = Fastify();
  apps.push(app);
  registerRequestContext(app);
  const owner =
    options?.ownerResult === undefined
      ? {
          attemptId: 'attempt-1',
          companyId: 'company-1',
          branchId: 'branch-1',
          paymentId: 'payment-1',
          amount: '149.5000',
          currencyCode: 'MXN',
        }
      : options.ownerResult;
  const paymentService = {
    attemptOwnerByProviderReference: vi.fn(() => Promise.resolve(owner)),
    payment: vi.fn(() =>
      Promise.resolve({
        payment: { id: 'payment-1' },
        attempts: [attempt(options?.currentAttemptStatus ?? 'awaiting_terminal')],
      }),
    ),
    transitionAttempt: vi.fn(() => {
      if (options?.transitionError !== undefined) throw options.transitionError;
      return Promise.resolve({ value: attempt('approved'), replayed: false });
    }),
  };
  const mercadoPagoProvider = {
    getOrder: vi.fn(() => Promise.resolve(options?.getOrderResult ?? order())),
  };
  registerMercadoPagoWebhookRoutes(app, {
    // Test doubles implement only the subset of methods this route
    // actually calls — the same `as unknown as <Type>` pattern already
    // established by payments.routes.test.ts/sales.routes.test.ts.
    paymentService: paymentService as unknown as PaymentService,
    mercadoPagoProvider: mercadoPagoProvider as unknown as PaymentProvider,
    webhookSecret: secret,
  });
  await app.ready();
  return { app, paymentService, mercadoPagoProvider };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

function webhookPayload(dataId: string, action = 'order.action_required'): string {
  return JSON.stringify({ action, type: 'order', data: { id: dataId } });
}

describe('POST /api/v1/webhooks/mercado-pago', () => {
  it('rejects a request with no valid signature', async () => {
    const { app } = await fixture();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/mercado-pago',
      headers: { 'content-type': 'application/json' },
      payload: webhookPayload('ORD00001'),
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects an invalid signature even with well-formed headers', async () => {
    const { app } = await fixture();
    const body = webhookPayload('ORD00001');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/mercado-pago',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req-1',
        'x-signature': 'ts=1700000000000,v1=deadbeef',
      },
      payload: body,
    });
    expect(response.statusCode).toBe(401);
  });

  it('accepts a valid signature, re-fetches the authoritative order, and applies processed+accredited as approved', async () => {
    const { app, mercadoPagoProvider, paymentService } = await fixture({
      getOrderResult: order({
        orderStatus: 'processed',
        orderStatusDetail: 'processed',
        transactionStatus: 'processed',
        transactionStatusDetail: 'accredited',
        paidAmount: '149.5000',
      }),
      currentAttemptStatus: 'awaiting_terminal',
    });
    const dataId = 'ORD00001';
    const ts = '1700000000000';
    const requestId = 'req-1';
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/mercado-pago',
      headers: {
        'content-type': 'application/json',
        'x-request-id': requestId,
        'x-signature': `ts=${ts},v1=${sign(dataId, requestId, ts)}`,
      },
      payload: webhookPayload(dataId, 'order.processed'),
    });
    expect(response.statusCode).toBe(200);
    expect(mercadoPagoProvider.getOrder).toHaveBeenCalledWith(dataId);
    expect(paymentService.transitionAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'company-1', actorType: 'system' }),
      ['branch-1'],
      'attempt-1',
      expect.any(String),
      expect.objectContaining({ status: 'approved', providerReference: dataId }),
    );
  });

  it('never approves a merely order-level "processed" order without transaction accreditation', async () => {
    const { app, paymentService } = await fixture({
      getOrderResult: order({
        orderStatus: 'processed',
        orderStatusDetail: 'partially_refunded',
        transactionStatus: 'processed',
        transactionStatusDetail: 'partially_refunded',
        paidAmount: '100.0000',
      }),
      currentAttemptStatus: 'awaiting_terminal',
    });
    const dataId = 'ORD00001';
    const ts = '1700000000000';
    const requestId = 'req-1';
    await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/mercado-pago',
      headers: {
        'content-type': 'application/json',
        'x-request-id': requestId,
        'x-signature': `ts=${ts},v1=${sign(dataId, requestId, ts)}`,
      },
      payload: webhookPayload(dataId),
    });
    const call = paymentService.transitionAttempt.mock.calls[0] as unknown[] | undefined;
    expect(call).toBeDefined();
    const input = call?.[4] as { status: string } | undefined;
    expect(input?.status).not.toBe('approved');
  });

  it('maps a declined/failed order to the declined attempt state with the provider status_detail preserved', async () => {
    const { app, paymentService } = await fixture({
      getOrderResult: order({
        orderStatus: 'failed',
        transactionStatus: 'failed',
        transactionStatusDetail: 'cc_rejected_insufficient_amount',
      }),
      currentAttemptStatus: 'processing',
    });
    const dataId = 'ORD00001';
    const ts = '1700000000000';
    const requestId = 'req-1';
    await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/mercado-pago',
      headers: {
        'content-type': 'application/json',
        'x-request-id': requestId,
        'x-signature': `ts=${ts},v1=${sign(dataId, requestId, ts)}`,
      },
      payload: webhookPayload(dataId, 'order.failed'),
    });
    expect(paymentService.transitionAttempt).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ status: 'declined', declineReason: 'cc_rejected_insufficient_amount' }),
    );
  });

  it('acknowledges (200) an unknown order without crashing or calling the provider unnecessarily', async () => {
    const { app, mercadoPagoProvider, paymentService } = await fixture({ ownerResult: null });
    const dataId = 'ORD-UNKNOWN';
    const ts = '1700000000000';
    const requestId = 'req-1';
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/mercado-pago',
      headers: {
        'content-type': 'application/json',
        'x-request-id': requestId,
        'x-signature': `ts=${ts},v1=${sign(dataId, requestId, ts)}`,
      },
      payload: webhookPayload(dataId),
    });
    expect(response.statusCode).toBe(200);
    expect(mercadoPagoProvider.getOrder).not.toHaveBeenCalled();
    expect(paymentService.transitionAttempt).not.toHaveBeenCalled();
  });

  it('treats a duplicate webhook for an already-terminal attempt as a safe no-op, never erroring', async () => {
    const { app, paymentService } = await fixture({
      getOrderResult: order({
        orderStatus: 'processed',
        transactionStatus: 'processed',
        transactionStatusDetail: 'accredited',
        paidAmount: '149.5000',
      }),
      currentAttemptStatus: 'approved',
    });
    const dataId = 'ORD00001';
    const ts = '1700000000000';
    const requestId = 'req-1';
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/mercado-pago',
      headers: {
        'content-type': 'application/json',
        'x-request-id': requestId,
        'x-signature': `ts=${ts},v1=${sign(dataId, requestId, ts)}`,
      },
      payload: webhookPayload(dataId, 'order.processed'),
    });
    expect(response.statusCode).toBe(200);
    expect(paymentService.transitionAttempt).not.toHaveBeenCalled();
  });

  it('treats a concurrent-race invalid_attempt_state error from transitionAttempt as a safe no-op, not a 500', async () => {
    const { app } = await fixture({
      getOrderResult: order({
        orderStatus: 'processed',
        transactionStatus: 'processed',
        transactionStatusDetail: 'accredited',
        paidAmount: '149.5000',
      }),
      currentAttemptStatus: 'awaiting_terminal',
      transitionError: new PaymentError('invalid_attempt_state', 'raced'),
    });
    const dataId = 'ORD00001';
    const ts = '1700000000000';
    const requestId = 'req-1';
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/mercado-pago',
      headers: {
        'content-type': 'application/json',
        'x-request-id': requestId,
        'x-signature': `ts=${ts},v1=${sign(dataId, requestId, ts)}`,
      },
      payload: webhookPayload(dataId, 'order.processed'),
    });
    expect(response.statusCode).toBe(200);
  });

  it('propagates a genuine, unrelated transitionAttempt failure as a server error (so Mercado Pago retries)', async () => {
    const { app } = await fixture({
      getOrderResult: order({
        orderStatus: 'processed',
        transactionStatus: 'processed',
        transactionStatusDetail: 'accredited',
        paidAmount: '149.5000',
      }),
      currentAttemptStatus: 'awaiting_terminal',
      transitionError: new Error('database exploded'),
    });
    const dataId = 'ORD00001';
    const ts = '1700000000000';
    const requestId = 'req-1';
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/mercado-pago',
      headers: {
        'content-type': 'application/json',
        'x-request-id': requestId,
        'x-signature': `ts=${ts},v1=${sign(dataId, requestId, ts)}`,
      },
      payload: webhookPayload(dataId, 'order.processed'),
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(500);
  });

  it('acknowledges a malformed (non-JSON) body without throwing', async () => {
    const { app } = await fixture();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/mercado-pago',
      headers: { 'content-type': 'application/json' },
      payload: 'not json at all',
    });
    expect(response.statusCode).toBe(200);
  });
});
