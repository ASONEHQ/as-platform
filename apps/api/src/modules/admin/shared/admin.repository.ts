import { randomUUID } from 'node:crypto';

import type { DatabaseClient } from '@asone/database';

export class AdminRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public query<T extends Record<string, unknown>>(
    sql: string,
    values: readonly unknown[] = [],
  ): Promise<readonly T[]> {
    return this.database.pool.query<T>(sql, [...values]).then((result) => result.rows);
  }

  public async mutate(input: {
    companyId: string;
    branchId?: string | undefined;
    actorId: string;
    requestId: string;
    correlationId: string;
    action: string;
    entityType: string;
    entityId: string;
    eventType: string;
    aggregateVersion?: bigint;
    metadata?: Readonly<Record<string, unknown>> | undefined;
    mutation(client: {
      query(sql: string, values?: readonly unknown[]): Promise<unknown>;
    }): Promise<void>;
  }): Promise<void> {
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      await input.mutation(client);
      await client.query(
        `insert into audit_log (id,company_id,branch_id,actor_type,actor_id,action,entity_type,entity_id,request_id,correlation_id,metadata)
         values ($1,$2,$3,'user',$4,$5,$6,$7,$8,$9,$10::jsonb)`,
        [
          randomUUID(),
          input.companyId,
          input.branchId ?? null,
          input.actorId,
          input.action,
          input.entityType,
          input.entityId,
          input.requestId,
          input.correlationId,
          JSON.stringify(input.metadata ?? {}),
        ],
      );
      await client.query(
        `insert into outbox_events (event_id,company_id,branch_id,event_type,schema_version,aggregate_type,aggregate_id,aggregate_version,payload,occurred_at)
         values ($1,$2,$3,$4,1,$5,$6,$7,$8::jsonb,now())`,
        [
          randomUUID(),
          input.companyId,
          input.branchId ?? null,
          input.eventType,
          input.entityType,
          input.entityId,
          input.aggregateVersion ?? 1n,
          JSON.stringify({ id: input.entityId }),
        ],
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}
