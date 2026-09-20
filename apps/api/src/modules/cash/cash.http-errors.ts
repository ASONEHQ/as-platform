import { AppError } from '@asone/errors';

import { CashError } from './cash.types.js';

const statusCodeByCode: Readonly<Record<string, number>> = {
  resource_not_found: 404,
  validation_error: 400,
  idempotency_conflict: 409,
  version_conflict: 409,
  cash_session_required: 409,
  cash_session_already_open: 409,
  cash_session_not_open: 409,
  cash_session_closed: 409,
  cash_movement_not_reversible: 409,
  cash_movement_already_reversed: 409,
};

export function mapCashError(error: unknown): Error {
  if (!(error instanceof CashError)) return error instanceof Error ? error : new Error('Unknown error');
  const statusCode = statusCodeByCode[error.code] ?? 409;
  if (statusCode === 404)
    return new AppError({ code: 'not_found', message: 'The resource was not found.', statusCode: 404 });
  return new AppError({ code: error.code, message: error.message, statusCode });
}

export async function withCashErrors<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    throw mapCashError(error);
  }
}
