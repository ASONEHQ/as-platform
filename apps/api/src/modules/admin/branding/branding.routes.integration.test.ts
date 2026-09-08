/// TASK 14.5A: real end-to-end coverage against a real Postgres AND a real
/// MinIO (the SAME container `compose.yaml` already provisions, started
/// locally for this run) -- mirrors
/// `../settings/settings.routes.integration.test.ts`'s own structure
/// (fixture shape, skip-when-`DATABASE_TEST_URL`-absent convention,
/// `app.inject` against a real `Fastify()` instance) as closely as this
/// module's different transport (multipart) allows.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import Fastify, { type FastifyInstance } from 'fastify';
import fastifyMultipart from '@fastify/multipart';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';
import { AppError } from '@asone/errors';

import type { AuthService } from '../../auth/auth.service.js';
import type { AuthContext } from '../../auth/auth.types.js';
import { SettingsRepository } from '../settings/settings.repository.js';
import { registerSettingsRoutes } from '../settings/settings.routes.js';
import { SettingsService } from '../settings/settings.service.js';
import { registerBrandingRoutes } from './branding.routes.js';
import { BrandingService } from './branding.service.js';
import { BrandingObjectStorage, brandingStorageConfigFromEnv } from './branding.storage.js';
import { MAX_LOGO_BYTES } from './branding.validation.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const integrationDatabaseUrl = databaseUrl ?? 'postgresql://branding-routes-test-disabled';
const maybeStorageConfig = brandingStorageConfigFromEnv();
const integration =
  databaseUrl === undefined || maybeStorageConfig === undefined ? describe.skip : describe;
const migrationsPath = resolve(import.meta.dirname, '../../../../../packages/database/drizzle');

/** `integration` is `describe.skip` whenever {@link maybeStorageConfig} is
 * `undefined`, so every test body below only ever runs with a real config
 * -- this getter documents that invariant instead of a bare `!` assertion. */
function requireStorageConfig(): NonNullable<typeof maybeStorageConfig> {
  if (maybeStorageConfig === undefined) throw new Error('MinIO storage config is required.');
  return maybeStorageConfig;
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngBytes(size: number): Buffer {
  const body = Buffer.alloc(Math.max(size - PNG_MAGIC.length, 0), 0x42);
  return Buffer.concat([PNG_MAGIC, body]);
}

function multipartLogo(
  bytes: Buffer,
  contentType = 'image/png',
  filename = 'logo.png',
): { body: Buffer; contentType: string } {
  const boundary = 'asOneBrandingTestBoundary1234567890';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return { body: Buffer.concat([head, bytes, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
}

integration('real Postgres + real MinIO branding routes', () => {
  let app: FastifyInstance;
  let database: DatabaseClient;
  let storage: BrandingObjectStorage;
  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const userId = randomUUID();

  beforeAll(async () => {
    if (!new URL(integrationDatabaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({
      connectionString: integrationDatabaseUrl,
      applicationName: 'asone-branding-routes-test',
    });
    await ensureMigrations(database);
    await createFixture(database, { companyId, otherCompanyId, userId });

    const authContext: AuthContext = {
      sessionId: randomUUID(),
      userId,
      membershipId: randomUUID(),
      companyId,
      branchId: randomUUID(),
      expiresAt: new Date(Date.now() + 60_000),
      permissions: ['company_settings.read', 'company_settings.update'],
      permittedBranchIds: [],
    };
    // TASK 14.5A validation (d): a real second tenant identity, scoped to
    // `otherCompanyId`, selected by a distinct bearer token -- lets the
    // tenant-isolation test actually authenticate AS company B and read
    // ITS OWN effective settings, rather than merely proving company B's
    // id is rejected under company A's own session (a weaker guarantee).
    const otherAuthContext: AuthContext = {
      ...authContext,
      sessionId: randomUUID(),
      companyId: otherCompanyId,
      branchId: randomUUID(),
    };
    const authentication = {
      authenticate: vi.fn((token: string) =>
        Promise.resolve(token === 'integration-other' ? otherAuthContext : authContext),
      ),
      requirePermission: vi.fn((context: AuthContext, permission: string) => {
        if (!context.permissions.includes(permission))
          throw new AppError({ code: 'permission_denied', message: 'Permission denied.', statusCode: 403 });
      }),
    } as unknown as AuthService;

    storage = new BrandingObjectStorage(requireStorageConfig());
    const settingsService = new SettingsService(new SettingsRepository(database));
    const brandingService = new BrandingService(settingsService, storage);

    app = Fastify();
    await app.register(fastifyMultipart, { attachFieldsToBody: false });
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
      return reply.code(500).send({
        error: { code: 'internal_error' },
        meta: { request_id: request.requestContext.requestId, correlation_id: request.requestContext.correlationId },
      });
    });
    registerSettingsRoutes(app, authentication, settingsService);
    registerBrandingRoutes(app, authentication, brandingService);
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await database.pool.query('delete from outbox_events where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from audit_log where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from company_settings where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from companies where id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from users where id=$1', [userId]);
    await database.close();
  });

  it('uploads a real object to MinIO and persists a real CAS-guarded branding.logo_url setting', async () => {
    const { body, contentType } = multipartLogo(pngBytes(1024));
    const uploaded = await app.inject({
      method: 'POST',
      url: `/api/v1/companies/${companyId}/branding/logo`,
      headers: { authorization: 'Bearer integration', 'content-type': contentType, 'if-match': '"1"' },
      payload: body,
    });
    expect(uploaded.statusCode).toBe(200);
    expect(uploaded.headers.etag).toBe('"2"');
    const data = uploaded.json<{ data: { key: string; value: string; version: number; source: string } }>().data;
    expect(data.source).toBe('company');
    expect(typeof data.value).toBe('string');
    expect(data.value.startsWith('http://')).toBe(true);
    expect(data.value).toContain('/asone-branding/logos/');

    // The uploaded object is really retrievable straight from MinIO.
    const objectResponse = await fetch(data.value);
    expect(objectResponse.status).toBe(200);
    const objectBytes = Buffer.from(await objectResponse.arrayBuffer());
    expect(objectBytes.subarray(0, 8)).toEqual(PNG_MAGIC);
    expect(objectBytes.length).toBe(1024);

    // The setting row itself is real and resolves through the normal
    // effective-settings endpoint.
    const effective = await app.inject({
      method: 'GET',
      url: `/api/v1/companies/${companyId}/settings/effective?keys=branding.logo_url`,
      headers: { authorization: 'Bearer integration' },
    });
    expect(effective.statusCode).toBe(200);
    const effectiveSetting = effective.json<{ data: { settings: { source: string; value: string; version: number }[] } }>()
      .data.settings[0];
    expect(effectiveSetting).toMatchObject({ source: 'company', value: data.value, version: 2 });

    // Working CAS: a stale If-Match ("1", already superseded by "2" above)
    // is rejected with a real 409.
    const secondUpload = multipartLogo(pngBytes(512));
    const staleAttempt = await app.inject({
      method: 'POST',
      url: `/api/v1/companies/${companyId}/branding/logo`,
      headers: { authorization: 'Bearer integration', 'content-type': secondUpload.contentType, 'if-match': '"1"' },
      payload: secondUpload.body,
    });
    expect(staleAttempt.statusCode).toBe(409);
    expect(staleAttempt.json<{ error: { code: string } }>().error.code).toBe('version_conflict');
  });

  it('rejects a non-image content type with a real 415', async () => {
    const { body, contentType } = multipartLogo(Buffer.from('%PDF-1.4 not an image'), 'application/pdf', 'file.pdf');
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/companies/${companyId}/branding/logo`,
      headers: { authorization: 'Bearer integration', 'content-type': contentType, 'if-match': '"1"' },
      payload: body,
    });
    expect(response.statusCode).toBe(415);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('unsupported_media_type');
  });

  it('rejects a spoofed content type whose real bytes do not match, with a real 415', async () => {
    const notActuallyPng = Buffer.from('this is plain text pretending to be a png');
    const { body, contentType } = multipartLogo(notActuallyPng, 'image/png', 'fake.png');
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/companies/${companyId}/branding/logo`,
      headers: { authorization: 'Bearer integration', 'content-type': contentType, 'if-match': '"1"' },
      payload: body,
    });
    expect(response.statusCode).toBe(415);
  });

  it('rejects an oversized file with a real 413', async () => {
    const { body, contentType } = multipartLogo(pngBytes(MAX_LOGO_BYTES + 1024));
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/companies/${companyId}/branding/logo`,
      headers: { authorization: 'Bearer integration', 'content-type': contentType, 'if-match': '"1"' },
      payload: body,
    });
    expect(response.statusCode).toBe(413);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('payload_too_large');
  });

  it('enforces tenant isolation: company A\'s uploaded logo is never returned for company B', async () => {
    // Positive control: company A (`companyId`) already has a real
    // uploaded logo from the first test above -- confirm company B
    // (`otherCompanyId`), authenticated as ITSELF via a distinct bearer
    // token/session, still resolves the untouched catalog default and
    // never company A's URL.
    const otherEffective = await app.inject({
      method: 'GET',
      url: `/api/v1/companies/${otherCompanyId}/settings/effective?keys=branding.logo_url`,
      headers: { authorization: 'Bearer integration-other' },
    });
    expect(otherEffective.statusCode).toBe(200);
    const otherSetting = otherEffective.json<{ data: { settings: { source: string; value: string }[] } }>()
      .data.settings[0];
    expect(otherSetting).toMatchObject({ source: 'default', value: '' });

    // Also confirm the request-scope guard itself: company A's own
    // session cannot read company B's settings by URL alone.
    const crossTenantAttempt = await app.inject({
      method: 'GET',
      url: `/api/v1/companies/${otherCompanyId}/settings/effective?keys=branding.logo_url`,
      headers: { authorization: 'Bearer integration' },
    });
    expect(crossTenantAttempt.statusCode).toBe(403);
  });

  it('deletes the logo, clearing the setting back to unset and best-effort removing the object', async () => {
    // Read the setting's CURRENT real version rather than guessing a
    // number -- this test runs after others in the same file that also
    // mutate `companyId`'s `branding.logo_url`, so the version this CAS
    // write needs is whatever the prior tests actually left behind.
    const current = await app.inject({
      method: 'GET',
      url: `/api/v1/companies/${companyId}/settings/effective?keys=branding.logo_url`,
      headers: { authorization: 'Bearer integration' },
    });
    const currentVersion = current.json<{ data: { settings: { version: number }[] } }>().data.settings[0]
      ?.version;
    expect(currentVersion).toBeDefined();

    const { body, contentType } = multipartLogo(pngBytes(2048));
    const uploaded = await app.inject({
      method: 'POST',
      url: `/api/v1/companies/${companyId}/branding/logo`,
      headers: {
        authorization: 'Bearer integration',
        'content-type': contentType,
        'if-match': `"${String(currentVersion)}"`,
      },
      payload: body,
    });
    expect(uploaded.statusCode).toBe(200);
    const uploadedUrl = uploaded.json<{ data: { value: string; version: number } }>().data.value;
    const uploadedVersion = uploaded.json<{ data: { version: number } }>().data.version;

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/companies/${companyId}/branding/logo`,
      headers: { authorization: 'Bearer integration', 'if-match': `"${String(uploadedVersion)}"` },
    });
    expect(deleted.statusCode).toBe(200);
    const deletedData = deleted.json<{ data: { value: string; source: string } }>().data;
    expect(deletedData).toMatchObject({ value: '', source: 'default' });

    const afterDelete = await app.inject({
      method: 'GET',
      url: `/api/v1/companies/${companyId}/settings/effective?keys=branding.logo_url`,
      headers: { authorization: 'Bearer integration' },
    });
    expect(
      afterDelete.json<{ data: { settings: { source: string; value: string }[] } }>().data.settings[0],
    ).toMatchObject({ source: 'default', value: '' });

    const objectResponse = await fetch(uploadedUrl);
    expect(objectResponse.status).toBe(404);
  });
});

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
      ? ['0000_fantastic_black_cat.sql', '0001_high_thor.sql', '0002_true_sugar_man.sql', '0003_curved_zuras.sql']
      : ['0003_curved_zuras.sql'];
  for (const name of names) {
    const sql = await readFile(resolve(migrationsPath, name), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint'))
      if (statement.trim().length > 0) await database.pool.query(statement);
  }
}

async function createFixture(
  database: DatabaseClient,
  fixture: { readonly companyId: string; readonly otherCompanyId: string; readonly userId: string },
): Promise<void> {
  await database.pool.query(
    `insert into companies
     (id,legal_name,display_name,slug,status,timezone,currency_code,locale)
     values ($1,'Company','Company',$2,'active','America/Mexico_City','MXN','es-MX'),
            ($3,'Other','Other',$4,'active','America/Mexico_City','MXN','es-MX')`,
    [fixture.companyId, `branding-${fixture.companyId}`, fixture.otherCompanyId, `branding-${fixture.otherCompanyId}`],
  );
  await database.pool.query(
    `insert into users (id,email,normalized_email,display_name,status)
     values ($1,$2,$2,'Branding User','active')`,
    [fixture.userId, `branding-${fixture.userId}@example.test`],
  );
}
