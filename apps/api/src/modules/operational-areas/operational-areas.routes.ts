import type { FastifyInstance, FastifyRequest } from 'fastify';

import { responseMeta, successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requireBranchAccess, requirePermission } from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import { idempotencyKey } from '../catalog/catalog.schemas.js';
import { withOperationalAreaErrors } from './operational-areas.http-errors.js';
import type { OperationalAreasService } from './operational-areas.service.js';
import type { OperationalAreaMutationContext, OperationalAreaRow } from './operational-areas.types.js';

interface Params {
  id: string;
}

const errorSchema = { type: 'object', additionalProperties: true } as const;
const commonErrors = { 400: errorSchema, 401: errorSchema, 403: errorSchema, 404: errorSchema, 409: errorSchema } as const;
const responseSchema = { type: 'object', additionalProperties: true } as const;
const idempotencyHeaders = {
  type: 'object',
  required: ['idempotency-key'],
  properties: { 'idempotency-key': { type: 'string', minLength: 1, maxLength: 255 } },
} as const;

function mutationContext(request: FastifyRequest, companyId: string, actorId: string): OperationalAreaMutationContext {
  return {
    companyId,
    actorId,
    requestId: request.requestContext.requestId,
    correlationId: request.requestContext.correlationId,
    timestamp: new Date(),
  };
}

function areaHttp(value: OperationalAreaRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    branch_id: value.branchId,
    code: value.code,
    name: value.name,
    status: value.status,
    version: Number(value.version),
    created_at: value.createdAt.toISOString(),
    updated_at: value.updatedAt.toISOString(),
  };
}

/** TASK 16.15 — "operational area" CRUD, gated by `operational_area.read`/
 * `operational_area.manage` (mirroring `cash_register.read`/
 * `cash_register.manage`'s own split exactly). See
 * `packages/database/src/schema/operational-areas.ts` for the full
 * rationale. */
export function registerOperationalAreaRoutes(app: FastifyInstance, authentication: AuthService, service: OperationalAreasService): void {
  app.post<{ Body: { id?: string; branch_id: string; code: string; name: string } }>(
    '/api/v1/operational-areas',
    {
      schema: {
        tags: ['operational-areas'],
        headers: idempotencyHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['branch_id', 'code', 'name'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            branch_id: { type: 'string', format: 'uuid' },
            code: { type: 'string', minLength: 1, maxLength: 64 },
            name: { type: 'string', minLength: 1, maxLength: 160 },
          },
        },
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withOperationalAreaErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'operational_area.manage');
        requireBranchAccess(authentication, auth, request.body.branch_id);
        const created = await service.create(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          {
            ...(request.body.id === undefined ? {} : { id: request.body.id }),
            branchId: request.body.branch_id,
            code: request.body.code,
            name: request.body.name,
          },
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .code(201)
          .header('etag', `"${created.value.version.toString()}"`)
          .send(successResponse(areaHttp(created.value), request.requestContext));
      }),
  );

  app.get<{ Querystring: { cursor?: string; limit?: number; branch_id?: string; status?: string } }>(
    '/api/v1/operational-areas',
    {
      schema: {
        tags: ['operational-areas'],
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
      withOperationalAreaErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'operational_area.read');
        const query = request.query;
        if (query.branch_id !== undefined) requireBranchAccess(authentication, auth, query.branch_id);
        const page = await service.list(auth.companyId, auth.permittedBranchIds, {
          limit: query.limit ?? 50,
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(query.branch_id === undefined ? {} : { branchId: query.branch_id }),
          ...(query.status === undefined ? {} : { status: query.status }),
        });
        return reply.send({
          data: page.items.map(areaHttp),
          meta: { ...responseMeta(request.requestContext), page: { next_cursor: page.nextCursor, has_more: page.nextCursor !== null } },
        });
      }),
  );

  app.get<{ Params: Params }>(
    '/api/v1/operational-areas/:id',
    {
      schema: {
        tags: ['operational-areas'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withOperationalAreaErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'operational_area.read');
        const value = await service.area(auth.companyId, auth.permittedBranchIds, request.params.id);
        return reply
          .header('etag', `"${value.version.toString()}"`)
          .send(successResponse(areaHttp(value), request.requestContext));
      }),
  );

  app.put<{ Params: Params; Body: { name?: string; status?: 'active' | 'inactive' } }>(
    '/api/v1/operational-areas/:id',
    {
      schema: {
        tags: ['operational-areas'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        headers: { type: 'object', properties: { 'if-match': { type: 'string' } } },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 160 },
            status: { type: 'string', enum: ['active', 'inactive'] },
          },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withOperationalAreaErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'operational_area.manage');
        const ifMatch = request.headers['if-match'];
        const expectedVersion = BigInt(typeof ifMatch === 'string' ? ifMatch.replaceAll('"', '') : '0');
        const updated = await service.update(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          request.params.id,
          expectedVersion,
          {
            ...(request.body.name === undefined ? {} : { name: request.body.name }),
            ...(request.body.status === undefined ? {} : { status: request.body.status }),
          },
        );
        return reply
          .header('etag', `"${updated.version.toString()}"`)
          .send(successResponse(areaHttp(updated), request.requestContext));
      }),
  );
}
