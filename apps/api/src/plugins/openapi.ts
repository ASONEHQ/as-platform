import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';

import type { ApiConfig } from '@asone/config';

import { errorResponseSchema } from '../schemas/errors.js';

export async function registerOpenApi(app: FastifyInstance, config: ApiConfig): Promise<void> {
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'AS ONE API',
        version: config.appVersion,
        description: 'Technical foundation for the AS ONE multi-tenant platform API.',
      },
      ...(config.nodeEnv === 'development'
        ? { servers: [{ url: `http://${config.apiHost}:${String(config.apiPort)}` }] }
        : {}),
      tags: [{ name: 'technical', description: 'Health and API foundation endpoints.' }],
    },
  });
  app.addSchema(errorResponseSchema);

  if (config.openapiUiEnabled) {
    await app.register(swaggerUi, {
      routePrefix: '/documentation',
      uiConfig: { docExpansion: 'list', deepLinking: false },
      staticCSP: true,
    });
  }
}
