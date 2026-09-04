import '../../core/networking/api_client.dart';
import 'pos_receipt.dart';

/// TASK 12.4A.1: the backend-authoritative result of `POST /api/v1/sales`
/// — only what the caller needs to know a sale now exists and what it is
/// legitimately worth. The server independently resolved price and tax;
/// this never re-derives them from the client's own ticket.
class PosSaleCreated {
  const PosSaleCreated({
    required this.id,
    required this.saleNumber,
    required this.status,
    required this.total,
  });

  factory PosSaleCreated.fromJson(Map<String, Object?> json) => PosSaleCreated(
    id: json['id']! as String,
    saleNumber: json['sale_number']! as String,
    status: json['status']! as String,
    total: json['total']! as String,
  );

  final String id;
  final String saleNumber;
  final String status;
  final String total;
}

/// One line of the ticket as the backend needs it — `productId` and a raw
/// quantity string, matching `SaleLine`'s own real fields (never a variant
/// id or a price: [SaleSession] doesn't carry one, and the server refuses
/// to accept one anyway — see ADR-0009 "Server money authority").
class PosSaleLineRequest {
  const PosSaleLineRequest({required this.productId, required this.quantity});
  final String productId;
  final String quantity;
}

/// TASK 12.6 Part B/C: one row of `GET /api/v1/sales` — a *summary*,
/// deliberately not the full item/payment history (that's
/// [PosReceipt], fetched only when a manager opens one sale's detail —
/// see `_SalesHistory`/`_SaleDetailDialog`). Every field here is exactly
/// what the backend's own `saleSummaryHttp` returns — never recomputed
/// or re-derived client-side.
class PosSaleSummary {
  const PosSaleSummary({
    required this.id,
    required this.saleNumber,
    required this.status,
    required this.currencyCode,
    required this.branchId,
    required this.branchName,
    required this.cashierId,
    required this.cashierName,
    required this.occurredAt,
    required this.completedAt,
    required this.itemCount,
    required this.subtotal,
    required this.taxTotal,
    required this.total,
    required this.paymentMethods,
    // TASK 12.8: `not_refunded` is the same real, never-fabricated default
    // `saleSummaryHttp` itself uses — every list row always carries a
    // batched `refundStatesForSales` lookup behind it (ADR-0015 D14), so
    // "the field was omitted" and "genuinely zero refunds" never need to
    // be distinguished here. Kept optional/defaulted so every pre-existing
    // fixture/test that constructs a [PosSaleSummary] directly (without
    // this field) keeps compiling unchanged.
    this.refundState = 'not_refunded',
  });

  factory PosSaleSummary.fromJson(Map<String, Object?> json) => PosSaleSummary(
    id: json['id']! as String,
    saleNumber: json['sale_number']! as String,
    status: json['status']! as String,
    currencyCode: json['currency_code']! as String,
    branchId: json['branch_id']! as String,
    branchName: json['branch_name'] as String?,
    cashierId: json['cashier_id'] as String?,
    cashierName: json['cashier_name'] as String?,
    occurredAt: DateTime.parse(json['occurred_at']! as String),
    completedAt: json['completed_at'] == null
        ? null
        : DateTime.parse(json['completed_at']! as String),
    itemCount: json['item_count']! as int,
    subtotal: json['subtotal']! as String,
    taxTotal: json['tax_total']! as String,
    total: json['total']! as String,
    paymentMethods: (json['payment_methods'] as List<Object?>? ?? const [])
        .whereType<String>()
        .toList(growable: false),
    refundState: json['refund_state'] as String? ?? 'not_refunded',
  );

  final String id;
  final String saleNumber;
  final String status;
  final String currencyCode;
  final String branchId;
  final String? branchName;
  final String? cashierId;
  final String? cashierName;
  final DateTime occurredAt;
  final DateTime? completedAt;
  final int itemCount;
  final String subtotal;
  final String taxTotal;
  final String total;
  final List<String> paymentMethods;

  /// `not_refunded` | `partially_refunded` | `fully_refunded` — derived,
  /// read-only (ADR-0015 D14). Never replaces [status]; a caller composes
  /// the two into one display label (e.g. "Completada · reembolsada"),
  /// never hides the original sale status.
  final String refundState;
}

/// A page of [PosSaleSummary] rows plus the opaque cursor for the next
/// page — `null` once there is no more history to load.
class PosSaleHistoryPage {
  const PosSaleHistoryPage({required this.items, required this.nextCursor});
  final List<PosSaleSummary> items;
  final String? nextCursor;
}

/// Every filter `GET /api/v1/sales` (E075) actually supports — see
/// `sales.routes.ts`'s own `SaleListQuery`. All optional; omitting one
/// simply doesn't send that query parameter.
class PosSaleHistoryFilter {
  const PosSaleHistoryFilter({
    this.branchId,
    this.status,
    this.occurredFrom,
    this.occurredTo,
    this.saleNumber,
    this.paymentMethod,
  });
  final String? branchId;
  final String? status;
  final DateTime? occurredFrom;
  final DateTime? occurredTo;
  final String? saleNumber;
  final String? paymentMethod;
}

abstract interface class PosSalesGateway {
  /// `POST /api/v1/sales` — creates a sale directly in `pending_payment`,
  /// with the backend independently resolving every line's price and tax.
  /// Never a fake/local success: throws [ApiException] on any rejection
  /// (missing price, inactive product, unauthorized branch, etc.), which
  /// the caller must surface honestly, never paper over.
  Future<PosSaleCreated> createSale({
    required String branchId,
    required List<PosSaleLineRequest> items,
  });

  /// `GET /api/v1/sales/{sale_id}/receipt` — TASK 12.5B. A plain,
  /// read-only fetch: safe to call any number of times ("reprint" is
  /// simply calling this again — see ADR-0012). Never a fabricated
  /// success: throws [ApiException] on any rejection, same as every
  /// other gateway call here.
  Future<PosReceipt> receipt(String saleId);

  /// `GET /api/v1/sales` (E075) — TASK 12.6 Part C. A plain, read-only,
  /// paginated query: never creates, mutates, or posts anything. `cursor`
  /// (from a previous page's [PosSaleHistoryPage.nextCursor]) continues an
  /// existing page sequence; omit it to start from the newest sale.
  Future<PosSaleHistoryPage> listSales({
    PosSaleHistoryFilter filter = const PosSaleHistoryFilter(),
    String? cursor,
    int limit = 50,
  });
}

class ApiPosSalesGateway implements PosSalesGateway {
  const ApiPosSalesGateway(this._client, {this.createIdempotencyKey = _defaultIdempotencyKey});

  final ApiClient _client;
  final String Function() createIdempotencyKey;

  static String _defaultIdempotencyKey() =>
      'one-sale-${DateTime.now().toUtc().microsecondsSinceEpoch}';

  @override
  Future<PosSaleCreated> createSale({
    required String branchId,
    required List<PosSaleLineRequest> items,
  }) async {
    final envelope = await _client.postJson(
      '/api/v1/sales',
      idempotencyKey: createIdempotencyKey(),
      body: {
        'branch_id': branchId,
        'items': [
          for (final item in items)
            {'product_id': item.productId, 'quantity': item.quantity},
        ],
      },
    );
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing sale data.');
    }
    return PosSaleCreated.fromJson(data);
  }

  @override
  Future<PosReceipt> receipt(String saleId) async {
    final envelope = await _client.getJson('/api/v1/sales/$saleId/receipt');
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing receipt data.');
    }
    return PosReceipt.fromJson(data);
  }

  @override
  Future<PosSaleHistoryPage> listSales({
    PosSaleHistoryFilter filter = const PosSaleHistoryFilter(),
    String? cursor,
    int limit = 50,
  }) async {
    final query = <String, String>{
      'limit': '$limit',
      if (cursor != null) 'cursor': cursor,
      if (filter.branchId != null) 'branch_id': filter.branchId!,
      if (filter.status != null) 'status': filter.status!,
      if (filter.occurredFrom != null) 'occurred_from': filter.occurredFrom!.toUtc().toIso8601String(),
      if (filter.occurredTo != null) 'occurred_to': filter.occurredTo!.toUtc().toIso8601String(),
      if (filter.saleNumber != null && filter.saleNumber!.isNotEmpty) 'sale_number': filter.saleNumber!,
      if (filter.paymentMethod != null) 'payment_method': filter.paymentMethod!,
    };
    final path = Uri(path: '/api/v1/sales', queryParameters: query).toString();
    final envelope = await _client.getJson(path);
    final data = envelope['data'];
    if (data is! List<Object?>) {
      throw const FormatException('Missing sales list data.');
    }
    final meta = envelope['meta'];
    final page = meta is Map<String, Object?> ? meta['page'] : null;
    final nextCursor = page is Map<String, Object?> ? page['next_cursor'] as String? : null;
    return PosSaleHistoryPage(
      items: data.whereType<Map<String, Object?>>().map(PosSaleSummary.fromJson).toList(growable: false),
      nextCursor: nextCursor,
    );
  }
}

class EmptyPosSalesGateway implements PosSalesGateway {
  const EmptyPosSalesGateway();

  @override
  Future<PosSaleCreated> createSale({
    required String branchId,
    required List<PosSaleLineRequest> items,
  }) => Future.error(StateError('No sales gateway is configured.'));

  @override
  Future<PosReceipt> receipt(String saleId) =>
      Future.error(StateError('No sales gateway is configured.'));

  @override
  Future<PosSaleHistoryPage> listSales({
    PosSaleHistoryFilter filter = const PosSaleHistoryFilter(),
    String? cursor,
    int limit = 50,
  }) => Future.error(StateError('No sales gateway is configured.'));
}
