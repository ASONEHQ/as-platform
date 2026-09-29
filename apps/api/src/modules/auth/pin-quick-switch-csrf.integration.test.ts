/// TASK 17.5.1 — the real production bug: a PIN configured from Usuarios
/// -> Acceso -> PIN de acceso did not authenticate on "Volver a modo
/// Cajero", even after TASK 17.4.5's frontend input-validation fix
/// shipped. `auth.pin-qr.integration.test.ts` already proves the
/// SERVICE-layer round trip (`AuthService.setStaffPin` ->
/// `AuthService.pinLogin`) works — but that file calls the service
/// directly, which never exercises the ROUTE-layer `requireApprovedOrigin`/
/// `AuthService.verifyCsrf` guard that only runs for a `transportMode:
/// 'browser'` session (`auth.routes.ts`'s `/pin-login` handler). Every
/// real ACCESS GO web session IS `transportMode: 'browser'`
/// (`auth_gateway.dart`'s own `login()` always sends
/// `transport_mode: 'browser'`), and `PosAuthGateway.pinLogin`/`qrLogin`
/// (the client `_CajeroReturnAuthDialog`/`_StaffQuickSwitchDialog` use)
/// never attached an `X-CSRF-Token` header — unlike
/// `ApiAuthGateway.switchByPin`, the OTHER Flutter client for this same
/// endpoint, which always did. This is the real, previously-unproven root
/// cause: this file drives the actual Fastify routes end to end (real
/// Postgres, real `PostgresAuthRepository`, real `AuthService`, real
/// security/CORS/error-handler plugins — never a fake gateway) to prove
/// it fails exactly as production did, then that the fix (attaching the
/// real CSRF token, mirroring `ApiAuthGateway`) makes the exact same
/// round trip succeed.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { FastifyInstance } from 'fastify';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadApiConfig, type ApiConfig } from '@asone/config';
import { createDatabaseClient, type DatabaseClient } from '@asone/database';

import { buildApp } from '../../app.js';
import type { InfrastructureDependencies } from '../../infrastructure/dependencies.js';
import { hashPassword } from './auth.passwords.js';
import { PostgresAuthRepository } from './auth.repository.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const integrationDatabaseUrl = databaseUrl ?? 'postgresql://pin-csrf-test-disabled';
const integration = databaseUrl === undefined ? describe.skip : describe;

const ORIGIN = 'http://localhost:3000';

const environment = {
  NODE_ENV: 'test',
  APP_NAME: 'asone-api-test',
  APP_VERSION: '0.2.0-test',
  LOG_LEVEL: 'silent',
  API_HOST: '127.0.0.1',
  API_PORT: '3000',
  AUTH_ACCESS_TOKEN_SECRET: 'test-secret-that-is-at-least-32-characters',
  AUTH_JWT_AUDIENCE: 'asone-api-test',
  AUTH_JWT_ISSUER: 'https://api.test.asone.mx',
  // Placeholder — never actually connected to. The real connection used
  // by every route in this test is the explicit `authRepository` override
  // below, pointed at the real local test database.
  DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:5432/unused',
  REDIS_URL: 'redis://127.0.0.1:6379',
  CORS_ALLOWED_ORIGINS: ORIGIN,
} as const;

function fakeInfrastructure(): InfrastructureDependencies {
  return {
    checkReadiness: () => Promise.resolve({ postgres: 'unavailable', redis: 'unavailable' }),
    close: () => Promise.resolve(),
  };
}

integration('Production bug — PIN quick-switch CSRF (TASK 17.5.1)', () => {
  let database: DatabaseClient;
  let app: FastifyInstance;

  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const branchId = randomUUID();
  const adminUserId = randomUUID();
  const adminMembershipId = randomUUID();
  const cashierUserId = randomUUID();
  const cashierMembershipId = randomUUID();

  beforeAll(async () => {
    if (!new URL(integrationDatabaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({
      connectionString: integrationDatabaseUrl,
      applicationName: 'asone-pin-csrf-test',
    });
    await ensureMigrations(database);

    const passwordHash = await hashPassword('Correct-password-1!');
    await database.pool.query(
      `insert into companies (id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values ($1,'Pin Csrf Co','Pin Csrf Co',$2,'active','UTC','MXN','es-MX'),
              ($3,'Pin Csrf Co B','Pin Csrf Co B',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `pincsrf-a-${companyId}`, otherCompanyId, `pincsrf-b-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into users (id,email,normalized_email,display_name,password_hash,status)
       values ($1,$2,$2,'Admin',$3,'active'),($4,$5,$5,'Cashier',$3,'active')`,
      [
        adminUserId,
        `pincsrf-admin-${adminUserId}@example.test`,
        passwordHash,
        cashierUserId,
        `pincsrf-cashier-${cashierUserId}@example.test`,
      ],
    );
    await database.pool.query(
      `insert into company_memberships (id,company_id,user_id,status)
       values ($1,$2,$3,'active'),($4,$2,$5,'active')`,
      [adminMembershipId, companyId, adminUserId, cashierMembershipId, cashierUserId],
    );
    await database.pool.query(
      `insert into branches (id,company_id,code,name,status,timezone)
       values ($1,$2,'MAIN','Main','active','UTC')`,
      [branchId, companyId],
    );
    await database.pool.query(
      `insert into user_branch_access (id,company_id,membership_id,user_id,branch_id,status,is_default)
       values ($1,$2,$3,$4,$5,'active',true),($6,$2,$7,$8,$5,'active',true)`,
      [
        randomUUID(),
        companyId,
        adminMembershipId,
        adminUserId,
        branchId,
        randomUUID(),
        cashierMembershipId,
        cashierUserId,
      ],
    );
    // A real permission catalogue row is required for `requirePermission`
    // (`staff_credential.manage`) to ever resolve `true` for the admin
    // actor — mirrors `auth.pin-qr.integration.test.ts`'s own reliance on
    // a real seeded/administered role, but built directly here since this
    // file's own scope is narrowly the CSRF round trip, not role admin.
    const permissionId = randomUUID();
    const roleId = randomUUID();
    await database.pool.query(
      `insert into permissions (id,code,domain,description) values ($1,'staff_credential.manage','staff','test') on conflict (code) do nothing`,
      [permissionId],
    );
    const permissionRow = await database.pool.query<{ id: string }>(
      `select id from permissions where code='staff_credential.manage'`,
    );
    const resolvedPermissionId = permissionRow.rows[0]?.id;
    if (resolvedPermissionId === undefined) throw new Error('staff_credential.manage permission not found');
    await database.pool.query(
      `insert into roles (id,company_id,name,code,status,is_system) values ($1,$2,'Admin Role','admin_role','active',false)`,
      [roleId, companyId],
    );
    await database.pool.query(
      `insert into role_permissions (company_id,role_id,permission_id,effect) values ($1,$2,$3,'allow')`,
      [companyId, roleId, resolvedPermissionId],
    );
    await database.pool.query(
      `insert into user_roles (id,company_id,membership_id,role_id,branch_id,status) values ($1,$2,$3,$4,null,'active')`,
      [randomUUID(), companyId, adminMembershipId, roleId],
    );

    const config: ApiConfig = loadApiConfig(environment);
    app = await buildApp({
      config,
      infrastructure: fakeInfrastructure(),
      logger: pino({ level: 'silent' }),
      authRepository: new PostgresAuthRepository(database),
    });
  });

  afterAll(async () => {
    await database.pool.query('delete from audit_log where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query(
      `delete from session_refresh_tokens where session_id in (select id from sessions where company_id in ($1,$2))`,
      [companyId, otherCompanyId],
    );
    await database.pool.query('delete from sessions where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from user_roles where company_id=$1', [companyId]);
    await database.pool.query('delete from role_permissions where company_id=$1', [companyId]);
    await database.pool.query('delete from roles where company_id=$1', [companyId]);
    // Both companies — the second test's own inline cleanup covers the
    // happy path, but this must be idempotent/robust even if that test
    // fails before reaching its own cleanup.
    await database.pool.query('delete from user_branch_access where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from company_memberships where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from branches where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from companies where id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from users where email like $1', ['pincsrf-%@example.test']);
    await app.close();
    await database.close();
  });

  it('THE PRODUCTION-BUG TEST: a PIN configured from user administration authenticates cashier quick-switch on an authorized POS terminal', async () => {
    // A. Real admin login through the real HTTP route, exactly as the
    // Flutter app's `auth_gateway.dart` does: browser transport, with the
    // approved origin header.
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: {
        identifier: `pincsrf-admin-${adminUserId}@example.test`,
        password: 'Correct-password-1!',
        company_id: companyId,
        branch_id: branchId,
        client_type: 'browser',
        transport_mode: 'browser',
      },
    });
    expect(login.statusCode).toBe(200);
    const loginBody = login.json<{ data: { access_token: string; csrf_token: string } }>().data;
    expect(loginBody.access_token).toBeTruthy();
    expect(loginBody.csrf_token).toBeTruthy();

    // B. Set the cashier's PIN through the EXACT SAME route/service used
    // by Usuarios -> Acceso -> "Actualizar PIN"
    // (`pos_user_administration_screen.dart`'s `_SetPinDialog` ->
    // `PosIdentityAdminGateway.setStaffPin` -> this PUT route).
    const setPin = await app.inject({
      method: 'PUT',
      url: `/api/v1/auth/staff/${cashierMembershipId}/pin`,
      headers: {
        origin: ORIGIN,
        'content-type': 'application/json',
        authorization: `Bearer ${loginBody.access_token}`,
      },
      payload: { pin: '4471' },
    });
    expect(setPin.statusCode).toBe(200);

    // Verify the authoritative membership now has a real argon2id hash —
    // never the plaintext PIN, never printed.
    const hashRow = await database.pool.query<{ pin_hash: string }>(
      'select pin_hash from company_memberships where id=$1',
      [cashierMembershipId],
    );
    expect(hashRow.rows[0]?.pin_hash).toMatch(/^\$argon2id\$/u);

    // C/before fix: this is EXACTLY what the shipped, broken
    // `PosAuthGateway.pinLogin` sent — no `X-CSRF-Token` header at all —
    // reproducing the real production failure.
    const withoutCsrf = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/pin-login',
      headers: {
        origin: ORIGIN,
        'content-type': 'application/json',
        authorization: `Bearer ${loginBody.access_token}`,
      },
      payload: { pin: '4471' },
    });
    expect(withoutCsrf.statusCode).toBe(403);
    expect(withoutCsrf.json()).toMatchObject({ error: { code: 'validation_error' } });

    // D. THE FIX: the exact same request, now carrying the real CSRF
    // token — mirroring `ApiPosAuthGateway.pinLogin`'s fixed
    // implementation exactly (same header, same token source).
    const withCsrf = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/pin-login',
      headers: {
        origin: ORIGIN,
        'content-type': 'application/json',
        authorization: `Bearer ${loginBody.access_token}`,
        'x-csrf-token': loginBody.csrf_token,
      },
      payload: { pin: '4471' },
    });
    expect(withCsrf.statusCode).toBe(200);
    const switchBody = withCsrf.json<{
      data: {
        result: string;
        access_token: string;
        session: { user_id: string; membership_id: string; company_id: string; branch_id: string | null };
      };
    }>().data;
    expect(switchBody.result).toBe('authenticated');
    expect(switchBody.session.user_id).toBe(cashierUserId);
    expect(switchBody.session.membership_id).toBe(cashierMembershipId);
    expect(switchBody.session.company_id).toBe(companyId);

    // E. The new session is not merely "200 OK" — it is a real, usable
    // session: the next protected request succeeds with its own access
    // token (this task's own explicit acceptance bar).
    const nextRequest = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { origin: ORIGIN, authorization: `Bearer ${switchBody.access_token}` },
    });
    expect(nextRequest.statusCode).toBe(200);
  });

  it('cross-company: the same PIN never authenticates against a different company, even at the real HTTP boundary', async () => {
    // A second admin, in the OTHER company, with a session that never saw
    // Company A at all.
    const otherAdminUserId = randomUUID();
    const otherAdminMembershipId = randomUUID();
    const otherBranchId = randomUUID();
    await database.pool.query(
      `insert into users (id,email,normalized_email,display_name,password_hash,status)
       values ($1,$2,$2,'Other Admin',$3,'active')`,
      [otherAdminUserId, `pincsrf-otheradmin-${otherAdminUserId}@example.test`, await hashPassword('Correct-password-1!')],
    );
    await database.pool.query(
      `insert into company_memberships (id,company_id,user_id,status) values ($1,$2,$3,'active')`,
      [otherAdminMembershipId, otherCompanyId, otherAdminUserId],
    );
    await database.pool.query(
      `insert into branches (id,company_id,code,name,status,timezone) values ($1,$2,'MAIN','Main','active','UTC')`,
      [otherBranchId, otherCompanyId],
    );
    await database.pool.query(
      `insert into user_branch_access (id,company_id,membership_id,user_id,branch_id,status,is_default)
       values ($1,$2,$3,$4,$5,'active',true)`,
      [randomUUID(), otherCompanyId, otherAdminMembershipId, otherAdminUserId, otherBranchId],
    );

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: {
        identifier: `pincsrf-otheradmin-${otherAdminUserId}@example.test`,
        password: 'Correct-password-1!',
        company_id: otherCompanyId,
        branch_id: otherBranchId,
        client_type: 'browser',
        transport_mode: 'browser',
      },
    });
    expect(login.statusCode).toBe(200);
    const loginBody = login.json<{ data: { access_token: string; csrf_token: string } }>().data;

    // The real Company A cashier PIN ('4471', set in the previous test)
    // submitted against a Company B terminal session, WITH a valid CSRF
    // token this time — proves the CSRF fix never weakens tenant
    // isolation, it only unblocks the legitimate same-company case.
    const attempt = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/pin-login',
      headers: {
        origin: ORIGIN,
        'content-type': 'application/json',
        authorization: `Bearer ${loginBody.access_token}`,
        'x-csrf-token': loginBody.csrf_token,
      },
      payload: { pin: '4471' },
    });
    expect(attempt.statusCode).toBe(401);
    expect(attempt.json()).toMatchObject({ error: { code: 'invalid_credentials' } });
    // Cleanup for this test's own fixture rows is handled by the shared
    // `afterAll` below (it deletes by company_id/email pattern across
    // both companies), avoiding an FK-ordering-sensitive inline delete.
  });
});

async function ensureMigrations(database: DatabaseClient): Promise<void> {
  const existing = await database.pool.query<{ present: string | null }>(
    `select to_regclass('public.company_memberships')::text present`,
  );
  const hasPinColumn = await database.pool.query<{ present: string | null }>(
    `select column_name from information_schema.columns
     where table_name='company_memberships' and column_name='pin_hash'`,
  );
  if (existing.rows[0]?.present !== null && hasPinColumn.rows.length > 0) return;
  const migrationsPath = resolve(import.meta.dirname, '../../../../../packages/database/drizzle');
  const journal = JSON.parse(
    await readFile(resolve(migrationsPath, 'meta/_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };
  for (const entry of journal.entries) {
    const sql = await readFile(resolve(migrationsPath, `${entry.tag}.sql`), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint'))
      if (statement.trim().length > 0) {
        try {
          await database.pool.query(statement);
        } catch (error) {
          if (!(error instanceof Error) || !error.message.includes('already exists')) throw error;
        }
      }
  }
}
