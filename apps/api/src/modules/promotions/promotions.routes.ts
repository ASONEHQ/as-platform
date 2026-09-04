import type { FastifyInstance, FastifyRequest } from 'fastify';

import { responseMeta, successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requireBranchAccess, requirePermission } from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import { idempotencyKey } from '../catalog/catalog.schemas.js';
import { formatMoney } from './pricing.service.js';
import { withPromotionErrors } from './promotions.http-errors.js';
import type { PromotionsService } from './promotions.service.js';
import type { CouponRow, PromotionMutationContext, PromotionRow } from './promotions.types.js';

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
const ifMatchHeader = { type: 'object', properties: { 'if-match': { type: 'string' } } } as const;

function mutationContext(request: FastifyRequest, companyId: string, actorId: string, actorPermissions: readonly string[]): PromotionMutationContext {
  return {
    companyId,
    actorId,
    actorPermissions,
    requestId: request.requestContext.requestId,
    correlationId: request.requestContext.correlationId,
    timestamp: new Date(),
  };
}
function expectedVersionFrom(request: FastifyRequest): bigint {
  const ifMatch = request.headers['if-match'];
  return BigInt(typeof ifMatch === 'string' ? ifMatch.replaceAll('"', '') : '0');
}

function promotionHttp(value: PromotionRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    name: value.name,
    description: value.description,
    active: value.active,
    starts_at: value.startsAt?.toISOString() ?? null,
    ends_at: value.endsAt?.toISOString() ?? null,
    days_of_week: value.daysOfWeek,
    time_from: value.timeFrom,
    time_to: value.timeTo,
    priority: value.priority,
    stackable: value.stackable,
    benefit_type: value.benefitType,
    benefit_percentage_basis_points: value.benefitPercentageBasisPoints,
    benefit_fixed_amount: value.benefitFixedAmount,
    benefit_nxm_buy_quantity: value.benefitNxmBuyQuantity,
    benefit_nxm_pay_quantity: value.benefitNxmPayQuantity,
    min_quantity: value.minQuantity,
    min_subtotal: value.minSubtotal,
    usage_limit_total: value.usageLimitTotal,
    combinable_with_coupons: value.combinableWithCoupons,
    branch_ids: value.branchIds,
    product_ids: value.productIds,
    category_ids: value.categoryIds,
    created_by: value.createdBy,
    updated_by: value.updatedBy,
    version: Number(value.version),
    created_at: value.createdAt.toISOString(),
    updated_at: value.updatedAt.toISOString(),
  };
}
function couponHttp(value: CouponRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    code: value.code,
    description: value.description,
    benefit_type: value.benefitType,
    benefit_percentage_basis_points: value.benefitPercentageBasisPoints,
    benefit_fixed_amount: value.benefitFixedAmount,
    active: value.active,
    starts_at: value.startsAt?.toISOString() ?? null,
    ends_at: value.endsAt?.toISOString() ?? null,
    min_subtotal: value.minSubtotal,
    usage_limit_total: value.usageLimitTotal,
    promotion_id: value.promotionId,
    created_by: value.createdBy,
    updated_by: value.updatedBy,
    version: Number(value.version),
    created_at: value.createdAt.toISOString(),
    updated_at: value.updatedAt.toISOString(),
  };
}

const promotionBenefitSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'benefit_type'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string', minLength: 1, maxLength: 200 },
    description: { type: 'string', maxLength: 500 },
    active: { type: 'boolean' },
    starts_at: { type: 'string', format: 'date-time' },
    ends_at: { type: 'string', format: 'date-time' },
    days_of_week: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 7 }, maxItems: 7 },
    time_from: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
    time_to: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
    priority: { type: 'integer', minimum: 0 },
    stackable: { type: 'boolean' },
    benefit_type: { type: 'string', enum: ['percentage', 'fixed_amount', 'fixed_price', 'quantity_nxm'] },
    benefit_percentage_basis_points: { type: 'integer', minimum: 1, maximum: 10_000 },
    benefit_fixed_amount: { type: 'string', pattern: '^\\d+(\\.\\d{1,4})?$' },
    benefit_nxm_buy_quantity: { type: 'integer', minimum: 1 },
    benefit_nxm_pay_quantity: { type: 'integer', minimum: 1 },
    min_quantity: { type: 'string', pattern: '^\\d+(\\.\\d{1,6})?$' },
    min_subtotal: { type: 'string', pattern: '^\\d+(\\.\\d{1,4})?$' },
    usage_limit_total: { type: 'integer', minimum: 1 },
    combinable_with_coupons: { type: 'boolean' },
    branch_ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
    product_ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
    category_ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
  },
} as const;

export function registerPromotionRoutes(app: FastifyInstance, authentication: AuthService, service: PromotionsService): void {
  // Promotions admin management (Part U).
  app.post<{ Body: Record<string, unknown> }>(
    '/api/v1/promotions',
    { schema: { tags: ['promotions'], headers: idempotencyHeaders, body: promotionBenefitSchema, response: { 201: responseSchema, ...commonErrors } } },
    async (request, reply) =>
      withPromotionErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'promotion.manage');
        const body = request.body as {
          id?: string;
          name: string;
          description?: string;
          active?: boolean;
          starts_at?: string;
          ends_at?: string;
          days_of_week?: number[];
          time_from?: string;
          time_to?: string;
          priority?: number;
          stackable?: boolean;
          benefit_type: PromotionRow['benefitType'];
          benefit_percentage_basis_points?: number;
          benefit_fixed_amount?: string;
          benefit_nxm_buy_quantity?: number;
          benefit_nxm_pay_quantity?: number;
          min_quantity?: string;
          min_subtotal?: string;
          usage_limit_total?: number;
          combinable_with_coupons?: boolean;
          branch_ids?: string[];
          product_ids?: string[];
          category_ids?: string[];
        };
        const created = await service.createPromotion(
          mutationContext(request, auth.companyId, auth.userId, auth.permissions),
          idempotencyKey(request.headers['idempotency-key']),
          {
            ...(body.id === undefined ? {} : { id: body.id }),
            name: body.name,
            ...(body.description === undefined ? {} : { description: body.description }),
            ...(body.active === undefined ? {} : { active: body.active }),
            ...(body.starts_at === undefined ? {} : { startsAt: new Date(body.starts_at) }),
            ...(body.ends_at === undefined ? {} : { endsAt: new Date(body.ends_at) }),
            ...(body.days_of_week === undefined ? {} : { daysOfWeek: body.days_of_week }),
            ...(body.time_from === undefined ? {} : { timeFrom: body.time_from }),
            ...(body.time_to === undefined ? {} : { timeTo: body.time_to }),
            ...(body.priority === undefined ? {} : { priority: body.priority }),
            ...(body.stackable === undefined ? {} : { stackable: body.stackable }),
            benefitType: body.benefit_type,
            ...(body.benefit_percentage_basis_points === undefined
              ? {}
              : { benefitPercentageBasisPoints: body.benefit_percentage_basis_points }),
            ...(body.benefit_fixed_amount === undefined ? {} : { benefitFixedAmount: body.benefit_fixed_amount }),
            ...(body.benefit_nxm_buy_quantity === undefined ? {} : { benefitNxmBuyQuantity: body.benefit_nxm_buy_quantity }),
            ...(body.benefit_nxm_pay_quantity === undefined ? {} : { benefitNxmPayQuantity: body.benefit_nxm_pay_quantity }),
            ...(body.min_quantity === undefined ? {} : { minQuantity: body.min_quantity }),
            ...(body.min_subtotal === undefined ? {} : { minSubtotal: body.min_subtotal }),
            ...(body.usage_limit_total === undefined ? {} : { usageLimitTotal: body.usage_limit_total }),
            ...(body.combinable_with_coupons === undefined ? {} : { combinableWithCoupons: body.combinable_with_coupons }),
            ...(body.branch_ids === undefined ? {} : { branchIds: body.branch_ids }),
            ...(body.product_ids === undefined ? {} : { productIds: body.product_ids }),
            ...(body.category_ids === undefined ? {} : { categoryIds: body.category_ids }),
          },
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .code(201)
          .header('etag', `"${created.value.version.toString()}"`)
          .send(successResponse(promotionHttp(created.value), request.requestContext));
      }),
  );

  app.get<{ Querystring: { cursor?: string; limit?: number; active?: boolean } }>(
    '/api/v1/promotions',
    {
      schema: {
        tags: ['promotions'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 }, active: { type: 'boolean' } },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPromotionErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'promotion.read');
        const query = request.query;
        const page = await service.listPromotions(auth.companyId, {
          limit: query.limit ?? 50,
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(query.active === undefined ? {} : { active: query.active }),
        });
        return reply.send({
          data: page.items.map(promotionHttp),
          meta: { ...responseMeta(request.requestContext), page: { next_cursor: page.nextCursor, has_more: page.nextCursor !== null } },
        });
      }),
  );

  app.get<{ Params: Params }>(
    '/api/v1/promotions/:id',
    { schema: { tags: ['promotions'], params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }, response: { 200: responseSchema, ...commonErrors } } },
    async (request, reply) =>
      withPromotionErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'promotion.read');
        const value = await service.promotion(auth.companyId, request.params.id);
        return reply.header('etag', `"${value.version.toString()}"`).send(successResponse(promotionHttp(value), request.requestContext));
      }),
  );

  app.put<{ Params: Params; Body: Record<string, unknown> }>(
    '/api/v1/promotions/:id',
    {
      schema: {
        tags: ['promotions'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        headers: ifMatchHeader,
        body: { ...promotionBenefitSchema, required: [] },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPromotionErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'promotion.manage');
        const body = request.body as Partial<{
          name: string;
          description: string;
          active: boolean;
          starts_at: string;
          ends_at: string;
          days_of_week: number[];
          time_from: string;
          time_to: string;
          priority: number;
          stackable: boolean;
          benefit_type: PromotionRow['benefitType'];
          benefit_percentage_basis_points: number;
          benefit_fixed_amount: string;
          benefit_nxm_buy_quantity: number;
          benefit_nxm_pay_quantity: number;
          min_quantity: string;
          min_subtotal: string;
          usage_limit_total: number;
          combinable_with_coupons: boolean;
          branch_ids: string[];
          product_ids: string[];
          category_ids: string[];
        }>;
        const updated = await service.updatePromotion(
          mutationContext(request, auth.companyId, auth.userId, auth.permissions),
          request.params.id,
          expectedVersionFrom(request),
          {
            ...(body.name === undefined ? {} : { name: body.name }),
            ...(body.description === undefined ? {} : { description: body.description }),
            ...(body.active === undefined ? {} : { active: body.active }),
            ...(body.starts_at === undefined ? {} : { startsAt: new Date(body.starts_at) }),
            ...(body.ends_at === undefined ? {} : { endsAt: new Date(body.ends_at) }),
            ...(body.days_of_week === undefined ? {} : { daysOfWeek: body.days_of_week }),
            ...(body.time_from === undefined ? {} : { timeFrom: body.time_from }),
            ...(body.time_to === undefined ? {} : { timeTo: body.time_to }),
            ...(body.priority === undefined ? {} : { priority: body.priority }),
            ...(body.stackable === undefined ? {} : { stackable: body.stackable }),
            ...(body.benefit_type === undefined ? {} : { benefitType: body.benefit_type }),
            ...(body.benefit_percentage_basis_points === undefined
              ? {}
              : { benefitPercentageBasisPoints: body.benefit_percentage_basis_points }),
            ...(body.benefit_fixed_amount === undefined ? {} : { benefitFixedAmount: body.benefit_fixed_amount }),
            ...(body.benefit_nxm_buy_quantity === undefined ? {} : { benefitNxmBuyQuantity: body.benefit_nxm_buy_quantity }),
            ...(body.benefit_nxm_pay_quantity === undefined ? {} : { benefitNxmPayQuantity: body.benefit_nxm_pay_quantity }),
            ...(body.min_quantity === undefined ? {} : { minQuantity: body.min_quantity }),
            ...(body.min_subtotal === undefined ? {} : { minSubtotal: body.min_subtotal }),
            ...(body.usage_limit_total === undefined ? {} : { usageLimitTotal: body.usage_limit_total }),
            ...(body.combinable_with_coupons === undefined ? {} : { combinableWithCoupons: body.combinable_with_coupons }),
            ...(body.branch_ids === undefined ? {} : { branchIds: body.branch_ids }),
            ...(body.product_ids === undefined ? {} : { productIds: body.product_ids }),
            ...(body.category_ids === undefined ? {} : { categoryIds: body.category_ids }),
          },
        );
        return reply.header('etag', `"${updated.version.toString()}"`).send(successResponse(promotionHttp(updated), request.requestContext));
      }),
  );

  // Coupons admin management.
  app.post<{
    Body: {
      id?: string;
      code: string;
      description?: string;
      benefit_type: CouponRow['benefitType'];
      benefit_percentage_basis_points?: number;
      benefit_fixed_amount?: string;
      active?: boolean;
      starts_at?: string;
      ends_at?: string;
      min_subtotal?: string;
      usage_limit_total?: number;
      promotion_id?: string;
    };
  }>(
    '/api/v1/coupons',
    {
      schema: {
        tags: ['promotions'],
        headers: idempotencyHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['code', 'benefit_type'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            code: { type: 'string', minLength: 1, maxLength: 40 },
            description: { type: 'string', maxLength: 500 },
            benefit_type: { type: 'string', enum: ['percentage', 'fixed_amount'] },
            benefit_percentage_basis_points: { type: 'integer', minimum: 1, maximum: 10_000 },
            benefit_fixed_amount: { type: 'string', pattern: '^\\d+(\\.\\d{1,4})?$' },
            active: { type: 'boolean' },
            starts_at: { type: 'string', format: 'date-time' },
            ends_at: { type: 'string', format: 'date-time' },
            min_subtotal: { type: 'string', pattern: '^\\d+(\\.\\d{1,4})?$' },
            usage_limit_total: { type: 'integer', minimum: 1 },
            promotion_id: { type: 'string', format: 'uuid' },
          },
        },
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPromotionErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'coupon.manage');
        const body = request.body;
        const created = await service.createCoupon(
          mutationContext(request, auth.companyId, auth.userId, auth.permissions),
          idempotencyKey(request.headers['idempotency-key']),
          {
            ...(body.id === undefined ? {} : { id: body.id }),
            code: body.code,
            ...(body.description === undefined ? {} : { description: body.description }),
            benefitType: body.benefit_type,
            ...(body.benefit_percentage_basis_points === undefined
              ? {}
              : { benefitPercentageBasisPoints: body.benefit_percentage_basis_points }),
            ...(body.benefit_fixed_amount === undefined ? {} : { benefitFixedAmount: body.benefit_fixed_amount }),
            ...(body.active === undefined ? {} : { active: body.active }),
            ...(body.starts_at === undefined ? {} : { startsAt: new Date(body.starts_at) }),
            ...(body.ends_at === undefined ? {} : { endsAt: new Date(body.ends_at) }),
            ...(body.min_subtotal === undefined ? {} : { minSubtotal: body.min_subtotal }),
            ...(body.usage_limit_total === undefined ? {} : { usageLimitTotal: body.usage_limit_total }),
            ...(body.promotion_id === undefined ? {} : { promotionId: body.promotion_id }),
          },
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .code(201)
          .header('etag', `"${created.value.version.toString()}"`)
          .send(successResponse(couponHttp(created.value), request.requestContext));
      }),
  );

  app.get<{ Querystring: { cursor?: string; limit?: number; active?: boolean } }>(
    '/api/v1/coupons',
    {
      schema: {
        tags: ['promotions'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 }, active: { type: 'boolean' } },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPromotionErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'coupon.read');
        const query = request.query;
        const page = await service.listCoupons(auth.companyId, {
          limit: query.limit ?? 50,
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(query.active === undefined ? {} : { active: query.active }),
        });
        return reply.send({
          data: page.items.map(couponHttp),
          meta: { ...responseMeta(request.requestContext), page: { next_cursor: page.nextCursor, has_more: page.nextCursor !== null } },
        });
      }),
  );

  app.get<{ Params: Params }>(
    '/api/v1/coupons/:id',
    { schema: { tags: ['promotions'], params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }, response: { 200: responseSchema, ...commonErrors } } },
    async (request, reply) =>
      withPromotionErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'coupon.read');
        const value = await service.coupon(auth.companyId, request.params.id);
        return reply.header('etag', `"${value.version.toString()}"`).send(successResponse(couponHttp(value), request.requestContext));
      }),
  );

  app.put<{
    Params: Params;
    Body: {
      description?: string;
      active?: boolean;
      starts_at?: string | null;
      ends_at?: string | null;
      min_subtotal?: string | null;
      usage_limit_total?: number | null;
    };
  }>(
    '/api/v1/coupons/:id',
    {
      schema: {
        tags: ['promotions'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        headers: ifMatchHeader,
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            description: { type: 'string', maxLength: 500 },
            active: { type: 'boolean' },
            starts_at: { type: ['string', 'null'], format: 'date-time' },
            ends_at: { type: ['string', 'null'], format: 'date-time' },
            min_subtotal: { type: ['string', 'null'], pattern: '^\\d+(\\.\\d{1,4})?$' },
            usage_limit_total: { type: ['integer', 'null'], minimum: 1 },
          },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPromotionErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'coupon.manage');
        const body = request.body;
        const updated = await service.updateCoupon(
          mutationContext(request, auth.companyId, auth.userId, auth.permissions),
          request.params.id,
          expectedVersionFrom(request),
          {
            ...(body.description === undefined ? {} : { description: body.description }),
            ...(body.active === undefined ? {} : { active: body.active }),
            ...(body.starts_at === undefined ? {} : { startsAt: body.starts_at === null ? null : new Date(body.starts_at) }),
            ...(body.ends_at === undefined ? {} : { endsAt: body.ends_at === null ? null : new Date(body.ends_at) }),
            ...(body.min_subtotal === undefined ? {} : { minSubtotal: body.min_subtotal }),
            ...(body.usage_limit_total === undefined ? {} : { usageLimitTotal: body.usage_limit_total }),
          },
        );
        return reply.header('etag', `"${updated.version.toString()}"`).send(successResponse(couponHttp(updated), request.requestContext));
      }),
  );

  // Pricing quote/preview — never creates a Sale, never consumes a
  // coupon redemption (Part B). Gated by `sale.create`: this IS the
  // pricing step of building a sale, not a separate admin capability —
  // every actor who can start a checkout already needs to see it.
  app.post<{
    Body: {
      branch_id: string;
      items: { product_id: string; quantity: string }[];
      coupon_codes?: string[];
      manual_discount?: {
        scope: 'line' | 'ticket';
        line_index?: number;
        type: 'percentage' | 'fixed_amount';
        value: string;
        reason_code: string;
      };
    };
  }>(
    '/api/v1/sales/pricing-quotes',
    {
      schema: {
        tags: ['promotions'],
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['branch_id', 'items'],
          properties: {
            branch_id: { type: 'string', format: 'uuid' },
            items: {
              type: 'array',
              minItems: 1,
              maxItems: 200,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['product_id', 'quantity'],
                properties: {
                  product_id: { type: 'string', format: 'uuid' },
                  quantity: { type: 'string', pattern: '^(?:0|[1-9]\\d*)(?:\\.\\d{1,6})?$' },
                },
              },
            },
            coupon_codes: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 40 }, maxItems: 5 },
            manual_discount: {
              type: 'object',
              additionalProperties: false,
              required: ['scope', 'type', 'value', 'reason_code'],
              properties: {
                scope: { type: 'string', enum: ['line', 'ticket'] },
                line_index: { type: 'integer', minimum: 0 },
                type: { type: 'string', enum: ['percentage', 'fixed_amount'] },
                value: { type: 'string', minLength: 1, maxLength: 20 },
                reason_code: { type: 'string', minLength: 1, maxLength: 200 },
              },
            },
          },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPromotionErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'sale.create');
        requireBranchAccess(authentication, auth, request.body.branch_id);
        if (request.body.manual_discount !== undefined) requirePermission(authentication, auth, 'discount.apply');
        const manual = request.body.manual_discount;
        const result = await service.quote(
          mutationContext(request, auth.companyId, auth.userId, auth.permissions),
          auth.permittedBranchIds,
          {
            branchId: request.body.branch_id,
            items: request.body.items.map((item) => ({ productId: item.product_id, quantity: item.quantity })),
            couponCodes: request.body.coupon_codes ?? [],
            ...(manual === undefined
              ? {}
              : {
                  manualDiscount: {
                    scope: manual.scope,
                    ...(manual.line_index === undefined ? {} : { lineIndex: manual.line_index }),
                    type: manual.type,
                    value: manual.value,
                    reasonCode: manual.reason_code,
                  },
                }),
          },
        );
        return reply.send(
          successResponse(
            {
              currency_code: result.currencyCode,
              subtotal: formatMoney(result.subtotalUnits),
              discount_total: formatMoney(result.discountTotalUnits),
              tax_total: formatMoney(result.taxTotalUnits),
              total: formatMoney(result.totalUnits),
              lines: result.lines.map((line) => ({
                line_index: line.lineIndex,
                product_id: line.productId,
                name_snapshot: line.nameSnapshot,
                quantity: line.quantity,
                unit_price: formatMoney(line.unitPriceUnits),
                subtotal: formatMoney(line.grossSubtotalUnits),
                discount_total: formatMoney(line.discountUnits),
                tax_total: formatMoney(line.taxUnits),
                line_total: formatMoney(line.lineTotalUnits),
              })),
              applied_discounts: result.appliedDiscounts.map((entry) => ({
                source_type: entry.sourceType,
                source_id: entry.sourceId,
                label: entry.label,
                reason_code: entry.reasonCode,
                amount: formatMoney(entry.amountUnits),
                line_index: entry.lineIndex,
              })),
              rejected_coupons: result.rejectedCoupons,
            },
            request.requestContext,
          ),
        );
      }),
  );
}

