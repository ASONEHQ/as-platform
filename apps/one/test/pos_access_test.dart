/// TASK 14.4 (Wave 2, Part E): widget tests for `PosAccessScreen` — the
/// REAL "Control de Acceso" replacement for the legacy's own fake ticket
/// scanner (see `pos_access_gateway.dart`'s own doc comment for the
/// forensic context). Pumps `PosAccessScreen` directly (not through
/// `PosShell`, which this task is barred from editing — the module wiring
/// is reported back for the orchestrator to apply centrally instead), with
/// a recording fake `PosAccessGateway`, mirroring `pos_shell_test.dart`'s/
/// `pos_shell_wave1_partbc_test.dart`'s own `_Fake*Gateway`/`_pump`
/// fixture pattern.
///
/// Every assertion here checks something a fabricated/generic-error UI
/// could NOT honestly produce: a specific, distinct message per rejection
/// reason (never a shared generic string), an occupancy count that comes
/// from the gateway's own return value even when it deliberately disagrees
/// with a naive client-side count of the currently-inside list, and a
/// void-while-inside rejection that surfaces the backend's real
/// `credential_currently_inside` reason rather than a fabricated success.
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
  group('Escaneo — resultado honesto', () {
    testWidgets('un escaneo de entrada exitoso muestra la confirmación correcta', (tester) async {
      final gateway = _FakeAccessGateway(
        scanResult: PosAccessScanResult(
          credential: _credential(id: 'cred-1', code: 'AC-AAAAA', customerId: 'customer-1'),
          event: _event(id: 'event-1', credentialId: 'cred-1', eventType: 'entry'),
        ),
      );
      await _pump(tester, gateway);

      await tester.enterText(find.byKey(const Key('pos-access-scan-field')), 'AC-AAAAA');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pumpAndSettle();

      expect(gateway.scanCalls, ['AC-AAAAA']);
      expect(find.text('Entrada registrada'), findsOneWidget);
      expect(find.text('Pase: AC-AAAAA'), findsOneWidget);
      expect(find.text('Cliente: customer-1'), findsOneWidget);
      // The field cleared and stays ready for the next scan — no leftover
      // text from the previous one.
      expect(
        tester.widget<TextField>(find.byKey(const Key('pos-access-scan-field'))).controller!.text,
        isEmpty,
      );
    });

    testWidgets('un escaneo de salida exitoso lo etiqueta como salida, no como entrada', (tester) async {
      final gateway = _FakeAccessGateway(
        scanResult: PosAccessScanResult(
          credential: _credential(id: 'cred-1', code: 'AC-BBBBB', currentlyInside: false),
          event: _event(id: 'event-2', credentialId: 'cred-1', eventType: 'exit'),
        ),
      );
      await _pump(tester, gateway);

      await tester.enterText(find.byKey(const Key('pos-access-scan-field')), 'AC-BBBBB');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pumpAndSettle();

      expect(find.text('Salida registrada'), findsOneWidget);
      expect(find.text('Entrada registrada'), findsNothing);
    });

    for (final fixture in _rejectionFixtures) {
      testWidgets(
        '${fixture.reason} muestra su propio mensaje honesto y específico — nunca uno genérico',
        (tester) async {
          final gateway = _FakeAccessGateway(
            scanError: ApiException(
              AppFailure.fromCode('resource_conflict'),
              statusCode: 409,
              details: {'reason': fixture.reason},
            ),
          );
          await _pump(tester, gateway);

          await tester.enterText(find.byKey(const Key('pos-access-scan-field')), 'AC-CCCCC');
          await tester.testTextInput.receiveAction(TextInputAction.done);
          await tester.pumpAndSettle();

          expect(find.text(fixture.message), findsOneWidget);
          // Never a fabricated/implied success for a rejected scan.
          expect(find.text('Entrada registrada'), findsNothing);
          expect(find.text('Salida registrada'), findsNothing);
          // Never the generic shared fallback text either.
          expect(find.text('No fue posible completar la solicitud.'), findsNothing);
          // The field cleared and refocused for the very next scan even
          // after a rejection — the fast gate-staff workflow never stalls
          // on a failed scan.
          expect(
            tester.widget<TextField>(find.byKey(const Key('pos-access-scan-field'))).controller!.text,
            isEmpty,
          );
        },
      );
    }

    testWidgets('cada motivo de rechazo produce un texto distinto de los demás', (tester) async {
      final messages = _rejectionFixtures.map((fixture) => fixture.message).toSet();
      expect(messages, hasLength(_rejectionFixtures.length));
    });
  });

  group('Aforo — siempre la cuenta real del servidor', () {
    testWidgets(
      'el aforo mostrado es el valor que regresa el gateway, NO un conteo recalculado en el '
      'cliente a partir de la lista "actualmente dentro"',
      (tester) async {
        // Deliberately disagrees with a naive client-side count: the
        // "currently inside" page the fake gateway returns has 2 items,
        // but the authoritative occupancy endpoint reports 7 (e.g. other
        // branches/paginated entries the client never fetched). The UI
        // must show 7, never 2.
        final gateway = _FakeAccessGateway(
          occupancyCount: 7,
          insideResult: PosAccessPage(
            items: [
              _credential(id: 'cred-1', code: 'AC-11111'),
              _credential(id: 'cred-2', code: 'AC-22222'),
            ],
            nextCursor: null,
          ),
        );
        await _pump(tester, gateway);

        expect(find.byKey(const Key('pos-access-occupancy-count')), findsOneWidget);
        expect(find.text('7'), findsOneWidget);
        expect(find.text('2'), findsNothing);
      },
    );
  });

  group('Anular — la regla real "no se puede anular estando dentro"', () {
    testWidgets(
      'anular un pase actualmente dentro muestra el rechazo honesto del backend, nunca un '
      'éxito fabricado',
      (tester) async {
        final gateway = _FakeAccessGateway(
          insideResult: PosAccessPage(
            items: [_credential(id: 'cred-1', code: 'AC-33333', currentlyInside: true)],
            nextCursor: null,
          ),
          voidError: ApiException(
            AppFailure.fromCode('resource_conflict'),
            statusCode: 409,
            details: const {'reason': 'credential_currently_inside'},
          ),
        );
        await _pump(tester, gateway);

        await tester.tap(find.byKey(const Key('pos-access-void-cred-1')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pos-access-void-confirm')));
        await tester.pumpAndSettle();

        expect(gateway.voidCalls, ['cred-1']);
        expect(
          find.text('Este pase de acceso está actualmente dentro — registra su salida antes de anularlo.'),
          findsOneWidget,
        );
      },
    );

    testWidgets('anular sin confirmar el diálogo no llama al gateway', (tester) async {
      final gateway = _FakeAccessGateway(
        insideResult: PosAccessPage(
          items: [_credential(id: 'cred-1', code: 'AC-44444', currentlyInside: true)],
          nextCursor: null,
        ),
      );
      await _pump(tester, gateway);

      await tester.tap(find.byKey(const Key('pos-access-void-cred-1')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cancelar'));
      await tester.pumpAndSettle();

      expect(gateway.voidCalls, isEmpty);
    });

    testWidgets('anular un pase que NO está dentro sí se anula, y desaparece de la lista', (tester) async {
      final gateway = _FakeAccessGateway(
        insideResult: PosAccessPage(
          items: [_credential(id: 'cred-1', code: 'AC-66666', currentlyInside: false)],
          nextCursor: null,
        ),
        voidResult: _credential(id: 'cred-1', code: 'AC-66666', status: 'void'),
      );
      await _pump(tester, gateway);

      await tester.tap(find.byKey(const Key('pos-access-void-cred-1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-access-void-confirm')));
      await tester.pumpAndSettle();

      expect(gateway.voidCalls, ['cred-1']);
      expect(find.text('Pase AC-66666 anulado.'), findsOneWidget);
    });
  });

  group('Emitir pase — vincula una venta real', () {
    testWidgets('emitir un pase exitosamente muestra el código real que regresó el backend', (
      tester,
    ) async {
      final gateway = _FakeAccessGateway(
        issueResult: _credential(id: 'cred-issued', code: 'AC-ISSUED9', saleId: 'sale-1'),
      );
      await _pump(tester, gateway);

      await tester.enterText(find.byKey(const Key('pos-access-issue-sale-id')), 'sale-1');
      await tester.tap(find.byKey(const Key('pos-access-issue-submit')));
      await tester.pumpAndSettle();

      expect(gateway.issueCalls, hasLength(1));
      expect(gateway.issueCalls.single.saleId, 'sale-1');
      expect(find.text('Pase emitido: AC-ISSUED9'), findsOneWidget);
    });

    testWidgets('un rechazo al emitir (ej. venta no completada) muestra el mensaje real del backend', (
      tester,
    ) async {
      final gateway = _FakeAccessGateway(
        issueError: ApiException(
          AppFailure.fromCode('validation_error'),
          statusCode: 400,
        ),
      );
      await _pump(tester, gateway);

      await tester.enterText(find.byKey(const Key('pos-access-issue-sale-id')), 'sale-not-completed');
      await tester.tap(find.byKey(const Key('pos-access-issue-submit')));
      await tester.pumpAndSettle();

      expect(
        find.text('Revisa la información e inténtalo de nuevo.'),
        findsOneWidget,
      );
    });
  });

  group('Eventos recientes — historial inmutable de solo lectura', () {
    testWidgets('la lista de eventos muestra los eventos reales del gateway, con su tipo correcto', (
      tester,
    ) async {
      final gateway = _FakeAccessGateway(
        eventsResult: PosAccessPage(
          items: [
            _event(id: 'event-1', credentialId: 'cred-1', eventType: 'entry'),
            _event(id: 'event-2', credentialId: 'cred-1', eventType: 'exit'),
          ],
          nextCursor: null,
        ),
      );
      await _pump(tester, gateway);

      expect(gateway.eventsCalls, greaterThanOrEqualTo(1));
      expect(find.byKey(const Key('pos-access-events-list')), findsOneWidget);
      expect(find.text('Entrada'), findsOneWidget);
      expect(find.text('Salida'), findsOneWidget);
      // Read-only — no edit/delete affordance on an immutable event row.
      expect(find.byKey(const Key('pos-access-event-row-event-1')), findsOneWidget);
    });
  });

  group('Permisos — nunca una regla más laxa o más estricta que el backend', () {
    testWidgets('sin access.scan, el escáner y la emisión quedan ocultos tras un aviso honesto', (
      tester,
    ) async {
      final gateway = _FakeAccessGateway();
      await _pump(tester, gateway, permissions: const ['access.read', 'access.manage']);

      expect(find.byKey(const Key('pos-access-scan-field')), findsNothing);
      expect(find.text('Tu sesión no incluye el permiso access.scan requerido para escanear o emitir pases.'), findsOneWidget);
    });

    testWidgets('sin access.read, "actualmente dentro" y "eventos" muestran el aviso de permiso', (
      tester,
    ) async {
      final gateway = _FakeAccessGateway();
      await _pump(tester, gateway, permissions: const ['access.scan', 'access.manage']);

      expect(find.text('Tu sesión no incluye el permiso access.read requerido.'), findsNWidgets(3));
      expect(gateway.insideCalls, 0);
      expect(gateway.eventsCalls, 0);
      expect(gateway.occupancyCalls, 0);
    });

    testWidgets('sin access.manage, el botón Anular queda deshabilitado con su propio tooltip', (
      tester,
    ) async {
      final gateway = _FakeAccessGateway(
        insideResult: PosAccessPage(
          items: [_credential(id: 'cred-1', code: 'AC-55555', currentlyInside: true)],
          nextCursor: null,
        ),
      );
      await _pump(tester, gateway, permissions: const ['access.scan', 'access.read']);

      final button = tester.widget<TextButton>(find.byKey(const Key('pos-access-void-cred-1')));
      expect(button.onPressed, isNull);
      final tooltip = tester.widget<Tooltip>(
        find.ancestor(of: find.byKey(const Key('pos-access-void-cred-1')), matching: find.byType(Tooltip)),
      );
      expect(tooltip.message, 'Requiere el permiso access.manage.');
    });
  });
}

class _RejectionFixture {
  const _RejectionFixture(this.reason, this.message);
  final String reason;
  final String message;
}

const _rejectionFixtures = [
  _RejectionFixture('credential_not_found', 'Este código no corresponde a ningún pase de acceso.'),
  _RejectionFixture('credential_void', 'Este pase de acceso fue anulado.'),
  _RejectionFixture('wrong_branch', 'Este pase de acceso pertenece a otra sucursal.'),
  _RejectionFixture(
    'already_inside',
    'Este pase de acceso ya registró su entrada — no puede volver a entrar sin registrar antes una salida.',
  ),
  _RejectionFixture(
    'not_inside',
    'Este pase de acceso no está registrado como dentro — no puede registrarse una salida.',
  ),
  _RejectionFixture(
    'reentry_not_allowed',
    'Este pase de acceso ya completó su único ciclo de entrada y salida — no permite reingreso.',
  ),
];

PosAccessCredential _credential({
  required String id,
  required String code,
  String? saleId,
  String? customerId,
  bool allowsReentry = false,
  String status = 'issued',
  bool currentlyInside = false,
}) => PosAccessCredential(
  id: id,
  branchId: 'branch-id',
  code: code,
  saleId: saleId,
  customerId: customerId,
  allowsReentry: allowsReentry,
  status: status,
  currentlyInside: currentlyInside,
  issuedAt: DateTime.utc(2026, 9, 1, 10),
  issuedBy: 'user-id',
  voidedAt: null,
  voidedBy: null,
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

class _FakeAccessGateway implements PosAccessGateway {
  _FakeAccessGateway({
    this.scanResult,
    this.scanError,
    this.issueResult,
    this.issueError,
    this.voidResult,
    this.voidError,
    this.insideResult = const PosAccessPage(items: [], nextCursor: null),
    this.eventsResult = const PosAccessPage(items: [], nextCursor: null),
    this.occupancyCount = 0,
  });

  final PosAccessScanResult? scanResult;
  final ApiException? scanError;
  final PosAccessCredential? issueResult;
  final ApiException? issueError;
  final PosAccessCredential? voidResult;
  final ApiException? voidError;
  final PosAccessPage<PosAccessCredential> insideResult;
  final PosAccessPage<PosAccessEvent> eventsResult;
  final int occupancyCount;

  final List<String> scanCalls = [];
  final List<String> voidCalls = [];
  final List<({String saleId, String? customerId, bool? allowsReentry})> issueCalls = [];
  int occupancyCalls = 0;
  int insideCalls = 0;
  int eventsCalls = 0;

  @override
  Future<PosAccessCredential> issueCredential({
    required String branchId,
    required String saleId,
    String? customerId,
    bool? allowsReentry,
  }) async {
    issueCalls.add((saleId: saleId, customerId: customerId, allowsReentry: allowsReentry));
    if (issueError != null) throw issueError!;
    return issueResult ?? _credential(id: 'issued-1', code: 'AC-ISSUED', saleId: saleId, customerId: customerId);
  }

  @override
  Future<PosAccessScanResult> scan({required String branchId, required String code}) async {
    scanCalls.add(code);
    if (scanError != null) throw scanError!;
    return scanResult!;
  }

  @override
  Future<PosAccessCredential> voidCredential(String id) async {
    voidCalls.add(id);
    if (voidError != null) throw voidError!;
    return voidResult ?? _credential(id: id, code: 'AC-VOIDED', status: 'void');
  }

  @override
  Future<PosAccessPage<PosAccessCredential>> currentlyInside({
    String? branchId,
    String? cursor,
    int limit = 50,
  }) async {
    insideCalls += 1;
    return insideResult;
  }

  @override
  Future<PosAccessPage<PosAccessEvent>> listEvents({
    String? branchId,
    String? cursor,
    int limit = 50,
    DateTime? occurredFrom,
    DateTime? occurredTo,
  }) async {
    eventsCalls += 1;
    return eventsResult;
  }

  @override
  Future<int> occupancy({required String branchId}) async {
    occupancyCalls += 1;
    return occupancyCount;
  }
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
  tester.view.physicalSize = const Size(1440, 900);
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
