/**
 * TASK 12.4B.1: the provider-neutral adapter interface ADR-0008 only
 * described conceptually ("a future createIntent/sendToTerminal/
 * getStatus/cancel/refund-shaped interface") — no concrete interface
 * existed until this task needed a real one. Names below follow Mercado
 * Pago's own current Orders API vocabulary (`createOrder`/`getOrder`/
 * `cancelOrder`/`refund`/`listTerminals`) rather than the task's more
 * generic suggestion, since that vocabulary is what a second provider
 * would also need to speak in some form, and inventing a different generic
 * name for the same concept would add translation for no benefit — see
 * ADR-0010.
 *
 * Every shape here is safe-data-only: amounts are ADR-0001 decimal
 * strings, `raw` is the provider's decoded JSON response for audit/
 * troubleshooting, and NOTHING here ever carries a card PAN, CVV, or
 * track-data field — Mercado Pago's own Orders API response never
 * includes them (only `card.first_digits`/`card.last_digits`), and this
 * interface does not add a field that could ever receive one.
 */

export type PaymentProviderName = 'mercado_pago';

export interface CreateProviderOrderInput {
  /** Correlates the provider order back to one AS `payment_attempts` row
   * — sent as the provider's own `external_reference`. Never a sale or
   * payment id directly (an attempt is the unit of retry). */
  readonly externalReference: string;
  /** ADR-0001 decimal string — always the backend-authoritative
   * `payments.amount`, never a client-supplied value. */
  readonly amount: string;
  readonly currencyCode: string;
  /** The provider's own terminal identifier (`payment_terminals.provider_terminal_id`),
   * never an AS-internal id. */
  readonly terminalProviderId: string;
  readonly description?: string;
}

/** A normalized snapshot of one provider order, decoded from whichever
 * provider call produced it (create/get/simulate all return this same
 * shape). `orderStatus`/`transactionStatus` are the provider's own raw
 * status strings — deliberately not narrowed to AS's canonical
 * `PaymentAttemptStatus` here; that mapping is a separate, explicit,
 * testable step (see `mercado-pago.status-mapping.ts`) so "what the
 * provider said" and "what AS decided it means" are never conflated. */
export interface ProviderOrderSnapshot {
  readonly providerOrderId: string;
  readonly orderStatus: string;
  readonly orderStatusDetail: string | null;
  readonly transactionId: string | null;
  readonly transactionStatus: string | null;
  readonly transactionStatusDetail: string | null;
  /** The provider's own reported `paid_amount` — used to cross-check the
   * accredited amount actually matches what AS asked for before ever
   * treating a payment as approved. `null` when the provider has not
   * reported one yet (e.g. still `created`/`at_terminal`). */
  readonly paidAmount: string | null;
  readonly currencyCode: string | null;
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface RefundProviderOrderInput {
  /** Omit for a full refund. Present (with `amount`) for a partial one. */
  readonly transactionId?: string;
  readonly amount?: string;
}

export interface ProviderRefundSnapshot {
  readonly refundId: string;
  readonly status: string;
  readonly amount: string | null;
}

export interface ProviderTerminalSnapshot {
  readonly providerTerminalId: string;
  readonly posId: string | null;
  readonly storeId: string | null;
  /** Mercado Pago's own `PDV | STANDALONE | UNDEFINED` — only `PDV`
   * terminals can receive API-driven orders. */
  readonly operatingMode: string;
}

export interface PaymentProvider {
  readonly name: PaymentProviderName;
  createOrder(input: CreateProviderOrderInput): Promise<ProviderOrderSnapshot>;
  getOrder(providerOrderId: string): Promise<ProviderOrderSnapshot>;
  cancelOrder(providerOrderId: string): Promise<ProviderOrderSnapshot>;
  refund(providerOrderId: string, input: RefundProviderOrderInput): Promise<ProviderRefundSnapshot>;
  listTerminals(input: {
    readonly storeId?: string;
    readonly posId?: string;
  }): Promise<readonly ProviderTerminalSnapshot[]>;
}

export type PaymentProviderErrorCode =
  | 'not_configured'
  | 'network_error'
  | 'timeout'
  | 'invalid_response'
  | 'provider_rejected'
  | 'rate_limited';

/** Never carries the raw provider response body in its own `message` —
 * callers that need the decoded body for logging/audit use `.details`
 * (already sanitized: never the Access Token, never PAN/CVV, since the
 * provider's own response never contains them either). */
export class PaymentProviderError extends Error {
  constructor(
    readonly code: PaymentProviderErrorCode,
    message: string,
    readonly statusCode?: number,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}
