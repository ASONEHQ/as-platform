/// TASK 14.5 (Wave 3, Phase 3): widget tests for the "Pulseras NFC" section
/// added to `PosAccessScreen` — the real NFC wristband lifecycle recovered
/// from the legacy (`AS POS V1.html`'s `DB.pulseras` +
/// `activarPulsera`/`bloquearPulsera`/`desbloquearPulsera`; see
/// `pos_access_gateway.dart`'s own doc comment for the full forensic
/// citation, including why "extend" is deliberately absent). A new sibling
/// file per this task's own instruction (never touching
/// `pos_access_test.dart`'s own existing test bodies — only its
/// `_FakeAccessGateway` fixture needed additive fields to keep compiling
/// against the extended `PosAccessGateway` interface).
///
/// Pumps `PosAccessScreen` directly (mirrors `pos_access_test.dart`'s own
/// `_pump` fixture pattern), with a small local recording fake gateway.
/// Every assertion checks something a fabricated/generic-error UI could
/// NOT honestly produce: a wristband activation that calls the real
/// `activateWristband` gateway method (never `issueCredential`'s
/// server-generated-code path), a lookup result that shows the server's
/// own real status/kind, and a block/unblock toggle that always reflects
/// what the gateway actually returned — never an assumed client-side flip.
library;

import 'package:as_one/core/errors/app_error.dart';
import 'package:as_one/core/networking/api_client.dart';
import 'package:as_one/features/authentication/auth_models.dart';
import 'package:as_one/features/pos/pos_access_gateway.dart';
import 'package:as_one/features/pos/pos_access_screen.dart';
import 'package:as_one/features/pos/pos_tokens.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('Activar pulsera — usa el gateway de pulseras, nunca el de tickets', () {
    testWidgets('seleccionar "Pulsera NFC" revela el campo de UID y llama a activateWristband', (tester) async {
      final gateway = _FakeWristbandGateway(
        activateResult: _credential(id: 'wb-1', code: 'UID-0001', credentialKind: 'wristband'),
      );
      await _pump(tester, gateway);

      await tester.tap(find.text('Pulsera NFC'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('pos-access-issue-wristband-code')), findsOneWidget);

      await tester.enterText(find.byKey(const Key('pos-access-issue-sale-id')), 'sale-123');
      await tester.enterText(find.byKey(const Key('pos-access-issue-wristband-code')), 'UID-0001');
      await tester.tap(find.byKey(const Key('pos-access-issue-submit')));
      await tester.pumpAndSettle();

      expect(gateway.activateCalls, [(saleId: 'sale-123', code: 'UID-0001')]);
      expect(gateway.issueCalls, isEmpty);
      expect(find.text('Pulsera activada: UID-0001'), findsOneWidget);
    });

    testWidgets('el botón dice "Emitir pase" para ticket y "Activar pulsera" para pulsera', (tester) async {
      final gateway = _FakeWristbandGateway();
      await _pump(tester, gateway);

      expect(find.text('Emitir pase'), findsOneWidget);
      expect(find.text('Activar pulsera'), findsNothing);

      await tester.tap(find.text('Pulsera NFC'));
      await tester.pumpAndSettle();

      expect(find.text('Activar pulsera'), findsOneWidget);
      expect(find.text('Emitir pase'), findsNothing);
    });

    testWidgets('un UID ya en uso muestra el mensaje honesto y específico code_already_in_use', (tester) async {
      final gateway = _FakeWristbandGateway(
        activateError: ApiException(
          AppFailure.fromCode('resource_conflict'),
          statusCode: 409,
          details: {'reason': 'code_already_in_use'},
        ),
      );
      await _pump(tester, gateway);

      await tester.tap(find.text('Pulsera NFC'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('pos-access-issue-sale-id')), 'sale-123');
      await tester.enterText(find.byKey(const Key('pos-access-issue-wristband-code')), 'UID-DUP');
      await tester.tap(find.byKey(const Key('pos-access-issue-submit')));
      await tester.pumpAndSettle();

      expect(find.text('Este código/UID ya está en uso por otro pase.'), findsOneWidget);
    });
  });

  group('Buscar pulsera por código — estado real + historial real', () {
    testWidgets('una búsqueda exitosa muestra el código, tipo, estado y carga el historial', (tester) async {
      final gateway = _FakeWristbandGateway(
        lookupResult: _credential(id: 'wb-2', code: 'UID-0002', credentialKind: 'wristband'),
        eventsResult: PosAccessPage(
          items: [_event(id: 'ev-1', credentialId: 'wb-2', eventType: 'entry')],
          nextCursor: null,
        ),
      );
      await _pump(tester, gateway);

      await tester.enterText(find.byKey(const Key('pos-access-wristband-lookup-field')), 'UID-0002');
      await tester.tap(find.byKey(const Key('pos-access-wristband-lookup-submit')));
      await tester.pumpAndSettle();

      expect(gateway.lookupCalls, ['UID-0002']);
      expect(find.byKey(const Key('pos-access-wristband-lookup-result')), findsOneWidget);
      expect(
        tester.widget<Text>(find.byKey(const Key('pos-access-wristband-lookup-code'))).data,
        'UID-0002',
      );
      expect(find.text('Pulsera — Activa — Fuera'), findsOneWidget);
      expect(gateway.eventsCalls, ['wb-2']);
      expect(find.byKey(const Key('pos-access-wristband-lookup-history')), findsOneWidget);
    });

    testWidgets('un código desconocido muestra un mensaje honesto, nunca un resultado fabricado', (tester) async {
      final gateway = _FakeWristbandGateway(
        lookupError: ApiException(AppFailure.fromCode('not_found'), statusCode: 404),
      );
      await _pump(tester, gateway);

      await tester.enterText(find.byKey(const Key('pos-access-wristband-lookup-field')), 'UID-UNKNOWN');
      await tester.tap(find.byKey(const Key('pos-access-wristband-lookup-submit')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('pos-access-wristband-lookup-result')), findsNothing);
      expect(find.byKey(const Key('pos-access-wristband-lookup-error')), findsOneWidget);
    });

    testWidgets('una pulsera activa (no bloqueada) muestra el botón "Bloquear"', (tester) async {
      final gateway = _FakeWristbandGateway(
        lookupResult: _credential(id: 'wb-3', code: 'UID-0003', credentialKind: 'wristband'),
      );
      await _pump(tester, gateway);
      await tester.enterText(find.byKey(const Key('pos-access-wristband-lookup-field')), 'UID-0003');
      await tester.tap(find.byKey(const Key('pos-access-wristband-lookup-submit')));
      await tester.pumpAndSettle();

      expect(find.text('Bloquear'), findsOneWidget);
      expect(find.text('Desbloquear'), findsNothing);
    });

    testWidgets('bloquear llama a voidCredential (reuso real, nunca un método duplicado)', (tester) async {
      final gateway = _FakeWristbandGateway(
        lookupResult: _credential(id: 'wb-4', code: 'UID-0004', credentialKind: 'wristband'),
        voidResult: _credential(id: 'wb-4', code: 'UID-0004', credentialKind: 'wristband', status: 'void'),
      );
      await _pump(tester, gateway);
      await tester.enterText(find.byKey(const Key('pos-access-wristband-lookup-field')), 'UID-0004');
      await tester.tap(find.byKey(const Key('pos-access-wristband-lookup-submit')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-access-wristband-toggle-block')));
      await tester.pumpAndSettle();

      expect(gateway.voidCalls, ['wb-4']);
      expect(gateway.unblockCalls, isEmpty);
      expect(find.text('Pulsera — Bloqueada — Fuera'), findsOneWidget);
      expect(find.text('Desbloquear'), findsOneWidget);
    });

    testWidgets('desbloquear (una pulsera bloqueada) llama a unblockCredential — la transición genuinamente nueva', (
      tester,
    ) async {
      final gateway = _FakeWristbandGateway(
        lookupResult: _credential(id: 'wb-5', code: 'UID-0005', credentialKind: 'wristband', status: 'void'),
        unblockResult: _credential(id: 'wb-5', code: 'UID-0005', credentialKind: 'wristband'),
      );
      await _pump(tester, gateway);
      await tester.enterText(find.byKey(const Key('pos-access-wristband-lookup-field')), 'UID-0005');
      await tester.tap(find.byKey(const Key('pos-access-wristband-lookup-submit')));
      await tester.pumpAndSettle();

      expect(find.text('Desbloquear'), findsOneWidget);
      await tester.tap(find.byKey(const Key('pos-access-wristband-toggle-block')));
      await tester.pumpAndSettle();

      expect(gateway.unblockCalls, ['wb-5']);
      expect(gateway.voidCalls, isEmpty);
      expect(find.text('Pulsera — Activa — Fuera'), findsOneWidget);
    });

    testWidgets('sin el permiso access.manage, el botón de bloqueo/desbloqueo está deshabilitado', (tester) async {
      final gateway = _FakeWristbandGateway(
        lookupResult: _credential(id: 'wb-6', code: 'UID-0006', credentialKind: 'wristband'),
      );
      await _pump(tester, gateway, permissions: const ['access.scan', 'access.read']);
      await tester.enterText(find.byKey(const Key('pos-access-wristband-lookup-field')), 'UID-0006');
      await tester.tap(find.byKey(const Key('pos-access-wristband-lookup-submit')));
      await tester.pumpAndSettle();

      final button = tester.widget<FilledButton>(find.byKey(const Key('pos-access-wristband-toggle-block')));
      expect(button.onPressed, isNull);
    });

    testWidgets('nunca existe un control de "extender" — el legacy no tenía nada real que portar', (tester) async {
      final gateway = _FakeWristbandGateway(
        lookupResult: _credential(id: 'wb-7', code: 'UID-0007', credentialKind: 'wristband'),
      );
      await _pump(tester, gateway);
      await tester.enterText(find.byKey(const Key('pos-access-wristband-lookup-field')), 'UID-0007');
      await tester.tap(find.byKey(const Key('pos-access-wristband-lookup-submit')));
      await tester.pumpAndSettle();

      expect(find.textContaining('xtender', findRichText: true), findsNothing);
      expect(find.textContaining('Extender'), findsNothing);
    });
  });
}

PosAccessCredential _credential({
  required String id,
  required String code,
  String credentialKind = 'ticket',
  String status = 'issued',
  bool currentlyInside = false,
}) => PosAccessCredential(
  id: id,
  branchId: 'branch-id',
  code: code,
  saleId: null,
  customerId: null,
  allowsReentry: false,
  status: status,
  currentlyInside: currentlyInside,
  issuedAt: DateTime.utc(2026, 9, 1, 10),
  issuedBy: 'user-id',
  voidedAt: null,
  voidedBy: null,
  credentialKind: credentialKind,
);

PosAccessEvent _event({required String id, required String credentialId, required String eventType}) =>
    PosAccessEvent(
      id: id,
      branchId: 'branch-id',
      credentialId: credentialId,
      eventType: eventType,
      occurredAt: DateTime.utc(2026, 9, 1, 10),
      createdBy: 'user-id',
      createdAt: DateTime.utc(2026, 9, 1, 10),
    );

/// A small, local, recording fake — deliberately separate from
/// `pos_access_test.dart`'s own `_FakeAccessGateway` (a private class,
/// unreachable from this sibling file) rather than sharing state across
/// test files.
class _FakeWristbandGateway implements PosAccessGateway {
  _FakeWristbandGateway({
    this.activateResult,
    this.activateError,
    this.lookupResult,
    this.lookupError,
    this.voidResult,
    this.unblockResult,
    this.eventsResult = const PosAccessPage(items: [], nextCursor: null),
  });

  final PosAccessCredential? activateResult;
  final ApiException? activateError;
  final PosAccessCredential? lookupResult;
  final ApiException? lookupError;
  final PosAccessCredential? voidResult;
  final PosAccessCredential? unblockResult;
  final PosAccessPage<PosAccessEvent> eventsResult;

  final List<({String saleId, String code})> activateCalls = [];
  final List<({String saleId, String? customerId, bool? allowsReentry})> issueCalls = [];
  final List<String> lookupCalls = [];
  final List<String> voidCalls = [];
  final List<String> unblockCalls = [];
  final List<String> eventsCalls = [];

  @override
  Future<PosAccessCredential> activateWristband({
    required String branchId,
    required String saleId,
    required String code,
    String? customerId,
    bool? allowsReentry,
  }) async {
    activateCalls.add((saleId: saleId, code: code));
    if (activateError != null) throw activateError!;
    return activateResult ?? _credential(id: 'wb-x', code: code, credentialKind: 'wristband');
  }

  @override
  Future<PosAccessCredential> issueCredential({
    required String branchId,
    required String saleId,
    String? customerId,
    bool? allowsReentry,
  }) async {
    issueCalls.add((saleId: saleId, customerId: customerId, allowsReentry: allowsReentry));
    return _credential(id: 'ticket-x', code: 'AC-X');
  }

  @override
  Future<PosAccessScanResult> scan({required String branchId, required String code}) =>
      Future.error(StateError('not used in this test file'));

  @override
  Future<PosAccessCredential> voidCredential(String id) async {
    voidCalls.add(id);
    return voidResult ?? _credential(id: id, code: 'AC-VOIDED', status: 'void');
  }

  @override
  Future<PosAccessCredential> unblockCredential(String id) async {
    unblockCalls.add(id);
    return unblockResult ?? _credential(id: id, code: 'AC-UNBLOCKED');
  }

  @override
  Future<PosAccessCredential> lookupByCode(String code) async {
    lookupCalls.add(code);
    if (lookupError != null) throw lookupError!;
    return lookupResult ?? _credential(id: 'lookup-x', code: code);
  }

  @override
  Future<PosAccessPage<PosAccessCredential>> currentlyInside({String? branchId, String? cursor, int limit = 50}) =>
      Future.value(const PosAccessPage(items: [], nextCursor: null));

  @override
  Future<PosAccessPage<PosAccessEvent>> listEvents({
    String? branchId,
    String? cursor,
    int limit = 50,
    String? credentialId,
    DateTime? occurredFrom,
    DateTime? occurredTo,
  }) async {
    if (credentialId != null) eventsCalls.add(credentialId);
    return eventsResult;
  }

  @override
  Future<int> occupancy({required String branchId}) => Future.value(0);
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
  permissions: const ['access.scan', 'access.read', 'access.manage'],
);

Future<void> _pump(
  WidgetTester tester,
  PosAccessGateway gateway, {
  List<String> permissions = const ['access.scan', 'access.read', 'access.manage'],
}) async {
  tester.view.physicalSize = const Size(1440, 1400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      theme: PosTheme.light(),
      home: Scaffold(
        body: SingleChildScrollView(
          child: PosAccessScreen(
            context: AuthenticatedContext(
              session: _context.session,
              user: _context.user,
              companies: _context.companies,
              branches: _context.branches,
              companyWideAccess: _context.companyWideAccess,
              permissions: permissions,
            ),
            accessGateway: gateway,
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}
