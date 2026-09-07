import { AppError } from '@asone/errors';

import { SaleInventoryPostingError } from '../inventory/sale-consumption.js';
import { mapRewardError } from '../rewards/rewards.http-errors.js';
import { RewardError } from '../rewards/rewards.types.js';
import { SaleError } from './sales.types.js';

const statusCodeByCode: Readonly<Record<string, number>> = {
  resource_not_found: 404,
  validation_error: 400,
  product_not_found: 400,
  product_not_active: 400,
  price_not_found: 400,
  currency_mismatch: 400,
  idempotency_conflict: 409,
  version_conflict: 409,
  invalid_sale_state: 409,
};

// TASK 12.6: defensive mirror of the same mapping in
// `payments.http-errors.ts` — `SalesRepository.trySettleSale` (which can
// throw this) is only ever invoked today via `PaymentService`, but it is
// a `SalesRepository` method, so any future direct sales-route caller is
// covered too rather than falling through to a generic 500.
const inventoryPostingStatus: Readonly<Record<string, number>> = {
  insufficient_inventory: 409,
  inventory_location_not_found: 500,
};

export function mapSaleError(error: unknown): Error {
  // TASK 13.2 — `createSale` now optionally resolves a reward benefit via
  // `RewardsService.resolveCheckoutBenefit`, which throws its OWN
  // `RewardError` codes — checked first so those specific reasons reach
  // the caller, mirroring `SaleInventoryPostingError`'s own established
  // "chain multiple error families through one mapper" shape.
  if (error instanceof RewardError) return mapRewardError(error);
  if (error instanceof SaleInventoryPostingError)
    return new AppError({
      code: error.code,
      message: error.message,
      statusCode: inventoryPostingStatus[error.code] ?? 500,
    });
  if (!(error instanceof SaleError)) return error instanceof Error ? error : new Error('Unknown error');
  const statusCode = statusCodeByCode[error.code] ?? 409;
  if (statusCode === 404)
    return new AppError({ code: 'not_found', message: 'The resource was not found.', statusCode: 404 });
  return new AppError({ code: error.code, message: error.message, statusCode });
}

export async function withSaleErrors<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    throw mapSaleError(error);
  }
}
