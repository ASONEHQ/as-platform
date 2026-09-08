import { AppError } from '@asone/errors';

import { ReportsError } from './reports.types.js';

// Mirrors `purchasing.http-errors.ts`'s own established shape exactly:
// every code below is already a member of `InfrastructureErrorCode`
// (packages/errors) — this domain reuses existing generic codes rather
// than inventing new ones (see `reports.types.ts`'s own doc comment).
const reportsErrorStatus: Readonly<Record<string, number>> = {
  validation_error: 400,
  resource_not_found: 404,
};

export function mapReportsError(error: unknown): Error {
  if (!(error instanceof ReportsError)) return error instanceof Error ? error : new Error('Unknown error');
  const statusCode = reportsErrorStatus[error.code] ?? 400;
  return new AppError({ code: error.code, message: error.message, statusCode });
}

export async function withReportsErrors<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    throw mapReportsError(error);
  }
}
