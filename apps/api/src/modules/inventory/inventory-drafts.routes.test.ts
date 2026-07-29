import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@asone/errors';

import type { AuthService } from '../auth/auth.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { registerInventoryDraftRoutes } from './inventory-drafts.routes.js';
import type { InventoryDraftService } from './inventory-drafts.service.js';

const companyId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const branchId = '00000000-0000-4000-8000-000000000003';
const movementId = '00000000-0000-7000-8000-000000000004';
const lineId = '00000000-0000-4000-8000-000000000005';
const apps: FastifyInstance[] = [];

function movement(version = 1): Readonly<Record<string, unknown>> {
  return {
    id: movementId,
    branch_id: branchId,
    movement_number: `IMV-${movementId.replaceAll('-', '')}`,
    movement_type: 'adjustment',
    status: 'draft',
    reason_code: null,
    reference_type: null,
    reference_id: null,
    source_document_number: null,
    notes: null,
    version,
    occurred_at: '2026-07-27T00:00:00.000Z',
    posted_at: null,
    cancelled_at: null,
    reversed_at: null,
    created_at: '2026-07-27T00:00:00.000Z',
    updated_at: '2026-07-27T00:00:00.000Z',
    line_count: 0,
  };
}

async function fixture(permissions = ['inventory.read', 'inventory.adjust']): Promise<{
  app: FastifyInstance;
  service: Record<string, ReturnType<typeof vi.fn>>;
}> {
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
  } as unknown as AuthService;
  const service = {
    create: vi.fn(() => Promise.resolve({ value: movement(), replayed: false })),
    get: vi.fn(() =>
      Promise.resolve({
        id: movementId,
        companyId,
        branchId,
        movementNumber: `IMV-${movementId.replaceAll('-', '')}`,
        movementType: 'adjustment',
        status: 'draft',
        reasonCode: null,
        referenceType: null,
        referenceId: null,
        sourceDocumentNumber: null,
        notes: null,
        version: 1n,
        occurredAt: new Date('2026-07-27T00:00:00.000Z'),
        postedAt: null,
        cancelledAt: null,
        reversedAt: null,
        createdAt: new Date('2026-07-27T00:00:00.000Z'),
        updatedAt: new Date('2026-07-27T00:00:00.000Z'),
        lineCount: 0,
      }),
    ),
    patch: vi.fn(),
    cancel: vi.fn(),
    listLines: vi.fn(() => Promise.resolve({ items: [], nextCursor: null })),
    addLine: vi.fn(() =>
      Promise.resolve({
        value: { line: { id: lineId }, version: 2 },
        replayed: false,
      }),
    ),
    patchLine: vi.fn(),
    deleteLine: vi.fn(),
  };
  registerInventoryDraftRoutes(app, authentication, service as unknown as InventoryDraftService);
  await app.ready();
  return { app, service };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe('inventory draft E145-E152 HTTP routes', () => {
  it('creates a header with required idempotency and strict input', async () => {
    const { app, service } = await fixture();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/movements',
      headers: { authorization: 'Bearer token', 'idempotency-key': 'create-draft' },
      payload: { branch_id: branchId, movement_type: 'adjustment' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.headers.etag).toBe('"1"');
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({ companyId, actorId: userId }),
      [branchId],
      'create-draft',
      expect.objectContaining({ branchId, movementType: 'adjustment' }),
    );
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/movements',
      headers: { authorization: 'Bearer token', 'idempotency-key': 'bad' },
      payload: { branch_id: branchId, movement_type: 'adjustment', status: 'posted' },
    });
    expect(unknown).toMatchObject({ statusCode: 400 });
  });

  it('requires exact permissions and strong ETags', async () => {
    const denied = await fixture(['inventory.read']);
    expect(
      (
        await denied.app.inject({
          method: 'PATCH',
          url: `/api/v1/inventory/movements/${movementId}`,
          headers: { authorization: 'Bearer token', 'if-match': '"1"' },
          payload: { notes: 'changed' },
        })
      ).statusCode,
    ).toBe(403);
    const allowed = await fixture();
    expect(
      (
        await allowed.app.inject({
          method: 'DELETE',
          url: `/api/v1/inventory/movements/${movementId}/lines/${lineId}`,
          headers: { authorization: 'Bearer token', 'if-match': '1' },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('reads details and paginated lines using inventory.read', async () => {
    const { app, service } = await fixture();
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/inventory/movements/${movementId}`,
      headers: { authorization: 'Bearer token' },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.headers.etag).toBe('"1"');
    const lines = await app.inject({
      method: 'GET',
      url: `/api/v1/inventory/movements/${movementId}/lines?limit=10`,
      headers: { authorization: 'Bearer token' },
    });
    expect(lines.statusCode).toBe(200);
    expect(service.listLines).toHaveBeenCalledWith(companyId, [branchId], movementId, false, {
      limit: 10,
    });
  });

  it('requires both command headers when adding a line', async () => {
    const { app, service } = await fixture();
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/inventory/movements/${movementId}/lines`,
      headers: {
        authorization: 'Bearer token',
        'if-match': '"1"',
        'idempotency-key': 'add-line',
      },
      payload: {
        product_variant_id: lineId,
        destination_inventory_location_id: branchId,
        quantity: '1',
        unit_of_measure_code: 'unit',
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.headers.etag).toBe('"2"');
    expect(service.addLine).toHaveBeenCalledOnce();
  });
});
