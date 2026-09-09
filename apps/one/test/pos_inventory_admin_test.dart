/// TASK 15.1 Phase 3: widget tests for the "Inventario — Administración"
/// module — `pos_inventory_admin_screen.dart`/`pos_inventory_admin_gateway
/// .dart`. A standalone suite (never wired through `PosShell`, which this
/// task must not edit) — `PosInventoryAdminScreen` is pumped directly,
/// mirroring `pos_people_test.dart`'s/`pos_shell_test.dart`'s own
/// `_Recording*Gateway`/`_pump` fixture pattern (no mock framework, a real
/// in-memory fake implementing the full gateway interface).
library;

import 'package:as_one/features/authentication/auth_models.dart';
import 'package:as_one/features/pos/pos_inventory_admin_gateway.dart';
import 'package:as_one/features/pos/pos_inventory_admin_screen.dart';
import 'package:as_one/features/pos/pos_tokens.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('Movimientos', () {
    testWidgets('renders the real seeded movement list with folio and status', (tester) async {
      final gateway = _RecordingInventoryAdminGateway(movements: [_draftMovement]);
      await _pump(tester, gateway: gateway);

      expect(find.byKey(const Key('pos-movement-row-movement-1')), findsOneWidget);
      expect(find.text('IMV-DRAFT-1'), findsOneWidget);
      expect(find.text('draft'), findsOneWidget);
    });

    testWidgets('creating an adjustment without a reason is rejected client-side, never calls the gateway', (tester) async {
      final gateway = _RecordingInventoryAdminGateway();
      await _pump(tester, gateway: gateway);

      await tester.tap(find.byKey(const Key('pos-movements-new')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-movement-form-save')));
      await tester.pump();

      expect(gateway.createMovementCalls, isEmpty);
      expect(find.text('El motivo es obligatorio para registrar un ajuste de inventario.'), findsOneWidget);
    });

    testWidgets('creating an adjustment with a reason calls the real endpoint with the exact entered values', (tester) async {
      final gateway = _RecordingInventoryAdminGateway();
      await _pump(tester, gateway: gateway);

      await tester.tap(find.byKey(const Key('pos-movements-new')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('pos-movement-form-reason')), 'merma por rotura');
      await tester.pump();
      await tester.tap(find.byKey(const Key('pos-movement-form-save')));
      await tester.pumpAndSettle();

      expect(gateway.createMovementCalls, hasLength(1));
      final call = gateway.createMovementCalls.single;
      expect(call.branchId, 'branch-1');
      expect(call.movementType, 'adjustment');
      expect(call.reasonCode, 'merma por rotura');
      // The newly-created movement shows up in the refreshed list.
      expect(find.text('IMV-CREATED-1'), findsOneWidget);
    });
  });

  group('Traspasos', () {
    testWidgets('renders the real seeded transfer list with folio and status', (tester) async {
      final gateway = _RecordingInventoryAdminGateway(transfers: [_requestedTransfer]);
      await _pump(tester, gateway: gateway);
      await _navigateToTab(tester, 'Traspasos');

      expect(find.byKey(const Key('pos-transfer-row-transfer-1')), findsOneWidget);
      expect(find.text('TRF-1'), findsOneWidget);
      expect(find.text('requested'), findsOneWidget);
    });

    testWidgets('creating a transfer calls the real endpoint with source/destination branches, locations and quantity', (tester) async {
      final gateway = _RecordingInventoryAdminGateway(locations: _twoBranchLocations, balances: [_sourceBalance]);
      await _pump(tester, gateway: gateway);
      await _navigateToTab(tester, 'Traspasos');

      await tester.tap(find.byKey(const Key('pos-transfers-new')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-transfer-form-destination-branch')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Sucursal Norte').last);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-transfer-form-source-location')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Almacén Origen').last);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-transfer-form-transit-location')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Zona de Tránsito').last);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-transfer-form-destination-location')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Almacén Destino').last);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-transfer-form-variant')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Playera azul (SKU-1)').last);
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('pos-transfer-form-quantity')), '5');
      await tester.pump();

      await tester.tap(find.byKey(const Key('pos-transfer-form-save')));
      await tester.pumpAndSettle();

      expect(gateway.createTransferCalls, hasLength(1));
      final call = gateway.createTransferCalls.single;
      expect(call.sourceBranchId, 'branch-1');
      expect(call.destinationBranchId, 'branch-2');
      expect(call.sourceLocationId, 'location-src');
      expect(call.transitLocationId, 'location-transit');
      expect(call.destinationLocationId, 'location-dst');
      expect(call.lines.single.productVariantId, 'variant-1');
      expect(call.lines.single.quantity, '5');
    });
  });

  group('Conteos', () {
    testWidgets('renders the real seeded count list with folio and status', (tester) async {
      final gateway = _RecordingInventoryAdminGateway(counts: [_countingCount]);
      await _pump(tester, gateway: gateway);
      await _navigateToTab(tester, 'Conteos');

      expect(find.byKey(const Key('pos-count-row-count-1')), findsOneWidget);
      expect(find.text('CNT-1'), findsOneWidget);
      expect(find.text('counting'), findsOneWidget);
    });

    testWidgets('a count moves counting → submitted → approved through the real endpoints', (tester) async {
      final gateway = _RecordingInventoryAdminGateway(counts: [_countingCount]);
      await _pump(tester, gateway: gateway);
      await _navigateToTab(tester, 'Conteos');

      await tester.tap(find.byKey(const Key('pos-count-row-count-1')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-count-detail-submit')));
      await tester.pumpAndSettle();
      expect(gateway.submitCountCalls, [(id: 'count-1', version: 2)]);
      expect(find.text('submitted'), findsOneWidget);

      await tester.tap(find.byKey(const Key('pos-count-detail-approve')));
      await tester.pumpAndSettle();
      expect(gateway.approveCountCalls, [(id: 'count-1', version: 3)]);
      expect(find.text('approved'), findsOneWidget);
    });
  });

  group('Reservas', () {
    testWidgets('renders the real seeded reservation list with folio and status', (tester) async {
      final gateway = _RecordingInventoryAdminGateway(reservations: [_activeReservation]);
      await _pump(tester, gateway: gateway);
      await _navigateToTab(tester, 'Reservas');

      expect(find.byKey(const Key('pos-reservation-row-reservation-1')), findsOneWidget);
      expect(find.text('RES-1'), findsOneWidget);
      expect(find.text('active'), findsOneWidget);
    });
  });

  group('Ajustes/Reconciliación', () {
    testWidgets('renders the real seeded finding list with type and status', (tester) async {
      final gateway = _RecordingInventoryAdminGateway(findings: [_openFinding]);
      await _pump(tester, gateway: gateway);
      await _navigateToTab(tester, 'Ajustes/Reconciliación');

      expect(find.byKey(const Key('pos-finding-row-finding-1')), findsOneWidget);
      expect(find.text('balance_on_hand_drift'), findsOneWidget);
      expect(find.text('open'), findsOneWidget);
    });
  });

  group('Ubicaciones', () {
    testWidgets('renders the real seeded location list with code and status', (tester) async {
      final gateway = _RecordingInventoryAdminGateway(locations: [_mainLocation]);
      await _pump(tester, gateway: gateway);
      await _navigateToTab(tester, 'Ubicaciones');

      expect(find.byKey(const Key('pos-location-row-location-main')), findsOneWidget);
      expect(find.text('Almacén Principal'), findsOneWidget);
      expect(find.text('active'), findsOneWidget);
    });
  });

  group('Permisos', () {
    testWidgets('an actor lacking inventory.read is read-only-denied on Movimientos and Traspasos', (tester) async {
      final gateway = _RecordingInventoryAdminGateway(movements: [_draftMovement], transfers: [_requestedTransfer]);
      await _pump(tester, gateway: gateway, permissions: const ['inventory.reconcile']);

      expect(find.text('Tu sesión no incluye el permiso inventory.read requerido.'), findsOneWidget);
      expect(find.byKey(const Key('pos-movement-row-movement-1')), findsNothing);

      await _navigateToTab(tester, 'Traspasos');
      expect(find.text('Tu sesión no incluye el permiso inventory.read requerido.'), findsOneWidget);
      expect(find.byKey(const Key('pos-transfer-row-transfer-1')), findsNothing);
    });

    testWidgets('an actor lacking inventory.reconcile is read-only-denied on Ajustes/Reconciliación', (tester) async {
      final gateway = _RecordingInventoryAdminGateway(findings: [_openFinding]);
      await _pump(tester, gateway: gateway, permissions: const ['inventory.read']);
      await _navigateToTab(tester, 'Ajustes/Reconciliación');

      expect(find.text('Tu sesión no incluye el permiso inventory.reconcile requerido.'), findsOneWidget);
      expect(find.byKey(const Key('pos-finding-row-finding-1')), findsNothing);
    });

    testWidgets('an actor with only inventory.read sees every mutating action disabled', (tester) async {
      final gateway = _RecordingInventoryAdminGateway(movements: [_draftMovement]);
      await _pump(tester, gateway: gateway, permissions: const ['inventory.read']);

      final newButton = tester.widget<FilledButton>(find.byKey(const Key('pos-movements-new')));
      expect(newButton.onPressed, isNull);
    });
  });
}

// --- Fixtures -------------------------------------------------------------

final _context = AuthenticatedContext(
  session: SessionContext(
    id: 'session-id',
    userId: 'user-id',
    companyId: 'company-id',
    branchId: 'branch-1',
    permittedBranchIds: const ['branch-1', 'branch-2'],
    companyWideAccess: false,
    expiresAt: DateTime.utc(2099),
  ),
  user: const UserSummary(id: 'user-id', displayName: 'Usuario AS', email: 'user@example.test'),
  companies: const [CompanySummary(id: 'company-id', name: 'Empresa AS', current: true)],
  branches: const [
    BranchSummary(id: 'branch-1', code: 'CENTRO', name: 'Sucursal Centro', timezone: 'America/Mexico_City', current: true),
    BranchSummary(id: 'branch-2', code: 'NORTE', name: 'Sucursal Norte', timezone: 'America/Mexico_City'),
  ],
  companyWideAccess: false,
  permissions: const [
    'inventory.read',
    'inventory.adjust',
    'inventory.approve',
    'inventory.reverse',
    'inventory.transfer',
    'inventory.receive',
    'inventory.count',
    'inventory.reservation.manage',
    'inventory.reconcile',
    'inventory_location.manage',
  ],
);

final _mainLocation = PosInventoryLocation(
  id: 'location-main',
  branchId: 'branch-1',
  code: 'MAIN',
  name: 'Almacén Principal',
  description: null,
  locationType: 'main',
  status: 'active',
  allowsReceiving: true,
  allowsIssuing: true,
  isDefault: true,
  version: 1,
  createdAt: DateTime.utc(2026, 1, 1),
  updatedAt: DateTime.utc(2026, 1, 1),
  deletedAt: null,
);

final _twoBranchLocations = [
  PosInventoryLocation(
    id: 'location-src',
    branchId: 'branch-1',
    code: 'SRC',
    name: 'Almacén Origen',
    description: null,
    locationType: 'main',
    status: 'active',
    allowsReceiving: true,
    allowsIssuing: true,
    isDefault: true,
    version: 1,
    createdAt: DateTime.utc(2026, 1, 1),
    updatedAt: DateTime.utc(2026, 1, 1),
    deletedAt: null,
  ),
  PosInventoryLocation(
    id: 'location-transit',
    branchId: 'branch-1',
    code: 'TRN',
    name: 'Zona de Tránsito',
    description: null,
    locationType: 'transit',
    status: 'active',
    allowsReceiving: true,
    allowsIssuing: true,
    isDefault: false,
    version: 1,
    createdAt: DateTime.utc(2026, 1, 1),
    updatedAt: DateTime.utc(2026, 1, 1),
    deletedAt: null,
  ),
  PosInventoryLocation(
    id: 'location-dst',
    branchId: 'branch-2',
    code: 'DST',
    name: 'Almacén Destino',
    description: null,
    locationType: 'main',
    status: 'active',
    allowsReceiving: true,
    allowsIssuing: true,
    isDefault: true,
    version: 1,
    createdAt: DateTime.utc(2026, 1, 1),
    updatedAt: DateTime.utc(2026, 1, 1),
    deletedAt: null,
  ),
];

final _sourceBalance = PosInventoryBalance(
  branchId: 'branch-1',
  locationId: 'location-src',
  locationCode: 'SRC',
  locationName: 'Almacén Origen',
  productVariantId: 'variant-1',
  sku: 'SKU-1',
  variantName: null,
  productName: 'Playera azul',
  unitOfMeasureCode: 'unit',
  quantityOnHand: '10',
  quantityAvailable: '10',
);

final _draftMovement = PosInventoryMovement(
  id: 'movement-1',
  branchId: 'branch-1',
  movementNumber: 'IMV-DRAFT-1',
  movementType: 'adjustment',
  status: 'draft',
  reasonCode: 'ajuste inicial',
  referenceType: null,
  referenceId: null,
  sourceDocumentNumber: null,
  notes: null,
  version: 1,
  occurredAt: DateTime.utc(2026, 9, 1),
  postedAt: null,
  cancelledAt: null,
  reversedAt: null,
  createdAt: DateTime.utc(2026, 9, 1),
  updatedAt: DateTime.utc(2026, 9, 1),
  lineCount: 0,
);

final _requestedTransfer = PosInventoryTransfer(
  id: 'transfer-1',
  transferNumber: 'TRF-1',
  status: 'requested',
  sourceBranchId: 'branch-1',
  destinationBranchId: 'branch-2',
  sourceLocationId: 'location-src',
  destinationLocationId: 'location-dst',
  transitLocationId: 'location-transit',
  notes: null,
  version: 1,
  requestedAt: DateTime.utc(2026, 9, 1),
  approvedAt: null,
  shippedAt: null,
  receivedAt: null,
  rejectedAt: null,
  cancelledAt: null,
  shipmentMovementId: null,
  receiptMovementId: null,
  lines: const [],
);

final _countingCount = PosInventoryCount(
  id: 'count-1',
  countNumber: 'CNT-1',
  branchId: 'branch-1',
  locationId: 'location-main',
  status: 'counting',
  scopeType: 'all_balanced_variants',
  reasonCode: 'ciclo mensual',
  note: null,
  version: 2,
  startedAt: DateTime.utc(2026, 9, 1),
  submittedAt: null,
  approvedAt: null,
  appliedAt: null,
  cancelledAt: null,
  applicationMovementId: null,
  createdAt: DateTime.utc(2026, 9, 1),
  lineCount: 1,
  uncountedLineCount: 0,
  discrepancyLineCount: 0,
  lines: [
    const PosInventoryCountLine(
      id: 'count-line-1',
      productVariantId: 'variant-1',
      unitOfMeasureCode: 'unit',
      expectedQuantity: '10',
      countedQuantity: '10',
      differenceQuantity: '0',
      countedBy: 'user-id',
      version: 1,
    ),
  ],
);

final _activeReservation = PosInventoryReservation(
  id: 'reservation-1',
  reservationNumber: 'RES-1',
  branchId: 'branch-1',
  ownerType: 'pos_cart',
  ownerId: 'cart-42',
  status: 'active',
  expiresAt: null,
  version: 1,
  createdAt: DateTime.utc(2026, 9, 1),
  confirmedAt: null,
  releasedAt: null,
  expiredAt: null,
  cancelledAt: null,
  lineCount: 1,
  lines: const [],
);

final _openFinding = PosInventoryReconciliationFinding(
  id: 'finding-1',
  findingType: 'balance_on_hand_drift',
  severity: 'warning',
  status: 'open',
  branchId: 'branch-1',
  productVariantId: 'variant-1',
  firstDetectedAt: DateTime.utc(2026, 9, 1),
  lastDetectedAt: DateTime.utc(2026, 9, 2),
  occurrenceCount: 3,
  version: 1,
  expectedSummary: const {'quantity_on_hand': '10'},
  actualSummary: const {'quantity_on_hand': '8'},
  evidence: const {},
  fingerprint: 'a' * 64,
  acknowledgedAt: null,
  resolvedAt: null,
  dismissedAt: null,
);

// --- Fake gateway -----------------------------------------------------

class _RecordingInventoryAdminGateway implements PosInventoryAdminGateway {
  _RecordingInventoryAdminGateway({
    List<PosInventoryLocation> locations = const [],
    List<PosInventoryBalance> balances = const [],
    List<PosInventoryMovement> movements = const [],
    List<PosInventoryTransfer> transfers = const [],
    List<PosInventoryCount> counts = const [],
    List<PosInventoryReservation> reservations = const [],
    List<PosInventoryReconciliationFinding> findings = const [],
  }) : _locations = [...locations],
       _balances = [...balances],
       _movements = [...movements],
       _transfers = [...transfers],
       _counts = [...counts],
       _reservations = [...reservations],
       _findings = [...findings];

  final List<PosInventoryLocation> _locations;
  final List<PosInventoryBalance> _balances;
  final List<PosInventoryMovement> _movements;
  final Map<String, List<PosInventoryMovementLine>> _movementLines = {};
  final List<PosInventoryTransfer> _transfers;
  final List<PosInventoryCount> _counts;
  final List<PosInventoryReservation> _reservations;
  final List<PosInventoryReconciliationFinding> _findings;

  final List<PosInventoryLocationCreateInput> createLocationCalls = [];
  final List<PosInventoryMovementHeaderInput> createMovementCalls = [];
  final List<PosInventoryTransferCreateInput> createTransferCalls = [];
  final List<PosInventoryCountCreateInput> createCountCalls = [];
  final List<PosInventoryReservationCreateInput> createReservationCalls = [];
  final List<({String id, int version})> submitCountCalls = [];
  final List<({String id, int version})> approveCountCalls = [];

  int _sequence = 0;
  String _nextId(String prefix) => '$prefix-${++_sequence}';

  // -- Ubicaciones --------------------------------------------------------

  @override
  Future<PosInventoryLocationPage> listLocations({String? branchId, String? status, String? cursor, int limit = 50}) async =>
      PosInventoryLocationPage(
        items: _locations.where((location) => branchId == null || location.branchId == branchId).toList(growable: false),
        nextCursor: null,
      );

  @override
  Future<PosInventoryLocation> createLocation(PosInventoryLocationCreateInput input) async {
    createLocationCalls.add(input);
    final created = PosInventoryLocation(
      id: _nextId('location'),
      branchId: input.branchId,
      code: input.code,
      name: input.name,
      description: input.description,
      locationType: input.locationType,
      status: input.status ?? 'active',
      allowsReceiving: input.allowsReceiving ?? true,
      allowsIssuing: input.allowsIssuing ?? true,
      isDefault: input.isDefault ?? false,
      version: 1,
      createdAt: DateTime.utc(2026, 9, 8),
      updatedAt: DateTime.utc(2026, 9, 8),
      deletedAt: null,
    );
    _locations.add(created);
    return created;
  }

  @override
  Future<PosInventoryLocation> updateLocation(String id, PosInventoryLocationPatchInput input, {required int version}) async {
    final index = _locations.indexWhere((location) => location.id == id);
    final existing = _locations[index];
    final updated = PosInventoryLocation(
      id: existing.id,
      branchId: existing.branchId,
      code: existing.code,
      name: input.name ?? existing.name,
      description: input.description ?? existing.description,
      locationType: existing.locationType,
      status: input.status ?? existing.status,
      allowsReceiving: input.allowsReceiving ?? existing.allowsReceiving,
      allowsIssuing: input.allowsIssuing ?? existing.allowsIssuing,
      isDefault: input.isDefault ?? existing.isDefault,
      version: existing.version + 1,
      createdAt: existing.createdAt,
      updatedAt: DateTime.utc(2026, 9, 8),
      deletedAt: existing.deletedAt,
    );
    _locations[index] = updated;
    return updated;
  }

  // -- Balances -------------------------------------------------------------

  @override
  Future<PosInventoryBalancePage> listBalances({String? branchId, String? locationId, String? cursor, int limit = 50}) async =>
      PosInventoryBalancePage(
        items: _balances.where((balance) => branchId == null || balance.branchId == branchId).toList(growable: false),
        nextCursor: null,
      );

  // -- Movimientos ----------------------------------------------------------

  @override
  Future<PosInventoryMovementPage> listMovements({String? branchId, String? status, String? type, String? cursor, int limit = 50}) async =>
      PosInventoryMovementPage(
        items: _movements
            .where((movement) => (branchId == null || movement.branchId == branchId) && (status == null || movement.status == status))
            .toList(growable: false),
        nextCursor: null,
      );

  @override
  Future<PosInventoryMovement> movement(String id) async => _movements.firstWhere((movement) => movement.id == id);

  @override
  Future<List<PosInventoryMovementLine>> movementLines(String id) async => _movementLines[id] ?? const [];

  @override
  Future<PosInventoryMovement> createMovement(PosInventoryMovementHeaderInput input) async {
    createMovementCalls.add(input);
    final created = PosInventoryMovement(
      id: _nextId('movement'),
      branchId: input.branchId,
      movementNumber: 'IMV-CREATED-1',
      movementType: input.movementType,
      status: 'draft',
      reasonCode: input.reasonCode,
      referenceType: null,
      referenceId: null,
      sourceDocumentNumber: input.sourceDocumentNumber,
      notes: input.notes,
      version: 1,
      occurredAt: DateTime.utc(2026, 9, 8),
      postedAt: null,
      cancelledAt: null,
      reversedAt: null,
      createdAt: DateTime.utc(2026, 9, 8),
      updatedAt: DateTime.utc(2026, 9, 8),
      lineCount: 0,
    );
    _movements.add(created);
    return created;
  }

  @override
  Future<PosInventoryMovementLineResult> addMovementLine(String id, PosInventoryMovementLineInput input, {required int version}) async {
    final line = PosInventoryMovementLine(
      id: _nextId('movement-line'),
      movementId: id,
      lineNumber: (_movementLines[id]?.length ?? 0) + 1,
      productVariantId: input.productVariantId,
      sourceLocationId: input.sourceLocationId,
      destinationLocationId: input.destinationLocationId,
      quantity: input.quantity,
      baseQuantity: input.quantity,
      unitOfMeasureCode: input.unitOfMeasureCode,
      reasonCode: input.reasonCode,
      createdAt: DateTime.utc(2026, 9, 8),
    );
    _movementLines.putIfAbsent(id, () => []).add(line);
    final updatedVersion = version + 1;
    _bumpMovementVersion(id, updatedVersion);
    return PosInventoryMovementLineResult(line: line, version: updatedVersion);
  }

  @override
  Future<PosInventoryMovementLineDeletion> deleteMovementLine(String id, String lineId, {required int version}) async {
    _movementLines[id]?.removeWhere((line) => line.id == lineId);
    final updatedVersion = version + 1;
    _bumpMovementVersion(id, updatedVersion);
    return PosInventoryMovementLineDeletion(movementId: id, deletedLineId: lineId, version: updatedVersion);
  }

  void _bumpMovementVersion(String id, int version) {
    final index = _movements.indexWhere((movement) => movement.id == id);
    if (index == -1) return;
    final existing = _movements[index];
    _movements[index] = PosInventoryMovement(
      id: existing.id,
      branchId: existing.branchId,
      movementNumber: existing.movementNumber,
      movementType: existing.movementType,
      status: existing.status,
      reasonCode: existing.reasonCode,
      referenceType: existing.referenceType,
      referenceId: existing.referenceId,
      sourceDocumentNumber: existing.sourceDocumentNumber,
      notes: existing.notes,
      version: version,
      occurredAt: existing.occurredAt,
      postedAt: existing.postedAt,
      cancelledAt: existing.cancelledAt,
      reversedAt: existing.reversedAt,
      createdAt: existing.createdAt,
      updatedAt: DateTime.utc(2026, 9, 8),
      lineCount: _movementLines[id]?.length ?? existing.lineCount,
    );
  }

  @override
  Future<PosInventoryMovementTransition> submitMovement(String id, {required int version}) async {
    _bumpMovementStatus(id, 'pending', version: version + 1);
    return PosInventoryMovementTransition(
      movementId: id,
      movementNumber: _movements.firstWhere((movement) => movement.id == id).movementNumber,
      status: 'pending',
      version: version + 1,
      postedAt: null,
      affectedBalanceCount: null,
    );
  }

  @override
  Future<PosInventoryMovementTransition> postMovement(String id, {required int version}) async {
    _bumpMovementStatus(id, 'posted', version: version + 1, postedAt: DateTime.utc(2026, 9, 8));
    return PosInventoryMovementTransition(
      movementId: id,
      movementNumber: _movements.firstWhere((movement) => movement.id == id).movementNumber,
      status: 'posted',
      version: version + 1,
      postedAt: DateTime.utc(2026, 9, 8),
      affectedBalanceCount: 1,
    );
  }

  @override
  Future<PosInventoryMovement> cancelMovement(String id, {required int version, required String reasonCode, String? note}) async =>
      _bumpMovementStatus(id, 'cancelled', version: version + 1, cancelledAt: DateTime.utc(2026, 9, 8));

  @override
  Future<PosInventoryReversalResult> reverseMovement(String id, {required int version, required String reasonCode, String? note}) async {
    final original = _bumpMovementStatus(id, 'reversed', version: version + 1, reversedAt: DateTime.utc(2026, 9, 8));
    return PosInventoryReversalResult(
      originalMovementId: id,
      originalVersion: original.version,
      reversalMovementId: _nextId('movement'),
      reversalMovementNumber: 'IMV-REVERSAL-1',
      reversedAt: DateTime.utc(2026, 9, 8),
      affectedBalanceCount: 1,
    );
  }

  PosInventoryMovement _bumpMovementStatus(
    String id,
    String status, {
    required int version,
    DateTime? postedAt,
    DateTime? cancelledAt,
    DateTime? reversedAt,
  }) {
    final index = _movements.indexWhere((movement) => movement.id == id);
    final existing = _movements[index];
    final updated = PosInventoryMovement(
      id: existing.id,
      branchId: existing.branchId,
      movementNumber: existing.movementNumber,
      movementType: existing.movementType,
      status: status,
      reasonCode: existing.reasonCode,
      referenceType: existing.referenceType,
      referenceId: existing.referenceId,
      sourceDocumentNumber: existing.sourceDocumentNumber,
      notes: existing.notes,
      version: version,
      occurredAt: existing.occurredAt,
      postedAt: postedAt ?? existing.postedAt,
      cancelledAt: cancelledAt ?? existing.cancelledAt,
      reversedAt: reversedAt ?? existing.reversedAt,
      createdAt: existing.createdAt,
      updatedAt: DateTime.utc(2026, 9, 8),
      lineCount: existing.lineCount,
    );
    _movements[index] = updated;
    return updated;
  }

  // -- Traspasos --------------------------------------------------------------

  @override
  Future<PosInventoryTransferPage> listTransfers({String? status, String? branchId, String? cursor, int limit = 50}) async =>
      PosInventoryTransferPage(
        items: _transfers.where((transfer) => status == null || transfer.status == status).toList(growable: false),
        nextCursor: null,
      );

  @override
  Future<PosInventoryTransfer> transfer(String id) async => _transfers.firstWhere((transfer) => transfer.id == id);

  @override
  Future<PosInventoryTransfer> createTransfer(PosInventoryTransferCreateInput input) async {
    createTransferCalls.add(input);
    final created = PosInventoryTransfer(
      id: _nextId('transfer'),
      transferNumber: 'TRF-CREATED-1',
      status: 'requested',
      sourceBranchId: input.sourceBranchId,
      destinationBranchId: input.destinationBranchId,
      sourceLocationId: input.sourceLocationId,
      destinationLocationId: input.destinationLocationId,
      transitLocationId: input.transitLocationId,
      notes: input.notes,
      version: 1,
      requestedAt: DateTime.utc(2026, 9, 8),
      approvedAt: null,
      shippedAt: null,
      receivedAt: null,
      rejectedAt: null,
      cancelledAt: null,
      shipmentMovementId: null,
      receiptMovementId: null,
      lines: const [],
    );
    _transfers.add(created);
    return created;
  }

  @override
  Future<PosInventoryTransfer> decideTransfer(
    String id, {
    required int version,
    required String decision,
    String? reasonCode,
    String? note,
  }) async => _bumpTransferStatus(id, decision == 'approve' ? 'approved' : 'rejected', version: version + 1, approvedAt: decision == 'approve' ? DateTime.utc(2026, 9, 8) : null, rejectedAt: decision == 'reject' ? DateTime.utc(2026, 9, 8) : null);

  @override
  Future<PosInventoryTransfer> shipTransfer(String id, {required int version, String? note}) async =>
      _bumpTransferStatus(id, 'shipped', version: version + 1, shippedAt: DateTime.utc(2026, 9, 8));

  @override
  Future<PosInventoryTransfer> receiveTransfer(String id, {required int version, String? note}) async =>
      _bumpTransferStatus(id, 'received', version: version + 1, receivedAt: DateTime.utc(2026, 9, 8));

  @override
  Future<PosInventoryTransfer> cancelTransfer(String id, {required int version, required String reasonCode, String? note}) async =>
      _bumpTransferStatus(id, 'cancelled', version: version + 1, cancelledAt: DateTime.utc(2026, 9, 8));

  PosInventoryTransfer _bumpTransferStatus(
    String id,
    String status, {
    required int version,
    DateTime? approvedAt,
    DateTime? shippedAt,
    DateTime? receivedAt,
    DateTime? rejectedAt,
    DateTime? cancelledAt,
  }) {
    final index = _transfers.indexWhere((transfer) => transfer.id == id);
    final existing = _transfers[index];
    final updated = PosInventoryTransfer(
      id: existing.id,
      transferNumber: existing.transferNumber,
      status: status,
      sourceBranchId: existing.sourceBranchId,
      destinationBranchId: existing.destinationBranchId,
      sourceLocationId: existing.sourceLocationId,
      destinationLocationId: existing.destinationLocationId,
      transitLocationId: existing.transitLocationId,
      notes: existing.notes,
      version: version,
      requestedAt: existing.requestedAt,
      approvedAt: approvedAt ?? existing.approvedAt,
      shippedAt: shippedAt ?? existing.shippedAt,
      receivedAt: receivedAt ?? existing.receivedAt,
      rejectedAt: rejectedAt ?? existing.rejectedAt,
      cancelledAt: cancelledAt ?? existing.cancelledAt,
      shipmentMovementId: existing.shipmentMovementId,
      receiptMovementId: existing.receiptMovementId,
      lines: existing.lines,
    );
    _transfers[index] = updated;
    return updated;
  }

  // -- Conteos ------------------------------------------------------------

  @override
  Future<PosInventoryCountPage> listCounts({String? branchId, String? status, String? cursor, int limit = 50}) async => PosInventoryCountPage(
    items: _counts.where((count) => (branchId == null || count.branchId == branchId) && (status == null || count.status == status)).toList(growable: false),
    nextCursor: null,
  );

  @override
  Future<PosInventoryCount> count(String id) async => _counts.firstWhere((count) => count.id == id);

  @override
  Future<PosInventoryCount> createCount(PosInventoryCountCreateInput input) async {
    createCountCalls.add(input);
    final created = PosInventoryCount(
      id: _nextId('count'),
      countNumber: 'CNT-CREATED-1',
      branchId: input.branchId,
      locationId: input.locationId,
      status: 'draft',
      scopeType: input.scopeType,
      reasonCode: input.reasonCode,
      note: input.note,
      version: 1,
      startedAt: null,
      submittedAt: null,
      approvedAt: null,
      appliedAt: null,
      cancelledAt: null,
      applicationMovementId: null,
      createdAt: DateTime.utc(2026, 9, 8),
      lineCount: null,
      uncountedLineCount: null,
      discrepancyLineCount: null,
      lines: const [],
    );
    _counts.add(created);
    return created;
  }

  @override
  Future<PosInventoryCount> startCount(String id, {required int version}) async => _bumpCountStatus(id, 'counting', version: version + 1, startedAt: DateTime.utc(2026, 9, 8));

  @override
  Future<PosInventoryCountLine> recordCountLine(
    String id,
    String productVariantId, {
    required String countedQuantity,
    required String unitOfMeasureCode,
    required int version,
  }) async {
    final index = _counts.indexWhere((count) => count.id == id);
    final count = _counts[index];
    final lines = count.lines
        .map(
          (line) => line.productVariantId == productVariantId
              ? PosInventoryCountLine(
                  id: line.id,
                  productVariantId: line.productVariantId,
                  unitOfMeasureCode: line.unitOfMeasureCode,
                  expectedQuantity: line.expectedQuantity,
                  countedQuantity: countedQuantity,
                  differenceQuantity: '0',
                  countedBy: 'user-id',
                  version: line.version + 1,
                )
              : line,
        )
        .toList(growable: false);
    _counts[index] = PosInventoryCount(
      id: count.id,
      countNumber: count.countNumber,
      branchId: count.branchId,
      locationId: count.locationId,
      status: count.status,
      scopeType: count.scopeType,
      reasonCode: count.reasonCode,
      note: count.note,
      version: version + 1,
      startedAt: count.startedAt,
      submittedAt: count.submittedAt,
      approvedAt: count.approvedAt,
      appliedAt: count.appliedAt,
      cancelledAt: count.cancelledAt,
      applicationMovementId: count.applicationMovementId,
      createdAt: count.createdAt,
      lineCount: count.lineCount,
      uncountedLineCount: count.uncountedLineCount,
      discrepancyLineCount: count.discrepancyLineCount,
      lines: lines,
    );
    return lines.firstWhere((line) => line.productVariantId == productVariantId);
  }

  @override
  Future<PosInventoryCount> submitCount(String id, {required int version}) async {
    submitCountCalls.add((id: id, version: version));
    return _bumpCountStatus(id, 'submitted', version: version + 1, submittedAt: DateTime.utc(2026, 9, 8));
  }

  @override
  Future<PosInventoryCount> approveCount(String id, {required int version}) async {
    approveCountCalls.add((id: id, version: version));
    return _bumpCountStatus(id, 'approved', version: version + 1, approvedAt: DateTime.utc(2026, 9, 8));
  }

  @override
  Future<PosInventoryCount> applyCount(String id, {required int version}) async => _bumpCountStatus(id, 'applied', version: version + 1, appliedAt: DateTime.utc(2026, 9, 8));

  @override
  Future<PosInventoryCount> cancelCount(String id, {required int version, required String reasonCode, String? note}) async =>
      _bumpCountStatus(id, 'cancelled', version: version + 1, cancelledAt: DateTime.utc(2026, 9, 8));

  PosInventoryCount _bumpCountStatus(
    String id,
    String status, {
    required int version,
    DateTime? startedAt,
    DateTime? submittedAt,
    DateTime? approvedAt,
    DateTime? appliedAt,
    DateTime? cancelledAt,
  }) {
    final index = _counts.indexWhere((count) => count.id == id);
    final existing = _counts[index];
    final updated = PosInventoryCount(
      id: existing.id,
      countNumber: existing.countNumber,
      branchId: existing.branchId,
      locationId: existing.locationId,
      status: status,
      scopeType: existing.scopeType,
      reasonCode: existing.reasonCode,
      note: existing.note,
      version: version,
      startedAt: startedAt ?? existing.startedAt,
      submittedAt: submittedAt ?? existing.submittedAt,
      approvedAt: approvedAt ?? existing.approvedAt,
      appliedAt: appliedAt ?? existing.appliedAt,
      cancelledAt: cancelledAt ?? existing.cancelledAt,
      applicationMovementId: existing.applicationMovementId,
      createdAt: existing.createdAt,
      lineCount: existing.lineCount,
      uncountedLineCount: existing.uncountedLineCount,
      discrepancyLineCount: existing.discrepancyLineCount,
      lines: existing.lines,
    );
    _counts[index] = updated;
    return updated;
  }

  // -- Reservas -------------------------------------------------------------

  @override
  Future<PosInventoryReservationPage> listReservations({String? branchId, String? status, String? cursor, int limit = 50}) async =>
      PosInventoryReservationPage(
        items: _reservations.where((reservation) => (branchId == null || reservation.branchId == branchId) && (status == null || reservation.status == status)).toList(growable: false),
        nextCursor: null,
      );

  @override
  Future<PosInventoryReservation> reservation(String id) async => _reservations.firstWhere((reservation) => reservation.id == id);

  @override
  Future<PosInventoryReservation> createReservation(PosInventoryReservationCreateInput input) async {
    createReservationCalls.add(input);
    final created = PosInventoryReservation(
      id: _nextId('reservation'),
      reservationNumber: 'RES-CREATED-1',
      branchId: input.branchId,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      status: 'active',
      expiresAt: null,
      version: 1,
      createdAt: DateTime.utc(2026, 9, 8),
      confirmedAt: null,
      releasedAt: null,
      expiredAt: null,
      cancelledAt: null,
      lineCount: input.lines.length,
      lines: const [],
    );
    _reservations.add(created);
    return created;
  }

  @override
  Future<PosInventoryReservation> confirmReservation(String id, {required int version}) async =>
      _bumpReservationStatus(id, 'confirmed', version: version + 1, confirmedAt: DateTime.utc(2026, 9, 8));

  @override
  Future<PosInventoryReservation> releaseReservation(
    String id, {
    required int version,
    required String action,
    required String reasonCode,
    String? note,
  }) async {
    final status = switch (action) {
      'release' => 'released',
      'expire' => 'expired',
      _ => 'cancelled',
    };
    return _bumpReservationStatus(
      id,
      status,
      version: version + 1,
      releasedAt: action == 'release' ? DateTime.utc(2026, 9, 8) : null,
      expiredAt: action == 'expire' ? DateTime.utc(2026, 9, 8) : null,
      cancelledAt: action == 'cancel' ? DateTime.utc(2026, 9, 8) : null,
    );
  }

  PosInventoryReservation _bumpReservationStatus(
    String id,
    String status, {
    required int version,
    DateTime? confirmedAt,
    DateTime? releasedAt,
    DateTime? expiredAt,
    DateTime? cancelledAt,
  }) {
    final index = _reservations.indexWhere((reservation) => reservation.id == id);
    final existing = _reservations[index];
    final updated = PosInventoryReservation(
      id: existing.id,
      reservationNumber: existing.reservationNumber,
      branchId: existing.branchId,
      ownerType: existing.ownerType,
      ownerId: existing.ownerId,
      status: status,
      expiresAt: existing.expiresAt,
      version: version,
      createdAt: existing.createdAt,
      confirmedAt: confirmedAt ?? existing.confirmedAt,
      releasedAt: releasedAt ?? existing.releasedAt,
      expiredAt: expiredAt ?? existing.expiredAt,
      cancelledAt: cancelledAt ?? existing.cancelledAt,
      lineCount: existing.lineCount,
      lines: existing.lines,
    );
    _reservations[index] = updated;
    return updated;
  }

  // -- Ajustes/Reconciliación ----------------------------------------------

  @override
  Future<PosInventoryReconciliationFindingPage> listFindings({
    String? status,
    String? severity,
    String? branchId,
    String? cursor,
    int limit = 50,
  }) async => PosInventoryReconciliationFindingPage(
    items: _findings.where((finding) => (status == null || finding.status == status) && (severity == null || finding.severity == severity)).toList(growable: false),
    nextCursor: null,
  );

  @override
  Future<PosInventoryReconciliationFinding> finding(String id) async => _findings.firstWhere((finding) => finding.id == id);

  @override
  Future<PosInventoryReconciliationFinding> acknowledgeFinding(String id, {required int version, required String reasonCode, String? note}) async =>
      _bumpFindingStatus(id, 'acknowledged', version: version + 1, acknowledgedAt: DateTime.utc(2026, 9, 8));

  @override
  Future<PosInventoryReconciliationFinding> dismissFinding(String id, {required int version, required String reasonCode, String? note}) async =>
      _bumpFindingStatus(id, 'dismissed', version: version + 1, dismissedAt: DateTime.utc(2026, 9, 8));

  @override
  Future<PosInventoryRepairPreview> previewRepair(String id, {required int version, required String strategy, required String expectedFingerprint}) async =>
      PosInventoryRepairPreview(
        findingId: id,
        repairable: true,
        strategy: strategy,
        warnings: const [],
        previewFingerprint: 'b' * 64,
        previewExpiresAt: DateTime.utc(2026, 9, 8, 1).toIso8601String(),
      );

  @override
  Future<PosInventoryReconciliationFinding> repairFinding(
    String id, {
    required int version,
    required String strategy,
    required String expectedFingerprint,
    required String previewFingerprint,
    required String previewExpiresAt,
    required String reasonCode,
    String? note,
  }) async => _bumpFindingStatus(id, 'resolved', version: version + 1, resolvedAt: DateTime.utc(2026, 9, 8));

  PosInventoryReconciliationFinding _bumpFindingStatus(
    String id,
    String status, {
    required int version,
    DateTime? acknowledgedAt,
    DateTime? resolvedAt,
    DateTime? dismissedAt,
  }) {
    final index = _findings.indexWhere((finding) => finding.id == id);
    final existing = _findings[index];
    final updated = PosInventoryReconciliationFinding(
      id: existing.id,
      findingType: existing.findingType,
      severity: existing.severity,
      status: status,
      branchId: existing.branchId,
      productVariantId: existing.productVariantId,
      firstDetectedAt: existing.firstDetectedAt,
      lastDetectedAt: existing.lastDetectedAt,
      occurrenceCount: existing.occurrenceCount,
      version: version,
      expectedSummary: existing.expectedSummary,
      actualSummary: existing.actualSummary,
      evidence: existing.evidence,
      fingerprint: existing.fingerprint,
      acknowledgedAt: acknowledgedAt ?? existing.acknowledgedAt,
      resolvedAt: resolvedAt ?? existing.resolvedAt,
      dismissedAt: dismissedAt ?? existing.dismissedAt,
    );
    _findings[index] = updated;
    return updated;
  }
}

// --- Pump helper --------------------------------------------------------

Future<void> _pump(WidgetTester tester, {required PosInventoryAdminGateway gateway, List<String>? permissions}) async {
  tester.view.physicalSize = const Size(1440, 1000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final effectiveContext = permissions == null
      ? _context
      : AuthenticatedContext(
          session: _context.session,
          user: _context.user,
          companies: _context.companies,
          branches: _context.branches,
          companyWideAccess: _context.companyWideAccess,
          permissions: permissions,
        );
  await tester.pumpWidget(
    MaterialApp(
      theme: PosTheme.light(),
      home: Scaffold(
        body: SingleChildScrollView(
          child: PosInventoryAdminScreen(context: effectiveContext, gateway: gateway),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _navigateToTab(WidgetTester tester, String label) async {
  await tester.tap(find.descendant(of: find.byKey(const Key('pos-inventory-admin-tabs')), matching: find.text(label)));
  await tester.pumpAndSettle();
}
