/** TASK 13.1 — Reward entitlements + redemption + VIP Pass engine, built
 * on top of TASK 13.0's loyalty ledger foundation. See
 * `packages/database/src/schema/customers.ts` (`reward_entitlements`,
 * `reward_entitlement_tokens`) and ADR-0018 for the full design. */

export type RewardType = 'vip_pass';
export type RewardEntitlementStatus = 'available' | 'redeemed' | 'expired' | 'revoked';
export type RewardEntitlementSourceType = 'loyalty_threshold' | 'manual';

/** Part A — the durable, historical fact. Never inferred from the ledger's
 * current balance, never a `customer.hasVipPass` flag. `status` is the
 * PERSISTED state; a row whose `expires_at` has passed but is still
 * `'available'` is EFFECTIVELY expired for redemption purposes even
 * before that transition is persisted — see `effectiveStatus` below and
 * ADR-0018 "Expiration (lazy)". */
export interface RewardEntitlementRow {
  id: string;
  companyId: string;
  customerId: string;
  loyaltyAccountId: string;
  loyaltyProgramId: string;
  rewardType: RewardType;
  status: RewardEntitlementStatus;
  issuedAt: Date;
  expiresAt: Date | null;
  redeemedAt: Date | null;
  redeemedBy: string | null;
  redeemedBranchId: string | null;
  revokedAt: Date | null;
  revokedBy: string | null;
  revokedReason: string | null;
  sourceType: RewardEntitlementSourceType;
  sourceLedgerEntryId: string | null;
  cycleNumber: number | null;
  createdBy: string;
  version: bigint;
  createdAt: Date;
  updatedAt: Date;
}

/** Part N — the read-time-only, NEVER-persisted-by-a-read "what would
 * this row's status be evaluated right now" — computed by the service
 * layer, never trusted from a stale `status='available'` alone. Every
 * route response carries this instead of (or alongside) the raw
 * persisted `status`, so a caller never has to duplicate the expiry
 * check itself. */
export function effectiveStatus(row: RewardEntitlementRow, now: Date): RewardEntitlementStatus {
  if (row.status === 'available' && row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime())
    return 'expired';
  return row.status;
}

export interface RewardEntitlementTokenRow {
  id: string;
  companyId: string;
  rewardEntitlementId: string;
  token: string;
  status: 'active' | 'revoked';
  createdAt: Date;
  revokedAt: Date | null;
}

export type RewardErrorCode =
  | 'validation_error'
  | 'permission_denied'
  | 'resource_not_found'
  | 'resource_conflict'
  | 'version_conflict'
  | 'reward_not_available'
  | 'reward_expired'
  | 'reward_already_redeemed'
  | 'reward_already_revoked'
  | 'reward_branch_not_eligible'
  | 'reward_token_invalid';

export class RewardError extends Error {
  constructor(
    readonly code: RewardErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RewardError';
  }
}

export interface RewardMutationContext {
  companyId: string;
  actorId: string;
  actorPermissions: readonly string[];
  requestId: string;
  correlationId: string;
  timestamp: Date;
}

/** Manual issuance input (Part H) — `reward.issue`, never accepted as
 * free text from Flutter; every field is typed against the SAME program
 * configuration automatic issuance already uses. */
export interface ManualIssueRewardInput {
  customerId: string;
  loyaltyProgramId: string;
  reasonCode: string;
  expiresAt?: Date;
}

/** Hook context from `PaymentsService`, at the exact instant a Sale newly
 * settles — mirrors `memberships.types.ts`'s `SaleSettlementContext`/
 * `loyalty.types.ts`'s `SaleEarnContext` exactly (Part F: "no reward
 * should issue before Sale settlement"). */
export interface RewardIssuanceContext {
  companyId: string;
  branchId: string;
  saleId: string;
  customerId: string | null;
  actorId: string;
  correlationId: string;
  timestamp: Date;
}
