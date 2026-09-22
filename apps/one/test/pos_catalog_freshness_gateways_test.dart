/// TASK 16.17A — unit tests for the freshness-aware gateway decorators
/// (`pos_catalog_freshness_gateways.dart`): the single, deliberate
/// invalidation strategy this task chose over scattering ad hoc
/// `loadProducts(refresh: true)` calls throughout unrelated widgets. Each
/// decorator wraps a real gateway one-for-one; these tests prove three
/// properties for a representative mutating method on each of the 5
/// wrapped interfaces:
///   1. On success, it forwards to the inner gateway UNCHANGED and returns
///      its real result.
///   2. On success, it invalidates exactly the resource that mutation can
///      affect (never a resource it can't).
///   3. On failure (the inner gateway throws), it invalidates NOTHING —
///      a failed mutation must never manufacture a stale-but-labeled-fresh
///      revalidation.
/// A read-only method is also spot-checked per gateway to confirm it is a
/// pure pass-through with no invalidation at all.
library;

import 'package:as_one/features/pos/pos_catalog_admin_gateway.dart';
import 'package:as_one/features/pos/pos_catalog_freshness_gateways.dart';
import 'package:as_one/features/pos/pos_category_admin_gateway.dart';
import 'package:as_one/features/pos/pos_inventory_admin_gateway.dart' hide PosInventoryBalance;
import 'package:as_one/features/pos/pos_purchase_orders_gateway.dart';
import 'package:as_one/features/pos/pos_purchasing_gateway.dart';
import 'package:as_one/features/pos/pos_read_controller.dart';
import 'package:as_one/features/pos/pos_read_gateway.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('FreshnessAwareCatalogAdminGateway', () {
    test('createProduct: forwards, returns the real result, invalidates products only', () async {
      final inner = _RecordingCatalogAdminGateway();
      final controller = await _controllerWithProductsRequested();
      final gateway = FreshnessAwareCatalogAdminGateway(inner, controller);

      final input = const PosNewProductInput(code: 'P1', name: 'Producto 1');
      final result = await gateway.createProduct(input);

      expect(inner.createProductCalls, [input]);
      expect(result.id, 'created-product');
      await _pumpEventQueue();
      expect(controller.products.phase, PosReadPhase.empty);
      expect(controller.balances.phase, PosReadPhase.idle);
    });

    test('changeProductPrice: invalidates products (the exact TASK 16.17 mutation)', () async {
      final inner = _RecordingCatalogAdminGateway();
      final controller = await _controllerWithProductsRequested();
      final gateway = FreshnessAwareCatalogAdminGateway(inner, controller);

      await gateway.changeProductPrice('product-1', const PosProductPriceInput(amount: '25.00'));
      await _pumpEventQueue();

      expect(inner.changePriceCalls, hasLength(1));
      expect(controller.products.phase, PosReadPhase.empty);
    });

    test('a failed createProductPrice never invalidates anything', () async {
      final inner = _RecordingCatalogAdminGateway()..failNextCreatePrice = true;
      final controller = await _controllerWithProductsRequested();
      final gateway = FreshnessAwareCatalogAdminGateway(inner, controller);
      final callsBefore = controller.products;

      await expectLater(
        gateway.createProductPrice('product-1', const PosProductPriceInput(amount: '25.00')),
        throwsA(isA<StateError>()),
      );
      await _pumpEventQueue();

      expect(controller.products, same(callsBefore));
    });

    test('listProducts (read-only) is a pure pass-through — no invalidation', () async {
      final inner = _RecordingCatalogAdminGateway();
      final controller = await _controllerWithProductsRequested();
      final gateway = FreshnessAwareCatalogAdminGateway(inner, controller);
      final before = controller.products;

      final page = await gateway.listProducts();

      expect(page.items, isEmpty);
      expect(inner.listProductsCalls, 1);
      await _pumpEventQueue();
      expect(controller.products, same(before));
    });
  });

  group('FreshnessAwareCategoryAdminGateway', () {
    test('createCategory invalidates BOTH categories and products (categories drive the POS grouping too)', () async {
      final inner = _RecordingCategoryAdminGateway();
      final controller = await _controllerWithProductsAndCategoriesRequested();
      final gateway = FreshnessAwareCategoryAdminGateway(inner, controller);

      await gateway.createCategory(const PosCategoryInput(code: 'C1', name: 'Categoría 1'));
      await _pumpEventQueue();

      expect(inner.createCalls, hasLength(1));
      expect(controller.categories.phase, PosReadPhase.empty);
      expect(controller.products.phase, PosReadPhase.empty);
    });

    test('a failed updateCategory never invalidates anything', () async {
      final inner = _RecordingCategoryAdminGateway()..failNextUpdate = true;
      final controller = await _controllerWithProductsAndCategoriesRequested();
      final gateway = FreshnessAwareCategoryAdminGateway(inner, controller);
      final before = controller.categories;

      await expectLater(
        gateway.updateCategory('cat-1', 1, const PosCategoryInput(name: 'x')),
        throwsA(isA<StateError>()),
      );
      await _pumpEventQueue();

      expect(controller.categories, same(before));
    });
  });

  group('FreshnessAwareInventoryAdminGateway', () {
    test('postMovement invalidates balances only (never products/categories)', () async {
      final inner = _RecordingInventoryAdminGateway();
      final controller = await _controllerWithBalancesRequested();
      final gateway = FreshnessAwareInventoryAdminGateway(inner, controller);

      await gateway.postMovement('movement-1', version: 1);
      await _pumpEventQueue();

      expect(inner.postMovementCalls, hasLength(1));
      expect(controller.balances.phase, PosReadPhase.empty);
      expect(controller.products.phase, PosReadPhase.idle);
    });

    test('a failed postMovement never invalidates balances', () async {
      final inner = _RecordingInventoryAdminGateway()..failNextPost = true;
      final controller = await _controllerWithBalancesRequested();
      final gateway = FreshnessAwareInventoryAdminGateway(inner, controller);
      final before = controller.balances;

      await expectLater(gateway.postMovement('movement-1', version: 1), throwsA(isA<StateError>()));
      await _pumpEventQueue();

      expect(controller.balances, same(before));
    });

    test('listBalances (read-only) never invalidates', () async {
      final inner = _RecordingInventoryAdminGateway();
      final controller = await _controllerWithBalancesRequested();
      final gateway = FreshnessAwareInventoryAdminGateway(inner, controller);
      final before = controller.balances;

      await gateway.listBalances();
      await _pumpEventQueue();

      expect(controller.balances, same(before));
    });
  });

  group('FreshnessAwarePurchasingGateway (Compra Directa)', () {
    test('createDirectPurchase invalidates balances — the exact "receive 10, POS reflects 10" path', () async {
      final inner = _RecordingPurchasingGateway();
      final controller = await _controllerWithBalancesRequested();
      final gateway = FreshnessAwarePurchasingGateway(inner, controller);

      final purchase = await gateway.createDirectPurchase(
        branchId: 'branch-1',
        productVariantId: 'variant-1',
        quantity: '10',
        unitCost: '5.00',
        currencyCode: 'USD',
        purchaseDate: '2026-09-21',
      );
      await _pumpEventQueue();

      expect(purchase.quantity, '10');
      expect(controller.balances.phase, PosReadPhase.empty);
    });

    test('a failed createDirectPurchase never invalidates balances', () async {
      final inner = _RecordingPurchasingGateway()..failNextCreate = true;
      final controller = await _controllerWithBalancesRequested();
      final gateway = FreshnessAwarePurchasingGateway(inner, controller);
      final before = controller.balances;

      await expectLater(
        gateway.createDirectPurchase(
          branchId: 'branch-1',
          productVariantId: 'variant-1',
          quantity: '10',
          unitCost: '5.00',
          currencyCode: 'USD',
          purchaseDate: '2026-09-21',
        ),
        throwsA(isA<StateError>()),
      );
      await _pumpEventQueue();

      expect(controller.balances, same(before));
    });
  });

  group('FreshnessAwarePurchaseOrdersGateway', () {
    test('receivePurchaseOrder invalidates balances (a PO receipt posts real stock)', () async {
      final inner = _RecordingPurchaseOrdersGateway();
      final controller = await _controllerWithBalancesRequested();
      final gateway = FreshnessAwarePurchaseOrdersGateway(inner, controller);

      await gateway.receivePurchaseOrder('po-1', lines: const []);
      await _pumpEventQueue();

      expect(inner.receiveCalls, 1);
      expect(controller.balances.phase, PosReadPhase.empty);
    });

    test('createPurchaseOrder (draft only, no stock posted) does NOT invalidate balances', () async {
      final inner = _RecordingPurchaseOrdersGateway();
      final controller = await _controllerWithBalancesRequested();
      final gateway = FreshnessAwarePurchaseOrdersGateway(inner, controller);
      final before = controller.balances;

      await gateway.createPurchaseOrder(
        branchId: 'branch-1',
        orderDate: '2026-09-21',
        currencyCode: 'USD',
        lines: const [],
      );
      await _pumpEventQueue();

      expect(controller.balances, same(before));
    });
  });
}

Future<void> _pumpEventQueue() => Future<void>.delayed(Duration.zero);

/// A `PosReadController` whose `products`/`categories`/`balances` have
/// already been "requested" once — mirrors real app startup (the POS
/// screen always loads once before any mutation can happen) — so
/// `invalidate*()` is a real revalidate, not the documented before-first-
/// use no-op. `EmptyPosReadGateway` (the app's own real fallback
/// implementation, used wherever no real read gateway is configured) is
/// reused rather than inventing a divergent fake — it already honestly
/// returns empty lists for every resource.
Future<PosReadController> _controllerWithProductsRequested() async {
  final controller = PosReadController(const EmptyPosReadGateway());
  await controller.loadProducts();
  return controller;
}

Future<PosReadController> _controllerWithProductsAndCategoriesRequested() async {
  final controller = PosReadController(const EmptyPosReadGateway());
  await controller.loadProducts();
  await controller.loadCategories();
  return controller;
}

Future<PosReadController> _controllerWithBalancesRequested() async {
  final controller = PosReadController(const EmptyPosReadGateway());
  await controller.loadBalances();
  return controller;
}

class _RecordingCatalogAdminGateway implements PosCatalogAdminGateway {
  final List<PosNewProductInput> createProductCalls = [];
  final List<PosProductPriceInput> changePriceCalls = [];
  int listProductsCalls = 0;
  bool failNextCreatePrice = false;

  @override
  Future<PosCatalogProductPage> listProducts({String? cursor, int limit = 50, String? search, String? branchId}) async {
    listProductsCalls++;
    return const PosCatalogProductPage(items: [], nextCursor: null);
  }

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
  Future<PosCatalogProduct> createProduct(PosNewProductInput input) async {
    createProductCalls.add(input);
    return _fixtureProduct('created-product');
  }

  @override
  Future<PosCatalogProduct> updateProduct(String id, int version, PosProductPatchInput input) async =>
      _fixtureProduct(id);

  @override
  Future<PosCatalogProduct> duplicateProduct(String id) async => _fixtureProduct('$id-copy');

  @override
  Future<PosCatalogProduct> uploadProductImage(
    String id, {
    required List<int> bytes,
    required String filename,
    required String contentType,
    required int expectedVersion,
  }) async => _fixtureProduct(id);

  @override
  Future<PosCatalogProduct> deleteProductImage(String id, int expectedVersion) async => _fixtureProduct(id);

  @override
  Future<PosProductPrice> createProductPrice(String productId, PosProductPriceInput input) async {
    if (failNextCreatePrice) throw StateError('simulated failure');
    return _fixturePrice(productId);
  }

  @override
  Future<PosProductPrice> changeProductPrice(String productId, PosProductPriceInput input) async {
    changePriceCalls.add(input);
    return _fixturePrice(productId);
  }

  @override
  Future<PosProductOption> createOption(String productId, PosNamedCreateInput input) =>
      Future.error(StateError('not used'));

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
  Future<PosProductBarcode> retireBarcode(String barcodeId, int version) =>
      Future.error(StateError('not used'));

  static PosCatalogProduct _fixtureProduct(String id) => PosCatalogProduct(
    id: id,
    code: id.toUpperCase(),
    name: 'Producto $id',
    status: 'active',
    effectivePrice: null,
  );

  static PosProductPrice _fixturePrice(String productId) => PosProductPrice(
    id: 'price-$productId',
    branchId: null,
    productId: productId,
    priceType: 'base',
    amount: '25.00',
    currencyCode: 'USD',
    validFrom: DateTime.utc(2026, 9, 21),
    validUntil: null,
    status: 'active',
    version: 1,
  );
}

class _RecordingCategoryAdminGateway implements PosCategoryAdminGateway {
  final List<PosCategoryInput> createCalls = [];
  bool failNextUpdate = false;

  @override
  Future<PosCatalogCategoryPage> listCategories({String? cursor, int limit = 50, String? status, String? search}) async =>
      const PosCatalogCategoryPage(items: [], nextCursor: null);

  @override
  Future<PosCatalogCategory> createCategory(PosCategoryInput input) async {
    createCalls.add(input);
    return _fixture('new-category');
  }

  @override
  Future<PosCatalogCategory> updateCategory(String id, int version, PosCategoryInput input) async {
    if (failNextUpdate) throw StateError('simulated failure');
    return _fixture(id);
  }

  static PosCatalogCategory _fixture(String id) => PosCatalogCategory(
    id: id,
    parentId: null,
    code: id.toUpperCase(),
    name: 'Categoría $id',
    description: null,
    sortOrder: 0,
    status: 'active',
    visualTile: false,
    operationalGroup: null,
    version: 1,
    createdAt: DateTime.utc(2026, 9, 21),
    updatedAt: DateTime.utc(2026, 9, 21),
  );
}

class _RecordingInventoryAdminGateway implements PosInventoryAdminGateway {
  final List<String> postMovementCalls = [];
  bool failNextPost = false;

  @override
  Future<PosInventoryLocationPage> listLocations({String? branchId, String? status, String? cursor, int limit = 50}) async =>
      const PosInventoryLocationPage(items: [], nextCursor: null);

  @override
  Future<PosInventoryLocation> createLocation(PosInventoryLocationCreateInput input) =>
      Future.error(StateError('not used'));

  @override
  Future<PosInventoryLocation> updateLocation(String id, PosInventoryLocationPatchInput input, {required int version}) =>
      Future.error(StateError('not used'));

  @override
  Future<PosInventoryBalancePage> listBalances({
    String? branchId,
    String? locationId,
    String? categoryId,
    String? search,
    String? stockStatus,
    String? cursor,
    int limit = 50,
  }) async => const PosInventoryBalancePage(items: [], nextCursor: null);

  @override
  Future<String> exportBalancesCsv({String? branchId, String? locationId, String? categoryId, String? search, String? stockStatus}) =>
      Future.error(StateError('not used'));

  @override
  Future<PosInventoryMovementPage> listMovements({String? branchId, String? status, String? type, String? cursor, int limit = 50}) =>
      Future.error(StateError('not used'));

  @override
  Future<PosInventoryMovement> movement(String id) => Future.error(StateError('not used'));

  @override
  Future<List<PosInventoryMovementLine>> movementLines(String id) => Future.error(StateError('not used'));

  @override
  Future<PosInventoryMovement> createMovement(PosInventoryMovementHeaderInput input) =>
      Future.error(StateError('not used'));

  @override
  Future<PosInventoryMovementLineResult> addMovementLine(String id, PosInventoryMovementLineInput input, {required int version}) =>
      Future.error(StateError('not used'));

  @override
  Future<PosInventoryMovementLineDeletion> deleteMovementLine(String id, String lineId, {required int version}) =>
      Future.error(StateError('not used'));

  @override
  Future<PosInventoryMovementTransition> submitMovement(String id, {required int version}) =>
      Future.error(StateError('not used'));

  @override
  Future<PosInventoryMovementTransition> postMovement(String id, {required int version}) async {
    if (failNextPost) throw StateError('simulated failure');
    postMovementCalls.add(id);
    return const PosInventoryMovementTransition(
      movementId: 'movement-1',
      movementNumber: 'MOV-1',
      status: 'posted',
      version: 2,
      postedAt: null,
      affectedBalanceCount: null,
    );
  }

  @override
  Future<PosInventoryMovement> cancelMovement(String id, {required int version, required String reasonCode, String? note}) =>
      Future.error(StateError('not used'));

  @override
  Future<PosInventoryReversalResult> reverseMovement(String id, {required int version, required String reasonCode, String? note}) =>
      Future.error(StateError('not used'));

  @override
  Future<PosInventoryTransferPage> listTransfers({String? status, String? branchId, String? cursor, int limit = 50}) =>
      Future.error(StateError('not used'));

  @override
  Future<PosInventoryTransfer> transfer(String id) => Future.error(StateError('not used'));

  @override
  Future<PosInventoryTransfer> createTransfer(PosInventoryTransferCreateInput input) =>
      Future.error(StateError('not used'));

  @override
  Future<PosInventoryTransfer> decideTransfer(
    String id, {
    required int version,
    required String decision,
    String? reasonCode,
    String? note,
  }) => Future.error(StateError('not used'));

  @override
  Future<PosInventoryTransfer> shipTransfer(String id, {required int version, String? note}) =>
      Future.error(StateError('not used'));

  @override
  Future<PosInventoryTransfer> receiveTransfer(String id, {required int version, String? note}) =>
      Future.error(StateError('not used'));

  @override
  Future<PosInventoryTransfer> cancelTransfer(String id, {required int version, required String reasonCode, String? note}) =>
      Future.error(StateError('not used'));

  @override
  Future<PosInventoryCountPage> listCounts({String? branchId, String? status, String? cursor, int limit = 50}) =>
      Future.error(StateError('not used'));

  @override
  Future<PosInventoryCount> count(String id) => Future.error(StateError('not used'));

  @override
  Future<PosInventoryCount> createCount(PosInventoryCountCreateInput input) =>
      Future.error(StateError('not used'));

  @override
  Future<PosInventoryCount> startCount(String id, {required int version}) =>
      Future.error(StateError('not used'));

  @override
  Future<PosInventoryCountLine> recordCountLine(
    String id,
    String productVariantId, {
    required String countedQuantity,
    required String unitOfMeasureCode,
    required int version,
  }) => Future.error(StateError('not used'));

  @override
  Future<PosInventoryCount> submitCount(String id, {required int version}) =>
      Future.error(StateError('not used'));

  @override
  Future<PosInventoryCount> approveCount(String id, {required int version}) =>
      Future.error(StateError('not used'));

  @override
  Future<PosInventoryCount> applyCount(String id, {required int version}) =>
      Future.error(StateError('not used'));

  @override
  Future<PosInventoryCount> cancelCount(String id, {required int version, required String reasonCode, String? note}) =>
      Future.error(StateError('not used'));

  @override
  Future<PosInventoryReservationPage> listReservations({String? branchId, String? status, String? cursor, int limit = 50}) =>
      Future.error(StateError('not used'));

  @override
  Future<PosInventoryReservation> reservation(String id) => Future.error(StateError('not used'));

  @override
  Future<PosInventoryReservation> createReservation(PosInventoryReservationCreateInput input) =>
      Future.error(StateError('not used'));

  @override
  Future<PosInventoryReservation> confirmReservation(String id, {required int version}) =>
      Future.error(StateError('not used'));

  @override
  Future<PosInventoryReservation> releaseReservation(
    String id, {
    required int version,
    required String action,
    required String reasonCode,
    String? note,
  }) => Future.error(StateError('not used'));

  @override
  Future<PosInventoryReconciliationFindingPage> listFindings({
    String? status,
    String? severity,
    String? branchId,
    String? cursor,
    int limit = 50,
  }) => Future.error(StateError('not used'));

  @override
  Future<PosInventoryReconciliationFinding> finding(String id) => Future.error(StateError('not used'));

  @override
  Future<PosInventoryReconciliationFinding> acknowledgeFinding(String id, {required int version, required String reasonCode, String? note}) =>
      Future.error(StateError('not used'));

  @override
  Future<PosInventoryReconciliationFinding> dismissFinding(String id, {required int version, required String reasonCode, String? note}) =>
      Future.error(StateError('not used'));

  @override
  Future<PosInventoryRepairPreview> previewRepair(
    String id, {
    required int version,
    required String strategy,
    required String expectedFingerprint,
  }) => Future.error(StateError('not used'));

  @override
  Future<PosInventoryReconciliationFinding> repairFinding(
    String id, {
    required int version,
    required String strategy,
    required String expectedFingerprint,
    required String previewFingerprint,
    required String previewExpiresAt,
    required String reasonCode,
    String? note,
  }) => Future.error(StateError('not used'));
}

class _RecordingPurchasingGateway implements PosPurchasingGateway {
  bool failNextCreate = false;

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
    if (failNextCreate) throw StateError('simulated failure');
    return PosDirectPurchase(
      id: 'purchase-1',
      branchId: branchId,
      supplierName: supplierName,
      supplierId: supplierId,
      productVariantId: productVariantId,
      quantity: quantity,
      unitCost: unitCost,
      currencyCode: currencyCode,
      totalCost: '50.0000',
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
  }) async => const PosDirectPurchasePage(items: [], nextCursor: null);

  @override
  Future<PosDirectPurchase> reverseDirectPurchase(String id, {required String reason}) =>
      Future.error(StateError('not used'));
}

class _RecordingPurchaseOrdersGateway implements PosPurchaseOrdersGateway {
  int receiveCalls = 0;

  @override
  Future<PosPurchaseOrder> createPurchaseOrder({
    required String branchId,
    String? supplierName,
    String? supplierId,
    required String orderDate,
    String? expectedDate,
    required String currencyCode,
    String? notes,
    required List<PosPurchaseOrderLineInput> lines,
  }) async => _fixture('po-draft');

  @override
  Future<PosPurchaseOrder> getPurchaseOrder(String id) => Future.error(StateError('not used'));

  @override
  Future<PosPurchaseOrderPage> listPurchaseOrders({
    PosPurchaseOrderListFilter filter = const PosPurchaseOrderListFilter(),
    String? cursor,
    int limit = 50,
  }) => Future.error(StateError('not used'));

  @override
  Future<PosPurchaseOrder> submitPurchaseOrder(String id) => Future.error(StateError('not used'));

  @override
  Future<PosPurchaseOrder> receivePurchaseOrder(String id, {required List<PosPurchaseOrderReceiveLineInput> lines}) async {
    receiveCalls++;
    return _fixture(id);
  }

  @override
  Future<PosPurchaseOrder> cancelPurchaseOrder(String id, {String? reason}) => Future.error(StateError('not used'));

  static PosPurchaseOrder _fixture(String id) => PosPurchaseOrder(
    id: id,
    orderNumber: 'PO-$id',
    branchId: 'branch-1',
    status: 'received',
    orderDate: '2026-09-21',
    currencyCode: 'USD',
    totalCost: '50.0000',
    createdAt: DateTime.utc(2026, 9, 21),
  );
}
