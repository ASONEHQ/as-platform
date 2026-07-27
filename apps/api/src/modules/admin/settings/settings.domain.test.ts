import { describe, expect, it } from 'vitest';

import { getSettingDefinition, selectSettingDefinitions } from './settings.catalog.js';
import {
  canonicalSettingsSerialization,
  settingsCheckpoint,
  settingsCheckpointEtag,
} from './settings.checkpoint.js';
import type { CompanyDefaultsRow } from './settings.repository.js';
import { resolveBranchSettings, resolveCompanySettings } from './settings.resolution.js';
import type { EffectiveSetting, PersistedSetting } from './settings.types.js';

const company: CompanyDefaultsRow = {
  id: 'company-1',
  displayName: 'Base Park',
  timezone: 'America/Mexico_City',
  locale: 'es-MX',
  currencyCode: 'MXN',
};

function row(
  key: string,
  value: unknown,
  options: {
    readonly status?: 'active' | 'retired';
    readonly version?: bigint;
    readonly valueType?: 'boolean' | 'integer' | 'string';
  } = {},
): PersistedSetting {
  const status = options.status ?? 'active';
  return {
    id: `row-${key}`,
    key,
    value,
    valueType: options.valueType ?? 'string',
    status,
    version: options.version ?? 2n,
    createdAt: new Date('2026-07-26T00:00:00.000Z'),
    updatedAt: new Date('2026-07-26T00:00:00.000Z'),
    deletedAt: status === 'retired' ? new Date('2026-07-26T01:00:00.000Z') : null,
  };
}

function effective(
  key: string,
  value: EffectiveSetting['value'],
  source: EffectiveSetting['source'],
  version: bigint,
): EffectiveSetting {
  return { key, type: typeof value === 'boolean' ? 'boolean' : 'string', value, source, version };
}

describe('effective settings resolution', () => {
  it('resolves dynamic and static defaults at virtual version 1', () => {
    const definitions = selectSettingDefinitions([
      'business.display_name',
      'operations.day_start_time',
    ]);
    expect(resolveCompanySettings(company, definitions, [])).toEqual([
      {
        key: 'business.display_name',
        type: 'string',
        value: 'Base Park',
        source: 'default',
        version: 1n,
      },
      {
        key: 'operations.day_start_time',
        type: 'string',
        value: '09:00',
        source: 'default',
        version: 1n,
      },
    ]);
  });

  it('uses an active company override and preserves a retired row version', () => {
    const definitions = selectSettingDefinitions(['business.locale', 'business.timezone']);
    const settings = resolveCompanySettings(company, definitions, [
      row('business.locale', 'en-US', { version: 4n }),
      row('business.timezone', 'America/Cancun', { status: 'retired', version: 7n }),
    ]);
    expect(settings).toEqual([
      {
        key: 'business.timezone',
        type: 'string',
        value: 'America/Mexico_City',
        source: 'default',
        version: 7n,
      },
      {
        key: 'business.locale',
        type: 'string',
        value: 'en-US',
        source: 'company',
        version: 4n,
      },
    ]);
  });

  it('reflects base-company changes only when no active override exists', () => {
    const definitions = selectSettingDefinitions(['business.display_name']);
    const override = [row('business.display_name', 'Override Park', { version: 3n })];
    const changed = { ...company, displayName: 'Changed Base' };
    expect(resolveCompanySettings(changed, definitions, [])[0]?.value).toBe('Changed Base');
    expect(resolveCompanySettings(company, definitions, override)).toEqual(
      resolveCompanySettings(changed, definitions, override),
    );
  });

  it('resolves branch over company and preserves a retired branch version while inheriting', () => {
    const definitions = selectSettingDefinitions(['business.locale', 'ui.time_format']);
    const companySettings = resolveCompanySettings(company, definitions, [
      row('business.locale', 'en-US', { version: 3n }),
    ]);
    const settings = resolveBranchSettings(companySettings, definitions, [
      row('business.locale', 'es-MX', { version: 5n }),
      row('ui.time_format', '12h', { status: 'retired', version: 8n }),
    ]);
    expect(settings).toEqual([
      {
        key: 'business.locale',
        type: 'string',
        value: 'es-MX',
        source: 'branch',
        version: 5n,
      },
      {
        key: 'ui.time_format',
        type: 'string',
        value: '24h',
        source: 'default',
        version: 8n,
      },
    ]);
  });

  it('inherits company version when no branch row exists', () => {
    const definitions = selectSettingDefinitions(['business.locale']);
    const companySettings = resolveCompanySettings(company, definitions, [
      row('business.locale', 'en-US', { version: 6n }),
    ]);
    expect(resolveBranchSettings(companySettings, definitions, [])[0]).toMatchObject({
      source: 'company',
      value: 'en-US',
      version: 6n,
    });
  });

  it('safely ignores a branch row for a non-overridable key', () => {
    const definitions = selectSettingDefinitions(['business.currency']);
    const inherited = resolveCompanySettings(company, definitions, []);
    expect(
      resolveBranchSettings(inherited, definitions, [
        row('business.currency', 'USD', { version: 99n }),
      ]),
    ).toEqual(inherited);
    expect(getSettingDefinition('business.currency').branchOverride).toBe(false);
  });
});

describe('settings checkpoints', () => {
  const first = effective('business.locale', 'es-MX', 'default', 1n);
  const second = effective('ui.time_format', '24h', 'default', 1n);

  it('uses a deterministic tuple serialization independent of input order', () => {
    expect(canonicalSettingsSerialization([first, second])).toBe(
      canonicalSettingsSerialization([second, first]),
    );
    expect(settingsCheckpoint([first, second])).toBe(settingsCheckpoint([second, first]));
  });

  it.each([
    ['value', { ...first, value: 'en-US' }],
    ['source', { ...first, source: 'company' as const }],
    ['version', { ...first, version: 2n }],
  ])('changes when the effective %s changes', (_label, changed) => {
    expect(settingsCheckpoint([changed])).not.toBe(settingsCheckpoint([first]));
  });

  it('creates stable checkpoints for subsets and equal cross-company states', () => {
    const subset = settingsCheckpoint([first]);
    expect(subset).toBe(settingsCheckpoint([{ ...first }]));
    expect(subset).not.toBe(settingsCheckpoint([first, second]));
    expect(subset).toMatch(/^settings:[a-f0-9]{64}$/u);
    expect(settingsCheckpointEtag(subset)).toBe(`"${subset}"`);
  });

  it('tracks dynamic defaults but remains stable behind an active override', () => {
    const definitions = selectSettingDefinitions(['business.display_name']);
    const changed = { ...company, displayName: 'Changed Base' };
    const baseOne = resolveCompanySettings(company, definitions, []);
    const baseTwo = resolveCompanySettings(changed, definitions, []);
    expect(settingsCheckpoint(baseOne)).not.toBe(settingsCheckpoint(baseTwo));

    const override = [row('business.display_name', 'Override Park', { version: 3n })];
    expect(settingsCheckpoint(resolveCompanySettings(company, definitions, override))).toBe(
      settingsCheckpoint(resolveCompanySettings(changed, definitions, override)),
    );
  });
});
