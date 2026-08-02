import type { DatabaseClient } from '@asone/database';

import { InventoryReconciliationRepository } from '../modules/inventory/inventory-reconciliation.repository.js';

export interface ShadowRebuildScope {
  readonly companyId: string;
  readonly branchId?: string;
  readonly locationId?: string;
  readonly productVariantId?: string;
  readonly cursor?: string;
  readonly limit: number;
}

export class ShadowRebuildService {
  private readonly reconciliation: Pick<InventoryReconciliationRepository, 'readCandidateChunk'>;
  public constructor(
    database: DatabaseClient,
    reconciliation?: Pick<InventoryReconciliationRepository, 'readCandidateChunk'>,
  ) {
    this.reconciliation = reconciliation ?? new InventoryReconciliationRepository(database);
  }

  public async compare(scope: ShadowRebuildScope): Promise<Readonly<Record<string, unknown>>> {
    const started = performance.now();
    const snapshotAt = new Date();
    const result = await this.reconciliation.readCandidateChunk({
      companyId: scope.companyId,
      scope: {
        ...(scope.branchId === undefined ? {} : { branchId: scope.branchId }),
        ...(scope.locationId === undefined ? {} : { inventoryLocationId: scope.locationId }),
        ...(scope.productVariantId === undefined
          ? {}
          : { productVariantId: scope.productVariantId }),
      },
      snapshotAt,
      cursor: scope.cursor ?? null,
      limit: scope.limit,
    });
    const missing = result.items.filter((item) => item.findingType === 'missing_balance').length;
    return Object.freeze({
      snapshot_at: snapshotAt.toISOString(),
      balances_checked: result.checkedCount,
      matches: 0,
      mismatches: result.items.length - missing,
      missing_balances: missing,
      duration_ms: Math.round(performance.now() - started),
      complete: result.nextCursor === null,
      next_cursor: result.nextCursor,
      findings: result.items,
    });
  }
}
