import { randomUUID } from 'node:crypto';

import type { DatabaseClient } from '@asone/database';
import { createUuidV7 } from '@asone/database';

import type { DraftSqlClient } from './inventory-drafts.repository.js';
import { InventoryDraftRepository } from './inventory-drafts.repository.js';
import type { BalanceKey, LockedBalance } from './inventory-posting.repository.js';
import { InventoryPostingRepository } from './inventory-posting.repository.js';
import type {
  InventoryReservation,
  InventoryReservationLine,
  InventoryReservationOwnerType,
  InventoryReservationStatus,
} from './reservation.types.js';
import { InventoryReservationError } from './reservation.types.js';
import type { InventoryMutationContext, InventoryPage } from './inventory.types.js';

interface QueryResult<T> {
  rows: readonly T[];
}
interface ReservationRow {
  id: string;
  company_id: string;
  branch_id: string;
  reservation_number: string;
  owner_type: InventoryReservationOwnerType;
  owner_id: string;
  status: InventoryReservationStatus;
  expires_at: Date | string | null;
  confirmed_at: Date | string | null;
  released_at: Date | string | null;
  expired_at: Date | string | null;
  cancelled_at: Date | string | null;
  created_by: string;
  confirmed_by: string | null;
  released_by: string | null;
  expired_by: string | null;
  cancelled_by: string | null;
  version: string;
  created_at: Date | string;
  updated_at: Date | string;
  confirmation_movement_id: string | null;
}
interface LineRow {
  id: string;
  line_number: number;
  inventory_location_id: string;
  product_variant_id: string;
  reserved_quantity: string;
  consumed_quantity: string;
  released_quantity: string;
  unit_of_measure_code: string;
}
interface IdempotencyRow {
  request_hash: string;
  response_status: number | null;
  response_body: Readonly<Record<string, unknown>> | null;
}

const COLUMNS = `r.id,r.company_id,r.branch_id,r.reservation_number,r.owner_type,
 r.owner_id,r.status,r.expires_at,r.confirmed_at,r.released_at,r.expired_at,
 r.cancelled_at,r.created_by,r.confirmed_by,r.released_by,r.expired_by,
 r.cancelled_by,r.version::text,r.created_at,r.updated_at,
 (select m.id from inventory_movements m where m.company_id=r.company_id
  and m.reference_type='inventory_reservation' and m.reference_id=r.id
  and m.movement_type='issue' and m.status='posted' order by m.created_at,m.id limit 1)
  confirmation_movement_id`;

function result<T>(value: unknown): QueryResult<T> {
  return value as QueryResult<T>;
}
function nullableDate(value: Date | string | null): Date | null {
  return value === null ? null : new Date(value);
}
function line(row: LineRow): InventoryReservationLine {
  return {
    id: row.id,
    lineNumber: row.line_number,
    locationId: row.inventory_location_id,
    productVariantId: row.product_variant_id,
    reservedQuantity: row.reserved_quantity,
    consumedQuantity: row.consumed_quantity,
    releasedQuantity: row.released_quantity,
    unitOfMeasureCode: row.unit_of_measure_code,
  };
}
function reservation(
  row: ReservationRow,
  lines: readonly InventoryReservationLine[],
): InventoryReservation {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    reservationNumber: row.reservation_number,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    status: row.status,
    expiresAt: nullableDate(row.expires_at),
    confirmedAt: nullableDate(row.confirmed_at),
    releasedAt: nullableDate(row.released_at),
    expiredAt: nullableDate(row.expired_at),
    cancelledAt: nullableDate(row.cancelled_at),
    createdBy: row.created_by,
    confirmedBy: row.confirmed_by,
    releasedBy: row.released_by,
    expiredBy: row.expired_by,
    cancelledBy: row.cancelled_by,
    version: BigInt(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    confirmationMovementId: row.confirmation_movement_id,
    lines,
  };
}

export interface ReservationCommandResult {
  status: number;
  value: Readonly<Record<string, unknown>>;
  replayed: boolean;
}

export class InventoryReservationRepository {
  private readonly drafts: InventoryDraftRepository;
  private readonly posting: InventoryPostingRepository;

  public constructor(private readonly database: DatabaseClient) {
    this.drafts = new InventoryDraftRepository(database);
    this.posting = new InventoryPostingRepository(database);
  }

  public transaction<T>(callback: (client: DraftSqlClient) => Promise<T>): Promise<T> {
    return this.drafts.transaction(callback);
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

  public async location(
    client: DraftSqlClient,
    companyId: string,
    branchId: string,
    id: string,
  ): Promise<boolean> {
    const row = result<{ valid: boolean }>(
      await client.query(
        `select exists(select 1 from inventory_locations where company_id=$1 and branch_id=$2
         and id=$3 and status='active' and deleted_at is null and allows_issuing) valid`,
        [companyId, branchId, id],
      ),
    ).rows[0];
    return row?.valid ?? false;
  }

  public async insert(
    client: DraftSqlClient,
    context: InventoryMutationContext,
    input: {
      id: string;
      branchId: string;
      reservationNumber: string;
      ownerType: InventoryReservationOwnerType;
      ownerId: string;
      expiresAt: Date | null;
      lines: readonly {
        id: string;
        locationId: string;
        productVariantId: string;
        quantity: string;
        unitOfMeasureCode: string;
      }[];
    },
  ): Promise<InventoryReservation> {
    await client.query(
      `insert into inventory_reservations
       (id,company_id,branch_id,reservation_number,owner_type,owner_id,status,
        expires_at,created_by,created_at,updated_at)
       values ($1,$2,$3,$4,$5,$6,'active',$7,$8,$9,$9)`,
      [
        input.id,
        context.companyId,
        input.branchId,
        input.reservationNumber,
        input.ownerType,
        input.ownerId,
        input.expiresAt,
        context.actorId,
        context.timestamp,
      ],
    );
    for (const [index, value] of input.lines.entries())
      await client.query(
        `insert into inventory_reservation_lines
         (id,company_id,inventory_reservation_id,branch_id,inventory_location_id,
          line_number,product_variant_id,reserved_quantity,unit_of_measure_code,
          created_at,updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
        [
          value.id,
          context.companyId,
          input.id,
          input.branchId,
          value.locationId,
          index + 1,
          value.productVariantId,
          value.quantity,
          value.unitOfMeasureCode,
          context.timestamp,
        ],
      );
    const created = await this.lock(client, context.companyId, input.id);
    if (created === null) throw new Error('Reservation insertion returned no row.');
    return created;
  }

  public async find(
    companyId: string,
    branches: readonly string[],
    id: string,
  ): Promise<InventoryReservation | null> {
    const row = result<ReservationRow>(
      await this.database.pool.query(
        `select ${COLUMNS} from inventory_reservations r
         where r.company_id=$1 and r.id=$2 and r.branch_id=any($3::uuid[])`,
        [companyId, id, branches],
      ),
    ).rows[0];
    return row === undefined
      ? null
      : reservation(row, await this.lines(this.database.pool, companyId, id));
  }

  public async lock(
    client: DraftSqlClient,
    companyId: string,
    id: string,
  ): Promise<InventoryReservation | null> {
    const row = result<ReservationRow>(
      await client.query(
        `select ${COLUMNS} from inventory_reservations r
         where r.company_id=$1 and r.id=$2 for update`,
        [companyId, id],
      ),
    ).rows[0];
    return row === undefined ? null : reservation(row, await this.lines(client, companyId, id));
  }

  private async lines(
    client: Pick<DraftSqlClient, 'query'>,
    companyId: string,
    id: string,
  ): Promise<readonly InventoryReservationLine[]> {
    return result<LineRow>(
      await client.query(
        `select id,line_number,inventory_location_id,product_variant_id,
         reserved_quantity::text,consumed_quantity::text,released_quantity::text,
         unit_of_measure_code from inventory_reservation_lines
         where company_id=$1 and inventory_reservation_id=$2 order by line_number,id`,
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
      branchId?: string;
      status?: InventoryReservationStatus;
      ownerType?: InventoryReservationOwnerType;
      ownerId?: string;
      locationId?: string;
      variantId?: string;
      expiresBefore?: Date;
      createdFrom?: Date;
      createdTo?: Date;
    },
  ): Promise<InventoryPage<InventoryReservation>> {
    const values: unknown[] = [companyId, branches];
    const where = ['r.company_id=$1', 'r.branch_id=any($2::uuid[])'];
    const add = (sql: string, value: unknown): void => {
      values.push(value);
      where.push(sql.replace('?', `$${String(values.length)}`));
    };
    if (input.branchId !== undefined) add('r.branch_id=?', input.branchId);
    if (input.status !== undefined) add('r.status=?', input.status);
    if (input.ownerType !== undefined) add('r.owner_type=?', input.ownerType);
    if (input.ownerId !== undefined) add('r.owner_id=?', input.ownerId);
    if (input.expiresBefore !== undefined) add('r.expires_at<=?', input.expiresBefore);
    if (input.createdFrom !== undefined) add('r.created_at>=?', input.createdFrom);
    if (input.createdTo !== undefined) add('r.created_at<=?', input.createdTo);
    if (input.locationId !== undefined || input.variantId !== undefined) {
      const clauses = ['l.company_id=r.company_id', 'l.inventory_reservation_id=r.id'];
      if (input.locationId !== undefined) {
        values.push(input.locationId);
        clauses.push(`l.inventory_location_id=$${String(values.length)}`);
      }
      if (input.variantId !== undefined) {
        values.push(input.variantId);
        clauses.push(`l.product_variant_id=$${String(values.length)}`);
      }
      where.push(
        `exists(select 1 from inventory_reservation_lines l where ${clauses.join(' and ')})`,
      );
    }
    if (input.cursor !== undefined) {
      const decoded = Buffer.from(input.cursor, 'base64url').toString();
      const split = decoded.indexOf('|');
      if (split <= 0) throw new InventoryReservationError('validation_error', 'Cursor is invalid.');
      values.push(new Date(decoded.slice(0, split)), decoded.slice(split + 1));
      where.push(
        `(r.created_at,r.id)<($${String(values.length - 1)},$${String(values.length)}::uuid)`,
      );
    }
    values.push(input.limit + 1);
    const rows = result<ReservationRow>(
      await this.database.pool.query(
        `select ${COLUMNS} from inventory_reservations r where ${where.join(' and ')}
         order by r.created_at desc,r.id desc limit $${String(values.length)}`,
        values,
      ),
    ).rows;
    const selected = rows.slice(0, input.limit);
    const items = await Promise.all(
      selected.map(async (row) =>
        reservation(row, await this.lines(this.database.pool, companyId, row.id)),
      ),
    );
    const last = selected.at(-1);
    return {
      items,
      nextCursor:
        rows.length > input.limit && last !== undefined
          ? Buffer.from(`${new Date(last.created_at).toISOString()}|${last.id}`).toString(
              'base64url',
            )
          : null,
    };
  }

  public lockBalances(
    client: DraftSqlClient,
    keys: readonly BalanceKey[],
  ): Promise<readonly LockedBalance[]> {
    return this.posting.lockBalances(client, keys);
  }

  public async updateBalance(
    client: DraftSqlClient,
    input: {
      balance: LockedBalance;
      onHand: string;
      reserved: string;
      movementId: string | null;
      timestamp: Date;
    },
  ): Promise<bigint> {
    const row = result<{ version: string }>(
      await client.query(
        `update inventory_balances set quantity_on_hand=$2,quantity_reserved=$3,
         version=version+1,last_movement_id=coalesce($4::uuid,last_movement_id),updated_at=$5
         where id=$1 returning version::text`,
        [input.balance.id, input.onHand, input.reserved, input.movementId, input.timestamp],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Reservation balance update returned no row.');
    return BigInt(row.version);
  }

  public async transition(
    client: DraftSqlClient,
    context: InventoryMutationContext,
    current: InventoryReservation,
    status: Exclude<InventoryReservationStatus, 'active'>,
  ): Promise<InventoryReservation> {
    const actorColumn =
      status === 'confirmed'
        ? 'confirmed_by'
        : status === 'released'
          ? 'released_by'
          : status === 'expired'
            ? 'expired_by'
            : 'cancelled_by';
    const timeColumn =
      status === 'confirmed'
        ? 'confirmed_at'
        : status === 'released'
          ? 'released_at'
          : status === 'expired'
            ? 'expired_at'
            : 'cancelled_at';
    await client.query(
      `update inventory_reservations set status=$4,${actorColumn}=$2,${timeColumn}=$3,
       version=version+1,updated_at=$3 where company_id=$1 and id=$5`,
      [context.companyId, context.actorId, context.timestamp, status, current.id],
    );
    await client.query(
      status === 'confirmed'
        ? `update inventory_reservation_lines set consumed_quantity=reserved_quantity,
           updated_at=$3 where company_id=$1 and inventory_reservation_id=$2`
        : `update inventory_reservation_lines set released_quantity=reserved_quantity-consumed_quantity,
           updated_at=$3 where company_id=$1 and inventory_reservation_id=$2`,
      [context.companyId, current.id, context.timestamp],
    );
    const updated = await this.lock(client, context.companyId, current.id);
    if (updated === null) throw new Error('Reservation transition returned no row.');
    return updated;
  }

  public async insertIssueMovement(
    client: DraftSqlClient,
    context: InventoryMutationContext,
    reservationValue: InventoryReservation,
    movementId: string,
    movementNumber: string,
  ): Promise<void> {
    await client.query(
      `insert into inventory_movements
       (id,company_id,branch_id,movement_number,movement_type,status,reference_type,
        reference_id,occurred_at,posted_at,created_by,updated_by,posted_by,created_at,updated_at)
       values ($1,$2,$3,$4,'issue','posted','inventory_reservation',$5,$6,$6,$7,$7,$7,$6,$6)`,
      [
        movementId,
        context.companyId,
        reservationValue.branchId,
        movementNumber,
        reservationValue.id,
        context.timestamp,
        context.actorId,
      ],
    );
    for (const value of reservationValue.lines)
      await client.query(
        `insert into inventory_movement_lines
         (id,company_id,inventory_movement_id,line_number,product_variant_id,
          source_location_id,quantity,base_quantity,unit_of_measure_code,created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9)`,
        [
          createUuidV7(),
          context.companyId,
          movementId,
          value.lineNumber,
          value.productVariantId,
          value.locationId,
          value.reservedQuantity,
          value.unitOfMeasureCode,
          context.timestamp,
        ],
      );
  }

  public async idempotent(
    client: DraftSqlClient,
    context: InventoryMutationContext,
    operation: string,
    key: string,
    requestHash: string,
    execute: () => Promise<{ status: number; value: Readonly<Record<string, unknown>> }>,
  ): Promise<ReservationCommandResult> {
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
      if (
        existing.request_hash !== requestHash ||
        existing.response_body === null ||
        existing.response_status === null
      )
        throw new InventoryReservationError(
          'idempotency_conflict',
          'The idempotency key conflicts.',
        );
      return { status: existing.response_status, value: existing.response_body, replayed: true };
    }
    const id = createUuidV7();
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
    const outcome = await execute();
    await client.query(
      `update idempotency_keys set response_status=$2,response_body=$3::jsonb,
       resource_type='inventory_reservation',resource_id=$4::uuid,completed_at=$5 where id=$1`,
      [
        id,
        outcome.status,
        JSON.stringify(outcome.value),
        outcome.value.id ?? null,
        context.timestamp,
      ],
    );
    return { ...outcome, replayed: false };
  }

  public audit(
    client: DraftSqlClient,
    context: InventoryMutationContext,
    value: InventoryReservation,
    action: string,
    metadata: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    return client.query(
      `insert into audit_log
       (id,company_id,branch_id,actor_type,actor_id,action,entity_type,entity_id,
        request_id,correlation_id,metadata,occurred_at)
       values ($1,$2,$3,'user',$4,$5,'inventory_reservation',$6,$7,$8,$9::jsonb,$10)`,
      [
        randomUUID(),
        context.companyId,
        value.branchId,
        context.actorId,
        action,
        value.id,
        context.requestId,
        context.correlationId,
        JSON.stringify({
          reservation_id: value.id,
          owner_type: value.ownerType,
          owner_id: value.ownerId,
          version: Number(value.version),
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
