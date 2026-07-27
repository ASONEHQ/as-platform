import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { SettingsRepository } from './settings.repository.js';
import {
  SettingsService,
  type AuditedSettingMutation,
  type SettingMutation,
} from './settings.service.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const integrationDatabaseUrl = databaseUrl ?? 'postgresql://settings-integration-test-disabled';
const integration = databaseUrl === undefined ? describe.skip : describe;
const migrationsPath = resolve(import.meta.dirname, '../../../../../packages/database/drizzle');

interface TenantFixture {
  readonly companyId: string;
  readonly branchId: string;
  readonly userId: string;
}

integration('PostgreSQL settings repository', () => {
  let database: DatabaseClient;
  let service: SettingsService;
  const fixtures: TenantFixture[] = [];

  beforeAll(async () => {
    if (!new URL(integrationDatabaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({
      connectionString: integrationDatabaseUrl,
      applicationName: 'asone-settings-test',
    });
    await ensureMigrations(database);
    service = new SettingsService(new SettingsRepository(database));
  });

  afterEach(async () => {
    for (const fixture of fixtures.splice(0)) {
      await database.pool.query('delete from outbox_events where company_id=$1', [
        fixture.companyId,
      ]);
      await database.pool.query('delete from audit_log where company_id=$1', [fixture.companyId]);
      await database.pool.query('delete from branch_settings where company_id=$1', [
        fixture.companyId,
      ]);
      await database.pool.query('delete from company_settings where company_id=$1', [
        fixture.companyId,
      ]);
      await database.pool.query('delete from branches where company_id=$1', [fixture.companyId]);
      await database.pool.query('delete from companies where id=$1', [fixture.companyId]);
      await database.pool.query('delete from users where id=$1', [fixture.userId]);
    }
  });

  afterAll(async () => {
    await database.close();
  });

  it('isolates company and branch reads by authenticated company scope', async () => {
    const first = await createTenant(database, fixtures, 'first');
    const second = await createTenant(database, fixtures, 'second');
    await service.setCompanySetting(
      { companyId: first.companyId },
      mutation(first.userId, 'business.locale', 'en-US', 1n),
    );

    const firstSettings = await service.effectiveCompanySettings({ companyId: first.companyId }, [
      'business.locale',
    ]);
    const secondSettings = await service.effectiveCompanySettings({ companyId: second.companyId }, [
      'business.locale',
    ]);
    expect(firstSettings.settings[0]).toMatchObject({ source: 'company', value: 'en-US' });
    expect(secondSettings.settings[0]).toMatchObject({ source: 'default', value: 'es-MX' });

    await expect(
      service.effectiveBranchSettings(
        {
          companyId: first.companyId,
          branchId: second.branchId,
          permittedBranchIds: [second.branchId],
        },
        ['business.locale'],
      ),
    ).rejects.toMatchObject({ code: 'branch_not_found' });
  });

  it('performs atomic set, update, retirement, and reactivation without hard delete', async () => {
    const tenant = await createTenant(database, fixtures, 'lifecycle');
    const created = await service.setCompanySetting(
      { companyId: tenant.companyId },
      mutation(tenant.userId, 'business.locale', 'en-US', 1n),
    );
    expect(created.version).toBe(2n);

    const updated = await service.setCompanySetting(
      { companyId: tenant.companyId },
      mutation(tenant.userId, 'business.locale', 'es-MX', 2n),
    );
    expect(updated.version).toBe(3n);
    await expect(
      service.setCompanySetting(
        { companyId: tenant.companyId },
        mutation(tenant.userId, 'business.locale', 'en-US', 2n),
      ),
    ).rejects.toMatchObject({ code: 'version_conflict' });

    const retired = await service.retireCompanySetting(
      { companyId: tenant.companyId },
      mutation(tenant.userId, 'business.locale', 'en-US', 3n),
    );
    expect(retired).toMatchObject({ status: 'retired', value: 'es-MX', version: 4n });
    const inherited = await service.effectiveCompanySettings({ companyId: tenant.companyId }, [
      'business.locale',
    ]);
    expect(inherited.settings[0]).toMatchObject({
      source: 'default',
      value: 'es-MX',
      version: 4n,
    });

    const reactivated = await service.setCompanySetting(
      { companyId: tenant.companyId },
      mutation(tenant.userId, 'business.locale', 'en-US', 4n),
    );
    expect(reactivated).toMatchObject({ id: created.id, status: 'active', version: 5n });
    const count = await database.pool.query<{ count: string }>(
      'select count(*) from company_settings where company_id=$1 and key=$2',
      [tenant.companyId, 'business.locale'],
    );
    expect(count.rows[0]?.count).toBe('1');
  });

  it('resolves branch lifecycle through the composed tenant scope', async () => {
    const tenant = await createTenant(database, fixtures, 'branch');
    await service.setCompanySetting(
      { companyId: tenant.companyId },
      mutation(tenant.userId, 'business.locale', 'en-US', 1n),
    );
    const scope = {
      companyId: tenant.companyId,
      branchId: tenant.branchId,
      permittedBranchIds: [tenant.branchId],
    };
    const branch = await service.setBranchSetting(
      scope,
      mutation(tenant.userId, 'business.locale', 'es-MX', 1n),
    );
    expect(branch.version).toBe(2n);
    expect(
      (await service.effectiveBranchSettings(scope, ['business.locale'])).settings[0],
    ).toMatchObject({
      source: 'branch',
      value: 'es-MX',
      version: 2n,
    });

    await service.retireBranchSetting(
      scope,
      mutation(tenant.userId, 'business.locale', 'es-MX', 2n),
    );
    expect(
      (await service.effectiveBranchSettings(scope, ['business.locale'])).settings[0],
    ).toMatchObject({
      source: 'company',
      value: 'en-US',
      version: 3n,
    });
  });

  it('translates concurrent first writes into one row and one version conflict', async () => {
    const tenant = await createTenant(database, fixtures, 'concurrent');
    const attempts = await Promise.allSettled([
      service.setCompanySetting(
        { companyId: tenant.companyId },
        mutation(tenant.userId, 'ui.time_format', '12h', 1n),
      ),
      service.setCompanySetting(
        { companyId: tenant.companyId },
        mutation(tenant.userId, 'ui.time_format', '24h', 1n),
      ),
    ]);
    expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = attempts.find(({ status }) => status === 'rejected');
    expect(rejected?.status).toBe('rejected');
    if (rejected?.status !== 'rejected') throw new Error('Expected one rejected first write.');
    const reason: unknown = rejected.reason;
    expect(reason).toMatchObject({ code: 'version_conflict' });
    const count = await database.pool.query<{ count: string }>(
      'select count(*) from company_settings where company_id=$1 and key=$2',
      [tenant.companyId, 'ui.time_format'],
    );
    expect(count.rows[0]?.count).toBe('1');
  });

  it('atomically records company lifecycle audit and safe outbox events', async () => {
    const tenant = await createTenant(database, fixtures, 'controlled-company');
    const scope = { companyId: tenant.companyId };
    const created = await service.mutateCompanySetting(
      scope,
      auditedMutation(tenant.userId, 'business.locale', 'en-US', 1n, 'create'),
      'active',
    );
    const updated = await service.mutateCompanySetting(
      scope,
      auditedMutation(tenant.userId, 'business.locale', 'es-MX', 2n, 'update'),
      'active',
    );
    const retired = await service.mutateCompanySetting(
      scope,
      auditedMutation(tenant.userId, 'business.locale', 'es-MX', 3n, 'retire'),
      'retired',
    );
    const reactivated = await service.mutateCompanySetting(
      scope,
      auditedMutation(tenant.userId, 'business.locale', 'en-US', 4n, 'reactivate'),
      'active',
    );

    expect([created, updated, retired, reactivated].map(({ persisted }) => persisted.id)).toEqual([
      created.persisted.id,
      created.persisted.id,
      created.persisted.id,
      created.persisted.id,
    ]);
    expect(reactivated.persisted).toMatchObject({
      status: 'active',
      version: 5n,
      deletedAt: null,
    });
    expect(retired.persisted).toMatchObject({
      status: 'retired',
      value: 'es-MX',
      version: 4n,
    });

    const audits = await database.pool.query<{
      action: string;
      entity_id: string;
      request_id: string;
      correlation_id: string;
      metadata: Record<string, unknown>;
    }>(
      `select action,entity_id,request_id,correlation_id,metadata
       from audit_log where company_id=$1 and entity_type='company_setting'
       order by (metadata->>'version_after')::bigint`,
      [tenant.companyId],
    );
    expect(audits.rows).toHaveLength(4);
    expect(audits.rows.map(({ action }) => action)).toEqual([
      'company_setting.updated',
      'company_setting.updated',
      'company_setting.retired',
      'company_setting.updated',
    ]);
    expect(audits.rows.every(({ entity_id }) => entity_id === created.persisted.id)).toBe(true);
    expect(audits.rows[0]).toMatchObject({
      request_id: 'request-create',
      correlation_id: 'correlation-create',
      metadata: {
        key: 'business.locale',
        source_before: 'default',
        source_after: 'company',
        version_before: 1,
        version_after: 2,
        effective_value_changed: true,
      },
    });

    const events = await database.pool.query<{
      event_type: string;
      aggregate_type: string;
      aggregate_id: string;
      aggregate_version: string;
      correlation_id: string;
      payload: Record<string, unknown>;
    }>(
      `select event_type,aggregate_type,aggregate_id,aggregate_version,correlation_id,payload
       from outbox_events where company_id=$1 and aggregate_type='company_setting'
       order by aggregate_version`,
      [tenant.companyId],
    );
    expect(events.rows).toHaveLength(4);
    expect(events.rows.every(({ event_type }) => event_type === 'company_setting.changed')).toBe(
      true,
    );
    expect(events.rows.map(({ aggregate_version }) => aggregate_version)).toEqual([
      '2',
      '3',
      '4',
      '5',
    ]);
    expect(events.rows.every(({ aggregate_id }) => aggregate_id === created.persisted.id)).toBe(
      true,
    );
    expect(JSON.stringify(audits.rows.map(({ metadata }) => metadata))).not.toContain('en-US');
    expect(JSON.stringify(events.rows.map(({ payload }) => payload))).not.toContain('en-US');
  });

  it('records branch scope and leaves no evidence for a version conflict', async () => {
    const tenant = await createTenant(database, fixtures, 'controlled-branch');
    const scope = {
      companyId: tenant.companyId,
      branchId: tenant.branchId,
      permittedBranchIds: [tenant.branchId],
    };
    const created = await service.mutateBranchSetting(
      scope,
      auditedMutation(tenant.userId, 'business.locale', 'en-US', 1n, 'branch-create'),
      'active',
    );
    await expect(
      service.mutateBranchSetting(
        scope,
        auditedMutation(tenant.userId, 'business.locale', 'es-MX', 1n, 'stale'),
        'active',
      ),
    ).rejects.toMatchObject({ code: 'version_conflict' });

    const controls = await database.pool.query<{
      branch_id: string;
      action: string;
      entity_id: string;
    }>(
      `select branch_id,action,entity_id from audit_log
       where company_id=$1 and entity_type='branch_setting'`,
      [tenant.companyId],
    );
    expect(controls.rows).toEqual([
      {
        branch_id: tenant.branchId,
        action: 'branch_setting.updated',
        entity_id: created.persisted.id,
      },
    ]);
    const events = await database.pool.query<{ branch_id: string; count: string }>(
      `select branch_id,count(*)::text count from outbox_events
       where company_id=$1 and aggregate_type='branch_setting' group by branch_id`,
      [tenant.companyId],
    );
    expect(events.rows).toEqual([{ branch_id: tenant.branchId, count: '1' }]);
  });

  it('rolls back setting and audit when outbox insertion fails', async () => {
    const tenant = await createTenant(database, fixtures, 'controlled-rollback');
    class FailingOutboxRepository extends SettingsRepository {
      public override insertOutbox(): Promise<void> {
        return Promise.reject(new Error('forced outbox failure'));
      }
    }
    const failingService = new SettingsService(new FailingOutboxRepository(database));
    await expect(
      failingService.mutateCompanySetting(
        { companyId: tenant.companyId },
        auditedMutation(tenant.userId, 'business.locale', 'en-US', 1n, 'rollback'),
        'active',
      ),
    ).rejects.toThrow('forced outbox failure');
    const persisted = await database.pool.query<{ count: string }>(
      'select count(*)::text count from company_settings where company_id=$1',
      [tenant.companyId],
    );
    const audit = await database.pool.query<{ count: string }>(
      'select count(*)::text count from audit_log where company_id=$1',
      [tenant.companyId],
    );
    const outbox = await database.pool.query<{ count: string }>(
      'select count(*)::text count from outbox_events where company_id=$1',
      [tenant.companyId],
    );
    expect([persisted.rows[0]?.count, audit.rows[0]?.count, outbox.rows[0]?.count]).toEqual([
      '0',
      '0',
      '0',
    ]);
  });

  it('allows only the concurrent winner to write audit and outbox', async () => {
    const tenant = await createTenant(database, fixtures, 'controlled-concurrency');
    const attempts = await Promise.allSettled([
      service.mutateCompanySetting(
        { companyId: tenant.companyId },
        auditedMutation(tenant.userId, 'ui.time_format', '12h', 1n, 'winner-a'),
        'active',
      ),
      service.mutateCompanySetting(
        { companyId: tenant.companyId },
        auditedMutation(tenant.userId, 'ui.time_format', '24h', 1n, 'winner-b'),
        'active',
      ),
    ]);
    expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    const counts = await database.pool.query<{ audits: string; events: string }>(
      `select
         (select count(*)::text from audit_log where company_id=$1) audits,
         (select count(*)::text from outbox_events where company_id=$1) events`,
      [tenant.companyId],
    );
    expect(counts.rows[0]).toEqual({ audits: '1', events: '1' });
  });
});

function mutation(
  actorId: string,
  key: string,
  value: unknown,
  expectedVersion: bigint,
): SettingMutation {
  return {
    key,
    value,
    valueType: 'string' as const,
    expectedVersion,
    actorId,
    timestamp: new Date(),
  };
}

function auditedMutation(
  actorId: string,
  key: string,
  value: unknown,
  expectedVersion: bigint,
  suffix: string,
): AuditedSettingMutation {
  return {
    ...mutation(actorId, key, value, expectedVersion),
    requestId: `request-${suffix}`,
    correlationId: `correlation-${suffix}`,
  };
}

async function ensureMigrations(database: DatabaseClient): Promise<void> {
  const settings = await database.pool.query<{ present: string | null }>(
    `select to_regclass('public.company_settings')::text present`,
  );
  if (settings.rows[0]?.present !== null) return;
  const foundation = await database.pool.query<{ present: string | null }>(
    `select to_regclass('public.companies')::text present`,
  );
  const names =
    foundation.rows[0]?.present === null
      ? [
          '0000_fantastic_black_cat.sql',
          '0001_high_thor.sql',
          '0002_true_sugar_man.sql',
          '0003_curved_zuras.sql',
        ]
      : ['0003_curved_zuras.sql'];
  for (const name of names) {
    const sql = await readFile(resolve(migrationsPath, name), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint'))
      if (statement.trim().length > 0) await database.pool.query(statement);
  }
}

async function createTenant(
  database: DatabaseClient,
  fixtures: TenantFixture[],
  prefix: string,
): Promise<TenantFixture> {
  const fixture = {
    companyId: randomUUID(),
    branchId: randomUUID(),
    userId: randomUUID(),
  };
  await database.pool.query(
    `insert into companies
     (id,legal_name,display_name,slug,status,timezone,currency_code,locale)
     values ($1,$2,$2,$3,'active','America/Mexico_City','MXN','es-MX')`,
    [fixture.companyId, `${prefix} Company`, `${prefix}-${fixture.companyId}`],
  );
  await database.pool.query(
    `insert into users (id,email,normalized_email,display_name,status)
     values ($1,$2,$2,$3,'active')`,
    [fixture.userId, `${prefix}-${fixture.userId}@example.test`, `${prefix} User`],
  );
  await database.pool.query(
    `insert into branches (id,company_id,name,code,status,timezone)
     values ($1,$2,$3,$4,'active','America/Mexico_City')`,
    [fixture.branchId, fixture.companyId, `${prefix} Branch`, prefix.toUpperCase()],
  );
  fixtures.push(fixture);
  return fixture;
}
