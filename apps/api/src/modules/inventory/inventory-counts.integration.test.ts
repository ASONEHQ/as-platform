import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';

import { InventoryCountRepository } from './inventory-counts.repository.js';
import { InventoryCountService } from './inventory-counts.service.js';
import { InventoryLocationRepository } from './inventory.repository.js';
import { InventoryLocationService } from './inventory.service.js';
import type { InventoryMutationContext } from './inventory.types.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;
integration('PostgreSQL durable inventory counts E115-E123', () => {
  let database: DatabaseClient;
  let counts: InventoryCountService;
  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const branchId = randomUUID();
  const otherBranchId = randomUUID();
  const actorId = randomUUID();
  const productId = randomUUID();
  const variantId = randomUUID();
  const emptyVariantId = randomUUID();
  let locationId: string;
  const ctx = (
    suffix: string,
    timestamp = new Date('2026-07-31T12:00:00.000Z'),
  ): InventoryMutationContext => ({
    companyId,
    actorId,
    requestId: `count-${suffix}`,
    correlationId: `count-correlation-${suffix}`,
    timestamp,
  });
  beforeAll(async () => {
    if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({
      connectionString: databaseUrl,
      applicationName: 'asone-count-api-integration',
    });
    const schema = await database.pool.query<{ present: string | null }>(
      `select to_regclass('public.inventory_counts')::text present`,
    );
    if (schema.rows[0]?.present === null)
      throw new Error('Migrations 0000-0007 must be applied before count integration tests.');
    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale) values($1,'Counts','Counts',$2,'active','UTC','MXN','es-MX'),($3,'Other Counts','Other Counts',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `counts-${companyId}`, otherCompanyId, `counts-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone) values($1,$2,'Count Branch','COUNT','active','UTC'),($3,$4,'Other','OTHER','active','UTC')`,
      [branchId, companyId, otherBranchId, otherCompanyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status) values($1,$2,$2,'Count User','active')`,
      [actorId, `counts-${actorId}@example.test`],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status) values($1,$2,$3,'active'),($4,$5,$3,'active')`,
      [randomUUID(), companyId, actorId, randomUUID(), otherCompanyId],
    );
    await database.pool.query(
      `insert into products(id,company_id,code,normalized_code,name,product_type,tracks_inventory,status,created_by,updated_by) values($1,$2,'COUNT','count','Count product','simple',true,'active',$3,$3)`,
      [productId, companyId, actorId],
    );
    for (const [id, sku, signature] of [
      [variantId, 'COUNT-A', '3'.repeat(64)],
      [emptyVariantId, 'COUNT-B', '4'.repeat(64)],
    ])
      await database.pool.query(
        `insert into product_variants(id,company_id,product_id,sku,normalized_sku,name,unit_of_measure_code,quantity_scale,tracks_inventory,standard_cost,currency_code,is_default,option_signature,status,created_by,updated_by) values($1,$2,$3,$4,lower($4),$4,'unit',0,true,0,'MXN',false,$5,'active',$6,$6)`,
        [id, companyId, productId, sku, signature, actorId],
      );
    const locations = new InventoryLocationService(new InventoryLocationRepository(database));
    locationId = (
      await locations.create(ctx('location'), 'count-location', {
        branchId,
        code: 'COUNT',
        name: 'Count Location',
        locationType: 'main',
      })
    ).value.id;
    await database.pool.query(
      `insert into inventory_balances(id,company_id,branch_id,inventory_location_id,product_variant_id,quantity_on_hand,quantity_reserved,quantity_in_transit,average_unit_cost,currency_code) values($1,$2,$3,$4,$5,10,0,0,0,'MXN')`,
      [randomUUID(), companyId, branchId, locationId, variantId],
    );
    counts = new InventoryCountService(new InventoryCountRepository(database));
  });
  afterAll(async () => {
    await database.pool.query('delete from outbox_events where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from audit_log where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from idempotency_keys where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from inventory_count_lines where company_id=$1', [companyId]);
    await database.pool.query('delete from inventory_counts where company_id=$1', [companyId]);
    await database.pool.query('delete from inventory_movement_lines where company_id=$1', [
      companyId,
    ]);
    await database.pool.query('delete from inventory_balances where company_id=$1', [companyId]);
    await database.pool.query('delete from inventory_movements where company_id=$1', [companyId]);
    await database.pool.query('delete from inventory_locations where company_id=$1', [companyId]);
    await database.pool.query('delete from product_variants where company_id=$1', [companyId]);
    await database.pool.query('delete from products where company_id=$1', [companyId]);
    await database.pool.query('delete from company_memberships where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from branches where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from companies where id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from users where id=$1', [actorId]);
    await database.close();
  });
  function create(
    key: string,
    variantIds = [variantId],
  ): ReturnType<InventoryCountService['create']> {
    return counts.create(ctx(key), [branchId], key, {
      branchId,
      locationId,
      scope: { type: 'explicit_variants', productVariantIds: variantIds },
      reasonCode: 'cycle_count',
    });
  }
  it('applies a complete discrepancy once with movement, balance, audit, outbox and exact replay', async () => {
    const created = await create('lifecycle');
    const id = String(created.value.id);
    expect(created.value).toMatchObject({ status: 'draft', version: 1 });
    expect(
      (
        await counts.create(ctx('lifecycle'), [branchId], 'lifecycle', {
          branchId,
          locationId,
          scope: { type: 'explicit_variants', productVariantIds: [variantId] },
          reasonCode: 'cycle_count',
        })
      ).replayed,
    ).toBe(true);
    const started = await counts.start(ctx('start'), [branchId], id, 1n, 'start');
    expect(started.value).toMatchObject({ status: 'counting', version: 2 });
    await counts.recordLine(ctx('line'), [branchId], id, variantId, 2n, {
      countedQuantity: '12',
      unitOfMeasureCode: 'unit',
    });
    await counts.submit(ctx('submit'), [branchId], id, 3n, 'submit');
    await counts.approve(ctx('approve'), [branchId], id, 4n, 'approve');
    const applied = await counts.apply(ctx('apply'), [branchId], id, 5n, 'apply');
    expect(applied.value).toMatchObject({ status: 'applied', version: 6 });
    const replay = await counts.apply(ctx('apply'), [branchId], id, 5n, 'apply');
    expect(replay.replayed).toBe(true);
    const evidence = await database.pool.query<{
      quantity: string;
      movements: string;
      audits: string;
      events: string;
    }>(
      `select (select quantity_on_hand::text from inventory_balances where company_id=$1 and product_variant_id=$2) quantity,(select count(*)::text from inventory_movements where company_id=$1 and reference_type='inventory_count' and reference_id=$3) movements,(select count(*)::text from audit_log where company_id=$1 and entity_type='inventory_count' and entity_id=$3) audits,(select count(*)::text from outbox_events where company_id=$1 and aggregate_id=$3) events`,
      [companyId, variantId, id],
    );
    expect(evidence.rows[0]).toMatchObject({
      quantity: '12.000000',
      movements: '1',
      audits: '6',
      events: '5',
    });
  });
  it('creates an inbound zero-baseline balance and applies an exact positive count', async () => {
    const created = await create('inbound', [emptyVariantId]);
    const id = String(created.value.id);
    await counts.start(ctx('inbound-start'), [branchId], id, 1n, 'inbound-start');
    const detail = await counts.get(companyId, [branchId], id);
    expect(detail.lines[0]?.expectedQuantity).toBe('0.000000');
    await counts.recordLine(ctx('inbound-line'), [branchId], id, emptyVariantId, 2n, {
      countedQuantity: '3',
      unitOfMeasureCode: 'unit',
    });
    await counts.submit(ctx('inbound-submit'), [branchId], id, 3n, 'inbound-submit');
    await counts.approve(ctx('inbound-approve'), [branchId], id, 4n, 'inbound-approve');
    await counts.apply(ctx('inbound-apply'), [branchId], id, 5n, 'inbound-apply');
    const balance = await database.pool.query<{ quantity: string }>(
      `select quantity_on_hand::text quantity from inventory_balances where company_id=$1 and inventory_location_id=$2 and product_variant_id=$3`,
      [companyId, locationId, emptyVariantId],
    );
    expect(balance.rows[0]?.quantity).toBe('3.000000');
  });
  it('detects drift and preserves submitted state without success side effects', async () => {
    const created = await create('drift');
    const id = String(created.value.id);
    await counts.start(ctx('drift-start'), [branchId], id, 1n, 'drift-start');
    await counts.recordLine(ctx('drift-line'), [branchId], id, variantId, 2n, {
      countedQuantity: '12',
      unitOfMeasureCode: 'unit',
    });
    await counts.submit(ctx('drift-submit'), [branchId], id, 3n, 'drift-submit');
    await database.pool.query(
      `update inventory_balances set version=version+1 where company_id=$1 and product_variant_id=$2`,
      [companyId, variantId],
    );
    await expect(
      counts.approve(ctx('drift-approve'), [branchId], id, 4n, 'drift-approve'),
    ).rejects.toMatchObject({ code: 'inventory_reconciliation_required' });
    expect((await counts.get(companyId, [branchId], id)).status).toBe('submitted');
    await counts.cancel(ctx('drift-cancel'), [branchId], id, 4n, 'drift-cancel', {
      reasonCode: 'drift',
    });
  });
  it('enforces one active location lock, tenant isolation, stale ETag and cancellation release', async () => {
    const first = await create('lock-one');
    const second = await create('lock-two');
    await counts.start(
      ctx('lock-one-start'),
      [branchId],
      String(first.value.id),
      1n,
      'lock-one-start',
    );
    await expect(
      counts.start(
        ctx('lock-two-start'),
        [branchId],
        String(second.value.id),
        1n,
        'lock-two-start',
      ),
    ).rejects.toMatchObject({ code: 'inventory_count_in_progress' });
    await expect(
      counts.get(otherCompanyId, [otherBranchId], String(first.value.id)),
    ).rejects.toMatchObject({ code: 'resource_not_found' });
    await expect(
      counts.cancel(ctx('stale'), [branchId], String(first.value.id), 1n, 'stale', {
        reasonCode: 'abandoned',
      }),
    ).rejects.toMatchObject({ code: 'version_conflict' });
    await counts.cancel(ctx('cancel'), [branchId], String(first.value.id), 2n, 'cancel', {
      reasonCode: 'abandoned',
    });
    const started = await counts.start(
      ctx('lock-two-retry'),
      [branchId],
      String(second.value.id),
      1n,
      'lock-two-retry',
    );
    expect(started.value).toMatchObject({ status: 'counting', version: 2 });
    await counts.cancel(ctx('cancel-two'), [branchId], String(second.value.id), 2n, 'cancel-two', {
      reasonCode: 'cleanup',
    });
  });

  it('serializes concurrent starts, line writes, submissions and apply-once commands', async () => {
    const first = await create('race-start-one');
    const second = await create('race-start-two');
    const starts = await Promise.allSettled([
      counts.start(ctx('race-start-one'), [branchId], String(first.value.id), 1n, 'race-start-one'),
      counts.start(
        ctx('race-start-two'),
        [branchId],
        String(second.value.id),
        1n,
        'race-start-two',
      ),
    ]);
    expect(starts.filter((value) => value.status === 'fulfilled')).toHaveLength(1);
    expect(starts.filter((value) => value.status === 'rejected')).toHaveLength(1);
    const winnerIndex = starts.findIndex((value) => value.status === 'fulfilled');
    const winnerId = String((winnerIndex === 0 ? first : second).value.id);
    const loserId = String((winnerIndex === 0 ? second : first).value.id);
    await counts.cancel(ctx('race-start-release'), [branchId], winnerId, 2n, 'race-start-release', {
      reasonCode: 'race_complete',
    });
    await counts.cancel(ctx('race-start-loser'), [branchId], loserId, 1n, 'race-start-loser', {
      reasonCode: 'race_complete',
    });

    const created = await create('race-lifecycle');
    const id = String(created.value.id);
    await counts.start(ctx('race-lifecycle-start'), [branchId], id, 1n, 'race-lifecycle-start');
    const writes = await Promise.allSettled([
      counts.recordLine(ctx('race-line-a'), [branchId], id, variantId, 2n, {
        countedQuantity: '13',
        unitOfMeasureCode: 'unit',
      }),
      counts.recordLine(ctx('race-line-b'), [branchId], id, variantId, 2n, {
        countedQuantity: '14',
        unitOfMeasureCode: 'unit',
      }),
    ]);
    expect(writes.filter((value) => value.status === 'fulfilled')).toHaveLength(1);
    expect(writes.filter((value) => value.status === 'rejected')).toHaveLength(1);
    const submissions = await Promise.allSettled([
      counts.submit(ctx('race-submit-a'), [branchId], id, 3n, 'race-submit-a'),
      counts.submit(ctx('race-submit-b'), [branchId], id, 3n, 'race-submit-b'),
    ]);
    expect(submissions.filter((value) => value.status === 'fulfilled')).toHaveLength(1);
    expect(submissions.filter((value) => value.status === 'rejected')).toHaveLength(1);
    await counts.approve(ctx('race-approve'), [branchId], id, 4n, 'race-approve');
    const applications = await Promise.allSettled([
      counts.apply(ctx('race-apply-a'), [branchId], id, 5n, 'race-apply-a'),
      counts.apply(ctx('race-apply-b'), [branchId], id, 5n, 'race-apply-b'),
    ]);
    expect(applications.filter((value) => value.status === 'fulfilled')).toHaveLength(1);
    expect(applications.filter((value) => value.status === 'rejected')).toHaveLength(1);
    const movements = await database.pool.query<{ count: string }>(
      `select count(*)::text count from inventory_movements
       where company_id=$1 and reference_type='inventory_count' and reference_id=$2`,
      [companyId, id],
    );
    expect(movements.rows[0]?.count).toBe('1');
  });

  it('rejects incomplete submission and normal commands after the durable lock expires', async () => {
    const created = await create('incomplete-expired');
    const id = String(created.value.id);
    await counts.start(ctx('incomplete-expired-start'), [branchId], id, 1n, 'incomplete-start');
    await expect(
      counts.submit(ctx('incomplete-submit'), [branchId], id, 2n, 'incomplete-submit'),
    ).rejects.toMatchObject({ code: 'count_has_incomplete_lines' });
    await database.pool.query(
      `update inventory_counts set lock_expires_at=$3 where company_id=$1 and id=$2`,
      [companyId, id, new Date('2026-07-31T12:01:00.000Z')],
    );
    await expect(
      counts.recordLine(
        ctx('expired-line', new Date('2026-07-31T13:00:00.000Z')),
        [branchId],
        id,
        variantId,
        2n,
        {
          countedQuantity: '0',
          unitOfMeasureCode: 'unit',
        },
      ),
    ).rejects.toMatchObject({ code: 'count_lock_expired' });
    await counts.cancel(
      ctx('expired-cancel', new Date('2026-07-31T13:00:00.000Z')),
      [branchId],
      id,
      2n,
      'expired-cancel',
      { reasonCode: 'expired' },
    );
  });

  it('applies an exact no-difference snapshot without creating an empty movement', async () => {
    const current = await database.pool.query<{ quantity: string }>(
      `select quantity_on_hand::text quantity from inventory_balances
       where company_id=$1 and inventory_location_id=$2 and product_variant_id=$3`,
      [companyId, locationId, variantId],
    );
    const created = await create('no-difference');
    const id = String(created.value.id);
    await counts.start(ctx('no-difference-start'), [branchId], id, 1n, 'no-difference-start');
    await counts.recordLine(ctx('no-difference-line'), [branchId], id, variantId, 2n, {
      countedQuantity: current.rows[0]?.quantity.split('.')[0] ?? '0',
      unitOfMeasureCode: 'unit',
    });
    await counts.submit(ctx('no-difference-submit'), [branchId], id, 3n, 'no-difference-submit');
    await counts.approve(ctx('no-difference-approve'), [branchId], id, 4n, 'no-difference-approve');
    const applied = await counts.apply(
      ctx('no-difference-apply'),
      [branchId],
      id,
      5n,
      'no-difference-apply',
    );
    expect(applied.value).toMatchObject({ status: 'applied', application_movement_id: null });
    const movements = await database.pool.query<{ count: string }>(
      `select count(*)::text count from inventory_movements
       where company_id=$1 and reference_type='inventory_count' and reference_id=$2`,
      [companyId, id],
    );
    expect(movements.rows[0]?.count).toBe('0');
  });

  it('rolls back application when counted stock would fall below reserved inventory', async () => {
    await database.pool.query(
      `update inventory_balances set quantity_reserved=quantity_on_hand,version=version+1
       where company_id=$1 and inventory_location_id=$2 and product_variant_id=$3`,
      [companyId, locationId, variantId],
    );
    const created = await create('reserved-protection');
    const id = String(created.value.id);
    await counts.start(ctx('reserved-start'), [branchId], id, 1n, 'reserved-start');
    await counts.recordLine(ctx('reserved-line'), [branchId], id, variantId, 2n, {
      countedQuantity: '0',
      unitOfMeasureCode: 'unit',
    });
    await counts.submit(ctx('reserved-submit'), [branchId], id, 3n, 'reserved-submit');
    await counts.approve(ctx('reserved-approve'), [branchId], id, 4n, 'reserved-approve');
    await expect(
      counts.apply(ctx('reserved-apply'), [branchId], id, 5n, 'reserved-apply'),
    ).rejects.toMatchObject({ code: 'insufficient_inventory' });
    const evidence = await database.pool.query<{
      status: string;
      movements: string;
      applied_audits: string;
      completed_events: string;
    }>(
      `select (select status from inventory_counts where company_id=$1 and id=$2) status,
       (select count(*)::text from inventory_movements where company_id=$1
        and reference_type='inventory_count' and reference_id=$2) movements,
       (select count(*)::text from audit_log where company_id=$1 and entity_id=$2
        and action='inventory_count.applied') applied_audits,
       (select count(*)::text from outbox_events where company_id=$1 and aggregate_id=$2
        and event_type='inventory.count.completed') completed_events`,
      [companyId, id],
    );
    expect(evidence.rows[0]).toMatchObject({
      status: 'approved',
      movements: '0',
      applied_audits: '0',
      completed_events: '0',
    });
  });
});
