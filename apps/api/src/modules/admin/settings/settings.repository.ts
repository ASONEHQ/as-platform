import { randomUUID } from 'node:crypto';

import type { DatabaseClient } from '@asone/database';

import type { PersistedSetting, SettingValue, SettingValueType } from './settings.types.js';
import { SettingsError } from './settings.types.js';

export interface SettingsSqlClient {
  query(sql: string, values?: readonly unknown[]): Promise<unknown>;
}

export interface CompanyDefaultsRow {
  readonly id: string;
  readonly displayName: string;
  readonly timezone: string;
  readonly locale: string;
  readonly currencyCode: string;
}

export interface BranchScopeRow {
  readonly id: string;
  readonly companyId: string;
  readonly status: string;
}

interface SettingDatabaseRow {
  readonly id: string;
  readonly key: string;
  readonly value: unknown;
  readonly value_type: SettingValueType;
  readonly status: 'active' | 'retired';
  readonly version: string;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly deleted_at: Date | null;
}

interface QueryResult<T> {
  readonly rows: readonly T[];
  readonly rowCount: number | null;
}

export interface SetSettingInput {
  readonly companyId: string;
  readonly branchId?: string | undefined;
  readonly key: string;
  readonly value: SettingValue;
  readonly valueType: SettingValueType;
  readonly expectedVersion: bigint;
  readonly actorId: string;
  readonly timestamp: Date;
}

export interface RetireSettingInput {
  readonly companyId: string;
  readonly branchId?: string | undefined;
  readonly key: string;
  readonly expectedVersion: bigint;
  readonly actorId: string;
  readonly timestamp: Date;
}

export interface SettingAuditInput {
  readonly companyId: string;
  readonly branchId?: string | undefined;
  readonly actorId: string;
  readonly action:
    | 'branch_setting.retired'
    | 'branch_setting.updated'
    | 'company_setting.retired'
    | 'company_setting.updated';
  readonly entityType: 'branch_setting' | 'company_setting';
  readonly entityId: string;
  readonly requestId: string;
  readonly correlationId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly timestamp: Date;
}

export interface SettingOutboxInput {
  readonly companyId: string;
  readonly branchId?: string | undefined;
  readonly eventType: 'branch_setting.changed' | 'company_setting.changed';
  readonly aggregateType: 'branch_setting' | 'company_setting';
  readonly aggregateId: string;
  readonly aggregateVersion: bigint;
  readonly correlationId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly timestamp: Date;
}

function result<T>(value: unknown): QueryResult<T> {
  return value as QueryResult<T>;
}

function setting(row: SettingDatabaseRow): PersistedSetting {
  return {
    id: row.id,
    key: row.key,
    value: row.value,
    valueType: row.value_type,
    status: row.status,
    version: BigInt(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function versionConflict(key: string, expectedVersion: bigint): SettingsError {
  return new SettingsError('version_conflict', 'The setting version changed.', {
    key,
    expected_version: expectedVersion.toString(),
  });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === '23505'
  );
}

const RETURNING_SETTING =
  'returning id,key,value,value_type,status,version,created_at,updated_at,deleted_at';

export class SettingsRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async transaction<T>(callback: (client: SettingsSqlClient) => Promise<T>): Promise<T> {
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      const value = await callback(client);
      await client.query('commit');
      return value;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  public async company(
    companyId: string,
    client: SettingsSqlClient = this.database.pool,
  ): Promise<CompanyDefaultsRow | null> {
    const query = result<{
      id: string;
      display_name: string;
      timezone: string;
      locale: string;
      currency_code: string;
    }>(
      await client.query(
        `select id,display_name,timezone,locale,currency_code
         from companies where id=$1`,
        [companyId],
      ),
    );
    const row = query.rows[0];
    return row === undefined
      ? null
      : {
          id: row.id,
          displayName: row.display_name,
          timezone: row.timezone,
          locale: row.locale,
          currencyCode: row.currency_code,
        };
  }

  public async branch(
    companyId: string,
    branchId: string,
    client: SettingsSqlClient = this.database.pool,
  ): Promise<BranchScopeRow | null> {
    const query = result<{ id: string; company_id: string; status: string }>(
      await client.query(
        'select id,company_id,status from branches where company_id=$1 and id=$2',
        [companyId, branchId],
      ),
    );
    const row = query.rows[0];
    return row === undefined ? null : { id: row.id, companyId: row.company_id, status: row.status };
  }

  public async companySettings(
    companyId: string,
    keys: readonly string[],
    client: SettingsSqlClient = this.database.pool,
  ): Promise<readonly PersistedSetting[]> {
    if (keys.length === 0) return [];
    const query = result<SettingDatabaseRow>(
      await client.query(
        `select id,key,value,value_type,status,version,created_at,updated_at,deleted_at
         from company_settings where company_id=$1 and key=any($2::text[])`,
        [companyId, keys],
      ),
    );
    return query.rows.map(setting);
  }

  public async companySetting(
    companyId: string,
    key: string,
    client: SettingsSqlClient = this.database.pool,
  ): Promise<PersistedSetting | null> {
    const rows = await this.companySettings(companyId, [key], client);
    return rows[0] ?? null;
  }

  public async branchSettings(
    companyId: string,
    branchId: string,
    keys: readonly string[],
    client: SettingsSqlClient = this.database.pool,
  ): Promise<readonly PersistedSetting[]> {
    if (keys.length === 0) return [];
    const query = result<SettingDatabaseRow>(
      await client.query(
        `select id,key,value,value_type,status,version,created_at,updated_at,deleted_at
         from branch_settings where company_id=$1 and branch_id=$2 and key=any($3::text[])`,
        [companyId, branchId, keys],
      ),
    );
    return query.rows.map(setting);
  }

  public async branchSetting(
    companyId: string,
    branchId: string,
    key: string,
    client: SettingsSqlClient = this.database.pool,
  ): Promise<PersistedSetting | null> {
    const rows = await this.branchSettings(companyId, branchId, [key], client);
    return rows[0] ?? null;
  }

  public async lockCompanySetting(
    client: SettingsSqlClient,
    companyId: string,
    key: string,
  ): Promise<PersistedSetting | null> {
    return this.lockSetting(
      client,
      `select id,key,value,value_type,status,version,created_at,updated_at,deleted_at
       from company_settings where company_id=$1 and key=$2 for update`,
      [companyId, key],
    );
  }

  public async lockBranchSetting(
    client: SettingsSqlClient,
    companyId: string,
    branchId: string,
    key: string,
  ): Promise<PersistedSetting | null> {
    return this.lockSetting(
      client,
      `select id,key,value,value_type,status,version,created_at,updated_at,deleted_at
       from branch_settings where company_id=$1 and branch_id=$2 and key=$3 for update`,
      [companyId, branchId, key],
    );
  }

  public setCompanySetting(
    client: SettingsSqlClient,
    input: SetSettingInput,
  ): Promise<PersistedSetting> {
    return this.setSetting(client, 'company_settings', input);
  }

  public setBranchSetting(
    client: SettingsSqlClient,
    input: SetSettingInput & { readonly branchId: string },
  ): Promise<PersistedSetting> {
    return this.setSetting(client, 'branch_settings', input);
  }

  public retireCompanySetting(
    client: SettingsSqlClient,
    input: RetireSettingInput,
  ): Promise<PersistedSetting> {
    return this.retireSetting(client, 'company_settings', input);
  }

  public retireBranchSetting(
    client: SettingsSqlClient,
    input: RetireSettingInput & { readonly branchId: string },
  ): Promise<PersistedSetting> {
    return this.retireSetting(client, 'branch_settings', input);
  }

  public async insertAudit(client: SettingsSqlClient, input: SettingAuditInput): Promise<void> {
    await client.query(
      `insert into audit_log
       (id,company_id,branch_id,actor_type,actor_id,action,entity_type,entity_id,
        request_id,correlation_id,metadata,occurred_at)
       values ($1,$2,$3,'user',$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`,
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
        JSON.stringify(input.metadata),
        input.timestamp,
      ],
    );
  }

  public async insertOutbox(client: SettingsSqlClient, input: SettingOutboxInput): Promise<void> {
    await client.query(
      `insert into outbox_events
       (event_id,company_id,branch_id,event_type,schema_version,aggregate_type,
        aggregate_id,aggregate_version,correlation_id,payload,occurred_at)
       values ($1,$2,$3,$4,1,$5,$6,$7,$8,$9::jsonb,$10)`,
      [
        randomUUID(),
        input.companyId,
        input.branchId ?? null,
        input.eventType,
        input.aggregateType,
        input.aggregateId,
        input.aggregateVersion.toString(),
        input.correlationId,
        JSON.stringify(input.payload),
        input.timestamp,
      ],
    );
  }

  private async lockSetting(
    client: SettingsSqlClient,
    sql: string,
    values: readonly unknown[],
  ): Promise<PersistedSetting | null> {
    const query = result<SettingDatabaseRow>(await client.query(sql, values));
    const row = query.rows[0];
    return row === undefined ? null : setting(row);
  }

  private async setSetting(
    client: SettingsSqlClient,
    table: 'branch_settings' | 'company_settings',
    input: SetSettingInput,
  ): Promise<PersistedSetting> {
    if (input.expectedVersion === 1n) {
      try {
        const columns =
          table === 'company_settings'
            ? '(id,company_id,key,value,value_type,status,version,created_by,updated_by,created_at,updated_at)'
            : '(id,company_id,branch_id,key,value,value_type,status,version,created_by,updated_by,created_at,updated_at)';
        const placeholders =
          table === 'company_settings'
            ? "($1,$2,$3,$4::jsonb,$5,'active',2,$6,$6,$7,$7)"
            : "($1,$2,$3,$4,$5::jsonb,$6,'active',2,$7,$7,$8,$8)";
        const values =
          table === 'company_settings'
            ? [
                randomUUID(),
                input.companyId,
                input.key,
                JSON.stringify(input.value),
                input.valueType,
                input.actorId,
                input.timestamp,
              ]
            : [
                randomUUID(),
                input.companyId,
                input.branchId,
                input.key,
                JSON.stringify(input.value),
                input.valueType,
                input.actorId,
                input.timestamp,
              ];
        const inserted = result<SettingDatabaseRow>(
          await client.query(
            `insert into ${table} ${columns} values ${placeholders} ${RETURNING_SETTING}`,
            values,
          ),
        );
        const row = inserted.rows[0];
        if (row === undefined) throw versionConflict(input.key, input.expectedVersion);
        return setting(row);
      } catch (error) {
        if (isUniqueViolation(error)) throw versionConflict(input.key, input.expectedVersion);
        throw error;
      }
    }

    const scopedWhere =
      table === 'company_settings'
        ? 'company_id=$1 and key=$2 and version=$3'
        : 'company_id=$1 and branch_id=$2 and key=$3 and version=$4';
    const values =
      table === 'company_settings'
        ? [
            input.companyId,
            input.key,
            input.expectedVersion.toString(),
            JSON.stringify(input.value),
            input.valueType,
            input.actorId,
            input.timestamp,
          ]
        : [
            input.companyId,
            input.branchId,
            input.key,
            input.expectedVersion.toString(),
            JSON.stringify(input.value),
            input.valueType,
            input.actorId,
            input.timestamp,
          ];
    const offset = table === 'company_settings' ? 3 : 4;
    const updated = result<SettingDatabaseRow>(
      await client.query(
        `update ${table}
         set value=$${String(offset + 1)}::jsonb,value_type=$${String(offset + 2)},
             status='active',deleted_at=null,updated_by=$${String(offset + 3)},
             updated_at=$${String(offset + 4)},version=version+1
         where ${scopedWhere} ${RETURNING_SETTING}`,
        values,
      ),
    );
    const row = updated.rows[0];
    if (updated.rowCount !== 1 || row === undefined)
      throw versionConflict(input.key, input.expectedVersion);
    return setting(row);
  }

  private async retireSetting(
    client: SettingsSqlClient,
    table: 'branch_settings' | 'company_settings',
    input: RetireSettingInput,
  ): Promise<PersistedSetting> {
    const scopedWhere =
      table === 'company_settings'
        ? 'company_id=$1 and key=$2 and version=$3'
        : 'company_id=$1 and branch_id=$2 and key=$3 and version=$4';
    const values =
      table === 'company_settings'
        ? [
            input.companyId,
            input.key,
            input.expectedVersion.toString(),
            input.actorId,
            input.timestamp,
          ]
        : [
            input.companyId,
            input.branchId,
            input.key,
            input.expectedVersion.toString(),
            input.actorId,
            input.timestamp,
          ];
    const offset = table === 'company_settings' ? 3 : 4;
    const updated = result<SettingDatabaseRow>(
      await client.query(
        `update ${table}
         set status='retired',deleted_at=$${String(offset + 2)},updated_by=$${String(offset + 1)},
             updated_at=$${String(offset + 2)},version=version+1
         where ${scopedWhere} ${RETURNING_SETTING}`,
        values,
      ),
    );
    const row = updated.rows[0];
    if (updated.rowCount !== 1 || row === undefined)
      throw versionConflict(input.key, input.expectedVersion);
    return setting(row);
  }
}
