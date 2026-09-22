import { describe, expect, it } from 'vitest';

import { canonicalCashDenominationsForCurrency } from '../cash/cash.types.js';
import { supportedCompanyCurrencyCodes } from '../cash/supported-currencies.js';
import { evaluateReadiness } from './readiness.evaluator.js';
import type { BranchFacts, CompanyFacts, ReadinessFacts, ReadinessStage, TenantReadiness } from './readiness.types.js';

const now = new Date('2026-09-21T12:00:00.000Z');

const company: CompanyFacts = {
  id: 'company-1',
  displayName: 'Generic Merchant',
  status: 'active',
  timezone: 'America/Mexico_City',
  currencyCode: 'MXN',
  activeBranchCount: 1,
};

/** A fully sell-ready, non-inventory branch. Every test below starts from
 * this and removes exactly one prerequisite. */
const readyBranch: BranchFacts = {
  id: 'branch-1',
  code: 'B1',
  name: 'Generic Branch',
  timezone: 'America/Mexico_City',
  areaCount: 0,
  registerCount: 1,
  registersWithForeignAreaCount: 0,
  openSessionCount: 0,
  posEntryOperatorCount: 1,
  cashOperatorCount: 1,
  cashOperatorWithRegisterCount: 1,
  activeProductCount: 1,
  pricedProductCount: 1,
  unpricedProducts: [],
  unpricedProductCount: 0,
  foreignCurrencyPriceProducts: [],
  foreignCurrencyPriceProductCount: 0,
  trackedProductCount: 0,
  trackedWithoutStock: [],
  trackedWithoutStockCount: 0,
  locationCount: 0,
  defaultLocationCount: 0,
  defaultLocationReceivingCount: 0,
  sellableProductCount: 1,
};

function evaluate(overrides: Partial<BranchFacts> = {}, companyOverrides: Partial<CompanyFacts> = {}): TenantReadiness {
  const facts: ReadinessFacts = {
    company: { ...company, ...companyOverrides },
    branches: [{ ...readyBranch, ...overrides }],
  };
  return evaluateReadiness(facts, now);
}
function stage(result: TenantReadiness, key: ReadinessStage['key']): ReadinessStage {
  const found = result.branches[0]?.stages.find((entry) => entry.key === key);
  if (found === undefined) throw new Error(`stage ${key} missing`);
  return found;
}
function checkStatus(result: TenantReadiness, code: string): string | undefined {
  return [...result.company.checks, ...(result.branches[0]?.checks ?? [])].find((entry) => entry.code === code)?.status;
}

describe('supported currencies', () => {
  it('every supported company currency has an approved cash-denomination set (no drift)', () => {
    for (const code of supportedCompanyCurrencyCodes)
      expect(() => canonicalCashDenominationsForCurrency(code)).not.toThrow();
  });
});

describe('evaluateReadiness (TASK 16.17)', () => {
  it('a fully configured non-inventory branch is ready at every applicable stage', () => {
    const result = evaluate();
    expect(result.company.administrationReady).toBe(true);
    expect(stage(result, 'administration').ready).toBe(true);
    expect(stage(result, 'pos_entry').ready).toBe(true);
    expect(stage(result, 'register_open').ready).toBe(true);
    expect(stage(result, 'sale').ready).toBe(true);
    // Nothing tracked, no location: inventory does not apply — never a fake green or red.
    expect(stage(result, 'inventory').ready).toBeNull();
  });

  it('operational areas are OPTIONAL: none configured never blocks anything', () => {
    const result = evaluate({ areaCount: 0 });
    expect(checkStatus(result, 'operational_areas')).toBe('optional_missing');
    const areas = result.branches[0]?.checks.find((entry) => entry.code === 'operational_areas');
    expect(areas?.required).toBe(false);
    expect(stage(result, 'sale').ready).toBe(true);
  });

  it('an open cash session is informational — its absence never blocks a stage', () => {
    const result = evaluate({ openSessionCount: 0 });
    expect(checkStatus(result, 'cash_session_open')).toBe('optional_missing');
    expect(stage(result, 'register_open').ready).toBe(true);
  });

  it('no register blocks POS entry, register opening and sale', () => {
    const result = evaluate({ registerCount: 0 });
    expect(stage(result, 'pos_entry').blockedBy).toContain('register_exists');
    expect(stage(result, 'register_open').blockedBy).toContain('register_exists');
    expect(stage(result, 'sale').ready).toBe(false);
    expect(stage(result, 'administration').ready).toBe(true);
  });

  it('no authorized user blocks register opening; a user who can only reach the POS still enters it', () => {
    const result = evaluate({ cashOperatorCount: 0, cashOperatorWithRegisterCount: 0 });
    expect(stage(result, 'register_open').blockedBy).toContain('operator_authorized');
    expect(stage(result, 'pos_entry').ready).toBe(true);
    const none = evaluate({ posEntryOperatorCount: 0, cashOperatorCount: 0, cashOperatorWithRegisterCount: 0 });
    expect(stage(none, 'pos_entry').blockedBy).toContain('operator_authorized');
  });

  it('a user whose register grants match no register of the branch is a distinct, named blocker', () => {
    const result = evaluate({ cashOperatorCount: 1, cashOperatorWithRegisterCount: 0 });
    expect(checkStatus(result, 'operator_register_access')).toBe('missing');
    expect(stage(result, 'register_open').blockedBy).toContain('operator_register_access');
  });

  it('no product blocks the sale stage and names the catalogue as the blocker', () => {
    const result = evaluate({ activeProductCount: 0, pricedProductCount: 0, sellableProductCount: 0 });
    expect(checkStatus(result, 'catalog_products')).toBe('missing');
    expect(stage(result, 'sale').blockedBy).toEqual(['catalog_products']);
    expect(stage(result, 'register_open').ready).toBe(true);
  });

  it('products but none priced: "missing price" is the diagnosis, and the offenders are named', () => {
    const result = evaluate({
      activeProductCount: 1,
      pricedProductCount: 0,
      unpricedProductCount: 1,
      unpricedProducts: [{ id: 'p1', label: 'Product X' }],
      sellableProductCount: 0,
    });
    expect(checkStatus(result, 'product_prices')).toBe('missing');
    expect(result.branches[0]?.checks.find((entry) => entry.code === 'product_prices')?.items).toEqual([
      { id: 'p1', label: 'Product X' },
    ]);
    expect(stage(result, 'sale').blockedBy).toEqual(['product_prices']);
  });

  it('some products unpriced while others sell: a warning, never a blocker', () => {
    const result = evaluate({
      activeProductCount: 2,
      pricedProductCount: 1,
      unpricedProductCount: 1,
      unpricedProducts: [{ id: 'p2', label: 'Product Y' }],
      sellableProductCount: 1,
    });
    expect(checkStatus(result, 'product_prices')).toBe('warning');
    expect(stage(result, 'sale').ready).toBe(true);
  });

  it('a tracked product with no default inventory location is REQUIRED-missing and blocks the sale', () => {
    const result = evaluate({
      trackedProductCount: 1,
      defaultLocationCount: 0,
      trackedWithoutStockCount: 1,
      trackedWithoutStock: [{ id: 'p1', label: 'Tracked Item' }],
      sellableProductCount: 0,
    });
    const location = result.branches[0]?.checks.find((entry) => entry.code === 'inventory_location');
    expect(location?.required).toBe(true);
    expect(location?.status).toBe('missing');
    expect(stage(result, 'sale').blockedBy).toEqual(['inventory_location']);
    expect(stage(result, 'inventory').ready).toBe(false);
    expect(stage(result, 'inventory').blockedBy).toEqual(['inventory_location']);
  });

  it('a default location but no stock: the sale is blocked by stock, and no stock is ever invented', () => {
    const result = evaluate({
      trackedProductCount: 1,
      locationCount: 1,
      defaultLocationCount: 1,
      defaultLocationReceivingCount: 1,
      trackedWithoutStockCount: 1,
      trackedWithoutStock: [{ id: 'p1', label: 'Tracked Item' }],
      sellableProductCount: 0,
    });
    expect(checkStatus(result, 'inventory_location')).toBe('ok');
    expect(checkStatus(result, 'inventory_stock')).toBe('warning');
    expect(stage(result, 'sale').blockedBy).toEqual(['inventory_stock']);
    expect(stage(result, 'inventory').ready).toBe(true);
  });

  it('tracked product with a location and stock is sell-ready', () => {
    const result = evaluate({
      trackedProductCount: 1,
      locationCount: 1,
      defaultLocationCount: 1,
      defaultLocationReceivingCount: 1,
      sellableProductCount: 1,
    });
    expect(stage(result, 'sale').ready).toBe(true);
    expect(checkStatus(result, 'inventory_stock')).toBe('ok');
  });

  it('a non-inventory branch treats a missing inventory location as OPTIONAL, not required', () => {
    const result = evaluate({ trackedProductCount: 0, defaultLocationCount: 0 });
    const location = result.branches[0]?.checks.find((entry) => entry.code === 'inventory_location');
    expect(location?.required).toBe(false);
    expect(location?.status).toBe('optional_missing');
    expect(stage(result, 'sale').ready).toBe(true);
  });

  it('an invalid branch timezone (the "Mexico_City" class of bug) blocks every operational stage', () => {
    const result = evaluate({ timezone: 'Mexico_City' });
    expect(checkStatus(result, 'branch_timezone_valid')).toBe('missing');
    expect(stage(result, 'pos_entry').blockedBy).toContain('branch_timezone_valid');
    expect(stage(result, 'sale').ready).toBe(false);
  });

  it('an unsupported company currency blocks administration itself', () => {
    const result = evaluate({}, { currencyCode: 'EUR' });
    expect(checkStatus(result, 'company_currency_supported')).toBe('missing');
    expect(result.company.administrationReady).toBe(false);
    expect(stage(result, 'sale').ready).toBe(false);
  });

  it('a supported non-MXN currency is fully ready (Mexico is not hardcoded)', () => {
    const result = evaluate({}, { currencyCode: 'USD', timezone: 'America/New_York' });
    expect(result.company.administrationReady).toBe(true);
    expect(stage(result, 'sale').ready).toBe(true);
  });

  it('a suspended company is not administration-ready', () => {
    const result = evaluate({}, { status: 'suspended' });
    expect(result.company.administrationReady).toBe(false);
  });

  it('a company with no active branch is not administration-ready', () => {
    const facts: ReadinessFacts = { company: { ...company, activeBranchCount: 0 }, branches: [] };
    const result = evaluateReadiness(facts, now);
    expect(result.company.administrationReady).toBe(false);
    expect(result.branches).toHaveLength(0);
  });

  it('a register pointing at another branch area is a warning, not a blocker', () => {
    const result = evaluate({ registersWithForeignAreaCount: 1 });
    expect(checkStatus(result, 'register_area_consistent')).toBe('warning');
    expect(stage(result, 'sale').ready).toBe(true);
  });

  it('never depends on any tenant/branch/product name', () => {
    const renamed = evaluate({ name: 'Anything At All', code: 'ZZ' }, { displayName: 'Someone Else Entirely' });
    expect(stage(renamed, 'sale').ready).toBe(true);
  });
});
