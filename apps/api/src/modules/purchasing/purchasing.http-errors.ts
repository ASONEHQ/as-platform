import { AppError } from '@asone/errors';

import { InventoryDraftError } from '../inventory/inventory-drafts.types.js';
import { PurchaseInventoryPostingError } from '../inventory/purchase-receipt.js';
import { PurchaseError } from './purchasing.types.js';

// Mirrors `refunds.http-errors.ts`'s own established shape exactly:
// every code below is a member of `InfrastructureErrorCode`
// (packages/errors) — this domain reuses existing generic codes rather
// than inventing new ones, the same restraint TASK 13.0/13.1 documented
// for their own new domains. The one exception is `supplier_inactive`
// (TASK 14.4, Wave 2, Part C.2), added to `infrastructureErrorCodes`
// alongside this module's own `PurchaseErrorCode`.
const purchaseErrorStatus: Readonly<Record<string, number>> = {
  validation_error: 400,
  idempotency_conflict: 409,
  resource_not_found: 404,
  product_variant_not_found: 404,
  inventory_location_not_found: 404,
  supplier_inactive: 409,
};

export function mapPurchaseError(error: unknown): Error {
  if (error instanceof PurchaseInventoryPostingError)
    return new AppError({ code: error.code, message: error.message, statusCode: 404 });
  // TASK 12.2 — `POST /api/v1/direct-purchases/:id/reverse` reuses
  // `InventoryReversalService.reverse` directly (see `purchasing.
  // service.ts`'s own `reverseDirectPurchase`), so its own
  // `InventoryDraftError` needs mapping here too — same status-code
  // logic `inventory-reversal.routes.ts`'s own `errorsToHttp` already
  // uses (404 for "not found", 422 for the two structurally-invalid
  // codes, 409 for everything else, e.g. `movement_already_reversed`).
  if (error instanceof InventoryDraftError) {
    const statusCode = error.code === 'inventory_movement_not_found' ? 404 : 409;
    const unprocessable = ['invalid_movement_line', 'numeric_overflow'].includes(error.code);
    return new AppError({ code: error.code, message: error.message, statusCode: unprocessable ? 422 : statusCode });
  }
  if (!(error instanceof PurchaseError)) return error instanceof Error ? error : new Error('Unknown error');
  const statusCode = purchaseErrorStatus[error.code] ?? 409;
  // TASK 14.4 (Wave 2, Part C.2) — `supplier_inactive` was added to the
  // central `InfrastructureErrorCode` union alongside this module's own
  // `PurchaseErrorCode`, so no cast is needed here.
  return new AppError({ code: error.code, message: error.message, statusCode });
}

export async function withPurchaseErrors<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    throw mapPurchaseError(error);
  }
}
