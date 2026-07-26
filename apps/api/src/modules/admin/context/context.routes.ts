import type { FastifyInstance } from 'fastify';

import { successResponse } from '../../../http/response.js';
import { requireAuthenticatedUser, requirePermission } from '../../auth/auth.guards.js';
import type { AuthService } from '../../auth/auth.service.js';
import type { AdministrationService } from '../shared/admin.service.js';

/** Context endpoints deliberately derive company and branch visibility from the session. */
export function registerContextRoutes(
  app: FastifyInstance,
  authentication: AuthService,
  administration: AdministrationService,
): void {
  app.get('/api/v1/context/companies', async (request) => {
    const context = await requireAuthenticatedUser(request, authentication);
    requirePermission(authentication, context, 'company.read');
    return successResponse(
      {
        items: [
          await administration.currentCompany({
            context,
            requestId: request.requestContext.requestId,
            correlationId: request.requestContext.correlationId,
          }),
        ],
      },
      request.requestContext,
    );
  });
  app.get('/api/v1/context/branches', async (request) => {
    const context = await requireAuthenticatedUser(request, authentication);
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
  });
}
