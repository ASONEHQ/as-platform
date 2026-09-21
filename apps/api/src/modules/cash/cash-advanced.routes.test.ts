import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@asone/errors';

import type { AuthService } from '../auth/auth.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { registerCashRoutes } from './cash.routes.js';
import type { CashService } from './cash.service.js';

/** TASK 14.4 (Wave 2, Part F) HTTP surface: categorized movements on the
 * EXISTING `POST .../movements` endpoint, and the two new "corte
 * parcial" endpoints. Mirrors cash.routes.test.ts's own fixture pattern
 * exactly — that file is left completely unmodified; this is a sibling
 * file for the new HTTP behavior only. */

const companyId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const branchId = '00000000-0000-4000-8000-000000000003';
const registerId = '00000000-0000-7000-8000-000000000004';
const sessionId = '00000000-0000-7000-8000-000000000005';
const movementId = '00000000-0000-7000-8000-000000000006';
const partialCloseId = '00000000-0000-7000-8000-000000000007';
const apps: FastifyInstance[] = [];

function sessionValue(): Readonly<Record<string, unknown>> {
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
    // TASK 16.14 — the frozen commercial final-close snapshot; `null` on
    // this open-session fixture, exactly like every other closure-only
    // field above.
    cashSalesTotal: null,
    cashSalesCount: null,
    cashInTotal: null,
    cashOutTotal: null,
    withdrawalTotal: null,
    expenseTotal: null,
    externalIncomeTotal: null,
    cashRefundTotal: null,
    cashRefundCount: null,
    paymentMethodTotals: null,
    operationalSummary: null,
    discrepancyReason: null,
    cardReconciliation: null,
    version: 1n,
  };
}
function movementValue(overrides?: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return {
    id: movementId,
    cashSessionId: sessionId,
    movementType: 'cash_out',
    amount: '150.0000',
    currencyCode: 'MXN',
    reasonCode: 'safe_drop',
    note: null,
    referenceType: null,
    referenceId: null,
    occurredAt: new Date('2026-09-01T09:30:00.000Z'),
    createdBy: userId,
    reversalOfId: null,
    category: 'withdrawal',
    ...overrides,
  };
}
function partialCloseValue(): Readonly<Record<string, unknown>> {
  return {
    id: partialCloseId,
    companyId,
    branchId,
    cashSessionId: sessionId,
    takenAt: new Date('2026-09-01T12:00:00.000Z'),
    openingAmount: '1000.0000',
    cashSalesTotal: '29.0000',
    cashInTotal: '0.0000',
    cashOutTotal: '0.0000',
    expectedCash: '1029.0000',
    createdBy: userId,
    createdAt: new Date('2026-09-01T12:00:00.000Z'),
    operationalSummary: null,
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
    createRegister: vi.fn(),
    listRegisters: vi.fn(),
    register: vi.fn(),
    assignDevice: vi.fn(),
    openSession: vi.fn(),
    currentSession: vi.fn(),
    listSessions: vi.fn(),
    session: vi.fn(() => Promise.resolve(sessionValue())),
    summary: vi.fn(() =>
      Promise.resolve({
        session: sessionValue(),
        openingAmount: '1000.0000',
        cashSalesTotal: '29.0000',
        cashSalesCount: 1,
        cashInTotal: '60.0000',
        cashOutTotal: '140.0000',
        withdrawalTotal: '100.0000',
        expenseTotal: '40.0000',
        externalIncomeTotal: '60.0000',
        expectedCash: '949.0000',
      }),
    ),
    createMovement: vi.fn(() => Promise.resolve({ value: movementValue(), replayed: false })),
    listMovements: vi.fn(() => Promise.resolve({ items: [movementValue()], nextCursor: null })),
    closeSession: vi.fn(),
    partialClose: vi.fn(() => Promise.resolve({ value: partialCloseValue(), replayed: false })),
    partialCloses: vi.fn(() => Promise.resolve([partialCloseValue()])),
  };
  registerCashRoutes(app, authentication, service as unknown as CashService);
  await app.ready();
  return { app, service };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe('cash advanced HTTP routes (TASK 14.4 Wave 2)', () => {
  describe('POST /api/v1/cash-sessions/:id/movements — category (Part F.1)', () => {
    it('accepts an optional category and passes it straight through to the service', async () => {
      const { app, service } = await fixture(['cash_movement.create']);
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/cash-sessions/${sessionId}/movements`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'movement-cat-1' },
        payload: { movement_type: 'cash_out', amount: '150.0000', reason_code: 'safe_drop', category: 'withdrawal' },
      });
      expect(response.statusCode).toBe(201);
      expect(service.createMovement).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        sessionId,
        expect.objectContaining({
          movementType: 'cash_out',
          amount: '150.0000',
          reasonCode: 'safe_drop',
          category: 'withdrawal',
        }),
        null,
      );
      expect(response.json()).toMatchObject({ data: { category: 'withdrawal' } });
    });

    it('omits category from the service call when not provided — unchanged TASK 12.7 behavior', async () => {
      const { app, service } = await fixture(['cash_movement.create']);
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/cash-sessions/${sessionId}/movements`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'movement-nocat-1' },
        payload: { movement_type: 'cash_in', amount: '200.0000', reason_code: 'additional_float' },
      });
      expect(response.statusCode).toBe(201);
      const call = service.createMovement?.mock.calls[0];
      expect(call?.[4]).not.toHaveProperty('category');
    });

    it('rejects an unrecognized category value at the schema boundary before it reaches the service', async () => {
      const { app, service } = await fixture(['cash_movement.create']);
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/cash-sessions/${sessionId}/movements`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'movement-badcat-1' },
        payload: {
          movement_type: 'cash_out',
          amount: '150.0000',
          reason_code: 'safe_drop',
          category: 'not-a-real-category',
        },
      });
      expect(response.statusCode).toBe(400);
      expect(service.createMovement).not.toHaveBeenCalled();
    });

    it('still requires cash_movement.create — permission enforcement is unaffected by the new field', async () => {
      const { app, service } = await fixture(['cash_session.read']);
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/cash-sessions/${sessionId}/movements`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'movement-denied-1' },
        payload: { movement_type: 'cash_out', amount: '150.0000', reason_code: 'safe_drop', category: 'withdrawal' },
      });
      expect(response.statusCode).toBe(403);
      expect(service.createMovement).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/cash-sessions/:id/summary — new breakdown fields (Part F.2)', () => {
    it('includes withdrawal/expense/external_income totals alongside the existing fields', async () => {
      const { app } = await fixture(['cash_session.read']);
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/cash-sessions/${sessionId}/summary`,
        headers: { authorization: 'Bearer token' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        data: {
          cash_in_total: '60.0000',
          cash_out_total: '140.0000',
          withdrawal_total: '100.0000',
          expense_total: '40.0000',
          external_income_total: '60.0000',
          expected_cash: '949.0000',
        },
      });
    });
  });

  describe('POST /api/v1/cash-sessions/:id/partial-close (Part F.3)', () => {
    it('creates under cash_movement.create and rejects without it', async () => {
      const allowed = await fixture(['cash_movement.create']);
      const ok = await allowed.app.inject({
        method: 'POST',
        url: `/api/v1/cash-sessions/${sessionId}/partial-close`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'partial-1' },
        payload: {},
      });
      expect(ok.statusCode).toBe(201);
      expect(allowed.service.partialClose).toHaveBeenCalledTimes(1);
      expect(ok.json()).toMatchObject({
        data: { cash_session_id: sessionId, expected_cash: '1029.0000' },
      });

      // Deliberately NOT gated behind cash_session.close — a partial
      // close must remain reachable to an operator who cannot close the
      // session outright.
      const deniedByRead = await fixture(['cash_session.read']);
      const rejected = await deniedByRead.app.inject({
        method: 'POST',
        url: `/api/v1/cash-sessions/${sessionId}/partial-close`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'partial-1' },
        payload: {},
      });
      expect(rejected.statusCode).toBe(403);
      expect(deniedByRead.service.partialClose).not.toHaveBeenCalled();
    });

    it('requires an Idempotency-Key header, exactly like every other mutation in this module', async () => {
      const { app } = await fixture(['cash_movement.create']);
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/cash-sessions/${sessionId}/partial-close`,
        headers: { authorization: 'Bearer token' },
        payload: {},
      });
      expect(response.statusCode).toBe(400);
    });

    it('reports idempotency replay via response header — a retried request never creates a second snapshot', async () => {
      const { app, service } = await fixture(['cash_movement.create']);
      service.partialClose?.mockResolvedValueOnce({ value: partialCloseValue(), replayed: true });
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/cash-sessions/${sessionId}/partial-close`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'partial-replay-1' },
        payload: {},
      });
      expect(response.statusCode).toBe(201);
      expect(response.headers['idempotency-replayed']).toBe('true');
    });

    it('never calls closeSession — a partial close must never close the session', async () => {
      const { app, service } = await fixture(['cash_movement.create']);
      await app.inject({
        method: 'POST',
        url: `/api/v1/cash-sessions/${sessionId}/partial-close`,
        headers: { authorization: 'Bearer token', 'idempotency-key': 'partial-noclose-1' },
        payload: {},
      });
      expect(service.closeSession).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/cash-sessions/:id/partial-closes (Part F.3)', () => {
    it('lists under cash_session.read and rejects without it', async () => {
      const allowed = await fixture(['cash_session.read']);
      const ok = await allowed.app.inject({
        method: 'GET',
        url: `/api/v1/cash-sessions/${sessionId}/partial-closes`,
        headers: { authorization: 'Bearer token' },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({ data: [expect.objectContaining({ id: partialCloseId })] });

      const denied = await fixture(['cash_movement.create']);
      const rejected = await denied.app.inject({
        method: 'GET',
        url: `/api/v1/cash-sessions/${sessionId}/partial-closes`,
        headers: { authorization: 'Bearer token' },
      });
      expect(rejected.statusCode).toBe(403);
    });

    it('is read-only — never calls partialClose', async () => {
      const { app, service } = await fixture(['cash_session.read']);
      await app.inject({
        method: 'GET',
        url: `/api/v1/cash-sessions/${sessionId}/partial-closes`,
        headers: { authorization: 'Bearer token' },
      });
      expect(service.partialClose).not.toHaveBeenCalled();
    });
  });
});
