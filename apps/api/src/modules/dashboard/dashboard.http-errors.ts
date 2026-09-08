import { AppError } from '@asone/errors';

import { DashboardError } from './dashboard.types.js';

// Mirrors `reports.http-errors.ts`'s own established shape exactly.
const dashboardErrorStatus: Readonly<Record<string, number>> = {
  validation_error: 400,
  resource_not_found: 404,
};

export function mapDashboardError(error: unknown): Error {
  if (!(error instanceof DashboardError)) return error instanceof Error ? error : new Error('Unknown error');
  const statusCode = dashboardErrorStatus[error.code] ?? 400;
  return new AppError({ code: error.code, message: error.message, statusCode });
}

export async function withDashboardErrors<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    throw mapDashboardError(error);
  }
}
