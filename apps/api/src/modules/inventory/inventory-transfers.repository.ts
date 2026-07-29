import { randomUUID } from 'node:crypto';

import type { DatabaseClient } from '@asone/database';

import type { DraftSqlClient } from './inventory-drafts.repository.js';
import { InventoryDraftRepository } from './inventory-drafts.repository.js';
import type { BalanceKey, LockedBalance } from './inventory-posting.repository.js';
import { InventoryPostingRepository } from './inventory-posting.repository.js';
import type { InventoryMutationContext, InventoryPage } from './inventory.types.js';
import type {
  InventoryTransfer,
  InventoryTransferLine,
  InventoryTransferStatus,
} from './inventory-transfers.types.js';

interface QueryResult<T> {
  rows: readonly T[];
}
interface TransferRow {
  id: string;
  company_id: string;
  transfer_number: string;
  status: InventoryTransferStatus;
  source_branch_id: string;
  destination_branch_id: string;
  source_location_id: string;
  destination_location_id: string;
  transit_location_id: string;
  requested_at: Date | string;
  approved_at: Date | string | null;
  shipped_at: Date | string | null;
  received_at: Date | string | null;
  rejected_at: Date | string | null;
  cancelled_at: Date | string | null;
  requested_by: string;
  approved_by: string | null;
  shipped_by: string | null;
  received_by: string | null;
  rejected_by: string | null;
  cancelled_by: string | null;
  shipment_movement_id: string | null;
  receipt_movement_id: string | null;
  notes: string | null;
  version: string;
  created_at: Date | string;
  updated_at: Date | string;
}
interface LineRow {
  id: string;
  line_number: number;
  product_variant_id: string;
  requested_quantity: string;
  shipped_quantity: string;
  received_quantity: string;
  rejected_quantity: string;
  unit_of_measure_code: string;
  notes: string | null;
}

const TRANSFER_COLUMNS = `t.id,t.company_id,t.transfer_number,t.status,
 t.source_branch_id,t.destination_branch_id,t.source_location_id,
 t.destination_location_id,t.transit_location_id,t.requested_at,t.approved_at,
 t.shipped_at,t.received_at,t.rejected_at,t.cancelled_at,t.requested_by,
 t.approved_by,t.shipped_by,t.received_by,t.rejected_by,t.cancelled_by,
 t.shipment_movement_id,t.receipt_movement_id,t.notes,t.version::text,
 t.created_at,t.updated_at`;

function result<T>(value: unknown): QueryResult<T> {
  return value as QueryResult<T>;
}
function date(value: Date | string | null): Date | null {
  return value === null ? null : new Date(value);
}
function transfer(row: TransferRow, lines: readonly InventoryTransferLine[]): InventoryTransfer {
  return {
    id: row.id,
    companyId: row.company_id,
    transferNumber: row.transfer_number,
    status: row.status,
    sourceBranchId: row.source_branch_id,
    destinationBranchId: row.destination_branch_id,
    sourceLocationId: row.source_location_id,
    destinationLocationId: row.destination_location_id,
    transitLocationId: row.transit_location_id,
    requestedAt: new Date(row.requested_at),
    approvedAt: date(row.approved_at),
    shippedAt: date(row.shipped_at),
    receivedAt: date(row.received_at),
    rejectedAt: date(row.rejected_at),
    cancelledAt: date(row.cancelled_at),
    requestedBy: row.requested_by,
    approvedBy: row.approved_by,
    shippedBy: row.shipped_by,
    receivedBy: row.received_by,
    rejectedBy: row.rejected_by,
    cancelledBy: row.cancelled_by,
    shipmentMovementId: row.shipment_movement_id,
    receiptMovementId: row.receipt_movement_id,
    notes: row.notes,
    version: BigInt(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    lines,
  };
}
function line(row: LineRow): InventoryTransferLine {
  return {
    id: row.id,
    lineNumber: row.line_number,
    productVariantId: row.product_variant_id,
    requestedQuantity: row.requested_quantity,
    shippedQuantity: row.shipped_quantity,
    receivedQuantity: row.received_quantity,
    rejectedQuantity: row.rejected_quantity,
    unitOfMeasureCode: row.unit_of_measure_code,
    notes: row.notes,
  };
}

export class InventoryTransferRepository {
  public readonly drafts: InventoryDraftRepository;
  public readonly posting: InventoryPostingRepository;

  public constructor(private readonly database: DatabaseClient) {
    this.drafts = new InventoryDraftRepository(database);
    this.posting = new InventoryPostingRepository(database);
  }

  public transaction<T>(callback: (client: DraftSqlClient) => Promise<T>): Promise<T> {
    return this.drafts.transaction(callback);
  }

  public async location(
    client: DraftSqlClient,
    companyId: string,
    branchId: string,
    id: string,
  ): Promise<{ type: string; receiving: boolean; issuing: boolean } | null> {
    return (
      result<{ type: string; receiving: boolean; issuing: boolean }>(
        await client.query(
          `select location_type type,allows_receiving receiving,allows_issuing issuing
           from inventory_locations where company_id=$1 and branch_id=$2 and id=$3
           and status='active' and deleted_at is null`,
          [companyId, branchId, id],
        ),
      ).rows[0] ?? null
    );
  }

  public branchExists(
    client: DraftSqlClient,
    companyId: string,
    branchId: string,
  ): Promise<boolean> {
    return this.drafts.branchExists(client, companyId, branchId);
  }

  public variant(
    client: DraftSqlClient,
    companyId: string,
    id: string,
  ): Promise<{ unit: string; quantityScale: number } | null> {
    return this.drafts.variant(client, companyId, id);
  }

  public async insert(
    client: DraftSqlClient,
    context: InventoryMutationContext,
    input: {
      id: string;
      transferNumber: string;
      sourceBranchId: string;
      destinationBranchId: string;
      sourceLocationId: string;
      destinationLocationId: string;
      transitLocationId: string;
      notes: string | null;
      lines: readonly {
        id: string;
        productVariantId: string;
        quantity: string;
        unitOfMeasureCode: string;
        notes: string | null;
      }[];
    },
  ): Promise<InventoryTransfer> {
    await client.query(
      `insert into inventory_transfers
       (id,company_id,transfer_number,status,source_branch_id,destination_branch_id,
        source_location_id,destination_location_id,transit_location_id,requested_at,
        requested_by,notes,created_at,updated_at)
       values ($1,$2,$3,'requested',$4,$5,$6,$7,$8,$9,$10,$11,$9,$9)`,
      [
        input.id,
        context.companyId,
        input.transferNumber,
        input.sourceBranchId,
        input.destinationBranchId,
        input.sourceLocationId,
        input.destinationLocationId,
        input.transitLocationId,
        context.timestamp,
        context.actorId,
        input.notes,
      ],
    );
    for (const [index, value] of input.lines.entries())
      await client.query(
        `insert into inventory_transfer_lines
         (id,company_id,inventory_transfer_id,line_number,product_variant_id,
          requested_quantity,unit_of_measure_code,notes,created_at,updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
        [
          value.id,
          context.companyId,
          input.id,
          index + 1,
          value.productVariantId,
          value.quantity,
          value.unitOfMeasureCode,
          value.notes,
          context.timestamp,
        ],
      );
    const created = await this.lock(client, context.companyId, input.id);
    if (created === null) throw new Error('Transfer insertion returned no row.');
    return created;
  }

  public async find(
    companyId: string,
    branches: readonly string[],
    id: string,
  ): Promise<InventoryTransfer | null> {
    const row = result<TransferRow>(
      await this.database.pool.query(
        `select ${TRANSFER_COLUMNS} from inventory_transfers t
         where t.company_id=$1 and t.id=$2
         and (t.source_branch_id=any($3::uuid[]) or t.destination_branch_id=any($3::uuid[]))`,
        [companyId, id, branches],
      ),
    ).rows[0];
    return row === undefined
      ? null
      : transfer(row, await this.lines(this.database.pool, companyId, id));
  }

  public async lock(
    client: DraftSqlClient,
    companyId: string,
    id: string,
  ): Promise<InventoryTransfer | null> {
    const row = result<TransferRow>(
      await client.query(
        `select ${TRANSFER_COLUMNS} from inventory_transfers t
         where t.company_id=$1 and t.id=$2 for update`,
        [companyId, id],
      ),
    ).rows[0];
    return row === undefined ? null : transfer(row, await this.lines(client, companyId, id));
  }

  private async lines(
    client: Pick<DraftSqlClient, 'query'>,
    companyId: string,
    id: string,
  ): Promise<readonly InventoryTransferLine[]> {
    return result<LineRow>(
      await client.query(
        `select id,line_number,product_variant_id,requested_quantity::text,
         shipped_quantity::text,received_quantity::text,rejected_quantity::text,
         unit_of_measure_code,notes from inventory_transfer_lines
         where company_id=$1 and inventory_transfer_id=$2 order by line_number,id`,
        [companyId, id],
      ),
    ).rows.map(line);
  }

  public async list(
    companyId: string,
    branches: readonly string[],
    input: {
      limit: number;
      cursor?: string;
      status?: string;
      branchId?: string;
      variantId?: string;
      requestedFrom?: Date;
      requestedTo?: Date;
    },
  ): Promise<InventoryPage<InventoryTransfer>> {
    const values: unknown[] = [companyId, branches];
    const where = [
      't.company_id=$1',
      '(t.source_branch_id=any($2::uuid[]) or t.destination_branch_id=any($2::uuid[]))',
    ];
    const add = (sql: string, value: unknown): void => {
      values.push(value);
      where.push(sql.replace('?', `$${String(values.length)}`));
    };
    if (input.status !== undefined) add('t.status=?', input.status);
    if (input.branchId !== undefined) {
      values.push(input.branchId);
      where.push(
        `(t.source_branch_id=$${String(values.length)} or t.destination_branch_id=$${String(values.length)})`,
      );
    }
    if (input.variantId !== undefined) {
      values.push(input.variantId);
      where.push(
        `exists(select 1 from inventory_transfer_lines l where l.company_id=t.company_id
         and l.inventory_transfer_id=t.id and l.product_variant_id=$${String(values.length)})`,
      );
    }
    if (input.requestedFrom !== undefined) add('t.requested_at>=?', input.requestedFrom);
    if (input.requestedTo !== undefined) add('t.requested_at<=?', input.requestedTo);
    if (input.cursor !== undefined) {
      const decoded = Buffer.from(input.cursor, 'base64url').toString();
      const split = decoded.indexOf('|');
      if (split > 0) {
        values.push(new Date(decoded.slice(0, split)), decoded.slice(split + 1));
        where.push(
          `(t.requested_at,t.id)<($${String(values.length - 1)},$${String(values.length)}::uuid)`,
        );
      }
    }
    values.push(input.limit + 1);
    const rows = result<TransferRow>(
      await this.database.pool.query(
        `select ${TRANSFER_COLUMNS} from inventory_transfers t where ${where.join(' and ')}
         order by t.requested_at desc,t.id desc limit $${String(values.length)}`,
        values,
      ),
    ).rows;
    const selected = rows.slice(0, input.limit);
    const items = await Promise.all(
      selected.map(async (row) =>
        transfer(row, await this.lines(this.database.pool, companyId, row.id)),
      ),
    );
    const last = selected.at(-1);
    return {
      items,
      nextCursor:
        rows.length > input.limit && last !== undefined
          ? Buffer.from(`${new Date(last.requested_at).toISOString()}|${last.id}`).toString(
              'base64url',
            )
          : null,
    };
  }

  public async transition(
    client: DraftSqlClient,
    context: InventoryMutationContext,
    current: InventoryTransfer,
    input:
      | { status: 'approved' | 'rejected' | 'cancelled' }
      | { status: 'shipped'; movementId: string }
      | { status: 'received'; movementId: string },
  ): Promise<InventoryTransfer> {
    const actorColumn =
      input.status === 'approved'
        ? 'approved_by'
        : input.status === 'rejected'
          ? 'rejected_by'
          : input.status === 'shipped'
            ? 'shipped_by'
            : input.status === 'received'
              ? 'received_by'
              : 'cancelled_by';
    const timeColumn =
      input.status === 'approved'
        ? 'approved_at'
        : input.status === 'rejected'
          ? 'rejected_at'
          : input.status === 'shipped'
            ? 'shipped_at'
            : input.status === 'received'
              ? 'received_at'
              : 'cancelled_at';
    await client.query(
      `update inventory_transfers set status=$4,${timeColumn}=$3,${actorColumn}=$2,
       shipment_movement_id=case when $4='shipped' then $5::uuid else shipment_movement_id end,
       receipt_movement_id=case when $4='received' then $5::uuid else receipt_movement_id end,
       first_received_at=case when $4='received' then $3 else first_received_at end,
       version=version+1,updated_at=$3
       where company_id=$1 and id=$6`,
      [
        context.companyId,
        context.actorId,
        context.timestamp,
        input.status,
        'movementId' in input ? input.movementId : null,
        current.id,
      ],
    );
    if (input.status === 'shipped')
      await client.query(
        `update inventory_transfer_lines set shipped_quantity=requested_quantity,updated_at=$3
         where company_id=$1 and inventory_transfer_id=$2`,
        [context.companyId, current.id, context.timestamp],
      );
    if (input.status === 'received')
      await client.query(
        `update inventory_transfer_lines set received_quantity=shipped_quantity,
         rejected_quantity=0,updated_at=$3 where company_id=$1 and inventory_transfer_id=$2`,
        [context.companyId, current.id, context.timestamp],
      );
    const updated = await this.lock(client, context.companyId, current.id);
    if (updated === null) throw new Error('Transfer transition returned no row.');
    return updated;
  }

  public async insertMovement(
    client: DraftSqlClient,
    context: InventoryMutationContext,
    input: {
      id: string;
      movementNumber: string;
      type: 'transfer_shipment' | 'transfer_receipt';
      branchId: string;
      transfer: InventoryTransfer;
      note: string | null;
      sourceLocationId: string;
      destinationLocationId: string;
    },
  ): Promise<void> {
    await client.query(
      `insert into inventory_movements
       (id,company_id,branch_id,movement_number,movement_type,status,reference_type,
        reference_id,notes,occurred_at,posted_at,created_by,updated_by,posted_by,
        created_at,updated_at)
       values ($1,$2,$3,$4,$5,'posted','inventory_transfer',$6,$7,$8,$8,$9,$9,$9,$8,$8)`,
      [
        input.id,
        context.companyId,
        input.branchId,
        input.movementNumber,
        input.type,
        input.transfer.id,
        input.note,
        context.timestamp,
        context.actorId,
      ],
    );
    for (const value of input.transfer.lines)
      await client.query(
        `insert into inventory_movement_lines
         (id,company_id,inventory_movement_id,line_number,product_variant_id,
          source_location_id,destination_location_id,quantity,base_quantity,
          unit_of_measure_code,created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10)`,
        [
          randomUUID(),
          context.companyId,
          input.id,
          value.lineNumber,
          value.productVariantId,
          input.sourceLocationId,
          input.destinationLocationId,
          value.requestedQuantity,
          value.unitOfMeasureCode,
          context.timestamp,
        ],
      );
  }

  public lockBalances(
    client: DraftSqlClient,
    keys: readonly BalanceKey[],
  ): Promise<readonly LockedBalance[]> {
    return this.posting.lockBalances(client, keys);
  }

  public createInboundBalances(
    client: DraftSqlClient,
    keys: readonly BalanceKey[],
    movementId: string,
    timestamp: Date,
  ): Promise<void> {
    return this.posting.createInboundBalances(client, keys, movementId, timestamp);
  }

  public async updateTransferBalance(
    client: DraftSqlClient,
    input: {
      balance: LockedBalance;
      onHand: string;
      inTransit: string;
      movementId: string;
      timestamp: Date;
    },
  ): Promise<bigint> {
    const row = result<{ version: string }>(
      await client.query(
        `update inventory_balances set quantity_on_hand=$2,quantity_in_transit=$3,
         version=version+1,last_movement_id=$4,updated_at=$5
         where id=$1 returning version::text`,
        [input.balance.id, input.onHand, input.inTransit, input.movementId, input.timestamp],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Balance update returned no row.');
    return BigInt(row.version);
  }

  public idempotent<T extends Readonly<Record<string, unknown>>>(
    client: DraftSqlClient,
    context: InventoryMutationContext,
    operation: string,
    key: string,
    requestHash: string,
    status: number,
    execute: () => Promise<T>,
  ): Promise<{ value: T; replayed: boolean }> {
    return this.drafts.idempotent(
      client,
      context,
      operation,
      key,
      requestHash,
      status,
      execute,
      'inventory_transfer',
    );
  }

  public audit(
    client: DraftSqlClient,
    context: InventoryMutationContext,
    transferValue: InventoryTransfer,
    action: string,
    metadata: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    return client.query(
      `insert into audit_log
       (id,company_id,branch_id,actor_type,actor_id,action,entity_type,entity_id,
        request_id,correlation_id,metadata,occurred_at)
       values ($1,$2,$3,'user',$4,$5,'inventory_transfer',$6,$7,$8,$9::jsonb,$10)`,
      [
        randomUUID(),
        context.companyId,
        transferValue.sourceBranchId,
        context.actorId,
        action,
        transferValue.id,
        context.requestId,
        context.correlationId,
        JSON.stringify({
          transfer_id: transferValue.id,
          transfer_number: transferValue.transferNumber,
          source_branch_id: transferValue.sourceBranchId,
          destination_branch_id: transferValue.destinationBranchId,
          version: Number(transferValue.version),
          ...metadata,
        }),
        context.timestamp,
      ],
    );
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
    return this.posting.outbox(client, context, input);
  }
}
