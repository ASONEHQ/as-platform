import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, type Mock, vi } from 'vitest';

import { AppError } from '@asone/errors';

import type { AuthService } from '../auth/auth.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { registerInventoryRoutes } from './inventory.routes.js';
import type {
  InventoryBalanceReadService,
  InventoryLocationService,
  InventoryMovementReadService,
} from './inventory.service.js';

const companyId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const branchId = '00000000-0000-4000-8000-000000000003';
const locationId = '00000000-0000-4000-8000-000000000004';
const now = new Date('2026-07-27T00:00:00.000Z');
const location = {
  id: locationId,
  companyId,
  branchId,
  code: 'MAIN',
  normalizedCode: 'main',
  name: 'Main',
  description: null,
  locationType: 'main' as const,
  status: 'active' as const,
  allowsReceiving: true,
  allowsIssuing: true,
  isDefault: true,
  version: 1n,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
};
const apps: FastifyInstance[] = [];

interface Fixture {
  app: FastifyInstance;
  listLocations: Mock;
  createLocation: Mock;
  patchLocation: Mock;
  listBalances: Mock;
  listMovements: Mock;
}

async function fixture(
  permissions: string[] = ['inventory.read', 'inventory_location.manage'],
  permittedBranchIds: string[] = [branchId],
): Promise<Fixture> {
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
  const context: AuthContext = {
    companyId,
    userId,
    membershipId: userId,
    sessionId: userId,
    expiresAt: new Date(Date.now() + 60_000),
    permissions,
    permittedBranchIds,
  };
  const authentication = {
    authenticate: vi.fn(() => Promise.resolve(context)),
    requirePermission: vi.fn((_context: AuthContext, permission: string) => {
      if (!permissions.includes(permission))
        throw new AppError({ code: 'permission_denied', message: 'Denied', statusCode: 403 });
    }),
    requireBranchAccess: vi.fn((_context: AuthContext, requestedBranchId: string) => {
      if (!permittedBranchIds.includes(requestedBranchId))
        throw new AppError({ code: 'permission_denied', message: 'Denied', statusCode: 403 });
    }),
  } as unknown as AuthService;
  const listLocations = vi.fn(() => Promise.resolve({ items: [location], nextCursor: locationId }));
  const createLocation = vi.fn(() => Promise.resolve({ value: location, replayed: false }));
  const patchLocation = vi.fn(() => Promise.resolve({ ...location, version: 2n }));
  const listBalances = vi.fn(() =>
    Promise.resolve({
      items: [
        {
          id: locationId,
          quantity_on_hand: '10.000000',
          quantity_reserved: '2.000000',
          quantity_available: '8.000000',
          average_unit_cost: '4.5000',
          currency_code: 'MXN',
        },
      ],
      nextCursor: null,
    }),
  );
  const listMovements = vi.fn(() =>
    Promise.resolve({
      items: [{ id: locationId, status: 'posted', movement_type: 'adjustment' }],
      nextCursor: null,
    }),
  );
  registerInventoryRoutes(
    app,
    authentication,
    {
      list: listLocations,
      create: createLocation,
      patch: patchLocation,
    } as unknown as InventoryLocationService,
    { list: listBalances } as unknown as InventoryBalanceReadService,
    { list: listMovements } as unknown as InventoryMovementReadService,
  );
  await app.ready();
  return {
    app,
    listLocations,
    createLocation,
    patchLocation,
    listBalances,
    listMovements,
  };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe('inventory E064-E068 HTTP routes', () => {
  it('applies location filters, branch scope, and stable pagination metadata', async () => {
    const { app, listLocations } = await fixture();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/inventory/locations?branch_id=${branchId}&type=main&status=active&limit=25`,
      headers: { authorization: 'Bearer token' },
    });
    expect(response.statusCode).toBe(200);
    expect(listLocations).toHaveBeenCalledWith(companyId, [branchId], {
      limit: 25,
      branchId,
      locationType: 'main',
      status: 'active',
    });
    expect(response.json()).toMatchObject({ meta: { page: { has_more: true } } });
  });

  it('requires location permissions, branch access, idempotency, and If-Match', async () => {
    const denied = await fixture([]);
    expect(
      (
        await denied.app.inject({
          method: 'GET',
          url: '/api/v1/inventory/locations',
          headers: { authorization: 'Bearer token' },
        })
      ).statusCode,
    ).toBe(403);

    const scoped = await fixture(undefined, []);
    expect(
      (
        await scoped.app.inject({
          method: 'POST',
          url: '/api/v1/inventory/locations',
          headers: { authorization: 'Bearer token', 'idempotency-key': 'key' },
          payload: {
            branch_id: branchId,
            code: 'MAIN',
            name: 'Main',
            location_type: 'main',
          },
        })
      ).statusCode,
    ).toBe(403);

    const allowed = await fixture();
    const missingKey = await allowed.app.inject({
      method: 'POST',
      url: '/api/v1/inventory/locations',
      headers: { authorization: 'Bearer token' },
      payload: { branch_id: branchId, code: 'MAIN', name: 'Main', location_type: 'main' },
    });
    const missingVersion = await allowed.app.inject({
      method: 'PATCH',
      url: `/api/v1/inventory/locations/${locationId}`,
      headers: { authorization: 'Bearer token' },
      payload: { name: 'Updated' },
    });
    expect(missingKey.json()).toMatchObject({ error: { code: 'validation_error' } });
    expect(missingVersion.json()).toMatchObject({ error: { code: 'validation_error' } });
  });

  it('maps creation and update using server tenant context and version headers', async () => {
    const { app, createLocation, patchLocation } = await fixture();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/locations',
      headers: { authorization: 'Bearer token', 'idempotency-key': 'create-key' },
      payload: {
        branch_id: branchId,
        code: ' MAIN ',
        name: 'Main',
        location_type: 'main',
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.headers.etag).toBe('"1"');
    expect(createLocation).toHaveBeenCalledWith(
      expect.objectContaining({ companyId, actorId: userId }),
      'create-key',
      expect.objectContaining({ branchId, code: ' MAIN ' }),
    );
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/inventory/locations/${locationId}`,
      headers: { authorization: 'Bearer token', 'if-match': '"1"' },
      payload: { name: 'Updated' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.headers.etag).toBe('"2"');
    expect(patchLocation).toHaveBeenCalledWith(
      expect.objectContaining({ companyId, actorId: userId }),
      [branchId],
      locationId,
      1n,
      { name: 'Updated' },
    );
  });

  it('rejects unknown fields and exact-enum violations', async () => {
    const { app } = await fixture();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/locations',
      headers: { authorization: 'Bearer token', 'idempotency-key': 'key' },
      payload: {
        company_id: companyId,
        branch_id: branchId,
        code: 'MAIN',
        name: 'Main',
        location_type: 'warehouse',
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'validation_error' } });
  });

  it('redacts balance costs unless the effective permission includes cost reads', async () => {
    const ordinary = await fixture(['inventory.read']);
    await ordinary.app.inject({
      method: 'GET',
      url: '/api/v1/inventory/balances',
      headers: { authorization: 'Bearer token' },
    });
    expect(ordinary.listBalances).toHaveBeenCalledWith(companyId, [branchId], false, {
      limit: 50,
    });
    const privileged = await fixture(['inventory.read', 'inventory.cost.read']);
    await privileged.app.inject({
      method: 'GET',
      url: '/api/v1/inventory/balances',
      headers: { authorization: 'Bearer token' },
    });
    expect(privileged.listBalances).toHaveBeenCalledWith(companyId, [branchId], true, {
      limit: 50,
    });
  });

  it('passes movement filters to the read-only service and rejects unknown query fields', async () => {
    const { app, listMovements } = await fixture();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/inventory/movements?branch_id=${branchId}&status=posted&type=adjustment`,
      headers: { authorization: 'Bearer token' },
    });
    expect(response.statusCode).toBe(200);
    expect(listMovements).toHaveBeenCalledWith(companyId, [branchId], {
      limit: 50,
      branchId,
      status: 'posted',
      movementType: 'adjustment',
    });
    const invalid = await app.inject({
      method: 'GET',
      url: '/api/v1/inventory/movements?include_lines=true',
      headers: { authorization: 'Bearer token' },
    });
    expect(invalid.statusCode).toBe(400);
  });
});
