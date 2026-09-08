import { AppError } from '@asone/errors';

import { SupplierError } from './suppliers.types.js';

// Mirrors `purchasing.http-errors.ts`'s own established shape exactly:
// every code below is already a member of `InfrastructureErrorCode`
// (packages/errors) — this domain reuses existing generic codes rather
// than inventing new ones, the same restraint TASK 13.0/13.1/14.3 each
// documented for their own new domains.
const supplierErrorStatus: Readonly<Record<string, number>> = {
  validation_error: 400,
  idempotency_conflict: 409,
  resource_not_found: 404,
  resource_conflict: 409,
};

export function mapSupplierError(error: unknown): Error {
  if (!(error instanceof SupplierError)) return error instanceof Error ? error : new Error('Unknown error');
  const statusCode = supplierErrorStatus[error.code] ?? 409;
  return new AppError({
    code: error.code,
    message: error.message,
    statusCode,
    ...(error.details === undefined ? {} : { details: error.details }),
  });
}

export async function withSupplierErrors<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    throw mapSupplierError(error);
  }
}
