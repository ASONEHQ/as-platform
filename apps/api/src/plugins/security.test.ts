/// TASK 14.5A: a real, live end-to-end rehearsal against the fully wired
/// app (not `branding.routes.integration.test.ts`'s own minimal harness,
/// which never registers this plugin) caught a real bug this global hook
/// introduced: every real `multipart/form-data` upload to the branding
/// logo route was rejected with a 415 *before the route itself ever ran*,
/// because this hook's blanket JSON-only rule has no awareness of routes
/// registered elsewhere. This test closes that exact coverage gap
/// directly against `registerSecurity` itself, so a future regression
/// here is caught by `pnpm test`, not only by a manual live rehearsal.
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyMultipart from '@fastify/multipart';
import { describe, expect, it } from 'vitest';

import { loadApiConfig } from '@asone/config';

import { registerSecurity } from './security.js';

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

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await registerSecurity(app, loadApiConfig(environment));
  // Real `@fastify/multipart`, matching production wiring exactly —
  // without it, a request that gets *past* the security hook still
  // fails with Fastify's own unrelated "no parser for this content
  // type" error, which would make a passing test here meaningless.
  await app.register(fastifyMultipart, { attachFieldsToBody: false });
  app.post('/__test/echo', () => ({ ok: true }));
  app.post('/api/v1/companies/:company_id/branding/logo', () => ({ ok: true }));
  await app.ready();
  return app;
}

describe('registerSecurity — content-type gate', () => {
  it('rejects a non-JSON body on an ordinary route with a real 415', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/__test/echo',
      headers: { 'content-type': 'text/plain' },
      payload: 'value',
    });
    // Not registering the real error-handler plugin here (out of scope
    // for this hook-focused test) means `AppError` serializes via
    // Fastify's own default shape (`code` at the top level), not the
    // app's real nested `{ error: { code } }` envelope — asserted at the
    // point closest to the hook itself, not the full response pipeline.
    expect(response.statusCode).toBe(415);
    expect(response.json()).toMatchObject({ code: 'unsupported_media_type' });
    await app.close();
  });

  it('accepts a real JSON body on an ordinary route', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/__test/echo',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ value: 'x' }),
    });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it('allows a real multipart/form-data body specifically on the branding logo upload route — the exact bug a live E2E rehearsal caught', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/companies/11111111-1111-4111-8111-111111111111/branding/logo',
      headers: { 'content-type': 'multipart/form-data; boundary=----x' },
      payload: '------x--',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true });
    await app.close();
  });

  it('still rejects multipart/form-data on every other route — the exemption stays narrow, not a blanket relaxation', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/__test/echo',
      headers: { 'content-type': 'multipart/form-data; boundary=----x' },
      payload: '------x--',
    });
    // Not registering the real error-handler plugin here (out of scope
    // for this hook-focused test) means `AppError` serializes via
    // Fastify's own default shape (`code` at the top level), not the
    // app's real nested `{ error: { code } }` envelope — asserted at the
    // point closest to the hook itself, not the full response pipeline.
    expect(response.statusCode).toBe(415);
    expect(response.json()).toMatchObject({ code: 'unsupported_media_type' });
    await app.close();
  });

  it('never applies the multipart exemption to a request that merely resolves to the same URL string without the route match (defense against a path-string bypass)', async () => {
    const app = await buildTestApp();
    // A trailing slash / different casing never matches Fastify's own
    // route pattern, so `request.routeOptions.url` never equals the
    // allowlisted entry for this request — must still 415 (or 404 before
    // the hook even matters), never silently accept multipart.
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/companies/11111111-1111-4111-8111-111111111111/branding/logo/',
      headers: { 'content-type': 'multipart/form-data; boundary=----x' },
      payload: '------x--',
    });
    expect(response.statusCode).not.toBe(200);
    await app.close();
  });
});
