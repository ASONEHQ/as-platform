/// TASK 12.2 — widget tests for the standalone `PosProductVariantsScreen`
/// ("Variantes de producto"): product search/selection, the real fetched
/// variant list, create, edit (with its own real `version` on
/// `updateVariant`), and permission-gating for an actor without
/// `product.manage` (read-only — create/edit affordances are not rendered
/// at all). Uses a real, in-memory recording fake gateway — never a mock
/// framework — mirroring `pos_suppliers_test.dart`'s own
/// `_Recording*Gateway` fixture convention.
library;

import 'package:as_one/features/authentication/auth_models.dart';
import 'package:as_one/features/pos/pos_product_variants_gateway.dart';
import 'package:as_one/features/pos/pos_product_variants_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('TASK 12.2 — product picker', () {
    testWidgets('renders the real fetched products', (tester) async {
      final gateway = _RecordingProductVariantsGateway(
        products: [_product(id: 'p-1', name: 'Playera Roja'), _product(id: 'p-2', name: 'Playera Azul')],
      );
      await _pump(tester, gateway: gateway, permissions: _readOnly);

      expect(find.byKey(const Key('pos-product-variants-product-p-1')), findsOneWidget);
      expect(find.byKey(const Key('pos-product-variants-product-p-2')), findsOneWidget);
      expect(find.text('Playera Roja'), findsOneWidget);
      expect(find.text('Playera Azul'), findsOneWidget);
    });

    testWidgets('typing in the search field calls listProducts with the real query', (tester) async {
      final gateway = _RecordingProductVariantsGateway(
        products: [_product(id: 'p-1', name: 'Playera Roja')],
      );
      await _pump(tester, gateway: gateway, permissions: _readOnly);

      await tester.enterText(find.byKey(const Key('pos-product-variants-search')), 'roja');
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pumpAndSettle();

      expect(gateway.listProductsSearches.last, 'roja');
    });
  });

  group('TASK 12.2 — selecting a product loads its variants', () {
    testWidgets('selecting a product calls listVariants and shows only its own real variants', (tester) async {
      final gateway = _RecordingProductVariantsGateway(
        products: [_product(id: 'p-1', name: 'Playera Roja'), _product(id: 'p-2', name: 'Playera Azul')],
        variantsByProduct: {
          'p-1': [_variant(id: 'v-1', productId: 'p-1', sku: 'PLA-ROJ-S', name: 'Chica')],
          'p-2': [_variant(id: 'v-2', productId: 'p-2', sku: 'PLA-AZU-S', name: 'Chica')],
        },
      );
      await _pump(tester, gateway: gateway, permissions: _readOnly);

      expect(find.byKey(const Key('pos-product-variants-row-v-1')), findsNothing);

      await tester.tap(find.byKey(const Key('pos-product-variants-product-p-1')));
      await tester.pumpAndSettle();

      expect(gateway.listVariantsCalls, ['p-1']);
      expect(find.byKey(const Key('pos-product-variants-row-v-1')), findsOneWidget);
      expect(find.byKey(const Key('pos-product-variants-row-v-2')), findsNothing);
      expect(find.text('PLA-ROJ-S'), findsOneWidget);
    });

    testWidgets('the variant list renders real fixture fields — sku, name, unit, cost, status, is_default', (
      tester,
    ) async {
      final gateway = _RecordingProductVariantsGateway(
        products: [_product(id: 'p-1', name: 'Playera Roja')],
        variantsByProduct: {
          'p-1': [
            _variant(
              id: 'v-1',
              productId: 'p-1',
              sku: 'PLA-ROJ-S',
              name: 'Chica',
              unitOfMeasureCode: 'unit',
              standardCost: '120.5000',
              currencyCode: 'MXN',
              isDefault: true,
              status: 'active',
            ),
          ],
        },
      );
      await _pump(tester, gateway: gateway, permissions: _readOnly);
      await tester.tap(find.byKey(const Key('pos-product-variants-product-p-1')));
      await tester.pumpAndSettle();

      expect(find.text('PLA-ROJ-S'), findsOneWidget);
      expect(find.text('Chica'), findsOneWidget);
      expect(find.textContaining('unit'), findsWidgets);
      expect(find.textContaining('120.5000'), findsWidgets);
      expect(find.textContaining('MXN'), findsWidgets);
      expect(find.text('Predeterminada'), findsOneWidget);
      expect(find.text('Activa'), findsOneWidget);
    });

    testWidgets('an empty variant list renders the honest empty state, never a fabricated row', (tester) async {
      final gateway = _RecordingProductVariantsGateway(
        products: [_product(id: 'p-1', name: 'Playera Roja')],
        variantsByProduct: {'p-1': const []},
      );
      await _pump(tester, gateway: gateway, permissions: _readOnly);
      await tester.tap(find.byKey(const Key('pos-product-variants-product-p-1')));
      await tester.pumpAndSettle();

      expect(find.text('Este producto todavía no tiene variantes.'), findsOneWidget);
    });
  });

  group('TASK 12.2 — create', () {
    testWidgets('a valid submit calls createVariant with the right payload and the new variant appears', (
      tester,
    ) async {
      final gateway = _RecordingProductVariantsGateway(
        products: [_product(id: 'p-1', name: 'Playera Roja')],
        variantsByProduct: {'p-1': const []},
      );
      await _pump(tester, gateway: gateway, permissions: _readWrite);

      await tester.tap(find.byKey(const Key('pos-product-variants-product-p-1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-product-variants-new')));
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('pos-product-variants-form-sku')), 'PLA-ROJ-M');
      await tester.enterText(find.byKey(const Key('pos-product-variants-form-unit')), 'unit');
      await tester.enterText(find.byKey(const Key('pos-product-variants-form-cost')), '150.0000');
      await tester.enterText(find.byKey(const Key('pos-product-variants-form-currency')), 'MXN');
      await tester.tap(find.byKey(const Key('pos-product-variants-form-default')));
      await tester.tap(find.byKey(const Key('pos-product-variants-form-save')));
      await tester.pumpAndSettle();

      expect(gateway.createCalls, hasLength(1));
      expect(gateway.createCalls.single.productId, 'p-1');
      expect(gateway.createCalls.single.input.sku, 'PLA-ROJ-M');
      expect(gateway.createCalls.single.input.unitOfMeasureCode, 'unit');
      expect(gateway.createCalls.single.input.standardCost, '150.0000');
      expect(gateway.createCalls.single.input.currencyCode, 'MXN');
      expect(gateway.createCalls.single.input.isDefault, true);
      expect(find.text('PLA-ROJ-M'), findsOneWidget);
    });

    testWidgets('a blank SKU is rejected client-side — no gateway call at all', (tester) async {
      final gateway = _RecordingProductVariantsGateway(
        products: [_product(id: 'p-1', name: 'Playera Roja')],
        variantsByProduct: {'p-1': const []},
      );
      await _pump(tester, gateway: gateway, permissions: _readWrite);

      await tester.tap(find.byKey(const Key('pos-product-variants-product-p-1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-product-variants-new')));
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('pos-product-variants-form-unit')), 'unit');
      await tester.tap(find.byKey(const Key('pos-product-variants-form-save')));
      await tester.pump();

      expect(find.text('El SKU es obligatorio.'), findsOneWidget);
      expect(gateway.createCalls, isEmpty);
    });

    testWidgets('a malformed standard cost is rejected client-side — no gateway call at all', (tester) async {
      final gateway = _RecordingProductVariantsGateway(
        products: [_product(id: 'p-1', name: 'Playera Roja')],
        variantsByProduct: {'p-1': const []},
      );
      await _pump(tester, gateway: gateway, permissions: _readWrite);

      await tester.tap(find.byKey(const Key('pos-product-variants-product-p-1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-product-variants-new')));
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('pos-product-variants-form-sku')), 'PLA-ROJ-M');
      await tester.enterText(find.byKey(const Key('pos-product-variants-form-unit')), 'unit');
      await tester.enterText(find.byKey(const Key('pos-product-variants-form-cost')), 'not-a-number');
      await tester.tap(find.byKey(const Key('pos-product-variants-form-save')));
      await tester.pump();

      expect(find.text('El costo no tiene un formato válido (ej. 12.50).'), findsOneWidget);
      expect(gateway.createCalls, isEmpty);
    });
  });

  group('TASK 12.2 — edit', () {
    testWidgets('editing a variant calls updateVariant with its own real current version', (tester) async {
      final gateway = _RecordingProductVariantsGateway(
        products: [_product(id: 'p-1', name: 'Playera Roja')],
        variantsByProduct: {
          'p-1': [_variant(id: 'v-1', productId: 'p-1', sku: 'PLA-ROJ-S', name: 'Chica', version: 3)],
        },
      );
      await _pump(tester, gateway: gateway, permissions: _readWrite);

      await tester.tap(find.byKey(const Key('pos-product-variants-product-p-1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-product-variants-edit-v-1')));
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('pos-product-variants-form-name')), 'Chica Editada');
      await tester.tap(find.byKey(const Key('pos-product-variants-form-save')));
      await tester.pumpAndSettle();

      expect(gateway.updateCalls, hasLength(1));
      expect(gateway.updateCalls.single.id, 'v-1');
      expect(gateway.updateCalls.single.version, 3);
      expect(gateway.updateCalls.single.input.name, 'Chica Editada');
      expect(find.text('Chica Editada'), findsOneWidget);
    });
  });

  group('TASK 12.2 — permission gating', () {
    testWidgets('no catalog.read at all shows the honest permission state, no search/list', (tester) async {
      final gateway = _RecordingProductVariantsGateway(products: [_product(id: 'p-1', name: 'Playera Roja')]);
      await _pump(tester, gateway: gateway, permissions: const []);

      expect(find.byKey(const Key('pos-product-variants-search')), findsNothing);
      expect(find.textContaining('catalog.read'), findsOneWidget);
    });

    testWidgets(
      'catalog.read without product.manage: the read-only list renders but no create/edit affordance exists at all',
      (tester) async {
        final gateway = _RecordingProductVariantsGateway(
          products: [_product(id: 'p-1', name: 'Playera Roja')],
          variantsByProduct: {
            'p-1': [_variant(id: 'v-1', productId: 'p-1', sku: 'PLA-ROJ-S', name: 'Chica')],
          },
        );
        await _pump(tester, gateway: gateway, permissions: _readOnly);

        await tester.tap(find.byKey(const Key('pos-product-variants-product-p-1')));
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('pos-product-variants-row-v-1')), findsOneWidget);
        expect(find.text('PLA-ROJ-S'), findsOneWidget);
        expect(find.byKey(const Key('pos-product-variants-new')), findsNothing);
        expect(find.byKey(const Key('pos-product-variants-edit-v-1')), findsNothing);

        expect(gateway.createCalls, isEmpty);
        expect(gateway.updateCalls, isEmpty);
      },
    );
  });
}

const _readOnly = ['catalog.read'];
const _readWrite = ['catalog.read', 'product.manage'];

PosVariantProduct _product({
  required String id,
  required String name,
  String? code,
  String status = 'active',
  String? defaultVariantSku,
}) => PosVariantProduct(
  id: id,
  code: code ?? id.toUpperCase(),
  name: name,
  status: status,
  defaultVariantSku: defaultVariantSku,
);

PosProductVariant _variant({
  required String id,
  required String productId,
  required String sku,
  String? name,
  String unitOfMeasureCode = 'unit',
  int quantityScale = 0,
  bool tracksInventory = true,
  String? standardCost,
  String? currencyCode,
  bool isDefault = false,
  String status = 'active',
  int version = 1,
}) => PosProductVariant(
  id: id,
  productId: productId,
  sku: sku,
  name: name,
  unitOfMeasureCode: unitOfMeasureCode,
  quantityScale: quantityScale,
  tracksInventory: tracksInventory,
  standardCost: standardCost,
  currencyCode: currencyCode,
  isDefault: isDefault,
  status: status,
  version: version,
  createdAt: DateTime.utc(2026, 8, 1),
  updatedAt: DateTime.utc(2026, 8, 1),
);

class _RecordingProductVariantsGateway implements PosProductVariantsGateway {
  _RecordingProductVariantsGateway({
    List<PosVariantProduct>? products,
    Map<String, List<PosProductVariant>>? variantsByProduct,
  }) : products = List.of(products ?? const []),
       variantsByProduct = {
         for (final entry in (variantsByProduct ?? const {}).entries) entry.key: List.of(entry.value),
       };

  final List<PosVariantProduct> products;
  final Map<String, List<PosProductVariant>> variantsByProduct;
  final List<String?> listProductsSearches = [];
  final List<String> listVariantsCalls = [];
  final List<({String productId, PosProductVariantInput input})> createCalls = [];
  final List<({String id, int version, PosProductVariantInput input})> updateCalls = [];
  int _autoId = 100;

  @override
  Future<PosVariantProductPage> listProducts({String? cursor, int limit = 50, String? search}) async {
    listProductsSearches.add(search);
    final normalized = search?.toLowerCase();
    final filtered = normalized == null || normalized.isEmpty
        ? products
        : products
              .where(
                (product) =>
                    product.name.toLowerCase().contains(normalized) ||
                    product.code.toLowerCase().contains(normalized),
              )
              .toList();
    return PosVariantProductPage(items: List.of(filtered), nextCursor: null);
  }

  @override
  Future<PosProductVariantPage> listVariants(
    String productId, {
    String? cursor,
    int limit = 50,
    String? status,
  }) async {
    listVariantsCalls.add(productId);
    final items = variantsByProduct[productId] ?? const <PosProductVariant>[];
    final filtered = status == null ? items : items.where((variant) => variant.status == status).toList();
    return PosProductVariantPage(items: List.of(filtered), nextCursor: null);
  }

  @override
  Future<PosProductVariant> createVariant(String productId, PosProductVariantInput input) async {
    createCalls.add((productId: productId, input: input));
    final variant = PosProductVariant(
      id: 'variant-${_autoId++}',
      productId: productId,
      sku: input.sku!,
      name: input.name,
      unitOfMeasureCode: input.unitOfMeasureCode!,
      quantityScale: input.quantityScale ?? 0,
      tracksInventory: input.tracksInventory ?? false,
      standardCost: input.standardCost,
      currencyCode: input.currencyCode,
      isDefault: input.isDefault ?? false,
      status: input.status ?? 'active',
      version: 1,
      createdAt: DateTime.utc(2026, 9, 1),
      updatedAt: DateTime.utc(2026, 9, 1),
    );
    variantsByProduct.putIfAbsent(productId, () => []).add(variant);
    return variant;
  }

  @override
  Future<PosProductVariant> updateVariant(String id, int version, PosProductVariantInput input) async {
    updateCalls.add((id: id, version: version, input: input));
    for (final entry in variantsByProduct.entries) {
      final index = entry.value.indexWhere((variant) => variant.id == id);
      if (index == -1) continue;
      final current = entry.value[index];
      final updated = PosProductVariant(
        id: current.id,
        productId: current.productId,
        sku: input.sku ?? current.sku,
        name: input.name ?? current.name,
        unitOfMeasureCode: input.unitOfMeasureCode ?? current.unitOfMeasureCode,
        quantityScale: input.quantityScale ?? current.quantityScale,
        tracksInventory: input.tracksInventory ?? current.tracksInventory,
        standardCost: input.standardCost ?? current.standardCost,
        currencyCode: input.currencyCode ?? current.currencyCode,
        isDefault: input.isDefault ?? current.isDefault,
        status: input.status ?? current.status,
        version: current.version + 1,
        createdAt: current.createdAt,
        updatedAt: DateTime.utc(2026, 9, 2),
      );
      entry.value[index] = updated;
      return updated;
    }
    throw StateError('Variant not found: $id');
  }
}

Future<void> _pump(
  WidgetTester tester, {
  required _RecordingProductVariantsGateway gateway,
  required List<String> permissions,
}) async {
  tester.view.physicalSize = const Size(1280, 1400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: PosProductVariantsScreen(context: _context(permissions), gateway: gateway),
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
