import type { FastifyInstance, FastifyRequest } from 'fastify';

import { responseMeta, successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requirePermission } from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import { idempotencyKey } from '../catalog/catalog.schemas.js';
import { withPeopleErrors } from './people.http-errors.js';
import type { TimeClockService } from './time-clock.service.js';
import type { PeopleMutationContext, TimeClockPunchRow } from './people.types.js';

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

function punchHttp(value: TimeClockPunchRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    branch_id: value.branchId,
    employee_id: value.employeeId,
    punch_type: value.punchType,
    occurred_at: value.occurredAt.toISOString(),
    station: value.station,
    method: value.method,
    is_correction: value.isCorrection,
    correction_reason: value.correctionReason,
    corrected_punch_id: value.correctedPunchId,
    created_at: value.createdAt.toISOString(),
  };
}

/**
 * TASK 14.4 (Wave 2) — Checador. `clock-in`/`clock-out` require only
 * `attendance.read` at minimum (self-service is authorized inside
 * `TimeClockService.recordPunch` against the employee's own linked
 * `user_id` — see that file's own doc comment); `attendance.manage` is
 * what lets an actor act on ANY employee, and is the ONLY thing that
 * authorizes `/corrections`.
 */
export function registerTimeClockRoutes(app: FastifyInstance, authentication: AuthService, service: TimeClockService): void {
  app.post<{ Body: { employee_id: string; station?: string | null } }>(
    '/api/v1/time-clock/clock-in',
    {
      schema: {
        tags: ['people'],
        headers: idempotencyHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['employee_id'],
          properties: {
            employee_id: { type: 'string', format: 'uuid' },
            station: { anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }] },
          },
        },
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPeopleErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'attendance.read');
        const created = await service.clockIn(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          { employeeId: request.body.employee_id, station: request.body.station ?? null },
          { userId: auth.userId, hasManagePermission: auth.permissions.includes('attendance.manage') },
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        return reply.code(201).send(successResponse(punchHttp(created.value), request.requestContext));
      }),
  );

  app.post<{ Body: { employee_id: string; station?: string | null } }>(
    '/api/v1/time-clock/clock-out',
    {
      schema: {
        tags: ['people'],
        headers: idempotencyHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['employee_id'],
          properties: {
            employee_id: { type: 'string', format: 'uuid' },
            station: { anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }] },
          },
        },
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPeopleErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'attendance.read');
        const created = await service.clockOut(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          { employeeId: request.body.employee_id, station: request.body.station ?? null },
          { userId: auth.userId, hasManagePermission: auth.permissions.includes('attendance.manage') },
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        return reply.code(201).send(successResponse(punchHttp(created.value), request.requestContext));
      }),
  );

  app.post<{
    Body: {
      employee_id: string;
      punch_type: 'clock_in' | 'clock_out';
      occurred_at: string;
      station?: string | null;
      correction_reason: string;
      corrected_punch_id: string;
    };
  }>(
    '/api/v1/time-clock/corrections',
    {
      schema: {
        tags: ['people'],
        headers: idempotencyHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['employee_id', 'punch_type', 'occurred_at', 'correction_reason', 'corrected_punch_id'],
          properties: {
            employee_id: { type: 'string', format: 'uuid' },
            punch_type: { type: 'string', enum: ['clock_in', 'clock_out'] },
            occurred_at: { type: 'string' },
            station: { anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }] },
            correction_reason: { type: 'string', minLength: 1, maxLength: 1000 },
            corrected_punch_id: { type: 'string', format: 'uuid' },
          },
        },
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPeopleErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'attendance.manage');
        const body = request.body;
        const created = await service.correctPunch(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          {
            employeeId: body.employee_id,
            punchType: body.punch_type,
            occurredAt: body.occurred_at,
            station: body.station ?? null,
            correctionReason: body.correction_reason,
            correctedPunchId: body.corrected_punch_id,
          },
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        return reply.code(201).send(successResponse(punchHttp(created.value), request.requestContext));
      }),
  );

  app.get<{ Querystring: { employee_id: string; date_from?: string; date_to?: string; limit?: number } }>(
    '/api/v1/time-clock/punches',
    {
      schema: {
        tags: ['people'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          required: ['employee_id'],
          properties: {
            employee_id: { type: 'string', format: 'uuid' },
            date_from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            date_to: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            limit: { type: 'integer', minimum: 1, maximum: 200 },
          },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPeopleErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'attendance.read');
        const query = request.query;
        const items = await service.listPunches(auth.companyId, auth.permittedBranchIds, {
          employeeId: query.employee_id,
          ...(query.date_from === undefined ? {} : { dateFrom: query.date_from }),
          ...(query.date_to === undefined ? {} : { dateTo: query.date_to }),
          limit: query.limit ?? 100,
        });
        return reply.send({ data: items.map(punchHttp), meta: responseMeta(request.requestContext) });
      }),
  );
}
