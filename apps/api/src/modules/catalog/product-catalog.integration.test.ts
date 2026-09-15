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

// Narrows an optional value fetched from a query result/response into a
// definite one for later use as required test input — never a silent
// `!`, so a genuinely missing row fails the test with a clear message
// instead of an unexplained downstream type error.
function required<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new Error(`Expected ${what} to be present.`);
  return value;
}

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
    // TASK 12.3C: migration 0011 (product_prices + products.tax_code) is
    // applied separately from the 0000-0004 block above so a persisted test
    // database from a prior run (which already has `products` but predates
    // this migration) still picks it up instead of silently skipping it.
    const pricingPresent = await database.pool.query<{ present: string | null }>(
      `select to_regclass('public.product_prices')::text present`,
    );
    if (pricingPresent.rows[0]?.present === null) {
      const sql = await readFile(
        resolve(migrationsPath, '0011_product_pricing_foundation.sql'),
        'utf8',
      );
      for (const statement of sql.split('--> statement-breakpoint'))
        if (statement.trim().length > 0) await database.pool.query(statement);
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
    // TASK 12.3C: product_prices.product_id has an onDelete:'restrict' FK to
    // products, so price rows must be cleared before the products they
    // reference or this cleanup fails with a foreign-key violation.
    await database.pool.query('delete from product_prices where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from product_variants where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from products where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    // TASK 16.6: products.preferred_supplier_id is onDelete:'restrict' —
    // supplier rows created by the tests below must be cleared after the
    // products that may reference them, before the owning companies.
    await database.pool.query('delete from suppliers where company_id in ($1,$2)', [
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
    // TASK 12.3C: branches.company_id is onDelete:'restrict' — any branch
    // rows created by the pricing tests below must be cleared before the
    // owning companies or this cleanup fails with a foreign-key violation.
    await database.pool.query('delete from branches where company_id in ($1,$2)', [
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

  it('round-trips tax_code through product creation and patch', async () => {
    const exempt = await products.createProduct(context, 'tax-code-exempt', {
      code: 'tax-code-exempt',
      name: 'Tax exempt product',
      productType: 'simple',
      tracksInventory: false,
      status: 'active',
      taxCode: 'IVA_EXEMPT',
      defaultVariant: {
        sku: 'tax-code-exempt',
        unitOfMeasureCode: 'unit',
        quantityScale: 0,
        standardCost: '0',
        currencyCode: 'MXN',
      },
    });
    expect(exempt.value.taxCode).toBe('IVA_EXEMPT');
    const defaulted = await products.createProduct(context, 'tax-code-default', {
      code: 'tax-code-default',
      name: 'Tax default product',
      productType: 'simple',
      tracksInventory: false,
      status: 'active',
      defaultVariant: {
        sku: 'tax-code-default',
        unitOfMeasureCode: 'unit',
        quantityScale: 0,
        standardCost: '0',
        currencyCode: 'MXN',
      },
    });
    expect(defaulted.value.taxCode).toBe('IVA_GENERAL');
    const patched = await products.patchProduct(
      context,
      defaulted.value.id,
      defaulted.value.version,
      { taxCode: 'IVA_EXEMPT' },
    );
    expect(patched.taxCode).toBe('IVA_EXEMPT');
    const reloaded = await products.product(companyId, defaulted.value.id);
    expect(reloaded.taxCode).toBe('IVA_EXEMPT');
  });

  it('creates a company-wide price idempotently as decimal strings and exposes it as effectivePrice', async () => {
    const product = await products.createProduct(context, 'price-company-wide', {
      code: 'price-company-wide',
      name: 'Priced product',
      productType: 'simple',
      tracksInventory: false,
      status: 'active',
      defaultVariant: {
        sku: 'price-company-wide',
        unitOfMeasureCode: 'unit',
        quantityScale: 0,
        standardCost: '0',
        currencyCode: 'MXN',
      },
    });
    const beforePrice = await products.product(companyId, product.value.id);
    expect(beforePrice.effectivePrice).toBeNull();
    const request = { amount: '129.5', currencyCode: 'mxn' };
    const created = await products.createProductPrice(
      context,
      product.value.id,
      'price-company-wide-key',
      request,
    );
    expect(created.replayed).toBe(false);
    expect(created.value).toMatchObject({
      productId: product.value.id,
      branchId: null,
      priceType: 'standard',
      amount: '129.5000',
      currencyCode: 'MXN',
      status: 'active',
    });
    const replay = await products.createProductPrice(
      context,
      product.value.id,
      'price-company-wide-key',
      request,
    );
    expect(replay).toMatchObject({ replayed: true });
    expect(replay.value.id).toBe(created.value.id);
    const afterPrice = await products.product(companyId, product.value.id);
    expect(afterPrice.effectivePrice).toMatchObject({
      amount: '129.5000',
      currencyCode: 'MXN',
      branchId: null,
    });
    const listed = await products.listProducts(companyId, {
      limit: 20,
      search: 'price-company-wide',
    });
    expect(listed.items[0]?.effectivePrice).toMatchObject({ amount: '129.5000' });
  });

  it('distinguishes a genuinely free price from no price at all', async () => {
    const product = await products.createProduct(context, 'price-free', {
      code: 'price-free',
      name: 'Free product',
      productType: 'simple',
      tracksInventory: false,
      status: 'active',
      defaultVariant: {
        sku: 'price-free',
        unitOfMeasureCode: 'unit',
        quantityScale: 0,
        standardCost: '0',
        currencyCode: 'MXN',
      },
    });
    const beforePrice = await products.product(companyId, product.value.id);
    expect(beforePrice.effectivePrice).toBeNull();
    await products.createProductPrice(context, product.value.id, 'price-free-key', {
      amount: '0',
      currencyCode: 'MXN',
    });
    const afterPrice = await products.product(companyId, product.value.id);
    expect(afterPrice.effectivePrice?.amount).toBe('0.0000');
    expect(afterPrice.effectivePrice).not.toBeNull();
  });

  it('rejects a duplicate open-ended active price for the same product and scope', async () => {
    const product = await products.createProduct(context, 'price-conflict-product', {
      code: 'price-conflict',
      name: 'Conflict product',
      productType: 'simple',
      tracksInventory: false,
      status: 'active',
      defaultVariant: {
        sku: 'price-conflict',
        unitOfMeasureCode: 'unit',
        quantityScale: 0,
        standardCost: '0',
        currencyCode: 'MXN',
      },
    });
    await products.createProductPrice(context, product.value.id, 'price-conflict-first', {
      amount: '10.00',
      currencyCode: 'MXN',
    });
    await expect(
      products.createProductPrice(context, product.value.id, 'price-conflict-second', {
        amount: '11.00',
        currencyCode: 'MXN',
      }),
    ).rejects.toMatchObject({ code: 'price_conflict' });
  });

  it('resolves a branch-specific price override ahead of the company-wide default', async () => {
    const branchId = randomUUID();
    const otherBranchId = randomUUID();
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'Override Branch','override-branch','active','UTC'),
             ($3,$2,'Other Branch','other-branch','active','UTC')`,
      [branchId, companyId, otherBranchId],
    );
    const product = await products.createProduct(context, 'price-branch-override', {
      code: 'price-branch-override',
      name: 'Branch override product',
      productType: 'simple',
      tracksInventory: false,
      status: 'active',
      defaultVariant: {
        sku: 'price-branch-override',
        unitOfMeasureCode: 'unit',
        quantityScale: 0,
        standardCost: '0',
        currencyCode: 'MXN',
      },
    });
    await products.createProductPrice(context, product.value.id, 'price-branch-default', {
      amount: '10.00',
      currencyCode: 'MXN',
    });
    await products.createProductPrice(context, product.value.id, 'price-branch-specific', {
      branchId,
      amount: '8.00',
      currencyCode: 'MXN',
    });
    const withoutBranch = await products.product(companyId, product.value.id);
    expect(withoutBranch.effectivePrice).toMatchObject({ amount: '10.0000', branchId: null });
    const withOverride = await products.product(companyId, product.value.id, branchId);
    expect(withOverride.effectivePrice).toMatchObject({ amount: '8.0000', branchId });
    const withOtherBranch = await products.product(companyId, product.value.id, otherBranchId);
    expect(withOtherBranch.effectivePrice).toMatchObject({ amount: '10.0000', branchId: null });
    const listedWithOverride = await products.listProducts(companyId, {
      limit: 20,
      search: 'price-branch-override',
      branchId,
    });
    expect(listedWithOverride.items[0]?.effectivePrice).toMatchObject({
      amount: '8.0000',
      branchId,
    });
  });

  it('rejects a price scoped to a cross-tenant or closed branch', async () => {
    const foreignBranchId = randomUUID();
    const closedBranchId = randomUUID();
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'Foreign Branch','foreign-branch','active','UTC')`,
      [foreignBranchId, otherCompanyId],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'Closed Branch','closed-branch','closed','UTC')`,
      [closedBranchId, companyId],
    );
    const product = await products.createProduct(context, 'price-branch-invalid', {
      code: 'price-branch-invalid',
      name: 'Branch invalid product',
      productType: 'simple',
      tracksInventory: false,
      status: 'active',
      defaultVariant: {
        sku: 'price-branch-invalid',
        unitOfMeasureCode: 'unit',
        quantityScale: 0,
        standardCost: '0',
        currencyCode: 'MXN',
      },
    });
    await expect(
      products.createProductPrice(context, product.value.id, 'price-branch-foreign', {
        branchId: foreignBranchId,
        amount: '5.00',
        currencyCode: 'MXN',
      }),
    ).rejects.toMatchObject({ code: 'validation_error' });
    await expect(
      products.createProductPrice(context, product.value.id, 'price-branch-closed', {
        branchId: closedBranchId,
        amount: '5.00',
        currencyCode: 'MXN',
      }),
    ).rejects.toMatchObject({ code: 'validation_error' });
  });

  // TASK 14.5 (Wave 3, Phase 7, Item 1) — real CSV export of the live
  // catalog: proves the export contains genuine per-tenant rows (category/
  // brand/default-variant columns correctly joined), respects the same
  // `search` filter `listProducts` accepts, and never leaks another
  // tenant's products.
  it('exports the live catalog as a real, tenant-scoped, filterable CSV', async () => {
    const categoryResult = await catalog.createCategory(context, 'export-category', {
      code: 'export-cat',
      name: 'Export Category',
    });
    const brandResult = await catalog.createBrand(context, 'export-brand', {
      code: 'export-brand',
      name: 'Export Brand',
    });
    const exported = await products.createProduct(context, 'export-product', {
      code: 'export-widget',
      name: 'Export Widget',
      productType: 'simple',
      tracksInventory: true,
      status: 'active',
      categoryId: categoryResult.value.id,
      brandId: brandResult.value.id,
      defaultVariant: {
        sku: 'export-widget-sku',
        unitOfMeasureCode: 'unit',
        quantityScale: 0,
        standardCost: '12.5000',
        currencyCode: 'MXN',
      },
    });
    const otherTenantProduct = await products.createProduct(otherContext, 'export-other', {
      code: 'export-other-widget',
      name: 'Other Tenant Widget',
      productType: 'simple',
      tracksInventory: false,
      status: 'active',
      defaultVariant: {
        sku: 'export-other-sku',
        unitOfMeasureCode: 'unit',
        quantityScale: 0,
        standardCost: '0',
        currencyCode: 'MXN',
      },
    });
    const unrelated = await products.createProduct(context, 'export-unrelated', {
      code: 'unrelated-item',
      name: 'Unrelated Item',
      productType: 'simple',
      tracksInventory: false,
      status: 'active',
      defaultVariant: {
        sku: 'unrelated-sku',
        unitOfMeasureCode: 'unit',
        quantityScale: 0,
        standardCost: '0',
        currencyCode: 'MXN',
      },
    });

    const fullCsv = await products.exportCsv(companyId, {});
    const fullLines = fullCsv.trim().split('\r\n');
    expect(fullLines[0]).toBe(
      'id,code,name,product_type,tracks_inventory,tax_code,status,category_id,category_name,brand_id,brand_name,default_sku,default_cost,default_currency_code,created_at,updated_at',
    );
    expect(fullCsv).toContain(exported.value.id);
    expect(fullCsv).toContain('Export Widget');
    expect(fullCsv).toContain('Export Category');
    expect(fullCsv).toContain('Export Brand');
    expect(fullCsv).toContain('export-widget-sku');
    expect(fullCsv).toContain('12.5000');
    expect(fullCsv).toContain(unrelated.value.id);
    // Never another tenant's rows, even in an unfiltered export.
    expect(fullCsv).not.toContain(otherTenantProduct.value.id);

    const filteredCsv = await products.exportCsv(companyId, { search: 'Export Widget' });
    expect(filteredCsv).toContain(exported.value.id);
    expect(filteredCsv).not.toContain(unrelated.value.id);
  });

  // TASK 16.6 (Productos/Catálogo legacy parity) — round-trips every new
  // Extras-tab field (image/icon/card-appearance/featured/supplier/
  // min-stock) through create, patch, and a fresh reload from Postgres —
  // proving these are real persisted columns, not merely accepted input.
  it('round-trips image, icon, card appearance, featured, supplier, and min_stock through create and patch', async () => {
    const supplier = await database.pool.query<{ id: string }>(
      `insert into suppliers(id,company_id,name,status,created_by,updated_by)
       values($1,$2,'Real Supplier','active',$3,$3) returning id`,
      [randomUUID(), companyId, userId],
    );
    const supplierId = required(supplier.rows[0]?.id, 'inserted supplier id');

    const created = await products.createProduct(context, 'extras-round-trip', {
      code: 'extras-round-trip',
      name: 'Extras round trip',
      productType: 'simple',
      tracksInventory: false,
      status: 'active',
      imageUrl: 'https://cdn.example.test/products/extras.png',
      iconKey: 'pizza',
      cardStyle: 'solid',
      cardColorHex: '#6b3fa0',
      isFeatured: true,
      preferredSupplierId: supplierId,
      defaultVariant: {
        sku: 'extras-round-trip',
        unitOfMeasureCode: 'unit',
        quantityScale: 0,
        standardCost: '0',
        currencyCode: 'MXN',
        minStock: '3.5',
      },
    });
    expect(created.value).toMatchObject({
      imageUrl: 'https://cdn.example.test/products/extras.png',
      iconKey: 'pizza',
      cardStyle: 'solid',
      cardColorHex: '#6B3FA0',
      isFeatured: true,
      preferredSupplierId: supplierId,
    });
    expect(created.value.defaultVariant).toMatchObject({ minStock: '3.500000' });

    const reloaded = await products.product(companyId, created.value.id);
    expect(reloaded).toMatchObject({
      imageUrl: 'https://cdn.example.test/products/extras.png',
      iconKey: 'pizza',
      cardStyle: 'solid',
      cardColorHex: '#6B3FA0',
      isFeatured: true,
      preferredSupplierId: supplierId,
    });

    const patched = await products.patchProduct(context, created.value.id, created.value.version, {
      cardStyle: 'default',
      cardColorHex: null,
      isFeatured: false,
      imageUrl: null,
      iconKey: null,
      preferredSupplierId: null,
    });
    expect(patched).toMatchObject({
      cardStyle: 'default',
      cardColorHex: null,
      isFeatured: false,
      imageUrl: null,
      iconKey: null,
      preferredSupplierId: null,
    });

    const defaultVariant = required(created.value.defaultVariant, 'created default variant');
    const variant = await products.patchVariant(
      context,
      defaultVariant.id,
      defaultVariant.version,
      { minStock: '10' },
    );
    expect(variant.minStock).toBe('10.000000');
    const clearedVariant = await products.patchVariant(context, variant.id, variant.version, {
      minStock: null,
    });
    expect(clearedVariant.minStock).toBeNull();
  });

  it('rejects a cross-tenant or inactive preferred_supplier_id', async () => {
    const foreignSupplier = await database.pool.query<{ id: string }>(
      `insert into suppliers(id,company_id,name,status,created_by,updated_by)
       values($1,$2,'Foreign Supplier','active',$3,$3) returning id`,
      [randomUUID(), otherCompanyId, userId],
    );
    const inactiveSupplier = await database.pool.query<{ id: string }>(
      `insert into suppliers(id,company_id,name,status,created_by,updated_by)
       values($1,$2,'Inactive Supplier','inactive',$3,$3) returning id`,
      [randomUUID(), companyId, userId],
    );
    await expect(
      products.createProduct(context, 'cross-tenant-supplier', {
        code: 'cross-tenant-supplier',
        name: 'Cross tenant supplier',
        productType: 'variable',
        tracksInventory: false,
        status: 'draft',
        preferredSupplierId: required(foreignSupplier.rows[0]?.id, 'foreign supplier id'),
      }),
    ).rejects.toMatchObject({ code: 'validation_error' });
    await expect(
      products.createProduct(context, 'inactive-supplier', {
        code: 'inactive-supplier',
        name: 'Inactive supplier',
        productType: 'variable',
        tracksInventory: false,
        status: 'draft',
        preferredSupplierId: required(inactiveSupplier.rows[0]?.id, 'inactive supplier id'),
      }),
    ).rejects.toMatchObject({ code: 'validation_error' });
  });

  // TASK 16.6 — "Duplicar" (`AS POS V1.html:1202,6279-6290`): a real
  // server-side clone with a guaranteed-unique code/sku and every other
  // real field copied, always landing in `draft`.
  it('duplicates a product into a new draft with a unique code/sku and copies its real fields', async () => {
    const source = await products.createProduct(context, 'duplicate-source', {
      code: 'duplicate-source',
      name: 'Duplicate source',
      productType: 'simple',
      tracksInventory: false,
      status: 'active',
      imageUrl: 'https://cdn.example.test/products/source.png',
      iconKey: 'gift',
      cardStyle: 'gradient',
      cardColorHex: '#123ABC',
      isFeatured: true,
      defaultVariant: {
        sku: 'duplicate-source-sku',
        unitOfMeasureCode: 'unit',
        quantityScale: 0,
        standardCost: '9.99',
        currencyCode: 'MXN',
        minStock: '2',
      },
    });
    const duplicate = await products.duplicateProduct(context, source.value.id);
    expect(duplicate.value.id).not.toBe(source.value.id);
    expect(duplicate.value.code).not.toBe(source.value.code);
    expect(duplicate.value.status).toBe('draft');
    expect(duplicate.value).toMatchObject({
      name: 'Duplicate source (copia)',
      imageUrl: 'https://cdn.example.test/products/source.png',
      iconKey: 'gift',
      cardStyle: 'gradient',
      cardColorHex: '#123ABC',
      isFeatured: true,
    });
    expect(duplicate.value.defaultVariant).toMatchObject({ standardCost: '9.9900' });
    expect(duplicate.value.defaultVariant?.sku).not.toBe(source.value.defaultVariant?.sku);

    const secondDuplicate = await products.duplicateProduct(context, source.value.id);
    expect(secondDuplicate.value.id).not.toBe(duplicate.value.id);
    expect(secondDuplicate.value.code).not.toBe(duplicate.value.code);

    await expect(products.duplicateProduct(context, randomUUID())).rejects.toMatchObject({
      code: 'resource_not_found',
    });
  });

  // TASK 16.6C — the real "cambiar precio" operation: closes whatever
  // price is currently active for a scope and opens the new one,
  // atomically, preserving the old row as real history. `context.timestamp`
  // is a single fixed value shared by every test in this file — a real
  // second, strictly-later context is used for the "change" step in each
  // test below (mirroring two genuinely separate HTTP requests, which
  // always have advancing wall-clock timestamps in production; this file's
  // own shared, fixed `context.timestamp` is a testing convenience that
  // would otherwise collide with `product_prices_valid_interval_ck`, since
  // a price's own `valid_from` is set from that same fixed instant).
  describe('TASK 16.6C — changing an existing product price atomically', () => {
    const laterContext = { ...context, timestamp: new Date(context.timestamp.getTime() + 60_000) };
    const evenLaterContext = {
      ...context,
      timestamp: new Date(context.timestamp.getTime() + 120_000),
    };

    async function priceChangeProduct(code: string) {
      return products.createProduct(context, code, {
        code,
        name: code,
        productType: 'simple',
        tracksInventory: false,
        status: 'active',
        defaultVariant: {
          sku: code,
          unitOfMeasureCode: 'unit',
          quantityScale: 0,
          standardCost: '0',
          currencyCode: 'MXN',
        },
      });
    }

    it('changes $250 to $260 atomically: exactly one active price after, the $250 row preserved as real history', async () => {
      const product = await priceChangeProduct('price-change-basic');
      const initial = await products.createProductPrice(context, product.value.id, 'price-change-basic-initial', {
        amount: '250.00',
        currencyCode: 'MXN',
      });
      const changed = await products.changeProductPrice(
        laterContext,
        product.value.id,
        'price-change-basic-change',
        { amount: '260.00', currencyCode: 'MXN' },
      );
      expect(changed.replayed).toBe(false);
      expect(changed.value).toMatchObject({ amount: '260.0000', status: 'active', validUntil: null });
      expect(changed.value.id).not.toBe(initial.value.id);

      // Exactly one currently-effective price.
      const read = await products.product(companyId, product.value.id);
      expect(read.effectivePrice).toMatchObject({ amount: '260.0000' });

      // Real history: the $250 row still exists, now closed, never deleted.
      const rows = await database.pool.query<{ id: string; amount: string; status: string; valid_until: Date | null }>(
        `select id,amount,status,valid_until from product_prices
         where company_id=$1 and product_id=$2 order by valid_from asc`,
        [companyId, product.value.id],
      );
      expect(rows.rows).toHaveLength(2);
      expect(rows.rows[0]).toMatchObject({ id: initial.value.id, amount: '250.0000', status: 'expired' });
      expect(rows.rows[0]?.valid_until).not.toBeNull();
      expect(rows.rows[1]).toMatchObject({ id: changed.value.id, amount: '260.0000', status: 'active' });
      expect(rows.rows[1]?.valid_until).toBeNull();

      // Idempotent replay of the SAME change request returns the same result.
      const replay = await products.changeProductPrice(
        laterContext,
        product.value.id,
        'price-change-basic-change',
        { amount: '260.00', currencyCode: 'MXN' },
      );
      expect(replay).toMatchObject({ replayed: true });
      expect(replay.value.id).toBe(changed.value.id);
    });

    it('the first price for a product (no active price yet) behaves exactly like createProductPrice', async () => {
      const product = await priceChangeProduct('price-change-first-ever');
      const changed = await products.changeProductPrice(context, product.value.id, 'price-change-first-key', {
        amount: '99.00',
        currencyCode: 'MXN',
      });
      expect(changed.value).toMatchObject({ amount: '99.0000', status: 'active' });
      const read = await products.product(companyId, product.value.id);
      expect(read.effectivePrice).toMatchObject({ amount: '99.0000' });
    });

    it('a same-amount "change" is a genuine no-op — no new history row, same price id returned', async () => {
      const product = await priceChangeProduct('price-change-same-amount');
      const initial = await products.createProductPrice(context, product.value.id, 'price-change-same-initial', {
        amount: '150.00',
        currencyCode: 'MXN',
      });
      const sameAgain = await products.changeProductPrice(
        laterContext,
        product.value.id,
        'price-change-same-again',
        { amount: '150.00', currencyCode: 'MXN' },
      );
      expect(sameAgain.value.id).toBe(initial.value.id);
      const rows = await database.pool.query<{ id: string }>(
        `select id from product_prices where company_id=$1 and product_id=$2`,
        [companyId, product.value.id],
      );
      expect(rows.rows).toHaveLength(1);
    });

    it('rejects an invalid (negative) price and leaves the currently active price genuinely untouched', async () => {
      const product = await priceChangeProduct('price-change-invalid');
      await products.createProductPrice(context, product.value.id, 'price-change-invalid-initial', {
        amount: '80.00',
        currencyCode: 'MXN',
      });
      // `priceAmount()` normalizes/validates BEFORE the transaction opens
      // (matching `createProductPrice`'s own established, pre-existing
      // pattern), so an invalid amount throws synchronously rather than as
      // a promise rejection — caught explicitly here rather than via
      // `.rejects`, which only wraps an already-pending promise.
      let caught: unknown;
      try {
        await products.changeProductPrice(laterContext, product.value.id, 'price-change-invalid-attempt', {
          amount: '-5.00',
          currencyCode: 'MXN',
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({ code: 'validation_error' });
      const read = await products.product(companyId, product.value.id);
      expect(read.effectivePrice).toMatchObject({ amount: '80.0000' });
      const rows = await database.pool.query<{ id: string }>(
        `select id from product_prices where company_id=$1 and product_id=$2`,
        [companyId, product.value.id],
      );
      expect(rows.rows).toHaveLength(1);
    });

    it('rejects changing the price of a product that belongs to another company (never leaks cross-tenant)', async () => {
      const product = await priceChangeProduct('price-change-cross-tenant');
      await products.createProductPrice(context, product.value.id, 'price-change-cross-tenant-initial', {
        amount: '75.00',
        currencyCode: 'MXN',
      });
      await expect(
        products.changeProductPrice(otherContext, product.value.id, 'price-change-cross-tenant-attempt', {
          amount: '90.00',
          currencyCode: 'MXN',
        }),
      ).rejects.toMatchObject({ code: 'resource_not_found' });
      const read = await products.product(companyId, product.value.id);
      expect(read.effectivePrice).toMatchObject({ amount: '75.0000' });
    });

    it('concurrent price-change requests for the same product serialize — never leaves zero or two active prices', async () => {
      const product = await priceChangeProduct('price-change-concurrent');
      await products.createProductPrice(context, product.value.id, 'price-change-concurrent-initial', {
        amount: '100.00',
        currencyCode: 'MXN',
      });
      const [first, second] = await Promise.all([
        products.changeProductPrice(laterContext, product.value.id, 'price-change-concurrent-a', {
          amount: '110.00',
          currencyCode: 'MXN',
        }),
        products.changeProductPrice(evenLaterContext, product.value.id, 'price-change-concurrent-b', {
          amount: '120.00',
          currencyCode: 'MXN',
        }),
      ]);
      // Both requests genuinely succeeded (the product row lock serializes
      // them — the second one only proceeds once the first has committed —
      // never a `price_conflict`, never a corrupted state).
      expect(['110.0000', '120.0000']).toContain(first.value.amount);
      expect(['110.0000', '120.0000']).toContain(second.value.amount);
      const activeRows = await database.pool.query<{ id: string; amount: string }>(
        `select id,amount from product_prices
         where company_id=$1 and product_id=$2 and status='active' and valid_until is null`,
        [companyId, product.value.id],
      );
      expect(activeRows.rows).toHaveLength(1);
      const allRows = await database.pool.query<{ id: string }>(
        `select id from product_prices where company_id=$1 and product_id=$2`,
        [companyId, product.value.id],
      );
      // The original $100 plus both of the two changes = 3 real rows,
      // exactly one of them active — a genuine serialized chain, never a
      // lost update and never a duplicate.
      expect(allRows.rows).toHaveLength(3);
    });

    it('a failure between closing the old price and inserting the new one rolls back both — never leaves zero active prices', async () => {
      const product = await priceChangeProduct('price-change-rollback');
      const initial = await products.createProductPrice(
        context,
        product.value.id,
        'price-change-rollback-initial',
        { amount: '250.00', currencyCode: 'MXN' },
      );
      const repository = new ProductCatalogRepository(database);
      await expect(
        repository.transaction(async (client) => {
          await repository.lockProduct(client, companyId, product.value.id);
          const active = await repository.lockActivePriceForScope(
            client,
            companyId,
            product.value.id,
            'standard',
            'MXN',
            null,
          );
          await repository.closeProductPrice(client, {
            ...laterContext,
            id: required(active, 'active price to close').id,
          });
          // Deliberately violates `product_prices_amount_ck` (amount >= 0)
          // — a genuine database-level failure occurring AFTER the close
          // already ran inside this same transaction.
          await repository.insertProductPrice(client, {
            ...laterContext,
            id: randomUUID(),
            productId: product.value.id,
            branchId: null,
            priceType: 'standard',
            amount: '-1.0000',
            currencyCode: 'MXN',
            validFrom: laterContext.timestamp,
            validUntil: null,
          });
        }),
      ).rejects.toThrow();
      // The whole transaction rolled back — the original $250 price is
      // still active, exactly as if the failed attempt never happened.
      const read = await products.product(companyId, product.value.id);
      expect(read.effectivePrice).toMatchObject({ amount: '250.0000' });
      const rows = await database.pool.query<{ id: string; status: string }>(
        `select id,status from product_prices where company_id=$1 and product_id=$2`,
        [companyId, product.value.id],
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]).toMatchObject({ id: initial.value.id, status: 'active' });
    });

    // Legacy "Precios especiales" / this platform's own real branch price
    // overrides — TASK 16.6C's own explicit requirement: changing the
    // BASE (company-wide) price must never destroy or be confused with an
    // existing branch-specific override.
    it('changing the base (company-wide) price never destroys an existing branch override — the override keeps its own price, other branches see the new base', async () => {
      const overrideBranchId = randomUUID();
      const otherBranchId = randomUUID();
      await database.pool.query(
        `insert into branches(id,company_id,name,code,status,timezone)
         values($1,$2,'Override Branch','price-change-override-branch','active','UTC'),
               ($3,$2,'Other Branch','price-change-other-branch','active','UTC')`,
        [overrideBranchId, companyId, otherBranchId],
      );
      const product = await priceChangeProduct('price-change-branch-override');
      await products.createProductPrice(context, product.value.id, 'price-change-branch-base', {
        amount: '250.00',
        currencyCode: 'MXN',
      });
      await products.createProductPrice(context, product.value.id, 'price-change-branch-override', {
        branchId: overrideBranchId,
        amount: '230.00',
        currencyCode: 'MXN',
      });
      const changed = await products.changeProductPrice(
        laterContext,
        product.value.id,
        'price-change-branch-base-change',
        { amount: '260.00', currencyCode: 'MXN' },
      );
      expect(changed.value).toMatchObject({ branchId: null, amount: '260.0000' });

      const withOverride = await products.product(companyId, product.value.id, overrideBranchId);
      expect(withOverride.effectivePrice).toMatchObject({ amount: '230.0000', branchId: overrideBranchId });

      const withOtherBranch = await products.product(companyId, product.value.id, otherBranchId);
      expect(withOtherBranch.effectivePrice).toMatchObject({ amount: '260.0000', branchId: null });

      const withoutBranch = await products.product(companyId, product.value.id);
      expect(withoutBranch.effectivePrice).toMatchObject({ amount: '260.0000', branchId: null });

      // The override row itself was never touched by the base price change.
      const overrideRows = await database.pool.query<{ status: string; amount: string }>(
        `select status,amount from product_prices where company_id=$1 and product_id=$2 and branch_id=$3`,
        [companyId, product.value.id, overrideBranchId],
      );
      expect(overrideRows.rows).toHaveLength(1);
      expect(overrideRows.rows[0]).toMatchObject({ status: 'active', amount: '230.0000' });
    });
  });
});
