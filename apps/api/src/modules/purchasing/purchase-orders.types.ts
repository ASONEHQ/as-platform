/**
 * TASK 12.2 — the formal Purchase Order workflow, the sibling of
 * `purchasing.types.ts` (TASK 14.3's "Compra Directa"). See
 * `packages/database/src/schema/purchasing.ts`'s own doc comment on
 * `purchaseOrders` for the full lifecycle rationale (draft → submitted →
 * partially_received/received, or cancelled from any of the first
 * three; deliberately only ONE receiving event per PO).
 */

export interface PurchaseOrderLineRow {
  id: string;
  lineNumber: number;
  productVariantId: string;
  /** Frozen at line-creation time from the catalog's product/variant
   * identity — never re-derived live on read. See
   * `packages/database/src/schema/purchasing.ts`'s own doc comment on
   * `purchaseOrderLines` for why (a PO line must stay legible even after
   * the product is renamed/deactivated). */
  productNameSnapshot: string;
  variantNameSnapshot: string | null;
  skuSnapshot: string | null;
  orderedQuantity: string;
  receivedQuantity: string;
  unitCost: string;
  lineTotal: string;
  notes: string | null;
}

export interface PurchaseOrderRow {
  id: string;
  companyId: string;
  branchId: string;
  orderNumber: string;
  status: string;
  supplierName: string | null;
  supplierId: string | null;
  orderDate: string;
  expectedDate: string | null;
  currencyCode: string;
  totalCost: string;
  notes: string | null;
  submittedAt: Date | null;
  submittedBy: string | null;
  receivedAt: Date | null;
  receivedBy: string | null;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  receiptMovementId: string | null;
  version: bigint;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  lines: readonly PurchaseOrderLineRow[];
}

/** Light row for the list endpoint — no `lines` array (see this module's
 * own routes doc comment: "keep it light — line_count and total_cost are
 * enough"). */
export interface PurchaseOrderListRow {
  id: string;
  branchId: string;
  orderNumber: string;
  status: string;
  supplierName: string | null;
  supplierId: string | null;
  orderDate: string;
  expectedDate: string | null;
  currencyCode: string;
  totalCost: string;
  lineCount: number;
  createdAt: Date;
}

export interface CreatePurchaseOrderLineInput {
  productVariantId: string;
  orderedQuantity: string;
  unitCost: string;
  notes?: string | null;
}

export interface CreatePurchaseOrderInput {
  id?: string;
  branchId: string;
  supplierName?: string | null;
  supplierId?: string | null;
  orderDate: string;
  expectedDate?: string | null;
  currencyCode: string;
  notes?: string | null;
  lines: readonly CreatePurchaseOrderLineInput[];
}

export interface PurchaseOrderMutationContext {
  companyId: string;
  actorId: string;
  requestId: string;
  correlationId: string;
  timestamp: Date;
  deviceId?: string | undefined;
}

export interface ReceivePurchaseOrderLineInput {
  purchaseOrderLineId: string;
  receivedQuantity: string;
}

export interface PurchaseOrderMovementLineSummary {
  productVariantId: string;
  currentQuantityOnHand: string | null;
}

export interface PurchaseOrderMovementSummary {
  movementId: string;
  movementNumber: string;
  status: string;
  postedAt: Date | null;
  lines: readonly PurchaseOrderMovementLineSummary[];
}

export type PurchaseOrderErrorCode =
  | 'validation_error'
  | 'idempotency_conflict'
  | 'resource_not_found'
  | 'purchase_order_not_found'
  | 'purchase_order_supplier_not_found'
  | 'purchase_order_supplier_inactive'
  | 'purchase_order_product_variant_not_found'
  | 'purchase_order_non_tracked_variant'
  | 'purchase_order_inventory_location_not_found'
  | 'purchase_order_duplicate_variant'
  | 'purchase_order_empty_lines'
  | 'purchase_order_over_receipt'
  | 'purchase_order_empty_receipt'
  | 'purchase_order_invalid_transition';

export class PurchaseOrderError extends Error {
  constructor(
    readonly code: PurchaseOrderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PurchaseOrderError';
  }
}
