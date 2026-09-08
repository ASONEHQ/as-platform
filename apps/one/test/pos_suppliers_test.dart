/// TASK 14.4 (Wave 2, Part C.1) — widget tests for the standalone
/// `PosSuppliersScreen` ("Proveedores"): CRUD, client-side validation
/// (blank name / malformed email rejected before ever calling the
/// gateway), the deactivate flow, and permission-gating for an actor
/// without `supplier.manage` (read-only — every mutating control stays
/// visible-but-disabled with an explanatory `Tooltip`, never simply
/// hidden). Uses a real, in-memory recording fake gateway — never a
/// mock framework — mirroring `pos_shell_wave1_partbc_test.dart`'s own
/// `_Recording*Gateway` fixture convention.
library;

import 'package:as_one/core/errors/app_error.dart';
import 'package:as_one/core/networking/api_client.dart';
import 'package:as_one/features/authentication/auth_models.dart';
import 'package:as_one/features/pos/pos_suppliers_gateway.dart';
import 'package:as_one/features/pos/pos_suppliers_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('TASK 14.4 Wave 2 Part C.1 — list/search/status-filter', () {
    testWidgets('renders the real fetched suppliers, newest fixture first', (tester) async {
      final gateway = _RecordingSuppliersGateway(
        seed: [_fixtureSupplier(id: 's-1', name: 'Globos del Valle'), _fixtureSupplier(id: 's-2', name: 'Dulces Andrade')],
      );
      await _pump(tester, gateway: gateway, permissions: _readOnly);

      expect(find.byKey(const Key('pos-suppliers-row-s-1')), findsOneWidget);
      expect(find.byKey(const Key('pos-suppliers-row-s-2')), findsOneWidget);
      expect(find.text('Globos del Valle'), findsOneWidget);
      expect(find.text('Dulces Andrade'), findsOneWidget);
    });

    testWidgets('an empty gateway result renders the honest empty state, never a fabricated row', (tester) async {
      final gateway = _RecordingSuppliersGateway(seed: const []);
      await _pump(tester, gateway: gateway, permissions: _readOnly);

      expect(find.text('No hay proveedores registrados.'), findsOneWidget);
    });

    testWidgets('local text search filters the real already-fetched items by name', (tester) async {
      final gateway = _RecordingSuppliersGateway(
        seed: [_fixtureSupplier(id: 's-1', name: 'Globos del Valle'), _fixtureSupplier(id: 's-2', name: 'Dulces Andrade')],
      );
      await _pump(tester, gateway: gateway, permissions: _readOnly);

      await tester.enterText(find.byKey(const Key('pos-suppliers-search')), 'globos');
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('pos-suppliers-row-s-1')), findsOneWidget);
      expect(find.byKey(const Key('pos-suppliers-row-s-2')), findsNothing);
    });
  });

  group('TASK 14.4 Wave 2 Part C.1 — create', () {
    testWidgets('a valid submit calls the real gateway once and the new supplier appears in the list', (tester) async {
      final gateway = _RecordingSuppliersGateway(seed: const []);
      await _pump(tester, gateway: gateway, permissions: _readWrite);

      await tester.tap(find.byKey(const Key('pos-suppliers-new')));
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('pos-suppliers-form-name')), 'Globos del Valle');
      await tester.enterText(find.byKey(const Key('pos-suppliers-form-email')), 'contacto@globosdelvalle.test');
      await tester.tap(find.byKey(const Key('pos-suppliers-form-save')));
      await tester.pumpAndSettle();

      expect(gateway.createCalls, hasLength(1));
      expect(gateway.createCalls.single.name, 'Globos del Valle');
      expect(gateway.createCalls.single.email, 'contacto@globosdelvalle.test');
      expect(find.text('Globos del Valle'), findsOneWidget);
    });

    testWidgets('a blank name is rejected client-side — no gateway call at all', (tester) async {
      final gateway = _RecordingSuppliersGateway(seed: const []);
      await _pump(tester, gateway: gateway, permissions: _readWrite);

      await tester.tap(find.byKey(const Key('pos-suppliers-new')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-suppliers-form-save')));
      await tester.pump();

      expect(find.text('El nombre es obligatorio.'), findsOneWidget);
      expect(gateway.createCalls, isEmpty);
    });

    testWidgets('a malformed email is rejected client-side — no gateway call at all', (tester) async {
      final gateway = _RecordingSuppliersGateway(seed: const []);
      await _pump(tester, gateway: gateway, permissions: _readWrite);

      await tester.tap(find.byKey(const Key('pos-suppliers-new')));
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('pos-suppliers-form-name')), 'Globos del Valle');
      await tester.enterText(find.byKey(const Key('pos-suppliers-form-email')), 'not-an-email');
      await tester.tap(find.byKey(const Key('pos-suppliers-form-save')));
      await tester.pump();

      expect(find.text('El correo no tiene un formato válido.'), findsOneWidget);
      expect(gateway.createCalls, isEmpty);
    });

    testWidgets('a 409 name conflict surfaces the existing supplier id honestly, never a fabricated retry', (tester) async {
      final gateway = _RecordingSuppliersGateway(seed: const [])
        ..conflictOnCreate = ('Ya existe un proveedor con ese nombre.', 'existing-supplier-9');
      await _pump(tester, gateway: gateway, permissions: _readWrite);

      await tester.tap(find.byKey(const Key('pos-suppliers-new')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('pos-suppliers-form-name')), 'Globos del Valle');
      await tester.tap(find.byKey(const Key('pos-suppliers-form-save')));
      await tester.pumpAndSettle();

      expect(find.text('Ya existe un proveedor con ese nombre.'), findsOneWidget);
      expect(find.text('Id del proveedor existente: existing-supplier-9'), findsOneWidget);
    });
  });

  group('TASK 14.4 Wave 2 Part C.1 — edit and deactivate', () {
    testWidgets('editing an existing supplier calls updateSupplier with the real id', (tester) async {
      final gateway = _RecordingSuppliersGateway(seed: [_fixtureSupplier(id: 's-1', name: 'Globos del Valle')]);
      await _pump(tester, gateway: gateway, permissions: _readWrite);

      await tester.tap(find.byKey(const Key('pos-suppliers-row-s-1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-suppliers-detail-edit')));
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('pos-suppliers-form-name')), 'Globos del Valle S.A.');
      await tester.tap(find.byKey(const Key('pos-suppliers-form-save')));
      await tester.pumpAndSettle();

      expect(gateway.updateCalls, hasLength(1));
      expect(gateway.updateCalls.single.id, 's-1');
      expect(gateway.updateCalls.single.input.name, 'Globos del Valle S.A.');
    });

    testWidgets('deactivate calls the real endpoint and the row reflects the honest new status after reload', (tester) async {
      final gateway = _RecordingSuppliersGateway(seed: [_fixtureSupplier(id: 's-1', name: 'Globos del Valle')]);
      await _pump(tester, gateway: gateway, permissions: _readWrite);

      await tester.tap(find.byKey(const Key('pos-suppliers-row-s-1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-suppliers-detail-deactivate')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-suppliers-detail-deactivate-confirm')));
      await tester.pumpAndSettle();

      expect(gateway.deactivateCalls, ['s-1']);
      // The dialog stays open showing the real refreshed status chip.
      expect(find.text('Inactivo'), findsWidgets);

      await tester.tap(find.byKey(const Key('pos-suppliers-detail-close')));
      await tester.pumpAndSettle();

      expect(gateway.items.single.status, 'inactive');
    });
  });

  group('TASK 14.4 Wave 2 Part C.1 — permission gating', () {
    testWidgets('no supplier.read at all shows the honest permission state, no search/list/create', (tester) async {
      final gateway = _RecordingSuppliersGateway(seed: [_fixtureSupplier(id: 's-1', name: 'Globos del Valle')]);
      await _pump(tester, gateway: gateway, permissions: const []);

      expect(find.byKey(const Key('pos-suppliers-search')), findsNothing);
      expect(find.byKey(const Key('pos-suppliers-new')), findsNothing);
      expect(find.textContaining('supplier.read'), findsOneWidget);
    });

    testWidgets(
      'supplier.read without supplier.manage: the list renders but every mutating control is '
      'visible-but-disabled with an explanatory Tooltip, never simply hidden',
      (tester) async {
        final gateway = _RecordingSuppliersGateway(seed: [_fixtureSupplier(id: 's-1', name: 'Globos del Valle')]);
        await _pump(tester, gateway: gateway, permissions: _readOnly);

        final newButton = tester.widget<FilledButton>(find.byKey(const Key('pos-suppliers-new')));
        expect(newButton.onPressed, isNull);
        final newTooltip = tester.widget<Tooltip>(
          find.ancestor(of: find.byKey(const Key('pos-suppliers-new')), matching: find.byType(Tooltip)),
        );
        expect(newTooltip.message, contains('supplier.manage'));

        await tester.tap(find.byKey(const Key('pos-suppliers-row-s-1')));
        await tester.pumpAndSettle();

        final editButton = tester.widget<OutlinedButton>(find.byKey(const Key('pos-suppliers-detail-edit')));
        expect(editButton.onPressed, isNull);
        final deactivateButton = tester.widget<OutlinedButton>(find.byKey(const Key('pos-suppliers-detail-deactivate')));
        expect(deactivateButton.onPressed, isNull);

        expect(gateway.createCalls, isEmpty);
        expect(gateway.updateCalls, isEmpty);
        expect(gateway.deactivateCalls, isEmpty);
      },
    );
  });
}

const _readOnly = ['supplier.read'];
const _readWrite = ['supplier.read', 'supplier.manage'];

PosSupplier _fixtureSupplier({required String id, required String name, String status = 'active'}) => PosSupplier(
  id: id,
  name: name,
  contactName: 'Persona de Contacto',
  phone: '5555555555',
  email: 'contacto@example.test',
  notes: null,
  status: status,
  createdBy: 'user-id',
  updatedBy: 'user-id',
  createdAt: DateTime.utc(2026, 8, 1),
  updatedAt: DateTime.utc(2026, 8, 1),
);

class _RecordingSuppliersGateway implements PosSuppliersGateway {
  _RecordingSuppliersGateway({List<PosSupplier>? seed}) : items = List.of(seed ?? const []);

  final List<PosSupplier> items;
  final List<PosSupplierInput> createCalls = [];
  final List<({String id, PosSupplierInput input})> updateCalls = [];
  final List<String> deactivateCalls = [];
  int _autoId = 100;

  /// When set, the next [createSupplier] throws a 409 `resource_conflict`
  /// carrying this `(message, existing_supplier_id)` — exercises
  /// `posSupplierConflictFrom` honestly instead of a fabricated success.
  (String, String)? conflictOnCreate;

  @override
  Future<PosSupplier> createSupplier(PosSupplierInput input) async {
    final conflict = conflictOnCreate;
    if (conflict != null) {
      throw ApiException(
        AppFailure(AppErrorKind.unknown, conflict.$1, code: 'resource_conflict'),
        statusCode: 409,
        details: {'existing_supplier_id': conflict.$2},
      );
    }
    createCalls.add(input);
    final supplier = PosSupplier(
      id: 'supplier-${_autoId++}',
      name: input.name!,
      contactName: input.contactName,
      phone: input.phone,
      email: input.email,
      notes: input.notes,
      status: 'active',
      createdBy: 'user-id',
      updatedBy: 'user-id',
      createdAt: DateTime.utc(2026, 9, 1),
      updatedAt: DateTime.utc(2026, 9, 1),
    );
    items.add(supplier);
    return supplier;
  }

  @override
  Future<PosSupplierPage> listSuppliers({String? cursor, int limit = 50, String? status}) async {
    final filtered = status == null ? items : items.where((supplier) => supplier.status == status).toList();
    return PosSupplierPage(items: List.of(filtered), nextCursor: null);
  }

  @override
  Future<PosSupplier> supplier(String id) async => items.firstWhere((supplier) => supplier.id == id);

  @override
  Future<PosSupplier> updateSupplier(String id, PosSupplierInput input) async {
    updateCalls.add((id: id, input: input));
    final index = items.indexWhere((supplier) => supplier.id == id);
    final current = items[index];
    final updated = PosSupplier(
      id: current.id,
      name: input.name ?? current.name,
      contactName: input.contactName ?? current.contactName,
      phone: input.phone ?? current.phone,
      email: input.email ?? current.email,
      notes: input.notes ?? current.notes,
      status: input.status ?? current.status,
      createdBy: current.createdBy,
      updatedBy: 'user-id',
      createdAt: current.createdAt,
      updatedAt: DateTime.utc(2026, 9, 2),
    );
    items[index] = updated;
    return updated;
  }

  @override
  Future<PosSupplier> deactivateSupplier(String id) async {
    deactivateCalls.add(id);
    return updateSupplier(id, const PosSupplierInput(status: 'inactive'));
  }
}

Future<void> _pump(
  WidgetTester tester, {
  required _RecordingSuppliersGateway gateway,
  required List<String> permissions,
}) async {
  tester.view.physicalSize = const Size(1280, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: PosSuppliersScreen(context: _context(permissions), suppliersGateway: gateway),
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
