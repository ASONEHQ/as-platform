import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';

import { CashRepository } from '../cash/cash.repository.js';
import { CashService } from '../cash/cash.service.js';
import { CustomersRepository } from '../customers/customers.repository.js';
import { CustomersService } from '../customers/customers.service.js';
import { LoyaltyRepository } from '../loyalty/loyalty.repository.js';
import { LoyaltyService } from '../loyalty/loyalty.service.js';
import { PaymentRepository } from '../payments/payments.repository.js';
import { PaymentService } from '../payments/payments.service.js';
import { MercadoPagoClient } from '../payments/providers/mercado-pago.client.js';
import { MercadoPagoPointProvider } from '../payments/providers/mercado-pago.provider.js';
import { RewardsRepository } from '../rewards/rewards.repository.js';
import { RewardsService } from '../rewards/rewards.service.js';
import { SalesRepository } from '../sales/sales.repository.js';
import { SalesService } from '../sales/sales.service.js';
import { RefundsRepository } from './refunds.repository.js';
import { RefundsService } from './refunds.service.js';

/** TASK 16.21 (Phase 37 "Returns/refunds effect") — a FULL refund of a
 * sale that already earned loyalty progress and/or caused a reward to be
 * automatically issued must genuinely REVERSE that progress, never leave
 * a mathematically impossible "refunded but still counted" state — but
 * must also never retroactively claw back a reward the customer already
 * REDEEMED before the refund happened (an honest, non-destructive
 * semantics, not a silent fake-green no-op). Proven through a REAL
 * cash-sale settlement → REAL full-refund completion, never a synthetic
 * service call to the reversal hooks directly. */
const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;
const migrationsPath = resolve(import.meta.dirname, '../../../../../packages/database/drizzle');

integration('PostgreSQL refund loyalty/reward reversal (TASK 16.21 Phase 37)', { concurrent: false }, () => {
  let database: DatabaseClient;
  let sales: SalesService;
  let cash: CashService;
  let payments: PaymentService;
  let customers: CustomersService;
  let loyalty: LoyaltyService;
  let loyaltyRepository: LoyaltyRepository;
  let rewards: RewardsService;
  let refunds: RefundsService;

  const companyId = randomUUID();
  const branchId = randomUUID();
  const userId = randomUUID();
  const productId = randomUUID(); // $50.0000, IVA_EXEMPT

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
      'reward.read',
      'reward.redeem',
      'refund.create',
      'refund.approve',
      'refund.complete',
      'refund.read',
    ],
    requestId: 'rlr-request',
    correlationId: 'rlr-correlation',
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
    database = createDatabaseClient({ connectionString: databaseUrl, applicationName: 'asone-refund-loyalty-reversal-integration' });
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
    await applyIfMissing('reward_entitlements', ['0022_cheerful_scrambler.sql']);
    await applyIfMissing('sale_reward_usages', ['0023_tan_luke_cage.sql']);
    // TASK 16.21 — widens `loyalty_ledger_source_type_ck` to also allow
    // `'refund'` (the reversal entry's own source type).
    await database.pool.query(
      `select conname from pg_constraint where conname='loyalty_ledger_source_type_ck'`,
    ); // presence check only; the widened constraint is applied unconditionally below if still narrow.
    const widened = await database.pool.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint where conname='loyalty_ledger_source_type_ck'`,
    );
    if (widened.rows[0] !== undefined && !widened.rows[0].def.includes("'refund'")) {
      const sql = await readFile(resolve(migrationsPath, '0045_mixed_infant_terrible.sql'), 'utf8');
      for (const statement of sql.split('--> statement-breakpoint'))
        if (statement.trim().length > 0) await database.pool.query(statement);
    }

    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'Rlr Co','Rlr Co',$2,'active','America/Mexico_City','MXN','es-MX')`,
      [companyId, `rlr-${companyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'Rlr Main','RLRMAIN','active','America/Mexico_City')`,
      [branchId, companyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status) values($1,$2,$2,'Rlr Cashier','active')`,
      [userId, `rlr-${userId}@example.test`],
    );
    await database.pool.query(`insert into company_memberships(id,company_id,user_id,status) values($1,$2,$3,'active')`, [
      randomUUID(),
      companyId,
      userId,
    ]);
    await database.pool.query(
      `insert into products (id,company_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
       values($1,$2,'RLR-A','rlr-a','Product A','simple',false,'IVA_EXEMPT','active',$3,$3)`,
      [productId, companyId, userId],
    );
    await database.pool.query(
      `insert into product_prices (id,company_id,product_id,amount,currency_code,status,created_by,updated_by)
       values($1,$2,$3,'50.0000','MXN','active',$4,$4)`,
      [randomUUID(), companyId, productId, userId],
    );

    const salesRepository = new SalesRepository(database);
    const customersRepository = new CustomersRepository(database);
    customers = new CustomersService(customersRepository);
    loyaltyRepository = new LoyaltyRepository(database);
    loyalty = new LoyaltyService(loyaltyRepository);
    const rewardsRepository = new RewardsRepository(database);
    rewards = new RewardsService(rewardsRepository, loyaltyRepository, customersRepository);
    sales = new SalesService(salesRepository, undefined, customersRepository);
    const cashRepository = new CashRepository(database);
    cash = new CashService(cashRepository);
    const paymentRepository = new PaymentRepository(database);
    const mercadoPagoProvider = new MercadoPagoPointProvider(
      new MercadoPagoClient({ accessToken: undefined, apiBaseUrl: 'https://api.mercadopago.com' }),
    );
    // TASK 13.1 — `loyalty`/`rewards` as the 6th/7th args: settlement
    // triggers `earnFromSale` then `evaluateAutomaticIssuance`, exactly
    // like real production wiring.
    payments = new PaymentService(paymentRepository, salesRepository, mercadoPagoProvider, cashRepository, undefined, loyalty, rewards);
    const refundsRepository = new RefundsRepository(database);
    // TASK 16.21 — `loyalty`/`rewards` as the 5th/6th args: a completed
    // FULL refund reverses both, in that same transaction.
    refunds = new RefundsService(refundsRepository, paymentRepository, cashRepository, mercadoPagoProvider, loyalty, rewards);
  });

  afterEach(async () => {
    await database.pool.query('delete from refund_items where company_id=$1', [companyId]);
    await database.pool.query('delete from refunds where company_id=$1', [companyId]);
    await database.pool.query('delete from sale_reward_usages where company_id=$1', [companyId]);
    await database.pool.query('delete from reward_entitlement_tokens where company_id=$1', [companyId]);
    await database.pool.query('delete from reward_entitlements where company_id=$1', [companyId]);
    await database.pool.query('delete from payment_attempts where company_id=$1', [companyId]);
    await database.pool.query('delete from payments where company_id=$1', [companyId]);
    await database.pool.query('delete from loyalty_ledger where company_id=$1', [companyId]);
    await database.pool.query('delete from loyalty_accounts where company_id=$1', [companyId]);
    await database.pool.query('delete from loyalty_program_reward_products where company_id=$1', [companyId]);
    await database.pool.query('delete from loyalty_program_reward_categories where company_id=$1', [companyId]);
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

  /** A QA-convenience threshold of 1 — this task's own spec is explicit
   * that any such test threshold is "test-convenience value only, never
   * hardcoded in shared logic" (the engine itself has no hardcoded
   * threshold anywhere; this is purely this test's own fixture). */
  async function createProgram(key: string): Promise<{ id: string }> {
    const created = await loyalty.createProgram(context, key, {
      name: `Program ${key}`,
      active: true,
      unitType: 'point',
      earnQuantityPerSale: 1,
      rewardThreshold: 1,
      rewardType: 'vip_pass',
      rewardRepeatable: true,
    });
    return created.value;
  }

  async function buyAndSettle(keySuffix: string, customerId: string): Promise<{ saleId: string }> {
    const register = await cash.createRegister(context, branchIds, `reg-${keySuffix}`, {
      branchId,
      code: `REG-${keySuffix}`,
      name: `Caja ${keySuffix}`,
    });
    await cash.openSession(context, branchIds, `session-${keySuffix}`, {
      cashRegisterId: register.value.id,
      openingAmount: '1000.0000',
    });
    const createdSale = await sales.createSale(context, branchIds, `sale-${keySuffix}`, {
      branchId,
      customerId,
      items: [{ productId, quantity: '1' }],
    });
    await payments.createCashPayment(context, branchIds, `pay-${keySuffix}`, {
      saleId: createdSale.value.sale.id,
      tenderedAmount: '50.0000',
      cashRegisterId: register.value.id,
    });
    return { saleId: createdSale.value.sale.id };
  }

  async function refundSaleInFull(keySuffix: string, saleId: string): Promise<void> {
    const created = await refunds.createRefund(context, branchIds, `refund-create-${keySuffix}`, {
      saleId,
      reasonCode: 'customer_request',
      items: [{ saleItemId: (await saleItemIdFor(saleId)), quantity: '1' }],
    });
    await refunds.completeRefund(context, branchIds, `refund-complete-${keySuffix}`, created.value.id, {});
  }

  async function saleItemIdFor(saleId: string): Promise<string> {
    const row = await database.pool.query<{ id: string }>('select id from sale_items where sale_id=$1', [saleId]);
    const id = row.rows[0]?.id;
    if (id === undefined) throw new Error('Expected a sale item.');
    return id;
  }

  describe('loyalty earn reversal', () => {
    it('a full refund inserts a negative earn entry and brings the cumulative total back to zero', async () => {
      const program = await createProgram('earn-reverse-1');
      const customer = await customers.createCustomer(context, 'cust-earn-reverse-1', { firstName: 'Nadia' });
      const { saleId } = await buyAndSettle('earn-reverse-1', customer.value.id);

      const account = await loyaltyRepository.accountByCustomerId(null, companyId, customer.value.id);
      if (account === null) throw new Error('Expected a loyalty account after settlement.');
      const before = await loyaltyRepository.cumulativeEarnedUnits(database.pool, companyId, account.id, program.id);
      expect(before).toBe(1);

      await refundSaleInFull('earn-reverse-1', saleId);

      const after = await loyaltyRepository.cumulativeEarnedUnits(database.pool, companyId, account.id, program.id);
      expect(after).toBe(0);

      const reversalRows = await database.pool.query<{ quantity: number; source_type: string }>(
        "select quantity, source_type from loyalty_ledger where company_id=$1 and loyalty_account_id=$2 and source_type='refund'",
        [companyId, account.id],
      );
      expect(reversalRows.rows).toHaveLength(1);
      expect(reversalRows.rows[0]?.quantity).toBe(-1);
    });
  });

  describe('reward revocation on refund', () => {
    it('revokes a still-AVAILABLE auto-issued reward once its threshold is no longer reached', async () => {
      const program = await createProgram('reward-revoke-1');
      const customer = await customers.createCustomer(context, 'cust-reward-revoke-1', { firstName: 'Omar' });
      const { saleId } = await buyAndSettle('reward-revoke-1', customer.value.id);

      const issued = await rewards.entitlementsForCustomer(context, customer.value.id);
      expect(issued).toHaveLength(1);
      expect(issued[0]?.status).toBe('available');
      expect(issued[0]?.loyaltyProgramId).toBe(program.id);

      await refundSaleInFull('reward-revoke-1', saleId);

      const afterRefund = await rewards.entitlementsForCustomer(context, customer.value.id);
      expect(afterRefund).toHaveLength(1);
      expect(afterRefund[0]?.status).toBe('revoked');
      expect(afterRefund[0]?.revokedReason).toContain('Automatic reversal');
    });

    it('never claws back a reward the customer already REDEEMED before the refund (honest, non-destructive semantics)', async () => {
      await createProgram('reward-redeemed-1');
      const customer = await customers.createCustomer(context, 'cust-reward-redeemed-1', { firstName: 'Paula' });
      const { saleId } = await buyAndSettle('reward-redeemed-1', customer.value.id);

      const issued = await rewards.entitlementsForCustomer(context, customer.value.id);
      const entitlement = issued[0];
      if (entitlement === undefined) throw new Error('Expected an issued entitlement.');
      await rewards.redeem(context, 'redeem-before-refund-1', entitlement.id, branchId);

      await refundSaleInFull('reward-redeemed-1', saleId);

      const afterRefund = await rewards.entitlementsForCustomer(context, customer.value.id);
      expect(afterRefund).toHaveLength(1);
      // Still 'redeemed' — a refund never retroactively un-redeems an
      // already-consumed reward; that redemption is a closed historical
      // fact with its own evidence.
      expect(afterRefund[0]?.status).toBe('redeemed');
    });
  });
});
