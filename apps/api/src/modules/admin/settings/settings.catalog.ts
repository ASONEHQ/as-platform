import {
  allowedString,
  booleanValue,
  boundedInteger,
  boundedString,
  ianaTimezone,
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
