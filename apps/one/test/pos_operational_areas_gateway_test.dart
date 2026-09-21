// TASK 16.15 — mirrors `auth_gateway_test.dart`'s own fake-`http.BaseClient`
// gateway-test convention: a real `ApiClient` wrapping a `_FakeClient` that
// hands back a canned response, asserting on the captured real HTTP
// request and the gateway's own decoded model output.
import 'dart:convert';

import 'package:as_one/core/networking/api_client.dart';
import 'package:as_one/features/pos/pos_operational_areas_gateway.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

void main() {
  test('listAreas sends branch_id/status/limit and decodes a real page', () async {
    late http.BaseRequest captured;
    final gateway = _gateway((request) {
      captured = request;
      return http.Response(
        jsonEncode({
          'data': [
            {
              'id': 'area-1',
              'branch_id': 'branch-1',
              'code': 'ADMISIONES',
              'name': 'Admisiones',
              'status': 'active',
              'version': 1,
              'created_at': '2026-01-01T00:00:00.000Z',
              'updated_at': '2026-01-01T00:00:00.000Z',
            },
          ],
          'meta': {
            'request_id': 'request',
            'correlation_id': 'correlation',
            'page': {'next_cursor': 'cursor-2', 'has_more': true},
          },
        }),
        200,
      );
    });
    final page = await gateway.listAreas(branchId: 'branch-1', status: 'active');
    expect(captured.url.path, '/api/v1/operational-areas');
    expect(captured.url.queryParameters['branch_id'], 'branch-1');
    expect(captured.url.queryParameters['status'], 'active');
    expect(page.items, hasLength(1));
    expect(page.items.single.name, 'Admisiones');
    expect(page.items.single.code, 'ADMISIONES');
    expect(page.items.single.version, 1);
    expect(page.nextCursor, 'cursor-2');
  });

  test('createArea sends an Idempotency-Key header and the real body', () async {
    late http.Request captured;
    final gateway = _gateway((request) {
      captured = request as http.Request;
      return _response({
        'id': 'area-2',
        'branch_id': 'branch-1',
        'code': 'TAQUILLA',
        'name': 'Taquilla',
        'status': 'active',
        'version': 1,
        'created_at': '2026-01-01T00:00:00.000Z',
        'updated_at': '2026-01-01T00:00:00.000Z',
      });
    });
    final created = await gateway.createArea(
      const PosOperationalAreaInput(branchId: 'branch-1', code: 'TAQUILLA', name: 'Taquilla'),
    );
    expect(captured.headers, contains('Idempotency-Key'));
    final body = jsonDecode(captured.body) as Map<String, Object?>;
    expect(body['branch_id'], 'branch-1');
    expect(body['code'], 'TAQUILLA');
    expect(body['name'], 'Taquilla');
    expect(body, isNot(contains('status')));
    expect(created.id, 'area-2');
  });

  test('updateArea sends If-Match carrying the real version, never the code', () async {
    late http.Request captured;
    final gateway = _gateway((request) {
      captured = request as http.Request;
      return _response({
        'id': 'area-2',
        'branch_id': 'branch-1',
        'code': 'TAQUILLA',
        'name': 'Taquilla Renombrada',
        'status': 'inactive',
        'version': 2,
        'created_at': '2026-01-01T00:00:00.000Z',
        'updated_at': '2026-01-02T00:00:00.000Z',
      });
    });
    final updated = await gateway.updateArea(
      'area-2',
      1,
      const PosOperationalAreaInput(name: 'Taquilla Renombrada', status: 'inactive'),
    );
    expect(captured.method, 'PUT');
    expect(captured.url.path, '/api/v1/operational-areas/area-2');
    expect(captured.headers['If-Match'], '"1"');
    final body = jsonDecode(captured.body) as Map<String, Object?>;
    expect(body['name'], 'Taquilla Renombrada');
    expect(body['status'], 'inactive');
    expect(body, isNot(contains('code')));
    expect(updated.status, 'inactive');
    expect(updated.version, 2);
  });

  test('EmptyPosOperationalAreasGateway returns an honest empty page and throws on mutation', () async {
    const gateway = EmptyPosOperationalAreasGateway();
    final page = await gateway.listAreas();
    expect(page.items, isEmpty);
    expect(page.nextCursor, isNull);
    await expectLater(
      gateway.createArea(const PosOperationalAreaInput(branchId: 'b', code: 'c', name: 'n')),
      throwsA(isA<StateError>()),
    );
  });
}

ApiPosOperationalAreasGateway _gateway(
  http.Response Function(http.BaseRequest request) handler,
) => ApiPosOperationalAreasGateway(
  ApiClient(
    baseUrl: Uri.parse('https://api.test.asone.mx/'),
    transport: _FakeClient(handler),
    readAccessToken: () => 'access-token',
    createCorrelationId: () => 'correlation-test',
  ),
);

http.Response _response(Object data) => http.Response(
  jsonEncode({
    'data': data,
    'meta': {'request_id': 'request', 'correlation_id': 'correlation'},
  }),
  200,
);

class _FakeClient extends http.BaseClient {
  _FakeClient(this.handler);
  final http.Response Function(http.BaseRequest request) handler;
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final response = handler(request);
    return http.StreamedResponse(Stream.value(response.bodyBytes), response.statusCode, headers: response.headers);
  }
}
