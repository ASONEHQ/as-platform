/// TASK 14.4 (Wave 2, Part C.2) — supplier-linkage coverage for the
/// `_DirectPurchaseForm` edit made inside `pos_shell.dart` (the optional
/// REAL supplier picker alongside the pre-existing free-text
/// `supplierName` field). Kept as its own sibling file per this wave's
/// own instruction — never appended to the already very large
/// `pos_shell_test.dart`.
///
/// IMPORTANT SCOPE NOTE: `PosShell`'s own constructor (and the
/// `PosModule.purchases` switch case that builds `_DirectPurchases`) is
/// deliberately NOT extended with a `suppliersGateway` parameter here —
/// that would require touching `pos_shell.dart`'s big module-switch,
/// which this wave's task explicitly bars (other agents may be
/// concurrently touching that shared area). `_DirectPurchases`/
/// `_DirectPurchaseForm` themselves DO accept an optional
/// `suppliersGateway` now (defaulting to `EmptyPosSuppliersGateway`), but
/// every call site reachable through the public `PosShell` widget still
/// uses that default until the orchestrator applies the central wiring
/// reported alongside this wave's other findings. Consequently:
///   * Group 1 exercises what IS reachable through `PosShell` today: the
///     new picker renders additively, degrades safely with zero
///     configured suppliers (the real state until the wiring lands), and
///     the pre-existing free-text path is a byte-for-byte regression
///     match of its pre-Wave-2 behavior.
///   * Group 2 exercises the "picking a real supplier" request/response
///     contract directly at the `ApiPosPurchasingGateway`/`PosDirectPurchase`
///     level (`pos_purchasing_gateway.dart`) — the concrete behavior a
///     real pick ultimately drives, and fully testable today without any
///     of the barred wiring.
library;

import 'dart:convert';

import 'package:as_one/app/app.dart' show PlatformScope;
import 'package:as_one/core/networking/api_client.dart';
import 'package:as_one/features/authentication/auth_models.dart';
import 'package:as_one/features/pos/pos_cash_gateway.dart';
import 'package:as_one/features/pos/pos_customers_gateway.dart';
import 'package:as_one/features/pos/pos_loyalty_gateway.dart';
import 'package:as_one/features/pos/pos_memberships_gateway.dart';
import 'package:as_one/features/pos/pos_models.dart';
import 'package:as_one/features/pos/pos_parties_gateway.dart';
import 'package:as_one/features/pos/pos_payments_gateway.dart';
import 'package:as_one/features/pos/pos_promotions_gateway.dart';
import 'package:as_one/features/pos/pos_purchasing_gateway.dart';
import 'package:as_one/features/pos/pos_read_controller.dart';
import 'package:as_one/features/pos/pos_read_gateway.dart';
import 'package:as_one/features/pos/pos_refunds_gateway.dart';
import 'package:as_one/features/pos/pos_rewards_gateway.dart';
import 'package:as_one/features/pos/pos_sales_gateway.dart';
import 'package:as_one/features/pos/pos_shell.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

void main() {
  group('TASK 14.4 Wave 2 Part C.2 — Compra Directa: supplier picker (through PosShell)', () {
    testWidgets(
      'the new registered-supplier picker renders additively, alongside the unchanged free-text field',
      (tester) async {
        await _pump(tester);
        await _navigateToPurchases(tester);

        expect(find.byKey(const Key('pos-direct-purchase-supplier-picker')), findsOneWidget);
        expect(find.byKey(const Key('pos-direct-purchase-supplier-search')), findsOneWidget);
        expect(find.byKey(const Key('pos-direct-purchase-supplier')), findsOneWidget);

        // No supplier selected yet — the pre-existing free-text field
        // stays enabled exactly as before this wave.
        final freeText = tester.widget<TextField>(find.byKey(const Key('pos-direct-purchase-supplier')));
        expect(freeText.enabled, isTrue);
        expect(find.byKey(const Key('pos-direct-purchase-supplier-selected')), findsNothing);
      },
    );

    testWidgets(
      'typing in the registered-supplier search field with no suppliers configured degrades safely — '
      'no crash, nothing gets auto-selected (the real state until the orchestrator threads a real '
      'PosSuppliersGateway through PosShell)',
      (tester) async {
        await _pump(tester);
        await _navigateToPurchases(tester);

        await tester.enterText(find.byKey(const Key('pos-direct-purchase-supplier-search')), 'globos');
        await tester.pump();

        expect(tester.takeException(), isNull);
        expect(find.byKey(const Key('pos-direct-purchase-supplier-selected')), findsNothing);
      },
    );

    testWidgets(
      'leaving the picker untouched and filling only the free-text field still sends supplier_name and '
      'no supplier_id — a byte-for-byte regression match of the pre-Wave-2 behavior',
      (tester) async {
        final gateway = _RecordingPurchasingGateway();
        await _pump(tester, purchasingGateway: gateway);
        await _navigateToPurchases(tester);

        await tester.tap(find.byKey(const Key('pos-direct-purchase-product')));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Producto Unitario (SKU-1)').last);
        await tester.pumpAndSettle();

        await tester.enterText(find.byKey(const Key('pos-direct-purchase-quantity')), '3');
        await tester.enterText(find.byKey(const Key('pos-direct-purchase-unit-cost')), '12.50');
        await tester.enterText(find.byKey(const Key('pos-direct-purchase-supplier')), 'Proveedor Local');
        await tester.tap(find.byKey(const Key('pos-direct-purchase-submit')));
        await tester.pump();
        await tester.pumpAndSettle();

        expect(gateway.createCalls, hasLength(1));
        expect(gateway.createCalls.single.supplierName, 'Proveedor Local');
        expect(gateway.createCalls.single.supplierId, isNull);
      },
    );
  });

  group('TASK 14.4 Wave 2 Part C.2 — supplier_id request/response contract (ApiPosPurchasingGateway)', () {
    test('createDirectPurchase sends the real supplier_id and omits supplier_name when a real supplier is linked', () async {
      late Map<String, Object?> sentBody;
      final client = _fakeApiClient((request) {
        sentBody = jsonDecode((request as http.Request).body) as Map<String, Object?>;
        return _successResponse();
      });
      final gateway = ApiPosPurchasingGateway(client, createIdempotencyKey: () => 'idem-1');

      await gateway.createDirectPurchase(
        branchId: 'branch-1',
        supplierId: 'supplier-9',
        productVariantId: 'variant-1',
        quantity: '3',
        unitCost: '12.5000',
        currencyCode: 'MXN',
        purchaseDate: '2026-09-01',
      );

      expect(sentBody['supplier_id'], 'supplier-9');
      expect(sentBody.containsKey('supplier_name'), isFalse);
    });

    test('createDirectPurchase keeps the pre-existing shape (no supplier_id key at all) when only free text is given', () async {
      late Map<String, Object?> sentBody;
      final client = _fakeApiClient((request) {
        sentBody = jsonDecode((request as http.Request).body) as Map<String, Object?>;
        return _successResponse();
      });
      final gateway = ApiPosPurchasingGateway(client, createIdempotencyKey: () => 'idem-1');

      await gateway.createDirectPurchase(
        branchId: 'branch-1',
        supplierName: 'Proveedor Local',
        productVariantId: 'variant-1',
        quantity: '3',
        unitCost: '12.5000',
        currencyCode: 'MXN',
        purchaseDate: '2026-09-01',
      );

      expect(sentBody['supplier_name'], 'Proveedor Local');
      expect(sentBody.containsKey('supplier_id'), isFalse);
    });

    test('PosDirectPurchase.fromJson decodes a real linked supplier_id from the response, never a fabricated one', () {
      final purchase = PosDirectPurchase.fromJson({
        'id': 'purchase-1',
        'branch_id': 'branch-1',
        'supplier_name': 'Globos del Valle',
        'supplier_id': 'supplier-9',
        'product_variant_id': 'variant-1',
        'quantity': '3',
        'unit_cost': '12.5000',
        'currency_code': 'MXN',
        'total_cost': '37.5000',
        'purchase_date': '2026-09-01',
        'notes': null,
        'inventory_movement_id': 'movement-1',
        'created_by': 'user-id',
        'created_at': '2026-09-01T12:00:00.000Z',
      });

      expect(purchase.supplierId, 'supplier-9');
      expect(purchase.supplierName, 'Globos del Valle');
    });

    test('PosDirectPurchase.fromJson decodes a null supplier_id honestly for a free-text-only purchase', () {
      final purchase = PosDirectPurchase.fromJson({
        'id': 'purchase-1',
        'branch_id': 'branch-1',
        'supplier_name': 'Proveedor Local',
        'supplier_id': null,
        'product_variant_id': 'variant-1',
        'quantity': '3',
        'unit_cost': '12.5000',
        'currency_code': 'MXN',
        'total_cost': '37.5000',
        'purchase_date': '2026-09-01',
        'notes': null,
        'inventory_movement_id': 'movement-1',
        'created_by': 'user-id',
        'created_at': '2026-09-01T12:00:00.000Z',
      });

      expect(purchase.supplierId, isNull);
      expect(purchase.supplierName, 'Proveedor Local');
    });
  });
}

// --- Gateway-level fixtures ----------------------------------------------

ApiClient _fakeApiClient(http.Response Function(http.BaseRequest request) handler) => ApiClient(
  baseUrl: Uri.parse('https://api.test.asone.mx/'),
  transport: _FakeClient(handler),
  readAccessToken: () => 'memory-token',
  createCorrelationId: () => 'correlation-test',
);

http.Response _successResponse() => http.Response(
  jsonEncode({
    'data': {
      'id': 'purchase-1',
      'branch_id': 'branch-1',
      'supplier_name': null,
      'supplier_id': null,
      'product_variant_id': 'variant-1',
      'quantity': '3',
      'unit_cost': '12.5000',
      'currency_code': 'MXN',
      'total_cost': '37.5000',
      'purchase_date': '2026-09-01',
      'notes': null,
      'inventory_movement_id': 'movement-1',
      'created_by': 'user-id',
      'created_at': '2026-09-01T12:00:00.000Z',
    },
  }),
  201,
  headers: {'content-type': 'application/json'},
);

class _FakeClient extends http.BaseClient {
  _FakeClient(this.handler);
  final http.Response Function(http.BaseRequest request) handler;
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final response = handler(request);
    return http.StreamedResponse(Stream.value(response.bodyBytes), response.statusCode, headers: response.headers);
  }
}

// --- PosShell-level fixtures ----------------------------------------------

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

class _FixtureReadGateway implements PosReadGateway {
  const _FixtureReadGateway();

  @override
  Future<List<PosProduct>> products({String? branchId}) async => [_unitProduct];

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

PosPricing _price(String amount) => PosPricing.fromJson({'amount': amount, 'currency_code': 'MXN'});

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
  permissions: const ['purchase.create', 'purchase.read'],
);

Future<void> _pump(WidgetTester tester, {PosPurchasingGateway? purchasingGateway}) async {
  tester.view.physicalSize = const Size(1440, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    // TASK 16.23B (F-05) — see `_pump`'s own identical doc comment in
    // `pos_shell_test.dart`.
    PlatformScope(
      posReadGateway: const _FixtureReadGateway(),
      child: MaterialApp(
        home: PosShell(
          context: _context,
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
          purchasingGateway: purchasingGateway ?? _RecordingPurchasingGateway(),
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

Future<void> _navigateToPurchases(WidgetTester tester) async {
  await _openGroupIfNeeded(tester, 'Inventario', 'nav-purchases');
  await tester.tap(find.byKey(const Key('nav-purchases')));
  await tester.pumpAndSettle();
  // TASK 14.3 (Wave 4): "Compras" is now a 3-tab screen (Órdenes / Compra
  // Directa / Historial), defaulting to Órdenes — every test in this file
  // is about the Compra Directa form specifically, so this helper switches
  // straight to that tab (mirrors `pos_inventory_admin_test.dart`'s own
  // established `SegmentedButton` tab-switch pattern).
  await tester.tap(
    find.descendant(of: find.byKey(const Key('pos-purchases-tabs')), matching: find.text('Compra Directa')),
  );
  await tester.pumpAndSettle();
}
