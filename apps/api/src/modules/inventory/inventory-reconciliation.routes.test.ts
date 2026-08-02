import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@asone/errors';

import type { AuthService } from '../auth/auth.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { registerInventoryReconciliationRoutes } from './inventory-reconciliation.routes.js';
import type { InventoryRepairService } from './inventory-repair.service.js';
import type { RepairFinding } from './inventory-repair.types.js';

const companyId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const branchId = '00000000-0000-4000-8000-000000000003';
const findingId = '00000000-0000-7000-8000-000000000004';
const fingerprint = 'a'.repeat(64);
const apps: FastifyInstance[] = [];

function finding(): RepairFinding {
  const now = new Date('2026-08-01T12:00:00.000Z');
  return {
    id: findingId,
    companyId,
    branchId,
    inventoryLocationId: null,
    productVariantId: null,
    aggregateType: 'inventory_balance',
    aggregateId: findingId,
    findingType: 'balance_on_hand_drift',
    severity: 'warning',
    status: 'open',
    fingerprint,
    detectorVersion: 'v1',
    snapshotAt: now,
    firstDetectedAt: now,
    lastDetectedAt: now,
    occurrenceCount: 1n,
    expectedSummary: { quantity: '1.000000' },
    actualSummary: { quantity: '0.000000' },
    evidence: { safe: true, nested: { token: 'redact', value: 1 }, sql: 'redact' },
    acknowledgedAt: null,
    acknowledgedBy: null,
    resolvedAt: null,
    resolvedBy: null,
    dismissedAt: null,
    dismissedBy: null,
    resolutionReasonCode: null,
    resolutionNote: null,
    version: 1n,
  };
}

async function fixture(
  permissions = ['inventory.reconcile', 'inventory.approve'],
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
        throw new AppError({ code: 'permission_denied', statusCode: 403, message: 'Denied' });
    }),
    requireBranchAccess: vi.fn(),
  } as unknown as AuthService;
  const value = finding();
  const service = {
    list: vi.fn(() => Promise.resolve({ items: [value], nextCursor: 'next' })),
    detail: vi.fn(() => Promise.resolve(value)),
    acknowledge: vi.fn(() =>
      Promise.resolve({
        value: {
          finding_id: findingId,
          previous_status: 'open',
          new_status: 'acknowledged',
          version: 2,
        },
        replayed: false,
      }),
    ),
    dismiss: vi.fn(() =>
      Promise.resolve({
        value: {
          finding_id: findingId,
          previous_status: 'open',
          new_status: 'dismissed',
          version: 2,
        },
        replayed: false,
      }),
    ),
    preview: vi.fn(() =>
      Promise.resolve({
        findingId,
        repairable: true,
        strategy: 'rebuild_on_hand_projection',
        expected: {},
        actual: {},
        proposedMutations: [],
        affectedBalanceIds: [],
        movement: null,
        expectedEvents: ['inventory.stock.changed'],
        warnings: [],
        snapshotAt: value.snapshotAt,
        issuedAt: value.snapshotAt,
        expiresAt: new Date(value.snapshotAt.getTime() + 300_000),
        fingerprint,
      }),
    ),
    repair: vi.fn(() =>
      Promise.resolve({
        value: {
          finding_id: findingId,
          previous_status: 'open',
          new_status: 'resolved',
          strategy: 'rebuild_on_hand_projection',
          affected_balance_count: 1,
          movement_id: null,
          repaired_at: value.snapshotAt.toISOString(),
          version: 2,
        },
        replayed: false,
      }),
    ),
  };
  registerInventoryReconciliationRoutes(
    app,
    authentication,
    service as unknown as InventoryRepairService,
  );
  await app.ready();
  return { app, service };
}

afterEach(async () => Promise.all(apps.splice(0).map(async (app) => app.close())));

describe('inventory reconciliation E155-E160 HTTP routes', () => {
  it('lists summaries, filters strictly, and returns sanitized detail with ETag', async () => {
    const { app, service } = await fixture();
    const listed = await app.inject({
      method: 'GET',
      url: `/api/v1/inventory/reconciliation/findings?branch_id=${branchId}&status=open&limit=20`,
      headers: { authorization: 'Bearer x' },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json<{ data: unknown[] }>().data[0]).not.toHaveProperty('evidence');
    expect(service.list).toHaveBeenCalledWith(
      companyId,
      [branchId],
      expect.objectContaining({ branchId, status: 'open', limit: 20 }),
    );
    const detailed = await app.inject({
      method: 'GET',
      url: `/api/v1/inventory/reconciliation/findings/${findingId}`,
      headers: { authorization: 'Bearer x' },
    });
    expect(detailed).toMatchObject({ statusCode: 200, headers: { etag: '"1"' } });
    expect(
      detailed.json<{ data: { evidence: Readonly<Record<string, unknown>> } }>().data.evidence,
    ).not.toHaveProperty('sql');
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/inventory/reconciliation/findings?unknown=x',
          headers: { authorization: 'Bearer x' },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('maps lifecycle and preview commands with strict headers and bodies', async () => {
    const { app, service } = await fixture();
    for (const action of ['acknowledgements', 'dismissals']) {
      const reply = await app.inject({
        method: 'POST',
        url: `/api/v1/inventory/reconciliation/findings/${findingId}/${action}`,
        headers: { authorization: 'Bearer x', 'if-match': '"1"', 'idempotency-key': action },
        payload: { reason_code: 'reviewed' },
      });
      expect(reply).toMatchObject({ statusCode: 200, headers: { etag: '"2"' } });
    }
    const preview = await app.inject({
      method: 'POST',
      url: `/api/v1/inventory/reconciliation/findings/${findingId}/repair-previews`,
      headers: { authorization: 'Bearer x', 'if-match': '"1"' },
      payload: { strategy: 'rebuild_on_hand_projection', expected_fingerprint: fingerprint },
    });
    expect(preview.statusCode).toBe(200);
    expect(service.preview).toHaveBeenCalled();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/inventory/reconciliation/findings/${findingId}/acknowledgements`,
          headers: { authorization: 'Bearer x' },
          payload: { reason_code: 'x' },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('requires both permissions for repair and rejects unknown fields', async () => {
    const payload = {
      strategy: 'rebuild_on_hand_projection',
      expected_fingerprint: fingerprint,
      preview_fingerprint: fingerprint,
      preview_expires_at: '2026-08-01T12:05:00.000Z',
      reason_code: 'repair',
    };
    const { app } = await fixture(['inventory.reconcile']);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/inventory/reconciliation/findings/${findingId}/repairs`,
          headers: { authorization: 'Bearer x', 'if-match': '"1"', 'idempotency-key': 'repair' },
          payload,
        })
      ).statusCode,
    ).toBe(403);
    const { app: authorized } = await fixture();
    expect(
      (
        await authorized.inject({
          method: 'POST',
          url: `/api/v1/inventory/reconciliation/findings/${findingId}/repairs`,
          headers: { authorization: 'Bearer x', 'if-match': '"1"', 'idempotency-key': 'repair' },
          payload: { ...payload, company_id: companyId },
        })
      ).statusCode,
    ).toBe(400);
  });
});
