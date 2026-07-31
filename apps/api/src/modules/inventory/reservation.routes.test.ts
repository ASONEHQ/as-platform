import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@asone/errors';

import type { AuthService } from '../auth/auth.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { registerInventoryReservationRoutes } from './reservation.routes.js';
import type { InventoryReservationService } from './reservation.service.js';

const companyId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const branchId = '00000000-0000-4000-8000-000000000003';
const locationId = '00000000-0000-4000-8000-000000000004';
const variantId = '00000000-0000-4000-8000-000000000005';
const reservationId = '00000000-0000-7000-8000-000000000006';
const apps: FastifyInstance[] = [];

function response(status = 'active', version = 1): Readonly<Record<string, unknown>> {
  return {
    id: reservationId,
    reservation_number: `RES-${reservationId.replaceAll('-', '')}`,
    branch_id: branchId,
    owner_type: 'pos_cart',
    owner_id: 'cart-1',
    status,
    version,
    location_ids: [locationId],
    location_count: 1,
    lines: [],
  };
}

async function fixture(
  permissions = ['inventory.read', 'inventory.reservation.manage'],
  replayed = false,
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
  const auth: AuthContext = {
    companyId,
    userId,
    membershipId: userId,
    sessionId: userId,
    expiresAt: new Date(Date.now() + 60_000),
    permissions,
    permittedBranchIds: [branchId],
  };
  const authentication = {
    authenticate: vi.fn(() => Promise.resolve(auth)),
    requirePermission: vi.fn((_context: AuthContext, permission: string) => {
      if (!permissions.includes(permission))
        throw new AppError({ code: 'permission_denied', message: 'Denied', statusCode: 403 });
    }),
  } as unknown as AuthService;
  const service = {
    create: vi.fn(() => Promise.resolve({ value: response(), replayed })),
    list: vi.fn(() => Promise.resolve({ items: [response()], nextCursor: 'next' })),
    get: vi.fn(() =>
      Promise.resolve({
        id: reservationId,
        companyId,
        branchId,
        reservationNumber: `RES-${reservationId.replaceAll('-', '')}`,
        ownerType: 'pos_cart',
        ownerId: 'cart-1',
        status: 'active',
        expiresAt: null,
        confirmedAt: null,
        releasedAt: null,
        expiredAt: null,
        cancelledAt: null,
        createdBy: userId,
        confirmedBy: null,
        releasedBy: null,
        expiredBy: null,
        cancelledBy: null,
        version: 1n,
        createdAt: new Date('2026-07-31T00:00:00.000Z'),
        updatedAt: new Date('2026-07-31T00:00:00.000Z'),
        confirmationMovementId: null,
        lines: [],
      }),
    ),
    confirm: vi.fn(() => Promise.resolve({ value: response('confirmed', 2), replayed })),
    release: vi.fn((_ctx, _branches, _id, _version, _key, body: { action: string }) =>
      Promise.resolve({ value: response(`${body.action}d`, 2), replayed }),
    ),
  };
  registerInventoryReservationRoutes(
    app,
    authentication,
    service as unknown as InventoryReservationService,
  );
  await app.ready();
  return { app, service };
}

afterEach(async () => Promise.all(apps.splice(0).map(async (app) => app.close())));

describe('inventory reservation E124-E128 HTTP routes', () => {
  it('creates a strict multi-location reservation with permission, idempotency and ETag', async () => {
    const { app, service } = await fixture();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/reservations',
      headers: { authorization: 'Bearer token', 'idempotency-key': 'reserve' },
      payload: {
        branch_id: branchId,
        owner_type: 'pos_cart',
        owner_id: 'cart-1',
        lines: [
          {
            location_id: locationId,
            product_variant_id: variantId,
            quantity: '2',
            unit_of_measure_code: 'unit',
          },
        ],
      },
    });
    expect(created).toMatchObject({ statusCode: 201, headers: { etag: '"1"' } });
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({ companyId, actorId: userId }),
      [branchId],
      'reserve',
      expect.objectContaining({ branchId, ownerType: 'pos_cart' }),
    );
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/reservations',
      headers: { authorization: 'Bearer token', 'idempotency-key': 'invalid' },
      payload: {
        branch_id: branchId,
        owner_type: 'pos_cart',
        owner_id: 'cart-1',
        status: 'confirmed',
        lines: [],
      },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it('lists and reads with inventory.read, stable pagination and a strong ETag', async () => {
    const { app, service } = await fixture();
    const listed = await app.inject({
      method: 'GET',
      url: `/api/v1/inventory/reservations?branch_id=${branchId}&status=active&limit=10`,
      headers: { authorization: 'Bearer token' },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json<{ meta: { page: unknown } }>().meta.page).toEqual({
      next_cursor: 'next',
      has_more: true,
    });
    expect(service.list).toHaveBeenCalledWith(
      companyId,
      [branchId],
      expect.objectContaining({ branchId, status: 'active', limit: 10 }),
    );
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/inventory/reservations/${reservationId}`,
      headers: { authorization: 'Bearer token' },
    });
    expect(detail).toMatchObject({ statusCode: 200, headers: { etag: '"1"' } });
  });

  it('maps confirmation and discriminated release actions with strict If-Match', async () => {
    const { app, service } = await fixture();
    const confirmed = await app.inject({
      method: 'POST',
      url: `/api/v1/inventory/reservations/${reservationId}/confirmations`,
      headers: {
        authorization: 'Bearer token',
        'idempotency-key': 'confirm',
        'if-match': '"1"',
      },
      payload: {},
    });
    expect(confirmed).toMatchObject({ statusCode: 200, headers: { etag: '"2"' } });
    expect(service.confirm).toHaveBeenCalled();
    for (const action of ['release', 'expire', 'cancel'] as const) {
      const released = await app.inject({
        method: 'POST',
        url: `/api/v1/inventory/reservations/${reservationId}/releases`,
        headers: {
          authorization: 'Bearer token',
          'idempotency-key': action,
          'if-match': '"1"',
        },
        payload: { action, reason_code: 'OWNER_COMMAND' },
      });
      expect(released.statusCode).toBe(200);
    }
    const invalid = await app.inject({
      method: 'POST',
      url: `/api/v1/inventory/reservations/${reservationId}/confirmations`,
      headers: {
        authorization: 'Bearer token',
        'idempotency-key': 'bad-etag',
        'if-match': '1',
      },
      payload: { quantity: '1' },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it('denies mutation without permission and marks exact replay', async () => {
    const denied = await fixture(['inventory.read']);
    expect(
      (
        await denied.app.inject({
          method: 'POST',
          url: `/api/v1/inventory/reservations/${reservationId}/confirmations`,
          headers: {
            authorization: 'Bearer token',
            'idempotency-key': 'denied',
            'if-match': '"1"',
          },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    const replay = await fixture(undefined, true);
    const responseValue = await replay.app.inject({
      method: 'POST',
      url: `/api/v1/inventory/reservations/${reservationId}/confirmations`,
      headers: {
        authorization: 'Bearer token',
        'idempotency-key': 'replay',
        'if-match': '"1"',
      },
      payload: {},
    });
    expect(responseValue.headers['idempotency-replayed']).toBe('true');
  });
});
