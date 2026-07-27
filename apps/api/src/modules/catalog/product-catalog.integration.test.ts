import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';

import { CatalogRepository } from './catalog.repository.js';
import { CatalogService } from './catalog.service.js';
import { ProductCatalogRepository } from './product-catalog.repository.js';
import { ProductCatalogService } from './product-catalog.service.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;
const migrationsPath = resolve(import.meta.dirname, '../../../../../packages/database/drizzle');

integration('PostgreSQL products and default variants', { concurrent: false }, () => {
  let database: DatabaseClient;
  let catalog: CatalogService;
  let products: ProductCatalogService;
  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const userId = randomUUID();
  const context = {
    companyId,
    actorId: userId,
    requestId: 'product-request',
    correlationId: 'product-correlation',
    timestamp: new Date('2026-07-27T12:00:00.000Z'),
  };
  const otherContext = { ...context, companyId: otherCompanyId };

  beforeAll(async () => {
    if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({
      connectionString: databaseUrl,
      applicationName: 'asone-products-integration',
    });
    const present = await database.pool.query<{ present: string | null }>(
      `select to_regclass('public.products')::text present`,
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
       values($1,'Products','Products',$2,'active','UTC','MXN','es-MX'),
             ($3,'Other Products','Other Products',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `products-${companyId}`, otherCompanyId, `products-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'Product User','active')`,
      [userId, `products-${userId}@example.test`],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status)
       values($1,$2,$3,'active'),($4,$5,$3,'active')`,
      [randomUUID(), companyId, userId, randomUUID(), otherCompanyId],
    );
    catalog = new CatalogService(new CatalogRepository(database));
    products = new ProductCatalogService(new ProductCatalogRepository(database));
  });

  afterAll(async () => {
    await database.pool.query('drop trigger if exists product_test_audit_failure on audit_log');
    await database.pool.query('drop function if exists product_test_audit_failure()');
    await database.pool.query('delete from product_barcodes where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query(
      'delete from product_variant_option_values where company_id in ($1,$2)',
      [companyId, otherCompanyId],
    );
    await database.pool.query('delete from product_variants where company_id in ($1,$2)', [
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

  it('creates product, default variant, barcode, audit, outbox, and idempotency atomically', async () => {
    const request = {
      code: ' ACCESS ',
      name: 'Access',
      productType: 'simple' as const,
      tracksInventory: true,
      status: 'active' as const,
      defaultVariant: {
        sku: ' ACCESS-1 ',
        unitOfMeasureCode: 'unit',
        quantityScale: 0,
        standardCost: '12.34',
        currencyCode: 'mxn',
        barcode: { type: 'internal' as const, value: ' ACCESS001 ', isPrimary: true },
      },
    };
    const first = await products.createProduct(context, 'atomic-product', request);
    const replay = await products.createProduct(context, 'atomic-product', request);
    expect(replay).toMatchObject({ replayed: true });
    expect(replay.value.id).toBe(first.value.id);
    expect(first.value.defaultVariant).toMatchObject({
      sku: 'ACCESS-1',
      standardCost: '12.3400',
      isDefault: true,
    });
    const stored = await database.pool.query<{
      variants: string;
      barcodes: string;
      audits: string;
      events: string;
    }>(
      `select
       (select count(*)::text from product_variants where company_id=$1 and product_id=$2) variants,
       (select count(*)::text from product_barcodes b join product_variants v on v.id=b.product_variant_id and v.company_id=b.company_id where b.company_id=$1 and v.product_id=$2) barcodes,
       (select count(*)::text from audit_log where company_id=$1 and entity_id in ($2,$3)) audits,
       (select count(*)::text from outbox_events where company_id=$1 and aggregate_id in ($2,$3)) events`,
      [companyId, first.value.id, first.value.defaultVariant?.id],
    );
    expect(stored.rows[0]).toEqual({ variants: '1', barcodes: '1', audits: '2', events: '2' });
    await expect(
      products.createProduct(context, 'atomic-product', { ...request, name: 'Changed' }),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' });
  });

  it('isolates tenants and resolves SKU and barcode filters without product duplication', async () => {
    const external = await products.createProduct(otherContext, 'external-product', {
      code: 'external',
      name: 'External',
      productType: 'simple',
      tracksInventory: false,
      status: 'active',
      defaultVariant: {
        sku: 'external-sku',
        unitOfMeasureCode: 'unit',
        quantityScale: 0,
        standardCost: '0',
        currencyCode: 'MXN',
        barcode: { type: 'internal', value: 'external-barcode', isPrimary: true },
      },
    });
    await expect(products.product(companyId, external.value.id)).rejects.toMatchObject({
      code: 'resource_not_found',
    });
    expect(
      (await products.listProducts(companyId, { limit: 20, sku: 'external-sku' })).items,
    ).toHaveLength(0);
    expect(
      (await products.listProducts(otherCompanyId, { limit: 20, barcode: 'external-barcode' }))
        .items,
    ).toHaveLength(1);
  });

  it('maps duplicate codes, SKUs, and barcodes and rolls back failed nested creation', async () => {
    const base = await products.createProduct(context, 'duplicates-base', {
      code: 'duplicates',
      name: 'Duplicates',
      productType: 'simple',
      tracksInventory: false,
      status: 'active',
      defaultVariant: {
        sku: 'duplicates-sku',
        unitOfMeasureCode: 'unit',
        quantityScale: 0,
        standardCost: '0',
        currencyCode: 'MXN',
        barcode: { type: 'internal', value: 'duplicates-barcode', isPrimary: true },
      },
    });
    await expect(
      products.createProduct(context, 'duplicate-code', {
        code: ' DUPLICATES ',
        name: 'Duplicate',
        productType: 'simple',
        tracksInventory: false,
        status: 'active',
        defaultVariant: {
          sku: 'different-sku',
          unitOfMeasureCode: 'unit',
          quantityScale: 0,
          standardCost: '0',
          currencyCode: 'MXN',
        },
      }),
    ).rejects.toMatchObject({ code: 'duplicate_product_code' });
    await expect(
      products.createProduct(context, 'duplicate-sku', {
        code: 'different-code',
        name: 'Duplicate SKU',
        productType: 'simple',
        tracksInventory: false,
        status: 'active',
        defaultVariant: {
          sku: ' DUPLICATES-SKU ',
          unitOfMeasureCode: 'unit',
          quantityScale: 0,
          standardCost: '0',
          currencyCode: 'MXN',
        },
      }),
    ).rejects.toMatchObject({ code: 'duplicate_sku' });
    await expect(
      products.createProduct(context, 'duplicate-barcode', {
        code: 'barcode-rollback',
        name: 'Barcode rollback',
        productType: 'simple',
        tracksInventory: false,
        status: 'active',
        defaultVariant: {
          sku: 'barcode-rollback-sku',
          unitOfMeasureCode: 'unit',
          quantityScale: 0,
          standardCost: '0',
          currencyCode: 'MXN',
          barcode: { type: 'internal', value: 'duplicates-barcode', isPrimary: true },
        },
      }),
    ).rejects.toMatchObject({ code: 'duplicate_barcode' });
    expect(
      (await products.listProducts(companyId, { limit: 20, search: 'barcode-rollback' })).items,
    ).toHaveLength(0);
    expect(base.value.id).toBeTruthy();
  });

  it('rejects cross-tenant or retired category and brand references', async () => {
    const externalCategory = (
      await catalog.createCategory(otherContext, 'external-category-product', {
        code: 'external-product-category',
        name: 'External',
      })
    ).value;
    await expect(
      products.createProduct(context, 'cross-category-product', {
        code: 'cross-category',
        name: 'Cross',
        productType: 'variable',
        tracksInventory: false,
        status: 'draft',
        categoryId: externalCategory.id,
      }),
    ).rejects.toMatchObject({ code: 'validation_error' });
    const retiredBrand = (
      await catalog.createBrand(context, 'retired-product-brand', {
        code: 'retired-product-brand',
        name: 'Retired',
      })
    ).value;
    await catalog.patchBrand(context, retiredBrand.id, retiredBrand.version, { status: 'retired' });
    await expect(
      products.createProduct(context, 'retired-brand-product', {
        code: 'retired-brand-reference',
        name: 'Retired ref',
        productType: 'variable',
        tracksInventory: false,
        status: 'draft',
        brandId: retiredBrand.id,
      }),
    ).rejects.toMatchObject({ code: 'validation_error' });
  });

  it('enforces product type, activation, and optimistic version rules', async () => {
    const draft = await products.createProduct(context, 'draft-variable', {
      code: 'draft-variable',
      name: 'Draft variable',
      productType: 'variable',
      tracksInventory: false,
      status: 'draft',
    });
    await expect(
      products.patchProduct(context, draft.value.id, draft.value.version, { status: 'active' }),
    ).rejects.toMatchObject({ code: 'invalid_product_state' });
    const changed = await products.patchProduct(context, draft.value.id, draft.value.version, {
      name: 'Changed once',
    });
    expect(changed.version).toBe(draft.value.version + 1n);
    await expect(
      products.patchProduct(context, draft.value.id, draft.value.version, { name: 'Stale' }),
    ).rejects.toMatchObject({ code: 'version_conflict' });
    expect(() =>
      products.createProduct(context, 'service-tracking', {
        code: 'service-tracking',
        name: 'Service',
        productType: 'service',
        tracksInventory: true,
        status: 'draft',
        defaultVariant: {
          sku: 'service-tracking',
          unitOfMeasureCode: 'unit',
          quantityScale: 0,
          standardCost: '0',
          currencyCode: 'MXN',
        },
      }),
    ).toThrow();
  });

  it('creates, replays, updates, and logically retires variants while preserving invariants', async () => {
    const draft = await products.createProduct(context, 'variant-parent', {
      code: 'variant-parent',
      name: 'Variant Parent',
      productType: 'variable',
      tracksInventory: true,
      status: 'draft',
    });
    const request = {
      sku: 'variant-created',
      unitOfMeasureCode: 'kg',
      quantityScale: 3,
      tracksInventory: true,
      standardCost: '1.2500',
      currencyCode: 'MXN',
      isDefault: true,
      status: 'active' as const,
      optionValueIds: [] as [],
    };
    const created = await products.createVariant(
      context,
      draft.value.id,
      'variant-create',
      request,
    );
    const replay = await products.createVariant(context, draft.value.id, 'variant-create', request);
    expect(replay).toMatchObject({ replayed: true });
    expect(replay.value.id).toBe(created.value.id);
    const active = await products.patchProduct(context, draft.value.id, draft.value.version, {
      status: 'active',
    });
    expect(active.status).toBe('active');
    const updated = await products.patchVariant(context, created.value.id, created.value.version, {
      standardCost: '2.5000',
      name: 'Updated',
    });
    expect(updated.version).toBe(created.value.version + 1n);
    await expect(
      products.patchVariant(context, created.value.id, created.value.version, { name: 'Stale' }),
    ).rejects.toMatchObject({ code: 'version_conflict' });
    await expect(
      products.patchVariant(context, updated.id, updated.version, { status: 'retired' }),
    ).rejects.toMatchObject({ code: 'invalid_product_state' });
  });

  it('allows one concurrent SKU/default winner and maps the loser safely', async () => {
    const left = await products.createProduct(context, 'concurrency-left', {
      code: 'concurrency-left',
      name: 'Left',
      productType: 'variable',
      tracksInventory: false,
      status: 'draft',
    });
    const right = await products.createProduct(context, 'concurrency-right', {
      code: 'concurrency-right',
      name: 'Right',
      productType: 'variable',
      tracksInventory: false,
      status: 'draft',
    });
    const create = (
      productId: string,
      key: string,
    ): ReturnType<ProductCatalogService['createVariant']> =>
      products.createVariant(context, productId, key, {
        sku: 'concurrent-global-sku',
        unitOfMeasureCode: 'unit',
        quantityScale: 0,
        standardCost: '0',
        currencyCode: 'MXN',
        isDefault: true,
        status: 'active',
        optionValueIds: [],
      });
    const outcomes = await Promise.allSettled([
      create(left.value.id, 'concurrent-left'),
      create(right.value.id, 'concurrent-right'),
    ]);
    expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((item) => item.status === 'rejected');
    expect(rejected).toMatchObject({ reason: { code: 'duplicate_sku' } });
  });

  it('rolls back product, idempotency, audit, and outbox when audit insertion fails', async () => {
    await database.pool.query(`
      create function product_test_audit_failure() returns trigger language plpgsql as $$
      begin
        if new.action='product.created' and new.metadata->>'code'='forced-audit-failure' then
          raise exception 'forced audit failure';
        end if;
        return new;
      end $$`);
    await database.pool.query(`
      create trigger product_test_audit_failure before insert on audit_log
      for each row execute function product_test_audit_failure()`);
    await expect(
      products.createProduct(context, 'forced-audit-failure', {
        code: 'forced-audit-failure',
        name: 'Forced audit failure',
        productType: 'simple',
        tracksInventory: false,
        status: 'active',
        defaultVariant: {
          sku: 'forced-audit-failure',
          unitOfMeasureCode: 'unit',
          quantityScale: 0,
          standardCost: '0',
          currencyCode: 'MXN',
        },
      }),
    ).rejects.toThrow('forced audit failure');
    const counts = await database.pool.query<{ products: string; keys: string; events: string }>(
      `select
       (select count(*)::text from products where company_id=$1 and normalized_code='forced-audit-failure') products,
       (select count(*)::text from idempotency_keys where company_id=$1 and key='forced-audit-failure') keys,
       (select count(*)::text from outbox_events where company_id=$1 and payload->>'code'='forced-audit-failure') events`,
      [companyId],
    );
    expect(counts.rows[0]).toEqual({ products: '0', keys: '0', events: '0' });
    await database.pool.query('drop trigger product_test_audit_failure on audit_log');
    await database.pool.query('drop function product_test_audit_failure()');
  });
});
