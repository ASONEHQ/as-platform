import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient, seedTechnicalPermissions } from '@asone/database';

import { DevelopmentOwnerBootstrap } from './bootstrap-owner.service.js';
import { CashRegisterSeed } from './seed-cash-registers.service.js';
import { PosCatalogSeedError } from './seed-pos-catalog.service.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const integrationDatabaseUrl = databaseUrl ?? 'postgresql://cash-register-seed-test-disabled';
const integration = databaseUrl === undefined ? describe.skip : describe;
const ownerPassword = `Owner#${randomUUID()}Aa1!`;

// TASK 12.7 Part U — same guarded local/test-only seed discipline as
// `seed-pos-catalog.integration.test.ts`, applied to the cash-register
// fixture: it must exist, be idempotent, target only the dev company, and
// never open a session (a human opens the drawer manually in QA).
integration('PostgreSQL development cash-register seed', { concurrent: false }, () => {
  let database: DatabaseClient;

  beforeAll(async () => {
    const parsed = new URL(integrationDatabaseUrl);
    if (!parsed.pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({
      connectionString: integrationDatabaseUrl,
      applicationName: 'asone-cash-register-seed-test',
    });
    await ensureMigrations(database);
  });

  beforeEach(async () => {
    await database.pool.query('truncate table companies,users,permissions cascade');
    await seedTechnicalPermissions(database.db);
  });

  afterAll(async () => database.close());

  it('refuses to run before the owner bootstrap has created the company and branches', async () => {
    await expect(new CashRegisterSeed(database).run()).rejects.toThrow(PosCatalogSeedError);
    await expect(new CashRegisterSeed(database).run()).rejects.toThrow(/dev:bootstrap-owner/u);
  });

  it('creates one active register per branch, idempotently, and opens no session', async () => {
    await new DevelopmentOwnerBootstrap(database).run(ownerPassword);
    const seed = new CashRegisterSeed(database);

    const first = await seed.run();
    expect(first).toMatchObject({
      company: 'inflapark-group',
      registers: { created: 6, existing: 0 },
      success: true,
    });

    const rows = await database.pool.query<{ branch_code: string; code: string; status: string }>(
      `select b.code branch_code, cr.code, cr.status
       from cash_registers cr join branches b on b.id=cr.branch_id
       join companies c on c.id=cr.company_id where c.slug='inflapark-group' order by b.code`,
    );
    expect(rows.rows).toHaveLength(6);
    for (const row of rows.rows) expect(row).toMatchObject({ code: 'CAJA-1', status: 'active' });

    const sessionCount = await database.pool.query<{ count: string }>(
      `select count(*)::text as count from cash_sessions cs
       join companies c on c.id=cs.company_id where c.slug='inflapark-group'`,
    );
    expect(sessionCount.rows[0]?.count).toBe('0');

    const second = await seed.run();
    expect(second).toMatchObject({ registers: { created: 0, existing: 6 }, success: true });
    const rowsAfterReplay = await database.pool.query(
      `select 1 from cash_registers cr join companies c on c.id=cr.company_id where c.slug='inflapark-group'`,
    );
    expect(rowsAfterReplay.rows).toHaveLength(6);
  });
});

async function ensureMigrations(database: DatabaseClient): Promise<void> {
  const migrationsPath = resolve(import.meta.dirname, '../../../../packages/database/drizzle');
  const existing = await database.pool.query<{ present: string | null }>(
    `select to_regclass('public.companies')::text present`,
  );
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
    ])
      await database.pool.query(await readFile(resolve(migrationsPath, name), 'utf8'));
  }
  const pricingPresent = await database.pool.query<{ present: string | null }>(
    `select to_regclass('public.product_prices')::text present`,
  );
  if (pricingPresent.rows[0]?.present === null) {
    const sql = await readFile(resolve(migrationsPath, '0011_product_pricing_foundation.sql'), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint'))
      if (statement.trim().length > 0) await database.pool.query(statement);
  }
  const cashPresent = await database.pool.query<{ present: string | null }>(
    `select to_regclass('public.cash_registers')::text present`,
  );
  if (cashPresent.rows[0]?.present === null) {
    for (const name of [
      '0012_payment_and_terminal_foundation.sql',
      '0013_sale_foundation.sql',
      '0014_sale_id_required.sql',
      '0015_true_molecule_man.sql',
      '0016_jittery_slayback.sql',
      '0017_gifted_vertigo.sql',
      '0018_glossy_mongu.sql',
    ]) {
      const sql = await readFile(resolve(migrationsPath, name), 'utf8');
      for (const statement of sql.split('--> statement-breakpoint'))
        if (statement.trim().length > 0) await database.pool.query(statement);
    }
  }
}
