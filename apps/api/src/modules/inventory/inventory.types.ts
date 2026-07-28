export type LocationStatus = 'active' | 'inactive' | 'retired';
export type LocationType =
  | 'main'
  | 'sales_floor'
  | 'cafeteria'
  | 'event_storage'
  | 'damaged'
  | 'returns'
  | 'transit'
  | 'virtual';

export interface InventoryLocation {
  id: string;
  companyId: string;
  branchId: string;
  code: string;
  normalizedCode: string;
  name: string;
  description: string | null;
  locationType: LocationType;
  status: LocationStatus;
  allowsReceiving: boolean;
  allowsIssuing: boolean;
  isDefault: boolean;
  version: bigint;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface InventoryPage<T> {
  items: readonly T[];
  nextCursor: string | null;
}

export interface InventoryMutationContext {
  companyId: string;
  actorId: string;
  requestId: string;
  correlationId: string;
  timestamp: Date;
}

export class InventoryApplicationError extends Error {
  public constructor(
    public readonly code:
      | 'branch_not_found'
      | 'idempotency_conflict'
      | 'inventory_location_inactive'
      | 'inventory_location_not_found'
      | 'resource_conflict'
      | 'version_conflict',
    message: string,
    public readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'InventoryApplicationError';
  }
}
