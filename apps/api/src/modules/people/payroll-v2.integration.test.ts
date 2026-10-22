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
 * TASK 17.6 (Payroll V2) — end-to-end coverage against real PostgreSQL of
 * what V2 adds on top of the already-proven recovered formula: the frozen
 * per-day detail, manual auditable adjustments (create/void, never delete),
 * a closed period that cannot change (not even through later employee
 * edits), a close that refuses an empty payroll, a reopen that demands a
 * reason, idempotent replays, row-locked concurrency, and permission /
 * branch / company scoping on every new route.
 */

const databaseUrl = process.env.DATABASE_TEST_URL;
const integrationDatabaseUrl = databaseUrl ?? 'postgresql://payroll-v2-integration-disabled';
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

type Response = Awaited<ReturnType<FastifyInstance['inject']>>;

interface LineJson {
  id: string;
  employee_id: string;
  scheduled_minutes: number;
  worked_minutes: number;
  late_minutes: number;
  overtime_minutes: number;
  base_salary_snapshot: string;
  deduction_amount: string;
  bonus_amount: string;
  adjustment_amount: string;
  total_amount: string;
  employee_name: string | null;
  employee_code: string | null;
  job_title: string | null;
  snapshot_available: boolean;
}
interface DayJson {
  work_date: string;
  attendance_state: string;
  scheduled_minutes: number;
  worked_minutes: number;
  late_minutes: number;
  overtime_minutes: number;
  first_in_minute: number | null;
  last_out_minute: number | null;
  is_day_off: boolean;
}
interface AdjustmentJson {
  id: string;
  kind: string;
  amount: string;
  reason: string;
  status: string;
  voided_by: string | null;
  void_reason: string | null;
  created_by: string;
}

integration('PostgreSQL Payroll V2 (TASK 17.6)', { concurrent: false, timeout: 60_000 }, () => {
  let app: FastifyInstance;
  let database: DatabaseClient;

  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const branchId = randomUUID();
  const secondBranchId = randomUUID();
  const otherCompanyBranchId = randomUUID();
  const userId = randomUUID();
  const otherCompanyUserId = randomUUID();

  function contextFor(
    forCompanyId: string,
    forBranchIds: readonly string[],
    forUserId: string,
    permissions: readonly string[],
  ): AuthContext {
    return {
      sessionId: randomUUID(),
      userId: forUserId,
      membershipId: randomUUID(),
      companyId: forCompanyId,
      branchId: forBranchIds[0] ?? null,
      expiresAt: new Date(Date.now() + 60_000),
      companyWideAccess: false,
      permissions: [...permissions],
      permittedBranchIds: [...forBranchIds],
      transportMode: 'bearer',
    } as AuthContext;
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
  const bothBranches = [branchId, secondBranchId];
  let authContext: AuthContext = contextFor(companyId, bothBranches, userId, fullPermissions);
  const asFull = (): void => {
    authContext = contextFor(companyId, bothBranches, userId, fullPermissions);
  };

  beforeAll(async () => {
    if (!new URL(integrationDatabaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({ connectionString: integrationDatabaseUrl, applicationName: 'asone-payroll-v2-integration' });
    await applyIfMissing(database, 'employees', ['0025_worried_the_captain.sql']);
    await applyIfMissing(database, 'payroll_period_adjustments', ['0050_add_payroll_v2_adjustments_and_daily_detail.sql']);

    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'Payroll V2 Co','Payroll V2 Co',$2,'active','UTC','MXN','es-MX'),
             ($3,'Other V2 Co','Other V2 Co',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `payroll-v2-${companyId}`, otherCompanyId, `payroll-v2-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'V2 Main','V2MAIN','active','UTC'),
             ($3,$2,'V2 Second','V2SECOND','active','UTC'),
             ($4,$5,'Other V2 Main','V2OMAIN','active','UTC')`,
      [branchId, companyId, secondBranchId, otherCompanyBranchId, otherCompanyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'Payroll V2 Actor','active'),($3,$4,$4,'Other V2 Actor','active')`,
      [userId, `payroll-v2-${userId}@example.test`, otherCompanyUserId, `payroll-v2-${otherCompanyUserId}@example.test`],
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
    await database.pool.query('delete from payroll_period_adjustments where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from payroll_period_line_days where company_id=any($1::uuid[])', [ids]);
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

  function call(method: 'POST' | 'PUT', url: string, body: Record<string, unknown>, key = `v2-${randomUUID()}`): Promise<Response> {
    return app.inject({
      method,
      url,
      headers: { authorization: 'Bearer x', 'idempotency-key': key, 'content-type': 'application/json' },
      payload: body,
    });
  }
  function get(url: string): Promise<Response> {
    return app.inject({ method: 'GET', url, headers: { authorization: 'Bearer x' } });
  }
  async function createEmployee(forBranchId: string, overrides: Record<string, unknown> = {}): Promise<string> {
    const response = await call('POST', '/api/v1/employees', {
      branch_id: forBranchId,
      code: `v2-${randomUUID().slice(0, 8)}`,
      display_name: 'Ana Pérez',
      job_title: 'Cajera',
      weekly_salary: '700.0000',
      currency_code: 'MXN',
      ...overrides,
    });
    expect(response.statusCode).toBe(201);
    return response.json<{ data: { id: string } }>().data.id;
  }
  async function schedule(employeeId: string, workDate: string, start?: string, end?: string): Promise<void> {
    const response = await call(
      'PUT',
      '/api/v1/schedules',
      start === undefined
        ? { employee_id: employeeId, work_date: workDate, is_day_off: true }
        : { employee_id: employeeId, work_date: workDate, is_day_off: false, scheduled_start: start, scheduled_end: end },
    );
    expect(response.statusCode).toBe(200);
  }
  async function punch(forBranchId: string, employeeId: string, type: 'clock_in' | 'clock_out', at: string): Promise<void> {
    await database.pool.query(
      `insert into time_clock_punches(id,company_id,branch_id,employee_id,punch_type,occurred_at,created_by)
       values($1,$2,$3,$4,$5,$6,$7)`,
      [randomUUID(), companyId, forBranchId, employeeId, type, at, userId],
    );
  }
  async function createPeriod(forBranchId: string, start: string, end: string): Promise<string> {
    const response = await call('POST', '/api/v1/payroll-periods', { branch_id: forBranchId, period_start: start, period_end: end });
    expect(response.statusCode).toBe(201);
    return response.json<{ data: { id: string } }>().data.id;
  }
  async function calculate(periodId: string, key?: string): Promise<Response> {
    return call('POST', `/api/v1/payroll-periods/${periodId}/calculate`, {}, key);
  }
  function lineOf(response: Response, employeeId: string): LineJson {
    const line = response.json<{ data: { lines: LineJson[] } }>().data.lines.find((item) => item.employee_id === employeeId);
    if (line === undefined) throw new Error('line not found');
    return line;
  }
  async function detail(periodId: string, employeeId: string): Promise<{ line: LineJson; days: DayJson[]; adjustments: AdjustmentJson[]; status: number }> {
    const response = await get(`/api/v1/payroll-periods/${periodId}/employees/${employeeId}`);
    if (response.statusCode !== 200) return { line: undefined as unknown as LineJson, days: [], adjustments: [], status: response.statusCode };
    const body = response.json<{ data: { line: LineJson; days: DayJson[]; adjustments: AdjustmentJson[] } }>().data;
    return { ...body, status: 200 };
  }

  // Every test gets its OWN Monday-to-Sunday week (a period is unique per
  // branch+range). 2027-01-04 is a Monday (far from every fixed-date period below); each call shifts one more week.
  let weekCounter = 0;
  function dayOf(base: string, offset: number): string {
    const date = new Date(`${base}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  }
  async function weekWithDetail(): Promise<{ employeeId: string; periodId: string; week: string[] }> {
    asFull();
    weekCounter += 1;
    const monday = dayOf('2027-01-04', 7 * weekCounter);
    const week = Array.from({ length: 7 }, (_, index) => dayOf(monday, index));
    const at = (index: number, time: string): string => `${week[index] ?? monday}T${time}.000Z`;
    const employeeId = await createEmployee(branchId);
    await schedule(employeeId, week[0] ?? monday, '09:00', '17:00'); // Mon: worked
    await schedule(employeeId, week[1] ?? monday); // Tue: day off
    await schedule(employeeId, week[2] ?? monday, '09:00', '17:00'); // Wed: scheduled, no punches
    // Thu: no schedule row but real punches -> unscheduled_work.
    await schedule(employeeId, week[4] ?? monday, '09:00', '17:00'); // Fri: clock-in only
    await punch(branchId, employeeId, 'clock_in', at(0, '09:12:00'));
    await punch(branchId, employeeId, 'clock_out', at(0, '17:30:00'));
    await punch(branchId, employeeId, 'clock_in', at(3, '10:00:00'));
    await punch(branchId, employeeId, 'clock_out', at(3, '14:00:00'));
    await punch(branchId, employeeId, 'clock_in', at(4, '09:00:00'));
    const periodId = await createPeriod(branchId, week[0] ?? monday, week[6] ?? monday);
    return { employeeId, periodId, week };
  }

  it('calculate freezes a truthful per-day breakdown whose sum is exactly the payroll line, and snapshots who the line is for', async () => {
    const { employeeId, periodId, week } = await weekWithDetail();
    const calculated = await calculate(periodId);
    expect(calculated.statusCode).toBe(200);
    const line = lineOf(calculated, employeeId);
    expect(line).toMatchObject({
      scheduled_minutes: 3 * 480,
      worked_minutes: 498 + 240, // Mon 9:12-17:30 + Thu 10:00-14:00; Fri has an open punch -> 0
      late_minutes: 2,
      overtime_minutes: 30,
      base_salary_snapshot: '700.0000',
      adjustment_amount: '0.0000',
      employee_name: 'Ana Pérez',
      job_title: 'Cajera',
      snapshot_available: true,
    });

    const result = await detail(periodId, employeeId);
    expect(result.status).toBe(200);
    expect(result.days.map((day) => day.work_date)).toEqual(week);
    expect(result.days.map((day) => day.attendance_state)).toEqual([
      'complete', 'day_off', 'no_punches', 'unscheduled_work', 'missing_clock_out', 'no_schedule', 'no_schedule',
    ]);
    const monday = result.days[0];
    expect(monday).toMatchObject({ scheduled_minutes: 480, worked_minutes: 498, late_minutes: 2, overtime_minutes: 30, first_in_minute: 552, last_out_minute: 1050 });
    // The invariant the whole design rests on: the days add up to the line.
    const sum = (pick: (day: DayJson) => number): number => result.days.reduce((total, day) => total + pick(day), 0);
    expect(sum((day) => day.scheduled_minutes)).toBe(line.scheduled_minutes);
    expect(sum((day) => day.worked_minutes)).toBe(line.worked_minutes);
    expect(sum((day) => day.late_minutes)).toBe(line.late_minutes);
    expect(sum((day) => day.overtime_minutes)).toBe(line.overtime_minutes);
  });

  it('an employee with no schedule and no punches still gets an honest line and an honest detail (never an invented absence)', async () => {
    asFull();
    const employeeId = await createEmployee(branchId, { display_name: 'Sin Horario' });
    const periodId = await createPeriod(branchId, '2026-03-02', '2026-03-08');
    const calculated = await calculate(periodId);
    expect(calculated.statusCode).toBe(200);
    expect(lineOf(calculated, employeeId)).toMatchObject({
      scheduled_minutes: 0,
      worked_minutes: 0,
      base_salary_snapshot: '700.0000',
      total_amount: '700.0000',
    });
    const result = await detail(periodId, employeeId);
    expect(result.days).toHaveLength(7);
    expect(new Set(result.days.map((day) => day.attendance_state))).toEqual(new Set(['no_schedule']));
  });

  it('the detail of an employee with no line in the period is a clean 404 (never fabricated)', async () => {
    asFull();
    const periodId = await createPeriod(branchId, '2026-03-09', '2026-03-15');
    const missing = await detail(periodId, randomUUID());
    expect(missing.status).toBe(404);
  });

  it('late tolerance (10 minutes) end to end: 09:00 start — 09:09 and 09:10 are not late, 09:11 is 1 minute, 09:20 is 10', async () => {
    asFull();
    weekCounter += 1;
    const monday = dayOf('2027-01-04', 7 * weekCounter);
    const cases: [string, number][] = [['09:00', 0], ['09:09', 0], ['09:10', 0], ['09:11', 1], ['09:20', 10]];
    const employees: [string, number][] = [];
    for (const [clockIn, expectedLate] of cases) {
      const employeeId = await createEmployee(branchId);
      await schedule(employeeId, monday, '09:00', '17:00');
      await punch(branchId, employeeId, 'clock_in', `${monday}T${clockIn}:00.000Z`);
      await punch(branchId, employeeId, 'clock_out', `${monday}T17:00:00.000Z`);
      employees.push([employeeId, expectedLate]);
    }
    const periodId = await createPeriod(branchId, monday, dayOf(monday, 6));
    const calculated = await calculate(periodId);
    for (const [employeeId, expectedLate] of employees) {
      const line = lineOf(calculated, employeeId);
      expect(line.late_minutes).toBe(expectedLate);
      expect(line.overtime_minutes).toBe(0);
      // The deduction follows only the (post-tolerance) late minutes.
      expect(line.deduction_amount === '0.0000').toBe(expectedLate === 0);
    }
  });

  it('a punch problem stays incomplete (flagged), never reported as on time', async () => {
    asFull();
    weekCounter += 1;
    const monday = dayOf('2027-01-04', 7 * weekCounter);
    const employeeId = await createEmployee(branchId);
    await schedule(employeeId, monday, '09:00', '17:00');
    await schedule(employeeId, dayOf(monday, 1), '09:00', '17:00');
    await punch(branchId, employeeId, 'clock_out', `${monday}T17:00:00.000Z`); // no clock-in
    const periodId = await createPeriod(branchId, monday, dayOf(monday, 6));
    await calculate(periodId);
    const result = await detail(periodId, employeeId);
    expect(result.days[0]).toMatchObject({ attendance_state: 'missing_clock_in', worked_minutes: 0 });
    expect(result.days[1]).toMatchObject({ attendance_state: 'no_punches', worked_minutes: 0 });
  });

  it('overnight shifts are not supported: a schedule that ends before it starts is rejected at the API', async () => {
    asFull();
    const employeeId = await createEmployee(branchId);
    const response = await call('PUT', '/api/v1/schedules', {
      employee_id: employeeId,
      work_date: '2027-06-01',
      is_day_off: false,
      scheduled_start: '22:00',
      scheduled_end: '06:00',
    });
    expect([400, 422]).toContain(response.statusCode);
  });

  it('overtime is attendance information only: it adds no money, and only an explicit adjustment changes the total', async () => {
    const { employeeId, periodId } = await weekWithDetail();
    const line = lineOf(await calculate(periodId), employeeId);
    expect(line.overtime_minutes).toBe(30);
    expect(line.bonus_amount).toBe('0.0000');
    expect(line.total_amount).toBe('699.0278'); // 700.0000 base − 0.9722 late deduction, nothing for overtime
    const adjusted = await call('POST', `/api/v1/payroll-periods/${periodId}/adjustments`, {
      employee_id: employeeId,
      kind: 'bonus',
      amount: '100.0000',
      reason: 'Horas extra acordadas',
    });
    expect(adjusted.statusCode).toBe(201);
    const after = adjusted.json<{ data: { line: LineJson } }>().data.line;
    expect(after.bonus_amount).toBe('0.0000');
    expect(after.total_amount).toBe('799.0278');
  });

  it('manual adjustments: bonus/deduction change the total with exact money, survive recalculation, and a void never deletes the record', async () => {
    const { employeeId, periodId } = await weekWithDetail();
    const base = lineOf(await calculate(periodId), employeeId); // formula-only total
    expect(base.total_amount).toBe('699.0278');

    const bonus = await call('POST', `/api/v1/payroll-periods/${periodId}/adjustments`, {
      employee_id: employeeId,
      kind: 'bonus',
      amount: '200.0000',
      reason: 'Bono de puntualidad del mes',
    });
    expect(bonus.statusCode).toBe(201);
    const bonusBody = bonus.json<{ data: AdjustmentJson & { line: LineJson } }>().data;
    expect(bonusBody).toMatchObject({ kind: 'bonus', amount: '200.0000', status: 'active', created_by: userId });
    expect(bonusBody.line).toMatchObject({ adjustment_amount: '200.0000', total_amount: '899.0278' });

    const deduction = await call('POST', `/api/v1/payroll-periods/${periodId}/adjustments`, {
      employee_id: employeeId,
      kind: 'deduction',
      amount: '50.5',
      reason: 'Faltante de caja',
    });
    expect(deduction.statusCode).toBe(201);
    expect(deduction.json<{ data: { line: LineJson } }>().data.line).toMatchObject({
      adjustment_amount: '149.5000',
      total_amount: '848.5278',
    });

    // A recalculation REPLACES the lines wholesale but must keep the adjustments.
    const recalculated = lineOf(await calculate(periodId), employeeId);
    expect(recalculated).toMatchObject({ adjustment_amount: '149.5000', total_amount: '848.5278' });
    expect((await detail(periodId, employeeId)).adjustments).toHaveLength(2);

    // Voiding the bonus: the row stays (status voided + who/why), the total follows.
    const voided = await call('POST', `/api/v1/payroll-periods/${periodId}/adjustments/${bonusBody.id}/void`, {
      reason: 'Capturado por error',
    });
    expect(voided.statusCode).toBe(200);
    expect(voided.json<{ data: AdjustmentJson & { line: LineJson } }>().data).toMatchObject({
      status: 'voided',
      voided_by: userId,
      void_reason: 'Capturado por error',
      line: { adjustment_amount: '-50.5000', total_amount: '648.5278' },
    });
    const after = await detail(periodId, employeeId);
    expect(after.adjustments.map((item) => item.status).sort()).toEqual(['active', 'voided']);
    const rows = await database.pool.query<{ count: string }>(
      'select count(*)::text count from payroll_period_adjustments where company_id=$1 and payroll_period_id=$2',
      [companyId, periodId],
    );
    expect(rows.rows[0]?.count).toBe('2'); // nothing was deleted

    // Voiding twice is a conflict, not a second silent change.
    const again = await call('POST', `/api/v1/payroll-periods/${periodId}/adjustments/${bonusBody.id}/void`, {
      reason: 'Otra vez por error',
    });
    expect(again.statusCode).toBe(409);

    // Every adjustment action left an audit trail with the actor.
    const audit = await database.pool.query<{ action: string; actor_id: string }>(
      `select action,actor_id from audit_log where company_id=$1 and action like 'payroll_adjustment.%' and metadata->>'payroll_period_id'=$2 order by occurred_at asc`,
      [companyId, periodId],
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      'payroll_adjustment.created',
      'payroll_adjustment.created',
      'payroll_adjustment.voided',
    ]);
    expect(new Set(audit.rows.map((row) => row.actor_id))).toEqual(new Set([userId]));
  });

  it('adjustment validation: positive magnitude, explicit kind, a real reason, and an existing payroll line', async () => {
    const { employeeId, periodId } = await weekWithDetail();
    await calculate(periodId);
    const zero = await call('POST', `/api/v1/payroll-periods/${periodId}/adjustments`, {
      employee_id: employeeId, kind: 'bonus', amount: '0.0000', reason: 'Bono vacío',
    });
    expect(zero.statusCode).toBe(400);
    const blankReason = await call('POST', `/api/v1/payroll-periods/${periodId}/adjustments`, {
      employee_id: employeeId, kind: 'bonus', amount: '10', reason: '   a  ',
    });
    expect(blankReason.statusCode).toBe(400); // trimmed to 1 character
    const noLine = await call('POST', `/api/v1/payroll-periods/${periodId}/adjustments`, {
      employee_id: randomUUID(), kind: 'bonus', amount: '10', reason: 'Empleado sin línea',
    });
    expect(noLine.statusCode).toBe(409);
    expect(noLine.json<{ error: { code: string } }>().error.code).toBe('payroll_incomplete');
  });

  it('a huge deduction can never push the total below zero (the DB check would reject it)', async () => {
    const { employeeId, periodId } = await weekWithDetail();
    await calculate(periodId);
    const response = await call('POST', `/api/v1/payroll-periods/${periodId}/adjustments`, {
      employee_id: employeeId, kind: 'deduction', amount: '999999.0000', reason: 'Deducción enorme de prueba',
    });
    expect(response.statusCode).toBe(201);
    expect(response.json<{ data: { line: LineJson } }>().data.line).toMatchObject({ adjustment_amount: '-999999.0000', total_amount: '0.0000' });
  });

  it('a CLOSED payroll is immutable: no recalculation, no adjustment, no void — and later employee edits never change its frozen detail', async () => {
    const { employeeId, periodId, week } = await weekWithDetail();
    await calculate(periodId);
    const adjustment = await call('POST', `/api/v1/payroll-periods/${periodId}/adjustments`, {
      employee_id: employeeId, kind: 'bonus', amount: '100', reason: 'Bono antes del cierre',
    });
    const adjustmentId = adjustment.json<{ data: { id: string } }>().data.id;
    const before = await detail(periodId, employeeId);

    const closed = await call('POST', `/api/v1/payroll-periods/${periodId}/close`, {});
    expect(closed.statusCode).toBe(200);

    const recalc = await calculate(periodId);
    expect(recalc.statusCode).toBe(409);
    expect(recalc.json<{ error: { code: string } }>().error.code).toBe('payroll_period_closed');
    const newAdjustment = await call('POST', `/api/v1/payroll-periods/${periodId}/adjustments`, {
      employee_id: employeeId, kind: 'bonus', amount: '1', reason: 'Después del cierre',
    });
    expect(newAdjustment.statusCode).toBe(409);
    expect(newAdjustment.json<{ error: { code: string } }>().error.code).toBe('payroll_period_closed');
    const voidAfterClose = await call('POST', `/api/v1/payroll-periods/${periodId}/adjustments/${adjustmentId}/void`, {
      reason: 'Quiero anularlo después',
    });
    expect(voidAfterClose.statusCode).toBe(409);

    // Edit the live employee (name, job title, salary) and the live schedule/punches.
    const bump = await app.inject({
      method: 'PUT',
      url: `/api/v1/employees/${employeeId}`,
      headers: { authorization: 'Bearer x', 'idempotency-key': `v2-edit-${randomUUID()}`, 'if-match': '"1"', 'content-type': 'application/json' },
      payload: { display_name: 'Nombre Nuevo', job_title: 'Gerente', weekly_salary: '9999.0000' },
    });
    expect(bump.statusCode).toBe(200);
    await punch(branchId, employeeId, 'clock_out', `${week[0] ?? '2027-01-04'}T23:00:00.000Z`);

    const after = await detail(periodId, employeeId);
    expect(after.line).toMatchObject({
      employee_name: 'Ana Pérez', // frozen snapshot, NOT the edited live name
      job_title: 'Cajera',
      base_salary_snapshot: '700.0000',
      total_amount: before.line.total_amount,
    });
    expect(after.days).toEqual(before.days);
    expect(after.adjustments).toHaveLength(1);
    expect(after.adjustments[0]?.status).toBe('active');
  });

  it('closing refuses an empty payroll, is not repeatable, and a replay of the same request is byte-identical', async () => {
    asFull();
    await createEmployee(branchId);
    const emptyId = await createPeriod(branchId, '2026-04-06', '2026-04-12');
    const refused = await call('POST', `/api/v1/payroll-periods/${emptyId}/close`, {});
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ error: { code: string } }>().error.code).toBe('payroll_incomplete');

    const { periodId } = await weekWithDetail();
    await calculate(periodId);
    const key = `v2-close-${randomUUID()}`;
    const first = await call('POST', `/api/v1/payroll-periods/${periodId}/close`, {}, key);
    expect(first.statusCode).toBe(200);
    const replay = await call('POST', `/api/v1/payroll-periods/${periodId}/close`, {}, key);
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.json<{ data: unknown }>().data).toEqual(first.json<{ data: unknown }>().data);
    const second = await call('POST', `/api/v1/payroll-periods/${periodId}/close`, {});
    expect(second.statusCode).toBe(409); // already closed: a different request is a conflict, never a silent re-close

    const audit = await database.pool.query<{ metadata: { employee_count?: number; total_amount?: string } }>(
      `select metadata from audit_log where company_id=$1 and action='payroll_period.closed' and entity_id=$2`,
      [companyId, periodId],
    );
    expect(audit.rows).toHaveLength(1); // the replay wrote nothing
    expect(audit.rows[0]?.metadata).toMatchObject({ employee_count: expect.any(Number) as number });
  });

  it('reopening demands a real reason and records it in the audit log', async () => {
    const { periodId } = await weekWithDetail();
    await calculate(periodId);
    await call('POST', `/api/v1/payroll-periods/${periodId}/close`, {});
    const blank = await call('POST', `/api/v1/payroll-periods/${periodId}/reopen`, { reason: '    ' });
    expect(blank.statusCode).toBe(400);
    const reopened = await call('POST', `/api/v1/payroll-periods/${periodId}/reopen`, {
      reason: 'Se detectó una checada fuera de lugar',
    });
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json<{ data: { status: string } }>().data.status).toBe('draft');
    const audit = await database.pool.query<{ metadata: { reason?: string } }>(
      `select metadata from audit_log where company_id=$1 and action='payroll_period.reopened' and entity_id=$2`,
      [companyId, periodId],
    );
    expect(audit.rows[0]?.metadata.reason).toBe('Se detectó una checada fuera de lugar');
  });

  it('idempotency: replaying a create/calculate/adjustment is safe and never doubles the effect; a changed payload under one key is rejected', async () => {
    const { employeeId, periodId } = await weekWithDetail();
    const calcKey = `v2-calc-${randomUUID()}`;
    const first = await calculate(periodId, calcKey);
    const replayedCalc = await calculate(periodId, calcKey);
    expect(replayedCalc.statusCode).toBe(200); // used to be a 500: replayed Dates came back as strings
    expect(replayedCalc.headers['idempotency-replayed']).toBe('true');
    expect(replayedCalc.json<{ data: { lines: LineJson[] } }>().data.lines).toEqual(first.json<{ data: { lines: LineJson[] } }>().data.lines);

    const key = `v2-adj-${randomUUID()}`;
    const body = { employee_id: employeeId, kind: 'bonus', amount: '25', reason: 'Bono idempotente' };
    const created = await call('POST', `/api/v1/payroll-periods/${periodId}/adjustments`, body, key);
    const replay = await call('POST', `/api/v1/payroll-periods/${periodId}/adjustments`, body, key);
    expect(created.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.json<{ data: { id: string } }>().data.id).toBe(created.json<{ data: { id: string } }>().data.id);
    const rows = await database.pool.query<{ count: string }>(
      'select count(*)::text count from payroll_period_adjustments where company_id=$1 and payroll_period_id=$2',
      [companyId, periodId],
    );
    expect(rows.rows[0]?.count).toBe('1'); // the double submit created ONE adjustment
    const conflict = await call('POST', `/api/v1/payroll-periods/${periodId}/adjustments`, { ...body, amount: '26' }, key);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json<{ error: { code: string } }>().error.code).toBe('idempotency_conflict');
  });

  it('concurrency: two simultaneous calculations never 500, and a close racing a calculation leaves one consistent state', async () => {
    const { employeeId, periodId } = await weekWithDetail();
    const [a, b] = await Promise.all([calculate(periodId), calculate(periodId)]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    const lines = await database.pool.query<{ count: string }>(
      'select count(*)::text count from payroll_period_lines where company_id=$1 and payroll_period_id=$2 and employee_id=$3',
      [companyId, periodId, employeeId],
    );
    expect(lines.rows[0]?.count).toBe('1');

    const [calc, close] = await Promise.all([calculate(periodId), call('POST', `/api/v1/payroll-periods/${periodId}/close`, {})]);
    expect(calc.statusCode === 200 || calc.statusCode === 409).toBe(true);
    expect(close.statusCode).toBe(200);
    const final = await get(`/api/v1/payroll-periods/${periodId}`);
    expect(final.json<{ data: { status: string; lines: LineJson[] } }>().data.status).toBe('closed');
    const days = await database.pool.query<{ count: string }>(
      'select count(*)::text count from payroll_period_line_days where company_id=$1 and payroll_period_id=$2 and employee_id=$3',
      [companyId, periodId, employeeId],
    );
    expect(days.rows[0]?.count).toBe('7'); // lines and their daily detail always move together
  });

  it('permissions: reading needs payroll.read, adjusting needs payroll.manage, closing/reopening needs payroll.close', async () => {
    const { employeeId, periodId } = await weekWithDetail();
    await calculate(periodId);
    const adjustmentPayload = { employee_id: employeeId, kind: 'bonus', amount: '5', reason: 'Prueba de permisos' };

    authContext = contextFor(companyId, bothBranches, userId, ['employee.read']);
    expect((await get(`/api/v1/payroll-periods/${periodId}/employees/${employeeId}`)).statusCode).toBe(403);
    expect((await get(`/api/v1/payroll-periods/${periodId}/adjustments`)).statusCode).toBe(403);

    authContext = contextFor(companyId, bothBranches, userId, ['payroll.read']);
    expect((await detail(periodId, employeeId)).status).toBe(200);
    expect((await call('POST', `/api/v1/payroll-periods/${periodId}/adjustments`, adjustmentPayload)).statusCode).toBe(403);

    authContext = contextFor(companyId, bothBranches, userId, ['payroll.read', 'payroll.manage']);
    const created = await call('POST', `/api/v1/payroll-periods/${periodId}/adjustments`, adjustmentPayload);
    expect(created.statusCode).toBe(201);
    const adjustmentId = created.json<{ data: { id: string } }>().data.id;
    expect((await call('POST', `/api/v1/payroll-periods/${periodId}/close`, {})).statusCode).toBe(403);
    expect((await call('POST', `/api/v1/payroll-periods/${periodId}/reopen`, { reason: 'No debería poder' })).statusCode).toBe(403);

    authContext = contextFor(companyId, bothBranches, userId, ['payroll.read']);
    expect(
      (await call('POST', `/api/v1/payroll-periods/${periodId}/adjustments/${adjustmentId}/void`, { reason: 'Sin permiso' })).statusCode,
    ).toBe(403);
    asFull();
  });

  it('branch scope: an actor without access to the period\'s branch cannot read, adjust or void anything in it (404, never a leak)', async () => {
    asFull();
    const employeeId = await createEmployee(secondBranchId, { display_name: 'Otra Sucursal' });
    const periodId = await createPeriod(secondBranchId, '2026-05-04', '2026-05-10');
    const calculated = await calculate(periodId);
    expect(calculated.statusCode).toBe(200);
    expect(lineOf(calculated, employeeId).employee_name).toBe('Otra Sucursal');
    const adjustment = await call('POST', `/api/v1/payroll-periods/${periodId}/adjustments`, {
      employee_id: employeeId, kind: 'bonus', amount: '10', reason: 'Bono en otra sucursal',
    });
    expect(adjustment.statusCode).toBe(201);
    const adjustmentId = adjustment.json<{ data: { id: string } }>().data.id;

    // Same company, but only the first branch is permitted.
    authContext = contextFor(companyId, [branchId], userId, fullPermissions);
    expect((await get(`/api/v1/payroll-periods/${periodId}/employees/${employeeId}`)).statusCode).toBe(404);
    expect((await get(`/api/v1/payroll-periods/${periodId}/adjustments`)).statusCode).toBe(404);
    expect(
      (await call('POST', `/api/v1/payroll-periods/${periodId}/adjustments`, {
        employee_id: employeeId, kind: 'bonus', amount: '10', reason: 'Intento sin acceso',
      })).statusCode,
    ).toBe(404);
    expect(
      (await call('POST', `/api/v1/payroll-periods/${periodId}/adjustments/${adjustmentId}/void`, { reason: 'Intento sin acceso' })).statusCode,
    ).toBe(404);
    expect((await call('POST', `/api/v1/payroll-periods/${periodId}/close`, {})).statusCode).toBe(404);
    asFull();
  });

  it('company isolation: another company can neither read nor change this company\'s payroll through the new routes', async () => {
    asFull();
    const { employeeId, periodId } = await weekWithDetail();
    await calculate(periodId);
    const adjustment = await call('POST', `/api/v1/payroll-periods/${periodId}/adjustments`, {
      employee_id: employeeId, kind: 'bonus', amount: '10', reason: 'Bono de la empresa A',
    });
    const adjustmentId = adjustment.json<{ data: { id: string } }>().data.id;

    authContext = contextFor(otherCompanyId, [otherCompanyBranchId], otherCompanyUserId, fullPermissions);
    expect((await get(`/api/v1/payroll-periods/${periodId}/employees/${employeeId}`)).statusCode).toBe(404);
    expect((await get(`/api/v1/payroll-periods/${periodId}/adjustments`)).statusCode).toBe(404);
    expect(
      (await call('POST', `/api/v1/payroll-periods/${periodId}/adjustments`, {
        employee_id: employeeId, kind: 'deduction', amount: '10', reason: 'Intento de otra empresa',
      })).statusCode,
    ).toBe(404);
    expect(
      (await call('POST', `/api/v1/payroll-periods/${periodId}/adjustments/${adjustmentId}/void`, { reason: 'Intento de otra empresa' })).statusCode,
    ).toBe(404);
    asFull();
    const untouched = await detail(periodId, employeeId);
    expect(untouched.adjustments).toHaveLength(1);
    expect(untouched.adjustments[0]?.status).toBe('active');
  });

  it('closed payroll totals stay consistent for reports: the sum of line totals already includes the adjustments', async () => {
    const { employeeId, periodId } = await weekWithDetail();
    await calculate(periodId);
    await call('POST', `/api/v1/payroll-periods/${periodId}/adjustments`, {
      employee_id: employeeId, kind: 'bonus', amount: '300', reason: 'Bono para el reporte',
    });
    await call('POST', `/api/v1/payroll-periods/${periodId}/close`, {});
    const total = await database.pool.query<{ total: string }>(
      `select coalesce(sum(l.total_amount),0)::text total
       from payroll_period_lines l join payroll_periods p on p.company_id=l.company_id and p.id=l.payroll_period_id
       where l.company_id=$1 and p.id=$2 and l.employee_id=$3 and p.status='closed'`,
      [companyId, periodId, employeeId],
    );
    expect(total.rows[0]?.total).toBe('999.0278'); // 699.0278 formula + 300.0000 adjustment

    // The server's own column totals agree with the stored lines (the client never adds money).
    const sqlTotal = await database.pool.query<{ total: string; adjustment: string }>(
      `select coalesce(sum(total_amount),0)::text total, coalesce(sum(adjustment_amount),0)::text adjustment
       from payroll_period_lines where company_id=$1 and payroll_period_id=$2`,
      [companyId, periodId],
    );
    const period = await get(`/api/v1/payroll-periods/${periodId}`);
    const totals = period.json<{ data: { totals: { currency_code: string; total: string; adjustment: string; employee_count: number }[] } }>().data.totals;
    expect(totals).toHaveLength(1);
    expect(totals[0]).toMatchObject({ currency_code: 'MXN' });
    expect(Number(totals[0]?.total)).toBeCloseTo(Number(sqlTotal.rows[0]?.total), 4);
    expect(Number(totals[0]?.adjustment)).toBeCloseTo(Number(sqlTotal.rows[0]?.adjustment), 4);
  });
});
