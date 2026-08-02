import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../errors/app_error.dart';

typedef AccessTokenReader = String? Function();
typedef CorrelationIdFactory = String Function();

class ApiException implements Exception {
  const ApiException(this.failure, {this.statusCode});
  final AppFailure failure;
  final int? statusCode;
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

  Future<Map<String, Object?>> getJson(String path) => _send('GET', path);

  Future<Map<String, Object?>> postJson(
    String path, {
    Map<String, Object?> body = const {},
    String? csrfToken,
  }) => _send('POST', path, body: body, csrfToken: csrfToken);

  Future<Map<String, Object?>> _send(
    String method,
    String path, {
    Map<String, Object?>? body,
    String? csrfToken,
  }) async {
    final token = readAccessToken();
    final request = http.Request(method, baseUrl.resolve(path))
      ..headers.addAll({
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Correlation-ID': createCorrelationId(),
        ...token == null ? const {} : {'Authorization': 'Bearer $token'},
        ...csrfToken == null ? const {} : {'X-CSRF-Token': csrfToken},
      })
      ..body = body == null ? '' : jsonEncode(body);
    try {
      final streamed = await transport.send(request).timeout(timeout);
      final response = await http.Response.fromStream(streamed);
      final decoded = response.body.isEmpty
          ? <String, Object?>{}
          : jsonDecode(response.body) as Map<String, Object?>;
      if (response.statusCode >= 400) {
        final error = decoded['error'];
        final code = error is Map<String, Object?> && error['code'] is String
            ? error['code']! as String
            : 'unknown';
        throw ApiException(
          AppFailure.fromCode(code),
          statusCode: response.statusCode,
        );
      }
      return decoded;
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
}
