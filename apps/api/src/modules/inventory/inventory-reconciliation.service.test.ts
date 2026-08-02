import { describe, expect, it, vi } from 'vitest';

import type { InventoryReconciliationRepository } from './inventory-reconciliation.repository.js';
import {
  canonicalJson,
  evidenceFingerprint,
  exactQuantity,
  findingIdentity,
  inTransitRemaining,
  InventoryReconciliationService,
  parseExactQuantity,
  reservedRemaining,
} from './inventory-reconciliation.service.js';
import type { ReconciliationCandidate } from './inventory-reconciliation.types.js';

const candidate: ReconciliationCandidate = {
  sortKey: 'balance_on_hand_drift|inventory_balance|1',
  findingType: 'balance_on_hand_drift',
  severity: 'critical',
  branchId: 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA',
  inventoryLocationId: null,
  productVariantId: 'BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB',
  aggregateType: 'Inventory_Balance',
  aggregateId: 'CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC',
  expectedSummary: { quantity: '2.000000' },
  actualSummary: { quantity: '1.000000' },
  evidence: { nested: { z: 2, a: 1 } },
};

describe('inventory reconciliation detector service', () => {
  it('canonicalizes object keys recursively without changing arrays', () => {
    expect(canonicalJson({ z: 1, a: { y: 2, b: 3 }, list: [2, 1] })).toBe(
      '{"a":{"b":3,"y":2},"list":[2,1],"z":1}',
    );
  });

  it('builds a stable normalized identity with explicit null markers', () => {
    expect(findingIdentity('DDDDDDDD-DDDD-DDDD-DDDD-DDDDDDDDDDDD', candidate)).toBe(
      'dddddddd-dddd-dddd-dddd-dddddddddddd|balance_on_hand_drift|inventory_balance|cccccccc-cccc-cccc-cccc-cccccccccccc|aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa|null|bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb|inventory-v1',
    );
  });

  it('fingerprints relevant evidence independently of key order', () => {
    const first = evidenceFingerprint(candidate);
    const second = evidenceFingerprint({
      ...candidate,
      evidence: { nested: { a: 1, z: 2 } },
    });
    expect(first).toMatch(/^[0-9a-f]{64}$/u);
    expect(second).toBe(first);
  });

  it('uses exact six-place arithmetic without Number or rounding', () => {
    expect(parseExactQuantity('9999999999999.999999')).toBe(9_999_999_999_999_999_999n);
    expect(exactQuantity(-1n)).toBe('-0.000001');
    expect(reservedRemaining('10.000001', '2.000000', '3.000001')).toBe('5.000000');
    expect(inTransitRemaining('7.100000', '2.000001')).toBe('5.099999');
  });

  it('rejects quantities outside the exact canonical grammar', () => {
    expect(() => parseExactQuantity('1.0000001')).toThrow('Invalid exact inventory quantity.');
    expect(() => parseExactQuantity('1e2')).toThrow('Invalid exact inventory quantity.');
  });

  it('chunks candidates, persists recurrence, and resolves only after completion', async () => {
    const readCandidateChunk = vi
      .fn()
      .mockResolvedValueOnce({ items: [candidate], nextCursor: candidate.sortKey, checkedCount: 1 })
      .mockResolvedValueOnce({
        items: [{ ...candidate, sortKey: 'z', aggregateId: 'z' }],
        nextCursor: null,
        checkedCount: 1,
      });
    const persistFinding = vi
      .fn()
      .mockResolvedValueOnce({ created: true, changed: false })
      .mockResolvedValueOnce({ created: false, changed: true });
    const resolveMissing = vi.fn().mockResolvedValue(2);
    const repository = {
      readCandidateChunk,
      persistFinding,
      resolveMissing,
    } as Pick<
      InventoryReconciliationRepository,
      'readCandidateChunk' | 'persistFinding' | 'resolveMissing'
    >;
    const result = await new InventoryReconciliationService(repository).scan({
      companyId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      chunkSize: 1,
      resolutionActorId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    });

    expect(readCandidateChunk).toHaveBeenCalledTimes(2);
    expect(persistFinding).toHaveBeenCalledTimes(2);
    expect(resolveMissing).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      checkedCount: 2,
      findingsCreated: 1,
      findingsUpdated: 1,
      findingsResolved: 2,
      complete: true,
    });
  });

  it('does not auto-resolve without an approved membership actor', async () => {
    const resolveMissing = vi.fn();
    const repository = {
      readCandidateChunk: vi
        .fn()
        .mockResolvedValue({ items: [], nextCursor: null, checkedCount: 0 }),
      persistFinding: vi.fn(),
      resolveMissing,
    } as Pick<
      InventoryReconciliationRepository,
      'readCandidateChunk' | 'persistFinding' | 'resolveMissing'
    >;
    const result = await new InventoryReconciliationService(repository).scan({ companyId: 'c' });
    expect(resolveMissing).not.toHaveBeenCalled();
    expect(result.warnings).toContain(
      'auto_resolution_requires_an_authorized_company_membership_actor',
    );
  });
});
