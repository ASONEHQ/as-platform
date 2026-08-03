import { afterEach, describe, expect, it, vi } from 'vitest';

import { runBootstrapOwner } from './bootstrap-owner.cli.js';
import {
  BootstrapInputError,
  validateBootstrapEnvironment,
  validateBootstrapPassword,
} from './bootstrap-owner.service.js';

const strongPassword = 'Ephemeral#Owner2026!';
const localDatabase = 'postgresql://local:secret@127.0.0.1:5432/asone_local';

describe('development owner bootstrap safety', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(['production', 'staging', 'demo', '', undefined])(
    'rejects unsafe or ambiguous NODE_ENV=%s',
    (nodeEnvironment) => {
      expect(() =>
        validateBootstrapEnvironment({
          NODE_ENV: nodeEnvironment,
          DATABASE_URL: localDatabase,
          AS_DEV_BOOTSTRAP_PASSWORD: strongPassword,
        }),
      ).toThrow(BootstrapInputError);
    },
  );

  it('rejects missing, weak, and placeholder passwords', () => {
    expect(() =>
      validateBootstrapEnvironment({ NODE_ENV: 'development', DATABASE_URL: localDatabase }),
    ).toThrow('AS_DEV_BOOTSTRAP_PASSWORD is required.');
    for (const password of ['short', 'Password123!', 'Change_Me#2026A']) {
      expect(() => {
        validateBootstrapPassword(password);
      }).toThrow(BootstrapInputError);
    }
  });

  it.each([
    'postgresql://local:secret@example.com:5432/asone_local',
    'postgresql://local:secret@127.0.0.1:5432/postgres',
    'postgresql://local:secret@127.0.0.1:5432/asone_production',
  ])('rejects protected or non-local database target %s', (databaseUrl) => {
    expect(() =>
      validateBootstrapEnvironment({
        NODE_ENV: 'development',
        DATABASE_URL: databaseUrl,
        AS_DEV_BOOTSTRAP_PASSWORD: strongPassword,
      }),
    ).toThrow(BootstrapInputError);
  });

  it('accepts only the local development and explicit test naming policies', () => {
    expect(
      validateBootstrapEnvironment({
        NODE_ENV: 'development',
        DATABASE_URL: localDatabase,
        AS_DEV_BOOTSTRAP_PASSWORD: strongPassword,
      }).databaseUrl,
    ).toBe(localDatabase);
    expect(
      validateBootstrapEnvironment({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://test:secret@localhost:5432/asone_owner_test',
        AS_DEV_BOOTSTRAP_PASSWORD: strongPassword,
      }).password,
    ).toBe(strongPassword);
  });

  it('returns a non-zero guard failure without printing the password', async () => {
    let output = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((value) => {
      output += String(value);
      return true;
    });
    const code = await runBootstrapOwner({
      NODE_ENV: 'production',
      DATABASE_URL: localDatabase,
      AS_DEV_BOOTSTRAP_PASSWORD: strongPassword,
    });
    expect(code).toBe(1);
    expect(output).toContain('success');
    expect(output).not.toContain(strongPassword);
    expect(output).not.toContain('secret@');
  });
});
