import 'dart:ui';

import 'package:flutter/material.dart';

import '../core/config/app_config.dart';
import '../core/networking/api_client.dart';
import '../core/networking/http_client_factory.dart';
import '../core/storage/token_vault.dart';
import '../core/telemetry/telemetry.dart';
import '../features/authentication/auth_gateway.dart';
import '../features/authentication/auth_state.dart';
import '../features/pos/pos_access_gateway.dart';
import '../features/pos/pos_assistant_gateway.dart';
import '../features/pos/pos_auth_gateway.dart';
import '../features/pos/pos_branch_admin_gateway.dart';
import '../features/pos/pos_branch_consolidation_gateway.dart';
import '../features/pos/pos_brand_admin_gateway.dart';
import '../features/pos/pos_catalog_admin_gateway.dart';
import '../features/pos/pos_category_admin_gateway.dart';
import '../features/pos/pos_cash_gateway.dart';
import '../features/pos/pos_customers_gateway.dart';
import '../features/pos/pos_dashboard_gateway.dart';
import '../features/pos/pos_held_sales_gateway.dart';
import '../features/pos/pos_identity_admin_gateway.dart';
import '../features/pos/pos_inventory_admin_gateway.dart';
import '../features/pos/pos_loyalty_gateway.dart';
import '../features/pos/pos_memberships_gateway.dart';
import '../features/pos/pos_operational_areas_gateway.dart';
import '../features/pos/pos_parties_gateway.dart';
import '../features/pos/pos_payments_gateway.dart';
import '../features/pos/pos_people_gateway.dart';
import '../features/pos/pos_product_variants_gateway.dart';
import '../features/pos/pos_promotions_gateway.dart';
import '../features/pos/pos_purchase_orders_gateway.dart';
import '../features/pos/pos_purchasing_gateway.dart';
import '../features/pos/pos_read_gateway.dart';
import '../features/pos/pos_readiness_gateway.dart';
import '../features/pos/pos_refunds_gateway.dart';
import '../features/pos/pos_reports_gateway.dart';
import '../features/pos/pos_rewards_gateway.dart';
import '../features/pos/pos_sales_gateway.dart';
import '../features/pos/pos_settings_gateway.dart';
import '../features/pos/pos_suppliers_gateway.dart';
import 'app.dart';

void bootstrap() {
  WidgetsFlutterBinding.ensureInitialized();
  final config = AppConfig.fromEnvironment();
  final telemetry = SafeTelemetry(config.environment);
  FlutterError.onError = (details) {
    telemetry.recordFailure('flutter.framework', details.exception);
  };
  PlatformDispatcher.instance.onError = (error, stack) {
    telemetry.recordFailure('flutter.unhandled', error);
    return true;
  };
  telemetry.recordEvent('app.start');
  final vault = MemoryTokenVault();
  late final AuthController authController;
  final api = ApiClient(
    baseUrl: config.apiBaseUrl,
    transport: createPlatformHttpClient(),
    readAccessToken: () => vault.accessToken,
    createCorrelationId: () =>
        'one-${DateTime.now().toUtc().microsecondsSinceEpoch}',
  );
  final gateway = ApiAuthGateway(
    client: api,
    vault: vault,
    readCsrfToken: () => authController.csrfToken,
  );
  authController = AuthController(gateway, vault, telemetry);
  api.onUnauthorized = authController.refresh;
  runApp(
    AsOneApp(
      config: config,
      authController: authController,
      telemetry: telemetry,
      posReadGateway: ApiPosReadGateway(api),
      posSalesGateway: ApiPosSalesGateway(api),
      posPaymentsGateway: ApiPosPaymentsGateway(api),
      posCashGateway: ApiPosCashGateway(api),
      posRefundsGateway: ApiPosRefundsGateway(api),
      posPromotionsGateway: ApiPosPromotionsGateway(api),
      posCustomersGateway: ApiPosCustomersGateway(api),
      posMembershipsGateway: ApiPosMembershipsGateway(api),
      posLoyaltyGateway: ApiPosLoyaltyGateway(api),
      posRewardsGateway: ApiPosRewardsGateway(api),
      posPartiesGateway: ApiPosPartiesGateway(api),
      posHeldSalesGateway: ApiPosHeldSalesGateway(api),
      posPurchasingGateway: ApiPosPurchasingGateway(api),
      posPurchaseOrdersGateway: ApiPosPurchaseOrdersGateway(api),
      posSuppliersGateway: ApiPosSuppliersGateway(api),
      posReportsGateway: ApiPosReportsGateway(api),
      posAccessGateway: ApiPosAccessGateway(api),
      posEmployeesGateway: ApiPosEmployeesGateway(api),
      posSchedulesGateway: ApiPosSchedulesGateway(api),
      posTimeClockGateway: ApiPosTimeClockGateway(api),
      posPayrollGateway: ApiPosPayrollGateway(api),
      posDashboardGateway: ApiPosDashboardGateway(api),
      posSettingsGateway: ApiPosSettingsGateway(api),
      posProductVariantsGateway: ApiPosProductVariantsGateway(api),
      posAssistantGateway: ApiPosAssistantGateway(api),
      posAuthGateway: ApiPosAuthGateway(api),
      // TASK 15.1 Phase 2-4: real, backend-wired commercial admin UI.
      posIdentityAdminGateway: ApiPosIdentityAdminGateway(api),
      posInventoryAdminGateway: ApiPosInventoryAdminGateway(api),
      posCategoryAdminGateway: ApiPosCategoryAdminGateway(api),
      posBrandAdminGateway: ApiPosBrandAdminGateway(api),
      posCatalogAdminGateway: ApiPosCatalogAdminGateway(api),
      posBranchAdminGateway: ApiPosBranchAdminGateway(api),
      posBranchConsolidationGateway: ApiPosBranchConsolidationGateway(api),
      posOperationalAreasGateway: ApiPosOperationalAreasGateway(api),
      posReadinessGateway: ApiPosReadinessGateway(api),
    ),
  );
  authController.bootstrapSession();
}
