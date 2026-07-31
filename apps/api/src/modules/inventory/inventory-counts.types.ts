export type InventoryCountStatus =
  'draft' | 'counting' | 'submitted' | 'approved' | 'applied' | 'cancelled';

export type InventoryCountScopeType = 'all_balanced_variants' | 'explicit_variants';

export interface InventoryCountLine {
  id: string;
  productVariantId: string;
  unitOfMeasureCode: string;
  expectedQuantity: string;
  countedQuantity: string | null;
  baselineBalanceVersion: bigint;
  baselineLastMovementId: string | null;
  firstCountedAt: Date | null;
  lastCountedAt: Date | null;
  countedBy: string | null;
  version: bigint;
  metadata: Readonly<Record<string, unknown>> | null;
}

export interface InventoryCount {
  id: string;
  companyId: string;
  branchId: string;
  locationId: string;
  countNumber: string;
  status: InventoryCountStatus;
  scopeType: InventoryCountScopeType;
  scopeDefinition: Readonly<Record<string, unknown>>;
  baselineAt: Date | null;
  lockAcquiredAt: Date | null;
  lockExpiresAt: Date | null;
  startedAt: Date | null;
  startedBy: string | null;
  submittedAt: Date | null;
  submittedBy: string | null;
  approvedAt: Date | null;
  approvedBy: string | null;
  appliedAt: Date | null;
  appliedBy: string | null;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  applicationMovementId: string | null;
  reasonCode: string;
  note: string | null;
  metadata: Readonly<Record<string, unknown>> | null;
  version: bigint;
  createdAt: Date;
  updatedAt: Date;
  lines: readonly InventoryCountLine[];
}

export type InventoryCountErrorCode =
  | 'count_already_applied'
  | 'count_has_incomplete_lines'
  | 'count_lock_expired'
  | 'count_not_applicable'
  | 'count_not_approvable'
  | 'count_not_editable'
  | 'idempotency_conflict'
  | 'insufficient_inventory'
  | 'inventory_count_in_progress'
  | 'inventory_reconciliation_required'
  | 'numeric_overflow'
  | 'resource_not_found'
  | 'validation_error'
  | 'version_conflict';

export class InventoryCountError extends Error {
  public constructor(
    public readonly code: InventoryCountErrorCode,
    message: string,
    public readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'InventoryCountError';
  }
}
