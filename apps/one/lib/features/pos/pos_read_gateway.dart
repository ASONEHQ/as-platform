import '../../core/networking/api_client.dart';
import 'pos_models.dart';

abstract interface class PosReadGateway {
  Future<List<PosProduct>> products();
  Future<List<PosCategory>> categories();
  Future<List<PosInventoryBalance>> inventoryBalances({String? branchId});
  Future<List<PosUser>> users();
}

class ApiPosReadGateway implements PosReadGateway {
  const ApiPosReadGateway(this._client);

  final ApiClient _client;

  @override
  Future<List<PosProduct>> products() async => _items(
    await _client.getJson('/api/v1/products?limit=100'),
  ).map(PosProduct.fromJson).toList(growable: false);

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
  Future<List<PosProduct>> products() async => const [];

  @override
  Future<List<PosCategory>> categories() async => const [];

  @override
  Future<List<PosInventoryBalance>> inventoryBalances({
    String? branchId,
  }) async => const [];

  @override
  Future<List<PosUser>> users() async => const [];
}
