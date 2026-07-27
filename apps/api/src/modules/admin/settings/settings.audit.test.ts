import { describe, expect, it } from 'vitest';

import type {
  SettingAuditInput,
  SettingOutboxInput,
  SettingsRepository,
  SettingsSqlClient,
} from './settings.repository.js';
import { SettingsService, type AuditedSettingMutation } from './settings.service.js';
import type { PersistedSetting } from './settings.types.js';

const now = new Date('2026-07-26T18:00:00.000Z');
const transaction: SettingsSqlClient = { query: () => Promise.resolve({ rows: [], rowCount: 0 }) };
const defaults = {
  id: '00000000-0000-4000-8000-000000000001',
  displayName: 'AS ONE',
  timezone: 'America/Mexico_City',
  locale: 'es-MX',
  currencyCode: 'MXN',
};

const input: AuditedSettingMutation = {
  key: 'business.locale',
  value: 'en-US',
  valueType: 'string',
  expectedVersion: 1n,
  actorId: '00000000-0000-4000-8000-000000000002',
  requestId: 'request-1',
  correlationId: 'correlation-1',
  timestamp: now,
};

function row(
  options: {
    id?: string;
    value?: string;
    status?: 'active' | 'retired';
    version?: bigint;
  } = {},
): PersistedSetting {
  return {
    id: options.id ?? '00000000-0000-4000-8000-000000000003',
    key: 'business.locale',
    value: options.value ?? 'en-US',
    valueType: 'string',
    status: options.status ?? 'active',
    version: options.version ?? 2n,
    createdAt: now,
    updatedAt: now,
    deletedAt: options.status === 'retired' ? now : null,
  };
}

interface Fixture {
  readonly service: SettingsService;
  readonly audits: SettingAuditInput[];
  readonly events: SettingOutboxInput[];
  readonly clients: SettingsSqlClient[];
  get persisted(): PersistedSetting | null;
}

function fixture(
  options: {
    readonly initial?: PersistedSetting | null;
    readonly after?: PersistedSetting;
    readonly fail?: 'audit' | 'outbox' | 'setting' | 'version';
  } = {},
): Fixture {
  let persisted = options.initial ?? null;
  const audits: SettingAuditInput[] = [];
  const events: SettingOutboxInput[] = [];
  const clients: SettingsSqlClient[] = [];
  const repository = {
    transaction: async <T>(callback: (client: SettingsSqlClient) => Promise<T>): Promise<T> => {
      const snapshot = persisted;
      try {
        return await callback(transaction);
      } catch (error) {
        persisted = snapshot;
        audits.splice(0);
        events.splice(0);
        throw error;
      }
    },
    company: (_companyId: string, client: SettingsSqlClient) => {
      clients.push(client);
      return Promise.resolve(defaults);
    },
    branch: (_companyId: string, _branchId: string, client: SettingsSqlClient) => {
      clients.push(client);
      return Promise.resolve({ id: 'branch-1', companyId: defaults.id, status: 'active' });
    },
    companySettings: (_companyId: string, _keys: readonly string[], client: SettingsSqlClient) => {
      clients.push(client);
      return Promise.resolve(persisted === null ? [] : [persisted]);
    },
    branchSettings: (
      _companyId: string,
      _branchId: string,
      _keys: readonly string[],
      client: SettingsSqlClient,
    ) => {
      clients.push(client);
      return Promise.resolve(persisted === null ? [] : [persisted]);
    },
    setCompanySetting: (client: SettingsSqlClient) => mutate(client),
    retireCompanySetting: (client: SettingsSqlClient) => mutate(client),
    setBranchSetting: (client: SettingsSqlClient) => mutate(client),
    retireBranchSetting: (client: SettingsSqlClient) => mutate(client),
    insertAudit: (client: SettingsSqlClient, audit: SettingAuditInput) => {
      clients.push(client);
      if (options.fail === 'audit') return Promise.reject(new Error('audit failed'));
      audits.push(audit);
      return Promise.resolve();
    },
    insertOutbox: (client: SettingsSqlClient, event: SettingOutboxInput) => {
      clients.push(client);
      if (options.fail === 'outbox') return Promise.reject(new Error('outbox failed'));
      events.push(event);
      return Promise.resolve();
    },
  };

  function mutate(client: SettingsSqlClient): Promise<PersistedSetting> {
    clients.push(client);
    if (options.fail === 'setting') return Promise.reject(new Error('setting failed'));
    if (options.fail === 'version')
      return Promise.reject(
        Object.assign(new Error('The setting version changed.'), { code: 'version_conflict' }),
      );
    persisted =
      options.after ??
      row({
        ...(persisted === null ? {} : { id: persisted.id }),
        version: (persisted?.version ?? 1n) + 1n,
      });
    return Promise.resolve(persisted);
  }

  return {
    service: new SettingsService(repository as unknown as SettingsRepository),
    audits,
    events,
    clients,
    get persisted() {
      return persisted;
    },
  };
}

describe('transactional settings audit and outbox', () => {
  it('records a company update and safe changed event in the same transaction', async () => {
    const state = fixture();
    const result = await state.service.mutateCompanySetting(
      { companyId: defaults.id },
      input,
      'active',
    );

    expect(result.persisted.version).toBe(2n);
    expect(state.clients.every((client) => client === transaction)).toBe(true);
    expect(state.audits).toEqual([
      expect.objectContaining({
        action: 'company_setting.updated',
        entityType: 'company_setting',
        entityId: result.persisted.id,
        requestId: 'request-1',
        correlationId: 'correlation-1',
      }),
    ]);
    expect(state.audits[0]?.metadata).toMatchObject({
      source_before: 'default',
      source_after: 'company',
      version_before: 1,
      version_after: 2,
      effective_value_changed: true,
    });
    expect(state.events).toEqual([
      expect.objectContaining({
        eventType: 'company_setting.changed',
        aggregateType: 'company_setting',
        aggregateId: result.persisted.id,
        aggregateVersion: 2n,
        correlationId: 'correlation-1',
        payload: {
          key: 'business.locale',
          value_type: 'string',
          status: 'active',
          source: 'company',
          effective_value_changed: true,
          version: 2,
        },
      }),
    ]);
    expect(
      JSON.stringify({
        audit: state.audits[0]?.metadata,
        outbox: state.events[0]?.payload,
      }),
    ).not.toContain('en-US');
  });

  it('records retirement, preserves the row, and reports an unchanged inherited value', async () => {
    const initial = row({ value: 'es-MX', version: 2n });
    const state = fixture({
      initial,
      after: row({ id: initial.id, value: 'es-MX', status: 'retired', version: 3n }),
    });
    const result = await state.service.mutateCompanySetting(
      { companyId: defaults.id },
      { ...input, value: 'es-MX', expectedVersion: 2n },
      'retired',
    );

    expect(result).toMatchObject({
      persisted: { id: initial.id, value: 'es-MX', status: 'retired', version: 3n },
      effective: { source: 'default', value: 'es-MX' },
    });
    expect(state.audits[0]).toMatchObject({
      action: 'company_setting.retired',
      metadata: {
        source_before: 'company',
        source_after: 'default',
        effective_value_changed: false,
      },
    });
    expect(state.events[0]?.payload).toMatchObject({
      status: 'retired',
      source: 'default',
      effective_value_changed: false,
    });
  });

  it('reactivates the stable aggregate with an updated action', async () => {
    const initial = row({ status: 'retired', value: 'en-US', version: 3n });
    const state = fixture({
      initial,
      after: row({ id: initial.id, value: 'en-US', version: 4n }),
    });
    const result = await state.service.mutateCompanySetting(
      { companyId: defaults.id },
      { ...input, expectedVersion: 3n },
      'active',
    );
    expect(result.persisted.id).toBe(initial.id);
    expect(state.audits[0]).toMatchObject({
      action: 'company_setting.updated',
      entityId: initial.id,
    });
    expect(state.events[0]).toMatchObject({
      aggregateId: initial.id,
      aggregateVersion: 4n,
    });
  });

  it('records branch scope and detects a changed inherited value after retirement', async () => {
    const initial = row({ value: 'en-US', version: 2n });
    const state = fixture({
      initial,
      after: row({ id: initial.id, value: 'en-US', status: 'retired', version: 3n }),
    });
    await state.service.mutateBranchSetting(
      {
        companyId: defaults.id,
        branchId: 'branch-1',
        permittedBranchIds: ['branch-1'],
      },
      { ...input, expectedVersion: 2n },
      'retired',
    );
    expect(state.audits[0]).toMatchObject({
      branchId: 'branch-1',
      action: 'branch_setting.retired',
      metadata: {
        source_before: 'branch',
        source_after: 'default',
        effective_value_changed: true,
      },
    });
    expect(state.events[0]).toMatchObject({
      branchId: 'branch-1',
      eventType: 'branch_setting.changed',
    });
  });

  it('records an active branch update with the branch aggregate and event', async () => {
    const state = fixture();
    const result = await state.service.mutateBranchSetting(
      {
        companyId: defaults.id,
        branchId: 'branch-1',
        permittedBranchIds: ['branch-1'],
      },
      input,
      'active',
    );
    expect(state.audits[0]).toMatchObject({
      branchId: 'branch-1',
      action: 'branch_setting.updated',
      entityType: 'branch_setting',
      entityId: result.persisted.id,
    });
    expect(state.events[0]).toMatchObject({
      branchId: 'branch-1',
      eventType: 'branch_setting.changed',
      aggregateType: 'branch_setting',
      aggregateId: result.persisted.id,
    });
  });

  it.each(['setting', 'audit', 'outbox'] as const)(
    'rolls back the setting, audit, and outbox when %s fails',
    async (failure) => {
      const initial = row({ version: 2n });
      const state = fixture({ initial, fail: failure });
      await expect(
        state.service.mutateCompanySetting(
          { companyId: defaults.id },
          { ...input, expectedVersion: 2n },
          'active',
        ),
      ).rejects.toThrow(`${failure} failed`);
      expect(state.persisted).toEqual(initial);
      expect(state.audits).toEqual([]);
      expect(state.events).toEqual([]);
    },
  );

  it('leaves no audit or outbox evidence after a version conflict', async () => {
    const initial = row({ version: 2n });
    const state = fixture({ initial, fail: 'version' });
    await expect(
      state.service.mutateCompanySetting(
        { companyId: defaults.id },
        { ...input, expectedVersion: 1n },
        'active',
      ),
    ).rejects.toMatchObject({ code: 'version_conflict' });
    expect(state.persisted).toEqual(initial);
    expect(state.audits).toEqual([]);
    expect(state.events).toEqual([]);
  });
});
