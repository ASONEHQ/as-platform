import { createHash, randomUUID } from 'node:crypto';

import type { LoyaltyRepository, LoyaltyTransaction } from './loyalty.repository.js';
import {
  LoyaltyError,
  type CreateLoyaltyProgramInput,
  type LoyaltyLedgerEntryRow,
  type LoyaltyMutationContext,
  type LoyaltyProgramRow,
  type LoyaltySummary,
  type SaleEarnContext,
  type SaleRefundReversalContext,
} from './loyalty.types.js';

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function nonBlank(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new LoyaltyError('validation_error', `The ${field} must not be blank.`);
  return trimmed;
}
function requirePermission(context: LoyaltyMutationContext, permission: string): void {
  if (!context.actorPermissions.includes(permission))
    throw new LoyaltyError('validation_error', `This actor is not authorized (${permission}).`);
}
function moneyUnits(value: string): bigint {
  const [whole = '', fraction = ''] = value.split('.');
  const wholeDigits = whole.length === 0 ? '0' : whole;
  const fractionDigits = fraction.padEnd(4, '0').slice(0, 4);
  return BigInt(wholeDigits) * 10_000n + BigInt(fractionDigits.length === 0 ? '0' : fractionDigits);
}

// TASK 13.1A — real idempotent-replay decoders, replacing the bare
// `as ...Row` casts these two `idempotent()` calls used before. A
// replayed value is decoded from `idempotency_keys.response_body` (real
// JSON, from a prior `JSON.stringify`), where every `Date` field is
// already an ISO STRING and `version` a decimal string — a bare cast
// left the declared `Date`/`bigint` types lying about the runtime
// shape, and the first `.toISOString()` call downstream (`programHttp`)
// would throw on any replayed program create. Mirrors `program()`'s/
// `ledgerEntry()`'s own DB-row reconstruction in `loyalty.repository.ts`
// — `new Date(...)` is correct whether fed a `Date` instance or an ISO
// string. See ADR-0018 (rewards) for the identical bug/fix; this is the
// same class, fixed across every other affected module in TASK 13.1A.
function decodeProgram(value: unknown): LoyaltyProgramRow {
  const row = value as Omit<LoyaltyProgramRow, 'version' | 'createdAt' | 'updatedAt'> & {
    version: string;
    createdAt: string;
    updatedAt: string;
  };
  return {
    ...row,
    version: BigInt(row.version),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}
function decodeLedgerEntry(value: unknown): LoyaltyLedgerEntryRow {
  const row = value as Omit<LoyaltyLedgerEntryRow, 'occurredAt' | 'createdAt'> & {
    occurredAt: string;
    createdAt: string;
  };
  return { ...row, occurredAt: new Date(row.occurredAt), createdAt: new Date(row.createdAt) };
}

export class LoyaltyService {
  public constructor(private readonly repository: LoyaltyRepository) {}

  // --- Program configuration (Part S) --------------------------------------

  public async createProgram(
    context: LoyaltyMutationContext,
    key: string,
    input: CreateLoyaltyProgramInput,
  ): Promise<{ value: LoyaltyProgramRow; replayed: boolean }> {
    requirePermission(context, 'loyalty.manage');
    const id = input.id ?? randomUUID();
    // TASK 13.1 (ADR-0018) — a threshold with no reward type would be an
    // "eligible for nothing" dead configuration; a type with no threshold
    // has no crossing to ever trigger it. Validated here (not only by the
    // DB's own `loyalty_programs_reward_pair_ck`) so the caller gets a
    // clean `validation_error`, not a raw constraint violation.
    if ((input.rewardThreshold === undefined) !== (input.rewardType === undefined))
      throw new LoyaltyError('validation_error', 'reward_threshold and reward_type must be set together.');
    // TASK 13.2 (ADR-0019 "Reward benefit model"/"Benefit scope") — a
    // benefit definition requires the reward itself, and requires an
    // EXPLICIT, non-empty scope; never inferred, never left implicit
    // (Part B: "do not make a VIP Pass silently discount an unrelated
    // product family"). Validated here (not only by the DB's own
    // `loyalty_programs_reward_benefit_requires_reward_ck`) for a clean
    // `validation_error`.
    if (input.rewardBenefitType !== undefined && input.rewardType === undefined)
      throw new LoyaltyError('validation_error', 'reward_benefit_type requires reward_type to already be set.');
    const scopeProductIds = input.rewardScopeProductIds ?? [];
    const scopeCategoryIds = input.rewardScopeCategoryIds ?? [];
    if (input.rewardBenefitType !== undefined && scopeProductIds.length === 0 && scopeCategoryIds.length === 0)
      throw new LoyaltyError(
        'validation_error',
        'A reward benefit requires at least one scoped product or category.',
      );
    // Stable across a genuine retry — see the identical reasoning in
    // `MembershipsService.createPlan`.
    const requestHash = hash(input);
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'loyalty_program.create',
        key,
        requestHash,
        decodeProgram,
        async () => {
          const created = await this.repository.insertProgram(client, {
            id,
            companyId: context.companyId,
            name: nonBlank(input.name, 'name'),
            // Part R — "no invisible business rule": a brand-new program
            // NEVER starts active by default, even if the caller omits
            // `active` entirely; a company must explicitly turn earning on.
            active: input.active ?? false,
            unitType: input.unitType,
            earnQuantityPerSale: input.earnQuantityPerSale ?? 1,
            minimumSaleTotal: input.minimumSaleTotal ?? null,
            rewardThreshold: input.rewardThreshold ?? null,
            rewardDescription:
              input.rewardDescription?.trim() === undefined || input.rewardDescription.trim().length === 0
                ? null
                : input.rewardDescription.trim(),
            rewardType: input.rewardType ?? null,
            rewardExpirationDays: input.rewardExpirationDays ?? null,
            // TASK 13.1 — defaults `true`: absent an explicit business
            // decision, treating each new threshold crossing as its own
            // qualifying cycle is the more useful default for a repeating
            // loyalty program; a company that wants a one-time reward sets
            // this `false` explicitly.
            rewardRepeatable: input.rewardRepeatable ?? true,
            rewardBenefitType: input.rewardBenefitType ?? null,
            rewardBenefitPercentageBasisPoints: input.rewardBenefitPercentageBasisPoints ?? null,
            rewardBenefitFixedAmount: input.rewardBenefitFixedAmount ?? null,
            createdBy: context.actorId,
            timestamp: context.timestamp,
          });
          await this.repository.replaceRewardScope(
            client,
            context.companyId,
            created.id,
            { productIds: scopeProductIds, categoryIds: scopeCategoryIds },
            context.timestamp,
          );
          const withScope = await this.repository.program(client, context.companyId, created.id);
          if (withScope === null) throw new Error('Loyalty program creation did not return a row.');
          await this.repository.auditAndPublish(client, context, {
            action: 'loyalty_program.created',
            resourceType: 'loyalty_program',
            resourceId: withScope.id,
            eventType: 'loyalty_program.created',
            version: withScope.version,
            payload: { loyalty_program_id: withScope.id, active: withScope.active },
          });
          return withScope;
        },
      ),
    );
  }

  public async updateProgram(
    context: LoyaltyMutationContext,
    id: string,
    expectedVersion: bigint,
    input: Partial<CreateLoyaltyProgramInput>,
  ): Promise<LoyaltyProgramRow> {
    requirePermission(context, 'loyalty.manage');
    return this.repository.transaction(async (client) => {
      const updated = await this.repository.updateProgram(client, context.companyId, id, expectedVersion, {
        ...(input.name === undefined ? {} : { name: nonBlank(input.name, 'name') }),
        ...(input.active === undefined ? {} : { active: input.active }),
        ...(input.unitType === undefined ? {} : { unitType: input.unitType }),
        ...(input.earnQuantityPerSale === undefined ? {} : { earnQuantityPerSale: input.earnQuantityPerSale }),
        ...(input.minimumSaleTotal === undefined ? {} : { minimumSaleTotal: input.minimumSaleTotal }),
        ...(input.rewardThreshold === undefined ? {} : { rewardThreshold: input.rewardThreshold }),
        ...(input.rewardDescription === undefined
          ? {}
          : { rewardDescription: input.rewardDescription.trim().length === 0 ? null : input.rewardDescription.trim() }),
        ...(input.rewardType === undefined ? {} : { rewardType: input.rewardType }),
        ...(input.rewardExpirationDays === undefined ? {} : { rewardExpirationDays: input.rewardExpirationDays }),
        ...(input.rewardRepeatable === undefined ? {} : { rewardRepeatable: input.rewardRepeatable }),
        ...(input.rewardBenefitType === undefined ? {} : { rewardBenefitType: input.rewardBenefitType }),
        ...(input.rewardBenefitPercentageBasisPoints === undefined
          ? {}
          : { rewardBenefitPercentageBasisPoints: input.rewardBenefitPercentageBasisPoints }),
        ...(input.rewardBenefitFixedAmount === undefined ? {} : { rewardBenefitFixedAmount: input.rewardBenefitFixedAmount }),
        updatedBy: context.actorId,
        timestamp: context.timestamp,
      });
      // TASK 13.2 (Part B) — scope is only ever touched when the caller
      // supplied AT LEAST ONE of the two arrays; supplying `[]` for a
      // dimension the caller wants cleared is a deliberate, explicit
      // choice (never inferred from omission). `undefined` for BOTH
      // means "leave the existing scope alone" (e.g. a plain `active`
      // toggle never has to re-supply scope every time).
      const finalScope =
        input.rewardScopeProductIds !== undefined || input.rewardScopeCategoryIds !== undefined
          ? { productIds: input.rewardScopeProductIds ?? [], categoryIds: input.rewardScopeCategoryIds ?? [] }
          : null;
      if (finalScope !== null) {
        if (
          (updated.rewardBenefitType !== null || input.rewardBenefitType !== undefined) &&
          finalScope.productIds.length === 0 &&
          finalScope.categoryIds.length === 0
        )
          throw new LoyaltyError('validation_error', 'A reward benefit requires at least one scoped product or category.');
        await this.repository.replaceRewardScope(client, context.companyId, id, finalScope, context.timestamp);
      }
      const withScope = await this.repository.program(client, context.companyId, id);
      if (withScope === null) throw new LoyaltyError('resource_not_found', 'The loyalty program was not found.');
      await this.repository.auditAndPublish(client, context, {
        action: 'loyalty_program.updated',
        resourceType: 'loyalty_program',
        resourceId: withScope.id,
        eventType: 'loyalty_program.updated',
        version: withScope.version,
        payload: { loyalty_program_id: withScope.id, active: withScope.active },
      });
      return withScope;
    });
  }

  public async program(context: { companyId: string; actorPermissions: readonly string[] }, id: string): Promise<LoyaltyProgramRow> {
    requirePermission(context as LoyaltyMutationContext, 'loyalty.read');
    const row = await this.repository.program(null, context.companyId, id);
    if (row === null) throw new LoyaltyError('resource_not_found', 'The loyalty program was not found.');
    return row;
  }

  public async listPrograms(
    context: { companyId: string; actorPermissions: readonly string[] },
    active: boolean | null,
  ): Promise<LoyaltyProgramRow[]> {
    requirePermission(context as LoyaltyMutationContext, 'loyalty.read');
    return this.repository.listPrograms(context.companyId, active);
  }

  // --- Customer-facing summary (Part P/Q/AG) -------------------------------

  public async summary(
    context: { companyId: string; actorPermissions: readonly string[] },
    customerId: string,
  ): Promise<LoyaltySummary> {
    requirePermission(context as LoyaltyMutationContext, 'loyalty.read');
    const account = await this.repository.accountByCustomerId(null, context.companyId, customerId);
    if (account === null) return { account: null, balances: [], ledger: [] };
    const [balances, ledger] = await Promise.all([
      this.repository.balances(context.companyId, account.id),
      this.repository.ledgerForAccount(context.companyId, account.id, 50),
    ]);
    return { account, balances, ledger };
  }

  // --- Manual adjustment (Part Q, separately permissioned per Part Y) -----

  public async adjust(
    context: LoyaltyMutationContext,
    key: string,
    input: { customerId: string; quantity: number; unitType: 'stamp' | 'point'; reason: string; loyaltyProgramId?: string },
  ): Promise<{ value: LoyaltyLedgerEntryRow; replayed: boolean }> {
    requirePermission(context, 'loyalty.adjust');
    if (input.quantity === 0) throw new LoyaltyError('validation_error', 'The adjustment quantity must not be zero.');
    const reason = nonBlank(input.reason, 'reason');
    const id = randomUUID();
    // `id` is always server-generated for a ledger entry — never part of
    // the hash, for the same reason as every sibling module above.
    const requestHash = hash(input);
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'loyalty_ledger.adjust',
        key,
        requestHash,
        decodeLedgerEntry,
        async () => {
          const account = await this.repository.getOrCreateAccount(client, context.companyId, input.customerId, context.timestamp);
          const entry = await this.repository.insertLedgerEntry(client, {
            id,
            companyId: context.companyId,
            loyaltyAccountId: account.id,
            loyaltyProgramId: input.loyaltyProgramId ?? null,
            branchId: null,
            entryType: 'adjustment',
            quantity: input.quantity,
            unitType: input.unitType,
            sourceType: 'manual',
            sourceId: null,
            reason,
            actorId: context.actorId,
            timestamp: context.timestamp,
          });
          if (entry === null) throw new Error('Manual loyalty adjustment unexpectedly conflicted.');
          await this.repository.auditAndPublish(client, context, {
            action: 'loyalty_ledger.adjusted',
            resourceType: 'loyalty_ledger_entry',
            resourceId: entry.id,
            eventType: 'loyalty.adjusted',
            version: 1n,
            payload: { customer_id: input.customerId, quantity: entry.quantity, unit_type: entry.unitType },
          });
          return entry;
        },
      ),
    );
  }

  // --- Sale settlement hook (Part R) ---------------------------------------

  /** Called from `PaymentsService`, inside the same transaction
   * `SalesRepository.trySettleSale` used to newly settle the Sale — never
   * on every Sale unconditionally (Part R: "do not automatically reward
   * every Sale unless eligibility is explicitly configured"). No active
   * program ⇒ no-op; no customer attached ⇒ no-op; below a program's own
   * `minimum_sale_total` ⇒ no-op for THAT program specifically. */
  public async earnFromSale(client: LoyaltyTransaction, context: SaleEarnContext): Promise<void> {
    if (context.customerId === null) return;
    const programs = await this.repository.activePrograms(context.companyId);
    if (programs.length === 0) return;
    const saleTotalUnits = moneyUnits(context.saleTotal);
    let account: Awaited<ReturnType<LoyaltyRepository['getOrCreateAccount']>> | null = null;
    for (const program of programs) {
      if (program.minimumSaleTotal !== null && saleTotalUnits < moneyUnits(program.minimumSaleTotal)) continue;
      account ??= await this.repository.getOrCreateAccount(client, context.companyId, context.customerId, context.timestamp);
      const entry = await this.repository.insertLedgerEntry(client, {
        id: randomUUID(),
        companyId: context.companyId,
        loyaltyAccountId: account.id,
        loyaltyProgramId: program.id,
        branchId: context.branchId,
        entryType: 'earn',
        quantity: program.earnQuantityPerSale,
        unitType: program.unitType,
        sourceType: 'sale',
        sourceId: context.saleId,
        reason: null,
        actorId: null,
        timestamp: context.timestamp,
      });
      if (entry === null) continue; // already earned for this sale/program — idempotent no-op.
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
          action: 'loyalty_ledger.earned',
          resourceType: 'loyalty_ledger_entry',
          resourceId: entry.id,
          eventType: 'loyalty.earned',
          version: 1n,
          payload: { customer_id: context.customerId, source_sale_id: context.saleId, quantity: entry.quantity, unit_type: entry.unitType },
        },
      );
    }
  }

  // --- Refund reversal hook (Phase 37, TASK 16.21) -------------------------

  /** Called from `RefundsService.completeRefund`, inside the SAME
   * transaction, and ONLY for a FULL refund of the originating sale
   * (Phase 37: "define visit-reversal semantics... a partial return
   * requires intentional per-line semantics this V1 does not attempt" —
   * a partial refund leaves loyalty earning untouched, mirroring how a
   * partial refund already leaves the original payment `captured` rather
   * than reversed). For every program that sale actually earned for,
   * inserts a NEW, negative-quantity `entry_type='earn'` row (never
   * mutates or deletes the original) — `source_type='refund'`,
   * `source_id=<refund id>`, a DIFFERENT tuple from the original sale's
   * own `(program, 'sale', saleId)` entry, so this can never collide
   * with it and is itself idempotent: a retried/replayed refund
   * completion inserts nothing new (Phase 37's "retry-safe" requirement,
   * same `on conflict ... do nothing` mechanism `earnFromSale` already
   * relies on). Reusing `entry_type='earn'` (rather than a new type)
   * keeps `cumulativeEarnedUnits`'s plain `SUM(quantity) where entry_type
   * ='earn'` correct automatically — a refunded sale's contribution
   * simply nets to zero, with no special-casing needed anywhere that
   * already reads that sum (in particular `RewardsService.
   * reverseIssuanceForRefund`, which runs immediately after this in the
   * same transaction and depends on seeing the POST-reversal total). */
  public async reverseEarnForRefund(client: LoyaltyTransaction, context: SaleRefundReversalContext): Promise<void> {
    const originals = await this.repository.earnEntriesForSale(client, context.companyId, context.saleId);
    for (const original of originals) {
      const entry = await this.repository.insertLedgerEntry(client, {
        id: randomUUID(),
        companyId: context.companyId,
        loyaltyAccountId: original.loyaltyAccountId,
        loyaltyProgramId: original.loyaltyProgramId,
        branchId: context.branchId,
        entryType: 'earn',
        quantity: -original.quantity,
        unitType: original.unitType,
        sourceType: 'refund',
        sourceId: context.refundId,
        reason: 'Reversal: the originating sale was refunded.',
        actorId: null,
        timestamp: context.timestamp,
      });
      if (entry === null) continue; // already reversed for this refund/program — idempotent no-op.
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
          action: 'loyalty_ledger.earn_reversed',
          resourceType: 'loyalty_ledger_entry',
          resourceId: entry.id,
          eventType: 'loyalty.earn_reversed',
          version: 1n,
          payload: {
            source_sale_id: context.saleId,
            refund_id: context.refundId,
            quantity: entry.quantity,
            unit_type: entry.unitType,
          },
        },
      );
    }
  }
}
