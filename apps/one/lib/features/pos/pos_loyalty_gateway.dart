import '../../core/networking/api_client.dart';

/// TASK 13.0: the Flutter side of the AS Rewards+ loyalty-ledger
/// foundation — see ADR-0017 (D12-D15) for the full backend design this
/// mirrors. No client-side balance/eligibility computation exists
/// anywhere here — the balance is always what the backend's own derived
/// `GET /customers/{id}/loyalty` response reports (D13), and no reward-
/// entitlement/redemption UI exists because no such backend capability
/// exists yet (deliberately deferred — see ADR-0017's Deferred section;
/// Flutter must never fabricate a "reward available" badge, Part AG).

/// A `loyalty_programs` row (`LoyaltyProgramRow`/`programHttp`).
class PosLoyaltyProgram {
  const PosLoyaltyProgram({
    required this.id,
    required this.name,
    required this.active,
    required this.unitType,
    required this.earnQuantityPerSale,
    required this.minimumSaleTotal,
    required this.rewardThreshold,
    required this.rewardDescription,
    required this.version,
  });

  factory PosLoyaltyProgram.fromJson(Map<String, Object?> json) => PosLoyaltyProgram(
    id: json['id']! as String,
    name: json['name']! as String,
    active: json['active'] == true,
    unitType: json['unit_type']! as String,
    earnQuantityPerSale: json['earn_quantity_per_sale']! as int,
    minimumSaleTotal: json['minimum_sale_total'] as String?,
    rewardThreshold: json['reward_threshold'] as int?,
    rewardDescription: json['reward_description'] as String?,
    version: json['version']! as int,
  );

  final String id;
  final String name;
  final bool active;

  /// `stamp` | `point`.
  final String unitType;
  final int earnQuantityPerSale;
  final String? minimumSaleTotal;

  /// Configured for progress DISPLAY only (D15) — no reward-entitlement
  /// issuance exists yet, so this is never used to show a fabricated
  /// "reward available" state.
  final int? rewardThreshold;
  final String? rewardDescription;
  final int version;
}

class PosLoyaltyProgramInput {
  const PosLoyaltyProgramInput({
    this.name,
    this.active,
    this.unitType,
    this.earnQuantityPerSale,
    this.minimumSaleTotal,
    this.rewardThreshold,
    this.rewardDescription,
  });

  final String? name;
  final bool? active;

  /// `stamp` | `point` — required by the backend on create, but every
  /// field here stays optional so this same class also serves `PUT`'s
  /// narrower partial-update body.
  final String? unitType;
  final int? earnQuantityPerSale;
  final String? minimumSaleTotal;
  final int? rewardThreshold;
  final String? rewardDescription;

  Map<String, Object?> toJson() => {
    if (name != null) 'name': name,
    if (active != null) 'active': active,
    if (unitType != null) 'unit_type': unitType,
    if (earnQuantityPerSale != null) 'earn_quantity_per_sale': earnQuantityPerSale,
    if (minimumSaleTotal != null) 'minimum_sale_total': minimumSaleTotal,
    if (rewardThreshold != null) 'reward_threshold': rewardThreshold,
    if (rewardDescription != null) 'reward_description': rewardDescription,
  };
}

/// One `loyalty_ledger` row, as `GET /customers/{id}/loyalty` returns it
/// (`ledgerEntryHttp`) — append-only, never edited (D13). Note the
/// backend's own response deliberately omits `loyalty_program_id` here
/// (see `loyalty.routes.ts`), so a ledger entry cannot be joined back to a
/// program name — never fabricated client-side; the ledger simply shows
/// its own honest fields.
class PosLoyaltyLedgerEntry {
  const PosLoyaltyLedgerEntry({
    required this.id,
    required this.entryType,
    required this.quantity,
    required this.unitType,
    required this.sourceType,
    required this.reason,
    required this.occurredAt,
  });

  factory PosLoyaltyLedgerEntry.fromJson(Map<String, Object?> json) => PosLoyaltyLedgerEntry(
    id: json['id']! as String,
    entryType: json['entry_type']! as String,
    quantity: json['quantity']! as int,
    unitType: json['unit_type']! as String,
    sourceType: json['source_type']! as String,
    reason: json['reason'] as String?,
    occurredAt: DateTime.parse(json['occurred_at']! as String),
  );

  final String id;

  /// `earn` | `redeem` | `adjustment` | `expiration` — `redeem`/
  /// `expiration` are reserved-but-never-yet-produced values (D14); never
  /// treat their mere presence in this enum as proof a redemption feature
  /// exists.
  final String entryType;
  final int quantity;

  /// `stamp` | `point`.
  final String unitType;

  /// `sale` | `manual` | `expiration_job`.
  final String sourceType;
  final String? reason;
  final DateTime occurredAt;
}

/// One derived balance, grouped per program (D13 — always a live `SUM`,
/// never a cached counter).
class PosLoyaltyBalance {
  const PosLoyaltyBalance({required this.programId, required this.unitType, required this.balance});

  factory PosLoyaltyBalance.fromJson(Map<String, Object?> json) => PosLoyaltyBalance(
    programId: json['program_id'] as String?,
    unitType: json['unit_type']! as String,
    balance: json['balance']! as int,
  );

  final String? programId;
  final String unitType;
  final int balance;
}

/// `GET /customers/{id}/loyalty`'s full response (`summaryHttp`).
/// [account] is `null` whenever the customer has never earned or been
/// manually adjusted (D12 — an account is created lazily, never for every
/// customer automatically) — a caller must render an honest empty state
/// then, never a fake zero-balance card.
class PosLoyaltySummary {
  const PosLoyaltySummary({required this.accountId, required this.balances, required this.ledger});

  factory PosLoyaltySummary.fromJson(Map<String, Object?> json) {
    final account = json['account'];
    final rawBalances = json['balances'];
    final rawLedger = json['ledger'];
    return PosLoyaltySummary(
      accountId: account is Map<String, Object?> ? account['id'] as String? : null,
      balances: rawBalances is List<Object?>
          ? rawBalances.whereType<Map<String, Object?>>().map(PosLoyaltyBalance.fromJson).toList(growable: false)
          : const <PosLoyaltyBalance>[],
      ledger: rawLedger is List<Object?>
          ? rawLedger.whereType<Map<String, Object?>>().map(PosLoyaltyLedgerEntry.fromJson).toList(growable: false)
          : const <PosLoyaltyLedgerEntry>[],
    );
  }

  /// `null` means "no account exists" (D12) — the one honest signal a
  /// caller checks before showing anything but an empty state.
  final String? accountId;
  final List<PosLoyaltyBalance> balances;
  final List<PosLoyaltyLedgerEntry> ledger;

  bool get hasAccount => accountId != null;
}

abstract interface class PosLoyaltyGateway {
  /// `POST /api/v1/loyalty-programs` (`loyalty.manage`).
  Future<PosLoyaltyProgram> createProgram(PosLoyaltyProgramInput input);

  /// `GET /api/v1/loyalty-programs` (`loyalty.read`) — a plain array, not
  /// paginated.
  Future<List<PosLoyaltyProgram>> listPrograms({bool? active});

  /// `PUT /api/v1/loyalty-programs/{id}` (`loyalty.manage`).
  Future<PosLoyaltyProgram> updateProgram(String id, PosLoyaltyProgramInput input, {required int version});

  /// `GET /api/v1/customers/{customerId}/loyalty` (`loyalty.read`).
  Future<PosLoyaltySummary> customerLoyalty(String customerId);

  /// `POST /api/v1/customers/{customerId}/loyalty/adjust`
  /// (`loyalty.adjust` — SEPARATE from `loyalty.manage`, gate the UI
  /// action on this specific permission, Part Y). [quantity] is signed
  /// (may be negative).
  Future<PosLoyaltyLedgerEntry> adjustLoyalty({
    required String customerId,
    required int quantity,
    required String unitType,
    required String reason,
    String? loyaltyProgramId,
  });
}

class ApiPosLoyaltyGateway implements PosLoyaltyGateway {
  const ApiPosLoyaltyGateway(this._client);

  final ApiClient _client;

  @override
  Future<PosLoyaltyProgram> createProgram(PosLoyaltyProgramInput input) async {
    final envelope = await _client.postJson(
      '/api/v1/loyalty-programs',
      idempotencyKey: _idempotencyKey('program'),
      body: input.toJson(),
    );
    return _decodeProgram(envelope);
  }

  @override
  Future<List<PosLoyaltyProgram>> listPrograms({bool? active}) async {
    final query = <String, String>{if (active != null) 'active': '$active'};
    final path = Uri(path: '/api/v1/loyalty-programs', queryParameters: query.isEmpty ? null : query).toString();
    final envelope = await _client.getJson(path);
    final data = envelope['data'];
    if (data is! List<Object?>) {
      throw const FormatException('Missing loyalty programs data.');
    }
    return data.whereType<Map<String, Object?>>().map(PosLoyaltyProgram.fromJson).toList(growable: false);
  }

  @override
  Future<PosLoyaltyProgram> updateProgram(String id, PosLoyaltyProgramInput input, {required int version}) async {
    final envelope = await _client.putJson(
      '/api/v1/loyalty-programs/$id',
      ifMatch: '"$version"',
      body: input.toJson(),
    );
    return _decodeProgram(envelope);
  }

  @override
  Future<PosLoyaltySummary> customerLoyalty(String customerId) async {
    final envelope = await _client.getJson('/api/v1/customers/$customerId/loyalty');
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing loyalty summary data.');
    }
    return PosLoyaltySummary.fromJson(data);
  }

  @override
  Future<PosLoyaltyLedgerEntry> adjustLoyalty({
    required String customerId,
    required int quantity,
    required String unitType,
    required String reason,
    String? loyaltyProgramId,
  }) async {
    final envelope = await _client.postJson(
      '/api/v1/customers/$customerId/loyalty/adjust',
      idempotencyKey: _idempotencyKey('loyalty-adjust'),
      body: {
        'quantity': quantity,
        'unit_type': unitType,
        'reason': reason,
        if (loyaltyProgramId != null) 'loyalty_program_id': loyaltyProgramId,
      },
    );
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing loyalty ledger entry data.');
    }
    return PosLoyaltyLedgerEntry.fromJson(data);
  }

  static String _idempotencyKey(String kind) => 'one-$kind-${DateTime.now().toUtc().microsecondsSinceEpoch}';

  PosLoyaltyProgram _decodeProgram(Map<String, Object?> envelope) {
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing loyalty program data.');
    }
    return PosLoyaltyProgram.fromJson(data);
  }
}

class EmptyPosLoyaltyGateway implements PosLoyaltyGateway {
  const EmptyPosLoyaltyGateway();

  @override
  Future<PosLoyaltyProgram> createProgram(PosLoyaltyProgramInput input) =>
      Future.error(StateError('No loyalty gateway is configured.'));

  @override
  Future<List<PosLoyaltyProgram>> listPrograms({bool? active}) async => const [];

  @override
  Future<PosLoyaltyProgram> updateProgram(String id, PosLoyaltyProgramInput input, {required int version}) =>
      Future.error(StateError('No loyalty gateway is configured.'));

  @override
  Future<PosLoyaltySummary> customerLoyalty(String customerId) async =>
      const PosLoyaltySummary(accountId: null, balances: [], ledger: []);

  @override
  Future<PosLoyaltyLedgerEntry> adjustLoyalty({
    required String customerId,
    required int quantity,
    required String unitType,
    required String reason,
    String? loyaltyProgramId,
  }) => Future.error(StateError('No loyalty gateway is configured.'));
}
