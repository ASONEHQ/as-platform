import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, type Mock, vi } from 'vitest';

import { AppError } from '@asone/errors';

import type { AuthService } from '../auth/auth.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { registerCatalogRoutes } from './catalog.routes.js';
import type { CatalogService } from './catalog.service.js';
import { CatalogApplicationError } from './catalog.types.js';

const apps: FastifyInstance[] = [];
const companyId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const categoryId = '00000000-0000-4000-8000-000000000003';
const now = new Date('2026-07-27T00:00:00.000Z');
const category = {
  id: categoryId,
  companyId,
  parentId: null,
  code: 'food',
  name: 'Food',
  description: null,
  sortOrder: 0,
  status: 'active' as const,
  version: 1n,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
};
const brand = {
  id: '00000000-0000-4000-8000-000000000004',
  companyId,
  code: 'acme',
  name: 'Acme',
  description: null,
  status: 'active' as const,
  version: 1n,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
};

async function fixture(
  permissions = ['catalog.read', 'category.manage', 'product.manage'],
): Promise<{
  readonly app: FastifyInstance;
  readonly service: CatalogService;
  readonly listCategories: Mock;
  readonly categoryDetail: Mock;
}> {
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
  const context: AuthContext = {
    companyId,
    userId,
    membershipId: userId,
    sessionId: userId,
    expiresAt: new Date(Date.now() + 60_000),
    permissions,
    permittedBranchIds: [],
  };
  const auth = {
    authenticate: vi.fn(() => Promise.resolve(context)),
    requirePermission: vi.fn((_c: AuthContext, p: string) => {
      if (!permissions.includes(p))
        throw new AppError({ code: 'permission_denied', message: 'Denied', statusCode: 403 });
    }),
  } as unknown as AuthService;
  const listCategories = vi.fn(() => Promise.resolve({ items: [category], nextCursor: null }));
  const categoryDetail = vi.fn(() => Promise.resolve(category));
  const service = {
    listCategories,
    category: categoryDetail,
    createCategory: vi.fn(() => Promise.resolve({ value: category, replayed: false })),
    patchCategory: vi.fn(() => Promise.resolve({ ...category, version: 2n })),
    listBrands: vi.fn(() => Promise.resolve({ items: [brand], nextCursor: null })),
    createBrand: vi.fn(() => Promise.resolve({ value: brand, replayed: false })),
    patchBrand: vi.fn(() => Promise.resolve({ ...brand, version: 2n })),
  } as unknown as CatalogService;
  registerCatalogRoutes(app, auth, service);
  await app.ready();
  return {
    app,
    service,
    listCategories,
    categoryDetail,
  };
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe('catalog HTTP routes', () => {
  it('lists categories with pagination metadata', async () => {
    const { app } = await fixture();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/categories?limit=10',
      headers: { authorization: 'Bearer x' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: [{ id: categoryId }],
      meta: { page: { has_more: false } },
    });
  });
  it('passes category filters and serves detail with a stable envelope and ETag', async () => {
    const { app, listCategories } = await fixture();
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/categories?limit=5&status=active&parent_id=${categoryId}&search=food`,
      headers: { authorization: 'Bearer x' },
    });
    expect(list.statusCode).toBe(200);
    expect(listCategories).toHaveBeenCalledWith(companyId, {
      limit: 5,
      status: 'active',
      parentId: categoryId,
      search: 'food',
    });
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/categories/${categoryId}`,
      headers: { authorization: 'Bearer x' },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.headers.etag).toBe('"1"');
    expect(detail.json()).toMatchObject({
      data: { id: categoryId },
      meta: { request_id: 'request', correlation_id: 'correlation' },
    });
  });
  it('requires Idempotency-Key and rejects unknown fields', async () => {
    const { app } = await fixture();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/categories',
          headers: { authorization: 'Bearer x' },
          payload: { code: 'food', name: 'Food' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/categories',
          headers: { authorization: 'Bearer x', 'idempotency-key': 'key' },
          payload: { code: 'food', name: 'Food', company_id: companyId },
        })
      ).statusCode,
    ).toBe(400);
  });
  it('requires If-Match and the contractual permission', async () => {
    const { app } = await fixture([]);
    const denied = await app.inject({
      method: 'PATCH',
      url: `/api/v1/categories/${categoryId}`,
      headers: { authorization: 'Bearer x', 'if-match': '"1"' },
      payload: { name: 'New' },
    });
    expect(denied.statusCode).toBe(403);
    const allowed = await fixture();
    expect(
      (
        await allowed.app.inject({
          method: 'PATCH',
          url: `/api/v1/categories/${categoryId}`,
          headers: { authorization: 'Bearer x' },
          payload: { name: 'New' },
        })
      ).statusCode,
    ).toBe(400);
  });
  it('hides cross-tenant resources behind the stable not-found envelope', async () => {
    const { app, categoryDetail } = await fixture();
    categoryDetail.mockRejectedValueOnce(
      new CatalogApplicationError('resource_not_found', 'Hidden'),
    );
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/categories/${categoryId}`,
      headers: { authorization: 'Bearer x' },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: { code: 'not_found' },
      meta: { request_id: 'request' },
    });
  });
  it('implements brand list, create idempotency, patch versioning, and permissions', async () => {
    const { app } = await fixture();
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/brands?status=active&search=acme',
          headers: { authorization: 'Bearer x' },
        })
      ).statusCode,
    ).toBe(200);
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/brands',
      headers: { authorization: 'Bearer x', 'idempotency-key': 'brand-key' },
      payload: { code: 'acme', name: 'Acme' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.headers.etag).toBe('"1"');
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/brands/${brand.id}`,
      headers: { authorization: 'Bearer x', 'if-match': '"1"' },
      payload: { name: 'Updated' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.headers.etag).toBe('"2"');
    const denied = await fixture([]);
    expect(
      (
        await denied.app.inject({
          method: 'POST',
          url: '/api/v1/brands',
          headers: { authorization: 'Bearer x', 'idempotency-key': 'denied' },
          payload: { code: 'denied', name: 'Denied' },
        })
      ).statusCode,
    ).toBe(403);
  });
});
