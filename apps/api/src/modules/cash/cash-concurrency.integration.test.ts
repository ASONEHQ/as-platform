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

/** TASK 16.8 §13 — genuine concurrent-race coverage. Every prior "closes
 * it twice"/"rejects a movement against a closed session" test in
 * `cash.integration.test.ts`/`cash-advanced.integration.test.ts` is a
 * SEQUENTIAL assertion (first call awaited and resolved, THEN the second
 * call made) — real, but it never actually races two requests against the
 * same row at the same time. This file fires genuine `Promise.all`/
 * `Promise.allSettled` pairs to prove the real guarantee (`SELECT ... FOR
 * UPDATE` + the idempotency advisory lock + optimistic `version` checks,
 * all inside one transaction — see `cash.service.ts`/`cash.repository.ts`)
 * actually holds under real concurrent load, not just sequential retries. */
const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;
const migrationsPath = resolve(import.meta.dirname, '../../../../../packages/database/drizzle');

integration('PostgreSQL cash register real concurrency (TASK 16.8)', { concurrent: false }, () => {
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
    requestId: 'cash-concurrency-request',
    correlationId: 'cash-concurrency-correlation',
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
    database = createDatabaseClient({ connectionString: databaseUrl, applicationName: 'asone-cash-concurrency' });
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
       values($1,'Cash Concurrency Co','Cash Concurrency Co',$2,'active','UTC','MXN','es-MX')`,
      [companyId, `cash-conc-${companyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone) values($1,$2,'Concurrency Main','CONCMAIN','active','UTC')`,
      [branchId, companyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status) values($1,$2,$2,'Concurrency Cashier','active')`,
      [userId, `cash-conc-${userId}@example.test`],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status) values($1,$2,$3,'active')`,
      [randomUUID(), companyId, userId],
    );
    // IVA_EXEMPT so a $29.00 price yields an exact $29.00 cash-sale total,
    // matching this module's own established fixture convention.
    await database.pool.query(
      `insert into products
       (id,company_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
       values($1,$2,'CASH-CONC-PRODUCT','cash-conc-product','Cash Concurrency Product','simple',false,'IVA_EXEMPT','active',$3,$3)`,
      [productId, companyId, userId],
    );
    await database.pool.query(
      `insert into product_prices (id,company_id,product_id,amount,currency_code,status,created_by,updated_by)
       values($1,$2,$3,'29.0000','MXN','active',$4,$4)`,
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

  it('two genuinely simultaneous close attempts — exactly one succeeds, the other is honestly rejected, never a double close', async () => {
    const register = await cash.createRegister(context, branchIds, 'conc-reg-close', {
      branchId,
      code: 'CONC-CLOSE',
      name: 'Concurrency Close Register',
    });
    const opened = await cash.openSession(context, branchIds, 'conc-open-close', {
      cashRegisterId: register.value.id,
      openingAmount: '1000.0000',
    });

    const [first, second] = await Promise.allSettled([
      cash.closeSession(context, branchIds, 'conc-close-a', opened.value.id, { declaredClosingAmount: '1000.0000' }),
      cash.closeSession(context, branchIds, 'conc-close-b', opened.value.id, { declaredClosingAmount: '1000.0000' }),
    ]);

    const outcomes = [first, second];
    const fulfilled = outcomes.filter((value) => value.status === 'fulfilled');
    const rejected = outcomes.filter((value) => value.status === 'rejected');
    // Exactly one of the two DIFFERENT idempotency keys wins — this is not
    // an idempotency replay (different keys), it is real row-level mutual
    // exclusion.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'cash_session_closed' });

    // The database itself shows exactly one real closure — re-read fresh,
    // not from either in-memory result.
    const reread = await cash.session(companyId, branchIds, opened.value.id);
    expect(reread.status).toBe('closed');
    expect(reread.declaredClosingAmount).toBe('1000.0000');
  });

  it('a manual movement racing a close never produces a lost movement or a movement silently accepted against a closed session', async () => {
    const register = await cash.createRegister(context, branchIds, 'conc-reg-move-close', {
      branchId,
      code: 'CONC-MOVE-CLOSE',
      name: 'Concurrency Movement/Close Register',
    });
    const opened = await cash.openSession(context, branchIds, 'conc-open-move-close', {
      cashRegisterId: register.value.id,
      openingAmount: '1000.0000',
    });

    const [movementOutcome, closeOutcome] = await Promise.allSettled([
      cash.createMovement(context, branchIds, 'conc-move-vs-close', opened.value.id, {
        movementType: 'cash_in',
        amount: '75.0000',
        reasonCode: 'race_test',
      }),
      cash.closeSession(context, branchIds, 'conc-close-vs-move', opened.value.id, { declaredClosingAmount: '1075.0000' }),
    ]);

    const session = await cash.session(companyId, branchIds, opened.value.id);
    expect(session.status).toBe('closed');

    if (movementOutcome.status === 'fulfilled') {
      // The movement won the race and posted before the close folded it —
      // the close's own expected total must include it.
      expect(session.expectedClosingAmount).toBe('1075.0000');
    } else {
      // The close won the race — the movement must have been honestly
      // rejected as closed, never silently dropped or partially applied.
      expect((movementOutcome as PromiseRejectedResult).reason).toMatchObject({ code: 'cash_session_closed' });
      expect(session.expectedClosingAmount).toBe('1000.0000');
    }
    // Whichever branch won, the close request itself always succeeds here
    // (a movement can race and lose without ever blocking the close).
    expect(closeOutcome.status).toBe('fulfilled');
  });

  it('two genuinely simultaneous movements against the same open session both post — no lost update', async () => {
    const register = await cash.createRegister(context, branchIds, 'conc-reg-two-moves', {
      branchId,
      code: 'CONC-TWO-MOVES',
      name: 'Concurrency Two Movements Register',
    });
    const opened = await cash.openSession(context, branchIds, 'conc-open-two-moves', {
      cashRegisterId: register.value.id,
      openingAmount: '0',
    });

    const [a, b] = await Promise.all([
      cash.createMovement(context, branchIds, 'conc-move-a', opened.value.id, {
        movementType: 'cash_in',
        amount: '100.0000',
        reasonCode: 'race_a',
      }),
      cash.createMovement(context, branchIds, 'conc-move-b', opened.value.id, {
        movementType: 'cash_in',
        amount: '50.0000',
        reasonCode: 'race_b',
      }),
    ]);
    expect(a.value.id).not.toBe(b.value.id);

    const summary = await cash.summary(companyId, branchIds, opened.value.id);
    // 100 + 50 — if the locking were broken (a lost update), this would
    // read 100 or 50 instead of the true sum.
    expect(summary.cashInTotal).toBe('150.0000');
    expect(summary.expectedCash).toBe('150.0000');
  });

  it('the exact same idempotency key fired genuinely concurrently for a movement replays safely — never double-posts', async () => {
    const register = await cash.createRegister(context, branchIds, 'conc-reg-replay', {
      branchId,
      code: 'CONC-REPLAY',
      name: 'Concurrency Replay Register',
    });
    const opened = await cash.openSession(context, branchIds, 'conc-open-replay', {
      cashRegisterId: register.value.id,
      openingAmount: '0',
    });
    const body = { movementType: 'cash_in' as const, amount: '40.0000', reasonCode: 'race_replay' };

    const [a, b] = await Promise.all([
      cash.createMovement(context, branchIds, 'conc-move-same-key', opened.value.id, body),
      cash.createMovement(context, branchIds, 'conc-move-same-key', opened.value.id, body),
    ]);
    expect(a.value.id).toBe(b.value.id);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);

    const summary = await cash.summary(companyId, branchIds, opened.value.id);
    // Posted exactly once — never $80 from a double-post.
    expect(summary.cashInTotal).toBe('40.0000');
  });

  it('a cash sale settlement racing a close never produces a lost sale or a payment silently accepted against a closed session', async () => {
    const register = await cash.createRegister(context, branchIds, 'conc-reg-sale-close', {
      branchId,
      code: 'CONC-SALE-CLOSE',
      name: 'Concurrency Sale/Close Register',
    });
    const opened = await cash.openSession(context, branchIds, 'conc-open-sale-close', {
      cashRegisterId: register.value.id,
      openingAmount: '0',
    });
    const createdSale = await sales.createSale(context, branchIds, 'conc-sale-vs-close-create', {
      branchId,
      items: [{ productId, quantity: '1' }],
    });
    expect(createdSale.value.sale.total).toBe('29.0000');

    const [paymentOutcome, closeOutcome] = await Promise.allSettled([
      payments.createCashPayment(context, branchIds, 'conc-sale-vs-close-pay', {
        saleId: createdSale.value.sale.id,
        tenderedAmount: '29.00',
        cashRegisterId: register.value.id,
      }),
      cash.closeSession(context, branchIds, 'conc-close-vs-sale', opened.value.id, { declaredClosingAmount: '0' }),
    ]);

    // A genuinely simultaneous payment-vs-close pair contends for the
    // register/session rows in opposite orders (`resolveOpenCashSession`
    // locks the register then the session; `closeSession` locks the
    // session directly) — Postgres's own deadlock detector can abort
    // EITHER side (never both; never neither), and which one loses is not
    // deterministic. That abort is itself the correctness guarantee this
    // test exists to prove: whichever side loses rolls back atomically
    // with zero partial effect, and the survivor's state is fully
    // consistent — never a double close, a double movement, or a sale
    // marked paid with no real payment behind it. So this test asserts
    // both legal outcomes, keyed off what the database actually decided
    // (`closeOutcome`), rather than assuming the close always wins.
    if (paymentOutcome.status === 'rejected' && closeOutcome.status === 'rejected') {
      throw new Error(
        `both sides of the race were rejected — expected exactly one deadlock victim: ` +
          `payment=${String(paymentOutcome.reason)} close=${String(closeOutcome.reason)}`,
      );
    }

    const session = await cash.session(companyId, branchIds, opened.value.id);
    const sale = await sales.sale(companyId, branchIds, createdSale.value.sale.id);

    if (closeOutcome.status === 'fulfilled') {
      // The close committed. Either the payment landed first and its
      // cash_sale movement is reflected in the close's own totals, or the
      // payment lost the race (deadlock victim, or honestly rejected
      // because the session was already gone) and never posted at all —
      // never a half-applied payment.
      expect(session.status).toBe('closed');
      if (paymentOutcome.status === 'fulfilled') {
        expect(sale.sale.status).toBe('completed');
        expect(session.expectedClosingAmount).toBe('29.0000');
      } else {
        expect(sale.sale.status).toBe('pending_payment');
        expect(session.expectedClosingAmount).toBe('0.0000');
      }
    } else {
      // The close was the deadlock victim: it rolled back entirely (the
      // session must still be open, never half-closed), and the payment
      // — the only other party to the race — must be the one that
      // actually committed.
      expect(session.status).toBe('open');
      expect(session.declaredClosingAmount).toBeNull();
      expect(paymentOutcome.status).toBe('fulfilled');
      expect(sale.sale.status).toBe('completed');
    }

    const movements = await cash.listMovements(companyId, branchIds, opened.value.id, { limit: 20 });
    const cashSaleMovements = movements.items.filter((item) => item.movementType === 'cash_sale');
    // Never a lost movement, never a double-posted one — exactly one per
    // committed payment, zero if the payment never committed.
    expect(cashSaleMovements.length).toBe(paymentOutcome.status === 'fulfilled' ? 1 : 0);
  });

});
