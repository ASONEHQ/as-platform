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
    'invalid_login_challenge' => const AppFailure(
      AppErrorKind.authentication,
      'La selección ya no es válida. Inicia sesión nuevamente.',
      code: 'invalid_login_challenge',
    ),
    'login_challenge_expired' => const AppFailure(
      AppErrorKind.authentication,
      'La selección expiró. Inicia sesión nuevamente.',
      code: 'login_challenge_expired',
    ),
    'login_challenge_already_used' => const AppFailure(
      AppErrorKind.authentication,
      'La selección ya fue utilizada. Inicia sesión nuevamente.',
      code: 'login_challenge_already_used',
    ),
    'company_access_denied' => const AppFailure(
      AppErrorKind.authorization,
      'Ya no tienes acceso a esta empresa.',
      code: 'company_access_denied',
    ),
    'branch_access_denied' => const AppFailure(
      AppErrorKind.authorization,
      'Ya no tienes acceso a esta sucursal.',
      code: 'branch_access_denied',
    ),
    'session_expired' => const AppFailure(
      AppErrorKind.authentication,
      'Tu sesión terminó. Inicia sesión nuevamente.',
      code: 'session_expired',
    ),
    'session_revoked' => const AppFailure(
      AppErrorKind.authentication,
      'La sesión fue cerrada por seguridad.',
      code: 'session_revoked',
    ),
    'refresh_token_reused' => const AppFailure(
      AppErrorKind.authentication,
      'La sesión fue cerrada por seguridad.',
      code: 'refresh_token_reused',
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
    'service_unavailable' => const AppFailure(
      AppErrorKind.unavailable,
      'El servicio no está disponible.',
      code: 'service_unavailable',
    ),
    // TASK 12.7: the exact four cash-session error codes
    // `docs/API_CONTRACTS.md` §5 reserves — see ADR-0014.
    'cash_session_required' => const AppFailure(
      AppErrorKind.validation,
      'Abre la caja para comenzar a cobrar en efectivo.',
      code: 'cash_session_required',
    ),
    'cash_session_already_open' => const AppFailure(
      AppErrorKind.validation,
      'Esta caja ya tiene una sesión abierta.',
      code: 'cash_session_already_open',
    ),
    'cash_session_not_open' => const AppFailure(
      AppErrorKind.validation,
      'La caja no tiene una sesión abierta.',
      code: 'cash_session_not_open',
    ),
    'cash_session_closed' => const AppFailure(
      AppErrorKind.validation,
      'Esta sesión de caja ya fue cerrada.',
      code: 'cash_session_closed',
    ),
    // TASK 12.8: the refund-specific error codes `docs/API_CONTRACTS.md`
    // §5/§17 reserve — see ADR-0015. `payment_not_reversible`'s message is
    // the exact honest Spanish text the task itself requires wherever a
    // card refund is attempted while Mercado Pago stays unconfigured
    // (ADR-0015 D15) — never a fabricated success.
    'sale_not_refundable' => const AppFailure(
      AppErrorKind.validation,
      'Esta venta no admite devoluciones.',
      code: 'sale_not_refundable',
    ),
    'sale_not_mutable' => const AppFailure(
      AppErrorKind.validation,
      'Esta venta ya no puede modificarse.',
      code: 'sale_not_mutable',
    ),
    'refund_limit_exceeded' => const AppFailure(
      AppErrorKind.validation,
      'La cantidad solicitada excede lo disponible para devolución.',
      code: 'refund_limit_exceeded',
    ),
    'refund_approval_required' => const AppFailure(
      AppErrorKind.authorization,
      'Tu sesión no puede aprobar esta devolución automáticamente.',
      code: 'refund_approval_required',
    ),
    'payment_not_reversible' => const AppFailure(
      AppErrorKind.validation,
      'El reembolso con tarjeta requiere la configuración del proveedor de pago.',
      code: 'payment_not_reversible',
    ),
    'resource_conflict' => const AppFailure(
      AppErrorKind.validation,
      'La devolución no se encuentra en el estado esperado.',
      code: 'resource_conflict',
    ),
    'resource_not_found' => const AppFailure(
      AppErrorKind.validation,
      'No se encontró el recurso solicitado.',
      code: 'resource_not_found',
    ),
    'idempotency_conflict' => const AppFailure(
      AppErrorKind.validation,
      'La solicitud ya fue procesada con datos distintos.',
      code: 'idempotency_conflict',
    ),
    'version_conflict' => const AppFailure(
      AppErrorKind.validation,
      'La información cambió mientras tanto. Actualiza e inténtalo de nuevo.',
      code: 'version_conflict',
    ),
    // TASK 16.6B — found while wiring `_EditProductDialog`'s own "Guardar
    // precio" action: this code was previously UNMAPPED, so it fell into
    // the generic `_` case below and `AppFailure.code` came back
    // `'unknown'` — meaning `priceConflictMessage` (`pos_catalog_admin_
    // screen.dart`), despite existing since TASK 15.1 Phase 4 specifically
    // to give this exact error an honest, actionable message, could never
    // actually fire; both callers silently showed the generic fallback
    // text instead. Mapped here (never in `priceConflictMessage` itself)
    // so `code` stays a real passthrough of the backend's own
    // `price_conflict` (`product_prices_company_active_uq`/
    // `_branch_active_uq`), matching this switch's own established
    // pattern for every other domain-specific conflict code above.
    'price_conflict' => const AppFailure(
      AppErrorKind.validation,
      'Ya existe un precio activo para este producto en este alcance.',
      code: 'price_conflict',
    ),
    // TASK 13.0: customers/memberships/loyalty — see ADR-0017 D5/D21.
    // `resource_conflict`'s own switch entry above stays refund-scoped
    // (its message is specific to that domain); a customer-domain caller
    // never trusts that generic text and instead builds its own honest
    // message from this exception's own `code`/`details` — see
    // `posCustomerConflictMessage` in `pos_customers_gateway.dart`.
    'customer_identity_conflict' => const AppFailure(
      AppErrorKind.validation,
      'El correo y el teléfono ya pertenecen a clientes distintos.',
      code: 'customer_identity_conflict',
    ),
    'qr_token_invalid' => const AppFailure(
      AppErrorKind.validation,
      'El código QR no es válido.',
      code: 'qr_token_invalid',
    ),
    'membership_plan_inactive' => const AppFailure(
      AppErrorKind.validation,
      'Este plan de membresía no está activo.',
      code: 'membership_plan_inactive',
    ),
    'membership_not_active' => const AppFailure(
      AppErrorKind.validation,
      'Esta membresía no está activa.',
      code: 'membership_not_active',
    ),
    // TASK 13.1: reward entitlements/redemption — see ADR-0018 and
    // `packages/errors/src/index.ts`'s own reservation of these six codes.
    'reward_not_available' => const AppFailure(
      AppErrorKind.validation,
      'Esta recompensa no está disponible para canjear.',
      code: 'reward_not_available',
    ),
    'reward_expired' => const AppFailure(
      AppErrorKind.validation,
      'Esta recompensa ya venció.',
      code: 'reward_expired',
    ),
    'reward_already_redeemed' => const AppFailure(
      AppErrorKind.validation,
      'Esta recompensa ya fue canjeada.',
      code: 'reward_already_redeemed',
    ),
    'reward_already_revoked' => const AppFailure(
      AppErrorKind.validation,
      'Esta recompensa ya fue revocada.',
      code: 'reward_already_revoked',
    ),
    'reward_branch_not_eligible' => const AppFailure(
      AppErrorKind.validation,
      'Esta recompensa no puede canjearse en esta sucursal.',
      code: 'reward_branch_not_eligible',
    ),
    'reward_token_invalid' => const AppFailure(
      AppErrorKind.validation,
      'El código de la recompensa no es válido.',
      code: 'reward_token_invalid',
    ),
    // TASK 14.3 Wave 1 Part A: "Fiestas" (party reservations) — the four
    // codes `parties.types.ts`'s `PartyErrorCode` reserves beyond the
    // generic ones already mapped above (`validation_error`,
    // `idempotency_conflict`, `resource_not_found`, `resource_conflict`,
    // `version_conflict`). See `pos_parties_gateway.dart` for how a caller
    // builds a more specific, context-aware message from these codes where
    // the generic text here would be misleading (e.g. `resource_conflict`
    // stays refund-scoped above; a party caller never trusts it blindly).
    'party_conflict' => const AppFailure(
      AppErrorKind.validation,
      'Ese salón ya tiene una reservación en un horario que se traslapa con la fecha y hora elegidas.',
      code: 'party_conflict',
    ),
    'invalid_reservation_state' => const AppFailure(
      AppErrorKind.validation,
      'Esa reservación no puede cambiar a ese estado desde su estado actual.',
      code: 'invalid_reservation_state',
    ),
    'insufficient_inventory' => const AppFailure(
      AppErrorKind.validation,
      'No hay inventario suficiente para descontar esas calcetas.',
      code: 'insufficient_inventory',
    ),
    'inventory_location_not_found' => const AppFailure(
      AppErrorKind.unavailable,
      'No se encontró una ubicación de inventario válida para esa talla.',
      code: 'inventory_location_not_found',
    ),
    // TASK 14.4 Wave 2: "People" (Empleados/Horarios/Checador/Nómina) —
    // the four genuinely new codes `people.types.ts`'s `PeopleErrorCode`
    // introduces beyond the generic ones already mapped above
    // (`validation_error`, `resource_not_found`, `resource_conflict`,
    // `version_conflict`, `idempotency_conflict`, `permission_denied`).
    // See `people.http-errors.ts`'s own doc comment.
    'employee_inactive' => const AppFailure(
      AppErrorKind.validation,
      'Este empleado está inactivo y no puede registrar entrada.',
      code: 'employee_inactive',
    ),
    'duplicate_clock_in' => const AppFailure(
      AppErrorKind.validation,
      'Este empleado ya tiene una entrada abierta.',
      code: 'duplicate_clock_in',
    ),
    'invalid_clock_out' => const AppFailure(
      AppErrorKind.validation,
      'No hay una entrada abierta para registrar la salida de este empleado.',
      code: 'invalid_clock_out',
    ),
    'payroll_period_closed' => const AppFailure(
      AppErrorKind.validation,
      'Un periodo de nómina cerrado ya no puede recalcularse.',
      code: 'payroll_period_closed',
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
