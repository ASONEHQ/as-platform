import 'dart:async';
import 'dart:convert';

import 'package:as_one/core/errors/app_error.dart';
import 'package:as_one/core/networking/api_client.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

void main() {
  test(
    'injects bearer and correlation headers without unsafe retries',
    () async {
      late http.BaseRequest captured;
      var sends = 0;
      final client = ApiClient(
        baseUrl: Uri.parse('https://api.test.asone.mx/api/v1/'),
        transport: _FakeClient((request) {
          sends++;
          captured = request;
          return http.Response(
            jsonEncode({
              'data': {'ok': true},
            }),
            200,
            headers: {'content-type': 'application/json'},
          );
        }),
        readAccessToken: () => 'memory-token',
        createCorrelationId: () => 'correlation-test',
      );
      final result = await client.getJson('auth/session');
      expect(result['data'], {'ok': true});
      expect(captured.headers['Authorization'], 'Bearer memory-token');
      expect(captured.headers['X-Correlation-ID'], 'correlation-test');
      expect(sends, 1);
    },
  );

  test('maps canonical errors to safe API exceptions', () async {
    final client = ApiClient(
      baseUrl: Uri.parse('https://api.test.asone.mx/'),
      transport: _FakeClient(
        (_) => http.Response(
          jsonEncode({
            'error': {'code': 'session_expired', 'message': 'internal'},
          }),
          401,
        ),
      ),
      readAccessToken: () => null,
      createCorrelationId: () => 'correlation-test',
    );
    await expectLater(
      client.getJson('session'),
      throwsA(
        isA<ApiException>().having(
          (error) => error.failure.code,
          'code',
          'session_expired',
        ),
      ),
    );
  });

  test(
    'serializes recovery externally and retries a safe GET only once',
    () async {
      var sends = 0;
      var refreshes = 0;
      final client = ApiClient(
        baseUrl: Uri.parse('https://api.test.asone.mx/'),
        transport: _FakeClient((_) {
          sends++;
          return sends == 1
              ? http.Response(
                  jsonEncode({
                    'error': {'code': 'session_expired'},
                  }),
                  401,
                )
              : http.Response(
                  jsonEncode({
                    'data': {'ok': true},
                  }),
                  200,
                );
        }),
        readAccessToken: () => 'memory-token',
        createCorrelationId: () => 'correlation-test',
      )..onUnauthorized = () async => refreshes++;
      expect((await client.getJson('safe'))['data'], {'ok': true});
      expect(sends, 2);
      expect(refreshes, 1);
    },
  );

  test('TASK 17.7.3: a mutation with no duplicate guard is never resent — the session is renewed and the user repeats it', () async {
    var sends = 0;
    var refreshes = 0;
    final client = ApiClient(
      baseUrl: Uri.parse('https://api.test.asone.mx/'),
      transport: _FakeClient((_) {
        sends++;
        return _expiredResponse();
      }),
      readAccessToken: () => 'memory-token',
      createCorrelationId: () => 'correlation-test',
    )..onUnauthorized = () async => refreshes++;
    await expectLater(
      client.postJson('mutation'),
      throwsA(isA<ApiException>().having((error) => error.failure.code, 'code', 'session_renewed')),
    );
    expect(sends, 1, reason: 'the business action must never be sent twice');
    expect(refreshes, 1);
  });

  group('TASK 17.7.3 session renewal', () {
    http.Response ok() => http.Response(jsonEncode({'data': {'ok': true}}), 200);

    test('an Idempotency-Key mutation is retried exactly once after the renewal, and the key is unchanged', () async {
      final keys = <String?>[];
      final tokens = <String?>[];
      var token = 'old';
      final client = ApiClient(
        baseUrl: Uri.parse('https://api.test.asone.mx/'),
        transport: _FakeClient((request) {
          keys.add(request.headers['Idempotency-Key']);
          tokens.add(request.headers['Authorization']);
          return tokens.length == 1 ? _expiredResponse() : ok();
        }),
        readAccessToken: () => token,
        createCorrelationId: () => 'c',
      )..onUnauthorized = () async => token = 'new';
      final result = await client.postJson('sales', idempotencyKey: 'sale-key-1');
      expect(result['data'], {'ok': true});
      expect(keys, ['sale-key-1', 'sale-key-1']);
      expect(tokens, ['Bearer old', 'Bearer new']);
    });

    test('an If-Match write (PUT/PATCH/DELETE) is also retried once; a second 401 is not retried again', () async {
      var sends = 0;
      var refreshes = 0;
      final client = ApiClient(
        baseUrl: Uri.parse('https://api.test.asone.mx/'),
        transport: _FakeClient((_) {
          sends++;
          return _expiredResponse(); // never recovers
        }),
        readAccessToken: () => 't',
        createCorrelationId: () => 'c',
      )..onUnauthorized = () async => refreshes++;
      await expectLater(client.putJson('x', ifMatch: '"1"'), throwsA(isA<ApiException>()));
      expect(sends, 2, reason: 'one original + exactly one retry');
      expect(refreshes, 1);
    });

    test('a 401 that is NOT an expiry (e.g. wrong PIN) never renews or retries', () async {
      var sends = 0;
      var refreshes = 0;
      final client = ApiClient(
        baseUrl: Uri.parse('https://api.test.asone.mx/'),
        transport: _FakeClient((_) {
          sends++;
          return http.Response(jsonEncode({'error': {'code': 'invalid_credentials'}}), 401);
        }),
        readAccessToken: () => 't',
        createCorrelationId: () => 'c',
      )..onUnauthorized = () async => refreshes++;
      await expectLater(
        client.postJson('auth/pin-login', idempotencyKey: 'k'),
        throwsA(isA<ApiException>().having((error) => error.failure.code, 'code', 'invalid_credentials')),
      );
      expect(sends, 1);
      expect(refreshes, 0);
    });

    test('the pre-flight hook runs before an authenticated request and a failure stops the request from being sent', () async {
      var sends = 0;
      final client = ApiClient(
        baseUrl: Uri.parse('https://api.test.asone.mx/'),
        transport: _FakeClient((_) {
          sends++;
          return ok();
        }),
        readAccessToken: () => 't',
        createCorrelationId: () => 'c',
      )..beforeAuthenticatedRequest = () async => throw const ApiException(
          AppFailure(AppErrorKind.authentication, 'x', code: 'session_expired'),
        );
      await expectLater(client.postJson('sales', idempotencyKey: 'k'), throwsA(isA<ApiException>()));
      await expectLater(client.getJson('read'), throwsA(isA<ApiException>()));
      expect(sends, 0, reason: 'nothing is submitted when the session cannot be renewed');
    });

    test('unauthenticated calls and calls made inside the auth-internal zone skip the hook', () async {
      var hooks = 0;
      final client = ApiClient(
        baseUrl: Uri.parse('https://api.test.asone.mx/'),
        transport: _FakeClient((_) => ok()),
        readAccessToken: () => 't',
        createCorrelationId: () => 'c',
      )..beforeAuthenticatedRequest = () async => hooks++;
      await client.postJson('auth/login', authenticated: false);
      await runZoned(() => client.getJson('auth/session'), zoneValues: {authInternalZoneKey: true});
      expect(hooks, 0);
      await client.getJson('normal');
      expect(hooks, 1);
    });

    test('CSRF: the request carries the CURRENT token even if it rotated after the caller read it', () async {
      String? sent;
      var csrf = 'csrf-old';
      final client = ApiClient(
        baseUrl: Uri.parse('https://api.test.asone.mx/'),
        transport: _FakeClient((request) {
          sent = request.headers['X-CSRF-Token'];
          return ok();
        }),
        readAccessToken: () => 't',
        createCorrelationId: () => 'c',
      )
        ..readCsrfToken = (() => csrf)
        ..beforeAuthenticatedRequest = () async => csrf = 'csrf-new'; // the renewal rotates it
      await client.postJson('auth/pin-login', csrfToken: 'csrf-old');
      expect(sent, 'csrf-new');
    });

    test('without a CSRF token the header is never invented', () async {
      String? sent = 'unset';
      final client = ApiClient(
        baseUrl: Uri.parse('https://api.test.asone.mx/'),
        transport: _FakeClient((request) {
          sent = request.headers['X-CSRF-Token'];
          return ok();
        }),
        readAccessToken: () => 't',
        createCorrelationId: () => 'c',
      )..readCsrfToken = (() => 'csrf-live');
      await client.postJson('sales', idempotencyKey: 'k');
      expect(sent, isNull);
    });

    test('a GET (text document) is renewed and repeated once', () async {
      var sends = 0;
      var refreshes = 0;
      final client = ApiClient(
        baseUrl: Uri.parse('https://api.test.asone.mx/'),
        transport: _FakeClient((_) {
          sends++;
          return sends == 1 ? _expiredResponse() : http.Response('<html>ok</html>', 200);
        }),
        readAccessToken: () => 't',
        createCorrelationId: () => 'c',
      )..onUnauthorized = () async => refreshes++;
      expect(await client.getText('doc'), '<html>ok</html>');
      expect(sends, 2);
      expect(refreshes, 1);
    });
  });

  // TASK 15.1 Phase 3: regression test for the `omitBody` fix — see
  // `api_client.dart`'s own doc comment on `postJson` for why
  // `inventory-posting.routes.ts`'s `submit`/`post` endpoints need a
  // genuinely bodyless `POST`, unlike every other call site.
  test(
    'postJson with omitBody sends a genuinely empty body, never a JSON-encoded "{}"',
    () async {
      late http.BaseRequest captured;
      final client = ApiClient(
        baseUrl: Uri.parse('https://api.test.asone.mx/'),
        transport: _FakeClient((request) {
          captured = request;
          return http.Response(
            jsonEncode({
              'data': {'ok': true},
            }),
            200,
          );
        }),
        readAccessToken: () => 'memory-token',
        createCorrelationId: () => 'correlation-test',
      );
      await client.postJson(
        'inventory/movements/movement-1/submit',
        idempotencyKey: 'submit-1',
        ifMatch: '"1"',
        omitBody: true,
      );
      final body = captured as http.Request;
      expect(body.body, '');
      expect(captured.headers['Idempotency-Key'], 'submit-1');
      expect(captured.headers['If-Match'], '"1"');
    },
  );

  test(
    'postJson without omitBody keeps sending the default empty JSON object',
    () async {
      late http.BaseRequest captured;
      final client = ApiClient(
        baseUrl: Uri.parse('https://api.test.asone.mx/'),
        transport: _FakeClient((request) {
          captured = request;
          return http.Response(
            jsonEncode({
              'data': {'ok': true},
            }),
            200,
          );
        }),
        readAccessToken: () => 'memory-token',
        createCorrelationId: () => 'correlation-test',
      );
      await client.postJson('payroll-periods/period-1/close', idempotencyKey: 'close-1');
      final body = captured as http.Request;
      expect(body.body, '{}');
    },
  );

  // TASK 16.6D — `postMultipart` (used by the real product-image and
  // branding-logo uploads) had NO direct test at all before this task,
  // despite being the exact request-construction code a real production
  // bug (every product-image upload rejected with a 415 by an unrelated
  // server-side security hook — see `security.test.ts`) could plausibly
  // have been misdiagnosed as. Proves the actual wire contract Fastify's
  // real `@fastify/multipart` expects: a `multipart/form-data; boundary=`
  // Content-Type (never a raw/malformed one), a single file part under
  // the exact field name the real route reads (`request.file()` — see
  // `readProductImageFile`, `product-catalog.routes.ts`), the real
  // filename/content-type/bytes, and the `If-Match` CAS header — by
  // capturing and finalizing the REAL `http.MultipartRequest` this method
  // builds, not a hand-rolled approximation of one.
  test('postMultipart builds a real multipart/form-data request with the exact file part and If-Match header', () async {
    late http.BaseRequest captured;
    final client = ApiClient(
      baseUrl: Uri.parse('https://api.test.asone.mx/'),
      transport: _FakeClient((request) {
        captured = request;
        return http.Response(
          jsonEncode({
            'data': {'ok': true},
          }),
          200,
        );
      }),
      readAccessToken: () => 'memory-token',
      createCorrelationId: () => 'correlation-test',
    );
    final bytes = [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3];
    await client.postMultipart(
      'products/product-1/image',
      fieldName: 'file',
      filename: 'photo.jpg',
      bytes: bytes,
      contentType: 'image/jpeg',
      ifMatch: '"3"',
    );
    expect(captured.method, 'POST');
    final request = captured as http.MultipartRequest;
    expect(request.headers['Authorization'], 'Bearer memory-token');
    expect(request.headers['If-Match'], '"3"');
    expect(request.files, hasLength(1));
    final file = request.files.single;
    expect(file.field, 'file');
    expect(file.filename, 'photo.jpg');
    expect(file.contentType.mimeType, 'image/jpeg');
    expect(file.length, bytes.length);
    // `MultipartRequest` only sets its own `content-type` header (with the
    // real boundary) as a side effect of `finalize()` — see
    // `package:http`'s own `multipart_request.dart` — never before, so
    // this is asserted AFTER finalizing, matching exactly how the real
    // `BrowserClient`/`IOClient` transport calls it internally during
    // `.send()`. This also proves the real, finalized wire body actually
    // contains our bytes and a matching boundary — not merely correct
    // metadata on the request object, which a subtly broken encoder could
    // still get right.
    final encoded = await request.finalize().toBytes();
    expect(request.headers['content-type'], startsWith('multipart/form-data; boundary='));
    final boundary = RegExp('boundary=([^;]+)').firstMatch(request.headers['content-type']!)!.group(1)!;
    expect(String.fromCharCodes(encoded), contains('--$boundary'));
    expect(String.fromCharCodes(encoded), contains('name="file"; filename="photo.jpg"'));
    expect(String.fromCharCodes(encoded), contains('content-type: image/jpeg'));
  });

  test(
    'maps malformed success responses without exposing their body',
    () async {
      final client = ApiClient(
        baseUrl: Uri.parse('https://api.test.asone.mx/'),
        transport: _FakeClient((_) => http.Response('not-json', 200)),
        readAccessToken: () => null,
        createCorrelationId: () => 'correlation-test',
      );
      await expectLater(
        client.getJson('malformed'),
        throwsA(
          isA<ApiException>().having(
            (error) => error.failure.code,
            'safe code',
            'malformed_response',
          ),
        ),
      );
    },
  );
}

class _FakeClient extends http.BaseClient {
  _FakeClient(this.handler);
  final http.Response Function(http.BaseRequest request) handler;
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final response = handler(request);
    return http.StreamedResponse(
      Stream.value(response.bodyBytes),
      response.statusCode,
      headers: response.headers,
    );
  }
}

http.Response _expiredResponse() => http.Response(jsonEncode({'error': {'code': 'session_expired'}}), 401);
