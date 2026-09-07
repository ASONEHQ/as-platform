import type { FastifyInstance, FastifyRequest } from 'fastify';

import { successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requirePermission } from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import { idempotencyKey } from '../catalog/catalog.schemas.js';
import { withRewardErrors } from './rewards.http-errors.js';
import type { RewardsService } from './rewards.service.js';
import { effectiveStatus, type RewardEntitlementRow, type RewardEntitlementTokenRow, type RewardMutationContext } from './rewards.types.js';

interface EntitlementParams {
  id: string;
}
interface CustomerParams {
  customerId: string;
}

const errorSchema = { type: 'object', additionalProperties: true } as const;
const commonErrors = { 400: errorSchema, 401: errorSchema, 403: errorSchema, 404: errorSchema, 409: errorSchema } as const;
const responseSchema = { type: 'object', additionalProperties: true } as const;
const idempotencyHeaders = {
  type: 'object',
  required: ['idempotency-key'],
  properties: { 'idempotency-key': { type: 'string', minLength: 1, maxLength: 255 } },
} as const;
const ifMatchHeader = { type: 'object', required: ['if-match'], properties: { 'if-match': { type: 'string' } } } as const;

function mutationContext(request: FastifyRequest, companyId: string, actorId: string, actorPermissions: readonly string[]): RewardMutationContext {
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

// Part N — every response carries the LIVE `effective_status` (computed
// at request time, `status` may still say `available` in the database
// until something actually acts on it) alongside the raw persisted
// `status`, so a caller never has to duplicate the expiry check itself.
function entitlementHttp(value: RewardEntitlementRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    customer_id: value.customerId,
    loyalty_program_id: value.loyaltyProgramId,
    reward_type: value.rewardType,
    status: value.status,
    effective_status: effectiveStatus(value, new Date()),
    issued_at: value.issuedAt.toISOString(),
    expires_at: value.expiresAt?.toISOString() ?? null,
    redeemed_at: value.redeemedAt?.toISOString() ?? null,
    revoked_at: value.revokedAt?.toISOString() ?? null,
    source_type: value.sourceType,
    cycle_number: value.cycleNumber,
    version: Number(value.version),
  };
}
function tokenHttp(value: RewardEntitlementTokenRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    reward_entitlement_id: value.rewardEntitlementId,
    token: value.token,
    status: value.status,
    created_at: value.createdAt.toISOString(),
  };
}

export function registerRewardRoutes(app: FastifyInstance, authentication: AuthService, service: RewardsService): void {
  // Part U — Customer Detail's own available/redeemed rewards list.
  app.get<{ Params: CustomerParams }>(
    '/api/v1/customers/:customerId/reward-entitlements',
    { schema: { tags: ['rewards'], params: { type: 'object', required: ['customerId'], properties: { customerId: { type: 'string' } } }, response: { 200: responseSchema, ...commonErrors } } },
    async (request, reply) =>
      withRewardErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'reward.read');
        const rows = await service.entitlementsForCustomer(
          { companyId: auth.companyId, actorPermissions: auth.permissions },
          request.params.customerId,
        );
        return reply.send(successResponse(rows.map(entitlementHttp), request.requestContext));
      }),
  );

  // Part H — manual issuance, `reward.issue` only.
  app.post<{ Params: CustomerParams; Body: { loyalty_program_id: string; reason_code: string; expires_at?: string } }>(
    '/api/v1/customers/:customerId/reward-entitlements',
    {
      schema: {
        tags: ['rewards'],
        params: { type: 'object', required: ['customerId'], properties: { customerId: { type: 'string' } } },
        headers: idempotencyHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['loyalty_program_id', 'reason_code'],
          properties: {
            loyalty_program_id: { type: 'string', format: 'uuid' },
            reason_code: { type: 'string', minLength: 1, maxLength: 200 },
            expires_at: { type: 'string', format: 'date-time' },
          },
        },
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withRewardErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'reward.issue');
        const created = await service.issueManual(
          mutationContext(request, auth.companyId, auth.userId, auth.permissions),
          idempotencyKey(request.headers['idempotency-key']),
          {
            customerId: request.params.customerId,
            loyaltyProgramId: request.body.loyalty_program_id,
            reasonCode: request.body.reason_code,
            ...(request.body.expires_at === undefined ? {} : { expiresAt: new Date(request.body.expires_at) }),
          },
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        return reply.code(201).send(successResponse(entitlementHttp(created.value), request.requestContext));
      }),
  );

  app.get<{ Params: EntitlementParams }>(
    '/api/v1/reward-entitlements/:id',
    { schema: { tags: ['rewards'], params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }, response: { 200: responseSchema, ...commonErrors } } },
    async (request, reply) =>
      withRewardErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'reward.read');
        const value = await service.entitlement({ companyId: auth.companyId, actorPermissions: auth.permissions }, request.params.id);
        return reply.header('etag', `"${value.version.toString()}"`).send(successResponse(entitlementHttp(value), request.requestContext));
      }),
  );

  // Part I/J — server-authoritative redemption.
  app.post<{ Params: EntitlementParams; Body: { branch_id?: string } }>(
    '/api/v1/reward-entitlements/:id/redeem',
    {
      schema: {
        tags: ['rewards'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        headers: idempotencyHeaders,
        body: { type: 'object', additionalProperties: false, properties: { branch_id: { type: 'string', format: 'uuid' } } },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withRewardErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'reward.redeem');
        const redeemed = await service.redeem(
          mutationContext(request, auth.companyId, auth.userId, auth.permissions),
          idempotencyKey(request.headers['idempotency-key']),
          request.params.id,
          request.body.branch_id ?? null,
        );
        if (redeemed.replayed) reply.header('idempotency-replayed', 'true');
        return reply.send(successResponse(entitlementHttp(redeemed.value), request.requestContext));
      }),
  );

  // Part O — revocation, `reward.revoke` only.
  app.post<{ Params: EntitlementParams; Body: { reason: string } }>(
    '/api/v1/reward-entitlements/:id/revoke',
    {
      schema: {
        tags: ['rewards'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        headers: ifMatchHeader,
        body: { type: 'object', additionalProperties: false, required: ['reason'], properties: { reason: { type: 'string', minLength: 1, maxLength: 500 } } },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withRewardErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'reward.revoke');
        const revoked = await service.revoke(
          mutationContext(request, auth.companyId, auth.userId, auth.permissions),
          request.params.id,
          expectedVersionFrom(request),
          request.body.reason,
        );
        return reply.send(successResponse(entitlementHttp(revoked), request.requestContext));
      }),
  );

  // Part L/X — presentation token (opaque, revocable, never the customer
  // identity token — see ADR-0018).
  app.post<{ Params: EntitlementParams }>(
    '/api/v1/reward-entitlements/:id/presentation-token',
    { schema: { tags: ['rewards'], params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }, response: { 201: responseSchema, ...commonErrors } } },
    async (request, reply) =>
      withRewardErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        const issued = await service.issueToken(mutationContext(request, auth.companyId, auth.userId, auth.permissions), request.params.id);
        return reply.code(201).send(successResponse(tokenHttp(issued), request.requestContext));
      }),
  );

  app.get<{ Params: EntitlementParams }>(
    '/api/v1/reward-entitlements/:id/presentation-token/active',
    { schema: { tags: ['rewards'], params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }, response: { 200: responseSchema, ...commonErrors } } },
    async (request, reply) =>
      withRewardErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        const active = await service.activeToken({ companyId: auth.companyId, actorPermissions: auth.permissions }, request.params.id);
        return reply.send(successResponse(active === null ? null : tokenHttp(active), request.requestContext));
      }),
  );

  app.post<{ Body: { token: string } }>(
    '/api/v1/reward-entitlements/resolve-token',
    {
      schema: {
        tags: ['rewards'],
        body: { type: 'object', additionalProperties: false, required: ['token'], properties: { token: { type: 'string', minLength: 16, maxLength: 200 } } },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withRewardErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        const resolved = await service.resolveToken({ companyId: auth.companyId, actorPermissions: auth.permissions }, request.body.token);
        return reply.send(successResponse(entitlementHttp(resolved), request.requestContext));
      }),
  );
}
