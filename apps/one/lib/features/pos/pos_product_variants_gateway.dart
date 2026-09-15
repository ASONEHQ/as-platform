/// TASK 12.2 — the Flutter side of `product-catalog.routes.ts`'s product
/// VARIANT endpoints (`GET /api/v1/products`, `GET .../:product_id/
/// variants`, `POST .../:product_id/variants`, `GET /api/v1/
/// product-variants/:id`, `PATCH /api/v1/product-variants/:id`). Styled
/// EXACTLY after `pos_suppliers_gateway.dart` (this wave's assigned
/// structural template) — abstract interface class + `Api...`
/// implementation + `Empty...` implementation, `PosX`/`PosXPage` model
/// classes with `fromJson`/`toJson`, and the same idempotency-key
/// generation shape for the `POST`.
///
/// Two real backend contract quirks this file must honor, per
/// `variantHttp()` in `product-catalog.routes.ts`:
///   * `standard_cost`/`currency_code` are OMITTED ENTIRELY (not `null`)
///     from a variant's JSON unless the caller holds `inventory.cost.read`
///     — so [PosProductVariant.fromJson] treats both as genuinely
///     optional/absent-safe, never a required field.
///   * A variant's `version` (used for optimistic concurrency on
///     `PATCH .../product-variants/:id` via `If-Match`) is a real
///     server-assigned integer — never invented client-side.
library;

import '../../core/networking/api_client.dart';

/// A lightweight `products` list row — just enough for the product picker
/// (`GET /api/v1/products`'s own list shape, per `productHttp()`; the full
/// product record carries more fields this picker has no use for).
class PosVariantProduct {
  const PosVariantProduct({
    required this.id,
    required this.code,
    required this.name,
    required this.status,
    required this.defaultVariantSku,
  });

  factory PosVariantProduct.fromJson(Map<String, Object?> json) {
    final defaultVariant = json['default_variant'];
    final defaultVariantSku = defaultVariant is Map<String, Object?>
        ? defaultVariant['sku'] as String?
        : null;
    return PosVariantProduct(
      id: json['id']! as String,
      code: json['code']! as String,
      name: json['name']! as String,
      status: json['status']! as String,
      defaultVariantSku: defaultVariantSku,
    );
  }

  final String id;
  final String code;
  final String name;

  /// `draft` | `active` | `inactive` | `retired`.
  final String status;
  final String? defaultVariantSku;
}

class PosVariantProductPage {
  const PosVariantProductPage({required this.items, required this.nextCursor});
  final List<PosVariantProduct> items;
  final String? nextCursor;
}

/// A `product_variants` row (`ProductVariantRow`/`variantHttp()` in
/// `product-catalog.routes.ts`) — the full shape returned identically by
/// `GET .../variants`, `POST .../variants`, `GET /product-variants/{id}`
/// and `PATCH /product-variants/{id}`.
class PosProductVariant {
  const PosProductVariant({
    required this.id,
    required this.productId,
    required this.sku,
    required this.name,
    required this.unitOfMeasureCode,
    required this.quantityScale,
    required this.tracksInventory,
    required this.standardCost,
    required this.currencyCode,
    this.minStock,
    required this.isDefault,
    required this.status,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
  });

  factory PosProductVariant.fromJson(Map<String, Object?> json) => PosProductVariant(
    id: json['id']! as String,
    productId: json['product_id']! as String,
    sku: json['sku']! as String,
    name: json['name'] as String?,
    unitOfMeasureCode: json['unit_of_measure_code']! as String,
    quantityScale: json['quantity_scale']! as int,
    tracksInventory: json['tracks_inventory']! as bool,
    // Absent entirely (not `null`) when the caller lacks
    // `inventory.cost.read` — see this file's own header note.
    standardCost: json['standard_cost'] as String?,
    currencyCode: json['currency_code'] as String?,
    // TASK 16.6B — legacy "Stock mínimo" parity (`min_stock` on
    // `variantHttp()`; unlike `standard_cost`, always present in the
    // response, `null` meaning "no threshold configured", never gated
    // behind `inventory.cost.read`).
    minStock: json['min_stock'] as String?,
    isDefault: json['is_default']! as bool,
    status: json['status']! as String,
    version: json['version']! as int,
    createdAt: DateTime.parse(json['created_at']! as String),
    updatedAt: DateTime.parse(json['updated_at']! as String),
  );

  final String id;
  final String productId;
  final String sku;
  final String? name;
  final String unitOfMeasureCode;
  final int quantityScale;
  final bool tracksInventory;

  /// `null` both when the backend genuinely omitted it (no
  /// `inventory.cost.read`) and when this local record simply hasn't been
  /// fetched with cost visibility yet — never fabricated either way.
  final String? standardCost;
  final String? currencyCode;

  /// `null` = no reorder-point threshold configured for this variant.
  final String? minStock;
  final bool isDefault;

  /// `active` | `inactive` | `retired`.
  final String status;
  final int version;
  final DateTime createdAt;
  final DateTime updatedAt;
}

class PosProductVariantPage {
  const PosProductVariantPage({required this.items, required this.nextCursor});
  final List<PosProductVariant> items;
  final String? nextCursor;
}

/// The create/patch input both `POST .../variants` and
/// `PATCH /product-variants/{id}` accept. Every field is optional here —
/// the backend itself is what requires `sku`/`unit_of_measure_code` on
/// create (`variantBodySchema` in `product-catalog.routes.ts`); the
/// caller-side form is responsible for enforcing that before calling
/// [PosProductVariantsGateway.createVariant].
class PosProductVariantInput {
  const PosProductVariantInput({
    this.sku,
    this.name,
    this.unitOfMeasureCode,
    this.quantityScale,
    this.tracksInventory,
    this.standardCost,
    this.currencyCode,
    this.minStock,
    this.clearMinStock = false,
    this.isDefault,
    this.status,
  });

  final String? sku;
  final String? name;
  final String? unitOfMeasureCode;
  final int? quantityScale;
  final bool? tracksInventory;
  final String? standardCost;
  final String? currencyCode;

  /// TASK 16.6B — legacy "Stock mínimo" parity.
  final String? minStock;

  /// `true` explicitly clears `min_stock` back to "no threshold" — a
  /// plain `T?` alone cannot distinguish "omit this field" from "set it
  /// to JSON `null`" the way the backend's own optional-vs-nullable PATCH
  /// field does.
  final bool clearMinStock;
  final bool? isDefault;
  final String? status;

  Map<String, Object?> toJson() => {
    if (sku != null) 'sku': sku,
    if (name != null) 'name': name,
    if (unitOfMeasureCode != null) 'unit_of_measure_code': unitOfMeasureCode,
    if (quantityScale != null) 'quantity_scale': quantityScale,
    if (tracksInventory != null) 'tracks_inventory': tracksInventory,
    if (standardCost != null) 'standard_cost': standardCost,
    if (currencyCode != null) 'currency_code': currencyCode,
    if (clearMinStock)
      'min_stock': null
    else if (minStock != null)
      'min_stock': minStock,
    if (isDefault != null) 'is_default': isDefault,
    if (status != null) 'status': status,
  };
}

abstract interface class PosProductVariantsGateway {
  /// `GET /api/v1/products` (`catalog.read`) — only sends `search` when
  /// provided; `limit` is always sent.
  Future<PosVariantProductPage> listProducts({String? cursor, int limit = 50, String? search});

  /// `GET /api/v1/products/{product_id}/variants` (`catalog.read`).
  Future<PosProductVariantPage> listVariants(
    String productId, {
    String? cursor,
    int limit = 50,
    String? status,
  });

  /// `POST /api/v1/products/{product_id}/variants` (`product.manage`) —
  /// requires `Idempotency-Key` (ADR-0005); throws [ApiException] honestly
  /// on any rejection.
  Future<PosProductVariant> createVariant(String productId, PosProductVariantInput input);

  /// `PATCH /api/v1/product-variants/{id}` (`product.manage`) — requires
  /// `If-Match` carrying the variant's own current [version] (optimistic
  /// concurrency); throws [ApiException] honestly, including a 409 on a
  /// stale version.
  Future<PosProductVariant> updateVariant(String id, int version, PosProductVariantInput input);
}

class ApiPosProductVariantsGateway implements PosProductVariantsGateway {
  const ApiPosProductVariantsGateway(this._client);

  final ApiClient _client;

  @override
  Future<PosVariantProductPage> listProducts({String? cursor, int limit = 50, String? search}) async {
    final query = <String, String>{
      'limit': '$limit',
      if (cursor != null) 'cursor': cursor,
      if (search != null) 'search': search,
    };
    final path = Uri(path: '/api/v1/products', queryParameters: query).toString();
    final envelope = await _client.getJson(path);
    final data = envelope['data'];
    if (data is! List<Object?>) {
      throw const FormatException('Missing products list data.');
    }
    final meta = envelope['meta'];
    final page = meta is Map<String, Object?> ? meta['page'] : null;
    final nextCursor = page is Map<String, Object?> ? page['next_cursor'] as String? : null;
    return PosVariantProductPage(
      items: data
          .whereType<Map<String, Object?>>()
          .map(PosVariantProduct.fromJson)
          .toList(growable: false),
      nextCursor: nextCursor,
    );
  }

  @override
  Future<PosProductVariantPage> listVariants(
    String productId, {
    String? cursor,
    int limit = 50,
    String? status,
  }) async {
    final query = <String, String>{
      'limit': '$limit',
      if (cursor != null) 'cursor': cursor,
      if (status != null) 'status': status,
    };
    final path = Uri(
      path: '/api/v1/products/$productId/variants',
      queryParameters: query,
    ).toString();
    final envelope = await _client.getJson(path);
    final data = envelope['data'];
    if (data is! List<Object?>) {
      throw const FormatException('Missing product variants list data.');
    }
    final meta = envelope['meta'];
    final page = meta is Map<String, Object?> ? meta['page'] : null;
    final nextCursor = page is Map<String, Object?> ? page['next_cursor'] as String? : null;
    return PosProductVariantPage(
      items: data
          .whereType<Map<String, Object?>>()
          .map(PosProductVariant.fromJson)
          .toList(growable: false),
      nextCursor: nextCursor,
    );
  }

  @override
  Future<PosProductVariant> createVariant(String productId, PosProductVariantInput input) async {
    final envelope = await _client.postJson(
      '/api/v1/products/$productId/variants',
      idempotencyKey: _idempotencyKey(),
      body: input.toJson(),
    );
    return _decode(envelope);
  }

  @override
  Future<PosProductVariant> updateVariant(
    String id,
    int version,
    PosProductVariantInput input,
  ) async {
    final envelope = await _client.patchJson(
      '/api/v1/product-variants/$id',
      ifMatch: '"$version"',
      body: input.toJson(),
    );
    return _decode(envelope);
  }

  static String _idempotencyKey() =>
      'one-variant-${DateTime.now().toUtc().microsecondsSinceEpoch}';

  PosProductVariant _decode(Map<String, Object?> envelope) {
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing product variant data.');
    }
    return PosProductVariant.fromJson(data);
  }
}

class EmptyPosProductVariantsGateway implements PosProductVariantsGateway {
  const EmptyPosProductVariantsGateway();

  @override
  Future<PosVariantProductPage> listProducts({String? cursor, int limit = 50, String? search}) async =>
      const PosVariantProductPage(items: [], nextCursor: null);

  @override
  Future<PosProductVariantPage> listVariants(
    String productId, {
    String? cursor,
    int limit = 50,
    String? status,
  }) async => const PosProductVariantPage(items: [], nextCursor: null);

  @override
  Future<PosProductVariant> createVariant(String productId, PosProductVariantInput input) =>
      Future.error(StateError('No product variants gateway is configured.'));

  @override
  Future<PosProductVariant> updateVariant(String id, int version, PosProductVariantInput input) =>
      Future.error(StateError('No product variants gateway is configured.'));
}
