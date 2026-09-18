/// TASK 14.3 (Wave 4): the Flutter side of the (parallel-built)
/// `purchase-orders.routes.ts` — formal Purchase Orders ("Órdenes de
/// compra"): draft -> submitted -> (partially_)received -> cancelled,
/// each line's own ordered/received quantity, and the linked inventory
/// movement once received. Kept as its OWN sibling file rather than folded
/// into `pos_purchasing_gateway.dart` — mirrors how this codebase already
/// splits `pos_suppliers_gateway.dart` out from
/// `pos_purchasing_gateway.dart` rather than growing one gateway file
/// unwieldy; "Compra Directa"/`PosPurchasingGateway` stays the one
/// genuinely simple, real, end-to-end quick-restock path that file's own
/// doc comment describes, and this is the separate, more formal workflow
/// alongside it.
///
/// Styles every model/gateway convention directly off
/// `pos_purchasing_gateway.dart` — HTTP call pattern, idempotency-key
/// generation, error mapping, pagination shape — so the two files read as
/// one system.
///
/// `GET /purchase-orders` returns light summary rows (no `lines` array);
/// `GET /purchase-orders/{id}` and every mutating endpoint's response
/// return the full order including `lines`. Rather than a second,
/// divergent "summary" type, [PosPurchaseOrder.lines] is simply nullable
/// (`null` only for a plain list row) — mirrors `PosDirectPurchase.movement`'s
/// own exact "list row is a summary" precedent in
/// `pos_purchasing_gateway.dart`.
library;

import '../../core/networking/api_client.dart';

/// The nested inventory-movement summary a `receive` response carries once
/// any quantity was actually received — the API contract itself leaves the
/// exact shape open (`inventory_movement?: {...}`), so every field here is
/// read defensively (never a forced non-null cast) and degrades to `null`/
/// empty rather than throwing on an unexpected shape. Mirrors
/// `PosDirectPurchaseMovement`'s own fields, the established shape for
/// "a linked inventory movement's own identity/status" elsewhere in this
/// app.
class PosPurchaseOrderInventoryMovement {
  const PosPurchaseOrderInventoryMovement({
    required this.movementId,
    required this.movementNumber,
    required this.status,
    required this.postedAt,
  });

  factory PosPurchaseOrderInventoryMovement.fromJson(Map<String, Object?> json) =>
      PosPurchaseOrderInventoryMovement(
        movementId: json['id'] as String? ?? json['movement_id'] as String? ?? '',
        movementNumber: json['movement_number'] as String? ?? '',
        status: json['status'] as String? ?? '',
        postedAt: json['posted_at'] == null ? null : DateTime.tryParse(json['posted_at']! as String),
      );

  final String movementId;
  final String movementNumber;
  final String status;
  final DateTime? postedAt;
}

/// A single `purchase_order_lines` row — ordered vs. received quantity
/// tracked separately so a partial receipt is always honest (never
/// overwrites `orderedQuantity`).
class PosPurchaseOrderLine {
  const PosPurchaseOrderLine({
    required this.id,
    required this.lineNumber,
    required this.productVariantId,
    required this.productName,
    this.variantName,
    this.sku,
    required this.orderedQuantity,
    required this.receivedQuantity,
    required this.unitCost,
    required this.lineTotal,
    this.notes,
  });

  factory PosPurchaseOrderLine.fromJson(Map<String, Object?> json) => PosPurchaseOrderLine(
    id: json['id']! as String,
    lineNumber: (json['line_number'] as num?)?.toInt() ?? 0,
    productVariantId: json['product_variant_id']! as String,
    // `product_name` is only absent for a shape older than TASK 16.10A —
    // falls back to the raw variant id rather than throwing, so an
    // unmigrated/mixed environment degrades to the old (ugly but honest)
    // display instead of crashing the whole order.
    productName: json['product_name'] as String? ?? json['product_variant_id']! as String,
    variantName: json['variant_name'] as String?,
    sku: json['sku'] as String?,
    orderedQuantity: json['ordered_quantity']! as String,
    receivedQuantity: json['received_quantity'] as String? ?? '0',
    unitCost: json['unit_cost']! as String,
    lineTotal: json['line_total']! as String,
    notes: json['notes'] as String?,
  );

  final String id;
  final int lineNumber;
  final String productVariantId;
  /// Frozen at line-creation time from the catalog's product name — never
  /// re-derived live, so it stays legible even after the product is later
  /// renamed. See `purchase-orders.types.ts`'s own doc comment on
  /// `PurchaseOrderLineRow.productNameSnapshot`.
  final String productName;
  final String? variantName;
  final String? sku;
  final String orderedQuantity;
  final String receivedQuantity;
  final String unitCost;
  final String lineTotal;
  final String? notes;

  /// The single human-readable label for this line — "ProductName" alone,
  /// or "ProductName — VariantName" when the variant has its own distinct
  /// label. Never the raw [productVariantId]. [sku] is deliberately not
  /// folded in here — callers show it as secondary text (see
  /// `pos_shell.dart`'s PO line-row widgets).
  String get displayName => variantName == null || variantName!.isEmpty ? productName : '$productName — $variantName';
}

/// A `purchase_orders` row — exactly what `purchase-orders.routes.ts`
/// returns; nothing recomputed or guessed client-side. [lines] is `null`
/// only for a plain `GET /purchase-orders` list row (see this file's own
/// doc comment); [inventoryMovement] is only ever populated once the order
/// has been (partially) received.
class PosPurchaseOrder {
  const PosPurchaseOrder({
    required this.id,
    required this.orderNumber,
    required this.branchId,
    required this.status,
    this.supplierName,
    this.supplierId,
    required this.orderDate,
    this.expectedDate,
    required this.currencyCode,
    required this.totalCost,
    this.notes,
    this.submittedAt,
    this.submittedBy,
    this.receivedAt,
    this.receivedBy,
    this.cancelledAt,
    this.cancelledBy,
    this.receiptMovementId,
    this.version,
    this.createdBy,
    required this.createdAt,
    this.updatedAt,
    this.lines,
    this.inventoryMovement,
  });

  factory PosPurchaseOrder.fromJson(Map<String, Object?> json) {
    final rawLines = json['lines'];
    final movement = json['inventory_movement'];
    return PosPurchaseOrder(
      id: json['id']! as String,
      orderNumber: json['order_number']! as String,
      branchId: json['branch_id']! as String,
      status: json['status']! as String,
      supplierName: json['supplier_name'] as String?,
      supplierId: json['supplier_id'] as String?,
      orderDate: json['order_date']! as String,
      expectedDate: json['expected_date'] as String?,
      currencyCode: json['currency_code']! as String,
      totalCost: json['total_cost']! as String,
      notes: json['notes'] as String?,
      submittedAt: json['submitted_at'] == null ? null : DateTime.parse(json['submitted_at']! as String),
      submittedBy: json['submitted_by'] as String?,
      receivedAt: json['received_at'] == null ? null : DateTime.parse(json['received_at']! as String),
      receivedBy: json['received_by'] as String?,
      cancelledAt: json['cancelled_at'] == null ? null : DateTime.parse(json['cancelled_at']! as String),
      cancelledBy: json['cancelled_by'] as String?,
      receiptMovementId: json['receipt_movement_id'] as String?,
      version: json['version'] == null ? null : int.parse(json['version']! as String),
      createdBy: json['created_by'] as String?,
      createdAt: DateTime.parse(json['created_at']! as String),
      updatedAt: json['updated_at'] == null ? null : DateTime.parse(json['updated_at']! as String),
      lines: rawLines is List<Object?>
          ? rawLines.whereType<Map<String, Object?>>().map(PosPurchaseOrderLine.fromJson).toList(growable: false)
          : null,
      inventoryMovement: movement is Map<String, Object?>
          ? PosPurchaseOrderInventoryMovement.fromJson(movement)
          : null,
    );
  }

  final String id;
  final String orderNumber;
  final String branchId;

  /// `draft` | `submitted` | `partially_received` | `received` | `cancelled`.
  final String status;
  final String? supplierName;
  final String? supplierId;
  final String orderDate;
  final String? expectedDate;
  final String currencyCode;
  final String totalCost;
  final String? notes;
  final DateTime? submittedAt;
  final String? submittedBy;
  final DateTime? receivedAt;
  final String? receivedBy;
  final DateTime? cancelledAt;
  final String? cancelledBy;
  final String? receiptMovementId;
  final int? version;
  /// `null` only for a plain `GET /purchase-orders` list row, which omits
  /// this audit field — see this file's own doc comment.
  final String? createdBy;
  final DateTime createdAt;
  /// `null` only for a plain `GET /purchase-orders` list row, which omits
  /// this audit field — see this file's own doc comment.
  final DateTime? updatedAt;

  /// `null` only for a plain `GET /purchase-orders` list row — see this
  /// file's own doc comment.
  final List<PosPurchaseOrderLine>? lines;
  final PosPurchaseOrderInventoryMovement? inventoryMovement;
}

class PosPurchaseOrderPage {
  const PosPurchaseOrderPage({required this.items, required this.nextCursor});
  final List<PosPurchaseOrder> items;
  final String? nextCursor;
}

/// Every filter `GET /api/v1/purchase-orders` supports.
class PosPurchaseOrderListFilter {
  const PosPurchaseOrderListFilter({
    this.branchId,
    this.status,
    this.supplierId,
    this.orderDateFrom,
    this.orderDateTo,
  });
  final String? branchId;
  final String? status;
  final String? supplierId;
  final String? orderDateFrom;
  final String? orderDateTo;
}

/// One line of a `POST /purchase-orders` create request.
class PosPurchaseOrderLineInput {
  const PosPurchaseOrderLineInput({
    required this.productVariantId,
    required this.orderedQuantity,
    required this.unitCost,
    this.notes,
  });
  final String productVariantId;
  final String orderedQuantity;
  final String unitCost;
  final String? notes;

  Map<String, Object?> toJson() => {
    'product_variant_id': productVariantId,
    'ordered_quantity': orderedQuantity,
    'unit_cost': unitCost,
    if (notes != null && notes!.isNotEmpty) 'notes': notes,
  };
}

/// One line of a `POST /purchase-orders/{id}/receive` request. A line
/// omitted from the request is treated as 0 received by the backend — see
/// this gateway's own [PosPurchaseOrdersGateway.receivePurchaseOrder] doc
/// comment.
class PosPurchaseOrderReceiveLineInput {
  const PosPurchaseOrderReceiveLineInput({
    required this.purchaseOrderLineId,
    required this.receivedQuantity,
  });
  final String purchaseOrderLineId;
  final String receivedQuantity;

  Map<String, Object?> toJson() => {
    'purchase_order_line_id': purchaseOrderLineId,
    'received_quantity': receivedQuantity,
  };
}

abstract interface class PosPurchaseOrdersGateway {
  /// `POST /api/v1/purchase-orders` (`purchase.create`) — creates a new
  /// `draft` order with at least one line; the backend computes
  /// `total_cost` itself (never recomputed client-side).
  Future<PosPurchaseOrder> createPurchaseOrder({
    required String branchId,
    String? supplierName,
    String? supplierId,
    required String orderDate,
    String? expectedDate,
    required String currencyCode,
    String? notes,
    required List<PosPurchaseOrderLineInput> lines,
  });

  /// `GET /api/v1/purchase-orders/{id}` (`purchase.read`) — full detail,
  /// including every line and (once received) the linked movement.
  Future<PosPurchaseOrder> getPurchaseOrder(String id);

  /// `GET /api/v1/purchase-orders` (`purchase.read`) — paginated,
  /// filterable list of light summary rows (no `lines`).
  Future<PosPurchaseOrderPage> listPurchaseOrders({
    PosPurchaseOrderListFilter filter = const PosPurchaseOrderListFilter(),
    String? cursor,
    int limit = 50,
  });

  /// `POST /api/v1/purchase-orders/{id}/submit` (`purchase.create`) —
  /// `draft` -> `submitted` only; the backend rejects (409) any other
  /// starting status.
  Future<PosPurchaseOrder> submitPurchaseOrder(String id);

  /// `POST /api/v1/purchase-orders/{id}/receive` (`purchase.receive`) —
  /// valid only from `submitted` (never `partially_received`: receiving is
  /// a single event per order by design). A line omitted from [lines] is
  /// treated as 0 received. Returns the updated order — `received` if
  /// every line was fully received, `partially_received` otherwise — plus
  /// [PosPurchaseOrder.inventoryMovement].
  Future<PosPurchaseOrder> receivePurchaseOrder(
    String id, {
    required List<PosPurchaseOrderReceiveLineInput> lines,
  });

  /// `POST /api/v1/purchase-orders/{id}/cancel` (`purchase.create`) —
  /// valid from `draft`/`submitted`/`partially_received` only; the backend
  /// rejects (409) a `received` or already-`cancelled` order.
  Future<PosPurchaseOrder> cancelPurchaseOrder(String id, {String? reason});
}

class ApiPosPurchaseOrdersGateway implements PosPurchaseOrdersGateway {
  const ApiPosPurchaseOrdersGateway(this._client, {this.createIdempotencyKey = _defaultIdempotencyKey});

  final ApiClient _client;
  final String Function() createIdempotencyKey;

  static String _defaultIdempotencyKey() =>
      'one-purchase-order-${DateTime.now().toUtc().microsecondsSinceEpoch}';

  @override
  Future<PosPurchaseOrder> createPurchaseOrder({
    required String branchId,
    String? supplierName,
    String? supplierId,
    required String orderDate,
    String? expectedDate,
    required String currencyCode,
    String? notes,
    required List<PosPurchaseOrderLineInput> lines,
  }) async {
    final envelope = await _client.postJson(
      '/api/v1/purchase-orders',
      idempotencyKey: createIdempotencyKey(),
      body: {
        'branch_id': branchId,
        if (supplierName != null && supplierName.isNotEmpty) 'supplier_name': supplierName,
        if (supplierId != null && supplierId.isNotEmpty) 'supplier_id': supplierId,
        'order_date': orderDate,
        if (expectedDate != null && expectedDate.isNotEmpty) 'expected_date': expectedDate,
        'currency_code': currencyCode,
        if (notes != null && notes.isNotEmpty) 'notes': notes,
        'lines': [for (final line in lines) line.toJson()],
      },
    );
    return _decode(envelope);
  }

  @override
  Future<PosPurchaseOrder> getPurchaseOrder(String id) async {
    final envelope = await _client.getJson('/api/v1/purchase-orders/$id');
    return _decode(envelope);
  }

  @override
  Future<PosPurchaseOrderPage> listPurchaseOrders({
    PosPurchaseOrderListFilter filter = const PosPurchaseOrderListFilter(),
    String? cursor,
    int limit = 50,
  }) async {
    final query = <String, String>{
      'limit': '$limit',
      if (cursor != null) 'cursor': cursor,
      if (filter.branchId != null) 'branch_id': filter.branchId!,
      if (filter.status != null) 'status': filter.status!,
      if (filter.supplierId != null) 'supplier_id': filter.supplierId!,
      if (filter.orderDateFrom != null) 'order_date_from': filter.orderDateFrom!,
      if (filter.orderDateTo != null) 'order_date_to': filter.orderDateTo!,
    };
    final path = Uri(path: '/api/v1/purchase-orders', queryParameters: query).toString();
    final envelope = await _client.getJson(path);
    final data = envelope['data'];
    if (data is! List<Object?>) {
      throw const FormatException('Missing purchase-orders list data.');
    }
    final meta = envelope['meta'];
    final page = meta is Map<String, Object?> ? meta['page'] : null;
    final nextCursor = page is Map<String, Object?> ? page['next_cursor'] as String? : null;
    return PosPurchaseOrderPage(
      items: data.whereType<Map<String, Object?>>().map(PosPurchaseOrder.fromJson).toList(growable: false),
      nextCursor: nextCursor,
    );
  }

  @override
  Future<PosPurchaseOrder> submitPurchaseOrder(String id) async {
    final envelope = await _client.postJson(
      '/api/v1/purchase-orders/$id/submit',
      idempotencyKey: createIdempotencyKey(),
    );
    return _decode(envelope);
  }

  @override
  Future<PosPurchaseOrder> receivePurchaseOrder(
    String id, {
    required List<PosPurchaseOrderReceiveLineInput> lines,
  }) async {
    final envelope = await _client.postJson(
      '/api/v1/purchase-orders/$id/receive',
      idempotencyKey: createIdempotencyKey(),
      body: {'lines': [for (final line in lines) line.toJson()]},
    );
    return _decode(envelope);
  }

  @override
  Future<PosPurchaseOrder> cancelPurchaseOrder(String id, {String? reason}) async {
    final envelope = await _client.postJson(
      '/api/v1/purchase-orders/$id/cancel',
      idempotencyKey: createIdempotencyKey(),
      body: {if (reason != null && reason.isNotEmpty) 'reason': reason},
    );
    return _decode(envelope);
  }

  PosPurchaseOrder _decode(Map<String, Object?> envelope) {
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing purchase-order data.');
    }
    return PosPurchaseOrder.fromJson(data);
  }
}

class EmptyPosPurchaseOrdersGateway implements PosPurchaseOrdersGateway {
  const EmptyPosPurchaseOrdersGateway();

  @override
  Future<PosPurchaseOrder> createPurchaseOrder({
    required String branchId,
    String? supplierName,
    String? supplierId,
    required String orderDate,
    String? expectedDate,
    required String currencyCode,
    String? notes,
    required List<PosPurchaseOrderLineInput> lines,
  }) => Future.error(StateError('No purchase-orders gateway is configured.'));

  @override
  Future<PosPurchaseOrder> getPurchaseOrder(String id) =>
      Future.error(StateError('No purchase-orders gateway is configured.'));

  @override
  Future<PosPurchaseOrderPage> listPurchaseOrders({
    PosPurchaseOrderListFilter filter = const PosPurchaseOrderListFilter(),
    String? cursor,
    int limit = 50,
  }) => Future.error(StateError('No purchase-orders gateway is configured.'));

  @override
  Future<PosPurchaseOrder> submitPurchaseOrder(String id) =>
      Future.error(StateError('No purchase-orders gateway is configured.'));

  @override
  Future<PosPurchaseOrder> receivePurchaseOrder(
    String id, {
    required List<PosPurchaseOrderReceiveLineInput> lines,
  }) => Future.error(StateError('No purchase-orders gateway is configured.'));

  @override
  Future<PosPurchaseOrder> cancelPurchaseOrder(String id, {String? reason}) =>
      Future.error(StateError('No purchase-orders gateway is configured.'));
}
