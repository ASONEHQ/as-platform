import { describe, expect, it, vi } from 'vitest';

import { evidenceFingerprint } from './inventory-reconciliation.service.js';
import type { ReconciliationCandidate } from './inventory-reconciliation.types.js';
import type { InventoryRepairRepository } from './inventory-repair.repository.js';
import { InventoryRepairService } from './inventory-repair.service.js';
import type { RepairFinding, RepairStrategy } from './inventory-repair.types.js';

const companyId = '00000000-0000-4000-8000-000000000001';
const branchId = '00000000-0000-4000-8000-000000000002';
const findingId = '00000000-0000-7000-8000-000000000003';
const balanceId = '00000000-0000-7000-8000-000000000004';
const locationId = '00000000-0000-7000-8000-000000000005';
const variantId = '00000000-0000-7000-8000-000000000006';
const movementId = '00000000-0000-7000-8000-000000000007';
const now = new Date('2026-08-01T12:00:00.000Z');

const cases: readonly [
  RepairFinding['findingType'],
  RepairStrategy,
  Readonly<Record<string, unknown>>,
][] = [
  ['balance_on_hand_drift', 'rebuild_on_hand_projection', { quantity: '5.000001' }],
  ['balance_reserved_drift', 'rebuild_reserved_projection', { quantity: '1.000001' }],
  ['balance_in_transit_drift', 'rebuild_in_transit_projection', { quantity: '2.000001' }],
  ['last_movement_mismatch', 'restore_last_movement', { movementId }],
  [
    'missing_balance',
    'create_missing_balance',
    {
      quantityOnHand: '5.000001',
      quantityReserved: '1.000001',
      quantityInTransit: '2.000001',
      lastMovementId: movementId,
    },
  ],
];

function candidate(
  type: string,
  expected: Readonly<Record<string, unknown>>,
): ReconciliationCandidate {
  return {
    sortKey: type,
    findingType: type as ReconciliationCandidate['findingType'],
    severity: 'critical',
    branchId,
    inventoryLocationId: locationId,
    productVariantId: variantId,
    aggregateType: 'inventory_balance',
    aggregateId: type === 'missing_balance' ? `${locationId}:${variantId}` : balanceId,
    expectedSummary: expected,
    actualSummary: { quantity: '0.000000' },
    evidence:
      type === 'missing_balance' ? { balanceKey: `${locationId}:${variantId}` } : { balanceId },
  };
}
function finding(
  item: ReconciliationCandidate,
  status: RepairFinding['status'] = 'open',
): RepairFinding {
  return {
    id: findingId,
    companyId,
    branchId,
    inventoryLocationId: locationId,
    productVariantId: variantId,
    aggregateType: item.aggregateType,
    aggregateId: item.aggregateId,
    findingType: item.findingType,
    severity: item.severity,
    status,
    fingerprint: evidenceFingerprint(item),
    detectorVersion: 'v1',
    snapshotAt: now,
    firstDetectedAt: now,
    lastDetectedAt: now,
    occurrenceCount: 1n,
    expectedSummary: item.expectedSummary,
    actualSummary: item.actualSummary,
    evidence: item.evidence,
    acknowledgedAt: null,
    acknowledgedBy: null,
    resolvedAt: null,
    resolvedBy: null,
    dismissedAt: null,
    dismissedBy: null,
    resolutionReasonCode: null,
    resolutionNote: null,
    version: 1n,
  };
}
function fixture(
  item: ReconciliationCandidate,
  status: RepairFinding['status'] = 'open',
): {
  value: RepairFinding;
  repository: Record<string, ReturnType<typeof vi.fn>>;
  service: InventoryRepairService;
} {
  const value = finding(item, status);
  const resolved = { ...value, status: 'resolved' as const, version: 2n, resolvedAt: now };
  const repository = {
    transaction: vi.fn(async (callback: (client: object) => Promise<unknown>) => callback({})),
    lock: vi.fn(() => Promise.resolve(value)),
    candidates: vi.fn(() => Promise.resolve([item])),
    lockBalance: vi.fn(() =>
      Promise.resolve(
        item.findingType === 'missing_balance'
          ? null
          : {
              id: balanceId,
              quantity_on_hand: '4.000001',
              quantity_reserved: '0.000000',
              quantity_in_transit: '0.000000',
              average_unit_cost: '12.3400',
              currency_code: 'MXN',
              last_movement_id: null,
              version: '7',
            },
      ),
    ),
    updateBalance: vi.fn(() => Promise.resolve({ id: balanceId, version: 8n })),
    createBalance: vi.fn(() => Promise.resolve({ id: balanceId, version: 1n })),
    transition: vi.fn(() => Promise.resolve(resolved)),
    audit: vi.fn(() => Promise.resolve()),
    outbox: vi.fn(() => Promise.resolve()),
    idempotent: vi.fn(
      async (
        _client,
        _context,
        _operation,
        _finding,
        _key,
        _hash,
        execute: () => Promise<Readonly<Record<string, unknown>>>,
      ) => ({ value: await execute(), replayed: false }),
    ),
  };
  return {
    value,
    repository,
    service: new InventoryRepairService(repository as unknown as InventoryRepairRepository),
  };
}

describe('inventory reconciliation repair service', () => {
  it.each(cases)(
    'previews and applies %s with exact approved strategy',
    async (_type, strategy, expected) => {
      const item = candidate(_type, expected);
      const { value, repository, service } = fixture(item);
      const preview = await service.preview(
        companyId,
        [branchId],
        findingId,
        1n,
        value.fingerprint,
        strategy,
        now,
      );
      expect(preview).toMatchObject({ strategy, repairable: true, movement: null });
      const applied = await service.repair(
        {
          companyId,
          actorId: companyId,
          requestId: 'request',
          correlationId: 'correlation',
          timestamp: now,
        },
        [branchId],
        findingId,
        1n,
        'key',
        {
          strategy,
          expectedFingerprint: value.fingerprint,
          previewFingerprint: preview.fingerprint,
          previewExpiresAt: preview.expiresAt,
          reasonCode: 'repair',
          note: null,
        },
      );
      expect(applied.value).toMatchObject({
        new_status: 'resolved',
        strategy,
        movement_id: null,
        version: 2,
      });
      expect(repository.transition).toHaveBeenCalledTimes(1);
      expect(repository.audit).toHaveBeenCalledTimes(2);
      expect(repository.outbox).toHaveBeenCalledTimes(strategy === 'restore_last_movement' ? 0 : 1);
    },
  );

  it('rejects stale, expired, wrong-strategy and terminal repairs before mutation', async () => {
    const primary = required(cases[0]);
    const item = candidate(primary[0], primary[2]);
    const current = fixture(item);
    await expect(
      current.service.preview(companyId, [branchId], findingId, 1n, '0'.repeat(64), primary[1]),
    ).rejects.toMatchObject({ code: 'reconciliation_finding_stale' });
    await expect(
      current.service.preview(
        companyId,
        [branchId],
        findingId,
        1n,
        current.value.fingerprint,
        'restore_last_movement',
      ),
    ).rejects.toMatchObject({ code: 'reconciliation_repair_not_allowed' });
    const preview = await current.service.preview(
      companyId,
      [branchId],
      findingId,
      1n,
      current.value.fingerprint,
      primary[1],
      now,
    );
    await expect(
      current.service.repair(
        {
          companyId,
          actorId: companyId,
          requestId: 'r',
          correlationId: 'c',
          timestamp: preview.expiresAt,
        },
        [branchId],
        findingId,
        1n,
        'expired',
        {
          strategy: primary[1],
          expectedFingerprint: current.value.fingerprint,
          previewFingerprint: preview.fingerprint,
          previewExpiresAt: preview.expiresAt,
          reasonCode: 'x',
          note: null,
        },
      ),
    ).rejects.toMatchObject({ code: 'reconciliation_preview_expired' });
    const terminal = fixture(item, 'resolved');
    await expect(
      terminal.service.preview(
        companyId,
        [branchId],
        findingId,
        1n,
        terminal.value.fingerprint,
        primary[1],
      ),
    ).rejects.toMatchObject({ code: 'reconciliation_finding_already_resolved' });
  });
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Required test fixture is missing.');
  return value;
}
