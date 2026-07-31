import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '../client.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const integrationDatabaseUrl = databaseUrl ?? 'postgresql://integration-test-disabled';
const integration = databaseUrl === undefined ? describe.skip : describe;

interface Fixture {
  actorId: string;
  companyId: string;
  otherCompanyId: string;
  branchId: string;
  otherBranchId: string;
  locationId: string;
  secondLocationId: string;
  otherLocationId: string;
  variantId: string;
  otherVariantId: string;
  movementId: string;
  otherMovementId: string;
}

integration('durable inventory count physical foundation', () => {
  let client: DatabaseClient;

  beforeAll(async () => {
    if (!new URL(integrationDatabaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    client = createDatabaseClient({
      connectionString: integrationDatabaseUrl,
      applicationName: 'asone-count-foundation-test',
    });
    await migrate(client.db, { migrationsFolder: resolve(import.meta.dirname, '../../drizzle') });
  });

  afterAll(async () => client.close());

  it('applies all nine migrations and creates exactly two count tables', async () => {
    const journal = await client.pool.query<{ count: string }>(
      'select count(*)::text count from drizzle.__drizzle_migrations',
    );
    expect(journal.rows[0]?.count).toBe('9');
    const tables = await client.pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema='public' and table_name like 'inventory_count%'
       order by table_name`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      'inventory_count_lines',
      'inventory_counts',
    ]);
  });

  it('enforces count number, state, scope, tenant, location, actor, and movement constraints', async () => {
    await inTransaction(client, async (connection) => {
      const fixture = await insertFixture(connection);
      await insertDraftCount(connection, fixture, randomUUID(), countNumber());
      await expectViolation(
        connection,
        'duplicate_number',
        draftCountSql,
        draftCountValues(fixture, randomUUID(), 'CNT-00000000000070008000000000000000'),
        '23505',
        async () => {
          await insertDraftCount(
            connection,
            fixture,
            randomUUID(),
            'CNT-00000000000070008000000000000000',
          );
        },
      );
      await expectViolation(
        connection,
        'bad_number',
        draftCountSql,
        draftCountValues(fixture, randomUUID(), 'COUNT-1'),
        '23514',
      );
      await expectViolation(
        connection,
        'bad_status',
        draftCountSql.replace("'draft'", "'rejected'"),
        draftCountValues(fixture, randomUUID(), countNumber()),
        '23514',
      );
      await expectViolation(
        connection,
        'bad_scope',
        draftCountSql,
        draftCountValues(fixture, randomUUID(), countNumber(), { scopeType: 'category' }),
        '23514',
      );
      await expectViolation(
        connection,
        'bad_location_branch',
        draftCountSql,
        draftCountValues(fixture, randomUUID(), countNumber(), {
          locationId: fixture.otherLocationId,
        }),
        '23503',
      );
      await expectViolation(
        connection,
        'bad_actor',
        countingCountSql,
        countingCountValues(fixture, randomUUID(), countNumber(), {
          actorId: randomUUID(),
        }),
        '23503',
      );
      await expectViolation(
        connection,
        'bad_application_movement',
        appliedCountSql,
        appliedCountValues(fixture, randomUUID(), countNumber(), fixture.otherMovementId),
        '23503',
      );
    });
  });

  it('enforces line scope, uniqueness, quantities, UOM, and counting evidence', async () => {
    await inTransaction(client, async (connection) => {
      const fixture = await insertFixture(connection);
      const countId = randomUUID();
      await insertCountingCount(connection, fixture, countId, countNumber());
      await connection.query(lineSql, lineValues(fixture, countId, randomUUID(), '1.123456', null));
      const uncounted = await connection.query<{
        counted_quantity: string | null;
        expected_quantity: string;
      }>(
        `select expected_quantity::text, counted_quantity::text
         from inventory_count_lines where inventory_count_id=$1`,
        [countId],
      );
      expect(uncounted.rows).toEqual([{ counted_quantity: null, expected_quantity: '1.123456' }]);
      await connection.query(
        `update inventory_count_lines
         set counted_quantity=0,first_counted_at=now(),last_counted_at=now(),counted_by=$2
         where inventory_count_id=$1`,
        [countId, fixture.actorId],
      );
      const counted = await connection.query<{ counted_quantity: string | null }>(
        `select counted_quantity::text from inventory_count_lines where inventory_count_id=$1`,
        [countId],
      );
      expect(counted.rows[0]?.counted_quantity).toBe('0.000000');
      await expectViolation(
        connection,
        'duplicate_line',
        lineSql,
        lineValues(fixture, countId, randomUUID(), '1', null),
        '23505',
      );
      await connection.query('delete from inventory_count_lines where inventory_count_id=$1', [
        countId,
      ]);
      await expectViolation(
        connection,
        'cross_variant',
        lineSql,
        lineValues(fixture, countId, randomUUID(), '1', null),
        '23503',
        undefined,
        fixture.otherVariantId,
      );
      await expectViolation(
        connection,
        'negative_expected',
        lineSql,
        lineValues(fixture, countId, randomUUID(), '-1', null),
        '23514',
      );
      await expectViolation(
        connection,
        'negative_counted',
        lineSql,
        lineValues(fixture, countId, randomUUID(), '1', '-1'),
        '23514',
      );
      await expectViolation(
        connection,
        'bad_uom',
        lineSql,
        lineValues(fixture, countId, randomUUID(), '1', null, { unit: 'missing' }),
        '23503',
      );
      await expectViolation(
        connection,
        'cross_movement',
        lineSql,
        lineValues(fixture, countId, randomUUID(), '1', null, {
          baselineMovementId: fixture.otherMovementId,
        }),
        '23503',
      );
    });
  });

  it('exposes exact numeric types and the justified physical indexes', async () => {
    const columns = await client.pool.query<{
      column_name: string;
      data_type: string;
      numeric_precision: number | null;
      numeric_scale: number | null;
    }>(
      `select column_name,data_type,numeric_precision,numeric_scale
       from information_schema.columns
       where table_schema='public' and table_name='inventory_count_lines'
         and column_name in ('expected_quantity','counted_quantity')
       order by column_name`,
    );
    expect(columns.rows).toEqual([
      {
        column_name: 'counted_quantity',
        data_type: 'numeric',
        numeric_precision: 19,
        numeric_scale: 6,
      },
      {
        column_name: 'expected_quantity',
        data_type: 'numeric',
        numeric_precision: 19,
        numeric_scale: 6,
      },
    ]);
    const floatColumns = await client.pool.query<{ count: string }>(
      `select count(*)::text count from information_schema.columns
       where table_schema='public' and table_name in ('inventory_counts','inventory_count_lines')
         and data_type in ('real','double precision')`,
    );
    expect(floatColumns.rows[0]?.count).toBe('0');
    const indexes = await client.pool.query<{ indexname: string }>(
      `select indexname from pg_indexes
       where schemaname='public' and tablename in ('inventory_counts','inventory_count_lines')`,
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        'inventory_counts_active_location_uq',
        'inventory_counts_lock_expiry_idx',
        'inventory_count_lines_incomplete_idx',
        'inventory_count_lines_baseline_movement_idx',
      ]),
    );
  });

  it('allows exactly one concurrent active count per location', async () => {
    const setup = await client.pool.connect();
    let fixture: Fixture | undefined;
    try {
      await setup.query('begin');
      fixture = await insertFixture(setup);
      await setup.query('commit');

      const first = client.pool.query(
        countingCountSql,
        countingCountValues(fixture, randomUUID(), countNumber()),
      );
      const second = client.pool.query(
        countingCountSql,
        countingCountValues(fixture, randomUUID(), countNumber()),
      );
      const settled = await Promise.allSettled([first, second]);
      expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = settled.filter((result) => result.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatchObject({
        reason: { code: '23505', constraint: 'inventory_counts_active_location_uq' },
      });
      await client.pool.query(
        countingCountSql,
        countingCountValues(fixture, randomUUID(), countNumber(), {
          locationId: fixture.secondLocationId,
        }),
      );
    } finally {
      await setup.query('rollback').catch(() => undefined);
      setup.release();
      if (fixture) await deleteFixture(client, fixture);
    }
  });

  it('allows a new active count after the previous count becomes terminal', async () => {
    await inTransaction(client, async (connection) => {
      const fixture = await insertFixture(connection);
      const firstId = randomUUID();
      await insertCountingCount(connection, fixture, firstId, countNumber());
      await connection.query(
        `update inventory_counts set status='cancelled',cancelled_at=now(),cancelled_by=$2
         where id=$1`,
        [firstId, fixture.actorId],
      );
      await insertCountingCount(connection, fixture, randomUUID(), countNumber());
    });
  });
});

const draftCountSql = `insert into inventory_counts
  (id,company_id,branch_id,inventory_location_id,count_number,status,scope_type,
   scope_definition,reason_code,metadata)
  values ($1,$2,$3,$4,$5,'draft',$6,$7::jsonb,'physical_count',$8::jsonb)`;

const countingCountSql = `insert into inventory_counts
  (id,company_id,branch_id,inventory_location_id,count_number,status,scope_type,
   scope_definition,baseline_at,lock_acquired_at,lock_expires_at,started_at,started_by,
   reason_code,metadata)
  values ($1,$2,$3,$4,$5,'counting',$6,$7::jsonb,now(),now(),now()+interval '30 minutes',
          now(),$8,'physical_count',$9::jsonb)`;

const appliedCountSql = `insert into inventory_counts
  (id,company_id,branch_id,inventory_location_id,count_number,status,scope_type,
   scope_definition,baseline_at,lock_acquired_at,lock_expires_at,started_at,started_by,
   submitted_at,submitted_by,approved_at,approved_by,applied_at,applied_by,
   application_movement_id,reason_code,metadata)
  values ($1,$2,$3,$4,$5,'applied',$6,$7::jsonb,now(),now(),now()+interval '30 minutes',
          now(),$8,now(),$8,now(),$8,now(),$8,$9,'physical_count',$10::jsonb)`;

const lineSql = `insert into inventory_count_lines
  (id,company_id,branch_id,inventory_count_id,product_variant_id,unit_of_measure_code,
   expected_quantity,counted_quantity,baseline_balance_version,baseline_last_movement_id,
   first_counted_at,last_counted_at,counted_by,metadata)
  values ($1,$2,$3,$4,$5,$6,$7,$8,1,$9,
          case when $8::numeric is null then null else now() end,
          case when $8::numeric is null then null else now() end,
          case when $8::numeric is null then null else $10::uuid end,$11::jsonb)`;

function countNumber(): string {
  return `CNT-${randomUUID().replaceAll('-', '')}`;
}

function draftCountValues(
  fixture: Fixture,
  id: string,
  number: string,
  overrides: Partial<{ locationId: string; scopeType: string }> = {},
): unknown[] {
  return [
    id,
    fixture.companyId,
    fixture.branchId,
    overrides.locationId ?? fixture.locationId,
    number,
    overrides.scopeType ?? 'all_balanced_variants',
    '{}',
    '{}',
  ];
}

function countingCountValues(
  fixture: Fixture,
  id: string,
  number: string,
  overrides: Partial<{ actorId: string; locationId: string }> = {},
): unknown[] {
  return [
    id,
    fixture.companyId,
    fixture.branchId,
    overrides.locationId ?? fixture.locationId,
    number,
    'all_balanced_variants',
    '{}',
    overrides.actorId ?? fixture.actorId,
    '{}',
  ];
}

function appliedCountValues(
  fixture: Fixture,
  id: string,
  number: string,
  movementId: string,
): unknown[] {
  return [
    id,
    fixture.companyId,
    fixture.branchId,
    fixture.locationId,
    number,
    'all_balanced_variants',
    '{}',
    fixture.actorId,
    movementId,
    '{}',
  ];
}

function lineValues(
  fixture: Fixture,
  countId: string,
  id: string,
  expected: string,
  counted: string | null,
  overrides: Partial<{ baselineMovementId: string; unit: string }> = {},
): unknown[] {
  return [
    id,
    fixture.companyId,
    fixture.branchId,
    countId,
    fixture.variantId,
    overrides.unit ?? 'unit',
    expected,
    counted,
    overrides.baselineMovementId ?? fixture.movementId,
    fixture.actorId,
    '{}',
  ];
}

async function insertDraftCount(
  connection: PoolClient,
  fixture: Fixture,
  id: string,
  number: string,
): Promise<void> {
  await connection.query(draftCountSql, draftCountValues(fixture, id, number));
}

async function insertCountingCount(
  connection: PoolClient,
  fixture: Fixture,
  id: string,
  number: string,
): Promise<void> {
  await connection.query(countingCountSql, countingCountValues(fixture, id, number));
}

async function insertFixture(connection: PoolClient): Promise<Fixture> {
  const actorId = randomUUID();
  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const branchId = randomUUID();
  const otherBranchId = randomUUID();
  const productId = randomUUID();
  const otherProductId = randomUUID();
  const variantId = randomUUID();
  const otherVariantId = randomUUID();
  await connection.query(
    `insert into companies
     (id,legal_name,display_name,slug,status,timezone,currency_code,locale)
     values ($1,'Count','Count',$2,'active','UTC','MXN','es-MX'),
            ($3,'Other','Other',$4,'active','UTC','MXN','es-MX')`,
    [companyId, `count-${companyId}`, otherCompanyId, `count-${otherCompanyId}`],
  );
  await connection.query(
    `insert into users (id,email,normalized_email,display_name,status)
     values ($1,$2,$2,'Count Actor','active')`,
    [actorId, `count-${actorId}@example.test`],
  );
  await connection.query(
    `insert into company_memberships (id,company_id,user_id,status)
     values ($1,$2,$3,'active'),($4,$5,$3,'active')`,
    [randomUUID(), companyId, actorId, randomUUID(), otherCompanyId],
  );
  await connection.query(
    `insert into branches (id,company_id,name,code,status,timezone)
     values ($1,$2,'Count Branch','MAIN','active','UTC'),
            ($3,$4,'Other Branch','MAIN','active','UTC')`,
    [branchId, companyId, otherBranchId, otherCompanyId],
  );
  await connection.query(
    `insert into units_of_measure
     (code,name,dimension,quantity_scale,conversion_factor_to_base,status)
     values ('unit','Unit','count',6,1,'active') on conflict (code) do nothing`,
  );
  await connection.query(
    `insert into products
     (id,company_id,code,normalized_code,name,product_type,tracks_inventory,status,
      created_by,updated_by)
     values ($1,$2,'COUNT','count','Count Product','simple',true,'active',$3,$3),
            ($4,$5,'COUNT','count','Other Product','simple',true,'active',$3,$3)`,
    [productId, companyId, actorId, otherProductId, otherCompanyId],
  );
  await connection.query(
    `insert into product_variants
     (id,company_id,product_id,sku,normalized_sku,name,unit_of_measure_code,
      quantity_scale,tracks_inventory,standard_cost,currency_code,is_default,
      option_signature,status,created_by,updated_by)
     values ($1,$2,$3,'COUNT-SKU','count-sku','Variant','unit',6,true,0,'MXN',true,$4,'active',$5,$5),
            ($6,$7,$8,'COUNT-SKU','count-sku','Variant','unit',6,true,0,'MXN',true,$4,'active',$5,$5)`,
    [
      variantId,
      companyId,
      productId,
      '0'.repeat(64),
      actorId,
      otherVariantId,
      otherCompanyId,
      otherProductId,
    ],
  );
  const locationId = await insertLocation(connection, companyId, branchId, actorId, 'COUNT-A');
  const secondLocationId = await insertLocation(
    connection,
    companyId,
    branchId,
    actorId,
    'COUNT-B',
  );
  const otherLocationId = await insertLocation(
    connection,
    otherCompanyId,
    otherBranchId,
    actorId,
    'COUNT-OTHER',
  );
  const movementId = await insertMovement(connection, companyId, branchId, actorId);
  const otherMovementId = await insertMovement(connection, otherCompanyId, otherBranchId, actorId);
  return {
    actorId,
    companyId,
    otherCompanyId,
    branchId,
    otherBranchId,
    locationId,
    secondLocationId,
    otherLocationId,
    variantId,
    otherVariantId,
    movementId,
    otherMovementId,
  };
}

async function insertLocation(
  connection: PoolClient,
  companyId: string,
  branchId: string,
  actorId: string,
  code: string,
): Promise<string> {
  const id = randomUUID();
  await connection.query(
    `insert into inventory_locations
     (id,company_id,branch_id,code,normalized_code,name,location_type,
      allows_receiving,allows_issuing,is_default,created_by,updated_by)
     values ($1,$2,$3,$4,$5,$4,'main',true,true,false,$6,$6)`,
    [id, companyId, branchId, code, code.toLowerCase(), actorId],
  );
  return id;
}

async function insertMovement(
  connection: PoolClient,
  companyId: string,
  branchId: string,
  actorId: string,
): Promise<string> {
  const id = randomUUID();
  await connection.query(
    `insert into inventory_movements
     (id,company_id,branch_id,movement_number,movement_type,status,occurred_at,created_by)
     values ($1,$2,$3,$4,'adjustment','draft',now(),$5)`,
    [id, companyId, branchId, `IMV-${id.replaceAll('-', '')}`, actorId],
  );
  return id;
}

async function inTransaction(
  client: DatabaseClient,
  callback: (connection: PoolClient) => Promise<void>,
): Promise<void> {
  const connection = await client.pool.connect();
  try {
    await connection.query('begin');
    await callback(connection);
  } finally {
    await connection.query('rollback');
    connection.release();
  }
}

async function expectViolation(
  connection: PoolClient,
  savepoint: string,
  query: string,
  values: unknown[],
  code: string,
  setup?: () => Promise<void>,
  variantId?: string,
): Promise<void> {
  if (setup) await setup();
  await connection.query(`savepoint ${savepoint}`);
  const effectiveValues = variantId === undefined ? values : values.with(4, variantId);
  await expect(connection.query(query, effectiveValues)).rejects.toMatchObject({ code });
  await connection.query(`rollback to savepoint ${savepoint}`);
}

async function deleteFixture(client: DatabaseClient, fixture: Fixture): Promise<void> {
  const companies = [fixture.companyId, fixture.otherCompanyId];
  await client.pool.query('delete from inventory_count_lines where company_id = any($1)', [
    companies,
  ]);
  await client.pool.query('delete from inventory_counts where company_id = any($1)', [companies]);
  await client.pool.query('delete from inventory_movements where company_id = any($1)', [
    companies,
  ]);
  await client.pool.query('delete from inventory_locations where company_id = any($1)', [
    companies,
  ]);
  await client.pool.query('delete from product_variants where company_id = any($1)', [companies]);
  await client.pool.query('delete from products where company_id = any($1)', [companies]);
  await client.pool.query('delete from branches where company_id = any($1)', [companies]);
  await client.pool.query('delete from company_memberships where company_id = any($1)', [
    companies,
  ]);
  await client.pool.query('delete from companies where id = any($1)', [companies]);
  await client.pool.query('delete from users where id=$1', [fixture.actorId]);
}
