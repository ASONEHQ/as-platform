import { AppError } from '@asone/errors';

import { BranchConsolidationError } from './branch-consolidation.types.js';

const statusCodeByCode: Readonly<Record<string, number>> = {
  resource_not_found: 404,
  validation_error: 400,
};

export function mapBranchConsolidationError(error: unknown): Error {
  if (!(error instanceof BranchConsolidationError)) return error instanceof Error ? error : new Error('Unknown error');
  const statusCode = statusCodeByCode[error.code] ?? 400;
  if (statusCode === 404)
    return new AppError({ code: 'not_found', message: 'The resource was not found.', statusCode: 404 });
  return new AppError({ code: error.code, message: error.message, statusCode });
}

export async function withBranchConsolidationErrors<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    throw mapBranchConsolidationError(error);
  }
}
