import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';

import { InventoryReconciliationRepository } from './inventory-reconciliation.repository.js';
import { InventoryReconciliationService } from './inventory-reconciliation.service.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;

integration('PostgreSQL inventory reconciliation detector', () => {
  let database: DatabaseClient;
  let service: InventoryReconciliationService;
  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const branchId = randomUUID();
  const actorId = randomUUID();
  const productId = randomUUID();
  const variantId = randomUUID();
  const locationId = randomUUID();
  const orphanLocationId = randomUUID();
  const movementId = randomUUID();
  const reservationId = randomUUID();

  beforeAll(async () => {
    if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({
      connectionString: databaseUrl,
      applicationName: 'asone-reconciliation-detector-test',
    });
    service = new InventoryReconciliationService(new InventoryReconciliationRepository(database));
    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'Detector','Detector',$2,'active','UTC','MXN','es-MX'),
             ($3,'Other','Other',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `detector-${companyId}`, otherCompanyId, `detector-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'Main','MAIN','active','UTC')`,
      [branchId, companyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'Detector Actor','active')`,
      [actorId, `detector-${actorId}@example.test`],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status)
       values($1,$2,$3,'active')`,
      [randomUUID(), companyId, actorId],
    );
    await database.pool.query(
      `insert into products
       (id,company_id,code,normalized_code,name,product_type,tracks_inventory,status,created_by,updated_by)
       values($1,$2,'DETECT','detect','Detector Product','simple',true,'active',$3,$3)`,
      [productId, companyId, actorId],
    );
    await database.pool.query(
      `insert into product_variants
       (id,company_id,product_id,sku,normalized_sku,name,unit_of_measure_code,quantity_scale,
        tracks_inventory,standard_cost,currency_code,is_default,option_signature,status,created_by,updated_by)
       values($1,$2,$3,'DETECT','detect','Detector Variant','unit',6,true,0,'MXN',true,$4,'active',$5,$5)`,
      [variantId, companyId, productId, '0'.repeat(64), actorId],
    );
    await database.pool.query(
      `insert into inventory_locations
       (id,company_id,branch_id,code,normalized_code,name,location_type,created_by,updated_by)
       values($1,$2,$3,'DETECT','detect','Detector','main',$4,$4),
             ($5,$2,$3,'ORPHAN','orphan','Orphan','main',$4,$4)`,
      [locationId, companyId, branchId, actorId, orphanLocationId],
    );
    await database.pool.query(
      `insert into inventory_movements
       (id,company_id,branch_id,movement_number,movement_type,status,occurred_at,posted_at,created_by,posted_by)
       values($1,$2,$3,$4,'receipt','posted',now()-interval '1 minute',now()-interval '1 minute',$5,$5)`,
      [movementId, companyId, branchId, `IMV-${movementId.replaceAll('-', '')}`, actorId],
    );
    await database.pool.query(
      `insert into inventory_movement_lines
       (id,company_id,inventory_movement_id,line_number,product_variant_id,destination_location_id,
        quantity,unit_of_measure_code,base_quantity)
       values($1,$2,$3,1,$4,$5,1.500001,'unit',1.500001)`,
      [randomUUID(), companyId, movementId, variantId, locationId],
    );
    await database.pool.query(
      `insert into inventory_balances
       (id,company_id,branch_id,inventory_location_id,product_variant_id,quantity_on_hand,
        quantity_reserved,quantity_in_transit,average_unit_cost)
       values($1,$2,$3,$4,$5,1.000000,0,0,0),($6,$2,$3,$7,$5,0,0,0,0)`,
      [randomUUID(), companyId, branchId, locationId, variantId, randomUUID(), orphanLocationId],
    );
    await database.pool.query(
      `insert into inventory_reservations
       (id,company_id,branch_id,reservation_number,owner_type,owner_id,status,expires_at,created_by)
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
      `insert into inventory_reservation_lines
       (id,company_id,inventory_reservation_id,branch_id,inventory_location_id,line_number,
        product_variant_id,reserved_quantity,unit_of_measure_code)
       values($1,$2,$3,$4,$5,1,$6,0.250001,'unit')`,
      [randomUUID(), companyId, reservationId, branchId, locationId, variantId],
    );
  });

  afterAll(async () => {
    await database.pool.query('delete from inventory_reconciliation_findings where company_id=$1', [
      companyId,
    ]);
    await database.pool.query('delete from inventory_reservation_lines where company_id=$1', [
      companyId,
    ]);
    await database.pool.query('delete from inventory_reservations where company_id=$1', [
      companyId,
    ]);
    await database.pool.query('delete from inventory_movement_lines where company_id=$1', [
      companyId,
    ]);
    await database.pool.query('delete from inventory_balances where company_id=$1', [companyId]);
    await database.pool.query('delete from inventory_movements where company_id=$1', [companyId]);
    await database.pool.query('delete from inventory_locations where company_id=$1', [companyId]);
    await database.pool.query('delete from product_variants where company_id=$1', [companyId]);
    await database.pool.query('delete from products where company_id=$1', [companyId]);
    await database.pool.query('delete from company_memberships where company_id=$1', [companyId]);
    await database.pool.query('delete from branches where company_id=$1', [companyId]);
    await database.pool.query('delete from companies where id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from users where id=$1', [actorId]);
    await database.close();
  });

  it('detects exact projection, last movement and orphan findings without mutating authority', async () => {
    const before = await authoritativeCounts(database, companyId);
    const result = await service.scan({ companyId, chunkSize: 2 });
    expect(result.complete).toBe(true);
    expect(result.findingsCreated).toBeGreaterThanOrEqual(4);
    const findings = await database.pool.query<{ finding_type: string; status: string }>(
      `select finding_type,status from inventory_reconciliation_findings where company_id=$1`,
      [companyId],
    );
    expect(findings.rows.map((row) => row.finding_type)).toEqual(
      expect.arrayContaining([
        'balance_on_hand_drift',
        'balance_reserved_drift',
        'last_movement_mismatch',
        'orphan_balance',
      ]),
    );
    expect(findings.rows.every((row) => row.status === 'open')).toBe(true);
    expect(await authoritativeCounts(database, companyId)).toEqual(before);
  });

  it('deduplicates recurrence, increments occurrences and isolates tenant and scope', async () => {
    const prior = await database.pool.query<{ count: string; occurrences: string }>(
      `select count(*)::text count,sum(occurrence_count)::text occurrences
       from inventory_reconciliation_findings where company_id=$1 and status='open'`,
      [companyId],
    );
    await service.scan({ companyId, scope: { branchId }, chunkSize: 1 });
    const after = await database.pool.query<{ count: string; occurrences: string }>(
      `select count(*)::text count,sum(occurrence_count)::text occurrences
       from inventory_reconciliation_findings where company_id=$1 and status='open'`,
      [companyId],
    );
    expect(after.rows[0]?.count).toBe(prior.rows[0]?.count);
    expect(BigInt(after.rows[0]?.occurrences ?? '0')).toBeGreaterThan(
      BigInt(prior.rows[0]?.occurrences ?? '0'),
    );
    expect((await service.scan({ companyId: otherCompanyId })).findingsCreated).toBe(0);
  });

  it('auto-resolves only a completed covered scope and preserves findings outside it', async () => {
    await database.pool.query(
      `update inventory_balances set quantity_on_hand=1.500001,quantity_reserved=0.250001,
       last_movement_id=$1,updated_at=now() where company_id=$2 and inventory_location_id=$3`,
      [movementId, companyId, locationId],
    );
    const result = await service.scan({
      companyId,
      scope: { inventoryLocationId: locationId },
      resolutionActorId: actorId,
    });
    expect(result.findingsResolved).toBeGreaterThanOrEqual(3);
    const orphan = await database.pool.query<{ status: string }>(
      `select status from inventory_reconciliation_findings
       where company_id=$1 and finding_type='orphan_balance'`,
      [companyId],
    );
    expect(orphan.rows[0]?.status).toBe('open');
  });
});

async function authoritativeCounts(database: DatabaseClient, companyId: string): Promise<unknown> {
  return (
    await database.pool.query(
      `select
       (select count(*)::text from inventory_balances where company_id=$1) balances,
       (select count(*)::text from inventory_movements where company_id=$1) movements,
       (select count(*)::text from outbox_events where company_id=$1) outbox`,
      [companyId],
    )
  ).rows[0];
}
