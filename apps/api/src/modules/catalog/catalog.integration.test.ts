import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';

import { CatalogRepository } from './catalog.repository.js';
import { CatalogService } from './catalog.service.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;
const migrationsPath = resolve(import.meta.dirname, '../../../../../packages/database/drizzle');

integration('PostgreSQL catalog categories and brands', () => {
  let database: DatabaseClient;
  let service: CatalogService;
  const companyId = randomUUID(),
    otherCompanyId = randomUUID(),
    userId = randomUUID();
  const context = {
    companyId,
    actorId: userId,
    requestId: 'request',
    correlationId: 'correlation',
    timestamp: new Date('2026-07-27T00:00:00.000Z'),
  };
  const otherContext = { ...context, companyId: otherCompanyId };
  beforeAll(async () => {
    if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({
      connectionString: databaseUrl,
      applicationName: 'asone-catalog-integration',
    });
    const present = await database.pool.query<{ present: string | null }>(
      `select to_regclass('public.product_categories')::text present`,
    );
    if (present.rows[0]?.present === null) {
      for (const name of [
        '0000_fantastic_black_cat.sql',
        '0001_high_thor.sql',
        '0002_true_sugar_man.sql',
        '0003_curved_zuras.sql',
        '0004_pink_nehzno.sql',
      ]) {
        const sql = await readFile(resolve(migrationsPath, name), 'utf8');
        for (const statement of sql.split('--> statement-breakpoint'))
          if (statement.trim().length > 0) await database.pool.query(statement);
      }
    }
    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
      values($1,'Catalog','Catalog',$2,'active','UTC','MXN','es-MX'),($3,'Other','Other',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `catalog-${companyId}`, otherCompanyId, `catalog-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)values($1,$2,$2,'Catalog User','active')`,
      [userId, `catalog-${userId}@example.test`],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status)
       values($1,$2,$3,'active'),($4,$5,$3,'active')`,
      [randomUUID(), companyId, userId, randomUUID(), otherCompanyId],
    );
    service = new CatalogService(new CatalogRepository(database));
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
    await database.pool.query('delete from products where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from product_categories where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from brands where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from company_memberships where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from companies where id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from users where id=$1', [userId]);
    await database.close();
  });
  it('creates, replays idempotently, and rejects changed payloads', async () => {
    const first = await service.createCategory(context, 'category-key', {
      code: 'Food',
      name: 'Food',
    });
    const replay = await service.createCategory(context, 'category-key', {
      code: 'Food',
      name: 'Food',
    });
    expect(replay.replayed).toBe(true);
    expect(replay.value.id).toBe(first.value.id);
    await expect(
      service.createCategory(context, 'category-key', { code: 'Other', name: 'Other' }),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' });
  });
  it('isolates tenant reads and rejects duplicate normalized codes', async () => {
    const created = await service.createBrand(context, 'brand-key', {
      code: ' ACME ',
      name: 'Acme',
    });
    await expect(
      service.createBrand(context, 'brand-key-2', { code: 'acme', name: 'Other' }),
    ).rejects.toMatchObject({ code: 'duplicate_brand_code' });
    const tenantCategory = (
      await service.createCategory(context, 'tenant-category', { code: 'tenant', name: 'Tenant' })
    ).value;
    await expect(service.category(otherCompanyId, tenantCategory.id)).rejects.toMatchObject({
      code: 'resource_not_found',
    });
    expect((await service.listBrands(otherCompanyId, { limit: 10 })).items).toHaveLength(0);
    expect(created.value.companyId).toBe(companyId);
  });
  it('rejects duplicate category codes and cross-company parents', async () => {
    await service.createCategory(context, 'duplicate-category-a', { code: ' DUP ', name: 'A' });
    await expect(
      service.createCategory(context, 'duplicate-category-b', { code: 'dup', name: 'B' }),
    ).rejects.toMatchObject({ code: 'duplicate_category_code' });
    const external = (
      await service.createCategory(otherContext, 'external-parent', {
        code: 'external',
        name: 'External',
      })
    ).value;
    await expect(
      service.createCategory(context, 'cross-parent', {
        code: 'cross-parent',
        name: 'Cross',
        parentId: external.id,
      }),
    ).rejects.toMatchObject({ code: 'resource_not_found' });
  });
  it('detects direct and multi-level category cycles', async () => {
    const a = (await service.createCategory(context, 'a', { code: 'a', name: 'A' })).value;
    const b = (await service.createCategory(context, 'b', { code: 'b', name: 'B', parentId: a.id }))
      .value;
    await expect(
      service.patchCategory(context, a.id, a.version, { parentId: a.id }),
    ).rejects.toMatchObject({ code: 'category_cycle_detected' });
    await expect(
      service.patchCategory(context, a.id, a.version, { parentId: b.id }),
    ).rejects.toMatchObject({ code: 'category_cycle_detected' });
  });
  it('increments version once, detects stale writes, and writes audit/outbox', async () => {
    const c = (
      await service.createCategory(context, 'version', { code: 'version', name: 'Version' })
    ).value;
    const updated = await service.patchCategory(context, c.id, c.version, { name: 'Updated' });
    expect(updated.version).toBe(c.version + 1n);
    await expect(
      service.patchCategory(context, c.id, c.version, { name: 'Stale' }),
    ).rejects.toMatchObject({ code: 'version_conflict' });
    const counts = await database.pool.query<{ audits: string; events: string }>(
      `select
      (select count(*)::text from audit_log where company_id=$1 and entity_id=$2) audits,
      (select count(*)::text from outbox_events where company_id=$1 and aggregate_id=$2) events`,
      [companyId, c.id],
    );
    expect(counts.rows[0]).toEqual({ audits: '2', events: '2' });
  });
  it('retires categories logically with exactly one version increment', async () => {
    const value = (
      await service.createCategory(context, 'retire-category', {
        code: 'retire-category',
        name: 'Retire',
      })
    ).value;
    const retired = await service.patchCategory(context, value.id, value.version, {
      status: 'retired',
    });
    expect(retired).toMatchObject({ status: 'retired', version: value.version + 1n });
    expect(retired.deletedAt).toBeInstanceOf(Date);
    expect(await service.category(companyId, value.id)).toMatchObject({ status: 'retired' });
  });
  it('replays brand creation, rejects changed payload, stale writes, and retires logically', async () => {
    const first = await service.createBrand(context, 'brand-replay', {
      code: 'replay-brand',
      name: 'Replay',
    });
    const replay = await service.createBrand(context, 'brand-replay', {
      code: 'replay-brand',
      name: 'Replay',
    });
    expect(replay).toMatchObject({ replayed: true });
    expect(replay.value.id).toBe(first.value.id);
    await expect(
      service.createBrand(context, 'brand-replay', {
        code: 'other-brand',
        name: 'Other',
      }),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' });
    const retired = await service.patchBrand(context, first.value.id, first.value.version, {
      status: 'retired',
    });
    expect(retired).toMatchObject({ status: 'retired', version: first.value.version + 1n });
    expect(retired.deletedAt).toBeInstanceOf(Date);
    await expect(
      service.patchBrand(context, first.value.id, first.value.version, { name: 'Stale' }),
    ).rejects.toMatchObject({ code: 'version_conflict' });
  });
  it('blocks brand retirement when an active product depends on it', async () => {
    const brand = (
      await service.createBrand(context, 'dependent-brand', {
        code: 'dependent-brand',
        name: 'Dependent',
      })
    ).value;
    await database.pool.query(
      `insert into products
       (id,company_id,brand_id,code,normalized_code,name,product_type,tracks_inventory,status,
        created_by,updated_by)
       values($1,$2,$3,'dependent-product','dependent-product','Dependent','simple',false,'active',$4,$4)`,
      [randomUUID(), companyId, brand.id, userId],
    );
    await expect(
      service.patchBrand(context, brand.id, brand.version, { status: 'retired' }),
    ).rejects.toMatchObject({ code: 'product_has_active_dependencies' });
    expect((await new CatalogRepository(database).brand(companyId, brand.id))?.status).toBe(
      'active',
    );
  });
  it('rolls back mutation, audit, outbox, and idempotency when publication fails', async () => {
    await database.pool.query(`
      create or replace function reject_atomic_category_event() returns trigger language plpgsql as $$
      begin
        if new.event_type='category.created' and new.payload->>'code'='atomic-failure'
        then raise exception 'forced outbox failure';
        end if;
        return new;
      end $$;
      create trigger reject_atomic_category_event before insert on outbox_events
      for each row execute function reject_atomic_category_event()
    `);
    try {
      await expect(
        service.createCategory(context, 'atomic-failure-key', {
          code: 'atomic-failure',
          name: 'Atomic',
        }),
      ).rejects.toThrow('forced outbox failure');
      const counts = await database.pool.query<{
        categories: string;
        audits: string;
        events: string;
        keys: string;
      }>(
        `select
         (select count(*)::text from product_categories where company_id=$1 and normalized_code='atomic-failure') categories,
         (select count(*)::text from audit_log where company_id=$1 and metadata->>'code'='atomic-failure') audits,
         (select count(*)::text from outbox_events where company_id=$1 and payload->>'code'='atomic-failure') events,
         (select count(*)::text from idempotency_keys where company_id=$1 and key='atomic-failure-key') keys`,
        [companyId],
      );
      expect(counts.rows[0]).toEqual({ categories: '0', audits: '0', events: '0', keys: '0' });
    } finally {
      await database.pool.query('drop trigger reject_atomic_category_event on outbox_events');
      await database.pool.query('drop function reject_atomic_category_event()');
    }
  });
});
