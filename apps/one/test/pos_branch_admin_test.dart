/// TASK 15.1 (commercial admin UX closure) — widget tests for the
/// standalone `PosBranchAdminScreen` ("Sucursales"): list rendering, the
/// create-branch flow, the edit-branch flow, and permission-gating for an
/// actor lacking `branch.create`/`branch.update` (every mutating control
/// stays visible-but-disabled with an explanatory `Tooltip`, never simply
/// hidden) and for one lacking `branch.read` entirely (honest denial
/// state, no gateway call at all). Uses a real, in-memory recording fake
/// gateway — never a mock framework — mirroring `pos_receipt_branding_test
/// .dart`'s exact `_Recording*Gateway` fixture convention.
library;

import 'package:as_one/core/errors/app_error.dart';
import 'package:as_one/core/networking/api_client.dart';
import 'package:as_one/features/authentication/auth_models.dart';
import 'package:as_one/features/pos/pos_branch_admin_gateway.dart';
import 'package:as_one/features/pos/pos_branch_admin_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const _readOnly = ['branch.read'];
const _readWrite = ['branch.read', 'branch.create', 'branch.update'];

void main() {
  group('TASK 15.1 — list', () {
    testWidgets('renders the real fetched branches', (tester) async {
      final gateway = _RecordingBranchAdminGateway(
        seed: [_fixtureBranch(id: 'b-1', code: 'CENTRO', name: 'Sucursal Centro'), _fixtureBranch(id: 'b-2', code: 'NORTE', name: 'Sucursal Norte')],
      );
      await _pump(tester, gateway: gateway, permissions: _readOnly);

      expect(find.byKey(const Key('pos-branch-admin-row-b-1')), findsOneWidget);
      expect(find.byKey(const Key('pos-branch-admin-row-b-2')), findsOneWidget);
      expect(find.text('Sucursal Centro'), findsOneWidget);
      expect(find.text('Sucursal Norte'), findsOneWidget);
      expect(gateway.listCalls, hasLength(1));
      expect(gateway.listCalls.single, 'company-id');
    });

    testWidgets('an empty gateway result renders the honest empty state, never a fabricated row', (tester) async {
      final gateway = _RecordingBranchAdminGateway(seed: const []);
      await _pump(tester, gateway: gateway, permissions: _readOnly);

      expect(find.text('No hay sucursales registradas.'), findsOneWidget);
    });

    testWidgets('a gateway failure renders the real error message with a retry control', (tester) async {
      final gateway = _RecordingBranchAdminGateway(seed: const [], failOnList: true);
      await _pump(tester, gateway: gateway, permissions: _readOnly);

      expect(find.text('Fallo simulado al listar sucursales.'), findsOneWidget);
      expect(find.byKey(const Key('pos-branch-admin-refresh')), findsOneWidget);
      expect(find.text('Reintentar'), findsOneWidget);
    });
  });

  group('TASK 15.1 — create', () {
    testWidgets('a valid submit calls the real gateway once and the new branch appears in the list', (tester) async {
      final gateway = _RecordingBranchAdminGateway(seed: const []);
      await _pump(tester, gateway: gateway, permissions: _readWrite);

      await tester.tap(find.byKey(const Key('pos-branch-admin-new')));
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('pos-branch-admin-form-code')), 'SUR');
      await tester.enterText(find.byKey(const Key('pos-branch-admin-form-name')), 'Sucursal Sur');
      // TASK 16.8B: the timezone field is now a searchable picker
      // (`Autocomplete<_TimezoneOption>`) over a curated list of real IANA
      // identifiers — typing filters the suggestion overlay, and tapping
      // the matching option both fills the field with the canonical value
      // and closes the overlay (never leaving it open to obscure "Guardar").
      await tester.enterText(find.byKey(const Key('pos-branch-admin-form-timezone')), 'méxico');
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-branch-admin-form-timezone-option-America/Mexico_City')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-branch-admin-form-save')));
      await tester.pumpAndSettle();

      expect(gateway.createCalls, hasLength(1));
      expect(gateway.createCalls.single.companyId, 'company-id');
      expect(gateway.createCalls.single.input.code, 'SUR');
      expect(gateway.createCalls.single.input.name, 'Sucursal Sur');
      expect(gateway.createCalls.single.input.timezone, 'America/Mexico_City');
      // Creation never sends a status — the backend always starts a new
      // branch `active` server-side.
      expect(gateway.createCalls.single.input.status, isNull);
      expect(find.text('Sucursal Sur'), findsOneWidget);
    });
  });

  group('TASK 16.8B — timezone picker', () {
    testWidgets('searching by city name filters to the matching real IANA options, and selecting one '
        'writes the canonical identifier into the field', (tester) async {
      final gateway = _RecordingBranchAdminGateway(seed: const []);
      await _pump(tester, gateway: gateway, permissions: _readWrite);

      await tester.tap(find.byKey(const Key('pos-branch-admin-new')));
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('pos-branch-admin-form-timezone')), 'cancún');
      await tester.pumpAndSettle();

      // The search matches the Spanish label, not just the raw IANA value —
      // exactly the point of a human-readable picker over a raw text field.
      expect(find.byKey(const Key('pos-branch-admin-form-timezone-option-America/Cancun')), findsOneWidget);
      expect(find.byKey(const Key('pos-branch-admin-form-timezone-option-America/Mexico_City')), findsNothing);

      await tester.tap(find.byKey(const Key('pos-branch-admin-form-timezone-option-America/Cancun')));
      await tester.pumpAndSettle();

      expect(
        tester.widget<TextField>(find.byKey(const Key('pos-branch-admin-form-timezone'))).controller?.text,
        'America/Cancun',
      );
    });

    testWidgets('a real IANA value not in the curated shortlist can still be typed directly — the '
        'picker is a convenience, never a lock-out (the backend remains authoritative)', (tester) async {
      final gateway = _RecordingBranchAdminGateway(seed: const []);
      await _pump(tester, gateway: gateway, permissions: _readWrite);

      await tester.tap(find.byKey(const Key('pos-branch-admin-new')));
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('pos-branch-admin-form-code')), 'TOK');
      await tester.enterText(find.byKey(const Key('pos-branch-admin-form-name')), 'Sucursal Tokio');
      await tester.enterText(find.byKey(const Key('pos-branch-admin-form-timezone')), 'Asia/Tokyo');
      // Dismiss the (empty, no-match) suggestions overlay before tapping
      // Guardar, exactly like the picker's own real-usage flow.
      await tester.tap(find.byKey(const Key('pos-branch-admin-form-name')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-branch-admin-form-save')));
      await tester.pumpAndSettle();

      expect(gateway.createCalls.single.input.timezone, 'Asia/Tokyo');
    });

    testWidgets('the backend\'s own rejection of an invalid timezone (defense in depth even though '
        'the picker only offers real values) surfaces as the real, honest error message', (tester) async {
      final gateway = _RecordingBranchAdminGateway(
        seed: const [],
        createFailure: ApiException(
          const AppFailure(
            AppErrorKind.validation,
            '"Mexico_City" is not a valid IANA timezone identifier (e.g. "America/Mexico_City").',
            code: 'validation_error',
          ),
        ),
      );
      await _pump(tester, gateway: gateway, permissions: _readWrite);

      await tester.tap(find.byKey(const Key('pos-branch-admin-new')));
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('pos-branch-admin-form-code')), 'SUR');
      await tester.enterText(find.byKey(const Key('pos-branch-admin-form-name')), 'Sucursal Sur');
      await tester.enterText(find.byKey(const Key('pos-branch-admin-form-timezone')), 'Mexico_City');
      await tester.tap(find.byKey(const Key('pos-branch-admin-form-name')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-branch-admin-form-save')));
      await tester.pumpAndSettle();

      expect(
        find.text('"Mexico_City" is not a valid IANA timezone identifier (e.g. "America/Mexico_City").'),
        findsOneWidget,
      );
    });
  });

  group('TASK 15.1 — create (blank fields, status field)', () {
    testWidgets('blank required fields are rejected client-side — no gateway call at all', (tester) async {
      final gateway = _RecordingBranchAdminGateway(seed: const []);
      await _pump(tester, gateway: gateway, permissions: _readWrite);

      await tester.tap(find.byKey(const Key('pos-branch-admin-new')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-branch-admin-form-save')));
      await tester.pump();

      expect(find.text('Código, nombre y zona horaria son obligatorios.'), findsOneWidget);
      expect(gateway.createCalls, isEmpty);
    });

    testWidgets('the create dialog never shows an Estado field — creation always starts active', (tester) async {
      final gateway = _RecordingBranchAdminGateway(seed: const []);
      await _pump(tester, gateway: gateway, permissions: _readWrite);

      await tester.tap(find.byKey(const Key('pos-branch-admin-new')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('pos-branch-admin-form-status')), findsNothing);
    });
  });

  group('TASK 15.1 — edit', () {
    testWidgets('editing an existing branch calls updateBranch with the edited fields and refreshes the detail', (
      tester,
    ) async {
      final gateway = _RecordingBranchAdminGateway(
        seed: [_fixtureBranch(id: 'b-1', code: 'CENTRO', name: 'Sucursal Centro')],
      );
      await _pump(tester, gateway: gateway, permissions: _readWrite);

      await tester.tap(find.byKey(const Key('pos-branch-admin-row-b-1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-branch-admin-detail-edit')));
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('pos-branch-admin-form-name')), 'Sucursal Centro Renovada');
      await tester.tap(find.byKey(const Key('pos-branch-admin-form-status')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Inactiva').last);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-branch-admin-form-save')));
      await tester.pumpAndSettle();

      expect(gateway.updateCalls, hasLength(1));
      expect(gateway.updateCalls.single.id, 'b-1');
      expect(gateway.updateCalls.single.input.name, 'Sucursal Centro Renovada');
      expect(gateway.updateCalls.single.input.status, 'inactive');
      expect(find.text('Sucursal Centro Renovada'), findsOneWidget);
      expect(find.text('Inactiva'), findsWidgets);

      await tester.tap(find.byKey(const Key('pos-branch-admin-detail-close')));
      await tester.pumpAndSettle();

      expect(gateway.items.single.status, 'inactive');
    });
  });

  group('TASK 15.1 — permission gating', () {
    testWidgets('no branch.read at all shows the honest permission state, no list/create, no gateway call', (
      tester,
    ) async {
      final gateway = _RecordingBranchAdminGateway(seed: [_fixtureBranch(id: 'b-1', code: 'CENTRO', name: 'Sucursal Centro')]);
      await _pump(tester, gateway: gateway, permissions: const []);

      expect(find.byKey(const Key('pos-branch-admin-new')), findsNothing);
      expect(find.byKey(const Key('pos-branch-admin-row-b-1')), findsNothing);
      expect(find.textContaining('branch.read'), findsOneWidget);
      expect(gateway.listCalls, isEmpty);
    });

    testWidgets(
      'branch.read without branch.create: "Nueva" stays visible-but-disabled with an explanatory Tooltip',
      (tester) async {
        final gateway = _RecordingBranchAdminGateway(seed: const []);
        await _pump(tester, gateway: gateway, permissions: _readOnly);

        final newButton = tester.widget<FilledButton>(find.byKey(const Key('pos-branch-admin-new')));
        expect(newButton.onPressed, isNull);
        final newTooltip = tester.widget<Tooltip>(
          find.ancestor(of: find.byKey(const Key('pos-branch-admin-new')), matching: find.byType(Tooltip)),
        );
        expect(newTooltip.message, contains('branch.create'));
        expect(gateway.createCalls, isEmpty);
      },
    );

    testWidgets(
      'branch.read without branch.update: "Editar" stays visible-but-disabled in the detail dialog',
      (tester) async {
        final gateway = _RecordingBranchAdminGateway(
          seed: [_fixtureBranch(id: 'b-1', code: 'CENTRO', name: 'Sucursal Centro')],
        );
        await _pump(tester, gateway: gateway, permissions: _readOnly);

        await tester.tap(find.byKey(const Key('pos-branch-admin-row-b-1')));
        await tester.pumpAndSettle();

        final editButton = tester.widget<OutlinedButton>(find.byKey(const Key('pos-branch-admin-detail-edit')));
        expect(editButton.onPressed, isNull);
        final editTooltip = tester.widget<Tooltip>(
          find.ancestor(of: find.byKey(const Key('pos-branch-admin-detail-edit')), matching: find.byType(Tooltip)),
        );
        expect(editTooltip.message, contains('branch.update'));
        expect(gateway.updateCalls, isEmpty);
      },
    );
  });
}

PosBranch _fixtureBranch({required String id, required String code, required String name, String status = 'active'}) =>
    PosBranch(
      id: id,
      companyId: 'company-id',
      code: code,
      name: name,
      status: status,
      timezone: 'America/Mexico_City',
      createdAt: DateTime.utc(2026, 8, 1),
      updatedAt: DateTime.utc(2026, 8, 1),
    );

class _RecordingBranchAdminGateway implements PosBranchAdminGateway {
  _RecordingBranchAdminGateway({List<PosBranch>? seed, this.failOnList = false, this.createFailure})
    : items = List.of(seed ?? const []);

  final List<PosBranch> items;
  final bool failOnList;
  // TASK 16.8B — simulates the real backend's own `validation_error`
  // rejection (`AdministrationService.createBranch`'s `requireValidTimezone`
  // guard) so this file can prove the honest server-side error message
  // reaches the form's `_error` state exactly like every other rejection
  // already does here — the server remains authoritative even though the
  // Flutter picker already only offers real IANA values.
  final ApiException? createFailure;
  final List<String> listCalls = [];
  final List<({String companyId, PosBranchInput input})> createCalls = [];
  final List<({String id, PosBranchInput input})> updateCalls = [];
  int _autoId = 100;

  @override
  Future<List<PosBranch>> listBranches({required String companyId}) async {
    listCalls.add(companyId);
    if (failOnList) {
      throw ApiException(
        const AppFailure(AppErrorKind.unknown, 'Fallo simulado al listar sucursales.', code: 'internal_error'),
      );
    }
    return List.of(items);
  }

  @override
  Future<PosBranch> createBranch({required String companyId, required PosBranchInput input}) async {
    createCalls.add((companyId: companyId, input: input));
    if (createFailure != null) throw createFailure!;
    final branch = PosBranch(
      id: 'branch-${_autoId++}',
      companyId: companyId,
      code: input.code!,
      name: input.name!,
      status: 'active',
      timezone: input.timezone!,
      createdAt: DateTime.utc(2026, 9, 1),
      updatedAt: DateTime.utc(2026, 9, 1),
    );
    items.add(branch);
    return branch;
  }

  @override
  Future<PosBranch> branch(String branchId) async => items.firstWhere((branch) => branch.id == branchId);

  @override
  Future<PosBranch> updateBranch(String branchId, PosBranchInput input) async {
    updateCalls.add((id: branchId, input: input));
    final index = items.indexWhere((branch) => branch.id == branchId);
    final current = items[index];
    final updated = PosBranch(
      id: current.id,
      companyId: current.companyId,
      code: input.code ?? current.code,
      name: input.name ?? current.name,
      status: input.status ?? current.status,
      timezone: input.timezone ?? current.timezone,
      createdAt: current.createdAt,
      updatedAt: DateTime.utc(2026, 9, 2),
    );
    items[index] = updated;
    return updated;
  }
}

Future<void> _pump(
  WidgetTester tester, {
  required _RecordingBranchAdminGateway gateway,
  required List<String> permissions,
}) async {
  tester.view.physicalSize = const Size(1280, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: PosBranchAdminScreen(context: _context(permissions), branchAdminGateway: gateway),
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
