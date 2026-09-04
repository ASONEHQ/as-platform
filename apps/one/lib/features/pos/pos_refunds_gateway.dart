import '../../core/networking/api_client.dart';

/// TASK 12.8: the Flutter side of E081/E082/E083/E084/E086 — see
/// ADR-0015 for the full backend design this mirrors. Every model here is
/// exactly what the backend returns; nothing is recomputed or guessed
/// client-side (ADR-0015 D5/D6: "Flutter never computes an authoritative
/// refund total, tax split, or eligibility decision — always trusts and
/// displays the backend's own numbers").

/// One sale line's remaining refundable quantity/value — E081's own
/// per-line shape (`RefundableLineBalance` in `refunds.types.ts`).
class PosRefundableLine {
  const PosRefundableLine({
    required this.saleItemId,
    required this.nameSnapshot,
    required this.soldQuantity,
    required this.refundedQuantity,
    required this.refundableQuantity,
    required this.unitPrice,
  });

  factory PosRefundableLine.fromJson(Map<String, Object?> json) =>
      PosRefundableLine(
        saleItemId: json['sale_item_id']! as String,
        nameSnapshot: json['name_snapshot']! as String,
        soldQuantity: json['sold_quantity']! as String,
        refundedQuantity: json['refunded_quantity']! as String,
        refundableQuantity: json['refundable_quantity']! as String,
        unitPrice: json['unit_price']! as String,
      );

  final String saleItemId;
  final String nameSnapshot;
  final String soldQuantity;
  final String refundedQuantity;
  final String refundableQuantity;
  final String unitPrice;
}

/// E081 (`GET /sales/{sale_id}/refundable-balance`) — the sale-level
/// eligibility answer plus every line's own remaining refundable amount.
/// `refundable`/`blockedReason` are exactly what the backend decided; this
/// app only ever displays or gates UI on these values, never derives its
/// own eligibility (ADR-0015 D6 Part 3: "never Flutter").
class PosRefundableBalance {
  const PosRefundableBalance({
    required this.saleId,
    required this.refundable,
    required this.blockedReason,
    required this.lines,
  });

  factory PosRefundableBalance.fromJson(Map<String, Object?> json) {
    final rawLines = json['lines'];
    return PosRefundableBalance(
      saleId: json['sale_id']! as String,
      refundable: json['refundable'] == true,
      blockedReason: json['blocked_reason'] as String?,
      lines: rawLines is List<Object?>
          ? rawLines
                .whereType<Map<String, Object?>>()
                .map(PosRefundableLine.fromJson)
                .toList(growable: false)
          : const <PosRefundableLine>[],
    );
  }

  final String saleId;
  final bool refundable;
  final String? blockedReason;
  final List<PosRefundableLine> lines;

  /// Looks up one line's name/unit price by `sale_item_id` — refund items
  /// (E082/E083/E086) never carry a name snapshot of their own (see
  /// `refund_items`'s schema), so a refund receipt/detail view joins
  /// against this already-fetched balance instead of guessing a name
  /// (ADR-0015 D17).
  PosRefundableLine? lineFor(String saleItemId) {
    for (final line in lines) {
      if (line.saleItemId == saleItemId) return line;
    }
    return null;
  }
}

/// One `refund_items` row — E082/E083/E086's own item shape. Deliberately
/// has no name/unit-price field (the backend never stores one on
/// `refund_items`) — see [PosRefundableBalance.lineFor] for how this app
/// joins a display name back in from already-fetched data.
class PosRefundItem {
  const PosRefundItem({
    required this.id,
    required this.saleItemId,
    required this.quantity,
    required this.subtotal,
    required this.taxTotal,
    required this.lineTotal,
    required this.restockDisposition,
  });

  factory PosRefundItem.fromJson(Map<String, Object?> json) => PosRefundItem(
    id: json['id']! as String,
    saleItemId: json['sale_item_id']! as String,
    quantity: json['quantity']! as String,
    subtotal: json['subtotal']! as String,
    taxTotal: json['tax_total']! as String,
    lineTotal: json['line_total']! as String,
    restockDisposition: json['restock_disposition'] as String?,
  );

  final String id;
  final String saleItemId;
  final String quantity;
  final String subtotal;
  final String taxTotal;
  final String lineTotal;
  final String? restockDisposition;
}

/// A `refunds` row — §21.4's exact 6 states, never a project-invented one
/// (see `refunds.types.ts`'s own `RefundStatus`). `items` is `null` only
/// when this came from the list endpoint (E084), which deliberately omits
/// item history per row (mirrors `PosSaleSummary`'s own "summary, not full
/// history" precedent) — always populated for E082/E083/E086.
class PosRefund {
  const PosRefund({
    required this.id,
    required this.branchId,
    required this.saleId,
    required this.cashSessionId,
    required this.paymentId,
    required this.refundNumber,
    required this.status,
    required this.refundMethod,
    required this.reasonCode,
    required this.reasonNote,
    required this.currencyCode,
    required this.subtotal,
    required this.taxTotal,
    required this.total,
    required this.occurredAt,
    required this.completedAt,
    required this.createdBy,
    required this.approvedBy,
    this.items,
  });

  factory PosRefund.fromJson(Map<String, Object?> json) {
    final rawItems = json['items'];
    return PosRefund(
      id: json['id']! as String,
      branchId: json['branch_id']! as String,
      saleId: json['sale_id']! as String,
      cashSessionId: json['cash_session_id'] as String?,
      paymentId: json['payment_id'] as String?,
      refundNumber: json['refund_number']! as String,
      status: json['status']! as String,
      refundMethod: json['refund_method']! as String,
      reasonCode: json['reason_code']! as String,
      reasonNote: json['reason_note'] as String?,
      currencyCode: json['currency_code']! as String,
      subtotal: json['subtotal']! as String,
      taxTotal: json['tax_total']! as String,
      total: json['total']! as String,
      occurredAt: DateTime.parse(json['occurred_at']! as String),
      completedAt: json['completed_at'] == null
          ? null
          : DateTime.parse(json['completed_at']! as String),
      createdBy: json['created_by']! as String,
      approvedBy: json['approved_by'] as String?,
      items: rawItems is List<Object?>
          ? rawItems
                .whereType<Map<String, Object?>>()
                .map(PosRefundItem.fromJson)
                .toList(growable: false)
          : null,
    );
  }

  final String id;
  final String branchId;
  final String saleId;
  final String? cashSessionId;
  final String? paymentId;
  final String refundNumber;
  final String status;

  /// `cash` | `card_terminal` | `card_manual` | `other` — always follows
  /// the original sale's captured payment method; there is no request
  /// field to choose a different one (ADR-0015 D9).
  final String refundMethod;
  final String reasonCode;
  final String? reasonNote;
  final String currencyCode;
  final String subtotal;
  final String taxTotal;
  final String total;
  final DateTime occurredAt;
  final DateTime? completedAt;
  final String createdBy;
  final String? approvedBy;
  final List<PosRefundItem>? items;

  bool get isCash => refundMethod == 'cash';
  bool get isCardTerminal => refundMethod == 'card_terminal';
  bool get isCompleted => status == 'completed';
}

class PosRefundPage {
  const PosRefundPage({required this.items, required this.nextCursor});
  final List<PosRefund> items;
  final String? nextCursor;
}

/// Every filter `GET /api/v1/refunds` (E084) supports — see
/// `refunds.routes.ts`'s own querystring schema.
class PosRefundListFilter {
  const PosRefundListFilter({
    this.branchId,
    this.saleId,
    this.status,
    this.occurredFrom,
    this.occurredTo,
  });
  final String? branchId;
  final String? saleId;
  final String? status;
  final DateTime? occurredFrom;
  final DateTime? occurredTo;
}

/// One requested line for E082 — only `sale_item_id`/`quantity`; the
/// backend independently recomputes every money figure from the original
/// sale item's own frozen snapshot (ADR-0015 D5) — there is no amount
/// field to submit here, by design.
class PosCreateRefundItem {
  const PosCreateRefundItem({required this.saleItemId, required this.quantity});
  final String saleItemId;
  final String quantity;
}

abstract interface class PosRefundsGateway {
  /// `GET /api/v1/sales/{sale_id}/refundable-balance` (E081) — the one
  /// read that decides whether a "Devolver / Reembolsar" action may even
  /// be shown, and bounds how much of each line may be requested.
  Future<PosRefundableBalance> refundableBalance(String saleId);

  /// `POST /api/v1/refunds` (E082) — requests a refund; lands directly in
  /// `approved` when the actor holds both `refund.create`/`refund.approve`
  /// (self-approve, ADR-0015 D7), otherwise the backend rejects it
  /// outright with `refund_approval_required` — never silently queued.
  Future<PosRefund> createRefund({
    required String saleId,
    required String reasonCode,
    String? reasonNote,
    required List<PosCreateRefundItem> items,
  });

  /// `GET /api/v1/refunds/{id}` (E083) — full refund detail with items.
  Future<PosRefund> refund(String refundId);

  /// `GET /api/v1/refunds` (E084) — also what a Sale Detail's "returns for
  /// this sale" section calls, via `filter.saleId` — no separate/duplicate
  /// endpoint exists for that (ADR-0015 D14).
  Future<PosRefundPage> listRefunds({
    PosRefundListFilter filter = const PosRefundListFilter(),
    String? cursor,
    int limit = 50,
  });

  /// `POST /api/v1/refunds/{id}/completion` (E086) — the one atomic
  /// effects boundary (payment reversal, cash-drawer movement, inventory
  /// restoration). [cashRegisterId] is only ever needed when the backend
  /// itself reports more than one open session for the branch; never
  /// guessed client-side.
  Future<PosRefund> completeRefund({
    required String refundId,
    String? cashRegisterId,
  });
}

class ApiPosRefundsGateway implements PosRefundsGateway {
  const ApiPosRefundsGateway(
    this._client, {
    this.createIdempotencyKey = _defaultIdempotencyKey,
  });

  final ApiClient _client;
  final String Function() createIdempotencyKey;

  static String _defaultIdempotencyKey() =>
      'one-refund-${DateTime.now().toUtc().microsecondsSinceEpoch}';

  @override
  Future<PosRefundableBalance> refundableBalance(String saleId) async {
    final envelope = await _client.getJson(
      '/api/v1/sales/$saleId/refundable-balance',
    );
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing refundable-balance data.');
    }
    return PosRefundableBalance.fromJson(data);
  }

  @override
  Future<PosRefund> createRefund({
    required String saleId,
    required String reasonCode,
    String? reasonNote,
    required List<PosCreateRefundItem> items,
  }) async {
    final envelope = await _client.postJson(
      '/api/v1/refunds',
      idempotencyKey: createIdempotencyKey(),
      body: {
        'sale_id': saleId,
        'reason_code': reasonCode,
        if (reasonNote != null && reasonNote.isNotEmpty) 'reason_note': reasonNote,
        'items': [
          for (final item in items)
            {'sale_item_id': item.saleItemId, 'quantity': item.quantity},
        ],
      },
    );
    return _decodeRefund(envelope);
  }

  @override
  Future<PosRefund> refund(String refundId) async {
    final envelope = await _client.getJson('/api/v1/refunds/$refundId');
    return _decodeRefund(envelope);
  }

  @override
  Future<PosRefundPage> listRefunds({
    PosRefundListFilter filter = const PosRefundListFilter(),
    String? cursor,
    int limit = 50,
  }) async {
    final query = <String, String>{
      'limit': '$limit',
      if (cursor != null) 'cursor': cursor,
      if (filter.branchId != null) 'branch_id': filter.branchId!,
      if (filter.saleId != null) 'sale_id': filter.saleId!,
      if (filter.status != null) 'status': filter.status!,
      if (filter.occurredFrom != null)
        'occurred_from': filter.occurredFrom!.toUtc().toIso8601String(),
      if (filter.occurredTo != null)
        'occurred_to': filter.occurredTo!.toUtc().toIso8601String(),
    };
    final path = Uri(path: '/api/v1/refunds', queryParameters: query).toString();
    final envelope = await _client.getJson(path);
    final data = envelope['data'];
    if (data is! List<Object?>) {
      throw const FormatException('Missing refunds list data.');
    }
    final meta = envelope['meta'];
    final page = meta is Map<String, Object?> ? meta['page'] : null;
    final nextCursor = page is Map<String, Object?>
        ? page['next_cursor'] as String?
        : null;
    return PosRefundPage(
      items: data.whereType<Map<String, Object?>>().map(PosRefund.fromJson).toList(growable: false),
      nextCursor: nextCursor,
    );
  }

  @override
  Future<PosRefund> completeRefund({
    required String refundId,
    String? cashRegisterId,
  }) async {
    final envelope = await _client.postJson(
      '/api/v1/refunds/$refundId/completion',
      idempotencyKey: createIdempotencyKey(),
      body: {
        if (cashRegisterId != null) 'cash_register_id': cashRegisterId,
      },
    );
    return _decodeRefund(envelope);
  }

  PosRefund _decodeRefund(Map<String, Object?> envelope) {
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing refund data.');
    }
    return PosRefund.fromJson(data);
  }
}

class EmptyPosRefundsGateway implements PosRefundsGateway {
  const EmptyPosRefundsGateway();

  @override
  Future<PosRefundableBalance> refundableBalance(String saleId) =>
      Future.error(StateError('No refunds gateway is configured.'));

  @override
  Future<PosRefund> createRefund({
    required String saleId,
    required String reasonCode,
    String? reasonNote,
    required List<PosCreateRefundItem> items,
  }) => Future.error(StateError('No refunds gateway is configured.'));

  @override
  Future<PosRefund> refund(String refundId) =>
      Future.error(StateError('No refunds gateway is configured.'));

  @override
  Future<PosRefundPage> listRefunds({
    PosRefundListFilter filter = const PosRefundListFilter(),
    String? cursor,
    int limit = 50,
  }) => Future.error(StateError('No refunds gateway is configured.'));

  @override
  Future<PosRefund> completeRefund({
    required String refundId,
    String? cashRegisterId,
  }) => Future.error(StateError('No refunds gateway is configured.'));
}
