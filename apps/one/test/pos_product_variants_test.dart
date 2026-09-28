/// TASK 12.2 — widget tests for the standalone `PosProductVariantsScreen`
/// ("Variantes de producto"): product search/selection, the real fetched
/// variant list, create, edit (with its own real `version` on
/// `updateVariant`), and permission-gating for an actor without
/// `product.manage` (read-only — create/edit affordances are not rendered
/// at all). Uses a real, in-memory recording fake gateway — never a mock
/// framework — mirroring `pos_suppliers_test.dart`'s own
/// `_Recording*Gateway` fixture convention.
library;

import 'package:as_one/core/errors/app_error.dart';
import 'package:as_one/core/networking/api_client.dart';
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
      await tester.ensureVisible(find.byKey(const Key('pos-product-variants-form-save')));
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
      await tester.ensureVisible(find.byKey(const Key('pos-product-variants-form-save')));
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
      await tester.ensureVisible(find.byKey(const Key('pos-product-variants-form-save')));
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
      await tester.ensureVisible(find.byKey(const Key('pos-product-variants-form-save')));
      await tester.tap(find.byKey(const Key('pos-product-variants-form-save')));
      await tester.pumpAndSettle();

      expect(gateway.updateCalls, hasLength(1));
      expect(gateway.updateCalls.single.id, 'v-1');
      expect(gateway.updateCalls.single.version, 3);
      expect(gateway.updateCalls.single.input.name, 'Chica Editada');
      expect(find.text('Chica Editada'), findsOneWidget);
    });
  });

  group('TASK 16.32.7 — tracks_inventory control', () {
    testWidgets('Nueva variante defaults the toggle to ON', (tester) async {
      final gateway = _RecordingProductVariantsGateway(
        products: [_product(id: 'p-1', name: 'Playera Roja')],
        variantsByProduct: {'p-1': const []},
      );
      await _pump(tester, gateway: gateway, permissions: _readWrite);
      await tester.tap(find.byKey(const Key('pos-product-variants-product-p-1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-product-variants-new')));
      await tester.pumpAndSettle();

      final checkbox = tester.widget<CheckboxListTile>(
        find.byKey(const Key('pos-product-variants-form-tracks-inventory')),
      );
      expect(checkbox.value, isTrue);
      expect(find.text('El stock se descuenta directamente de esta variante.'), findsOneWidget);
    });

    testWidgets('create with the toggle ON sends tracks_inventory=true', (tester) async {
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
      await tester.ensureVisible(find.byKey(const Key('pos-product-variants-form-save')));
      await tester.tap(find.byKey(const Key('pos-product-variants-form-save')));
      await tester.pumpAndSettle();

      expect(gateway.createCalls, hasLength(1));
      expect(gateway.createCalls.single.input.tracksInventory, isTrue);
    });

    testWidgets('create with the toggle OFF sends tracks_inventory=false', (tester) async {
      final gateway = _RecordingProductVariantsGateway(
        products: [_product(id: 'p-1', name: 'Playera Roja')],
        variantsByProduct: {'p-1': const []},
      );
      await _pump(tester, gateway: gateway, permissions: _readWrite);
      await tester.tap(find.byKey(const Key('pos-product-variants-product-p-1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-product-variants-new')));
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('pos-product-variants-form-sku')), 'PIZZA-1');
      await tester.enterText(find.byKey(const Key('pos-product-variants-form-unit')), 'unit');
      await tester.tap(find.byKey(const Key('pos-product-variants-form-tracks-inventory')));
      await tester.pumpAndSettle();
      expect(find.text('Esta variante podrá utilizar una receta de ingredientes.'), findsOneWidget);
      await tester.ensureVisible(find.byKey(const Key('pos-product-variants-form-save')));
      await tester.tap(find.byKey(const Key('pos-product-variants-form-save')));
      await tester.pumpAndSettle();

      expect(gateway.createCalls, hasLength(1));
      expect(gateway.createCalls.single.input.tracksInventory, isFalse);
    });

    testWidgets('Editar variante whose backend value is true shows the toggle ON', (tester) async {
      final gateway = _RecordingProductVariantsGateway(
        products: [_product(id: 'p-1', name: 'Playera Roja')],
        variantsByProduct: {
          'p-1': [_variant(id: 'v-1', productId: 'p-1', sku: 'PLA-ROJ-S', tracksInventory: true)],
        },
      );
      await _pump(tester, gateway: gateway, permissions: _readWrite);
      await tester.tap(find.byKey(const Key('pos-product-variants-product-p-1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-product-variants-edit-v-1')));
      await tester.pumpAndSettle();

      final checkbox = tester.widget<CheckboxListTile>(
        find.byKey(const Key('pos-product-variants-form-tracks-inventory')),
      );
      expect(checkbox.value, isTrue);
    });

    testWidgets('Editar variante whose backend value is false shows the toggle OFF', (tester) async {
      final gateway = _RecordingProductVariantsGateway(
        products: [_product(id: 'p-1', name: 'Playera Roja')],
        variantsByProduct: {
          'p-1': [_variant(id: 'v-1', productId: 'p-1', sku: 'PIZZA-1', tracksInventory: false)],
        },
      );
      await _pump(tester, gateway: gateway, permissions: _readWrite);
      await tester.tap(find.byKey(const Key('pos-product-variants-product-p-1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-product-variants-edit-v-1')));
      await tester.pumpAndSettle();

      final checkbox = tester.widget<CheckboxListTile>(
        find.byKey(const Key('pos-product-variants-form-tracks-inventory')),
      );
      expect(checkbox.value, isFalse);
    });

    testWidgets('edit ON → OFF sends false, and reopening the form after reload reflects it', (tester) async {
      final gateway = _RecordingProductVariantsGateway(
        products: [_product(id: 'p-1', name: 'Playera Roja')],
        variantsByProduct: {
          'p-1': [_variant(id: 'v-1', productId: 'p-1', sku: 'PLA-ROJ-S', tracksInventory: true, version: 1)],
        },
      );
      await _pump(tester, gateway: gateway, permissions: _readWrite);
      await tester.tap(find.byKey(const Key('pos-product-variants-product-p-1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-product-variants-edit-v-1')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-product-variants-form-tracks-inventory')));
      await tester.ensureVisible(find.byKey(const Key('pos-product-variants-form-save')));
      await tester.tap(find.byKey(const Key('pos-product-variants-form-save')));
      await tester.pumpAndSettle();

      expect(gateway.updateCalls, hasLength(1));
      expect(gateway.updateCalls.single.input.tracksInventory, isFalse);

      // Reopen the (now real, updated) variant — the list already
      // reflects the reload this screen's own _openEditVariantForm
      // triggers on a successful save.
      await tester.tap(find.byKey(const Key('pos-product-variants-edit-v-1')));
      await tester.pumpAndSettle();
      final checkbox = tester.widget<CheckboxListTile>(
        find.byKey(const Key('pos-product-variants-form-tracks-inventory')),
      );
      expect(checkbox.value, isFalse);
    });

    testWidgets('edit OFF → ON without an active recipe succeeds', (tester) async {
      final gateway = _RecordingProductVariantsGateway(
        products: [_product(id: 'p-1', name: 'Playera Roja')],
        variantsByProduct: {
          'p-1': [_variant(id: 'v-1', productId: 'p-1', sku: 'PIZZA-1', tracksInventory: false, version: 1)],
        },
      );
      await _pump(tester, gateway: gateway, permissions: _readWrite);
      await tester.tap(find.byKey(const Key('pos-product-variants-product-p-1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-product-variants-edit-v-1')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-product-variants-form-tracks-inventory')));
      await tester.ensureVisible(find.byKey(const Key('pos-product-variants-form-save')));
      await tester.tap(find.byKey(const Key('pos-product-variants-form-save')));
      await tester.pumpAndSettle();

      expect(gateway.updateCalls, hasLength(1));
      expect(gateway.updateCalls.single.input.tracksInventory, isTrue);
      expect(find.byKey(const Key('pos-product-variants-form-error')), findsNothing);
    });

    testWidgets(
      'edit OFF → ON with an active recipe surfaces the real, specific backend conflict — never a silent revert',
      (tester) async {
        final gateway = _RecordingProductVariantsGateway(
          products: [_product(id: 'p-1', name: 'Playera Roja')],
          variantsByProduct: {
            'p-1': [_variant(id: 'v-1', productId: 'p-1', sku: 'PIZZA-1', tracksInventory: false, version: 1)],
          },
          updateVariantError: const ApiException(
            AppFailure(
              AppErrorKind.validation,
              'Este producto ya tiene una receta activa. Elimina la receta antes de activar el control de inventario directo.',
              code: 'variant_active_recipe_conflict',
            ),
            statusCode: 409,
          ),
        );
        await _pump(tester, gateway: gateway, permissions: _readWrite);
        await tester.tap(find.byKey(const Key('pos-product-variants-product-p-1')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pos-product-variants-edit-v-1')));
        await tester.pumpAndSettle();

        await tester.tap(find.byKey(const Key('pos-product-variants-form-tracks-inventory')));
        await tester.ensureVisible(find.byKey(const Key('pos-product-variants-form-save')));
      await tester.tap(find.byKey(const Key('pos-product-variants-form-save')));
        await tester.pumpAndSettle();

        expect(gateway.updateCalls, hasLength(1));
        expect(
          find.text(
            'Este producto ya tiene una receta activa. Elimina la receta antes de activar el control de inventario directo.',
          ),
          findsOneWidget,
        );
        // The dialog stays open on a real rejection — never a silent
        // success, never a pop as if the save had gone through.
        expect(find.byKey(const Key('pos-product-variants-form-save')), findsOneWidget);
      },
    );

    testWidgets('no automatic recipe deletion/mutation occurs during any create/edit/toggle flow', (tester) async {
      final gateway = _RecordingProductVariantsGateway(
        products: [_product(id: 'p-1', name: 'Playera Roja')],
        variantsByProduct: {
          'p-1': [_variant(id: 'v-1', productId: 'p-1', sku: 'PIZZA-1', tracksInventory: true, version: 1)],
        },
      );
      await _pump(tester, gateway: gateway, permissions: _readWrite);
      await tester.tap(find.byKey(const Key('pos-product-variants-product-p-1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-product-variants-edit-v-1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-product-variants-form-tracks-inventory')));
      await tester.ensureVisible(find.byKey(const Key('pos-product-variants-form-save')));
      await tester.tap(find.byKey(const Key('pos-product-variants-form-save')));
      await tester.pumpAndSettle();

      expect(gateway.getRecipeCallCount, 0);
      expect(gateway.replaceRecipeCallCount, 0);
      expect(gateway.deleteRecipeCallCount, 0);
    });

    for (final size in const [Size(1440, 900), Size(1365, 768)]) {
      testWidgets(
        'the variant form with the new toggle fits without overflow at ${size.width.toInt()}x${size.height.toInt()}',
        (tester) async {
          final gateway = _RecordingProductVariantsGateway(
            products: [_product(id: 'p-1', name: 'Playera Roja')],
            variantsByProduct: {
              'p-1': [_variant(id: 'v-1', productId: 'p-1', sku: 'PLA-ROJ-S', tracksInventory: true)],
            },
          );
          tester.view.physicalSize = size;
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.reset);
          await tester.pumpWidget(
            MaterialApp(
              home: Scaffold(
                body: SingleChildScrollView(
                  child: PosProductVariantsScreen(context: _context(_readWrite), gateway: gateway),
                ),
              ),
            ),
          );
          await tester.pumpAndSettle();
          await tester.tap(find.byKey(const Key('pos-product-variants-product-p-1')));
          await tester.pumpAndSettle();
          await tester.tap(find.byKey(const Key('pos-product-variants-edit-v-1')));
          await tester.pumpAndSettle();

          expect(find.byKey(const Key('pos-product-variants-form-tracks-inventory')), findsOneWidget);
          expect(tester.takeException(), isNull);
        },
      );
    }
  });

  group('TASK 17.1.3 — is_sellable control (orthogonal to tracks_inventory)', () {
    testWidgets('Nueva variante defaults the sellable toggle to ON', (tester) async {
      final gateway = _RecordingProductVariantsGateway(
        products: [_product(id: 'p-1', name: 'Playera Roja')],
        variantsByProduct: {'p-1': const []},
      );
      await _pump(tester, gateway: gateway, permissions: _readWrite);
      await tester.tap(find.byKey(const Key('pos-product-variants-product-p-1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-product-variants-new')));
      await tester.pumpAndSettle();

      expect(find.text('Disponible para venta'), findsOneWidget);
      final checkbox = tester.widget<CheckboxListTile>(
        find.byKey(const Key('pos-product-variants-form-sellable')),
      );
      expect(checkbox.value, isTrue);
      expect(
        find.text('Permite vender esta variante directamente en Punto de Venta.'),
        findsOneWidget,
      );
    });

    testWidgets('create with the sellable toggle ON sends is_sellable=true', (tester) async {
      final gateway = _RecordingProductVariantsGateway(
        products: [_product(id: 'p-1', name: 'Playera Roja')],
        variantsByProduct: {'p-1': const []},
      );
      await _pump(tester, gateway: gateway, permissions: _readWrite);
      await tester.tap(find.byKey(const Key('pos-product-variants-product-p-1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-product-variants-new')));
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('pos-product-variants-form-sku')), 'AGUA-1');
      await tester.enterText(find.byKey(const Key('pos-product-variants-form-unit')), 'unit');
      await tester.ensureVisible(find.byKey(const Key('pos-product-variants-form-save')));
      await tester.tap(find.byKey(const Key('pos-product-variants-form-save')));
      await tester.pumpAndSettle();

      expect(gateway.createCalls, hasLength(1));
      expect(gateway.createCalls.single.input.isSellable, isTrue);
      // Orthogonality: the create call's tracksInventory is untouched by
      // this group's own toggling (still whatever the tracks-inventory
      // toggle's own default is).
      expect(gateway.createCalls.single.input.tracksInventory, isTrue);
    });

    testWidgets('create with the sellable toggle OFF sends is_sellable=false — the "Masa Pizza" scenario', (
      tester,
    ) async {
      final gateway = _RecordingProductVariantsGateway(
        products: [_product(id: 'p-1', name: 'Masa Pizza PRUEBA')],
        variantsByProduct: {'p-1': const []},
      );
      await _pump(tester, gateway: gateway, permissions: _readWrite);
      await tester.tap(find.byKey(const Key('pos-product-variants-product-p-1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-product-variants-new')));
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('pos-product-variants-form-sku')), 'MASA-1');
      await tester.enterText(find.byKey(const Key('pos-product-variants-form-unit')), 'unit');
      await tester.tap(find.byKey(const Key('pos-product-variants-form-sellable')));
      await tester.pumpAndSettle();
      expect(
        find.textContaining('No aparecerá en Punto de Venta'),
        findsOneWidget,
      );
      await tester.ensureVisible(find.byKey(const Key('pos-product-variants-form-save')));
      await tester.tap(find.byKey(const Key('pos-product-variants-form-save')));
      await tester.pumpAndSettle();

      expect(gateway.createCalls, hasLength(1));
      expect(gateway.createCalls.single.input.isSellable, isFalse);
      // Turning sellability OFF never touches tracks_inventory — the
      // ingredient still tracks its own stock directly.
      expect(gateway.createCalls.single.input.tracksInventory, isTrue);
    });

    testWidgets('Editar variante whose backend value is sellable=true shows the toggle ON', (tester) async {
      final gateway = _RecordingProductVariantsGateway(
        products: [_product(id: 'p-1', name: 'Agua')],
        variantsByProduct: {
          'p-1': [_variant(id: 'v-1', productId: 'p-1', sku: 'AGUA-1', isSellable: true)],
        },
      );
      await _pump(tester, gateway: gateway, permissions: _readWrite);
      await tester.tap(find.byKey(const Key('pos-product-variants-product-p-1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-product-variants-edit-v-1')));
      await tester.pumpAndSettle();

      final checkbox = tester.widget<CheckboxListTile>(
        find.byKey(const Key('pos-product-variants-form-sellable')),
      );
      expect(checkbox.value, isTrue);
    });

    testWidgets('Editar variante whose backend value is sellable=false shows the toggle OFF', (tester) async {
      final gateway = _RecordingProductVariantsGateway(
        products: [_product(id: 'p-1', name: 'Masa Pizza PRUEBA')],
        variantsByProduct: {
          'p-1': [_variant(id: 'v-1', productId: 'p-1', sku: 'MASA-1', isSellable: false)],
        },
      );
      await _pump(tester, gateway: gateway, permissions: _readWrite);
      await tester.tap(find.byKey(const Key('pos-product-variants-product-p-1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-product-variants-edit-v-1')));
      await tester.pumpAndSettle();

      final checkbox = tester.widget<CheckboxListTile>(
        find.byKey(const Key('pos-product-variants-form-sellable')),
      );
      expect(checkbox.value, isFalse);
    });

    testWidgets('edit ON → OFF sends is_sellable=false without touching tracks_inventory', (tester) async {
      final gateway = _RecordingProductVariantsGateway(
        products: [_product(id: 'p-1', name: 'Masa Pizza PRUEBA')],
        variantsByProduct: {
          'p-1': [
            _variant(
              id: 'v-1',
              productId: 'p-1',
              sku: 'MASA-1',
              tracksInventory: true,
              isSellable: true,
              version: 1,
            ),
          ],
        },
      );
      await _pump(tester, gateway: gateway, permissions: _readWrite);
      await tester.tap(find.byKey(const Key('pos-product-variants-product-p-1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-product-variants-edit-v-1')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-product-variants-form-sellable')));
      await tester.ensureVisible(find.byKey(const Key('pos-product-variants-form-save')));
      await tester.tap(find.byKey(const Key('pos-product-variants-form-save')));
      await tester.pumpAndSettle();

      expect(gateway.updateCalls, hasLength(1));
      expect(gateway.updateCalls.single.input.isSellable, isFalse);
      // TASK 17.1.3's own explicit requirement: toggling sellability never
      // changes tracks_inventory — the form resends its own unchanged
      // current value (`true`, from the fixture above), the same "always
      // resend every field's current state" behavior every other toggle
      // in this form already has (see the tracks_inventory tests above).
      expect(gateway.updateCalls.single.input.tracksInventory, isTrue);
    });

    testWidgets('edit OFF → ON sends is_sellable=true without touching tracks_inventory', (tester) async {
      final gateway = _RecordingProductVariantsGateway(
        products: [_product(id: 'p-1', name: 'Masa Pizza PRUEBA')],
        variantsByProduct: {
          'p-1': [
            _variant(
              id: 'v-1',
              productId: 'p-1',
              sku: 'MASA-1',
              tracksInventory: true,
              isSellable: false,
              version: 1,
            ),
          ],
        },
      );
      await _pump(tester, gateway: gateway, permissions: _readWrite);
      await tester.tap(find.byKey(const Key('pos-product-variants-product-p-1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-product-variants-edit-v-1')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-product-variants-form-sellable')));
      await tester.ensureVisible(find.byKey(const Key('pos-product-variants-form-save')));
      await tester.tap(find.byKey(const Key('pos-product-variants-form-save')));
      await tester.pumpAndSettle();

      expect(gateway.updateCalls, hasLength(1));
      expect(gateway.updateCalls.single.input.isSellable, isTrue);
      // Same "always resend the current value" behavior — unchanged from
      // the fixture's own `true`.
      expect(gateway.updateCalls.single.input.tracksInventory, isTrue);
    });

    testWidgets('the tracks-inventory checkbox remains independently toggleable and does not react to the sellable checkbox', (
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

      // Both default ON.
      expect(
        tester.widget<CheckboxListTile>(find.byKey(const Key('pos-product-variants-form-tracks-inventory'))).value,
        isTrue,
      );
      expect(
        tester.widget<CheckboxListTile>(find.byKey(const Key('pos-product-variants-form-sellable'))).value,
        isTrue,
      );

      // Turning sellability OFF leaves tracks-inventory rendered ON.
      await tester.tap(find.byKey(const Key('pos-product-variants-form-sellable')));
      await tester.pumpAndSettle();
      expect(
        tester.widget<CheckboxListTile>(find.byKey(const Key('pos-product-variants-form-tracks-inventory'))).value,
        isTrue,
      );

      // Turning tracks-inventory OFF leaves sellability rendered OFF (as
      // this test left it above) — neither checkbox ever reacts to the
      // other.
      await tester.tap(find.byKey(const Key('pos-product-variants-form-tracks-inventory')));
      await tester.pumpAndSettle();
      expect(
        tester.widget<CheckboxListTile>(find.byKey(const Key('pos-product-variants-form-sellable'))).value,
        isFalse,
      );
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
  bool isSellable = true,
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
  isSellable: isSellable,
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
    this.updateVariantError,
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

  /// TASK 16.32.7 — when set, `updateVariant` throws this instead of
  /// succeeding, letting a test inject a real backend rejection (e.g. the
  /// recipe-invariant's own `variant_active_recipe_conflict`) without a
  /// second, divergent fake-gateway shape.
  final ApiException? updateVariantError;

  /// TASK 16.32.7 — proves the variant form never touches the recipe
  /// endpoints under any circumstance (Phase I: "no automatic recipe
  /// deletion/mutation occurs") — tracked as call counts rather than
  /// always throwing, so a genuine accidental call surfaces as a clear
  /// assertion failure instead of an opaque `StateError`.
  int getRecipeCallCount = 0;
  int replaceRecipeCallCount = 0;
  int deleteRecipeCallCount = 0;
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
      isSellable: input.isSellable ?? true,
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
    if (updateVariantError != null) throw updateVariantError!;
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
        isSellable: input.isSellable ?? current.isSellable,
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

  @override
  Future<PosProductRecipe?> getRecipe(String variantId) async {
    getRecipeCallCount++;
    return Future.error(StateError('not used in this fixture'));
  }

  @override
  Future<PosProductRecipe> replaceRecipe(
    String variantId, {
    bool? isActive,
    required List<PosProductRecipeComponentInput> components,
  }) async {
    replaceRecipeCallCount++;
    return Future.error(StateError('not used in this fixture'));
  }

  @override
  Future<void> deleteRecipe(String variantId, int expectedVersion) async {
    deleteRecipeCallCount++;
    return Future.error(StateError('not used in this fixture'));
  }

  @override
  Future<List<PosProductRecipeUsage>> usedIn(String variantId) async => const [];
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
