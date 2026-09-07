import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

import { ivaBasisPointsForTaxCode, type ProductTaxCode } from '@asone/database';

import { applyBasisPoints, evaluatePricing, formatMoney, parseQuantityUnits } from './pricing.service.js';
import type { CreatePromotionInput, PromotionsRepository } from './promotions.repository.js';
import {
  PromotionError,
  type CouponBenefitType,
  type CouponRow,
  type PricingLineInput,
  type PricingManualDiscountInput,
  type PricingResult,
  type PromotionBenefitType,
  type PromotionMutationContext,
  type PromotionRow,
} from './promotions.types.js';

function hash(value: object): string {
  return createHash('sha256')
    .update(JSON.stringify(Object.fromEntries(Object.entries(value).sort())))
    .digest('hex');
}
function nonBlank(value: string, field: string): string {
  const clean = value.trim();
  if (clean.length === 0) throw new PromotionError('validation_error', `${field} cannot be blank.`);
  if (clean.length > 200) throw new PromotionError('validation_error', `${field} is too long.`);
  return clean;
}

// TASK 13.1A — real idempotent-replay decoders, replacing the bare
// `as ...Row` casts these two `idempotent()` calls used before. A
// replayed value is decoded from `idempotency_keys.response_body` (real
// JSON, from a prior `JSON.stringify(value)` of the exact camelCase
// `PromotionRow`/`CouponRow` `create()` returned), where every `Date`
// field is already an ISO STRING and `version` a decimal string — a
// bare cast left the declared `Date`/`bigint` types lying about the
// runtime shape, and the first `.toISOString()` call downstream
// (`promotionHttp`/`couponHttp`) would throw on any replayed create.
// `promotions.repository.ts` had its own unused, dead `decodePromotion`/
// `decodeCoupon` pair already — removed here rather than wired in: they
// cast to the snake_case `PromotionDb`/`CouponDb` DB-row shape, which is
// NOT what `idempotent()` actually persists (the camelCase Row `create()`
// returns), so using them as-is would have silently produced a
// mis-mapped row (e.g. `companyId: undefined`) instead of merely
// leaving Dates as strings — a different, worse bug. These two below
// decode the ACTUAL persisted (camelCase) shape correctly, mirroring
// every sibling module's own local decoder in this same pass
// (`customers.service.ts`, `loyalty.service.ts`,
// `memberships.service.ts`) and `promotion()`'s/`coupon()`'s own
// `new Date(...)` DB-row reconstruction. See ADR-0018 (rewards) for the
// original bug/fix this generalizes.
function decodePromotion(value: unknown): PromotionRow {
  const row = value as Omit<PromotionRow, 'version' | 'createdAt' | 'updatedAt' | 'startsAt' | 'endsAt'> & {
    version: string;
    createdAt: string;
    updatedAt: string;
    startsAt: string | null;
    endsAt: string | null;
  };
  return {
    ...row,
    version: BigInt(row.version),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    startsAt: row.startsAt === null ? null : new Date(row.startsAt),
    endsAt: row.endsAt === null ? null : new Date(row.endsAt),
  };
}
function decodeCoupon(value: unknown): CouponRow {
  const row = value as Omit<CouponRow, 'version' | 'createdAt' | 'updatedAt' | 'startsAt' | 'endsAt'> & {
    version: string;
    createdAt: string;
    updatedAt: string;
    startsAt: string | null;
    endsAt: string | null;
  };
  return {
    ...row,
    version: BigInt(row.version),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    startsAt: row.startsAt === null ? null : new Date(row.startsAt),
    endsAt: row.endsAt === null ? null : new Date(row.endsAt),
  };
}

export interface PromotionScopeInput {
  branchIds?: readonly string[];
  productIds?: readonly string[];
  categoryIds?: readonly string[];
}

export interface CreatePromotionServiceInput {
  id?: string;
  name: string;
  description?: string;
  active?: boolean;
  startsAt?: Date;
  endsAt?: Date;
  daysOfWeek?: readonly number[];
  timeFrom?: string;
  timeTo?: string;
  priority?: number;
  stackable?: boolean;
  benefitType: PromotionBenefitType;
  benefitPercentageBasisPoints?: number;
  benefitFixedAmount?: string;
  benefitNxmBuyQuantity?: number;
  benefitNxmPayQuantity?: number;
  minQuantity?: string;
  minSubtotal?: string;
  usageLimitTotal?: number;
  combinableWithCoupons?: boolean;
  branchIds?: readonly string[];
  productIds?: readonly string[];
  categoryIds?: readonly string[];
}

export interface CreateCouponServiceInput {
  id?: string;
  code: string;
  description?: string;
  benefitType: CouponBenefitType;
  benefitPercentageBasisPoints?: number;
  benefitFixedAmount?: string;
  active?: boolean;
  startsAt?: Date;
  endsAt?: Date;
  minSubtotal?: string;
  usageLimitTotal?: number;
  promotionId?: string;
}

export interface QuoteInput {
  branchId: string;
  items: readonly PricingLineInput[];
  couponCodes?: readonly string[];
  manualDiscount?: PricingManualDiscountInput;
}

export class PromotionsService {
  public constructor(private readonly repository: PromotionsRepository) {}

  // --- Admin: promotions -----------------------------------------------

  public async createPromotion(
    context: PromotionMutationContext,
    key: string,
    input: CreatePromotionServiceInput,
  ): Promise<{ value: PromotionRow; replayed: boolean }> {
    if (!context.actorPermissions.includes('promotion.manage'))
      throw new PromotionError('validation_error', 'This actor is not authorized to manage promotions.');
    const id = input.id ?? randomUUID();
    // TASK 13.1A — hash the CALLER-supplied `id` (`input.id ?? null`),
    // never the server-RESOLVED one: `id` above is a fresh random UUID
    // on every call whenever the caller omits `id`, so hashing it made a
    // genuine same-key replay of the identical logical request look like
    // a brand-new, "different" request every time — a real idempotency
    // bug (found via TASK 13.1A's own HTTP replay test), matching the
    // exact class ADR-0017 D14 already found and fixed once in this
    // codebase's `customers`/`memberships`/`loyalty` services; this call
    // was missed then. Mirrors `SalesService.createSale`'s own already-
    // correct `hash({ ..., id: input.id ?? null })` convention.
    const requestHash = hash({ id: input.id ?? null, input });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'promotion.create',
        key,
        requestHash,
        decodePromotion,
        async () => {
          const created = await this.repository.insertPromotion(client, {
            id,
            companyId: context.companyId,
            name: nonBlank(input.name, 'name'),
            description: input.description?.trim() ?? null,
            active: input.active ?? true,
            startsAt: input.startsAt ?? null,
            endsAt: input.endsAt ?? null,
            daysOfWeek: input.daysOfWeek ?? null,
            timeFrom: input.timeFrom ?? null,
            timeTo: input.timeTo ?? null,
            priority: input.priority ?? 0,
            stackable: input.stackable ?? false,
            benefitType: input.benefitType,
            benefitPercentageBasisPoints: input.benefitPercentageBasisPoints ?? null,
            benefitFixedAmount: input.benefitFixedAmount ?? null,
            benefitNxmBuyQuantity: input.benefitNxmBuyQuantity ?? null,
            benefitNxmPayQuantity: input.benefitNxmPayQuantity ?? null,
            minQuantity: input.minQuantity ?? null,
            minSubtotal: input.minSubtotal ?? null,
            usageLimitTotal: input.usageLimitTotal ?? null,
            combinableWithCoupons: input.combinableWithCoupons ?? true,
            branchIds: input.branchIds ?? [],
            productIds: input.productIds ?? [],
            categoryIds: input.categoryIds ?? [],
            createdBy: context.actorId,
            timestamp: context.timestamp,
          } satisfies CreatePromotionInput);
          await this.repository.auditAndPublish(client, context, {
            action: 'promotion.created',
            resourceType: 'promotion',
            resourceId: created.id,
            eventType: 'promotion.created',
            version: created.version,
            payload: { id: created.id, name: created.name, active: created.active },
          });
          return created;
        },
      ),
    );
  }

  public async updatePromotion(
    context: PromotionMutationContext,
    id: string,
    expectedVersion: bigint,
    input: Partial<CreatePromotionServiceInput>,
  ): Promise<PromotionRow> {
    if (!context.actorPermissions.includes('promotion.manage'))
      throw new PromotionError('validation_error', 'This actor is not authorized to manage promotions.');
    return this.repository.transaction(async (client) => {
      const updated = await this.repository.updatePromotion(client, context.companyId, id, expectedVersion, {
        ...(input.name === undefined ? {} : { name: nonBlank(input.name, 'name') }),
        ...(input.description === undefined
          ? {}
          : { description: input.description.trim().length === 0 ? null : input.description.trim() }),
        ...(input.active === undefined ? {} : { active: input.active }),
        ...(input.startsAt === undefined ? {} : { startsAt: input.startsAt }),
        ...(input.endsAt === undefined ? {} : { endsAt: input.endsAt }),
        ...(input.daysOfWeek === undefined ? {} : { daysOfWeek: input.daysOfWeek }),
        ...(input.timeFrom === undefined ? {} : { timeFrom: input.timeFrom }),
        ...(input.timeTo === undefined ? {} : { timeTo: input.timeTo }),
        ...(input.priority === undefined ? {} : { priority: input.priority }),
        ...(input.stackable === undefined ? {} : { stackable: input.stackable }),
        ...(input.benefitType === undefined ? {} : { benefitType: input.benefitType }),
        ...(input.benefitPercentageBasisPoints === undefined
          ? {}
          : { benefitPercentageBasisPoints: input.benefitPercentageBasisPoints }),
        ...(input.benefitFixedAmount === undefined ? {} : { benefitFixedAmount: input.benefitFixedAmount }),
        ...(input.benefitNxmBuyQuantity === undefined ? {} : { benefitNxmBuyQuantity: input.benefitNxmBuyQuantity }),
        ...(input.benefitNxmPayQuantity === undefined ? {} : { benefitNxmPayQuantity: input.benefitNxmPayQuantity }),
        ...(input.minQuantity === undefined ? {} : { minQuantity: input.minQuantity }),
        ...(input.minSubtotal === undefined ? {} : { minSubtotal: input.minSubtotal }),
        ...(input.usageLimitTotal === undefined ? {} : { usageLimitTotal: input.usageLimitTotal }),
        ...(input.combinableWithCoupons === undefined ? {} : { combinableWithCoupons: input.combinableWithCoupons }),
        ...(input.branchIds === undefined ? {} : { branchIds: input.branchIds }),
        ...(input.productIds === undefined ? {} : { productIds: input.productIds }),
        ...(input.categoryIds === undefined ? {} : { categoryIds: input.categoryIds }),
        updatedBy: context.actorId,
        timestamp: context.timestamp,
      });
      await this.repository.auditAndPublish(client, context, {
        action: 'promotion.updated',
        resourceType: 'promotion',
        resourceId: updated.id,
        eventType: 'promotion.updated',
        version: updated.version,
        payload: { id: updated.id, name: updated.name, active: updated.active },
      });
      return updated;
    });
  }

  public async promotion(companyId: string, id: string): Promise<PromotionRow> {
    const found = await this.repository.promotion(companyId, id);
    if (found === null) throw new PromotionError('resource_not_found', 'The promotion was not found.');
    return found;
  }

  public listPromotions(
    companyId: string,
    input: { cursor?: string; limit: number; active?: boolean },
  ): ReturnType<PromotionsRepository['listPromotions']> {
    return this.repository.listPromotions(companyId, input);
  }

  // --- Admin: coupons ----------------------------------------------------

  private normalizeCode(code: string): string {
    const normalized = code.trim().toUpperCase();
    if (normalized.length === 0 || normalized.length > 40)
      throw new PromotionError('validation_error', 'Coupon code must be 1-40 characters.');
    if (!/^[A-Z0-9_-]+$/u.test(normalized))
      throw new PromotionError('validation_error', 'Coupon code may only contain letters, digits, - and _.');
    return normalized;
  }

  public async createCoupon(
    context: PromotionMutationContext,
    key: string,
    input: CreateCouponServiceInput,
  ): Promise<{ value: CouponRow; replayed: boolean }> {
    if (!context.actorPermissions.includes('coupon.manage'))
      throw new PromotionError('validation_error', 'This actor is not authorized to manage coupons.');
    const id = input.id ?? randomUUID();
    const normalizedCode = this.normalizeCode(input.code);
    // TASK 13.1A — see the identical fix/comment on `createPromotion`
    // above: hash the caller-supplied `id` (`input.id ?? null`), never
    // the server-resolved one.
    const requestHash = hash({ id: input.id ?? null, input });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'coupon.create',
        key,
        requestHash,
        decodeCoupon,
        async () => {
          const created = await this.repository.insertCoupon(client, {
            id,
            companyId: context.companyId,
            code: input.code.trim(),
            normalizedCode,
            description: input.description?.trim() ?? null,
            benefitType: input.benefitType,
            benefitPercentageBasisPoints: input.benefitPercentageBasisPoints ?? null,
            benefitFixedAmount: input.benefitFixedAmount ?? null,
            active: input.active ?? true,
            startsAt: input.startsAt ?? null,
            endsAt: input.endsAt ?? null,
            minSubtotal: input.minSubtotal ?? null,
            usageLimitTotal: input.usageLimitTotal ?? null,
            promotionId: input.promotionId ?? null,
            createdBy: context.actorId,
            timestamp: context.timestamp,
          });
          await this.repository.auditAndPublish(client, context, {
            action: 'coupon.created',
            resourceType: 'coupon',
            resourceId: created.id,
            eventType: 'coupon.created',
            version: created.version,
            payload: { id: created.id, code: created.code, active: created.active },
          });
          return created;
        },
      ),
    );
  }

  public async updateCoupon(
    context: PromotionMutationContext,
    id: string,
    expectedVersion: bigint,
    input: {
      description?: string;
      active?: boolean;
      startsAt?: Date | null;
      endsAt?: Date | null;
      minSubtotal?: string | null;
      usageLimitTotal?: number | null;
    },
  ): Promise<CouponRow> {
    if (!context.actorPermissions.includes('coupon.manage'))
      throw new PromotionError('validation_error', 'This actor is not authorized to manage coupons.');
    return this.repository.transaction(async (client) => {
      const updated = await this.repository.updateCoupon(client, context.companyId, id, expectedVersion, {
        ...input,
        updatedBy: context.actorId,
        timestamp: context.timestamp,
      });
      await this.repository.auditAndPublish(client, context, {
        action: 'coupon.updated',
        resourceType: 'coupon',
        resourceId: updated.id,
        eventType: 'coupon.updated',
        version: updated.version,
        payload: { id: updated.id, code: updated.code, active: updated.active },
      });
      return updated;
    });
  }

  public async coupon(companyId: string, id: string): Promise<CouponRow> {
    const found = await this.repository.coupon(companyId, id);
    if (found === null) throw new PromotionError('resource_not_found', 'The coupon was not found.');
    return found;
  }

  public listCoupons(
    companyId: string,
    input: { cursor?: string; limit: number; active?: boolean },
  ): ReturnType<PromotionsRepository['listCoupons']> {
    return this.repository.listCoupons(companyId, input);
  }

  // --- Pricing quote/preview (E-PRICING-1) --------------------------------

  /** Server-authoritative pricing preview — resolves every line's real
   * price/tax/category, evaluates every active promotion, and evaluates
   * (but never redeems/consumes) any requested coupon. Never creates a
   * Sale, never writes a `coupon_redemptions` row, never increments
   * anything — a pure read (Part B). Real sale creation independently
   * repeats this exact evaluation (via the same `evaluatePricing`
   * engine, called directly from `sales.service.ts`) rather than
   * trusting whatever this returned — a quote is display-only evidence,
   * never authority (mirrors ADR-0009's "submitted snapshots are
   * evidence, not authority" for the exact same reason). */
  public async quote(
    context: PromotionMutationContext,
    branchIds: readonly string[],
    input: QuoteInput,
  ): Promise<PricingResult> {
    if (!branchIds.includes(input.branchId))
      throw new PromotionError('validation_error', 'The branch is not authorized for this actor.');
    if (input.items.length === 0) throw new PromotionError('validation_error', 'At least one item is required.');
    const timezone = await this.repository.branchTimezone(context.companyId, input.branchId);
    if (timezone === null) throw new PromotionError('resource_not_found', 'The branch was not found.');

    const productIds = [...new Set(input.items.map((item) => item.productId))];
    const resolved = await this.repository.resolveProductLinesReadOnly(context.companyId, input.branchId, productIds);
    const currencyCodes = new Set<string>();
    const lines = input.items.map((item, index) => {
      const product = resolved.get(item.productId);
      if (product === undefined)
        throw new PromotionError('resource_not_found', `items[${String(index)}].product_id was not found.`);
      if (product.price === null)
        throw new PromotionError('validation_error', `items[${String(index)}].product_id has no active price.`);
      currencyCodes.add(product.price.currencyCode);
      const quantityUnits = parseQuantityUnitsPositive(item.quantity, `items[${String(index)}].quantity`);
      const unitPriceUnits = moneyUnitsLocal(product.price.amount);
      const taxBasisPoints = ivaBasisPointsForTaxCode(product.taxCode as ProductTaxCode);
      const grossSubtotalUnits = (unitPriceUnits * quantityUnits + 500_000n) / 1_000_000n;
      return {
        lineIndex: index,
        productId: product.productId,
        productVariantId: product.variantId,
        productVersion: product.productVersion,
        categoryId: product.categoryId,
        skuSnapshot: product.skuSnapshot,
        nameSnapshot: product.name,
        quantity: item.quantity,
        quantityUnits,
        unitPriceUnits,
        taxCode: product.taxCode,
        taxBasisPoints,
        grossSubtotalUnits,
        discountUnits: 0n,
        discountBasisPoints: 0,
        netSubtotalUnits: grossSubtotalUnits,
        taxUnits: 0n,
        lineTotalUnits: grossSubtotalUnits,
      };
    });
    if (currencyCodes.size === 0)
      throw new PromotionError('validation_error', 'Could not resolve a currency.');
    if (currencyCodes.size > 1)
      throw new PromotionError('validation_error', 'All items must share the same currency.');
    const currencyCode = [...currencyCodes][0];
    if (currencyCode === undefined) throw new PromotionError('validation_error', 'Could not resolve a currency.');

    const promotions = await this.repository.activePromotions(context.companyId);
    const promotionCandidates = promotions.map((promotionRow) => ({
      promotion: promotionRow,
      scope: {
        branchIds: promotionRow.branchIds,
        productIds: promotionRow.productIds,
        categoryIds: promotionRow.categoryIds,
      },
    }));

    const couponCache = new Map<
      string,
      { coupon: CouponRow; branchEligible: boolean; redeemedCount: number } | null
    >();
    for (const rawCode of input.couponCodes ?? []) {
      const normalizedCode = rawCode.trim().toUpperCase();
      if (couponCache.has(normalizedCode)) continue;
      const couponRow = await this.repository.couponByNormalizedCode(context.companyId, normalizedCode);
      if (couponRow === null) {
        couponCache.set(normalizedCode, null);
        continue;
      }
      const redeemedCount = await this.repository.unlockedCouponRedemptionCount(context.companyId, couponRow.id);
      couponCache.set(normalizedCode, { coupon: couponRow, branchEligible: true, redeemedCount });
    }

    return evaluatePricing({
      branchId: input.branchId,
      branchTimezone: timezone,
      currencyCode,
      lines,
      promotionCandidates,
      couponLookup: (normalizedCode) => couponCache.get(normalizedCode) ?? null,
      requestedCouponCodes: input.couponCodes ?? [],
      ...(input.manualDiscount === undefined ? {} : { manualDiscount: input.manualDiscount }),
      actorPermissions: context.actorPermissions,
      now: context.timestamp,
    });
  }

}

// Local, minimal decimal helpers — mirrors the exact `sales.service.ts`
// convention of a small self-contained copy per module rather than a
// shared import (see that file's own comment on why).
const MONEY_SCALE = 10_000n;
function moneyUnitsLocal(value: string): bigint {
  const [whole = '', fraction = ''] = value.split('.');
  const wholeDigits = whole.length === 0 ? '0' : whole;
  const fractionDigits = fraction.padEnd(4, '0').slice(0, 4);
  return BigInt(wholeDigits) * MONEY_SCALE + BigInt(fractionDigits.length === 0 ? '0' : fractionDigits);
}
function parseQuantityUnitsPositive(value: string, field: string): bigint {
  const units = parseQuantityUnits(value, field);
  if (units <= 0n) throw new PromotionError('validation_error', `${field} must be greater than zero.`);
  return units;
}

export { applyBasisPoints, formatMoney };
