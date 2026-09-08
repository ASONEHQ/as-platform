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
}

export interface PartyQuoteBreakdown {
  base: string;
  childrenExtra: string;
  adultsExtra: string;
  timeExtra: string;
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
  const totalUnits = baseUnits + childrenExtraUnits + adultsExtraUnits + timeExtraUnits;

  return {
    base: formatMoney(baseUnits),
    childrenExtra: formatMoney(childrenExtraUnits),
    adultsExtra: formatMoney(adultsExtraUnits),
    timeExtra: formatMoney(timeExtraUnits),
    total: formatMoney(totalUnits),
  };
}
