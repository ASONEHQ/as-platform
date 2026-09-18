/// TASK 14.3 (Wave 4) — widget tests for the new "Órdenes" tab inside the
/// "Compras" screen (`PosModule.purchases` -> `_DirectPurchases` in
/// `pos_shell.dart`), plus the new "Reversar" action added to the Compra
/// Directa "Historial" tab. Mirrors `pos_shell_wave1_partbc_test.dart`'s
/// own `_pump`/`_Recording*Gateway`/`_context` fixture conventions exactly
/// — a real, in-memory recording fake gateway, never a mock framework.
///
/// Covers: the honest empty state for a brand-new tenant; creating a
/// purchase order with 2 lines and the exact payload that reaches the
/// gateway; the Enviar/Recibir/Cancelar action buttons appearing only for
/// the right status + permission combination (never merely hidden when
/// the permission is missing — visible-but-disabled with a `Tooltip`,
/// mirroring `pos_suppliers_test.dart`'s own established convention);
/// receiving with a reduced quantity on one line (a genuine partial
/// receipt); the Compra Directa "Reversar" button staying visible-but-
/// disabled (never hidden) without `inventory.reverse`, and swapping for a
/// "Reversada" badge once the row's own movement is already `reversed`;
/// and `displayPurchaseOrderNumber` unit tests mirroring
/// `sale_folio_test.dart`'s own test style.
library;

import 'package:as_one/features/authentication/auth_models.dart';
import 'package:as_one/features/pos/pos_cash_gateway.dart';
import 'package:as_one/features/pos/pos_customers_gateway.dart';
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
import 'package:as_one/features/pos/pos_refunds_gateway.dart';
import 'package:as_one/features/pos/pos_rewards_gateway.dart';
import 'package:as_one/features/pos/pos_sales_gateway.dart';
import 'package:as_one/features/pos/pos_shell.dart';
import 'package:as_one/features/pos/purchase_order_folio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('TASK 14.3 Wave 4 — Órdenes: empty state', () {
    testWidgets('renders the honest empty state for a brand-new tenant, never a fabricated row', (tester) async {
      final gateway = _RecordingPurchaseOrdersGateway();
      await _pump(tester, purchaseOrdersGateway: gateway);
      await _navigateToPurchases(tester);

      expect(find.textContaining('Aún no hay órdenes de compra'), findsOneWidget);
      // "Nueva orden" stays prominent right alongside the empty state.
      expect(find.byKey(const Key('pos-po-new')), findsOneWidget);
    });
  });

  group('TASK 16.10A — Órdenes: human-readable line items', () {
    testWidgets('the detail view shows the product name (and SKU as secondary text), never the raw variant id', (
      tester,
    ) async {
      final order = _fixtureOrder(id: 'po-name-1', status: 'draft');
      final gateway = _RecordingPurchaseOrdersGateway(seed: [order]);
      await _pump(tester, purchaseOrdersGateway: gateway);
      await _navigateToPurchases(tester);

      await tester.tap(find.text(displayPurchaseOrderNumber(order.orderNumber)));
      await tester.pumpAndSettle();

      expect(find.text('Agua'), findsOneWidget);
      expect(find.textContaining('SKU: TDA-AGUA'), findsOneWidget);
      expect(find.textContaining('variant-1'), findsNothing);
    });

    testWidgets('the receiving dialog shows the product name (and SKU), never the raw variant id', (tester) async {
      final order = _fixtureOrder(id: 'po-name-2', status: 'submitted');
      final gateway = _RecordingPurchaseOrdersGateway(seed: [order]);
      await _pump(tester, purchaseOrdersGateway: gateway);
      await _navigateToPurchases(tester);

      await tester.tap(find.text(displayPurchaseOrderNumber(order.orderNumber)));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-po-receive-order')));
      await tester.pumpAndSettle();

      // The detail view stays mounted behind the receive dialog, so "Agua"
      // legitimately renders twice (once in each) — the point of this test
      // is that it renders at all and the raw id never does.
      expect(find.text('Agua'), findsWidgets);
      expect(find.textContaining('SKU: TDA-AGUA'), findsWidgets);
      expect(find.textContaining('variant-1'), findsNothing);
    });

    testWidgets('a reload (fresh fetch from the gateway) preserves the readable identity, never falling back to '
        'the raw id', (tester) async {
      final order = _fixtureOrder(id: 'po-name-3', status: 'draft');
      final gateway = _RecordingPurchaseOrdersGateway(seed: [order]);
      await _pump(tester, purchaseOrdersGateway: gateway);
      await _navigateToPurchases(tester);
      // Reloading the list re-fetches from the gateway rather than reusing
      // any client-cached state — the same round trip a real page reload
      // would take.
      await tester.tap(find.byKey(const Key('pos-po-refresh')));
      await tester.pumpAndSettle();

      await tester.tap(find.text(displayPurchaseOrderNumber(order.orderNumber)));
      await tester.pumpAndSettle();

      expect(find.text('Agua'), findsOneWidget);
      expect(find.textContaining('variant-1'), findsNothing);
    });
  });

  group('PosPurchaseOrderLine.displayName / fromJson — real wire shapes', () {
    test('shows just the product name when the variant has no distinct label', () {
      const line = PosPurchaseOrderLine(
        id: 'line-1',
        lineNumber: 1,
        productVariantId: 'variant-1',
        productName: 'Agua',
        variantName: null,
        sku: 'TDA-AGUA',
        orderedQuantity: '10',
        receivedQuantity: '0',
        unitCost: '12.50',
        lineTotal: '125.00',
      );
      expect(line.displayName, 'Agua');
    });

    test('combines product and variant name when the variant has its own distinct label', () {
      const line = PosPurchaseOrderLine(
        id: 'line-1',
        lineNumber: 1,
        productVariantId: 'variant-1',
        productName: 'Playera',
        variantName: 'Talla M',
        sku: 'PLY-M',
        orderedQuantity: '10',
        receivedQuantity: '0',
        unitCost: '80.00',
        lineTotal: '800.00',
      );
      expect(line.displayName, 'Playera — Talla M');
    });

    test('fromJson parses product_name/variant_name/sku from a real detail-response line shape', () {
      final line = PosPurchaseOrderLine.fromJson(<String, Object?>{
        'id': 'line-1',
        'line_number': 1,
        'product_variant_id': 'f3160803-e8fa-4571-92ef-159662cb4578',
        'product_name': 'Agua',
        'variant_name': null,
        'sku': 'TDA-AGUA',
        'ordered_quantity': '10.000000',
        'received_quantity': '0.000000',
        'unit_cost': '12.5000',
        'line_total': '125.0000',
        'notes': null,
      });
      expect(line.productName, 'Agua');
      expect(line.sku, 'TDA-AGUA');
      expect(line.displayName, 'Agua');
    });

    test('degrades to the raw variant id — never throws — for a shape older than TASK 16.10A missing product_name', () {
      final line = PosPurchaseOrderLine.fromJson(<String, Object?>{
        'id': 'line-1',
        'line_number': 1,
        'product_variant_id': 'f3160803-e8fa-4571-92ef-159662cb4578',
        'ordered_quantity': '10.000000',
        'received_quantity': '0.000000',
        'unit_cost': '12.5000',
        'line_total': '125.0000',
        'notes': null,
      });
      expect(line.productName, 'f3160803-e8fa-4571-92ef-159662cb4578');
    });
  });

  group('TASK 14.3 Wave 4 — Órdenes: create', () {
    testWidgets('creating a purchase order with 2 lines calls the gateway with the exact payload and shows it '
        'in the list afterward', (tester) async {
      final gateway = _RecordingPurchaseOrdersGateway();
      await _pump(tester, purchaseOrdersGateway: gateway);
      await _navigateToPurchases(tester);

      await tester.tap(find.byKey(const Key('pos-po-new')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-po-line-product-0')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Producto Uno (SKU-1)').last);
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('pos-po-line-quantity-0')), '5');
      await tester.enterText(find.byKey(const Key('pos-po-line-unit-cost-0')), '10.00');

      await tester.ensureVisible(find.byKey(const Key('pos-po-add-line')));
      await tester.tap(find.byKey(const Key('pos-po-add-line')));
      await tester.pumpAndSettle();

      await tester.ensureVisible(find.byKey(const Key('pos-po-line-product-1')));
      await tester.tap(find.byKey(const Key('pos-po-line-product-1')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Producto Dos (SKU-2)').last);
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(const Key('pos-po-line-quantity-1')));
      await tester.enterText(find.byKey(const Key('pos-po-line-quantity-1')), '3');
      await tester.enterText(find.byKey(const Key('pos-po-line-unit-cost-1')), '7.50');

      await tester.ensureVisible(find.byKey(const Key('pos-po-supplier')));
      await tester.enterText(find.byKey(const Key('pos-po-supplier')), 'Proveedor de Prueba');

      // 5 × $10.00 + 3 × $7.50 = $72.50 exactly — the real fixed-point
      // utility, never raw `double` arithmetic.
      expect(find.text('Total: \$72.50'), findsOneWidget);

      await tester.ensureVisible(find.byKey(const Key('pos-po-submit')));
      await tester.tap(find.byKey(const Key('pos-po-submit')));
      await tester.pump();
      await tester.pumpAndSettle();

      expect(gateway.createCalls, hasLength(1));
      final call = gateway.createCalls.single;
      expect(call.branchId, 'branch-id');
      expect(call.currencyCode, 'MXN');
      expect(call.supplierName, 'Proveedor de Prueba');
      expect(call.lines, hasLength(2));
      expect(call.lines[0].productVariantId, 'variant-1');
      expect(call.lines[0].orderedQuantity, '5');
      expect(call.lines[0].unitCost, '10.0000');
      expect(call.lines[1].productVariantId, 'variant-2');
      expect(call.lines[1].orderedQuantity, '3');
      expect(call.lines[1].unitCost, '7.5000');

      expect(gateway.items, hasLength(1));
      // `DataRow.key` is a plain config field (`DataRow` is not itself a
      // Widget) — never discoverable via `find.byKey` — so row presence is
      // asserted by its own real, rendered folio text instead.
      expect(find.text(displayPurchaseOrderNumber(gateway.items.single.orderNumber)), findsOneWidget);
    });

    testWidgets('submitting with no lines at all is rejected client-side — no gateway call', (tester) async {
      final gateway = _RecordingPurchaseOrdersGateway();
      await _pump(tester, purchaseOrdersGateway: gateway);
      await _navigateToPurchases(tester);

      await tester.tap(find.byKey(const Key('pos-po-new')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-po-submit')));
      await tester.pump();

      expect(find.byKey(const Key('pos-po-form-error')), findsOneWidget);
      expect(gateway.createCalls, isEmpty);
    });
  });

  group('TASK 14.3 Wave 4 — Órdenes: detail actions per status + permission', () {
    testWidgets('a draft order shows Enviar + Cancelar, never Recibir', (tester) async {
      final order = _fixtureOrder(id: 'po-1', status: 'draft');
      final gateway = _RecordingPurchaseOrdersGateway(seed: [order]);
      await _pump(tester, purchaseOrdersGateway: gateway);
      await _navigateToPurchases(tester);

      await tester.tap(find.text(displayPurchaseOrderNumber(order.orderNumber)));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('pos-po-submit-order')), findsOneWidget);
      expect(find.byKey(const Key('pos-po-cancel-order')), findsOneWidget);
      expect(find.byKey(const Key('pos-po-receive-order')), findsNothing);
    });

    testWidgets('a submitted order shows Recibir + Cancelar, never Enviar', (tester) async {
      final order = _fixtureOrder(id: 'po-2', status: 'submitted');
      final gateway = _RecordingPurchaseOrdersGateway(seed: [order]);
      await _pump(tester, purchaseOrdersGateway: gateway);
      await _navigateToPurchases(tester);

      await tester.tap(find.text(displayPurchaseOrderNumber(order.orderNumber)));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('pos-po-receive-order')), findsOneWidget);
      expect(find.byKey(const Key('pos-po-cancel-order')), findsOneWidget);
      expect(find.byKey(const Key('pos-po-submit-order')), findsNothing);
    });

    testWidgets('a partially_received order shows only Cancelar — receiving is a single event by design', (
      tester,
    ) async {
      final order = _fixtureOrder(id: 'po-3', status: 'partially_received');
      final gateway = _RecordingPurchaseOrdersGateway(seed: [order]);
      await _pump(tester, purchaseOrdersGateway: gateway);
      await _navigateToPurchases(tester);

      await tester.tap(find.text(displayPurchaseOrderNumber(order.orderNumber)));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('pos-po-cancel-order')), findsOneWidget);
      expect(find.byKey(const Key('pos-po-receive-order')), findsNothing);
      expect(find.byKey(const Key('pos-po-submit-order')), findsNothing);
    });

    testWidgets('a received order shows no action button at all', (tester) async {
      final order = _fixtureOrder(id: 'po-4', status: 'received');
      final gateway = _RecordingPurchaseOrdersGateway(seed: [order]);
      await _pump(tester, purchaseOrdersGateway: gateway);
      await _navigateToPurchases(tester);

      await tester.tap(find.text(displayPurchaseOrderNumber(order.orderNumber)));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('pos-po-cancel-order')), findsNothing);
      expect(find.byKey(const Key('pos-po-receive-order')), findsNothing);
      expect(find.byKey(const Key('pos-po-submit-order')), findsNothing);
    });

    testWidgets(
      'without purchase.receive, Recibir on a submitted order stays visible but disabled with an '
      'explanatory Tooltip, never simply hidden',
      (tester) async {
        final order = _fixtureOrder(id: 'po-5', status: 'submitted');
        final gateway = _RecordingPurchaseOrdersGateway(seed: [order]);
        await _pump(
          tester,
          purchaseOrdersGateway: gateway,
          permissions: const ['purchase.create', 'purchase.read'],
        );
        await _navigateToPurchases(tester);

        await tester.tap(find.text(displayPurchaseOrderNumber(order.orderNumber)));
        await tester.pumpAndSettle();

        final receiveButton = tester.widget<FilledButton>(find.byKey(const Key('pos-po-receive-order')));
        expect(receiveButton.onPressed, isNull);
        final tooltip = tester.widget<Tooltip>(
          find.ancestor(of: find.byKey(const Key('pos-po-receive-order')), matching: find.byType(Tooltip)),
        );
        expect(tooltip.message, contains('purchase.receive'));
      },
    );

    testWidgets('Cancelar requires an explicit confirmation before calling the gateway', (tester) async {
      final order = _fixtureOrder(id: 'po-6', status: 'draft');
      final gateway = _RecordingPurchaseOrdersGateway(seed: [order]);
      await _pump(tester, purchaseOrdersGateway: gateway);
      await _navigateToPurchases(tester);

      await tester.tap(find.text(displayPurchaseOrderNumber(order.orderNumber)));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-po-cancel-order')));
      await tester.pumpAndSettle();

      expect(gateway.cancelCalls, isEmpty);
      expect(find.byKey(const Key('pos-po-cancel-confirm')), findsOneWidget);

      await tester.tap(find.byKey(const Key('pos-po-cancel-confirm')));
      await tester.pumpAndSettle();

      expect(gateway.cancelCalls, ['po-6']);
    });
  });

  group('TASK 14.3 Wave 4 — Órdenes: receiving with a partial quantity', () {
    testWidgets(
      'the receive form defaults every line to its ordered quantity, and allows editing below it for a '
      'genuine partial receipt',
      (tester) async {
        final order = _fixtureOrder(id: 'po-7', status: 'submitted', orderedQuantity: '10');
        final gateway = _RecordingPurchaseOrdersGateway(seed: [order]);
        await _pump(tester, purchaseOrdersGateway: gateway);
        await _navigateToPurchases(tester);

        await tester.tap(find.text(displayPurchaseOrderNumber(order.orderNumber)));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pos-po-receive-order')));
        await tester.pumpAndSettle();

        final lineKey = Key('pos-po-receive-line-${order.lines!.single.id}');
        final field = tester.widget<TextField>(find.byKey(lineKey));
        expect(field.controller!.text, '10');

        await tester.enterText(find.byKey(lineKey), '6');
        await tester.tap(find.byKey(const Key('pos-po-receive-submit')));
        await tester.pump();
        await tester.pumpAndSettle();

        expect(gateway.receiveCalls, hasLength(1));
        final call = gateway.receiveCalls.single;
        expect(call.id, 'po-7');
        expect(call.lines.single.purchaseOrderLineId, order.lines!.single.id);
        expect(call.lines.single.receivedQuantity, '6');
      },
    );
  });

  group('TASK 14.3 Wave 4 — Historial: Compra Directa reversal', () {
    testWidgets(
      'with inventory.reverse granted, Reversar prompts for a required reason and calls the real endpoint',
      (tester) async {
        final purchasingGateway = _RecordingReversalPurchasingGateway(
          seed: [_fixtureDirectPurchase(id: 'dp-1')],
        );
        await _pump(
          tester,
          purchasingGateway: purchasingGateway,
          permissions: const ['purchase.create', 'purchase.read', 'inventory.reverse'],
        );
        await _navigateToPurchases(tester);
        await _switchTab(tester, 'Historial');

        // The Acciones column sits past the horizontally-scrollable
        // table's initial viewport — mirrors
        // `pos_shell_wave1_partbc_test.dart`'s own established
        // `ensureVisible` care before tapping a similarly-placed action
        // button.
        await tester.ensureVisible(find.byKey(const Key('pos-direct-purchase-reverse-dp-1')));
        await tester.tap(find.byKey(const Key('pos-direct-purchase-reverse-dp-1')));
        await tester.pumpAndSettle();

        // A blank reason is rejected client-side — no gateway call yet.
        await tester.tap(find.byKey(const Key('pos-direct-purchase-reverse-confirm')));
        await tester.pump();
        expect(purchasingGateway.reverseCalls, isEmpty);
        expect(find.text('El motivo es obligatorio.'), findsOneWidget);

        await tester.enterText(find.byKey(const Key('pos-direct-purchase-reverse-reason')), 'Producto dañado');
        await tester.tap(find.byKey(const Key('pos-direct-purchase-reverse-confirm')));
        await tester.pumpAndSettle();

        expect(purchasingGateway.reverseCalls, hasLength(1));
        expect(purchasingGateway.reverseCalls.single.id, 'dp-1');
        expect(purchasingGateway.reverseCalls.single.reason, 'Producto dañado');
      },
    );

    testWidgets(
      'without inventory.reverse, Reversar stays visible but disabled with an explanatory Tooltip, '
      'never simply hidden — mirrors this app\'s established permission-gating convention',
      (tester) async {
        final purchasingGateway = _RecordingReversalPurchasingGateway(seed: [_fixtureDirectPurchase(id: 'dp-1')]);
        await _pump(
          tester,
          purchasingGateway: purchasingGateway,
          permissions: const ['purchase.create', 'purchase.read'],
        );
        await _navigateToPurchases(tester);
        await _switchTab(tester, 'Historial');

        final reverseButton = tester.widget<OutlinedButton>(
          find.byKey(const Key('pos-direct-purchase-reverse-dp-1')),
        );
        expect(reverseButton.onPressed, isNull);
        await tester.ensureVisible(find.byKey(const Key('pos-direct-purchase-reverse-dp-1')));
        final tooltip = tester.widget<Tooltip>(
          find.ancestor(
            of: find.byKey(const Key('pos-direct-purchase-reverse-dp-1')),
            matching: find.byType(Tooltip),
          ),
        );
        expect(tooltip.message, contains('inventory.reverse'));
        expect(purchasingGateway.reverseCalls, isEmpty);
      },
    );

    testWidgets('an already-reversed purchase shows a "Reversada" badge instead of the button', (tester) async {
      final purchasingGateway = _RecordingReversalPurchasingGateway(
        seed: [_fixtureDirectPurchase(id: 'dp-1', movementStatus: 'reversed')],
      );
      await _pump(
        tester,
        purchasingGateway: purchasingGateway,
        permissions: const ['purchase.create', 'purchase.read', 'inventory.reverse'],
      );
      await _navigateToPurchases(tester);
      await _switchTab(tester, 'Historial');

      expect(find.byKey(const Key('pos-direct-purchase-reversed-dp-1')), findsOneWidget);
      expect(find.text('Reversada'), findsOneWidget);
      expect(find.byKey(const Key('pos-direct-purchase-reverse-dp-1')), findsNothing);
    });
  });

  group('TASK 14.3 Wave 4 — displayPurchaseOrderNumber', () {
    test('derives a compact PO-XXXXXXXX folio from a real canonical order number', () {
      expect(displayPurchaseOrderNumber('PO-2517abd73ecf44a2b2206f4eadfeee49'), 'PO-ADFEEE49');
    });

    test('is deterministic — the same input always produces the same output', () {
      const orderNumber = 'PO-2517abd73ecf44a2b2206f4eadfeee49';
      final first = displayPurchaseOrderNumber(orderNumber);
      final second = displayPurchaseOrderNumber(orderNumber);
      final third = displayPurchaseOrderNumber(orderNumber);
      expect(first, second);
      expect(second, third);
    });

    test('is always shorter than the canonical 35-character order number', () {
      const orderNumber = 'PO-2517abd73ecf44a2b2206f4eadfeee49';
      expect(displayPurchaseOrderNumber(orderNumber).length, lessThan(orderNumber.length));
      expect(displayPurchaseOrderNumber(orderNumber).length, 11); // 'PO-' + 8 hex chars.
    });

    test(
      'two different orders that differ only outside the trailing 8 hex characters collide by design — '
      'the doc comment states this is not guaranteed unique',
      () {
        final a = displayPurchaseOrderNumber('PO-00000000000000000000000012345678');
        final b = displayPurchaseOrderNumber('PO-ffffffffffffffffffffffff12345678');
        expect(a, b);
        expect(a, 'PO-12345678');
      },
    );

    test('degrades gracefully for a shape shorter than the canonical format, never throws', () {
      expect(displayPurchaseOrderNumber('PO-abc'), 'PO-ABC');
      expect(displayPurchaseOrderNumber(''), 'PO-');
    });

    test('always keeps the PO- prefix even for an unprefixed input', () {
      expect(displayPurchaseOrderNumber('2517abd73ecf44a2b2206f4eadfeee49'), 'PO-ADFEEE49');
    });
  });

  // Regression coverage for a real bug caught only by live verification
  // against the actual backend (never by the widget tests above, which all
  // construct `PosPurchaseOrder` directly in Dart and so never exercise
  // `fromJson`/the real JSON wire shape): `purchase_orders.version` is a
  // Postgres `bigint`, which this codebase's API layer always serializes as
  // a JSON *string* (to avoid JS/Dart int precision loss), never a number —
  // `fromJson` originally did `(json['version'] as num?)?.toInt()`, which
  // throws a `TypeError` on the real `"1"` string the backend actually
  // sends, silently surfacing as a generic "No fue posible..." failure
  // despite the server having already created the resource successfully.
  // Also covers the real, deliberately light `GET /purchase-orders` list-row
  // shape, which omits `created_by`/`updated_at`/`version` entirely (see
  // `purchase-orders.service.ts`'s list projection) — `fromJson` originally
  // read `created_by`/`updated_at` with the `!` null-assertion operator,
  // which throws on a genuinely absent key.
  group('PosPurchaseOrder.fromJson — real wire shapes', () {
    test('parses a full detail response, including a string-encoded bigint version', () {
      final order = PosPurchaseOrder.fromJson(<String, Object?>{
        'id': 'e3c81c1d-e35f-4d2a-a988-a7aff8cc6467',
        'order_number': 'PO-e3c81c1de35f4d2aa988a7aff8cc6467',
        'branch_id': '01a06910-4c2e-76ad-b14c-aeadc8b85392',
        'status': 'draft',
        'supplier_name': 'Distribuidora QA',
        'supplier_id': null,
        'order_date': '2026-09-17',
        'expected_date': null,
        'currency_code': 'MXN',
        'total_cost': '125.0000',
        'notes': null,
        'submitted_at': null,
        'submitted_by': null,
        'received_at': null,
        'received_by': null,
        'cancelled_at': null,
        'cancelled_by': null,
        'receipt_movement_id': null,
        'version': '1',
        'created_by': '01a06910-4c35-72a2-aa21-d5c849cf598f',
        'created_at': '2026-09-18T02:31:12.118Z',
        'updated_at': '2026-09-18T02:31:12.118Z',
        'lines': <Object?>[],
      });
      expect(order.version, 1);
      expect(order.createdBy, '01a06910-4c35-72a2-aa21-d5c849cf598f');
      expect(order.updatedAt, isNotNull);
    });

    test('parses a light list row missing created_by/updated_at/version', () {
      final order = PosPurchaseOrder.fromJson(<String, Object?>{
        'id': 'e3c81c1d-e35f-4d2a-a988-a7aff8cc6467',
        'order_number': 'PO-e3c81c1de35f4d2aa988a7aff8cc6467',
        'branch_id': '01a06910-4c2e-76ad-b14c-aeadc8b85392',
        'status': 'draft',
        'supplier_name': 'Distribuidora QA',
        'supplier_id': null,
        'order_date': '2026-09-17',
        'expected_date': null,
        'currency_code': 'MXN',
        'total_cost': '125.0000',
        'line_count': 1,
        'created_at': '2026-09-18T02:31:12.118Z',
      });
      expect(order.version, isNull);
      expect(order.createdBy, isNull);
      expect(order.updatedAt, isNull);
      expect(order.totalCost, '125.0000');
    });
  });
}

// --- Fixtures -------------------------------------------------------------

const _defaultPermissions = ['purchase.create', 'purchase.read', 'purchase.receive'];

PosPricing _price(String amount) => PosPricing.fromJson({'amount': amount, 'currency_code': 'MXN'});

final _productOne = PosProduct(
  id: 'product-1',
  code: 'P1',
  name: 'Producto Uno',
  type: 'simple',
  status: 'active',
  tracksInventory: false,
  defaultVariantId: 'variant-1',
  sku: 'SKU-1',
  taxCode: 'IVA_GENERAL',
  pricing: _price('10.0000'),
);

final _productTwo = PosProduct(
  id: 'product-2',
  code: 'P2',
  name: 'Producto Dos',
  type: 'simple',
  status: 'active',
  tracksInventory: false,
  defaultVariantId: 'variant-2',
  sku: 'SKU-2',
  taxCode: 'IVA_GENERAL',
  pricing: _price('7.5000'),
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
  permissions: _defaultPermissions,
);

AuthenticatedContext _contextWith(List<String> permissions) => AuthenticatedContext(
  session: _context.session,
  user: _context.user,
  companies: _context.companies,
  branches: _context.branches,
  companyWideAccess: false,
  permissions: permissions,
);

PosPurchaseOrder _fixtureOrder({
  required String id,
  required String status,
  String orderedQuantity = '5',
  String receivedQuantity = '0',
}) => PosPurchaseOrder(
  id: id,
  orderNumber: 'PO-${id.padLeft(32, '0')}',
  branchId: 'branch-id',
  status: status,
  supplierName: 'Proveedor de Prueba',
  supplierId: null,
  orderDate: '2026-09-01',
  expectedDate: null,
  currencyCode: 'MXN',
  totalCost: '50.0000',
  notes: null,
  createdBy: 'user-id',
  createdAt: DateTime.utc(2026, 9, 1),
  updatedAt: DateTime.utc(2026, 9, 1),
  lines: [
    PosPurchaseOrderLine(
      id: '$id-line-1',
      lineNumber: 1,
      productVariantId: 'variant-1',
      productName: 'Agua',
      variantName: null,
      sku: 'TDA-AGUA',
      orderedQuantity: orderedQuantity,
      receivedQuantity: receivedQuantity,
      unitCost: '10.0000',
      lineTotal: '50.0000',
      notes: null,
    ),
  ],
);

PosDirectPurchase _fixtureDirectPurchase({required String id, String movementStatus = 'posted'}) =>
    PosDirectPurchase(
      id: id,
      branchId: 'branch-id',
      supplierName: 'Proveedor de Prueba',
      supplierId: null,
      productVariantId: 'variant-1',
      quantity: '5',
      unitCost: '10.0000',
      currencyCode: 'MXN',
      totalCost: '50.0000',
      purchaseDate: '2026-09-01',
      notes: null,
      inventoryMovementId: 'movement-$id',
      createdBy: 'user-id',
      createdAt: DateTime.utc(2026, 9, 1),
      movement: PosDirectPurchaseMovement(
        movementId: 'movement-$id',
        movementNumber: 'MOV-$id',
        status: movementStatus,
        postedAt: DateTime.utc(2026, 9, 1),
        currentQuantityOnHand: '5',
      ),
    );

class _FixtureReadGateway implements PosReadGateway {
  const _FixtureReadGateway();

  @override
  Future<List<PosProduct>> products({String? branchId}) async => [_productOne, _productTwo];

  @override
  Future<PosProduct?> productByBarcode(String barcode, {String? branchId}) async => null;

  @override
  Future<List<PosCategory>> categories() async => const [];

  @override
  Future<List<PosInventoryBalance>> inventoryBalances({String? branchId}) async => const [];

  @override
  Future<List<PosUser>> users() async => const [];
}

class _RecordingPurchaseOrdersGateway implements PosPurchaseOrdersGateway {
  _RecordingPurchaseOrdersGateway({List<PosPurchaseOrder>? seed}) : items = List.of(seed ?? const []);

  final List<PosPurchaseOrder> items;
  final List<
      ({
        String branchId,
        String? supplierName,
        String? supplierId,
        String orderDate,
        String? expectedDate,
        String currencyCode,
        String? notes,
        List<PosPurchaseOrderLineInput> lines,
      })>
  createCalls = [];
  final List<String> submitCalls = [];
  final List<({String id, List<PosPurchaseOrderReceiveLineInput> lines})> receiveCalls = [];
  final List<String> cancelCalls = [];
  int _autoId = 100;

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
  }) async {
    createCalls.add((
      branchId: branchId,
      supplierName: supplierName,
      supplierId: supplierId,
      orderDate: orderDate,
      expectedDate: expectedDate,
      currencyCode: currencyCode,
      notes: notes,
      lines: lines,
    ));
    final id = 'po-${_autoId++}';
    final orderLines = <PosPurchaseOrderLine>[];
    var lineNumber = 0;
    for (final line in lines) {
      lineNumber++;
      orderLines.add(
        PosPurchaseOrderLine(
          id: '$id-line-$lineNumber',
          lineNumber: lineNumber,
          productVariantId: line.productVariantId,
          productName: 'Agua',
          variantName: null,
          sku: 'TDA-AGUA',
          orderedQuantity: line.orderedQuantity,
          receivedQuantity: '0',
          unitCost: line.unitCost,
          lineTotal: line.unitCost,
          notes: line.notes,
        ),
      );
    }
    final order = PosPurchaseOrder(
      id: id,
      orderNumber: 'PO-${id.padLeft(32, '0')}',
      branchId: branchId,
      status: 'draft',
      supplierName: supplierName,
      supplierId: supplierId,
      orderDate: orderDate,
      expectedDate: expectedDate,
      currencyCode: currencyCode,
      totalCost: '0.0000',
      notes: notes,
      createdBy: 'user-id',
      createdAt: DateTime.utc(2026, 9, 1),
      updatedAt: DateTime.utc(2026, 9, 1),
      lines: orderLines,
    );
    items.add(order);
    return order;
  }

  @override
  Future<PosPurchaseOrder> getPurchaseOrder(String id) async => items.firstWhere((order) => order.id == id);

  @override
  Future<PosPurchaseOrderPage> listPurchaseOrders({
    PosPurchaseOrderListFilter filter = const PosPurchaseOrderListFilter(),
    String? cursor,
    int limit = 50,
  }) async => PosPurchaseOrderPage(items: List.of(items), nextCursor: null);

  @override
  Future<PosPurchaseOrder> submitPurchaseOrder(String id) async {
    submitCalls.add(id);
    final index = items.indexWhere((order) => order.id == id);
    final updated = _withStatus(items[index], 'submitted');
    items[index] = updated;
    return updated;
  }

  @override
  Future<PosPurchaseOrder> receivePurchaseOrder(
    String id, {
    required List<PosPurchaseOrderReceiveLineInput> lines,
  }) async {
    receiveCalls.add((id: id, lines: lines));
    final index = items.indexWhere((order) => order.id == id);
    final order = items[index];
    final receivedById = {for (final line in lines) line.purchaseOrderLineId: line.receivedQuantity};
    final updatedLines = [
      for (final line in order.lines ?? const <PosPurchaseOrderLine>[])
        PosPurchaseOrderLine(
          id: line.id,
          lineNumber: line.lineNumber,
          productVariantId: line.productVariantId,
          productName: line.productName,
          variantName: line.variantName,
          sku: line.sku,
          orderedQuantity: line.orderedQuantity,
          receivedQuantity: receivedById[line.id] ?? '0',
          unitCost: line.unitCost,
          lineTotal: line.lineTotal,
          notes: line.notes,
        ),
    ];
    final fullyReceived = updatedLines.every(
      (line) => double.parse(line.receivedQuantity) >= double.parse(line.orderedQuantity),
    );
    final updated = PosPurchaseOrder(
      id: order.id,
      orderNumber: order.orderNumber,
      branchId: order.branchId,
      status: fullyReceived ? 'received' : 'partially_received',
      supplierName: order.supplierName,
      supplierId: order.supplierId,
      orderDate: order.orderDate,
      expectedDate: order.expectedDate,
      currencyCode: order.currencyCode,
      totalCost: order.totalCost,
      notes: order.notes,
      submittedAt: order.submittedAt,
      submittedBy: order.submittedBy,
      receivedAt: DateTime.utc(2026, 9, 2),
      receivedBy: 'user-id',
      cancelledAt: order.cancelledAt,
      cancelledBy: order.cancelledBy,
      receiptMovementId: 'movement-po-1',
      version: order.version,
      createdBy: order.createdBy,
      createdAt: order.createdAt,
      updatedAt: DateTime.utc(2026, 9, 2),
      lines: updatedLines,
      inventoryMovement: const PosPurchaseOrderInventoryMovement(
        movementId: 'movement-po-1',
        movementNumber: 'MOV-po-1',
        status: 'posted',
        postedAt: null,
      ),
    );
    items[index] = updated;
    return updated;
  }

  @override
  Future<PosPurchaseOrder> cancelPurchaseOrder(String id, {String? reason}) async {
    cancelCalls.add(id);
    final index = items.indexWhere((order) => order.id == id);
    final updated = _withStatus(items[index], 'cancelled');
    items[index] = updated;
    return updated;
  }

  PosPurchaseOrder _withStatus(PosPurchaseOrder order, String status) => PosPurchaseOrder(
    id: order.id,
    orderNumber: order.orderNumber,
    branchId: order.branchId,
    status: status,
    supplierName: order.supplierName,
    supplierId: order.supplierId,
    orderDate: order.orderDate,
    expectedDate: order.expectedDate,
    currencyCode: order.currencyCode,
    totalCost: order.totalCost,
    notes: order.notes,
    submittedAt: status == 'submitted' ? DateTime.utc(2026, 9, 2) : order.submittedAt,
    submittedBy: status == 'submitted' ? 'user-id' : order.submittedBy,
    receivedAt: order.receivedAt,
    receivedBy: order.receivedBy,
    cancelledAt: status == 'cancelled' ? DateTime.utc(2026, 9, 2) : order.cancelledAt,
    cancelledBy: status == 'cancelled' ? 'user-id' : order.cancelledBy,
    receiptMovementId: order.receiptMovementId,
    version: order.version,
    createdBy: order.createdBy,
    createdAt: order.createdAt,
    updatedAt: DateTime.utc(2026, 9, 2),
    lines: order.lines,
    inventoryMovement: order.inventoryMovement,
  );
}

class _RecordingReversalPurchasingGateway implements PosPurchasingGateway {
  _RecordingReversalPurchasingGateway({List<PosDirectPurchase>? seed}) : items = List.of(seed ?? const []);

  final List<PosDirectPurchase> items;
  final List<({String id, String reason})> reverseCalls = [];

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
  }) => Future.error(StateError('not used'));

  @override
  Future<PosDirectPurchase> directPurchase(String id) => Future.error(StateError('not used'));

  @override
  Future<PosDirectPurchasePage> listDirectPurchases({
    PosDirectPurchaseListFilter filter = const PosDirectPurchaseListFilter(),
    String? cursor,
    int limit = 50,
  }) async => PosDirectPurchasePage(items: List.of(items), nextCursor: null);

  @override
  Future<PosDirectPurchase> reverseDirectPurchase(String id, {required String reason}) async {
    reverseCalls.add((id: id, reason: reason));
    final index = items.indexWhere((item) => item.id == id);
    final current = items[index];
    final currentMovement = current.movement;
    final updated = PosDirectPurchase(
      id: current.id,
      branchId: current.branchId,
      supplierName: current.supplierName,
      supplierId: current.supplierId,
      productVariantId: current.productVariantId,
      quantity: current.quantity,
      unitCost: current.unitCost,
      currencyCode: current.currencyCode,
      totalCost: current.totalCost,
      purchaseDate: current.purchaseDate,
      notes: current.notes,
      inventoryMovementId: current.inventoryMovementId,
      createdBy: current.createdBy,
      createdAt: current.createdAt,
      movement: currentMovement == null
          ? null
          : PosDirectPurchaseMovement(
              movementId: currentMovement.movementId,
              movementNumber: currentMovement.movementNumber,
              status: 'reversed',
              postedAt: currentMovement.postedAt,
              currentQuantityOnHand: currentMovement.currentQuantityOnHand,
            ),
    );
    items[index] = updated;
    return updated;
  }
}

Future<void> _pump(
  WidgetTester tester, {
  PosPurchasingGateway? purchasingGateway,
  PosPurchaseOrdersGateway? purchaseOrdersGateway,
  List<String> permissions = _defaultPermissions,
}) async {
  tester.view.physicalSize = const Size(1440, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      home: PosShell(
        context: _contextWith(permissions),
        controller: PosReadController(const _FixtureReadGateway()),
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
        purchasingGateway: purchasingGateway ?? const EmptyPosPurchasingGateway(),
        purchaseOrdersGateway: purchaseOrdersGateway ?? const EmptyPosPurchaseOrdersGateway(),
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

Future<void> _navigateToPurchases(WidgetTester tester) async {
  await _openGroupIfNeeded(tester, 'Inventario', 'nav-purchases');
  await tester.tap(find.byKey(const Key('nav-purchases')));
  await tester.pumpAndSettle();
}

/// Switches the "Compras" screen's own `SegmentedButton` tab — mirrors
/// `pos_inventory_admin_test.dart`'s established tab-switch pattern.
Future<void> _switchTab(WidgetTester tester, String label) async {
  await tester.tap(find.descendant(of: find.byKey(const Key('pos-purchases-tabs')), matching: find.text(label)));
  await tester.pumpAndSettle();
}
