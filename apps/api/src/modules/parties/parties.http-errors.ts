import { AppError } from '@asone/errors';

import { CashError } from '../cash/cash.types.js';
import { PartySockDeductionError } from './party-sock-deduction.js';
import { PartyError } from './parties.types.js';

const partyErrorStatus: Readonly<Record<string, number>> = {
  validation_error: 400,
  idempotency_conflict: 409,
  resource_not_found: 404,
  resource_conflict: 409,
  version_conflict: 409,
  party_conflict: 409,
  invalid_reservation_state: 409,
  insufficient_inventory: 409,
  inventory_location_not_found: 500,
  // TASK 16.19 — both are honest "this request cannot be satisfied as
  // submitted" rejections against real, current state (room/package
  // capacity, package-to-room eligibility), the same class of error
  // `validation_error` already represents elsewhere in this table — 422
  // (Unprocessable Entity), not 409 (a state a retry could resolve) or
  // 400 (malformed input the JSON-schema layer already rejects earlier).
  capacity_exceeded: 422,
  package_room_not_eligible: 422,
};

// Mirrors `cash.http-errors.ts`'s own table exactly — recording a
// deposit/balance payment calls the real `CashService.createMovement`,
// which can throw any of these.
const cashErrorStatus: Readonly<Record<string, number>> = {
  resource_not_found: 404,
  validation_error: 400,
  idempotency_conflict: 409,
  version_conflict: 409,
  cash_session_required: 409,
  cash_session_already_open: 409,
  cash_session_not_open: 409,
  cash_session_closed: 409,
};

export function mapPartyError(error: unknown): Error {
  if (error instanceof PartySockDeductionError)
    return new AppError({
      code: error.code,
      message: error.message,
      statusCode: error.code === 'inventory_location_not_found' ? 500 : 409,
    });
  if (error instanceof CashError) {
    const statusCode = cashErrorStatus[error.code] ?? 409;
    if (statusCode === 404)
      return new AppError({ code: 'not_found', message: 'The resource was not found.', statusCode: 404 });
    return new AppError({ code: error.code, message: error.message, statusCode });
  }
  if (!(error instanceof PartyError)) return error instanceof Error ? error : new Error('Unknown error');
  const statusCode = partyErrorStatus[error.code] ?? 409;
  if (statusCode === 404)
    return new AppError({ code: 'not_found', message: 'The resource was not found.', statusCode: 404 });
  return new AppError({
    code: error.code,
    message: error.message,
    statusCode,
    ...(error.details === undefined ? {} : { details: error.details }),
  });
}

export async function withPartyErrors<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    throw mapPartyError(error);
  }
}
