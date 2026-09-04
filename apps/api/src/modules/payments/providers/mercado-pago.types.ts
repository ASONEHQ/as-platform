/**
 * Raw Mercado Pago Orders API / Point Terminals API response shapes, as
 * reconciled against current official documentation (ADR-0010, "Official
 * Mercado Pago Point contracts discovered"). Field-level, not
 * exhaustive — only what this integration actually reads. Never a PAN,
 * CVV, or track-data field: the Orders API response itself never returns
 * one (only `card.first_digits`/`card.last_digits`).
 */

export interface MercadoPagoOrderPaymentDb {
  readonly id: string;
  readonly amount: string;
  readonly paid_amount?: string;
  readonly refunded_amount?: string;
  readonly status: string;
  readonly status_detail?: string;
  readonly reference_id?: string;
  readonly payment_method?: {
    readonly type?: string;
    readonly id?: string;
    readonly installments?: number;
  };
  readonly card?: {
    readonly first_digits?: string;
    readonly last_digits?: string;
  };
}

export interface MercadoPagoOrderRefundDb {
  readonly id: string;
  readonly transaction_id: string;
  readonly reference_id?: string;
  readonly amount: string;
  readonly status: string;
}

export interface MercadoPagoOrderDb {
  readonly id: string;
  readonly type: string;
  readonly external_reference?: string;
  readonly expiration_time?: string;
  readonly processing_mode?: string;
  readonly description?: string;
  readonly country_code?: string;
  readonly status: string;
  readonly status_detail?: string;
  readonly created_date?: string;
  readonly last_updated_date?: string;
  readonly config?: {
    readonly point?: {
      readonly terminal_id?: string;
      readonly print_on_terminal?: string;
    };
  };
  readonly transactions?: {
    readonly payments?: readonly MercadoPagoOrderPaymentDb[];
    readonly refunds?: readonly MercadoPagoOrderRefundDb[];
  };
}

export interface MercadoPagoTerminalDb {
  readonly id: string;
  readonly pos_id?: number;
  readonly store_id?: string;
  readonly external_pos_id?: string;
  /** `PDV | STANDALONE | UNDEFINED` per current documentation. */
  readonly operating_mode: string;
}

export interface MercadoPagoTerminalsListResponse {
  readonly data: { readonly terminals: readonly MercadoPagoTerminalDb[] };
  readonly paging?: { readonly total: number; readonly offset: number; readonly limit: number };
}

/** The webhook notification envelope for the Orders topic — confirmed
 * shape from current official documentation. `data.id` is the order id;
 * `action` (e.g. `order.action_required`) is informational only — this
 * integration never branches logic on it (see ADR-0010: official guidance
 * itself says to re-fetch the order rather than trust notification
 * fields). */
export interface MercadoPagoOrderWebhookBody {
  readonly action?: string;
  readonly api_version?: string;
  readonly application_id?: string;
  readonly date_created?: string;
  readonly id?: string | number;
  readonly live_mode?: boolean;
  readonly type?: string;
  readonly user_id?: number;
  readonly data?: { readonly id?: string };
}
