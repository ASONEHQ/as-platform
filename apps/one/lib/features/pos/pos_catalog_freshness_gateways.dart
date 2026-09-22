/// TASK 16.17A — the single choke point that keeps [PosReadController]'s
/// cache honest: a thin decorator around each admin-mutation gateway
/// that forwards every call unchanged to the REAL gateway, and — only
/// once the real call has ALREADY resolved successfully — tells the
/// controller the resource it just wrote to is stale. A failed mutation
/// throws before reaching that call, so it can never invalidate a
/// perfectly good cache over a write that didn't actually happen.
///
/// These are constructed exactly once, in `dashboard_screen.dart`
/// (the same place every other gateway is assembled from `PlatformScope`
/// before being handed to `PosShell`), wrapping the real `Api...`
/// instances. Nothing else in the app ever needs to know they exist —
/// every widget still calls `catalogAdminGateway.createProduct(...)`
/// exactly as before; freshness happens for free.
///
/// Read-only methods (`list*`, `product(id)`, `movement(id)`,
/// `exportBalancesCsv`, `previewRepair`, ...) are forwarded with no
/// invalidation at all. Every mutating method invalidates — deliberately
/// erring toward "too eager" rather than risk missing a genuine
/// balance/price-affecting call: an extra background re-fetch after a
/// mutation that happened not to change anything visible is cheap; a
/// silently-stale POS screen is the exact bug this task exists to close.
library;

import 'dart:async' show unawaited;

import 'pos_catalog_admin_gateway.dart';
import 'pos_category_admin_gateway.dart';
import 'pos_inventory_admin_gateway.dart';
import 'pos_purchase_orders_gateway.dart';
import 'pos_purchasing_gateway.dart';
import 'pos_read_controller.dart';

class FreshnessAwareCatalogAdminGateway implements PosCatalogAdminGateway {
  const FreshnessAwareCatalogAdminGateway(this._inner, this._controller);

  final PosCatalogAdminGateway _inner;
  final PosReadController _controller;

  @override
  Future<PosCatalogProductPage> listProducts({
    String? cursor,
    int limit = 50,
    String? search,
    String? branchId,
  }) => _inner.listProducts(cursor: cursor, limit: limit, search: search, branchId: branchId);

  @override
  Future<PosCatalogProduct> product(String id) => _inner.product(id);

  @override
  Future<PosCatalogVariantPage> listVariants(String productId, {String? cursor, int limit = 50}) =>
      _inner.listVariants(productId, cursor: cursor, limit: limit);

  @override
  Future<PosProductOptionPage> listOptions(String productId, {String? cursor, int limit = 50}) =>
      _inner.listOptions(productId, cursor: cursor, limit: limit);

  @override
  Future<PosProductOptionValuePage> listOptionValues(String optionId, {String? cursor, int limit = 50}) =>
      _inner.listOptionValues(optionId, cursor: cursor, limit: limit);

  @override
  Future<String> exportProductsCsv({
    String? status,
    String? productType,
    String? categoryId,
    String? brandId,
    String? search,
  }) => _inner.exportProductsCsv(
    status: status,
    productType: productType,
    categoryId: categoryId,
    brandId: brandId,
    search: search,
  );

  @override
  Future<PosCatalogProduct> createProduct(PosNewProductInput input) async {
    final result = await _inner.createProduct(input);
    unawaited(_controller.invalidateProducts());
    return result;
  }

  @override
  Future<PosCatalogProduct> updateProduct(String id, int version, PosProductPatchInput input) async {
    final result = await _inner.updateProduct(id, version, input);
    unawaited(_controller.invalidateProducts());
    return result;
  }

  @override
  Future<PosCatalogProduct> duplicateProduct(String id) async {
    final result = await _inner.duplicateProduct(id);
    unawaited(_controller.invalidateProducts());
    return result;
  }

  @override
  Future<PosCatalogProduct> uploadProductImage(
    String id, {
    required List<int> bytes,
    required String filename,
    required String contentType,
    required int expectedVersion,
  }) async {
    final result = await _inner.uploadProductImage(
      id,
      bytes: bytes,
      filename: filename,
      contentType: contentType,
      expectedVersion: expectedVersion,
    );
    unawaited(_controller.invalidateProducts());
    return result;
  }

  @override
  Future<PosCatalogProduct> deleteProductImage(String id, int expectedVersion) async {
    final result = await _inner.deleteProductImage(id, expectedVersion);
    unawaited(_controller.invalidateProducts());
    return result;
  }

  @override
  Future<PosProductPrice> createProductPrice(String productId, PosProductPriceInput input) async {
    final result = await _inner.createProductPrice(productId, input);
    unawaited(_controller.invalidateProducts());
    return result;
  }

  @override
  Future<PosProductPrice> changeProductPrice(String productId, PosProductPriceInput input) async {
    final result = await _inner.changeProductPrice(productId, input);
    unawaited(_controller.invalidateProducts());
    return result;
  }

  @override
  Future<PosProductOption> createOption(String productId, PosNamedCreateInput input) async {
    final result = await _inner.createOption(productId, input);
    unawaited(_controller.invalidateProducts());
    return result;
  }

  @override
  Future<PosProductOption> updateOption(String optionId, int version, PosNamedPatchInput input) async {
    final result = await _inner.updateOption(optionId, version, input);
    unawaited(_controller.invalidateProducts());
    return result;
  }

  @override
  Future<PosProductOptionValue> createOptionValue(String optionId, PosNamedCreateInput input) async {
    final result = await _inner.createOptionValue(optionId, input);
    unawaited(_controller.invalidateProducts());
    return result;
  }

  @override
  Future<PosProductOptionValue> updateOptionValue(String valueId, int version, PosNamedPatchInput input) async {
    final result = await _inner.updateOptionValue(valueId, version, input);
    unawaited(_controller.invalidateProducts());
    return result;
  }

  @override
  Future<PosProductBarcode> createBarcode(String variantId, PosProductBarcodeInput input) async {
    final result = await _inner.createBarcode(variantId, input);
    unawaited(_controller.invalidateProducts());
    return result;
  }

  @override
  Future<PosProductBarcode> retireBarcode(String barcodeId, int version) async {
    final result = await _inner.retireBarcode(barcodeId, version);
    unawaited(_controller.invalidateProducts());
    return result;
  }
}

class FreshnessAwareCategoryAdminGateway implements PosCategoryAdminGateway {
  const FreshnessAwareCategoryAdminGateway(this._inner, this._controller);

  final PosCategoryAdminGateway _inner;
  final PosReadController _controller;

  @override
  Future<PosCatalogCategoryPage> listCategories({String? cursor, int limit = 50, String? status, String? search}) =>
      _inner.listCategories(cursor: cursor, limit: limit, status: status, search: search);

  @override
  Future<PosCatalogCategory> createCategory(PosCategoryInput input) async {
    final result = await _inner.createCategory(input);
    unawaited(_controller.invalidateCategories());
    // Categories drive each product's displayed grouping in the POS grid
    // too — a brand-new/renamed category should be reflected there as
    // well, not only in the (separate) categories list.
    unawaited(_controller.invalidateProducts());
    return result;
  }

  @override
  Future<PosCatalogCategory> updateCategory(String id, int version, PosCategoryInput input) async {
    final result = await _inner.updateCategory(id, version, input);
    unawaited(_controller.invalidateCategories());
    unawaited(_controller.invalidateProducts());
    return result;
  }
}

class FreshnessAwareInventoryAdminGateway implements PosInventoryAdminGateway {
  const FreshnessAwareInventoryAdminGateway(this._inner, this._controller);

  final PosInventoryAdminGateway _inner;
  final PosReadController _controller;

  Future<T> _mutate<T>(Future<T> Function() call) async {
    final result = await call();
    unawaited(_controller.invalidateBalances());
    return result;
  }

  @override
  Future<PosInventoryLocationPage> listLocations({String? branchId, String? status, String? cursor, int limit = 50}) =>
      _inner.listLocations(branchId: branchId, status: status, cursor: cursor, limit: limit);

  @override
  Future<PosInventoryLocation> createLocation(PosInventoryLocationCreateInput input) =>
      _mutate(() => _inner.createLocation(input));

  @override
  Future<PosInventoryLocation> updateLocation(String id, PosInventoryLocationPatchInput input, {required int version}) =>
      _mutate(() => _inner.updateLocation(id, input, version: version));

  @override
  Future<PosInventoryBalancePage> listBalances({
    String? branchId,
    String? locationId,
    String? categoryId,
    String? search,
    String? stockStatus,
    String? cursor,
    int limit = 50,
  }) => _inner.listBalances(
    branchId: branchId,
    locationId: locationId,
    categoryId: categoryId,
    search: search,
    stockStatus: stockStatus,
    cursor: cursor,
    limit: limit,
  );

  @override
  Future<String> exportBalancesCsv({String? branchId, String? locationId, String? categoryId, String? search, String? stockStatus}) =>
      _inner.exportBalancesCsv(
        branchId: branchId,
        locationId: locationId,
        categoryId: categoryId,
        search: search,
        stockStatus: stockStatus,
      );

  @override
  Future<PosInventoryMovementPage> listMovements({String? branchId, String? status, String? type, String? cursor, int limit = 50}) =>
      _inner.listMovements(branchId: branchId, status: status, type: type, cursor: cursor, limit: limit);

  @override
  Future<PosInventoryMovement> movement(String id) => _inner.movement(id);

  @override
  Future<List<PosInventoryMovementLine>> movementLines(String id) => _inner.movementLines(id);

  @override
  Future<PosInventoryMovement> createMovement(PosInventoryMovementHeaderInput input) =>
      _mutate(() => _inner.createMovement(input));

  @override
  Future<PosInventoryMovementLineResult> addMovementLine(String id, PosInventoryMovementLineInput input, {required int version}) =>
      _mutate(() => _inner.addMovementLine(id, input, version: version));

  @override
  Future<PosInventoryMovementLineDeletion> deleteMovementLine(String id, String lineId, {required int version}) =>
      _mutate(() => _inner.deleteMovementLine(id, lineId, version: version));

  @override
  Future<PosInventoryMovementTransition> submitMovement(String id, {required int version}) =>
      _mutate(() => _inner.submitMovement(id, version: version));

  @override
  Future<PosInventoryMovementTransition> postMovement(String id, {required int version}) =>
      _mutate(() => _inner.postMovement(id, version: version));

  @override
  Future<PosInventoryMovement> cancelMovement(String id, {required int version, required String reasonCode, String? note}) =>
      _mutate(() => _inner.cancelMovement(id, version: version, reasonCode: reasonCode, note: note));

  @override
  Future<PosInventoryReversalResult> reverseMovement(String id, {required int version, required String reasonCode, String? note}) =>
      _mutate(() => _inner.reverseMovement(id, version: version, reasonCode: reasonCode, note: note));

  @override
  Future<PosInventoryTransferPage> listTransfers({String? status, String? branchId, String? cursor, int limit = 50}) =>
      _inner.listTransfers(status: status, branchId: branchId, cursor: cursor, limit: limit);

  @override
  Future<PosInventoryTransfer> transfer(String id) => _inner.transfer(id);

  @override
  Future<PosInventoryTransfer> createTransfer(PosInventoryTransferCreateInput input) =>
      _mutate(() => _inner.createTransfer(input));

  @override
  Future<PosInventoryTransfer> decideTransfer(
    String id, {
    required int version,
    required String decision,
    String? reasonCode,
    String? note,
  }) => _mutate(() => _inner.decideTransfer(id, version: version, decision: decision, reasonCode: reasonCode, note: note));

  @override
  Future<PosInventoryTransfer> shipTransfer(String id, {required int version, String? note}) =>
      _mutate(() => _inner.shipTransfer(id, version: version, note: note));

  @override
  Future<PosInventoryTransfer> receiveTransfer(String id, {required int version, String? note}) =>
      _mutate(() => _inner.receiveTransfer(id, version: version, note: note));

  @override
  Future<PosInventoryTransfer> cancelTransfer(String id, {required int version, required String reasonCode, String? note}) =>
      _mutate(() => _inner.cancelTransfer(id, version: version, reasonCode: reasonCode, note: note));

  @override
  Future<PosInventoryCountPage> listCounts({String? branchId, String? status, String? cursor, int limit = 50}) =>
      _inner.listCounts(branchId: branchId, status: status, cursor: cursor, limit: limit);

  @override
  Future<PosInventoryCount> count(String id) => _inner.count(id);

  @override
  Future<PosInventoryCount> createCount(PosInventoryCountCreateInput input) =>
      _mutate(() => _inner.createCount(input));

  @override
  Future<PosInventoryCount> startCount(String id, {required int version}) =>
      _mutate(() => _inner.startCount(id, version: version));

  @override
  Future<PosInventoryCountLine> recordCountLine(
    String id,
    String productVariantId, {
    required String countedQuantity,
    required String unitOfMeasureCode,
    required int version,
  }) => _mutate(
    () => _inner.recordCountLine(
      id,
      productVariantId,
      countedQuantity: countedQuantity,
      unitOfMeasureCode: unitOfMeasureCode,
      version: version,
    ),
  );

  @override
  Future<PosInventoryCount> submitCount(String id, {required int version}) =>
      _mutate(() => _inner.submitCount(id, version: version));

  @override
  Future<PosInventoryCount> approveCount(String id, {required int version}) =>
      _mutate(() => _inner.approveCount(id, version: version));

  @override
  Future<PosInventoryCount> applyCount(String id, {required int version}) =>
      _mutate(() => _inner.applyCount(id, version: version));

  @override
  Future<PosInventoryCount> cancelCount(String id, {required int version, required String reasonCode, String? note}) =>
      _mutate(() => _inner.cancelCount(id, version: version, reasonCode: reasonCode, note: note));

  @override
  Future<PosInventoryReservationPage> listReservations({String? branchId, String? status, String? cursor, int limit = 50}) =>
      _inner.listReservations(branchId: branchId, status: status, cursor: cursor, limit: limit);

  @override
  Future<PosInventoryReservation> reservation(String id) => _inner.reservation(id);

  @override
  Future<PosInventoryReservation> createReservation(PosInventoryReservationCreateInput input) =>
      _mutate(() => _inner.createReservation(input));

  @override
  Future<PosInventoryReservation> confirmReservation(String id, {required int version}) =>
      _mutate(() => _inner.confirmReservation(id, version: version));

  @override
  Future<PosInventoryReservation> releaseReservation(
    String id, {
    required int version,
    required String action,
    required String reasonCode,
    String? note,
  }) => _mutate(() => _inner.releaseReservation(id, version: version, action: action, reasonCode: reasonCode, note: note));

  @override
  Future<PosInventoryReconciliationFindingPage> listFindings({
    String? status,
    String? severity,
    String? branchId,
    String? cursor,
    int limit = 50,
  }) => _inner.listFindings(status: status, severity: severity, branchId: branchId, cursor: cursor, limit: limit);

  @override
  Future<PosInventoryReconciliationFinding> finding(String id) => _inner.finding(id);

  @override
  Future<PosInventoryReconciliationFinding> acknowledgeFinding(String id, {required int version, required String reasonCode, String? note}) =>
      _mutate(() => _inner.acknowledgeFinding(id, version: version, reasonCode: reasonCode, note: note));

  @override
  Future<PosInventoryReconciliationFinding> dismissFinding(String id, {required int version, required String reasonCode, String? note}) =>
      _mutate(() => _inner.dismissFinding(id, version: version, reasonCode: reasonCode, note: note));

  @override
  Future<PosInventoryRepairPreview> previewRepair(
    String id, {
    required int version,
    required String strategy,
    required String expectedFingerprint,
  }) => _inner.previewRepair(id, version: version, strategy: strategy, expectedFingerprint: expectedFingerprint);

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
  }) => _mutate(
    () => _inner.repairFinding(
      id,
      version: version,
      strategy: strategy,
      expectedFingerprint: expectedFingerprint,
      previewFingerprint: previewFingerprint,
      previewExpiresAt: previewExpiresAt,
      reasonCode: reasonCode,
      note: note,
    ),
  );
}

class FreshnessAwarePurchasingGateway implements PosPurchasingGateway {
  const FreshnessAwarePurchasingGateway(this._inner, this._controller);

  final PosPurchasingGateway _inner;
  final PosReadController _controller;

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
    final result = await _inner.createDirectPurchase(
      branchId: branchId,
      supplierName: supplierName,
      supplierId: supplierId,
      productVariantId: productVariantId,
      quantity: quantity,
      unitCost: unitCost,
      currencyCode: currencyCode,
      purchaseDate: purchaseDate,
      notes: notes,
    );
    unawaited(_controller.invalidateBalances());
    return result;
  }

  @override
  Future<PosDirectPurchase> directPurchase(String id) => _inner.directPurchase(id);

  @override
  Future<PosDirectPurchasePage> listDirectPurchases({
    PosDirectPurchaseListFilter filter = const PosDirectPurchaseListFilter(),
    String? cursor,
    int limit = 50,
  }) => _inner.listDirectPurchases(filter: filter, cursor: cursor, limit: limit);

  @override
  Future<PosDirectPurchase> reverseDirectPurchase(String id, {required String reason}) async {
    final result = await _inner.reverseDirectPurchase(id, reason: reason);
    unawaited(_controller.invalidateBalances());
    return result;
  }
}

class FreshnessAwarePurchaseOrdersGateway implements PosPurchaseOrdersGateway {
  const FreshnessAwarePurchaseOrdersGateway(this._inner, this._controller);

  final PosPurchaseOrdersGateway _inner;
  final PosReadController _controller;

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
  }) => _inner.createPurchaseOrder(
    branchId: branchId,
    supplierName: supplierName,
    supplierId: supplierId,
    orderDate: orderDate,
    expectedDate: expectedDate,
    currencyCode: currencyCode,
    notes: notes,
    lines: lines,
  );

  @override
  Future<PosPurchaseOrder> getPurchaseOrder(String id) => _inner.getPurchaseOrder(id);

  @override
  Future<PosPurchaseOrderPage> listPurchaseOrders({
    PosPurchaseOrderListFilter filter = const PosPurchaseOrderListFilter(),
    String? cursor,
    int limit = 50,
  }) => _inner.listPurchaseOrders(filter: filter, cursor: cursor, limit: limit);

  @override
  Future<PosPurchaseOrder> submitPurchaseOrder(String id) => _inner.submitPurchaseOrder(id);

  @override
  Future<PosPurchaseOrder> receivePurchaseOrder(
    String id, {
    required List<PosPurchaseOrderReceiveLineInput> lines,
  }) async {
    final result = await _inner.receivePurchaseOrder(id, lines: lines);
    unawaited(_controller.invalidateBalances());
    return result;
  }

  @override
  Future<PosPurchaseOrder> cancelPurchaseOrder(String id, {String? reason}) => _inner.cancelPurchaseOrder(id, reason: reason);
}
