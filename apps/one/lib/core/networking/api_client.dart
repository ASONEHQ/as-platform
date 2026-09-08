import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart' show MediaType;

import '../errors/app_error.dart';

typedef AccessTokenReader = String? Function();
typedef CorrelationIdFactory = String Function();
typedef UnauthorizedHandler = Future<void> Function();

class ApiException implements Exception {
  const ApiException(this.failure, {this.statusCode, this.details});
  final AppFailure failure;
  final int? statusCode;

  /// TASK 13.0: the backend error envelope's own optional `error.details`
  /// (see `AppError.toPublicResponse`/`CustomerError` — e.g. a 409
  /// `resource_conflict`/`customer_identity_conflict` carries
  /// `existing_customer_id`/`email_customer_id`/`phone_customer_id` so a
  /// caller can offer the existing customer instead of failing blindly,
  /// per ADR-0017 D5). `null` whenever the backend didn't send one —
  /// never fabricated here.
  final Map<String, Object?>? details;
}

class ApiClient {
  ApiClient({
    required this.baseUrl,
    required this.transport,
    required this.readAccessToken,
    required this.createCorrelationId,
    this.timeout = const Duration(seconds: 20),
  });

  final Uri baseUrl;
  final http.Client transport;
  final AccessTokenReader readAccessToken;
  final CorrelationIdFactory createCorrelationId;
  final Duration timeout;
  UnauthorizedHandler? onUnauthorized;

  Future<Map<String, Object?>> getJson(
    String path, {
    bool authenticated = true,
    bool retryAfterRefresh = true,
  }) => _send(
    'GET',
    path,
    authenticated: authenticated,
    retryAfterRefresh: retryAfterRefresh,
  );

  /// TASK 14.3 (Wave 1, Part A): the first Flutter caller whose success
  /// response is NOT a JSON envelope — `GET /party-reservations/{id}/
  /// documents/{type}` (`party-reservations.routes.ts`) replies
  /// `text/html; charset=utf-8` with a real, server-generated contract/
  /// waiver document. An error response is still the same JSON envelope
  /// every other endpoint uses, so this reuses [_decode]'s exact error
  /// parsing (honest [ApiException], never fabricated) and only bypasses
  /// JSON decoding for a genuine 2xx body.
  Future<String> getText(String path, {bool authenticated = true}) async {
    final response = await _perform('GET', path, authenticated: authenticated);
    if (response.statusCode >= 400) {
      _decode(response);
    }
    return response.body;
  }

  Future<Map<String, Object?>> postJson(
    String path, {
    Map<String, Object?> body = const {},
    String? csrfToken,
    bool authenticated = true,
    // TASK 12.4A.1: the first Flutter caller of a mutation that requires
    // ADR-0005's `Idempotency-Key` header (every prior `postJson` call —
    // login/refresh/logout — predates any domain-object-creation
    // endpoint). Optional so every existing call site is unaffected.
    String? idempotencyKey,
    // TASK 13.0: the first `POST` call site that is also a cancel-style
    // mutation requiring a strong `If-Match` version header —
    // `POST /customer-memberships/{id}/cancel` (`memberships.routes.ts`).
    // Optional, exactly like [idempotencyKey] above, so every existing
    // `postJson` call site is unaffected.
    String? ifMatch,
  }) => _send(
    'POST',
    path,
    body: body,
    csrfToken: csrfToken,
    authenticated: authenticated,
    retryAfterRefresh: false,
    idempotencyKey: idempotencyKey,
    ifMatch: ifMatch,
  );

  /// TASK 12.9: the first Flutter caller of a `PUT` update — promotions/
  /// coupons admin edits (`promotions.routes.ts`'s `PUT .../:id`), each
  /// requiring the resource's own strong `If-Match` version header (never
  /// an `Idempotency-Key` — the backend route schema for those endpoints
  /// carries no such requirement, unlike `postJson`'s creation calls).
  ///
  /// TASK 14.4 (Wave 2): [idempotencyKey] is optional and additive — the
  /// first `PUT` caller that DOES also require `Idempotency-Key` is
  /// `PUT /api/v1/schedules` (`schedules.routes.ts`'s own genuine
  /// upsert-on-conflict route, which carries no `If-Match` at all — see
  /// `pos_people_gateway.dart`'s `upsertSchedule`). Every pre-existing
  /// `putJson` call site is unaffected.
  Future<Map<String, Object?>> putJson(
    String path, {
    Map<String, Object?> body = const {},
    String? ifMatch,
    String? idempotencyKey,
    bool authenticated = true,
  }) => _send(
    'PUT',
    path,
    body: body,
    authenticated: authenticated,
    retryAfterRefresh: false,
    ifMatch: ifMatch,
    idempotencyKey: idempotencyKey,
  );

  /// TASK 13.0: the first Flutter caller of a `PATCH` update —
  /// `PATCH /api/v1/customers/{id}` (`customers.routes.ts`), a partial
  /// update requiring the resource's own strong `If-Match` version header
  /// — mirrors `putJson`'s exact style/contract, just a different HTTP
  /// verb (no `Idempotency-Key`, matching the backend route schema).
  Future<Map<String, Object?>> patchJson(
    String path, {
    Map<String, Object?> body = const {},
    String? ifMatch,
    bool authenticated = true,
  }) => _send(
    'PATCH',
    path,
    body: body,
    authenticated: authenticated,
    retryAfterRefresh: false,
    ifMatch: ifMatch,
  );

  /// TASK 14.5A: the first Flutter caller of a `DELETE` -- mirrors
  /// [putJson]'s own `If-Match` CAS contract, just a different HTTP verb
  /// and no request body (`POST /companies/{id}/branding/logo`'s sibling
  /// clear endpoint, `branding.routes.ts`'s `DELETE`, carries no JSON
  /// body of its own -- only the strong version header).
  Future<Map<String, Object?>> deleteJson(
    String path, {
    String? ifMatch,
    bool authenticated = true,
  }) => _send(
    'DELETE',
    path,
    authenticated: authenticated,
    retryAfterRefresh: false,
    ifMatch: ifMatch,
  );

  /// TASK 14.5A: the first Flutter caller of a real multipart file upload
  /// -- `POST /api/v1/companies/{id}/branding/logo` (`branding.routes.ts`)
  /// accepts the raw image bytes as a single multipart file part (field
  /// name `file`, matching that route's own `request.file()` read), not a
  /// JSON body, so this bypasses [_send]/[_perform] entirely rather than
  /// forcing multipart through their JSON-only `body` parameter. Same
  /// `If-Match` CAS contract as [putJson]/[deleteJson] -- the branding
  /// route requires it for the exact same reason every other
  /// company-setting write does.
  Future<Map<String, Object?>> postMultipart(
    String path, {
    required String fieldName,
    required String filename,
    required List<int> bytes,
    required String contentType,
    String? ifMatch,
    bool authenticated = true,
  }) async {
    final token = authenticated ? readAccessToken() : null;
    final request = http.MultipartRequest('POST', baseUrl.resolve(path))
      ..headers.addAll({
        'Accept': 'application/json',
        'X-Correlation-ID': createCorrelationId(),
        ...token == null ? const {} : {'Authorization': 'Bearer $token'},
        ...ifMatch == null ? const {} : {'If-Match': ifMatch},
      })
      ..files.add(
        http.MultipartFile.fromBytes(
          fieldName,
          bytes,
          filename: filename,
          contentType: MediaType.parse(contentType),
        ),
      );
    try {
      final response = await http.Response.fromStream(
        await transport.send(request).timeout(timeout),
      );
      return _decode(response);
    } on TimeoutException {
      throw const ApiException(
        AppFailure(AppErrorKind.timeout, 'La conexión tardó demasiado.', code: 'timeout'),
      );
    } on ApiException {
      rethrow;
    } on Object {
      throw const ApiException(
        AppFailure(AppErrorKind.unavailable, 'El servicio no está disponible.', code: 'api_unavailable'),
      );
    }
  }

  Future<Map<String, Object?>> _send(
    String method,
    String path, {
    Map<String, Object?>? body,
    String? csrfToken,
    required bool authenticated,
    required bool retryAfterRefresh,
    String? idempotencyKey,
    String? ifMatch,
  }) async {
    final response = await _perform(
      method,
      path,
      body: body,
      csrfToken: csrfToken,
      authenticated: authenticated,
      idempotencyKey: idempotencyKey,
      ifMatch: ifMatch,
    );
    if (response.statusCode == 401 &&
        authenticated &&
        retryAfterRefresh &&
        onUnauthorized != null) {
      await onUnauthorized!();
      return _decode(
        await _perform(
          method,
          path,
          body: body,
          csrfToken: csrfToken,
          authenticated: authenticated,
          idempotencyKey: idempotencyKey,
          ifMatch: ifMatch,
        ),
      );
    }
    return _decode(response);
  }

  Future<http.Response> _perform(
    String method,
    String path, {
    Map<String, Object?>? body,
    String? csrfToken,
    required bool authenticated,
    String? idempotencyKey,
    String? ifMatch,
  }) async {
    final token = authenticated ? readAccessToken() : null;
    final request = http.Request(method, baseUrl.resolve(path))
      ..headers.addAll({
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Correlation-ID': createCorrelationId(),
        ...token == null ? const {} : {'Authorization': 'Bearer $token'},
        ...csrfToken == null ? const {} : {'X-CSRF-Token': csrfToken},
        ...idempotencyKey == null ? const {} : {'Idempotency-Key': idempotencyKey},
        ...ifMatch == null ? const {} : {'If-Match': ifMatch},
      })
      ..body = body == null ? '' : jsonEncode(body);
    try {
      return await http.Response.fromStream(
        await transport.send(request).timeout(timeout),
      );
    } on TimeoutException {
      throw const ApiException(
        AppFailure(
          AppErrorKind.timeout,
          'La conexión tardó demasiado.',
          code: 'timeout',
        ),
      );
    } on ApiException {
      rethrow;
    } on Object {
      throw const ApiException(
        AppFailure(
          AppErrorKind.unavailable,
          'El servicio no está disponible.',
          code: 'api_unavailable',
        ),
      );
    }
  }

  Map<String, Object?> _decode(http.Response response) {
    try {
      final decoded = response.body.isEmpty
          ? <String, Object?>{}
          : jsonDecode(response.body) as Map<String, Object?>;
      if (response.statusCode >= 400) {
        final error = decoded['error'];
        final code = error is Map<String, Object?> && error['code'] is String
            ? error['code']! as String
            : 'unknown';
        final rawDetails = error is Map<String, Object?> ? error['details'] : null;
        throw ApiException(
          AppFailure.fromCode(code),
          statusCode: response.statusCode,
          details: rawDetails is Map<String, Object?> ? rawDetails : null,
        );
      }
      return decoded;
    } on ApiException {
      rethrow;
    } on Object {
      throw const ApiException(
        AppFailure(
          AppErrorKind.unknown,
          'La respuesta del servicio no es válida.',
          code: 'malformed_response',
        ),
      );
    }
  }
}
