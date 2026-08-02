enum AppErrorKind {
  validation,
  authentication,
  authorization,
  rateLimit,
  unavailable,
  timeout,
  unknown,
}

class AppFailure {
  const AppFailure(this.kind, this.message, {this.code = 'unknown'});
  factory AppFailure.fromCode(String code) => switch (code) {
    'validation_error' => const AppFailure(
      AppErrorKind.validation,
      'Revisa la información e inténtalo de nuevo.',
      code: 'validation_error',
    ),
    'invalid_credentials' => const AppFailure(
      AppErrorKind.authentication,
      'Los datos de acceso no son válidos.',
      code: 'invalid_credentials',
    ),
    'company_selection_required' => const AppFailure(
      AppErrorKind.authentication,
      'Selecciona la empresa con la que deseas continuar.',
      code: 'company_selection_required',
    ),
    'session_expired' => const AppFailure(
      AppErrorKind.authentication,
      'Tu sesión terminó. Inicia sesión nuevamente.',
      code: 'session_expired',
    ),
    'session_revoked' || 'refresh_token_reused' => const AppFailure(
      AppErrorKind.authentication,
      'La sesión fue cerrada por seguridad.',
      code: 'session_revoked',
    ),
    'permission_denied' => const AppFailure(
      AppErrorKind.authorization,
      'No tienes permiso para realizar esta acción.',
      code: 'permission_denied',
    ),
    'rate_limit_exceeded' => const AppFailure(
      AppErrorKind.rateLimit,
      'Espera un momento antes de intentarlo nuevamente.',
      code: 'rate_limit_exceeded',
    ),
    _ => const AppFailure(
      AppErrorKind.unknown,
      'No fue posible completar la solicitud.',
    ),
  };
  final AppErrorKind kind;
  final String message;
  final String code;
}
