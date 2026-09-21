/// TASK 16.15 — the Flutter side of `branch-consolidation.routes.ts`
/// (`GET /api/v1/branches/{id}/consolidation?date=YYYY-MM-DD`), gated by
/// `branch_consolidation.read` AND branch access. Read-only: this whole
/// file exposes exactly one call, never a mutation — see
/// `pos_branch_consolidation_screen.dart` for the one real caller,
/// "Consolidado de sucursal".
///
/// Every field here is exactly what the backend returns — nothing is
/// recomputed or guessed client-side, mirroring `pos_cash_gateway.dart`'s
/// own long-standing "Flutter displays the backend result only" rule
/// (ADR-0014 Part H/I). In particular [PosBranchConsolidationTotals.
/// discrepantRegisterCount]/[cardPendingOrDiscrepantRegisterCount] must
/// stay visible in any UI built over this data even when the branch-wide
/// `cash_difference_total` reads exactly `0.00` — two registers can
/// individually be `+$X` and `-$X` and net to zero, and the backend's own
/// per-register counts are the only honest way to catch that (see the
/// route's own doc comment on `branch-consolidation.routes.ts`).
///
/// Reuses [PosCashPaymentMethodTotal]/[PosCashCardReconciliation]
/// (`pos_cash_gateway.dart`) verbatim — the backend's own
/// `paymentMethodTotalsHttp`/`cardReconciliationHttp` helpers in
/// `branch-consolidation.routes.ts` produce the exact same wire shape
/// `cash.routes.ts` already does for a single session, so decoding them a
/// second time here would be a duplicate, divergence-prone copy.
library;

import '../../core/networking/api_client.dart';
import 'pos_cash_gateway.dart';

/// `no_session` (the register had no activity today — never conflate this
/// with `closed`), `open`, `closing`, `closed` — mirrors
/// `branch-consolidation.routes.ts`'s own `status` union exactly.
enum PosBranchConsolidationRegisterStatus { noSession, open, closing, closed, unknown }

PosBranchConsolidationRegisterStatus _registerStatus(String value) => switch (value) {
  'no_session' => PosBranchConsolidationRegisterStatus.noSession,
  'open' => PosBranchConsolidationRegisterStatus.open,
  'closing' => PosBranchConsolidationRegisterStatus.closing,
  'closed' => PosBranchConsolidationRegisterStatus.closed,
  _ => PosBranchConsolidationRegisterStatus.unknown,
};

/// One `registers[]` row of the consolidation response — a single cash
/// register's own day-so-far snapshot.
class PosBranchConsolidationRegister {
  const PosBranchConsolidationRegister({
    required this.registerId,
    required this.registerCode,
    required this.registerName,
    required this.operationalAreaId,
    required this.status,
    required this.cashSessionId,
    required this.openedAt,
    required this.closedAt,
    required this.openingAmount,
    required this.cashSalesTotal,
    required this.cashInTotal,
    required this.cashOutTotal,
    required this.expectedCash,
    required this.countedCash,
    required this.discrepancyAmount,
    required this.paymentMethodTotals,
    required this.cardReconciliation,
  });

  factory PosBranchConsolidationRegister.fromJson(Map<String, Object?> json) {
    final rawPaymentMethods = json['payment_method_totals'];
    final rawCardReconciliation = json['card_reconciliation'];
    return PosBranchConsolidationRegister(
      registerId: json['register_id']! as String,
      registerCode: json['register_code']! as String,
      registerName: json['register_name']! as String,
      operationalAreaId: json['operational_area_id'] as String?,
      status: _registerStatus(json['status']! as String),
      cashSessionId: json['cash_session_id'] as String?,
      openedAt: json['opened_at'] as String?,
      closedAt: json['closed_at'] as String?,
      openingAmount: json['opening_amount'] as String?,
      cashSalesTotal: json['cash_sales_total'] as String?,
      cashInTotal: json['cash_in_total'] as String?,
      cashOutTotal: json['cash_out_total'] as String?,
      expectedCash: json['expected_cash'] as String?,
      countedCash: json['counted_cash'] as String?,
      discrepancyAmount: json['discrepancy_amount'] as String?,
      paymentMethodTotals: rawPaymentMethods is List<Object?>
          ? rawPaymentMethods
                .whereType<Map<String, Object?>>()
                .map(PosCashPaymentMethodTotal.fromJson)
                .toList(growable: false)
          : const [],
      cardReconciliation: rawCardReconciliation is Map<String, Object?>
          ? PosCashCardReconciliation.fromJson(rawCardReconciliation)
          : null,
    );
  }

  final String registerId;
  final String registerCode;
  final String registerName;

  /// `null` — "Sin área": a genuine, fully-functional unassigned state,
  /// never a reason to fabricate a fake area name.
  final String? operationalAreaId;
  final PosBranchConsolidationRegisterStatus status;
  final String? cashSessionId;
  final String? openedAt;
  final String? closedAt;
  final String? openingAmount;
  final String? cashSalesTotal;
  final String? cashInTotal;
  final String? cashOutTotal;
  final String? expectedCash;

  /// `null` while [status] is `open`/`closing` — only ever set once the
  /// register has actually closed.
  final String? countedCash;

  /// `null` while [status] is `open`/`closing`, for the same reason as
  /// [countedCash].
  final String? discrepancyAmount;
  final List<PosCashPaymentMethodTotal> paymentMethodTotals;

  /// `null` while [status] is `open`/`closing`.
  final PosCashCardReconciliation? cardReconciliation;

  /// A non-`null`, non-zero [discrepancyAmount] — the per-register signal
  /// a branch-wide net-zero total can otherwise hide. Never used as the
  /// SOLE source of truth (the backend's own
  /// [PosBranchConsolidationTotals.discrepantRegisterCount] is
  /// authoritative); provided here only so a register row can highlight
  /// itself consistently with that count.
  bool get hasCashDiscrepancy {
    final amount = discrepancyAmount;
    return amount != null && amount.trim() != '0' && amount.trim() != '0.00' && amount.trim() != '-0.00';
  }
}

/// One `areas[]` row — a branch-wide roll-up of every register sharing one
/// operational area (or the `null`/"Sin área" group).
class PosBranchConsolidationAreaSummary {
  const PosBranchConsolidationAreaSummary({
    required this.operationalAreaId,
    required this.operationalAreaName,
    required this.cashSalesTotal,
    required this.registerCount,
  });

  factory PosBranchConsolidationAreaSummary.fromJson(Map<String, Object?> json) => PosBranchConsolidationAreaSummary(
    operationalAreaId: json['operational_area_id'] as String?,
    operationalAreaName: json['operational_area_name'] as String?,
    cashSalesTotal: json['cash_sales_total']! as String,
    registerCount: json['register_count']! as int,
  );

  /// `null` — the "Sin área" group (every register with no operational
  /// area assigned).
  final String? operationalAreaId;

  /// Operator-entered — `null` only alongside a `null` [operationalAreaId]
  /// ("Sin área"). Never hardcode a specific area name anywhere this is
  /// displayed.
  final String? operationalAreaName;
  final String cashSalesTotal;
  final int registerCount;
}

/// The `totals` object — branch-wide sums AND the per-register-outcome
/// counts a caller must surface prominently (see this file's own header
/// doc comment on why a net-zero [cashDifferenceTotal] is not, by itself,
/// evidence that nothing needs attention).
class PosBranchConsolidationTotals {
  const PosBranchConsolidationTotals({
    required this.cashOpeningTotal,
    required this.cashSalesTotal,
    required this.cashInTotal,
    required this.cashOutTotal,
    required this.expectedCashTotal,
    required this.countedCashTotal,
    required this.cashDifferenceTotal,
    required this.paymentMethodTotals,
    required this.cardSystemNetTotal,
    required this.cardTerminalTotal,
    required this.cardDifferenceTotal,
    required this.openRegisterCount,
    required this.closingRegisterCount,
    required this.closedRegisterCount,
    required this.noSessionRegisterCount,
    required this.discrepantRegisterCount,
    required this.cardPendingOrDiscrepantRegisterCount,
  });

  factory PosBranchConsolidationTotals.fromJson(Map<String, Object?> json) {
    final rawPaymentMethods = json['payment_method_totals'];
    return PosBranchConsolidationTotals(
      cashOpeningTotal: json['cash_opening_total']! as String,
      cashSalesTotal: json['cash_sales_total']! as String,
      cashInTotal: json['cash_in_total']! as String,
      cashOutTotal: json['cash_out_total']! as String,
      expectedCashTotal: json['expected_cash_total']! as String,
      countedCashTotal: json['counted_cash_total']! as String,
      cashDifferenceTotal: json['cash_difference_total']! as String,
      paymentMethodTotals: rawPaymentMethods is List<Object?>
          ? rawPaymentMethods
                .whereType<Map<String, Object?>>()
                .map(PosCashPaymentMethodTotal.fromJson)
                .toList(growable: false)
          : const [],
      cardSystemNetTotal: json['card_system_net_total']! as String,
      cardTerminalTotal: json['card_terminal_total']! as String,
      cardDifferenceTotal: json['card_difference_total']! as String,
      openRegisterCount: json['open_register_count']! as int,
      closingRegisterCount: json['closing_register_count']! as int,
      closedRegisterCount: json['closed_register_count']! as int,
      noSessionRegisterCount: json['no_session_register_count']! as int,
      discrepantRegisterCount: json['discrepant_register_count']! as int,
      cardPendingOrDiscrepantRegisterCount: json['card_pending_or_discrepant_register_count']! as int,
    );
  }

  final String cashOpeningTotal;
  final String cashSalesTotal;
  final String cashInTotal;
  final String cashOutTotal;
  final String expectedCashTotal;
  final String countedCashTotal;
  final String cashDifferenceTotal;
  final List<PosCashPaymentMethodTotal> paymentMethodTotals;
  final String cardSystemNetTotal;
  final String cardTerminalTotal;
  final String cardDifferenceTotal;
  final int openRegisterCount;
  final int closingRegisterCount;
  final int closedRegisterCount;
  final int noSessionRegisterCount;

  /// A closed register whose own `discrepancy_amount` is non-zero. THE
  /// key figure that must stay visible regardless of what
  /// [cashDifferenceTotal] reads — see this file's own header doc comment.
  final int discrepantRegisterCount;

  /// A register whose card reconciliation is `pending` (card sales exist,
  /// operator never reconciled) or `discrepancy` — the card-side
  /// equivalent of [discrepantRegisterCount].
  final int cardPendingOrDiscrepantRegisterCount;

  /// `true` whenever ANY register needs attention, independent of whatever
  /// [cashDifferenceTotal]/[cardDifferenceTotal] read at the branch level —
  /// the one boolean a summary header should gate itself on.
  bool get hasAnyDiscrepancy => discrepantRegisterCount > 0 || cardPendingOrDiscrepantRegisterCount > 0;
}

/// The full `GET /branches/{id}/consolidation` response.
class PosBranchConsolidationResult {
  const PosBranchConsolidationResult({
    required this.branchId,
    required this.businessDate,
    required this.windowStart,
    required this.windowEnd,
    required this.registers,
    required this.areas,
    required this.totals,
  });

  factory PosBranchConsolidationResult.fromJson(Map<String, Object?> json) {
    final rawRegisters = json['registers'];
    final rawAreas = json['areas'];
    final rawTotals = json['totals'];
    if (rawTotals is! Map<String, Object?>) {
      throw const FormatException('Missing branch consolidation totals.');
    }
    return PosBranchConsolidationResult(
      branchId: json['branch_id']! as String,
      businessDate: json['business_date']! as String,
      windowStart: json['window_start']! as String,
      windowEnd: json['window_end']! as String,
      registers: rawRegisters is List<Object?>
          ? rawRegisters
                .whereType<Map<String, Object?>>()
                .map(PosBranchConsolidationRegister.fromJson)
                .toList(growable: false)
          : const [],
      areas: rawAreas is List<Object?>
          ? rawAreas
                .whereType<Map<String, Object?>>()
                .map(PosBranchConsolidationAreaSummary.fromJson)
                .toList(growable: false)
          : const [],
      totals: PosBranchConsolidationTotals.fromJson(rawTotals),
    );
  }

  final String branchId;
  final String businessDate;
  final String windowStart;
  final String windowEnd;
  final List<PosBranchConsolidationRegister> registers;
  final List<PosBranchConsolidationAreaSummary> areas;
  final PosBranchConsolidationTotals totals;
}

abstract interface class PosBranchConsolidationGateway {
  /// `GET /api/v1/branches/{branchId}/consolidation?date=YYYY-MM-DD`
  /// (`branch_consolidation.read` + branch access) — [date] omitted
  /// defaults to the branch-local "today" server-side, exactly like the
  /// backend route's own optional querystring. Read-only.
  Future<PosBranchConsolidationResult> consolidation(String branchId, {String? date});
}

class ApiPosBranchConsolidationGateway implements PosBranchConsolidationGateway {
  const ApiPosBranchConsolidationGateway(this._client);

  final ApiClient _client;

  @override
  Future<PosBranchConsolidationResult> consolidation(String branchId, {String? date}) async {
    final query = <String, String>{if (date != null) 'date': date};
    final path = Uri(path: '/api/v1/branches/$branchId/consolidation', queryParameters: query).toString();
    final envelope = await _client.getJson(path);
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing branch consolidation data.');
    }
    return PosBranchConsolidationResult.fromJson(data);
  }
}

class EmptyPosBranchConsolidationGateway implements PosBranchConsolidationGateway {
  const EmptyPosBranchConsolidationGateway();

  @override
  Future<PosBranchConsolidationResult> consolidation(String branchId, {String? date}) =>
      Future.error(StateError('No branch consolidation gateway is configured.'));
}
