import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { ApiConfig } from '@asone/config';
import { AppError } from '@asone/errors';
import { successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requireBranchAccess } from './auth.guards.js';
import type { AuthService, LoginResult, TokenResult } from './auth.service.js';
import type { ClientType, TransportMode } from './auth.types.js';
import {
  branchSwitchSchema,
  companySelectionSchema,
  companySwitchSchema,
  loginSchema,
  logoutAllSchema,
  permissionsSchema,
  refreshSchema,
} from './auth.schemas.js';

const productionCookie = '__Host-asone_refresh';
const localCookie = 'asone_refresh_local';

function cookieName(config: ApiConfig): string {
  return config.nodeEnv === 'production' ? productionCookie : localCookie;
}

function parseCookies(header: string | undefined): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const part of header?.split(';') ?? []) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (/^[A-Za-z0-9_-]+$/u.test(name) && value.length <= 1024) result[name] = value;
  }
  return result;
}

function setRefreshCookie(
  reply: FastifyReply,
  config: ApiConfig,
  token: string,
  expiresAt: Date,
): void {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  const secure = config.nodeEnv === 'production' ? '; Secure' : '';
  reply.header(
    'set-cookie',
    `${cookieName(config)}=${token}; HttpOnly${secure}; SameSite=Strict; Path=/api/v1/auth; Max-Age=${String(maxAge)}`,
  );
}

function clearRefreshCookie(reply: FastifyReply, config: ApiConfig): void {
  const secure = config.nodeEnv === 'production' ? '; Secure' : '';
  reply.header(
    'set-cookie',
    `${cookieName(config)}=; HttpOnly${secure}; SameSite=Strict; Path=/api/v1/auth; Max-Age=0`,
  );
}

function requireApprovedOrigin(request: FastifyRequest, config: ApiConfig): void {
  const origin = request.headers.origin;
  if (typeof origin !== 'string' || !config.corsAllowedOrigins.includes(origin))
    throw new AppError({
      code: 'validation_error',
      message: 'Request origin is not allowed.',
      statusCode: 403,
    });
}

function hasApprovedOrigin(request: FastifyRequest, config: ApiConfig): boolean {
  const origin = request.headers.origin;
  return typeof origin === 'string' && config.corsAllowedOrigins.includes(origin);
}

function tokenData(service: AuthService, result: TokenResult): Readonly<Record<string, unknown>> {
  return {
    result: 'authenticated',
    access_token: result.accessToken,
    token_type: 'Bearer',
    expires_at: result.accessTokenExpiresAt.toISOString(),
    ...((result.context.transportMode ?? 'bearer') === 'bearer'
      ? { refresh_token: result.refreshToken }
      : {}),
    refresh_expires_at: result.refreshTokenExpiresAt.toISOString(),
    ...(service.csrfToken(result.context) === undefined
      ? {}
      : { csrf_token: service.csrfToken(result.context) }),
    session: {
      id: result.context.sessionId,
      user_id: result.context.userId,
      membership_id: result.context.membershipId,
      company_id: result.context.companyId,
      branch_id: result.context.branchId ?? null,
      device_id: result.context.deviceId ?? null,
      permitted_branch_ids: result.context.permittedBranchIds,
      company_wide_access: result.context.companyWideAccess ?? false,
      transport_mode: result.context.transportMode ?? 'bearer',
      refresh_generation: result.context.tokenGeneration ?? 0,
    },
  };
}

function challengeData(
  result: Extract<LoginResult, { outcome: 'company_selection_required' }>,
): Readonly<Record<string, unknown>> {
  return {
    result: result.outcome,
    challenge_token: result.challengeToken,
    expires_at: result.expiresAt.toISOString(),
    companies: result.companies,
  };
}

function sendTokens(
  service: AuthService,
  result: TokenResult,
  reply: FastifyReply,
  config: ApiConfig,
): Readonly<Record<string, unknown>> {
  reply.header('cache-control', 'no-store');
  if ((result.context.transportMode ?? 'bearer') === 'browser')
    setRefreshCookie(reply, config, result.refreshToken, result.refreshTokenExpiresAt);
  return tokenData(service, result);
}

function clientType(request: FastifyRequest, bodyValue?: ClientType): ClientType | undefined {
  const header = request.headers['x-asone-client'];
  if (header !== undefined && header !== bodyValue && bodyValue !== undefined)
    throw new AppError({
      code: 'validation_error',
      message: 'Client type is conflicting.',
      statusCode: 400,
    });
  const selected = typeof header === 'string' ? header : bodyValue;
  if (selected !== undefined && !['browser', 'mobile', 'pos'].includes(selected))
    throw new AppError({
      code: 'validation_error',
      message: 'Client type is invalid.',
      statusCode: 400,
    });
  return selected as ClientType | undefined;
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
      client_type?: ClientType;
      transport_mode?: TransportMode;
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
    async (request, reply) => {
      const selectedClientType = clientType(request, request.body.client_type);
      if (selectedClientType === 'browser') requireApprovedOrigin(request, config);
      const result = await service.beginLogin(
        {
          identifier: request.body.identifier,
          password: request.body.password,
          companyId: request.body.company_id,
          branchId: request.body.branch_id,
          deviceId: request.body.device_id,
          clientType: selectedClientType,
          transportMode: request.body.transport_mode,
        },
        request.requestContext,
      );
      reply.header('cache-control', 'no-store');
      if ('outcome' in result)
        return successResponse(challengeData(result), request.requestContext);
      return successResponse(sendTokens(service, result, reply, config), request.requestContext);
    },
  );

  app.post<{ Body: { refresh_token?: string } }>(
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
    async (request, reply) => {
      const cookieToken = parseCookies(request.headers.cookie)[cookieName(config)];
      if (cookieToken !== undefined && request.body.refresh_token !== undefined)
        throw new AppError({
          code: 'validation_error',
          message: 'Refresh sources are conflicting.',
          statusCode: 400,
        });
      const token = cookieToken ?? request.body.refresh_token;
      if (token === undefined)
        throw new AppError({
          code: 'validation_error',
          message: 'Refresh credential is required.',
          statusCode: 400,
        });
      const mode: TransportMode = cookieToken === undefined ? 'bearer' : 'browser';
      if (mode === 'browser') requireApprovedOrigin(request, config);
      try {
        const result = await service.refresh(
          token,
          mode,
          request.headers['x-csrf-token'] as string | undefined,
          request.requestContext,
        );
        return successResponse(sendTokens(service, result, reply, config), request.requestContext);
      } catch (error) {
        if (mode === 'browser') clearRefreshCookie(reply, config);
        throw error;
      }
    },
  );

  app.post('/api/v1/auth/logout', async (request, reply) => {
    const context = await requireAuthenticatedUser(request, service);
    if ((context.transportMode ?? 'bearer') === 'browser') {
      requireApprovedOrigin(request, config);
      service.verifyCsrf(context, request.headers['x-csrf-token'] as string | undefined);
      clearRefreshCookie(reply, config);
    }
    await service.logout(context, request.requestContext);
    reply.header('cache-control', 'no-store');
    return reply.code(204).send();
  });

  app.post<{ Body: { except_current?: boolean } }>(
    '/api/v1/auth/logout-all',
    {
      schema: logoutAllSchema,
      config: {
        rateLimit: {
          max: config.authLoginRateLimitMax,
          timeWindow: config.authLoginRateLimitWindowMs,
        },
      },
    },
    async (request, reply) => {
      const context = await requireAuthenticatedUser(request, service);
      if ((context.transportMode ?? 'bearer') === 'browser') {
        requireApprovedOrigin(request, config);
        service.verifyCsrf(context, request.headers['x-csrf-token'] as string | undefined);
        if (!(request.body.except_current ?? false)) clearRefreshCookie(reply, config);
      }
      return successResponse(
        {
          revoked_count: await service.logoutAll(
            context,
            request.body.except_current ?? false,
            request.requestContext,
          ),
        },
        request.requestContext,
      );
    },
  );

  app.post<{ Body: { challenge_token: string; company_id: string; branch_id?: string } }>(
    '/api/v1/auth/company-selections',
    {
      schema: companySelectionSchema,
      config: {
        rateLimit: {
          max: config.authLoginRateLimitMax,
          timeWindow: config.authLoginRateLimitWindowMs,
        },
      },
    },
    async (request, reply) => {
      const result = await service.completeCompanySelection({
        challengeToken: request.body.challenge_token,
        companyId: request.body.company_id,
        branchId: request.body.branch_id,
        browserOriginApproved: hasApprovedOrigin(request, config),
        requestId: request.requestContext.requestId,
        correlationId: request.requestContext.correlationId,
      });
      return successResponse(sendTokens(service, result, reply, config), request.requestContext);
    },
  );

  app.post<{ Body: { company_id: string; branch_id?: string } }>(
    '/api/v1/auth/company-switches',
    {
      schema: companySwitchSchema,
      config: {
        rateLimit: {
          max: config.authLoginRateLimitMax,
          timeWindow: config.authLoginRateLimitWindowMs,
        },
      },
    },
    async (request, reply) => {
      const current = await requireAuthenticatedUser(request, service);
      if ((current.transportMode ?? 'bearer') === 'browser') {
        requireApprovedOrigin(request, config);
        service.verifyCsrf(current, request.headers['x-csrf-token'] as string | undefined);
      }
      const result = await service.switchCompany(
        current,
        request.body.company_id,
        request.body.branch_id,
        request.requestContext,
      );
      return successResponse(sendTokens(service, result, reply, config), request.requestContext);
    },
  );

  app.post<{ Body: { branch_id?: string | null } }>(
    '/api/v1/auth/branch-switches',
    {
      schema: branchSwitchSchema,
      config: {
        rateLimit: {
          max: config.authLoginRateLimitMax,
          timeWindow: config.authLoginRateLimitWindowMs,
        },
      },
    },
    async (request, reply) => {
      const current = await requireAuthenticatedUser(request, service);
      if ((current.transportMode ?? 'bearer') === 'browser') {
        requireApprovedOrigin(request, config);
        service.verifyCsrf(current, request.headers['x-csrf-token'] as string | undefined);
      }
      const result = await service.switchBranch(
        current,
        request.body.branch_id ?? undefined,
        request.requestContext,
      );
      return successResponse(sendTokens(service, result, reply, config), request.requestContext);
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
        company_wide_access: context.companyWideAccess ?? false,
        transport_mode: context.transportMode ?? 'bearer',
        refresh_generation: context.tokenGeneration ?? 0,
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
