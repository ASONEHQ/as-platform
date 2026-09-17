import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';

import { PromotionsRepository } from '../promotions/promotions.repository.js';
import { SalesRepository } from './sales.repository.js';
import { SalesService } from './sales.service.js';

/** TASK 16.8B — the exact production incident, reproduced and fixed for
 * real against PostgreSQL: `POST /api/v1/sales` returned an opaque HTTP
 * 500 (`RangeError: Invalid time zone specified: Mexico_City`) for a real
 * branch ("Puerta La Victoria") whose `timezone` column held the
 * non-IANA value `"Mexico_City"` — persisted before any server-side
 * validation existed. `AdministrationService`'s own tests
 * (`admin.integration.test.ts`) prove the write-side gate that now
 * prevents a NEW bad value from ever being saved; this file proves the
 * separate, defense-in-depth read-side guard `SalesService.createSale`
 * itself now has, for a branch whose timezone is ALREADY corrupted (e.g.
 * a row that predates the write-side fix, or one repaired incorrectly by
 * some future bug) — an honest, controlled `branch_timezone_invalid`
 * rejection, never an unhandled `RangeError`/opaque `internal_error`, and
 * a real, valid-timezone branch's own sale completing normally either
 * way (`evaluatePricing`'s `localWeekdayAndTime` call must not be broken
 * by this fix for the ordinary, correct case). The corrupted row here is
 * written directly via SQL — deliberately bypassing
 * `AdministrationService` entirely — to model exactly how the real
 * production data got into this state (through the admin UI, before this
 * task's server-side validation existed), not through any code path this
 * task added. */
const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;
const migrationsPath = resolve(import.meta.dirname, '../../../../../packages/database/drizzle');

integration('PostgreSQL sales — corrupted branch timezone defense in depth (TASK 16.8B)', () => {
  let database: DatabaseClient;
  let sales: SalesService;
  const companyId = randomUUID();
  const validBranchId = randomUUID();
  const corruptedBranchId = randomUUID();
  const userId = randomUUID();
  const validProductId = randomUUID();
  const corruptedProductId = randomUUID();
  const context = {
    companyId,
    actorId: userId,
    requestId: 'sales-branch-timezone-request',
    correlationId: 'sales-branch-timezone-correlation',
    timestamp: new Date('2026-09-17T09:00:00.000Z'),
  };

  async function applyIfMissing(regclass: string, files: readonly string[]): Promise<void> {
    const check = await database.pool.query<{ present: string | null }>(
      `select to_regclass('public.${regclass}')::text present`,
    );
    if (check.rows[0]?.present !== null) return;
    for (const file of files) {
      const sql = await readFile(resolve(migrationsPath, file), 'utf8');
      for (const statement of sql.split('--> statement-breakpoint'))
        if (statement.trim().length > 0) await database.pool.query(statement);
    }
  }

  beforeAll(async () => {
    if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({ connectionString: databaseUrl, applicationName: 'asone-sales-branch-timezone' });
    await applyIfMissing('companies', [
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
    ]);
    await applyIfMissing('product_prices', ['0011_product_pricing_foundation.sql']);
    await applyIfMissing('payment_terminals', ['0012_payment_and_terminal_foundation.sql']);
    await applyIfMissing('sales', ['0013_sale_foundation.sql', '0014_sale_id_required.sql']);
    const variantColumnPresent = await database.pool.query<{ present: boolean }>(
      `select exists(select 1 from information_schema.columns where table_name='sale_items' and column_name='product_variant_id') present`,
    );
    if (variantColumnPresent.rows[0]?.present !== true) {
      const sql = await readFile(resolve(migrationsPath, '0015_true_molecule_man.sql'), 'utf8');
      for (const statement of sql.split('--> statement-breakpoint'))
        if (statement.trim().length > 0) await database.pool.query(statement);
    }
    await applyIfMissing('cash_registers', ['0016_jittery_slayback.sql', '0017_gifted_vertigo.sql']);
    await applyIfMissing('refunds', ['0019_nosy_the_twelve.sql']);
    await applyIfMissing('promotions', ['0020_broad_ben_grimm.sql']);

    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'Timezone Defense Park','Timezone Defense Park',$2,'active','America/Mexico_City','MXN','es-MX')`,
      [companyId, `sales-tz-${companyId}`],
    );
    // The valid branch mirrors correct production data. The corrupted
    // branch is written with the EXACT production-incident value,
    // directly via SQL, bypassing `AdministrationService` on purpose (see
    // this file's own header comment).
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'Sucursal Válida','VALID','active','America/Mexico_City'),
             ($3,$2,'Puerta La Victoria (corrupted fixture)','CORRUPT','active','Mexico_City')`,
      [validBranchId, companyId, corruptedBranchId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status) values($1,$2,$2,'Sales TZ Tester','active')`,
      [userId, `sales-tz-${userId}@example.test`],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status) values($1,$2,$3,'active')`,
      [randomUUID(), companyId, userId],
    );
    await database.pool.query(
      `insert into products
       (id,company_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
       values($1,$2,'TZ-VALID-ITEM','tz-valid-item','TZ Valid Item','simple',false,'IVA_EXEMPT','active',$3,$3),
             ($4,$2,'TZ-CORRUPT-ITEM','tz-corrupt-item','TZ Corrupt Item','simple',false,'IVA_EXEMPT','active',$3,$3)`,
      [validProductId, companyId, userId, corruptedProductId],
    );
    await database.pool.query(
      `insert into product_prices (id,company_id,product_id,amount,currency_code,status,created_by,updated_by)
       values($1,$2,$3,'50.0000','MXN','active',$4,$4),($5,$2,$6,'50.0000','MXN','active',$4,$4)`,
      [randomUUID(), companyId, validProductId, userId, randomUUID(), corruptedProductId],
    );

    const salesRepository = new SalesRepository(database);
    const promotionsRepository = new PromotionsRepository(database);
    sales = new SalesService(salesRepository, promotionsRepository);
  });

  afterAll(async () => {
    await database.pool.query('delete from sale_items where company_id=$1', [companyId]);
    await database.pool.query('delete from sales where company_id=$1', [companyId]);
    await database.pool.query('delete from idempotency_keys where company_id=$1', [companyId]);
    await database.pool.query('delete from outbox_events where company_id=$1', [companyId]);
    await database.pool.query('delete from audit_log where company_id=$1', [companyId]);
    await database.pool.query('delete from product_prices where company_id=$1', [companyId]);
    await database.pool.query('delete from products where company_id=$1', [companyId]);
    await database.pool.query('delete from company_memberships where company_id=$1', [companyId]);
    await database.pool.query('delete from branches where company_id=$1', [companyId]);
    await database.pool.query('delete from companies where id=$1', [companyId]);
    await database.pool.query('delete from users where id=$1', [userId]);
    await database.close();
  });

  it('a branch with a real IANA timezone completes a sale normally — this fix never breaks the ordinary case', async () => {
    const created = await sales.createSale(context, [validBranchId], 'tz-valid-sale-1', {
      branchId: validBranchId,
      items: [{ productId: validProductId, quantity: '1' }],
    });
    expect(created.value.sale.total).toBe('50.0000');
    expect(created.value.sale.status).toBe('pending_payment');
  });

  it('a branch with the exact production-incident corrupted timezone value is rejected with a controlled, '
    + 'explicit error — never an unhandled RangeError or an opaque 500', async () => {
    await expect(
      sales.createSale(context, [corruptedBranchId], 'tz-corrupt-sale-1', {
        branchId: corruptedBranchId,
        items: [{ productId: corruptedProductId, quantity: '1' }],
      }),
    ).rejects.toMatchObject({
      name: 'SaleError',
      code: 'branch_timezone_invalid',
    });
  });

  it('the rejected sale against the corrupted branch never creates a Sale row at all', async () => {
    const before = await database.pool.query('select count(*)::int as count from sales where branch_id=$1', [
      corruptedBranchId,
    ]);
    await expect(
      sales.createSale(context, [corruptedBranchId], 'tz-corrupt-sale-no-row-1', {
        branchId: corruptedBranchId,
        items: [{ productId: corruptedProductId, quantity: '1' }],
      }),
    ).rejects.toMatchObject({ code: 'branch_timezone_invalid' });
    const after = await database.pool.query('select count(*)::int as count from sales where branch_id=$1', [
      corruptedBranchId,
    ]);
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });
});
