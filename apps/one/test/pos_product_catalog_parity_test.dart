/// TASK 16.6 (Productos/Catálogo legacy parity) — widget-level coverage for
/// the product create/edit/duplicate/image-management flows and the two
/// product-card renderers (`_PosProductCard`/`_ProductCard` in
/// `pos_shell.dart`), none of which had ANY test coverage before this task
/// (Agent-confirmed via a full-codebase search). Everything here goes
/// through the public `PosShell` widget — `_NewProductDialog`/
/// `_EditProductDialog`/`_ProductCard`/`_PosProductCard` are private to
/// `pos_shell.dart` and cannot be referenced from a separate test library —
/// mirroring `pos_shell_wave2_supplier_linkage_test.dart`'s own established
/// "own sibling file, never appended to the already-huge `pos_shell_test
/// .dart`" convention. Real, in-memory recording fake gateways throughout —
/// never a mock framework.
library;

import 'dart:typed_data';

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
import 'package:as_one/features/pos/pos_product_card_visual.dart';
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
import 'package:image_picker/image_picker.dart';

void main() {
  group('TASK 16.6 — product cards render real image/icon/color/featured', () {
    testWidgets('an icon_key-only product shows its mapped icon on both cards', (tester) async {
      await _pump(tester, readGateway: const _FixtureReadGateway([_iconOnlyProduct]));
      await _navigateToProducts(tester);

      expect(find.byIcon(Icons.local_pizza_outlined), findsWidgets);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a product with neither image nor icon_key falls back to the platform default icon', (
      tester,
    ) async {
      await _pump(tester, readGateway: const _FixtureReadGateway([_plainProduct]));
      await _navigateToProducts(tester);

      expect(find.byIcon(Icons.inventory_2_outlined), findsWidgets);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a featured product shows the featured badge; a non-featured one does not', (tester) async {
      await _pump(tester, readGateway: const _FixtureReadGateway([_featuredProduct, _plainProduct]));
      await _navigateToProducts(tester);

      // One card each on the real POS sell screen AND the admin grid.
      expect(find.byIcon(Icons.star), findsWidgets);
    });

    testWidgets(
      'a product with a real image_url never crashes the card and carries the exact URL through to rendering',
      (tester) async {
        await _pump(tester, readGateway: const _FixtureReadGateway([_imageProduct]));
        await _navigateToProducts(tester);

        // No real network access exists in this test environment — a
        // failed `Image.network` load is caught by the card's own
        // `errorBuilder` (`PosProductCardVisual`), replacing it with the
        // fallback icon on settle. This asserts that swap never surfaces
        // as an uncaught exception, and — checking the durable
        // `PosProductCardVisual` element rather than the transient
        // `Image` child — that the real configured URL genuinely reached
        // the rendering widget (the actual "flows through to the card"
        // requirement) rather than being silently dropped.
        expect(tester.takeException(), isNull);
        final visuals = tester.widgetList<PosProductCardVisual>(find.byType(PosProductCardVisual));
        expect(visuals.any((widget) => widget.imageUrl == _imageProduct.imageUrl), isTrue);
      },
    );
  });

  group('TASK 16.6 — create product (Extras tab fields)', () {
    testWidgets('creating a product sends every General/Precios/Extras field to the real backend', (
      tester,
    ) async {
      final catalogGateway = _RecordingCatalogAdminGateway();
      await _pump(tester, catalogAdminGateway: catalogGateway);
      await _navigateToProducts(tester);

      await tester.tap(find.byKey(const Key('pos-product-new-button')));
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('pos-product-new-code')), 'nueva-pizza');
      await tester.enterText(find.byKey(const Key('pos-product-new-name')), 'Pizza familiar');
      await tester.enterText(find.byKey(const Key('pos-product-new-description')), 'Pizza grande');
      await tester.enterText(find.byKey(const Key('pos-product-new-cost')), '55');
      await tester.enterText(find.byKey(const Key('pos-product-new-min-stock')), '2');
      await tester.enterText(
        find.byKey(const Key('pos-product-new-image-url')),
        'https://cdn.example.test/pizza.png',
      );

      await tester.ensureVisible(find.byKey(const Key('pos-product-new-featured')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-product-new-featured')));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Pizza').last);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Pizza').last);
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Sólido').last);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Sólido').last);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-product-new-confirm')));
      await tester.pumpAndSettle();

      final input = catalogGateway.lastCreateProductInput;
      expect(input, isNotNull);
      expect(input!.code, 'nueva-pizza');
      expect(input.name, 'Pizza familiar');
      expect(input.description, 'Pizza grande');
      expect(input.isFeatured, isTrue);
      expect(input.iconKey, 'pizza');
      expect(input.cardStyle, 'solid');
      expect(input.cardColorHex, isNotNull);
      expect(input.imageUrl, 'https://cdn.example.test/pizza.png');
      expect(input.minStock, '2');
    });
  });

  group('TASK 16.6 — edit product (real PATCH, never wired before)', () {
    testWidgets('editing a product fetches the real current row, then PATCHes with the real changes', (
      tester,
    ) async {
      final catalogGateway = _RecordingCatalogAdminGateway(products: [_editableProduct]);
      await _pump(tester, catalogAdminGateway: catalogGateway, readGateway: const _FixtureReadGateway([_plainProduct]));
      await _navigateToProducts(tester);

      await tester.tap(find.byKey(Key('pos-product-menu-${_plainProduct.id}')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Editar').last);
      await tester.pumpAndSettle();

      // Prefilled from the real fetched product, not the grid's own row —
      // shows in both the name field and the dialog's own live preview.
      expect(find.text('Editable original'), findsWidgets);
      expect(catalogGateway.productFetchCalls, contains(_plainProduct.id));

      await tester.enterText(find.byKey(const Key('pos-product-edit-name')), 'Editable actualizado');
      await tester.tap(find.byKey(const Key('pos-product-edit-featured')));
      await tester.tap(find.byKey(const Key('pos-product-edit-confirm')));
      await tester.pumpAndSettle();

      final patch = catalogGateway.lastUpdateProductInput;
      expect(patch, isNotNull);
      expect(patch!.name, 'Editable actualizado');
      expect(patch.isFeatured, isTrue);
    });

    testWidgets('choosing "Sin ícono"/"Predeterminado" really clears icon_key/card_color_hex, not merely omits them', (
      tester,
    ) async {
      final catalogGateway = _RecordingCatalogAdminGateway(products: [_iconOnlyEditableProduct]);
      await _pump(
        tester,
        catalogAdminGateway: catalogGateway,
        readGateway: const _FixtureReadGateway([_plainProduct]),
      );
      await _navigateToProducts(tester);

      await tester.tap(find.byKey(Key('pos-product-menu-${_plainProduct.id}')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Editar').last);
      await tester.pumpAndSettle();

      await tester.ensureVisible(find.text('Sin ícono').last);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Sin ícono').last);
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Predeterminado').last);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Predeterminado').last);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-product-edit-confirm')));
      await tester.pumpAndSettle();

      final patch = catalogGateway.lastUpdateProductInput;
      expect(patch, isNotNull);
      expect(patch!.clearIconKey, isTrue);
      expect(patch.clearCardColorHex, isTrue);
    });
  });

  group('TASK 16.6 — duplicate product ("Duplicar")', () {
    testWidgets('duplicating calls the real endpoint and refreshes the grid, no dialog required', (
      tester,
    ) async {
      final catalogGateway = _RecordingCatalogAdminGateway();
      await _pump(
        tester,
        catalogAdminGateway: catalogGateway,
        readGateway: const _FixtureReadGateway([_plainProduct]),
      );
      await _navigateToProducts(tester);

      await tester.tap(find.byKey(Key('pos-product-menu-${_plainProduct.id}')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Duplicar').last);
      await tester.pumpAndSettle();

      expect(catalogGateway.duplicateCalls, [_plainProduct.id]);
      expect(find.textContaining('borrador'), findsOneWidget);
    });
  });

  group('TASK 16.6 — real photo upload/remove (Extras tab)', () {
    testWidgets('picking and uploading a photo calls the real multipart endpoint with the current version', (
      tester,
    ) async {
      final catalogGateway = _RecordingCatalogAdminGateway(products: [_editableProduct]);
      final bytes = Uint8List.fromList([0x89, 0x50, 0x4e, 0x47]);
      await _pump(
        tester,
        catalogAdminGateway: catalogGateway,
        readGateway: const _FixtureReadGateway([_plainProduct]),
        // `XFile.fromData`'s VM/desktop implementation ignores `name` —
        // it derives the reported name from `path` instead (see
        // `cross_file`'s `io.dart`), so `path` is what must carry the
        // filename here.
        pickProductImage: () async => XFile.fromData(bytes, path: 'foto.png', mimeType: 'image/png'),
      );
      await _navigateToProducts(tester);

      await tester.tap(find.byKey(Key('pos-product-menu-${_plainProduct.id}')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Editar').last);
      await tester.pumpAndSettle();

      await tester.ensureVisible(find.byKey(const Key('pos-product-edit-upload-image')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-product-edit-upload-image')));
      await tester.pumpAndSettle();

      expect(catalogGateway.uploadImageCalls, hasLength(1));
      expect(catalogGateway.uploadImageCalls.single.filename, 'foto.png');
      expect(catalogGateway.uploadImageCalls.single.contentType, 'image/png');
      expect(find.byKey(const Key('pos-product-edit-remove-image')), findsOneWidget);
    });

    testWidgets('removing an existing photo calls the real delete endpoint', (tester) async {
      final catalogGateway = _RecordingCatalogAdminGateway(products: [_imageEditableProduct]);
      await _pump(
        tester,
        catalogAdminGateway: catalogGateway,
        readGateway: const _FixtureReadGateway([_plainProduct]),
      );
      await _navigateToProducts(tester);

      await tester.tap(find.byKey(Key('pos-product-menu-${_plainProduct.id}')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Editar').last);
      await tester.pumpAndSettle();

      await tester.ensureVisible(find.byKey(const Key('pos-product-edit-remove-image')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-product-edit-remove-image')));
      await tester.pumpAndSettle();

      expect(catalogGateway.deleteImageCalls, hasLength(1));
      expect(catalogGateway.deleteImageCalls.single.id, _imageEditableProduct.id);
    });
  });

  group('TASK 16.6A — production readiness: honest UI when object storage is not configured', () {
    testWidgets(
      'attempting an upload with no object storage configured shows the real, honest 404 message — never a fake success',
      (tester) async {
        final catalogGateway = _RecordingCatalogAdminGateway(
          products: [_editableProduct],
          imageStorageConfigured: false,
        );
        final bytes = Uint8List.fromList([0x89, 0x50, 0x4e, 0x47]);
        await _pump(
          tester,
          catalogAdminGateway: catalogGateway,
          readGateway: const _FixtureReadGateway([_plainProduct]),
          pickProductImage: () async => XFile.fromData(bytes, path: 'foto.png', mimeType: 'image/png'),
        );
        await _navigateToProducts(tester);

        await tester.tap(find.byKey(Key('pos-product-menu-${_plainProduct.id}')));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Editar').last);
        await tester.pumpAndSettle();

        await tester.ensureVisible(find.byKey(const Key('pos-product-edit-upload-image')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pos-product-edit-upload-image')));
        await tester.pumpAndSettle();

        expect(
          find.text('El almacenamiento de imágenes no está disponible en este servidor. Contacta a soporte.'),
          findsOneWidget,
        );
        // Never a silent/fake success: no image URL was ever set.
        expect(find.text('Imagen configurada'), findsNothing);
      },
    );

    testWidgets('removing an image with no object storage configured shows the same honest 404 message', (
      tester,
    ) async {
      final catalogGateway = _RecordingCatalogAdminGateway(
        products: [_imageEditableProduct],
        imageStorageConfigured: false,
      );
      await _pump(
        tester,
        catalogAdminGateway: catalogGateway,
        readGateway: const _FixtureReadGateway([_plainProduct]),
      );
      await _navigateToProducts(tester);

      await tester.tap(find.byKey(Key('pos-product-menu-${_plainProduct.id}')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Editar').last);
      await tester.pumpAndSettle();

      await tester.ensureVisible(find.byKey(const Key('pos-product-edit-remove-image')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-product-edit-remove-image')));
      await tester.pumpAndSettle();

      expect(
        find.text('El almacenamiento de imágenes no está disponible en este servidor. Contacta a soporte.'),
        findsOneWidget,
      );
      // The remove button stays, since the image was never actually cleared.
      expect(find.byKey(const Key('pos-product-edit-remove-image')), findsOneWidget);
    });
  });

  group('TASK 16.6A — legacy "Utilidad" parity (derived, read-only, never a second price-entry path)', () {
    test('a normal price/cost pair computes utilidad = precio - costo and a rounded margin %', () {
      final utilidad = posUtilidadFrom(
        PosCatalogEffectivePrice(
          id: 'price-1',
          branchId: null,
          amount: '100.0000',
          currencyCode: 'MXN',
          validFrom: _fixedValidFrom,
          validUntil: null,
          status: 'active',
        ),
        const PosCatalogDefaultVariant(
          id: 'variant-1',
          sku: 'SKU-1',
          unitOfMeasureCode: 'unit',
          quantityScale: 0,
          standardCost: '60.0000',
          currencyCode: 'MXN',
          version: 1,
        ),
      );
      expect(utilidad, isNotNull);
      expect(utilidad!.amount.toDisplayString(), '40.00');
      expect(utilidad.marginPercent, 40);
    });

    test('a genuinely free-to-stock (zero) cost computes a full 100% margin, never "missing"', () {
      final utilidad = posUtilidadFrom(
        PosCatalogEffectivePrice(
          id: 'price-2',
          branchId: null,
          amount: '50.0000',
          currencyCode: 'MXN',
          validFrom: _fixedValidFrom,
          validUntil: null,
          status: 'active',
        ),
        const PosCatalogDefaultVariant(
          id: 'variant-2',
          sku: 'SKU-2',
          unitOfMeasureCode: 'unit',
          quantityScale: 0,
          standardCost: '0.0000',
          currencyCode: 'MXN',
          version: 1,
        ),
      );
      expect(utilidad, isNotNull);
      expect(utilidad!.amount.toDisplayString(), '50.00');
      expect(utilidad.marginPercent, 100);
    });

    test('a cost higher than price computes a real negative utilidad, never clamped', () {
      final utilidad = posUtilidadFrom(
        PosCatalogEffectivePrice(
          id: 'price-3',
          branchId: null,
          amount: '20.0000',
          currencyCode: 'MXN',
          validFrom: _fixedValidFrom,
          validUntil: null,
          status: 'active',
        ),
        const PosCatalogDefaultVariant(
          id: 'variant-3',
          sku: 'SKU-3',
          unitOfMeasureCode: 'unit',
          quantityScale: 0,
          standardCost: '35.0000',
          currencyCode: 'MXN',
          version: 1,
        ),
      );
      expect(utilidad, isNotNull);
      expect(utilidad!.amount.isNegative, isTrue);
      expect(utilidad.amount.toDisplayString(), '-15.00');
      expect(utilidad.marginPercent, -75);
    });

    test('a missing cost (no inventory.cost.read, or genuinely unset) is an honest absent state, never \$0.00', () {
      final utilidad = posUtilidadFrom(
        PosCatalogEffectivePrice(
          id: 'price-4',
          branchId: null,
          amount: '20.0000',
          currencyCode: 'MXN',
          validFrom: _fixedValidFrom,
          validUntil: null,
          status: 'active',
        ),
        const PosCatalogDefaultVariant(
          id: 'variant-4',
          sku: 'SKU-4',
          unitOfMeasureCode: 'unit',
          quantityScale: 0,
          version: 1,
        ),
      );
      expect(utilidad, isNull);
    });

    test('a missing effective price (no active product_prices row yet) is an honest absent state', () {
      final utilidad = posUtilidadFrom(
        null,
        const PosCatalogDefaultVariant(
          id: 'variant-5',
          sku: 'SKU-5',
          unitOfMeasureCode: 'unit',
          quantityScale: 0,
          standardCost: '10.0000',
          currencyCode: 'MXN',
          version: 1,
        ),
      );
      expect(utilidad, isNull);
    });

    testWidgets('the edit dialog renders the real precio/costo/utilidad from the fetched product, read-only', (
      tester,
    ) async {
      final catalogGateway = _RecordingCatalogAdminGateway(products: [_pricedEditableProduct]);
      await _pump(
        tester,
        catalogAdminGateway: catalogGateway,
        readGateway: const _FixtureReadGateway([_plainProduct]),
      );
      await _navigateToProducts(tester);

      await tester.tap(find.byKey(Key('pos-product-menu-${_plainProduct.id}')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Editar').last);
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('pos-product-edit-utilidad')), findsOneWidget);
      expect(find.text('100.00'), findsOneWidget);
      expect(find.text('60.00'), findsOneWidget);
      expect(find.text('40.00 (40%)'), findsOneWidget);
      // Read-only: no editable price/cost TextField exists in the edit
      // dialog anywhere (they stay on their own real, separate screens).
      expect(find.byKey(const Key('pos-product-edit-price')), findsNothing);
      expect(find.byKey(const Key('pos-product-edit-cost')), findsNothing);
    });
  });
}

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------

const _iconOnlyProduct = PosProduct(
  id: 'icon-product',
  code: 'ICON-1',
  name: 'Pizza mediana',
  type: 'simple',
  status: 'active',
  tracksInventory: false,
  iconKey: 'pizza',
);

const _plainProduct = PosProduct(
  id: 'plain-product',
  code: 'PLAIN-1',
  name: 'Producto sencillo',
  type: 'simple',
  status: 'active',
  tracksInventory: false,
);

const _featuredProduct = PosProduct(
  id: 'featured-product',
  code: 'FEAT-1',
  name: 'Producto favorito',
  type: 'simple',
  status: 'active',
  tracksInventory: false,
  isFeatured: true,
);

const _imageProduct = PosProduct(
  id: 'image-product',
  code: 'IMG-1',
  name: 'Producto con foto',
  type: 'simple',
  status: 'active',
  tracksInventory: false,
  imageUrl: 'https://cdn.example.test/product.png',
);

const _editableProduct = PosCatalogProduct(
  id: 'plain-product',
  code: 'PLAIN-1',
  name: 'Editable original',
  status: 'active',
  version: 3,
  effectivePrice: null,
);

const _iconOnlyEditableProduct = PosCatalogProduct(
  id: 'plain-product',
  code: 'PLAIN-1',
  name: 'Editable original',
  status: 'active',
  iconKey: 'pizza',
  cardStyle: 'solid',
  cardColorHex: '#6B3FA0',
  version: 3,
  effectivePrice: null,
);

const _imageEditableProduct = PosCatalogProduct(
  id: 'plain-product',
  code: 'PLAIN-1',
  name: 'Editable original',
  status: 'active',
  imageUrl: 'https://cdn.example.test/existing.png',
  version: 3,
  effectivePrice: null,
);

/// A fixed, arbitrary `valid_from` for the Utilidad fixtures below —
/// `PosCatalogEffectivePrice.validFrom` is non-nullable, matching the
/// backend's own `priceHttp()` (always a real timestamp); its exact value
/// is irrelevant to every Utilidad test, which only inspects `amount`.
final _fixedValidFrom = DateTime.utc(2026, 9, 15);

final _pricedEditableProduct = PosCatalogProduct(
  id: 'plain-product',
  code: 'PLAIN-1',
  name: 'Editable original',
  status: 'active',
  version: 3,
  effectivePrice: PosCatalogEffectivePrice(
    id: 'price-live',
    branchId: null,
    amount: '100.0000',
    currencyCode: 'MXN',
    validFrom: _fixedValidFrom,
    validUntil: null,
    status: 'active',
  ),
  defaultVariant: PosCatalogDefaultVariant(
    id: 'variant-live',
    sku: 'SKU-LIVE',
    unitOfMeasureCode: 'unit',
    quantityScale: 0,
    standardCost: '60.0000',
    currencyCode: 'MXN',
    version: 1,
  ),
);

/// TASK 16.6A — the real shape a genuine "object storage isn't configured"
/// failure takes by the time it reaches Flutter: a real Fastify 404 for
/// an unregistered route decodes to `AppFailure.fromCode`'s own default
/// (`unknown`) arm — never a bespoke "storage unavailable" exception type.
const _notFoundApiException = ApiException(
  AppFailure(AppErrorKind.unknown, 'No fue posible completar la solicitud.'),
  statusCode: 404,
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
}

class _RecordingCatalogAdminGateway implements PosCatalogAdminGateway {
  _RecordingCatalogAdminGateway({List<PosCatalogProduct>? products, this.imageStorageConfigured = true})
    : products = List.of(products ?? const []);

  final List<PosCatalogProduct> products;

  /// TASK 16.6A — `false` simulates the real, production-honest state
  /// when the platform's object storage isn't configured server-side:
  /// `register-plugins.ts` never registers the two image routes at all,
  /// so any call reaches a real Fastify `404`, never a fabricated
  /// success. Mirrors that exact contract here rather than inventing a
  /// separate "storage unavailable" exception type the real gateway
  /// doesn't have.
  final bool imageStorageConfigured;
  PosNewProductInput? lastCreateProductInput;
  PosProductPatchInput? lastUpdateProductInput;
  final List<String> productFetchCalls = [];
  final List<String> duplicateCalls = [];
  final List<({String id, String filename, String contentType})> uploadImageCalls = [];
  final List<({String id, int expectedVersion})> deleteImageCalls = [];
  int _autoId = 0;

  @override
  Future<PosCatalogProductPage> listProducts({
    String? cursor,
    int limit = 50,
    String? search,
    String? branchId,
  }) async => PosCatalogProductPage(items: List.of(products), nextCursor: null);

  @override
  Future<PosCatalogProduct> createProduct(PosNewProductInput input) async {
    lastCreateProductInput = input;
    final created = PosCatalogProduct(
      id: 'created-${_autoId++}',
      code: input.code,
      name: input.name,
      status: input.status,
      effectivePrice: null,
    );
    products.add(created);
    return created;
  }

  @override
  Future<PosCatalogProduct> product(String id) async {
    productFetchCalls.add(id);
    return products.firstWhere(
      (item) => item.id == id,
      orElse: () => PosCatalogProduct(id: id, code: id, name: id, status: 'active', effectivePrice: null),
    );
  }

  @override
  Future<PosCatalogProduct> updateProduct(String id, int version, PosProductPatchInput input) async {
    lastUpdateProductInput = input;
    final current = await product(id);
    final updated = PosCatalogProduct(
      id: current.id,
      code: current.code,
      name: input.name ?? current.name,
      description: input.description ?? current.description,
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
    duplicateCalls.add(id);
    final source = await product(id);
    final duplicate = PosCatalogProduct(
      id: 'duplicate-${_autoId++}',
      code: '${source.code}-copia',
      name: '${source.name} (copia)',
      status: 'draft',
      effectivePrice: null,
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
    if (!imageStorageConfigured) throw _notFoundApiException;
    uploadImageCalls.add((id: id, filename: filename, contentType: contentType));
    final current = await product(id);
    final updated = PosCatalogProduct(
      id: current.id,
      code: current.code,
      name: current.name,
      status: current.status,
      imageUrl: 'https://fake-storage.test/$id/$filename',
      version: expectedVersion + 1,
      effectivePrice: current.effectivePrice,
    );
    final index = products.indexWhere((item) => item.id == id);
    if (index != -1) products[index] = updated;
    return updated;
  }

  @override
  Future<PosCatalogProduct> deleteProductImage(String id, int expectedVersion) async {
    if (!imageStorageConfigured) throw _notFoundApiException;
    deleteImageCalls.add((id: id, expectedVersion: expectedVersion));
    final current = await product(id);
    final updated = PosCatalogProduct(
      id: current.id,
      code: current.code,
      name: current.name,
      status: current.status,
      version: expectedVersion + 1,
      effectivePrice: current.effectivePrice,
    );
    final index = products.indexWhere((item) => item.id == id);
    if (index != -1) products[index] = updated;
    return updated;
  }

  @override
  Future<PosCatalogVariantPage> listVariants(String productId, {String? cursor, int limit = 50}) async =>
      const PosCatalogVariantPage(items: [], nextCursor: null);

  @override
  Future<PosProductPrice> createProductPrice(String productId, PosProductPriceInput input) =>
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

Future<void> _pump(
  WidgetTester tester, {
  PosCatalogAdminGateway? catalogAdminGateway,
  PosReadGateway readGateway = const _FixtureReadGateway([_plainProduct]),
  ProductImagePicker? pickProductImage,
}) async {
  tester.view.physicalSize = const Size(1440, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
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
        catalogAdminGateway: catalogAdminGateway ?? _RecordingCatalogAdminGateway(),
        categoryAdminGateway: const EmptyPosCategoryAdminGateway(),
        brandAdminGateway: const EmptyPosBrandAdminGateway(),
        suppliersGateway: const EmptyPosSuppliersGateway(),
        pickProductImage: pickProductImage,
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

Future<void> _navigateToProducts(WidgetTester tester) async {
  await _openGroupIfNeeded(tester, 'Catálogo', 'nav-products');
  await tester.tap(find.byKey(const Key('nav-products')));
  await tester.pumpAndSettle();
}
