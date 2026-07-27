import { describe, expect, it } from 'vitest';

import {
  getSettingDefinition,
  resolveCatalogDefault,
  selectSettingDefinitions,
  SETTINGS_CATALOG_VERSION,
  settingsCatalog,
} from './settings.catalog.js';
import { SettingValidationError } from './settings.types.js';
import { validateSettingValue } from './settings.validation.js';

describe('settings catalog', () => {
  it('defines the closed public version 1 catalog with 13 unique keys', () => {
    expect(SETTINGS_CATALOG_VERSION).toBe(1);
    expect(settingsCatalog).toHaveLength(13);
    expect(new Set(settingsCatalog.map(({ key }) => key)).size).toBe(13);
    expect(settingsCatalog.map((definition) => definition.public)).toEqual(
      Array.from({ length: 13 }, () => true),
    );
  });

  it('resolves company-backed defaults before technical fallbacks', () => {
    const company = {
      displayName: 'AS ONE Park',
      timezone: 'America/Cancun',
      locale: 'en-US',
      currencyCode: 'USD',
    };
    expect(resolveCatalogDefault('business.display_name', company)).toBe('AS ONE Park');
    expect(resolveCatalogDefault('business.timezone', company)).toBe('America/Cancun');
    expect(resolveCatalogDefault('business.locale', company)).toBe('en-US');
    expect(resolveCatalogDefault('business.currency', company)).toBe('USD');
  });

  it('uses technical fallbacks when company fields are unavailable', () => {
    const company = { displayName: null, timezone: '', locale: null };
    expect(resolveCatalogDefault('business.display_name', company)).toBe('');
    expect(resolveCatalogDefault('business.timezone', company)).toBe('America/Mexico_City');
    expect(resolveCatalogDefault('business.locale', company)).toBe('es-MX');
    expect(resolveCatalogDefault('business.currency', company)).toBe('MXN');
  });

  it('uses technical fallbacks when company fields are invalid', () => {
    const company = {
      displayName: ' ',
      timezone: 'Not/A_Zone',
      locale: 'fr-FR',
      currencyCode: 'EUR',
    };
    expect(resolveCatalogDefault('business.display_name', company)).toBe('');
    expect(resolveCatalogDefault('business.timezone', company)).toBe('America/Mexico_City');
    expect(resolveCatalogDefault('business.locale', company)).toBe('es-MX');
    expect(resolveCatalogDefault('business.currency', company)).toBe('MXN');
  });

  it('normalizes and validates approved string values', () => {
    const displayName = getSettingDefinition('business.display_name');
    const currency = getSettingDefinition('business.currency');
    expect(validateSettingValue(displayName, 'string', '  AS ONE  ')).toBe('AS ONE');
    expect(validateSettingValue(currency, 'string', ' usd ')).toBe('USD');
  });

  it('validates IANA timezones and 24-hour times', () => {
    expect(
      validateSettingValue(getSettingDefinition('business.timezone'), 'string', 'America/Merida'),
    ).toBe('America/Merida');
    expect(
      validateSettingValue(getSettingDefinition('operations.day_end_time'), 'string', '23:59'),
    ).toBe('23:59');
    expect(() =>
      validateSettingValue(getSettingDefinition('business.timezone'), 'string', 'Not/A_Zone'),
    ).toThrow(SettingValidationError);
    expect(() =>
      validateSettingValue(getSettingDefinition('operations.day_end_time'), 'string', '24:00'),
    ).toThrow(SettingValidationError);
  });

  it('enforces value types, integer bounds, and allowlists', () => {
    expect(() =>
      validateSettingValue(getSettingDefinition('business.locale'), 'boolean', true),
    ).toThrow(SettingValidationError);
    expect(() =>
      validateSettingValue(getSettingDefinition('security.session_idle_minutes'), 'integer', 4),
    ).toThrow(SettingValidationError);
    expect(() =>
      validateSettingValue(getSettingDefinition('ui.time_format'), 'string', 'military'),
    ).toThrow(SettingValidationError);
  });

  it('preserves receipt text and enforces its maximum length', () => {
    const header = getSettingDefinition('receipts.header_text');
    expect(validateSettingValue(header, 'string', '  Welcome  ')).toBe('  Welcome  ');
    expect(() => validateSettingValue(header, 'string', 'x'.repeat(501))).toThrow(
      SettingValidationError,
    );
  });

  it('marks company-only settings as non-overridable by branches', () => {
    expect(getSettingDefinition('business.currency').branchOverride).toBe(false);
    expect(getSettingDefinition('security.session_idle_minutes').branchOverride).toBe(false);
    expect(getSettingDefinition('business.locale').branchOverride).toBe(true);
  });

  it('rejects unknown keys and filters known keys in catalog order', () => {
    expect(() => getSettingDefinition('credentials.api_key')).toThrow(SettingValidationError);
    expect(
      selectSettingDefinitions(['ui.time_format', 'business.locale', 'ui.time_format']).map(
        ({ key }) => key,
      ),
    ).toEqual(['business.locale', 'ui.time_format']);
    expect(() => selectSettingDefinitions(['unknown.key'])).toThrow(SettingValidationError);
    expect(() => selectSettingDefinitions([42])).toThrow(SettingValidationError);
    expect(() => selectSettingDefinitions([''])).toThrow(SettingValidationError);
  });
});
