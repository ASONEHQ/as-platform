import { AppError } from '@asone/errors';

import { PeopleError } from './people.types.js';

/**
 * Mirrors `purchasing.http-errors.ts`/`parties.http-errors.ts`'s own
 * established shape. Six of these ten codes were already members of the
 * central `InfrastructureErrorCode` union (`validation_error`,
 * `resource_not_found`, `resource_conflict`, `version_conflict`,
 * `idempotency_conflict`, `permission_denied`) — reused verbatim.
 *
 * The remaining FOUR — `employee_inactive`, `duplicate_clock_in`,
 * `invalid_clock_out`, `payroll_period_closed` — are genuinely new
 * semantic concepts this domain introduces, added to
 * `infrastructureErrorCodes` (TASK 14.4 Wave 2 integration pass).
 */
const peopleErrorStatus: Readonly<Record<string, number>> = {
  validation_error: 400,
  resource_not_found: 404,
  resource_conflict: 409,
  version_conflict: 409,
  idempotency_conflict: 409,
  permission_denied: 403,
  employee_inactive: 409,
  duplicate_clock_in: 409,
  invalid_clock_out: 409,
  payroll_period_closed: 409,
};

export function mapPeopleError(error: unknown): Error {
  if (!(error instanceof PeopleError)) return error instanceof Error ? error : new Error('Unknown error');
  const statusCode = peopleErrorStatus[error.code] ?? 409;
  return new AppError({
    code: error.code,
    message: error.message,
    statusCode,
    ...(error.details === undefined ? {} : { details: error.details }),
  });
}

export async function withPeopleErrors<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    throw mapPeopleError(error);
  }
}
