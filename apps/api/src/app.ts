import Fastify, { type FastifyBaseLogger, type FastifyInstance, LogController } from 'fastify';

import type { ApiConfig } from '@asone/config';

import type { InfrastructureDependencies } from './infrastructure/dependencies.js';
import { registerHealthRoutes } from './routes/health.js';

export interface BuildAppOptions {
  readonly config: ApiConfig;
  readonly infrastructure: InfrastructureDependencies;
  readonly logger: FastifyBaseLogger;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: 1_048_576,
    logController: new LogController({ disableRequestLogging: true }),
    loggerInstance: options.logger,
    trustProxy: false,
  });

  registerHealthRoutes(app, {
    appName: options.config.appName,
    appVersion: options.config.appVersion,
    infrastructure: options.infrastructure,
  });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error({ err: error }, 'request failed');
    void reply.code(500).send({
      error: { code: 'internal_error', message: 'An unexpected error occurred.' },
    });
  });

  await app.ready();

  return app;
}
