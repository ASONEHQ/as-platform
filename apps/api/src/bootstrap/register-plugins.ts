import fastifyMultipart from '@fastify/multipart';
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
import { OperationalAreasRepository } from '../modules/operational-areas/operational-areas.repository.js';
import { registerOperationalAreaRoutes } from '../modules/operational-areas/operational-areas.routes.js';
import { OperationalAreasService } from '../modules/operational-areas/operational-areas.service.js';
import { BranchConsolidationService } from '../modules/branch-consolidation/branch-consolidation.service.js';
import { registerBranchConsolidationRoutes } from '../modules/branch-consolidation/branch-consolidation.routes.js';
import { ReadinessRepository } from '../modules/readiness/readiness.repository.js';
import { registerReadinessRoutes } from '../modules/readiness/readiness.routes.js';
import { ReadinessService } from '../modules/readiness/readiness.service.js';
import { CatalogRepository } from '../modules/catalog/catalog.repository.js';
import { registerCatalogRoutes } from '../modules/catalog/catalog.routes.js';
import { CatalogService } from '../modules/catalog/catalog.service.js';
import { ProductCatalogRepository } from '../modules/catalog/product-catalog.repository.js';
import { registerProductCatalogRoutes } from '../modules/catalog/product-catalog.routes.js';
import { ProductCatalogService } from '../modules/catalog/product-catalog.service.js';
import {
  ProductImageStorage,
  productImageStorageConfigFromEnv,
} from '../modules/catalog/product-images.storage.js';
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
import { HeldSaleCartsRepository } from '../modules/held-sales/held-sales.repository.js';
import { registerHeldSaleCartRoutes } from '../modules/held-sales/held-sales.routes.js';
import { HeldSaleCartsService } from '../modules/held-sales/held-sales.service.js';
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
import { PartiesRepository } from '../modules/parties/parties.repository.js';
import { registerPartyRoomRoutes } from '../modules/parties/party-rooms.routes.js';
import { PartyRoomsService } from '../modules/parties/party-rooms.service.js';
import { registerPartyPackageRoutes } from '../modules/parties/party-packages.routes.js';
import { PartyPackagesService } from '../modules/parties/party-packages.service.js';
import { registerPartyReservationRoutes } from '../modules/parties/party-reservations.routes.js';
import { PartyReservationsService } from '../modules/parties/party-reservations.service.js';
import { PurchasingRepository } from '../modules/purchasing/purchasing.repository.js';
import { registerPurchasingRoutes } from '../modules/purchasing/purchasing.routes.js';
import { PurchasingService } from '../modules/purchasing/purchasing.service.js';
import { PurchaseOrdersRepository } from '../modules/purchasing/purchase-orders.repository.js';
import { registerPurchaseOrdersRoutes } from '../modules/purchasing/purchase-orders.routes.js';
import { PurchaseOrdersService } from '../modules/purchasing/purchase-orders.service.js';
import { SuppliersRepository } from '../modules/suppliers/suppliers.repository.js';
import { registerSupplierRoutes } from '../modules/suppliers/suppliers.routes.js';
import { SuppliersService } from '../modules/suppliers/suppliers.service.js';
import { AccessRepository } from '../modules/access/access.repository.js';
import { registerAccessRoutes } from '../modules/access/access.routes.js';
import { AccessService } from '../modules/access/access.service.js';
import { ReportsRepository } from '../modules/reports/reports.repository.js';
import { registerReportsRoutes } from '../modules/reports/reports.routes.js';
import { ReportsService } from '../modules/reports/reports.service.js';
import { DashboardRepository } from '../modules/dashboard/dashboard.repository.js';
import { registerDashboardRoutes } from '../modules/dashboard/dashboard.routes.js';
import { DashboardService } from '../modules/dashboard/dashboard.service.js';
import { AssistantRepository } from '../modules/assistant/assistant.repository.js';
import { registerAssistantRoutes } from '../modules/assistant/assistant.routes.js';
import { AssistantService } from '../modules/assistant/assistant.service.js';
import { PeopleRepository } from '../modules/people/people.repository.js';
import { registerEmployeeRoutes } from '../modules/people/employees.routes.js';
import { EmployeesService } from '../modules/people/employees.service.js';
import { registerScheduleRoutes } from '../modules/people/schedules.routes.js';
import { SchedulesService } from '../modules/people/schedules.service.js';
import { registerTimeClockRoutes } from '../modules/people/time-clock.routes.js';
import { TimeClockService } from '../modules/people/time-clock.service.js';
import { registerPayrollRoutes } from '../modules/people/payroll.routes.js';
import { PayrollService } from '../modules/people/payroll.service.js';
import { RefundsRepository } from '../modules/refunds/refunds.repository.js';
import { registerRefundRoutes } from '../modules/refunds/refunds.routes.js';
import { RefundsService } from '../modules/refunds/refunds.service.js';
import { SalesRepository } from '../modules/sales/sales.repository.js';
import { registerSaleRoutes } from '../modules/sales/sales.routes.js';
import { SalesService } from '../modules/sales/sales.service.js';
import { registerAdministrationRoutes } from '../modules/admin/admin.routes.js';
import { registerBrandingRoutes } from '../modules/admin/branding/branding.routes.js';
import { BrandingService } from '../modules/admin/branding/branding.service.js';
import {
  BrandingObjectStorage,
  brandingStorageConfigFromEnv,
} from '../modules/admin/branding/branding.storage.js';
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
  // TASK 14.5A: registered globally (like every other transport plugin in
  // this function) but never widens the app-wide body-size default --
  // `branding.routes.ts`'s own upload route sets a route-level `bodyLimit`
  // override for its real, bounded (2MB) logo cap; every other route is
  // unaffected and still governed by `REQUEST_BODY_LIMIT_BYTES`.
  await app.register(fastifyMultipart, { attachFieldsToBody: false });
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
      // TASK 14.5A: only registered when the SAME `MINIO_*` env vars
      // `compose.yaml`/`.env.example` already provision are actually
      // present -- mirrors this codebase's own established pattern for an
      // optional external dependency (see `MERCADO_PAGO_ACCESS_TOKEN` in
      // `.env.example`: "the app boots fine and the ...-specific path
      // fails cleanly and explicitly when actually invoked instead").
      // Here that means the two branding routes are simply absent (a real
      // 404) rather than the whole app failing to boot.
      const brandingStorageConfig = brandingStorageConfigFromEnv();
      if (brandingStorageConfig !== undefined) {
        registerBrandingRoutes(
          app,
          authentication,
          new BrandingService(
            new SettingsService(new SettingsRepository(options.infrastructure.database)),
            new BrandingObjectStorage(brandingStorageConfig),
          ),
        );
      }
      registerCatalogRoutes(
        app,
        authentication,
        new CatalogService(new CatalogRepository(options.infrastructure.database)),
      );
      // TASK 16.6 — reuses the exact same optional-external-dependency
      // pattern as `brandingStorageConfig` just above: when the
      // `MINIO_*` env vars are present, product images get real object
      // storage AND the two upload/delete routes; otherwise the routes
      // are absent (a real 404) and every other product-catalog route
      // still works normally.
      const productImageStorageConfig = productImageStorageConfigFromEnv();
      const productImageStorage =
        productImageStorageConfig === undefined
          ? undefined
          : new ProductImageStorage(productImageStorageConfig);
      registerProductCatalogRoutes(
        app,
        authentication,
        new ProductCatalogService(
          new ProductCatalogRepository(options.infrastructure.database),
          productImageStorage,
        ),
        productImageStorage,
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
      // TASK 12.2 — named const: `PurchasingService.reverseDirectPurchase`
      // (`POST /api/v1/direct-purchases/:id/reverse`, registered further
      // below) reuses this SAME instance directly, never a
      // second/duplicate one.
      const inventoryReversalService = new InventoryReversalService(
        new InventoryReversalRepository(options.infrastructure.database),
      );
      registerInventoryReversalRoutes(app, authentication, inventoryReversalService);
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
      // TASK 13.0: constructed before `promotionsService`/`salesService`
      // — both now resolve/validate a `customer_id` (Part G) through
      // this repository directly.
      const customersRepository = new CustomersRepository(options.infrastructure.database);
      const customersService = new CustomersService(customersRepository);
      // TASK 13.1: constructed before `rewardsService`, which needs it
      // to read a program's reward config (ADR-0018).
      const loyaltyRepository = new LoyaltyRepository(options.infrastructure.database);
      const loyaltyService = new LoyaltyService(loyaltyRepository);
      // TASK 13.2: constructed before `promotionsService`/`salesService`
      // now too — `evaluatePricing`'s new reward-benefit step (ADR-0019)
      // needs `RewardsService.resolveCheckoutBenefit` to preview/re-
      // validate an attached entitlement, and `PaymentService`'s own
      // settlement hook (below) needs `consumeAppliedUsagesForSale`.
      // Depends on `loyaltyRepository` (read-only, cross-module) and
      // `customersRepository` (Part Q — redemption checks the customer
      // is still active).
      const rewardsRepository = new RewardsRepository(options.infrastructure.database);
      const rewardsService = new RewardsService(
        rewardsRepository,
        loyaltyRepository,
        customersRepository,
      );
      // TASK 13.0/16.21: constructed before `promotionsService`/
      // `salesService` — `MembershipsService.resolveCheckoutBenefit` is
      // now a real pricing input for both the standalone quote endpoint
      // and real sale creation (ADR-0020 "Membership pricing
      // placement"), the identical reasoning `rewardsService` above
      // already established. Also still needed, unchanged, by
      // `paymentService` below for the settlement-time activation hook
      // (ADR-0017 "Activation boundary").
      const membershipsRepository = new MembershipsRepository(options.infrastructure.database);
      const membershipsService = new MembershipsService(membershipsRepository);
      // TASK 12.9: constructed before `salesService` — real sale
      // creation independently re-evaluates promotions/coupons/manual
      // discounts/reward+membership benefit through the exact same
      // pricing engine the standalone quote endpoint uses (never trusts
      // a client-submitted quote — see ADR-0016/ADR-0019/ADR-0020), so
      // `SalesService` needs this repository directly. `promotionsService`
      // itself now also takes `rewardsService`/`membershipsService` for
      // the quote endpoint's own benefit previews.
      const promotionsRepository = new PromotionsRepository(options.infrastructure.database);
      const promotionsService = new PromotionsService(promotionsRepository, rewardsService, membershipsService);
      const salesService = new SalesService(
        salesRepository,
        promotionsRepository,
        customersRepository,
        rewardsService,
        membershipsService,
      );
      const paymentRepository = new PaymentRepository(options.infrastructure.database);
      // TASK 12.7: constructed before `paymentService` — a cash payment
      // confirmation now requires it (open-session enforcement + drawer
      // movement posting, see ADR-0014).
      const cashRepository = new CashRepository(options.infrastructure.database);
      const cashService = new CashService(cashRepository);
      const operationalAreasRepository = new OperationalAreasRepository(options.infrastructure.database);
      const operationalAreasService = new OperationalAreasService(operationalAreasRepository);
      const branchConsolidationService = new BranchConsolidationService(
        cashRepository,
        cashService,
        operationalAreasRepository,
      );
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
      // TASK 16.21 (Phase 37) — `loyaltyService`/`rewardsService` as the
      // 5th/6th args: a completed FULL refund reverses that sale's own
      // loyalty earn + any reward entitlement it caused to newly cross a
      // threshold (never a partial refund — see `RefundsService.
      // completeRefund`'s own doc comment). Both are already constructed
      // above for `paymentService`; reused here, never a second instance.
      const refundsService = new RefundsService(
        refundsRepository,
        paymentRepository,
        cashRepository,
        mercadoPagoProvider,
        loyaltyService,
        rewardsService,
      );
      // TASK 12.5B: the receipt route (`GET /sales/{id}/receipt`) composes
      // a sale with its payments, so `registerSaleRoutes` now needs
      // `paymentService` too — constructed above, this call is therefore
      // moved after it (was previously registered right after
      // `salesService`, before payments existed at all).
      registerSaleRoutes(app, authentication, salesService, paymentService);
      registerPaymentRoutes(app, authentication, paymentService, salesService);
      registerCashRoutes(app, authentication, cashService);
      registerOperationalAreaRoutes(app, authentication, operationalAreasService);
      registerBranchConsolidationRoutes(app, authentication, branchConsolidationService);
      registerReadinessRoutes(app, authentication, new ReadinessService(new ReadinessRepository(options.infrastructure.database)));
      // TASK 14.3 (Wave 1, Part B.1) — constructed after `salesRepository`
      // (already built above): `linkSale`'s optional existence check
      // reads through it directly, never a second/duplicate sales
      // repository instance.
      registerHeldSaleCartRoutes(
        app,
        authentication,
        new HeldSaleCartsService(
          new HeldSaleCartsRepository(options.infrastructure.database),
          salesRepository,
        ),
      );
      registerRefundRoutes(app, authentication, refundsService);
      // TASK 14.4 (Wave 2, Part C.1) — real supplier records, company-
      // scoped only. Constructed before purchasing so the same repository
      // instance can be handed to `PurchasingService` for its optional
      // real-supplier linkage below (never a second, duplicate instance).
      const suppliersRepository = new SuppliersRepository(options.infrastructure.database);
      registerSupplierRoutes(app, authentication, new SuppliersService(suppliersRepository));
      // TASK 14.3 (Wave 1, Part C) — "Compra Directa": a thin commercial
      // record alongside a real `receipt` inventory movement, posted via
      // `postDirectPurchaseReceipt` (see `purchasing.service.ts`).
      // TASK 14.4 (Wave 2, Part C.2) — extended with an optional real
      // `supplierId` link, resolved/frozen through `suppliersRepository`
      // above.
      registerPurchasingRoutes(
        app,
        authentication,
        new PurchasingService(
          new PurchasingRepository(options.infrastructure.database),
          suppliersRepository,
          // TASK 12.2 — reused directly for `POST /api/v1/direct-purchases/
          // :id/reverse` (see `inventoryReversalService`'s own comment
          // above, and `PurchasingService.reverseDirectPurchase`).
          inventoryReversalService,
        ),
      );
      // TASK 12.2 — the formal Purchase Order workflow, alongside "Compra
      // Directa" above. Reuses the same `suppliersRepository` instance for
      // its own optional real-supplier linkage.
      registerPurchaseOrdersRoutes(
        app,
        authentication,
        new PurchaseOrdersService(
          new PurchaseOrdersRepository(options.infrastructure.database),
          suppliersRepository,
        ),
      );
      registerPromotionRoutes(app, authentication, promotionsService);
      // TASK 14.3 (Wave 1, Part A) — Fiestas/party reservations. Reuses
      // the already-built `cashRepository` directly (never a second
      // instance) — `PartyReservationsService.recordPayment` posts its
      // cash-in movement through it inside its OWN transaction, exactly
      // like `RefundsService` already does for a refund's drawer
      // movement (see that service's own doc comment).
      const partiesRepository = new PartiesRepository(options.infrastructure.database);
      // TASK 14.5 (Wave 3, Phase 2): both stored in named consts — the
      // Dashboard module below reuses these SAME instances directly
      // (never a second/duplicate one).
      const partyRoomsService = new PartyRoomsService(partiesRepository);
      const partyReservationsService = new PartyReservationsService(
        partiesRepository,
        cashRepository,
      );
      registerPartyRoomRoutes(app, authentication, partyRoomsService);
      registerPartyPackageRoutes(app, authentication, new PartyPackagesService(partiesRepository));
      registerPartyReservationRoutes(app, authentication, partyReservationsService);
      registerCustomerRoutes(app, authentication, customersService);
      registerMembershipRoutes(app, authentication, membershipsService);
      registerLoyaltyRoutes(app, authentication, loyaltyService);
      registerRewardRoutes(app, authentication, rewardsService);
      registerMercadoPagoWebhookRoutes(app, {
        paymentService,
        mercadoPagoProvider,
        webhookSecret: options.config.mercadoPagoWebhookSecret,
      });
      // TASK 14.4 (Wave 2, Part B) — People (Employees/Schedules/
      // Time-Clock/Payroll). One shared repository across all four
      // sub-resource route/service pairs, mirroring the `parties`
      // module's own established multi-sub-resource shape.
      const peopleRepository = new PeopleRepository(options.infrastructure.database);
      registerEmployeeRoutes(app, authentication, new EmployeesService(peopleRepository));
      registerScheduleRoutes(app, authentication, new SchedulesService(peopleRepository));
      registerTimeClockRoutes(app, authentication, new TimeClockService(peopleRepository));
      registerPayrollRoutes(app, authentication, new PayrollService(peopleRepository));
      // TASK 14.4 (Wave 2, Part E) — Access/Occupancy: a real replacement
      // for the legacy's fake ticket scanner. Reuses the already-built
      // `salesRepository` directly (never a second instance) — a
      // credential can only ever be issued against a real, already-paid
      // sale.
      registerAccessRoutes(
        app,
        authentication,
        new AccessService(new AccessRepository(options.infrastructure.database), salesRepository),
      );
      // TASK 14.4 (Wave 2, Part D) — Business Intelligence/Reports. A
      // read-only aggregation layer over the platform's own authoritative
      // tables (including the real cash ledger, via the same
      // `cashMovementDirection` fold `CashService.summary()` uses) — no
      // dependency on any other module's constructed instance.
      const reportsService = new ReportsService(
        new ReportsRepository(options.infrastructure.database),
      );
      registerReportsRoutes(app, authentication, reportsService);
      // TASK 14.5 (Wave 3, Phase 2) — Dashboard ("today at a glance").
      // A thin aggregation over already-constructed Wave 1/2 service
      // instances (`reportsService`/`cashService`/`partyReservationsService`/
      // `partyRoomsService` — every one reused directly, never a second
      // instance) plus `DashboardRepository`'s own two genuinely new
      // aggregate queries (outstanding party balances, currently-clocked-
      // in employee count) that no existing endpoint already exposes.
      registerDashboardRoutes(
        app,
        authentication,
        new DashboardService(
          new DashboardRepository(options.infrastructure.database),
          reportsService,
          cashService,
          partyReservationsService,
          partyRoomsService,
        ),
      );
      // TASK 14.5 (Wave 3, Phase 7, Item 6) — a faithful, real port of the
      // legacy's own local keyword/regex FAQ bot (never an LLM/external
      // call) — answers are always derived from real, live queries over
      // the platform's own authoritative tables, never a canned string.
      // Gated by authentication only (read-only, non-sensitive, already
      // scoped to the actor's own company/branch access).
      registerAssistantRoutes(
        app,
        authentication,
        new AssistantService(new AssistantRepository(options.infrastructure.database)),
      );
    }
  }
  if (options.config.nodeEnv === 'test') registerTestOnlyRoutes(app);
}
