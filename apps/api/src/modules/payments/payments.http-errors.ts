import { AppError } from '@asone/errors';

import { CashError } from '../cash/cash.types.js';
import { SaleInventoryPostingError } from '../inventory/sale-consumption.js';
import { PaymentError } from './payments.types.js';

// TASK 12.7 gap fixed while building TASK 12.8's own cross-module refund
// error handling (the identical shape) — `createCashPayment` has thrown
// `CashError` (`resolveOpenCashSession`) since TASK 12.7, but nothing in
// this module's own error mapper ever recognized it: a real
// `cash_session_required` rejection fell through to the generic 500
// `internal_error` handler instead of the correct 409, because
// `apps/api/src/plugins/error-handler.ts` only ever recognizes
// `instanceof AppError`. Mirrors `cash.http-errors.ts`'s own
// `statusCodeByCode` table exactly — not a second, possibly-drifting
// copy of the policy, just the same four codes this module can actually
// throw.
const cashErrorStatus: Readonly<Record<string, number>> = {
  resource_not_found: 404,
  validation_error: 400,
  cash_session_required: 409,
  cash_session_already_open: 409,
  cash_session_not_open: 409,
  cash_session_closed: 409,
};

// TASK 12.6: `createCashPayment` (and the card-terminal approval path)
// calls `SalesRepository.trySettleSale`, which can now throw this — a
// stock conflict or a missing branch inventory location discovered while
// posting the sale's own inventory consumption, inside the *same*
// transaction as the payment capture itself (see `sale-consumption.ts`'s
// own doc comment for why that's a deliberate trade-off). Mapped here,
// not left to fall through to the generic 500 handler, so the safe AS
// error code/status at least distinguishes "insufficient stock" (a real,
// nameable business conflict) from an unexpected internal failure.
const inventoryPostingStatus: Readonly<Record<string, number>> = {
  insufficient_inventory: 409,
  inventory_location_not_found: 500,
};

export function mapPaymentError(error: unknown): Error {
  if (error instanceof SaleInventoryPostingError)
    return new AppError({
      code: error.code,
      message: error.message,
      statusCode: inventoryPostingStatus[error.code] ?? 500,
    });
  if (error instanceof CashError) {
    const statusCode = cashErrorStatus[error.code] ?? 409;
    if (statusCode === 404)
      return new AppError({ code: 'not_found', message: 'The resource was not found.', statusCode: 404 });
    return new AppError({ code: error.code, message: error.message, statusCode });
  }
  if (!(error instanceof PaymentError))
    return error instanceof Error ? error : new Error('Unknown error');
  if (error.code === 'resource_not_found')
    return new AppError({
      code: 'not_found',
      message: 'The resource was not found.',
      statusCode: 404,
    });
  return new AppError({
    code: error.code,
    message: error.message,
    statusCode: error.code === 'validation_error' ? 400 : 409,
  });
}

export async function withPaymentErrors<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    throw mapPaymentError(error);
  }
}
