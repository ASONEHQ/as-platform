import { randomUUID } from 'node:crypto';

import type { DatabaseClient } from '@asone/database';

import { OperationalAreaError, type OperationalAreaMutationContext, type OperationalAreaRow } from './operational-areas.types.js';

export interface OperationalAreaTransaction {
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

const AREA_COLUMNS = 'id,company_id,branch_id,code,name,status,created_by,updated_by,version,created_at,updated_at';

interface AreaDb {
  id: string;
  company_id: string;
  branch_id: string;
  code: string;
  name: string;
  status: string;
  created_by: string;
  updated_by: string;
  version: string;
  created_at: Date | string;
  updated_at: Date | string;
}
interface IdempotencyDb {
  request_hash: string;
  response_body: unknown;
}

function area(row: AreaDb): OperationalAreaRow {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    code: row.code,
    name: row.name,
    status: row.status as OperationalAreaRow['status'],
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    version: BigInt(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/** TASK 16.15 — mirrors `CashRepository`'s own
 * `transaction`/`idempotent`/`auditAndPublish` trio verbatim (this
 * codebase's established convention is one small copy per module, never
 * a shared base class — see that repository's own comments). */
export class OperationalAreasRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async transaction<T>(callback: (client: OperationalAreaTransaction) => Promise<T>): Promise<T> {
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
    client: OperationalAreaTransaction,
    context: OperationalAreaMutationContext,
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
        `select request_hash,response_body from idempotency_keys where company_id=$1 and operation=$2 and key=$3`,
        [context.companyId, operation, key],
      ),
    ).rows[0];
    if (existing !== undefined) {
      if (existing.request_hash !== requestHash || existing.response_body === null)
        throw new OperationalAreaError('idempotency_conflict', 'The idempotency key was used with another request.');
      return { value: decode(existing.response_body), replayed: true };
    }
    const id = randomUUID();
    await client.query(
      `insert into idempotency_keys (id,company_id,key,operation,request_hash,expires_at,created_at) values ($1,$2,$3,$4,$5,$6,$7)`,
      [id, context.companyId, key, operation, requestHash, new Date(context.timestamp.getTime() + 86_400_000), context.timestamp],
    );
    const value = await create();
    await client.query(
      `update idempotency_keys set response_status=201,response_body=$2::jsonb,resource_type=$3,resource_id=$4,completed_at=$5 where id=$1`,
      [id, JSON.stringify(value, jsonValue), resourceType, value.id, context.timestamp],
    );
    return { value, replayed: false };
  }

  public async auditAndPublish(
    client: OperationalAreaTransaction,
    context: OperationalAreaMutationContext,
    input: {
      action: string;
      resourceType: 'operational_area';
      resourceId: string;
      eventType: string;
      branchId: string;
      version: bigint;
      payload: Readonly<Record<string, unknown>>;
    },
  ): Promise<void> {
    await client.query(
      `insert into audit_log (id,company_id,actor_type,actor_id,action,entity_type,entity_id,request_id,correlation_id,metadata,occurred_at)
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
    await client.query(
      `insert into outbox_events (event_id,company_id,branch_id,event_type,schema_version,aggregate_type,aggregate_id,aggregate_version,correlation_id,payload,occurred_at,available_at,created_at)
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

  public async insert(
    client: OperationalAreaTransaction,
    input: {
      id: string;
      companyId: string;
      branchId: string;
      code: string;
      name: string;
      actorId: string;
      timestamp: Date;
    },
  ): Promise<OperationalAreaRow> {
    const row = result<AreaDb>(
      await client.query(
        `insert into operational_areas (id,company_id,branch_id,code,normalized_code,name,status,created_by,updated_by,created_at,updated_at)
         values ($1,$2,$3,$4,$5,$6,'active',$7,$7,$8,$8)
         returning ${AREA_COLUMNS}`,
        [input.id, input.companyId, input.branchId, input.code, input.code.toLowerCase(), input.name, input.actorId, input.timestamp],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Operational area insertion did not return a row.');
    return area(row);
  }

  public async area(companyId: string, id: string): Promise<OperationalAreaRow | null> {
    const row = result<AreaDb>(
      await this.database.pool.query(`select ${AREA_COLUMNS} from operational_areas where company_id=$1 and id=$2`, [companyId, id]),
    ).rows[0];
    return row === undefined ? null : area(row);
  }

  public async lock(client: OperationalAreaTransaction, companyId: string, id: string): Promise<OperationalAreaRow | null> {
    const row = result<AreaDb>(
      await client.query(`select ${AREA_COLUMNS} from operational_areas where company_id=$1 and id=$2 for update`, [companyId, id]),
    ).rows[0];
    return row === undefined ? null : area(row);
  }

  public async list(
    companyId: string,
    branchIds: readonly string[],
    input: { branchId?: string; status?: string; limit: number; cursor?: string },
  ): Promise<{ items: OperationalAreaRow[]; nextCursor: string | null }> {
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
    const rows = result<AreaDb>(
      await this.database.pool.query(
        `select ${AREA_COLUMNS} from operational_areas where ${where.join(' and ')} order by id asc limit $${String(values.length)}`,
        values,
      ),
    ).rows;
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit).map(area);
    return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
  }

  public async update(
    client: OperationalAreaTransaction,
    companyId: string,
    id: string,
    expectedVersion: bigint,
    input: { name?: string; status?: string; updatedBy: string; timestamp: Date },
  ): Promise<OperationalAreaRow> {
    const sets: string[] = ['updated_by=$3', 'updated_at=$4', 'version=version+1'];
    const values: unknown[] = [companyId, id, input.updatedBy, input.timestamp];
    if (input.name !== undefined) {
      values.push(input.name);
      sets.push(`name=$${String(values.length)}`);
    }
    if (input.status !== undefined) {
      values.push(input.status);
      sets.push(`status=$${String(values.length)}`);
    }
    values.push(expectedVersion.toString());
    const row = result<AreaDb>(
      await client.query(
        `update operational_areas set ${sets.join(',')} where company_id=$1 and id=$2 and version=$${String(values.length)}
         returning ${AREA_COLUMNS}`,
        values,
      ),
    ).rows[0];
    if (row === undefined) throw new OperationalAreaError('version_conflict', 'The operational area version changed.');
    return area(row);
  }

  private mapDatabaseError(error: unknown): unknown {
    switch (constraint(error)) {
      case 'operational_areas_company_branch_code_active_uq':
        return new OperationalAreaError('validation_error', 'This area code was already used in this branch.');
      default:
        return error;
    }
  }
}
