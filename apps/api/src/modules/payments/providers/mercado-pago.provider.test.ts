import { describe, expect, it, vi } from 'vitest';

import { MercadoPagoClient } from './mercado-pago.client.js';
import { MercadoPagoPointProvider, MercadoPagoPointTestHelper } from './mercado-pago.provider.js';
import { PaymentProviderError } from './payment-provider.js';

function jsonResponse(status: number, body: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

function providerWith(fetchImpl: ReturnType<typeof vi.fn>): MercadoPagoPointProvider {
  const client = new MercadoPagoClient({
    accessToken: 'TEST-token',
    apiBaseUrl: 'https://api.mercadopago.com',
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  return new MercadoPagoPointProvider(client);
}

describe('MercadoPagoPointProvider', () => {
  it('creates a point order with the exact documented request shape', async () => {
    const fetchImpl = vi.fn(() =>
      jsonResponse(201, {
        id: 'ORD00001',
        type: 'point',
        status: 'created',
        status_detail: 'created',
        transactions: { payments: [{ id: 'PAY1', amount: '24.00', status: 'created' }] },
      }),
    );
    const provider = providerWith(fetchImpl);
    const order = await provider.createOrder({
      externalReference: 'attempt-1',
      amount: '24.0000',
      currencyCode: 'MXN',
      terminalProviderId: 'NEWLAND_N950__X',
      description: 'Venta SALE-abc',
    });
    expect(order).toMatchObject({
      providerOrderId: 'ORD00001',
      orderStatus: 'created',
      transactionId: 'PAY1',
      transactionStatus: 'created',
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('https://api.mercadopago.com/v1/orders');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    const idempotencyKey = headers['x-idempotency-key'];
    expect(idempotencyKey).toBeDefined();
    expect(idempotencyKey?.length).toBeGreaterThan(0);
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: 'point',
      external_reference: 'attempt-1',
      transactions: { payments: [{ amount: '24.0000' }] },
      config: { point: { terminal_id: 'NEWLAND_N950__X' } },
      description: 'Venta SALE-abc',
    });
  });

  it('rejects a non-MXN currency before ever sending a request — Point Mexico is MXN-only', async () => {
    const fetchImpl = vi.fn();
    const provider = providerWith(fetchImpl);
    await expect(
      provider.createOrder({
        externalReference: 'attempt-1',
        amount: '24.0000',
        currencyCode: 'USD',
        terminalProviderId: 'TERMINAL-1',
      }),
    ).rejects.toBeInstanceOf(PaymentProviderError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('generates a fresh X-Idempotency-Key per createOrder call, never reusing one across two different orders', async () => {
    const fetchImpl = vi.fn(() => jsonResponse(201, { id: 'ORD1', status: 'created' }));
    const provider = providerWith(fetchImpl);
    await provider.createOrder({
      externalReference: 'attempt-1',
      amount: '10.0000',
      currencyCode: 'MXN',
      terminalProviderId: 'T1',
    });
    await provider.createOrder({
      externalReference: 'attempt-2',
      amount: '10.0000',
      currencyCode: 'MXN',
      terminalProviderId: 'T1',
    });
    const [, firstInit] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    const [, secondInit] = fetchImpl.mock.calls[1] as unknown as [URL, RequestInit];
    const firstKey = (firstInit.headers as Record<string, string>)['x-idempotency-key'];
    const secondKey = (secondInit.headers as Record<string, string>)['x-idempotency-key'];
    expect(firstKey).not.toBe(secondKey);
  });

  it('gets an order by id via GET /v1/orders/{id}', async () => {
    const fetchImpl = vi.fn(() => jsonResponse(200, { id: 'ORD00001', status: 'processed' }));
    const provider = providerWith(fetchImpl);
    const order = await provider.getOrder('ORD00001');
    expect(order.providerOrderId).toBe('ORD00001');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('https://api.mercadopago.com/v1/orders/ORD00001');
    expect(init.method).toBe('GET');
  });

  it('cancels an order via POST /v1/orders/{id}/cancel with an idempotency key', async () => {
    const fetchImpl = vi.fn(() => jsonResponse(200, { id: 'ORD1', status: 'canceled' }));
    const provider = providerWith(fetchImpl);
    await provider.cancelOrder('ORD1');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('https://api.mercadopago.com/v1/orders/ORD1/cancel');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-idempotency-key']).toBeDefined();
  });

  it('requests a full refund with no body and a partial refund with the transactions array', async () => {
    const fetchImpl = vi.fn(() =>
      jsonResponse(201, {
        id: 'ORD1',
        status: 'refunded',
        transactions: { refunds: [{ id: 'REF1', transaction_id: 'PAY1', amount: '24.00', status: 'processed' }] },
      }),
    );
    const provider = providerWith(fetchImpl);
    const fullRefund = await provider.refund('ORD1', {});
    expect(fullRefund).toEqual({ refundId: 'REF1', status: 'processed', amount: '24.00' });
    const [, fullInit] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(fullInit.body).toBeUndefined();

    await provider.refund('ORD1', { transactionId: 'PAY1', amount: '10.00' });
    const [, partialInit] = fetchImpl.mock.calls[1] as unknown as [URL, RequestInit];
    const body = JSON.parse(partialInit.body as string) as Record<string, unknown>;
    expect(body).toEqual({ transactions: [{ id: 'PAY1', amount: '10.00' }] });
  });

  it('lists terminals filtered by store_id/pos_id', async () => {
    const fetchImpl = vi.fn(() =>
      jsonResponse(200, {
        data: { terminals: [{ id: 'T1', pos_id: 5, store_id: 'S1', operating_mode: 'PDV' }] },
        paging: { total: 1, offset: 0, limit: 50 },
      }),
    );
    const provider = providerWith(fetchImpl);
    const terminals = await provider.listTerminals({ storeId: 'S1', posId: '5' });
    expect(terminals).toEqual([{ providerTerminalId: 'T1', posId: '5', storeId: 'S1', operatingMode: 'PDV' }]);
    const [url] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.searchParams.get('store_id')).toBe('S1');
    expect(url.searchParams.get('pos_id')).toBe('5');
  });
});

describe('MercadoPagoPointTestHelper', () => {
  it('refuses to construct in production, as a second guard beyond never being wired there', () => {
    const client = new MercadoPagoClient({ accessToken: 'TEST-token', apiBaseUrl: 'https://api.mercadopago.com' });
    expect(() => new MercadoPagoPointTestHelper(client, 'production')).toThrow(PaymentProviderError);
  });

  it('simulates an order status via POST /v1/orders/{id}/events outside production', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    const client = new MercadoPagoClient({
      accessToken: 'TEST-token',
      apiBaseUrl: 'https://api.mercadopago.com',
      fetchImpl,
    });
    const helper = new MercadoPagoPointTestHelper(client, 'test');
    await helper.simulateOrderStatus('ORD1', { status: 'processed', statusDetail: 'accredited' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('https://api.mercadopago.com/v1/orders/ORD1/events');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({ status: 'processed', status_detail: 'accredited' });
  });
});
