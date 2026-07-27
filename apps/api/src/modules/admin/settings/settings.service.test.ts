import { describe, expect, it, vi } from 'vitest';

import type { DatabaseClient } from '@asone/database';

import { SettingsRepository, type SettingsSqlClient } from './settings.repository.js';
import { SettingsService } from './settings.service.js';

const mutation = {
  key: 'business.locale',
  value: 'en-US',
  valueType: 'string' as const,
  expectedVersion: 1n,
  actorId: 'user-1',
  timestamp: new Date('2026-07-26T12:00:00.000Z'),
};

function service(): SettingsService {
  const database = {
    pool: {
      connect: vi.fn(),
      query: vi.fn(),
    },
  } as unknown as DatabaseClient;
  return new SettingsService(new SettingsRepository(database));
}

describe('settings service boundaries', () => {
  it('does not grant branch access when the permitted list is empty', async () => {
    await expect(
      service().effectiveBranchSettings({
        companyId: 'company-1',
        branchId: 'branch-1',
        permittedBranchIds: [],
      }),
    ).rejects.toMatchObject({ code: 'branch_access_denied' });
  });

  it('rejects unknown keys and invalid values before persistence', async () => {
    await expect(
      service().setCompanySetting(
        { companyId: 'company-1' },
        { ...mutation, key: 'secret.api_key' },
      ),
    ).rejects.toMatchObject({ code: 'unknown_setting_key' });
    await expect(
      service().setCompanySetting(
        { companyId: 'company-1' },
        { ...mutation, valueType: 'boolean', value: true },
      ),
    ).rejects.toMatchObject({ code: 'invalid_setting_value' });
  });

  it('rejects branch overrides prohibited by the catalog', async () => {
    await expect(
      service().setBranchSetting(
        {
          companyId: 'company-1',
          branchId: 'branch-1',
          permittedBranchIds: ['branch-1'],
        },
        { ...mutation, key: 'business.currency', value: 'USD' },
      ),
    ).rejects.toMatchObject({ code: 'branch_override_not_allowed' });
  });

  it('uses an existing transaction without opening a nested transaction', async () => {
    const queries: string[] = [];
    const transaction: SettingsSqlClient = {
      query(sql: string): Promise<unknown> {
        queries.push(sql);
        if (sql.includes('from companies'))
          return Promise.resolve({
            rowCount: 1,
            rows: [
              {
                id: 'company-1',
                display_name: 'AS ONE',
                timezone: 'UTC',
                locale: 'es-MX',
                currency_code: 'MXN',
              },
            ],
          });
        return Promise.resolve({
          rowCount: 1,
          rows: [
            {
              id: 'setting-1',
              key: 'business.locale',
              value: 'en-US',
              value_type: 'string',
              status: 'active',
              version: '2',
              created_at: mutation.timestamp,
              updated_at: mutation.timestamp,
              deleted_at: null,
            },
          ],
        });
      },
    };
    const result = await service().setCompanySetting(
      { companyId: 'company-1' },
      { ...mutation, transaction },
    );
    expect(result.version).toBe(2n);
    expect(queries).toHaveLength(2);
    expect(queries).not.toContain('begin');
    expect(queries).not.toContain('commit');
  });
});
