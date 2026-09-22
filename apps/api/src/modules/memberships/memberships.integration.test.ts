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
import { MembershipsRepository } from './memberships.repository.js';
import { MembershipsService } from './memberships.service.js';

/** TASK 13.0 — the membership plan/purchase/activation/renewal/validation
 * lifecycle, wired end to end through a REAL cash-sale completion — never
 * a synthetic activation call, since the entire point (Part K/L) is that
 * activation happens at the exact moment a Sale genuinely settles, not
 * before. See ADR-0017. */
const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;
const migrationsPath = resolve(import.meta.dirname, '../../../../../packages/database/drizzle');

integration('PostgreSQL memberships lifecycle (TASK 13.0)', { concurrent: false }, () => {
  let database: DatabaseClient;
  let sales: SalesService;
  let cash: CashService;
  let payments: PaymentService;
  let customers: CustomersService;
  let memberships: MembershipsService;
  const companyId = randomUUID();
  const branchId = randomUUID();
  const otherBranchId = randomUUID();
  const userId = randomUUID();
  const membershipProductId = randomUUID(); // $500.0000, sells the plan
  const plainProductId = randomUUID(); // $10.0000, unrelated product
  const context = {
    companyId,
    actorId: userId,
    actorPermissions: [
      'sale.create',
      'sale.read',
      'customer.create',
      'customer.read',
      'membership.manage',
      'membership.issue',
      'membership.read',
    ],
    requestId: 'mem-request',
    correlationId: 'mem-correlation',
    timestamp: new Date('2026-09-04T20:00:00.000Z'),
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
    database = createDatabaseClient({ connectionString: databaseUrl, applicationName: 'asone-memberships-integration' });
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
       values($1,'Mem Co','Mem Co',$2,'active','America/Mexico_City','MXN','es-MX')`,
      [companyId, `mem-${companyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'Mem Main','MMAIN','active','America/Mexico_City'),
             ($3,$2,'Mem Second','MSECOND','active','America/Mexico_City')`,
      [branchId, companyId, otherBranchId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status) values($1,$2,$2,'Mem Cashier','active')`,
      [userId, `mem-${userId}@example.test`],
    );
    await database.pool.query(`insert into company_memberships(id,company_id,user_id,status) values($1,$2,$3,'active')`, [
      randomUUID(),
      companyId,
      userId,
    ]);
    await database.pool.query(
      `insert into products (id,company_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
       values($1,$2,'MEM-PLAN','mem-plan','Membresia Mensual','service',false,'IVA_EXEMPT','active',$3,$3),
             ($4,$2,'MEM-PLAIN','mem-plain','Plain Product','simple',false,'IVA_GENERAL','active',$3,$3)`,
      [membershipProductId, companyId, userId, plainProductId],
    );
    await database.pool.query(
      `insert into product_prices (id,company_id,product_id,amount,currency_code,status,created_by,updated_by)
       values($1,$2,$3,'500.0000','MXN','active',$4,$4),
             ($5,$2,$6,'10.0000','MXN','active',$4,$4)`,
      [randomUUID(), companyId, membershipProductId, userId, randomUUID(), plainProductId],
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
    const membershipsRepository = new MembershipsRepository(database);
    memberships = new MembershipsService(membershipsRepository);
    payments = new PaymentService(paymentRepository, salesRepository, mercadoPagoProvider, cashRepository, memberships, undefined);
  });

  afterEach(async () => {
    await database.pool.query('delete from payment_attempts where company_id=$1', [companyId]);
    await database.pool.query('delete from payments where company_id=$1', [companyId]);
    await database.pool.query('delete from customer_memberships where company_id=$1', [companyId]);
    await database.pool.query('delete from membership_plan_branches where company_id=$1', [companyId]);
    // TASK 16.21 — the two new benefit-scope tables are restrict-FK
    // children of `membership_plans` (mirrors `promotion_products`/
    // `promotion_categories`' own precedent); must be cleared BEFORE the
    // plans themselves or this delete fails and leaks plan rows (with
    // their `product_id`) into the next test, breaking `membership_plans_
    // company_product_uq`.
    await database.pool.query('delete from membership_plan_benefit_products where company_id=$1', [companyId]);
    await database.pool.query('delete from membership_plan_benefit_categories where company_id=$1', [companyId]);
    await database.pool.query('delete from membership_plans where company_id=$1', [companyId]);
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

  async function createPlan(
    key: string,
    overrides: Partial<Parameters<MembershipsService['createPlan']>[2]> = {},
  ): Promise<Awaited<ReturnType<MembershipsService['createPlan']>>['value']> {
    const created = await memberships.createPlan(context, key, {
      name: `Plan ${key}`,
      productId: membershipProductId,
      durationDays: 30,
      ...overrides,
    });
    return created.value;
  }

  /** Opens a register+session, creates a Sale with a customer attached,
   * and completes it with an exact cash payment — the one real path a
   * membership can ever activate through. */
  async function buyMembershipForCustomer(
    keySuffix: string,
    customerId: string,
    forBranchId: string = branchId,
  ): Promise<{ saleId: string }> {
    const register = await cash.createRegister(context, branchIds, `reg-${keySuffix}`, {
      branchId: forBranchId,
      code: `REG-${keySuffix}`,
      name: `Caja ${keySuffix}`,
    });
    await cash.openSession(context, branchIds, `session-${keySuffix}`, {
      cashRegisterId: register.value.id,
      openingAmount: '1000.0000',
    });
    const createdSale = await sales.createSale(context, branchIds, `sale-${keySuffix}`, {
      branchId: forBranchId,
      customerId,
      items: [{ productId: membershipProductId, quantity: '1' }],
    });
    await payments.createCashPayment(context, branchIds, `pay-${keySuffix}`, {
      saleId: createdSale.value.sale.id,
      tenderedAmount: '500.0000',
      cashRegisterId: register.value.id,
    });
    return { saleId: createdSale.value.sale.id };
  }

  describe('membership plans (Part J)', () => {
    it('creates, reads, and updates a plan', async () => {
      const created = await createPlan('plan-crud-1');
      expect(created.name).toBe('Plan plan-crud-1');
      expect(created.durationDays).toBe(30);
      const read = await memberships.plan(context, created.id);
      expect(read.id).toBe(created.id);
      const updated = await memberships.updatePlan(context, created.id, created.version, { active: false });
      expect(updated.active).toBe(false);
    });

    it('branch scope: empty means all branches; a non-empty scope restricts activation to those branches', async () => {
      const created = await createPlan('plan-branchscope-1', { branchIds: [otherBranchId] });
      expect(created.branchIds).toEqual([otherBranchId]);
    });
  });

  describe('membership benefit fields (TASK 16.21)', () => {
    it('creates a plan with a structured percentage benefit scoped to a product', async () => {
      const created = await createPlan('plan-benefit-1', {
        benefitType: 'percentage_discount',
        benefitPercentageBasisPoints: 1000,
        benefitProductIds: [plainProductId],
      });
      expect(created.benefitType).toBe('percentage_discount');
      expect(created.benefitPercentageBasisPoints).toBe(1000);
      expect(created.benefitProductIds).toEqual([plainProductId]);
      expect(created.benefitCategoryIds).toEqual([]);
      const read = await memberships.plan(context, created.id);
      expect(read.benefitType).toBe('percentage_discount');
      expect(read.benefitProductIds).toEqual([plainProductId]);
    });

    it('an empty benefit scope is valid — "applies to every eligible product", never rejected as incomplete', async () => {
      const created = await createPlan('plan-benefit-emptyscope-1', {
        benefitType: 'fixed_amount_discount',
        benefitFixedAmount: '25.0000',
      });
      expect(created.benefitProductIds).toEqual([]);
      expect(created.benefitCategoryIds).toEqual([]);
    });

    it('rejects a benefit_type with no matching value (percentage_discount without basis points)', async () => {
      await expect(
        memberships.createPlan(context, 'plan-benefit-halfset-1', {
          name: 'Half-set',
          benefitType: 'percentage_discount',
        }),
      ).rejects.toThrow(/benefit_percentage_basis_points/);
    });

    it('rejects a benefit value with no benefit_type', async () => {
      await expect(
        memberships.createPlan(context, 'plan-benefit-novaluetype-1', {
          name: 'No type',
          benefitFixedAmount: '10.0000',
        }),
      ).rejects.toThrow(/benefit_type/);
    });

    it('rejects percentage_discount mixed with a fixed amount on the same plan', async () => {
      await expect(
        memberships.createPlan(context, 'plan-benefit-mixed-1', {
          name: 'Mixed',
          benefitType: 'percentage_discount',
          benefitPercentageBasisPoints: 1000,
          benefitFixedAmount: '5.0000',
        }),
      ).rejects.toThrow(/benefit_fixed_amount/);
    });

    it('updatePlan validates against the MERGED final shape, not the partial input in isolation', async () => {
      const plan = await createPlan('plan-benefit-update-1', {
        benefitType: 'fixed_price',
        benefitFixedAmount: '80.0000',
      });
      // Only touching the fixed amount — must NOT be rejected as
      // "missing benefit_type" since the plan already has one.
      const updated = await memberships.updatePlan(context, plan.id, plan.version, { benefitFixedAmount: '70.0000' });
      expect(updated.benefitType).toBe('fixed_price');
      expect(updated.benefitFixedAmount).toBe('70.0000');
    });

    it('updatePlan replaces the benefit scope entirely when new product/category ids are supplied', async () => {
      const plan = await createPlan('plan-benefit-rescope-1', {
        benefitType: 'percentage_discount',
        benefitPercentageBasisPoints: 1000,
        benefitProductIds: [plainProductId],
      });
      const updated = await memberships.updatePlan(context, plan.id, plan.version, {
        benefitProductIds: [membershipProductId],
      });
      expect(updated.benefitProductIds).toEqual([membershipProductId]);
    });
  });

  describe('purchase through Sale and activation boundary (Part K/L)', () => {
    it('no activation before payment: while the sale is still pending_payment, no CustomerMembership row exists', async () => {
      await createPlan('plan-noearly-1');
      const customer = await customers.createCustomer(context, 'cust-noearly-1', { firstName: 'Alicia' });
      const createdSale = await sales.createSale(context, branchIds, 'sale-noearly-1', {
        branchId,
        customerId: customer.value.id,
        items: [{ productId: membershipProductId, quantity: '1' }],
      });
      expect(createdSale.value.sale.status).toBe('pending_payment');
      const before = await memberships.membershipsForCustomer(context, customer.value.id);
      expect(before).toHaveLength(0);
    });

    it('activation on completed Sale: paying in full activates the membership exactly once, directly as active', async () => {
      const plan = await createPlan('plan-activate-1');
      const customer = await customers.createCustomer(context, 'cust-activate-1', { firstName: 'Bruno' });
      await buyMembershipForCustomer('activate-1', customer.value.id);
      const issued = await memberships.membershipsForCustomer(context, customer.value.id);
      expect(issued).toHaveLength(1);
      expect(issued[0]?.status).toBe('active');
      expect(issued[0]?.membershipPlanId).toBe(plan.id);
      expect(issued[0]?.sourceSaleId).not.toBeNull();
      // 30-day duration from the fixed test timestamp.
      expect(issued[0]?.expiresAt?.toISOString()).toBe('2026-10-04T20:00:00.000Z');
    });

    it('a sale with no customer attached never activates a membership, even for the membership product', async () => {
      await createPlan('plan-nocust-1');
      const register = await cash.createRegister(context, branchIds, 'reg-nocust-1', {
        branchId,
        code: 'REG-NOCUST-1',
        name: 'Caja NoCust',
      });
      await cash.openSession(context, branchIds, 'session-nocust-1', { cashRegisterId: register.value.id, openingAmount: '0.0000' });
      const createdSale = await sales.createSale(context, branchIds, 'sale-nocust-1', {
        branchId,
        items: [{ productId: membershipProductId, quantity: '1' }],
      });
      await payments.createCashPayment(context, branchIds, 'pay-nocust-1', {
        saleId: createdSale.value.sale.id,
        tenderedAmount: '500.0000',
        cashRegisterId: register.value.id,
      });
      const count = await database.pool.query<{ n: number }>('select count(*)::int as n from customer_memberships where company_id=$1 and source_sale_id=$2', [
        companyId,
        createdSale.value.sale.id,
      ]);
      expect(count.rows[0]?.n).toBe(0);
    });

    it('an inactive plan never activates, even when its product is sold', async () => {
      await createPlan('plan-inactive-1', { active: false });
      const customer = await customers.createCustomer(context, 'cust-inactive-1', { firstName: 'Carmen' });
      await buyMembershipForCustomer('inactive-1', customer.value.id);
      const issued = await memberships.membershipsForCustomer(context, customer.value.id);
      expect(issued).toHaveLength(0);
    });

    it('branch-restricted plan does not activate when sold at a different branch', async () => {
      await createPlan('plan-otherbranch-1', { branchIds: [otherBranchId] });
      const customer = await customers.createCustomer(context, 'cust-otherbranch-1', { firstName: 'Daniela' });
      await buyMembershipForCustomer('otherbranch-1', customer.value.id, branchId);
      const issued = await memberships.membershipsForCustomer(context, customer.value.id);
      expect(issued).toHaveLength(0);
    });

    it('retry/replay of the same cash payment idempotency key never issues a second membership', async () => {
      await createPlan('plan-retry-1');
      const customer = await customers.createCustomer(context, 'cust-retry-1', { firstName: 'Esteban' });
      const register = await cash.createRegister(context, branchIds, 'reg-retry-1', { branchId, code: 'REG-RETRY-1', name: 'Caja Retry' });
      await cash.openSession(context, branchIds, 'session-retry-1', { cashRegisterId: register.value.id, openingAmount: '0.0000' });
      const createdSale = await sales.createSale(context, branchIds, 'sale-retry-1', {
        branchId,
        customerId: customer.value.id,
        items: [{ productId: membershipProductId, quantity: '1' }],
      });
      const first = await payments.createCashPayment(context, branchIds, 'pay-retry-1-SAME-KEY', {
        saleId: createdSale.value.sale.id,
        tenderedAmount: '500.0000',
        cashRegisterId: register.value.id,
      });
      const replay = await payments.createCashPayment(context, branchIds, 'pay-retry-1-SAME-KEY', {
        saleId: createdSale.value.sale.id,
        tenderedAmount: '500.0000',
        cashRegisterId: register.value.id,
      });
      expect(replay.replayed).toBe(true);
      expect(replay.value.sale.id).toBe(first.value.sale.id);
      const issued = await memberships.membershipsForCustomer(context, customer.value.id);
      expect(issued).toHaveLength(1);
    });
  });

  describe('validation (Part N) — server-authoritative', () => {
    it('validates true for an active, non-expired membership at an eligible branch', async () => {
      await createPlan('plan-validate-1');
      const customer = await customers.createCustomer(context, 'cust-validate-1', { firstName: 'Fernanda' });
      await buyMembershipForCustomer('validate-1', customer.value.id);
      const result = await memberships.validate(context, customer.value.id, branchId, context.timestamp);
      expect(result.valid).toBe(true);
      expect(result.membership?.status).toBe('active');
    });

    it('validates false for a customer with no membership at all', async () => {
      const customer = await customers.createCustomer(context, 'cust-validate-2', { firstName: 'Gabriel' });
      const result = await memberships.validate(context, customer.value.id, branchId, context.timestamp);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('no_active_membership');
    });

    it('validates false once the membership has expired', async () => {
      await createPlan('plan-validate-expired-1');
      const customer = await customers.createCustomer(context, 'cust-validate-expired-1', { firstName: 'Helena' });
      await buyMembershipForCustomer('validate-expired-1', customer.value.id);
      const farFuture = new Date('2027-01-01T00:00:00.000Z');
      const result = await memberships.validate(context, customer.value.id, branchId, farFuture);
      expect(result.valid).toBe(false);
    });
  });

  describe('renewal (Part M)', () => {
    it('renewal creates a NEW row chained via renewed_from_membership_id, never mutating the original', async () => {
      await createPlan('plan-renew-1');
      const customer = await customers.createCustomer(context, 'cust-renew-1', { firstName: 'Ivan' });
      await buyMembershipForCustomer('renew-1', customer.value.id);
      const before = await memberships.membershipsForCustomer(context, customer.value.id);
      const original = before[0];
      if (original === undefined) throw new Error('Expected an original membership.');
      const renewed = await memberships.renewMembership(context, 'renew-1-key', original.id);
      expect(renewed.value.id).not.toBe(original.id);
      expect(renewed.value.renewedFromMembershipId).toBe(original.id);
      // The original 30-day period started 2026-09-04 and expires
      // 2026-10-04 — since renewal happens before that lapses, the new
      // period starts exactly where the old one ends, not from "now".
      expect(renewed.value.startsAt.toISOString()).toBe(original.expiresAt?.toISOString());
      const originalStillThere = await memberships.membershipsForCustomer(context, customer.value.id);
      const untouchedOriginal = originalStillThere.find((m) => m.id === original.id);
      expect(untouchedOriginal?.expiresAt?.toISOString()).toBe(original.expiresAt?.toISOString());
    });

    it('renewal retry with the same key never creates a second period', async () => {
      await createPlan('plan-renew-retry-1');
      const customer = await customers.createCustomer(context, 'cust-renew-retry-1', { firstName: 'Julieta' });
      await buyMembershipForCustomer('renew-retry-1', customer.value.id);
      const before = await memberships.membershipsForCustomer(context, customer.value.id);
      const original = before[0];
      if (original === undefined) throw new Error('Expected an original membership.');
      const first = await memberships.renewMembership(context, 'renew-retry-1-SAME-KEY', original.id);
      const replay = await memberships.renewMembership(context, 'renew-retry-1-SAME-KEY', original.id);
      expect(replay.replayed).toBe(true);
      expect(replay.value.id).toBe(first.value.id);
      const all = await memberships.membershipsForCustomer(context, customer.value.id);
      expect(all).toHaveLength(2); // original + exactly one renewal
    });
  });

  describe('cancellation', () => {
    it('cancels a membership with a required reason, idempotently on a second call', async () => {
      await createPlan('plan-cancel-1');
      const customer = await customers.createCustomer(context, 'cust-cancel-1', { firstName: 'Karen' });
      await buyMembershipForCustomer('cancel-1', customer.value.id);
      const before = await memberships.membershipsForCustomer(context, customer.value.id);
      const original = before[0];
      if (original === undefined) throw new Error('Expected a membership.');
      const cancelled = await memberships.cancelMembership(context, original.id, original.version, 'Customer requested cancellation');
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.cancelledReason).toBe('Customer requested cancellation');
      const again = await memberships.cancelMembership(context, original.id, cancelled.version, 'Customer requested cancellation');
      expect(again.status).toBe('cancelled');
    });
  });
});
