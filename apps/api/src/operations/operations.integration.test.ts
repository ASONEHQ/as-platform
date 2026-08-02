import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';

import { OperationalChecksRepository } from './operational-checks.repository.js';
import { RestoreSafetyError, validateRestoreTarget } from './restore-safety.js';
import { ShadowRebuildService } from './shadow-rebuild.service.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const requiredDatabaseUrl = databaseUrl ?? '';
const integration = databaseUrl === undefined ? describe.skip : describe;

integration('PostgreSQL operational automation', () => {
  let database: DatabaseClient;
  let repository: OperationalChecksRepository;
  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const branchId = randomUUID();
  const actorId = randomUUID();
  const productId = randomUUID();
  const variantId = randomUUID();
  const locationId = randomUUID();
  const movementId = randomUUID();

  beforeAll(async () => {
    if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({
      connectionString: databaseUrl,
      applicationName: 'asone-operations-test',
    });
    repository = new OperationalChecksRepository(database);
    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
      values($1,'Ops','Ops',$2,'active','UTC','MXN','es-MX'),($3,'Other','Other',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `ops-${companyId}`, otherCompanyId, `ops-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone) values($1,$2,'Ops','OPS','active','UTC')`,
      [branchId, companyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status) values($1,$2,$2,'Ops Actor','active')`,
      [actorId, `ops-${actorId}@example.test`],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status) values($1,$2,$3,'active')`,
      [randomUUID(), companyId, actorId],
    );
    await database.pool.query(
      `insert into products(id,company_id,code,normalized_code,name,product_type,tracks_inventory,status,created_by,updated_by)
       values($1,$2,'OPS','ops','Ops Product','simple',true,'active',$3,$3)`,
      [productId, companyId, actorId],
    );
    await database.pool.query(
      `insert into product_variants(id,company_id,product_id,sku,normalized_sku,name,unit_of_measure_code,quantity_scale,tracks_inventory,standard_cost,currency_code,is_default,option_signature,status,created_by,updated_by)
       values($1,$2,$3,'OPS','ops','Ops Variant','unit',6,true,0,'MXN',true,$4,'active',$5,$5)`,
      [variantId, companyId, productId, '0'.repeat(64), actorId],
    );
    await database.pool.query(
      `insert into inventory_locations(id,company_id,branch_id,code,normalized_code,name,location_type,created_by,updated_by)
       values($1,$2,$3,'OPS','ops','Ops Location','main',$4,$4)`,
      [locationId, companyId, branchId, actorId],
    );
    await database.pool.query(
      `insert into inventory_movements(id,company_id,branch_id,movement_number,movement_type,status,occurred_at,posted_at,created_by,posted_by)
       values($1,$2,$3,$4,'receipt','posted',now()-interval '1 minute',now()-interval '1 minute',$5,$5)`,
      [movementId, companyId, branchId, `IMV-${movementId.replaceAll('-', '')}`, actorId],
    );
    await database.pool.query(
      `insert into inventory_movement_lines(id,company_id,inventory_movement_id,line_number,product_variant_id,destination_location_id,quantity,unit_of_measure_code,base_quantity)
       values($1,$2,$3,1,$4,$5,1,'unit',1)`,
      [randomUUID(), companyId, movementId, variantId, locationId],
    );
    await database.pool.query(
      `insert into inventory_balances(id,company_id,branch_id,inventory_location_id,product_variant_id,quantity_on_hand,quantity_reserved,quantity_in_transit,average_unit_cost)
       values($1,$2,$3,$4,$5,0,0,0,0)`,
      [randomUUID(), companyId, branchId, locationId, variantId],
    );
    await database.pool.query(
      `insert into inventory_counts(id,company_id,branch_id,inventory_location_id,count_number,status,scope_type,scope_definition,baseline_at,lock_acquired_at,lock_expires_at,started_at,started_by,reason_code)
       values($1,$2,$3,$4,$5,'counting','all_balanced_variants','{}',now()-interval '2 hours',now()-interval '2 hours',now()-interval '1 hour',now()-interval '2 hours',$6,'ops_test')`,
      [
        randomUUID(),
        companyId,
        branchId,
        locationId,
        `CNT-${randomUUID().replaceAll('-', '')}`,
        actorId,
      ],
    );
    await database.pool.query(
      `insert into inventory_reservations(id,company_id,branch_id,reservation_number,owner_type,owner_id,status,expires_at,created_by)
       values($1,$2,$3,$4,'pos_cart','ops-owner','active',now()-interval '1 hour',$5)`,
      [randomUUID(), companyId, branchId, `RES-${randomUUID().replaceAll('-', '')}`, actorId],
    );
  });

  afterAll(async () => {
    await database.pool.query(
      'delete from inventory_reconciliation_findings where company_id in ($1,$2)',
      [companyId, otherCompanyId],
    );
    await database.pool.query('delete from idempotency_keys where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from outbox_events where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from inventory_counts where company_id=$1', [companyId]);
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

  it('checks PostgreSQL connectivity and its database clock', async () => {
    await expect(database.check()).resolves.toBeUndefined();
    expect(Math.abs(Date.now() - (await repository.databaseClock()).getTime())).toBeLessThan(5_000);
  });

  it('reads the complete migration state without changing it', async () => {
    const before = await database.pool.query('select count(*) from drizzle.__drizzle_migrations');
    expect((await repository.migrationState()).applied).toBeGreaterThanOrEqual(9);
    expect(await database.pool.query('select count(*) from drizzle.__drizzle_migrations')).toEqual(
      before,
    );
  });

  it('reports an empty scoped fixture outbox without consuming anything', async () => {
    const before = await database.pool.query('select count(*) from outbox_events');
    expect((await repository.outbox()).pending).toBeGreaterThanOrEqual(0);
    expect(await database.pool.query('select count(*) from outbox_events')).toEqual(before);
  });

  it('reports backlog, age, retries and failed evidence read-only', async () => {
    await database.pool.query(
      `insert into outbox_events(event_id,company_id,event_type,aggregate_type,aggregate_id,aggregate_version,payload,occurred_at,available_at,attempts,last_error)
      values($1,$2,'ops.old','ops',$3,1,'{"safe":true}',now()-interval '10 minutes',now()-interval '10 minutes',2,'sanitized')`,
      [randomUUID(), companyId, randomUUID()],
    );
    const value = await repository.outbox();
    expect(value.pending).toBeGreaterThanOrEqual(1);
    expect(value.failed).toBeGreaterThanOrEqual(1);
    expect(value.oldestPendingSeconds).toBeGreaterThanOrEqual(590);
    expect(value.byCompany[companyId]).toBe(1);
  });

  it('reports idempotency health without completing or deleting records', async () => {
    await database.pool.query(
      `insert into idempotency_keys(id,company_id,key,operation,request_hash,expires_at)
      values($1,$2,'ops-key','ops-check',$3,now()+interval '1 hour')`,
      [randomUUID(), companyId, 'a'.repeat(64)],
    );
    expect((await repository.idempotency()).incomplete).toBeGreaterThanOrEqual(1);
    const stored = await database.pool.query<{ completed_at: Date | null }>(
      'select completed_at from idempotency_keys where company_id=$1',
      [companyId],
    );
    expect(stored.rows[0]?.completed_at).toBeNull();
  });

  it('counts inventory findings per tenant without changing their lifecycle', async () => {
    const insert = `insert into inventory_reconciliation_findings
      (id,company_id,aggregate_type,aggregate_id,finding_type,severity,status,identity_key,fingerprint_sha256,detector_version,snapshot_at,first_detected_at,last_detected_at,expected_summary,actual_summary,evidence)
      values($1,$2,'inventory_balance',$3,'balance_on_hand_drift',$4,$5,$6,$7,'ops-v1',now(),now(),now(),'{}','{}','{}')`;
    await database.pool.query(insert, [
      randomUUID(),
      companyId,
      randomUUID(),
      'critical',
      'open',
      `ops-${randomUUID()}`,
      'b'.repeat(64),
    ]);
    await database.pool.query(insert, [
      randomUUID(),
      otherCompanyId,
      randomUUID(),
      'warning',
      'open',
      `ops-${randomUUID()}`,
      'c'.repeat(64),
    ]);
    expect((await repository.inventory(companyId)).openCriticalFindings).toBe(1);
    expect((await repository.inventory(companyId)).openWarningFindings).toBe(0);
    expect((await repository.inventory(otherCompanyId)).openWarningFindings).toBe(1);
    expect((await repository.inventory(companyId)).expiredCountLocks).toBe(1);
    expect((await repository.inventory(companyId)).expiredActiveReservations).toBe(1);
    const changed = await database.pool.query<{ count: string }>(
      `select count(*)::text count from inventory_reconciliation_findings where status<>'open' and company_id in ($1,$2)`,
      [companyId, otherCompanyId],
    );
    expect(changed.rows[0]?.count).toBe('0');
  });

  it('observes pool metrics without opening an extra diagnostic connection', () => {
    const before = database.pool.totalCount;
    const state = repository.poolState();
    expect(state.total).toBe(before);
    expect(state.waiting).toBeGreaterThanOrEqual(0);
  });

  it('performs clean and mismatched tenant-scoped shadow comparisons without mutations', async () => {
    const before = await mutationCounts(database, otherCompanyId);
    const result = await new ShadowRebuildService(database).compare({
      companyId: otherCompanyId,
      limit: 10,
    });
    expect(result).toMatchObject({ complete: true, mismatches: 0, missing_balances: 0 });
    expect(await mutationCounts(database, otherCompanyId)).toEqual(before);
    const mismatchBefore = await mutationCounts(database, companyId);
    const mismatch = await new ShadowRebuildService(database).compare({ companyId, limit: 10 });
    expect(Number(mismatch.mismatches)).toBeGreaterThan(0);
    expect(await mutationCounts(database, companyId)).toEqual(mismatchBefore);
  });

  it('keeps outbox, findings and balances unchanged across every diagnostic', async () => {
    const before = await mutationCounts(database, companyId);
    await repository.outbox();
    await repository.inventory(companyId);
    expect(await mutationCounts(database, companyId)).toEqual(before);
  });

  it('rejects protected and non-allowlisted restore targets before database access', () => {
    const base = {
      sourceUrl: requiredDatabaseUrl,
      allowedDatabases: ['asone_restore_test'],
      dryRun: true,
      confirmed: true,
      environment: 'test',
    };
    expect(() =>
      validateRestoreTarget({ ...base, targetUrl: new URL('/postgres', requiredDatabaseUrl).href }),
    ).toThrow(RestoreSafetyError);
    expect(() =>
      validateRestoreTarget({
        ...base,
        targetUrl: new URL('/asone_other_test', requiredDatabaseUrl).href,
      }),
    ).toThrow(RestoreSafetyError);
  });
});

async function mutationCounts(database: DatabaseClient, companyId: string): Promise<unknown> {
  return (
    await database.pool.query(
      `select
    (select count(*)::text from inventory_balances where company_id=$1) balances,
    (select count(*)::text from inventory_reconciliation_findings where company_id=$1) findings,
    (select count(*)::text from outbox_events where company_id=$1) outbox`,
      [companyId],
    )
  ).rows[0];
}
