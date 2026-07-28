import { randomUUID } from 'node:crypto';

import type { DatabaseClient } from '@asone/database';

import type {
  InventoryLocation,
  InventoryMutationContext,
  InventoryPage,
  LocationStatus,
  LocationType,
} from './inventory.types.js';
import { InventoryApplicationError } from './inventory.types.js';

export interface InventorySqlClient {
  query(sql: string, values?: readonly unknown[]): Promise<unknown>;
}
interface QueryResult<T> {
  rows: readonly T[];
  rowCount: number | null;
}
interface LocationRow {
  id: string;
  company_id: string;
  branch_id: string;
  code: string;
  normalized_code: string;
  name: string;
  description: string | null;
  location_type: LocationType;
  status: LocationStatus;
  allows_receiving: boolean;
  allows_issuing: boolean;
  is_default: boolean;
  version: string;
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
}
interface IdempotencyRow {
  request_hash: string;
  response_body: LocationRow | null;
}

const LOCATION_COLUMNS =
  'id,company_id,branch_id,code,normalized_code,name,description,location_type,status,allows_receiving,allows_issuing,is_default,version,created_at,updated_at,deleted_at';

function result<T>(value: unknown): QueryResult<T> {
  return value as QueryResult<T>;
}
function location(row: LocationRow): InventoryLocation {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    code: row.code,
    normalizedCode: row.normalized_code,
    name: row.name,
    description: row.description,
    locationType: row.location_type,
    status: row.status,
    allowsReceiving: row.allows_receiving,
    allowsIssuing: row.allows_issuing,
    isDefault: row.is_default,
    version: BigInt(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    deletedAt: row.deleted_at === null ? null : new Date(row.deleted_at),
  };
}
function constraint(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'constraint' in error
    ? String((error as { constraint?: unknown }).constraint)
    : undefined;
}

export class InventoryLocationRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async transaction<T>(callback: (client: InventorySqlClient) => Promise<T>): Promise<T> {
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

  public async list(
    companyId: string,
    branchIds: readonly string[],
    input: {
      limit: number;
      cursor?: string;
      branchId?: string;
      status?: LocationStatus;
      locationType?: LocationType;
    },
  ): Promise<InventoryPage<InventoryLocation>> {
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
    if (input.locationType !== undefined) {
      values.push(input.locationType);
      where.push(`location_type=$${String(values.length)}`);
    }
    if (input.cursor !== undefined) {
      values.push(input.cursor);
      where.push(`id>$${String(values.length)}`);
    }
    values.push(input.limit + 1);
    const rows = result<LocationRow>(
      await this.database.pool.query(
        `select ${LOCATION_COLUMNS} from inventory_locations
         where ${where.join(' and ')} order by id limit $${String(values.length)}`,
        values,
      ),
    ).rows;
    const items = rows.slice(0, input.limit).map(location);
    return {
      items,
      nextCursor: rows.length > input.limit ? (items.at(-1)?.id ?? null) : null,
    };
  }

  public async branchExists(
    client: InventorySqlClient,
    companyId: string,
    branchId: string,
  ): Promise<boolean> {
    return (
      result<{ exists: boolean }>(
        await client.query(
          `select exists(select 1 from branches
           where company_id=$1 and id=$2 and status='active') exists`,
          [companyId, branchId],
        ),
      ).rows[0]?.exists ?? false
    );
  }

  public async lock(
    client: InventorySqlClient,
    companyId: string,
    id: string,
  ): Promise<InventoryLocation | null> {
    const row = result<LocationRow>(
      await client.query(
        `select ${LOCATION_COLUMNS} from inventory_locations
         where company_id=$1 and id=$2 for update`,
        [companyId, id],
      ),
    ).rows[0];
    return row === undefined ? null : location(row);
  }

  public async idempotentCreate(
    client: InventorySqlClient,
    context: InventoryMutationContext,
    key: string,
    requestHash: string,
    create: () => Promise<InventoryLocation>,
  ): Promise<{ value: InventoryLocation; replayed: boolean }> {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
      `${context.companyId}:inventory_location.create:${key}`,
    ]);
    const existing = result<IdempotencyRow>(
      await client.query(
        `select request_hash,response_body from idempotency_keys
         where company_id=$1 and operation='inventory_location.create' and key=$2`,
        [context.companyId, key],
      ),
    ).rows[0];
    if (existing !== undefined) {
      if (existing.request_hash !== requestHash || existing.response_body === null)
        throw new InventoryApplicationError(
          'idempotency_conflict',
          'The idempotency key was used with another request.',
        );
      return { value: location(existing.response_body), replayed: true };
    }
    const keyId = randomUUID();
    await client.query(
      `insert into idempotency_keys
       (id,company_id,key,operation,request_hash,expires_at,created_at)
       values ($1,$2,$3,'inventory_location.create',$4,$5,$6)`,
      [
        keyId,
        context.companyId,
        key,
        requestHash,
        new Date(context.timestamp.getTime() + 86_400_000),
        context.timestamp,
      ],
    );
    const value = await create();
    await client.query(
      `update idempotency_keys set response_status=201,response_body=$2::jsonb,
       resource_type='inventory_location',resource_id=$3,completed_at=$4 where id=$1`,
      [keyId, JSON.stringify(this.json(value)), value.id, context.timestamp],
    );
    return { value, replayed: false };
  }

  public async insert(
    client: InventorySqlClient,
    input: InventoryMutationContext & {
      id: string;
      branchId: string;
      code: string;
      normalizedCode: string;
      name: string;
      description: string | null;
      locationType: LocationType;
      status: LocationStatus;
      allowsReceiving: boolean;
      allowsIssuing: boolean;
      isDefault: boolean;
    },
  ): Promise<InventoryLocation> {
    const row = result<LocationRow>(
      await client.query(
        `insert into inventory_locations
         (id,company_id,branch_id,code,normalized_code,name,description,location_type,status,
          allows_receiving,allows_issuing,is_default,deleted_at,created_by,updated_by,created_at,updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
          case when $9='retired' then $13::timestamptz else null end,$14,$14,$13,$13)
         returning ${LOCATION_COLUMNS}`,
        [
          input.id,
          input.companyId,
          input.branchId,
          input.code,
          input.normalizedCode,
          input.name,
          input.description,
          input.locationType,
          input.status,
          input.allowsReceiving,
          input.allowsIssuing,
          input.isDefault,
          input.timestamp,
          input.actorId,
        ],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Location insertion returned no row.');
    return location(row);
  }

  public async update(
    client: InventorySqlClient,
    input: InventoryMutationContext & {
      id: string;
      expectedVersion: bigint;
      name: string;
      description: string | null;
      status: LocationStatus;
      allowsReceiving: boolean;
      allowsIssuing: boolean;
      isDefault: boolean;
    },
  ): Promise<InventoryLocation> {
    const row = result<LocationRow>(
      await client.query(
        `update inventory_locations set name=$4,description=$5,status=$6,
         allows_receiving=$7,allows_issuing=$8,is_default=$9,
         deleted_at=case when $6='retired' then $10::timestamptz else null end,
         updated_by=$11,updated_at=$10,version=version+1
         where company_id=$1 and id=$2 and version=$3 returning ${LOCATION_COLUMNS}`,
        [
          input.companyId,
          input.id,
          input.expectedVersion.toString(),
          input.name,
          input.description,
          input.status,
          input.allowsReceiving,
          input.allowsIssuing,
          input.isDefault,
          input.timestamp,
          input.actorId,
        ],
      ),
    ).rows[0];
    if (row === undefined)
      throw new InventoryApplicationError('version_conflict', 'The location version changed.');
    return location(row);
  }

  public async hasRetirementDependencies(
    client: InventorySqlClient,
    companyId: string,
    id: string,
  ): Promise<boolean> {
    return (
      result<{ blocked: boolean }>(
        await client.query(
          `select (
            exists(select 1 from inventory_balances where company_id=$1 and inventory_location_id=$2
              and (quantity_on_hand<>0 or quantity_reserved<>0))
            or exists(select 1 from inventory_transfers where company_id=$1
              and status in ('requested','approved','shipped','partially_received')
              and $2 in (source_location_id,destination_location_id,transit_location_id))
            or exists(select 1 from inventory_reservation_lines l
              join inventory_reservations r on r.company_id=l.company_id and r.id=l.inventory_reservation_id
              where l.company_id=$1 and l.inventory_location_id=$2 and r.status in ('active','confirmed'))
          ) blocked`,
          [companyId, id],
        ),
      ).rows[0]?.blocked ?? false
    );
  }

  public async auditAndPublish(
    client: InventorySqlClient,
    context: InventoryMutationContext,
    value: InventoryLocation,
    eventType: 'inventory_location.created' | 'inventory_location.updated',
  ): Promise<void> {
    const payload = {
      id: value.id,
      branch_id: value.branchId,
      code: value.code,
      name: value.name,
      location_type: value.locationType,
      status: value.status,
      is_default: value.isDefault,
      version: Number(value.version),
    };
    await client.query(
      `insert into audit_log
       (id,company_id,actor_type,actor_id,action,entity_type,entity_id,
        request_id,correlation_id,metadata,occurred_at)
       values ($1,$2,'user',$3,$4,'inventory_location',$5,$6,$7,$8::jsonb,$9)`,
      [
        randomUUID(),
        context.companyId,
        context.actorId,
        eventType,
        value.id,
        context.requestId,
        context.correlationId,
        JSON.stringify(payload),
        context.timestamp,
      ],
    );
    await client.query(
      `insert into outbox_events
       (event_id,company_id,event_type,schema_version,aggregate_type,aggregate_id,
        aggregate_version,correlation_id,payload,occurred_at)
       values ($1,$2,$3,1,'inventory_location',$4,$5,$6,$7::jsonb,$8)`,
      [
        randomUUID(),
        context.companyId,
        eventType,
        value.id,
        value.version.toString(),
        context.correlationId,
        JSON.stringify(payload),
        context.timestamp,
      ],
    );
  }

  private json(value: InventoryLocation): LocationRow {
    return {
      id: value.id,
      company_id: value.companyId,
      branch_id: value.branchId,
      code: value.code,
      normalized_code: value.normalizedCode,
      name: value.name,
      description: value.description,
      location_type: value.locationType,
      status: value.status,
      allows_receiving: value.allowsReceiving,
      allows_issuing: value.allowsIssuing,
      is_default: value.isDefault,
      version: value.version.toString(),
      created_at: value.createdAt,
      updated_at: value.updatedAt,
      deleted_at: value.deletedAt,
    };
  }

  private mapError(error: unknown): unknown {
    switch (constraint(error)) {
      case 'inventory_locations_company_branch_code_active_uq':
        return new InventoryApplicationError(
          'resource_conflict',
          'A location with that code already exists.',
        );
      case 'inventory_locations_company_branch_default_active_uq':
        return new InventoryApplicationError(
          'resource_conflict',
          'The branch already has an active default location.',
        );
      default:
        return error;
    }
  }
}

export class InventoryBalanceReadRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async list(
    companyId: string,
    branchIds: readonly string[],
    input: {
      limit: number;
      cursor?: string;
      branchId?: string;
      locationId?: string;
      productVariantId?: string;
      changedAfter?: Date;
    },
  ): Promise<InventoryPage<Readonly<Record<string, unknown>>>> {
    const values: unknown[] = [companyId, branchIds];
    const where = ['b.company_id=$1', 'b.branch_id=any($2::uuid[])'];
    for (const [column, value] of [
      ['b.branch_id', input.branchId],
      ['b.inventory_location_id', input.locationId],
      ['b.product_variant_id', input.productVariantId],
      ['b.id', input.cursor],
    ] as const)
      if (value !== undefined) {
        values.push(value);
        where.push(`${column}${column === 'b.id' ? '>' : '='}$${String(values.length)}`);
      }
    if (input.changedAfter !== undefined) {
      values.push(input.changedAfter);
      where.push(`b.updated_at>$${String(values.length)}`);
    }
    values.push(input.limit + 1);
    const rows = result<Record<string, unknown>>(
      await this.database.pool.query(
        `select b.id,b.branch_id,b.inventory_location_id,b.product_variant_id,
          b.quantity_on_hand::text,b.quantity_reserved::text,b.quantity_in_transit::text,
          (b.quantity_on_hand-b.quantity_reserved)::text quantity_available,
          b.average_unit_cost::text,b.currency_code,b.version::text,b.updated_at,
          l.code location_code,l.name location_name,v.sku,v.name variant_name,
          v.unit_of_measure_code,p.id product_id,p.name product_name,
          c.id category_id,c.name category_name,br.id brand_id,br.name brand_name,
          (select pb.barcode from product_barcodes pb where pb.company_id=b.company_id
            and pb.product_variant_id=b.product_variant_id and pb.status='active'
            order by pb.is_primary desc,pb.id limit 1) barcode
         from inventory_balances b
         join inventory_locations l on l.company_id=b.company_id and l.id=b.inventory_location_id
         join product_variants v on v.company_id=b.company_id and v.id=b.product_variant_id
         join products p on p.company_id=v.company_id and p.id=v.product_id
         left join product_categories c on c.company_id=p.company_id and c.id=p.category_id
         left join brands br on br.company_id=p.company_id and br.id=p.brand_id
         where ${where.join(' and ')} order by b.id limit $${String(values.length)}`,
        values,
      ),
    ).rows;
    const items = rows.slice(0, input.limit);
    const lastId = items.at(-1)?.id;
    return {
      items,
      nextCursor: rows.length > input.limit && typeof lastId === 'string' ? lastId : null,
    };
  }
}

export class InventoryMovementReadRepository {
  public constructor(private readonly database: DatabaseClient) {}
  public async list(
    companyId: string,
    branchIds: readonly string[],
    input: {
      limit: number;
      cursor?: string;
      branchId?: string;
      status?: string;
      movementType?: string;
      locationId?: string;
      productVariantId?: string;
      referenceType?: string;
      referenceId?: string;
      occurredFrom?: Date;
      occurredTo?: Date;
    },
  ): Promise<InventoryPage<Readonly<Record<string, unknown>>>> {
    const values: unknown[] = [companyId, branchIds];
    const where = ['company_id=$1', 'branch_id=any($2::uuid[])'];
    for (const [column, value] of [
      ['branch_id', input.branchId],
      ['status', input.status],
      ['movement_type', input.movementType],
      ['id', input.cursor],
    ] as const)
      if (value !== undefined) {
        values.push(value);
        where.push(`${column}${column === 'id' ? '>' : '='}$${String(values.length)}`);
      }
    if (input.locationId !== undefined) {
      values.push(input.locationId);
      where.push(
        `exists(select 1 from inventory_movement_lines ml where ml.company_id=inventory_movements.company_id
          and ml.inventory_movement_id=inventory_movements.id
          and $${String(values.length)} in (ml.source_location_id,ml.destination_location_id))`,
      );
    }
    if (input.productVariantId !== undefined) {
      values.push(input.productVariantId);
      where.push(
        `exists(select 1 from inventory_movement_lines ml where ml.company_id=inventory_movements.company_id
          and ml.inventory_movement_id=inventory_movements.id
          and ml.product_variant_id=$${String(values.length)})`,
      );
    }
    for (const [column, value] of [
      ['reference_type', input.referenceType],
      ['reference_id', input.referenceId],
    ] as const)
      if (value !== undefined) {
        values.push(value);
        where.push(`${column}=$${String(values.length)}`);
      }
    if (input.occurredFrom !== undefined) {
      values.push(input.occurredFrom);
      where.push(`occurred_at>=$${String(values.length)}`);
    }
    if (input.occurredTo !== undefined) {
      values.push(input.occurredTo);
      where.push(`occurred_at<=$${String(values.length)}`);
    }
    values.push(input.limit + 1);
    const rows = result<Record<string, unknown>>(
      await this.database.pool.query(
        `select id,branch_id,movement_number,movement_type,status,reason_code,
          reference_type,reference_id,source_document_number,notes,version::text,
          occurred_at,posted_at,cancelled_at,reversed_at,created_at,updated_at
         from inventory_movements where ${where.join(' and ')}
         order by id limit $${String(values.length)}`,
        values,
      ),
    ).rows;
    const items = rows.slice(0, input.limit);
    const lastId = items.at(-1)?.id;
    return {
      items,
      nextCursor: rows.length > input.limit && typeof lastId === 'string' ? lastId : null,
    };
  }
}
