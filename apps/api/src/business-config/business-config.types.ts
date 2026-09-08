import type { ProductStatus, ProductTaxCode, ProductType } from '../modules/catalog/product-catalog.types.js';

/**
 * TASK 14.2 Part D — the launch-config-driven business-configuration
 * provisioning tool. Deliberately a NEW module tree, siblings with (never
 * importing from) `../provisioning/*` (TASK 14.1's one-time company+owner
 * bootstrap) and `../development/*` (loopback-only dev fixtures): this
 * module's job starts strictly AFTER a company+owner already exists — see
 * `business-config.service.ts`'s own doc comment for the full division of
 * responsibility.
 */

/** The literal placeholder a config author writes for any field that is
 * genuinely unknown right now — never a fabricated real-looking value.
 * `validateLaunchConfig` refuses to let this literal reach a real
 * (non-dry-run) apply for any field where it appears. */
export const REQUIRED_OPERATOR_INPUT = 'REQUIRED_OPERATOR_INPUT';
export type RequiredOperatorInput = typeof REQUIRED_OPERATOR_INPUT;

/** The literal a role's `permissions` field carries to mean "grant every
 * permission currently in the `permissions` catalogue" — mirroring
 * `production-owner.service.ts`'s own D3 design (grant the real, current
 * table contents, never a second hardcoded copy of the list that seeded
 * it). */
export const ALL_PERMISSIONS_IN_CATALOGUE = 'ALL_PERMISSIONS_IN_CATALOGUE';
export type AllPermissionsInCatalogue = typeof ALL_PERMISSIONS_IN_CATALOGUE;

export class BusinessConfigInputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'BusinessConfigInputError';
  }
}

export interface LaunchCompanyConfig {
  readonly legal_name: string;
  readonly display_name: string;
  readonly slug: string;
  readonly timezone: string;
  readonly currency_code: string;
  readonly locale: string;
}

export interface LaunchBranchConfig {
  readonly name: string;
  readonly code: string;
  readonly timezone: string;
}

export interface LaunchRegisterConfig {
  readonly branch_code: string;
  readonly code: string;
  readonly name: string;
}

export interface LaunchRoleConfig {
  readonly code: string;
  readonly name: string;
  readonly permissions: AllPermissionsInCatalogue | readonly string[];
}

export interface LaunchUserConfig {
  readonly display_name: string;
  readonly email: string;
  readonly role_code: string;
  readonly branch_code: string;
}

export interface LaunchCategoryConfig {
  readonly code: string;
  readonly name: string;
  readonly sort_order?: number;
}

export interface LaunchProductConfig {
  readonly code: string;
  readonly sku: string;
  readonly name: string;
  readonly category_code: string;
  readonly product_type: ProductType;
  readonly tracks_inventory: boolean;
  readonly tax_code: ProductTaxCode;
  /** Creation-time subset only — mirrors what `product-catalog.routes.ts`'s
   * own create route accepts; `'retired'` is not a valid creation status. */
  readonly status: Exclude<ProductStatus, 'retired'>;
  readonly unit_price: string;
  readonly unit_price_is_confirmed_final: boolean;
}

export interface LaunchInventoryOpeningBalanceConfig {
  readonly product_code: string;
  readonly branch_code: string;
  readonly quantity: string;
}

export interface LaunchRewardsConfig {
  readonly enabled: boolean;
  readonly program_name: string;
  readonly unit_type: 'stamp' | 'point';
  readonly earn_quantity_per_sale: number;
  readonly reward_threshold: number;
  readonly reward_type: 'vip_pass';
  readonly reward_benefit_type: 'percentage_discount' | 'fixed_amount_discount' | 'fixed_price' | 'free_eligible_item';
  readonly reward_benefit_scope_product_codes: readonly string[];
}

export interface LaunchConfig {
  readonly company: LaunchCompanyConfig;
  readonly branches: readonly LaunchBranchConfig[];
  readonly registers: readonly LaunchRegisterConfig[];
  readonly roles: readonly LaunchRoleConfig[];
  readonly users: readonly LaunchUserConfig[];
  readonly categories: readonly LaunchCategoryConfig[];
  readonly products: readonly LaunchProductConfig[];
  readonly inventory_opening_balances: readonly LaunchInventoryOpeningBalanceConfig[];
  readonly rewards: LaunchRewardsConfig;
  readonly promotions: readonly unknown[];
}

/** Per-section counts, mirroring the exact shape every dev seed
 * (`seed-pos-catalog.service.ts`, etc.) already reports. */
export interface SectionCount {
  readonly created: number;
  readonly existing: number;
  /** Natural-key conflicts (e.g. same product code, different category) —
   * always reported, never silently skipped or silently overwritten. */
  readonly conflicts: readonly string[];
}

export interface BusinessConfigSummary {
  readonly dryRun: boolean;
  readonly companyId: string;
  readonly companySlug: string;
  readonly branches: SectionCount;
  readonly registers: SectionCount;
  readonly roles: SectionCount;
  readonly users: SectionCount;
  readonly categories: SectionCount;
  readonly products: SectionCount;
  readonly prices: SectionCount;
  readonly inventoryLocations: SectionCount;
  readonly inventoryOpeningBalances: SectionCount;
  readonly rewardsProgram: 'created' | 'existing' | 'skipped_disabled';
  readonly success: true;
}

/** Called only for a NEW user (one not already found by normalized email)
 * during a REAL (non-dry-run) apply — never during `--dry-run`, and never
 * for a user who already exists. Must resolve to the plaintext initial
 * password for that user; the caller (the CLI) is responsible for how it
 * obtains it (masked interactive prompt or a per-user environment
 * variable) — see `business-config.cli.ts`. The value is used exactly
 * once, passed straight into `AdministrationService.updateMembership`
 * (TASK 14.0's real first-activation path — the same one every other new
 * hire in this codebase goes through), and never logged or persisted in
 * plaintext anywhere. */
export type ResolveUserPassword = (user: LaunchUserConfig, index: number) => Promise<string>;
