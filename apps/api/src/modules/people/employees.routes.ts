import type { FastifyInstance, FastifyRequest } from 'fastify';

import { responseMeta, successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requireBranchAccess, requirePermission } from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import { idempotencyKey } from '../catalog/catalog.schemas.js';
import { withPeopleErrors } from './people.http-errors.js';
import type { EmployeesService } from './employees.service.js';
import type { EmployeeRow, PeopleMutationContext } from './people.types.js';

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

function employeeHttp(value: EmployeeRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    branch_id: value.branchId,
    code: value.code,
    display_name: value.displayName,
    phone: value.phone,
    email: value.email,
    job_title: value.jobTitle,
    status: value.status,
    hire_date: value.hireDate,
    weekly_salary: value.weeklySalary,
    currency_code: value.currencyCode,
    user_id: value.userId,
    notes: value.notes,
    deactivated_at: value.deactivatedAt?.toISOString() ?? null,
    deactivated_by: value.deactivatedBy,
    version: value.version.toString(),
    created_at: value.createdAt.toISOString(),
    updated_at: value.updatedAt.toISOString(),
  };
}

/**
 * TASK 14.4 (Wave 2) — Empleados CRUD. Every mutation requires an
 * `Idempotency-Key`; `PUT .../:id` additionally requires `If-Match:
 * "<version>"` (mirrors `cash.routes.ts`'s own `device-assignment`
 * route exactly) for optimistic concurrency.
 */
export function registerEmployeeRoutes(app: FastifyInstance, authentication: AuthService, service: EmployeesService): void {
  app.post<{
    Body: {
      id?: string;
      branch_id: string;
      code: string;
      display_name: string;
      phone?: string | null;
      email?: string | null;
      job_title?: string | null;
      hire_date?: string | null;
      weekly_salary: string;
      currency_code: string;
      user_id?: string | null;
      notes?: string | null;
    };
  }>(
    '/api/v1/employees',
    {
      schema: {
        tags: ['people'],
        headers: idempotencyHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['branch_id', 'code', 'display_name', 'weekly_salary', 'currency_code'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            branch_id: { type: 'string', format: 'uuid' },
            code: { type: 'string', minLength: 1, maxLength: 50 },
            display_name: { type: 'string', minLength: 1, maxLength: 200 },
            phone: { anyOf: [{ type: 'string', maxLength: 50 }, { type: 'null' }] },
            email: { anyOf: [{ type: 'string', maxLength: 200 }, { type: 'null' }] },
            job_title: { anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }] },
            hire_date: { anyOf: [{ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, { type: 'null' }] },
            weekly_salary: { type: 'string' },
            currency_code: { type: 'string', minLength: 3, maxLength: 3 },
            user_id: { anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] },
            notes: { anyOf: [{ type: 'string', maxLength: 2000 }, { type: 'null' }] },
          },
        },
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPeopleErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'employee.manage');
        requireBranchAccess(authentication, auth, request.body.branch_id);
        const created = await service.createEmployee(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          {
            ...(request.body.id === undefined ? {} : { id: request.body.id }),
            branchId: request.body.branch_id,
            code: request.body.code,
            displayName: request.body.display_name,
            phone: request.body.phone ?? null,
            email: request.body.email ?? null,
            jobTitle: request.body.job_title ?? null,
            hireDate: request.body.hire_date ?? null,
            weeklySalary: request.body.weekly_salary,
            currencyCode: request.body.currency_code,
            userId: request.body.user_id ?? null,
            notes: request.body.notes ?? null,
          },
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .code(201)
          .header('etag', `"${created.value.version.toString()}"`)
          .send(successResponse(employeeHttp(created.value), request.requestContext));
      }),
  );

  app.get<{ Params: Params }>(
    '/api/v1/employees/:id',
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
        requirePermission(authentication, auth, 'employee.read');
        const value = await service.employee(auth.companyId, auth.permittedBranchIds, request.params.id);
        return reply
          .header('etag', `"${value.version.toString()}"`)
          .send(successResponse(employeeHttp(value), request.requestContext));
      }),
  );

  app.get<{ Querystring: { cursor?: string; limit?: number; branch_id?: string; status?: string } }>(
    '/api/v1/employees',
    {
      schema: {
        tags: ['people'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cursor: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            branch_id: { type: 'string', format: 'uuid' },
            status: { type: 'string', enum: ['active', 'inactive'] },
          },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPeopleErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'employee.read');
        const query = request.query;
        if (query.branch_id !== undefined) requireBranchAccess(authentication, auth, query.branch_id);
        const page = await service.listEmployees(auth.companyId, auth.permittedBranchIds, {
          limit: query.limit ?? 50,
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(query.branch_id === undefined ? {} : { branchId: query.branch_id }),
          ...(query.status === undefined ? {} : { status: query.status }),
        });
        return reply.send({
          data: page.items.map(employeeHttp),
          meta: { ...responseMeta(request.requestContext), page: { next_cursor: page.nextCursor, has_more: page.nextCursor !== null } },
        });
      }),
  );

  app.put<{
    Params: Params;
    Body: {
      display_name?: string;
      phone?: string | null;
      email?: string | null;
      job_title?: string | null;
      hire_date?: string | null;
      weekly_salary?: string;
      currency_code?: string;
      user_id?: string | null;
      notes?: string | null;
    };
  }>(
    '/api/v1/employees/:id',
    {
      schema: {
        tags: ['people'],
        headers: {
          type: 'object',
          required: ['idempotency-key', 'if-match'],
          properties: {
            'idempotency-key': { type: 'string', minLength: 1, maxLength: 255 },
            'if-match': { type: 'string' },
          },
        },
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            display_name: { type: 'string', minLength: 1, maxLength: 200 },
            phone: { anyOf: [{ type: 'string', maxLength: 50 }, { type: 'null' }] },
            email: { anyOf: [{ type: 'string', maxLength: 200 }, { type: 'null' }] },
            job_title: { anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }] },
            hire_date: { anyOf: [{ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, { type: 'null' }] },
            weekly_salary: { type: 'string' },
            currency_code: { type: 'string', minLength: 3, maxLength: 3 },
            user_id: { anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] },
            notes: { anyOf: [{ type: 'string', maxLength: 2000 }, { type: 'null' }] },
          },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPeopleErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'employee.manage');
        const ifMatch = request.headers['if-match'];
        const expectedVersion = BigInt(typeof ifMatch === 'string' ? ifMatch.replaceAll('"', '') : '0');
        const body = request.body;
        const updated = await service.updateEmployee(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          request.params.id,
          expectedVersion,
          {
            ...(body.display_name === undefined ? {} : { displayName: body.display_name }),
            ...('phone' in body ? { phone: body.phone ?? null } : {}),
            ...('email' in body ? { email: body.email ?? null } : {}),
            ...('job_title' in body ? { jobTitle: body.job_title ?? null } : {}),
            ...('hire_date' in body ? { hireDate: body.hire_date ?? null } : {}),
            ...(body.weekly_salary === undefined ? {} : { weeklySalary: body.weekly_salary }),
            ...(body.currency_code === undefined ? {} : { currencyCode: body.currency_code }),
            ...('user_id' in body ? { userId: body.user_id ?? null } : {}),
            ...('notes' in body ? { notes: body.notes ?? null } : {}),
          },
        );
        if (updated.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .header('etag', `"${updated.value.version.toString()}"`)
          .send(successResponse(employeeHttp(updated.value), request.requestContext));
      }),
  );

  app.post<{ Params: Params }>(
    '/api/v1/employees/:id/deactivate',
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
        requirePermission(authentication, auth, 'employee.manage');
        const updated = await service.deactivateEmployee(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          request.params.id,
        );
        if (updated.replayed) reply.header('idempotency-replayed', 'true');
        return reply.send(successResponse(employeeHttp(updated.value), request.requestContext));
      }),
  );

  app.post<{ Params: Params }>(
    '/api/v1/employees/:id/reactivate',
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
        requirePermission(authentication, auth, 'employee.manage');
        const updated = await service.reactivateEmployee(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          request.params.id,
        );
        if (updated.replayed) reply.header('idempotency-replayed', 'true');
        return reply.send(successResponse(employeeHttp(updated.value), request.requestContext));
      }),
  );
}
