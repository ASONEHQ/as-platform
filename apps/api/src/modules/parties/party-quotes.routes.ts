import type { FastifyInstance, FastifyRequest } from 'fastify';

import { responseMeta, successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requireBranchAccess, requirePermission } from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import { idempotencyKey } from '../catalog/catalog.schemas.js';
import { withPartyErrors } from './parties.http-errors.js';
import type { PartyMutationContext, PartyQuoteRow, PartyQuoteStatus } from './parties.types.js';
import type { PartyQuotesService } from './party-quotes.service.js';

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
const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } as const;

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

export function quoteHttp(value: PartyQuoteRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    branch_id: value.branchId,
    quote_number: value.quoteNumber,
    status: value.status,
    customer_id: value.customerId,
    customer_display_name: value.customerDisplayName,
    customer_phone: value.customerPhone,
    seller_user_id: value.sellerUserId,
    package_id: value.packageId,
    package_name: value.packageSnapshot.package_name,
    package_snapshot: value.packageSnapshot,
    children_count: value.childrenCount,
    adults_count: value.adultsCount,
    extra_half_hours: value.extraHalfHours,
    currency_code: value.currencyCode,
    subtotal_amount: value.subtotalAmount,
    discount_total: value.discountTotal,
    tax_total: value.taxTotal,
    total_amount: value.totalAmount,
    breakdown: value.breakdown,
    room_id: value.roomId,
    event_date: value.eventDate,
    start_time: value.startTime,
    notes: value.notes,
    converted_reservation_id: value.convertedReservationId,
    converted_at: value.convertedAt,
    cancelled_at: value.cancelledAt,
    cancel_reason: value.cancelReason,
    created_by: value.createdBy,
    version: value.version.toString(),
    created_at: value.createdAt,
    updated_at: value.updatedAt,
  };
}

/**
 * TASK 17.6 — saved party quotations. Reads need `party.read`, writes
 * `party.manage`; every row is filtered to the actor's permitted branches
 * server-side (an out-of-scope quote is a 404, never a 403 that leaks it
 * exists). Converting a quote is NOT here: it is an explicit reservation
 * creation that carries `quote_id` (see `/api/v1/party-reservations`).
 */
export function registerPartyQuoteRoutes(
  app: FastifyInstance,
  authentication: AuthService,
  service: PartyQuotesService,
): void {
  app.post<{
    Body: {
      branch_id: string;
      package_id: string;
      children_count?: number;
      adults_count?: number;
      extra_half_hours?: number;
      customer_id?: string;
      room_id?: string;
      event_date?: string;
      start_time?: string;
      notes?: string;
    };
  }>(
    '/api/v1/party-quotes',
    {
      schema: {
        tags: ['parties'],
        headers: idempotencyHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['branch_id', 'package_id'],
          properties: {
            branch_id: { type: 'string', format: 'uuid' },
            package_id: { type: 'string', format: 'uuid' },
            children_count: { type: 'integer', minimum: 0 },
            adults_count: { type: 'integer', minimum: 0 },
            extra_half_hours: { type: 'integer', minimum: 0 },
            customer_id: { type: 'string', format: 'uuid' },
            room_id: { type: 'string', format: 'uuid' },
            event_date: { type: 'string', format: 'date' },
            start_time: { type: 'string' },
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
        const body = request.body;
        const created = await service.createQuote(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          {
            branchId: body.branch_id,
            packageId: body.package_id,
            ...(body.children_count === undefined ? {} : { childrenCount: body.children_count }),
            ...(body.adults_count === undefined ? {} : { adultsCount: body.adults_count }),
            ...(body.extra_half_hours === undefined ? {} : { extraHalfHours: body.extra_half_hours }),
            ...(body.customer_id === undefined ? {} : { customerId: body.customer_id }),
            ...(body.room_id === undefined ? {} : { roomId: body.room_id }),
            ...(body.event_date === undefined ? {} : { eventDate: body.event_date }),
            ...(body.start_time === undefined ? {} : { startTime: body.start_time }),
            ...(body.notes === undefined ? {} : { notes: body.notes }),
          },
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .code(201)
          .header('etag', `"${created.value.version.toString()}"`)
          .send(successResponse(quoteHttp(created.value), request.requestContext));
      }),
  );

  interface ListQuery {
    cursor?: string;
    limit?: number;
    branch_id?: string;
    status?: PartyQuoteStatus;
    customer_id?: string;
  }
  app.get<{ Querystring: ListQuery }>(
    '/api/v1/party-quotes',
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
            status: { type: 'string', enum: ['draft', 'cancelled', 'converted'] },
            customer_id: { type: 'string', format: 'uuid' },
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
        const page = await service.listQuotes(auth.companyId, auth.permittedBranchIds, {
          limit: query.limit ?? 50,
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(query.branch_id === undefined ? {} : { branchId: query.branch_id }),
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.customer_id === undefined ? {} : { customerId: query.customer_id }),
        });
        return reply.send({
          data: page.items.map(quoteHttp),
          meta: { ...responseMeta(request.requestContext), page: { next_cursor: page.nextCursor, has_more: page.nextCursor !== null } },
        });
      }),
  );

  app.get<{ Params: Params }>(
    '/api/v1/party-quotes/:id',
    { schema: { tags: ['parties'], params: idParams, response: { 200: responseSchema, ...commonErrors } } },
    async (request, reply) =>
      withPartyErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'party.read');
        const value = await service.quote(auth.companyId, auth.permittedBranchIds, request.params.id);
        return reply.header('etag', `"${value.version.toString()}"`).send(successResponse(quoteHttp(value), request.requestContext));
      }),
  );

  app.patch<{
    Params: Params;
    Body: {
      package_id?: string;
      children_count?: number;
      adults_count?: number;
      extra_half_hours?: number;
      customer_id?: string | null;
      room_id?: string | null;
      event_date?: string | null;
      start_time?: string | null;
      notes?: string | null;
    };
  }>(
    '/api/v1/party-quotes/:id',
    {
      schema: {
        tags: ['parties'],
        params: idParams,
        headers: { type: 'object', properties: { 'if-match': { type: 'string' } } },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            package_id: { type: 'string', format: 'uuid' },
            children_count: { type: 'integer', minimum: 0 },
            adults_count: { type: 'integer', minimum: 0 },
            extra_half_hours: { type: 'integer', minimum: 0 },
            customer_id: { type: ['string', 'null'], format: 'uuid' },
            room_id: { type: ['string', 'null'], format: 'uuid' },
            event_date: { type: ['string', 'null'], format: 'date' },
            start_time: { type: ['string', 'null'] },
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
        const body = request.body;
        const updated = await service.updateQuote(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          request.params.id,
          expectedVersionFrom(request),
          {
            ...(body.package_id === undefined ? {} : { packageId: body.package_id }),
            ...(body.children_count === undefined ? {} : { childrenCount: body.children_count }),
            ...(body.adults_count === undefined ? {} : { adultsCount: body.adults_count }),
            ...(body.extra_half_hours === undefined ? {} : { extraHalfHours: body.extra_half_hours }),
            ...(body.customer_id === undefined ? {} : { customerId: body.customer_id }),
            ...(body.room_id === undefined ? {} : { roomId: body.room_id }),
            ...(body.event_date === undefined ? {} : { eventDate: body.event_date }),
            ...(body.start_time === undefined ? {} : { startTime: body.start_time }),
            ...(body.notes === undefined ? {} : { notes: body.notes }),
          },
        );
        return reply.header('etag', `"${updated.version.toString()}"`).send(successResponse(quoteHttp(updated), request.requestContext));
      }),
  );

  app.post<{ Params: Params; Body: { reason: string } }>(
    '/api/v1/party-quotes/:id/cancel',
    {
      schema: {
        tags: ['parties'],
        params: idParams,
        headers: idempotencyHeaders,
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
      withPartyErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'party.manage');
        const result = await service.cancelQuote(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          request.params.id,
          request.body.reason,
        );
        if (result.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .header('etag', `"${result.value.version.toString()}"`)
          .send(successResponse(quoteHttp(result.value), request.requestContext));
      }),
  );

  app.get<{ Params: Params }>(
    '/api/v1/party-quotes/:id/document',
    { schema: { tags: ['parties'], params: idParams, response: { 200: { type: 'string' }, ...commonErrors } } },
    async (request, reply) =>
      withPartyErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'party.read');
        const html = await service.document(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          request.params.id,
        );
        return reply.type('text/html; charset=utf-8').send(html);
      }),
  );
}
