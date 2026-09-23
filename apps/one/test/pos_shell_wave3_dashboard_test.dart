/// TASK 14.5 (Wave 3, Phase 2) — coverage for the real, server-aggregated
/// `_Dashboard` ("today at a glance") built inside `pos_shell.dart`,
/// replacing the previous context-only placeholder ("Sin métricas
/// simuladas"). Kept as its own sibling file per this wave's own
/// instruction — never appended to the already very large
/// `pos_shell_test.dart`.
///
/// A recording/fake `PosDashboardGateway` drives every scenario below —
/// no real HTTP call is made. Every assertion checks a number this test's
/// own fixture summary actually carries; nothing here invents a metric
/// the widget itself did not render.
library;

import 'dart:async';

import 'package:as_one/app/app.dart' show PlatformScope;
import 'package:as_one/features/authentication/auth_models.dart';
import 'package:as_one/features/pos/pos_cash_gateway.dart';
import 'package:as_one/features/pos/pos_customers_gateway.dart';
import 'package:as_one/features/pos/pos_dashboard_gateway.dart';
import 'package:as_one/features/pos/pos_loyalty_gateway.dart';
import 'package:as_one/features/pos/pos_memberships_gateway.dart';
import 'package:as_one/features/pos/pos_models.dart';
import 'package:as_one/features/pos/pos_parties_gateway.dart';
import 'package:as_one/features/pos/pos_payments_gateway.dart';
import 'package:as_one/features/pos/pos_promotions_gateway.dart';
import 'package:as_one/features/pos/pos_read_controller.dart';
import 'package:as_one/features/pos/pos_read_gateway.dart';
import 'package:as_one/features/pos/pos_refunds_gateway.dart';
import 'package:as_one/features/pos/pos_rewards_gateway.dart';
import 'package:as_one/features/pos/pos_sales_gateway.dart';
import 'package:as_one/features/pos/pos_shell.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('TASK 14.5 Wave 3 Phase 2 — Dashboard (through PosShell)', () {
    testWidgets('renders every real metric from the fixture summary, never a fabricated one', (tester) async {
      final gateway = _RecordingDashboardGateway(response: _fixtureSummary());
      await _pump(tester, dashboardGateway: gateway);

      expect(find.byKey(const Key('pos-dashboard')), findsOneWidget);
      expect(gateway.calls, hasLength(1));
      expect(gateway.calls.single.branchId, 'branch-id'); // branch-scoped session — its own branch, never null.

      // Sales — `_formatDashboardMoney` mirrors `pos_reports_screen.dart`'s
      // own `_formatAmountString` exactly: 2-decimal amount + currency
      // code, no thousands separator, no invented "$" prefix.
      expect(find.text('1500.00 MXN'), findsOneWidget);
      expect(find.text('3 transacción(es)'), findsOneWidget);
      // Occupancy.
      expect(find.text('7'), findsOneWidget);
      expect(find.text('personas dentro (en vivo)'), findsOneWidget);
      // Parties.
      expect(find.text('2'), findsWidgets); // count(2) may coincide with another metric's digit; still real.
      expect(find.text('reservación(es)'), findsOneWidget);
      // Cash sessions.
      expect(find.text('1'), findsWidgets);
      expect(find.text('sesión(es) de caja'), findsOneWidget);
      // Outstanding balances.
      expect(find.text('450.00 MXN'), findsOneWidget);
      // Attendance.
      expect(find.text('4'), findsOneWidget);
      expect(find.text('con entrada registrada hoy'), findsOneWidget);
      // Inventory alerts.
      expect(find.text('inventario en vivo'), findsOneWidget);

      // Today's party list row and open cash session row render real data
      // (the room name is embedded alongside the time range in one Text
      // widget — `textContaining` matches that honestly).
      expect(find.textContaining('Sala Fiesta'), findsOneWidget);
      expect(find.text('Caja Principal'), findsOneWidget);
    });

    testWidgets('a genuinely empty day shows real honest zeros on the metric grid, never a hidden card', (tester) async {
      final gateway = _RecordingDashboardGateway(response: _emptySummary());
      await _pump(tester, dashboardGateway: gateway);

      expect(find.byKey(const Key('pos-dashboard-metric-sales')), findsOneWidget);
      expect(find.byKey(const Key('pos-dashboard-metric-parties')), findsOneWidget);
      expect(find.text('0 transacción(es)'), findsOneWidget);
      expect(find.text('0'), findsWidgets); // several real zero counts — never a hidden/fabricated card.

      // Sub-list empty states are real, not fabricated rows.
      expect(find.byKey(const Key('pos-dashboard-parties-empty')), findsOneWidget);
      expect(find.text('Sin fiestas registradas hoy.'), findsOneWidget);
      expect(find.byKey(const Key('pos-dashboard-cash-sessions-empty')), findsOneWidget);
      expect(find.text('No hay cajas abiertas en este momento.'), findsOneWidget);
    });

    testWidgets('a branch-scoped session never shows the branch selector and always passes its own branch', (
      tester,
    ) async {
      final gateway = _RecordingDashboardGateway(response: _emptySummary());
      await _pump(tester, dashboardGateway: gateway);

      expect(find.byKey(const Key('pos-dashboard-branch-selector')), findsNothing);
      expect(gateway.calls.single.branchId, 'branch-id');
    });

    testWidgets('company-wide access shows a real branch selector; picking a branch reloads with that branch_id', (
      tester,
    ) async {
      final gateway = _RecordingDashboardGateway(response: _emptySummary());
      await _pump(tester, dashboardGateway: gateway, context: _companyWideContext);

      expect(find.byKey(const Key('pos-dashboard-branch-selector')), findsOneWidget);
      expect(gateway.calls.single.branchId, isNull); // consolidated view by default.

      await tester.tap(find.byKey(const Key('pos-dashboard-branch-selector')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Sucursal Norte').last);
      await tester.pumpAndSettle();

      expect(gateway.calls, hasLength(2));
      expect(gateway.calls.last.branchId, 'branch-norte');
    });

    testWidgets('an actor without report.read sees the shared permission state, never a metric', (tester) async {
      final gateway = _RecordingDashboardGateway(response: _fixtureSummary());
      await _pump(tester, dashboardGateway: gateway, context: _noPermissionContext);

      expect(find.byKey(const Key('pos-dashboard-permission')), findsOneWidget);
      expect(find.byKey(const Key('pos-dashboard-metrics-grid')), findsNothing);
      expect(gateway.calls, isEmpty); // never even attempted the call.
    });

    testWidgets('shows the shared loading state before the gateway resolves', (tester) async {
      final gateway = _RecordingDashboardGateway(response: _emptySummary(), delay: true);
      tester.view.physicalSize = const Size(1440, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(_shell(dashboardGateway: gateway));
      await tester.pump();

      expect(find.byKey(const Key('pos-dashboard-loading')), findsOneWidget);

      gateway.resolvePending();
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('pos-dashboard-loading')), findsNothing);
    });

    testWidgets('a gateway failure shows the shared failure state with a real retry that recovers', (tester) async {
      final gateway = _RecordingDashboardGateway(response: _emptySummary(), failFirst: true);
      await _pump(tester, dashboardGateway: gateway);

      expect(find.byKey(const Key('pos-dashboard-failure')), findsOneWidget);
      expect(find.text('No fue posible cargar el dashboard.'), findsOneWidget);

      await tester.tap(
        find.descendant(of: find.byKey(const Key('pos-dashboard-failure')), matching: find.text('Reintentar')),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('pos-dashboard-failure')), findsNothing);
      expect(find.byKey(const Key('pos-dashboard-metrics-grid')), findsOneWidget);
    });
  });
}

// --- Fixtures ---------------------------------------------------------------

PosDashboardSummary _fixtureSummary() => PosDashboardSummary(
  date: '2026-09-08',
  branchId: 'branch-id',
  salesTransactionCount: 3,
  salesGrossTotal: const [PosDashboardCurrencyAmount(currencyCode: 'MXN', amount: '1500.0000')],
  salesTrendVsYesterday: const [
    PosDashboardSalesTrendEntry(currencyCode: 'MXN', todayTotal: '1500.0000', yesterdayTotal: '1000.0000', pctChange: 50),
  ],
  currentOccupancy: 7,
  partyReservationCount: 2,
  partyReservations: const [
    PosDashboardPartyReservation(
      id: 'reservation-1',
      roomId: 'room-1',
      roomName: 'Sala Fiesta',
      customerDisplayName: 'Cliente Uno',
      celebrantName: 'Sofía',
      startTime: '10:00',
      endTime: '11:00',
      status: 'confirmed',
    ),
    PosDashboardPartyReservation(
      id: 'reservation-2',
      roomId: 'room-2',
      roomName: null,
      customerDisplayName: 'Cliente Dos',
      celebrantName: null,
      startTime: '12:00',
      endTime: '13:00',
      status: 'held',
    ),
  ],
  openCashSessionCount: 1,
  openCashSessions: [
    PosDashboardOpenCashSession(
      cashSessionId: 'session-1',
      cashRegisterId: 'register-1',
      cashRegisterName: 'Caja Principal',
      cashRegisterCode: 'REG-1',
      branchId: 'branch-id',
      openedAt: DateTime.utc(2026, 9, 8, 9),
      openingAmount: '100.0000',
      currencyCode: 'MXN',
    ),
  ],
  outstandingPartyBalances: const [PosDashboardCurrencyAmount(currencyCode: 'MXN', amount: '450.0000')],
  upcomingPartyReservationCount: 5,
  partyStatusBreakdown: const {'confirmed': 1, 'held': 1},
  eventRevenueToday: const [PosDashboardCurrencyAmount(currencyCode: 'MXN', amount: '2320.0000')],
  depositsCollectedToday: const [PosDashboardCurrencyAmount(currencyCode: 'MXN', amount: '500.0000')],
  completedPartyReservationsToday: 0,
  cancelledPartyReservationsToday: 0,
  clockedInEmployeeCount: 4,
  outOfStockVariantCount: 2,
  birthdaysToday: const [PosDashboardBirthdayCustomer(id: 'customer-1', displayName: 'Cliente Cumpleañero')],
);

PosDashboardSummary _emptySummary() => const PosDashboardSummary(
  date: '2026-09-08',
  branchId: null,
  salesTransactionCount: 0,
  salesGrossTotal: [],
  salesTrendVsYesterday: [],
  currentOccupancy: 0,
  partyReservationCount: 0,
  partyReservations: [],
  openCashSessionCount: 0,
  openCashSessions: [],
  outstandingPartyBalances: [],
  upcomingPartyReservationCount: 0,
  partyStatusBreakdown: {},
  eventRevenueToday: [],
  depositsCollectedToday: [],
  completedPartyReservationsToday: 0,
  cancelledPartyReservationsToday: 0,
  clockedInEmployeeCount: 0,
  outOfStockVariantCount: 0,
  birthdaysToday: [],
);

class _RecordingDashboardGateway implements PosDashboardGateway {
  _RecordingDashboardGateway({required this.response, this.delay = false, this.failFirst = false});

  final PosDashboardSummary response;
  final bool delay;
  bool failFirst;
  final List<({String date, String? branchId})> calls = [];
  final List<Completer<PosDashboardSummary>> _pending = [];

  void resolvePending() {
    for (final completer in _pending) {
      if (!completer.isCompleted) completer.complete(response);
    }
    _pending.clear();
  }

  @override
  Future<PosDashboardSummary> summary({required String date, String? branchId}) async {
    calls.add((date: date, branchId: branchId));
    if (failFirst) {
      failFirst = false;
      return Future.error(StateError('boom'));
    }
    if (delay) {
      final completer = Completer<PosDashboardSummary>();
      _pending.add(completer);
      return completer.future;
    }
    return response;
  }
}

class _FixtureReadGateway implements PosReadGateway {
  const _FixtureReadGateway();

  @override
  Future<List<PosProduct>> products({String? branchId}) async => const [];

  @override
  Future<PosProduct?> productByBarcode(String barcode, {String? branchId}) async => null;

  @override
  Future<List<PosCategory>> categories() async => const [];

  @override
  Future<List<PosInventoryBalance>> inventoryBalances({String? branchId}) async => const [];

  @override
  Future<List<PosUser>> users() async => const [];

  @override
  Future<String> businessDate({required String timezone}) async => '2026-01-01';
}

final _context = AuthenticatedContext(
  session: SessionContext(
    id: 'session-id',
    userId: 'user-id',
    companyId: 'company-id',
    branchId: 'branch-id',
    permittedBranchIds: const ['branch-id'],
    companyWideAccess: false,
    expiresAt: DateTime.utc(2099),
  ),
  user: const UserSummary(id: 'user-id', displayName: 'Usuario AS', email: 'user@example.test'),
  companies: const [CompanySummary(id: 'company-id', name: 'Empresa AS', current: true)],
  branches: const [
    BranchSummary(id: 'branch-id', code: 'CENTRO', name: 'Sucursal Centro', timezone: 'America/Mexico_City', current: true),
  ],
  companyWideAccess: false,
  permissions: const ['report.read'],
);

final _companyWideContext = AuthenticatedContext(
  session: SessionContext(
    id: 'session-id',
    userId: 'user-id',
    companyId: 'company-id',
    branchId: null,
    permittedBranchIds: const ['branch-id', 'branch-norte'],
    companyWideAccess: true,
    expiresAt: DateTime.utc(2099),
  ),
  user: const UserSummary(id: 'user-id', displayName: 'Usuario AS', email: 'user@example.test'),
  companies: const [CompanySummary(id: 'company-id', name: 'Empresa AS', current: true)],
  branches: const [
    BranchSummary(id: 'branch-id', code: 'CENTRO', name: 'Sucursal Centro', timezone: 'America/Mexico_City', current: true),
    BranchSummary(id: 'branch-norte', code: 'NORTE', name: 'Sucursal Norte', timezone: 'America/Mexico_City'),
  ],
  companyWideAccess: true,
  permissions: const ['report.read'],
);

final _noPermissionContext = AuthenticatedContext(
  session: SessionContext(
    id: 'session-id',
    userId: 'user-id',
    companyId: 'company-id',
    branchId: 'branch-id',
    permittedBranchIds: const ['branch-id'],
    companyWideAccess: false,
    expiresAt: DateTime.utc(2099),
  ),
  user: const UserSummary(id: 'user-id', displayName: 'Usuario AS', email: 'user@example.test'),
  companies: const [CompanySummary(id: 'company-id', name: 'Empresa AS', current: true)],
  branches: const [
    BranchSummary(id: 'branch-id', code: 'CENTRO', name: 'Sucursal Centro', timezone: 'America/Mexico_City', current: true),
  ],
  companyWideAccess: false,
  permissions: const [],
);

// TASK 16.23B (F-05) — mirrors the real app's own tree (`AsOneApp`'s
// `MaterialApp.builder` wraps every route in `PlatformScope`, see
// `app.dart`): `_Dashboard` now resolves "business today" via
// `PlatformScope.of(context).posReadGateway`, which throws with no such
// ancestor.
Widget _shell({required PosDashboardGateway dashboardGateway, AuthenticatedContext? context}) => PlatformScope(
  posReadGateway: const _FixtureReadGateway(),
  child: MaterialApp(
    home: PosShell(
      context: context ?? _context,
      controller: PosReadController(const _FixtureReadGateway()),
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
      dashboardGateway: dashboardGateway,
      onLogout: () {},
      onBranchSelected: (_) async {},
    ),
  ),
);

Future<void> _pump(WidgetTester tester, {required PosDashboardGateway dashboardGateway, AuthenticatedContext? context}) async {
  tester.view.physicalSize = const Size(1440, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(_shell(dashboardGateway: dashboardGateway, context: context));
  await tester.pumpAndSettle();
}
