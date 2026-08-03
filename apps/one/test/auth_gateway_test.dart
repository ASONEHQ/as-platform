import 'dart:convert';

import 'package:as_one/core/networking/api_client.dart';
import 'package:as_one/core/storage/token_vault.dart';
import 'package:as_one/features/authentication/auth_gateway.dart';
import 'package:as_one/features/authentication/auth_models.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

void main() {
  test(
    'E164 bootstrap sends no bearer or CSRF and parses only its proof',
    () async {
      late http.BaseRequest captured;
      final gateway = _gateway(
        (request) {
          captured = request;
          return _response({
            'result': 'csrf_ready',
            'csrf_token': 'proof-token',
            'csrf_expires_at': '2099-01-01T00:00:00.000Z',
            'transport_mode': 'browser',
          });
        },
        accessToken: 'must-not-be-sent',
        csrfToken: 'must-not-be-sent',
      );
      final result = await gateway.bootstrapBrowser();
      expect(result.csrfToken, 'proof-token');
      expect(captured.url.path, '/api/v1/auth/browser-bootstrap');
      expect(captured.headers, isNot(contains('Authorization')));
      expect(captured.headers, isNot(contains('X-CSRF-Token')));
    },
  );

  test(
    'E001 declares browser mode and never asks for a refresh token',
    () async {
      late http.Request captured;
      final gateway = _gateway((request) {
        captured = request as http.Request;
        return _response(_tokenData());
      });
      final outcome = await gateway.login(
        identifier: 'user@example.test',
        password: 'correct-password',
      );
      expect(outcome, isA<LoginAuthenticated>());
      final body = jsonDecode(captured.body) as Map<String, Object?>;
      expect(body['client_type'], 'browser');
      expect(body['transport_mode'], 'browser');
      expect(body, isNot(contains('refresh_token')));
      expect(captured.headers, isNot(contains('Authorization')));
    },
  );

  test('E002 uses the in-memory bootstrap CSRF and an empty body', () async {
    late http.Request captured;
    final gateway = _gateway((request) {
      captured = request as http.Request;
      return _response(_tokenData());
    }, csrfToken: 'bootstrap-proof');
    await gateway.refresh('bootstrap-proof');
    expect(captured.headers['X-CSRF-Token'], 'bootstrap-proof');
    expect(captured.headers, isNot(contains('Authorization')));
    expect(jsonDecode(captured.body), isEmpty);
  });

  test('rejects malformed authentication responses safely', () async {
    final gateway = _gateway((_) => _response({'result': 'authenticated'}));
    await expectLater(
      gateway.login(
        identifier: 'user@example.test',
        password: 'correct-password',
      ),
      throwsA(isA<FormatException>()),
    );
  });
}

ApiAuthGateway _gateway(
  http.Response Function(http.BaseRequest request) handler, {
  String? accessToken,
  String? csrfToken,
}) {
  final vault = MemoryTokenVault()..replace(accessToken);
  return ApiAuthGateway(
    client: ApiClient(
      baseUrl: Uri.parse('https://api.test.asone.mx/'),
      transport: _FakeClient(handler),
      readAccessToken: () => vault.accessToken,
      createCorrelationId: () => 'correlation-test',
    ),
    vault: vault,
    readCsrfToken: () => csrfToken,
  );
}

http.Response _response(Map<String, Object?> data) => http.Response(
  jsonEncode({
    'data': data,
    'meta': {'request_id': 'request', 'correlation_id': 'correlation'},
  }),
  200,
);

Map<String, Object?> _tokenData() => {
  'result': 'authenticated',
  'access_token': 'access-token',
  'token_type': 'Bearer',
  'expires_at': '2099-01-01T00:00:00.000Z',
  'refresh_expires_at': '2099-02-01T00:00:00.000Z',
  'csrf_token': 'csrf-token',
  'session': {
    'id': 'session-id',
    'user_id': 'user-id',
    'membership_id': 'membership-id',
    'company_id': 'company-id',
    'branch_id': 'branch-id',
    'device_id': null,
    'permitted_branch_ids': ['branch-id'],
    'company_wide_access': false,
    'transport_mode': 'browser',
    'refresh_generation': 1,
  },
};

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
