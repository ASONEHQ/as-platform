export const infrastructureErrorCodes = [
  'configuration_error',
  'authentication_required',
  'invalid_credentials',
  'invalid_login_challenge',
  'login_challenge_expired',
  'login_challenge_already_used',
  'company_access_denied',
  'branch_access_denied',
  'session_revoked',
  'refresh_token_reused',
  'session_expired',
  'permission_denied',
  'company_scope_mismatch',
  'branch_scope_mismatch',
  'device_revoked',
  'validation_error',
  'version_conflict',
  'idempotency_conflict',
  'duplicate_category_code',
  'category_cycle_detected',
  'duplicate_brand_code',
  'duplicate_product_code',
  'duplicate_sku',
  'duplicate_barcode',
  'duplicate_option_code',
  'duplicate_option_value_code',
  'duplicate_option_selection',
  'invalid_product_state',
  'invalid_option_state',
  'invalid_option_value_state',
  'invalid_variant_state',
  'inventory_unit_locked',
  'inventory_location_not_found',
  'inventory_location_inactive',
  'inventory_movement_not_found',
  'inventory_movement_not_reversible',
  'inventory_movement_line_not_found',
  'invalid_movement_state',
  'movement_already_posted',
  'movement_already_reversed',
  'movement_already_cancelled',
  'invalid_movement_direction',
  'invalid_movement_type',
  'invalid_inventory_location',
  'duplicate_movement_line',
  'movement_has_no_lines',
  'inventory_balance_not_found',
  'inventory_balance_conflict',
  'inventory_count_in_progress',
  'inventory_reconciliation_required',
  'reconciliation_repair_not_allowed',
  'reconciliation_finding_stale',
  'reconciliation_finding_already_resolved',
  'reconciliation_preview_expired',
  'count_not_editable',
  'count_has_incomplete_lines',
  'count_not_approvable',
  'count_not_applicable',
  'count_lock_expired',
  'count_already_applied',
  'insufficient_inventory',
  'reservation_expired',
  'reservation_already_completed',
  'resource_not_found',
  'transfer_invalid_transition',
  'transfer_quantity_exceeded',
  'invalid_movement_line',
  'numeric_overflow',
  'product_variant_not_found',
  'unit_of_measure_not_found',
  'branch_not_found',
  'resource_conflict',
  'option_combination_conflict',
  'option_value_wrong_product',
  'product_has_active_dependencies',
  // TASK 12.3C: reserved by docs/API_CONTRACTS.md §5 for an overlapping/
  // conflicting product price submission.
  'price_conflict',
  // TASK 12.4A: payment/terminal foundation — see ADR-0008 and
  // docs/API_CONTRACTS.md §16/§21.3.
  'invalid_payment_state',
  'invalid_attempt_state',
  'terminal_not_active',
  'terminal_branch_mismatch',
  'terminal_required',
  'duplicate_provider_reference',
  'currency_mismatch',
  // TASK 12.4A.1: sale foundation — see ADR-0009 and
  // docs/API_CONTRACTS.md §21.2.
  'invalid_sale_state',
  'sale_branch_mismatch',
  // TASK 12.5A: cash payment + real sale completion — see ADR-0011. The
  // cashier tendered less than the server-computed amount due; the
  // request is rejected outright (never a partial/short payment).
  'insufficient_tendered',
  // TASK 12.7: cash register/session — the exact four codes
  // docs/API_CONTRACTS.md §5 already reserves verbatim, none invented
  // here. See ADR-0014.
  'cash_session_required',
  'cash_session_already_open',
  'cash_session_not_open',
  'cash_session_closed',
  // TASK 12.8: returns/refunds — the exact five codes
  // docs/API_CONTRACTS.md §5 already reserves verbatim. See ADR-0015.
  'sale_not_mutable',
  'payment_not_reversible',
  'sale_not_refundable',
  'refund_limit_exceeded',
  'refund_approval_required',
  // TASK 12.9: promotions/discounts/coupons — this domain is not
  // pre-reserved anywhere (see ADR-0016), so these 9 codes are this
  // task's own addition, none overlapping an existing generic code.
  'coupon_not_found',
  'coupon_inactive',
  'coupon_not_started',
  'coupon_expired',
  'coupon_branch_not_eligible',
  'coupon_usage_exhausted',
  'coupon_cart_not_eligible',
  'discount_not_authorized',
  'discount_invalid',
  // TASK 13.0: customers/memberships/rewards — this domain is not
  // pre-reserved anywhere (see ADR-0017); every other lookup/validation
  // failure in this domain reuses an existing generic code
  // (`resource_not_found`, `resource_conflict`, `validation_error`) rather
  // than inventing a synonym, matching this codebase's own convention.
  // These four are genuinely new SEMANTIC concepts a generic code cannot
  // express.
  'customer_identity_conflict',
  'membership_plan_inactive',
  'membership_not_active',
  'qr_token_invalid',
  // TASK 13.1: reward entitlements/redemption — this domain is not
  // pre-reserved anywhere (see ADR-0018); reused generics
  // (`resource_not_found`/`resource_conflict`/`validation_error`) cover
  // everything else, these six are genuinely new semantic concepts.
  'reward_not_available',
  'reward_expired',
  'reward_already_redeemed',
  'reward_already_revoked',
  'reward_branch_not_eligible',
  'reward_token_invalid',
  'product_not_found',
  'product_not_active',
  'price_not_found',
  // TASK 14.3 (Wave 1, Part A): party reservations/rooms/packages — this
  // domain is not pre-reserved anywhere. Every other lookup/validation
  // failure reuses an existing generic code (`resource_not_found`,
  // `resource_conflict`, `validation_error`, `version_conflict`,
  // `branch_scope_mismatch`, `insufficient_inventory`,
  // `inventory_location_not_found`), matching this codebase's own
  // convention (see TASK 13.0/13.1's own precedent above). These two are
  // genuinely new semantic concepts a generic code cannot express:
  // `party_conflict` is the room double-booking rejection (the database's
  // own `party_reservations_room_time_excl` GIST exclusion constraint,
  // translated to a clean error — see `parties.http-errors.ts`);
  // `invalid_reservation_state` is a rejected status-machine transition
  // or an edit/cancel attempted against a `completed`/`cancelled`
  // reservation.
  'party_conflict',
  'invalid_reservation_state',
  // TASK 14.4 (Wave 2): every other new-domain failure this wave reuses
  // an existing generic code (`resource_not_found`, `resource_conflict`,
  // `validation_error`, `version_conflict`, `idempotency_conflict`,
  // `permission_denied`, `cash_session_not_open`), matching this
  // codebase's own established convention. These five are genuinely new
  // semantic concepts a generic code cannot express: `supplier_inactive`
  // (Part C — a direct purchase rejected against a supplier marked
  // inactive); `employee_inactive`/`duplicate_clock_in`/
  // `invalid_clock_out` (Part B — Checador: a deactivated employee
  // cannot clock in; a second clock-in without an intervening clock-out;
  // a clock-out with no open clock-in to close); `payroll_period_closed`
  // (Part B — Nómina: a closed period's frozen lines can never be
  // silently recalculated).
  'supplier_inactive',
  'employee_inactive',
  'duplicate_clock_in',
  'invalid_clock_out',
  'payroll_period_closed',
  'not_found',
  'method_not_allowed',
  'payload_too_large',
  'unsupported_media_type',
  'rate_limit_exceeded',
  'service_unavailable',
  'internal_error',
] as const;

export type InfrastructureErrorCode = (typeof infrastructureErrorCodes)[number];

export interface AppErrorOptions {
  readonly code: InfrastructureErrorCode;
  readonly statusCode: number;
  readonly message: string;
  readonly details?: readonly unknown[] | Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

export class AppError extends Error {
  public readonly code: InfrastructureErrorCode;
  public readonly statusCode: number;
  public readonly details: readonly unknown[] | Readonly<Record<string, unknown>> | undefined;

  public constructor(options: AppErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = 'AppError';
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.details = options.details;
  }

  public toPublicResponse(): Readonly<Record<string, unknown>> {
    return Object.freeze({
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
    });
  }
}
