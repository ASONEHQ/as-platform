// TASK 17.4.2 §3-§9/§23 — shell-level coverage for the real Configuración
// workspace: a settings center organizing Negocio/Ticket/Hardware/Fiestas
// around already-implemented, backend-wired screens
// (`PosBrandingScreen`/`PosReceiptBrandingScreen`/`PosPrinterSettingsScreen`/
// `_FiestasAjustes`) — never a second branding form, receipt/printer
// persistence path, or party-configuration model.
library;

import 'package:as_one/app/app.dart' show PlatformScope;
import 'package:as_one/features/authentication/auth_models.dart';
import 'package:as_one/features/pos/pos_cash_gateway.dart';
import 'package:as_one/features/pos/pos_customers_gateway.dart';
import 'package:as_one/features/pos/pos_loyalty_gateway.dart';
import 'package:as_one/features/pos/pos_memberships_gateway.dart';
import 'package:as_one/features/pos/pos_navigation.dart';
import 'package:as_one/features/pos/pos_parties_gateway.dart';
import 'package:as_one/features/pos/pos_payments_gateway.dart';
import 'package:as_one/features/pos/pos_promotions_gateway.dart';
import 'package:as_one/features/pos/pos_read_controller.dart';
import 'package:as_one/features/pos/pos_read_gateway.dart';
import 'package:as_one/features/pos/pos_readiness_gateway.dart';
import 'package:as_one/features/pos/pos_refunds_gateway.dart';
import 'package:as_one/features/pos/pos_rewards_gateway.dart';
import 'package:as_one/features/pos/pos_sales_gateway.dart';
import 'package:as_one/features/pos/pos_shell.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Configuración is gated by company_settings.read, matching the 3 screens it now organizes', () {
    expect(PosModule.configuration.requiredAnyPermission, ['company_settings.read']);
    expect(posModuleVisibleFor(PosModule.configuration, const ['company_settings.read']), isTrue);
    expect(posModuleVisibleFor(PosModule.configuration, const ['branch.read']), isFalse);
    expect(PosModule.configuration.implementedReadOnly, isTrue);
  });

  testWidgets('an actor with company_settings.read sees Configuración, opens it on Negocio by default', (
    tester,
  ) async {
    await _pump(tester, permissions: const ['company_settings.read']);

    await tester.tap(find.byKey(const Key('nav-group-Sistema')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('nav-configuration')), findsOneWidget);
    await tester.tap(find.byKey(const Key('nav-configuration')));
    await tester.pumpAndSettle();

    expect(find.text('Coming soon'), findsNothing);
    expect(find.byKey(const Key('pos-configuration-sections')), findsOneWidget);
    // Negocio is the default section — the real branding screen's own
    // header is visible, not a placeholder.
    expect(find.text('Logo del negocio'), findsOneWidget);
  });

  testWidgets('Ticket section embeds the real PosReceiptBrandingScreen verbatim', (tester) async {
    await _pump(tester, permissions: const ['company_settings.read']);
    await _openConfiguration(tester);

    await tester.tap(find.byKey(const Key('pos-configuration-section-ticket')));
    await tester.pumpAndSettle();

    expect(find.text('Marca del ticket'), findsOneWidget);
  });

  testWidgets('Hardware section embeds the real PosPrinterSettingsScreen verbatim', (tester) async {
    await _pump(tester, permissions: const ['company_settings.read']);
    await _openConfiguration(tester);

    await tester.tap(find.byKey(const Key('pos-configuration-section-hardware')));
    await tester.pumpAndSettle();

    expect(find.text('Impresora de Tickets'), findsOneWidget);
  });

  testWidgets('Fiestas section embeds the real party-configuration surface (Salones/Paquetes/Términos)', (
    tester,
  ) async {
    await _pump(tester, permissions: const ['company_settings.read']);
    await _openConfiguration(tester);

    await tester.tap(find.byKey(const Key('pos-configuration-section-fiestas')));
    await tester.pumpAndSettle();

    final tabs = find.byKey(const Key('pos-fiestas-ajustes-tabs'));
    expect(tabs, findsOneWidget);
    expect(find.descendant(of: tabs, matching: find.text('Salones')), findsOneWidget);
    expect(find.descendant(of: tabs, matching: find.text('Paquetes')), findsOneWidget);
    expect(find.descendant(of: tabs, matching: find.text('Términos legales')), findsOneWidget);
  });

  testWidgets('an actor without company_settings.read does not see Configuración in the sidebar', (tester) async {
    await _pump(tester, permissions: const ['branch.read']);

    await tester.tap(find.byKey(const Key('nav-group-Sistema')), warnIfMissed: false);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('nav-configuration')), findsNothing);
  });

  testWidgets('Estado del sistema keeps its own real destination, distinct from Configuración', (tester) async {
    await _pump(tester, permissions: const ['company_settings.read', 'branch.read']);

    await tester.tap(find.byKey(const Key('nav-group-Sistema')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('nav-settings')), findsOneWidget);
    expect(find.byKey(const Key('nav-configuration')), findsOneWidget);

    await tester.tap(find.byKey(const Key('nav-settings')));
    await tester.pumpAndSettle();
    expect(find.text('Estado del sistema'), findsOneWidget);
    expect(find.text('Configuración'), findsNothing);
  });

  testWidgets('TASK 17.4.2 §20 — at 390x844 the section selector wraps instead of overflowing', (tester) async {
    await _pump(tester, permissions: const ['company_settings.read'], size: const Size(390, 844));

    await tester.tap(find.byKey(const Key('pos-hamburger')));
    await tester.pumpAndSettle();
    await _openConfiguration(tester);

    expect(find.byKey(const Key('pos-configuration-sections')), findsOneWidget);
    expect(find.text('Negocio'), findsOneWidget);
    expect(find.text('Ticket'), findsOneWidget);
    expect(find.text('Hardware'), findsOneWidget);
    expect(find.text('Fiestas'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}

Future<void> _openConfiguration(WidgetTester tester) async {
  await tester.tap(find.byKey(const Key('nav-group-Sistema')));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(const Key('nav-configuration')));
  await tester.pumpAndSettle();
}

Future<void> _pump(
  WidgetTester tester, {
  required List<String> permissions,
  Size size = const Size(1440, 900),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    PlatformScope(
      posReadGateway: const EmptyPosReadGateway(),
      child: MaterialApp(
        home: PosShell(
          context: _context(permissions),
          controller: PosReadController(const EmptyPosReadGateway()),
          salesGateway: const EmptyPosSalesGateway(),
          paymentsGateway: const EmptyPosPaymentsGateway(),
          cashGateway: const EmptyPosCashGateway(),
          refundsGateway: const EmptyPosRefundsGateway(),
          promotionsGateway: const EmptyPosPromotionsGateway(),
          customersGateway: const EmptyPosCustomersGateway(),
          membershipsGateway: const EmptyPosMembershipsGateway(),
          loyaltyGateway: const EmptyPosLoyaltyGateway(),
          rewardsGateway: const EmptyPosRewardsGateway(),
          partiesGateway: const EmptyPosPartiesGateway(),
          readinessGateway: const _FakeReadinessGateway(),
          onLogout: () {},
          onBranchSelected: (_) async {},
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

class _FakeReadinessGateway implements PosReadinessGateway {
  const _FakeReadinessGateway();

  @override
  Future<PosTenantReadiness> readiness({String? branchId}) => Future.error(StateError('not configured for this test'));
}

AuthenticatedContext _context(List<String> permissions) => AuthenticatedContext(
  session: SessionContext(
    id: 'session-id',
    userId: 'user-id',
    companyId: 'company-id',
    branchId: 'branch-id',
    permittedBranchIds: const ['branch-id'],
    companyWideAccess: true,
    expiresAt: DateTime.utc(2099),
  ),
  user: const UserSummary(id: 'user-id', displayName: 'Usuario QA', email: 'user@example.test'),
  companies: const [CompanySummary(id: 'company-id', name: 'Empresa Generica QA', current: true, currencyCode: 'USD')],
  branches: const [
    BranchSummary(id: 'branch-id', code: 'QA1', name: 'Sucursal QA', timezone: 'UTC', current: true),
  ],
  companyWideAccess: true,
  permissions: permissions,
);
