import type { FastifyInstance, FastifyRequest } from 'fastify';

import { responseMeta, successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requireBranchAccess, requirePermission } from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import { idempotencyKey } from '../catalog/catalog.schemas.js';
import { withPartyErrors } from './parties.http-errors.js';
import type { PartyMutationContext, PartyRoomRow } from './parties.types.js';
import type { PartyRoomsService } from './party-rooms.service.js';

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

function mutationContext(request: FastifyRequest, companyId: string, actorId: string): PartyMutationContext {
  return {
    companyId,
    actorId,
    requestId: request.requestContext.requestId,
    correlationId: request.requestContext.correlationId,
    timestamp: new Date(),
    deviceId: request.requestContext.deviceId,
  };
}
function expectedVersionFrom(request: FastifyRequest): bigint {
  const ifMatch = request.headers['if-match'];
  return BigInt(typeof ifMatch === 'string' ? ifMatch.replaceAll('"', '') : '0');
}

function roomHttp(value: PartyRoomRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    branch_id: value.branchId,
    code: value.code,
    name: value.name,
    status: value.status,
    capacity_children: value.capacityChildren,
    capacity_adults: value.capacityAdults,
    capacity_total: value.capacityTotal,
    color: value.color,
    notes: value.notes,
    version: Number(value.version),
    created_at: value.createdAt.toISOString(),
    updated_at: value.updatedAt.toISOString(),
  };
}

export function registerPartyRoomRoutes(app: FastifyInstance, authentication: AuthService, service: PartyRoomsService): void {
  app.post<{
    Body: {
      id?: string;
      branch_id: string;
      code: string;
      name: string;
      capacity_children?: number;
      capacity_adults?: number;
      capacity_total?: number;
      color?: string;
      notes?: string;
    };
  }>(
    '/api/v1/party-rooms',
    {
      schema: {
        tags: ['parties'],
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
            capacity_children: { type: 'integer', minimum: 0 },
            capacity_adults: { type: 'integer', minimum: 0 },
            capacity_total: { type: 'integer', minimum: 0 },
            color: { type: 'string', maxLength: 32 },
            notes: { type: 'string', maxLength: 2000 },
          },
        },
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPartyErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'party.manage');
        requireBranchAccess(authentication, auth, request.body.branch_id);
        const created = await service.createRoom(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          {
            ...(request.body.id === undefined ? {} : { id: request.body.id }),
            branchId: request.body.branch_id,
            code: request.body.code,
            name: request.body.name,
            ...(request.body.capacity_children === undefined ? {} : { capacityChildren: request.body.capacity_children }),
            ...(request.body.capacity_adults === undefined ? {} : { capacityAdults: request.body.capacity_adults }),
            ...(request.body.capacity_total === undefined ? {} : { capacityTotal: request.body.capacity_total }),
            ...(request.body.color === undefined ? {} : { color: request.body.color }),
            ...(request.body.notes === undefined ? {} : { notes: request.body.notes }),
          },
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .code(201)
          .header('etag', `"${created.value.version.toString()}"`)
          .send(successResponse(roomHttp(created.value), request.requestContext));
      }),
  );

  app.get<{ Querystring: { cursor?: string; limit?: number; branch_id?: string; status?: string } }>(
    '/api/v1/party-rooms',
    {
      schema: {
        tags: ['parties'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cursor: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            branch_id: { type: 'string', format: 'uuid' },
            status: { type: 'string', enum: ['active', 'maintenance', 'out_of_service'] },
          },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPartyErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'party.read');
        const query = request.query;
        if (query.branch_id !== undefined) requireBranchAccess(authentication, auth, query.branch_id);
        const page = await service.listRooms(auth.companyId, auth.permittedBranchIds, {
          limit: query.limit ?? 50,
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(query.branch_id === undefined ? {} : { branchId: query.branch_id }),
          ...(query.status === undefined ? {} : { status: query.status }),
        });
        return reply.send({
          data: page.items.map(roomHttp),
          meta: { ...responseMeta(request.requestContext), page: { next_cursor: page.nextCursor, has_more: page.nextCursor !== null } },
        });
      }),
  );

  app.get<{ Params: Params }>(
    '/api/v1/party-rooms/:id',
    {
      schema: {
        tags: ['parties'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPartyErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'party.read');
        const value = await service.room(auth.companyId, auth.permittedBranchIds, request.params.id);
        return reply.header('etag', `"${value.version.toString()}"`).send(successResponse(roomHttp(value), request.requestContext));
      }),
  );

  app.patch<{
    Params: Params;
    Body: {
      status?: 'active' | 'maintenance' | 'out_of_service';
      capacity_children?: number | null;
      capacity_adults?: number | null;
      capacity_total?: number | null;
      color?: string | null;
      notes?: string | null;
    };
  }>(
    '/api/v1/party-rooms/:id',
    {
      schema: {
        tags: ['parties'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        headers: { type: 'object', properties: { 'if-match': { type: 'string' } } },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: { type: 'string', enum: ['active', 'maintenance', 'out_of_service'] },
            capacity_children: { type: ['integer', 'null'], minimum: 0 },
            capacity_adults: { type: ['integer', 'null'], minimum: 0 },
            capacity_total: { type: ['integer', 'null'], minimum: 0 },
            color: { type: ['string', 'null'], maxLength: 32 },
            notes: { type: ['string', 'null'], maxLength: 2000 },
          },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPartyErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'party.manage');
        const updated = await service.updateRoom(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          request.params.id,
          expectedVersionFrom(request),
          request.body,
        );
        return reply.header('etag', `"${updated.version.toString()}"`).send(successResponse(roomHttp(updated), request.requestContext));
      }),
  );
}
