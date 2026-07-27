import type { CompanyDefaultsRow } from './settings.repository.js';
import type {
  EffectiveSetting,
  PersistedSetting,
  SettingDefinition,
  SettingValue,
} from './settings.types.js';
import { SettingValidationError, SettingsError } from './settings.types.js';
import { validateSettingValue } from './settings.validation.js';

function rowMap(rows: readonly PersistedSetting[]): ReadonlyMap<string, PersistedSetting> {
  return new Map(rows.map((row) => [row.key, row]));
}

function persistedValue(definition: SettingDefinition, row: PersistedSetting): SettingValue {
  try {
    return validateSettingValue(definition, row.valueType, row.value);
  } catch (error) {
    if (error instanceof SettingValidationError)
      throw new SettingsError('invalid_setting_value', 'The persisted setting value is invalid.', {
        key: definition.key,
        rule: error.rule,
      });
    throw error;
  }
}

export function resolveCompanySettings(
  company: CompanyDefaultsRow,
  definitions: readonly SettingDefinition[],
  rows: readonly PersistedSetting[],
): readonly EffectiveSetting[] {
  const persisted = rowMap(rows);
  return definitions.map((definition) => {
    const row = persisted.get(definition.key);
    if (row?.status === 'active') {
      return {
        key: definition.key,
        type: definition.type,
        value: persistedValue(definition, row),
        source: 'company',
        version: row.version,
      };
    }
    return {
      key: definition.key,
      type: definition.type,
      value: definition.resolveDefault(company),
      source: 'default',
      version: row?.version ?? 1n,
    };
  });
}

export function resolveBranchSettings(
  companySettings: readonly EffectiveSetting[],
  definitions: readonly SettingDefinition[],
  branchRows: readonly PersistedSetting[],
): readonly EffectiveSetting[] {
  const companyByKey = new Map(companySettings.map((setting) => [setting.key, setting]));
  const branchByKey = rowMap(branchRows);
  return definitions.map((definition) => {
    const inherited = companyByKey.get(definition.key);
    if (inherited === undefined)
      throw new SettingsError(
        'invalid_setting_value',
        'The company setting resolution is incomplete.',
        {
          key: definition.key,
        },
      );
    const branch = branchByKey.get(definition.key);
    if (!definition.branchOverride || branch === undefined) return inherited;
    if (branch.status === 'active') {
      return {
        key: definition.key,
        type: definition.type,
        value: persistedValue(definition, branch),
        source: 'branch',
        version: branch.version,
      };
    }
    return { ...inherited, version: branch.version };
  });
}
