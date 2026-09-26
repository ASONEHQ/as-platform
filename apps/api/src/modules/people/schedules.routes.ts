import type { FastifyInstance, FastifyRequest } from 'fastify';

import { responseMeta, successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requirePermission } from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import { idempotencyKey } from '../catalog/catalog.schemas.js';
import { withPeopleErrors } from './people.http-errors.js';
import type { SchedulesService } from './schedules.service.js';
import type { EmployeeScheduleRow, PeopleMutationContext } from './people.types.js';

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

function scheduleHttp(value: EmployeeScheduleRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    branch_id: value.branchId,
    employee_id: value.employeeId,
    work_date: value.workDate,
    is_day_off: value.isDayOff,
    scheduled_start: value.scheduledStart,
    scheduled_end: value.scheduledEnd,
    notes: value.notes,
    created_at: value.createdAt.toISOString(),
    updated_at: value.updatedAt.toISOString(),
  };
}

/**
 * TASK 14.4 (Wave 2) — Horarios. `PUT /api/v1/schedules` is a genuine
 * upsert on `(employee, work_date)` — see `schedules.service.ts`'s own
 * doc comment for why. Branch scoping is enforced indirectly: the
 * service only ever resolves an employee through
 * `PeopleRepository.employee(companyId, branchIds, ...)`, which already
 * excludes any employee outside the caller's `permittedBranchIds` — so
 * there is no separate `branch_id` in the request body to guard with
 * `requireBranchAccess` (the schedule's `branch_id` is always derived
 * from the employee's own branch, never client-supplied, which also
 * rules out a client accidentally/maliciously mismatching the two).
 */
export function registerScheduleRoutes(app: FastifyInstance, authentication: AuthService, service: SchedulesService): void {
  app.put<{
    Body: {
      id?: string;
      employee_id: string;
      work_date: string;
      is_day_off: boolean;
      scheduled_start?: string | null;
      scheduled_end?: string | null;
      notes?: string | null;
    };
  }>(
    '/api/v1/schedules',
    {
      schema: {
        tags: ['people'],
        headers: idempotencyHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['employee_id', 'work_date', 'is_day_off'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            employee_id: { type: 'string', format: 'uuid' },
            work_date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            is_day_off: { type: 'boolean' },
            scheduled_start: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            scheduled_end: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            notes: { anyOf: [{ type: 'string', maxLength: 2000 }, { type: 'null' }] },
          },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPeopleErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'schedule.manage');
        const body = request.body;
        const updated = await service.upsertSchedule(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          {
            ...(body.id === undefined ? {} : { id: body.id }),
            employeeId: body.employee_id,
            workDate: body.work_date,
            isDayOff: body.is_day_off,
            scheduledStart: body.scheduled_start ?? null,
            scheduledEnd: body.scheduled_end ?? null,
            notes: body.notes ?? null,
          },
        );
        if (updated.replayed) reply.header('idempotency-replayed', 'true');
        return reply.send(successResponse(scheduleHttp(updated.value), request.requestContext));
      }),
  );

  app.get<{ Querystring: { employee_id: string; date_from: string; date_to: string } }>(
    '/api/v1/schedules',
    {
      schema: {
        tags: ['people'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          required: ['employee_id', 'date_from', 'date_to'],
          properties: {
            employee_id: { type: 'string', format: 'uuid' },
            date_from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            date_to: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPeopleErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'schedule.read');
        const query = request.query;
        const items = await service.listSchedules(auth.companyId, auth.permittedBranchIds, {
          employeeId: query.employee_id,
          dateFrom: query.date_from,
          dateTo: query.date_to,
        });
        return reply.send({ data: items.map(scheduleHttp), meta: responseMeta(request.requestContext) });
      }),
  );

  // TASK 16.29 — the weekly schedule MATRIX (Horarios): every employee's
  // schedule for one branch, one week, in a single call — see
  // `SchedulesService.listSchedulesForBranch`'s own doc comment for why
  // this exists as a separate route rather than an N+1 client loop over
  // the per-employee route above.
  app.get<{ Querystring: { branch_id: string; date_from: string; date_to: string } }>(
    '/api/v1/schedules/branch',
    {
      schema: {
        tags: ['people'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          required: ['branch_id', 'date_from', 'date_to'],
          properties: {
            branch_id: { type: 'string', format: 'uuid' },
            date_from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            date_to: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPeopleErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'schedule.read');
        const query = request.query;
        const items = await service.listSchedulesForBranch(auth.companyId, auth.permittedBranchIds, {
          branchId: query.branch_id,
          dateFrom: query.date_from,
          dateTo: query.date_to,
        });
        return reply.send({ data: items.map(scheduleHttp), meta: responseMeta(request.requestContext) });
      }),
  );
}
