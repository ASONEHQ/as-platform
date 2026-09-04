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
});
