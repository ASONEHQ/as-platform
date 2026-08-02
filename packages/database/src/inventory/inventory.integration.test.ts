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
  readonly actorId: string;
  readonly firstCompanyId: string;
  readonly secondCompanyId: string;
  readonly firstBranchId: string;
  readonly secondBranchId: string;
  readonly firstVariantId: string;
  readonly secondVariantId: string;
}

integration('inventory physical foundation', () => {
  let client: DatabaseClient;

  beforeAll(async () => {
    if (!new URL(integrationDatabaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    client = createDatabaseClient({
      connectionString: integrationDatabaseUrl,
      applicationName: 'asone-inventory-foundation-test',
    });
    await migrate(client.db, { migrationsFolder: resolve(import.meta.dirname, '../../drizzle') });
  });

  afterAll(async () => {
    await client.close();
  });

  it('applies all eleven migrations and creates the inventory foundation tables', async () => {
    const tables = await client.pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema='public' and table_name like 'inventory_%'
       order by table_name`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      'inventory_balances',
      'inventory_count_lines',
      'inventory_counts',
      'inventory_locations',
      'inventory_movement_lines',
      'inventory_movements',
      'inventory_reconciliation_findings',
      'inventory_reservation_lines',
      'inventory_reservations',
      'inventory_transfer_lines',
      'inventory_transfers',
    ]);
    const journal = await client.pool.query<{ count: string }>(
      'select count(*)::text as count from drizzle.__drizzle_migrations',
    );
    expect(journal.rows[0]?.count).toBe('11');
  });

  it('enforces location scope, lifecycle, types, codes, and one active default', async () => {
    const connection = await client.pool.connect();
    try {
      await connection.query('begin');
      const fixture = await insertFixture(connection);
      const locationId = randomUUID();
      await insertLocation(connection, fixture, locationId, {
        code: 'MAIN',
        normalizedCode: 'main',
        isDefault: true,
      });
      await expectViolation(
        connection,
        'location_duplicate_code',
        locationInsertSql,
        [
          randomUUID(),
          fixture.firstCompanyId,
          fixture.firstBranchId,
          'Main duplicate',
          'main',
          'Duplicate',
          'main',
          true,
          true,
          false,
          fixture.actorId,
        ],
        '23505',
      );
      await expectViolation(
        connection,
        'location_duplicate_default',
        locationInsertSql,
        [
          randomUUID(),
          fixture.firstCompanyId,
          fixture.firstBranchId,
          'SECOND',
          'second',
          'Second',
          'main',
          true,
          true,
          true,
          fixture.actorId,
        ],
        '23505',
      );
      await insertLocation(
        connection,
        {
          ...fixture,
          firstCompanyId: fixture.secondCompanyId,
          firstBranchId: fixture.secondBranchId,
        },
        randomUUID(),
        { code: 'MAIN', normalizedCode: 'main' },
      );
      await expectViolation(
        connection,
        'location_cross_company_branch',
        locationInsertSql,
        [
          randomUUID(),
          fixture.firstCompanyId,
          fixture.secondBranchId,
          'BAD-BRANCH',
          'bad-branch',
          'Bad branch',
          'main',
          true,
          true,
          false,
          fixture.actorId,
        ],
        '23503',
      );
      for (const [name, type, status, deletedAt] of [
        ['bad_type', 'unknown', 'active', null],
        ['bad_status', 'main', 'unknown', null],
        ['retired_without_time', 'main', 'retired', null],
        ['active_with_time', 'main', 'active', new Date()],
      ] as const) {
        await expectViolation(
          connection,
          name,
          `insert into inventory_locations
           (id,company_id,branch_id,code,normalized_code,name,location_type,status,
            allows_receiving,allows_issuing,is_default,deleted_at,created_by,updated_by)
           values ($1,$2,$3,$4,$5,'Invalid',$6,$7,false,false,false,$8,$9,$9)`,
          [
            randomUUID(),
            fixture.firstCompanyId,
            fixture.firstBranchId,
            name,
            name,
            type,
            status,
            deletedAt,
            fixture.actorId,
          ],
          '23514',
        );
      }
      for (const [name, code, normalizedCode, displayName, version] of [
        ['blank_code', ' ', 'blank-code', 'Valid', '1'],
        ['blank_normalized_code', 'VALID', '', 'Valid', '1'],
        ['unnormalized_code', 'VALID', ' Not-Normalized ', 'Valid', '1'],
        ['blank_name', 'VALID', 'valid', ' ', '1'],
        ['bad_location_version', 'VALID', 'valid', 'Valid', '0'],
      ] as const) {
        await expectViolation(
          connection,
          name,
          `insert into inventory_locations
           (id,company_id,branch_id,code,normalized_code,name,location_type,status,
            allows_receiving,allows_issuing,is_default,version,created_by,updated_by)
           values ($1,$2,$3,$4,$5,$6,'main','active',true,true,false,$7,$8,$8)`,
          [
            randomUUID(),
            fixture.firstCompanyId,
            fixture.firstBranchId,
            code,
            normalizedCode,
            displayName,
            version,
            fixture.actorId,
          ],
          '23514',
        );
      }
      await expectViolation(
        connection,
        'location_cross_company_actor',
        locationInsertSql,
        [
          randomUUID(),
          fixture.firstCompanyId,
          fixture.firstBranchId,
          'BAD-ACTOR',
          'bad-actor',
          'Bad actor',
          'main',
          true,
          true,
          false,
          randomUUID(),
        ],
        '23503',
      );
      await connection.query(
        `update inventory_locations
         set status='inactive', is_default=false, allows_receiving=false, allows_issuing=false
         where id=$1`,
        [locationId],
      );
      await insertLocation(connection, fixture, randomUUID(), {
        code: 'NEW-DEFAULT',
        normalizedCode: 'new-default',
        isDefault: true,
      });
    } finally {
      await connection.query('rollback');
      connection.release();
    }
  });

  it('enforces balance identity, tenant scope, exact quantities, cost, and version', async () => {
    const connection = await client.pool.connect();
    try {
      await connection.query('begin');
      const fixture = await insertFixture(connection);
      const locationId = randomUUID();
      const otherLocationId = randomUUID();
      await insertLocation(connection, fixture, locationId);
      await insertLocation(
        connection,
        {
          ...fixture,
          firstCompanyId: fixture.secondCompanyId,
          firstBranchId: fixture.secondBranchId,
        },
        otherLocationId,
      );
      await connection.query(balanceInsertSql, [
        randomUUID(),
        fixture.firstCompanyId,
        fixture.firstBranchId,
        locationId,
        fixture.firstVariantId,
        '10',
        '2',
        '0',
        '1',
      ]);
      await expectViolation(
        connection,
        'balance_duplicate',
        balanceInsertSql,
        [
          randomUUID(),
          fixture.firstCompanyId,
          fixture.firstBranchId,
          locationId,
          fixture.firstVariantId,
          '0',
          '0',
          '0',
          '1',
        ],
        '23505',
      );
      for (const [name, values, code] of [
        [
          'balance_cross_location',
          [fixture.firstCompanyId, fixture.firstBranchId, otherLocationId, fixture.firstVariantId],
          '23503',
        ],
        [
          'balance_cross_variant',
          [fixture.firstCompanyId, fixture.firstBranchId, locationId, fixture.secondVariantId],
          '23503',
        ],
      ] as const) {
        await expectViolation(
          connection,
          name,
          balanceInsertSql,
          [randomUUID(), ...values, '0', '0', '0', '1'],
          code,
        );
      }
      for (const [name, onHand, reserved, cost, version] of [
        ['balance_negative_on_hand', '-1', '0', '0', '1'],
        ['balance_negative_reserved', '1', '-1', '0', '1'],
        ['balance_over_reserved', '1', '2', '0', '1'],
        ['balance_negative_cost', '1', '0', '-1', '1'],
        ['balance_bad_version', '1', '0', '0', '0'],
      ] as const) {
        await expectViolation(
          connection,
          name,
          balanceInsertSql,
          [
            randomUUID(),
            fixture.firstCompanyId,
            fixture.firstBranchId,
            locationId,
            fixture.firstVariantId,
            onHand,
            reserved,
            cost,
            version,
          ],
          '23514',
        );
      }
      await expectViolation(
        connection,
        'balance_negative_in_transit',
        `insert into inventory_balances
         (id,company_id,branch_id,inventory_location_id,product_variant_id,
          quantity_on_hand,quantity_reserved,quantity_in_transit,average_unit_cost,version)
         values ($1,$2,$3,$4,$5,0,0,-1,0,1)`,
        [
          randomUUID(),
          fixture.firstCompanyId,
          fixture.firstBranchId,
          locationId,
          fixture.firstVariantId,
        ],
        '23514',
      );
      await connection.query('delete from inventory_balances where company_id=$1', [
        fixture.firstCompanyId,
      ]);
      await expectViolation(
        connection,
        'balance_cross_branch',
        balanceInsertSql,
        [
          randomUUID(),
          fixture.firstCompanyId,
          fixture.secondBranchId,
          locationId,
          fixture.firstVariantId,
          '0',
          '0',
          '0',
          '1',
        ],
        '23503',
      );
      const otherMovementId = randomUUID();
      await insertDraftMovement(
        connection,
        {
          ...fixture,
          firstCompanyId: fixture.secondCompanyId,
          firstBranchId: fixture.secondBranchId,
        },
        otherMovementId,
        'BALANCE-OTHER',
      );
      await expectViolation(
        connection,
        'balance_cross_last_movement',
        `insert into inventory_balances
         (id,company_id,branch_id,inventory_location_id,product_variant_id,
          quantity_on_hand,quantity_reserved,average_unit_cost,version,last_movement_id)
         values ($1,$2,$3,$4,$5,0,0,0,1,$6)`,
        [
          randomUUID(),
          fixture.firstCompanyId,
          fixture.firstBranchId,
          locationId,
          fixture.firstVariantId,
          otherMovementId,
        ],
        '23503',
      );
      await expectViolation(
        connection,
        'balance_cost_without_currency',
        `insert into inventory_balances
         (id,company_id,branch_id,inventory_location_id,product_variant_id,
          quantity_on_hand,quantity_reserved,average_unit_cost,version)
         values ($1,$2,$3,$4,$5,0,0,1,1)`,
        [
          randomUUID(),
          fixture.firstCompanyId,
          fixture.firstBranchId,
          locationId,
          fixture.firstVariantId,
        ],
        '23514',
      );
    } finally {
      await connection.query('rollback');
      connection.release();
    }
  });

  it('enforces movement numbering, states, types, reversals, and lifecycle timestamps', async () => {
    const connection = await client.pool.connect();
    try {
      await connection.query('begin');
      const fixture = await insertFixture(connection);
      const originalId = randomUUID();
      await insertDraftMovement(connection, fixture, originalId, 'MOV-1');
      await expectViolation(
        connection,
        'movement_duplicate_number',
        draftMovementInsertSql,
        [
          randomUUID(),
          fixture.firstCompanyId,
          fixture.firstBranchId,
          'MOV-1',
          'adjustment',
          fixture.actorId,
          '1',
        ],
        '23505',
      );
      await insertDraftMovement(
        connection,
        {
          ...fixture,
          firstCompanyId: fixture.secondCompanyId,
          firstBranchId: fixture.secondBranchId,
        },
        randomUUID(),
        'MOV-1',
      );
      for (const [name, type, status, version] of [
        ['movement_bad_type', 'unknown', 'draft', '1'],
        ['movement_bad_status', 'adjustment', 'unknown', '1'],
        ['movement_bad_version', 'adjustment', 'draft', '0'],
      ] as const) {
        await expectViolation(
          connection,
          name,
          `insert into inventory_movements
           (id,company_id,branch_id,movement_number,movement_type,status,version,
            occurred_at,created_by)
           values ($1,$2,$3,$4,$5,$6,$7,now(),$8)`,
          [
            randomUUID(),
            fixture.firstCompanyId,
            fixture.firstBranchId,
            name,
            type,
            status,
            version,
            fixture.actorId,
          ],
          '23514',
        );
      }
      await expectViolation(
        connection,
        'movement_self_reversal',
        `insert into inventory_movements
         (id,company_id,branch_id,movement_number,movement_type,status,
          reversal_of_movement_id,occurred_at,created_by)
         values ($1,$2,$3,'SELF','reversal','draft',$1,now(),$4)`,
        [randomUUID(), fixture.firstCompanyId, fixture.firstBranchId, fixture.actorId],
        '23514',
      );
      const otherMovementId = randomUUID();
      await insertDraftMovement(
        connection,
        {
          ...fixture,
          firstCompanyId: fixture.secondCompanyId,
          firstBranchId: fixture.secondBranchId,
        },
        otherMovementId,
        'OTHER',
      );
      await expectViolation(
        connection,
        'movement_cross_company_reversal',
        `insert into inventory_movements
         (id,company_id,branch_id,movement_number,movement_type,status,
          reversal_of_movement_id,occurred_at,created_by)
         values ($1,$2,$3,'CROSS','reversal','draft',$4,now(),$5)`,
        [
          randomUUID(),
          fixture.firstCompanyId,
          fixture.firstBranchId,
          otherMovementId,
          fixture.actorId,
        ],
        '23503',
      );
      await expectViolation(
        connection,
        'movement_posted_without_timestamp',
        `insert into inventory_movements
         (id,company_id,branch_id,movement_number,movement_type,status,occurred_at,created_by)
         values ($1,$2,$3,'POSTED-BAD','adjustment','posted',now(),$4)`,
        [randomUUID(), fixture.firstCompanyId, fixture.firstBranchId, fixture.actorId],
        '23514',
      );
      await expectViolation(
        connection,
        'movement_cancelled_without_timestamp',
        `insert into inventory_movements
         (id,company_id,branch_id,movement_number,movement_type,status,occurred_at,created_by)
         values ($1,$2,$3,'CANCEL-BAD','adjustment','cancelled',now(),$4)`,
        [randomUUID(), fixture.firstCompanyId, fixture.firstBranchId, fixture.actorId],
        '23514',
      );
      await expectViolation(
        connection,
        'movement_cross_company_branch',
        draftMovementInsertSql,
        [
          randomUUID(),
          fixture.firstCompanyId,
          fixture.secondBranchId,
          'BAD-BRANCH',
          'adjustment',
          fixture.actorId,
          '1',
        ],
        '23503',
      );
      await expectViolation(
        connection,
        'movement_cross_company_actor',
        draftMovementInsertSql,
        [
          randomUUID(),
          fixture.firstCompanyId,
          fixture.firstBranchId,
          'BAD-ACTOR',
          'adjustment',
          randomUUID(),
          '1',
        ],
        '23503',
      );
      await expectViolation(
        connection,
        'movement_reversed_without_timestamps',
        `insert into inventory_movements
         (id,company_id,branch_id,movement_number,movement_type,status,occurred_at,created_by)
         values ($1,$2,$3,'REVERSED-BAD','adjustment','reversed',now(),$4)`,
        [randomUUID(), fixture.firstCompanyId, fixture.firstBranchId, fixture.actorId],
        '23514',
      );
      await expectViolation(
        connection,
        'movement_draft_with_posted_timestamp',
        `insert into inventory_movements
         (id,company_id,branch_id,movement_number,movement_type,status,
          occurred_at,posted_at,posted_by,created_by)
         values ($1,$2,$3,'DRAFT-POSTED','adjustment','draft',now(),now(),$4,$4)`,
        [randomUUID(), fixture.firstCompanyId, fixture.firstBranchId, fixture.actorId],
        '23514',
      );
    } finally {
      await connection.query('rollback');
      connection.release();
    }
  });

  it('enforces movement-line direction, quantities, costs, uniqueness, and tenant scope', async () => {
    const connection = await client.pool.connect();
    try {
      await connection.query('begin');
      const fixture = await insertFixture(connection);
      const locationId = randomUUID();
      const otherLocationId = randomUUID();
      const movementId = randomUUID();
      const otherMovementId = randomUUID();
      await insertLocation(connection, fixture, locationId);
      await insertLocation(
        connection,
        {
          ...fixture,
          firstCompanyId: fixture.secondCompanyId,
          firstBranchId: fixture.secondBranchId,
        },
        otherLocationId,
      );
      await insertDraftMovement(connection, fixture, movementId, 'LINE-MOV');
      await insertDraftMovement(
        connection,
        {
          ...fixture,
          firstCompanyId: fixture.secondCompanyId,
          firstBranchId: fixture.secondBranchId,
        },
        otherMovementId,
        'OTHER-LINE-MOV',
      );
      const destinationId = randomUUID();
      await insertLocation(connection, fixture, destinationId, {
        code: 'DEST',
        normalizedCode: 'dest',
      });
      await connection.query(lineInsertSql, [
        randomUUID(),
        fixture.firstCompanyId,
        movementId,
        1,
        fixture.firstVariantId,
        locationId,
        null,
        '1',
        '1',
      ]);
      await expectViolation(
        connection,
        'line_duplicate_number',
        lineInsertSql,
        [
          randomUUID(),
          fixture.firstCompanyId,
          movementId,
          1,
          fixture.firstVariantId,
          locationId,
          null,
          '1',
          '1',
        ],
        '23505',
      );
      for (const [name, quantity, baseQuantity, source, destination] of [
        ['line_zero_quantity', '0', '1', locationId, null],
        ['line_negative_quantity', '-1', '1', locationId, null],
        ['line_zero_base', '1', '0', locationId, null],
        ['line_no_direction', '1', '1', null, null],
        ['line_same_location', '1', '1', locationId, locationId],
      ] as const) {
        await expectViolation(
          connection,
          name,
          lineInsertSql,
          [
            randomUUID(),
            fixture.firstCompanyId,
            movementId,
            2,
            fixture.firstVariantId,
            source,
            destination,
            quantity,
            baseQuantity,
          ],
          '23514',
        );
      }
      for (const [name, badMovement, badVariant, badSource, badDestination] of [
        ['line_cross_movement', otherMovementId, fixture.firstVariantId, locationId, null],
        ['line_cross_variant', movementId, fixture.secondVariantId, locationId, null],
        ['line_cross_source', movementId, fixture.firstVariantId, otherLocationId, null],
        ['line_cross_destination', movementId, fixture.firstVariantId, null, otherLocationId],
      ] as const) {
        await expectViolation(
          connection,
          name,
          lineInsertSql,
          [
            randomUUID(),
            fixture.firstCompanyId,
            badMovement,
            2,
            badVariant,
            badSource,
            badDestination,
            '1',
            '1',
          ],
          '23503',
        );
      }
      for (const [name, unitCost, extendedCost] of [
        ['line_negative_unit_cost', '-1', '1'],
        ['line_negative_extended_cost', '1', '-1'],
      ] as const) {
        await expectViolation(
          connection,
          name,
          `insert into inventory_movement_lines
           (id,company_id,inventory_movement_id,line_number,product_variant_id,
            source_location_id,quantity,unit_of_measure_code,base_quantity,
            unit_cost,extended_cost,currency_code)
           values ($1,$2,$3,2,$4,$5,1,'unit',1,$6,$7,'MXN')`,
          [
            randomUUID(),
            fixture.firstCompanyId,
            movementId,
            fixture.firstVariantId,
            locationId,
            unitCost,
            extendedCost,
          ],
          '23514',
        );
      }
      await connection.query(lineInsertSql, [
        randomUUID(),
        fixture.firstCompanyId,
        movementId,
        2,
        fixture.firstVariantId,
        null,
        locationId,
        '1',
        '1',
      ]);
      await connection.query(lineInsertSql, [
        randomUUID(),
        fixture.firstCompanyId,
        movementId,
        3,
        fixture.firstVariantId,
        locationId,
        destinationId,
        '1',
        '1',
      ]);
      await connection.query(lineInsertSql, [
        randomUUID(),
        fixture.secondCompanyId,
        otherMovementId,
        1,
        fixture.secondVariantId,
        otherLocationId,
        null,
        '1',
        '1',
      ]);
      await expectViolation(
        connection,
        'line_invalid_uom',
        `insert into inventory_movement_lines
         (id,company_id,inventory_movement_id,line_number,product_variant_id,
          source_location_id,quantity,unit_of_measure_code,base_quantity)
         values ($1,$2,$3,4,$4,$5,1,'missing-uom',1)`,
        [randomUUID(), fixture.firstCompanyId, movementId, fixture.firstVariantId, locationId],
        '23503',
      );
      for (const [name, metadata] of [
        ['line_scalar_metadata', JSON.stringify('invalid')],
        ['line_large_metadata', JSON.stringify({ value: 'x'.repeat(8200) })],
      ] as const) {
        await expectViolation(
          connection,
          name,
          `insert into inventory_movement_lines
           (id,company_id,inventory_movement_id,line_number,product_variant_id,
            source_location_id,quantity,unit_of_measure_code,base_quantity,metadata)
           values ($1,$2,$3,4,$4,$5,1,'unit',1,$6::jsonb)`,
          [
            randomUUID(),
            fixture.firstCompanyId,
            movementId,
            fixture.firstVariantId,
            locationId,
            metadata,
          ],
          '23514',
        );
      }
    } finally {
      await connection.query('rollback');
      connection.release();
    }
  });

  it('serializes concurrent default, balance, and movement-number uniqueness', async () => {
    const setup = await client.pool.connect();
    const fixtureIds: string[] = [];
    let fixture: Fixture | undefined;
    let locationId: string | undefined;
    try {
      await setup.query('begin');
      fixture = await insertFixture(setup);
      fixtureIds.push(fixture.firstCompanyId, fixture.secondCompanyId);
      locationId = randomUUID();
      await insertLocation(setup, fixture, locationId, {
        code: 'BASE',
        normalizedCode: 'base',
      });
      await setup.query('commit');

      await expectOneUniqueViolation([
        client.pool.query(locationInsertSql, [
          randomUUID(),
          fixture.firstCompanyId,
          fixture.firstBranchId,
          'DEFAULT-A',
          'default-a',
          'Default A',
          'main',
          true,
          true,
          true,
          fixture.actorId,
        ]),
        client.pool.query(locationInsertSql, [
          randomUUID(),
          fixture.firstCompanyId,
          fixture.firstBranchId,
          'DEFAULT-B',
          'default-b',
          'Default B',
          'main',
          true,
          true,
          true,
          fixture.actorId,
        ]),
      ]);
      await expectOneUniqueViolation([
        client.pool.query(balanceInsertSql, [
          randomUUID(),
          fixture.firstCompanyId,
          fixture.firstBranchId,
          locationId,
          fixture.firstVariantId,
          '0',
          '0',
          '0',
          '1',
        ]),
        client.pool.query(balanceInsertSql, [
          randomUUID(),
          fixture.firstCompanyId,
          fixture.firstBranchId,
          locationId,
          fixture.firstVariantId,
          '0',
          '0',
          '0',
          '1',
        ]),
      ]);
      await expectOneUniqueViolation([
        client.pool.query(draftMovementInsertSql, [
          randomUUID(),
          fixture.firstCompanyId,
          fixture.firstBranchId,
          'CONCURRENT',
          'adjustment',
          fixture.actorId,
          '1',
        ]),
        client.pool.query(draftMovementInsertSql, [
          randomUUID(),
          fixture.firstCompanyId,
          fixture.firstBranchId,
          'CONCURRENT',
          'adjustment',
          fixture.actorId,
          '1',
        ]),
      ]);
    } finally {
      await setup.query('rollback').catch(() => undefined);
      setup.release();
      for (const companyId of fixtureIds) await deleteCompanyFixture(client, companyId);
    }
  });
});

const locationInsertSql = `insert into inventory_locations
  (id,company_id,branch_id,code,normalized_code,name,location_type,
   allows_receiving,allows_issuing,is_default,created_by,updated_by)
  values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`;

const balanceInsertSql = `insert into inventory_balances
  (id,company_id,branch_id,inventory_location_id,product_variant_id,
   quantity_on_hand,quantity_reserved,average_unit_cost,version)
  values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`;

const draftMovementInsertSql = `insert into inventory_movements
  (id,company_id,branch_id,movement_number,movement_type,status,occurred_at,created_by,version)
  values ($1,$2,$3,$4,$5,'draft',now(),$6,$7)`;

const lineInsertSql = `insert into inventory_movement_lines
  (id,company_id,inventory_movement_id,line_number,product_variant_id,
   source_location_id,destination_location_id,quantity,unit_of_measure_code,base_quantity)
  values ($1,$2,$3,$4,$5,$6,$7,$8,'unit',$9)`;

async function insertFixture(connection: PoolClient): Promise<Fixture> {
  const actorId = randomUUID();
  const firstCompanyId = randomUUID();
  const secondCompanyId = randomUUID();
  const firstBranchId = randomUUID();
  const secondBranchId = randomUUID();
  const firstVariantId = randomUUID();
  const secondVariantId = randomUUID();
  const firstProductId = randomUUID();
  const secondProductId = randomUUID();
  await connection.query(
    `insert into companies
     (id,legal_name,display_name,slug,status,timezone,currency_code,locale)
     values ($1,'First','First',$2,'active','UTC','MXN','es-MX'),
            ($3,'Second','Second',$4,'active','UTC','MXN','es-MX')`,
    [firstCompanyId, `inv-${firstCompanyId}`, secondCompanyId, `inv-${secondCompanyId}`],
  );
  await connection.query(
    `insert into users (id,email,normalized_email,display_name,status)
     values ($1,$2,$2,'Inventory Actor','active')`,
    [actorId, `inventory-${actorId}@example.test`],
  );
  await connection.query(
    `insert into company_memberships (id,company_id,user_id,status)
     values ($1,$2,$3,'active'),($4,$5,$3,'active')`,
    [randomUUID(), firstCompanyId, actorId, randomUUID(), secondCompanyId],
  );
  await connection.query(
    `insert into branches (id,company_id,name,code,status,timezone)
     values ($1,$2,'First Branch','MAIN','active','UTC'),
            ($3,$4,'Second Branch','MAIN','active','UTC')`,
    [firstBranchId, firstCompanyId, secondBranchId, secondCompanyId],
  );
  await connection.query(
    `insert into units_of_measure
     (code,name,dimension,quantity_scale,conversion_factor_to_base,status)
     values ('unit','Unit','count',0,1,'active')
     on conflict (code) do nothing`,
  );
  await connection.query(
    `insert into products
     (id,company_id,code,normalized_code,name,product_type,tracks_inventory,status,
      created_by,updated_by)
     values ($1,$2,'PRODUCT','product','Product','simple',true,'active',$3,$3),
            ($4,$5,'PRODUCT','product','Product','simple',true,'active',$3,$3)`,
    [firstProductId, firstCompanyId, actorId, secondProductId, secondCompanyId],
  );
  await connection.query(
    `insert into product_variants
     (id,company_id,product_id,sku,normalized_sku,name,unit_of_measure_code,
      quantity_scale,tracks_inventory,standard_cost,currency_code,is_default,
      option_signature,status,created_by,updated_by)
     values ($1,$2,$3,'SKU','sku','Variant','unit',0,true,0,'MXN',true,$4,'active',$5,$5),
            ($6,$7,$8,'SKU','sku','Variant','unit',0,true,0,'MXN',true,$4,'active',$5,$5)`,
    [
      firstVariantId,
      firstCompanyId,
      firstProductId,
      '0'.repeat(64),
      actorId,
      secondVariantId,
      secondCompanyId,
      secondProductId,
    ],
  );
  return {
    actorId,
    firstCompanyId,
    secondCompanyId,
    firstBranchId,
    secondBranchId,
    firstVariantId,
    secondVariantId,
  };
}

async function insertLocation(
  connection: PoolClient,
  fixture: Fixture,
  locationId: string,
  options: Readonly<{
    code?: string;
    normalizedCode?: string;
    isDefault?: boolean;
  }> = {},
): Promise<void> {
  await connection.query(locationInsertSql, [
    locationId,
    fixture.firstCompanyId,
    fixture.firstBranchId,
    options.code ?? 'LOCATION',
    options.normalizedCode ?? 'location',
    options.code ?? 'Location',
    'main',
    true,
    true,
    options.isDefault ?? false,
    fixture.actorId,
  ]);
}

async function insertDraftMovement(
  connection: PoolClient,
  fixture: Fixture,
  movementId: string,
  movementNumber: string,
): Promise<void> {
  await connection.query(draftMovementInsertSql, [
    movementId,
    fixture.firstCompanyId,
    fixture.firstBranchId,
    movementNumber,
    'adjustment',
    fixture.actorId,
    '1',
  ]);
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

async function deleteCompanyFixture(client: DatabaseClient, companyId: string): Promise<void> {
  const users = await client.pool.query<{ user_id: string }>(
    'select user_id from company_memberships where company_id=$1',
    [companyId],
  );
  await client.pool.query('delete from inventory_movement_lines where company_id=$1', [companyId]);
  await client.pool.query('delete from inventory_balances where company_id=$1', [companyId]);
  await client.pool.query('delete from inventory_movements where company_id=$1', [companyId]);
  await client.pool.query('delete from inventory_locations where company_id=$1', [companyId]);
  await client.pool.query('delete from product_variants where company_id=$1', [companyId]);
  await client.pool.query('delete from products where company_id=$1', [companyId]);
  await client.pool.query('delete from branches where company_id=$1', [companyId]);
  await client.pool.query('delete from company_memberships where company_id=$1', [companyId]);
  await client.pool.query('delete from companies where id=$1', [companyId]);
  for (const row of users.rows)
    await client.pool.query(
      'delete from users where id=$1 and not exists (select 1 from company_memberships where user_id=$1)',
      [row.user_id],
    );
}
