export type SettingValueType = 'boolean' | 'integer' | 'string';

export type SettingValue = boolean | number | string;

export type EffectiveSettingSource = 'branch' | 'company' | 'default';

export interface CompanySettingDefaults {
  readonly displayName?: string | null;
  readonly timezone?: string | null;
  readonly locale?: string | null;
  readonly currencyCode?: string | null;
}

export interface SettingDefinition {
  readonly key: string;
  readonly type: SettingValueType;
  readonly branchOverride: boolean;
  readonly public: true;
  readonly technicalDefault: SettingValue;
  readonly resolveDefault: (company: CompanySettingDefaults) => SettingValue;
  readonly normalize: (value: unknown) => SettingValue;
}

export interface PersistedSetting {
  readonly id: string;
  readonly key: string;
  readonly value: unknown;
  readonly valueType: SettingValueType;
  readonly status: 'active' | 'retired';
  readonly version: bigint;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

export interface EffectiveSetting {
  readonly key: string;
  readonly type: SettingValueType;
  readonly value: SettingValue;
  readonly source: EffectiveSettingSource;
  readonly version: bigint;
}

export type SettingsErrorCode =
  | 'branch_access_denied'
  | 'branch_not_found'
  | 'branch_override_not_allowed'
  | 'company_not_found'
  | 'invalid_setting_value'
  | 'unknown_setting_key'
  | 'version_conflict';

export class SettingsError extends Error {
  public readonly code: SettingsErrorCode;
  public readonly details: Readonly<Record<string, unknown>> | undefined;

  public constructor(
    code: SettingsErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'SettingsError';
    this.code = code;
    this.details = details;
  }
}

export class SettingValidationError extends Error {
  public readonly settingKey: string;
  public readonly rule: string;

  public constructor(settingKey: string, rule: string, message: string) {
    super(message);
    this.name = 'SettingValidationError';
    this.settingKey = settingKey;
    this.rule = rule;
  }
}
