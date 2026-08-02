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
import { ProductCatalogRepository } from '../modules/catalog/product-catalog.repository.js';
import { registerProductCatalogRoutes } from '../modules/catalog/product-catalog.routes.js';
import { ProductCatalogService } from '../modules/catalog/product-catalog.service.js';
import { registerProductOptionsRoutes } from '../modules/catalog/product-options.routes.js';
import { ProductOptionsService } from '../modules/catalog/product-options.service.js';
import {
  InventoryBalanceReadRepository,
  InventoryLocationRepository,
  InventoryMovementReadRepository,
} from '../modules/inventory/inventory.repository.js';
import { InventoryDraftRepository } from '../modules/inventory/inventory-drafts.repository.js';
import { registerInventoryDraftRoutes } from '../modules/inventory/inventory-drafts.routes.js';
import { InventoryDraftService } from '../modules/inventory/inventory-drafts.service.js';
import { InventoryPostingRepository } from '../modules/inventory/inventory-posting.repository.js';
import { registerInventoryPostingRoutes } from '../modules/inventory/inventory-posting.routes.js';
import { InventoryPostingService } from '../modules/inventory/inventory-posting.service.js';
import { InventoryReversalRepository } from '../modules/inventory/inventory-reversal.repository.js';
import { registerInventoryReversalRoutes } from '../modules/inventory/inventory-reversal.routes.js';
import { InventoryReversalService } from '../modules/inventory/inventory-reversal.service.js';
import { registerInventoryReconciliationRoutes } from '../modules/inventory/inventory-reconciliation.routes.js';
import { InventoryRepairRepository } from '../modules/inventory/inventory-repair.repository.js';
import { InventoryRepairService } from '../modules/inventory/inventory-repair.service.js';
import { InventoryTransferRepository } from '../modules/inventory/inventory-transfers.repository.js';
import { registerInventoryTransferRoutes } from '../modules/inventory/inventory-transfers.routes.js';
import { InventoryTransferService } from '../modules/inventory/inventory-transfers.service.js';
import { InventoryReservationRepository } from '../modules/inventory/reservation.repository.js';
import { registerInventoryReservationRoutes } from '../modules/inventory/reservation.routes.js';
import { InventoryReservationService } from '../modules/inventory/reservation.service.js';
import { InventoryCountRepository } from '../modules/inventory/inventory-counts.repository.js';
import { registerInventoryCountRoutes } from '../modules/inventory/inventory-counts.routes.js';
import { InventoryCountService } from '../modules/inventory/inventory-counts.service.js';
import { registerInventoryRoutes } from '../modules/inventory/inventory.routes.js';
import {
  InventoryBalanceReadService,
  InventoryLocationService,
  InventoryMovementReadService,
} from '../modules/inventory/inventory.service.js';
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
      registerProductCatalogRoutes(
        app,
        authentication,
        new ProductCatalogService(new ProductCatalogRepository(options.infrastructure.database)),
      );
      registerProductOptionsRoutes(
        app,
        authentication,
        new ProductOptionsService(new ProductCatalogRepository(options.infrastructure.database)),
      );
      registerInventoryRoutes(
        app,
        authentication,
        new InventoryLocationService(
          new InventoryLocationRepository(options.infrastructure.database),
        ),
        new InventoryBalanceReadService(
          new InventoryBalanceReadRepository(options.infrastructure.database),
        ),
        new InventoryMovementReadService(
          new InventoryMovementReadRepository(options.infrastructure.database),
        ),
      );
      registerInventoryDraftRoutes(
        app,
        authentication,
        new InventoryDraftService(new InventoryDraftRepository(options.infrastructure.database)),
      );
      registerInventoryPostingRoutes(
        app,
        authentication,
        new InventoryPostingService(
          new InventoryPostingRepository(options.infrastructure.database),
        ),
      );
      registerInventoryReversalRoutes(
        app,
        authentication,
        new InventoryReversalService(
          new InventoryReversalRepository(options.infrastructure.database),
        ),
      );
      registerInventoryTransferRoutes(
        app,
        authentication,
        new InventoryTransferService(
          new InventoryTransferRepository(options.infrastructure.database),
        ),
      );
      registerInventoryReservationRoutes(
        app,
        authentication,
        new InventoryReservationService(
          new InventoryReservationRepository(options.infrastructure.database),
        ),
      );
      registerInventoryCountRoutes(
        app,
        authentication,
        new InventoryCountService(new InventoryCountRepository(options.infrastructure.database)),
      );
      registerInventoryReconciliationRoutes(
        app,
        authentication,
        new InventoryRepairService(new InventoryRepairRepository(options.infrastructure.database)),
      );
    }
  }
  if (options.config.nodeEnv === 'test') registerTestOnlyRoutes(app);
}
