import type { FastifyInstance, FastifyRequest } from 'fastify';

import { responseMeta, successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requireBranchAccess, requirePermission } from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import { idempotencyKey } from '../catalog/catalog.schemas.js';
import { withPeopleErrors } from './people.http-errors.js';
import { payrollTotals, type PayrollService } from './payroll.service.js';
import type {
  PayrollAdjustmentRow,
  PayrollLineDayRow,
  PayrollPeriodLineRow,
  PayrollPeriodRow,
  PeopleMutationContext,
} from './people.types.js';

interface Params {
  id: string;
}
interface EmployeeParams extends Params {
  employeeId: string;
}
interface AdjustmentParams extends Params {
  adjustmentId: string;
}

const uuidParam = { type: 'string', format: 'uuid' } as const;
const moneyPattern = '^\\d{1,15}(\\.\\d{1,4})?$';

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
    // TASK 17.6 — the signed NET of the non-voided manual adjustments
    // (`total_amount` already includes it) and the employee identity frozen
    // at calculation time. `snapshot_available` is false ONLY for lines
    // computed before Payroll V2 existed; the client then falls back to the
    // live employee record and must say so.
    adjustment_amount: value.adjustmentAmount,
    employee_name: value.employeeNameSnapshot,
    employee_code: value.employeeCodeSnapshot,
    job_title: value.jobTitleSnapshot,
    snapshot_available: value.employeeNameSnapshot !== null,
  };
}
function adjustmentHttp(value: PayrollAdjustmentRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    payroll_period_id: value.payrollPeriodId,
    branch_id: value.branchId,
    employee_id: value.employeeId,
    kind: value.kind,
    amount: value.amount,
    currency_code: value.currencyCode,
    reason: value.reason,
    created_by: value.createdBy,
    created_at: value.createdAt.toISOString(),
    voided_at: value.voidedAt?.toISOString() ?? null,
    voided_by: value.voidedBy,
    void_reason: value.voidReason,
    status: value.voidedAt === null ? 'active' : 'voided',
  };
}
function dayHttp(value: PayrollLineDayRow): Readonly<Record<string, unknown>> {
  return {
    work_date: value.workDate,
    scheduled_start: value.scheduledStart,
    scheduled_end: value.scheduledEnd,
    is_day_off: value.isDayOff,
    scheduled_minutes: value.scheduledMinutes,
    worked_minutes: value.workedMinutes,
    late_minutes: value.lateMinutes,
    overtime_minutes: value.overtimeMinutes,
    first_in_minute: value.firstInMinute,
    last_out_minute: value.lastOutMinute,
    attendance_state: value.attendanceState,
  };
}
function periodWithLinesHttp(value: { period: PayrollPeriodRow; lines: PayrollPeriodLineRow[] }): Readonly<Record<string, unknown>> {
  return {
    ...periodHttp(value.period),
    lines: value.lines.map(lineHttp),
    // TASK 17.6 — column totals computed by the server (grouped by currency);
    // the client only displays them.
    totals: payrollTotals(value.lines).map((item) => ({
      currency_code: item.currencyCode,
      employee_count: item.employeeCount,
      base_salary: item.baseSalary,
      deduction: item.deduction,
      bonus: item.bonus,
      adjustment: item.adjustment,
      total: item.total,
    })),
  };
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

  app.get<{ Params: EmployeeParams }>(
    '/api/v1/payroll-periods/:id/employees/:employeeId',
    {
      schema: {
        tags: ['people'],
        params: { type: 'object', required: ['id', 'employeeId'], properties: { id: uuidParam, employeeId: uuidParam } },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPeopleErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'payroll.read');
        const detail = await service.employeeDetail(
          auth.companyId,
          auth.permittedBranchIds,
          request.params.id,
          request.params.employeeId,
        );
        return reply.send(
          successResponse(
            {
              period: periodHttp(detail.period),
              line: lineHttp(detail.line),
              days: detail.days.map(dayHttp),
              adjustments: detail.adjustments.map(adjustmentHttp),
            },
            request.requestContext,
          ),
        );
      }),
  );

  app.get<{ Params: Params }>(
    '/api/v1/payroll-periods/:id/adjustments',
    {
      schema: {
        tags: ['people'],
        params: { type: 'object', required: ['id'], properties: { id: uuidParam } },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPeopleErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'payroll.read');
        const items = await service.adjustments(auth.companyId, auth.permittedBranchIds, request.params.id);
        return reply.send({ data: items.map(adjustmentHttp), meta: responseMeta(request.requestContext) });
      }),
  );

  app.post<{ Params: Params; Body: { employee_id: string; kind: string; amount: string; reason: string } }>(
    '/api/v1/payroll-periods/:id/adjustments',
    {
      schema: {
        tags: ['people'],
        headers: idempotencyHeaders,
        params: { type: 'object', required: ['id'], properties: { id: uuidParam } },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['employee_id', 'kind', 'amount', 'reason'],
          properties: {
            employee_id: uuidParam,
            kind: { type: 'string', enum: ['bonus', 'deduction'] },
            amount: { type: 'string', pattern: moneyPattern },
            reason: { type: 'string', minLength: 3, maxLength: 500 },
          },
        },
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPeopleErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'payroll.manage');
        const created = await service.createAdjustment(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          request.params.id,
          {
            employeeId: request.body.employee_id,
            kind: request.body.kind,
            amount: request.body.amount,
            reason: request.body.reason,
          },
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        const { line, ...row } = created.value;
        return reply.code(201).send(
          successResponse({ ...adjustmentHttp(row), line: lineHttp(line) }, request.requestContext),
        );
      }),
  );

  app.post<{ Params: AdjustmentParams; Body: { reason: string } }>(
    '/api/v1/payroll-periods/:id/adjustments/:adjustmentId/void',
    {
      schema: {
        tags: ['people'],
        headers: idempotencyHeaders,
        params: { type: 'object', required: ['id', 'adjustmentId'], properties: { id: uuidParam, adjustmentId: uuidParam } },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['reason'],
          properties: { reason: { type: 'string', minLength: 3, maxLength: 500 } },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPeopleErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'payroll.manage');
        const voided = await service.voidAdjustment(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          request.params.id,
          request.params.adjustmentId,
          request.body.reason,
        );
        if (voided.replayed) reply.header('idempotency-replayed', 'true');
        const { line, ...row } = voided.value;
        return reply.send(successResponse({ ...adjustmentHttp(row), line: lineHttp(line) }, request.requestContext));
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

  app.post<{ Params: Params; Body: { reason: string } }>(
    '/api/v1/payroll-periods/:id/reopen',
    {
      schema: {
        tags: ['people'],
        headers: idempotencyHeaders,
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
        // TASK 17.6 — reopening a CLOSED payroll is a privileged, audited
        // correction: it must say why (recorded in the audit log).
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['reason'],
          properties: { reason: { type: 'string', minLength: 3, maxLength: 500 } },
        },
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
          request.body.reason,
        );
        if (reopened.replayed) reply.header('idempotency-replayed', 'true');
        return reply.send(successResponse(periodHttp(reopened.value), request.requestContext));
      }),
  );
}
