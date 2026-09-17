import { describe, expect, it } from 'vitest';

import type { CouponRow, PricingResolvedLine, PromotionRow, RewardBenefitCandidate } from './promotions.types.js';
import type { EvaluatePricingInput } from './pricing.service.js';
import { evaluatePricing, formatMoney, isValidIanaTimezone } from './pricing.service.js';

const BRANCH_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_BRANCH_ID = '00000000-0000-4000-8000-000000000002';
const TIMEZONE = 'America/Mexico_City';

function line(overrides: Partial<PricingResolvedLine> & { lineIndex: number }): PricingResolvedLine {
  const quantityUnits = overrides.quantityUnits ?? 1_000_000n;
  const unitPriceUnits = overrides.unitPriceUnits ?? 1_000_000n; // $100.0000
  const grossSubtotalUnits = overrides.grossSubtotalUnits ?? (unitPriceUnits * quantityUnits) / 1_000_000n;
  return {
    lineIndex: overrides.lineIndex,
    productId: overrides.productId ?? `product-${overrides.lineIndex.toString()}`,
    productVariantId: overrides.productVariantId ?? null,
    productVersion: overrides.productVersion ?? 1n,
    categoryId: overrides.categoryId ?? null,
    skuSnapshot: overrides.skuSnapshot ?? null,
    nameSnapshot: overrides.nameSnapshot ?? `Product ${overrides.lineIndex.toString()}`,
    quantity: overrides.quantity ?? '1.000000',
    quantityUnits,
    unitPriceUnits,
    taxCode: overrides.taxCode ?? 'IVA_GENERAL',
    taxBasisPoints: overrides.taxBasisPoints ?? 1600,
    grossSubtotalUnits,
    discountUnits: 0n,
    discountBasisPoints: 0,
    netSubtotalUnits: grossSubtotalUnits,
    taxUnits: 0n,
    lineTotalUnits: grossSubtotalUnits,
  };
}

function promotion(overrides: Partial<PromotionRow> = {}): PromotionRow {
  return {
    id: overrides.id ?? '00000000-0000-7000-8000-000000000010',
    companyId: 'company-1',
    name: overrides.name ?? 'Test promo',
    description: null,
    active: overrides.active ?? true,
    startsAt: overrides.startsAt ?? null,
    endsAt: overrides.endsAt ?? null,
    daysOfWeek: overrides.daysOfWeek ?? null,
    timeFrom: overrides.timeFrom ?? null,
    timeTo: overrides.timeTo ?? null,
    priority: overrides.priority ?? 0,
    stackable: overrides.stackable ?? false,
    benefitType: overrides.benefitType ?? 'percentage',
    benefitPercentageBasisPoints: overrides.benefitPercentageBasisPoints ?? 1000,
    benefitFixedAmount: overrides.benefitFixedAmount ?? null,
    benefitNxmBuyQuantity: overrides.benefitNxmBuyQuantity ?? null,
    benefitNxmPayQuantity: overrides.benefitNxmPayQuantity ?? null,
    minQuantity: overrides.minQuantity ?? null,
    minSubtotal: overrides.minSubtotal ?? null,
    usageLimitTotal: overrides.usageLimitTotal ?? null,
    combinableWithCoupons: overrides.combinableWithCoupons ?? true,
    branchIds: overrides.branchIds ?? [],
    productIds: overrides.productIds ?? [],
    categoryIds: overrides.categoryIds ?? [],
    createdBy: 'user-1',
    updatedBy: 'user-1',
    version: 1n,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function coupon(overrides: Partial<CouponRow> = {}): CouponRow {
  return {
    id: overrides.id ?? '00000000-0000-7000-8000-000000000020',
    companyId: 'company-1',
    code: overrides.code ?? 'SAVE10',
    normalizedCode: overrides.normalizedCode ?? 'SAVE10',
    description: null,
    benefitType: overrides.benefitType ?? 'percentage',
    benefitPercentageBasisPoints: overrides.benefitPercentageBasisPoints ?? 1000,
    benefitFixedAmount: overrides.benefitFixedAmount ?? null,
    active: overrides.active ?? true,
    startsAt: overrides.startsAt ?? null,
    endsAt: overrides.endsAt ?? null,
    minSubtotal: overrides.minSubtotal ?? null,
    usageLimitTotal: overrides.usageLimitTotal ?? null,
    promotionId: overrides.promotionId ?? null,
    createdBy: 'user-1',
    updatedBy: 'user-1',
    version: 1n,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

const NOW = new Date('2026-09-04T20:00:00.000Z'); // a Friday, ~2pm America/Mexico_City

function baseInput(overrides: Partial<EvaluatePricingInput> = {}): EvaluatePricingInput {
  return {
    branchId: BRANCH_ID,
    branchTimezone: TIMEZONE,
    currencyCode: 'MXN',
    lines: [line({ lineIndex: 0 })],
    promotionCandidates: [],
    couponLookup: () => null,
    requestedCouponCodes: [],
    actorPermissions: [],
    now: NOW,
    ...overrides,
  };
}

describe('pricing engine (TASK 12.9)', () => {
  describe('no promotion', () => {
    it('produces subtotal = gross, discount = 0, tax on the full gross', () => {
      const result = evaluatePricing(baseInput());
      expect(formatMoney(result.subtotalUnits)).toBe('100.0000');
      expect(formatMoney(result.discountTotalUnits)).toBe('0.0000');
      expect(formatMoney(result.taxTotalUnits)).toBe('16.0000');
      expect(formatMoney(result.totalUnits)).toBe('116.0000');
      expect(result.appliedDiscounts).toHaveLength(0);
    });
  });

  describe('automatic percentage promotion', () => {
    it('applies the exact percentage off the gross line subtotal, taxed on the net', () => {
      const result = evaluatePricing(
        baseInput({ promotionCandidates: [{ promotion: promotion({ benefitPercentageBasisPoints: 1000 }), scope: { branchIds: [], productIds: [], categoryIds: [] } }] }),
      );
      expect(formatMoney(result.discountTotalUnits)).toBe('10.0000');
      expect(formatMoney(result.taxTotalUnits)).toBe('14.4000'); // 16% of 90
      expect(formatMoney(result.totalUnits)).toBe('104.4000');
      expect(result.appliedDiscounts).toEqual([
        expect.objectContaining({ sourceType: 'promotion', amountUnits: 100_000n }),
      ]);
    });
  });

  describe('automatic fixed-amount promotion', () => {
    it('applies a flat amount off, never exceeding the eligible subtotal', () => {
      const result = evaluatePricing(
        baseInput({
          lines: [line({ lineIndex: 0, unitPriceUnits: 300_000n })], // $30
          promotionCandidates: [
            {
              promotion: promotion({ benefitType: 'fixed_amount', benefitPercentageBasisPoints: null, benefitFixedAmount: '50.0000' }),
              scope: { branchIds: [], productIds: [], categoryIds: [] },
            },
          ],
        }),
      );
      // Requested $50 off a $30 line is capped at $30 — never negative.
      expect(formatMoney(result.discountTotalUnits)).toBe('30.0000');
      expect(formatMoney(result.subtotalUnits)).toBe('30.0000');
      expect(formatMoney(result.totalUnits)).toBe('0.0000');
    });
  });

  describe('fixed promotional price', () => {
    it('discounts exactly the difference between catalog price and the promotional price', () => {
      const result = evaluatePricing(
        baseInput({
          lines: [line({ lineIndex: 0, unitPriceUnits: 2_990_000n, quantityUnits: 1_000_000n })], // $299 catalog
          promotionCandidates: [
            {
              promotion: promotion({ benefitType: 'fixed_price', benefitPercentageBasisPoints: null, benefitFixedAmount: '249.0000' }),
              scope: { branchIds: [], productIds: [], categoryIds: [] },
            },
          ],
        }),
      );
      expect(formatMoney(result.discountTotalUnits)).toBe('50.0000');
      expect(formatMoney(result.subtotalUnits)).toBe('299.0000');
    });

    it('never produces a negative discount when the promotional price is above the real price', () => {
      const result = evaluatePricing(
        baseInput({
          lines: [line({ lineIndex: 0, unitPriceUnits: 1_000_000n })], // $100
          promotionCandidates: [
            {
              promotion: promotion({ benefitType: 'fixed_price', benefitPercentageBasisPoints: null, benefitFixedAmount: '150.0000' }),
              scope: { branchIds: [], productIds: [], categoryIds: [] },
            },
          ],
        }),
      );
      expect(formatMoney(result.discountTotalUnits)).toBe('0.0000');
    });
  });

  describe('quantity NxM (2x1 / 3x2)', () => {
    it('2x1 on 3 identical units grants exactly 1 free unit (floor(3/2)), never half of every unit', () => {
      const result = evaluatePricing(
        baseInput({
          lines: [line({ lineIndex: 0, unitPriceUnits: 1_000_000n, quantityUnits: 3_000_000n, quantity: '3.000000' })], // 3 × $100
          promotionCandidates: [
            {
              promotion: promotion({
                benefitType: 'quantity_nxm',
                benefitPercentageBasisPoints: null,
                benefitNxmBuyQuantity: 2,
                benefitNxmPayQuantity: 1,
              }),
              scope: { branchIds: [], productIds: [], categoryIds: [] },
            },
          ],
        }),
      );
      // floor(3/2)=1 complete group ⇒ 1 free unit ⇒ $100 off, customer
      // pays for 2 of 3 — never 50% off every unit ($150).
      expect(formatMoney(result.discountTotalUnits)).toBe('100.0000');
      expect(formatMoney(result.subtotalUnits)).toBe('300.0000');
    });

    it('3x2 on 3 units grants exactly 1 free unit; on 2 units grants none (incomplete group)', () => {
      const three = evaluatePricing(
        baseInput({
          lines: [line({ lineIndex: 0, unitPriceUnits: 1_000_000n, quantityUnits: 3_000_000n, quantity: '3.000000' })],
          promotionCandidates: [
            {
              promotion: promotion({
                benefitType: 'quantity_nxm',
                benefitPercentageBasisPoints: null,
                benefitNxmBuyQuantity: 3,
                benefitNxmPayQuantity: 2,
              }),
              scope: { branchIds: [], productIds: [], categoryIds: [] },
            },
          ],
        }),
      );
      expect(formatMoney(three.discountTotalUnits)).toBe('100.0000');

      const two = evaluatePricing(
        baseInput({
          lines: [line({ lineIndex: 0, unitPriceUnits: 1_000_000n, quantityUnits: 2_000_000n, quantity: '2.000000' })],
          promotionCandidates: [
            {
              promotion: promotion({
                benefitType: 'quantity_nxm',
                benefitPercentageBasisPoints: null,
                benefitNxmBuyQuantity: 3,
                benefitNxmPayQuantity: 2,
              }),
              scope: { branchIds: [], productIds: [], categoryIds: [] },
            },
          ],
        }),
      );
      expect(formatMoney(two.discountTotalUnits)).toBe('0.0000');
    });
  });

  describe('eligibility conditions', () => {
    it('min_quantity blocks a promotion when the cart has too few eligible units', () => {
      const result = evaluatePricing(
        baseInput({
          promotionCandidates: [
            { promotion: promotion({ minQuantity: '2.000000' }), scope: { branchIds: [], productIds: [], categoryIds: [] } },
          ],
        }),
      );
      expect(formatMoney(result.discountTotalUnits)).toBe('0.0000');
    });

    it('min_subtotal blocks a promotion when the whole cart is below the threshold', () => {
      const result = evaluatePricing(
        baseInput({
          promotionCandidates: [
            { promotion: promotion({ minSubtotal: '200.0000' }), scope: { branchIds: [], productIds: [], categoryIds: [] } },
          ],
        }),
      );
      expect(formatMoney(result.discountTotalUnits)).toBe('0.0000');
    });

    it('branch scope excludes a promotion not listed for the sale branch', () => {
      const result = evaluatePricing(
        baseInput({
          promotionCandidates: [
            { promotion: promotion(), scope: { branchIds: [OTHER_BRANCH_ID], productIds: [], categoryIds: [] } },
          ],
        }),
      );
      expect(formatMoney(result.discountTotalUnits)).toBe('0.0000');
    });

    it('branch scope includes a promotion listed for the sale branch', () => {
      const result = evaluatePricing(
        baseInput({
          promotionCandidates: [
            { promotion: promotion(), scope: { branchIds: [BRANCH_ID], productIds: [], categoryIds: [] } },
          ],
        }),
      );
      expect(formatMoney(result.discountTotalUnits)).toBe('10.0000');
    });

    it('product scope only discounts the listed product', () => {
      const result = evaluatePricing(
        baseInput({
          lines: [line({ lineIndex: 0, productId: 'match-me' }), line({ lineIndex: 1, productId: 'not-me' })],
          promotionCandidates: [
            { promotion: promotion(), scope: { branchIds: [], productIds: ['match-me'], categoryIds: [] } },
          ],
        }),
      );
      expect(result.appliedDiscounts).toHaveLength(1);
      expect(result.appliedDiscounts[0]?.lineIndex).toBe(0);
    });

    it('category scope discounts every product in the listed category', () => {
      const result = evaluatePricing(
        baseInput({
          lines: [line({ lineIndex: 0, categoryId: 'cat-a' }), line({ lineIndex: 1, categoryId: 'cat-b' })],
          promotionCandidates: [
            { promotion: promotion(), scope: { branchIds: [], productIds: [], categoryIds: ['cat-a'] } },
          ],
        }),
      );
      expect(result.appliedDiscounts).toHaveLength(1);
      expect(result.appliedDiscounts[0]?.lineIndex).toBe(0);
    });

    it('start/end dates: a not-yet-started or already-ended promotion never applies', () => {
      const future = evaluatePricing(
        baseInput({
          promotionCandidates: [
            {
              promotion: promotion({ startsAt: new Date('2099-01-01T00:00:00.000Z') }),
              scope: { branchIds: [], productIds: [], categoryIds: [] },
            },
          ],
        }),
      );
      expect(formatMoney(future.discountTotalUnits)).toBe('0.0000');

      const ended = evaluatePricing(
        baseInput({
          promotionCandidates: [
            {
              promotion: promotion({ endsAt: new Date('2020-01-01T00:00:00.000Z') }),
              scope: { branchIds: [], productIds: [], categoryIds: [] },
            },
          ],
        }),
      );
      expect(formatMoney(ended.discountTotalUnits)).toBe('0.0000');
    });

    it('weekday: a promotion restricted to a different ISO weekday never applies on this one', () => {
      // NOW is a Friday (ISO weekday 5) in America/Mexico_City.
      const wrongDay = evaluatePricing(
        baseInput({
          promotionCandidates: [
            { promotion: promotion({ daysOfWeek: [1, 2] }), scope: { branchIds: [], productIds: [], categoryIds: [] } },
          ],
        }),
      );
      expect(formatMoney(wrongDay.discountTotalUnits)).toBe('0.0000');

      const rightDay = evaluatePricing(
        baseInput({
          promotionCandidates: [
            { promotion: promotion({ daysOfWeek: [5] }), scope: { branchIds: [], productIds: [], categoryIds: [] } },
          ],
        }),
      );
      expect(formatMoney(rightDay.discountTotalUnits)).toBe('10.0000');
    });

    it('time window: a promotion outside its local time window never applies', () => {
      // NOW is ~14:00 America/Mexico_City.
      const outside = evaluatePricing(
        baseInput({
          promotionCandidates: [
            {
              promotion: promotion({ timeFrom: '18:00', timeTo: '23:00' }),
              scope: { branchIds: [], productIds: [], categoryIds: [] },
            },
          ],
        }),
      );
      expect(formatMoney(outside.discountTotalUnits)).toBe('0.0000');

      const inside = evaluatePricing(
        baseInput({
          promotionCandidates: [
            {
              promotion: promotion({ timeFrom: '10:00', timeTo: '18:00' }),
              scope: { branchIds: [], productIds: [], categoryIds: [] },
            },
          ],
        }),
      );
      expect(formatMoney(inside.discountTotalUnits)).toBe('10.0000');
    });

    it('an inactive promotion never applies regardless of schedule', () => {
      const result = evaluatePricing(
        baseInput({
          promotionCandidates: [
            { promotion: promotion({ active: false }), scope: { branchIds: [], productIds: [], categoryIds: [] } },
          ],
        }),
      );
      expect(formatMoney(result.discountTotalUnits)).toBe('0.0000');
    });
  });

  describe('priority / stacking / exclusivity', () => {
    it('picks the highest-priority eligible promotion deterministically, ignoring the rest by default', () => {
      const low = promotion({ id: 'low', priority: 1, benefitPercentageBasisPoints: 500 });
      const high = promotion({ id: 'high', priority: 10, benefitPercentageBasisPoints: 1000 });
      const result = evaluatePricing(
        baseInput({
          promotionCandidates: [
            { promotion: low, scope: { branchIds: [], productIds: [], categoryIds: [] } },
            { promotion: high, scope: { branchIds: [], productIds: [], categoryIds: [] } },
          ],
        }),
      );
      expect(formatMoney(result.discountTotalUnits)).toBe('10.0000');
      expect(result.appliedDiscounts).toHaveLength(1);
      expect(result.appliedDiscounts[0]?.sourceId).toBe('high');
    });

    it('breaks equal-priority ties by larger discount amount, then by ascending id', () => {
      const a = promotion({ id: 'aaa', priority: 5, benefitPercentageBasisPoints: 500 });
      const b = promotion({ id: 'bbb', priority: 5, benefitPercentageBasisPoints: 1000 });
      const result = evaluatePricing(
        baseInput({
          promotionCandidates: [
            { promotion: a, scope: { branchIds: [], productIds: [], categoryIds: [] } },
            { promotion: b, scope: { branchIds: [], productIds: [], categoryIds: [] } },
          ],
        }),
      );
      expect(result.appliedDiscounts[0]?.sourceId).toBe('bbb');
    });

    it('a non-stackable winner blocks every other automatic promotion, even a higher-amount one', () => {
      // Non-stackable but higher priority wins outright — the
      // lower-priority, larger-discount promotion never contributes at
      // all, not even partially.
      const winner = promotion({ id: 'winner', priority: 10, stackable: false, benefitPercentageBasisPoints: 500 });
      const loser = promotion({ id: 'loser', priority: 1, benefitPercentageBasisPoints: 9000 });
      const result = evaluatePricing(
        baseInput({
          promotionCandidates: [
            { promotion: winner, scope: { branchIds: [], productIds: [], categoryIds: [] } },
            { promotion: loser, scope: { branchIds: [], productIds: [], categoryIds: [] } },
          ],
        }),
      );
      expect(result.appliedDiscounts).toHaveLength(1);
      expect(result.appliedDiscounts[0]?.sourceId).toBe('winner');
      expect(formatMoney(result.discountTotalUnits)).toBe('5.0000');
    });

    it('two stackable promotions combine, and the combined discount never exceeds the line subtotal', () => {
      const first = promotion({ id: 'first', priority: 10, stackable: true, benefitPercentageBasisPoints: 6000 });
      const second = promotion({ id: 'second', priority: 5, stackable: true, benefitPercentageBasisPoints: 7000 });
      const result = evaluatePricing(
        baseInput({
          promotionCandidates: [
            { promotion: first, scope: { branchIds: [], productIds: [], categoryIds: [] } },
            { promotion: second, scope: { branchIds: [], productIds: [], categoryIds: [] } },
          ],
        }),
      );
      expect(result.appliedDiscounts).toHaveLength(2);
      // 60% + 70% of $100 would be $130 — capped at the $100 line total,
      // never negative, never exceeding what the line is worth.
      expect(formatMoney(result.discountTotalUnits)).toBe('100.0000');
      expect(formatMoney(result.totalUnits)).toBe('0.0000');
    });

    it('a stackable winner never combines with a non-stackable candidate', () => {
      const stackableWinner = promotion({ id: 'sw', priority: 10, stackable: true, benefitPercentageBasisPoints: 1000 });
      const nonStackableOther = promotion({ id: 'nso', priority: 5, stackable: false, benefitPercentageBasisPoints: 2000 });
      const result = evaluatePricing(
        baseInput({
          promotionCandidates: [
            { promotion: stackableWinner, scope: { branchIds: [], productIds: [], categoryIds: [] } },
            { promotion: nonStackableOther, scope: { branchIds: [], productIds: [], categoryIds: [] } },
          ],
        }),
      );
      expect(result.appliedDiscounts).toHaveLength(1);
      expect(result.appliedDiscounts[0]?.sourceId).toBe('sw');
    });
  });

  describe('discount floor and tax-after-discount', () => {
    it('a 100% discount never produces a negative total, and tax on a fully-discounted line is zero', () => {
      const result = evaluatePricing(
        baseInput({
          promotionCandidates: [
            {
              promotion: promotion({ benefitPercentageBasisPoints: 10_000 }),
              scope: { branchIds: [], productIds: [], categoryIds: [] },
            },
          ],
        }),
      );
      expect(formatMoney(result.discountTotalUnits)).toBe('100.0000');
      expect(formatMoney(result.taxTotalUnits)).toBe('0.0000');
      expect(formatMoney(result.totalUnits)).toBe('0.0000');
    });

    it('a tax-exempt line is discounted the same way but never taxed', () => {
      const result = evaluatePricing(
        baseInput({
          lines: [line({ lineIndex: 0, taxCode: 'IVA_EXEMPT', taxBasisPoints: 0 })],
          promotionCandidates: [
            { promotion: promotion(), scope: { branchIds: [], productIds: [], categoryIds: [] } },
          ],
        }),
      );
      expect(formatMoney(result.discountTotalUnits)).toBe('10.0000');
      expect(formatMoney(result.taxTotalUnits)).toBe('0.0000');
      expect(formatMoney(result.totalUnits)).toBe('90.0000');
    });
  });

  describe('coupons', () => {
    it('a valid coupon reduces the post-promotion remaining amount, allocated across lines', () => {
      const result = evaluatePricing(
        baseInput({
          requestedCouponCodes: ['save10'],
          couponLookup: (code) =>
            code === 'SAVE10' ? { coupon: coupon(), branchEligible: true, redeemedCount: 0 } : null,
        }),
      );
      expect(formatMoney(result.discountTotalUnits)).toBe('10.0000');
      expect(result.appliedDiscounts[0]?.sourceType).toBe('coupon');
      expect(result.rejectedCoupons).toHaveLength(0);
    });

    it('an unknown code is rejected honestly as not_found, never silently ignored', () => {
      const result = evaluatePricing(baseInput({ requestedCouponCodes: ['NOPE'], couponLookup: () => null }));
      expect(result.rejectedCoupons).toEqual([{ code: 'NOPE', reason: 'not_found' }]);
      expect(formatMoney(result.discountTotalUnits)).toBe('0.0000');
    });

    it('an inactive coupon is rejected as inactive', () => {
      const result = evaluatePricing(
        baseInput({
          requestedCouponCodes: ['SAVE10'],
          couponLookup: () => ({ coupon: coupon({ active: false }), branchEligible: true, redeemedCount: 0 }),
        }),
      );
      expect(result.rejectedCoupons).toEqual([{ code: 'SAVE10', reason: 'inactive' }]);
    });

    it('a not-yet-started coupon is rejected as not_started', () => {
      const result = evaluatePricing(
        baseInput({
          requestedCouponCodes: ['SAVE10'],
          couponLookup: () => ({
            coupon: coupon({ startsAt: new Date('2099-01-01T00:00:00.000Z') }),
            branchEligible: true,
            redeemedCount: 0,
          }),
        }),
      );
      expect(result.rejectedCoupons).toEqual([{ code: 'SAVE10', reason: 'not_started' }]);
    });

    it('an expired coupon is rejected as expired', () => {
      const result = evaluatePricing(
        baseInput({
          requestedCouponCodes: ['SAVE10'],
          couponLookup: () => ({
            coupon: coupon({ endsAt: new Date('2020-01-01T00:00:00.000Z') }),
            branchEligible: true,
            redeemedCount: 0,
          }),
        }),
      );
      expect(result.rejectedCoupons).toEqual([{ code: 'SAVE10', reason: 'expired' }]);
    });

    it('a branch-ineligible coupon is rejected as branch_not_eligible', () => {
      const result = evaluatePricing(
        baseInput({
          requestedCouponCodes: ['SAVE10'],
          couponLookup: () => ({ coupon: coupon(), branchEligible: false, redeemedCount: 0 }),
        }),
      );
      expect(result.rejectedCoupons).toEqual([{ code: 'SAVE10', reason: 'branch_not_eligible' }]);
    });

    it('a fully-redeemed coupon is rejected as usage_exhausted', () => {
      const result = evaluatePricing(
        baseInput({
          requestedCouponCodes: ['SAVE10'],
          couponLookup: () => ({
            coupon: coupon({ usageLimitTotal: 3 }),
            branchEligible: true,
            redeemedCount: 3,
          }),
        }),
      );
      expect(result.rejectedCoupons).toEqual([{ code: 'SAVE10', reason: 'usage_exhausted' }]);
    });

    it('a cart below the coupon minimum subtotal is rejected as cart_not_eligible', () => {
      const result = evaluatePricing(
        baseInput({
          requestedCouponCodes: ['SAVE10'],
          couponLookup: () => ({
            coupon: coupon({ minSubtotal: '500.0000' }),
            branchEligible: true,
            redeemedCount: 0,
          }),
        }),
      );
      expect(result.rejectedCoupons).toEqual([{ code: 'SAVE10', reason: 'cart_not_eligible' }]);
    });

    it('code lookup is case/whitespace-normalized before matching', () => {
      const result = evaluatePricing(
        baseInput({
          requestedCouponCodes: [' save10 '],
          couponLookup: (code) =>
            code === 'SAVE10' ? { coupon: coupon(), branchEligible: true, redeemedCount: 0 } : null,
        }),
      );
      expect(result.rejectedCoupons).toHaveLength(0);
      expect(formatMoney(result.discountTotalUnits)).toBe('10.0000');
    });

    it('a coupon is rejected when the selected automatic promotion is not combinable with coupons', () => {
      const result = evaluatePricing(
        baseInput({
          promotionCandidates: [
            {
              promotion: promotion({ combinableWithCoupons: false }),
              scope: { branchIds: [], productIds: [], categoryIds: [] },
            },
          ],
          requestedCouponCodes: ['SAVE10'],
          couponLookup: () => ({ coupon: coupon(), branchEligible: true, redeemedCount: 0 }),
        }),
      );
      expect(result.rejectedCoupons).toEqual([{ code: 'SAVE10', reason: 'cart_not_eligible' }]);
      // The promotion itself still applied — only the coupon was blocked.
      expect(formatMoney(result.discountTotalUnits)).toBe('10.0000');
    });

    it('a fixed-amount coupon never discounts more than what remains after the promotion', () => {
      const result = evaluatePricing(
        baseInput({
          promotionCandidates: [
            { promotion: promotion({ benefitPercentageBasisPoints: 9000 }), scope: { branchIds: [], productIds: [], categoryIds: [] } },
          ],
          requestedCouponCodes: ['BIG'],
          couponLookup: () => ({
            coupon: coupon({ code: 'BIG', benefitType: 'fixed_amount', benefitPercentageBasisPoints: null, benefitFixedAmount: '50.0000' }),
            branchEligible: true,
            redeemedCount: 0,
          }),
        }),
      );
      // 90% promo leaves $10 remaining; a $50 coupon caps at that $10.
      expect(formatMoney(result.discountTotalUnits)).toBe('100.0000');
      expect(formatMoney(result.totalUnits)).toBe('0.0000');
    });
  });

  describe('manual discount', () => {
    it('requires discount.apply — an unauthorized request throws, never silently applies', () => {
      expect(() =>
        evaluatePricing(
          baseInput({
            manualDiscount: { scope: 'ticket', type: 'fixed_amount', value: '10.0000', reasonCode: 'goodwill' },
            actorPermissions: [],
          }),
        ),
      ).toThrow(/not authorized/u);
    });

    it('a ticket-scoped percentage discount applies after promotions/coupons, allocated pro-rata', () => {
      const result = evaluatePricing(
        baseInput({
          lines: [line({ lineIndex: 0, unitPriceUnits: 1_000_000n }), line({ lineIndex: 1, unitPriceUnits: 1_000_000n })],
          manualDiscount: { scope: 'ticket', type: 'percentage', value: '1000', reasonCode: 'goodwill' },
          actorPermissions: ['discount.apply'],
        }),
      );
      expect(formatMoney(result.discountTotalUnits)).toBe('20.0000'); // 10% of $200
      const manualEntries = result.appliedDiscounts.filter((entry) => entry.sourceType === 'manual');
      expect(manualEntries).toHaveLength(2);
      expect(manualEntries.every((entry) => entry.reasonCode === 'goodwill')).toBe(true);
    });

    it('a line-scoped fixed discount applies only to the targeted line and never exceeds it', () => {
      const result = evaluatePricing(
        baseInput({
          lines: [line({ lineIndex: 0, unitPriceUnits: 500_000n }), line({ lineIndex: 1, unitPriceUnits: 1_000_000n })],
          manualDiscount: { scope: 'line', lineIndex: 0, type: 'fixed_amount', value: '1000.0000', reasonCode: 'defect' },
          actorPermissions: ['discount.apply'],
        }),
      );
      const manualEntries = result.appliedDiscounts.filter((entry) => entry.sourceType === 'manual');
      expect(manualEntries).toHaveLength(1);
      expect(manualEntries[0]?.lineIndex).toBe(0);
      expect(formatMoney(manualEntries[0]?.amountUnits ?? 0n)).toBe('50.0000'); // capped at line 0's own $50
    });

    it('rejects an out-of-range percentage value rather than silently clamping it', () => {
      expect(() =>
        evaluatePricing(
          baseInput({
            manualDiscount: { scope: 'ticket', type: 'percentage', value: '15000', reasonCode: 'x' },
            actorPermissions: ['discount.apply'],
          }),
        ),
      ).toThrow(/out of range/u);
    });

    it('rejects a non-positive fixed amount rather than silently applying zero', () => {
      expect(() =>
        evaluatePricing(
          baseInput({
            manualDiscount: { scope: 'ticket', type: 'fixed_amount', value: '0.0000', reasonCode: 'x' },
            actorPermissions: ['discount.apply'],
          }),
        ),
      ).toThrow(/must be positive/u);
    });
  });

  describe('combined pipeline ordering', () => {
    it('cascades promotion → coupon → manual sequentially, never double-counting against the original gross', () => {
      const result = evaluatePricing(
        baseInput({
          lines: [line({ lineIndex: 0, unitPriceUnits: 1_000_000n })], // $100
          promotionCandidates: [
            { promotion: promotion({ benefitPercentageBasisPoints: 1000 }), scope: { branchIds: [], productIds: [], categoryIds: [] } }, // -10% of $100 = $10 → $90 left
          ],
          requestedCouponCodes: ['SAVE10'],
          couponLookup: () => ({ coupon: coupon({ benefitPercentageBasisPoints: 1000 }), branchEligible: true, redeemedCount: 0 }), // -10% of $90 = $9 → $81 left
          manualDiscount: { scope: 'ticket', type: 'percentage', value: '1000', reasonCode: 'x' }, // -10% of $81 = $8.10 → $72.90 left
          actorPermissions: ['discount.apply'],
        }),
      );
      expect(formatMoney(result.discountTotalUnits)).toBe('27.1000'); // 10 + 9 + 8.10
      expect(formatMoney(result.subtotalUnits)).toBe('100.0000');
      expect(formatMoney(result.subtotalUnits - result.discountTotalUnits)).toBe('72.9000');
    });
  });

  describe('reward benefit (TASK 13.2, ADR-0019)', () => {
    function reward(overrides: Partial<RewardBenefitCandidate> = {}): RewardBenefitCandidate {
      return {
        rewardEntitlementId: overrides.rewardEntitlementId ?? '00000000-0000-9000-8000-000000000030',
        loyaltyProgramId: overrides.loyaltyProgramId ?? '00000000-0000-9000-8000-000000000031',
        rewardType: overrides.rewardType ?? 'vip_pass',
        benefitType: overrides.benefitType ?? 'free_eligible_item',
        benefitPercentageBasisPoints: overrides.benefitPercentageBasisPoints ?? null,
        benefitFixedAmount: overrides.benefitFixedAmount ?? null,
        scope: overrides.scope ?? { productIds: ['product-0'], categoryIds: [] },
      };
    }

    it('free_eligible_item waives the eligible line entirely', () => {
      const result = evaluatePricing(
        baseInput({
          lines: [line({ lineIndex: 0, unitPriceUnits: 2_500_000n })], // $250
          rewardCandidate: reward(),
        }),
      );
      const rewardEntries = result.appliedDiscounts.filter((entry) => entry.sourceType === 'reward');
      expect(rewardEntries).toHaveLength(1);
      expect(rewardEntries[0]?.sourceId).toBe('00000000-0000-9000-8000-000000000030');
      expect(rewardEntries[0]?.lineIndex).toBe(0);
      expect(formatMoney(rewardEntries[0]?.amountUnits ?? 0n)).toBe('250.0000');
      expect(formatMoney(result.discountTotalUnits)).toBe('250.0000');
      expect(formatMoney(result.subtotalUnits - result.discountTotalUnits)).toBe('0.0000');
    });

    it('an out-of-scope cart applies no reward discount and throws nothing', () => {
      const result = evaluatePricing(
        baseInput({
          lines: [line({ lineIndex: 0, productId: 'sock-1', unitPriceUnits: 1_000_000n })],
          rewardCandidate: reward({ scope: { productIds: ['product-0'], categoryIds: [] } }),
        }),
      );
      expect(result.appliedDiscounts.filter((entry) => entry.sourceType === 'reward')).toHaveLength(0);
      expect(formatMoney(result.discountTotalUnits)).toBe('0.0000');
    });

    it('a both-empty scope matches NOTHING — the deliberate inverse of promotion scope (Part B)', () => {
      const result = evaluatePricing(
        baseInput({
          lines: [line({ lineIndex: 0, productId: 'product-0', unitPriceUnits: 1_000_000n })],
          rewardCandidate: reward({ scope: { productIds: [], categoryIds: [] } }),
        }),
      );
      expect(result.appliedDiscounts.filter((entry) => entry.sourceType === 'reward')).toHaveLength(0);
    });

    it('a category-scoped reward matches a line by category even when productIds is empty', () => {
      const result = evaluatePricing(
        baseInput({
          lines: [line({ lineIndex: 0, productId: 'unrelated-product', categoryId: 'admissions', unitPriceUnits: 900_000n })],
          rewardCandidate: reward({ scope: { productIds: [], categoryIds: ['admissions'] } }),
        }),
      );
      const rewardEntries = result.appliedDiscounts.filter((entry) => entry.sourceType === 'reward');
      expect(rewardEntries).toHaveLength(1);
      expect(formatMoney(rewardEntries[0]?.amountUnits ?? 0n)).toBe('90.0000');
    });

    it('Part J — with several eligible lines, benefits exactly ONE: the largest remaining amount', () => {
      const result = evaluatePricing(
        baseInput({
          lines: [
            line({ lineIndex: 0, productId: 'product-0', unitPriceUnits: 500_000n }), // $50
            line({ lineIndex: 1, productId: 'product-0', unitPriceUnits: 900_000n }), // $90 — the largest
            line({ lineIndex: 2, productId: 'product-0', unitPriceUnits: 300_000n }), // $30
          ],
          rewardCandidate: reward(),
        }),
      );
      const rewardEntries = result.appliedDiscounts.filter((entry) => entry.sourceType === 'reward');
      expect(rewardEntries).toHaveLength(1);
      expect(rewardEntries[0]?.lineIndex).toBe(1);
      expect(formatMoney(rewardEntries[0]?.amountUnits ?? 0n)).toBe('90.0000');
    });

    it('percentage_discount takes basis points of what promotions/coupons already left', () => {
      const result = evaluatePricing(
        baseInput({
          lines: [line({ lineIndex: 0, productId: 'product-0', unitPriceUnits: 1_000_000n })], // $100
          rewardCandidate: reward({ benefitType: 'percentage_discount', benefitPercentageBasisPoints: 2500 }), // 25%
        }),
      );
      const rewardEntries = result.appliedDiscounts.filter((entry) => entry.sourceType === 'reward');
      expect(formatMoney(rewardEntries[0]?.amountUnits ?? 0n)).toBe('25.0000');
      expect(rewardEntries[0]?.basisPoints).toBe(2500);
    });

    it('fixed_price grants the gap between what remains and the promotional price, floored at zero', () => {
      const result = evaluatePricing(
        baseInput({
          lines: [line({ lineIndex: 0, productId: 'product-0', unitPriceUnits: 1_000_000n })], // $100
          rewardCandidate: reward({ benefitType: 'fixed_price', benefitFixedAmount: '35.0000' }),
        }),
      );
      const rewardEntries = result.appliedDiscounts.filter((entry) => entry.sourceType === 'reward');
      expect(formatMoney(rewardEntries[0]?.amountUnits ?? 0n)).toBe('65.0000');
    });

    it('fixed_price at or above the remaining amount grants no discount rather than a negative one', () => {
      const result = evaluatePricing(
        baseInput({
          lines: [line({ lineIndex: 0, productId: 'product-0', unitPriceUnits: 100_000n })], // $10
          rewardCandidate: reward({ benefitType: 'fixed_price', benefitFixedAmount: '35.0000' }),
        }),
      );
      expect(result.appliedDiscounts.filter((entry) => entry.sourceType === 'reward')).toHaveLength(0);
    });

    it('fixed_amount_discount is capped at what remains, never granting more than the line is worth', () => {
      const result = evaluatePricing(
        baseInput({
          lines: [line({ lineIndex: 0, productId: 'product-0', unitPriceUnits: 200_000n })], // $20
          rewardCandidate: reward({ benefitType: 'fixed_amount_discount', benefitFixedAmount: '250.0000' }),
        }),
      );
      const rewardEntries = result.appliedDiscounts.filter((entry) => entry.sourceType === 'reward');
      expect(formatMoney(rewardEntries[0]?.amountUnits ?? 0n)).toBe('20.0000');
    });

    it('stacks naturally after promotions/coupons — computed against what they already left, not the original gross', () => {
      const result = evaluatePricing(
        baseInput({
          lines: [line({ lineIndex: 0, productId: 'product-0', unitPriceUnits: 1_000_000n })], // $100
          promotionCandidates: [
            {
              promotion: promotion({ benefitPercentageBasisPoints: 2000 }), // -20% of $100 = $20 → $80 left
              scope: { branchIds: [], productIds: [], categoryIds: [] },
            },
          ],
          requestedCouponCodes: ['SAVE10'],
          couponLookup: () => ({
            coupon: coupon({ benefitPercentageBasisPoints: 1000 }), // -10% of $80 = $8 → $72 left
            branchEligible: true,
            redeemedCount: 0,
          }),
          rewardCandidate: reward(), // free_eligible_item — waives what's left: $72
        }),
      );
      const rewardEntries = result.appliedDiscounts.filter((entry) => entry.sourceType === 'reward');
      expect(formatMoney(rewardEntries[0]?.amountUnits ?? 0n)).toBe('72.0000');
      expect(formatMoney(result.subtotalUnits - result.discountTotalUnits)).toBe('0.0000');
    });

    it('applies BEFORE the manual discount, so a cashier override still operates on top of it', () => {
      const result = evaluatePricing(
        baseInput({
          lines: [line({ lineIndex: 0, productId: 'product-0', unitPriceUnits: 1_000_000n })], // $100
          rewardCandidate: reward({ benefitType: 'fixed_amount_discount', benefitFixedAmount: '40.0000' }), // → $60 left
          manualDiscount: { scope: 'ticket', type: 'percentage', value: '1000', reasonCode: 'goodwill' }, // -10% of $60 = $6
          actorPermissions: ['discount.apply'],
        }),
      );
      const rewardEntries = result.appliedDiscounts.filter((entry) => entry.sourceType === 'reward');
      const manualEntries = result.appliedDiscounts.filter((entry) => entry.sourceType === 'manual');
      expect(formatMoney(rewardEntries[0]?.amountUnits ?? 0n)).toBe('40.0000');
      expect(formatMoney(manualEntries[0]?.amountUnits ?? 0n)).toBe('6.0000');
      expect(formatMoney(result.discountTotalUnits)).toBe('46.0000');
    });

    it('a line already reduced to zero by promotions/coupons is not eligible for a further reward benefit', () => {
      const result = evaluatePricing(
        baseInput({
          lines: [
            line({ lineIndex: 0, productId: 'product-0', unitPriceUnits: 500_000n }), // $50, in scope
            line({ lineIndex: 1, productId: 'other-product', unitPriceUnits: 500_000n }), // $50, out of scope
          ],
          promotionCandidates: [
            {
              // 100% off line 0 only — leaves it at $0.
              promotion: promotion({ benefitPercentageBasisPoints: 10_000 }),
              scope: { branchIds: [], productIds: ['product-0'], categoryIds: [] },
            },
          ],
          rewardCandidate: reward({ scope: { productIds: ['product-0'], categoryIds: [] } }),
        }),
      );
      // The only in-scope line is already fully discounted — no reward
      // benefit event is produced (never a negative/no-op discount row).
      expect(result.appliedDiscounts.filter((entry) => entry.sourceType === 'reward')).toHaveLength(0);
    });

    it('no rewardCandidate present is a plain no-op, identical to the pre-TASK-13.2 pipeline', () => {
      const result = evaluatePricing(baseInput({ rewardCandidate: null }));
      expect(result.appliedDiscounts.filter((entry) => entry.sourceType === 'reward')).toHaveLength(0);
      expect(formatMoney(result.discountTotalUnits)).toBe('0.0000');
    });
  });

  // TASK 16.8B — the production incident this guards against: a real
  // branch was saved with the bare-city string "Mexico_City" (looks
  // plausible, is not a real IANA identifier — the real one is
  // "America/Mexico_City"), which later crashed `evaluatePricing` itself
  // (via `localWeekdayAndTime`'s own `Intl.DateTimeFormat` call) with an
  // unhandled `RangeError`. `isValidIanaTimezone` is the one runtime-native
  // check every write path (`AdministrationService`) and the sales
  // read-side defense-in-depth guard (`SalesService.createSale`) now share.
  describe('isValidIanaTimezone (TASK 16.8B)', () => {
    it('accepts America/Mexico_City — the exact zone the production incident should have used', () => {
      expect(isValidIanaTimezone('America/Mexico_City')).toBe(true);
    });

    it('accepts other real IANA zones across regions, including UTC itself', () => {
      expect(isValidIanaTimezone('UTC')).toBe(true);
      expect(isValidIanaTimezone('America/Cancun')).toBe(true);
      expect(isValidIanaTimezone('America/Tijuana')).toBe(true);
      expect(isValidIanaTimezone('Europe/Madrid')).toBe(true);
      expect(isValidIanaTimezone('Asia/Tokyo')).toBe(true);
    });

    it('rejects the exact production-incident value "Mexico_City" (missing the "America/" prefix)', () => {
      expect(isValidIanaTimezone('Mexico_City')).toBe(false);
    });

    it('rejects an obviously nonsense string and a plausible-looking but fake region/city pair', () => {
      expect(isValidIanaTimezone('foobar')).toBe(false);
      expect(isValidIanaTimezone('Not/AZone')).toBe(false);
    });

    it('rejects blank and whitespace-only values', () => {
      expect(isValidIanaTimezone('')).toBe(false);
      expect(isValidIanaTimezone('   ')).toBe(false);
    });

    // Verified empirically against the real runtime before asserting —
    // never assumed. Node's own ICU accepts a fixed numeric UTC offset
    // like `"+05:00"` (it is a real, resolvable `Intl.DateTimeFormat`
    // `timeZone` value, just not a *named* IANA zone with DST rules) but
    // rejects the informal `"GMT+5"` spelling — this validator defers
    // entirely to that real, engine-native behavior rather than a
    // hand-written notion of "looks like a zone."
    it('accepts a fixed numeric UTC-offset string (a real, resolvable Intl.DateTimeFormat value, if not a named zone)', () => {
      expect(isValidIanaTimezone('+05:00')).toBe(true);
    });

    it('rejects the informal "GMT+5" spelling', () => {
      expect(isValidIanaTimezone('GMT+5')).toBe(false);
    });

    // Also verified empirically: Node's own ICU canonicalizes zone-name
    // casing during lookup, so a differently-cased real identifier still
    // resolves — this validator is deliberately never stricter than the
    // runtime it defers to (a hand-rolled case-sensitivity check here
    // would reject a value the actual `localWeekdayAndTime` call below
    // would have accepted just fine).
    it('accepts a real IANA identifier regardless of casing, matching the runtime it defers to exactly', () => {
      expect(isValidIanaTimezone('america/mexico_city')).toBe(true);
    });
  });
});
