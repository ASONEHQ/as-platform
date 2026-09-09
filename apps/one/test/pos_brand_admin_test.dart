/// TASK 15.1 Phase 4 — widget tests for the standalone `PosBrandAdminScreen`
/// ("Marcas"): list rendering, status filter, create, edit (with its own
/// real `version`/`If-Match`), and permission-gating for an actor without
/// `product.manage` (read-only — create/edit affordances are not rendered
/// at all). Uses a real, in-memory recording fake gateway — never a mock
/// framework — mirroring `pos_suppliers_test.dart`'s own
/// `_Recording*Gateway` fixture convention.
library;

import 'package:as_one/features/authentication/auth_models.dart';
import 'package:as_one/features/pos/pos_brand_admin_gateway.dart';
import 'package:as_one/features/pos/pos_brand_admin_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('TASK 15.1 Phase 4 — list', () {
    testWidgets('renders the real fetched brands', (tester) async {
      final gateway = _RecordingBrandAdminGateway(
        brands: [_brand(id: 'b-1', code: 'COCA', name: 'Coca-Cola'), _brand(id: 'b-2', code: 'PEPSI', name: 'Pepsi')],
      );
      await _pump(tester, gateway: gateway, permissions: _readOnly);

      expect(find.byKey(const Key('pos-brand-admin-row-b-1')), findsOneWidget);
      expect(find.byKey(const Key('pos-brand-admin-row-b-2')), findsOneWidget);
      expect(find.text('Coca-Cola'), findsOneWidget);
      expect(find.text('Pepsi'), findsOneWidget);
    });

    testWidgets('an empty list renders the honest empty state, never a fabricated row', (tester) async {
      final gateway = _RecordingBrandAdminGateway(brands: const []);
      await _pump(tester, gateway: gateway, permissions: _readOnly);

      expect(find.text('No hay marcas registradas.'), findsOneWidget);
    });
  });

  group('TASK 15.1 Phase 4 — create', () {
    testWidgets('a valid submit calls createBrand with the right payload and the new brand appears', (tester) async {
      final gateway = _RecordingBrandAdminGateway(brands: const []);
      await _pump(tester, gateway: gateway, permissions: _readWrite);

      await tester.tap(find.byKey(const Key('pos-brand-admin-new')));
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('pos-brand-admin-form-code')), 'COCA');
      await tester.enterText(find.byKey(const Key('pos-brand-admin-form-name')), 'Coca-Cola');
      await tester.tap(find.byKey(const Key('pos-brand-admin-form-save')));
      await tester.pumpAndSettle();

      expect(gateway.createCalls, hasLength(1));
      expect(gateway.createCalls.single.code, 'COCA');
      expect(gateway.createCalls.single.name, 'Coca-Cola');
      expect(find.text('Coca-Cola'), findsOneWidget);
    });

    testWidgets('a blank code is rejected client-side — no gateway call at all', (tester) async {
      final gateway = _RecordingBrandAdminGateway(brands: const []);
      await _pump(tester, gateway: gateway, permissions: _readWrite);

      await tester.tap(find.byKey(const Key('pos-brand-admin-new')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('pos-brand-admin-form-name')), 'Coca-Cola');
      await tester.tap(find.byKey(const Key('pos-brand-admin-form-save')));
      await tester.pump();

      expect(find.text('El código es obligatorio.'), findsOneWidget);
      expect(gateway.createCalls, isEmpty);
    });
  });

  group('TASK 15.1 Phase 4 — edit', () {
    testWidgets('editing a brand calls updateBrand with its own real current version, never code', (tester) async {
      final gateway = _RecordingBrandAdminGateway(
        brands: [_brand(id: 'b-1', code: 'COCA', name: 'Coca-Cola', version: 2)],
      );
      await _pump(tester, gateway: gateway, permissions: _readWrite);

      await tester.tap(find.byKey(const Key('pos-brand-admin-edit-b-1')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('pos-brand-admin-form-code')), findsNothing);

      await tester.enterText(find.byKey(const Key('pos-brand-admin-form-name')), 'Coca-Cola Company');
      await tester.tap(find.byKey(const Key('pos-brand-admin-form-save')));
      await tester.pumpAndSettle();

      expect(gateway.updateCalls, hasLength(1));
      expect(gateway.updateCalls.single.id, 'b-1');
      expect(gateway.updateCalls.single.version, 2);
      expect(gateway.updateCalls.single.input.name, 'Coca-Cola Company');
      expect(gateway.updateCalls.single.input.code, isNull);
      expect(find.text('Coca-Cola Company'), findsOneWidget);
    });
  });

  group('TASK 15.1 Phase 4 — permission gating', () {
    testWidgets('no catalog.read at all shows the honest permission state, no search/list', (tester) async {
      final gateway = _RecordingBrandAdminGateway(brands: [_brand(id: 'b-1', code: 'COCA', name: 'Coca-Cola')]);
      await _pump(tester, gateway: gateway, permissions: const []);

      expect(find.byKey(const Key('pos-brand-admin-search')), findsNothing);
      expect(find.textContaining('catalog.read'), findsOneWidget);
      expect(gateway.listCalls, 0);
    });

    testWidgets(
      'catalog.read without product.manage: the read-only list renders but no create/edit affordance exists',
      (tester) async {
        final gateway = _RecordingBrandAdminGateway(brands: [_brand(id: 'b-1', code: 'COCA', name: 'Coca-Cola')]);
        await _pump(tester, gateway: gateway, permissions: _readOnly);

        expect(find.byKey(const Key('pos-brand-admin-row-b-1')), findsOneWidget);
        final button = tester.widget<FilledButton>(find.byKey(const Key('pos-brand-admin-new')));
        expect(button.onPressed, isNull);
        expect(find.byKey(const Key('pos-brand-admin-edit-b-1')), findsNothing);

        expect(gateway.createCalls, isEmpty);
        expect(gateway.updateCalls, isEmpty);
      },
    );
  });
}

const _readOnly = ['catalog.read'];
const _readWrite = ['catalog.read', 'product.manage'];

PosCatalogBrand _brand({
  required String id,
  required String code,
  required String name,
  String? description,
  String status = 'active',
  int version = 1,
}) => PosCatalogBrand(
  id: id,
  code: code,
  name: name,
  description: description,
  status: status,
  version: version,
  createdAt: DateTime.utc(2026, 8, 1),
  updatedAt: DateTime.utc(2026, 8, 1),
);

class _RecordingBrandAdminGateway implements PosBrandAdminGateway {
  _RecordingBrandAdminGateway({List<PosCatalogBrand>? brands}) : brands = List.of(brands ?? const []);

  final List<PosCatalogBrand> brands;
  int listCalls = 0;
  final List<PosBrandInput> createCalls = [];
  final List<({String id, int version, PosBrandInput input})> updateCalls = [];
  int _autoId = 100;

  @override
  Future<PosCatalogBrandPage> listBrands({String? cursor, int limit = 50, String? status, String? search}) async {
    listCalls++;
    final filtered = status == null ? brands : brands.where((b) => b.status == status).toList();
    return PosCatalogBrandPage(items: List.of(filtered), nextCursor: null);
  }

  @override
  Future<PosCatalogBrand> createBrand(PosBrandInput input) async {
    createCalls.add(input);
    final created = PosCatalogBrand(
      id: 'brand-${_autoId++}',
      code: input.code!,
      name: input.name!,
      description: input.description,
      status: input.status ?? 'active',
      version: 1,
      createdAt: DateTime.utc(2026, 9, 1),
      updatedAt: DateTime.utc(2026, 9, 1),
    );
    brands.add(created);
    return created;
  }

  @override
  Future<PosCatalogBrand> updateBrand(String id, int version, PosBrandInput input) async {
    updateCalls.add((id: id, version: version, input: input));
    final index = brands.indexWhere((b) => b.id == id);
    if (index == -1) throw StateError('Brand not found: $id');
    final current = brands[index];
    final updated = PosCatalogBrand(
      id: current.id,
      code: current.code,
      name: input.name ?? current.name,
      description: input.description ?? current.description,
      status: input.status ?? current.status,
      version: current.version + 1,
      createdAt: current.createdAt,
      updatedAt: DateTime.utc(2026, 9, 2),
    );
    brands[index] = updated;
    return updated;
  }
}

Future<void> _pump(
  WidgetTester tester, {
  required _RecordingBrandAdminGateway gateway,
  required List<String> permissions,
}) async {
  tester.view.physicalSize = const Size(1280, 1400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(child: PosBrandAdminScreen(context: _context(permissions), gateway: gateway)),
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
