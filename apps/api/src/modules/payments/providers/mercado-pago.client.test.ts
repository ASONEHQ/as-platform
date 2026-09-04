import { describe, expect, it, vi } from 'vitest';

import { MercadoPagoClient } from './mercado-pago.client.js';

// Returns an already-resolved Promise (never marked `async`) so every
// `vi.fn(() => jsonResponse(...))` call site below satisfies `typeof
// fetch`'s `Promise<Response>` return type without an `async` arrow that
// has no `await` inside it.
function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers }));
}

describe('MercadoPagoClient', () => {
  it('fails cleanly and explicitly when no access token is configured — never a silent no-op', async () => {
    const fetchImpl = vi.fn();
    const client = new MercadoPagoClient({
      accessToken: undefined,
      apiBaseUrl: 'https://api.mercadopago.com',
      fetchImpl,
    });
    await expect(client.request({ method: 'GET', path: '/v1/orders/1' })).rejects.toMatchObject({
      code: 'not_configured',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends the Bearer access token and never lets it appear in a thrown error', async () => {
    const fetchImpl = vi.fn(() => jsonResponse(200, { id: 'ORD1' }));
    const client = new MercadoPagoClient({
      accessToken: 'TEST-super-secret-token',
      apiBaseUrl: 'https://api.mercadopago.com',
      fetchImpl,
    });
    await client.request({ method: 'GET', path: '/v1/orders/ORD1' });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer TEST-super-secret-token');

    // Now force a rejected request and confirm the token never leaks into
    // the thrown error's message/details.
    const rejecting = vi.fn(() => jsonResponse(400, { message: 'bad request' }));
    const rejectingClient = new MercadoPagoClient({
      accessToken: 'TEST-super-secret-token',
      apiBaseUrl: 'https://api.mercadopago.com',
      fetchImpl: rejecting,
    });
    try {
      await rejectingClient.request({ method: 'POST', path: '/v1/orders', body: {} });
      expect.unreachable('expected the request to throw');
    } catch (error) {
      const serialized = JSON.stringify(error, Object.getOwnPropertyNames(error));
      expect(serialized).not.toContain('TEST-super-secret-token');
    }
  });

  it('sends the X-Idempotency-Key header when provided', async () => {
    const fetchImpl = vi.fn(() => jsonResponse(201, { id: 'ORD1' }));
    const client = new MercadoPagoClient({
      accessToken: 'TEST-token',
      apiBaseUrl: 'https://api.mercadopago.com',
      fetchImpl,
    });
    await client.request({ method: 'POST', path: '/v1/orders', body: {}, idempotencyKey: 'key-123' });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['x-idempotency-key']).toBe('key-123');
  });

  it('maps a timeout to a PaymentProviderError without leaking the raw AbortError', async () => {
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((_resolve, reject) => {
          setTimeout(() => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          }, 5);
        }),
    );
    const client = new MercadoPagoClient({
      accessToken: 'TEST-token',
      apiBaseUrl: 'https://api.mercadopago.com',
      timeoutMs: 1,
      fetchImpl,
    });
    await expect(client.request({ method: 'GET', path: '/v1/orders/1' })).rejects.toMatchObject({
      code: 'timeout',
    });
  });

  it('maps a network failure to a PaymentProviderError', async () => {
    const fetchImpl = vi.fn(() => {
      throw new Error('getaddrinfo ENOTFOUND');
    });
    const client = new MercadoPagoClient({
      accessToken: 'TEST-token',
      apiBaseUrl: 'https://api.mercadopago.com',
      fetchImpl,
    });
    await expect(client.request({ method: 'GET', path: '/v1/orders/1' })).rejects.toMatchObject({
      code: 'network_error',
    });
  });

  it('maps a malformed (non-JSON) response body cleanly', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('not json', { status: 200 })));
    const client = new MercadoPagoClient({
      accessToken: 'TEST-token',
      apiBaseUrl: 'https://api.mercadopago.com',
      fetchImpl,
    });
    await expect(client.request({ method: 'GET', path: '/v1/orders/1' })).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('maps HTTP 429 to rate_limited', async () => {
    const fetchImpl = vi.fn(() => jsonResponse(429, { message: 'too many requests' }));
    const client = new MercadoPagoClient({
      accessToken: 'TEST-token',
      apiBaseUrl: 'https://api.mercadopago.com',
      fetchImpl,
    });
    await expect(client.request({ method: 'GET', path: '/v1/orders/1' })).rejects.toMatchObject({
      code: 'rate_limited',
      statusCode: 429,
    });
  });

  it('maps a 4xx response to provider_rejected with the status code preserved', async () => {
    const fetchImpl = vi.fn(() => jsonResponse(404, { message: 'order not found' }));
    const client = new MercadoPagoClient({
      accessToken: 'TEST-token',
      apiBaseUrl: 'https://api.mercadopago.com',
      fetchImpl,
    });
    await expect(client.request({ method: 'GET', path: '/v1/orders/missing' })).rejects.toMatchObject({
      code: 'provider_rejected',
      statusCode: 404,
    });
  });

  it('maps a 5xx response to provider_rejected', async () => {
    const fetchImpl = vi.fn(() => jsonResponse(500, {}));
    const client = new MercadoPagoClient({
      accessToken: 'TEST-token',
      apiBaseUrl: 'https://api.mercadopago.com',
      fetchImpl,
    });
    await expect(client.request({ method: 'GET', path: '/v1/orders/1' })).rejects.toMatchObject({
      code: 'provider_rejected',
      statusCode: 500,
    });
  });

  it('returns the parsed body on success without wrapping it', async () => {
    const fetchImpl = vi.fn(() => jsonResponse(200, { id: 'ORD1', status: 'created' }));
    const client = new MercadoPagoClient({
      accessToken: 'TEST-token',
      apiBaseUrl: 'https://api.mercadopago.com',
      fetchImpl,
    });
    const value = await client.request<{ id: string; status: string }>({
      method: 'GET',
      path: '/v1/orders/ORD1',
    });
    expect(value).toEqual({ id: 'ORD1', status: 'created' });
  });

  it('never logs the access token, even on a rejected request', async () => {
    const warn = vi.fn();
    const error = vi.fn();
    const fetchImpl = vi.fn(() => jsonResponse(400, { message: 'bad' }));
    const client = new MercadoPagoClient({
      accessToken: 'TEST-super-secret-token',
      apiBaseUrl: 'https://api.mercadopago.com',
      fetchImpl,
      logger: { warn, error },
    });
    await expect(client.request({ method: 'POST', path: '/v1/orders', body: {} })).rejects.toThrow();
    for (const call of [...warn.mock.calls, ...error.mock.calls]) {
      expect(JSON.stringify(call)).not.toContain('TEST-super-secret-token');
    }
  });
});
