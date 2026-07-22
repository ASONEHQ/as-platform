import type { FastifyInstance } from 'fastify';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';

import { loadApiConfig, type ApiConfig } from '@asone/config';

import { buildApp } from './app.js';
import type { InfrastructureDependencies, ReadinessResult } from './infrastructure/dependencies.js';

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

const environment = {
  NODE_ENV: 'test',
  APP_NAME: 'asone-api-test',
  APP_VERSION: '0.2.0-test',
  LOG_LEVEL: 'silent',
  API_HOST: '127.0.0.1',
  API_PORT: '3000',
  DATABASE_URL: 'postgresql://local:local@127.0.0.1:5432/test',
  REDIS_URL: 'redis://127.0.0.1:6379',
} as const;

function infrastructure(result: ReadinessResult): InfrastructureDependencies {
  return {
    checkReadiness: () => Promise.resolve(result),
    close: () => Promise.resolve(),
  };
}

async function appFor(overrides: Readonly<Record<string, string>> = {}): Promise<FastifyInstance> {
  const config: ApiConfig = loadApiConfig({ ...environment, ...overrides });
  const app = await buildApp({
    config,
    infrastructure: infrastructure({ postgres: 'unavailable', redis: 'unavailable' }),
    logger: pino({ level: 'silent' }),
  });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe('API foundation', () => {
  it('serves the versioned API envelope without business routes', async () => {
    const app = await appFor();
    const response = await app.inject({ method: 'GET', url: '/api/v1' });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      data: { documentation: null; name: string; status: string; version: string };
      meta: { request_id: string; correlation_id: string };
    }>();
    expect(body.data).toEqual({
      documentation: null,
      name: 'AS ONE API',
      status: 'available',
      version: '0.2.0-test',
    });
    expect(typeof body.meta.request_id).toBe('string');
    expect(typeof body.meta.correlation_id).toBe('string');
    expect(app.hasRoute({ method: 'GET', url: '/sales' })).toBe(false);
  });

  it('generates request and correlation IDs and returns request ID', async () => {
    const app = await appFor();
    const response = await app.inject({ method: 'GET', url: '/api/v1' });
    const body = response.json<{ meta: { request_id: string; correlation_id: string } }>();

    expect(body.meta.request_id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(body.meta.correlation_id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(response.headers['x-request-id']).toBe(body.meta.request_id);
  });

  it('propagates valid incoming IDs', async () => {
    const app = await appFor();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1',
      headers: { 'x-request-id': 'request_valid-123', 'x-correlation-id': 'correlation.valid' },
    });
    const body = response.json<{ meta: { request_id: string; correlation_id: string } }>();

    expect(body.meta).toEqual({
      correlation_id: 'correlation.valid',
      request_id: 'request_valid-123',
    });
  });

  it('replaces invalid or oversized incoming IDs', async () => {
    const app = await appFor();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1',
      headers: { 'x-request-id': 'invalid id', 'x-correlation-id': 'x'.repeat(129) },
    });
    const body = response.json<{ meta: { request_id: string; correlation_id: string } }>();

    expect(body.meta.request_id).not.toBe('invalid id');
    expect(body.meta.correlation_id).not.toBe('x'.repeat(129));
  });

  it('returns consistent not found and method not allowed errors', async () => {
    const app = await appFor();
    const missing = await app.inject({ method: 'GET', url: '/missing' });
    const method = await app.inject({ method: 'POST', url: '/api/v1' });

    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: { code: 'not_found' } });
    expect(method.statusCode).toBe(405);
    expect(method.headers.allow).toContain('GET');
    expect(method.json()).toMatchObject({ error: { code: 'method_not_allowed' } });
  });

  it('sanitizes validation, malformed JSON, media type, and payload errors', async () => {
    const app = await appFor({ REQUEST_BODY_LIMIT_BYTES: '1024' });
    const validation = await app.inject({
      method: 'POST',
      url: '/__test/echo',
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    const malformed = await app.inject({
      method: 'POST',
      url: '/__test/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{',
    });
    const media = await app.inject({
      method: 'POST',
      url: '/__test/echo',
      headers: { 'content-type': 'text/plain' },
      payload: 'value',
    });
    const large = await app.inject({
      method: 'POST',
      url: '/__test/echo',
      headers: { 'content-type': 'application/json' },
      payload: { value: 'x'.repeat(2_000) },
    });

    expect(validation.statusCode).toBe(400);
    expect(validation.json()).toMatchObject({ error: { code: 'validation_error' } });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toMatchObject({ error: { code: 'validation_error' } });
    expect(media.statusCode).toBe(415);
    expect(media.json()).toMatchObject({ error: { code: 'unsupported_media_type' } });
    expect(large.statusCode).toBe(413);
    expect(large.json()).toMatchObject({ error: { code: 'payload_too_large' } });
  });

  it('serializes AppError and sanitizes unknown errors', async () => {
    const app = await appFor();
    const known = await app.inject({ method: 'GET', url: '/__test/app-error' });
    const unknown = await app.inject({ method: 'GET', url: '/__test/internal-error' });

    expect(known.statusCode).toBe(503);
    expect(known.json()).toMatchObject({ error: { code: 'service_unavailable' } });
    expect(unknown.statusCode).toBe(500);
    expect(unknown.json()).toMatchObject({ error: { code: 'internal_error' } });
    expect(unknown.body).not.toContain('DATABASE_URL');
    expect(unknown.body).not.toContain('C:\\private');
  });

  it('enforces the global rate limit and returns retry-after', async () => {
    const app = await appFor({ RATE_LIMIT_MAX: '1', RATE_LIMIT_WINDOW_MS: '60000' });
    const first = await app.inject({ method: 'GET', url: '/api/v1' });
    const limited = await app.inject({ method: 'GET', url: '/api/v1' });

    expect(first.statusCode).toBe(200);
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
    expect(limited.json()).toMatchObject({ error: { code: 'rate_limit_exceeded' } });
  });

  it('allows configured CORS origins and omits headers for rejected origins', async () => {
    const app = await appFor({ CORS_ALLOWED_ORIGINS: 'https://allowed.example' });
    const allowed = await app.inject({
      method: 'GET',
      url: '/api/v1',
      headers: { origin: 'https://allowed.example' },
    });
    const rejected = await app.inject({
      method: 'GET',
      url: '/api/v1',
      headers: { origin: 'https://rejected.example' },
    });

    expect(allowed.headers['access-control-allow-origin']).toBe('https://allowed.example');
    expect(rejected.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('controls OpenAPI UI and metrics through configuration', async () => {
    const disabled = await appFor();
    const enabled = await appFor({ METRICS_ENABLED: 'true', OPENAPI_UI_ENABLED: 'true' });

    expect((await disabled.inject({ method: 'GET', url: '/documentation/' })).statusCode).toBe(404);
    expect((await disabled.inject({ method: 'GET', url: '/metrics' })).statusCode).toBe(404);
    expect((await enabled.inject({ method: 'GET', url: '/documentation/json' })).statusCode).toBe(
      200,
    );
    const metrics = await enabled.inject({ method: 'GET', url: '/metrics' });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.body).toContain('asone_http_requests_total');
  });

  it('keeps health, liveness, and unavailable readiness safe', async () => {
    const app = await appFor();
    const health = await app.inject({ method: 'GET', url: '/health' });
    const live = await app.inject({ method: 'GET', url: '/live' });
    const ready = await app.inject({ method: 'GET', url: '/ready' });

    expect(health.statusCode).toBe(200);
    expect(live.statusCode).toBe(200);
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toEqual({
      services: { postgres: 'unavailable', redis: 'unavailable' },
      status: 'not_ready',
    });
    expect(ready.body).not.toContain('postgresql://');
  });
});
