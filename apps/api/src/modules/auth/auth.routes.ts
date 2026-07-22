import type { FastifyInstance } from 'fastify';

import type { ApiConfig } from '@asone/config';
import { successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requireBranchAccess } from './auth.guards.js';
import type { AuthService, TokenResult } from './auth.service.js';
import { loginSchema, logoutAllSchema, permissionsSchema, refreshSchema } from './auth.schemas.js';

function tokenData(result: TokenResult): Readonly<Record<string, unknown>> {
  return {
    access_token: result.accessToken,
    token_type: 'Bearer',
    expires_at: result.accessTokenExpiresAt.toISOString(),
    refresh_token: result.refreshToken,
    refresh_expires_at: result.refreshTokenExpiresAt.toISOString(),
    session: {
      id: result.context.sessionId,
      company_id: result.context.companyId,
      branch_id: result.context.branchId ?? null,
      device_id: result.context.deviceId ?? null,
      permitted_branch_ids: result.context.permittedBranchIds,
    },
  };
}

export function registerAuthRoutes(
  app: FastifyInstance,
  service: AuthService,
  config: ApiConfig,
): void {
  app.post<{
    Body: {
      identifier: string;
      password: string;
      company_id?: string;
      branch_id?: string;
      device_id?: string;
    };
  }>(
    '/api/v1/auth/login',
    {
      schema: loginSchema,
      config: {
        rateLimit: {
          max: config.authLoginRateLimitMax,
          timeWindow: config.authLoginRateLimitWindowMs,
        },
      },
    },
    async (request) =>
      successResponse(
        tokenData(
          await service.login({
            identifier: request.body.identifier,
            password: request.body.password,
            companyId: request.body.company_id,
            branchId: request.body.branch_id,
            deviceId: request.body.device_id,
          }),
        ),
        request.requestContext,
      ),
  );

  app.post<{ Body: { refresh_token: string } }>(
    '/api/v1/auth/refresh',
    {
      schema: refreshSchema,
      config: {
        rateLimit: {
          max: config.authLoginRateLimitMax,
          timeWindow: config.authLoginRateLimitWindowMs,
        },
      },
    },
    async (request) =>
      successResponse(
        tokenData(await service.refresh(request.body.refresh_token)),
        request.requestContext,
      ),
  );

  app.post('/api/v1/auth/logout', async (request, reply) => {
    await service.logout(await requireAuthenticatedUser(request, service));
    return reply.code(204).send();
  });

  app.post<{ Body: { except_current?: boolean } }>(
    '/api/v1/auth/logout-all',
    { schema: logoutAllSchema },
    async (request) => {
      const context = await requireAuthenticatedUser(request, service);
      return successResponse(
        { revoked_count: await service.logoutAll(context, request.body.except_current ?? false) },
        request.requestContext,
      );
    },
  );

  app.get('/api/v1/auth/session', async (request) => {
    const context = await requireAuthenticatedUser(request, service);
    return successResponse(
      {
        id: context.sessionId,
        company_id: context.companyId,
        branch_id: context.branchId ?? null,
        device_id: context.deviceId ?? null,
        expires_at: context.expiresAt.toISOString(),
        permitted_branch_ids: context.permittedBranchIds,
      },
      request.requestContext,
    );
  });

  app.get('/api/v1/auth/me', async (request) => {
    const context = await requireAuthenticatedUser(request, service);
    return successResponse(await service.getIdentity(context.userId), request.requestContext);
  });

  app.get<{ Querystring: { branch_id?: string } }>(
    '/api/v1/auth/permissions',
    { schema: permissionsSchema },
    async (request) => {
      const context = await requireAuthenticatedUser(request, service);
      if (request.query.branch_id !== undefined)
        requireBranchAccess(service, context, request.query.branch_id);
      return successResponse(
        {
          company_id: context.companyId,
          branch_id: request.query.branch_id ?? context.branchId ?? null,
          permissions: context.permissions,
          policy_version: 1,
        },
        request.requestContext,
      );
    },
  );
}
