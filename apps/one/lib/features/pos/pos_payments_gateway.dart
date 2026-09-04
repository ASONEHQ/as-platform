import '../../core/networking/api_client.dart';

/// A `payment_terminals` row as CAJERO/CLIENTE need it to decide whether a
/// real Point terminal is available for the current branch — never a
/// provider credential, only the AS-internal terminal id and its safe
/// status/provider name (see ADR-0010 "Security/PCI boundary": Flutter
/// never receives an Access Token, a webhook secret, or any provider
/// private credential — this is not one).
class PosPaymentTerminal {
  const PosPaymentTerminal({required this.id, required this.provider, required this.status});

  factory PosPaymentTerminal.fromJson(Map<String, Object?> json) => PosPaymentTerminal(
    id: json['id']! as String,
    provider: json['provider']! as String,
    status: json['status']! as String,
  );

  final String id;
  final String provider;
  final String status;
}

/// One `payment_attempts` row — just enough for CAJERO/CLIENTE to render
/// an honest state label while polling. `declineReason` is Mercado
/// Pago's own status_detail, passed through by the backend verbatim.
class PosPaymentAttempt {
  const PosPaymentAttempt({required this.id, required this.status, this.declineReason});

  factory PosPaymentAttempt.fromJson(Map<String, Object?> json) => PosPaymentAttempt(
    id: json['id']! as String,
    status: json['status']! as String,
    declineReason: json['decline_reason'] as String?,
  );

  final String id;
  final String status;
  final String? declineReason;
}

class PosPaymentStatus {
  const PosPaymentStatus({required this.id, required this.status, required this.attempts});

  factory PosPaymentStatus.fromJson(Map<String, Object?> json) {
    final rawAttempts = json['attempts'];
    final attempts = rawAttempts is List<Object?>
        ? rawAttempts
              .whereType<Map<String, Object?>>()
              .map(PosPaymentAttempt.fromJson)
              .toList(growable: false)
        : const <PosPaymentAttempt>[];
    return PosPaymentStatus(id: json['id']! as String, status: json['status']! as String, attempts: attempts);
  }

  final String id;
  final String status;
  final List<PosPaymentAttempt> attempts;

  /// The most recent attempt — `payments.attempts` is already ordered
  /// oldest-first by the backend (`order by attempt_number asc`).
  PosPaymentAttempt? get latestAttempt => attempts.isEmpty ? null : attempts.last;
}

/// TASK 12.5A: the result of `POST /sales/{sale_id}/cash-payments` — the
/// authoritative outcome of a cash checkout. `tenderedAmount`/
/// `changeAmount` are exactly what the backend computed (see ADR-0011),
/// never re-derived client-side; a completed-sale success state must
/// display these, not a locally-recomputed figure.
class PosCashPaymentResult {
  const PosCashPaymentResult({
    required this.paymentId,
    required this.status,
    required this.tenderedAmount,
    required this.changeAmount,
    required this.saleId,
    required this.saleNumber,
    required this.saleStatus,
  });

  factory PosCashPaymentResult.fromJson(Map<String, Object?> json) {
    final rawSale = json['sale'];
    final sale = rawSale is Map<String, Object?> ? rawSale : const <String, Object?>{};
    return PosCashPaymentResult(
      paymentId: json['id']! as String,
      status: json['status']! as String,
      tenderedAmount: json['tendered_amount']! as String,
      changeAmount: json['change_amount']! as String,
      saleId: sale['id'] as String? ?? '',
      saleNumber: sale['sale_number'] as String? ?? '',
      saleStatus: sale['status'] as String? ?? '',
    );
  }

  final String paymentId;
  final String status;
  final String tenderedAmount;
  final String changeAmount;
  final String saleId;
  final String saleNumber;
  final String saleStatus;
}

/// TASK 12.4B.1: the minimal AS API surface CAJERO/CLIENTE need to run a
/// real Mercado Pago Point payment — never Mercado Pago itself. Flutter
/// only ever talks to this backend; the backend alone talks to Mercado
/// Pago (see providers/mercado-pago.provider.ts).
abstract interface class PosPaymentsGateway {
  /// `GET /api/v1/payment-terminals?branch_id=...` — used to discover
  /// whether this branch has a configured, active Point terminal at all.
  Future<List<PosPaymentTerminal>> terminalsForBranch(String branchId);

  /// `POST /api/v1/sales/{sale_id}/payments` with `payment_method:
  /// 'card_terminal'` — the amount is always the backend-authoritative
  /// sale total, never a value Flutter computed itself.
  Future<PosPaymentStatus> createCardTerminalPayment({
    required String saleId,
    required String amount,
    required String terminalId,
  });

  /// `GET /api/v1/payments/{id}` — the one call the bounded poll loop in
  /// `pos_shell.dart` repeats. Never calls Mercado Pago directly.
  Future<PosPaymentStatus> paymentStatus(String paymentId);

  /// `POST /api/v1/sales/{sale_id}/cash-payments` — TASK 12.5A.
  /// [tenderedAmount] is only ever what the cashier physically counted
  /// (the exact ADR-0001 decimal-string wire format — see
  /// `Money.toApiString`); the backend alone computes the amount actually
  /// applied to the sale and the change (see ADR-0011). No terminal, no
  /// provider — CAJERO-only; CLIENTE never calls this.
  Future<PosCashPaymentResult> createCashPayment({
    required String saleId,
    required String tenderedAmount,
  });
}

class ApiPosPaymentsGateway implements PosPaymentsGateway {
  const ApiPosPaymentsGateway(this._client, {this.createIdempotencyKey = _defaultIdempotencyKey});

  final ApiClient _client;
  final String Function() createIdempotencyKey;

  static String _defaultIdempotencyKey() =>
      'one-payment-${DateTime.now().toUtc().microsecondsSinceEpoch}';

  @override
  Future<List<PosPaymentTerminal>> terminalsForBranch(String branchId) async {
    final envelope = await _client.getJson(
      '/api/v1/payment-terminals?branch_id=$branchId&status=active&limit=50',
    );
    final data = envelope['data'];
    if (data is! List<Object?>) return const [];
    return data
        .whereType<Map<String, Object?>>()
        .map(PosPaymentTerminal.fromJson)
        .toList(growable: false);
  }

  @override
  Future<PosPaymentStatus> createCardTerminalPayment({
    required String saleId,
    required String amount,
    required String terminalId,
  }) async {
    final envelope = await _client.postJson(
      '/api/v1/sales/$saleId/payments',
      idempotencyKey: createIdempotencyKey(),
      body: {
        'payment_method': 'card_terminal',
        'amount': amount,
        'currency_code': 'MXN',
        'terminal_id': terminalId,
      },
    );
    return _decodePayment(envelope);
  }

  @override
  Future<PosPaymentStatus> paymentStatus(String paymentId) async {
    final envelope = await _client.getJson('/api/v1/payments/$paymentId');
    return _decodePayment(envelope);
  }

  @override
  Future<PosCashPaymentResult> createCashPayment({
    required String saleId,
    required String tenderedAmount,
  }) async {
    final envelope = await _client.postJson(
      '/api/v1/sales/$saleId/cash-payments',
      idempotencyKey: createIdempotencyKey(),
      body: {'tendered_amount': tenderedAmount},
    );
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing cash payment data.');
    }
    return PosCashPaymentResult.fromJson(data);
  }

  PosPaymentStatus _decodePayment(Map<String, Object?> envelope) {
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing payment data.');
    }
    return PosPaymentStatus.fromJson(data);
  }
}

class EmptyPosPaymentsGateway implements PosPaymentsGateway {
  const EmptyPosPaymentsGateway();

  @override
  Future<List<PosPaymentTerminal>> terminalsForBranch(String branchId) async => const [];

  @override
  Future<PosPaymentStatus> createCardTerminalPayment({
    required String saleId,
    required String amount,
    required String terminalId,
  }) => Future.error(StateError('No payments gateway is configured.'));

  @override
  Future<PosPaymentStatus> paymentStatus(String paymentId) =>
      Future.error(StateError('No payments gateway is configured.'));

  @override
  Future<PosCashPaymentResult> createCashPayment({
    required String saleId,
    required String tenderedAmount,
  }) => Future.error(StateError('No payments gateway is configured.'));
}
