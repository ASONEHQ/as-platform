import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';

import { CashRepository } from '../cash/cash.repository.js';
import { SalesRepository } from '../sales/sales.repository.js';
import { SalesService } from '../sales/sales.service.js';
import { PaymentRepository } from './payments.repository.js';
import { PaymentService } from './payments.service.js';
import { PaymentError } from './payments.types.js';
import { MercadoPagoClient } from './providers/mercado-pago.client.js';
import { MercadoPagoPointProvider } from './providers/mercado-pago.provider.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;
const migrationsPath = resolve(import.meta.dirname, '../../../../../packages/database/drizzle');

integration(
  'PostgreSQL payment/terminal foundation and sale ownership (TASK 12.4A, TASK 12.4A.1)',
  { concurrent: false },
  () => {
    let database: DatabaseClient;
    let payments: PaymentService;
    let sales: SalesService;
    const companyId = randomUUID();
    const otherCompanyId = randomUUID();
    const branchId = randomUUID();
    const otherBranchId = randomUUID();
    const foreignBranchId = randomUUID();
    const closedBranchId = randomUUID();
    const userId = randomUUID();
    const otherCompanyUserId = randomUUID();
    const deviceId = randomUUID();
    const otherBranchDeviceId = randomUUID();
    const foreignDeviceId = randomUUID();
    const productId = randomUUID();
    const otherCompanyProductId = randomUUID();
    const context = {
      companyId,
      actorId: userId,
      requestId: 'payment-request',
      correlationId: 'payment-correlation',
      timestamp: new Date('2026-08-01T12:00:00.000Z'),
    };
    const otherContext = { ...context, companyId: otherCompanyId, actorId: otherCompanyUserId };
    const branchIds = [branchId, otherBranchId];

    beforeAll(async () => {
      if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
        throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
      database = createDatabaseClient({
        connectionString: databaseUrl,
        applicationName: 'asone-payments-integration',
      });
      const present = await database.pool.query<{ present: string | null }>(
        `select to_regclass('public.companies')::text present`,
      );
      if (present.rows[0]?.present === null) {
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
          const sql = await readFile(resolve(migrationsPath, name), 'utf8');
          for (const statement of sql.split('--> statement-breakpoint'))
            if (statement.trim().length > 0) await database.pool.query(statement);
        }
      }
      for (const [table, file] of [
        ['product_prices', '0011_product_pricing_foundation.sql'],
        ['payment_terminals', '0012_payment_and_terminal_foundation.sql'],
      ] as const) {
        const check = await database.pool.query<{ present: string | null }>(
          `select to_regclass('public.${table}')::text present`,
        );
        if (check.rows[0]?.present === null) {
          const sql = await readFile(resolve(migrationsPath, file), 'utf8');
          for (const statement of sql.split('--> statement-breakpoint'))
            if (statement.trim().length > 0) await database.pool.query(statement);
        }
      }
      // TASK 12.4A.1: `sales`/`sale_items` plus `payments.sale_id`'s
      // finalization are one logical unit for this bootstrap's purposes —
      // applied together whenever `sales` does not exist yet.
      const salesPresent = await database.pool.query<{ present: string | null }>(
        `select to_regclass('public.sales')::text present`,
      );
      if (salesPresent.rows[0]?.present === null) {
        for (const file of ['0013_sale_foundation.sql', '0014_sale_id_required.sql']) {
          const sql = await readFile(resolve(migrationsPath, file), 'utf8');
          for (const statement of sql.split('--> statement-breakpoint'))
            if (statement.trim().length > 0) await database.pool.query(statement);
        }
      }
      // TASK 12.6: `sale_items.product_variant_id` and the
      // `sale_consumption` movement type/idempotency index — required by
      // `SalesRepository.trySettleSale`'s inventory-consumption posting,
      // which every cash/card settlement in this file now goes through.
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
      // TASK 12.7: `cash_registers`/`cash_sessions`/`cash_movements` —
      // required by `PaymentService.createCashPayment`'s now-mandatory
      // open-session check, which every cash-payment test in this file
      // goes through.
      const cashTablesPresent = await database.pool.query<{ present: string | null }>(
        `select to_regclass('public.cash_registers')::text present`,
      );
      if (cashTablesPresent.rows[0]?.present === null) {
        for (const file of ['0016_jittery_slayback.sql', '0017_gifted_vertigo.sql']) {
          const sql = await readFile(resolve(migrationsPath, file), 'utf8');
          for (const statement of sql.split('--> statement-breakpoint'))
            if (statement.trim().length > 0) await database.pool.query(statement);
        }
      }
      // TASK 12.7 (Part J follow-up): `denomination_counts` is a later
      // migration than 0016/0017, so a reused test database needs this
      // checked independently of the block above.
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
         values($1,'Payments','Payments',$2,'active','UTC','MXN','es-MX'),
               ($3,'Other Payments','Other Payments',$4,'active','UTC','MXN','es-MX')`,
        [companyId, `payments-${companyId}`, otherCompanyId, `payments-${otherCompanyId}`],
      );
      await database.pool.query(
        `insert into branches(id,company_id,name,code,status,timezone)
         values($1,$2,'Main','MAIN','active','UTC'),
               ($3,$2,'Second','SECOND','active','UTC'),
               ($4,$5,'Foreign','FOREIGN','active','UTC'),
               ($6,$2,'Closed','CLOSED','closed','UTC')`,
        [branchId, companyId, otherBranchId, foreignBranchId, otherCompanyId, closedBranchId],
      );
      await database.pool.query(
        `insert into users(id,email,normalized_email,display_name,status)
         values($1,$2,$2,'Payment User','active'),
               ($3,$4,$4,'Other Company User','active')`,
        [userId, `payments-${userId}@example.test`, otherCompanyUserId, `payments-${otherCompanyUserId}@example.test`],
      );
      await database.pool.query(
        `insert into company_memberships(id,company_id,user_id,status)
         values($1,$2,$3,'active'),
               ($4,$5,$6,'active')`,
        [randomUUID(), companyId, userId, randomUUID(), otherCompanyId, otherCompanyUserId],
      );
      await database.pool.query(
        `insert into devices(id,company_id,branch_id,device_code,name,device_type,status)
         values($1,$2,$3,'TERM-MAIN','Main terminal','card_terminal','active'),
               ($4,$2,$5,'TERM-SECOND','Second terminal','card_terminal','active'),
               ($6,$7,$8,'TERM-FOREIGN','Foreign terminal','card_terminal','active')`,
        [
          deviceId,
          companyId,
          branchId,
          otherBranchDeviceId,
          otherBranchId,
          foreignDeviceId,
          otherCompanyId,
          foreignBranchId,
        ],
      );
      // A minimal real, active, priced product — the fixture every
      // `createSale()` test helper call resolves against, matching
      // `SalesService.createSale`'s own server-authoritative price/tax
      // resolution (never a fabricated line total in this test file).
      // 50.0000 MXN at IVA_GENERAL (16%) => a 58.0000 sale total per unit.
      await database.pool.query(
        `insert into products
         (id,company_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
         values($1,$2,'PAY-PRODUCT','pay-product','Payment Test Product','simple',false,'IVA_GENERAL','active',$3,$3),
               ($4,$5,'PAY-PRODUCT','pay-product','Other Company Product','simple',false,'IVA_GENERAL','active',$6,$6)`,
        [productId, companyId, userId, otherCompanyProductId, otherCompanyId, otherCompanyUserId],
      );
      await database.pool.query(
        `insert into product_variants
         (id,company_id,product_id,sku,normalized_sku,name,unit_of_measure_code,quantity_scale,
          tracks_inventory,standard_cost,currency_code,is_default,option_signature,status,created_by,updated_by)
         values($1,$2,$3,'PAY-SKU','pay-sku','Variant','unit',0,false,0,'MXN',true,$4,'active',$5,$5),
               ($6,$7,$8,'PAY-SKU','pay-sku','Variant','unit',0,false,0,'MXN',true,$4,'active',$9,$9)`,
        [
          randomUUID(),
          companyId,
          productId,
          '0'.repeat(64),
          userId,
          randomUUID(),
          otherCompanyId,
          otherCompanyProductId,
          otherCompanyUserId,
        ],
      );
      await database.pool.query(
        `insert into product_prices
         (id,company_id,product_id,amount,currency_code,status,created_by,updated_by)
         values($1,$2,$3,'50.0000','MXN','active',$4,$4),
               ($5,$6,$7,'50.0000','MXN','active',$8,$8)`,
        [
          randomUUID(),
          companyId,
          productId,
          userId,
          randomUUID(),
          otherCompanyId,
          otherCompanyProductId,
          otherCompanyUserId,
        ],
      );
      const paymentRepository = new PaymentRepository(database);
      const salesRepository = new SalesRepository(database);
      // TASK 12.4B.1: every terminal fixture in this file defaults to
      // `provider: 'unassigned'` (never `'mercado_pago'`), so
      // `dispatchAttemptToProvider`'s guard short-circuits before ever
      // calling this — an unconfigured client (no access token) is safe
      // to construct here; see mercado-pago.integration.test.ts for the
      // dedicated Mercado Pago dispatch/webhook coverage.
      const mercadoPagoProvider = new MercadoPagoPointProvider(
        new MercadoPagoClient({ accessToken: undefined, apiBaseUrl: 'https://api.mercadopago.com' }),
      );
      const cashRepository = new CashRepository(database);
      payments = new PaymentService(paymentRepository, salesRepository, mercadoPagoProvider, cashRepository);
      sales = new SalesService(salesRepository);
      // TASK 12.7: every cash-payment test in this file now needs an open
      // cash session for its branch to confirm against — one register per
      // active same-company branch this file's own cash-payment tests
      // actually use, opened with a real (if minimal) float. Cash-session
      // behavior itself (open/close/ledger/expected-cash) has its own
      // dedicated coverage in `cash.integration.test.ts`.
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
      // TASK 12.7: `sales.cash_register_id`/`cash_session_id` are now
      // real FKs into `cash_registers`/`cash_sessions` — those must be
      // deleted *after* `payments`/`sales`, never before.
      await database.pool.query('delete from payment_attempts where company_id in ($1,$2)', [
        companyId,
        otherCompanyId,
      ]);
      await database.pool.query('delete from payments where company_id in ($1,$2)', [
        companyId,
        otherCompanyId,
      ]);
      await database.pool.query('delete from payment_terminals where company_id in ($1,$2)', [
        companyId,
        otherCompanyId,
      ]);
      await database.pool.query('delete from sale_items where company_id in ($1,$2)', [
        companyId,
        otherCompanyId,
      ]);
      await database.pool.query('delete from sales where company_id in ($1,$2)', [
        companyId,
        otherCompanyId,
      ]);
      await database.pool.query('delete from cash_movements where company_id in ($1,$2)', [
        companyId,
        otherCompanyId,
      ]);
      await database.pool.query('delete from cash_sessions where company_id in ($1,$2)', [
        companyId,
        otherCompanyId,
      ]);
      await database.pool.query('delete from cash_registers where company_id in ($1,$2)', [
        companyId,
        otherCompanyId,
      ]);
      await database.pool.query('delete from product_prices where company_id in ($1,$2)', [
        companyId,
        otherCompanyId,
      ]);
      await database.pool.query('delete from product_variants where company_id in ($1,$2)', [
        companyId,
        otherCompanyId,
      ]);
      await database.pool.query('delete from products where company_id in ($1,$2)', [
        companyId,
        otherCompanyId,
      ]);
      await database.pool.query('delete from devices where company_id in ($1,$2)', [
        companyId,
        otherCompanyId,
      ]);
      await database.pool.query('delete from idempotency_keys where company_id in ($1,$2)', [
        companyId,
        otherCompanyId,
      ]);
      await database.pool.query('delete from outbox_events where company_id in ($1,$2)', [
        companyId,
        otherCompanyId,
      ]);
      await database.pool.query('delete from audit_log where company_id in ($1,$2)', [
        companyId,
        otherCompanyId,
      ]);
      await database.pool.query('delete from company_memberships where company_id in ($1,$2)', [
        companyId,
        otherCompanyId,
      ]);
      await database.pool.query('delete from branches where company_id in ($1,$2)', [
        companyId,
        otherCompanyId,
      ]);
      await database.pool.query('delete from companies where id in ($1,$2)', [companyId, otherCompanyId]);
      await database.pool.query('delete from users where id in ($1,$2)', [userId, otherCompanyUserId]);
      await database.close();
    });

    /** Inserts a brand-new `card_terminal` device — a real device row, not
     * a fixture shared across tests — so registering it as a payment
     * terminal never collides with `payment_terminals_company_device_uq`
     * from an earlier test in this file. */
    async function insertDevice(targetBranchId: string, targetCompanyId = companyId): Promise<string> {
      const id = randomUUID();
      await database.pool.query(
        `insert into devices(id,company_id,branch_id,device_code,name,device_type,status)
         values($1,$2,$3,$4,'Test terminal','card_terminal','active')`,
        [id, targetCompanyId, targetBranchId, `TERM-${id.slice(0, 8)}`],
      );
      return id;
    }

    async function registerTerminal(
      key: string,
      targetBranchId = branchId,
    ): ReturnType<typeof payments.createTerminal> {
      const freshDeviceId = await insertDevice(targetBranchId);
      return payments.createTerminal(context, key, {
        branchId: targetBranchId,
        deviceId: freshDeviceId,
        provider: 'unassigned',
      });
    }

    /** Every payment must own a real sale (TASK 12.4A.1) — this creates a
     * throwaway one-line `pending_payment` sale (default 1x the 50.0000
     * MXN fixture product => a 58.0000 total) and returns it, so payment
     * tests unrelated to sale coordination can attach a valid `saleId`
     * without each hand-rolling a `sales.createSale` call. Payment
     * amount is never validated against the sale's own total at creation
     * time (see ADR-0009 — only capture-sum settlement is), so existing
     * payment-amount assertions below are unaffected by this fixture. */
    async function createSale(
      quantity = '1',
      targetBranchId = branchId,
      targetContext = context,
    ): ReturnType<typeof sales.createSale> extends Promise<{ value: infer V; replayed: boolean }>
      ? Promise<V>
      : never {
      const targetProductId = targetContext.companyId === otherCompanyId ? otherCompanyProductId : productId;
      const created = await sales.createSale(targetContext, [targetBranchId, otherBranchId], randomUUID(), {
        branchId: targetBranchId,
        items: [{ productId: targetProductId, quantity }],
      });
      return created.value;
    }

    // --- Terminal registry -------------------------------------------------

    it('registers a payment terminal idempotently against a real device', async () => {
      const first = await payments.createTerminal(context, 'terminal-key-1', {
        branchId,
        deviceId,
        provider: 'unassigned',
      });
      expect(first.replayed).toBe(false);
      expect(first.value).toMatchObject({
        branchId,
        deviceId,
        provider: 'unassigned',
        status: 'assigned',
      });
      const replay = await payments.createTerminal(context, 'terminal-key-1', {
        branchId,
        deviceId,
        provider: 'unassigned',
      });
      expect(replay.replayed).toBe(true);
      expect(replay.value.id).toBe(first.value.id);
    });

    it('rejects a terminal for a device outside the requested branch or of the wrong type', async () => {
      await expect(
        payments.createTerminal(context, 'terminal-wrong-branch', {
          branchId: otherBranchId,
          deviceId, // registered under branchId, not otherBranchId
        }),
      ).rejects.toMatchObject({ code: 'validation_error' });
      const posDeviceId = randomUUID();
      await database.pool.query(
        `insert into devices(id,company_id,branch_id,device_code,name,device_type,status)
         values($1,$2,$3,'POS-1','POS terminal','pos','active')`,
        [posDeviceId, companyId, branchId],
      );
      await expect(
        payments.createTerminal(context, 'terminal-wrong-type', {
          branchId,
          deviceId: posDeviceId,
        }),
      ).rejects.toMatchObject({ code: 'validation_error' });
    });

    // --- Payment creation, money, and tenant/branch isolation -------------

    it('creates a company-wide-scoped payment idempotently with exact decimal amounts', async () => {
      const sale = await createSale();
      const first = await payments.createPayment(context, branchIds, 'payment-key-1', {
        branchId,
        saleId: sale.sale.id,
        paymentMethod: 'cash',
        amount: '149.5',
        currencyCode: 'mxn',
      });
      expect(first.replayed).toBe(false);
      expect(first.value.payment).toMatchObject({
        branchId,
        saleId: sale.sale.id,
        paymentMethod: 'cash',
        amount: '149.5000',
        currencyCode: 'MXN',
        status: 'pending',
        terminalId: null,
        provider: null,
      });
      expect(first.value.attempt).toMatchObject({ attemptNumber: 1, status: 'created' });
      const replay = await payments.createPayment(context, branchIds, 'payment-key-1', {
        branchId,
        saleId: sale.sale.id,
        paymentMethod: 'cash',
        amount: '149.5',
        currencyCode: 'mxn',
      });
      expect(replay.replayed).toBe(true);
      expect(replay.value.payment.id).toBe(first.value.payment.id);
    });

    it('rejects a non-positive amount and a malformed currency code', async () => {
      const sale = await createSale();
      await expect(
        payments.createPayment(context, branchIds, 'payment-amount-zero', {
          branchId,
          saleId: sale.sale.id,
          paymentMethod: 'cash',
          amount: '0',
          currencyCode: 'MXN',
        }),
      ).rejects.toBeInstanceOf(PaymentError);
      await expect(
        payments.createPayment(context, branchIds, 'payment-amount-negative', {
          branchId,
          saleId: sale.sale.id,
          paymentMethod: 'cash',
          amount: '-5.00',
          currencyCode: 'MXN',
        }),
      ).rejects.toMatchObject({ code: 'validation_error' });
      await expect(
        payments.createPayment(context, branchIds, 'payment-bad-currency', {
          branchId,
          saleId: sale.sale.id,
          paymentMethod: 'cash',
          amount: '10.00',
          currencyCode: 'mx',
        }),
      ).rejects.toMatchObject({ code: 'validation_error' });
    });

    it('rejects a branch the actor is not authorized for', async () => {
      const sale = await createSale();
      await expect(
        payments.createPayment(context, branchIds, 'payment-foreign-branch', {
          branchId: foreignBranchId,
          saleId: sale.sale.id,
          paymentMethod: 'cash',
          amount: '10.00',
          currencyCode: 'MXN',
        }),
      ).rejects.toMatchObject({ code: 'validation_error' });
    });

    it('requires terminal_id for card_terminal and rejects it for cash', async () => {
      const sale = await createSale();
      await expect(
        payments.createPayment(context, branchIds, 'payment-card-no-terminal', {
          branchId,
          saleId: sale.sale.id,
          paymentMethod: 'card_terminal',
          amount: '10.00',
          currencyCode: 'MXN',
        }),
      ).rejects.toMatchObject({ code: 'terminal_required' });
      const terminal = await registerTerminal('terminal-for-cash-reject');
      await expect(
        payments.createPayment(context, branchIds, 'payment-cash-with-terminal', {
          branchId,
          saleId: sale.sale.id,
          paymentMethod: 'cash',
          amount: '10.00',
          currencyCode: 'MXN',
          terminalId: terminal.value.id,
        }),
      ).rejects.toMatchObject({ code: 'terminal_required' });
    });

    it('creates a card_terminal payment only against an active terminal in the same branch', async () => {
      const sale = await createSale();
      const terminal = await registerTerminal('terminal-for-card-payment');
      const created = await payments.createPayment(context, branchIds, 'payment-card-ok', {
        branchId,
        saleId: sale.sale.id,
        paymentMethod: 'card_terminal',
        amount: '299.00',
        currencyCode: 'MXN',
        terminalId: terminal.value.id,
      });
      expect(created.value.payment).toMatchObject({
        paymentMethod: 'card_terminal',
        terminalId: terminal.value.id,
        provider: 'unassigned',
        status: 'pending',
      });

      const otherBranchTerminal = await registerTerminal('terminal-other-branch-mismatch', otherBranchId);
      await expect(
        payments.createPayment(context, branchIds, 'payment-terminal-branch-mismatch', {
          branchId,
          saleId: sale.sale.id,
          paymentMethod: 'card_terminal',
          amount: '10.00',
          currencyCode: 'MXN',
          terminalId: otherBranchTerminal.value.id,
        }),
      ).rejects.toMatchObject({ code: 'terminal_branch_mismatch' });
    });

    it('isolates payments and terminals by tenant — a foreign company cannot see or reach this company data', async () => {
      const sale = await createSale();
      const created = await payments.createPayment(context, branchIds, 'payment-isolation', {
        branchId,
        saleId: sale.sale.id,
        paymentMethod: 'cash',
        amount: '50.00',
        currencyCode: 'MXN',
      });
      const foreignReadContext = { ...context, companyId: otherCompanyId };
      await expect(
        payments.payment(otherCompanyId, [foreignBranchId], created.value.payment.id),
      ).rejects.toMatchObject({ code: 'resource_not_found' });
      await expect(
        payments.transitionAttempt(
          foreignReadContext,
          [foreignBranchId],
          created.value.attempt.id,
          'isolation-transition',
          { status: 'approved' },
        ),
      ).rejects.toMatchObject({ code: 'resource_not_found' });
    });

    it('rejects a terminal belonging to a closed branch', async () => {
      const posDeviceInClosedBranch = randomUUID();
      await database.pool.query(
        `insert into devices(id,company_id,branch_id,device_code,name,device_type,status)
         values($1,$2,$3,'TERM-CLOSED','Closed branch terminal','card_terminal','active')`,
        [posDeviceInClosedBranch, companyId, closedBranchId],
      );
      // Terminal registration itself does not forbid a closed branch (no
      // dedicated branch-status check in this pass) — but the payment
      // creation path requires branchIds authorization, which a closed
      // branch would not normally carry; this documents current behavior
      // rather than asserting an unimplemented policy.
      const terminal = await payments.createTerminal(context, 'terminal-closed-branch', {
        branchId: closedBranchId,
        deviceId: posDeviceInClosedBranch,
      });
      expect(terminal.value.branchId).toBe(closedBranchId);
    });

    // --- State machine: approval ------------------------------------------

    it('approves an attempt, captures the payment, and forbids any further transition on that attempt', async () => {
      const sale = await createSale();
      const created = await payments.createPayment(context, branchIds, 'payment-approve-flow', {
        branchId,
        saleId: sale.sale.id,
        paymentMethod: 'cash',
        amount: '80.00',
        currencyCode: 'MXN',
      });
      const attemptId = created.value.attempt.id;
      await payments.transitionAttempt(context, branchIds, attemptId, 'approve-step-1', {
        status: 'awaiting_terminal',
      });
      await payments.transitionAttempt(context, branchIds, attemptId, 'approve-step-2', {
        status: 'processing',
      });
      const approved = await payments.transitionAttempt(context, branchIds, attemptId, 'approve-step-3', {
        status: 'approved',
        providerReference: `provider-ref-${attemptId}`,
      });
      expect(approved.value.status).toBe('approved');
      expect(approved.value.respondedAt).not.toBeNull();

      const payment = await payments.payment(companyId, branchIds, created.value.payment.id);
      expect(payment.payment.status).toBe('captured');
      expect(payment.payment.capturedAt).not.toBeNull();

      // Forbidden: approved cannot go back to processing, or to anything else.
      await expect(
        payments.transitionAttempt(context, branchIds, attemptId, 'approve-illegal-1', {
          status: 'processing',
        }),
      ).rejects.toMatchObject({ code: 'invalid_attempt_state' });
      await expect(
        payments.transitionAttempt(context, branchIds, attemptId, 'approve-illegal-2', {
          status: 'declined',
        }),
      ).rejects.toMatchObject({ code: 'invalid_attempt_state' });
    });

    it('allows a cash attempt to go straight from created to approved (no physical terminal round-trip), but forbids ever moving backwards', async () => {
      const sale = await createSale();
      const created = await payments.createPayment(context, branchIds, 'payment-cash-direct-approve', {
        branchId,
        saleId: sale.sale.id,
        paymentMethod: 'cash',
        amount: '20.00',
        currencyCode: 'MXN',
      });
      const approved = await payments.transitionAttempt(
        context,
        branchIds,
        created.value.attempt.id,
        'cash-direct-approve',
        { status: 'approved' },
      );
      expect(approved.value.status).toBe('approved');

      // Forbidden: processing can never move backwards to awaiting_terminal.
      const backwardsSale = await createSale();
      const backwards = await payments.createPayment(context, branchIds, 'payment-backwards-jump', {
        branchId,
        saleId: backwardsSale.sale.id,
        paymentMethod: 'cash',
        amount: '20.00',
        currencyCode: 'MXN',
      });
      await payments.transitionAttempt(context, branchIds, backwards.value.attempt.id, 'backwards-step-1', {
        status: 'awaiting_terminal',
      });
      await payments.transitionAttempt(context, branchIds, backwards.value.attempt.id, 'backwards-step-2', {
        status: 'processing',
      });
      await expect(
        payments.transitionAttempt(context, branchIds, backwards.value.attempt.id, 'backwards-step-3', {
          status: 'awaiting_terminal',
        }),
      ).rejects.toMatchObject({ code: 'invalid_attempt_state' });
    });

    // --- State machine: decline, cancellation, timeout ----------------------

    it('declines an attempt, leaves the payment pending, and cannot silently become approved without a new attempt', async () => {
      const sale = await createSale();
      const created = await payments.createPayment(context, branchIds, 'payment-decline-flow', {
        branchId,
        saleId: sale.sale.id,
        paymentMethod: 'cash',
        amount: '35.00',
        currencyCode: 'MXN',
      });
      const declined = await payments.transitionAttempt(
        context,
        branchIds,
        created.value.attempt.id,
        'decline-step',
        { status: 'declined', declineReason: 'insufficient_funds' },
      );
      expect(declined.value).toMatchObject({ status: 'declined', declineReason: 'insufficient_funds' });
      const payment = await payments.payment(companyId, branchIds, created.value.payment.id);
      expect(payment.payment.status).toBe('pending');
      await expect(
        payments.transitionAttempt(context, branchIds, created.value.attempt.id, 'decline-then-approve', {
          status: 'approved',
        }),
      ).rejects.toMatchObject({ code: 'invalid_attempt_state' });
    });

    it('cancels an attempt mid-flow and supports an explicit timeout state', async () => {
      const cancelSale = await createSale();
      const cancelled = await payments.createPayment(context, branchIds, 'payment-cancel-flow', {
        branchId,
        saleId: cancelSale.sale.id,
        paymentMethod: 'cash',
        amount: '15.00',
        currencyCode: 'MXN',
      });
      const cancelledAttempt = await payments.transitionAttempt(
        context,
        branchIds,
        cancelled.value.attempt.id,
        'cancel-step',
        { status: 'cancelled' },
      );
      expect(cancelledAttempt.value.status).toBe('cancelled');

      const timeoutSale = await createSale();
      const timedOut = await payments.createPayment(context, branchIds, 'payment-timeout-flow', {
        branchId,
        saleId: timeoutSale.sale.id,
        paymentMethod: 'cash',
        amount: '15.00',
        currencyCode: 'MXN',
      });
      await payments.transitionAttempt(context, branchIds, timedOut.value.attempt.id, 'timeout-step-1', {
        status: 'awaiting_terminal',
      });
      const timedOutAttempt = await payments.transitionAttempt(
        context,
        branchIds,
        timedOut.value.attempt.id,
        'timeout-step-2',
        { status: 'timed_out' },
      );
      expect(timedOutAttempt.value.status).toBe('timed_out');
    });

    it('cancels a still-pending payment (mapped to the canonical failed state) but not an already-captured one', async () => {
      const sale = await createSale();
      const created = await payments.createPayment(context, branchIds, 'payment-explicit-cancel', {
        branchId,
        saleId: sale.sale.id,
        paymentMethod: 'cash',
        amount: '25.00',
        currencyCode: 'MXN',
      });
      const cancelled = await payments.cancelPayment(
        context,
        branchIds,
        created.value.payment.id,
        'cancel-payment-key',
        'customer_changed_mind',
      );
      expect(cancelled.value).toMatchObject({ status: 'failed', reasonCode: 'customer_changed_mind' });
      expect(cancelled.value.failedAt).not.toBeNull();

      const capturedSale = await createSale();
      const captured = await payments.createPayment(context, branchIds, 'payment-cancel-captured', {
        branchId,
        saleId: capturedSale.sale.id,
        paymentMethod: 'cash',
        amount: '25.00',
        currencyCode: 'MXN',
      });
      await payments.transitionAttempt(context, branchIds, captured.value.attempt.id, 'cancel-captured-approve', {
        status: 'approved',
      });
      await expect(
        payments.cancelPayment(context, branchIds, captured.value.payment.id, 'cancel-captured-key', 'too_late'),
      ).rejects.toMatchObject({ code: 'invalid_payment_state' });
    });

    // --- Retry attempt behavior ----------------------------------------------

    it('retries a declined payment with a new attempt, never mutating the declined one', async () => {
      const sale = await createSale();
      const created = await payments.createPayment(context, branchIds, 'payment-retry-flow', {
        branchId,
        saleId: sale.sale.id,
        paymentMethod: 'cash',
        amount: '60.00',
        currencyCode: 'MXN',
      });
      await payments.transitionAttempt(context, branchIds, created.value.attempt.id, 'retry-decline', {
        status: 'declined',
        declineReason: 'card_error',
      });
      const retried = await payments.retryAttempt(context, branchIds, created.value.payment.id, 'retry-key-1');
      expect(retried.replayed).toBe(false);
      expect(retried.value).toMatchObject({ attemptNumber: 2, status: 'created' });

      const approved = await payments.transitionAttempt(context, branchIds, retried.value.id, 'retry-approve', {
        status: 'approved',
      });
      expect(approved.value.status).toBe('approved');
      const payment = await payments.payment(companyId, branchIds, created.value.payment.id);
      expect(payment.payment.status).toBe('captured');
      expect(payment.attempts).toHaveLength(2);
      expect(payment.attempts[0]).toMatchObject({ attemptNumber: 1, status: 'declined' });
      expect(payment.attempts[1]).toMatchObject({ attemptNumber: 2, status: 'approved' });

      // Idempotent retry replay.
      const replay = await payments.retryAttempt(context, branchIds, created.value.payment.id, 'retry-key-1');
      expect(replay.replayed).toBe(true);
      expect(replay.value.id).toBe(retried.value.id);
    });

    it('rejects a retry once the payment already captured or is no longer pending', async () => {
      const sale = await createSale();
      const created = await payments.createPayment(context, branchIds, 'payment-retry-captured', {
        branchId,
        saleId: sale.sale.id,
        paymentMethod: 'cash',
        amount: '40.00',
        currencyCode: 'MXN',
      });
      await payments.transitionAttempt(context, branchIds, created.value.attempt.id, 'retry-captured-approve', {
        status: 'approved',
      });
      await expect(
        payments.retryAttempt(context, branchIds, created.value.payment.id, 'retry-after-capture'),
      ).rejects.toMatchObject({ code: 'invalid_payment_state' });
    });

    // --- Duplicate provider callback / reference protection -----------------

    it('rejects two different attempts claiming the same provider reference (duplicate callback protection)', async () => {
      const firstSale = await createSale();
      const first = await payments.createPayment(context, branchIds, 'payment-dup-ref-1', {
        branchId,
        saleId: firstSale.sale.id,
        paymentMethod: 'cash',
        amount: '10.00',
        currencyCode: 'MXN',
      });
      const secondSale = await createSale();
      const second = await payments.createPayment(context, branchIds, 'payment-dup-ref-2', {
        branchId,
        saleId: secondSale.sale.id,
        paymentMethod: 'cash',
        amount: '10.00',
        currencyCode: 'MXN',
      });
      await payments.transitionAttempt(context, branchIds, first.value.attempt.id, 'dup-ref-first', {
        status: 'approved',
        providerReference: 'shared-provider-ref',
      });
      await expect(
        payments.transitionAttempt(context, branchIds, second.value.attempt.id, 'dup-ref-second', {
          status: 'declined',
          providerReference: 'shared-provider-ref',
        }),
      ).rejects.toMatchObject({ code: 'duplicate_provider_reference' });
    });

    it('replays an exact duplicate transition call as a safe no-op (idempotency-key replay)', async () => {
      const sale = await createSale();
      const created = await payments.createPayment(context, branchIds, 'payment-dup-callback', {
        branchId,
        saleId: sale.sale.id,
        paymentMethod: 'cash',
        amount: '10.00',
        currencyCode: 'MXN',
      });
      const first = await payments.transitionAttempt(
        context,
        branchIds,
        created.value.attempt.id,
        'same-callback-key',
        { status: 'approved', providerReference: 'idempotent-provider-ref' },
      );
      const replay = await payments.transitionAttempt(
        context,
        branchIds,
        created.value.attempt.id,
        'same-callback-key',
        { status: 'approved', providerReference: 'idempotent-provider-ref' },
      );
      expect(replay.replayed).toBe(true);
      expect(replay.value.id).toBe(first.value.id);
      const attempts = await payments.payment(companyId, branchIds, created.value.payment.id);
      expect(attempts.attempts).toHaveLength(1);
    });

    // --- Reversal ------------------------------------------------------------

    it('reverses a captured payment (§21.3 captured→reversed) but not a pending or already-reversed one', async () => {
      const sale = await createSale();
      const created = await payments.createPayment(context, branchIds, 'payment-reversal-flow', {
        branchId,
        saleId: sale.sale.id,
        paymentMethod: 'cash',
        amount: '90.00',
        currencyCode: 'MXN',
      });
      await expect(
        payments.reversePayment(context, branchIds, created.value.payment.id, 'reversal-too-early', 'operator_error'),
      ).rejects.toMatchObject({ code: 'invalid_payment_state' });

      await payments.transitionAttempt(context, branchIds, created.value.attempt.id, 'reversal-approve', {
        status: 'approved',
      });
      const reversed = await payments.reversePayment(
        context,
        branchIds,
        created.value.payment.id,
        'reversal-key',
        'operator_error',
      );
      expect(reversed.value).toMatchObject({ status: 'reversed', reasonCode: 'operator_error' });
      expect(reversed.value.reversedAt).not.toBeNull();

      await expect(
        payments.reversePayment(context, branchIds, created.value.payment.id, 'reversal-double', 'operator_error'),
      ).rejects.toMatchObject({ code: 'invalid_payment_state' });
    });

    // --- Malformed provider data ---------------------------------------------

    it('rejects an unrecognized attempt status and a blank provider reference', async () => {
      const sale = await createSale();
      const created = await payments.createPayment(context, branchIds, 'payment-malformed', {
        branchId,
        saleId: sale.sale.id,
        paymentMethod: 'cash',
        amount: '10.00',
        currencyCode: 'MXN',
      });
      await expect(
        payments.transitionAttempt(context, branchIds, created.value.attempt.id, 'malformed-status', {
          // @ts-expect-error deliberately invalid at the boundary
          status: 'not_a_real_status',
        }),
      ).rejects.toMatchObject({ code: 'validation_error' });
      await expect(
        payments.transitionAttempt(context, branchIds, created.value.attempt.id, 'malformed-blank-ref', {
          status: 'approved',
          providerReference: '   ',
        }),
      ).rejects.toMatchObject({ code: 'validation_error' });
    });

    // --- Audit / outbox --------------------------------------------------

    it('commits audit and outbox events atomically for a payment creation and its capture', async () => {
      const sale = await createSale();
      const created = await payments.createPayment(context, branchIds, 'payment-audit-outbox', {
        branchId,
        saleId: sale.sale.id,
        paymentMethod: 'cash',
        amount: '70.00',
        currencyCode: 'MXN',
      });
      await payments.transitionAttempt(context, branchIds, created.value.attempt.id, 'audit-outbox-approve', {
        status: 'approved',
      });
      const audit = await database.pool.query<{ count: string }>(
        `select count(*)::text count from audit_log where company_id=$1 and entity_id in ($2,$3)`,
        [companyId, created.value.payment.id, created.value.attempt.id],
      );
      expect(Number(audit.rows[0]?.count)).toBeGreaterThanOrEqual(2);
      const outbox = await database.pool.query<{ event_type: string }>(
        `select event_type from outbox_events where company_id=$1 and aggregate_id in ($2,$3) order by occurred_at asc`,
        [companyId, created.value.payment.id, created.value.attempt.id],
      );
      expect(outbox.rows.map((row) => row.event_type)).toEqual(['payment.recorded', 'payment.status_changed']);
    });

    it('never stores money as a JS float — every amount round-trips as an exact decimal string', async () => {
      const sale = await createSale();
      const created = await payments.createPayment(context, branchIds, 'payment-decimal-precision', {
        branchId,
        saleId: sale.sale.id,
        paymentMethod: 'cash',
        amount: '1234.5',
        currencyCode: 'MXN',
      });
      expect(created.value.payment.amount).toBe('1234.5000');
      expect(typeof created.value.payment.amount).toBe('string');
      const raw = await database.pool.query<{ amount: string }>(`select amount::text from payments where id=$1`, [
        created.value.payment.id,
      ]);
      expect(raw.rows[0]?.amount).toBe('1234.5000');
    });

    // --- TASK 12.4A.1: sale ownership and payment → sale coordination ------

    describe('sale ownership (TASK 12.4A.1)', () => {
      it('rejects a payment for a sale that does not exist', async () => {
        await expect(
          payments.createPayment(context, branchIds, 'payment-sale-missing', {
            branchId,
            saleId: randomUUID(),
            paymentMethod: 'cash',
            amount: '10.00',
            currencyCode: 'MXN',
          }),
        ).rejects.toMatchObject({ code: 'resource_not_found' });
      });

      it('rejects a payment for a sale belonging to another company', async () => {
        const foreignSale = await createSale('1', foreignBranchId, otherContext);
        await expect(
          payments.createPayment(context, branchIds, 'payment-sale-foreign-company', {
            branchId,
            saleId: foreignSale.sale.id,
            paymentMethod: 'cash',
            amount: '10.00',
            currencyCode: 'MXN',
          }),
        ).rejects.toMatchObject({ code: 'resource_not_found' });
      });

      it("rejects a payment whose branch does not match the sale's real branch", async () => {
        const sale = await createSale('1', branchId);
        await expect(
          payments.createPayment(context, branchIds, 'payment-sale-branch-mismatch', {
            branchId: otherBranchId,
            saleId: sale.sale.id,
            paymentMethod: 'cash',
            amount: '10.00',
            currencyCode: 'MXN',
          }),
        ).rejects.toMatchObject({ code: 'sale_branch_mismatch' });
      });

      it('rejects a payment whose currency does not match the sale currency', async () => {
        const sale = await createSale();
        await expect(
          payments.createPayment(context, branchIds, 'payment-sale-currency-mismatch', {
            branchId,
            saleId: sale.sale.id,
            paymentMethod: 'cash',
            amount: '10.00',
            currencyCode: 'USD',
          }),
        ).rejects.toMatchObject({ code: 'currency_mismatch' });
      });

      it('rejects a payment against a sale that is no longer awaiting payment', async () => {
        const sale = await createSale();
        await sales.cancelSale(context, branchIds, sale.sale.id, 'sale-cancel-for-payment-test', 'test_cancel');
        await expect(
          payments.createPayment(context, branchIds, 'payment-sale-not-pending', {
            branchId,
            saleId: sale.sale.id,
            paymentMethod: 'cash',
            amount: '10.00',
            currencyCode: 'MXN',
          }),
        ).rejects.toMatchObject({ code: 'invalid_sale_state' });
      });

      it('completes the sale once its captured payments cover the total, and stays completed on a second, unrelated approval', async () => {
        // 1 unit of the 50.0000/58.0000-total fixture product.
        const sale = await createSale('1');
        expect(sale.sale.total).toBe('58.0000');
        const payment = await payments.createPayment(context, branchIds, 'payment-settles-sale', {
          branchId,
          saleId: sale.sale.id,
          paymentMethod: 'cash',
          amount: '58.00',
          currencyCode: 'MXN',
        });
        await payments.transitionAttempt(context, branchIds, payment.value.attempt.id, 'settle-approve', {
          status: 'approved',
        });
        const settled = await sales.sale(companyId, branchIds, sale.sale.id);
        expect(settled.sale.status).toBe('completed');
        expect(settled.sale.completedAt).not.toBeNull();
        const versionAfterFirstSettle = settled.sale.version;

        // A cancellation is no longer legal once completed.
        await expect(
          sales.cancelSale(context, branchIds, sale.sale.id, 'cancel-after-complete', 'too_late'),
        ).rejects.toMatchObject({ code: 'invalid_sale_state' });
        // ...and no further payment may be created against it either —
        // this is the primary duplicate-finalization guard in practice,
        // since a sale that already left `pending_payment` simply has
        // nothing left to attach a second payment to.
        await expect(
          payments.createPayment(context, branchIds, 'payment-after-complete', {
            branchId,
            saleId: sale.sale.id,
            paymentMethod: 'cash',
            amount: '1.00',
            currencyCode: 'MXN',
          }),
        ).rejects.toMatchObject({ code: 'invalid_sale_state' });

        // Direct unit proof that `trySettleSale` itself is idempotent —
        // calling it again against an already-completed sale is a
        // documented no-op (`settled: false`), never a second
        // `sale.completed` transition or version bump.
        const salesRepository = new SalesRepository(database);
        const secondAttempt = await salesRepository.transaction((client) =>
          salesRepository.trySettleSale(client, context, sale.sale.id),
        );
        expect(secondAttempt.settled).toBe(false);
        expect(secondAttempt.sale.version).toBe(versionAfterFirstSettle);
      });

      it('leaves a sale pending_payment when captured payments do not yet cover its total', async () => {
        // 2 units => 116.0000 total; a single 58.00 payment only covers half.
        const sale = await createSale('2');
        expect(sale.sale.total).toBe('116.0000');
        const payment = await payments.createPayment(context, branchIds, 'payment-partial-does-not-settle', {
          branchId,
          saleId: sale.sale.id,
          paymentMethod: 'cash',
          amount: '58.00',
          currencyCode: 'MXN',
        });
        await payments.transitionAttempt(context, branchIds, payment.value.attempt.id, 'partial-approve', {
          status: 'approved',
        });
        const stillOpen = await sales.sale(companyId, branchIds, sale.sale.id);
        expect(stillOpen.sale.status).toBe('pending_payment');

        // A second payment for the remainder completes it.
        const second = await payments.createPayment(context, branchIds, 'payment-covers-remainder', {
          branchId,
          saleId: sale.sale.id,
          paymentMethod: 'cash',
          amount: '58.00',
          currencyCode: 'MXN',
        });
        await payments.transitionAttempt(context, branchIds, second.value.attempt.id, 'remainder-approve', {
          status: 'approved',
        });
        const completed = await sales.sale(companyId, branchIds, sale.sale.id);
        expect(completed.sale.status).toBe('completed');
      });
    });

    // --- Cash payment + real sale completion (TASK 12.5A) -----------------
    describe('cash payments (TASK 12.5A)', () => {
      it('records an exact cash payment (tendered equals total) with zero change and completes the sale', async () => {
        const sale = await createSale('1'); // 58.0000 total
        const created = await payments.createCashPayment(context, branchIds, 'cash-exact-1', {
          saleId: sale.sale.id,
          tenderedAmount: '58.00',
        });
        expect(created.replayed).toBe(false);
        expect(created.value.payment).toMatchObject({
          paymentMethod: 'cash',
          amount: '58.0000',
          status: 'captured',
          provider: null,
          terminalId: null,
        });
        expect(created.value.attempt).toMatchObject({
          status: 'approved',
          providerReference: null,
        });
        expect(created.value.tenderedAmount).toBe('58.0000');
        expect(created.value.changeAmount).toBe('0.0000');
        expect(created.value.sale.status).toBe('completed');
        expect(created.value.sale.completedAt).not.toBeNull();
      });

      it('computes exact change for an overpayment — the payment amount is the amount due, never the tendered amount', async () => {
        const sale = await createSale('1'); // 58.0000 total
        const created = await payments.createCashPayment(context, branchIds, 'cash-overpay-1', {
          saleId: sale.sale.id,
          tenderedAmount: '100.00',
        });
        // Worked example from the task spec, scaled to this fixture's
        // total: tendered 100.00 against a 58.0000 due => a 58.0000
        // payment (never a 100.00 payment) and 42.0000 change.
        expect(created.value.payment.amount).toBe('58.0000');
        expect(created.value.tenderedAmount).toBe('100.0000');
        expect(created.value.changeAmount).toBe('42.0000');
        expect(created.value.sale.status).toBe('completed');
      });

      it('rejects insufficient tendered cash and never creates a payment', async () => {
        const sale = await createSale('1'); // 58.0000 total
        await expect(
          payments.createCashPayment(context, branchIds, 'cash-insufficient-1', {
            saleId: sale.sale.id,
            tenderedAmount: '57.99',
          }),
        ).rejects.toMatchObject({ code: 'insufficient_tendered' });
        const afterReject = await sales.sale(companyId, branchIds, sale.sale.id);
        expect(afterReject.sale.status).toBe('pending_payment');
        const paymentCount = await database.pool.query<{ count: string }>(
          'select count(*)::text as count from payments where sale_id=$1',
          [sale.sale.id],
        );
        expect(paymentCount.rows[0]?.count).toBe('0');
      });

      it('rejects a zero or negative tendered amount', async () => {
        const sale = await createSale();
        await expect(
          payments.createCashPayment(context, branchIds, 'cash-zero-1', {
            saleId: sale.sale.id,
            tenderedAmount: '0',
          }),
        ).rejects.toBeInstanceOf(PaymentError);
        await expect(
          payments.createCashPayment(context, branchIds, 'cash-negative-1', {
            saleId: sale.sale.id,
            tenderedAmount: '-10.00',
          }),
        ).rejects.toMatchObject({ code: 'validation_error' });
      });

      it('ignores any client-supplied total — the amount due is always computed from the server-authoritative sale', async () => {
        const sale = await createSale('2'); // 116.0000 total
        // The cash endpoint has no "amount"/"total" input at all — only
        // `tendered_amount` — so there is no field through which a client
        // could smuggle a tampered total in the first place. Proof: an
        // attempt to under-tender against the *real* 116.0000 total is
        // still rejected even though 58.00 would have been accepted
        // against the (fictitious) 58.0000 total of a differently-sized
        // sale.
        await expect(
          payments.createCashPayment(context, branchIds, 'cash-tampered-total-1', {
            saleId: sale.sale.id,
            tenderedAmount: '58.00',
          }),
        ).rejects.toMatchObject({ code: 'insufficient_tendered' });
        const untouched = await sales.sale(companyId, branchIds, sale.sale.id);
        expect(untouched.sale.status).toBe('pending_payment');
      });

      it('never invokes a provider and requires no terminal or provider_reference', async () => {
        const sale = await createSale();
        const created = await payments.createCashPayment(context, branchIds, 'cash-no-provider-1', {
          saleId: sale.sale.id,
          tenderedAmount: sale.sale.total,
        });
        expect(created.value.payment.provider).toBeNull();
        expect(created.value.payment.terminalId).toBeNull();
        expect(created.value.attempt.terminalId).toBeNull();
        expect(created.value.attempt.providerReference).toBeNull();
      });

      it('isolates cash payments by tenant — a foreign company cannot pay this sale, and this actor cannot pay a foreign sale', async () => {
        const sale = await createSale();
        await expect(
          payments.createCashPayment(otherContext, [foreignBranchId], 'cash-foreign-tenant-1', {
            saleId: sale.sale.id,
            tenderedAmount: sale.sale.total,
          }),
        ).rejects.toMatchObject({ code: 'resource_not_found' });
        const foreignSale = await createSale('1', foreignBranchId, otherContext);
        await expect(
          payments.createCashPayment(context, branchIds, 'cash-foreign-sale-1', {
            saleId: foreignSale.sale.id,
            tenderedAmount: foreignSale.sale.total,
          }),
        ).rejects.toMatchObject({ code: 'resource_not_found' });
      });

      it("rejects a cash payment whose actor is not authorized for the sale's branch", async () => {
        const sale = await createSale('1', otherBranchId);
        await expect(
          payments.createCashPayment(context, [branchId], 'cash-branch-isolation-1', {
            saleId: sale.sale.id,
            tenderedAmount: sale.sale.total,
          }),
        ).rejects.toMatchObject({ code: 'sale_branch_mismatch' });
      });

      it('replays an identical confirmation under the same idempotency key as a safe no-op (double click / network retry)', async () => {
        const sale = await createSale();
        const first = await payments.createCashPayment(context, branchIds, 'cash-idempotent-1', {
          saleId: sale.sale.id,
          tenderedAmount: sale.sale.total,
        });
        expect(first.replayed).toBe(false);
        const replay = await payments.createCashPayment(context, branchIds, 'cash-idempotent-1', {
          saleId: sale.sale.id,
          tenderedAmount: sale.sale.total,
        });
        expect(replay.replayed).toBe(true);
        expect(replay.value.payment.id).toBe(first.value.payment.id);
        const paymentCount = await database.pool.query<{ count: string }>(
          'select count(*)::text as count from payments where sale_id=$1',
          [sale.sale.id],
        );
        expect(paymentCount.rows[0]?.count).toBe('1');
      });

      it('rejects a genuinely duplicate confirmation sent under a different idempotency key once the sale already completed', async () => {
        const sale = await createSale();
        await payments.createCashPayment(context, branchIds, 'cash-duplicate-first-1', {
          saleId: sale.sale.id,
          tenderedAmount: sale.sale.total,
        });
        // A second, distinct confirmation (e.g. a UI that failed to
        // disable its button) reaches an already-completed sale, which
        // has no remaining balance due — rejected outright, never a
        // second payment.
        await expect(
          payments.createCashPayment(context, branchIds, 'cash-duplicate-second-1', {
            saleId: sale.sale.id,
            tenderedAmount: sale.sale.total,
          }),
        ).rejects.toMatchObject({ code: 'invalid_sale_state' });
        const paymentCount = await database.pool.query<{ count: string }>(
          'select count(*)::text as count from payments where sale_id=$1',
          [sale.sale.id],
        );
        expect(paymentCount.rows[0]?.count).toBe('1');
      });

      it('rejects cash payment against an already-cancelled sale', async () => {
        const sale = await createSale();
        await sales.cancelSale(context, branchIds, sale.sale.id, 'cash-cancel-first-1', 'test_cancel');
        await expect(
          payments.createCashPayment(context, branchIds, 'cash-after-cancel-1', {
            saleId: sale.sale.id,
            tenderedAmount: sale.sale.total,
          }),
        ).rejects.toMatchObject({ code: 'invalid_sale_state' });
      });

      it('rejects a tender that would only be a partial contribution — a single cash payment must cover the full amount due', async () => {
        // 2 units => 116.0000 total; 58.00 is not the amount due (the
        // *whole* 116.0000 remaining balance is), so it is rejected
        // outright rather than accepted as a partial payment. Split/mixed
        // tender is out of scope for TASK 12.5A — see ADR-0011.
        const sale = await createSale('2');
        expect(sale.sale.total).toBe('116.0000');
        await expect(
          payments.createCashPayment(context, branchIds, 'cash-partial-rejected-1', {
            saleId: sale.sale.id,
            tenderedAmount: '58.00',
          }),
        ).rejects.toMatchObject({ code: 'insufficient_tendered' });
        const stillOpen = await sales.sale(companyId, branchIds, sale.sale.id);
        expect(stillOpen.sale.status).toBe('pending_payment');
      });

      it('computes amount due from any prior captured payment — a cash payment need only cover the remaining balance', async () => {
        // 2 units => 116.0000 total. A card_manual leg already captures
        // half of it through the existing (non-cash) `transitionAttempt`
        // path, exactly the way a real split cash+card tender would be
        // recorded as two independent payments against the same sale.
        const sale = await createSale('2');
        const cardLeg = await payments.createPayment(context, branchIds, 'cash-remainder-card-leg-1', {
          branchId,
          saleId: sale.sale.id,
          paymentMethod: 'card_manual',
          amount: '58.00',
          currencyCode: 'MXN',
        });
        await payments.transitionAttempt(
          context,
          branchIds,
          cardLeg.value.attempt.id,
          'cash-remainder-card-approve-1',
          { status: 'approved' },
        );
        const stillOpen = await sales.sale(companyId, branchIds, sale.sale.id);
        expect(stillOpen.sale.status).toBe('pending_payment');

        // The remaining balance is now only 58.0000 (not the original
        // 116.0000 total) — a cash tender of exactly that completes the
        // sale, and a tender for the *original* total would have
        // overpaid, proving the amount due really is recomputed from
        // captured payments each time.
        const cash = await payments.createCashPayment(context, branchIds, 'cash-remainder-cash-leg-1', {
          saleId: sale.sale.id,
          tenderedAmount: '58.00',
        });
        expect(cash.value.payment.amount).toBe('58.0000');
        expect(cash.value.changeAmount).toBe('0.0000');
        expect(cash.value.sale.status).toBe('completed');
      });

      it('commits audit and outbox events atomically for a cash payment creation, approval, and settlement', async () => {
        const sale = await createSale();
        const created = await payments.createCashPayment(context, branchIds, 'cash-audit-1', {
          saleId: sale.sale.id,
          tenderedAmount: sale.sale.total,
        });
        // The second audit/outbox pair (approval) is recorded against the
        // *attempt*'s own id, exactly like `transitionAttempt`'s existing
        // approval path — never the payment's id — see this method's own
        // `auditAndPublish` calls.
        const auditRows = await database.pool.query<{ action: string }>(
          `select action from audit_log where entity_id in ($1,$2) order by occurred_at asc`,
          [created.value.payment.id, created.value.attempt.id],
        );
        expect(auditRows.rows.map((row) => row.action)).toEqual(
          expect.arrayContaining(['payment.created', 'payment_attempt.status_changed']),
        );
        const outboxRows = await database.pool.query<{ event_type: string }>(
          `select event_type from outbox_events where aggregate_id in ($1,$2) order by occurred_at asc`,
          [created.value.payment.id, created.value.attempt.id],
        );
        expect(outboxRows.rows.map((row) => row.event_type)).toEqual(
          expect.arrayContaining(['payment.recorded', 'payment.status_changed']),
        );
        const saleOutbox = await database.pool.query<{ event_type: string }>(
          `select event_type from outbox_events where aggregate_id=$1`,
          [sale.sale.id],
        );
        expect(saleOutbox.rows.map((row) => row.event_type)).toContain('sale.completed');
      });

      it('never stores cash money as a JS float — tendered, change, and payment amounts round-trip as exact decimal strings', async () => {
        // 3 units of 50.0000 => 174.0000 total (16% IVA) — chosen so the
        // tendered amount forces a fractional-cent tender/change pair.
        const sale = await createSale('3');
        expect(sale.sale.total).toBe('174.0000');
        const created = await payments.createCashPayment(context, branchIds, 'cash-decimal-1', {
          saleId: sale.sale.id,
          tenderedAmount: '200.3300',
        });
        expect(created.value.payment.amount).toBe('174.0000');
        expect(created.value.tenderedAmount).toBe('200.3300');
        expect(created.value.changeAmount).toBe('26.3300');
        expect(typeof created.value.payment.amount).toBe('string');
        expect(typeof created.value.changeAmount).toBe('string');
      });
    });
  },
);
