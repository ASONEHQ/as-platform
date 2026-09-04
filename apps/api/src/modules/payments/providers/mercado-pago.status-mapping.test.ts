import { describe, expect, it } from 'vitest';

import type { ProviderOrderSnapshot } from './payment-provider.js';
import { mapMercadoPagoOrderToAttemptStatus } from './mercado-pago.status-mapping.js';

function order(overrides: Partial<ProviderOrderSnapshot> = {}): ProviderOrderSnapshot {
  return {
    providerOrderId: 'ORD00001',
    orderStatus: 'created',
    orderStatusDetail: 'created',
    transactionId: null,
    transactionStatus: null,
    transactionStatusDetail: null,
    paidAmount: null,
    currencyCode: null,
    raw: {},
    ...overrides,
  };
}

describe('mapMercadoPagoOrderToAttemptStatus', () => {
  it('approves only when the transaction is processed+accredited and the paid amount matches exactly', () => {
    const result = mapMercadoPagoOrderToAttemptStatus(
      order({
        orderStatus: 'processed',
        orderStatusDetail: 'processed',
        transactionStatus: 'processed',
        transactionStatusDetail: 'accredited',
        paidAmount: '149.5000',
      }),
      '149.50',
    );
    expect(result).toEqual({ attemptStatus: 'approved', declineReason: null, accredited: true });
  });

  it('never approves on order-level processed alone — the task explicitly forbids that', () => {
    // Order says "processed" but the transaction itself has not (yet)
    // reported accredited — e.g. a `partially_refunded` detail.
    const result = mapMercadoPagoOrderToAttemptStatus(
      order({
        orderStatus: 'processed',
        orderStatusDetail: 'partially_refunded',
        transactionStatus: 'processed',
        transactionStatusDetail: 'partially_refunded',
        paidAmount: '100.0000',
      }),
      '149.50',
    );
    expect(result.accredited).toBe(false);
    expect(result.attemptStatus).not.toBe('approved');
  });

  it('rejects approval when the accredited amount does not exactly match the expected amount', () => {
    const result = mapMercadoPagoOrderToAttemptStatus(
      order({
        transactionStatus: 'processed',
        transactionStatusDetail: 'accredited',
        paidAmount: '99.0000',
      }),
      '149.50',
    );
    expect(result.accredited).toBe(false);
    expect(result.attemptStatus).not.toBe('approved');
  });

  it('tolerates differing decimal formatting when comparing amounts', () => {
    const result = mapMercadoPagoOrderToAttemptStatus(
      order({ transactionStatus: 'processed', transactionStatusDetail: 'accredited', paidAmount: '24.00' }),
      '24.0000',
    );
    expect(result.accredited).toBe(true);
    expect(result.attemptStatus).toBe('approved');
  });

  it('maps created to created (no change yet)', () => {
    const result = mapMercadoPagoOrderToAttemptStatus(order({ orderStatus: 'created' }), '10.00');
    expect(result).toEqual({ attemptStatus: 'created', declineReason: null, accredited: false });
  });

  it('maps at_terminal to processing', () => {
    const result = mapMercadoPagoOrderToAttemptStatus(
      order({ orderStatus: 'at_terminal', orderStatusDetail: 'at_terminal' }),
      '10.00',
    );
    expect(result.attemptStatus).toBe('processing');
  });

  it('maps action_required (waiting_payment / check_on_terminal) to processing without inventing a new state', () => {
    const waiting = mapMercadoPagoOrderToAttemptStatus(
      order({
        orderStatus: 'action_required',
        transactionStatus: 'action_required',
        transactionStatusDetail: 'waiting_payment',
      }),
      '10.00',
    );
    expect(waiting.attemptStatus).toBe('processing');
    const checkOnTerminal = mapMercadoPagoOrderToAttemptStatus(
      order({
        orderStatus: 'action_required',
        transactionStatus: 'action_required',
        transactionStatusDetail: 'check_on_terminal',
      }),
      '10.00',
    );
    expect(checkOnTerminal.attemptStatus).toBe('processing');
  });

  it('maps failed to declined, passing the provider status_detail through verbatim as the decline reason', () => {
    const result = mapMercadoPagoOrderToAttemptStatus(
      order({
        orderStatus: 'failed',
        transactionStatus: 'failed',
        transactionStatusDetail: 'cc_rejected_insufficient_amount',
      }),
      '10.00',
    );
    expect(result).toMatchObject({
      attemptStatus: 'declined',
      declineReason: 'cc_rejected_insufficient_amount',
      accredited: false,
    });
  });

  it('maps canceled to cancelled', () => {
    const result = mapMercadoPagoOrderToAttemptStatus(
      order({ orderStatus: 'canceled', transactionStatus: 'canceled' }),
      '10.00',
    );
    expect(result.attemptStatus).toBe('cancelled');
  });

  it('maps expired to timed_out', () => {
    const result = mapMercadoPagoOrderToAttemptStatus(
      order({ orderStatus: 'expired', transactionStatus: 'expired' }),
      '10.00',
    );
    expect(result.attemptStatus).toBe('timed_out');
  });

  it('never silently approves an unrecognized status — it declines with the raw value preserved', () => {
    const result = mapMercadoPagoOrderToAttemptStatus(
      order({ orderStatus: 'a_future_status_this_integration_does_not_know_about' }),
      '10.00',
    );
    expect(result.attemptStatus).toBe('declined');
    expect(result.declineReason).toContain('a_future_status_this_integration_does_not_know_about');
    expect(result.accredited).toBe(false);
  });

  it('falls back to order-level status/detail only when no transaction has reported yet', () => {
    const result = mapMercadoPagoOrderToAttemptStatus(
      order({ orderStatus: 'at_terminal', orderStatusDetail: 'at_terminal', transactionStatus: null }),
      '10.00',
    );
    expect(result.attemptStatus).toBe('processing');
  });
});
