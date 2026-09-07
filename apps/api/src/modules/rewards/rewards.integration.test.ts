import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';

import { CashRepository } from '../cash/cash.repository.js';
import { CashService } from '../cash/cash.service.js';
import { CustomersRepository } from '../customers/customers.repository.js';
import { CustomersService } from '../customers/customers.service.js';
import type { LoyaltyProgramRow } from '../loyalty/loyalty.types.js';
import { LoyaltyRepository } from '../loyalty/loyalty.repository.js';
import { LoyaltyService } from '../loyalty/loyalty.service.js';
import { PaymentRepository } from '../payments/payments.repository.js';
import { PaymentService } from '../payments/payments.service.js';
import { MercadoPagoClient } from '../payments/providers/mercado-pago.client.js';
import { MercadoPagoPointProvider } from '../payments/providers/mercado-pago.provider.js';
import { SalesRepository } from '../sales/sales.repository.js';
import { SalesService } from '../sales/sales.service.js';
import { RewardsRepository, type RewardTransaction } from './rewards.repository.js';
import { RewardsService } from './rewards.service.js';
import type { LoyaltyTransaction } from '../loyalty/loyalty.repository.js';
import { effectiveStatus, type RewardEntitlementRow } from './rewards.types.js';

/** TASK 13.1 — reward entitlements (VIP Pass / threshold-based loyalty
 * rewards) built on TASK 13.0's loyalty ledger foundation. Threshold
 * crossing is wired through a REAL cash-sale settlement wherever that is
 * the natural way to reach a given state (mirroring `loyalty.
 * integration.test.ts`'s own `buyForCustomer` helper, extended here so
 * `PaymentService`'s post-settlement hooks exercise `RewardsService.
 * evaluateAutomaticIssuance` exactly the way `PaymentsService.
 * applyPostSettlementHooks` really calls it — AFTER `loyaltyService.
 * earnFromSale`, in the SAME settlement transaction). A handful of
 * specifically-shaped states (an already-crossed-but-unevaluated ledger,
 * for the idempotency/concurrency proofs) are seeded with a direct ledger
 * insert instead, since those states are not naturally reachable by
 * repeating a real purchase — see `earnDirectly`'s own doc comment. See
 * ADR-0018. */
const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;
const migrationsPath = resolve(import.meta.dirname, '../../../../../packages/database/drizzle');

integration('PostgreSQL reward entitlements (TASK 13.1)', { concurrent: false }, () => {
  let database: DatabaseClient;
  let sales: SalesService;
  let cash: CashService;
  let payments: PaymentService;
  let customers: CustomersService;
  let loyaltyRepository: LoyaltyRepository;
  let loyalty: LoyaltyService;
  let rewardsRepository: RewardsRepository;
  let rewards: RewardsService;

  const companyId = randomUUID();
  const branchId = randomUUID();
  const userId = randomUUID();
  const productId = randomUUID(); // $200.0000

  // A second, independent tenant — used only for tenant-isolation and
  // cross-company leakage proofs. No product/sale infrastructure of its
  // own: every reward-related state for this company is reached either
  // through manual issuance or `earnDirectly`, never a real Sale.
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
      'customer.update',
      'loyalty.manage',
      'loyalty.read',
      'loyalty.adjust',
      'reward.read',
      'reward.issue',
      'reward.redeem',
      'reward.revoke',
    ],
    requestId: 'rwd-request',
    correlationId: 'rwd-correlation',
    timestamp: new Date('2026-09-04T20:00:00.000Z'),
  };
  const contextB = { ...context, companyId: companyIdB, actorId: userIdB };
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
    database = createDatabaseClient({ connectionString: databaseUrl, applicationName: 'asone-rewards-integration' });
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
    // TASK 13.1 — `reward_entitlements`/`reward_entitlement_tokens`, plus
    // `loyalty_programs`'s new reward_* columns and `loyalty_ledger`'s
    // `loyalty_ledger_company_id_id_uq`.
    await applyIfMissing('reward_entitlements', ['0022_cheerful_scrambler.sql']);

    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'Rwd Co','Rwd Co',$2,'active','America/Mexico_City','MXN','es-MX'),
             ($3,'Rwd Co B','Rwd Co B',$4,'active','America/Mexico_City','MXN','es-MX')`,
      [companyId, `rwd-${companyId}`, companyIdB, `rwd-${companyIdB}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'Rwd Main','RMAIN','active','America/Mexico_City'),
             ($3,$4,'Rwd Main B','RMAINB','active','America/Mexico_City')`,
      [branchId, companyId, branchIdB, companyIdB],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'Rwd Cashier','active'),($3,$4,$4,'Rwd Cashier B','active')`,
      [userId, `rwd-${userId}@example.test`, userIdB, `rwd-${userIdB}@example.test`],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status)
       values($1,$2,$3,'active'),($4,$5,$6,'active')`,
      [randomUUID(), companyId, userId, randomUUID(), companyIdB, userIdB],
    );
    await database.pool.query(
      `insert into products (id,company_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
       values($1,$2,'RWD-GENERAL','rwd-general','Rwd Product','simple',false,'IVA_EXEMPT','active',$3,$3)`,
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
    loyaltyRepository = new LoyaltyRepository(database);
    loyalty = new LoyaltyService(loyaltyRepository);
    rewardsRepository = new RewardsRepository(database);
    rewards = new RewardsService(rewardsRepository, loyaltyRepository, customersRepository);
    // TASK 13.1 — `rewardsService` as the 7th arg: `applyPostSettlementHooks`
    // calls `evaluateAutomaticIssuance` AFTER `loyaltyService.earnFromSale`,
    // in the same settlement transaction — see `payments.service.ts`.
    payments = new PaymentService(paymentRepository, salesRepository, mercadoPagoProvider, cashRepository, undefined, loyalty, rewards);
  });

  afterEach(async () => {
    for (const cid of [companyId, companyIdB]) {
      await database.pool.query('delete from reward_entitlement_tokens where company_id=$1', [cid]);
      await database.pool.query('delete from reward_entitlements where company_id=$1', [cid]);
      await database.pool.query('delete from payment_attempts where company_id=$1', [cid]);
      await database.pool.query('delete from payments where company_id=$1', [cid]);
      await database.pool.query('delete from loyalty_ledger where company_id=$1', [cid]);
      await database.pool.query('delete from loyalty_accounts where company_id=$1', [cid]);
      await database.pool.query('delete from loyalty_programs where company_id=$1', [cid]);
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
    for (const cid of [companyId, companyIdB]) {
      await database.pool.query('delete from company_memberships where company_id=$1', [cid]);
      await database.pool.query('delete from branches where company_id=$1', [cid]);
      await database.pool.query('delete from companies where id=$1', [cid]);
    }
    await database.pool.query('delete from users where id=$1', [userId]);
    await database.pool.query('delete from users where id=$1', [userIdB]);
    await database.close();
  });

  // --- Fixture helpers -------------------------------------------------

  async function createProgram(
    key: string,
    overrides: Partial<Parameters<LoyaltyService['createProgram']>[2]> = {},
    targetContext: typeof context = context,
  ): Promise<LoyaltyProgramRow> {
    const created = await loyalty.createProgram(targetContext, key, {
      name: `Program ${key}`,
      active: true,
      unitType: 'stamp',
      ...overrides,
    });
    return created.value;
  }

  /** Opens a register+session, creates a Sale for the customer, and
   * completes it with an exact cash payment — the SAME real settlement
   * path `loyalty.integration.test.ts`'s own `buyForCustomer` drives,
   * extended here only in that `payments` is wired with a real
   * `RewardsService` too, so every purchase also runs `evaluate
   * AutomaticIssuance` inside the same settlement transaction as the
   * earn it just posted. */
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

  /** Seeds a raw `entry_type='earn'` ledger row DIRECTLY (bypassing
   * `LoyaltyService.earnFromSale` and, crucially, `RewardsService.
   * evaluateAutomaticIssuance`) — used only for the handful of states not
   * naturally reachable by repeating a real purchase: an already-crossed
   * threshold that has never yet been evaluated (the idempotency-replay
   * and concurrency proofs both need to control that precisely), an
   * inactive program's own ledger (still real earning math, just never
   * wired through the automatic-issuance hook), and a single earn event
   * large enough to cross more than one cycle at once. Mirrors exactly
   * what `LoyaltyRepository.insertLedgerEntry` persists for a real earn —
   * same `entry_type`, same `unit_type` — just outside `PaymentService`'s
   * transaction. */
  async function earnDirectly(
    targetCompanyId: string,
    customerId: string,
    program: Pick<LoyaltyProgramRow, 'id' | 'unitType'>,
    quantity: number,
    timestamp: Date,
    actorId: string = userId,
  ): Promise<void> {
    await loyaltyRepository.transaction(async (client) => {
      const account = await loyaltyRepository.getOrCreateAccount(client, targetCompanyId, customerId, timestamp);
      // `source_type='manual'` requires a non-blank `reason` and a real
      // `actor_id` (`loyalty_ledger_manual_fields_ck`) — unlike a real
      // automatic earn (`source_type='sale'`, `actor_id=null`), which this
      // seed deliberately avoids mimicking exactly, since `source_type=
      // 'sale'` would also need a real, unique `source_id` to respect
      // `loyalty_ledger_company_program_sale_uq`.
      const inserted = await loyaltyRepository.insertLedgerEntry(client, {
        id: randomUUID(),
        companyId: targetCompanyId,
        loyaltyAccountId: account.id,
        loyaltyProgramId: program.id,
        branchId: null,
        entryType: 'earn',
        quantity,
        unitType: program.unitType,
        sourceType: 'manual',
        sourceId: null,
        reason: 'integration-test-seed-earn',
        actorId,
        timestamp,
      });
      if (inserted === null) throw new Error('Seed ledger entry unexpectedly conflicted.');
    });
  }

  /** Runs `RewardsService.evaluateAutomaticIssuance` directly, in its own
   * fresh transaction/connection — exactly the shape `PaymentService`'s
   * real call site uses (a single transactional `client`), just without a
   * real Sale driving it. Used for the idempotency/concurrency proofs
   * (calling it a second time, or racing it with itself) and for the
   * states seeded via `earnDirectly` above. */
  async function evaluateAutomatic(targetContext: {
    companyId: string;
    branchId: string;
    customerId: string;
    actorId: string;
    correlationId: string;
    timestamp: Date;
  }): Promise<void> {
    await rewardsRepository.transaction((client) =>
      rewards.evaluateAutomaticIssuance(client as RewardTransaction & LoyaltyTransaction, {
        ...targetContext,
        saleId: randomUUID(),
      }),
    );
  }

  async function accountIdFor(targetCompanyId: string, customerId: string): Promise<string> {
    const account = await loyaltyRepository.accountByCustomerId(null, targetCompanyId, customerId);
    if (account === null) throw new Error('Expected a loyalty account to exist.');
    return account.id;
  }

  async function entitlementRows(
    targetCompanyId: string,
    accountId: string,
    programId: string,
  ): Promise<{ cycle_number: number | null; status: string }[]> {
    const rows = await database.pool.query<{ cycle_number: number | null; status: string }>(
      `select cycle_number, status from reward_entitlements
       where company_id=$1 and loyalty_account_id=$2 and loyalty_program_id=$3
       order by cycle_number nulls last`,
      [targetCompanyId, accountId, programId],
    );
    return rows.rows;
  }

  async function auditRows(targetCompanyId: string, action: string, entityId: string): Promise<{ metadata: unknown }[]> {
    const rows = await database.pool.query<{ metadata: unknown }>(
      `select metadata from audit_log where company_id=$1 and action=$2 and entity_id=$3`,
      [targetCompanyId, action, entityId],
    );
    return rows.rows;
  }

  async function outboxRows(targetCompanyId: string, eventType: string, aggregateId: string): Promise<{ payload: unknown }[]> {
    const rows = await database.pool.query<{ payload: unknown }>(
      `select payload from outbox_events where company_id=$1 and event_type=$2 and aggregate_id=$3`,
      [targetCompanyId, eventType, aggregateId],
    );
    return rows.rows;
  }

  async function issueEntitlementFor(
    targetContext: typeof context,
    keySuffix: string,
    customerId: string,
    programId: string,
    overrides: { expiresAt?: Date } = {},
  ): Promise<RewardEntitlementRow> {
    const issued = await rewards.issueManual(targetContext, `issue-${keySuffix}`, {
      customerId,
      loyaltyProgramId: programId,
      reasonCode: 'Manual VIP grant',
      ...(overrides.expiresAt === undefined ? {} : { expiresAt: overrides.expiresAt }),
    });
    return issued.value;
  }
  async function issueEntitlement(
    keySuffix: string,
    customerId: string,
    programId: string,
    overrides: { expiresAt?: Date } = {},
  ): Promise<RewardEntitlementRow> {
    return issueEntitlementFor(context, keySuffix, customerId, programId, overrides);
  }

  // --- Automatic issuance (threshold crossing) ------------------------

  describe('automatic issuance (threshold crossing via evaluateAutomaticIssuance)', () => {
    it('earning exactly the threshold amount issues exactly one entitlement (cycle 1, loyalty_threshold, available)', async () => {
      await createProgram('prog-exact-1', { rewardThreshold: 3, rewardType: 'vip_pass', rewardRepeatable: true });
      const customer = await customers.createCustomer(context, 'cust-exact-1', { firstName: 'Alba' });
      await buyForCustomer('exact-1a', customer.value.id);
      await buyForCustomer('exact-1b', customer.value.id);
      await buyForCustomer('exact-1c', customer.value.id);
      const entitlements = await rewards.entitlementsForCustomer(context, customer.value.id);
      expect(entitlements).toHaveLength(1);
      expect(entitlements[0]?.cycleNumber).toBe(1);
      expect(entitlements[0]?.sourceType).toBe('loyalty_threshold');
      expect(entitlements[0]?.status).toBe('available');
      expect(entitlements[0]?.rewardType).toBe('vip_pass');
    });

    it('earning below the threshold issues nothing', async () => {
      await createProgram('prog-below-1', { rewardThreshold: 3, rewardType: 'vip_pass' });
      const customer = await customers.createCustomer(context, 'cust-below-1', { firstName: 'Beto' });
      await buyForCustomer('below-1a', customer.value.id);
      await buyForCustomer('below-1b', customer.value.id);
      const entitlements = await rewards.entitlementsForCustomer(context, customer.value.id);
      expect(entitlements).toHaveLength(0);
    });

    it('repeatable=true: crossing the threshold twice issues two entitlements (cycle 1 and cycle 2)', async () => {
      await createProgram('prog-repeat-1', { rewardThreshold: 3, rewardType: 'vip_pass', rewardRepeatable: true });
      const customer = await customers.createCustomer(context, 'cust-repeat-1', { firstName: 'Carla' });
      for (const suffix of ['a', 'b', 'c', 'd', 'e', 'f']) await buyForCustomer(`repeat-1${suffix}`, customer.value.id);
      const entitlements = await rewards.entitlementsForCustomer(context, customer.value.id);
      expect(entitlements).toHaveLength(2);
      expect(entitlements.map((entry) => entry.cycleNumber).sort()).toEqual([1, 2]);
    });

    it('repeatable=false: crossing the threshold twice still issues only cycle 1 — no cycle-2 row exists', async () => {
      const program = await createProgram('prog-norepeat-1', { rewardThreshold: 3, rewardType: 'vip_pass', rewardRepeatable: false });
      const customer = await customers.createCustomer(context, 'cust-norepeat-1', { firstName: 'Dora' });
      for (const suffix of ['a', 'b', 'c', 'd', 'e', 'f']) await buyForCustomer(`norepeat-1${suffix}`, customer.value.id);
      const entitlements = await rewards.entitlementsForCustomer(context, customer.value.id);
      expect(entitlements).toHaveLength(1);
      expect(entitlements[0]?.cycleNumber).toBe(1);
      const accountId = await accountIdFor(companyId, customer.value.id);
      const cycleTwo = await database.pool.query<{ n: number }>(
        `select count(*)::int as n from reward_entitlements where company_id=$1 and loyalty_account_id=$2 and loyalty_program_id=$3 and cycle_number=2`,
        [companyId, accountId, program.id],
      );
      expect(cycleTwo.rows[0]?.n).toBe(0);
    });

    it('a single earn event spanning two cycles at once issues one entitlement per newly-completed cycle', async () => {
      const program = await createProgram('prog-doublecross-1', { rewardThreshold: 3, rewardType: 'vip_pass', rewardRepeatable: true });
      const customer = await customers.createCustomer(context, 'cust-doublecross-1', { firstName: 'Elena' });
      await earnDirectly(companyId, customer.value.id, program, 6, context.timestamp);
      await evaluateAutomatic({
        companyId,
        branchId,
        customerId: customer.value.id,
        actorId: userId,
        correlationId: 'rwd-correlation',
        timestamp: context.timestamp,
      });
      const entitlements = await rewards.entitlementsForCustomer(context, customer.value.id);
      expect(entitlements).toHaveLength(2);
      expect(entitlements.map((entry) => entry.cycleNumber).sort()).toEqual([1, 2]);
    });

    it('an INACTIVE program never issues, even when the qualifying earn amount is reached', async () => {
      const program = await createProgram('prog-inactive-1', { active: false, rewardThreshold: 3, rewardType: 'vip_pass' });
      const customer = await customers.createCustomer(context, 'cust-rewardinactive-1', { firstName: 'Fabio' });
      await earnDirectly(companyId, customer.value.id, program, 5, context.timestamp);
      await evaluateAutomatic({
        companyId,
        branchId,
        customerId: customer.value.id,
        actorId: userId,
        correlationId: 'rwd-correlation',
        timestamp: context.timestamp,
      });
      const entitlements = await rewards.entitlementsForCustomer(context, customer.value.id);
      expect(entitlements).toHaveLength(0);
    });

    it('a program with reward_type/reward_threshold left null never issues — not reward-bearing at all', async () => {
      const program = await createProgram('prog-noreward-1'); // active, but no reward_threshold/reward_type
      const customer = await customers.createCustomer(context, 'cust-noreward-1', { firstName: 'Gina' });
      await earnDirectly(companyId, customer.value.id, program, 999, context.timestamp);
      await evaluateAutomatic({
        companyId,
        branchId,
        customerId: customer.value.id,
        actorId: userId,
        correlationId: 'rwd-correlation',
        timestamp: context.timestamp,
      });
      const entitlements = await rewards.entitlementsForCustomer(context, customer.value.id);
      expect(entitlements).toHaveLength(0);
    });

    it('idempotency: evaluating the same already-earned total a second time never creates a duplicate cycle row', async () => {
      const program = await createProgram('prog-idem-1', { rewardThreshold: 3, rewardType: 'vip_pass', rewardRepeatable: true });
      const customer = await customers.createCustomer(context, 'cust-idem-1', { firstName: 'Hugo' });
      await buyForCustomer('idem-1a', customer.value.id);
      await buyForCustomer('idem-1b', customer.value.id);
      await buyForCustomer('idem-1c', customer.value.id); // crosses the threshold; cycle 1 issued by the real settlement hook
      const accountId = await accountIdFor(companyId, customer.value.id);
      const before = await entitlementRows(companyId, accountId, program.id);
      expect(before).toHaveLength(1);
      // Re-evaluate directly against the SAME already-earned total —
      // simulates the hook being invoked a second time (e.g. the service
      // being re-run for a ledger state that has not changed since the
      // last evaluation). Proves the DB's own `ON CONFLICT DO NOTHING`
      // (not just service-layer bookkeeping) is what prevents the
      // duplicate — see this file's own concurrency test below for the
      // stronger, race-condition version of the same proof.
      await evaluateAutomatic({
        companyId,
        branchId,
        customerId: customer.value.id,
        actorId: userId,
        correlationId: 'rwd-correlation',
        timestamp: context.timestamp,
      });
      const after = await entitlementRows(companyId, accountId, program.id);
      expect(after).toHaveLength(1);
      expect(after[0]?.status).toBe('available');
    });

    it('concurrency: two concurrent evaluations against the same crossed-but-unissued state issue exactly one entitlement', async () => {
      const program = await createProgram('prog-conc-1', { rewardThreshold: 3, rewardType: 'vip_pass', rewardRepeatable: true });
      const customer = await customers.createCustomer(context, 'cust-conc-1', { firstName: 'Irene' });
      // Crossed, but never yet evaluated — each concurrent call below
      // opens its OWN transaction/connection, exactly like two racing
      // settlement hooks would.
      await earnDirectly(companyId, customer.value.id, program, 3, context.timestamp);
      const targetContext = {
        companyId,
        branchId,
        customerId: customer.value.id,
        actorId: userId,
        correlationId: 'rwd-correlation',
        timestamp: context.timestamp,
      };
      await Promise.all([evaluateAutomatic(targetContext), evaluateAutomatic(targetContext)]);
      const accountId = await accountIdFor(companyId, customer.value.id);
      const rows = await entitlementRows(companyId, accountId, program.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.cycle_number).toBe(1);
    });

    it("tenant isolation: two companies each crossing their own threshold get independent entitlements, never seeing the other's", async () => {
      const programA = await createProgram('prog-tenant-a-1', { rewardThreshold: 2, rewardType: 'vip_pass' }, context);
      const programB = await createProgram('prog-tenant-b-1', { rewardThreshold: 2, rewardType: 'vip_pass' }, contextB);
      const customerA = await customers.createCustomer(context, 'cust-tenant-a-1', { firstName: 'Javier' });
      const customerB = await customers.createCustomer(contextB, 'cust-tenant-b-1', { firstName: 'Karla' });
      await earnDirectly(companyId, customerA.value.id, programA, 2, context.timestamp);
      await earnDirectly(companyIdB, customerB.value.id, programB, 2, context.timestamp, userIdB);
      await evaluateAutomatic({
        companyId,
        branchId,
        customerId: customerA.value.id,
        actorId: userId,
        correlationId: 'rwd-correlation',
        timestamp: context.timestamp,
      });
      await evaluateAutomatic({
        companyId: companyIdB,
        branchId: branchIdB,
        customerId: customerB.value.id,
        actorId: userIdB,
        correlationId: 'rwd-correlation',
        timestamp: context.timestamp,
      });
      const entitlementsA = await rewards.entitlementsForCustomer(context, customerA.value.id);
      const entitlementsB = await rewards.entitlementsForCustomer(contextB, customerB.value.id);
      expect(entitlementsA).toHaveLength(1);
      expect(entitlementsB).toHaveLength(1);
      expect(entitlementsA[0]?.id).not.toBe(entitlementsB[0]?.id);
      const entitlementBId = entitlementsB[0]?.id;
      if (entitlementBId === undefined) throw new Error('Expected company B to have issued an entitlement.');
      // Company A's own scoped read never surfaces company B's row, even
      // though both crossed the identical threshold at the identical
      // moment.
      await expect(rewards.entitlement(context, entitlementBId)).rejects.toMatchObject({ code: 'resource_not_found' });
    });
  });

  // --- Manual issuance ---------------------------------------------------

  describe('manual issuance', () => {
    it('succeeds under reward.issue with sourceType manual and cycleNumber null', async () => {
      const program = await createProgram('prog-manual-1', { rewardThreshold: 3, rewardType: 'vip_pass' });
      const customer = await customers.createCustomer(context, 'cust-manual-1', { firstName: 'Laura' });
      const issued = await rewards.issueManual(context, 'manual-issue-1', {
        customerId: customer.value.id,
        loyaltyProgramId: program.id,
        reasonCode: 'vip_grant',
      });
      expect(issued.replayed).toBe(false);
      expect(issued.value.sourceType).toBe('manual');
      expect(issued.value.cycleNumber).toBeNull();
      expect(issued.value.status).toBe('available');
    });

    it('replays the same idempotency key onto the SAME entitlement, marked replayed, with no duplicate row', async () => {
      const program = await createProgram('prog-manual-retry-1', { rewardThreshold: 3, rewardType: 'vip_pass' });
      const customer = await customers.createCustomer(context, 'cust-manual-retry-1', { firstName: 'Mateo' });
      const first = await rewards.issueManual(context, 'manual-retry-SAME-KEY', {
        customerId: customer.value.id,
        loyaltyProgramId: program.id,
        reasonCode: 'vip_grant',
      });
      const replay = await rewards.issueManual(context, 'manual-retry-SAME-KEY', {
        customerId: customer.value.id,
        loyaltyProgramId: program.id,
        reasonCode: 'vip_grant',
      });
      expect(replay.replayed).toBe(true);
      expect(replay.value.id).toBe(first.value.id);
      // A REAL bug was found and fixed here (see ADR-0018 "Redemption
      // idempotency"): a replayed value decoded from `idempotency_keys`'
      // own persisted JSON is NOT the original in-memory object — every
      // `Date` field survived only as an ISO STRING through that
      // round-trip. A naive `(value) => value as RewardEntitlementRow`
      // decode (the codebase's usual shorthand elsewhere) would silently
      // type this as `Date` while it's actually a `string` at runtime —
      // undetectable by a test that only reads `.status`/`.id`, but fatal
      // the moment a route handler calls `.toISOString()` on it. Assert
      // the decoded value is a REAL `Date` instance, not merely
      // Date-shaped, so this class of regression cannot silently return.
      expect(replay.value.issuedAt).toBeInstanceOf(Date);
      expect(replay.value.issuedAt.getTime()).toBe(first.value.issuedAt.getTime());
      const entitlements = await rewards.entitlementsForCustomer(context, customer.value.id);
      expect(entitlements).toHaveLength(1);
    });

    it('rejects manual issuance from an actor lacking reward.issue', async () => {
      const program = await createProgram('prog-manual-perm-1', { rewardThreshold: 3, rewardType: 'vip_pass' });
      const customer = await customers.createCustomer(context, 'cust-manual-perm-1', { firstName: 'Nadia' });
      const noPermissionContext = { ...context, actorPermissions: ['reward.read'] };
      await expect(
        rewards.issueManual(noPermissionContext, 'manual-perm-1', {
          customerId: customer.value.id,
          loyaltyProgramId: program.id,
          reasonCode: 'vip_grant',
        }),
      ).rejects.toMatchObject({ code: 'validation_error' });
    });
  });

  // --- Redemption ----------------------------------------------------------

  describe('redemption', () => {
    it('redeems an available entitlement: status flips to redeemed, redeemedAt/redeemedBy set, version incremented', async () => {
      const program = await createProgram('prog-redeem-1', { rewardThreshold: 3, rewardType: 'vip_pass' });
      const customer = await customers.createCustomer(context, 'cust-redeem-1', { firstName: 'Oscar' });
      const entitlement = await issueEntitlement('redeem-1', customer.value.id, program.id);
      const redeemed = await rewards.redeem(context, 'redeem-1-key', entitlement.id, branchId);
      expect(redeemed.replayed).toBe(false);
      expect(redeemed.value.status).toBe('redeemed');
      expect(redeemed.value.redeemedBy).toBe(userId);
      expect(redeemed.value.redeemedAt).not.toBeNull();
      expect(redeemed.value.version).toBe(entitlement.version + 1n);
    });

    it('replays the same idempotency key on an already-redeemed entitlement: same success result, no re-redeem', async () => {
      const program = await createProgram('prog-redeem-retry-1', { rewardThreshold: 3, rewardType: 'vip_pass' });
      const customer = await customers.createCustomer(context, 'cust-redeem-retry-1', { firstName: 'Paola' });
      const entitlement = await issueEntitlement('redeem-retry-1', customer.value.id, program.id);
      const first = await rewards.redeem(context, 'redeem-retry-SAME-KEY', entitlement.id, branchId);
      const replay = await rewards.redeem(context, 'redeem-retry-SAME-KEY', entitlement.id, branchId);
      expect(replay.replayed).toBe(true);
      expect(replay.value.id).toBe(first.value.id);
      expect(replay.value.status).toBe('redeemed');
      // See the identical NOTE on the manual-issuance replay test above —
      // this is the redemption-path half of the same real bug/fix.
      expect(replay.value.redeemedAt).toBeInstanceOf(Date);
      expect(replay.value.redeemedAt?.getTime()).toBe(first.value.redeemedAt?.getTime());
    });

    it('redeeming an already-redeemed entitlement with a DIFFERENT idempotency key rejects reward_already_redeemed', async () => {
      const program = await createProgram('prog-redeem-conflict-1', { rewardThreshold: 3, rewardType: 'vip_pass' });
      const customer = await customers.createCustomer(context, 'cust-redeem-conflict-1', { firstName: 'Quique' });
      const entitlement = await issueEntitlement('redeem-conflict-1', customer.value.id, program.id);
      await rewards.redeem(context, 'redeem-conflict-1-key-a', entitlement.id, branchId);
      await expect(rewards.redeem(context, 'redeem-conflict-1-key-b', entitlement.id, branchId)).rejects.toMatchObject({
        code: 'reward_already_redeemed',
      });
    });

    it('redeeming a revoked entitlement rejects reward_not_available', async () => {
      const program = await createProgram('prog-redeem-revoked-1', { rewardThreshold: 3, rewardType: 'vip_pass' });
      const customer = await customers.createCustomer(context, 'cust-redeem-revoked-1', { firstName: 'Renata' });
      const entitlement = await issueEntitlement('redeem-revoked-1', customer.value.id, program.id);
      await rewards.revoke(context, entitlement.id, entitlement.version, 'Issued in error');
      await expect(rewards.redeem(context, 'redeem-revoked-1-key', entitlement.id, branchId)).rejects.toMatchObject({
        code: 'reward_not_available',
      });
    });

    // A real bug was found and fixed here (see ADR-0018 D14): the first
    // implementation threw `reward_expired` from INSIDE the same
    // transaction `markExpired`'s own UPDATE ran in, so the rollback that
    // error triggered silently undid the persisted transition too — the
    // `status` column never actually left `'available'`. Fixed by having
    // that branch commit the transition and only THEN raise the error, on
    // the already-committed result. This test asserts the persisted
    // column really does flip, exactly once, and stays flipped across a
    // second independent (differently-keyed) redemption attempt.
    it('redeeming an expired entitlement durably transitions the persisted status to expired and rejects reward_expired on every attempt', async () => {
      const program = await createProgram('prog-redeem-expired-1', { rewardThreshold: 3, rewardType: 'vip_pass' });
      const customer = await customers.createCustomer(context, 'cust-redeem-expired-1', { firstName: 'Sergio' });
      const entitlement = await issueEntitlement('redeem-expired-1', customer.value.id, program.id, {
        expiresAt: new Date('2026-09-01T00:00:00.000Z'), // before context.timestamp (2026-09-04)
      });
      await expect(rewards.redeem(context, 'redeem-expired-1-key-a', entitlement.id, branchId)).rejects.toMatchObject({
        code: 'reward_expired',
      });
      const rowAfterFirstAttempt = await rewards.entitlement(context, entitlement.id);
      expect(rowAfterFirstAttempt.status).toBe('expired'); // the persisted column itself, not merely the computed display value.
      expect(effectiveStatus(rowAfterFirstAttempt, context.timestamp)).toBe('expired');
      // A second, independently-keyed attempt keeps rejecting the same
      // way against the now-already-`expired` row — never a version
      // conflict, never a different error.
      await expect(rewards.redeem(context, 'redeem-expired-1-key-b', entitlement.id, branchId)).rejects.toMatchObject({
        code: 'reward_expired',
      });
      const rowAfterSecondAttempt = await rewards.entitlement(context, entitlement.id);
      expect(rowAfterSecondAttempt.status).toBe('expired');
      expect(rowAfterSecondAttempt.version).toBe(rowAfterFirstAttempt.version); // no further mutation on the second, already-expired attempt.
    });

    it('the lazy expiry transition writes exactly one reward.expired audit/outbox row, with no PII', async () => {
      const program = await createProgram('prog-redeem-expired-audit-1', { rewardThreshold: 3, rewardType: 'vip_pass' });
      const customer = await customers.createCustomer(context, 'cust-redeem-expired-audit-1', {
        firstName: 'Valeria',
        email: 'valeria.expired-audit@example.com',
      });
      const entitlement = await issueEntitlement('redeem-expired-audit-1', customer.value.id, program.id, {
        expiresAt: new Date('2026-09-01T00:00:00.000Z'),
      });
      await expect(rewards.redeem(context, 'redeem-expired-audit-1-key', entitlement.id, branchId)).rejects.toMatchObject({
        code: 'reward_expired',
      });
      const outboxRows = await database.pool.query<{ event_type: string; payload: Record<string, unknown> }>(
        `select event_type,payload from outbox_events where company_id=$1 and aggregate_id=$2 and event_type='reward.expired'`,
        [context.companyId, entitlement.id],
      );
      expect(outboxRows.rows).toHaveLength(1);
      const payload = JSON.stringify(outboxRows.rows[0]?.payload ?? {});
      expect(payload).not.toContain('Valeria');
      expect(payload).not.toContain('valeria.expired-audit@example.com');
      // A second, differently-keyed redeem attempt against the
      // already-expired row must not write a second expiry event — the
      // transition itself only ever happens once.
      await expect(rewards.redeem(context, 'redeem-expired-audit-1-key-2', entitlement.id, branchId)).rejects.toMatchObject({
        code: 'reward_expired',
      });
      const outboxRowsAfterSecondAttempt = await database.pool.query<{ event_type: string }>(
        `select event_type from outbox_events where company_id=$1 and aggregate_id=$2 and event_type='reward.expired'`,
        [context.companyId, entitlement.id],
      );
      expect(outboxRowsAfterSecondAttempt.rows).toHaveLength(1);
    });

    it('redeeming for a customer whose status is not active is rejected', async () => {
      const program = await createProgram('prog-redeem-inactivecust-1', { rewardThreshold: 3, rewardType: 'vip_pass' });
      const customer = await customers.createCustomer(context, 'cust-redeem-inactivecust-1', { firstName: 'Tomas' });
      const entitlement = await issueEntitlement('redeem-inactivecust-1', customer.value.id, program.id);
      await customers.updateCustomer(context, customer.value.id, { status: 'inactive', expectedVersion: customer.value.version });
      await expect(rewards.redeem(context, 'redeem-inactivecust-1-key', entitlement.id, branchId)).rejects.toMatchObject({
        code: 'reward_not_available',
      });
    });

    it('a cross-company redemption attempt returns resource_not_found, never leaking existence', async () => {
      const programB = await createProgram('prog-redeem-crosscompany-b-1', { rewardThreshold: 3, rewardType: 'vip_pass' }, contextB);
      const customerB = await customers.createCustomer(contextB, 'cust-redeem-crosscompany-b-1', { firstName: 'Uriel' });
      const entitlementB = await issueEntitlementFor(contextB, 'redeem-crosscompany-b-1', customerB.value.id, programB.id);
      await expect(rewards.redeem(context, 'redeem-crosscompany-a-key', entitlementB.id, branchId)).rejects.toMatchObject({
        code: 'resource_not_found',
      });
    });

    it('concurrency: two concurrent redeem attempts on the same entitlement — exactly one succeeds, the other gets reward_already_redeemed', async () => {
      const program = await createProgram('prog-redeem-conc-1', { rewardThreshold: 3, rewardType: 'vip_pass' });
      const customer = await customers.createCustomer(context, 'cust-redeem-conc-1', { firstName: 'Valeria' });
      const entitlement = await issueEntitlement('redeem-conc-1', customer.value.id, program.id);
      const results = await Promise.allSettled([
        rewards.redeem(context, 'redeem-conc-1-key-a', entitlement.id, branchId),
        rewards.redeem(context, 'redeem-conc-1-key-b', entitlement.id, branchId),
      ]);
      const fulfilled = results.filter((entry) => entry.status === 'fulfilled');
      const rejected = results.filter((entry): entry is PromiseRejectedResult => entry.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const [firstRejected] = rejected;
      if (firstRejected === undefined) throw new Error('Expected exactly one rejected redeem attempt.');
      expect(firstRejected.reason).toMatchObject({ code: 'reward_already_redeemed' });
    });

    it('rejects redemption from an actor lacking reward.redeem', async () => {
      const program = await createProgram('prog-redeem-perm-1', { rewardThreshold: 3, rewardType: 'vip_pass' });
      const customer = await customers.createCustomer(context, 'cust-redeem-perm-1', { firstName: 'Walter' });
      const entitlement = await issueEntitlement('redeem-perm-1', customer.value.id, program.id);
      const noPermissionContext = { ...context, actorPermissions: ['reward.read'] };
      await expect(rewards.redeem(noPermissionContext, 'redeem-perm-1-key', entitlement.id, branchId)).rejects.toMatchObject({
        code: 'validation_error',
      });
    });
  });

  // --- Revocation ------------------------------------------------------

  describe('revocation', () => {
    it('revokes an available entitlement: requires a reason, is version-checked, and a stale If-Match rejects with version_conflict', async () => {
      const program = await createProgram('prog-revoke-1', { rewardThreshold: 3, rewardType: 'vip_pass' });
      const customer = await customers.createCustomer(context, 'cust-revoke-1', { firstName: 'Ximena' });
      const entitlement = await issueEntitlement('revoke-1', customer.value.id, program.id);
      await expect(rewards.revoke(context, entitlement.id, 999n, 'Stale If-Match')).rejects.toMatchObject({
        code: 'version_conflict',
      });
      await expect(rewards.revoke(context, entitlement.id, entitlement.version, '')).rejects.toMatchObject({
        code: 'validation_error',
      });
      const revoked = await rewards.revoke(context, entitlement.id, entitlement.version, 'Issued in error');
      expect(revoked.status).toBe('revoked');
      expect(revoked.revokedReason).toBe('Issued in error');
      expect(revoked.version).toBe(entitlement.version + 1n);
    });

    it('revoking an already-revoked entitlement is a no-op returning the same state, even with a stale expectedVersion', async () => {
      const program = await createProgram('prog-revoke-again-1', { rewardThreshold: 3, rewardType: 'vip_pass' });
      const customer = await customers.createCustomer(context, 'cust-revoke-again-1', { firstName: 'Yago' });
      const entitlement = await issueEntitlement('revoke-again-1', customer.value.id, program.id);
      const first = await rewards.revoke(context, entitlement.id, entitlement.version, 'Issued in error');
      const again = await rewards.revoke(context, entitlement.id, entitlement.version /* now stale */, 'Issued in error');
      expect(again.status).toBe('revoked');
      expect(again.version).toBe(first.version);
    });

    it('revoking an already-redeemed entitlement is rejected — a redeemed reward cannot be revoked', async () => {
      const program = await createProgram('prog-revoke-redeemed-1', { rewardThreshold: 3, rewardType: 'vip_pass' });
      const customer = await customers.createCustomer(context, 'cust-revoke-redeemed-1', { firstName: 'Zara' });
      const entitlement = await issueEntitlement('revoke-redeemed-1', customer.value.id, program.id);
      await rewards.redeem(context, 'revoke-redeemed-1-key', entitlement.id, branchId);
      await expect(rewards.revoke(context, entitlement.id, entitlement.version + 1n, 'Too late')).rejects.toMatchObject({
        code: 'reward_already_redeemed',
      });
    });

    it('rejects revocation from an actor lacking reward.revoke', async () => {
      const program = await createProgram('prog-revoke-perm-1', { rewardThreshold: 3, rewardType: 'vip_pass' });
      const customer = await customers.createCustomer(context, 'cust-revoke-perm-1', { firstName: 'Abel' });
      const entitlement = await issueEntitlement('revoke-perm-1', customer.value.id, program.id);
      const noPermissionContext = { ...context, actorPermissions: ['reward.read'] };
      await expect(rewards.revoke(noPermissionContext, entitlement.id, entitlement.version, 'Nope')).rejects.toMatchObject({
        code: 'validation_error',
      });
    });
  });

  // --- Presentation tokens -----------------------------------------------

  describe('presentation tokens', () => {
    it('issues a token, then resolves it back to the entitlement', async () => {
      const program = await createProgram('prog-token-1', { rewardThreshold: 3, rewardType: 'vip_pass' });
      const customer = await customers.createCustomer(context, 'cust-token-1', { firstName: 'Bruno' });
      const entitlement = await issueEntitlement('token-1', customer.value.id, program.id);
      const issuedToken = await rewards.issueToken(context, entitlement.id);
      expect(issuedToken.status).toBe('active');
      const resolved = await rewards.resolveToken(context, issuedToken.token);
      expect(resolved.id).toBe(entitlement.id);
    });

    it('resolving a token belonging to a DIFFERENT company is rejected as reward_token_invalid, never leaking which company', async () => {
      const programB = await createProgram('prog-token-crosscompany-b-1', { rewardThreshold: 3, rewardType: 'vip_pass' }, contextB);
      const customerB = await customers.createCustomer(contextB, 'cust-token-crosscompany-b-1', { firstName: 'Camila' });
      const entitlementB = await issueEntitlementFor(contextB, 'token-crosscompany-b-1', customerB.value.id, programB.id);
      const tokenB = await rewards.issueToken(contextB, entitlementB.id);
      await expect(rewards.resolveToken(context, tokenB.token)).rejects.toMatchObject({ code: 'reward_token_invalid' });
    });

    it('resolving a revoked/inactive token is rejected', async () => {
      const program = await createProgram('prog-token-revoked-1', { rewardThreshold: 3, rewardType: 'vip_pass' });
      const customer = await customers.createCustomer(context, 'cust-token-revoked-1', { firstName: 'Diego' });
      const entitlement = await issueEntitlement('token-revoked-1', customer.value.id, program.id);
      const firstToken = await rewards.issueToken(context, entitlement.id);
      await rewards.issueToken(context, entitlement.id); // only one active token at a time — this implicitly revokes the first
      await expect(rewards.resolveToken(context, firstToken.token)).rejects.toMatchObject({ code: 'reward_token_invalid' });
    });

    it('the token value itself carries no customer PII', async () => {
      const program = await createProgram('prog-token-pii-1', { rewardThreshold: 3, rewardType: 'vip_pass' });
      const customer = await customers.createCustomer(context, 'cust-token-pii-1', {
        firstName: 'EstelaUniqueFirstName',
        email: 'estela-pii-check@example.test',
        phone: '+52 442 555 0199',
      });
      const entitlement = await issueEntitlement('token-pii-1', customer.value.id, program.id);
      const issuedToken = await rewards.issueToken(context, entitlement.id);
      expect(issuedToken.token).not.toContain(customer.value.id);
      expect(issuedToken.token.toLowerCase()).not.toContain('estela');
      expect(issuedToken.token.toLowerCase()).not.toContain('example.test');
      expect(issuedToken.token).not.toContain('4425550199');
    });
  });

  // --- Audit / outbox ------------------------------------------------------

  describe('audit and outbox', () => {
    it('automatic issuance writes exactly one reward_entitlement.issued / reward.issued row, with no PII', async () => {
      await createProgram('prog-audit-auto-1', { rewardThreshold: 2, rewardType: 'vip_pass' });
      const customer = await customers.createCustomer(context, 'cust-audit-auto-1', {
        firstName: 'FelipePiiCheck',
        email: 'felipe-pii-check@example.test',
        phone: '+52 442 555 0198',
      });
      await buyForCustomer('audit-auto-1a', customer.value.id);
      await buyForCustomer('audit-auto-1b', customer.value.id);
      const entitlements = await rewards.entitlementsForCustomer(context, customer.value.id);
      expect(entitlements).toHaveLength(1);
      const entitlementId = entitlements[0]?.id;
      if (entitlementId === undefined) throw new Error('Expected an automatically-issued entitlement.');
      const audit = await auditRows(companyId, 'reward_entitlement.issued', entitlementId);
      expect(audit).toHaveLength(1);
      const outbox = await outboxRows(companyId, 'reward.issued', entitlementId);
      expect(outbox).toHaveLength(1);
      const serializedAudit = JSON.stringify(audit[0]?.metadata).toLowerCase();
      const serializedOutbox = JSON.stringify(outbox[0]?.payload).toLowerCase();
      for (const needle of ['felipe', 'example.test', '4425550198']) {
        expect(serializedAudit).not.toContain(needle);
        expect(serializedOutbox).not.toContain(needle);
      }
    });

    it('manual issuance writes exactly one reward_entitlement.issued_manual / reward.issued row, with no PII', async () => {
      const program = await createProgram('prog-audit-manual-1', { rewardThreshold: 3, rewardType: 'vip_pass' });
      const customer = await customers.createCustomer(context, 'cust-audit-manual-1', {
        firstName: 'GretaPiiCheck',
        email: 'greta-pii-check@example.test',
        phone: '+52 442 555 0197',
      });
      const entitlement = await issueEntitlement('audit-manual-1', customer.value.id, program.id);
      const audit = await auditRows(companyId, 'reward_entitlement.issued_manual', entitlement.id);
      expect(audit).toHaveLength(1);
      const outbox = await outboxRows(companyId, 'reward.issued', entitlement.id);
      expect(outbox).toHaveLength(1);
      const serializedAudit = JSON.stringify(audit[0]?.metadata).toLowerCase();
      const serializedOutbox = JSON.stringify(outbox[0]?.payload).toLowerCase();
      for (const needle of ['greta', 'example.test', '4425550197']) {
        expect(serializedAudit).not.toContain(needle);
        expect(serializedOutbox).not.toContain(needle);
      }
    });

    it('redeeming writes exactly one reward_entitlement.redeemed / reward.redeemed row, with no PII', async () => {
      const program = await createProgram('prog-audit-redeem-1', { rewardThreshold: 3, rewardType: 'vip_pass' });
      const customer = await customers.createCustomer(context, 'cust-audit-redeem-1', {
        firstName: 'HectorPiiCheck',
        email: 'hector-pii-check@example.test',
        phone: '+52 442 555 0196',
      });
      const entitlement = await issueEntitlement('audit-redeem-1', customer.value.id, program.id);
      await rewards.redeem(context, 'audit-redeem-1-key', entitlement.id, branchId);
      const audit = await auditRows(companyId, 'reward_entitlement.redeemed', entitlement.id);
      expect(audit).toHaveLength(1);
      const outbox = await outboxRows(companyId, 'reward.redeemed', entitlement.id);
      expect(outbox).toHaveLength(1);
      const serializedAudit = JSON.stringify(audit[0]?.metadata).toLowerCase();
      const serializedOutbox = JSON.stringify(outbox[0]?.payload).toLowerCase();
      for (const needle of ['hector', 'example.test', '4425550196']) {
        expect(serializedAudit).not.toContain(needle);
        expect(serializedOutbox).not.toContain(needle);
      }
    });
  });
});
