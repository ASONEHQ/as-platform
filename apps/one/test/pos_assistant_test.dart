/// TASK 12.2: widget tests for "Asistente"
/// (`pos_assistant_screen.dart`/`pos_assistant_gateway.dart`) — real
/// widget tests with a hand-written recording fake gateway, mirroring
/// `pos_reports_test.dart`'s own `_Recording*Gateway`/`_context` fixture
/// pattern exactly. No mockito/mocktail.
library;

import 'package:as_one/core/errors/app_error.dart';
import 'package:as_one/core/networking/api_client.dart';
import 'package:as_one/features/authentication/auth_models.dart';
import 'package:as_one/features/pos/pos_assistant_gateway.dart';
import 'package:as_one/features/pos/pos_assistant_screen.dart';
import 'package:as_one/features/pos/pos_tokens.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('Asking a question', () {
    testWidgets('typing a question and tapping Preguntar calls the gateway with the real text', (tester) async {
      final gateway = _RecordingAssistantGateway();
      await _pump(tester, gateway: gateway);

      await tester.enterText(find.byKey(const Key('pos-assistant-question-field')), '¿Cuántas ventas hubo hoy?');
      await tester.tap(find.byKey(const Key('pos-assistant-ask-button')));
      await tester.pumpAndSettle();

      expect(gateway.calls, hasLength(1));
      expect(gateway.calls.single.question, '¿Cuántas ventas hubo hoy?');
      expect(gateway.calls.single.branchId, 'branch-id');
    });

    testWidgets('the real answer text renders verbatim, alongside its matched intent', (tester) async {
      final gateway = _RecordingAssistantGateway();
      await _pump(tester, gateway: gateway);

      await tester.enterText(find.byKey(const Key('pos-assistant-question-field')), 'ventas de hoy');
      await tester.tap(find.byKey(const Key('pos-assistant-ask-button')));
      await tester.pumpAndSettle();

      expect(
        find.text('Hoy se han registrado 2 ventas completadas por un total de 150.0000 MXN.'),
        findsOneWidget,
      );
      expect(find.byKey(const Key('pos-assistant-answer-text')), findsOneWidget);
      expect(find.text('sales_today'), findsOneWidget);
      // Real backend `data` fields render too, never suppressed.
      expect(find.textContaining('transaction_count'), findsOneWidget);
    });

    testWidgets('submitting via the keyboard (onSubmitted) also asks, same as tapping the button', (tester) async {
      final gateway = _RecordingAssistantGateway();
      await _pump(tester, gateway: gateway);

      await tester.enterText(find.byKey(const Key('pos-assistant-question-field')), 'ventas de hoy');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pumpAndSettle();

      expect(gateway.calls, hasLength(1));
    });

    testWidgets('an empty question never triggers a call', (tester) async {
      final gateway = _RecordingAssistantGateway();
      await _pump(tester, gateway: gateway);

      await tester.tap(find.byKey(const Key('pos-assistant-ask-button')));
      await tester.pumpAndSettle();

      expect(gateway.calls, isEmpty);
    });
  });

  group('Honest unknown-intent answers', () {
    testWidgets('an unknown-intent answer renders honestly, never hidden or suppressed', (tester) async {
      final gateway = _RecordingAssistantGateway(
        answer: const PosAssistantAnswer(
          intent: 'unknown',
          question: '¿Cuál es el sentido de la vida?',
          answerText:
              'No tengo una respuesta preparada para esa pregunta. Puedo ayudarte con: ventas de hoy, '
              'si la caja está abierta, productos con stock bajo, y fiestas de hoy.',
          data: null,
        ),
      );
      await _pump(tester, gateway: gateway);

      await tester.enterText(find.byKey(const Key('pos-assistant-question-field')), '¿Cuál es el sentido de la vida?');
      await tester.tap(find.byKey(const Key('pos-assistant-ask-button')));
      await tester.pumpAndSettle();

      expect(find.text('unknown'), findsOneWidget);
      expect(
        find.text(
          'No tengo una respuesta preparada para esa pregunta. Puedo ayudarte con: ventas de hoy, '
          'si la caja está abierta, productos con stock bajo, y fiestas de hoy.',
        ),
        findsOneWidget,
      );
    });
  });

  group('Error handling', () {
    testWidgets('a gateway error shows an honest error state, never fabricated data', (tester) async {
      final gateway = _RecordingAssistantGateway(
        failure: const ApiException(AppFailure(AppErrorKind.unavailable, 'El servidor no respondió.')),
      );
      await _pump(tester, gateway: gateway);

      await tester.enterText(find.byKey(const Key('pos-assistant-question-field')), 'ventas de hoy');
      await tester.tap(find.byKey(const Key('pos-assistant-ask-button')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('pos-assistant-error-state')), findsOneWidget);
      expect(find.text('El servidor no respondió.'), findsOneWidget);
      expect(find.byKey(const Key('pos-assistant-answer-text')), findsNothing);
    });
  });
}

Future<void> _pump(WidgetTester tester, {required _RecordingAssistantGateway gateway}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: PosTheme.light(),
      home: Scaffold(
        body: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: PosAssistantScreen(context: _context(), gateway: gateway),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

AuthenticatedContext _context() => AuthenticatedContext(
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
  permissions: const [],
);

// --- Recording fake gateway ---------------------------------------------

class _AssistantCall {
  const _AssistantCall({required this.question, required this.branchId});
  final String question;
  final String? branchId;
}

const _fixtureSalesTodayAnswer = PosAssistantAnswer(
  intent: 'sales_today',
  question: 'ventas de hoy',
  answerText: 'Hoy se han registrado 2 ventas completadas por un total de 150.0000 MXN.',
  data: {
    'transaction_count': 2,
    'gross_totals': [
      {'currency_code': 'MXN', 'amount': '150.0000'},
    ],
  },
);

class _RecordingAssistantGateway implements PosAssistantGateway {
  _RecordingAssistantGateway({PosAssistantAnswer answer = _fixtureSalesTodayAnswer, ApiException? failure})
    : _answer = answer,
      _failure = failure;

  final PosAssistantAnswer _answer;
  final ApiException? _failure;

  final List<_AssistantCall> calls = [];

  @override
  Future<PosAssistantAnswer> ask(String question, {String? branchId}) async {
    calls.add(_AssistantCall(question: question, branchId: branchId));
    if (_failure != null) throw _failure;
    return _answer;
  }
}
