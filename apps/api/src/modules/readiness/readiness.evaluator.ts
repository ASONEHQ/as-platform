import { isSupportedCompanyCurrency } from '../cash/supported-currencies.js';
import { isValidIanaTimezone } from '../promotions/pricing.service.js';
import type {
  BranchFacts,
  BranchReadiness,
  CompanyFacts,
  ReadinessCheck,
  ReadinessFacts,
  ReadinessStage,
  ReadinessStageKey,
  TenantReadiness,
} from './readiness.types.js';

/**
 * TASK 16.17 — the ONE authoritative "is this tenant ready?" rulebook.
 * A pure function of already-read facts: no I/O, no clock, no tenant
 * names — so it is exhaustively unit-testable and the Flutter client never
 * has to re-derive any of it (it only renders what this returns).
 *
 * Every REQUIRED check below is derived from something the real
 * sale/cash/inventory paths actually reject today, not from a wish list:
 *  - `company_currency_supported`  → `canonicalCashDenominationsForCurrency`
 *    throws at register close for any other currency.
 *  - `branch_timezone_valid`       → `SalesService.createSale` refuses a
 *    branch with a non-IANA timezone (`branch_timezone_invalid`).
 *  - `register_exists`/`operator_*` → `POST /cash-sessions` needs a register
 *    the actor may use; the sale/payment routes need their permissions.
 *  - `product_prices`              → `SalesService.createSale` rejects a
 *    product with no active price (`price_not_found`).
 *  - `inventory_location`          → `postSaleConsumption` throws
 *    `inventory_location_not_found` (rolling the whole payment back) when
 *    a tracked product is sold in a branch with no active default location.
 *  - `inventory_stock`             → the same posting refuses to take stock
 *    below zero.
 * Optional configuration (operational areas, an open session, stock) is
 * reported but can never block a stage.
 */

function check(input: ReadinessCheck): ReadinessCheck {
  return input;
}

export function evaluateCompanyChecks(company: CompanyFacts): readonly ReadinessCheck[] {
  return [
    check({
      code: 'company_active',
      scope: 'company',
      required: true,
      status: company.status === 'active' ? 'ok' : 'missing',
      surface: 'company',
      count: null,
      items: [],
    }),
    check({
      code: 'company_currency_supported',
      scope: 'company',
      required: true,
      status: isSupportedCompanyCurrency(company.currencyCode) ? 'ok' : 'missing',
      surface: 'company',
      count: null,
      items: [{ id: company.currencyCode, label: company.currencyCode }],
    }),
    check({
      code: 'company_timezone_valid',
      scope: 'company',
      required: true,
      status: isValidIanaTimezone(company.timezone) ? 'ok' : 'missing',
      surface: 'company',
      count: null,
      items: [{ id: company.timezone, label: company.timezone }],
    }),
    check({
      code: 'branch_exists',
      scope: 'company',
      required: true,
      status: company.activeBranchCount > 0 ? 'ok' : 'missing',
      surface: 'branches',
      count: company.activeBranchCount,
      items: [],
    }),
  ];
}

export function evaluateBranchChecks(branch: BranchFacts): readonly ReadinessCheck[] {
  const noProducts = branch.activeProductCount === 0;
  const checks: ReadinessCheck[] = [];

  checks.push(
    check({
      code: 'branch_timezone_valid',
      scope: 'branch',
      required: true,
      status: isValidIanaTimezone(branch.timezone) ? 'ok' : 'missing',
      surface: 'branches',
      count: null,
      items: [{ id: branch.timezone, label: branch.timezone }],
    }),
    check({
      code: 'operational_areas',
      scope: 'branch',
      required: false,
      status: branch.areaCount > 0 ? 'ok' : 'optional_missing',
      surface: 'operational_areas',
      count: branch.areaCount,
      items: [],
    }),
    check({
      code: 'register_exists',
      scope: 'branch',
      required: true,
      status: branch.registerCount > 0 ? 'ok' : 'missing',
      surface: 'registers',
      count: branch.registerCount,
      items: [],
    }),
    check({
      code: 'register_area_consistent',
      scope: 'branch',
      required: false,
      status: branch.registersWithForeignAreaCount > 0 ? 'warning' : 'ok',
      surface: 'registers',
      count: branch.registersWithForeignAreaCount,
      items: [],
    }),
    check({
      code: 'operator_authorized',
      scope: 'branch',
      required: true,
      status: branch.cashOperatorCount > 0 ? 'ok' : 'missing',
      surface: 'users',
      count: branch.cashOperatorCount,
      items: [],
    }),
    check({
      code: 'operator_register_access',
      scope: 'branch',
      required: true,
      status:
        branch.registerCount > 0 && branch.cashOperatorCount > 0
          ? branch.cashOperatorWithRegisterCount > 0
            ? 'ok'
            : 'missing'
          : 'not_applicable',
      surface: 'users',
      count: branch.cashOperatorWithRegisterCount,
      items: [],
    }),
    check({
      code: 'catalog_products',
      scope: 'branch',
      required: true,
      status: noProducts ? 'missing' : 'ok',
      surface: 'catalog',
      count: branch.activeProductCount,
      items: [],
    }),
    check({
      code: 'product_prices',
      scope: 'branch',
      required: true,
      status: noProducts
        ? 'not_applicable'
        : branch.pricedProductCount === 0
          ? 'missing'
          : branch.unpricedProductCount > 0
            ? 'warning'
            : 'ok',
      surface: 'prices',
      count: branch.unpricedProductCount,
      items: branch.unpricedProducts,
    }),
    check({
      code: 'price_currency',
      scope: 'branch',
      required: false,
      status: branch.foreignCurrencyPriceProductCount > 0 ? 'warning' : 'ok',
      surface: 'prices',
      count: branch.foreignCurrencyPriceProductCount,
      items: branch.foreignCurrencyPriceProducts,
    }),
    check({
      code: 'inventory_location',
      scope: 'branch',
      // Only a hard requirement once something is actually tracked — a
      // branch that sells services/admissions never needs one.
      required: branch.trackedProductCount > 0,
      status:
        branch.defaultLocationCount > 0
          ? branch.defaultLocationReceivingCount > 0
            ? 'ok'
            : 'warning'
          : branch.trackedProductCount > 0
            ? 'missing'
            : 'optional_missing',
      surface: 'inventory_locations',
      count: branch.locationCount,
      items: [],
    }),
    check({
      code: 'inventory_stock',
      scope: 'branch',
      required: false,
      status:
        branch.trackedProductCount === 0
          ? 'not_applicable'
          : branch.trackedWithoutStockCount > 0
            ? 'warning'
            : 'ok',
      surface: 'inventory_stock',
      count: branch.trackedWithoutStockCount,
      items: branch.trackedWithoutStock,
    }),
    check({
      code: 'cash_session_open',
      scope: 'branch',
      required: false,
      status: branch.openSessionCount > 0 ? 'ok' : 'optional_missing',
      surface: 'cash',
      count: branch.openSessionCount,
      items: [],
    }),
  );
  return checks;
}

function blockingCodes(checks: readonly ReadinessCheck[], codes: readonly string[]): string[] {
  return checks.filter((entry) => codes.includes(entry.code) && entry.required && entry.status === 'missing').map((entry) => entry.code);
}

const administrationCodes = [
  'company_active',
  'company_currency_supported',
  'company_timezone_valid',
  'branch_exists',
] as const;

export function evaluateBranchStages(
  companyChecks: readonly ReadinessCheck[],
  branch: BranchFacts,
  branchChecks: readonly ReadinessCheck[],
): readonly ReadinessStage[] {
  const administrationBlocked = blockingCodes(companyChecks, administrationCodes);

  // A cashier only needs to REACH the POS — that needs a register, a user
  // who may sell and a usable register, but not yet the right to open a
  // cash session.
  const posEntryBlocked = [
    ...administrationBlocked,
    ...blockingCodes(branchChecks, ['branch_timezone_valid', 'register_exists']),
    ...(branch.posEntryOperatorCount === 0 ? ['operator_authorized'] : []),
    ...blockingCodes(branchChecks, ['operator_register_access']),
  ];
  const registerOpenBlocked = [
    ...administrationBlocked,
    ...blockingCodes(branchChecks, [
      'branch_timezone_valid',
      'register_exists',
      'operator_authorized',
      'operator_register_access',
    ]),
  ];

  const saleBlocked = [...registerOpenBlocked];
  if (saleBlocked.length === 0 && branch.sellableProductCount === 0) {
    if (branch.activeProductCount === 0) saleBlocked.push('catalog_products');
    else if (branch.pricedProductCount === 0) saleBlocked.push('product_prices');
    else if (branch.defaultLocationCount === 0) saleBlocked.push('inventory_location');
    else saleBlocked.push('inventory_stock');
  } else if (saleBlocked.length > 0) {
    // Also surface the catalogue blockers alongside the setup ones so the
    // admin sees everything standing between them and a first sale.
    if (branch.activeProductCount === 0) saleBlocked.push('catalog_products');
    else if (branch.pricedProductCount === 0) saleBlocked.push('product_prices');
  }

  const inventoryApplicable = branch.trackedProductCount > 0 || branch.locationCount > 0;
  const inventoryBlocked =
    inventoryApplicable && branch.defaultLocationCount === 0 ? ['inventory_location'] : [];

  const stage = (key: ReadinessStageKey, blocked: readonly string[], applicable = true): ReadinessStage => ({
    key,
    ready: applicable ? blocked.length === 0 : null,
    blockedBy: [...new Set(blocked)],
  });
  return [
    stage('administration', administrationBlocked),
    stage('pos_entry', posEntryBlocked),
    stage('register_open', registerOpenBlocked),
    stage('sale', saleBlocked),
    stage('inventory', inventoryBlocked, inventoryApplicable),
  ];
}

export function evaluateReadiness(facts: ReadinessFacts, evaluatedAt: Date): TenantReadiness {
  const companyChecks = evaluateCompanyChecks(facts.company);
  const branches: BranchReadiness[] = facts.branches.map((branch) => {
    const checks = evaluateBranchChecks(branch);
    return {
      branchId: branch.id,
      code: branch.code,
      name: branch.name,
      checks,
      stages: evaluateBranchStages(companyChecks, branch, checks),
    };
  });
  return {
    evaluatedAt: evaluatedAt.toISOString(),
    company: {
      id: facts.company.id,
      name: facts.company.displayName,
      currencyCode: facts.company.currencyCode,
      timezone: facts.company.timezone,
      checks: companyChecks,
      administrationReady: blockingCodes(companyChecks, administrationCodes).length === 0,
    },
    branches,
  };
}
