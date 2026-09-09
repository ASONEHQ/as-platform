/// TASK 15.1 Phase 4 — widget tests for the standalone
/// `PosCategoryAdminScreen` ("Categorías"): list rendering, status filter,
/// create, edit (with its own real `version`/`If-Match`), and
/// permission-gating for an actor without `category.manage` (read-only —
/// create/edit affordances are not rendered at all). Uses a real, in-memory
/// recording fake gateway — never a mock framework — mirroring
/// `pos_suppliers_test.dart`'s own `_Recording*Gateway` fixture convention.
library;

import 'package:as_one/features/authentication/auth_models.dart';
import 'package:as_one/features/pos/pos_category_admin_gateway.dart';
import 'package:as_one/features/pos/pos_category_admin_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('TASK 15.1 Phase 4 — list', () {
    testWidgets('renders the real fetched categories', (tester) async {
      final gateway = _RecordingCategoryAdminGateway(
        categories: [_category(id: 'c-1', code: 'BEB', name: 'Bebidas'), _category(id: 'c-2', code: 'SNK', name: 'Snacks')],
      );
      await _pump(tester, gateway: gateway, permissions: _readOnly);

      expect(find.byKey(const Key('pos-category-admin-row-c-1')), findsOneWidget);
      expect(find.byKey(const Key('pos-category-admin-row-c-2')), findsOneWidget);
      expect(find.text('Bebidas'), findsOneWidget);
      expect(find.text('Snacks'), findsOneWidget);
    });

    testWidgets('an empty list renders the honest empty state, never a fabricated row', (tester) async {
      final gateway = _RecordingCategoryAdminGateway(categories: const []);
      await _pump(tester, gateway: gateway, permissions: _readOnly);

      expect(find.text('No hay categorías registradas.'), findsOneWidget);
    });

    testWidgets('changing the status filter calls listCategories with the real status', (tester) async {
      final gateway = _RecordingCategoryAdminGateway(
        categories: [_category(id: 'c-1', code: 'BEB', name: 'Bebidas', status: 'inactive')],
      );
      await _pump(tester, gateway: gateway, permissions: _readOnly);

      await tester.tap(find.byKey(const Key('pos-category-admin-status-filter')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Inactivas').last);
      await tester.pumpAndSettle();

      expect(gateway.listStatusFilters.last, 'inactive');
    });
  });

  group('TASK 15.1 Phase 4 — create', () {
    testWidgets('a valid submit calls createCategory with the right payload and the new category appears', (
      tester,
    ) async {
      final gateway = _RecordingCategoryAdminGateway(categories: const []);
      await _pump(tester, gateway: gateway, permissions: _readWrite);

      await tester.tap(find.byKey(const Key('pos-category-admin-new')));
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('pos-category-admin-form-code')), 'BEB');
      await tester.enterText(find.byKey(const Key('pos-category-admin-form-name')), 'Bebidas');
      await tester.enterText(find.byKey(const Key('pos-category-admin-form-sort-order')), '3');
      await tester.tap(find.byKey(const Key('pos-category-admin-form-save')));
      await tester.pumpAndSettle();

      expect(gateway.createCalls, hasLength(1));
      expect(gateway.createCalls.single.code, 'BEB');
      expect(gateway.createCalls.single.name, 'Bebidas');
      expect(gateway.createCalls.single.sortOrder, 3);
      expect(find.text('Bebidas'), findsOneWidget);
    });

    testWidgets('a blank name is rejected client-side — no gateway call at all', (tester) async {
      final gateway = _RecordingCategoryAdminGateway(categories: const []);
      await _pump(tester, gateway: gateway, permissions: _readWrite);

      await tester.tap(find.byKey(const Key('pos-category-admin-new')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('pos-category-admin-form-code')), 'BEB');
      await tester.tap(find.byKey(const Key('pos-category-admin-form-save')));
      await tester.pump();

      expect(find.text('El nombre es obligatorio.'), findsOneWidget);
      expect(gateway.createCalls, isEmpty);
    });
  });

  group('TASK 15.1 Phase 4 — edit', () {
    testWidgets('editing a category calls updateCategory with its own real current version, never code', (
      tester,
    ) async {
      final gateway = _RecordingCategoryAdminGateway(
        categories: [_category(id: 'c-1', code: 'BEB', name: 'Bebidas', version: 4)],
      );
      await _pump(tester, gateway: gateway, permissions: _readWrite);

      await tester.tap(find.byKey(const Key('pos-category-admin-edit-c-1')));
      await tester.pumpAndSettle();

      // `code` is not even rendered on edit — see the dialog's own logic.
      expect(find.byKey(const Key('pos-category-admin-form-code')), findsNothing);

      await tester.enterText(find.byKey(const Key('pos-category-admin-form-name')), 'Bebidas frías');
      await tester.tap(find.byKey(const Key('pos-category-admin-form-save')));
      await tester.pumpAndSettle();

      expect(gateway.updateCalls, hasLength(1));
      expect(gateway.updateCalls.single.id, 'c-1');
      expect(gateway.updateCalls.single.version, 4);
      expect(gateway.updateCalls.single.input.name, 'Bebidas frías');
      expect(gateway.updateCalls.single.input.code, isNull);
      expect(find.text('Bebidas frías'), findsOneWidget);
    });
  });

  group('TASK 15.1 Phase 4 — permission gating', () {
    testWidgets('no catalog.read at all shows the honest permission state, no search/list', (tester) async {
      final gateway = _RecordingCategoryAdminGateway(categories: [_category(id: 'c-1', code: 'BEB', name: 'Bebidas')]);
      await _pump(tester, gateway: gateway, permissions: const []);

      expect(find.byKey(const Key('pos-category-admin-search')), findsNothing);
      expect(find.textContaining('catalog.read'), findsOneWidget);
      expect(gateway.listCalls, 0);
    });

    testWidgets(
      'catalog.read without category.manage: the read-only list renders but no create/edit affordance exists',
      (tester) async {
        final gateway = _RecordingCategoryAdminGateway(
          categories: [_category(id: 'c-1', code: 'BEB', name: 'Bebidas')],
        );
        await _pump(tester, gateway: gateway, permissions: _readOnly);

        expect(find.byKey(const Key('pos-category-admin-row-c-1')), findsOneWidget);
        expect(find.byKey(const Key('pos-category-admin-new')), findsOneWidget);
        final button = tester.widget<FilledButton>(find.byKey(const Key('pos-category-admin-new')));
        expect(button.onPressed, isNull);
        expect(find.byKey(const Key('pos-category-admin-edit-c-1')), findsNothing);

        expect(gateway.createCalls, isEmpty);
        expect(gateway.updateCalls, isEmpty);
      },
    );
  });
}

const _readOnly = ['catalog.read'];
const _readWrite = ['catalog.read', 'category.manage'];

PosCatalogCategory _category({
  required String id,
  required String code,
  required String name,
  String? parentId,
  String? description,
  int sortOrder = 0,
  String status = 'active',
  bool visualTile = false,
  int version = 1,
}) => PosCatalogCategory(
  id: id,
  parentId: parentId,
  code: code,
  name: name,
  description: description,
  sortOrder: sortOrder,
  status: status,
  visualTile: visualTile,
  version: version,
  createdAt: DateTime.utc(2026, 8, 1),
  updatedAt: DateTime.utc(2026, 8, 1),
);

class _RecordingCategoryAdminGateway implements PosCategoryAdminGateway {
  _RecordingCategoryAdminGateway({List<PosCatalogCategory>? categories})
    : categories = List.of(categories ?? const []);

  final List<PosCatalogCategory> categories;
  int listCalls = 0;
  final List<String?> listStatusFilters = [];
  final List<PosCategoryInput> createCalls = [];
  final List<({String id, int version, PosCategoryInput input})> updateCalls = [];
  int _autoId = 100;

  @override
  Future<PosCatalogCategoryPage> listCategories({
    String? cursor,
    int limit = 50,
    String? status,
    String? search,
  }) async {
    listCalls++;
    listStatusFilters.add(status);
    final filtered = status == null ? categories : categories.where((c) => c.status == status).toList();
    return PosCatalogCategoryPage(items: List.of(filtered), nextCursor: null);
  }

  @override
  Future<PosCatalogCategory> createCategory(PosCategoryInput input) async {
    createCalls.add(input);
    final created = PosCatalogCategory(
      id: 'category-${_autoId++}',
      parentId: input.parentId,
      code: input.code!,
      name: input.name!,
      description: input.description,
      sortOrder: input.sortOrder ?? 0,
      status: input.status ?? 'active',
      visualTile: input.visualTile ?? false,
      version: 1,
      createdAt: DateTime.utc(2026, 9, 1),
      updatedAt: DateTime.utc(2026, 9, 1),
    );
    categories.add(created);
    return created;
  }

  @override
  Future<PosCatalogCategory> updateCategory(String id, int version, PosCategoryInput input) async {
    updateCalls.add((id: id, version: version, input: input));
    final index = categories.indexWhere((c) => c.id == id);
    if (index == -1) throw StateError('Category not found: $id');
    final current = categories[index];
    final updated = PosCatalogCategory(
      id: current.id,
      parentId: input.parentId ?? current.parentId,
      code: current.code,
      name: input.name ?? current.name,
      description: input.description ?? current.description,
      sortOrder: input.sortOrder ?? current.sortOrder,
      status: input.status ?? current.status,
      visualTile: input.visualTile ?? current.visualTile,
      version: current.version + 1,
      createdAt: current.createdAt,
      updatedAt: DateTime.utc(2026, 9, 2),
    );
    categories[index] = updated;
    return updated;
  }
}

Future<void> _pump(
  WidgetTester tester, {
  required _RecordingCategoryAdminGateway gateway,
  required List<String> permissions,
}) async {
  tester.view.physicalSize = const Size(1280, 1400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: PosCategoryAdminScreen(context: _context(permissions), gateway: gateway),
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
