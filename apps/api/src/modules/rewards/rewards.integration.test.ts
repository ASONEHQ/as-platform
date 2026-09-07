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
import { PromotionsRepository } from '../promotions/promotions.repository.js';
import { PromotionsService } from '../promotions/promotions.service.js';
import { mapSaleError } from '../sales/sales.http-errors.js';
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
  let promotions: PromotionsService;
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
    // TASK 13.2 — `sale_reward_usages`/`loyalty_program_reward_products`/
    // `loyalty_program_reward_categories`, plus `loyalty_programs`'s new
    // `reward_benefit_*` columns and `sale_discounts`'s widened
    // `source_type` check (now also allows `'reward'`).
    await applyIfMissing('sale_reward_usages', ['0023_tan_luke_cage.sql']);

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
    const promotionsRepository = new PromotionsRepository(database);
    loyaltyRepository = new LoyaltyRepository(database);
    loyalty = new LoyaltyService(loyaltyRepository);
    rewardsRepository = new RewardsRepository(database);
    rewards = new RewardsService(rewardsRepository, loyaltyRepository, customersRepository);
    // TASK 13.2 — `promotionsRepository` (so a reward's `sale_discounts`
    // snapshot is actually written, exactly like real production wiring)
    // and `rewards` as the 4th/5th args: `createSale` resolves/records a
    // reward benefit via `RewardsService` when `rewardEntitlementId` is
    // supplied; `quote()` mirrors the identical resolution read-only.
    sales = new SalesService(salesRepository, promotionsRepository, customersRepository, rewards);
    promotions = new PromotionsService(promotionsRepository, rewards);
    const cashRepository = new CashRepository(database);
    cash = new CashService(cashRepository);
    const paymentRepository = new PaymentRepository(database);
    const mercadoPagoProvider = new MercadoPagoPointProvider(
      new MercadoPagoClient({ accessToken: undefined, apiBaseUrl: 'https://api.mercadopago.com' }),
    );
    // TASK 13.1 — `rewardsService` as the 7th arg: `applyPostSettlementHooks`
    // calls `evaluateAutomaticIssuance` AFTER `loyaltyService.earnFromSale`,
    // in the same settlement transaction — see `payments.service.ts`.
    payments = new PaymentService(paymentRepository, salesRepository, mercadoPagoProvider, cashRepository, undefined, loyalty, rewards);
  });

  afterEach(async () => {
    for (const cid of [companyId, companyIdB]) {
      // TASK 13.2 — `sale_reward_usages` (restrict-FK child of `sales`/
      // `sale_items`/`reward_entitlements`/`loyalty_programs`) and
      // `sale_discounts` (restrict-FK child of `sales`/`sale_items`, now
      // also written for a reward's own snapshot since `sales` is wired
      // with a real `promotionsRepository` in this file) must both be
      // cleared before any of their parents below.
      await database.pool.query('delete from sale_reward_usages where company_id=$1', [cid]);
      await database.pool.query('delete from sale_discounts where company_id=$1', [cid]);
      await database.pool.query('delete from reward_entitlement_tokens where company_id=$1', [cid]);
      await database.pool.query('delete from reward_entitlements where company_id=$1', [cid]);
      await database.pool.query('delete from payment_attempts where company_id=$1', [cid]);
      await database.pool.query('delete from payments where company_id=$1', [cid]);
      await database.pool.query('delete from loyalty_ledger where company_id=$1', [cid]);
      await database.pool.query('delete from loyalty_accounts where company_id=$1', [cid]);
      // TASK 13.2 — a reward's benefit scope (restrict-FK child of
      // `loyalty_programs`) must be cleared before the programs themselves.
      await database.pool.query('delete from loyalty_program_reward_products where company_id=$1', [cid]);
      await database.pool.query('delete from loyalty_program_reward_categories where company_id=$1', [cid]);
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

  // --- TASK 13.2 fixture helpers (checkout benefit application + VIP Pass
  // POS consumption) --------------------------------------------------

  /** A reward program with a real checkout BENEFIT configured (not just
   * the bare threshold/type TASK 13.1's own helpers above build) — scoped
   * to this file's single `productId` fixture by default, a
   * `percentage_discount` of 50% unless overridden. `rewardThreshold`/
   * `rewardType` are always supplied together (Part B) even though every
   * test below issues its entitlement manually via `issueEntitlement`,
   * never through a real threshold crossing. */
  async function createBenefitProgram(
    key: string,
    overrides: Partial<Parameters<LoyaltyService['createProgram']>[2]> = {},
  ): Promise<LoyaltyProgramRow> {
    return createProgram(key, {
      rewardThreshold: 3,
      rewardType: 'vip_pass',
      rewardBenefitType: 'percentage_discount',
      rewardBenefitPercentageBasisPoints: 5000,
      rewardScopeProductIds: [productId],
      ...overrides,
    });
  }

  /** Opens a fresh register+session for `branchId` — the same real
   * `CashService` calls `buyForCustomer` above already uses, split out
   * standalone so a test can create a Sale (with a reward attached) and
   * settle it as two clearly separate steps, or open two independent
   * sessions/registers to race two different Sales' own settlements
   * against each other without them fighting over "which open session"
   * `resolveOpenCashSession` should pick. */
  async function openRegisterAndSession(keySuffix: string): Promise<{ registerId: string }> {
    const register = await cash.createRegister(context, branchIds, `reg-${keySuffix}`, {
      branchId,
      code: `REG-${keySuffix}`,
      name: `Caja ${keySuffix}`,
    });
    await cash.openSession(context, branchIds, `session-${keySuffix}`, {
      cashRegisterId: register.value.id,
      openingAmount: '0.0000',
    });
    return { registerId: register.value.id };
  }

  /** Creates a pending_payment Sale for `productId` (this file's own
   * $200.0000, IVA_EXEMPT fixture — 0% tax keeps every benefit-type's
   * arithmetic simple and round) with `rewardEntitlementId` attached,
   * via the real `SalesService.createSale` — never a raw insert. */
  async function createRewardSale(
    keySuffix: string,
    customerId: string,
    rewardEntitlementId: string,
    quantity = '1',
  ): ReturnType<SalesService['createSale']> {
    return sales.createSale(context, branchIds, `sale-${keySuffix}`, {
      branchId,
      customerId,
      items: [{ productId, quantity }],
      rewardEntitlementId,
    });
  }

  async function saleRewardUsageRows(
    targetCompanyId: string,
    saleId: string,
  ): Promise<
    { status: string; benefit_amount_snapshot: string; consumed_at: Date | null; released_at: Date | null }[]
  > {
    const rows = await database.pool.query<{
      status: string;
      benefit_amount_snapshot: string;
      consumed_at: Date | null;
      released_at: Date | null;
    }>(
      `select status, benefit_amount_snapshot::text as benefit_amount_snapshot, consumed_at, released_at
       from sale_reward_usages where company_id=$1 and sale_id=$2`,
      [targetCompanyId, saleId],
    );
    return rows.rows;
  }

  async function capturedPaymentCount(targetCompanyId: string, saleId: string): Promise<number> {
    const rows = await database.pool.query<{ n: string }>(
      `select count(*)::text as n from payments where company_id=$1 and sale_id=$2 and status='captured'`,
      [targetCompanyId, saleId],
    );
    return Number(rows.rows[0]?.n ?? '0');
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

  // --- Reward benefit application + VIP Pass POS consumption (TASK 13.2,
  // ADR-0019) — Part V integration coverage. `pricing.service.ts`'s own
  // reward-benefit arithmetic (which entry point applies, capping, scope
  // matching) already has full unit coverage
  // (`pricing.service.test.ts`) — everything below instead proves the
  // real, end-to-end WIRING across modules: quote is genuinely read-only,
  // sale creation only ever freezes a snapshot, and — the single most
  // important guarantee in this task — settlement is the ONLY place an
  // entitlement is ever actually redeemed, exactly once, even when two
  // Sales race to consume the same one.
  describe('checkout benefit application + VIP Pass POS consumption (TASK 13.2, ADR-0019)', () => {
    describe('quote (read-only preview)', () => {
      it('repeated quote calls with a reward attached never mutate the entitlement or write a sale_reward_usages row', async () => {
        const program = await createBenefitProgram('prog-quote-readonly-1');
        const customer = await customers.createCustomer(context, 'cust-quote-readonly-1', { firstName: 'Quote' });
        const entitlement = await issueEntitlement('quote-readonly-1', customer.value.id, program.id);
        for (let i = 0; i < 3; i += 1) {
          const quote = await promotions.quote(context, branchIds, {
            branchId,
            items: [{ productId, quantity: '1' }],
            customerId: customer.value.id,
            rewardEntitlementId: entitlement.id,
          });
          // 50% off $200.0000 — proves the reward benefit really was
          // resolved and priced on every one of the three calls, not
          // silently skipped.
          expect(quote.discountTotalUnits).toBe(1_000_000n);
        }
        const after = await rewards.entitlement(context, entitlement.id);
        expect(after.status).toBe('available');
        expect(after.version).toBe(entitlement.version);
        expect(after.redeemedAt).toBeNull();
        const usageCount = await database.pool.query<{ n: string }>(
          `select count(*)::text as n from sale_reward_usages where company_id=$1 and reward_entitlement_id=$2`,
          [companyId, entitlement.id],
        );
        expect(usageCount.rows[0]?.n).toBe('0');
      });
    });

    describe('sale creation (freezes a snapshot, never redeems)', () => {
      it('writes exactly one applied sale_reward_usages row matching the pricing engine discount, without redeeming the entitlement', async () => {
        const program = await createBenefitProgram('prog-create-snapshot-1');
        const customer = await customers.createCustomer(context, 'cust-create-snapshot-1', { firstName: 'Snap' });
        const entitlement = await issueEntitlement('create-snapshot-1', customer.value.id, program.id);
        const created = await createRewardSale('create-snapshot-1', customer.value.id, entitlement.id);
        expect(created.value.sale.status).toBe('pending_payment');
        expect(created.value.sale.discountTotal).toBe('100.0000'); // 50% off $200.0000.
        const usageRows = await saleRewardUsageRows(companyId, created.value.sale.id);
        expect(usageRows).toHaveLength(1);
        expect(usageRows[0]).toMatchObject({ status: 'applied', consumed_at: null, released_at: null });
        expect(usageRows[0]?.benefit_amount_snapshot).toBe(created.value.sale.discountTotal);
        const afterEntitlement = await rewards.entitlement(context, entitlement.id);
        expect(afterEntitlement.status).toBe('available');
        expect(afterEntitlement.redeemedAt).toBeNull();
        expect(afterEntitlement.version).toBe(entitlement.version); // untouched — creation never locks/mutates it.
      });
    });

    describe('settlement (consumes exactly once)', () => {
      it('settling the sale redeems the entitlement, consumes the usage row, and writes exactly one reward.redeemed row for this sale', async () => {
        const program = await createBenefitProgram('prog-settle-1');
        const customer = await customers.createCustomer(context, 'cust-settle-1', { firstName: 'Settle' });
        const entitlement = await issueEntitlement('settle-1', customer.value.id, program.id);
        const created = await createRewardSale('settle-1', customer.value.id, entitlement.id);
        expect(created.value.sale.total).toBe('100.0000');
        const { registerId } = await openRegisterAndSession('settle-1');
        const cashPayment = await payments.createCashPayment(context, branchIds, 'pay-settle-1', {
          saleId: created.value.sale.id,
          tenderedAmount: '100.0000',
          cashRegisterId: registerId,
        });
        expect(cashPayment.value.sale.status).toBe('completed');
        const afterEntitlement = await rewards.entitlement(context, entitlement.id);
        expect(afterEntitlement.status).toBe('redeemed');
        expect(afterEntitlement.redeemedAt).not.toBeNull();
        expect(afterEntitlement.redeemedBranchId).toBe(branchId);
        const usageRows = await saleRewardUsageRows(companyId, created.value.sale.id);
        expect(usageRows).toHaveLength(1);
        expect(usageRows[0]?.status).toBe('consumed');
        expect(usageRows[0]?.consumed_at).not.toBeNull();
        const outbox = await outboxRows(companyId, 'reward.redeemed', entitlement.id);
        expect(outbox).toHaveLength(1);
        expect(outbox[0]?.payload).toMatchObject({ sale_id: created.value.sale.id });
      });
    });

    describe('settlement idempotency (retry-safety)', () => {
      it('replaying the same cash-payment idempotency key on an already-settled sale never re-attempts or double-consumes the reward', async () => {
        const program = await createBenefitProgram('prog-settle-retry-1');
        const customer = await customers.createCustomer(context, 'cust-settle-retry-1', { firstName: 'Retry' });
        const entitlement = await issueEntitlement('settle-retry-1', customer.value.id, program.id);
        const created = await createRewardSale('settle-retry-1', customer.value.id, entitlement.id);
        const { registerId } = await openRegisterAndSession('settle-retry-1');
        const first = await payments.createCashPayment(context, branchIds, 'pay-settle-retry-1', {
          saleId: created.value.sale.id,
          tenderedAmount: '100.0000',
          cashRegisterId: registerId,
        });
        expect(first.replayed).toBe(false);
        const afterFirst = await rewards.entitlement(context, entitlement.id);
        expect(afterFirst.status).toBe('redeemed');
        // A replayed confirmation (same idempotency key) never re-executes
        // `createCashPayment`'s own body at all — `consumeAppliedUsagesForSale`
        // is never called a second time, so there is nothing to throw on
        // and nothing to double-consume.
        const replay = await payments.createCashPayment(context, branchIds, 'pay-settle-retry-1', {
          saleId: created.value.sale.id,
          tenderedAmount: '100.0000',
          cashRegisterId: registerId,
        });
        expect(replay.replayed).toBe(true);
        const afterReplay = await rewards.entitlement(context, entitlement.id);
        expect(afterReplay.status).toBe('redeemed');
        expect(afterReplay.version).toBe(afterFirst.version); // no further mutation from the replay.
        const usageRows = await saleRewardUsageRows(companyId, created.value.sale.id);
        expect(usageRows).toHaveLength(1);
        expect(usageRows[0]?.status).toBe('consumed');
        const outbox = await outboxRows(companyId, 'reward.redeemed', entitlement.id);
        expect(outbox).toHaveLength(1); // never a second consumption event from the replay.
      });
    });

    // THE single most important test in this whole task (see the task's
    // own Part V spec) — two entirely separate Sales, for the SAME
    // customer, both legitimately attach the SAME reward entitlement at
    // creation time (both succeed — creation only ever checks the
    // entitlement is still `available`, which it genuinely is for both,
    // since neither has settled yet). Racing their SETTLEMENT must let
    // exactly one through and cleanly roll the other back — never a
    // double-redeem, never a partially-completed Sale.
    describe('concurrent settlement — the critical guarantee', () => {
      it('two Sales referencing the same reward entitlement race to settle: exactly one succeeds, the other rolls back cleanly with no partial state', async () => {
        const program = await createBenefitProgram('prog-race-1');
        const customer = await customers.createCustomer(context, 'cust-race-1', { firstName: 'Race' });
        const entitlement = await issueEntitlement('race-1', customer.value.id, program.id);
        const saleA = await createRewardSale('race-1a', customer.value.id, entitlement.id);
        const saleB = await createRewardSale('race-1b', customer.value.id, entitlement.id);
        expect(saleA.value.sale.total).toBe('100.0000');
        expect(saleB.value.sale.total).toBe('100.0000');
        // Both Sales already, legitimately, each hold their own `applied`
        // usage row against the very same entitlement — the state this
        // whole test exists to race.
        expect((await saleRewardUsageRows(companyId, saleA.value.sale.id))[0]?.status).toBe('applied');
        expect((await saleRewardUsageRows(companyId, saleB.value.sale.id))[0]?.status).toBe('applied');

        // Two independent registers/sessions so neither `createCashPayment`
        // call has to guess "which open session" — each is explicit,
        // exactly like a real second physical register would be.
        const registerA = await openRegisterAndSession('race-1a');
        const registerB = await openRegisterAndSession('race-1b');
        const results = await Promise.allSettled([
          payments.createCashPayment(context, branchIds, 'pay-race-1a', {
            saleId: saleA.value.sale.id,
            tenderedAmount: '100.0000',
            cashRegisterId: registerA.registerId,
          }),
          payments.createCashPayment(context, branchIds, 'pay-race-1b', {
            saleId: saleB.value.sale.id,
            tenderedAmount: '100.0000',
            cashRegisterId: registerB.registerId,
          }),
        ]);
        const fulfilled = results.filter(
          (entry): entry is PromiseFulfilledResult<Awaited<ReturnType<typeof payments.createCashPayment>>> =>
            entry.status === 'fulfilled',
        );
        const rejected = results.filter((entry): entry is PromiseRejectedResult => entry.status === 'rejected');
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        // The loser's own settlement transaction is rolled back by exactly
        // the same `reward_already_redeemed` a standalone `redeem()` call
        // would raise — `RewardsService.consumeAppliedUsagesForSale` uses
        // the identical row-locked mechanism, no parallel primitive.
        expect(rejected[0]?.reason).toMatchObject({ code: 'reward_already_redeemed' });

        const winningSaleId = fulfilled[0]?.value.value.sale.id;
        if (winningSaleId === undefined) throw new Error('Expected exactly one winning settlement.');
        const losingSaleId = winningSaleId === saleA.value.sale.id ? saleB.value.sale.id : saleA.value.sale.id;

        const winningSale = await sales.sale(companyId, branchIds, winningSaleId);
        expect(winningSale.sale.status).toBe('completed');
        const losingSale = await sales.sale(companyId, branchIds, losingSaleId);
        // Never partially completed — the loser's Sale stays exactly where
        // it was before the race, and its own payment attempt left no
        // captured payment row behind (the whole transaction, including
        // the payment/attempt/cash-movement inserts made earlier in that
        // SAME transaction, rolled back together with the reward
        // rejection).
        expect(losingSale.sale.status).toBe('pending_payment');
        expect(await capturedPaymentCount(companyId, losingSaleId)).toBe(0);

        const afterEntitlement = await rewards.entitlement(context, entitlement.id);
        expect(afterEntitlement.status).toBe('redeemed'); // exactly once, overall.

        const winningUsage = await saleRewardUsageRows(companyId, winningSaleId);
        expect(winningUsage).toHaveLength(1);
        expect(winningUsage[0]?.status).toBe('consumed');
        expect(winningUsage[0]?.consumed_at).not.toBeNull();

        const losingUsage = await saleRewardUsageRows(companyId, losingSaleId);
        expect(losingUsage).toHaveLength(1);
        // The loser's own usage row was never touched by the failed
        // settlement attempt — `markSaleRewardUsageConsumed` never
        // committed before the whole transaction rolled back, so it
        // remains exactly what `createSale` left it as: still `applied`,
        // never `consumed`, and (deliberately) never released either —
        // this Sale itself was never cancelled, only its settlement
        // attempt failed.
        expect(losingUsage[0]?.status).toBe('applied');
        expect(losingUsage[0]?.consumed_at).toBeNull();
        expect(losingUsage[0]?.released_at).toBeNull();

        // Exactly one `reward.redeemed` row overall, referencing the
        // WINNING sale specifically — never the loser's.
        const outbox = await outboxRows(companyId, 'reward.redeemed', entitlement.id);
        expect(outbox).toHaveLength(1);
        expect(outbox[0]?.payload).toMatchObject({ sale_id: winningSaleId });
      });
    });

    describe('cancellation (releases the usage, never touches the entitlement)', () => {
      it('cancelling a pending-payment sale releases its sale_reward_usages row without ever redeeming the entitlement', async () => {
        const program = await createBenefitProgram('prog-cancel-1');
        const customer = await customers.createCustomer(context, 'cust-cancel-1', { firstName: 'Cancel' });
        const entitlement = await issueEntitlement('cancel-1', customer.value.id, program.id);
        const created = await createRewardSale('cancel-1', customer.value.id, entitlement.id);
        await sales.cancelSale(
          context,
          branchIds,
          created.value.sale.id,
          'sale-cancel-reward-1-key',
          'customer_changed_mind',
        );
        const usageRows = await saleRewardUsageRows(companyId, created.value.sale.id);
        expect(usageRows).toHaveLength(1);
        expect(usageRows[0]?.status).toBe('released');
        expect(usageRows[0]?.released_at).not.toBeNull();
        expect(usageRows[0]?.consumed_at).toBeNull();
        const afterEntitlement = await rewards.entitlement(context, entitlement.id);
        // Never redeemed-then-un-redeemed — simply never redeemed at all:
        // the entitlement itself was never locked or mutated by creation,
        // so cancellation has nothing to give back.
        expect(afterEntitlement.status).toBe('available');
        expect(afterEntitlement.redeemedAt).toBeNull();
        expect(afterEntitlement.version).toBe(entitlement.version);
      });
    });

    describe('zero-total completion', () => {
      it('a free_eligible_item reward that waives the sale entirely settles via completeZeroTotalSale with no payment/cash rows at all', async () => {
        const program = await createProgram('prog-zerototal-1', {
          rewardThreshold: 3,
          rewardType: 'vip_pass',
          rewardBenefitType: 'free_eligible_item',
          rewardScopeProductIds: [productId],
        });
        const customer = await customers.createCustomer(context, 'cust-zerototal-1', { firstName: 'Zero' });
        const entitlement = await issueEntitlement('zerototal-1', customer.value.id, program.id);
        const created = await createRewardSale('zerototal-1', customer.value.id, entitlement.id);
        // The reward waives the entire (only) line — 0% tax on this
        // file's own IVA_EXEMPT fixture keeps the post-discount base,
        // and therefore the tax, at exactly zero too.
        expect(created.value.sale.discountTotal).toBe('200.0000');
        expect(created.value.sale.taxTotal).toBe('0.0000');
        expect(created.value.sale.total).toBe('0.0000');

        const zeroTotal = await payments.completeZeroTotalSale(context, branchIds, created.value.sale.id);
        expect(zeroTotal.sale.status).toBe('completed');

        const afterEntitlement = await rewards.entitlement(context, entitlement.id);
        expect(afterEntitlement.status).toBe('redeemed');
        const usageRows = await saleRewardUsageRows(companyId, created.value.sale.id);
        expect(usageRows).toHaveLength(1);
        expect(usageRows[0]?.status).toBe('consumed');

        // No payment/payment_attempt/cash_movement row was ever created —
        // not merely none captured.
        const paymentCount = await database.pool.query<{ n: string }>(
          `select count(*)::text as n from payments where company_id=$1 and sale_id=$2`,
          [companyId, created.value.sale.id],
        );
        expect(paymentCount.rows[0]?.n).toBe('0');
        const attemptCount = await database.pool.query<{ n: string }>(
          `select count(*)::text as n from payment_attempts where company_id=$1
           and payment_id in (select id from payments where company_id=$1 and sale_id=$2)`,
          [companyId, created.value.sale.id],
        );
        expect(attemptCount.rows[0]?.n).toBe('0');
        const cashMovementCount = await database.pool.query<{ n: string }>(
          `select count(*)::text as n from cash_movements where company_id=$1`,
          [companyId],
        );
        expect(cashMovementCount.rows[0]?.n).toBe('0');

        // A distinct `sale.completed_without_payment` fact, IN ADDITION TO
        // (never instead of) the normal `sale.completed` every other
        // settlement path already writes.
        const completed = await outboxRows(companyId, 'sale.completed', created.value.sale.id);
        expect(completed).toHaveLength(1);
        const completedWithoutPayment = await outboxRows(
          companyId,
          'sale.completed_without_payment',
          created.value.sale.id,
        );
        expect(completedWithoutPayment).toHaveLength(1);
      });
    });

    describe('rejection mapping (createSale surfaces the same reward_* codes redeem() would)', () => {
      it('an already-redeemed rewardEntitlementId is rejected with the same mapped reward_already_redeemed error redeem() would give', async () => {
        const program = await createBenefitProgram('prog-reject-redeemed-1');
        const customer = await customers.createCustomer(context, 'cust-reject-redeemed-1', { firstName: 'Redeemed' });
        const entitlement = await issueEntitlement('reject-redeemed-1', customer.value.id, program.id);
        await rewards.redeem(context, 'reject-redeemed-1-redeem-key', entitlement.id, branchId);
        await expect(
          sales
            .createSale(context, branchIds, 'sale-reject-redeemed-1', {
              branchId,
              customerId: customer.value.id,
              items: [{ productId, quantity: '1' }],
              rewardEntitlementId: entitlement.id,
            })
            .catch((error: unknown) => {
              throw mapSaleError(error);
            }),
        ).rejects.toMatchObject({ code: 'reward_already_redeemed', statusCode: 409 });
      });

      it('an expired rewardEntitlementId is rejected with the same mapped reward_expired error redeem() would give', async () => {
        const program = await createBenefitProgram('prog-reject-expired-1');
        const customer = await customers.createCustomer(context, 'cust-reject-expired-1', { firstName: 'Expired' });
        const entitlement = await issueEntitlement('reject-expired-1', customer.value.id, program.id, {
          expiresAt: new Date('2026-09-01T00:00:00.000Z'), // before context.timestamp (2026-09-04).
        });
        await expect(
          sales
            .createSale(context, branchIds, 'sale-reject-expired-1', {
              branchId,
              customerId: customer.value.id,
              items: [{ productId, quantity: '1' }],
              rewardEntitlementId: entitlement.id,
            })
            .catch((error: unknown) => {
              throw mapSaleError(error);
            }),
        ).rejects.toMatchObject({ code: 'reward_expired', statusCode: 409 });
      });

      it('a rewardEntitlementId belonging to a different customer is rejected with the mapped reward_not_available error, never leaking to the wrong cart', async () => {
        const program = await createBenefitProgram('prog-reject-wrongcustomer-1');
        const owner = await customers.createCustomer(context, 'cust-reject-wrongcustomer-owner-1', {
          firstName: 'Owner',
        });
        const stranger = await customers.createCustomer(context, 'cust-reject-wrongcustomer-stranger-1', {
          firstName: 'Stranger',
        });
        const entitlement = await issueEntitlement('reject-wrongcustomer-1', owner.value.id, program.id);
        await expect(
          sales
            .createSale(context, branchIds, 'sale-reject-wrongcustomer-1', {
              branchId,
              customerId: stranger.value.id,
              items: [{ productId, quantity: '1' }],
              rewardEntitlementId: entitlement.id,
            })
            .catch((error: unknown) => {
              throw mapSaleError(error);
            }),
        ).rejects.toMatchObject({ code: 'reward_not_available', statusCode: 409 });
      });
    });
  });
});
