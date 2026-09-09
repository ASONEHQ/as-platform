import 'package:flutter/material.dart';

import '../core/config/app_config.dart';
import '../core/telemetry/telemetry.dart';
import '../design_system/theme/as_theme.dart';
import '../features/authentication/auth_state.dart';
import '../features/pos/pos_access_gateway.dart';
import '../features/pos/pos_assistant_gateway.dart';
import '../features/pos/pos_auth_gateway.dart';
import '../features/pos/pos_branch_admin_gateway.dart';
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
import '../features/pos/pos_parties_gateway.dart';
import '../features/pos/pos_payments_gateway.dart';
import '../features/pos/pos_people_gateway.dart';
import '../features/pos/pos_product_variants_gateway.dart';
import '../features/pos/pos_promotions_gateway.dart';
import '../features/pos/pos_purchasing_gateway.dart';
import '../features/pos/pos_read_gateway.dart';
import '../features/pos/pos_refunds_gateway.dart';
import '../features/pos/pos_reports_gateway.dart';
import '../features/pos/pos_rewards_gateway.dart';
import '../features/pos/pos_sales_gateway.dart';
import '../features/pos/pos_settings_gateway.dart';
import '../features/pos/pos_suppliers_gateway.dart';
import 'router.dart';

class AsOneApp extends StatefulWidget {
  const AsOneApp({
    required this.config,
    required this.authController,
    required this.telemetry,
    this.posReadGateway = const EmptyPosReadGateway(),
    this.posSalesGateway = const EmptyPosSalesGateway(),
    this.posPaymentsGateway = const EmptyPosPaymentsGateway(),
    this.posCashGateway = const EmptyPosCashGateway(),
    this.posRefundsGateway = const EmptyPosRefundsGateway(),
    this.posPromotionsGateway = const EmptyPosPromotionsGateway(),
    this.posCustomersGateway = const EmptyPosCustomersGateway(),
    this.posMembershipsGateway = const EmptyPosMembershipsGateway(),
    this.posLoyaltyGateway = const EmptyPosLoyaltyGateway(),
    this.posRewardsGateway = const EmptyPosRewardsGateway(),
    this.posPartiesGateway = const EmptyPosPartiesGateway(),
    this.posHeldSalesGateway = const EmptyPosHeldSalesGateway(),
    this.posPurchasingGateway = const EmptyPosPurchasingGateway(),
    this.posSuppliersGateway = const EmptyPosSuppliersGateway(),
    this.posReportsGateway = const EmptyPosReportsGateway(),
    this.posAccessGateway = const EmptyPosAccessGateway(),
    this.posEmployeesGateway = const EmptyPosEmployeesGateway(),
    this.posSchedulesGateway = const EmptyPosSchedulesGateway(),
    this.posTimeClockGateway = const EmptyPosTimeClockGateway(),
    this.posPayrollGateway = const EmptyPosPayrollGateway(),
    this.posDashboardGateway = const EmptyPosDashboardGateway(),
    this.posSettingsGateway = const EmptyPosSettingsGateway(),
    this.posProductVariantsGateway = const EmptyPosProductVariantsGateway(),
    this.posAssistantGateway = const EmptyPosAssistantGateway(),
    this.posAuthGateway = const EmptyPosAuthGateway(),
    // TASK 15.1 Phase 2-4: real, backend-wired commercial admin UI.
    this.posIdentityAdminGateway = const EmptyPosIdentityAdminGateway(),
    this.posInventoryAdminGateway = const EmptyPosInventoryAdminGateway(),
    this.posCategoryAdminGateway = const EmptyPosCategoryAdminGateway(),
    this.posBrandAdminGateway = const EmptyPosBrandAdminGateway(),
    this.posCatalogAdminGateway = const EmptyPosCatalogAdminGateway(),
    this.posBranchAdminGateway = const EmptyPosBranchAdminGateway(),
    super.key,
  });

  final AppConfig config;
  final AuthController authController;
  final Telemetry telemetry;
  final PosReadGateway posReadGateway;
  final PosSalesGateway posSalesGateway;
  final PosPaymentsGateway posPaymentsGateway;
  final PosCashGateway posCashGateway;
  // TASK 12.8: refund request/completion/history — see
  // `pos_refunds_gateway.dart` and ADR-0015.
  final PosRefundsGateway posRefundsGateway;
  // TASK 12.9: pricing-quote preview plus promotions/coupons admin
  // management — see `pos_promotions_gateway.dart` and ADR-0016.
  final PosPromotionsGateway posPromotionsGateway;
  // TASK 13.0: customer identity, membership plans/entitlements, and AS
  // Rewards+ loyalty — see `pos_customers_gateway.dart`/
  // `pos_memberships_gateway.dart`/`pos_loyalty_gateway.dart` and
  // ADR-0017.
  final PosCustomersGateway posCustomersGateway;
  final PosMembershipsGateway posMembershipsGateway;
  final PosLoyaltyGateway posLoyaltyGateway;
  // TASK 13.1: reward entitlements/redemption, layered on the TASK 13.0
  // foundation above — see `pos_rewards_gateway.dart` and ADR-0018.
  final PosRewardsGateway posRewardsGateway;
  // TASK 14.3 Wave 1 Part A: "Fiestas" (party reservations) — rooms,
  // packages, reservations, Cotizador, snacks/socks, payments, contract/
  // waiver documents — see `pos_parties_gateway.dart` and
  // `docs/LEGACY_FIESTAS_RECOVERY.md`.
  final PosPartiesGateway posPartiesGateway;
  // TASK 14.3 Wave 1 Part B.1: suspend/list/resume/link-sale/discard a
  // held-sale cart — see `pos_held_sales_gateway.dart`.
  final PosHeldSalesGateway posHeldSalesGateway;
  // TASK 14.3 Wave 1 Part C: direct purchase / quick restock — see
  // `pos_purchasing_gateway.dart`.
  final PosPurchasingGateway posPurchasingGateway;
  // TASK 14.4 (Wave 2, Part C.1): real supplier directory — see
  // `pos_suppliers_gateway.dart`.
  final PosSuppliersGateway posSuppliersGateway;
  // TASK 14.4 (Wave 2, Part D): Report Center — see
  // `pos_reports_gateway.dart`.
  final PosReportsGateway posReportsGateway;
  // TASK 14.4 (Wave 2, Part E): Control de Acceso — see
  // `pos_access_gateway.dart`.
  final PosAccessGateway posAccessGateway;
  // TASK 14.4 (Wave 2, Part B): Empleados/Horarios/Checador/Nómina — see
  // `pos_people_gateway.dart`.
  final PosEmployeesGateway posEmployeesGateway;
  final PosSchedulesGateway posSchedulesGateway;
  final PosTimeClockGateway posTimeClockGateway;
  final PosPayrollGateway posPayrollGateway;
  // TASK 14.5 (Wave 3, Phase 2): Dashboard ("today at a glance") — see
  // `pos_dashboard_gateway.dart`.
  final PosDashboardGateway posDashboardGateway;
  // TASK 14.5 (Wave 3, Phase 8): per-tenant receipt header/footer
  // branding — see `pos_settings_gateway.dart`.
  final PosSettingsGateway posSettingsGateway;
  // TASK 14.5 (Wave 3, Phase 7, Item 3): product variants admin — see
  // `pos_product_variants_gateway.dart`.
  final PosProductVariantsGateway posProductVariantsGateway;
  // TASK 14.5 (Wave 3, Phase 7, Item 6): real deterministic FAQ
  // assistant — see `pos_assistant_gateway.dart`.
  final PosAssistantGateway posAssistantGateway;
  final PosAuthGateway posAuthGateway;
  // TASK 15.1 Phase 2-4: real, backend-wired commercial admin UI —
  // users/roles/permissions, inventory admin, catalog admin depth,
  // branch admin — see `pos_shell.dart`'s own field doc comment.
  final PosIdentityAdminGateway posIdentityAdminGateway;
  final PosInventoryAdminGateway posInventoryAdminGateway;
  final PosCategoryAdminGateway posCategoryAdminGateway;
  final PosBrandAdminGateway posBrandAdminGateway;
  final PosCatalogAdminGateway posCatalogAdminGateway;
  final PosBranchAdminGateway posBranchAdminGateway;

  @override
  State<AsOneApp> createState() => _AsOneAppState();
}

class _AsOneAppState extends State<AsOneApp> {
  late final router = createRouter(
    widget.authController,
    widget.telemetry,
    environment: widget.config.environment,
  );

  @override
  Widget build(BuildContext context) => MaterialApp.router(
    title: widget.config.appName,
    debugShowCheckedModeBanner: false,
    theme: AsTheme.light(),
    routerConfig: router,
    builder: (context, child) => PlatformScope(
      posReadGateway: widget.posReadGateway,
      posSalesGateway: widget.posSalesGateway,
      posPaymentsGateway: widget.posPaymentsGateway,
      posCashGateway: widget.posCashGateway,
      posRefundsGateway: widget.posRefundsGateway,
      posPromotionsGateway: widget.posPromotionsGateway,
      posCustomersGateway: widget.posCustomersGateway,
      posMembershipsGateway: widget.posMembershipsGateway,
      posLoyaltyGateway: widget.posLoyaltyGateway,
      posRewardsGateway: widget.posRewardsGateway,
      posPartiesGateway: widget.posPartiesGateway,
      posHeldSalesGateway: widget.posHeldSalesGateway,
      posPurchasingGateway: widget.posPurchasingGateway,
      posSuppliersGateway: widget.posSuppliersGateway,
      posReportsGateway: widget.posReportsGateway,
      posAccessGateway: widget.posAccessGateway,
      posEmployeesGateway: widget.posEmployeesGateway,
      posSchedulesGateway: widget.posSchedulesGateway,
      posTimeClockGateway: widget.posTimeClockGateway,
      posPayrollGateway: widget.posPayrollGateway,
      posDashboardGateway: widget.posDashboardGateway,
      posSettingsGateway: widget.posSettingsGateway,
      posProductVariantsGateway: widget.posProductVariantsGateway,
      posAssistantGateway: widget.posAssistantGateway,
      posAuthGateway: widget.posAuthGateway,
      posIdentityAdminGateway: widget.posIdentityAdminGateway,
      posInventoryAdminGateway: widget.posInventoryAdminGateway,
      posCategoryAdminGateway: widget.posCategoryAdminGateway,
      posBrandAdminGateway: widget.posBrandAdminGateway,
      posCatalogAdminGateway: widget.posCatalogAdminGateway,
      posBranchAdminGateway: widget.posBranchAdminGateway,
      environment: widget.config.environment,
      child: AuthScope(
        controller: widget.authController,
        child: child ?? const SizedBox.shrink(),
      ),
    ),
  );
}

class PlatformScope extends InheritedWidget {
  const PlatformScope({
    required this.posReadGateway,
    this.posSalesGateway = const EmptyPosSalesGateway(),
    this.posPaymentsGateway = const EmptyPosPaymentsGateway(),
    this.posCashGateway = const EmptyPosCashGateway(),
    this.posRefundsGateway = const EmptyPosRefundsGateway(),
    this.posPromotionsGateway = const EmptyPosPromotionsGateway(),
    this.posCustomersGateway = const EmptyPosCustomersGateway(),
    this.posMembershipsGateway = const EmptyPosMembershipsGateway(),
    this.posLoyaltyGateway = const EmptyPosLoyaltyGateway(),
    this.posRewardsGateway = const EmptyPosRewardsGateway(),
    this.posPartiesGateway = const EmptyPosPartiesGateway(),
    this.posHeldSalesGateway = const EmptyPosHeldSalesGateway(),
    this.posPurchasingGateway = const EmptyPosPurchasingGateway(),
    this.posSuppliersGateway = const EmptyPosSuppliersGateway(),
    this.posReportsGateway = const EmptyPosReportsGateway(),
    this.posAccessGateway = const EmptyPosAccessGateway(),
    this.posEmployeesGateway = const EmptyPosEmployeesGateway(),
    this.posSchedulesGateway = const EmptyPosSchedulesGateway(),
    this.posTimeClockGateway = const EmptyPosTimeClockGateway(),
    this.posPayrollGateway = const EmptyPosPayrollGateway(),
    this.posDashboardGateway = const EmptyPosDashboardGateway(),
    this.posSettingsGateway = const EmptyPosSettingsGateway(),
    this.posProductVariantsGateway = const EmptyPosProductVariantsGateway(),
    this.posAssistantGateway = const EmptyPosAssistantGateway(),
    this.posAuthGateway = const EmptyPosAuthGateway(),
    this.posIdentityAdminGateway = const EmptyPosIdentityAdminGateway(),
    this.posInventoryAdminGateway = const EmptyPosInventoryAdminGateway(),
    this.posCategoryAdminGateway = const EmptyPosCategoryAdminGateway(),
    this.posBrandAdminGateway = const EmptyPosBrandAdminGateway(),
    this.posCatalogAdminGateway = const EmptyPosCatalogAdminGateway(),
    this.posBranchAdminGateway = const EmptyPosBranchAdminGateway(),
    this.environment = AsEnvironment.production,
    required super.child,
    super.key,
  });

  final PosReadGateway posReadGateway;

  /// TASK 12.4A.1: the one write path the POS ticket has today — creating
  /// a real, backend-priced sale. See `pos_sales_gateway.dart`.
  final PosSalesGateway posSalesGateway;

  /// TASK 12.4B.1: terminal discovery, card_terminal payment creation,
  /// and payment-status polling — see `pos_payments_gateway.dart`. Never
  /// a path to Mercado Pago itself.
  final PosPaymentsGateway posPaymentsGateway;

  /// TASK 12.7: cash register/session/movement/close/summary/history — see
  /// `pos_cash_gateway.dart` and ADR-0014.
  final PosCashGateway posCashGateway;

  /// TASK 12.8: refund request/completion/history — see
  /// `pos_refunds_gateway.dart` and ADR-0015.
  final PosRefundsGateway posRefundsGateway;

  /// TASK 12.9: pricing-quote preview plus promotions/coupons admin
  /// management — see `pos_promotions_gateway.dart` and ADR-0016.
  final PosPromotionsGateway posPromotionsGateway;

  /// TASK 13.0: customer identity (search/create/edit/QR) — see
  /// `pos_customers_gateway.dart` and ADR-0017.
  final PosCustomersGateway posCustomersGateway;

  /// TASK 13.0: membership plan admin plus per-customer issued
  /// memberships — see `pos_memberships_gateway.dart` and ADR-0017.
  final PosMembershipsGateway posMembershipsGateway;

  /// TASK 13.0: AS Rewards+ loyalty programs/balances/ledger — see
  /// `pos_loyalty_gateway.dart` and ADR-0017.
  final PosLoyaltyGateway posLoyaltyGateway;

  /// TASK 13.1: reward entitlement list/redeem/manual-issue/revoke — see
  /// `pos_rewards_gateway.dart` and ADR-0018.
  final PosRewardsGateway posRewardsGateway;

  /// TASK 14.3 Wave 1 Part A: "Fiestas" (party reservations) — see
  /// `pos_parties_gateway.dart` and `docs/LEGACY_FIESTAS_RECOVERY.md`.
  final PosPartiesGateway posPartiesGateway;

  /// TASK 14.3 Wave 1 Part B.1: suspend/list/resume/link-sale/discard a
  /// held-sale cart — see `pos_held_sales_gateway.dart`.
  final PosHeldSalesGateway posHeldSalesGateway;

  /// TASK 14.3 Wave 1 Part C: direct purchase / quick restock — see
  /// `pos_purchasing_gateway.dart`.
  final PosPurchasingGateway posPurchasingGateway;

  /// TASK 14.4 (Wave 2, Part C.1): real supplier directory — see
  /// `pos_suppliers_gateway.dart`.
  final PosSuppliersGateway posSuppliersGateway;

  /// TASK 14.4 (Wave 2, Part D): Report Center — see
  /// `pos_reports_gateway.dart`.
  final PosReportsGateway posReportsGateway;

  /// TASK 14.4 (Wave 2, Part E): Control de Acceso — see
  /// `pos_access_gateway.dart`.
  final PosAccessGateway posAccessGateway;

  /// TASK 14.4 (Wave 2, Part B): Empleados/Horarios/Checador/Nómina — see
  /// `pos_people_gateway.dart`.
  final PosEmployeesGateway posEmployeesGateway;
  final PosSchedulesGateway posSchedulesGateway;
  final PosTimeClockGateway posTimeClockGateway;
  final PosPayrollGateway posPayrollGateway;

  /// TASK 14.5 (Wave 3, Phase 2): Dashboard ("today at a glance") — see
  /// `pos_dashboard_gateway.dart`.
  final PosDashboardGateway posDashboardGateway;

  /// TASK 14.5 (Wave 3, Phase 8): per-tenant receipt header/footer
  /// branding — see `pos_settings_gateway.dart`.
  final PosSettingsGateway posSettingsGateway;

  /// TASK 14.5 (Wave 3, Phase 7, Item 3): product variants admin — see
  /// `pos_product_variants_gateway.dart`.
  final PosProductVariantsGateway posProductVariantsGateway;

  /// TASK 14.5 (Wave 3, Phase 7, Item 6): real deterministic FAQ
  /// assistant — see `pos_assistant_gateway.dart`.
  final PosAssistantGateway posAssistantGateway;
  final PosAuthGateway posAuthGateway;

  // TASK 15.1 Phase 2-4: real, backend-wired commercial admin UI — see
  // `AsOneApp`'s own field doc comment.
  final PosIdentityAdminGateway posIdentityAdminGateway;
  final PosInventoryAdminGateway posInventoryAdminGateway;
  final PosCategoryAdminGateway posCategoryAdminGateway;
  final PosBrandAdminGateway posBrandAdminGateway;
  final PosCatalogAdminGateway posCatalogAdminGateway;
  final PosBranchAdminGateway posBranchAdminGateway;

  /// Threaded through so pre-authenticated screens (e.g. the login
  /// screen's TASK 12.2F first-run-wizard preview link) can gate
  /// dev-only affordances without a real activation/licensing contract.
  final AsEnvironment environment;

  static PlatformScope of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<PlatformScope>();
    assert(scope != null, 'PlatformScope is missing.');
    return scope!;
  }

  @override
  bool updateShouldNotify(PlatformScope oldWidget) =>
      posReadGateway != oldWidget.posReadGateway ||
      posSalesGateway != oldWidget.posSalesGateway ||
      posPaymentsGateway != oldWidget.posPaymentsGateway ||
      posCashGateway != oldWidget.posCashGateway ||
      posRefundsGateway != oldWidget.posRefundsGateway ||
      posPromotionsGateway != oldWidget.posPromotionsGateway ||
      posCustomersGateway != oldWidget.posCustomersGateway ||
      posMembershipsGateway != oldWidget.posMembershipsGateway ||
      posLoyaltyGateway != oldWidget.posLoyaltyGateway ||
      posRewardsGateway != oldWidget.posRewardsGateway ||
      posPartiesGateway != oldWidget.posPartiesGateway ||
      posHeldSalesGateway != oldWidget.posHeldSalesGateway ||
      posPurchasingGateway != oldWidget.posPurchasingGateway ||
      posSuppliersGateway != oldWidget.posSuppliersGateway ||
      posReportsGateway != oldWidget.posReportsGateway ||
      posAccessGateway != oldWidget.posAccessGateway ||
      posEmployeesGateway != oldWidget.posEmployeesGateway ||
      posSchedulesGateway != oldWidget.posSchedulesGateway ||
      posTimeClockGateway != oldWidget.posTimeClockGateway ||
      posPayrollGateway != oldWidget.posPayrollGateway ||
      posDashboardGateway != oldWidget.posDashboardGateway ||
      posSettingsGateway != oldWidget.posSettingsGateway ||
      posProductVariantsGateway != oldWidget.posProductVariantsGateway ||
      posAssistantGateway != oldWidget.posAssistantGateway ||
      posAuthGateway != oldWidget.posAuthGateway ||
      posIdentityAdminGateway != oldWidget.posIdentityAdminGateway ||
      posInventoryAdminGateway != oldWidget.posInventoryAdminGateway ||
      posCategoryAdminGateway != oldWidget.posCategoryAdminGateway ||
      posBrandAdminGateway != oldWidget.posBrandAdminGateway ||
      posCatalogAdminGateway != oldWidget.posCatalogAdminGateway ||
      posBranchAdminGateway != oldWidget.posBranchAdminGateway ||
      environment != oldWidget.environment;
}

class AuthScope extends InheritedNotifier<AuthController> {
  const AuthScope({
    required AuthController controller,
    required super.child,
    super.key,
  }) : super(notifier: controller);

  static AuthController of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<AuthScope>();
    assert(scope != null, 'AuthScope is missing.');
    return scope!.notifier!;
  }
}
