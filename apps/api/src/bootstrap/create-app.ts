import Fastify, { type FastifyBaseLogger, type FastifyInstance, LogController } from 'fastify';

import type { ApiConfig } from '@asone/config';

import type { InfrastructureDependencies } from '../infrastructure/dependencies.js';
import type { AuthRepository } from '../modules/auth/auth.types.js';
import { registerPlugins } from './register-plugins.js';

export interface CreateAppOptions {
  readonly config: ApiConfig;
  readonly infrastructure: InfrastructureDependencies;
  readonly logger: FastifyBaseLogger;
  readonly authRepository?: AuthRepository;
}

export async function createApp(options: CreateAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: options.config.requestBodyLimitBytes,
    keepAliveTimeout: options.config.keepAliveTimeoutMs,
    logController: new LogController({ disableRequestLogging: true }),
    loggerInstance: options.logger,
    onConstructorPoisoning: 'error',
    onProtoPoisoning: 'error',
    requestTimeout: options.config.requestTimeoutMs,
    routerOptions: { maxParamLength: 256 },
    trustProxy: options.config.trustProxy,
  });
  await registerPlugins(app, options);
  await app.ready();
  return app;
}
