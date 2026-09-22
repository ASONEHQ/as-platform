/// TASK 15.1 Phase 4 — widget tests for the standalone `PosCatalogAdminScreen`
/// ("Catálogo — precios y opciones"): branch price override creation,
/// custom option/value creation, variant barcode create+retire, CSV export
/// trigger, and permission-gating for actors missing `price.manage`/
/// `product.manage`/`catalog.read`. Uses a real, in-memory recording fake
/// gateway — never a mock framework — mirroring `pos_suppliers_test.dart`'s
/// own `_Recording*Gateway` fixture convention. The CSV-download assertion
/// mirrors `pos_reports_test.dart`'s own established VM-test expectation
/// (`downloadCsvFile` is a real no-op stub outside a browser — see
/// `pos_reports_csv_download_stub.dart` — so the honest "this environment
/// can't start a download" message is the correct, real outcome here too).
library;

import 'package:as_one/features/authentication/auth_models.dart';
import 'package:as_one/features/pos/pos_catalog_admin_gateway.dart';
import 'package:as_one/features/pos/pos_catalog_admin_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('TASK 15.1 Phase 4 — permission gating', () {
    testWidgets('no catalog.read at all shows the honest permission state, no tabs', (tester) async {
      final gateway = _RecordingCatalogAdminGateway();
      await _pump(tester, gateway: gateway, permissions: const []);

      expect(find.byKey(const Key('pos-catalog-admin-tabs')), findsNothing);
      expect(find.textContaining('catalog.read'), findsOneWidget);
    });
  });

  group('TASK 15.1 Phase 4 — precios por sucursal', () {
    testWidgets('renders the real fetched products with their effective price', (tester) async {
      final gateway = _RecordingCatalogAdminGateway(
        products: [
          _product(id: 'p-1', name: 'Playera Roja', price: _price(id: 'pr-1', amount: '199.0000', currency: 'MXN')),
          _product(id: 'p-2', name: 'Playera Azul'),
        ],
      );
      await _pump(tester, gateway: gateway, permissions: _readOnly);

      expect(find.byKey(const Key('pos-catalog-admin-price-row-p-1')), findsOneWidget);
      expect(find.text('199.0000 MXN'), findsOneWidget);
      expect(find.text('Sin precio vigente'), findsOneWidget);
    });

    testWidgets('a valid submit calls createProductPrice with the real payload for the chosen branch', (
      tester,
    ) async {
      final gateway = _RecordingCatalogAdminGateway(products: [_product(id: 'p-1', name: 'Playera Roja')]);
      await _pump(tester, gateway: gateway, permissions: _priceWrite);

      await tester.tap(find.byKey(const Key('pos-catalog-admin-new-price-p-1')));
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('pos-catalog-admin-price-form-amount')), '249.0000');
      await tester.enterText(find.byKey(const Key('pos-catalog-admin-price-form-currency')), 'MXN');
      await tester.tap(find.byKey(const Key('pos-catalog-admin-price-form-branch')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Sucursal Centro').last);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-catalog-admin-price-form-save')));
      await tester.pumpAndSettle();

      expect(gateway.createPriceCalls, hasLength(1));
      expect(gateway.createPriceCalls.single.productId, 'p-1');
      expect(gateway.createPriceCalls.single.input.amount, '249.0000');
      expect(gateway.createPriceCalls.single.input.currencyCode, 'MXN');
      expect(gateway.createPriceCalls.single.input.branchId, 'branch-id');
    });

    testWidgets('a malformed amount is rejected client-side — no gateway call at all', (tester) async {
      final gateway = _RecordingCatalogAdminGateway(products: [_product(id: 'p-1', name: 'Playera Roja')]);
      await _pump(tester, gateway: gateway, permissions: _priceWrite);

      await tester.tap(find.byKey(const Key('pos-catalog-admin-new-price-p-1')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('pos-catalog-admin-price-form-amount')), 'not-a-number');
      await tester.tap(find.byKey(const Key('pos-catalog-admin-price-form-save')));
      await tester.pump();

      expect(find.text('El monto no tiene un formato válido (ej. 12.50).'), findsOneWidget);
      expect(gateway.createPriceCalls, isEmpty);
    });

    testWidgets('no price.manage: the read-only price list renders but no new-price affordance exists', (
      tester,
    ) async {
      final gateway = _RecordingCatalogAdminGateway(products: [_product(id: 'p-1', name: 'Playera Roja')]);
      await _pump(tester, gateway: gateway, permissions: _readOnly);

      expect(find.byKey(const Key('pos-catalog-admin-price-row-p-1')), findsOneWidget);
      expect(find.byKey(const Key('pos-catalog-admin-new-price-p-1')), findsNothing);
      expect(gateway.createPriceCalls, isEmpty);
    });
  });

  group('TASK 15.1 Phase 4 — opciones y valores', () {
    testWidgets('selecting a product loads its real options, and creating one calls createOption', (tester) async {
      final gateway = _RecordingCatalogAdminGateway(
        products: [_product(id: 'p-1', name: 'Playera Roja')],
        optionsByProduct: {
          'p-1': [_option(id: 'o-1', productId: 'p-1', code: 'talla', name: 'Talla')],
        },
      );
      await _pump(tester, gateway: gateway, permissions: _optionsWrite);

      await tester.tap(find.text('Opciones y código de barras'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-catalog-admin-options-product-p-1')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('pos-catalog-admin-option-row-o-1')), findsOneWidget);
      expect(find.text('Talla'), findsOneWidget);

      await tester.tap(find.byKey(const Key('pos-catalog-admin-new-option')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('pos-catalog-admin-option-form-code')), 'color');
      await tester.enterText(find.byKey(const Key('pos-catalog-admin-option-form-name')), 'Color');
      await tester.tap(find.byKey(const Key('pos-catalog-admin-option-form-save')));
      await tester.pumpAndSettle();

      expect(gateway.createOptionCalls, hasLength(1));
      expect(gateway.createOptionCalls.single.productId, 'p-1');
      expect(gateway.createOptionCalls.single.input.code, 'color');
      expect(gateway.createOptionCalls.single.input.name, 'Color');
      expect(find.text('Color'), findsOneWidget);
    });

    testWidgets('selecting an option loads its real values, and creating one calls createOptionValue', (
      tester,
    ) async {
      final gateway = _RecordingCatalogAdminGateway(
        products: [_product(id: 'p-1', name: 'Playera Roja')],
        optionsByProduct: {
          'p-1': [_option(id: 'o-1', productId: 'p-1', code: 'talla', name: 'Talla')],
        },
        valuesByOption: {
          'o-1': [_value(id: 'v-1', optionId: 'o-1', productId: 'p-1', code: 'chica', name: 'Chica')],
        },
      );
      await _pump(tester, gateway: gateway, permissions: _optionsWrite);

      await tester.tap(find.text('Opciones y código de barras'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-catalog-admin-options-product-p-1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-catalog-admin-option-row-o-1')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('pos-catalog-admin-value-row-v-1')), findsOneWidget);
      expect(find.text('Chica'), findsOneWidget);

      await tester.tap(find.byKey(const Key('pos-catalog-admin-new-value')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('pos-catalog-admin-value-form-code')), 'grande');
      await tester.enterText(find.byKey(const Key('pos-catalog-admin-value-form-name')), 'Grande');
      await tester.tap(find.byKey(const Key('pos-catalog-admin-value-form-save')));
      await tester.pumpAndSettle();

      expect(gateway.createValueCalls, hasLength(1));
      expect(gateway.createValueCalls.single.optionId, 'o-1');
      expect(gateway.createValueCalls.single.input.code, 'grande');
      expect(find.text('Grande'), findsOneWidget);
    });

    testWidgets('no product.manage: options render read-only, no create/edit affordance exists', (tester) async {
      final gateway = _RecordingCatalogAdminGateway(
        products: [_product(id: 'p-1', name: 'Playera Roja')],
        optionsByProduct: {
          'p-1': [_option(id: 'o-1', productId: 'p-1', code: 'talla', name: 'Talla')],
        },
      );
      await _pump(tester, gateway: gateway, permissions: _readOnly);

      await tester.tap(find.text('Opciones y código de barras'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-catalog-admin-options-product-p-1')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('pos-catalog-admin-option-row-o-1')), findsOneWidget);
      expect(find.byKey(const Key('pos-catalog-admin-new-option')), findsNothing);
      expect(find.byKey(const Key('pos-catalog-admin-option-row-edit-o-1')), findsNothing);
      expect(gateway.createOptionCalls, isEmpty);
    });
  });

  group('TASK 15.1 Phase 4 — variantes y códigos de barras', () {
    testWidgets('creating a barcode calls createBarcode and shows it; retiring calls retireBarcode', (
      tester,
    ) async {
      final gateway = _RecordingCatalogAdminGateway(
        products: [_product(id: 'p-1', name: 'Playera Roja')],
        variantsByProduct: {
          'p-1': [_variant(id: 'var-1', productId: 'p-1', sku: 'PLA-ROJ-S')],
        },
      );
      await _pump(tester, gateway: gateway, permissions: _optionsWrite);

      await tester.tap(find.text('Opciones y código de barras'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-catalog-admin-options-product-p-1')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('pos-catalog-admin-variant-row-var-1')), findsOneWidget);

      await tester.tap(find.byKey(const Key('pos-catalog-admin-new-barcode-var-1')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('pos-catalog-admin-barcode-form-value')), '7501234567890');
      await tester.tap(find.byKey(const Key('pos-catalog-admin-barcode-form-save')));
      await tester.pumpAndSettle();

      expect(gateway.createBarcodeCalls, hasLength(1));
      expect(gateway.createBarcodeCalls.single.variantId, 'var-1');
      expect(gateway.createBarcodeCalls.single.input.barcode, '7501234567890');
      expect(find.textContaining('7501234567890'), findsOneWidget);

      // Retire it via the chip's own delete affordance.
      await tester.tap(find.byIcon(Icons.close).last);
      await tester.pumpAndSettle();

      expect(gateway.retireBarcodeCalls, hasLength(1));
      expect(find.textContaining('7501234567890'), findsNothing);
    });
  });

  group('TASK 15.1 Phase 4 — CSV export', () {
    testWidgets('tapping the export button calls exportProductsCsv and shows the honest VM-test outcome', (
      tester,
    ) async {
      final gateway = _RecordingCatalogAdminGateway(csv: 'code,name\nSKU-1,Playera Roja\n');
      await _pump(tester, gateway: gateway, permissions: _readOnly);

      await tester.tap(find.byKey(const Key('pos-catalog-admin-export-csv')));
      await tester.pumpAndSettle();

      expect(gateway.exportCalls, 1);
      expect(
        find.text('El CSV se generó, pero este entorno no puede iniciar la descarga del navegador.'),
        findsOneWidget,
      );
    });

    testWidgets('no catalog.read: the export button stays visible but disabled, never hidden', (tester) async {
      final gateway = _RecordingCatalogAdminGateway();
      await _pump(tester, gateway: gateway, permissions: const []);

      final button = tester.widget<OutlinedButton>(find.byKey(const Key('pos-catalog-admin-export-csv')));
      expect(button.onPressed, isNull);
      expect(gateway.exportCalls, 0);
    });
  });
}

const _readOnly = ['catalog.read'];
const _priceWrite = ['catalog.read', 'price.manage'];
const _optionsWrite = ['catalog.read', 'product.manage'];

PosCatalogProduct _product({required String id, required String name, PosCatalogEffectivePrice? price}) =>
    PosCatalogProduct(id: id, code: id.toUpperCase(), name: name, status: 'active', effectivePrice: price);

PosCatalogEffectivePrice _price({required String id, required String amount, required String currency}) =>
    PosCatalogEffectivePrice(
      id: id,
      branchId: null,
      amount: amount,
      currencyCode: currency,
      validFrom: DateTime.utc(2026, 1, 1),
      validUntil: null,
      status: 'active',
    );

PosCatalogVariant _variant({required String id, required String productId, required String sku}) =>
    PosCatalogVariant(id: id, productId: productId, sku: sku, name: null, isDefault: true, status: 'active');

PosProductOption _option({
  required String id,
  required String productId,
  required String code,
  required String name,
  int displayOrder = 0,
  String status = 'active',
  int version = 1,
}) => PosProductOption(
  id: id,
  productId: productId,
  code: code,
  name: name,
  displayOrder: displayOrder,
  status: status,
  version: version,
);

PosProductOptionValue _value({
  required String id,
  required String optionId,
  required String productId,
  required String code,
  required String name,
  int displayOrder = 0,
  String status = 'active',
  int version = 1,
}) => PosProductOptionValue(
  id: id,
  optionId: optionId,
  productId: productId,
  code: code,
  name: name,
  displayOrder: displayOrder,
  status: status,
  version: version,
);

class _RecordingCatalogAdminGateway implements PosCatalogAdminGateway {
  _RecordingCatalogAdminGateway({
    List<PosCatalogProduct>? products,
    Map<String, List<PosCatalogVariant>>? variantsByProduct,
    Map<String, List<PosProductOption>>? optionsByProduct,
    Map<String, List<PosProductOptionValue>>? valuesByOption,
    this.csv = 'code,name\n',
  }) : products = List.of(products ?? const []),
       variantsByProduct = {
         for (final entry in (variantsByProduct ?? const {}).entries) entry.key: List.of(entry.value),
       },
       optionsByProduct = {
         for (final entry in (optionsByProduct ?? const {}).entries) entry.key: List.of(entry.value),
       },
       valuesByOption = {
         for (final entry in (valuesByOption ?? const {}).entries) entry.key: List.of(entry.value),
       };

  final List<PosCatalogProduct> products;
  final Map<String, List<PosCatalogVariant>> variantsByProduct;
  final Map<String, List<PosProductOption>> optionsByProduct;
  final Map<String, List<PosProductOptionValue>> valuesByOption;
  final String csv;

  final List<({String productId, PosProductPriceInput input})> createPriceCalls = [];
  final List<({String productId, PosProductPriceInput input})> changePriceCalls = [];
  final List<({String productId, PosNamedCreateInput input})> createOptionCalls = [];
  final List<({String optionId, PosNamedCreateInput input})> createValueCalls = [];
  final List<({String variantId, PosProductBarcodeInput input})> createBarcodeCalls = [];
  final List<({String barcodeId, int version})> retireBarcodeCalls = [];
  int exportCalls = 0;
  int _autoId = 100;

  @override
  Future<PosCatalogProductPage> listProducts({
    String? cursor,
    int limit = 50,
    String? search,
    String? branchId,
  }) async => PosCatalogProductPage(items: List.of(products), nextCursor: null);

  PosNewProductInput? lastCreateProductInput;

  @override
  Future<PosCatalogProduct> createProduct(PosNewProductInput input) async {
    lastCreateProductInput = input;
    final created = PosCatalogProduct(id: 'new-product', code: input.code, name: input.name, status: 'active', effectivePrice: null);
    products.add(created);
    return created;
  }

  // TASK 16.6 — real in-memory recording fakes for the product edit/
  // duplicate/image endpoints, mirroring this fixture's own established
  // "record the call, return a real-shaped response" convention (never a
  // mock framework).
  PosProductPatchInput? lastUpdateProductInput;
  final List<({String id, int expectedVersion})> deleteImageCalls = [];

  @override
  Future<PosCatalogProduct> product(String id) async =>
      products.firstWhere((item) => item.id == id, orElse: () => PosCatalogProduct(id: id, code: id, name: id, status: 'active', effectivePrice: null));

  @override
  Future<PosCatalogProduct> updateProduct(String id, int version, PosProductPatchInput input) async {
    lastUpdateProductInput = input;
    final current = await product(id);
    final updated = PosCatalogProduct(
      id: current.id,
      code: current.code,
      name: input.name ?? current.name,
      description: input.description ?? current.description,
      productType: current.productType,
      tracksInventory: current.tracksInventory,
      taxCode: input.taxCode ?? current.taxCode,
      status: input.status ?? current.status,
      categoryId: input.categoryId ?? current.categoryId,
      brandId: input.brandId ?? current.brandId,
      imageUrl: input.imageUrl ?? current.imageUrl,
      iconKey: input.clearIconKey ? null : (input.iconKey ?? current.iconKey),
      cardStyle: input.cardStyle ?? current.cardStyle,
      cardColorHex: input.clearCardColorHex ? null : (input.cardColorHex ?? current.cardColorHex),
      isFeatured: input.isFeatured ?? current.isFeatured,
      preferredSupplierId: input.clearPreferredSupplierId
          ? null
          : (input.preferredSupplierId ?? current.preferredSupplierId),
      version: version + 1,
      effectivePrice: current.effectivePrice,
      defaultVariant: current.defaultVariant,
    );
    final index = products.indexWhere((item) => item.id == id);
    if (index == -1) {
      products.add(updated);
    } else {
      products[index] = updated;
    }
    return updated;
  }

  @override
  Future<PosCatalogProduct> duplicateProduct(String id) async {
    final source = await product(id);
    final duplicate = PosCatalogProduct(
      id: 'duplicate-${_autoId++}',
      code: '${source.code}-copia',
      name: '${source.name} (copia)',
      description: source.description,
      productType: source.productType,
      tracksInventory: source.tracksInventory,
      taxCode: source.taxCode,
      status: 'draft',
      categoryId: source.categoryId,
      brandId: source.brandId,
      imageUrl: source.imageUrl,
      iconKey: source.iconKey,
      cardStyle: source.cardStyle,
      cardColorHex: source.cardColorHex,
      isFeatured: source.isFeatured,
      preferredSupplierId: source.preferredSupplierId,
      version: 1,
      effectivePrice: null,
      defaultVariant: source.defaultVariant,
    );
    products.add(duplicate);
    return duplicate;
  }

  @override
  Future<PosCatalogProduct> uploadProductImage(
    String id, {
    required List<int> bytes,
    required String filename,
    required String contentType,
    required int expectedVersion,
  }) async {
    final current = await product(id);
    final updated = PosCatalogProduct(
      id: current.id,
      code: current.code,
      name: current.name,
      description: current.description,
      productType: current.productType,
      tracksInventory: current.tracksInventory,
      taxCode: current.taxCode,
      status: current.status,
      categoryId: current.categoryId,
      brandId: current.brandId,
      imageUrl: 'https://fake-storage.test/products/$id/$filename',
      iconKey: current.iconKey,
      cardStyle: current.cardStyle,
      cardColorHex: current.cardColorHex,
      isFeatured: current.isFeatured,
      preferredSupplierId: current.preferredSupplierId,
      version: expectedVersion + 1,
      effectivePrice: current.effectivePrice,
      defaultVariant: current.defaultVariant,
    );
    final index = products.indexWhere((item) => item.id == id);
    if (index != -1) products[index] = updated;
    return updated;
  }

  @override
  Future<PosCatalogProduct> deleteProductImage(String id, int expectedVersion) async {
    deleteImageCalls.add((id: id, expectedVersion: expectedVersion));
    final current = await product(id);
    final updated = PosCatalogProduct(
      id: current.id,
      code: current.code,
      name: current.name,
      description: current.description,
      productType: current.productType,
      tracksInventory: current.tracksInventory,
      taxCode: current.taxCode,
      status: current.status,
      categoryId: current.categoryId,
      brandId: current.brandId,
      iconKey: current.iconKey,
      cardStyle: current.cardStyle,
      cardColorHex: current.cardColorHex,
      isFeatured: current.isFeatured,
      preferredSupplierId: current.preferredSupplierId,
      version: expectedVersion + 1,
      effectivePrice: current.effectivePrice,
      defaultVariant: current.defaultVariant,
    );
    final index = products.indexWhere((item) => item.id == id);
    if (index != -1) products[index] = updated;
    return updated;
  }

  @override
  Future<PosCatalogVariantPage> listVariants(String productId, {String? cursor, int limit = 50}) async =>
      PosCatalogVariantPage(items: List.of(variantsByProduct[productId] ?? const []), nextCursor: null);

  @override
  Future<PosProductPrice> createProductPrice(String productId, PosProductPriceInput input) async {
    createPriceCalls.add((productId: productId, input: input));
    return PosProductPrice(
      id: 'price-${_autoId++}',
      branchId: input.branchId,
      productId: productId,
      priceType: 'standard',
      amount: input.amount,
      currencyCode: input.currencyCode ?? 'MXN',
      validFrom: DateTime.utc(2026, 9, 1),
      validUntil: input.validUntil,
      status: 'active',
      version: 1,
    );
  }

  @override
  Future<PosProductPrice> changeProductPrice(String productId, PosProductPriceInput input) async {
    changePriceCalls.add((productId: productId, input: input));
    return PosProductPrice(
      id: 'price-${_autoId++}',
      branchId: input.branchId,
      productId: productId,
      priceType: 'standard',
      amount: input.amount,
      currencyCode: input.currencyCode ?? 'MXN',
      validFrom: DateTime.utc(2026, 9, 1),
      validUntil: input.validUntil,
      status: 'active',
      version: 1,
    );
  }

  @override
  Future<PosProductOptionPage> listOptions(String productId, {String? cursor, int limit = 50}) async =>
      PosProductOptionPage(items: List.of(optionsByProduct[productId] ?? const []), nextCursor: null);

  @override
  Future<PosProductOption> createOption(String productId, PosNamedCreateInput input) async {
    createOptionCalls.add((productId: productId, input: input));
    final created = PosProductOption(
      id: 'option-${_autoId++}',
      productId: productId,
      code: input.code,
      name: input.name,
      displayOrder: input.displayOrder ?? 0,
      status: input.status ?? 'active',
      version: 1,
    );
    optionsByProduct.putIfAbsent(productId, () => []).add(created);
    return created;
  }

  @override
  Future<PosProductOption> updateOption(String optionId, int version, PosNamedPatchInput input) async {
    for (final entry in optionsByProduct.entries) {
      final index = entry.value.indexWhere((o) => o.id == optionId);
      if (index == -1) continue;
      final current = entry.value[index];
      final updated = PosProductOption(
        id: current.id,
        productId: current.productId,
        code: current.code,
        name: input.name ?? current.name,
        displayOrder: input.displayOrder ?? current.displayOrder,
        status: input.status ?? current.status,
        version: current.version + 1,
      );
      entry.value[index] = updated;
      return updated;
    }
    throw StateError('Option not found: $optionId');
  }

  @override
  Future<PosProductOptionValuePage> listOptionValues(String optionId, {String? cursor, int limit = 50}) async =>
      PosProductOptionValuePage(items: List.of(valuesByOption[optionId] ?? const []), nextCursor: null);

  @override
  Future<PosProductOptionValue> createOptionValue(String optionId, PosNamedCreateInput input) async {
    createValueCalls.add((optionId: optionId, input: input));
    final created = PosProductOptionValue(
      id: 'value-${_autoId++}',
      optionId: optionId,
      productId: 'p-1',
      code: input.code,
      name: input.name,
      displayOrder: input.displayOrder ?? 0,
      status: input.status ?? 'active',
      version: 1,
    );
    valuesByOption.putIfAbsent(optionId, () => []).add(created);
    return created;
  }

  @override
  Future<PosProductOptionValue> updateOptionValue(String valueId, int version, PosNamedPatchInput input) async {
    for (final entry in valuesByOption.entries) {
      final index = entry.value.indexWhere((v) => v.id == valueId);
      if (index == -1) continue;
      final current = entry.value[index];
      final updated = PosProductOptionValue(
        id: current.id,
        optionId: current.optionId,
        productId: current.productId,
        code: current.code,
        name: input.name ?? current.name,
        displayOrder: input.displayOrder ?? current.displayOrder,
        status: input.status ?? current.status,
        version: current.version + 1,
      );
      entry.value[index] = updated;
      return updated;
    }
    throw StateError('Value not found: $valueId');
  }

  @override
  Future<PosProductBarcode> createBarcode(String variantId, PosProductBarcodeInput input) async {
    createBarcodeCalls.add((variantId: variantId, input: input));
    return PosProductBarcode(
      id: 'barcode-${_autoId++}',
      productVariantId: variantId,
      barcode: input.barcode,
      barcodeType: input.barcodeType,
      isPrimary: input.isPrimary ?? true,
      status: 'active',
      version: 1,
    );
  }

  @override
  Future<PosProductBarcode> retireBarcode(String barcodeId, int version) async {
    retireBarcodeCalls.add((barcodeId: barcodeId, version: version));
    return PosProductBarcode(
      id: barcodeId,
      productVariantId: 'var-1',
      barcode: '7501234567890',
      barcodeType: 'ean13',
      isPrimary: true,
      status: 'retired',
      version: version + 1,
    );
  }

  @override
  Future<String> exportProductsCsv({
    String? status,
    String? productType,
    String? categoryId,
    String? brandId,
    String? search,
  }) async {
    exportCalls++;
    return csv;
  }
}

Future<void> _pump(
  WidgetTester tester, {
  required _RecordingCatalogAdminGateway gateway,
  required List<String> permissions,
}) async {
  tester.view.physicalSize = const Size(1280, 1600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: PosCatalogAdminScreen(context: _context(permissions), gateway: gateway),
        ),
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
  permissions: permissions,
);
