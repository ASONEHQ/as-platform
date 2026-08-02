import { createHash, randomUUID } from 'node:crypto';

import type { InventoryReconciliationRepository } from './inventory-reconciliation.repository.js';
import {
  reconciliationDetectorVersion,
  type ReconciliationCandidate,
  type ReconciliationFindingEvidence,
  type ReconciliationScanInput,
  type ReconciliationScanResult,
  type ReconciliationScope,
} from './inventory-reconciliation.types.js';

const MAX_CHUNK_SIZE = 500;

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value as Readonly<Record<string, unknown>>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

function normalized(value: string | null | undefined): string {
  if (value === undefined || value === null) return 'null';
  const clean = value.trim().toLowerCase();
  return clean.length === 0 ? 'null' : clean;
}

export function findingIdentity(
  companyId: string,
  candidate: ReconciliationCandidate,
  detectorVersion = reconciliationDetectorVersion,
): string {
  return [
    normalized(companyId),
    candidate.findingType,
    normalized(candidate.aggregateType),
    normalized(candidate.aggregateId),
    normalized(candidate.branchId),
    normalized(candidate.inventoryLocationId),
    normalized(candidate.productVariantId),
    normalized(detectorVersion),
  ].join('|');
}

export function evidenceFingerprint(candidate: ReconciliationCandidate): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        actual: candidate.actualSummary,
        evidence: candidate.evidence,
        expected: candidate.expectedSummary,
        findingType: candidate.findingType,
      }),
      'utf8',
    )
    .digest('hex');
}

export function parseExactQuantity(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,6}))?$/u.exec(value);
  if (!match) throw new Error('Invalid exact inventory quantity.');
  const magnitude = BigInt(match[2] ?? '0') * 1_000_000n + BigInt((match[3] ?? '').padEnd(6, '0'));
  return match[1] === '-' ? -magnitude : magnitude;
}

export function exactQuantity(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const magnitude = value < 0n ? -value : value;
  return `${sign}${String(magnitude / 1_000_000n)}.${String(magnitude % 1_000_000n).padStart(6, '0')}`;
}

export function reservedRemaining(reserved: string, consumed: string, released: string): string {
  return exactQuantity(
    parseExactQuantity(reserved) - parseExactQuantity(consumed) - parseExactQuantity(released),
  );
}

export function inTransitRemaining(shipped: string, received: string): string {
  return exactQuantity(parseExactQuantity(shipped) - parseExactQuantity(received));
}

export class InventoryReconciliationService {
  public constructor(
    private readonly repository: Pick<
      InventoryReconciliationRepository,
      'readCandidateChunk' | 'persistFinding' | 'resolveMissing'
    >,
  ) {}

  public async scan(input: ReconciliationScanInput): Promise<ReconciliationScanResult> {
    const scanId = randomUUID();
    const correlationId = input.correlationId ?? scanId;
    const snapshotAt = new Date();
    const scope = normalizeScope(input.scope);
    const chunkSize = Math.min(Math.max(input.chunkSize ?? 100, 1), MAX_CHUNK_SIZE);
    const observed: string[] = [];
    let cursor: string | null = null;
    let checkedCount = 0;
    let findingsCreated = 0;
    let findingsUpdated = 0;
    let findingsUnchanged = 0;

    do {
      const chunk = await this.repository.readCandidateChunk({
        companyId: input.companyId,
        scope,
        snapshotAt,
        cursor,
        limit: chunkSize,
      });
      for (const candidate of chunk.items) {
        const finding: ReconciliationFindingEvidence = {
          ...candidate,
          identityKey: findingIdentity(input.companyId, candidate),
          fingerprintSha256: evidenceFingerprint(candidate),
        };
        observed.push(finding.identityKey);
        const persisted = await this.repository.persistFinding({
          companyId: input.companyId,
          finding,
          detectorVersion: reconciliationDetectorVersion,
          correlationId,
          snapshotAt,
        });
        if (persisted.created) findingsCreated += 1;
        else if (persisted.changed) findingsUpdated += 1;
        else findingsUnchanged += 1;
      }
      checkedCount += chunk.checkedCount;
      cursor = chunk.nextCursor;
    } while (cursor !== null);

    const findingsResolved =
      input.resolutionActorId === undefined
        ? 0
        : await this.repository.resolveMissing({
            companyId: input.companyId,
            scope,
            detectorVersion: reconciliationDetectorVersion,
            observedIdentityKeys: observed,
            actorId: input.resolutionActorId,
            snapshotAt,
          });
    const completedAt = new Date();
    return {
      scanId,
      correlationId,
      companyId: input.companyId,
      scope,
      snapshotAt,
      detectorVersion: reconciliationDetectorVersion,
      checkedCount,
      findingsCreated,
      findingsUpdated,
      findingsResolved,
      findingsUnchanged,
      warnings:
        input.resolutionActorId === undefined
          ? ['auto_resolution_requires_an_authorized_company_membership_actor']
          : [],
      completedAt,
      complete: true,
    };
  }
}

function normalizeScope(scope: ReconciliationScope | undefined): ReconciliationScope {
  if (!scope) return {};
  return {
    ...(scope.branchId === undefined ? {} : { branchId: scope.branchId.trim().toLowerCase() }),
    ...(scope.inventoryLocationId === undefined
      ? {}
      : { inventoryLocationId: scope.inventoryLocationId.trim().toLowerCase() }),
    ...(scope.productVariantId === undefined
      ? {}
      : { productVariantId: scope.productVariantId.trim().toLowerCase() }),
    ...(scope.aggregateType === undefined
      ? {}
      : { aggregateType: scope.aggregateType.trim().toLowerCase() }),
    ...(scope.aggregateId === undefined
      ? {}
      : { aggregateId: scope.aggregateId.trim().toLowerCase() }),
  };
}
