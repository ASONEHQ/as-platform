/// TASK 14.3 (Wave 1, Part C): the Flutter side of `purchasing.routes.ts`
/// — "Compra Directa" (direct purchase / quick restock). See that file's
/// own doc comment: the ONE purchasing-domain feature the legacy parity
/// audit confirmed was genuinely end-to-end — a manager records newly-
/// arrived, already-paid-for stock immediately, with a real inventory
/// movement backing it, never a formal Purchase Order workflow.
library;

import '../../core/networking/api_client.dart';

/// The linked inventory movement's own identity/status, plus the current
/// on-hand balance for this exact variant/branch — a simple point-in-time
/// lookup, never a fabricated confirmation (see
/// `purchasing.types.ts`'s own `DirectPurchaseMovementSummary`).
class PosDirectPurchaseMovement {
  const PosDirectPurchaseMovement({
    required this.movementId,
    required this.movementNumber,
    required this.status,
    required this.postedAt,
    required this.currentQuantityOnHand,
  });

  factory PosDirectPurchaseMovement.fromJson(Map<String, Object?> json) => PosDirectPurchaseMovement(
    movementId: json['id']! as String,
    movementNumber: json['movement_number']! as String,
    status: json['status']! as String,
    postedAt: json['posted_at'] == null ? null : DateTime.parse(json['posted_at']! as String),
    currentQuantityOnHand: json['current_quantity_on_hand'] as String?,
  );

  final String movementId;
  final String movementNumber;
  final String status;
  final DateTime? postedAt;
  final String? currentQuantityOnHand;
}

/// A `direct_purchases` row — exactly what `purchasing.routes.ts`'s own
/// `directPurchaseHttp` returns; nothing recomputed or guessed
/// client-side. [movement] is only ever populated for a create/detail
/// response (never the plain list), mirroring `PosSaleSummary`'s own
/// "list row is a summary" precedent.
class PosDirectPurchase {
  const PosDirectPurchase({
    required this.id,
    required this.branchId,
    required this.supplierName,
    required this.supplierId,
    required this.productVariantId,
    required this.quantity,
    required this.unitCost,
    required this.currencyCode,
    required this.totalCost,
    required this.purchaseDate,
    required this.notes,
    required this.inventoryMovementId,
    required this.createdBy,
    required this.createdAt,
    this.movement,
  });

  factory PosDirectPurchase.fromJson(Map<String, Object?> json) {
    final movement = json['inventory_movement'];
    return PosDirectPurchase(
      id: json['id']! as String,
      branchId: json['branch_id']! as String,
      supplierName: json['supplier_name'] as String?,
      supplierId: json['supplier_id'] as String?,
      productVariantId: json['product_variant_id']! as String,
      quantity: json['quantity']! as String,
      unitCost: json['unit_cost']! as String,
      currencyCode: json['currency_code']! as String,
      totalCost: json['total_cost']! as String,
      purchaseDate: json['purchase_date']! as String,
      notes: json['notes'] as String?,
      inventoryMovementId: json['inventory_movement_id']! as String,
      createdBy: json['created_by']! as String,
      createdAt: DateTime.parse(json['created_at']! as String),
      movement: movement is Map<String, Object?> ? PosDirectPurchaseMovement.fromJson(movement) : null,
    );
  }

  final String id;
  final String branchId;
  final String? supplierName;
  // TASK 14.4 (Wave 2, Part C.2): an optional real link to a `suppliers`
  // row — see `purchasing.types.ts`'s own `DirectPurchaseRow.supplierId`
  // doc comment. `supplierName` stays the frozen, historical snapshot at
  // purchase time even when this is set.
  final String? supplierId;
  final String productVariantId;
  final String quantity;
  final String unitCost;
  final String currencyCode;
  final String totalCost;
  final String purchaseDate;
  final String? notes;
  final String inventoryMovementId;
  final String createdBy;
  final DateTime createdAt;
  final PosDirectPurchaseMovement? movement;
}

class PosDirectPurchasePage {
  const PosDirectPurchasePage({required this.items, required this.nextCursor});
  final List<PosDirectPurchase> items;
  final String? nextCursor;
}

/// Every filter `GET /api/v1/direct-purchases` supports — see
/// `purchasing.routes.ts`'s own querystring schema.
class PosDirectPurchaseListFilter {
  const PosDirectPurchaseListFilter({
    this.branchId,
    this.productVariantId,
    this.supplierId,
    this.purchaseDateFrom,
    this.purchaseDateTo,
  });
  final String? branchId;
  final String? productVariantId;
  final String? supplierId;
  final String? purchaseDateFrom;
  final String? purchaseDateTo;
}

abstract interface class PosPurchasingGateway {
  /// `POST /api/v1/direct-purchases` — records newly-arrived stock and its
  /// real cost; the backend creates the backing inventory movement
  /// itself (never fabricated client-side).
  Future<PosDirectPurchase> createDirectPurchase({
    required String branchId,
    String? supplierName,
    // TASK 14.4 (Wave 2, Part C.2): when provided, must resolve to a
    // real, active, same-company supplier — the backend then derives
    // `supplierName` from that supplier's current real name at write
    // time and ignores any [supplierName] passed above (see
    // `CreateDirectPurchaseInput.supplierId`'s own doc comment).
    // Nullable/optional — a purchase may still have no real supplier
    // linked, unchanged from before this wave.
    String? supplierId,
    required String productVariantId,
    required String quantity,
    required String unitCost,
    required String currencyCode,
    required String purchaseDate,
    String? notes,
  });

  /// `GET /api/v1/direct-purchases/{id}` — full detail, including the
  /// linked movement's real current on-hand balance.
  Future<PosDirectPurchase> directPurchase(String id);

  /// `GET /api/v1/direct-purchases` — paginated, filterable history.
  Future<PosDirectPurchasePage> listDirectPurchases({
    PosDirectPurchaseListFilter filter = const PosDirectPurchaseListFilter(),
    String? cursor,
    int limit = 50,
  });

  /// TASK 14.3 (Wave 4): `POST /api/v1/direct-purchases/{id}/reverse`
  /// (`inventory.reverse`) — reverses this direct purchase's own backing
  /// inventory movement; on success the returned purchase's own
  /// `movement.status` is `'reversed'`. [reason] is required — mirrors
  /// this app's own established free-text reason convention for every
  /// reversal/cancel action (see `pos_inventory_admin_screen.dart`'s own
  /// `_ReasonDialog` doc comment).
  Future<PosDirectPurchase> reverseDirectPurchase(String id, {required String reason});
}

class ApiPosPurchasingGateway implements PosPurchasingGateway {
  const ApiPosPurchasingGateway(this._client, {this.createIdempotencyKey = _defaultIdempotencyKey});

  final ApiClient _client;
  final String Function() createIdempotencyKey;

  static String _defaultIdempotencyKey() =>
      'one-direct-purchase-${DateTime.now().toUtc().microsecondsSinceEpoch}';

  @override
  Future<PosDirectPurchase> createDirectPurchase({
    required String branchId,
    String? supplierName,
    String? supplierId,
    required String productVariantId,
    required String quantity,
    required String unitCost,
    required String currencyCode,
    required String purchaseDate,
    String? notes,
  }) async {
    final envelope = await _client.postJson(
      '/api/v1/direct-purchases',
      idempotencyKey: createIdempotencyKey(),
      body: {
        'branch_id': branchId,
        if (supplierName != null && supplierName.isNotEmpty) 'supplier_name': supplierName,
        if (supplierId != null && supplierId.isNotEmpty) 'supplier_id': supplierId,
        'product_variant_id': productVariantId,
        'quantity': quantity,
        'unit_cost': unitCost,
        'currency_code': currencyCode,
        'purchase_date': purchaseDate,
        if (notes != null && notes.isNotEmpty) 'notes': notes,
      },
    );
    return _decode(envelope);
  }

  @override
  Future<PosDirectPurchase> directPurchase(String id) async {
    final envelope = await _client.getJson('/api/v1/direct-purchases/$id');
    return _decode(envelope);
  }

  @override
  Future<PosDirectPurchasePage> listDirectPurchases({
    PosDirectPurchaseListFilter filter = const PosDirectPurchaseListFilter(),
    String? cursor,
    int limit = 50,
  }) async {
    final query = <String, String>{
      'limit': '$limit',
      if (cursor != null) 'cursor': cursor,
      if (filter.branchId != null) 'branch_id': filter.branchId!,
      if (filter.productVariantId != null) 'product_variant_id': filter.productVariantId!,
      if (filter.supplierId != null) 'supplier_id': filter.supplierId!,
      if (filter.purchaseDateFrom != null) 'purchase_date_from': filter.purchaseDateFrom!,
      if (filter.purchaseDateTo != null) 'purchase_date_to': filter.purchaseDateTo!,
    };
    final path = Uri(path: '/api/v1/direct-purchases', queryParameters: query).toString();
    final envelope = await _client.getJson(path);
    final data = envelope['data'];
    if (data is! List<Object?>) {
      throw const FormatException('Missing direct-purchases list data.');
    }
    final meta = envelope['meta'];
    final page = meta is Map<String, Object?> ? meta['page'] : null;
    final nextCursor = page is Map<String, Object?> ? page['next_cursor'] as String? : null;
    return PosDirectPurchasePage(
      items: data.whereType<Map<String, Object?>>().map(PosDirectPurchase.fromJson).toList(growable: false),
      nextCursor: nextCursor,
    );
  }

  @override
  Future<PosDirectPurchase> reverseDirectPurchase(String id, {required String reason}) async {
    final envelope = await _client.postJson(
      '/api/v1/direct-purchases/$id/reverse',
      idempotencyKey: createIdempotencyKey(),
      body: {'reason': reason},
    );
    return _decode(envelope);
  }

  PosDirectPurchase _decode(Map<String, Object?> envelope) {
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing direct-purchase data.');
    }
    return PosDirectPurchase.fromJson(data);
  }
}

class EmptyPosPurchasingGateway implements PosPurchasingGateway {
  const EmptyPosPurchasingGateway();

  @override
  Future<PosDirectPurchase> createDirectPurchase({
    required String branchId,
    String? supplierName,
    String? supplierId,
    required String productVariantId,
    required String quantity,
    required String unitCost,
    required String currencyCode,
    required String purchaseDate,
    String? notes,
  }) => Future.error(StateError('No purchasing gateway is configured.'));

  @override
  Future<PosDirectPurchase> directPurchase(String id) =>
      Future.error(StateError('No purchasing gateway is configured.'));

  @override
  Future<PosDirectPurchasePage> listDirectPurchases({
    PosDirectPurchaseListFilter filter = const PosDirectPurchaseListFilter(),
    String? cursor,
    int limit = 50,
  }) => Future.error(StateError('No purchasing gateway is configured.'));

  @override
  Future<PosDirectPurchase> reverseDirectPurchase(String id, {required String reason}) =>
      Future.error(StateError('No purchasing gateway is configured.'));
}
