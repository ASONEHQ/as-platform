import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';

import { ProductCatalogRepository } from './product-catalog.repository.js';
import { ProductCatalogService } from './product-catalog.service.js';
import { ProductOptionsService } from './product-options.service.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;

integration('PostgreSQL product options and barcodes', { concurrent: false }, () => {
  let database: DatabaseClient;
  let products: ProductCatalogService;
  let options: ProductOptionsService;
  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const userId = randomUUID();
  const context = {
    companyId,
    actorId: userId,
    requestId: 'options-request',
    correlationId: 'options-correlation',
    timestamp: new Date('2026-07-27T18:00:00.000Z'),
  };

  beforeAll(async () => {
    if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({
      connectionString: databaseUrl,
      applicationName: 'asone-options-integration',
    });
    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'Options','Options',$2,'active','UTC','MXN','es-MX'),
       ($3,'Other Options','Other Options',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `options-${companyId}`, otherCompanyId, `options-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'Options User','active')`,
      [userId, `options-${userId}@example.test`],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status)
       values($1,$2,$3,'active'),($4,$5,$3,'active')`,
      [randomUUID(), companyId, userId, randomUUID(), otherCompanyId],
    );
    const repository = new ProductCatalogRepository(database);
    products = new ProductCatalogService(repository);
    options = new ProductOptionsService(repository);
  });

  afterAll(async () => {
    for (const table of [
      'product_barcodes',
      'product_variant_option_values',
      'product_variants',
      'product_option_values',
      'product_option_definitions',
      'products',
      'outbox_events',
      'audit_log',
      'idempotency_keys',
    ])
      await database.pool.query(`delete from ${table} where company_id in ($1,$2)`, [
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

  it('creates normalized options and values idempotently with tenant isolation', async () => {
    const product = await draftVariable('options-product', context);
    const created = await options.createOption(context, product.id, 'color-option', {
      code: ' COLOR ',
      name: 'Color',
      displayOrder: 2,
    });
    const replay = await options.createOption(context, product.id, 'color-option', {
      code: ' COLOR ',
      name: 'Color',
      displayOrder: 2,
    });
    expect(replay).toMatchObject({ replayed: true });
    expect(replay.value.id).toBe(created.value.id);
    const red = await options.createValue(context, created.value.id, 'red-value', {
      code: ' RED ',
      name: 'Red',
    });
    expect((await options.listOptions(companyId, product.id, { limit: 10 })).items).toHaveLength(1);
    await expect(
      options.listValues(otherCompanyId, created.value.id, { limit: 10 }),
    ).rejects.toMatchObject({ code: 'resource_not_found' });
    await expect(
      options.createValue(context, created.value.id, 'red-value-conflict', {
        code: 'red',
        name: 'Duplicate',
      }),
    ).rejects.toMatchObject({ code: 'duplicate_option_value_code' });
    expect(red.value.code).toBe('RED');
  });

  it('rejects options on non-variable products and protects stale writes', async () => {
    const simple = await products.createProduct(context, 'simple-options', {
      code: 'simple-options',
      name: 'Simple',
      productType: 'simple',
      tracksInventory: false,
      status: 'draft',
      defaultVariant: {
        sku: 'simple-options',
        unitOfMeasureCode: 'unit',
        quantityScale: 0,
        standardCost: '0',
        currencyCode: 'MXN',
      },
    });
    await expect(
      options.createOption(context, simple.value.id, 'invalid-option', {
        code: 'size',
        name: 'Size',
      }),
    ).rejects.toMatchObject({ code: 'invalid_product_state' });
    const product = await draftVariable('version-options', context);
    const option = (
      await options.createOption(context, product.id, 'version-option', {
        code: 'size',
        name: 'Size',
      })
    ).value;
    const updated = await options.patchOption(context, option.id, option.version, {
      name: 'Updated',
    });
    expect(updated.version).toBe(option.version + 1n);
    await expect(
      options.patchOption(context, option.id, option.version, { name: 'Stale' }),
    ).rejects.toMatchObject({ code: 'version_conflict' });
  });

  it('derives canonical variant signatures independent of request order', async () => {
    const product = await draftVariable('signature-product', context);
    const color = (
      await options.createOption(context, product.id, 'signature-color', {
        code: 'color',
        name: 'Color',
      })
    ).value;
    const size = (
      await options.createOption(context, product.id, 'signature-size', {
        code: 'size',
        name: 'Size',
      })
    ).value;
    const red = (
      await options.createValue(context, color.id, 'signature-red', {
        code: 'red',
        name: 'Red',
      })
    ).value;
    const large = (
      await options.createValue(context, size.id, 'signature-large', {
        code: 'large',
        name: 'Large',
      })
    ).value;
    const first = await products.createVariant(context, product.id, 'composed-first', {
      sku: 'composed-first',
      unitOfMeasureCode: 'unit',
      quantityScale: 0,
      standardCost: '0',
      currencyCode: 'MXN',
      isDefault: true,
      status: 'active',
      optionValueIds: [large.id, red.id],
    });
    const signature = await database.pool.query<{ option_signature: string }>(
      'select option_signature from product_variants where id=$1',
      [first.value.id],
    );
    expect(signature.rows[0]?.option_signature).toHaveLength(64);
    await expect(
      products.createVariant(context, product.id, 'composed-duplicate', {
        sku: 'composed-second',
        unitOfMeasureCode: 'unit',
        quantityScale: 0,
        standardCost: '0',
        currencyCode: 'MXN',
        isDefault: false,
        status: 'active',
        optionValueIds: [red.id, large.id],
      }),
    ).rejects.toMatchObject({ code: 'option_combination_conflict' });
  });

  it('rejects duplicate selections, wrong-product values, and dependent retirement', async () => {
    const product = await draftVariable('dependency-product', context);
    const option = (
      await options.createOption(context, product.id, 'dependency-option', {
        code: 'color',
        name: 'Color',
      })
    ).value;
    const red = (
      await options.createValue(context, option.id, 'dependency-red', {
        code: 'red',
        name: 'Red',
      })
    ).value;
    const blue = (
      await options.createValue(context, option.id, 'dependency-blue', {
        code: 'blue',
        name: 'Blue',
      })
    ).value;
    await expect(
      products.createVariant(context, product.id, 'duplicate-selection', {
        sku: 'duplicate-selection',
        unitOfMeasureCode: 'unit',
        quantityScale: 0,
        standardCost: '0',
        currencyCode: 'MXN',
        isDefault: true,
        status: 'active',
        optionValueIds: [red.id, blue.id],
      }),
    ).rejects.toMatchObject({ code: 'duplicate_option_selection' });
    await products.createVariant(context, product.id, 'dependency-variant', {
      sku: 'dependency-variant',
      unitOfMeasureCode: 'unit',
      quantityScale: 0,
      standardCost: '0',
      currencyCode: 'MXN',
      isDefault: true,
      status: 'active',
      optionValueIds: [red.id],
    });
    await expect(
      options.patchValue(context, red.id, red.version, { status: 'retired' }),
    ).rejects.toMatchObject({ code: 'invalid_option_value_state' });
    await expect(
      options.patchOption(context, option.id, option.version, { status: 'retired' }),
    ).rejects.toMatchObject({ code: 'invalid_option_state' });
  });

  it('creates multiple barcodes, enforces primary uniqueness, and retires logically', async () => {
    const product = await draftVariable('barcode-product', context);
    const variant = await products.createVariant(context, product.id, 'barcode-variant', {
      sku: 'barcode-variant',
      unitOfMeasureCode: 'unit',
      quantityScale: 0,
      standardCost: '0',
      currencyCode: 'MXN',
      isDefault: true,
      status: 'active',
      optionValueIds: [],
    });
    const primary = await options.createBarcode(context, variant.value.id, 'primary-barcode', {
      barcode: 'PRIMARY-1',
      barcodeType: 'internal',
      isPrimary: true,
    });
    await options.createBarcode(context, variant.value.id, 'secondary-barcode', {
      barcode: 'SECONDARY-1',
      barcodeType: 'internal',
      isPrimary: false,
    });
    await expect(
      options.createBarcode(context, variant.value.id, 'other-primary', {
        barcode: 'PRIMARY-2',
        barcodeType: 'internal',
        isPrimary: true,
      }),
    ).rejects.toMatchObject({ code: 'invalid_variant_state' });
    const retired = await options.retireBarcode(context, primary.value.id, primary.value.version);
    expect(retired).toMatchObject({ status: 'retired', isPrimary: false });
    expect(retired.version).toBe(primary.value.version + 1n);
  });

  it('serializes concurrent duplicate combinations and primary barcodes', async () => {
    const product = await draftVariable('concurrent-options', context);
    const option = (
      await options.createOption(context, product.id, 'concurrent-option', {
        code: 'color',
        name: 'Color',
      })
    ).value;
    const red = (
      await options.createValue(context, option.id, 'concurrent-red', {
        code: 'red',
        name: 'Red',
      })
    ).value;
    const variantRequest = (
      sku: string,
      key: string,
    ): ReturnType<ProductCatalogService['createVariant']> =>
      products.createVariant(context, product.id, key, {
        sku,
        unitOfMeasureCode: 'unit',
        quantityScale: 0,
        standardCost: '0',
        currencyCode: 'MXN',
        isDefault: sku.endsWith('one'),
        status: 'active',
        optionValueIds: [red.id],
      });
    const variants = await Promise.allSettled([
      variantRequest('concurrent-one', 'concurrent-combination-one'),
      variantRequest('concurrent-two', 'concurrent-combination-two'),
    ]);
    expect(variants.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(variants.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'option_combination_conflict' },
    });
    const winner = variants.find((result) => result.status === 'fulfilled');
    if (winner?.status !== 'fulfilled') throw new Error('Expected one variant winner.');
    const barcodes = await Promise.allSettled([
      options.createBarcode(context, winner.value.value.id, 'concurrent-primary-one', {
        barcode: 'concurrent-primary-one',
        barcodeType: 'internal',
        isPrimary: true,
      }),
      options.createBarcode(context, winner.value.value.id, 'concurrent-primary-two', {
        barcode: 'concurrent-primary-two',
        barcodeType: 'internal',
        isPrimary: true,
      }),
    ]);
    expect(barcodes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(barcodes.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'invalid_variant_state' },
    });
  });

  async function draftVariable(
    code: string,
    mutationContext: typeof context,
  ): Promise<{ id: string }> {
    const result = await products.createProduct(mutationContext, `product-${code}`, {
      code,
      name: code,
      productType: 'variable',
      tracksInventory: false,
      status: 'draft',
    });
    return result.value;
  }
});
