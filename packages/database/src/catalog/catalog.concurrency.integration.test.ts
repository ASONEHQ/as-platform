import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '../client.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const integrationDatabaseUrl = databaseUrl ?? 'postgresql://catalog-concurrency-test-disabled';
const integration = databaseUrl === undefined ? describe.skip : describe;

interface ProductFixture {
  readonly companyId: string;
  readonly productId: string;
  readonly userId: string;
}

integration('catalog PostgreSQL concurrency', () => {
  let client: DatabaseClient;

  beforeAll(async () => {
    if (!new URL(integrationDatabaseUrl).pathname.toLowerCase().includes('test')) {
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    }
    client = createDatabaseClient({
      connectionString: integrationDatabaseUrl,
      applicationName: 'asone-catalog-concurrency-test',
    });
    await migrate(client.db, { migrationsFolder: resolve(import.meta.dirname, '../../drizzle') });
  });

  afterAll(async () => {
    await client.close();
  });

  it('allows only one concurrent insert for a company SKU', async () => {
    const fixture = await createProductFixture(client, 'concurrent-sku');
    const first = await client.pool.connect();
    const second = await client.pool.connect();
    try {
      await first.query('begin');
      await second.query('begin');
      await second.query(`set local lock_timeout = '5s'`);
      await insertVariant(first, fixture, 'shared-sku', false, '1'.repeat(64));

      const competingInsert = settled(
        insertVariant(second, fixture, 'shared-sku', false, '2'.repeat(64)),
      );
      await waitForIndexConflict();
      await first.query('commit');
      await expect(competingInsert).resolves.toMatchObject({
        succeeded: false,
        error: {
          code: '23505',
          constraint: 'product_variants_company_sku_active_uq',
        },
      });
      await second.query('rollback');
    } finally {
      await rollbackIfOpen(first);
      await rollbackIfOpen(second);
      first.release();
      second.release();
    }
  });

  it('allows only one concurrent default variant for a product', async () => {
    const fixture = await createProductFixture(client, 'concurrent-default');
    const first = await client.pool.connect();
    const second = await client.pool.connect();
    try {
      await first.query('begin');
      await second.query('begin');
      await second.query(`set local lock_timeout = '5s'`);
      await insertVariant(first, fixture, 'default-one', true, '3'.repeat(64));

      const competingInsert = settled(
        insertVariant(second, fixture, 'default-two', true, '4'.repeat(64)),
      );
      await waitForIndexConflict();
      await first.query('commit');
      await expect(competingInsert).resolves.toMatchObject({
        succeeded: false,
        error: {
          code: '23505',
          constraint: 'product_variants_product_default_active_uq',
        },
      });
      await second.query('rollback');
    } finally {
      await rollbackIfOpen(first);
      await rollbackIfOpen(second);
      first.release();
      second.release();
    }
  });
});

async function createProductFixture(
  databaseClient: DatabaseClient,
  label: string,
): Promise<ProductFixture> {
  const companyId = randomUUID();
  const userId = randomUUID();
  const productId = randomUUID();
  await databaseClient.pool.query(
    `insert into companies
      (id, legal_name, display_name, slug, status, timezone, currency_code, locale)
     values ($1, $2, $2, $3, 'active', 'UTC', 'MXN', 'es-MX')`,
    [companyId, `Company ${label}`, `${label}-${companyId.slice(0, 8)}`],
  );
  await databaseClient.pool.query(
    `insert into users (id, email, normalized_email, display_name, status)
     values ($1, $2, $2, $3, 'active')`,
    [userId, `${label}-${userId.slice(0, 8)}@example.test`, `User ${label}`],
  );
  await databaseClient.pool.query(
    `insert into company_memberships (id, company_id, user_id, status)
     values ($1, $2, $3, 'active')`,
    [randomUUID(), companyId, userId],
  );
  await databaseClient.pool.query(
    `insert into products
      (id, company_id, code, normalized_code, name, product_type, tracks_inventory,
       status, created_by, updated_by)
     values ($1, $2, $3, $3, $3, 'simple', true, 'draft', $4, $4)`,
    [productId, companyId, `${label}-${productId.slice(0, 8)}`, userId],
  );
  return { companyId, productId, userId };
}

async function insertVariant(
  connection: PoolClient,
  fixture: ProductFixture,
  sku: string,
  isDefault: boolean,
  optionSignature: string,
): Promise<void> {
  await connection.query(
    `insert into product_variants
      (id, company_id, product_id, sku, normalized_sku, unit_of_measure_code, quantity_scale,
       tracks_inventory, standard_cost, currency_code, is_default, option_signature, status,
       created_by, updated_by)
     values ($1, $2, $3, $4, $4, 'unit', 0, true, 0, 'MXN', $5, $6, 'active', $7, $7)`,
    [
      randomUUID(),
      fixture.companyId,
      fixture.productId,
      sku,
      isDefault,
      optionSignature,
      fixture.userId,
    ],
  );
}

async function rollbackIfOpen(connection: PoolClient): Promise<void> {
  try {
    await connection.query('rollback');
  } catch {
    // The connection may already be outside a transaction after explicit cleanup.
  }
}

async function waitForIndexConflict(): Promise<void> {
  await new Promise<void>((resolveWait) => {
    setTimeout(resolveWait, 100);
  });
}

async function settled(
  operation: Promise<void>,
): Promise<{ succeeded: true } | { succeeded: false; error: unknown }> {
  try {
    await operation;
    return { succeeded: true };
  } catch (error) {
    return { succeeded: false, error };
  }
}
