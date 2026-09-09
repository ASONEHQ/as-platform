/// TASK 15.1 Phase 4 — the Flutter side of `catalog.routes.ts`'s CATEGORY
/// endpoints (`GET/POST /api/v1/categories`, `PATCH /api/v1/categories/:id`
/// — `catalog.routes.ts:141,170,231,250`). Before this file, categories had
/// **zero** Flutter admin surface at all: `pos_read_gateway.dart` only ever
/// called `GET /api/v1/categories` to populate a filter list, and
/// `PosModule.categories` fell through to `pos_shell.dart`'s
/// `_ComingSoon` placeholder (see `docs/RC_RELEASE_INVENTORY.md`'s POS
/// section, "Categories (catalog)" row).
///
/// Styled after `pos_suppliers_gateway.dart` (abstract interface + `Api...`/
/// `Empty...` implementations, `PosX`/`PosXPage` model classes with
/// `fromJson`/`toJson`) with the divergences the real contract itself
/// requires:
///   * A category DOES carry a real `version` (`categoryHttp()` in
///     `catalog.routes.ts`) — `PATCH` requires it as `If-Match`, mirroring
///     `pos_product_variants_gateway.dart`'s own optimistic-concurrency
///     shape, never `pos_suppliers_gateway.dart`'s versionless PATCH.
///   * `code` is required on create and immutable afterwards —
///     `categoryPatchSchema` carries no `code` property at all, so
///     [PosCategoryInput] has no way to change it post-creation.
///   * Deletion is soft (`status: retired`), never a hard DELETE — there is
///     no DELETE route on `/api/v1/categories` at all; this gateway
///     deliberately exposes none.
///   * A cleared/empty text field is OMITTED from the request body, never
///     sent as an explicit JSON `null` — the same convention every other
///     admin gateway in this app already follows for its own optional
///     nullable fields (see `pos_product_variants_gateway.dart`'s
///     `PosProductVariantInput.toJson`), even though the backend schema
///     would also accept an explicit `null` for `description`/`parent_id`.
library;

import '../../core/networking/api_client.dart';

/// A `product_categories` row (`Category`/`categoryHttp()` in
/// `catalog.routes.ts`) — the FULL record, returned identically by
/// `GET /categories`, `POST /categories`, and `PATCH /categories/{id}`.
class PosCatalogCategory {
  const PosCatalogCategory({
    required this.id,
    required this.parentId,
    required this.code,
    required this.name,
    required this.description,
    required this.sortOrder,
    required this.status,
    required this.visualTile,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
  });

  factory PosCatalogCategory.fromJson(Map<String, Object?> json) => PosCatalogCategory(
    id: json['id']! as String,
    parentId: json['parent_id'] as String?,
    code: json['code']! as String,
    name: json['name']! as String,
    description: json['description'] as String?,
    sortOrder: json['sort_order']! as int,
    status: json['status']! as String,
    visualTile: json['visual_tile']! as bool,
    version: json['version']! as int,
    createdAt: DateTime.parse(json['created_at']! as String),
    updatedAt: DateTime.parse(json['updated_at']! as String),
  );

  final String id;
  final String? parentId;
  final String code;
  final String name;
  final String? description;
  final int sortOrder;

  /// `active` | `inactive` | `retired`.
  final String status;
  final bool visualTile;
  final int version;
  final DateTime createdAt;
  final DateTime updatedAt;
}

class PosCatalogCategoryPage {
  const PosCatalogCategoryPage({required this.items, required this.nextCursor});
  final List<PosCatalogCategory> items;
  final String? nextCursor;
}

/// The create/patch input both `POST /categories` and
/// `PATCH /categories/{id}` accept. `code`/`name` are only backend-required
/// on create (`categoryCreateSchema`) — the caller-side form is responsible
/// for enforcing that before calling
/// [PosCategoryAdminGateway.createCategory]. `code` is never sent on an
/// update — see this file's own header note.
class PosCategoryInput {
  const PosCategoryInput({
    this.code,
    this.name,
    this.parentId,
    this.description,
    this.sortOrder,
    this.status,
    this.visualTile,
  });

  final String? code;
  final String? name;
  final String? parentId;
  final String? description;
  final int? sortOrder;

  /// `active` | `inactive` | `retired`.
  final String? status;
  final bool? visualTile;

  Map<String, Object?> toJson() => {
    if (code != null) 'code': code,
    if (name != null) 'name': name,
    if (parentId != null) 'parent_id': parentId,
    if (description != null) 'description': description,
    if (sortOrder != null) 'sort_order': sortOrder,
    if (status != null) 'status': status,
    if (visualTile != null) 'visual_tile': visualTile,
  };
}

abstract interface class PosCategoryAdminGateway {
  /// `GET /api/v1/categories` (`catalog.read`).
  Future<PosCatalogCategoryPage> listCategories({
    String? cursor,
    int limit = 50,
    String? status,
    String? search,
  });

  /// `POST /api/v1/categories` (`category.manage`) — requires
  /// `Idempotency-Key` (ADR-0005); throws [ApiException] honestly on any
  /// rejection.
  Future<PosCatalogCategory> createCategory(PosCategoryInput input);

  /// `PATCH /api/v1/categories/{id}` (`category.manage`) — requires
  /// `If-Match` carrying the category's own current [version] (optimistic
  /// concurrency); throws [ApiException] honestly, including a 409 on a
  /// stale version.
  Future<PosCatalogCategory> updateCategory(String id, int version, PosCategoryInput input);
}

class ApiPosCategoryAdminGateway implements PosCategoryAdminGateway {
  const ApiPosCategoryAdminGateway(this._client);

  final ApiClient _client;

  @override
  Future<PosCatalogCategoryPage> listCategories({
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
    final path = Uri(path: '/api/v1/categories', queryParameters: query).toString();
    final envelope = await _client.getJson(path);
    final data = envelope['data'];
    if (data is! List<Object?>) {
      throw const FormatException('Missing categories list data.');
    }
    final meta = envelope['meta'];
    final page = meta is Map<String, Object?> ? meta['page'] : null;
    final nextCursor = page is Map<String, Object?> ? page['next_cursor'] as String? : null;
    return PosCatalogCategoryPage(
      items: data
          .whereType<Map<String, Object?>>()
          .map(PosCatalogCategory.fromJson)
          .toList(growable: false),
      nextCursor: nextCursor,
    );
  }

  @override
  Future<PosCatalogCategory> createCategory(PosCategoryInput input) async {
    final envelope = await _client.postJson(
      '/api/v1/categories',
      idempotencyKey: _idempotencyKey(),
      body: input.toJson(),
    );
    return _decode(envelope);
  }

  @override
  Future<PosCatalogCategory> updateCategory(String id, int version, PosCategoryInput input) async {
    final envelope = await _client.patchJson(
      '/api/v1/categories/$id',
      ifMatch: '"$version"',
      body: input.toJson(),
    );
    return _decode(envelope);
  }

  static String _idempotencyKey() =>
      'one-category-${DateTime.now().toUtc().microsecondsSinceEpoch}';

  PosCatalogCategory _decode(Map<String, Object?> envelope) {
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing category data.');
    }
    return PosCatalogCategory.fromJson(data);
  }
}

class EmptyPosCategoryAdminGateway implements PosCategoryAdminGateway {
  const EmptyPosCategoryAdminGateway();

  @override
  Future<PosCatalogCategoryPage> listCategories({
    String? cursor,
    int limit = 50,
    String? status,
    String? search,
  }) async => const PosCatalogCategoryPage(items: [], nextCursor: null);

  @override
  Future<PosCatalogCategory> createCategory(PosCategoryInput input) =>
      Future.error(StateError('No category admin gateway is configured.'));

  @override
  Future<PosCatalogCategory> updateCategory(String id, int version, PosCategoryInput input) =>
      Future.error(StateError('No category admin gateway is configured.'));
}
