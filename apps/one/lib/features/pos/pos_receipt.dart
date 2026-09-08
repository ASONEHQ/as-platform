/// TASK 12.5B: the canonical sale receipt — the Flutter side of
/// `GET /api/v1/sales/{sale_id}/receipt` (see ADR-0012). Every field here
/// is decoded straight off the backend's own persisted rows
/// (`sales`/`sale_items`/`payments`/`companies`/`branches`/`users`) —
/// never derived from [SaleSession], which may already be cleared by the
/// time a receipt is shown (TASK 12.5A clears it on a successful cash
/// checkout) and was never authoritative for money in the first place.
library;

/// The sale header/totals a receipt shows — `saleNumber` is the folio;
/// no second, independent folio sequence exists (see ADR-0012).
class PosReceiptSale {
  const PosReceiptSale({
    required this.id,
    required this.saleNumber,
    required this.status,
    required this.currencyCode,
    required this.branchId,
    required this.occurredAt,
    required this.completedAt,
    required this.subtotal,
    required this.discountTotal,
    required this.taxTotal,
    required this.total,
  });

  factory PosReceiptSale.fromJson(Map<String, Object?> json) => PosReceiptSale(
    id: json['id']! as String,
    saleNumber: json['sale_number']! as String,
    status: json['status']! as String,
    currencyCode: json['currency_code']! as String,
    branchId: json['branch_id']! as String,
    occurredAt: DateTime.parse(json['occurred_at']! as String),
    completedAt: json['completed_at'] == null
        ? null
        : DateTime.parse(json['completed_at']! as String),
    subtotal: json['subtotal']! as String,
    discountTotal: json['discount_total']! as String,
    taxTotal: json['tax_total']! as String,
    total: json['total']! as String,
  );

  final String id;
  final String saleNumber;
  final String status;
  final String currencyCode;
  final String branchId;
  final DateTime occurredAt;
  final DateTime? completedAt;
  final String subtotal;
  final String discountTotal;
  final String taxTotal;
  final String total;

  // TASK 14.3 (Wave 1, Part B.4): deliberately NO `note` field here — the
  // backend's own `GET /sales/{id}/receipt` response (`receiptHttp` in
  // `sales.routes.ts`) is a curated subset of the sale and does not
  // return one (unlike `saleHttp`, which `POST /sales`'s own response
  // uses — see `PosSaleCreated.note`). Mirrors this class's own
  // `customerDisplayName` precedent in `buildReceiptHtml`: a caller
  // threads the sale's already-known note through as a plain parameter
  // instead of reading it off this model.
}

/// `null` only if the backend's own join found nothing (defensive —
/// see `SalesRepository.receiptOrganization`'s own doc comment; not
/// expected once the sale itself resolved).
class PosReceiptBusiness {
  const PosReceiptBusiness({
    required this.companyName,
    required this.branchName,
    required this.branchAddress,
  });

  factory PosReceiptBusiness.fromJson(Map<String, Object?> json) => PosReceiptBusiness(
    companyName: json['company_name']! as String,
    branchName: json['branch_name']! as String,
    branchAddress: json['branch_address'] as Map<String, Object?>?,
  );

  final String companyName;
  final String branchName;
  final Map<String, Object?>? branchAddress;
}

class PosReceiptCashier {
  const PosReceiptCashier({required this.id, required this.displayName});

  factory PosReceiptCashier.fromJson(Map<String, Object?> json) =>
      PosReceiptCashier(id: json['id']! as String, displayName: json['display_name']! as String);

  final String id;
  final String displayName;
}

/// A frozen line snapshot — `nameSnapshot`/`unitPrice` never change after
/// the sale, even if the underlying product is later renamed or
/// repriced (TASK 12.4A.1's snapshot columns; see ADR-0012).
class PosReceiptItem {
  const PosReceiptItem({
    required this.lineNumber,
    required this.nameSnapshot,
    required this.skuSnapshot,
    required this.quantity,
    required this.unitPrice,
    required this.discountTotal,
    required this.taxTotal,
    required this.lineTotal,
  });

  factory PosReceiptItem.fromJson(Map<String, Object?> json) => PosReceiptItem(
    lineNumber: json['line_number']! as int,
    nameSnapshot: json['name_snapshot']! as String,
    skuSnapshot: json['sku_snapshot'] as String?,
    quantity: json['quantity']! as String,
    unitPrice: json['unit_price']! as String,
    discountTotal: json['discount_total']! as String,
    taxTotal: json['tax_total']! as String,
    lineTotal: json['line_total']! as String,
  );

  final int lineNumber;
  final String nameSnapshot;
  final String? skuSnapshot;
  final String quantity;
  final String unitPrice;
  final String discountTotal;
  final String taxTotal;
  final String lineTotal;
}

/// A receipt-safe payment line. `tenderedAmount`/`changeAmount` are only
/// ever non-null for a real `cash` payment (the backend itself only ever
/// populates them then — see ADR-0011/ADR-0012); `provider`/`terminalId`/
/// `providerReference` are only ever non-null for a real, captured
/// `card_terminal` payment. Never fabricated client-side either way —
/// every field is exactly what the backend returned, `null` where the
/// backend itself has nothing to report.
class PosReceiptPayment {
  const PosReceiptPayment({
    required this.id,
    required this.paymentMethod,
    required this.status,
    required this.amount,
    required this.currencyCode,
    required this.capturedAt,
    required this.tenderedAmount,
    required this.changeAmount,
    required this.provider,
    required this.terminalId,
    required this.providerReference,
  });

  factory PosReceiptPayment.fromJson(Map<String, Object?> json) => PosReceiptPayment(
    id: json['id']! as String,
    paymentMethod: json['payment_method']! as String,
    status: json['status']! as String,
    amount: json['amount']! as String,
    currencyCode: json['currency_code']! as String,
    capturedAt: json['captured_at'] == null ? null : DateTime.parse(json['captured_at']! as String),
    tenderedAmount: json['tendered_amount'] as String?,
    changeAmount: json['change_amount'] as String?,
    provider: json['provider'] as String?,
    terminalId: json['terminal_id'] as String?,
    providerReference: json['provider_reference'] as String?,
  );

  final String id;
  final String paymentMethod;
  final String status;
  final String amount;
  final String currencyCode;
  final DateTime? capturedAt;
  final String? tenderedAmount;
  final String? changeAmount;
  final String? provider;
  final String? terminalId;
  final String? providerReference;

  bool get isCash => paymentMethod == 'cash';
}

class PosReceipt {
  const PosReceipt({
    required this.sale,
    required this.business,
    required this.cashier,
    required this.items,
    required this.payments,
  });

  factory PosReceipt.fromJson(Map<String, Object?> json) {
    final rawItems = json['items'];
    final rawPayments = json['payments'];
    final business = json['business'];
    final cashier = json['cashier'];
    return PosReceipt(
      sale: PosReceiptSale.fromJson(json['sale']! as Map<String, Object?>),
      business: business is Map<String, Object?> ? PosReceiptBusiness.fromJson(business) : null,
      cashier: cashier is Map<String, Object?> ? PosReceiptCashier.fromJson(cashier) : null,
      items: rawItems is List<Object?>
          ? rawItems.whereType<Map<String, Object?>>().map(PosReceiptItem.fromJson).toList(growable: false)
          : const <PosReceiptItem>[],
      payments: rawPayments is List<Object?>
          ? rawPayments
                .whereType<Map<String, Object?>>()
                .map(PosReceiptPayment.fromJson)
                .toList(growable: false)
          : const <PosReceiptPayment>[],
    );
  }

  final PosReceiptSale sale;
  final PosReceiptBusiness? business;
  final PosReceiptCashier? cashier;
  final List<PosReceiptItem> items;
  final List<PosReceiptPayment> payments;

  /// The cash leg, if this sale was (at least partly) paid in cash — the
  /// common case this task targets. `null` for a sale with no cash
  /// payment at all (e.g. still `pending_payment`, or paid entirely by
  /// another method).
  PosReceiptPayment? get cashPayment {
    for (final payment in payments) {
      if (payment.isCash) return payment;
    }
    return null;
  }
}
