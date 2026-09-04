import { describe, expect, it } from 'vitest';

import { normalizeEmail, normalizePhone } from './phone-normalization.js';

describe('phone normalization (TASK 13.0 Part C)', () => {
  it('normalizes an explicit +52 Mexican mobile number to E.164', () => {
    const result = normalizePhone('+52 442 123 4567', null);
    expect(result.normalizedPhone).toBe('+524421234567');
    expect(result.countryCode).toBe('MX');
  });

  it('normalizes a local 10-digit number using the company default country, when configured', () => {
    const result = normalizePhone('442-123-4567', 'MX');
    expect(result.normalizedPhone).toBe('+524421234567');
    expect(result.countryCode).toBe('MX');
  });

  it('never guesses a country: a bare local number with no configured default stays unnormalized', () => {
    const result = normalizePhone('442-123-4567', null);
    expect(result.normalizedPhone).toBeNull();
    expect(result.countryCode).toBeNull();
  });

  it('rejects an invalid/too-short number even with a default country configured', () => {
    const result = normalizePhone('123', 'MX');
    expect(result.normalizedPhone).toBeNull();
  });

  it('returns null for an empty/blank phone string', () => {
    expect(normalizePhone('', 'MX').normalizedPhone).toBeNull();
    expect(normalizePhone('   ', 'MX').normalizedPhone).toBeNull();
  });

  it('never throws on garbage input', () => {
    expect(() => normalizePhone('not a phone number at all !!!', 'MX')).not.toThrow();
    expect(normalizePhone('not a phone number at all !!!', 'MX').normalizedPhone).toBeNull();
  });
});

describe('email normalization (TASK 13.0 Part C)', () => {
  it('trims and lowercases a valid email', () => {
    expect(normalizeEmail('  Ana.Garcia@Example.COM  ')).toBe('ana.garcia@example.com');
  });

  it('rejects a malformed email', () => {
    expect(normalizeEmail('not-an-email')).toBeNull();
    expect(normalizeEmail('missing@domain')).toBeNull();
    expect(normalizeEmail('@example.com')).toBeNull();
  });

  it('returns null for an empty/blank string', () => {
    expect(normalizeEmail('')).toBeNull();
    expect(normalizeEmail('   ')).toBeNull();
  });
});
