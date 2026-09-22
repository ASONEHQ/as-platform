import { isSupportedCompanyCurrency, supportedCompanyCurrencyCodes } from '../modules/cash/supported-currencies.js';
import { productStatuses, productTaxCodes, productTypes } from '../modules/catalog/product-catalog.types.js';
import { isValidIanaTimezone } from '../modules/promotions/pricing.service.js';
import {
  ALL_PERMISSIONS_IN_CATALOGUE,
  BusinessConfigInputError,
  REQUIRED_OPERATOR_INPUT,
  type LaunchConfig,
} from './business-config.types.js';

/**
 * TASK 14.2 Section C/D — hand-rolled structural + semantic validation for
 * a launch config, run BEFORE any lookup or write (including in
 * `--dry-run`). This intentionally mirrors `config/launch/
 * launch-config.schema.json` rather than depending on it at runtime: no
 * JSON-schema-validator library (ajv/zod/etc.) is already a dependency
 * anywhere in this monorepo (checked every `package.json` under `apps/`
 * and `packages/` before writing this), and adding one heavy dependency
 * for this one file would cost more than it buys — see the task's own
 * instruction to prefer a minimal hand-rolled check when that's true. The
 * two files are kept honestly in sync by importing the SAME enum arrays
 * (`productTypes`/`productStatuses`/`productTaxCodes`) this validator
 * checks against, rather than re-typing them a third time.
 *
 * A creation-time product `status` excludes `'retired'` — the real
 * `POST /products` route (`product-catalog.routes.ts`) does not accept it
 * either; a config that requests it is rejected here with the same
 * message a real API caller would get, not a confusing runtime failure
 * three steps later.
 */

const productCreationStatuses = productStatuses.filter((status) => status !== 'retired');
const permissionCodePattern = /^[a-z_]+(?:\.[a-z_]+)+$/u;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function at(path: string, index: number): string {
  return `${path}[${index.toString()}]`;
}

function fail(path: string, message: string): never {
  throw new BusinessConfigInputError(`${path}: ${message}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) fail(path, 'must be a non-blank string.');
  return value;
}

/** A "may be REQUIRED_OPERATOR_INPUT" string field: any non-blank string is
 * structurally valid here — the sentinel-rejection pass (`rejectPlaceholders`)
 * is what refuses it before a REAL (non-dry-run) apply. Kept as a distinct
 * helper so every call site documents, by name, that this field is allowed
 * to still be a placeholder at validation time. */
function requireStringOrPlaceholder(value: unknown, path: string): string {
  return requireString(value, path);
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'must be a boolean.');
  return value;
}

function requireArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(path, 'must be an array.');
  return value;
}

function requireEnum<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value))
    fail(path, `must be one of: ${allowed.join(', ')}.`);
  return value as T;
}

/**
 * Parses and validates an already-`JSON.parse`d launch config. Throws
 * `BusinessConfigInputError` naming the exact offending field path on any
 * structural problem. Does NOT reject `REQUIRED_OPERATOR_INPUT`
 * placeholders itself (a dry run may legitimately inspect a
 * still-templated config to see what's missing) — call
 * `rejectPlaceholders` separately before a real, writing apply.
 */
export function validateLaunchConfig(raw: unknown): LaunchConfig {
  if (!isObject(raw)) fail('$', 'the launch config must be a JSON object.');

  if (!isObject(raw.company)) fail('company', 'is required and must be an object.');
  const company = {
    legal_name: requireString(raw.company.legal_name, 'company.legal_name'),
    display_name: requireString(raw.company.display_name, 'company.display_name'),
    slug: requireString(raw.company.slug, 'company.slug'),
    timezone: requireString(raw.company.timezone, 'company.timezone'),
    currency_code: requireString(raw.company.currency_code, 'company.currency_code'),
    locale: requireString(raw.company.locale, 'company.locale'),
  };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(company.slug))
    fail('company.slug', 'must be lowercase kebab-case.');
  if (!/^[A-Z]{3}$/u.test(company.currency_code)) fail('company.currency_code', 'must be a 3-letter ISO code.');
  if (!isSupportedCompanyCurrency(company.currency_code))
    fail(
      'company.currency_code',
      `must be a supported currency (${supportedCompanyCurrencyCodes.join(', ')}); "${company.currency_code}" has no approved cash-denomination set.`,
    );
  // TASK 16.17 — the same real-IANA check every other write path already
  // enforces (`AdministrationService`, `ProductionOwnerProvisioner`); this
  // tool inserts branches directly, so without it a launch config could
  // still persist the exact non-IANA value ("Mexico_City") that once broke
  // `POST /api/v1/sales` in production.
  if (!isValidIanaTimezone(company.timezone))
    fail('company.timezone', `"${company.timezone}" is not a valid IANA timezone identifier (e.g. "America/Mexico_City").`);

  const branches = requireArray(raw.branches, 'branches').map((entry, index) => {
    const path = at('branches', index);
    if (!isObject(entry)) fail(path, 'must be an object.');
    return {
      name: requireString(entry.name, `${path}.name`),
      code: requireString(entry.code, `${path}.code`),
      timezone: requireString(entry.timezone, `${path}.timezone`),
    };
  });
  branches.forEach((branch, index) => {
    if (!isValidIanaTimezone(branch.timezone))
      fail(
        `${at('branches', index)}.timezone`,
        `"${branch.timezone}" is not a valid IANA timezone identifier (e.g. "America/Mexico_City").`,
      );
  });
  const branchCodes = new Set(branches.map((branch) => branch.code));
  if (branchCodes.size !== branches.length) fail('branches', 'contains duplicate branch codes.');

  const registers = requireArray(raw.registers, 'registers').map((entry, index) => {
    const path = at('registers', index);
    if (!isObject(entry)) fail(path, 'must be an object.');
    return {
      branch_code: requireString(entry.branch_code, `${path}.branch_code`),
      code: requireStringOrPlaceholder(entry.code, `${path}.code`),
      name: requireStringOrPlaceholder(entry.name, `${path}.name`),
    };
  });

  const roles = requireArray(raw.roles, 'roles').map((entry, index) => {
    const path = at('roles', index);
    if (!isObject(entry)) fail(path, 'must be an object.');
    const code = requireString(entry.code, `${path}.code`);
    if (!/^[a-z0-9_]+$/u.test(code)) fail(`${path}.code`, 'must be lowercase snake_case.');
    const name = requireString(entry.name, `${path}.name`);
    let permissions: typeof ALL_PERMISSIONS_IN_CATALOGUE | readonly string[];
    if (entry.permissions === ALL_PERMISSIONS_IN_CATALOGUE) {
      permissions = ALL_PERMISSIONS_IN_CATALOGUE;
    } else {
      const list = requireArray(entry.permissions, `${path}.permissions`);
      if (list.length === 0) fail(`${path}.permissions`, 'must not be empty.');
      permissions = list.map((code_, permissionIndex) =>
        requireString(code_, at(`${path}.permissions`, permissionIndex)),
      );
      for (const [permissionIndex, code_] of permissions.entries())
        if (!permissionCodePattern.test(code_))
          fail(at(`${path}.permissions`, permissionIndex), 'must look like "domain.action".');
    }
    return { code, name, permissions };
  });
  const roleCodes = new Set(roles.map((role) => role.code));
  if (roleCodes.size !== roles.length) fail('roles', 'contains duplicate role codes.');

  const users = requireArray(raw.users, 'users').map((entry, index) => {
    const path = at('users', index);
    if (!isObject(entry)) fail(path, 'must be an object.');
    if ('password' in entry) fail(path, "must never carry a password field — see the CLI's own docs.");
    const email = requireStringOrPlaceholder(entry.email, `${path}.email`);
    if (email !== REQUIRED_OPERATOR_INPUT && !emailPattern.test(email))
      fail(`${path}.email`, 'does not look like a valid email address.');
    return {
      display_name: requireStringOrPlaceholder(entry.display_name, `${path}.display_name`),
      email,
      role_code: requireString(entry.role_code, `${path}.role_code`),
      branch_code: requireStringOrPlaceholder(entry.branch_code, `${path}.branch_code`),
    };
  });

  const categories = requireArray(raw.categories, 'categories').map((entry, index) => {
    const path = at('categories', index);
    if (!isObject(entry)) fail(path, 'must be an object.');
    return {
      code: requireString(entry.code, `${path}.code`),
      name: requireString(entry.name, `${path}.name`),
      ...(entry.sort_order === undefined ? {} : { sort_order: Number(entry.sort_order) }),
    };
  });
  const categoryCodes = new Set(categories.map((category) => category.code));
  if (categoryCodes.size !== categories.length) fail('categories', 'contains duplicate category codes.');

  const products = requireArray(raw.products, 'products').map((entry, index) => {
    const path = at('products', index);
    if (!isObject(entry)) fail(path, 'must be an object.');
    return {
      code: requireString(entry.code, `${path}.code`),
      sku: requireString(entry.sku, `${path}.sku`),
      name: requireString(entry.name, `${path}.name`),
      category_code: requireString(entry.category_code, `${path}.category_code`),
      product_type: requireEnum(entry.product_type, `${path}.product_type`, productTypes),
      tracks_inventory: requireBoolean(entry.tracks_inventory, `${path}.tracks_inventory`),
      tax_code: requireEnum(entry.tax_code, `${path}.tax_code`, productTaxCodes),
      status: requireEnum(entry.status, `${path}.status`, productCreationStatuses),
      unit_price: requireStringOrPlaceholder(entry.unit_price, `${path}.unit_price`),
      unit_price_is_confirmed_final: requireBoolean(
        entry.unit_price_is_confirmed_final,
        `${path}.unit_price_is_confirmed_final`,
      ),
    };
  });
  const productCodes = new Set(products.map((product) => product.code));
  if (productCodes.size !== products.length) fail('products', 'contains duplicate product codes.');
  for (const [index, product] of products.entries())
    if (!categoryCodes.has(product.category_code))
      fail(`${at('products', index)}.category_code`, `references unknown category "${product.category_code}".`);

  const inventoryOpeningBalances = requireArray(
    raw.inventory_opening_balances,
    'inventory_opening_balances',
  ).map((entry, index) => {
    const path = at('inventory_opening_balances', index);
    if (!isObject(entry)) fail(path, 'must be an object.');
    const productCode = requireString(entry.product_code, `${path}.product_code`);
    if (!productCodes.has(productCode)) fail(`${path}.product_code`, `references unknown product "${productCode}".`);
    return {
      product_code: productCode,
      branch_code: requireStringOrPlaceholder(entry.branch_code, `${path}.branch_code`),
      quantity: requireStringOrPlaceholder(entry.quantity, `${path}.quantity`),
    };
  });

  if (!isObject(raw.rewards)) fail('rewards', 'is required and must be an object.');
  const rewardsEnabled = requireBoolean(raw.rewards.enabled, 'rewards.enabled');
  const rewardScopeCodes = requireArray(
    raw.rewards.reward_benefit_scope_product_codes,
    'rewards.reward_benefit_scope_product_codes',
  ).map((code, index) =>
    requireString(code, at('rewards.reward_benefit_scope_product_codes', index)),
  );
  const rewards = {
    enabled: rewardsEnabled,
    program_name: requireString(raw.rewards.program_name, 'rewards.program_name'),
    unit_type: requireEnum(raw.rewards.unit_type, 'rewards.unit_type', ['stamp', 'point'] as const),
    earn_quantity_per_sale: Number(raw.rewards.earn_quantity_per_sale),
    reward_threshold: Number(raw.rewards.reward_threshold),
    reward_type: requireEnum(raw.rewards.reward_type, 'rewards.reward_type', ['vip_pass'] as const),
    reward_benefit_type: requireEnum(raw.rewards.reward_benefit_type, 'rewards.reward_benefit_type', [
      'percentage_discount',
      'fixed_amount_discount',
      'fixed_price',
      'free_eligible_item',
    ] as const),
    reward_benefit_scope_product_codes: rewardScopeCodes,
  };
  if (rewards.enabled)
    for (const [index, code] of rewardScopeCodes.entries())
      if (!productCodes.has(code))
        fail(
          at('rewards.reward_benefit_scope_product_codes', index),
          `references unknown product "${code}".`,
        );

  const promotions = requireArray(raw.promotions, 'promotions');
  if (promotions.length > 0)
    fail(
      'promotions',
      'must be empty — provision:business-config does not create promotions yet (out of scope for TASK 14.2); populate this only once that capability exists.',
    );

  return Object.freeze({
    company,
    branches,
    registers,
    roles,
    users,
    categories,
    products,
    inventory_opening_balances: inventoryOpeningBalances,
    rewards,
    promotions,
  });
}

/** Walks every string leaf reachable from the sections that are actually
 * used during a REAL apply and refuses to proceed if any of them is still
 * the literal `REQUIRED_OPERATOR_INPUT` placeholder — the config must be
 * fully filled in by a human operator before real data is written. Never
 * called for `--dry-run` (a dry run may legitimately inspect a
 * still-templated config to see exactly what remains to be filled in). */
export function rejectPlaceholders(config: LaunchConfig): void {
  const offending: string[] = [];
  const check = (value: string, path: string): void => {
    if (value === REQUIRED_OPERATOR_INPUT) offending.push(path);
  };
  config.registers.forEach((register, index) => {
    check(register.code, `${at('registers', index)}.code`);
    check(register.name, `${at('registers', index)}.name`);
  });
  config.users.forEach((user, index) => {
    check(user.display_name, `${at('users', index)}.display_name`);
    check(user.email, `${at('users', index)}.email`);
    check(user.branch_code, `${at('users', index)}.branch_code`);
  });
  config.products.forEach((product, index) => {
    check(product.unit_price, `${at('products', index)}.unit_price`);
  });
  config.inventory_opening_balances.forEach((balance, index) => {
    check(balance.branch_code, `${at('inventory_opening_balances', index)}.branch_code`);
    check(balance.quantity, `${at('inventory_opening_balances', index)}.quantity`);
  });
  if (offending.length > 0)
    throw new BusinessConfigInputError(
      `The launch config still contains ${offending.length.toString()} unresolved "${REQUIRED_OPERATOR_INPUT}" placeholder(s) that must be replaced with real, business-confirmed data before this can be applied for real (use --dry-run to preview without this restriction): ${offending.join(', ')}`,
    );
}
