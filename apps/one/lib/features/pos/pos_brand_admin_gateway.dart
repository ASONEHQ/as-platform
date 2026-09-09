/// TASK 15.1 Phase 4 — the Flutter side of `catalog.routes.ts`'s BRAND
/// endpoints (`GET/POST /api/v1/brands`, `PATCH /api/v1/brands/:id` —
/// `catalog.routes.ts:305,333,379`). Before this file, brands had **zero**
/// Flutter usage anywhere in the app (`docs/RC_RELEASE_INVENTORY.md`'s POS
/// section, "Brands" row — a grep for `/api/v1/brands` across
/// `apps/one/lib` previously returned nothing).
///
/// Styled after `pos_category_admin_gateway.dart` (this wave's own sibling
/// — see that file's header for the shared reasoning: real `version`/
/// `If-Match` concurrency, immutable `code` after create, soft
/// deactivation only, omit-don't-null-out optional fields), minus the
/// fields a brand simply doesn't have (`parent_id`, `sort_order`,
/// `visual_tile` — see `brandProperties` vs. `categoryProperties` in
/// `catalog.schemas.ts`: a brand is a flatter record).
library;

import '../../core/networking/api_client.dart';

/// A `brands` row (`Brand`/`brandHttp()` in `catalog.routes.ts`) — the FULL
/// record, returned identically by `GET /brands`, `POST /brands`, and
/// `PATCH /brands/{id}`.
class PosCatalogBrand {
  const PosCatalogBrand({
    required this.id,
    required this.code,
    required this.name,
    required this.description,
    required this.status,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
  });

  factory PosCatalogBrand.fromJson(Map<String, Object?> json) => PosCatalogBrand(
    id: json['id']! as String,
    code: json['code']! as String,
    name: json['name']! as String,
    description: json['description'] as String?,
    status: json['status']! as String,
    version: json['version']! as int,
    createdAt: DateTime.parse(json['created_at']! as String),
    updatedAt: DateTime.parse(json['updated_at']! as String),
  );

  final String id;
  final String code;
  final String name;
  final String? description;

  /// `active` | `inactive` | `retired`.
  final String status;
  final int version;
  final DateTime createdAt;
  final DateTime updatedAt;
}

class PosCatalogBrandPage {
  const PosCatalogBrandPage({required this.items, required this.nextCursor});
  final List<PosCatalogBrand> items;
  final String? nextCursor;
}

/// The create/patch input both `POST /brands` and `PATCH /brands/{id}`
/// accept. `code`/`name` are only backend-required on create
/// (`brandCreateSchema`) — the caller-side form enforces that before
/// calling [PosBrandAdminGateway.createBrand]. `code` is never sent on an
/// update — `brandPatchSchema` carries no `code` property at all.
class PosBrandInput {
  const PosBrandInput({this.code, this.name, this.description, this.status});

  final String? code;
  final String? name;
  final String? description;

  /// `active` | `inactive` | `retired`.
  final String? status;

  Map<String, Object?> toJson() => {
    if (code != null) 'code': code,
    if (name != null) 'name': name,
    if (description != null) 'description': description,
    if (status != null) 'status': status,
  };
}

abstract interface class PosBrandAdminGateway {
  /// `GET /api/v1/brands` (`catalog.read`).
  Future<PosCatalogBrandPage> listBrands({String? cursor, int limit = 50, String? status, String? search});

  /// `POST /api/v1/brands` (`product.manage`) — requires `Idempotency-Key`
  /// (ADR-0005); throws [ApiException] honestly on any rejection.
  Future<PosCatalogBrand> createBrand(PosBrandInput input);

  /// `PATCH /api/v1/brands/{id}` (`product.manage`) — requires `If-Match`
  /// carrying the brand's own current [version] (optimistic concurrency);
  /// throws [ApiException] honestly, including a 409 on a stale version.
  Future<PosCatalogBrand> updateBrand(String id, int version, PosBrandInput input);
}

class ApiPosBrandAdminGateway implements PosBrandAdminGateway {
  const ApiPosBrandAdminGateway(this._client);

  final ApiClient _client;

  @override
  Future<PosCatalogBrandPage> listBrands({
    String? cursor,
    int limit = 50,
    String? status,
    String? search,
  }) async {
    final query = <String, String>{
      'limit': '$limit',
      if (cursor != null) 'cursor': cursor,
      if (status != null) 'status': status,
      if (search != null) 'search': search,
    };
    final path = Uri(path: '/api/v1/brands', queryParameters: query).toString();
    final envelope = await _client.getJson(path);
    final data = envelope['data'];
    if (data is! List<Object?>) {
      throw const FormatException('Missing brands list data.');
    }
    final meta = envelope['meta'];
    final page = meta is Map<String, Object?> ? meta['page'] : null;
    final nextCursor = page is Map<String, Object?> ? page['next_cursor'] as String? : null;
    return PosCatalogBrandPage(
      items: data.whereType<Map<String, Object?>>().map(PosCatalogBrand.fromJson).toList(growable: false),
      nextCursor: nextCursor,
    );
  }

  @override
  Future<PosCatalogBrand> createBrand(PosBrandInput input) async {
    final envelope = await _client.postJson(
      '/api/v1/brands',
      idempotencyKey: _idempotencyKey(),
      body: input.toJson(),
    );
    return _decode(envelope);
  }

  @override
  Future<PosCatalogBrand> updateBrand(String id, int version, PosBrandInput input) async {
    final envelope = await _client.patchJson(
      '/api/v1/brands/$id',
      ifMatch: '"$version"',
      body: input.toJson(),
    );
    return _decode(envelope);
  }

  static String _idempotencyKey() => 'one-brand-${DateTime.now().toUtc().microsecondsSinceEpoch}';

  PosCatalogBrand _decode(Map<String, Object?> envelope) {
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing brand data.');
    }
    return PosCatalogBrand.fromJson(data);
  }
}

class EmptyPosBrandAdminGateway implements PosBrandAdminGateway {
  const EmptyPosBrandAdminGateway();

  @override
  Future<PosCatalogBrandPage> listBrands({
    String? cursor,
    int limit = 50,
    String? status,
    String? search,
  }) async => const PosCatalogBrandPage(items: [], nextCursor: null);

  @override
  Future<PosCatalogBrand> createBrand(PosBrandInput input) =>
      Future.error(StateError('No brand admin gateway is configured.'));

  @override
  Future<PosCatalogBrand> updateBrand(String id, int version, PosBrandInput input) =>
      Future.error(StateError('No brand admin gateway is configured.'));
}
