export type DraftMovementType = 'opening_balance' | 'adjustment';

export interface DraftMovement {
  id: string;
  companyId: string;
  branchId: string;
  movementNumber: string;
  movementType: DraftMovementType;
  status: string;
  reasonCode: string | null;
  referenceType: string | null;
  referenceId: string | null;
  sourceDocumentNumber: string | null;
  notes: string | null;
  version: bigint;
  occurredAt: Date;
  postedAt: Date | null;
  cancelledAt: Date | null;
  reversedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lineCount: number;
}

export interface DraftMovementLine {
  id: string;
  movementId: string;
  lineNumber: number;
  productVariantId: string;
  sourceLocationId: string | null;
  destinationLocationId: string | null;
  quantity: string;
  baseQuantity: string;
  unitOfMeasureCode: string;
  unitCost: string | null;
  extendedCost: string | null;
  currencyCode: string | null;
  reasonCode: string | null;
  metadata: Readonly<Record<string, unknown>> | null;
  createdAt: Date;
}

export class InventoryDraftError extends Error {
  public constructor(
    public readonly code:
      | 'branch_not_found'
      | 'duplicate_movement_line'
      | 'idempotency_conflict'
      | 'invalid_inventory_location'
      | 'invalid_movement_direction'
      | 'invalid_movement_state'
      | 'invalid_movement_type'
      | 'inventory_movement_line_not_found'
      | 'inventory_movement_not_found'
      | 'movement_already_cancelled'
      | 'movement_already_posted'
      | 'movement_already_reversed'
      | 'product_variant_not_found'
      | 'unit_of_measure_not_found'
      | 'version_conflict',
    message: string,
  ) {
    super(message);
    this.name = 'InventoryDraftError';
  }
}
