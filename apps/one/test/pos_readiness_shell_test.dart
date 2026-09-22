// TASK 16.17 — shell-level coverage: "Configuración" is now a real module
// gated by `branch.read`, opens the readiness screen, and its fix-it buttons
// switch the shell to the target module (running that module's normal data
// load).
library;

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
import 'package:as_one/features/pos/pos_readiness_presentation.dart';
import 'package:as_one/features/pos/pos_refunds_gateway.dart';
import 'package:as_one/features/pos/pos_rewards_gateway.dart';
import 'package:as_one/features/pos/pos_sales_gateway.dart';
import 'package:as_one/features/pos/pos_shell.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Configuración is gated by branch.read, not company_settings.read', () {
    expect(PosModule.settings.requiredAnyPermission, ['branch.read']);
    expect(posModuleVisibleFor(PosModule.settings, const ['branch.read']), isTrue);
    expect(posModuleVisibleFor(PosModule.settings, const ['company_settings.read']), isFalse);
    expect(PosModule.settings.implementedReadOnly, isTrue);
    // Billing stays an unimplemented placeholder.
    expect(PosModule.billing.implementedReadOnly, isFalse);
  });

  testWidgets('an actor with branch.read sees Configuración, opens it and a CTA switches module', (tester) async {
    final gateway = _FakeReadinessGateway();
    await _pump(tester, gateway: gateway, permissions: const ['branch.read', 'catalog.read']);

    await tester.tap(find.byKey(const Key('nav-group-Sistema')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('nav-settings')), findsOneWidget);
    await tester.tap(find.byKey(const Key('nav-settings')));
    await tester.pumpAndSettle();

    expect(gateway.calls, 1);
    expect(find.text('Coming soon'), findsNothing);
    expect(find.byKey(const Key('pos-readiness-refresh')), findsOneWidget);
    expect(find.byKey(const Key('pos-readiness-banner-pending')), findsOneWidget);
    expect(find.byKey(const Key('pos-readiness-row-catalog_products')), findsOneWidget);

    final cta = find.byKey(const Key('pos-readiness-cta-catalog_products'));
    await tester.ensureVisible(cta);
    await tester.tap(cta);
    await tester.pumpAndSettle();

    // The shell switched to Productos: the readiness screen is gone and the
    // products screen is on screen.
    expect(find.byKey(const Key('pos-readiness-refresh')), findsNothing);
    expect(find.byKey(const Key('pos-product-search')), findsOneWidget);
  });

  testWidgets('an actor without branch.read does not see Configuración in the sidebar', (tester) async {
    final gateway = _FakeReadinessGateway();
    await _pump(tester, gateway: gateway, permissions: const ['catalog.read', 'company_settings.read']);

    await tester.tap(find.byKey(const Key('nav-group-Sistema')), warnIfMissed: false);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('nav-settings')), findsNothing);
    expect(gateway.calls, 0);
  });
}

class _FakeReadinessGateway implements PosReadinessGateway {
  int calls = 0;

  @override
  Future<PosTenantReadiness> readiness({String? branchId}) async {
    calls++;
    return const PosTenantReadiness(
      evaluatedAt: '2026-09-21T10:00:00.000Z',
      companyId: 'company-id',
      companyName: 'Empresa Generica QA',
      currencyCode: 'USD',
      timezone: 'UTC',
      administrationReady: true,
      companyChecks: [],
      branches: [
        PosBranchReadiness(
          branchId: 'branch-id',
          code: 'QA1',
          name: 'Sucursal QA',
          checks: [
            PosReadinessCheck(
              code: 'catalog_products',
              scope: 'branch',
              required: true,
              status: PosReadinessStatus.missing,
              surface: 'catalog',
              count: 0,
              items: [],
            ),
          ],
          stages: [
            PosReadinessStage(key: 'administration', ready: true, blockedBy: []),
            PosReadinessStage(key: 'sale', ready: false, blockedBy: ['catalog_products']),
          ],
        ),
      ],
    );
  }
}

Future<void> _pump(
  WidgetTester tester, {
  required PosReadinessGateway gateway,
  required List<String> permissions,
}) async {
  tester.view.physicalSize = const Size(1440, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
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
        readinessGateway: gateway,
        onLogout: () {},
        onBranchSelected: (_) async {},
      ),
    ),
  );
  await tester.pumpAndSettle();
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
