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
import { InventoryDraftRepository } from './inventory-drafts.repository.js';
import { InventoryDraftService } from './inventory-drafts.service.js';
import { InventoryPostingRepository } from './inventory-posting.repository.js';
import { InventoryPostingService } from './inventory-posting.service.js';
import { InventoryReversalRepository } from './inventory-reversal.repository.js';
import { InventoryReversalService } from './inventory-reversal.service.js';

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
  let drafts: InventoryDraftService;
  let posting: InventoryPostingService;
  let reversals: InventoryReversalService;

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
    drafts = new InventoryDraftService(new InventoryDraftRepository(database));
    posting = new InventoryPostingService(new InventoryPostingRepository(database));
    reversals = new InventoryReversalService(new InventoryReversalRepository(database));
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

  it('authors draft headers with canonical numbers, exact replay, tenant isolation, audit, and no outbox', async () => {
    const first = await drafts.create(context, [branchId], 'draft-create', {
      branchId,
      movementType: 'adjustment',
      reasonCode: 'COUNT',
    });
    const replay = await drafts.create(context, [branchId], 'draft-create', {
      branchId,
      movementType: 'adjustment',
      reasonCode: 'COUNT',
    });
    expect(first.replayed).toBe(false);
    expect(replay).toEqual({ value: first.value, replayed: true });
    expect(first.value.movement_number).toMatch(/^IMV-[0-9a-f]{32}$/u);
    expect(first.value.movement_number).toBe(`IMV-${String(first.value.id).replaceAll('-', '')}`);
    await expect(drafts.get(companyId, [], String(first.value.id))).rejects.toMatchObject({
      code: 'inventory_movement_not_found',
    });
    await expect(
      drafts.create(context, [branchId], 'draft-create', {
        branchId,
        movementType: 'opening_balance',
      }),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' });
    const effects = await database.pool.query<{ audits: string; events: string }>(
      `select
       (select count(*)::text from audit_log where company_id=$1 and entity_id=$2) audits,
       (select count(*)::text from outbox_events where company_id=$1 and aggregate_id=$2) events`,
      [companyId, first.value.id],
    );
    expect(effects.rows[0]).toEqual({ audits: '1', events: '0' });
  });

  it('adds, edits, lists and deletes lines with parent ETags and no balance mutation', async () => {
    const location = defined(
      (await locations.list(companyId, [branchId], { limit: 20 })).items.find(
        (item) => item.status === 'active' && item.allowsReceiving,
      ),
      'Expected an active location.',
    );
    const movement = await drafts.create(context, [branchId], 'line-draft', {
      branchId,
      movementType: 'opening_balance',
    });
    const movementId = String(movement.value.id);
    const added = await drafts.addLine(
      context,
      [branchId],
      movementId,
      1n,
      'line-create',
      {
        productVariantId: variantId,
        destinationLocationId: location.id,
        quantity: '2',
        unitOfMeasureCode: 'unit',
      },
      false,
    );
    const replay = await drafts.addLine(
      context,
      [branchId],
      movementId,
      1n,
      'line-create',
      {
        productVariantId: variantId,
        destinationLocationId: location.id,
        quantity: '2',
        unitOfMeasureCode: 'unit',
      },
      false,
    );
    expect(replay).toEqual({ value: added.value, replayed: true });
    expect(added.value).toMatchObject({ version: 2 });
    const lineId = String((added.value.line as Readonly<Record<string, unknown>>).id);
    await expect(
      drafts.addLine(
        context,
        [branchId],
        movementId,
        2n,
        'line-duplicate',
        {
          productVariantId: variantId,
          destinationLocationId: location.id,
          quantity: '3',
          unitOfMeasureCode: 'unit',
        },
        false,
      ),
    ).rejects.toMatchObject({ code: 'duplicate_movement_line' });
    const patched = await drafts.patchLine(
      context,
      [branchId],
      movementId,
      lineId,
      2n,
      { quantity: '3', reasonCode: 'RECOUNT' },
      false,
    );
    expect(patched).toMatchObject({ version: 3n });
    expect(
      (await drafts.listLines(companyId, [branchId], movementId, false, { limit: 10 })).items,
    ).toEqual([expect.objectContaining({ id: lineId, quantity: '3.000000' })]);
    await expect(
      drafts.patch(context, [branchId], movementId, 3n, { movementType: 'adjustment' }),
    ).rejects.toMatchObject({ code: 'invalid_movement_state' });
    const balancesBefore = await database.pool.query<{ value: string }>(
      `select coalesce(sum(quantity_on_hand),0)::text value from inventory_balances where company_id=$1`,
      [companyId],
    );
    const deleted = await drafts.deleteLine(context, [branchId], movementId, lineId, 3n);
    expect(deleted).toEqual({ movementId, deletedLineId: lineId, version: 4n });
    const balancesAfter = await database.pool.query<{ value: string }>(
      `select coalesce(sum(quantity_on_hand),0)::text value from inventory_balances where company_id=$1`,
      [companyId],
    );
    expect(balancesAfter.rows).toEqual(balancesBefore.rows);
  });

  it('cancels drafts exactly once and preserves terminal idempotent replay', async () => {
    const created = await drafts.create(context, [branchId], 'cancel-draft', {
      branchId,
      movementType: 'adjustment',
    });
    const id = String(created.value.id);
    const cancelled = await drafts.cancel(
      context,
      [branchId],
      id,
      1n,
      'cancel-command',
      'ABANDONED',
      'Operator abandoned the draft.',
    );
    const replay = await drafts.cancel(
      context,
      [branchId],
      id,
      1n,
      'cancel-command',
      'ABANDONED',
      'Operator abandoned the draft.',
    );
    expect(cancelled.value).toMatchObject({ status: 'cancelled', version: 2 });
    expect(replay).toEqual({ value: cancelled.value, replayed: true });
    await expect(
      drafts.cancel(context, [branchId], id, 2n, 'new-cancel-command', 'AGAIN'),
    ).rejects.toMatchObject({ code: 'movement_already_cancelled' });
  });

  it('submits and posts an opening balance atomically with exact replay and events', async () => {
    const location = (
      await locations.create(context, 'posting-location', {
        branchId,
        code: 'POSTING',
        name: 'Posting verification',
        locationType: 'main',
      })
    ).value;
    const created = await drafts.create(context, [branchId], 'posting-opening', {
      branchId,
      movementType: 'opening_balance',
    });
    const id = String(created.value.id);
    await drafts.addLine(
      context,
      [branchId],
      id,
      1n,
      'posting-opening-line',
      {
        productVariantId: variantId,
        destinationLocationId: location.id,
        quantity: '7',
        unitOfMeasureCode: 'unit',
      },
      false,
    );
    const submitted = await posting.submit(context, [branchId], id, 2n, 'submit-opening');
    const submitReplay = await posting.submit(context, [branchId], id, 2n, 'submit-opening');
    expect(submitted.value).toMatchObject({ status: 'pending', version: 3 });
    expect(submitReplay).toEqual({ value: submitted.value, replayed: true });
    const posted = await posting.post(context, [branchId], id, 3n, 'post-opening');
    const replay = await posting.post(context, [branchId], id, 3n, 'post-opening');
    expect(posted.value).toMatchObject({
      status: 'posted',
      version: 4,
      affected_balance_count: 1,
    });
    expect(replay).toEqual({ value: posted.value, replayed: true });
    const effects = await database.pool.query<{
      quantity_on_hand: string;
      quantity_reserved: string;
      quantity_in_transit: string;
      average_unit_cost: string;
      currency_code: string | null;
      audits: string;
      events: string;
      line_costs: string;
    }>(
      `select b.quantity_on_hand::text,b.quantity_reserved::text,
       b.quantity_in_transit::text,b.average_unit_cost::text,b.currency_code,
       (select count(*)::text from audit_log where company_id=$1 and entity_id=$3
         and action in ('inventory_movement.submitted','inventory_movement.posted')) audits,
       (select count(*)::text from outbox_events where company_id=$1
         and payload->>'movement_id'=$3::text) events,
       (select count(*)::text from inventory_movement_lines where company_id=$1
         and inventory_movement_id=$3
         and (unit_cost is not null or extended_cost is not null or currency_code is not null)) line_costs
       from inventory_balances b where b.company_id=$1
         and b.inventory_location_id=$2 and b.product_variant_id=$4`,
      [companyId, location.id, id, variantId],
    );
    expect(effects.rows[0]).toEqual({
      quantity_on_hand: '7.000000',
      quantity_reserved: '0.000000',
      quantity_in_transit: '0.000000',
      average_unit_cost: '0.0000',
      currency_code: null,
      audits: '2',
      events: '2',
      line_costs: '0',
    });
  });

  it('rejects empty, stale, cross-branch, and conflicting submit commands without effects', async () => {
    const created = await drafts.create(context, [branchId], 'submit-rejections', {
      branchId,
      movementType: 'adjustment',
    });
    const id = String(created.value.id);
    await expect(posting.submit(context, [branchId], id, 1n, 'submit-empty')).rejects.toMatchObject(
      { code: 'movement_has_no_lines' },
    );
    await expect(posting.submit(context, [], id, 1n, 'submit-hidden')).rejects.toMatchObject({
      code: 'inventory_movement_not_found',
    });
    await expect(
      posting.submit(context, [branchId], id, 99n, 'submit-stale'),
    ).rejects.toMatchObject({ code: 'version_conflict' });
    const effects = await database.pool.query<{ count: string }>(
      `select count(*)::text count from audit_log
       where company_id=$1 and entity_id=$2 and action='inventory_movement.submitted'`,
      [companyId, id],
    );
    expect(effects.rows[0]?.count).toBe('0');
  });

  it('aggregates outbound demand, prevents negative stock, and serializes posters', async () => {
    const location = defined(
      (await locations.list(companyId, [branchId], { limit: 20 })).items.find(
        (item) => item.status === 'active' && item.allowsIssuing,
      ),
      'Expected an issuing location.',
    );
    await database.pool.query(
      `insert into inventory_balances
       (id,company_id,branch_id,inventory_location_id,product_variant_id,quantity_on_hand)
       values($1,$2,$3,$4,$5,10)
       on conflict(company_id,inventory_location_id,product_variant_id)
       do update set quantity_on_hand=10,quantity_reserved=0`,
      [randomUUID(), companyId, branchId, location.id, variantId],
    );
    const created = await drafts.create(context, [branchId], 'posting-outbound', {
      branchId,
      movementType: 'adjustment',
    });
    const id = String(created.value.id);
    await drafts.addLine(
      context,
      [branchId],
      id,
      1n,
      'posting-outbound-line',
      {
        productVariantId: variantId,
        sourceLocationId: location.id,
        quantity: '4',
        unitOfMeasureCode: 'unit',
      },
      false,
    );
    await posting.submit(context, [branchId], id, 2n, 'submit-outbound');
    const outcomes = await Promise.allSettled([
      posting.post(context, [branchId], id, 3n, 'post-outbound-a'),
      posting.post(context, [branchId], id, 3n, 'post-outbound-b'),
    ]);
    expect(outcomes.filter((value) => value.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((value) => value.status === 'rejected')).toHaveLength(1);
    const balance = await database.pool.query<{ quantity: string }>(
      `select quantity_on_hand::text quantity from inventory_balances
       where company_id=$1 and inventory_location_id=$2 and product_variant_id=$3`,
      [companyId, location.id, variantId],
    );
    expect(balance.rows[0]?.quantity).toBe('6.000000');

    const insufficient = await drafts.create(context, [branchId], 'posting-insufficient', {
      branchId,
      movementType: 'adjustment',
    });
    const insufficientId = String(insufficient.value.id);
    await drafts.addLine(
      context,
      [branchId],
      insufficientId,
      1n,
      'posting-insufficient-line',
      {
        productVariantId: variantId,
        sourceLocationId: location.id,
        quantity: '7',
        unitOfMeasureCode: 'unit',
      },
      false,
    );
    await posting.submit(context, [branchId], insufficientId, 2n, 'submit-insufficient');
    await expect(
      posting.post(context, [branchId], insufficientId, 3n, 'post-insufficient'),
    ).rejects.toMatchObject({ code: 'insufficient_inventory' });
    const unchanged = await drafts.get(companyId, [branchId], insufficientId);
    expect(unchanged).toMatchObject({ status: 'pending', version: 3n });
    const failedEffects = await database.pool.query<{ audits: string; events: string }>(
      `select
       (select count(*)::text from audit_log where company_id=$1 and entity_id=$2
         and action='inventory_movement.posted') audits,
       (select count(*)::text from outbox_events where company_id=$1
         and payload->>'movement_id'=$2::text) events`,
      [companyId, insufficientId],
    );
    expect(failedEffects.rows[0]).toEqual({ audits: '0', events: '0' });
  });

  it('reverses a posted opening balance atomically with exact replay and immutable costs', async () => {
    const location = (
      await locations.create(context, 'reversal-location', {
        branchId,
        code: 'REVERSAL',
        name: 'Reversal verification',
        locationType: 'main',
      })
    ).value;
    const created = await drafts.create(context, [branchId], 'reversal-opening', {
      branchId,
      movementType: 'opening_balance',
    });
    const originalId = String(created.value.id);
    await drafts.addLine(
      context,
      [branchId],
      originalId,
      1n,
      'reversal-opening-line',
      {
        productVariantId: variantId,
        destinationLocationId: location.id,
        quantity: '3',
        unitOfMeasureCode: 'unit',
      },
      false,
    );
    await posting.submit(context, [branchId], originalId, 2n, 'reversal-submit');
    await posting.post(context, [branchId], originalId, 3n, 'reversal-post');

    const reversed = await reversals.reverse(
      context,
      [branchId],
      originalId,
      4n,
      'reversal-command',
      { reasonCode: 'ENTRY_ERROR', note: 'Correct operator entry.' },
    );
    const replay = await reversals.reverse(
      context,
      [branchId],
      originalId,
      4n,
      'reversal-command',
      { reasonCode: 'ENTRY_ERROR', note: 'Correct operator entry.' },
    );
    expect(reversed.replayed).toBe(false);
    expect(replay).toEqual({ value: reversed.value, replayed: true });
    expect(reversed.value).toMatchObject({
      original_movement_id: originalId,
      original_status: 'reversed',
      original_version: 5,
      reversal_status: 'posted',
      reversal_version: 1,
      affected_balance_count: 1,
    });
    const reversalId = String(reversed.value.reversal_movement_id);
    const evidence = await database.pool.query<{
      original_status: string;
      original_version: string;
      reversed_by_movement_id: string;
      reversal_status: string;
      reversal_version: string;
      reversal_of_movement_id: string;
      quantity_on_hand: string;
      quantity_reserved: string;
      quantity_in_transit: string;
      average_unit_cost: string;
      currency_code: string | null;
      line_count: string;
      cost_count: string;
      audit_count: string;
      event_count: string;
    }>(
      `select o.status original_status,o.version::text original_version,
       o.reversed_by_movement_id,r.status reversal_status,r.version::text reversal_version,
       r.reversal_of_movement_id,b.quantity_on_hand::text,b.quantity_reserved::text,
       b.quantity_in_transit::text,b.average_unit_cost::text,b.currency_code,
       (select count(*)::text from inventory_movement_lines where company_id=$1
         and inventory_movement_id=$3) line_count,
       (select count(*)::text from inventory_movement_lines where company_id=$1
         and inventory_movement_id=$3
         and (unit_cost is not null or extended_cost is not null or currency_code is not null))
         cost_count,
       (select count(*)::text from audit_log where company_id=$1
         and action in ('inventory_movement.reversal_created','inventory_movement.reversed')
         and metadata->>'original_movement_id'=$2::text) audit_count,
       (select count(*)::text from outbox_events where company_id=$1
         and (payload->>'original_movement_id'=$2::text
           or payload->>'reversal_movement_id'=$3::text)) event_count
       from inventory_movements o
       join inventory_movements r on r.company_id=o.company_id and r.id=$3::uuid
       join inventory_balances b on b.company_id=o.company_id
         and b.inventory_location_id=$4 and b.product_variant_id=$5
       where o.company_id=$1::uuid and o.id=$2::uuid`,
      [companyId, originalId, reversalId, location.id, variantId],
    );
    expect(evidence.rows[0]).toEqual({
      original_status: 'reversed',
      original_version: '5',
      reversed_by_movement_id: reversalId,
      reversal_status: 'posted',
      reversal_version: '1',
      reversal_of_movement_id: originalId,
      quantity_on_hand: '0.000000',
      quantity_reserved: '0.000000',
      quantity_in_transit: '0.000000',
      average_unit_cost: '0.0000',
      currency_code: null,
      line_count: '1',
      cost_count: '0',
      audit_count: '2',
      event_count: '3',
    });
    await expect(
      reversals.reverse(context, [branchId], originalId, 5n, 'second-reversal', {
        reasonCode: 'AGAIN',
        note: null,
      }),
    ).rejects.toMatchObject({ code: 'movement_already_reversed' });
  });

  it('protects reserved stock and permits at most one concurrent reversal', async () => {
    const location = (
      await locations.create(context, 'reversal-reserved-location', {
        branchId,
        code: 'REVRES',
        name: 'Reserved reversal',
        locationType: 'main',
      })
    ).value;
    const created = await drafts.create(context, [branchId], 'reversal-reserved', {
      branchId,
      movementType: 'opening_balance',
    });
    const originalId = String(created.value.id);
    await drafts.addLine(
      context,
      [branchId],
      originalId,
      1n,
      'reversal-reserved-line',
      {
        productVariantId: variantId,
        destinationLocationId: location.id,
        quantity: '5',
        unitOfMeasureCode: 'unit',
      },
      false,
    );
    await posting.submit(context, [branchId], originalId, 2n, 'reversal-reserved-submit');
    await posting.post(context, [branchId], originalId, 3n, 'reversal-reserved-post');
    await database.pool.query(
      `update inventory_balances set quantity_reserved=1
       where company_id=$1 and inventory_location_id=$2 and product_variant_id=$3`,
      [companyId, location.id, variantId],
    );
    await expect(
      reversals.reverse(context, [branchId], originalId, 4n, 'reserved-failure', {
        reasonCode: 'ENTRY_ERROR',
        note: null,
      }),
    ).rejects.toMatchObject({ code: 'insufficient_inventory' });
    const unchanged = await database.pool.query<{
      status: string;
      version: string;
      reversals: string;
      successful_audits: string;
    }>(
      `select m.status,m.version::text,
       (select count(*)::text from inventory_movements r
         where r.company_id=m.company_id and r.reversal_of_movement_id=m.id) reversals,
       (select count(*)::text from audit_log a where a.company_id=m.company_id
         and a.metadata->>'original_movement_id'=m.id::text
         and a.action like 'inventory_movement.revers%') successful_audits
       from inventory_movements m where m.company_id=$1 and m.id=$2`,
      [companyId, originalId],
    );
    expect(unchanged.rows[0]).toEqual({
      status: 'posted',
      version: '4',
      reversals: '0',
      successful_audits: '0',
    });
    await database.pool.query(
      `update inventory_balances set quantity_reserved=0
       where company_id=$1 and inventory_location_id=$2 and product_variant_id=$3`,
      [companyId, location.id, variantId],
    );
    const outcomes = await Promise.allSettled([
      reversals.reverse(context, [branchId], originalId, 4n, 'race-a', {
        reasonCode: 'ENTRY_ERROR',
        note: null,
      }),
      reversals.reverse(context, [branchId], originalId, 4n, 'race-b', {
        reasonCode: 'ENTRY_ERROR',
        note: null,
      }),
    ]);
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    const rejected = outcomes.find(({ status }) => status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: { code: 'movement_already_reversed' },
    });
  });
});
