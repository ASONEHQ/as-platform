import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '../client.js';
import { seedTechnicalPermissions } from '../seeds/technical-permissions.js';
import { assertCategoryParentIsAcyclic } from './category-cycle.js';
import { generateOptionSignature } from './option-signature.js';
import { validateProductVariantState } from './product-state.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const integrationDatabaseUrl = databaseUrl ?? 'postgresql://catalog-integration-test-disabled';
const integration = databaseUrl === undefined ? describe.skip : describe;
const emptySignature = generateOptionSignature([]);

interface TenantFixture {
  readonly companyId: string;
  readonly userId: string;
}

integration('catalog PostgreSQL foundation', () => {
  let client: DatabaseClient;

  beforeAll(async () => {
    if (!new URL(integrationDatabaseUrl).pathname.toLowerCase().includes('test')) {
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    }
    client = createDatabaseClient({
      connectionString: integrationDatabaseUrl,
      applicationName: 'asone-catalog-test',
    });
    await migrate(client.db, { migrationsFolder: resolve(import.meta.dirname, '../../drizzle') });
    await seedTechnicalPermissions(client.db);
  });

  afterAll(async () => {
    await client.close();
  });

  it('creates exactly the approved technical units and permission', async () => {
    const units = await client.pool.query<{
      code: string;
      conversion_factor_to_base: string;
      dimension: string;
      quantity_scale: number;
    }>(
      `select code, dimension, quantity_scale, conversion_factor_to_base::text
       from units_of_measure order by code`,
    );
    expect(units.rows).toEqual([
      {
        code: 'g',
        dimension: 'mass',
        quantity_scale: 3,
        conversion_factor_to_base: '0.001000',
      },
      {
        code: 'kg',
        dimension: 'mass',
        quantity_scale: 6,
        conversion_factor_to_base: '1.000000',
      },
      {
        code: 'l',
        dimension: 'volume',
        quantity_scale: 6,
        conversion_factor_to_base: '1.000000',
      },
      {
        code: 'ml',
        dimension: 'volume',
        quantity_scale: 3,
        conversion_factor_to_base: '0.001000',
      },
      {
        code: 'unit',
        dimension: 'count',
        quantity_scale: 0,
        conversion_factor_to_base: '1.000000',
      },
    ]);
    const permissions = await client.pool.query<{ count: string }>(
      `select count(*)::text as count
       from permissions
       where code in ('inventory.cost.read', 'inventory.reservation.manage')`,
    );
    expect(permissions.rows[0]?.count).toBe('2');
    const permissionCount = await client.pool.query<{ count: string }>(
      'select count(*)::text as count from permissions',
    );
    expect(permissionCount.rows[0]?.count).toBe('55');
  });

  it('rejects cross-company category, product, option, variant, and barcode references', async () => {
    await withRollback(client, async (connection) => {
      const first = await insertTenant(connection, 'tenant-first');
      const second = await insertTenant(connection, 'tenant-second');
      const firstCategory = await insertCategory(connection, first, 'first-category');
      const secondCategory = await insertCategory(connection, second, 'second-category');
      const secondBrand = await insertBrand(connection, second, 'second-brand');

      await expectDatabaseError(
        connection,
        () =>
          insertCategory(connection, first, 'cross-parent', {
            parentId: secondCategory,
          }),
        '23503',
      );
      await expectDatabaseError(
        connection,
        () =>
          insertProduct(connection, first, 'cross-category', {
            categoryId: secondCategory,
          }),
        '23503',
      );
      await expectDatabaseError(
        connection,
        () => insertProduct(connection, first, 'cross-brand', { brandId: secondBrand }),
        '23503',
      );

      const firstProduct = await insertProduct(connection, first, 'first-product', {
        categoryId: firstCategory,
      });
      const secondProduct = await insertProduct(connection, second, 'second-product');
      const secondDefinition = await insertOptionDefinition(
        connection,
        second,
        secondProduct,
        'size',
      );
      await expectDatabaseError(
        connection,
        () => insertOptionValue(connection, first, firstProduct, secondDefinition, 'cross-option'),
        '23503',
      );
      await expectDatabaseError(
        connection,
        () => insertVariant(connection, first, secondProduct, 'cross-variant'),
        '23503',
      );

      const secondVariant = await insertVariant(
        connection,
        second,
        secondProduct,
        'second-variant',
      );
      await expectDatabaseError(
        connection,
        () => insertBarcode(connection, first, secondVariant, 'internal', 'cross-barcode'),
        '23503',
      );
    });
  });

  it('enforces normalized category, brand, product, option, and option-value uniqueness', async () => {
    await withRollback(client, async (connection) => {
      const tenant = await insertTenant(connection, 'catalog-unique');
      const other = await insertTenant(connection, 'catalog-other');
      await insertCategory(connection, tenant, 'category');
      await expectDatabaseError(
        connection,
        () => insertCategory(connection, tenant, 'category'),
        '23505',
      );
      await expect(insertCategory(connection, other, 'category')).resolves.toBeTypeOf('string');

      await insertBrand(connection, tenant, 'brand');
      await expectDatabaseError(
        connection,
        () => insertBrand(connection, tenant, 'brand'),
        '23505',
      );

      const productId = await insertProduct(connection, tenant, 'product');
      await expectDatabaseError(
        connection,
        () => insertProduct(connection, tenant, 'product'),
        '23505',
      );
      const definitionId = await insertOptionDefinition(connection, tenant, productId, 'size');
      await expectDatabaseError(
        connection,
        () => insertOptionDefinition(connection, tenant, productId, 'size'),
        '23505',
      );
      await insertOptionValue(connection, tenant, productId, definitionId, 'large');
      await expectDatabaseError(
        connection,
        () => insertOptionValue(connection, tenant, productId, definitionId, 'large'),
        '23505',
      );
    });
  });

  it('enforces SKU, default, signature, barcode, and primary uniqueness', async () => {
    await withRollback(client, async (connection) => {
      const tenant = await insertTenant(connection, 'variant-unique');
      const other = await insertTenant(connection, 'variant-other');
      const productId = await insertProduct(connection, tenant, 'variant-product');
      const otherProductId = await insertProduct(connection, other, 'variant-product');
      const variantId = await insertVariant(connection, tenant, productId, 'sku-one', {
        isDefault: true,
      });

      await expectDatabaseError(
        connection,
        () =>
          insertVariant(connection, tenant, productId, 'sku-one', { signature: '1'.repeat(64) }),
        '23505',
      );
      await expect(
        insertVariant(connection, other, otherProductId, 'sku-one', { isDefault: true }),
      ).resolves.toBeTypeOf('string');
      await expectDatabaseError(
        connection,
        () =>
          insertVariant(connection, tenant, productId, 'sku-two', {
            isDefault: true,
            signature: '2'.repeat(64),
          }),
        '23505',
      );
      await expectDatabaseError(
        connection,
        () =>
          insertVariant(connection, tenant, productId, 'sku-three', {
            signature: emptySignature,
          }),
        '23505',
      );

      await insertBarcode(connection, tenant, variantId, 'internal', 'barcode-one', true);
      await expectDatabaseError(
        connection,
        () => insertBarcode(connection, tenant, variantId, 'internal', 'barcode-one'),
        '23505',
      );
      await expectDatabaseError(
        connection,
        () => insertBarcode(connection, tenant, variantId, 'internal', 'barcode-two', true),
        '23505',
      );
    });
  });

  it('enforces authoritative option mappings and one value per definition', async () => {
    await withRollback(client, async (connection) => {
      const tenant = await insertTenant(connection, 'mapping');
      const productId = await insertProduct(connection, tenant, 'mapping-product');
      const otherProductId = await insertProduct(connection, tenant, 'mapping-other-product');
      const definitionId = await insertOptionDefinition(connection, tenant, productId, 'colour');
      const valueId = await insertOptionValue(connection, tenant, productId, definitionId, 'red');
      const otherDefinition = await insertOptionDefinition(
        connection,
        tenant,
        otherProductId,
        'size',
      );
      const otherValue = await insertOptionValue(
        connection,
        tenant,
        otherProductId,
        otherDefinition,
        'large',
      );
      const variantId = await insertVariant(connection, tenant, productId, 'mapping-sku');

      await connection.query(
        `insert into product_variant_option_values
          (company_id, product_id, product_variant_id, option_definition_id, option_value_id)
         values ($1, $2, $3, $4, $5)`,
        [tenant.companyId, productId, variantId, definitionId, valueId],
      );
      await expectDatabaseError(
        connection,
        () =>
          connection.query(
            `insert into product_variant_option_values
              (company_id, product_id, product_variant_id, option_definition_id, option_value_id)
             values ($1, $2, $3, $4, $5)`,
            [tenant.companyId, productId, variantId, definitionId, valueId],
          ),
        '23505',
      );
      await expectDatabaseError(
        connection,
        () =>
          connection.query(
            `insert into product_variant_option_values
              (company_id, product_id, product_variant_id, option_definition_id, option_value_id)
             values ($1, $2, $3, $4, $5)`,
            [tenant.companyId, productId, variantId, otherDefinition, otherValue],
          ),
        '23503',
      );
    });
  });

  it('enforces row-local status, retirement, numeric, reference, and actor checks', async () => {
    await withRollback(client, async (connection) => {
      const tenant = await insertTenant(connection, 'checks');
      const productId = await insertProduct(connection, tenant, 'checks-product');

      await expectDatabaseError(
        connection,
        () =>
          insertCategory(connection, tenant, 'self', {
            id: '018f0000-0000-7000-8000-000000000099',
            parentId: '018f0000-0000-7000-8000-000000000099',
          }),
        '23514',
      );
      await expectDatabaseError(
        connection,
        () =>
          connection.query(
            `insert into products
              (id, company_id, code, normalized_code, name, product_type, tracks_inventory,
               status, created_by, updated_by)
             values ($1, $2, 'kit', 'kit', 'Kit', 'kit', true, 'active', $3, $3)`,
            [randomUUID(), tenant.companyId, tenant.userId],
          ),
        '23514',
      );
      await expectDatabaseError(
        connection,
        () =>
          connection.query(
            `insert into product_categories
              (id, company_id, code, normalized_code, name, sort_order, status, version, created_by, updated_by)
             values ($1, $2, 'bad', 'bad', 'Bad', -1, 'active', 1, $3, $3)`,
            [randomUUID(), tenant.companyId, tenant.userId],
          ),
        '23514',
      );
      await expectDatabaseError(
        connection,
        () =>
          connection.query(
            `insert into brands
              (id, company_id, code, normalized_code, name, status, version, created_by, updated_by)
             values ($1, $2, 'bad', 'bad', 'Bad', 'retired', 0, $3, $3)`,
            [randomUUID(), tenant.companyId, tenant.userId],
          ),
        '23514',
      );
      await expectDatabaseError(
        connection,
        () =>
          connection.query(
            `insert into products
              (id, company_id, code, normalized_code, name, product_type, tracks_inventory,
               status, created_by, updated_by)
             values ($1, $2, 'service', 'service', 'Service', 'service', true, 'active', $3, $3)`,
            [randomUUID(), tenant.companyId, tenant.userId],
          ),
        '23514',
      );
      await expectDatabaseError(
        connection,
        () => insertVariant(connection, tenant, productId, 'bad-scale', { quantityScale: 7 }),
        '23514',
      );
      await expectDatabaseError(
        connection,
        () => insertVariant(connection, tenant, productId, 'bad-cost', { standardCost: '-0.0001' }),
        '23514',
      );
      await expectDatabaseError(
        connection,
        () => insertVariant(connection, tenant, productId, 'bad-uom', { unit: 'missing' }),
        '23503',
      );
      await expectDatabaseError(
        connection,
        () => insertVariant(connection, tenant, productId, 'bad-currency', { currency: 'mxn' }),
        '23514',
      );
      await expectDatabaseError(
        connection,
        () =>
          insertVariant(connection, tenant, productId, 'bad-status', {
            status: 'unknown',
          }),
        '23514',
      );
    });
  });

  it('uses a transaction-scoped ancestry read to reject direct and multi-level cycles', async () => {
    await withRollback(client, async (connection) => {
      const tenant = await insertTenant(connection, 'cycles');
      const root = await insertCategory(connection, tenant, 'root');
      const child = await insertCategory(connection, tenant, 'child', { parentId: root });
      const grandchild = await insertCategory(connection, tenant, 'grandchild', {
        parentId: child,
      });
      const loader = async (
        categoryId: string,
      ): Promise<{ id: string; parentId: string | null } | null> => {
        const result = await connection.query<{ id: string; parent_id: string | null }>(
          `select id, parent_id from product_categories
           where company_id = $1 and id = $2 for share`,
          [tenant.companyId, categoryId],
        );
        const row = result.rows[0];
        return row === undefined ? null : { id: row.id, parentId: row.parent_id };
      };

      await expect(assertCategoryParentIsAcyclic(root, root, loader)).rejects.toMatchObject({
        code: 'category_cycle_detected',
      });
      await expect(assertCategoryParentIsAcyclic(root, grandchild, loader)).rejects.toMatchObject({
        code: 'category_cycle_detected',
      });
      await expect(
        assertCategoryParentIsAcyclic(grandchild, root, loader),
      ).resolves.toBeUndefined();
    });
  });

  it('validates product activation rules without route coupling', () => {
    const productId = randomUUID();
    expect(() => {
      validateProductVariantState({
        productId,
        productType: 'variable',
        productStatus: 'draft',
        tracksInventory: true,
        variants: [],
      });
    }).not.toThrow();
    expect(() => {
      validateProductVariantState({
        productId,
        productType: 'variable',
        productStatus: 'active',
        tracksInventory: true,
        variants: [],
      });
    }).toThrow();
    expect(() => {
      validateProductVariantState({
        productId,
        productType: 'variable',
        productStatus: 'active',
        tracksInventory: true,
        variants: [
          {
            productId,
            status: 'active',
            isDefault: false,
            tracksInventory: true,
          },
        ],
      });
    }).toThrow();
  });
});

async function withRollback(
  databaseClient: DatabaseClient,
  callback: (connection: PoolClient) => Promise<void>,
): Promise<void> {
  const connection = await databaseClient.pool.connect();
  try {
    await connection.query('begin');
    await callback(connection);
  } finally {
    await connection.query('rollback');
    connection.release();
  }
}

let savepointSequence = 0;

async function expectDatabaseError(
  connection: PoolClient,
  operation: () => Promise<unknown>,
  code: string,
): Promise<void> {
  savepointSequence += 1;
  const savepoint = `catalog_case_${String(savepointSequence)}`;
  await connection.query(`savepoint ${savepoint}`);
  await expect(operation()).rejects.toMatchObject({ code });
  await connection.query(`rollback to savepoint ${savepoint}`);
}

async function insertTenant(connection: PoolClient, label: string): Promise<TenantFixture> {
  const companyId = randomUUID();
  const userId = randomUUID();
  await connection.query(
    `insert into companies
      (id, legal_name, display_name, slug, status, timezone, currency_code, locale)
     values ($1, $2, $2, $3, 'active', 'UTC', 'MXN', 'es-MX')`,
    [companyId, `Company ${label}`, `${label}-${companyId.slice(0, 8)}`],
  );
  await connection.query(
    `insert into users (id, email, normalized_email, display_name, status)
     values ($1, $2, $2, $3, 'active')`,
    [userId, `${label}-${userId.slice(0, 8)}@example.test`, `User ${label}`],
  );
  await connection.query(
    `insert into company_memberships (id, company_id, user_id, status)
     values ($1, $2, $3, 'active')`,
    [randomUUID(), companyId, userId],
  );
  return { companyId, userId };
}

async function insertCategory(
  connection: PoolClient,
  tenant: TenantFixture,
  code: string,
  options: { readonly id?: string; readonly parentId?: string | null } = {},
): Promise<string> {
  const id = options.id ?? randomUUID();
  await connection.query(
    `insert into product_categories
      (id, company_id, parent_id, code, normalized_code, name, created_by, updated_by)
     values ($1, $2, $3, $4, $4, $4, $5, $5)`,
    [id, tenant.companyId, options.parentId ?? null, code, tenant.userId],
  );
  return id;
}

async function insertBrand(
  connection: PoolClient,
  tenant: TenantFixture,
  code: string,
): Promise<string> {
  const id = randomUUID();
  await connection.query(
    `insert into brands
      (id, company_id, code, normalized_code, name, created_by, updated_by)
     values ($1, $2, $3, $3, $3, $4, $4)`,
    [id, tenant.companyId, code, tenant.userId],
  );
  return id;
}

async function insertProduct(
  connection: PoolClient,
  tenant: TenantFixture,
  code: string,
  options: { readonly categoryId?: string; readonly brandId?: string } = {},
): Promise<string> {
  const id = randomUUID();
  await connection.query(
    `insert into products
      (id, company_id, category_id, brand_id, code, normalized_code, name, product_type,
       tracks_inventory, status, created_by, updated_by)
     values ($1, $2, $3, $4, $5, $5, $5, 'simple', true, 'draft', $6, $6)`,
    [
      id,
      tenant.companyId,
      options.categoryId ?? null,
      options.brandId ?? null,
      code,
      tenant.userId,
    ],
  );
  return id;
}

async function insertOptionDefinition(
  connection: PoolClient,
  tenant: TenantFixture,
  productId: string,
  code: string,
): Promise<string> {
  const id = randomUUID();
  await connection.query(
    `insert into product_option_definitions
      (id, company_id, product_id, code, normalized_code, name, created_by, updated_by)
     values ($1, $2, $3, $4, $4, $4, $5, $5)`,
    [id, tenant.companyId, productId, code, tenant.userId],
  );
  return id;
}

async function insertOptionValue(
  connection: PoolClient,
  tenant: TenantFixture,
  productId: string,
  definitionId: string,
  code: string,
): Promise<string> {
  const id = randomUUID();
  await connection.query(
    `insert into product_option_values
      (id, company_id, product_id, option_definition_id, code, normalized_code, name,
       created_by, updated_by)
     values ($1, $2, $3, $4, $5, $5, $5, $6, $6)`,
    [id, tenant.companyId, productId, definitionId, code, tenant.userId],
  );
  return id;
}

async function insertVariant(
  connection: PoolClient,
  tenant: TenantFixture,
  productId: string,
  sku: string,
  options: {
    readonly currency?: string;
    readonly isDefault?: boolean;
    readonly quantityScale?: number;
    readonly signature?: string;
    readonly standardCost?: string;
    readonly status?: string;
    readonly unit?: string;
  } = {},
): Promise<string> {
  const id = randomUUID();
  await connection.query(
    `insert into product_variants
      (id, company_id, product_id, sku, normalized_sku, unit_of_measure_code, quantity_scale,
       tracks_inventory, standard_cost, currency_code, is_default, option_signature, status,
       created_by, updated_by)
     values ($1, $2, $3, $4, $4, $5, $6, true, $7, $8, $9, $10, $11, $12, $12)`,
    [
      id,
      tenant.companyId,
      productId,
      sku,
      options.unit ?? 'unit',
      options.quantityScale ?? 0,
      options.standardCost ?? '0.0000',
      options.currency ?? 'MXN',
      options.isDefault ?? false,
      options.signature ?? emptySignature,
      options.status ?? 'active',
      tenant.userId,
    ],
  );
  return id;
}

async function insertBarcode(
  connection: PoolClient,
  tenant: TenantFixture,
  variantId: string,
  type: string,
  barcode: string,
  isPrimary = false,
): Promise<string> {
  const id = randomUUID();
  await connection.query(
    `insert into product_barcodes
      (id, company_id, product_variant_id, barcode_type, barcode, normalized_barcode,
       is_primary, created_by, updated_by)
     values ($1, $2, $3, $4, $5, $5, $6, $7, $7)`,
    [id, tenant.companyId, variantId, type, barcode, isPrimary, tenant.userId],
  );
  return id;
}
