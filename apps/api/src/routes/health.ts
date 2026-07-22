import type { FastifyInstance } from 'fastify';

import type { InfrastructureDependencies } from '../infrastructure/dependencies.js';

export interface HealthRouteOptions {
  readonly appName: string;
  readonly appVersion: string;
  readonly infrastructure: InfrastructureDependencies;
}

export function registerHealthRoutes(app: FastifyInstance, options: HealthRouteOptions): void {
  app.get('/health', () => ({
    name: options.appName,
    status: 'ok',
    version: options.appVersion,
  }));

  app.get('/live', () => ({ status: 'alive' }));

  app.get('/ready', async (_request, reply) => {
    const services = await options.infrastructure.checkReadiness();
    const ready = services.postgres === 'available' && services.redis === 'available';

    return reply.code(ready ? 200 : 503).send({
      services,
      status: ready ? 'ready' : 'not_ready',
    });
  });
}
