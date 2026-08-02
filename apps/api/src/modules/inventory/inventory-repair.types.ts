export const repairStrategies = [
  'rebuild_on_hand_projection',
  'rebuild_reserved_projection',
  'rebuild_in_transit_projection',
  'restore_last_movement',
  'create_missing_balance',
] as const;

export type RepairStrategy = (typeof repairStrategies)[number];
export type FindingStatus = 'open' | 'acknowledged' | 'resolved' | 'dismissed';

export interface RepairFinding {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string | null;
  readonly inventoryLocationId: string | null;
  readonly productVariantId: string | null;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly findingType: string;
  readonly severity: string;
  readonly status: FindingStatus;
  readonly fingerprint: string;
  readonly detectorVersion: string;
  readonly snapshotAt: Date;
  readonly firstDetectedAt: Date;
  readonly lastDetectedAt: Date;
  readonly occurrenceCount: bigint;
  readonly expectedSummary: Readonly<Record<string, unknown>>;
  readonly actualSummary: Readonly<Record<string, unknown>>;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly acknowledgedAt: Date | null;
  readonly acknowledgedBy: string | null;
  readonly resolvedAt: Date | null;
  readonly resolvedBy: string | null;
  readonly dismissedAt: Date | null;
  readonly dismissedBy: string | null;
  readonly resolutionReasonCode: string | null;
  readonly resolutionNote: string | null;
  readonly version: bigint;
}

export interface FindingListInput {
  readonly limit: number;
  readonly cursor?: string;
  readonly status?: string;
  readonly severity?: string;
  readonly findingType?: string;
  readonly branchId?: string;
  readonly inventoryLocationId?: string;
  readonly productVariantId?: string;
  readonly aggregateType?: string;
  readonly aggregateId?: string;
  readonly detectedFrom?: Date;
  readonly detectedTo?: Date;
}

export interface FindingPage {
  readonly items: readonly RepairFinding[];
  readonly nextCursor: string | null;
}

export interface RepairCommandContext {
  readonly companyId: string;
  readonly actorId: string;
  readonly requestId: string;
  readonly correlationId: string;
  readonly timestamp: Date;
}

export interface RepairPreview {
  readonly findingId: string;
  readonly repairable: boolean;
  readonly strategy: RepairStrategy;
  readonly expected: Readonly<Record<string, unknown>>;
  readonly actual: Readonly<Record<string, unknown>>;
  readonly proposedMutations: readonly Readonly<Record<string, unknown>>[];
  readonly affectedBalanceIds: readonly string[];
  readonly movement: null;
  readonly expectedEvents: readonly string[];
  readonly warnings: readonly string[];
  readonly snapshotAt: Date;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly fingerprint: string;
}

export type RepairErrorCode =
  | 'idempotency_conflict'
  | 'inventory_balance_conflict'
  | 'reconciliation_finding_already_resolved'
  | 'reconciliation_finding_stale'
  | 'reconciliation_preview_expired'
  | 'reconciliation_repair_not_allowed'
  | 'resource_not_found'
  | 'validation_error'
  | 'version_conflict';

export class InventoryRepairError extends Error {
  public constructor(
    public readonly code: RepairErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'InventoryRepairError';
  }
}
