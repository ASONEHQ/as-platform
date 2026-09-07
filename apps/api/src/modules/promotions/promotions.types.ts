/** TASK 12.9 — see `packages/database/src/schema/promotions.ts` and
 * ADR-0016 for the full domain reconciliation. This is a genuinely new
 * module (CORE_DATA_MODEL.md/API_CONTRACTS.md both explicitly exclude
 * "advanced promotions"), so nothing here is reconciled against a
 * pre-existing contract the way `refunds.types.ts` was — it IS the
 * contract. */

export type PromotionBenefitType = 'percentage' | 'fixed_amount' | 'fixed_price' | 'quantity_nxm';
export const promotionBenefitTypes: readonly PromotionBenefitType[] = [
  'percentage',
  'fixed_amount',
  'fixed_price',
  'quantity_nxm',
];

export type CouponBenefitType = 'percentage' | 'fixed_amount';
export const couponBenefitTypes: readonly CouponBenefitType[] = ['percentage', 'fixed_amount'];

// TASK 13.2 (ADR-0019) — `'reward'` added, a reward-entitlement-backed
// benefit computed by the SAME pricing engine as promotion/coupon/manual,
// never a parallel arithmetic path.
export type DiscountSourceType = 'promotion' | 'coupon' | 'manual' | 'reward';
export type RewardBenefitType = 'percentage_discount' | 'fixed_amount_discount' | 'fixed_price' | 'free_eligible_item';

export interface PromotionRow {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  active: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  daysOfWeek: readonly number[] | null;
  timeFrom: string | null;
  timeTo: string | null;
  priority: number;
  stackable: boolean;
  benefitType: PromotionBenefitType;
  benefitPercentageBasisPoints: number | null;
  benefitFixedAmount: string | null;
  benefitNxmBuyQuantity: number | null;
  benefitNxmPayQuantity: number | null;
  minQuantity: string | null;
  minSubtotal: string | null;
  usageLimitTotal: number | null;
  combinableWithCoupons: boolean;
  branchIds: readonly string[];
  productIds: readonly string[];
  categoryIds: readonly string[];
  createdBy: string;
  updatedBy: string;
  version: bigint;
  createdAt: Date;
  updatedAt: Date;
}

export interface CouponRow {
  id: string;
  companyId: string;
  code: string;
  normalizedCode: string;
  description: string | null;
  benefitType: CouponBenefitType;
  benefitPercentageBasisPoints: number | null;
  benefitFixedAmount: string | null;
  active: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  minSubtotal: string | null;
  usageLimitTotal: number | null;
  promotionId: string | null;
  createdBy: string;
  updatedBy: string;
  version: bigint;
  createdAt: Date;
  updatedAt: Date;
}

/** A quote/sale-creation-time cart line — deliberately minimal, mirroring
 * `CreateSaleLineInput`: only what the client can legitimately supply.
 * Every commercial fact (price, tax code, category) is resolved
 * server-side from `product_id` alone, exactly like `sales.service.ts`
 * already does — never trusted from the client. */
export interface PricingLineInput {
  productId: string;
  quantity: string;
}

export interface PricingManualDiscountInput {
  scope: 'line' | 'ticket';
  /** Required when `scope === 'line'` — the (1-based) index into the
   * request's own `items` array, never a `sale_item_id` (none exists yet
   * at quote time, and even at sale-creation time the line hasn't been
   * persisted when this is evaluated). */
  lineIndex?: number;
  type: 'percentage' | 'fixed_amount';
  /** Percentage as basis points (1000 = 10%) or a `numeric(19,4)` string
   * amount, matching `type`. */
  value: string;
  reasonCode: string;
}

/** TASK 13.2 (ADR-0019 "Pricing pipeline placement") — a SINGLE,
 * already-resolved-and-validated reward candidate the caller (`quote()`/
 * `SalesService.createSale`) hands to `evaluatePricing`. Unlike coupons
 * (looked up by arbitrary code via `couponLookup`), at most ONE reward is
 * ever attached to a cart in this task's scope (Part O: "cashier can
 * select one") — the engine itself has NO database access (its own
 * standing design principle), so eligibility/ownership/expiry/scope
 * resolution always happens in the caller BEFORE this candidate is ever
 * built; `evaluatePricing` trusts it exactly as much as it trusts an
 * already-resolved `PromotionCandidate` — no re-validation, no lookup,
 * pure arithmetic over already-known-good scope ids. */
export interface RewardBenefitCandidate {
  rewardEntitlementId: string;
  loyaltyProgramId: string;
  rewardType: string;
  benefitType: RewardBenefitType;
  benefitPercentageBasisPoints: number | null;
  benefitFixedAmount: string | null;
  /** Empty means "not restricted by specific product" (still possibly
   * restricted by category) — mirrors `PromotionScope` exactly. A reward
   * candidate's scope is never both-empty in practice (Part B requires at
   * least one dimension whenever a benefit is configured, enforced by
   * `LoyaltyService`), but the engine itself does not assume that — an
   * accidentally-both-empty scope simply matches nothing, never
   * everything (the deliberate INVERSE of how promotion scope treats
   * both-empty, since a reward must never silently discount an unrelated
   * product family). */
  scope: { productIds: readonly string[]; categoryIds: readonly string[] };
}

export interface PricingRequest {
  companyId: string;
  branchId: string;
  /** The actor's own already-known permissions — a manual discount
   * request is rejected outright (never silently dropped) when the
   * actor lacks `discount.apply`, exactly mirroring `refunds.service.ts`'s
   * `refund.approve` self-approval check. */
  actorPermissions: readonly string[];
  items: readonly PricingLineInput[];
  couponCodes: readonly string[];
  manualDiscount?: PricingManualDiscountInput;
  /** Evaluation instant — always `context.timestamp` in real use; a
   * distinct field (never `new Date()` inside the engine itself) purely
   * so tests can pin exact schedule/day-of-week/time-window behavior
   * deterministically. */
  now: Date;
}

/** One resolved, priced line — the pricing engine's own internal
 * representation, never exposed as-is over HTTP (see `PricingQuoteLine`
 * in `promotions.routes.ts` for the safe wire shape). */
export interface PricingResolvedLine {
  lineIndex: number;
  productId: string;
  productVariantId: string | null;
  productVersion: bigint;
  categoryId: string | null;
  skuSnapshot: string | null;
  nameSnapshot: string;
  quantity: string;
  quantityUnits: bigint;
  unitPriceUnits: bigint;
  taxCode: string;
  taxBasisPoints: number;
  grossSubtotalUnits: bigint;
  discountUnits: bigint;
  discountBasisPoints: number;
  netSubtotalUnits: bigint;
  taxUnits: bigint;
  lineTotalUnits: bigint;
}

export interface PricingAppliedDiscount {
  sourceType: DiscountSourceType;
  sourceId: string | null;
  label: string;
  reasonCode: string | null;
  /** `null` for a scope spanning multiple lines with different rates
   * (a fixed-amount ticket-wide discount allocated pro-rata never has
   * one single rate) — `sale_discounts.basis_points` mirrors this
   * exactly (nullable). */
  basisPoints: number | null;
  amountUnits: bigint;
  /** `null` means ticket-wide (every eligible line contributed). */
  lineIndex: number | null;
}

export interface PricingResult {
  currencyCode: string;
  lines: readonly PricingResolvedLine[];
  appliedDiscounts: readonly PricingAppliedDiscount[];
  subtotalUnits: bigint;
  discountTotalUnits: bigint;
  taxTotalUnits: bigint;
  totalUnits: bigint;
  /** Populated only when a requested coupon code could not be applied —
   * an honest reason, never silently dropped (Part I). Coupons that
   * WERE applied are represented in `appliedDiscounts` instead. */
  rejectedCoupons: readonly { code: string; reason: string }[];
}

export type PromotionErrorCode =
  | 'validation_error'
  | 'resource_not_found'
  | 'resource_conflict'
  | 'version_conflict'
  | 'coupon_not_found'
  | 'coupon_inactive'
  | 'coupon_not_started'
  | 'coupon_expired'
  | 'coupon_branch_not_eligible'
  | 'coupon_usage_exhausted'
  | 'coupon_cart_not_eligible'
  | 'discount_not_authorized'
  | 'discount_invalid';

export class PromotionError extends Error {
  constructor(
    readonly code: PromotionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PromotionError';
  }
}

export interface PromotionMutationContext {
  companyId: string;
  actorId: string;
  actorPermissions: readonly string[];
  requestId: string;
  correlationId: string;
  timestamp: Date;
}
