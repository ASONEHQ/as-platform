export const reconciliationDetectorVersion = 'inventory-v1';

export type ReconciliationFindingType =
  | 'balance_on_hand_drift'
  | 'balance_reserved_drift'
  | 'balance_in_transit_drift'
  | 'last_movement_mismatch'
  | 'missing_balance'
  | 'orphan_balance'
  | 'invalid_posted_movement'
  | 'invalid_reversal_relationship'
  | 'transfer_movement_mismatch'
  | 'reservation_movement_mismatch'
  | 'count_application_mismatch';

export type ReconciliationSeverity = 'info' | 'warning' | 'critical';

export interface ReconciliationScope {
  readonly branchId?: string;
  readonly inventoryLocationId?: string;
  readonly productVariantId?: string;
  readonly aggregateType?: string;
  readonly aggregateId?: string;
}

export interface ReconciliationCandidate {
  readonly sortKey: string;
  readonly findingType: ReconciliationFindingType;
  readonly severity: ReconciliationSeverity;
  readonly branchId: string | null;
  readonly inventoryLocationId: string | null;
  readonly productVariantId: string | null;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly expectedSummary: Readonly<Record<string, unknown>>;
  readonly actualSummary: Readonly<Record<string, unknown>>;
  readonly evidence: Readonly<Record<string, unknown>>;
}

export interface ReconciliationFindingEvidence extends ReconciliationCandidate {
  readonly identityKey: string;
  readonly fingerprintSha256: string;
}

export interface ReconciliationScanInput {
  readonly companyId: string;
  readonly scope?: ReconciliationScope;
  readonly chunkSize?: number;
  readonly correlationId?: string;
  readonly resolutionActorId?: string;
}

export interface ReconciliationScanResult {
  readonly scanId: string;
  readonly correlationId: string;
  readonly companyId: string;
  readonly scope: ReconciliationScope;
  readonly snapshotAt: Date;
  readonly detectorVersion: string;
  readonly checkedCount: number;
  readonly findingsCreated: number;
  readonly findingsUpdated: number;
  readonly findingsResolved: number;
  readonly findingsUnchanged: number;
  readonly warnings: readonly string[];
  readonly completedAt: Date;
  readonly complete: boolean;
}

export interface FindingPersistenceResult {
  readonly created: boolean;
  readonly changed: boolean;
}
