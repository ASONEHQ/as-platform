import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

/**
 * TASK 13.0 — Part C. Production-safe phone normalization to E.164,
 * WITHOUT ever guessing a country. AS POS V1 itself never validated or
 * normalized phone numbers at all (confirmed by forensic reading of
 * `AS POS V1.html` — free-text `tel` field, substring search only), so
 * there is nothing to reconcile with; this is genuinely new.
 *
 * `libphonenumber-js` (Google's libphonenumber, ported) is the
 * industry-standard library for this — hand-rolled regex normalization
 * cannot correctly distinguish valid Mexican mobile/landline shapes from
 * invalid ones, and ADR-0017 explicitly rejects a hand-rolled approach for
 * that reason.
 *
 * `defaultCountry` is OPTIONAL and comes only from the company's own
 * explicit `customers.default_country_code` setting (see
 * `settings.catalog.ts`) — never a hardcoded literal like `'MX'` anywhere
 * in this module. If the input phone string already carries an explicit
 * `+countrycode` prefix, `defaultCountry` is not needed and is ignored by
 * the library. If it does not, and no `defaultCountry` was supplied (the
 * company has not configured one), normalization intentionally fails
 * closed — `normalizedPhone` comes back `null` — rather than guess.
 */
export interface PhoneNormalizationResult {
  readonly normalizedPhone: string | null;
  readonly countryCode: string | null;
}

const E164_PATTERN = /^\+[1-9]\d{6,14}$/u;

export function normalizePhone(rawPhone: string, defaultCountry: string | null): PhoneNormalizationResult {
  const trimmed = rawPhone.trim();
  if (trimmed.length === 0) return { normalizedPhone: null, countryCode: null };
  // `defaultCountry` is validated to `^[A-Z]{2}$` before it ever reaches
  // here (`isoCountryCodeOrEmpty`, `settings.validation.ts`) — an
  // unrecognized 2-letter code is simply not a valid `CountryCode` the
  // library knows, which `parsePhoneNumberFromString` handles by treating
  // the number as country-less (never throws for this reason alone).
  const country = defaultCountry === null ? undefined : (defaultCountry as CountryCode);
  try {
    const parsed = parsePhoneNumberFromString(trimmed, country);
    if (!parsed?.isValid()) return { normalizedPhone: null, countryCode: null };
    const e164 = parsed.number;
    if (!E164_PATTERN.test(e164)) return { normalizedPhone: null, countryCode: null };
    return { normalizedPhone: e164, countryCode: parsed.country ?? null };
  } catch {
    return { normalizedPhone: null, countryCode: null };
  }
}

/** Email normalization — Part C. Trim, lowercase; format validity is also
 * enforced at the database (`customers_email_format_ck`), matching
 * `users.normalized_email`'s own convention exactly. */
export function normalizeEmail(rawEmail: string): string | null {
  const normalized = rawEmail.trim().toLowerCase();
  if (normalized.length === 0) return null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(normalized)) return null;
  return normalized;
}
