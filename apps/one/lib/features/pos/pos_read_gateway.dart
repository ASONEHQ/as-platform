import '../../core/networking/api_client.dart';
import 'pos_models.dart';

abstract interface class PosReadGateway {
  // TASK 12.3C: `branchId`, when supplied, resolves that branch's
  // price override ahead of the company-wide default (ADR-0006: this only
  // ever narrows to an authorized branch, never widens scope) — see
  // `GET /api/v1/products`'s `branch_id` query param,
  // docs/API_CONTRACTS.md §14.2.
  Future<List<PosProduct>> products({String? branchId});

  /// TASK 14.3 (Wave 1, Part B.2): an EXACT barcode lookup via the
  /// already-working `GET /api/v1/products?barcode=` filter
  /// (`product-catalog.routes.ts`) — never a fuzzy/name match. `null`
  /// when no product carries that exact barcode; this app must show an
  /// honest "not found" state for that case, never a fabricated/random
  /// match (the exact fix for the legacy screen's own fake behavior).
  Future<PosProduct?> productByBarcode(String barcode, {String? branchId});
  Future<List<PosCategory>> categories();
  Future<List<PosInventoryBalance>> inventoryBalances({String? branchId});
  Future<List<PosUser>> users();
}

class ApiPosReadGateway implements PosReadGateway {
  const ApiPosReadGateway(this._client);

  final ApiClient _client;

  @override
  Future<List<PosProduct>> products({String? branchId}) async {
    final query = branchId == null ? '' : '&branch_id=$branchId';
    return _items(
      await _client.getJson('/api/v1/products?limit=100$query'),
    ).map(PosProduct.fromJson).toList(growable: false);
  }

  @override
  Future<PosProduct?> productByBarcode(String barcode, {String? branchId}) async {
    final query = <String, String>{
      'limit': '1',
      'barcode': barcode,
      if (branchId != null) 'branch_id': branchId,
    };
    final path = Uri(path: '/api/v1/products', queryParameters: query).toString();
    final matches = _items(await _client.getJson(path)).map(PosProduct.fromJson).toList(growable: false);
    return matches.isEmpty ? null : matches.first;
  }

  @override
  Future<List<PosCategory>> categories() async => _items(
    await _client.getJson('/api/v1/categories?limit=100'),
  ).map(PosCategory.fromJson).toList(growable: false);

  @override
  Future<List<PosInventoryBalance>> inventoryBalances({
    String? branchId,
  }) async {
    final query = branchId == null ? '' : '&branch_id=$branchId';
    return _items(
      await _client.getJson('/api/v1/inventory/balances?limit=100$query'),
    ).map(PosInventoryBalance.fromJson).toList(growable: false);
  }

  @override
  Future<List<PosUser>> users() async => _items(
    await _client.getJson('/api/v1/users'),
  ).map(PosUser.fromJson).toList(growable: false);

  List<Map<String, Object?>> _items(Map<String, Object?> envelope) {
    final data = envelope['data'];
    final raw = data is List<Object?>
        ? data
        : data is Map<String, Object?> && data['items'] is List<Object?>
        ? data['items']! as List<Object?>
        : throw const FormatException('Missing data items.');
    return raw
        .map(
          (item) => item is Map<String, Object?>
              ? item
              : throw const FormatException('Invalid data item.'),
        )
        .toList(growable: false);
  }
}

class EmptyPosReadGateway implements PosReadGateway {
  const EmptyPosReadGateway();

  @override
  Future<List<PosProduct>> products({String? branchId}) async => const [];

  @override
  Future<PosProduct?> productByBarcode(String barcode, {String? branchId}) async => null;

  @override
  Future<List<PosCategory>> categories() async => const [];

  @override
  Future<List<PosInventoryBalance>> inventoryBalances({
    String? branchId,
  }) async => const [];

  @override
  Future<List<PosUser>> users() async => const [];
}
