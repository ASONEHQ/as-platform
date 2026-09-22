import { randomUUID } from 'node:crypto';

import type { DatabaseClient } from '@asone/database';

import {
  PartyError,
  type PartyAccountStatus,
  type PartyDocumentType,
  type PartyMutationContext,
  type PartyPackageRow,
  type PartyPackageStatus,
  type PartyReservationDocumentRow,
  type PartyReservationPaymentPurpose,
  type PartyReservationPaymentRow,
  type PartyReservationRow,
  type PartyReservationSnackRow,
  type PartyReservationSockRow,
  type PartyReservationStatus,
  type PartyRoomRow,
  type PartyRoomStatus,
  type PartySockDeductionStatus,
} from './parties.types.js';

/** Structurally identical to `CashTransaction`/`SaleConsumptionTransaction`
 * on purpose (see those modules' own doc comments) — a real transaction
 * client from any module satisfies this, so `party-sock-deduction.ts` can
 * take whichever transaction client this repository hands it with no
 * adapter. */
export interface PartyTransaction {
  query(sql: string, values?: readonly unknown[]): Promise<unknown>;
}

interface QueryResult<T> {
  rows: T[];
}
function result<T>(value: unknown): QueryResult<T> {
  return value as QueryResult<T>;
}
function constraint(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'constraint' in error
    ? String((error as { constraint?: unknown }).constraint)
    : undefined;
}
function jsonValue(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}
/** `date`-typed columns (`event_date`) round-trip through `node-postgres`
 * as a native `Date` at UTC midnight by default (despite this repository's
 * own row types declaring `string`, matching this codebase's established
 * convention for date-only columns — see `customers.repository.ts`'s own
 * `birth_date: string`) — normalized here to the exact `YYYY-MM-DD` the
 * column actually stores, never re-derived through a timezone-sensitive
 * `.toISOString()` on the full Date. */
function dateOnly(value: Date | string): string {
  if (typeof value === 'string') return value;
  const year = value.getUTCFullYear().toString().padStart(4, '0');
  const month = (value.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = value.getUTCDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const ROOM_COLUMNS =
  'id,company_id,branch_id,code,name,status,capacity_children,capacity_adults,capacity_total,color,notes,created_by,updated_by,version,created_at,updated_at';
const PACKAGE_COLUMNS =
  'id,company_id,branch_id,code,name,description,status,price,currency_code,duration_minutes,children_included,adults_included,child_extra_cost,adult_extra_cost,capacity_max,extra_half_hour_cost,tax_code,includes,restrictions,created_by,updated_by,version,created_at,updated_at';
const RESERVATION_COLUMNS =
  'id,company_id,branch_id,reservation_number,customer_id,customer_display_name,customer_phone,celebrant_name,celebrant_age,room_id,package_id,room_name_snapshot,package_name_snapshot,event_date,start_time,end_time,children_count,adults_count,seller_user_id,status,account_status,subtotal_amount,discount_total,tax_total,quoted_total,currency_code,notes,cancelled_at,cancelled_by,cancellation_reason,created_by,updated_by,version,created_at,updated_at';
const SNACK_COLUMNS =
  'id,company_id,reservation_id,product_id,name_snapshot,unit_price_snapshot,quantity,line_total,tax_snapshot,tax_total,created_at';
const SOCK_COLUMNS =
  'id,company_id,reservation_id,size,quantity,product_variant_id,stock_deducted,stock_deducted_at,created_at';
const PAYMENT_COLUMNS =
  'id,company_id,branch_id,reservation_id,cash_movement_id,purpose,amount_snapshot,created_by,created_at';
const DOCUMENT_COLUMNS = 'id,company_id,reservation_id,document_type,generated_by,created_at';

interface RoomDb {
  id: string;
  company_id: string;
  branch_id: string;
  code: string;
  name: string;
  status: string;
  capacity_children: number | null;
  capacity_adults: number | null;
  capacity_total: number | null;
  color: string | null;
  notes: string | null;
  created_by: string;
  updated_by: string;
  version: string;
  created_at: Date | string;
  updated_at: Date | string;
}
interface PackageDb {
  id: string;
  company_id: string;
  branch_id: string | null;
  code: string;
  name: string;
  description: string | null;
  status: string;
  price: string;
  currency_code: string;
  duration_minutes: number;
  children_included: number;
  adults_included: number;
  child_extra_cost: string;
  adult_extra_cost: string;
  capacity_max: number | null;
  extra_half_hour_cost: string;
  tax_code: string;
  includes: Readonly<Record<string, unknown>> | null;
  restrictions: Readonly<Record<string, unknown>> | null;
  created_by: string;
  updated_by: string;
  version: string;
  created_at: Date | string;
  updated_at: Date | string;
}
interface ReservationDb {
  id: string;
  company_id: string;
  branch_id: string;
  reservation_number: string;
  customer_id: string | null;
  customer_display_name: string | null;
  customer_phone: string | null;
  celebrant_name: string | null;
  celebrant_age: number | null;
  room_id: string;
  package_id: string;
  room_name_snapshot: string | null;
  package_name_snapshot: string | null;
  event_date: Date | string;
  start_time: string;
  end_time: string;
  children_count: number;
  adults_count: number;
  seller_user_id: string | null;
  status: string;
  account_status: string;
  subtotal_amount: string | null;
  discount_total: string;
  tax_total: string;
  quoted_total: string;
  currency_code: string;
  notes: string | null;
  cancelled_at: Date | string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  created_by: string;
  updated_by: string;
  version: string;
  created_at: Date | string;
  updated_at: Date | string;
}
interface SnackDb {
  id: string;
  company_id: string;
  reservation_id: string;
  product_id: string | null;
  name_snapshot: string;
  unit_price_snapshot: string;
  quantity: string;
  line_total: string;
  tax_snapshot: Readonly<Record<string, unknown>> | null;
  tax_total: string;
  created_at: Date | string;
}
interface SockDb {
  id: string;
  company_id: string;
  reservation_id: string;
  size: string;
  quantity: number;
  product_variant_id: string | null;
  stock_deducted: string;
  stock_deducted_at: Date | string | null;
  created_at: Date | string;
}
interface PaymentDb {
  id: string;
  company_id: string;
  branch_id: string;
  reservation_id: string;
  cash_movement_id: string;
  purpose: string;
  amount_snapshot: string;
  created_by: string;
  created_at: Date | string;
}
interface DocumentDb {
  id: string;
  company_id: string;
  reservation_id: string;
  document_type: string;
  generated_by: string;
  created_at: Date | string;
}
interface IdempotencyDb {
  request_hash: string;
  response_body: unknown;
}

function room(row: RoomDb): PartyRoomRow {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    code: row.code,
    name: row.name,
    status: row.status as PartyRoomStatus,
    capacityChildren: row.capacity_children,
    capacityAdults: row.capacity_adults,
    capacityTotal: row.capacity_total,
    color: row.color,
    notes: row.notes,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    version: BigInt(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
function packageRow(row: PackageDb): PartyPackageRow {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    code: row.code,
    name: row.name,
    description: row.description,
    status: row.status as PartyPackageStatus,
    price: row.price,
    currencyCode: row.currency_code,
    durationMinutes: row.duration_minutes,
    childrenIncluded: row.children_included,
    adultsIncluded: row.adults_included,
    childExtraCost: row.child_extra_cost,
    adultExtraCost: row.adult_extra_cost,
    capacityMax: row.capacity_max,
    extraHalfHourCost: row.extra_half_hour_cost,
    taxCode: row.tax_code as PartyPackageRow['taxCode'],
    includes: row.includes,
    restrictions: row.restrictions,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    version: BigInt(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
function reservation(row: ReservationDb): PartyReservationRow {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    reservationNumber: row.reservation_number,
    customerId: row.customer_id,
    customerDisplayName: row.customer_display_name,
    customerPhone: row.customer_phone,
    celebrantName: row.celebrant_name,
    celebrantAge: row.celebrant_age,
    roomId: row.room_id,
    packageId: row.package_id,
    roomNameSnapshot: row.room_name_snapshot,
    packageNameSnapshot: row.package_name_snapshot,
    eventDate: dateOnly(row.event_date),
    startTime: row.start_time,
    endTime: row.end_time,
    childrenCount: row.children_count,
    adultsCount: row.adults_count,
    sellerUserId: row.seller_user_id,
    status: row.status as PartyReservationStatus,
    accountStatus: row.account_status as PartyAccountStatus,
    subtotalAmount: row.subtotal_amount,
    discountTotal: row.discount_total,
    taxTotal: row.tax_total,
    quotedTotal: row.quoted_total,
    currencyCode: row.currency_code,
    notes: row.notes,
    cancelledAt: row.cancelled_at === null ? null : new Date(row.cancelled_at),
    cancelledBy: row.cancelled_by,
    cancellationReason: row.cancellation_reason,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    version: BigInt(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
function snack(row: SnackDb): PartyReservationSnackRow {
  return {
    id: row.id,
    companyId: row.company_id,
    reservationId: row.reservation_id,
    productId: row.product_id,
    nameSnapshot: row.name_snapshot,
    unitPriceSnapshot: row.unit_price_snapshot,
    quantity: row.quantity,
    lineTotal: row.line_total,
    taxSnapshot: row.tax_snapshot,
    taxTotal: row.tax_total,
    createdAt: new Date(row.created_at),
  };
}
function sock(row: SockDb): PartyReservationSockRow {
  return {
    id: row.id,
    companyId: row.company_id,
    reservationId: row.reservation_id,
    size: row.size,
    quantity: row.quantity,
    productVariantId: row.product_variant_id,
    stockDeducted: row.stock_deducted as PartySockDeductionStatus,
    stockDeductedAt: row.stock_deducted_at === null ? null : new Date(row.stock_deducted_at),
    createdAt: new Date(row.created_at),
  };
}
function payment(row: PaymentDb): PartyReservationPaymentRow {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    reservationId: row.reservation_id,
    cashMovementId: row.cash_movement_id,
    purpose: row.purpose as PartyReservationPaymentPurpose,
    amountSnapshot: row.amount_snapshot,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
  };
}
function documentRow(row: DocumentDb): PartyReservationDocumentRow {
  return {
    id: row.id,
    companyId: row.company_id,
    reservationId: row.reservation_id,
    documentType: row.document_type as PartyDocumentType,
    generatedBy: row.generated_by,
    generatedAt: new Date(row.created_at),
  };
}

export interface ReservationListFilter {
  limit: number;
  cursor?: string;
  branchId?: string;
  status?: PartyReservationStatus;
  roomId?: string;
  customerId?: string;
  sellerUserId?: string;
  eventDateFrom?: string;
  eventDateTo?: string;
}

export class PartiesRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async transaction<T>(callback: (client: PartyTransaction) => Promise<T>): Promise<T> {
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      const value = await callback(client);
      await client.query('commit');
      return value;
    } catch (error) {
      await client.query('rollback');
      throw this.mapDatabaseError(error);
    } finally {
      client.release();
    }
  }

  public async idempotent<T>(
    client: PartyTransaction,
    context: PartyMutationContext,
    operation: string,
    key: string,
    requestHash: string,
    resourceType: string,
    decode: (value: unknown) => T,
    create: () => Promise<T & { id: string }>,
  ): Promise<{ value: T; replayed: boolean }> {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
      `${context.companyId}:${operation}:${key}`,
    ]);
    const existing = result<IdempotencyDb>(
      await client.query(
        `select request_hash,response_body from idempotency_keys
         where company_id=$1 and operation=$2 and key=$3`,
        [context.companyId, operation, key],
      ),
    ).rows[0];
    if (existing !== undefined) {
      if (existing.request_hash !== requestHash || existing.response_body === null)
        throw new PartyError('idempotency_conflict', 'The idempotency key was used with another request.');
      return { value: decode(existing.response_body), replayed: true };
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
        operation,
        requestHash,
        new Date(context.timestamp.getTime() + 86_400_000),
        context.timestamp,
      ],
    );
    const value = await create();
    await client.query(
      `update idempotency_keys set response_status=201,response_body=$2::jsonb,
       resource_type=$3,resource_id=$4,completed_at=$5 where id=$1`,
      [id, JSON.stringify(value, jsonValue), resourceType, value.id, context.timestamp],
    );
    return { value, replayed: false };
  }

  public async auditAndPublish(
    client: PartyTransaction,
    context: PartyMutationContext,
    input: {
      action: string;
      resourceType: string;
      resourceId: string;
      eventType: string;
      branchId: string | null;
      version: bigint;
      payload: Readonly<Record<string, unknown>>;
    },
  ): Promise<void> {
    await this.audit(client, context, {
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      payload: input.payload,
    });
    await client.query(
      `insert into outbox_events
       (event_id,company_id,branch_id,event_type,schema_version,aggregate_type,aggregate_id,aggregate_version,
        correlation_id,payload,occurred_at,available_at,created_at)
       values ($1,$2,$3,$4,1,$5,$6,$7,$8,$9::jsonb,$10,$10,$10)`,
      [
        randomUUID(),
        context.companyId,
        input.branchId,
        input.eventType,
        input.resourceType,
        input.resourceId,
        input.version.toString(),
        context.correlationId,
        JSON.stringify(input.payload),
        context.timestamp,
      ],
    );
  }

  public async audit(
    client: PartyTransaction,
    context: PartyMutationContext,
    input: { action: string; resourceType: string; resourceId: string; payload: Readonly<Record<string, unknown>> },
  ): Promise<void> {
    await client.query(
      `insert into audit_log
       (id,company_id,actor_type,actor_id,action,entity_type,entity_id,request_id,correlation_id,metadata,occurred_at)
       values ($1,$2,'user',$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
      [
        randomUUID(),
        context.companyId,
        context.actorId,
        input.action,
        input.resourceType,
        input.resourceId,
        context.requestId,
        context.correlationId,
        JSON.stringify(input.payload),
        context.timestamp,
      ],
    );
  }

  // --- Rooms ---------------------------------------------------------------

  public async insertRoom(
    client: PartyTransaction,
    input: {
      id: string;
      companyId: string;
      branchId: string;
      code: string;
      name: string;
      capacityChildren: number | null;
      capacityAdults: number | null;
      capacityTotal: number | null;
      color: string | null;
      notes: string | null;
      actorId: string;
      timestamp: Date;
    },
  ): Promise<PartyRoomRow> {
    const row = result<RoomDb>(
      await client.query(
        `insert into party_rooms
         (id,company_id,branch_id,code,name,status,capacity_children,capacity_adults,capacity_total,color,notes,
          created_by,updated_by,created_at,updated_at)
         values ($1,$2,$3,$4,$5,'active',$6,$7,$8,$9,$10,$11,$11,$12,$12)
         returning ${ROOM_COLUMNS}`,
        [
          input.id,
          input.companyId,
          input.branchId,
          input.code,
          input.name,
          input.capacityChildren,
          input.capacityAdults,
          input.capacityTotal,
          input.color,
          input.notes,
          input.actorId,
          input.timestamp,
        ],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Room insertion did not return a row.');
    return room(row);
  }

  public async room(companyId: string, id: string): Promise<PartyRoomRow | null> {
    const row = result<RoomDb>(
      await this.database.pool.query(`select ${ROOM_COLUMNS} from party_rooms where company_id=$1 and id=$2`, [
        companyId,
        id,
      ]),
    ).rows[0];
    return row === undefined ? null : room(row);
  }

  /** Locks the target room row `FOR UPDATE` so every concurrent create/edit
   * against the SAME room serializes on this row — see
   * `packages/database/drizzle/0024_vengeful_metal_master.sql`'s own tail comment:
   * this turns a would-be race into a clean, ordered critical section (the
   * plain overlap `SELECT` that follows, inside the same transaction, is
   * therefore race-free), never a substitute for the real, database-
   * enforced `party_reservations_room_time_excl` GIST exclusion
   * constraint, which remains the actual last-line guarantee. */
  public async lockRoom(client: PartyTransaction, companyId: string, id: string): Promise<PartyRoomRow | null> {
    const row = result<RoomDb>(
      await client.query(`select ${ROOM_COLUMNS} from party_rooms where company_id=$1 and id=$2 for update`, [
        companyId,
        id,
      ]),
    ).rows[0];
    return row === undefined ? null : room(row);
  }

  public async listRooms(
    companyId: string,
    branchIds: readonly string[],
    input: { limit: number; cursor?: string; branchId?: string; status?: string },
  ): Promise<{ items: PartyRoomRow[]; nextCursor: string | null }> {
    const values: unknown[] = [companyId, branchIds];
    const where = ['company_id=$1', 'branch_id=any($2::uuid[])'];
    if (input.branchId !== undefined) {
      values.push(input.branchId);
      where.push(`branch_id=$${String(values.length)}`);
    }
    if (input.status !== undefined) {
      values.push(input.status);
      where.push(`status=$${String(values.length)}`);
    }
    if (input.cursor !== undefined) {
      values.push(input.cursor);
      where.push(`id>$${String(values.length)}`);
    }
    values.push(input.limit + 1);
    const rows = result<RoomDb>(
      await this.database.pool.query(
        `select ${ROOM_COLUMNS} from party_rooms where ${where.join(' and ')} order by id asc limit $${String(values.length)}`,
        values,
      ),
    ).rows;
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit).map(room);
    return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
  }

  public async updateRoom(
    client: PartyTransaction,
    companyId: string,
    id: string,
    expectedVersion: bigint,
    input: {
      status?: PartyRoomStatus;
      capacityChildren?: number | null;
      capacityAdults?: number | null;
      capacityTotal?: number | null;
      color?: string | null;
      notes?: string | null;
      updatedBy: string;
      timestamp: Date;
    },
  ): Promise<PartyRoomRow> {
    const sets: string[] = ['updated_by=$3', 'updated_at=$4', 'version=version+1'];
    const values: unknown[] = [companyId, id, input.updatedBy, input.timestamp];
    function set(column: string, value: unknown): void {
      values.push(value);
      sets.push(`${column}=$${String(values.length)}`);
    }
    if (input.status !== undefined) set('status', input.status);
    if (input.capacityChildren !== undefined) set('capacity_children', input.capacityChildren);
    if (input.capacityAdults !== undefined) set('capacity_adults', input.capacityAdults);
    if (input.capacityTotal !== undefined) set('capacity_total', input.capacityTotal);
    if (input.color !== undefined) set('color', input.color);
    if (input.notes !== undefined) set('notes', input.notes);
    values.push(expectedVersion.toString());
    const row = result<RoomDb>(
      await client.query(
        `update party_rooms set ${sets.join(',')} where company_id=$1 and id=$2 and version=$${String(values.length)}
         returning ${ROOM_COLUMNS}`,
        values,
      ),
    ).rows[0];
    if (row === undefined) throw new PartyError('version_conflict', 'The room version changed.');
    return room(row);
  }

  // --- Packages --------------------------------------------------------------

  public async insertPackage(
    client: PartyTransaction,
    input: {
      id: string;
      companyId: string;
      branchId: string | null;
      code: string;
      name: string;
      description: string | null;
      price: string;
      currencyCode: string;
      durationMinutes: number;
      childrenIncluded: number;
      adultsIncluded: number;
      childExtraCost: string;
      adultExtraCost: string;
      capacityMax: number | null;
      extraHalfHourCost: string;
      taxCode: string;
      includes: Readonly<Record<string, unknown>> | null;
      restrictions: Readonly<Record<string, unknown>> | null;
      actorId: string;
      timestamp: Date;
    },
  ): Promise<PartyPackageRow> {
    const row = result<PackageDb>(
      await client.query(
        `insert into party_packages
         (id,company_id,branch_id,code,name,description,status,price,currency_code,duration_minutes,
          children_included,adults_included,child_extra_cost,adult_extra_cost,capacity_max,extra_half_hour_cost,
          tax_code,includes,restrictions,created_by,updated_by,created_at,updated_at)
         values ($1,$2,$3,$4,$5,$6,'active',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18::jsonb,$19,$19,$20,$20)
         returning ${PACKAGE_COLUMNS}`,
        [
          input.id,
          input.companyId,
          input.branchId,
          input.code,
          input.name,
          input.description,
          input.price,
          input.currencyCode,
          input.durationMinutes,
          input.childrenIncluded,
          input.adultsIncluded,
          input.childExtraCost,
          input.adultExtraCost,
          input.capacityMax,
          input.extraHalfHourCost,
          input.taxCode,
          input.includes === null ? null : JSON.stringify(input.includes),
          input.restrictions === null ? null : JSON.stringify(input.restrictions),
          input.actorId,
          input.timestamp,
        ],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Package insertion did not return a row.');
    return packageRow(row);
  }

  public async packageRow(companyId: string, id: string): Promise<PartyPackageRow | null> {
    const row = result<PackageDb>(
      await this.database.pool.query(`select ${PACKAGE_COLUMNS} from party_packages where company_id=$1 and id=$2`, [
        companyId,
        id,
      ]),
    ).rows[0];
    return row === undefined ? null : packageRow(row);
  }

  public async listPackages(
    companyId: string,
    input: { limit: number; cursor?: string; branchId?: string; status?: string },
  ): Promise<{ items: PartyPackageRow[]; nextCursor: string | null }> {
    const values: unknown[] = [companyId];
    const where = ['company_id=$1'];
    if (input.branchId !== undefined) {
      values.push(input.branchId);
      where.push(`(branch_id=$${String(values.length)} or branch_id is null)`);
    }
    if (input.status !== undefined) {
      values.push(input.status);
      where.push(`status=$${String(values.length)}`);
    }
    if (input.cursor !== undefined) {
      values.push(input.cursor);
      where.push(`id>$${String(values.length)}`);
    }
    values.push(input.limit + 1);
    const rows = result<PackageDb>(
      await this.database.pool.query(
        `select ${PACKAGE_COLUMNS} from party_packages where ${where.join(' and ')} order by id asc limit $${String(values.length)}`,
        values,
      ),
    ).rows;
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit).map(packageRow);
    return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
  }

  public async updatePackage(
    client: PartyTransaction,
    companyId: string,
    id: string,
    expectedVersion: bigint,
    input: {
      name?: string;
      description?: string | null;
      status?: PartyPackageStatus;
      price?: string;
      durationMinutes?: number;
      childrenIncluded?: number;
      adultsIncluded?: number;
      childExtraCost?: string;
      adultExtraCost?: string;
      capacityMax?: number | null;
      extraHalfHourCost?: string;
      taxCode?: string;
      includes?: Readonly<Record<string, unknown>> | null;
      restrictions?: Readonly<Record<string, unknown>> | null;
      updatedBy: string;
      timestamp: Date;
    },
  ): Promise<PartyPackageRow> {
    const sets: string[] = ['updated_by=$3', 'updated_at=$4', 'version=version+1'];
    const values: unknown[] = [companyId, id, input.updatedBy, input.timestamp];
    function set(column: string, value: unknown): void {
      values.push(value);
      sets.push(`${column}=$${String(values.length)}`);
    }
    function setJson(column: string, value: Readonly<Record<string, unknown>> | null): void {
      values.push(value === null ? null : JSON.stringify(value));
      sets.push(`${column}=$${String(values.length)}::jsonb`);
    }
    if (input.name !== undefined) set('name', input.name);
    if (input.description !== undefined) set('description', input.description);
    if (input.status !== undefined) set('status', input.status);
    if (input.price !== undefined) set('price', input.price);
    if (input.durationMinutes !== undefined) set('duration_minutes', input.durationMinutes);
    if (input.childrenIncluded !== undefined) set('children_included', input.childrenIncluded);
    if (input.adultsIncluded !== undefined) set('adults_included', input.adultsIncluded);
    if (input.childExtraCost !== undefined) set('child_extra_cost', input.childExtraCost);
    if (input.adultExtraCost !== undefined) set('adult_extra_cost', input.adultExtraCost);
    if (input.capacityMax !== undefined) set('capacity_max', input.capacityMax);
    if (input.extraHalfHourCost !== undefined) set('extra_half_hour_cost', input.extraHalfHourCost);
    if (input.taxCode !== undefined) set('tax_code', input.taxCode);
    if (input.includes !== undefined) setJson('includes', input.includes);
    if (input.restrictions !== undefined) setJson('restrictions', input.restrictions);
    values.push(expectedVersion.toString());
    const row = result<PackageDb>(
      await client.query(
        `update party_packages set ${sets.join(',')} where company_id=$1 and id=$2 and version=$${String(values.length)}
         returning ${PACKAGE_COLUMNS}`,
        values,
      ),
    ).rows[0];
    if (row === undefined) throw new PartyError('version_conflict', 'The package version changed.');
    return packageRow(row);
  }

  // --- Reservations ------------------------------------------------------------

  public async insertReservation(
    client: PartyTransaction,
    input: {
      id: string;
      companyId: string;
      branchId: string;
      reservationNumber: string;
      customerId: string | null;
      customerDisplayName: string | null;
      customerPhone: string | null;
      celebrantName: string | null;
      celebrantAge: number | null;
      roomId: string;
      packageId: string;
      roomNameSnapshot: string;
      packageNameSnapshot: string;
      eventDate: string;
      startTime: string;
      endTime: string;
      childrenCount: number;
      adultsCount: number;
      sellerUserId: string | null;
      subtotalAmount: string;
      discountTotal: string;
      taxTotal: string;
      quotedTotal: string;
      currencyCode: string;
      notes: string | null;
      actorId: string;
      timestamp: Date;
    },
  ): Promise<PartyReservationRow> {
    const row = result<ReservationDb>(
      await client.query(
        `insert into party_reservations
         (id,company_id,branch_id,reservation_number,customer_id,customer_display_name,customer_phone,
          celebrant_name,celebrant_age,room_id,package_id,room_name_snapshot,package_name_snapshot,
          event_date,start_time,end_time,children_count,adults_count,
          seller_user_id,status,account_status,subtotal_amount,discount_total,tax_total,quoted_total,
          currency_code,notes,created_by,updated_by,created_at,updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'held','open',$20,$21,$22,$23,$24,$25,$26,$26,$27,$27)
         returning ${RESERVATION_COLUMNS}`,
        [
          input.id,
          input.companyId,
          input.branchId,
          input.reservationNumber,
          input.customerId,
          input.customerDisplayName,
          input.customerPhone,
          input.celebrantName,
          input.celebrantAge,
          input.roomId,
          input.packageId,
          input.roomNameSnapshot,
          input.packageNameSnapshot,
          input.eventDate,
          input.startTime,
          input.endTime,
          input.childrenCount,
          input.adultsCount,
          input.sellerUserId,
          input.subtotalAmount,
          input.discountTotal,
          input.taxTotal,
          input.quotedTotal,
          input.currencyCode,
          input.notes,
          input.actorId,
          input.timestamp,
        ],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Reservation insertion did not return a row.');
    return reservation(row);
  }

  public async reservation(companyId: string, id: string): Promise<PartyReservationRow | null> {
    const row = result<ReservationDb>(
      await this.database.pool.query(
        `select ${RESERVATION_COLUMNS} from party_reservations where company_id=$1 and id=$2`,
        [companyId, id],
      ),
    ).rows[0];
    return row === undefined ? null : reservation(row);
  }

  public async lockReservation(
    client: PartyTransaction,
    companyId: string,
    id: string,
  ): Promise<PartyReservationRow | null> {
    const row = result<ReservationDb>(
      await client.query(
        `select ${RESERVATION_COLUMNS} from party_reservations where company_id=$1 and id=$2 for update`,
        [companyId, id],
      ),
    ).rows[0];
    return row === undefined ? null : reservation(row);
  }

  /** Every ACTIVE (`status<>'cancelled'`) reservation for [roomId] whose
   * time range overlaps [startTime,endTime) on [eventDate] — the plain,
   * half-open interval overlap `start_time < :end and :start < end_time`,
   * the exact semantics of the database's own
   * `party_reservations_room_time_excl` GIST exclusion constraint (see
   * that migration's own tail comment). Only race-free because the
   * caller has already taken `lockRoom` `FOR UPDATE` on the same room
   * first, inside the same transaction. */
  public async overlappingReservations(
    client: PartyTransaction,
    companyId: string,
    roomId: string,
    eventDate: string,
    startTime: string,
    endTime: string,
    excludeId?: string,
  ): Promise<readonly PartyReservationRow[]> {
    const values: unknown[] = [companyId, roomId, eventDate, endTime, startTime];
    let where =
      'company_id=$1 and room_id=$2 and event_date=$3 and status<>\'cancelled\' and start_time<$4 and $5<end_time';
    if (excludeId !== undefined) {
      values.push(excludeId);
      where += ` and id<>$${String(values.length)}`;
    }
    const rows = result<ReservationDb>(
      await client.query(`select ${RESERVATION_COLUMNS} from party_reservations where ${where}`, values),
    ).rows;
    return rows.map(reservation);
  }

  public async listReservations(
    companyId: string,
    branchIds: readonly string[],
    input: ReservationListFilter,
  ): Promise<{ items: PartyReservationRow[]; nextCursor: string | null }> {
    const values: unknown[] = [companyId, branchIds];
    const where = ['company_id=$1', 'branch_id=any($2::uuid[])'];
    if (input.branchId !== undefined) {
      values.push(input.branchId);
      where.push(`branch_id=$${String(values.length)}`);
    }
    if (input.status !== undefined) {
      values.push(input.status);
      where.push(`status=$${String(values.length)}`);
    }
    if (input.roomId !== undefined) {
      values.push(input.roomId);
      where.push(`room_id=$${String(values.length)}`);
    }
    if (input.customerId !== undefined) {
      values.push(input.customerId);
      where.push(`customer_id=$${String(values.length)}`);
    }
    if (input.sellerUserId !== undefined) {
      values.push(input.sellerUserId);
      where.push(`seller_user_id=$${String(values.length)}`);
    }
    if (input.eventDateFrom !== undefined) {
      values.push(input.eventDateFrom);
      where.push(`event_date>=$${String(values.length)}`);
    }
    if (input.eventDateTo !== undefined) {
      values.push(input.eventDateTo);
      where.push(`event_date<=$${String(values.length)}`);
    }
    if (input.cursor !== undefined) {
      const decoded = decodePartyReservationCursor(input.cursor);
      values.push(decoded.eventDate, decoded.startTime, decoded.id);
      where.push(
        `(event_date,start_time,id)>($${String(values.length - 2)},$${String(values.length - 1)},$${String(values.length)})`,
      );
    }
    values.push(input.limit + 1);
    const rows = result<ReservationDb>(
      await this.database.pool.query(
        `select ${RESERVATION_COLUMNS} from party_reservations where ${where.join(' and ')}
         order by event_date asc, start_time asc, id asc limit $${String(values.length)}`,
        values,
      ),
    ).rows;
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit).map(reservation);
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last !== undefined ? encodePartyReservationCursor(last.eventDate, last.startTime, last.id) : null,
    };
  }

  public async updateReservation(
    client: PartyTransaction,
    companyId: string,
    id: string,
    expectedVersion: bigint,
    input: {
      customerId?: string | null;
      customerDisplayName?: string | null;
      customerPhone?: string | null;
      celebrantName?: string | null;
      celebrantAge?: number | null;
      roomId?: string;
      packageId?: string;
      roomNameSnapshot?: string;
      packageNameSnapshot?: string;
      eventDate?: string;
      startTime?: string;
      endTime?: string;
      childrenCount?: number;
      adultsCount?: number;
      sellerUserId?: string | null;
      subtotalAmount?: string;
      discountTotal?: string;
      taxTotal?: string;
      quotedTotal?: string;
      notes?: string | null;
      updatedBy: string;
      timestamp: Date;
    },
  ): Promise<PartyReservationRow> {
    const sets: string[] = ['updated_by=$3', 'updated_at=$4', 'version=version+1'];
    const values: unknown[] = [companyId, id, input.updatedBy, input.timestamp];
    function set(column: string, value: unknown): void {
      values.push(value);
      sets.push(`${column}=$${String(values.length)}`);
    }
    if (input.customerId !== undefined) set('customer_id', input.customerId);
    if (input.customerDisplayName !== undefined) set('customer_display_name', input.customerDisplayName);
    if (input.customerPhone !== undefined) set('customer_phone', input.customerPhone);
    if (input.celebrantName !== undefined) set('celebrant_name', input.celebrantName);
    if (input.celebrantAge !== undefined) set('celebrant_age', input.celebrantAge);
    if (input.roomId !== undefined) set('room_id', input.roomId);
    if (input.packageId !== undefined) set('package_id', input.packageId);
    if (input.roomNameSnapshot !== undefined) set('room_name_snapshot', input.roomNameSnapshot);
    if (input.packageNameSnapshot !== undefined) set('package_name_snapshot', input.packageNameSnapshot);
    if (input.eventDate !== undefined) set('event_date', input.eventDate);
    if (input.startTime !== undefined) set('start_time', input.startTime);
    if (input.endTime !== undefined) set('end_time', input.endTime);
    if (input.childrenCount !== undefined) set('children_count', input.childrenCount);
    if (input.adultsCount !== undefined) set('adults_count', input.adultsCount);
    if (input.sellerUserId !== undefined) set('seller_user_id', input.sellerUserId);
    if (input.subtotalAmount !== undefined) set('subtotal_amount', input.subtotalAmount);
    if (input.discountTotal !== undefined) set('discount_total', input.discountTotal);
    if (input.taxTotal !== undefined) set('tax_total', input.taxTotal);
    if (input.quotedTotal !== undefined) set('quoted_total', input.quotedTotal);
    if (input.notes !== undefined) set('notes', input.notes);
    values.push(expectedVersion.toString());
    const row = result<ReservationDb>(
      await client.query(
        `update party_reservations set ${sets.join(',')} where company_id=$1 and id=$2 and version=$${String(values.length)}
         returning ${RESERVATION_COLUMNS}`,
        values,
      ),
    ).rows[0];
    if (row === undefined) throw new PartyError('version_conflict', 'The reservation version changed.');
    return reservation(row);
  }

  public async transitionStatus(
    client: PartyTransaction,
    companyId: string,
    id: string,
    expectedVersion: bigint,
    status: PartyReservationStatus,
    input: { updatedBy: string; timestamp: Date },
  ): Promise<PartyReservationRow> {
    const row = result<ReservationDb>(
      await client.query(
        `update party_reservations set status=$3,updated_by=$4,updated_at=$5,version=version+1
         where company_id=$1 and id=$2 and version=$6
         returning ${RESERVATION_COLUMNS}`,
        [companyId, id, status, input.updatedBy, input.timestamp, expectedVersion.toString()],
      ),
    ).rows[0];
    if (row === undefined) throw new PartyError('version_conflict', 'The reservation version changed.');
    return reservation(row);
  }

  public async cancelReservation(
    client: PartyTransaction,
    companyId: string,
    id: string,
    expectedVersion: bigint,
    input: { cancelledBy: string; cancelledAt: Date; cancellationReason: string; timestamp: Date },
  ): Promise<PartyReservationRow> {
    const row = result<ReservationDb>(
      await client.query(
        `update party_reservations set
           status='cancelled', cancelled_at=$3, cancelled_by=$4, cancellation_reason=$5,
           updated_by=$4, updated_at=$6, version=version+1
         where company_id=$1 and id=$2 and version=$7
         returning ${RESERVATION_COLUMNS}`,
        [companyId, id, input.cancelledAt, input.cancelledBy, input.cancellationReason, input.timestamp, expectedVersion.toString()],
      ),
    ).rows[0];
    if (row === undefined) throw new PartyError('version_conflict', 'The reservation version changed.');
    return reservation(row);
  }

  // --- Snacks ------------------------------------------------------------------

  public async insertSnack(
    client: PartyTransaction,
    input: {
      id: string;
      companyId: string;
      reservationId: string;
      productId: string | null;
      nameSnapshot: string;
      unitPriceSnapshot: string;
      quantity: string;
      lineTotal: string;
      taxSnapshot: Readonly<Record<string, unknown>> | null;
      taxTotal: string;
      timestamp: Date;
    },
  ): Promise<PartyReservationSnackRow> {
    const row = result<SnackDb>(
      await client.query(
        `insert into party_reservation_snacks
         (id,company_id,reservation_id,product_id,name_snapshot,unit_price_snapshot,quantity,line_total,
          tax_snapshot,tax_total,created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)
         returning ${SNACK_COLUMNS}`,
        [
          input.id,
          input.companyId,
          input.reservationId,
          input.productId,
          input.nameSnapshot,
          input.unitPriceSnapshot,
          input.quantity,
          input.lineTotal,
          input.taxSnapshot === null ? null : JSON.stringify(input.taxSnapshot),
          input.taxTotal,
          input.timestamp,
        ],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Snack insertion did not return a row.');
    return snack(row);
  }

  public async listSnacks(companyId: string, reservationId: string): Promise<readonly PartyReservationSnackRow[]> {
    const rows = result<SnackDb>(
      await this.database.pool.query(
        `select ${SNACK_COLUMNS} from party_reservation_snacks where company_id=$1 and reservation_id=$2 order by created_at asc, id asc`,
        [companyId, reservationId],
      ),
    ).rows;
    return rows.map(snack);
  }

  // --- Socks -------------------------------------------------------------------

  public async insertSock(
    client: PartyTransaction,
    input: {
      id: string;
      companyId: string;
      reservationId: string;
      size: string;
      quantity: number;
      productVariantId: string | null;
      timestamp: Date;
    },
  ): Promise<PartyReservationSockRow> {
    const row = result<SockDb>(
      await client.query(
        `insert into party_reservation_socks
         (id,company_id,reservation_id,size,quantity,product_variant_id,stock_deducted,created_at)
         values ($1,$2,$3,$4,$5,$6,'pending',$7)
         returning ${SOCK_COLUMNS}`,
        [input.id, input.companyId, input.reservationId, input.size, input.quantity, input.productVariantId, input.timestamp],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Sock insertion did not return a row.');
    return sock(row);
  }

  public async listSocks(companyId: string, reservationId: string): Promise<readonly PartyReservationSockRow[]> {
    const rows = result<SockDb>(
      await this.database.pool.query(
        `select ${SOCK_COLUMNS} from party_reservation_socks where company_id=$1 and reservation_id=$2 order by created_at asc, id asc`,
        [companyId, reservationId],
      ),
    ).rows;
    return rows.map(sock);
  }

  public async lockSock(
    client: PartyTransaction,
    companyId: string,
    reservationId: string,
    id: string,
  ): Promise<PartyReservationSockRow | null> {
    const row = result<SockDb>(
      await client.query(
        `select ${SOCK_COLUMNS} from party_reservation_socks
         where company_id=$1 and reservation_id=$2 and id=$3 for update`,
        [companyId, reservationId, id],
      ),
    ).rows[0];
    return row === undefined ? null : sock(row);
  }

  public async markSockDeducted(client: PartyTransaction, companyId: string, id: string, timestamp: Date): Promise<PartyReservationSockRow> {
    const row = result<SockDb>(
      await client.query(
        `update party_reservation_socks set stock_deducted='deducted', stock_deducted_at=$3
         where company_id=$1 and id=$2 returning ${SOCK_COLUMNS}`,
        [companyId, id, timestamp],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Sock update did not return a row.');
    return sock(row);
  }

  // --- Payments ------------------------------------------------------------------

  public async insertPayment(
    client: PartyTransaction,
    input: {
      id: string;
      companyId: string;
      branchId: string;
      reservationId: string;
      cashMovementId: string;
      purpose: PartyReservationPaymentPurpose;
      amountSnapshot: string;
      createdBy: string;
      timestamp: Date;
    },
  ): Promise<PartyReservationPaymentRow> {
    const row = result<PaymentDb>(
      await client.query(
        `insert into party_reservation_payments
         (id,company_id,branch_id,reservation_id,cash_movement_id,purpose,amount_snapshot,created_by,created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         returning ${PAYMENT_COLUMNS}`,
        [
          input.id,
          input.companyId,
          input.branchId,
          input.reservationId,
          input.cashMovementId,
          input.purpose,
          input.amountSnapshot,
          input.createdBy,
          input.timestamp,
        ],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Payment insertion did not return a row.');
    return payment(row);
  }

  public async paymentsForReservation(companyId: string, reservationId: string): Promise<readonly PartyReservationPaymentRow[]> {
    const rows = result<PaymentDb>(
      await this.database.pool.query(
        `select ${PAYMENT_COLUMNS} from party_reservation_payments where company_id=$1 and reservation_id=$2 order by created_at asc, id asc`,
        [companyId, reservationId],
      ),
    ).rows;
    return rows.map(payment);
  }

  // --- Documents -----------------------------------------------------------------

  public async insertDocumentAudit(
    client: PartyTransaction,
    input: { id: string; companyId: string; reservationId: string; documentType: PartyDocumentType; generatedBy: string; timestamp: Date },
  ): Promise<PartyReservationDocumentRow> {
    const row = result<DocumentDb>(
      await client.query(
        `insert into party_reservation_documents (id,company_id,reservation_id,document_type,generated_by,created_at)
         values ($1,$2,$3,$4,$5,$6)
         returning ${DOCUMENT_COLUMNS}`,
        [input.id, input.companyId, input.reservationId, input.documentType, input.generatedBy, input.timestamp],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Document audit insertion did not return a row.');
    return documentRow(row);
  }

  public async documentsSummary(
    companyId: string,
    reservationId: string,
  ): Promise<{ count: number; lastGeneratedAt: Date | null; lastDocumentType: string | null }> {
    const row = result<{ count: string; last_generated_at: Date | string | null; last_document_type: string | null }>(
      await this.database.pool.query(
        `select count(*)::text as count,
                max(created_at) as last_generated_at,
                (array_agg(document_type order by created_at desc))[1] as last_document_type
         from party_reservation_documents where company_id=$1 and reservation_id=$2`,
        [companyId, reservationId],
      ),
    ).rows[0];
    if (row === undefined || row.count === '0')
      return { count: 0, lastGeneratedAt: null, lastDocumentType: null };
    return {
      count: Number(row.count),
      lastGeneratedAt: row.last_generated_at === null ? null : new Date(row.last_generated_at),
      lastDocumentType: row.last_document_type,
    };
  }

  // --- Cross-domain read-only lookups ---------------------------------------------

  public async customerForSnapshot(
    companyId: string,
    customerId: string,
  ): Promise<{ displayName: string; phone: string | null } | null> {
    const row = result<{ display_name: string; phone: string | null }>(
      await this.database.pool.query(`select display_name,phone from customers where company_id=$1 and id=$2`, [
        companyId,
        customerId,
      ]),
    ).rows[0];
    return row === undefined ? null : { displayName: row.display_name, phone: row.phone };
  }

  public async productForSnapshot(
    companyId: string,
    productId: string,
  ): Promise<{ name: string; price: string; taxCode: string } | null> {
    const row = result<{ name: string; amount: string | null; tax_code: string }>(
      await this.database.pool.query(
        `select p.name, pp.amount, p.tax_code
         from products p
         left join product_prices pp on pp.company_id=p.company_id and pp.product_id=p.id and pp.status='active'
         where p.company_id=$1 and p.id=$2`,
        [companyId, productId],
      ),
    ).rows[0];
    if (row === undefined) return null;
    return { name: row.name, price: row.amount ?? '0.0000', taxCode: row.tax_code };
  }

  public async organizationForReservation(
    companyId: string,
    reservationId: string,
  ): Promise<{ companyName: string; branchName: string; branchAddress: Readonly<Record<string, unknown>> | null } | null> {
    const row = result<{
      company_name: string;
      branch_name: string;
      branch_address: Readonly<Record<string, unknown>> | null;
    }>(
      await this.database.pool.query(
        `select c.display_name as company_name, b.name as branch_name, b.address as branch_address
         from party_reservations r
         join companies c on c.id = r.company_id
         join branches b on b.company_id = r.company_id and b.id = r.branch_id
         where r.company_id = $1 and r.id = $2`,
        [companyId, reservationId],
      ),
    ).rows[0];
    if (row === undefined) return null;
    return { companyName: row.company_name, branchName: row.branch_name, branchAddress: row.branch_address };
  }

  private mapDatabaseError(error: unknown): unknown {
    switch (constraint(error)) {
      case 'party_reservations_room_time_excl':
        return new PartyError(
          'party_conflict',
          'This room is already booked for an overlapping time on this date.',
        );
      case 'party_rooms_company_branch_code_uq':
        return new PartyError('validation_error', 'This room code was already used.');
      case 'party_packages_company_code_uq':
        return new PartyError('validation_error', 'This package code was already used.');
      case 'party_reservations_company_number_uq':
        return new PartyError('validation_error', 'This reservation number was already used.');
      default:
        return error;
    }
  }
}

/** Same opaque `(event_date, start_time, id)` cursor shape as
 * `encodeCashCursor` (see `cash.repository.ts`), reused for the same
 * "chronological, newest-key-tiebreak" list need. */
export function encodePartyReservationCursor(eventDate: string, startTime: string, id: string): string {
  return Buffer.from(JSON.stringify([eventDate, startTime, id]), 'utf8').toString('base64url');
}
export function decodePartyReservationCursor(cursor: string): { eventDate: string; startTime: string; id: string } {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 3 ||
      typeof decoded[0] !== 'string' ||
      typeof decoded[1] !== 'string' ||
      typeof decoded[2] !== 'string'
    )
      throw new Error('malformed');
    return { eventDate: decoded[0], startTime: decoded[1], id: decoded[2] };
  } catch {
    throw new PartyError('validation_error', 'The cursor is invalid.');
  }
}
