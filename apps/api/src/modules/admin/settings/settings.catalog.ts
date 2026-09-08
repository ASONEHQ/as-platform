import {
  allowedString,
  booleanValue,
  boundedInteger,
  boundedString,
  ianaTimezone,
  isoCountryCodeOrEmpty,
  timeOfDay,
  trimmedString,
} from './settings.validation.js';
import {
  SettingValidationError,
  type CompanySettingDefaults,
  type SettingDefinition,
  type SettingValue,
} from './settings.types.js';

export const SETTINGS_CATALOG_VERSION = 1;

const companyString = (
  key: string,
  selector: (company: CompanySettingDefaults) => string | null | undefined,
  fallback: string,
  normalize: (key: string, value: unknown) => SettingValue,
): ((company: CompanySettingDefaults) => string) => {
  return (company) => {
    const value = selector(company);
    if (typeof value !== 'string' || value.length === 0) return fallback;
    try {
      const normalized = normalize(key, value);
      return typeof normalized === 'string' ? normalized : fallback;
    } catch (error) {
      if (error instanceof SettingValidationError) return fallback;
      throw error;
    }
  };
};

const constantDefault =
  <T extends SettingValue>(value: T): ((company: CompanySettingDefaults) => T) =>
  () =>
    value;

export const settingsCatalog = [
  {
    key: 'business.display_name',
    type: 'string',
    technicalDefault: '',
    branchOverride: true,
    public: true,
    resolveDefault: companyString(
      'business.display_name',
      (company) => company.displayName,
      '',
      trimmedString({ minimum: 1, maximum: 120 }),
    ),
    normalize: (value: unknown) =>
      trimmedString({ minimum: 1, maximum: 120 })('business.display_name', value),
  },
  {
    key: 'business.timezone',
    type: 'string',
    technicalDefault: 'America/Mexico_City',
    branchOverride: true,
    public: true,
    resolveDefault: companyString(
      'business.timezone',
      (company) => company.timezone,
      'America/Mexico_City',
      ianaTimezone,
    ),
    normalize: (value: unknown) => ianaTimezone('business.timezone', value),
  },
  {
    key: 'business.locale',
    type: 'string',
    technicalDefault: 'es-MX',
    branchOverride: true,
    public: true,
    resolveDefault: companyString(
      'business.locale',
      (company) => company.locale,
      'es-MX',
      allowedString(['es-MX', 'en-US']),
    ),
    normalize: (value: unknown) => allowedString(['es-MX', 'en-US'])('business.locale', value),
  },
  {
    key: 'business.currency',
    type: 'string',
    technicalDefault: 'MXN',
    branchOverride: false,
    public: true,
    resolveDefault: companyString(
      'business.currency',
      (company) => company.currencyCode,
      'MXN',
      allowedString(['MXN', 'USD'], (input) => input.trim().toUpperCase()),
    ),
    normalize: (value: unknown) =>
      allowedString(['MXN', 'USD'], (input) => input.trim().toUpperCase())(
        'business.currency',
        value,
      ),
  },
  {
    key: 'operations.day_start_time',
    type: 'string',
    technicalDefault: '09:00',
    branchOverride: true,
    public: true,
    resolveDefault: constantDefault('09:00'),
    normalize: (value: unknown) => timeOfDay('operations.day_start_time', value),
  },
  {
    key: 'operations.day_end_time',
    type: 'string',
    technicalDefault: '21:00',
    branchOverride: true,
    public: true,
    resolveDefault: constantDefault('21:00'),
    normalize: (value: unknown) => timeOfDay('operations.day_end_time', value),
  },
  {
    key: 'receipts.header_text',
    type: 'string',
    technicalDefault: '',
    branchOverride: true,
    public: true,
    resolveDefault: constantDefault(''),
    normalize: (value: unknown) => boundedString(500)('receipts.header_text', value),
  },
  {
    key: 'receipts.footer_text',
    type: 'string',
    technicalDefault: '',
    branchOverride: true,
    public: true,
    resolveDefault: constantDefault(''),
    normalize: (value: unknown) => boundedString(500)('receipts.footer_text', value),
  },
  {
    key: 'receipts.show_company_tax_id',
    type: 'boolean',
    technicalDefault: false,
    branchOverride: true,
    public: true,
    resolveDefault: constantDefault(false),
    normalize: (value: unknown) => booleanValue('receipts.show_company_tax_id', value),
  },
  {
    key: 'security.session_idle_minutes',
    type: 'integer',
    technicalDefault: 30,
    branchOverride: false,
    public: true,
    resolveDefault: constantDefault(30),
    normalize: (value: unknown) => boundedInteger(5, 1440)('security.session_idle_minutes', value),
  },
  {
    key: 'security.require_manager_for_voids',
    type: 'boolean',
    technicalDefault: true,
    branchOverride: true,
    public: true,
    resolveDefault: constantDefault(true),
    normalize: (value: unknown) => booleanValue('security.require_manager_for_voids', value),
  },
  {
    key: 'ui.date_format',
    type: 'string',
    technicalDefault: 'DD/MM/YYYY',
    branchOverride: true,
    public: true,
    resolveDefault: constantDefault('DD/MM/YYYY'),
    normalize: (value: unknown) =>
      allowedString(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'])('ui.date_format', value),
  },
  {
    key: 'ui.time_format',
    type: 'string',
    technicalDefault: '24h',
    branchOverride: true,
    public: true,
    resolveDefault: constantDefault('24h'),
    normalize: (value: unknown) => allowedString(['12h', '24h'])('ui.time_format', value),
  },
  {
    // TASK 13.0 — Part C: phone country context must be explicit, never
    // guessed. An empty string (the default) means "not configured"; a
    // non-empty value is the ISO 3166-1 alpha-2 country
    // `CustomersService` assumes when normalizing a phone number that
    // itself carries no country code. Company-wide only (no branch
    // override) — a company's own phone-normalization context does not
    // vary by branch in this codebase's tenancy model.
    key: 'customers.default_country_code',
    type: 'string',
    technicalDefault: '',
    branchOverride: false,
    public: true,
    resolveDefault: constantDefault(''),
    normalize: (value: unknown) => isoCountryCodeOrEmpty('customers.default_country_code', value),
  },
  {
    // TASK 14.5A: legacy parity for `AS POS V1.html`'s
    // `cfgNegocioLogoSeleccionado()`/`aplicarBrandingNegocio()` (an
    // operator-uploaded business logo, applied live and persisted). The
    // image itself is never stored here -- only its resolvable object
    // URL, exactly like `receipts.header_text` stores text, not a file.
    // The real bytes live in the MinIO `asone-branding` bucket (see
    // `branding.storage.ts`); this key is written by
    // `POST /companies/{id}/branding/logo` and cleared by
    // `DELETE /companies/{id}/branding/logo`
    // (`branding.routes.ts`), both through the SAME
    // `SettingsService.mutateCompanySetting` CAS-guarded write every
    // other company setting uses -- no bespoke persistence mechanism.
    // Company-wide only (no branch override): a business's logo is one
    // tenant-wide identity asset in the legacy behavior being ported,
    // not something that varies location-to-location.
    key: 'branding.logo_url',
    type: 'string',
    technicalDefault: '',
    branchOverride: false,
    public: true,
    resolveDefault: constantDefault(''),
    // 2048 bounds a URL, never the image itself (the image lives in
    // object storage) -- generous enough for any real path-style or
    // virtual-hosted-style object URL.
    normalize: (value: unknown) => boundedString(2048)('branding.logo_url', value),
  },
] as const satisfies readonly SettingDefinition[];

export type SettingKey = (typeof settingsCatalog)[number]['key'];

const catalogByKey = new Map<string, SettingDefinition>(
  settingsCatalog.map((definition) => [definition.key, definition]),
);

export function getSettingDefinition(key: string): SettingDefinition {
  const definition = catalogByKey.get(key);
  if (definition === undefined)
    throw new SettingValidationError(key, 'unknown_key', 'The setting key is not approved.');
  return definition;
}

export function resolveCatalogDefault(key: string, company: CompanySettingDefaults): SettingValue {
  return getSettingDefinition(key).resolveDefault(company);
}

export function selectSettingDefinitions(keys?: readonly unknown[]): readonly SettingDefinition[] {
  if (keys === undefined) return settingsCatalog;
  const requested = new Set(
    keys.map((key) => {
      if (typeof key !== 'string' || key.length === 0)
        throw new SettingValidationError(
          String(key),
          'malformed_key',
          'The setting key must be a non-empty string.',
        );
      return getSettingDefinition(key).key;
    }),
  );
  return settingsCatalog.filter((definition) => requested.has(definition.key));
}
