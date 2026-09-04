import '../../core/networking/api_client.dart';

/// TASK 13.0: the Flutter side of the customer-identity foundation — see
/// ADR-0017 for the full backend design this mirrors. Every model here is
/// exactly what the backend returns; nothing is recomputed, merged, or
/// guessed client-side (ADR-0017 D5: no automatic merge exists anywhere in
/// this pass — a duplicate/conflict is always surfaced honestly, never
/// silently resolved). Styled after `pos_promotions_gateway.dart`
/// (TASK 12.9), the most recent prior gateway of this shape.

/// A `customers` row (`CustomerRow`/`customerHttp` in
/// `customers.routes.ts`) — the FULL record, only ever returned by
/// `POST /customers`, `GET /customers/{id}`, and `PATCH /customers/{id}`.
/// Never confuse with [PosCustomerSummary] — a list row deliberately
/// carries no email/phone/birth date (Part AB/W privacy).
class PosCustomer {
  const PosCustomer({
    required this.id,
    required this.firstName,
    required this.lastName,
    required this.displayName,
    required this.email,
    required this.phone,
    required this.birthDate,
    required this.status,
    required this.notes,
    required this.createdBy,
    required this.updatedBy,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
  });

  factory PosCustomer.fromJson(Map<String, Object?> json) => PosCustomer(
    id: json['id']! as String,
    firstName: json['first_name']! as String,
    lastName: json['last_name'] as String?,
    displayName: json['display_name']! as String,
    email: json['email'] as String?,
    phone: json['phone'] as String?,
    birthDate: json['birth_date'] as String?,
    status: json['status']! as String,
    notes: json['notes'] as String?,
    createdBy: json['created_by']! as String,
    updatedBy: json['updated_by']! as String,
    version: json['version']! as int,
    createdAt: DateTime.parse(json['created_at']! as String),
    updatedAt: DateTime.parse(json['updated_at']! as String),
  );

  final String id;
  final String firstName;
  final String? lastName;
  final String displayName;
  final String? email;
  final String? phone;

  /// `YYYY-MM-DD`, exactly as the backend returns it — never parsed into a
  /// [DateTime] here (a plain calendar date has no time zone to guess).
  final String? birthDate;

  /// `active` | `inactive` | `archived` (ADR-0017 D18 — never a delete).
  final String status;
  final String? notes;
  final String createdBy;
  final String updatedBy;
  final int version;
  final DateTime createdAt;
  final DateTime updatedAt;
}

/// `GET /customers` row (`customerSummaryHttp`) — deliberately a
/// *summary*, never the full contact record (Part AB/W: a dense list must
/// never expose phone/email/birth date).
class PosCustomerSummary {
  const PosCustomerSummary({
    required this.id,
    required this.displayName,
    required this.status,
    required this.version,
    required this.createdAt,
  });

  factory PosCustomerSummary.fromJson(Map<String, Object?> json) => PosCustomerSummary(
    id: json['id']! as String,
    displayName: json['display_name']! as String,
    status: json['status']! as String,
    version: json['version']! as int,
    createdAt: DateTime.parse(json['created_at']! as String),
  );

  final String id;
  final String displayName;
  final String status;
  final int version;
  final DateTime createdAt;
}

class PosCustomerPage {
  const PosCustomerPage({required this.items, required this.nextCursor});
  final List<PosCustomerSummary> items;
  final String? nextCursor;
}

/// The minimal create/update input both `POST /customers` and
/// `PATCH /customers/{id}` accept — every field but `firstName` optional
/// (minimum-friction registration, per Part E/Y). `status` is only ever
/// meaningful on an update (creation always starts `active` server-side).
class PosCustomerInput {
  const PosCustomerInput({
    this.firstName,
    this.lastName,
    this.displayName,
    this.email,
    this.phone,
    this.birthDate,
    this.status,
    this.notes,
  });

  final String? firstName;
  final String? lastName;
  final String? displayName;
  final String? email;
  final String? phone;

  /// `YYYY-MM-DD`.
  final String? birthDate;
  final String? status;
  final String? notes;

  Map<String, Object?> toJson() => {
    if (firstName != null) 'first_name': firstName,
    if (lastName != null) 'last_name': lastName,
    if (displayName != null) 'display_name': displayName,
    if (email != null) 'email': email,
    if (phone != null) 'phone': phone,
    if (birthDate != null) 'birth_date': birthDate,
    if (status != null) 'status': status,
    if (notes != null) 'notes': notes,
  };
}

/// `customer_qr_tokens` row (`qrTokenHttp`) — [token] is an OPAQUE,
/// cryptographically random identifier (ADR-0017 D16), never derived from
/// or containing the customer's name/email/phone. This app never encodes
/// it into a QR image itself (no QR-rendering package is a pre-existing
/// dependency — see `pubspec.yaml`); it is shown as selectable/copyable
/// text instead, exactly as the task's own scope permits.
class PosCustomerQrToken {
  const PosCustomerQrToken({
    required this.id,
    required this.customerId,
    required this.token,
    required this.status,
    required this.createdAt,
  });

  factory PosCustomerQrToken.fromJson(Map<String, Object?> json) => PosCustomerQrToken(
    id: json['id']! as String,
    customerId: json['customer_id']! as String,
    token: json['token']! as String,
    status: json['status']! as String,
    createdAt: DateTime.parse(json['created_at']! as String),
  );

  final String id;
  final String customerId;
  final String token;

  /// `active` | `revoked`.
  final String status;
  final DateTime createdAt;
}

/// Maps a 409 `resource_conflict`/`customer_identity_conflict`
/// [ApiException] (from `createCustomer`/`updateCustomer`) to an honest,
/// short Spanish message plus whichever existing-customer id(s) the
/// backend's own `details` carried (ADR-0017 D5) — so a caller can offer
/// "usar cliente existente" instead of retrying blindly. Returns `null`
/// for any other error (the caller falls back to [error]'s own
/// `failure.message`).
class PosCustomerConflict {
  const PosCustomerConflict({required this.message, required this.existingCustomerId});
  final String message;
  final String? existingCustomerId;
}

PosCustomerConflict? posCustomerConflictFrom(ApiException error) {
  final code = error.failure.code;
  final details = error.details;
  if (code == 'customer_identity_conflict') {
    return PosCustomerConflict(
      message: 'El correo y el teléfono ya pertenecen a clientes distintos.',
      // ADR-0017 D5: two DIFFERENT existing customers in this case — no
      // single "the" existing customer to offer, so this stays `null`
      // (never guesses which of the two the caller meant).
      existingCustomerId: null,
    );
  }
  if (code == 'resource_conflict') {
    final existingId = details?['existing_customer_id'];
    return PosCustomerConflict(
      message: 'Ya existe un cliente con ese correo o teléfono.',
      existingCustomerId: existingId is String ? existingId : null,
    );
  }
  return null;
}

abstract interface class PosCustomersGateway {
  /// `POST /api/v1/customers` (`customer.create`). Throws [ApiException]
  /// honestly on any rejection, including a 409 conflict — see
  /// [posCustomerConflictFrom] for how a caller should surface that one.
  Future<PosCustomer> createCustomer(PosCustomerInput input);

  /// `GET /api/v1/customers` (`customer.read`) — a *summary* page, never
  /// the full contact record (Part AB/W). `search` matches display name
  /// (substring), normalized email, or normalized phone (exact) —
  /// server-side only, never re-filtered locally.
  Future<PosCustomerPage> listCustomers({
    String? cursor,
    int limit = 50,
    String? search,
    String? status,
  });

  /// `GET /api/v1/customers/{id}` (`customer.read`) — the full record.
  Future<PosCustomer> customer(String id);

  /// `PATCH /api/v1/customers/{id}` (`customer.update`) — [version] is the
  /// row's own already-fetched `version`, sent as the strong `If-Match`
  /// the backend requires.
  Future<PosCustomer> updateCustomer(String id, PosCustomerInput input, {required int version});

  /// `POST /api/v1/customers/{id}/qr-tokens` (`customer.update`) — issues/
  /// rotates the customer's QR identity token.
  Future<PosCustomerQrToken> issueQrToken(String customerId);

  /// `GET /api/v1/customers/{id}/qr-tokens/active` (`customer.read`) —
  /// `null` when no active token has ever been issued (never fabricated).
  Future<PosCustomerQrToken?> activeQrToken(String customerId);

  /// `POST /api/v1/customers/qr-tokens/resolve` (`customer.read`).
  Future<PosCustomer> resolveQrToken(String token);
}

class ApiPosCustomersGateway implements PosCustomersGateway {
  const ApiPosCustomersGateway(this._client);

  final ApiClient _client;

  @override
  Future<PosCustomer> createCustomer(PosCustomerInput input) async {
    final envelope = await _client.postJson(
      '/api/v1/customers',
      idempotencyKey: _idempotencyKey(),
      body: input.toJson(),
    );
    return _decodeCustomer(envelope);
  }

  @override
  Future<PosCustomerPage> listCustomers({
    String? cursor,
    int limit = 50,
    String? search,
    String? status,
  }) async {
    final query = <String, String>{
      'limit': '$limit',
      if (cursor != null) 'cursor': cursor,
      if (search != null && search.isNotEmpty) 'search': search,
      if (status != null) 'status': status,
    };
    final path = Uri(path: '/api/v1/customers', queryParameters: query).toString();
    final envelope = await _client.getJson(path);
    final data = envelope['data'];
    if (data is! List<Object?>) {
      throw const FormatException('Missing customers list data.');
    }
    final meta = envelope['meta'];
    final page = meta is Map<String, Object?> ? meta['page'] : null;
    final nextCursor = page is Map<String, Object?> ? page['next_cursor'] as String? : null;
    return PosCustomerPage(
      items: data.whereType<Map<String, Object?>>().map(PosCustomerSummary.fromJson).toList(growable: false),
      nextCursor: nextCursor,
    );
  }

  @override
  Future<PosCustomer> customer(String id) async {
    final envelope = await _client.getJson('/api/v1/customers/$id');
    return _decodeCustomer(envelope);
  }

  @override
  Future<PosCustomer> updateCustomer(String id, PosCustomerInput input, {required int version}) async {
    final envelope = await _client.patchJson(
      '/api/v1/customers/$id',
      ifMatch: '"$version"',
      body: input.toJson(),
    );
    return _decodeCustomer(envelope);
  }

  @override
  Future<PosCustomerQrToken> issueQrToken(String customerId) async {
    final envelope = await _client.postJson('/api/v1/customers/$customerId/qr-tokens');
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing QR token data.');
    }
    return PosCustomerQrToken.fromJson(data);
  }

  @override
  Future<PosCustomerQrToken?> activeQrToken(String customerId) async {
    final envelope = await _client.getJson('/api/v1/customers/$customerId/qr-tokens/active');
    final data = envelope['data'];
    if (data == null) return null;
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing QR token data.');
    }
    return PosCustomerQrToken.fromJson(data);
  }

  @override
  Future<PosCustomer> resolveQrToken(String token) async {
    final envelope = await _client.postJson(
      '/api/v1/customers/qr-tokens/resolve',
      body: {'token': token},
    );
    return _decodeCustomer(envelope);
  }

  static String _idempotencyKey() => 'one-customer-${DateTime.now().toUtc().microsecondsSinceEpoch}';

  PosCustomer _decodeCustomer(Map<String, Object?> envelope) {
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing customer data.');
    }
    return PosCustomer.fromJson(data);
  }
}

class EmptyPosCustomersGateway implements PosCustomersGateway {
  const EmptyPosCustomersGateway();

  @override
  Future<PosCustomer> createCustomer(PosCustomerInput input) =>
      Future.error(StateError('No customers gateway is configured.'));

  @override
  Future<PosCustomerPage> listCustomers({
    String? cursor,
    int limit = 50,
    String? search,
    String? status,
  }) async => const PosCustomerPage(items: [], nextCursor: null);

  @override
  Future<PosCustomer> customer(String id) => Future.error(StateError('No customers gateway is configured.'));

  @override
  Future<PosCustomer> updateCustomer(String id, PosCustomerInput input, {required int version}) =>
      Future.error(StateError('No customers gateway is configured.'));

  @override
  Future<PosCustomerQrToken> issueQrToken(String customerId) =>
      Future.error(StateError('No customers gateway is configured.'));

  @override
  Future<PosCustomerQrToken?> activeQrToken(String customerId) async => null;

  @override
  Future<PosCustomer> resolveQrToken(String token) =>
      Future.error(StateError('No customers gateway is configured.'));
}
