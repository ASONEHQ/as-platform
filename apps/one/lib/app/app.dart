import 'package:flutter/material.dart';

import '../core/config/app_config.dart';
import '../core/telemetry/telemetry.dart';
import '../design_system/theme/as_theme.dart';
import '../features/authentication/auth_state.dart';
import '../features/pos/pos_cash_gateway.dart';
import '../features/pos/pos_customers_gateway.dart';
import '../features/pos/pos_loyalty_gateway.dart';
import '../features/pos/pos_memberships_gateway.dart';
import '../features/pos/pos_payments_gateway.dart';
import '../features/pos/pos_promotions_gateway.dart';
import '../features/pos/pos_read_gateway.dart';
import '../features/pos/pos_refunds_gateway.dart';
import '../features/pos/pos_sales_gateway.dart';
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
