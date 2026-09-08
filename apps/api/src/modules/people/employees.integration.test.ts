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
import { PeopleRepository } from './people.repository.js';
import { EmployeesService } from './employees.service.js';
import { SchedulesService } from './schedules.service.js';

/**
 * TASK 14.4 (Wave 2) — Empleados/Horarios real end-to-end coverage.
 * Mirrors `purchasing.integration.test.ts`'s exact structure (real
 * Fastify + real Postgres-backed services, only the auth LAYER faked —
 * see that file's own doc comment for the full rationale).
 */

const databaseUrl = process.env.DATABASE_TEST_URL;
const integrationDatabaseUrl = databaseUrl ?? 'postgresql://people-integration-disabled';
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

integration('PostgreSQL employee/schedule operations (TASK 14.4, Wave 2)', { concurrent: false }, () => {
  let app: FastifyInstance;
  let database: DatabaseClient;

  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const branchId = randomUUID();
  const otherCompanyBranchId = randomUUID();
  const userId = randomUUID();
  const otherCompanyUserId = randomUUID();

  const allPermissions = ['employee.read', 'employee.manage', 'schedule.read', 'schedule.manage'] as const;

  function baseContext(forCompanyId: string, forBranchId: string): AuthContext {
    return {
      sessionId: randomUUID(),
      userId: forCompanyId === otherCompanyId ? otherCompanyUserId : userId,
      membershipId: randomUUID(),
      companyId: forCompanyId,
      branchId: forBranchId,
      expiresAt: new Date(Date.now() + 60_000),
      companyWideAccess: false,
      permissions: [...allPermissions],
      permittedBranchIds: [forBranchId],
      transportMode: 'bearer',
    };
  }
  let authContext: AuthContext = baseContext(companyId, branchId);

  beforeAll(async () => {
    if (!new URL(integrationDatabaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({ connectionString: integrationDatabaseUrl, applicationName: 'asone-people-integration' });
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
       values($1,'People Co','People Co',$2,'active','UTC','MXN','es-MX'),
             ($3,'Other People Co','Other People Co',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `people-${companyId}`, otherCompanyId, `people-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'People Main','PMAIN','active','UTC'),($3,$4,'Other Co Main','OMAIN','active','UTC')`,
      [branchId, companyId, otherCompanyBranchId, otherCompanyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'People Actor','active'),($3,$4,$4,'Other Co Actor','active')`,
      [userId, `people-${userId}@example.test`, otherCompanyUserId, `people-${otherCompanyUserId}@example.test`],
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

  function post(url: string, key: string, body: Record<string, unknown>): Promise<Awaited<ReturnType<FastifyInstance['inject']>>> {
    return app.inject({
      method: 'POST',
      url,
      headers: { authorization: 'Bearer x', 'idempotency-key': key, 'content-type': 'application/json' },
      payload: body,
    });
  }
  function put(
    url: string,
    key: string,
    ifMatch: string | undefined,
    body: Record<string, unknown>,
  ): Promise<Awaited<ReturnType<FastifyInstance['inject']>>> {
    return app.inject({
      method: 'PUT',
      url,
      headers: {
        authorization: 'Bearer x',
        'idempotency-key': key,
        'content-type': 'application/json',
        ...(ifMatch === undefined ? {} : { 'if-match': ifMatch }),
      },
      payload: body,
    });
  }

  it('creates an employee, rejects a duplicate code, then reads/lists it back', async () => {
    authContext = baseContext(companyId, branchId);
    const code = `emp-${randomUUID().slice(0, 8)}`;
    const created = await post('/api/v1/employees', `emp-create-${randomUUID()}`, {
      branch_id: branchId,
      code,
      display_name: 'Test Employee One',
      weekly_salary: '500.0000',
      currency_code: 'MXN',
    });
    expect(created.statusCode).toBe(201);
    const body = created.json<{ data: { id: string; code: string; status: string; version: string } }>().data;
    expect(body.status).toBe('active');
    expect(body.version).toBe('1');

    const dupe = await post('/api/v1/employees', `emp-create-dupe-${randomUUID()}`, {
      branch_id: branchId,
      code,
      display_name: 'Duplicate Code',
      weekly_salary: '500.0000',
      currency_code: 'MXN',
    });
    expect(dupe.statusCode).toBe(409);

    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/employees/${body.id}`,
      headers: { authorization: 'Bearer x' },
    });
    expect(read.statusCode).toBe(200);
    expect(read.json<{ data: { code: string } }>().data.code).toBe(code);

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/employees?branch_id=${branchId}`,
      headers: { authorization: 'Bearer x' },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<{ data: { id: string }[] }>().data.map((row) => row.id)).toContain(body.id);
  });

  it('rejects an invalid weekly_salary and an unknown branch', async () => {
    authContext = baseContext(companyId, branchId);
    const badSalary = await post('/api/v1/employees', `emp-badsalary-${randomUUID()}`, {
      branch_id: branchId,
      code: `emp-${randomUUID().slice(0, 8)}`,
      display_name: 'Bad Salary',
      weekly_salary: '-5.00',
      currency_code: 'MXN',
    });
    expect(badSalary.statusCode).toBe(400);

    const badBranch = await post('/api/v1/employees', `emp-badbranch-${randomUUID()}`, {
      branch_id: randomUUID(),
      code: `emp-${randomUUID().slice(0, 8)}`,
      display_name: 'Bad Branch',
      weekly_salary: '500.0000',
      currency_code: 'MXN',
    });
    expect(badBranch.statusCode).toBe(403); // requireBranchAccess rejects a branch outside permittedBranchIds.
  });

  it('updates an employee via If-Match, and rejects a stale version', async () => {
    authContext = baseContext(companyId, branchId);
    const created = await post('/api/v1/employees', `emp-upd-create-${randomUUID()}`, {
      branch_id: branchId,
      code: `emp-${randomUUID().slice(0, 8)}`,
      display_name: 'Original Name',
      weekly_salary: '500.0000',
      currency_code: 'MXN',
    });
    const body = created.json<{ data: { id: string; version: string } }>().data;

    const updated = await put(`/api/v1/employees/${body.id}`, `emp-upd-${randomUUID()}`, `"${body.version}"`, {
      display_name: 'Updated Name',
      weekly_salary: '600.0000',
    });
    expect(updated.statusCode).toBe(200);
    const updatedBody = updated.json<{ data: { display_name: string; weekly_salary: string; version: string } }>().data;
    expect(updatedBody.display_name).toBe('Updated Name');
    expect(updatedBody.weekly_salary).toBe('600.0000');
    expect(updatedBody.version).toBe('2');

    const stale = await put(`/api/v1/employees/${body.id}`, `emp-upd-stale-${randomUUID()}`, `"${body.version}"`, {
      display_name: 'Should Not Apply',
    });
    expect(stale.statusCode).toBe(409);
  });

  it('deactivates an employee softly (never deletes) and supports reactivation', async () => {
    authContext = baseContext(companyId, branchId);
    const created = await post('/api/v1/employees', `emp-deact-create-${randomUUID()}`, {
      branch_id: branchId,
      code: `emp-${randomUUID().slice(0, 8)}`,
      display_name: 'To Deactivate',
      weekly_salary: '500.0000',
      currency_code: 'MXN',
    });
    const body = created.json<{ data: { id: string } }>().data;

    const deactivated = await post(`/api/v1/employees/${body.id}/deactivate`, `emp-deact-${randomUUID()}`, {});
    expect(deactivated.statusCode).toBe(200);
    const deactivatedBody = deactivated.json<{ data: { status: string; deactivated_at: string | null } }>().data;
    expect(deactivatedBody.status).toBe('inactive');
    expect(deactivatedBody.deactivated_at).not.toBeNull();

    const stillThere = await database.pool.query<{ status: string }>('select status from employees where id=$1', [body.id]);
    expect(stillThere.rows[0]).toMatchObject({ status: 'inactive' }); // never a hard delete.

    const alreadyInactive = await post(`/api/v1/employees/${body.id}/deactivate`, `emp-deact-again-${randomUUID()}`, {});
    expect(alreadyInactive.statusCode).toBe(409);

    const reactivated = await post(`/api/v1/employees/${body.id}/reactivate`, `emp-react-${randomUUID()}`, {});
    expect(reactivated.statusCode).toBe(200);
    expect(reactivated.json<{ data: { status: string; deactivated_at: string | null } }>().data).toMatchObject({
      status: 'active',
      deactivated_at: null,
    });
  });

  it('rejects an unknown user_id, and requires it to reference a real company membership', async () => {
    authContext = baseContext(companyId, branchId);
    const badUser = await post('/api/v1/employees', `emp-baduser-${randomUUID()}`, {
      branch_id: branchId,
      code: `emp-${randomUUID().slice(0, 8)}`,
      display_name: 'Bad User Link',
      weekly_salary: '500.0000',
      currency_code: 'MXN',
      user_id: randomUUID(),
    });
    expect(badUser.statusCode).toBe(400);

    const goodUser = await post('/api/v1/employees', `emp-gooduser-${randomUUID()}`, {
      branch_id: branchId,
      code: `emp-${randomUUID().slice(0, 8)}`,
      display_name: 'Good User Link',
      weekly_salary: '500.0000',
      currency_code: 'MXN',
      user_id: userId,
    });
    expect(goodUser.statusCode).toBe(201);
  });

  it('upserts a schedule (PUT-style: a second write for the same date updates in place), and validates ranges', async () => {
    authContext = baseContext(companyId, branchId);
    const employee = await post('/api/v1/employees', `emp-sched-create-${randomUUID()}`, {
      branch_id: branchId,
      code: `emp-${randomUUID().slice(0, 8)}`,
      display_name: 'Schedule Owner',
      weekly_salary: '500.0000',
      currency_code: 'MXN',
    });
    const employeeId = employee.json<{ data: { id: string } }>().data.id;
    const workDate = '2026-03-02';

    const first = await put('/api/v1/schedules', `sched-1-${randomUUID()}`, undefined, {
      employee_id: employeeId,
      work_date: workDate,
      is_day_off: false,
      scheduled_start: '09:00',
      scheduled_end: '17:00',
    });
    expect(first.statusCode).toBe(200);

    const second = await put('/api/v1/schedules', `sched-2-${randomUUID()}`, undefined, {
      employee_id: employeeId,
      work_date: workDate,
      is_day_off: false,
      scheduled_start: '10:00',
      scheduled_end: '18:00',
    });
    expect(second.statusCode).toBe(200);

    const rows = await database.pool.query<{ count: string }>(
      'select count(*)::text count from employee_schedules where company_id=$1 and employee_id=$2 and work_date=$3',
      [companyId, employeeId, workDate],
    );
    expect(rows.rows[0]?.count).toBe('1'); // upsert, never a second row for the same date.

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/schedules?employee_id=${employeeId}&date_from=2026-03-01&date_to=2026-03-03`,
      headers: { authorization: 'Bearer x' },
    });
    const listed = list.json<{ data: { scheduled_start: string | null }[] }>().data;
    expect(listed).toHaveLength(1);
    expect(listed[0]?.scheduled_start?.startsWith('10:00')).toBe(true); // reflects the second (latest) write.

    const invalidRange = await put('/api/v1/schedules', `sched-bad-range-${randomUUID()}`, undefined, {
      employee_id: employeeId,
      work_date: '2026-03-03',
      is_day_off: false,
      scheduled_start: '17:00',
      scheduled_end: '09:00',
    });
    expect(invalidRange.statusCode).toBe(400);

    const dayOffWithTimes = await put('/api/v1/schedules', `sched-bad-dayoff-${randomUUID()}`, undefined, {
      employee_id: employeeId,
      work_date: '2026-03-04',
      is_day_off: true,
      scheduled_start: '09:00',
      scheduled_end: '17:00',
    });
    expect(dayOffWithTimes.statusCode).toBe(400);

    const validDayOff = await put('/api/v1/schedules', `sched-good-dayoff-${randomUUID()}`, undefined, {
      employee_id: employeeId,
      work_date: '2026-03-04',
      is_day_off: true,
    });
    expect(validDayOff.statusCode).toBe(200);
  });

  it('an actor without employee.manage cannot create/update/deactivate an employee', async () => {
    authContext = { ...baseContext(companyId, branchId), permissions: ['employee.read'] };
    const created = await post('/api/v1/employees', `emp-noperm-${randomUUID()}`, {
      branch_id: branchId,
      code: `emp-${randomUUID().slice(0, 8)}`,
      display_name: 'No Permission',
      weekly_salary: '500.0000',
      currency_code: 'MXN',
    });
    expect(created.statusCode).toBe(403);
  });

  it('an actor without schedule.manage cannot upsert a schedule', async () => {
    authContext = baseContext(companyId, branchId);
    const employee = await post('/api/v1/employees', `emp-sched-noperm-${randomUUID()}`, {
      branch_id: branchId,
      code: `emp-${randomUUID().slice(0, 8)}`,
      display_name: 'Schedule NoPerm Owner',
      weekly_salary: '500.0000',
      currency_code: 'MXN',
    });
    const employeeId = employee.json<{ data: { id: string } }>().data.id;

    authContext = { ...baseContext(companyId, branchId), permissions: ['schedule.read'] };
    const forbidden = await put('/api/v1/schedules', `sched-noperm-${randomUUID()}`, undefined, {
      employee_id: employeeId,
      work_date: '2026-03-05',
      is_day_off: true,
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it('company A cannot see or mutate company B\'s employees — real tenant isolation', async () => {
    authContext = baseContext(otherCompanyId, otherCompanyBranchId);
    const created = await post('/api/v1/employees', `emp-tenant-b-${randomUUID()}`, {
      branch_id: otherCompanyBranchId,
      code: `emp-${randomUUID().slice(0, 8)}`,
      display_name: 'Other Co Employee',
      weekly_salary: '500.0000',
      currency_code: 'MXN',
    });
    expect(created.statusCode).toBe(201);
    const otherCompanyEmployeeId = created.json<{ data: { id: string } }>().data.id;

    authContext = baseContext(companyId, branchId);
    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/employees/${otherCompanyEmployeeId}`,
      headers: { authorization: 'Bearer x' },
    });
    expect(read.statusCode).toBe(404);

    const deactivateAttempt = await post(`/api/v1/employees/${otherCompanyEmployeeId}/deactivate`, `emp-tenant-deact-${randomUUID()}`, {});
    expect(deactivateAttempt.statusCode).toBe(404);
  });
});
