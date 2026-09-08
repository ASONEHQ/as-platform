import type { FastifyInstance, FastifyRequest } from 'fastify';

import { responseMeta, successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requireBranchAccess, requirePermission } from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import { idempotencyKey } from '../catalog/catalog.schemas.js';
import { withPeopleErrors } from './people.http-errors.js';
import type { PayrollService } from './payroll.service.js';
import type { PayrollPeriodLineRow, PayrollPeriodRow, PeopleMutationContext } from './people.types.js';

interface Params {
  id: string;
}

const errorSchema = { type: 'object', additionalProperties: true } as const;
const commonErrors = {
  400: errorSchema,
  401: errorSchema,
  403: errorSchema,
  404: errorSchema,
  409: errorSchema,
} as const;
const responseSchema = { type: 'object', additionalProperties: true } as const;
const idempotencyHeaders = {
  type: 'object',
  required: ['idempotency-key'],
  properties: { 'idempotency-key': { type: 'string', minLength: 1, maxLength: 255 } },
} as const;

function mutationContext(request: FastifyRequest, companyId: string, actorId: string): PeopleMutationContext {
  return {
    companyId,
    actorId,
    requestId: request.requestContext.requestId,
    correlationId: request.requestContext.correlationId,
    timestamp: new Date(),
    deviceId: request.requestContext.deviceId,
  };
}

function periodHttp(value: PayrollPeriodRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    branch_id: value.branchId,
    period_start: value.periodStart,
    period_end: value.periodEnd,
    status: value.status,
    closed_at: value.closedAt?.toISOString() ?? null,
    closed_by: value.closedBy,
    created_at: value.createdAt.toISOString(),
    updated_at: value.updatedAt.toISOString(),
  };
}
function lineHttp(value: PayrollPeriodLineRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    employee_id: value.employeeId,
    scheduled_minutes: value.scheduledMinutes,
    worked_minutes: value.workedMinutes,
    late_minutes: value.lateMinutes,
    overtime_minutes: value.overtimeMinutes,
    base_salary_snapshot: value.baseSalarySnapshot,
    deduction_amount: value.deductionAmount,
    bonus_amount: value.bonusAmount,
    total_amount: value.totalAmount,
    currency_code: value.currencyCode,
    computed_at: value.computedAt.toISOString(),
    computed_by: value.computedBy,
  };
}
function periodWithLinesHttp(value: { period: PayrollPeriodRow; lines: PayrollPeriodLineRow[] }): Readonly<Record<string, unknown>> {
  return { ...periodHttp(value.period), lines: value.lines.map(lineHttp) };
}

/**
 * TASK 14.4 (Wave 2) — Nómina. `payroll.close`/`reopen` require the
 * dedicated `payroll.close` permission (separate from `payroll.manage`
 * per the already-seeded technical permissions) — see
 * `payroll.service.ts`'s own doc comment for why reopen carries its own
 * distinct audit action.
 */
export function registerPayrollRoutes(app: FastifyInstance, authentication: AuthService, service: PayrollService): void {
  app.post<{ Body: { branch_id: string; period_start: string; period_end: string } }>(
    '/api/v1/payroll-periods',
    {
      schema: {
        tags: ['people'],
        headers: idempotencyHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['branch_id', 'period_start', 'period_end'],
          properties: {
            branch_id: { type: 'string', format: 'uuid' },
            period_start: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            period_end: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          },
        },
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPeopleErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'payroll.manage');
        requireBranchAccess(authentication, auth, request.body.branch_id);
        const created = await service.createPeriod(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          { branchId: request.body.branch_id, periodStart: request.body.period_start, periodEnd: request.body.period_end },
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        return reply.code(201).send(successResponse(periodHttp(created.value), request.requestContext));
      }),
  );

  app.get<{ Params: Params }>(
    '/api/v1/payroll-periods/:id',
    {
      schema: {
        tags: ['people'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPeopleErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'payroll.read');
        const value = await service.period(auth.companyId, auth.permittedBranchIds, request.params.id);
        return reply.send(successResponse(periodWithLinesHttp(value), request.requestContext));
      }),
  );

  app.get<{ Querystring: { branch_id?: string; status?: string; limit?: number } }>(
    '/api/v1/payroll-periods',
    {
      schema: {
        tags: ['people'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            branch_id: { type: 'string', format: 'uuid' },
            status: { type: 'string', enum: ['draft', 'closed'] },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
          },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPeopleErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'payroll.read');
        const query = request.query;
        if (query.branch_id !== undefined) requireBranchAccess(authentication, auth, query.branch_id);
        const items = await service.listPeriods(auth.companyId, auth.permittedBranchIds, {
          ...(query.branch_id === undefined ? {} : { branchId: query.branch_id }),
          ...(query.status === undefined ? {} : { status: query.status }),
          limit: query.limit ?? 50,
        });
        return reply.send({ data: items.map(periodHttp), meta: responseMeta(request.requestContext) });
      }),
  );

  app.post<{ Params: Params }>(
    '/api/v1/payroll-periods/:id/calculate',
    {
      schema: {
        tags: ['people'],
        headers: idempotencyHeaders,
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPeopleErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'payroll.manage');
        const calculated = await service.calculate(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          request.params.id,
        );
        if (calculated.replayed) reply.header('idempotency-replayed', 'true');
        return reply.send(successResponse(periodWithLinesHttp(calculated.value), request.requestContext));
      }),
  );

  app.post<{ Params: Params }>(
    '/api/v1/payroll-periods/:id/close',
    {
      schema: {
        tags: ['people'],
        headers: idempotencyHeaders,
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPeopleErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'payroll.close');
        const closed = await service.close(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          request.params.id,
        );
        if (closed.replayed) reply.header('idempotency-replayed', 'true');
        return reply.send(successResponse(periodHttp(closed.value), request.requestContext));
      }),
  );

  app.post<{ Params: Params }>(
    '/api/v1/payroll-periods/:id/reopen',
    {
      schema: {
        tags: ['people'],
        headers: idempotencyHeaders,
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPeopleErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'payroll.close');
        const reopened = await service.reopen(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          request.params.id,
        );
        if (reopened.replayed) reply.header('idempotency-replayed', 'true');
        return reply.send(successResponse(periodHttp(reopened.value), request.requestContext));
      }),
  );
}
