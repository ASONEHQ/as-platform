import { AppError } from '@asone/errors';

import { CustomerError } from './customers.types.js';

const customerErrorStatus: Readonly<Record<string, number>> = {
  validation_error: 400,
  permission_denied: 403,
  resource_not_found: 404,
  resource_conflict: 409,
  version_conflict: 409,
  customer_identity_conflict: 409,
  qr_token_invalid: 404,
};

export function mapCustomerError(error: unknown): Error {
  if (!(error instanceof CustomerError)) return error instanceof Error ? error : new Error('Unknown error');
  const statusCode = customerErrorStatus[error.code] ?? 409;
  if (statusCode === 404)
    return new AppError({ code: 'not_found', message: 'The resource was not found.', statusCode: 404 });
  return new AppError({
    code: error.code,
    message: error.message,
    statusCode,
    ...(error.details === undefined ? {} : { details: error.details }),
  });
}

export async function withCustomerErrors<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    throw mapCustomerError(error);
  }
}
