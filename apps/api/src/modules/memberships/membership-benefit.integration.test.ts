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
import { PromotionsRepository } from '../promotions/promotions.repository.js';
import { SalesRepository } from '../sales/sales.repository.js';
import { SalesService } from '../sales/sales.service.js';
import { MembershipsRepository } from './memberships.repository.js';
import { MembershipsService } from './memberships.service.js';

/** TASK 16.21 (ADR-0020) — the genuine BUSINESS EFFECT of a membership
 * benefit, proven through a REAL `evaluatePricing` run on a REAL Sale,
 * never a synthetic pricing-service unit call: this is the exact "Bryant"
 * worked example from the task spec (customer with an active membership,
 * a cart of eligible + ineligible lines, the server — never the client —
 * determines eligibility and the discount amount, and the completed
 * sale's own `sale_discounts` snapshot survives a later edit to the
 * plan). Mirrors `rewards.integration.test.ts`'s wiring: `SalesService`
 * constructed with a REAL `promotionsRepository` so `sale_discounts` is
 * actually persisted, plus a REAL `membershipsService` as the 5th
 * (membership) constructor arg. */
const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;
const migrationsPath = resolve(import.meta.dirname, '../../../../../packages/database/drizzle');

integration('PostgreSQL membership pricing benefit (TASK 16.21)', { concurrent: false }, () => {
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
  const productAId = randomUUID(); // $100.0000 — the membership's own eligible scope
  const productBId = randomUUID(); // $100.0000 — NOT in scope

  // A second, independent tenant — used only for the cross-tenant direct-ID
  // tampering proof (Phase 34/Acceptance-Gate "multi-tenant").
  const companyIdB = randomUUID();
  const branchIdB = randomUUID();
  const userIdB = randomUUID();

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
    requestId: 'mb-request',
    correlationId: 'mb-correlation',
    timestamp: new Date('2026-09-04T20:00:00.000Z'),
  };
  const contextB = { ...context, companyId: companyIdB, actorId: userIdB };
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
    database = createDatabaseClient({ connectionString: databaseUrl, applicationName: 'asone-membership-benefit-integration' });
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
    // TASK 16.21 — `membership_plans.benefit_type`/`benefit_percentage_
    // basis_points`/`benefit_fixed_amount` plus the two new
    // `membership_plan_benefit_products`/`_categories` scope tables, and
    // `sale_discounts`'s widened `source_type` check (now also allows
    // `'membership'`).
    await applyIfMissing('membership_plan_benefit_products', ['0044_keen_gauntlet.sql']);

    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'Mb Co','Mb Co',$2,'active','America/Mexico_City','MXN','es-MX'),
             ($3,'Mb Co B','Mb Co B',$4,'active','America/Mexico_City','MXN','es-MX')`,
      [companyId, `mb-${companyId}`, companyIdB, `mb-${companyIdB}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'Mb Main','MBMAIN','active','America/Mexico_City'),
             ($3,$2,'Mb Second','MBSECOND','active','America/Mexico_City'),
             ($4,$5,'Mb Main B','MBMAINB','active','America/Mexico_City')`,
      [branchId, companyId, otherBranchId, branchIdB, companyIdB],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'Mb Cashier','active'),($3,$4,$4,'Mb Cashier B','active')`,
      [userId, `mb-${userId}@example.test`, userIdB, `mb-${userIdB}@example.test`],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status)
       values($1,$2,$3,'active'),($4,$5,$6,'active')`,
      [randomUUID(), companyId, userId, randomUUID(), companyIdB, userIdB],
    );
    await database.pool.query(
      `insert into products (id,company_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
       values($1,$2,'MB-A','mb-a','Product A','simple',false,'IVA_EXEMPT','active',$3,$3),
             ($4,$2,'MB-B','mb-b','Product B','simple',false,'IVA_EXEMPT','active',$3,$3)`,
      [productAId, companyId, userId, productBId],
    );
    await database.pool.query(
      `insert into product_prices (id,company_id,product_id,amount,currency_code,status,created_by,updated_by)
       values($1,$2,$3,'100.0000','MXN','active',$4,$4),
             ($5,$2,$6,'100.0000','MXN','active',$4,$4)`,
      [randomUUID(), companyId, productAId, userId, randomUUID(), productBId],
    );

    const salesRepository = new SalesRepository(database);
    const customersRepository = new CustomersRepository(database);
    customers = new CustomersService(customersRepository);
    const promotionsRepository = new PromotionsRepository(database);
    const membershipsRepository = new MembershipsRepository(database);
    memberships = new MembershipsService(membershipsRepository);
    // TASK 16.21 — `promotionsRepository` (so a membership's `sale_
    // discounts` snapshot is actually written, exactly like real
    // production wiring) and `memberships` as the 5th arg: `createSale`
    // resolves a membership benefit automatically whenever a customer is
    // attached (never gated on an explicit client-supplied id, unlike
    // `rewardEntitlementId`).
    sales = new SalesService(salesRepository, promotionsRepository, customersRepository, undefined, memberships);
    const cashRepository = new CashRepository(database);
    cash = new CashService(cashRepository);
    const paymentRepository = new PaymentRepository(database);
    const mercadoPagoProvider = new MercadoPagoPointProvider(
      new MercadoPagoClient({ accessToken: undefined, apiBaseUrl: 'https://api.mercadopago.com' }),
    );
    payments = new PaymentService(paymentRepository, salesRepository, mercadoPagoProvider, cashRepository, memberships, undefined);
  });

  afterEach(async () => {
    for (const cid of [companyId, companyIdB]) {
      await database.pool.query('delete from sale_discounts where company_id=$1', [cid]);
      await database.pool.query('delete from payment_attempts where company_id=$1', [cid]);
      await database.pool.query('delete from payments where company_id=$1', [cid]);
      await database.pool.query('delete from customer_memberships where company_id=$1', [cid]);
      await database.pool.query('delete from membership_plan_benefit_products where company_id=$1', [cid]);
      await database.pool.query('delete from membership_plan_benefit_categories where company_id=$1', [cid]);
      await database.pool.query('delete from membership_plan_branches where company_id=$1', [cid]);
      await database.pool.query('delete from membership_plans where company_id=$1', [cid]);
      await database.pool.query('delete from sale_items where company_id=$1', [cid]);
      await database.pool.query('delete from sales where company_id=$1', [cid]);
      await database.pool.query('delete from cash_movements where company_id=$1', [cid]);
      await database.pool.query('delete from cash_sessions where company_id=$1', [cid]);
      await database.pool.query('delete from cash_registers where company_id=$1', [cid]);
      await database.pool.query('delete from customers where company_id=$1', [cid]);
      await database.pool.query('delete from idempotency_keys where company_id=$1', [cid]);
    }
  });

  afterAll(async () => {
    for (const cid of [companyId, companyIdB]) {
      await database.pool.query('delete from outbox_events where company_id=$1', [cid]);
      await database.pool.query('delete from audit_log where company_id=$1', [cid]);
    }
    await database.pool.query('delete from product_prices where company_id=$1', [companyId]);
    await database.pool.query('delete from products where company_id=$1', [companyId]);
    await database.pool.query('delete from company_memberships where company_id=any($1)', [[companyId, companyIdB]]);
    await database.pool.query('delete from branches where company_id=any($1)', [[companyId, companyIdB]]);
    await database.pool.query('delete from companies where id=any($1)', [[companyId, companyIdB]]);
    await database.pool.query('delete from users where id=any($1)', [[userId, userIdB]]);
    await database.close();
  });

  async function createPlan(
    key: string,
    overrides: Partial<Parameters<MembershipsService['createPlan']>[2]> = {},
  ): Promise<Awaited<ReturnType<MembershipsService['createPlan']>>['value']> {
    const created = await memberships.createPlan(context, key, {
      name: `Plan ${key}`,
      benefitType: 'percentage_discount',
      benefitPercentageBasisPoints: 1000, // 10%
      benefitProductIds: [productAId],
      ...overrides,
    });
    return created.value;
  }

  async function issueActiveMembership(key: string, planId: string, customerId: string): Promise<string> {
    const issued = await memberships.issueMembership(context, key, { customerId, membershipPlanId: planId });
    return issued.value.id;
  }

  /** Opens a register+session and completes a cart of Product A + Product
   * B with a real, exact cash payment — the one real path a discount can
   * ever be genuinely proven through (never a synthetic pricing-only
   * call). */
  async function sellCartForCustomer(
    keySuffix: string,
    customerId: string | undefined,
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
      ...(customerId === undefined ? {} : { customerId }),
      items: [
        { productId: productAId, quantity: '1' },
        { productId: productBId, quantity: '1' },
      ],
    });
    await payments.createCashPayment(context, branchIds, `pay-${keySuffix}`, {
      saleId: createdSale.value.sale.id,
      tenderedAmount: '1000.0000',
      cashRegisterId: register.value.id,
    });
    return { saleId: createdSale.value.sale.id };
  }

  describe('real-sale business effect (the "Bryant" worked example)', () => {
    it('discounts ONLY the eligible product, persists a membership sale_discount row, and produces the correct final total', async () => {
      const plan = await createPlan('bryant-1');
      const customer = await customers.createCustomer(context, 'cust-bryant-1', { firstName: 'Bryant' });
      await issueActiveMembership('bryant-1-issue', plan.id, customer.value.id);

      const { saleId } = await sellCartForCustomer('bryant-1', customer.value.id);

      const saleRow = await database.pool.query<{ subtotal: string; discount_total: string; total: string }>(
        'select subtotal, discount_total, total from sales where id=$1',
        [saleId],
      );
      // Subtotal $200 (A+B), membership -$10 (10% of A only), IVA_EXEMPT
      // on both lines so tax is zero — final $190.
      expect(saleRow.rows[0]?.subtotal).toBe('200.0000');
      expect(saleRow.rows[0]?.discount_total).toBe('10.0000');
      expect(saleRow.rows[0]?.total).toBe('190.0000');

      const discountRows = await database.pool.query<{ source_type: string; source_id: string; amount: string }>(
        "select source_type, source_id, amount from sale_discounts where sale_id=$1 and source_type='membership'",
        [saleId],
      );
      expect(discountRows.rows).toHaveLength(1);
      expect(discountRows.rows[0]?.amount).toBe('10.0000');

      const memberships_ = await memberships.membershipsForCustomer(context, customer.value.id);
      expect(memberships_[0]?.status).toBe('active');
    });

    it('a later edit to the plan does NOT retroactively change the already-completed sale (snapshot immutability)', async () => {
      const plan = await createPlan('bryant-immutable-1');
      const customer = await customers.createCustomer(context, 'cust-bryant-immutable-1', { firstName: 'Camila' });
      await issueActiveMembership('bryant-immutable-1-issue', plan.id, customer.value.id);
      const { saleId } = await sellCartForCustomer('bryant-immutable-1', customer.value.id);

      const before = await database.pool.query<{ amount: string }>(
        "select amount from sale_discounts where sale_id=$1 and source_type='membership'",
        [saleId],
      );
      expect(before.rows[0]?.amount).toBe('10.0000');

      // Now change the plan's benefit to 50% — the ALREADY-COMPLETED
      // sale above must remain byte-for-byte unchanged.
      await memberships.updatePlan(context, plan.id, plan.version, { benefitPercentageBasisPoints: 5000 });

      const after = await database.pool.query<{ amount: string }>(
        "select amount from sale_discounts where sale_id=$1 and source_type='membership'",
        [saleId],
      );
      expect(after.rows[0]?.amount).toBe('10.0000');
    });

    it('no customer attached never resolves a membership benefit, even with an active plan in the system', async () => {
      const plan = await createPlan('bryant-nocust-1');
      const otherCustomer = await customers.createCustomer(context, 'cust-bryant-nocust-owner-1', { firstName: 'Owner' });
      await issueActiveMembership('bryant-nocust-1-issue', plan.id, otherCustomer.value.id);

      const { saleId } = await sellCartForCustomer('bryant-nocust-1', undefined);
      const discountRows = await database.pool.query(
        "select 1 from sale_discounts where sale_id=$1 and source_type='membership'",
        [saleId],
      );
      expect(discountRows.rows).toHaveLength(0);
    });
  });

  describe('expiration gives zero unauthorized benefit', () => {
    it('an expired membership yields no discount on a real sale', async () => {
      const plan = await createPlan('expired-1', { durationDays: 1 });
      const customer = await customers.createCustomer(context, 'cust-expired-1', { firstName: 'Diego' });
      await issueActiveMembership('expired-1-issue', plan.id, customer.value.id);

      // Advance the sale's own authoritative clock well past the 1-day
      // expiry — never the client's clock, the server context's own
      // `timestamp` (Phase 9's "authoritative time" requirement).
      const farFutureContext = { ...context, timestamp: new Date('2027-01-01T00:00:00.000Z') };
      const register = await cash.createRegister(farFutureContext, branchIds, 'reg-expired-1', {
        branchId,
        code: 'REG-EXPIRED-1',
        name: 'Caja Expired',
      });
      await cash.openSession(farFutureContext, branchIds, 'session-expired-1', {
        cashRegisterId: register.value.id,
        openingAmount: '0.0000',
      });
      const createdSale = await sales.createSale(farFutureContext, branchIds, 'sale-expired-1', {
        branchId,
        customerId: customer.value.id,
        items: [{ productId: productAId, quantity: '1' }],
      });
      await payments.createCashPayment(farFutureContext, branchIds, 'pay-expired-1', {
        saleId: createdSale.value.sale.id,
        tenderedAmount: '100.0000',
        cashRegisterId: register.value.id,
      });
      const discountRows = await database.pool.query(
        "select 1 from sale_discounts where sale_id=$1 and source_type='membership'",
        [createdSale.value.sale.id],
      );
      expect(discountRows.rows).toHaveLength(0);
    });

    it('a cancelled membership yields no discount on a real sale', async () => {
      const plan = await createPlan('cancelled-1');
      const customer = await customers.createCustomer(context, 'cust-cancelled-1', { firstName: 'Elena' });
      const membershipId = await issueActiveMembership('cancelled-1-issue', plan.id, customer.value.id);
      const issued = await memberships.membershipsForCustomer(context, customer.value.id);
      const found = issued.find((m) => m.id === membershipId);
      if (found === undefined) throw new Error('Expected the issued membership.');
      await memberships.cancelMembership(context, membershipId, found.version, 'Customer requested cancellation');

      const { saleId } = await sellCartForCustomer('cancelled-1', customer.value.id);
      const discountRows = await database.pool.query(
        "select 1 from sale_discounts where sale_id=$1 and source_type='membership'",
        [saleId],
      );
      expect(discountRows.rows).toHaveLength(0);
    });
  });

  describe('branch applicability (Phase 6)', () => {
    it('a branch-restricted plan does not benefit a sale completed at a different branch', async () => {
      const plan = await createPlan('branch-1', { branchIds: [otherBranchId] });
      const customer = await customers.createCustomer(context, 'cust-branch-1', { firstName: 'Fabian' });
      await issueActiveMembership('branch-1-issue', plan.id, customer.value.id);

      const { saleId } = await sellCartForCustomer('branch-1', customer.value.id, branchId);
      const discountRows = await database.pool.query(
        "select 1 from sale_discounts where sale_id=$1 and source_type='membership'",
        [saleId],
      );
      expect(discountRows.rows).toHaveLength(0);
    });

    it('the same branch-restricted plan DOES benefit a sale completed at the eligible branch', async () => {
      const plan = await createPlan('branch-2', { branchIds: [otherBranchId] });
      const customer = await customers.createCustomer(context, 'cust-branch-2', { firstName: 'Gina' });
      await issueActiveMembership('branch-2-issue', plan.id, customer.value.id);

      const { saleId } = await sellCartForCustomer('branch-2', customer.value.id, otherBranchId);
      const discountRows = await database.pool.query(
        "select 1 from sale_discounts where sale_id=$1 and source_type='membership'",
        [saleId],
      );
      expect(discountRows.rows).toHaveLength(1);
    });
  });

  describe('multi-tenant isolation (Phase 34)', () => {
    it('a direct membership-plan id from Tenant A is invisible to Tenant B — resolves as no benefit, not a cross-tenant leak', async () => {
      const plan = await createPlan('tenant-a-1');
      const customerA = await customers.createCustomer(context, 'cust-tenant-a-1', { firstName: 'Hugo' });
      await issueActiveMembership('tenant-a-1-issue', plan.id, customerA.value.id);

      // Tenant B has its own company/branch/user but no products of its
      // own — the proof is simply that Tenant A's plan id/customer id
      // are never visible through Tenant B's own scoped queries.
      await expect(memberships.plan(contextB, plan.id)).rejects.toThrow();
      const membershipsForA = await memberships.membershipsForCustomer(contextB, customerA.value.id);
      expect(membershipsForA).toHaveLength(0);
    });
  });
});
