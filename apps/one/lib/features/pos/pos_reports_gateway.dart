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

// --- Sales ---------------------------------------------------------------

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
  );

  final String dateFrom;
  final String dateTo;
  final String? branchId;
  final List<PosCashMovementTotal> movementTotals;
  final List<PosReportCurrencyAmount> netCashMovement;
  final List<PosClosedSessionTotal> closedSessions;
  final int sessionsOpenedCount;
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
  });

  factory PosAccessReport.fromJson(Map<String, Object?> json) => PosAccessReport(
    dateFrom: _string(json, 'date_from'),
    dateTo: _string(json, 'date_to'),
    branchId: _stringOrNull(json, 'branch_id'),
    entryCount: _int(json, 'entry_count'),
    exitCount: _int(json, 'exit_count'),
    currentOccupancy: _int(json, 'current_occupancy'),
  );

  final String dateFrom;
  final String dateTo;
  final String? branchId;
  final int entryCount;
  final int exitCount;
  final int currentOccupancy;
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
