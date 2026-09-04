import { randomUUID } from 'node:crypto';

import type { MercadoPagoClient } from './mercado-pago.client.js';
import type {
  MercadoPagoOrderDb,
  MercadoPagoTerminalsListResponse,
} from './mercado-pago.types.js';
import {
  PaymentProviderError,
  type CreateProviderOrderInput,
  type PaymentProvider,
  type ProviderOrderSnapshot,
  type ProviderRefundSnapshot,
  type ProviderTerminalSnapshot,
  type RefundProviderOrderInput,
} from './payment-provider.js';

function normalizeOrder(order: MercadoPagoOrderDb): ProviderOrderSnapshot {
  const payment = order.transactions?.payments?.[0];
  return {
    providerOrderId: order.id,
    orderStatus: order.status,
    orderStatusDetail: order.status_detail ?? null,
    transactionId: payment?.id ?? null,
    transactionStatus: payment?.status ?? null,
    transactionStatusDetail: payment?.status_detail ?? null,
    paidAmount: payment?.paid_amount ?? null,
    // The Orders API response never included an explicit currency field
    // in any documentation reconciled for this task (a Mercado Pago
    // account's currency is fixed by its own country) — left `null`
    // rather than guessed; the caller cross-checks against AS's own
    // `payments.currency_code`, never this.
    currencyCode: null,
    raw: order as unknown as Readonly<Record<string, unknown>>,
  };
}

/**
 * `PaymentProvider` implementation for Mercado Pago Point, built against
 * the Orders API (`type: "point"`) — the current integration path per
 * Mercado Pago's own 2025-07 "Point + Orders API" migration, not the
 * deprecated Point Payment Intents API (see ADR-0010, "Official Mercado
 * Pago Point contracts discovered").
 *
 * Every network call goes through `MercadoPagoClient`, the single place
 * the Access Token is read and attached — this class never sees or logs
 * the token itself. `createOrder`/`cancelOrder`/`refund` each mint their
 * own fresh `X-Idempotency-Key` (a UUID v4, per Mercado Pago's own
 * documented convention) — never the caller's AS-side `Idempotency-Key`,
 * which is a different idempotency domain protecting the AS API call
 * itself, not the outbound Mercado Pago call.
 */
export class MercadoPagoPointProvider implements PaymentProvider {
  public readonly name = 'mercado_pago' as const;

  public constructor(private readonly client: MercadoPagoClient) {}

  public async createOrder(input: CreateProviderOrderInput): Promise<ProviderOrderSnapshot> {
    // Mercado Pago Point in Mexico settles in MXN only — no currency
    // field exists on the create-order body in current documentation,
    // so a non-MXN sale/payment must be rejected here rather than
    // silently sent and settled in whatever currency the MP account
    // defaults to.
    if (input.currencyCode !== 'MXN')
      throw new PaymentProviderError(
        'provider_rejected',
        'Mercado Pago Point (Mexico) only supports MXN.',
      );
    const order = await this.client.request<MercadoPagoOrderDb>({
      method: 'POST',
      path: '/v1/orders',
      idempotencyKey: randomUUID(),
      body: {
        type: 'point',
        external_reference: input.externalReference,
        transactions: { payments: [{ amount: input.amount }] },
        config: { point: { terminal_id: input.terminalProviderId } },
        ...(input.description === undefined ? {} : { description: input.description }),
      },
    });
    return normalizeOrder(order);
  }

  public async getOrder(providerOrderId: string): Promise<ProviderOrderSnapshot> {
    const order = await this.client.request<MercadoPagoOrderDb>({
      method: 'GET',
      path: `/v1/orders/${encodeURIComponent(providerOrderId)}`,
    });
    return normalizeOrder(order);
  }

  public async cancelOrder(providerOrderId: string): Promise<ProviderOrderSnapshot> {
    const order = await this.client.request<MercadoPagoOrderDb>({
      method: 'POST',
      path: `/v1/orders/${encodeURIComponent(providerOrderId)}/cancel`,
      idempotencyKey: randomUUID(),
    });
    return normalizeOrder(order);
  }

  /** Deliberately not wired into `PaymentService.reversePayment` yet in
   * this pass — see ADR-0010 "Refund readiness." Implemented and tested
   * at the adapter/contract level only, per the task's own "implement
   * only the provider adapter/API layer... do NOT build a fake refund UI
   * yet." */
  public async refund(
    providerOrderId: string,
    input: RefundProviderOrderInput,
  ): Promise<ProviderRefundSnapshot> {
    const isPartial = input.transactionId !== undefined;
    const order = await this.client.request<MercadoPagoOrderDb>({
      method: 'POST',
      path: `/v1/orders/${encodeURIComponent(providerOrderId)}/refund`,
      idempotencyKey: randomUUID(),
      ...(isPartial
        ? { body: { transactions: [{ id: input.transactionId, amount: input.amount }] } }
        : {}),
    });
    const refund = order.transactions?.refunds?.at(-1);
    if (refund === undefined)
      throw new PaymentProviderError(
        'invalid_response',
        'Mercado Pago refund response had no refund record.',
      );
    return { refundId: refund.id, status: refund.status, amount: refund.amount };
  }

  public async listTerminals(input: {
    readonly storeId?: string;
    readonly posId?: string;
  }): Promise<readonly ProviderTerminalSnapshot[]> {
    const response = await this.client.request<MercadoPagoTerminalsListResponse>({
      method: 'GET',
      path: '/terminals/v1/list',
      query: { store_id: input.storeId, pos_id: input.posId },
    });
    return response.data.terminals.map((terminal) => ({
      providerTerminalId: terminal.id,
      posId: terminal.pos_id === undefined ? null : String(terminal.pos_id),
      storeId: terminal.store_id ?? null,
      operatingMode: terminal.operating_mode,
    }));
  }
}

export interface SimulateOrderStatusInput {
  readonly status: 'processed' | 'canceled' | 'expired' | 'action_required';
  readonly paymentMethodType?: string;
  readonly paymentMethodId?: string;
  readonly installments?: number;
  readonly statusDetail?: string;
}

/**
 * Encapsulates Mercado Pago's "Simulate order status" endpoint
 * (`POST /v1/orders/{id}/events`) — lets the full create-order → webhook
 * → settle flow be exercised end-to-end against real test credentials
 * with no physical Point terminal. Deliberately a *separate* class, not
 * part of `PaymentProvider`/`MercadoPagoPointProvider`: this is not a
 * production capability, so it is never constructed by
 * `register-plugins.ts`'s production wiring, and the constructor itself
 * refuses to run if `nodeEnv === 'production'` as a second, independent
 * guard against ever being reachable there by mistake.
 */
export class MercadoPagoPointTestHelper {
  public constructor(
    private readonly client: MercadoPagoClient,
    private readonly nodeEnv: string,
  ) {
    if (this.nodeEnv === 'production')
      throw new PaymentProviderError(
        'provider_rejected',
        'MercadoPagoPointTestHelper must never be constructed in production.',
      );
  }

  public async simulateOrderStatus(
    providerOrderId: string,
    input: SimulateOrderStatusInput,
  ): Promise<void> {
    if (this.nodeEnv === 'production')
      throw new PaymentProviderError(
        'provider_rejected',
        'The Mercado Pago Point status simulator must never run in production.',
      );
    await this.client.request<unknown>({
      method: 'POST',
      path: `/v1/orders/${encodeURIComponent(providerOrderId)}/events`,
      body: {
        status: input.status,
        ...(input.paymentMethodType === undefined ? {} : { payment_method_type: input.paymentMethodType }),
        ...(input.paymentMethodId === undefined ? {} : { payment_method_id: input.paymentMethodId }),
        ...(input.installments === undefined ? {} : { installments: input.installments }),
        ...(input.statusDetail === undefined ? {} : { status_detail: input.statusDetail }),
      },
    });
  }
}
