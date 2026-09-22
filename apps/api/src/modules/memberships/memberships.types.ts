/** TASK 13.0 — see `packages/database/src/schema/customers.ts`
 * (`membership_plans`/`customer_memberships`) and ADR-0017. Genuinely new
 * module. `membership_plan` = the PRODUCT/RULE definition;
 * `customer_membership` = the ISSUED entitlement — Part J's own
 * distinction, never blurred into one table. */

export type MembershipStatus = 'pending' | 'active' | 'expired' | 'cancelled';
export const membershipStatuses: readonly MembershipStatus[] = ['pending', 'active', 'expired', 'cancelled'];

// TASK 16.21 (ADR-0020) — mirrors `RewardBenefitType`, deliberately
// without `free_eligible_item` (a standing membership discount, not a
// one-shot reward redemption) — see `membership_plans`' own schema doc
// comment.
export type MembershipBenefitType = 'percentage_discount' | 'fixed_amount_discount' | 'fixed_price';
export const membershipBenefitTypes: readonly MembershipBenefitType[] = [
  'percentage_discount',
  'fixed_amount_discount',
  'fixed_price',
];

export interface MembershipPlanRow {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  active: boolean;
  productId: string | null;
  durationDays: number | null;
  benefitDescription: string | null;
  benefitType: MembershipBenefitType | null;
  benefitPercentageBasisPoints: number | null;
  benefitFixedAmount: string | null;
  /** Empty means "not restricted by specific product" — mirrors
   * `PromotionRow.productIds`' own "both-empty means everything"
   * convention (see `membership_plan_benefit_products`' schema doc). */
  benefitProductIds: readonly string[];
  benefitCategoryIds: readonly string[];
  branchIds: readonly string[];
  createdBy: string;
  updatedBy: string;
  version: bigint;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateMembershipPlanInput {
  id?: string;
  name: string;
  description?: string;
  active?: boolean;
  productId?: string;
  durationDays?: number;
  benefitDescription?: string;
  benefitType?: MembershipBenefitType;
  benefitPercentageBasisPoints?: number;
  benefitFixedAmount?: string;
  benefitProductIds?: readonly string[];
  benefitCategoryIds?: readonly string[];
  branchIds?: readonly string[];
}

export interface CustomerMembershipRow {
  id: string;
  companyId: string;
  customerId: string;
  membershipPlanId: string;
  membershipNumber: string;
  status: MembershipStatus;
  startsAt: Date;
  expiresAt: Date | null;
  issuedAt: Date;
  sourceSaleId: string | null;
  renewedFromMembershipId: string | null;
  cancelledAt: Date | null;
  cancelledReason: string | null;
  createdBy: string;
  version: bigint;
  createdAt: Date;
  updatedAt: Date;
}

export interface MembershipValidationResult {
  valid: boolean;
  reason: string | null;
  membership: CustomerMembershipRow | null;
  eligibleBranch: boolean;
}

export type MembershipErrorCode =
  | 'validation_error'
  | 'resource_not_found'
  | 'resource_conflict'
  | 'version_conflict'
  | 'membership_plan_inactive'
  | 'membership_not_active';

export class MembershipError extends Error {
  constructor(
    readonly code: MembershipErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MembershipError';
  }
}

export interface MembershipMutationContext {
  companyId: string;
  actorId: string;
  actorPermissions: readonly string[];
  requestId: string;
  correlationId: string;
  timestamp: Date;
}

/** The transactional context `PaymentsService`/`SalesRepository.
 * trySettleSale` hands in at the exact moment a Sale newly settles — see
 * ADR-0017 "Activation boundary". Never constructed at sale-CREATION time. */
export interface SaleSettlementContext {
  companyId: string;
  branchId: string;
  saleId: string;
  customerId: string | null;
  actorId: string;
  correlationId: string;
  timestamp: Date;
  /** The sold lines' resolved product ids — used to find which
   * `membership_plans.product_id` (if any) this sale should activate.
   * Never re-derived from anything mutable after the fact. */
  productIds: readonly string[];
}
