import type { FastifyInstance } from 'fastify';

import type { ApiConfig } from '@asone/config';

import type { InfrastructureDependencies } from '../infrastructure/dependencies.js';
import { hashPassword } from '../modules/auth/auth.passwords.js';
import { PostgresAuthRepository } from '../modules/auth/auth.repository.js';
import { registerAuthRoutes } from '../modules/auth/auth.routes.js';
import { AuthService } from '../modules/auth/auth.service.js';
import { AuthTokens } from '../modules/auth/auth.tokens.js';
import type { AuthRepository } from '../modules/auth/auth.types.js';
import { CashRepository } from '../modules/cash/cash.repository.js';
import { registerCashRoutes } from '../modules/cash/cash.routes.js';
import { CashService } from '../modules/cash/cash.service.js';
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
import { CustomersRepository } from '../modules/customers/customers.repository.js';
import { registerCustomerRoutes } from '../modules/customers/customers.routes.js';
import { CustomersService } from '../modules/customers/customers.service.js';
import { LoyaltyRepository } from '../modules/loyalty/loyalty.repository.js';
import { registerLoyaltyRoutes } from '../modules/loyalty/loyalty.routes.js';
import { LoyaltyService } from '../modules/loyalty/loyalty.service.js';
import { MembershipsRepository } from '../modules/memberships/memberships.repository.js';
import { registerMembershipRoutes } from '../modules/memberships/memberships.routes.js';
import { MembershipsService } from '../modules/memberships/memberships.service.js';
import { PaymentRepository } from '../modules/payments/payments.repository.js';
import { registerPaymentRoutes } from '../modules/payments/payments.routes.js';
import { PaymentService } from '../modules/payments/payments.service.js';
import { MercadoPagoClient } from '../modules/payments/providers/mercado-pago.client.js';
import { MercadoPagoPointProvider } from '../modules/payments/providers/mercado-pago.provider.js';
import { registerMercadoPagoWebhookRoutes } from '../modules/payments/providers/mercado-pago.webhook.routes.js';
import { RewardsRepository } from '../modules/rewards/rewards.repository.js';
import { registerRewardRoutes } from '../modules/rewards/rewards.routes.js';
import { RewardsService } from '../modules/rewards/rewards.service.js';
import { PromotionsRepository } from '../modules/promotions/promotions.repository.js';
import { registerPromotionRoutes } from '../modules/promotions/promotions.routes.js';
import { PromotionsService } from '../modules/promotions/promotions.service.js';
import { RefundsRepository } from '../modules/refunds/refunds.repository.js';
import { registerRefundRoutes } from '../modules/refunds/refunds.routes.js';
import { RefundsService } from '../modules/refunds/refunds.service.js';
import { SalesRepository } from '../modules/sales/sales.repository.js';
import { registerSaleRoutes } from '../modules/sales/sales.routes.js';
import { SalesService } from '../modules/sales/sales.service.js';
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
      const salesRepository = new SalesRepository(options.infrastructure.database);
      // TASK 12.9: constructed before `salesService` — real sale
      // creation independently re-evaluates promotions/coupons/manual
      // discounts through the exact same pricing engine the standalone
      // quote endpoint uses (never trusts a client-submitted quote —
      // see ADR-0016), so `SalesService` needs this repository directly.
      const promotionsRepository = new PromotionsRepository(options.infrastructure.database);
      const promotionsService = new PromotionsService(promotionsRepository);
      // TASK 13.0: constructed before `salesService` too — `createSale`
      // resolves/validates an optional `customer_id` (Part G) through
      // this repository directly, the same cross-module shape
      // `promotionsRepository` above already established.
      const customersRepository = new CustomersRepository(options.infrastructure.database);
      const customersService = new CustomersService(customersRepository);
      const salesService = new SalesService(salesRepository, promotionsRepository, customersRepository);
      const paymentRepository = new PaymentRepository(options.infrastructure.database);
      // TASK 12.7: constructed before `paymentService` — a cash payment
      // confirmation now requires it (open-session enforcement + drawer
      // movement posting, see ADR-0014).
      const cashRepository = new CashRepository(options.infrastructure.database);
      const cashService = new CashService(cashRepository);
      // TASK 13.0: constructed before `paymentService` — membership
      // activation and loyalty earning happen inside the SAME
      // transaction `SalesRepository.trySettleSale` uses to newly settle
      // a Sale (see `PaymentService.applyPostSettlementHooks` and
      // ADR-0017 "Activation boundary"/"Automatic earning").
      const membershipsRepository = new MembershipsRepository(options.infrastructure.database);
      const membershipsService = new MembershipsService(membershipsRepository);
      const loyaltyRepository = new LoyaltyRepository(options.infrastructure.database);
      const loyaltyService = new LoyaltyService(loyaltyRepository);
      // TASK 13.1: constructed before `paymentService` too — automatic
      // reward-entitlement issuance evaluates threshold-crossing inside
      // the SAME transaction `loyaltyService.earnFromSale` just ran in
      // (see `PaymentService.applyPostSettlementHooks` and ADR-0018
      // "Issuance transaction boundary"). Depends on `loyaltyRepository`
      // (read-only, cross-module) and `customersRepository` (Part Q —
      // redemption checks the customer is still active).
      const rewardsRepository = new RewardsRepository(options.infrastructure.database);
      const rewardsService = new RewardsService(rewardsRepository, loyaltyRepository, customersRepository);
      // TASK 12.4B.1: constructed unconditionally, even with no
      // MERCADO_PAGO_ACCESS_TOKEN set — see MercadoPagoClient's own doc
      // comment for why this is the correct "fail safely" boundary.
      const mercadoPagoClient = new MercadoPagoClient({
        accessToken: options.config.mercadoPagoAccessToken,
        apiBaseUrl: options.config.mercadoPagoApiBaseUrl,
        logger: app.log,
      });
      const mercadoPagoProvider = new MercadoPagoPointProvider(mercadoPagoClient);
      const paymentService = new PaymentService(
        paymentRepository,
        salesRepository,
        mercadoPagoProvider,
        cashRepository,
        membershipsService,
        loyaltyService,
        rewardsService,
      );
      // TASK 12.8: constructed after payments/cash — a refund completion
      // reverses the original payment and, for a cash refund, posts to
      // the *current* open session (see ADR-0015), so it needs both
      // repositories already built, plus the same Mercado Pago provider
      // instance the payment side uses (never a second, separately
      // configured one).
      const refundsRepository = new RefundsRepository(options.infrastructure.database);
      const refundsService = new RefundsService(
        refundsRepository,
        paymentRepository,
        cashRepository,
        mercadoPagoProvider,
      );
      // TASK 12.5B: the receipt route (`GET /sales/{id}/receipt`) composes
      // a sale with its payments, so `registerSaleRoutes` now needs
      // `paymentService` too — constructed above, this call is therefore
      // moved after it (was previously registered right after
      // `salesService`, before payments existed at all).
      registerSaleRoutes(app, authentication, salesService, paymentService);
      registerPaymentRoutes(app, authentication, paymentService, salesService);
      registerCashRoutes(app, authentication, cashService);
      registerRefundRoutes(app, authentication, refundsService);
      registerPromotionRoutes(app, authentication, promotionsService);
      registerCustomerRoutes(app, authentication, customersService);
      registerMembershipRoutes(app, authentication, membershipsService);
      registerLoyaltyRoutes(app, authentication, loyaltyService);
      registerRewardRoutes(app, authentication, rewardsService);
      registerMercadoPagoWebhookRoutes(app, {
        paymentService,
        mercadoPagoProvider,
        webhookSecret: options.config.mercadoPagoWebhookSecret,
      });
    }
  }
  if (options.config.nodeEnv === 'test') registerTestOnlyRoutes(app);
}
