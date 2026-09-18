/// TASK 14.3 (Wave 1, Parts B and C): widget tests for the cashier-
/// workflow conveniences and quick-restock feature added to `pos_shell.dart`
/// — sale note, barcode scanning, weight-based products, suspended/held
/// sales, and Direct Purchase / quick restock. Kept as a dedicated file
/// (rather than growing the already very large `pos_shell_test.dart`
/// further) — matches this codebase's own convention of splitting very
/// large feature suites (see e.g. how parties/Fiestas got its own
/// fixtures at the tail of `pos_shell_test.dart`).
///
/// Mirrors `pos_shell_test.dart`'s own `_Fake*Gateway`/`_pump` fixture
/// pattern exactly — every gateway this suite doesn't specifically
/// exercise uses the real `Empty*Gateway` the app itself falls back to,
/// never an invented stub.
library;

import 'package:as_one/features/authentication/auth_models.dart';
import 'package:as_one/features/pos/pos_cash_gateway.dart';
import 'package:as_one/features/pos/pos_customers_gateway.dart';
import 'package:as_one/features/pos/pos_held_sales_gateway.dart';
import 'package:as_one/features/pos/pos_loyalty_gateway.dart';
import 'package:as_one/features/pos/pos_memberships_gateway.dart';
import 'package:as_one/features/pos/pos_models.dart';
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
  group('TASK 14.3 Wave 1 Part B.4 — Sale note', () {
    testWidgets(
      'a note captured on the ticket is threaded into POST /sales as the '
      'real note',
      (tester) async {
        final gateway = _RecordingSalesGateway();
        await _pump(tester, salesGateway: gateway);
        await _navigateToPos(tester);
        await tester.tap(find.byKey(const Key('pos-product-product-1')));
        await tester.pump();

        await tester.tap(find.byKey(const Key('pos-ticket-note-button')));
        await tester.pumpAndSettle();
        await tester.enterText(
          find.byKey(const Key('pos-ticket-note-field')),
          'Sin bolsa, entregar en caja 2',
        );
        await tester.tap(find.byKey(const Key('pos-ticket-note-save')));
        await tester.pumpAndSettle();

        // Efectivo is the real default — select Tarjeta so Cobrar exercises
        // the card path, which calls `createSale` without needing an open
        // cash session first (mirrors `pos_shell_test.dart`'s own Cobrar
        // fixtures).
        await tester.tap(find.byKey(const Key('pos-pay-card')));
        await tester.pump();
        await tester.tap(find.byKey(const Key('pos-ticket-cobrar')));
        await tester.pump();
        await tester.pumpAndSettle();

        expect(gateway.calls, hasLength(1));
        expect(gateway.calls.single.note, 'Sin bolsa, entregar en caja 2');
      },
    );

    testWidgets('omitting a note keeps the pre-existing request shape (null)', (
      tester,
    ) async {
      final gateway = _RecordingSalesGateway();
      await _pump(tester, salesGateway: gateway);
      await _navigateToPos(tester);
      await tester.tap(find.byKey(const Key('pos-product-product-1')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('pos-pay-card')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('pos-ticket-cobrar')));
      await tester.pump();
      await tester.pumpAndSettle();

      expect(gateway.calls, hasLength(1));
      expect(gateway.calls.single.note, isNull);
    });
  });

  group('TASK 14.3 Wave 1 Part B.2 — Barcode scanning', () {
    testWidgets(
      'an exact barcode match adds the product directly, no extra click',
      (tester) async {
        await _pump(tester);
        await _navigateToPos(tester);

        await tester.enterText(
          find.byKey(const Key('pos-sale-search')),
          '7501234567890',
        );
        await tester.testTextInput.receiveAction(TextInputAction.done);
        await tester.pumpAndSettle();

        expect(
          find.byKey(const Key('pos-ticket-line-product-barcode-1')),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'a barcode with no match shows an honest not-found notice — never a '
      'fabricated/random add (the legacy fix)',
      (tester) async {
        await _pump(tester);
        await _navigateToPos(tester);

        await tester.enterText(
          find.byKey(const Key('pos-sale-search')),
          '0000000000000',
        );
        await tester.testTextInput.receiveAction(TextInputAction.done);
        await tester.pumpAndSettle();

        expect(
          find.text(
            'No se encontró ningún producto con el código «0000000000000».',
          ),
          findsOneWidget,
        );
        // The ticket must stay honestly empty — no line was fabricated.
        expect(find.byKey(const Key('pos-ticket-lines')), findsNothing);
      },
    );
  });

  group('TASK 14.3 Wave 1 Part B.3 — Weight-based products', () {
    testWidgets(
      'tapping a kg product opens the weight dialog and computes the exact '
      'fixed-point total for a non-trivial (2.5 kg) case',
      (tester) async {
        await _pump(tester);
        await _navigateToPos(tester);

        await tester.tap(find.byKey(const Key('pos-product-product-weight-1')));
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('pos-weight-input')), findsOneWidget);
        await tester.enterText(
          find.byKey(const Key('pos-weight-input')),
          '2.5',
        );
        await tester.pump();

        // 2.5 kg × $36.5000/kg = $91.25 exactly — asserted as the exact
        // rendered string, never an approximate float compare.
        expect(
          find.text('Total de la línea: \$91.25'),
          findsOneWidget,
        );

        await tester.tap(find.byKey(const Key('pos-weight-confirm')));
        await tester.pumpAndSettle();

        expect(
          find.byKey(const Key('pos-ticket-line-product-weight-1')),
          findsOneWidget,
        );
        // The real decimal quantity, never rounded to a whole unit.
        expect(find.text('2.500 kg'), findsOneWidget);
        expect(find.text('\$91.25'), findsWidgets);
      },
    );
  });

  group('TASK 14.3 Wave 1 Part B.1 — Suspender venta', () {
    testWidgets(
      'Suspender venta calls the real held-sale-carts endpoint with the '
      'current cart\'s real product/quantity pairs, then clears the ticket',
      (tester) async {
        final gateway = _RecordingHeldSalesGateway();
        await _pump(tester, heldSalesGateway: gateway);
        await _navigateToPos(tester);
        await tester.tap(find.byKey(const Key('pos-product-product-1')));
        await tester.pump();

        await tester.tap(find.byKey(const Key('pos-ticket-suspend')));
        await tester.pumpAndSettle();

        expect(gateway.createCalls, hasLength(1));
        expect(gateway.createCalls.single.branchId, 'branch-id');
        expect(gateway.createCalls.single.items, hasLength(1));
        expect(gateway.createCalls.single.items.single.productId, 'product-1');
        expect(gateway.createCalls.single.items.single.quantity, '1');
        // The on-screen ticket is cleared once suspend succeeds.
        expect(find.byKey(const Key('pos-ticket-lines')), findsNothing);
      },
    );
  });

  group('TASK 14.3 Wave 1 Part B.1 — Ventas Suspendidas (list/resume/discard)', () {
    testWidgets(
      'Restaurar repopulates the on-screen ticket from the gateway\'s '
      'returned items',
      (tester) async {
        final heldCart = PosHeldSaleCart(
          id: 'cart-1',
          branchId: 'branch-id',
          cashRegisterId: null,
          customerId: null,
          label: 'Mesa 3',
          items: const [
            PosHeldSaleCartItem(productId: 'product-1', quantity: '2'),
          ],
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
        final gateway = _RecordingHeldSalesGateway(
          listResult: PosHeldSaleCartPage(items: [heldCart], nextCursor: null),
          resumeResult: heldCart,
        );
        await _pump(tester, heldSalesGateway: gateway);
        await _navigateToSuspended(tester);

        expect(find.text('Mesa 3'), findsOneWidget);
        await tester.tap(find.byKey(const Key('pos-held-sale-resume-cart-1')));
        await tester.pumpAndSettle();

        expect(gateway.resumeCalls, ['cart-1']);
        // Navigated back to the real POS ticket, repopulated for real —
        // 2 units of product-1, re-resolved through the loaded catalog.
        expect(find.byKey(const Key('pos-ticket-line-product-1')), findsOneWidget);
      },
    );

    testWidgets(
      'Descartar requires an explicit confirmation before calling the '
      'gateway — never a single-tap accidental discard',
      (tester) async {
        final heldCart = PosHeldSaleCart(
          id: 'cart-1',
          branchId: 'branch-id',
          cashRegisterId: null,
          customerId: null,
          label: null,
          items: const [
            PosHeldSaleCartItem(productId: 'product-1', quantity: '1'),
          ],
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
        final gateway = _RecordingHeldSalesGateway(
          listResult: PosHeldSaleCartPage(items: [heldCart], nextCursor: null),
        );
        await _pump(tester, heldSalesGateway: gateway);
        await _navigateToSuspended(tester);

        // TASK 14.4 (Wave 2, Part A) widened the Acciones column with a
        // new "Liberar" button — Descartar can now sit past the
        // horizontally-scrollable table's initial viewport, so it must be
        // scrolled into view before tapping it (mirrors this same file's
        // own `_openGroupIfNeeded` care about only interacting with
        // actually-visible widgets).
        await tester.ensureVisible(find.byKey(const Key('pos-held-sale-discard-cart-1')));
        await tester.tap(find.byKey(const Key('pos-held-sale-discard-cart-1')));
        await tester.pumpAndSettle();

        // The confirmation dialog is shown — the gateway is NOT yet called.
        expect(gateway.discardCalls, isEmpty);
        expect(
          find.byKey(const Key('pos-held-sale-discard-confirm')),
          findsOneWidget,
        );

        await tester.tap(find.byKey(const Key('pos-held-sale-discard-confirm')));
        await tester.pumpAndSettle();

        expect(gateway.discardCalls, ['cart-1']);
      },
    );
  });

  group('TASK 14.3 Wave 1 Part C — Compra Directa / quick restock', () {
    testWidgets(
      'the direct-purchase form calls the real endpoint with the exact '
      'entered values and computes the exact fixed-point total',
      (tester) async {
        final gateway = _RecordingPurchasingGateway();
        await _pump(tester, purchasingGateway: gateway);
        await _navigateToPurchases(tester);
        await tester.pumpAndSettle();

        // TASK 14.3 (Wave 4): "Compras" is now a 3-tab screen (Órdenes /
        // Compra Directa / Historial), defaulting to Órdenes — switch to
        // the Compra Directa tab first, mirroring
        // `pos_inventory_admin_test.dart`'s own established
        // `SegmentedButton` tab-switch pattern.
        await tester.tap(
          find.descendant(
            of: find.byKey(const Key('pos-purchases-tabs')),
            matching: find.text('Compra Directa'),
          ),
        );
        await tester.pumpAndSettle();

        await tester.tap(find.byKey(const Key('pos-direct-purchase-product')));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Producto Unitario (SKU-1)').last);
        await tester.pumpAndSettle();

        await tester.enterText(
          find.byKey(const Key('pos-direct-purchase-quantity')),
          '10',
        );
        await tester.enterText(
          find.byKey(const Key('pos-direct-purchase-unit-cost')),
          '5.50',
        );
        await tester.enterText(
          find.byKey(const Key('pos-direct-purchase-supplier')),
          'Proveedor de Prueba',
        );
        await tester.enterText(
          find.byKey(const Key('pos-direct-purchase-notes')),
          'Nota de prueba',
        );
        await tester.pump();

        // 10 × $5.5000 = $55.00 exactly — the real fixed-point utility,
        // never raw `double` arithmetic.
        expect(find.text('Total: \$55.00'), findsOneWidget);

        await tester.tap(find.byKey(const Key('pos-direct-purchase-submit')));
        await tester.pumpAndSettle();

        expect(gateway.createCalls, hasLength(1));
        final call = gateway.createCalls.single;
        expect(call.branchId, 'branch-id');
        expect(call.productVariantId, 'variant-1');
        expect(call.quantity, '10');
        expect(call.unitCost, '5.5000');
        expect(call.currencyCode, 'MXN');
        expect(call.supplierName, 'Proveedor de Prueba');
        expect(call.notes, 'Nota de prueba');
      },
    );
  });
}

// --- Fixtures -----------------------------------------------------------

PosPricing _price(String amount) =>
    PosPricing.fromJson({'amount': amount, 'currency_code': 'MXN'});

final _unitProduct = PosProduct(
  id: 'product-1',
  code: 'P1',
  name: 'Producto Unitario',
  type: 'simple',
  status: 'active',
  tracksInventory: false,
  defaultVariantId: 'variant-1',
  sku: 'SKU-1',
  taxCode: 'IVA_GENERAL',
  pricing: _price('10.0000'),
);

final _weightProduct = PosProduct(
  id: 'product-weight-1',
  code: 'PW1',
  name: 'Queso Manchego',
  type: 'simple',
  status: 'active',
  tracksInventory: false,
  defaultVariantId: 'variant-weight-1',
  sku: 'SKU-W1',
  taxCode: 'IVA_GENERAL',
  pricing: _price('36.5000'),
  unitOfMeasureCode: 'kg',
  quantityScale: 3,
);

final _barcodeProduct = PosProduct(
  id: 'product-barcode-1',
  code: 'PB1',
  name: 'Refresco de Cola',
  type: 'simple',
  status: 'active',
  tracksInventory: false,
  defaultVariantId: 'variant-barcode-1',
  sku: 'SKU-B1',
  taxCode: 'IVA_GENERAL',
  pricing: _price('25.0000'),
);

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
    'sale.cancel',
    'purchase.create',
    'purchase.read',
  ],
);

class _FixtureReadGateway implements PosReadGateway {
  const _FixtureReadGateway();

  @override
  Future<List<PosProduct>> products({String? branchId}) async =>
      [_unitProduct, _weightProduct, _barcodeProduct];

  @override
  Future<PosProduct?> productByBarcode(String barcode, {String? branchId}) async =>
      barcode == '7501234567890' ? _barcodeProduct : null;

  @override
  Future<List<PosCategory>> categories() async => const [];

  @override
  Future<List<PosInventoryBalance>> inventoryBalances({String? branchId}) async => const [];

  @override
  Future<List<PosUser>> users() async => const [];
}

class _RecordingSalesGateway implements PosSalesGateway {
  final List<({String branchId, List<PosSaleLineRequest> items, String? note})> calls = [];

  @override
  Future<PosSaleCreated> createSale({
    required String branchId,
    required List<PosSaleLineRequest> items,
    List<String>? couponCodes,
    PosManualDiscountRequest? manualDiscount,
    String? customerId,
    String? rewardEntitlementId,
    String? note,
  }) async {
    calls.add((branchId: branchId, items: items, note: note));
    return const PosSaleCreated(
      id: 'sale-1',
      saleNumber: 'SALE-fixture',
      status: 'pending_payment',
      total: '10.0000',
    );
  }

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

class _RecordingHeldSalesGateway implements PosHeldSalesGateway {
  _RecordingHeldSalesGateway({
    this.listResult,
    this.resumeResult,
    this.discardResult,
  });
  final PosHeldSaleCartPage? listResult;
  final PosHeldSaleCart? resumeResult;
  final PosHeldSaleCart? discardResult;

  final List<({String branchId, List<PosHeldSaleCartItemRequest> items})> createCalls = [];
  final List<String> resumeCalls = [];
  final List<String> releaseCalls = [];
  final List<String> discardCalls = [];

  @override
  Future<PosHeldSaleCart> createCart({
    required String branchId,
    String? cashRegisterId,
    String? customerId,
    String? label,
    required List<PosHeldSaleCartItemRequest> items,
  }) async {
    createCalls.add((branchId: branchId, items: items));
    return PosHeldSaleCart(
      id: 'cart-fixture',
      branchId: branchId,
      cashRegisterId: cashRegisterId,
      customerId: customerId,
      label: label,
      items: [
        for (final item in items) PosHeldSaleCartItem(productId: item.productId, quantity: item.quantity),
      ],
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
  }

  @override
  Future<PosHeldSaleCartPage> listCarts({
    PosHeldSaleCartListFilter filter = const PosHeldSaleCartListFilter(),
    String? cursor,
    int limit = 50,
  }) async {
    final page = listResult ?? const PosHeldSaleCartPage(items: [], nextCursor: null);
    // TASK 14.4 (Wave 2, Part A.2) — `_HeldSalesState` now issues one call
    // per status (`held` and `resuming`) and merges the results; this fake
    // must honor `filter.status` itself, or a fixture's single page would
    // otherwise come back twice (once per call) and duplicate every row.
    if (filter.status == null) return page;
    return PosHeldSaleCartPage(
      items: page.items.where((cart) => cart.status == filter.status).toList(growable: false),
      nextCursor: page.nextCursor,
    );
  }

  @override
  Future<PosHeldSaleCart> resumeCart(String id) async {
    resumeCalls.add(id);
    return resumeResult!;
  }

  @override
  Future<PosHeldSaleCart> linkSale({required String id, required String saleId}) async =>
      resumeResult!;

  @override
  Future<PosHeldSaleCart> releaseCart(String id) async {
    releaseCalls.add(id);
    return resumeResult!;
  }

  @override
  Future<PosHeldSaleCart> discardCart({required String id, String? reason}) async {
    discardCalls.add(id);
    return discardResult ?? resumeResult!;
  }
}

class _RecordingPurchasingGateway implements PosPurchasingGateway {
  final List<
      ({
        String branchId,
        String? supplierName,
        String? supplierId,
        String productVariantId,
        String quantity,
        String unitCost,
        String currencyCode,
        String purchaseDate,
        String? notes,
      })>
  createCalls = [];

  @override
  Future<PosDirectPurchase> createDirectPurchase({
    required String branchId,
    String? supplierName,
    String? supplierId,
    required String productVariantId,
    required String quantity,
    required String unitCost,
    required String currencyCode,
    required String purchaseDate,
    String? notes,
  }) async {
    createCalls.add((
      branchId: branchId,
      supplierName: supplierName,
      supplierId: supplierId,
      productVariantId: productVariantId,
      quantity: quantity,
      unitCost: unitCost,
      currencyCode: currencyCode,
      purchaseDate: purchaseDate,
      notes: notes,
    ));
    return PosDirectPurchase(
      id: 'purchase-1',
      branchId: branchId,
      supplierName: supplierName,
      supplierId: supplierId,
      productVariantId: productVariantId,
      quantity: quantity,
      unitCost: unitCost,
      currencyCode: currencyCode,
      totalCost: '0.0000',
      purchaseDate: purchaseDate,
      notes: notes,
      inventoryMovementId: 'movement-1',
      createdBy: 'user-id',
      createdAt: DateTime.utc(2026, 9, 1),
    );
  }

  @override
  Future<PosDirectPurchase> directPurchase(String id) => Future.error(StateError('not used'));

  @override
  Future<PosDirectPurchasePage> listDirectPurchases({
    PosDirectPurchaseListFilter filter = const PosDirectPurchaseListFilter(),
    String? cursor,
    int limit = 50,
  }) async => const PosDirectPurchasePage(items: [], nextCursor: null);

  @override
  Future<PosDirectPurchase> reverseDirectPurchase(String id, {required String reason}) =>
      Future.error(StateError('not used'));
}

Future<void> _pump(
  WidgetTester tester, {
  PosSalesGateway? salesGateway,
  PosReadGateway? readGateway,
  PosHeldSalesGateway? heldSalesGateway,
  PosPurchasingGateway? purchasingGateway,
}) async {
  tester.view.physicalSize = const Size(1440, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      home: PosShell(
        context: _context,
        controller: PosReadController(readGateway ?? const _FixtureReadGateway()),
        salesGateway: salesGateway ?? _RecordingSalesGateway(),
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
        purchasingGateway: purchasingGateway ?? const EmptyPosPurchasingGateway(),
        onLogout: () {},
        onBranchSelected: (_) async {},
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _openGroupIfNeeded(WidgetTester tester, String group, String navKey) async {
  if (find.byKey(Key(navKey)).evaluate().isEmpty) {
    await tester.tap(find.byKey(Key('nav-group-$group')));
    await tester.pumpAndSettle();
  }
}

Future<void> _navigateToPos(WidgetTester tester) async {
  await _openGroupIfNeeded(tester, 'Ventas', 'nav-pos');
  await tester.tap(find.byKey(const Key('nav-pos')));
  await tester.pumpAndSettle();
}

Future<void> _navigateToSuspended(WidgetTester tester) async {
  await _openGroupIfNeeded(tester, 'Ventas', 'nav-suspended');
  await tester.tap(find.byKey(const Key('nav-suspended')));
  await tester.pumpAndSettle();
}

Future<void> _navigateToPurchases(WidgetTester tester) async {
  await _openGroupIfNeeded(tester, 'Inventario', 'nav-purchases');
  await tester.tap(find.byKey(const Key('nav-purchases')));
  await tester.pumpAndSettle();
}
