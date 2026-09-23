/// TASK 14.3 (Wave 1, Part A): the Flutter side of the "Fiestas" (party
/// reservations) domain — mirrors `apps/api/src/modules/parties/`'s real,
/// tested routes exactly (`party-rooms.routes.ts`, `party-packages.routes.ts`,
/// `party-reservations.routes.ts`, `parties.types.ts`). Every model here is
/// exactly what the backend returns; nothing is recomputed, merged, or
/// guessed client-side — matches `pos_customers_gateway.dart`/
/// `pos_memberships_gateway.dart`'s own "backend is the sole authority"
/// convention (ADR-0017).
///
/// Multi-tenant genericity is mandatory throughout this domain: no park
/// name, room name, package name, price, or policy is ever hardcoded here
/// — everything comes from the real API responses.
library;

/// Legacy's exact 5-state machine (`parties.types.ts`
/// `partyReservationStatuses`): `held` (Apartada) -> `pending_deposit` ->
/// `confirmed` -> `completed`; `cancelled` is reachable from any
/// non-terminal state. Never a client-invented 6th state.
const List<String> partyReservationStatuses = [
  'held',
  'pending_deposit',
  'confirmed',
  'completed',
  'cancelled',
];

/// The exact allowed forward edges of the status machine
/// (`parties.types.ts` `partyReservationTransitions`), keyed by the
/// *current* status — mirrored here ONLY so the UI never offers an
/// invalid jump; the backend is still the sole enforcer (this app treats
/// this purely as a UI courtesy, exactly like `posAddabilityBlock`'s own
/// "UI gate is a courtesy, not the only guard" precedent in
/// `pos_models.dart`).
const Map<String, List<String>> partyReservationTransitions = {
  'held': ['pending_deposit', 'confirmed', 'cancelled'],
  'pending_deposit': ['confirmed', 'cancelled'],
  'confirmed': ['completed', 'cancelled'],
  'completed': [],
  'cancelled': [],
};

const List<String> partyRoomStatuses = ['active', 'maintenance', 'out_of_service'];
const List<String> partyPackageStatuses = ['active', 'inactive'];
const List<String> partyReservationPaymentPurposes = ['deposit', 'balance', 'additional'];
const List<String> partySockDeductionStatuses = ['pending', 'deducted', 'not_applicable'];

/// A `party_rooms` row (`roomHttp` in `party-rooms.routes.ts`).
class PosPartyRoom {
  const PosPartyRoom({
    required this.id,
    required this.branchId,
    required this.code,
    required this.name,
    required this.status,
    required this.capacityChildren,
    required this.capacityAdults,
    required this.capacityTotal,
    required this.color,
    required this.notes,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
  });

  factory PosPartyRoom.fromJson(Map<String, Object?> json) => PosPartyRoom(
    id: json['id']! as String,
    branchId: json['branch_id']! as String,
    code: json['code']! as String,
    name: json['name']! as String,
    status: json['status']! as String,
    capacityChildren: json['capacity_children'] as int?,
    capacityAdults: json['capacity_adults'] as int?,
    capacityTotal: json['capacity_total'] as int?,
    color: json['color'] as String?,
    notes: json['notes'] as String?,
    version: json['version']! as int,
    createdAt: DateTime.parse(json['created_at']! as String),
    updatedAt: DateTime.parse(json['updated_at']! as String),
  );

  final String id;
  final String branchId;
  final String code;
  final String name;

  /// `active` | `maintenance` | `out_of_service`.
  final String status;
  final int? capacityChildren;
  final int? capacityAdults;
  final int? capacityTotal;
  final String? color;
  final String? notes;
  final int version;
  final DateTime createdAt;
  final DateTime updatedAt;
}

class PosPartyRoomInput {
  const PosPartyRoomInput({
    this.branchId,
    this.code,
    this.name,
    this.status,
    this.capacityChildren,
    this.capacityAdults,
    this.capacityTotal,
    this.color,
    this.notes,
  });

  final String? branchId;
  final String? code;
  final String? name;
  final String? status;
  final int? capacityChildren;
  final int? capacityAdults;
  final int? capacityTotal;
  final String? color;
  final String? notes;

  Map<String, Object?> toJson() => {
    if (branchId != null) 'branch_id': branchId,
    if (code != null) 'code': code,
    if (name != null) 'name': name,
    if (status != null) 'status': status,
    if (capacityChildren != null) 'capacity_children': capacityChildren,
    if (capacityAdults != null) 'capacity_adults': capacityAdults,
    if (capacityTotal != null) 'capacity_total': capacityTotal,
    if (color != null) 'color': color,
    if (notes != null) 'notes': notes,
  };
}

/// TASK 16.22 — one room's live availability for a given package/date/
/// time (`GET /party-reservations/availability`) — the genuine gap this
/// task's own forensic audit of the legacy Cotizador found: the backend
/// previously had no way to tell an operator which rooms were actually
/// bookable before quoting one. Only rooms genuinely ELIGIBLE for the
/// package appear at all (mirrors legacy's own `cotizadorSalonesCompatibles`
/// filtering) — an ineligible room is never returned as "unavailable for
/// another reason." Never trusted as the final booking gate — `POST
/// /party-reservations` independently re-validates conflict/capacity/
/// eligibility itself before ever committing.
class PosPartyRoomAvailability {
  const PosPartyRoomAvailability({
    required this.roomId,
    required this.code,
    required this.name,
    required this.capacityChildren,
    required this.capacityAdults,
    required this.capacityTotal,
    required this.color,
    required this.available,
    required this.reason,
    required this.conflictingReservationNumber,
  });

  factory PosPartyRoomAvailability.fromJson(Map<String, Object?> json) => PosPartyRoomAvailability(
    roomId: json['room_id']! as String,
    code: json['code']! as String,
    name: json['name']! as String,
    capacityChildren: json['capacity_children'] as int?,
    capacityAdults: json['capacity_adults'] as int?,
    capacityTotal: json['capacity_total'] as int?,
    color: json['color'] as String?,
    available: json['available'] == true,
    reason: json['reason'] as String?,
    conflictingReservationNumber: json['conflicting_reservation_number'] as String?,
  );

  final String roomId;
  final String code;
  final String name;
  final int? capacityChildren;
  final int? capacityAdults;
  final int? capacityTotal;
  final String? color;
  final bool available;

  /// `'conflict'` | `'capacity'` | `null` (only set when [available] is
  /// `false`).
  final String? reason;

  /// Only set when [reason] is `'conflict'` — the real, human-readable
  /// folio of the reservation already occupying this room/window, never
  /// an internal id.
  final String? conflictingReservationNumber;
}

/// The full `GET /party-reservations/availability` response — the
/// server-computed `endTime` (package duration + extra half-hours, never
/// recomputed client-side — see the backend's own `computeEndTime`) plus
/// every eligible room's availability.
class PosPartyRoomAvailabilityResult {
  const PosPartyRoomAvailabilityResult({
    required this.eventDate,
    required this.startTime,
    required this.endTime,
    required this.rooms,
  });

  factory PosPartyRoomAvailabilityResult.fromJson(Map<String, Object?> json) {
    final rawRooms = json['rooms'];
    return PosPartyRoomAvailabilityResult(
      eventDate: json['event_date']! as String,
      startTime: json['start_time']! as String,
      endTime: json['end_time']! as String,
      rooms: rawRooms is List<Object?>
          ? rawRooms.whereType<Map<String, Object?>>().map(PosPartyRoomAvailability.fromJson).toList(growable: false)
          : const <PosPartyRoomAvailability>[],
    );
  }

  final String eventDate;
  final String startTime;
  final String endTime;
  final List<PosPartyRoomAvailability> rooms;
}

/// TASK 16.20A (Part 2) — one planned consumable entry inside a
/// package's `included_consumables` (`includedConsumableHttp` in
/// `party-packages.routes.ts`). `productId`/`productVariantId` are real
/// catalog references, server-validated at save time (never a raw
/// UUID an admin types by hand — the Flutter form always resolves these
/// from a real product/variant picker).
class PosPartyIncludedConsumable {
  const PosPartyIncludedConsumable({
    required this.kind,
    required this.label,
    required this.quantity,
    this.productId,
    this.productVariantId,
    this.size,
  });

  factory PosPartyIncludedConsumable.fromJson(Map<String, Object?> json) => PosPartyIncludedConsumable(
    kind: json['kind']! as String,
    label: json['label']! as String,
    quantity: (json['quantity']! as num).toDouble(),
    productId: json['product_id'] as String?,
    productVariantId: json['product_variant_id'] as String?,
    size: json['size'] as String?,
  );

  /// `sock` | `snack`.
  final String kind;
  final String label;
  final double quantity;
  final String? productId;
  final String? productVariantId;
  final String? size;

  Map<String, Object?> toJson() => {
    'kind': kind,
    'label': label,
    'quantity': quantity,
    if (productId != null) 'product_id': productId,
    if (productVariantId != null) 'product_variant_id': productVariantId,
    if (size != null) 'size': size,
  };
}

/// A `party_packages` row (`packageHttp` in `party-packages.routes.ts`).
/// [includes]/[restrictions] are the legacy's rich, admin-defined JSON
/// structure (recovery doc Capability 5) — rendered as a simple key/value
/// tag editor, never dumped as raw JSON text where reasonably avoidable.
class PosPartyPackage {
  const PosPartyPackage({
    required this.id,
    required this.branchId,
    required this.code,
    required this.name,
    required this.description,
    required this.status,
    required this.price,
    required this.currencyCode,
    required this.durationMinutes,
    required this.childrenIncluded,
    required this.adultsIncluded,
    required this.childExtraCost,
    required this.adultExtraCost,
    required this.capacityMax,
    required this.extraHalfHourCost,
    required this.taxCode,
    required this.includes,
    required this.restrictions,
    required this.includedConsumables,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
  });

  factory PosPartyPackage.fromJson(Map<String, Object?> json) => PosPartyPackage(
    id: json['id']! as String,
    branchId: json['branch_id'] as String?,
    code: json['code']! as String,
    name: json['name']! as String,
    description: json['description'] as String?,
    status: json['status']! as String,
    price: json['price']! as String,
    currencyCode: json['currency_code']! as String,
    durationMinutes: json['duration_minutes']! as int,
    childrenIncluded: json['children_included']! as int,
    adultsIncluded: json['adults_included']! as int,
    childExtraCost: json['child_extra_cost']! as String,
    adultExtraCost: json['adult_extra_cost']! as String,
    capacityMax: json['capacity_max'] as int?,
    extraHalfHourCost: json['extra_half_hour_cost']! as String,
    taxCode: json['tax_code'] as String? ?? 'IVA_GENERAL',
    includes: json['includes'] is Map<String, Object?> ? json['includes']! as Map<String, Object?> : null,
    restrictions: json['restrictions'] is Map<String, Object?> ? json['restrictions']! as Map<String, Object?> : null,
    includedConsumables: json['included_consumables'] is List<Object?>
        ? (json['included_consumables']! as List<Object?>)
              .whereType<Map<String, Object?>>()
              .map(PosPartyIncludedConsumable.fromJson)
              .toList(growable: false)
        : const [],
    version: json['version']! as int,
    createdAt: DateTime.parse(json['created_at']! as String),
    updatedAt: DateTime.parse(json['updated_at']! as String),
  );

  final String id;
  final String? branchId;
  final String code;
  final String name;
  final String? description;

  /// `active` | `inactive`.
  final String status;
  final String price;
  final String currencyCode;
  final int durationMinutes;
  final int childrenIncluded;
  final int adultsIncluded;
  final String childExtraCost;
  final String adultExtraCost;
  final int? capacityMax;
  final String extraHalfHourCost;

  /// `IVA_GENERAL` (16%) | `IVA_EXEMPT` (0%) — the same tax classification
  /// `products.tax_code` already carries (TASK 16.19).
  final String taxCode;
  final Map<String, Object?>? includes;
  final Map<String, Object?>? restrictions;

  /// TASK 16.20A — the real, catalog-backed planned socks/snacks this
  /// package auto-plans at booking time. Always a list, never null
  /// (empty = no consumables configured).
  final List<PosPartyIncludedConsumable> includedConsumables;
  final int version;
  final DateTime createdAt;
  final DateTime updatedAt;

  /// `restrictions.eligibleRoomIds` (TASK 16.19, Phase 6 "room usage") —
  /// `null`/empty means every room in this package's own branch scope is
  /// eligible; a non-empty list narrows it to exactly those room ids.
  /// Mirrors `isRoomEligibleForPackage` (`parties.pricing.ts`) exactly —
  /// this getter is a UI convenience only, never the enforcement source.
  List<String>? get eligibleRoomIds {
    final raw = restrictions?['eligibleRoomIds'];
    if (raw is! List<Object?>) return null;
    final ids = raw.whereType<String>().toList(growable: false);
    return ids.isEmpty ? null : ids;
  }

  bool isEligibleForRoom(String roomId) {
    final ids = eligibleRoomIds;
    return ids == null || ids.contains(roomId);
  }
}

class PosPartyPackageInput {
  const PosPartyPackageInput({
    this.branchId,
    this.code,
    this.name,
    this.description,
    this.status,
    this.price,
    this.currencyCode,
    this.durationMinutes,
    this.childrenIncluded,
    this.adultsIncluded,
    this.childExtraCost,
    this.adultExtraCost,
    this.capacityMax,
    this.extraHalfHourCost,
    this.taxCode,
    this.includes,
    this.restrictions,
    this.includedConsumables,
  });

  final String? branchId;
  final String? code;
  final String? name;
  final String? description;
  final String? status;
  final String? price;
  final String? currencyCode;
  final int? durationMinutes;
  final int? childrenIncluded;
  final int? adultsIncluded;
  final String? childExtraCost;
  final String? adultExtraCost;
  final int? capacityMax;
  final String? extraHalfHourCost;
  final String? taxCode;
  final Map<String, Object?>? includes;
  final Map<String, Object?>? restrictions;

  /// TASK 16.20A — `null` means "don't change this field" (matches every
  /// other optional field's own PATCH semantics); an empty list is a
  /// real, explicit "no consumables" — never conflated with "unset".
  final List<PosPartyIncludedConsumable>? includedConsumables;

  Map<String, Object?> toJson() => {
    if (branchId != null) 'branch_id': branchId,
    if (code != null) 'code': code,
    if (name != null) 'name': name,
    if (description != null) 'description': description,
    if (status != null) 'status': status,
    if (price != null) 'price': price,
    if (currencyCode != null) 'currency_code': currencyCode,
    if (durationMinutes != null) 'duration_minutes': durationMinutes,
    if (childrenIncluded != null) 'children_included': childrenIncluded,
    if (adultsIncluded != null) 'adults_included': adultsIncluded,
    if (childExtraCost != null) 'child_extra_cost': childExtraCost,
    if (adultExtraCost != null) 'adult_extra_cost': adultExtraCost,
    if (capacityMax != null) 'capacity_max': capacityMax,
    if (extraHalfHourCost != null) 'extra_half_hour_cost': extraHalfHourCost,
    if (taxCode != null) 'tax_code': taxCode,
    if (includes != null) 'includes': includes,
    if (restrictions != null) 'restrictions': restrictions,
    if (includedConsumables != null) 'included_consumables': includedConsumables!.map((e) => e.toJson()).toList(growable: false),
  };
}

/// `POST /party-packages/{id}/quote`'s response — the ONE source of truth
/// for a quoted breakdown (Cotizador, recovery doc Capability 6). Never
/// recomputed client-side; every field is exactly what the backend
/// returned.
class PosPartyQuote {
  const PosPartyQuote({
    required this.packageId,
    required this.currencyCode,
    required this.base,
    required this.childrenExtra,
    required this.adultsExtra,
    required this.timeExtra,
    required this.subtotal,
    required this.discountTotal,
    required this.taxTotal,
    required this.total,
  });

  factory PosPartyQuote.fromJson(Map<String, Object?> json) => PosPartyQuote(
    packageId: json['package_id']! as String,
    currencyCode: json['currency_code']! as String,
    base: json['base']! as String,
    childrenExtra: json['children_extra']! as String,
    adultsExtra: json['adults_extra']! as String,
    timeExtra: json['time_extra']! as String,
    // Fall back to `total` for a stale/cached response shape that
    // predates TASK 16.19's tax breakdown — never a hard crash.
    subtotal: json['subtotal'] as String? ?? json['total']! as String,
    discountTotal: json['discount_total'] as String? ?? '0.0000',
    taxTotal: json['tax_total'] as String? ?? '0.0000',
    total: json['total']! as String,
  );

  final String packageId;
  final String currencyCode;
  final String base;
  final String childrenExtra;
  final String adultsExtra;
  final String timeExtra;

  /// package + extras, before tax (TASK 16.19).
  final String subtotal;
  final String discountTotal;
  final String taxTotal;

  /// subtotal − discountTotal + taxTotal — the grand total.
  final String total;
}

/// A `party_reservations` row (`reservationHttp` in
/// `party-reservations.routes.ts`) — returned identically by create,
/// list, and update (the detail endpoint wraps this plus snacks/socks/
/// summaries — see [PosPartyReservationDetail]).
class PosPartyReservation {
  const PosPartyReservation({
    required this.id,
    required this.branchId,
    required this.reservationNumber,
    required this.customerId,
    required this.customerDisplayName,
    required this.customerPhone,
    required this.celebrantName,
    required this.celebrantAge,
    required this.roomId,
    required this.packageId,
    required this.roomNameSnapshot,
    required this.packageNameSnapshot,
    required this.eventDate,
    required this.startTime,
    required this.endTime,
    required this.childrenCount,
    required this.adultsCount,
    required this.sellerUserId,
    required this.status,
    required this.accountStatus,
    required this.subtotalAmount,
    required this.discountTotal,
    required this.taxTotal,
    required this.couponId,
    required this.couponCodeSnapshot,
    required this.quotedTotal,
    required this.currencyCode,
    required this.notes,
    required this.cancelledAt,
    required this.cancelledBy,
    required this.cancellationReason,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
  });

  factory PosPartyReservation.fromJson(Map<String, Object?> json) => PosPartyReservation(
    id: json['id']! as String,
    branchId: json['branch_id']! as String,
    reservationNumber: json['reservation_number']! as String,
    customerId: json['customer_id'] as String?,
    customerDisplayName: json['customer_display_name'] as String?,
    customerPhone: json['customer_phone'] as String?,
    celebrantName: json['celebrant_name'] as String?,
    celebrantAge: json['celebrant_age'] as int?,
    roomId: json['room_id']! as String,
    packageId: json['package_id']! as String,
    roomNameSnapshot: json['room_name_snapshot'] as String?,
    packageNameSnapshot: json['package_name_snapshot'] as String?,
    eventDate: json['event_date']! as String,
    startTime: json['start_time']! as String,
    endTime: json['end_time']! as String,
    childrenCount: json['children_count']! as int,
    adultsCount: json['adults_count'] as int? ?? 0,
    sellerUserId: json['seller_user_id'] as String?,
    status: json['status']! as String,
    accountStatus: json['account_status']! as String,
    subtotalAmount: json['subtotal_amount'] as String?,
    discountTotal: json['discount_total'] as String? ?? '0.0000',
    taxTotal: json['tax_total'] as String? ?? '0.0000',
    couponId: json['coupon_id'] as String?,
    couponCodeSnapshot: json['coupon_code_snapshot'] as String?,
    quotedTotal: json['quoted_total']! as String,
    currencyCode: json['currency_code']! as String,
    notes: json['notes'] as String?,
    cancelledAt: json['cancelled_at'] == null ? null : DateTime.parse(json['cancelled_at']! as String),
    cancelledBy: json['cancelled_by'] as String?,
    cancellationReason: json['cancellation_reason'] as String?,
    version: json['version']! as int,
    createdAt: DateTime.parse(json['created_at']! as String),
    updatedAt: DateTime.parse(json['updated_at']! as String),
  );

  final String id;
  final String branchId;
  final String reservationNumber;
  final String? customerId;
  final String? customerDisplayName;
  final String? customerPhone;
  final String? celebrantName;
  final int? celebrantAge;
  final String roomId;
  final String packageId;

  /// The room/package NAME as it was at booking time (TASK 16.19) — the
  /// display name to use everywhere in the UI, never a live room/package
  /// lookup, so a later rename never rewrites this reservation's own
  /// history. `null` only for a reservation booked before this task
  /// shipped (no snapshot exists yet) — callers should fall back to a
  /// live room/package name lookup in that case only.
  final String? roomNameSnapshot;
  final String? packageNameSnapshot;

  /// `YYYY-MM-DD`.
  final String eventDate;
  final String startTime;
  final String endTime;
  final int childrenCount;
  final int adultsCount;
  final String? sellerUserId;

  /// `held` | `pending_deposit` | `confirmed` | `completed` | `cancelled`.
  final String status;

  /// `open` | `closed`.
  final String accountStatus;

  /// package + extras, before tax (TASK 16.19) — `null` only for a
  /// reservation booked before this task shipped.
  final String? subtotalAmount;
  final String discountTotal;
  final String taxTotal;

  /// TASK 16.20 (Part L1) — the one coupon applied to this reservation, if
  /// any. Both null together (no coupon) or both set (a real, backend-
  /// validated coupon) — never independently.
  final String? couponId;
  final String? couponCodeSnapshot;

  /// The grand total the customer owes (subtotal − discount + tax).
  final String quotedTotal;
  final String currencyCode;
  final String? notes;
  final DateTime? cancelledAt;
  final String? cancelledBy;
  final String? cancellationReason;
  final int version;
  final DateTime createdAt;
  final DateTime updatedAt;
}

class PosPartyReservationInput {
  const PosPartyReservationInput({
    this.branchId,
    this.customerId,
    this.celebrantName,
    this.celebrantAge,
    this.roomId,
    this.packageId,
    this.eventDate,
    this.startTime,
    this.endTime,
    this.childrenCount,
    this.adultsCount,
    this.extraHalfHours,
    this.sellerUserId,
    this.notes,
  });

  final String? branchId;
  final String? customerId;
  final String? celebrantName;
  final int? celebrantAge;
  final String? roomId;
  final String? packageId;
  final String? eventDate;
  final String? startTime;
  final String? endTime;
  final int? childrenCount;
  final int? adultsCount;
  final int? extraHalfHours;
  final String? sellerUserId;
  final String? notes;

  Map<String, Object?> toJson() => {
    if (branchId != null) 'branch_id': branchId,
    if (customerId != null) 'customer_id': customerId,
    if (celebrantName != null) 'celebrant_name': celebrantName,
    if (celebrantAge != null) 'celebrant_age': celebrantAge,
    if (roomId != null) 'room_id': roomId,
    if (packageId != null) 'package_id': packageId,
    if (eventDate != null) 'event_date': eventDate,
    if (startTime != null) 'start_time': startTime,
    if (endTime != null) 'end_time': endTime,
    if (childrenCount != null) 'children_count': childrenCount,
    if (adultsCount != null) 'adults_count': adultsCount,
    if (extraHalfHours != null) 'extra_half_hours': extraHalfHours,
    if (sellerUserId != null) 'seller_user_id': sellerUserId,
    if (notes != null) 'notes': notes,
  };
}

/// TASK 16.20 (Part G) — the 3 event-day states a consumable line can be
/// in, human-readable, never a raw `stock_deducted` code shown to staff.
enum PosPartyConsumableDisplayStatus { included, delivered, pending, notTracked }

class PosPartySnack {
  const PosPartySnack({
    required this.id,
    required this.reservationId,
    required this.productId,
    required this.nameSnapshot,
    required this.unitPriceSnapshot,
    required this.quantity,
    required this.lineTotal,
    required this.taxTotal,
    required this.productVariantId,
    required this.stockDeducted,
    required this.stockDeductedAt,
    required this.issuedQuantity,
    required this.includedInPackage,
    required this.createdAt,
  });

  factory PosPartySnack.fromJson(Map<String, Object?> json) => PosPartySnack(
    id: json['id']! as String,
    reservationId: json['reservation_id']! as String,
    productId: json['product_id'] as String?,
    nameSnapshot: json['name_snapshot']! as String,
    unitPriceSnapshot: json['unit_price_snapshot']! as String,
    quantity: json['quantity']! as String,
    lineTotal: json['line_total']! as String,
    taxTotal: json['tax_total'] as String? ?? '0.0000',
    productVariantId: json['product_variant_id'] as String?,
    stockDeducted: json['stock_deducted'] as String? ?? 'not_applicable',
    stockDeductedAt: json['stock_deducted_at'] == null ? null : DateTime.parse(json['stock_deducted_at']! as String),
    issuedQuantity: json['issued_quantity'] as String?,
    includedInPackage: json['included_in_package'] as bool? ?? false,
    createdAt: DateTime.parse(json['created_at']! as String),
  );

  final String id;
  final String reservationId;
  final String? productId;
  final String nameSnapshot;
  final String unitPriceSnapshot;
  final String quantity;

  /// Tax-inclusive (subtotal + [taxTotal]) — TASK 16.19.
  final String lineTotal;
  final String taxTotal;

  /// TASK 16.20 — real inventory-tracked variant this snack resolves to,
  /// `null` when it doesn't track real stock.
  final String? productVariantId;

  /// `pending` | `deducted` | `not_applicable`.
  final String stockDeducted;
  final DateTime? stockDeductedAt;

  /// The ACTUAL amount issued (frozen at deduction time), independent of
  /// the planned [quantity] — `null` until issued.
  final String? issuedQuantity;

  /// `true` only for a line `createReservation` auto-planned from the
  /// package's own `included_consumables`.
  final bool includedInPackage;
  final DateTime createdAt;

  bool get isDeducted => stockDeducted == 'deducted';
  bool get canDeduct => stockDeducted == 'pending' && productVariantId != null;

  PosPartyConsumableDisplayStatus get displayStatus {
    if (stockDeducted == 'not_applicable') return PosPartyConsumableDisplayStatus.notTracked;
    if (isDeducted) return PosPartyConsumableDisplayStatus.delivered;
    return includedInPackage ? PosPartyConsumableDisplayStatus.included : PosPartyConsumableDisplayStatus.pending;
  }
}

class PosPartySnackInput {
  const PosPartySnackInput({
    this.productId,
    this.nameSnapshot,
    this.unitPriceSnapshot,
    required this.quantity,
  });
  final String? productId;
  final String? nameSnapshot;
  final String? unitPriceSnapshot;
  final String quantity;

  Map<String, Object?> toJson() => {
    if (productId != null) 'product_id': productId,
    if (nameSnapshot != null) 'name_snapshot': nameSnapshot,
    if (unitPriceSnapshot != null) 'unit_price_snapshot': unitPriceSnapshot,
    'quantity': quantity,
  };
}

class PosPartySock {
  const PosPartySock({
    required this.id,
    required this.reservationId,
    required this.size,
    required this.quantity,
    required this.productVariantId,
    required this.stockDeducted,
    required this.stockDeductedAt,
    required this.issuedQuantity,
    required this.includedInPackage,
    required this.createdAt,
  });

  factory PosPartySock.fromJson(Map<String, Object?> json) => PosPartySock(
    id: json['id']! as String,
    reservationId: json['reservation_id']! as String,
    size: json['size']! as String,
    quantity: json['quantity']! as int,
    productVariantId: json['product_variant_id'] as String?,
    stockDeducted: json['stock_deducted']! as String,
    stockDeductedAt: json['stock_deducted_at'] == null ? null : DateTime.parse(json['stock_deducted_at']! as String),
    issuedQuantity: json['issued_quantity'] as int?,
    includedInPackage: json['included_in_package'] as bool? ?? false,
    createdAt: DateTime.parse(json['created_at']! as String),
  );

  final String id;
  final String reservationId;
  final String size;
  final int quantity;
  final String? productVariantId;

  /// `pending` | `deducted` | `not_applicable`.
  final String stockDeducted;
  final DateTime? stockDeductedAt;

  /// The ACTUAL amount issued (frozen at deduction time), independent of
  /// the planned [quantity] — `null` until issued.
  final int? issuedQuantity;

  /// `true` only for a line `createReservation` auto-planned from the
  /// package's own `included_consumables`.
  final bool includedInPackage;
  final DateTime createdAt;

  bool get isDeducted => stockDeducted == 'deducted';
  bool get canDeduct => stockDeducted == 'pending' && productVariantId != null;

  PosPartyConsumableDisplayStatus get displayStatus {
    if (stockDeducted == 'not_applicable') return PosPartyConsumableDisplayStatus.notTracked;
    if (isDeducted) return PosPartyConsumableDisplayStatus.delivered;
    return includedInPackage ? PosPartyConsumableDisplayStatus.included : PosPartyConsumableDisplayStatus.pending;
  }
}

class PosPartySockInput {
  const PosPartySockInput({required this.size, required this.quantity, this.productVariantId});
  final String size;
  final int quantity;
  final String? productVariantId;

  Map<String, Object?> toJson() => {
    'size': size,
    'quantity': quantity,
    if (productVariantId != null) 'product_variant_id': productVariantId,
  };
}

class PosPartyPayment {
  const PosPartyPayment({
    required this.id,
    required this.branchId,
    required this.reservationId,
    required this.cashMovementId,
    required this.purpose,
    required this.amount,
    required this.createdBy,
    required this.createdAt,
  });

  factory PosPartyPayment.fromJson(Map<String, Object?> json) => PosPartyPayment(
    id: json['id']! as String,
    branchId: json['branch_id']! as String,
    reservationId: json['reservation_id']! as String,
    cashMovementId: json['cash_movement_id']! as String,
    purpose: json['purpose']! as String,
    amount: json['amount']! as String,
    createdBy: json['created_by']! as String,
    createdAt: DateTime.parse(json['created_at']! as String),
  );

  final String id;
  final String branchId;
  final String reservationId;
  final String cashMovementId;

  /// `deposit` | `balance` | `additional`.
  final String purpose;
  final String amount;
  final String createdBy;
  final DateTime createdAt;
}

class PosPartyBalance {
  const PosPartyBalance({
    required this.subtotalAmount,
    required this.discountTotal,
    required this.taxTotal,
    required this.quotedTotal,
    required this.totalPaid,
    required this.outstandingBalance,
  });

  factory PosPartyBalance.fromJson(Map<String, Object?> json) => PosPartyBalance(
    subtotalAmount: json['subtotal_amount'] as String?,
    discountTotal: json['discount_total'] as String? ?? '0.0000',
    taxTotal: json['tax_total'] as String? ?? '0.0000',
    quotedTotal: json['quoted_total']! as String,
    totalPaid: json['total_paid']! as String,
    outstandingBalance: json['outstanding_balance']! as String,
  );

  final String? subtotalAmount;
  final String discountTotal;
  final String taxTotal;
  final String quotedTotal;
  final String totalPaid;
  final String outstandingBalance;
}

/// `GET /party-reservations/{id}`'s full response — [reservation]'s own
/// fields plus the snacks/socks lines and the two roll-up summaries.
class PosPartyReservationDetail {
  const PosPartyReservationDetail({
    required this.reservation,
    required this.snacks,
    required this.socks,
    required this.paymentsTotalPaid,
    required this.paymentsCount,
    required this.documentsCount,
    required this.documentsLastGeneratedAt,
    required this.documentsLastDocumentType,
  });

  factory PosPartyReservationDetail.fromJson(Map<String, Object?> json) {
    final snacksRaw = json['snacks'];
    final socksRaw = json['socks'];
    final paymentsSummary = json['payments_summary'] as Map<String, Object?>?;
    final documentsSummary = json['documents_summary'] as Map<String, Object?>?;
    return PosPartyReservationDetail(
      reservation: PosPartyReservation.fromJson(json),
      snacks: snacksRaw is List<Object?>
          ? snacksRaw.whereType<Map<String, Object?>>().map(PosPartySnack.fromJson).toList(growable: false)
          : const [],
      socks: socksRaw is List<Object?>
          ? socksRaw.whereType<Map<String, Object?>>().map(PosPartySock.fromJson).toList(growable: false)
          : const [],
      paymentsTotalPaid: paymentsSummary?['total_paid'] as String? ?? '0.00',
      paymentsCount: paymentsSummary?['count'] as int? ?? 0,
      documentsCount: documentsSummary?['count'] as int? ?? 0,
      documentsLastGeneratedAt: documentsSummary?['last_generated_at'] as String?,
      documentsLastDocumentType: documentsSummary?['last_document_type'] as String?,
    );
  }

  final PosPartyReservation reservation;
  final List<PosPartySnack> snacks;
  final List<PosPartySock> socks;
  final String paymentsTotalPaid;
  final int paymentsCount;
  final int documentsCount;
  final String? documentsLastGeneratedAt;
  final String? documentsLastDocumentType;
}

/// `POST /party-reservations/{id}/cancellations`'s response — the
/// reservation plus whether it had prior payments (recovery doc
/// Capability 8: cancellation never auto-refunds; this app must show that
/// honestly rather than hide it).
class PosPartyCancellationResult {
  const PosPartyCancellationResult({
    required this.reservation,
    required this.hasPriorPayments,
    required this.totalPaid,
  });

  factory PosPartyCancellationResult.fromJson(Map<String, Object?> json) => PosPartyCancellationResult(
    reservation: PosPartyReservation.fromJson(json),
    hasPriorPayments: json['has_prior_payments'] == true,
    totalPaid: json['total_paid'] as String? ?? '0.00',
  );

  final PosPartyReservation reservation;
  final bool hasPriorPayments;
  final String totalPaid;
}

/// One `GET /party-reservations/calendar` row — a deliberately reduced
/// shape (never the full reservation), matching the backend's own
/// calendar projection exactly.
class PosPartyCalendarEntry {
  const PosPartyCalendarEntry({
    required this.id,
    required this.roomId,
    required this.eventDate,
    required this.startTime,
    required this.endTime,
    required this.status,
    required this.celebrantName,
    required this.customerDisplayName,
    required this.sellerUserId,
  });

  factory PosPartyCalendarEntry.fromJson(Map<String, Object?> json) => PosPartyCalendarEntry(
    id: json['id']! as String,
    roomId: json['room_id']! as String,
    eventDate: json['event_date']! as String,
    startTime: json['start_time']! as String,
    endTime: json['end_time']! as String,
    status: json['status']! as String,
    celebrantName: json['celebrant_name'] as String?,
    customerDisplayName: json['customer_display_name'] as String?,
    sellerUserId: json['seller_user_id'] as String?,
  );

  final String id;
  final String roomId;
  final String eventDate;
  final String startTime;
  final String endTime;
  final String status;
  final String? celebrantName;
  final String? customerDisplayName;
  final String? sellerUserId;
}

/// A generic cursor page — matches every list endpoint in this domain
/// (rooms/packages/reservations) exactly.
class PosPartyPage<T> {
  const PosPartyPage({required this.items, required this.nextCursor});
  final List<T> items;
  final String? nextCursor;
}
