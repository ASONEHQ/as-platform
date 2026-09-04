import '../../core/networking/api_client.dart';

/// TASK 13.0: the Flutter side of the membership plan/entitlement
/// foundation — see ADR-0017 (D8-D11) for the full backend design this
/// mirrors. `membership_plans` is the PRODUCT/RULE definition;
/// `customer_memberships` is the ISSUED entitlement — never blurred into
/// one model here either. Styled after `pos_promotions_gateway.dart`
/// (TASK 12.9).

/// A `membership_plans` row (`MembershipPlanRow`/`planHttp`).
class PosMembershipPlan {
  const PosMembershipPlan({
    required this.id,
    required this.name,
    required this.description,
    required this.active,
    required this.productId,
    required this.durationDays,
    required this.benefitDescription,
    required this.branchIds,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
  });

  factory PosMembershipPlan.fromJson(Map<String, Object?> json) => PosMembershipPlan(
    id: json['id']! as String,
    name: json['name']! as String,
    description: json['description'] as String?,
    active: json['active'] == true,
    productId: json['product_id'] as String?,
    durationDays: json['duration_days'] as int?,
    benefitDescription: json['benefit_description'] as String?,
    branchIds: (json['branch_ids'] as List<Object?>?)?.whereType<String>().toList(growable: false) ?? const [],
    version: json['version']! as int,
    createdAt: DateTime.parse(json['created_at']! as String),
    updatedAt: DateTime.parse(json['updated_at']! as String),
  );

  final String id;
  final String name;
  final String? description;
  final bool active;

  /// The sellable product this plan activates on payment, if any (ADR-0017
  /// D8/D9) — `null` for a plan only ever issued manually.
  final String? productId;
  final int? durationDays;
  final String? benefitDescription;
  final List<String> branchIds;
  final int version;
  final DateTime createdAt;
  final DateTime updatedAt;
}

class PosMembershipPlanInput {
  const PosMembershipPlanInput({
    this.name,
    this.description,
    this.active,
    this.productId,
    this.durationDays,
    this.benefitDescription,
    this.branchIds,
  });

  final String? name;
  final String? description;
  final bool? active;
  final String? productId;
  final int? durationDays;
  final String? benefitDescription;
  final List<String>? branchIds;

  Map<String, Object?> toJson() => {
    if (name != null) 'name': name,
    if (description != null) 'description': description,
    if (active != null) 'active': active,
    if (productId != null) 'product_id': productId,
    if (durationDays != null) 'duration_days': durationDays,
    if (benefitDescription != null) 'benefit_description': benefitDescription,
    if (branchIds != null) 'branch_ids': branchIds,
  };
}

/// A `customer_memberships` row (`CustomerMembershipRow`/`membershipHttp`)
/// — the ISSUED entitlement, one row per period a customer actually holds
/// (ADR-0017 D8/D10: a renewal is a NEW row, never a mutated `expires_at`).
class PosCustomerMembership {
  const PosCustomerMembership({
    required this.id,
    required this.customerId,
    required this.membershipPlanId,
    required this.membershipNumber,
    required this.status,
    required this.startsAt,
    required this.expiresAt,
    required this.issuedAt,
    required this.sourceSaleId,
    required this.renewedFromMembershipId,
    required this.cancelledAt,
    required this.version,
  });

  factory PosCustomerMembership.fromJson(Map<String, Object?> json) => PosCustomerMembership(
    id: json['id']! as String,
    customerId: json['customer_id']! as String,
    membershipPlanId: json['membership_plan_id']! as String,
    membershipNumber: json['membership_number']! as String,
    status: json['status']! as String,
    startsAt: DateTime.parse(json['starts_at']! as String),
    expiresAt: json['expires_at'] == null ? null : DateTime.parse(json['expires_at']! as String),
    issuedAt: DateTime.parse(json['issued_at']! as String),
    sourceSaleId: json['source_sale_id'] as String?,
    renewedFromMembershipId: json['renewed_from_membership_id'] as String?,
    cancelledAt: json['cancelled_at'] == null ? null : DateTime.parse(json['cancelled_at']! as String),
    version: json['version']! as int,
  );

  final String id;
  final String customerId;
  final String membershipPlanId;
  final String membershipNumber;

  /// `pending` | `active` | `expired` | `cancelled` — a DISPLAY status
  /// only, never the source of an "is this valid right now" decision; use
  /// [PosMembershipsGateway.validate] for that (ADR-0017 D11).
  final String status;
  final DateTime startsAt;
  final DateTime? expiresAt;
  final DateTime issuedAt;
  final String? sourceSaleId;
  final String? renewedFromMembershipId;
  final DateTime? cancelledAt;
  final int version;
}

/// `POST /memberships/validate`'s response — the ONE source of truth for
/// "is this membership valid right now" (ADR-0017 D11). Never recomputed
/// from [PosCustomerMembership.status]/`expiresAt` client-side anywhere.
class PosMembershipValidation {
  const PosMembershipValidation({
    required this.valid,
    required this.reason,
    required this.eligibleBranch,
    required this.membership,
  });

  factory PosMembershipValidation.fromJson(Map<String, Object?> json) {
    final rawMembership = json['membership'];
    return PosMembershipValidation(
      valid: json['valid'] == true,
      reason: json['reason'] as String?,
      eligibleBranch: json['eligible_branch'] == true,
      membership: rawMembership is Map<String, Object?> ? PosCustomerMembership.fromJson(rawMembership) : null,
    );
  }

  final bool valid;
  final String? reason;
  final bool eligibleBranch;
  final PosCustomerMembership? membership;
}

abstract interface class PosMembershipsGateway {
  /// `POST /api/v1/membership-plans` (`membership.manage`).
  Future<PosMembershipPlan> createPlan(PosMembershipPlanInput input);

  /// `GET /api/v1/membership-plans` (`membership.read`) — a plain array,
  /// not paginated (matches the backend contract exactly).
  Future<List<PosMembershipPlan>> listPlans({bool? active});

  /// `GET /api/v1/membership-plans/{id}` (`membership.read`).
  Future<PosMembershipPlan> plan(String id);

  /// `PUT /api/v1/membership-plans/{id}` (`membership.manage`).
  Future<PosMembershipPlan> updatePlan(String id, PosMembershipPlanInput input, {required int version});

  /// `GET /api/v1/customers/{customerId}/memberships` (`membership.read`).
  Future<List<PosCustomerMembership>> membershipsForCustomer(String customerId);

  /// `POST /api/v1/customers/{customerId}/memberships` (`membership.issue`)
  /// — MANUAL admin issuance only, never the POS-purchase path (which
  /// happens automatically server-side on payment settlement — ADR-0017
  /// D9 — no UI action here for that).
  Future<PosCustomerMembership> issueMembership({
    required String customerId,
    required String membershipPlanId,
    DateTime? startsAt,
  });

  /// `POST /api/v1/customer-memberships/{id}/renew` (`membership.issue`) —
  /// a NEW row (ADR-0017 D10), never returned in place of the original.
  Future<PosCustomerMembership> renewMembership(String id);

  /// `POST /api/v1/customer-memberships/{id}/cancel` (`membership.manage`).
  Future<PosCustomerMembership> cancelMembership(String id, {required String reason, required int version});

  /// `POST /api/v1/memberships/validate` (`membership.read`) — the ONE
  /// source of truth for real-time validity (ADR-0017 D11).
  Future<PosMembershipValidation> validate({required String customerId, required String branchId});
}

class ApiPosMembershipsGateway implements PosMembershipsGateway {
  const ApiPosMembershipsGateway(this._client);

  final ApiClient _client;

  @override
  Future<PosMembershipPlan> createPlan(PosMembershipPlanInput input) async {
    final envelope = await _client.postJson(
      '/api/v1/membership-plans',
      idempotencyKey: _idempotencyKey('plan'),
      body: input.toJson(),
    );
    return _decodePlan(envelope);
  }

  @override
  Future<List<PosMembershipPlan>> listPlans({bool? active}) async {
    final query = <String, String>{if (active != null) 'active': '$active'};
    final path = Uri(path: '/api/v1/membership-plans', queryParameters: query.isEmpty ? null : query).toString();
    final envelope = await _client.getJson(path);
    final data = envelope['data'];
    if (data is! List<Object?>) {
      throw const FormatException('Missing membership plans data.');
    }
    return data.whereType<Map<String, Object?>>().map(PosMembershipPlan.fromJson).toList(growable: false);
  }

  @override
  Future<PosMembershipPlan> plan(String id) async {
    final envelope = await _client.getJson('/api/v1/membership-plans/$id');
    return _decodePlan(envelope);
  }

  @override
  Future<PosMembershipPlan> updatePlan(String id, PosMembershipPlanInput input, {required int version}) async {
    final envelope = await _client.putJson(
      '/api/v1/membership-plans/$id',
      ifMatch: '"$version"',
      body: input.toJson(),
    );
    return _decodePlan(envelope);
  }

  @override
  Future<List<PosCustomerMembership>> membershipsForCustomer(String customerId) async {
    final envelope = await _client.getJson('/api/v1/customers/$customerId/memberships');
    final data = envelope['data'];
    if (data is! List<Object?>) {
      throw const FormatException('Missing memberships data.');
    }
    return data.whereType<Map<String, Object?>>().map(PosCustomerMembership.fromJson).toList(growable: false);
  }

  @override
  Future<PosCustomerMembership> issueMembership({
    required String customerId,
    required String membershipPlanId,
    DateTime? startsAt,
  }) async {
    final envelope = await _client.postJson(
      '/api/v1/customers/$customerId/memberships',
      idempotencyKey: _idempotencyKey('membership'),
      body: {
        'membership_plan_id': membershipPlanId,
        if (startsAt != null) 'starts_at': startsAt.toUtc().toIso8601String(),
      },
    );
    return _decodeMembership(envelope);
  }

  @override
  Future<PosCustomerMembership> renewMembership(String id) async {
    final envelope = await _client.postJson(
      '/api/v1/customer-memberships/$id/renew',
      idempotencyKey: _idempotencyKey('renew'),
    );
    return _decodeMembership(envelope);
  }

  @override
  Future<PosCustomerMembership> cancelMembership(String id, {required String reason, required int version}) async {
    final envelope = await _client.postJson(
      '/api/v1/customer-memberships/$id/cancel',
      ifMatch: '"$version"',
      body: {'reason': reason},
    );
    return _decodeMembership(envelope);
  }

  @override
  Future<PosMembershipValidation> validate({required String customerId, required String branchId}) async {
    final envelope = await _client.postJson(
      '/api/v1/memberships/validate',
      body: {'customer_id': customerId, 'branch_id': branchId},
    );
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing membership validation data.');
    }
    return PosMembershipValidation.fromJson(data);
  }

  static String _idempotencyKey(String kind) => 'one-$kind-${DateTime.now().toUtc().microsecondsSinceEpoch}';

  PosMembershipPlan _decodePlan(Map<String, Object?> envelope) {
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing membership plan data.');
    }
    return PosMembershipPlan.fromJson(data);
  }

  PosCustomerMembership _decodeMembership(Map<String, Object?> envelope) {
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing membership data.');
    }
    return PosCustomerMembership.fromJson(data);
  }
}

class EmptyPosMembershipsGateway implements PosMembershipsGateway {
  const EmptyPosMembershipsGateway();

  @override
  Future<PosMembershipPlan> createPlan(PosMembershipPlanInput input) =>
      Future.error(StateError('No memberships gateway is configured.'));

  @override
  Future<List<PosMembershipPlan>> listPlans({bool? active}) async => const [];

  @override
  Future<PosMembershipPlan> plan(String id) => Future.error(StateError('No memberships gateway is configured.'));

  @override
  Future<PosMembershipPlan> updatePlan(String id, PosMembershipPlanInput input, {required int version}) =>
      Future.error(StateError('No memberships gateway is configured.'));

  @override
  Future<List<PosCustomerMembership>> membershipsForCustomer(String customerId) async => const [];

  @override
  Future<PosCustomerMembership> issueMembership({
    required String customerId,
    required String membershipPlanId,
    DateTime? startsAt,
  }) => Future.error(StateError('No memberships gateway is configured.'));

  @override
  Future<PosCustomerMembership> renewMembership(String id) =>
      Future.error(StateError('No memberships gateway is configured.'));

  @override
  Future<PosCustomerMembership> cancelMembership(String id, {required String reason, required int version}) =>
      Future.error(StateError('No memberships gateway is configured.'));

  @override
  Future<PosMembershipValidation> validate({required String customerId, required String branchId}) =>
      Future.error(StateError('No memberships gateway is configured.'));
}
