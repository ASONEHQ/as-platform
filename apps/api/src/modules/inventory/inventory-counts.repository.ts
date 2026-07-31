import { randomUUID } from 'node:crypto';

import type { DatabaseClient } from '@asone/database';
import { createUuidV7 } from '@asone/database';

import type { DraftSqlClient } from './inventory-drafts.repository.js';
import { InventoryDraftRepository } from './inventory-drafts.repository.js';
import type { BalanceKey, LockedBalance } from './inventory-posting.repository.js';
import { InventoryPostingRepository } from './inventory-posting.repository.js';
import type {
  InventoryCount,
  InventoryCountLine,
  InventoryCountScopeType,
  InventoryCountStatus,
} from './inventory-counts.types.js';
import { InventoryCountError } from './inventory-counts.types.js';
import type { InventoryMutationContext, InventoryPage } from './inventory.types.js';

interface QueryResult<T> {
  rows: readonly T[];
}
interface CountRow {
  id: string;
  company_id: string;
  branch_id: string;
  inventory_location_id: string;
  count_number: string;
  status: InventoryCountStatus;
  scope_type: InventoryCountScopeType;
  scope_definition: Readonly<Record<string, unknown>>;
  baseline_at: Date | string | null;
  lock_acquired_at: Date | string | null;
  lock_expires_at: Date | string | null;
  started_at: Date | string | null;
  started_by: string | null;
  submitted_at: Date | string | null;
  submitted_by: string | null;
  approved_at: Date | string | null;
  approved_by: string | null;
  applied_at: Date | string | null;
  applied_by: string | null;
  cancelled_at: Date | string | null;
  cancelled_by: string | null;
  application_movement_id: string | null;
  reason_code: string;
  note: string | null;
  metadata: Readonly<Record<string, unknown>> | null;
  version: string;
  created_at: Date | string;
  updated_at: Date | string;
}
interface LineRow {
  id: string;
  product_variant_id: string;
  unit_of_measure_code: string;
  expected_quantity: string;
  counted_quantity: string | null;
  baseline_balance_version: string;
  baseline_last_movement_id: string | null;
  first_counted_at: Date | string | null;
  last_counted_at: Date | string | null;
  counted_by: string | null;
  version: string;
  metadata: Readonly<Record<string, unknown>> | null;
}
interface IdempotencyRow {
  request_hash: string;
  response_status: number | null;
  response_body: Readonly<Record<string, unknown>> | null;
}

const COLUMNS = `c.id,c.company_id,c.branch_id,c.inventory_location_id,c.count_number,
 c.status,c.scope_type,c.scope_definition,c.baseline_at,c.lock_acquired_at,c.lock_expires_at,
 c.started_at,c.started_by,c.submitted_at,c.submitted_by,c.approved_at,c.approved_by,
 c.applied_at,c.applied_by,c.cancelled_at,c.cancelled_by,c.application_movement_id,
 c.reason_code,c.note,c.metadata,c.version::text,c.created_at,c.updated_at`;
const LOCK_MILLISECONDS = 30 * 60 * 1000;

function result<T>(value: unknown): QueryResult<T> {
  return value as QueryResult<T>;
}
function date(value: Date | string | null): Date | null {
  return value === null ? null : new Date(value);
}
function mapLine(row: LineRow): InventoryCountLine {
  return {
    id: row.id,
    productVariantId: row.product_variant_id,
    unitOfMeasureCode: row.unit_of_measure_code,
    expectedQuantity: row.expected_quantity,
    countedQuantity: row.counted_quantity,
    baselineBalanceVersion: BigInt(row.baseline_balance_version),
    baselineLastMovementId: row.baseline_last_movement_id,
    firstCountedAt: date(row.first_counted_at),
    lastCountedAt: date(row.last_counted_at),
    countedBy: row.counted_by,
    version: BigInt(row.version),
    metadata: row.metadata,
  };
}
function mapCount(row: CountRow, lines: readonly InventoryCountLine[]): InventoryCount {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    locationId: row.inventory_location_id,
    countNumber: row.count_number,
    status: row.status,
    scopeType: row.scope_type,
    scopeDefinition: row.scope_definition,
    baselineAt: date(row.baseline_at),
    lockAcquiredAt: date(row.lock_acquired_at),
    lockExpiresAt: date(row.lock_expires_at),
    startedAt: date(row.started_at),
    startedBy: row.started_by,
    submittedAt: date(row.submitted_at),
    submittedBy: row.submitted_by,
    approvedAt: date(row.approved_at),
    approvedBy: row.approved_by,
    appliedAt: date(row.applied_at),
    appliedBy: row.applied_by,
    cancelledAt: date(row.cancelled_at),
    cancelledBy: row.cancelled_by,
    applicationMovementId: row.application_movement_id,
    reasonCode: row.reason_code,
    note: row.note,
    metadata: row.metadata,
    version: BigInt(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    lines,
  };
}

export class InventoryCountRepository {
  private readonly drafts: InventoryDraftRepository;
  private readonly posting: InventoryPostingRepository;
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
  ): Promise<boolean> {
    const row = result<{ valid: boolean }>(
      await client.query(
        `select exists(select 1 from inventory_locations where company_id=$1 and branch_id=$2
       and id=$3 and status='active' and deleted_at is null and location_type<>'virtual') valid`,
        [companyId, branchId, id],
      ),
    ).rows[0];
    return row?.valid ?? false;
  }
  public async variants(
    client: DraftSqlClient,
    companyId: string,
    ids: readonly string[],
  ): Promise<readonly { id: string; unit: string; quantityScale: number }[]> {
    return result<{ id: string; unit: string; quantity_scale: number }>(
      await client.query(
        `select v.id,v.unit_of_measure_code unit,v.quantity_scale from product_variants v
       join products p on p.company_id=v.company_id and p.id=v.product_id
       where v.company_id=$1 and v.id=any($2::uuid[]) and v.status='active'
       and p.status='active' and p.tracks_inventory and p.product_type not in ('service','kit')`,
        [companyId, ids],
      ),
    ).rows.map((row) => ({ id: row.id, unit: row.unit, quantityScale: row.quantity_scale }));
  }
  private async lines(
    client: Pick<DraftSqlClient, 'query'>,
    companyId: string,
    id: string,
  ): Promise<readonly InventoryCountLine[]> {
    return result<LineRow>(
      await client.query(
        `select id,product_variant_id,unit_of_measure_code,expected_quantity::text,
       counted_quantity::text,baseline_balance_version::text,baseline_last_movement_id,
       first_counted_at,last_counted_at,counted_by,version::text,metadata
       from inventory_count_lines where company_id=$1 and inventory_count_id=$2
       order by product_variant_id,id`,
        [companyId, id],
      ),
    ).rows.map(mapLine);
  }
  public async find(
    companyId: string,
    branches: readonly string[],
    id: string,
  ): Promise<InventoryCount | null> {
    const row = result<CountRow>(
      await this.database.pool.query(
        `select ${COLUMNS} from inventory_counts c where c.company_id=$1 and c.id=$2
       and c.branch_id=any($3::uuid[])`,
        [companyId, id, branches],
      ),
    ).rows[0];
    return row === undefined
      ? null
      : mapCount(row, await this.lines(this.database.pool, companyId, id));
  }
  public async lock(
    client: DraftSqlClient,
    companyId: string,
    branches: readonly string[],
    id: string,
  ): Promise<InventoryCount | null> {
    const row = result<CountRow>(
      await client.query(
        `select ${COLUMNS} from inventory_counts c where c.company_id=$1 and c.id=$2
       and c.branch_id=any($3::uuid[]) for update`,
        [companyId, id, branches],
      ),
    ).rows[0];
    return row === undefined ? null : mapCount(row, await this.lines(client, companyId, id));
  }
  public async insert(
    client: DraftSqlClient,
    context: InventoryMutationContext,
    input: {
      id: string;
      branchId: string;
      locationId: string;
      number: string;
      scopeType: InventoryCountScopeType;
      scopeDefinition: Readonly<Record<string, unknown>>;
      reasonCode: string;
      note: string | null;
      metadata: Readonly<Record<string, unknown>> | null;
    },
  ): Promise<InventoryCount> {
    await client.query(
      `insert into inventory_counts
       (id,company_id,branch_id,inventory_location_id,count_number,status,scope_type,
        scope_definition,reason_code,note,metadata,version,created_at,updated_at)
       values ($1,$2,$3,$4,$5,'draft',$6,$7::jsonb,$8,$9,$10::jsonb,1,$11,$11)`,
      [
        input.id,
        context.companyId,
        input.branchId,
        input.locationId,
        input.number,
        input.scopeType,
        JSON.stringify(input.scopeDefinition),
        input.reasonCode,
        input.note,
        input.metadata === null ? null : JSON.stringify(input.metadata),
        context.timestamp,
      ],
    );
    const created = await this.lock(client, context.companyId, [input.branchId], input.id);
    if (created === null) throw new Error('Count insertion returned no row.');
    return created;
  }
  public async materialize(
    client: DraftSqlClient,
    context: InventoryMutationContext,
    count: InventoryCount,
  ): Promise<void> {
    const ids =
      count.scopeType === 'explicit_variants'
        ? ((count.scopeDefinition.product_variant_ids as readonly string[] | undefined) ?? [])
        : null;
    const values: unknown[] = [context.companyId, count.branchId, count.locationId];
    const filter = ids === null ? 'b.id is not null' : 'v.id=any($4::uuid[])';
    if (ids !== null) values.push(ids);
    const rows = result<{
      id: string;
      unit: string;
      quantity: string;
      version: string;
      last_movement_id: string | null;
      exists: boolean;
    }>(
      await client.query(
        `select v.id,v.unit_of_measure_code unit,coalesce(b.quantity_on_hand,0)::text quantity,
        coalesce(b.version,1)::text version,b.last_movement_id,b.id is not null exists
       from product_variants v join products p on p.company_id=v.company_id and p.id=v.product_id
       left join inventory_balances b on b.company_id=v.company_id and b.product_variant_id=v.id
        and b.branch_id=$2 and b.inventory_location_id=$3
       where v.company_id=$1 and v.status='active' and p.status='active' and p.tracks_inventory
        and p.product_type not in ('service','kit') and ${filter}
       order by v.id`,
        values,
      ),
    ).rows;
    for (const row of rows)
      await client.query(
        `insert into inventory_count_lines
       (id,company_id,branch_id,inventory_count_id,product_variant_id,unit_of_measure_code,
        expected_quantity,baseline_balance_version,baseline_last_movement_id,version,metadata,created_at,updated_at)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10::jsonb,$11,$11)`,
        [
          createUuidV7(),
          context.companyId,
          count.branchId,
          count.id,
          row.id,
          row.unit,
          row.quantity,
          row.version,
          row.last_movement_id,
          JSON.stringify({ baseline_balance_exists: row.exists }),
          context.timestamp,
        ],
      );
  }
  public async transition(
    client: DraftSqlClient,
    context: InventoryMutationContext,
    current: InventoryCount,
    status: Exclude<InventoryCountStatus, 'draft'>,
    extra?: { movementId?: string | null; reasonCode?: string; note?: string | null },
  ): Promise<InventoryCount> {
    const lockExpiry = new Date(context.timestamp.getTime() + LOCK_MILLISECONDS);
    await client.query(
      `update inventory_counts set status=$4,version=version+1,updated_at=$3,
       baseline_at=case when $4='counting' then $3 else baseline_at end,
       lock_acquired_at=case when $4='counting' then $3 else lock_acquired_at end,
       lock_expires_at=case when $4 in ('counting','submitted','approved') then $5 else lock_expires_at end,
       started_at=case when $4='counting' then $3 else started_at end,
       started_by=case when $4='counting' then $2::uuid else started_by end,
       submitted_at=case when $4='submitted' then $3 else submitted_at end,
       submitted_by=case when $4='submitted' then $2::uuid else submitted_by end,
       approved_at=case when $4='approved' then $3 else approved_at end,
       approved_by=case when $4='approved' then $2::uuid else approved_by end,
       applied_at=case when $4='applied' then $3 else applied_at end,
       applied_by=case when $4='applied' then $2::uuid else applied_by end,
       application_movement_id=case when $4='applied' then $6::uuid else application_movement_id end,
       cancelled_at=case when $4='cancelled' then $3 else cancelled_at end,
       cancelled_by=case when $4='cancelled' then $2::uuid else cancelled_by end,
       reason_code=case when $4='cancelled' then $7 else reason_code end,
       note=case when $4='cancelled' then $8::text else note end
       where company_id=$1 and id=$9`,
      [
        context.companyId,
        context.actorId,
        context.timestamp,
        status,
        lockExpiry,
        extra?.movementId ?? null,
        extra?.reasonCode ?? current.reasonCode,
        extra?.note ?? current.note,
        current.id,
      ],
    );
    const updated = await this.lock(client, context.companyId, [current.branchId], current.id);
    if (updated === null) throw new Error('Count transition returned no row.');
    return updated;
  }
  public async recordLine(
    client: DraftSqlClient,
    context: InventoryMutationContext,
    current: InventoryCount,
    variantId: string,
    quantity: string,
    unit: string,
    metadata: Readonly<Record<string, unknown>> | null,
  ): Promise<InventoryCount> {
    const changed = result<{ id: string }>(
      await client.query(
        `update inventory_count_lines set counted_quantity=$5,unit_of_measure_code=$6,
       first_counted_at=coalesce(first_counted_at,$4),last_counted_at=$4,counted_by=$3,
       version=version+1,
       metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('capture',$7::jsonb),
       updated_at=$4
       where company_id=$1 and inventory_count_id=$2 and product_variant_id=$8 returning id`,
        [
          context.companyId,
          current.id,
          context.actorId,
          context.timestamp,
          quantity,
          unit,
          metadata === null ? null : JSON.stringify(metadata),
          variantId,
        ],
      ),
    ).rows[0];
    if (changed === undefined)
      throw new InventoryCountError('resource_not_found', 'The count line was not found.');
    await client.query(
      `update inventory_counts set version=version+1,lock_expires_at=$3,updated_at=$2
      where company_id=$1 and id=$4`,
      [
        context.companyId,
        context.timestamp,
        new Date(context.timestamp.getTime() + LOCK_MILLISECONDS),
        current.id,
      ],
    );
    const updated = await this.lock(client, context.companyId, [current.branchId], current.id);
    if (updated === null) throw new Error('Count line update returned no count.');
    return updated;
  }
  public async list(
    companyId: string,
    branches: readonly string[],
    input: {
      limit: number;
      cursor?: string;
      branchId?: string;
      locationId?: string;
      status?: InventoryCountStatus;
      createdFrom?: Date;
      createdTo?: Date;
    },
  ): Promise<InventoryPage<InventoryCount>> {
    const values: unknown[] = [companyId, branches];
    const where = ['c.company_id=$1', 'c.branch_id=any($2::uuid[])'];
    const add = (sql: string, value: unknown): void => {
      values.push(value);
      where.push(sql.replace('?', `$${String(values.length)}`));
    };
    if (input.branchId !== undefined) add('c.branch_id=?', input.branchId);
    if (input.locationId !== undefined) add('c.inventory_location_id=?', input.locationId);
    if (input.status !== undefined) add('c.status=?', input.status);
    if (input.createdFrom !== undefined) add('c.created_at>=?', input.createdFrom);
    if (input.createdTo !== undefined) add('c.created_at<=?', input.createdTo);
    if (input.cursor !== undefined) {
      const decoded = Buffer.from(input.cursor, 'base64url').toString();
      const split = decoded.indexOf('|');
      if (split <= 0) throw new InventoryCountError('validation_error', 'Cursor is invalid.');
      values.push(new Date(decoded.slice(0, split)), decoded.slice(split + 1));
      where.push(
        `(c.created_at,c.id)<($${String(values.length - 1)},$${String(values.length)}::uuid)`,
      );
    }
    values.push(input.limit + 1);
    const rows = result<CountRow>(
      await this.database.pool.query(
        `select ${COLUMNS} from inventory_counts c where ${where.join(' and ')} order by c.created_at desc,c.id desc limit $${String(values.length)}`,
        values,
      ),
    ).rows;
    const selected = rows.slice(0, input.limit);
    const items = await Promise.all(
      selected.map(async (row) =>
        mapCount(row, await this.lines(this.database.pool, companyId, row.id)),
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
  public async incomplete(client: DraftSqlClient, companyId: string, id: string): Promise<boolean> {
    const row = result<{ incomplete: boolean }>(
      await client.query(
        `select exists(select 1 from inventory_count_lines
      where company_id=$1 and inventory_count_id=$2 and counted_quantity is null) incomplete`,
        [companyId, id],
      ),
    ).rows[0];
    return row?.incomplete ?? true;
  }
  public async currentBalances(
    client: DraftSqlClient,
    count: InventoryCount,
  ): Promise<
    readonly {
      variantId: string;
      exists: boolean;
      quantity: string;
      version: bigint;
      lastMovementId: string | null;
    }[]
  > {
    return result<{
      product_variant_id: string;
      exists: boolean;
      quantity: string;
      version: string;
      last_movement_id: string | null;
    }>(
      await client.query(
        `select l.product_variant_id,b.id is not null exists,coalesce(b.quantity_on_hand,0)::text quantity,
       coalesce(b.version,1)::text version,b.last_movement_id from inventory_count_lines l
       left join inventory_balances b on b.company_id=l.company_id and b.branch_id=l.branch_id
        and b.inventory_location_id=$3 and b.product_variant_id=l.product_variant_id
       where l.company_id=$1 and l.inventory_count_id=$2 order by l.product_variant_id`,
        [count.companyId, count.id, count.locationId],
      ),
    ).rows.map((row) => ({
      variantId: row.product_variant_id,
      exists: row.exists,
      quantity: row.quantity,
      version: BigInt(row.version),
      lastMovementId: row.last_movement_id,
    }));
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
  public updateBalance(
    client: DraftSqlClient,
    input: LockedBalance & { newQuantity: string; movementId: string; timestamp: Date },
  ): Promise<bigint> {
    return this.posting.updateBalance(client, input);
  }
  public async insertMovement(
    client: DraftSqlClient,
    context: InventoryMutationContext,
    count: InventoryCount,
    movementId: string,
    movementNumber: string,
    lines: readonly { variantId: string; quantity: string; unit: string; delta: bigint }[],
  ): Promise<void> {
    await client.query(
      `insert into inventory_movements
      (id,company_id,branch_id,movement_number,movement_type,status,reference_type,reference_id,
       occurred_at,posted_at,created_by,updated_by,posted_by,created_at,updated_at)
      values($1,$2,$3,$4,'adjustment','posted','inventory_count',$5,$6,$6,$7,$7,$7,$6,$6)`,
      [
        movementId,
        context.companyId,
        count.branchId,
        movementNumber,
        count.id,
        context.timestamp,
        context.actorId,
      ],
    );
    for (const [index, line] of lines.entries())
      await client.query(
        `insert into inventory_movement_lines
      (id,company_id,inventory_movement_id,line_number,product_variant_id,source_location_id,
       destination_location_id,quantity,base_quantity,unit_of_measure_code,reason_code,created_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11)`,
        [
          createUuidV7(),
          context.companyId,
          movementId,
          index + 1,
          line.variantId,
          line.delta < 0n ? count.locationId : null,
          line.delta > 0n ? count.locationId : null,
          line.quantity,
          line.unit,
          count.reasonCode,
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
  ): Promise<{ status: number; value: Readonly<Record<string, unknown>>; replayed: boolean }> {
    const scoped = `${operation}:${context.actorId}`;
    await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
      `${context.companyId}:${scoped}:${key}`,
    ]);
    const existing = result<IdempotencyRow>(
      await client.query(
        `select request_hash,response_status,response_body from idempotency_keys
      where company_id=$1 and operation=$2 and key=$3`,
        [context.companyId, scoped, key],
      ),
    ).rows[0];
    if (existing !== undefined) {
      if (
        existing.request_hash !== requestHash ||
        existing.response_body === null ||
        existing.response_status === null
      )
        throw new InventoryCountError('idempotency_conflict', 'The idempotency key conflicts.');
      return { status: existing.response_status, value: existing.response_body, replayed: true };
    }
    const id = createUuidV7();
    await client.query(
      `insert into idempotency_keys(id,company_id,key,operation,request_hash,expires_at,created_at)
      values($1,$2,$3,$4,$5,$6,$7)`,
      [
        id,
        context.companyId,
        key,
        scoped,
        requestHash,
        new Date(context.timestamp.getTime() + 86_400_000),
        context.timestamp,
      ],
    );
    const outcome = await execute();
    await client.query(
      `update idempotency_keys set response_status=$2,response_body=$3::jsonb,
      resource_type='inventory_count',resource_id=$4::uuid,completed_at=$5 where id=$1`,
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
    value: InventoryCount,
    action: string,
    metadata: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    return client.query(
      `insert into audit_log(id,company_id,branch_id,actor_type,actor_id,action,entity_type,entity_id,request_id,correlation_id,metadata,occurred_at)
     values($1,$2,$3,'user',$4,$5,'inventory_count',$6,$7,$8,$9::jsonb,$10)`,
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
          count_id: value.id,
          count_number: value.countNumber,
          location_id: value.locationId,
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
