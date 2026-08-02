import type { FastifyInstance } from 'fastify';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';

import { loadApiConfig, type ApiConfig } from '@asone/config';

import { buildApp } from './app.js';
import type { InfrastructureDependencies, ReadinessResult } from './infrastructure/dependencies.js';
import { hashPassword } from './modules/auth/auth.passwords.js';
import type {
  AuthContext,
  AuthRepository,
  RefreshLookup,
  SessionCreation,
} from './modules/auth/auth.types.js';

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

const environment = {
  NODE_ENV: 'test',
  APP_NAME: 'asone-api-test',
  APP_VERSION: '0.2.0-test',
  LOG_LEVEL: 'silent',
  API_HOST: '127.0.0.1',
  API_PORT: '3000',
  AUTH_ACCESS_TOKEN_SECRET: 'test-secret-that-is-at-least-32-characters',
  AUTH_JWT_AUDIENCE: 'asone-api-test',
  AUTH_JWT_ISSUER: 'https://api.test.asone.mx',
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

const emptyAuthRepository: AuthRepository = {
  findUserByNormalizedEmail: () => Promise.resolve(null),
  listActiveMemberships: () => Promise.resolve([]),
  resolveContext: () => Promise.resolve(null),
  createSession: () => Promise.reject(new Error('not expected')),
  findRefreshToken: () => Promise.resolve(null),
  rotateRefreshToken: () => Promise.resolve('invalid'),
  findSession: () => Promise.resolve(null),
  revokeSession: () => Promise.resolve(false),
  revokeUserSessions: () => Promise.resolve(0),
  getSafeIdentity: () => Promise.resolve(null),
  audit: () => Promise.resolve(),
};

async function appWithAuth(): Promise<FastifyInstance> {
  const app = await buildApp({
    config: loadApiConfig(environment),
    infrastructure: infrastructure({ postgres: 'unavailable', redis: 'unavailable' }),
    logger: pino({ level: 'silent' }),
    authRepository: emptyAuthRepository,
  });
  apps.push(app);
  return app;
}

async function appWithLoginAuth(): Promise<FastifyInstance> {
  const userId = '00000000-0000-4000-8000-000000000001';
  const companyId = '00000000-0000-4000-8000-000000000002';
  const membershipId = '00000000-0000-4000-8000-000000000003';
  const sessionId = '00000000-0000-4000-8000-000000000004';
  const passwordHash = await hashPassword('Correct-password-1!');
  const refresh = new Map<string, RefreshLookup>();
  let session: AuthContext | null = null;
  const repository: AuthRepository = {
    ...emptyAuthRepository,
    findUserByNormalizedEmail: () =>
      Promise.resolve({
        id: userId,
        email: 'browser@example.test',
        displayName: 'Browser',
        passwordHash,
        status: 'active',
      }),
    listActiveMemberships: () =>
      Promise.resolve([{ id: membershipId, companyId, companyName: 'Test', status: 'active' }]),
    resolveContext: () =>
      Promise.resolve({
        userId,
        membershipId,
        companyId,
        permissions: [],
        permittedBranchIds: [],
        companyWideAccess: true,
        transportMode: 'bearer',
        tokenGeneration: 0,
      }),
    createSession: (input: SessionCreation) => {
      session = {
        sessionId,
        userId,
        membershipId,
        companyId,
        expiresAt: input.expiresAt,
        permissions: [],
        permittedBranchIds: [],
        companyWideAccess: true,
        transportMode: input.transportMode,
        tokenGeneration: input.tokenGeneration,
      };
      refresh.set(input.tokenHash, {
        context: session,
        generation: 0,
        refreshExpiresAt: input.expiresAt,
        status: 'active',
        tokenStatus: 'active',
      });
      return Promise.resolve(sessionId);
    },
    findRefreshToken: (hash) => Promise.resolve(refresh.get(hash) ?? null),
    rotateRefreshToken: (input) => {
      const previous = refresh.get(input.previousHash);
      if (previous?.tokenStatus !== 'active') return Promise.resolve('invalid');
      refresh.set(input.previousHash, { ...previous, tokenStatus: 'rotated' });
      refresh.set(input.nextHash, {
        ...previous,
        context: { ...previous.context, tokenGeneration: input.nextGeneration },
        generation: input.nextGeneration,
        tokenStatus: 'active',
      });
      return Promise.resolve('rotated');
    },
    findSession: () => Promise.resolve(session),
    revokeSession: () => {
      session = null;
      return Promise.resolve(true);
    },
  };
  const app = await buildApp({
    config: loadApiConfig({ ...environment, CORS_ALLOWED_ORIGINS: 'https://app.test.asone.mx' }),
    infrastructure: infrastructure({ postgres: 'unavailable', redis: 'unavailable' }),
    logger: pino({ level: 'silent' }),
    authRepository: repository,
  });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe('API foundation', () => {
  it('registers only the ten approved authentication endpoints', async () => {
    const app = await appWithAuth();
    for (const [method, url] of [
      ['POST', '/api/v1/auth/login'],
      ['POST', '/api/v1/auth/refresh'],
      ['POST', '/api/v1/auth/logout'],
      ['POST', '/api/v1/auth/logout-all'],
      ['POST', '/api/v1/auth/company-selections'],
      ['POST', '/api/v1/auth/company-switches'],
      ['POST', '/api/v1/auth/branch-switches'],
      ['GET', '/api/v1/auth/session'],
      ['GET', '/api/v1/auth/me'],
      ['GET', '/api/v1/auth/permissions'],
    ] as const)
      expect(app.hasRoute({ method, url })).toBe(true);
    expect(app.hasRoute({ method: 'POST', url: '/api/v1/auth/switch-context' })).toBe(false);
    expect(app.hasRoute({ method: 'GET', url: '/api/v1/auth/sessions' })).toBe(false);
  });

  it('keeps invalid login responses free of credentials and hashes', async () => {
    const app = await appWithAuth();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { identifier: 'missing@example.test', password: 'Never-log-this-password!' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: 'invalid_credentials' } });
    expect(response.body).not.toContain('Never-log-this-password');
    expect(response.body).not.toContain('password_hash');
    expect(response.body).not.toContain('refresh_token');
  });

  it('keeps browser refresh credentials HttpOnly and bearer credentials explicit', async () => {
    const app = await appWithLoginAuth();
    const browser = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'https://app.test.asone.mx' },
      payload: {
        identifier: 'browser@example.test',
        password: 'Correct-password-1!',
        client_type: 'browser',
        transport_mode: 'browser',
      },
    });
    expect(browser.statusCode).toBe(200);
    expect(browser.headers['set-cookie']).toContain('asone_refresh_local=');
    expect(browser.headers['set-cookie']).toContain('HttpOnly');
    expect(browser.headers['set-cookie']).toContain('SameSite=Strict');
    expect(browser.headers['cache-control']).toContain('no-store');
    expect(browser.body).not.toContain('refresh_token');
    expect(browser.json()).toMatchObject({
      data: { result: 'authenticated', session: { transport_mode: 'browser' } },
    });
    const browserBody = browser.json<{ data: { csrf_token: string } }>();
    const setCookie = browser.headers['set-cookie'];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(';')[0];
    if (cookie === undefined) throw new Error('browser cookie missing');
    const missingCsrf = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { origin: 'https://app.test.asone.mx', cookie },
      payload: {},
    });
    expect(missingCsrf.statusCode).toBe(403);
    const wrongOrigin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: {
        origin: 'https://evil.example',
        cookie,
        'x-csrf-token': browserBody.data.csrf_token,
      },
      payload: {},
    });
    expect(wrongOrigin.statusCode).toBe(403);
    const refreshed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: {
        origin: 'https://app.test.asone.mx',
        cookie,
        'x-csrf-token': browserBody.data.csrf_token,
      },
      payload: {},
    });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.body).not.toContain('refresh_token');
    expect(refreshed.headers['set-cookie']).toContain('HttpOnly');

    const bearer = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        identifier: 'browser@example.test',
        password: 'Correct-password-1!',
        client_type: 'mobile',
        transport_mode: 'bearer',
      },
    });
    expect(bearer.statusCode).toBe(200);
    expect(bearer.headers['set-cookie']).toBeUndefined();
    expect(bearer.json()).toMatchObject({
      data: { result: 'authenticated', session: { transport_mode: 'bearer' } },
    });
    expect(bearer.body).toContain('refresh_token');
  });
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
