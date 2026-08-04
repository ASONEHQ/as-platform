import 'dart:convert';

import 'package:as_one/core/networking/api_client.dart';
import 'package:as_one/features/pos/pos_read_gateway.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

void main() {
  test('consumes only the four approved read endpoints', () async {
    final paths = <String>[];
    final gateway = ApiPosReadGateway(
      ApiClient(
        baseUrl: Uri.parse('https://api.test.asone.mx/'),
        transport: _FakeClient((request) {
          paths.add('${request.method} ${request.url.path}');
          final data = switch (request.url.path) {
            '/api/v1/products' => [
              {
                'id': 'product-id',
                'code': 'P-001',
                'name': 'Producto',
                'product_type': 'simple',
                'status': 'active',
                'tracks_inventory': true,
                'category_id': 'cat-1',
              },
            ],
            '/api/v1/categories' => [
              {'id': 'cat-1', 'name': 'Categoría', 'status': 'active'},
            ],
            '/api/v1/inventory/balances' => [
              {
                'id': 'balance-id',
                'branch_id': 'branch-id',
                'inventory_location_id': 'location-id',
                'product_variant_id': 'variant-id',
                'quantity_on_hand': '12.000000',
                'quantity_reserved': '2.000000',
                'quantity_in_transit': '1.000000',
              },
            ],
            '/api/v1/users' => {
              'items': [
                {
                  'id': 'user-id',
                  'email': 'user@example.test',
                  'display_name': 'Usuario',
                  'identity_status': 'active',
                  'membership_status': 'active',
                },
              ],
            },
            _ => throw StateError('Unexpected endpoint ${request.url.path}'),
          };
          return http.Response(
            jsonEncode({'data': data}),
            200,
            headers: {'content-type': 'application/json'},
          );
        }),
        readAccessToken: () => 'memory-token',
        createCorrelationId: () => 'correlation-test',
      ),
    );

    final product = (await gateway.products()).single;
    expect(product.name, 'Producto');
    expect(product.categoryId, 'cat-1');
    expect((await gateway.categories()).single.name, 'Categoría');
    expect(
      (await gateway.inventoryBalances(branchId: 'branch-id')).single.onHand,
      '12.000000',
    );
    expect((await gateway.users()).single.displayName, 'Usuario');
    expect(paths, [
      'GET /api/v1/products',
      'GET /api/v1/categories',
      'GET /api/v1/inventory/balances',
      'GET /api/v1/users',
    ]);
  });
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
