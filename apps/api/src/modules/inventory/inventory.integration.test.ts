import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';

import {
  InventoryBalanceReadRepository,
  InventoryLocationRepository,
  InventoryMovementReadRepository,
} from './inventory.repository.js';
import {
  InventoryBalanceReadService,
  InventoryLocationService,
  InventoryMovementReadService,
} from './inventory.service.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;

function defined<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

integration('PostgreSQL inventory E064-E068', () => {
  let database: DatabaseClient;
  let locations: InventoryLocationService;
  let balances: InventoryBalanceReadService;
  let movements: InventoryMovementReadService;

  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const branchId = randomUUID();
  const otherBranchId = randomUUID();
  const actorId = randomUUID();
  const productId = randomUUID();
  const variantId = randomUUID();
  const context = {
    companyId,
    actorId,
    requestId: 'inventory-request',
    correlationId: 'inventory-correlation',
    timestamp: new Date('2026-07-27T12:00:00.000Z'),
  };

  beforeAll(async () => {
    if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({
      connectionString: databaseUrl,
      applicationName: 'asone-inventory-api-integration',
    });
    const migrationsPath = resolve(import.meta.dirname, '../../../../../packages/database/drizzle');
    const present = await database.pool.query<{ present: string | null }>(
      `select to_regclass('public.inventory_reservations')::text present`,
    );
    if (present.rows[0]?.present === null)
      for (const name of [
        '0000_fantastic_black_cat.sql',
        '0001_high_thor.sql',
        '0002_true_sugar_man.sql',
        '0003_curved_zuras.sql',
        '0004_pink_nehzno.sql',
        '0005_inventory_operations_foundation.sql',
        '0006_inventory_transfers_and_reservations.sql',
      ]) {
        const sql = await readFile(resolve(migrationsPath, name), 'utf8');
        for (const statement of sql.split('--> statement-breakpoint'))
          if (statement.trim().length > 0) await database.pool.query(statement);
      }
    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'Inventory','Inventory',$2,'active','UTC','MXN','es-MX'),
             ($3,'Other Inventory','Other Inventory',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `inventory-${companyId}`, otherCompanyId, `inventory-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'Main','MAIN','active','UTC'),($3,$4,'Other','OTHER','active','UTC')`,
      [branchId, companyId, otherBranchId, otherCompanyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'Inventory User','active')`,
      [actorId, `inventory-${actorId}@example.test`],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status)
       values($1,$2,$3,'active'),($4,$5,$3,'active')`,
      [randomUUID(), companyId, actorId, randomUUID(), otherCompanyId],
    );
    await database.pool.query(
      `insert into products
       (id,company_id,code,normalized_code,name,product_type,tracks_inventory,status,created_by,updated_by)
       values($1,$2,'PRODUCT','product','Product','simple',true,'active',$3,$3)`,
      [productId, companyId, actorId],
    );
    await database.pool.query(
      `insert into product_variants
       (id,company_id,product_id,sku,normalized_sku,name,unit_of_measure_code,quantity_scale,
        tracks_inventory,standard_cost,currency_code,is_default,option_signature,status,created_by,updated_by)
       values($1,$2,$3,'SKU','sku','Variant','unit',0,true,12.3400,'MXN',true,$4,'active',$5,$5)`,
      [variantId, companyId, productId, '0'.repeat(64), actorId],
    );
    locations = new InventoryLocationService(new InventoryLocationRepository(database));
    balances = new InventoryBalanceReadService(new InventoryBalanceReadRepository(database));
    movements = new InventoryMovementReadService(new InventoryMovementReadRepository(database));
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
    await database.pool.query('delete from inventory_movement_lines where company_id=$1', [
      companyId,
    ]);
    await database.pool.query('delete from inventory_balances where company_id=$1', [companyId]);
    await database.pool.query('delete from inventory_movements where company_id=$1', [companyId]);
    await database.pool.query('delete from inventory_locations where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
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

  it('creates, normalizes, replays exactly, and commits audit and outbox atomically', async () => {
    const first = await locations.create(context, 'location-create', {
      branchId,
      code: ' MAIN ',
      name: ' Main warehouse ',
      locationType: 'main',
      isDefault: true,
    });
    const replay = await locations.create(context, 'location-create', {
      branchId,
      code: ' MAIN ',
      name: ' Main warehouse ',
      locationType: 'main',
      isDefault: true,
    });
    expect(first.value).toMatchObject({ normalizedCode: 'main', version: 1n });
    expect(replay).toMatchObject({ replayed: true });
    expect(replay.value.id).toBe(first.value.id);
    expect(replay.value.createdAt).toBeInstanceOf(Date);
    await expect(
      locations.create(context, 'location-create', {
        branchId,
        code: 'CHANGED',
        name: 'Changed',
        locationType: 'main',
      }),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' });
    const effects = await database.pool.query<{ audits: string; events: string }>(
      `select
       (select count(*)::text from audit_log where company_id=$1 and entity_id=$2) audits,
       (select count(*)::text from outbox_events where company_id=$1 and aggregate_id=$2) events`,
      [companyId, first.value.id],
    );
    expect(effects.rows[0]).toEqual({ audits: '1', events: '1' });
  });

  it('enforces tenant branches, normalized-code uniqueness, and one active default', async () => {
    await expect(
      locations.create(context, 'other-branch', {
        branchId: otherBranchId,
        code: 'OUTSIDE',
        name: 'Outside',
        locationType: 'main',
      }),
    ).rejects.toMatchObject({ code: 'branch_not_found' });
    await expect(
      locations.create(context, 'duplicate-code', {
        branchId,
        code: 'main',
        name: 'Duplicate',
        locationType: 'main',
      }),
    ).rejects.toMatchObject({ code: 'resource_conflict' });
    await expect(
      locations.create(context, 'duplicate-default', {
        branchId,
        code: 'SECOND',
        name: 'Second',
        locationType: 'main',
        isDefault: true,
      }),
    ).rejects.toMatchObject({ code: 'resource_conflict' });
  });

  it('lists deterministically with tenant, branch, filter, and cursor isolation', async () => {
    const second = (
      await locations.create(context, 'second-location', {
        branchId,
        code: 'FLOOR',
        name: 'Floor',
        locationType: 'sales_floor',
      })
    ).value;
    const firstPage = await locations.list(companyId, [branchId], { limit: 1 });
    expect(firstPage.nextCursor).not.toBeNull();
    const cursor = defined(firstPage.nextCursor, 'Expected a location cursor.');
    const secondPage = await locations.list(companyId, [branchId], {
      limit: 10,
      cursor,
    });
    expect(new Set([...firstPage.items, ...secondPage.items].map((item) => item.id)).size).toBe(2);
    expect(
      (await locations.list(companyId, [branchId], { limit: 10, locationType: 'sales_floor' }))
        .items,
    ).toEqual([expect.objectContaining({ id: second.id })]);
    expect((await locations.list(otherCompanyId, [otherBranchId], { limit: 10 })).items).toEqual(
      [],
    );
    expect((await locations.list(companyId, [], { limit: 10 })).items).toEqual([]);
  });

  it('updates once, rejects stale/cross-scope writes, and protects dependencies', async () => {
    const current = (await locations.list(companyId, [branchId], { limit: 10 })).items.find(
      (item) => item.normalizedCode === 'main',
    );
    expect(current).toBeDefined();
    const main = defined(current, 'Expected the main location.');
    const updated = await locations.patch(context, [branchId], main.id, main.version, {
      name: 'Updated warehouse',
    });
    expect(updated).toMatchObject({ name: 'Updated warehouse', version: main.version + 1n });
    await expect(
      locations.patch(context, [branchId], main.id, main.version, { name: 'Stale' }),
    ).rejects.toMatchObject({ code: 'version_conflict' });
    await expect(
      locations.patch(context, [], main.id, updated.version, { name: 'Outside' }),
    ).rejects.toMatchObject({ code: 'inventory_location_not_found' });

    await database.pool.query(
      `insert into inventory_balances
       (id,company_id,branch_id,inventory_location_id,product_variant_id,quantity_on_hand,
        quantity_reserved,quantity_in_transit,average_unit_cost,currency_code)
       values($1,$2,$3,$4,$5,10.500000,2.250000,1.000000,12.3400,'MXN')`,
      [randomUUID(), companyId, branchId, main.id, variantId],
    );
    await expect(
      locations.patch(context, [branchId], main.id, updated.version, {
        status: 'inactive',
        isDefault: false,
        allowsReceiving: false,
        allowsIssuing: false,
      }),
    ).rejects.toMatchObject({ code: 'resource_conflict' });
    const effects = await database.pool.query<{ audits: string; events: string }>(
      `select
       (select count(*)::text from audit_log where company_id=$1 and entity_id=$2) audits,
       (select count(*)::text from outbox_events where company_id=$1 and aggregate_id=$2) events`,
      [companyId, main.id],
    );
    expect(effects.rows[0]).toEqual({ audits: '2', events: '2' });
  });

  it('returns exact balance decimals, derived availability, deterministic joins and redacted costs', async () => {
    const withoutCost = await balances.list(companyId, [branchId], false, { limit: 10 });
    expect(withoutCost.items).toEqual([
      expect.objectContaining({
        quantity_on_hand: '10.500000',
        quantity_reserved: '2.250000',
        quantity_available: '8.250000',
        sku: 'SKU',
        product_name: 'Product',
      }),
    ]);
    expect(withoutCost.items[0]).not.toHaveProperty('average_unit_cost');
    expect(withoutCost.items[0]).not.toHaveProperty('currency_code');
    const withCost = await balances.list(companyId, [branchId], true, { limit: 10 });
    expect(withCost.items[0]).toMatchObject({
      average_unit_cost: '12.3400',
      currency_code: 'MXN',
    });
    expect((await balances.list(companyId, [], true, { limit: 10 })).items).toEqual([]);
    expect(
      (await balances.list(otherCompanyId, [otherBranchId], true, { limit: 10 })).items,
    ).toEqual([]);
  });

  it('filters movement headers without posting effects, mutations, audit, outbox, or stock events', async () => {
    const movementId = randomUUID();
    await database.pool.query(
      `insert into inventory_movements
       (id,company_id,branch_id,movement_number,movement_type,status,reason_code,occurred_at,created_by)
       values($1,$2,$3,'MOV-001','adjustment','draft','COUNT',$4,$5)`,
      [movementId, companyId, branchId, context.timestamp, actorId],
    );
    const before = await database.pool.query<{ audits: string; events: string }>(
      `select
       (select count(*)::text from audit_log where company_id=$1) audits,
       (select count(*)::text from outbox_events where company_id=$1) events`,
      [companyId],
    );
    const page = await movements.list(companyId, [branchId], {
      limit: 10,
      status: 'draft',
      movementType: 'adjustment',
    });
    expect(page.items).toEqual([
      expect.objectContaining({
        id: movementId,
        movement_type: 'adjustment',
        status: 'draft',
      }),
    ]);
    expect((await movements.list(companyId, [], { limit: 10 })).items).toEqual([]);
    expect((await movements.list(otherCompanyId, [otherBranchId], { limit: 10 })).items).toEqual(
      [],
    );
    const after = await database.pool.query<{ audits: string; events: string }>(
      `select
       (select count(*)::text from audit_log where company_id=$1) audits,
       (select count(*)::text from outbox_events where company_id=$1) events`,
      [companyId],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
    expect(
      await database.pool.query(
        `select 1 from outbox_events where company_id=$1 and event_type='inventory.stock.changed'`,
        [companyId],
      ),
    ).toMatchObject({ rowCount: 0 });
  });

  it('serializes concurrent idempotent creation and optimistic updates', async () => {
    const input = {
      branchId,
      code: 'CONCURRENT',
      name: 'Concurrent',
      locationType: 'main' as const,
    };
    const [a, b] = await Promise.all([
      locations.create(context, 'concurrent-create', input),
      locations.create(context, 'concurrent-create', input),
    ]);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(a.value.id).toBe(b.value.id);
    const results = await Promise.allSettled([
      locations.patch(context, [branchId], a.value.id, a.value.version, { name: 'Winner A' }),
      locations.patch(context, [branchId], a.value.id, a.value.version, { name: 'Winner B' }),
    ]);
    expect(results.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((entry) => entry.status === 'rejected')).toHaveLength(1);
  });
});
