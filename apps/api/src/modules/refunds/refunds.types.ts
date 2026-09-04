/** §21.4's exact 6 states — never a project-invented name. This
 * implementation's own `POST /refunds` either lands directly in
 * `approved` (self-approve) or throws `refund_approval_required`
 * outright with nothing persisted, so `pending_approval` and `rejected`
 * stay structurally valid but unexercised — see ADR-0015. */
export type RefundStatus =
  | 'requested'
  | 'pending_approval'
  | 'approved'
  | 'completed'
  | 'cancelled'
  | 'rejected';
export const refundStatuses: readonly RefundStatus[] = [
  'requested',
  'pending_approval',
  'approved',
  'completed',
  'cancelled',
  'rejected',
];

/** CORE_DATA_MODEL §12's exact 4 dispositions. Only `restock`/`no_restock`
 * are ever assigned by this pass (server-derived from whether the sale
 * item's variant tracks inventory — no disposition-selection UI exists
 * yet); `damage`/`quarantine` stay structurally valid. */
export type RefundItemDisposition = 'restock' | 'damage' | 'quarantine' | 'no_restock';
export const refundItemDispositions: readonly RefundItemDisposition[] = [
  'restock',
  'damage',
  'quarantine',
  'no_restock',
];

export interface RefundRow {
  id: string;
  companyId: string;
  branchId: string;
  saleId: string;
  cashSessionId: string | null;
  paymentId: string | null;
  refundNumber: string;
  status: RefundStatus;
  refundMethod: 'cash' | 'card_terminal' | 'card_manual' | 'other';
  reasonCode: string;
  reasonNote: string | null;
  currencyCode: string;
  subtotal: string;
  taxTotal: string;
  total: string;
  occurredAt: Date;
  completedAt: Date | null;
  createdBy: string;
  approvedBy: string | null;
  deviceId: string | null;
  version: bigint;
  createdAt: Date;
  updatedAt: Date;
}

export interface RefundItemRow {
  id: string;
  companyId: string;
  branchId: string;
  refundId: string;
  saleItemId: string;
  quantity: string;
  subtotal: string;
  taxTotal: string;
  lineTotal: string;
  restockDisposition: RefundItemDisposition;
  createdAt: Date;
}

/** One candidate line in a refund request — the client names *which* sale
 * item and *how much* of it; the backend independently recomputes every
 * money figure from that sale item's own frozen commercial snapshot
 * (Part C) — never accepts a client-submitted amount. */
export interface CreateRefundItemInput {
  saleItemId: string;
  quantity: string;
}

export interface CreateRefundInput {
  id?: string;
  saleId: string;
  reasonCode: string;
  reasonNote?: string;
  items: readonly CreateRefundItemInput[];
}

export interface RefundMutationContext {
  companyId: string;
  actorId: string;
  actorPermissions: readonly string[];
  requestId: string;
  correlationId: string;
  timestamp: Date;
  deviceId?: string | undefined;
}

/** One sale item's remaining refundable quantity/value — E081's own
 * per-line shape. `blockedReason` is set (and `refundableQuantity` is
 * `'0.000000'`) when the line cannot be refunded at all for a reason
 * other than "already fully refunded" (e.g. the sale itself isn't
 * refundable) — surfaced once at the sale level via `blockedReason` on
 * [RefundableBalance] instead of repeating it per line. */
export interface RefundableLineBalance {
  saleItemId: string;
  nameSnapshot: string;
  soldQuantity: string;
  refundedQuantity: string;
  refundableQuantity: string;
  unitPrice: string;
}

export interface RefundableBalance {
  saleId: string;
  refundable: boolean;
  blockedReason: string | null;
  lines: readonly RefundableLineBalance[];
}

export type RefundErrorCode =
  | 'validation_error'
  | 'idempotency_conflict'
  | 'resource_not_found'
  | 'resource_conflict'
  | 'version_conflict'
  | 'sale_not_mutable'
  | 'sale_not_refundable'
  | 'refund_limit_exceeded'
  | 'refund_approval_required'
  | 'payment_not_reversible'
  | 'insufficient_inventory'
  | 'inventory_location_not_found';

export class RefundError extends Error {
  constructor(
    readonly code: RefundErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RefundError';
  }
}
