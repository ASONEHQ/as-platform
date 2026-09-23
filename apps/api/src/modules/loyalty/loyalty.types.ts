/** TASK 13.0 — AS Rewards+ foundation. See `packages/database/src/schema/
 * customers.ts` (`loyalty_programs`/`loyalty_accounts`/`loyalty_ledger`)
 * and ADR-0017.
 *
 * TASK 13.1 extends `LoyaltyProgramRow`/`CreateLoyaltyProgramInput` with
 * `rewardType`/`rewardExpirationDays`/`rewardRepeatable` — the minimum
 * typed data needed to actually ISSUE a `reward_entitlements` row (see
 * `../rewards/rewards.types.ts` and ADR-0018). Everything else in this
 * file is unchanged from TASK 13.0. */

export type LoyaltyUnitType = 'stamp' | 'point';
export type LoyaltyEntryType = 'earn' | 'redeem' | 'adjustment' | 'expiration';
export type LoyaltyEntrySourceType = 'sale' | 'manual' | 'expiration_job' | 'refund';
export type LoyaltyRewardType = 'vip_pass';
// TASK 13.2 (ADR-0019) — the smallest typed set of ways an issued
// entitlement can reduce a Sale's price at checkout.
export type LoyaltyRewardBenefitType = 'percentage_discount' | 'fixed_amount_discount' | 'fixed_price' | 'free_eligible_item';

export interface LoyaltyProgramRow {
  id: string;
  companyId: string;
  name: string;
  active: boolean;
  unitType: LoyaltyUnitType;
  earningRuleType: 'per_completed_sale';
  earnQuantityPerSale: number;
  minimumSaleTotal: string | null;
  rewardThreshold: number | null;
  rewardDescription: string | null;
  /** `null` for a program that only tracks progress display without ever
   * issuing anything — automatic issuance is gated on this being
   * non-null, never inferred from `rewardThreshold` alone (ADR-0018). */
  rewardType: LoyaltyRewardType | null;
  rewardExpirationDays: number | null;
  rewardRepeatable: boolean;
  /** TASK 13.2 (ADR-0019) — `null` means this program's issued
   * entitlements still carry no purchasable checkout benefit (the
   * TASK 13.1 display/tracking-only state) — automatic benefit
   * APPLICATION at checkout is gated on this being non-null, never
   * inferred from `rewardType` alone. */
  rewardBenefitType: LoyaltyRewardBenefitType | null;
  rewardBenefitPercentageBasisPoints: number | null;
  rewardBenefitFixedAmount: string | null;
  /** Part B — empty means "not restricted by specific product" (still
   * possibly restricted by category). Both empty is a valid (if useless)
   * DB state, but the pricing engine treats both-empty as "matches
   * nothing" for a reward (the deliberate inverse of a promotion's own
   * both-empty convention) — `LoyaltyService` itself refuses to let a
   * caller configure `rewardBenefitType` with a fully empty scope. */
  rewardScopeProductIds: readonly string[];
  rewardScopeCategoryIds: readonly string[];
  createdBy: string;
  updatedBy: string;
  version: bigint;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateLoyaltyProgramInput {
  id?: string;
  name: string;
  active?: boolean;
  unitType: LoyaltyUnitType;
  earnQuantityPerSale?: number;
  minimumSaleTotal?: string;
  rewardThreshold?: number;
  rewardDescription?: string;
  rewardType?: LoyaltyRewardType;
  rewardExpirationDays?: number;
  rewardRepeatable?: boolean;
  rewardBenefitType?: LoyaltyRewardBenefitType;
  rewardBenefitPercentageBasisPoints?: number;
  rewardBenefitFixedAmount?: string;
  /** Omitted entirely means "leave the existing scope alone" on an
   * update; `LoyaltyService.createProgram` always supplies both
   * (possibly empty) arrays explicitly. */
  rewardScopeProductIds?: readonly string[];
  rewardScopeCategoryIds?: readonly string[];
}

export interface LoyaltyAccountRow {
  id: string;
  companyId: string;
  customerId: string;
  status: 'active' | 'closed';
  createdAt: Date;
  updatedAt: Date;
}

export interface LoyaltyLedgerEntryRow {
  id: string;
  companyId: string;
  loyaltyAccountId: string;
  loyaltyProgramId: string | null;
  branchId: string | null;
  entryType: LoyaltyEntryType;
  quantity: number;
  unitType: LoyaltyUnitType;
  sourceType: LoyaltyEntrySourceType;
  sourceId: string | null;
  reason: string | null;
  actorId: string | null;
  occurredAt: Date;
  createdAt: Date;
}

/** Part Q — the balance is always DERIVED, never a cached mutable
 * counter. Grouped per program (a company may run more than one
 * concurrently), plus an overall total for display convenience. */
export interface LoyaltyBalance {
  programId: string | null;
  unitType: LoyaltyUnitType;
  balance: number;
}

export interface LoyaltySummary {
  account: LoyaltyAccountRow | null;
  balances: readonly LoyaltyBalance[];
  ledger: readonly LoyaltyLedgerEntryRow[];
}

export type LoyaltyErrorCode =
  | 'validation_error'
  | 'permission_denied'
  | 'resource_not_found'
  | 'resource_conflict'
  | 'version_conflict';

export class LoyaltyError extends Error {
  constructor(
    readonly code: LoyaltyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LoyaltyError';
  }
}

export interface LoyaltyMutationContext {
  companyId: string;
  actorId: string;
  actorPermissions: readonly string[];
  requestId: string;
  correlationId: string;
  timestamp: Date;
}

/** Hook context from `PaymentsService`, at the exact moment a Sale newly
 * settles — mirrors `memberships.types.ts`'s `SaleSettlementContext`
 * exactly (same transactional boundary, same reasoning). */
export interface SaleEarnContext {
  companyId: string;
  branchId: string;
  saleId: string;
  customerId: string | null;
  saleTotal: string;
  actorId: string;
  correlationId: string;
  timestamp: Date;
}

/** TASK 16.21 (Phase 37) — hook context from `RefundsService`, at the
 * exact instant a FULL refund of the originating sale completes (never
 * for a partial refund — see `LoyaltyService.reverseEarnForRefund`'s own
 * doc comment for why). Mirrors `SaleEarnContext` exactly, plus the
 * refund's own id (the reversal entry's `source_id`). */
export interface SaleRefundReversalContext {
  companyId: string;
  branchId: string;
  saleId: string;
  refundId: string;
  actorId: string;
  correlationId: string;
  timestamp: Date;
}
