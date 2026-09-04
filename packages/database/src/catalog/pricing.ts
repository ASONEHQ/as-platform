import { CatalogDomainError } from './errors.js';

// ADR-0001 (money-and-rounding): money is `numeric(19,4)` with an explicit
// ISO 4217 currency; JS `number` is prohibited for authoritative money.
// This pattern matches the `numeric(19,4)` column exactly — a non-negative
// integer part up to 15 digits (`numeric(19,4)` allows 15 integer + 4
// fractional digits) with at most 4 fractional digits, never scientific
// notation, never a bare leading `.`.
const moneyAmountPattern = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/u;
const currencyCodePattern = /^[A-Z]{3}$/u;

/** `docs/CORE_DATA_MODEL.md`'s `products.tax_code` — an explicit,
 * backend-authoritative tax *classification*, not a tax-rate engine (no
 * rate table exists; each documented code maps to a rate the caller
 * already knows, e.g. Mexico's statutory 16% IVA for `IVA_GENERAL`). */
export type ProductTaxCode = 'IVA_GENERAL' | 'IVA_EXEMPT';
const productTaxCodes: readonly ProductTaxCode[] = ['IVA_GENERAL', 'IVA_EXEMPT'];

/**
 * Validates and normalizes a decimal money amount to exactly 4 fractional
 * digits (matching the `numeric(19,4)` column it will be stored in and the
 * decimal-string HTTP contract in docs/API_CONTRACTS.md §3/§8.3). Never
 * silently coerces an invalid value to `0` — an invalid amount is a hard
 * error, not a fallback, so a genuinely missing price and an honestly-free
 * `0.0000` price stay distinguishable.
 */
export function normalizeMoneyAmount(value: string): string {
  if (!moneyAmountPattern.test(value)) {
    throw new CatalogDomainError(
      'invalid_money_amount',
      'A money amount must be a non-negative decimal string with at most 4 fractional digits.',
    );
  }
  const [whole = '0', fraction = ''] = value.split('.');
  return `${whole}.${fraction.padEnd(4, '0')}`;
}

/** ISO 4217 alphabetic currency code, matching every `currency_code
 * char(3)` column's `~ '^[A-Z]{3}$'` check constraint. */
export function normalizeCurrencyCode(value: string): string {
  if (!currencyCodePattern.test(value)) {
    throw new CatalogDomainError(
      'invalid_currency_code',
      'A currency code must be exactly 3 uppercase ISO 4217 letters.',
    );
  }
  return value;
}

export function normalizeProductTaxCode(value: string): ProductTaxCode {
  if (!productTaxCodes.includes(value as ProductTaxCode)) {
    throw new CatalogDomainError(
      'invalid_tax_code',
      `A product tax code must be one of: ${productTaxCodes.join(', ')}.`,
    );
  }
  return value as ProductTaxCode;
}

/**
 * TASK 12.4A.1: Mexico's statutory IVA rate per tax classification, in
 * basis points (10000 = 100%) so a caller can apply it to a
 * `numeric(19,4)` amount with exact integer/BigInt arithmetic — never a
 * floating-point multiplier (ADR-0001).
 *
 * This is the *rate* half of the classification this module already
 * normalizes above — `products.tax_code` is deliberately "an explicit tax
 * classification, not a computed rate" (see `normalizeProductTaxCode`'s own
 * doc comment), so no rate table existed anywhere in the backend before
 * this task. It is the server-side twin of the exact same federal-law
 * constant Flutter already hardcodes as `posIvaBasisPointsFor` (see
 * `apps/one/lib/features/pos/pos_models.dart`) — TASK 12.4A.1 needs the
 * backend to independently compute an authoritative sale's tax rather than
 * trust a client-submitted total, so this closes that gap with the same
 * two-code table, not a new tax engine.
 */
const ivaBasisPointsByTaxCode: Readonly<Record<ProductTaxCode, number>> = {
  IVA_GENERAL: 1600,
  IVA_EXEMPT: 0,
};

export function ivaBasisPointsForTaxCode(code: ProductTaxCode): number {
  return ivaBasisPointsByTaxCode[code];
}
