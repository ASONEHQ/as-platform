import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, type Mock, vi } from 'vitest';

import { AppError } from '@asone/errors';

import type { AuthService } from '../auth/auth.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { registerProductCatalogRoutes } from './product-catalog.routes.js';
import type { ProductCatalogService } from './product-catalog.service.js';
import type { CreateProductInput } from './product-catalog.types.js';

const companyId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const productId = '00000000-0000-4000-8000-000000000003';
const variantId = '00000000-0000-4000-8000-000000000004';
const now = new Date('2026-07-27T00:00:00.000Z');
const variant = {
  id: variantId,
  companyId,
  productId,
  sku: 'SKU-1',
  name: null,
  unitOfMeasureCode: 'unit',
  quantityScale: 0,
  tracksInventory: true,
  standardCost: '12.3400',
  currencyCode: 'MXN',
  isDefault: true,
  status: 'active' as const,
  version: 1n,
  createdAt: now,
  updatedAt: now,
};
const product = {
  id: productId,
  companyId,
  categoryId: null,
  brandId: null,
  code: 'product',
  name: 'Product',
  description: null,
  productType: 'simple' as const,
  tracksInventory: true,
  status: 'active' as const,
  version: 1n,
  createdAt: now,
  updatedAt: now,
  defaultVariant: variant,
};
const apps: FastifyInstance[] = [];

interface Fixture {
  app: FastifyInstance;
  createProduct: Mock;
  listProducts: Mock;
  listVariants: Mock;
}

async function fixture(
  permissions: string[] = ['catalog.read', 'product.manage'],
): Promise<Fixture> {
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
  const authentication = {
    authenticate: vi.fn(() => Promise.resolve(context)),
    requirePermission: vi.fn((_context: AuthContext, permission: string) => {
      if (!permissions.includes(permission))
        throw new AppError({ code: 'permission_denied', message: 'Denied', statusCode: 403 });
    }),
  } as unknown as AuthService;
  const listProducts = vi.fn(() => Promise.resolve({ items: [product], nextCursor: null }));
  const createProduct = vi.fn(() => Promise.resolve({ value: product, replayed: false }));
  const listVariants = vi.fn(() => Promise.resolve({ items: [variant], nextCursor: null }));
  const service = {
    listProducts,
    product: vi.fn(() => Promise.resolve(product)),
    createProduct,
    patchProduct: vi.fn(() => Promise.resolve({ ...product, version: 2n })),
    listVariants,
    variant: vi.fn(() => Promise.resolve(variant)),
    createVariant: vi.fn(() => Promise.resolve({ value: variant, replayed: false })),
    patchVariant: vi.fn(() => Promise.resolve({ ...variant, version: 2n })),
  } as unknown as ProductCatalogService;
  registerProductCatalogRoutes(app, authentication, service);
  await app.ready();
  return { app, createProduct, listProducts, listVariants };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe('product catalog HTTP routes', () => {
  it('passes product filters and emits pagination metadata', async () => {
    const { app, listProducts } = await fixture();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/products?status=active&product_type=simple&category_id=${productId}&brand_id=${variantId}&search=pro&sku=SKU-1&barcode=123`,
      headers: { authorization: 'Bearer x' },
    });
    expect(response.statusCode).toBe(200);
    expect(listProducts).toHaveBeenCalledWith(companyId, {
      limit: 50,
      status: 'active',
      productType: 'simple',
      categoryId: productId,
      brandId: variantId,
      search: 'pro',
      sku: 'SKU-1',
      barcode: '123',
    });
    expect(response.json()).toMatchObject({ meta: { page: { has_more: false } } });
  });

  it('omits costs without inventory.cost.read and includes them with it', async () => {
    const without = await fixture();
    const hidden = await without.app.inject({
      method: 'GET',
      url: `/api/v1/product-variants/${variantId}`,
      headers: { authorization: 'Bearer x' },
    });
    const hiddenBody = hidden.json<{ data: Record<string, unknown> }>();
    expect(hiddenBody.data).not.toHaveProperty('standard_cost');
    expect(hiddenBody.data).not.toHaveProperty('currency_code');

    const withCost = await fixture(['catalog.read', 'inventory.cost.read']);
    const visible = await withCost.app.inject({
      method: 'GET',
      url: `/api/v1/product-variants/${variantId}`,
      headers: { authorization: 'Bearer x' },
    });
    const visibleBody = visible.json<{ data: Record<string, unknown> }>();
    expect(visibleBody.data).toMatchObject({
      standard_cost: '12.3400',
      currency_code: 'MXN',
    });
  });

  it('requires idempotency keys and If-Match headers', async () => {
    const { app } = await fixture();
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/products',
      headers: { authorization: 'Bearer x' },
      payload: { code: 'p', name: 'P', product_type: 'variable' },
    });
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/products/${productId}`,
      headers: { authorization: 'Bearer x' },
      payload: { name: 'Changed' },
    });
    expect(create.statusCode).toBe(400);
    expect(patch.statusCode).toBe(400);
  });

  it('rejects unknown fields at every mutation boundary', async () => {
    const { app } = await fixture();
    const productResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/products',
      headers: {
        authorization: 'Bearer x',
        'idempotency-key': 'key',
      },
      payload: { code: 'p', name: 'P', product_type: 'variable', company_id: companyId },
    });
    const variantResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/products/${productId}/variants`,
      headers: {
        authorization: 'Bearer x',
        'idempotency-key': 'key',
      },
      payload: { sku: 's', unit_of_measure_code: 'unit', normalized_sku: 's' },
    });
    expect(productResponse.statusCode).toBe(400);
    expect(variantResponse.statusCode).toBe(400);
  });

  it('maps nested default variants and barcodes into the E054 service input', async () => {
    const { app, createProduct } = await fixture(['product.manage']);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/products',
      headers: { authorization: 'Bearer x', 'idempotency-key': 'key' },
      payload: {
        code: 'access',
        name: 'Access',
        product_type: 'simple',
        tracks_inventory: true,
        status: 'active',
        default_variant: {
          sku: 'access-1',
          unit_of_measure_code: 'unit',
          standard_cost: '10.0000',
          barcode: { type: 'internal', value: 'A-1' },
        },
      },
    });
    expect(response.statusCode).toBe(201);
    expect(createProduct).toHaveBeenCalledOnce();
    const call = createProduct.mock.calls[0] as [unknown, string, CreateProductInput] | undefined;
    expect(call?.[0]).toMatchObject({ companyId, actorId: userId });
    expect(call?.[1]).toBe('key');
    expect(call?.[2].defaultVariant).toMatchObject({
      sku: 'access-1',
      barcode: { type: 'internal', value: 'A-1', isPrimary: true },
    });
  });

  it('returns ETags and forwards variant status filters', async () => {
    const { app, listVariants } = await fixture();
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/products/${productId}`,
      headers: { authorization: 'Bearer x' },
    });
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/products/${productId}/variants?status=inactive`,
      headers: { authorization: 'Bearer x' },
    });
    expect(detail.headers.etag).toBe('"1"');
    expect(list.statusCode).toBe(200);
    expect(listVariants).toHaveBeenCalledWith(companyId, productId, {
      limit: 50,
      status: 'inactive',
    });
  });

  it('enforces catalog.read and product.manage independently', async () => {
    const { app } = await fixture([]);
    const read = await app.inject({
      method: 'GET',
      url: '/api/v1/products',
      headers: { authorization: 'Bearer x' },
    });
    const mutation = await app.inject({
      method: 'PATCH',
      url: `/api/v1/product-variants/${variantId}`,
      headers: { authorization: 'Bearer x', 'if-match': '"1"' },
      payload: { name: 'Changed' },
    });
    expect(read.statusCode).toBe(403);
    expect(mutation.statusCode).toBe(403);
  });
});
