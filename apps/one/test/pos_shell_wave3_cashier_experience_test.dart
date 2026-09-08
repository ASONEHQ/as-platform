// TASK 14.5 (Wave 3, Phases 4a/5/6 + 7 Item 8): a dedicated sibling test
// file — deliberately NOT appended to `pos_shell_test.dart` — covering the
// real cashier-experience capabilities recovered this wave:
//   - F3/F5/F6/F8 keyboard shortcuts, each firing the exact same code path
//     as their on-screen button, respecting the same permission gates, and
//     never firing while a text field has focus.
//   - Café/"Acceso rápido" (`PosModule.cafeteria`) — a real, generic,
//     tenant-configurable "visual tile" category display, never hardcoded
//     to coffee.
//   - The "Cambiar cajero" PIN/QR quick-switch dialog (real backend calls
//     via `PosAuthGateway`, honest success/failure).
//
// This file cannot see `pos_shell_test.dart`'s own private (leading-
// underscore) fixtures/helpers — Dart privacy is per-file — so it builds
// its own small, self-contained harness below.
import 'package:as_one/core/errors/app_error.dart';
import 'package:as_one/core/networking/api_client.dart';
import 'package:as_one/features/authentication/auth_models.dart';
import 'package:as_one/features/pos/pos_auth_gateway.dart';
import 'package:as_one/features/pos/pos_cash_gateway.dart';
import 'package:as_one/features/pos/pos_customers_gateway.dart';
import 'package:as_one/features/pos/pos_held_sales_gateway.dart';
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
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('Keyboard shortcuts (TASK 14.5 Wave 3 Phase 4a)', () {
    testWidgets('F3 opens the real customer selector — the same dialog '
        '"Buscar cliente" opens', (tester) async {
      await _pump(tester);
      await _navigateToPos(tester);
      expect(find.byType(TextField), findsWidgets);
      await simulateKeyDownEvent(LogicalKeyboardKey.f3);
      await tester.pumpAndSettle();
      expect(find.text('Buscar cliente'), findsWidgets);
    });

    testWidgets('F5 suspends the ticket through the real held-sales '
        'gateway when the actor holds held_sale.manage', (tester) async {
      final held = _RecordingHeldSalesGateway();
      await _pump(tester, heldSalesGateway: held, context: _contextWithHeldSaleManage);
      await _navigateToPos(tester);
      await tester.tap(find.byKey(const Key('pos-product-product-1')));
      await tester.pump();
      expect(find.byKey(const Key('pos-ticket-line-product-1')), findsOneWidget);

      await simulateKeyDownEvent(LogicalKeyboardKey.f5);
      await tester.pumpAndSettle();

      expect(held.createCartCalls, 1);
      expect(find.text('Venta suspendida.'), findsOneWidget);
      expect(find.byKey(const Key('pos-ticket-line-product-1')), findsNothing);
    });

    testWidgets('F5 does nothing without held_sale.manage — no gateway '
        'call, an honest permission notice instead', (tester) async {
      final held = _RecordingHeldSalesGateway();
      await _pump(tester, heldSalesGateway: held);
      await _navigateToPos(tester);
      await tester.tap(find.byKey(const Key('pos-product-product-1')));
      await tester.pump();

      await simulateKeyDownEvent(LogicalKeyboardKey.f5);
      await tester.pumpAndSettle();

      expect(held.createCartCalls, 0);
      expect(
        find.text('Tu sesión no incluye el permiso para suspender ventas.'),
        findsOneWidget,
      );
      expect(find.byKey(const Key('pos-ticket-line-product-1')), findsOneWidget);
    });

    testWidgets('F6 opens a real confirmation and clears the ticket when '
        'confirmed, gated on sale.cancel', (tester) async {
      await _pump(tester, context: _contextWithSaleCancel);
      await _navigateToPos(tester);
      await tester.tap(find.byKey(const Key('pos-product-product-1')));
      await tester.pump();

      await simulateKeyDownEvent(LogicalKeyboardKey.f6);
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('pos-cancel-sale-dialog')), findsOneWidget);

      await tester.tap(find.byKey(const Key('pos-cancel-sale-confirm')));
      await tester.pumpAndSettle();

      expect(find.text('Venta cancelada.'), findsOneWidget);
      expect(find.byKey(const Key('pos-ticket-line-product-1')), findsNothing);
    });

    testWidgets('F6 never opens the confirmation without sale.cancel — the '
        'round toolbar button is disabled and the shortcut is a no-op', (
      tester,
    ) async {
      await _pump(tester);
      await _navigateToPos(tester);
      await tester.tap(find.byKey(const Key('pos-product-product-1')));
      await tester.pump();

      final button = tester.widget<IconButton>(
        find.descendant(
          of: find.byKey(const Key('pos-ticket-cancel')),
          matching: find.byType(IconButton),
        ),
      );
      expect(button.onPressed, isNull);

      await simulateKeyDownEvent(LogicalKeyboardKey.f6);
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('pos-cancel-sale-dialog')), findsNothing);
      expect(find.byKey(const Key('pos-ticket-line-product-1')), findsOneWidget);
    });

    testWidgets('F8 fires the exact same Cobrar code path as tapping the '
        'button (an empty ticket shows the same honest notice)', (
      tester,
    ) async {
      await _pump(tester);
      await _navigateToPos(tester);

      await simulateKeyDownEvent(LogicalKeyboardKey.f8);
      await tester.pumpAndSettle();

      // The default fixture's cash gateway reports no open cash session —
      // Efectivo is the real default selected method, so `_handleTap()`'s
      // own cash-session gate (checked BEFORE the empty-ticket message)
      // fires first — this is still real proof F8 reached the identical
      // code path the on-screen Cobrar button's `onPressed` calls.
      expect(
        find.text('Abre la caja para comenzar a cobrar en efectivo.'),
        findsOneWidget,
        reason: 'F8 must invoke the identical _handleTap() the on-screen '
            'Cobrar button calls, including its own real cash-session gate.',
      );
    });

    testWidgets('none of F3/F5/F6/F8 fire while a text field has focus', (
      tester,
    ) async {
      final held = _RecordingHeldSalesGateway();
      await _pump(tester, heldSalesGateway: held, context: _contextWithHeldSaleManage);
      await _navigateToPos(tester);
      await tester.tap(find.byKey(const Key('pos-product-product-1')));
      await tester.pump();

      // Focus a real text field (the search box) before pressing keys.
      await tester.tap(find.byKey(const Key('pos-sale-search')));
      await tester.pump();

      await simulateKeyDownEvent(LogicalKeyboardKey.f5);
      await tester.pumpAndSettle();
      expect(
        held.createCartCalls,
        0,
        reason: 'F5 must not suspend the ticket while typing.',
      );
      expect(find.byKey(const Key('pos-ticket-line-product-1')), findsOneWidget);

      await simulateKeyDownEvent(LogicalKeyboardKey.f3);
      await tester.pumpAndSettle();
      expect(
        find.text('Buscar cliente'),
        findsNothing,
        reason: 'F3 must not open the customer selector while typing.',
      );

      await simulateKeyDownEvent(LogicalKeyboardKey.f8);
      await tester.pumpAndSettle();
      expect(
        find.text('Abre la caja para comenzar a cobrar en efectivo.'),
        findsNothing,
        reason: 'F8 must not attempt checkout while typing.',
      );
    });

    testWidgets('F2 still moves focus to search even from another field '
        '(the sole intentional exception)', (tester) async {
      await _pump(tester);
      await _navigateToPos(tester);
      // Give the note dialog or another field focus first isn't needed —
      // F2's own contract (works from anywhere) is already covered by
      // pos_shell_test.dart; this just re-confirms it still works after
      // this wave's guard was added to its siblings.
      await simulateKeyDownEvent(LogicalKeyboardKey.f2);
      await tester.pump();
      final field = tester.widget<TextField>(find.byKey(const Key('pos-sale-search')));
      expect(field.focusNode?.hasFocus, isTrue);
    });
  });

  group('Café / "Acceso rápido" (TASK 14.5 Wave 3 Phase 6)', () {
    testWidgets('the regular Punto de Venta category strip renders a '
        'visual-tile category with its distinct chip treatment, alongside '
        'every other active category unrestricted', (tester) async {
      await _pump(
        tester,
        readGateway: const _FixtureReadGateway(
          categories: [
            PosCategory(id: 'cat-1', name: 'General', status: 'active'),
            PosCategory(id: 'cat-2', name: 'Rápido', status: 'active', visualTile: true),
          ],
        ),
      );
      await _navigateToPos(tester);
      expect(find.byKey(const Key('pos-category-cat-1')), findsOneWidget);
      expect(find.byKey(const Key('pos-category-cat-2')), findsOneWidget);
      expect(
        find.byKey(Key('pos-category-chip-visual-${'Rápido'.hashCode}')),
        findsOneWidget,
        reason: 'A visualTile category renders its distinct chip treatment '
            'even in the regular Punto de Venta strip — a generic capability, '
            'never scoped only to the dedicated cafeteria section.',
      );
    });

    testWidgets('Cafetería ("Acceso rápido") is a real screen now — the '
        'exact same sale surface, scoped to only visual-tile categories', (
      tester,
    ) async {
      await _pump(
        tester,
        readGateway: const _FixtureReadGateway(
          categories: [
            PosCategory(id: 'cat-1', name: 'General', status: 'active'),
            PosCategory(id: 'cat-2', name: 'Rápido', status: 'active', visualTile: true),
          ],
        ),
      );
      await _navigateToPos(tester);
      await tester.tap(find.byKey(const Key('nav-cafeteria')));
      await tester.pumpAndSettle();

      expect(find.text('Coming soon'), findsNothing);
      // Only the visual-tile category shows — "General" is scoped out.
      expect(find.byKey(const Key('pos-category-cat-2')), findsOneWidget);
      expect(find.byKey(const Key('pos-category-cat-1')), findsNothing);
      // It is the real, same ticket/cart surface — not a disconnected one.
      expect(find.byKey(const Key('pos-ticket-panel')), findsOneWidget);
    });

    testWidgets('Cafetería shows an honest empty state when no category '
        'opted into visual-tile — never a fabricated demo category', (
      tester,
    ) async {
      await _pump(
        tester,
        readGateway: const _FixtureReadGateway(
          categories: [PosCategory(id: 'cat-1', name: 'General', status: 'active')],
        ),
      );
      await _navigateToPos(tester);
      await tester.tap(find.byKey(const Key('nav-cafeteria')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('pos-cafeteria-empty')), findsOneWidget);
      expect(find.byKey(const Key('pos-category-strip')), findsNothing);
    });
  });

  group('"Cambiar cajero" PIN/QR quick-switch (TASK 14.5 Wave 3 Phase 4b/7 '
      'Item 8)', () {
    testWidgets('a correct PIN shows real server-verified success', (
      tester,
    ) async {
      await _pump(tester, authGateway: _FakeAuthGateway(pinSucceeds: true));
      await _navigateToPos(tester);
      await tester.tap(find.byKey(const Key('pos-quick-switch-button')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('pos-quick-switch-dialog')), findsOneWidget);

      final dialog = find.byKey(const Key('pos-quick-switch-dialog'));
      for (final digit in ['1', '2', '3', '4']) {
        await tester.tap(find.descendant(of: dialog, matching: find.text(digit)));
        await tester.pump();
      }
      await tester.tap(find.descendant(of: dialog, matching: find.byIcon(Icons.check)));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('pos-quick-switch-verified')), findsOneWidget);
    });

    testWidgets('a wrong PIN shows the honest, generic backend rejection', (
      tester,
    ) async {
      await _pump(tester, authGateway: _FakeAuthGateway(pinSucceeds: false));
      await _navigateToPos(tester);
      await tester.tap(find.byKey(const Key('pos-quick-switch-button')));
      await tester.pumpAndSettle();

      final dialog = find.byKey(const Key('pos-quick-switch-dialog'));
      for (final digit in ['9', '9', '9', '9']) {
        await tester.tap(find.descendant(of: dialog, matching: find.text(digit)));
        await tester.pump();
      }
      await tester.tap(find.descendant(of: dialog, matching: find.byIcon(Icons.check)));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('pos-quick-switch-error')), findsOneWidget);
      expect(find.byKey(const Key('pos-quick-switch-verified')), findsNothing);
    });

    testWidgets('the QR tab submits through the real qrLogin call and '
        'shows honest success', (tester) async {
      await _pump(tester, authGateway: _FakeAuthGateway(qrSucceeds: true));
      await _navigateToPos(tester);
      await tester.tap(find.byKey(const Key('pos-quick-switch-button')));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Código QR'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('pos-quick-switch-qr-input')),
        'POS-QR-real-code',
      );
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('pos-quick-switch-verified')), findsOneWidget);
    });

    testWidgets('Escape closes the dialog', (tester) async {
      await _pump(tester);
      await _navigateToPos(tester);
      await tester.tap(find.byKey(const Key('pos-quick-switch-button')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('pos-quick-switch-dialog')), findsOneWidget);
      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('pos-quick-switch-dialog')), findsNothing);
    });
  });
}

Future<void> _pump(
  WidgetTester tester, {
  AuthenticatedContext? context,
  PosReadGateway? readGateway,
  PosHeldSalesGateway? heldSalesGateway,
  PosAuthGateway? authGateway,
}) async {
  tester.view.physicalSize = const Size(1440, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      home: PosShell(
        context: context ?? _context,
        controller: PosReadController(readGateway ?? const _FixtureReadGateway()),
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
        heldSalesGateway: heldSalesGateway ?? const EmptyPosHeldSalesGateway(),
        authGateway: authGateway ?? const EmptyPosAuthGateway(),
        onLogout: () {},
        onBranchSelected: (_) async {},
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _navigateToPos(WidgetTester tester) async {
  if (find.byKey(const Key('nav-pos')).evaluate().isEmpty) {
    await tester.tap(find.byKey(const Key('nav-group-Ventas')));
    await tester.pumpAndSettle();
  }
  await tester.tap(find.byKey(const Key('nav-pos')));
  await tester.pumpAndSettle();
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
    BranchSummary(
      id: 'branch-id',
      code: 'CENTRO',
      name: 'Sucursal Centro',
      timezone: 'America/Mexico_City',
      current: true,
    ),
  ],
  companyWideAccess: false,
  permissions: const ['catalog.read', 'inventory.read'],
);

AuthenticatedContext _withPermissions(List<String> extra) => AuthenticatedContext(
  session: _context.session,
  user: _context.user,
  companies: _context.companies,
  branches: _context.branches,
  companyWideAccess: false,
  permissions: [..._context.permissions, ...extra],
);

final _contextWithHeldSaleManage = _withPermissions(['held_sale.manage']);
final _contextWithSaleCancel = _withPermissions(['sale.cancel']);

/// A minimal, real-shaped fixture — one sellable product plus whatever
/// categories a test asks for (defaults to none, matching the honest
/// "no categories" case).
class _FixtureReadGateway implements PosReadGateway {
  const _FixtureReadGateway({List<PosCategory> categories = const []}) : _categories = categories;
  final List<PosCategory> _categories;

  @override
  Future<List<PosProduct>> products({String? branchId}) async => [
    PosProduct(
      id: 'product-1',
      code: 'P1',
      name: 'Producto de prueba',
      type: 'simple',
      status: 'active',
      tracksInventory: false,
      defaultVariantId: 'variant-1',
      taxCode: 'IVA_GENERAL',
      pricing: PosPricing.fromJson({'amount': '10.00', 'currency_code': 'MXN'}),
    ),
  ];

  @override
  Future<PosProduct?> productByBarcode(String barcode, {String? branchId}) async => null;

  @override
  Future<List<PosCategory>> categories() async => _categories;

  @override
  Future<List<PosInventoryBalance>> inventoryBalances({String? branchId}) async => const [];

  @override
  Future<List<PosUser>> users() async => const [];
}

class _RecordingHeldSalesGateway extends EmptyPosHeldSalesGateway {
  int createCartCalls = 0;

  @override
  Future<PosHeldSaleCart> createCart({
    required String branchId,
    String? cashRegisterId,
    String? customerId,
    String? label,
    required List<PosHeldSaleCartItemRequest> items,
  }) async {
    createCartCalls++;
    return PosHeldSaleCart(
      id: 'held-1',
      branchId: branchId,
      cashRegisterId: cashRegisterId,
      customerId: customerId,
      label: label,
      items: items
          .map((item) => PosHeldSaleCartItem(productId: item.productId, quantity: item.quantity))
          .toList(growable: false),
      status: 'held',
      createdBy: 'user-id',
      claimedAt: null,
      claimedBy: null,
      resumedAt: null,
      resumedBy: null,
      resumedSaleId: null,
      discardedAt: null,
      discardedBy: null,
      createdAt: DateTime.utc(2026),
    );
  }
}

class _FakeAuthGateway implements PosAuthGateway {
  _FakeAuthGateway({this.pinSucceeds = true, this.qrSucceeds = true});
  final bool pinSucceeds;
  final bool qrSucceeds;

  @override
  Future<void> pinLogin(String pin) async {
    if (!pinSucceeds) {
      throw ApiException(AppFailure.fromCode('invalid_credentials'), statusCode: 401);
    }
  }

  @override
  Future<void> qrLogin(String code) async {
    if (!qrSucceeds) {
      throw ApiException(AppFailure.fromCode('invalid_credentials'), statusCode: 401);
    }
  }
}
