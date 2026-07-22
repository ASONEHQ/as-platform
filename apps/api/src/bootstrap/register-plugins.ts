import type { FastifyInstance } from 'fastify';

import type { ApiConfig } from '@asone/config';

import type { InfrastructureDependencies } from '../infrastructure/dependencies.js';
import { hashPassword } from '../modules/auth/auth.passwords.js';
import { PostgresAuthRepository } from '../modules/auth/auth.repository.js';
import { registerAuthRoutes } from '../modules/auth/auth.routes.js';
import { AuthService } from '../modules/auth/auth.service.js';
import { AuthTokens } from '../modules/auth/auth.tokens.js';
import type { AuthRepository } from '../modules/auth/auth.types.js';
import { registerErrorHandler } from '../plugins/error-handler.js';
import { createObservability, registerObservability } from '../plugins/observability.js';
import { registerOpenApi } from '../plugins/openapi.js';
import { registerRequestContext } from '../plugins/request-context.js';
import { registerSecurity } from '../plugins/security.js';
import { registerApiV1Routes } from '../routes/api/v1/index.js';
import { registerHealthRoutes } from '../routes/health/index.js';
import { registerTestOnlyRoutes } from '../routes/test-only.js';

export interface RegisterPluginsOptions {
  readonly config: ApiConfig;
  readonly infrastructure: InfrastructureDependencies;
  readonly authRepository?: AuthRepository;
}

export async function registerPlugins(
  app: FastifyInstance,
  options: RegisterPluginsOptions,
): Promise<void> {
  const observability = createObservability();
  registerRequestContext(app);
  registerObservability(app, observability, options.config.metricsEnabled);
  await registerSecurity(app, options.config);
  await registerOpenApi(app, options.config);
  registerErrorHandler(app, observability);
  registerHealthRoutes(app, { ...options, observability });
  registerApiV1Routes(app, options.config);
  const authRepository =
    options.authRepository ??
    (options.infrastructure.database === undefined
      ? undefined
      : new PostgresAuthRepository(options.infrastructure.database));
  if (authRepository !== undefined) {
    const tokens = new AuthTokens({
      audience: options.config.authJwtAudience,
      issuer: options.config.authJwtIssuer,
      secret: options.config.authAccessTokenSecret,
      ttlSeconds: options.config.authAccessTokenTtlSeconds,
    });
    registerAuthRoutes(
      app,
      new AuthService({
        repository: authRepository,
        tokens,
        dummyPasswordHash: await hashPassword('constant-time-dummy-password'),
        accessTokenTtlSeconds: options.config.authAccessTokenTtlSeconds,
        refreshTokenTtlSeconds: options.config.authRefreshTokenTtlSeconds,
      }),
      options.config,
    );
  }
  if (options.config.nodeEnv === 'test') registerTestOnlyRoutes(app);
}
