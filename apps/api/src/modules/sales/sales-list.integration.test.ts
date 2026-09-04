import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';

import { CashRepository } from '../cash/cash.repository.js';
import { PaymentRepository } from '../payments/payments.repository.js';
import { PaymentService } from '../payments/payments.service.js';
import { MercadoPagoClient } from '../payments/providers/mercado-pago.client.js';
import { MercadoPagoPointProvider } from '../payments/providers/mercado-pago.provider.js';
import { SalesRepository } from './sales.repository.js';
import { SalesService } from './sales.service.js';

/** TASK 12.6 Part B (E075) — the sales-history list/summary query.
 * A dedicated file (rather than growing `sales.integration.test.ts`
 * further) since this exercises a genuinely different surface
 * (`SalesRepository.listSales`/`listSummaries`) against its own compact
 * fixture set. */
const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;
const migrationsPath = resolve(import.meta.dirname, '../../../../../packages/database/drizzle');

integration('PostgreSQL sales history list (TASK 12.6 Part B)', { concurrent: false }, () => {
  let database: DatabaseClient;
  let sales: SalesService;
  let payments: PaymentService;
  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const branchId = randomUUID();
  const otherBranchId = randomUUID();
  const otherCompanyBranchId = randomUUID();
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const otherCompanyUserId = randomUUID();
  const productId = randomUUID();
  const otherCompanyProductId = randomUUID();
  const context = {
    companyId,
    actorId: userId,
    requestId: 'sale-list-request',
    correlationId: 'sale-list-correlation',
    timestamp: new Date('2026-08-15T12:00:00.000Z'),
  };

  beforeAll(async () => {
    if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({
      connectionString: databaseUrl,
      applicationName: 'asone-sales-list-integration',
    });
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
      `select exists(
         select 1 from information_schema.columns
         where table_name='sale_items' and column_name='product_variant_id'
       ) present`,
    );
    if (variantColumnPresent.rows[0]?.present !== true) {
      const sql = await readFile(resolve(migrationsPath, '0015_true_molecule_man.sql'), 'utf8');
      for (const statement of sql.split('--> statement-breakpoint'))
        if (statement.trim().length > 0) await database.pool.query(statement);
    }
    await applyIfMissing('cash_registers', ['0016_jittery_slayback.sql', '0017_gifted_vertigo.sql']);
    // TASK 12.7 (Part J follow-up): `denomination_counts` is a later
    // migration than 0016/0017, so a reused test database needs this
    // checked independently.
    const denominationColumnPresent = await database.pool.query<{ present: boolean }>(
      `select exists(select 1 from information_schema.columns where table_name='cash_sessions' and column_name='denomination_counts') present`,
    );
    if (denominationColumnPresent.rows[0]?.present !== true) {
      const sql = await readFile(resolve(migrationsPath, '0018_glossy_mongu.sql'), 'utf8');
      for (const statement of sql.split('--> statement-breakpoint'))
        if (statement.trim().length > 0) await database.pool.query(statement);
    }
    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'Sales List','Sales List',$2,'active','UTC','MXN','es-MX'),
             ($3,'Other Sales List','Other Sales List',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `sales-list-${companyId}`, otherCompanyId, `sales-list-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'List Main','LMAIN','active','UTC'),
             ($3,$2,'List Second','LSECOND','active','UTC'),
             ($4,$5,'List Other Co','LOTHER','active','UTC')`,
      [branchId, companyId, otherBranchId, otherCompanyBranchId, otherCompanyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'List Cashier','active'),
             ($3,$4,$4,'List Second Cashier','active'),
             ($5,$6,$6,'List Other Co User','active')`,
      [
        userId,
        `sales-list-${userId}@example.test`,
        otherUserId,
        `sales-list-${otherUserId}@example.test`,
        otherCompanyUserId,
        `sales-list-${otherCompanyUserId}@example.test`,
      ],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status)
       values($1,$2,$3,'active'),($4,$2,$5,'active'),($6,$7,$8,'active')`,
      [randomUUID(), companyId, userId, randomUUID(), otherUserId, randomUUID(), otherCompanyId, otherCompanyUserId],
    );
    await database.pool.query(
      `insert into products
       (id,company_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
       values($1,$2,'LIST-GENERAL','list-general','List Product','simple',false,'IVA_GENERAL','active',$3,$3),
             ($4,$5,'LIST-GENERAL','list-general','Other Co List Product','simple',false,'IVA_GENERAL','active',$6,$6)`,
      [productId, companyId, userId, otherCompanyProductId, otherCompanyId, otherCompanyUserId],
    );
    await database.pool.query(
      `insert into product_prices (id,company_id,product_id,amount,currency_code,status,created_by,updated_by)
       values($1,$2,$3,'50.0000','MXN','active',$4,$4),($5,$6,$7,'50.0000','MXN','active',$8,$8)`,
      [randomUUID(), companyId, productId, userId, randomUUID(), otherCompanyId, otherCompanyProductId, otherCompanyUserId],
    );
    const salesRepository = new SalesRepository(database);
    sales = new SalesService(salesRepository);
    const paymentRepository = new PaymentRepository(database);
    const mercadoPagoProvider = new MercadoPagoPointProvider(
      new MercadoPagoClient({ accessToken: undefined, apiBaseUrl: 'https://api.mercadopago.com' }),
    );
    const cashRepository = new CashRepository(database);
    payments = new PaymentService(paymentRepository, salesRepository, mercadoPagoProvider, cashRepository);
    // TASK 12.7: `makeSale(..., complete: true)` below now needs an open
    // cash session for its branch.
    for (const branch of [branchId, otherBranchId]) {
      const registerId = randomUUID();
      await database.pool.query(
        `insert into cash_registers (id,company_id,branch_id,code,normalized_code,name,status,created_by,updated_by)
         values ($1,$2,$3,'MAIN','main','Main','active',$4,$4)`,
        [registerId, companyId, branch, userId],
      );
      await database.pool.query(
        `insert into cash_sessions (id,company_id,branch_id,cash_register_id,opened_by,opened_at,opening_amount,currency_code,status)
         values ($1,$2,$3,$4,$5,$6,'0.0000','MXN','open')`,
        [randomUUID(), companyId, branch, registerId, userId, context.timestamp],
      );
    }
  });

  afterAll(async () => {
    // TASK 12.7: `sales.cash_register_id`/`cash_session_id` are now real
    // FKs — those tables must be deleted after `payments`/`sales`.
    await database.pool.query('delete from payment_attempts where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from payments where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from sale_items where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from sales where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from cash_movements where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from cash_sessions where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from cash_registers where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from idempotency_keys where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from outbox_events where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from audit_log where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from product_prices where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from products where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from company_memberships where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from branches where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from companies where id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from users where id in ($1,$2,$3)', [userId, otherUserId, otherCompanyUserId]);
    await database.close();
  });

  // Each call gets a genuinely distinct, monotonically increasing
  // `occurred_at` — a fixed shared timestamp would make same-instant
  // sales' relative order depend entirely on the `id` tiebreak, which is
  // a random UUID (see `listSales`'s own doc comment: `sales.id` carries
  // no time information), not a meaningful "creation order" signal.
  let clock = context.timestamp.getTime();
  async function makeSale(branch: string, key: string, complete: boolean): Promise<string> {
    clock += 1000;
    const callContext = { ...context, timestamp: new Date(clock) };
    const created = await sales.createSale(callContext, [branchId, otherBranchId], key, {
      branchId: branch,
      items: [{ productId, quantity: '1' }],
    });
    if (complete) {
      await payments.createCashPayment(callContext, [branchId, otherBranchId], `${key}-cash`, {
        saleId: created.value.sale.id,
        tenderedAmount: created.value.sale.total,
      });
    }
    return created.value.sale.id;
  }

  it('lists newest first and paginates with a stable cursor', async () => {
    const first = await makeSale(branchId, 'list-order-1', false);
    const second = await makeSale(branchId, 'list-order-2', false);
    const third = await makeSale(branchId, 'list-order-3', false);
    const page1 = await sales.listSales(companyId, [branchId, otherBranchId], { limit: 2 });
    expect(page1.items.map((item) => item.id)).toEqual([third, second]);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await sales.listSales(companyId, [branchId, otherBranchId], {
      limit: 2,
      ...(page1.nextCursor === null ? {} : { cursor: page1.nextCursor }),
    });
    expect(page2.items.map((item) => item.id)).toContain(first);
    expect(page2.items.some((item) => item.id === second || item.id === third)).toBe(false);
  });

  it('filters by branch, status, folio search, and payment method', async () => {
    const completedId = await makeSale(otherBranchId, 'list-filter-completed', true);
    const pendingId = await makeSale(otherBranchId, 'list-filter-pending', false);

    const byBranch = await sales.listSales(companyId, [branchId, otherBranchId], { limit: 50, branchId: otherBranchId });
    const branchIds = new Set(byBranch.items.map((item) => item.id));
    expect(branchIds.has(completedId)).toBe(true);
    expect(branchIds.has(pendingId)).toBe(true);

    const byStatus = await sales.listSales(companyId, [branchId, otherBranchId], { limit: 50, status: 'completed' });
    expect(byStatus.items.some((item) => item.id === completedId)).toBe(true);
    expect(byStatus.items.some((item) => item.id === pendingId)).toBe(false);

    const completedSale = byStatus.items.find((item) => item.id === completedId);
    const bySaleNumber = await sales.listSales(companyId, [branchId, otherBranchId], {
      limit: 50,
      saleNumber: completedSale?.saleNumber.slice(5, 13) ?? 'no-match',
    });
    expect(bySaleNumber.items.some((item) => item.id === completedId)).toBe(true);

    const byPaymentMethod = await sales.listSales(companyId, [branchId, otherBranchId], {
      limit: 50,
      paymentMethod: 'cash',
    });
    expect(byPaymentMethod.items.some((item) => item.id === completedId)).toBe(true);
    expect(byPaymentMethod.items.some((item) => item.id === pendingId)).toBe(false);
  });

  it('filters by an occurred_at date range', async () => {
    const id = await makeSale(branchId, 'list-date-1', false);
    const created = await sales.sale(companyId, [branchId, otherBranchId], id);
    const before = new Date(created.sale.occurredAt.getTime() - 500);
    const after = new Date(created.sale.occurredAt.getTime() + 500);
    const inRange = await sales.listSales(companyId, [branchId, otherBranchId], {
      limit: 50,
      occurredFrom: before,
      occurredTo: after,
    });
    expect(inRange.items.some((item) => item.id === id)).toBe(true);
    const outOfRange = await sales.listSales(companyId, [branchId, otherBranchId], {
      limit: 50,
      occurredFrom: after,
    });
    expect(outOfRange.items.some((item) => item.id === id)).toBe(false);
  });

  it('branch isolation — a session without a branch never sees its sales', async () => {
    const id = await makeSale(otherBranchId, 'list-branch-iso-1', false);
    const restricted = await sales.listSales(companyId, [branchId], { limit: 50 });
    expect(restricted.items.some((item) => item.id === id)).toBe(false);
  });

  it('tenant isolation — a sale in another company never appears', async () => {
    const otherSale = await sales.createSale(
      { ...context, companyId: otherCompanyId, actorId: otherCompanyUserId },
      [otherCompanyBranchId],
      'list-tenant-iso-1',
      { branchId: otherCompanyBranchId, items: [{ productId: otherCompanyProductId, quantity: '1' }] },
    );
    const page = await sales.listSales(companyId, [branchId, otherBranchId], { limit: 200 });
    expect(page.items.some((item) => item.id === otherSale.value.sale.id)).toBe(false);
  });

  it('summarizes a completed sale with branch/cashier/item-count/payment-method, and a pending sale honestly (no payment method yet)', async () => {
    const completedId = await makeSale(branchId, 'list-summary-completed', true);
    const pendingId = await makeSale(branchId, 'list-summary-pending', false);
    const summaries = await sales.listSummaries(companyId, [completedId, pendingId]);
    const completedSummary = summaries.get(completedId);
    expect(completedSummary).toMatchObject({
      branchName: 'List Main',
      cashierName: 'List Cashier',
      itemCount: 1,
      paymentMethods: ['cash'],
    });
    const pendingSummary = summaries.get(pendingId);
    expect(pendingSummary).toMatchObject({
      branchName: 'List Main',
      cashierName: 'List Cashier',
      itemCount: 1,
      paymentMethods: [],
    });
  });

  it('repeated list reads never mutate any sale, payment, or inventory state — purely a query', async () => {
    const id = await makeSale(branchId, 'list-readonly-1', true);
    const before = await sales.sale(companyId, [branchId, otherBranchId], id);
    await sales.listSales(companyId, [branchId, otherBranchId], { limit: 50 });
    await sales.listSales(companyId, [branchId, otherBranchId], { limit: 50 });
    await sales.listSummaries(companyId, [id]);
    const after = await sales.sale(companyId, [branchId, otherBranchId], id);
    expect(after.sale.version).toBe(before.sale.version);
    expect(after.sale.status).toBe(before.sale.status);
  });
});
