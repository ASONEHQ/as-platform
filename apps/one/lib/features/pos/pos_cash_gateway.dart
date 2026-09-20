import '../../core/networking/api_client.dart';

/// TASK 12.7: the Flutter side of E038–E048 — see ADR-0014 for the full
/// backend design this mirrors. Every model here is exactly what the
/// backend returns; nothing is recomputed or guessed client-side (Part H/I:
/// "Flutter displays the backend result only", "backend computes the
/// difference").

/// A `cash_registers` row — the physical drawer, independent of any one
/// cashier or session (see ADR-0014 §B1).
class PosCashRegister {
  const PosCashRegister({
    required this.id,
    required this.branchId,
    required this.code,
    required this.name,
    required this.status,
  });

  factory PosCashRegister.fromJson(Map<String, Object?> json) =>
      PosCashRegister(
        id: json['id']! as String,
        branchId: json['branch_id']! as String,
        code: json['code']! as String,
        name: json['name']! as String,
        status: json['status']! as String,
      );

  final String id;
  final String branchId;
  final String code;
  final String name;
  final String status;
}

/// Part J — one bills/coins line from the AS POS V1-canonical close-drawer
/// count. `value` is the exact ADR-0001 decimal-string wire format.
class PosCashDenominationCount {
  const PosCashDenominationCount({required this.value, required this.quantity});

  factory PosCashDenominationCount.fromJson(Map<String, Object?> json) =>
      PosCashDenominationCount(
        value: json['value']! as String,
        quantity: json['quantity']! as int,
      );

  final String value;
  final int quantity;

  Map<String, Object?> toJson() => {'value': value, 'quantity': quantity};
}

/// A `cash_sessions` row — the exact 3-state machine (§21.1: `open` |
/// `closing` | `closed`) ADR-0014 §B2 implements. `closing` is real in the
/// contract but this backend's own close command completes it
/// instantaneously, so Flutter should never expect to observe it at rest.
class PosCashSession {
  const PosCashSession({
    required this.id,
    required this.branchId,
    required this.cashRegisterId,
    required this.openedBy,
    required this.openedAt,
    required this.openingAmount,
    required this.currencyCode,
    required this.status,
    this.closedBy,
    this.closedAt,
    this.declaredClosingAmount,
    this.expectedClosingAmount,
    this.discrepancyAmount,
    this.denominationCounts,
  });

  factory PosCashSession.fromJson(Map<String, Object?> json) {
    final rawDenominations = json['denomination_counts'];
    return PosCashSession(
      id: json['id']! as String,
      branchId: json['branch_id']! as String,
      cashRegisterId: json['cash_register_id']! as String,
      openedBy: json['opened_by']! as String,
      openedAt: DateTime.parse(json['opened_at']! as String),
      openingAmount: json['opening_amount']! as String,
      currencyCode: json['currency_code']! as String,
      status: json['status']! as String,
      closedBy: json['closed_by'] as String?,
      closedAt: json['closed_at'] == null
          ? null
          : DateTime.parse(json['closed_at']! as String),
      declaredClosingAmount: json['declared_closing_amount'] as String?,
      expectedClosingAmount: json['expected_closing_amount'] as String?,
      discrepancyAmount: json['discrepancy_amount'] as String?,
      denominationCounts: rawDenominations is List<Object?>
          ? rawDenominations
                .whereType<Map<String, Object?>>()
                .map(PosCashDenominationCount.fromJson)
                .toList(growable: false)
          : null,
    );
  }

  final String id;
  final String branchId;
  final String cashRegisterId;
  final String openedBy;
  final DateTime openedAt;
  final String openingAmount;
  final String currencyCode;
  final String status;
  final String? closedBy;
  final DateTime? closedAt;
  final String? declaredClosingAmount;
  final String? expectedClosingAmount;
  final String? discrepancyAmount;
  final List<PosCashDenominationCount>? denominationCounts;

  bool get isOpen => status == 'open';
  bool get isClosed => status == 'closed';
}

/// TASK 14.4 (Wave 2, Part F.1) — the exact category set
/// `cash.types.ts`'s own `cashMovementCategories` defines, only ever
/// meaningful on a client-postable `cash_in`/`cash_out` movement.
const List<String> posCashMovementCategories = [
  'withdrawal',
  'expense',
  'external_income',
  'other',
];

/// The exact direction each category is valid for — mirrors
/// `cash.types.ts`'s own `cashMovementCategoryDirection` table verbatim
/// (`null` means "either direction", i.e. `other`) so the UI never even
/// offers an invalid movement-type/category combination.
const Map<String, String?> posCashMovementCategoryDirection = {
  'withdrawal': 'cash_out',
  'expense': 'cash_out',
  'external_income': 'cash_in',
  'other': null,
};

/// One `cash_movements` row (E046).
class PosCashMovement {
  const PosCashMovement({
    required this.id,
    required this.cashSessionId,
    required this.movementType,
    required this.amount,
    required this.currencyCode,
    required this.reasonCode,
    this.note,
    required this.occurredAt,
    required this.createdBy,
    this.category,
    this.reversalOfId,
  });

  factory PosCashMovement.fromJson(Map<String, Object?> json) =>
      PosCashMovement(
        id: json['id']! as String,
        cashSessionId: json['cash_session_id']! as String,
        movementType: json['movement_type']! as String,
        amount: json['amount']! as String,
        currencyCode: json['currency_code']! as String,
        reasonCode: json['reason_code']! as String,
        note: json['note'] as String?,
        occurredAt: DateTime.parse(json['occurred_at']! as String),
        createdBy: json['created_by']! as String,
        // TASK 14.4 (Wave 2, Part F.1) — orthogonal to movement_type; null
        // for system-posted movements and any uncategorized cash_in/cash_out.
        category: json['category'] as String?,
        // TASK 16.11 (§6) — set only on a compensating movement created by
        // `PosCashGateway.reverseMovement`; null for every other row.
        reversalOfId: json['reversal_of_id'] as String?,
      );

  final String id;
  final String cashSessionId;
  final String movementType;
  final String amount;
  final String currencyCode;
  final String reasonCode;
  final String? note;
  final DateTime occurredAt;
  final String createdBy;
  final String? category;
  final String? reversalOfId;
}

/// TASK 16.11 (§13) — "Bitácora": one real `audit_log` row, read-only,
/// scoped to a single cash session's own lifecycle.
class PosCashAuditEntry {
  const PosCashAuditEntry({
    required this.id,
    required this.actorType,
    this.actorId,
    required this.action,
    required this.entityType,
    this.entityId,
    required this.metadata,
    required this.occurredAt,
  });

  factory PosCashAuditEntry.fromJson(Map<String, Object?> json) {
    final rawMetadata = json['metadata'];
    return PosCashAuditEntry(
      id: json['id']! as String,
      actorType: json['actor_type']! as String,
      actorId: json['actor_id'] as String?,
      action: json['action']! as String,
      entityType: json['entity_type']! as String,
      entityId: json['entity_id'] as String?,
      metadata: rawMetadata is Map<String, Object?>
          ? rawMetadata
          : const <String, Object?>{},
      occurredAt: DateTime.parse(json['occurred_at']! as String),
    );
  }

  final String id;
  final String actorType;
  final String? actorId;
  final String action;
  final String entityType;
  final String? entityId;
  final Map<String, Object?> metadata;
  final DateTime occurredAt;
}

/// E048 — the cash-cut summary (Part K). Every total here comes straight
/// from the backend's own ledger fold (ADR-0014 §B4): never mixes a card
/// total into `expectedCash`, never recomputed by summing `sales`.
class PosCashSessionSummary {
  const PosCashSessionSummary({
    required this.session,
    required this.openingAmount,
    required this.cashSalesTotal,
    required this.cashSalesCount,
    required this.cashInTotal,
    required this.cashOutTotal,
    required this.expectedCash,
    required this.withdrawalTotal,
    required this.expenseTotal,
    required this.externalIncomeTotal,
  });

  factory PosCashSessionSummary.fromJson(Map<String, Object?> json) {
    final rawSession = json['session'];
    return PosCashSessionSummary(
      session: PosCashSession.fromJson(
        rawSession is Map<String, Object?>
            ? rawSession
            : const <String, Object?>{},
      ),
      openingAmount: json['opening_amount']! as String,
      cashSalesTotal: json['cash_sales_total']! as String,
      cashSalesCount: json['cash_sales_count']! as int,
      cashInTotal: json['cash_in_total']! as String,
      cashOutTotal: json['cash_out_total']! as String,
      expectedCash: json['expected_cash']! as String,
      // TASK 14.4 (Wave 2, Part F.2) — new named breakdowns, each a strict
      // subset already folded into cash_in_total/cash_out_total above;
      // never a second, separately-authoritative total.
      // TASK 15.0 (Phase 12, RC certification): a real backend was
      // observed answering `.../summary` 200 OK WITHOUT these three
      // fields (older deployment/process predating their addition) —
      // that must never take down the entire Corte de Caja screen (which
      // also carries the session, opening amount and expected cash a
      // cashier needs to close a real drawer). This is a narrow recovery
      // fix per `docs/RC_FREEZE_POLICY.md`: tolerate their absence with
      // the same "no movement of that kind yet" zero every other total
      // here already uses, never a silent guess at a nonzero figure.
      withdrawalTotal: json['withdrawal_total'] as String? ?? '0.0000',
      expenseTotal: json['expense_total'] as String? ?? '0.0000',
      externalIncomeTotal: json['external_income_total'] as String? ?? '0.0000',
    );
  }

  final PosCashSession session;
  final String openingAmount;
  final String cashSalesTotal;
  final int cashSalesCount;
  final String cashInTotal;
  final String cashOutTotal;
  final String expectedCash;
  final String withdrawalTotal;
  final String expenseTotal;
  final String externalIncomeTotal;
}

/// TASK 16.13 — "Ventas / Taquilla" within a partial cut's operational
/// summary. Mirrors `cash.types.ts`'s `CashPartialCloseOperationalSummary
/// ['pos']` field for field.
class PosCashOperationalPosSummary {
  const PosCashOperationalPosSummary({
    required this.grossSales,
    required this.refundsTotal,
    required this.netSales,
    required this.ticketCount,
  });

  factory PosCashOperationalPosSummary.fromJson(Map<String, Object?> json) =>
      PosCashOperationalPosSummary(
        grossSales: json['gross_sales']! as String,
        refundsTotal: json['refunds_total']! as String,
        netSales: json['net_sales']! as String,
        ticketCount: json['ticket_count']! as int,
      );

  final String grossSales;
  final String refundsTotal;
  final String netSales;
  final int ticketCount;
}

/// TASK 16.13 — "Cafetería / Snacks": an authoritatively-classified SUBSET
/// of [PosCashOperationalPosSummary.netSales], never additive on top of
/// it. [available] is `false` when the tenant has no
/// `product_categories.operational_group = 'cafeteria'` category at all —
/// the UI must show "no configurado", never a misleading `$0`.
class PosCashOperationalCafeteriaSummary {
  const PosCashOperationalCafeteriaSummary({
    required this.available,
    required this.grossSales,
    required this.refundsTotal,
    required this.netSales,
    required this.ticketCount,
    required this.unitsSold,
  });

  factory PosCashOperationalCafeteriaSummary.fromJson(Map<String, Object?> json) =>
      PosCashOperationalCafeteriaSummary(
        available: json['available']! as bool,
        grossSales: json['gross_sales']! as String,
        refundsTotal: json['refunds_total']! as String,
        netSales: json['net_sales']! as String,
        ticketCount: json['ticket_count']! as int,
        unitsSold: json['units_sold']! as String,
      );

  final bool available;
  final String grossSales;
  final String refundsTotal;
  final String netSales;
  final int ticketCount;
  final String unitsSold;
}

/// TASK 16.13 — "Eventos / Fiestas": genuinely independent of `pos`/
/// `cafeteria` (party deposits never touch `sales`). [reservationsCreated]
/// ("sold this shift") and [reservationsOccurringToday] ("hosting today")
/// are deliberately different metrics — never conflate them. [contractedValue]
/// is accounts-receivable-shaped, never presented as collected revenue.
class PosCashOperationalEventsSummary {
  const PosCashOperationalEventsSummary({
    required this.reservationsCreated,
    required this.contractedValue,
    required this.collectedForNewReservations,
    required this.outstandingForNewReservations,
    required this.depositsCollected,
    required this.totalCollected,
    required this.cancelledCount,
    required this.reservationsOccurringToday,
  });

  factory PosCashOperationalEventsSummary.fromJson(Map<String, Object?> json) =>
      PosCashOperationalEventsSummary(
        reservationsCreated: json['reservations_created']! as int,
        contractedValue: json['contracted_value']! as String,
        collectedForNewReservations: json['collected_for_new_reservations']! as String,
        outstandingForNewReservations: json['outstanding_for_new_reservations']! as String,
        depositsCollected: json['deposits_collected']! as String,
        totalCollected: json['total_collected']! as String,
        cancelledCount: json['cancelled_count']! as int,
        reservationsOccurringToday: json['reservations_occurring_today']! as int,
      );

  final int reservationsCreated;
  final String contractedValue;
  final String collectedForNewReservations;
  final String outstandingForNewReservations;
  final String depositsCollected;
  final String totalCollected;
  final int cancelledCount;
  final int reservationsOccurringToday;
}

/// TASK 16.13 — "Resumen operativo": reporting-only, never influences the
/// cash-truth figures on [PosCashSessionPartialClose] alongside it. Mirrors
/// `cash.types.ts`'s `CashPartialCloseOperationalSummary` exactly.
class PosCashOperationalSummary {
  const PosCashOperationalSummary({
    required this.windowStart,
    required this.windowEnd,
    required this.pos,
    required this.cafeteria,
    required this.events,
  });

  factory PosCashOperationalSummary.fromJson(Map<String, Object?> json) =>
      PosCashOperationalSummary(
        windowStart: DateTime.parse(json['window_start']! as String),
        windowEnd: DateTime.parse(json['window_end']! as String),
        pos: PosCashOperationalPosSummary.fromJson(
          json['pos']! as Map<String, Object?>,
        ),
        cafeteria: PosCashOperationalCafeteriaSummary.fromJson(
          json['cafeteria']! as Map<String, Object?>,
        ),
        events: PosCashOperationalEventsSummary.fromJson(
          json['events']! as Map<String, Object?>,
        ),
      );

  final DateTime windowStart;
  final DateTime windowEnd;
  final PosCashOperationalPosSummary pos;
  final PosCashOperationalCafeteriaSummary cafeteria;
  final PosCashOperationalEventsSummary events;
}

/// TASK 14.4 (Wave 2, Part F.3) — "Corte parcial": a persisted, audited
/// SNAPSHOT of exactly what [PosCashGateway.summary] said at [takenAt].
/// Never a second drawer-balance source of truth — see
/// `cash.types.ts`'s own `CashSessionPartialCloseRow` doc comment. Taking
/// one never changes the session's `status`.
class PosCashSessionPartialClose {
  const PosCashSessionPartialClose({
    required this.id,
    required this.cashSessionId,
    required this.takenAt,
    required this.openingAmount,
    required this.cashSalesTotal,
    required this.cashInTotal,
    required this.cashOutTotal,
    required this.expectedCash,
    required this.createdBy,
    required this.createdAt,
    required this.operationalSummary,
  });

  factory PosCashSessionPartialClose.fromJson(Map<String, Object?> json) =>
      PosCashSessionPartialClose(
        id: json['id']! as String,
        cashSessionId: json['cash_session_id']! as String,
        takenAt: DateTime.parse(json['taken_at']! as String),
        openingAmount: json['opening_amount']! as String,
        cashSalesTotal: json['cash_sales_total']! as String,
        cashInTotal: json['cash_in_total']! as String,
        cashOutTotal: json['cash_out_total']! as String,
        expectedCash: json['expected_cash']! as String,
        createdBy: json['created_by']! as String,
        createdAt: DateTime.parse(json['created_at']! as String),
        // TASK 16.13 — `null` for any partial close taken before this
        // field existed (pre-TASK-16.13 history). Never synthesized.
        operationalSummary: json['operational_summary'] == null
            ? null
            : PosCashOperationalSummary.fromJson(
                json['operational_summary']! as Map<String, Object?>,
              ),
      );

  final String id;
  final String cashSessionId;
  final DateTime takenAt;
  final String openingAmount;
  final String cashSalesTotal;
  final String cashInTotal;
  final String cashOutTotal;
  final String expectedCash;
  final String createdBy;
  final DateTime createdAt;
  final PosCashOperationalSummary? operationalSummary;
}

class PosCashMovementPage {
  const PosCashMovementPage({required this.items, required this.nextCursor});
  final List<PosCashMovement> items;
  final String? nextCursor;
}

class PosCashSessionHistoryPage {
  const PosCashSessionHistoryPage({
    required this.items,
    required this.nextCursor,
  });
  final List<PosCashSession> items;
  final String? nextCursor;
}

/// Part L — every filter `GET /api/v1/cash-sessions` supports.
class PosCashSessionHistoryFilter {
  const PosCashSessionHistoryFilter({
    this.branchId,
    this.cashRegisterId,
    this.openedBy,
    this.status,
    this.openedFrom,
    this.openedTo,
  });
  final String? branchId;
  final String? cashRegisterId;
  final String? openedBy;
  final String? status;
  final DateTime? openedFrom;
  final DateTime? openedTo;
}

/// Part J — the exact 11-denomination MXN set AS POS V1's own
/// `modal-cierre-caja` counts (its `DENOMINACIONES` array), matching the
/// backend's `canonicalCashDenominationsMXN` exactly (ADR-0014 §B10).
/// Highest to lowest, matching V1's own display order.
const List<String> canonicalCashDenominationsMXN = [
  '1000',
  '500',
  '200',
  '100',
  '50',
  '20',
  '10',
  '5',
  '2',
  '1',
  '0.50',
];

/// TASK 16.11 — the real US bill/coin set, mirroring the backend's own
/// `canonicalCashDenominationsUSD` exactly (`cash.types.ts`). Never
/// merged with the MXN set — a real till only ever counts one currency's
/// physical notes/coins at a time.
const List<String> canonicalCashDenominationsUSD = [
  '100',
  '50',
  '20',
  '10',
  '5',
  '1',
  '0.25',
  '0.10',
  '0.05',
  '0.01',
];

/// Selects the real, closed denomination set for a session's own
/// `currencyCode` — never a blind MXN default. Mirrors the backend's own
/// `canonicalCashDenominationsForCurrency` exactly so the close-shift UI
/// never shows a USD tenant's cashier a wad of Mexican banknotes (or vice
/// versa). Falls back to MXN only as a last resort for a currency this
/// platform doesn't (yet) approve, so the UI still renders something
/// rather than crashing — the backend itself is the authoritative
/// validator and will reject a genuinely unsupported currency outright.
List<String> canonicalCashDenominationsForCurrency(String currencyCode) {
  switch (currencyCode) {
    case 'USD':
      return canonicalCashDenominationsUSD;
    case 'MXN':
    default:
      return canonicalCashDenominationsMXN;
  }
}

abstract interface class PosCashGateway {
  /// `GET /api/v1/cash-registers?branch_id=...` — the branch/register
  /// selection step of "Abrir caja" (Part C).
  Future<List<PosCashRegister>> registersForBranch(String branchId);

  /// `POST /api/v1/cash-registers` (E039) — TASK 15.1 Phase 6 gap fix:
  /// the backend route already existed and was already gated by
  /// `cash_register.manage`, but no Flutter caller ever reached it, which
  /// left "create a cash register" as a genuine dead end (`noRegister`
  /// phase's own copy told the operator to "contact an administrator" with
  /// no in-app path for that administrator to actually do it). This is the
  /// minimal real caller — see `_CajaCurrent`'s "Nueva caja" affordance.
  Future<PosCashRegister> createRegister({
    required String branchId,
    required String code,
    required String name,
  });

  /// `POST /api/v1/cash-sessions` (E042) — the cashier's own entered
  /// opening float; never a fabricated or seeded amount (Part C).
  Future<PosCashSession> openSession({
    required String cashRegisterId,
    required String openingAmount,
  });

  /// `GET /api/v1/cash-sessions/current?cash_register_id=...` (E043) — a
  /// `null` result is a legitimate answer ("no open session"), never an
  /// error.
  Future<PosCashSession?> currentSession(String cashRegisterId);

  /// The branch-level open-session check the POS ticket's Efectivo gate
  /// uses (Part N) — mirrors the backend's own register-agnostic
  /// resolution (`PaymentService.resolveOpenCashSession` when
  /// `cash_register_id` is omitted, ADR-0014 §B5), via
  /// `GET /api/v1/cash-sessions?branch_id=...&status=open&limit=1`. `null`
  /// means no open session for this branch — the caller must block
  /// Efectivo and prompt "Abre la caja para comenzar a cobrar en
  /// efectivo".
  Future<PosCashSession?> openSessionForBranch(String branchId);

  /// `GET /api/v1/cash-sessions/{id}` (E044).
  Future<PosCashSession> session(String cashSessionId);

  /// `GET /api/v1/cash-sessions/{id}/summary` (E048) — the one read that
  /// carries `expected_cash`; Flutter must display this value only, never
  /// recompute it (Part H).
  Future<PosCashSessionSummary> summary(String cashSessionId);

  /// `POST /api/v1/cash-sessions/{id}/movements` (E045) — cash in/out only;
  /// `opening_float`/`cash_sale` are system-posted and never reach this
  /// call (Part G). [category] is the optional TASK 14.4 (Wave 2, Part
  /// F.1) reporting dimension — the caller must only ever pass one valid
  /// for [movementType] (`posCashMovementCategoryDirection`); the backend
  /// independently re-validates the same rule before any write.
  Future<PosCashMovement> createMovement({
    required String cashSessionId,
    required String movementType,
    required String amount,
    required String reasonCode,
    String? note,
    String? category,
  });

  /// `GET /api/v1/cash-sessions/{id}/movements` (E046).
  Future<PosCashMovementPage> listMovements(
    String cashSessionId, {
    String? cursor,
    int limit = 50,
  });

  /// `POST /api/v1/cash-sessions/{id}/closures` (E047) — [declaredClosingAmount]
  /// is the only money figure this call submits; the backend alone computes
  /// `expected_closing_amount`/`discrepancy_amount` (Part I).
  /// [denominationCounts] is the optional Part J bills/coins breakdown —
  /// the backend independently requires it to sum to
  /// [declaredClosingAmount] exactly.
  Future<PosCashSession> closeSession({
    required String cashSessionId,
    required String declaredClosingAmount,
    List<PosCashDenominationCount>? denominationCounts,
  });

  /// `GET /api/v1/cash-sessions` (Part L cut history) — server-side
  /// paginated/filtered; never load-all-then-filter-client-side.
  Future<PosCashSessionHistoryPage> listSessions({
    PosCashSessionHistoryFilter filter = const PosCashSessionHistoryFilter(),
    String? cursor,
    int limit = 50,
  });

  /// `POST /api/v1/cash-sessions/{id}/partial-close` (TASK 14.4, Wave 2,
  /// Part F.3) — "Corte parcial": a real mutation that persists a
  /// snapshot of exactly what [summary] says right now, WITHOUT changing
  /// the session's `status` — the session stays open. Idempotency-key
  /// gated, exactly like every other write in this gateway.
  Future<PosCashSessionPartialClose> partialCloseSession(String cashSessionId);

  /// `GET /api/v1/cash-sessions/{id}/partial-closes` — the audit trail
  /// Part F.3 requires; read-only, never mutates. The backend returns the
  /// full list in one response (no pagination on this route).
  Future<List<PosCashSessionPartialClose>> listPartialCloses(String cashSessionId);

  /// `POST /api/v1/cash-sessions/{id}/movements/{movementId}/reverse`
  /// (TASK 16.11 §6) — "Never delete posted financial movements.
  /// Corrections must use reversal/compensating architecture." Posts a
  /// new, opposite-direction movement referencing the original via
  /// `reversal_of_id`; the original row is never mutated or deleted.
  /// Only a manual `cash_in`/`cash_out` movement can be reversed.
  Future<PosCashMovement> reverseMovement({
    required String cashSessionId,
    required String movementId,
    required String reasonCode,
    String? note,
  });

  /// `GET /api/v1/cash-sessions/{id}/audit-log` (TASK 16.11 §13) —
  /// "Bitácora": a read-only projection of the existing `audit_log` rows
  /// this session's own open/movement/reversal/partial-close/close
  /// already wrote. Gated by `audit.read`, not `cash_session.read`.
  Future<List<PosCashAuditEntry>> auditLog(
    String cashSessionId, {
    int limit = 100,
  });
}

class ApiPosCashGateway implements PosCashGateway {
  const ApiPosCashGateway(
    this._client, {
    this.createIdempotencyKey = _defaultIdempotencyKey,
  });

  final ApiClient _client;
  final String Function() createIdempotencyKey;

  static String _defaultIdempotencyKey() =>
      'one-cash-${DateTime.now().toUtc().microsecondsSinceEpoch}';

  @override
  Future<List<PosCashRegister>> registersForBranch(String branchId) async {
    final envelope = await _client.getJson(
      '/api/v1/cash-registers?branch_id=$branchId&status=active&limit=50',
    );
    final data = envelope['data'];
    if (data is! List<Object?>) return const [];
    return data
        .whereType<Map<String, Object?>>()
        .map(PosCashRegister.fromJson)
        .toList(growable: false);
  }

  @override
  Future<PosCashRegister> createRegister({
    required String branchId,
    required String code,
    required String name,
  }) async {
    final envelope = await _client.postJson(
      '/api/v1/cash-registers',
      idempotencyKey: createIdempotencyKey(),
      body: {'branch_id': branchId, 'code': code, 'name': name},
    );
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw StateError('cash register creation returned no data');
    }
    return PosCashRegister.fromJson(data);
  }

  @override
  Future<PosCashSession> openSession({
    required String cashRegisterId,
    required String openingAmount,
  }) async {
    final envelope = await _client.postJson(
      '/api/v1/cash-sessions',
      idempotencyKey: createIdempotencyKey(),
      body: {
        'cash_register_id': cashRegisterId,
        'opening_amount': openingAmount,
      },
    );
    return _decodeSession(envelope);
  }

  @override
  Future<PosCashSession?> currentSession(String cashRegisterId) async {
    final envelope = await _client.getJson(
      '/api/v1/cash-sessions/current?cash_register_id=$cashRegisterId',
    );
    final data = envelope['data'];
    return data is Map<String, Object?> ? PosCashSession.fromJson(data) : null;
  }

  @override
  Future<PosCashSession?> openSessionForBranch(String branchId) async {
    final envelope = await _client.getJson(
      '/api/v1/cash-sessions?branch_id=$branchId&status=open&limit=1',
    );
    final data = envelope['data'];
    if (data is! List<Object?> || data.isEmpty) return null;
    final first = data.first;
    return first is Map<String, Object?>
        ? PosCashSession.fromJson(first)
        : null;
  }

  @override
  Future<PosCashSession> session(String cashSessionId) async {
    final envelope = await _client.getJson(
      '/api/v1/cash-sessions/$cashSessionId',
    );
    return _decodeSession(envelope);
  }

  @override
  Future<PosCashSessionSummary> summary(String cashSessionId) async {
    final envelope = await _client.getJson(
      '/api/v1/cash-sessions/$cashSessionId/summary',
    );
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing cash session summary data.');
    }
    return PosCashSessionSummary.fromJson(data);
  }

  @override
  Future<PosCashMovement> createMovement({
    required String cashSessionId,
    required String movementType,
    required String amount,
    required String reasonCode,
    String? note,
    String? category,
  }) async {
    final envelope = await _client.postJson(
      '/api/v1/cash-sessions/$cashSessionId/movements',
      idempotencyKey: createIdempotencyKey(),
      body: {
        'movement_type': movementType,
        'amount': amount,
        'reason_code': reasonCode,
        if (note != null && note.isNotEmpty) 'note': note,
        if (category != null) 'category': category,
      },
    );
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing cash movement data.');
    }
    return PosCashMovement.fromJson(data);
  }

  @override
  Future<PosCashMovementPage> listMovements(
    String cashSessionId, {
    String? cursor,
    int limit = 50,
  }) async {
    final query = <String, String>{
      'limit': '$limit',
      if (cursor != null) 'cursor': cursor,
    };
    final path = Uri(
      path: '/api/v1/cash-sessions/$cashSessionId/movements',
      queryParameters: query,
    ).toString();
    final envelope = await _client.getJson(path);
    final data = envelope['data'];
    if (data is! List<Object?>) {
      throw const FormatException('Missing cash movement list data.');
    }
    final meta = envelope['meta'];
    final page = meta is Map<String, Object?> ? meta['page'] : null;
    final nextCursor = page is Map<String, Object?>
        ? page['next_cursor'] as String?
        : null;
    return PosCashMovementPage(
      items: data
          .whereType<Map<String, Object?>>()
          .map(PosCashMovement.fromJson)
          .toList(growable: false),
      nextCursor: nextCursor,
    );
  }

  @override
  Future<PosCashSession> closeSession({
    required String cashSessionId,
    required String declaredClosingAmount,
    List<PosCashDenominationCount>? denominationCounts,
  }) async {
    final envelope = await _client.postJson(
      '/api/v1/cash-sessions/$cashSessionId/closures',
      idempotencyKey: createIdempotencyKey(),
      body: {
        'declared_closing_amount': declaredClosingAmount,
        if (denominationCounts != null && denominationCounts.isNotEmpty)
          'denomination_counts': [
            for (final line in denominationCounts) line.toJson(),
          ],
      },
    );
    return _decodeSession(envelope);
  }

  @override
  Future<PosCashSessionHistoryPage> listSessions({
    PosCashSessionHistoryFilter filter = const PosCashSessionHistoryFilter(),
    String? cursor,
    int limit = 50,
  }) async {
    final query = <String, String>{
      'limit': '$limit',
      if (cursor != null) 'cursor': cursor,
      if (filter.branchId != null) 'branch_id': filter.branchId!,
      if (filter.cashRegisterId != null)
        'cash_register_id': filter.cashRegisterId!,
      if (filter.openedBy != null) 'opened_by': filter.openedBy!,
      if (filter.status != null) 'status': filter.status!,
      if (filter.openedFrom != null)
        'opened_from': filter.openedFrom!.toUtc().toIso8601String(),
      if (filter.openedTo != null)
        'opened_to': filter.openedTo!.toUtc().toIso8601String(),
    };
    final path = Uri(
      path: '/api/v1/cash-sessions',
      queryParameters: query,
    ).toString();
    final envelope = await _client.getJson(path);
    final data = envelope['data'];
    if (data is! List<Object?>) {
      throw const FormatException('Missing cash session history data.');
    }
    final meta = envelope['meta'];
    final page = meta is Map<String, Object?> ? meta['page'] : null;
    final nextCursor = page is Map<String, Object?>
        ? page['next_cursor'] as String?
        : null;
    return PosCashSessionHistoryPage(
      items: data
          .whereType<Map<String, Object?>>()
          .map(PosCashSession.fromJson)
          .toList(growable: false),
      nextCursor: nextCursor,
    );
  }

  @override
  Future<PosCashSessionPartialClose> partialCloseSession(String cashSessionId) async {
    final envelope = await _client.postJson(
      '/api/v1/cash-sessions/$cashSessionId/partial-close',
      idempotencyKey: createIdempotencyKey(),
    );
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing cash session partial-close data.');
    }
    return PosCashSessionPartialClose.fromJson(data);
  }

  @override
  Future<List<PosCashSessionPartialClose>> listPartialCloses(String cashSessionId) async {
    final envelope = await _client.getJson('/api/v1/cash-sessions/$cashSessionId/partial-closes');
    final data = envelope['data'];
    if (data is! List<Object?>) {
      throw const FormatException('Missing cash session partial-close list data.');
    }
    return data
        .whereType<Map<String, Object?>>()
        .map(PosCashSessionPartialClose.fromJson)
        .toList(growable: false);
  }

  @override
  Future<PosCashMovement> reverseMovement({
    required String cashSessionId,
    required String movementId,
    required String reasonCode,
    String? note,
  }) async {
    final envelope = await _client.postJson(
      '/api/v1/cash-sessions/$cashSessionId/movements/$movementId/reverse',
      idempotencyKey: createIdempotencyKey(),
      body: {
        'reason_code': reasonCode,
        if (note != null && note.isNotEmpty) 'note': note,
      },
    );
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing cash movement reversal data.');
    }
    return PosCashMovement.fromJson(data);
  }

  @override
  Future<List<PosCashAuditEntry>> auditLog(
    String cashSessionId, {
    int limit = 100,
  }) async {
    final envelope = await _client.getJson(
      '/api/v1/cash-sessions/$cashSessionId/audit-log?limit=$limit',
    );
    final data = envelope['data'];
    if (data is! List<Object?>) {
      throw const FormatException('Missing cash audit log data.');
    }
    return data
        .whereType<Map<String, Object?>>()
        .map(PosCashAuditEntry.fromJson)
        .toList(growable: false);
  }

  PosCashSession _decodeSession(Map<String, Object?> envelope) {
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing cash session data.');
    }
    return PosCashSession.fromJson(data);
  }
}

class EmptyPosCashGateway implements PosCashGateway {
  const EmptyPosCashGateway();

  @override
  Future<List<PosCashRegister>> registersForBranch(String branchId) async =>
      const [];

  @override
  Future<PosCashRegister> createRegister({
    required String branchId,
    required String code,
    required String name,
  }) => Future.error(StateError('No cash gateway is configured.'));

  @override
  Future<PosCashSession> openSession({
    required String cashRegisterId,
    required String openingAmount,
  }) => Future.error(StateError('No cash gateway is configured.'));

  @override
  Future<PosCashSession?> currentSession(String cashRegisterId) async => null;

  @override
  Future<PosCashSession?> openSessionForBranch(String branchId) async => null;

  @override
  Future<PosCashSession> session(String cashSessionId) =>
      Future.error(StateError('No cash gateway is configured.'));

  @override
  Future<PosCashSessionSummary> summary(String cashSessionId) =>
      Future.error(StateError('No cash gateway is configured.'));

  @override
  Future<PosCashMovement> createMovement({
    required String cashSessionId,
    required String movementType,
    required String amount,
    required String reasonCode,
    String? note,
    String? category,
  }) => Future.error(StateError('No cash gateway is configured.'));

  @override
  Future<PosCashMovementPage> listMovements(
    String cashSessionId, {
    String? cursor,
    int limit = 50,
  }) async => const PosCashMovementPage(items: [], nextCursor: null);

  @override
  Future<PosCashSession> closeSession({
    required String cashSessionId,
    required String declaredClosingAmount,
    List<PosCashDenominationCount>? denominationCounts,
  }) => Future.error(StateError('No cash gateway is configured.'));

  @override
  Future<PosCashSessionHistoryPage> listSessions({
    PosCashSessionHistoryFilter filter = const PosCashSessionHistoryFilter(),
    String? cursor,
    int limit = 50,
  }) async => const PosCashSessionHistoryPage(items: [], nextCursor: null);

  @override
  Future<PosCashSessionPartialClose> partialCloseSession(String cashSessionId) =>
      Future.error(StateError('No cash gateway is configured.'));

  @override
  Future<List<PosCashSessionPartialClose>> listPartialCloses(String cashSessionId) async => const [];

  @override
  Future<PosCashMovement> reverseMovement({
    required String cashSessionId,
    required String movementId,
    required String reasonCode,
    String? note,
  }) => Future.error(StateError('No cash gateway is configured.'));

  @override
  Future<List<PosCashAuditEntry>> auditLog(
    String cashSessionId, {
    int limit = 100,
  }) async => const [];
}
