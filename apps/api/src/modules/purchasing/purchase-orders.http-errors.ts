import { AppError } from '@asone/errors';

import { PurchaseOrderInventoryPostingError } from '../inventory/purchase-order-receipt.js';
import { PurchaseOrderError } from './purchase-orders.types.js';

// Mirrors `purchasing.http-errors.ts`'s own established shape exactly.
const purchaseOrderErrorStatus: Readonly<Record<string, number>> = {
  validation_error: 400,
  idempotency_conflict: 409,
  resource_not_found: 404,
  purchase_order_not_found: 404,
  purchase_order_supplier_not_found: 404,
  purchase_order_supplier_inactive: 409,
  purchase_order_product_variant_not_found: 404,
  purchase_order_non_tracked_variant: 404,
  purchase_order_inventory_location_not_found: 404,
  purchase_order_duplicate_variant: 400,
  purchase_order_empty_lines: 400,
  purchase_order_over_receipt: 400,
  purchase_order_empty_receipt: 400,
  purchase_order_invalid_transition: 409,
};

export function mapPurchaseOrderError(error: unknown): Error {
  if (error instanceof PurchaseOrderInventoryPostingError)
    return new AppError({
      code:
        error.code === 'inventory_location_not_found'
          ? 'purchase_order_inventory_location_not_found'
          : 'purchase_order_product_variant_not_found',
      message: error.message,
      statusCode: 404,
    });
  if (!(error instanceof PurchaseOrderError)) return error instanceof Error ? error : new Error('Unknown error');
  const statusCode = purchaseOrderErrorStatus[error.code] ?? 409;
  return new AppError({ code: error.code, message: error.message, statusCode });
}

export async function withPurchaseOrderErrors<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    throw mapPurchaseOrderError(error);
  }
}
