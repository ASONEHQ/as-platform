import { AppError } from '@asone/errors';

import { SettingsError } from './settings.types.js';

export function mapSettingsError(error: unknown): Error {
  if (!(error instanceof SettingsError))
    return error instanceof Error ? error : new Error('Unknown error');

  switch (error.code) {
    case 'unknown_setting_key':
    case 'invalid_setting_value':
    case 'branch_override_not_allowed':
      return new AppError({
        code: 'validation_error',
        message: error.message,
        statusCode: 400,
        ...(error.details === undefined ? {} : { details: error.details }),
      });
    case 'company_not_found':
    case 'branch_not_found':
      return new AppError({
        code: 'not_found',
        message: 'The resource was not found.',
        statusCode: 404,
      });
    case 'branch_access_denied':
      return new AppError({
        code: 'branch_scope_mismatch',
        message: 'Branch scope is not authorized.',
        statusCode: 403,
      });
    case 'version_conflict':
      return new AppError({
        code: 'version_conflict',
        message: 'The setting changed before this operation could be applied.',
        statusCode: 409,
        ...(error.details === undefined ? {} : { details: error.details }),
      });
  }
}

export async function withSettingsErrors<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    throw mapSettingsError(error);
  }
}
