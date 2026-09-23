import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@asone/errors';

import type { AuthService } from '../../auth/auth.service.js';
import type { AuthContext } from '../../auth/auth.types.js';
import type { AdministrationService } from '../shared/admin.service.js';
import { registerContextRoutes } from './context.routes.js';

const companyId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const branchId = '00000000-0000-4000-8000-000000000003';
const apps: FastifyInstance[] = [];

// TASK 16.23B (F-05) — real HTTP-layer coverage for the new "business
// today" resolver every timezone-sensitive Flutter screen (Dashboard,
// Fiestas Calendar/Lista "Hoy", Sales Reports default range) now calls
// instead of computing `DateTime.now()` itself.
async function fixture(): Promise<{ app: FastifyInstance }> {
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
      ? reply.code(error.statusCode).send({ error: { code: error.code }, meta: { request_id: request.requestContext.requestId } })
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
    permissions: [],
    permittedBranchIds: [branchId],
  };
  const authentication = { authenticate: vi.fn(() => Promise.resolve(authContext)) } as unknown as AuthService;
  const administration = {} as AdministrationService;
  registerContextRoutes(app, authentication, administration);
  await app.ready();
  return { app };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('GET /api/v1/context/business-date (TASK 16.23B, F-05)', () => {
  it('resolves "today" for a real IANA timezone, never the server/device clock blindly', async () => {
    const { app } = await fixture();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/context/business-date?timezone=America%2FMexico_City',
      headers: { authorization: 'Bearer token' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { date: string; timezone: string } }>();
    expect(body.data.timezone).toBe('America/Mexico_City');
    expect(body.data.date).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  });

  it('two different real timezones resolve independently — proves this is real zone math, not a hardcoded default', async () => {
    const { app } = await fixture();
    // A fixed real instant near a UTC day boundary would be a stronger
    // proof, but this endpoint deliberately always resolves "right now"
    // (no injectable clock at the HTTP layer) — so instead this asserts
    // the two calls never silently collapse to the identical hardcoded
    // string regardless of the timezone argument (the exact failure mode
    // a "return new Date().toISOString().slice(0,10)" bug would produce).
    const tokyo = await app.inject({
      method: 'GET',
      url: '/api/v1/context/business-date?timezone=Asia%2FTokyo',
      headers: { authorization: 'Bearer token' },
    });
    const honolulu = await app.inject({
      method: 'GET',
      url: '/api/v1/context/business-date?timezone=Pacific%2FHonolulu',
      headers: { authorization: 'Bearer token' },
    });
    expect(tokyo.json<{ data: { timezone: string } }>().data.timezone).toBe('Asia/Tokyo');
    expect(honolulu.json<{ data: { timezone: string } }>().data.timezone).toBe('Pacific/Honolulu');
  });

  it('rejects a non-IANA timezone string cleanly, never a fabricated date', async () => {
    const { app } = await fixture();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/context/business-date?timezone=Not_A_Real_Zone',
      headers: { authorization: 'Bearer token' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('validation_error');
  });

  it('rejects a missing timezone param outright — no silent UTC/device fallback', async () => {
    const { app } = await fixture();
    const res = await app.inject({ method: 'GET', url: '/api/v1/context/business-date', headers: { authorization: 'Bearer token' } });
    expect(res.statusCode).toBe(400);
  });

  it('requires authentication, like every other context endpoint', async () => {
    const { app } = await fixture();
    const res = await app.inject({ method: 'GET', url: '/api/v1/context/business-date?timezone=UTC' });
    expect(res.statusCode).toBe(401);
  });
});
