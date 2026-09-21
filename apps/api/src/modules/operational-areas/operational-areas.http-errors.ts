import { AppError } from '@asone/errors';

import { OperationalAreaError } from './operational-areas.types.js';

const statusCodeByCode: Readonly<Record<string, number>> = {
  resource_not_found: 404,
  validation_error: 400,
  idempotency_conflict: 409,
  version_conflict: 409,
};

export function mapOperationalAreaError(error: unknown): Error {
  if (!(error instanceof OperationalAreaError)) return error instanceof Error ? error : new Error('Unknown error');
  const statusCode = statusCodeByCode[error.code] ?? 409;
  if (statusCode === 404)
    return new AppError({ code: 'not_found', message: 'The resource was not found.', statusCode: 404 });
  return new AppError({ code: error.code, message: error.message, statusCode });
}

export async function withOperationalAreaErrors<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    throw mapOperationalAreaError(error);
  }
}
