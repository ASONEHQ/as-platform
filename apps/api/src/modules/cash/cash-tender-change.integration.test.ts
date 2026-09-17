import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';

import { PaymentRepository } from '../payments/payments.repository.js';
import { PaymentService } from '../payments/payments.service.js';
import { MercadoPagoClient } from '../payments/providers/mercado-pago.client.js';
import { MercadoPagoPointProvider } from '../payments/providers/mercado-pago.provider.js';
import { SalesRepository } from '../sales/sales.repository.js';
import { SalesService } from '../sales/sales.service.js';
import { CashRepository } from './cash.repository.js';
import { CashService } from './cash.service.js';

/** TASK 16.8A — the task's own worked example, run for real against
 * PostgreSQL: a $500.0000 opening float, a $58.00 cash sale tendered with
 * $100.00 (change $42.00). This is the one genuine coverage gap TASK
 * 16.8's own E2E test (`cash-e2e.integration.test.ts`) left behind — that
 * scenario's cash leg was tendered EXACTLY ($580.00 for a $580.0000
 * total), so it never actually proved the open question this task exists
 * to answer: after an overpaid cash sale, does the register's own
 * expected-cash figure reflect the SALE TOTAL (correct) or the TENDERED
 * AMOUNT (a real bug — it would silently fabricate $42 of cash that was
 * physically handed back to the customer as change)? Every individual
 * behavior here (exact tender, overpayment, insufficient tender,
 * inventory consumption, idempotent replay never double-consuming) is
 * already covered elsewhere (`payments.integration.test.ts`'s "cash
 * payments (TASK 12.5A)" describe; `sales.integration.test.ts`'s
 * inventory-consumption describe) — this file exists ONLY for the one
 * combination those files don't already prove: the cash SESSION's own
 * `summary()` after a real overpaid cash sale. */
const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;
const migrationsPath = resolve(import.meta.dirname, '../../../../../packages/database/drizzle');

integration('PostgreSQL cash session expected-cash after a real tendered/change cash sale (TASK 16.8A)', () => {
  let database: DatabaseClient;
  let cash: CashService;
  let sales: SalesService;
  let payments: PaymentService;
  const companyId = randomUUID();
  const branchId = randomUUID();
  const userId = randomUUID();
  const productId = randomUUID();
  const context = {
    companyId,
    actorId: userId,
    requestId: 'cash-tender-change-request',
    correlationId: 'cash-tender-change-correlation',
    timestamp: new Date('2026-09-17T09:00:00.000Z'),
  };
  const branchIds = [branchId];

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
    database = createDatabaseClient({ connectionString: databaseUrl, applicationName: 'asone-cash-tender-change' });
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
       values($1,'Tender Change Park','Tender Change Park',$2,'active','UTC','MXN','es-MX')`,
      [companyId, `cash-tender-change-${companyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone) values($1,$2,'Sucursal A','A','active','UTC')`,
      [branchId, companyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status) values($1,$2,$2,'Cajero Tender','active')`,
      [userId, `cash-tender-change-${userId}@example.test`],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status) values($1,$2,$3,'active')`,
      [randomUUID(), companyId, userId],
    );
    // IVA_EXEMPT so the sale total is an exact $58.00 — this scenario is
    // about tender/change/expected-cash arithmetic, not tax computation.
    await database.pool.query(
      `insert into products
       (id,company_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
       values($1,$2,'TENDER-ITEM','tender-item','Tender Change Item','simple',false,'IVA_EXEMPT','active',$3,$3)`,
      [productId, companyId, userId],
    );
    await database.pool.query(
      `insert into product_prices (id,company_id,product_id,amount,currency_code,status,created_by,updated_by)
       values($1,$2,$3,'58.0000','MXN','active',$4,$4)`,
      [randomUUID(), companyId, productId, userId],
    );

    const cashRepository = new CashRepository(database);
    cash = new CashService(cashRepository);
    const salesRepository = new SalesRepository(database);
    sales = new SalesService(salesRepository);
    const paymentRepository = new PaymentRepository(database);
    const mercadoPagoProvider = new MercadoPagoPointProvider(
      new MercadoPagoClient({ accessToken: undefined, apiBaseUrl: 'https://api.mercadopago.com' }),
    );
    payments = new PaymentService(paymentRepository, salesRepository, mercadoPagoProvider, cashRepository);
  });

  afterAll(async () => {
    await database.pool.query('delete from payment_attempts where company_id=$1', [companyId]);
    await database.pool.query('delete from payments where company_id=$1', [companyId]);
    await database.pool.query('delete from sale_items where company_id=$1', [companyId]);
    await database.pool.query('delete from sales where company_id=$1', [companyId]);
    await database.pool.query('delete from cash_movements where company_id=$1', [companyId]);
    await database.pool.query('delete from cash_sessions where company_id=$1', [companyId]);
    await database.pool.query('delete from cash_registers where company_id=$1', [companyId]);
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

  it('an overpaid $58 cash sale ($100 tendered, $42 change) increases expected cash by exactly the $58 sale total — never by the $100 tendered, and never anything else', async () => {
    const register = await cash.createRegister(context, branchIds, 'tender-change-register', {
      branchId,
      code: 'CAJA-1',
      name: 'Caja 1',
    });
    const opened = await cash.openSession(context, branchIds, 'tender-change-open', {
      cashRegisterId: register.value.id,
      openingAmount: '500.0000',
    });
    expect(opened.value).toMatchObject({ status: 'open', openingAmount: '500.0000' });

    const sale = await sales.createSale(context, branchIds, 'tender-change-sale-create', {
      branchId,
      items: [{ productId, quantity: '1' }],
    });
    expect(sale.value.sale.total).toBe('58.0000');

    const paid = await payments.createCashPayment(context, branchIds, 'tender-change-sale-pay', {
      saleId: sale.value.sale.id,
      tenderedAmount: '100.00',
      cashRegisterId: register.value.id,
    });
    // The worked example's own numbers, confirmed against the real
    // backend response — never asserted blind.
    expect(paid.value.tenderedAmount).toBe('100.0000');
    expect(paid.value.changeAmount).toBe('42.0000');
    expect(paid.value.payment.amount).toBe('58.0000');
    expect(paid.value.sale.status).toBe('completed');

    const summary = await cash.summary(companyId, branchIds, opened.value.id);
    expect(summary.cashSalesTotal).toBe('58.0000');
    expect(summary.cashSalesCount).toBe(1);
    // The physical drawer receives $100 and gives $42 back — net +$58.
    // $500 opening + $58 = $558.0000. NOT $600 (opening + tendered), NOT
    // $542 (opening + change), NOT $658 (opening + tendered + sale).
    expect(summary.expectedCash).toBe('558.0000');

    // The drawer's own posted fact is the $58 sale total, never the $100
    // tendered — a second, independent confirmation via the raw
    // `cash_movements` row itself, not just the derived summary.
    const movement = await database.pool.query<{ amount: string; movement_type: string }>(
      `select amount::text, movement_type from cash_movements
       where company_id=$1 and cash_session_id=$2 and movement_type='cash_sale'`,
      [companyId, opened.value.id],
    );
    expect(movement.rows).toEqual([expect.objectContaining({ amount: '58.0000', movement_type: 'cash_sale' })]);
  });
});
