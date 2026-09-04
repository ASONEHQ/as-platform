import { afterEach, describe, expect, it, vi } from 'vitest';

import { runSeedPosCatalog } from './seed-pos-catalog.cli.js';
import { PosCatalogSeedError, validateSeedEnvironment } from './seed-pos-catalog.service.js';

const localDatabase = 'postgresql://local:secret@127.0.0.1:5432/asone_local';

describe('POS catalog dev seed safety', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(['production', 'staging', 'demo', '', undefined])(
    'rejects unsafe or ambiguous NODE_ENV=%s',
    (nodeEnvironment) => {
      expect(() =>
        validateSeedEnvironment({ NODE_ENV: nodeEnvironment, DATABASE_URL: localDatabase }),
      ).toThrow(PosCatalogSeedError);
    },
  );

  it('rejects a missing DATABASE_URL', () => {
    expect(() => validateSeedEnvironment({ NODE_ENV: 'development' })).toThrow(
      'DATABASE_URL is required.',
    );
  });

  it('rejects a malformed DATABASE_URL', () => {
    expect(() =>
      validateSeedEnvironment({ NODE_ENV: 'development', DATABASE_URL: 'not-a-url' }),
    ).toThrow('DATABASE_URL must be a valid PostgreSQL URL.');
  });

  it.each([
    'postgresql://local:secret@example.com:5432/asone_local',
    'postgresql://local:secret@127.0.0.1:5432/postgres',
    'postgresql://local:secret@127.0.0.1:5432/asone_production',
  ])('rejects protected or non-local database target %s', (databaseUrl) => {
    expect(() => validateSeedEnvironment({ NODE_ENV: 'development', DATABASE_URL: databaseUrl })).toThrow(
      PosCatalogSeedError,
    );
  });

  it('accepts only the local development and explicit test naming policies', () => {
    expect(
      validateSeedEnvironment({ NODE_ENV: 'development', DATABASE_URL: localDatabase }).databaseUrl,
    ).toBe(localDatabase);
    expect(
      validateSeedEnvironment({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://test:secret@localhost:5432/asone_pos_catalog_test',
      }).databaseUrl,
    ).toBe('postgresql://test:secret@localhost:5432/asone_pos_catalog_test');
  });

  it('returns a non-zero guard failure without printing connection secrets', async () => {
    let output = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((value) => {
      output += String(value);
      return true;
    });
    const code = await runSeedPosCatalog({ NODE_ENV: 'production', DATABASE_URL: localDatabase });
    expect(code).toBe(1);
    expect(output).toContain('success');
    expect(output).not.toContain('secret@');
  });
});
