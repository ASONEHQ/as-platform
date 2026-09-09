/// TASK 15.1 Phase 4 — the Flutter side of the remaining real, permissioned,
/// DB-backed catalog capabilities `docs/RC_RELEASE_INVENTORY.md`'s POS
/// section flagged YELLOW for having **no Flutter caller at all**:
///   * Branch price overrides — `POST /api/v1/products/:product_id/prices`
///     (`product-catalog.routes.ts:777`, `price.manage`). Product/variant
///     CRUD itself is already real and wired via
///     `pos_product_variants_screen.dart`/`pos_product_variants_gateway.dart`
///     — this file adds ONLY the branch-scoped price override on top of
///     that, never duplicating variant CRUD.
///   * Custom options/values + variant barcodes —
///     `product-options.routes.ts`'s 8 endpoints (`product.manage`).
///   * Product CSV export — `GET /api/v1/products/export.csv`
///     (`product-catalog.routes.ts:427`, `catalog.read`).
///
/// Styled after `pos_product_variants_gateway.dart` (abstract interface +
/// `Api...`/`Empty...` implementations, `PosX`/`PosXPage` model classes with
/// `fromJson`/`toJson`) — this file deliberately carries its OWN small
/// product/variant list methods (never importing
/// `pos_product_variants_gateway.dart`'s types) because the product model
/// here needs one extra real field that screen's `PosVariantProduct` has no
/// use for: the branch-resolved `effective_price` (`productHttp()`'s own
/// `effective_price`, always present on the list/detail routes — see
/// `product-catalog.repository.ts`'s `effectivePrices()`).
library;

import '../../core/networking/api_client.dart';

// --- Products (price-override + options/barcode picker) ------------------

/// The real `effective_price` object `productHttp()` attaches to every
/// list/detail product response: the single most-specific *currently
/// effective* active price for the queried branch (a branch-specific
/// override when one exists, else the company-wide default) — `null` is
/// honest ("no active price exists yet"), never coerced to zero.
class PosCatalogEffectivePrice {
  const PosCatalogEffectivePrice({
    required this.id,
    required this.branchId,
    required this.amount,
    required this.currencyCode,
    required this.validFrom,
    required this.validUntil,
    required this.status,
  });

  factory PosCatalogEffectivePrice.fromJson(Map<String, Object?> json) => PosCatalogEffectivePrice(
    id: json['id']! as String,
    branchId: json['branch_id'] as String?,
    amount: json['amount']! as String,
    currencyCode: json['currency_code']! as String,
    validFrom: DateTime.parse(json['valid_from']! as String),
    validUntil: json['valid_until'] == null ? null : DateTime.parse(json['valid_until']! as String),
    status: json['status']! as String,
  );

  final String id;

  /// `null` = the company-wide default price, not a branch override.
  final String? branchId;
  final String amount;
  final String currencyCode;
  final DateTime validFrom;
  final DateTime? validUntil;
  final String status;
}

/// A lightweight `products` row for this screen's own product picker —
/// mirrors `PosVariantProduct` (`pos_product_variants_gateway.dart`)'s
/// shape plus the real `effective_price` that gateway's model omits.
class PosCatalogProduct {
  const PosCatalogProduct({
    required this.id,
    required this.code,
    required this.name,
    required this.status,
    required this.effectivePrice,
  });

  factory PosCatalogProduct.fromJson(Map<String, Object?> json) {
    final rawPrice = json['effective_price'];
    return PosCatalogProduct(
      id: json['id']! as String,
      code: json['code']! as String,
      name: json['name']! as String,
      status: json['status']! as String,
      effectivePrice: rawPrice is Map<String, Object?> ? PosCatalogEffectivePrice.fromJson(rawPrice) : null,
    );
  }

  final String id;
  final String code;
  final String name;

  /// `draft` | `active` | `inactive` | `retired`.
  final String status;
  final PosCatalogEffectivePrice? effectivePrice;
}

class PosCatalogProductPage {
  const PosCatalogProductPage({required this.items, required this.nextCursor});
  final List<PosCatalogProduct> items;
  final String? nextCursor;
}

/// `POST /api/v1/products`'s real request body (`productBodySchema` in
/// `product-catalog.routes.ts`) — TASK 15.1 Phase 6 gap fix, see
/// [PosCatalogAdminGateway.createProduct]'s own doc comment. Covers the
/// walkthrough's normal/barcode/weighted product cases: a normal product
/// needs only [sku]; a barcode product also sets [barcode]/[barcodeType];
/// a weighted product sets [unitOfMeasureCode] to a weight unit (e.g.
/// `kg`) with a nonzero [quantityScale].
class PosNewProductInput {
  const PosNewProductInput({
    required this.code,
    required this.name,
    this.productType = 'simple',
    this.categoryId,
    this.brandId,
    this.sku,
    this.unitOfMeasureCode = 'unit',
    this.quantityScale = 0,
    this.standardCost,
    this.barcode,
    this.barcodeType,
    this.tracksInventory = true,
    this.status = 'active',
  });

  final String code;
  final String name;

  /// `simple` | `variable` | `kit` | `service`.
  final String productType;
  final String? categoryId;
  final String? brandId;

  /// Defaults to `'active'` — TASK 15.1 Phase 6 gap fix: the backend's
  /// own `products.status` column defaults to `'draft'` when this field
  /// is omitted, and a `draft` product is real but genuinely unsellable
  /// (`POST /api/v1/sales` real-rejects it with a real 400
  /// `product_not_active`, discovered live exercising steps 12-15 of the
  /// Phase 6 walkthrough — a park owner who just created a product could
  /// never actually sell it, and this app has no separate "activate a
  /// product" screen to recover from that). `'draft'` | `'active'` |
  /// `'inactive'`.
  final String status;

  /// When non-null, a `default_variant` is created alongside the product
  /// in the same call (the backend's own single-request convenience path).
  final String? sku;
  final String unitOfMeasureCode;
  final int quantityScale;
  final String? standardCost;
  final String? barcode;

  /// `ean13` | `upca` | `code128` | `qr` | `internal`.
  final String? barcodeType;

  /// Defaults to `true` — TASK 15.1 Phase 6 gap fix: leaving this unset
  /// left the backend's own `tracksInventory: input.defaultVariant
  /// .tracksInventory ?? input.tracksInventory` fall through to a falsy
  /// default, producing a real product/variant that silently could never
  /// be restocked or sold with real stock tracking (a real live 404
  /// `product_variant_not_found`/"does not track inventory" from
  /// `POST /api/v1/direct-purchases`, discovered exercising step 16 of
  /// the Phase 6 walkthrough). A normal sellable product should track
  /// inventory unless the caller explicitly says otherwise.
  final bool tracksInventory;

  Map<String, Object?> toJson() => {
    'code': code,
    'name': name,
    'product_type': productType,
    'tracks_inventory': tracksInventory,
    'status': status,
    if (categoryId != null) 'category_id': categoryId,
    if (brandId != null) 'brand_id': brandId,
    if (sku != null)
      'default_variant': {
        'sku': sku,
        'unit_of_measure_code': unitOfMeasureCode,
        'quantity_scale': quantityScale,
        'tracks_inventory': tracksInventory,
        if (standardCost != null) 'standard_cost': standardCost,
        if (barcode != null)
          'barcode': {'type': barcodeType ?? 'code128', 'value': barcode, 'is_primary': true},
      },
  };
}

/// A `product_variants` row, trimmed to just what the barcode picker needs
/// (mirrors `PosProductVariant` in `pos_product_variants_gateway.dart`,
/// which this file deliberately does not import — see this file's own
/// header note).
class PosCatalogVariant {
  const PosCatalogVariant({
    required this.id,
    required this.productId,
    required this.sku,
    required this.name,
    required this.isDefault,
    required this.status,
  });

  factory PosCatalogVariant.fromJson(Map<String, Object?> json) => PosCatalogVariant(
    id: json['id']! as String,
    productId: json['product_id']! as String,
    sku: json['sku']! as String,
    name: json['name'] as String?,
    isDefault: json['is_default']! as bool,
    status: json['status']! as String,
  );

  final String id;
  final String productId;
  final String sku;
  final String? name;
  final bool isDefault;

  /// `active` | `inactive` | `retired`.
  final String status;
}

class PosCatalogVariantPage {
  const PosCatalogVariantPage({required this.items, required this.nextCursor});
  final List<PosCatalogVariant> items;
  final String? nextCursor;
}

// --- Branch price overrides ------------------------------------------

/// A created `product_prices` row (`priceHttp()` in
/// `product-catalog.routes.ts`).
class PosProductPrice {
  const PosProductPrice({
    required this.id,
    required this.branchId,
    required this.productId,
    required this.priceType,
    required this.amount,
    required this.currencyCode,
    required this.validFrom,
    required this.validUntil,
    required this.status,
    required this.version,
  });

  factory PosProductPrice.fromJson(Map<String, Object?> json) => PosProductPrice(
    id: json['id']! as String,
    branchId: json['branch_id'] as String?,
    productId: json['product_id']! as String,
    priceType: json['price_type']! as String,
    amount: json['amount']! as String,
    currencyCode: json['currency_code']! as String,
    validFrom: DateTime.parse(json['valid_from']! as String),
    validUntil: json['valid_until'] == null ? null : DateTime.parse(json['valid_until']! as String),
    status: json['status']! as String,
    version: json['version']! as int,
  );

  final String id;

  /// `null` = a company-wide default price, not a branch override.
  final String? branchId;
  final String productId;
  final String priceType;
  final String amount;
  final String currencyCode;
  final DateTime validFrom;
  final DateTime? validUntil;
  final String status;
  final int version;
}

/// `POST /api/v1/products/{product_id}/prices`'s real request body
/// (`productPriceBodySchema` in `product-catalog.routes.ts`). `amount` and
/// `currencyCode` are the only backend-required fields; the caller-side
/// form enforces that before calling
/// [PosCatalogAdminGateway.createProductPrice]. `amount` is passed through
/// as the exact decimal string the backend itself requires (never coerced
/// to a JS/Dart number — same ADR-0001 rule
/// `pos_product_variants_gateway.dart` documents for `standard_cost`).
class PosProductPriceInput {
  const PosProductPriceInput({
    required this.amount,
    required this.currencyCode,
    this.branchId,
    this.validFrom,
    this.validUntil,
  });

  final String amount;
  final String currencyCode;

  /// `null` = a company-wide default price override; a real branch id
  /// narrows it to that one branch (ADR-0006: only ever an authorized
  /// branch the caller already has access to).
  final String? branchId;
  final DateTime? validFrom;
  final DateTime? validUntil;

  Map<String, Object?> toJson() => {
    'amount': amount,
    'currency_code': currencyCode,
    if (branchId != null) 'branch_id': branchId,
    if (validFrom != null) 'valid_from': validFrom!.toUtc().toIso8601String(),
    if (validUntil != null) 'valid_until': validUntil!.toUtc().toIso8601String(),
  };
}

// --- Custom options/values -------------------------------------------

/// A `product_option_definitions` row (`named()` in
/// `product-options.routes.ts`, the option-definition shape — carries no
/// `option_id` of its own, unlike [PosProductOptionValue]).
class PosProductOption {
  const PosProductOption({
    required this.id,
    required this.productId,
    required this.code,
    required this.name,
    required this.displayOrder,
    required this.status,
    required this.version,
  });

  factory PosProductOption.fromJson(Map<String, Object?> json) => PosProductOption(
    id: json['id']! as String,
    productId: json['product_id']! as String,
    code: json['code']! as String,
    name: json['name']! as String,
    displayOrder: json['display_order']! as int,
    status: json['status']! as String,
    version: json['version']! as int,
  );

  final String id;
  final String productId;
  final String code;
  final String name;
  final int displayOrder;

  /// `active` | `inactive` | `retired`.
  final String status;
  final int version;
}

class PosProductOptionPage {
  const PosProductOptionPage({required this.items, required this.nextCursor});
  final List<PosProductOption> items;
  final String? nextCursor;
}

/// A `product_option_values` row (`named()` in `product-options.routes.ts`
/// — includes `option_id`, unlike [PosProductOption]).
class PosProductOptionValue {
  const PosProductOptionValue({
    required this.id,
    required this.optionId,
    required this.productId,
    required this.code,
    required this.name,
    required this.displayOrder,
    required this.status,
    required this.version,
  });

  factory PosProductOptionValue.fromJson(Map<String, Object?> json) => PosProductOptionValue(
    id: json['id']! as String,
    optionId: json['option_id']! as String,
    productId: json['product_id']! as String,
    code: json['code']! as String,
    name: json['name']! as String,
    displayOrder: json['display_order']! as int,
    status: json['status']! as String,
    version: json['version']! as int,
  );

  final String id;
  final String optionId;
  final String productId;
  final String code;
  final String name;
  final int displayOrder;

  /// `active` | `inactive` | `retired`.
  final String status;
  final int version;
}

class PosProductOptionValuePage {
  const PosProductOptionValuePage({required this.items, required this.nextCursor});
  final List<PosProductOptionValue> items;
  final String? nextCursor;
}

/// The create input BOTH `POST .../options` and `POST .../values` accept
/// (`namedBody` in `product-options.routes.ts` — the two routes share one
/// identical request shape).
class PosNamedCreateInput {
  const PosNamedCreateInput({required this.code, required this.name, this.displayOrder, this.status});

  final String code;
  final String name;
  final int? displayOrder;

  /// `active` | `inactive` — the create schema only accepts these two; a
  /// value only ever becomes `retired` via a later PATCH.
  final String? status;

  Map<String, Object?> toJson() => {
    'code': code,
    'name': name,
    if (displayOrder != null) 'display_order': displayOrder,
    if (status != null) 'status': status,
  };
}

/// The patch input BOTH option and value PATCH routes accept (`namedPatch`
/// in `product-options.routes.ts`) — never `code`, which is immutable
/// after creation on both.
class PosNamedPatchInput {
  const PosNamedPatchInput({this.name, this.displayOrder, this.status});

  final String? name;
  final int? displayOrder;

  /// `active` | `inactive` | `retired`.
  final String? status;

  Map<String, Object?> toJson() => {
    if (name != null) 'name': name,
    if (displayOrder != null) 'display_order': displayOrder,
    if (status != null) 'status': status,
  };
}

// --- Variant barcodes --------------------------------------------------

/// A `product_barcodes` row (`barcode()` in `product-options.routes.ts`).
class PosProductBarcode {
  const PosProductBarcode({
    required this.id,
    required this.productVariantId,
    required this.barcode,
    required this.barcodeType,
    required this.isPrimary,
    required this.status,
    required this.version,
  });

  factory PosProductBarcode.fromJson(Map<String, Object?> json) => PosProductBarcode(
    id: json['id']! as String,
    productVariantId: json['product_variant_id']! as String,
    barcode: json['barcode']! as String,
    barcodeType: json['barcode_type']! as String,
    isPrimary: json['is_primary']! as bool,
    status: json['status']! as String,
    version: json['version']! as int,
  );

  final String id;
  final String productVariantId;
  final String barcode;

  /// `ean13` | `upca` | `code128` | `qr` | `internal`.
  final String barcodeType;
  final bool isPrimary;

  /// `active` | `inactive` | `retired`.
  final String status;
  final int version;
}

/// `POST /api/v1/product-variants/{variant_id}/barcodes`'s real request
/// body (`barcodeBody` in `product-options.routes.ts`).
class PosProductBarcodeInput {
  const PosProductBarcodeInput({required this.barcode, required this.barcodeType, this.isPrimary});

  final String barcode;

  /// `ean13` | `upca` | `code128` | `qr` | `internal`.
  final String barcodeType;
  final bool? isPrimary;

  Map<String, Object?> toJson() => {
    'barcode': barcode,
    'barcode_type': barcodeType,
    if (isPrimary != null) 'is_primary': isPrimary,
  };
}

// --- Gateway -------------------------------------------------------------

abstract interface class PosCatalogAdminGateway {
  /// `GET /api/v1/products` (`catalog.read`) — always sends `limit`; sends
  /// `search`/`branch_id` only when provided. When [branchId] is provided,
  /// each returned product's [PosCatalogProduct.effectivePrice] resolves
  /// that branch's own override (ADR-0006: narrows scope, never widens).
  Future<PosCatalogProductPage> listProducts({String? cursor, int limit = 50, String? search, String? branchId});

  /// `POST /api/v1/products` (`product.manage`) — TASK 15.1 Phase 6 gap
  /// fix: this real, already-existing backend route (`product-catalog
  /// .routes.ts`) had ZERO Flutter caller anywhere in `apps/one` (grep-
  /// verified) — this file's own top-of-file doc comment incorrectly
  /// claimed "Product/variant CRUD itself is already real and wired via
  /// pos_product_variants_screen.dart/pos_product_variants_gateway.dart";
  /// that screen's `createVariant` only ever adds a variant to an
  /// EXISTING product — there was no way, anywhere in the app, to create
  /// the base product row a park owner's very first "add a product" click
  /// needs. Discovered live during the TASK 15.1 Phase 6 commercial
  /// onboarding walkthrough (steps 12–14: normal/barcode/weighted
  /// product). See `_Products`' own "Nuevo producto" affordance
  /// (`pos_shell.dart`) for the real caller this closes the gap for.
  Future<PosCatalogProduct> createProduct(PosNewProductInput input);

  /// `GET /api/v1/products/{product_id}/variants` (`catalog.read`) — the
  /// barcode tab's own variant picker for a selected product.
  Future<PosCatalogVariantPage> listVariants(String productId, {String? cursor, int limit = 50});

  /// `POST /api/v1/products/{product_id}/prices` (`price.manage`) —
  /// requires `Idempotency-Key` (ADR-0005); throws [ApiException] honestly
  /// on any rejection.
  Future<PosProductPrice> createProductPrice(String productId, PosProductPriceInput input);

  /// `GET /api/v1/products/{product_id}/options` (`catalog.read`).
  Future<PosProductOptionPage> listOptions(String productId, {String? cursor, int limit = 50});

  /// `POST /api/v1/products/{product_id}/options` (`product.manage`).
  Future<PosProductOption> createOption(String productId, PosNamedCreateInput input);

  /// `PATCH /api/v1/product-options/{option_id}` (`product.manage`) —
  /// requires `If-Match` carrying the option's own current [version].
  Future<PosProductOption> updateOption(String optionId, int version, PosNamedPatchInput input);

  /// `GET /api/v1/product-options/{option_id}/values` (`catalog.read`).
  Future<PosProductOptionValuePage> listOptionValues(String optionId, {String? cursor, int limit = 50});

  /// `POST /api/v1/product-options/{option_id}/values` (`product.manage`).
  Future<PosProductOptionValue> createOptionValue(String optionId, PosNamedCreateInput input);

  /// `PATCH /api/v1/product-option-values/{value_id}` (`product.manage`) —
  /// requires `If-Match` carrying the value's own current [version].
  Future<PosProductOptionValue> updateOptionValue(String valueId, int version, PosNamedPatchInput input);

  /// `POST /api/v1/product-variants/{variant_id}/barcodes`
  /// (`product.manage`) — requires `Idempotency-Key` (ADR-0005).
  Future<PosProductBarcode> createBarcode(String variantId, PosProductBarcodeInput input);

  /// `DELETE /api/v1/product-barcodes/{barcode_id}` (`product.manage`) —
  /// soft-retires the barcode (`status: retired`), never a hard delete;
  /// requires `If-Match` carrying the barcode's own current [version].
  Future<PosProductBarcode> retireBarcode(String barcodeId, int version);

  /// `GET /api/v1/products/export.csv` (`catalog.read`) — the real raw CSV
  /// body (`text/csv`), never JSON-wrapped; see
  /// `pos_catalog_admin_screen.dart` for how this is turned into a real
  /// browser download.
  Future<String> exportProductsCsv({
    String? status,
    String? productType,
    String? categoryId,
    String? brandId,
    String? search,
  });
}

class ApiPosCatalogAdminGateway implements PosCatalogAdminGateway {
  const ApiPosCatalogAdminGateway(this._client);

  final ApiClient _client;

  @override
  Future<PosCatalogProductPage> listProducts({
    String? cursor,
    int limit = 50,
    String? search,
    String? branchId,
  }) async {
    final query = <String, String>{
      'limit': '$limit',
      if (cursor != null) 'cursor': cursor,
      if (search != null) 'search': search,
      if (branchId != null) 'branch_id': branchId,
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
    return PosCatalogProductPage(
      items: data.whereType<Map<String, Object?>>().map(PosCatalogProduct.fromJson).toList(growable: false),
      nextCursor: nextCursor,
    );
  }

  @override
  Future<PosCatalogProduct> createProduct(PosNewProductInput input) async {
    final envelope = await _client.postJson(
      '/api/v1/products',
      idempotencyKey: _idempotencyKey('product'),
      body: input.toJson(),
    );
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing created product data.');
    }
    return PosCatalogProduct.fromJson(data);
  }

  @override
  Future<PosCatalogVariantPage> listVariants(String productId, {String? cursor, int limit = 50}) async {
    final query = <String, String>{'limit': '$limit', if (cursor != null) 'cursor': cursor};
    final path = Uri(path: '/api/v1/products/$productId/variants', queryParameters: query).toString();
    final envelope = await _client.getJson(path);
    final data = envelope['data'];
    if (data is! List<Object?>) {
      throw const FormatException('Missing product variants list data.');
    }
    final meta = envelope['meta'];
    final page = meta is Map<String, Object?> ? meta['page'] : null;
    final nextCursor = page is Map<String, Object?> ? page['next_cursor'] as String? : null;
    return PosCatalogVariantPage(
      items: data.whereType<Map<String, Object?>>().map(PosCatalogVariant.fromJson).toList(growable: false),
      nextCursor: nextCursor,
    );
  }

  @override
  Future<PosProductPrice> createProductPrice(String productId, PosProductPriceInput input) async {
    final envelope = await _client.postJson(
      '/api/v1/products/$productId/prices',
      idempotencyKey: _idempotencyKey('price'),
      body: input.toJson(),
    );
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing product price data.');
    }
    return PosProductPrice.fromJson(data);
  }

  @override
  Future<PosProductOptionPage> listOptions(String productId, {String? cursor, int limit = 50}) async {
    final query = <String, String>{'limit': '$limit', if (cursor != null) 'cursor': cursor};
    final path = Uri(path: '/api/v1/products/$productId/options', queryParameters: query).toString();
    final envelope = await _client.getJson(path);
    final data = envelope['data'];
    if (data is! List<Object?>) {
      throw const FormatException('Missing product options list data.');
    }
    final meta = envelope['meta'];
    final page = meta is Map<String, Object?> ? meta['page'] : null;
    final nextCursor = page is Map<String, Object?> ? page['next_cursor'] as String? : null;
    return PosProductOptionPage(
      items: data.whereType<Map<String, Object?>>().map(PosProductOption.fromJson).toList(growable: false),
      nextCursor: nextCursor,
    );
  }

  @override
  Future<PosProductOption> createOption(String productId, PosNamedCreateInput input) async {
    final envelope = await _client.postJson(
      '/api/v1/products/$productId/options',
      idempotencyKey: _idempotencyKey('option'),
      body: input.toJson(),
    );
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing product option data.');
    }
    return PosProductOption.fromJson(data);
  }

  @override
  Future<PosProductOption> updateOption(String optionId, int version, PosNamedPatchInput input) async {
    final envelope = await _client.patchJson(
      '/api/v1/product-options/$optionId',
      ifMatch: '"$version"',
      body: input.toJson(),
    );
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing product option data.');
    }
    return PosProductOption.fromJson(data);
  }

  @override
  Future<PosProductOptionValuePage> listOptionValues(String optionId, {String? cursor, int limit = 50}) async {
    final query = <String, String>{'limit': '$limit', if (cursor != null) 'cursor': cursor};
    final path = Uri(path: '/api/v1/product-options/$optionId/values', queryParameters: query).toString();
    final envelope = await _client.getJson(path);
    final data = envelope['data'];
    if (data is! List<Object?>) {
      throw const FormatException('Missing product option values list data.');
    }
    final meta = envelope['meta'];
    final page = meta is Map<String, Object?> ? meta['page'] : null;
    final nextCursor = page is Map<String, Object?> ? page['next_cursor'] as String? : null;
    return PosProductOptionValuePage(
      items: data
          .whereType<Map<String, Object?>>()
          .map(PosProductOptionValue.fromJson)
          .toList(growable: false),
      nextCursor: nextCursor,
    );
  }

  @override
  Future<PosProductOptionValue> createOptionValue(String optionId, PosNamedCreateInput input) async {
    final envelope = await _client.postJson(
      '/api/v1/product-options/$optionId/values',
      idempotencyKey: _idempotencyKey('option-value'),
      body: input.toJson(),
    );
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing product option value data.');
    }
    return PosProductOptionValue.fromJson(data);
  }

  @override
  Future<PosProductOptionValue> updateOptionValue(
    String valueId,
    int version,
    PosNamedPatchInput input,
  ) async {
    final envelope = await _client.patchJson(
      '/api/v1/product-option-values/$valueId',
      ifMatch: '"$version"',
      body: input.toJson(),
    );
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing product option value data.');
    }
    return PosProductOptionValue.fromJson(data);
  }

  @override
  Future<PosProductBarcode> createBarcode(String variantId, PosProductBarcodeInput input) async {
    final envelope = await _client.postJson(
      '/api/v1/product-variants/$variantId/barcodes',
      idempotencyKey: _idempotencyKey('barcode'),
      body: input.toJson(),
    );
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing product barcode data.');
    }
    return PosProductBarcode.fromJson(data);
  }

  @override
  Future<PosProductBarcode> retireBarcode(String barcodeId, int version) async {
    final envelope = await _client.deleteJson(
      '/api/v1/product-barcodes/$barcodeId',
      ifMatch: '"$version"',
    );
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing product barcode data.');
    }
    return PosProductBarcode.fromJson(data);
  }

  @override
  Future<String> exportProductsCsv({
    String? status,
    String? productType,
    String? categoryId,
    String? brandId,
    String? search,
  }) {
    final query = <String, String>{
      if (status != null) 'status': status,
      if (productType != null) 'product_type': productType,
      if (categoryId != null) 'category_id': categoryId,
      if (brandId != null) 'brand_id': brandId,
      if (search != null) 'search': search,
    };
    final path = Uri(path: '/api/v1/products/export.csv', queryParameters: query).toString();
    return _client.getText(path);
  }

  static String _idempotencyKey(String prefix) =>
      'one-$prefix-${DateTime.now().toUtc().microsecondsSinceEpoch}';
}

class EmptyPosCatalogAdminGateway implements PosCatalogAdminGateway {
  const EmptyPosCatalogAdminGateway();

  @override
  Future<PosCatalogProductPage> listProducts({
    String? cursor,
    int limit = 50,
    String? search,
    String? branchId,
  }) async => const PosCatalogProductPage(items: [], nextCursor: null);

  @override
  Future<PosCatalogProduct> createProduct(PosNewProductInput input) =>
      Future.error(StateError('No catalog admin gateway is configured.'));

  @override
  Future<PosCatalogVariantPage> listVariants(String productId, {String? cursor, int limit = 50}) async =>
      const PosCatalogVariantPage(items: [], nextCursor: null);

  @override
  Future<PosProductPrice> createProductPrice(String productId, PosProductPriceInput input) =>
      Future.error(StateError('No catalog admin gateway is configured.'));

  @override
  Future<PosProductOptionPage> listOptions(String productId, {String? cursor, int limit = 50}) async =>
      const PosProductOptionPage(items: [], nextCursor: null);

  @override
  Future<PosProductOption> createOption(String productId, PosNamedCreateInput input) =>
      Future.error(StateError('No catalog admin gateway is configured.'));

  @override
  Future<PosProductOption> updateOption(String optionId, int version, PosNamedPatchInput input) =>
      Future.error(StateError('No catalog admin gateway is configured.'));

  @override
  Future<PosProductOptionValuePage> listOptionValues(String optionId, {String? cursor, int limit = 50}) async =>
      const PosProductOptionValuePage(items: [], nextCursor: null);

  @override
  Future<PosProductOptionValue> createOptionValue(String optionId, PosNamedCreateInput input) =>
      Future.error(StateError('No catalog admin gateway is configured.'));

  @override
  Future<PosProductOptionValue> updateOptionValue(String valueId, int version, PosNamedPatchInput input) =>
      Future.error(StateError('No catalog admin gateway is configured.'));

  @override
  Future<PosProductBarcode> createBarcode(String variantId, PosProductBarcodeInput input) =>
      Future.error(StateError('No catalog admin gateway is configured.'));

  @override
  Future<PosProductBarcode> retireBarcode(String barcodeId, int version) =>
      Future.error(StateError('No catalog admin gateway is configured.'));

  @override
  Future<String> exportProductsCsv({
    String? status,
    String? productType,
    String? categoryId,
    String? brandId,
    String? search,
  }) => Future.error(StateError('No catalog admin gateway is configured.'));
}
