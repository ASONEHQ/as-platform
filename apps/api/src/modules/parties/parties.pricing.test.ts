import { describe, expect, it } from 'vitest';

import { computePartyQuote, formatMoney, moneyUnits } from './parties.pricing.js';

/** TASK 14.3 Part A.6 (Cotizador) — exact, deterministic quote math. Every
 * assertion below compares exact decimal strings, never floating point
 * (ADR-0001) — see the task's own explicit testing requirement. */
describe('computePartyQuote (Cotizador)', () => {
  const basePackage = {
    price: '3500.0000',
    childrenIncluded: 10,
    adultsIncluded: 5,
    childExtraCost: '80.0000',
    adultExtraCost: '50.0000',
    extraHalfHourCost: '250.0000',
  };

  it('returns just the base price when guests are within the included counts and no extra time is requested', () => {
    const result = computePartyQuote({ ...basePackage, children: 8, adults: 3, extraHalfHours: 0 });
    expect(result).toEqual({
      base: '3500.0000',
      childrenExtra: '0.0000',
      adultsExtra: '0.0000',
      timeExtra: '0.0000',
      total: '3500.0000',
    });
  });

  it('charges only for children/adults over the included count, never for guests within it', () => {
    // 15 children (10 included -> 5 extra @ 80.00 = 400.00), 8 adults (5
    // included -> 3 extra @ 50.00 = 150.00), 2 extra half hours @ 250.00 = 500.00.
    const result = computePartyQuote({ ...basePackage, children: 15, adults: 8, extraHalfHours: 2 });
    expect(result).toEqual({
      base: '3500.0000',
      childrenExtra: '400.0000',
      adultsExtra: '150.0000',
      timeExtra: '500.0000',
      total: '4550.0000',
    });
  });

  it('never charges a negative extra when guests are exactly at the included count', () => {
    const result = computePartyQuote({ ...basePackage, children: 10, adults: 5, extraHalfHours: 0 });
    expect(result.childrenExtra).toBe('0.0000');
    expect(result.adultsExtra).toBe('0.0000');
    expect(result.total).toBe('3500.0000');
  });

  it('computes exactly for a single extra child, single extra adult, and one extra half hour', () => {
    const result = computePartyQuote({ ...basePackage, children: 11, adults: 6, extraHalfHours: 1 });
    expect(result).toEqual({
      base: '3500.0000',
      childrenExtra: '80.0000',
      adultsExtra: '50.0000',
      timeExtra: '250.0000',
      total: '3880.0000',
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
    });
    expect(result.total).toBe('1000.0000');
  });
});

describe('money helpers (exact BigInt fixed-point arithmetic)', () => {
  it('round-trips a decimal string through moneyUnits/formatMoney exactly', () => {
    expect(formatMoney(moneyUnits('123.4500'))).toBe('123.4500');
    expect(formatMoney(moneyUnits('0.0001'))).toBe('0.0001');
    expect(formatMoney(moneyUnits('1000000'))).toBe('1000000.0000');
  });
});
