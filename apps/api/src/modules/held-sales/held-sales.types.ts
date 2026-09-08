/** TASK 14.3 (Wave 1, Part B.1) — "suspended/held sales." See
 * `packages/database/src/schema/held-sales.ts`'s own doc comment for why
 * this is a held, unpriced CART SNAPSHOT (never a partial `sales` row):
 * resuming always re-prices fresh through the real catalog at
 * `POST /sales` time. This module only ever hands a held cart's raw
 * `{product_id, quantity}` pairs back to the caller — it never itself
 * calls into `SalesService.createSale` (see `held-sales.service.ts`'s own
 * doc comment on `resumeCart` for the full two-step handshake this
 * implies).
 *
 * TASK 14.3A (Wave 1 hardening) — a real 4-state machine, no sentinel:
 * `held -> resuming -> resumed`, plus `discarded` (from `held` or
 * `resuming`) and an explicit `resuming -> held` release. See the
 * schema file's own top doc comment for the full reasoning. */
export const heldSaleCartStatuses = ['held', 'resuming', 'resumed', 'discarded'] as const;
export type HeldSaleCartStatus = (typeof heldSaleCartStatuses)[number];

export interface HeldSaleCartItem {
  readonly productId: string;
  readonly quantity: string;
}

export interface HeldSaleCartRow {
  id: string;
  companyId: string;
  branchId: string;
  cashRegisterId: string | null;
  customerId: string | null;
  label: string | null;
  items: readonly HeldSaleCartItem[];
  status: HeldSaleCartStatus;
  createdBy: string;
  /** Set once, at `held -> resuming` — a historical trace of the most
   * recent claim attempt, deliberately NOT cleared by a later release
   * back to `held` (see the schema file's own top doc comment). Only
   * `status` decides whether a claim is currently in effect. */
  claimedAt: Date | null;
  claimedBy: string | null;
  resumedAt: Date | null;
  resumedBy: string | null;
  /** `null` in every state except the real, terminal `'resumed'` — a
   * plain, honest 1:1 reflection of the database column. Never a
   * sentinel or placeholder of any kind (TASK 14.3A removed the earlier
   * self-referential-sentinel design — see `held-sales.repository.ts`'s
   * own doc comment for the history). */
  resumedSaleId: string | null;
  discardedAt: Date | null;
  discardedBy: string | null;
  createdAt: Date;
}

export interface HeldSaleCartMutationContext {
  companyId: string;
  actorId: string;
  /** Needed only for `discardCart`'s "creator OR `sale.cancel`" check
   * (mirrors `SaleMutationContext.actorPermissions`'s own reasoning) —
   * every other mutation here is unaffected. */
  actorPermissions?: readonly string[];
  requestId: string;
  correlationId: string;
  timestamp: Date;
}

export type HeldSaleCartErrorCode =
  | 'validation_error'
  | 'idempotency_conflict'
  | 'resource_not_found'
  | 'invalid_cart_state'
  | 'forbidden';

export class HeldSaleCartError extends Error {
  constructor(
    readonly code: HeldSaleCartErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'HeldSaleCartError';
  }
}
