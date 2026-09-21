import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';

import { PostgresAuthRepository } from '../auth/auth.repository.js';
import { AuthService } from '../auth/auth.service.js';
import { AuthTokens } from '../auth/auth.tokens.js';
import { CashRepository } from '../cash/cash.repository.js';
import { CashService } from '../cash/cash.service.js';
import type { CashMutationContext } from '../cash/cash.types.js';
import { OperationalAreasRepository } from '../operational-areas/operational-areas.repository.js';
import { OperationalAreasService } from '../operational-areas/operational-areas.service.js';
import type { OperationalAreaMutationContext } from '../operational-areas/operational-areas.types.js';
import { PaymentRepository } from '../payments/payments.repository.js';
import { PaymentService } from '../payments/payments.service.js';
import { MercadoPagoClient } from '../payments/providers/mercado-pago.client.js';
import { MercadoPagoPointProvider } from '../payments/providers/mercado-pago.provider.js';
import { SalesRepository } from '../sales/sales.repository.js';
import { SalesService } from '../sales/sales.service.js';
import { BranchConsolidationService } from './branch-consolidation.service.js';

/** TASK 16.15 — multi-register operations: simultaneous registers,
 * operational-area grouping, the branch-consolidated read model, no-
 * double-counting, and register/area/branch/tenant scope isolation. A
 * dedicated file (separate from `cash-final-close-commercial.integration.
 * test.ts`/`cash-card-reconciliation.integration.test.ts`) because this
 * task's own fixture (multiple registers, areas, and register-scoped
 * users) is a genuinely different shape.
 *
 * Domain-service-level tests below call `CashService`/`SalesService`/
 * `BranchConsolidationService` directly with hand-built `branchIds`/
 * `permittedRegisterIds` arrays — the exact same established convention
 * `cash-final-close-commercial.integration.test.ts` already uses (real
 * end-to-end HTTP/auth-token flows are reserved for dedicated auth test
 * files). The one place this file DOES exercise the real
 * `PostgresAuthRepository#resolveContext` SQL is its own "register scope
 * resolution via real auth" group below — proving the actual
 * `user_register_access` query, not a hand-simulated one. */
const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;

integration('PostgreSQL multi-register operations (TASK 16.15)', { concurrent: false }, () => {
  let database: DatabaseClient;
  let cash: CashService;
  let cashRepository: CashRepository;
  let sales: SalesService;
  let payments: PaymentService;
  let areas: OperationalAreasService;
  let consolidation: BranchConsolidationService;
  let authRepository: PostgresAuthRepository;

  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const branchId = randomUUID();
  const otherBranchId = randomUUID();
  const otherCompanyBranchId = randomUUID();
  const ownerUserId = randomUUID();
  const managerUserId = randomUUID();
  const admissionsCashierUserId = randomUUID();
  const foodCashierUserId = randomUUID();
  const branchIds = [branchId, otherBranchId];

  const admissionsProductId = randomUUID();
  const foodProductId = randomUUID();

  let admissionsAreaId: string;
  let foodAreaId: string;
  let eventsAreaId: string;
  let admissions1Id: string;
  let admissions2Id: string;
  let food1Id: string;
  let events1Id: string;

  // Set by the deterministic scenario describe block; read by the
  // "no double counting" cross-check describe block below it, so that
  // check stays scoped to exactly these two sessions rather than every
  // closed session the whole file's other describe blocks may also have
  // produced against the same branch.
  let deterministicAdmSessionId: string;
  let deterministicFoodSessionId: string;

  let ownerMembershipId: string;
  let managerMembershipId: string;
  let admissionsCashierMembershipId: string;
  let foodCashierMembershipId: string;

  function cashContext(timestamp: Date, actorId: string = ownerUserId): CashMutationContext {
    return { companyId, actorId, requestId: `req-${randomUUID()}`, correlationId: `corr-${randomUUID()}`, timestamp };
  }
  function areaContext(timestamp: Date): OperationalAreaMutationContext {
    return { companyId, actorId: ownerUserId, requestId: `req-${randomUUID()}`, correlationId: `corr-${randomUUID()}`, timestamp };
  }

  async function cashSale(timestamp: Date, productId: string, registerId: string, actorId: string): Promise<void> {
    const ctx = cashContext(timestamp, actorId);
    const sale = await sales.createSale(ctx, branchIds, `sale-${randomUUID()}`, {
      branchId,
      items: [{ productId, quantity: '1' }],
      cashRegisterId: registerId,
    });
    await payments.createCashPayment(ctx, branchIds, `pay-${randomUUID()}`, {
      saleId: sale.value.sale.id,
      tenderedAmount: sale.value.sale.total,
      cashRegisterId: registerId,
    });
  }
  async function cardSale(timestamp: Date, productId: string, registerId: string, actorId: string): Promise<void> {
    const ctx = cashContext(timestamp, actorId);
    const sale = await sales.createSale(ctx, branchIds, `sale-${randomUUID()}`, {
      branchId,
      items: [{ productId, quantity: '1' }],
      cashRegisterId: registerId,
    });
    const created = await payments.createPayment(ctx, branchIds, `pay-${randomUUID()}`, {
      branchId,
      saleId: sale.value.sale.id,
      paymentMethod: 'card_manual',
      amount: sale.value.sale.total,
      currencyCode: 'MXN',
    });
    await payments.transitionAttempt(ctx, branchIds, created.value.attempt.id, `approve-${randomUUID()}`, { status: 'approved' });
  }

  beforeAll(async () => {
    if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({ connectionString: databaseUrl, applicationName: 'asone-multi-register-integration' });

    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'Test Park','Test Park',$2,'active','America/Mexico_City','MXN','es-MX'),
             ($3,'Other Park','Other Park',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `testpark-${companyId}`, otherCompanyId, `otherpark-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'Test Branch','TESTBR','active','America/Mexico_City'),
             ($3,$2,'Second Branch','SECONDBR','active','America/Mexico_City'),
             ($4,$5,'Other Park Branch','OTHERBR','active','UTC')`,
      [branchId, companyId, otherBranchId, otherCompanyBranchId, otherCompanyId],
    );

    // --- Users/memberships/roles ---
    const ownerRoleId = randomUUID();
    const managerRoleId = randomUUID();
    const cashierRoleId = randomUUID();
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'Test Owner','active'),($3,$4,$4,'Test Manager','active'),
             ($5,$6,$6,'Admissions Cashier','active'),($7,$8,$8,'Food Cashier','active')`,
      [
        ownerUserId,
        `owner-${ownerUserId}@example.test`,
        managerUserId,
        `manager-${managerUserId}@example.test`,
        admissionsCashierUserId,
        `admissions-${admissionsCashierUserId}@example.test`,
        foodCashierUserId,
        `food-${foodCashierUserId}@example.test`,
      ],
    );
    ownerMembershipId = randomUUID();
    managerMembershipId = randomUUID();
    admissionsCashierMembershipId = randomUUID();
    foodCashierMembershipId = randomUUID();
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status)
       values($1,$2,$3,'active'),($4,$2,$5,'active'),($6,$2,$7,'active'),($8,$2,$9,'active')`,
      [
        ownerMembershipId,
        companyId,
        ownerUserId,
        managerMembershipId,
        managerUserId,
        admissionsCashierMembershipId,
        admissionsCashierUserId,
        foodCashierMembershipId,
        foodCashierUserId,
      ],
    );
    await database.pool.query(
      `insert into roles(id,company_id,name,code,status,is_system)
       values($1,$2,'Owner','owner','active',true),
             ($3,$2,'Branch Manager','branch_manager','active',false),
             ($4,$2,'Cashier','cashier','active',false)`,
      [ownerRoleId, companyId, managerRoleId, cashierRoleId],
    );
    // Owner: company-wide (branch_id null) — grant every currently
    // approved permission directly (this task's own TASK 16.10B
    // `syncSystemRolePermissions()` mechanism, which auto-grants new
    // permissions to `is_system=true` roles, is already re-verified
    // separately for this exact task via a real `npm run db:seed` run
    // during implementation — this fixture grants directly for test
    // speed/determinism, not to re-prove that mechanism a second time).
    await database.pool.query(
      `insert into user_roles(id,company_id,membership_id,role_id,branch_id,status) values($1,$2,$3,$4,null,'active')`,
      [randomUUID(), companyId, ownerMembershipId, ownerRoleId],
    );
    await database.pool.query(
      `insert into role_permissions(company_id,role_id,permission_id,effect)
       select $1,$2,id,'allow' from permissions`,
      [companyId, ownerRoleId],
    );
    // Branch Manager: branch-scoped, full cash + consolidation + area
    // permissions, but NEVER `user.*`/`role.*` (never company-wide admin).
    await database.pool.query(
      `insert into user_roles(id,company_id,membership_id,role_id,branch_id,status) values($1,$2,$3,$4,$5,'active')`,
      [randomUUID(), companyId, managerMembershipId, managerRoleId, branchId],
    );
    await database.pool.query(
      `insert into role_permissions(company_id,role_id,permission_id,effect)
       select $1,$2,id,'allow' from permissions where code in
       ('cash_register.read','cash_register.manage','cash_session.read','cash_session.open','cash_movement.create',
        'cash_session.close','operational_area.read','operational_area.manage','branch_consolidation.read',
        'sale.create','sale.read','payment.create','catalog.read','branch.read')`,
      [companyId, managerRoleId],
    );
    // Cashier role (shared definition; branch/register scope differs per
    // assignment below) — no `branch_consolidation.read`, no `role.*`.
    await database.pool.query(
      `insert into user_roles(id,company_id,membership_id,role_id,branch_id,status) values
        ($1,$2,$3,$4,$5,'active'),($6,$2,$7,$4,$5,'active')`,
      [randomUUID(), companyId, admissionsCashierMembershipId, cashierRoleId, branchId, randomUUID(), foodCashierMembershipId],
    );
    await database.pool.query(
      `insert into role_permissions(company_id,role_id,permission_id,effect)
       select $1,$2,id,'allow' from permissions where code in
       ('cash_register.read','cash_session.read','cash_session.open','cash_movement.create','cash_session.close',
        'sale.create','sale.read','payment.create','catalog.read','branch.read')`,
      [companyId, cashierRoleId],
    );

    // --- Products ---
    await database.pool.query(
      `insert into products (id,company_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
       values($1,$2,'MR-ADM','mr-adm','Entrada','simple',false,'IVA_EXEMPT','active',$3,$3),
             ($4,$2,'MR-FOOD','mr-food','Snack','simple',false,'IVA_EXEMPT','active',$3,$3)`,
      [admissionsProductId, companyId, ownerUserId, foodProductId],
    );
    await database.pool.query(
      `insert into product_prices (id,company_id,product_id,amount,currency_code,status,created_by,updated_by)
       values($1,$2,$3,'500.0000','MXN','active',$4,$4),($5,$2,$6,'200.0000','MXN','active',$4,$4)`,
      [randomUUID(), companyId, admissionsProductId, ownerUserId, randomUUID(), foodProductId],
    );

    const cashRepo = new CashRepository(database);
    cashRepository = cashRepo;
    cash = new CashService(cashRepo);
    const salesRepository = new SalesRepository(database);
    sales = new SalesService(salesRepository);
    const paymentRepository = new PaymentRepository(database);
    const mercadoPagoProvider = new MercadoPagoPointProvider(
      new MercadoPagoClient({ accessToken: undefined, apiBaseUrl: 'https://api.mercadopago.com' }),
    );
    payments = new PaymentService(paymentRepository, salesRepository, mercadoPagoProvider, cashRepo);
    const areasRepository = new OperationalAreasRepository(database);
    areas = new OperationalAreasService(areasRepository);
    consolidation = new BranchConsolidationService(cashRepo, cash, areasRepository);
    authRepository = new PostgresAuthRepository(database);

    // --- Operational areas ---
    const admissionsArea = await areas.create(areaContext(new Date('2026-09-01T00:00:00.000Z')), branchIds, `area-${randomUUID()}`, {
      branchId,
      code: 'ADMISSIONS',
      name: 'Admissions',
    });
    admissionsAreaId = admissionsArea.value.id;
    const foodArea = await areas.create(areaContext(new Date('2026-09-01T00:00:01.000Z')), branchIds, `area-${randomUUID()}`, {
      branchId,
      code: 'FOOD',
      name: 'Food',
    });
    foodAreaId = foodArea.value.id;
    const eventsArea = await areas.create(areaContext(new Date('2026-09-01T00:00:02.000Z')), branchIds, `area-${randomUUID()}`, {
      branchId,
      code: 'EVENTS',
      name: 'Events',
    });
    eventsAreaId = eventsArea.value.id;

    // --- Registers ---
    const admissions1 = await cash.createRegister(cashContext(new Date('2026-09-01T00:01:00.000Z')), branchIds, `reg-${randomUUID()}`, {
      branchId,
      code: 'ADM-1',
      name: 'Admissions 1',
      operationalAreaId: admissionsAreaId,
    });
    admissions1Id = admissions1.value.id;
    const admissions2 = await cash.createRegister(cashContext(new Date('2026-09-01T00:01:01.000Z')), branchIds, `reg-${randomUUID()}`, {
      branchId,
      code: 'ADM-2',
      name: 'Admissions 2',
      operationalAreaId: admissionsAreaId,
    });
    admissions2Id = admissions2.value.id;
    const food1 = await cash.createRegister(cashContext(new Date('2026-09-01T00:01:02.000Z')), branchIds, `reg-${randomUUID()}`, {
      branchId,
      code: 'FOOD-1',
      name: 'Food 1',
      operationalAreaId: foodAreaId,
    });
    food1Id = food1.value.id;
    const events1 = await cash.createRegister(cashContext(new Date('2026-09-01T00:01:03.000Z')), branchIds, `reg-${randomUUID()}`, {
      branchId,
      code: 'EVT-1',
      name: 'Events 1',
      operationalAreaId: eventsAreaId,
    });
    events1Id = events1.value.id;

    // --- Register-scope grants (TASK 16.15 §6) ---
    // Admissions Cashier: an AREA grant — covers BOTH Admissions
    // registers (present and future), never enumerated one by one.
    await database.pool.query(
      `insert into user_register_access(id,company_id,membership_id,user_id,branch_id,operational_area_id,status)
       values($1,$2,$3,$4,$5,$6,'active')`,
      [randomUUID(), companyId, admissionsCashierMembershipId, admissionsCashierUserId, branchId, admissionsAreaId],
    );
    // Food Cashier: a direct REGISTER grant — exactly Food 1, nothing else.
    await database.pool.query(
      `insert into user_register_access(id,company_id,membership_id,user_id,branch_id,cash_register_id,status)
       values($1,$2,$3,$4,$5,$6,'active')`,
      [randomUUID(), companyId, foodCashierMembershipId, foodCashierUserId, branchId, food1Id],
    );
  });

  afterAll(async () => {
    const companyIds = [companyId, otherCompanyId];
    await database.pool.query('delete from payment_attempts where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from payments where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from sale_items where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from sales where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from cash_movements where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from cash_sessions where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from user_register_access where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from cash_registers where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from operational_areas where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from product_prices where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from products where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from role_permissions where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from user_roles where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from roles where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from idempotency_keys where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from outbox_events where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from audit_log where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from company_memberships where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from branches where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from companies where id=any($1)', [companyIds]);
    await database.pool.query('delete from users where id=any($1)', [
      [ownerUserId, managerUserId, admissionsCashierUserId, foodCashierUserId],
    ]);
    await database.close();
  });

  describe('simultaneous multi-register operation (TASK 16.15 §5)', () => {
    it('two registers in the same branch are open at once, each independently accounting its own cash', async () => {
      const admOpen = await cash.openSession(cashContext(new Date('2026-09-05T08:00:00.000Z')), branchIds, `open-${randomUUID()}`, {
        cashRegisterId: admissions1Id,
        openingAmount: '500.0000',
      });
      const foodOpen = await cash.openSession(cashContext(new Date('2026-09-05T08:00:01.000Z')), branchIds, `open-${randomUUID()}`, {
        cashRegisterId: food1Id,
        openingAmount: '300.0000',
      });
      expect(admOpen.value.status).toBe('open');
      expect(foodOpen.value.status).toBe('open');

      await cashSale(new Date('2026-09-05T09:00:00.000Z'), admissionsProductId, admissions1Id, ownerUserId);
      await cashSale(new Date('2026-09-05T09:01:00.000Z'), foodProductId, food1Id, ownerUserId);

      const admSummary = await cash.summary(companyId, branchIds, admOpen.value.id);
      const foodSummary = await cash.summary(companyId, branchIds, foodOpen.value.id);
      // Admissions' own sale never touched Food's expected cash, and
      // vice versa — proven by each register's own independent total.
      expect(admSummary.expectedCash).toBe('1000.0000'); // 500 + 500
      expect(foodSummary.expectedCash).toBe('500.0000'); // 300 + 200

      // Close both now so later describe blocks (deterministic scenario)
      // start from a clean, closed state.
      await cash.closeSession(cashContext(new Date('2026-09-05T18:00:00.000Z')), branchIds, `close-${randomUUID()}`, admOpen.value.id, {
        declaredClosingAmount: '1000.0000',
      });
      await cash.closeSession(cashContext(new Date('2026-09-05T18:00:01.000Z')), branchIds, `close-${randomUUID()}`, foodOpen.value.id, {
        declaredClosingAmount: '500.0000',
      });
    });
  });

  describe('deterministic multi-register consolidation, exact values (TASK 16.15 §37)', () => {

    // The task's own §37 example uses illustrative round numbers ("cash
    // sales 1,000", "card net 600", "System card: 800") built from a
    // hypothetical catalog this codebase doesn't have. This fixture's own
    // two $500/$200 products can't reproduce those exact figures without
    // fabricating prices, so the scenario below uses its OWN exact,
    // fully-documented values instead — chosen to keep the same shape
    // (two registers, cash + card, a cash-out, a deliberate shortage/
    // surplus that nets to zero) rather than the task's own illustrative
    // numbers verbatim. Every figure asserted below is computed from
    // real, itemized transactions, never invented.
    it('opens Admissions 1 (float 500) and Food 1 (float 300) simultaneously, records real cash+card transactions, and produces exact totals', async () => {
      const admOpen = await cash.openSession(cashContext(new Date('2026-09-10T08:00:00.000Z')), branchIds, `open-${randomUUID()}`, {
        cashRegisterId: admissions1Id,
        openingAmount: '500.0000',
      });
      const foodOpen = await cash.openSession(cashContext(new Date('2026-09-10T08:00:01.000Z')), branchIds, `open-${randomUUID()}`, {
        cashRegisterId: food1Id,
        openingAmount: '300.0000',
      });
      deterministicAdmSessionId = admOpen.value.id;
      deterministicFoodSessionId = foodOpen.value.id;

      // Admissions 1 ($500 admissions ticket + $200 food item, both sold
      // at this register): 2 cash sales = $1000 cash; 1 card sale of each
      // product = $700 card gross ($500 + $200).
      await cashSale(new Date('2026-09-10T09:00:00.000Z'), admissionsProductId, admissions1Id, admissionsCashierUserId);
      await cashSale(new Date('2026-09-10T09:01:00.000Z'), admissionsProductId, admissions1Id, admissionsCashierUserId);
      await cardSale(new Date('2026-09-10T09:02:00.000Z'), admissionsProductId, admissions1Id, admissionsCashierUserId);
      await cardSale(new Date('2026-09-10T09:03:00.000Z'), foodProductId, admissions1Id, admissionsCashierUserId);

      // Food 1 ($200 item): 2 cash sales = $400 cash; a $50 cash-out; 1
      // card sale = $200 card gross.
      await cashSale(new Date('2026-09-10T09:10:00.000Z'), foodProductId, food1Id, foodCashierUserId);
      await cashSale(new Date('2026-09-10T09:11:00.000Z'), foodProductId, food1Id, foodCashierUserId);
      await cash.createMovement(cashContext(new Date('2026-09-10T09:12:00.000Z'), foodCashierUserId), branchIds, `out-${randomUUID()}`, deterministicFoodSessionId, {
        movementType: 'cash_out',
        amount: '50.0000',
        reasonCode: 'expense',
      });
      await cardSale(new Date('2026-09-10T09:13:00.000Z'), foodProductId, food1Id, foodCashierUserId);

      const admSummary = await cash.summary(companyId, branchIds, deterministicAdmSessionId);
      const foodSummary = await cash.summary(companyId, branchIds, deterministicFoodSessionId);
      // Admissions expected: 500 (float) + 1000 (cash sales) = 1500.
      expect(admSummary.expectedCash).toBe('1500.0000');
      // Food expected: 300 (float) + 400 (cash) − 50 (cash out) = 650.
      expect(foodSummary.expectedCash).toBe('650.0000');

      const result = await consolidation.consolidate(companyId, branchIds, null, branchId, '2026-09-10');
      expect(result.totals.expectedCashTotal).toBe('2150.0000'); // 1500 + 650
      // System card: Admissions 700 (500+200) + Food 200 = 900.
      expect(result.totals.cardSystemNetTotal).toBe('900.0000');
      expect(result.totals.openRegisterCount).toBe(2);
      expect(result.totals.noSessionRegisterCount).toBe(2); // Admissions 2, Events 1

      const areaAdmissions = result.areas.find((area) => area.operationalAreaId === admissionsAreaId);
      const areaFood = result.areas.find((area) => area.operationalAreaId === foodAreaId);
      expect(areaAdmissions?.cashSalesTotal).toBe('1000.0000');
      expect(areaFood?.cashSalesTotal).toBe('400.0000');
      // Cafetería-subset-style proof, one level up: Food's own area total
      // is NOT added again into a separate "branch total" on top of the
      // per-register cash_sales_total already summed above — see the
      // "no double counting" group below for the exact arithmetic proof.
    });

    it('closes both with an intentional shortage/surplus that nets to zero — branch is NOT reported as reconciled', async () => {
      const admSummary = await cash.summary(companyId, branchIds, deterministicAdmSessionId);
      const foodSummary = await cash.summary(companyId, branchIds, deterministicFoodSessionId);
      // Admissions: declare $20 SHORT of its own expected cash.
      const admShort = (Number(admSummary.expectedCash) - 20).toFixed(4);
      // Food: declare $20 OVER its own expected cash.
      const foodOver = (Number(foodSummary.expectedCash) + 20).toFixed(4);
      await cash.closeSession(cashContext(new Date('2026-09-10T18:00:00.000Z')), branchIds, `close-${randomUUID()}`, deterministicAdmSessionId, {
        declaredClosingAmount: admShort,
        discrepancyReason: 'Prueba de faltante.',
      });
      await cash.closeSession(cashContext(new Date('2026-09-10T18:00:01.000Z')), branchIds, `close-${randomUUID()}`, deterministicFoodSessionId, {
        declaredClosingAmount: foodOver,
        discrepancyReason: 'Prueba de sobrante.',
      });

      const result = await consolidation.consolidate(companyId, branchIds, null, branchId, '2026-09-10');
      expect(result.totals.closedRegisterCount).toBe(2);
      expect(result.totals.openRegisterCount).toBe(0);
      // Branch NET difference really is $0 (−20 + 20)...
      expect(result.totals.cashDifferenceTotal).toBe('0.0000');
      // ...but the operational problem is never hidden: exactly 2
      // registers are individually flagged discrepant (§18).
      expect(result.totals.discrepantRegisterCount).toBe(2);
      const admRegister = result.registers.find((register) => register.registerId === admissions1Id);
      const foodRegister = result.registers.find((register) => register.registerId === food1Id);
      expect(admRegister?.discrepancyAmount).toBe('-20.0000');
      expect(foodRegister?.discrepancyAmount).toBe('20.0000');
    });
  });

  describe('no double counting (TASK 16.15 §15)', () => {
    it('the branch expected-cash total is exactly the arithmetic sum of each register’s own independently-verified figure, never a second parallel calculation', async () => {
      const result = await consolidation.consolidate(companyId, branchIds, null, branchId, '2026-09-10');
      const manualSum = result.registers
        .filter((register) => register.status === 'closed')
        .reduce((total, register) => total + Number(register.expectedCash ?? '0'), 0);
      expect(Number(result.totals.expectedCashTotal)).toBeCloseTo(manualSum, 4);
      // Cross-checked directly against THESE TWO sessions' own frozen
      // `expected_closing_amount` columns read straight from the DB —
      // the SAME source `consolidate()` itself reads, never a separate
      // recomputation invented for this test. Scoped to exactly these
      // two session ids (never a bare branch-wide query) because earlier
      // describe blocks in this same file closed other sessions against
      // the same branch on a different business date.
      const rows = await database.pool.query<{ expected_closing_amount: string }>(
        `select expected_closing_amount from cash_sessions where company_id=$1 and id=any($2::uuid[])`,
        [companyId, [deterministicAdmSessionId, deterministicFoodSessionId]],
      );
      const dbSum = rows.rows.reduce((total, row) => total + Number(row.expected_closing_amount), 0);
      expect(Number(result.totals.expectedCashTotal)).toBeCloseTo(dbSum, 4);
    });
  });

  describe('register scope resolution via real auth (TASK 16.15 §6/§32)', () => {
    it('resolveContext computes permittedRegisterIds correctly: null for unrestricted, a concrete area-derived set, and a concrete direct-register set', async () => {
      // `branchId` is passed explicitly below for the branch-scoped
      // actors (manager/cashiers) because `resolveContext`'s own
      // `permissions` query only ever matches a `user_roles` row where
      // `branch_id IS NULL OR branch_id = <the requested branchId>` — the
      // exact same "which branch is the caller currently working in"
      // parameter a real request's own `branch_id`/device binding
      // supplies. The company-wide Owner needs no such hint (their own
      // `user_roles.branch_id IS NULL` row matches unconditionally).
      const owner = await authRepository.resolveContext({ userId: ownerUserId, membershipId: ownerMembershipId, companyId });
      expect(owner?.permittedRegisterIds ?? null).toBeNull(); // company-wide → unrestricted.

      const manager = await authRepository.resolveContext({
        userId: managerUserId,
        membershipId: managerMembershipId,
        companyId,
        branchId,
      });
      expect(manager?.permittedRegisterIds ?? null).toBeNull(); // branch-scoped, zero user_register_access rows → unrestricted within the branch.
      expect(manager?.permittedBranchIds).toEqual([branchId]);
      expect(manager?.permissions).toContain('branch_consolidation.read');

      const admissionsCashier = await authRepository.resolveContext({
        userId: admissionsCashierUserId,
        membershipId: admissionsCashierMembershipId,
        companyId,
        branchId,
      });
      expect([...(admissionsCashier?.permittedRegisterIds ?? [])].sort()).toEqual([admissions1Id, admissions2Id].sort());
      expect(admissionsCashier?.permissions).not.toContain('branch_consolidation.read');

      const foodCashier = await authRepository.resolveContext({
        userId: foodCashierUserId,
        membershipId: foodCashierMembershipId,
        companyId,
        branchId,
      });
      expect(foodCashier?.permittedRegisterIds).toEqual([food1Id]);
    });
  });

  describe('register isolation — direct API-level tampering (TASK 16.15 §9/§30/§31)', () => {
    it('the requireRegisterAccess guard — the actual enforcement point for opening/viewing-current a register — rejects Admissions 1 for a Food-scoped actor', () => {
      // `AuthService.requireRegisterAccess` is what `POST /cash-sessions`
      // (open) and `GET /cash-sessions/current` actually call (see
      // cash.routes.ts) — exercised directly here against a real
      // resolved scope, the true enforcement point for those two routes.
      const authService = new AuthService({
        repository: authRepository,
        tokens: new AuthTokens({
          audience: 'asone-multi-register-test',
          issuer: 'https://api.test.asone.mx',
          secret: 'test-secret-that-is-at-least-32-characters',
          ttlSeconds: 300,
        }),
        dummyPasswordHash: 'x'.repeat(60),
        accessTokenTtlSeconds: 300,
        refreshTokenTtlSeconds: 3_600,
      });
      const foodScopedContext = {
        sessionId: 's',
        userId: foodCashierUserId,
        membershipId: foodCashierMembershipId,
        companyId,
        expiresAt: new Date(Date.now() + 60_000),
        permissions: [],
        permittedBranchIds: [branchId],
        permittedRegisterIds: [food1Id],
      };
      expect(() => authService.requireRegisterAccess(foodScopedContext, admissions1Id)).toThrow();
      expect(() => authService.requireRegisterAccess(foodScopedContext, food1Id)).not.toThrow();
    });

    it('a Food-scoped actor cannot view, post to, or close an Admissions session by supplying its id directly (service-level `assertRegisterScope`)', async () => {
      const foodScope = [food1Id];
      // Open a real Admissions session (as an unrestricted actor) to test
      // against, then prove the Food-scoped actor cannot read/mutate it.
      const admOpened = await cash.openSession(
        cashContext(new Date('2026-09-11T08:00:00.000Z')),
        branchIds,
        `open-${randomUUID()}`,
        { cashRegisterId: admissions1Id, openingAmount: '100.0000' },
      );
      const adm = await cash.session(companyId, branchIds, admOpened.value.id);
      await expect(cash.session(companyId, branchIds, adm.id, foodScope)).rejects.toMatchObject({ code: 'resource_not_found' });
      await expect(cash.summary(companyId, branchIds, adm.id, foodScope)).rejects.toMatchObject({ code: 'resource_not_found' });
      await expect(
        cash.createMovement(
          cashContext(new Date('2026-09-11T08:05:00.000Z'), foodCashierUserId),
          branchIds,
          `in-${randomUUID()}`,
          adm.id,
          { movementType: 'cash_in', amount: '10.0000', reasonCode: 'test' },
          foodScope,
        ),
      ).rejects.toMatchObject({ code: 'resource_not_found' });
      await expect(
        cash.closeSession(
          cashContext(new Date('2026-09-11T08:06:00.000Z'), foodCashierUserId),
          branchIds,
          `close-${randomUUID()}`,
          adm.id,
          { declaredClosingAmount: '100.0000' },
          foodScope,
        ),
      ).rejects.toMatchObject({ code: 'resource_not_found' });

      // Clean up: close the Admissions session opened for this test.
      await cash.closeSession(cashContext(new Date('2026-09-11T09:00:00.000Z')), branchIds, `close-${randomUUID()}`, adm.id, {
        declaredClosingAmount: '100.0000',
      });
    });

    it('a Food-scoped actor cannot sell against the Admissions register', async () => {
      const ctx = cashContext(new Date('2026-09-11T09:10:00.000Z'), foodCashierUserId);
      await expect(
        sales.createSale(
          ctx,
          branchIds,
          `sale-${randomUUID()}`,
          { branchId, items: [{ productId: admissionsProductId, quantity: '1' }], cashRegisterId: admissions1Id },
          [food1Id],
        ),
      ).rejects.toMatchObject({ code: 'validation_error' });
    });
  });

  describe('manager E2E (TASK 16.15 §39)', () => {
    it('sees the consolidated Test Branch view but not Second Branch or the other tenant', async () => {
      const managerBranchIds = [branchId]; // manager's own real permittedBranchIds.
      const result = await consolidation.consolidate(companyId, managerBranchIds, null, branchId, '2026-09-10');
      expect(result.registers).toHaveLength(4); // Admissions 1/2, Food 1, Events 1.
      await expect(
        consolidation.consolidate(companyId, managerBranchIds, null, otherBranchId, '2026-09-10'),
      ).rejects.toMatchObject({ code: 'resource_not_found' });
    });
  });

  describe('tenant isolation (TASK 16.15 §28)', () => {
    it('another tenant cannot resolve Test Park’s branch consolidation, registers, or areas, even with the exact ids', async () => {
      await expect(
        consolidation.consolidate(otherCompanyId, [otherCompanyBranchId], null, branchId, '2026-09-10'),
      ).rejects.toMatchObject({ code: 'resource_not_found' });
      await expect(cash.register(otherCompanyId, [otherCompanyBranchId], admissions1Id)).rejects.toMatchObject({
        code: 'resource_not_found',
      });
      await expect(areas.area(otherCompanyId, [otherCompanyBranchId], admissionsAreaId)).rejects.toMatchObject({
        code: 'resource_not_found',
      });
    });
  });

  describe('backward compatibility — "Sin área" (TASK 16.15 §35)', () => {
    it('a register created with no operational area stays fully functional and reads back as null, never a fabricated area', async () => {
      const legacy = await cash.createRegister(cashContext(new Date('2026-09-12T00:00:00.000Z')), branchIds, `reg-${randomUUID()}`, {
        branchId,
        code: 'LEGACY-1',
        name: 'Caja Legacy Sin Área',
      });
      expect(legacy.value.operationalAreaId).toBeNull();
      const opened = await cash.openSession(cashContext(new Date('2026-09-12T08:00:00.000Z')), branchIds, `open-${randomUUID()}`, {
        cashRegisterId: legacy.value.id,
        openingAmount: '0.0000',
      });
      expect(opened.value.status).toBe('open');
      const result = await consolidation.consolidate(companyId, branchIds, null, branchId, '2026-09-12');
      const legacyRegister = result.registers.find((register) => register.registerId === legacy.value.id);
      expect(legacyRegister?.operationalAreaId).toBeNull();
      const sinArea = result.areas.find((area) => area.operationalAreaId === null);
      expect(sinArea).toBeDefined();
      await cash.closeSession(cashContext(new Date('2026-09-12T18:00:00.000Z')), branchIds, `close-${randomUUID()}`, opened.value.id, {
        declaredClosingAmount: '0.0000',
      });
    });
  });
});
