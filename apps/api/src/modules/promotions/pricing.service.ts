import type {
  CouponRow,
  PricingAppliedDiscount,
  PricingManualDiscountInput,
  PricingResolvedLine,
  PricingResult,
  PromotionRow,
  RewardBenefitCandidate,
} from './promotions.types.js';
import { PromotionError } from './promotions.types.js';

/**
 * TASK 12.9 — the ONE canonical server-side pricing engine (ADR-0016
 * "Authoritative pricing engine"/"Pricing order"). Every caller that
 * needs a price — the standalone quote endpoint (E-PRICING-1) AND real
 * sale creation (`sales.service.ts`) — calls `evaluatePricing` with the
 * exact same already-resolved inputs; neither wraps or duplicates this
 * math. This file has NO database access of its own (every promotion/
 * coupon/product fact it needs is resolved by its caller first) —
 * purely deterministic given its inputs, which is what makes it
 * directly unit-testable without a database (see
 * `pricing.service.test.ts`) and what guarantees "same cart/context ⇒
 * same result" (Part G).
 *
 * Pipeline (ADR-0016 D2, deliberately more conservative than AS POS
 * V1's own parallel-sum model — confirmed by reading `AS POS V1.html`
 * directly — V1 computes promo/coupon/manual discounts independently
 * against the SAME gross base and only sums them at the end; this
 * engine instead cascades strictly, matching the task's own literal
 * "catalog price → automatic promotions → coupon effects → manual
 * discounts → tax" ordering, which avoids a customer ever effectively
 * double-benefiting from two percentage discounts both computed against
 * the full untouched gross amount):
 *
 *   1. catalog unit price × quantity → gross line subtotal
 *   2. best eligible AUTOMATIC promotion(s) (priority → stacking, see
 *      `selectPromotions`) reduce each eligible line
 *   3. a valid COUPON reduces the cart's remaining (post-promotion)
 *      amount, allocated pro-rata across lines
 *   4. an authorized MANUAL discount reduces what's left (again
 *      pro-rata if ticket-scoped; directly if line-scoped)
 *   5. tax is computed on each line's own POST-DISCOUNT taxable base
 *   6. `total = subtotal − discount_total + tax_total` (exactly
 *      `sales`'s own existing, DB-enforced `sales_arithmetic_ck`)
 */

const MONEY_SCALE = 10_000n; // numeric(19,4)
const QUANTITY_SCALE = 1_000_000n; // numeric(19,6)
const BASIS_POINT_SCALE = 10_000n; // 10000bp = 100%

function moneyUnits(value: string): bigint {
  const [whole = '', fraction = ''] = value.split('.');
  const wholeDigits = whole.length === 0 ? '0' : whole;
  const fractionDigits = fraction.padEnd(4, '0').slice(0, 4);
  return BigInt(wholeDigits) * MONEY_SCALE + BigInt(fractionDigits.length === 0 ? '0' : fractionDigits);
}
export function formatMoney(units: bigint): string {
  const negative = units < 0n;
  const magnitude = negative ? -units : units;
  const whole = magnitude / MONEY_SCALE;
  const fraction = (magnitude % MONEY_SCALE).toString().padStart(4, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fraction}`;
}
export function parseQuantityUnits(value: string, field: string): bigint {
  const match = /^(\d{1,19})(?:\.(\d{1,6}))?$/u.exec(value);
  if (match?.[1] === undefined) throw new PromotionError('validation_error', `${field} is invalid.`);
  return BigInt(match[1]) * QUANTITY_SCALE + BigInt((match[2] ?? '').padEnd(6, '0'));
}
function multiplyMoneyByQuantity(amountUnits: bigint, qtyUnits: bigint): bigint {
  const numerator = amountUnits * qtyUnits;
  return (numerator + QUANTITY_SCALE / 2n) / QUANTITY_SCALE;
}
export function applyBasisPoints(amountUnits: bigint, basisPoints: number): bigint {
  const numerator = amountUnits * BigInt(basisPoints);
  return (numerator + BASIS_POINT_SCALE / 2n) / BASIS_POINT_SCALE;
}
/** The exact inverse of `applyBasisPoints`: the basis-points rate that
 * produced `discountUnits` out of `baseUnits`, rounded half-up. `0`
 * whenever `baseUnits` is `0` (nothing to express a rate against —
 * never a division-by-zero throw, since a zero-price line is legal). */
function impliedBasisPoints(discountUnits: bigint, baseUnits: bigint): number {
  if (baseUnits <= 0n) return 0;
  // round(discountUnits * 10000 / baseUnits) via the standard
  // floor((2·numerator + denominator) / (2·denominator)) half-up trick —
  // never a floating-point division.
  const numerator = 2n * discountUnits * BASIS_POINT_SCALE + baseUnits;
  const denominator = 2n * baseUnits;
  return Number(numerator / denominator);
}
/** Distributes `totalUnits` across `weights` proportionally, floor
 * division per share with the exact remainder assigned to the LAST
 * line carrying nonzero weight — guarantees `sum(shares) ===
 * totalUnits` exactly, every time, regardless of rounding (Part P
 * "partial refund allocation remains mathematically safe" starts here:
 * an allocation that doesn't sum exactly would itself be an unsafe
 * foundation). All-zero weights (an empty or fully-already-discounted
 * cart) allocate nothing anywhere, never dividing by zero. */
function allocateProportionally(totalUnits: bigint, weights: readonly bigint[]): bigint[] {
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0n);
  if (weightSum <= 0n) return weights.map(() => 0n);
  const shares = weights.map((weight) => (totalUnits * weight) / weightSum);
  const allocated = shares.reduce((sum, share) => sum + share, 0n);
  const remainder = totalUnits - allocated;
  if (remainder !== 0n) {
    for (let i = weights.length - 1; i >= 0; i -= 1) {
      const weight = weights[i];
      const share = shares[i];
      if (weight !== undefined && weight > 0n && share !== undefined) {
        shares[i] = share + remainder;
        break;
      }
    }
  }
  return shares;
}

// --- Automatic promotion eligibility/selection --------------------------

export interface PromotionScope {
  branchIds: readonly string[];
  productIds: readonly string[];
  categoryIds: readonly string[];
}

/** TASK 16.8B — the one, runtime-native way to check whether `value` is a
 * real IANA timezone identifier: ask `Intl.DateTimeFormat` to actually use
 * it, exactly the same lookup `localWeekdayAndTime` below performs for
 * real, and see whether the runtime's own ICU/tzdata accepts it. Never a
 * hand-maintained list of "known good" zone strings (which would silently
 * reject a real, valid zone the list-writer simply hadn't heard of, or
 * accept a typo that happens to look right) — the runtime's own timezone
 * database is always the authoritative, self-updating source of truth.
 * `.format()` (not merely constructing the formatter) is required: V8/ICU
 * only actually validates the `timeZone` option when the formatter is
 * used, not at construction time. */
export function isValidIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

/** ISO 8601 weekday (1=Monday…7=Sunday) and "HH:MM" for `instant` as
 * observed in `timezone` — Node's own `Intl` support, never a
 * hand-rolled UTC-offset table (which could silently be wrong for a
 * timezone using DST). Throws if `timezone` is not a real IANA zone —
 * TASK 16.8B found this was NOT actually prevented upstream despite this
 * comment's own prior claim that it "cannot happen for a real
 * `branches.timezone` value (a required, already-validated column)": the
 * column was only ever checked for non-blank text
 * (`branches_timezone_nonblank_ck`), a real production branch was created
 * through the admin UI with the non-IANA value `"Mexico_City"`, and this
 * function's own `RangeError` reached a real `POST /api/v1/sales` caller
 * as an opaque 500. `isValidIanaTimezone` above now gates every write
 * path that can persist a `timezone` value (`AdministrationService`'s
 * branch/company create+update, the production-owner provisioning CLI),
 * and `SalesService` independently re-validates the value it reads back
 * out of the database before ever reaching this function — see
 * `SalesService.createSale`'s own `branch_timezone_invalid` guard — so a
 * `RangeError` escaping this function is now a defense-in-depth backstop,
 * never the primary guard. */
export function localWeekdayAndTime(instant: Date, timezone: string): { weekday: number; time: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const weekdayShort = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon';
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  const isoWeekdayByShort: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return { weekday: isoWeekdayByShort[weekdayShort] ?? 1, time: `${hour}:${minute}` };
}

/** TASK 16.13A — the calendar date (`YYYY-MM-DD`) `instant` falls on AS
 * OBSERVED IN `timezone`, mirroring `localWeekdayAndTime`'s exact
 * `Intl.DateTimeFormat` + `formatToParts` shape (never a hand-rolled
 * UTC-offset table, never locale-format-string parsing). Used by
 * `CashService.partialClose` so "Eventos de hoy" compares against the
 * BRANCH's own local day, not a blind UTC one — a branch in, say,
 * `America/Mexico_City` observing 11pm local time is still "today" there
 * even though UTC has already rolled to the next calendar day. Throws if
 * `timezone` is not a real IANA zone, for the exact same reason
 * `localWeekdayAndTime` does — callers must gate with
 * `isValidIanaTimezone` first. */
export function localDateString(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const year = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

function isPromotionScheduleEligible(
  promotion: PromotionRow,
  now: Date,
  weekday: number,
  localTime: string,
): boolean {
  if (!promotion.active) return false;
  if (promotion.startsAt !== null && now < promotion.startsAt) return false;
  if (promotion.endsAt !== null && now > promotion.endsAt) return false;
  if (promotion.daysOfWeek !== null && promotion.daysOfWeek.length > 0 && !promotion.daysOfWeek.includes(weekday))
    return false;
  if (promotion.timeFrom !== null && localTime < promotion.timeFrom) return false;
  if (promotion.timeTo !== null && localTime > promotion.timeTo) return false;
  return true;
}

function isLineEligibleForPromotion(line: PricingResolvedLine, scope: PromotionScope): boolean {
  if (scope.productIds.length === 0 && scope.categoryIds.length === 0) return true;
  if (scope.productIds.includes(line.productId)) return true;
  return line.categoryId !== null && scope.categoryIds.includes(line.categoryId);
}

interface PromotionCandidate {
  promotion: PromotionRow;
  scope: PromotionScope;
}

interface ScoredPromotion {
  promotion: PromotionRow;
  eligibleLineIndexes: readonly number[];
  totalDiscountUnits: bigint;
  perLineDiscountUnits: ReadonlyMap<number, bigint>;
}

/** One promotion's discount against the lines' CURRENT gross subtotal —
 * never against another promotion's already-discounted amount (only one
 * "primary" automatic promotion, or an explicitly `stackable` group,
 * ever contributes — see `selectPromotions`). */
function computePromotionDiscount(
  promotion: PromotionRow,
  scope: PromotionScope,
  lines: readonly PricingResolvedLine[],
  weekday: number,
  localTime: string,
  now: Date,
  cartSubtotalUnits: bigint,
): ScoredPromotion | null {
  if (!isPromotionScheduleEligible(promotion, now, weekday, localTime)) return null;
  // Branch eligibility is already filtered by the caller
  // (`evaluatePricing`'s own `scope.branchIds.includes(branchId)`
  // pre-filter, before this function is ever invoked) — this function
  // has no `branchId` parameter of its own on purpose, so there is
  // nothing to re-check here.
  const eligibleLines = lines.filter((line) => isLineEligibleForPromotion(line, scope));
  if (eligibleLines.length === 0) return null;

  const eligibleQuantityUnits = eligibleLines.reduce((sum, line) => sum + line.quantityUnits, 0n);
  if (promotion.minQuantity !== null) {
    const minQuantityUnits = parseQuantityUnits(promotion.minQuantity, 'min_quantity');
    if (eligibleQuantityUnits < minQuantityUnits) return null;
  }
  if (promotion.minSubtotal !== null && cartSubtotalUnits < moneyUnits(promotion.minSubtotal)) return null;

  const perLineDiscountUnits = new Map<number, bigint>();
  let totalDiscountUnits = 0n;

  if (promotion.benefitType === 'percentage') {
    const basisPoints = promotion.benefitPercentageBasisPoints ?? 0;
    for (const line of eligibleLines) {
      const discount = applyBasisPoints(line.grossSubtotalUnits, basisPoints);
      if (discount > 0n) {
        perLineDiscountUnits.set(line.lineIndex, discount);
        totalDiscountUnits += discount;
      }
    }
  } else if (promotion.benefitType === 'fixed_price') {
    // A per-unit promotional price — the discount is however much the
    // eligible quantity's gross exceeds `benefitFixedAmount × quantity`,
    // never negative (a promotional "price" above the real price grants
    // no discount at all, it is simply not eligible).
    const priceUnits = moneyUnits(promotion.benefitFixedAmount ?? '0');
    for (const line of eligibleLines) {
      const promoLineTotal = multiplyMoneyByQuantity(priceUnits, line.quantityUnits);
      const discount = line.grossSubtotalUnits > promoLineTotal ? line.grossSubtotalUnits - promoLineTotal : 0n;
      if (discount > 0n) {
        perLineDiscountUnits.set(line.lineIndex, discount);
        totalDiscountUnits += discount;
      }
    }
  } else if (promotion.benefitType === 'fixed_amount') {
    // A flat amount off the eligible lines' combined subtotal,
    // allocated pro-rata across them, never exceeding that subtotal.
    const eligibleSubtotalUnits = eligibleLines.reduce((sum, line) => sum + line.grossSubtotalUnits, 0n);
    const requestedUnits = moneyUnits(promotion.benefitFixedAmount ?? '0');
    const cappedUnits = requestedUnits > eligibleSubtotalUnits ? eligibleSubtotalUnits : requestedUnits;
    const shares = allocateProportionally(
      cappedUnits,
      eligibleLines.map((line) => line.grossSubtotalUnits),
    );
    eligibleLines.forEach((line, index) => {
      const share = shares[index] ?? 0n;
      if (share > 0n) {
        perLineDiscountUnits.set(line.lineIndex, share);
        totalDiscountUnits += share;
      }
    });
  } else {
    // Exhaustive: `promotion.benefitType` is narrowed to exactly
    // `'quantity_nxm'` here (the 4th and last member of
    // `PromotionBenefitType`, the other 3 handled above). Every complete
    // group of `buy` units grants `buy - pay` free units
    // (e.g. 2x1 ⇒ buy=2,pay=1 ⇒ 1 free per 2; 3x2 ⇒ buy=3,pay=2 ⇒ 1 free
    // per 3) — the exact formula confirmed against AS POS V1's own
    // `evaluarPromocionesCarrito` (`Math.floor(item.qty/2)*item.precio`
    // for 2x1, `Math.floor(item.qty/3)*item.precio` for 3x2),
    // generalized to any (buy,pay) pair. Scoped to ONE line at a time —
    // v1 never mixes different products into a single NxM group,
    // matching V1's own per-line evaluation exactly (see ADR-0016
    // "NxM/2x1 semantics" for why mixed-product NxM is out of scope).
    const buy = promotion.benefitNxmBuyQuantity ?? 0;
    const pay = promotion.benefitNxmPayQuantity ?? 0;
    const freeUnitsPerGroup = BigInt(buy - pay);
    for (const line of eligibleLines) {
      const wholeUnits = line.quantityUnits / QUANTITY_SCALE; // whole units only — a fractional remainder never completes a group
      const groups = wholeUnits / BigInt(buy);
      const freeUnits = groups * freeUnitsPerGroup;
      if (freeUnits > 0n) {
        const discount = multiplyMoneyByQuantity(line.unitPriceUnits, freeUnits * QUANTITY_SCALE);
        perLineDiscountUnits.set(line.lineIndex, discount);
        totalDiscountUnits += discount;
      }
    }
  }

  if (totalDiscountUnits <= 0n) return null;
  return {
    promotion,
    eligibleLineIndexes: eligibleLines.map((line) => line.lineIndex),
    totalDiscountUnits,
    perLineDiscountUnits,
  };
}

/** Deterministic selection among every eligible automatic promotion
 * (ADR-0016 "Priority/stacking", Part H): highest `priority` first,
 * ties broken by the larger discount amount, final ties broken by
 * ascending promotion id (a stable, arbitrary-but-reproducible
 * tie-breaker — never insertion order, which a caller's own query could
 * change run to run). The winner is always applied. If — and only if —
 * the winner has `stackable = true`, every SUBSEQUENT eligible
 * promotion that is ALSO `stackable = true` is additionally applied
 * (both sides must opt in); a non-stackable winner blocks every other
 * automatic promotion outright, matching AS POS V1's own real behavior
 * (at most one promotion applied at a time) as the conservative
 * default. */
function selectPromotions(scored: readonly ScoredPromotion[]): readonly ScoredPromotion[] {
  const sorted = [...scored].sort((a, b) => {
    if (a.promotion.priority !== b.promotion.priority) return b.promotion.priority - a.promotion.priority;
    if (a.totalDiscountUnits !== b.totalDiscountUnits)
      return a.totalDiscountUnits > b.totalDiscountUnits ? -1 : 1;
    return a.promotion.id < b.promotion.id ? -1 : a.promotion.id > b.promotion.id ? 1 : 0;
  });
  const winner = sorted[0];
  if (winner === undefined) return [];
  if (!winner.promotion.stackable) return [winner];
  return sorted.filter((candidate) => candidate.promotion.stackable);
}

// --- Coupon evaluation ---------------------------------------------------

export type CouponRejectionReason =
  | 'not_found'
  | 'inactive'
  | 'not_started'
  | 'expired'
  | 'branch_not_eligible'
  | 'usage_exhausted'
  | 'cart_not_eligible';

/** Honest, ordered reasons (Part I) — mirrors AS POS V1's own
 * `estadoCuponCalculado` precedence exactly (inactive flag beats
 * schedule beats usage). Never leaks anything beyond the reason itself
 * (no internal id, no other customers' redemption data). `redeemedCount`
 * is supplied by the caller (a real, already-locked-and-counted read
 * inside the mutation transaction for an actual redemption — see
 * `promotions.repository.ts` — or a plain unlocked count for a
 * preview/quote, which is explicitly allowed to be stale per Part B
 * "never trust a stale quote blindly", since only the real mutation
 * path is concurrency-authoritative). */
export function evaluateCouponEligibility(
  coupon: CouponRow,
  input: { branchEligible: boolean; redeemedCount: number; cartSubtotalUnits: bigint; now: Date },
): CouponRejectionReason | null {
  if (!coupon.active) return 'inactive';
  if (coupon.startsAt !== null && input.now < coupon.startsAt) return 'not_started';
  if (coupon.endsAt !== null && input.now > coupon.endsAt) return 'expired';
  if (!input.branchEligible) return 'branch_not_eligible';
  if (coupon.usageLimitTotal !== null && input.redeemedCount >= coupon.usageLimitTotal) return 'usage_exhausted';
  if (coupon.minSubtotal !== null && input.cartSubtotalUnits < moneyUnits(coupon.minSubtotal))
    return 'cart_not_eligible';
  return null;
}

function couponDiscountUnits(coupon: CouponRow, remainingUnits: bigint): bigint {
  if (coupon.benefitType === 'percentage') {
    return applyBasisPoints(remainingUnits, coupon.benefitPercentageBasisPoints ?? 0);
  }
  const requested = moneyUnits(coupon.benefitFixedAmount ?? '0');
  return requested > remainingUnits ? remainingUnits : requested;
}

// --- Reward benefit (TASK 13.2, ADR-0019 "Pricing pipeline placement") ----

/** Part B — deliberately the INVERSE of `isLineEligibleForPromotion`'s
 * both-empty-means-everything default: a reward's scope is never treated
 * as "applies to everything" — an empty scope matches NOTHING. A reward
 * program's scope is enforced non-empty at the service layer whenever a
 * benefit is configured (`LoyaltyService`), but this engine never assumes
 * that was actually true — it fails safe (no benefit) rather than fail
 * open (unrestricted benefit) if it somehow wasn't. */
function isLineEligibleForReward(line: PricingResolvedLine, scope: RewardBenefitCandidate['scope']): boolean {
  if (scope.productIds.includes(line.productId)) return true;
  return line.categoryId !== null && scope.categoryIds.includes(line.categoryId);
}

/** Part J "Partial benefit" — ONE entitlement produces ONE benefit
 * event, on exactly ONE scoped line (the eligible line with the LARGEST
 * remaining amount — the most beneficial to the customer, and a
 * deterministic pick when several qualify), never silently discounting
 * every matching line in the cart. This is deliberately uniform across
 * all four benefit types (a `percentage_discount`/`fixed_price`/
 * `fixed_amount_discount` reward is exactly as single-use as a
 * `free_eligible_item` one) — see ADR-0019 for the full reasoning. */
function computeRewardBenefit(
  reward: RewardBenefitCandidate,
  lines: readonly PricingResolvedLine[],
  remainingUnits: readonly bigint[],
): { lineIndex: number; amountUnits: bigint } | null {
  const eligible = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => isLineEligibleForReward(line, reward.scope));
  if (eligible.length === 0) return null;
  let best = eligible[0];
  for (const candidate of eligible) {
    const bestRemaining = best === undefined ? -1n : (remainingUnits[best.index] ?? 0n);
    const candidateRemaining = remainingUnits[candidate.index] ?? 0n;
    if (candidateRemaining > bestRemaining) best = candidate;
  }
  if (best === undefined) return null;
  const remaining = remainingUnits[best.index] ?? 0n;
  if (remaining <= 0n) return null;

  let amountUnits: bigint;
  if (reward.benefitType === 'free_eligible_item') {
    amountUnits = remaining;
  } else if (reward.benefitType === 'percentage_discount') {
    amountUnits = applyBasisPoints(remaining, reward.benefitPercentageBasisPoints ?? 0);
  } else if (reward.benefitType === 'fixed_price') {
    // A promotional per-item PRICE — the discount is however much
    // `remaining` exceeds that price, never negative (a "price" above
    // what's left grants no discount at all).
    const priceUnits = moneyUnits(reward.benefitFixedAmount ?? '0');
    amountUnits = remaining > priceUnits ? remaining - priceUnits : 0n;
  } else {
    // 'fixed_amount_discount' — a flat amount off, capped at what's left.
    const requestedUnits = moneyUnits(reward.benefitFixedAmount ?? '0');
    amountUnits = requestedUnits > remaining ? remaining : requestedUnits;
  }
  if (amountUnits <= 0n) return null;
  return { lineIndex: best.line.lineIndex, amountUnits };
}

// --- Manual discount ------------------------------------------------------

function manualDiscountUnits(
  input: PricingManualDiscountInput,
  remainingUnits: bigint,
): { amountUnits: bigint; basisPoints: number | null } {
  if (input.type === 'percentage') {
    const basisPoints = Number.parseInt(input.value, 10);
    if (!Number.isFinite(basisPoints) || basisPoints <= 0 || basisPoints > 10_000)
      throw new PromotionError('discount_invalid', 'Manual discount percentage is out of range.');
    return { amountUnits: applyBasisPoints(remainingUnits, basisPoints), basisPoints };
  }
  const requested = moneyUnits(input.value);
  if (requested <= 0n) throw new PromotionError('discount_invalid', 'Manual discount amount must be positive.');
  const cappedUnits = requested > remainingUnits ? remainingUnits : requested;
  return { amountUnits: cappedUnits, basisPoints: null };
}

// --- Public entry point ----------------------------------------------------

export interface EvaluatePricingInput {
  branchId: string;
  branchTimezone: string;
  currencyCode: string;
  lines: readonly PricingResolvedLine[];
  promotionCandidates: readonly PromotionCandidate[];
  couponLookup: (
    normalizedCode: string,
  ) => { coupon: CouponRow; branchEligible: boolean; redeemedCount: number } | null;
  requestedCouponCodes: readonly string[];
  /** TASK 13.2 — at most one, already resolved/validated by the caller
   * (Part D "quote/sale creation re-validate, this engine never looks
   * anything up itself"). `null`/`undefined` are both "no reward
   * attached". */
  rewardCandidate?: RewardBenefitCandidate | null;
  manualDiscount?: PricingManualDiscountInput;
  actorPermissions: readonly string[];
  now: Date;
}

export function evaluatePricing(input: EvaluatePricingInput): PricingResult {
  const weekdayAndTime = localWeekdayAndTime(input.now, input.branchTimezone);
  const cartSubtotalUnits = input.lines.reduce((sum, line) => sum + line.grossSubtotalUnits, 0n);

  // 1. Automatic promotions.
  const eligibleCandidates = input.promotionCandidates.filter((candidate) =>
    candidate.scope.branchIds.length === 0 || candidate.scope.branchIds.includes(input.branchId),
  );
  const scored: ScoredPromotion[] = [];
  for (const candidate of eligibleCandidates) {
    const result = computePromotionDiscount(
      candidate.promotion,
      candidate.scope,
      input.lines,
      weekdayAndTime.weekday,
      weekdayAndTime.time,
      input.now,
      cartSubtotalUnits,
    );
    if (result !== null) scored.push(result);
  }
  const selected = selectPromotions(scored);

  const runningDiscountUnits = new Map<number, bigint>(input.lines.map((line) => [line.lineIndex, 0n]));
  const appliedDiscounts: PricingAppliedDiscount[] = [];
  for (const promo of selected) {
    for (const [lineIndex, amountUnits] of promo.perLineDiscountUnits) {
      const line = input.lines.find((candidateLine) => candidateLine.lineIndex === lineIndex);
      if (line === undefined) continue;
      const alreadyDiscounted = runningDiscountUnits.get(lineIndex) ?? 0n;
      // Each stacked promotion is independently computed against the
      // line's ORIGINAL gross subtotal (never against what an earlier
      // stacked promotion already took), so two stackable promotions can
      // nominally sum past 100% of the line (e.g. 60% + 70%) — capped
      // here at what's actually left, never negative, never exceeding
      // the line's own worth (Part E's explicit floor).
      const remainingOnLine = line.grossSubtotalUnits - alreadyDiscounted;
      const cappedAmountUnits = amountUnits > remainingOnLine ? remainingOnLine : amountUnits;
      if (cappedAmountUnits <= 0n) continue;
      runningDiscountUnits.set(lineIndex, alreadyDiscounted + cappedAmountUnits);
      appliedDiscounts.push({
        sourceType: 'promotion',
        sourceId: promo.promotion.id,
        label: promo.promotion.name,
        reasonCode: null,
        basisPoints:
          promo.promotion.benefitType === 'percentage' ? (promo.promotion.benefitPercentageBasisPoints ?? null) : null,
        amountUnits: cappedAmountUnits,
        lineIndex: line.lineIndex,
      });
    }
  }

  const remainingAfterPromotionUnits = input.lines.map(
    (line) => line.grossSubtotalUnits - (runningDiscountUnits.get(line.lineIndex) ?? 0n),
  );
  const cartRemainingAfterPromotionUnits = remainingAfterPromotionUnits.reduce((sum, value) => sum + value, 0n);

  // 2. Coupons — each requested code is resolved and evaluated
  // independently; every applied coupon reduces the SAME running
  // remaining-per-line pool (a second coupon, if the schema ever allowed
  // more than one, would apply against what the first left behind —
  // today's routes only ever accept one code, see ADR-0016, but the
  // engine itself does not hardcode that limit).
  const rejectedCoupons: { code: string; reason: string }[] = [];
  let cartRemainingAfterCouponsUnits = cartRemainingAfterPromotionUnits;
  const remainingAfterCouponsUnits = [...remainingAfterPromotionUnits];
  for (const rawCode of input.requestedCouponCodes) {
    const normalizedCode = rawCode.trim().toUpperCase();
    const lookup = input.couponLookup(normalizedCode);
    if (lookup === null) {
      rejectedCoupons.push({ code: rawCode, reason: 'not_found' });
      continue;
    }
    const combinabilityBlocked = selected.some(
      (promo) => !promo.promotion.combinableWithCoupons,
    );
    if (combinabilityBlocked) {
      rejectedCoupons.push({ code: rawCode, reason: 'cart_not_eligible' });
      continue;
    }
    const reason = evaluateCouponEligibility(lookup.coupon, {
      branchEligible: lookup.branchEligible,
      redeemedCount: lookup.redeemedCount,
      cartSubtotalUnits: cartRemainingAfterCouponsUnits,
      now: input.now,
    });
    if (reason !== null) {
      rejectedCoupons.push({ code: rawCode, reason });
      continue;
    }
    const discountUnits = couponDiscountUnits(lookup.coupon, cartRemainingAfterCouponsUnits);
    if (discountUnits <= 0n) {
      rejectedCoupons.push({ code: rawCode, reason: 'cart_not_eligible' });
      continue;
    }
    const shares = allocateProportionally(discountUnits, remainingAfterCouponsUnits);
    input.lines.forEach((line, index) => {
      const share = shares[index] ?? 0n;
      if (share > 0n) {
        remainingAfterCouponsUnits[index] = (remainingAfterCouponsUnits[index] ?? 0n) - share;
        appliedDiscounts.push({
          sourceType: 'coupon',
          sourceId: lookup.coupon.id,
          label: lookup.coupon.code,
          reasonCode: null,
          basisPoints: lookup.coupon.benefitType === 'percentage' ? (lookup.coupon.benefitPercentageBasisPoints ?? null) : null,
          amountUnits: share,
          lineIndex: line.lineIndex,
        });
      }
    });
    cartRemainingAfterCouponsUnits -= discountUnits;
  }

  // 2.5. Reward benefit (TASK 13.2, ADR-0019 "Pricing pipeline
  // placement") — after promotions and coupons, before the manual
  // discount. Computed against what promotions/coupons already left
  // (so it naturally "stacks" with both, reducing whatever remains,
  // never negative — the identical cascading-and-capping mechanism
  // this engine already uses for coupons, not a new stacking-policy
  // schema; ADR-0019 documents why no explicit combinability flags were
  // added). Always applied BEFORE the manual discount so a cashier's
  // own override authority still operates on top of it if genuinely
  // needed, and so the reward's own benefit is never itself reduced to
  // nothing by an already-applied manual discount consuming the
  // remaining amount first.
  const remainingAfterRewardUnits = [...remainingAfterCouponsUnits];
  if (input.rewardCandidate !== undefined && input.rewardCandidate !== null) {
    const reward = computeRewardBenefit(input.rewardCandidate, input.lines, remainingAfterRewardUnits);
    if (reward !== null) {
      const arrayIndex = input.lines.findIndex((line) => line.lineIndex === reward.lineIndex);
      if (arrayIndex !== -1) {
        remainingAfterRewardUnits[arrayIndex] = (remainingAfterRewardUnits[arrayIndex] ?? 0n) - reward.amountUnits;
        appliedDiscounts.push({
          sourceType: 'reward',
          sourceId: input.rewardCandidate.rewardEntitlementId,
          label: 'Recompensa',
          reasonCode: null,
          basisPoints:
            input.rewardCandidate.benefitType === 'percentage_discount'
              ? input.rewardCandidate.benefitPercentageBasisPoints
              : null,
          amountUnits: reward.amountUnits,
          lineIndex: reward.lineIndex,
        });
      }
    }
  }

  // 3. Manual discount — always the final, authorized-only step.
  const remainingAfterManualUnits = [...remainingAfterRewardUnits];
  if (input.manualDiscount !== undefined) {
    if (!input.actorPermissions.includes('discount.apply'))
      throw new PromotionError(
        'discount_not_authorized',
        'This actor is not authorized to apply a manual discount.',
      );
    const manual = input.manualDiscount;
    if (manual.scope === 'line') {
      const lineIndex = manual.lineIndex;
      if (lineIndex === undefined)
        throw new PromotionError('validation_error', 'A line-scoped manual discount requires line_index.');
      const targetIndex = input.lines.findIndex((line) => line.lineIndex === lineIndex);
      if (targetIndex === -1)
        throw new PromotionError('validation_error', 'The manual discount line_index does not match any item.');
      const remaining = remainingAfterManualUnits[targetIndex] ?? 0n;
      const { amountUnits, basisPoints } = manualDiscountUnits(manual, remaining);
      if (amountUnits > 0n) {
        remainingAfterManualUnits[targetIndex] = remaining - amountUnits;
        appliedDiscounts.push({
          sourceType: 'manual',
          sourceId: null,
          label: 'Descuento manual',
          reasonCode: manual.reasonCode,
          basisPoints,
          amountUnits,
          lineIndex: input.lines[targetIndex]?.lineIndex ?? lineIndex,
        });
      }
    } else {
      const cartRemaining = remainingAfterManualUnits.reduce((sum, value) => sum + value, 0n);
      const { amountUnits } = manualDiscountUnits(manual, cartRemaining);
      if (amountUnits > 0n) {
        const shares = allocateProportionally(amountUnits, remainingAfterManualUnits);
        input.lines.forEach((line, index) => {
          const share = shares[index] ?? 0n;
          if (share > 0n) {
            remainingAfterManualUnits[index] = (remainingAfterManualUnits[index] ?? 0n) - share;
            appliedDiscounts.push({
              sourceType: 'manual',
              sourceId: null,
              label: 'Descuento manual',
              reasonCode: manual.reasonCode,
              basisPoints: null,
              amountUnits: share,
              lineIndex: line.lineIndex,
            });
          }
        });
      }
    }
  }

  // 4. Fold every line's own gross/discount/tax into its final shape,
  // then sum into the sale-level aggregate — the aggregate is always the
  // literal sum of the lines, never independently computed, so it can
  // never drift from `sales_arithmetic_ck`'s own line-sum expectation.
  const resolvedLines: PricingResolvedLine[] = input.lines.map((line, index) => {
    const netSubtotalUnits = remainingAfterManualUnits[index] ?? line.grossSubtotalUnits;
    const discountUnits = line.grossSubtotalUnits - netSubtotalUnits;
    const discountBasisPoints = impliedBasisPoints(discountUnits, line.grossSubtotalUnits);
    const taxUnits = applyBasisPoints(netSubtotalUnits, line.taxBasisPoints);
    return {
      ...line,
      discountUnits,
      discountBasisPoints,
      netSubtotalUnits,
      taxUnits,
      lineTotalUnits: netSubtotalUnits + taxUnits,
    };
  });

  const subtotalUnits = resolvedLines.reduce((sum, line) => sum + line.grossSubtotalUnits, 0n);
  const discountTotalUnits = resolvedLines.reduce((sum, line) => sum + line.discountUnits, 0n);
  const taxTotalUnits = resolvedLines.reduce((sum, line) => sum + line.taxUnits, 0n);
  const totalUnits = subtotalUnits - discountTotalUnits + taxTotalUnits;

  return {
    currencyCode: input.currencyCode,
    lines: resolvedLines,
    appliedDiscounts,
    subtotalUnits,
    discountTotalUnits,
    taxTotalUnits,
    totalUnits,
    rejectedCoupons,
  };
}

export { moneyUnits };
