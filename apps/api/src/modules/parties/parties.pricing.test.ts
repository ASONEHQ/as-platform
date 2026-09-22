import { describe, expect, it } from 'vitest';

import {
  assertWithinCapacity,
  computeLineTax,
  computePartyQuote,
  formatMoney,
  isRoomEligibleForPackage,
  moneyUnits,
  resolveSnackTaxCode,
} from './parties.pricing.js';
import { PartyError } from './parties.types.js';

/** TASK 14.3 Part A.6 (Cotizador) — exact, deterministic quote math.
 * TASK 16.19 extends this with tax (Phase 10's "...+ taxes = total").
 * Every assertion below compares exact decimal strings, never floating
 * point (ADR-0001) — see the task's own explicit testing requirement. */
describe('computePartyQuote (Cotizador)', () => {
  const basePackage = {
    price: '3500.0000',
    childrenIncluded: 10,
    adultsIncluded: 5,
    childExtraCost: '80.0000',
    adultExtraCost: '50.0000',
    extraHalfHourCost: '250.0000',
    taxCode: 'IVA_GENERAL' as const,
  };

  it('returns just the base price (plus tax) when guests are within the included counts and no extra time is requested', () => {
    const result = computePartyQuote({ ...basePackage, children: 8, adults: 3, extraHalfHours: 0 });
    expect(result).toEqual({
      base: '3500.0000',
      childrenExtra: '0.0000',
      adultsExtra: '0.0000',
      timeExtra: '0.0000',
      subtotal: '3500.0000',
      discountTotal: '0.0000',
      taxTotal: '560.0000',
      total: '4060.0000',
    });
  });

  it('charges only for children/adults over the included count, never for guests within it', () => {
    // 15 children (10 included -> 5 extra @ 80.00 = 400.00), 8 adults (5
    // included -> 3 extra @ 50.00 = 150.00), 2 extra half hours @ 250.00 = 500.00.
    // subtotal 4550.00, tax 16% = 728.00, total 5278.00.
    const result = computePartyQuote({ ...basePackage, children: 15, adults: 8, extraHalfHours: 2 });
    expect(result).toEqual({
      base: '3500.0000',
      childrenExtra: '400.0000',
      adultsExtra: '150.0000',
      timeExtra: '500.0000',
      subtotal: '4550.0000',
      discountTotal: '0.0000',
      taxTotal: '728.0000',
      total: '5278.0000',
    });
  });

  it('never charges a negative extra when guests are exactly at the included count', () => {
    const result = computePartyQuote({ ...basePackage, children: 10, adults: 5, extraHalfHours: 0 });
    expect(result.childrenExtra).toBe('0.0000');
    expect(result.adultsExtra).toBe('0.0000');
    expect(result.subtotal).toBe('3500.0000');
    expect(result.total).toBe('4060.0000');
  });

  it('computes exactly for a single extra child, single extra adult, and one extra half hour', () => {
    // subtotal 3880.00, tax 16% = 620.80, total 4500.80.
    const result = computePartyQuote({ ...basePackage, children: 11, adults: 6, extraHalfHours: 1 });
    expect(result).toEqual({
      base: '3500.0000',
      childrenExtra: '80.0000',
      adultsExtra: '50.0000',
      timeExtra: '250.0000',
      subtotal: '3880.0000',
      discountTotal: '0.0000',
      taxTotal: '620.8000',
      total: '4500.8000',
    });
  });

  it('is deterministic across repeated calls with identical input (no hidden state, no Date.now dependency)', () => {
    const input = { ...basePackage, children: 20, adults: 10, extraHalfHours: 3 };
    const first = computePartyQuote(input);
    const second = computePartyQuote(input);
    expect(first).toEqual(second);
  });

  it('handles a zero-cost package (free extras) without producing NaN or floating point drift', () => {
    const result = computePartyQuote({
      price: '1000.0000',
      childrenIncluded: 0,
      adultsIncluded: 0,
      childExtraCost: '0.0000',
      adultExtraCost: '0.0000',
      extraHalfHourCost: '0.0000',
      children: 50,
      adults: 50,
      extraHalfHours: 10,
      taxCode: 'IVA_EXEMPT',
    });
    expect(result.subtotal).toBe('1000.0000');
    expect(result.taxTotal).toBe('0.0000');
    expect(result.total).toBe('1000.0000');
  });

  it('charges zero tax for an IVA_EXEMPT package', () => {
    const result = computePartyQuote({ ...basePackage, taxCode: 'IVA_EXEMPT', children: 8, adults: 3, extraHalfHours: 0 });
    expect(result.taxTotal).toBe('0.0000');
    expect(result.total).toBe('3500.0000');
  });
});

describe('money helpers (exact BigInt fixed-point arithmetic)', () => {
  it('round-trips a decimal string through moneyUnits/formatMoney exactly', () => {
    expect(formatMoney(moneyUnits('123.4500'))).toBe('123.4500');
    expect(formatMoney(moneyUnits('0.0001'))).toBe('0.0001');
    expect(formatMoney(moneyUnits('1000000'))).toBe('1000000.0000');
  });
});

/** TASK 16.19 (Phase 8/30 "capacity if applicable") — room/package
 * capacity enforcement. Each rule only fires when the corresponding
 * field is actually configured (never treats `null` as `0`). */
describe('assertWithinCapacity', () => {
  const withinAllLimits = {
    roomCapacityTotal: 40,
    roomCapacityChildren: 30,
    roomCapacityAdults: 20,
    packageCapacityMax: 35,
  };

  it('allows a booking within every configured limit', () => {
    expect(() => assertWithinCapacity({ ...withinAllLimits, children: 20, adults: 10 })).not.toThrow();
  });

  it('rejects when total guests exceed the room total capacity', () => {
    expect(() => assertWithinCapacity({ ...withinAllLimits, children: 25, adults: 20 })).toThrow(PartyError);
  });

  it('rejects when children exceed the room children capacity even if total guests fit', () => {
    expect(() =>
      assertWithinCapacity({ ...withinAllLimits, roomCapacityTotal: 100, children: 35, adults: 0 }),
    ).toThrow(PartyError);
  });

  it('rejects when adults exceed the room adults capacity even if total guests fit', () => {
    expect(() =>
      assertWithinCapacity({ ...withinAllLimits, roomCapacityTotal: 100, children: 0, adults: 25 }),
    ).toThrow(PartyError);
  });

  it('rejects when total guests exceed the package capacity max', () => {
    expect(() =>
      assertWithinCapacity({ ...withinAllLimits, roomCapacityTotal: 100, roomCapacityChildren: 100, roomCapacityAdults: 100, children: 20, adults: 20 }),
    ).toThrow(PartyError);
  });

  it('never treats an unconfigured (null) capacity field as zero', () => {
    expect(() =>
      assertWithinCapacity({
        roomCapacityTotal: null,
        roomCapacityChildren: null,
        roomCapacityAdults: null,
        packageCapacityMax: null,
        children: 500,
        adults: 500,
      }),
    ).not.toThrow();
  });

  it('reports which limit was violated via error.details', () => {
    expect.assertions(3);
    try {
      assertWithinCapacity({ ...withinAllLimits, children: 100, adults: 0 });
    } catch (error) {
      expect(error).toBeInstanceOf(PartyError);
      expect((error as PartyError).code).toBe('capacity_exceeded');
      expect((error as PartyError).details?.['limit']).toBe('room_total');
    }
  });
});

/** TASK 16.19 (Phase 6 "room usage") — per-room package eligibility via
 * `restrictions.eligibleRoomIds`. */
describe('isRoomEligibleForPackage', () => {
  it('treats a package with no restrictions object as eligible for every room', () => {
    expect(isRoomEligibleForPackage(null, 'room-1')).toBe(true);
  });

  it('treats an empty eligibleRoomIds array as eligible for every room (backward compatible)', () => {
    expect(isRoomEligibleForPackage({ eligibleRoomIds: [] }, 'room-1')).toBe(true);
  });

  it('treats restrictions with no eligibleRoomIds key as eligible for every room', () => {
    expect(isRoomEligibleForPackage({ minInvitados: 5 }, 'room-1')).toBe(true);
  });

  it('narrows eligibility to exactly the listed room ids', () => {
    const restrictions = { eligibleRoomIds: ['room-1', 'room-2'] };
    expect(isRoomEligibleForPackage(restrictions, 'room-1')).toBe(true);
    expect(isRoomEligibleForPackage(restrictions, 'room-3')).toBe(false);
  });
});

describe('resolveSnackTaxCode', () => {
  it('prefers the linked product tax code when present', () => {
    expect(resolveSnackTaxCode('IVA_EXEMPT', 'IVA_GENERAL')).toBe('IVA_EXEMPT');
  });

  it('falls back to the package tax code for a custom, catalog-less snack', () => {
    expect(resolveSnackTaxCode(null, 'IVA_GENERAL')).toBe('IVA_GENERAL');
  });
});

describe('computeLineTax', () => {
  it('computes tax-inclusive-ready tax total and a stable snapshot shape', () => {
    const result = computeLineTax('50.0000', '2', 'IVA_GENERAL');
    expect(result.taxTotal).toBe('16.0000'); // 50*2=100 subtotal, 16% = 16.00
    expect(result.taxSnapshot).toEqual({ tax_code: 'IVA_GENERAL', basis_points: 1600 });
  });

  it('charges zero tax for an exempt line', () => {
    const result = computeLineTax('50.0000', '2', 'IVA_EXEMPT');
    expect(result.taxTotal).toBe('0.0000');
    expect(result.taxSnapshot).toEqual({ tax_code: 'IVA_EXEMPT', basis_points: 0 });
  });
});
