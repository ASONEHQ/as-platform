import 'package:flutter/foundation.dart' show immutable;

import 'money.dart';

/// TASK 12.3C: distinguishes *why* [PosPricing.amount] is what it is —
/// the four states the backend's `effective_price` can honestly represent.
/// Never collapsed to a single "has a price" boolean: a missing price and
/// a genuinely free item must stay distinguishable everywhere downstream
/// (see `sale_session.dart`).
enum PosPricingStatus {
  /// A real, resolved, positive price.
  valid,

  /// A real, resolved price whose amount is exactly zero — an
  /// intentionally free item, not an absent one.
  free,

  /// `effective_price` was `null` — no active price exists yet for this
  /// product/company/branch. Never treated as free.
  missing,

  /// A price row was present but its `amount`/`currency_code` failed to
  /// parse as an exact decimal/ISO 4217 value — untrusted wire data, never
  /// silently coerced to a number.
  malformed,
}

/// TASK 12.3C: the backend-resolved effective price for one product, as
/// parsed from `effective_price` in `GET /api/v1/products` (see
/// docs/API_CONTRACTS.md §14.2). The backend remains the sole pricing
/// authority — this only classifies and carries what it returned; nothing
/// here computes or overrides a price.
@immutable
class PosPricing {
  const PosPricing._(this.status, this.amount, {this.malformedReason});

  const PosPricing.missing() : this._(PosPricingStatus.missing, null);

  factory PosPricing.fromJson(Object? json) {
    if (json == null) return const PosPricing.missing();
    if (json is! Map<String, Object?>) {
      return const PosPricing._(
        PosPricingStatus.malformed,
        null,
        malformedReason: 'effective_price is not an object.',
      );
    }
    final rawAmount = json['amount'];
    final rawCurrency = json['currency_code'];
    if (rawAmount is! String || rawCurrency is! String) {
      return const PosPricing._(
        PosPricingStatus.malformed,
        null,
        malformedReason: 'amount/currency_code missing or not strings.',
      );
    }
    try {
      final money = Money.parse(rawAmount, rawCurrency);
      return PosPricing._(
        money.isZero ? PosPricingStatus.free : PosPricingStatus.valid,
        money,
      );
    } on MoneyFormatException catch (error) {
      return PosPricing._(
        PosPricingStatus.malformed,
        null,
        malformedReason: error.message,
      );
    }
  }

  final PosPricingStatus status;

  /// Non-null only for [PosPricingStatus.valid]/[PosPricingStatus.free].
  final Money? amount;

  /// Non-null only for [PosPricingStatus.malformed].
  final String? malformedReason;

  /// A product may be sold — added to a ticket — only when it has a real
  /// (possibly zero) resolved price. Missing and malformed prices are
  /// never sellable; see `sale_session.dart`'s addability check.
  bool get isSellable =>
      status == PosPricingStatus.valid || status == PosPricingStatus.free;
}

/// Statutory Mexican IVA rates keyed by the backend's tax *classification*
/// (`products.tax_code`, ADR-agnostic federal tax law — see
/// docs/API_CONTRACTS.md §14.2: the backend returns a classification, not
/// a computed rate). Expressed as exact integer basis points, never a
/// `double` — matches the pre-existing `posIvaRate` precedent from
/// TASK 12.3, now applied per line by tax code instead of blindly to the
/// whole ticket. An unrecognized code intentionally has no entry: it is
/// not a rate lookup failure to default away, it means this product's tax
/// treatment cannot be determined from this response.
const Map<String, int> posIvaBasisPointsByTaxCode = {
  'IVA_GENERAL': 1600,
  'IVA_EXEMPT': 0,
};

/// `null` when [taxCode] is not a recognized classification — the caller
/// must treat that as unsellable, never default to 0% or 16%.
int? posIvaBasisPointsFor(String? taxCode) =>
    posIvaBasisPointsByTaxCode[taxCode];

class PosProduct {
  const PosProduct({
    required this.id,
    required this.code,
    required this.name,
    required this.type,
    required this.status,
    required this.tracksInventory,
    this.categoryId,
    this.defaultVariantId,
    this.sku,
    this.taxCode,
    this.pricing = const PosPricing.missing(),
    this.unitOfMeasureCode,
    this.quantityScale = 0,
    this.imageUrl,
    this.iconKey,
    this.cardStyle = 'default',
    this.cardColorHex,
    this.isFeatured = false,
  });

  factory PosProduct.fromJson(Map<String, Object?> json) {
    final variant = switch (json['default_variant']) {
      final Map<String, Object?> value => value,
      _ => null,
    };
    final rawScale = variant?['quantity_scale'];
    return PosProduct(
      id: json.string('id'),
      code: json.string('code'),
      name: json.string('name'),
      type: json.string('product_type'),
      status: json.string('status'),
      tracksInventory: json['tracks_inventory'] == true,
      categoryId: json['category_id'] as String?,
      defaultVariantId: variant?['id'] as String?,
      // The variant's own SKU, distinct from the product's `code` — see
      // docs/API_CONTRACTS.md §14.1 ("SKU ... are attributes of a
      // concrete variant, never direct product-owned fields").
      sku: variant?['sku'] as String?,
      taxCode: json['tax_code'] as String?,
      pricing: PosPricing.fromJson(json['effective_price']),
      // TASK 14.3 (Wave 1, Part B.3): the default variant's own
      // `unit_of_measure_code`/`quantity_scale` — always present on a
      // real variant (`product-catalog.routes.ts`'s `variantHttp`),
      // `null`/`0` here only when `default_variant` itself was absent
      // from this response.
      unitOfMeasureCode: variant?['unit_of_measure_code'] as String?,
      quantityScale: rawScale is int ? rawScale : 0,
      // TASK 16.6 (Productos/Catálogo legacy parity) — real image/icon/
      // card-appearance/featured fields (`productHttp()` in
      // `product-catalog.routes.ts`); this is what makes a configured
      // product image actually flow through to the real POS sell-screen
      // card, not just the admin grid. See `_PosProductCard`.
      imageUrl: json['image_url'] as String?,
      iconKey: json['icon_key'] as String?,
      cardStyle: json['card_style'] as String? ?? 'default',
      cardColorHex: json['card_color_hex'] as String?,
      isFeatured: json['is_featured'] == true,
    );
  }

  final String id;
  final String code;
  final String name;
  final String type;
  final String status;
  final bool tracksInventory;
  final String? categoryId;
  final String? defaultVariantId;

  /// The default variant's SKU — `null` only when `default_variant` was
  /// absent from the response (never fabricated from [code]).
  final String? sku;

  /// The backend tax classification (`IVA_GENERAL`/`IVA_EXEMPT`), `null`
  /// when absent. See [posIvaBasisPointsFor].
  final String? taxCode;

  /// The backend-resolved effective price, honestly `missing` when the
  /// JSON carried none.
  final PosPricing pricing;

  /// The default variant's own `unit_of_measure_code` (e.g. `unit`, `kg`,
  /// `g`, `l`, `ml`) — `null` only when `default_variant` itself was
  /// absent from the response. See [posIsWeightBased].
  final String? unitOfMeasureCode;

  /// The default variant's own `quantity_scale` — how many fractional
  /// digits its quantity is tracked at (0 for whole-unit products).
  final int quantityScale;

  /// TASK 16.6 — a real object-storage URL (uploaded photo) or pasted
  /// external URL. `null` = no image configured; render [iconKey]/the
  /// platform fallback icon instead. See `posProductCardIcon`.
  final String? imageUrl;

  /// TASK 16.6 — one of the platform's bounded `productIconKeys`, or
  /// `null` for the generic fallback icon.
  final String? iconKey;

  /// TASK 16.6 — `default` | `gradient` | `solid` (legacy
  /// `mpColorSetModo()` parity). See `posProductCardBackground`.
  final String cardStyle;

  /// TASK 16.6 — a `#RRGGBB` hex string; only meaningful when [cardStyle]
  /// is not `default`.
  final String? cardColorHex;

  /// TASK 16.6 — legacy "Favorito" parity.
  final bool isFeatured;
}

/// TASK 14.3 (Wave 1, Part B.3): the platform seeds a small, fixed,
/// non-tenant-specific set of units of measure
/// (`packages/database/drizzle/0004_pink_nehzno.sql`) — `kg`/`g` are the
/// only `dimension: 'mass'` codes today (`l`/`ml` are `volume`, `unit` is
/// `count`). No `GET`-listable "units of measure with their dimension"
/// endpoint exists in this backend today (checked `apps/api/src` for
/// `units_of_measure`/`unitOfMeasure` routes) — this constant is the
/// documented, explicitly-allowed fallback for that case, exactly like
/// currency formatting: a real, platform-level fact every tenant shares,
/// never an Inflapark-specific hardcode of a product/price/policy. If a
/// real units-of-measure listing endpoint is added later, prefer calling
/// it over this constant.
const Set<String> posWeightBasedUnitOfMeasureCodes = {'kg', 'g'};

/// `true` only when [PosProduct.unitOfMeasureCode] is a real,
/// platform-seeded mass-dimension code — see
/// [posWeightBasedUnitOfMeasureCodes]. A product with no resolved unit
/// (`null`) is never treated as weight-based.
bool posIsWeightBased(PosProduct product) {
  final code = product.unitOfMeasureCode;
  return code != null && posWeightBasedUnitOfMeasureCodes.contains(code);
}

/// Pure, backend-data-only stock check — TASK 12.3, extended in TASK 12.3C
/// now that `default_variant.id` is actually populated by the list
/// endpoint (see docs/AS_POS_READ_ONLY_SHELL.md). A product that does not
/// track inventory, or has no resolvable variant/balance, is never
/// reported out of stock.
bool posIsOutOfStock(PosProduct product, List<PosInventoryBalance> balances) {
  if (!product.tracksInventory || product.defaultVariantId == null) {
    return false;
  }
  final matches = balances.where(
    (balance) => balance.variantId == product.defaultVariantId,
  );
  if (matches.isEmpty) return false;
  var onHand = BigInt.zero;
  for (final balance in matches) {
    onHand += _quantityMinorUnits(balance.onHand);
  }
  return onHand <= BigInt.zero;
}

final RegExp _quantityPattern = RegExp(r'^(-?)(\d+)(?:\.(\d{1,6}))?$');

/// Parses a decimal quantity string into an exact integer count of
/// 1/1,000,000ths — matching the backend inventory ledger's own scale
/// (see `apps/api/src/modules/inventory/inventory-posting.service.ts`'s
/// `SCALE`) — never `double`. An unparseable value contributes zero
/// rather than throwing, matching this stock aggregate's original
/// tolerant behavior; [Money.parse] is the strict path used for price.
BigInt _quantityMinorUnits(String value) {
  final match = _quantityPattern.firstMatch(value.trim());
  if (match == null) return BigInt.zero;
  final sign = match.group(1) == '-' ? -BigInt.one : BigInt.one;
  final whole = BigInt.parse(match.group(2)!);
  final fraction = (match.group(3) ?? '').padRight(6, '0');
  return sign *
      (whole * BigInt.from(1000000) +
          BigInt.parse(fraction.isEmpty ? '0' : fraction));
}

/// TASK 12.3C: why a product cannot currently be added to a ticket —
/// `null` means it can be. Both CAJERO and CLIENTE gate `addProduct` calls
/// through this single function so their behavior (and notice message)
/// never drifts apart, and `SaleSession.addProduct` re-checks it itself as
/// a defensive backstop (the backend remains the pricing authority; the UI
/// gate is a courtesy, not the only guard).
enum PosAddabilityBlock { outOfStock, missingPrice, malformedPrice }

PosAddabilityBlock? posAddabilityBlock(
  PosProduct product,
  List<PosInventoryBalance> balances,
) {
  if (posIsOutOfStock(product, balances)) return PosAddabilityBlock.outOfStock;
  switch (product.pricing.status) {
    case PosPricingStatus.valid:
    case PosPricingStatus.free:
      break;
    case PosPricingStatus.missing:
      return PosAddabilityBlock.missingPrice;
    case PosPricingStatus.malformed:
      return PosAddabilityBlock.malformedPrice;
  }
  // A sellable price with a tax code this app cannot rate is just as
  // unsellable as no price at all — never silently untaxed.
  if (posIvaBasisPointsFor(product.taxCode) == null) {
    return PosAddabilityBlock.malformedPrice;
  }
  return null;
}

class PosCategory {
  const PosCategory({
    required this.id,
    required this.name,
    required this.status,
    this.visualTile = false,
  });

  factory PosCategory.fromJson(Map<String, Object?> json) => PosCategory(
    id: json.string('id'),
    name: json.string('name'),
    status: json.string('status'),
    // TASK 14.5 (Wave 3, Phase 6): the backend's generic, tenant-
    // configurable "visual/compact tile" hint (`visual_tile` —
    // `catalog.routes.ts`'s `categoryHttp`) — recovered from the legacy's
    // own `estiloCafe` flag, forensically confirmed to be purely visual/
    // reporting, never a checkout/validation difference (see
    // `docs/LEGACY_FUNCTIONAL_PARITY.md` §1). Defaults `false` for any
    // response that predates this field.
    visualTile: json['visual_tile'] == true,
  );

  final String id;
  final String name;
  final String status;
  final bool visualTile;
}

class PosInventoryBalance {
  const PosInventoryBalance({
    required this.id,
    required this.branchId,
    required this.locationId,
    required this.variantId,
    required this.onHand,
    required this.reserved,
    required this.inTransit,
  });

  factory PosInventoryBalance.fromJson(Map<String, Object?> json) =>
      PosInventoryBalance(
        id: json.string('id'),
        branchId: json.string('branch_id'),
        locationId: json.string('inventory_location_id'),
        variantId: json.string('product_variant_id'),
        onHand: json.string('quantity_on_hand'),
        reserved: json.string('quantity_reserved'),
        inTransit: json.string('quantity_in_transit'),
      );

  final String id;
  final String branchId;
  final String locationId;
  final String variantId;
  final String onHand;
  final String reserved;
  final String inTransit;
}

class PosUser {
  const PosUser({
    required this.id,
    required this.email,
    required this.displayName,
    required this.identityStatus,
    required this.membershipStatus,
  });

  // TASK 15.1 Phase 6 gap fix: `POST /api/v1/users` (`AdministrationService
  // .createUser`) deliberately returns a smaller shape than `GET
  // /api/v1/users`/`GET /api/v1/users/{id}` — it omits `identity_status`
  // because, at creation time, the brand-new `users` row's `status` column
  // is always exactly what `createUser`'s own SQL just inserted:
  // `'pending'` (see `admin.service.ts`'s `createUser`). Requiring the key
  // unconditionally made a REAL, server-successful user creation (a real
  // 201, a real row) surface as "No fue posible crear el usuario" in the
  // Flutter UI, because `json.string('identity_status')` threw a
  // `FormatException` the create call site's catch block then reported as
  // a failure — discovered live during the TASK 15.1 Phase 6 commercial
  // onboarding walkthrough. Defaulting to `'pending'` here is not a
  // guess; it is the one value this field can honestly have on this
  // specific response.
  factory PosUser.fromJson(Map<String, Object?> json) => PosUser(
    id: json.string('id'),
    email: json.string('email'),
    displayName: json.string('display_name'),
    identityStatus: json['identity_status'] is String
        ? json['identity_status']! as String
        : 'pending',
    membershipStatus: json.string('membership_status'),
  );

  final String id;
  final String email;
  final String displayName;
  final String identityStatus;
  final String membershipStatus;
}

extension on Map<String, Object?> {
  String string(String key) {
    final value = this[key];
    if (value is! String) throw FormatException('Missing $key.');
    return value;
  }
}
