import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@asone/errors';

import type { AuthService } from '../auth/auth.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { registerCashRoutes } from './cash.routes.js';
import type { CashService } from './cash.service.js';

const companyId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const branchId = '00000000-0000-4000-8000-000000000003';
const registerId = '00000000-0000-7000-8000-000000000004';
const sessionId = '00000000-0000-7000-8000-000000000005';
const movementId = '00000000-0000-7000-8000-000000000006';
const apps: FastifyInstance[] = [];

function registerValue(): Readonly<Record<string, unknown>> {
  return {
    id: registerId,
    branchId,
    code: 'REG-1',
    name: 'Caja 1',
    status: 'active',
    deviceId: null,
    version: 1n,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  };
}
function sessionValue(overrides?: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return {
    id: sessionId,
    branchId,
    cashRegisterId: registerId,
    openedBy: userId,
    openedAt: new Date('2026-09-01T09:00:00.000Z'),
    openingAmount: '1000.0000',
    currencyCode: 'MXN',
    status: 'open',
    closedBy: null,
    closedAt: null,
    declaredClosingAmount: null,
    expectedClosingAmount: null,
    discrepancyAmount: null,
    denominationCounts: null,
    version: 1n,
    ...overrides,
  };
}
function movementValue(overrides?: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return {
    id: movementId,
    cashSessionId: sessionId,
    movementType: 'cash_in',
    amount: '200.0000',
    currencyCode: 'MXN',
    reasonCode: 'additional_float',
    note: null,
    referenceType: null,
    referenceId: null,
    occurredAt: new Date('2026-09-01T09:30:00.000Z'),
    createdBy: userId,
    reversalOfId: null,
    category: null,
    ...overrides,
  };
}
const reversalMovementId = '00000000-0000-7000-8000-000000000007';
function auditEntryValue(overrides?: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return {
    id: '00000000-0000-7000-8000-000000000008',
    branchId,
    actorType: 'user',
    actorId: userId,
    action: 'cash_session.opened',
    entityType: 'cash_session',
    entityId: sessionId,
    metadata: {},
    occurredAt: new Date('2026-09-01T09:00:00.000Z'),
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
    requireBranchAccess: vi.fn((_context: AuthContext, requestedBranchId: string) => {
      if (requestedBranchId !== branchId)
        throw new AppError({ code: 'branch_access_denied', message: 'Denied', statusCode: 403 });
    }),
  } as unknown as AuthService;
  const service = {
    createRegister: vi.fn(() => Promise.resolve({ value: registerValue(), replayed: false })),
    listRegisters: vi.fn(() => Promise.resolve({ items: [registerValue()], nextCursor: null })),
    register: vi.fn(() => Promise.resolve(registerValue())),
    assignDevice: vi.fn(() => Promise.resolve(registerValue())),
    openSession: vi.fn(() => Promise.resolve({ value: sessionValue(), replayed: false })),
    currentSession: vi.fn(() => Promise.resolve(sessionValue())),
    listSessions: vi.fn(() => Promise.resolve({ items: [sessionValue()], nextCursor: null })),
    session: vi.fn(() => Promise.resolve(sessionValue())),
    summary: vi.fn(() =>
      Promise.resolve({
        session: sessionValue(),
        openingAmount: '1000.0000',
        cashSalesTotal: '29.0000',
        cashSalesCount: 1,
        cashInTotal: '0.0000',
        cashOutTotal: '0.0000',
        expectedCash: '1029.0000',
      }),
    ),
    createMovement: vi.fn(() => Promise.resolve({ value: movementValue(), replayed: false })),
    listMovements: vi.fn(() => Promise.resolve({ items: [movementValue()], nextCursor: null })),
    reverseMovement: vi.fn(() =>
      Promise.resolve({
        value: movementValue({ id: reversalMovementId, movementType: 'cash_out', reversalOfId: movementId }),
        replayed: false,
      }),
    ),
    auditLog: vi.fn(() => Promise.resolve([auditEntryValue()])),
    closeSession: vi.fn(() =>
      Promise.resolve({
        value: sessionValue({
          status: 'closed',
          closedBy: userId,
          closedAt: new Date('2026-09-01T20:00:00.000Z'),
          declaredClosingAmount: '1029.0000',
          expectedClosingAmount: '1029.0000',
          discrepancyAmount: '0.0000',
          version: 2n,
        }),
        replayed: false,
      }),
    ),
  };
  registerCashRoutes(app, authentication, service as unknown as CashService);
  await app.ready();
  return { app, service };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe('cash register HTTP routes (TASK 12.7)', () => {
  describe('POST /api/v1/cash-registers (E039)', () => {
    it('creates under cash_register.manage and rejects without it', async () => {
      const allowed = await fixture(['cash_register.manage']);
      const ok = await allowed.app.inject({
        method: 'POST',
        url: '/api/v1/cash-registers',
        headers: { authorization: 'Bearer token', 'idempotency-key': 'reg-1' },
        payload: { branch_id: branchId, code: 'REG-1', name: 'Caja 1' },
      });
      expect(ok.statusCode).toBe(201);
      expect(allowed.service.createRegister).toHaveBeenCalledTimes(1);

      const denied = await fixture(['cash_register.read']);
      const rejected = await denied.app.inject({
        method: 'POST',
        url: '/api/v1/cash-registers',
        headers: { authorization: 'Bearer token', 'idempotency-key': 'reg-1' },
        payload: { branch_id: branchId, code: 'REG-1', name: 'Caja 1' },
      });
      expect(rejected.statusCode).toBe(403);
      expect(denied.service.createRegister).not.toHaveBeenCalled();
    });

    it('rejects a register for a branch the actor cannot access', async () => {
      const { app, service } = await fixture(['cash_register.manage']);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/cash-registers',
        headers: { authorization: 'Bearer token', 'idempotency-key': 'reg-branch' },
        payload: { branch_id: '00000000-0000-4000-8000-00000000ffff', code: 'REG-1', name: 'Caja 1' },
      });
      expect(response.statusCode).toBe(403);
      expect(service.createRegister).not.toHaveBeenCalled();
    });

    it('requires an Idempotency-Key header', async () => {
      const { app } = await fixture(['cash_register.manage']);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/cash-registers',
        headers: { authorization: 'Bearer token' },
        payload: { branch_id: branchId, code: 'REG-1', name: 'Caja 1' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('reports idempotency replay via response header', async () => {
      const { app, service } = await fixture(['cash_register.manage']);
      service.createRegister?.mockResolvedValueOnce({ value: registerValue(), replayed: true });
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/cash-registers',
        headers: { authorization: 'Bearer token', 'idempotency-key': 'reg-replay' },
        payload: { branch_id: branchId, code: 'REG-1', name: 'Caja 1' },
      });
      expect(response.statusCode).toBe(201);
      expect(response.headers['idempotency-replayed']).toBe('true');
    });
  });

  describe('GET /api/v1/cash-registers (E038)', () => {
    it('lists under cash_register.read and rejects without it', async () => {
      const allowed = await fixture(['cash_register.read']);
      const ok = await allowed.app.inject({
        method: 'GET',
        url: '/api/v1/cash-registers',
        headers: { authorization: 'Bearer token' },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({ data: [expect.objectContaining({ id: registerId, code: 'REG-1' })] });

      const denied = await fixture(['cash_register.manage']);
      const rejected = await denied.app.inject({
        method: 'GET',
        url: '/api/v1/cash-registers',
        headers: { authorization: 'Bearer token' },
      });
      expect(rejected.statusCode).toBe(403);
    });

    it('rejects a branch_id filter outside the authorized branch list', async () => {
      const { app, service } = await fixture(['cash_register.read']);
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/cash-registers?branch_id=${'0'.repeat(8)}-0000-4000-8000-000000000099`,
        headers: { authorization: 'Bearer token' },
      });
      expect(response.statusCode).toBe(403);
      expect(service.listRegisters).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/cash-registers/:id (E040)', () => {
    it('reads under cash_register.read and rejects without it', async () => {
      const allowed = await fixture(['cash_register.read']);
      const ok = await allowed.app.inject({
        method: 'GET',
        url: `/api/v1/cash-registers/${registerId}`,
        headers: { authorization: 'Bearer token' },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.headers.etag).toBe('"1"');

      const denied = await fixture(['cash_register.manage']);
      const rejected = await denied.app.inject({
        method: 'GET',
        url: `/api/v1/cash-registers/${registerId}`,
        headers: { authorization: 'Bearer token' },
      });
      expect(rejected.statusCode).toBe(403);
    });
  });

  describe('PUT /api/v1/cash-registers/:id/device-assignment (E041)', () => {
    it('reassigns under cash_register.manage and rejects without it', async () => {
      const allowed = await fixture(['cash_register.manage']);
      const ok = await allowed.app.inject({
        method: 'PUT',
        url: `/api/v1/cash-registers/${registerId}/device-assignment`,
        headers: { authorization: 'Bearer token', 'if-match': '"1"' },
        payload: { device_id: null, reason_code: 'device_removed' },
      });
      expect(ok.statusCode).toBe(200);
      expect(allowed.service.assignDevice).toHaveBeenCalledTimes(1);

      const denied = await fixture(['cash_register.read']);
      const rejected = await denied.app.inject({
        method: 'PUT',
        url: `/api/v1/cash-registers/${registerId}/device-assignment`,
        headers: { authorization: 'Bearer token' },
        payload: { device_id: null, reason_code: 'device_removed' },
      });
      expect(rejected.statusCode).toBe(403);
    });
  });

  describe('POST /api/v1/cash-sessions (E042)', () => {
    it('opens under cash_session.open and rejects without it', async () => {
      const allowed = await fixture(['cash_session.open']);
      const ok = await allowed.app.inject({
        method: 'POST',
        url: '/api/v1/cash-sessions',
        headers: { authorization: 'Bearer token', 'idempotency-key': 'session-1' },
        payload: { cash_register_id: registerId, opening_amount: '1000.0000' },
      });
      expect(ok.statusCode).toBe(201);
      expect(allowed.service.openSession).toHaveBeenCalledTimes(1);
      expect(ok.json()).toMatchObject({ data: { opening_amount: '1000.0000', status: 'open' } });

      const denied = await fixture(['cash_session.read']);
      const rejected = await denied.app.inject({
        method: 'POST',
        url: '/api/v1/cash-sessions',
        headers: { authorization: 'Bearer token', 'idempotency-key': 'session-1' },
        payload: { cash_register_id: registerId, opening_amount: '1000.0000' },
      });
      expect(rejected.statusCode).toBe(403);
      expect(denied.service.openSession).not.toHaveBeenCalled();
    });

    it('requires an Idempotency-Key header', async () => {
      const { app } = await fixture(['cash_session.open']);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/cash-sessions',
        headers: { authorization: 'Bearer token' },
        payload: { cash_register_id: registerId, opening_amount: '1000.0000' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('rejects a malformed opening_amount at the schema boundary before it reaches the service', async () => {
      const { app, service } = await fixture(['cash_session.open']);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/cash-sessions',
        headers: { authorization: 'Bearer token', 'idempotency-key': 'session-bad' },
        payload: { cash_register_id: registerId, opening_amount: 'not-a-number' },
      });
      expect(response.statusCode).toBe(400);
      expect(service.openSession).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/cash-sessions/current (E043)', () => {
    it('reads under cash_session.read and rejects without it', async () => {
      const allowed = await fixture(['cash_session.read']);
      const ok = await allowed.app.inject({
        method: 'GET',
        url: `/api/v1/cash-sessions/current?cash_register_id=${registerId}`,
        headers: { authorization: 'Bearer token' },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({ data: { id: sessionId, status: 'open' } });

      const denied = await fixture(['cash_session.open']);
      const rejected = await denied.app.inject({
        method: 'GET',
        url: `/api/v1/cash-sessions/current?cash_register_id=${registerId}`,
        headers: { authorization: 'Bearer token' },
      });
      expect(rejected.statusCode).toBe(403);
    });

    it('returns null (never an error) when there is no open session — a legitimate answer', async () => {
      const { app, service } = await fixture(['cash_session.read']);
      service.currentSession?.mockResolvedValueOnce(null);
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/cash-sessions/current?cash_register_id=${registerId}`,
        headers: { authorization: 'Bearer token' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ data: null });
    });

    it('requires cash_register_id as a query parameter', async () => {
      const { app } = await fixture(['cash_session.read']);
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/cash-sessions/current',
        headers: { authorization: 'Bearer token' },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /api/v1/cash-sessions — cut history (Part L)', () => {
    it('lists under cash_session.read and rejects without it', async () => {
      const allowed = await fixture(['cash_session.read']);
      const ok = await allowed.app.inject({
        method: 'GET',
        url: '/api/v1/cash-sessions',
        headers: { authorization: 'Bearer token' },
      });
      expect(ok.statusCode).toBe(200);
      expect(allowed.service.listSessions).toHaveBeenCalledTimes(1);

      const denied = await fixture(['cash_session.open']);
      const rejected = await denied.app.inject({
        method: 'GET',
        url: '/api/v1/cash-sessions',
        headers: { authorization: 'Bearer token' },
      });
      expect(rejected.statusCode).toBe(403);
      expect(denied.service.listSessions).not.toHaveBeenCalled();
    });

    it('passes every documented filter straight through to the service, and defaults limit to 50', async () => {
      const { app, service } = await fixture(['cash_session.read']);
      const response = await app.inject({
        method: 'GET',
        url:
          `/api/v1/cash-sessions?branch_id=${branchId}&cash_register_id=${registerId}&opened_by=${userId}` +
          `&status=closed&opened_from=2026-09-01T00:00:00.000Z&opened_to=2026-09-30T00:00:00.000Z&cursor=abc`,
        headers: { authorization: 'Bearer token' },
      });
      expect(response.statusCode).toBe(200);
      expect(service.listSessions).toHaveBeenCalledWith(companyId, [branchId], {
        limit: 50,
        cursor: 'abc',
        branchId,
        cashRegisterId: registerId,
        openedBy: userId,
        status: 'closed',
        openedFrom: new Date('2026-09-01T00:00:00.000Z'),
        openedTo: new Date('2026-09-30T00:00:00.000Z'),
      });
    });

    it('rejects a branch_id filter outside the authorized branch list', async () => {
      const { app, service } = await fixture(['cash_session.read']);
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/cash-sessions?branch_id=${'0'.repeat(8)}-0000-4000-8000-000000000099`,
        headers: { authorization: 'Bearer token' },
      });
      expect(response.statusCode).toBe(403);
      expect(service.listSessions).not.toHaveBeenCalled();
    });

    it('rejects an unknown query parameter and an out-of-range limit', async () => {
      const { app } = await fixture(['cash_session.read']);
      const unknownParam = await app.inject({
        method: 'GET',
        url: '/api/v1/cash-sessions?register=not-a-documented-filter',
        headers: { authorization: 'Bearer token' },
      });
      expect(unknownParam.statusCode).toBe(400);
      const outOfRangeLimit = await app.inject({
        method: 'GET',
        url: '/api/v1/cash-sessions?limit=1000',
        headers: { authorization: 'Bearer token' },
      });
      expect(outOfRangeLimit.statusCode).toBe(400);
    });

    it('is read-only — never calls a mutation method on the service', async () => {
      const { app, service } = await fixture(['cash_session.read']);
      await app.inject({ method: 'GET', url: '/api/v1/cash-sessions', headers: { authorization: 'Bearer token' } });
      expect(service.openSession).not.toHaveBeenCalled();
      expect(service.closeSession).not.toHaveBeenCalled();
      expect(service.createMovement).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/cash-sessions/:id (E044)', () => {
    it('reads under cash_session.read and rejects without it', async () => {
      const allowed = await fixture(['cash_session.read']);
      const ok = await allowed.app.inject({
        method: 'GET',
        url: `/api/v1/cash-sessions/${sessionId}`,
        headers: { authorization: 'Bearer token' },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.headers.etag).toBe('"1"');

      const denied = await fixture(['cash_session.open']);
      const rejected = await denied.app.inject({
        method: 'GET',
        url: `/api/v1/cash-sessions/${sessionId}`,
        headers: { authorization: 'Bearer token' },
      });
      expect(rejected.statusCode).toBe(403);
    });
  });

  describe('GET /api/v1/cash-sessions/:id/summary (E048 / cash-cut summary, Part K)', () => {
    it('reads under cash_session.read, never mixes card totals in, and rejects without it', async () => {
      const allowed = await fixture(['cash_session.read']);
      const ok = await allowed.app.inject({
        method: 'GET',
        url: `/api/v1/cash-sessions/${sessionId}/summary`,
        headers: { authorization: 'Bearer token' },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({
        data: {
          opening_amount: '1000.0000',
          cash_sales_total: '29.0000',
          cash_sales_count: 1,
          cash_in_total: '0.0000',
          cash_out_total: '0.0000',
          expected_cash: '1029.0000',
        },
      });

      const denied = await fixture(['cash_session.open']);
      const rejected = await denied.app.inject({
        method: 'GET',
        url: `/api/v1/cash-sessions/${sessionId}/summary`,
        headers: { authorization: 'Bearer token' },
      });
      expect(rejected.statusCode).toBe(403);
    });
  });

  describe('POST /api/v1/cash-sessions/:id/movements (E045)', () => {
    it('creates under cash_movement.create and rejects without it', async () => {
      const allowed = await fixture(['cash_movement.create']);
      const ok = await allowed.app.inject({
        method: 'POST',
        url: `/api/v1/cash-sessions/${sessionId}/movements`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'movement-1' },
        payload: { movement_type: 'cash_in', amount: '200.0000', reason_code: 'additional_float' },
      });
      expect(ok.statusCode).toBe(201);
      expect(allowed.service.createMovement).toHaveBeenCalledTimes(1);

      const denied = await fixture(['cash_session.read']);
      const rejected = await denied.app.inject({
        method: 'POST',
        url: `/api/v1/cash-sessions/${sessionId}/movements`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'movement-1' },
        payload: { movement_type: 'cash_in', amount: '200.0000', reason_code: 'additional_float' },
      });
      expect(rejected.statusCode).toBe(403);
      expect(denied.service.createMovement).not.toHaveBeenCalled();
    });

    it('requires an Idempotency-Key header', async () => {
      const { app } = await fixture(['cash_movement.create']);
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/cash-sessions/${sessionId}/movements`,
        headers: { authorization: 'Bearer token' },
        payload: { movement_type: 'cash_in', amount: '200.0000', reason_code: 'additional_float' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('rejects an unknown movement_type — only cash_in/cash_out are client-postable', async () => {
      const { app, service } = await fixture(['cash_movement.create']);
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/cash-sessions/${sessionId}/movements`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'movement-bad-type' },
        payload: { movement_type: 'cash_sale', amount: '200.0000', reason_code: 'x' },
      });
      expect(response.statusCode).toBe(400);
      expect(service.createMovement).not.toHaveBeenCalled();
    });

    it('rejects a missing reason_code at the schema boundary', async () => {
      const { app, service } = await fixture(['cash_movement.create']);
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/cash-sessions/${sessionId}/movements`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'movement-noreason' },
        payload: { movement_type: 'cash_in', amount: '200.0000' },
      });
      expect(response.statusCode).toBe(400);
      expect(service.createMovement).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/cash-sessions/:id/movements (E046)', () => {
    it('lists under cash_session.read and rejects without it', async () => {
      const allowed = await fixture(['cash_session.read']);
      const ok = await allowed.app.inject({
        method: 'GET',
        url: `/api/v1/cash-sessions/${sessionId}/movements`,
        headers: { authorization: 'Bearer token' },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({ data: [expect.objectContaining({ id: movementId })] });

      const denied = await fixture(['cash_movement.create']);
      const rejected = await denied.app.inject({
        method: 'GET',
        url: `/api/v1/cash-sessions/${sessionId}/movements`,
        headers: { authorization: 'Bearer token' },
      });
      expect(rejected.statusCode).toBe(403);
    });

    it('is read-only — never calls createMovement', async () => {
      const { app, service } = await fixture(['cash_session.read']);
      await app.inject({
        method: 'GET',
        url: `/api/v1/cash-sessions/${sessionId}/movements`,
        headers: { authorization: 'Bearer token' },
      });
      expect(service.createMovement).not.toHaveBeenCalled();
    });
  });

  // TASK 16.11 (§6) — reversal/compensating architecture for manual movements.
  describe('POST /api/v1/cash-sessions/:id/movements/:movementId/reverse', () => {
    it('reverses under cash_movement.create and rejects without it', async () => {
      const allowed = await fixture(['cash_movement.create']);
      const ok = await allowed.app.inject({
        method: 'POST',
        url: `/api/v1/cash-sessions/${sessionId}/movements/${movementId}/reverse`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'reverse-1' },
        payload: { reason_code: 'data_entry_error' },
      });
      expect(ok.statusCode).toBe(201);
      expect(allowed.service.reverseMovement).toHaveBeenCalledTimes(1);
      expect(ok.json()).toMatchObject({
        data: { id: reversalMovementId, movement_type: 'cash_out', reversal_of_id: movementId },
      });

      const denied = await fixture(['cash_session.read']);
      const rejected = await denied.app.inject({
        method: 'POST',
        url: `/api/v1/cash-sessions/${sessionId}/movements/${movementId}/reverse`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'reverse-1' },
        payload: { reason_code: 'data_entry_error' },
      });
      expect(rejected.statusCode).toBe(403);
      expect(denied.service.reverseMovement).not.toHaveBeenCalled();
    });

    it('requires an Idempotency-Key header', async () => {
      const { app } = await fixture(['cash_movement.create']);
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/cash-sessions/${sessionId}/movements/${movementId}/reverse`,
        headers: { authorization: 'Bearer token' },
        payload: { reason_code: 'data_entry_error' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('requires reason_code at the schema boundary', async () => {
      const { app, service } = await fixture(['cash_movement.create']);
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/cash-sessions/${sessionId}/movements/${movementId}/reverse`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'reverse-noreason' },
        payload: {},
      });
      expect(response.statusCode).toBe(400);
      expect(service.reverseMovement).not.toHaveBeenCalled();
    });

    it('reports idempotency replay via response header', async () => {
      const { app, service } = await fixture(['cash_movement.create']);
      service.reverseMovement?.mockResolvedValueOnce({
        value: movementValue({ id: reversalMovementId, movementType: 'cash_out', reversalOfId: movementId }),
        replayed: true,
      });
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/cash-sessions/${sessionId}/movements/${movementId}/reverse`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'reverse-replay' },
        payload: { reason_code: 'data_entry_error' },
      });
      expect(response.statusCode).toBe(201);
      expect(response.headers['idempotency-replayed']).toBe('true');
    });
  });

  describe('POST /api/v1/cash-sessions/:id/closures (E047)', () => {
    it('closes under cash_session.close and rejects without it', async () => {
      const allowed = await fixture(['cash_session.close']);
      const ok = await allowed.app.inject({
        method: 'POST',
        url: `/api/v1/cash-sessions/${sessionId}/closures`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'close-1' },
        payload: { declared_closing_amount: '1029.0000' },
      });
      expect(ok.statusCode).toBe(201);
      expect(allowed.service.closeSession).toHaveBeenCalledTimes(1);
      expect(ok.json()).toMatchObject({
        data: { status: 'closed', declared_closing_amount: '1029.0000', discrepancy_amount: '0.0000' },
      });

      const denied = await fixture(['cash_session.open']);
      const rejected = await denied.app.inject({
        method: 'POST',
        url: `/api/v1/cash-sessions/${sessionId}/closures`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'close-1' },
        payload: { declared_closing_amount: '1029.0000' },
      });
      expect(rejected.statusCode).toBe(403);
      expect(denied.service.closeSession).not.toHaveBeenCalled();
    });

    it('requires an Idempotency-Key header — closing must never be retried blindly', async () => {
      const { app } = await fixture(['cash_session.close']);
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/cash-sessions/${sessionId}/closures`,
        headers: { authorization: 'Bearer token' },
        payload: { declared_closing_amount: '1029.0000' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('reports idempotency replay via response header — a retried close is never applied twice', async () => {
      const { app, service } = await fixture(['cash_session.close']);
      service.closeSession?.mockResolvedValueOnce({
        value: sessionValue({ status: 'closed', declaredClosingAmount: '1029.0000', version: 2n }),
        replayed: true,
      });
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/cash-sessions/${sessionId}/closures`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'close-replay' },
        payload: { declared_closing_amount: '1029.0000' },
      });
      expect(response.statusCode).toBe(201);
      expect(response.headers['idempotency-replayed']).toBe('true');
    });

    it('passes an optional denomination_counts breakdown straight through to the service (Part J)', async () => {
      const { app, service } = await fixture(['cash_session.close']);
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/cash-sessions/${sessionId}/closures`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'close-denom' },
        payload: {
          declared_closing_amount: '1029.0000',
          denomination_counts: [
            { value: '1000', quantity: 1 },
            { value: '20', quantity: 1 },
            { value: '5', quantity: 1 },
            { value: '2', quantity: 2 },
          ],
        },
      });
      expect(response.statusCode).toBe(201);
      expect(service.closeSession).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        sessionId,
        {
          declaredClosingAmount: '1029.0000',
          denominationCounts: [
            { value: '1000', quantity: 1 },
            { value: '20', quantity: 1 },
            { value: '5', quantity: 1 },
            { value: '2', quantity: 2 },
          ],
        },
      );
    });

    it('rejects a denomination_counts entry with a negative or non-integer quantity at the schema boundary', async () => {
      const { app, service } = await fixture(['cash_session.close']);
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/cash-sessions/${sessionId}/closures`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'close-denom-bad' },
        payload: {
          declared_closing_amount: '1029.0000',
          denomination_counts: [{ value: '1000', quantity: -1 }],
        },
      });
      expect(response.statusCode).toBe(400);
      expect(service.closeSession).not.toHaveBeenCalled();
    });

    it('never accepts a client-submitted difference — only declared_closing_amount is in the request body', async () => {
      const { app, service } = await fixture(['cash_session.close']);
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/cash-sessions/${sessionId}/closures`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'close-noauth-diff' },
        payload: { declared_closing_amount: '1029.0000', discrepancy_amount: '999.0000' },
      });
      // additionalProperties: false rejects the extraneous field outright.
      expect(response.statusCode).toBe(400);
      expect(service.closeSession).not.toHaveBeenCalled();
    });
  });

  // TASK 16.11 (§13) — "Bitácora": read-only projection of `audit_log`,
  // gated by `audit.read` specifically — deliberately NOT `cash_session.read`
  // (a cashier who can view the shift shouldn't automatically see the
  // audit trail; that's a separate, higher-trust grant).
  describe('GET /api/v1/cash-sessions/:id/audit-log', () => {
    it('reads under audit.read and rejects without it — including with cash_session.read alone', async () => {
      const allowed = await fixture(['audit.read']);
      const ok = await allowed.app.inject({
        method: 'GET',
        url: `/api/v1/cash-sessions/${sessionId}/audit-log`,
        headers: { authorization: 'Bearer token' },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({
        data: [expect.objectContaining({ action: 'cash_session.opened', entity_id: sessionId })],
      });

      const denied = await fixture(['cash_session.read']);
      const rejected = await denied.app.inject({
        method: 'GET',
        url: `/api/v1/cash-sessions/${sessionId}/audit-log`,
        headers: { authorization: 'Bearer token' },
      });
      expect(rejected.statusCode).toBe(403);
      expect(denied.service.auditLog).not.toHaveBeenCalled();
    });

    it('defaults limit to 100 and passes an explicit limit through to the service', async () => {
      const { app, service } = await fixture(['audit.read']);
      await app.inject({
        method: 'GET',
        url: `/api/v1/cash-sessions/${sessionId}/audit-log`,
        headers: { authorization: 'Bearer token' },
      });
      expect(service.auditLog).toHaveBeenCalledWith(companyId, [branchId], sessionId, 100);

      await app.inject({
        method: 'GET',
        url: `/api/v1/cash-sessions/${sessionId}/audit-log?limit=25`,
        headers: { authorization: 'Bearer token' },
      });
      expect(service.auditLog).toHaveBeenCalledWith(companyId, [branchId], sessionId, 25);
    });

    it('rejects an out-of-range limit at the schema boundary', async () => {
      const { app, service } = await fixture(['audit.read']);
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/cash-sessions/${sessionId}/audit-log?limit=500`,
        headers: { authorization: 'Bearer token' },
      });
      expect(response.statusCode).toBe(400);
      expect(service.auditLog).not.toHaveBeenCalled();
    });

    it('is read-only — never calls a mutation method on the service', async () => {
      const { app, service } = await fixture(['audit.read']);
      await app.inject({
        method: 'GET',
        url: `/api/v1/cash-sessions/${sessionId}/audit-log`,
        headers: { authorization: 'Bearer token' },
      });
      expect(service.createMovement).not.toHaveBeenCalled();
      expect(service.reverseMovement).not.toHaveBeenCalled();
      expect(service.closeSession).not.toHaveBeenCalled();
    });
  });
});
