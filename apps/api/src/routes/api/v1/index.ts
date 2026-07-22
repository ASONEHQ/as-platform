import type { FastifyInstance } from 'fastify';

import type { ApiConfig } from '@asone/config';

import { successResponse } from '../../../http/response.js';

export function registerApiV1Routes(app: FastifyInstance, config: ApiConfig): void {
  app.get(
    '/api/v1',
    {
      schema: {
        tags: ['technical'],
        summary: 'Describe the current API version',
        response: { 200: { type: 'object', additionalProperties: true } },
      },
    },
    (request) =>
      successResponse(
        {
          documentation: config.openapiUiEnabled ? '/documentation' : null,
          name: 'AS ONE API',
          status: 'available',
          version: config.appVersion,
        },
        request.requestContext,
      ),
  );
}
