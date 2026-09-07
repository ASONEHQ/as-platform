/** §21.2's exact 5-state machine — never a project-invented name. This
 * pass reaches `pending_payment`, `completed`, and `cancelled` only;
 * `draft` and `rejected` stay structurally valid but unexercised (see
 * ADR-0009 — creation lands directly in `pending_payment`, and a
 * validation failure throws cleanly with no row created rather than
 * persisting a `rejected` sale). */
export type SaleStatus = 'draft' | 'pending_payment' | 'completed' | 'cancelled' | 'rejected';
export const saleStatuses: readonly SaleStatus[] = [
  'draft',
  'pending_payment',
  'completed',
  'cancelled',
  'rejected',
];

export interface SaleRow {
  id: string;
  companyId: string;
  branchId: string;
  cashRegisterId: string | null;
  cashSessionId: string | null;
  deviceId: string | null;
  syncOperationId: string | null;
  // TASK 13.0 — optional customer link (Part G) and its immutable
  // display-name snapshot AT SALE-CREATION TIME (Part AB) — never
  // re-read from today's (possibly since-edited) customer record.
  customerId: string | null;
  customerDisplayName: string | null;
  saleNumber: string;
  status: SaleStatus;
  currencyCode: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  paidTotal: string;
  changeTotal: string;
  occurredAt: Date;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  reasonCode: string | null;
  createdBy: string;
  version: bigint;
  createdAt: Date;
  updatedAt: Date;
}

export interface SaleItemRow {
  id: string;
  companyId: string;
  branchId: string;
  saleId: string;
  lineNumber: number;
  productId: string | null;
  productVariantId: string | null;
  productVersion: bigint | null;
  skuSnapshot: string | null;
  nameSnapshot: string;
  quantity: string;
  unitPrice: string;
  subtotal: string;
  discountTotal: string;
  // TASK 12.9 — additive. See `sale_items.discount_basis_points`'s own
  // doc comment (`packages/database/src/schema/sales.ts`) for why this
  // exists: the exact rate this line's discount was computed at, so
  // `refunds.service.ts` can recompute an exact proportional amount for
  // any partial refund quantity without dividing (and drifting).
  discountBasisPoints: number;
  taxTotal: string;
  lineTotal: string;
  taxSnapshot: Readonly<Record<string, unknown>> | null;
  createdAt: Date;
}

/** What Flutter's `SaleSession`/`SaleLine` can actually supply today
 * (`productId` + `quantity` — no variant, no price, no tax): the backend
 * independently resolves everything else. See ADR-0009 "Server money
 * authority." */
export interface CreateSaleLineInput {
  productId: string;
  quantity: string;
}

/** TASK 12.9 — client submits INTENT only (which coupon code(s), what
 * manual discount is requested); the backend independently re-evaluates
 * every promotion/coupon/discount amount via the exact same
 * `evaluatePricing` engine the standalone quote endpoint uses (Part A/X
 * — never trusts a client-submitted amount, eligibility, or total). */
export interface CreateSaleInput {
  id?: string;
  branchId: string;
  /** Defaults to the first resolved line's own price currency when
   * omitted — every line must still agree (see ADR-0009). */
  currencyCode?: string;
  deviceId?: string;
  /** TASK 13.0 — Part G/H: optional. Walk-in sales keep working with no
   * customer attached; a supplied id must belong to the SAME company
   * (never trusted blindly) — see `SalesService.createSale`. */
  customerId?: string;
  items: readonly CreateSaleLineInput[];
  couponCodes?: readonly string[];
  manualDiscount?: {
    scope: 'line' | 'ticket';
    lineIndex?: number;
    type: 'percentage' | 'fixed_amount';
    value: string;
    reasonCode: string;
  };
  /** TASK 13.2 — requires `customerId` (a reward is always customer-
   * scoped; there is no such thing as a walk-in-sale reward). Re-
   * validated fresh here, never trusted from a prior quote — see
   * `SalesService.createSale`/ADR-0019 "Quote vs Sale creation". */
  rewardEntitlementId?: string;
}

export interface SaleMutationContext {
  companyId: string;
  actorId: string;
  /** TASK 12.9 — needed only for the optional `manualDiscount` field's
   * `discount.apply` check (`PromotionsService`'s own pricing engine
   * call, invoked from inside `createSale`); every other Sale mutation
   * remains unaffected by this addition. */
  actorPermissions?: readonly string[];
  requestId: string;
  correlationId: string;
  timestamp: Date;
}

export type SaleErrorCode =
  | 'validation_error'
  | 'idempotency_conflict'
  | 'resource_not_found'
  | 'version_conflict'
  | 'invalid_sale_state'
  | 'product_not_found'
  | 'product_not_active'
  | 'price_not_found'
  | 'currency_mismatch';

export class SaleError extends Error {
  constructor(
    readonly code: SaleErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SaleError';
  }
}
