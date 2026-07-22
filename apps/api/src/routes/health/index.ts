import type { FastifyInstance } from 'fastify';

import type { ApiConfig } from '@asone/config';

import type { InfrastructureDependencies } from '../../infrastructure/dependencies.js';
import type { Observability } from '../../plugins/observability.js';

export interface HealthRouteOptions {
  readonly config: ApiConfig;
  readonly infrastructure: InfrastructureDependencies;
  readonly observability: Observability;
}

export function registerHealthRoutes(app: FastifyInstance, options: HealthRouteOptions): void {
  app.get(
    '/health',
    {
      config: { rateLimit: false },
      schema: {
        tags: ['technical'],
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'status', 'version'],
            properties: {
              name: { type: 'string' },
              status: { const: 'ok' },
              version: { type: 'string' },
            },
          },
        },
      },
    },
    () => ({ name: options.config.appName, status: 'ok', version: options.config.appVersion }),
  );

  app.get(
    '/live',
    {
      config: { rateLimit: false },
      schema: {
        tags: ['technical'],
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['status'],
            properties: { status: { const: 'alive' } },
          },
        },
      },
    },
    () => ({ status: 'alive' }),
  );

  app.get(
    '/ready',
    {
      config: { rateLimit: false },
      schema: {
        tags: ['technical'],
        response: {
          200: { type: 'object', additionalProperties: true },
          503: { type: 'object', additionalProperties: true },
        },
      },
    },
    async (_request, reply) => {
      const services = await options.infrastructure.checkReadiness();
      const ready = services.postgres === 'available' && services.redis === 'available';
      options.observability.readiness.set(
        { service: 'postgres' },
        services.postgres === 'available' ? 1 : 0,
      );
      options.observability.readiness.set(
        { service: 'redis' },
        services.redis === 'available' ? 1 : 0,
      );
      return reply.code(ready ? 200 : 503).send({
        services,
        status: ready ? 'ready' : 'not_ready',
      });
    },
  );
}
