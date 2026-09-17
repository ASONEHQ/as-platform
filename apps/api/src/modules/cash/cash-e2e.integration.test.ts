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

/** TASK 16.8 §15 — the exact commercial end-to-end scenario the task spec
 * demands, run for real against PostgreSQL: Sucursal A, Caja 1, an
 * authorized cashier, $1,000 opening float, a $580 cash sale, a $300 card
 * sale (which must NEVER touch the drawer), a $100 external income, a $50
 * expense, and a $200 withdrawal — then a real denomination count and a
 * real close, verifying every figure the backend actually computes (never
 * asserting a number this test invented without first confirming the
 * model's own real semantics — see the formula comment below). Finishes
 * by proving three real rejections: a movement after close, a second
 * close, and a cross-tenant movement attempt. */
const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;
const migrationsPath = resolve(import.meta.dirname, '../../../../../packages/database/drizzle');

integration('PostgreSQL cash register end-to-end commercial scenario (TASK 16.8 §15)', { concurrent: false }, () => {
  let database: DatabaseClient;
  let cash: CashService;
  let sales: SalesService;
  let payments: PaymentService;
  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const branchId = randomUUID();
  const otherCompanyBranchId = randomUUID();
  const userId = randomUUID();
  const otherCompanyUserId = randomUUID();
  const cashProductId = randomUUID();
  const cardProductId = randomUUID();
  const context = {
    companyId,
    actorId: userId,
    requestId: 'cash-e2e-request',
    correlationId: 'cash-e2e-correlation',
    timestamp: new Date('2026-09-17T09:00:00.000Z'),
  };
  const otherCompanyContext = { ...context, companyId: otherCompanyId, actorId: otherCompanyUserId };
  const branchIds = [branchId];
  const otherCompanyBranchIds = [otherCompanyBranchId];

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
    database = createDatabaseClient({ connectionString: databaseUrl, applicationName: 'asone-cash-e2e' });
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
       values($1,'E2E Park','E2E Park',$2,'active','UTC','MXN','es-MX'),
             ($3,'Other E2E Park','Other E2E Park',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `cash-e2e-${companyId}`, otherCompanyId, `cash-e2e-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'Sucursal A','A','active','UTC'),($3,$4,'Other Branch','OTHER','active','UTC')`,
      [branchId, companyId, otherCompanyBranchId, otherCompanyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'E2E Cajero','active'),($3,$4,$4,'Other Co User','active')`,
      [userId, `cash-e2e-${userId}@example.test`, otherCompanyUserId, `cash-e2e-${otherCompanyUserId}@example.test`],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status) values($1,$2,$3,'active'),($4,$5,$6,'active')`,
      [randomUUID(), companyId, userId, randomUUID(), otherCompanyId, otherCompanyUserId],
    );
    // Two IVA_EXEMPT products (0% tax) so the sale totals are exact round
    // numbers ($580/$300) matching the task's own scenario without also
    // needing to model tax computation in this scenario.
    await database.pool.query(
      `insert into products
       (id,company_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
       values($1,$2,'E2E-CASH-ITEM','e2e-cash-item','E2E Cash Item','simple',false,'IVA_EXEMPT','active',$3,$3),
             ($4,$2,'E2E-CARD-ITEM','e2e-card-item','E2E Card Item','simple',false,'IVA_EXEMPT','active',$3,$3)`,
      [cashProductId, companyId, userId, cardProductId],
    );
    await database.pool.query(
      `insert into product_prices (id,company_id,product_id,amount,currency_code,status,created_by,updated_by)
       values($1,$2,$3,'580.0000','MXN','active',$4,$4),($5,$2,$6,'300.0000','MXN','active',$4,$4)`,
      [randomUUID(), companyId, cashProductId, userId, randomUUID(), cardProductId],
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
    await database.pool.query('delete from product_prices where company_id=$1', [companyId]);
    await database.pool.query('delete from products where company_id=$1', [companyId]);
    await database.pool.query('delete from company_memberships where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from branches where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from companies where id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from users where id in ($1,$2)', [userId, otherCompanyUserId]);
    await database.close();
  });

  it('carries a full shift through open, cash+card sales, external income, expense, withdrawal, denomination count, and close with exact real numbers', async () => {
    // 1. Abrir turno con $1,000 fondo inicial.
    const register = await cash.createRegister(context, branchIds, 'e2e-register', {
      branchId,
      code: 'CAJA-1',
      name: 'Caja 1',
    });
    const opened = await cash.openSession(context, branchIds, 'e2e-open', {
      cashRegisterId: register.value.id,
      openingAmount: '1000.0000',
    });
    expect(opened.value).toMatchObject({ status: 'open', openingAmount: '1000.0000' });

    // 2. Venta efectivo $580 — a real sale settled by a real cash payment.
    const cashSale = await sales.createSale(context, branchIds, 'e2e-cash-sale-create', {
      branchId,
      items: [{ productId: cashProductId, quantity: '1' }],
    });
    expect(cashSale.value.sale.total).toBe('580.0000');
    const cashPayment = await payments.createCashPayment(context, branchIds, 'e2e-cash-sale-pay', {
      saleId: cashSale.value.sale.id,
      tenderedAmount: '580.00',
      cashRegisterId: register.value.id,
    });
    expect(cashPayment.value.sale.status).toBe('completed');

    // 3. Venta tarjeta $300 — must settle for real but NEVER touch the
    // cash drawer (no cash_sale movement, no effect on expected cash).
    // `card_manual` (never `card_terminal`) deliberately avoids any real
    // payment-terminal/Mercado Pago fixture — this task must not touch or
    // exercise that paused integration at all; `card_manual` proves the
    // exact same "never posts to cash" invariant without it.
    const cardSale = await sales.createSale(context, branchIds, 'e2e-card-sale-create', {
      branchId,
      items: [{ productId: cardProductId, quantity: '1' }],
    });
    expect(cardSale.value.sale.total).toBe('300.0000');
    const cardPaymentCreated = await payments.createPayment(context, branchIds, 'e2e-card-sale-pay', {
      branchId,
      saleId: cardSale.value.sale.id,
      paymentMethod: 'card_manual',
      amount: '300.00',
      currencyCode: 'MXN',
    });
    // `card_manual` has no provider dispatch — `createPayment` leaves the
    // attempt in `created`. The cashier's own confirmation that the card
    // slip approved is the real-world approval event, recorded exactly
    // the same way a (future) real terminal webhook would: a separate
    // `transitionAttempt(..., { status: 'approved' })` call, which is
    // the only path that captures the payment and settles the sale.
    await payments.transitionAttempt(
      context,
      branchIds,
      cardPaymentCreated.value.attempt.id,
      'e2e-card-sale-approve',
      { status: 'approved' },
    );
    const cardSaleAfterPayment = await sales.sale(companyId, branchIds, cardSale.value.sale.id);
    expect(cardSaleAfterPayment.sale.status).toBe('completed');

    // 4. Ingreso externo $100.
    await cash.createMovement(context, branchIds, 'e2e-external-income', opened.value.id, {
      movementType: 'cash_in',
      amount: '100.0000',
      reasonCode: 'external_income',
      category: 'external_income',
    });
    // 5. Gasto $50.
    await cash.createMovement(context, branchIds, 'e2e-expense', opened.value.id, {
      movementType: 'cash_out',
      amount: '50.0000',
      reasonCode: 'expense',
      category: 'expense',
    });
    // 6. Retiro $200.
    await cash.createMovement(context, branchIds, 'e2e-withdrawal', opened.value.id, {
      movementType: 'cash_out',
      amount: '200.0000',
      reasonCode: 'withdrawal',
      category: 'withdrawal',
    });

    // Efectivo esperado, per the real model's own formula (confirmed by
    // direct audit of `cash.service.ts` before writing this assertion —
    // never asserted blind): opening + Σ(cash_sale, cash_in) −
    // Σ(cash_out). Card sales never enter this sum at all.
    // 1000 + 580 (cash sale) + 100 (external income) − 50 (expense) − 200
    // (withdrawal) = 1430. The $300 card sale is correctly absent.
    const summaryBeforeClose = await cash.summary(companyId, branchIds, opened.value.id);
    expect(summaryBeforeClose).toMatchObject({
      openingAmount: '1000.0000',
      cashSalesTotal: '580.0000',
      cashSalesCount: 1,
      externalIncomeTotal: '100.0000',
      expenseTotal: '50.0000',
      withdrawalTotal: '200.0000',
      expectedCash: '1430.0000',
    });

    // 7. Conteo físico por denominaciones — 1x$1000 + 2x$200 + 1x$20 +
    // 1x$10 = 1430, an exact match (cuadrado).
    const closed = await cash.closeSession(context, branchIds, 'e2e-close', opened.value.id, {
      declaredClosingAmount: '1430.0000',
      denominationCounts: [
        { value: '1000.0000', quantity: 1 },
        { value: '200.0000', quantity: 2 },
        { value: '20.0000', quantity: 1 },
        { value: '10.0000', quantity: 1 },
      ],
    });

    // 8. Verificar: estado closed, expected/counted/difference, payment
    // totals, movements, persistence via an independent re-query.
    expect(closed.value).toMatchObject({
      status: 'closed',
      expectedClosingAmount: '1430.0000',
      declaredClosingAmount: '1430.0000',
      discrepancyAmount: '0.0000',
    });
    expect(closed.value.denominationCounts).toEqual([
      { value: '1000.0000', quantity: 1 },
      { value: '200.0000', quantity: 2 },
      { value: '20.0000', quantity: 1 },
      { value: '10.0000', quantity: 1 },
    ]);

    const movements = await cash.listMovements(companyId, branchIds, opened.value.id, { limit: 20 });
    const movementTypes = movements.items.map((item) => item.movementType).sort();
    // opening_float (open) + cash_sale ($580) + cash_in (external income
    // $100) + cash_out (expense $50) + cash_out (withdrawal $200) — the
    // $300 card sale never posts a movement at all.
    expect(movementTypes).toEqual(['cash_in', 'cash_out', 'cash_out', 'cash_sale', 'opening_float'].sort());

    // History — a fresh, independent database client, simulating a
    // completely separate process/request re-reading persisted state.
    const freshDatabase = createDatabaseClient({ connectionString: databaseUrl!, applicationName: 'asone-cash-e2e-reread' });
    try {
      const freshCash = new CashService(new CashRepository(freshDatabase));
      const history = await freshCash.listSessions(companyId, branchIds, { limit: 20, branchId });
      const historyEntry = history.items.find((item) => item.id === opened.value.id);
      expect(historyEntry).toMatchObject({
        status: 'closed',
        expectedClosingAmount: '1430.0000',
        declaredClosingAmount: '1430.0000',
        discrepancyAmount: '0.0000',
      });
      const rereadSession = await freshCash.session(companyId, branchIds, opened.value.id);
      expect(rereadSession.status).toBe('closed');
      // Audit — real audit_log rows for every mutation in this shift.
      const auditRows = await freshDatabase.pool.query<{ action: string }>(
        `select action from audit_log where company_id=$1 and entity_id=$2 order by occurred_at`,
        [companyId, opened.value.id],
      );
      expect(auditRows.rows.map((row) => row.action)).toEqual(
        expect.arrayContaining(['cash_session.opened', 'cash_session.closed']),
      );
    } finally {
      await freshDatabase.close();
    }

    // 9. Intentar: nuevo gasto sobre turno cerrado — rechazado.
    await expect(
      cash.createMovement(context, branchIds, 'e2e-expense-after-close', opened.value.id, {
        movementType: 'cash_out',
        amount: '10.0000',
        reasonCode: 'too_late',
      }),
    ).rejects.toMatchObject({ code: 'cash_session_closed' });

    // 10. Intentar: segundo cierre — rechazado.
    await expect(
      cash.closeSession(context, branchIds, 'e2e-second-close', opened.value.id, { declaredClosingAmount: '1430.0000' }),
    ).rejects.toMatchObject({ code: 'cash_session_closed' });

    // 11. Intentar: movimiento cross-tenant — rechazado. The session
    // genuinely does not exist for the other company's own scope (never a
    // cross-tenant row leak, never a weaker/different rejection than any
    // other not-found resource).
    await expect(
      cash.createMovement(otherCompanyContext, otherCompanyBranchIds, 'e2e-cross-tenant', opened.value.id, {
        movementType: 'cash_in',
        amount: '1.0000',
        reasonCode: 'cross_tenant_attempt',
      }),
    ).rejects.toMatchObject({ code: 'resource_not_found' });
  });
});
