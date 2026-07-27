import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { AppError } from '@asone/errors';

import { successResponse } from '../../../http/response.js';
import { requireAuthenticatedUser, requirePermission } from '../../auth/auth.guards.js';
import type { AuthService } from '../../auth/auth.service.js';
import { settingsCheckpointEtag } from './settings.checkpoint.js';
import { withSettingsErrors } from './settings.http-errors.js';
import {
  effectiveBranchResponseSchema,
  effectiveCompanyResponseSchema,
  ifNoneMatchMatches,
  parseIfMatch,
  parseSettingKeys,
  rejectUnknownSettingBody,
  settingBodySchema,
  settingMutationResponseSchema,
  settingsQuerySchema,
  type SettingBody,
} from './settings.schemas.js';
import type {
  BranchSettingsScope,
  ResolvedSettings,
  SettingMutationResult,
  SettingsService,
} from './settings.service.js';
import type { EffectiveSetting } from './settings.types.js';

const privateCache = 'private, no-cache';
const errorSchema = { type: 'object', additionalProperties: true } as const;
const commonErrors = {
  400: errorSchema,
  401: errorSchema,
  403: errorSchema,
  404: errorSchema,
  409: errorSchema,
} as const;

interface EffectiveQuery {
  readonly keys?: string | undefined;
}

function httpVersion(version: bigint): number {
  const value = Number(version);
  if (!Number.isSafeInteger(value))
    throw new AppError({
      code: 'internal_error',
      message: 'The setting version cannot be represented safely.',
      statusCode: 500,
    });
  return value;
}

function httpSetting(setting: EffectiveSetting): Readonly<Record<string, unknown>> {
  return {
    key: setting.key,
    type: setting.type,
    value: setting.value,
    source: setting.source,
    version: httpVersion(setting.version),
  };
}

function sendEffective(
  request: FastifyRequest,
  reply: FastifyReply,
  resolved: ResolvedSettings,
  scope: { readonly companyId: string; readonly branchId?: string | undefined },
): unknown {
  const etag = settingsCheckpointEtag(resolved.checkpoint);
  reply.header('etag', etag).header('cache-control', privateCache);
  if (ifNoneMatchMatches(request.headers['if-none-match'], etag)) return reply.code(304).send();
  return reply.send(
    successResponse(
      {
        company_id: scope.companyId,
        ...(scope.branchId === undefined ? {} : { branch_id: scope.branchId }),
        settings: resolved.settings.map(httpSetting),
        checkpoint: resolved.checkpoint,
      },
      request.requestContext,
    ),
  );
}

function mutationRepresentation(
  result: SettingMutationResult,
  companyId: string,
  branchScope?: BranchSettingsScope,
): Readonly<Record<string, unknown>> {
  const { persisted, effective } = result;
  return {
    id: persisted.id,
    company_id: companyId,
    ...(branchScope === undefined ? {} : { branch_id: branchScope.branchId }),
    ...httpSetting(effective),
    status: persisted.status,
    created_at: persisted.createdAt.toISOString(),
    updated_at: persisted.updatedAt.toISOString(),
  };
}

export function registerSettingsRoutes(
  app: FastifyInstance,
  authentication: AuthService,
  service: SettingsService,
): void {
  app.get<{ Params: { company_id: string }; Querystring: EffectiveQuery }>(
    '/api/v1/companies/:company_id/settings/effective',
    {
      schema: {
        tags: ['settings'],
        summary: 'Resolve effective company settings',
        querystring: settingsQuerySchema,
        response: { 200: effectiveCompanyResponseSchema, 304: { type: 'null' }, ...commonErrors },
      },
    },
    async (request, reply) =>
      withSettingsErrors(async () => {
        const context = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, context, 'company_settings.read');
        if (request.params.company_id !== context.companyId)
          throw new AppError({
            code: 'company_scope_mismatch',
            message: 'Company scope is not authorized.',
            statusCode: 403,
          });
        const resolved = await service.effectiveCompanySettings(
          { companyId: context.companyId },
          parseSettingKeys(request.query.keys),
        );
        return sendEffective(request, reply, resolved, { companyId: context.companyId });
      }),
  );

  app.put<{ Params: { company_id: string; key: string }; Body: SettingBody }>(
    '/api/v1/companies/:company_id/settings/:key',
    {
      schema: {
        tags: ['settings'],
        summary: 'Set or retire a company setting',
        headers: {
          type: 'object',
          required: ['if-match'],
          properties: { 'if-match': { type: 'string' } },
        },
        body: settingBodySchema,
        response: { 200: settingMutationResponseSchema, ...commonErrors },
      },
      preValidation: (request, _reply, done) => {
        try {
          rejectUnknownSettingBody(request.body);
          done();
        } catch (error) {
          done(error as Error);
        }
      },
    },
    async (request, reply) =>
      withSettingsErrors(async () => {
        const context = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, context, 'company_settings.update');
        if (request.params.company_id !== context.companyId)
          throw new AppError({
            code: 'company_scope_mismatch',
            message: 'Company scope is not authorized.',
            statusCode: 403,
          });
        const expectedVersion = parseIfMatch(request.headers['if-match']);
        const input = {
          key: request.params.key,
          value: request.body.value,
          valueType: request.body.value_type,
          expectedVersion,
          actorId: context.userId,
          requestId: request.requestContext.requestId,
          correlationId: request.requestContext.correlationId,
          timestamp: new Date(),
        };
        const result = await service.mutateCompanySetting(
          { companyId: context.companyId },
          input,
          request.body.status,
        );
        const data = mutationRepresentation(result, context.companyId);
        return reply
          .header('etag', `"${result.persisted.version.toString()}"`)
          .header('cache-control', privateCache)
          .send(successResponse(data, request.requestContext));
      }),
  );

  app.get<{ Params: { branch_id: string }; Querystring: EffectiveQuery }>(
    '/api/v1/branches/:branch_id/settings/effective',
    {
      schema: {
        tags: ['settings'],
        summary: 'Resolve effective branch settings',
        querystring: settingsQuerySchema,
        response: { 200: effectiveBranchResponseSchema, 304: { type: 'null' }, ...commonErrors },
      },
    },
    async (request, reply) =>
      withSettingsErrors(async () => {
        const context = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, context, 'branch_settings.read');
        const scope = {
          companyId: context.companyId,
          branchId: request.params.branch_id,
          permittedBranchIds: context.permittedBranchIds,
        };
        const resolved = await service.effectiveBranchSettings(
          scope,
          parseSettingKeys(request.query.keys),
        );
        return sendEffective(request, reply, resolved, scope);
      }),
  );

  app.put<{ Params: { branch_id: string; key: string }; Body: SettingBody }>(
    '/api/v1/branches/:branch_id/settings/:key',
    {
      schema: {
        tags: ['settings'],
        summary: 'Set or retire a branch setting override',
        headers: {
          type: 'object',
          required: ['if-match'],
          properties: { 'if-match': { type: 'string' } },
        },
        body: settingBodySchema,
        response: { 200: settingMutationResponseSchema, ...commonErrors },
      },
      preValidation: (request, _reply, done) => {
        try {
          rejectUnknownSettingBody(request.body);
          done();
        } catch (error) {
          done(error as Error);
        }
      },
    },
    async (request, reply) =>
      withSettingsErrors(async () => {
        const context = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, context, 'branch_settings.update');
        const scope = {
          companyId: context.companyId,
          branchId: request.params.branch_id,
          permittedBranchIds: context.permittedBranchIds,
        };
        const expectedVersion = parseIfMatch(request.headers['if-match']);
        const input = {
          key: request.params.key,
          value: request.body.value,
          valueType: request.body.value_type,
          expectedVersion,
          actorId: context.userId,
          requestId: request.requestContext.requestId,
          correlationId: request.requestContext.correlationId,
          timestamp: new Date(),
        };
        const result = await service.mutateBranchSetting(scope, input, request.body.status);
        const data = mutationRepresentation(result, context.companyId, scope);
        return reply
          .header('etag', `"${result.persisted.version.toString()}"`)
          .header('cache-control', privateCache)
          .send(successResponse(data, request.requestContext));
      }),
  );
}
