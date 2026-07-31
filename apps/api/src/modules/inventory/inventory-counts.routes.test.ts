import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@asone/errors';

import type { AuthService } from '../auth/auth.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { registerInventoryCountRoutes } from './inventory-counts.routes.js';
import type { InventoryCountService } from './inventory-counts.service.js';

const companyId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const branchId = '00000000-0000-4000-8000-000000000003';
const locationId = '00000000-0000-4000-8000-000000000004';
const variantId = '00000000-0000-4000-8000-000000000005';
const countId = '00000000-0000-7000-8000-000000000006';
const apps: FastifyInstance[] = [];
function response(status = 'draft', version = 1): Readonly<Record<string, unknown>> {
  return {
    id: countId,
    count_number: `CNT-${countId.replaceAll('-', '')}`,
    branch_id: branchId,
    location_id: locationId,
    status,
    version,
    scope: { type: 'explicit_variants', product_variant_ids: [variantId] },
    lines: [],
  };
}
async function fixture(
  permissions = ['inventory.read', 'inventory.count', 'inventory.approve'],
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
  const count = {
    id: countId,
    companyId,
    branchId,
    locationId,
    countNumber: `CNT-${countId.replaceAll('-', '')}`,
    status: 'draft',
    scopeType: 'explicit_variants',
    scopeDefinition: { product_variant_ids: [variantId] },
    baselineAt: null,
    lockAcquiredAt: null,
    lockExpiresAt: null,
    startedAt: null,
    startedBy: null,
    submittedAt: null,
    submittedBy: null,
    approvedAt: null,
    approvedBy: null,
    appliedAt: null,
    appliedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    applicationMovementId: null,
    reasonCode: 'cycle_count',
    note: null,
    metadata: null,
    version: 1n,
    createdAt: new Date(),
    updatedAt: new Date(),
    lines: [],
  };
  const service = {
    list: vi.fn(() => Promise.resolve({ items: [response()], nextCursor: 'next' })),
    create: vi.fn(() => Promise.resolve({ value: response(), replayed: false })),
    get: vi.fn(() => Promise.resolve(count)),
    start: vi.fn(() => Promise.resolve({ value: response('counting', 2), replayed: false })),
    recordLine: vi.fn(() => Promise.resolve(response('counting', 3))),
    submit: vi.fn(() => Promise.resolve({ value: response('submitted', 4), replayed: false })),
    approve: vi.fn(() => Promise.resolve({ value: response('approved', 5), replayed: false })),
    apply: vi.fn(() => Promise.resolve({ value: response('applied', 6), replayed: false })),
    cancel: vi.fn(() => Promise.resolve({ value: response('cancelled', 2), replayed: false })),
  };
  registerInventoryCountRoutes(app, authentication, service as unknown as InventoryCountService);
  await app.ready();
  return { app, service };
}
afterEach(async () => Promise.all(apps.splice(0).map(async (app) => app.close())));
describe('durable inventory count E115-E123 HTTP routes', () => {
  it('exposes strict list, create and detail contracts with permissions and ETags', async () => {
    const { app, service } = await fixture();
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/inventory/counts?branch_id=${branchId}&status=draft`,
          headers: { authorization: 'Bearer x' },
        })
      ).statusCode,
    ).toBe(200);
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/counts',
      headers: { authorization: 'Bearer x', 'idempotency-key': 'create' },
      payload: {
        branch_id: branchId,
        location_id: locationId,
        scope: { type: 'explicit_variants', product_variant_ids: [variantId] },
        reason_code: 'cycle_count',
      },
    });
    expect(created).toMatchObject({ statusCode: 201, headers: { etag: '"1"' } });
    expect(service.create).toHaveBeenCalled();
    expect(
      await app.inject({
        method: 'GET',
        url: `/api/v1/inventory/counts/${countId}`,
        headers: { authorization: 'Bearer x' },
      }),
    ).toMatchObject({ statusCode: 200, headers: { etag: '"1"' } });
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/counts',
      headers: { authorization: 'Bearer x', 'idempotency-key': 'bad' },
      payload: {
        branch_id: branchId,
        location_id: locationId,
        scope: { type: 'all_balanced_variants' },
        reason_code: 'x',
        status: 'applied',
      },
    });
    expect(invalid.statusCode).toBe(400);
  });
  it('maps start, line, submit, approve, apply and cancellation exactly', async () => {
    const { app, service } = await fixture();
    for (const path of ['starts', 'submissions', 'approvals', 'applications']) {
      const reply = await app.inject({
        method: 'POST',
        url: `/api/v1/inventory/counts/${countId}/${path}`,
        headers: { authorization: 'Bearer x', 'if-match': '"1"', 'idempotency-key': path },
        payload: {},
      });
      expect(reply.statusCode).toBe(200);
    }
    const line = await app.inject({
      method: 'PUT',
      url: `/api/v1/inventory/counts/${countId}/lines/${variantId}`,
      headers: { authorization: 'Bearer x', 'if-match': '"2"' },
      payload: { counted_quantity: '0', unit_of_measure_code: 'unit' },
    });
    expect(line.statusCode).toBe(200);
    const cancelled = await app.inject({
      method: 'POST',
      url: `/api/v1/inventory/counts/${countId}/cancellations`,
      headers: { authorization: 'Bearer x', 'if-match': '"1"', 'idempotency-key': 'cancel' },
      payload: { reason_code: 'abandoned' },
    });
    expect(cancelled.statusCode).toBe(200);
    expect(service.start).toHaveBeenCalled();
    expect(service.recordLine).toHaveBeenCalled();
    expect(service.submit).toHaveBeenCalled();
    expect(service.approve).toHaveBeenCalled();
    expect(service.apply).toHaveBeenCalled();
    expect(service.cancel).toHaveBeenCalled();
  });
  it('enforces exact permissions and required concurrency headers', async () => {
    const { app } = await fixture(['inventory.read']);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/inventory/counts',
          headers: { authorization: 'Bearer x', 'idempotency-key': 'x' },
          payload: {
            branch_id: branchId,
            location_id: locationId,
            scope: { type: 'all_balanced_variants' },
            reason_code: 'x',
          },
        })
      ).statusCode,
    ).toBe(403);
    const { app: authorized } = await fixture();
    expect(
      (
        await authorized.inject({
          method: 'POST',
          url: `/api/v1/inventory/counts/${countId}/starts`,
          headers: { authorization: 'Bearer x' },
          payload: {},
        })
      ).statusCode,
    ).toBe(400);
  });
});
