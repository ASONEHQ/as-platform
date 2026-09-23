import type { FastifyInstance, FastifyRequest } from 'fastify';

import { responseMeta, successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requireBranchAccess, requirePermission } from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import { idempotencyKey } from '../catalog/catalog.schemas.js';
import { withPartyErrors } from './parties.http-errors.js';
import type {
  PartyMutationContext,
  PartyReservationPaymentPurpose,
  PartyReservationPaymentRow,
  PartyReservationRow,
  PartyReservationSnackRow,
  PartyReservationSockRow,
  PartyReservationStatus,
} from './parties.types.js';
import type { PartyReservationDetail, PartyReservationsService } from './party-reservations.service.js';

interface Params {
  id: string;
}
interface SockParams {
  id: string;
  sockId: string;
}
interface SnackParams {
  id: string;
  snackId: string;
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

function reservationHttp(value: PartyReservationRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    branch_id: value.branchId,
    reservation_number: value.reservationNumber,
    customer_id: value.customerId,
    customer_display_name: value.customerDisplayName,
    customer_phone: value.customerPhone,
    celebrant_name: value.celebrantName,
    celebrant_age: value.celebrantAge,
    room_id: value.roomId,
    package_id: value.packageId,
    room_name_snapshot: value.roomNameSnapshot,
    package_name_snapshot: value.packageNameSnapshot,
    event_date: value.eventDate,
    start_time: value.startTime,
    end_time: value.endTime,
    children_count: value.childrenCount,
    adults_count: value.adultsCount,
    seller_user_id: value.sellerUserId,
    status: value.status,
    account_status: value.accountStatus,
    subtotal_amount: value.subtotalAmount,
    discount_total: value.discountTotal,
    tax_total: value.taxTotal,
    coupon_id: value.couponId,
    coupon_code_snapshot: value.couponCodeSnapshot,
    quoted_total: value.quotedTotal,
    currency_code: value.currencyCode,
    notes: value.notes,
    cancelled_at: value.cancelledAt?.toISOString() ?? null,
    cancelled_by: value.cancelledBy,
    cancellation_reason: value.cancellationReason,
    version: Number(value.version),
    created_at: value.createdAt.toISOString(),
    updated_at: value.updatedAt.toISOString(),
  };
}
function snackHttp(value: PartyReservationSnackRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    reservation_id: value.reservationId,
    product_id: value.productId,
    name_snapshot: value.nameSnapshot,
    unit_price_snapshot: value.unitPriceSnapshot,
    quantity: value.quantity,
    line_total: value.lineTotal,
    tax_snapshot: value.taxSnapshot,
    tax_total: value.taxTotal,
    product_variant_id: value.productVariantId,
    stock_deducted: value.stockDeducted,
    stock_deducted_at: value.stockDeductedAt?.toISOString() ?? null,
    issued_quantity: value.issuedQuantity,
    included_in_package: value.includedInPackage,
    created_at: value.createdAt.toISOString(),
  };
}
function sockHttp(value: PartyReservationSockRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    reservation_id: value.reservationId,
    size: value.size,
    quantity: value.quantity,
    product_variant_id: value.productVariantId,
    stock_deducted: value.stockDeducted,
    stock_deducted_at: value.stockDeductedAt?.toISOString() ?? null,
    issued_quantity: value.issuedQuantity,
    included_in_package: value.includedInPackage,
    created_at: value.createdAt.toISOString(),
  };
}
function paymentHttp(value: PartyReservationPaymentRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    branch_id: value.branchId,
    reservation_id: value.reservationId,
    cash_movement_id: value.cashMovementId,
    purpose: value.purpose,
    amount: value.amountSnapshot,
    created_by: value.createdBy,
    created_at: value.createdAt.toISOString(),
  };
}
function detailHttp(value: PartyReservationDetail): Readonly<Record<string, unknown>> {
  return {
    ...reservationHttp(value.reservation),
    snacks: value.snacks.map(snackHttp),
    socks: value.socks.map(sockHttp),
    payments_summary: { total_paid: value.paymentsSummary.totalPaid, count: value.paymentsSummary.count },
    documents_summary: {
      count: value.documentsSummary.count,
      last_generated_at: value.documentsSummary.lastGeneratedAt,
      last_document_type: value.documentsSummary.lastDocumentType,
    },
  };
}

const moneyPattern = '^(?:0|[1-9]\\d*)(?:\\.\\d{1,4})?$';

export function registerPartyReservationRoutes(
  app: FastifyInstance,
  authentication: AuthService,
  service: PartyReservationsService,
): void {
  // --- Create ------------------------------------------------------------------

  app.post<{
    Body: {
      id?: string;
      branch_id: string;
      customer_id?: string;
      celebrant_name?: string;
      celebrant_age?: number;
      room_id: string;
      package_id: string;
      event_date: string;
      start_time: string;
      end_time: string;
      children_count?: number;
      adults_count?: number;
      extra_half_hours?: number;
      seller_user_id?: string;
      notes?: string;
    };
  }>(
    '/api/v1/party-reservations',
    {
      schema: {
        tags: ['parties'],
        headers: idempotencyHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['branch_id', 'room_id', 'package_id', 'event_date', 'start_time', 'end_time'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            branch_id: { type: 'string', format: 'uuid' },
            customer_id: { type: 'string', format: 'uuid' },
            celebrant_name: { type: 'string', maxLength: 200 },
            celebrant_age: { type: 'integer', minimum: 0 },
            room_id: { type: 'string', format: 'uuid' },
            package_id: { type: 'string', format: 'uuid' },
            event_date: { type: 'string', format: 'date' },
            start_time: { type: 'string' },
            end_time: { type: 'string' },
            children_count: { type: 'integer', minimum: 0 },
            adults_count: { type: 'integer', minimum: 0 },
            extra_half_hours: { type: 'integer', minimum: 0 },
            seller_user_id: { type: 'string', format: 'uuid' },
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
        const created = await service.createReservation(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          {
            ...(body.id === undefined ? {} : { id: body.id }),
            branchId: body.branch_id,
            ...(body.customer_id === undefined ? {} : { customerId: body.customer_id }),
            ...(body.celebrant_name === undefined ? {} : { celebrantName: body.celebrant_name }),
            ...(body.celebrant_age === undefined ? {} : { celebrantAge: body.celebrant_age }),
            roomId: body.room_id,
            packageId: body.package_id,
            eventDate: body.event_date,
            startTime: body.start_time,
            endTime: body.end_time,
            ...(body.children_count === undefined ? {} : { childrenCount: body.children_count }),
            ...(body.adults_count === undefined ? {} : { adultsCount: body.adults_count }),
            ...(body.extra_half_hours === undefined ? {} : { extraHalfHours: body.extra_half_hours }),
            ...(body.seller_user_id === undefined ? {} : { sellerUserId: body.seller_user_id }),
            ...(body.notes === undefined ? {} : { notes: body.notes }),
          },
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .code(201)
          .header('etag', `"${created.value.version.toString()}"`)
          .send(successResponse(reservationHttp(created.value), request.requestContext));
      }),
  );

  // --- List / calendar -----------------------------------------------------------

  const listQuerystring = {
    type: 'object',
    additionalProperties: false,
    properties: {
      cursor: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
      branch_id: { type: 'string', format: 'uuid' },
      status: { type: 'string', enum: ['held', 'pending_deposit', 'confirmed', 'completed', 'cancelled'] },
      room_id: { type: 'string', format: 'uuid' },
      customer_id: { type: 'string', format: 'uuid' },
      seller_user_id: { type: 'string', format: 'uuid' },
      event_date_from: { type: 'string', format: 'date' },
      event_date_to: { type: 'string', format: 'date' },
    },
  } as const;
  interface ListQuery {
    cursor?: string;
    limit?: number;
    branch_id?: string;
    status?: PartyReservationStatus;
    room_id?: string;
    customer_id?: string;
    seller_user_id?: string;
    event_date_from?: string;
    event_date_to?: string;
  }

  app.get<{ Querystring: ListQuery }>(
    '/api/v1/party-reservations',
    { schema: { tags: ['parties'], querystring: listQuerystring, response: { 200: responseSchema, ...commonErrors } } },
    async (request, reply) =>
      withPartyErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'party.read');
        const query = request.query;
        if (query.branch_id !== undefined) requireBranchAccess(authentication, auth, query.branch_id);
        const page = await service.listReservations(auth.companyId, auth.permittedBranchIds, {
          limit: query.limit ?? 50,
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(query.branch_id === undefined ? {} : { branchId: query.branch_id }),
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.room_id === undefined ? {} : { roomId: query.room_id }),
          ...(query.customer_id === undefined ? {} : { customerId: query.customer_id }),
          ...(query.seller_user_id === undefined ? {} : { sellerUserId: query.seller_user_id }),
          ...(query.event_date_from === undefined ? {} : { eventDateFrom: query.event_date_from }),
          ...(query.event_date_to === undefined ? {} : { eventDateTo: query.event_date_to }),
        });
        return reply.send({
          data: page.items.map(reservationHttp),
          meta: { ...responseMeta(request.requestContext), page: { next_cursor: page.nextCursor, has_more: page.nextCursor !== null } },
        });
      }),
  );

  app.get<{ Querystring: ListQuery & { from: string; to: string } }>(
    '/api/v1/party-reservations/calendar',
    {
      schema: {
        tags: ['parties'],
        querystring: {
          ...listQuerystring,
          required: ['from', 'to'],
          properties: { ...listQuerystring.properties, from: { type: 'string', format: 'date' }, to: { type: 'string', format: 'date' } },
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
        const page = await service.calendar(auth.companyId, auth.permittedBranchIds, {
          limit: query.limit ?? 500,
          eventDateFrom: query.from,
          eventDateTo: query.to,
          ...(query.branch_id === undefined ? {} : { branchId: query.branch_id }),
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.room_id === undefined ? {} : { roomId: query.room_id }),
          ...(query.seller_user_id === undefined ? {} : { sellerUserId: query.seller_user_id }),
        });
        return reply.send({
          data: page.items.map((item) => ({
            id: item.id,
            room_id: item.roomId,
            event_date: item.eventDate,
            start_time: item.startTime,
            end_time: item.endTime,
            status: item.status,
            celebrant_name: item.celebrantName,
            customer_display_name: item.customerDisplayName,
            seller_user_id: item.sellerUserId,
          })),
          meta: responseMeta(request.requestContext),
        });
      }),
  );

  // --- Room availability preview (TASK 16.22) -----------------------------------

  app.get<{
    Querystring: {
      branch_id: string;
      package_id: string;
      event_date: string;
      start_time: string;
      children?: number;
      adults?: number;
      extra_half_hours?: number;
      exclude_reservation_id?: string;
    };
  }>(
    '/api/v1/party-reservations/availability',
    {
      schema: {
        tags: ['parties'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          required: ['branch_id', 'package_id', 'event_date', 'start_time'],
          properties: {
            branch_id: { type: 'string', format: 'uuid' },
            package_id: { type: 'string', format: 'uuid' },
            event_date: { type: 'string', format: 'date' },
            start_time: { type: 'string' },
            children: { type: 'integer', minimum: 0 },
            adults: { type: 'integer', minimum: 0 },
            extra_half_hours: { type: 'integer', minimum: 0 },
            exclude_reservation_id: { type: 'string', format: 'uuid' },
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
        requireBranchAccess(authentication, auth, query.branch_id);
        const result = await service.availableRooms(
          { companyId: auth.companyId },
          auth.permittedBranchIds,
          {
            branchId: query.branch_id,
            packageId: query.package_id,
            eventDate: query.event_date,
            startTime: query.start_time,
            ...(query.children === undefined ? {} : { children: query.children }),
            ...(query.adults === undefined ? {} : { adults: query.adults }),
            ...(query.extra_half_hours === undefined ? {} : { extraHalfHours: query.extra_half_hours }),
            ...(query.exclude_reservation_id === undefined ? {} : { excludeReservationId: query.exclude_reservation_id }),
          },
        );
        return reply.send(
          successResponse(
            {
              event_date: result.eventDate,
              start_time: result.startTime,
              end_time: result.endTime,
              rooms: result.rooms.map((entry) => ({
                room_id: entry.room.id,
                code: entry.room.code,
                name: entry.room.name,
                capacity_children: entry.room.capacityChildren,
                capacity_adults: entry.room.capacityAdults,
                capacity_total: entry.room.capacityTotal,
                color: entry.room.color,
                available: entry.available,
                reason: entry.reason,
                conflicting_reservation_number: entry.conflictingReservationNumber,
              })),
            },
            request.requestContext,
          ),
        );
      }),
  );

  // --- Detail / edit -----------------------------------------------------------

  app.get<{ Params: Params }>(
    '/api/v1/party-reservations/:id',
    { schema: { tags: ['parties'], params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }, response: { 200: responseSchema, ...commonErrors } } },
    async (request, reply) =>
      withPartyErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'party.read');
        const value = await service.reservationDetail(auth.companyId, auth.permittedBranchIds, request.params.id);
        return reply
          .header('etag', `"${value.reservation.version.toString()}"`)
          .send(successResponse(detailHttp(value), request.requestContext));
      }),
  );

  app.patch<{
    Params: Params;
    Body: {
      customer_id?: string | null;
      celebrant_name?: string | null;
      celebrant_age?: number | null;
      room_id?: string;
      package_id?: string;
      event_date?: string;
      start_time?: string;
      end_time?: string;
      children_count?: number;
      adults_count?: number;
      extra_half_hours?: number;
      seller_user_id?: string | null;
      notes?: string | null;
    };
  }>(
    '/api/v1/party-reservations/:id',
    {
      schema: {
        tags: ['parties'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        headers: { type: 'object', properties: { 'if-match': { type: 'string' } } },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            customer_id: { type: ['string', 'null'], format: 'uuid' },
            celebrant_name: { type: ['string', 'null'], maxLength: 200 },
            celebrant_age: { type: ['integer', 'null'], minimum: 0 },
            room_id: { type: 'string', format: 'uuid' },
            package_id: { type: 'string', format: 'uuid' },
            event_date: { type: 'string', format: 'date' },
            start_time: { type: 'string' },
            end_time: { type: 'string' },
            children_count: { type: 'integer', minimum: 0 },
            adults_count: { type: 'integer', minimum: 0 },
            extra_half_hours: { type: 'integer', minimum: 0 },
            seller_user_id: { type: ['string', 'null'], format: 'uuid' },
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
        const updated = await service.updateReservation(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          request.params.id,
          expectedVersionFrom(request),
          request.body,
        );
        return reply.header('etag', `"${updated.version.toString()}"`).send(successResponse(reservationHttp(updated), request.requestContext));
      }),
  );

  // --- Status transition ---------------------------------------------------------

  app.post<{ Params: Params; Body: { status: PartyReservationStatus } }>(
    '/api/v1/party-reservations/:id/status',
    {
      schema: {
        tags: ['parties'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        headers: { ...idempotencyHeaders, properties: { ...idempotencyHeaders.properties, 'if-match': { type: 'string' } } },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['status'],
          properties: { status: { type: 'string', enum: ['held', 'pending_deposit', 'confirmed', 'completed'] } },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPartyErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'party.manage');
        const updated = await service.transitionStatus(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          request.params.id,
          expectedVersionFrom(request),
          request.body.status,
        );
        if (updated.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .header('etag', `"${updated.value.version.toString()}"`)
          .send(successResponse(reservationHttp(updated.value), request.requestContext));
      }),
  );

  // --- Cancel ----------------------------------------------------------------------

  app.post<{ Params: Params; Body: { reason_code: string } }>(
    '/api/v1/party-reservations/:id/cancellations',
    {
      schema: {
        tags: ['parties'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        headers: { ...idempotencyHeaders, properties: { ...idempotencyHeaders.properties, 'if-match': { type: 'string' } } },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['reason_code'],
          properties: { reason_code: { type: 'string', minLength: 1, maxLength: 200 } },
        },
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPartyErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'party.cancel');
        const result = await service.cancelReservation(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          request.params.id,
          expectedVersionFrom(request),
          { reasonCode: request.body.reason_code },
        );
        if (result.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .code(201)
          .header('etag', `"${result.value.reservation.version.toString()}"`)
          .send(
            successResponse(
              {
                ...reservationHttp(result.value.reservation),
                has_prior_payments: result.value.hasPriorPayments,
                total_paid: result.value.totalPaid,
              },
              request.requestContext,
            ),
          );
      }),
  );

  // --- Coupons (TASK 16.20 Part L1) --------------------------------------------------

  app.post<{ Params: Params; Body: { code: string } }>(
    '/api/v1/party-reservations/:id/coupon',
    {
      schema: {
        tags: ['parties'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['code'],
          properties: { code: { type: 'string', minLength: 1, maxLength: 64 } },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPartyErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'party.manage');
        const updated = await service.applyCoupon(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          request.params.id,
          { code: request.body.code },
        );
        return reply.header('etag', `"${updated.version.toString()}"`).send(successResponse(reservationHttp(updated), request.requestContext));
      }),
  );

  app.delete<{ Params: Params }>(
    '/api/v1/party-reservations/:id/coupon',
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
        requirePermission(authentication, auth, 'party.manage');
        const updated = await service.removeCoupon(mutationContext(request, auth.companyId, auth.userId), auth.permittedBranchIds, request.params.id);
        return reply.header('etag', `"${updated.version.toString()}"`).send(successResponse(reservationHttp(updated), request.requestContext));
      }),
  );

  // --- Snacks ------------------------------------------------------------------------

  app.post<{ Params: Params; Body: { product_id?: string; name_snapshot?: string; unit_price_snapshot?: string; quantity: string } }>(
    '/api/v1/party-reservations/:id/snacks',
    {
      schema: {
        tags: ['parties'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['quantity'],
          properties: {
            product_id: { type: 'string', format: 'uuid' },
            name_snapshot: { type: 'string', minLength: 1, maxLength: 200 },
            unit_price_snapshot: { type: 'string', pattern: moneyPattern },
            quantity: { type: 'string', pattern: '^(?:0|[1-9]\\d*)(?:\\.\\d{1,6})?$' },
          },
        },
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPartyErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'party.manage');
        const body = request.body;
        const created = await service.addSnack(mutationContext(request, auth.companyId, auth.userId), auth.permittedBranchIds, request.params.id, {
          ...(body.product_id === undefined ? {} : { productId: body.product_id }),
          ...(body.name_snapshot === undefined ? {} : { nameSnapshot: body.name_snapshot }),
          ...(body.unit_price_snapshot === undefined ? {} : { unitPriceSnapshot: body.unit_price_snapshot }),
          quantity: body.quantity,
        });
        return reply.code(201).send(successResponse(snackHttp(created), request.requestContext));
      }),
  );

  app.get<{ Params: Params }>(
    '/api/v1/party-reservations/:id/snacks',
    { schema: { tags: ['parties'], params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }, response: { 200: responseSchema, ...commonErrors } } },
    async (request, reply) =>
      withPartyErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'party.read');
        const items = await service.listSnacks(auth.companyId, auth.permittedBranchIds, request.params.id);
        return reply.send({ data: items.map(snackHttp), meta: responseMeta(request.requestContext) });
      }),
  );

  // --- Socks -------------------------------------------------------------------------

  app.post<{ Params: Params; Body: { size: string; quantity: number; product_variant_id?: string } }>(
    '/api/v1/party-reservations/:id/socks',
    {
      schema: {
        tags: ['parties'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['size', 'quantity'],
          properties: {
            size: { type: 'string', minLength: 1, maxLength: 20 },
            quantity: { type: 'integer', minimum: 1 },
            product_variant_id: { type: 'string', format: 'uuid' },
          },
        },
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPartyErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'party.manage');
        const body = request.body;
        const created = await service.addSock(mutationContext(request, auth.companyId, auth.userId), auth.permittedBranchIds, request.params.id, {
          size: body.size,
          quantity: body.quantity,
          ...(body.product_variant_id === undefined ? {} : { productVariantId: body.product_variant_id }),
        });
        return reply.code(201).send(successResponse(sockHttp(created), request.requestContext));
      }),
  );

  app.get<{ Params: Params }>(
    '/api/v1/party-reservations/:id/socks',
    { schema: { tags: ['parties'], params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }, response: { 200: responseSchema, ...commonErrors } } },
    async (request, reply) =>
      withPartyErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'party.read');
        const items = await service.listSocks(auth.companyId, auth.permittedBranchIds, request.params.id);
        return reply.send({ data: items.map(sockHttp), meta: responseMeta(request.requestContext) });
      }),
  );

  app.post<{ Params: SockParams; Body: { issued_quantity?: number } }>(
    '/api/v1/party-reservations/:id/socks/:sockId/deduct',
    {
      schema: {
        tags: ['parties'],
        params: { type: 'object', required: ['id', 'sockId'], properties: { id: { type: 'string' }, sockId: { type: 'string' } } },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            // TASK 16.20 (Part D4) — the ACTUAL amount an operator is
            // issuing, independently of the row's own planned `quantity`
            // (e.g. a package included 25 but only 23 attended). Omit to
            // issue exactly the planned quantity (pre-16.20 behavior).
            issued_quantity: { type: 'integer', minimum: 1 },
          },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPartyErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'party.manage');
        const updated = await service.deductSock(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          request.params.id,
          request.params.sockId,
          request.body.issued_quantity === undefined ? undefined : { issuedQuantity: request.body.issued_quantity },
        );
        return reply.send(successResponse(sockHttp(updated), request.requestContext));
      }),
  );

  app.post<{ Params: SnackParams; Body: { issued_quantity?: string } }>(
    '/api/v1/party-reservations/:id/snacks/:snackId/deduct',
    {
      schema: {
        tags: ['parties'],
        params: { type: 'object', required: ['id', 'snackId'], properties: { id: { type: 'string' }, snackId: { type: 'string' } } },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            issued_quantity: { type: 'string', pattern: '^(?:0|[1-9]\\d*)(?:\\.\\d{1,6})?$' },
          },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPartyErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'party.manage');
        const updated = await service.deductSnack(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          request.params.id,
          request.params.snackId,
          request.body.issued_quantity === undefined ? undefined : { issuedQuantity: request.body.issued_quantity },
        );
        return reply.send(successResponse(snackHttp(updated), request.requestContext));
      }),
  );

  // TASK 16.20A (Parts 7-17) — a real, party-specific, safe correction
  // action for an already-issued line. Reuses `party.manage` (the same
  // permission that already gates every other party mutation, including
  // the original `deduct` action itself) — a correction is fundamentally
  // a party-domain action with an inventory side effect, exactly like
  // `deduct` already is; no new permission was genuinely needed (Part 14).
  app.post<{ Params: SockParams; Body: { corrected_quantity: number } }>(
    '/api/v1/party-reservations/:id/socks/:sockId/correct',
    {
      schema: {
        tags: ['parties'],
        params: { type: 'object', required: ['id', 'sockId'], properties: { id: { type: 'string' }, sockId: { type: 'string' } } },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['corrected_quantity'],
          properties: { corrected_quantity: { type: 'integer', minimum: 1 } },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPartyErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'party.manage');
        const updated = await service.correctSock(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          request.params.id,
          request.params.sockId,
          { correctedQuantity: request.body.corrected_quantity },
        );
        return reply.send(successResponse(sockHttp(updated), request.requestContext));
      }),
  );

  app.post<{ Params: SnackParams; Body: { corrected_quantity: string } }>(
    '/api/v1/party-reservations/:id/snacks/:snackId/correct',
    {
      schema: {
        tags: ['parties'],
        params: { type: 'object', required: ['id', 'snackId'], properties: { id: { type: 'string' }, snackId: { type: 'string' } } },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['corrected_quantity'],
          properties: { corrected_quantity: { type: 'string', pattern: '^(?:0|[1-9]\\d*)(?:\\.\\d{1,6})?$' } },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPartyErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'party.manage');
        const updated = await service.correctSnack(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          request.params.id,
          request.params.snackId,
          { correctedQuantity: request.body.corrected_quantity },
        );
        return reply.send(successResponse(snackHttp(updated), request.requestContext));
      }),
  );

  // --- Payments / balance --------------------------------------------------------------

  app.post<{ Params: Params; Body: { purpose: PartyReservationPaymentPurpose; amount: string; cash_session_id: string } }>(
    '/api/v1/party-reservations/:id/payments',
    {
      schema: {
        tags: ['parties'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        headers: idempotencyHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['purpose', 'amount', 'cash_session_id'],
          properties: {
            purpose: { type: 'string', enum: ['deposit', 'balance', 'additional'] },
            amount: { type: 'string', pattern: moneyPattern },
            cash_session_id: { type: 'string', format: 'uuid' },
          },
        },
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPartyErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'party.payment.record');
        const body = request.body;
        const created = await service.recordPayment(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          request.params.id,
          { purpose: body.purpose, amount: body.amount, cashSessionId: body.cash_session_id },
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        return reply.code(201).send(successResponse(paymentHttp(created.value), request.requestContext));
      }),
  );

  app.get<{ Params: Params }>(
    '/api/v1/party-reservations/:id/balance',
    { schema: { tags: ['parties'], params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }, response: { 200: responseSchema, ...commonErrors } } },
    async (request, reply) =>
      withPartyErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'party.read');
        const value = await service.balance(auth.companyId, auth.permittedBranchIds, request.params.id);
        return reply.send(
          successResponse(
            {
              subtotal_amount: value.subtotalAmount,
              discount_total: value.discountTotal,
              tax_total: value.taxTotal,
              quoted_total: value.quotedTotal,
              total_paid: value.totalPaid,
              outstanding_balance: value.outstandingBalance,
            },
            request.requestContext,
          ),
        );
      }),
  );

  // --- Documents -----------------------------------------------------------------------

  app.get<{ Params: Params & { type: 'waiver' | 'contract' } }>(
    '/api/v1/party-reservations/:id/documents/:type',
    {
      schema: {
        tags: ['parties'],
        params: {
          type: 'object',
          required: ['id', 'type'],
          properties: { id: { type: 'string' }, type: { type: 'string', enum: ['waiver', 'contract'] } },
        },
        response: { 200: { type: 'string' }, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPartyErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'party.read');
        const { html } = await service.generateDocument(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          request.params.id,
          request.params.type,
        );
        return reply.type('text/html; charset=utf-8').send(html);
      }),
  );
}
