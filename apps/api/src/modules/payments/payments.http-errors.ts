import { AppError } from '@asone/errors';

import { SaleInventoryPostingError } from '../inventory/sale-consumption.js';
import { PaymentError } from './payments.types.js';

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
