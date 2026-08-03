import type { FastifyInstance } from 'fastify';

import { successResponse } from '../../../http/response.js';
import { requireAuthenticatedUser } from '../../auth/auth.guards.js';
import type { AuthService } from '../../auth/auth.service.js';
import type { AdministrationService } from '../shared/admin.service.js';

const responseMeta = {
  type: 'object',
  additionalProperties: false,
  required: ['request_id', 'correlation_id'],
  properties: { request_id: { type: 'string' }, correlation_id: { type: 'string' } },
} as const;

const contextCompaniesSchema = {
  querystring: { type: 'object', additionalProperties: false, maxProperties: 0 },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['data', 'meta'],
      properties: {
        data: {
          type: 'object',
          additionalProperties: false,
          required: ['items'],
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['company_id', 'display_name', 'current', 'switch_permitted'],
                properties: {
                  company_id: { type: 'string', format: 'uuid' },
                  display_name: { type: 'string' },
                  current: { type: 'boolean' },
                  switch_permitted: { type: 'boolean' },
                },
              },
            },
          },
        },
        meta: responseMeta,
      },
    },
  },
} as const;

const contextBranchesSchema = {
  querystring: { type: 'object', additionalProperties: false, maxProperties: 0 },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['data', 'meta'],
      properties: {
        data: {
          type: 'object',
          additionalProperties: false,
          required: ['company_id', 'company_wide_access', 'items'],
          properties: {
            company_id: { type: 'string', format: 'uuid' },
            company_wide_access: { type: 'boolean' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['branch_id', 'code', 'name', 'timezone', 'current', 'is_default'],
                properties: {
                  branch_id: { type: 'string', format: 'uuid' },
                  code: { type: 'string' },
                  name: { type: 'string' },
                  timezone: { type: 'string' },
                  current: { type: 'boolean' },
                  is_default: { type: 'boolean' },
                },
              },
            },
          },
        },
        meta: responseMeta,
      },
    },
  },
} as const;

/** Context endpoints deliberately derive company and branch visibility from the session. */
export function registerContextRoutes(
  app: FastifyInstance,
  authentication: AuthService,
  administration: AdministrationService,
): void {
  app.get('/api/v1/context/companies', { schema: contextCompaniesSchema }, async (request) => {
    const context = await requireAuthenticatedUser(request, authentication);
    return successResponse(
      {
        items: await administration.contextCompanies({
          context,
          requestId: request.requestContext.requestId,
          correlationId: request.requestContext.correlationId,
        }),
      },
      request.requestContext,
    );
  });
  app.get('/api/v1/context/branches', { schema: contextBranchesSchema }, async (request) => {
    const context = await requireAuthenticatedUser(request, authentication);
    return successResponse(
      await administration
        .contextBranches({
          context,
          requestId: request.requestContext.requestId,
          correlationId: request.requestContext.correlationId,
        })
        .then((result) => ({
          company_id: result.companyId,
          company_wide_access: result.companyWideAccess,
          items: result.items,
        })),
      request.requestContext,
    );
  });
}
