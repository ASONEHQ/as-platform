import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '../client.js';
import {
  inventoryReconciliationFindingSeverities,
  inventoryReconciliationFindingStatuses,
  inventoryReconciliationFindingTypes,
} from '../schema/inventory.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const integrationDatabaseUrl = databaseUrl ?? 'postgresql://integration-test-disabled';
const integration = databaseUrl === undefined ? describe.skip : describe;

interface Fixture {
  readonly firstCompanyId: string;
  readonly secondCompanyId: string;
  readonly firstBranchId: string;
  readonly secondBranchId: string;
  readonly firstLocationId: string;
  readonly secondLocationId: string;
  readonly firstVariantId: string;
  readonly secondVariantId: string;
  readonly firstActorId: string;
  readonly secondActorId: string;
}

integration('inventory reconciliation findings physical foundation', () => {
  let client: DatabaseClient;

  beforeAll(async () => {
    if (!new URL(integrationDatabaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    client = createDatabaseClient({
      connectionString: integrationDatabaseUrl,
      applicationName: 'asone-reconciliation-findings-test',
    });
    await migrate(client.db, { migrationsFolder: resolve(import.meta.dirname, '../../drizzle') });
  });

  afterAll(async () => {
    await client.close();
  });

  it('applies eleven migrations and exposes exactly the approved table, columns and indexes', async () => {
    const journal = await client.pool.query<{ count: string }>(
      'select count(*)::text as count from drizzle.__drizzle_migrations',
    );
    expect(journal.rows[0]?.count).toBe('11');

    const columns = await client.pool.query<{ column_name: string; data_type: string }>(
      `select column_name,data_type from information_schema.columns
       where table_schema='public' and table_name='inventory_reconciliation_findings'
       order by ordinal_position`,
    );
    expect(columns.rows).toHaveLength(33);
    expect(columns.rows.map((row) => row.column_name)).toEqual(
      expect.arrayContaining([
        'identity_key',
        'fingerprint_sha256',
        'expected_summary',
        'actual_summary',
        'evidence',
        'first_detected_at',
        'last_detected_at',
      ]),
    );
    expect(columns.rows.some((row) => ['real', 'double precision'].includes(row.data_type))).toBe(
      false,
    );

    const indexes = await client.pool.query<{ indexname: string }>(
      `select indexname from pg_indexes
       where schemaname='public' and tablename='inventory_reconciliation_findings'`,
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        'inventory_reconciliation_findings_active_identity_uq',
        'inventory_reconciliation_findings_company_status_severity_idx',
        'inventory_reconciliation_findings_company_type_status_idx',
        'inventory_reconciliation_findings_company_branch_status_idx',
        'inventory_reconciliation_findings_company_location_status_idx',
        'inventory_reconciliation_findings_company_variant_status_idx',
        'inventory_reconciliation_findings_company_aggregate_idx',
        'inventory_reconciliation_findings_last_detected_idx',
        'inventory_reconciliation_findings_snapshot_idx',
        'inventory_reconciliation_findings_detector_version_idx',
        'inventory_reconciliation_findings_open_critical_idx',
      ]),
    );
  });

  it('accepts every approved type, severity and lifecycle state', async () => {
    await inFixtureTransaction(client, async (connection, fixture) => {
      let sequence = 0;
      for (const findingType of inventoryReconciliationFindingTypes) {
        sequence += 1;
        await insertFinding(connection, fixture, {
          findingType,
          identityKey: identity(sequence),
        });
      }
      for (const severity of inventoryReconciliationFindingSeverities) {
        sequence += 1;
        await insertFinding(connection, fixture, { severity, identityKey: identity(sequence) });
      }
      for (const status of inventoryReconciliationFindingStatuses) {
        sequence += 1;
        await insertFinding(connection, fixture, {
          status,
          identityKey: identity(sequence),
          ...lifecycle(status, fixture.firstActorId),
        });
      }
    });
  });

  it('rejects invalid catalogs, fingerprint, JSON, counters and detection times', async () => {
    await inFixtureTransaction(client, async (connection, fixture) => {
      await expectFindingViolation(connection, fixture, 'bad_severity', { severity: 'urgent' });
      await expectFindingViolation(connection, fixture, 'bad_status', { status: 'closed' });
      await expectFindingViolation(connection, fixture, 'bad_type', { findingType: 'unknown' });
      await expectFindingViolation(connection, fixture, 'uppercase_fingerprint', {
        fingerprint: 'A'.repeat(64),
      });
      await expectFindingViolation(connection, fixture, 'short_fingerprint', {
        fingerprint: 'a'.repeat(63),
      });
      await expectFindingViolation(connection, fixture, 'array_summary', {
        expectedSummary: [],
      });
      await expectFindingViolation(connection, fixture, 'zero_occurrences', {
        occurrenceCount: 0,
      });
      await expectFindingViolation(connection, fixture, 'zero_version', { version: 0 });
      await expectFindingViolation(connection, fixture, 'bad_time_order', {
        firstDetectedAt: '2030-01-02T00:00:00.000Z',
        lastDetectedAt: '2030-01-01T00:00:00.000Z',
      });
    });
  });

  it('enforces lifecycle metadata and accepts valid JSON objects', async () => {
    await inFixtureTransaction(client, async (connection, fixture) => {
      await insertFinding(connection, fixture, {
        identityKey: identity(1),
        expectedSummary: { expected: '1.000000' },
        actualSummary: { actual: '0.000000' },
        evidence: { safe: true },
        metadata: { source: 'bounded-scan' },
      });
      await expectFindingViolation(connection, fixture, 'ack_without_actor', {
        status: 'acknowledged',
        acknowledgedAt: new Date().toISOString(),
      });
      await expectFindingViolation(connection, fixture, 'resolved_without_actor', {
        status: 'resolved',
        resolvedAt: new Date().toISOString(),
      });
      await expectFindingViolation(connection, fixture, 'dismissed_without_reason', {
        status: 'dismissed',
        dismissedAt: new Date().toISOString(),
        dismissedBy: fixture.firstActorId,
      });
    });
  });

  it('rejects cross-tenant branch, location, variant and lifecycle actors', async () => {
    await inFixtureTransaction(client, async (connection, fixture) => {
      await expectFindingViolation(
        connection,
        fixture,
        'cross_branch',
        {
          branchId: fixture.secondBranchId,
        },
        '23503',
      );
      await expectFindingViolation(
        connection,
        fixture,
        'cross_location',
        {
          inventoryLocationId: fixture.secondLocationId,
        },
        '23503',
      );
      await expectFindingViolation(
        connection,
        fixture,
        'cross_variant',
        {
          productVariantId: fixture.secondVariantId,
        },
        '23503',
      );
      await expectFindingViolation(
        connection,
        fixture,
        'cross_actor',
        {
          status: 'acknowledged',
          acknowledgedAt: new Date().toISOString(),
          acknowledgedBy: fixture.secondActorId,
        },
        '23503',
      );
    });
  });

  it('deduplicates active identities while retaining terminal revision history', async () => {
    await inFixtureTransaction(client, async (connection, fixture) => {
      await insertFinding(connection, fixture, { identityKey: 'stable:key' });
      await expectFindingViolation(
        connection,
        fixture,
        'duplicate_active',
        { identityKey: 'stable:key' },
        '23505',
      );
      await connection.query(
        `update inventory_reconciliation_findings
         set status='resolved',resolved_at=now(),resolved_by=$1,updated_at=now(),version=version+1
         where company_id=$2 and identity_key='stable:key'`,
        [fixture.firstActorId, fixture.firstCompanyId],
      );
      await insertFinding(connection, fixture, { identityKey: 'stable:key' });
      const revisions = await connection.query<{ count: string }>(
        `select count(*)::text as count from inventory_reconciliation_findings
         where company_id=$1 and identity_key='stable:key'`,
        [fixture.firstCompanyId],
      );
      expect(revisions.rows[0]?.count).toBe('2');
    });
  });

  it('allows one concurrent active winner and the same identity in another company', async () => {
    const setup = await client.pool.connect();
    let fixture: Fixture | undefined;
    try {
      await setup.query('begin');
      fixture = await insertFixture(setup);
      await setup.query('commit');

      const options = { identityKey: 'concurrent:key' } as const;
      const settled = await Promise.allSettled([
        insertFinding(client.pool, fixture, options),
        insertFinding(client.pool, fixture, options),
      ]);
      expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = settled.filter((result) => result.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatchObject({
        reason: {
          code: '23505',
          constraint: 'inventory_reconciliation_findings_active_identity_uq',
        },
      });
      await insertFinding(client.pool, fixture, {
        companyId: fixture.secondCompanyId,
        identityKey: 'concurrent:key',
      });
      const active = await client.pool.query<{ count: string }>(
        `select count(*)::text as count from inventory_reconciliation_findings
         where company_id=$1 and identity_key='concurrent:key' and status in ('open','acknowledged')`,
        [fixture.firstCompanyId],
      );
      expect(active.rows[0]?.count).toBe('1');
    } finally {
      await setup.query('rollback').catch(() => undefined);
      setup.release();
      if (fixture) {
        await deleteFixture(client, fixture.firstCompanyId);
        await deleteFixture(client, fixture.secondCompanyId);
      }
    }
  });
});

interface FindingOptions {
  readonly companyId?: string;
  readonly branchId?: string | null;
  readonly inventoryLocationId?: string | null;
  readonly productVariantId?: string | null;
  readonly findingType?: string;
  readonly severity?: string;
  readonly status?: string;
  readonly identityKey?: string;
  readonly fingerprint?: string;
  readonly firstDetectedAt?: string;
  readonly lastDetectedAt?: string;
  readonly occurrenceCount?: number;
  readonly expectedSummary?: unknown;
  readonly actualSummary?: unknown;
  readonly evidence?: unknown;
  readonly metadata?: unknown;
  readonly acknowledgedAt?: string | null;
  readonly acknowledgedBy?: string | null;
  readonly resolvedAt?: string | null;
  readonly resolvedBy?: string | null;
  readonly dismissedAt?: string | null;
  readonly dismissedBy?: string | null;
  readonly resolutionReasonCode?: string | null;
  readonly version?: number;
}

async function insertFinding(
  connection: Pick<PoolClient, 'query'>,
  fixture: Fixture,
  options: FindingOptions = {},
): Promise<void> {
  const now = '2030-01-01T00:00:00.000Z';
  const secondCompany = options.companyId === fixture.secondCompanyId;
  await connection.query(
    `insert into inventory_reconciliation_findings
     (id,company_id,branch_id,inventory_location_id,product_variant_id,
      aggregate_type,aggregate_id,finding_type,severity,status,identity_key,
      fingerprint_sha256,detector_version,snapshot_at,first_detected_at,last_detected_at,
      occurrence_count,expected_summary,actual_summary,evidence,metadata,
      acknowledged_at,acknowledged_by,resolved_at,resolved_by,dismissed_at,dismissed_by,
      resolution_reason_code,version)
     values ($1,$2,$3,$4,$5,'inventory_balance',$6,$7,$8,$9,$10,$11,'v1',$12,$13,$14,
             $15,$16::jsonb,$17::jsonb,$18::jsonb,$19::jsonb,$20,$21,$22,$23,$24,$25,$26,$27)`,
    [
      randomUUID(),
      options.companyId ?? fixture.firstCompanyId,
      options.branchId === undefined
        ? secondCompany
          ? fixture.secondBranchId
          : fixture.firstBranchId
        : options.branchId,
      options.inventoryLocationId === undefined
        ? secondCompany
          ? fixture.secondLocationId
          : fixture.firstLocationId
        : options.inventoryLocationId,
      options.productVariantId === undefined
        ? secondCompany
          ? fixture.secondVariantId
          : fixture.firstVariantId
        : options.productVariantId,
      randomUUID(),
      options.findingType ?? 'balance_on_hand_drift',
      options.severity ?? 'critical',
      options.status ?? 'open',
      options.identityKey ?? `identity:${randomUUID()}`,
      options.fingerprint ?? 'a'.repeat(64),
      now,
      options.firstDetectedAt ?? now,
      options.lastDetectedAt ?? now,
      options.occurrenceCount ?? 1,
      JSON.stringify(options.expectedSummary ?? {}),
      JSON.stringify(options.actualSummary ?? {}),
      JSON.stringify(options.evidence ?? {}),
      options.metadata === undefined ? null : JSON.stringify(options.metadata),
      options.acknowledgedAt ?? null,
      options.acknowledgedBy ?? null,
      options.resolvedAt ?? null,
      options.resolvedBy ?? null,
      options.dismissedAt ?? null,
      options.dismissedBy ?? null,
      options.resolutionReasonCode ?? null,
      options.version ?? 1,
    ],
  );
}

async function expectFindingViolation(
  connection: PoolClient,
  fixture: Fixture,
  savepoint: string,
  options: FindingOptions,
  code = '23514',
): Promise<void> {
  await connection.query(`savepoint ${savepoint}`);
  await expect(insertFinding(connection, fixture, options)).rejects.toMatchObject({ code });
  await connection.query(`rollback to savepoint ${savepoint}`);
}

function lifecycle(status: string, actorId: string): FindingOptions {
  const at = '2030-01-01T00:00:00.000Z';
  if (status === 'acknowledged') return { acknowledgedAt: at, acknowledgedBy: actorId };
  if (status === 'resolved') return { resolvedAt: at, resolvedBy: actorId };
  if (status === 'dismissed')
    return { dismissedAt: at, dismissedBy: actorId, resolutionReasonCode: 'false_positive' };
  return {};
}

function identity(sequence: number): string {
  return `identity:${sequence.toString().padStart(2, '0')}`;
}

async function inFixtureTransaction(
  client: DatabaseClient,
  assertion: (connection: PoolClient, fixture: Fixture) => Promise<void>,
): Promise<void> {
  const connection = await client.pool.connect();
  try {
    await connection.query('begin');
    const fixture = await insertFixture(connection);
    await assertion(connection, fixture);
  } finally {
    await connection.query('rollback').catch(() => undefined);
    connection.release();
  }
}

async function insertFixture(connection: PoolClient): Promise<Fixture> {
  const firstCompanyId = randomUUID();
  const secondCompanyId = randomUUID();
  const firstBranchId = randomUUID();
  const secondBranchId = randomUUID();
  const firstActorId = randomUUID();
  const secondActorId = randomUUID();
  const firstProductId = randomUUID();
  const secondProductId = randomUUID();
  const firstVariantId = randomUUID();
  const secondVariantId = randomUUID();
  const firstLocationId = randomUUID();
  const secondLocationId = randomUUID();
  await connection.query(
    `insert into companies (id,legal_name,display_name,slug,status,timezone,currency_code,locale)
     values ($1,'First','First',$2,'active','UTC','MXN','es-MX'),
            ($3,'Second','Second',$4,'active','UTC','MXN','es-MX')`,
    [firstCompanyId, `rec-${firstCompanyId}`, secondCompanyId, `rec-${secondCompanyId}`],
  );
  await connection.query(
    `insert into users (id,email,normalized_email,display_name,status)
     values ($1,$2,$2,'First Actor','active'),($3,$4,$4,'Second Actor','active')`,
    [
      firstActorId,
      `first-${firstActorId}@example.test`,
      secondActorId,
      `second-${secondActorId}@example.test`,
    ],
  );
  await connection.query(
    `insert into company_memberships (id,company_id,user_id,status)
     values ($1,$2,$3,'active'),($4,$5,$6,'active')`,
    [randomUUID(), firstCompanyId, firstActorId, randomUUID(), secondCompanyId, secondActorId],
  );
  await connection.query(
    `insert into branches (id,company_id,name,code,status,timezone)
     values ($1,$2,'First','MAIN','active','UTC'),($3,$4,'Second','MAIN','active','UTC')`,
    [firstBranchId, firstCompanyId, secondBranchId, secondCompanyId],
  );
  await connection.query(
    `insert into units_of_measure
     (code,name,dimension,quantity_scale,conversion_factor_to_base,status)
     values ('unit','Unit','count',0,1,'active') on conflict (code) do nothing`,
  );
  await connection.query(
    `insert into products
     (id,company_id,code,normalized_code,name,product_type,tracks_inventory,status,created_by,updated_by)
     values ($1,$2,'P','p','Product','simple',true,'active',$3,$3),
            ($4,$5,'P','p','Product','simple',true,'active',$6,$6)`,
    [firstProductId, firstCompanyId, firstActorId, secondProductId, secondCompanyId, secondActorId],
  );
  await connection.query(
    `insert into product_variants
     (id,company_id,product_id,sku,normalized_sku,name,unit_of_measure_code,quantity_scale,
      tracks_inventory,standard_cost,currency_code,is_default,option_signature,status,created_by,updated_by)
     values ($1,$2,$3,'SKU','sku','Variant','unit',0,true,0,'MXN',true,$4,'active',$5,$5),
            ($6,$7,$8,'SKU','sku','Variant','unit',0,true,0,'MXN',true,$4,'active',$9,$9)`,
    [
      firstVariantId,
      firstCompanyId,
      firstProductId,
      '0'.repeat(64),
      firstActorId,
      secondVariantId,
      secondCompanyId,
      secondProductId,
      secondActorId,
    ],
  );
  await connection.query(
    `insert into inventory_locations
     (id,company_id,branch_id,code,normalized_code,name,location_type,created_by,updated_by)
     values ($1,$2,$3,'MAIN','main','Main','main',$4,$4),
            ($5,$6,$7,'MAIN','main','Main','main',$8,$8)`,
    [
      firstLocationId,
      firstCompanyId,
      firstBranchId,
      firstActorId,
      secondLocationId,
      secondCompanyId,
      secondBranchId,
      secondActorId,
    ],
  );
  return {
    firstCompanyId,
    secondCompanyId,
    firstBranchId,
    secondBranchId,
    firstLocationId,
    secondLocationId,
    firstVariantId,
    secondVariantId,
    firstActorId,
    secondActorId,
  };
}

async function deleteFixture(client: DatabaseClient, companyId: string): Promise<void> {
  const users = await client.pool.query<{ user_id: string }>(
    'select user_id from company_memberships where company_id=$1',
    [companyId],
  );
  await client.pool.query('delete from inventory_reconciliation_findings where company_id=$1', [
    companyId,
  ]);
  await client.pool.query('delete from inventory_locations where company_id=$1', [companyId]);
  await client.pool.query('delete from product_variants where company_id=$1', [companyId]);
  await client.pool.query('delete from products where company_id=$1', [companyId]);
  await client.pool.query('delete from branches where company_id=$1', [companyId]);
  await client.pool.query('delete from company_memberships where company_id=$1', [companyId]);
  await client.pool.query('delete from companies where id=$1', [companyId]);
  for (const row of users.rows)
    await client.pool.query('delete from users where id=$1', [row.user_id]);
}
