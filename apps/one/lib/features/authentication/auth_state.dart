import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../core/errors/app_error.dart';
import '../../core/networking/api_client.dart';
import '../../core/storage/token_vault.dart';
import '../../core/telemetry/telemetry.dart';
import 'auth_gateway.dart';
import 'auth_models.dart';

class AuthController extends ChangeNotifier {
  AuthController(this._gateway, this._vault, this._telemetry);

  final AuthGateway _gateway;
  final MemoryTokenVault _vault;
  final Telemetry _telemetry;
  AuthViewState _state = const AuthViewState(phase: AuthPhase.bootstrapping);
  String? _csrfToken;
  String? _challengeToken;
  DateTime? _challengeExpiresAt;
  Future<void>? _refreshFuture;

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
      _handleFailure(error, retainedContext: current);
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

  Future<void> refresh() =>
      _refreshFuture ??= _refreshAndHydrate().whenComplete(() {
        _refreshFuture = null;
      });

  Future<void> _refreshAndHydrate({bool restored = false}) async {
    final csrf = _csrfToken;
    if (csrf == null) throw const FormatException('Missing CSRF proof.');
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
    try {
      final hydrated = await _gateway.hydrate(credentials.session);
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
      await _gateway.logout();
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
      _ => AuthPhase.failure,
    };
    if (phase == AuthPhase.expired || phase == AuthPhase.revoked) _clearAll();
    _emit(
      AuthViewState(phase: phase, failure: failure, context: retainedContext),
    );
  }

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
  }

  void _clearAll() {
    _clearCredentials();
    _clearChallenge();
  }

  void _emit(AuthViewState next) {
    _state = next;
    notifyListeners();
  }
}
