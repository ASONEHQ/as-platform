import { describe, expect, it, vi } from 'vitest';

import type { DatabaseClient } from '@asone/database';

import { SettingsRepository, type SettingsSqlClient } from './settings.repository.js';
import type { SettingsError } from './settings.types.js';

const now = new Date('2026-07-26T12:00:00.000Z');

function database(): DatabaseClient {
  return {
    pool: {
      connect: vi.fn(),
    },
  } as unknown as DatabaseClient;
}

function persisted(
  version: string,
  status: 'active' | 'retired' = 'active',
): Record<string, unknown> {
  return {
    id: 'setting-1',
    key: 'business.locale',
    value: 'en-US',
    value_type: 'string',
    status,
    version,
    created_at: now,
    updated_at: now,
    deleted_at: status === 'retired' ? now : null,
  };
}

function clientWith(
  handler: (sql: string, values: readonly unknown[]) => Promise<unknown>,
): SettingsSqlClient {
  return {
    query: (sql, values = []) => handler(sql, values),
  };
}

describe('settings repository mutations', () => {
  it('inserts the first company setting at version 2 when expected version is 1', async () => {
    const query = vi.fn((_sql: string, _values: readonly unknown[] = []) =>
      Promise.resolve({ rowCount: 1, rows: [persisted('2')] }),
    );
    const repository = new SettingsRepository(database());
    const result = await repository.setCompanySetting(clientWith(query), {
      companyId: 'company-1',
      key: 'business.locale',
      value: 'en-US',
      valueType: 'string',
      expectedVersion: 1n,
      actorId: 'user-1',
      timestamp: now,
    });
    expect(result.version).toBe(2n);
    expect(query.mock.calls[0]?.[0]).toContain('insert into company_settings');
    expect(query.mock.calls[0]?.[0]).toContain("'active',2");
  });

  it('increments an existing setting using the expected version in SQL', async () => {
    const query = vi.fn((_sql: string, _values: readonly unknown[] = []) =>
      Promise.resolve({ rowCount: 1, rows: [persisted('4')] }),
    );
    const repository = new SettingsRepository(database());
    const result = await repository.setCompanySetting(clientWith(query), {
      companyId: 'company-1',
      key: 'business.locale',
      value: 'en-US',
      valueType: 'string',
      expectedVersion: 3n,
      actorId: 'user-1',
      timestamp: now,
    });
    expect(result.version).toBe(4n);
    expect(query.mock.calls[0]?.[0]).toContain('version=version+1');
    expect(query.mock.calls[0]?.[0]).toContain('version=$3');
    expect(query.mock.calls[0]?.[1]).toContain('3');
  });

  it('retires without replacing the persisted value', async () => {
    const query = vi.fn((_sql: string, _values: readonly unknown[] = []) =>
      Promise.resolve({ rowCount: 1, rows: [persisted('5', 'retired')] }),
    );
    const repository = new SettingsRepository(database());
    const result = await repository.retireCompanySetting(clientWith(query), {
      companyId: 'company-1',
      key: 'business.locale',
      expectedVersion: 4n,
      actorId: 'user-1',
      timestamp: now,
    });
    expect(result).toMatchObject({ status: 'retired', version: 5n });
    expect(query.mock.calls[0]?.[0]).not.toContain('set value=');
    expect(query.mock.calls[0]?.[0]).toContain("status='retired'");
  });

  it('reactivates the same row using an atomic versioned update', async () => {
    const query = vi.fn((_sql: string, _values: readonly unknown[] = []) =>
      Promise.resolve({ rowCount: 1, rows: [persisted('6')] }),
    );
    const repository = new SettingsRepository(database());
    await repository.setCompanySetting(clientWith(query), {
      companyId: 'company-1',
      key: 'business.locale',
      value: 'en-US',
      valueType: 'string',
      expectedVersion: 5n,
      actorId: 'user-1',
      timestamp: now,
    });
    expect(query.mock.calls[0]?.[0]).toContain("status='active'");
    expect(query.mock.calls[0]?.[0]).toContain('deleted_at=null');
    expect(query.mock.calls[0]?.[0]).toContain('version=version+1');
  });

  it('maps a stale update to version_conflict', async () => {
    const repository = new SettingsRepository(database());
    await expect(
      repository.setCompanySetting(
        clientWith(() => Promise.resolve({ rowCount: 0, rows: [] })),
        {
          companyId: 'company-1',
          key: 'business.locale',
          value: 'en-US',
          valueType: 'string',
          expectedVersion: 4n,
          actorId: 'user-1',
          timestamp: now,
        },
      ),
    ).rejects.toMatchObject({ code: 'version_conflict' });
  });

  it('maps a concurrent first-write unique violation to version_conflict', async () => {
    const repository = new SettingsRepository(database());
    const conflict = Object.assign(new Error('duplicate'), { code: '23505' });
    await expect(
      repository.setCompanySetting(
        clientWith(() => Promise.reject(conflict)),
        {
          companyId: 'company-1',
          key: 'business.locale',
          value: 'en-US',
          valueType: 'string',
          expectedVersion: 1n,
          actorId: 'user-1',
          timestamp: now,
        },
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<SettingsError>>({ code: 'version_conflict' }),
    );
  });

  it('keeps branch scope in every branch mutation predicate', async () => {
    const query = vi.fn((_sql: string, _values: readonly unknown[] = []) =>
      Promise.resolve({ rowCount: 1, rows: [persisted('3')] }),
    );
    const repository = new SettingsRepository(database());
    await repository.setBranchSetting(clientWith(query), {
      companyId: 'company-1',
      branchId: 'branch-1',
      key: 'business.locale',
      value: 'en-US',
      valueType: 'string',
      expectedVersion: 2n,
      actorId: 'user-1',
      timestamp: now,
    });
    expect(query.mock.calls[0]?.[0]).toContain(
      'company_id=$1 and branch_id=$2 and key=$3 and version=$4',
    );
  });
});
