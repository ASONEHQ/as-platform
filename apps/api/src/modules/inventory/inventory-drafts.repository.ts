import { randomUUID } from 'node:crypto';

import type { DatabaseClient } from '@asone/database';

import type { InventoryMutationContext, InventoryPage } from './inventory.types.js';
import type {
  DraftMovement,
  DraftMovementLine,
  DraftMovementType,
} from './inventory-drafts.types.js';
import { InventoryDraftError } from './inventory-drafts.types.js';

export interface DraftSqlClient {
  query(sql: string, values?: readonly unknown[]): Promise<unknown>;
}
interface QueryResult<T> {
  rows: readonly T[];
  rowCount: number | null;
}
interface MovementRow {
  id: string;
  company_id: string;
  branch_id: string;
  movement_number: string;
  movement_type: DraftMovementType;
  status: string;
  reason_code: string | null;
  reference_type: string | null;
  reference_id: string | null;
  source_document_number: string | null;
  notes: string | null;
  version: string;
  occurred_at: Date | string;
  posted_at: Date | string | null;
  cancelled_at: Date | string | null;
  reversed_at: Date | string | null;
  reversal_of_movement_id: string | null;
  reversed_by_movement_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  line_count: string;
}
interface LineRow {
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
}
interface IdempotencyRow {
  request_hash: string;
  response_status: number | null;
  response_body: Readonly<Record<string, unknown>> | null;
}

const MOVEMENT_COLUMNS = `m.id,m.company_id,m.branch_id,m.movement_number,m.movement_type,m.status,
 m.reason_code,m.reference_type,m.reference_id,m.source_document_number,m.notes,m.version::text,
 m.occurred_at,m.posted_at,m.cancelled_at,m.reversed_at,m.reversal_of_movement_id,
 m.reversed_by_movement_id,m.created_at,m.updated_at,
 (select count(*)::text from inventory_movement_lines l
  where l.company_id=m.company_id and l.inventory_movement_id=m.id) line_count`;
const LINE_COLUMNS = `id,inventory_movement_id,line_number,product_variant_id,
 source_location_id,destination_location_id,quantity::text,base_quantity::text,
 unit_of_measure_code,unit_cost::text,extended_cost::text,currency_code,reason_code,metadata,created_at`;

function result<T>(value: unknown): QueryResult<T> {
  return value as QueryResult<T>;
}
function movement(row: MovementRow): DraftMovement {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    movementNumber: row.movement_number,
    movementType: row.movement_type,
    status: row.status,
    reasonCode: row.reason_code,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    sourceDocumentNumber: row.source_document_number,
    notes: row.notes,
    version: BigInt(row.version),
    occurredAt: new Date(row.occurred_at),
    postedAt: row.posted_at === null ? null : new Date(row.posted_at),
    cancelledAt: row.cancelled_at === null ? null : new Date(row.cancelled_at),
    reversedAt: row.reversed_at === null ? null : new Date(row.reversed_at),
    reversalOfMovementId: row.reversal_of_movement_id,
    reversedByMovementId: row.reversed_by_movement_id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    lineCount: Number(row.line_count),
  };
}
function line(row: LineRow): DraftMovementLine {
  return {
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
  };
}
function constraint(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'constraint' in error
    ? String((error as { constraint?: unknown }).constraint)
    : undefined;
}
function requiredMovement(value: DraftMovement | null): DraftMovement {
  if (value === null) throw new Error('Movement write returned no row.');
  return value;
}

export class InventoryDraftRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async transaction<T>(callback: (client: DraftSqlClient) => Promise<T>): Promise<T> {
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      const value = await callback(client);
      await client.query('commit');
      return value;
    } catch (error) {
      await client.query('rollback');
      throw this.mapError(error);
    } finally {
      client.release();
    }
  }

  public async branchExists(
    client: DraftSqlClient,
    companyId: string,
    branchId: string,
  ): Promise<boolean> {
    return (
      result<{ exists: boolean }>(
        await client.query(
          `select exists(select 1 from branches where company_id=$1 and id=$2 and status='active') exists`,
          [companyId, branchId],
        ),
      ).rows[0]?.exists ?? false
    );
  }

  public async find(
    companyId: string,
    branchIds: readonly string[],
    id: string,
  ): Promise<DraftMovement | null> {
    const row = result<MovementRow>(
      await this.database.pool.query(
        `select ${MOVEMENT_COLUMNS} from inventory_movements m
         where m.company_id=$1 and m.branch_id=any($2::uuid[]) and m.id=$3`,
        [companyId, branchIds, id],
      ),
    ).rows[0];
    return row === undefined ? null : movement(row);
  }

  public async lock(
    client: DraftSqlClient,
    companyId: string,
    branchIds: readonly string[],
    id: string,
  ): Promise<DraftMovement | null> {
    const locked = result<{ id: string }>(
      await client.query(
        `select id from inventory_movements
         where company_id=$1 and branch_id=any($2::uuid[]) and id=$3 for update`,
        [companyId, branchIds, id],
      ),
    ).rows[0];
    if (locked === undefined) return null;
    const row = result<MovementRow>(
      await client.query(`select ${MOVEMENT_COLUMNS} from inventory_movements m where m.id=$1`, [
        id,
      ]),
    ).rows[0];
    return row === undefined ? null : movement(row);
  }

  public async insert(
    client: DraftSqlClient,
    context: InventoryMutationContext,
    input: {
      id: string;
      movementNumber: string;
      branchId: string;
      movementType: DraftMovementType;
      occurredAt: Date;
      reasonCode: string | null;
      referenceType: string | null;
      referenceId: string | null;
      sourceDocumentNumber: string | null;
      notes: string | null;
    },
  ): Promise<DraftMovement> {
    await client.query(
      `insert into inventory_movements
       (id,company_id,branch_id,movement_number,movement_type,status,reason_code,
        reference_type,reference_id,source_document_number,notes,occurred_at,
        created_by,updated_by,created_at,updated_at)
       values ($1,$2,$3,$4,$5,'draft',$6,$7,$8,$9,$10,$11,$12,$12,$13,$13)`,
      [
        input.id,
        context.companyId,
        input.branchId,
        input.movementNumber,
        input.movementType,
        input.reasonCode,
        input.referenceType,
        input.referenceId,
        input.sourceDocumentNumber,
        input.notes,
        input.occurredAt,
        context.actorId,
        context.timestamp,
      ],
    );
    return requiredMovement(await this.lock(client, context.companyId, [input.branchId], input.id));
  }

  public async updateHeader(
    client: DraftSqlClient,
    context: InventoryMutationContext,
    current: DraftMovement,
    input: {
      branchId: string;
      movementType: DraftMovementType;
      occurredAt: Date;
      reasonCode: string | null;
      referenceType: string | null;
      referenceId: string | null;
      sourceDocumentNumber: string | null;
      notes: string | null;
    },
  ): Promise<DraftMovement> {
    await client.query(
      `update inventory_movements set branch_id=$3,movement_type=$4,occurred_at=$5,
       reason_code=$6,reference_type=$7,reference_id=$8,source_document_number=$9,notes=$10,
       updated_by=$11,updated_at=$12,version=version+1 where company_id=$1 and id=$2`,
      [
        context.companyId,
        current.id,
        input.branchId,
        input.movementType,
        input.occurredAt,
        input.reasonCode,
        input.referenceType,
        input.referenceId,
        input.sourceDocumentNumber,
        input.notes,
        context.actorId,
        context.timestamp,
      ],
    );
    return requiredMovement(
      await this.lock(client, context.companyId, [input.branchId], current.id),
    );
  }

  public async cancel(
    client: DraftSqlClient,
    context: InventoryMutationContext,
    current: DraftMovement,
  ): Promise<DraftMovement> {
    await client.query(
      `update inventory_movements set status='cancelled',cancelled_at=$3,cancelled_by=$4,
       updated_by=$4,updated_at=$3,version=version+1 where company_id=$1 and id=$2`,
      [context.companyId, current.id, context.timestamp, context.actorId],
    );
    return requiredMovement(
      await this.lock(client, context.companyId, [current.branchId], current.id),
    );
  }

  public async lines(
    companyId: string,
    movementId: string,
    input: { limit: number; cursor?: string },
  ): Promise<InventoryPage<DraftMovementLine>> {
    const values: unknown[] = [companyId, movementId];
    let cursor = '';
    if (input.cursor !== undefined) {
      const [lineNumber, id] = Buffer.from(input.cursor, 'base64url').toString().split(':');
      values.push(Number(lineNumber), id);
      cursor = `and (line_number,id)>($3,$4::uuid)`;
    }
    values.push(input.limit + 1);
    const rows = result<LineRow>(
      await this.database.pool.query(
        `select ${LINE_COLUMNS} from inventory_movement_lines
         where company_id=$1 and inventory_movement_id=$2 ${cursor}
         order by line_number,id limit $${String(values.length)}`,
        values,
      ),
    ).rows;
    const items = rows.slice(0, input.limit).map(line);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > input.limit && last !== undefined
          ? Buffer.from(`${String(last.lineNumber)}:${last.id}`).toString('base64url')
          : null,
    };
  }

  public async variant(
    client: DraftSqlClient,
    companyId: string,
    id: string,
  ): Promise<{ unit: string; quantityScale: number } | null> {
    return (
      result<{ unit: string; quantityScale: number }>(
        await client.query(
          `select unit_of_measure_code unit,quantity_scale "quantityScale" from product_variants
           where company_id=$1 and id=$2 and status='active' and deleted_at is null`,
          [companyId, id],
        ),
      ).rows[0] ?? null
    );
  }

  public async location(
    client: DraftSqlClient,
    companyId: string,
    branchId: string,
    id: string,
  ): Promise<{ receiving: boolean; issuing: boolean } | null> {
    return (
      result<{ receiving: boolean; issuing: boolean }>(
        await client.query(
          `select allows_receiving receiving,allows_issuing issuing from inventory_locations
           where company_id=$1 and branch_id=$2 and id=$3 and status='active' and deleted_at is null`,
          [companyId, branchId, id],
        ),
      ).rows[0] ?? null
    );
  }

  public async line(
    client: DraftSqlClient,
    companyId: string,
    movementId: string,
    id: string,
  ): Promise<DraftMovementLine | null> {
    const row = result<LineRow>(
      await client.query(
        `select ${LINE_COLUMNS} from inventory_movement_lines
         where company_id=$1 and inventory_movement_id=$2 and id=$3`,
        [companyId, movementId, id],
      ),
    ).rows[0];
    return row === undefined ? null : line(row);
  }

  public async duplicateLine(
    client: DraftSqlClient,
    companyId: string,
    movementId: string,
    input: {
      productVariantId: string;
      sourceLocationId: string | null;
      destinationLocationId: string | null;
      excludeId?: string;
    },
  ): Promise<boolean> {
    return (
      result<{ exists: boolean }>(
        await client.query(
          `select exists(select 1 from inventory_movement_lines
           where company_id=$1 and inventory_movement_id=$2 and product_variant_id=$3
           and source_location_id is not distinct from $4::uuid
           and destination_location_id is not distinct from $5::uuid
           and ($6::uuid is null or id<>$6)) exists`,
          [
            companyId,
            movementId,
            input.productVariantId,
            input.sourceLocationId,
            input.destinationLocationId,
            input.excludeId ?? null,
          ],
        ),
      ).rows[0]?.exists ?? false
    );
  }

  public async insertLine(
    client: DraftSqlClient,
    companyId: string,
    input: Omit<
      DraftMovementLine,
      'baseQuantity' | 'lineNumber' | 'createdAt' | 'unitCost' | 'extendedCost' | 'currencyCode'
    > & {
      createdAt: Date;
    },
  ): Promise<DraftMovementLine> {
    const row = result<LineRow>(
      await client.query(
        `insert into inventory_movement_lines
         (id,company_id,inventory_movement_id,line_number,product_variant_id,
          source_location_id,destination_location_id,quantity,base_quantity,
          unit_of_measure_code,reason_code,metadata,created_at)
         select $1,$2,$3,coalesce(max(line_number),0)+1,$4,$5,$6,$7,$7,$8,$9,$10::jsonb,$11
         from inventory_movement_lines where company_id=$2 and inventory_movement_id=$3
         returning ${LINE_COLUMNS}`,
        [
          input.id,
          companyId,
          input.movementId,
          input.productVariantId,
          input.sourceLocationId,
          input.destinationLocationId,
          input.quantity,
          input.unitOfMeasureCode,
          input.reasonCode,
          input.metadata === null ? null : JSON.stringify(input.metadata),
          input.createdAt,
        ],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Movement line insertion returned no row.');
    return line(row);
  }

  public async updateLine(
    client: DraftSqlClient,
    companyId: string,
    input: DraftMovementLine,
  ): Promise<DraftMovementLine> {
    const row = result<LineRow>(
      await client.query(
        `update inventory_movement_lines set product_variant_id=$4,source_location_id=$5,
         destination_location_id=$6,quantity=$7,base_quantity=$7,unit_of_measure_code=$8,
         reason_code=$9,metadata=$10::jsonb
         where company_id=$1 and inventory_movement_id=$2 and id=$3 returning ${LINE_COLUMNS}`,
        [
          companyId,
          input.movementId,
          input.id,
          input.productVariantId,
          input.sourceLocationId,
          input.destinationLocationId,
          input.quantity,
          input.unitOfMeasureCode,
          input.reasonCode,
          input.metadata === null ? null : JSON.stringify(input.metadata),
        ],
      ),
    ).rows[0];
    if (row === undefined)
      throw new InventoryDraftError('inventory_movement_line_not_found', 'The line was not found.');
    return line(row);
  }

  public deleteLine(
    client: DraftSqlClient,
    companyId: string,
    movementId: string,
    id: string,
  ): Promise<unknown> {
    return client.query(
      `delete from inventory_movement_lines where company_id=$1 and inventory_movement_id=$2 and id=$3`,
      [companyId, movementId, id],
    );
  }

  public async bump(
    client: DraftSqlClient,
    context: InventoryMutationContext,
    movementId: string,
  ): Promise<DraftMovement> {
    await client.query(
      `update inventory_movements set version=version+1,updated_by=$3,updated_at=$4
       where company_id=$1 and id=$2`,
      [context.companyId, movementId, context.actorId, context.timestamp],
    );
    return requiredMovement(await this.movementInCompany(client, context.companyId, movementId));
  }

  private async movementInCompany(
    client: DraftSqlClient,
    companyId: string,
    id: string,
  ): Promise<DraftMovement | null> {
    const row = result<MovementRow>(
      await client.query(
        `select ${MOVEMENT_COLUMNS} from inventory_movements m where m.company_id=$1 and m.id=$2`,
        [companyId, id],
      ),
    ).rows[0];
    return row === undefined ? null : movement(row);
  }

  public async idempotent<T extends Readonly<Record<string, unknown>>>(
    client: DraftSqlClient,
    context: InventoryMutationContext,
    operation: string,
    key: string,
    requestHash: string,
    status: number,
    execute: () => Promise<T>,
    resourceType = 'inventory_movement',
  ): Promise<{ value: T; replayed: boolean }> {
    const scopedOperation = `${operation}:${context.actorId}`;
    await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
      `${context.companyId}:${scopedOperation}:${key}`,
    ]);
    const existing = result<IdempotencyRow>(
      await client.query(
        `select request_hash,response_status,response_body from idempotency_keys
         where company_id=$1 and operation=$2 and key=$3`,
        [context.companyId, scopedOperation, key],
      ),
    ).rows[0];
    if (existing !== undefined) {
      if (existing.request_hash !== requestHash || existing.response_body === null)
        throw new InventoryDraftError('idempotency_conflict', 'The idempotency key conflicts.');
      return { value: existing.response_body as T, replayed: true };
    }
    const id = randomUUID();
    await client.query(
      `insert into idempotency_keys
       (id,company_id,key,operation,request_hash,expires_at,created_at)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        id,
        context.companyId,
        key,
        scopedOperation,
        requestHash,
        new Date(context.timestamp.getTime() + 86_400_000),
        context.timestamp,
      ],
    );
    const value = await execute();
    const resourceId = typeof value.id === 'string' ? value.id : null;
    await client.query(
      `update idempotency_keys set response_status=$2,response_body=$3::jsonb,
       resource_type=$6,resource_id=$4,completed_at=$5 where id=$1`,
      [id, status, JSON.stringify(value), resourceId, context.timestamp, resourceType],
    );
    return { value, replayed: false };
  }

  public audit(
    client: DraftSqlClient,
    context: InventoryMutationContext,
    input: {
      action: string;
      movement: DraftMovement;
      lineId?: string;
      metadata?: Readonly<Record<string, unknown>>;
    },
  ): Promise<unknown> {
    return client.query(
      `insert into audit_log
       (id,company_id,branch_id,actor_type,actor_id,action,entity_type,entity_id,
        request_id,correlation_id,metadata,occurred_at)
       values ($1,$2,$3,'user',$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`,
      [
        randomUUID(),
        context.companyId,
        input.movement.branchId,
        context.actorId,
        input.action,
        input.lineId === undefined ? 'inventory_movement' : 'inventory_movement_line',
        input.lineId ?? input.movement.id,
        context.requestId,
        context.correlationId,
        JSON.stringify({
          movement_id: input.movement.id,
          version: Number(input.movement.version),
          ...input.metadata,
        }),
        context.timestamp,
      ],
    );
  }

  private mapError(error: unknown): unknown {
    if (constraint(error) === 'inventory_movement_lines_company_movement_line_uq')
      return new InventoryDraftError('duplicate_movement_line', 'The movement line conflicts.');
    return error;
  }
}
