import '../../core/networking/api_client.dart';

/// TASK 13.1: the Flutter side of reward entitlements/redemption — built
/// on top of TASK 13.0's customer/membership/loyalty foundation. See
/// `apps/api/src/modules/rewards/rewards.routes.ts`/`rewards.types.ts` and
/// ADR-0018 for the full backend design this mirrors exactly. Styled after
/// `pos_loyalty_gateway.dart` (its closest sibling — same HTTP-wrapper
/// shape, same error-mapping convention, same model-class style) and
/// `pos_memberships_gateway.dart` (issue/revoke pattern).
///
/// TASK 16.24 (Block C) — the REWARD presentation-token concept (Part
/// L/X of the backend) is now real here too, mirroring
/// `pos_customers_gateway.dart`'s own `PosCustomerQrToken`/
/// `issueQrToken`/`activeQrToken`/`resolveQrToken` shape exactly. Nothing
/// here ever conflates a reward entitlement's token with the customer-
/// identity QR token; the two stay visually and conceptually distinct
/// wherever both appear (`_CustomerDetailDialog`'s Recompensas section
/// renders its own token separately from the customer QR section above
/// it).

/// A `reward_entitlements` row (`RewardEntitlementRow`/`entitlementHttp`)
/// — the durable, historical fact. [status] is the RAW persisted state;
/// [effectiveStatus] is the backend's LIVE, request-time-computed status
/// (Part N — e.g. an `available` row whose `expires_at` already passed
/// reports `expired` here even before that transition is persisted). A
/// caller must always prefer [effectiveStatus] over [status] when
/// deciding what to show/enable — never re-derive "is this redeemable"
/// from [status] plus a locally-computed expiry.
class PosRewardEntitlement {
  const PosRewardEntitlement({
    required this.id,
    required this.customerId,
    required this.loyaltyProgramId,
    required this.rewardType,
    required this.status,
    required this.effectiveStatus,
    required this.issuedAt,
    required this.expiresAt,
    required this.redeemedAt,
    required this.revokedAt,
    required this.sourceType,
    required this.cycleNumber,
    required this.version,
  });

  factory PosRewardEntitlement.fromJson(Map<String, Object?> json) => PosRewardEntitlement(
    id: json['id']! as String,
    customerId: json['customer_id']! as String,
    loyaltyProgramId: json['loyalty_program_id']! as String,
    rewardType: json['reward_type']! as String,
    status: json['status']! as String,
    effectiveStatus: json['effective_status']! as String,
    issuedAt: DateTime.parse(json['issued_at']! as String),
    expiresAt: json['expires_at'] == null ? null : DateTime.parse(json['expires_at']! as String),
    redeemedAt: json['redeemed_at'] == null ? null : DateTime.parse(json['redeemed_at']! as String),
    revokedAt: json['revoked_at'] == null ? null : DateTime.parse(json['revoked_at']! as String),
    sourceType: json['source_type']! as String,
    cycleNumber: json['cycle_number'] as int?,
    version: json['version']! as int,
  );

  final String id;
  final String customerId;
  final String loyaltyProgramId;

  /// Currently always `vip_pass` (`RewardType` in `rewards.types.ts`) —
  /// kept as a plain string, never a closed Dart enum, so a future
  /// backend-added reward type never requires a Flutter release just to
  /// display it (matches `PosCustomerMembership.status`'s own "display
  /// string, not an enum" convention).
  final String rewardType;

  /// RAW persisted `available` | `redeemed` | `expired` | `revoked`.
  /// Never trusted alone for an "is this redeemable" decision — see
  /// [effectiveStatus].
  final String status;

  /// LIVE, server-computed `available` | `redeemed` | `expired` |
  /// `revoked` (Part N) — the ONE field a caller trusts for "is this
  /// redeemable right now". Always prefer this over [status].
  final String effectiveStatus;
  final DateTime issuedAt;
  final DateTime? expiresAt;
  final DateTime? redeemedAt;
  final DateTime? revokedAt;

  /// `loyalty_threshold` | `manual` (`RewardEntitlementSourceType`).
  final String sourceType;
  final int? cycleNumber;
  final int version;

  /// Convenience only — exactly `effectiveStatus == 'available'`, never a
  /// separately-computed value.
  bool get isAvailable => effectiveStatus == 'available';
}

/// `reward_entitlement_tokens` row (`tokenHttp`) — [token] is an OPAQUE
/// identifier, never derived from or containing the customer's name/
/// email/phone (mirrors `PosCustomerQrToken`'s own security shape). This
/// app never encodes it into a QR image itself (no QR-rendering package
/// is a pre-existing dependency — see `pos_customers_gateway.dart`'s own
/// identical note); it is shown as selectable/copyable text instead.
class PosRewardPresentationToken {
  const PosRewardPresentationToken({
    required this.id,
    required this.rewardEntitlementId,
    required this.token,
    required this.status,
    required this.createdAt,
  });

  factory PosRewardPresentationToken.fromJson(Map<String, Object?> json) => PosRewardPresentationToken(
    id: json['id']! as String,
    rewardEntitlementId: json['reward_entitlement_id']! as String,
    token: json['token']! as String,
    status: json['status']! as String,
    createdAt: DateTime.parse(json['created_at']! as String),
  );

  final String id;
  final String rewardEntitlementId;
  final String token;

  /// `active` | `revoked` (`reward_entitlement_tokens_status_ck`).
  final String status;
  final DateTime createdAt;
}

abstract interface class PosRewardsGateway {
  /// `GET /api/v1/customers/{customerId}/reward-entitlements`
  /// (`reward.read`) — a plain array, not paginated, matching the backend
  /// contract exactly (Part U — Customer Detail's own list).
  Future<List<PosRewardEntitlement>> entitlementsForCustomer(String customerId);

  /// `GET /api/v1/reward-entitlements/{id}` (`reward.read`).
  Future<PosRewardEntitlement> entitlement(String id);

  /// `POST /api/v1/reward-entitlements/{id}/redeem` (`reward.redeem`) —
  /// server-authoritative redemption (Part I/J); [branchId] is optional,
  /// exactly matching the backend body schema. Never called unless the
  /// caller already confirmed `effectiveStatus == 'available'` on the
  /// entitlement being redeemed — the backend re-validates regardless,
  /// but this app never fabricates a client-side eligibility check.
  Future<PosRewardEntitlement> redeem(String id, {String? branchId});

  /// `POST /api/v1/customers/{customerId}/reward-entitlements`
  /// (`reward.issue`) — MANUAL admin issuance only, mirroring
  /// `PosMembershipsGateway.issueMembership`'s own "never the automatic
  /// path" contract (automatic issuance from a loyalty threshold happens
  /// server-side — no UI action here for that).
  Future<PosRewardEntitlement> issueManual({
    required String customerId,
    required String loyaltyProgramId,
    required String reasonCode,
    DateTime? expiresAt,
  });

  /// `POST /api/v1/reward-entitlements/{id}/revoke` (`reward.revoke`) —
  /// [version] is the entitlement's own already-fetched `version`, sent
  /// as the strong `If-Match` the backend requires.
  Future<PosRewardEntitlement> revoke(String id, {required String reason, required int version});

  /// `POST /api/v1/reward-entitlements/{id}/presentation-token`
  /// (`reward.read`) — issues/rotates a real presentation token for this
  /// entitlement. Only `reward.read` is required (not `reward.redeem`):
  /// generating a code to show is not itself a redemption.
  Future<PosRewardPresentationToken> issuePresentationToken(String entitlementId);

  /// `GET /api/v1/reward-entitlements/{id}/presentation-token/active`
  /// (`reward.read`) — `null` when no active token has ever been issued
  /// for this entitlement (never fabricated).
  Future<PosRewardPresentationToken?> activePresentationToken(String entitlementId);

  /// `POST /api/v1/reward-entitlements/resolve-token` (`reward.read`) —
  /// resolves an opaque token to its real, full entitlement (Part L/X);
  /// never itself a redemption — a caller still calls [redeem] separately
  /// once the entitlement's own `effectiveStatus` is confirmed
  /// `available`.
  Future<PosRewardEntitlement> resolvePresentationToken(String token);
}

class ApiPosRewardsGateway implements PosRewardsGateway {
  const ApiPosRewardsGateway(this._client);

  final ApiClient _client;

  @override
  Future<List<PosRewardEntitlement>> entitlementsForCustomer(String customerId) async {
    final envelope = await _client.getJson('/api/v1/customers/$customerId/reward-entitlements');
    final data = envelope['data'];
    if (data is! List<Object?>) {
      throw const FormatException('Missing reward entitlements data.');
    }
    return data.whereType<Map<String, Object?>>().map(PosRewardEntitlement.fromJson).toList(growable: false);
  }

  @override
  Future<PosRewardEntitlement> entitlement(String id) async {
    final envelope = await _client.getJson('/api/v1/reward-entitlements/$id');
    return _decode(envelope);
  }

  @override
  Future<PosRewardEntitlement> redeem(String id, {String? branchId}) async {
    final envelope = await _client.postJson(
      '/api/v1/reward-entitlements/$id/redeem',
      idempotencyKey: _idempotencyKey('reward-redeem'),
      body: {if (branchId != null) 'branch_id': branchId},
    );
    return _decode(envelope);
  }

  @override
  Future<PosRewardEntitlement> issueManual({
    required String customerId,
    required String loyaltyProgramId,
    required String reasonCode,
    DateTime? expiresAt,
  }) async {
    final envelope = await _client.postJson(
      '/api/v1/customers/$customerId/reward-entitlements',
      idempotencyKey: _idempotencyKey('reward-issue'),
      body: {
        'loyalty_program_id': loyaltyProgramId,
        'reason_code': reasonCode,
        if (expiresAt != null) 'expires_at': expiresAt.toUtc().toIso8601String(),
      },
    );
    return _decode(envelope);
  }

  @override
  Future<PosRewardEntitlement> revoke(String id, {required String reason, required int version}) async {
    final envelope = await _client.postJson(
      '/api/v1/reward-entitlements/$id/revoke',
      ifMatch: '"$version"',
      body: {'reason': reason},
    );
    return _decode(envelope);
  }

  @override
  Future<PosRewardPresentationToken> issuePresentationToken(String entitlementId) async {
    final envelope = await _client.postJson('/api/v1/reward-entitlements/$entitlementId/presentation-token');
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing reward presentation token data.');
    }
    return PosRewardPresentationToken.fromJson(data);
  }

  @override
  Future<PosRewardPresentationToken?> activePresentationToken(String entitlementId) async {
    final envelope = await _client.getJson('/api/v1/reward-entitlements/$entitlementId/presentation-token/active');
    final data = envelope['data'];
    if (data == null) return null;
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing reward presentation token data.');
    }
    return PosRewardPresentationToken.fromJson(data);
  }

  @override
  Future<PosRewardEntitlement> resolvePresentationToken(String token) async {
    final envelope = await _client.postJson(
      '/api/v1/reward-entitlements/resolve-token',
      body: {'token': token},
    );
    return _decode(envelope);
  }

  static String _idempotencyKey(String kind) => 'one-$kind-${DateTime.now().toUtc().microsecondsSinceEpoch}';

  PosRewardEntitlement _decode(Map<String, Object?> envelope) {
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing reward entitlement data.');
    }
    return PosRewardEntitlement.fromJson(data);
  }
}

class EmptyPosRewardsGateway implements PosRewardsGateway {
  const EmptyPosRewardsGateway();

  @override
  Future<List<PosRewardEntitlement>> entitlementsForCustomer(String customerId) async => const [];

  @override
  Future<PosRewardEntitlement> entitlement(String id) =>
      Future.error(StateError('No rewards gateway is configured.'));

  @override
  Future<PosRewardEntitlement> redeem(String id, {String? branchId}) =>
      Future.error(StateError('No rewards gateway is configured.'));

  @override
  Future<PosRewardEntitlement> issueManual({
    required String customerId,
    required String loyaltyProgramId,
    required String reasonCode,
    DateTime? expiresAt,
  }) => Future.error(StateError('No rewards gateway is configured.'));

  @override
  Future<PosRewardEntitlement> revoke(String id, {required String reason, required int version}) =>
      Future.error(StateError('No rewards gateway is configured.'));

  @override
  Future<PosRewardPresentationToken> issuePresentationToken(String entitlementId) =>
      Future.error(StateError('No rewards gateway is configured.'));

  @override
  Future<PosRewardPresentationToken?> activePresentationToken(String entitlementId) =>
      Future.error(StateError('No rewards gateway is configured.'));

  @override
  Future<PosRewardEntitlement> resolvePresentationToken(String token) =>
      Future.error(StateError('No rewards gateway is configured.'));
}
