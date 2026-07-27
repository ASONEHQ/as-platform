import { describe, expect, it } from 'vitest';

import { AppError } from '@asone/errors';

import { mapSettingsError } from './settings.http-errors.js';
import { SettingsError } from './settings.types.js';

describe('settings HTTP error translator', () => {
  it.each([
    ['unknown_setting_key', 'validation_error', 400],
    ['invalid_setting_value', 'validation_error', 400],
    ['branch_override_not_allowed', 'validation_error', 400],
    ['company_not_found', 'not_found', 404],
    ['branch_not_found', 'not_found', 404],
    ['branch_access_denied', 'branch_scope_mismatch', 403],
    ['version_conflict', 'version_conflict', 409],
  ] as const)('maps %s centrally', (source, target, status) => {
    expect(mapSettingsError(new SettingsError(source, 'safe'))).toMatchObject({
      code: target,
      statusCode: status,
    });
  });

  it('passes existing safe errors through and does not expose arbitrary database objects', () => {
    const safe = new AppError({ code: 'validation_error', message: 'safe', statusCode: 400 });
    expect(mapSettingsError(safe)).toBe(safe);
    const databaseError = Object.assign(new Error('duplicate key detail'), {
      code: '23505',
      detail: 'private database detail',
    });
    expect(mapSettingsError(databaseError)).toBe(databaseError);
  });
});
