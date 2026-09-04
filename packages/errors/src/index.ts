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
  // here. See ADR-0015.
  'cash_session_required',
  'cash_session_already_open',
  'cash_session_not_open',
  'cash_session_closed',
  'product_not_found',
  'product_not_active',
  'price_not_found',
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
