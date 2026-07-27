import type { FastifyInstance } from 'fastify';

import type { ApiConfig } from '@asone/config';

import type { InfrastructureDependencies } from '../infrastructure/dependencies.js';
import { hashPassword } from '../modules/auth/auth.passwords.js';
import { PostgresAuthRepository } from '../modules/auth/auth.repository.js';
import { registerAuthRoutes } from '../modules/auth/auth.routes.js';
import { AuthService } from '../modules/auth/auth.service.js';
import { AuthTokens } from '../modules/auth/auth.tokens.js';
import type { AuthRepository } from '../modules/auth/auth.types.js';
import { CatalogRepository } from '../modules/catalog/catalog.repository.js';
import { registerCatalogRoutes } from '../modules/catalog/catalog.routes.js';
import { CatalogService } from '../modules/catalog/catalog.service.js';
import { registerAdministrationRoutes } from '../modules/admin/admin.routes.js';
import { AdminRepository } from '../modules/admin/shared/admin.repository.js';
import { AdministrationService } from '../modules/admin/shared/admin.service.js';
import { SettingsRepository } from '../modules/admin/settings/settings.repository.js';
import { SettingsService } from '../modules/admin/settings/settings.service.js';
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
    const authentication = new AuthService({
      repository: authRepository,
      tokens,
      dummyPasswordHash: await hashPassword('constant-time-dummy-password'),
      accessTokenTtlSeconds: options.config.authAccessTokenTtlSeconds,
      refreshTokenTtlSeconds: options.config.authRefreshTokenTtlSeconds,
    });
    registerAuthRoutes(app, authentication, options.config);
    if (options.infrastructure.database !== undefined) {
      registerAdministrationRoutes(
        app,
        authentication,
        new AdministrationService(
          new AdminRepository(options.infrastructure.database),
          authentication,
        ),
        new SettingsService(new SettingsRepository(options.infrastructure.database)),
      );
      registerCatalogRoutes(
        app,
        authentication,
        new CatalogService(new CatalogRepository(options.infrastructure.database)),
      );
    }
  }
  if (options.config.nodeEnv === 'test') registerTestOnlyRoutes(app);
}
