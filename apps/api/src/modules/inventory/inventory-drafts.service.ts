import { createHash, randomUUID } from 'node:crypto';

import { createUuidV7 } from '@asone/database';

import type { InventoryDraftRepository } from './inventory-drafts.repository.js';
import type { DraftSqlClient } from './inventory-drafts.repository.js';
import type {
  DraftMovement,
  DraftMovementLine,
  DraftMovementType,
} from './inventory-drafts.types.js';
import { InventoryDraftError } from './inventory-drafts.types.js';
import type { InventoryMutationContext, InventoryPage } from './inventory.types.js';

export interface DraftHeaderInput {
  branchId: string;
  movementType: DraftMovementType;
  occurredAt?: Date;
  reasonCode?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  sourceDocumentNumber?: string | null;
  notes?: string | null;
}
export type DraftHeaderPatch = Partial<DraftHeaderInput>;
export interface DraftLineInput {
  productVariantId: string;
  sourceLocationId?: string | null;
  destinationLocationId?: string | null;
  quantity: string;
  unitOfMeasureCode: string;
  reasonCode?: string | null;
  metadata?: Readonly<Record<string, unknown>> | null;
}
export type DraftLinePatch = Partial<DraftLineInput>;
interface NormalizedHeader {
  branchId: string;
  movementType: DraftMovementType;
  occurredAt: Date;
  reasonCode: string | null;
  referenceType: string | null;
  referenceId: string | null;
  sourceDocumentNumber: string | null;
  notes: string | null;
}
interface NormalizedLine {
  productVariantId: string;
  sourceLocationId: string | null;
  destinationLocationId: string | null;
  quantity: string;
  unitOfMeasureCode: string;
  reasonCode: string | null;
  metadata: Readonly<Record<string, unknown>> | null;
}

function hash(value: object): string {
  return createHash('sha256')
    .update(JSON.stringify(Object.fromEntries(Object.entries(value).sort())))
    .digest('hex');
}
function optionalText(value: string | null | undefined, max: number): string | null {
  if (value === undefined || value === null) return null;
  const clean = value.trim();
  if (clean.length === 0) return null;
  if (clean.length > max)
    throw new InventoryDraftError('invalid_movement_state', 'Text is too long.');
  return clean;
}
function reference(type: string | null, id: string | null): void {
  if ((type === null) !== (id === null))
    throw new InventoryDraftError(
      'invalid_movement_state',
      'reference_type and reference_id must be supplied together.',
    );
}
function editable(value: DraftMovement): void {
  if (value.status === 'draft') return;
  if (value.status === 'posted')
    throw new InventoryDraftError('movement_already_posted', 'The movement is posted.');
  if (value.status === 'reversed')
    throw new InventoryDraftError('movement_already_reversed', 'The movement is reversed.');
  if (value.status === 'cancelled')
    throw new InventoryDraftError('movement_already_cancelled', 'The movement is cancelled.');
  throw new InventoryDraftError('invalid_movement_state', 'The movement is not editable.');
}
function cancellable(value: DraftMovement): void {
  if (value.status === 'draft' || value.status === 'pending') return;
  editable(value);
}
function checkVersion(value: DraftMovement, expected: bigint): void {
  if (value.version !== expected)
    throw new InventoryDraftError('version_conflict', 'The movement version changed.');
}
function movementJson(value: DraftMovement): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    branch_id: value.branchId,
    movement_number: value.movementNumber,
    movement_type: value.movementType,
    status: value.status,
    reason_code: value.reasonCode,
    reference_type: value.referenceType,
    reference_id: value.referenceId,
    source_document_number: value.sourceDocumentNumber,
    notes: value.notes,
    version: Number(value.version),
    occurred_at: value.occurredAt.toISOString(),
    posted_at: value.postedAt?.toISOString() ?? null,
    cancelled_at: value.cancelledAt?.toISOString() ?? null,
    reversed_at: value.reversedAt?.toISOString() ?? null,
    created_at: value.createdAt.toISOString(),
    updated_at: value.updatedAt.toISOString(),
    line_count: value.lineCount,
  };
}
function lineJson(
  value: DraftMovementLine,
  includeCost: boolean,
): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    movement_id: value.movementId,
    line_number: value.lineNumber,
    product_variant_id: value.productVariantId,
    source_inventory_location_id: value.sourceLocationId,
    destination_inventory_location_id: value.destinationLocationId,
    quantity: value.quantity,
    base_quantity: value.baseQuantity,
    unit_of_measure_code: value.unitOfMeasureCode,
    ...(includeCost
      ? {
          unit_cost: value.unitCost,
          extended_cost: value.extendedCost,
          currency_code: value.currencyCode,
        }
      : {}),
    reason_code: value.reasonCode,
    metadata: value.metadata,
    created_at: value.createdAt.toISOString(),
  };
}

export class InventoryDraftService {
  public constructor(private readonly repository: InventoryDraftRepository) {}

  public async create(
    context: InventoryMutationContext,
    permittedBranches: readonly string[],
    key: string,
    input: DraftHeaderInput,
  ): Promise<{ value: Readonly<Record<string, unknown>>; replayed: boolean }> {
    if (!permittedBranches.includes(input.branchId))
      throw new InventoryDraftError('branch_not_found', 'The branch was not found.');
    if (!['opening_balance', 'adjustment'].includes(input.movementType))
      throw new InventoryDraftError('invalid_movement_type', 'The movement type is not allowed.');
    const normalized = this.header(input, context.timestamp);
    return this.repository.transaction(async (client) => {
      if (!(await this.repository.branchExists(client, context.companyId, normalized.branchId)))
        throw new InventoryDraftError('branch_not_found', 'The branch was not found.');
      return this.repository.idempotent(
        client,
        context,
        'inventory_movement.create',
        key,
        hash(normalized),
        201,
        async () => {
          const id = createUuidV7();
          const value = await this.repository.insert(client, context, {
            id,
            movementNumber: `IMV-${id.replaceAll('-', '').toLowerCase()}`,
            ...normalized,
          });
          await this.repository.audit(client, context, {
            action: 'inventory_movement.created',
            movement: value,
          });
          return movementJson(value);
        },
      );
    });
  }

  public async get(
    companyId: string,
    branches: readonly string[],
    id: string,
  ): Promise<DraftMovement> {
    const value = await this.repository.find(companyId, branches, id);
    if (value === null)
      throw new InventoryDraftError('inventory_movement_not_found', 'The movement was not found.');
    return value;
  }

  public async patch(
    context: InventoryMutationContext,
    branches: readonly string[],
    id: string,
    expectedVersion: bigint,
    patch: DraftHeaderPatch,
  ): Promise<DraftMovement> {
    return this.repository.transaction(async (client) => {
      const current = await this.requiredLock(client, context.companyId, branches, id);
      editable(current);
      checkVersion(current, expectedVersion);
      const input = this.header(
        {
          branchId: patch.branchId ?? current.branchId,
          movementType: patch.movementType ?? current.movementType,
          occurredAt: patch.occurredAt ?? current.occurredAt,
          reasonCode: patch.reasonCode === undefined ? current.reasonCode : patch.reasonCode,
          referenceType:
            patch.referenceType === undefined ? current.referenceType : patch.referenceType,
          referenceId: patch.referenceId === undefined ? current.referenceId : patch.referenceId,
          sourceDocumentNumber:
            patch.sourceDocumentNumber === undefined
              ? current.sourceDocumentNumber
              : patch.sourceDocumentNumber,
          notes: patch.notes === undefined ? current.notes : patch.notes,
        },
        context.timestamp,
      );
      if (
        current.lineCount > 0 &&
        (input.branchId !== current.branchId || input.movementType !== current.movementType)
      )
        throw new InventoryDraftError(
          'invalid_movement_state',
          'Branch and movement type cannot change after lines exist.',
        );
      if (!branches.includes(input.branchId))
        throw new InventoryDraftError('branch_not_found', 'The branch was not found.');
      if (!(await this.repository.branchExists(client, context.companyId, input.branchId)))
        throw new InventoryDraftError('branch_not_found', 'The branch was not found.');
      const value = await this.repository.updateHeader(client, context, current, input);
      await this.repository.audit(client, context, {
        action: 'inventory_movement.updated',
        movement: value,
      });
      return value;
    });
  }

  public cancel(
    context: InventoryMutationContext,
    branches: readonly string[],
    id: string,
    expectedVersion: bigint,
    key: string,
    reasonCode: string,
    note?: string | null,
  ): Promise<{ value: Readonly<Record<string, unknown>>; replayed: boolean }> {
    const normalized = {
      movementId: id,
      expectedVersion: expectedVersion.toString(),
      reasonCode: optionalText(reasonCode, 64),
      note: optionalText(note, 1000),
    };
    if (normalized.reasonCode === null)
      throw new InventoryDraftError('invalid_movement_state', 'reason_code is required.');
    return this.repository.transaction(async (client) =>
      this.repository.idempotent(
        client,
        context,
        'inventory_movement.cancel',
        key,
        hash(normalized),
        200,
        async () => {
          const current = await this.requiredLock(client, context.companyId, branches, id);
          cancellable(current);
          checkVersion(current, expectedVersion);
          const value = await this.repository.cancel(client, context, current);
          await this.repository.audit(client, context, {
            action: 'inventory_movement.cancelled',
            movement: value,
            metadata: { reason_code: normalized.reasonCode, note: normalized.note },
          });
          return movementJson(value);
        },
      ),
    );
  }

  public async listLines(
    companyId: string,
    branches: readonly string[],
    id: string,
    includeCost: boolean,
    input: { limit: number; cursor?: string },
  ): Promise<InventoryPage<Readonly<Record<string, unknown>>>> {
    await this.get(companyId, branches, id);
    const page = await this.repository.lines(companyId, id, input);
    return { ...page, items: page.items.map((value) => lineJson(value, includeCost)) };
  }

  public addLine(
    context: InventoryMutationContext,
    branches: readonly string[],
    movementId: string,
    expectedVersion: bigint,
    key: string,
    input: DraftLineInput,
    includeCost: boolean,
  ): Promise<{ value: Readonly<Record<string, unknown>>; replayed: boolean }> {
    const normalized = this.lineInput(input);
    const request = {
      movementId,
      expectedVersion: expectedVersion.toString(),
      ...normalized,
    };
    return this.repository.transaction(async (client) =>
      this.repository.idempotent(
        client,
        context,
        'inventory_movement_line.create',
        key,
        hash(request),
        201,
        async () => {
          const movement = await this.requiredLock(client, context.companyId, branches, movementId);
          editable(movement);
          checkVersion(movement, expectedVersion);
          await this.validateLine(client, context.companyId, movement, normalized);
          if (
            await this.repository.duplicateLine(client, context.companyId, movementId, normalized)
          )
            throw new InventoryDraftError(
              'duplicate_movement_line',
              'An equivalent movement line already exists.',
            );
          const value = await this.repository.insertLine(client, context.companyId, {
            id: randomUUID(),
            movementId,
            ...normalized,
            createdAt: context.timestamp,
          });
          const updated = await this.repository.bump(client, context, movementId);
          await this.repository.audit(client, context, {
            action: 'inventory_movement_line.created',
            movement: updated,
            lineId: value.id,
          });
          return { line: lineJson(value, includeCost), version: Number(updated.version) };
        },
      ),
    );
  }

  public patchLine(
    context: InventoryMutationContext,
    branches: readonly string[],
    movementId: string,
    lineId: string,
    expectedVersion: bigint,
    patch: DraftLinePatch,
    includeCost: boolean,
  ): Promise<{ line: Readonly<Record<string, unknown>>; version: bigint }> {
    return this.repository.transaction(async (client) => {
      const movement = await this.requiredLock(client, context.companyId, branches, movementId);
      editable(movement);
      checkVersion(movement, expectedVersion);
      const current = await this.repository.line(client, context.companyId, movementId, lineId);
      if (current === null)
        throw new InventoryDraftError(
          'inventory_movement_line_not_found',
          'The movement line was not found.',
        );
      const input = this.lineInput({
        productVariantId: patch.productVariantId ?? current.productVariantId,
        sourceLocationId:
          patch.sourceLocationId === undefined ? current.sourceLocationId : patch.sourceLocationId,
        destinationLocationId:
          patch.destinationLocationId === undefined
            ? current.destinationLocationId
            : patch.destinationLocationId,
        quantity: patch.quantity ?? current.quantity,
        unitOfMeasureCode: patch.unitOfMeasureCode ?? current.unitOfMeasureCode,
        reasonCode: patch.reasonCode === undefined ? current.reasonCode : patch.reasonCode,
        metadata: patch.metadata === undefined ? current.metadata : patch.metadata,
      });
      await this.validateLine(client, context.companyId, movement, input);
      if (
        await this.repository.duplicateLine(client, context.companyId, movementId, {
          ...input,
          excludeId: lineId,
        })
      )
        throw new InventoryDraftError(
          'duplicate_movement_line',
          'An equivalent movement line already exists.',
        );
      const value = await this.repository.updateLine(client, context.companyId, {
        ...current,
        ...input,
      });
      const updated = await this.repository.bump(client, context, movementId);
      await this.repository.audit(client, context, {
        action: 'inventory_movement_line.updated',
        movement: updated,
        lineId,
      });
      return { line: lineJson(value, includeCost), version: updated.version };
    });
  }

  public deleteLine(
    context: InventoryMutationContext,
    branches: readonly string[],
    movementId: string,
    lineId: string,
    expectedVersion: bigint,
  ): Promise<{ movementId: string; deletedLineId: string; version: bigint }> {
    return this.repository.transaction(async (client) => {
      const movement = await this.requiredLock(client, context.companyId, branches, movementId);
      editable(movement);
      checkVersion(movement, expectedVersion);
      if ((await this.repository.line(client, context.companyId, movementId, lineId)) === null)
        throw new InventoryDraftError(
          'inventory_movement_line_not_found',
          'The movement line was not found.',
        );
      await this.repository.deleteLine(client, context.companyId, movementId, lineId);
      const updated = await this.repository.bump(client, context, movementId);
      await this.repository.audit(client, context, {
        action: 'inventory_movement_line.deleted',
        movement: updated,
        lineId,
      });
      return { movementId, deletedLineId: lineId, version: updated.version };
    });
  }

  private header(input: DraftHeaderInput, fallback: Date): NormalizedHeader {
    const referenceType = optionalText(input.referenceType, 64);
    const referenceId = input.referenceId ?? null;
    reference(referenceType, referenceId);
    return {
      branchId: input.branchId,
      movementType: input.movementType,
      occurredAt: input.occurredAt ?? fallback,
      reasonCode: optionalText(input.reasonCode, 64),
      referenceType,
      referenceId,
      sourceDocumentNumber: optionalText(input.sourceDocumentNumber, 128),
      notes: optionalText(input.notes, 2000),
    };
  }

  private lineInput(input: DraftLineInput): NormalizedLine {
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/u.test(input.quantity) || Number(input.quantity) <= 0)
      throw new InventoryDraftError('invalid_movement_direction', 'quantity is invalid.');
    const metadata = input.metadata ?? null;
    if (metadata !== null && JSON.stringify(metadata).length > 8192)
      throw new InventoryDraftError('invalid_movement_state', 'metadata is too large.');
    return {
      productVariantId: input.productVariantId,
      sourceLocationId: input.sourceLocationId ?? null,
      destinationLocationId: input.destinationLocationId ?? null,
      quantity: input.quantity,
      unitOfMeasureCode: input.unitOfMeasureCode.trim(),
      reasonCode: optionalText(input.reasonCode, 64),
      metadata,
    };
  }

  private async validateLine(
    client: DraftSqlClient,
    companyId: string,
    movement: DraftMovement,
    input: ReturnType<InventoryDraftService['lineInput']>,
  ): Promise<void> {
    const variant = await this.repository.variant(client, companyId, input.productVariantId);
    if (variant === null)
      throw new InventoryDraftError('product_variant_not_found', 'The variant was not found.');
    if (variant.unit !== input.unitOfMeasureCode)
      throw new InventoryDraftError('unit_of_measure_not_found', 'The base UOM was not found.');
    const decimals = input.quantity.split('.')[1]?.length ?? 0;
    if (decimals > variant.quantityScale)
      throw new InventoryDraftError(
        'invalid_movement_direction',
        'The quantity exceeds the variant scale.',
      );
    const source =
      input.sourceLocationId === null
        ? null
        : await this.repository.location(
            client,
            companyId,
            movement.branchId,
            input.sourceLocationId,
          );
    const destination =
      input.destinationLocationId === null
        ? null
        : await this.repository.location(
            client,
            companyId,
            movement.branchId,
            input.destinationLocationId,
          );
    if (
      (input.sourceLocationId !== null && !source?.issuing) ||
      (input.destinationLocationId !== null && !destination?.receiving)
    )
      throw new InventoryDraftError(
        'invalid_inventory_location',
        'The inventory location is invalid.',
      );
    const directionValid =
      movement.movementType === 'opening_balance'
        ? input.sourceLocationId === null && input.destinationLocationId !== null
        : (input.sourceLocationId === null) !== (input.destinationLocationId === null);
    if (
      !directionValid ||
      (input.sourceLocationId !== null && input.sourceLocationId === input.destinationLocationId)
    )
      throw new InventoryDraftError(
        'invalid_movement_direction',
        'The movement direction is invalid.',
      );
  }

  private async requiredLock(
    client: DraftSqlClient,
    companyId: string,
    branches: readonly string[],
    id: string,
  ): Promise<DraftMovement> {
    const value = await this.repository.lock(client, companyId, branches, id);
    if (value === null)
      throw new InventoryDraftError('inventory_movement_not_found', 'The movement was not found.');
    return value;
  }
}

export { lineJson, movementJson };
