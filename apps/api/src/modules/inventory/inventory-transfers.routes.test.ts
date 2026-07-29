import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@asone/errors';

import type { AuthService } from '../auth/auth.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { registerInventoryTransferRoutes } from './inventory-transfers.routes.js';
import type { InventoryTransferService } from './inventory-transfers.service.js';

const companyId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const sourceBranchId = '00000000-0000-4000-8000-000000000003';
const destinationBranchId = '00000000-0000-4000-8000-000000000004';
const sourceLocationId = '00000000-0000-4000-8000-000000000005';
const destinationLocationId = '00000000-0000-4000-8000-000000000006';
const transitLocationId = '00000000-0000-4000-8000-000000000007';
const variantId = '00000000-0000-4000-8000-000000000008';
const transferId = '00000000-0000-7000-8000-000000000009';
const apps: FastifyInstance[] = [];

function response(status = 'requested', version = 1): Readonly<Record<string, unknown>> {
  return {
    id: transferId,
    transfer_number: `ITR-${transferId.replaceAll('-', '')}`,
    status,
    version,
    source_branch_id: sourceBranchId,
    destination_branch_id: destinationBranchId,
    source_location_id: sourceLocationId,
    destination_location_id: destinationLocationId,
    transit_location_id: transitLocationId,
    lines: [],
  };
}

async function fixture(
  permissions = ['inventory.read', 'inventory.transfer', 'inventory.approve', 'inventory.receive'],
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
    permittedBranchIds: [sourceBranchId, destinationBranchId],
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
        id: transferId,
        companyId,
        transferNumber: `ITR-${transferId.replaceAll('-', '')}`,
        status: 'requested',
        sourceBranchId,
        destinationBranchId,
        sourceLocationId,
        destinationLocationId,
        transitLocationId,
        requestedAt: new Date('2026-07-29T00:00:00.000Z'),
        approvedAt: null,
        shippedAt: null,
        receivedAt: null,
        rejectedAt: null,
        cancelledAt: null,
        requestedBy: userId,
        approvedBy: null,
        shippedBy: null,
        receivedBy: null,
        rejectedBy: null,
        cancelledBy: null,
        shipmentMovementId: null,
        receiptMovementId: null,
        notes: null,
        version: 1n,
        createdAt: new Date('2026-07-29T00:00:00.000Z'),
        updatedAt: new Date('2026-07-29T00:00:00.000Z'),
        lines: [],
      }),
    ),
    decision: vi.fn(() => Promise.resolve({ value: response('approved', 2), replayed })),
    ship: vi.fn(() => Promise.resolve({ value: response('shipped', 3), replayed })),
    receive: vi.fn(() => Promise.resolve({ value: response('received', 4), replayed })),
    cancel: vi.fn(() => Promise.resolve({ value: response('cancelled', 2), replayed })),
  };
  registerInventoryTransferRoutes(
    app,
    authentication,
    service as unknown as InventoryTransferService,
  );
  await app.ready();
  return { app, service };
}

afterEach(async () => Promise.all(apps.splice(0).map(async (app) => app.close())));

describe('inventory transfer E108-E114 HTTP routes', () => {
  it('creates a strict requested aggregate with idempotency, branch scope and ETag', async () => {
    const { app, service } = await fixture();
    const responseValue = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/transfers',
      headers: { authorization: 'Bearer token', 'idempotency-key': 'create-transfer' },
      payload: {
        source_branch_id: sourceBranchId,
        destination_branch_id: destinationBranchId,
        source_location_id: sourceLocationId,
        destination_location_id: destinationLocationId,
        transit_location_id: transitLocationId,
        lines: [
          {
            product_variant_id: variantId,
            quantity: '2',
            unit_of_measure_code: 'unit',
          },
        ],
      },
    });
    expect(responseValue).toMatchObject({ statusCode: 201, headers: { etag: '"1"' } });
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({ companyId, actorId: userId }),
      [sourceBranchId, destinationBranchId],
      'create-transfer',
      expect.objectContaining({
        sourceBranchId,
        destinationBranchId,
        transitLocationId,
      }),
    );
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/transfers',
      headers: { authorization: 'Bearer token', 'idempotency-key': 'unknown' },
      payload: {
        source_branch_id: sourceBranchId,
        destination_branch_id: destinationBranchId,
        source_location_id: sourceLocationId,
        destination_location_id: destinationLocationId,
        transit_location_id: transitLocationId,
        lines: [],
        status: 'shipped',
      },
    });
    expect(unknown.statusCode).toBe(400);
  });

  it('lists and reads only through inventory.read with stable pagination and ETag', async () => {
    const { app, service } = await fixture();
    const listed = await app.inject({
      method: 'GET',
      url: `/api/v1/inventory/transfers?branch_id=${sourceBranchId}&status=requested&limit=10`,
      headers: { authorization: 'Bearer token' },
    });
    expect(listed).toMatchObject({ statusCode: 200 });
    expect(listed.json<{ meta: { page: unknown } }>().meta.page).toEqual({
      next_cursor: 'next',
      has_more: true,
    });
    expect(service.list).toHaveBeenCalledWith(
      companyId,
      [sourceBranchId, destinationBranchId],
      expect.objectContaining({ branchId: sourceBranchId, status: 'requested', limit: 10 }),
    );
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/inventory/transfers/${transferId}`,
      headers: { authorization: 'Bearer token' },
    });
    expect(detail).toMatchObject({ statusCode: 200, headers: { etag: '"1"' } });
  });

  it('maps canonical transition routes, permissions, strict bodies and strong ETags', async () => {
    const { app, service } = await fixture();
    const commands = [
      {
        route: 'approvals',
        permission: 'decision',
        body: { decision: 'reject', reason_code: 'DAMAGED' },
      },
      { route: 'shipments', permission: 'ship', body: {} },
      { route: 'receipts', permission: 'receive', body: { note: 'received' } },
      {
        route: 'cancellations',
        permission: 'cancel',
        body: { reason_code: 'NO_LONGER_REQUIRED' },
      },
    ] as const;
    for (const command of commands) {
      const result = await app.inject({
        method: 'POST',
        url: `/api/v1/inventory/transfers/${transferId}/${command.route}`,
        headers: {
          authorization: 'Bearer token',
          'if-match': '"1"',
          'idempotency-key': command.route,
        },
        payload: command.body,
      });
      expect(result.statusCode).toBe(200);
      expect(service[command.permission]).toHaveBeenCalled();
    }
    const invalid = await app.inject({
      method: 'POST',
      url: `/api/v1/inventory/transfers/${transferId}/shipments`,
      headers: {
        authorization: 'Bearer token',
        'if-match': '1',
        'idempotency-key': 'invalid',
      },
      payload: { quantity: '1' },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it('denies missing permission and preserves replay response metadata', async () => {
    const denied = await fixture(['inventory.read']);
    expect(
      (
        await denied.app.inject({
          method: 'POST',
          url: `/api/v1/inventory/transfers/${transferId}/shipments`,
          headers: {
            authorization: 'Bearer token',
            'if-match': '"2"',
            'idempotency-key': 'denied',
          },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    const replay = await fixture(undefined, true);
    const responseValue = await replay.app.inject({
      method: 'POST',
      url: `/api/v1/inventory/transfers/${transferId}/shipments`,
      headers: {
        authorization: 'Bearer token',
        'if-match': '"2"',
        'idempotency-key': 'replay',
      },
      payload: {},
    });
    expect(responseValue.headers['idempotency-replayed']).toBe('true');
    expect(responseValue.headers.etag).toBe('"3"');
  });
});
