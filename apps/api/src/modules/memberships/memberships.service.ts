import { createHash, randomUUID } from 'node:crypto';

import type { MembershipsRepository, MembershipTransaction } from './memberships.repository.js';
import {
  MembershipError,
  type CreateMembershipPlanInput,
  type CustomerMembershipRow,
  type MembershipMutationContext,
  type MembershipPlanRow,
  type MembershipValidationResult,
  type SaleSettlementContext,
} from './memberships.types.js';

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function nonBlank(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new MembershipError('validation_error', `The ${field} must not be blank.`);
  return trimmed;
}
function requirePermission(context: MembershipMutationContext, permission: string): void {
  if (!context.actorPermissions.includes(permission))
    throw new MembershipError('validation_error', `This actor is not authorized (${permission}).`);
}
function addDays(start: Date, days: number): Date {
  const result = new Date(start.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export class MembershipsService {
  public constructor(private readonly repository: MembershipsRepository) {}

  // --- Membership plans (Part J) ------------------------------------------

  public async createPlan(
    context: MembershipMutationContext,
    key: string,
    input: CreateMembershipPlanInput,
  ): Promise<{ value: MembershipPlanRow; replayed: boolean }> {
    requirePermission(context, 'membership.manage');
    const id = input.id ?? randomUUID();
    // Stable across a genuine retry: `input` already carries the CALLER's
    // own optional `id` — hashing the server-RESOLVED `id` instead would
    // make every retry that omitted `id` look like a different request
    // (a fresh random id every call) and reject as a key conflict rather
    // than replay.
    const requestHash = hash(input);
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'membership_plan.create',
        key,
        requestHash,
        (value) => value as MembershipPlanRow,
        async () => {
          const created = await this.repository.insertPlan(client, {
            id,
            companyId: context.companyId,
            name: nonBlank(input.name, 'name'),
            description: input.description?.trim() === undefined || input.description.trim().length === 0 ? null : input.description.trim(),
            active: input.active ?? true,
            productId: input.productId ?? null,
            durationDays: input.durationDays ?? null,
            benefitDescription:
              input.benefitDescription?.trim() === undefined || input.benefitDescription.trim().length === 0
                ? null
                : input.benefitDescription.trim(),
            branchIds: input.branchIds ?? [],
            createdBy: context.actorId,
            timestamp: context.timestamp,
          });
          await this.repository.auditAndPublish(client, context, {
            action: 'membership_plan.created',
            resourceType: 'membership_plan',
            resourceId: created.id,
            eventType: 'membership_plan.created',
            version: created.version,
            payload: { membership_plan_id: created.id, active: created.active },
          });
          return created;
        },
      ),
    );
  }

  public async updatePlan(
    context: MembershipMutationContext,
    id: string,
    expectedVersion: bigint,
    input: Partial<CreateMembershipPlanInput>,
  ): Promise<MembershipPlanRow> {
    requirePermission(context, 'membership.manage');
    return this.repository.transaction(async (client) => {
      const updated = await this.repository.updatePlan(client, context.companyId, id, expectedVersion, {
        ...(input.name === undefined ? {} : { name: nonBlank(input.name, 'name') }),
        ...(input.description === undefined
          ? {}
          : { description: input.description.trim().length === 0 ? null : input.description.trim() }),
        ...(input.active === undefined ? {} : { active: input.active }),
        ...(input.productId === undefined ? {} : { productId: input.productId }),
        ...(input.durationDays === undefined ? {} : { durationDays: input.durationDays }),
        ...(input.benefitDescription === undefined
          ? {}
          : { benefitDescription: input.benefitDescription.trim().length === 0 ? null : input.benefitDescription.trim() }),
        ...(input.branchIds === undefined ? {} : { branchIds: input.branchIds }),
        updatedBy: context.actorId,
        timestamp: context.timestamp,
      });
      await this.repository.auditAndPublish(client, context, {
        action: 'membership_plan.updated',
        resourceType: 'membership_plan',
        resourceId: updated.id,
        eventType: 'membership_plan.updated',
        version: updated.version,
        payload: { membership_plan_id: updated.id, active: updated.active },
      });
      return updated;
    });
  }

  public async plan(context: { companyId: string; actorPermissions: readonly string[] }, id: string): Promise<MembershipPlanRow> {
    requirePermission(context as MembershipMutationContext, 'membership.read');
    const row = await this.repository.plan(null, context.companyId, id);
    if (row === null) throw new MembershipError('resource_not_found', 'The membership plan was not found.');
    return row;
  }

  public async listPlans(
    context: { companyId: string; actorPermissions: readonly string[] },
    active: boolean | null,
  ): Promise<MembershipPlanRow[]> {
    requirePermission(context as MembershipMutationContext, 'membership.read');
    return this.repository.listPlans(context.companyId, active);
  }

  // --- Customer memberships (Part K/L/M/N) --------------------------------

  public async membershipsForCustomer(
    context: { companyId: string; actorPermissions: readonly string[] },
    customerId: string,
  ): Promise<CustomerMembershipRow[]> {
    requirePermission(context as MembershipMutationContext, 'membership.read');
    return this.repository.membershipsForCustomer(context.companyId, customerId);
  }

  /** Admin-issued membership, NOT sold through a Sale — e.g. a
   * complimentary/manual grant. `starts_at` in the future lands as
   * `'pending'`; `starts_at` now-or-earlier lands directly `'active'` —
   * the only two states a fresh issuance can ever begin in (Part K). */
  public async issueMembership(
    context: MembershipMutationContext,
    key: string,
    input: { customerId: string; membershipPlanId: string; startsAt?: Date },
  ): Promise<{ value: CustomerMembershipRow; replayed: boolean }> {
    requirePermission(context, 'membership.issue');
    const id = randomUUID();
    // `id` is always server-generated for this entity (no client-supplied
    // id exists) — never part of the hash, for the same reason as above.
    const requestHash = hash({ ...input, startsAt: input.startsAt?.toISOString() });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'customer_membership.issue',
        key,
        requestHash,
        (value) => value as CustomerMembershipRow,
        async () => {
          const plan = await this.repository.plan(client, context.companyId, input.membershipPlanId);
          if (plan === null) throw new MembershipError('resource_not_found', 'The membership plan was not found.');
          if (!plan.active) throw new MembershipError('membership_plan_inactive', 'The membership plan is not active.');
          const startsAt = input.startsAt ?? context.timestamp;
          const expiresAt = plan.durationDays === null ? null : addDays(startsAt, plan.durationDays);
          const status = startsAt.getTime() <= context.timestamp.getTime() ? 'active' : 'pending';
          const created = await this.repository.insertMembership(client, {
            id,
            companyId: context.companyId,
            customerId: input.customerId,
            membershipPlanId: input.membershipPlanId,
            membershipNumber: this.repository.generateMembershipNumber(),
            status,
            startsAt,
            expiresAt,
            issuedAt: context.timestamp,
            sourceSaleId: null,
            renewedFromMembershipId: null,
            createdBy: context.actorId,
            timestamp: context.timestamp,
          });
          if (created === null) throw new Error('Manual membership issuance unexpectedly conflicted.');
          await this.repository.auditAndPublish(client, context, {
            action: 'customer_membership.issued',
            resourceType: 'customer_membership',
            resourceId: created.id,
            eventType: 'membership.activated',
            version: 1n,
            payload: { customer_membership_id: created.id, customer_id: created.customerId, status: created.status },
          });
          return created;
        },
      ),
    );
  }

  public async cancelMembership(
    context: MembershipMutationContext,
    id: string,
    expectedVersion: bigint,
    reason: string,
  ): Promise<CustomerMembershipRow> {
    requirePermission(context, 'membership.manage');
    return this.repository.transaction(async (client) => {
      const current = await this.repository.lockMembership(client, context.companyId, id);
      if (current === null) throw new MembershipError('resource_not_found', 'The membership was not found.');
      if (current.status === 'cancelled') return current;
      const updated = await this.repository.updateMembershipStatus(client, context.companyId, id, expectedVersion, {
        status: 'cancelled',
        cancelledAt: context.timestamp,
        cancelledReason: nonBlank(reason, 'cancellation reason'),
        timestamp: context.timestamp,
      });
      await this.repository.auditAndPublish(client, context, {
        action: 'customer_membership.cancelled',
        resourceType: 'customer_membership',
        resourceId: updated.id,
        eventType: 'membership.cancelled',
        version: updated.version,
        payload: { customer_membership_id: updated.id, customer_id: updated.customerId },
      });
      return updated;
    });
  }

  /** Part M — renewal creates a NEW row (never mutates the existing one's
   * `expires_at` in place), chained via `renewed_from_membership_id`. The
   * new period starts at the OLD membership's `expires_at` if it hasn't
   * lapsed yet, or `now` if it already has — never a gap-free assumption
   * that would silently grant free extra days, and never negative-length
   * either way (see ADR-0017 "Renewal"). */
  public async renewMembership(
    context: MembershipMutationContext,
    key: string,
    membershipId: string,
  ): Promise<{ value: CustomerMembershipRow; replayed: boolean }> {
    requirePermission(context, 'membership.issue');
    const newId = randomUUID();
    // `newId` is the fresh row this call would create — never part of the
    // hash; `membershipId` (what the caller actually asked to renew) is
    // the only thing that must stay stable across a genuine retry.
    const requestHash = hash({ membershipId });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'customer_membership.renew',
        key,
        requestHash,
        (value) => value as CustomerMembershipRow,
        async () => {
          const existing = await this.repository.membership(client, context.companyId, membershipId);
          if (existing === null) throw new MembershipError('resource_not_found', 'The membership was not found.');
          if (existing.status === 'cancelled')
            throw new MembershipError('membership_not_active', 'A cancelled membership cannot be renewed.');
          const plan = await this.repository.plan(client, context.companyId, existing.membershipPlanId);
          if (plan === null) throw new MembershipError('resource_not_found', 'The membership plan was not found.');
          const startsAt =
            existing.expiresAt !== null && existing.expiresAt.getTime() > context.timestamp.getTime()
              ? existing.expiresAt
              : context.timestamp;
          const expiresAt = plan.durationDays === null ? null : addDays(startsAt, plan.durationDays);
          const created = await this.repository.insertMembership(client, {
            id: newId,
            companyId: context.companyId,
            customerId: existing.customerId,
            membershipPlanId: existing.membershipPlanId,
            membershipNumber: this.repository.generateMembershipNumber(),
            status: 'active',
            startsAt,
            expiresAt,
            issuedAt: context.timestamp,
            sourceSaleId: null,
            renewedFromMembershipId: existing.id,
            createdBy: context.actorId,
            timestamp: context.timestamp,
          });
          if (created === null) throw new Error('Membership renewal unexpectedly conflicted.');
          await this.repository.auditAndPublish(client, context, {
            action: 'customer_membership.renewed',
            resourceType: 'customer_membership',
            resourceId: created.id,
            eventType: 'membership.activated',
            version: 1n,
            payload: {
              customer_membership_id: created.id,
              customer_id: created.customerId,
              renewed_from_membership_id: existing.id,
            },
          });
          return created;
        },
      ),
    );
  }

  /** Part N — server-authoritative validation. Flutter NEVER decides
   * membership validity itself; this is the one place that decision is
   * made. */
  public async validate(
    context: { companyId: string; actorPermissions: readonly string[] },
    customerId: string,
    branchId: string,
    now: Date,
  ): Promise<MembershipValidationResult> {
    requirePermission(context as MembershipMutationContext, 'membership.read');
    const memberships = await this.repository.membershipsForCustomer(context.companyId, customerId);
    for (const membership of memberships) {
      if (membership.status !== 'active') continue;
      if (membership.startsAt.getTime() > now.getTime()) continue;
      if (membership.expiresAt !== null && membership.expiresAt.getTime() <= now.getTime()) continue;
      const plan = await this.repository.plan(null, context.companyId, membership.membershipPlanId);
      const eligibleBranch = plan === null || plan.branchIds.length === 0 || plan.branchIds.includes(branchId);
      if (!eligibleBranch) continue;
      return { valid: true, reason: null, membership, eligibleBranch: true };
    }
    return { valid: false, reason: 'no_active_membership', membership: null, eligibleBranch: false };
  }

  // --- Sale settlement hook (Part L) --------------------------------------

  /** Called from `PaymentsService`, inside the SAME transaction
   * `SalesRepository.trySettleSale` used to newly settle the Sale — never
   * at sale-creation time (Part K: "no activation before payment" is
   * structural, not a runtime check). Returns `null` when nothing to do
   * (no customer attached, or no sold product backs an active plan) or
   * when a retried settlement finds the membership already issued
   * (idempotent — see `MembershipsRepository.insertMembership`'s own
   * `on conflict do nothing`). */
  public async activateFromSale(
    client: MembershipTransaction,
    context: SaleSettlementContext,
  ): Promise<CustomerMembershipRow | null> {
    if (context.customerId === null) return null;
    for (const productId of context.productIds) {
      const plan = await this.repository.planByProductId(context.companyId, productId);
      if (!plan?.active) continue;
      if (plan.branchIds.length > 0 && !plan.branchIds.includes(context.branchId)) continue;
      const startsAt = context.timestamp;
      const expiresAt = plan.durationDays === null ? null : addDays(startsAt, plan.durationDays);
      const created = await this.repository.insertMembership(client, {
        id: randomUUID(),
        companyId: context.companyId,
        customerId: context.customerId,
        membershipPlanId: plan.id,
        membershipNumber: this.repository.generateMembershipNumber(),
        status: 'active',
        startsAt,
        expiresAt,
        issuedAt: context.timestamp,
        sourceSaleId: context.saleId,
        renewedFromMembershipId: null,
        createdBy: context.actorId,
        timestamp: context.timestamp,
      });
      if (created === null) return null;
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
          action: 'customer_membership.activated',
          resourceType: 'customer_membership',
          resourceId: created.id,
          eventType: 'membership.activated',
          version: 1n,
          payload: {
            customer_membership_id: created.id,
            customer_id: created.customerId,
            source_sale_id: context.saleId,
          },
        },
      );
      return created;
    }
    return null;
  }
}
