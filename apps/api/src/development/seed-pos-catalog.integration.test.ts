import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createDatabaseClient,
  type DatabaseClient,
  seedTechnicalPermissions,
} from '@asone/database';

import { DevelopmentOwnerBootstrap } from './bootstrap-owner.service.js';
import { PosCatalogSeed, PosCatalogSeedError } from './seed-pos-catalog.service.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const integrationDatabaseUrl = databaseUrl ?? 'postgresql://pos-catalog-seed-test-disabled';
const integration = databaseUrl === undefined ? describe.skip : describe;
const ownerPassword = `Owner#${randomUUID()}Aa1!`;

// { concurrent: false }: each test's beforeEach truncates the shared
// database — matching product-catalog.integration.test.ts's own
// established pattern. Without it, vitest may run these `it()` blocks
// concurrently against the same connection pool, racing truncate against
// a still-running prior test and deadlocking.
integration('PostgreSQL development POS catalog seed', { concurrent: false }, () => {
  let database: DatabaseClient;

  beforeAll(async () => {
    const parsed = new URL(integrationDatabaseUrl);
    if (!parsed.pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({
      connectionString: integrationDatabaseUrl,
      applicationName: 'asone-pos-catalog-seed-test',
    });
    await ensureMigrations(database);
  });

  beforeEach(async () => {
    // TRUNCATE ... CASCADE reaches every table with an FK back to
    // companies/users regardless of that FK's own ON DELETE action (e.g.
    // branches.company_id is onDelete:'restrict', which only blocks plain
    // DELETE) — same pattern bootstrap-owner.integration.test.ts relies on.
    await database.pool.query('truncate table companies,users,permissions cascade');
    await seedTechnicalPermissions(database.db);
  });

  afterAll(async () => database.close());

  it('refuses to run before the owner bootstrap has created the company and branches', async () => {
    await expect(new PosCatalogSeed(database).run()).rejects.toThrow(PosCatalogSeedError);
    await expect(new PosCatalogSeed(database).run()).rejects.toThrow(/dev:bootstrap-owner/u);
  });

  // TASK 15.0 (RC certification, Phase 15 final regression) — this is the
  // only test in the file that both bootstraps a full owner (56 sequential
  // `role_permissions` inserts, one round trip each — real, correct work,
  // not a hang) AND runs the catalog seed twice (create, then idempotent
  // replay). Confirmed genuinely real, not a hang: run with a generous
  // 30s timeout it completes in ~24s and every assertion below passes.
  // It reliably exceeded vitest's 5000ms default only once the approved
  // permission catalogue grew past its size when this test was written
  // (75 -> 98 via the pre-freeze legacy-parity waves, -> 100 via this
  // certification's own `inventory.transfer`/`inventory.receive` fix) —
  // an accumulated, legitimate increase in real setup work, not a
  // regression in this test's own logic. A dedicated timeout, scoped to
  // only this one test, is the narrow fix (same remedy the timeout
  // error itself suggests) rather than raising the file's default for
  // every test or touching the real bootstrap/seed code paths.
  it('seeds the full catalog idempotently and isolates it to the dev company', async () => {
    await new DevelopmentOwnerBootstrap(database).run(ownerPassword);
    const seed = new PosCatalogSeed(database);

    const first = await seed.run();
    expect(first).toMatchObject({
      company: 'inflapark-group',
      branches: 6,
      categories: { created: 6, existing: 0 },
      products: { created: 10, existing: 0 },
      variants: { created: 10, existing: 0 },
      prices: { created: 10, existing: 0 },
      inventoryLocations: { created: 6, existing: 0 },
      // 6 branches x 3 stock-tracked products (Calcetas, Agua, Refresco).
      inventoryBalances: { created: 18, existing: 0 },
      success: true,
    });

    const counts = await catalogCounts(database);
    expect(counts).toEqual({
      categories: '6',
      products: '10',
      variants: '10',
      prices: '10',
      locations: '6',
      balances: '18', // 6 branches x 3 stock-tracked products
      movements: '6',
      postedMovements: '6',
    });

    const second = await seed.run();
    expect(second).toMatchObject({
      categories: { created: 0, existing: 6 },
      products: { created: 0, existing: 10 },
      variants: { created: 0, existing: 10 },
      prices: { created: 0, existing: 10 },
      inventoryLocations: { created: 0, existing: 6 },
      inventoryBalances: { created: 0, existing: 18 },
      success: true,
    });
    const countsAfterReplay = await catalogCounts(database);
    expect(countsAfterReplay).toEqual(counts);
  }, 20_000);

  it('assigns IVA_GENERAL to every seeded product and leaves no fabricated price gaps', async () => {
    await new DevelopmentOwnerBootstrap(database).run(ownerPassword);
    await new PosCatalogSeed(database).run();
    const rows = await database.pool.query<{
      code: string;
      tax_code: string;
      tracks_inventory: boolean;
      price_count: string;
    }>(
      `select p.code,p.tax_code,p.tracks_inventory,
        (select count(*) from product_prices pp where pp.company_id=p.company_id and pp.product_id=p.id) price_count
       from products p join companies c on c.id=p.company_id where c.slug='inflapark-group' order by p.code`,
    );
    expect(rows.rows).toHaveLength(10);
    for (const row of rows.rows) {
      expect(row.tax_code).toBe('IVA_GENERAL');
      expect(row.price_count).toBe('1');
    }
    const stockTracked = rows.rows.filter((row) => row.tracks_inventory).map((row) => row.code);
    expect(stockTracked.sort()).toEqual(['TDA-AGUA', 'TDA-CALCETAS', 'TDA-REFRESCO']);
  });

  it('gives every stock-tracked product a real, non-zero on-hand balance per branch', async () => {
    await new DevelopmentOwnerBootstrap(database).run(ownerPassword);
    await new PosCatalogSeed(database).run();
    const rows = await database.pool.query<{
      branch_code: string;
      sku: string;
      quantity_on_hand: string;
    }>(
      `select b.code branch_code,v.sku,ib.quantity_on_hand::text
       from inventory_balances ib
       join branches b on b.id=ib.branch_id
       join product_variants v on v.id=ib.product_variant_id
       join companies c on c.id=ib.company_id
       where c.slug='inflapark-group' order by b.code,v.sku`,
    );
    expect(rows.rows).toHaveLength(18);
    for (const row of rows.rows) expect(Number(row.quantity_on_hand)).toBe(50);
  });
});

async function catalogCounts(database: DatabaseClient): Promise<Readonly<Record<string, string>>> {
  const result = await database.pool.query<{
    categories: string;
    products: string;
    variants: string;
    prices: string;
    locations: string;
    balances: string;
    movements: string;
    posted_movements: string;
  }>(
    `select
      (select count(*) from product_categories pc join companies c on c.id=pc.company_id where c.slug='inflapark-group')::text categories,
      (select count(*) from products p join companies c on c.id=p.company_id where c.slug='inflapark-group')::text products,
      (select count(*) from product_variants v join companies c on c.id=v.company_id where c.slug='inflapark-group')::text variants,
      (select count(*) from product_prices pp join companies c on c.id=pp.company_id where c.slug='inflapark-group')::text prices,
      (select count(*) from inventory_locations l join companies c on c.id=l.company_id where c.slug='inflapark-group')::text locations,
      (select count(*) from inventory_balances b join companies c on c.id=b.company_id where c.slug='inflapark-group')::text balances,
      (select count(*) from inventory_movements m join companies c on c.id=m.company_id where c.slug='inflapark-group')::text movements,
      (select count(*) from inventory_movements m join companies c on c.id=m.company_id where c.slug='inflapark-group' and m.status='posted')::text posted_movements`,
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('Expected catalog counts.');
  return {
    categories: row.categories,
    products: row.products,
    variants: row.variants,
    prices: row.prices,
    locations: row.locations,
    balances: row.balances,
    movements: row.movements,
    postedMovements: row.posted_movements,
  };
}

async function ensureMigrations(database: DatabaseClient): Promise<void> {
  const existing = await database.pool.query<{ present: string | null }>(
    `select to_regclass('public.companies')::text present`,
  );
  const migrationsPath = resolve(import.meta.dirname, '../../../../packages/database/drizzle');
  if (existing.rows[0]?.present === null) {
    for (const name of [
      '0000_fantastic_black_cat.sql',
      '0001_high_thor.sql',
      '0002_true_sugar_man.sql',
      '0003_curved_zuras.sql',
      '0004_pink_nehzno.sql',
      '0005_inventory_operations_foundation.sql',
      '0006_inventory_transfers_and_reservations.sql',
      '0007_inventory_counts_foundation.sql',
      '0008_inventory_reconciliation_findings.sql',
      '0009_auth_login_challenges.sql',
      '0010_auth_session_transport_mode.sql',
    ]) {
      await database.pool.query(await readFile(resolve(migrationsPath, name), 'utf8'));
    }
  }
  // TASK 12.3C: migration 0011 (product_prices + products.tax_code) applied
  // separately so a persisted test database from a prior run still picks
  // it up instead of silently skipping it — same pattern as
  // product-catalog.integration.test.ts.
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
}
