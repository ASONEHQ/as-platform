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
  sourceLocationId: string;
  destinationLocationId: string;
  otherLocationId: string;
  variantId: string;
  otherVariantId: string;
}

integration('inventory transfers and reservations physical foundation', () => {
  let client: DatabaseClient;

  beforeAll(async () => {
    if (!new URL(integrationDatabaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    client = createDatabaseClient({
      connectionString: integrationDatabaseUrl,
      applicationName: 'asone-transfer-reservation-foundation-test',
    });
    await migrate(client.db, { migrationsFolder: resolve(import.meta.dirname, '../../drizzle') });
  });

  afterAll(async () => client.close());

  it('applies all eleven migrations and preserves the four workflow tables', async () => {
    const journal = await client.pool.query<{ count: string }>(
      'select count(*)::text count from drizzle.__drizzle_migrations',
    );
    expect(journal.rows[0]?.count).toBe('11');
    const tables = await client.pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema='public'
         and table_name in ('inventory_transfers','inventory_transfer_lines',
                            'inventory_reservations','inventory_reservation_lines')
       order by table_name`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      'inventory_reservation_lines',
      'inventory_reservations',
      'inventory_transfer_lines',
      'inventory_transfers',
    ]);
  });

  it('enforces transfer tenant scope, states, lifecycle, actors, and version', async () => {
    await inTransaction(client, async (connection) => {
      const fixture = await insertFixture(connection);
      await insertTransfer(connection, fixture, randomUUID(), 'TRANSFER-1');
      await expectViolation(
        connection,
        'duplicate_transfer',
        transferInsertSql,
        transferValues(fixture, randomUUID(), 'TRANSFER-1'),
        '23505',
      );
      await insertTransfer(
        connection,
        {
          ...fixture,
          companyId: fixture.otherCompanyId,
          branchId: fixture.otherBranchId,
          sourceLocationId: fixture.otherLocationId,
          destinationLocationId: await insertLocation(
            connection,
            fixture.otherCompanyId,
            fixture.otherBranchId,
            fixture.actorId,
            'OTHER-DEST',
          ),
        },
        randomUUID(),
        'TRANSFER-1',
      );
      for (const [name, values, code] of [
        [
          'cross_branch',
          transferValues(fixture, randomUUID(), 'CROSS-BRANCH', {
            sourceBranchId: fixture.otherBranchId,
          }),
          '23503',
        ],
        [
          'cross_location',
          transferValues(fixture, randomUUID(), 'CROSS-LOCATION', {
            destinationLocationId: fixture.otherLocationId,
          }),
          '23503',
        ],
        [
          'same_location',
          transferValues(fixture, randomUUID(), 'SAME', {
            destinationLocationId: fixture.sourceLocationId,
          }),
          '23514',
        ],
        [
          'bad_actor',
          transferValues(fixture, randomUUID(), 'BAD-ACTOR', { actorId: randomUUID() }),
          '23503',
        ],
      ] as const)
        await expectViolation(connection, name, transferInsertSql, values, code);
      for (const [name, status, version] of [
        ['bad_status', 'draft', '1'],
        ['bad_version', 'requested', '0'],
      ] as const)
        await expectViolation(
          connection,
          name,
          `insert into inventory_transfers
           (id,company_id,transfer_number,status,source_branch_id,destination_branch_id,
            source_location_id,destination_location_id,requested_at,requested_by,version)
           values ($1,$2,$3,$4,$5,$5,$6,$7,now(),$8,$9)`,
          [
            randomUUID(),
            fixture.companyId,
            name,
            status,
            fixture.branchId,
            fixture.sourceLocationId,
            fixture.destinationLocationId,
            fixture.actorId,
            version,
          ],
          '23514',
        );
      await expectViolation(
        connection,
        'approved_without_evidence',
        `insert into inventory_transfers
         (id,company_id,transfer_number,status,source_branch_id,destination_branch_id,
          source_location_id,destination_location_id,requested_at,requested_by)
         values ($1,$2,'BAD-LIFECYCLE','approved',$3,$3,$4,$5,now(),$6)`,
        [
          randomUUID(),
          fixture.companyId,
          fixture.branchId,
          fixture.sourceLocationId,
          fixture.destinationLocationId,
          fixture.actorId,
        ],
        '23514',
      );
    });
  });

  it('enforces transfer-line quantities, uniqueness, tenant scope, and UOM', async () => {
    await inTransaction(client, async (connection) => {
      const fixture = await insertFixture(connection);
      const transferId = randomUUID();
      await insertTransfer(connection, fixture, transferId, 'LINES');
      await connection.query(transferLineInsertSql, [
        randomUUID(),
        fixture.companyId,
        transferId,
        1,
        fixture.variantId,
        '10',
        '4',
        '2',
        '1',
        'unit',
      ]);
      for (const [name, line, variant, requested, shipped, received, rejected, uom, code] of [
        ['duplicate_line', 1, fixture.otherVariantId, '1', '0', '0', '0', 'unit', '23505'],
        ['duplicate_variant', 2, fixture.variantId, '1', '0', '0', '0', 'unit', '23505'],
        ['zero_requested', 2, fixture.otherVariantId, '0', '0', '0', '0', 'unit', '23514'],
        ['negative_shipped', 2, fixture.otherVariantId, '1', '-1', '0', '0', 'unit', '23514'],
        ['over_shipped', 2, fixture.otherVariantId, '1', '2', '0', '0', 'unit', '23514'],
        ['over_resolved', 2, fixture.otherVariantId, '4', '4', '3', '2', 'unit', '23514'],
        ['bad_uom', 2, fixture.otherVariantId, '1', '0', '0', '0', 'missing', '23503'],
      ] as const)
        await expectViolation(
          connection,
          name,
          transferLineInsertSql,
          [
            randomUUID(),
            fixture.companyId,
            transferId,
            line,
            variant,
            requested,
            shipped,
            received,
            rejected,
            uom,
          ],
          code,
        );
      await expectViolation(
        connection,
        'cross_variant',
        transferLineInsertSql,
        [
          randomUUID(),
          fixture.companyId,
          transferId,
          2,
          fixture.otherVariantId,
          '1',
          '0',
          '0',
          '0',
          'unit',
        ],
        '23503',
      );
    });
  });

  it('enforces reservation tenant scope, owner allowlist, lifecycle, and version', async () => {
    await inTransaction(client, async (connection) => {
      const fixture = await insertFixture(connection);
      await insertReservation(connection, fixture, randomUUID(), 'RES-1');
      await expectViolation(
        connection,
        'duplicate_reservation',
        reservationInsertSql,
        reservationValues(fixture, randomUUID(), 'RES-1'),
        '23505',
      );
      for (const [name, branch, ownerType, ownerId, status, actor, version, code] of [
        [
          'cross_branch',
          fixture.otherBranchId,
          'pos_cart',
          'owner',
          'active',
          fixture.actorId,
          '1',
          '23503',
        ],
        ['bad_owner', fixture.branchId, 'sale', 'owner', 'active', fixture.actorId, '1', '23514'],
        ['blank_owner', fixture.branchId, 'event', ' ', 'active', fixture.actorId, '1', '23514'],
        [
          'bad_status',
          fixture.branchId,
          'booking',
          'owner',
          'consumed',
          fixture.actorId,
          '1',
          '23514',
        ],
        ['bad_actor', fixture.branchId, 'order', 'owner', 'active', randomUUID(), '1', '23503'],
        [
          'bad_version',
          fixture.branchId,
          'pos_cart',
          'owner',
          'active',
          fixture.actorId,
          '0',
          '23514',
        ],
      ] as const)
        await expectViolation(
          connection,
          name,
          `insert into inventory_reservations
           (id,company_id,branch_id,reservation_number,owner_type,owner_id,status,
            created_by,version)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            randomUUID(),
            fixture.companyId,
            branch,
            name,
            ownerType,
            ownerId,
            status,
            actor,
            version,
          ],
          code,
        );
      await expectViolation(
        connection,
        'confirmed_without_evidence',
        `insert into inventory_reservations
         (id,company_id,branch_id,reservation_number,owner_type,owner_id,status,created_by)
         values ($1,$2,$3,'BAD-LIFECYCLE','event','owner','confirmed',$4)`,
        [randomUUID(), fixture.companyId, fixture.branchId, fixture.actorId],
        '23514',
      );
    });
  });

  it('enforces reservation-line branch scope, quantities, uniqueness, tenant scope, and UOM', async () => {
    await inTransaction(client, async (connection) => {
      const fixture = await insertFixture(connection);
      const reservationId = randomUUID();
      await insertReservation(connection, fixture, reservationId, 'RES-LINES');
      await connection.query(reservationLineInsertSql, [
        randomUUID(),
        fixture.companyId,
        reservationId,
        fixture.branchId,
        fixture.sourceLocationId,
        1,
        fixture.variantId,
        '10',
        '2',
        '3',
        'unit',
      ]);
      for (const [name, line, location, variant, reserved, consumed, released, uom, code] of [
        [
          'duplicate_line',
          1,
          fixture.destinationLocationId,
          fixture.variantId,
          '1',
          '0',
          '0',
          'unit',
          '23505',
        ],
        [
          'duplicate_variant_location',
          2,
          fixture.sourceLocationId,
          fixture.variantId,
          '1',
          '0',
          '0',
          'unit',
          '23505',
        ],
        [
          'zero_reserved',
          2,
          fixture.destinationLocationId,
          fixture.variantId,
          '0',
          '0',
          '0',
          'unit',
          '23514',
        ],
        [
          'negative_consumed',
          2,
          fixture.destinationLocationId,
          fixture.variantId,
          '1',
          '-1',
          '0',
          'unit',
          '23514',
        ],
        [
          'over_resolved',
          2,
          fixture.destinationLocationId,
          fixture.variantId,
          '2',
          '1',
          '2',
          'unit',
          '23514',
        ],
        [
          'cross_location',
          2,
          fixture.otherLocationId,
          fixture.variantId,
          '1',
          '0',
          '0',
          'unit',
          '23503',
        ],
        [
          'bad_uom',
          2,
          fixture.destinationLocationId,
          fixture.variantId,
          '1',
          '0',
          '0',
          'missing',
          '23503',
        ],
      ] as const)
        await expectViolation(
          connection,
          name,
          reservationLineInsertSql,
          [
            randomUUID(),
            fixture.companyId,
            reservationId,
            fixture.branchId,
            location,
            line,
            variant,
            reserved,
            consumed,
            released,
            uom,
          ],
          code,
        );
    });
  });

  it('serializes transfer/reservation number and variant-line races', async () => {
    const setup = await client.pool.connect();
    let fixture: Fixture | undefined;
    try {
      await setup.query('begin');
      fixture = await insertFixture(setup);
      const transferId = randomUUID();
      const reservationId = randomUUID();
      await insertTransfer(setup, fixture, transferId, 'RACE-BASE');
      await insertReservation(setup, fixture, reservationId, 'RES-RACE-BASE');
      await setup.query('commit');

      await expectOneUniqueViolation([
        client.pool.query(transferInsertSql, transferValues(fixture, randomUUID(), 'RACE')),
        client.pool.query(transferInsertSql, transferValues(fixture, randomUUID(), 'RACE')),
      ]);
      await expectOneUniqueViolation([
        client.pool.query(transferLineInsertSql, [
          randomUUID(),
          fixture.companyId,
          transferId,
          1,
          fixture.variantId,
          '1',
          '0',
          '0',
          '0',
          'unit',
        ]),
        client.pool.query(transferLineInsertSql, [
          randomUUID(),
          fixture.companyId,
          transferId,
          2,
          fixture.variantId,
          '1',
          '0',
          '0',
          '0',
          'unit',
        ]),
      ]);
      await expectOneUniqueViolation([
        client.pool.query(
          reservationInsertSql,
          reservationValues(fixture, randomUUID(), 'RES-RACE'),
        ),
        client.pool.query(
          reservationInsertSql,
          reservationValues(fixture, randomUUID(), 'RES-RACE'),
        ),
      ]);
      await expectOneUniqueViolation([
        client.pool.query(reservationLineInsertSql, [
          randomUUID(),
          fixture.companyId,
          reservationId,
          fixture.branchId,
          fixture.sourceLocationId,
          1,
          fixture.variantId,
          '1',
          '0',
          '0',
          'unit',
        ]),
        client.pool.query(reservationLineInsertSql, [
          randomUUID(),
          fixture.companyId,
          reservationId,
          fixture.branchId,
          fixture.sourceLocationId,
          2,
          fixture.variantId,
          '1',
          '0',
          '0',
          'unit',
        ]),
      ]);
    } finally {
      await setup.query('rollback').catch(() => undefined);
      setup.release();
      if (fixture) {
        await deleteFixture(client, fixture);
      }
    }
  });
});

const transferInsertSql = `insert into inventory_transfers
  (id,company_id,transfer_number,status,source_branch_id,destination_branch_id,
   source_location_id,destination_location_id,requested_at,requested_by)
  values ($1,$2,$3,'requested',$4,$5,$6,$7,now(),$8)`;

const transferLineInsertSql = `insert into inventory_transfer_lines
  (id,company_id,inventory_transfer_id,line_number,product_variant_id,
   requested_quantity,shipped_quantity,received_quantity,rejected_quantity,unit_of_measure_code)
  values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`;

const reservationInsertSql = `insert into inventory_reservations
  (id,company_id,branch_id,reservation_number,owner_type,owner_id,status,created_by)
  values ($1,$2,$3,$4,'pos_cart','owner','active',$5)`;

const reservationLineInsertSql = `insert into inventory_reservation_lines
  (id,company_id,inventory_reservation_id,branch_id,inventory_location_id,line_number,
   product_variant_id,reserved_quantity,consumed_quantity,released_quantity,unit_of_measure_code)
  values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`;

function transferValues(
  fixture: Fixture,
  id: string,
  number: string,
  overrides: Partial<{
    sourceBranchId: string;
    destinationBranchId: string;
    sourceLocationId: string;
    destinationLocationId: string;
    actorId: string;
  }> = {},
): unknown[] {
  return [
    id,
    fixture.companyId,
    number,
    overrides.sourceBranchId ?? fixture.branchId,
    overrides.destinationBranchId ?? fixture.branchId,
    overrides.sourceLocationId ?? fixture.sourceLocationId,
    overrides.destinationLocationId ?? fixture.destinationLocationId,
    overrides.actorId ?? fixture.actorId,
  ];
}

function reservationValues(fixture: Fixture, id: string, number: string): unknown[] {
  return [id, fixture.companyId, fixture.branchId, number, fixture.actorId];
}

async function insertTransfer(
  connection: PoolClient,
  fixture: Fixture,
  id: string,
  number: string,
): Promise<void> {
  await connection.query(transferInsertSql, transferValues(fixture, id, number));
}

async function insertReservation(
  connection: PoolClient,
  fixture: Fixture,
  id: string,
  number: string,
): Promise<void> {
  await connection.query(reservationInsertSql, reservationValues(fixture, id, number));
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
     values ($1,'First','First',$2,'active','UTC','MXN','es-MX'),
            ($3,'Other','Other',$4,'active','UTC','MXN','es-MX')`,
    [companyId, `tr-${companyId}`, otherCompanyId, `tr-${otherCompanyId}`],
  );
  await connection.query(
    `insert into users (id,email,normalized_email,display_name,status)
     values ($1,$2,$2,'Inventory Actor','active')`,
    [actorId, `transfer-${actorId}@example.test`],
  );
  await connection.query(
    `insert into company_memberships (id,company_id,user_id,status)
     values ($1,$2,$3,'active'),($4,$5,$3,'active')`,
    [randomUUID(), companyId, actorId, randomUUID(), otherCompanyId],
  );
  await connection.query(
    `insert into branches (id,company_id,name,code,status,timezone)
     values ($1,$2,'First Branch','MAIN','active','UTC'),
            ($3,$4,'Other Branch','MAIN','active','UTC')`,
    [branchId, companyId, otherBranchId, otherCompanyId],
  );
  await connection.query(
    `insert into units_of_measure
     (code,name,dimension,quantity_scale,conversion_factor_to_base,status)
     values ('unit','Unit','count',0,1,'active') on conflict (code) do nothing`,
  );
  await connection.query(
    `insert into products
     (id,company_id,code,normalized_code,name,product_type,tracks_inventory,status,
      created_by,updated_by)
     values ($1,$2,'PRODUCT','product','Product','simple',true,'active',$3,$3),
            ($4,$5,'PRODUCT','product','Product','simple',true,'active',$3,$3)`,
    [productId, companyId, actorId, otherProductId, otherCompanyId],
  );
  await connection.query(
    `insert into product_variants
     (id,company_id,product_id,sku,normalized_sku,name,unit_of_measure_code,
      quantity_scale,tracks_inventory,standard_cost,currency_code,is_default,
      option_signature,status,created_by,updated_by)
     values ($1,$2,$3,'SKU','sku','Variant','unit',0,true,0,'MXN',true,$4,'active',$5,$5),
            ($6,$7,$8,'SKU','sku','Variant','unit',0,true,0,'MXN',true,$4,'active',$5,$5)`,
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
  const sourceLocationId = await insertLocation(connection, companyId, branchId, actorId, 'SOURCE');
  const destinationLocationId = await insertLocation(
    connection,
    companyId,
    branchId,
    actorId,
    'DESTINATION',
  );
  const otherLocationId = await insertLocation(
    connection,
    otherCompanyId,
    otherBranchId,
    actorId,
    'OTHER',
  );
  return {
    actorId,
    companyId,
    otherCompanyId,
    branchId,
    otherBranchId,
    sourceLocationId,
    destinationLocationId,
    otherLocationId,
    variantId,
    otherVariantId,
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
): Promise<void> {
  await connection.query(`savepoint ${savepoint}`);
  await expect(connection.query(query, values)).rejects.toMatchObject({ code });
  await connection.query(`rollback to savepoint ${savepoint}`);
}

async function expectOneUniqueViolation(promises: readonly Promise<unknown>[]): Promise<void> {
  const settled = await Promise.allSettled(promises);
  expect(settled.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
  const rejected = settled.filter((item) => item.status === 'rejected');
  expect(rejected).toHaveLength(1);
  expect(rejected[0]).toMatchObject({ reason: { code: '23505' } });
}

async function deleteFixture(client: DatabaseClient, fixture: Fixture): Promise<void> {
  const companies = [fixture.companyId, fixture.otherCompanyId];
  await client.pool.query('delete from inventory_transfer_lines where company_id = any($1)', [
    companies,
  ]);
  await client.pool.query('delete from inventory_reservation_lines where company_id = any($1)', [
    companies,
  ]);
  await client.pool.query('delete from inventory_transfers where company_id = any($1)', [
    companies,
  ]);
  await client.pool.query('delete from inventory_reservations where company_id = any($1)', [
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
  await client.pool.query(
    'delete from users where id=$1 and not exists (select 1 from company_memberships where user_id=$1)',
    [fixture.actorId],
  );
}
