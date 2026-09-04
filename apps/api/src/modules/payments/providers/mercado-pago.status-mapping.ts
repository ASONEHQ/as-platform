import type { ProviderOrderSnapshot } from './payment-provider.js';
import type { PaymentAttemptStatus } from '../payments.types.js';

/**
 * Reconciles a Mercado Pago order+transaction snapshot into one of AS's
 * already-canonical `PaymentAttemptStatus` values (ADR-0008) — never a
 * project-invented state, matching the task's own instruction. See
 * ADR-0010 "Mercado Pago → AS state mapping" for the full table this
 * function implements and the reasoning for each row.
 *
 * The single most important rule: this function returns `'approved'`
 * **only** when the order's own transaction reports
 * `status: 'processed'` **and** `status_detail: 'accredited'` **and**
 * the transaction's `paid_amount` exactly equals the amount AS actually
 * asked for. An order-level `status: 'processed'` alone is not enough —
 * that only means Mercado Pago finished processing the order, not that
 * money was actually credited (a `processed`/`partially_refunded` order,
 * for instance, is not a fresh approval). This is deliberate: the task
 * explicitly forbids treating every `processed` order as approved.
 */
export interface AttemptStatusMapping {
  readonly attemptStatus: PaymentAttemptStatus;
  /** Set only when `attemptStatus` is a decline-shaped terminal state
   * (`declined`/`failed`) — the provider's own `status_detail`, passed
   * through verbatim, never reworded or guessed. */
  readonly declineReason: string | null;
  /** `true` only under the exact accredited-and-amount-matches condition
   * above — the single authoritative "did AS actually get paid" signal
   * the rest of this integration relies on. */
  readonly accredited: boolean;
}

function normalizedMoney(value: string): string {
  const [whole = '0', fraction = ''] = value.split('.');
  return `${whole.replace(/^0+(?=\d)/u, '')}.${fraction.padEnd(4, '0').slice(0, 4)}`;
}

export function mapMercadoPagoOrderToAttemptStatus(
  order: ProviderOrderSnapshot,
  expectedAmount: string,
): AttemptStatusMapping {
  const transactionStatus = order.transactionStatus;
  const transactionStatusDetail = order.transactionStatusDetail;

  const accredited =
    transactionStatus === 'processed' &&
    transactionStatusDetail === 'accredited' &&
    order.paidAmount !== null &&
    normalizedMoney(order.paidAmount) === normalizedMoney(expectedAmount);
  if (accredited) return { attemptStatus: 'approved', declineReason: null, accredited: true };

  // Fall back to order-level status when no transaction has reported yet
  // (e.g. a very early `created` order with an empty `transactions.payments`).
  const status = transactionStatus ?? order.orderStatus;
  const statusDetail = transactionStatusDetail ?? order.orderStatusDetail;

  switch (status) {
    case 'created':
      // Order accepted by Mercado Pago but not yet pushed to/picked up by
      // the terminal — AS's own attempt is already `created` at this
      // point (inserted before the provider call), so nothing changes.
      return { attemptStatus: 'created', declineReason: null, accredited: false };
    case 'at_terminal':
      // Captured by the terminal, ready to be processed — the customer
      // is (or is about to be) interacting with the terminal.
      return { attemptStatus: 'processing', declineReason: null, accredited: false };
    case 'action_required':
      // `waiting_payment` / `check_on_terminal` — the customer must act
      // on the terminal. AS's canonical machine has no distinct
      // `action_required` state (reusing the already-approved 8 states
      // rather than adding one); the raw provider detail is preserved in
      // the attempt's own `metadata`, not lost, just not promoted to a
      // new state name.
      return { attemptStatus: 'processing', declineReason: null, accredited: false };
    case 'failed':
      // Mercado Pago documents 11+ specific failure subtypes
      // (insufficient funds, issuer rejection, high risk, bad card
      // data, ...) — passed through verbatim as the decline reason,
      // never replaced with an AS-invented message.
      return { attemptStatus: 'declined', declineReason: statusDetail ?? 'failed', accredited: false };
    case 'canceled':
      return { attemptStatus: 'cancelled', declineReason: null, accredited: false };
    case 'expired':
      return { attemptStatus: 'timed_out', declineReason: null, accredited: false };
    case 'refunded':
      // A full refund after an already-approved capture is a
      // post-settlement event, not a fresh attempt outcome — this
      // function is only ever consulted while resolving a pending
      // attempt, so this row exists for completeness/documentation, not
      // because the create-order/webhook flow is expected to reach it.
      return { attemptStatus: 'declined', declineReason: 'refunded', accredited: false };
    default:
      // An unrecognized status is treated as a decline, never a silent
      // approval — the raw value is preserved as the decline reason for
      // investigation.
      return { attemptStatus: 'declined', declineReason: `unrecognized_status:${status}`, accredited: false };
  }
}
