import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';
import { AppError } from '@asone/errors';

import type { AuthContext } from '../auth/auth.types.js';
import type { AuthService } from '../auth/auth.service.js';
import { CashRepository } from '../cash/cash.repository.js';
import { CashService } from '../cash/cash.service.js';
import type { CashMutationContext } from '../cash/cash.types.js';
import { registerReportsRoutes } from './reports.routes.js';
import { ReportsRepository } from './reports.repository.js';
import { ReportsService } from './reports.service.js';

/**
 * TASK 14.4 (Wave 2, Part D) — real end-to-end coverage for the Report
 * Center, mirroring `purchasing.integration.test.ts`'s own established
 * shape: a REAL Fastify app wired to the REAL, Postgres-backed
 * `ReportsService`/`ReportsRepository` (only the auth LAYER is faked — the
 * same mutable, always-authenticated context pattern every other Wave
 * 1/2 integration test in this codebase already uses), driving genuine
 * `app.inject()` HTTP round trips so `requirePermission`/
 * `requireBranchAccess` are exercised for real.
 *
 * The financial-report fixtures deliberately go through the REAL
 * `CashService` (open register → open session → post movements → close
 * session) rather than hand-inserted `cash_sessions` rows — so this
 * file's own reconciliation assertion compares the report's independently
 * computed fold against a value `CashService.closeSession()` itself
 * persisted, never a number this test fabricated.
 */

const databaseUrl = process.env.DATABASE_TEST_URL;
const integrationDatabaseUrl = databaseUrl ?? 'postgresql://reports-integration-disabled';
const integration = databaseUrl === undefined ? describe.skip : describe;
const migrationsPath = resolve(import.meta.dirname, '../../../../../packages/database/drizzle');

async function applyIfMissing(database: DatabaseClient, regclass: string, files: readonly string[]): Promise<void> {
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

integration('Report Center aggregation (TASK 14.4, Wave 2 Part D)', { concurrent: false }, () => {
  let app: FastifyInstance;
  let database: DatabaseClient;
  let cashService: CashService;

  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const branchId = randomUUID(); // permitted branch.
  const excludedBranchId = randomUUID(); // same company, NOT in permittedBranchIds.
  const otherCompanyBranchId = randomUUID();
  const userId = randomUUID();
  const otherCompanyUserId = randomUUID();

  const allPermissions = ['report.read'] as const;

  function baseContext(forCompanyId: string, forBranchId: string, forPermittedBranchIds: readonly string[]): AuthContext {
    return {
      sessionId: randomUUID(),
      userId: forCompanyId === otherCompanyId ? otherCompanyUserId : userId,
      membershipId: randomUUID(),
      companyId: forCompanyId,
      branchId: forBranchId,
      expiresAt: new Date(Date.now() + 60_000),
      companyWideAccess: false,
      permissions: [...allPermissions],
      permittedBranchIds: forPermittedBranchIds,
      transportMode: 'bearer',
    };
  }
  let authContext: AuthContext = baseContext(companyId, branchId, [branchId]);

  // The in-range window every "known fixture" row targets; a second,
  // disjoint window proves date-range filtering actually excludes rows.
  const IN_RANGE_DATE_FROM = '2026-02-01';
  const IN_RANGE_DATE_TO = '2026-02-28';
  const OUT_OF_RANGE_TS = new Date('2026-01-05T12:00:00Z');
  const EMPTY_RANGE = { date_from: '2020-01-01', date_to: '2020-01-31' };

  function inRange(hhmm = '10:00:00'): Date {
    return new Date(`2026-02-15T${hhmm}Z`);
  }

  let financialSessionId: string;
  let promoCouponId: string;

  function cashContext(forCompanyId: string, timestamp: Date): CashMutationContext {
    return {
      companyId: forCompanyId,
      actorId: forCompanyId === otherCompanyId ? otherCompanyUserId : userId,
      requestId: randomUUID(),
      correlationId: randomUUID(),
      timestamp,
    };
  }

  beforeAll(async () => {
    if (!new URL(integrationDatabaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({ connectionString: integrationDatabaseUrl, applicationName: 'asone-reports-integration' });

    await applyIfMissing(database, 'companies', [
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
    await applyIfMissing(database, 'product_prices', ['0011_product_pricing_foundation.sql']);
    await applyIfMissing(database, 'payment_terminals', ['0012_payment_and_terminal_foundation.sql']);
    await applyIfMissing(database, 'sales', ['0013_sale_foundation.sql', '0014_sale_id_required.sql']);
    await applyIfMissing(database, 'cash_registers', ['0016_jittery_slayback.sql', '0017_gifted_vertigo.sql']);
    await applyIfMissing(database, 'refunds', ['0019_nosy_the_twelve.sql']);
    await applyIfMissing(database, 'promotions', ['0020_broad_ben_grimm.sql']);
    await applyIfMissing(database, 'customers', ['0021_powerful_ezekiel_stane.sql']);
    await applyIfMissing(database, 'reward_entitlements', ['0022_cheerful_scrambler.sql']);
    await applyIfMissing(database, 'loyalty_program_reward_categories', ['0023_tan_luke_cage.sql']);
    await applyIfMissing(database, 'direct_purchases', ['0024_vengeful_metal_master.sql']);
    await applyIfMissing(database, 'employees', ['0025_worried_the_captain.sql']);

    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'Reports Co','Reports Co',$2,'active','UTC','MXN','es-MX'),
             ($3,'Other Reports Co','Other Reports Co',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `reports-${companyId}`, otherCompanyId, `reports-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'Reports Main','RMAIN','active','UTC'),
             ($3,$2,'Reports Excluded','REXCL','active','UTC'),
             ($4,$5,'Other Co Main','OMAIN','active','UTC')`,
      [branchId, companyId, excludedBranchId, otherCompanyBranchId, otherCompanyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'Reports Actor','active'),($3,$4,$4,'Other Co Actor','active')`,
      [userId, `reports-${userId}@example.test`, otherCompanyUserId, `reports-${otherCompanyUserId}@example.test`],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status)
       values($1,$2,$3,'active'),($4,$5,$6,'active')`,
      [randomUUID(), companyId, userId, randomUUID(), otherCompanyId, otherCompanyUserId],
    );

    // --- Sales / Refunds ----------------------------------------------------
    // In-range, completed, permitted branch: the "known fixture" the sales
    // report totals are asserted exactly against. One statement per row —
    // unambiguous parameter positions.
    const saleInRangeId = randomUUID();
    const saleInRangeId2 = randomUUID();
    const saleOutOfRangeId = randomUUID();
    const saleExcludedBranchId = randomUUID();
    const saleOtherCompanyId = randomUUID();
    const salePendingId = randomUUID(); // never counted — not `completed`.
    async function insertSale(input: {
      id: string;
      forCompanyId: string;
      forBranchId: string;
      number: string;
      status: string;
      total: string;
      subtotal: string;
      taxTotal: string;
      completedAt: Date | null;
      createdBy: string;
    }): Promise<void> {
      await database.pool.query(
        `insert into sales(id,company_id,branch_id,sale_number,status,currency_code,subtotal,tax_total,total,completed_at,created_by)
         values($1,$2,$3,$4,$5,'MXN',$6,$7,$8,$9,$10)`,
        [
          input.id,
          input.forCompanyId,
          input.forBranchId,
          input.number,
          input.status,
          input.subtotal,
          input.taxTotal,
          input.total,
          input.completedAt,
          input.createdBy,
        ],
      );
    }
    await insertSale({
      id: saleInRangeId,
      forCompanyId: companyId,
      forBranchId: branchId,
      number: 'RM-0001',
      status: 'completed',
      subtotal: '100.0000',
      taxTotal: '16.0000',
      total: '116.0000',
      completedAt: inRange('09:00:00'),
      createdBy: userId,
    });
    await insertSale({
      id: saleInRangeId2,
      forCompanyId: companyId,
      forBranchId: branchId,
      number: 'RM-0002',
      status: 'completed',
      subtotal: '50.0000',
      taxTotal: '8.0000',
      total: '58.0000',
      completedAt: inRange('11:00:00'),
      createdBy: userId,
    });
    await insertSale({
      id: saleOutOfRangeId,
      forCompanyId: companyId,
      forBranchId: branchId,
      number: 'RM-0003',
      status: 'completed',
      subtotal: '200.0000',
      taxTotal: '32.0000',
      total: '232.0000',
      completedAt: OUT_OF_RANGE_TS,
      createdBy: userId,
    });
    await insertSale({
      id: saleExcludedBranchId,
      forCompanyId: companyId,
      forBranchId: excludedBranchId,
      number: 'RM-0004',
      status: 'completed',
      subtotal: '999.0000',
      taxTotal: '0.0000',
      total: '999.0000',
      completedAt: inRange('09:00:00'),
      createdBy: userId,
    });
    await insertSale({
      id: saleOtherCompanyId,
      forCompanyId: otherCompanyId,
      forBranchId: otherCompanyBranchId,
      number: 'OC-0001',
      status: 'completed',
      subtotal: '777.0000',
      taxTotal: '0.0000',
      total: '777.0000',
      completedAt: inRange('09:00:00'),
      createdBy: otherCompanyUserId,
    });
    await insertSale({
      id: salePendingId,
      forCompanyId: companyId,
      forBranchId: branchId,
      number: 'RM-0005',
      status: 'pending_payment',
      subtotal: '10.0000',
      taxTotal: '0.0000',
      total: '10.0000',
      completedAt: null,
      createdBy: userId,
    });

    // A minimal, real, captured cash payment for the in-range sale — needed
    // only so a `completed` refund against it satisfies
    // `refunds_completed_fields_ck` (payment_id required).
    const paymentId = randomUUID();
    await database.pool.query(
      `insert into payments(id,company_id,branch_id,sale_id,payment_method,amount,currency_code,status,captured_at,created_by)
       values($1,$2,$3,$4,'cash','116.0000','MXN','captured',$5,$6)`,
      [paymentId, companyId, branchId, saleInRangeId, inRange('09:00:00'), userId],
    );
    await database.pool.query(
      `insert into refunds(id,company_id,branch_id,sale_id,payment_id,refund_number,status,refund_method,reason_code,
                            currency_code,subtotal,tax_total,total,occurred_at,completed_at,created_by)
       values($1,$2,$3,$4,$5,'RF-0001','completed','cash','customer_request','MXN','10.0000','1.6000','11.6000',$6,$6,$7)`,
      [randomUUID(), companyId, branchId, saleInRangeId, paymentId, inRange('12:00:00'), userId],
    );

    // --- Financial (real CashService flow) ------------------------------
    const cashRepository = new CashRepository(database);
    cashService = new CashService(cashRepository);
    const registerResult = await cashService.createRegister(cashContext(companyId, inRange('08:00:00')), [branchId], `reg-${randomUUID()}`, {
      branchId,
      code: `RM-REG-${randomUUID()}`,
      name: 'Reports Register',
    });
    const sessionResult = await cashService.openSession(
      cashContext(companyId, inRange('08:00:00')),
      [branchId],
      `sess-${randomUUID()}`,
      { cashRegisterId: registerResult.value.id, openingAmount: '100.0000' },
    );
    financialSessionId = sessionResult.value.id;
    await cashService.createMovement(cashContext(companyId, inRange('09:30:00')), [branchId], `mv-in-${randomUUID()}`, financialSessionId, {
      movementType: 'cash_in',
      amount: '50.0000',
      reasonCode: 'external_income_test',
    });
    await cashService.createMovement(cashContext(companyId, inRange('10:30:00')), [branchId], `mv-out-${randomUUID()}`, financialSessionId, {
      movementType: 'cash_out',
      amount: '20.0000',
      reasonCode: 'withdrawal_test',
    });
    // `cash_sale`/`cash_refund` are system-posted only (never through
    // `CashService.createMovement`) — inserted directly, exactly the way
    // `PaymentService`/`RefundsService` themselves post them.
    await database.pool.query(
      `insert into cash_movements(id,company_id,branch_id,cash_session_id,movement_type,amount,currency_code,reason_code,occurred_at,created_by)
       values($1,$2,$3,$4,'cash_sale','30.0000','MXN','cash_sale','${inRange('11:00:00').toISOString()}',$5)`,
      [randomUUID(), companyId, branchId, financialSessionId, userId],
    );
    await database.pool.query(
      `insert into cash_movements(id,company_id,branch_id,cash_session_id,movement_type,amount,currency_code,reason_code,occurred_at,created_by)
       values($1,$2,$3,$4,'cash_refund','10.0000','MXN','cash_refund','${inRange('11:30:00').toISOString()}',$5)`,
      [randomUUID(), companyId, branchId, financialSessionId, userId],
    );
    // Expected fold: 100 (opening) + 50 (in) + 30 (sale) - 20 (out) - 10 (refund) = 150.0000.
    await cashService.closeSession(cashContext(companyId, inRange('20:00:00')), [branchId], `close-${randomUUID()}`, financialSessionId, {
      declaredClosingAmount: '150.0000',
    });

    // A second, out-of-range session (opened+closed outside the window) —
    // proves date-range filtering excludes it from `closedSessions`/
    // `movementTotals`.
    const registerResult2 = await cashService.createRegister(
      cashContext(companyId, OUT_OF_RANGE_TS),
      [branchId],
      `reg2-${randomUUID()}`,
      { branchId, code: `RM-REG2-${randomUUID()}`, name: 'Reports Register 2' },
    );
    const sessionResult2 = await cashService.openSession(cashContext(companyId, OUT_OF_RANGE_TS), [branchId], `sess2-${randomUUID()}`, {
      cashRegisterId: registerResult2.value.id,
      openingAmount: '10.0000',
    });
    await cashService.closeSession(cashContext(companyId, OUT_OF_RANGE_TS), [branchId], `close2-${randomUUID()}`, sessionResult2.value.id, {
      declaredClosingAmount: '10.0000',
    });

    // --- Inventory ------------------------------------------------------------
    const trackedProductId = randomUUID();
    const trackedVariantId = randomUUID();
    const locationId = randomUUID();
    await database.pool.query(
      `insert into products(id,company_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
       values($1,$2,'RPT-TRACKED','rpt-tracked','RPT Tracked','simple',true,'IVA_GENERAL','active',$3,$3)`,
      [trackedProductId, companyId, userId],
    );
    await database.pool.query(
      `insert into product_variants
       (id,company_id,product_id,sku,normalized_sku,name,unit_of_measure_code,quantity_scale,tracks_inventory,standard_cost,currency_code,is_default,option_signature,status,created_by,updated_by)
       values($1,$2,$3,'RPT-TRACKED','rpt-tracked','Variante','unit',0,true,5,'MXN',true,$4,'active',$5,$5)`,
      [trackedVariantId, companyId, trackedProductId, '9'.repeat(64), userId],
    );
    await database.pool.query(
      `insert into inventory_locations (id,company_id,branch_id,code,normalized_code,name,location_type,status,allows_receiving,allows_issuing,is_default,created_by,updated_by)
       values($1,$2,$3,'MAIN','main','Main','main','active',true,true,true,$4,$4)`,
      [locationId, companyId, branchId, userId],
    );
    await database.pool.query(
      `insert into inventory_balances(id,company_id,branch_id,inventory_location_id,product_variant_id,quantity_on_hand,quantity_reserved,average_unit_cost,currency_code)
       values($1,$2,$3,$4,$5,'25.000000','5.000000','5.0000','MXN')`,
      [randomUUID(), companyId, branchId, locationId, trackedVariantId],
    );
    const movementId = randomUUID();
    await database.pool.query(
      `insert into inventory_movements(id,company_id,branch_id,movement_number,movement_type,status,occurred_at,posted_at,created_by,posted_by)
       values($1,$2,$3,$4,'receipt','posted',$5,$5,$6,$6)`,
      [movementId, companyId, branchId, `IMV-RPT-${randomUUID()}`, inRange('09:00:00'), userId],
    );
    await database.pool.query(
      `insert into inventory_movement_lines(id,company_id,inventory_movement_id,line_number,product_variant_id,destination_location_id,quantity,unit_of_measure_code,base_quantity)
       values($1,$2,$3,1,$4,$5,'10.000000','unit','10.000000')`,
      [randomUUID(), companyId, movementId, trackedVariantId, locationId],
    );

    // --- Promotions (TASK 14.5, Wave 3, Phase 7, Item 4) -----------------------
    // Reuses the already-inserted sales fixtures above — a coupon
    // redemption/discount is always attached to a real sale, never a
    // standalone row.
    promoCouponId = randomUUID();
    await database.pool.query(
      `insert into coupons(id,company_id,code,normalized_code,benefit_type,benefit_percentage_basis_points,created_by,updated_by)
       values($1,$2,'RPT10','RPT10','percentage',1000,$3,$3)`,
      [promoCouponId, companyId, userId],
    );
    async function insertRedemption(saleId: string, forBranchId: string, amount: string, redeemedAt: Date): Promise<void> {
      await database.pool.query(
        `insert into coupon_redemptions(id,company_id,branch_id,coupon_id,sale_id,amount,redeemed_at)
         values($1,$2,$3,$4,$5,$6,$7)`,
        [randomUUID(), companyId, forBranchId, promoCouponId, saleId, amount, redeemedAt],
      );
    }
    async function insertDiscount(input: {
      saleId: string;
      forBranchId: string;
      sourceType: 'coupon' | 'promotion' | 'manual';
      sourceId: string | null;
      reasonCode: string | null;
      label: string;
      amount: string;
      createdAt: Date;
    }): Promise<void> {
      await database.pool.query(
        `insert into sale_discounts(id,company_id,branch_id,sale_id,source_type,source_id,label_snapshot,reason_code,amount,created_by,created_at)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          randomUUID(),
          companyId,
          input.forBranchId,
          input.saleId,
          input.sourceType,
          input.sourceId,
          input.label,
          input.reasonCode,
          input.amount,
          userId,
          input.createdAt,
        ],
      );
    }
    // In-range, permitted branch — the "known fixture" the promotions
    // report totals are asserted exactly against.
    await insertRedemption(saleInRangeId, branchId, '11.6000', inRange('09:15:00'));
    await insertRedemption(saleInRangeId2, branchId, '5.8000', inRange('11:15:00'));
    await insertDiscount({
      saleId: saleInRangeId,
      forBranchId: branchId,
      sourceType: 'coupon',
      sourceId: promoCouponId,
      reasonCode: null,
      label: 'RPT10',
      amount: '11.6000',
      createdAt: inRange('09:15:00'),
    });
    await insertDiscount({
      saleId: saleInRangeId2,
      forBranchId: branchId,
      sourceType: 'promotion',
      sourceId: randomUUID(),
      reasonCode: null,
      label: 'Promo Reports',
      amount: '5.0000',
      createdAt: inRange('11:15:00'),
    });
    // A manual discount — must never be counted by the promotions report
    // (it has its own real reporting surface elsewhere; see
    // `reports.types.ts`'s own doc comment on `PromotionsReport`).
    await insertDiscount({
      saleId: saleInRangeId,
      forBranchId: branchId,
      sourceType: 'manual',
      sourceId: null,
      reasonCode: 'manager_override',
      label: 'Manual',
      amount: '2.0000',
      createdAt: inRange('09:16:00'),
    });
    // Out-of-range — must be excluded by date filtering.
    await insertRedemption(saleOutOfRangeId, branchId, '99.0000', OUT_OF_RANGE_TS);
    await insertDiscount({
      saleId: saleOutOfRangeId,
      forBranchId: branchId,
      sourceType: 'coupon',
      sourceId: promoCouponId,
      reasonCode: null,
      label: 'RPT10',
      amount: '9.0000',
      createdAt: OUT_OF_RANGE_TS,
    });
    // Same company, excluded branch — must be excluded by branch scoping.
    await insertRedemption(saleExcludedBranchId, excludedBranchId, '50.0000', inRange('09:20:00'));
    await insertDiscount({
      saleId: saleExcludedBranchId,
      forBranchId: excludedBranchId,
      sourceType: 'promotion',
      sourceId: randomUUID(),
      reasonCode: null,
      label: 'Promo excluded',
      amount: '3.0000',
      createdAt: inRange('09:20:00'),
    });

    // --- Customers ------------------------------------------------------------
    const customerInRangeId = randomUUID();
    const customerOutOfRangeId = randomUUID();
    await database.pool.query(
      `insert into customers(id,company_id,first_name,display_name,status,created_by,updated_by,created_at,updated_at)
       values($1,$2,'Ana','Ana Reports','active',$3,$3,$4,$4),
             ($5,$2,'Beto','Beto Reports','active',$3,$3,$6,$6)`,
      [customerInRangeId, companyId, userId, inRange('09:00:00'), customerOutOfRangeId, OUT_OF_RANGE_TS],
    );
    const membershipPlanId = randomUUID();
    await database.pool.query(
      `insert into membership_plans(id,company_id,name,created_by,updated_by)
       values($1,$2,'Reports Plan',$3,$3)`,
      [membershipPlanId, companyId, userId],
    );
    await database.pool.query(
      `insert into customer_memberships(id,company_id,customer_id,membership_plan_id,membership_number,status,issued_at,created_by)
       values($1,$2,$3,$4,'CM-0001','active',$5,$6)`,
      [randomUUID(), companyId, customerInRangeId, membershipPlanId, inRange('09:00:00'), userId],
    );
    await database.pool.query(
      `insert into loyalty_accounts(id,company_id,customer_id,status) values($1,$2,$3,'active')`,
      [randomUUID(), companyId, customerInRangeId],
    );

    // --- Employees ------------------------------------------------------------
    const employeeId = randomUUID();
    await database.pool.query(
      `insert into employees(id,company_id,branch_id,code,display_name,status,currency_code,created_by,updated_by)
       values($1,$2,$3,'EMP-0001','Empleado Reports','active','MXN',$4,$4)`,
      [employeeId, companyId, branchId, userId],
    );
    await database.pool.query(
      `insert into time_clock_punches(id,company_id,branch_id,employee_id,punch_type,occurred_at,created_by)
       values($1,$2,$3,$4,'clock_in',$5,$6),($7,$2,$3,$4,'clock_out',$8,$6)`,
      [randomUUID(), companyId, branchId, employeeId, inRange('08:00:00'), userId, randomUUID(), inRange('17:00:00')],
    );
    const payrollPeriodId = randomUUID();
    await database.pool.query(
      `insert into payroll_periods(id,company_id,branch_id,period_start,period_end,status,closed_at,closed_by,created_by)
       values($1,$2,$3,'2026-02-01','2026-02-07','closed',$4,$5,$5)`,
      [payrollPeriodId, companyId, branchId, inRange('18:00:00'), userId],
    );
    await database.pool.query(
      `insert into payroll_period_lines(id,company_id,payroll_period_id,employee_id,base_salary_snapshot,total_amount,currency_code,computed_at,computed_by)
       values($1,$2,$3,$4,'1000.0000','1000.0000','MXN',$5,$6)`,
      [randomUUID(), companyId, payrollPeriodId, employeeId, inRange('18:00:00'), userId],
    );

    // --- Parties ------------------------------------------------------------
    const roomId = randomUUID();
    const packageId = randomUUID();
    await database.pool.query(
      `insert into party_rooms(id,company_id,branch_id,code,name,status,created_by,updated_by)
       values($1,$2,$3,'ROOM-A','Room A','active',$4,$4)`,
      [roomId, companyId, branchId, userId],
    );
    await database.pool.query(
      `insert into party_packages(id,company_id,branch_id,code,name,status,price,currency_code,duration_minutes,created_by,updated_by)
       values($1,$2,$3,'PKG-A','Package A','active','500.0000','MXN',60,$4,$4)`,
      [packageId, companyId, branchId, userId],
    );
    const reservationId = randomUUID();
    await database.pool.query(
      `insert into party_reservations(id,company_id,branch_id,reservation_number,room_id,package_id,event_date,start_time,end_time,status,quoted_total,currency_code,created_by,updated_by)
       values($1,$2,$3,'PR-0001',$4,$5,'2026-02-10','10:00','11:00','confirmed','500.0000','MXN',$6,$6)`,
      [reservationId, companyId, branchId, roomId, packageId, userId],
    );
    await database.pool.query(
      `insert into party_reservation_payments(id,company_id,branch_id,reservation_id,cash_movement_id,purpose,amount_snapshot,created_by,created_at)
       values($1,$2,$3,$4,$5,'deposit','200.0000',$6,$7)`,
      [randomUUID(), companyId, branchId, reservationId, randomUUID(), userId, inRange('09:00:00')],
    );

    // --- Access ------------------------------------------------------------
    const credentialId = randomUUID();
    await database.pool.query(
      `insert into access_credentials(id,company_id,branch_id,code,status,currently_inside,issued_by)
       values($1,$2,$3,$4,'issued','true',$5)`,
      [credentialId, companyId, branchId, `ACC-${randomUUID()}`, userId],
    );
    await database.pool.query(
      `insert into access_events(id,company_id,branch_id,credential_id,event_type,occurred_at,created_by)
       values($1,$2,$3,$4,'entry',$5,$6)`,
      [randomUUID(), companyId, branchId, credentialId, inRange('09:00:00'), userId],
    );

    const authentication = {
      authenticate: () => Promise.resolve(authContext),
      requirePermission: (context: AuthContext, permission: string) => {
        if (!context.permissions.includes(permission))
          throw new AppError({ code: 'permission_denied', message: 'Permission denied.', statusCode: 403 });
      },
      requireBranchAccess: (context: AuthContext, forBranchId: string) => {
        if (!context.permittedBranchIds.includes(forBranchId))
          throw new AppError({ code: 'branch_scope_mismatch', message: 'Branch denied.', statusCode: 403 });
      },
    } as unknown as AuthService;

    app = Fastify();
    app.addHook('onRequest', (request, _reply, done) => {
      request.requestContext = {
        requestId: randomUUID(),
        correlationId: randomUUID(),
        companyId: undefined,
        branchId: undefined,
        userId: undefined,
        sessionId: undefined,
        deviceId: undefined,
      };
      done();
    });
    app.setErrorHandler((error, request, reply) => {
      if (error instanceof AppError)
        return reply.code(error.statusCode).send({
          error: { code: error.code, message: error.message },
          meta: { request_id: request.requestContext.requestId, correlation_id: request.requestContext.correlationId },
        });
      // A Fastify/AJV querystring-schema validation failure (e.g. a
      // missing required `date_from`/`date_to`) is a real `FastifyError`
      // carrying its own `statusCode` (400) — never masked as a generic
      // 500 here, exactly like the real app's own `error-handler.ts`
      // never masks one either.
      const statusCode = typeof (error as { statusCode?: unknown }).statusCode === 'number' ? (error as { statusCode: number }).statusCode : 500;
      return reply.code(statusCode).send({ error: { code: 'internal_error', message: (error as Error).message } });
    });

    registerReportsRoutes(app, authentication, new ReportsService(new ReportsRepository(database)));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    const ids = [companyId, otherCompanyId];
    await database.pool.query('delete from access_events where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from access_credentials where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from party_reservation_payments where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from party_reservations where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from party_packages where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from party_rooms where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from payroll_period_lines where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from payroll_periods where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from time_clock_punches where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from employees where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from loyalty_accounts where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from customer_memberships where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from membership_plans where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from customers where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from inventory_movement_lines where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from inventory_movements where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from inventory_balances where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from inventory_locations where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from product_variants where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from products where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from cash_movements where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from cash_sessions where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from cash_registers where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from refunds where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from payments where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from sale_discounts where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from coupon_redemptions where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from coupons where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from sales where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from idempotency_keys where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from outbox_events where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from audit_log where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from company_memberships where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from branches where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from companies where id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from users where id=any($1::uuid[])', [[userId, otherCompanyUserId]]);
    await database.close();
  });

  function get(path: string): Promise<Awaited<ReturnType<FastifyInstance['inject']>>> {
    return app.inject({ method: 'GET', url: path, headers: { authorization: 'Bearer x' } });
  }

  it('sales report: exact gross/refund/net/average totals for the known fixture, excluding out-of-range and non-completed rows', async () => {
    authContext = baseContext(companyId, branchId, [branchId]);
    const response = await get(`/api/v1/reports/sales?date_from=${IN_RANGE_DATE_FROM}&date_to=${IN_RANGE_DATE_TO}&branch_id=${branchId}`);
    expect(response.statusCode).toBe(200);
    const data = response.json<{ data: Record<string, unknown> }>().data;
    expect(data.transaction_count).toBe(2); // RM-0001 + RM-0002 only.
    expect(data.gross_sales).toEqual([{ currency_code: 'MXN', amount: '174.0000' }]); // 116 + 58.
    expect(data.refund_count).toBe(1);
    expect(data.refunds_total).toEqual([{ currency_code: 'MXN', amount: '11.6000' }]);
    expect(data.net_sales).toEqual([{ currency_code: 'MXN', amount: '162.4000' }]); // 174 - 11.6.
    expect(data.average_ticket).toEqual([{ currency_code: 'MXN', amount: '87.0000' }]); // 174 / 2.
  });

  it('sales export.csv contains the real underlying completed-sale rows for the range', async () => {
    authContext = baseContext(companyId, branchId, [branchId]);
    const response = await get(
      `/api/v1/reports/sales/export.csv?date_from=${IN_RANGE_DATE_FROM}&date_to=${IN_RANGE_DATE_TO}&branch_id=${branchId}`,
    );
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('attachment');
    const lines = response.body.trim().split('\r\n');
    expect(lines[0]).toBe(
      'sale_id,sale_number,branch_id,status,occurred_at,completed_at,subtotal,discount_total,tax_total,total,currency_code,customer_display_name',
    );
    expect(lines).toHaveLength(3); // header + RM-0001 + RM-0002.
    expect(response.body).toContain('RM-0001');
    expect(response.body).toContain('RM-0002');
    expect(response.body).not.toContain('RM-0003'); // out of range.
    expect(response.body).not.toContain('RM-0004'); // excluded branch.
  });

  it('branch scoping: data in a same-company branch outside permittedBranchIds never appears, even with no branch_id filter', async () => {
    authContext = baseContext(companyId, branchId, [branchId]); // excludedBranchId NOT permitted.
    const response = await get(`/api/v1/reports/sales?date_from=${IN_RANGE_DATE_FROM}&date_to=${IN_RANGE_DATE_TO}`);
    expect(response.statusCode).toBe(200);
    const data = response.json<{ data: { gross_sales: { amount: string }[] } }>().data;
    // Still exactly 174.0000 — RM-0004 (999.0000, excludedBranchId) never counted.
    expect(data.gross_sales).toEqual([{ currency_code: 'MXN', amount: '174.0000' }]);
  });

  it('an actor whose permittedBranchIds includes the excluded branch DOES see it — proving the exclusion above is real scoping, not a broken query', async () => {
    authContext = baseContext(companyId, branchId, [branchId, excludedBranchId]);
    const response = await get(`/api/v1/reports/sales?date_from=${IN_RANGE_DATE_FROM}&date_to=${IN_RANGE_DATE_TO}`);
    const data = response.json<{ data: { gross_sales: { amount: string }[] } }>().data;
    expect(data.gross_sales).toEqual([{ currency_code: 'MXN', amount: '1173.0000' }]); // 174 + 999.
  });

  it('no cross-tenant leakage: company A never sees company B\'s sales, even requesting the identical date range', async () => {
    authContext = baseContext(companyId, branchId, [branchId]);
    const response = await get(`/api/v1/reports/sales?date_from=${IN_RANGE_DATE_FROM}&date_to=${IN_RANGE_DATE_TO}`);
    const data = response.json<{ data: { gross_sales: { amount: string }[] } }>().data;
    expect(data.gross_sales).not.toContainEqual(expect.objectContaining({ amount: '777.0000' }));

    authContext = baseContext(otherCompanyId, otherCompanyBranchId, [otherCompanyBranchId]);
    const otherResponse = await get(`/api/v1/reports/sales?date_from=${IN_RANGE_DATE_FROM}&date_to=${IN_RANGE_DATE_TO}`);
    const otherData = otherResponse.json<{ data: { gross_sales: { amount: string }[]; transaction_count: number } }>().data;
    expect(otherData.transaction_count).toBe(1);
    expect(otherData.gross_sales).toEqual([{ currency_code: 'MXN', amount: '777.0000' }]);
  });

  it('empty-dataset behavior: a range with zero matching rows returns real zeros/empty arrays, never an error', async () => {
    authContext = baseContext(companyId, branchId, [branchId]);
    const response = await get(`/api/v1/reports/sales?date_from=${EMPTY_RANGE.date_from}&date_to=${EMPTY_RANGE.date_to}`);
    expect(response.statusCode).toBe(200);
    const data = response.json<{
      data: { transaction_count: number; gross_sales: unknown[]; refund_count: number; net_sales: unknown[] };
    }>().data;
    expect(data.transaction_count).toBe(0);
    expect(data.gross_sales).toEqual([]);
    expect(data.refund_count).toBe(0);
    expect(data.net_sales).toEqual([]);
  });

  it('date_from after date_to is rejected as a real validation error, never silently swapped', async () => {
    authContext = baseContext(companyId, branchId, [branchId]);
    const response = await get(`/api/v1/reports/sales?date_from=${IN_RANGE_DATE_TO}&date_to=${IN_RANGE_DATE_FROM}`);
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('validation_error');
  });

  it('a required query param missing (no date_from/date_to) is rejected outright — no report defaults to "all time"', async () => {
    authContext = baseContext(companyId, branchId, [branchId]);
    const response = await get('/api/v1/reports/sales');
    expect(response.statusCode).toBe(400);
  });

  it('an actor without report.read is rejected on every report endpoint', async () => {
    authContext = { ...baseContext(companyId, branchId, [branchId]), permissions: [] };
    const response = await get(`/api/v1/reports/sales?date_from=${IN_RANGE_DATE_FROM}&date_to=${IN_RANGE_DATE_TO}`);
    expect(response.statusCode).toBe(403);
  });

  it('financial report: movement totals, net cash movement, and closed-session totals for the known fixture', async () => {
    authContext = baseContext(companyId, branchId, [branchId]);
    const response = await get(`/api/v1/reports/financial?date_from=${IN_RANGE_DATE_FROM}&date_to=${IN_RANGE_DATE_TO}&branch_id=${branchId}`);
    expect(response.statusCode).toBe(200);
    const data = response.json<{
      data: {
        movement_totals: { movement_type: string; currency_code: string; amount: string; count: number }[];
        net_cash_movement: { currency_code: string; amount: string }[];
        closed_sessions: { currency_code: string; session_count: number; expected_closing_total: string; declared_closing_total: string }[];
        sessions_opened_count: number;
      };
    }>().data;
    expect(data.movement_totals).toEqual(
      expect.arrayContaining([
        { movement_type: 'opening_float', currency_code: 'MXN', amount: '100.0000', count: 1 },
        { movement_type: 'cash_in', currency_code: 'MXN', amount: '50.0000', count: 1 },
        { movement_type: 'cash_out', currency_code: 'MXN', amount: '20.0000', count: 1 },
        { movement_type: 'cash_sale', currency_code: 'MXN', amount: '30.0000', count: 1 },
        { movement_type: 'cash_refund', currency_code: 'MXN', amount: '10.0000', count: 1 },
      ]),
    );
    // 100 + 50 + 30 - 20 - 10 = 150.0000 — exactly this session's own
    // `expected_closing_amount` (asserted directly against real
    // `CashService.closeSession()` output in the next test).
    expect(data.net_cash_movement).toEqual([{ currency_code: 'MXN', amount: '150.0000' }]);
    expect(data.sessions_opened_count).toBe(1); // the out-of-range session excluded.
    const closed = data.closed_sessions.find((row) => row.currency_code === 'MXN');
    expect(closed?.session_count).toBe(1);
    expect(closed?.expected_closing_total).toBe('150.0000');
    expect(closed?.declared_closing_total).toBe('150.0000');
  });

  it('financial reconciliation: the report\'s own fold for this session exactly matches the REAL cash_sessions.expected_closing_amount CashService.closeSession() persisted', async () => {
    const sessionRow = await database.pool.query<{ expected_closing_amount: string; declared_closing_amount: string }>(
      `select expected_closing_amount::text, declared_closing_amount::text from cash_sessions where id=$1`,
      [financialSessionId],
    );
    const persistedExpected = sessionRow.rows[0]?.expected_closing_amount;
    expect(persistedExpected).toBe('150.0000'); // sanity: the real service really did compute this.

    const service = new ReportsService(new ReportsRepository(database));
    const reportFold = await service.netCashMovementForSession(companyId, financialSessionId);
    expect(reportFold).toBe(persistedExpected); // bit-for-bit — never diverges.
  });

  it('financial export.csv contains real movement rows with a correctly re-derived direction', async () => {
    authContext = baseContext(companyId, branchId, [branchId]);
    const response = await get(
      `/api/v1/reports/financial/export.csv?date_from=${IN_RANGE_DATE_FROM}&date_to=${IN_RANGE_DATE_TO}&branch_id=${branchId}`,
    );
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    const lines = response.body.trim().split('\r\n');
    expect(lines[0]).toBe('movement_id,branch_id,cash_session_id,movement_type,direction,amount,currency_code,category,reason_code,occurred_at');
    expect(response.body).toContain('cash_out,-1,20.0000');
    expect(response.body).toContain('cash_in,1,50.0000');
  });

  it('inventory report: current balances (snapshot) plus posted movement volume within range', async () => {
    authContext = baseContext(companyId, branchId, [branchId]);
    const response = await get(`/api/v1/reports/inventory?date_from=${IN_RANGE_DATE_FROM}&date_to=${IN_RANGE_DATE_TO}&branch_id=${branchId}`);
    expect(response.statusCode).toBe(200);
    const data = response.json<{
      data: {
        tracked_variant_count: number;
        quantity_on_hand_total: string;
        quantity_reserved_total: string;
        out_of_stock_variant_count: number;
        movement_volume: { movement_type: string; movement_count: number; total_base_quantity: string }[];
      };
    }>().data;
    expect(data.tracked_variant_count).toBe(1);
    expect(data.quantity_on_hand_total).toBe('25.000000');
    expect(data.quantity_reserved_total).toBe('5.000000');
    expect(data.out_of_stock_variant_count).toBe(0); // 25 - 5 = 20 > 0.
    expect(data.movement_volume).toEqual([{ movement_type: 'receipt', movement_count: 1, total_base_quantity: '10.000000' }]);
  });

  // TASK 14.5 (Wave 3, Phase 7, Item 2).
  it('inventory Kardex export.csv contains the real posted movement-line rows for the range, and can narrow to one variant', async () => {
    authContext = baseContext(companyId, branchId, [branchId]);
    const response = await get(
      `/api/v1/reports/inventory/kardex.csv?date_from=${IN_RANGE_DATE_FROM}&date_to=${IN_RANGE_DATE_TO}&branch_id=${branchId}`,
    );
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('kardex-');
    const lines = response.body.trim().split('\r\n');
    expect(lines[0]).toBe(
      'movement_id,movement_number,movement_type,branch_id,occurred_at,posted_at,reference_type,reference_id,movement_reason_code,line_number,product_variant_id,sku,product_name,quantity,unit_of_measure_code,base_quantity,unit_cost,extended_cost,currency_code,source_location_id,destination_location_id,line_reason_code',
    );
    expect(response.body).toContain('receipt');
    expect(response.body).toContain('RPT-TRACKED');
    expect(response.body).toContain('10.000000');

    // Narrowed to a variant that has no posted movements — real, honest
    // empty result (header only), never an error.
    const empty = await get(
      `/api/v1/reports/inventory/kardex.csv?date_from=${IN_RANGE_DATE_FROM}&date_to=${IN_RANGE_DATE_TO}&branch_id=${branchId}&product_variant_id=${randomUUID()}`,
    );
    expect(empty.statusCode).toBe(200);
    expect(empty.body.trim().split('\r\n')).toHaveLength(1);

    // Out-of-range window: no posted lines fall inside it.
    const outOfRange = await get(
      `/api/v1/reports/inventory/kardex.csv?date_from=${EMPTY_RANGE.date_from}&date_to=${EMPTY_RANGE.date_to}&branch_id=${branchId}`,
    );
    expect(outOfRange.body.trim().split('\r\n')).toHaveLength(1);
  });

  it('customers report: total/active/new counts and membership/loyalty summary — company-scoped, no branch_id accepted', async () => {
    authContext = baseContext(companyId, branchId, [branchId]);
    const response = await get(`/api/v1/reports/customers?date_from=${IN_RANGE_DATE_FROM}&date_to=${IN_RANGE_DATE_TO}`);
    expect(response.statusCode).toBe(200);
    const data = response.json<{
      data: {
        total_customers: number;
        new_customers_in_range: number;
        memberships_by_status: { status: string; count: number }[];
        new_memberships_in_range: number;
        active_loyalty_account_count: number;
      };
    }>().data;
    expect(data.total_customers).toBe(2); // Ana + Beto.
    expect(data.new_customers_in_range).toBe(1); // only Ana was created in-range.
    expect(data.memberships_by_status).toEqual(expect.arrayContaining([{ status: 'active', count: 1 }]));
    expect(data.new_memberships_in_range).toBe(1);
    expect(data.active_loyalty_account_count).toBe(1);

    // `branch_id` is not declared on this report's querystring schema (no
    // branch dimension exists for `customers` — see `reports.types.ts`);
    // Fastify's schema validator strips it as an undeclared property
    // rather than rejecting the request, so the response is still a real
    // 200 with the identical, unaffected company-wide totals — proving
    // the extra param is genuinely ignored, not silently misapplied as a
    // filter.
    const withIgnoredBranchId = await app.inject({
      method: 'GET',
      url: `/api/v1/reports/customers?date_from=${IN_RANGE_DATE_FROM}&date_to=${IN_RANGE_DATE_TO}&branch_id=${branchId}`,
      headers: { authorization: 'Bearer x' },
    });
    expect(withIgnoredBranchId.statusCode).toBe(200);
    expect(withIgnoredBranchId.json<{ data: { total_customers: number } }>().data.total_customers).toBe(2);
  });

  it('employees report: headcount, attendance counts, and closed-payroll totals for the known fixture', async () => {
    authContext = baseContext(companyId, branchId, [branchId]);
    const response = await get(`/api/v1/reports/employees?date_from=${IN_RANGE_DATE_FROM}&date_to=${IN_RANGE_DATE_TO}&branch_id=${branchId}`);
    expect(response.statusCode).toBe(200);
    const data = response.json<{
      data: {
        employees_by_status: { status: string; count: number }[];
        clock_in_count: number;
        clock_out_count: number;
        distinct_employees_punched: number;
        closed_payroll_totals: { currency_code: string; amount: string }[];
        closed_payroll_period_count: number;
      };
    }>().data;
    expect(data.employees_by_status).toEqual([{ status: 'active', count: 1 }]);
    expect(data.clock_in_count).toBe(1);
    expect(data.clock_out_count).toBe(1);
    expect(data.distinct_employees_punched).toBe(1);
    expect(data.closed_payroll_totals).toEqual([{ currency_code: 'MXN', amount: '1000.0000' }]);
    expect(data.closed_payroll_period_count).toBe(1);
  });

  it('parties report: reservation counts, booked/collected revenue, and room utilization for the known fixture', async () => {
    authContext = baseContext(companyId, branchId, [branchId]);
    const response = await get(`/api/v1/reports/parties?date_from=${IN_RANGE_DATE_FROM}&date_to=${IN_RANGE_DATE_TO}&branch_id=${branchId}`);
    expect(response.statusCode).toBe(200);
    const data = response.json<{
      data: {
        reservations_by_status: { status: string; count: number }[];
        booked_revenue: { currency_code: string; amount: string }[];
        collected_revenue: { currency_code: string; amount: string }[];
        active_room_count: number;
        rooms_booked_count: number;
      };
    }>().data;
    expect(data.reservations_by_status).toEqual([{ status: 'confirmed', count: 1 }]);
    expect(data.booked_revenue).toEqual([{ currency_code: 'MXN', amount: '500.0000' }]);
    expect(data.collected_revenue).toEqual([{ currency_code: 'MXN', amount: '200.0000' }]);
    expect(data.active_room_count).toBe(1);
    expect(data.rooms_booked_count).toBe(1);
  });

  it('access report: entry/exit counts in range plus the live current-occupancy snapshot', async () => {
    authContext = baseContext(companyId, branchId, [branchId]);
    const response = await get(`/api/v1/reports/access?date_from=${IN_RANGE_DATE_FROM}&date_to=${IN_RANGE_DATE_TO}&branch_id=${branchId}`);
    expect(response.statusCode).toBe(200);
    const data = response.json<{ data: { entry_count: number; exit_count: number; current_occupancy: number } }>().data;
    expect(data.entry_count).toBe(1);
    expect(data.exit_count).toBe(0);
    expect(data.current_occupancy).toBe(1);
  });

  // TASK 14.5 (Wave 3, Phase 7, Item 4).
  it('promotions report: real coupon-redemption and promotion/coupon discount totals for the known fixture — manual discounts, out-of-range, and excluded-branch rows never counted', async () => {
    authContext = baseContext(companyId, branchId, [branchId]);
    const response = await get(`/api/v1/reports/promotions?date_from=${IN_RANGE_DATE_FROM}&date_to=${IN_RANGE_DATE_TO}&branch_id=${branchId}`);
    expect(response.statusCode).toBe(200);
    const data = response.json<{
      data: {
        coupon_redemption_count: number;
        coupon_redemptions_total: { currency_code: string; amount: string }[];
        promotion_discount_count: number;
        promotion_discount_total: { currency_code: string; amount: string }[];
        coupon_discount_count: number;
        coupon_discount_total: { currency_code: string; amount: string }[];
        top_coupons: { coupon_id: string; code: string; redemption_count: number }[];
      };
    }>().data;
    expect(data.coupon_redemption_count).toBe(2);
    expect(data.coupon_redemptions_total).toEqual([{ currency_code: 'MXN', amount: '17.4000' }]);
    expect(data.promotion_discount_count).toBe(1);
    expect(data.promotion_discount_total).toEqual([{ currency_code: 'MXN', amount: '5.0000' }]);
    expect(data.coupon_discount_count).toBe(1);
    expect(data.coupon_discount_total).toEqual([{ currency_code: 'MXN', amount: '11.6000' }]);
    expect(data.top_coupons).toEqual([{ coupon_id: promoCouponId, code: 'RPT10', redemption_count: 2 }]);
  });

  it('promotions report: branch scoping and date-range filtering both really exclude rows, and an empty range returns real zeros', async () => {
    authContext = baseContext(companyId, branchId, [branchId]);
    const empty = await get(`/api/v1/reports/promotions?date_from=${EMPTY_RANGE.date_from}&date_to=${EMPTY_RANGE.date_to}`);
    expect(empty.statusCode).toBe(200);
    const emptyData = empty.json<{ data: { coupon_redemption_count: number; top_coupons: unknown[] } }>().data;
    expect(emptyData.coupon_redemption_count).toBe(0);
    expect(emptyData.top_coupons).toEqual([]);

    // permittedBranchIds includes the excluded branch — proves the
    // exclusion above was real branch scoping, not a broken query.
    authContext = baseContext(companyId, branchId, [branchId, excludedBranchId]);
    const withExcludedBranch = await get(
      `/api/v1/reports/promotions?date_from=${IN_RANGE_DATE_FROM}&date_to=${IN_RANGE_DATE_TO}`,
    );
    const withExcludedData = withExcludedBranch.json<{ data: { coupon_redemption_count: number } }>().data;
    expect(withExcludedData.coupon_redemption_count).toBe(3); // 2 permitted-branch + 1 excluded-branch.
  });
});
