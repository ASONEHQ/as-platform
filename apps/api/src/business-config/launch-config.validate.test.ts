import { describe, expect, it } from 'vitest';

import { BusinessConfigInputError } from './business-config.types.js';
import { validateLaunchConfig } from './launch-config.validate.js';

/** TASK 16.17 — the launch-config tool inserts companies/branches directly
 * (not through `AdministrationService`), so it must apply the same timezone
 * and currency safety every other write path already has. */
function config(overrides: { company?: Record<string, unknown>; branchTimezone?: string } = {}): unknown {
  return {
    company: {
      legal_name: 'Generic QA Merchant',
      display_name: 'Generic QA Merchant',
      slug: 'generic-qa-merchant',
      timezone: 'America/New_York',
      currency_code: 'USD',
      locale: 'en-US',
      ...overrides.company,
    },
    branches: [{ name: 'Main', code: 'MAIN', timezone: overrides.branchTimezone ?? 'America/New_York' }],
    registers: [],
    roles: [],
    users: [],
    categories: [],
    products: [],
    inventory_opening_balances: [],
    rewards: {
      enabled: false,
      program_name: 'Program',
      unit_type: 'stamp',
      earn_quantity_per_sale: 1,
      reward_threshold: 5,
      reward_type: 'vip_pass',
      reward_benefit_type: 'free_eligible_item',
      reward_benefit_scope_product_codes: [],
    },
    promotions: [],
  };
}

describe('launch config company/branch safety (TASK 16.17)', () => {
  it('accepts a supported non-MXN currency and a real non-Mexican IANA timezone', () => {
    const parsed = validateLaunchConfig(config());
    expect(parsed.company.currency_code).toBe('USD');
    expect(parsed.company.timezone).toBe('America/New_York');
  });

  it('rejects the non-IANA "Mexico_City" company timezone that once broke POST /sales', () => {
    expect(() => validateLaunchConfig(config({ company: { timezone: 'Mexico_City' } }))).toThrow(BusinessConfigInputError);
    expect(() => validateLaunchConfig(config({ company: { timezone: 'Mexico_City' } }))).toThrow(/valid IANA timezone/u);
  });

  it('rejects a non-IANA branch timezone with the failing path in the message', () => {
    expect(() => validateLaunchConfig(config({ branchTimezone: 'Mexico_City' }))).toThrow(/branches\[0\]\.timezone/u);
  });

  it('rejects a syntactically valid but unsupported currency', () => {
    expect(() => validateLaunchConfig(config({ company: { currency_code: 'EUR' } }))).toThrow(/supported currency/u);
  });
});
