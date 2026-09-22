// TASK 16.17 — parsing of `GET /api/v1/readiness` and the request shape of
// `ApiPosReadinessGateway`, using the same fake-`http.BaseClient` convention
// as `pos_operational_areas_gateway_test.dart`.
import 'dart:convert';

import 'package:as_one/core/networking/api_client.dart';
import 'package:as_one/features/pos/pos_readiness_gateway.dart';
import 'package:as_one/features/pos/pos_readiness_presentation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

const _payload = <String, Object?>{
  'evaluated_at': '2026-09-21T10:00:00.000Z',
  'company': {
    'id': 'company-1',
    'name': 'Empresa Generica QA',
    'currency_code': 'USD',
    'timezone': 'America/New_York',
    'administration_ready': true,
    'checks': [
      {
        'code': 'company_active',
        'scope': 'company',
        'required': true,
        'status': 'ok',
        'surface': 'company',
        'count': null,
        'items': [],
      },
    ],
  },
  'branches': [
    {
      'branch_id': 'branch-1',
      'code': 'QA1',
      'name': 'Sucursal QA',
      'checks': [
        {
          'code': 'product_prices',
          'scope': 'branch',
          'required': true,
          'status': 'warning',
          'surface': 'prices',
          'count': 2,
          'items': [
            {'id': 'p-1', 'label': 'Producto A requiere un precio de venta activo'},
            {'id': 'p-2', 'label': 'Producto B requiere un precio de venta activo'},
          ],
        },
        {
          'code': 'operational_areas',
          'scope': 'branch',
          'required': false,
          'status': 'made_up_status',
          'surface': 'operational_areas',
          'count': 0,
        },
      ],
      'stages': [
        {'key': 'administration', 'ready': true, 'blocked_by': []},
        {
          'key': 'sale',
          'ready': false,
          'blocked_by': ['product_prices'],
        },
        {'key': 'inventory', 'ready': null, 'blocked_by': []},
      ],
    },
  ],
};

void main() {
  test('parses company, branches, checks, items and stages', () {
    final data = PosTenantReadiness.fromJson(_payload);
    expect(data.evaluatedAt, '2026-09-21T10:00:00.000Z');
    expect(data.companyName, 'Empresa Generica QA');
    expect(data.currencyCode, 'USD');
    expect(data.timezone, 'America/New_York');
    expect(data.administrationReady, isTrue);
    expect(data.companyChecks.single.code, 'company_active');
    expect(data.companyChecks.single.status, PosReadinessStatus.ok);
    expect(data.companyChecks.single.count, isNull);
    expect(data.companyChecks.single.items, isEmpty);

    final branch = data.branches.single;
    expect(branch.branchId, 'branch-1');
    expect(branch.name, 'Sucursal QA');
    final prices = branch.checks.first;
    expect(prices.required, isTrue);
    expect(prices.scope, 'branch');
    expect(prices.status, PosReadinessStatus.warning);
    expect(prices.count, 2);
    expect(prices.items.map((i) => i.label), [
      'Producto A requiere un precio de venta activo',
      'Producto B requiere un precio de venta activo',
    ]);
    expect(prices.items.first.id, 'p-1');
  });

  test('a null stage ready stays null; false and true are preserved; blocked_by is read', () {
    final branch = PosTenantReadiness.fromJson(_payload).branches.single;
    expect(branch.stage('administration')!.ready, isTrue);
    expect(branch.stage('sale')!.ready, isFalse);
    expect(branch.stage('sale')!.blockedBy, ['product_prices']);
    expect(branch.stage('inventory')!.ready, isNull);
    expect(branch.stage('register_open'), isNull);
  });

  test('an unknown status parses as notApplicable and a missing items list as empty', () {
    final branch = PosTenantReadiness.fromJson(_payload).branches.single;
    final areas = branch.checks.last;
    expect(areas.status, PosReadinessStatus.notApplicable);
    expect(areas.required, isFalse);
    expect(areas.items, isEmpty);
    expect(PosReadinessStatus.parse('optional_missing'), PosReadinessStatus.optionalMissing);
    expect(PosReadinessStatus.parse('missing'), PosReadinessStatus.missing);
    expect(PosReadinessStatus.parse('anything-else'), PosReadinessStatus.notApplicable);
  });

  test('a tenant with no branches parses to an empty branch list', () {
    final data = PosTenantReadiness.fromJson({
      'evaluated_at': 'x',
      'company': {
        'id': 'c',
        'name': 'n',
        'currency_code': 'MXN',
        'timezone': 'UTC',
        'administration_ready': false,
        'checks': <Object?>[],
      },
      'branches': <Object?>[],
    });
    expect(data.branches, isEmpty);
    expect(data.companyChecks, isEmpty);
    expect(data.administrationReady, isFalse);
  });

  test('readiness() without a branch calls GET /api/v1/readiness with no query and unwraps data', () async {
    late http.BaseRequest captured;
    final gateway = _gateway((request) {
      captured = request;
      return _response(_payload);
    });
    final data = await gateway.readiness();
    expect(captured.method, 'GET');
    expect(captured.url.path, '/api/v1/readiness');
    expect(captured.url.queryParameters, isEmpty);
    expect(data.branches, hasLength(1));
  });

  test('readiness(branchId:) sends branch_id as a query parameter', () async {
    late http.BaseRequest captured;
    final gateway = _gateway((request) {
      captured = request;
      return _response(_payload);
    });
    await gateway.readiness(branchId: 'branch-1');
    expect(captured.method, 'GET');
    expect(captured.url.path, '/api/v1/readiness');
    expect(captured.url.queryParameters['branch_id'], 'branch-1');
  });

  test('a response without a data object is a FormatException', () async {
    final gateway = _gateway(
      (request) => http.Response(
        jsonEncode({
          'data': 'nope',
          'meta': {'request_id': 'r', 'correlation_id': 'c'},
        }),
        200,
      ),
    );
    await expectLater(gateway.readiness(), throwsA(isA<FormatException>()));
  });

  test('the empty gateway returns a readiness with no branches and no checks', () async {
    final data = await const EmptyPosReadinessGateway().readiness();
    expect(data.branches, isEmpty);
    expect(data.companyChecks, isEmpty);
  });
}

ApiPosReadinessGateway _gateway(http.Response Function(http.BaseRequest request) handler) => ApiPosReadinessGateway(
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
