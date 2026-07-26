import type { FastifyInstance } from 'fastify';

import { AppError } from '@asone/errors';

import { successResponse } from '../../../http/response.js';
import { requireAuthenticatedUser } from '../../auth/auth.guards.js';
import type { AuthService } from '../../auth/auth.service.js';
import type { AdministrationService } from '../shared/admin.service.js';

export function registerCompanyRoutes(
  app: FastifyInstance,
  authentication: AuthService,
  administration: AdministrationService,
): void {
  app.get<{ Params: { company_id: string } }>('/api/v1/companies/:company_id', async (request) => {
    const context = await requireAuthenticatedUser(request, authentication);
    if (request.params.company_id !== context.companyId)
      throw new AppError({
        code: 'company_scope_mismatch',
        message: 'Company scope is not authorized.',
        statusCode: 403,
      });
    return successResponse(
      await administration.currentCompany({
        context,
        requestId: request.requestContext.requestId,
        correlationId: request.requestContext.correlationId,
      }),
      request.requestContext,
    );
  });
  app.patch<{
    Params: { company_id: string };
    Body: { display_name?: string; timezone?: string; status?: string };
  }>(
    '/api/v1/companies/:company_id',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            display_name: { type: 'string', minLength: 1, maxLength: 200 },
            timezone: { type: 'string', minLength: 1, maxLength: 100 },
            status: { enum: ['active', 'suspended', 'closed'] },
          },
        },
      },
    },
    async (request) => {
      const context = await requireAuthenticatedUser(request, authentication);
      if (request.params.company_id !== context.companyId)
        throw new AppError({
          code: 'company_scope_mismatch',
          message: 'Company scope is not authorized.',
          statusCode: 403,
        });
      return successResponse(
        await administration.updateCompany(
          {
            context,
            requestId: request.requestContext.requestId,
            correlationId: request.requestContext.correlationId,
          },
          {
            displayName: request.body.display_name,
            timezone: request.body.timezone,
            status: request.body.status,
          },
        ),
        request.requestContext,
      );
    },
  );
}
