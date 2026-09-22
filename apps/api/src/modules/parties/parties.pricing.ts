import { ivaBasisPointsForTaxCode, type ProductTaxCode } from '@asone/database';

import { PartyError } from './parties.types.js';

/**
 * TASK 14.3 Part A.6/A.9 — exact BigInt fixed-point money arithmetic
 * (ADR-0001), the same `numeric(19,4)` scale every other module in this
 * codebase uses; never floating point. A module-local copy, matching this
 * codebase's established "no cross-module import of this small helper
 * set" discipline (see `refunds.service.ts`'s own doc comment).
 */
const MONEY_SCALE = 10_000n;

export function moneyUnits(value: string, field = 'amount'): bigint {
  const match = /^-?(\d{1,19})(?:\.(\d{1,4}))?$/u.exec(value);
  if (match?.[1] === undefined) throw new PartyError('validation_error', `${field} is invalid.`);
  const negative = value.startsWith('-');
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? '').padEnd(4, '0'));
  const units = whole * MONEY_SCALE + fraction;
  return negative ? -units : units;
}
export function formatMoney(units: bigint): string {
  const negative = units < 0n;
  const magnitude = negative ? -units : units;
  const whole = magnitude / MONEY_SCALE;
  const fraction = (magnitude % MONEY_SCALE).toString().padStart(4, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fraction}`;
}
export function nonNegativeMoney(value: string, field: string): string {
  const units = moneyUnits(value, field);
  if (units < 0n) throw new PartyError('validation_error', `${field} cannot be negative.`);
  return formatMoney(units);
}
export function positiveMoney(value: string, field: string): string {
  const units = moneyUnits(value, field);
  if (units <= 0n) throw new PartyError('validation_error', `${field} must be greater than zero.`);
  return formatMoney(units);
}
export function nonBlank(value: string, field: string, maxLength = 200): string {
  const clean = value.trim();
  if (clean.length === 0) throw new PartyError('validation_error', `${field} cannot be blank.`);
  if (clean.length > maxLength) throw new PartyError('validation_error', `${field} is too long.`);
  return clean;
}
export function nonNegativeInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0)
    throw new PartyError('validation_error', `${field} must be a non-negative integer.`);
  return value;
}

/**
 * TASK 14.3 Part A.6 (Cotizador) — the recovered `cotizadorActualizar()`
 * formula (recovery doc Capability 6), kept STRUCTURED this time (a real
 * itemized breakdown is returned, never collapsed into one opaque total
 * string the way the legacy `saldo` field was): `total = package.price +
 * max(0, children - childrenIncluded) * childExtraCost + max(0, adults -
 * adultsIncluded) * adultExtraCost + extraHalfHours * extraHalfHourCost`.
 * Pure and deterministic — no I/O, no `Date.now()`, exact BigInt
 * arithmetic throughout — so `POST /party-packages/:id/quote` and
 * `PartyReservationsService`'s own `quotedTotal` freeze at booking time
 * both call this SAME function rather than duplicating the formula (see
 * the task's own explicit instruction).
 */
export interface PartyQuoteInput {
  price: string;
  childrenIncluded: number;
  adultsIncluded: number;
  childExtraCost: string;
  adultExtraCost: string;
  extraHalfHourCost: string;
  children: number;
  adults: number;
  extraHalfHours: number;
  // TASK 16.19 — the package's own real tax classification (see
  // `party_packages.tax_code`'s own doc comment). Required, never
  // defaulted silently inside this function — a caller that hasn't
  // resolved a real package row has no business computing a quote.
  taxCode: ProductTaxCode;
}

export interface PartyQuoteBreakdown {
  base: string;
  childrenExtra: string;
  adultsExtra: string;
  timeExtra: string;
  /** package + extras, before tax (Phase 10's "SUBTOTAL"). */
  subtotal: string;
  /** Always `"0.0000"` today — no discount mechanism is wired into party
   * pricing yet (see `docs/LEGACY_FUNCTIONAL_PARITY.md`'s TASK 16.19
   * section). Present so callers/consumers have one stable breakdown
   * shape to read from, exactly mirroring `sale_items`'s own
   * subtotal/discount/tax/total shape, rather than a party-specific one
   * that would need reshaping the day a discount IS wired in. */
  discountTotal: string;
  taxTotal: string;
  /** subtotal − discountTotal + taxTotal (Phase 10's "TOTAL"). */
  total: string;
}

export function computePartyQuote(input: PartyQuoteInput): PartyQuoteBreakdown {
  const children = nonNegativeInteger(input.children, 'children');
  const adults = nonNegativeInteger(input.adults, 'adults');
  const extraHalfHours = nonNegativeInteger(input.extraHalfHours, 'extra_half_hours');

  const baseUnits = moneyUnits(input.price, 'price');
  const extraChildren = Math.max(0, children - input.childrenIncluded);
  const extraAdults = Math.max(0, adults - input.adultsIncluded);
  const childrenExtraUnits = moneyUnits(input.childExtraCost, 'child_extra_cost') * BigInt(extraChildren);
  const adultsExtraUnits = moneyUnits(input.adultExtraCost, 'adult_extra_cost') * BigInt(extraAdults);
  const timeExtraUnits = moneyUnits(input.extraHalfHourCost, 'extra_half_hour_cost') * BigInt(extraHalfHours);
  const subtotalUnits = baseUnits + childrenExtraUnits + adultsExtraUnits + timeExtraUnits;

  // TASK 16.19 — same exact-BigInt basis-points rounding
  // (`sales.service.ts`'s own `applyBasisPoints` shape, module-local
  // here per this file's established "no cross-module pricing-math
  // import" discipline) applied to the package's own tax classification.
  const basisPoints = BigInt(ivaBasisPointsForTaxCode(input.taxCode));
  const taxTotalUnits = (subtotalUnits * basisPoints + 5_000n) / 10_000n;
  const totalUnits = subtotalUnits + taxTotalUnits;

  return {
    base: formatMoney(baseUnits),
    childrenExtra: formatMoney(childrenExtraUnits),
    adultsExtra: formatMoney(adultsExtraUnits),
    timeExtra: formatMoney(timeExtraUnits),
    subtotal: formatMoney(subtotalUnits),
    discountTotal: formatMoney(0n),
    taxTotal: formatMoney(taxTotalUnits),
    total: formatMoney(totalUnits),
  };
}

/**
 * TASK 16.19 (Phase 8/30 "capacity if applicable") — a room/package's
 * capacity fields (`party_rooms.capacity_children/adults/total`,
 * `party_packages.capacity_max`) existed since TASK 14.3 but were never
 * enforced against an actual booking; an operator could book a 10-guest
 * room for a 40-child party. Each check only fires when the relevant
 * field is actually configured (`null` = "no limit set for this field,"
 * never treated as `0`) — matching every other "if applicable" capacity
 * rule in this codebase (e.g. `party_rooms.capacity_*` columns' own
 * nullable design). Throws the FIRST violated rule found, in a stable,
 * predictable order (room-total → room-children → room-adults →
 * package-max), never a partial/ambiguous multi-error report.
 */
export function assertWithinCapacity(input: {
  roomCapacityTotal: number | null;
  roomCapacityChildren: number | null;
  roomCapacityAdults: number | null;
  packageCapacityMax: number | null;
  children: number;
  adults: number;
}): void {
  const totalGuests = input.children + input.adults;
  if (input.roomCapacityTotal !== null && totalGuests > input.roomCapacityTotal) {
    throw new PartyError(
      'capacity_exceeded',
      `This room's capacity is ${String(input.roomCapacityTotal)} guests; ${String(totalGuests)} were requested.`,
      { limit: 'room_total', capacity: input.roomCapacityTotal, requested: totalGuests },
    );
  }
  if (input.roomCapacityChildren !== null && input.children > input.roomCapacityChildren) {
    throw new PartyError(
      'capacity_exceeded',
      `This room's children capacity is ${String(input.roomCapacityChildren)}; ${String(input.children)} were requested.`,
      { limit: 'room_children', capacity: input.roomCapacityChildren, requested: input.children },
    );
  }
  if (input.roomCapacityAdults !== null && input.adults > input.roomCapacityAdults) {
    throw new PartyError(
      'capacity_exceeded',
      `This room's adults capacity is ${String(input.roomCapacityAdults)}; ${String(input.adults)} were requested.`,
      { limit: 'room_adults', capacity: input.roomCapacityAdults, requested: input.adults },
    );
  }
  if (input.packageCapacityMax !== null && totalGuests > input.packageCapacityMax) {
    throw new PartyError(
      'capacity_exceeded',
      `This package's capacity is ${String(input.packageCapacityMax)} guests; ${String(totalGuests)} were requested.`,
      { limit: 'package_max', capacity: input.packageCapacityMax, requested: totalGuests },
    );
  }
}

/**
 * TASK 16.19 (Phase 6 "room usage") — recovers legacy's per-room
 * `salonesDisponibles[]` package restriction (documented at the time of
 * TASK 14.3 as a deliberately deferred simplification — see
 * `party_packages.restrictions`' own doc comment in the schema file) as
 * `restrictions.eligibleRoomIds?: string[]`. Absent, not-an-array, or
 * empty all mean "every room is eligible" (backward compatible with
 * every package that existed before this task); a non-empty array
 * narrows eligibility to exactly those room ids.
 */
export function isRoomEligibleForPackage(
  restrictions: Readonly<Record<string, unknown>> | null,
  roomId: string,
): boolean {
  const raw = restrictions?.['eligibleRoomIds'];
  if (!Array.isArray(raw) || raw.length === 0) return true;
  return raw.includes(roomId);
}

/** TASK 16.19 — the tax classification to charge a snack line at: the
 * linked catalog product's own real `tax_code` when one exists, or the
 * reservation's own package `tax_code` as the honest default for a
 * genuinely custom, catalog-less snack (there is no other tax signal to
 * derive one from) — never a hardcoded assumption. */
export function resolveSnackTaxCode(
  productTaxCode: ProductTaxCode | null,
  packageTaxCode: ProductTaxCode,
): ProductTaxCode {
  return productTaxCode ?? packageTaxCode;
}

export function computeLineTax(unitPriceSnapshot: string, quantity: string, taxCode: ProductTaxCode): { taxTotal: string; taxSnapshot: Readonly<Record<string, unknown>> } {
  const quantityUnits = BigInt(Math.round(Number(quantity) * 1_000_000));
  const subtotalUnits = (moneyUnits(unitPriceSnapshot, 'unit_price_snapshot') * quantityUnits) / 1_000_000n;
  const basisPoints = ivaBasisPointsForTaxCode(taxCode);
  const taxUnits = (subtotalUnits * BigInt(basisPoints) + 5_000n) / 10_000n;
  return {
    taxTotal: formatMoney(taxUnits),
    taxSnapshot: { tax_code: taxCode, basis_points: basisPoints },
  };
}
