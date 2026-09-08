import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';
import { AppError } from '@asone/errors';

import type { AuthContext } from '../auth/auth.types.js';
import type { AuthService } from '../auth/auth.service.js';
import { registerEmployeeRoutes } from './employees.routes.js';
import { registerScheduleRoutes } from './schedules.routes.js';
import { registerTimeClockRoutes } from './time-clock.routes.js';
import { registerPayrollRoutes } from './payroll.routes.js';
import { PeopleRepository } from './people.repository.js';
import { EmployeesService } from './employees.service.js';
import { SchedulesService } from './schedules.service.js';
import { TimeClockService } from './time-clock.service.js';
import { PayrollService } from './payroll.service.js';

/**
 * TASK 14.4 (Wave 2) — Nómina real end-to-end coverage, including the
 * exact recovered `calcularNominaEmpleado` formula exercised against a
 * hand-computed fixture (see the "matches a hand-computed example" test
 * below for the arithmetic worked out in full). Mirrors
 * `purchasing.integration.test.ts`'s exact structure.
 */

const databaseUrl = process.env.DATABASE_TEST_URL;
const integrationDatabaseUrl = databaseUrl ?? 'postgresql://people-payroll-integration-disabled';
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

integration('PostgreSQL payroll operations (TASK 14.4, Wave 2)', { concurrent: false }, () => {
  let app: FastifyInstance;
  let database: DatabaseClient;

  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const branchId = randomUUID();
  const otherCompanyBranchId = randomUUID();
  const userId = randomUUID();
  const otherCompanyUserId = randomUUID();

  function contextFor(forCompanyId: string, forBranchId: string, forUserId: string, permissions: readonly string[]): AuthContext {
    return {
      sessionId: randomUUID(),
      userId: forUserId,
      membershipId: randomUUID(),
      companyId: forCompanyId,
      branchId: forBranchId,
      expiresAt: new Date(Date.now() + 60_000),
      companyWideAccess: false,
      permissions: [...permissions],
      permittedBranchIds: [forBranchId],
      transportMode: 'bearer',
    };
  }
  const fullPermissions = [
    'employee.manage',
    'employee.read',
    'schedule.manage',
    'schedule.read',
    'attendance.manage',
    'attendance.read',
    'payroll.read',
    'payroll.manage',
    'payroll.close',
  ] as const;
  let authContext: AuthContext = contextFor(companyId, branchId, userId, fullPermissions);

  beforeAll(async () => {
    if (!new URL(integrationDatabaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({ connectionString: integrationDatabaseUrl, applicationName: 'asone-people-payroll-integration' });
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
       values($1,'Payroll Co','Payroll Co',$2,'active','UTC','MXN','es-MX'),
             ($3,'Other Payroll Co','Other Payroll Co',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `payroll-${companyId}`, otherCompanyId, `payroll-${otherCompanyId}`],
    );
    // Branch timezone is UTC — chosen deliberately so this test's hand-computed
    // expected values do not also have to account for a timezone offset;
    // `payrollDailyFacts`'s own `at time zone` conversion still runs for real.
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'Payroll Main','PAYMAIN','active','UTC'),($3,$4,'Other Co Main','PAYOMAIN','active','UTC')`,
      [branchId, companyId, otherCompanyBranchId, otherCompanyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'Payroll Actor','active'),($3,$4,$4,'Other Co Actor','active')`,
      [userId, `payroll-${userId}@example.test`, otherCompanyUserId, `payroll-${otherCompanyUserId}@example.test`],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status)
       values($1,$2,$3,'active'),($4,$5,$6,'active')`,
      [randomUUID(), companyId, userId, randomUUID(), otherCompanyId, otherCompanyUserId],
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
      return reply.code(500).send({ error: { code: 'internal_error', message: (error as Error).message } });
    });

    const repository = new PeopleRepository(database);
    registerEmployeeRoutes(app, authentication, new EmployeesService(repository));
    registerScheduleRoutes(app, authentication, new SchedulesService(repository));
    registerTimeClockRoutes(app, authentication, new TimeClockService(repository));
    registerPayrollRoutes(app, authentication, new PayrollService(repository));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    const ids = [companyId, otherCompanyId];
    await database.pool.query('delete from payroll_period_lines where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from payroll_periods where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from time_clock_punches where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from employee_schedules where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from employees where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from idempotency_keys where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from outbox_events where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from audit_log where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from company_memberships where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from branches where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from companies where id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from users where id=any($1::uuid[])', [[userId, otherCompanyUserId]]);
    await database.close();
  });

  function call(
    method: 'POST' | 'PUT',
    url: string,
    key: string,
    body: Record<string, unknown>,
  ): Promise<Awaited<ReturnType<FastifyInstance['inject']>>> {
    return app.inject({
      method,
      url,
      headers: { authorization: 'Bearer x', 'idempotency-key': key, 'content-type': 'application/json' },
      payload: body,
    });
  }

  it('matches a hand-computed example of the exact recovered formula, then close/recalculate/frozen-snapshot/reopen behave as specified', async () => {
    authContext = contextFor(companyId, branchId, userId, fullPermissions);

    // --- Fixture setup -------------------------------------------------
    // One employee, weekly_salary = 700.0000 MXN. A 7-day period
    // (2026-02-02..2026-02-08 inclusive) — the real launch scenario's
    // week length. Only 2026-02-02 carries a real shift + punches; two
    // more days are explicit days off; the rest have no schedule row at
    // all (both must contribute 0 scheduled minutes — step 1).
    const employee = await call('POST', '/api/v1/employees', `payroll-emp-${randomUUID()}`, {
      branch_id: branchId,
      code: `payroll-emp-${randomUUID().slice(0, 8)}`,
      display_name: 'Payroll Fixture Employee',
      weekly_salary: '700.0000',
      currency_code: 'MXN',
    });
    const employeeId = employee.json<{ data: { id: string } }>().data.id;

    await call('PUT', '/api/v1/schedules', `payroll-sched-work-${randomUUID()}`, {
      employee_id: employeeId,
      work_date: '2026-02-02',
      is_day_off: false,
      scheduled_start: '09:00',
      scheduled_end: '17:00', // 480 scheduled minutes.
    });
    await call('PUT', '/api/v1/schedules', `payroll-sched-off1-${randomUUID()}`, {
      employee_id: employeeId,
      work_date: '2026-02-03',
      is_day_off: true,
    });
    await call('PUT', '/api/v1/schedules', `payroll-sched-off2-${randomUUID()}`, {
      employee_id: employeeId,
      work_date: '2026-02-04',
      is_day_off: true,
    });

    // Corrections (attendance.manage) used purely as a convenient way to
    // insert punches at EXACT, deterministic timestamps for the
    // hand-computed assertion below (an ordinary clock-in/out always
    // stamps "now", which a fixture can't hardcode).
    const clockInPlaceholder = await call('POST', '/api/v1/time-clock/clock-in', `payroll-in-${randomUUID()}`, { employee_id: employeeId });
    const placeholderId = clockInPlaceholder.json<{ data: { id: string } }>().data.id;
    await call('POST', '/api/v1/time-clock/clock-out', `payroll-out-${randomUUID()}`, { employee_id: employeeId });
    await call('POST', '/api/v1/time-clock/corrections', `payroll-corr-in-${randomUUID()}`, {
      employee_id: employeeId,
      punch_type: 'clock_in',
      occurred_at: '2026-02-02T09:12:00.000Z', // 12 min after scheduled 09:00 -> late = 12-10 = 2.
      correction_reason: 'Fixture: deterministic clock-in for the hand-computed payroll test.',
      corrected_punch_id: placeholderId,
    });
    await call('POST', '/api/v1/time-clock/corrections', `payroll-corr-out-${randomUUID()}`, {
      employee_id: employeeId,
      punch_type: 'clock_out',
      occurred_at: '2026-02-02T17:30:00.000Z', // 30 min after scheduled 17:00 -> overtime = 30.
      correction_reason: 'Fixture: deterministic clock-out for the hand-computed payroll test.',
      corrected_punch_id: placeholderId,
    });
    // worked = 17:30 - 09:12 = 8h18m = 498 minutes.

    // --- Hand-computed expectation --------------------------------------
    // scheduledMinutes=480, workedMinutes=498, lateMinutes=2, overtimeMinutes=30.
    // baseSalarySnapshot = 700.0000 -> units 7,000,000 (scale 10_000).
    // deductionAmount = round_half_up(2 * 7,000,000 / 480) = round_half_up(14,000,000/480)
    //                 = floor((28,000,000+480)/960) = floor(29167.1666...) = 29167 units = 2.9167.
    // bonusAmount     = round_half_up(30 * 7,000,000 / 480) = 210,000,000/480 = 437500 units exactly = 43.7500.
    // totalAmount     = 7,000,000 - 29167 + 437500 = 7,408,333 units = 740.8333.
    const period = await call('POST', '/api/v1/payroll-periods', `payroll-period-${randomUUID()}`, {
      branch_id: branchId,
      period_start: '2026-02-02',
      period_end: '2026-02-08',
    });
    expect(period.statusCode).toBe(201);
    const periodId = period.json<{ data: { id: string } }>().data.id;

    const calculated = await call('POST', `/api/v1/payroll-periods/${periodId}/calculate`, `payroll-calc-1-${randomUUID()}`, {});
    expect(calculated.statusCode).toBe(200);
    const calculatedBody = calculated.json<{
      data: { lines: { employee_id: string; scheduled_minutes: number; worked_minutes: number; late_minutes: number; overtime_minutes: number; base_salary_snapshot: string; deduction_amount: string; bonus_amount: string; total_amount: string }[] };
    }>().data;
    const line = calculatedBody.lines.find((item) => item.employee_id === employeeId);
    expect(line).toMatchObject({
      scheduled_minutes: 480,
      worked_minutes: 498,
      late_minutes: 2,
      overtime_minutes: 30,
      base_salary_snapshot: '700.0000',
      deduction_amount: '2.9167',
      bonus_amount: '43.7500',
      total_amount: '740.8333',
    });

    // --- Recalculation while still draft replaces the lines wholesale ---
    const bumped = await app.inject({
      method: 'PUT',
      url: `/api/v1/employees/${employeeId}`,
      headers: {
        authorization: 'Bearer x',
        'idempotency-key': `payroll-salary-bump-real-${randomUUID()}`,
        'if-match': '"1"',
        'content-type': 'application/json',
      },
      payload: { weekly_salary: '1400.0000' },
    });
    expect(bumped.statusCode).toBe(200);

    const recalculated = await call('POST', `/api/v1/payroll-periods/${periodId}/calculate`, `payroll-calc-2-${randomUUID()}`, {});
    expect(recalculated.statusCode).toBe(200);
    const recalculatedLine = recalculated
      .json<{ data: { lines: { employee_id: string; base_salary_snapshot: string; total_amount: string }[] } }>()
      .data.lines.find((item) => item.employee_id === employeeId);
    // Doubling the salary exactly doubles every money figure (the minute
    // totals are unchanged, so this is a clean way to prove a REAL
    // recompute happened, not a stale replay).
    expect(recalculatedLine?.base_salary_snapshot).toBe('1400.0000');
    expect(recalculatedLine?.total_amount).toBe('1481.6667');

    const linesCount = await database.pool.query<{ count: string }>(
      'select count(*)::text count from payroll_period_lines where company_id=$1 and payroll_period_id=$2',
      [companyId, periodId],
    );
    expect(linesCount.rows[0]?.count).toBe('1'); // replaced wholesale, never accumulated.

    // --- Close, then reject any further recalculation --------------------
    const closed = await call('POST', `/api/v1/payroll-periods/${periodId}/close`, `payroll-close-${randomUUID()}`, {});
    expect(closed.statusCode).toBe(200);
    expect(closed.json<{ data: { status: string; closed_at: string | null } }>().data.status).toBe('closed');

    const recalcAfterClose = await call('POST', `/api/v1/payroll-periods/${periodId}/calculate`, `payroll-calc-3-${randomUUID()}`, {});
    expect(recalcAfterClose.statusCode).toBe(409);
    expect(recalcAfterClose.json<{ error: { code: string } }>().error.code).toBe('payroll_period_closed');

    // --- A closed period's lines are provably frozen -----------------------
    const bumpedAgain = await app.inject({
      method: 'PUT',
      url: `/api/v1/employees/${employeeId}`,
      headers: {
        authorization: 'Bearer x',
        'idempotency-key': `payroll-salary-bump-2-${randomUUID()}`,
        'if-match': '"2"',
        'content-type': 'application/json',
      },
      payload: { weekly_salary: '9999.0000' },
    });
    expect(bumpedAgain.statusCode).toBe(200);
    const stillFrozen = await app.inject({
      method: 'GET',
      url: `/api/v1/payroll-periods/${periodId}`,
      headers: { authorization: 'Bearer x' },
    });
    const stillFrozenLine = stillFrozen
      .json<{ data: { lines: { employee_id: string; base_salary_snapshot: string }[] } }>()
      .data.lines.find((item) => item.employee_id === employeeId);
    expect(stillFrozenLine?.base_salary_snapshot).toBe('1400.0000'); // unchanged by the post-close salary edit.

    // --- Reopen (payroll.close), distinguishable from an ordinary close ---
    const reopened = await call('POST', `/api/v1/payroll-periods/${periodId}/reopen`, `payroll-reopen-${randomUUID()}`, {});
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json<{ data: { status: string } }>().data.status).toBe('draft');

    const auditActions = await database.pool.query<{ action: string }>(
      `select action from audit_log where company_id=$1 and entity_id=$2 and action in ('payroll_period.closed','payroll_period.reopened') order by occurred_at asc`,
      [companyId, periodId],
    );
    expect(auditActions.rows.map((row) => row.action)).toEqual(['payroll_period.closed', 'payroll_period.reopened']);

    const recalcAfterReopen = await call('POST', `/api/v1/payroll-periods/${periodId}/calculate`, `payroll-calc-4-${randomUUID()}`, {});
    expect(recalcAfterReopen.statusCode).toBe(200); // draft again -> calculate is allowed once more.
  });

  it('an actor without payroll.manage cannot create/calculate a period; without payroll.close cannot close/reopen', async () => {
    authContext = contextFor(companyId, branchId, userId, fullPermissions);
    const period = await call('POST', '/api/v1/payroll-periods', `payroll-perm-period-${randomUUID()}`, {
      branch_id: branchId,
      period_start: '2026-05-01',
      period_end: '2026-05-07',
    });
    const periodId = period.json<{ data: { id: string } }>().data.id;

    authContext = contextFor(companyId, branchId, userId, ['payroll.read']);
    const createDenied = await call('POST', '/api/v1/payroll-periods', `payroll-perm-create-${randomUUID()}`, {
      branch_id: branchId,
      period_start: '2026-05-08',
      period_end: '2026-05-14',
    });
    expect(createDenied.statusCode).toBe(403);

    const calcDenied = await call('POST', `/api/v1/payroll-periods/${periodId}/calculate`, `payroll-perm-calc-${randomUUID()}`, {});
    expect(calcDenied.statusCode).toBe(403);

    authContext = contextFor(companyId, branchId, userId, ['payroll.read', 'payroll.manage']);
    const closeDenied = await call('POST', `/api/v1/payroll-periods/${periodId}/close`, `payroll-perm-close-${randomUUID()}`, {});
    expect(closeDenied.statusCode).toBe(403); // payroll.manage alone is not payroll.close.
  });

  it('company A cannot read or mutate company B\'s payroll periods', async () => {
    authContext = contextFor(otherCompanyId, otherCompanyBranchId, otherCompanyUserId, fullPermissions);
    const otherPeriod = await call('POST', '/api/v1/payroll-periods', `payroll-tenant-period-${randomUUID()}`, {
      branch_id: otherCompanyBranchId,
      period_start: '2026-06-01',
      period_end: '2026-06-07',
    });
    const otherPeriodId = otherPeriod.json<{ data: { id: string } }>().data.id;

    authContext = contextFor(companyId, branchId, userId, fullPermissions);
    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/payroll-periods/${otherPeriodId}`,
      headers: { authorization: 'Bearer x' },
    });
    expect(read.statusCode).toBe(404);

    const closeAttempt = await call('POST', `/api/v1/payroll-periods/${otherPeriodId}/close`, `payroll-tenant-close-${randomUUID()}`, {});
    expect(closeAttempt.statusCode).toBe(404);
  });
});
