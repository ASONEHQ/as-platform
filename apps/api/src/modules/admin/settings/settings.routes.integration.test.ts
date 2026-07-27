import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';
import { AppError } from '@asone/errors';

import type { AuthService } from '../../auth/auth.service.js';
import type { AuthContext } from '../../auth/auth.types.js';
import { SettingsRepository } from './settings.repository.js';
import { registerSettingsRoutes } from './settings.routes.js';
import { SettingsService } from './settings.service.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const integrationDatabaseUrl = databaseUrl ?? 'postgresql://settings-routes-test-disabled';
const integration = databaseUrl === undefined ? describe.skip : describe;
const migrationsPath = resolve(import.meta.dirname, '../../../../../packages/database/drizzle');

integration('PostgreSQL settings HTTP routes', () => {
  let app: FastifyInstance;
  let database: DatabaseClient;
  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const branchId = randomUUID();
  const otherBranchId = randomUUID();
  const userId = randomUUID();

  beforeAll(async () => {
    if (!new URL(integrationDatabaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({
      connectionString: integrationDatabaseUrl,
      applicationName: 'asone-settings-routes-test',
    });
    await ensureMigrations(database);
    await createFixture(database, {
      companyId,
      otherCompanyId,
      branchId,
      otherBranchId,
      userId,
    });
    const authContext: AuthContext = {
      sessionId: randomUUID(),
      userId,
      membershipId: randomUUID(),
      companyId,
      branchId,
      expiresAt: new Date(Date.now() + 60_000),
      permissions: [
        'company_settings.read',
        'company_settings.update',
        'branch_settings.read',
        'branch_settings.update',
      ],
      permittedBranchIds: [branchId],
    };
    const authentication = {
      authenticate: vi.fn(() => Promise.resolve(authContext)),
      requirePermission: vi.fn((_context: AuthContext, permission: string) => {
        if (!authContext.permissions.includes(permission))
          throw new AppError({
            code: 'permission_denied',
            message: 'Permission denied.',
            statusCode: 403,
          });
      }),
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
          meta: {
            request_id: request.requestContext.requestId,
            correlation_id: request.requestContext.correlationId,
          },
        });
      return reply.code(500).send({ error: { code: 'internal_error' } });
    });
    registerSettingsRoutes(
      app,
      authentication,
      new SettingsService(new SettingsRepository(database)),
    );
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await database.pool.query('delete from outbox_events where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from audit_log where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from branch_settings where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from company_settings where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from branches where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from companies where id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from users where id=$1', [userId]);
    await database.close();
  });

  it('executes company defaults, create, cache validation, stale conflict, and retirement', async () => {
    const url = `/api/v1/companies/${companyId}/settings/effective?keys=business.locale`;
    const defaults = await app.inject({
      method: 'GET',
      url,
      headers: { authorization: 'Bearer integration' },
    });
    expect(defaults.statusCode).toBe(200);
    expect(
      defaults.json<{ data: { settings: { source: string; value: string }[] } }>().data.settings[0],
    ).toMatchObject({ source: 'default', value: 'es-MX' });
    const defaultEtag = defaults.headers.etag;

    const created = await putCompany(app, companyId, '"1"', 'active', 'en-US');
    expect(created.statusCode).toBe(200);
    expect(created.headers.etag).toBe('"2"');
    const overridden = await app.inject({
      method: 'GET',
      url,
      headers: { authorization: 'Bearer integration' },
    });
    expect(overridden.headers.etag).not.toBe(defaultEtag);
    expect(
      overridden.json<{ data: { settings: { source: string; value: string }[] } }>().data
        .settings[0],
    ).toMatchObject({ source: 'company', value: 'en-US' });
    const cached = await app.inject({
      method: 'GET',
      url,
      headers: {
        authorization: 'Bearer integration',
        'if-none-match': overridden.headers.etag ?? '',
      },
    });
    expect(cached.statusCode).toBe(304);
    expect(cached.body).toBe('');

    expect((await putCompany(app, companyId, '"1"', 'active', 'es-MX')).statusCode).toBe(409);
    const retired = await putCompany(app, companyId, '"2"', 'retired', 'en-US');
    expect(retired.statusCode).toBe(200);
    expect(retired.headers.etag).toBe('"3"');
    expect(retired.json<{ data: { source: string; value: string } }>().data).toMatchObject({
      source: 'default',
      value: 'es-MX',
    });
  });

  it('enforces branch precedence, explicit access, tenant hiding, and non-overridable keys', async () => {
    const created = await app.inject({
      method: 'PUT',
      url: `/api/v1/branches/${branchId}/settings/business.locale`,
      headers: {
        authorization: 'Bearer integration',
        'content-type': 'application/json',
        'if-match': '"1"',
      },
      payload: { value: 'en-US', value_type: 'string', status: 'active' },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json<{ data: { source: string; value: string } }>().data).toMatchObject({
      source: 'branch',
      value: 'en-US',
    });

    const prohibited = await app.inject({
      method: 'PUT',
      url: `/api/v1/branches/${branchId}/settings/business.currency`,
      headers: {
        authorization: 'Bearer integration',
        'content-type': 'application/json',
        'if-match': '"1"',
      },
      payload: { value: 'USD', value_type: 'string', status: 'active' },
    });
    expect(prohibited.statusCode).toBe(400);

    const crossTenant = await app.inject({
      method: 'GET',
      url: `/api/v1/branches/${otherBranchId}/settings/effective`,
      headers: { authorization: 'Bearer integration' },
    });
    expect(crossTenant.statusCode).toBe(403);
    expect(crossTenant.json<{ error: { code: string } }>().error.code).toBe(
      'branch_scope_mismatch',
    );
  });
});

async function putCompany(
  app: FastifyInstance,
  companyId: string,
  ifMatch: string,
  status: 'active' | 'retired',
  value: string,
): Promise<Awaited<ReturnType<FastifyInstance['inject']>>> {
  return app.inject({
    method: 'PUT',
    url: `/api/v1/companies/${companyId}/settings/business.locale`,
    headers: {
      authorization: 'Bearer integration',
      'content-type': 'application/json',
      'if-match': ifMatch,
    },
    payload: { value, value_type: 'string', status },
  });
}

async function ensureMigrations(database: DatabaseClient): Promise<void> {
  const settings = await database.pool.query<{ present: string | null }>(
    `select to_regclass('public.company_settings')::text present`,
  );
  if (settings.rows[0]?.present !== null) return;
  const foundation = await database.pool.query<{ present: string | null }>(
    `select to_regclass('public.companies')::text present`,
  );
  const names =
    foundation.rows[0]?.present === null
      ? [
          '0000_fantastic_black_cat.sql',
          '0001_high_thor.sql',
          '0002_true_sugar_man.sql',
          '0003_curved_zuras.sql',
        ]
      : ['0003_curved_zuras.sql'];
  for (const name of names) {
    const sql = await readFile(resolve(migrationsPath, name), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint'))
      if (statement.trim().length > 0) await database.pool.query(statement);
  }
}

async function createFixture(
  database: DatabaseClient,
  fixture: {
    readonly companyId: string;
    readonly otherCompanyId: string;
    readonly branchId: string;
    readonly otherBranchId: string;
    readonly userId: string;
  },
): Promise<void> {
  await database.pool.query(
    `insert into companies
     (id,legal_name,display_name,slug,status,timezone,currency_code,locale)
     values ($1,'Company','Company',$2,'active','America/Mexico_City','MXN','es-MX'),
            ($3,'Other','Other',$4,'active','America/Mexico_City','MXN','es-MX')`,
    [
      fixture.companyId,
      `settings-${fixture.companyId}`,
      fixture.otherCompanyId,
      `settings-${fixture.otherCompanyId}`,
    ],
  );
  await database.pool.query(
    `insert into users (id,email,normalized_email,display_name,status)
     values ($1,$2,$2,'Settings User','active')`,
    [fixture.userId, `settings-${fixture.userId}@example.test`],
  );
  await database.pool.query(
    `insert into branches (id,company_id,name,code,status,timezone)
     values ($1,$2,'Main','MAIN','active','America/Mexico_City'),
            ($3,$4,'Other','OTHER','active','America/Mexico_City')`,
    [fixture.branchId, fixture.companyId, fixture.otherBranchId, fixture.otherCompanyId],
  );
}
