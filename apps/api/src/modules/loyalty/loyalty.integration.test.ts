import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';

import { CashRepository } from '../cash/cash.repository.js';
import { CashService } from '../cash/cash.service.js';
import { CustomersRepository } from '../customers/customers.repository.js';
import { CustomersService } from '../customers/customers.service.js';
import { PaymentRepository } from '../payments/payments.repository.js';
import { PaymentService } from '../payments/payments.service.js';
import { MercadoPagoClient } from '../payments/providers/mercado-pago.client.js';
import { MercadoPagoPointProvider } from '../payments/providers/mercado-pago.provider.js';
import { SalesRepository } from '../sales/sales.repository.js';
import { SalesService } from '../sales/sales.service.js';
import { LoyaltyRepository } from './loyalty.repository.js';
import { LoyaltyService } from './loyalty.service.js';

/** TASK 13.0 — AS Rewards+ foundation: program configuration, automatic
 * earning wired through a REAL cash-sale settlement (never a synthetic
 * earn call — Part R: "no invisible business rule", proven here by a
 * company with NO active program earning nothing at all), manual
 * adjustment, and ledger-derived balances (Part Q — never a cached
 * counter). See ADR-0017. */
const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;
const migrationsPath = resolve(import.meta.dirname, '../../../../../packages/database/drizzle');

integration('PostgreSQL loyalty ledger (TASK 13.0)', { concurrent: false }, () => {
  let database: DatabaseClient;
  let sales: SalesService;
  let cash: CashService;
  let payments: PaymentService;
  let customers: CustomersService;
  let loyalty: LoyaltyService;
  const companyId = randomUUID();
  const branchId = randomUUID();
  const userId = randomUUID();
  const productId = randomUUID(); // $200.0000
  const context = {
    companyId,
    actorId: userId,
    actorPermissions: [
      'sale.create',
      'sale.read',
      'customer.create',
      'customer.read',
      'loyalty.manage',
      'loyalty.read',
      'loyalty.adjust',
    ],
    requestId: 'loy-request',
    correlationId: 'loy-correlation',
    timestamp: new Date('2026-09-04T20:00:00.000Z'),
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
    database = createDatabaseClient({ connectionString: databaseUrl, applicationName: 'asone-loyalty-integration' });
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
    await applyIfMissing('cash_registers', ['0016_jittery_slayback.sql', '0017_gifted_vertigo.sql']);
    await applyIfMissing('refunds', ['0019_nosy_the_twelve.sql']);
    await applyIfMissing('promotions', ['0020_broad_ben_grimm.sql']);
    await applyIfMissing('customers', ['0021_powerful_ezekiel_stane.sql']);

    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'Loy Co','Loy Co',$2,'active','America/Mexico_City','MXN','es-MX')`,
      [companyId, `loy-${companyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone) values($1,$2,'Loy Main','LMAIN','active','America/Mexico_City')`,
      [branchId, companyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status) values($1,$2,$2,'Loy Cashier','active')`,
      [userId, `loy-${userId}@example.test`],
    );
    await database.pool.query(`insert into company_memberships(id,company_id,user_id,status) values($1,$2,$3,'active')`, [
      randomUUID(),
      companyId,
      userId,
    ]);
    await database.pool.query(
      `insert into products (id,company_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
       values($1,$2,'LOY-GENERAL','loy-general','Loy Product','simple',false,'IVA_EXEMPT','active',$3,$3)`,
      [productId, companyId, userId],
    );
    await database.pool.query(
      `insert into product_prices (id,company_id,product_id,amount,currency_code,status,created_by,updated_by)
       values($1,$2,$3,'200.0000','MXN','active',$4,$4)`,
      [randomUUID(), companyId, productId, userId],
    );

    const salesRepository = new SalesRepository(database);
    const customersRepository = new CustomersRepository(database);
    customers = new CustomersService(customersRepository);
    sales = new SalesService(salesRepository, undefined, customersRepository);
    const cashRepository = new CashRepository(database);
    cash = new CashService(cashRepository);
    const paymentRepository = new PaymentRepository(database);
    const mercadoPagoProvider = new MercadoPagoPointProvider(
      new MercadoPagoClient({ accessToken: undefined, apiBaseUrl: 'https://api.mercadopago.com' }),
    );
    const loyaltyRepository = new LoyaltyRepository(database);
    loyalty = new LoyaltyService(loyaltyRepository);
    payments = new PaymentService(paymentRepository, salesRepository, mercadoPagoProvider, cashRepository, undefined, loyalty);
  });

  afterEach(async () => {
    await database.pool.query('delete from payment_attempts where company_id=$1', [companyId]);
    await database.pool.query('delete from payments where company_id=$1', [companyId]);
    await database.pool.query('delete from loyalty_ledger where company_id=$1', [companyId]);
    await database.pool.query('delete from loyalty_accounts where company_id=$1', [companyId]);
    await database.pool.query('delete from loyalty_programs where company_id=$1', [companyId]);
    await database.pool.query('delete from sale_items where company_id=$1', [companyId]);
    await database.pool.query('delete from sales where company_id=$1', [companyId]);
    await database.pool.query('delete from cash_movements where company_id=$1', [companyId]);
    await database.pool.query('delete from cash_sessions where company_id=$1', [companyId]);
    await database.pool.query('delete from cash_registers where company_id=$1', [companyId]);
    await database.pool.query('delete from customers where company_id=$1', [companyId]);
    await database.pool.query('delete from idempotency_keys where company_id=$1', [companyId]);
  });

  afterAll(async () => {
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

  async function createProgram(
    key: string,
    overrides: Partial<Parameters<LoyaltyService['createProgram']>[2]> = {},
  ): Promise<Awaited<ReturnType<LoyaltyService['createProgram']>>['value']> {
    const created = await loyalty.createProgram(context, key, {
      name: `Program ${key}`,
      active: true,
      unitType: 'stamp',
      ...overrides,
    });
    return created.value;
  }

  async function buyForCustomer(keySuffix: string, customerId: string, tendered = '200.0000'): Promise<{ saleId: string }> {
    const register = await cash.createRegister(context, branchIds, `reg-${keySuffix}`, {
      branchId,
      code: `REG-${keySuffix}`,
      name: `Caja ${keySuffix}`,
    });
    await cash.openSession(context, branchIds, `session-${keySuffix}`, { cashRegisterId: register.value.id, openingAmount: '0.0000' });
    const createdSale = await sales.createSale(context, branchIds, `sale-${keySuffix}`, {
      branchId,
      customerId,
      items: [{ productId, quantity: '1' }],
    });
    await payments.createCashPayment(context, branchIds, `pay-${keySuffix}`, {
      saleId: createdSale.value.sale.id,
      tenderedAmount: tendered,
      cashRegisterId: register.value.id,
    });
    return { saleId: createdSale.value.sale.id };
  }

  describe('program configuration (Part S) — no invisible business rule (Part R)', () => {
    it('a brand-new program defaults to INACTIVE even when the caller omits `active`', async () => {
      const created = await loyalty.createProgram(context, 'prog-default-1', { name: 'Default', unitType: 'stamp' });
      expect(created.value.active).toBe(false);
    });

    it('with NO active program at all, a completed sale earns nothing', async () => {
      const customer = await customers.createCustomer(context, 'cust-noprogram-1', { firstName: 'Pedro' });
      await buyForCustomer('noprogram-1', customer.value.id);
      const summary = await loyalty.summary(context, customer.value.id);
      expect(summary.account).toBeNull();
      expect(summary.balances).toHaveLength(0);
    });
  });

  describe('automatic earning on sale settlement (Part R)', () => {
    it('an active program earns exactly one stamp per qualifying completed sale', async () => {
      await createProgram('prog-earn-1');
      const customer = await customers.createCustomer(context, 'cust-earn-1', { firstName: 'Quintana' });
      await buyForCustomer('earn-1', customer.value.id);
      const summary = await loyalty.summary(context, customer.value.id);
      expect(summary.account).not.toBeNull();
      expect(summary.balances).toHaveLength(1);
      expect(summary.balances[0]?.programId).toEqual(expect.any(String));
      expect(summary.balances[0]?.unitType).toBe('stamp');
      expect(summary.balances[0]?.balance).toBe(1);
      expect(summary.ledger).toHaveLength(1);
      expect(summary.ledger[0]?.entryType).toBe('earn');
      expect(summary.ledger[0]?.sourceType).toBe('sale');
    });

    it('a sale below the program\'s minimum_sale_total does not earn', async () => {
      await createProgram('prog-minimum-1', { minimumSaleTotal: '500.0000' });
      const customer = await customers.createCustomer(context, 'cust-minimum-1', { firstName: 'Rosa' });
      await buyForCustomer('minimum-1', customer.value.id); // sale total well under 500
      const summary = await loyalty.summary(context, customer.value.id);
      expect(summary.account).toBeNull();
    });

    it('a walk-in sale (no customer) never earns, even with an active program', async () => {
      await createProgram('prog-walkin-1');
      const register = await cash.createRegister(context, branchIds, 'reg-walkin-1', { branchId, code: 'REG-WALKIN-1', name: 'Caja Walkin' });
      await cash.openSession(context, branchIds, 'session-walkin-1', { cashRegisterId: register.value.id, openingAmount: '0.0000' });
      const createdSale = await sales.createSale(context, branchIds, 'sale-walkin-1', { branchId, items: [{ productId, quantity: '1' }] });
      await payments.createCashPayment(context, branchIds, 'pay-walkin-1', {
        saleId: createdSale.value.sale.id,
        tenderedAmount: '200.0000',
        cashRegisterId: register.value.id,
      });
      const count = await database.pool.query<{ n: number }>('select count(*)::int as n from loyalty_ledger where company_id=$1', [companyId]);
      expect(count.rows[0]?.n).toBe(0);
    });

    it('idempotency: a retried/replayed settlement never double-earns for the same sale', async () => {
      await createProgram('prog-retry-1');
      const customer = await customers.createCustomer(context, 'cust-loyretry-1', { firstName: 'Santiago' });
      const register = await cash.createRegister(context, branchIds, 'reg-loyretry-1', { branchId, code: 'REG-LOYRETRY-1', name: 'Caja Retry' });
      await cash.openSession(context, branchIds, 'session-loyretry-1', { cashRegisterId: register.value.id, openingAmount: '0.0000' });
      const createdSale = await sales.createSale(context, branchIds, 'sale-loyretry-1', {
        branchId,
        customerId: customer.value.id,
        items: [{ productId, quantity: '1' }],
      });
      await payments.createCashPayment(context, branchIds, 'pay-loyretry-1-SAME-KEY', {
        saleId: createdSale.value.sale.id,
        tenderedAmount: '200.0000',
        cashRegisterId: register.value.id,
      });
      await payments.createCashPayment(context, branchIds, 'pay-loyretry-1-SAME-KEY', {
        saleId: createdSale.value.sale.id,
        tenderedAmount: '200.0000',
        cashRegisterId: register.value.id,
      });
      const summary = await loyalty.summary(context, customer.value.id);
      expect(summary.ledger).toHaveLength(1);
      expect(summary.balances[0]?.balance).toBe(1);
    });

    it('balance is always derived from the ledger sum, never a cached counter — repeated sales accumulate correctly', async () => {
      await createProgram('prog-accumulate-1');
      const customer = await customers.createCustomer(context, 'cust-accumulate-1', { firstName: 'Teresa' });
      await buyForCustomer('accumulate-1a', customer.value.id);
      await buyForCustomer('accumulate-1b', customer.value.id);
      await buyForCustomer('accumulate-1c', customer.value.id);
      const summary = await loyalty.summary(context, customer.value.id);
      expect(summary.balances[0]?.balance).toBe(3);
      expect(summary.ledger).toHaveLength(3);
    });
  });

  describe('manual adjustment — separately permissioned (Part Y)', () => {
    it('rejects a manual adjustment from an actor lacking loyalty.adjust', async () => {
      const customer = await customers.createCustomer(context, 'cust-adjust-perm-1', { firstName: 'Ursula' });
      const noPermissionContext = { ...context, actorPermissions: ['loyalty.read'] };
      await expect(
        loyalty.adjust(noPermissionContext, 'adjust-perm-1', {
          customerId: customer.value.id,
          quantity: 5,
          unitType: 'point',
          reason: 'Compensation',
        }),
        // TASK 16.23A — was 'validation_error' (400), a status-code
        // contract bug found by a pre-launch audit; fixed to the
        // correctly-403 'permission_denied' every other permission
        // check in this codebase already uses.
      ).rejects.toMatchObject({ code: 'permission_denied' });
    });

    it('records a signed manual adjustment with a required reason and actor, lazily creating the account', async () => {
      const customer = await customers.createCustomer(context, 'cust-adjust-1', { firstName: 'Victor' });
      const adjusted = await loyalty.adjust(context, 'adjust-1', {
        customerId: customer.value.id,
        quantity: 10,
        unitType: 'point',
        reason: 'Goodwill gesture',
      });
      expect(adjusted.value.entryType).toBe('adjustment');
      expect(adjusted.value.quantity).toBe(10);
      const summary = await loyalty.summary(context, customer.value.id);
      expect(summary.balances[0]?.balance).toBe(10);
    });

    it('rejects a zero-quantity adjustment and a blank reason', async () => {
      const customer = await customers.createCustomer(context, 'cust-adjust-invalid-1', { firstName: 'Wendy' });
      await expect(
        loyalty.adjust(context, 'adjust-invalid-1a', { customerId: customer.value.id, quantity: 0, unitType: 'point', reason: 'x' }),
      ).rejects.toMatchObject({ code: 'validation_error' });
      await expect(
        loyalty.adjust(context, 'adjust-invalid-1b', { customerId: customer.value.id, quantity: 5, unitType: 'point', reason: '   ' }),
      ).rejects.toMatchObject({ code: 'validation_error' });
    });

    it('idempotency: retrying the same adjustment key never double-adjusts', async () => {
      const customer = await customers.createCustomer(context, 'cust-adjust-retry-1', { firstName: 'Ximena' });
      const first = await loyalty.adjust(context, 'adjust-retry-SAME-KEY', {
        customerId: customer.value.id,
        quantity: 3,
        unitType: 'stamp',
        reason: 'Retry test',
      });
      const replay = await loyalty.adjust(context, 'adjust-retry-SAME-KEY', {
        customerId: customer.value.id,
        quantity: 3,
        unitType: 'stamp',
        reason: 'Retry test',
      });
      expect(replay.replayed).toBe(true);
      expect(replay.value.id).toBe(first.value.id);
      const summary = await loyalty.summary(context, customer.value.id);
      expect(summary.balances[0]?.balance).toBe(3);
    });
  });

  describe('tenant isolation', () => {
    it('loyalty.read is required to view a summary', async () => {
      const customer = await customers.createCustomer(context, 'cust-tenant-loy-1', { firstName: 'Yolanda' });
      const noPermissionContext = { ...context, actorPermissions: [] };
      await expect(loyalty.summary(noPermissionContext, customer.value.id)).rejects.toMatchObject({
        code: 'permission_denied',
      });
    });
  });

  // TASK 13.1 — the reward-bearing extension to program configuration
  // (`reward_threshold`/`reward_type`/`reward_expiration_days`/
  // `reward_repeatable`). See `loyalty.service.ts#createProgram`'s own
  // pre-check comment and the DB's `loyalty_programs_reward_pair_ck`: a
  // program is either NOT reward-bearing at all (both null — a plain
  // earn-only program, unchanged from TASK 13.0) or has BOTH a threshold
  // and a type, never just one. The actual issuance behavior this unlocks
  // (automatic/manual issuance, redemption, revocation, tokens) is
  // exercised end to end in `../rewards/rewards.integration.test.ts`, not
  // here — this block only covers program CONFIGURATION.
  describe('reward-bearing program configuration (TASK 13.1)', () => {
    it('rejects a reward_threshold set without a reward_type (an "eligible for nothing" dead configuration)', async () => {
      await expect(
        loyalty.createProgram(context, 'prog-rewardpair-mismatch-1', {
          name: 'Mismatch',
          unitType: 'stamp',
          rewardThreshold: 5,
        }),
      ).rejects.toMatchObject({ code: 'validation_error' });
    });

    it('accepts a reward_threshold and reward_type set together', async () => {
      const created = await createProgram('prog-rewardpair-both-1', {
        rewardThreshold: 5,
        rewardType: 'vip_pass',
        rewardExpirationDays: 30,
        rewardRepeatable: false,
      });
      expect(created.rewardThreshold).toBe(5);
      expect(created.rewardType).toBe('vip_pass');
      expect(created.rewardExpirationDays).toBe(30);
      expect(created.rewardRepeatable).toBe(false);
    });

    it('accepts neither reward_threshold nor reward_type — a plain earn-only program with nothing configured', async () => {
      const created = await createProgram('prog-rewardpair-neither-1');
      expect(created.rewardThreshold).toBeNull();
      expect(created.rewardType).toBeNull();
      expect(created.rewardExpirationDays).toBeNull();
      // Defaults `true` even for a non-reward-bearing program — see
      // `createProgram`'s own doc comment; the column simply goes unread
      // unless `reward_type` is also set.
      expect(created.rewardRepeatable).toBe(true);
    });
  });
});
