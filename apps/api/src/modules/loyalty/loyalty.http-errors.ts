import { AppError } from '@asone/errors';

import { LoyaltyError } from './loyalty.types.js';

const loyaltyErrorStatus: Readonly<Record<string, number>> = {
  validation_error: 400,
  resource_not_found: 404,
  resource_conflict: 409,
  version_conflict: 409,
};

export function mapLoyaltyError(error: unknown): Error {
  if (!(error instanceof LoyaltyError)) return error instanceof Error ? error : new Error('Unknown error');
  const statusCode = loyaltyErrorStatus[error.code] ?? 409;
  if (statusCode === 404)
    return new AppError({ code: 'not_found', message: 'The resource was not found.', statusCode: 404 });
  return new AppError({ code: error.code, message: error.message, statusCode });
}

export async function withLoyaltyErrors<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    throw mapLoyaltyError(error);
  }
}
