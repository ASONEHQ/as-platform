import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@asone/errors';

import type { AuthService } from '../auth/auth.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { registerProductOptionsRoutes } from './product-options.routes.js';
import type { ProductOptionsService } from './product-options.service.js';

const companyId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const productId = '00000000-0000-4000-8000-000000000003';
const optionId = '00000000-0000-4000-8000-000000000004';
const valueId = '00000000-0000-4000-8000-000000000005';
const variantId = '00000000-0000-4000-8000-000000000006';
const barcodeId = '00000000-0000-4000-8000-000000000007';
const now = new Date('2026-07-27T00:00:00.000Z');
const option = {
  id: optionId,
  companyId,
  productId,
  code: 'color',
  name: 'Color',
  displayOrder: 0,
  status: 'active' as const,
  version: 1n,
  createdAt: now,
  updatedAt: now,
};
const value = {
  ...option,
  id: valueId,
  optionDefinitionId: optionId,
  code: 'red',
  name: 'Red',
};
const barcode = {
  id: barcodeId,
  companyId,
  productVariantId: variantId,
  barcodeType: 'internal' as const,
  value: 'red-1',
  isPrimary: true,
  status: 'active' as const,
  version: 1n,
  createdAt: now,
  updatedAt: now,
};
const apps: FastifyInstance[] = [];

async function fixture(permissions = ['catalog.read', 'product.manage']): Promise<FastifyInstance> {
  const app = Fastify();
  apps.push(app);
  app.addHook('onRequest', (request, _reply, done) => {
    request.requestContext = {
      requestId: 'request',
      correlationId: 'correlation',
      companyId: undefined,
      branchId: undefined,
      userId: undefined,
      sessionId: undefined,
      deviceId: undefined,
    };
    done();
  });
  app.setErrorHandler((error, request, reply) =>
    error instanceof AppError
      ? reply.code(error.statusCode).send({
          error: { code: error.code },
          meta: { request_id: request.requestContext.requestId },
        })
      : typeof error === 'object' && error !== null && 'validation' in error
        ? reply.code(400).send({ error: { code: 'validation_error' } })
        : reply.code(500).send({ error: { code: 'internal_error' } }),
  );
  const authContext: AuthContext = {
    companyId,
    userId,
    membershipId: userId,
    sessionId: userId,
    expiresAt: new Date(Date.now() + 60_000),
    permissions,
    permittedBranchIds: [],
  };
  const auth = {
    authenticate: vi.fn(() => Promise.resolve(authContext)),
    requirePermission: vi.fn((_context: AuthContext, permission: string) => {
      if (!permissions.includes(permission))
        throw new AppError({ code: 'permission_denied', message: 'Denied', statusCode: 403 });
    }),
  } as unknown as AuthService;
  const service = {
    listOptions: vi.fn(() => Promise.resolve({ items: [option], nextCursor: null })),
    createOption: vi.fn(() => Promise.resolve({ value: option, replayed: false })),
    patchOption: vi.fn(() => Promise.resolve({ ...option, version: 2n })),
    listValues: vi.fn(() => Promise.resolve({ items: [value], nextCursor: null })),
    createValue: vi.fn(() => Promise.resolve({ value, replayed: false })),
    patchValue: vi.fn(() => Promise.resolve({ ...value, version: 2n })),
    createBarcode: vi.fn(() => Promise.resolve({ value: barcode, replayed: false })),
    retireBarcode: vi.fn(() =>
      Promise.resolve({ ...barcode, isPrimary: false, status: 'retired' as const, version: 2n }),
    ),
  } as unknown as ProductOptionsService;
  registerProductOptionsRoutes(app, auth, service);
  await app.ready();
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe('product option and barcode HTTP routes', () => {
  it('serves option and value lists with stable envelopes', async () => {
    const app = await fixture();
    const options = await app.inject({
      method: 'GET',
      url: `/api/v1/products/${productId}/options?status=active&search=color`,
      headers: { authorization: 'Bearer x' },
    });
    const values = await app.inject({
      method: 'GET',
      url: `/api/v1/product-options/${optionId}/values`,
      headers: { authorization: 'Bearer x' },
    });
    expect(options.statusCode).toBe(200);
    expect(options.json()).toMatchObject({ data: [{ id: optionId }], meta: { page: {} } });
    expect(values.statusCode).toBe(200);
    expect(values.json()).toMatchObject({ data: [{ id: valueId, option_id: optionId }] });
  });

  it('requires idempotency and If-Match and rejects server-owned fields', async () => {
    const app = await fixture();
    const missingKey = await app.inject({
      method: 'POST',
      url: `/api/v1/products/${productId}/options`,
      headers: { authorization: 'Bearer x' },
      payload: { code: 'size', name: 'Size' },
    });
    const unknown = await app.inject({
      method: 'POST',
      url: `/api/v1/product-options/${optionId}/values`,
      headers: { authorization: 'Bearer x', 'idempotency-key': 'key' },
      payload: { code: 'large', name: 'Large', normalized_code: 'large' },
    });
    const missingMatch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/product-option-values/${valueId}`,
      headers: { authorization: 'Bearer x' },
      payload: { name: 'Changed' },
    });
    expect(missingKey.statusCode).toBe(400);
    expect(unknown.statusCode).toBe(400);
    expect(missingMatch.statusCode).toBe(400);
  });

  it('creates and retires barcodes with contractual headers and permissions', async () => {
    const app = await fixture(['product.manage']);
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/product-variants/${variantId}/barcodes`,
      headers: { authorization: 'Bearer x', 'idempotency-key': 'barcode-key' },
      payload: { barcode: 'red-1', barcode_type: 'internal', is_primary: true },
    });
    const retired = await app.inject({
      method: 'DELETE',
      url: `/api/v1/product-barcodes/${barcodeId}`,
      headers: { authorization: 'Bearer x', 'if-match': '"1"' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.headers.etag).toBe('"1"');
    expect(retired.statusCode).toBe(200);
    expect(retired.json()).toMatchObject({ data: { status: 'retired', is_primary: false } });
  });

  it('enforces read and mutation permissions independently', async () => {
    const app = await fixture([]);
    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/products/${productId}/options`,
      headers: { authorization: 'Bearer x' },
    });
    const mutation = await app.inject({
      method: 'PATCH',
      url: `/api/v1/product-options/${optionId}`,
      headers: { authorization: 'Bearer x', 'if-match': '"1"' },
      payload: { name: 'Changed' },
    });
    expect(read.statusCode).toBe(403);
    expect(mutation.statusCode).toBe(403);
  });
});
