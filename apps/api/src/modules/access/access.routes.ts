import type { FastifyInstance, FastifyRequest } from 'fastify';

import { responseMeta, successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requireBranchAccess, requirePermission } from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import { idempotencyKey } from '../catalog/catalog.schemas.js';
import { withAccessErrors } from './access.http-errors.js';
import type { AccessService } from './access.service.js';
import type { AccessCredentialRow, AccessEventRow, AccessMutationContext } from './access.types.js';

interface Params {
  id: string;
}
interface InsideQuery {
  branch_id?: string;
  limit?: number;
  cursor?: string;
}
interface EventsQuery {
  branch_id?: string;
  limit?: number;
  cursor?: string;
  occurred_from?: string;
  occurred_to?: string;
}
interface OccupancyQuery {
  branch_id: string;
}
interface IssueBody {
  branch_id: string;
  sale_id: string;
  customer_id?: string;
  allows_reentry?: boolean;
}
interface ScanBody {
  branch_id: string;
  code: string;
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

function mutationContext(request: FastifyRequest, companyId: string, actorId: string): AccessMutationContext {
  return {
    companyId,
    actorId,
    requestId: request.requestContext.requestId,
    correlationId: request.requestContext.correlationId,
    timestamp: new Date(),
  };
}

function credentialHttp(value: AccessCredentialRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    branch_id: value.branchId,
    code: value.code,
    sale_id: value.saleId,
    customer_id: value.customerId,
    allows_reentry: value.allowsReentry,
    status: value.status,
    currently_inside: value.currentlyInside,
    issued_at: value.issuedAt.toISOString(),
    issued_by: value.issuedBy,
    voided_at: value.voidedAt?.toISOString() ?? null,
    voided_by: value.voidedBy,
  };
}
function eventHttp(value: AccessEventRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    branch_id: value.branchId,
    credential_id: value.credentialId,
    event_type: value.eventType,
    occurred_at: value.occurredAt.toISOString(),
    created_by: value.createdBy,
    created_at: value.createdAt.toISOString(),
  };
}

export function registerAccessRoutes(app: FastifyInstance, authentication: AuthService, service: AccessService): void {
  // Issue a credential against a real, already-paid sale. Permission:
  // `access.scan` (this domain's own documented choice — see
  // `AccessService.issueCredential`'s own doc comment for why no separate
  // "issue" permission was introduced).
  app.post<{ Body: IssueBody }>(
    '/api/v1/access-credentials',
    {
      schema: {
        tags: ['access'],
        headers: idempotencyHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['branch_id', 'sale_id'],
          properties: {
            branch_id: { type: 'string', format: 'uuid' },
            sale_id: { type: 'string', format: 'uuid' },
            customer_id: { type: 'string', format: 'uuid' },
            allows_reentry: { type: 'boolean' },
          },
        },
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withAccessErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'access.scan');
        requireBranchAccess(authentication, auth, request.body.branch_id);
        const created = await service.issueCredential(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          {
            branchId: request.body.branch_id,
            saleId: request.body.sale_id,
            ...(request.body.customer_id === undefined ? {} : { customerId: request.body.customer_id }),
            ...(request.body.allows_reentry === undefined ? {} : { allowsReentry: request.body.allows_reentry }),
          },
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        return reply.code(201).send(successResponse(credentialHttp(created.value), request.requestContext));
      }),
  );

  // The real scanner — infers entry-vs-exit from the credential's own
  // current state (see `AccessService.scan`'s own doc comment for the
  // full design reasoning). No idempotency-key header — deliberately, see
  // that same doc comment.
  app.post<{ Body: ScanBody }>(
    '/api/v1/access-credentials/scan',
    {
      schema: {
        tags: ['access'],
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['branch_id', 'code'],
          properties: {
            branch_id: { type: 'string', format: 'uuid' },
            code: { type: 'string', minLength: 1, maxLength: 200 },
          },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withAccessErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'access.scan');
        requireBranchAccess(authentication, auth, request.body.branch_id);
        const scanned = await service.scan(
          mutationContext(request, auth.companyId, auth.userId),
          request.body.branch_id,
          request.body.code,
        );
        return reply.send(
          successResponse(
            { credential: credentialHttp(scanned.credential), event: eventHttp(scanned.event) },
            request.requestContext,
          ),
        );
      }),
  );

  // Real-time occupancy count — registered BEFORE `/:id` below; Fastify's
  // router resolves a static segment ahead of a parametric one regardless
  // of registration order, but this ordering keeps the file's own reading
  // order matching the router's actual behavior.
  app.get<{ Querystring: OccupancyQuery }>(
    '/api/v1/access-credentials/occupancy',
    {
      schema: {
        tags: ['access'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          required: ['branch_id'],
          properties: { branch_id: { type: 'string', format: 'uuid' } },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withAccessErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'access.read');
        requireBranchAccess(authentication, auth, request.query.branch_id);
        const value = await service.occupancy(auth.companyId, auth.permittedBranchIds, request.query.branch_id);
        return reply.send(
          successResponse({ branch_id: value.branchId, count: value.count }, request.requestContext),
        );
      }),
  );

  // "Who's inside right now" — always filtered to `currently_inside=true`
  // (see `AccessRepository.listCurrentlyInside`'s own doc comment); this
  // domain has no general "list every credential ever issued" endpoint,
  // since nothing in this task's own requirements calls for one.
  app.get<{ Querystring: InsideQuery }>(
    '/api/v1/access-credentials',
    {
      schema: {
        tags: ['access'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            branch_id: { type: 'string', format: 'uuid' },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            cursor: { type: 'string' },
          },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withAccessErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'access.read');
        const query = request.query;
        if (query.branch_id !== undefined) requireBranchAccess(authentication, auth, query.branch_id);
        const page = await service.currentlyInside(auth.companyId, auth.permittedBranchIds, {
          limit: query.limit ?? 50,
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(query.branch_id === undefined ? {} : { branchId: query.branch_id }),
        });
        return reply.send({
          data: page.items.map(credentialHttp),
          meta: {
            ...responseMeta(request.requestContext),
            page: { next_cursor: page.nextCursor, has_more: page.nextCursor !== null },
          },
        });
      }),
  );

  app.get<{ Params: Params }>(
    '/api/v1/access-credentials/:id',
    {
      schema: {
        tags: ['access'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withAccessErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'access.read');
        const value = await service.credential(auth.companyId, auth.permittedBranchIds, request.params.id);
        return reply.send(successResponse(credentialHttp(value), request.requestContext));
      }),
  );

  // Administrative void. Permission: `access.manage` (distinct from
  // day-to-day `access.scan` — see `technical-permissions.ts`'s own
  // comment on this domain's two codes).
  app.post<{ Params: Params }>(
    '/api/v1/access-credentials/:id/void',
    {
      schema: {
        tags: ['access'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        headers: idempotencyHeaders,
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withAccessErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'access.manage');
        const voided = await service.voidCredential(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          request.params.id,
          idempotencyKey(request.headers['idempotency-key']),
        );
        if (voided.replayed) reply.header('idempotency-replayed', 'true');
        return reply.send(successResponse(credentialHttp(voided.value), request.requestContext));
      }),
  );

  // Immutable, paginated event history.
  app.get<{ Querystring: EventsQuery }>(
    '/api/v1/access-events',
    {
      schema: {
        tags: ['access'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            branch_id: { type: 'string', format: 'uuid' },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            cursor: { type: 'string' },
            occurred_from: { type: 'string', format: 'date-time' },
            occurred_to: { type: 'string', format: 'date-time' },
          },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withAccessErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'access.read');
        const query = request.query;
        if (query.branch_id !== undefined) requireBranchAccess(authentication, auth, query.branch_id);
        const page = await service.listEvents(auth.companyId, auth.permittedBranchIds, {
          limit: query.limit ?? 50,
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(query.branch_id === undefined ? {} : { branchId: query.branch_id }),
          ...(query.occurred_from === undefined ? {} : { occurredFrom: new Date(query.occurred_from) }),
          ...(query.occurred_to === undefined ? {} : { occurredTo: new Date(query.occurred_to) }),
        });
        return reply.send({
          data: page.items.map(eventHttp),
          meta: {
            ...responseMeta(request.requestContext),
            page: { next_cursor: page.nextCursor, has_more: page.nextCursor !== null },
          },
        });
      }),
  );
}
