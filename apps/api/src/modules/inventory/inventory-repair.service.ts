import { createHash } from 'node:crypto';

import {
  canonicalJson,
  evidenceFingerprint,
  exactQuantity,
  parseExactQuantity,
} from './inventory-reconciliation.service.js';
import type { ReconciliationCandidate } from './inventory-reconciliation.types.js';
import type { InventoryRepairRepository } from './inventory-repair.repository.js';
import {
  InventoryRepairError,
  type FindingListInput,
  type FindingPage,
  type RepairCommandContext,
  type RepairFinding,
  type RepairPreview,
  type RepairStrategy,
} from './inventory-repair.types.js';

const PREVIEW_TTL_MS = 5 * 60 * 1000;
const strategyByFinding: Readonly<Record<string, RepairStrategy>> = {
  balance_on_hand_drift: 'rebuild_on_hand_projection',
  balance_reserved_drift: 'rebuild_reserved_projection',
  balance_in_transit_drift: 'rebuild_in_transit_projection',
  last_movement_mismatch: 'restore_last_movement',
  missing_balance: 'create_missing_balance',
};
interface LifecycleResult {
  readonly finding_id: string;
  readonly previous_status: string;
  readonly new_status: string;
  readonly version: number;
}
interface RepairResult {
  readonly finding_id: string;
  readonly previous_status: string;
  readonly new_status: 'resolved';
  readonly strategy: RepairStrategy;
  readonly affected_balance_count: number;
  readonly movement_id: null;
  readonly repaired_at: string;
  readonly version: number;
}
interface BalanceEffect {
  readonly onHand: string;
  readonly reserved: string;
  readonly inTransit: string;
  readonly lastMovementId: string | null;
  readonly balanceId: string;
  readonly balanceVersion: bigint;
  readonly stockChanged: boolean;
}

function hash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}
function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string')
    throw new InventoryRepairError('reconciliation_finding_stale', `${name} is unavailable.`);
  return value;
}
function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
function nonnegative(value: string): bigint {
  const parsed = parseExactQuantity(value);
  if (parsed < 0n)
    throw new InventoryRepairError(
      'reconciliation_repair_not_allowed',
      'The authoritative quantity is invalid.',
    );
  return parsed;
}

export class InventoryRepairService {
  public constructor(private readonly repository: InventoryRepairRepository) {}

  public async list(
    companyId: string,
    branches: readonly string[],
    input: FindingListInput,
  ): Promise<FindingPage> {
    const cursor = input.cursor === undefined ? null : decodeCursor(input.cursor);
    const page = await this.repository.list(companyId, branches, input, cursor);
    const last = page.items.at(-1);
    return {
      items: page.items,
      nextCursor:
        page.nextCursor === null || last === undefined
          ? null
          : encodeCursor(last.lastDetectedAt, last.id),
    };
  }

  public async detail(
    companyId: string,
    branches: readonly string[],
    findingId: string,
  ): Promise<RepairFinding> {
    const value = await this.repository.find(companyId, branches, findingId);
    if (value === null)
      throw new InventoryRepairError('resource_not_found', 'The finding was not found.');
    return value;
  }

  public acknowledge(
    context: RepairCommandContext,
    branches: readonly string[],
    findingId: string,
    expectedVersion: bigint,
    idempotencyKey: string,
    input: { reasonCode: string; note: string | null },
  ): Promise<{ value: LifecycleResult; replayed: boolean }> {
    const requestHash = hash({ findingId, expectedVersion: String(expectedVersion), ...input });
    return this.repository
      .transaction((client) =>
        this.repository.idempotent(
          client,
          context,
          'inventory_reconciliation.acknowledge',
          findingId,
          idempotencyKey,
          requestHash,
          async () => {
            const value = await this.requiredLocked(client, context.companyId, branches, findingId);
            this.version(value, expectedVersion);
            if (value.status !== 'open') this.notMutable(value);
            const updated = await this.repository.transition(
              client,
              context,
              value,
              'acknowledged',
              input.reasonCode,
              input.note,
            );
            await this.repository.audit(
              client,
              context,
              value,
              'inventory_reconciliation.finding_acknowledged',
              {
                finding_id: value.id,
                reason_code: input.reasonCode,
                note: input.note,
                previous_status: value.status,
                new_status: updated.status,
                previous_version: Number(value.version),
                new_version: Number(updated.version),
              },
            );
            return lifecycleResponse(updated, value.status);
          },
        ),
      )
      .catch(mapRepositoryError);
  }

  public dismiss(
    context: RepairCommandContext,
    branches: readonly string[],
    findingId: string,
    expectedVersion: bigint,
    idempotencyKey: string,
    input: { reasonCode: string; note: string | null },
  ): Promise<{ value: LifecycleResult; replayed: boolean }> {
    const requestHash = hash({ findingId, expectedVersion: String(expectedVersion), ...input });
    return this.repository
      .transaction((client) =>
        this.repository.idempotent(
          client,
          context,
          'inventory_reconciliation.dismiss',
          findingId,
          idempotencyKey,
          requestHash,
          async () => {
            const value = await this.requiredLocked(client, context.companyId, branches, findingId);
            this.version(value, expectedVersion);
            if (!['open', 'acknowledged'].includes(value.status)) this.notMutable(value);
            const updated = await this.repository.transition(
              client,
              context,
              value,
              'dismissed',
              input.reasonCode,
              input.note,
            );
            await this.repository.audit(
              client,
              context,
              value,
              'inventory_reconciliation.finding_dismissed',
              {
                finding_id: value.id,
                reason_code: input.reasonCode,
                note: input.note,
                previous_status: value.status,
                new_status: updated.status,
                previous_version: Number(value.version),
                new_version: Number(updated.version),
              },
            );
            return lifecycleResponse(updated, value.status);
          },
        ),
      )
      .catch(mapRepositoryError);
  }

  public async preview(
    companyId: string,
    branches: readonly string[],
    findingId: string,
    expectedVersion: bigint,
    expectedFingerprint: string,
    strategy: RepairStrategy,
    now = new Date(),
  ): Promise<RepairPreview> {
    return this.repository.transaction(async (client) => {
      const value = await this.requiredLocked(client, companyId, branches, findingId);
      this.version(value, expectedVersion);
      this.mutable(value);
      this.fingerprint(value, expectedFingerprint);
      this.strategy(value, strategy);
      const candidate = await this.currentCandidate(client, value, now);
      const issuedAt = now;
      const expiresAt = new Date(now.getTime() + PREVIEW_TTL_MS);
      return this.makePreview(value, candidate, strategy, issuedAt, expiresAt);
    });
  }

  public repair(
    context: RepairCommandContext,
    branches: readonly string[],
    findingId: string,
    expectedVersion: bigint,
    idempotencyKey: string,
    input: {
      strategy: RepairStrategy;
      expectedFingerprint: string;
      previewFingerprint: string;
      previewExpiresAt: Date;
      reasonCode: string;
      note: string | null;
    },
  ): Promise<{ value: RepairResult; replayed: boolean }> {
    const requestHash = hash({
      findingId,
      expectedVersion: String(expectedVersion),
      strategy: input.strategy,
      expectedFingerprint: input.expectedFingerprint,
      previewFingerprint: input.previewFingerprint,
      previewExpiresAt: input.previewExpiresAt.toISOString(),
      reasonCode: input.reasonCode,
      note: input.note,
    });
    return this.repository
      .transaction((client) =>
        this.repository.idempotent(
          client,
          context,
          'inventory_reconciliation.repair',
          findingId,
          idempotencyKey,
          requestHash,
          async () => {
            const value = await this.requiredLocked(client, context.companyId, branches, findingId);
            this.version(value, expectedVersion);
            this.mutable(value);
            this.fingerprint(value, input.expectedFingerprint);
            this.strategy(value, input.strategy);
            if (input.previewExpiresAt.getTime() <= context.timestamp.getTime())
              throw new InventoryRepairError(
                'reconciliation_preview_expired',
                'The repair preview expired.',
              );
            const candidate = await this.currentCandidate(client, value, context.timestamp);
            const issuedAt = new Date(input.previewExpiresAt.getTime() - PREVIEW_TTL_MS);
            const preview = this.makePreview(
              value,
              candidate,
              input.strategy,
              issuedAt,
              input.previewExpiresAt,
            );
            if (preview.fingerprint !== input.previewFingerprint)
              throw new InventoryRepairError(
                'reconciliation_finding_stale',
                'The finding evidence changed after preview.',
              );
            const effect = await this.apply(client, context, value, candidate, input.strategy);
            const resolved = await this.repository.transition(
              client,
              context,
              value,
              'resolved',
              input.reasonCode,
              input.note,
            );
            const auditEvidence = {
              finding_id: value.id,
              strategy: input.strategy,
              reason_code: input.reasonCode,
              note: input.note,
              expected: candidate.expectedSummary,
              actual: candidate.actualSummary,
              affected_balance_ids: [effect.balanceId],
              previous_status: value.status,
              new_status: resolved.status,
              previous_finding_version: Number(value.version),
              new_finding_version: Number(resolved.version),
              balance_version: Number(effect.balanceVersion),
            };
            await this.repository.audit(
              client,
              context,
              value,
              'inventory_reconciliation.projection_rebuilt',
              auditEvidence,
            );
            await this.repository.audit(
              client,
              context,
              value,
              'inventory_reconciliation.repair_applied',
              auditEvidence,
            );
            if (effect.stockChanged)
              await this.repository.outbox(
                client,
                context,
                value,
                { id: effect.balanceId, version: effect.balanceVersion },
                {
                  company_id: context.companyId,
                  branch_id: value.branchId,
                  balance_id: effect.balanceId,
                  inventory_location_id: value.inventoryLocationId,
                  product_variant_id: value.productVariantId,
                  quantity_on_hand: effect.onHand,
                  quantity_reserved: effect.reserved,
                  quantity_in_transit: effect.inTransit,
                  available_quantity: exactQuantity(
                    parseExactQuantity(effect.onHand) - parseExactQuantity(effect.reserved),
                  ),
                  movement_id: null,
                  occurred_at: context.timestamp.toISOString(),
                  correlation_id: context.correlationId,
                },
              );
            return {
              finding_id: resolved.id,
              previous_status: value.status,
              new_status: 'resolved' as const,
              strategy: input.strategy,
              affected_balance_count: 1,
              movement_id: null,
              repaired_at: context.timestamp.toISOString(),
              version: Number(resolved.version),
            };
          },
        ),
      )
      .catch(mapRepositoryError);
  }

  private async requiredLocked(
    client: Parameters<Parameters<InventoryRepairRepository['transaction']>[0]>[0],
    companyId: string,
    branches: readonly string[],
    id: string,
  ): Promise<RepairFinding> {
    const value = await this.repository.lock(client, companyId, branches, id);
    if (value === null)
      throw new InventoryRepairError('resource_not_found', 'The finding was not found.');
    return value;
  }

  private version(value: RepairFinding, expected: bigint): void {
    if (value.version !== expected)
      throw new InventoryRepairError('version_conflict', 'The finding version changed.');
  }
  private mutable(value: RepairFinding): void {
    if (!['open', 'acknowledged'].includes(value.status)) this.notMutable(value);
  }
  private notMutable(value: RepairFinding): never {
    if (['resolved', 'dismissed'].includes(value.status))
      throw new InventoryRepairError(
        'reconciliation_finding_already_resolved',
        'The finding revision is terminal.',
      );
    throw new InventoryRepairError(
      'reconciliation_repair_not_allowed',
      'The finding state does not permit this operation.',
    );
  }
  private fingerprint(value: RepairFinding, expected: string): void {
    if (value.fingerprint !== expected)
      throw new InventoryRepairError(
        'reconciliation_finding_stale',
        'The finding fingerprint changed.',
      );
  }
  private strategy(value: RepairFinding, strategy: RepairStrategy): void {
    if (strategyByFinding[value.findingType] !== strategy)
      throw new InventoryRepairError(
        'reconciliation_repair_not_allowed',
        'The repair strategy is not allowed for this finding.',
      );
  }

  private async currentCandidate(
    client: Parameters<Parameters<InventoryRepairRepository['transaction']>[0]>[0],
    value: RepairFinding,
    now: Date,
  ): Promise<ReconciliationCandidate> {
    const candidates = await this.repository.candidates(client, value, now);
    const candidate = candidates.find(
      (item) =>
        item.findingType === value.findingType &&
        item.aggregateType === value.aggregateType &&
        item.aggregateId === value.aggregateId &&
        item.branchId === value.branchId &&
        item.inventoryLocationId === value.inventoryLocationId &&
        item.productVariantId === value.productVariantId,
    );
    if (candidate === undefined || evidenceFingerprint(candidate) !== value.fingerprint)
      throw new InventoryRepairError(
        'reconciliation_finding_stale',
        'The finding no longer matches authoritative evidence.',
      );
    const corrupt = candidates.some((item) => {
      if (['invalid_posted_movement', 'invalid_reversal_relationship'].includes(item.findingType))
        return ['balance_on_hand_drift', 'last_movement_mismatch', 'missing_balance'].includes(
          value.findingType,
        );
      if (item.findingType === 'transfer_movement_mismatch')
        return ['balance_in_transit_drift', 'missing_balance'].includes(value.findingType);
      if (item.findingType === 'reservation_movement_mismatch')
        return ['balance_reserved_drift', 'missing_balance'].includes(value.findingType);
      if (item.findingType === 'count_application_mismatch')
        return ['balance_on_hand_drift', 'last_movement_mismatch', 'missing_balance'].includes(
          value.findingType,
        );
      return false;
    });
    if (corrupt)
      throw new InventoryRepairError(
        'reconciliation_repair_not_allowed',
        'Related authoritative workflow evidence is invalid.',
      );
    const latest = candidates.find(
      (item) =>
        item.findingType === 'last_movement_mismatch' &&
        item.branchId === value.branchId &&
        item.inventoryLocationId === value.inventoryLocationId &&
        item.productVariantId === value.productVariantId,
    );
    return latest === undefined
      ? candidate
      : {
          ...candidate,
          evidence: {
            ...candidate.evidence,
            expectedLastMovementId: latest.expectedSummary.movementId ?? null,
          },
        };
  }

  private makePreview(
    value: RepairFinding,
    candidate: ReconciliationCandidate,
    strategy: RepairStrategy,
    issuedAt: Date,
    expiresAt: Date,
  ): RepairPreview {
    const balanceId = nullableString(candidate.evidence.balanceId);
    const proposedMutations = [
      {
        operation: strategy === 'create_missing_balance' ? 'insert' : 'update',
        resource_type: 'inventory_balance',
        resource_id: balanceId,
        expected: candidate.expectedSummary,
      },
    ];
    const expectedEvents = strategy === 'restore_last_movement' ? [] : ['inventory.stock.changed'];
    const material = {
      companyId: value.companyId,
      findingId: value.id,
      findingVersion: String(value.version),
      evidenceFingerprint: value.fingerprint,
      strategy,
      proposedMutations,
      snapshotAt: value.snapshotAt.toISOString(),
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
    return {
      findingId: value.id,
      repairable: true,
      strategy,
      expected: candidate.expectedSummary,
      actual: candidate.actualSummary,
      proposedMutations,
      affectedBalanceIds: balanceId === null ? [] : [balanceId],
      movement: null,
      expectedEvents,
      warnings: [],
      snapshotAt: value.snapshotAt,
      issuedAt,
      expiresAt,
      fingerprint: hash(material),
    };
  }

  private async apply(
    client: Parameters<Parameters<InventoryRepairRepository['transaction']>[0]>[0],
    context: RepairCommandContext,
    value: RepairFinding,
    candidate: ReconciliationCandidate,
    strategy: RepairStrategy,
  ): Promise<BalanceEffect> {
    const existing = await this.repository.lockBalance(client, value);
    if (strategy === 'create_missing_balance') {
      if (existing !== null)
        throw new InventoryRepairError(
          'reconciliation_finding_stale',
          'The missing balance was created concurrently.',
        );
      const quantities = {
        onHand: requiredString(candidate.expectedSummary.quantityOnHand, 'on-hand quantity'),
        reserved: requiredString(candidate.expectedSummary.quantityReserved, 'reserved quantity'),
        inTransit: requiredString(
          candidate.expectedSummary.quantityInTransit,
          'in-transit quantity',
        ),
        lastMovementId: nullableString(candidate.expectedSummary.lastMovementId),
      };
      this.safeQuantities(quantities.onHand, quantities.reserved, quantities.inTransit);
      const created = await this.repository.createBalance(
        client,
        value,
        quantities,
        context.timestamp,
      );
      return {
        ...quantities,
        balanceId: created.id,
        balanceVersion: created.version,
        stockChanged: true,
      };
    }
    if (existing === null)
      throw new InventoryRepairError('reconciliation_finding_stale', 'The balance is missing.');
    let onHand = existing.quantity_on_hand;
    let reserved = existing.quantity_reserved;
    let inTransit = existing.quantity_in_transit;
    let lastMovementId: string | null | undefined;
    if (strategy === 'rebuild_on_hand_projection') {
      onHand = requiredString(candidate.expectedSummary.quantity, 'on-hand quantity');
      const expectedLastMovementId = candidate.evidence.expectedLastMovementId;
      lastMovementId =
        expectedLastMovementId === undefined ? undefined : nullableString(expectedLastMovementId);
    } else if (strategy === 'rebuild_reserved_projection') {
      reserved = requiredString(candidate.expectedSummary.quantity, 'reserved quantity');
    } else if (strategy === 'rebuild_in_transit_projection') {
      inTransit = requiredString(candidate.expectedSummary.quantity, 'in-transit quantity');
    } else {
      lastMovementId = nullableString(candidate.expectedSummary.movementId);
    }
    this.safeQuantities(onHand, reserved, inTransit);
    const updated = await this.repository.updateBalance(client, existing.id, {
      ...(strategy === 'rebuild_on_hand_projection' ? { onHand } : {}),
      ...(strategy === 'rebuild_reserved_projection' ? { reserved } : {}),
      ...(strategy === 'rebuild_in_transit_projection' ? { inTransit } : {}),
      ...(lastMovementId === undefined ? {} : { lastMovementId }),
      timestamp: context.timestamp,
    });
    return {
      onHand,
      reserved,
      inTransit,
      lastMovementId: lastMovementId ?? existing.last_movement_id,
      balanceId: updated.id,
      balanceVersion: updated.version,
      stockChanged: strategy !== 'restore_last_movement',
    };
  }

  private safeQuantities(onHand: string, reserved: string, inTransit: string): void {
    const onHandValue = nonnegative(onHand);
    const reservedValue = nonnegative(reserved);
    nonnegative(inTransit);
    if (reservedValue > onHandValue)
      throw new InventoryRepairError(
        'inventory_balance_conflict',
        'The repaired balance would have negative availability.',
      );
  }
}

function lifecycleResponse(value: RepairFinding, previousStatus: string): LifecycleResult {
  return {
    finding_id: value.id,
    previous_status: previousStatus,
    new_status: value.status,
    version: Number(value.version),
  };
}

export function encodeCursor(lastDetectedAt: Date, id: string): string {
  return Buffer.from(JSON.stringify([lastDetectedAt.toISOString(), id]), 'utf8').toString(
    'base64url',
  );
}
export function decodeCursor(value: string): { lastDetectedAt: Date; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== 'string' ||
      typeof parsed[1] !== 'string'
    )
      throw new Error('invalid');
    const lastDetectedAt = new Date(parsed[0]);
    if (Number.isNaN(lastDetectedAt.getTime())) throw new Error('invalid');
    return { lastDetectedAt, id: parsed[1] };
  } catch {
    throw new InventoryRepairError('validation_error', 'The cursor is invalid.');
  }
}

function mapRepositoryError(error: unknown): never {
  if (error instanceof InventoryRepairError) throw error;
  if (error instanceof Error && error.message === 'IDEMPOTENCY_CONFLICT')
    throw new InventoryRepairError('idempotency_conflict', 'The idempotency key conflicts.');
  if (error instanceof Error && error.message === 'BALANCE_CONFLICT')
    throw new InventoryRepairError(
      'reconciliation_finding_stale',
      'The balance was created concurrently.',
    );
  throw error;
}
