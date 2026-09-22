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
const price = {
  id: '00000000-0000-4000-8000-000000000005',
  companyId,
  branchId: null,
  productId,
  priceType: 'standard',
  amount: '260.0000',
  currencyCode: 'MXN',
  validFrom: now,
  validUntil: null,
  status: 'active' as const,
  version: 2n,
  createdAt: now,
  updatedAt: now,
};
const apps: FastifyInstance[] = [];

interface Fixture {
  app: FastifyInstance;
  createProduct: Mock;
  listProducts: Mock;
  listVariants: Mock;
  exportCsv: Mock;
  patchProduct: Mock;
  duplicateProduct: Mock;
  changeProductPrice: Mock;
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
  const exportCsv = vi.fn(() => Promise.resolve('id,code\r\n'));
  const patchProduct = vi.fn(() => Promise.resolve({ ...product, version: 2n }));
  const duplicateProduct = vi.fn(() =>
    Promise.resolve({
      value: { ...product, id: 'duplicate', code: 'product-copia' },
      replayed: false,
    }),
  );
  const changeProductPrice = vi.fn(() => Promise.resolve({ value: price, replayed: false }));
  const service = {
    listProducts,
    product: vi.fn(() => Promise.resolve(product)),
    createProduct,
    patchProduct,
    duplicateProduct,
    listVariants,
    variant: vi.fn(() => Promise.resolve(variant)),
    createVariant: vi.fn(() => Promise.resolve({ value: variant, replayed: false })),
    patchVariant: vi.fn(() => Promise.resolve({ ...variant, version: 2n })),
    exportCsv,
    changeProductPrice,
    // TASK 16.17 — the default for an omitted `currency_code` is now the
    // tenant's own currency (never a blind 'MXN').
    companyCurrency: vi.fn(() => Promise.resolve('MXN')),
  } as unknown as ProductCatalogService;
  registerProductCatalogRoutes(app, authentication, service);
  await app.ready();
  return {
    app,
    createProduct,
    listProducts,
    listVariants,
    exportCsv,
    patchProduct,
    duplicateProduct,
    changeProductPrice,
  };
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

  // TASK 14.5 (Wave 3, Phase 7, Item 1).
  it('exports the catalog as CSV, gated by catalog.read, with the real filters forwarded', async () => {
    const { app, exportCsv } = await fixture();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/products/export.csv?status=active&search=widget',
      headers: { authorization: 'Bearer x' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.body).toBe('id,code\r\n');
    expect(exportCsv).toHaveBeenCalledWith(companyId, { status: 'active', search: 'widget' });

    const denied = await fixture([]);
    const deniedResponse = await denied.app.inject({
      method: 'GET',
      url: '/api/v1/products/export.csv',
      headers: { authorization: 'Bearer x' },
    });
    expect(deniedResponse.statusCode).toBe(403);
  });

  // TASK 16.6 (Productos/Catálogo legacy parity).
  it('maps the new Extras-tab fields into the create/patch service input', async () => {
    const { app, createProduct, patchProduct } = await fixture(['product.manage']);
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/products',
      headers: { authorization: 'Bearer x', 'idempotency-key': 'key' },
      payload: {
        code: 'extras',
        name: 'Extras',
        product_type: 'simple',
        status: 'active',
        image_url: 'https://cdn.example.test/x.png',
        icon_key: 'pizza',
        card_style: 'solid',
        card_color_hex: '#6B3FA0',
        is_featured: true,
        preferred_supplier_id: variantId,
        default_variant: {
          sku: 'extras-sku',
          unit_of_measure_code: 'unit',
          min_stock: '5',
        },
      },
    });
    expect(create.statusCode).toBe(201);
    const call = createProduct.mock.calls[0] as [unknown, string, CreateProductInput] | undefined;
    expect(call?.[2]).toMatchObject({
      imageUrl: 'https://cdn.example.test/x.png',
      iconKey: 'pizza',
      cardStyle: 'solid',
      cardColorHex: '#6B3FA0',
      isFeatured: true,
      preferredSupplierId: variantId,
    });
    expect(call?.[2].defaultVariant).toMatchObject({ minStock: '5' });

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/products/${productId}`,
      headers: { authorization: 'Bearer x', 'if-match': '"1"' },
      payload: { card_style: 'default', card_color_hex: null, image_url: null },
    });
    expect(patch.statusCode).toBe(200);
    const patchCall = patchProduct.mock.calls[0] as
      [unknown, string, bigint, Record<string, unknown>] | undefined;
    expect(patchCall?.[3]).toMatchObject({
      cardStyle: 'default',
      cardColorHex: null,
      imageUrl: null,
    });
  });

  it('rejects an unrecognized icon_key, card_style, and a malformed card_color_hex/image_url at the schema boundary', async () => {
    const { app } = await fixture(['product.manage']);
    const badIcon = await app.inject({
      method: 'POST',
      url: '/api/v1/products',
      headers: { authorization: 'Bearer x', 'idempotency-key': 'key' },
      payload: { code: 'p', name: 'P', product_type: 'variable', icon_key: 'not-a-real-icon' },
    });
    const badCardStyle = await app.inject({
      method: 'POST',
      url: '/api/v1/products',
      headers: { authorization: 'Bearer x', 'idempotency-key': 'key' },
      payload: { code: 'p', name: 'P', product_type: 'variable', card_style: 'rainbow' },
    });
    const badHex = await app.inject({
      method: 'POST',
      url: '/api/v1/products',
      headers: { authorization: 'Bearer x', 'idempotency-key': 'key' },
      payload: { code: 'p', name: 'P', product_type: 'variable', card_color_hex: 'purple' },
    });
    const badUrl = await app.inject({
      method: 'POST',
      url: '/api/v1/products',
      headers: { authorization: 'Bearer x', 'idempotency-key': 'key' },
      payload: { code: 'p', name: 'P', product_type: 'variable', image_url: 'not-a-url' },
    });
    expect(badIcon.statusCode).toBe(400);
    expect(badCardStyle.statusCode).toBe(400);
    expect(badHex.statusCode).toBe(400);
    expect(badUrl.statusCode).toBe(400);
  });

  it('duplicates a product, gated by product.manage, returning the new representation with a 201', async () => {
    const { app, duplicateProduct } = await fixture(['product.manage']);
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/products/${productId}/duplicate`,
      headers: { authorization: 'Bearer x' },
    });
    expect(response.statusCode).toBe(201);
    expect(duplicateProduct).toHaveBeenCalledWith(
      expect.objectContaining({ companyId, actorId: userId }),
      productId,
    );
    expect(response.json<{ data: { code: string } }>().data.code).toBe('product-copia');

    const denied = await fixture([]);
    const deniedResponse = await denied.app.inject({
      method: 'POST',
      url: `/api/v1/products/${productId}/duplicate`,
      headers: { authorization: 'Bearer x' },
    });
    expect(deniedResponse.statusCode).toBe(403);
  });

  // TASK 16.6C — the real "cambiar precio" route: distinct from
  // `POST .../prices` (unchanged, still 409s on a genuine append conflict
  // — see the service-level integration tests for that operation's own
  // real-Postgres coverage), this one is exercised here against a mocked
  // service since its route-level contract (schema, permission gate,
  // response shape) needs no real database to verify.
  it('changes a product price, gated by price.manage, returning the new current price with a 200', async () => {
    const { app, changeProductPrice } = await fixture(['price.manage']);
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/products/${productId}/prices/change`,
      headers: { authorization: 'Bearer x', 'idempotency-key': 'price-change-key-1' },
      payload: { amount: '260.00', currency_code: 'MXN' },
    });
    expect(response.statusCode).toBe(200);
    expect(changeProductPrice).toHaveBeenCalledWith(
      expect.objectContaining({ companyId, actorId: userId }),
      productId,
      expect.any(String),
      { amount: '260.00', currencyCode: 'MXN' },
    );
    expect(response.json<{ data: { amount: string; status: string } }>().data).toMatchObject({
      amount: '260.0000',
      status: 'active',
    });

    // A same-tenant actor with a valid session but no `price.manage`
    // (e.g. a cashier who knows the endpoint) gets a real 403 — never a
    // UI-only gate — and the service is never even called.
    const denied = await fixture(['catalog.read']);
    const deniedResponse = await denied.app.inject({
      method: 'POST',
      url: `/api/v1/products/${productId}/prices/change`,
      headers: { authorization: 'Bearer x', 'idempotency-key': 'price-change-key-2' },
      payload: { amount: '260.00', currency_code: 'MXN' },
    });
    expect(deniedResponse.statusCode).toBe(403);
    expect(denied.changeProductPrice).not.toHaveBeenCalled();
  });
});
