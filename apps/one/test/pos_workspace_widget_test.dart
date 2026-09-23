// TASK 16.16 — widget-level coverage for the parts of this task that only
// manifest once real widgets are built/rebuilt: sidebar visibility
// filtering (Phase 5), the zero-eligible-register honest empty state, and
// a stale selected register actually clearing across a widget rebuild.
// `pos_workspace_test.dart` covers the pure resolver/check functions this
// file drives through real `PosShell` instances — mirrors that file's own
// "pure logic first, then a widget-level check where reachable" split the
// task's own brief asks for.
import 'package:as_one/app/app.dart' show PlatformScope;
import 'package:as_one/features/authentication/auth_models.dart';
import 'package:as_one/features/pos/pos_access_gateway.dart';
import 'package:as_one/features/pos/pos_assistant_gateway.dart';
import 'package:as_one/features/pos/pos_auth_gateway.dart';
import 'package:as_one/features/pos/pos_branch_admin_gateway.dart';
import 'package:as_one/features/pos/pos_branch_consolidation_gateway.dart';
import 'package:as_one/features/pos/pos_brand_admin_gateway.dart';
import 'package:as_one/features/pos/pos_catalog_admin_gateway.dart';
import 'package:as_one/features/pos/pos_category_admin_gateway.dart';
import 'package:as_one/features/pos/pos_cash_gateway.dart';
import 'package:as_one/features/pos/pos_customers_gateway.dart';
import 'package:as_one/features/pos/pos_dashboard_gateway.dart';
import 'package:as_one/features/pos/pos_held_sales_gateway.dart';
import 'package:as_one/features/pos/pos_identity_admin_gateway.dart';
import 'package:as_one/features/pos/pos_inventory_admin_gateway.dart' hide PosInventoryBalance;
import 'package:as_one/features/pos/pos_loyalty_gateway.dart';
import 'package:as_one/features/pos/pos_memberships_gateway.dart';
import 'package:as_one/features/pos/pos_navigation.dart';
import 'package:as_one/features/pos/pos_operational_areas_gateway.dart';
import 'package:as_one/features/pos/pos_parties_gateway.dart';
import 'package:as_one/features/pos/pos_people_gateway.dart';
import 'package:as_one/features/pos/pos_payments_gateway.dart';
import 'package:as_one/features/pos/pos_product_variants_gateway.dart';
import 'package:as_one/features/pos/pos_promotions_gateway.dart';
import 'package:as_one/features/pos/pos_purchase_orders_gateway.dart';
import 'package:as_one/features/pos/pos_purchasing_gateway.dart';
import 'package:as_one/features/pos/pos_read_controller.dart';
import 'package:as_one/features/pos/pos_read_gateway.dart';
import 'package:as_one/features/pos/pos_refunds_gateway.dart';
import 'package:as_one/features/pos/pos_reports_gateway.dart';
import 'package:as_one/features/pos/pos_rewards_gateway.dart';
import 'package:as_one/features/pos/pos_sales_gateway.dart';
import 'package:as_one/features/pos/pos_settings_gateway.dart';
import 'package:as_one/features/pos/pos_shell.dart';
import 'package:as_one/features/pos/pos_suppliers_gateway.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('Sidebar visibility filtering (TASK 16.16 Phase 5)', () {
    testWidgets('a restricted actor only sees sidebar modules matching their own permissions', (tester) async {
      // Only `catalog.read` — no `sale.create`, no `supplier.read`, no
      // `user.read`, etc. Lands on Dashboard by default (no operational
      // permission at all), so "Administración" starts open — every other
      // group must be opened explicitly to inspect it.
      await _pump(
        tester,
        context: _contextWithPermissions(const ['catalog.read']),
      );

      await tester.tap(find.byKey(const Key('nav-group-Catálogo')));
      await tester.pumpAndSettle();
      // Every `catalog.read`-gated module in "Catálogo" shows...
      expect(find.byKey(const Key('nav-products')), findsOneWidget);
      expect(find.byKey(const Key('nav-productVariants')), findsOneWidget);
      expect(find.byKey(const Key('nav-categories')), findsOneWidget);
      expect(find.byKey(const Key('nav-brands')), findsOneWidget);
      expect(find.byKey(const Key('nav-catalogAdmin')), findsOneWidget);
      // ...but "Proveedores" (`supplier.read`, which this actor lacks)
      // never does.
      expect(find.byKey(const Key('nav-suppliers')), findsNothing);

      await tester.tap(find.byKey(const Key('nav-group-Ventas')));
      await tester.pumpAndSettle();
      // `sale.create`-gated — absent for an actor who only has catalog.read.
      expect(find.byKey(const Key('nav-pos')), findsNothing);
      expect(find.byKey(const Key('nav-cafeteria')), findsNothing);
      expect(find.byKey(const Key('nav-suspended')), findsNothing);
      expect(find.byKey(const Key('nav-returns')), findsNothing);

      await tester.tap(find.byKey(const Key('nav-group-Administración')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('nav-dashboard')), findsNothing);
      expect(find.byKey(const Key('nav-users')), findsNothing);

      await tester.tap(find.byKey(const Key('nav-group-Sistema')));
      await tester.pumpAndSettle();
      // `PosModule.assistant` has no permission gate at all — always
      // visible, deliberately, matching `pos_navigation.dart`'s own map.
      expect(find.byKey(const Key('nav-assistant')), findsOneWidget);
      expect(find.byKey(const Key('nav-settings')), findsNothing);
    });

    testWidgets('an unrestricted, full-permission actor sees every module in every group', (tester) async {
      // Derived from the SAME real map the sidebar itself filters
      // against — never a hand-copied/hardcoded permission list that
      // could silently drift out of sync with `pos_navigation.dart`.
      final everyGatingPermission = <String>{
        for (final module in PosModule.values) ...?module.requiredAnyPermission,
      }.toList();
      await _pump(
        tester,
        context: _contextWithPermissions(everyGatingPermission, companyWideAccess: true),
      );

      for (final group in posNavigationGroups) {
        await tester.tap(find.byKey(Key('nav-group-$group')));
        await tester.pumpAndSettle();
        for (final module in PosModule.values.where((item) => item.group == group)) {
          expect(
            find.byKey(Key('nav-${module.name}')),
            findsOneWidget,
            reason: 'nav-${module.name} should be visible for a full-permission actor',
          );
        }
        // Close the group again so the next one's own items are the only
        // ones showing — mirrors `_Sidebar`'s real "one group open at a
        // time" behavior, not load-bearing for the assertions above but
        // keeps this loop's own state clean between iterations.
        await tester.tap(find.byKey(Key('nav-group-$group')));
        await tester.pumpAndSettle();
      }
    });
  });

  group('Zero-eligible-register empty state (TASK 16.16)', () {
    testWidgets(
      'a cashier whose permitted register(s) no longer resolve to any real, active branch '
      'register sees an honest explanation, never a broken/blank sale screen',
      (tester) async {
        // `sale.create` + no management-signal permission → `PosStartRoute`
        // lands directly on `PosModule.pos` with no navigation needed.
        // `permittedRegisterIds` narrows this cashier to a register that
        // simply never comes back from `registersForBranch` — the real
        // "deactivated/reassigned since the grant was made" case.
        await _pump(
          tester,
          context: _contextWithPermissions(
            const ['sale.create', 'catalog.read'],
            permittedRegisterIds: const ['reg-deactivated'],
          ),
          cashGateway: const _StaticCashGateway(registers: []),
        );

        expect(find.byKey(const Key('pos-no-register-state')), findsOneWidget);
        expect(find.text('Sin caja disponible'), findsOneWidget);
        // Never a broken/blank ticket panel underneath.
        expect(find.byKey(const Key('pos-ticket-panel')), findsNothing);
      },
    );

    testWidgets(
      'an unrestricted cashier is never shown the no-register state, even with zero branch registers',
      (tester) async {
        // `permittedRegisterIds: null` (unrestricted) — `resolvePosRegisterScope`'s
        // own "zero or multiple open registers is genuinely ambiguous, never
        // force a picker" outcome must keep applying unchanged; the new
        // empty state is deliberately scoped to the RESTRICTED case only.
        await _pump(
          tester,
          context: _contextWithPermissions(
            const ['sale.create', 'catalog.read'],
          ),
          cashGateway: const _StaticCashGateway(registers: []),
        );

        expect(find.byKey(const Key('pos-no-register-state')), findsNothing);
        expect(find.byKey(const Key('pos-ticket-panel')), findsOneWidget);
      },
    );
  });

  group('Stale selected register cleared across a rebuild (TASK 16.16)', () {
    testWidgets(
      'narrowing permittedRegisterIds away from the previously auto-selected register '
      '(branch unchanged) clears it — the screen honestly reflects the new, empty scope',
      (tester) async {
        tester.view.physicalSize = const Size(1440, 900);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        final harnessKey = GlobalKey<_HarnessState>();
        final initialContext = _contextWithPermissions(
          const ['sale.create', 'catalog.read'],
          permittedRegisterIds: const ['reg-a'],
        );
        await tester.pumpWidget(
          // TASK 16.23B (F-05) — see `_pump`'s own identical doc comment
          // in `pos_shell_test.dart`.
          PlatformScope(
            posReadGateway: const EmptyPosReadGateway(),
            child: MaterialApp(
              home: _Harness(
                key: harnessKey,
                initialContext: initialContext,
                // Only `reg-a` actually exists on the branch — once
                // `permittedRegisterIds` narrows to `reg-b` below, `reg-b`
                // resolves to zero real eligible registers, making the
                // resulting empty state directly observable proof the stale
                // `reg-a` selection stopped silently applying.
                cashGateway: const _StaticCashGateway(
                  registers: [PosCashRegister(id: 'reg-a', branchId: 'branch-id', code: 'CAJA-A', name: 'Caja A', status: 'active')],
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();

        // Before narrowing: `reg-a` is the cashier's one permitted+real
        // register — auto-selected silently, real sale surface shows.
        expect(find.byKey(const Key('pos-no-register-state')), findsNothing);
        expect(find.byKey(const Key('pos-ticket-panel')), findsOneWidget);

        // An admin revokes `reg-a` and grants `reg-b` instead — same
        // branch, a real narrower `permittedRegisterIds` delivered via a
        // fresh `AuthenticatedContext` (exactly how a real `AuthController.
        // refresh` re-hydrate would arrive).
        harnessKey.currentState!.updateContext(
          _contextWithPermissions(
            const ['sale.create', 'catalog.read'],
            permittedRegisterIds: const ['reg-b'],
          ),
        );
        await tester.pumpAndSettle();

        // The stale `reg-a` selection no longer silently keeps the sale
        // surface usable — `reg-b` doesn't exist on this branch, so the
        // honest empty state takes over.
        expect(find.byKey(const Key('pos-no-register-state')), findsOneWidget);
        expect(find.byKey(const Key('pos-ticket-panel')), findsNothing);
      },
    );
  });
}

Future<void> _pump(
  WidgetTester tester, {
  required AuthenticatedContext context,
  PosCashGateway cashGateway = const EmptyPosCashGateway(),
}) async {
  tester.view.physicalSize = const Size(1440, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    // TASK 16.23B (F-05) — see `_pump`'s own identical doc comment in
    // `pos_shell_test.dart`.
    PlatformScope(
      posReadGateway: const EmptyPosReadGateway(),
      child: MaterialApp(home: _Harness(initialContext: context, cashGateway: cashGateway)),
    ),
  );
  await tester.pumpAndSettle();
}

/// A tiny wrapper letting a test swap `PosShell.context` via
/// `updateContext` (through a `GlobalKey<_HarnessState>`) to exercise
/// `_PosShellState.didUpdateWidget`'s real rebuild path — the same way
/// `DashboardScreen` hands `PosShell` a brand-new `AuthenticatedContext` on
/// every real `AuthController` re-hydrate (see `pos_workspace.dart`'s own
/// doc comment on `isStaleSelectedRegister`).
class _Harness extends StatefulWidget {
  const _Harness({required this.initialContext, required this.cashGateway, super.key});
  final AuthenticatedContext initialContext;
  final PosCashGateway cashGateway;

  @override
  State<_Harness> createState() => _HarnessState();
}

class _HarnessState extends State<_Harness> {
  late AuthenticatedContext _context = widget.initialContext;
  final _controller = PosReadController(const EmptyPosReadGateway());

  void updateContext(AuthenticatedContext next) => setState(() => _context = next);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => PosShell(
    context: _context,
    controller: _controller,
    salesGateway: const EmptyPosSalesGateway(),
    paymentsGateway: const EmptyPosPaymentsGateway(),
    cashGateway: widget.cashGateway,
    refundsGateway: const EmptyPosRefundsGateway(),
    promotionsGateway: const EmptyPosPromotionsGateway(),
    customersGateway: const EmptyPosCustomersGateway(),
    membershipsGateway: const EmptyPosMembershipsGateway(),
    loyaltyGateway: const EmptyPosLoyaltyGateway(),
    rewardsGateway: const EmptyPosRewardsGateway(),
    partiesGateway: const EmptyPosPartiesGateway(),
    heldSalesGateway: const EmptyPosHeldSalesGateway(),
    purchasingGateway: const EmptyPosPurchasingGateway(),
    purchaseOrdersGateway: const EmptyPosPurchaseOrdersGateway(),
    suppliersGateway: const EmptyPosSuppliersGateway(),
    reportsGateway: const EmptyPosReportsGateway(),
    accessGateway: const EmptyPosAccessGateway(),
    employeesGateway: const EmptyPosEmployeesGateway(),
    schedulesGateway: const EmptyPosSchedulesGateway(),
    timeClockGateway: const EmptyPosTimeClockGateway(),
    payrollGateway: const EmptyPosPayrollGateway(),
    dashboardGateway: const EmptyPosDashboardGateway(),
    settingsGateway: const EmptyPosSettingsGateway(),
    productVariantsGateway: const EmptyPosProductVariantsGateway(),
    assistantGateway: const EmptyPosAssistantGateway(),
    identityAdminGateway: const EmptyPosIdentityAdminGateway(),
    inventoryAdminGateway: const EmptyPosInventoryAdminGateway(),
    categoryAdminGateway: const EmptyPosCategoryAdminGateway(),
    brandAdminGateway: const EmptyPosBrandAdminGateway(),
    catalogAdminGateway: const EmptyPosCatalogAdminGateway(),
    branchAdminGateway: const EmptyPosBranchAdminGateway(),
    branchConsolidationGateway: const EmptyPosBranchConsolidationGateway(),
    operationalAreasGateway: const EmptyPosOperationalAreasGateway(),
    authGateway: const EmptyPosAuthGateway(),
    onLogout: () {},
    onBranchSelected: (_) async {},
  );
}

/// A minimal `PosCashGateway` fake returning a fixed [registers] list for
/// [registersForBranch] (and `null` for [openSessionForBranch], mirroring
/// `EmptyPosCashGateway`'s own default) — everything else stays the
/// `EmptyPosCashGateway` default (an honest "not configured" failure),
/// never called by anything these tests exercise.
class _StaticCashGateway extends EmptyPosCashGateway {
  const _StaticCashGateway({required this.registers});
  final List<PosCashRegister> registers;

  @override
  Future<List<PosCashRegister>> registersForBranch(String branchId, {String? operationalAreaId}) async => registers;
}

AuthenticatedContext _contextWithPermissions(
  List<String> permissions, {
  bool companyWideAccess = false,
  List<String>? permittedRegisterIds,
}) => AuthenticatedContext(
  session: SessionContext(
    id: 'session-id',
    userId: 'user-id',
    companyId: 'company-id',
    branchId: 'branch-id',
    permittedBranchIds: const ['branch-id'],
    companyWideAccess: companyWideAccess,
    expiresAt: DateTime.utc(2099),
    permittedRegisterIds: permittedRegisterIds,
  ),
  user: const UserSummary(id: 'user-id', displayName: 'Usuario AS', email: 'user@example.test'),
  companies: const [CompanySummary(id: 'company-id', name: 'Empresa AS', current: true)],
  branches: const [
    BranchSummary(
      id: 'branch-id',
      code: 'CENTRO',
      name: 'Sucursal Centro',
      timezone: 'America/Mexico_City',
      current: true,
    ),
  ],
  companyWideAccess: companyWideAccess,
  permissions: permissions,
);
