import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';

import { InventoryReconciliationRepository } from './inventory-reconciliation.repository.js';
import { InventoryReconciliationService } from './inventory-reconciliation.service.js';
import { InventoryRepairRepository } from './inventory-repair.repository.js';
import { InventoryRepairService } from './inventory-repair.service.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;

integration('PostgreSQL inventory reconciliation repair E155-E160', () => {
  let database: DatabaseClient;
  let service: InventoryRepairService;
  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const branchId = randomUUID();
  const actorId = randomUUID();
  const productId = randomUUID();
  const variantId = randomUUID();
  const locationId = randomUUID();
  const missingLocationId = randomUUID();
  const orphanLocationId = randomUUID();
  const movementId = randomUUID();
  const missingMovementId = randomUUID();
  const reservationId = randomUUID();

  beforeAll(async () => {
    if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({
      connectionString: databaseUrl,
      applicationName: 'asone-repair-test',
    });
    const detectorRepository = new InventoryReconciliationRepository(database);
    service = new InventoryRepairService(new InventoryRepairRepository(database));
    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
      values($1,'Repair','Repair',$2,'active','UTC','MXN','es-MX'),($3,'Other','Other',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `repair-${companyId}`, otherCompanyId, `repair-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone) values($1,$2,'Main','MAIN','active','UTC')`,
      [branchId, companyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status) values($1,$2,$2,'Repair Actor','active')`,
      [actorId, `repair-${actorId}@example.test`],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status) values($1,$2,$3,'active')`,
      [randomUUID(), companyId, actorId],
    );
    await database.pool.query(
      `insert into products(id,company_id,code,normalized_code,name,product_type,tracks_inventory,status,created_by,updated_by)
      values($1,$2,'REPAIR','repair','Repair Product','simple',true,'active',$3,$3)`,
      [productId, companyId, actorId],
    );
    await database.pool.query(
      `insert into product_variants(id,company_id,product_id,sku,normalized_sku,name,unit_of_measure_code,quantity_scale,
      tracks_inventory,standard_cost,currency_code,is_default,option_signature,status,created_by,updated_by)
      values($1,$2,$3,'REPAIR','repair','Repair Variant','unit',6,true,0,'MXN',true,$4,'active',$5,$5)`,
      [variantId, companyId, productId, '1'.repeat(64), actorId],
    );
    await database.pool.query(
      `insert into inventory_locations(id,company_id,branch_id,code,normalized_code,name,location_type,created_by,updated_by)
      values($1,$2,$3,'REPAIR','repair','Repair','main',$4,$4),($5,$2,$3,'MISSING','missing','Missing','main',$4,$4),
      ($6,$2,$3,'ORPHAN','orphan','Orphan','main',$4,$4)`,
      [locationId, companyId, branchId, actorId, missingLocationId, orphanLocationId],
    );
    for (const [id, location, quantity] of [
      [movementId, locationId, '5.000001'],
      [missingMovementId, missingLocationId, '2.000001'],
    ] as const) {
      await database.pool.query(
        `insert into inventory_movements(id,company_id,branch_id,movement_number,movement_type,status,occurred_at,posted_at,created_by,posted_by)
        values($1,$2,$3,$4,'receipt','posted',now()-interval '2 minutes',now()-interval '2 minutes',$5,$5)`,
        [id, companyId, branchId, `IMV-${id.replaceAll('-', '')}`, actorId],
      );
      await database.pool.query(
        `insert into inventory_movement_lines(id,company_id,inventory_movement_id,line_number,product_variant_id,destination_location_id,quantity,unit_of_measure_code,base_quantity)
        values($1,$2,$3,1,$4,$5,$6,'unit',$6)`,
        [randomUUID(), companyId, id, variantId, location, quantity],
      );
    }
    await database.pool.query(
      `insert into inventory_balances(id,company_id,branch_id,inventory_location_id,product_variant_id,quantity_on_hand,
      quantity_reserved,quantity_in_transit,average_unit_cost,currency_code)
      values($1,$2,$3,$4,$5,1,0,0,12.3400,'MXN'),($6,$2,$3,$7,$5,0,0,0,0,null)`,
      [randomUUID(), companyId, branchId, locationId, variantId, randomUUID(), orphanLocationId],
    );
    await database.pool.query(
      `insert into inventory_reservations(id,company_id,branch_id,reservation_number,owner_type,owner_id,status,expires_at,created_by)
      values($1,$2,$3,$4,'pos_cart',$5,'active',now()+interval '1 hour',$6)`,
      [
        reservationId,
        companyId,
        branchId,
        `RES-${reservationId.replaceAll('-', '')}`,
        randomUUID(),
        actorId,
      ],
    );
    await database.pool.query(
      `insert into inventory_reservation_lines(id,company_id,inventory_reservation_id,branch_id,inventory_location_id,line_number,
      product_variant_id,reserved_quantity,unit_of_measure_code) values($1,$2,$3,$4,$5,1,$6,1.000001,'unit')`,
      [randomUUID(), companyId, reservationId, branchId, locationId, variantId],
    );
    await new InventoryReconciliationService(detectorRepository).scan({ companyId });
  });

  afterAll(async () => {
    for (const table of [
      'outbox_events',
      'audit_log',
      'idempotency_keys',
      'inventory_reconciliation_findings',
      'inventory_reservation_lines',
      'inventory_reservations',
      'inventory_movement_lines',
      'inventory_balances',
      'inventory_movements',
      'inventory_locations',
      'product_variants',
      'products',
      'company_memberships',
      'branches',
    ])
      await database.pool.query(`delete from ${table} where company_id=$1`, [companyId]);
    await database.pool.query('delete from companies where id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from users where id=$1', [actorId]);
    await database.close();
  });

  it('isolates list/detail and commits acknowledge/dismiss atomically with exact replay', async () => {
    const page = await service.list(companyId, [branchId], { limit: 100 });
    expect(page.items.length).toBeGreaterThanOrEqual(5);
    expect((await service.list(otherCompanyId, [branchId], { limit: 100 })).items).toHaveLength(0);
    await expect(
      service.detail(otherCompanyId, [branchId], required(page.items[0]).id),
    ).rejects.toMatchObject({ code: 'resource_not_found' });
    const orphan = required(page.items.find((item) => item.findingType === 'orphan_balance'));
    const context = {
      companyId,
      actorId,
      requestId: 'lifecycle-request',
      correlationId: 'lifecycle-correlation',
      timestamp: new Date(),
    };
    const acknowledged = await service.acknowledge(
      context,
      [branchId],
      orphan.id,
      orphan.version,
      'ack',
      { reasonCode: 'reviewed', note: null },
    );
    const replay = await service.acknowledge(
      context,
      [branchId],
      orphan.id,
      orphan.version,
      'ack',
      { reasonCode: 'reviewed', note: null },
    );
    expect(replay).toEqual({ ...acknowledged, replayed: true });
    await service.dismiss(
      { ...context, timestamp: new Date(context.timestamp.getTime() + 1) },
      [branchId],
      orphan.id,
      2n,
      'dismiss',
      { reasonCode: 'not_actionable', note: 'Reviewed' },
    );
    const sideEffects = await database.pool.query<{ audits: string; outbox: string }>(
      `select
      (select count(*)::text from audit_log where company_id=$1 and entity_id=$2) audits,
      (select count(*)::text from outbox_events where company_id=$1 and aggregate_id=$2) outbox`,
      [companyId, orphan.id],
    );
    expect(sideEffects.rows[0]).toEqual({ audits: '2', outbox: '0' });
  });

  it('previews read-only and repairs on-hand, reserved, last movement and missing balance atomically', async () => {
    for (const [type, strategy] of [
      ['last_movement_mismatch', 'restore_last_movement'],
      ['balance_on_hand_drift', 'rebuild_on_hand_projection'],
      ['balance_reserved_drift', 'rebuild_reserved_projection'],
      ['missing_balance', 'create_missing_balance'],
    ] as const) {
      const current = required(
        (await service.list(companyId, [branchId], { limit: 100, findingType: type })).items.find(
          (item) => item.status === 'open',
        ),
      );
      const before = await counts(database, companyId);
      let preview;
      try {
        preview = await service.preview(
          companyId,
          [branchId],
          current.id,
          current.version,
          current.fingerprint,
          strategy,
        );
      } catch (error) {
        throw new Error(`Preview failed for ${type}`, { cause: error });
      }
      expect(await counts(database, companyId)).toEqual(before);
      const result = await service.repair(
        {
          companyId,
          actorId,
          requestId: `repair-${type}`,
          correlationId: `correlation-${type}`,
          timestamp: new Date(),
        },
        [branchId],
        current.id,
        current.version,
        `key-${type}`,
        {
          strategy,
          expectedFingerprint: current.fingerprint,
          previewFingerprint: preview.fingerprint,
          previewExpiresAt: preview.expiresAt,
          reasonCode: 'projection_rebuild',
          note: null,
        },
      );
      expect(result.value).toMatchObject({ new_status: 'resolved', strategy, movement_id: null });
    }
    const balance = await database.pool.query<{
      quantity_on_hand: string;
      quantity_reserved: string;
      average_unit_cost: string;
      currency_code: string | null;
      last_movement_id: string | null;
    }>(
      `select quantity_on_hand::text,quantity_reserved::text,average_unit_cost::text,currency_code,last_movement_id
       from inventory_balances where company_id=$1 and inventory_location_id=$2`,
      [companyId, locationId],
    );
    expect(balance.rows[0]).toMatchObject({
      quantity_on_hand: '5.000001',
      quantity_reserved: '1.000001',
      average_unit_cost: '12.3400',
      currency_code: 'MXN',
      last_movement_id: movementId,
    });
    const missing = await database.pool.query(
      `select quantity_on_hand::text,average_unit_cost::text,currency_code from inventory_balances where company_id=$1 and inventory_location_id=$2`,
      [companyId, missingLocationId],
    );
    expect(missing.rows[0]).toMatchObject({
      quantity_on_hand: '2.000001',
      average_unit_cost: '0.0000',
      currency_code: null,
    });
    const effects = await counts(database, companyId);
    expect(Number(effects.audits)).toBeGreaterThanOrEqual(8);
    expect(Number(effects.outbox)).toBe(3);
    expect(effects.movements).toBe('2');
  });
});

async function counts(
  database: DatabaseClient,
  companyId: string,
): Promise<{ balances: string; movements: string; audits: string; outbox: string }> {
  return required(
    (
      await database.pool.query<{
        balances: string;
        movements: string;
        audits: string;
        outbox: string;
      }>(
        `select
    (select count(*)::text from inventory_balances where company_id=$1) balances,
    (select count(*)::text from inventory_movements where company_id=$1) movements,
    (select count(*)::text from audit_log where company_id=$1) audits,
    (select count(*)::text from outbox_events where company_id=$1) outbox`,
        [companyId],
      )
    ).rows[0],
  );
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Required integration fixture is missing.');
  return value;
}
