/// TASK 17.7.3 — end-to-end regression for an expired access token.
///
/// Production symptom: access tokens live ~15 minutes; GETs recovered through
/// a refresh but mutations never did, so the first action after an idle spell
/// (a branch switch, a sale) failed — and the failed branch switch even sent
/// the user back to the login screen.
///
/// These tests run the REAL \`ApiClient\` + \`ApiAuthGateway\` + \`AuthController\`
/// against a fake server that enforces what the real one does: access-token
/// expiry (401 \`session_expired\`), CSRF on the refresh/switch endpoints with a
/// rotating token, and Idempotency-Key de-duplication on the business
/// mutation. The clock is injected, so "15 minutes later" is instant.
library;

import 'dart:async';
import 'dart:convert';

import 'package:as_one/core/networking/api_client.dart';
import 'package:as_one/core/storage/token_vault.dart';
import 'package:as_one/core/telemetry/telemetry.dart';
import 'package:as_one/features/authentication/auth_gateway.dart';
import 'package:as_one/features/authentication/auth_models.dart';
import 'package:as_one/features/authentication/auth_state.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

class _Telemetry implements Telemetry {
  const _Telemetry();
  @override
  void recordEvent(String name, {Map<String, Object?> attributes = const {}}) {}
  @override
  void recordFailure(String operation, Object error) {}
}

/// A tiny in-memory ACCESS GO API.
class _FakeServer {
  _FakeServer(this.now);

  DateTime now;
  var _tokenCounter = 0;
  var _csrfCounter = 0;
  final Map<String, DateTime> _accessExpiry = {};
  String csrf = 'csrf-0';
  String? branchId;
  List<Map<String, Object?>> branchItems = [
    {'branch_id': 'branch-1', 'code': 'PLV', 'name': 'Puerta La Victoria', 'timezone': 'America/Mexico_City', 'current': false, 'is_default': false},
  ];
  bool companyWide = true;
  bool branchSwitchFails = false;

  // What the tests assert on.
  int refreshCalls = 0;
  int salePosts = 0; // raw POST /sales requests that reached the handler
  int salesExecuted = 0; // business executions (after idempotency de-dup)
  int sessionGets = 0;
  int logoutCalls = 0;
  int branchSwitchCalls = 0;
  final List<String?> branchSwitchCsrf = [];
  final Map<String, String> _sales = {};

  // Failure injection.
  bool refreshRejected = false; // refresh answers 401 session_expired
  bool networkDown = false; // transport throws
  bool refreshNetworkDown = false; // only the refresh endpoint is unreachable
  final Set<String> revokedEarly = {}; // tokens the server stops accepting before their expiry

  String _issueAccess() {
    final token = 'access-${++_tokenCounter}';
    _accessExpiry[token] = now.add(const Duration(minutes: 15));
    return token;
  }

  DateTime accessExpiryOf(String token) => _accessExpiry[token]!;

  bool _valid(http.Request request) {
    final header = request.headers['Authorization'];
    if (header == null || !header.startsWith('Bearer ')) return false;
    final token = header.substring(7);
    final expiry = _accessExpiry[token];
    return expiry != null && expiry.isAfter(now) && !revokedEarly.contains(token);
  }

  Map<String, Object?> _session(String token) => {
    'id': 'session-1',
    'user_id': 'user-1',
    'company_id': 'company-1',
    'branch_id': branchId,
    'permitted_branch_ids': [for (final item in branchItems) item['branch_id']],
    'company_wide_access': companyWide,
    'permitted_register_ids': null,
  };

  Map<String, Object?> _credentials() {
    final token = _issueAccess();
    csrf = 'csrf-${++_csrfCounter}';
    return {
      'result': 'authenticated',
      'access_token': token,
      'csrf_token': csrf,
      'expires_at': _accessExpiry[token]!.toIso8601String(),
      'session': _session(token),
    };
  }

  http.Response _json(int status, Map<String, Object?> body) =>
      http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});

  http.Response _expired() => _json(401, {'error': {'code': 'session_expired'}});

  Future<http.Response> handle(http.Request request) async {
    if (networkDown) throw Exception('offline');
    final path = request.url.path;
    switch ('${request.method} $path') {
      case 'POST /api/v1/auth/browser-bootstrap':
        return _json(200, {
          'data': {'result': 'csrf_ready', 'transport_mode': 'browser', 'csrf_token': csrf, 'csrf_expires_at': now.add(const Duration(days: 1)).toIso8601String()},
        });
      case 'POST /api/v1/auth/login':
        return _json(200, {'data': _credentials()});
      case 'POST /api/v1/auth/refresh':
        refreshCalls++;
        if (refreshNetworkDown) throw Exception('refresh unreachable');
        if (refreshRejected) return _json(401, {'error': {'code': 'session_expired'}});
        if (request.headers['X-CSRF-Token'] != csrf) return _json(403, {'error': {'code': 'validation_error'}});
        return _json(200, {'data': _credentials()});
      case 'POST /api/v1/auth/logout':
        logoutCalls++;
        return _json(200, {'data': {'ok': true}});
      case 'POST /api/v1/auth/branch-switches':
        branchSwitchCalls++;
        branchSwitchCsrf.add(request.headers['X-CSRF-Token']);
        if (branchSwitchFails) return _json(404, {'error': {'code': 'branch_access_denied'}});
        if (!_valid(request)) return _expired();
        if (request.headers['X-CSRF-Token'] != csrf) return _json(403, {'error': {'code': 'validation_error'}});
        branchId = (jsonDecode(request.body) as Map<String, Object?>)['branch_id'] as String?;
        return _json(200, {'data': _credentials()});
      case 'POST /api/v1/sales':
        salePosts++;
        if (!_valid(request)) return _expired();
        final key = request.headers['Idempotency-Key'] ?? 'no-key-${salePosts}';
        final replay = _sales.containsKey(key);
        if (!replay) {
          salesExecuted++;
          _sales[key] = 'sale-${_sales.length + 1}';
        }
        return _json(201, {'data': {'id': _sales[key], 'replayed': replay}});
    }
    if (request.method == 'GET') {
      if (!_valid(request)) return _expired();
      switch (path) {
        case '/api/v1/auth/session':
          sessionGets++;
          return _json(200, {'data': {..._session(''), 'expires_at': now.add(const Duration(days: 1)).toIso8601String()}});
        case '/api/v1/auth/me':
          return _json(200, {'data': {'id': 'user-1', 'display_name': 'Cajero Demo', 'email': 'demo@example.test'}});
        case '/api/v1/context/companies':
          return _json(200, {
            'data': {
              'items': [
                {'company_id': 'company-1', 'display_name': 'Empresa Demo', 'current': true, 'switch_permitted': true},
              ],
            },
          });
        case '/api/v1/context/branches':
          return _json(200, {
            'data': {
              'items': [
                for (final item in branchItems) {...item, 'current': item['branch_id'] == branchId},
              ],
              'company_wide_access': companyWide,
            },
          });
        case '/api/v1/auth/permissions':
          return _json(200, {'data': {'permissions': ['sale.create']}});
        case '/api/v1/read':
          return _json(200, {'data': {'ok': true}});
      }
    }
    return _json(404, {'error': {'code': 'resource_not_found'}});
  }
}

class _ServerTransport extends http.BaseClient {
  _ServerTransport(this.server);
  final _FakeServer server;
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final response = await server.handle(request as http.Request);
    return http.StreamedResponse(Stream.value(response.bodyBytes), response.statusCode, headers: response.headers);
  }
}

class _Harness {
  _Harness(this.server) {
    clock = () => server.now;
    vault = MemoryTokenVault();
    api = ApiClient(
      baseUrl: Uri.parse('https://api.test.asone.mx/'),
      transport: _ServerTransport(server),
      readAccessToken: () => vault.accessToken,
      createCorrelationId: () => 'corr',
    );
    gateway = ApiAuthGateway(client: api, vault: vault, readCsrfToken: () => controller.csrfToken);
    controller = AuthController(gateway, vault, const _Telemetry(), clock: clock);
    api
      ..onUnauthorized = controller.refresh
      ..beforeAuthenticatedRequest = controller.ensureFreshAccessToken
      ..readCsrfToken = (() => controller.csrfToken);
  }

  final _FakeServer server;
  late final DateTime Function() clock;
  late final MemoryTokenVault vault;
  late final ApiClient api;
  late final ApiAuthGateway gateway;
  late final AuthController controller;

  Future<void> signIn() => controller.login(identifier: 'demo@example.test', password: 'password-1');

  Future<Map<String, Object?>> sale(String key) => api.postJson('api/v1/sales', idempotencyKey: key);
  Future<Map<String, Object?>> unguardedSale() => api.postJson('api/v1/sales');
}

Future<_Harness> _signedIn({bool singleBranch = false, String? startBranch}) async {
  final server = _FakeServer(DateTime.utc(2026, 10, 23, 9));
  server.branchId = startBranch;
  if (!singleBranch) {
    server.branchItems = [
      ...server.branchItems,
      {'branch_id': 'branch-2', 'code': 'OTRA', 'name': 'Otra Sucursal', 'timezone': 'America/Mexico_City', 'current': false, 'is_default': false},
    ];
  }
  final harness = _Harness(server);
  // Real login flow: bootstrap -> CSRF proof, then login.
  await harness.signIn();
  return harness;
}

void main() {
  group('expired access token', () {
    test('login works, then a mutation after the token expires is sent ONCE, with a renewed token (idempotent mutation)', () async {
      final h = await _signedIn(startBranch: 'branch-1', singleBranch: true);
      expect(h.controller.phase, AuthPhase.authenticated);
      await h.sale('sale-key-1');
      expect(h.server.salesExecuted, 1);
      expect(h.server.refreshCalls, 0);

      h.server.now = h.server.now.add(const Duration(minutes: 16)); // access token expired
      final result = await h.sale('sale-key-2');

      expect(result['data'], containsPair('replayed', false));
      expect(h.server.refreshCalls, 1, reason: 'one renewal');
      expect(h.server.salesExecuted, 2, reason: 'each business action executed exactly once');
      expect(h.server.salePosts, 2, reason: 'no wasted 401 round trip: the token was renewed BEFORE sending');
      expect(h.controller.phase, AuthPhase.authenticated);
    });

    test('a mutation WITHOUT a duplicate guard is also sent once after the token expired (renewed up front)', () async {
      final h = await _signedIn(startBranch: 'branch-1', singleBranch: true);
      h.server.now = h.server.now.add(const Duration(minutes: 20));
      await h.unguardedSale();
      expect(h.server.salePosts, 1);
      expect(h.server.salesExecuted, 1);
      expect(h.server.refreshCalls, 1);
    });

    test('a GET after expiry is renewed once and succeeds', () async {
      final h = await _signedIn(startBranch: 'branch-1', singleBranch: true);
      h.server.now = h.server.now.add(const Duration(minutes: 30));
      expect((await h.api.getJson('api/v1/read'))['data'], {'ok': true});
      expect(h.server.refreshCalls, 1);
    });

    test('token renewed shortly BEFORE it expires (inside the skew window)', () async {
      final h = await _signedIn(startBranch: 'branch-1', singleBranch: true);
      h.server.now = h.server.now.add(const Duration(minutes: 14, seconds: 30)); // 30 s left < 60 s skew
      await h.sale('k');
      expect(h.server.refreshCalls, 1);
      expect(h.server.salesExecuted, 1);
    });

    test('a token with plenty of life left is NOT renewed (no timers, no refresh storm)', () async {
      final h = await _signedIn(startBranch: 'branch-1', singleBranch: true);
      h.server.now = h.server.now.add(const Duration(minutes: 5));
      for (var i = 0; i < 5; i++) {
        await h.sale('k$i');
      }
      expect(h.server.refreshCalls, 0);
    });

    test('race: the server rejects a token the client still thinks is valid — a keyed mutation is retried once with the SAME key and executes once', () async {
      final h = await _signedIn(startBranch: 'branch-1', singleBranch: true);
      h.server.revokedEarly.add(h.vault.accessToken!);
      final result = await h.sale('same-key');
      expect(result['data'], containsPair('replayed', false));
      expect(h.server.refreshCalls, 1);
      expect(h.server.salePosts, 2, reason: 'original (401) + one retry');
      expect(h.server.salesExecuted, 1, reason: 'the business action ran exactly once');
    });

    test('race: an UNGUARDED mutation is never resent — the session is renewed and the user repeats it (still exactly one execution overall)', () async {
      final h = await _signedIn(startBranch: 'branch-1', singleBranch: true);
      h.server.revokedEarly.add(h.vault.accessToken!);
      await expectLater(
        h.unguardedSale(),
        throwsA(isA<ApiException>().having((error) => error.failure.code, 'code', 'session_renewed')),
      );
      expect(h.server.salePosts, 1);
      expect(h.server.salesExecuted, 0);
      expect(h.server.refreshCalls, 1);
      await h.unguardedSale(); // the user repeats the action with the healthy session
      expect(h.server.salesExecuted, 1);
      expect(h.server.refreshCalls, 1, reason: 'no second renewal');
    });

    test('simultaneous requests after expiry share ONE refresh', () async {
      final h = await _signedIn(startBranch: 'branch-1', singleBranch: true);
      h.server.now = h.server.now.add(const Duration(minutes: 20));
      await Future.wait([
        h.api.getJson('api/v1/read'),
        h.api.getJson('api/v1/read'),
        h.api.getJson('api/v1/read'),
        h.sale('a'),
        h.sale('b'),
        h.unguardedSale(),
      ]);
      expect(h.server.refreshCalls, 1);
      expect(h.server.salesExecuted, 3);
    });

    test('when the renewal legitimately fails, NOTHING is submitted, the user is sent to a clear session-ended state, and there is no refresh loop', () async {
      final h = await _signedIn(startBranch: 'branch-1', singleBranch: true);
      h.server.now = h.server.now.add(const Duration(minutes: 20));
      h.server.refreshRejected = true;
      final calls = [
        h.sale('a').then<Object?>((_) => null, onError: (Object e) => e),
        h.unguardedSale().then<Object?>((_) => null, onError: (Object e) => e),
      ];
      final outcomes = await Future.wait(calls);
      expect(outcomes.every((error) => error is ApiException), isTrue);
      expect(h.server.salePosts, 0, reason: 'no business request was sent with a dead session');
      expect(h.server.refreshCalls, 1, reason: 'one refresh attempt shared by both — no loop');
      expect(h.controller.phase, AuthPhase.expired);
      expect(h.vault.accessToken, isNull);
      // Later requests do not try to refresh again either.
      await expectLater(h.sale('c'), throwsA(isA<ApiException>()));
      expect(h.server.refreshCalls, 1);
      expect(h.server.salePosts, 0);
    });

    test('a transient network failure while renewing keeps the session — it does not eject the user', () async {
      final h = await _signedIn(startBranch: 'branch-1', singleBranch: true);
      h.server.now = h.server.now.add(const Duration(minutes: 20));
      h.server.refreshNetworkDown = true;
      await expectLater(h.sale('a'), throwsA(isA<ApiException>())); // the sale itself 401s: the token really is dead
      expect(h.controller.phase, AuthPhase.authenticated, reason: 'still signed in, not sent to /unavailable or /login');
      h.server.refreshNetworkDown = false;
      h.server.now = h.server.now.add(const Duration(seconds: 30)); // past the storm guard
      await h.sale('b');
      expect(h.server.salesExecuted, 1);
    });

    test('CSRF is preserved: a branch switch after expiry sends the ROTATED token and succeeds', () async {
      final h = await _signedIn();
      expect(h.controller.context?.session.branchId, isNull);
      final csrfBefore = h.controller.csrfToken;
      h.server.now = h.server.now.add(const Duration(minutes: 20));
      await h.controller.selectBranch('branch-2');
      expect(h.controller.phase, AuthPhase.authenticated);
      expect(h.controller.context?.session.branchId, 'branch-2');
      expect(h.controller.csrfToken, isNot(csrfBefore));
      expect(h.server.branchSwitchCsrf.single, isNot(csrfBefore), reason: 'the switch carried the post-renewal CSRF');
    });

    test('the exact production case: branch switch after the session aged does NOT bounce the user to login', () async {
      final h = await _signedIn();
      h.server.now = h.server.now.add(const Duration(minutes: 40));
      await h.controller.selectBranch('branch-1');
      expect(h.controller.phase, AuthPhase.authenticated);
      expect(h.controller.context?.session.branchId, 'branch-1');
    });

    test('a failed branch switch (network) leaves the user signed in with an honest failure, not on the login screen', () async {
      final h = await _signedIn();
      h.server.networkDown = true;
      await h.controller.selectBranch('branch-1');
      expect(h.controller.phase, AuthPhase.authenticated);
      expect(h.controller.context, isNotNull);
      expect(h.controller.state.failure, isNotNull);
    });

    test('logout after the token expired signs out locally and never tries to renew first', () async {
      final h = await _signedIn(startBranch: 'branch-1', singleBranch: true);
      h.server.now = h.server.now.add(const Duration(minutes: 30));
      await h.controller.logout();
      expect(h.controller.phase, AuthPhase.unauthenticated);
      expect(h.server.refreshCalls, 0);
      expect(h.server.logoutCalls, 1);
      expect(h.vault.accessToken, isNull);
    });
  });

  group('single accessible branch', () {
    test('a company-wide user with exactly ONE branch is placed in it automatically — no selector, no branch-less session', () async {
      final h = await _signedIn(singleBranch: true);
      expect(h.server.branchSwitchCalls, 1);
      expect(h.controller.phase, AuthPhase.authenticated);
      expect(h.controller.context?.session.branchId, 'branch-1');
      expect(h.controller.context?.currentBranch?.name, 'Puerta La Victoria');
    });

    test('a branch-bound user with exactly one branch is not sent to a branch-selection screen with one option', () async {
      final server = _FakeServer(DateTime.utc(2026, 10, 23, 9))..companyWide = false;
      final h = _Harness(server);
      await h.signIn();
      expect(h.controller.phase, AuthPhase.authenticated);
      expect(h.controller.context?.session.branchId, 'branch-1');
    });

    test('with several branches nothing is chosen for the user: a company-wide session stays on "Todas las sucursales"', () async {
      final h = await _signedIn();
      expect(h.server.branchSwitchCalls, 0);
      expect(h.controller.context?.session.branchId, isNull);
      expect(h.controller.phase, AuthPhase.authenticated);
    });

    test('with several branches a branch-bound user must choose (selection required)', () async {
      final server = _FakeServer(DateTime.utc(2026, 10, 23, 9))
        ..companyWide = false
        ..branchItems = [
          {'branch_id': 'branch-1', 'code': 'A', 'name': 'A', 'timezone': 'America/Mexico_City', 'current': false, 'is_default': false},
          {'branch_id': 'branch-2', 'code': 'B', 'name': 'B', 'timezone': 'America/Mexico_City', 'current': false, 'is_default': false},
        ];
      final h = _Harness(server);
      await h.signIn();
      expect(h.controller.phase, AuthPhase.branchSelectionRequired);
      expect(server.branchSwitchCalls, 0);
    });

    test('a failed automatic selection never blocks the sign-in', () async {
      final server = _FakeServer(DateTime.utc(2026, 10, 23, 9))
        ..branchItems = [
          {'branch_id': 'branch-1', 'code': 'PLV', 'name': 'Puerta La Victoria', 'timezone': 'America/Mexico_City', 'current': false, 'is_default': false},
        ]
        ..branchSwitchFails = true;
      final h = _Harness(server);
      await h.signIn();
      expect(h.controller.phase, AuthPhase.authenticated);
      expect(h.controller.context, isNotNull);
      expect(server.branchSwitchCalls, 1, reason: 'tried once, never in a loop');
    });

    test('a manual branch switch that fails keeps the session where it was and says so (never a login bounce)', () async {
      final h = await _signedIn(startBranch: 'branch-1');
      h.server.branchSwitchFails = true;
      await h.controller.selectBranch('branch-2');
      expect(h.controller.phase, AuthPhase.authenticated);
      expect(h.controller.context?.session.branchId, 'branch-1');
      expect(h.controller.state.failure?.code, AuthController.branchSwitchFailedCode);
      expect(h.controller.state.failure?.message, contains('sucursal'));

      h.controller.dismissBranchSwitchFailure();
      expect(h.controller.state.failure, isNull);
      expect(h.controller.phase, AuthPhase.authenticated);
    });

    test('a branch switch the user is not allowed to make never changes the session (UI state cannot widen access)', () async {
      final h = await _signedIn();
      expect(h.controller.context?.session.branchId, isNull);
      h.server.branchSwitchFails = true; // the server refuses a branch outside the user\'s scope
      await h.controller.selectBranch('branch-foreign');
      expect(h.controller.context?.session.branchId, isNull);
      expect(h.controller.context?.session.permittedBranchIds, isNot(contains('branch-foreign')));
    });

    test('a successful manual switch changes only the branch context and keeps the session', () async {
      final h = await _signedIn();
      await h.controller.selectBranch('branch-2');
      expect(h.controller.phase, AuthPhase.authenticated);
      expect(h.controller.context?.session.branchId, 'branch-2');
      expect(h.controller.state.failure, isNull);
      expect(h.server.refreshCalls, 0, reason: 'switching branch is not a re-login');
    });
  });
}
