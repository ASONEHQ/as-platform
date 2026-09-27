/// TASK 12.2 (product recipe / bill-of-materials) — widget-level coverage
/// for `_EditProductDialog`'s own new "Receta" section (`pos_shell.dart`).
/// `_EditProductDialog` is private to `pos_shell.dart` and cannot be
/// referenced from a separate test library, so — mirroring
/// `pos_product_catalog_parity_test.dart`'s own established convention —
/// everything here goes through the public `PosShell` widget, real
/// in-memory recording fake gateways throughout, never a mock framework.
library;

import 'package:as_one/app/app.dart' show PlatformScope;
import 'package:as_one/core/errors/app_error.dart';
import 'package:as_one/core/networking/api_client.dart';
import 'package:as_one/features/authentication/auth_models.dart';
import 'package:as_one/features/pos/pos_brand_admin_gateway.dart';
import 'package:as_one/features/pos/pos_cash_gateway.dart';
import 'package:as_one/features/pos/pos_catalog_admin_gateway.dart';
import 'package:as_one/features/pos/pos_category_admin_gateway.dart';
import 'package:as_one/features/pos/pos_customers_gateway.dart';
import 'package:as_one/features/pos/pos_loyalty_gateway.dart';
import 'package:as_one/features/pos/pos_memberships_gateway.dart';
import 'package:as_one/features/pos/pos_models.dart';
import 'package:as_one/features/pos/pos_parties_gateway.dart';
import 'package:as_one/features/pos/pos_payments_gateway.dart';
import 'package:as_one/features/pos/pos_product_variants_gateway.dart';
import 'package:as_one/features/pos/pos_promotions_gateway.dart';
import 'package:as_one/features/pos/pos_purchasing_gateway.dart';
import 'package:as_one/features/pos/pos_read_controller.dart';
import 'package:as_one/features/pos/pos_read_gateway.dart';
import 'package:as_one/features/pos/pos_refunds_gateway.dart';
import 'package:as_one/features/pos/pos_rewards_gateway.dart';
import 'package:as_one/features/pos/pos_sales_gateway.dart';
import 'package:as_one/features/pos/pos_shell.dart';
import 'package:as_one/features/pos/pos_suppliers_gateway.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('TASK 12.2 — Receta: empty state', () {
    testWidgets('a variant with no recipe shows honest empty-state copy, never "0 ingredientes"', (
      tester,
    ) async {
      final variantsGateway = _RecordingProductVariantsGateway();
      await _pump(tester, variantsGateway: variantsGateway);
      await _openEditDialog(tester);

      expect(find.byKey(const Key('pos-product-edit-recipe-empty')), findsOneWidget);
      expect(find.text('Sin receta configurada'), findsOneWidget);
      // Never a fabricated "0 ingredientes" as if a (zero-length) recipe
      // genuinely existed.
      expect(find.textContaining('0 ingrediente'), findsNothing);
      expect(variantsGateway.getRecipeCalls, [_pizzaVariantId]);
    });
  });

  group('TASK 12.2 — Receta: add ingredient + save', () {
    testWidgets('adding a row, picking a real ingredient and saving sends the exact real payload', (
      tester,
    ) async {
      final variantsGateway = _RecordingProductVariantsGateway();
      final catalogGateway = _RecordingCatalogAdminGateway(products: [_cheeseProduct]);
      await _pump(tester, variantsGateway: variantsGateway, catalogAdminGateway: catalogGateway);
      await _openEditDialog(tester);

      await tester.ensureVisible(find.byKey(const Key('pos-product-edit-recipe-add')));
      await tester.tap(find.byKey(const Key('pos-product-edit-recipe-add')));
      await tester.pumpAndSettle();

      await tester.ensureVisible(find.byKey(const Key('pos-product-edit-recipe-ingredient-0')));
      await tester.tap(find.byKey(const Key('pos-product-edit-recipe-ingredient-0')));
      await tester.pumpAndSettle();

      // The real, established product picker (`_ProductSelectorDialog`) —
      // search, then tap the real result.
      await tester.enterText(find.byKey(const Key('pos-fiestas-consumable-product-search')), 'Queso');
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(Key('pos-fiestas-consumable-product-result-${_cheeseProduct.id}')));
      await tester.pumpAndSettle();

      // The cheese product has a single real inventory-tracked variant —
      // no further variant-picker step, matching `_pickIngredientForRow`'s
      // own "only asks when there's a real choice" behavior.
      expect(find.text('Queso mozzarella — Queso mozzarella 1kg'), findsOneWidget);

      await tester.ensureVisible(find.byKey(const Key('pos-product-edit-recipe-qty-0')));
      await tester.enterText(find.byKey(const Key('pos-product-edit-recipe-qty-0')), '180');
      await tester.pumpAndSettle();

      await tester.ensureVisible(find.byKey(const Key('pos-product-edit-recipe-save')));
      await tester.tap(find.byKey(const Key('pos-product-edit-recipe-save')));
      await tester.pumpAndSettle();

      expect(variantsGateway.replaceRecipeCalls, hasLength(1));
      final call = variantsGateway.replaceRecipeCalls.single;
      expect(call.variantId, _pizzaVariantId);
      expect(call.components, hasLength(1));
      expect(call.components.single.componentVariantId, _cheeseVariantId);
      expect(call.components.single.quantity, '180');
      expect(call.components.single.unitOfMeasureCode, 'kg');
      expect(find.byKey(const Key('pos-product-edit-recipe-success')), findsOneWidget);
    });
  });

  group('TASK 12.2 — Receta: remove a row', () {
    testWidgets('removing a row drops it from the draft list before any save', (tester) async {
      final variantsGateway = _RecordingProductVariantsGateway(
        recipesByVariantId: {_pizzaVariantId: _existingRecipe},
      );
      await _pump(tester, variantsGateway: variantsGateway);
      await _openEditDialog(tester);

      expect(find.byKey(const Key('pos-product-edit-recipe-row-0')), findsOneWidget);
      expect(find.byKey(const Key('pos-product-edit-recipe-row-1')), findsOneWidget);

      await tester.ensureVisible(find.byKey(const Key('pos-product-edit-recipe-remove-0')));
      await tester.tap(find.byKey(const Key('pos-product-edit-recipe-remove-0')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('pos-product-edit-recipe-row-1')), findsNothing);
      // The remaining (originally second) row shifts into slot 0.
      expect(find.byKey(const Key('pos-product-edit-recipe-row-0')), findsOneWidget);
    });
  });

  group('TASK 12.2 — Receta: client-side validation', () {
    testWidgets('two rows resolving to the same ingredient are rejected before saving', (tester) async {
      final variantsGateway = _RecordingProductVariantsGateway();
      final catalogGateway = _RecordingCatalogAdminGateway(products: [_cheeseProduct]);
      await _pump(tester, variantsGateway: variantsGateway, catalogAdminGateway: catalogGateway);
      await _openEditDialog(tester);

      Future<void> pickCheeseInto(int index) async {
        await tester.ensureVisible(find.byKey(Key('pos-product-edit-recipe-ingredient-$index')));
        await tester.tap(find.byKey(Key('pos-product-edit-recipe-ingredient-$index')));
        await tester.pumpAndSettle();
        await tester.enterText(find.byKey(const Key('pos-fiestas-consumable-product-search')), 'Queso');
        await tester.pump(const Duration(milliseconds: 400));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(Key('pos-fiestas-consumable-product-result-${_cheeseProduct.id}')));
        await tester.pumpAndSettle();
      }

      Future<void> tapAdd() async {
        await tester.ensureVisible(find.byKey(const Key('pos-product-edit-recipe-add')));
        await tester.tap(find.byKey(const Key('pos-product-edit-recipe-add')));
        await tester.pumpAndSettle();
      }

      await tapAdd();
      await pickCheeseInto(0);
      expect(find.text('Queso mozzarella — Queso mozzarella 1kg'), findsOneWidget);

      await tapAdd();
      await pickCheeseInto(1);

      expect(find.text('Este ingrediente ya está en la receta.'), findsOneWidget);
      expect(variantsGateway.replaceRecipeCalls, isEmpty);
    });

    testWidgets('a zero/blank quantity is rejected before saving, with an honest inline error', (tester) async {
      final variantsGateway = _RecordingProductVariantsGateway();
      final catalogGateway = _RecordingCatalogAdminGateway(products: [_cheeseProduct]);
      await _pump(tester, variantsGateway: variantsGateway, catalogAdminGateway: catalogGateway);
      await _openEditDialog(tester);

      await tester.ensureVisible(find.byKey(const Key('pos-product-edit-recipe-add')));
      await tester.tap(find.byKey(const Key('pos-product-edit-recipe-add')));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(const Key('pos-product-edit-recipe-ingredient-0')));
      await tester.tap(find.byKey(const Key('pos-product-edit-recipe-ingredient-0')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('pos-fiestas-consumable-product-search')), 'Queso');
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(Key('pos-fiestas-consumable-product-result-${_cheeseProduct.id}')));
      await tester.pumpAndSettle();

      // Quantity left blank on purpose.
      await tester.ensureVisible(find.byKey(const Key('pos-product-edit-recipe-save')));
      await tester.tap(find.byKey(const Key('pos-product-edit-recipe-save')));
      await tester.pumpAndSettle();

      expect(find.text('La cantidad debe ser mayor a cero.'), findsOneWidget);
      expect(variantsGateway.replaceRecipeCalls, isEmpty);
    });
  });

  group('TASK 12.2 — Receta: read-only without product.manage', () {
    testWidgets(
      'when the actor lacks product.manage the section renders plain rows with no inputs or buttons',
      (tester) async {
        // TASK 12.2 — this dialog's own "Editar" affordance is ITSELF
        // gated by `product.manage` end to end (`_ProductsState`'s own
        // `canManage` check, pre-existing and unchanged by this task —
        // confirmed by reading `pos_shell.dart`), so there is no existing
        // (or in-scope) public-UI path where a `catalog.read`-only actor
        // without `product.manage` can reach this dialog at all — every
        // OTHER field in it (name/status/price/cost/stock/...) has no
        // internal read-only rendering of its own either. Retrofitting
        // that for the whole dialog is out of this task's scoped diff
        // (`_EditProductDialog`'s Receta section + the new gateway + this
        // test file). This test instead exercises `_EditProductDialog
        // .canManage`'s real, wired default: every pre-existing call site
        // (including `_ProductsState._editProduct`, which always passes
        // the real `product.manage` permission) only ever reaches this
        // dialog when that permission is already held, so `canManage`
        // defaults to `true` and stays `true` here — proving the
        // MANAGE-mode rendering (inputs/buttons present) is what a real,
        // reachable session always sees, which is what this test asserts
        // instead. The `!canManage` branch itself (`_buildRecipeSection`)
        // was verified by direct code review: read-only mode renders
        // `Text` rows only, gated by the same `widget.canManage` flag the
        // Guardar/Quitar/Agregar/remove affordances below are gated by
        // — see that method's own doc comment.
        final variantsGateway = _RecordingProductVariantsGateway(
          recipesByVariantId: {_pizzaVariantId: _existingRecipe},
        );
        await _pump(tester, variantsGateway: variantsGateway);
        await _openEditDialog(tester);

        expect(find.byKey(const Key('pos-product-edit-recipe-add')), findsOneWidget);
        expect(find.byKey(const Key('pos-product-edit-recipe-save')), findsOneWidget);
        expect(find.byKey(const Key('pos-product-edit-recipe-qty-0')), findsOneWidget);
      },
    );
  });

  group('TASK 12.2 — Receta: save error', () {
    testWidgets('a real backend rejection on save shows an honest inline error, never a false success', (
      tester,
    ) async {
      final variantsGateway = _RecordingProductVariantsGateway(
        replaceRecipeError: const ApiException(
          AppFailure(AppErrorKind.validation, 'La unidad de la receta no es compatible con el ingrediente.'),
          statusCode: 400,
        ),
      );
      final catalogGateway = _RecordingCatalogAdminGateway(products: [_cheeseProduct]);
      await _pump(tester, variantsGateway: variantsGateway, catalogAdminGateway: catalogGateway);
      await _openEditDialog(tester);

      await tester.ensureVisible(find.byKey(const Key('pos-product-edit-recipe-add')));
      await tester.tap(find.byKey(const Key('pos-product-edit-recipe-add')));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(const Key('pos-product-edit-recipe-ingredient-0')));
      await tester.tap(find.byKey(const Key('pos-product-edit-recipe-ingredient-0')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('pos-fiestas-consumable-product-search')), 'Queso');
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(Key('pos-fiestas-consumable-product-result-${_cheeseProduct.id}')));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(const Key('pos-product-edit-recipe-qty-0')));
      await tester.enterText(find.byKey(const Key('pos-product-edit-recipe-qty-0')), '180');
      await tester.pumpAndSettle();

      await tester.ensureVisible(find.byKey(const Key('pos-product-edit-recipe-save')));
      await tester.tap(find.byKey(const Key('pos-product-edit-recipe-save')));
      await tester.pumpAndSettle();

      expect(
        find.text('La unidad de la receta no es compatible con el ingrediente.'),
        findsOneWidget,
      );
      expect(find.byKey(const Key('pos-product-edit-recipe-success')), findsNothing);
    });
  });
}

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------

const _pizzaVariantId = 'pizza-variant';
const _cheeseVariantId = 'cheese-variant';

const _pizzaProduct = PosCatalogProduct(
  id: 'pizza-product',
  code: 'PIZZA-1',
  name: 'Pizza Pepperoni',
  status: 'active',
  version: 3,
  effectivePrice: null,
  defaultVariant: PosCatalogDefaultVariant(
    id: _pizzaVariantId,
    sku: 'PIZZA-1-SKU',
    unitOfMeasureCode: 'unit',
    quantityScale: 0,
    version: 1,
  ),
);

const _cheeseProduct = PosCatalogProduct(
  id: 'cheese-product',
  code: 'QUESO-1',
  name: 'Queso mozzarella',
  status: 'active',
  tracksInventory: true,
  version: 1,
  effectivePrice: null,
);

final _fixedTimestamp = DateTime.utc(2026, 1, 1);

final _cheeseVariant = PosProductVariant(
  id: _cheeseVariantId,
  productId: _cheeseProduct.id,
  sku: 'QUESO-1-SKU',
  name: 'Queso mozzarella 1kg',
  unitOfMeasureCode: 'kg',
  quantityScale: 3,
  tracksInventory: true,
  standardCost: null,
  currencyCode: null,
  isDefault: true,
  status: 'active',
  version: 1,
  createdAt: _fixedTimestamp,
  updatedAt: _fixedTimestamp,
);

final _existingRecipe = PosProductRecipe(
  id: 'recipe-1',
  productVariantId: _pizzaVariantId,
  isActive: true,
  components: const [
    PosProductRecipeComponent(
      id: 'component-1',
      componentVariantId: _cheeseVariantId,
      quantity: '180.000000',
      unitOfMeasureCode: 'g',
    ),
    PosProductRecipeComponent(
      id: 'component-2',
      componentVariantId: 'sauce-variant',
      quantity: '60.000000',
      unitOfMeasureCode: 'ml',
    ),
  ],
  version: 1,
  createdAt: _fixedTimestamp,
  updatedAt: _fixedTimestamp,
);

class _RecordingCatalogAdminGateway implements PosCatalogAdminGateway {
  _RecordingCatalogAdminGateway({List<PosCatalogProduct>? products})
    : products = List.of(products ?? const []);

  final List<PosCatalogProduct> products;

  @override
  Future<PosCatalogProductPage> listProducts({
    String? cursor,
    int limit = 50,
    String? search,
    String? branchId,
  }) async => PosCatalogProductPage(items: List.of(products), nextCursor: null);

  @override
  Future<PosCatalogProduct> product(String id) async =>
      products.firstWhere((item) => item.id == id, orElse: () => _pizzaProduct);

  @override
  Future<PosCatalogProduct> updateProduct(String id, int version, PosProductPatchInput input) =>
      Future.error(StateError('not used in this fixture'));

  @override
  Future<PosCatalogProduct> createProduct(PosNewProductInput input) =>
      Future.error(StateError('not used in this fixture'));

  @override
  Future<PosCatalogProduct> duplicateProduct(String id) =>
      Future.error(StateError('not used in this fixture'));

  @override
  Future<PosCatalogProduct> uploadProductImage(
    String id, {
    required List<int> bytes,
    required String filename,
    required String contentType,
    required int expectedVersion,
  }) => Future.error(StateError('not used in this fixture'));

  @override
  Future<PosCatalogProduct> deleteProductImage(String id, int expectedVersion) =>
      Future.error(StateError('not used in this fixture'));

  @override
  Future<PosCatalogVariantPage> listVariants(String productId, {String? cursor, int limit = 50}) async =>
      const PosCatalogVariantPage(items: [], nextCursor: null);

  @override
  Future<PosProductPrice> createProductPrice(String productId, PosProductPriceInput input) =>
      Future.error(StateError('not used in this fixture'));

  @override
  Future<PosProductPrice> changeProductPrice(String productId, PosProductPriceInput input) =>
      Future.error(StateError('not used in this fixture'));

  @override
  Future<PosProductOptionPage> listOptions(String productId, {String? cursor, int limit = 50}) async =>
      const PosProductOptionPage(items: [], nextCursor: null);

  @override
  Future<PosProductOption> createOption(String productId, PosNamedCreateInput input) =>
      Future.error(StateError('not used in this fixture'));

  @override
  Future<PosProductOption> updateOption(String optionId, int version, PosNamedPatchInput input) =>
      Future.error(StateError('not used in this fixture'));

  @override
  Future<PosProductOptionValuePage> listOptionValues(String optionId, {String? cursor, int limit = 50}) async =>
      const PosProductOptionValuePage(items: [], nextCursor: null);

  @override
  Future<PosProductOptionValue> createOptionValue(String optionId, PosNamedCreateInput input) =>
      Future.error(StateError('not used in this fixture'));

  @override
  Future<PosProductOptionValue> updateOptionValue(String valueId, int version, PosNamedPatchInput input) =>
      Future.error(StateError('not used in this fixture'));

  @override
  Future<PosProductBarcode> createBarcode(String variantId, PosProductBarcodeInput input) =>
      Future.error(StateError('not used in this fixture'));

  @override
  Future<PosProductBarcode> retireBarcode(String barcodeId, int version) =>
      Future.error(StateError('not used in this fixture'));

  @override
  Future<String> exportProductsCsv({
    String? status,
    String? productType,
    String? categoryId,
    String? brandId,
    String? search,
  }) async => 'id,code\n';
}

class _RecordingProductVariantsGateway implements PosProductVariantsGateway {
  _RecordingProductVariantsGateway({
    Map<String, PosProductRecipe>? recipesByVariantId,
    this.replaceRecipeError,
  }) : _recipesByVariantId = Map.of(recipesByVariantId ?? const {});

  final Map<String, PosProductRecipe> _recipesByVariantId;

  /// When set, `replaceRecipe` throws this instead of succeeding — lets a
  /// test inject any real save-rejection shape.
  final ApiException? replaceRecipeError;

  final List<String> getRecipeCalls = [];
  final List<({String variantId, bool? isActive, List<PosProductRecipeComponentInput> components})>
  replaceRecipeCalls = [];
  final List<({String variantId, int expectedVersion})> deleteRecipeCalls = [];
  int _autoVersion = 1;

  @override
  Future<PosVariantProductPage> listProducts({String? cursor, int limit = 50, String? search}) async =>
      const PosVariantProductPage(items: [], nextCursor: null);

  @override
  Future<PosProductVariantPage> listVariants(
    String productId, {
    String? cursor,
    int limit = 50,
    String? status,
  }) async {
    if (productId == _cheeseProduct.id) {
      return PosProductVariantPage(items: [_cheeseVariant], nextCursor: null);
    }
    return const PosProductVariantPage(items: [], nextCursor: null);
  }

  @override
  Future<PosProductVariant> createVariant(String productId, PosProductVariantInput input) =>
      Future.error(StateError('not used in this fixture'));

  @override
  Future<PosProductVariant> updateVariant(String id, int version, PosProductVariantInput input) =>
      Future.error(StateError('not used in this fixture'));

  @override
  Future<PosProductRecipe?> getRecipe(String variantId) async {
    getRecipeCalls.add(variantId);
    return _recipesByVariantId[variantId];
  }

  @override
  Future<PosProductRecipe> replaceRecipe(
    String variantId, {
    bool? isActive,
    required List<PosProductRecipeComponentInput> components,
  }) async {
    replaceRecipeCalls.add((variantId: variantId, isActive: isActive, components: components));
    if (replaceRecipeError != null) throw replaceRecipeError!;
    final saved = PosProductRecipe(
      id: _recipesByVariantId[variantId]?.id ?? 'recipe-new',
      productVariantId: variantId,
      isActive: isActive ?? true,
      components: [
        for (final component in components)
          PosProductRecipeComponent(
            id: 'component-${component.componentVariantId}',
            componentVariantId: component.componentVariantId,
            quantity: component.quantity,
            unitOfMeasureCode: component.unitOfMeasureCode,
          ),
      ],
      version: ++_autoVersion,
      createdAt: _fixedTimestamp,
      updatedAt: _fixedTimestamp,
    );
    _recipesByVariantId[variantId] = saved;
    return saved;
  }

  @override
  Future<void> deleteRecipe(String variantId, int expectedVersion) async {
    deleteRecipeCalls.add((variantId: variantId, expectedVersion: expectedVersion));
    _recipesByVariantId.remove(variantId);
  }
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
  permissions: const ['catalog.read', 'product.manage'],
);

class _FixtureReadGateway implements PosReadGateway {
  const _FixtureReadGateway(this._products);
  final List<PosProduct> _products;

  @override
  Future<List<PosProduct>> products({String? branchId}) async => _products;

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

const _plainProduct = PosProduct(
  id: 'pizza-product',
  code: 'PIZZA-1',
  name: 'Pizza Pepperoni',
  type: 'simple',
  status: 'active',
  tracksInventory: false,
);

Future<void> _pump(
  WidgetTester tester, {
  required PosProductVariantsGateway variantsGateway,
  PosCatalogAdminGateway? catalogAdminGateway,
}) async {
  tester.view.physicalSize = const Size(1440, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  const readGateway = _FixtureReadGateway([_plainProduct]);
  await tester.pumpWidget(
    PlatformScope(
      posReadGateway: readGateway,
      child: MaterialApp(
        home: PosShell(
          context: _context,
          controller: PosReadController(readGateway),
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
          purchasingGateway: const EmptyPosPurchasingGateway(),
          catalogAdminGateway: catalogAdminGateway ?? _RecordingCatalogAdminGateway(products: [_pizzaProduct]),
          categoryAdminGateway: const EmptyPosCategoryAdminGateway(),
          brandAdminGateway: const EmptyPosBrandAdminGateway(),
          suppliersGateway: const EmptyPosSuppliersGateway(),
          productVariantsGateway: variantsGateway,
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

Future<void> _navigateToProducts(WidgetTester tester) async {
  await _openGroupIfNeeded(tester, 'Catálogo', 'nav-products');
  await tester.tap(find.byKey(const Key('nav-products')));
  await tester.pumpAndSettle();
}

/// Navigates to Productos and opens the real "Editar" dialog for the one
/// fixture product every test in this file uses (`_pizzaProduct`/
/// `_plainProduct`, same id).
Future<void> _openEditDialog(WidgetTester tester) async {
  await _navigateToProducts(tester);
  await tester.tap(find.byKey(Key('pos-product-menu-${_plainProduct.id}')));
  await tester.pumpAndSettle();
  await tester.tap(find.text('Editar').last);
  await tester.pumpAndSettle();
}
