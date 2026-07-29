import { randomUUID } from 'node:crypto';

import type { DatabaseClient } from '@asone/database';

import type { DraftSqlClient } from './inventory-drafts.repository.js';
import type { DraftMovement, DraftMovementLine } from './inventory-drafts.types.js';
import { InventoryDraftError } from './inventory-drafts.types.js';
import { InventoryPostingRepository } from './inventory-posting.repository.js';
import type { InventoryMutationContext } from './inventory.types.js';

function constraint(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'constraint' in error
    ? String((error as { constraint?: unknown }).constraint)
    : undefined;
}

export class InventoryReversalRepository {
  public readonly posting: InventoryPostingRepository;

  public constructor(database: DatabaseClient) {
    this.posting = new InventoryPostingRepository(database);
  }

  public transaction<T>(callback: (client: DraftSqlClient) => Promise<T>): Promise<T> {
    return this.posting.transaction(callback);
  }

  public async insertReversal(
    client: DraftSqlClient,
    context: InventoryMutationContext,
    input: {
      id: string;
      movementNumber: string;
      original: DraftMovement;
      reasonCode: string;
      note: string | null;
    },
  ): Promise<DraftMovement> {
    try {
      await client.query(
        `insert into inventory_movements
         (id,company_id,branch_id,movement_number,movement_type,status,reason_code,notes,
          occurred_at,posted_at,reversal_of_movement_id,created_by,updated_by,posted_by,
          created_at,updated_at)
         values ($1,$2,$3,$4,'reversal','posted',$5,$6,$7,$7,$8,$9,$9,$9,$7,$7)`,
        [
          input.id,
          context.companyId,
          input.original.branchId,
          input.movementNumber,
          input.reasonCode,
          input.note,
          context.timestamp,
          input.original.id,
          context.actorId,
        ],
      );
    } catch (error) {
      if (constraint(error) === 'inventory_movements_reversal_of_posted_uq')
        throw new InventoryDraftError(
          'movement_already_reversed',
          'The movement has already been reversed.',
        );
      throw error;
    }
    const movement = await this.posting.drafts.lock(
      client,
      context.companyId,
      [input.original.branchId],
      input.id,
    );
    if (movement === null) throw new Error('Reversal movement insertion returned no row.');
    return movement;
  }

  public async insertReversalLines(
    client: DraftSqlClient,
    context: InventoryMutationContext,
    reversalId: string,
    reasonCode: string,
    lines: readonly DraftMovementLine[],
  ): Promise<void> {
    for (const [index, line] of lines.entries())
      await client.query(
        `insert into inventory_movement_lines
         (id,company_id,inventory_movement_id,line_number,product_variant_id,
          source_location_id,destination_location_id,quantity,base_quantity,
          unit_of_measure_code,unit_cost,extended_cost,currency_code,reason_code,metadata,created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,null,null,null,$11,null,$12)`,
        [
          randomUUID(),
          context.companyId,
          reversalId,
          index + 1,
          line.productVariantId,
          line.destinationLocationId,
          line.sourceLocationId,
          line.quantity,
          line.baseQuantity,
          line.unitOfMeasureCode,
          reasonCode,
          context.timestamp,
        ],
      );
  }

  public async markOriginalReversed(
    client: DraftSqlClient,
    context: InventoryMutationContext,
    original: DraftMovement,
    reversalId: string,
  ): Promise<DraftMovement> {
    await client.query(
      `update inventory_movements set status='reversed',reversed_at=$3,reversed_by=$4,
       reversed_by_movement_id=$5,version=version+1,updated_by=$4,updated_at=$3
       where company_id=$1 and id=$2`,
      [context.companyId, original.id, context.timestamp, context.actorId, reversalId],
    );
    const updated = await this.posting.drafts.lock(
      client,
      context.companyId,
      [original.branchId],
      original.id,
    );
    if (updated === null) throw new Error('Original movement reversal returned no row.');
    return updated;
  }
}
