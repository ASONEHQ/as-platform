import { randomUUID } from 'node:crypto';

import type { DatabaseClient } from '@asone/database';

import type { DraftSqlClient } from './inventory-drafts.repository.js';
import { InventoryDraftRepository } from './inventory-drafts.repository.js';
import type { DraftMovement, DraftMovementLine } from './inventory-drafts.types.js';
import type { InventoryMutationContext } from './inventory.types.js';

interface QueryResult<T> {
  rows: readonly T[];
}
export interface BalanceKey {
  companyId: string;
  branchId: string;
  locationId: string;
  variantId: string;
}
export interface LockedBalance extends BalanceKey {
  id: string;
  quantityOnHand: string;
  quantityReserved: string;
  quantityInTransit: string;
  averageUnitCost: string;
  currencyCode: string | null;
  version: bigint;
}

function result<T>(value: unknown): QueryResult<T> {
  return value as QueryResult<T>;
}

export class InventoryPostingRepository {
  public readonly drafts: InventoryDraftRepository;

  public constructor(database: DatabaseClient) {
    this.drafts = new InventoryDraftRepository(database);
  }

  public transaction<T>(callback: (client: DraftSqlClient) => Promise<T>): Promise<T> {
    return this.drafts.transaction(callback);
  }

  public async lines(
    client: DraftSqlClient,
    companyId: string,
    movementId: string,
  ): Promise<readonly DraftMovementLine[]> {
    const rows = result<{
      id: string;
      inventory_movement_id: string;
      line_number: number;
      product_variant_id: string;
      source_location_id: string | null;
      destination_location_id: string | null;
      quantity: string;
      base_quantity: string;
      unit_of_measure_code: string;
      unit_cost: string | null;
      extended_cost: string | null;
      currency_code: string | null;
      reason_code: string | null;
      metadata: Readonly<Record<string, unknown>> | null;
      created_at: Date | string;
    }>(
      await client.query(
        `select id,inventory_movement_id,line_number,product_variant_id,
         source_location_id,destination_location_id,quantity::text,base_quantity::text,
         unit_of_measure_code,unit_cost::text,extended_cost::text,currency_code,
         reason_code,metadata,created_at
         from inventory_movement_lines
         where company_id=$1 and inventory_movement_id=$2
         order by line_number,id`,
        [companyId, movementId],
      ),
    ).rows;
    return rows.map((row) => ({
      id: row.id,
      movementId: row.inventory_movement_id,
      lineNumber: row.line_number,
      productVariantId: row.product_variant_id,
      sourceLocationId: row.source_location_id,
      destinationLocationId: row.destination_location_id,
      quantity: row.quantity,
      baseQuantity: row.base_quantity,
      unitOfMeasureCode: row.unit_of_measure_code,
      unitCost: row.unit_cost,
      extendedCost: row.extended_cost,
      currencyCode: row.currency_code,
      reasonCode: row.reason_code,
      metadata: row.metadata,
      createdAt: new Date(row.created_at),
    }));
  }

  public async validateLineReferences(
    client: DraftSqlClient,
    companyId: string,
    branchId: string,
    line: DraftMovementLine,
  ): Promise<boolean> {
    const row = result<{ valid: boolean }>(
      await client.query(
        `select exists(
           select 1 from product_variants v
           join products p on p.company_id=v.company_id and p.id=v.product_id
           where v.company_id=$1 and v.id=$2 and v.status='active' and p.status='active'
             and v.unit_of_measure_code=$3
         ) and
         ($4::uuid is null or exists(
           select 1 from inventory_locations l where l.company_id=$1 and l.branch_id=$6
             and l.id=$4 and l.status='active' and l.allows_issuing
         )) and
         ($5::uuid is null or exists(
           select 1 from inventory_locations l where l.company_id=$1 and l.branch_id=$6
             and l.id=$5 and l.status='active' and l.allows_receiving
         )) valid`,
        [
          companyId,
          line.productVariantId,
          line.unitOfMeasureCode,
          line.sourceLocationId,
          line.destinationLocationId,
          branchId,
        ],
      ),
    ).rows[0];
    return row?.valid ?? false;
  }

  public async transition(
    client: DraftSqlClient,
    context: InventoryMutationContext,
    movement: DraftMovement,
    status: 'pending' | 'posted',
  ): Promise<DraftMovement> {
    await client.query(
      status === 'pending'
        ? `update inventory_movements set status='pending',version=version+1,
           updated_by=$2,updated_at=$3 where company_id=$1 and id=$4`
        : `update inventory_movements set status='posted',posted_at=$3,posted_by=$2,
           version=version+1,updated_by=$2,updated_at=$3 where company_id=$1 and id=$4`,
      [context.companyId, context.actorId, context.timestamp, movement.id],
    );
    const updated = await this.drafts.lock(
      client,
      context.companyId,
      [movement.branchId],
      movement.id,
    );
    if (updated === null) throw new Error('Movement transition returned no row.');
    return updated;
  }

  public async createInboundBalances(
    client: DraftSqlClient,
    keys: readonly BalanceKey[],
    movementId: string,
    timestamp: Date,
  ): Promise<void> {
    for (const key of keys)
      await client.query(
        `insert into inventory_balances
         (id,company_id,branch_id,inventory_location_id,product_variant_id,
          quantity_on_hand,quantity_reserved,quantity_in_transit,average_unit_cost,
          currency_code,version,last_movement_id,created_at,updated_at)
         values ($1,$2,$3,$4,$5,0,0,0,0,null,1,$6,$7,$7)
         on conflict (company_id,inventory_location_id,product_variant_id) do nothing`,
        [
          randomUUID(),
          key.companyId,
          key.branchId,
          key.locationId,
          key.variantId,
          movementId,
          timestamp,
        ],
      );
  }

  public async lockBalances(
    client: DraftSqlClient,
    keys: readonly BalanceKey[],
  ): Promise<readonly LockedBalance[]> {
    const balances: LockedBalance[] = [];
    for (const key of keys) {
      const row = result<{
        id: string;
        quantity_on_hand: string;
        quantity_reserved: string;
        quantity_in_transit: string;
        average_unit_cost: string;
        currency_code: string | null;
        version: string;
      }>(
        await client.query(
          `select id,quantity_on_hand::text,quantity_reserved::text,
           quantity_in_transit::text,average_unit_cost::text,currency_code,version::text
           from inventory_balances
           where company_id=$1 and branch_id=$2 and inventory_location_id=$3
             and product_variant_id=$4 for update`,
          [key.companyId, key.branchId, key.locationId, key.variantId],
        ),
      ).rows[0];
      if (row !== undefined)
        balances.push({
          ...key,
          id: row.id,
          quantityOnHand: row.quantity_on_hand,
          quantityReserved: row.quantity_reserved,
          quantityInTransit: row.quantity_in_transit,
          averageUnitCost: row.average_unit_cost,
          currencyCode: row.currency_code,
          version: BigInt(row.version),
        });
    }
    return balances;
  }

  public async updateBalance(
    client: DraftSqlClient,
    input: LockedBalance & { newQuantity: string; movementId: string; timestamp: Date },
  ): Promise<bigint> {
    const row = result<{ version: string }>(
      await client.query(
        `update inventory_balances set quantity_on_hand=$2,version=version+1,
         last_movement_id=$3,updated_at=$4 where id=$1 returning version::text`,
        [input.id, input.newQuantity, input.movementId, input.timestamp],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Balance update returned no row.');
    return BigInt(row.version);
  }

  public outbox(
    client: DraftSqlClient,
    context: InventoryMutationContext,
    input: {
      eventType: string;
      aggregateType: string;
      aggregateId: string;
      aggregateVersion: bigint;
      branchId: string;
      payload: Readonly<Record<string, unknown>>;
    },
  ): Promise<unknown> {
    return client.query(
      `insert into outbox_events
       (event_id,company_id,branch_id,event_type,schema_version,aggregate_type,
        aggregate_id,aggregate_version,correlation_id,payload,occurred_at,available_at,created_at)
       values ($1,$2,$3,$4,1,$5,$6,$7,$8,$9::jsonb,$10,$10,$10)`,
      [
        randomUUID(),
        context.companyId,
        input.branchId,
        input.eventType,
        input.aggregateType,
        input.aggregateId,
        input.aggregateVersion.toString(),
        context.correlationId,
        JSON.stringify(input.payload),
        context.timestamp,
      ],
    );
  }
}
