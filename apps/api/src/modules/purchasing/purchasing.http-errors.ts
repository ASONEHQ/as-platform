import { AppError } from '@asone/errors';

import { PurchaseInventoryPostingError } from '../inventory/purchase-receipt.js';
import { PurchaseError } from './purchasing.types.js';

// Mirrors `refunds.http-errors.ts`'s own established shape exactly:
// every code below is already a member of `InfrastructureErrorCode`
// (packages/errors) — this domain reuses existing generic codes rather
// than inventing new ones, the same restraint TASK 13.0/13.1 documented
// for their own new domains.
const purchaseErrorStatus: Readonly<Record<string, number>> = {
  validation_error: 400,
  idempotency_conflict: 409,
  resource_not_found: 404,
  product_variant_not_found: 404,
  inventory_location_not_found: 404,
};

export function mapPurchaseError(error: unknown): Error {
  if (error instanceof PurchaseInventoryPostingError)
    return new AppError({ code: error.code, message: error.message, statusCode: 404 });
  if (!(error instanceof PurchaseError)) return error instanceof Error ? error : new Error('Unknown error');
  const statusCode = purchaseErrorStatus[error.code] ?? 409;
  return new AppError({ code: error.code, message: error.message, statusCode });
}

export async function withPurchaseErrors<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    throw mapPurchaseError(error);
  }
}
