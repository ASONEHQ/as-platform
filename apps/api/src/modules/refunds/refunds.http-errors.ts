import { AppError } from '@asone/errors';

import { CashError } from '../cash/cash.types.js';
import { SaleInventoryReturnError } from '../inventory/sale-return.js';
import { PaymentError } from '../payments/payments.types.js';
import { RefundError } from './refunds.types.js';

// Mirrors `cash.http-errors.ts`'s own table exactly — `completeRefund`
// can throw any of these four via `resolveOpenCashSession`.
const cashErrorStatus: Readonly<Record<string, number>> = {
  resource_not_found: 404,
  validation_error: 400,
  cash_session_required: 409,
  cash_session_already_open: 409,
  cash_session_not_open: 409,
  cash_session_closed: 409,
};

const refundErrorStatus: Readonly<Record<string, number>> = {
  validation_error: 400,
  idempotency_conflict: 409,
  resource_not_found: 404,
  resource_conflict: 409,
  version_conflict: 409,
  sale_not_mutable: 409,
  sale_not_refundable: 409,
  refund_limit_exceeded: 409,
  refund_approval_required: 409,
  payment_not_reversible: 409,
  insufficient_inventory: 409,
  inventory_location_not_found: 500,
};

export function mapRefundError(error: unknown): Error {
  if (error instanceof SaleInventoryReturnError)
    return new AppError({ code: 'inventory_location_not_found', message: error.message, statusCode: 500 });
  if (error instanceof CashError) {
    const statusCode = cashErrorStatus[error.code] ?? 409;
    if (statusCode === 404)
      return new AppError({ code: 'not_found', message: 'The resource was not found.', statusCode: 404 });
    return new AppError({ code: error.code, message: error.message, statusCode });
  }
  if (error instanceof PaymentError)
    return new AppError({
      code: error.code,
      message: error.message,
      statusCode: error.code === 'resource_not_found' ? 404 : error.code === 'validation_error' ? 400 : 409,
    });
  if (!(error instanceof RefundError)) return error instanceof Error ? error : new Error('Unknown error');
  const statusCode = refundErrorStatus[error.code] ?? 409;
  if (statusCode === 404)
    return new AppError({ code: 'not_found', message: 'The resource was not found.', statusCode: 404 });
  return new AppError({ code: error.code, message: error.message, statusCode });
}

export async function withRefundErrors<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    throw mapRefundError(error);
  }
}
