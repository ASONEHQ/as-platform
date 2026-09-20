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
import { CashError } from './cash.types.js';

/** TASK 12.7 — cash register/session/ledger/close. Reconciled against
 * `docs/CORE_DATA_MODEL.md` §6.3 and `docs/API_CONTRACTS.md` §21.1
 * (E038–E048) — see ADR-0014 for the full design. */
const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;
const migrationsPath = resolve(import.meta.dirname, '../../../../../packages/database/drizzle');

integration('PostgreSQL cash register operations (TASK 12.7)', { concurrent: false }, () => {
  let database: DatabaseClient;
  let cash: CashService;
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
  const context = {
    companyId,
    actorId: userId,
    requestId: 'cash-request',
    correlationId: 'cash-correlation',
    timestamp: new Date('2026-09-06T09:00:00.000Z'),
  };
  const branchIds = [branchId, otherBranchId];

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
    database = createDatabaseClient({ connectionString: databaseUrl, applicationName: 'asone-cash-integration' });
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
       values($1,'Cash Co','Cash Co',$2,'active','UTC','MXN','es-MX'),
             ($3,'Other Cash Co','Other Cash Co',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `cash-${companyId}`, otherCompanyId, `cash-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'Cash Main','CMAIN','active','UTC'),
             ($3,$2,'Cash Second','CSECOND','active','UTC'),
             ($4,$5,'Cash Other Co','COTHER','active','UTC')`,
      [branchId, companyId, otherBranchId, otherCompanyBranchId, otherCompanyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'Cash Cashier','active'),($3,$4,$4,'Cash Second Cashier','active'),($5,$6,$6,'Cash Other Co User','active')`,
      [
        userId,
        `cash-${userId}@example.test`,
        otherUserId,
        `cash-${otherUserId}@example.test`,
        otherCompanyUserId,
        `cash-${otherCompanyUserId}@example.test`,
      ],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status)
       values($1,$2,$3,'active'),($4,$2,$5,'active'),($6,$7,$8,'active')`,
      [randomUUID(), companyId, userId, randomUUID(), otherUserId, randomUUID(), otherCompanyId, otherCompanyUserId],
    );
    await database.pool.query(
      // IVA_EXEMPT (0% tax) so a $29.00 price yields an exact $29.00
      // total — matching the task's own $29/$50/$21 accounting example
      // without needing to also model tax computation in this suite.
      `insert into products
       (id,company_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
       values($1,$2,'CASH-PRODUCT','cash-product','Cash Product','simple',false,'IVA_EXEMPT','active',$3,$3)`,
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
    await database.pool.query('delete from payment_attempts where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from payments where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from sale_items where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from sales where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from cash_movements where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from cash_session_partial_closes where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from cash_sessions where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from cash_registers where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from idempotency_keys where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from outbox_events where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from audit_log where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from product_prices where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from products where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from company_memberships where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from branches where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from companies where id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from users where id in ($1,$2,$3)', [userId, otherUserId, otherCompanyUserId]);
    await database.close();
  });

  // --- Registers -----------------------------------------------------------

  describe('registers', () => {
    it('creates and reads a register, and isolates by branch and tenant', async () => {
      const created = await cash.createRegister(context, branchIds, 'reg-create-1', {
        branchId,
        code: 'REG-1',
        name: 'Caja 1',
      });
      expect(created.replayed).toBe(false);
      expect(created.value).toMatchObject({ branchId, code: 'REG-1', name: 'Caja 1', status: 'active' });

      const read = await cash.register(companyId, branchIds, created.value.id);
      expect(read.id).toBe(created.value.id);

      await expect(cash.register(companyId, [otherBranchId], created.value.id)).rejects.toMatchObject({
        code: 'resource_not_found',
      });
      await expect(cash.register(otherCompanyId, [branchId], created.value.id)).rejects.toMatchObject({
        code: 'resource_not_found',
      });
    });

    it('supports multiple registers per branch architecturally — never a hardcoded single register', async () => {
      const first = await cash.createRegister(context, branchIds, 'reg-multi-1', {
        branchId: otherBranchId,
        code: 'REG-A',
        name: 'Caja A',
      });
      const second = await cash.createRegister(context, branchIds, 'reg-multi-2', {
        branchId: otherBranchId,
        code: 'REG-B',
        name: 'Caja B',
      });
      expect(first.value.id).not.toBe(second.value.id);
      const page = await cash.listRegisters(companyId, branchIds, { limit: 50, branchId: otherBranchId });
      const codes = page.items.map((item) => item.code);
      expect(codes).toEqual(expect.arrayContaining(['REG-A', 'REG-B']));
    });

    it('replays an exact duplicate creation request as a safe no-op', async () => {
      const first = await cash.createRegister(context, branchIds, 'reg-replay-1', {
        branchId,
        code: 'REG-REPLAY',
        name: 'Caja Replay',
      });
      const second = await cash.createRegister(context, branchIds, 'reg-replay-1', {
        branchId,
        code: 'REG-REPLAY',
        name: 'Caja Replay',
      });
      expect(second.replayed).toBe(true);
      expect(second.value.id).toBe(first.value.id);
    });
  });

  // --- Sessions --------------------------------------------------------------

  describe('sessions', () => {
    it('opens a session with the exact entered opening float — never a fabricated $1,000', async () => {
      const register = await cash.createRegister(context, branchIds, 'reg-session-open-1', {
        branchId,
        code: 'REG-OPEN',
        name: 'Caja Open',
      });
      const opened = await cash.openSession(context, branchIds, 'session-open-1', {
        cashRegisterId: register.value.id,
        openingAmount: '1234.5600',
      });
      expect(opened.value).toMatchObject({
        cashRegisterId: register.value.id,
        openingAmount: '1234.5600',
        status: 'open',
      });
      const summary = await cash.summary(companyId, branchIds, opened.value.id);
      expect(summary.expectedCash).toBe('1234.5600');
    });

    it('rejects a second concurrent open session for the same register — enforced at the database level', async () => {
      const register = await cash.createRegister(context, branchIds, 'reg-session-dup-1', {
        branchId,
        code: 'REG-DUP',
        name: 'Caja Dup',
      });
      await cash.openSession(context, branchIds, 'session-dup-1', {
        cashRegisterId: register.value.id,
        openingAmount: '0',
      });
      await expect(
        cash.openSession(context, branchIds, 'session-dup-2', {
          cashRegisterId: register.value.id,
          openingAmount: '500.0000',
        }),
      ).rejects.toMatchObject({ code: 'cash_session_already_open' });
      // The database's own partial unique index is the real guarantee —
      // proven directly, bypassing the application-level pre-check.
      await expect(
        database.pool.query(
          `insert into cash_sessions (id,company_id,branch_id,cash_register_id,opened_by,opened_at,opening_amount,currency_code,status)
           values ($1,$2,$3,$4,$5,$6,'0','MXN','open')`,
          [randomUUID(), companyId, branchId, register.value.id, userId, context.timestamp],
        ),
      ).rejects.toMatchObject({ constraint: 'cash_sessions_register_active_uq' });
    });

    it('requires branch authorization to open a session', async () => {
      const register = await cash.createRegister(context, branchIds, 'reg-session-auth-1', {
        branchId,
        code: 'REG-AUTH',
        name: 'Caja Auth',
      });
      await expect(
        cash.openSession(context, [otherBranchId] /* branchId deliberately excluded */, 'session-auth-1', {
          cashRegisterId: register.value.id,
          openingAmount: '0',
        }),
      ).rejects.toMatchObject({ code: 'resource_not_found' });
    });

    it('closes a session and cannot close it twice', async () => {
      const register = await cash.createRegister(context, branchIds, 'reg-session-close-1', {
        branchId,
        code: 'REG-CLOSE',
        name: 'Caja Close',
      });
      const opened = await cash.openSession(context, branchIds, 'session-close-open-1', {
        cashRegisterId: register.value.id,
        openingAmount: '1000.0000',
      });
      const closed = await cash.closeSession(context, branchIds, 'session-close-1', opened.value.id, {
        declaredClosingAmount: '1000.0000',
      });
      expect(closed.value).toMatchObject({
        status: 'closed',
        expectedClosingAmount: '1000.0000',
        declaredClosingAmount: '1000.0000',
        discrepancyAmount: '0.0000',
      });
      await expect(
        cash.closeSession(context, branchIds, 'session-close-2', opened.value.id, {
          declaredClosingAmount: '1000.0000',
        }),
      ).rejects.toMatchObject({ code: 'cash_session_closed' });
      // A new open session can immediately reuse the same register.
      const reopened = await cash.openSession(context, branchIds, 'session-close-reopen-1', {
        cashRegisterId: register.value.id,
        openingAmount: '0',
      });
      expect(reopened.value.status).toBe('open');
    });

    // Part J — AS POS V1's own `modal-cierre-caja` canonically counts
    // bills/coins before arriving at "Total contado"; confirmed present
    // in `AS POS V1.html`'s `DENOMINACIONES` array, so implemented here.
    it('accepts a denomination breakdown that sums exactly to declared_closing_amount', async () => {
      const register = await cash.createRegister(context, branchIds, 'reg-denom-ok-1', {
        branchId,
        code: 'REG-DENOM-OK',
        name: 'Caja Denom Ok',
      });
      const opened = await cash.openSession(context, branchIds, 'session-denom-ok-1', {
        cashRegisterId: register.value.id,
        openingAmount: '1000.0000',
      });
      // 1×$1000 + 1×$20 + 1×$5 + 2×$2 + 3×$1 = 1032.
      const closed = await cash.closeSession(context, branchIds, 'session-denom-ok-close-1', opened.value.id, {
        declaredClosingAmount: '1032.0000',
        denominationCounts: [
          { value: '1000', quantity: 1 },
          { value: '20', quantity: 1 },
          { value: '5', quantity: 1 },
          { value: '2', quantity: 2 },
          { value: '1', quantity: 3 },
        ],
      });
      expect(closed.value.denominationCounts).toEqual([
        { value: '1000.0000', quantity: 1 },
        { value: '20.0000', quantity: 1 },
        { value: '5.0000', quantity: 1 },
        { value: '2.0000', quantity: 2 },
        { value: '1.0000', quantity: 3 },
      ]);
      const reread = await cash.session(companyId, branchIds, opened.value.id);
      expect(reread.denominationCounts).toEqual(closed.value.denominationCounts);
    });

    it('rejects a denomination breakdown that does not sum to declared_closing_amount', async () => {
      const register = await cash.createRegister(context, branchIds, 'reg-denom-bad-1', {
        branchId,
        code: 'REG-DENOM-BAD',
        name: 'Caja Denom Bad',
      });
      const opened = await cash.openSession(context, branchIds, 'session-denom-bad-1', {
        cashRegisterId: register.value.id,
        openingAmount: '0',
      });
      await expect(
        cash.closeSession(context, branchIds, 'session-denom-bad-close-1', opened.value.id, {
          declaredClosingAmount: '1000.0000',
          denominationCounts: [{ value: '500', quantity: 1 }], // sums to 500, not 1000.
        }),
      ).rejects.toMatchObject({ code: 'validation_error' });
      // The session was never closed — the failed validation must not
      // leave a partial/mismatched closure.
      const reread = await cash.session(companyId, branchIds, opened.value.id);
      expect(reread.status).toBe('open');
    });

    it('rejects a denomination that is not part of the canonical MXN set', async () => {
      const register = await cash.createRegister(context, branchIds, 'reg-denom-unknown-1', {
        branchId,
        code: 'REG-DENOM-UNKNOWN',
        name: 'Caja Denom Unknown',
      });
      const opened = await cash.openSession(context, branchIds, 'session-denom-unknown-1', {
        cashRegisterId: register.value.id,
        openingAmount: '0',
      });
      await expect(
        cash.closeSession(context, branchIds, 'session-denom-unknown-close-1', opened.value.id, {
          declaredClosingAmount: '15.0000',
          denominationCounts: [{ value: '15', quantity: 1 }], // not a real MXN bill/coin.
        }),
      ).rejects.toMatchObject({ code: 'validation_error' });
    });

    // TASK 16.11 — `business.currency` already allows a tenant to be
    // configured `'MXN' | 'USD'` (settings.catalog.ts); a USD session
    // must validate its own real US bill/coin set, never the MXN one.
    it('accepts a real USD denomination breakdown for a USD-currency session — never rejected against the MXN set', async () => {
      const register = await cash.createRegister(context, branchIds, 'reg-denom-usd-1', {
        branchId,
        code: 'REG-DENOM-USD',
        name: 'Caja Denom USD',
      });
      const opened = await cash.openSession(context, branchIds, 'session-denom-usd-1', {
        cashRegisterId: register.value.id,
        openingAmount: '0',
        currencyCode: 'USD',
      });
      // 1×$20 + 1×$5 + 3×$0.25 + 2×$0.10 = 25.95.
      const closed = await cash.closeSession(context, branchIds, 'session-denom-usd-close-1', opened.value.id, {
        declaredClosingAmount: '25.9500',
        denominationCounts: [
          { value: '20', quantity: 1 },
          { value: '5', quantity: 1 },
          { value: '0.25', quantity: 3 },
          { value: '0.10', quantity: 2 },
        ],
      });
      expect(closed.value.denominationCounts).toEqual([
        { value: '20.0000', quantity: 1 },
        { value: '5.0000', quantity: 1 },
        { value: '0.2500', quantity: 3 },
        { value: '0.1000', quantity: 2 },
      ]);
    });

    it('rejects a real MXN-only denomination (e.g. $1000) against a USD session, and a USD-only denomination (e.g. a quarter) against an MXN session', async () => {
      const usdRegister = await cash.createRegister(context, branchIds, 'reg-denom-usd-2', {
        branchId,
        code: 'REG-DENOM-USD-2',
        name: 'Caja Denom USD 2',
      });
      const usdSession = await cash.openSession(context, branchIds, 'session-denom-usd-2', {
        cashRegisterId: usdRegister.value.id,
        openingAmount: '0',
        currencyCode: 'USD',
      });
      await expect(
        cash.closeSession(context, branchIds, 'session-denom-usd-close-2', usdSession.value.id, {
          declaredClosingAmount: '1000.0000',
          denominationCounts: [{ value: '1000', quantity: 1 }], // a real MXN bill, not a real US one.
        }),
      ).rejects.toMatchObject({ code: 'validation_error' });

      const mxnRegister = await cash.createRegister(context, branchIds, 'reg-denom-mxn-3', {
        branchId,
        code: 'REG-DENOM-MXN-3',
        name: 'Caja Denom MXN 3',
      });
      const mxnSession = await cash.openSession(context, branchIds, 'session-denom-mxn-3', {
        cashRegisterId: mxnRegister.value.id,
        openingAmount: '0',
      });
      await expect(
        cash.closeSession(context, branchIds, 'session-denom-mxn-close-3', mxnSession.value.id, {
          declaredClosingAmount: '0.2500',
          denominationCounts: [{ value: '0.25', quantity: 1 }], // a real US quarter, not a real MXN coin.
        }),
      ).rejects.toMatchObject({ code: 'validation_error' });
    });
  });

  // TASK 16.11A §1 — "AS POS is a commercial multi-tenant product and
  // must not have an architectural assumption that only MXN/USD can ever
  // exist." A session's currency must come from the tenant's own real
  // configured `companies.currency_code` (which the platform's own
  // provisioning already accepts as ANY 3-letter ISO code, not just
  // MXN/USD — see `production-owner.service.ts`), never a hardcoded
  // literal. An unsupported currency must never block closing with a
  // plain manual total, and must never silently substitute the MXN set
  // if a denomination breakdown is attempted.
  describe('currency-aware sessions (TASK 16.11A §1)', () => {
    const eurCompanyId = randomUUID();
    const eurBranchId = randomUUID();
    const eurUserId = randomUUID();

    beforeAll(async () => {
      // A real, provisioned-shape tenant configured with a currency this
      // platform's own `business.currency` SETTING does not (yet) allow
      // choosing via the admin UI — proving the cash module itself never
      // assumes "only MXN/USD exist", independent of that separate,
      // narrower settings-catalog allowlist.
      await database.pool.query(
        `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
         values($1,'Cash EUR Co','Cash EUR Co',$2,'active','UTC','EUR','es-MX')`,
        [eurCompanyId, `cash-eur-${eurCompanyId}`],
      );
      await database.pool.query(
        `insert into branches(id,company_id,name,code,status,timezone)
         values($1,$2,'Cash EUR Main','CEURMAIN','active','UTC')`,
        [eurBranchId, eurCompanyId],
      );
      await database.pool.query(
        `insert into users(id,email,normalized_email,display_name,status)
         values($1,$2,$2,'Cash EUR Cashier','active')`,
        [eurUserId, `cash-eur-${eurUserId}@example.test`],
      );
      await database.pool.query(
        `insert into company_memberships(id,company_id,user_id,status)
         values($1,$2,$3,'active')`,
        [randomUUID(), eurCompanyId, eurUserId],
      );
    });

    afterAll(async () => {
      await database.pool.query('delete from cash_movements where company_id=$1', [eurCompanyId]);
      await database.pool.query('delete from cash_sessions where company_id=$1', [eurCompanyId]);
      await database.pool.query('delete from cash_registers where company_id=$1', [eurCompanyId]);
      await database.pool.query('delete from idempotency_keys where company_id=$1', [eurCompanyId]);
      await database.pool.query('delete from outbox_events where company_id=$1', [eurCompanyId]);
      await database.pool.query('delete from audit_log where company_id=$1', [eurCompanyId]);
      await database.pool.query('delete from company_memberships where company_id=$1', [eurCompanyId]);
      await database.pool.query('delete from branches where company_id=$1', [eurCompanyId]);
      await database.pool.query('delete from companies where id=$1', [eurCompanyId]);
      await database.pool.query('delete from users where id=$1', [eurUserId]);
    });

    const eurContext = {
      companyId: eurCompanyId,
      actorId: eurUserId,
      requestId: 'cash-eur-request',
      correlationId: 'cash-eur-correlation',
      timestamp: new Date('2026-09-20T09:00:00.000Z'),
    };
    const eurBranchIds = [eurBranchId];

    it('opening a session with no explicit currencyCode tags it with the tenant\'s REAL configured currency — never a hardcoded MXN literal', async () => {
      const register = await cash.createRegister(eurContext, eurBranchIds, 'reg-eur-1', {
        branchId: eurBranchId,
        code: 'REG-EUR-1',
        name: 'Caja EUR 1',
      });
      const opened = await cash.openSession(eurContext, eurBranchIds, 'session-eur-open-1', {
        cashRegisterId: register.value.id,
        openingAmount: '500.0000',
      });
      expect(opened.value.currencyCode).toBe('EUR');
      const summary = await cash.summary(eurCompanyId, eurBranchIds, opened.value.id);
      expect(summary.openingAmount).toBe('500.0000');
    });

    it('closes with a plain manual total for an unsupported-denomination currency — never blocked', async () => {
      const register = await cash.createRegister(eurContext, eurBranchIds, 'reg-eur-2', {
        branchId: eurBranchId,
        code: 'REG-EUR-2',
        name: 'Caja EUR 2',
      });
      const opened = await cash.openSession(eurContext, eurBranchIds, 'session-eur-open-2', {
        cashRegisterId: register.value.id,
        openingAmount: '100.0000',
      });
      const closed = await cash.closeSession(eurContext, eurBranchIds, 'session-eur-close-2', opened.value.id, {
        declaredClosingAmount: '100.0000',
      });
      expect(closed.value.status).toBe('closed');
      expect(closed.value.discrepancyAmount).toBe('0.0000');
    });

    it('rejects a denomination breakdown attempt for an unsupported currency — never silently substitutes the MXN set', async () => {
      const register = await cash.createRegister(eurContext, eurBranchIds, 'reg-eur-3', {
        branchId: eurBranchId,
        code: 'REG-EUR-3',
        name: 'Caja EUR 3',
      });
      const opened = await cash.openSession(eurContext, eurBranchIds, 'session-eur-open-3', {
        cashRegisterId: register.value.id,
        openingAmount: '0',
      });
      // A real MXN bill — if this were silently validated against the MXN
      // set instead of being refused outright, it would wrongly pass.
      await expect(
        cash.closeSession(eurContext, eurBranchIds, 'session-eur-close-3', opened.value.id, {
          declaredClosingAmount: '500.0000',
          denominationCounts: [{ value: '500', quantity: 1 }],
        }),
      ).rejects.toMatchObject({ code: 'validation_error' });
      // The session was never closed — the failed validation must not
      // leave a partial/mismatched closure.
      const reread = await cash.session(eurCompanyId, eurBranchIds, opened.value.id);
      expect(reread.status).toBe('open');
    });

    it('an explicit currencyCode override still works for a caller that already knows the exact currency it wants', async () => {
      const register = await cash.createRegister(eurContext, eurBranchIds, 'reg-eur-4', {
        branchId: eurBranchId,
        code: 'REG-EUR-4',
        name: 'Caja EUR 4',
      });
      const opened = await cash.openSession(eurContext, eurBranchIds, 'session-eur-open-4', {
        cashRegisterId: register.value.id,
        openingAmount: '0',
        currencyCode: 'USD',
      });
      // The EUR company's own default is overridden, exactly as asked.
      expect(opened.value.currencyCode).toBe('USD');
    });
  });

  // --- Manual movements ------------------------------------------------------

  describe('manual cash in/out', () => {
    it('records cash in and cash out, requiring a positive amount and a reason', async () => {
      const register = await cash.createRegister(context, branchIds, 'reg-move-1', {
        branchId,
        code: 'REG-MOVE',
        name: 'Caja Move',
      });
      const opened = await cash.openSession(context, branchIds, 'session-move-1', {
        cashRegisterId: register.value.id,
        openingAmount: '1000.0000',
      });
      const cashIn = await cash.createMovement(context, branchIds, 'movement-in-1', opened.value.id, {
        movementType: 'cash_in',
        amount: '200.0000',
        reasonCode: 'additional_float',
      });
      expect(cashIn.value).toMatchObject({ movementType: 'cash_in', amount: '200.0000', reasonCode: 'additional_float' });
      const cashOut = await cash.createMovement(context, branchIds, 'movement-out-1', opened.value.id, {
        movementType: 'cash_out',
        amount: '50.0000',
        reasonCode: 'safe_drop',
        note: 'Shift safe drop',
      });
      expect(cashOut.value).toMatchObject({ movementType: 'cash_out', amount: '50.0000', reasonCode: 'safe_drop' });

      await expect(
        cash.createMovement(context, branchIds, 'movement-zero-1', opened.value.id, {
          movementType: 'cash_in',
          amount: '0',
          reasonCode: 'test',
        }),
      ).rejects.toMatchObject({ code: 'validation_error' });
      await expect(
        cash.createMovement(context, branchIds, 'movement-noreason-1', opened.value.id, {
          movementType: 'cash_in',
          amount: '10.0000',
          reasonCode: '   ',
        }),
      ).rejects.toMatchObject({ code: 'validation_error' });

      const summary = await cash.summary(companyId, branchIds, opened.value.id);
      // 1000 + 200 - 50 = 1150.
      expect(summary.expectedCash).toBe('1150.0000');
      expect(summary.cashInTotal).toBe('200.0000');
      expect(summary.cashOutTotal).toBe('50.0000');
    });

    it('rejects a manual movement against a closed session', async () => {
      const register = await cash.createRegister(context, branchIds, 'reg-move-closed-1', {
        branchId,
        code: 'REG-MOVE-CLOSED',
        name: 'Caja Move Closed',
      });
      const opened = await cash.openSession(context, branchIds, 'session-move-closed-1', {
        cashRegisterId: register.value.id,
        openingAmount: '0',
      });
      await cash.closeSession(context, branchIds, 'session-move-closed-close-1', opened.value.id, {
        declaredClosingAmount: '0',
      });
      await expect(
        cash.createMovement(context, branchIds, 'movement-after-close-1', opened.value.id, {
          movementType: 'cash_in',
          amount: '10.0000',
          reasonCode: 'test',
        }),
      ).rejects.toMatchObject({ code: 'cash_session_closed' });
    });

    it('rejects a manual movement for an unauthorized branch', async () => {
      const register = await cash.createRegister(context, branchIds, 'reg-move-unauth-1', {
        branchId,
        code: 'REG-MOVE-UNAUTH',
        name: 'Caja Move Unauth',
      });
      const opened = await cash.openSession(context, branchIds, 'session-move-unauth-1', {
        cashRegisterId: register.value.id,
        openingAmount: '0',
      });
      await expect(
        cash.createMovement(context, [otherBranchId], 'movement-unauth-1', opened.value.id, {
          movementType: 'cash_in',
          amount: '10.0000',
          reasonCode: 'test',
        }),
      ).rejects.toMatchObject({ code: 'resource_not_found' });
    });
  });

  // TASK 16.11 (§6) — "Never delete posted financial movements.
  // Corrections must use reversal/compensating architecture."
  describe('manual movement reversal', () => {
    it('reverses a cash_out with an opposite cash_in movement, restoring expected cash exactly', async () => {
      const register = await cash.createRegister(context, branchIds, 'reg-reverse-1', {
        branchId,
        code: 'REG-REVERSE',
        name: 'Caja Reverse',
      });
      const opened = await cash.openSession(context, branchIds, 'session-reverse-1', {
        cashRegisterId: register.value.id,
        openingAmount: '500.0000',
      });
      const withdrawal = await cash.createMovement(context, branchIds, 'reverse-movement-out-1', opened.value.id, {
        movementType: 'cash_out',
        amount: '100.0000',
        reasonCode: 'withdrawal',
        category: 'withdrawal',
      });
      let summary = await cash.summary(companyId, branchIds, opened.value.id);
      expect(summary.expectedCash).toBe('400.0000');

      const reversal = await cash.reverseMovement(
        context,
        branchIds,
        'reverse-1',
        opened.value.id,
        withdrawal.value.id,
        { reasonCode: 'data_entry_error', note: 'Wrong amount typed' },
      );
      expect(reversal.replayed).toBe(false);
      expect(reversal.value).toMatchObject({
        movementType: 'cash_in',
        amount: '100.0000',
        reversalOfId: withdrawal.value.id,
        category: null,
      });

      summary = await cash.summary(companyId, branchIds, opened.value.id);
      // The withdrawal (-100) plus its own reversal (+100) net to zero —
      // back to the 500 opening float, exactly as if the withdrawal had
      // never happened, with BOTH rows still present in history.
      expect(summary.expectedCash).toBe('500.0000');

      const movements = await cash.listMovements(companyId, branchIds, opened.value.id, { limit: 50 });
      expect(movements.items.filter((item) => item.id === withdrawal.value.id)).toHaveLength(1);
      expect(movements.items.filter((item) => item.id === reversal.value.id)).toHaveLength(1);
    });

    it('reverses a cash_in with an opposite cash_out movement', async () => {
      const register = await cash.createRegister(context, branchIds, 'reg-reverse-2', {
        branchId,
        code: 'REG-REVERSE-2',
        name: 'Caja Reverse 2',
      });
      const opened = await cash.openSession(context, branchIds, 'session-reverse-2', {
        cashRegisterId: register.value.id,
        openingAmount: '0',
      });
      const income = await cash.createMovement(context, branchIds, 'reverse-movement-in-2', opened.value.id, {
        movementType: 'cash_in',
        amount: '50.0000',
        reasonCode: 'external_income',
        category: 'external_income',
      });
      const reversal = await cash.reverseMovement(context, branchIds, 'reverse-2', opened.value.id, income.value.id, {
        reasonCode: 'duplicate_entry',
      });
      expect(reversal.value.movementType).toBe('cash_out');
      expect(reversal.value.amount).toBe('50.0000');
      const summary = await cash.summary(companyId, branchIds, opened.value.id);
      expect(summary.expectedCash).toBe('0.0000');
    });

    it('rejects a second reversal of the same movement (DB constraint backed)', async () => {
      const register = await cash.createRegister(context, branchIds, 'reg-reverse-3', {
        branchId,
        code: 'REG-REVERSE-3',
        name: 'Caja Reverse 3',
      });
      const opened = await cash.openSession(context, branchIds, 'session-reverse-3', {
        cashRegisterId: register.value.id,
        openingAmount: '0',
      });
      const expense = await cash.createMovement(context, branchIds, 'reverse-movement-out-3', opened.value.id, {
        movementType: 'cash_out',
        amount: '30.0000',
        reasonCode: 'expense',
        category: 'expense',
      });
      await cash.reverseMovement(context, branchIds, 'reverse-3-first', opened.value.id, expense.value.id, {
        reasonCode: 'correction',
      });
      await expect(
        cash.reverseMovement(context, branchIds, 'reverse-3-second', opened.value.id, expense.value.id, {
          reasonCode: 'correction-again',
        }),
      ).rejects.toMatchObject({ code: 'cash_movement_already_reversed' });
    });

    it('rejects reversing a reversal itself', async () => {
      const register = await cash.createRegister(context, branchIds, 'reg-reverse-4', {
        branchId,
        code: 'REG-REVERSE-4',
        name: 'Caja Reverse 4',
      });
      const opened = await cash.openSession(context, branchIds, 'session-reverse-4', {
        cashRegisterId: register.value.id,
        openingAmount: '0',
      });
      const original = await cash.createMovement(context, branchIds, 'reverse-movement-out-4', opened.value.id, {
        movementType: 'cash_out',
        amount: '10.0000',
        reasonCode: 'expense',
      });
      const reversal = await cash.reverseMovement(context, branchIds, 'reverse-4-first', opened.value.id, original.value.id, {
        reasonCode: 'correction',
      });
      await expect(
        cash.reverseMovement(context, branchIds, 'reverse-4-second', opened.value.id, reversal.value.id, {
          reasonCode: 'undo-the-undo',
        }),
      ).rejects.toMatchObject({ code: 'cash_movement_not_reversible' });
    });

    it('rejects reversing a system-posted opening_float movement', async () => {
      const register = await cash.createRegister(context, branchIds, 'reg-reverse-5', {
        branchId,
        code: 'REG-REVERSE-5',
        name: 'Caja Reverse 5',
      });
      const opened = await cash.openSession(context, branchIds, 'session-reverse-5', {
        cashRegisterId: register.value.id,
        openingAmount: '500.0000',
      });
      const movements = await cash.listMovements(companyId, branchIds, opened.value.id, { limit: 10 });
      const openingMovement = movements.items.find((item) => item.movementType === 'opening_float');
      expect(openingMovement).toBeDefined();
      await expect(
        cash.reverseMovement(context, branchIds, 'reverse-5-attempt', opened.value.id, openingMovement!.id, {
          reasonCode: 'attempted',
        }),
      ).rejects.toMatchObject({ code: 'cash_movement_not_reversible' });
    });

    // TASK 16.11A §4 — the guard in `CashService.reverseMovement` is a
    // positive whitelist (`movementType === 'cash_in' || 'cash_out'`),
    // not a per-type blacklist, so `cash_sale` is rejected by the exact
    // same generic mechanism the `opening_float` test above already
    // proves — no per-type special-casing exists to drift out of sync.
    // `cash_refund` is structurally covered by the identical whitelist
    // check (not independently re-tested here, to avoid duplicating the
    // refund flow's own heavy fixture setup for a guard that is provably
    // the same single `if` for every non-cash_in/cash_out type).
    it('rejects reversing a system-posted cash_sale movement', async () => {
      const register = await cash.createRegister(context, branchIds, 'reg-reverse-cashsale-1', {
        branchId,
        code: 'REG-REVERSE-CASHSALE',
        name: 'Caja Reverse Cash Sale',
      });
      const opened = await cash.openSession(context, branchIds, 'session-reverse-cashsale-1', {
        cashRegisterId: register.value.id,
        openingAmount: '0',
      });
      const createdSale = await sales.createSale(context, branchIds, 'reverse-cashsale-1', {
        branchId,
        items: [{ productId, quantity: '1' }],
      });
      await payments.createCashPayment(context, branchIds, 'reverse-cashsale-1-pay', {
        saleId: createdSale.value.sale.id,
        tenderedAmount: '29.00',
        cashRegisterId: register.value.id,
      });
      const movements = await cash.listMovements(companyId, branchIds, opened.value.id, { limit: 10 });
      const saleMovement = movements.items.find((item) => item.movementType === 'cash_sale');
      expect(saleMovement).toBeDefined();
      await expect(
        cash.reverseMovement(context, branchIds, 'reverse-cashsale-1-attempt', opened.value.id, saleMovement!.id, {
          reasonCode: 'attempted',
        }),
      ).rejects.toMatchObject({ code: 'cash_movement_not_reversible' });

      await database.pool.query(
        'delete from payment_attempts where payment_id in (select id from payments where sale_id=$1)',
        [createdSale.value.sale.id],
      );
      await database.pool.query('delete from payments where sale_id=$1', [createdSale.value.sale.id]);
      await database.pool.query('delete from sale_items where sale_id=$1', [createdSale.value.sale.id]);
      await database.pool.query('delete from sales where id=$1', [createdSale.value.sale.id]);
    });

    it('rejects reversing a movement after the session has closed', async () => {
      const register = await cash.createRegister(context, branchIds, 'reg-reverse-6', {
        branchId,
        code: 'REG-REVERSE-6',
        name: 'Caja Reverse 6',
      });
      const opened = await cash.openSession(context, branchIds, 'session-reverse-6', {
        cashRegisterId: register.value.id,
        openingAmount: '0',
      });
      const expense = await cash.createMovement(context, branchIds, 'reverse-movement-out-6', opened.value.id, {
        movementType: 'cash_out',
        amount: '10.0000',
        reasonCode: 'expense',
      });
      await cash.closeSession(context, branchIds, 'session-reverse-6-close', opened.value.id, {
        declaredClosingAmount: '0',
      });
      await expect(
        cash.reverseMovement(context, branchIds, 'reverse-6-attempt', opened.value.id, expense.value.id, {
          reasonCode: 'too_late',
        }),
      ).rejects.toMatchObject({ code: 'cash_session_closed' });
    });

    it('rejects reversing a movement for an unauthorized branch — tenant/branch isolation holds', async () => {
      const register = await cash.createRegister(context, branchIds, 'reg-reverse-7', {
        branchId,
        code: 'REG-REVERSE-7',
        name: 'Caja Reverse 7',
      });
      const opened = await cash.openSession(context, branchIds, 'session-reverse-7', {
        cashRegisterId: register.value.id,
        openingAmount: '0',
      });
      const expense = await cash.createMovement(context, branchIds, 'reverse-movement-out-7', opened.value.id, {
        movementType: 'cash_out',
        amount: '10.0000',
        reasonCode: 'expense',
      });
      await expect(
        cash.reverseMovement(context, [otherBranchId], 'reverse-7-attempt', opened.value.id, expense.value.id, {
          reasonCode: 'cross_branch_attempt',
        }),
      ).rejects.toMatchObject({ code: 'resource_not_found' });
    });

    it('replays an exact duplicate reversal request as a safe no-op — idempotent, never double-reverses', async () => {
      const register = await cash.createRegister(context, branchIds, 'reg-reverse-8', {
        branchId,
        code: 'REG-REVERSE-8',
        name: 'Caja Reverse 8',
      });
      const opened = await cash.openSession(context, branchIds, 'session-reverse-8', {
        cashRegisterId: register.value.id,
        openingAmount: '0',
      });
      const expense = await cash.createMovement(context, branchIds, 'reverse-movement-out-8', opened.value.id, {
        movementType: 'cash_out',
        amount: '10.0000',
        reasonCode: 'expense',
      });
      const first = await cash.reverseMovement(context, branchIds, 'reverse-8-key', opened.value.id, expense.value.id, {
        reasonCode: 'correction',
      });
      const second = await cash.reverseMovement(context, branchIds, 'reverse-8-key', opened.value.id, expense.value.id, {
        reasonCode: 'correction',
      });
      expect(second.replayed).toBe(true);
      expect(second.value.id).toBe(first.value.id);
      const summary = await cash.summary(companyId, branchIds, opened.value.id);
      // -10 (expense) + 10 (one single reversal) = 0, never -10 + 20.
      expect(summary.expectedCash).toBe('0.0000');
    });

    it('rejects reversing a movement that does not exist', async () => {
      const register = await cash.createRegister(context, branchIds, 'reg-reverse-9', {
        branchId,
        code: 'REG-REVERSE-9',
        name: 'Caja Reverse 9',
      });
      const opened = await cash.openSession(context, branchIds, 'session-reverse-9', {
        cashRegisterId: register.value.id,
        openingAmount: '0',
      });
      await expect(
        cash.reverseMovement(context, branchIds, 'reverse-9-attempt', opened.value.id, randomUUID(), {
          reasonCode: 'test',
        }),
      ).rejects.toMatchObject({ code: 'resource_not_found' });
    });

    // TASK 16.11A §4 — a partial-close snapshot or the session's own
    // closing record are entirely different tables/entities from
    // `cash_movements` (`cash_session_partial_closes`/`cash_sessions`
    // themselves), never rows this endpoint's `lockMovement` (scoped to
    // `cash_movements`) could ever resolve — so a partial-close id can
    // only ever be met with the same honest `resource_not_found` as any
    // other id that doesn't name a real movement, never mistakenly
    // "found and reversed".
    it('rejects reversing a partial-close snapshot id — it is not a cash_movements row at all', async () => {
      const register = await cash.createRegister(context, branchIds, 'reg-reverse-10', {
        branchId,
        code: 'REG-REVERSE-10',
        name: 'Caja Reverse 10',
      });
      const opened = await cash.openSession(context, branchIds, 'session-reverse-10', {
        cashRegisterId: register.value.id,
        openingAmount: '0',
      });
      const snapshot = await cash.partialClose(context, branchIds, 'reverse-10-partial', opened.value.id);
      await expect(
        cash.reverseMovement(context, branchIds, 'reverse-10-attempt', opened.value.id, snapshot.value.id, {
          reasonCode: 'test',
        }),
      ).rejects.toMatchObject({ code: 'resource_not_found' });
    });
  });

  // TASK 16.11 (§13) — "Bitácora": a read-only projection of the existing
  // `audit_log` rows this module already writes, scoped to one session.
  describe('audit log ("bitácora")', () => {
    it('records real evidence for open, a manual movement, a partial close, a reversal, and close — in order', async () => {
      // Distinct, strictly increasing timestamps per step — this suite's
      // shared `context` otherwise carries one fixed timestamp for every
      // call, which would make every row in this test share one
      // `occurred_at` and defeat the chronological-order assertion below
      // (see the identical pattern at firstContext/secondContext further
      // down this file).
      const at = (offsetMinutes: number): typeof context => ({
        ...context,
        timestamp: new Date(context.timestamp.getTime() + offsetMinutes * 60_000),
      });
      const register = await cash.createRegister(at(0), branchIds, 'reg-audit-1', {
        branchId,
        code: 'REG-AUDIT',
        name: 'Caja Audit',
      });
      const opened = await cash.openSession(at(1), branchIds, 'session-audit-1', {
        cashRegisterId: register.value.id,
        openingAmount: '500.0000',
      });
      const expense = await cash.createMovement(at(2), branchIds, 'audit-movement-1', opened.value.id, {
        movementType: 'cash_out',
        amount: '30.0000',
        reasonCode: 'expense',
        category: 'expense',
      });
      await cash.partialClose(at(3), branchIds, 'audit-partial-1', opened.value.id);
      await cash.reverseMovement(at(4), branchIds, 'audit-reverse-1', opened.value.id, expense.value.id, {
        reasonCode: 'correction',
      });
      await cash.closeSession(at(5), branchIds, 'audit-close-1', opened.value.id, {
        declaredClosingAmount: '500.0000',
      });

      const log = await cash.auditLog(companyId, branchIds, opened.value.id, 100);
      const actions = log.map((entry) => entry.action);
      expect(actions).toEqual([
        'cash_session.opened',
        'cash_movement.created',
        'cash_session.partial_closed',
        'cash_movement.reversed',
        'cash_session.closed',
      ]);
      // Never a second, parallel log — every entry is real evidence
      // already written by auditAndPublish, occurring in strict
      // chronological order and carrying a real actor/entity identity.
      for (const entry of log) {
        expect(entry.actorId).toBe(userId);
        expect(entry.entityId).not.toBeNull();
      }
    });

    it('never leaks another session\'s (or another company\'s) audit rows into this session\'s bitácora', async () => {
      const at = (offsetMinutes: number): typeof context => ({
        ...context,
        timestamp: new Date(context.timestamp.getTime() + offsetMinutes * 60_000),
      });
      const register = await cash.createRegister(at(0), branchIds, 'reg-audit-2', {
        branchId,
        code: 'REG-AUDIT-2',
        name: 'Caja Audit 2',
      });
      const sessionA = await cash.openSession(at(1), branchIds, 'session-audit-2a', {
        cashRegisterId: register.value.id,
        openingAmount: '100.0000',
      });
      await cash.closeSession(at(2), branchIds, 'session-audit-2a-close', sessionA.value.id, {
        declaredClosingAmount: '100.0000',
      });
      const sessionB = await cash.openSession(at(3), branchIds, 'session-audit-2b', {
        cashRegisterId: register.value.id,
        openingAmount: '200.0000',
      });
      const logA = await cash.auditLog(companyId, branchIds, sessionA.value.id, 100);
      expect(logA.map((entry) => entry.action)).toEqual(['cash_session.opened', 'cash_session.closed']);
      const logB = await cash.auditLog(companyId, branchIds, sessionB.value.id, 100);
      expect(logB.map((entry) => entry.action)).toEqual(['cash_session.opened']);
    });

    it('rejects reading the audit log for an unauthorized branch or a foreign company', async () => {
      const register = await cash.createRegister(context, branchIds, 'reg-audit-3', {
        branchId,
        code: 'REG-AUDIT-3',
        name: 'Caja Audit 3',
      });
      const opened = await cash.openSession(context, branchIds, 'session-audit-3', {
        cashRegisterId: register.value.id,
        openingAmount: '0',
      });
      await expect(cash.auditLog(companyId, [otherBranchId], opened.value.id, 100)).rejects.toMatchObject({
        code: 'resource_not_found',
      });
      await expect(cash.auditLog(otherCompanyId, branchIds, opened.value.id, 100)).rejects.toMatchObject({
        code: 'resource_not_found',
      });
    });

    // TASK 16.11A §3 — documents, on purpose, the Bitácora's real
    // boundary: it is the cash-SESSION's own operational audit trail
    // (open/manual-movement/reversal/partial-close/close), not a
    // complete financial timeline. A cash sale's own evidence lives in
    // the payment domain's own audit rows (`resourceType: 'payment'`/
    // `'payment_attempt'`, written by `PaymentService.createCashPayment`)
    // — this module deliberately never wrote a `cash_movement` audit row
    // for a `cash_sale` movement (only `CashService`'s own mutations do
    // that), and this test pins that as intentional, not an oversight:
    // composing the payment domain's own audit rows in here would mean
    // showing payment-internals action names (`payment.created`,
    // `payment_attempt.status_changed`) inside a cash-drawer operational
    // log, and — worse — duplicating evidence that already has its own
    // authoritative home (the sale/payment's own history), which is
    // exactly what this task's own instruction forbids ("do NOT duplicate
    // payment audit events merely to fill the UI").
    it('never shows a cash_sale as a cash_movement audit entry — that evidence lives in the payment domain, not duplicated here', async () => {
      const register = await cash.createRegister(context, branchIds, 'reg-audit-4', {
        branchId,
        code: 'REG-AUDIT-4',
        name: 'Caja Audit 4',
      });
      const opened = await cash.openSession(context, branchIds, 'session-audit-4', {
        cashRegisterId: register.value.id,
        openingAmount: '0',
      });
      const createdSale = await sales.createSale(context, branchIds, 'cashaudit-sale-1', {
        branchId,
        items: [{ productId, quantity: '1' }],
      });
      await payments.createCashPayment(context, branchIds, 'cashaudit-sale-1-pay', {
        saleId: createdSale.value.sale.id,
        tenderedAmount: '29.00',
        cashRegisterId: register.value.id,
      });
      // The cash_sale movement is real and does affect expected cash —
      // this is not a claim that the sale itself went unrecorded.
      const summary = await cash.summary(companyId, branchIds, opened.value.id);
      expect(summary.cashSalesTotal).toBe('29.0000');

      const log = await cash.auditLog(companyId, branchIds, opened.value.id, 100);
      expect(log.map((entry) => entry.action)).toEqual(['cash_session.opened']);
      expect(log.some((entry) => entry.entityType === 'cash_movement')).toBe(false);

      await database.pool.query(
        'delete from payment_attempts where payment_id in (select id from payments where sale_id=$1)',
        [createdSale.value.sale.id],
      );
      await database.pool.query('delete from payments where sale_id=$1', [createdSale.value.sale.id]);
      await database.pool.query('delete from sale_items where sale_id=$1', [createdSale.value.sale.id]);
      await database.pool.query('delete from sales where id=$1', [createdSale.value.sale.id]);
    });
  });

  // --- Cash sale integration (Part E) ---------------------------------------

  describe('cash sale integration', () => {
    it('requires an open session — a cash payment is rejected without one', async () => {
      const created = await sales.createSale(context, branchIds, 'cashintegration-nosession-1', {
        branchId: otherBranchId,
        items: [{ productId, quantity: '1' }],
      });
      await expect(
        payments.createCashPayment(context, branchIds, 'cashintegration-nosession-1-pay', {
          saleId: created.value.sale.id,
          tenderedAmount: '29.00',
        }),
      ).rejects.toMatchObject({ code: 'cash_session_required' });
      const sale = await sales.sale(companyId, branchIds, created.value.sale.id);
      expect(sale.sale.status).toBe('pending_payment');
    });

    it('a $29 sale with $50 tendered posts a net +$29 drawer movement — never +$50', async () => {
      const register = await cash.createRegister(context, branchIds, 'reg-2921-1', {
        branchId,
        code: 'REG-2921',
        name: 'Caja 2921',
      });
      const openedSession = await cash.openSession(context, branchIds, 'session-2921-1', {
        cashRegisterId: register.value.id,
        openingAmount: '1000.0000',
      });
      const createdSale = await sales.createSale(context, branchIds, 'cashintegration-2921-1', {
        branchId,
        items: [{ productId, quantity: '1' }],
      });
      expect(createdSale.value.sale.total).toBe('29.0000');
      const paid = await payments.createCashPayment(context, branchIds, 'cashintegration-2921-1-pay', {
        saleId: createdSale.value.sale.id,
        tenderedAmount: '50.00',
        cashRegisterId: register.value.id,
      });
      // The receipt-facing figures are still the real $50/$21.
      expect(paid.value.tenderedAmount).toBe('50.0000');
      expect(paid.value.changeAmount).toBe('21.0000');
      expect(paid.value.sale.status).toBe('completed');

      const movements = await database.pool.query<{ amount: string; movement_type: string; reference_type: string }>(
        `select amount::text, movement_type, reference_type from cash_movements
         where company_id=$1 and cash_session_id=$2 and reference_type='payment'`,
        [companyId, openedSession.value.id],
      );
      expect(movements.rows).toEqual([{ amount: '29.0000', movement_type: 'cash_sale', reference_type: 'payment' }]);
      const summary = await cash.summary(companyId, branchIds, openedSession.value.id);
      // 1000 (opening) + 29 (the sale's net) = 1029 — never 1050.
      expect(summary.expectedCash).toBe('1029.0000');
      expect(summary.cashSalesTotal).toBe('29.0000');
      expect(summary.cashSalesCount).toBe(1);

      // Sale's own cash register/session FKs are stamped.
      const saleRow = await database.pool.query<{ cash_register_id: string; cash_session_id: string }>(
        `select cash_register_id, cash_session_id from sales where id=$1`,
        [createdSale.value.sale.id],
      );
      expect(saleRow.rows[0]).toEqual({
        cash_register_id: register.value.id,
        cash_session_id: openedSession.value.id,
      });
    });

    it('duplicate confirmation (same idempotency key) never double-posts to the drawer', async () => {
      const register = await cash.createRegister(context, branchIds, 'reg-dupconfirm-1', {
        branchId,
        code: 'REG-DUPCONFIRM',
        name: 'Caja DupConfirm',
      });
      const openedSession = await cash.openSession(context, branchIds, 'session-dupconfirm-1', {
        cashRegisterId: register.value.id,
        openingAmount: '0',
      });
      const createdSale = await sales.createSale(context, branchIds, 'cashintegration-dupconfirm-1', {
        branchId,
        items: [{ productId, quantity: '1' }],
      });
      const first = await payments.createCashPayment(context, branchIds, 'cashintegration-dupconfirm-1-pay', {
        saleId: createdSale.value.sale.id,
        tenderedAmount: '29.00',
        cashRegisterId: register.value.id,
      });
      expect(first.replayed).toBe(false);
      const replay = await payments.createCashPayment(context, branchIds, 'cashintegration-dupconfirm-1-pay', {
        saleId: createdSale.value.sale.id,
        tenderedAmount: '29.00',
        cashRegisterId: register.value.id,
      });
      expect(replay.replayed).toBe(true);
      const count = await database.pool.query<{ count: string }>(
        `select count(*)::text as count from cash_movements where company_id=$1 and cash_session_id=$2 and reference_type='payment'`,
        [companyId, openedSession.value.id],
      );
      expect(count.rows[0]?.count).toBe('1');
      const summary = await cash.summary(companyId, branchIds, openedSession.value.id);
      expect(summary.expectedCash).toBe('29.0000');
    });

    it('the database itself refuses a second cash_sale movement for the same payment (A6/Part F durable guarantee)', async () => {
      const register = await cash.createRegister(context, branchIds, 'reg-dbuq-1', {
        branchId,
        code: 'REG-DBUQ',
        name: 'Caja DbUq',
      });
      const openedSession = await cash.openSession(context, branchIds, 'session-dbuq-1', {
        cashRegisterId: register.value.id,
        openingAmount: '0',
      });
      const createdSale = await sales.createSale(context, branchIds, 'cashintegration-dbuq-1', {
        branchId,
        items: [{ productId, quantity: '1' }],
      });
      const paid = await payments.createCashPayment(context, branchIds, 'cashintegration-dbuq-1-pay', {
        saleId: createdSale.value.sale.id,
        tenderedAmount: '29.00',
        cashRegisterId: register.value.id,
      });
      await expect(
        database.pool.query(
          `insert into cash_movements (id,company_id,branch_id,cash_session_id,movement_type,amount,currency_code,reason_code,reference_type,reference_id,occurred_at,created_by)
           values ($1,$2,$3,$4,'cash_sale','29.0000','MXN','cash_sale','payment',$5,$6,$7)`,
          [randomUUID(), companyId, branchId, openedSession.value.id, paid.value.payment.id, context.timestamp, userId],
        ),
      ).rejects.toMatchObject({ constraint: 'cash_movements_payment_reference_uq' });
    });

    it('branch isolation — a cash payment on one branch never posts to another branch\'s session', async () => {
      const registerA = await cash.createRegister(context, branchIds, 'reg-branchiso-a-1', {
        branchId,
        code: 'REG-BISO-A',
        name: 'Caja BIso A',
      });
      const sessionA = await cash.openSession(context, branchIds, 'session-branchiso-a-1', {
        cashRegisterId: registerA.value.id,
        openingAmount: '0',
      });
      const registerB = await cash.createRegister(context, branchIds, 'reg-branchiso-b-1', {
        branchId: otherBranchId,
        code: 'REG-BISO-B',
        name: 'Caja BIso B',
      });
      const sessionB = await cash.openSession(context, branchIds, 'session-branchiso-b-1', {
        cashRegisterId: registerB.value.id,
        openingAmount: '0',
      });
      const createdSale = await sales.createSale(context, branchIds, 'cashintegration-branchiso-1', {
        branchId,
        items: [{ productId, quantity: '1' }],
      });
      await payments.createCashPayment(context, branchIds, 'cashintegration-branchiso-1-pay', {
        saleId: createdSale.value.sale.id,
        tenderedAmount: '29.00',
        cashRegisterId: registerA.value.id,
      });
      const summaryB = await cash.summary(companyId, branchIds, sessionB.value.id);
      expect(summaryB.expectedCash).toBe('0.0000');
      expect(summaryB.cashSalesCount).toBe(0);
      const summaryA = await cash.summary(companyId, branchIds, sessionA.value.id);
      expect(summaryA.cashSalesCount).toBe(1);
    });

    it('tenant isolation — a cash payment never posts against another company\'s session', async () => {
      const otherRegister = await database.pool.query<{ id: string }>(
        `insert into cash_registers (id,company_id,branch_id,code,normalized_code,name,status,created_by,updated_by)
         values ($1,$2,$3,'REG-TISO','reg-tiso','Caja Tiso','active',$4,$4) returning id`,
        [randomUUID(), otherCompanyId, otherCompanyBranchId, otherCompanyUserId],
      );
      const otherRegisterId = otherRegister.rows[0]?.id;
      if (otherRegisterId === undefined) throw new Error('Expected the other-company register to exist.');
      const otherSession = await database.pool.query<{ id: string }>(
        `insert into cash_sessions (id,company_id,branch_id,cash_register_id,opened_by,opened_at,opening_amount,currency_code,status)
         values ($1,$2,$3,$4,$5,$6,'0','MXN','open') returning id`,
        [randomUUID(), otherCompanyId, otherCompanyBranchId, otherRegisterId, otherCompanyUserId, context.timestamp],
      );
      const otherSessionId = otherSession.rows[0]?.id;
      if (otherSessionId === undefined) throw new Error('Expected the other-company session to exist.');

      const register = await cash.createRegister(context, branchIds, 'reg-tenantiso-1', {
        branchId,
        code: 'REG-TENANTISO',
        name: 'Caja TenantIso',
      });
      const opened = await cash.openSession(context, branchIds, 'session-tenantiso-1', {
        cashRegisterId: register.value.id,
        openingAmount: '0',
      });
      const createdSale = await sales.createSale(context, branchIds, 'cashintegration-tenantiso-1', {
        branchId,
        items: [{ productId, quantity: '1' }],
      });
      await payments.createCashPayment(context, branchIds, 'cashintegration-tenantiso-1-pay', {
        saleId: createdSale.value.sale.id,
        tenderedAmount: '29.00',
        cashRegisterId: register.value.id,
      });
      const otherMovements = await database.pool.query(
        `select 1 from cash_movements where company_id=$1 and cash_session_id=$2`,
        [otherCompanyId, otherSessionId],
      );
      expect(otherMovements.rows).toHaveLength(0);
      const thisSummary = await cash.summary(companyId, branchIds, opened.value.id);
      expect(thisSummary.cashSalesCount).toBe(1);

      await database.pool.query('delete from cash_sessions where id=$1', [otherSessionId]);
      await database.pool.query('delete from cash_registers where id=$1', [otherRegisterId]);
    });

    it('a payment/sale/inventory/cash failure never leaves a partial commit — inventory insufficiency rolls back the entire attempt', async () => {
      const trackedProductId = randomUUID();
      const trackedVariantId = randomUUID();
      const locationId = randomUUID();
      await database.pool.query(
        `insert into products (id,company_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
         values($1,$2,'CASH-TRACKED','cash-tracked','Cash Tracked','simple',true,'IVA_EXEMPT','active',$3,$3)`,
        [trackedProductId, companyId, userId],
      );
      await database.pool.query(
        `insert into product_variants (id,company_id,product_id,sku,normalized_sku,name,unit_of_measure_code,quantity_scale,tracks_inventory,standard_cost,currency_code,is_default,option_signature,status,created_by,updated_by)
         values($1,$2,$3,'CASH-TRACKED','cash-tracked','Variante','unit',0,true,10,'MXN',true,$4,'active',$5,$5)`,
        [trackedVariantId, companyId, trackedProductId, '1'.repeat(64), userId],
      );
      await database.pool.query(
        `insert into product_prices (id,company_id,product_id,amount,currency_code,status,created_by,updated_by)
         values($1,$2,$3,'29.0000','MXN','active',$4,$4)`,
        [randomUUID(), companyId, trackedProductId, userId],
      );
      await database.pool.query(
        `insert into inventory_locations (id,company_id,branch_id,code,normalized_code,name,location_type,status,allows_receiving,allows_issuing,is_default,created_by,updated_by)
         values($1,$2,$3,'MAIN','main','Main','main','active',true,true,true,$4,$4)`,
        [locationId, companyId, branchId, userId],
      );
      await database.pool.query(
        `insert into inventory_balances (id,company_id,branch_id,inventory_location_id,product_variant_id,quantity_on_hand,quantity_reserved,quantity_in_transit,average_unit_cost,version)
         values($1,$2,$3,$4,$5,'0',0,0,0,1)`,
        [randomUUID(), companyId, branchId, locationId, trackedVariantId],
      );
      const register = await cash.createRegister(context, branchIds, 'reg-atomicity-1', {
        branchId,
        code: 'REG-ATOMIC',
        name: 'Caja Atomic',
      });
      const opened = await cash.openSession(context, branchIds, 'session-atomicity-1', {
        cashRegisterId: register.value.id,
        openingAmount: '0',
      });
      const createdSale = await sales.createSale(context, branchIds, 'cashintegration-atomicity-1', {
        branchId,
        items: [{ productId: trackedProductId, quantity: '1' }],
      });
      await expect(
        payments.createCashPayment(context, branchIds, 'cashintegration-atomicity-1-pay', {
          saleId: createdSale.value.sale.id,
          tenderedAmount: '29.00',
          cashRegisterId: register.value.id,
        }),
      ).rejects.toMatchObject({ code: 'insufficient_inventory' });

      // Nothing partially committed: no captured Payment, Sale still
      // pending, no cash movement.
      const saleRow = await sales.sale(companyId, branchIds, createdSale.value.sale.id);
      expect(saleRow.sale.status).toBe('pending_payment');
      const capturedPayments = await database.pool.query(
        `select 1 from payments where company_id=$1 and sale_id=$2 and status='captured'`,
        [companyId, createdSale.value.sale.id],
      );
      expect(capturedPayments.rows).toHaveLength(0);
      const summary = await cash.summary(companyId, branchIds, opened.value.id);
      expect(summary.expectedCash).toBe('0.0000');

      await database.pool.query('delete from sale_items where sale_id=$1', [createdSale.value.sale.id]);
      await database.pool.query('delete from sales where id=$1', [createdSale.value.sale.id]);
      await database.pool.query('delete from inventory_balances where company_id=$1 and branch_id=$2', [
        companyId,
        branchId,
      ]);
      await database.pool.query('delete from inventory_locations where id=$1', [locationId]);
      await database.pool.query('delete from product_prices where product_id=$1', [trackedProductId]);
      await database.pool.query('delete from product_variants where id=$1', [trackedVariantId]);
      await database.pool.query('delete from products where id=$1', [trackedProductId]);
    });
  });

  // TASK 16.11A §2 — the backend alone is authoritative for
  // expected_cash/counted_cash/difference. `CashService.closeSession`'s
  // own input type structurally has no `expectedClosingAmount`/
  // `discrepancyAmount` parameter at all (see its signature) — this
  // proves at runtime, against real Postgres, that no amount the client
  // submits can move `expectedClosingAmount` away from what the real
  // posted movements say, and that `discrepancyAmount` always follows
  // deterministically from `declared - expected`, never a second,
  // separately-trusted client value.
  describe('financial authority — close tamper resistance (TASK 16.11A §2)', () => {
    it('ignores a client-submitted "expected cash" attempt — the persisted value always comes from real posted movements', async () => {
      const register = await cash.createRegister(context, branchIds, 'reg-tamper-1', {
        branchId,
        code: 'REG-TAMPER-1',
        name: 'Caja Tamper 1',
      });
      const opened = await cash.openSession(context, branchIds, 'session-tamper-open-1', {
        cashRegisterId: register.value.id,
        openingAmount: '500.0000',
      });
      await cash.createMovement(context, branchIds, 'tamper-movement-in-1', opened.value.id, {
        movementType: 'cash_in',
        amount: '20.0000',
        reasonCode: 'external_income',
        category: 'external_income',
      });
      // The real, backend-computed figure: 500 + 20 = 520.
      const realSummary = await cash.summary(companyId, branchIds, opened.value.id);
      expect(realSummary.expectedCash).toBe('520.0000');

      // The service's own `closeSession` input type has no field for
      // "expected cash" or "difference" at all — there is no code path
      // through which a caller could submit `expected_cash: 999999`, even
      // an adversarial one bypassing the HTTP schema entirely and calling
      // the service directly (the strongest possible attempt). The
      // closest a caller can do is submit an absurd COUNTED total, which
      // is legitimate input (that's what a physical count IS) — and the
      // persisted `expectedClosingAmount` must still equal the real
      // figure regardless.
      const closed = await cash.closeSession(context, branchIds, 'session-tamper-close-1', opened.value.id, {
        declaredClosingAmount: '999999.0000',
      });
      expect(closed.value.expectedClosingAmount).toBe('520.0000');
      expect(closed.value.declaredClosingAmount).toBe('999999.0000');
      // difference = declared - expected, computed server-side, never a
      // second client-trusted value.
      expect(closed.value.discrepancyAmount).toBe('999479.0000');

      // Re-read from a fresh query — the persisted authoritative figures
      // survive exactly, never silently corrected or recomputed on read.
      const reread = await cash.session(companyId, branchIds, opened.value.id);
      expect(reread.expectedClosingAmount).toBe('520.0000');
      expect(reread.discrepancyAmount).toBe('999479.0000');
    });
  });

  // TASK 16.11A §6 — deterministic close/denomination scenario, run for
  // real against PostgreSQL, using generic fixtures (never hardcoded into
  // production code — see `cash.service.ts`, which has no awareness of
  // these specific numbers).
  describe('deterministic close scenario (TASK 16.11A §6)', () => {
    it('520 expected / 515 counted / -5 difference — persisted exactly, and survives a fresh reload with no client recalculation', async () => {
      const register = await cash.createRegister(context, branchIds, 'reg-det-1', {
        branchId,
        code: 'REG-DET-1',
        name: 'Caja Determinista',
      });
      const opened = await cash.openSession(context, branchIds, 'session-det-open-1', {
        cashRegisterId: register.value.id,
        openingAmount: '500.0000',
      });
      await cash.createMovement(context, branchIds, 'det-external-income-1', opened.value.id, {
        movementType: 'cash_in',
        amount: '50.0000',
        reasonCode: 'external_income',
        category: 'external_income',
      });
      await cash.createMovement(context, branchIds, 'det-expense-1', opened.value.id, {
        movementType: 'cash_out',
        amount: '30.0000',
        reasonCode: 'expense',
        category: 'expense',
      });
      await cash.createMovement(context, branchIds, 'det-withdrawal-1', opened.value.id, {
        movementType: 'cash_out',
        amount: '100.0000',
        reasonCode: 'withdrawal',
        category: 'withdrawal',
      });
      // A real $100 cash sale, exactly like the task's own scenario —
      // posted the same way a real POS checkout would (through
      // `PaymentService.createCashPayment`), never a synthetic movement.
      // A dedicated product/price (`product_prices_company_active_uq`
      // allows only one ACTIVE price per product — the shared fixture
      // `productId` is already priced at $29.00 by other tests in this
      // suite) rather than disturbing that shared fixture.
      const detProductId = randomUUID();
      await database.pool.query(
        `insert into products
         (id,company_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
         values($1,$2,'CASH-DET-PRODUCT','cash-det-product','Cash Det Product','simple',false,'IVA_EXEMPT','active',$3,$3)`,
        [detProductId, companyId, userId],
      );
      await database.pool.query(
        `insert into product_prices (id,company_id,product_id,amount,currency_code,status,created_by,updated_by)
         values($1,$2,$3,'100.0000','MXN','active',$4,$4)`,
        [randomUUID(), companyId, detProductId, userId],
      );
      const sale = await sales.createSale(context, branchIds, 'det-sale-1', {
        branchId,
        items: [{ productId: detProductId, quantity: '1' }],
      });
      expect(sale.value.sale.total).toBe('100.0000');
      await payments.createCashPayment(context, branchIds, 'det-payment-1', {
        saleId: sale.value.sale.id,
        tenderedAmount: '100.0000',
        cashRegisterId: register.value.id,
      });

      const preCloseSummary = await cash.summary(companyId, branchIds, opened.value.id);
      // 500 + 50 (external income) + 100 (cash sale) - 30 (expense) - 100
      // (withdrawal) = 520.
      expect(preCloseSummary.expectedCash).toBe('520.0000');

      const closed = await cash.closeSession(context, branchIds, 'session-det-close-1', opened.value.id, {
        declaredClosingAmount: '515.0000',
      });
      expect(closed.value.expectedClosingAmount).toBe('520.0000');
      expect(closed.value.declaredClosingAmount).toBe('515.0000');
      expect(closed.value.discrepancyAmount).toBe('-5.0000');
      expect(closed.value.status).toBe('closed');

      // Reload from history through a completely separate read path
      // (`listSessions`, the same one the "Cortes de caja" history screen
      // uses) — the exact same three figures, never client-recomputed.
      const history = await cash.listSessions(companyId, branchIds, { limit: 50 });
      const historyRow = history.items.find((item) => item.id === opened.value.id);
      expect(historyRow).toBeDefined();
      expect(historyRow?.expectedClosingAmount).toBe('520.0000');
      expect(historyRow?.declaredClosingAmount).toBe('515.0000');
      expect(historyRow?.discrepancyAmount).toBe('-5.0000');

      // And the single-session read (`GET /cash-sessions/{id}`) agrees too.
      const reread = await cash.session(companyId, branchIds, opened.value.id);
      expect(reread.expectedClosingAmount).toBe('520.0000');
      expect(reread.declaredClosingAmount).toBe('515.0000');
      expect(reread.discrepancyAmount).toBe('-5.0000');

      await database.pool.query(
        'delete from payment_attempts where payment_id in (select id from payments where sale_id=$1)',
        [sale.value.sale.id],
      );
      await database.pool.query('delete from payments where sale_id=$1', [sale.value.sale.id]);
      await database.pool.query('delete from sale_items where sale_id=$1', [sale.value.sale.id]);
      await database.pool.query('delete from sales where id=$1', [sale.value.sale.id]);
      await database.pool.query('delete from product_prices where product_id=$1', [detProductId]);
      await database.pool.query('delete from products where id=$1', [detProductId]);
    });
  });

  // --- History (Part L) --------------------------------------------------

  describe('cut history', () => {
    it('lists newest-first, paginates, and filters by branch/register/cashier/date/status', async () => {
      const register = await cash.createRegister(context, branchIds, 'reg-history-1', {
        branchId,
        code: 'REG-HISTORY',
        name: 'Caja History',
      });
      // Distinct timestamps so "newest first" ordering is deterministic
      // rather than relying on a shared-instant tiebreaker.
      const firstContext = { ...context, timestamp: new Date('2026-09-06T09:00:00.000Z') };
      const secondContext = { ...context, timestamp: new Date('2026-09-06T10:00:00.000Z') };
      const first = await cash.openSession(firstContext, branchIds, 'session-history-open-1', {
        cashRegisterId: register.value.id,
        openingAmount: '100.0000',
      });
      await cash.closeSession(firstContext, branchIds, 'session-history-close-1', first.value.id, {
        declaredClosingAmount: '100.0000',
      });
      const second = await cash.openSession(secondContext, branchIds, 'session-history-open-2', {
        cashRegisterId: register.value.id,
        openingAmount: '200.0000',
      });

      const byRegister = await cash.listSessions(companyId, branchIds, { limit: 50, cashRegisterId: register.value.id });
      expect(byRegister.items.map((item) => item.id)).toEqual([second.value.id, first.value.id]);

      const byStatus = await cash.listSessions(companyId, branchIds, { limit: 50, status: 'closed' });
      expect(byStatus.items.some((item) => item.id === first.value.id)).toBe(true);
      expect(byStatus.items.some((item) => item.id === second.value.id)).toBe(false);

      const byOpenedBy = await cash.listSessions(companyId, branchIds, { limit: 50, openedBy: userId });
      expect(byOpenedBy.items.some((item) => item.id === second.value.id)).toBe(true);

      const page1 = await cash.listSessions(companyId, branchIds, { limit: 1, cashRegisterId: register.value.id });
      expect(page1.items).toHaveLength(1);
      expect(page1.nextCursor).not.toBeNull();
    });

    it('tenant and branch isolation for cut history', async () => {
      const register = await cash.createRegister(context, branchIds, 'reg-history-iso-1', {
        branchId: otherBranchId,
        code: 'REG-HISTORY-ISO',
        name: 'Caja History Iso',
      });
      const opened = await cash.openSession(context, branchIds, 'session-history-iso-1', {
        cashRegisterId: register.value.id,
        openingAmount: '0',
      });
      const restricted = await cash.listSessions(companyId, [branchId], { limit: 50 });
      expect(restricted.items.some((item) => item.id === opened.value.id)).toBe(false);
      const crossTenant = await cash.listSessions(otherCompanyId, [otherCompanyBranchId], { limit: 50 });
      expect(crossTenant.items.some((item) => item.id === opened.value.id)).toBe(false);
    });
  });

  // --- Legacy / no hidden backfill (Part R/F) -------------------------------

  describe('legacy pre-TASK-12.7 sales', () => {
    it('a Sale completed before this feature never gains a retroactive cash session or movement', async () => {
      // Simulates a pre-12.7 completed cash Sale: no cash_register_id/
      // cash_session_id, and no restart/backfill process exists to fix
      // that after the fact — proven by direct inspection, not by
      // triggering anything.
      const legacySaleId = randomUUID();
      await database.pool.query(
        `insert into sales (id,company_id,branch_id,sale_number,status,currency_code,subtotal,discount_total,tax_total,total,occurred_at,completed_at,created_by,created_at,updated_at)
         values ($1,$2,$3,$4,'completed','MXN','25.0000','0.0000','4.0000','29.0000',$5,$5,$6,$5,$5)`,
        [legacySaleId, companyId, branchId, `SALE-${legacySaleId.replaceAll('-', '')}`, context.timestamp, userId],
      );
      const legacy = await sales.sale(companyId, branchIds, legacySaleId);
      expect(legacy.sale.cashRegisterId).toBeNull();
      expect(legacy.sale.cashSessionId).toBeNull();
      const movements = await database.pool.query(
        `select 1 from cash_movements where reference_type='payment' and reference_id in (select id from payments where sale_id=$1)`,
        [legacySaleId],
      );
      expect(movements.rows).toHaveLength(0);
      await database.pool.query('delete from sales where id=$1', [legacySaleId]);
    });
  });

  it('is a genuine CashError subclass for every domain rejection', async () => {
    await expect(
      cash.session(companyId, branchIds, randomUUID()),
    ).rejects.toBeInstanceOf(CashError);
  });
});
