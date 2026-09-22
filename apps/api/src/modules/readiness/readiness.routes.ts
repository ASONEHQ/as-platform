import type { FastifyInstance } from 'fastify';

import { successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requireBranchAccess, requirePermission } from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import type { ReadinessService } from './readiness.service.js';
import type { ReadinessCheck, ReadinessStage, TenantReadiness } from './readiness.types.js';

const errorSchema = { type: 'object', additionalProperties: true } as const;
const commonErrors = { 400: errorSchema, 401: errorSchema, 403: errorSchema, 404: errorSchema } as const;
const responseSchema = { type: 'object', additionalProperties: true } as const;

function checkHttp(value: ReadinessCheck): Readonly<Record<string, unknown>> {
  return {
    code: value.code,
    scope: value.scope,
    required: value.required,
    status: value.status,
    surface: value.surface,
    count: value.count,
    items: value.items.map((item) => ({ id: item.id, label: item.label })),
  };
}
function stageHttp(value: ReadinessStage): Readonly<Record<string, unknown>> {
  return { key: value.key, ready: value.ready, blocked_by: value.blockedBy };
}
function readinessHttp(value: TenantReadiness): Readonly<Record<string, unknown>> {
  return {
    evaluated_at: value.evaluatedAt,
    company: {
      id: value.company.id,
      name: value.company.name,
      currency_code: value.company.currencyCode,
      timezone: value.company.timezone,
      administration_ready: value.company.administrationReady,
      checks: value.company.checks.map(checkHttp),
    },
    branches: value.branches.map((branch) => ({
      branch_id: branch.branchId,
      code: branch.code,
      name: branch.name,
      checks: branch.checks.map(checkHttp),
      stages: branch.stages.map(stageHttp),
    })),
  };
}

/** TASK 16.17 — `GET /api/v1/readiness[?branch_id=]`. Read-only and
 * observational: gated by `branch.read` (the same right every branch
 * administrator already has) and scoped to the actor's own permitted
 * branches — a restricted actor can never learn about a branch outside
 * their scope, and no company other than the actor's own is ever
 * reachable (the company id always comes from the authenticated session,
 * never from the request). */
export function registerReadinessRoutes(app: FastifyInstance, authentication: AuthService, service: ReadinessService): void {
  app.get<{ Querystring: { branch_id?: string } }>(
    '/api/v1/readiness',
    {
      schema: {
        tags: ['readiness'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { branch_id: { type: 'string', format: 'uuid' } },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      const auth = await requireAuthenticatedUser(request, authentication);
      requirePermission(authentication, auth, 'branch.read');
      if (request.query.branch_id !== undefined) requireBranchAccess(authentication, auth, request.query.branch_id);
      const result = await service.evaluate(auth.companyId, auth.permittedBranchIds, request.query.branch_id);
      return reply.send(successResponse(readinessHttp(result), request.requestContext));
    },
  );
}
