import type { FastifyInstance, FastifyRequest } from 'fastify';

import { responseMeta, successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requireBranchAccess, requirePermission } from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import { idempotencyKey } from '../catalog/catalog.schemas.js';
import { withPartyErrors } from './parties.http-errors.js';
import type { PartyMutationContext, PartyPackageRow } from './parties.types.js';
import { packageQuoteInput, type PartyPackagesService } from './party-packages.service.js';

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
const jsonObjectSchema = { type: 'object' } as const;

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

function packageHttp(value: PartyPackageRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    branch_id: value.branchId,
    code: value.code,
    name: value.name,
    description: value.description,
    status: value.status,
    price: value.price,
    currency_code: value.currencyCode,
    duration_minutes: value.durationMinutes,
    children_included: value.childrenIncluded,
    adults_included: value.adultsIncluded,
    child_extra_cost: value.childExtraCost,
    adult_extra_cost: value.adultExtraCost,
    capacity_max: value.capacityMax,
    extra_half_hour_cost: value.extraHalfHourCost,
    includes: value.includes,
    restrictions: value.restrictions,
    version: Number(value.version),
    created_at: value.createdAt.toISOString(),
    updated_at: value.updatedAt.toISOString(),
  };
}

export function registerPartyPackageRoutes(app: FastifyInstance, authentication: AuthService, service: PartyPackagesService): void {
  app.post<{
    Body: {
      id?: string;
      branch_id?: string;
      code: string;
      name: string;
      description?: string;
      price: string;
      currency_code?: string;
      duration_minutes: number;
      children_included?: number;
      adults_included?: number;
      child_extra_cost?: string;
      adult_extra_cost?: string;
      capacity_max?: number;
      extra_half_hour_cost?: string;
      includes?: Record<string, unknown>;
      restrictions?: Record<string, unknown>;
    };
  }>(
    '/api/v1/party-packages',
    {
      schema: {
        tags: ['parties'],
        headers: idempotencyHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['code', 'name', 'price', 'duration_minutes'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            branch_id: { type: 'string', format: 'uuid' },
            code: { type: 'string', minLength: 1, maxLength: 64 },
            name: { type: 'string', minLength: 1, maxLength: 160 },
            description: { type: 'string', maxLength: 2000 },
            price: { type: 'string', pattern: '^(?:0|[1-9]\\d*)(?:\\.\\d{1,4})?$' },
            currency_code: { type: 'string', minLength: 3, maxLength: 3 },
            duration_minutes: { type: 'integer', minimum: 1 },
            children_included: { type: 'integer', minimum: 0 },
            adults_included: { type: 'integer', minimum: 0 },
            child_extra_cost: { type: 'string', pattern: '^(?:0|[1-9]\\d*)(?:\\.\\d{1,4})?$' },
            adult_extra_cost: { type: 'string', pattern: '^(?:0|[1-9]\\d*)(?:\\.\\d{1,4})?$' },
            capacity_max: { type: 'integer', minimum: 0 },
            extra_half_hour_cost: { type: 'string', pattern: '^(?:0|[1-9]\\d*)(?:\\.\\d{1,4})?$' },
            includes: jsonObjectSchema,
            restrictions: jsonObjectSchema,
          },
        },
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPartyErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'party.manage');
        if (request.body.branch_id !== undefined) requireBranchAccess(authentication, auth, request.body.branch_id);
        const body = request.body;
        const created = await service.createPackage(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          {
            ...(body.id === undefined ? {} : { id: body.id }),
            ...(body.branch_id === undefined ? {} : { branchId: body.branch_id }),
            code: body.code,
            name: body.name,
            ...(body.description === undefined ? {} : { description: body.description }),
            price: body.price,
            ...(body.currency_code === undefined ? {} : { currencyCode: body.currency_code }),
            durationMinutes: body.duration_minutes,
            ...(body.children_included === undefined ? {} : { childrenIncluded: body.children_included }),
            ...(body.adults_included === undefined ? {} : { adultsIncluded: body.adults_included }),
            ...(body.child_extra_cost === undefined ? {} : { childExtraCost: body.child_extra_cost }),
            ...(body.adult_extra_cost === undefined ? {} : { adultExtraCost: body.adult_extra_cost }),
            ...(body.capacity_max === undefined ? {} : { capacityMax: body.capacity_max }),
            ...(body.extra_half_hour_cost === undefined ? {} : { extraHalfHourCost: body.extra_half_hour_cost }),
            ...(body.includes === undefined ? {} : { includes: body.includes }),
            ...(body.restrictions === undefined ? {} : { restrictions: body.restrictions }),
          },
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .code(201)
          .header('etag', `"${created.value.version.toString()}"`)
          .send(successResponse(packageHttp(created.value), request.requestContext));
      }),
  );

  app.get<{ Querystring: { cursor?: string; limit?: number; branch_id?: string; status?: string } }>(
    '/api/v1/party-packages',
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
            status: { type: 'string', enum: ['active', 'inactive'] },
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
        const page = await service.listPackages(auth.companyId, {
          limit: query.limit ?? 50,
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(query.branch_id === undefined ? {} : { branchId: query.branch_id }),
          ...(query.status === undefined ? {} : { status: query.status }),
        });
        return reply.send({
          data: page.items.map(packageHttp),
          meta: { ...responseMeta(request.requestContext), page: { next_cursor: page.nextCursor, has_more: page.nextCursor !== null } },
        });
      }),
  );

  app.get<{ Params: Params }>(
    '/api/v1/party-packages/:id',
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
        const value = await service.packageRow(auth.companyId, auth.permittedBranchIds, request.params.id);
        return reply.header('etag', `"${value.version.toString()}"`).send(successResponse(packageHttp(value), request.requestContext));
      }),
  );

  app.patch<{
    Params: Params;
    Body: {
      name?: string;
      description?: string | null;
      status?: 'active' | 'inactive';
      price?: string;
      duration_minutes?: number;
      children_included?: number;
      adults_included?: number;
      child_extra_cost?: string;
      adult_extra_cost?: string;
      capacity_max?: number | null;
      extra_half_hour_cost?: string;
      includes?: Record<string, unknown> | null;
      restrictions?: Record<string, unknown> | null;
    };
  }>(
    '/api/v1/party-packages/:id',
    {
      schema: {
        tags: ['parties'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        headers: { type: 'object', properties: { 'if-match': { type: 'string' } } },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 160 },
            description: { type: ['string', 'null'], maxLength: 2000 },
            status: { type: 'string', enum: ['active', 'inactive'] },
            price: { type: 'string', pattern: '^(?:0|[1-9]\\d*)(?:\\.\\d{1,4})?$' },
            duration_minutes: { type: 'integer', minimum: 1 },
            children_included: { type: 'integer', minimum: 0 },
            adults_included: { type: 'integer', minimum: 0 },
            child_extra_cost: { type: 'string', pattern: '^(?:0|[1-9]\\d*)(?:\\.\\d{1,4})?$' },
            adult_extra_cost: { type: 'string', pattern: '^(?:0|[1-9]\\d*)(?:\\.\\d{1,4})?$' },
            capacity_max: { type: ['integer', 'null'], minimum: 0 },
            extra_half_hour_cost: { type: 'string', pattern: '^(?:0|[1-9]\\d*)(?:\\.\\d{1,4})?$' },
            includes: { anyOf: [jsonObjectSchema, { type: 'null' }] },
            restrictions: { anyOf: [jsonObjectSchema, { type: 'null' }] },
          },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPartyErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'party.manage');
        const updated = await service.updatePackage(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          request.params.id,
          expectedVersionFrom(request),
          request.body,
        );
        return reply.header('etag', `"${updated.version.toString()}"`).send(successResponse(packageHttp(updated), request.requestContext));
      }),
  );

  // TASK 14.3 Part A.6 — Cotizador. A pure read, computes/returns the
  // itemized breakdown; never persists anything.
  app.post<{ Params: Params; Body: { children?: number; adults?: number; extra_half_hours?: number } }>(
    '/api/v1/party-packages/:id/quote',
    {
      schema: {
        tags: ['parties'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            children: { type: 'integer', minimum: 0 },
            adults: { type: 'integer', minimum: 0 },
            extra_half_hours: { type: 'integer', minimum: 0 },
          },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPartyErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'party.read');
        const pkg = await service.packageRow(auth.companyId, auth.permittedBranchIds, request.params.id);
        const breakdown = packageQuoteInput(pkg, {
          children: request.body.children ?? 0,
          adults: request.body.adults ?? 0,
          extraHalfHours: request.body.extra_half_hours ?? 0,
        });
        return reply.send(
          successResponse(
            {
              package_id: pkg.id,
              currency_code: pkg.currencyCode,
              base: breakdown.base,
              children_extra: breakdown.childrenExtra,
              adults_extra: breakdown.adultsExtra,
              time_extra: breakdown.timeExtra,
              total: breakdown.total,
            },
            request.requestContext,
          ),
        );
      }),
  );
}
