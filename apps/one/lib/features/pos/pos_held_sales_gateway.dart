/// TASK 14.3 (Wave 1, Part B.1): the Flutter side of `held-sales.routes.ts`
/// — suspend ("Suspender venta"), list ("Ventas suspendidas"), resume
/// ("Restaurar"), the optional `link-sale` handshake, and discard
/// ("Descartar") a held-sale cart. See that file's own doc comments for
/// the exact contract this mirrors: a held cart is a real, server-
/// persisted, UNPRICED snapshot of `{product_id, quantity}` pairs — never
/// a partial `sales` row — so resuming always re-prices fresh through the
/// real catalog, and this gateway never itself creates a sale.
library;

import '../../core/networking/api_client.dart';

/// One held line — mirrors `SaleLine.productId`/`SaleLine.quantityForApi`
/// exactly (never a variant id or a price; the backend re-prices fresh on
/// resume — see `held-sales.types.ts`'s own `HeldSaleCartItem`).
class PosHeldSaleCartItem {
  const PosHeldSaleCartItem({required this.productId, required this.quantity});

  factory PosHeldSaleCartItem.fromJson(Map<String, Object?> json) => PosHeldSaleCartItem(
    productId: json['product_id']! as String,
    quantity: json['quantity']! as String,
  );

  final String productId;
  final String quantity;
}

/// A `held_sale_carts` row — `heldSaleCartStatuses` in
/// `held-sales.types.ts`: a real 4-state machine, `held` -> `resuming` ->
/// `resumed`, plus `discarded` (from `held` or `resuming`) and an explicit
/// `resuming -> held` release (TASK 14.3A, Wave 1 hardening) — never the
/// stale 3-state `held`|`resumed`|`discarded` this file's comment used to
/// claim.
class PosHeldSaleCart {
  const PosHeldSaleCart({
    required this.id,
    required this.branchId,
    required this.cashRegisterId,
    required this.customerId,
    required this.label,
    required this.items,
    required this.status,
    required this.createdBy,
    required this.claimedAt,
    required this.claimedBy,
    required this.resumedAt,
    required this.resumedBy,
    required this.resumedSaleId,
    required this.discardedAt,
    required this.discardedBy,
    required this.createdAt,
  });

  factory PosHeldSaleCart.fromJson(Map<String, Object?> json) {
    final rawItems = json['items'];
    return PosHeldSaleCart(
      id: json['id']! as String,
      branchId: json['branch_id']! as String,
      cashRegisterId: json['cash_register_id'] as String?,
      customerId: json['customer_id'] as String?,
      label: json['label'] as String?,
      items: rawItems is List<Object?>
          ? rawItems
                .whereType<Map<String, Object?>>()
                .map(PosHeldSaleCartItem.fromJson)
                .toList(growable: false)
          : const <PosHeldSaleCartItem>[],
      status: json['status']! as String,
      createdBy: json['created_by']! as String,
      // Set once, at `held -> resuming` — a historical trace of the most
      // recent claim attempt, deliberately NOT cleared by a later release
      // back to `held` (mirrors `held-sales.types.ts`'s own doc comment on
      // `HeldSaleCartRow.claimedAt`). Only `status` decides whether a claim
      // is currently in effect.
      claimedAt: json['claimed_at'] == null ? null : DateTime.parse(json['claimed_at']! as String),
      claimedBy: json['claimed_by'] as String?,
      resumedAt: json['resumed_at'] == null ? null : DateTime.parse(json['resumed_at']! as String),
      resumedBy: json['resumed_by'] as String?,
      // `null` means "resumed, but never (yet, or ever) linked to a real
      // sale" — see `held-sales.types.ts`'s own doc comment on
      // `HeldSaleCartRow.resumedSaleId`.
      resumedSaleId: json['resumed_sale_id'] as String?,
      discardedAt: json['discarded_at'] == null ? null : DateTime.parse(json['discarded_at']! as String),
      discardedBy: json['discarded_by'] as String?,
      createdAt: DateTime.parse(json['created_at']! as String),
    );
  }

  final String id;
  final String branchId;
  final String? cashRegisterId;
  final String? customerId;
  final String? label;
  final List<PosHeldSaleCartItem> items;
  final String status;
  final String createdBy;
  final DateTime? claimedAt;
  final String? claimedBy;
  final DateTime? resumedAt;
  final String? resumedBy;
  final String? resumedSaleId;
  final DateTime? discardedAt;
  final String? discardedBy;
  final DateTime createdAt;

  bool get isHeld => status == 'held';
  bool get isResuming => status == 'resuming';
}

class PosHeldSaleCartPage {
  const PosHeldSaleCartPage({required this.items, required this.nextCursor});
  final List<PosHeldSaleCart> items;
  final String? nextCursor;
}

/// Every filter `GET /api/v1/held-sale-carts` supports — see
/// `held-sales.routes.ts`'s own querystring schema.
class PosHeldSaleCartListFilter {
  const PosHeldSaleCartListFilter({this.branchId, this.status, this.cashRegisterId});
  final String? branchId;
  final String? status;
  final String? cashRegisterId;
}

/// One line to suspend — the current ticket's own real product/quantity
/// pairs (`SaleLine.productId`/`SaleLine.quantityForApi`).
class PosHeldSaleCartItemRequest {
  const PosHeldSaleCartItemRequest({required this.productId, required this.quantity});
  final String productId;
  final String quantity;
}

abstract interface class PosHeldSalesGateway {
  /// `POST /api/v1/held-sale-carts` — "Suspender venta": snapshots the
  /// current ticket's real product/quantity pairs server-side.
  Future<PosHeldSaleCart> createCart({
    required String branchId,
    String? cashRegisterId,
    String? customerId,
    String? label,
    required List<PosHeldSaleCartItemRequest> items,
  });

  /// `GET /api/v1/held-sale-carts` — "Ventas suspendidas". The backend's
  /// own querystring schema (`held-sales.routes.ts`) only ever accepts one
  /// `status` value at a time — never an array — so TASK 14.4 (Wave 2,
  /// Part A.2)'s "show `held` AND `resuming`, never silently hide a
  /// claimed cart" requirement is satisfied by the caller issuing two
  /// calls (one per status) and merging, never by inventing a
  /// client-side-only multi-status capability the real API doesn't have.
  Future<PosHeldSaleCartPage> listCarts({
    PosHeldSaleCartListFilter filter = const PosHeldSaleCartListFilter(),
    String? cursor,
    int limit = 50,
  });

  /// `POST /api/v1/held-sale-carts/{id}/resume` — "Restaurar": the real
  /// recovery action. Hands back only the cart's raw
  /// `{product_id, quantity}` items for the caller to re-resolve/re-price
  /// through the normal catalog path — never a fabricated success and
  /// never a stale price/name.
  Future<PosHeldSaleCart> resumeCart(String id);

  /// `POST /api/v1/held-sale-carts/{id}/link-sale` — the optional second
  /// call once the resumed cart's real, paid sale actually exists.
  Future<PosHeldSaleCart> linkSale({required String id, required String saleId});

  /// `POST /api/v1/held-sale-carts/{id}/release` — "Liberar" (TASK 14.3A,
  /// Wave 1 hardening; wired into the UI in Wave 2 Part A.3): the explicit
  /// recovery action for an abandoned claim, `resuming -> held`. The
  /// backend itself additionally requires the actor to be either the
  /// cart's own claimant or hold `sale.cancel` (see
  /// `held-sales.service.ts`'s own `releaseCart` doc comment) — the UI
  /// must gate this honestly, mirroring that exact rule, rather than
  /// surface a raw 403.
  Future<PosHeldSaleCart> releaseCart(String id);

  /// `POST /api/v1/held-sale-carts/{id}/discard` — "Descartar": a real,
  /// slightly destructive action. The backend itself additionally
  /// requires `sale.cancel` to discard someone else's held cart (see
  /// `held-sales.service.ts`'s own `discardCart` doc comment) — the UI
  /// must gate this honestly rather than surface a raw 403.
  Future<PosHeldSaleCart> discardCart({required String id, String? reason});
}

class ApiPosHeldSalesGateway implements PosHeldSalesGateway {
  const ApiPosHeldSalesGateway(this._client, {this.createIdempotencyKey = _defaultIdempotencyKey});

  final ApiClient _client;
  final String Function() createIdempotencyKey;

  static String _defaultIdempotencyKey() =>
      'one-held-sale-${DateTime.now().toUtc().microsecondsSinceEpoch}';

  @override
  Future<PosHeldSaleCart> createCart({
    required String branchId,
    String? cashRegisterId,
    String? customerId,
    String? label,
    required List<PosHeldSaleCartItemRequest> items,
  }) async {
    final envelope = await _client.postJson(
      '/api/v1/held-sale-carts',
      idempotencyKey: createIdempotencyKey(),
      body: {
        'branch_id': branchId,
        if (cashRegisterId != null) 'cash_register_id': cashRegisterId,
        if (customerId != null) 'customer_id': customerId,
        if (label != null && label.isNotEmpty) 'label': label,
        'items': [
          for (final item in items) {'product_id': item.productId, 'quantity': item.quantity},
        ],
      },
    );
    return _decodeCart(envelope);
  }

  @override
  Future<PosHeldSaleCartPage> listCarts({
    PosHeldSaleCartListFilter filter = const PosHeldSaleCartListFilter(),
    String? cursor,
    int limit = 50,
  }) async {
    final query = <String, String>{
      'limit': '$limit',
      if (cursor != null) 'cursor': cursor,
      if (filter.branchId != null) 'branch_id': filter.branchId!,
      if (filter.status != null) 'status': filter.status!,
      if (filter.cashRegisterId != null) 'cash_register_id': filter.cashRegisterId!,
    };
    final path = Uri(path: '/api/v1/held-sale-carts', queryParameters: query).toString();
    final envelope = await _client.getJson(path);
    final data = envelope['data'];
    if (data is! List<Object?>) {
      throw const FormatException('Missing held-sale-carts list data.');
    }
    final meta = envelope['meta'];
    final page = meta is Map<String, Object?> ? meta['page'] : null;
    final nextCursor = page is Map<String, Object?> ? page['next_cursor'] as String? : null;
    return PosHeldSaleCartPage(
      items: data.whereType<Map<String, Object?>>().map(PosHeldSaleCart.fromJson).toList(growable: false),
      nextCursor: nextCursor,
    );
  }

  @override
  Future<PosHeldSaleCart> resumeCart(String id) async {
    final envelope = await _client.postJson(
      '/api/v1/held-sale-carts/$id/resume',
      idempotencyKey: createIdempotencyKey(),
    );
    return _decodeCart(envelope);
  }

  @override
  Future<PosHeldSaleCart> linkSale({required String id, required String saleId}) async {
    final envelope = await _client.postJson(
      '/api/v1/held-sale-carts/$id/link-sale',
      idempotencyKey: createIdempotencyKey(),
      body: {'sale_id': saleId},
    );
    return _decodeCart(envelope);
  }

  @override
  Future<PosHeldSaleCart> releaseCart(String id) async {
    final envelope = await _client.postJson(
      '/api/v1/held-sale-carts/$id/release',
      idempotencyKey: createIdempotencyKey(),
    );
    return _decodeCart(envelope);
  }

  @override
  Future<PosHeldSaleCart> discardCart({required String id, String? reason}) async {
    final envelope = await _client.postJson(
      '/api/v1/held-sale-carts/$id/discard',
      idempotencyKey: createIdempotencyKey(),
      body: {if (reason != null && reason.isNotEmpty) 'reason': reason},
    );
    return _decodeCart(envelope);
  }

  PosHeldSaleCart _decodeCart(Map<String, Object?> envelope) {
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing held-sale-cart data.');
    }
    return PosHeldSaleCart.fromJson(data);
  }
}

class EmptyPosHeldSalesGateway implements PosHeldSalesGateway {
  const EmptyPosHeldSalesGateway();

  @override
  Future<PosHeldSaleCart> createCart({
    required String branchId,
    String? cashRegisterId,
    String? customerId,
    String? label,
    required List<PosHeldSaleCartItemRequest> items,
  }) => Future.error(StateError('No held-sales gateway is configured.'));

  @override
  Future<PosHeldSaleCartPage> listCarts({
    PosHeldSaleCartListFilter filter = const PosHeldSaleCartListFilter(),
    String? cursor,
    int limit = 50,
  }) => Future.error(StateError('No held-sales gateway is configured.'));

  @override
  Future<PosHeldSaleCart> resumeCart(String id) =>
      Future.error(StateError('No held-sales gateway is configured.'));

  @override
  Future<PosHeldSaleCart> linkSale({required String id, required String saleId}) =>
      Future.error(StateError('No held-sales gateway is configured.'));

  @override
  Future<PosHeldSaleCart> releaseCart(String id) =>
      Future.error(StateError('No held-sales gateway is configured.'));

  @override
  Future<PosHeldSaleCart> discardCart({required String id, String? reason}) =>
      Future.error(StateError('No held-sales gateway is configured.'));
}
