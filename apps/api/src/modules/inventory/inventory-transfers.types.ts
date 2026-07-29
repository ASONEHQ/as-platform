export type InventoryTransferStatus =
  'requested' | 'approved' | 'shipped' | 'received' | 'rejected' | 'cancelled';

export interface InventoryTransferLine {
  id: string;
  lineNumber: number;
  productVariantId: string;
  requestedQuantity: string;
  shippedQuantity: string;
  receivedQuantity: string;
  rejectedQuantity: string;
  unitOfMeasureCode: string;
  notes: string | null;
}

export interface InventoryTransfer {
  id: string;
  companyId: string;
  transferNumber: string;
  status: InventoryTransferStatus;
  sourceBranchId: string;
  destinationBranchId: string;
  sourceLocationId: string;
  destinationLocationId: string;
  transitLocationId: string;
  requestedAt: Date;
  approvedAt: Date | null;
  shippedAt: Date | null;
  receivedAt: Date | null;
  rejectedAt: Date | null;
  cancelledAt: Date | null;
  requestedBy: string;
  approvedBy: string | null;
  shippedBy: string | null;
  receivedBy: string | null;
  rejectedBy: string | null;
  cancelledBy: string | null;
  shipmentMovementId: string | null;
  receiptMovementId: string | null;
  notes: string | null;
  version: bigint;
  createdAt: Date;
  updatedAt: Date;
  lines: readonly InventoryTransferLine[];
}

export class InventoryTransferError extends Error {
  public constructor(
    public readonly code:
      | 'idempotency_conflict'
      | 'insufficient_inventory'
      | 'inventory_balance_not_found'
      | 'invalid_movement_line'
      | 'numeric_overflow'
      | 'resource_not_found'
      | 'transfer_invalid_transition'
      | 'transfer_quantity_exceeded'
      | 'validation_error'
      | 'version_conflict',
    message: string,
  ) {
    super(message);
    this.name = 'InventoryTransferError';
  }
}
