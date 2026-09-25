/// TASK 14.4 (Wave 2, Part D): the Flutter side of `reports.routes.ts` —
/// Report Center. Mirrors `pos_held_sales_gateway.dart`'s own established
/// three-class shape exactly (abstract interface / `Api...` / `Empty...`).
///
/// Every field name below is copied verbatim from `reports.routes.ts`'s own
/// `<area>ReportHttp(...)` mapper functions in
/// `apps/api/src/modules/reports/reports.routes.ts` — never guessed. A
/// report's date range is always REQUIRED (no method here accepts an
/// optional/defaulted range) — mirrors `ReportDateRange`'s own doc comment
/// in `reports.types.ts` ("no report here ever silently defaults to 'all
/// time'"). Money is always kept per-currency (a `List` of
/// `PosReportCurrencyAmount`, one entry per currency actually present) —
/// never summed across currencies, matching `CurrencyAmount`'s own doc
/// comment.
library;

import '../../core/networking/api_client.dart';

/// `date_from`/`date_to` — 'YYYY-MM-DD', inclusive. Required on every call;
/// there is no default-constructible instance with empty dates.
class PosReportDateRange {
  const PosReportDateRange({required this.dateFrom, required this.dateTo});
  final String dateFrom;
  final String dateTo;
}

/// Adds the optional `branch_id` dimension every report except Customers
/// carries (see `reports.routes.ts`'s own `CompanyReportQuerystring` vs
/// `ReportQuerystring` split). `branchId: null` means "consolidated across
/// every branch the caller's session permits" — never "all branches
/// everywhere" — the backend itself still restricts to
/// `auth.permittedBranchIds`.
class PosReportFilter extends PosReportDateRange {
  const PosReportFilter({
    required super.dateFrom,
    required super.dateTo,
    this.branchId,
  });
  final String? branchId;
}

/// Mirrors `CurrencyAmount` (`reports.types.ts`) — `amount` stays the raw
/// ADR-0001 decimal-string the backend sent; a caller that wants to render
/// it formats it with `Money.parse(amount, currencyCode)`, never a
/// re-parsed `double`.
class PosReportCurrencyAmount {
  const PosReportCurrencyAmount({required this.currencyCode, required this.amount});

  factory PosReportCurrencyAmount.fromJson(Map<String, Object?> json) => PosReportCurrencyAmount(
    currencyCode: json['currency_code']! as String,
    amount: json['amount']! as String,
  );

  final String currencyCode;
  final String amount;
}

/// Mirrors `StatusCount` (`reports.types.ts`).
class PosReportStatusCount {
  const PosReportStatusCount({required this.status, required this.count});

  factory PosReportStatusCount.fromJson(Map<String, Object?> json) =>
      PosReportStatusCount(status: json['status']! as String, count: (json['count']! as num).toInt());

  final String status;
  final int count;
}

List<PosReportCurrencyAmount> _amountList(Map<String, Object?> json, String key) {
  final raw = json[key];
  if (raw is! List<Object?>) return const [];
  return raw.whereType<Map<String, Object?>>().map(PosReportCurrencyAmount.fromJson).toList(growable: false);
}

List<PosReportStatusCount> _statusList(Map<String, Object?> json, String key) {
  final raw = json[key];
  if (raw is! List<Object?>) return const [];
  return raw.whereType<Map<String, Object?>>().map(PosReportStatusCount.fromJson).toList(growable: false);
}

int _int(Map<String, Object?> json, String key) => (json[key]! as num).toInt();
String _string(Map<String, Object?> json, String key) => json[key]! as String;
String? _stringOrNull(Map<String, Object?> json, String key) => json[key] as String?;
int? _intOrNull(Map<String, Object?> json, String key) => (json[key] as num?)?.toInt();

// --- Sales ---------------------------------------------------------------

/// TASK 16.25 (Phase 6/Inteligencia+Ventas). Mirrors `HourlySales`
/// (`reports.types.ts`) — `hour` is the real branch-local hour (0-23) the
/// backend computed via SQL, never re-derived from a UTC timestamp here.
class PosHourlySales {
  const PosHourlySales({
    required this.hour,
    required this.currencyCode,
    required this.transactionCount,
    required this.grossSales,
  });

  factory PosHourlySales.fromJson(Map<String, Object?> json) => PosHourlySales(
    hour: _int(json, 'hour'),
    currencyCode: _string(json, 'currency_code'),
    transactionCount: _int(json, 'transaction_count'),
    grossSales: _string(json, 'gross_sales'),
  );

  final int hour;
  final String currencyCode;
  final int transactionCount;
  final String grossSales;
}

/// TASK 16.25 (Phase 6/Inteligencia+Ventas). Mirrors `TopProduct`
/// (`reports.types.ts`) — `productId` is `null` for a sale line whose
/// product was never linked to the catalog (a legitimate, real state,
/// never hidden).
class PosTopProduct {
  const PosTopProduct({
    required this.productId,
    required this.name,
    required this.quantitySold,
    required this.currencyCode,
    required this.revenue,
  });

  factory PosTopProduct.fromJson(Map<String, Object?> json) => PosTopProduct(
    productId: _stringOrNull(json, 'product_id'),
    name: _string(json, 'name'),
    quantitySold: _string(json, 'quantity_sold'),
    currencyCode: _string(json, 'currency_code'),
    revenue: _string(json, 'revenue'),
  );

  final String? productId;
  final String name;
  final String quantitySold;
  final String currencyCode;
  final String revenue;
}

/// Mirrors `SalesReport` (`reports.types.ts`) exactly.
class PosSalesReport {
  const PosSalesReport({
    required this.dateFrom,
    required this.dateTo,
    required this.branchId,
    required this.transactionCount,
    required this.grossSales,
    required this.refundCount,
    required this.refundsTotal,
    required this.netSales,
    required this.averageTicket,
    required this.salesByHour,
    required this.topProducts,
  });

  factory PosSalesReport.fromJson(Map<String, Object?> json) => PosSalesReport(
    dateFrom: _string(json, 'date_from'),
    dateTo: _string(json, 'date_to'),
    branchId: _stringOrNull(json, 'branch_id'),
    transactionCount: _int(json, 'transaction_count'),
    grossSales: _amountList(json, 'gross_sales'),
    refundCount: _int(json, 'refund_count'),
    refundsTotal: _amountList(json, 'refunds_total'),
    netSales: _amountList(json, 'net_sales'),
    averageTicket: _amountList(json, 'average_ticket'),
    salesByHour: (json['sales_by_hour'] as List<Object?>? ?? const [])
        .whereType<Map<String, Object?>>()
        .map(PosHourlySales.fromJson)
        .toList(growable: false),
    topProducts: (json['top_products'] as List<Object?>? ?? const [])
        .whereType<Map<String, Object?>>()
        .map(PosTopProduct.fromJson)
        .toList(growable: false),
  );

  final String dateFrom;
  final String dateTo;
  final String? branchId;
  final int transactionCount;
  final List<PosReportCurrencyAmount> grossSales;
  final int refundCount;
  final List<PosReportCurrencyAmount> refundsTotal;
  final List<PosReportCurrencyAmount> netSales;
  final List<PosReportCurrencyAmount> averageTicket;
  final List<PosHourlySales> salesByHour;
  final List<PosTopProduct> topProducts;
}

// --- Financial -------------------------------------------------------------

/// Mirrors `CashMovementTotal` (`reports.types.ts`).
class PosCashMovementTotal {
  const PosCashMovementTotal({
    required this.movementType,
    required this.currencyCode,
    required this.amount,
    required this.count,
  });

  factory PosCashMovementTotal.fromJson(Map<String, Object?> json) => PosCashMovementTotal(
    movementType: _string(json, 'movement_type'),
    currencyCode: _string(json, 'currency_code'),
    amount: _string(json, 'amount'),
    count: _int(json, 'count'),
  );

  final String movementType;
  final String currencyCode;
  final String amount;
  final int count;
}

/// Mirrors `ClosedSessionTotal` (`reports.types.ts`).
class PosClosedSessionTotal {
  const PosClosedSessionTotal({
    required this.currencyCode,
    required this.sessionCount,
    required this.declaredClosingTotal,
    required this.expectedClosingTotal,
    required this.discrepancyTotal,
  });

  factory PosClosedSessionTotal.fromJson(Map<String, Object?> json) => PosClosedSessionTotal(
    currencyCode: _string(json, 'currency_code'),
    sessionCount: _int(json, 'session_count'),
    declaredClosingTotal: _string(json, 'declared_closing_total'),
    expectedClosingTotal: _string(json, 'expected_closing_total'),
    discrepancyTotal: _string(json, 'discrepancy_total'),
  );

  final String currencyCode;
  final int sessionCount;
  final String declaredClosingTotal;
  final String expectedClosingTotal;
  final String discrepancyTotal;
}

/// TASK 16.25 (Phase 7/Financiero). Mirrors `PaymentMethodTotal`
/// (`reports.types.ts`) — deliberately NOT the same thing as
/// `PosCashMovementTotal` above: this tracks how the CUSTOMER paid
/// (cash/transfer/card_terminal/card_manual/other), never how much
/// physically sits in the drawer.
class PosPaymentMethodTotal {
  const PosPaymentMethodTotal({
    required this.paymentMethod,
    required this.currencyCode,
    required this.amount,
    required this.count,
  });

  factory PosPaymentMethodTotal.fromJson(Map<String, Object?> json) => PosPaymentMethodTotal(
    paymentMethod: _string(json, 'payment_method'),
    currencyCode: _string(json, 'currency_code'),
    amount: _string(json, 'amount'),
    count: _int(json, 'count'),
  );

  final String paymentMethod;
  final String currencyCode;
  final String amount;
  final int count;
}

/// Mirrors `FinancialReport` (`reports.types.ts`) exactly.
class PosFinancialReport {
  const PosFinancialReport({
    required this.dateFrom,
    required this.dateTo,
    required this.branchId,
    required this.movementTotals,
    required this.netCashMovement,
    required this.closedSessions,
    required this.sessionsOpenedCount,
    required this.paymentMethodTotals,
  });

  factory PosFinancialReport.fromJson(Map<String, Object?> json) => PosFinancialReport(
    dateFrom: _string(json, 'date_from'),
    dateTo: _string(json, 'date_to'),
    branchId: _stringOrNull(json, 'branch_id'),
    movementTotals: (json['movement_totals'] as List<Object?>? ?? const [])
        .whereType<Map<String, Object?>>()
        .map(PosCashMovementTotal.fromJson)
        .toList(growable: false),
    netCashMovement: _amountList(json, 'net_cash_movement'),
    closedSessions: (json['closed_sessions'] as List<Object?>? ?? const [])
        .whereType<Map<String, Object?>>()
        .map(PosClosedSessionTotal.fromJson)
        .toList(growable: false),
    sessionsOpenedCount: _int(json, 'sessions_opened_count'),
    paymentMethodTotals: (json['payment_method_totals'] as List<Object?>? ?? const [])
        .whereType<Map<String, Object?>>()
        .map(PosPaymentMethodTotal.fromJson)
        .toList(growable: false),
  );

  final String dateFrom;
  final String dateTo;
  final String? branchId;
  final List<PosCashMovementTotal> movementTotals;
  final List<PosReportCurrencyAmount> netCashMovement;
  final List<PosClosedSessionTotal> closedSessions;
  final int sessionsOpenedCount;
  final List<PosPaymentMethodTotal> paymentMethodTotals;
}

// --- Inventory ---------------------------------------------------------------

/// Mirrors `InventoryMovementVolume` (`reports.types.ts`).
class PosInventoryMovementVolume {
  const PosInventoryMovementVolume({
    required this.movementType,
    required this.movementCount,
    required this.totalBaseQuantity,
  });

  factory PosInventoryMovementVolume.fromJson(Map<String, Object?> json) => PosInventoryMovementVolume(
    movementType: _string(json, 'movement_type'),
    movementCount: _int(json, 'movement_count'),
    totalBaseQuantity: _string(json, 'total_base_quantity'),
  );

  final String movementType;
  final int movementCount;
  final String totalBaseQuantity;
}

/// Mirrors `InventoryReport` (`reports.types.ts`) exactly. Quantities stay
/// raw decimal strings (never `double`) — they carry no currency, so
/// `Money` does not apply; a caller renders them verbatim plus a unit
/// label, never a fabricated conversion.
class PosInventoryReport {
  const PosInventoryReport({
    required this.dateFrom,
    required this.dateTo,
    required this.branchId,
    required this.trackedVariantCount,
    required this.quantityOnHandTotal,
    required this.quantityReservedTotal,
    required this.quantityInTransitTotal,
    required this.outOfStockVariantCount,
    required this.inventoryValue,
    required this.movementVolume,
  });

  factory PosInventoryReport.fromJson(Map<String, Object?> json) => PosInventoryReport(
    dateFrom: _string(json, 'date_from'),
    dateTo: _string(json, 'date_to'),
    branchId: _stringOrNull(json, 'branch_id'),
    trackedVariantCount: _int(json, 'tracked_variant_count'),
    quantityOnHandTotal: _string(json, 'quantity_on_hand_total'),
    quantityReservedTotal: _string(json, 'quantity_reserved_total'),
    quantityInTransitTotal: _string(json, 'quantity_in_transit_total'),
    outOfStockVariantCount: _int(json, 'out_of_stock_variant_count'),
    inventoryValue: _amountList(json, 'inventory_value'),
    movementVolume: (json['movement_volume'] as List<Object?>? ?? const [])
        .whereType<Map<String, Object?>>()
        .map(PosInventoryMovementVolume.fromJson)
        .toList(growable: false),
  );

  final String dateFrom;
  final String dateTo;
  final String? branchId;
  final int trackedVariantCount;
  final String quantityOnHandTotal;
  final String quantityReservedTotal;
  final String quantityInTransitTotal;
  final int outOfStockVariantCount;
  final List<PosReportCurrencyAmount> inventoryValue;
  final List<PosInventoryMovementVolume> movementVolume;
}

// --- Customers ---------------------------------------------------------------

/// Mirrors `CustomersReport` (`reports.types.ts`) exactly — no `branchId`:
/// `customers` carries no branch dimension in this schema.
class PosCustomersReport {
  const PosCustomersReport({
    required this.dateFrom,
    required this.dateTo,
    required this.totalCustomers,
    required this.customersByStatus,
    required this.newCustomersInRange,
    required this.membershipsByStatus,
    required this.newMembershipsInRange,
    required this.activeLoyaltyAccountCount,
  });

  factory PosCustomersReport.fromJson(Map<String, Object?> json) => PosCustomersReport(
    dateFrom: _string(json, 'date_from'),
    dateTo: _string(json, 'date_to'),
    totalCustomers: _int(json, 'total_customers'),
    customersByStatus: _statusList(json, 'customers_by_status'),
    newCustomersInRange: _int(json, 'new_customers_in_range'),
    membershipsByStatus: _statusList(json, 'memberships_by_status'),
    newMembershipsInRange: _int(json, 'new_memberships_in_range'),
    activeLoyaltyAccountCount: _int(json, 'active_loyalty_account_count'),
  );

  final String dateFrom;
  final String dateTo;
  final int totalCustomers;
  final List<PosReportStatusCount> customersByStatus;
  final int newCustomersInRange;
  final List<PosReportStatusCount> membershipsByStatus;
  final int newMembershipsInRange;
  final int activeLoyaltyAccountCount;
}

// --- Employees ---------------------------------------------------------------

/// Mirrors `EmployeesReport` (`reports.types.ts`) exactly.
class PosEmployeesReport {
  const PosEmployeesReport({
    required this.dateFrom,
    required this.dateTo,
    required this.branchId,
    required this.employeesByStatus,
    required this.clockInCount,
    required this.clockOutCount,
    required this.distinctEmployeesPunched,
    required this.closedPayrollTotals,
    required this.closedPayrollPeriodCount,
  });

  factory PosEmployeesReport.fromJson(Map<String, Object?> json) => PosEmployeesReport(
    dateFrom: _string(json, 'date_from'),
    dateTo: _string(json, 'date_to'),
    branchId: _stringOrNull(json, 'branch_id'),
    employeesByStatus: _statusList(json, 'employees_by_status'),
    clockInCount: _int(json, 'clock_in_count'),
    clockOutCount: _int(json, 'clock_out_count'),
    distinctEmployeesPunched: _int(json, 'distinct_employees_punched'),
    closedPayrollTotals: _amountList(json, 'closed_payroll_totals'),
    closedPayrollPeriodCount: _int(json, 'closed_payroll_period_count'),
  );

  final String dateFrom;
  final String dateTo;
  final String? branchId;
  final List<PosReportStatusCount> employeesByStatus;
  final int clockInCount;
  final int clockOutCount;
  final int distinctEmployeesPunched;
  final List<PosReportCurrencyAmount> closedPayrollTotals;
  final int closedPayrollPeriodCount;
}

// --- Parties ---------------------------------------------------------------

/// Mirrors `PartiesReport` (`reports.types.ts`) exactly.
class PosPartiesReport {
  const PosPartiesReport({
    required this.dateFrom,
    required this.dateTo,
    required this.branchId,
    required this.reservationsByStatus,
    required this.bookedRevenue,
    required this.collectedRevenue,
    required this.activeRoomCount,
    required this.roomsBookedCount,
  });

  factory PosPartiesReport.fromJson(Map<String, Object?> json) => PosPartiesReport(
    dateFrom: _string(json, 'date_from'),
    dateTo: _string(json, 'date_to'),
    branchId: _stringOrNull(json, 'branch_id'),
    reservationsByStatus: _statusList(json, 'reservations_by_status'),
    bookedRevenue: _amountList(json, 'booked_revenue'),
    collectedRevenue: _amountList(json, 'collected_revenue'),
    activeRoomCount: _int(json, 'active_room_count'),
    roomsBookedCount: _int(json, 'rooms_booked_count'),
  );

  final String dateFrom;
  final String dateTo;
  final String? branchId;
  final List<PosReportStatusCount> reservationsByStatus;
  final List<PosReportCurrencyAmount> bookedRevenue;
  final List<PosReportCurrencyAmount> collectedRevenue;
  final int activeRoomCount;
  final int roomsBookedCount;
}

// --- Access ---------------------------------------------------------------

/// Mirrors `AccessReport` (`reports.types.ts`) exactly.
class PosAccessReport {
  const PosAccessReport({
    required this.dateFrom,
    required this.dateTo,
    required this.branchId,
    required this.entryCount,
    required this.exitCount,
    required this.currentOccupancy,
    required this.averageStayMinutes,
  });

  factory PosAccessReport.fromJson(Map<String, Object?> json) => PosAccessReport(
    dateFrom: _string(json, 'date_from'),
    dateTo: _string(json, 'date_to'),
    branchId: _stringOrNull(json, 'branch_id'),
    entryCount: _int(json, 'entry_count'),
    exitCount: _int(json, 'exit_count'),
    currentOccupancy: _int(json, 'current_occupancy'),
    averageStayMinutes: _intOrNull(json, 'average_stay_minutes'),
  );

  final String dateFrom;
  final String dateTo;
  final String? branchId;
  final int entryCount;
  final int exitCount;
  final int currentOccupancy;
  // TASK 16.25 (Phase 12/Accesos) — `null` (never 0 or a fabricated
  // value) when zero completed entry→exit pairs exist in range. The
  // legacy's own equivalent (`prom_estancia`) was permanently hardcoded
  // to 95 — see `AccessReport.averageStayMinutes`'s own doc comment in
  // `reports.types.ts` for why this is a genuine replacement, not a
  // port of that fake value.
  final int? averageStayMinutes;
}

// --- Promotions --------------------------------------------------------------

/// TASK 14.5 (Wave 3, Phase 7, Item 4). Mirrors `TopCoupon`
/// (`reports.types.ts`) exactly.
class PosTopCoupon {
  const PosTopCoupon({required this.couponId, required this.code, required this.redemptionCount});

  factory PosTopCoupon.fromJson(Map<String, Object?> json) => PosTopCoupon(
    couponId: _string(json, 'coupon_id'),
    code: _string(json, 'code'),
    redemptionCount: _int(json, 'redemption_count'),
  );

  final String couponId;
  final String code;
  final int redemptionCount;
}

/// Mirrors `PromotionsReport` (`reports.types.ts`) exactly — the 8th real
/// report area, over the SAME real `coupon_redemptions`/`sale_discounts`
/// rows `PromotionsService` already writes at sale time. Never a
/// `promotion`/`coupon` figure blended with a `manual`/`reward` discount —
/// see that file's own doc comment.
class PosPromotionsReport {
  const PosPromotionsReport({
    required this.dateFrom,
    required this.dateTo,
    required this.branchId,
    required this.couponRedemptionCount,
    required this.couponRedemptionsTotal,
    required this.promotionDiscountCount,
    required this.promotionDiscountTotal,
    required this.couponDiscountCount,
    required this.couponDiscountTotal,
    required this.topCoupons,
  });

  factory PosPromotionsReport.fromJson(Map<String, Object?> json) => PosPromotionsReport(
    dateFrom: _string(json, 'date_from'),
    dateTo: _string(json, 'date_to'),
    branchId: _stringOrNull(json, 'branch_id'),
    couponRedemptionCount: _int(json, 'coupon_redemption_count'),
    couponRedemptionsTotal: _amountList(json, 'coupon_redemptions_total'),
    promotionDiscountCount: _int(json, 'promotion_discount_count'),
    promotionDiscountTotal: _amountList(json, 'promotion_discount_total'),
    couponDiscountCount: _int(json, 'coupon_discount_count'),
    couponDiscountTotal: _amountList(json, 'coupon_discount_total'),
    topCoupons: (json['top_coupons'] as List<Object?>? ?? const [])
        .whereType<Map<String, Object?>>()
        .map(PosTopCoupon.fromJson)
        .toList(growable: false),
  );

  final String dateFrom;
  final String dateTo;
  final String? branchId;
  final int couponRedemptionCount;
  final List<PosReportCurrencyAmount> couponRedemptionsTotal;
  final int promotionDiscountCount;
  final List<PosReportCurrencyAmount> promotionDiscountTotal;
  final int couponDiscountCount;
  final List<PosReportCurrencyAmount> couponDiscountTotal;
  final List<PosTopCoupon> topCoupons;
}

// --- Gateway ---------------------------------------------------------------

abstract interface class PosReportsGateway {
  /// `GET /api/v1/reports/sales`.
  Future<PosSalesReport> salesReport({required PosReportFilter filter});

  /// `GET /api/v1/reports/sales/export.csv` — the real underlying sale
  /// rows, never just the aggregate above. Returns the raw CSV body
  /// exactly as the backend sent it (see `SalesExportRow` in
  /// `reports.types.ts`) — this gateway never reshapes or re-encodes it.
  Future<String> exportSalesCsv({required PosReportFilter filter});

  /// `GET /api/v1/reports/financial`.
  Future<PosFinancialReport> financialReport({required PosReportFilter filter});

  /// `GET /api/v1/reports/financial/export.csv` — real underlying
  /// `cash_movements` rows (see `FinancialExportRow`).
  Future<String> exportFinancialCsv({required PosReportFilter filter});

  /// `GET /api/v1/reports/inventory`.
  Future<PosInventoryReport> inventoryReport({required PosReportFilter filter});

  /// `GET /api/v1/reports/inventory/kardex.csv` — TASK 14.5 (Wave 3, Phase
  /// 7, Item 2): real posted `inventory_movement_lines` rows, the honest
  /// CSV port of AS POS V1's real Kardex PDF export (see
  /// `reports.types.ts`'s own doc comment on `KardexExportRow` for why
  /// this is CSV, not PDF). `productVariantId`, when supplied, narrows to
  /// one product's own movement history — the classic single-product
  /// Kardex view.
  Future<String> exportKardexCsv({required PosReportFilter filter, String? productVariantId});

  /// `GET /api/v1/reports/promotions` — TASK 14.5 (Wave 3, Phase 7, Item
  /// 4): the 8th real report area.
  Future<PosPromotionsReport> promotionsReport({required PosReportFilter filter});

  /// `GET /api/v1/reports/customers` — company-scoped only, no `branch_id`
  /// (see `PosCustomersReport`'s own doc comment).
  Future<PosCustomersReport> customersReport({required PosReportDateRange range});

  /// `GET /api/v1/reports/employees`.
  Future<PosEmployeesReport> employeesReport({required PosReportFilter filter});

  /// `GET /api/v1/reports/parties`.
  Future<PosPartiesReport> partiesReport({required PosReportFilter filter});

  /// `GET /api/v1/reports/access`.
  Future<PosAccessReport> accessReport({required PosReportFilter filter});
}

Map<String, String> _filterQuery(PosReportFilter filter) => {
  'date_from': filter.dateFrom,
  'date_to': filter.dateTo,
  if (filter.branchId != null) 'branch_id': filter.branchId!,
};

class ApiPosReportsGateway implements PosReportsGateway {
  const ApiPosReportsGateway(this._client);

  final ApiClient _client;

  Future<Map<String, Object?>> _getReport(String path, Map<String, String> query) async {
    final uri = Uri(path: path, queryParameters: query);
    final envelope = await _client.getJson(uri.toString());
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing report data.');
    }
    return data;
  }

  @override
  Future<PosSalesReport> salesReport({required PosReportFilter filter}) async =>
      PosSalesReport.fromJson(await _getReport('/api/v1/reports/sales', _filterQuery(filter)));

  @override
  Future<String> exportSalesCsv({required PosReportFilter filter}) async {
    final uri = Uri(path: '/api/v1/reports/sales/export.csv', queryParameters: _filterQuery(filter));
    return _client.getText(uri.toString());
  }

  @override
  Future<PosFinancialReport> financialReport({required PosReportFilter filter}) async =>
      PosFinancialReport.fromJson(await _getReport('/api/v1/reports/financial', _filterQuery(filter)));

  @override
  Future<String> exportFinancialCsv({required PosReportFilter filter}) async {
    final uri = Uri(path: '/api/v1/reports/financial/export.csv', queryParameters: _filterQuery(filter));
    return _client.getText(uri.toString());
  }

  @override
  Future<PosInventoryReport> inventoryReport({required PosReportFilter filter}) async =>
      PosInventoryReport.fromJson(await _getReport('/api/v1/reports/inventory', _filterQuery(filter)));

  @override
  Future<String> exportKardexCsv({required PosReportFilter filter, String? productVariantId}) async {
    final query = {..._filterQuery(filter), if (productVariantId != null) 'product_variant_id': productVariantId};
    final uri = Uri(path: '/api/v1/reports/inventory/kardex.csv', queryParameters: query);
    return _client.getText(uri.toString());
  }

  @override
  Future<PosPromotionsReport> promotionsReport({required PosReportFilter filter}) async =>
      PosPromotionsReport.fromJson(await _getReport('/api/v1/reports/promotions', _filterQuery(filter)));

  @override
  Future<PosCustomersReport> customersReport({required PosReportDateRange range}) async => PosCustomersReport.fromJson(
    await _getReport('/api/v1/reports/customers', {'date_from': range.dateFrom, 'date_to': range.dateTo}),
  );

  @override
  Future<PosEmployeesReport> employeesReport({required PosReportFilter filter}) async =>
      PosEmployeesReport.fromJson(await _getReport('/api/v1/reports/employees', _filterQuery(filter)));

  @override
  Future<PosPartiesReport> partiesReport({required PosReportFilter filter}) async =>
      PosPartiesReport.fromJson(await _getReport('/api/v1/reports/parties', _filterQuery(filter)));

  @override
  Future<PosAccessReport> accessReport({required PosReportFilter filter}) async =>
      PosAccessReport.fromJson(await _getReport('/api/v1/reports/access', _filterQuery(filter)));
}

class EmptyPosReportsGateway implements PosReportsGateway {
  const EmptyPosReportsGateway();

  @override
  Future<PosSalesReport> salesReport({required PosReportFilter filter}) =>
      Future.error(StateError('No reports gateway is configured.'));

  @override
  Future<String> exportSalesCsv({required PosReportFilter filter}) =>
      Future.error(StateError('No reports gateway is configured.'));

  @override
  Future<PosFinancialReport> financialReport({required PosReportFilter filter}) =>
      Future.error(StateError('No reports gateway is configured.'));

  @override
  Future<String> exportFinancialCsv({required PosReportFilter filter}) =>
      Future.error(StateError('No reports gateway is configured.'));

  @override
  Future<PosInventoryReport> inventoryReport({required PosReportFilter filter}) =>
      Future.error(StateError('No reports gateway is configured.'));

  @override
  Future<String> exportKardexCsv({required PosReportFilter filter, String? productVariantId}) =>
      Future.error(StateError('No reports gateway is configured.'));

  @override
  Future<PosPromotionsReport> promotionsReport({required PosReportFilter filter}) =>
      Future.error(StateError('No reports gateway is configured.'));

  @override
  Future<PosCustomersReport> customersReport({required PosReportDateRange range}) =>
      Future.error(StateError('No reports gateway is configured.'));

  @override
  Future<PosEmployeesReport> employeesReport({required PosReportFilter filter}) =>
      Future.error(StateError('No reports gateway is configured.'));

  @override
  Future<PosPartiesReport> partiesReport({required PosReportFilter filter}) =>
      Future.error(StateError('No reports gateway is configured.'));

  @override
  Future<PosAccessReport> accessReport({required PosReportFilter filter}) =>
      Future.error(StateError('No reports gateway is configured.'));
}
