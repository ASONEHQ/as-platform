import type { FastifyInstance, FastifyRequest } from 'fastify';

import { successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requirePermission } from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import { idempotencyKey } from '../catalog/catalog.schemas.js';
import { withMembershipErrors } from './memberships.http-errors.js';
import type { MembershipsService } from './memberships.service.js';
import type { CustomerMembershipRow, MembershipMutationContext, MembershipPlanRow } from './memberships.types.js';

interface PlanParams {
  id: string;
}
interface CustomerParams {
  customerId: string;
}
interface MembershipParams {
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
const ifMatchHeader = {
  type: 'object',
  required: ['if-match'],
  properties: { 'if-match': { type: 'string' } },
} as const;

function mutationContext(request: FastifyRequest, companyId: string, actorId: string, actorPermissions: readonly string[]): MembershipMutationContext {
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

function planHttp(value: MembershipPlanRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    name: value.name,
    description: value.description,
    active: value.active,
    product_id: value.productId,
    duration_days: value.durationDays,
    benefit_description: value.benefitDescription,
    // TASK 16.21 (ADR-0020) — the structured, pricing-engine-enforced
    // benefit; see `membership_plans`' own schema doc comment for why
    // this is independent of `benefit_description` above.
    benefit_type: value.benefitType,
    benefit_percentage_basis_points: value.benefitPercentageBasisPoints,
    benefit_fixed_amount: value.benefitFixedAmount,
    benefit_product_ids: value.benefitProductIds,
    benefit_category_ids: value.benefitCategoryIds,
    branch_ids: value.branchIds,
    version: Number(value.version),
    created_at: value.createdAt.toISOString(),
    updated_at: value.updatedAt.toISOString(),
  };
}
function membershipHttp(value: CustomerMembershipRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    customer_id: value.customerId,
    membership_plan_id: value.membershipPlanId,
    membership_number: value.membershipNumber,
    status: value.status,
    starts_at: value.startsAt.toISOString(),
    expires_at: value.expiresAt?.toISOString() ?? null,
    issued_at: value.issuedAt.toISOString(),
    source_sale_id: value.sourceSaleId,
    renewed_from_membership_id: value.renewedFromMembershipId,
    cancelled_at: value.cancelledAt?.toISOString() ?? null,
    version: Number(value.version),
  };
}

const planSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string', minLength: 1, maxLength: 200 },
    description: { type: 'string', maxLength: 1000 },
    active: { type: 'boolean' },
    product_id: { type: 'string', format: 'uuid' },
    duration_days: { type: 'integer', minimum: 1 },
    benefit_description: { type: 'string', maxLength: 1000 },
    // TASK 16.21 (ADR-0020) — mirrors `promotions.routes.ts`'s own
    // `benefit_type`/`benefit_percentage_basis_points`/
    // `benefit_fixed_amount` schema shape exactly (never
    // `free_eligible_item`, see `MembershipBenefitType`'s own doc).
    benefit_type: { type: 'string', enum: ['percentage_discount', 'fixed_amount_discount', 'fixed_price'] },
    benefit_percentage_basis_points: { type: 'integer', minimum: 1, maximum: 10_000 },
    benefit_fixed_amount: { type: 'string', pattern: '^\\d+(\\.\\d{1,4})?$' },
    benefit_product_ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
    benefit_category_ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
    branch_ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
  },
} as const;

export function registerMembershipRoutes(app: FastifyInstance, authentication: AuthService, service: MembershipsService): void {
  app.post<{ Body: Record<string, unknown> }>(
    '/api/v1/membership-plans',
    { schema: { tags: ['memberships'], headers: idempotencyHeaders, body: planSchema, response: { 201: responseSchema, ...commonErrors } } },
    async (request, reply) =>
      withMembershipErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'membership.manage');
        const body = request.body as {
          id?: string;
          name: string;
          description?: string;
          active?: boolean;
          product_id?: string;
          duration_days?: number;
          benefit_description?: string;
          benefit_type?: 'percentage_discount' | 'fixed_amount_discount' | 'fixed_price';
          benefit_percentage_basis_points?: number;
          benefit_fixed_amount?: string;
          benefit_product_ids?: string[];
          benefit_category_ids?: string[];
          branch_ids?: string[];
        };
        const created = await service.createPlan(
          mutationContext(request, auth.companyId, auth.userId, auth.permissions),
          idempotencyKey(request.headers['idempotency-key']),
          {
            ...(body.id === undefined ? {} : { id: body.id }),
            name: body.name,
            ...(body.description === undefined ? {} : { description: body.description }),
            ...(body.active === undefined ? {} : { active: body.active }),
            ...(body.product_id === undefined ? {} : { productId: body.product_id }),
            ...(body.duration_days === undefined ? {} : { durationDays: body.duration_days }),
            ...(body.benefit_description === undefined ? {} : { benefitDescription: body.benefit_description }),
            ...(body.benefit_type === undefined ? {} : { benefitType: body.benefit_type }),
            ...(body.benefit_percentage_basis_points === undefined
              ? {}
              : { benefitPercentageBasisPoints: body.benefit_percentage_basis_points }),
            ...(body.benefit_fixed_amount === undefined ? {} : { benefitFixedAmount: body.benefit_fixed_amount }),
            ...(body.benefit_product_ids === undefined ? {} : { benefitProductIds: body.benefit_product_ids }),
            ...(body.benefit_category_ids === undefined ? {} : { benefitCategoryIds: body.benefit_category_ids }),
            ...(body.branch_ids === undefined ? {} : { branchIds: body.branch_ids }),
          },
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .code(201)
          .header('etag', `"${created.value.version.toString()}"`)
          .send(successResponse(planHttp(created.value), request.requestContext));
      }),
  );

  app.get<{ Querystring: { active?: boolean } }>(
    '/api/v1/membership-plans',
    {
      schema: {
        tags: ['memberships'],
        querystring: { type: 'object', additionalProperties: false, properties: { active: { type: 'boolean' } } },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withMembershipErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'membership.read');
        const rows = await service.listPlans(
          { companyId: auth.companyId, actorPermissions: auth.permissions },
          request.query.active ?? null,
        );
        return reply.send(successResponse(rows.map(planHttp), request.requestContext));
      }),
  );

  app.get<{ Params: PlanParams }>(
    '/api/v1/membership-plans/:id',
    { schema: { tags: ['memberships'], params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }, response: { 200: responseSchema, ...commonErrors } } },
    async (request, reply) =>
      withMembershipErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'membership.read');
        const value = await service.plan({ companyId: auth.companyId, actorPermissions: auth.permissions }, request.params.id);
        return reply.header('etag', `"${value.version.toString()}"`).send(successResponse(planHttp(value), request.requestContext));
      }),
  );

  app.put<{ Params: PlanParams; Body: Record<string, unknown> }>(
    '/api/v1/membership-plans/:id',
    {
      schema: {
        tags: ['memberships'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        headers: ifMatchHeader,
        body: { ...planSchema, required: [] },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withMembershipErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'membership.manage');
        const body = request.body as Partial<{
          name: string;
          description: string;
          active: boolean;
          product_id: string;
          duration_days: number;
          benefit_description: string;
          benefit_type: 'percentage_discount' | 'fixed_amount_discount' | 'fixed_price';
          benefit_percentage_basis_points: number;
          benefit_fixed_amount: string;
          benefit_product_ids: string[];
          benefit_category_ids: string[];
          branch_ids: string[];
        }>;
        const updated = await service.updatePlan(
          mutationContext(request, auth.companyId, auth.userId, auth.permissions),
          request.params.id,
          expectedVersionFrom(request),
          {
            ...(body.name === undefined ? {} : { name: body.name }),
            ...(body.description === undefined ? {} : { description: body.description }),
            ...(body.active === undefined ? {} : { active: body.active }),
            ...(body.product_id === undefined ? {} : { productId: body.product_id }),
            ...(body.duration_days === undefined ? {} : { durationDays: body.duration_days }),
            ...(body.benefit_description === undefined ? {} : { benefitDescription: body.benefit_description }),
            ...(body.benefit_type === undefined ? {} : { benefitType: body.benefit_type }),
            ...(body.benefit_percentage_basis_points === undefined
              ? {}
              : { benefitPercentageBasisPoints: body.benefit_percentage_basis_points }),
            ...(body.benefit_fixed_amount === undefined ? {} : { benefitFixedAmount: body.benefit_fixed_amount }),
            ...(body.benefit_product_ids === undefined ? {} : { benefitProductIds: body.benefit_product_ids }),
            ...(body.benefit_category_ids === undefined ? {} : { benefitCategoryIds: body.benefit_category_ids }),
            ...(body.branch_ids === undefined ? {} : { branchIds: body.branch_ids }),
          },
        );
        return reply.header('etag', `"${updated.version.toString()}"`).send(successResponse(planHttp(updated), request.requestContext));
      }),
  );

  app.get<{ Params: CustomerParams }>(
    '/api/v1/customers/:customerId/memberships',
    { schema: { tags: ['memberships'], params: { type: 'object', required: ['customerId'], properties: { customerId: { type: 'string' } } }, response: { 200: responseSchema, ...commonErrors } } },
    async (request, reply) =>
      withMembershipErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'membership.read');
        const rows = await service.membershipsForCustomer(
          { companyId: auth.companyId, actorPermissions: auth.permissions },
          request.params.customerId,
        );
        return reply.send(successResponse(rows.map(membershipHttp), request.requestContext));
      }),
  );

  app.post<{ Params: CustomerParams; Body: { membership_plan_id: string; starts_at?: string } }>(
    '/api/v1/customers/:customerId/memberships',
    {
      schema: {
        tags: ['memberships'],
        params: { type: 'object', required: ['customerId'], properties: { customerId: { type: 'string' } } },
        headers: idempotencyHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['membership_plan_id'],
          properties: { membership_plan_id: { type: 'string', format: 'uuid' }, starts_at: { type: 'string', format: 'date-time' } },
        },
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withMembershipErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'membership.issue');
        const created = await service.issueMembership(
          mutationContext(request, auth.companyId, auth.userId, auth.permissions),
          idempotencyKey(request.headers['idempotency-key']),
          {
            customerId: request.params.customerId,
            membershipPlanId: request.body.membership_plan_id,
            ...(request.body.starts_at === undefined ? {} : { startsAt: new Date(request.body.starts_at) }),
          },
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        return reply.code(201).send(successResponse(membershipHttp(created.value), request.requestContext));
      }),
  );

  app.post<{ Params: MembershipParams }>(
    '/api/v1/customer-memberships/:id/renew',
    {
      schema: {
        tags: ['memberships'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        headers: idempotencyHeaders,
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withMembershipErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'membership.issue');
        const renewed = await service.renewMembership(
          mutationContext(request, auth.companyId, auth.userId, auth.permissions),
          idempotencyKey(request.headers['idempotency-key']),
          request.params.id,
        );
        if (renewed.replayed) reply.header('idempotency-replayed', 'true');
        return reply.code(201).send(successResponse(membershipHttp(renewed.value), request.requestContext));
      }),
  );

  app.post<{ Params: MembershipParams; Body: { reason: string } }>(
    '/api/v1/customer-memberships/:id/cancel',
    {
      schema: {
        tags: ['memberships'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        headers: ifMatchHeader,
        body: { type: 'object', additionalProperties: false, required: ['reason'], properties: { reason: { type: 'string', minLength: 1, maxLength: 500 } } },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withMembershipErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'membership.manage');
        const cancelled = await service.cancelMembership(
          mutationContext(request, auth.companyId, auth.userId, auth.permissions),
          request.params.id,
          expectedVersionFrom(request),
          request.body.reason,
        );
        return reply.send(successResponse(membershipHttp(cancelled), request.requestContext));
      }),
  );

  // Part N — server-authoritative validation.
  app.post<{ Body: { customer_id: string; branch_id: string } }>(
    '/api/v1/memberships/validate',
    {
      schema: {
        tags: ['memberships'],
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['customer_id', 'branch_id'],
          properties: { customer_id: { type: 'string', format: 'uuid' }, branch_id: { type: 'string', format: 'uuid' } },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withMembershipErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'membership.read');
        const result = await service.validate(
          { companyId: auth.companyId, actorPermissions: auth.permissions },
          request.body.customer_id,
          request.body.branch_id,
          new Date(),
        );
        return reply.send(
          successResponse(
            {
              valid: result.valid,
              reason: result.reason,
              eligible_branch: result.eligibleBranch,
              membership: result.membership === null ? null : membershipHttp(result.membership),
            },
            request.requestContext,
          ),
        );
      }),
  );
}
