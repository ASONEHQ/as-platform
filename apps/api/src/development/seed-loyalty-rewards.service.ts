import { randomUUID } from 'node:crypto';

import type { DatabaseClient } from '@asone/database';

import { LoyaltyRepository } from '../modules/loyalty/loyalty.repository.js';
import { LoyaltyService } from '../modules/loyalty/loyalty.service.js';
import type { LoyaltyProgramRow } from '../modules/loyalty/loyalty.types.js';
import { PosCatalogSeedError, validateSeedEnvironment } from './seed-pos-catalog.service.js';

/**
 * TASK 13.1 Part M: development-only "5 stamps → VIP Pass" loyalty-program
 * fixture, so the reward-entitlement engine (evaluateAutomaticIssuance /
 * threshold-cycle issuance / redemption) can be exercised end to end
 * against real backend data (Part AC's Real Local QA walkthrough) instead
 * of only unit-tested in isolation.
 *
 * This is deliberately business CONFIGURATION, not engine code: the "5+1"
 * shape (five qualifying stamps issue one repeatable VIP Pass entitlement)
 * lives entirely in the DATA this seed writes through the real, generic
 * `LoyaltyService.createProgram` — never as a hardcoded special case in
 * `rewards.service.ts`/`loyalty.service.ts`. A different company, or this
 * same company later, can configure any other threshold/reward_type pair
 * (once more reward types exist) without touching engine code at all.
 *
 * Guarded identically to the sibling dev seeds (`seed-pos-catalog.service.
 * ts`, `seed-cash-registers.service.ts`): development/test only, loopback
 * PostgreSQL, allowlisted database name, targets only the fixed
 * `inflapark-group` development company created by `dev:bootstrap-owner`,
 * and refuses to run if that company doesn't exist yet. Created through
 * the real, already-tested `LoyaltyService.createProgram` with a
 * deterministic idempotency key — never a raw insert — so re-running this
 * command replays instead of duplicating.
 *
 * What this does NOT do, on purpose:
 *   - it does not activate any customer's loyalty account (accounts are
 *     created lazily, the first time a real sale earns against this
 *     program — see `LoyaltyRepository.getOrCreateAccount`);
 *   - it does not issue any `reward_entitlements` row itself — an
 *     entitlement is only ever issued by a real settled Sale crossing the
 *     threshold (`PaymentService.applyPostSettlementHooks` →
 *     `RewardsService.evaluateAutomaticIssuance`), never fabricated by a
 *     seed script (ADR-0018 "No reward backfill / no fabricated
 *     issuance");
 *   - it does not run in production, staging, or any non-loopback target.
 */

const companySlug = 'inflapark-group';
const ownerEmail = 'ceo@inflapark.local';
const keyPrefix = 'loyalty-rewards-seed';
const programCode = 'sellos-vip-5-1';
const programName = 'Sellos VIP (5+1)';

export interface LoyaltyRewardsSeedSummary {
  readonly company: 'inflapark-group';
  readonly program: { readonly id: string; readonly name: string; readonly created: boolean };
  readonly success: true;
}

export class LoyaltyRewardsSeed {
  private readonly loyalty: LoyaltyService;

  public constructor(private readonly database: DatabaseClient) {
    this.loyalty = new LoyaltyService(new LoyaltyRepository(database));
  }

  public async run(): Promise<LoyaltyRewardsSeedSummary> {
    const companyRow = await this.database.pool.query<{ id: string }>(
      `select id from companies where slug=$1`,
      [companySlug],
    );
    const companyId = companyRow.rows[0]?.id;
    if (companyId === undefined)
      throw new PosCatalogSeedError(
        `Company "${companySlug}" was not found. Run "pnpm --filter @asone/api dev:bootstrap-owner" first.`,
      );
    const ownerRow = await this.database.pool.query<{ id: string }>(
      `select id from users where normalized_email=$1`,
      [ownerEmail],
    );
    const actorId = ownerRow.rows[0]?.id;
    if (actorId === undefined)
      throw new PosCatalogSeedError(
        `Owner user "${ownerEmail}" was not found. Run "pnpm --filter @asone/api dev:bootstrap-owner" first.`,
      );

    const context = {
      companyId,
      actorId,
      // Trusted internal seed context, not a real authenticated request —
      // grants exactly the one permission this call needs, mirroring how
      // `earnFromSale`'s own synthetic system context (loyalty.service.ts)
      // never claims broader authority than the single action it performs.
      actorPermissions: ['loyalty.manage'],
      requestId: `${keyPrefix}-${randomUUID()}`,
      correlationId: `${keyPrefix}-${randomUUID()}`,
      timestamp: new Date(),
    };

    const result = await this.loyalty.createProgram(context, `${keyPrefix}:program:${programCode}`, {
      name: programName,
      // Part R — no invisible business rule: explicit `active: true` here
      // is itself the deliberate QA decision this seed exists to make (a
      // real company's admin console call would default to `false`).
      active: true,
      unitType: 'stamp',
      earnQuantityPerSale: 1,
      // Part M — "5 stamps earn a pass to use on the NEXT visit": five
      // qualifying earns (one per completed, settled Sale for a customer
      // with this program active) cross `reward_threshold=5`, at which
      // point `cycle_number = floor(totalEarned / 5)` issues exactly one
      // `vip_pass` entitlement, available starting the visit AFTER the
      // fifth stamp — never an automatic free CURRENT transaction.
      rewardThreshold: 5,
      rewardDescription: 'VIP Pass — 5th stamp completes the card, 6th visit is free.',
      rewardType: 'vip_pass',
      // Repeatable: crossing the threshold again (10, 15, ... stamps)
      // issues another independent entitlement each time, matching how a
      // real punch-card program keeps rewarding every completed card, not
      // only the first.
      rewardRepeatable: true,
    });

    const program: LoyaltyProgramRow = result.value;
    return Object.freeze({
      company: companySlug,
      program: Object.freeze({ id: program.id, name: program.name, created: !result.replayed }),
      success: true,
    });
  }
}

export { validateSeedEnvironment };
