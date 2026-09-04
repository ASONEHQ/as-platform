export type PaymentMethod = 'cash' | 'card_terminal' | 'card_manual' | 'other';
export const paymentMethods: readonly PaymentMethod[] = [
  'cash',
  'card_terminal',
  'card_manual',
  'other',
];

/** The exact five states already defined by docs/API_CONTRACTS.md §21.3 —
 * never a project-invented name. */
export type PaymentStatus = 'pending' | 'authorized' | 'captured' | 'failed' | 'reversed';
export const paymentStatuses: readonly PaymentStatus[] = [
  'pending',
  'authorized',
  'captured',
  'failed',
  'reversed',
];

/** New (not yet in the contract) — the finer-grained terminal-interaction
 * lifecycle a single attempt goes through. See ADR-0008. */
export type PaymentAttemptStatus =
  | 'created'
  | 'awaiting_terminal'
  | 'processing'
  | 'approved'
  | 'declined'
  | 'cancelled'
  | 'timed_out'
  | 'failed';
export const paymentAttemptStatuses: readonly PaymentAttemptStatus[] = [
  'created',
  'awaiting_terminal',
  'processing',
  'approved',
  'declined',
  'cancelled',
  'timed_out',
  'failed',
];
/** Attempt statuses that end that attempt (a retry needs a new attempt). */
export const terminalAttemptStatuses: ReadonlySet<PaymentAttemptStatus> = new Set([
  'approved',
  'declined',
  'cancelled',
  'timed_out',
  'failed',
]);

export type TerminalStatus = 'unassigned' | 'assigned' | 'active' | 'disabled';
export const terminalStatuses: readonly TerminalStatus[] = [
  'unassigned',
  'assigned',
  'active',
  'disabled',
];

export interface PaymentTerminalRow {
  id: string;
  companyId: string;
  branchId: string;
  deviceId: string;
  provider: string;
  providerTerminalId: string | null;
  capabilities: Readonly<Record<string, unknown>> | null;
  status: TerminalStatus;
  version: bigint;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaymentRow {
  id: string;
  companyId: string;
  branchId: string;
  /** TASK 12.4A.1: a real, required, scoped foreign key to `sales` — see
   * packages/database/src/schema/payments.ts and ADR-0009. The TASK
   * 12.4A provisional `sale_reference` this replaced is gone from this
   * row shape (the underlying column is deprecated, not dropped — see
   * the schema's own comment). */
  saleId: string;
  paymentMethod: PaymentMethod;
  amount: string;
  currencyCode: string;
  provider: string | null;
  terminalId: string | null;
  status: PaymentStatus;
  reasonCode: string | null;
  metadata: Readonly<Record<string, unknown>> | null;
  createdBy: string;
  authorizedAt: Date | null;
  capturedAt: Date | null;
  failedAt: Date | null;
  reversedAt: Date | null;
  version: bigint;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaymentAttemptRow {
  id: string;
  companyId: string;
  paymentId: string;
  attemptNumber: number;
  terminalId: string | null;
  status: PaymentAttemptStatus;
  providerReference: string | null;
  declineReason: string | null;
  metadata: Readonly<Record<string, unknown>> | null;
  requestedAt: Date;
  respondedAt: Date | null;
  version: bigint;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTerminalInput {
  id?: string;
  branchId: string;
  deviceId: string;
  provider?: string;
  providerTerminalId?: string;
  capabilities?: Readonly<Record<string, unknown>>;
}

export interface CreatePaymentInput {
  id?: string;
  branchId: string;
  /** TASK 12.4A.1: the real, required owning `sales.id` — must exist,
   * belong to the same company, match `branchId`, and be `pending_payment`
   * (see `PaymentService.createPayment` and ADR-0009). */
  saleId: string;
  paymentMethod: PaymentMethod;
  amount: string;
  currencyCode: string;
  terminalId?: string;
  metadata?: Readonly<Record<string, unknown>>;
}

/** TASK 12.5A: the cash-specific creation shape — see ADR-0011. Unlike
 * `CreatePaymentInput`, the caller never supplies `amount`: the cashier
 * only ever supplies what was physically handed over
 * (`tenderedAmount`); the server alone computes the sale's outstanding
 * balance and the payment amount actually applied to it (never the
 * tendered amount itself — see `PaymentService.createCashPayment`). */
export interface CreateCashPaymentInput {
  id?: string;
  saleId: string;
  tenderedAmount: string;
  // TASK 12.7 Part E/N: which open cash session receives this payment's
  // drawer impact. Optional — when omitted, the backend resolves the
  // sale's branch's single currently-open session (unambiguous in the
  // common one-register-per-branch case); if the branch has zero or more
  // than one open session, this must be supplied explicitly rather than
  // guessed. See ADR-0014.
  cashRegisterId?: string;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface AttemptTransitionInput {
  status: PaymentAttemptStatus;
  providerReference?: string;
  declineReason?: string;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface PaymentMutationContext {
  companyId: string;
  actorId: string;
  requestId: string;
  correlationId: string;
  timestamp: Date;
  /** TASK 12.4B.1: `'system'` for a Mercado Pago webhook-driven
   * transition — no human actor performed it. Defaults to `'user'`
   * (unchanged behavior) when omitted. */
  actorType?: 'user' | 'system';
}

export type PaymentErrorCode =
  | 'validation_error'
  | 'idempotency_conflict'
  | 'resource_not_found'
  | 'version_conflict'
  | 'invalid_payment_state'
  | 'invalid_attempt_state'
  | 'terminal_not_active'
  | 'terminal_branch_mismatch'
  | 'terminal_required'
  | 'duplicate_provider_reference'
  | 'currency_mismatch'
  // TASK 12.4A.1: sale ownership — see ADR-0009.
  | 'invalid_sale_state'
  | 'sale_branch_mismatch'
  // TASK 12.5A: cash payment + real sale completion — see ADR-0011.
  | 'insufficient_tendered';

export class PaymentError extends Error {
  constructor(
    readonly code: PaymentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PaymentError';
  }
}
