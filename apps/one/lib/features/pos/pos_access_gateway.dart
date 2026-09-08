/// TASK 14.4 (Wave 2, Part E): the Flutter side of `access.routes.ts` — the
/// REAL "Control de Acceso" replacement for the legacy's own fake ticket
/// scanner (`docs/LEGACY_FUNCTIONAL_PARITY.md`'s Accesos section: the
/// legacy's `accScan()` accepted ANY input and fabricated a random customer
/// name, always reporting success). Every method here maps 1:1 to a real,
/// already-tested backend route — issue a credential against a real, paid
/// sale; scan a code (the backend infers entry-vs-exit from the
/// credential's own state); void; list who is currently inside; list the
/// immutable entry/exit event history; and read the authoritative
/// server-side occupancy count. Styled after `pos_held_sales_gateway.dart`/
/// `pos_parties_gateway.dart` — same HTTP/error-handling conventions, same
/// `ApiPos*Gateway`/`EmptyPos*Gateway` split.
library;

import '../../core/networking/api_client.dart';

/// A plain 1:1 mapping of `AccessCredentialRow` (`access.types.ts`) — never
/// a sentinel; every field is a real value the backend actually returned.
class PosAccessCredential {
  const PosAccessCredential({
    required this.id,
    required this.branchId,
    required this.code,
    required this.saleId,
    required this.customerId,
    required this.allowsReentry,
    required this.status,
    required this.currentlyInside,
    required this.issuedAt,
    required this.issuedBy,
    required this.voidedAt,
    required this.voidedBy,
  });

  factory PosAccessCredential.fromJson(Map<String, Object?> json) => PosAccessCredential(
    id: json['id']! as String,
    branchId: json['branch_id']! as String,
    code: json['code']! as String,
    saleId: json['sale_id'] as String?,
    customerId: json['customer_id'] as String?,
    allowsReentry: json['allows_reentry']! as bool,
    status: json['status']! as String,
    currentlyInside: json['currently_inside']! as bool,
    issuedAt: DateTime.parse(json['issued_at']! as String),
    issuedBy: json['issued_by']! as String,
    voidedAt: json['voided_at'] == null ? null : DateTime.parse(json['voided_at']! as String),
    voidedBy: json['voided_by'] as String?,
  );

  final String id;
  final String branchId;
  final String code;
  final String? saleId;
  final String? customerId;
  final bool allowsReentry;
  // `accessCredentialStatuses`: 'issued' | 'void' — never a project-invented
  // 3rd state.
  final String status;
  final bool currentlyInside;
  final DateTime issuedAt;
  final String issuedBy;
  final DateTime? voidedAt;
  final String? voidedBy;

  bool get isVoid => status == 'void';
}

/// A plain 1:1 mapping of `AccessEventRow` — immutable, append-only, exactly
/// like the backend's own row (see `access.types.ts`'s own doc comment).
/// Never edited/removed anywhere in this app either.
class PosAccessEvent {
  const PosAccessEvent({
    required this.id,
    required this.branchId,
    required this.credentialId,
    required this.eventType,
    required this.occurredAt,
    required this.createdBy,
    required this.createdAt,
  });

  factory PosAccessEvent.fromJson(Map<String, Object?> json) => PosAccessEvent(
    id: json['id']! as String,
    branchId: json['branch_id']! as String,
    credentialId: json['credential_id']! as String,
    eventType: json['event_type']! as String,
    occurredAt: DateTime.parse(json['occurred_at']! as String),
    createdBy: json['created_by']! as String,
    createdAt: DateTime.parse(json['created_at']! as String),
  );

  final String id;
  final String branchId;
  final String credentialId;
  // `accessEventTypes`: 'entry' | 'exit'.
  final String eventType;
  final DateTime occurredAt;
  final String createdBy;
  final DateTime createdAt;

  bool get isEntry => eventType == 'entry';
}

/// `POST /api/v1/access-credentials/scan`'s own success shape — the
/// credential's fresh post-scan state plus the exact event it just
/// recorded. A scan either returns this (a real state change genuinely
/// happened) or throws [ApiException] (nothing happened) — there is no
/// third, ambiguous outcome.
class PosAccessScanResult {
  const PosAccessScanResult({required this.credential, required this.event});
  final PosAccessCredential credential;
  final PosAccessEvent event;
}

/// A generic cursor page — matches both `GET /access-credentials`
/// (currently-inside) and `GET /access-events` exactly.
class PosAccessPage<T> {
  const PosAccessPage({required this.items, required this.nextCursor});
  final List<T> items;
  final String? nextCursor;
}

/// Maps an access-domain [ApiException] to an honest, specific Spanish
/// message. `access.http-errors.ts` deliberately reuses generic
/// infrastructure codes at the HTTP layer (`resource_conflict`/`not_found`/
/// `validation_error` — see that file's own doc comment on why: this task
/// forbids editing `packages/errors/src/index.ts` directly) and instead
/// carries the SPECIFIC `AccessErrorCode` in `error.details.reason` for the
/// seven scan/void rejections this domain names. This function always
/// checks that specific reason FIRST — never trusting the generic top-level
/// code's own shared message (which means something else in another
/// domain, e.g. `resource_conflict` is refund-scoped in
/// `core/errors/app_error.dart`), and only falls back to the generic
/// message for a code this function doesn't special-case.
String posAccessErrorMessage(ApiException error) {
  final reason = error.details?['reason'];
  if (reason is String) {
    switch (reason) {
      case 'credential_not_found':
        return 'Este código no corresponde a ningún pase de acceso.';
      case 'credential_void':
        return 'Este pase de acceso fue anulado.';
      case 'wrong_branch':
        return 'Este pase de acceso pertenece a otra sucursal.';
      case 'already_inside':
        return 'Este pase de acceso ya registró su entrada — no puede volver a entrar sin registrar antes una salida.';
      case 'not_inside':
        return 'Este pase de acceso no está registrado como dentro — no puede registrarse una salida.';
      case 'reentry_not_allowed':
        return 'Este pase de acceso ya completó su único ciclo de entrada y salida — no permite reingreso.';
      case 'credential_currently_inside':
        return 'Este pase de acceso está actualmente dentro — registra su salida antes de anularlo.';
    }
  }
  return error.failure.message;
}

abstract interface class PosAccessGateway {
  /// `POST /api/v1/access-credentials` (`access.scan`) — issues a real
  /// credential against an already-paid `saleId`; the backend itself
  /// validates the sale exists, belongs to this branch, and is
  /// `completed` before ever generating a code. Idempotency-keyed (a
  /// network retry must not mint a second credential for the same sale).
  Future<PosAccessCredential> issueCredential({
    required String branchId,
    required String saleId,
    String? customerId,
    bool? allowsReentry,
  });

  /// `POST /api/v1/access-credentials/scan` (`access.scan`) — the real
  /// scanner. The backend infers entry-vs-exit from the credential's own
  /// current state; a rejection always throws [ApiException] with the
  /// honest, specific reason in `details.reason` (see
  /// [posAccessErrorMessage]) — never a fabricated success. Deliberately
  /// NOT idempotency-keyed, mirroring `AccessService.scan`'s own doc
  /// comment: a retried scan of the same code lands on its own clean,
  /// correct rejection rather than needing a safety net.
  Future<PosAccessScanResult> scan({required String branchId, required String code});

  /// `POST /api/v1/access-credentials/{id}/void` (`access.manage`) —
  /// rejected with `credential_currently_inside` if the credential is
  /// currently inside (the backend's own real policy: process a real exit
  /// first, never a silent implicit exit). Idempotency-keyed.
  Future<PosAccessCredential> voidCredential(String id);

  /// `GET /api/v1/access-credentials` (`access.read`) — always filtered to
  /// `currently_inside=true` server-side; there is no general "every
  /// credential ever issued" endpoint.
  Future<PosAccessPage<PosAccessCredential>> currentlyInside({
    String? branchId,
    String? cursor,
    int limit = 50,
  });

  /// `GET /api/v1/access-events` (`access.read`) — immutable, paginated
  /// entry/exit history.
  Future<PosAccessPage<PosAccessEvent>> listEvents({
    String? branchId,
    String? cursor,
    int limit = 50,
    DateTime? occurredFrom,
    DateTime? occurredTo,
  });

  /// `GET /api/v1/access-credentials/occupancy` (`access.read`) — the ONE
  /// authoritative, server-computed occupancy count for a branch. Callers
  /// must always show this value directly and never recompute it
  /// client-side (e.g. by counting a locally-held `currentlyInside` page),
  /// which would silently drift once that list is paginated/filtered.
  Future<int> occupancy({required String branchId});
}

class ApiPosAccessGateway implements PosAccessGateway {
  const ApiPosAccessGateway(this._client, {this.createIdempotencyKey = _defaultIdempotencyKey});

  final ApiClient _client;
  final String Function() createIdempotencyKey;

  static String _defaultIdempotencyKey() =>
      'one-access-credential-${DateTime.now().toUtc().microsecondsSinceEpoch}';

  @override
  Future<PosAccessCredential> issueCredential({
    required String branchId,
    required String saleId,
    String? customerId,
    bool? allowsReentry,
  }) async {
    final envelope = await _client.postJson(
      '/api/v1/access-credentials',
      idempotencyKey: createIdempotencyKey(),
      body: {
        'branch_id': branchId,
        'sale_id': saleId,
        if (customerId != null) 'customer_id': customerId,
        if (allowsReentry != null) 'allows_reentry': allowsReentry,
      },
    );
    return _decodeCredential(envelope);
  }

  @override
  Future<PosAccessScanResult> scan({required String branchId, required String code}) async {
    final envelope = await _client.postJson(
      '/api/v1/access-credentials/scan',
      body: {'branch_id': branchId, 'code': code},
    );
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing access-credentials/scan data.');
    }
    final credential = data['credential'];
    final event = data['event'];
    if (credential is! Map<String, Object?> || event is! Map<String, Object?>) {
      throw const FormatException('Missing access-credentials/scan credential/event.');
    }
    return PosAccessScanResult(
      credential: PosAccessCredential.fromJson(credential),
      event: PosAccessEvent.fromJson(event),
    );
  }

  @override
  Future<PosAccessCredential> voidCredential(String id) async {
    final envelope = await _client.postJson(
      '/api/v1/access-credentials/$id/void',
      idempotencyKey: createIdempotencyKey(),
    );
    return _decodeCredential(envelope);
  }

  @override
  Future<PosAccessPage<PosAccessCredential>> currentlyInside({
    String? branchId,
    String? cursor,
    int limit = 50,
  }) async {
    final query = <String, String>{
      'limit': '$limit',
      if (cursor != null) 'cursor': cursor,
      if (branchId != null) 'branch_id': branchId,
    };
    final path = Uri(path: '/api/v1/access-credentials', queryParameters: query).toString();
    final envelope = await _client.getJson(path);
    return _decodePage(envelope, PosAccessCredential.fromJson);
  }

  @override
  Future<PosAccessPage<PosAccessEvent>> listEvents({
    String? branchId,
    String? cursor,
    int limit = 50,
    DateTime? occurredFrom,
    DateTime? occurredTo,
  }) async {
    final query = <String, String>{
      'limit': '$limit',
      if (cursor != null) 'cursor': cursor,
      if (branchId != null) 'branch_id': branchId,
      if (occurredFrom != null) 'occurred_from': occurredFrom.toUtc().toIso8601String(),
      if (occurredTo != null) 'occurred_to': occurredTo.toUtc().toIso8601String(),
    };
    final path = Uri(path: '/api/v1/access-events', queryParameters: query).toString();
    final envelope = await _client.getJson(path);
    return _decodePage(envelope, PosAccessEvent.fromJson);
  }

  @override
  Future<int> occupancy({required String branchId}) async {
    final path = Uri(
      path: '/api/v1/access-credentials/occupancy',
      queryParameters: {'branch_id': branchId},
    ).toString();
    final envelope = await _client.getJson(path);
    final data = envelope['data'];
    if (data is! Map<String, Object?> || data['count'] is! int) {
      throw const FormatException('Missing access-credentials/occupancy count.');
    }
    return data['count']! as int;
  }

  PosAccessCredential _decodeCredential(Map<String, Object?> envelope) {
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing access-credential data.');
    }
    return PosAccessCredential.fromJson(data);
  }

  PosAccessPage<T> _decodePage<T>(
    Map<String, Object?> envelope,
    T Function(Map<String, Object?>) decodeItem,
  ) {
    final data = envelope['data'];
    if (data is! List<Object?>) {
      throw const FormatException('Missing access list data.');
    }
    final meta = envelope['meta'];
    final page = meta is Map<String, Object?> ? meta['page'] : null;
    final nextCursor = page is Map<String, Object?> ? page['next_cursor'] as String? : null;
    return PosAccessPage(
      items: data.whereType<Map<String, Object?>>().map(decodeItem).toList(growable: false),
      nextCursor: nextCursor,
    );
  }
}

class EmptyPosAccessGateway implements PosAccessGateway {
  const EmptyPosAccessGateway();

  @override
  Future<PosAccessCredential> issueCredential({
    required String branchId,
    required String saleId,
    String? customerId,
    bool? allowsReentry,
  }) => Future.error(StateError('No access gateway is configured.'));

  @override
  Future<PosAccessScanResult> scan({required String branchId, required String code}) =>
      Future.error(StateError('No access gateway is configured.'));

  @override
  Future<PosAccessCredential> voidCredential(String id) =>
      Future.error(StateError('No access gateway is configured.'));

  @override
  Future<PosAccessPage<PosAccessCredential>> currentlyInside({
    String? branchId,
    String? cursor,
    int limit = 50,
  }) => Future.error(StateError('No access gateway is configured.'));

  @override
  Future<PosAccessPage<PosAccessEvent>> listEvents({
    String? branchId,
    String? cursor,
    int limit = 50,
    DateTime? occurredFrom,
    DateTime? occurredTo,
  }) => Future.error(StateError('No access gateway is configured.'));

  @override
  Future<int> occupancy({required String branchId}) =>
      Future.error(StateError('No access gateway is configured.'));
}
