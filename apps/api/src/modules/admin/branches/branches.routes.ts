import type { FastifyInstance } from 'fastify';

import { AppError } from '@asone/errors';

import { successResponse } from '../../../http/response.js';
import { requireAuthenticatedUser } from '../../auth/auth.guards.js';
import type { AuthService } from '../../auth/auth.service.js';
import type { AdministrationService } from '../shared/admin.service.js';

export function registerBranchRoutes(
  app: FastifyInstance,
  authentication: AuthService,
  administration: AdministrationService,
): void {
  app.get<{ Params: { company_id: string } }>(
    '/api/v1/companies/:company_id/branches',
    async (request) => {
      const context = await requireAuthenticatedUser(request, authentication);
      if (request.params.company_id !== context.companyId)
        throw new AppError({
          code: 'company_scope_mismatch',
          message: 'Company scope is not authorized.',
          statusCode: 403,
        });
      return successResponse(
        {
          items: await administration.listBranches({
            context,
            requestId: request.requestContext.requestId,
            correlationId: request.requestContext.correlationId,
          }),
        },
        request.requestContext,
      );
    },
  );
  app.post<{
    Params: { company_id: string };
    Body: { code: string; name: string; timezone: string; address?: Record<string, unknown> };
  }>(
    '/api/v1/companies/:company_id/branches',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['code', 'name', 'timezone'],
          properties: {
            code: { type: 'string', minLength: 1, maxLength: 80 },
            name: { type: 'string', minLength: 1, maxLength: 200 },
            timezone: { type: 'string', minLength: 1, maxLength: 100 },
            address: { type: 'object' },
          },
        },
      },
    },
    async (request, reply) => {
      const context = await requireAuthenticatedUser(request, authentication);
      if (request.params.company_id !== context.companyId)
        throw new AppError({
          code: 'company_scope_mismatch',
          message: 'Company scope is not authorized.',
          statusCode: 403,
        });
      return reply.code(201).send(
        successResponse(
          await administration.createBranch(
            {
              context,
              requestId: request.requestContext.requestId,
              correlationId: request.requestContext.correlationId,
            },
            request.body,
          ),
          request.requestContext,
        ),
      );
    },
  );
  app.get<{ Params: { branch_id: string } }>('/api/v1/branches/:branch_id', async (request) => {
    const context = await requireAuthenticatedUser(request, authentication);
    return successResponse(
      await administration.branch(
        {
          context,
          requestId: request.requestContext.requestId,
          correlationId: request.requestContext.correlationId,
        },
        request.params.branch_id,
      ),
      request.requestContext,
    );
  });
  app.patch<{
    Params: { branch_id: string };
    Body: {
      code?: string;
      name?: string;
      timezone?: string;
      status?: string;
      address?: Record<string, unknown>;
    };
  }>('/api/v1/branches/:branch_id', async (request) => {
    const context = await requireAuthenticatedUser(request, authentication);
    return successResponse(
      await administration.updateBranch(
        {
          context,
          requestId: request.requestContext.requestId,
          correlationId: request.requestContext.correlationId,
        },
        request.params.branch_id,
        request.body,
      ),
      request.requestContext,
    );
  });
}
