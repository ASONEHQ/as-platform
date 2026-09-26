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
import { registerTimeClockRoutes } from './time-clock.routes.js';
import { PeopleRepository } from './people.repository.js';
import { EmployeesService } from './employees.service.js';
import { TimeClockService } from './time-clock.service.js';

/**
 * TASK 14.4 (Wave 2) — Checador real end-to-end coverage. Mirrors
 * `purchasing.integration.test.ts`'s exact structure.
 */

const databaseUrl = process.env.DATABASE_TEST_URL;
const integrationDatabaseUrl = databaseUrl ?? 'postgresql://people-timeclock-integration-disabled';
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

integration('PostgreSQL time-clock operations (TASK 14.4, Wave 2)', { concurrent: false }, () => {
  let app: FastifyInstance;
  let database: DatabaseClient;

  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const branchId = randomUUID();
  const otherCompanyBranchId = randomUUID();
  const managerUserId = randomUUID();
  const selfServiceUserId = randomUUID();
  const otherCompanyUserId = randomUUID();

  let employeeId = '';
  let selfServiceEmployeeId = '';

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
  let authContext: AuthContext = contextFor(companyId, branchId, managerUserId, [
    'employee.manage',
    'employee.read',
    'attendance.read',
    'attendance.manage',
  ]);

  beforeAll(async () => {
    if (!new URL(integrationDatabaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({ connectionString: integrationDatabaseUrl, applicationName: 'asone-people-timeclock-integration' });
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
       values($1,'TC Co','TC Co',$2,'active','UTC','MXN','es-MX'),
             ($3,'Other TC Co','Other TC Co',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `tc-${companyId}`, otherCompanyId, `tc-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'TC Main','TCMAIN','active','UTC'),($3,$4,'Other Co Main','TCOMAIN','active','UTC')`,
      [branchId, companyId, otherCompanyBranchId, otherCompanyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'Manager Actor','active'),($3,$4,$4,'Self Service Actor','active'),($5,$6,$6,'Other Co Actor','active')`,
      [
        managerUserId,
        `tc-manager-${managerUserId}@example.test`,
        selfServiceUserId,
        `tc-self-${selfServiceUserId}@example.test`,
        otherCompanyUserId,
        `tc-other-${otherCompanyUserId}@example.test`,
      ],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status)
       values($1,$2,$3,'active'),($4,$2,$5,'active'),($6,$7,$8,'active')`,
      [randomUUID(), companyId, managerUserId, randomUUID(), selfServiceUserId, randomUUID(), otherCompanyId, otherCompanyUserId],
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
    registerTimeClockRoutes(app, authentication, new TimeClockService(repository));
    await app.ready();

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/employees',
      headers: { authorization: 'Bearer x', 'idempotency-key': `tc-emp-${randomUUID()}`, 'content-type': 'application/json' },
      payload: { branch_id: branchId, code: `tc-emp-${randomUUID().slice(0, 8)}`, display_name: 'Punch Target', weekly_salary: '500.0000', currency_code: 'MXN' },
    });
    employeeId = created.json<{ data: { id: string } }>().data.id;

    const createdSelf = await app.inject({
      method: 'POST',
      url: '/api/v1/employees',
      headers: { authorization: 'Bearer x', 'idempotency-key': `tc-emp-self-${randomUUID()}`, 'content-type': 'application/json' },
      payload: {
        branch_id: branchId,
        code: `tc-emp-self-${randomUUID().slice(0, 8)}`,
        display_name: 'Self Service Employee',
        weekly_salary: '500.0000',
        currency_code: 'MXN',
        user_id: selfServiceUserId,
      },
    });
    selfServiceEmployeeId = createdSelf.json<{ data: { id: string } }>().data.id;
  });

  afterAll(async () => {
    await app.close();
    const ids = [companyId, otherCompanyId];
    await database.pool.query('delete from time_clock_punches where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from employee_schedules where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from employees where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from idempotency_keys where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from outbox_events where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from audit_log where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from company_memberships where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from branches where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from companies where id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from users where id=any($1::uuid[])', [[managerUserId, selfServiceUserId, otherCompanyUserId]]);
    await database.close();
  });

  function punch(url: string, key: string, body: Record<string, unknown>): Promise<Awaited<ReturnType<FastifyInstance['inject']>>> {
    return app.inject({
      method: 'POST',
      url,
      headers: { authorization: 'Bearer x', 'idempotency-key': key, 'content-type': 'application/json' },
      payload: body,
    });
  }

  it('clocks in, rejects a duplicate clock-in, then clocks out', async () => {
    authContext = contextFor(companyId, branchId, managerUserId, ['attendance.read', 'attendance.manage']);
    const in1 = await punch('/api/v1/time-clock/clock-in', `tc-in-${randomUUID()}`, { employee_id: employeeId });
    expect(in1.statusCode).toBe(201);
    expect(in1.json<{ data: { punch_type: string } }>().data.punch_type).toBe('clock_in');

    const in2 = await punch('/api/v1/time-clock/clock-in', `tc-in2-${randomUUID()}`, { employee_id: employeeId });
    expect(in2.statusCode).toBe(409);
    expect(in2.json<{ error: { code: string } }>().error.code).toBe('duplicate_clock_in');

    const out1 = await punch('/api/v1/time-clock/clock-out', `tc-out-${randomUUID()}`, { employee_id: employeeId });
    expect(out1.statusCode).toBe(201);
    expect(out1.json<{ data: { punch_type: string } }>().data.punch_type).toBe('clock_out');
  });

  // TASK 16.28 — every punch recorded through these ordinary routes is
  // honestly labeled 'manual' (no attendance terminal/fingerprint reader
  // exists yet — see docs/WORKFORCE_SYSTEM.md); this is the real, stored
  // column, never a value the client can influence.
  it('records every ordinary punch and correction with method "manual"', async () => {
    authContext = contextFor(companyId, branchId, managerUserId, ['attendance.read', 'attendance.manage']);
    const in1 = await punch('/api/v1/time-clock/clock-in', `tc-method-in-${randomUUID()}`, { employee_id: employeeId });
    expect(in1.json<{ data: { method: string } }>().data.method).toBe('manual');

    const out1 = await punch('/api/v1/time-clock/clock-out', `tc-method-out-${randomUUID()}`, { employee_id: employeeId });
    expect(out1.json<{ data: { method: string } }>().data.method).toBe('manual');

    const correction = await punch('/api/v1/time-clock/corrections', `tc-method-corr-${randomUUID()}`, {
      employee_id: employeeId,
      punch_type: 'clock_out',
      occurred_at: '2026-04-01T18:00:00.000Z',
      correction_reason: 'Testing method labeling on a correction row.',
      corrected_punch_id: out1.json<{ data: { id: string } }>().data.id,
    });
    expect(correction.json<{ data: { method: string } }>().data.method).toBe('manual');
  });

  it('rejects a clock-out with no open clock-in', async () => {
    authContext = contextFor(companyId, branchId, managerUserId, ['attendance.read', 'attendance.manage']);
    // employeeId already clocked out at the end of the previous test — no open clock-in remains.
    const out = await punch('/api/v1/time-clock/clock-out', `tc-invalid-out-${randomUUID()}`, { employee_id: employeeId });
    expect(out.statusCode).toBe(409);
    expect(out.json<{ error: { code: string } }>().error.code).toBe('invalid_clock_out');
  });

  it('lets the linked employee self-service clock in/out with only attendance.read', async () => {
    authContext = contextFor(companyId, branchId, selfServiceUserId, ['attendance.read']);
    const in1 = await punch('/api/v1/time-clock/clock-in', `tc-self-in-${randomUUID()}`, { employee_id: selfServiceEmployeeId });
    expect(in1.statusCode).toBe(201);
    const out1 = await punch('/api/v1/time-clock/clock-out', `tc-self-out-${randomUUID()}`, { employee_id: selfServiceEmployeeId });
    expect(out1.statusCode).toBe(201);
  });

  it('rejects a punch attempt by a user who is neither the linked employee nor attendance.manage', async () => {
    authContext = contextFor(companyId, branchId, managerUserId, ['attendance.read']); // no attendance.manage, not the linked user.
    const attempt = await punch('/api/v1/time-clock/clock-in', `tc-denied-${randomUUID()}`, { employee_id: selfServiceEmployeeId });
    expect(attempt.statusCode).toBe(403);
    expect(attempt.json<{ error: { code: string } }>().error.code).toBe('permission_denied');
  });

  it('an authorized correction inserts a NEW row and never mutates the original', async () => {
    authContext = contextFor(companyId, branchId, managerUserId, ['attendance.read', 'attendance.manage']);
    const in1 = await punch('/api/v1/time-clock/clock-in', `tc-corr-in-${randomUUID()}`, { employee_id: employeeId });
    const originalId = in1.json<{ data: { id: string; occurred_at: string } }>().data.id;
    const originalOccurredAt = in1.json<{ data: { occurred_at: string } }>().data.occurred_at;
    await punch('/api/v1/time-clock/clock-out', `tc-corr-out-${randomUUID()}`, { employee_id: employeeId }); // close it so state stays clean.

    const correction = await punch('/api/v1/time-clock/corrections', `tc-corr-${randomUUID()}`, {
      employee_id: employeeId,
      punch_type: 'clock_in',
      occurred_at: '2026-04-01T09:00:00.000Z',
      correction_reason: 'Employee forgot to badge in on time; manager verified via camera footage.',
      corrected_punch_id: originalId,
    });
    expect(correction.statusCode).toBe(201);
    const correctionBody = correction.json<{ data: { is_correction: boolean; corrected_punch_id: string; occurred_at: string } }>().data;
    expect(correctionBody.is_correction).toBe(true);
    expect(correctionBody.corrected_punch_id).toBe(originalId);
    expect(correctionBody.occurred_at).toBe('2026-04-01T09:00:00.000Z');

    const originalRow = await database.pool.query<{ occurred_at: Date; is_correction: string; punch_type: string }>(
      'select occurred_at,is_correction,punch_type from time_clock_punches where id=$1',
      [originalId],
    );
    expect(originalRow.rows[0]?.is_correction).toBe('false'); // the original row is NEVER updated.
    expect(originalRow.rows[0]?.punch_type).toBe('clock_in');
    expect(new Date(originalRow.rows[0]?.occurred_at ?? 0).toISOString()).toBe(originalOccurredAt);
  });

  it('a correction requires attendance.manage even for the employee\'s own linked user', async () => {
    authContext = contextFor(companyId, branchId, selfServiceUserId, ['attendance.read']);
    const attempt = await punch('/api/v1/time-clock/corrections', `tc-corr-noperm-${randomUUID()}`, {
      employee_id: selfServiceEmployeeId,
      punch_type: 'clock_in',
      occurred_at: '2026-04-01T09:00:00.000Z',
      correction_reason: 'Self-correction attempt.',
      corrected_punch_id: randomUUID(),
    });
    expect(attempt.statusCode).toBe(403);
  });

  it('an inactive employee cannot clock in', async () => {
    authContext = contextFor(companyId, branchId, managerUserId, ['employee.manage', 'employee.read']);
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/employees',
      headers: { authorization: 'Bearer x', 'idempotency-key': `tc-inactive-emp-${randomUUID()}`, 'content-type': 'application/json' },
      payload: { branch_id: branchId, code: `tc-inactive-${randomUUID().slice(0, 8)}`, display_name: 'Soon Inactive', weekly_salary: '400.0000', currency_code: 'MXN' },
    });
    const inactiveEmployeeId = created.json<{ data: { id: string } }>().data.id;
    const deactivateResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/employees/${inactiveEmployeeId}/deactivate`,
      headers: { authorization: 'Bearer x', 'idempotency-key': `tc-deact-${randomUUID()}`, 'content-type': 'application/json' },
      payload: {},
    });
    expect(deactivateResponse.statusCode).toBe(200);

    authContext = contextFor(companyId, branchId, managerUserId, ['attendance.read', 'attendance.manage']);
    const attempt = await punch('/api/v1/time-clock/clock-in', `tc-inactive-in-${randomUUID()}`, { employee_id: inactiveEmployeeId });
    expect(attempt.statusCode).toBe(409);
    expect(attempt.json<{ error: { code: string } }>().error.code).toBe('employee_inactive');
  });

  it('company A cannot punch or read company B\'s employee attendance', async () => {
    authContext = contextFor(otherCompanyId, otherCompanyBranchId, otherCompanyUserId, [
      'employee.manage',
      'attendance.read',
      'attendance.manage',
    ]);
    const otherEmployee = await app.inject({
      method: 'POST',
      url: '/api/v1/employees',
      headers: { authorization: 'Bearer x', 'idempotency-key': `tc-otherco-emp-${randomUUID()}`, 'content-type': 'application/json' },
      payload: { branch_id: otherCompanyBranchId, code: `tc-otherco-${randomUUID().slice(0, 8)}`, display_name: 'Other Co Punch Target', weekly_salary: '500.0000', currency_code: 'MXN' },
    });
    const otherEmployeeId = otherEmployee.json<{ data: { id: string } }>().data.id;

    authContext = contextFor(companyId, branchId, managerUserId, ['attendance.read', 'attendance.manage']);
    const attempt = await punch('/api/v1/time-clock/clock-in', `tc-tenant-${randomUUID()}`, { employee_id: otherEmployeeId });
    expect(attempt.statusCode).toBe(404);

    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/time-clock/punches?employee_id=${otherEmployeeId}`,
      headers: { authorization: 'Bearer x' },
    });
    // The employee itself is invisible cross-tenant, so the punch list is simply empty — never another
    // tenant's rows leaking through.
    expect(read.statusCode).toBe(200);
    expect(read.json<{ data: unknown[] }>().data).toHaveLength(0);
  });

  // TASK 16.29 — the Checador "Checadas de hoy"/"Historial de asistencia"
  // panels need every employee's punches for the branch in ONE call — see
  // `PeopleRepository.listPunchesForBranch`'s own doc comment. Placed
  // last in this file deliberately: every earlier test's own
  // open/closed-punch invariants for `employeeId`/`selfServiceEmployeeId`
  // are irrelevant here (this test only asserts on employee_id presence,
  // never punch counts), so it cannot disturb any prior test's ordering
  // assumptions.
  it('lists every employee\'s punches for the branch in one call, and rejects an unauthorized branch_id', async () => {
    authContext = contextFor(companyId, branchId, managerUserId, ['attendance.read', 'attendance.manage']);

    const listed = await app.inject({
      method: 'GET',
      url: `/api/v1/time-clock/punches/branch?branch_id=${branchId}`,
      headers: { authorization: 'Bearer x' },
    });
    expect(listed.statusCode).toBe(200);
    // Both employees this describe block created punched at least once in
    // earlier tests — a real, multi-employee, single-call aggregation.
    const employeeIds = listed.json<{ data: { employee_id: string }[] }>().data.map((row) => row.employee_id);
    expect(employeeIds).toContain(employeeId);
    expect(employeeIds).toContain(selfServiceEmployeeId);

    // A branch outside this actor's own permittedBranchIds is honestly
    // rejected, never silently scoped down to something else.
    const denied = await app.inject({
      method: 'GET',
      url: `/api/v1/time-clock/punches/branch?branch_id=${otherCompanyBranchId}`,
      headers: { authorization: 'Bearer x' },
    });
    expect(denied.statusCode).toBe(404);
  });
});
