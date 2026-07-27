import { getSettingDefinition, selectSettingDefinitions } from './settings.catalog.js';
import { settingsCheckpoint } from './settings.checkpoint.js';
import type { SettingsRepository, SettingsSqlClient } from './settings.repository.js';
import { resolveBranchSettings, resolveCompanySettings } from './settings.resolution.js';
import {
  SettingValidationError,
  SettingsError,
  type EffectiveSetting,
  type PersistedSetting,
  type SettingDefinition,
  type SettingValue,
  type SettingValueType,
} from './settings.types.js';
import { validateSettingValue } from './settings.validation.js';

export interface SettingsScope {
  readonly companyId: string;
}

export interface BranchSettingsScope extends SettingsScope {
  readonly branchId: string;
  readonly permittedBranchIds: readonly string[];
}

export interface SettingMutation {
  readonly key: string;
  readonly value: unknown;
  readonly valueType: SettingValueType;
  readonly expectedVersion: bigint;
  readonly actorId: string;
  readonly timestamp: Date;
  readonly transaction?: SettingsSqlClient | undefined;
}

export interface AuditedSettingMutation extends SettingMutation {
  readonly requestId: string;
  readonly correlationId: string;
}

export interface SettingMutationResult {
  readonly persisted: PersistedSetting;
  readonly effective: EffectiveSetting;
}

export interface ResolvedSettings {
  readonly settings: readonly EffectiveSetting[];
  readonly checkpoint: string;
}

function definition(key: string): SettingDefinition {
  try {
    return getSettingDefinition(key);
  } catch (error) {
    if (error instanceof SettingValidationError)
      throw new SettingsError('unknown_setting_key', 'The setting key is not approved.', {
        key,
      });
    throw error;
  }
}

function definitions(keys?: readonly string[]): readonly SettingDefinition[] {
  try {
    return selectSettingDefinitions(keys);
  } catch (error) {
    if (error instanceof SettingValidationError)
      throw new SettingsError('unknown_setting_key', 'The setting key is not approved.', {
        key: error.settingKey,
        rule: error.rule,
      });
    throw error;
  }
}

function normalizedValue(
  setting: SettingDefinition,
  valueType: SettingValueType,
  value: unknown,
): SettingValue {
  try {
    return validateSettingValue(setting, valueType, value);
  } catch (error) {
    if (error instanceof SettingValidationError)
      throw new SettingsError('invalid_setting_value', 'The setting value is invalid.', {
        key: setting.key,
        rule: error.rule,
      });
    throw error;
  }
}

export class SettingsService {
  public constructor(private readonly repository: SettingsRepository) {}

  public async effectiveCompanySettings(
    scope: SettingsScope,
    keys?: readonly string[],
  ): Promise<ResolvedSettings> {
    const selected = definitions(keys);
    const company = await this.repository.company(scope.companyId);
    if (company === null)
      throw new SettingsError('company_not_found', 'The company was not found.');
    const rows = await this.repository.companySettings(
      scope.companyId,
      selected.map(({ key }) => key),
    );
    const settings = resolveCompanySettings(company, selected, rows);
    return { settings, checkpoint: settingsCheckpoint(settings) };
  }

  public async effectiveBranchSettings(
    scope: BranchSettingsScope,
    keys?: readonly string[],
  ): Promise<ResolvedSettings> {
    this.requireBranchAccess(scope);
    const selected = definitions(keys);
    const [company, branch] = await Promise.all([
      this.repository.company(scope.companyId),
      this.repository.branch(scope.companyId, scope.branchId),
    ]);
    if (company === null)
      throw new SettingsError('company_not_found', 'The company was not found.');
    if (branch?.status !== 'active')
      throw new SettingsError('branch_not_found', 'The branch was not found.');
    const selectedKeys = selected.map(({ key }) => key);
    const [companyRows, branchRows] = await Promise.all([
      this.repository.companySettings(scope.companyId, selectedKeys),
      this.repository.branchSettings(scope.companyId, scope.branchId, selectedKeys),
    ]);
    const companySettings = resolveCompanySettings(company, selected, companyRows);
    const settings = resolveBranchSettings(companySettings, selected, branchRows);
    return { settings, checkpoint: settingsCheckpoint(settings) };
  }

  public async setCompanySetting(
    scope: SettingsScope,
    mutation: SettingMutation,
  ): Promise<PersistedSetting> {
    const selected = definition(mutation.key);
    const value = normalizedValue(selected, mutation.valueType, mutation.value);
    return this.execute(mutation.transaction, async (transaction) => {
      if ((await this.repository.company(scope.companyId, transaction)) === null)
        throw new SettingsError('company_not_found', 'The company was not found.');
      return this.repository.setCompanySetting(transaction, {
        companyId: scope.companyId,
        key: selected.key,
        value,
        valueType: selected.type,
        expectedVersion: mutation.expectedVersion,
        actorId: mutation.actorId,
        timestamp: mutation.timestamp,
      });
    });
  }

  public async retireCompanySetting(
    scope: SettingsScope,
    mutation: SettingMutation,
  ): Promise<PersistedSetting> {
    const selected = definition(mutation.key);
    normalizedValue(selected, mutation.valueType, mutation.value);
    return this.execute(mutation.transaction, async (transaction) => {
      if ((await this.repository.company(scope.companyId, transaction)) === null)
        throw new SettingsError('company_not_found', 'The company was not found.');
      return this.repository.retireCompanySetting(transaction, {
        companyId: scope.companyId,
        key: selected.key,
        expectedVersion: mutation.expectedVersion,
        actorId: mutation.actorId,
        timestamp: mutation.timestamp,
      });
    });
  }

  public async setBranchSetting(
    scope: BranchSettingsScope,
    mutation: SettingMutation,
  ): Promise<PersistedSetting> {
    this.requireBranchAccess(scope);
    const selected = definition(mutation.key);
    if (!selected.branchOverride)
      throw new SettingsError(
        'branch_override_not_allowed',
        'The setting cannot be overridden by a branch.',
        { key: selected.key },
      );
    const value = normalizedValue(selected, mutation.valueType, mutation.value);
    return this.execute(mutation.transaction, async (transaction) => {
      await this.requireActiveBranch(scope, transaction);
      return this.repository.setBranchSetting(transaction, {
        companyId: scope.companyId,
        branchId: scope.branchId,
        key: selected.key,
        value,
        valueType: selected.type,
        expectedVersion: mutation.expectedVersion,
        actorId: mutation.actorId,
        timestamp: mutation.timestamp,
      });
    });
  }

  public async retireBranchSetting(
    scope: BranchSettingsScope,
    mutation: SettingMutation,
  ): Promise<PersistedSetting> {
    this.requireBranchAccess(scope);
    const selected = definition(mutation.key);
    if (!selected.branchOverride)
      throw new SettingsError(
        'branch_override_not_allowed',
        'The setting cannot be overridden by a branch.',
        { key: selected.key },
      );
    normalizedValue(selected, mutation.valueType, mutation.value);
    return this.execute(mutation.transaction, async (transaction) => {
      await this.requireActiveBranch(scope, transaction);
      return this.repository.retireBranchSetting(transaction, {
        companyId: scope.companyId,
        branchId: scope.branchId,
        key: selected.key,
        expectedVersion: mutation.expectedVersion,
        actorId: mutation.actorId,
        timestamp: mutation.timestamp,
      });
    });
  }

  public mutateCompanySetting(
    scope: SettingsScope,
    mutation: AuditedSettingMutation,
    status: 'active' | 'retired',
  ): Promise<SettingMutationResult> {
    return this.repository.transaction(async (transaction) => {
      const before = await this.resolveCompanySetting(scope, mutation.key, transaction);
      const persisted =
        status === 'active'
          ? await this.setCompanySetting(scope, { ...mutation, transaction })
          : await this.retireCompanySetting(scope, { ...mutation, transaction });
      const after = await this.resolveCompanySetting(scope, mutation.key, transaction);
      await this.recordMutation(transaction, {
        scope,
        mutation,
        status,
        persisted,
        before,
        after,
        aggregateType: 'company_setting',
        eventType: 'company_setting.changed',
      });
      return { persisted, effective: after };
    });
  }

  public mutateBranchSetting(
    scope: BranchSettingsScope,
    mutation: AuditedSettingMutation,
    status: 'active' | 'retired',
  ): Promise<SettingMutationResult> {
    return this.repository.transaction(async (transaction) => {
      const before = await this.resolveBranchSetting(scope, mutation.key, transaction);
      const persisted =
        status === 'active'
          ? await this.setBranchSetting(scope, { ...mutation, transaction })
          : await this.retireBranchSetting(scope, { ...mutation, transaction });
      const after = await this.resolveBranchSetting(scope, mutation.key, transaction);
      await this.recordMutation(transaction, {
        scope,
        mutation,
        status,
        persisted,
        before,
        after,
        aggregateType: 'branch_setting',
        eventType: 'branch_setting.changed',
      });
      return { persisted, effective: after };
    });
  }

  private async resolveCompanySetting(
    scope: SettingsScope,
    key: string,
    transaction: SettingsSqlClient,
  ): Promise<EffectiveSetting> {
    const selected = definition(key);
    const company = await this.repository.company(scope.companyId, transaction);
    if (company === null)
      throw new SettingsError('company_not_found', 'The company was not found.');
    const rows = await this.repository.companySettings(scope.companyId, [key], transaction);
    const effective = resolveCompanySettings(company, [selected], rows)[0];
    if (effective === undefined) throw new Error('The company setting could not be resolved.');
    return effective;
  }

  private async resolveBranchSetting(
    scope: BranchSettingsScope,
    key: string,
    transaction: SettingsSqlClient,
  ): Promise<EffectiveSetting> {
    this.requireBranchAccess(scope);
    const selected = definition(key);
    if (!selected.branchOverride)
      throw new SettingsError(
        'branch_override_not_allowed',
        'The setting cannot be overridden by a branch.',
        { key: selected.key },
      );
    const [company, branch] = await Promise.all([
      this.repository.company(scope.companyId, transaction),
      this.repository.branch(scope.companyId, scope.branchId, transaction),
    ]);
    if (company === null)
      throw new SettingsError('company_not_found', 'The company was not found.');
    if (branch?.status !== 'active')
      throw new SettingsError('branch_not_found', 'The branch was not found.');
    const [companyRows, branchRows] = await Promise.all([
      this.repository.companySettings(scope.companyId, [key], transaction),
      this.repository.branchSettings(scope.companyId, scope.branchId, [key], transaction),
    ]);
    const companyEffective = resolveCompanySettings(company, [selected], companyRows);
    const effective = resolveBranchSettings(companyEffective, [selected], branchRows)[0];
    if (effective === undefined) throw new Error('The branch setting could not be resolved.');
    return effective;
  }

  private async recordMutation(
    transaction: SettingsSqlClient,
    input: {
      readonly scope: SettingsScope & { readonly branchId?: string | undefined };
      readonly mutation: AuditedSettingMutation;
      readonly status: 'active' | 'retired';
      readonly persisted: PersistedSetting;
      readonly before: EffectiveSetting;
      readonly after: EffectiveSetting;
      readonly aggregateType: 'branch_setting' | 'company_setting';
      readonly eventType: 'branch_setting.changed' | 'company_setting.changed';
    },
  ): Promise<void> {
    const effectiveValueChanged =
      input.before.type !== input.after.type || !Object.is(input.before.value, input.after.value);
    const metadata = {
      key: input.persisted.key,
      value_type: input.after.type,
      status: input.status,
      source_before: input.before.source,
      source_after: input.after.source,
      version_before: Number(input.before.version),
      version_after: Number(input.persisted.version),
      effective_value_changed: effectiveValueChanged,
    };
    const shared = {
      companyId: input.scope.companyId,
      branchId: input.scope.branchId,
      aggregateType: input.aggregateType,
      aggregateId: input.persisted.id,
      correlationId: input.mutation.correlationId,
      timestamp: input.mutation.timestamp,
    };
    await this.repository.insertAudit(transaction, {
      companyId: shared.companyId,
      branchId: shared.branchId,
      actorId: input.mutation.actorId,
      action: `${input.aggregateType}.${input.status === 'retired' ? 'retired' : 'updated'}`,
      entityType: input.aggregateType,
      entityId: shared.aggregateId,
      requestId: input.mutation.requestId,
      correlationId: shared.correlationId,
      metadata,
      timestamp: shared.timestamp,
    });
    await this.repository.insertOutbox(transaction, {
      companyId: shared.companyId,
      branchId: shared.branchId,
      eventType: input.eventType,
      aggregateType: shared.aggregateType,
      aggregateId: shared.aggregateId,
      aggregateVersion: input.persisted.version,
      correlationId: shared.correlationId,
      payload: {
        key: input.persisted.key,
        value_type: input.after.type,
        status: input.status,
        source: input.after.source,
        effective_value_changed: effectiveValueChanged,
        version: Number(input.persisted.version),
      },
      timestamp: shared.timestamp,
    });
  }

  private execute<T>(
    transaction: SettingsSqlClient | undefined,
    callback: (transaction: SettingsSqlClient) => Promise<T>,
  ): Promise<T> {
    return transaction === undefined
      ? this.repository.transaction(callback)
      : callback(transaction);
  }

  private requireBranchAccess(scope: BranchSettingsScope): void {
    if (!scope.permittedBranchIds.includes(scope.branchId))
      throw new SettingsError('branch_access_denied', 'Branch access is not permitted.');
  }

  private async requireActiveBranch(
    scope: BranchSettingsScope,
    transaction: SettingsSqlClient,
  ): Promise<void> {
    const branch = await this.repository.branch(scope.companyId, scope.branchId, transaction);
    if (branch?.status !== 'active')
      throw new SettingsError('branch_not_found', 'The branch was not found.');
  }
}
