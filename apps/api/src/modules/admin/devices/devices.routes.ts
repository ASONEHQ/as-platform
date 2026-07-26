import type { FastifyInstance } from 'fastify';

import { successResponse } from '../../../http/response.js';
import { requireAuthenticatedUser } from '../../auth/auth.guards.js';
import type { AuthService } from '../../auth/auth.service.js';
import type { AdministrationService } from '../shared/admin.service.js';

export function registerDeviceRoutes(
  app: FastifyInstance,
  authentication: AuthService,
  administration: AdministrationService,
): void {
  app.get('/api/v1/devices', async (request) => {
    const context = await requireAuthenticatedUser(request, authentication);
    return successResponse(
      {
        items: await administration.listDevices({
          context,
          requestId: request.requestContext.requestId,
          correlationId: request.requestContext.correlationId,
        }),
      },
      request.requestContext,
    );
  });
  app.post<{
    Body: {
      branch_id: string;
      device_code: string;
      name: string;
      device_type: string;
      public_key?: string;
    };
  }>('/api/v1/devices', async (request, reply) => {
    const context = await requireAuthenticatedUser(request, authentication);
    return reply.code(201).send(
      successResponse(
        await administration.registerDevice(
          {
            context,
            requestId: request.requestContext.requestId,
            correlationId: request.requestContext.correlationId,
          },
          {
            branchId: request.body.branch_id,
            deviceCode: request.body.device_code,
            name: request.body.name,
            deviceType: request.body.device_type,
            ...(request.body.public_key === undefined
              ? {}
              : { publicKey: request.body.public_key }),
          },
        ),
        request.requestContext,
      ),
    );
  });
  app.get<{ Params: { device_id: string } }>('/api/v1/devices/:device_id', async (request) => {
    const context = await requireAuthenticatedUser(request, authentication);
    return successResponse(
      await administration.device(
        {
          context,
          requestId: request.requestContext.requestId,
          correlationId: request.requestContext.correlationId,
        },
        request.params.device_id,
      ),
      request.requestContext,
    );
  });
  app.post<{ Params: { device_id: string }; Body: { reason_code: string; note?: string } }>(
    '/api/v1/devices/:device_id/revocations',
    async (request, reply) => {
      const context = await requireAuthenticatedUser(request, authentication);
      return reply.code(201).send(
        successResponse(
          await administration.revokeDevice(
            {
              context,
              requestId: request.requestContext.requestId,
              correlationId: request.requestContext.correlationId,
            },
            request.params.device_id,
            request.body.reason_code,
            request.body.note,
          ),
          request.requestContext,
        ),
      );
    },
  );
}
