/// TASK 14.5 (Wave 3, Phase 4b/7 Item 8): the Flutter side of the real,
/// server-validated quick-switch PIN/QR staff login — `POST /api/v1/auth/
/// pin-login` / `POST /api/v1/auth/qr-login` (`auth.routes.ts`). Mirrors
/// `pos_assistant_gateway.dart`'s own established three-class shape
/// exactly (abstract interface / `Api...` / `Empty...`).
///
/// SECURITY MODEL (mirrors `AuthService.pinLogin`/`qrLogin`'s own doc
/// comment — read that first): both calls require the terminal's OWN
/// already-authenticated session (the same bearer token every other
/// gateway in this app already sends via `ApiClient`'s `authenticated:
/// true` default) — this is never a bare anonymous PIN/QR-only login
/// front door. On success the backend mints a REAL, independent session
/// for the resolved staff member through the exact same path password
/// login uses. This gateway deliberately does NOT adopt that new session
/// as the app's own active one — doing so would require session-
/// replacement plumbing at the app root (`app.dart`/`bootstrap.dart`,
/// where the currently-authenticated `AuthenticatedContext` actually
/// lives), which is a materially larger, riskier change than this wave's
/// scope. What this gives the cashier today is real, honest, server-
/// verified proof that a PIN/QR code belongs to a real, active staff
/// member of THIS company — exactly what `_StaffQuickSwitchDialog` shows
/// (`pos_shell.dart`) — never a fabricated "switched" state. Fully
/// adopting the new session as the active one (a true identity hand-off)
/// is a natural, explicitly-noted follow-up, not attempted here.
library;

import '../../core/networking/api_client.dart';

abstract interface class PosAuthGateway {
  /// `POST /api/v1/auth/pin-login`. Throws [ApiException] with code
  /// `invalid_credentials` on any wrong/unknown PIN — never a hint about
  /// which part was wrong (mirrors password login's own honest failure).
  Future<void> pinLogin(String pin);

  /// `POST /api/v1/auth/qr-login`. Same honest-failure contract as
  /// [pinLogin].
  Future<void> qrLogin(String code);
}

class ApiPosAuthGateway implements PosAuthGateway {
  const ApiPosAuthGateway(this._client, {required this.readCsrfToken});

  final ApiClient _client;

  // TASK 17.5.1 — production root cause: `auth.routes.ts`'s `/pin-login`
  // and `/qr-login` routes both require a valid `X-CSRF-Token` header
  // whenever the caller's own session has `transportMode == 'browser'`
  // (`AuthService.verifyCsrf`) — exactly what every real ACCESS GO web
  // session has (`auth_gateway.dart`'s own `login()` always sends
  // `transport_mode: 'browser'`). `ApiAuthGateway.switchByPin`/`switchByQr`
  // (the OTHER, session-adopting client for these same two endpoints)
  // already attaches this correctly via its own `_requiredCsrf()`; this
  // gateway never did, so every real production PIN/QR verification here
  // failed CSRF validation 100% of the time, surfacing as the generic
  // `validation_error` -> "Revisa la información e inténtalo de nuevo." —
  // indistinguishable from a wrong PIN, even though the configured PIN was
  // always correct. Mirrors `ApiAuthGateway`'s own `readCsrfToken`/
  // `_requiredCsrf` pattern exactly, not a new mechanism.
  final String? Function() readCsrfToken;

  String _requiredCsrf() {
    final value = readCsrfToken();
    if (value == null) throw const FormatException('Missing CSRF token.');
    return value;
  }

  @override
  Future<void> pinLogin(String pin) async {
    await _client.postJson('/api/v1/auth/pin-login', csrfToken: _requiredCsrf(), body: {'pin': pin});
  }

  @override
  Future<void> qrLogin(String code) async {
    await _client.postJson('/api/v1/auth/qr-login', csrfToken: _requiredCsrf(), body: {'code': code});
  }
}

class EmptyPosAuthGateway implements PosAuthGateway {
  const EmptyPosAuthGateway();

  @override
  Future<void> pinLogin(String pin) => Future.error(StateError('No auth gateway is configured.'));

  @override
  Future<void> qrLogin(String code) => Future.error(StateError('No auth gateway is configured.'));
}
