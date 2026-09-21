/// TASK 16.15 — widget tests for `PosOperationalAreasScreen` ("Áreas
/// Operativas"): list rendering, the create flow, the edit/status-change
/// flow, the "Cajas asignadas" register-assignment toggle, and permission
/// gating (every mutating control stays visible-but-disabled with an
/// explanatory `Tooltip` when `operational_area.manage` is absent; the
/// whole screen shows an honest denial state without `operational_area
/// .read`, never calling the gateway). Uses real, in-memory recording fake
/// gateways — never a mock framework — mirroring `pos_branch_admin_test
/// .dart`'s own `_Recording*Gateway` fixture convention. Every area/
/// register name used here is a plain test fixture string, never a
/// hardcoded "real" tenant concept — this screen must never assume any
/// particular area name exists.
library;

import 'package:as_one/core/errors/app_error.dart';
import 'package:as_one/core/networking/api_client.dart';
import 'package:as_one/features/authentication/auth_models.dart';
import 'package:as_one/features/pos/pos_cash_gateway.dart';
import 'package:as_one/features/pos/pos_operational_areas_gateway.dart';
import 'package:as_one/features/pos/pos_operational_areas_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const _readOnly = ['operational_area.read'];
const _readWrite = ['operational_area.read', 'operational_area.manage'];

void main() {
  group('TASK 16.15 — list', () {
    testWidgets('renders the real fetched areas for the selected branch', (tester) async {
      final gateway = _RecordingAreasGateway(
        seed: [
          _fixtureArea(id: 'a-1', code: 'ZONA-1', name: 'Zona uno', branchId: 'branch-id'),
          _fixtureArea(id: 'a-2', code: 'ZONA-2', name: 'Zona dos', branchId: 'branch-id'),
        ],
      );
      await _pump(tester, gateway: gateway, permissions: _readOnly);

      expect(find.byKey(const Key('pos-operational-areas-row-a-1')), findsOneWidget);
      expect(find.byKey(const Key('pos-operational-areas-row-a-2')), findsOneWidget);
      expect(find.text('Zona uno'), findsOneWidget);
      expect(find.text('Zona dos'), findsOneWidget);
      expect(gateway.listCalls, hasLength(1));
      expect(gateway.listCalls.single.branchId, 'branch-id');
    });

    testWidgets('an empty gateway result renders the honest empty state, never a fabricated row', (tester) async {
      final gateway = _RecordingAreasGateway(seed: const []);
      await _pump(tester, gateway: gateway, permissions: _readOnly);

      expect(find.text('No hay áreas operativas registradas.'), findsOneWidget);
    });

    testWidgets('missing operational_area.read shows the honest permission state, never calls the gateway', (
      tester,
    ) async {
      final gateway = _RecordingAreasGateway(seed: const []);
      await _pump(tester, gateway: gateway, permissions: const []);

      expect(
        find.text('Tu sesión no incluye el permiso de lectura requerido (operational_area.read).'),
        findsOneWidget,
      );
      expect(gateway.listCalls, isEmpty);
    });

    testWidgets('a gateway failure renders the real error message with a retry control', (tester) async {
      final gateway = _RecordingAreasGateway(seed: const [], failOnList: true);
      await _pump(tester, gateway: gateway, permissions: _readOnly);

      expect(find.text('Fallo simulado al listar áreas.'), findsOneWidget);
      expect(find.text('Reintentar'), findsOneWidget);
    });
  });

  group('TASK 16.15 — create', () {
    testWidgets('a valid submit calls createArea with the real form values, scoped to the current branch', (
      tester,
    ) async {
      final gateway = _RecordingAreasGateway(seed: const []);
      await _pump(tester, gateway: gateway, permissions: _readWrite);

      await tester.tap(find.byKey(const Key('pos-operational-areas-new')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('pos-operational-areas-form-code')), 'NUEVA');
      await tester.enterText(find.byKey(const Key('pos-operational-areas-form-name')), 'Área nueva');
      await tester.tap(find.byKey(const Key('pos-operational-areas-form-save')));
      await tester.pumpAndSettle();

      expect(gateway.createCalls, hasLength(1));
      expect(gateway.createCalls.single.input.branchId, 'branch-id');
      expect(gateway.createCalls.single.input.code, 'NUEVA');
      expect(gateway.createCalls.single.input.name, 'Área nueva');
      expect(find.text('Área nueva'), findsOneWidget);
    });

    testWidgets('operational_area.manage absent leaves "Nueva" visible but disabled with an explanatory Tooltip', (
      tester,
    ) async {
      final gateway = _RecordingAreasGateway(seed: const []);
      await _pump(tester, gateway: gateway, permissions: _readOnly);

      final button = tester.widget<FilledButton>(find.byKey(const Key('pos-operational-areas-new')));
      expect(button.onPressed, isNull);
      final tooltip = tester.widget<Tooltip>(
        find.ancestor(of: find.byKey(const Key('pos-operational-areas-new')), matching: find.byType(Tooltip)),
      );
      expect(tooltip.message, 'Tu sesión no incluye el permiso operational_area.manage.');
    });
  });

  group('TASK 16.15 — edit/status', () {
    testWidgets('editing an existing area calls updateArea with its real version and the new status', (
      tester,
    ) async {
      final gateway = _RecordingAreasGateway(
        seed: [_fixtureArea(id: 'a-1', code: 'ZONA-1', name: 'Zona uno', branchId: 'branch-id', version: 3)],
      );
      await _pump(tester, gateway: gateway, permissions: _readWrite);

      await tester.tap(find.byKey(const Key('pos-operational-areas-row-a-1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-operational-areas-detail-edit')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('pos-operational-areas-form-name')), 'Zona uno renombrada');
      await tester.tap(find.byKey(const Key('pos-operational-areas-form-status')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Inactiva').last);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-operational-areas-form-save')));
      await tester.pumpAndSettle();

      expect(gateway.updateCalls, hasLength(1));
      expect(gateway.updateCalls.single.id, 'a-1');
      expect(gateway.updateCalls.single.version, 3);
      expect(gateway.updateCalls.single.input.name, 'Zona uno renombrada');
      expect(gateway.updateCalls.single.input.status, 'inactive');
    });
  });

  group('TASK 16.15 — cajas asignadas', () {
    testWidgets('checking a register calls assignOperationalArea with this area id and its own version', (
      tester,
    ) async {
      final gateway = _RecordingAreasGateway(
        seed: [_fixtureArea(id: 'a-1', code: 'ZONA-1', name: 'Zona uno', branchId: 'branch-id')],
      );
      final cashGateway = _RecordingCashGateway(
        registers: [
          const PosCashRegister(
            id: 'reg-1',
            branchId: 'branch-id',
            code: 'CAJA-1',
            name: 'Caja 1',
            status: 'active',
            version: 5,
          ),
        ],
      );
      await _pump(tester, gateway: gateway, cashGateway: cashGateway, permissions: _readWrite);

      await tester.tap(find.byKey(const Key('pos-operational-areas-row-a-1')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('pos-operational-areas-register-reg-1')), findsOneWidget);

      await tester.tap(find.byType(Checkbox));
      await tester.pumpAndSettle();

      expect(cashGateway.assignCalls, hasLength(1));
      expect(cashGateway.assignCalls.single.registerId, 'reg-1');
      expect(cashGateway.assignCalls.single.version, 5);
      expect(cashGateway.assignCalls.single.operationalAreaId, 'a-1');
    });
  });
}

Future<void> _pump(
  WidgetTester tester, {
  required _RecordingAreasGateway gateway,
  _RecordingCashGateway? cashGateway,
  required List<String> permissions,
}) async {
  tester.view.physicalSize = const Size(1280, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: PosOperationalAreasScreen(
          context: _context(permissions),
          gateway: gateway,
          cashGateway: cashGateway ?? const EmptyPosCashGateway(),
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
    BranchSummary(id: 'branch-id', code: 'CENTRO', name: 'Sucursal Centro', timezone: 'America/Mexico_City', current: true),
  ],
  companyWideAccess: false,
  permissions: permissions,
);

PosOperationalArea _fixtureArea({
  required String id,
  required String code,
  required String name,
  required String branchId,
  String status = 'active',
  int version = 1,
}) => PosOperationalArea(
  id: id,
  branchId: branchId,
  code: code,
  name: name,
  status: status,
  version: version,
  createdAt: DateTime.utc(2026, 1, 1),
  updatedAt: DateTime.utc(2026, 1, 1),
);

class _RecordingAreasGateway implements PosOperationalAreasGateway {
  _RecordingAreasGateway({List<PosOperationalArea>? seed, this.failOnList = false, this.createFailure})
    : items = List.of(seed ?? const []);

  final List<PosOperationalArea> items;
  final bool failOnList;
  final ApiException? createFailure;

  final List<({String? branchId, String? status, String? cursor})> listCalls = [];
  final List<({String companyId, PosOperationalAreaInput input})> createCalls = [];
  final List<({String id, int version, PosOperationalAreaInput input})> updateCalls = [];

  @override
  Future<PosOperationalAreaPage> listAreas({String? branchId, String? status, String? cursor, int limit = 50}) async {
    listCalls.add((branchId: branchId, status: status, cursor: cursor));
    if (failOnList) {
      throw const ApiException(AppFailure(AppErrorKind.unknown, 'Fallo simulado al listar áreas.'));
    }
    final filtered = items
        .where((area) => branchId == null || area.branchId == branchId)
        .where((area) => status == null || area.status == status)
        .toList(growable: false);
    return PosOperationalAreaPage(items: filtered, nextCursor: null);
  }

  @override
  Future<PosOperationalArea> createArea(PosOperationalAreaInput input) async {
    createCalls.add((companyId: 'company-id', input: input));
    if (createFailure != null) throw createFailure!;
    final created = PosOperationalArea(
      id: 'new-area-${createCalls.length}',
      branchId: input.branchId!,
      code: input.code!,
      name: input.name!,
      status: 'active',
      version: 1,
      createdAt: DateTime.utc(2026, 1, 1),
      updatedAt: DateTime.utc(2026, 1, 1),
    );
    items.add(created);
    return created;
  }

  @override
  Future<PosOperationalArea> area(String id) async => items.firstWhere((area) => area.id == id);

  @override
  Future<PosOperationalArea> updateArea(String id, int version, PosOperationalAreaInput input) async {
    updateCalls.add((id: id, version: version, input: input));
    final index = items.indexWhere((area) => area.id == id);
    final existing = items[index];
    final updated = PosOperationalArea(
      id: existing.id,
      branchId: existing.branchId,
      code: existing.code,
      name: input.name ?? existing.name,
      status: input.status ?? existing.status,
      version: existing.version + 1,
      createdAt: existing.createdAt,
      updatedAt: DateTime.utc(2026, 1, 2),
    );
    items[index] = updated;
    return updated;
  }
}

class _RecordingCashGateway implements PosCashGateway {
  _RecordingCashGateway({this.registers = const []});
  final List<PosCashRegister> registers;
  final List<({String registerId, int version, String? operationalAreaId})> assignCalls = [];

  @override
  Future<List<PosCashRegister>> registersForBranch(String branchId, {String? operationalAreaId}) async =>
      registers.where((r) => r.branchId == branchId).toList(growable: false);

  @override
  Future<PosCashRegister> assignOperationalArea(String registerId, int version, String? operationalAreaId) async {
    assignCalls.add((registerId: registerId, version: version, operationalAreaId: operationalAreaId));
    final index = registers.indexWhere((r) => r.id == registerId);
    return PosCashRegister(
      id: registers[index].id,
      branchId: registers[index].branchId,
      code: registers[index].code,
      name: registers[index].name,
      status: registers[index].status,
      operationalAreaId: operationalAreaId,
      version: version + 1,
    );
  }

  @override
  Future<PosCashRegister> createRegister({required String branchId, required String code, required String name}) =>
      Future.error(StateError('not used by these tests'));

  @override
  Future<PosCashSession> openSession({required String cashRegisterId, required String openingAmount}) =>
      Future.error(StateError('not used by these tests'));

  @override
  Future<PosCashSession?> currentSession(String cashRegisterId) async => null;

  @override
  Future<PosCashSession?> openSessionForBranch(String branchId) async => null;

  @override
  Future<PosCashSession> session(String cashSessionId) => Future.error(StateError('not used by these tests'));

  @override
  Future<PosCashSessionSummary> summary(String cashSessionId) => Future.error(StateError('not used by these tests'));

  @override
  Future<PosCashMovement> createMovement({
    required String cashSessionId,
    required String movementType,
    required String amount,
    required String reasonCode,
    String? note,
    String? category,
  }) => Future.error(StateError('not used by these tests'));

  @override
  Future<PosCashMovementPage> listMovements(String cashSessionId, {String? cursor, int limit = 50}) async =>
      const PosCashMovementPage(items: [], nextCursor: null);

  @override
  Future<PosCashSession> closeSession({
    required String cashSessionId,
    required String declaredClosingAmount,
    List<PosCashDenominationCount>? denominationCounts,
    String? discrepancyReason,
    List<PosCashCardReconciliationEntry>? cardReconciliationEntries,
    String? cardReconciliationNote,
  }) => Future.error(StateError('not used by these tests'));

  @override
  Future<PosCashSessionHistoryPage> listSessions({
    PosCashSessionHistoryFilter filter = const PosCashSessionHistoryFilter(),
    String? cursor,
    int limit = 50,
  }) async => const PosCashSessionHistoryPage(items: [], nextCursor: null);

  @override
  Future<PosCashSessionPartialClose> partialCloseSession(String cashSessionId) =>
      Future.error(StateError('not used by these tests'));

  @override
  Future<List<PosCashSessionPartialClose>> listPartialCloses(String cashSessionId) async => const [];

  @override
  Future<PosCashMovement> reverseMovement({
    required String cashSessionId,
    required String movementId,
    required String reasonCode,
    String? note,
  }) => Future.error(StateError('not used by these tests'));

  @override
  Future<List<PosCashAuditEntry>> auditLog(String cashSessionId, {int limit = 100}) async => const [];
}
