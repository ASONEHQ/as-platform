import { randomBytes, randomUUID } from 'node:crypto';

import type { DatabaseClient } from '@asone/database';

import {
  RewardError,
  type RewardEntitlementRow,
  type RewardEntitlementSourceType,
  type RewardEntitlementStatus,
  type RewardEntitlementTokenRow,
  type RewardMutationContext,
  type RewardType,
} from './rewards.types.js';

/** Structurally identical to every other module's transaction interface
 * in this codebase — a real `pg` client from `PaymentsService`'s own
 * settlement transaction satisfies this too, exactly like
 * `MembershipTransaction`/`LoyaltyTransaction` already do. */
export interface RewardTransaction {
  query(sql: string, values?: readonly unknown[]): Promise<unknown>;
}

interface QueryResult<T> {
  rows: T[];
}
function result<T>(value: unknown): QueryResult<T> {
  return value as QueryResult<T>;
}
function constraint(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'constraint' in error
    ? String((error as { constraint?: unknown }).constraint)
    : undefined;
}
function jsonValue(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}
interface IdempotencyDb {
  request_hash: string;
  response_body: unknown;
}

const ENTITLEMENT_COLUMNS =
  'id,company_id,customer_id,loyalty_account_id,loyalty_program_id,reward_type,status,issued_at,expires_at,' +
  'redeemed_at,redeemed_by,redeemed_branch_id,revoked_at,revoked_by,revoked_reason,source_type,' +
  'source_ledger_entry_id,cycle_number,created_by,version,created_at,updated_at';
interface EntitlementDb {
  id: string;
  company_id: string;
  customer_id: string;
  loyalty_account_id: string;
  loyalty_program_id: string;
  reward_type: RewardType;
  status: RewardEntitlementStatus;
  issued_at: Date | string;
  expires_at: Date | string | null;
  redeemed_at: Date | string | null;
  redeemed_by: string | null;
  redeemed_branch_id: string | null;
  revoked_at: Date | string | null;
  revoked_by: string | null;
  revoked_reason: string | null;
  source_type: RewardEntitlementSourceType;
  source_ledger_entry_id: string | null;
  cycle_number: number | null;
  created_by: string;
  version: string;
  created_at: Date | string;
  updated_at: Date | string;
}
interface TokenDb {
  id: string;
  company_id: string;
  reward_entitlement_id: string;
  token: string;
  status: 'active' | 'revoked';
  created_at: Date | string;
  revoked_at: Date | string | null;
}
// TASK 13.2 — `sale_reward_usages` (defined in `promotions.ts`'s schema
// file, alongside its sibling `sale_discounts`, but managed from HERE:
// both `SalesService` and `RewardsService`/`PaymentService` already
// depend on `RewardsRepository`, so this avoids a THIRD cross-module
// dependency edge — see ADR-0019 "Sale reward snapshot".
export type SaleRewardUsageStatus = 'applied' | 'consumed' | 'released';
export interface SaleRewardUsageRow {
  id: string;
  companyId: string;
  branchId: string;
  saleId: string;
  saleItemId: string;
  rewardEntitlementId: string;
  loyaltyProgramId: string;
  rewardType: RewardType;
  benefitType: string;
  benefitAmountSnapshot: string;
  status: SaleRewardUsageStatus;
  createdAt: Date;
  consumedAt: Date | null;
  releasedAt: Date | null;
}
interface SaleRewardUsageDb {
  id: string;
  company_id: string;
  branch_id: string;
  sale_id: string;
  sale_item_id: string;
  reward_entitlement_id: string;
  loyalty_program_id: string;
  reward_type: RewardType;
  benefit_type: string;
  benefit_amount_snapshot: string;
  status: SaleRewardUsageStatus;
  created_at: Date | string;
  consumed_at: Date | string | null;
  released_at: Date | string | null;
}
function saleRewardUsage(row: SaleRewardUsageDb): SaleRewardUsageRow {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    saleId: row.sale_id,
    saleItemId: row.sale_item_id,
    rewardEntitlementId: row.reward_entitlement_id,
    loyaltyProgramId: row.loyalty_program_id,
    rewardType: row.reward_type,
    benefitType: row.benefit_type,
    benefitAmountSnapshot: row.benefit_amount_snapshot,
    status: row.status,
    createdAt: new Date(row.created_at),
    consumedAt: row.consumed_at === null ? null : new Date(row.consumed_at),
    releasedAt: row.released_at === null ? null : new Date(row.released_at),
  };
}
const SALE_REWARD_USAGE_COLUMNS =
  'id,company_id,branch_id,sale_id,sale_item_id,reward_entitlement_id,loyalty_program_id,reward_type,' +
  'benefit_type,benefit_amount_snapshot,status,created_at,consumed_at,released_at';

function entitlement(row: EntitlementDb): RewardEntitlementRow {
  return {
    id: row.id,
    companyId: row.company_id,
    customerId: row.customer_id,
    loyaltyAccountId: row.loyalty_account_id,
    loyaltyProgramId: row.loyalty_program_id,
    rewardType: row.reward_type,
    status: row.status,
    issuedAt: new Date(row.issued_at),
    expiresAt: row.expires_at === null ? null : new Date(row.expires_at),
    redeemedAt: row.redeemed_at === null ? null : new Date(row.redeemed_at),
    redeemedBy: row.redeemed_by,
    redeemedBranchId: row.redeemed_branch_id,
    revokedAt: row.revoked_at === null ? null : new Date(row.revoked_at),
    revokedBy: row.revoked_by,
    revokedReason: row.revoked_reason,
    sourceType: row.source_type,
    sourceLedgerEntryId: row.source_ledger_entry_id,
    cycleNumber: row.cycle_number,
    createdBy: row.created_by,
    version: BigInt(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
function token(row: TokenDb): RewardEntitlementTokenRow {
  return {
    id: row.id,
    companyId: row.company_id,
    rewardEntitlementId: row.reward_entitlement_id,
    token: row.token,
    status: row.status,
    createdAt: new Date(row.created_at),
    revokedAt: row.revoked_at === null ? null : new Date(row.revoked_at),
  };
}

export interface InsertEntitlementInput {
  id: string;
  companyId: string;
  customerId: string;
  loyaltyAccountId: string;
  loyaltyProgramId: string;
  rewardType: RewardType;
  expiresAt: Date | null;
  sourceType: RewardEntitlementSourceType;
  sourceLedgerEntryId: string | null;
  cycleNumber: number | null;
  createdBy: string;
  timestamp: Date;
}

export class RewardsRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async transaction<T>(callback: (client: RewardTransaction) => Promise<T>): Promise<T> {
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      const value = await callback(client);
      await client.query('commit');
      return value;
    } catch (error) {
      await client.query('rollback');
      throw this.mapDatabaseError(error);
    } finally {
      client.release();
    }
  }

  public async idempotent<T>(
    client: RewardTransaction,
    context: RewardMutationContext,
    operation: string,
    key: string,
    requestHash: string,
    decode: (value: unknown) => T,
    create: () => Promise<T & { id: string }>,
  ): Promise<{ value: T; replayed: boolean }> {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
      `${context.companyId}:${operation}:${key}`,
    ]);
    const existing = result<IdempotencyDb>(
      await client.query(
        `select request_hash,response_body from idempotency_keys where company_id=$1 and operation=$2 and key=$3`,
        [context.companyId, operation, key],
      ),
    ).rows[0];
    if (existing !== undefined) {
      if (existing.request_hash !== requestHash || existing.response_body === null)
        throw new RewardError('validation_error', 'The idempotency key was used with another request.');
      return { value: decode(existing.response_body), replayed: true };
    }
    const id = randomUUID();
    await client.query(
      `insert into idempotency_keys (id,company_id,key,operation,request_hash,expires_at,created_at)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [id, context.companyId, key, operation, requestHash, new Date(context.timestamp.getTime() + 86_400_000), context.timestamp],
    );
    const value = await create();
    await client.query(`update idempotency_keys set response_body=$1::jsonb where id=$2`, [
      JSON.stringify(value, jsonValue),
      id,
    ]);
    return { value, replayed: false };
  }

  public async auditAndPublish(
    client: RewardTransaction,
    context: RewardMutationContext,
    input: {
      action: string;
      resourceType: 'reward_entitlement';
      resourceId: string;
      eventType: string;
      version: bigint;
      payload: Readonly<Record<string, unknown>>;
      branchId?: string | null;
    },
  ): Promise<void> {
    await client.query(
      `insert into audit_log
       (id,company_id,actor_type,actor_id,action,entity_type,entity_id,request_id,correlation_id,metadata,occurred_at)
       values ($1,$2,'user',$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
      [
        randomUUID(),
        context.companyId,
        context.actorId,
        input.action,
        input.resourceType,
        input.resourceId,
        context.requestId,
        context.correlationId,
        // Part S — ids/status/branch only, never PII, never the raw token.
        JSON.stringify(input.payload, jsonValue),
        context.timestamp,
      ],
    );
    await client.query(
      `insert into outbox_events
       (event_id,company_id,branch_id,event_type,schema_version,aggregate_type,aggregate_id,aggregate_version,
        correlation_id,payload,occurred_at,available_at,created_at)
       values ($1,$2,$3,$4,1,$5,$6,$7,$8,$9::jsonb,$10,$10,$10)`,
      [
        randomUUID(),
        context.companyId,
        input.branchId ?? null,
        input.eventType,
        input.resourceType,
        input.resourceId,
        input.version.toString(),
        context.correlationId,
        JSON.stringify(input.payload, jsonValue),
        context.timestamp,
      ],
    );
  }

  // --- Entitlements --------------------------------------------------------

  /** `on conflict ... do nothing` on the per-cycle idempotent-issuance
   * index (Part G) — a retried/replayed settlement, or two concurrent
   * qualifying transactions racing the SAME cycle, return `null`; the
   * caller treats that as "already issued, nothing new to do", mirroring
   * `MembershipsRepository.insertMembership`/`LoyaltyRepository.
   * insertLedgerEntry`'s identical pattern exactly. */
  public async insertEntitlement(
    client: RewardTransaction,
    input: InsertEntitlementInput,
  ): Promise<RewardEntitlementRow | null> {
    const inserted = result<{ id: string }>(
      await client.query(
        `insert into reward_entitlements
         (id,company_id,customer_id,loyalty_account_id,loyalty_program_id,reward_type,status,issued_at,expires_at,
          source_type,source_ledger_entry_id,cycle_number,created_by,created_at,updated_at)
         values ($1,$2,$3,$4,$5,$6,'available',$7,$8,$9,$10,$11,$12,$7,$7)
         on conflict on constraint reward_entitlements_company_account_program_cycle_uq do nothing
         returning id`,
        [
          input.id,
          input.companyId,
          input.customerId,
          input.loyaltyAccountId,
          input.loyaltyProgramId,
          input.rewardType,
          input.timestamp,
          input.expiresAt,
          input.sourceType,
          input.sourceLedgerEntryId,
          input.cycleNumber,
          input.createdBy,
        ],
      ),
    ).rows[0];
    if (inserted === undefined) return null;
    return this.entitlement(client, input.companyId, inserted.id);
  }

  public async entitlement(
    client: RewardTransaction | null,
    companyId: string,
    id: string,
  ): Promise<RewardEntitlementRow | null> {
    const row = result<EntitlementDb>(
      await (client ?? this.database.pool).query(
        `select ${ENTITLEMENT_COLUMNS} from reward_entitlements where company_id=$1 and id=$2`,
        [companyId, id],
      ),
    ).rows[0];
    return row === undefined ? null : entitlement(row);
  }

  /** `for update` — the redeem/revoke row lock (Part J): defense-in-depth
   * beyond the idempotency-key mechanism alone, since two DIFFERENT
   * legitimate requests (different keys) racing to redeem the SAME
   * entitlement need a real lock, not just a hash comparison — mirrors
   * `PromotionsRepository.lockCouponByNormalizedCode`'s identical
   * "lock the bare row first" pattern. */
  public async lockEntitlement(
    client: RewardTransaction,
    companyId: string,
    id: string,
  ): Promise<RewardEntitlementRow | null> {
    const locked = result<{ id: string }>(
      await client.query(`select id from reward_entitlements where company_id=$1 and id=$2 for update`, [
        companyId,
        id,
      ]),
    ).rows[0];
    if (locked === undefined) return null;
    return this.entitlement(client, companyId, id);
  }

  public async entitlementsForCustomer(companyId: string, customerId: string): Promise<RewardEntitlementRow[]> {
    const rows = result<EntitlementDb>(
      await this.database.pool.query(
        `select ${ENTITLEMENT_COLUMNS} from reward_entitlements
         where company_id=$1 and customer_id=$2 order by issued_at desc`,
        [companyId, customerId],
      ),
    ).rows;
    return rows.map(entitlement);
  }

  public async markRedeemed(
    client: RewardTransaction,
    companyId: string,
    id: string,
    expectedVersion: bigint,
    fields: { redeemedBy: string; redeemedBranchId: string | null; timestamp: Date },
  ): Promise<RewardEntitlementRow> {
    const updated = result<{ id: string }>(
      await client.query(
        `update reward_entitlements
         set status='redeemed', redeemed_at=$1, redeemed_by=$2, redeemed_branch_id=$3, updated_at=$1, version=$4
         where company_id=$5 and id=$6 and version=$7
         returning id`,
        [
          fields.timestamp,
          fields.redeemedBy,
          fields.redeemedBranchId,
          (expectedVersion + 1n).toString(),
          companyId,
          id,
          expectedVersion.toString(),
        ],
      ),
    ).rows[0];
    if (updated === undefined) throw new RewardError('version_conflict', 'The reward entitlement was modified by another request.');
    const row = await this.entitlement(client, companyId, id);
    if (row === null) throw new Error('Reward redemption did not return a row.');
    return row;
  }

  public async markExpired(
    client: RewardTransaction,
    companyId: string,
    id: string,
    expectedVersion: bigint,
    timestamp: Date,
  ): Promise<RewardEntitlementRow> {
    const updated = result<{ id: string }>(
      await client.query(
        `update reward_entitlements set status='expired', updated_at=$1, version=$2
         where company_id=$3 and id=$4 and version=$5
         returning id`,
        [timestamp, (expectedVersion + 1n).toString(), companyId, id, expectedVersion.toString()],
      ),
    ).rows[0];
    if (updated === undefined) throw new RewardError('version_conflict', 'The reward entitlement was modified by another request.');
    const row = await this.entitlement(client, companyId, id);
    if (row === null) throw new Error('Reward expiry transition did not return a row.');
    return row;
  }

  public async markRevoked(
    client: RewardTransaction,
    companyId: string,
    id: string,
    expectedVersion: bigint,
    fields: { revokedBy: string; revokedReason: string; timestamp: Date },
  ): Promise<RewardEntitlementRow> {
    const updated = result<{ id: string }>(
      await client.query(
        `update reward_entitlements
         set status='revoked', revoked_at=$1, revoked_by=$2, revoked_reason=$3, updated_at=$1, version=$4
         where company_id=$5 and id=$6 and version=$7
         returning id`,
        [
          fields.timestamp,
          fields.revokedBy,
          fields.revokedReason,
          (expectedVersion + 1n).toString(),
          companyId,
          id,
          expectedVersion.toString(),
        ],
      ),
    ).rows[0];
    if (updated === undefined) throw new RewardError('version_conflict', 'The reward entitlement was modified by another request.');
    const row = await this.entitlement(client, companyId, id);
    if (row === null) throw new Error('Reward revocation did not return a row.');
    return row;
  }

  // --- Presentation tokens (Part L/X) ---------------------------------------

  public async issueToken(
    client: RewardTransaction,
    companyId: string,
    rewardEntitlementId: string,
    timestamp: Date,
  ): Promise<RewardEntitlementTokenRow> {
    await client.query(
      `update reward_entitlement_tokens set status='revoked', revoked_at=$3
       where company_id=$1 and reward_entitlement_id=$2 and status='active'`,
      [companyId, rewardEntitlementId, timestamp],
    );
    const id = randomUUID();
    const value = randomBytes(24).toString('base64url');
    await client.query(
      `insert into reward_entitlement_tokens (id,company_id,reward_entitlement_id,token,status,created_at)
       values ($1,$2,$3,$4,'active',$5)`,
      [id, companyId, rewardEntitlementId, value, timestamp],
    );
    const row = result<TokenDb>(
      await client.query(
        `select id,company_id,reward_entitlement_id,token,status,created_at,revoked_at
         from reward_entitlement_tokens where id=$1`,
        [id],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Reward token issuance did not return a row.');
    return token(row);
  }

  public async activeTokenForEntitlement(companyId: string, rewardEntitlementId: string): Promise<RewardEntitlementTokenRow | null> {
    const row = result<TokenDb>(
      await this.database.pool.query(
        `select id,company_id,reward_entitlement_id,token,status,created_at,revoked_at
         from reward_entitlement_tokens where company_id=$1 and reward_entitlement_id=$2 and status='active'`,
        [companyId, rewardEntitlementId],
      ),
    ).rows[0];
    return row === undefined ? null : token(row);
  }

  /** Server-side lookup by the opaque token alone — never company-scoped
   * in its `where` clause, exactly like `CustomersRepository.
   * customerByQrToken`; the caller re-derives the acting company from the
   * resolved row and rejects a cross-company scan explicitly. */
  public async entitlementByToken(tokenValue: string): Promise<RewardEntitlementTokenRow | null> {
    const row = result<TokenDb>(
      await this.database.pool.query(
        `select id,company_id,reward_entitlement_id,token,status,created_at,revoked_at
         from reward_entitlement_tokens where token=$1`,
        [tokenValue],
      ),
    ).rows[0];
    return row === undefined ? null : token(row);
  }

  // --- Sale reward usages (TASK 13.2, Part G/F) -----------------------------

  /** Called from `SalesService.createSale`, inside the SAME transaction
   * the Sale/`sale_items`/`sale_discounts` rows are written in — an
   * `on conflict do nothing` on `sale_reward_usages_company_sale_uq`
   * makes a retried/replayed sale-creation request safe (never a second
   * usage row for the same Sale). Deliberately does NOT lock or mutate
   * `reward_entitlements` at all (Part D: "Sale creation... still does
   * NOT mark redeemed merely because sale exists") — this row only
   * records INTENT; consumption happens exclusively at settlement via
   * `consumeAppliedUsagesForSale` below. */
  public async insertSaleRewardUsage(
    client: RewardTransaction,
    input: {
      id: string;
      companyId: string;
      branchId: string;
      saleId: string;
      saleItemId: string;
      rewardEntitlementId: string;
      loyaltyProgramId: string;
      // Deliberately `string`, not the closed `RewardType` union — this
      // snapshot's real validation is the DB's own `sale_reward_usages_
      // reward_type_ck`, matching `benefitType` below (this call site's
      // caller, `SalesService.createSale`, only ever has a
      // `RewardBenefitCandidate.rewardType: string` to hand it — see
      // that type's own doc comment for why `promotions.types.ts` stays
      // decoupled from `rewards.types.ts`'s closed enum).
      rewardType: string;
      benefitType: string;
      benefitAmountSnapshot: string;
      timestamp: Date;
    },
  ): Promise<SaleRewardUsageRow | null> {
    const inserted = result<{ id: string }>(
      await client.query(
        `insert into sale_reward_usages
         (id,company_id,branch_id,sale_id,sale_item_id,reward_entitlement_id,loyalty_program_id,reward_type,
          benefit_type,benefit_amount_snapshot,status,created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'applied',$11)
         on conflict on constraint sale_reward_usages_company_sale_uq do nothing
         returning id`,
        [
          input.id,
          input.companyId,
          input.branchId,
          input.saleId,
          input.saleItemId,
          input.rewardEntitlementId,
          input.loyaltyProgramId,
          input.rewardType,
          input.benefitType,
          input.benefitAmountSnapshot,
          input.timestamp,
        ],
      ),
    ).rows[0];
    if (inserted === undefined) return null;
    const row = result<SaleRewardUsageDb>(
      await client.query(`select ${SALE_REWARD_USAGE_COLUMNS} from sale_reward_usages where id=$1`, [inserted.id]),
    ).rows[0];
    return row === undefined ? null : saleRewardUsage(row);
  }

  /** Read-only, no lock — a Sale's own attached-reward preview (Customer
   * Detail / receipt / Sales History all read this), never the
   * settlement-authoritative path itself. */
  public async saleRewardUsageForSale(companyId: string, saleId: string): Promise<SaleRewardUsageRow | null> {
    const row = result<SaleRewardUsageDb>(
      await this.database.pool.query(
        `select ${SALE_REWARD_USAGE_COLUMNS} from sale_reward_usages where company_id=$1 and sale_id=$2`,
        [companyId, saleId],
      ),
    ).rows[0];
    return row === undefined ? null : saleRewardUsage(row);
  }

  /** Every `status='applied'` usage row for this Sale, locked — the
   * settlement-time lookup `RewardsService.consumeAppliedUsagesForSale`
   * drives. `for update` on the usage row itself (defense-in-depth
   * alongside the entitlement's own row lock — two different Sales can
   * never both transition the SAME usage row, though in practice each
   * Sale only ever has its own). */
  public async lockAppliedUsagesForSale(client: RewardTransaction, companyId: string, saleId: string): Promise<SaleRewardUsageRow[]> {
    const rows = result<SaleRewardUsageDb>(
      await client.query(
        `select ${SALE_REWARD_USAGE_COLUMNS} from sale_reward_usages
         where company_id=$1 and sale_id=$2 and status='applied' for update`,
        [companyId, saleId],
      ),
    ).rows;
    return rows.map(saleRewardUsage);
  }

  public async markSaleRewardUsageConsumed(client: RewardTransaction, companyId: string, id: string, timestamp: Date): Promise<void> {
    await client.query(
      `update sale_reward_usages set status='consumed', consumed_at=$1 where company_id=$2 and id=$3 and status='applied'`,
      [timestamp, companyId, id],
    );
  }

  /** Cancellation release (Part D/L — mirrors `PromotionsRepository.
   * deleteCouponRedemptionsForSale`'s identical "free the reservation,
   * never touch the frozen arithmetic snapshot" shape exactly): only
   * ever touches STILL-`applied` rows — a `consumed` usage belongs to a
   * Sale that already genuinely settled and can never be cancelled
   * (the Sale state machine itself forbids `completed → cancelled`), so
   * this is always a safe, idempotent no-op for that case regardless. */
  public async releaseAppliedUsagesForSale(client: RewardTransaction, companyId: string, saleId: string, timestamp: Date): Promise<void> {
    await client.query(
      `update sale_reward_usages set status='released', released_at=$1 where company_id=$2 and sale_id=$3 and status='applied'`,
      [timestamp, companyId, saleId],
    );
  }

  private mapDatabaseError(error: unknown): unknown {
    if (constraint(error) === 'reward_entitlements_company_account_program_cycle_uq')
      return new RewardError('resource_conflict', 'This reward cycle was already issued.');
    return error;
  }
}
