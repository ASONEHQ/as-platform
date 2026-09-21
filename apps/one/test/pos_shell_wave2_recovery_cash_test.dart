/// TASK 14.4 (Wave 2, Parts A and F): widget tests for the Held-Sale
/// Recovery UI completion (resuming visibility + "Liberar") and the
/// Advanced Cash Operations UI (movement category, "Corte parcial" +
/// history) added to `pos_shell.dart` — kept as a dedicated sibling file
/// (rather than growing `pos_shell_test.dart` further), matching this
/// codebase's own convention of splitting large feature suites — see
/// `pos_shell_wave1_partbc_test.dart`'s own top doc comment, whose
/// fixture/`_pump`/`_navigateTo*` boilerplate pattern this file copies
/// exactly.
///
/// Every gateway this suite doesn't specifically exercise uses the real
/// `Empty*Gateway` the app itself falls back to, never an invented stub.
library;

import 'package:as_one/features/authentication/auth_models.dart';
import 'package:as_one/features/pos/pos_cash_gateway.dart';
import 'package:as_one/features/pos/pos_customers_gateway.dart';
import 'package:as_one/features/pos/pos_held_sales_gateway.dart';
import 'package:as_one/features/pos/pos_loyalty_gateway.dart';
import 'package:as_one/features/pos/pos_memberships_gateway.dart';
import 'package:as_one/features/pos/pos_parties_gateway.dart';
import 'package:as_one/features/pos/pos_payments_gateway.dart';
import 'package:as_one/features/pos/pos_promotions_gateway.dart';
import 'package:as_one/features/pos/pos_purchasing_gateway.dart';
import 'package:as_one/features/pos/pos_read_controller.dart';
import 'package:as_one/features/pos/pos_read_gateway.dart';
import 'package:as_one/features/pos/pos_receipt.dart';
import 'package:as_one/features/pos/pos_refunds_gateway.dart';
import 'package:as_one/features/pos/pos_rewards_gateway.dart';
import 'package:as_one/features/pos/pos_sales_gateway.dart';
import 'package:as_one/features/pos/pos_shell.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('TASK 14.4 Wave 2 Part A.2 — Ventas Suspendidas (resuming visibility)', () {
    testWidgets(
      'a `resuming` cart is shown alongside `held`, never silently hidden, '
      'and is visually distinct (a "reclamada" badge, not "disponible")',
      (tester) async {
        final held = _heldCart(id: 'cart-held', label: 'Mesa 1');
        final resuming = _resumingCart(
          id: 'cart-resuming',
          label: 'Mesa 2',
          claimedBy: 'other-user-id',
          claimedAt: DateTime.utc(2026, 9, 7, 10),
        );
        final gateway = _RecordingHeldSalesGateway(carts: [held, resuming]);
        await _pump(tester, heldSalesGateway: gateway);
        await _navigateToSuspended(tester);

        // Both rows are present — the `resuming` cart is never hidden.
        // (`DataRow.key` isn't itself discoverable via `find.byKey` —
        // `DataTable` doesn't attach it to a rendered widget — so this
        // asserts on each row's own action buttons instead, exactly like
        // the rest of this file/`pos_shell_wave1_partbc_test.dart` already
        // does.)
        expect(find.byKey(const Key('pos-held-sale-resume-cart-held')), findsOneWidget);
        expect(find.byKey(const Key('pos-held-sale-resume-cart-resuming')), findsOneWidget);
        // And visually distinct from `held` — different badge text.
        expect(find.text('disponible'), findsOneWidget);
        expect(find.text('reclamada'), findsOneWidget);
      },
    );

    testWidgets(
      'Liberar succeeds for the cart\'s own claimant (the confirmation '
      'dialog gates the real call, mirroring _resume/_discard\'s own shape)',
      (tester) async {
        final mine = _resumingCart(
          id: 'cart-mine',
          claimedBy: 'user-id', // the fixture session's own userId.
          claimedAt: DateTime.utc(2026, 9, 7, 9),
        );
        final gateway = _RecordingHeldSalesGateway(carts: [mine]);
        await _pump(tester, heldSalesGateway: gateway);
        await _navigateToSuspended(tester);

        await tester.tap(find.byKey(const Key('pos-held-sale-release-cart-mine')));
        await tester.pumpAndSettle();

        // The confirmation dialog is shown first — not yet called.
        expect(gateway.releaseCalls, isEmpty);
        expect(find.byKey(const Key('pos-held-sale-release-confirm')), findsOneWidget);

        await tester.tap(find.byKey(const Key('pos-held-sale-release-confirm')));
        await tester.pumpAndSettle();

        expect(gateway.releaseCalls, ['cart-mine']);
      },
    );

    testWidgets(
      'Liberar is disabled for a cart claimed by someone else when the '
      'actor lacks sale.cancel — mirrors held-sales.service.ts\'s own '
      'releaseCart gate exactly, never looser',
      (tester) async {
        final someoneElses = _resumingCart(
          id: 'cart-other',
          claimedBy: 'other-user-id',
          claimedAt: DateTime.utc(2026, 9, 7, 9),
        );
        final gateway = _RecordingHeldSalesGateway(carts: [someoneElses]);
        // The default fixture context does NOT include sale.cancel — see
        // `_context` below.
        await _pump(tester, heldSalesGateway: gateway);
        await _navigateToSuspended(tester);

        // Disabled (onPressed: null) — tapping it is a real no-op, never a
        // call that would just come back 403.
        await tester.tap(find.byKey(const Key('pos-held-sale-release-cart-other')), warnIfMissed: false);
        await tester.pumpAndSettle();

        expect(gateway.releaseCalls, isEmpty);
      },
    );

    testWidgets(
      'Liberar is enabled for a cart claimed by someone else when the '
      'actor DOES hold sale.cancel — the same rule, the other branch',
      (tester) async {
        final someoneElses = _resumingCart(
          id: 'cart-other',
          claimedBy: 'other-user-id',
          claimedAt: DateTime.utc(2026, 9, 7, 9),
        );
        final gateway = _RecordingHeldSalesGateway(carts: [someoneElses]);
        await _pump(
          tester,
          heldSalesGateway: gateway,
          context: _contextWithSaleCancel,
        );
        await _navigateToSuspended(tester);

        await tester.tap(find.byKey(const Key('pos-held-sale-release-cart-other')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pos-held-sale-release-confirm')));
        await tester.pumpAndSettle();

        expect(gateway.releaseCalls, ['cart-other']);
      },
    );
  });

  group('TASK 14.4 Wave 2 Part F.1 — Cash movement category', () {
    testWidgets(
      'a cash_out movement only offers withdrawal/expense/other — never '
      'external_income, which is only valid for cash_in',
      (tester) async {
        final gateway = _RecordingCashGateway();
        await _pump(tester, cashGateway: gateway);
        await _navigateToCaja(tester);

        await tester.tap(find.byKey(const Key('pos-caja-cash-out')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pos-caja-movement-category')));
        await tester.pumpAndSettle();

        expect(find.text('Retiro'), findsOneWidget);
        expect(find.text('Gasto'), findsOneWidget);
        expect(find.text('Otro'), findsOneWidget);
        // Prevented, not just unlabeled — never even offered as an option.
        expect(find.text('Ingreso externo'), findsNothing);

        await tester.tap(find.text('Retiro').last);
        await tester.pumpAndSettle();
        await tester.enterText(find.byKey(const Key('pos-caja-movement-amount')), '50');
        await tester.enterText(find.byKey(const Key('pos-caja-movement-reason')), 'Retiro de prueba');
        await tester.tap(find.byKey(const Key('pos-caja-confirm-movement')));
        await tester.pumpAndSettle();

        expect(gateway.movementCalls, hasLength(1));
        expect(gateway.movementCalls.single.movementType, 'cash_out');
        expect(gateway.movementCalls.single.category, 'withdrawal');
      },
    );

    testWidgets(
      'a cash_in movement only offers external_income/other — never '
      'withdrawal/expense, which are only valid for cash_out',
      (tester) async {
        final gateway = _RecordingCashGateway();
        await _pump(tester, cashGateway: gateway);
        await _navigateToCaja(tester);

        await tester.tap(find.byKey(const Key('pos-caja-cash-in')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pos-caja-movement-category')));
        await tester.pumpAndSettle();

        expect(find.text('Ingreso externo'), findsOneWidget);
        expect(find.text('Otro'), findsOneWidget);
        expect(find.text('Retiro'), findsNothing);
        expect(find.text('Gasto'), findsNothing);

        await tester.tap(find.text('Ingreso externo').last);
        await tester.pumpAndSettle();
        await tester.enterText(find.byKey(const Key('pos-caja-movement-amount')), '25');
        await tester.enterText(find.byKey(const Key('pos-caja-movement-reason')), 'Reembolso proveedor');
        await tester.tap(find.byKey(const Key('pos-caja-confirm-movement')));
        await tester.pumpAndSettle();

        expect(gateway.movementCalls, hasLength(1));
        expect(gateway.movementCalls.single.movementType, 'cash_in');
        expect(gateway.movementCalls.single.category, 'external_income');
      },
    );

    testWidgets('the breakdown totals from the summary are rendered verbatim', (
      tester,
    ) async {
      final gateway = _RecordingCashGateway(
        summaryResult: PosCashSessionSummary(
          session: _fixtureCashSession,
          openingAmount: '1000.0000',
          cashSalesTotal: '9.0000',
          cashSalesCount: 1,
          cashInTotal: '55.0000',
          cashOutTotal: '33.0000',
          expectedCash: '1031.0000',
          withdrawalTotal: '20.0000',
          expenseTotal: '13.0000',
          externalIncomeTotal: '55.0000',
          cashRefundTotal: '0.0000',
          cashRefundCount: 0,
          paymentMethodTotals: const [],
        ),
      );
      await _pump(tester, cashGateway: gateway);
      await _navigateToCaja(tester);

      expect(find.text('\$20.00'), findsOneWidget); // Retiros
      expect(find.text('\$13.00'), findsOneWidget); // Gastos
      expect(find.text('\$55.00'), findsWidgets); // Ingresos externos (== Entradas here)
    });
  });

  group('TASK 14.4 Wave 2 Part F.3/F.4 — Corte parcial', () {
    testWidgets(
      'Corte parcial calls the real endpoint, shows the returned snapshot, '
      'and never transitions the session UI to closed',
      (tester) async {
        // TASK 16.13 — a real operational snapshot, so this test also
        // proves the "RESUMEN OPERATIVO" section renders the backend's
        // own figures verbatim, never a client recomputation.
        final operationalSummary = PosCashOperationalSummary(
          windowStart: DateTime.utc(2026, 9, 7, 9),
          windowEnd: DateTime.utc(2026, 9, 7, 11),
          pos: PosCashOperationalPosSummary(
            grossSales: '450.0000',
            refundsTotal: '0.0000',
            netSales: '450.0000',
            ticketCount: 5,
          ),
          cafeteria: PosCashOperationalCafeteriaSummary(
            available: true,
            grossSales: '150.0000',
            refundsTotal: '0.0000',
            netSales: '150.0000',
            ticketCount: 3,
            unitsSold: '3.000000',
          ),
          events: PosCashOperationalEventsSummary(
            reservationsCreated: 1,
            contractedValue: '2000.0000',
            collectedForNewReservations: '500.0000',
            outstandingForNewReservations: '1500.0000',
            depositsCollected: '500.0000',
            totalCollected: '500.0000',
            cancelledCount: 0,
            reservationsOccurringToday: 0,
          ),
        );
        final snapshot = PosCashSessionPartialClose(
          id: 'partial-1',
          cashSessionId: 'session-id',
          takenAt: DateTime.utc(2026, 9, 7, 11),
          openingAmount: '1000.0000',
          cashSalesTotal: '9.0000',
          cashInTotal: '55.0000',
          cashOutTotal: '33.0000',
          expectedCash: '1031.0000',
          createdBy: 'user-id',
          createdAt: DateTime.utc(2026, 9, 7, 11),
          operationalSummary: operationalSummary,
        );
        final gateway = _RecordingCashGateway(partialCloseResult: snapshot);
        await _pump(tester, cashGateway: gateway);
        await _navigateToCaja(tester);

        // The session is open before the partial close...
        expect(find.byKey(const Key('pos-caja-close-button')), findsOneWidget);

        await tester.tap(find.byKey(const Key('pos-caja-partial-close-button')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pos-caja-confirm-partial-close')));
        await tester.pumpAndSettle();

        expect(gateway.partialCloseCalls, ['session-id']);
        // The real, returned snapshot figures — never fabricated.
        expect(find.text('\$1031.00'), findsWidgets);

        // The operational section — Ventas/Taquilla, Cafetería/Snacks
        // (labeled as part of Taquilla, never an additional total), and
        // Eventos/Fiestas — all real backend figures.
        expect(find.text('RESUMEN OPERATIVO'), findsOneWidget);
        expect(find.text('VENTAS / TAQUILLA'), findsOneWidget);
        expect(find.text('\$450.00'), findsWidgets); // pos.netSales
        expect(find.text('CAFETERÍA / SNACKS (parte de Taquilla)'), findsOneWidget);
        expect(find.text('\$150.00'), findsWidgets); // cafeteria.netSales
        expect(find.text('EVENTOS / FIESTAS'), findsOneWidget);
        expect(find.text('\$1500.00'), findsWidgets); // outstanding for new reservations
        // No RenderFlex overflow from the new (longer) operational labels.
        expect(tester.takeException(), isNull);

        await tester.tap(find.text('Entendido'));
        await tester.pumpAndSettle();

        // ...and it CRITICALLY stays open afterward — "Cerrar caja" (an
        // open-only action) is still offered, never replaced by a closed
        // state.
        expect(find.byKey(const Key('pos-caja-close-button')), findsOneWidget);
        expect(find.byKey(const Key('pos-caja-open-button')), findsNothing);
      },
    );

    testWidgets('Cortes parciales lists the real persisted snapshots', (
      tester,
    ) async {
      final gateway = _RecordingCashGateway(
        partialClosesResult: [
          PosCashSessionPartialClose(
            id: 'partial-1',
            cashSessionId: 'session-id',
            takenAt: DateTime.utc(2026, 9, 7, 8, 30),
            openingAmount: '1000.0000',
            cashSalesTotal: '9.0000',
            cashInTotal: '0.0000',
            cashOutTotal: '0.0000',
            expectedCash: '1009.0000',
            createdBy: 'user-id',
            createdAt: DateTime.utc(2026, 9, 7, 8, 30),
            operationalSummary: null,
          ),
        ],
      );
      await _pump(tester, cashGateway: gateway);
      await _navigateToCaja(tester);

      expect(find.byKey(const Key('pos-caja-partial-close-row-partial-1')), findsOneWidget);
      expect(find.textContaining('Esperado: \$1009.00'), findsOneWidget);

      // TASK 16.13 (§13) — tapping an old (pre-16.13) partial close opens
      // its detail honestly: no operational breakdown, never synthesized
      // zeros or a crash.
      await tester.tap(find.byKey(const Key('pos-caja-partial-close-row-partial-1')));
      await tester.pumpAndSettle();
      expect(find.text('RESUMEN OPERATIVO'), findsOneWidget);
      expect(
        find.text('Resumen operativo no disponible para este corte.'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });
  });
}

// --- Fixtures -----------------------------------------------------------

PosHeldSaleCart _heldCart({required String id, String? label}) => PosHeldSaleCart(
  id: id,
  branchId: 'branch-id',
  cashRegisterId: null,
  customerId: null,
  label: label,
  items: const [PosHeldSaleCartItem(productId: 'product-1', quantity: '1')],
  status: 'held',
  createdBy: 'user-id',
  claimedAt: null,
  claimedBy: null,
  resumedAt: null,
  resumedBy: null,
  resumedSaleId: null,
  discardedAt: null,
  discardedBy: null,
  createdAt: DateTime.utc(2026, 9, 1),
);

PosHeldSaleCart _resumingCart({
  required String id,
  String? label,
  required String claimedBy,
  required DateTime claimedAt,
}) => PosHeldSaleCart(
  id: id,
  branchId: 'branch-id',
  cashRegisterId: null,
  customerId: null,
  label: label,
  items: const [PosHeldSaleCartItem(productId: 'product-1', quantity: '1')],
  status: 'resuming',
  createdBy: 'user-id',
  claimedAt: claimedAt,
  claimedBy: claimedBy,
  resumedAt: null,
  resumedBy: null,
  resumedSaleId: null,
  discardedAt: null,
  discardedBy: null,
  createdAt: DateTime.utc(2026, 9, 1),
);

/// Mirrors `held-sales.service.ts`'s own `listCarts`/`releaseCart`
/// contract: `status` is a single value per call (never an array), so this
/// fake filters its full fixture list by `filter.status` exactly like the
/// real backend would for two separate calls.
class _RecordingHeldSalesGateway implements PosHeldSalesGateway {
  _RecordingHeldSalesGateway({this.carts = const []});
  final List<PosHeldSaleCart> carts;

  final List<String> releaseCalls = [];

  @override
  Future<PosHeldSaleCart> createCart({
    required String branchId,
    String? cashRegisterId,
    String? customerId,
    String? label,
    required List<PosHeldSaleCartItemRequest> items,
  }) => Future.error(StateError('not used'));

  @override
  Future<PosHeldSaleCartPage> listCarts({
    PosHeldSaleCartListFilter filter = const PosHeldSaleCartListFilter(),
    String? cursor,
    int limit = 50,
  }) async {
    final matching = filter.status == null
        ? carts
        : carts.where((cart) => cart.status == filter.status).toList(growable: false);
    return PosHeldSaleCartPage(items: matching, nextCursor: null);
  }

  @override
  Future<PosHeldSaleCart> resumeCart(String id) => Future.error(StateError('not used'));

  @override
  Future<PosHeldSaleCart> linkSale({required String id, required String saleId}) =>
      Future.error(StateError('not used'));

  @override
  Future<PosHeldSaleCart> releaseCart(String id) async {
    releaseCalls.add(id);
    final current = carts.firstWhere((cart) => cart.id == id);
    return PosHeldSaleCart(
      id: current.id,
      branchId: current.branchId,
      cashRegisterId: current.cashRegisterId,
      customerId: current.customerId,
      label: current.label,
      items: current.items,
      status: 'held',
      createdBy: current.createdBy,
      claimedAt: current.claimedAt,
      claimedBy: current.claimedBy,
      resumedAt: null,
      resumedBy: null,
      resumedSaleId: null,
      discardedAt: null,
      discardedBy: null,
      createdAt: current.createdAt,
    );
  }

  @override
  Future<PosHeldSaleCart> discardCart({required String id, String? reason}) =>
      Future.error(StateError('not used'));
}

const _fixtureCashRegister = PosCashRegister(
  id: 'register-id',
  branchId: 'branch-id',
  code: 'CAJA-1',
  name: 'Caja 1',
  status: 'active',
);

final _fixtureCashSession = PosCashSession(
  id: 'session-id',
  branchId: 'branch-id',
  cashRegisterId: 'register-id',
  openedBy: 'user-id',
  openedAt: DateTime.utc(2026, 9, 7, 9),
  openingAmount: '1000.0000',
  currencyCode: 'MXN',
  status: 'open',
);

/// Mirrors `pos_shell_test.dart`'s own `_FakeCashGateway` shape, trimmed to
/// only what this suite exercises.
class _RecordingCashGateway implements PosCashGateway {
  _RecordingCashGateway({this.summaryResult, this.partialCloseResult, this.partialClosesResult = const []});

  final PosCashSessionSummary? summaryResult;
  final PosCashSessionPartialClose? partialCloseResult;
  final List<PosCashSessionPartialClose> partialClosesResult;

  final List<({String cashSessionId, String movementType, String? category})> movementCalls = [];
  final List<String> partialCloseCalls = [];

  @override
  Future<List<PosCashRegister>> registersForBranch(
    String branchId, {
    String? operationalAreaId,
  }) async => [_fixtureCashRegister];

  @override
  Future<PosCashRegister> assignOperationalArea(
    String registerId,
    int version,
    String? operationalAreaId,
  ) => Future.error(UnimplementedError('assignOperationalArea not faked'));

  @override
  Future<PosCashRegister> createRegister({
    required String branchId,
    required String code,
    required String name,
  }) => Future.error(UnimplementedError('createRegister not faked'));

  @override
  Future<PosCashSession> openSession({required String cashRegisterId, required String openingAmount}) =>
      Future.error(StateError('not used'));

  @override
  Future<PosCashSession?> currentSession(String cashRegisterId) async => _fixtureCashSession;

  @override
  Future<PosCashSession?> openSessionForBranch(String branchId) async => _fixtureCashSession;

  @override
  Future<PosCashSession> session(String cashSessionId) async => _fixtureCashSession;

  @override
  Future<PosCashSessionSummary> summary(String cashSessionId) async =>
      summaryResult ??
      PosCashSessionSummary(
        session: _fixtureCashSession,
        openingAmount: '1000.0000',
        cashSalesTotal: '9.0000',
        cashSalesCount: 1,
        cashInTotal: '0.0000',
        cashOutTotal: '0.0000',
        expectedCash: '1009.0000',
        withdrawalTotal: '0.0000',
        expenseTotal: '0.0000',
        externalIncomeTotal: '0.0000',
        cashRefundTotal: '0.0000',
        cashRefundCount: 0,
        paymentMethodTotals: const [],
      );

  @override
  Future<PosCashMovement> createMovement({
    required String cashSessionId,
    required String movementType,
    required String amount,
    required String reasonCode,
    String? note,
    String? category,
  }) async {
    movementCalls.add((cashSessionId: cashSessionId, movementType: movementType, category: category));
    return PosCashMovement(
      id: 'movement-1',
      cashSessionId: cashSessionId,
      movementType: movementType,
      amount: amount,
      currencyCode: 'MXN',
      reasonCode: reasonCode,
      note: note,
      occurredAt: DateTime.utc(2026, 9, 7, 10),
      createdBy: 'user-id',
      category: category,
    );
  }

  @override
  Future<PosCashMovementPage> listMovements(
    String cashSessionId, {
    String? cursor,
    int limit = 50,
  }) async => const PosCashMovementPage(items: [], nextCursor: null);

  @override
  Future<PosCashSession> closeSession({
    required String cashSessionId,
    required String declaredClosingAmount,
    List<PosCashDenominationCount>? denominationCounts,
    String? discrepancyReason,
    List<PosCashCardReconciliationEntry>? cardReconciliationEntries,
    String? cardReconciliationNote,
  }) => Future.error(StateError('not used'));

  @override
  Future<PosCashSessionHistoryPage> listSessions({
    PosCashSessionHistoryFilter filter = const PosCashSessionHistoryFilter(),
    String? cursor,
    int limit = 50,
  }) async => const PosCashSessionHistoryPage(items: [], nextCursor: null);

  @override
  Future<PosCashSessionPartialClose> partialCloseSession(String cashSessionId) async {
    partialCloseCalls.add(cashSessionId);
    return partialCloseResult ??
        PosCashSessionPartialClose(
          id: 'partial-fixture',
          cashSessionId: cashSessionId,
          takenAt: DateTime.utc(2026, 9, 7, 11),
          openingAmount: '1000.0000',
          cashSalesTotal: '9.0000',
          cashInTotal: '0.0000',
          cashOutTotal: '0.0000',
          expectedCash: '1009.0000',
          createdBy: 'user-id',
          createdAt: DateTime.utc(2026, 9, 7, 11),
          operationalSummary: null,
        );
  }

  @override
  Future<List<PosCashSessionPartialClose>> listPartialCloses(String cashSessionId) async =>
      partialClosesResult;

  @override
  Future<PosCashMovement> reverseMovement({
    required String cashSessionId,
    required String movementId,
    required String reasonCode,
    String? note,
  }) => Future.error(StateError('not used'));

  @override
  Future<List<PosCashAuditEntry>> auditLog(
    String cashSessionId, {
    int limit = 100,
  }) async => const [];
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
  user: const UserSummary(
    id: 'user-id',
    displayName: 'Usuario AS',
    email: 'user@example.test',
  ),
  companies: const [
    CompanySummary(id: 'company-id', name: 'Empresa AS', current: true),
  ],
  branches: const [
    BranchSummary(
      id: 'branch-id',
      code: 'CENTRO',
      name: 'Sucursal Centro',
      timezone: 'America/Mexico_City',
      current: true,
    ),
  ],
  companyWideAccess: false,
  permissions: const [
    'catalog.read',
    'inventory.read',
    'user.read',
    'sale.create',
    'held_sale.manage',
    'cash_session.read',
    'cash_movement.create',
    'cash_session.open',
    'cash_session.close',
  ],
);

/// Same session/user, but WITH `sale.cancel` — the other branch of
/// `held-sales.service.ts`'s own `releaseCart` gate.
final _contextWithSaleCancel = AuthenticatedContext(
  session: _context.session,
  user: _context.user,
  companies: _context.companies,
  branches: _context.branches,
  companyWideAccess: false,
  permissions: [..._context.permissions, 'sale.cancel'],
);

Future<void> _pump(
  WidgetTester tester, {
  AuthenticatedContext? context,
  PosCashGateway? cashGateway,
  PosHeldSalesGateway? heldSalesGateway,
}) async {
  tester.view.physicalSize = const Size(1440, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      home: PosShell(
        context: context ?? _context,
        controller: PosReadController(const EmptyPosReadGateway()),
        salesGateway: const _UnusedSalesGateway(),
        paymentsGateway: const EmptyPosPaymentsGateway(),
        cashGateway: cashGateway ?? const EmptyPosCashGateway(),
        refundsGateway: const EmptyPosRefundsGateway(),
        promotionsGateway: const EmptyPosPromotionsGateway(),
        customersGateway: const EmptyPosCustomersGateway(),
        membershipsGateway: const EmptyPosMembershipsGateway(),
        loyaltyGateway: const EmptyPosLoyaltyGateway(),
        rewardsGateway: const EmptyPosRewardsGateway(),
        partiesGateway: const EmptyPosPartiesGateway(),
        heldSalesGateway: heldSalesGateway ?? const EmptyPosHeldSalesGateway(),
        purchasingGateway: const EmptyPosPurchasingGateway(),
        onLogout: () {},
        onBranchSelected: (_) async {},
      ),
    ),
  );
  await tester.pumpAndSettle();
}

class _UnusedSalesGateway implements PosSalesGateway {
  const _UnusedSalesGateway();

  @override
  Future<PosSaleCreated> createSale({
    required String branchId,
    required List<PosSaleLineRequest> items,
    List<String>? couponCodes,
    PosManualDiscountRequest? manualDiscount,
    String? customerId,
    String? rewardEntitlementId,
    String? note,
    String? cashRegisterId,
  }) => Future.error(StateError('not used'));

  @override
  Future<PosReceipt> receipt(String saleId) => Future.error(StateError('not used'));

  @override
  Future<PosSaleCreated> completeZeroTotalSale(String saleId) =>
      Future.error(StateError('not used'));

  @override
  Future<PosSaleHistoryPage> listSales({
    PosSaleHistoryFilter filter = const PosSaleHistoryFilter(),
    String? cursor,
    int limit = 50,
  }) => Future.error(StateError('not used'));
}

Future<void> _openGroupIfNeeded(WidgetTester tester, String group, String navKey) async {
  if (find.byKey(Key(navKey)).evaluate().isEmpty) {
    await tester.tap(find.byKey(Key('nav-group-$group')));
    await tester.pumpAndSettle();
  }
}

Future<void> _navigateToSuspended(WidgetTester tester) async {
  await _openGroupIfNeeded(tester, 'Ventas', 'nav-suspended');
  await tester.tap(find.byKey(const Key('nav-suspended')));
  await tester.pumpAndSettle();
}

Future<void> _navigateToCaja(WidgetTester tester) async {
  await _openGroupIfNeeded(tester, 'Caja y Finanzas', 'nav-cash');
  await tester.tap(find.byKey(const Key('nav-cash')));
  await tester.pumpAndSettle();
}
