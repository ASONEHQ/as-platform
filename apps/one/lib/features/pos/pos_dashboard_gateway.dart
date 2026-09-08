/// TASK 14.5 (Wave 3, Phase 2): the Flutter side of `dashboard.routes.ts`
/// — "Dashboard" (today at a glance). Mirrors `pos_reports_gateway.dart`'s
/// own established three-class shape exactly (abstract interface /
/// `Api...` / `Empty...`). Every field name below is copied verbatim from
/// `dashboard.routes.ts`'s own `summaryHttp(...)` mapper in
/// `apps/api/src/modules/dashboard/dashboard.routes.ts` — never guessed.
///
/// This file is deliberately self-contained (its own
/// `PosDashboardCurrencyAmount`, not a cross-import of
/// `pos_reports_gateway.dart`'s `PosReportCurrencyAmount`) — matches every
/// other `pos_*_gateway.dart` file's own convention of not depending on a
/// sibling gateway file.
library;

import '../../core/networking/api_client.dart';

/// Mirrors the backend's `CurrencyAmount` shape (`{currency_code, amount}`)
/// — `amount` stays the raw ADR-0001 decimal-string the backend sent; a
/// caller that wants to render it formats it with
/// `Money.parse(amount, currencyCode)`, never a re-parsed `double`.
class PosDashboardCurrencyAmount {
  const PosDashboardCurrencyAmount({required this.currencyCode, required this.amount});

  factory PosDashboardCurrencyAmount.fromJson(Map<String, Object?> json) => PosDashboardCurrencyAmount(
    currencyCode: json['currency_code']! as String,
    amount: json['amount']! as String,
  );

  final String currencyCode;
  final String amount;
}

class PosDashboardPartyReservation {
  const PosDashboardPartyReservation({
    required this.id,
    required this.roomId,
    required this.roomName,
    required this.customerDisplayName,
    required this.celebrantName,
    required this.startTime,
    required this.endTime,
    required this.status,
  });

  factory PosDashboardPartyReservation.fromJson(Map<String, Object?> json) => PosDashboardPartyReservation(
    id: json['id']! as String,
    roomId: json['room_id']! as String,
    roomName: json['room_name'] as String?,
    customerDisplayName: json['customer_display_name'] as String?,
    celebrantName: json['celebrant_name'] as String?,
    startTime: json['start_time']! as String,
    endTime: json['end_time']! as String,
    status: json['status']! as String,
  );

  final String id;
  final String roomId;
  final String? roomName;
  final String? customerDisplayName;
  final String? celebrantName;
  final String startTime;
  final String endTime;
  final String status;
}

class PosDashboardOpenCashSession {
  const PosDashboardOpenCashSession({
    required this.cashSessionId,
    required this.cashRegisterId,
    required this.cashRegisterName,
    required this.cashRegisterCode,
    required this.branchId,
    required this.openedAt,
    required this.openingAmount,
    required this.currencyCode,
  });

  factory PosDashboardOpenCashSession.fromJson(Map<String, Object?> json) => PosDashboardOpenCashSession(
    cashSessionId: json['cash_session_id']! as String,
    cashRegisterId: json['cash_register_id']! as String,
    cashRegisterName: json['cash_register_name'] as String?,
    cashRegisterCode: json['cash_register_code'] as String?,
    branchId: json['branch_id']! as String,
    openedAt: DateTime.parse(json['opened_at']! as String),
    openingAmount: json['opening_amount']! as String,
    currencyCode: json['currency_code']! as String,
  );

  final String cashSessionId;
  final String cashRegisterId;
  final String? cashRegisterName;
  final String? cashRegisterCode;
  final String branchId;
  final DateTime openedAt;
  final String openingAmount;
  final String currencyCode;
}

/// Mirrors `DashboardSummary`'s own HTTP shape (`dashboard.routes.ts`'s
/// `summaryHttp`) exactly. Every figure here is a real, already-computed
/// backend value — this class never derives a percentage, trend, or
/// alert the JSON did not itself carry.
class PosDashboardSummary {
  const PosDashboardSummary({
    required this.date,
    required this.branchId,
    required this.salesTransactionCount,
    required this.salesGrossTotal,
    required this.currentOccupancy,
    required this.partyReservationCount,
    required this.partyReservations,
    required this.openCashSessionCount,
    required this.openCashSessions,
    required this.outstandingPartyBalances,
    required this.clockedInEmployeeCount,
    required this.outOfStockVariantCount,
  });

  factory PosDashboardSummary.fromJson(Map<String, Object?> json) {
    final sales = json['sales']! as Map<String, Object?>;
    final occupancy = json['occupancy']! as Map<String, Object?>;
    final parties = json['parties']! as Map<String, Object?>;
    final cashSessions = json['cash_sessions']! as Map<String, Object?>;
    final attendance = json['employee_attendance']! as Map<String, Object?>;
    final inventoryAlerts = json['inventory_alerts']! as Map<String, Object?>;
    return PosDashboardSummary(
      date: json['date']! as String,
      branchId: json['branch_id'] as String?,
      salesTransactionCount: (sales['transaction_count']! as num).toInt(),
      salesGrossTotal: (sales['gross_total'] as List<Object?>? ?? const [])
          .whereType<Map<String, Object?>>()
          .map(PosDashboardCurrencyAmount.fromJson)
          .toList(growable: false),
      currentOccupancy: (occupancy['current_occupancy']! as num).toInt(),
      partyReservationCount: (parties['count']! as num).toInt(),
      partyReservations: (parties['reservations'] as List<Object?>? ?? const [])
          .whereType<Map<String, Object?>>()
          .map(PosDashboardPartyReservation.fromJson)
          .toList(growable: false),
      openCashSessionCount: (cashSessions['open_count']! as num).toInt(),
      openCashSessions: (cashSessions['sessions'] as List<Object?>? ?? const [])
          .whereType<Map<String, Object?>>()
          .map(PosDashboardOpenCashSession.fromJson)
          .toList(growable: false),
      outstandingPartyBalances: (json['outstanding_party_balances'] as List<Object?>? ?? const [])
          .whereType<Map<String, Object?>>()
          .map(PosDashboardCurrencyAmount.fromJson)
          .toList(growable: false),
      clockedInEmployeeCount: (attendance['clocked_in_count']! as num).toInt(),
      outOfStockVariantCount: (inventoryAlerts['out_of_stock_variant_count']! as num).toInt(),
    );
  }

  final String date;
  final String? branchId;
  final int salesTransactionCount;
  final List<PosDashboardCurrencyAmount> salesGrossTotal;
  final int currentOccupancy;
  final int partyReservationCount;
  final List<PosDashboardPartyReservation> partyReservations;
  final int openCashSessionCount;
  final List<PosDashboardOpenCashSession> openCashSessions;
  final List<PosDashboardCurrencyAmount> outstandingPartyBalances;
  final int clockedInEmployeeCount;
  final int outOfStockVariantCount;
}

// --- Gateway ---------------------------------------------------------------

abstract interface class PosDashboardGateway {
  /// `GET /api/v1/dashboard/summary`. [date] is required ('YYYY-MM-DD') —
  /// no call here ever silently defaults to "today" server-side; the
  /// caller always resolves and passes its own "today" (see
  /// `_Dashboard`'s own doc comment in `pos_shell.dart`).
  Future<PosDashboardSummary> summary({required String date, String? branchId});
}

class ApiPosDashboardGateway implements PosDashboardGateway {
  const ApiPosDashboardGateway(this._client);

  final ApiClient _client;

  @override
  Future<PosDashboardSummary> summary({required String date, String? branchId}) async {
    final uri = Uri(
      path: '/api/v1/dashboard/summary',
      queryParameters: {'date': date, if (branchId != null) 'branch_id': branchId},
    );
    final envelope = await _client.getJson(uri.toString());
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing dashboard summary data.');
    }
    return PosDashboardSummary.fromJson(data);
  }
}

class EmptyPosDashboardGateway implements PosDashboardGateway {
  const EmptyPosDashboardGateway();

  @override
  Future<PosDashboardSummary> summary({required String date, String? branchId}) =>
      Future.error(StateError('No dashboard gateway is configured.'));
}
