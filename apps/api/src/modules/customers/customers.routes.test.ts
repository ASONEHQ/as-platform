import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@asone/errors';

import type { AuthService } from '../auth/auth.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { registerCustomerRoutes } from './customers.routes.js';
import type { CustomersService } from './customers.service.js';

const companyId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const branchId = '00000000-0000-4000-8000-000000000003';
const customerId = '00000000-0000-7000-8000-000000000004';
const apps: FastifyInstance[] = [];

function customerValue(overrides?: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return {
    id: customerId,
    companyId,
    firstName: 'Ana',
    lastName: null,
    displayName: 'Ana',
    email: null,
    normalizedEmail: null,
    phone: null,
    normalizedPhone: null,
    phoneCountryCode: null,
    birthDate: null,
    status: 'active',
    notes: null,
    createdBy: userId,
    updatedBy: userId,
    version: 1n,
    createdAt: new Date('2026-09-04T00:00:00.000Z'),
    updatedAt: new Date('2026-09-04T00:00:00.000Z'),
    ...overrides,
  };
}

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
    requireBranchAccess: vi.fn(() => undefined),
  } as unknown as AuthService;
  const service = {
    createCustomer: vi.fn(() => Promise.resolve({ value: customerValue(), replayed: false })),
    updateCustomer: vi.fn(() => Promise.resolve(customerValue({ version: 2n }))),
    customer: vi.fn(() => Promise.resolve(customerValue())),
    listCustomers: vi.fn(() => Promise.resolve({ items: [customerValue()], nextCursor: null, hasMore: false })),
    issueQrToken: vi.fn(() =>
      Promise.resolve({ id: 'qr-1', companyId, customerId, token: 'opaque-token-value', status: 'active', createdAt: new Date(), revokedAt: null }),
    ),
    activeQrToken: vi.fn(() => Promise.resolve(null)),
    resolveQrToken: vi.fn(() => Promise.resolve(customerValue())),
  };
  registerCustomerRoutes(app, authentication, service as unknown as CustomersService);
  await app.ready();
  return { app, service };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe('customers HTTP routes (TASK 13.0)', () => {
  describe('POST /api/v1/customers', () => {
    it('creates under customer.create and rejects without it', async () => {
      const allowed = await fixture(['customer.create']);
      const ok = await allowed.app.inject({
        method: 'POST',
        url: '/api/v1/customers',
        headers: { authorization: 'Bearer token', 'idempotency-key': 'cust-1' },
        payload: { first_name: 'Ana' },
      });
      expect(ok.statusCode).toBe(201);
      expect(allowed.service.createCustomer).toHaveBeenCalledTimes(1);

      const denied = await fixture(['customer.read']);
      const rejected = await denied.app.inject({
        method: 'POST',
        url: '/api/v1/customers',
        headers: { authorization: 'Bearer token', 'idempotency-key': 'cust-1' },
        payload: { first_name: 'Ana' },
      });
      expect(rejected.statusCode).toBe(403);
      expect(denied.service.createCustomer).not.toHaveBeenCalled();
    });

    it('requires an Idempotency-Key header', async () => {
      const { app } = await fixture(['customer.create']);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/customers',
        headers: { authorization: 'Bearer token' },
        payload: { first_name: 'Ana' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('rejects a missing first_name at the schema boundary', async () => {
      const { app, service } = await fixture(['customer.create']);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/customers',
        headers: { authorization: 'Bearer token', 'idempotency-key': 'cust-bad' },
        payload: {},
      });
      expect(response.statusCode).toBe(400);
      expect(service.createCustomer).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/customers', () => {
    it('lists under an authenticated request, never exposing phone/email in the summary row (Part AB)', async () => {
      const { app } = await fixture(['customer.read']);
      const response = await app.inject({ method: 'GET', url: '/api/v1/customers', headers: { authorization: 'Bearer token' } });
      expect(response.statusCode).toBe(200);
      const body = response.json<{ data: Record<string, unknown>[] }>();
      expect(body.data[0]).not.toHaveProperty('email');
      expect(body.data[0]).not.toHaveProperty('phone');
      expect(body.data[0]).toHaveProperty('display_name');
    });
  });

  describe('GET /api/v1/customers/:id', () => {
    it('reads a full customer record', async () => {
      const { app, service } = await fixture(['customer.read']);
      const response = await app.inject({ method: 'GET', url: `/api/v1/customers/${customerId}`, headers: { authorization: 'Bearer token' } });
      expect(response.statusCode).toBe(200);
      expect(service.customer).toHaveBeenCalledTimes(1);
    });
  });

  describe('PATCH /api/v1/customers/:id', () => {
    it('updates under customer.update and rejects without it', async () => {
      const allowed = await fixture(['customer.update']);
      const ok = await allowed.app.inject({
        method: 'PATCH',
        url: `/api/v1/customers/${customerId}`,
        headers: { authorization: 'Bearer token', 'if-match': '"1"' },
        payload: { notes: 'VIP' },
      });
      expect(ok.statusCode).toBe(200);

      const denied = await fixture(['customer.read']);
      const rejected = await denied.app.inject({
        method: 'PATCH',
        url: `/api/v1/customers/${customerId}`,
        headers: { authorization: 'Bearer token', 'if-match': '"1"' },
        payload: { notes: 'VIP' },
      });
      expect(rejected.statusCode).toBe(403);
    });
  });

  describe('QR identity routes (Part U)', () => {
    it('issuing a token never requires customer.create, only customer.update', async () => {
      const { app, service } = await fixture(['customer.update']);
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/customers/${customerId}/qr-tokens`,
        headers: { authorization: 'Bearer token' },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json<{ data: { token: string } }>();
      expect(body.data.token).toBe('opaque-token-value');
      expect(service.issueQrToken).toHaveBeenCalledTimes(1);
    });
  });
});
