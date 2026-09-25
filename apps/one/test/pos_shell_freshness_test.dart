/// TASK 16.17A — end-to-end live-tree regression for the exact TASK 16.17
/// bug: backend already has the real effective price, `PosCatalogAdminGateway
/// .createProductPrice`/`.changeProductPrice` already succeeded, but the POS
/// screen kept showing "Sin precio"/the old price until some UNRELATED
/// navigation happened to trigger a reload. See `pos_read_controller.dart`'s
/// own header doc comment for the root cause and the chosen fix.
///
/// Every test here builds a real `PosShell` wired exactly the way
/// `dashboard_screen.dart` (the app's own composition root) wires it —
/// admin-mutation gateways wrapped in the `FreshnessAware*` decorators
/// from `pos_catalog_freshness_gateways.dart`, sharing the SAME
/// `PosReadController` the POS screen itself reads from — so these tests
/// exercise the real production wiring, not a simplified stand-in.
/// `pos_read_controller_test.dart` and `pos_catalog_freshness_gateways_test
/// .dart` already cover the controller/decorators in isolation; this file
/// is deliberately the "does it actually work, live, in the UI" layer.
library;

import 'package:as_one/app/app.dart' show PlatformScope;
import 'package:as_one/features/authentication/auth_models.dart';
import 'package:as_one/features/pos/pos_cash_gateway.dart';
import 'package:as_one/features/pos/pos_catalog_admin_gateway.dart';
import 'package:as_one/features/pos/pos_catalog_freshness_gateways.dart';
import 'package:as_one/features/pos/pos_category_admin_gateway.dart';
import 'package:as_one/features/pos/pos_customers_gateway.dart';
import 'package:as_one/features/pos/pos_held_sales_gateway.dart';
import 'package:as_one/features/pos/pos_inventory_admin_gateway.dart' hide PosInventoryBalance;
import 'package:as_one/features/pos/pos_loyalty_gateway.dart';
import 'package:as_one/features/pos/pos_memberships_gateway.dart';
import 'package:as_one/features/pos/pos_models.dart';
import 'package:as_one/features/pos/pos_parties_gateway.dart';
import 'package:as_one/features/pos/pos_payments_gateway.dart';
import 'package:as_one/features/pos/pos_promotions_gateway.dart';
import 'package:as_one/features/pos/pos_purchase_orders_gateway.dart';
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
  group('TASK 16.17 exact bug regression', () {
    testWidgets(
      'product with no price shows "Sin precio"; once the admin '
      'creates an active price server-side, POS shows it immediately — '
      'NO manual refresh, NO navigation away and back',
      (tester) async {
        final readGateway = _MutableReadGateway(
          productsByBranch: {
            'branch-a': [_product('p1', name: 'Refresco')],
          },
        );
        final catalogAdminGateway = _MutatingCatalogAdminGateway(readGateway);
        final controller = PosReadController(readGateway);
        final wrapped = FreshnessAwareCatalogAdminGateway(catalogAdminGateway, controller);

        await _pump(tester, controller: controller, catalogAdminGateway: wrapped);
        await _navigateToPos(tester);

        expect(_priceCaptionOf(tester, 'p1'), 'Sin precio');

        // The admin's mutation — exactly what a real "Precios" tab call
        // does — goes through the SAME wrapped gateway instance the shell
        // was built with (mirrors a real admin screen sharing the app's
        // one `PlatformScope`-provided gateway).
        await wrapped.createProductPrice(
          'p1',
          const PosProductPriceInput(amount: '25.00', currencyCode: 'MXN'),
        );
        // Deliberately no `tester.tap` of any "Actualizar" affordance, no
        // re-navigation — just enough pumps to let the `unawaited`
        // invalidate → reload → notifyListeners chain finish.
        await tester.pump();
        await tester.pump();

        expect(_priceCaptionOf(tester, 'p1'), r'$25.00');
      },
    );

    testWidgets('changing an existing price updates POS immediately', (tester) async {
      final readGateway = _MutableReadGateway(
        productsByBranch: {
          'branch-a': [_product('p1', name: 'Refresco', amount: '10.00')],
        },
      );
      final catalogAdminGateway = _MutatingCatalogAdminGateway(readGateway);
      final controller = PosReadController(readGateway);
      final wrapped = FreshnessAwareCatalogAdminGateway(catalogAdminGateway, controller);

      await _pump(tester, controller: controller, catalogAdminGateway: wrapped);
      await _navigateToPos(tester);
      expect(_priceCaptionOf(tester, 'p1'), r'$10.00');

      await wrapped.changeProductPrice('p1', const PosProductPriceInput(amount: '15.50', currencyCode: 'MXN'));
      await tester.pump();
      await tester.pump();

      expect(_priceCaptionOf(tester, 'p1'), r'$15.50');
    });

    testWidgets('editing a product name updates the POS tile immediately', (tester) async {
      final readGateway = _MutableReadGateway(
        productsByBranch: {
          'branch-a': [_product('p1', name: 'Nombre viejo', amount: '10.00')],
        },
      );
      final catalogAdminGateway = _MutatingCatalogAdminGateway(readGateway);
      final controller = PosReadController(readGateway);
      final wrapped = FreshnessAwareCatalogAdminGateway(catalogAdminGateway, controller);

      await _pump(tester, controller: controller, catalogAdminGateway: wrapped);
      await _navigateToPos(tester);
      expect(find.text('Nombre viejo'), findsOneWidget);

      await wrapped.updateProduct('p1', 1, const PosProductPatchInput(name: 'Nombre nuevo'));
      await tester.pump();
      await tester.pump();

      expect(find.text('Nombre viejo'), findsNothing);
      expect(find.text('Nombre nuevo'), findsOneWidget);
    });
  });

  group('inventory freshness', () {
    testWidgets(
      'stock=0 shows "Sin existencia"; a real Compra Directa receipt of 10 '
      'is reflected immediately — no manual refresh',
      (tester) async {
        final readGateway = _MutableReadGateway(
          productsByBranch: {
            'branch-a': [
              _product('p1', name: 'Playera', amount: '10.00', tracksInventory: true, defaultVariantId: 'variant-p1'),
            ],
          },
          balancesByBranch: {
            'branch-a': [_balance('variant-p1', onHand: '0.000000')],
          },
        );
        final purchasingGateway = _MutatingPurchasingGateway(readGateway);
        final controller = PosReadController(readGateway);
        final wrapped = FreshnessAwarePurchasingGateway(purchasingGateway, controller);

        await _pump(tester, controller: controller, purchasingGateway: wrapped);
        await _navigateToPos(tester);
        expect(find.text('Sin existencia'), findsOneWidget);

        await wrapped.createDirectPurchase(
          branchId: 'branch-a',
          productVariantId: 'variant-p1',
          quantity: '10',
          unitCost: '5.00',
          currencyCode: 'MXN',
          purchaseDate: '2026-09-21',
        );
        await tester.pump();
        await tester.pump();

        expect(find.text('Sin existencia'), findsNothing);
      },
    );
  });

  group('sale → inventory freshness (never fabricated, never double-counted)', () {
    testWidgets(
      'a confirmed cash sale invalidates the shared balance cache exactly '
      'once — the next relevant read is a real backend re-fetch, never a '
      'client-side guess',
      (tester) async {
        final readGateway = _MutableReadGateway(
          productsByBranch: {
            'branch-a': [_product('p1', name: 'Refresco', amount: '10.00')],
          },
          balancesByBranch: {'branch-a': const []},
        );
        final controller = PosReadController(readGateway);
        final salesGateway = _FixtureSalesGateway();
        final paymentsGateway = _FixtureCashPaymentsGateway();

        await _pump(
          tester,
          controller: controller,
          salesGateway: salesGateway,
          paymentsGateway: paymentsGateway,
          cashGateway: const _OpenCashSessionGateway(),
        );
        await _navigateToPos(tester);
        // POS's own initial `_loadDataFor` already fetched balances once.
        final balancesCallsBeforeSale = readGateway.balancesCallCount;

        await tester.tap(find.byKey(const Key('pos-product-p1')));
        await tester.pump();
        await tester.tap(find.byKey(const Key('pos-ticket-cobrar')));
        await tester.pump();
        await tester.enterText(find.byKey(const Key('pos-cash-dialog-input')), '10');
        await tester.pump();
        await tester.tap(find.byKey(const Key('pos-cash-dialog-confirm')));
        await tester.pump();
        await tester.pumpAndSettle();

        expect(salesGateway.calls, hasLength(1));
        expect(paymentsGateway.cashCalls, hasLength(1));
        // Exactly one additional balances fetch — the real, backend-
        // authoritative post-sale state — never zero (a stale POS/admin
        // screen) and never more than one (a refresh loop/storm).
        expect(readGateway.balancesCallCount, balancesCallsBeforeSale + 1);
      },
    );
  });

  group('branch/company switch — never reuse another context\'s cached catalog', () {
    testWidgets(
      'switching branch shows the NEW branch\'s own price immediately, '
      'never the previous branch\'s stale one',
      (tester) async {
        final readGateway = _MutableReadGateway(
          productsByBranch: {
            'branch-a': [_product('p1', name: 'Refresco', amount: '10.00')],
            'branch-b': [_product('p1', name: 'Refresco', amount: '99.00')],
          },
        );
        final controller = PosReadController(readGateway);

        await _pump(tester, controller: controller, context: _context);
        await _navigateToPos(tester);
        expect(_priceCaptionOf(tester, 'p1'), r'$10.00');

        await _pump(tester, controller: controller, context: _contextBranchB);
        await _navigateToPos(tester);

        expect(_priceCaptionOf(tester, 'p1'), r'$99.00');
      },
    );

    testWidgets(
      'switching company (AuthController.switchCompany — no logout/login) '
      'resets the shared cache: the OLD company\'s product never survives '
      'into the NEW company\'s POS grid',
      (tester) async {
        final readGateway = _MutableReadGateway(
          productsByBranch: {
            'branch-a': [_product('p1', name: 'Producto de Empresa A', amount: '10.00')],
            'branch-company2': [_product('p2', name: 'Producto de Empresa B', amount: '20.00')],
          },
        );
        final controller = PosReadController(readGateway);

        await _pump(tester, controller: controller, context: _context);
        await _navigateToPos(tester);
        expect(find.text('Producto de Empresa A'), findsOneWidget);

        await _pump(tester, controller: controller, context: _contextCompany2);
        await _navigateToPos(tester);

        expect(find.text('Producto de Empresa A'), findsNothing);
        expect(find.text('Producto de Empresa B'), findsOneWidget);
      },
    );
  });

  group('failure behavior — never fabricate state', () {
    testWidgets(
      'a failed price mutation leaves the POS price exactly as it was — '
      'no fabricated new value, no corrupted cache',
      (tester) async {
        final readGateway = _MutableReadGateway(
          productsByBranch: {
            'branch-a': [_product('p1', name: 'Refresco', amount: '10.00')],
          },
        );
        final catalogAdminGateway = _MutatingCatalogAdminGateway(readGateway)..failNextMutation = true;
        final controller = PosReadController(readGateway);
        final wrapped = FreshnessAwareCatalogAdminGateway(catalogAdminGateway, controller);

        await _pump(tester, controller: controller, catalogAdminGateway: wrapped);
        await _navigateToPos(tester);
        expect(_priceCaptionOf(tester, 'p1'), r'$10.00');

        await expectLater(
          wrapped.changeProductPrice('p1', const PosProductPriceInput(amount: '999.00')),
          throwsA(isA<StateError>()),
        );
        await tester.pump();
        await tester.pump();

        // Still the real, last-known-good price — never "999.00" and
        // never a blank/"Sin precio" fabricated by a failed revalidation.
        expect(_priceCaptionOf(tester, 'p1'), r'$10.00');
      },
    );
  });
}

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------

final _context = AuthenticatedContext(
  session: SessionContext(
    id: 'session-id',
    userId: 'user-id',
    companyId: 'company-id',
    branchId: 'branch-a',
    permittedBranchIds: const ['branch-a'],
    companyWideAccess: false,
    expiresAt: DateTime.utc(2099),
  ),
  user: const UserSummary(id: 'user-id', displayName: 'Usuario AS', email: 'user@example.test'),
  companies: const [CompanySummary(id: 'company-id', name: 'Empresa A', current: true)],
  branches: const [
    BranchSummary(id: 'branch-a', code: 'A', name: 'Sucursal A', timezone: 'America/Mexico_City', current: true),
  ],
  companyWideAccess: false,
  permissions: const ['catalog.read', 'inventory.read', 'user.read', 'sale.create', 'purchase.create'],
);

final _contextBranchB = AuthenticatedContext(
  session: SessionContext(
    id: 'session-id',
    userId: 'user-id',
    companyId: 'company-id',
    branchId: 'branch-b',
    permittedBranchIds: const ['branch-a', 'branch-b'],
    companyWideAccess: false,
    expiresAt: DateTime.utc(2099),
  ),
  user: const UserSummary(id: 'user-id', displayName: 'Usuario AS', email: 'user@example.test'),
  companies: const [CompanySummary(id: 'company-id', name: 'Empresa A', current: true)],
  branches: const [
    BranchSummary(id: 'branch-b', code: 'B', name: 'Sucursal B', timezone: 'America/Mexico_City', current: true),
  ],
  companyWideAccess: false,
  permissions: const ['catalog.read', 'inventory.read', 'user.read', 'sale.create', 'purchase.create'],
);

/// TASK 16.17A — a real `AuthController.switchCompany` never routes
/// through `/login` (see `pos_shell.dart`'s own `didUpdateWidget` doc
/// comment on the `companyChanged` branch); this fixture's `session.id`
/// is deliberately kept THE SAME as `_context`'s to mirror that exact
/// characteristic (a company switch is not a new session).
final _contextCompany2 = AuthenticatedContext(
  session: SessionContext(
    id: 'session-id',
    userId: 'user-id',
    companyId: 'company-2',
    branchId: 'branch-company2',
    permittedBranchIds: const ['branch-company2'],
    companyWideAccess: false,
    expiresAt: DateTime.utc(2099),
  ),
  user: const UserSummary(id: 'user-id', displayName: 'Usuario AS', email: 'user@example.test'),
  companies: const [CompanySummary(id: 'company-2', name: 'Empresa B', current: true)],
  branches: const [
    BranchSummary(
      id: 'branch-company2',
      code: 'B2',
      name: 'Sucursal Empresa B',
      timezone: 'America/Mexico_City',
      current: true,
    ),
  ],
  companyWideAccess: false,
  permissions: const ['catalog.read', 'inventory.read', 'user.read', 'sale.create', 'purchase.create'],
);

PosProduct _product(
  String id, {
  required String name,
  String? amount,
  bool tracksInventory = false,
  String? defaultVariantId,
}) => PosProduct(
  id: id,
  code: id.toUpperCase(),
  name: name,
  type: 'simple',
  status: 'active',
  tracksInventory: tracksInventory,
  defaultVariantId: defaultVariantId,
  taxCode: 'IVA_GENERAL',
  pricing: amount == null
      ? const PosPricing.missing()
      : PosPricing.fromJson({'amount': amount, 'currency_code': 'MXN'}),
);

PosInventoryBalance _balance(String variantId, {required String onHand}) => PosInventoryBalance(
  id: 'balance-$variantId',
  branchId: 'branch-a',
  locationId: 'location-a',
  variantId: variantId,
  onHand: onHand,
  reserved: '0.000000',
  inTransit: '0.000000',
);

PosProduct _withOverrides(PosProduct p, {PosPricing? pricing, String? name, String? status}) => PosProduct(
  id: p.id,
  code: p.code,
  name: name ?? p.name,
  type: p.type,
  status: status ?? p.status,
  tracksInventory: p.tracksInventory,
  categoryId: p.categoryId,
  defaultVariantId: p.defaultVariantId,
  sku: p.sku,
  taxCode: p.taxCode,
  pricing: pricing ?? p.pricing,
  unitOfMeasureCode: p.unitOfMeasureCode,
  quantityScale: p.quantityScale,
  imageUrl: p.imageUrl,
  iconKey: p.iconKey,
  cardStyle: p.cardStyle,
  cardColorHex: p.cardColorHex,
  isFeatured: p.isFeatured,
);

/// The "backend": returns whatever is currently in [productsByBranch]/
/// [balancesByBranch] on every call — a mutation is only ever "real"
/// once it has actually changed this map, exactly mirroring how the real
/// `ApiPosReadGateway` always re-reads the database fresh.
class _MutableReadGateway implements PosReadGateway {
  _MutableReadGateway({
    Map<String, List<PosProduct>> productsByBranch = const {},
    Map<String, List<PosInventoryBalance>> balancesByBranch = const {},
  }) : productsByBranch = Map.of(productsByBranch),
       balancesByBranch = Map.of(balancesByBranch);

  final Map<String, List<PosProduct>> productsByBranch;
  final Map<String, List<PosInventoryBalance>> balancesByBranch;
  int productsCallCount = 0;
  int balancesCallCount = 0;

  @override
  Future<List<PosProduct>> products({String? branchId}) async {
    productsCallCount++;
    return List.of(productsByBranch[branchId] ?? const []);
  }

  @override
  Future<PosProduct?> productByBarcode(String barcode, {String? branchId}) async => null;

  @override
  Future<List<PosCategory>> categories() async => const [];

  @override
  Future<List<PosInventoryBalance>> inventoryBalances({String? branchId}) async {
    balancesCallCount++;
    return List.of(balancesByBranch[branchId] ?? const []);
  }

  @override
  Future<List<PosUser>> users() async => const [];

  @override
  Future<String> businessDate({required String timezone}) async => '2026-01-01';
}

/// A minimal `PosCatalogAdminGateway` whose price/product mutations write
/// straight into the SAME `_MutableReadGateway` the shell reads from —
/// every method not exercised by this file's tests throws, so an
/// accidental/unexpected call fails loudly rather than silently.
class _MutatingCatalogAdminGateway implements PosCatalogAdminGateway {
  _MutatingCatalogAdminGateway(this._read);
  final _MutableReadGateway _read;
  bool failNextMutation = false;

  void _mutate(String productId, PosProduct Function(PosProduct) update) {
    for (final entry in _read.productsByBranch.entries) {
      final index = entry.value.indexWhere((p) => p.id == productId);
      if (index != -1) {
        entry.value[index] = update(entry.value[index]);
      }
    }
  }

  @override
  Future<PosProductPrice> createProductPrice(String productId, PosProductPriceInput input) async {
    if (failNextMutation) throw StateError('simulated failure');
    _mutate(
      productId,
      (p) => _withOverrides(
        p,
        pricing: PosPricing.fromJson({'amount': input.amount, 'currency_code': input.currencyCode ?? 'MXN'}),
      ),
    );
    return _fixturePrice(productId, input);
  }

  @override
  Future<PosProductPrice> changeProductPrice(String productId, PosProductPriceInput input) async {
    if (failNextMutation) throw StateError('simulated failure');
    _mutate(
      productId,
      (p) => _withOverrides(
        p,
        pricing: PosPricing.fromJson({'amount': input.amount, 'currency_code': input.currencyCode ?? 'MXN'}),
      ),
    );
    return _fixturePrice(productId, input);
  }

  @override
  Future<PosCatalogProduct> updateProduct(String id, int version, PosProductPatchInput input) async {
    if (failNextMutation) throw StateError('simulated failure');
    _mutate(id, (p) => _withOverrides(p, name: input.name, status: input.status));
    return PosCatalogProduct(
      id: id,
      code: id.toUpperCase(),
      name: input.name ?? id,
      status: input.status ?? 'active',
      effectivePrice: null,
    );
  }

  static PosProductPrice _fixturePrice(String productId, PosProductPriceInput input) => PosProductPrice(
    id: 'price-$productId',
    branchId: input.branchId,
    productId: productId,
    priceType: 'base',
    amount: input.amount,
    currencyCode: input.currencyCode ?? 'MXN',
    validFrom: DateTime.utc(2026, 9, 21),
    validUntil: null,
    status: 'active',
    version: 1,
  );

  @override
  Future<PosCatalogProductPage> listProducts({String? cursor, int limit = 50, String? search, String? branchId}) =>
      Future.error(StateError('not used'));
  @override
  Future<PosCatalogProduct> product(String id) => Future.error(StateError('not used'));
  @override
  Future<PosCatalogVariantPage> listVariants(String productId, {String? cursor, int limit = 50}) =>
      Future.error(StateError('not used'));
  @override
  Future<PosProductOptionPage> listOptions(String productId, {String? cursor, int limit = 50}) =>
      Future.error(StateError('not used'));
  @override
  Future<PosProductOptionValuePage> listOptionValues(String optionId, {String? cursor, int limit = 50}) =>
      Future.error(StateError('not used'));
  @override
  Future<String> exportProductsCsv({String? status, String? productType, String? categoryId, String? brandId, String? search}) =>
      Future.error(StateError('not used'));
  @override
  Future<PosCatalogProduct> createProduct(PosNewProductInput input) => Future.error(StateError('not used'));
  @override
  Future<PosCatalogProduct> duplicateProduct(String id) => Future.error(StateError('not used'));
  @override
  Future<PosCatalogProduct> uploadProductImage(
    String id, {
    required List<int> bytes,
    required String filename,
    required String contentType,
    required int expectedVersion,
  }) => Future.error(StateError('not used'));
  @override
  Future<PosCatalogProduct> deleteProductImage(String id, int expectedVersion) => Future.error(StateError('not used'));
  @override
  Future<PosProductOption> createOption(String productId, PosNamedCreateInput input) => Future.error(StateError('not used'));
  @override
  Future<PosProductOption> updateOption(String optionId, int version, PosNamedPatchInput input) =>
      Future.error(StateError('not used'));
  @override
  Future<PosProductOptionValue> createOptionValue(String optionId, PosNamedCreateInput input) =>
      Future.error(StateError('not used'));
  @override
  Future<PosProductOptionValue> updateOptionValue(String valueId, int version, PosNamedPatchInput input) =>
      Future.error(StateError('not used'));
  @override
  Future<PosProductBarcode> createBarcode(String variantId, PosProductBarcodeInput input) =>
      Future.error(StateError('not used'));
  @override
  Future<PosProductBarcode> retireBarcode(String barcodeId, int version) => Future.error(StateError('not used'));
}

/// A minimal `PosPurchasingGateway` (Compra Directa) whose successful
/// receipt writes real stock straight into the shared
/// `_MutableReadGateway.balancesByBranch` — mirrors the real backend's
/// own "create the movement, on-hand goes up" behavior.
class _MutatingPurchasingGateway implements PosPurchasingGateway {
  _MutatingPurchasingGateway(this._read);
  final _MutableReadGateway _read;

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
    final list = _read.balancesByBranch.putIfAbsent(branchId, () => []);
    final index = list.indexWhere((b) => b.variantId == productVariantId);
    if (index == -1) {
      list.add(
        PosInventoryBalance(
          id: 'balance-$productVariantId',
          branchId: branchId,
          locationId: 'location-a',
          variantId: productVariantId,
          onHand: quantity,
          reserved: '0.000000',
          inTransit: '0.000000',
        ),
      );
    } else {
      final current = list[index];
      final newOnHand = BigInt.parse(current.onHand.split('.')[0]) + BigInt.parse(quantity.split('.')[0]);
      list[index] = PosInventoryBalance(
        id: current.id,
        branchId: current.branchId,
        locationId: current.locationId,
        variantId: current.variantId,
        onHand: '$newOnHand.000000',
        reserved: current.reserved,
        inTransit: current.inTransit,
      );
    }
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
      createdBy: 'user-1',
      createdAt: DateTime.utc(2026, 9, 21),
    );
  }

  @override
  Future<PosDirectPurchase> directPurchase(String id) => Future.error(StateError('not used'));
  @override
  Future<PosDirectPurchasePage> listDirectPurchases({
    PosDirectPurchaseListFilter filter = const PosDirectPurchaseListFilter(),
    String? cursor,
    int limit = 50,
  }) => Future.error(StateError('not used'));
  @override
  Future<PosDirectPurchase> reverseDirectPurchase(String id, {required String reason}) =>
      Future.error(StateError('not used'));
}

class _FixtureSalesGateway implements PosSalesGateway {
  final List<({String branchId, List<PosSaleLineRequest> items})> calls = [];

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
  }) async {
    calls.add((branchId: branchId, items: items));
    return const PosSaleCreated(id: 'sale-1', saleNumber: 'SALE-1', status: 'pending_payment', total: '10.0000');
  }

  @override
  Future<PosReceipt> receipt(String saleId) => Future.error(StateError('not used'));
  @override
  Future<PosSaleCreated> completeZeroTotalSale(String saleId) => Future.error(StateError('not used'));
  @override
  Future<PosSaleHistoryPage> listSales({PosSaleHistoryFilter filter = const PosSaleHistoryFilter(), String? cursor, int limit = 50}) =>
      Future.error(StateError('not used'));
}

class _FixtureCashPaymentsGateway implements PosPaymentsGateway {
  final List<({String saleId, String tenderedAmount})> cashCalls = [];

  @override
  Future<List<PosPaymentTerminal>> terminalsForBranch(String branchId) async => const [];

  @override
  Future<PosPaymentStatus> createCardTerminalPayment({
    required String saleId,
    required String amount,
    required String terminalId,
    String? currencyCode,
  }) => Future.error(StateError('not used'));

  @override
  Future<PosPaymentStatus> paymentStatus(String paymentId) => Future.error(StateError('not used'));

  @override
  Future<PosCashPaymentResult> createCashPayment({required String saleId, required String tenderedAmount}) async {
    cashCalls.add((saleId: saleId, tenderedAmount: tenderedAmount));
    return PosCashPaymentResult(
      paymentId: 'payment-1',
      status: 'captured',
      tenderedAmount: tenderedAmount,
      changeAmount: '0.0000',
      saleId: saleId,
      saleNumber: 'SALE-1',
      saleStatus: 'completed',
    );
  }

  @override
  Future<PosPaymentStatus> createTransferPayment({required String saleId, required String amount, String? currencyCode}) =>
      Future.error(StateError('not used'));
}

/// `_PosCobrarButton`'s own cash path checks for a real open cash-register
/// session before it even creates the sale (`cash_session_required` is a
/// real, independently-enforced backend rule too — see that widget's own
/// `_handleTap` doc comment) — `EmptyPosCashGateway.openSessionForBranch`
/// honestly returns `null` (no register configured), which would block
/// every test in this file from ever reaching the cash dialog. This fake
/// reports one already-open session, the minimum needed to exercise the
/// real checkout path.
class _OpenCashSessionGateway extends EmptyPosCashGateway {
  const _OpenCashSessionGateway();

  @override
  Future<PosCashSession?> openSessionForBranch(String branchId) async => PosCashSession(
    id: 'cash-session-1',
    branchId: branchId,
    cashRegisterId: 'register-1',
    openedBy: 'user-id',
    openedAt: DateTime.utc(2026, 9, 21),
    openingAmount: '0.0000',
    currencyCode: 'MXN',
    status: 'open',
  );
}

// ---------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------

/// Mirrors `dashboard_screen.dart`'s own composition-root wiring — the
/// admin-mutation gateway params here already ARE the `FreshnessAware*`-
/// wrapped instance when a test passes one in; every gateway this file
/// doesn't specifically exercise uses the app's own real `Empty*Gateway`
/// fallback, never an invented stub.
Future<void> _pump(
  WidgetTester tester, {
  required PosReadController controller,
  PosCatalogAdminGateway catalogAdminGateway = const EmptyPosCatalogAdminGateway(),
  PosPurchasingGateway purchasingGateway = const EmptyPosPurchasingGateway(),
  PosSalesGateway? salesGateway,
  PosPaymentsGateway? paymentsGateway,
  PosCashGateway cashGateway = const EmptyPosCashGateway(),
  AuthenticatedContext? context,
}) async {
  tester.view.physicalSize = const Size(1440, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    // TASK 16.23B (F-05) — mirrors the real app's own tree (`AsOneApp`'s
    // `MaterialApp.builder` wraps every route in `PlatformScope`, see
    // `app.dart`): `_Dashboard` now resolves "business today" via
    // `PlatformScope.of(context).posReadGateway`, which throws with no
    // such ancestor. A plain fresh fake (independent of `controller`'s
    // own, private gateway) is enough — `businessDate` is a wholly
    // separate concern from the products/categories/balances/users
    // caching this file's `controller` param exercises.
    PlatformScope(
      posReadGateway: _MutableReadGateway(),
      child: MaterialApp(
        home: PosShell(
          context: context ?? _context,
          controller: controller,
          salesGateway: salesGateway ?? _FixtureSalesGateway(),
          paymentsGateway: paymentsGateway ?? const EmptyPosPaymentsGateway(),
          cashGateway: cashGateway,
          refundsGateway: const EmptyPosRefundsGateway(),
          promotionsGateway: const EmptyPosPromotionsGateway(),
          customersGateway: const EmptyPosCustomersGateway(),
          membershipsGateway: const EmptyPosMembershipsGateway(),
          loyaltyGateway: const EmptyPosLoyaltyGateway(),
          rewardsGateway: const EmptyPosRewardsGateway(),
          partiesGateway: const EmptyPosPartiesGateway(),
          heldSalesGateway: const EmptyPosHeldSalesGateway(),
          purchasingGateway: purchasingGateway,
          purchaseOrdersGateway: const EmptyPosPurchaseOrdersGateway(),
          catalogAdminGateway: catalogAdminGateway,
          categoryAdminGateway: const EmptyPosCategoryAdminGateway(),
          inventoryAdminGateway: const EmptyPosInventoryAdminGateway(),
          onLogout: () {},
          onBranchSelected: (_) async {},
        ),
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

/// The price caption text rendered inside a given product tile — see
/// `pos_shell.dart`'s own `_priceCaption`.
String _priceCaptionOf(WidgetTester tester, String productId) {
  final tile = find.byKey(Key('pos-product-$productId'));
  expect(tile, findsOneWidget, reason: 'product tile $productId must be visible');
  final texts = tester
      .widgetList<Text>(find.descendant(of: tile, matching: find.byType(Text)))
      .map((t) => t.data)
      .whereType<String>()
      .toList();
  // The price caption is the one that either starts with '$' or is
  // exactly one of the honest non-price captions — never guessed by
  // position, since the tile also renders the product name/code.
  return texts.firstWhere(
    (text) => text.startsWith(r'$') || text == 'Sin precio' || text == 'Precio inválido',
    orElse: () => throw StateError('No price caption found among: $texts'),
  );
}
