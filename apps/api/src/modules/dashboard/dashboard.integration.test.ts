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
import { PartiesRepository } from '../parties/parties.repository.js';
import { PartyReservationsService } from '../parties/party-reservations.service.js';
import { PartyRoomsService } from '../parties/party-rooms.service.js';
import { ReportsRepository } from '../reports/reports.repository.js';
import { ReportsService } from '../reports/reports.service.js';
import { registerDashboardRoutes } from './dashboard.routes.js';
import { DashboardRepository } from './dashboard.repository.js';
import { DashboardService } from './dashboard.service.js';

/**
 * TASK 14.5 (Wave 3, Phase 2) — real end-to-end coverage for the Dashboard
 * summary endpoint, mirroring `reports.integration.test.ts`'s own
 * established shape exactly: a REAL Fastify app wired to REAL, Postgres-
 * backed service instances (only the auth LAYER is faked — the same
 * mutable, always-authenticated context pattern every Wave 1/2 integration
 * test in this codebase already uses), driving genuine `app.inject()` HTTP
 * round trips so `requirePermission`/`requireBranchAccess` are exercised
 * for real.
 */

const databaseUrl = process.env.DATABASE_TEST_URL;
const integrationDatabaseUrl = databaseUrl ?? 'postgresql://dashboard-integration-disabled';
const integration = databaseUrl === undefined ? describe.skip : describe;
const migrationsPath = resolve(import.meta.dirname, '../../../../../packages/database/drizzle');

async function applyIfMissing(database: DatabaseClient, regclass: string, files: readonly string[]): Promise<void> {
  const check = await database.pool.query<{ present: string | null }>(`select to_regclass('public.${regclass}')::text present`);
  if (check.rows[0]?.present !== null) return;
  for (const file of files) {
    const sql = await readFile(resolve(migrationsPath, file), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) if (statement.trim().length > 0) await database.pool.query(statement);
  }
}

integration('Dashboard summary aggregation (TASK 14.5, Wave 3, Phase 2)', { concurrent: false }, () => {
  let app: FastifyInstance;
  let database: DatabaseClient;

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

  // The single day every "known fixture" targets, plus a disjoint day
  // proving date-scoping is real (for the metrics that ARE date-scoped —
  // sales/parties/attendance — as opposed to occupancy/inventory, which
  // are live present-moment snapshots by design, and outstanding party
  // balances, which is a standing company-wide figure by design).
  const TARGET_DATE = '2026-03-10';
  const OTHER_DATE = '2026-03-01';
  const EMPTY_DATE = '2020-01-01';
  // TASK 14.5A — dedicated dates for the sales-trend fixture, deliberately
  // disjoint from every date above so the new assertions can never
  // interfere with the pre-existing "known fixture" totals.
  const TREND_YESTERDAY_DATE = '2026-07-14';
  const TREND_TODAY_DATE = '2026-07-15'; // TREND_YESTERDAY_DATE + 1 day.
  const TREND_NO_YDATA_DATE = '2026-07-20'; // its own "yesterday" (07-19) has zero sales.

  function onTarget(hhmm = '10:00:00'): Date {
    return new Date(`${TARGET_DATE}T${hhmm}Z`);
  }
  function onOther(hhmm = '10:00:00'): Date {
    return new Date(`${OTHER_DATE}T${hhmm}Z`);
  }

  let cashRegisterId: string;
  let reservationTodayId: string;
  let custBirthdayTodayId: string;
  let custOtherCompanyBirthdayId: string;

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
    database = createDatabaseClient({ connectionString: integrationDatabaseUrl, applicationName: 'asone-dashboard-integration' });

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
       values($1,'Dashboard Co','Dashboard Co',$2,'active','UTC','MXN','es-MX'),
             ($3,'Other Dashboard Co','Other Dashboard Co',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `dashboard-${companyId}`, otherCompanyId, `dashboard-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'Dashboard Main','DMAIN','active','UTC'),
             ($3,$2,'Dashboard Excluded','DEXCL','active','UTC'),
             ($4,$5,'Other Co Main','OMAIN','active','UTC')`,
      [branchId, companyId, excludedBranchId, otherCompanyBranchId, otherCompanyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'Dashboard Actor','active'),($3,$4,$4,'Other Co Actor','active')`,
      [userId, `dashboard-${userId}@example.test`, otherCompanyUserId, `dashboard-${otherCompanyUserId}@example.test`],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status)
       values($1,$2,$3,'active'),($4,$5,$6,'active')`,
      [randomUUID(), companyId, userId, randomUUID(), otherCompanyId, otherCompanyUserId],
    );

    // --- Sales -----------------------------------------------------------
    async function insertSale(input: {
      forCompanyId: string;
      forBranchId: string;
      number: string;
      status: string;
      total: string;
      completedAt: Date | null;
    }): Promise<void> {
      await database.pool.query(
        `insert into sales(id,company_id,branch_id,sale_number,status,currency_code,subtotal,tax_total,total,completed_at,created_by)
         values($1,$2,$3,$4,$5,'MXN',$6,'0.0000',$6,$7,$8)`,
        [
          randomUUID(),
          input.forCompanyId,
          input.forBranchId,
          input.number,
          input.status,
          input.total,
          input.completedAt,
          input.forCompanyId === otherCompanyId ? otherCompanyUserId : userId,
        ],
      );
    }
    await insertSale({ forCompanyId: companyId, forBranchId: branchId, number: 'DB-0001', status: 'completed', total: '100.0000', completedAt: onTarget('09:00:00') });
    await insertSale({ forCompanyId: companyId, forBranchId: branchId, number: 'DB-0002', status: 'completed', total: '50.0000', completedAt: onOther('09:00:00') }); // wrong day.
    await insertSale({ forCompanyId: companyId, forBranchId: branchId, number: 'DB-0003', status: 'pending_payment', total: '10.0000', completedAt: null }); // never completed.
    await insertSale({ forCompanyId: companyId, forBranchId: excludedBranchId, number: 'DB-0004', status: 'completed', total: '999.0000', completedAt: onTarget('09:00:00') }); // excluded branch.
    await insertSale({ forCompanyId: otherCompanyId, forBranchId: otherCompanyBranchId, number: 'OC-0001', status: 'completed', total: '777.0000', completedAt: onTarget('09:00:00') }); // other tenant.

    // TASK 14.5A — sales trend fixture: yesterday=1000.0000, today=1200.0000
    // (exact +20% — see the dedicated `sales trend` tests below), plus a
    // separate "today" with genuinely zero sales the day before (proves
    // `pct_change: null`, never a fabricated 0), plus another tenant's sale
    // on the SAME "yesterday" date (proves the yesterday total is real
    // company-scoped SQL, never leaked across tenants).
    await insertSale({ forCompanyId: companyId, forBranchId: branchId, number: 'DB-0005', status: 'completed', total: '1000.0000', completedAt: new Date(`${TREND_YESTERDAY_DATE}T09:00:00Z`) });
    await insertSale({ forCompanyId: companyId, forBranchId: branchId, number: 'DB-0006', status: 'completed', total: '1200.0000', completedAt: new Date(`${TREND_TODAY_DATE}T09:00:00Z`) });
    await insertSale({ forCompanyId: companyId, forBranchId: branchId, number: 'DB-0007', status: 'completed', total: '500.0000', completedAt: new Date(`${TREND_NO_YDATA_DATE}T09:00:00Z`) });
    await insertSale({ forCompanyId: otherCompanyId, forBranchId: otherCompanyBranchId, number: 'OC-0002', status: 'completed', total: '9999.0000', completedAt: new Date(`${TREND_YESTERDAY_DATE}T09:00:00Z`) });

    // --- Cash (real CashService flow; session left OPEN) -----------------
    const cashRepository = new CashRepository(database);
    const cashService = new CashService(cashRepository);
    const registerResult = await cashService.createRegister(cashContext(companyId, onTarget('08:00:00')), [branchId], `reg-${randomUUID()}`, {
      branchId,
      code: `DB-REG-${randomUUID()}`,
      name: 'Dashboard Register',
    });
    cashRegisterId = registerResult.value.id;
    await cashService.openSession(cashContext(companyId, onTarget('08:00:00')), [branchId], `sess-${randomUUID()}`, {
      cashRegisterId,
      openingAmount: '100.0000',
    });

    // A second register/session, immediately closed — must never appear
    // as "open".
    const registerResult2 = await cashService.createRegister(cashContext(companyId, onTarget('08:00:00')), [branchId], `reg2-${randomUUID()}`, {
      branchId,
      code: `DB-REG2-${randomUUID()}`,
      name: 'Dashboard Register 2',
    });
    const sessionResult2 = await cashService.openSession(cashContext(companyId, onTarget('08:00:00')), [branchId], `sess2-${randomUUID()}`, {
      cashRegisterId: registerResult2.value.id,
      openingAmount: '10.0000',
    });
    await cashService.closeSession(cashContext(companyId, onTarget('09:00:00')), [branchId], `close2-${randomUUID()}`, sessionResult2.value.id, {
      declaredClosingAmount: '10.0000',
    });

    // --- Inventory (live snapshot: one out-of-stock variant) -------------
    const trackedProductId = randomUUID();
    const trackedVariantId = randomUUID();
    const locationId = randomUUID();
    await database.pool.query(
      `insert into products(id,company_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
       values($1,$2,'DB-TRACKED','db-tracked','DB Tracked','simple',true,'IVA_GENERAL','active',$3,$3)`,
      [trackedProductId, companyId, userId],
    );
    await database.pool.query(
      `insert into product_variants
       (id,company_id,product_id,sku,normalized_sku,name,unit_of_measure_code,quantity_scale,tracks_inventory,standard_cost,currency_code,is_default,option_signature,status,created_by,updated_by)
       values($1,$2,$3,'DB-TRACKED','db-tracked','Variante','unit',0,true,5,'MXN',true,$4,'active',$5,$5)`,
      [trackedVariantId, companyId, trackedProductId, '8'.repeat(64), userId],
    );
    await database.pool.query(
      `insert into inventory_locations (id,company_id,branch_id,code,normalized_code,name,location_type,status,allows_receiving,allows_issuing,is_default,created_by,updated_by)
       values($1,$2,$3,'MAIN','main','Main','main','active',true,true,true,$4,$4)`,
      [locationId, companyId, branchId, userId],
    );
    await database.pool.query(
      `insert into inventory_balances(id,company_id,branch_id,inventory_location_id,product_variant_id,quantity_on_hand,quantity_reserved,average_unit_cost,currency_code)
       values($1,$2,$3,$4,$5,'0.000000','0.000000','5.0000','MXN')`,
      [randomUUID(), companyId, branchId, locationId, trackedVariantId],
    );

    // --- Employees / attendance -------------------------------------------
    const employeeInId = randomUUID(); // clocked in, never out — counted.
    const employeeOutId = randomUUID(); // clocked in then out — not counted.
    const employeeWrongDayId = randomUUID(); // clocked in on OTHER_DATE — not counted for TARGET_DATE.
    await database.pool.query(
      `insert into employees(id,company_id,branch_id,code,display_name,status,currency_code,created_by,updated_by)
       values($1,$2,$3,'DB-EMP-1','Empleado Dentro','active','MXN',$4,$4),
             ($5,$2,$3,'DB-EMP-2','Empleado Fuera','active','MXN',$4,$4),
             ($6,$2,$3,'DB-EMP-3','Empleado Otro Dia','active','MXN',$4,$4)`,
      [employeeInId, companyId, branchId, userId, employeeOutId, employeeWrongDayId],
    );
    await database.pool.query(
      `insert into time_clock_punches(id,company_id,branch_id,employee_id,punch_type,occurred_at,created_by)
       values($1,$2,$3,$4,'clock_in',$5,$6)`,
      [randomUUID(), companyId, branchId, employeeInId, onTarget('08:00:00'), userId],
    );
    await database.pool.query(
      `insert into time_clock_punches(id,company_id,branch_id,employee_id,punch_type,occurred_at,created_by)
       values($1,$2,$3,$4,'clock_in',$5,$6),($7,$2,$3,$4,'clock_out',$8,$6)`,
      [randomUUID(), companyId, branchId, employeeOutId, onTarget('08:00:00'), userId, randomUUID(), onTarget('16:00:00')],
    );
    await database.pool.query(
      `insert into time_clock_punches(id,company_id,branch_id,employee_id,punch_type,occurred_at,created_by)
       values($1,$2,$3,$4,'clock_in',$5,$6)`,
      [randomUUID(), companyId, branchId, employeeWrongDayId, onOther('08:00:00'), userId],
    );

    // --- Parties -----------------------------------------------------------
    const roomId = randomUUID();
    const packageId = randomUUID();
    await database.pool.query(
      `insert into party_rooms(id,company_id,branch_id,code,name,status,created_by,updated_by)
       values($1,$2,$3,'DB-ROOM-A','Sala Dashboard','active',$4,$4)`,
      [roomId, companyId, branchId, userId],
    );
    await database.pool.query(
      `insert into party_packages(id,company_id,branch_id,code,name,status,price,currency_code,duration_minutes,created_by,updated_by)
       values($1,$2,$3,'DB-PKG-A','Paquete Dashboard','active','500.0000','MXN',60,$4,$4)`,
      [packageId, companyId, branchId, userId],
    );
    // Today's reservation, confirmed, partially paid — appears in the
    // party list AND contributes to outstanding balance.
    reservationTodayId = randomUUID();
    await database.pool.query(
      `insert into party_reservations(id,company_id,branch_id,reservation_number,room_id,package_id,event_date,start_time,end_time,status,quoted_total,currency_code,created_by,updated_by)
       values($1,$2,$3,'DB-PR-0001',$4,$5,$6,'10:00','11:00','confirmed','500.0000','MXN',$7,$7)`,
      [reservationTodayId, companyId, branchId, roomId, packageId, TARGET_DATE, userId],
    );
    await database.pool.query(
      `insert into party_reservation_payments(id,company_id,branch_id,reservation_id,cash_movement_id,purpose,amount_snapshot,created_by,created_at)
       values($1,$2,$3,$4,$5,'deposit','200.0000',$6,$7)`,
      [randomUUID(), companyId, branchId, reservationTodayId, randomUUID(), userId, onTarget('09:00:00')],
    );
    // A different-day reservation, still `held` (unpaid) — must NOT
    // appear in today's party list, but MUST still contribute to the
    // (company-wide, not date-scoped) outstanding balance.
    const reservationOtherDayId = randomUUID();
    await database.pool.query(
      `insert into party_reservations(id,company_id,branch_id,reservation_number,room_id,package_id,event_date,start_time,end_time,status,quoted_total,currency_code,created_by,updated_by)
       values($1,$2,$3,'DB-PR-0002',$4,$5,$6,'12:00','13:00','held','300.0000','MXN',$7,$7)`,
      [reservationOtherDayId, companyId, branchId, roomId, packageId, OTHER_DATE, userId],
    );
    // A cancelled reservation, today — must be excluded from outstanding
    // balance (never a live obligation) even though it is unpaid.
    const reservationCancelledId = randomUUID();
    await database.pool.query(
      `insert into party_reservations
       (id,company_id,branch_id,reservation_number,room_id,package_id,event_date,start_time,end_time,status,quoted_total,currency_code,
        cancelled_at,cancelled_by,cancellation_reason,created_by,updated_by)
       values($1,$2,$3,'DB-PR-0003',$4,$5,$6,'14:00','15:00','cancelled','400.0000','MXN',$7,$8,'test_cancellation',$8,$8)`,
      [reservationCancelledId, companyId, branchId, roomId, packageId, TARGET_DATE, onTarget('09:30:00'), userId],
    );

    // --- Access ------------------------------------------------------------
    const credentialId = randomUUID();
    await database.pool.query(
      `insert into access_credentials(id,company_id,branch_id,code,status,currently_inside,issued_by)
       values($1,$2,$3,$4,'issued','true',$5)`,
      [credentialId, companyId, branchId, `DB-ACC-${randomUUID()}`, userId],
    );
    await database.pool.query(
      `insert into access_events(id,company_id,branch_id,credential_id,event_type,occurred_at,created_by)
       values($1,$2,$3,$4,'entry',$5,$6)`,
      [randomUUID(), companyId, branchId, credentialId, onTarget('09:00:00'), userId],
    );

    // --- Customers (birthdays) ---------------------------------------------
    // TASK 14.5A — real customers whose `birth_date` month/day is matched
    // against TARGET_DATE's own month/day (2026-03-10 → 03-10), including
    // two negative controls (wrong month, wrong day) and one positive
    // cross-tenant control (same month/day, different company).
    custBirthdayTodayId = randomUUID();
    const custWrongMonthId = randomUUID();
    const custWrongDayId = randomUUID();
    custOtherCompanyBirthdayId = randomUUID();
    await database.pool.query(
      `insert into customers(id,company_id,first_name,last_name,display_name,birth_date,created_by,updated_by)
       values($1,$2,'Cliente','Cumpleañero','Cliente Cumpleañero','1990-03-10',$3,$3),
             ($4,$2,'Cliente','Mes Incorrecto','Cliente Mes Incorrecto','1990-04-10',$3,$3),
             ($5,$2,'Cliente','Dia Incorrecto','Cliente Dia Incorrecto','1990-03-11',$3,$3)`,
      [custBirthdayTodayId, companyId, userId, custWrongMonthId, custWrongDayId],
    );
    await database.pool.query(
      `insert into customers(id,company_id,first_name,last_name,display_name,birth_date,created_by,updated_by)
       values($1,$2,'Cliente','Cumpleaños Otra Empresa','Cliente Cumpleaños Otra Empresa','1985-03-10',$3,$3)`,
      [custOtherCompanyBirthdayId, otherCompanyId, otherCompanyUserId],
    );

    const authentication = {
      authenticate: () => Promise.resolve(authContext),
      requirePermission: (context: AuthContext, permission: string) => {
        if (!context.permissions.includes(permission)) throw new AppError({ code: 'permission_denied', message: 'Permission denied.', statusCode: 403 });
      },
      requireBranchAccess: (context: AuthContext, forBranchId: string) => {
        if (!context.permittedBranchIds.includes(forBranchId)) throw new AppError({ code: 'branch_scope_mismatch', message: 'Branch denied.', statusCode: 403 });
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
      const statusCode = typeof (error as { statusCode?: unknown }).statusCode === 'number' ? (error as { statusCode: number }).statusCode : 500;
      return reply.code(statusCode).send({ error: { code: 'internal_error', message: (error as Error).message } });
    });

    const partiesRepository = new PartiesRepository(database);
    const partyRoomsService = new PartyRoomsService(partiesRepository);
    const partyReservationsService = new PartyReservationsService(partiesRepository, cashRepository);
    const reportsService = new ReportsService(new ReportsRepository(database));
    registerDashboardRoutes(
      app,
      authentication,
      new DashboardService(new DashboardRepository(database), reportsService, cashService, partyReservationsService, partyRoomsService),
    );
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
    await database.pool.query('delete from time_clock_punches where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from employees where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from inventory_balances where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from inventory_locations where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from product_variants where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from products where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from cash_movements where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from cash_sessions where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from cash_registers where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from sales where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from idempotency_keys where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from outbox_events where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from audit_log where company_id=any($1::uuid[])', [ids]);
    // TASK 14.5A — customers reference company_memberships (created_by/
    // updated_by, `onDelete: 'restrict'`), so they must be deleted first.
    await database.pool.query('delete from customers where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from company_memberships where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from branches where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from companies where id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from users where id=any($1::uuid[])', [[userId, otherCompanyUserId]]);
    await database.close();
  });

  function get(path: string): Promise<Awaited<ReturnType<FastifyInstance['inject']>>> {
    return app.inject({ method: 'GET', url: path, headers: { authorization: 'Bearer x' } });
  }

  interface SummaryBody {
    data: {
      date: string;
      branch_id: string | null;
      sales: {
        transaction_count: number;
        gross_total: { currency_code: string; amount: string }[];
        trend_vs_yesterday: { currency_code: string; today_total: string; yesterday_total: string; pct_change: number | null }[];
      };
      occupancy: { current_occupancy: number };
      parties: { count: number; reservations: { id: string; room_name: string | null; status: string }[] };
      cash_sessions: { open_count: number; sessions: { cash_register_name: string | null; opening_amount: string }[] };
      outstanding_party_balances: { currency_code: string; amount: string }[];
      employee_attendance: { clocked_in_count: number };
      inventory_alerts: { out_of_stock_variant_count: number };
      birthdays_today: { count: number; customers: { id: string; display_name: string }[] };
    };
  }

  it('aggregates every metric correctly against the known fixture for a single branch, single day', async () => {
    authContext = baseContext(companyId, branchId, [branchId]);
    const response = await get(`/api/v1/dashboard/summary?date=${TARGET_DATE}&branch_id=${branchId}`);
    expect(response.statusCode).toBe(200);
    const data = response.json<SummaryBody>().data;

    expect(data.date).toBe(TARGET_DATE);
    expect(data.branch_id).toBe(branchId);

    // Sales: only DB-0001 (completed, today, this branch).
    expect(data.sales.transaction_count).toBe(1);
    expect(data.sales.gross_total).toEqual([{ currency_code: 'MXN', amount: '100.0000' }]);

    // Occupancy: the one currently-inside credential.
    expect(data.occupancy.current_occupancy).toBe(1);

    // Parties: both TODAY reservations (confirmed + cancelled — mirrors
    // the legacy's own `fiestasHoy` filter, which never excluded a status
    // either; a cancelled party for today is still real information a
    // manager should see, not silently hidden), each with its room name
    // resolved. The OTHER_DATE reservation is correctly excluded.
    expect(data.parties.count).toBe(2);
    expect(data.parties.reservations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: reservationTodayId, room_name: 'Sala Dashboard', status: 'confirmed' }),
      ]),
    );

    // Cash sessions: exactly the one still-open session (the second one
    // was closed immediately and must not appear).
    expect(data.cash_sessions.open_count).toBe(1);
    expect(data.cash_sessions.sessions).toEqual([
      expect.objectContaining({ cash_register_name: 'Dashboard Register', opening_amount: '100.0000' }),
    ]);

    // Outstanding balances: TODAY reservation (500-200=300) + OTHER_DATE
    // reservation (300-0=300) = 600 — company-wide, not date-scoped; the
    // cancelled reservation (400 unpaid) is correctly excluded.
    expect(data.outstanding_party_balances).toEqual([{ currency_code: 'MXN', amount: '600.0000' }]);

    // Attendance: only the employee still clocked in (no clock_out yet)
    // ON this date.
    expect(data.employee_attendance.clocked_in_count).toBe(1);

    // Inventory: the one zero-quantity variant.
    expect(data.inventory_alerts.out_of_stock_variant_count).toBe(1);
  });

  it('branch scoping: an excluded same-company branch never contributes, even with no branch_id filter', async () => {
    authContext = baseContext(companyId, branchId, [branchId]); // excludedBranchId NOT permitted.
    const response = await get(`/api/v1/dashboard/summary?date=${TARGET_DATE}`);
    expect(response.statusCode).toBe(200);
    const data = response.json<SummaryBody>().data;
    // Still exactly 100.0000 — DB-0004 (999.0000, excludedBranchId) never counted.
    expect(data.sales.gross_total).toEqual([{ currency_code: 'MXN', amount: '100.0000' }]);
  });

  it('an actor whose permittedBranchIds includes the excluded branch DOES see it — proving real scoping, not a broken query', async () => {
    authContext = baseContext(companyId, branchId, [branchId, excludedBranchId]);
    const response = await get(`/api/v1/dashboard/summary?date=${TARGET_DATE}`);
    const data = response.json<SummaryBody>().data;
    expect(data.sales.gross_total).toEqual([{ currency_code: 'MXN', amount: '1099.0000' }]); // 100 + 999.
  });

  it('no cross-tenant leakage: company A never sees company B\'s figures for the identical date', async () => {
    authContext = baseContext(otherCompanyId, otherCompanyBranchId, [otherCompanyBranchId]);
    const response = await get(`/api/v1/dashboard/summary?date=${TARGET_DATE}`);
    expect(response.statusCode).toBe(200);
    const data = response.json<SummaryBody>().data;
    expect(data.sales.transaction_count).toBe(1);
    expect(data.sales.gross_total).toEqual([{ currency_code: 'MXN', amount: '777.0000' }]);
    expect(data.occupancy.current_occupancy).toBe(0);
    expect(data.parties.count).toBe(0);
    expect(data.outstanding_party_balances).toEqual([]);
    expect(data.employee_attendance.clocked_in_count).toBe(0);
  });

  it('empty-dataset behavior: a day with zero matching rows returns real honest zeros/empty arrays, never an error', async () => {
    authContext = baseContext(companyId, branchId, [branchId]);
    const response = await get(`/api/v1/dashboard/summary?date=${EMPTY_DATE}`);
    expect(response.statusCode).toBe(200);
    const data = response.json<SummaryBody>().data;
    expect(data.sales.transaction_count).toBe(0);
    expect(data.sales.gross_total).toEqual([]);
    expect(data.parties.count).toBe(0);
    expect(data.parties.reservations).toEqual([]);
    expect(data.employee_attendance.clocked_in_count).toBe(0);
    // Live, present-moment snapshots stay real regardless of the date
    // requested — never zeroed out just because the date param is empty.
    expect(data.occupancy.current_occupancy).toBe(1);
    expect(data.inventory_alerts.out_of_stock_variant_count).toBe(1);
    expect(data.cash_sessions.open_count).toBe(1);
    expect(data.outstanding_party_balances).toEqual([{ currency_code: 'MXN', amount: '600.0000' }]);
    // Real "no activity at all" for this date — no currency was ever seen
    // today OR yesterday, so the trend array is genuinely empty (never a
    // fabricated entry), and no customer has this month/day birthday.
    expect(data.sales.trend_vs_yesterday).toEqual([]);
    expect(data.birthdays_today).toEqual({ count: 0, customers: [] });
  });

  it('a missing/malformed date is rejected as a real validation error, never silently defaulted', async () => {
    authContext = baseContext(companyId, branchId, [branchId]);
    const missing = await get('/api/v1/dashboard/summary');
    expect(missing.statusCode).toBe(400);
    const malformed = await get('/api/v1/dashboard/summary?date=not-a-date');
    expect(malformed.statusCode).toBe(400);
  });

  it('an actor without report.read is rejected', async () => {
    authContext = { ...baseContext(companyId, branchId, [branchId]), permissions: [] };
    const response = await get(`/api/v1/dashboard/summary?date=${TARGET_DATE}`);
    expect(response.statusCode).toBe(403);
  });

  it('a branch_id outside the actor\'s permittedBranchIds is rejected with a real 403, never silently ignored', async () => {
    authContext = baseContext(companyId, branchId, [branchId]);
    const response = await get(`/api/v1/dashboard/summary?date=${TARGET_DATE}&branch_id=${excludedBranchId}`);
    expect(response.statusCode).toBe(403);
  });

  // --- TASK 14.5A: sales trend vs. yesterday ------------------------------

  it('sales trend: exact pctChange against a known fixture (yesterday=1000.0000, today=1200.0000 -> +20%)', async () => {
    authContext = baseContext(companyId, branchId, [branchId]);
    const response = await get(`/api/v1/dashboard/summary?date=${TREND_TODAY_DATE}&branch_id=${branchId}`);
    expect(response.statusCode).toBe(200);
    const data = response.json<SummaryBody>().data;
    expect(data.sales.trend_vs_yesterday).toEqual([
      { currency_code: 'MXN', today_total: '1200.0000', yesterday_total: '1000.0000', pct_change: 20 },
    ]);
  });

  it('sales trend: pct_change is null (never a fabricated 0) when yesterday had zero real sales', async () => {
    authContext = baseContext(companyId, branchId, [branchId]);
    const response = await get(`/api/v1/dashboard/summary?date=${TREND_NO_YDATA_DATE}&branch_id=${branchId}`);
    expect(response.statusCode).toBe(200);
    const data = response.json<SummaryBody>().data;
    expect(data.sales.trend_vs_yesterday).toEqual([
      { currency_code: 'MXN', today_total: '500.0000', yesterday_total: '0.0000', pct_change: null },
    ]);
  });

  it('sales trend: company-scoping positive control — a second tenant\'s much larger sale on the SAME "yesterday" never leaks into company A\'s yesterday_total', async () => {
    authContext = baseContext(companyId, branchId, [branchId]);
    const response = await get(`/api/v1/dashboard/summary?date=${TREND_TODAY_DATE}&branch_id=${branchId}`);
    const data = response.json<SummaryBody>().data;
    // If tenant scoping were broken, yesterday_total would include the
    // other company's 9999.0000 sale on TREND_YESTERDAY_DATE (making it
    // 10999.0000 instead of 1000.0000).
    expect(data.sales.trend_vs_yesterday).toEqual([
      { currency_code: 'MXN', today_total: '1200.0000', yesterday_total: '1000.0000', pct_change: 20 },
    ]);
  });

  it('sales trend: the second tenant queried for the same dates sees only its OWN real sales', async () => {
    authContext = baseContext(otherCompanyId, otherCompanyBranchId, [otherCompanyBranchId]);
    const response = await get(`/api/v1/dashboard/summary?date=${TREND_TODAY_DATE}`);
    const data = response.json<SummaryBody>().data;
    expect(data.sales.trend_vs_yesterday).toEqual([
      { currency_code: 'MXN', today_total: '0.0000', yesterday_total: '9999.0000', pct_change: -100 },
    ]);
  });

  // --- TASK 14.5A: birthday alerts -----------------------------------------

  it('birthdays: includes only the customer whose birth_date month/day matches the requested date, excluding wrong-month/wrong-day negative controls', async () => {
    authContext = baseContext(companyId, branchId, [branchId]);
    const response = await get(`/api/v1/dashboard/summary?date=${TARGET_DATE}&branch_id=${branchId}`);
    expect(response.statusCode).toBe(200);
    const data = response.json<SummaryBody>().data;
    expect(data.birthdays_today).toEqual({
      count: 1,
      customers: [{ id: custBirthdayTodayId, display_name: 'Cliente Cumpleañero' }],
    });
  });

  it('birthdays: a matching customer belonging to a DIFFERENT company never leaks into company A\'s list, and company B sees its own', async () => {
    authContext = baseContext(otherCompanyId, otherCompanyBranchId, [otherCompanyBranchId]);
    const response = await get(`/api/v1/dashboard/summary?date=${TARGET_DATE}`);
    expect(response.statusCode).toBe(200);
    const data = response.json<SummaryBody>().data;
    expect(data.birthdays_today).toEqual({
      count: 1,
      customers: [{ id: custOtherCompanyBirthdayId, display_name: 'Cliente Cumpleaños Otra Empresa' }],
    });
  });
});
