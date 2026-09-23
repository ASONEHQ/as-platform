import { createHash, randomUUID } from 'node:crypto';

import type { CustomersRepository } from '../customers/customers.repository.js';
import type { LoyaltyRepository, LoyaltyTransaction } from '../loyalty/loyalty.repository.js';
import type { RewardBenefitCandidate } from '../promotions/promotions.types.js';
import type { RewardsRepository, RewardTransaction } from './rewards.repository.js';
import {
  RewardError,
  effectiveStatus,
  type ManualIssueRewardInput,
  type RewardEntitlementRow,
  type RewardEntitlementTokenRow,
  type RewardIssuanceContext,
  type RewardMutationContext,
} from './rewards.types.js';

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function nonBlank(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new RewardError('validation_error', `The ${field} must not be blank.`);
  return trimmed;
}
// TASK 16.23A — was 'validation_error' (400); see the identical fix's
// rationale in customers.service.ts. Not a security bypass.
function requirePermission(context: RewardMutationContext, permission: string): void {
  if (!context.actorPermissions.includes(permission))
    throw new RewardError('permission_denied', `This actor is not authorized (${permission}).`);
}
function addDays(start: Date, days: number): Date {
  const result = new Date(start.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}
function optionalDate(value: unknown): Date | null {
  return value === null || value === undefined ? null : new Date(value as string);
}
/** `idempotent()`'s own persisted `response_body` is real JSON — a prior
 * `JSON.stringify(value, jsonValue)` (see `rewards.repository.ts`)
 * already turned every `Date` into an ISO string and `version` into a
 * decimal string, since JSON has neither type. A REPLAYED call must
 * therefore reconstruct a real `RewardEntitlementRow` from that JSON
 * shape — a bare `as RewardEntitlementRow` cast (this codebase's usual
 * `idempotent()` `decode` shorthand elsewhere) would leave every Date
 * field a STRING at runtime despite its declared type, and the very
 * first `.toISOString()` call downstream (`entitlementHttp`,
 * `effectiveStatus`) would throw — a real bug found and fixed here via
 * this task's own Real Local QA walkthrough (ADR-0018), which actually
 * exercises a same-key replay through the real HTTP route end to end;
 * every sibling module's identical `(value) => value as ...Row` shorthand
 * carries the same latent gap and was NOT fixed here — out of this
 * task's scope, flagged separately. */
function decodeEntitlement(value: unknown): RewardEntitlementRow {
  const row = value as Record<string, unknown>;
  return {
    id: row.id as string,
    companyId: row.companyId as string,
    customerId: row.customerId as string,
    loyaltyAccountId: row.loyaltyAccountId as string,
    loyaltyProgramId: row.loyaltyProgramId as string,
    rewardType: row.rewardType as RewardEntitlementRow['rewardType'],
    status: row.status as RewardEntitlementRow['status'],
    issuedAt: new Date(row.issuedAt as string),
    expiresAt: optionalDate(row.expiresAt),
    redeemedAt: optionalDate(row.redeemedAt),
    redeemedBy: row.redeemedBy as string | null,
    redeemedBranchId: row.redeemedBranchId as string | null,
    revokedAt: optionalDate(row.revokedAt),
    revokedBy: row.revokedBy as string | null,
    revokedReason: row.revokedReason as string | null,
    sourceType: row.sourceType as RewardEntitlementRow['sourceType'],
    sourceLedgerEntryId: row.sourceLedgerEntryId as string | null,
    cycleNumber: row.cycleNumber as number | null,
    createdBy: row.createdBy as string,
    version: BigInt(row.version as string),
    createdAt: new Date(row.createdAt as string),
    updatedAt: new Date(row.updatedAt as string),
  };
}

export class RewardsService {
  public constructor(
    private readonly repository: RewardsRepository,
    private readonly loyaltyRepository: LoyaltyRepository,
    // Read-only — Part Q: an archived/inactive customer cannot redeem.
    private readonly customersRepository: CustomersRepository,
  ) {}

  // --- Automatic issuance (Part D/F/G) --------------------------------------

  /** Called from `PaymentService`, inside the SAME transaction
   * `LoyaltyService.earnFromSale` used to record the settlement's earn
   * entries — never at sale-creation time, never for a walk-in sale.
   *
   * Threshold-cycle math (ADR-0018 "Threshold semantics"): for each
   * active program that defines BOTH `rewardThreshold` AND `rewardType`,
   * recompute `currentCycle = floor(cumulativeEarnedUnits / threshold)`
   * FRESH from the ledger every time (never a separately-tracked running
   * counter). If `currentCycle < 1`, nothing to issue yet. Otherwise
   * attempt to issue for every cycle number from 1 up to
   * `repeatable ? currentCycle : 1` — each attempt is a no-op if that
   * cycle's entitlement already exists (the database's own unique
   * constraint), so a retried/replayed settlement, or a program that
   * already issued its one-time reward, can never double-issue. A single
   * large earn event that crosses more than one cycle in one settlement
   * (e.g. `earn_quantity_per_sale` set high) correctly issues one
   * entitlement per newly-completed cycle, never just the latest one. */
  public async evaluateAutomaticIssuance(client: RewardTransaction & LoyaltyTransaction, context: RewardIssuanceContext): Promise<void> {
    if (context.customerId === null) return;
    const programs = await this.loyaltyRepository.activePrograms(context.companyId);
    const rewardPrograms = programs.filter((program) => program.rewardType !== null && program.rewardThreshold !== null);
    if (rewardPrograms.length === 0) return;
    const account = await this.loyaltyRepository.accountByCustomerId(client, context.companyId, context.customerId);
    if (account === null) return; // nothing was ever earned for this customer.
    for (const program of rewardPrograms) {
      const threshold = program.rewardThreshold;
      const rewardType = program.rewardType;
      if (threshold === null || rewardType === null) continue; // narrows for TS; filtered above.
      const totalEarned = await this.loyaltyRepository.cumulativeEarnedUnits(client, context.companyId, account.id, program.id);
      const currentCycle = Math.floor(totalEarned / threshold);
      if (currentCycle < 1) continue;
      const maxCycle = program.rewardRepeatable ? currentCycle : 1;
      for (let cycle = 1; cycle <= maxCycle; cycle += 1) {
        const created = await this.repository.insertEntitlement(client, {
          id: randomUUID(),
          companyId: context.companyId,
          customerId: context.customerId,
          loyaltyAccountId: account.id,
          loyaltyProgramId: program.id,
          rewardType,
          expiresAt: program.rewardExpirationDays === null ? null : addDays(context.timestamp, program.rewardExpirationDays),
          sourceType: 'loyalty_threshold',
          sourceLedgerEntryId: null,
          cycleNumber: cycle,
          createdBy: context.actorId,
          timestamp: context.timestamp,
        });
        if (created === null) continue; // this cycle was already issued — idempotent no-op.
        await this.repository.auditAndPublish(client, {
          companyId: context.companyId,
          actorId: context.actorId,
          actorPermissions: [],
          requestId: randomUUID(),
          correlationId: context.correlationId,
          timestamp: context.timestamp,
        }, {
          action: 'reward_entitlement.issued',
          resourceType: 'reward_entitlement',
          resourceId: created.id,
          eventType: 'reward.issued',
          version: created.version,
          payload: {
            reward_entitlement_id: created.id,
            customer_id: context.customerId,
            loyalty_program_id: program.id,
            status: created.status,
          },
          branchId: context.branchId,
        });
      }
    }
  }

  // --- Manual issuance (Part H) --------------------------------------------

  public async issueManual(
    context: RewardMutationContext,
    key: string,
    input: ManualIssueRewardInput,
  ): Promise<{ value: RewardEntitlementRow; replayed: boolean }> {
    requirePermission(context, 'reward.issue');
    const reasonCode = nonBlank(input.reasonCode, 'reason_code');
    const id = randomUUID();
    const requestHash = hash({
      customerId: input.customerId,
      loyaltyProgramId: input.loyaltyProgramId,
      reasonCode,
      expiresAt: input.expiresAt?.toISOString(),
    });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'reward_entitlement.issue_manual',
        key,
        requestHash,
        decodeEntitlement,
        async () => {
          const program = await this.loyaltyRepository.program(client, context.companyId, input.loyaltyProgramId);
          if (program === null) throw new RewardError('resource_not_found', 'The loyalty program was not found.');
          if (program.rewardType === null)
            throw new RewardError('validation_error', 'This program has no reward type configured.');
          const account = await this.loyaltyRepository.getOrCreateAccount(client, context.companyId, input.customerId, context.timestamp);
          const created = await this.repository.insertEntitlement(client, {
            id,
            companyId: context.companyId,
            customerId: input.customerId,
            loyaltyAccountId: account.id,
            loyaltyProgramId: program.id,
            rewardType: program.rewardType,
            expiresAt:
              input.expiresAt ?? (program.rewardExpirationDays === null ? null : addDays(context.timestamp, program.rewardExpirationDays)),
            sourceType: 'manual',
            sourceLedgerEntryId: null,
            cycleNumber: null,
            createdBy: context.actorId,
            timestamp: context.timestamp,
          });
          // `cycle_number` is always `null` here, and Postgres treats every
          // `NULL` as distinct — this insert can never actually conflict.
          if (created === null) throw new Error('Manual reward issuance unexpectedly conflicted.');
          await this.repository.auditAndPublish(client, context, {
            action: 'reward_entitlement.issued_manual',
            resourceType: 'reward_entitlement',
            resourceId: created.id,
            eventType: 'reward.issued',
            version: created.version,
            // `reasonCode` deliberately stays out of this durable payload
            // too — it already lives forever in `audit_log`'s own
            // metadata below, matching Part S's minimal-payload rule.
            payload: { reward_entitlement_id: created.id, customer_id: input.customerId, loyalty_program_id: program.id, status: created.status },
          });
          return created;
        },
      ),
    );
  }

  // --- Reads (Part T/U) -----------------------------------------------------

  public async entitlementsForCustomer(
    context: { companyId: string; actorPermissions: readonly string[] },
    customerId: string,
  ): Promise<RewardEntitlementRow[]> {
    requirePermission(context as RewardMutationContext, 'reward.read');
    return this.repository.entitlementsForCustomer(context.companyId, customerId);
  }

  public async entitlement(
    context: { companyId: string; actorPermissions: readonly string[] },
    id: string,
  ): Promise<RewardEntitlementRow> {
    requirePermission(context as RewardMutationContext, 'reward.read');
    const row = await this.repository.entitlement(null, context.companyId, id);
    if (row === null) throw new RewardError('resource_not_found', 'The reward entitlement was not found.');
    return row;
  }

  // --- Checkout benefit resolution (TASK 13.2, Part D) -----------------------

  /** The ONE place a reward entitlement's checkout BENEFIT is resolved —
   * called from BOTH `PromotionsService.quote()` (preview, read-only)
   * AND `SalesService.createSale` (re-validated fresh at creation time,
   * still read-only — Part D: creation never locks or mutates the
   * entitlement). Read-only by design: no row lock, no status
   * transition, nothing committed — the only place this entitlement is
   * EVER actually mutated is settlement (`consumeAppliedUsagesForSale`
   * above). Throws the SAME specific `RewardError` codes `redeem()`
   * itself would (`resource_not_found`/`reward_not_available`/
   * `reward_expired`/etc.) — never a generic failure — so a caller one
   * or two modules away (`PromotionsService`/`SalesService`, whose OWN
   * `mapPromotionError`/`mapSaleError` both check for `RewardError`
   * first and delegate to `mapRewardError`, see `rewards.http-errors.ts`)
   * still surfaces the honest, specific reason (Part O). */
  public async resolveCheckoutBenefit(
    context: { companyId: string; actorPermissions: readonly string[] },
    customerId: string,
    rewardEntitlementId: string,
    now: Date,
  ): Promise<{ candidate: RewardBenefitCandidate; entitlement: RewardEntitlementRow }> {
    requirePermission(context as RewardMutationContext, 'reward.redeem');
    const entitlement = await this.repository.entitlement(null, context.companyId, rewardEntitlementId);
    if (entitlement === null) throw new RewardError('resource_not_found', 'The reward entitlement was not found.');
    if (entitlement.customerId !== customerId)
      throw new RewardError('reward_not_available', 'This reward does not belong to the attached customer.');
    const status = effectiveStatus(entitlement, now);
    if (status === 'redeemed') throw new RewardError('reward_already_redeemed', 'This reward was already redeemed.');
    if (status === 'revoked') throw new RewardError('reward_not_available', 'This reward was revoked.');
    if (status === 'expired') throw new RewardError('reward_expired', 'This reward has expired.');
    const program = await this.loyaltyRepository.program(null, context.companyId, entitlement.loyaltyProgramId);
    if (program === null) throw new RewardError('reward_not_available', 'This reward has no checkout benefit configured.');
    if (program.rewardBenefitType === null)
      throw new RewardError('reward_not_available', 'This reward has no checkout benefit configured.');
    return {
      entitlement,
      candidate: {
        rewardEntitlementId: entitlement.id,
        loyaltyProgramId: program.id,
        rewardType: entitlement.rewardType,
        benefitType: program.rewardBenefitType,
        benefitPercentageBasisPoints: program.rewardBenefitPercentageBasisPoints,
        benefitFixedAmount: program.rewardBenefitFixedAmount,
        scope: { productIds: program.rewardScopeProductIds, categoryIds: program.rewardScopeCategoryIds },
      },
    };
  }

  /** Thin passthrough so `SalesService.createSale` — which already
   * depends on `RewardsService`, never on `RewardsRepository` directly
   * (Part D/G) — can record the Sale's own reward-usage INTENT row
   * inside its own transaction, right after freezing the `sale_discounts`
   * snapshot from the SAME pricing computation. Still does not touch
   * `reward_entitlements` at all. */
  public recordSaleRewardUsage(
    client: RewardTransaction,
    input: Parameters<RewardsRepository['insertSaleRewardUsage']>[1],
  ): ReturnType<RewardsRepository['insertSaleRewardUsage']> {
    return this.repository.insertSaleRewardUsage(client, input);
  }

  /** Thin passthrough for `SalesService.cancelSale` — mirrors
   * `PromotionsRepository.deleteCouponRedemptionsForSale`'s identical
   * "release the reservation on cancellation, never touch the frozen
   * arithmetic snapshot" shape (ADR-0019 "Refund policy"/D above): a
   * no-op when this Sale never attached a reward. */
  public releaseSaleRewardUsage(client: RewardTransaction, companyId: string, saleId: string, timestamp: Date): Promise<void> {
    return this.repository.releaseAppliedUsagesForSale(client, companyId, saleId, timestamp);
  }

  // --- Redemption (Part I/J) ------------------------------------------------

  public async redeem(
    context: RewardMutationContext,
    key: string,
    id: string,
    branchId: string | null,
  ): Promise<{ value: RewardEntitlementRow; replayed: boolean }> {
    requirePermission(context, 'reward.redeem');
    const requestHash = hash({ id, branchId });
    const outcome = await this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'reward_entitlement.redeem',
        key,
        requestHash,
        decodeEntitlement,
        async () => {
          const locked = await this.repository.lockEntitlement(client, context.companyId, id);
          if (locked === null) throw new RewardError('resource_not_found', 'The reward entitlement was not found.');
          const customer = await this.customersRepository.customer(client, context.companyId, locked.customerId);
          // Part Q — explicit server policy: an archived/inactive customer
          // cannot redeem. A history-preserving choice, not a hard block on
          // ever viewing the entitlement.
          if (customer?.status !== 'active') throw new RewardError('reward_not_available', 'The customer is not active.');
          if (locked.status === 'redeemed') throw new RewardError('reward_already_redeemed', 'This reward was already redeemed.');
          if (locked.status === 'revoked') throw new RewardError('reward_not_available', 'This reward was revoked.');
          // A row already durably `expired` (a previous redeem attempt
          // already committed the lazy transition below) rejects with the
          // same specific `reward_expired` every time — never the generic
          // `reward_not_available` a first-time caller would never see.
          if (locked.status === 'expired') throw new RewardError('reward_expired', 'This reward has expired.');
          // Lazy expiry (ADR-0018 "Expiration") — the one place a stale
          // `available` status is actually acted on: transition it to
          // `expired` in this same transaction. Every OTHER status was
          // already ruled out above, so `locked.status` is provably
          // `'available'` here — only the expiry check itself decides
          // this branch. It deliberately RETURNS (never throws) so
          // `idempotent()`'s own transaction actually COMMITS the
          // transition — throwing here, like every other rejection
          // above, would roll back `markExpired`'s own UPDATE right
          // along with it, silently undoing the very persistence this
          // comment used to (incorrectly) promise. The caller below
          // inspects the committed result and raises `reward_expired`
          // itself, strictly AFTER commit.
          if (locked.expiresAt !== null && locked.expiresAt.getTime() <= context.timestamp.getTime()) {
            const expired = await this.repository.markExpired(client, context.companyId, id, locked.version, context.timestamp);
            await this.repository.auditAndPublish(client, context, {
              action: 'reward_entitlement.expired',
              resourceType: 'reward_entitlement',
              resourceId: expired.id,
              eventType: 'reward.expired',
              version: expired.version,
              payload: { reward_entitlement_id: expired.id, customer_id: expired.customerId, status: expired.status },
              branchId,
            });
            return expired;
          }
          const updated = await this.repository.markRedeemed(client, context.companyId, id, locked.version, {
            redeemedBy: context.actorId,
            redeemedBranchId: branchId,
            timestamp: context.timestamp,
          });
          await this.repository.auditAndPublish(
            client,
            context,
            {
              action: 'reward_entitlement.redeemed',
              resourceType: 'reward_entitlement',
              resourceId: updated.id,
              eventType: 'reward.redeemed',
              version: updated.version,
              payload: { reward_entitlement_id: updated.id, customer_id: updated.customerId, status: updated.status },
              branchId,
            },
          );
          return updated;
        },
      ),
    );
    // Committed (real or replayed) as `expired` — signal the rejection to
    // THIS caller without touching what was just durably persisted; a
    // replay of the same idempotency key against an already-expired
    // result lands here identically every time.
    if (outcome.value.status === 'expired') throw new RewardError('reward_expired', 'This reward has expired.');
    return outcome;
  }

  // --- Sale settlement consumption (TASK 13.2, Part E/F/G) -------------------

  /** Called from `PaymentService.applyPostSettlementHooks`, inside the
   * SAME transaction a Sale genuinely, newly settles in — never on
   * creation, never on a still-`pending_payment` Sale (those states
   * simply never reach this call at all; see `PaymentService`'s own
   * settlement-hook doc comment). For every `status='applied'` usage
   * row this Sale attached, re-validates and redeems the underlying
   * entitlement via the EXACT SAME row-locked, exactly-once mechanism
   * `redeem()` already uses (`lockEntitlement` + `markRedeemed`) — no
   * parallel concurrency primitive, no new lock (ADR-0019 "Concurrency
   * strategy"): whichever of two Sales attached to the SAME entitlement
   * settles FIRST wins the lock and finds `status='available'`;
   * whichever settles second finds `status='redeemed'` already and this
   * method THROWS — propagating straight up through
   * `applyPostSettlementHooks` and rolling back that Sale's entire
   * payment-settlement transaction (Part F: "no payment irreversibility
   * risk" — the payment is never captured, the Sale never completes,
   * for a reward it can no longer honor).
   *
   * Deliberately simpler than `redeem()`'s own lazy-expiry persistence
   * trick: if the entitlement turns out expired here, this throws
   * `reward_expired` immediately WITHOUT attempting to also persist the
   * `available → expired` transition (doing so would require breaking
   * this transaction's own atomicity to commit that side-effect before
   * rolling back the rest). The persisted transition simply happens the
   * next time anyone actually acts on this entitlement through the
   * standalone `redeem()` path; `effectiveStatus()` already reports the
   * correct LIVE answer everywhere regardless of whether the DB column
   * has caught up yet. */
  public async consumeAppliedUsagesForSale(
    client: RewardTransaction,
    context: { companyId: string; branchId: string; saleId: string; actorId: string; correlationId: string; timestamp: Date },
  ): Promise<void> {
    const usages = await this.repository.lockAppliedUsagesForSale(client, context.companyId, context.saleId);
    for (const usage of usages) {
      const locked = await this.repository.lockEntitlement(client, context.companyId, usage.rewardEntitlementId);
      if (locked === null) throw new RewardError('resource_not_found', 'The reward entitlement was not found.');
      const customer = await this.customersRepository.customer(client, context.companyId, locked.customerId);
      if (customer?.status !== 'active') throw new RewardError('reward_not_available', 'The customer is not active.');
      if (locked.status === 'redeemed') throw new RewardError('reward_already_redeemed', 'This reward was already redeemed.');
      if (locked.status === 'revoked') throw new RewardError('reward_not_available', 'This reward was revoked.');
      if (locked.status === 'expired' || (locked.expiresAt !== null && locked.expiresAt.getTime() <= context.timestamp.getTime()))
        throw new RewardError('reward_expired', 'This reward has expired.');
      const updated = await this.repository.markRedeemed(client, context.companyId, usage.rewardEntitlementId, locked.version, {
        redeemedBy: context.actorId,
        redeemedBranchId: context.branchId,
        timestamp: context.timestamp,
      });
      await this.repository.markSaleRewardUsageConsumed(client, context.companyId, usage.id, context.timestamp);
      await this.repository.auditAndPublish(
        client,
        {
          companyId: context.companyId,
          actorId: context.actorId,
          actorPermissions: [],
          requestId: randomUUID(),
          correlationId: context.correlationId,
          timestamp: context.timestamp,
        },
        {
          action: 'reward_entitlement.redeemed',
          resourceType: 'reward_entitlement',
          resourceId: updated.id,
          eventType: 'reward.redeemed',
          version: updated.version,
          // Part T — ids/status only, never PII, never the sale's own
          // commercial detail beyond its id.
          payload: { reward_entitlement_id: updated.id, customer_id: updated.customerId, status: updated.status, sale_id: context.saleId },
          branchId: context.branchId,
        },
      );
    }
  }

  // --- Refund reversal hook (Phase 37, TASK 16.21) --------------------------

  /** Called from `RefundsService.completeRefund`, in the SAME transaction,
   * immediately AFTER `LoyaltyService.reverseEarnForRefund` has already
   * inserted that reversal's negative `earn` entries — `cumulative
   * EarnedUnits` below therefore reads the POST-reversal total. For every
   * program with a threshold, recomputes the cycle the account would
   * genuinely be at now and revokes any AUTOMATIC entitlement whose
   * `cycle_number` is no longer reached — but ONLY while it is still
   * `'available'`. An entitlement the customer already REDEEMED before
   * the refund is a closed historical fact (Part O: redemption is
   * itself an explicit, one-shot customer transaction, already recorded
   * with its own `sale_reward_usages` evidence) — this deliberately
   * never claws it back, matching this task's own "honest refund
   * semantics" requirement over a silently-impossible retroactive
   * un-redemption. Internal hook only (no `reward.revoke` permission
   * check — the actor here is whoever is completing the REFUND, not
   * necessarily someone provisioned for manual revocation; the
   * revocation is a direct, attributable, audited consequence of their
   * own action, not a free-standing privileged operation). */
  public async reverseIssuanceForRefund(
    client: RewardTransaction & LoyaltyTransaction,
    context: RewardIssuanceContext & { refundId: string },
  ): Promise<void> {
    if (context.customerId === null) return;
    const programs = await this.loyaltyRepository.activePrograms(context.companyId);
    const rewardPrograms = programs.filter((program) => program.rewardType !== null && program.rewardThreshold !== null);
    if (rewardPrograms.length === 0) return;
    const account = await this.loyaltyRepository.accountByCustomerId(client, context.companyId, context.customerId);
    if (account === null) return;
    for (const program of rewardPrograms) {
      const threshold = program.rewardThreshold;
      if (threshold === null) continue; // narrows for TS; filtered above.
      const totalEarned = await this.loyaltyRepository.cumulativeEarnedUnits(client, context.companyId, account.id, program.id);
      const newCycle = Math.floor(totalEarned / threshold);
      const revocable = await this.repository.availableEntitlementsAboveCycle(client, context.companyId, account.id, program.id, newCycle);
      for (const entitlement of revocable) {
        const revoked = await this.repository.markRevoked(client, context.companyId, entitlement.id, entitlement.version, {
          revokedBy: context.actorId,
          revokedReason: `Automatic reversal: refund of the sale that earned toward cycle ${entitlement.cycleNumber?.toString() ?? '?'} left this reward's threshold no longer reached.`,
          timestamp: context.timestamp,
        });
        await this.repository.auditAndPublish(client, {
          companyId: context.companyId,
          actorId: context.actorId,
          actorPermissions: [],
          requestId: randomUUID(),
          correlationId: context.correlationId,
          timestamp: context.timestamp,
        }, {
          action: 'reward_entitlement.revoked_for_refund',
          resourceType: 'reward_entitlement',
          resourceId: revoked.id,
          eventType: 'reward.revoked',
          version: revoked.version,
          payload: {
            reward_entitlement_id: revoked.id,
            customer_id: context.customerId,
            loyalty_program_id: program.id,
            refund_id: context.refundId,
            status: revoked.status,
          },
          branchId: context.branchId,
        });
      }
    }
  }

  // --- Revocation (Part O) ---------------------------------------------------

  public async revoke(
    context: RewardMutationContext,
    id: string,
    expectedVersion: bigint,
    reason: string,
  ): Promise<RewardEntitlementRow> {
    requirePermission(context, 'reward.revoke');
    const reasonClean = nonBlank(reason, 'reason');
    return this.repository.transaction(async (client) => {
      const locked = await this.repository.lockEntitlement(client, context.companyId, id);
      if (locked === null) throw new RewardError('resource_not_found', 'The reward entitlement was not found.');
      if (locked.status === 'revoked') return locked;
      if (locked.status === 'redeemed')
        throw new RewardError('reward_already_redeemed', 'A redeemed reward cannot be revoked.');
      const updated = await this.repository.markRevoked(client, context.companyId, id, expectedVersion, {
        revokedBy: context.actorId,
        revokedReason: reasonClean,
        timestamp: context.timestamp,
      });
      await this.repository.auditAndPublish(client, context, {
        action: 'reward_entitlement.revoked',
        resourceType: 'reward_entitlement',
        resourceId: updated.id,
        eventType: 'reward.revoked',
        version: updated.version,
        payload: { reward_entitlement_id: updated.id, customer_id: updated.customerId, status: updated.status },
      });
      return updated;
    });
  }

  // --- Presentation token (Part L/X) -----------------------------------------

  public async issueToken(context: RewardMutationContext, id: string): Promise<RewardEntitlementTokenRow> {
    requirePermission(context, 'reward.read');
    return this.repository.transaction(async (client) => {
      const found = await this.repository.entitlement(client, context.companyId, id);
      if (found === null) throw new RewardError('resource_not_found', 'The reward entitlement was not found.');
      const issued = await this.repository.issueToken(client, context.companyId, id, context.timestamp);
      await this.repository.auditAndPublish(client, context, {
        action: 'reward_entitlement.token_issued',
        resourceType: 'reward_entitlement',
        resourceId: id,
        eventType: 'reward.token_issued',
        version: found.version,
        // Never the raw token value (Part S/X).
        payload: { reward_entitlement_id: id },
      });
      return issued;
    });
  }

  public async activeToken(
    context: { companyId: string; actorPermissions: readonly string[] },
    id: string,
  ): Promise<RewardEntitlementTokenRow | null> {
    requirePermission(context as RewardMutationContext, 'reward.read');
    const found = await this.repository.entitlement(null, context.companyId, id);
    if (found === null) throw new RewardError('resource_not_found', 'The reward entitlement was not found.');
    return this.repository.activeTokenForEntitlement(context.companyId, id);
  }

  /** Server-side resolution of a scanned presentation token — never
   * authentication, purely a lookup, and rejects a token resolving to a
   * DIFFERENT company than the caller's own authenticated context. */
  public async resolveToken(
    context: { companyId: string; actorPermissions: readonly string[] },
    tokenValue: string,
  ): Promise<RewardEntitlementRow> {
    requirePermission(context as RewardMutationContext, 'reward.read');
    const resolved = await this.repository.entitlementByToken(tokenValue);
    if (resolved?.status !== 'active' || resolved.companyId !== context.companyId)
      throw new RewardError('reward_token_invalid', 'The reward token is not valid.');
    const found = await this.repository.entitlement(null, context.companyId, resolved.rewardEntitlementId);
    if (found === null) throw new RewardError('reward_token_invalid', 'The reward token is not valid.');
    return found;
  }
}
