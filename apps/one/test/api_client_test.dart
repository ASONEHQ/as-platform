import 'dart:convert';

import 'package:as_one/core/networking/api_client.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

void main() {
  test(
    'injects bearer and correlation headers without unsafe retries',
    () async {
      late http.BaseRequest captured;
      var sends = 0;
      final client = ApiClient(
        baseUrl: Uri.parse('https://api.test.asone.mx/api/v1/'),
        transport: _FakeClient((request) {
          sends++;
          captured = request;
          return http.Response(
            jsonEncode({
              'data': {'ok': true},
            }),
            200,
            headers: {'content-type': 'application/json'},
          );
        }),
        readAccessToken: () => 'memory-token',
        createCorrelationId: () => 'correlation-test',
      );
      final result = await client.getJson('auth/session');
      expect(result['data'], {'ok': true});
      expect(captured.headers['Authorization'], 'Bearer memory-token');
      expect(captured.headers['X-Correlation-ID'], 'correlation-test');
      expect(sends, 1);
    },
  );

  test('maps canonical errors to safe API exceptions', () async {
    final client = ApiClient(
      baseUrl: Uri.parse('https://api.test.asone.mx/'),
      transport: _FakeClient(
        (_) => http.Response(
          jsonEncode({
            'error': {'code': 'session_expired', 'message': 'internal'},
          }),
          401,
        ),
      ),
      readAccessToken: () => null,
      createCorrelationId: () => 'correlation-test',
    );
    await expectLater(
      client.getJson('session'),
      throwsA(
        isA<ApiException>().having(
          (error) => error.failure.code,
          'code',
          'session_expired',
        ),
      ),
    );
  });

  test(
    'serializes recovery externally and retries a safe GET only once',
    () async {
      var sends = 0;
      var refreshes = 0;
      final client = ApiClient(
        baseUrl: Uri.parse('https://api.test.asone.mx/'),
        transport: _FakeClient((_) {
          sends++;
          return sends == 1
              ? http.Response(
                  jsonEncode({
                    'error': {'code': 'session_expired'},
                  }),
                  401,
                )
              : http.Response(
                  jsonEncode({
                    'data': {'ok': true},
                  }),
                  200,
                );
        }),
        readAccessToken: () => 'memory-token',
        createCorrelationId: () => 'correlation-test',
      )..onUnauthorized = () async => refreshes++;
      expect((await client.getJson('safe'))['data'], {'ok': true});
      expect(sends, 2);
      expect(refreshes, 1);
    },
  );

  test('never automatically retries a non-idempotent request', () async {
    var sends = 0;
    var refreshes = 0;
    final client = ApiClient(
      baseUrl: Uri.parse('https://api.test.asone.mx/'),
      transport: _FakeClient((_) {
        sends++;
        return http.Response(
          jsonEncode({
            'error': {'code': 'session_expired'},
          }),
          401,
        );
      }),
      readAccessToken: () => 'memory-token',
      createCorrelationId: () => 'correlation-test',
    )..onUnauthorized = () async => refreshes++;
    await expectLater(
      client.postJson('mutation'),
      throwsA(isA<ApiException>()),
    );
    expect(sends, 1);
    expect(refreshes, 0);
  });

  // TASK 15.1 Phase 3: regression test for the `omitBody` fix — see
  // `api_client.dart`'s own doc comment on `postJson` for why
  // `inventory-posting.routes.ts`'s `submit`/`post` endpoints need a
  // genuinely bodyless `POST`, unlike every other call site.
  test(
    'postJson with omitBody sends a genuinely empty body, never a JSON-encoded "{}"',
    () async {
      late http.BaseRequest captured;
      final client = ApiClient(
        baseUrl: Uri.parse('https://api.test.asone.mx/'),
        transport: _FakeClient((request) {
          captured = request;
          return http.Response(
            jsonEncode({
              'data': {'ok': true},
            }),
            200,
          );
        }),
        readAccessToken: () => 'memory-token',
        createCorrelationId: () => 'correlation-test',
      );
      await client.postJson(
        'inventory/movements/movement-1/submit',
        idempotencyKey: 'submit-1',
        ifMatch: '"1"',
        omitBody: true,
      );
      final body = captured as http.Request;
      expect(body.body, '');
      expect(captured.headers['Idempotency-Key'], 'submit-1');
      expect(captured.headers['If-Match'], '"1"');
    },
  );

  test(
    'postJson without omitBody keeps sending the default empty JSON object',
    () async {
      late http.BaseRequest captured;
      final client = ApiClient(
        baseUrl: Uri.parse('https://api.test.asone.mx/'),
        transport: _FakeClient((request) {
          captured = request;
          return http.Response(
            jsonEncode({
              'data': {'ok': true},
            }),
            200,
          );
        }),
        readAccessToken: () => 'memory-token',
        createCorrelationId: () => 'correlation-test',
      );
      await client.postJson('payroll-periods/period-1/close', idempotencyKey: 'close-1');
      final body = captured as http.Request;
      expect(body.body, '{}');
    },
  );

  test(
    'maps malformed success responses without exposing their body',
    () async {
      final client = ApiClient(
        baseUrl: Uri.parse('https://api.test.asone.mx/'),
        transport: _FakeClient((_) => http.Response('not-json', 200)),
        readAccessToken: () => null,
        createCorrelationId: () => 'correlation-test',
      );
      await expectLater(
        client.getJson('malformed'),
        throwsA(
          isA<ApiException>().having(
            (error) => error.failure.code,
            'safe code',
            'malformed_response',
          ),
        ),
      );
    },
  );
}

class _FakeClient extends http.BaseClient {
  _FakeClient(this.handler);
  final http.Response Function(http.BaseRequest request) handler;
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final response = handler(request);
    return http.StreamedResponse(
      Stream.value(response.bodyBytes),
      response.statusCode,
      headers: response.headers,
    );
  }
}
