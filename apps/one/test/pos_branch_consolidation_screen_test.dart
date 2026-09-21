/// TASK 16.15 — widget tests for `PosBranchConsolidationScreen`
/// ("Consolidado de sucursal"): permission gating, the no-branch state,
/// and — the critical case this task calls out explicitly — that a
/// branch-wide `cash_difference_total` of exactly `$0.00` never hides a
/// genuinely discrepant register behind a "looks clean" headline number.
/// Uses a real, in-memory fake gateway — never a mock framework — mirroring
/// `pos_branch_admin_test.dart`'s own fixture convention.
library;

import 'package:as_one/core/errors/app_error.dart';
import 'package:as_one/core/networking/api_client.dart';
import 'package:as_one/features/authentication/auth_models.dart';
import 'package:as_one/features/pos/pos_branch_consolidation_gateway.dart';
import 'package:as_one/features/pos/pos_branch_consolidation_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const _readOnly = ['branch_consolidation.read'];

void main() {
  testWidgets('missing branch_consolidation.read shows the honest permission state, never calls the gateway', (
    tester,
  ) async {
    final gateway = _FakeBranchConsolidationGateway(result: _fixtureResult());
    await _pump(tester, gateway: gateway, permissions: const []);

    expect(
      find.text('Tu sesión no incluye el permiso de lectura requerido (branch_consolidation.read).'),
      findsOneWidget,
    );
    expect(gateway.calls, isEmpty);
  });

  testWidgets('no branch in session shows the honest no-branch state, never a fabricated consolidation', (
    tester,
  ) async {
    final gateway = _FakeBranchConsolidationGateway(result: _fixtureResult());
    await _pump(tester, gateway: gateway, permissions: _readOnly, branchId: null);

    expect(find.text('Selecciona una sucursal para ver su consolidado.'), findsOneWidget);
    expect(gateway.calls, isEmpty);
  });

  testWidgets('renders totals, per-area, and per-register rows from the real backend result', (tester) async {
    final gateway = _FakeBranchConsolidationGateway(result: _fixtureResult());
    await _pump(tester, gateway: gateway, permissions: _readOnly);

    expect(gateway.calls, hasLength(1));
    expect(gateway.calls.single.branchId, 'branch-id');
    expect(find.byKey(const Key('pos-branch-consolidation-totals')), findsOneWidget);
    expect(find.byKey(const Key('pos-branch-consolidation-register-register-1')), findsOneWidget);
    expect(find.byKey(const Key('pos-branch-consolidation-register-register-2')), findsOneWidget);
    // `no_session` must render distinctly from `closed` — never conflated.
    expect(find.text('Cerrada'), findsOneWidget);
    expect(find.text('Sin actividad hoy'), findsOneWidget);
  });

  testWidgets('zero discrepancies across the board shows the honest all-clear banner', (tester) async {
    final gateway = _FakeBranchConsolidationGateway(result: _fixtureResult());
    await _pump(tester, gateway: gateway, permissions: _readOnly);

    expect(find.byKey(const Key('pos-branch-consolidation-discrepancy-banner')), findsOneWidget);
    expect(
      find.text('Sin cajas con diferencia de efectivo ni de tarjeta reportadas hoy'),
      findsOneWidget,
    );
  });

  // THE critical test TASK 16.15 explicitly requires: a branch-wide
  // `cash_difference_total` of exactly zero must never let a real,
  // individually-discrepant register hide. Two registers here are
  // individually +$50.00/-$50.00 (net exactly zero) — the banner and the
  // per-register row must both surface this honestly.
  testWidgets(
    'a net-zero cashDifferenceTotal never hides individually discrepant registers',
    (tester) async {
      final gateway = _FakeBranchConsolidationGateway(result: _fixtureNetZeroButDiscrepantResult());
      await _pump(tester, gateway: gateway, permissions: _readOnly);

      // The headline totals number really is net zero — proving this test
      // isn't accidentally passing for the wrong reason.
      expect(find.textContaining(r'$0.00'), findsWidgets);

      // The discrepancy banner must show the real, non-zero per-register
      // counts — never the deceptively-clean net total, and never the
      // all-clear message.
      final banner = tester.widget<Text>(
        find.descendant(
          of: find.byKey(const Key('pos-branch-consolidation-discrepancy-banner')),
          matching: find.byType(Text),
        ),
      );
      expect(banner.data, contains('2 caja(s) con diferencia de efectivo'));
      expect(
        find.text('Sin cajas con diferencia de efectivo ni de tarjeta reportadas hoy'),
        findsNothing,
      );

      // Each individually-discrepant register row must show its own real,
      // non-zero difference — not silently rolled up into the net-zero
      // total. Mirrors `pos_shell.dart`'s own `_formatMoney` established
      // `-$50.00` (sign before the `$`) convention.
      expect(find.text('Diferencia: \$50.00'), findsOneWidget);
      expect(find.text('Diferencia: -\$50.00'), findsOneWidget);
    },
  );

  testWidgets('a gateway failure renders the real error message with a retry control', (tester) async {
    final gateway = _FakeBranchConsolidationGateway(
      failure: const ApiException(AppFailure(AppErrorKind.unknown, 'Fallo simulado al cargar el consolidado.')),
    );
    await _pump(tester, gateway: gateway, permissions: _readOnly);

    expect(find.text('Fallo simulado al cargar el consolidado.'), findsOneWidget);
    expect(find.text('Reintentar'), findsOneWidget);
  });
}

Future<void> _pump(
  WidgetTester tester, {
  required _FakeBranchConsolidationGateway gateway,
  required List<String> permissions,
  String? branchId = 'branch-id',
}) async {
  tester.view.physicalSize = const Size(1280, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(body: PosBranchConsolidationScreen(context: _context(permissions, branchId), gateway: gateway)),
    ),
  );
  await tester.pumpAndSettle();
}

AuthenticatedContext _context(List<String> permissions, String? branchId) => AuthenticatedContext(
  session: SessionContext(
    id: 'session-id',
    userId: 'user-id',
    companyId: 'company-id',
    branchId: branchId,
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
  permissions: permissions,
);

PosBranchConsolidationResult _fixtureResult() => PosBranchConsolidationResult(
  branchId: 'branch-id',
  businessDate: '2026-09-21',
  windowStart: '2026-09-21T06:00:00.000Z',
  windowEnd: '2026-09-22T06:00:00.000Z',
  registers: const [
    PosBranchConsolidationRegister(
      registerId: 'register-1',
      registerCode: 'CAJA-1',
      registerName: 'Caja 1',
      operationalAreaId: 'area-1',
      status: PosBranchConsolidationRegisterStatus.closed,
      cashSessionId: 'session-1',
      openedAt: '2026-09-21T08:00:00.000Z',
      closedAt: '2026-09-21T20:00:00.000Z',
      openingAmount: '1000.00',
      cashSalesTotal: '500.00',
      cashInTotal: '0.00',
      cashOutTotal: '0.00',
      expectedCash: '1500.00',
      countedCash: '1500.00',
      discrepancyAmount: '0.00',
      paymentMethodTotals: [],
      cardReconciliation: null,
    ),
    PosBranchConsolidationRegister(
      registerId: 'register-2',
      registerCode: 'CAJA-2',
      registerName: 'Caja 2',
      operationalAreaId: null,
      status: PosBranchConsolidationRegisterStatus.noSession,
      cashSessionId: null,
      openedAt: null,
      closedAt: null,
      openingAmount: null,
      cashSalesTotal: null,
      cashInTotal: null,
      cashOutTotal: null,
      expectedCash: null,
      countedCash: null,
      discrepancyAmount: null,
      paymentMethodTotals: [],
      cardReconciliation: null,
    ),
  ],
  areas: const [
    PosBranchConsolidationAreaSummary(
      operationalAreaId: 'area-1',
      operationalAreaName: 'Taquilla',
      cashSalesTotal: '500.00',
      registerCount: 1,
    ),
  ],
  totals: const PosBranchConsolidationTotals(
    cashOpeningTotal: '1000.00',
    cashSalesTotal: '500.00',
    cashInTotal: '0.00',
    cashOutTotal: '0.00',
    expectedCashTotal: '1500.00',
    countedCashTotal: '1500.00',
    cashDifferenceTotal: '0.00',
    paymentMethodTotals: [],
    cardSystemNetTotal: '0.00',
    cardTerminalTotal: '0.00',
    cardDifferenceTotal: '0.00',
    openRegisterCount: 0,
    closingRegisterCount: 0,
    closedRegisterCount: 1,
    noSessionRegisterCount: 1,
    discrepantRegisterCount: 0,
    cardPendingOrDiscrepantRegisterCount: 0,
  ),
);

PosBranchConsolidationResult _fixtureNetZeroButDiscrepantResult() => PosBranchConsolidationResult(
  branchId: 'branch-id',
  businessDate: '2026-09-21',
  windowStart: '2026-09-21T06:00:00.000Z',
  windowEnd: '2026-09-22T06:00:00.000Z',
  registers: const [
    PosBranchConsolidationRegister(
      registerId: 'register-over',
      registerCode: 'CAJA-1',
      registerName: 'Caja 1',
      operationalAreaId: null,
      status: PosBranchConsolidationRegisterStatus.closed,
      cashSessionId: 'session-over',
      openedAt: '2026-09-21T08:00:00.000Z',
      closedAt: '2026-09-21T20:00:00.000Z',
      openingAmount: '1000.00',
      cashSalesTotal: '500.00',
      cashInTotal: '0.00',
      cashOutTotal: '0.00',
      expectedCash: '1500.00',
      countedCash: '1550.00',
      discrepancyAmount: '50.00',
      paymentMethodTotals: [],
      cardReconciliation: null,
    ),
    PosBranchConsolidationRegister(
      registerId: 'register-under',
      registerCode: 'CAJA-2',
      registerName: 'Caja 2',
      operationalAreaId: null,
      status: PosBranchConsolidationRegisterStatus.closed,
      cashSessionId: 'session-under',
      openedAt: '2026-09-21T08:00:00.000Z',
      closedAt: '2026-09-21T20:00:00.000Z',
      openingAmount: '1000.00',
      cashSalesTotal: '500.00',
      cashInTotal: '0.00',
      cashOutTotal: '0.00',
      expectedCash: '1500.00',
      countedCash: '1450.00',
      discrepancyAmount: '-50.00',
      paymentMethodTotals: [],
      cardReconciliation: null,
    ),
  ],
  areas: const [],
  totals: const PosBranchConsolidationTotals(
    cashOpeningTotal: '2000.00',
    cashSalesTotal: '1000.00',
    cashInTotal: '0.00',
    cashOutTotal: '0.00',
    expectedCashTotal: '3000.00',
    countedCashTotal: '3000.00',
    // The deceptive net-zero headline this whole test exists to catch.
    cashDifferenceTotal: '0.00',
    paymentMethodTotals: [],
    cardSystemNetTotal: '0.00',
    cardTerminalTotal: '0.00',
    cardDifferenceTotal: '0.00',
    openRegisterCount: 0,
    closingRegisterCount: 0,
    closedRegisterCount: 2,
    noSessionRegisterCount: 0,
    discrepantRegisterCount: 2,
    cardPendingOrDiscrepantRegisterCount: 0,
  ),
);

class _FakeBranchConsolidationGateway implements PosBranchConsolidationGateway {
  _FakeBranchConsolidationGateway({this.result, this.failure});
  final PosBranchConsolidationResult? result;
  final ApiException? failure;
  final List<({String branchId, String? date})> calls = [];

  @override
  Future<PosBranchConsolidationResult> consolidation(String branchId, {String? date}) async {
    calls.add((branchId: branchId, date: date));
    if (failure != null) throw failure!;
    return result!;
  }
}
