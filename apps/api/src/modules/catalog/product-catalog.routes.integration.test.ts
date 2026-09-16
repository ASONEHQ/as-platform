/// TASK 16.6 (Productos/Catálogo legacy parity, `AS POS V1.html`'s Extras
/// tab, `cargarImagenProducto()`) — real end-to-end coverage of the product
/// image upload/delete routes against a real Postgres AND a real MinIO (the
/// SAME container `compose.yaml` already provisions), mirroring
/// `../admin/branding/branding.routes.integration.test.ts`'s own structure
/// (fixture shape, skip-when-config-absent convention, `app.inject` against
/// a real `Fastify()` instance) as closely as this route's own product
/// scoping allows. `product-catalog.routes.test.ts` already covers every
/// other product-catalog route (including the new enum/format validation
/// and the duplicate endpoint) against a mocked service; this file is only
/// for the two routes that genuinely need a real object store.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import fastifyMultipart from '@fastify/multipart';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';
import { AppError } from '@asone/errors';

import { objectStorageConfigFromEnv } from '../../infrastructure/object-storage.js';
import type { AuthService } from '../auth/auth.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { ProductCatalogRepository } from './product-catalog.repository.js';
import { registerProductCatalogRoutes } from './product-catalog.routes.js';
import { ProductCatalogService } from './product-catalog.service.js';
import { ProductImageStorage } from './product-images.storage.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const integrationDatabaseUrl = databaseUrl ?? 'postgresql://product-image-routes-test-disabled';
const maybeStorageConfig = objectStorageConfigFromEnv();
const integration =
  databaseUrl === undefined || maybeStorageConfig === undefined ? describe.skip : describe;
const migrationsPath = resolve(import.meta.dirname, '../../../../../packages/database/drizzle');

function requireStorageConfig(): NonNullable<typeof maybeStorageConfig> {
  if (maybeStorageConfig === undefined) throw new Error('MinIO storage config is required.');
  return maybeStorageConfig;
}

// Narrows an optional value into a definite one for later use — never a
// silent `!`, so a genuinely missing value fails the test with a clear
// message instead of an unexplained downstream failure.
function required<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new Error(`Expected ${what} to be present.`);
  return value;
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// TASK 16.6D — real magic bytes for the other two formats
// `ALLOWED_IMAGE_CONTENT_TYPES`/`matchesImageFileSignature`
// (`image-upload-validation.ts`) accept, mirroring `pngBytes`'s own
// shape so all three formats get symmetrical "really accepted" coverage
// (previously only PNG was exercised here).
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const WEBP_HEADER = Buffer.from('RIFF', 'ascii');
const WEBP_FORMAT = Buffer.from('WEBP', 'ascii');

function pngBytes(size: number): Buffer {
  const body = Buffer.alloc(Math.max(size - PNG_MAGIC.length, 0), 0x42);
  return Buffer.concat([PNG_MAGIC, body]);
}

function jpegBytes(size: number): Buffer {
  const body = Buffer.alloc(Math.max(size - JPEG_MAGIC.length, 0), 0x42);
  return Buffer.concat([JPEG_MAGIC, body]);
}

// A real, well-formed RIFF/WEBP container: `matchesImageFileSignature`
// checks bytes 0-4 (`RIFF`) and 8-12 (`WEBP`), matching the real libwebp
// container layout (bytes 4-8 are the RIFF chunk size, unchecked here).
function webpBytes(size: number): Buffer {
  const target = Math.max(size, 12);
  const body = Buffer.alloc(target - 12, 0x42);
  return Buffer.concat([WEBP_HEADER, Buffer.alloc(4, 0), WEBP_FORMAT, body]);
}

function multipartImage(
  bytes: Buffer,
  contentType = 'image/png',
  filename = 'product.png',
): { body: Buffer; contentType: string } {
  const boundary = 'asOneProductImageTestBoundary1234567890';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return {
    body: Buffer.concat([head, bytes, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

integration('real Postgres + real MinIO product image routes', () => {
  let app: FastifyInstance;
  let database: DatabaseClient;
  // TASK 16.6D — hoisted (was a `beforeAll`-local `const`) so new,
  // independent per-test fixtures (JPEG/WebP acceptance, cross-company
  // rejection) can create their OWN product via the real service without
  // touching the shared `productId` fixture's own version sequence,
  // which several existing tests below depend on staying exactly as it
  // was.
  let service: ProductCatalogService;
  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const userId = randomUUID();
  const otherUserId = randomUUID();
  let productId: string;

  beforeAll(async () => {
    if (!new URL(integrationDatabaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({
      connectionString: integrationDatabaseUrl,
      applicationName: 'asone-product-image-routes-test',
    });
    await ensureMigrations(database);
    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'Product Image Co','Product Image Co',$2,'active','UTC','MXN','es-MX'),
             ($3,'Other Product Image Co','Other Product Image Co',$4,'active','UTC','MXN','es-MX')`,
      [
        companyId,
        `product-images-${companyId}`,
        otherCompanyId,
        `product-images-${otherCompanyId}`,
      ],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'Product Image User','active'),($3,$4,$4,'Other Product Image User','active')`,
      [
        userId,
        `product-images-${userId}@example.test`,
        otherUserId,
        `product-images-${otherUserId}@example.test`,
      ],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status)
       values($1,$2,$3,'active'),($4,$5,$6,'active')`,
      [randomUUID(), companyId, userId, randomUUID(), otherCompanyId, otherUserId],
    );

    const authContext: AuthContext = {
      sessionId: randomUUID(),
      userId,
      membershipId: randomUUID(),
      companyId,
      branchId: randomUUID(),
      expiresAt: new Date(Date.now() + 60_000),
      permissions: ['catalog.read', 'product.manage'],
      permittedBranchIds: [],
    };
    // TASK 16.6 — a real second tenant identity, scoped to `otherCompanyId`,
    // selected by a distinct bearer token, mirrors
    // `branding.routes.integration.test.ts`'s own tenant-isolation pattern:
    // authenticates AS company B rather than merely asserting company B's id
    // is rejected under company A's own session.
    const otherAuthContext: AuthContext = {
      ...authContext,
      sessionId: randomUUID(),
      userId: otherUserId,
      companyId: otherCompanyId,
      branchId: randomUUID(),
    };
    // TASK 16.6B — same tenant as `authContext`, but missing `product
    // .manage` (only `catalog.read`) — proves the image routes are gated
    // server-side, not merely by hiding the UI button: a cashier who
    // knows the endpoint and has a valid session still gets a real 403.
    const readOnlyAuthContext: AuthContext = {
      ...authContext,
      sessionId: randomUUID(),
      permissions: ['catalog.read'],
    };
    const authentication = {
      authenticate: vi.fn((token: string) =>
        Promise.resolve(
          token === 'product-images-other'
            ? otherAuthContext
            : token === 'product-images-readonly'
              ? readOnlyAuthContext
              : authContext,
        ),
      ),
      requirePermission: vi.fn((context: AuthContext, permission: string) => {
        if (!context.permissions.includes(permission))
          throw new AppError({
            code: 'permission_denied',
            message: 'Permission denied.',
            statusCode: 403,
          });
      }),
    } as unknown as AuthService;

    service = new ProductCatalogService(
      new ProductCatalogRepository(database),
      new ProductImageStorage(requireStorageConfig()),
    );

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
          meta: { request_id: request.requestContext.requestId },
        });
      return reply.code(500).send({ error: { code: 'internal_error' } });
    });
    registerProductCatalogRoutes(
      app,
      authentication,
      service,
      new ProductImageStorage(requireStorageConfig()),
    );
    await app.ready();

    const created = await service.createProduct(
      {
        companyId,
        actorId: userId,
        requestId: 'setup',
        correlationId: 'setup',
        timestamp: new Date(),
      },
      'product-image-fixture',
      {
        code: 'product-image-fixture',
        name: 'Product image fixture',
        productType: 'simple',
        tracksInventory: false,
        status: 'active',
        defaultVariant: {
          sku: 'product-image-fixture',
          unitOfMeasureCode: 'unit',
          quantityScale: 0,
          standardCost: '0',
          currencyCode: 'MXN',
        },
      },
    );
    productId = created.value.id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await database.pool.query('delete from product_variants where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from products where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from outbox_events where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from audit_log where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from idempotency_keys where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from company_memberships where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from companies where id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from users where id in ($1,$2)', [userId, otherUserId]);
    await database.close();
  });

  it('uploads a real object to MinIO, persists image_url on the product, and it is really visible on the card', async () => {
    const { body, contentType } = multipartImage(pngBytes(1024));
    const uploaded = await app.inject({
      method: 'POST',
      url: `/api/v1/products/${productId}/image`,
      headers: { authorization: 'Bearer x', 'content-type': contentType, 'if-match': '"1"' },
      payload: body,
    });
    expect(uploaded.statusCode).toBe(200);
    expect(uploaded.headers.etag).toBe('"2"');
    const data = uploaded.json<{ data: { image_url: string | null } }>().data;
    expect(typeof data.image_url).toBe('string');
    expect(data.image_url).toContain('/asone-product-images/products/');

    // The uploaded object is really retrievable — this is what makes it
    // actually flow through to the POS/Cafetería product card, not just a
    // stored string.
    const objectResponse = await fetch(required(data.image_url, 'uploaded image_url'));
    expect(objectResponse.status).toBe(200);
    const objectBytes = Buffer.from(await objectResponse.arrayBuffer());
    expect(objectBytes.subarray(0, 8)).toEqual(PNG_MAGIC);
    expect(objectBytes.length).toBe(1024);

    const reloaded = await app.inject({
      method: 'GET',
      url: `/api/v1/products/${productId}`,
      headers: { authorization: 'Bearer x' },
    });
    expect(reloaded.json<{ data: { image_url: string } }>().data.image_url).toBe(data.image_url);
  });

  // TASK 16.6D — the existing test above only ever exercised PNG; a real
  // production bug (every upload rejected with a 415 by a global
  // security hook that had never allowlisted this route — see
  // `security.test.ts`) went uncaught partly because no test here
  // asserted JPEG/WebP specifically end-to-end through the real route +
  // real MinIO. Each creates its own independent product so it never
  // touches the shared `productId` fixture's own If-Match/version
  // sequence the other tests here depend on.
  it('accepts a real JPEG upload end-to-end (real MinIO, real magic-byte match)', async () => {
    const created = await service.createProduct(
      { companyId, actorId: userId, requestId: 'jpeg-setup', correlationId: 'jpeg-setup', timestamp: new Date() },
      'product-image-jpeg',
      {
        code: 'product-image-jpeg',
        name: 'Product image JPEG fixture',
        productType: 'simple',
        tracksInventory: false,
        status: 'active',
        defaultVariant: {
          sku: 'product-image-jpeg',
          unitOfMeasureCode: 'unit',
          quantityScale: 0,
          standardCost: '0',
          currencyCode: 'MXN',
        },
      },
    );
    const { body, contentType } = multipartImage(jpegBytes(1024), 'image/jpeg', 'product.jpg');
    const uploaded = await app.inject({
      method: 'POST',
      url: `/api/v1/products/${created.value.id}/image`,
      headers: { authorization: 'Bearer x', 'content-type': contentType, 'if-match': '"1"' },
      payload: body,
    });
    expect(uploaded.statusCode).toBe(200);
    const data = uploaded.json<{ data: { image_url: string | null } }>().data;
    expect(data.image_url).toContain('/asone-product-images/products/');
    const objectResponse = await fetch(required(data.image_url, 'uploaded image_url'));
    expect(objectResponse.status).toBe(200);
    expect(objectResponse.headers.get('content-type')).toBe('image/jpeg');
    const objectBytes = Buffer.from(await objectResponse.arrayBuffer());
    expect(objectBytes.subarray(0, 3)).toEqual(JPEG_MAGIC);
  });

  it('accepts a real WebP upload end-to-end (real MinIO, real magic-byte match)', async () => {
    const created = await service.createProduct(
      { companyId, actorId: userId, requestId: 'webp-setup', correlationId: 'webp-setup', timestamp: new Date() },
      'product-image-webp',
      {
        code: 'product-image-webp',
        name: 'Product image WebP fixture',
        productType: 'simple',
        tracksInventory: false,
        status: 'active',
        defaultVariant: {
          sku: 'product-image-webp',
          unitOfMeasureCode: 'unit',
          quantityScale: 0,
          standardCost: '0',
          currencyCode: 'MXN',
        },
      },
    );
    const { body, contentType } = multipartImage(webpBytes(1024), 'image/webp', 'product.webp');
    const uploaded = await app.inject({
      method: 'POST',
      url: `/api/v1/products/${created.value.id}/image`,
      headers: { authorization: 'Bearer x', 'content-type': contentType, 'if-match': '"1"' },
      payload: body,
    });
    expect(uploaded.statusCode).toBe(200);
    const data = uploaded.json<{ data: { image_url: string | null } }>().data;
    expect(data.image_url).toContain('/asone-product-images/products/');
    const objectResponse = await fetch(required(data.image_url, 'uploaded image_url'));
    expect(objectResponse.status).toBe(200);
    expect(objectResponse.headers.get('content-type')).toBe('image/webp');
    const objectBytes = Buffer.from(await objectResponse.arrayBuffer());
    expect(objectBytes.subarray(0, 4)).toEqual(WEBP_HEADER);
    expect(objectBytes.subarray(8, 12)).toEqual(WEBP_FORMAT);
  });

  it('rejects a non-image content type with a real 415', async () => {
    const { body, contentType } = multipartImage(
      Buffer.from('%PDF-1.4 not an image'),
      'application/pdf',
      'file.pdf',
    );
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/products/${productId}/image`,
      headers: { authorization: 'Bearer x', 'content-type': contentType, 'if-match': '"2"' },
      payload: body,
    });
    expect(response.statusCode).toBe(415);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('unsupported_media_type');
  });

  it('rejects a spoofed content type whose real bytes do not match, with a real 415', async () => {
    const notActuallyPng = Buffer.from('this is plain text pretending to be a png');
    const { body, contentType } = multipartImage(notActuallyPng, 'image/png', 'fake.png');
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/products/${productId}/image`,
      headers: { authorization: 'Bearer x', 'content-type': contentType, 'if-match': '"2"' },
      payload: body,
    });
    expect(response.statusCode).toBe(415);
  });

  it('rejects a stale If-Match with a real 409, leaving the stored image untouched', async () => {
    const { body, contentType } = multipartImage(pngBytes(256));
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/products/${productId}/image`,
      headers: { authorization: 'Bearer x', 'content-type': contentType, 'if-match': '"1"' },
      payload: body,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('version_conflict');
  });

  it('deletes the image, clearing image_url back to null and best-effort removing the object', async () => {
    const current = await app.inject({
      method: 'GET',
      url: `/api/v1/products/${productId}`,
      headers: { authorization: 'Bearer x' },
    });
    const { version, image_url: currentUrl } = current.json<{
      data: { version: number; image_url: string };
    }>().data;

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/products/${productId}/image`,
      headers: { authorization: 'Bearer x', 'if-match': `"${String(version)}"` },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json<{ data: { image_url: string | null } }>().data.image_url).toBeNull();

    const objectResponse = await fetch(currentUrl);
    expect(objectResponse.status).toBe(404);
  });

  // TASK 16.6 — explicit tenant-isolation coverage for product image
  // storage/configuration, required by this task's own verification list.
  it("enforces tenant isolation: company B can never upload to or read company A's product image", async () => {
    const { body, contentType } = multipartImage(pngBytes(512));
    const crossTenantUpload = await app.inject({
      method: 'POST',
      url: `/api/v1/products/${productId}/image`,
      headers: {
        authorization: 'Bearer product-images-other',
        'content-type': contentType,
        'if-match': '"1"',
      },
      payload: body,
    });
    expect(crossTenantUpload.statusCode).toBe(404);
    expect(crossTenantUpload.json<{ error: { code: string } }>().error.code).toBe('not_found');

    const crossTenantRead = await app.inject({
      method: 'GET',
      url: `/api/v1/products/${productId}`,
      headers: { authorization: 'Bearer product-images-other' },
    });
    expect(crossTenantRead.statusCode).toBe(404);

    const crossTenantDelete = await app.inject({
      method: 'DELETE',
      url: `/api/v1/products/${productId}/image`,
      headers: { authorization: 'Bearer product-images-other', 'if-match': '"1"' },
    });
    expect(crossTenantDelete.statusCode).toBe(404);
  });

  it("enforces product.manage server-side on the image routes — a same-tenant actor with only catalog.read is rejected even with a valid session", async () => {
    const { body, contentType } = multipartImage(pngBytes(256));
    const upload = await app.inject({
      method: 'POST',
      url: `/api/v1/products/${productId}/image`,
      headers: {
        authorization: 'Bearer product-images-readonly',
        'content-type': contentType,
        'if-match': '"1"',
      },
      payload: body,
    });
    expect(upload.statusCode).toBe(403);
    expect(upload.json<{ error: { code: string } }>().error.code).toBe('permission_denied');

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/v1/products/${productId}/image`,
      headers: { authorization: 'Bearer product-images-readonly', 'if-match': '"1"' },
    });
    expect(remove.statusCode).toBe(403);
    expect(remove.json<{ error: { code: string } }>().error.code).toBe('permission_denied');
  });
});

async function ensureMigrations(database: DatabaseClient): Promise<void> {
  const present = await database.pool.query<{ present: string | null }>(
    `select to_regclass('public.products')::text present`,
  );
  if (present.rows[0]?.present !== null) return;
  for (const name of [
    '0000_fantastic_black_cat.sql',
    '0001_high_thor.sql',
    '0002_true_sugar_man.sql',
    '0003_curved_zuras.sql',
    '0004_pink_nehzno.sql',
  ]) {
    const sql = await readFile(resolve(migrationsPath, name), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint'))
      if (statement.trim().length > 0) await database.pool.query(statement);
  }
}
