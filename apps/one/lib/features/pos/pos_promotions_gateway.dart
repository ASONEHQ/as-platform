import '../../core/networking/api_client.dart';

/// TASK 12.9: the Flutter side of the promotions/discounts/coupons engine
/// — see ADR-0016 and `docs/API_CONTRACTS.md` §16.9 for the full backend
/// design this mirrors. Every model here is exactly what the backend
/// returns; nothing is recomputed or guessed client-side (ADR-0016 D1: the
/// pricing engine is the ONE authoritative pricing algorithm — Flutter
/// never re-derives a discount amount, tax split, or coupon/promotion
/// eligibility decision, always trusts and displays the backend's own
/// numbers from the quote/create-sale response).

/// One cart line as the quote/sale-creation endpoints need it — only
/// `productId`/`quantity`; every commercial fact (price, tax, category) is
/// resolved server-side, exactly mirroring `PosSaleLineRequest`.
class PosPricingQuoteItem {
  const PosPricingQuoteItem({required this.productId, required this.quantity});
  final String productId;
  final String quantity;
}

/// `{scope, line_index?, type, value, reason_code}` — the exact,
/// deliberately minimal manual-discount request shape both
/// `POST /sales/pricing-quotes` and `POST /sales` accept
/// (`promotions.routes.ts`/`sales.routes.ts`). Never carries a computed
/// amount — the backend alone derives it.
class PosManualDiscountRequest {
  const PosManualDiscountRequest({
    required this.scope,
    this.lineIndex,
    required this.type,
    required this.value,
    required this.reasonCode,
  });

  /// `'line'` | `'ticket'`.
  final String scope;

  /// Required only when [scope] is `'line'` — the (0-based, per the
  /// backend schema's `minimum: 0`) index into the request's own `items`
  /// array.
  final int? lineIndex;

  /// `'percentage'` | `'fixed_amount'`.
  final String type;

  /// Basis points (percentage) or a decimal-string amount (fixed_amount),
  /// matching [type] — always a plain string, never a Dart `num`.
  final String value;

  final String reasonCode;

  Map<String, Object?> toJson() => {
    'scope': scope,
    if (lineIndex != null) 'line_index': lineIndex,
    'type': type,
    'value': value,
    'reason_code': reasonCode,
  };

  @override
  bool operator ==(Object other) =>
      other is PosManualDiscountRequest &&
      other.scope == scope &&
      other.lineIndex == lineIndex &&
      other.type == type &&
      other.value == value &&
      other.reasonCode == reasonCode;

  @override
  int get hashCode => Object.hash(scope, lineIndex, type, value, reasonCode);
}

/// One priced line of a quote response (`PricingQuoteLine` in
/// `promotions.routes.ts`) — `lineIndex` matches the request's own `items`
/// array position, so a caller can join a line's discount back onto its
/// own local ticket line without the backend needing to echo a product
/// name it doesn't otherwise need to.
class PosPricingQuoteLine {
  const PosPricingQuoteLine({
    required this.lineIndex,
    required this.productId,
    required this.nameSnapshot,
    required this.quantity,
    required this.unitPrice,
    required this.subtotal,
    required this.discountTotal,
    required this.taxTotal,
    required this.lineTotal,
  });

  factory PosPricingQuoteLine.fromJson(Map<String, Object?> json) =>
      PosPricingQuoteLine(
        lineIndex: json['line_index']! as int,
        productId: json['product_id']! as String,
        nameSnapshot: json['name_snapshot']! as String,
        quantity: json['quantity']! as String,
        unitPrice: json['unit_price']! as String,
        subtotal: json['subtotal']! as String,
        discountTotal: json['discount_total']! as String,
        taxTotal: json['tax_total']! as String,
        lineTotal: json['line_total']! as String,
      );

  final int lineIndex;
  final String productId;
  final String nameSnapshot;
  final String quantity;
  final String unitPrice;
  final String subtotal;
  final String discountTotal;
  final String taxTotal;
  final String lineTotal;
}

/// One entry of `applied_discounts` — a promotion, a coupon, or the
/// manual discount that actually reduced the cart, with the backend's own
/// human-readable `label` (never assembled client-side from a promotion
/// name this app doesn't otherwise fetch).
class PosAppliedDiscount {
  const PosAppliedDiscount({
    required this.sourceType,
    required this.sourceId,
    required this.label,
    required this.reasonCode,
    required this.amount,
    required this.lineIndex,
  });

  factory PosAppliedDiscount.fromJson(Map<String, Object?> json) =>
      PosAppliedDiscount(
        sourceType: json['source_type']! as String,
        sourceId: json['source_id'] as String?,
        label: json['label']! as String,
        reasonCode: json['reason_code'] as String?,
        amount: json['amount']! as String,
        lineIndex: json['line_index'] as int?,
      );

  /// `'promotion'` | `'coupon'` | `'manual'` | `'reward'` | `'membership'`
  /// (TASK 13.2 — ADR-0019: an attached, backend-validated reward
  /// entitlement, e.g. a VIP Pass; `sourceId` is the entitlement id,
  /// `label` is always the backend's own `'Recompensa'`, never a
  /// fabricated business name. TASK 16.21 — ADR-0020: `'membership'` is
  /// the attached customer's own active membership benefit, resolved
  /// automatically server-side whenever a customer is attached — never
  /// something this app computes or requests explicitly; `sourceId` is
  /// the `customer_memberships` id, `label` is always the backend's own
  /// `'Membresía'`).
  final String sourceType;
  final String? sourceId;
  final String label;
  final String? reasonCode;
  final String amount;

  /// `null` means ticket-wide (every eligible line contributed).
  final int? lineIndex;

  bool get isPromotion => sourceType == 'promotion';
  bool get isCoupon => sourceType == 'coupon';
  bool get isManual => sourceType == 'manual';
  bool get isReward => sourceType == 'reward';
  bool get isMembership => sourceType == 'membership';
}

/// One requested coupon code the backend could not apply — an honest
/// machine-readable `reason` (`not_found` | `inactive` | `not_started` |
/// `expired` | `branch_not_eligible` | `usage_exhausted` |
/// `cart_not_eligible`, see `pricing.service.ts`'s `CouponRejectionReason`)
/// that the UI maps to a short Spanish message — never a generic error,
/// never silently dropped.
class PosRejectedCoupon {
  const PosRejectedCoupon({required this.code, required this.reason});

  factory PosRejectedCoupon.fromJson(Map<String, Object?> json) =>
      PosRejectedCoupon(code: json['code']! as String, reason: json['reason']! as String);

  final String code;
  final String reason;
}

/// Maps a backend `rejected_coupons[].reason` code to a short, honest
/// Spanish message — never a generic "algo salió mal". Falls back to the
/// raw code (still honest, just less polished) for any reason this app
/// doesn't yet recognize, rather than hiding it.
String posCouponRejectionMessage(String reason) => switch (reason) {
  'not_found' => 'Cupón no encontrado.',
  'inactive' => 'Cupón inactivo.',
  'not_started' => 'Este cupón aún no está vigente.',
  'expired' => 'Cupón vencido.',
  'branch_not_eligible' => 'Este cupón no aplica en esta sucursal.',
  'usage_exhausted' => 'Cupón agotado.',
  'cart_not_eligible' => 'El ticket actual no cumple las condiciones del cupón.',
  _ => 'Cupón no válido ($reason).',
};

/// `POST /sales/pricing-quotes`'s full response — the one, single source
/// of truth for what the ticket may display once at least one quote has
/// been fetched (ADR-0016 D1/D2). Never partially trusted: a caller either
/// has a full, fresh [PosPricingQuote] for the exact current cart/coupon/
/// discount combination, or falls back to a plain, undiscounted local
/// display until the next quote arrives.
class PosPricingQuote {
  const PosPricingQuote({
    required this.currencyCode,
    required this.subtotal,
    required this.discountTotal,
    required this.taxTotal,
    required this.total,
    required this.lines,
    required this.appliedDiscounts,
    required this.rejectedCoupons,
  });

  factory PosPricingQuote.fromJson(Map<String, Object?> json) {
    final rawLines = json['lines'];
    final rawApplied = json['applied_discounts'];
    final rawRejected = json['rejected_coupons'];
    return PosPricingQuote(
      currencyCode: json['currency_code']! as String,
      subtotal: json['subtotal']! as String,
      discountTotal: json['discount_total']! as String,
      taxTotal: json['tax_total']! as String,
      total: json['total']! as String,
      lines: rawLines is List<Object?>
          ? rawLines.whereType<Map<String, Object?>>().map(PosPricingQuoteLine.fromJson).toList(growable: false)
          : const <PosPricingQuoteLine>[],
      appliedDiscounts: rawApplied is List<Object?>
          ? rawApplied.whereType<Map<String, Object?>>().map(PosAppliedDiscount.fromJson).toList(growable: false)
          : const <PosAppliedDiscount>[],
      rejectedCoupons: rawRejected is List<Object?>
          ? rawRejected.whereType<Map<String, Object?>>().map(PosRejectedCoupon.fromJson).toList(growable: false)
          : const <PosRejectedCoupon>[],
    );
  }

  final String currencyCode;
  final String subtotal;
  final String discountTotal;
  final String taxTotal;
  final String total;
  final List<PosPricingQuoteLine> lines;
  final List<PosAppliedDiscount> appliedDiscounts;
  final List<PosRejectedCoupon> rejectedCoupons;

  /// The automatic-promotion subset of [appliedDiscounts] — surfaced even
  /// when no coupon code was ever requested (ADR-0016 automatic
  /// promotions apply on their own).
  List<PosAppliedDiscount> get appliedPromotions =>
      appliedDiscounts.where((entry) => entry.isPromotion).toList(growable: false);

  /// TASK 13.2: the reward-entitlement subset of [appliedDiscounts] —
  /// empty unless a `reward_entitlement_id` was supplied on this quote and
  /// the backend accepted it (ADR-0019). Never guessed client-side.
  List<PosAppliedDiscount> get appliedRewards =>
      appliedDiscounts.where((entry) => entry.isReward).toList(growable: false);

  /// TASK 16.21: the membership-benefit subset of [appliedDiscounts] —
  /// empty unless a customer with a genuinely active, eligible membership
  /// is attached to this quote (ADR-0020). Resolved automatically by the
  /// backend, never requested explicitly by this app (unlike
  /// [appliedRewards]'s `reward_entitlement_id`).
  List<PosAppliedDiscount> get appliedMemberships =>
      appliedDiscounts.where((entry) => entry.isMembership).toList(growable: false);

  PosRejectedCoupon? rejectionFor(String code) {
    final normalized = code.trim().toUpperCase();
    for (final rejected in rejectedCoupons) {
      if (rejected.code.trim().toUpperCase() == normalized) return rejected;
    }
    return null;
  }
}

/// A `promotions` row (`PromotionRow` in `promotions.types.ts`) —
/// deliberately mirrors every admin-management field the backend exposes;
/// nothing here is business-specific (ADR-0016 Part U: generic CRUD over
/// whatever data exists, never a hardcoded promotion name).
class PosPromotion {
  const PosPromotion({
    required this.id,
    required this.name,
    required this.description,
    required this.active,
    required this.startsAt,
    required this.endsAt,
    required this.daysOfWeek,
    required this.timeFrom,
    required this.timeTo,
    required this.priority,
    required this.stackable,
    required this.benefitType,
    required this.benefitPercentageBasisPoints,
    required this.benefitFixedAmount,
    required this.benefitNxmBuyQuantity,
    required this.benefitNxmPayQuantity,
    required this.minQuantity,
    required this.minSubtotal,
    required this.usageLimitTotal,
    required this.combinableWithCoupons,
    required this.branchIds,
    required this.productIds,
    required this.categoryIds,
    required this.version,
  });

  factory PosPromotion.fromJson(Map<String, Object?> json) => PosPromotion(
    id: json['id']! as String,
    name: json['name']! as String,
    description: json['description'] as String?,
    active: json['active'] == true,
    startsAt: json['starts_at'] == null ? null : DateTime.parse(json['starts_at']! as String),
    endsAt: json['ends_at'] == null ? null : DateTime.parse(json['ends_at']! as String),
    daysOfWeek: (json['days_of_week'] as List<Object?>?)?.whereType<int>().toList(growable: false),
    timeFrom: json['time_from'] as String?,
    timeTo: json['time_to'] as String?,
    priority: json['priority']! as int,
    stackable: json['stackable'] == true,
    benefitType: json['benefit_type']! as String,
    benefitPercentageBasisPoints: json['benefit_percentage_basis_points'] as int?,
    benefitFixedAmount: json['benefit_fixed_amount'] as String?,
    benefitNxmBuyQuantity: json['benefit_nxm_buy_quantity'] as int?,
    benefitNxmPayQuantity: json['benefit_nxm_pay_quantity'] as int?,
    minQuantity: json['min_quantity'] as String?,
    minSubtotal: json['min_subtotal'] as String?,
    usageLimitTotal: json['usage_limit_total'] as int?,
    combinableWithCoupons: json['combinable_with_coupons'] == true,
    branchIds: (json['branch_ids'] as List<Object?>?)?.whereType<String>().toList(growable: false) ?? const [],
    productIds: (json['product_ids'] as List<Object?>?)?.whereType<String>().toList(growable: false) ?? const [],
    categoryIds: (json['category_ids'] as List<Object?>?)?.whereType<String>().toList(growable: false) ?? const [],
    version: json['version']! as int,
  );

  final String id;
  final String name;
  final String? description;
  final bool active;
  final DateTime? startsAt;
  final DateTime? endsAt;
  final List<int>? daysOfWeek;
  final String? timeFrom;
  final String? timeTo;
  final int priority;
  final bool stackable;

  /// `percentage` | `fixed_amount` | `fixed_price` | `quantity_nxm`.
  final String benefitType;
  final int? benefitPercentageBasisPoints;
  final String? benefitFixedAmount;
  final int? benefitNxmBuyQuantity;
  final int? benefitNxmPayQuantity;
  final String? minQuantity;
  final String? minSubtotal;
  final int? usageLimitTotal;
  final bool combinableWithCoupons;
  final List<String> branchIds;
  final List<String> productIds;
  final List<String> categoryIds;
  final int version;

  /// A short, honest, non-business-specific summary of the benefit — e.g.
  /// "10% de descuento", "2x1", "$50.00 fijo" — never a fabricated
  /// promotion name.
  String get benefitSummary => switch (benefitType) {
    'percentage' => benefitPercentageBasisPoints == null
        ? 'Porcentaje'
        : '${(benefitPercentageBasisPoints! / 100).toStringAsFixed(2)}% de descuento',
    'fixed_amount' => benefitFixedAmount == null ? 'Monto fijo' : '\$$benefitFixedAmount fijo',
    'fixed_price' => benefitFixedAmount == null ? 'Precio fijo' : 'Precio fijo \$$benefitFixedAmount',
    'quantity_nxm' => benefitNxmBuyQuantity == null || benefitNxmPayQuantity == null
        ? 'Nxm'
        : '${benefitNxmBuyQuantity}x$benefitNxmPayQuantity',
    _ => benefitType,
  };
}

/// The minimal, strict, admin-form input shape both create (`POST
/// /promotions`) and update (`PUT /promotions/{id}`, partial) accept —
/// every field optional so an update can send only what changed.
class PosPromotionInput {
  const PosPromotionInput({
    this.name,
    this.description,
    this.active,
    this.startsAt,
    this.endsAt,
    this.daysOfWeek,
    this.timeFrom,
    this.timeTo,
    this.priority,
    this.stackable,
    this.benefitType,
    this.benefitPercentageBasisPoints,
    this.benefitFixedAmount,
    this.benefitNxmBuyQuantity,
    this.benefitNxmPayQuantity,
    this.minQuantity,
    this.minSubtotal,
    this.usageLimitTotal,
    this.combinableWithCoupons,
    this.branchIds,
    this.productIds,
    this.categoryIds,
  });

  final String? name;
  final String? description;
  final bool? active;
  final DateTime? startsAt;
  final DateTime? endsAt;
  final List<int>? daysOfWeek;
  final String? timeFrom;
  final String? timeTo;
  final int? priority;
  final bool? stackable;
  final String? benefitType;
  final int? benefitPercentageBasisPoints;
  final String? benefitFixedAmount;
  final int? benefitNxmBuyQuantity;
  final int? benefitNxmPayQuantity;
  final String? minQuantity;
  final String? minSubtotal;
  final int? usageLimitTotal;
  final bool? combinableWithCoupons;
  final List<String>? branchIds;
  final List<String>? productIds;
  final List<String>? categoryIds;

  Map<String, Object?> toJson() => {
    if (name != null) 'name': name,
    if (description != null) 'description': description,
    if (active != null) 'active': active,
    if (startsAt != null) 'starts_at': startsAt!.toUtc().toIso8601String(),
    if (endsAt != null) 'ends_at': endsAt!.toUtc().toIso8601String(),
    if (daysOfWeek != null) 'days_of_week': daysOfWeek,
    if (timeFrom != null) 'time_from': timeFrom,
    if (timeTo != null) 'time_to': timeTo,
    if (priority != null) 'priority': priority,
    if (stackable != null) 'stackable': stackable,
    if (benefitType != null) 'benefit_type': benefitType,
    if (benefitPercentageBasisPoints != null) 'benefit_percentage_basis_points': benefitPercentageBasisPoints,
    if (benefitFixedAmount != null) 'benefit_fixed_amount': benefitFixedAmount,
    if (benefitNxmBuyQuantity != null) 'benefit_nxm_buy_quantity': benefitNxmBuyQuantity,
    if (benefitNxmPayQuantity != null) 'benefit_nxm_pay_quantity': benefitNxmPayQuantity,
    if (minQuantity != null) 'min_quantity': minQuantity,
    if (minSubtotal != null) 'min_subtotal': minSubtotal,
    if (usageLimitTotal != null) 'usage_limit_total': usageLimitTotal,
    if (combinableWithCoupons != null) 'combinable_with_coupons': combinableWithCoupons,
    if (branchIds != null) 'branch_ids': branchIds,
    if (productIds != null) 'product_ids': productIds,
    if (categoryIds != null) 'category_ids': categoryIds,
  };
}

class PosPromotionPage {
  const PosPromotionPage({required this.items, required this.nextCursor});
  final List<PosPromotion> items;
  final String? nextCursor;
}

/// A `coupons` row (`CouponRow` in `promotions.types.ts`).
class PosCoupon {
  const PosCoupon({
    required this.id,
    required this.code,
    required this.description,
    required this.benefitType,
    required this.benefitPercentageBasisPoints,
    required this.benefitFixedAmount,
    required this.active,
    required this.startsAt,
    required this.endsAt,
    required this.minSubtotal,
    required this.usageLimitTotal,
    required this.promotionId,
    required this.version,
  });

  factory PosCoupon.fromJson(Map<String, Object?> json) => PosCoupon(
    id: json['id']! as String,
    code: json['code']! as String,
    description: json['description'] as String?,
    benefitType: json['benefit_type']! as String,
    benefitPercentageBasisPoints: json['benefit_percentage_basis_points'] as int?,
    benefitFixedAmount: json['benefit_fixed_amount'] as String?,
    active: json['active'] == true,
    startsAt: json['starts_at'] == null ? null : DateTime.parse(json['starts_at']! as String),
    endsAt: json['ends_at'] == null ? null : DateTime.parse(json['ends_at']! as String),
    minSubtotal: json['min_subtotal'] as String?,
    usageLimitTotal: json['usage_limit_total'] as int?,
    promotionId: json['promotion_id'] as String?,
    version: json['version']! as int,
  );

  final String id;
  final String code;
  final String? description;

  /// `percentage` | `fixed_amount`.
  final String benefitType;
  final int? benefitPercentageBasisPoints;
  final String? benefitFixedAmount;
  final bool active;
  final DateTime? startsAt;
  final DateTime? endsAt;
  final String? minSubtotal;

  /// The configured redemption limit, if any — not a live usage count (no
  /// GET response exposes one today; never fabricated here, per ADR-0016
  /// Part U).
  final int? usageLimitTotal;
  final String? promotionId;
  final int version;

  String get benefitSummary => switch (benefitType) {
    'percentage' => benefitPercentageBasisPoints == null
        ? 'Porcentaje'
        : '${(benefitPercentageBasisPoints! / 100).toStringAsFixed(2)}% de descuento',
    'fixed_amount' => benefitFixedAmount == null ? 'Monto fijo' : '\$$benefitFixedAmount fijo',
    _ => benefitType,
  };
}

/// Create (`POST /coupons`) input — every optional field mirrors the
/// backend's own strict body.
class PosCouponInput {
  const PosCouponInput({
    this.code,
    this.description,
    this.benefitType,
    this.benefitPercentageBasisPoints,
    this.benefitFixedAmount,
    this.active,
    this.startsAt,
    this.endsAt,
    this.minSubtotal,
    this.usageLimitTotal,
    this.promotionId,
  });

  final String? code;
  final String? description;
  final String? benefitType;
  final int? benefitPercentageBasisPoints;
  final String? benefitFixedAmount;
  final bool? active;
  final DateTime? startsAt;
  final DateTime? endsAt;
  final String? minSubtotal;
  final int? usageLimitTotal;
  final String? promotionId;

  Map<String, Object?> toJson() => {
    if (code != null) 'code': code,
    if (description != null) 'description': description,
    if (benefitType != null) 'benefit_type': benefitType,
    if (benefitPercentageBasisPoints != null) 'benefit_percentage_basis_points': benefitPercentageBasisPoints,
    if (benefitFixedAmount != null) 'benefit_fixed_amount': benefitFixedAmount,
    if (active != null) 'active': active,
    if (startsAt != null) 'starts_at': startsAt!.toUtc().toIso8601String(),
    if (endsAt != null) 'ends_at': endsAt!.toUtc().toIso8601String(),
    if (minSubtotal != null) 'min_subtotal': minSubtotal,
    if (usageLimitTotal != null) 'usage_limit_total': usageLimitTotal,
    if (promotionId != null) 'promotion_id': promotionId,
  };
}

/// `PUT /coupons/{id}` — a narrower field set than creation (matches
/// `promotions.routes.ts`'s own coupon PUT body exactly: no
/// `code`/`benefit_type`/`benefit_*` fields are editable after creation).
class PosCouponUpdateInput {
  const PosCouponUpdateInput({
    this.description,
    this.active,
    this.startsAt,
    this.endsAt,
    this.minSubtotal,
    this.usageLimitTotal,
  });

  final String? description;
  final bool? active;
  final DateTime? startsAt;
  final DateTime? endsAt;
  final String? minSubtotal;
  final int? usageLimitTotal;

  Map<String, Object?> toJson() => {
    if (description != null) 'description': description,
    if (active != null) 'active': active,
    if (startsAt != null) 'starts_at': startsAt!.toUtc().toIso8601String(),
    if (endsAt != null) 'ends_at': endsAt!.toUtc().toIso8601String(),
    if (minSubtotal != null) 'min_subtotal': minSubtotal,
    if (usageLimitTotal != null) 'usage_limit_total': usageLimitTotal,
  };
}

class PosCouponPage {
  const PosCouponPage({required this.items, required this.nextCursor});
  final List<PosCoupon> items;
  final String? nextCursor;
}

abstract interface class PosPromotionsGateway {
  /// `POST /api/v1/sales/pricing-quotes` — a read-only preview
  /// (`sale.create`); never consumes a coupon redemption, never mutates
  /// anything (ADR-0016 D1). Throws [ApiException] honestly on rejection
  /// — a caller must surface the real error, never a fabricated total.
  ///
  /// TASK 13.2: [customerId]/[rewardEntitlementId] preview an already-
  /// attached customer's reward entitlement being applied (ADR-0019) —
  /// required together by the backend (supplying one without the other is
  /// a 400); omitting both reproduces the exact pre-TASK-13.2 request
  /// shape.
  Future<PosPricingQuote> quote({
    required String branchId,
    required List<PosPricingQuoteItem> items,
    List<String> couponCodes = const [],
    PosManualDiscountRequest? manualDiscount,
    String? customerId,
    String? rewardEntitlementId,
  });

  /// `POST /api/v1/promotions` (`promotion.manage`).
  Future<PosPromotion> createPromotion(PosPromotionInput input);

  /// `GET /api/v1/promotions` (`promotion.read`).
  Future<PosPromotionPage> listPromotions({String? cursor, int limit = 50, bool? active});

  /// `GET /api/v1/promotions/{id}` (`promotion.read`).
  Future<PosPromotion> promotion(String id);

  /// `PUT /api/v1/promotions/{id}` (`promotion.manage`) — [version] is the
  /// row's own already-fetched `version`, sent as the strong `If-Match`
  /// the backend requires.
  Future<PosPromotion> updatePromotion(String id, PosPromotionInput input, {required int version});

  /// `POST /api/v1/coupons` (`coupon.manage`).
  Future<PosCoupon> createCoupon(PosCouponInput input);

  /// `GET /api/v1/coupons` (`coupon.read`).
  Future<PosCouponPage> listCoupons({String? cursor, int limit = 50, bool? active});

  /// `GET /api/v1/coupons/{id}` (`coupon.read`).
  Future<PosCoupon> coupon(String id);

  /// `PUT /api/v1/coupons/{id}` (`coupon.manage`).
  Future<PosCoupon> updateCoupon(String id, PosCouponUpdateInput input, {required int version});
}

class ApiPosPromotionsGateway implements PosPromotionsGateway {
  const ApiPosPromotionsGateway(this._client);

  final ApiClient _client;

  @override
  Future<PosPricingQuote> quote({
    required String branchId,
    required List<PosPricingQuoteItem> items,
    List<String> couponCodes = const [],
    PosManualDiscountRequest? manualDiscount,
    String? customerId,
    String? rewardEntitlementId,
  }) async {
    final envelope = await _client.postJson(
      '/api/v1/sales/pricing-quotes',
      body: {
        'branch_id': branchId,
        'items': [for (final item in items) {'product_id': item.productId, 'quantity': item.quantity}],
        if (couponCodes.isNotEmpty) 'coupon_codes': couponCodes,
        if (manualDiscount != null) 'manual_discount': manualDiscount.toJson(),
        if (customerId != null) 'customer_id': customerId,
        if (rewardEntitlementId != null) 'reward_entitlement_id': rewardEntitlementId,
      },
    );
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing pricing quote data.');
    }
    return PosPricingQuote.fromJson(data);
  }

  @override
  Future<PosPromotion> createPromotion(PosPromotionInput input) async {
    final envelope = await _client.postJson(
      '/api/v1/promotions',
      idempotencyKey: _idempotencyKey('promotion'),
      body: input.toJson(),
    );
    return _decodePromotion(envelope);
  }

  @override
  Future<PosPromotionPage> listPromotions({String? cursor, int limit = 50, bool? active}) async {
    final query = <String, String>{
      'limit': '$limit',
      if (cursor != null) 'cursor': cursor,
      if (active != null) 'active': '$active',
    };
    final path = Uri(path: '/api/v1/promotions', queryParameters: query).toString();
    final envelope = await _client.getJson(path);
    return _decodePromotionPage(envelope);
  }

  @override
  Future<PosPromotion> promotion(String id) async {
    final envelope = await _client.getJson('/api/v1/promotions/$id');
    return _decodePromotion(envelope);
  }

  @override
  Future<PosPromotion> updatePromotion(String id, PosPromotionInput input, {required int version}) async {
    final envelope = await _client.putJson(
      '/api/v1/promotions/$id',
      ifMatch: '"$version"',
      body: input.toJson(),
    );
    return _decodePromotion(envelope);
  }

  @override
  Future<PosCoupon> createCoupon(PosCouponInput input) async {
    final envelope = await _client.postJson(
      '/api/v1/coupons',
      idempotencyKey: _idempotencyKey('coupon'),
      body: input.toJson(),
    );
    return _decodeCoupon(envelope);
  }

  @override
  Future<PosCouponPage> listCoupons({String? cursor, int limit = 50, bool? active}) async {
    final query = <String, String>{
      'limit': '$limit',
      if (cursor != null) 'cursor': cursor,
      if (active != null) 'active': '$active',
    };
    final path = Uri(path: '/api/v1/coupons', queryParameters: query).toString();
    final envelope = await _client.getJson(path);
    return _decodeCouponPage(envelope);
  }

  @override
  Future<PosCoupon> coupon(String id) async {
    final envelope = await _client.getJson('/api/v1/coupons/$id');
    return _decodeCoupon(envelope);
  }

  @override
  Future<PosCoupon> updateCoupon(String id, PosCouponUpdateInput input, {required int version}) async {
    final envelope = await _client.putJson(
      '/api/v1/coupons/$id',
      ifMatch: '"$version"',
      body: input.toJson(),
    );
    return _decodeCoupon(envelope);
  }

  static String _idempotencyKey(String kind) =>
      'one-$kind-${DateTime.now().toUtc().microsecondsSinceEpoch}';

  PosPromotion _decodePromotion(Map<String, Object?> envelope) {
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing promotion data.');
    }
    return PosPromotion.fromJson(data);
  }

  PosPromotionPage _decodePromotionPage(Map<String, Object?> envelope) {
    final data = envelope['data'];
    if (data is! List<Object?>) {
      throw const FormatException('Missing promotions list data.');
    }
    final meta = envelope['meta'];
    final page = meta is Map<String, Object?> ? meta['page'] : null;
    final nextCursor = page is Map<String, Object?> ? page['next_cursor'] as String? : null;
    return PosPromotionPage(
      items: data.whereType<Map<String, Object?>>().map(PosPromotion.fromJson).toList(growable: false),
      nextCursor: nextCursor,
    );
  }

  PosCoupon _decodeCoupon(Map<String, Object?> envelope) {
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing coupon data.');
    }
    return PosCoupon.fromJson(data);
  }

  PosCouponPage _decodeCouponPage(Map<String, Object?> envelope) {
    final data = envelope['data'];
    if (data is! List<Object?>) {
      throw const FormatException('Missing coupons list data.');
    }
    final meta = envelope['meta'];
    final page = meta is Map<String, Object?> ? meta['page'] : null;
    final nextCursor = page is Map<String, Object?> ? page['next_cursor'] as String? : null;
    return PosCouponPage(
      items: data.whereType<Map<String, Object?>>().map(PosCoupon.fromJson).toList(growable: false),
      nextCursor: nextCursor,
    );
  }
}

class EmptyPosPromotionsGateway implements PosPromotionsGateway {
  const EmptyPosPromotionsGateway();

  @override
  Future<PosPricingQuote> quote({
    required String branchId,
    required List<PosPricingQuoteItem> items,
    List<String> couponCodes = const [],
    PosManualDiscountRequest? manualDiscount,
    String? customerId,
    String? rewardEntitlementId,
  }) => Future.error(StateError('No promotions gateway is configured.'));

  @override
  Future<PosPromotion> createPromotion(PosPromotionInput input) =>
      Future.error(StateError('No promotions gateway is configured.'));

  @override
  Future<PosPromotionPage> listPromotions({String? cursor, int limit = 50, bool? active}) async =>
      const PosPromotionPage(items: [], nextCursor: null);

  @override
  Future<PosPromotion> promotion(String id) => Future.error(StateError('No promotions gateway is configured.'));

  @override
  Future<PosPromotion> updatePromotion(String id, PosPromotionInput input, {required int version}) =>
      Future.error(StateError('No promotions gateway is configured.'));

  @override
  Future<PosCoupon> createCoupon(PosCouponInput input) =>
      Future.error(StateError('No promotions gateway is configured.'));

  @override
  Future<PosCouponPage> listCoupons({String? cursor, int limit = 50, bool? active}) async =>
      const PosCouponPage(items: [], nextCursor: null);

  @override
  Future<PosCoupon> coupon(String id) => Future.error(StateError('No promotions gateway is configured.'));

  @override
  Future<PosCoupon> updateCoupon(String id, PosCouponUpdateInput input, {required int version}) =>
      Future.error(StateError('No promotions gateway is configured.'));
}
