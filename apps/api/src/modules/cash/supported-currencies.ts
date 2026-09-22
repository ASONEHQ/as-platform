/**
 * TASK 16.17 — the ONE list of currencies a tenant may be provisioned with.
 *
 * A company's `currency_code` is the single currency every price, sale,
 * cash session and cash count for that tenant is denominated in. Before
 * this task the only company-level check was a 3-letter regex, so a
 * tenant could be provisioned as e.g. "EUR" and only discover — at the
 * end of its first business day, when the register close asks for a
 * denomination count — that no approved cash-denomination set exists for
 * it (`canonicalCashDenominationsForCurrency`, `cash.types.ts`).
 *
 * Adding a currency here is therefore a three-part change: an entry in
 * this list, a denomination set in `cash.types.ts`, and (if the Flutter
 * client needs it) nothing else — the client reads the tenant's currency
 * from the backend. `supported-currencies.test.ts` fails if this list and
 * the denomination lookup ever drift apart.
 */
export const supportedCompanyCurrencyCodes = ['MXN', 'USD'] as const;

export type SupportedCompanyCurrencyCode = (typeof supportedCompanyCurrencyCodes)[number];

export function isSupportedCompanyCurrency(value: string): value is SupportedCompanyCurrencyCode {
  return (supportedCompanyCurrencyCodes as readonly string[]).includes(value);
}
