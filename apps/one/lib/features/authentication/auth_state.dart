import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../core/errors/app_error.dart';
import '../../core/networking/api_client.dart';
import '../../core/storage/token_vault.dart';
import '../../core/telemetry/telemetry.dart';
import 'auth_gateway.dart';
import 'auth_models.dart';

class AuthController extends ChangeNotifier {
  AuthController(
    this._gateway,
    this._vault,
    this._telemetry, {
    DateTime Function()? clock,
  }) : _clock = clock ?? (() => DateTime.now().toUtc());

  /// TASK 17.7.3 — an access token is renewed this long BEFORE it expires …
  static const Duration refreshSkew = Duration(seconds: 60);

  /// … and never more often than this (a storm guard if a server/clock
  /// disagreement made every fresh token look already stale).
  static const Duration minRefreshInterval = Duration(seconds: 10);

  final AuthGateway _gateway;
  final MemoryTokenVault _vault;
  final Telemetry _telemetry;
  final DateTime Function() _clock;
  AuthViewState _state = const AuthViewState(phase: AuthPhase.bootstrapping);
  String? _csrfToken;
  String? _challengeToken;
  DateTime? _challengeExpiresAt;
  Future<void>? _refreshFuture;
  // When the CURRENT access token stops being valid (the token response's own
  // `expires_at`, never the session's), and when we last obtained one.
  DateTime? _accessExpiresAt;
  DateTime? _lastRefreshAt;
  // One automatic "only branch" selection per login.
  bool _autoBranchTried = false;

  AuthViewState get state => _state;
  AuthPhase get phase => _state.phase;
  String? get csrfToken => _csrfToken;
  AuthenticatedContext? get context => _state.context;
  bool get hasChallenge =>
      _challengeToken != null &&
      _challengeExpiresAt != null &&
      _challengeExpiresAt!.isAfter(DateTime.now().toUtc());

  Future<void> bootstrapSession() async {
    _emit(const AuthViewState(phase: AuthPhase.bootstrapping));
    try {
      final proof = await _gateway.bootstrapBrowser();
      _csrfToken = proof.csrfToken;
      await _refreshAndHydrate(restored: true);
    } on Object catch (error) {
      _handleFailure(error, bootstrap: true);
    }
  }

  Future<void> login({
    required String identifier,
    required String password,
  }) async {
    if (_state.phase == AuthPhase.authenticating) return;
    _telemetry.recordEvent('login_attempt');
    _emit(const AuthViewState(phase: AuthPhase.authenticating));
    try {
      final outcome = await _gateway.login(
        identifier: identifier.trim(),
        password: password,
      );
      switch (outcome) {
        case LoginAuthenticated(:final credentials):
          _telemetry.recordEvent('login_success');
          await _acceptCredentials(credentials);
        case LoginCompanySelection(
          :final challengeToken,
          :final expiresAt,
          :final companies,
        ):
          _challengeToken = challengeToken;
          _challengeExpiresAt = expiresAt;
          _telemetry.recordEvent('company_selection_required');
          _emit(
            AuthViewState(
              phase: AuthPhase.companySelectionRequired,
              selectionCompanies: companies,
            ),
          );
      }
    } on Object catch (error) {
      _telemetry.recordEvent(
        'login_failure',
        attributes: {'class': _safeCode(error)},
      );
      _handleFailure(error);
    }
  }

  Future<void> selectCompany(String companyId) async {
    if (_state.phase != AuthPhase.companySelectionRequired || !hasChallenge) {
      _clearChallenge();
      _emit(
        const AuthViewState(
          phase: AuthPhase.failure,
          failure: AppFailure(
            AppErrorKind.authentication,
            'La selección expiró. Inicia sesión nuevamente.',
            code: 'login_challenge_expired',
          ),
        ),
      );
      return;
    }
    final companies = _state.selectionCompanies;
    _emit(
      AuthViewState(
        phase: AuthPhase.selectingCompany,
        selectionCompanies: companies,
      ),
    );
    try {
      final credentials = await _gateway.completeCompanySelection(
        challengeToken: _challengeToken!,
        companyId: companyId,
      );
      _clearChallenge();
      _telemetry.recordEvent('company_selection_success');
      await _acceptCredentials(credentials);
    } on Object catch (error) {
      final terminal = const {
        'invalid_login_challenge',
        'login_challenge_expired',
        'login_challenge_already_used',
      }.contains(_safeCode(error));
      if (terminal) _clearChallenge();
      _handleFailure(error);
    }
  }

  Future<void> selectBranch(String? branchId) async {
    final current = _state.context;
    if (current == null ||
        (_state.phase != AuthPhase.branchSelectionRequired &&
            _state.phase != AuthPhase.authenticated)) {
      return;
    }
    if (branchId == null && !current.companyWideAccess) return;
    final previousPhase = _state.phase;
    _emit(
      AuthViewState(
        phase: AuthPhase.selectingBranch,
        context: current,
        selectionBranches: current.branches,
      ),
    );
    try {
      await _acceptCredentials(await _gateway.switchBranch(branchId));
      _telemetry.recordEvent('branch_selection_success');
    } on Object catch (error) {
      if (_isSessionTerminal(error)) {
        _handleFailure(error, retainedContext: current);
        return;
      }
      // TASK 17.7.3 — a branch switch that fails for any reason other than a
      // dead session (transient network error, a branch the user may not
      // use, …) must leave the user exactly where they were with an honest
      // message — never bounce them to the login screen.
      _telemetry.recordEvent('branch_selection_failure', attributes: {'class': _safeCode(error)});
      _emit(
        AuthViewState(
          phase: previousPhase == AuthPhase.selectingBranch ? AuthPhase.authenticated : previousPhase,
          context: current,
          failure: _failureOf(error),
          selectionBranches: previousPhase == AuthPhase.branchSelectionRequired ? current.branches : const [],
        ),
      );
    }
  }

  Future<void> switchCompany(String companyId) async {
    final current = _state.context;
    if (current == null || _state.phase != AuthPhase.authenticated) return;
    _emit(AuthViewState(phase: AuthPhase.selectingCompany, context: current));
    try {
      await _acceptCredentials(await _gateway.switchCompany(companyId));
      _telemetry.recordEvent('company_selection_success');
    } on Object catch (error) {
      _handleFailure(error, retainedContext: current);
    }
  }

  /// TASK 15.1 Phase 5: PIN/QR quick-switch real session hand-off — adopts
  /// the verified staff member's own real, independently-minted session
  /// (`AuthService.pinLogin`, `auth.service.ts:636`) as this terminal's
  /// actual active session, mirroring `switchCompany`'s exact pattern:
  /// call the gateway, hydrate via `_acceptCredentials`, and on any
  /// honest failure leave the CURRENT session/context completely
  /// untouched via `_handleFailure(error, retainedContext: current)`.
  ///
  /// One deliberate difference from `switchCompany`/`selectBranch`:
  /// `preserveCurrentPhaseOnGenericFailure: true` — see that parameter's
  /// own doc comment on `_handleFailure` below for why. In short: this is
  /// the only `_handleFailure` caller invoked from *inside* an
  /// already-authenticated, actively-in-use POS session (every other
  /// caller runs from a dedicated pre-dashboard/transitional auth
  /// screen), so an ordinary wrong-PIN/QR denial must never force
  /// `router.dart`'s unconditional `AuthPhase.failure -> '/login'`
  /// redirect out from under a cashier mid-sale — it must surface as an
  /// honest, inline error instead. A truly dead CURRENT session
  /// (`session_expired`/`session_revoked`) is untouched by that
  /// parameter and still correctly transitions to `/session-ended`,
  /// exactly like every other caller.
  ///
  /// No transient "busy" phase is emitted before the gateway call (unlike
  /// `switchCompany`'s `AuthPhase.selectingCompany`/`selectBranch`'s
  /// `AuthPhase.selectingBranch`) — the router maps BOTH of those phases
  /// to a full-screen redirect (`/select-company`/`/select-branch`),
  /// which would incorrectly navigate away from the POS dashboard for
  /// the whole (short) duration of a quick-switch call. The dialog's own
  /// `_busy` flag already carries the loading UI.
  Future<void> quickSwitchByPin(String pin) async {
    final current = _state.context;
    if (current == null || _state.phase != AuthPhase.authenticated) return;
    try {
      await _acceptCredentials(await _gateway.switchByPin(pin));
      _telemetry.recordEvent('quick_switch_pin_success');
    } on Object catch (error) {
      _telemetry.recordEvent(
        'quick_switch_pin_failure',
        attributes: {'class': _safeCode(error)},
      );
      _handleFailure(
        error,
        retainedContext: current,
        preserveCurrentPhaseOnGenericFailure: true,
      );
    }
  }

  /// Same real hand-off as [quickSwitchByPin], via `/api/v1/auth/qr-login`.
  Future<void> quickSwitchByQr(String code) async {
    final current = _state.context;
    if (current == null || _state.phase != AuthPhase.authenticated) return;
    try {
      await _acceptCredentials(await _gateway.switchByQr(code));
      _telemetry.recordEvent('quick_switch_qr_success');
    } on Object catch (error) {
      _telemetry.recordEvent(
        'quick_switch_qr_failure',
        attributes: {'class': _safeCode(error)},
      );
      _handleFailure(
        error,
        retainedContext: current,
        preserveCurrentPhaseOnGenericFailure: true,
      );
    }
  }

  Future<void> refresh() {
    // A refresh requested from INSIDE session management itself (hydrate,
    // logout) would wait on the very refresh it belongs to.
    if (Zone.current[authInternalZoneKey] == true) {
      return Future.error(
        const ApiException(
          AppFailure(AppErrorKind.authentication, 'La sesión expiró.', code: 'session_expired'),
        ),
      );
    }
    return _refreshFuture ??= _guardedRefresh().whenComplete(() {
      _refreshFuture = null;
    });
  }

  /// TASK 17.7.3 — wired to `ApiClient.beforeAuthenticatedRequest`. Renews
  /// the access token (ONE shared refresh no matter how many requests ask at
  /// once) when it is expired or within [refreshSkew] of expiring, so the
  /// request that follows goes out once, with a valid token. Throws only when
  /// the session is genuinely over — the caller must then NOT send its
  /// request. A transient network failure is swallowed: the request is
  /// attempted anyway and fails (or succeeds) on its own merits.
  Future<void> ensureFreshAccessToken() async {
    if (Zone.current[authInternalZoneKey] == true) return;
    final expiresAt = _accessExpiresAt;
    // The session is already over (expired/revoked): fail fast and send
    // NOTHING — no request is made with a dead session, and nothing tries to
    // renew one that cannot be renewed.
    if (_state.phase == AuthPhase.expired || _state.phase == AuthPhase.revoked) {
      throw const ApiException(
        AppFailure(AppErrorKind.authentication, 'La sesión expiró. Inicia sesión nuevamente.', code: 'session_expired'),
      );
    }
    if (_state.context == null || expiresAt == null) return;
    final now = _clock();
    if (expiresAt.difference(now) > refreshSkew) return;
    final inFlight = _refreshFuture;
    if (inFlight == null) {
      final last = _lastRefreshAt;
      if (last != null && now.difference(last) < minRefreshInterval) return;
    }
    try {
      await refresh();
    } on ApiException catch (error) {
      if (_isTransient(error.failure.code)) return;
      rethrow;
    }
  }

  // TASK 16.23E — `refresh()` is wired to `ApiClient.onUnauthorized` (see
  // `bootstrap.dart`), fired reactively whenever any GET request hits a
  // real 401 mid-session. `_refreshAndHydrate` on its own only records
  // telemetry and rethrows — fine for `bootstrapSession()`, whose own
  // call site already wraps it in `_handleFailure`, but this reactive
  // path had no equivalent handling: a real refresh failure (expired/
  // invalid refresh token, transport mismatch, etc.) left `_state` frozen
  // at whatever phase it was already in, the stale access token never
  // cleared, and the router never redirecting to `/login` — every
  // subsequent authenticated screen for the rest of the session repeated
  // the identical 401→refresh→failure cycle, each showing only its own
  // generic per-screen error with no indication the real problem was the
  // session itself.
  Future<void> _guardedRefresh() async {
    final previous = _state.context;
    try {
      await _refreshAndHydrate();
    } on Object catch (error) {
      // TASK 17.7.3 — a transient failure (network down, timeout) while
      // renewing mid-session must not replace the working screen with the
      // full-screen "unavailable" page: the session is still valid, so
      // restore it and let the request surface its own honest error.
      if (previous != null && _isTransient(_safeCode(error))) {
        _emit(AuthViewState(phase: AuthPhase.authenticated, context: previous));
        rethrow;
      }
      _handleFailure(error);
      rethrow;
    }
  }

  Future<void> _refreshAndHydrate({bool restored = false}) async {
    final csrf = _csrfToken;
    // No CSRF proof means there is no browser session to renew: that is a
    // finished session, not a malformed response.
    if (csrf == null) {
      throw const ApiException(
        AppFailure(AppErrorKind.authentication, 'La sesión expiró.', code: 'session_expired'),
      );
    }
    final previous = _state.context;
    _emit(AuthViewState(phase: AuthPhase.refreshing, context: previous));
    try {
      await _acceptCredentials(await _gateway.refresh(csrf));
      _telemetry.recordEvent(restored ? 'session_restored' : 'refresh_success');
    } on Object catch (error) {
      _telemetry.recordEvent(
        'refresh_failure',
        attributes: {'class': _safeCode(error)},
      );
      rethrow;
    }
  }

  Future<void> _acceptCredentials(SessionCredentials credentials) async {
    _vault.replace(credentials.accessToken);
    _csrfToken = credentials.csrfToken;
    // Recorded BEFORE hydrating so the requests hydrate makes already see a
    // fresh token (and never ask for another renewal).
    _accessExpiresAt = credentials.session.expiresAt;
    _lastRefreshAt = _clock();
    try {
      final hydrated = await runZoned(
        () => _gateway.hydrate(credentials.session),
        zoneValues: {authInternalZoneKey: true},
      );
      // TASK 17.7.3 — exactly one accessible branch and none selected: select
      // it, instead of making a user choose between one option (or, for a
      // company-wide user, sit in a context where cash/schedules/time clock
      // cannot work). Generic — driven by the branches the backend returned.
      final onlyBranch = _soleBranch(hydrated);
      if (onlyBranch != null && !_autoBranchTried) {
        _autoBranchTried = true;
        SessionCredentials? switched;
        try {
          switched = await _gateway.switchBranch(onlyBranch.id);
          _telemetry.recordEvent('branch_auto_selected');
        } on Object catch (error) {
          // Best effort: fall through to the normal state below.
          _telemetry.recordEvent('branch_auto_select_failure', attributes: {'class': _safeCode(error)});
        }
        if (switched != null) {
          await _acceptCredentials(switched);
          return;
        }
      }
      final needsBranch =
          hydrated.session.branchId == null && !hydrated.companyWideAccess;
      _emit(
        AuthViewState(
          phase: needsBranch
              ? AuthPhase.branchSelectionRequired
              : AuthPhase.authenticated,
          context: hydrated,
          selectionBranches: needsBranch ? hydrated.branches : const [],
        ),
      );
    } on Object {
      _clearCredentials();
      rethrow;
    }
  }

  Future<void> logout() async {
    try {
      // Logging out must never trigger a token renewal of its own.
      await runZoned(() => _gateway.logout(), zoneValues: {authInternalZoneKey: true});
    } on Object {
      // Local logout is authoritative for UI safety even when the API is unavailable.
    } finally {
      _clearAll();
      _telemetry.recordEvent('logout');
      _emit(const AuthViewState(phase: AuthPhase.unauthenticated));
    }
  }

  void retry() {
    if (_state.phase == AuthPhase.unavailable) {
      unawaited(bootstrapSession());
    } else {
      _clearAll();
      _emit(const AuthViewState(phase: AuthPhase.unauthenticated));
    }
  }

  void _handleFailure(
    Object error, {
    bool bootstrap = false,
    AuthenticatedContext? retainedContext,
    // TASK 15.1 Phase 5: set only by `quickSwitchByPin`/`quickSwitchByQr`
    // — see their own doc comments. When true AND a context is being
    // retained, an otherwise-generic failure (the default `_` bucket
    // below — this is where `invalid_credentials` lands, the exact same
    // uniform honest-denial code `AuthService.pinLogin`/`qrLogin` returns
    // for every rejection reason, including a deactivated/unpermitted
    // staff member — see that service method's own doc comment) keeps
    // the CURRENT phase instead of moving to the plain `AuthPhase.failure`
    // bucket. That distinction matters because `router.dart`'s redirect
    // treats `AuthPhase.failure` as an unconditional "go to `/login`"
    // (correct for a real login/company-selection/branch-selection
    // attempt, all of which run from a dedicated pre-dashboard screen
    // that failing out of is fine) — but a mistyped quick-switch PIN must
    // never bounce a cashier mid-sale back to the login screen. The
    // failure itself is still fully surfaced via `AuthViewState.failure`
    // either way; only the navigation-driving `phase` differs.
    bool preserveCurrentPhaseOnGenericFailure = false,
  }) {
    final failure = switch (error) {
      ApiException(:final failure) => failure,
      FormatException() => const AppFailure(
        AppErrorKind.unknown,
        'La respuesta del servicio no es válida.',
        code: 'malformed_response',
      ),
      _ => const AppFailure(
        AppErrorKind.unavailable,
        'El servicio no está disponible.',
        code: 'api_unavailable',
      ),
    };
    if (bootstrap && failure.code == 'session_expired') {
      _clearAll();
      _emit(const AuthViewState(phase: AuthPhase.unauthenticated));
      return;
    }
    final phase = switch (failure.code) {
      'session_expired' => AuthPhase.expired,
      'session_revoked' || 'refresh_token_reused' => AuthPhase.revoked,
      'api_unavailable' ||
      'service_unavailable' ||
      'timeout' => AuthPhase.unavailable,
      _ when preserveCurrentPhaseOnGenericFailure && retainedContext != null =>
        _state.phase,
      _ => AuthPhase.failure,
    };
    if (phase == AuthPhase.expired || phase == AuthPhase.revoked) _clearAll();
    _emit(
      AuthViewState(phase: phase, failure: failure, context: retainedContext),
    );
  }

  BranchSummary? _soleBranch(AuthenticatedContext hydrated) {
    if (hydrated.session.branchId != null) return null;
    final branches = hydrated.branches;
    if (branches.length != 1) return null;
    final permitted = hydrated.session.permittedBranchIds;
    if (permitted.isNotEmpty && !permitted.contains(branches.single.id)) return null;
    return branches.single;
  }

  bool _isTransient(String code) => const {'api_unavailable', 'service_unavailable', 'timeout'}.contains(code);

  bool _isSessionTerminal(Object error) =>
      const {'session_expired', 'session_revoked', 'refresh_token_reused'}.contains(_safeCode(error));

  AppFailure _failureOf(Object error) => switch (error) {
    ApiException(:final failure) => failure,
    FormatException() => const AppFailure(AppErrorKind.unknown, 'La respuesta del servicio no es válida.', code: 'malformed_response'),
    _ => const AppFailure(AppErrorKind.unavailable, 'El servicio no está disponible.', code: 'api_unavailable'),
  };

  String _safeCode(Object error) => switch (error) {
    ApiException(:final failure) => failure.code,
    FormatException() => 'malformed_response',
    _ => 'api_unavailable',
  };

  void _clearChallenge() {
    _challengeToken = null;
    _challengeExpiresAt = null;
  }

  void _clearCredentials() {
    _vault.clear();
    _csrfToken = null;
    _accessExpiresAt = null;
    _lastRefreshAt = null;
  }

  void _clearAll() {
    _clearCredentials();
    _clearChallenge();
    _autoBranchTried = false;
  }

  void _emit(AuthViewState next) {
    _state = next;
    notifyListeners();
  }
}
