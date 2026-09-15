import { describe, expect, it, vi } from 'vitest';

import type { ProductCatalogRepository } from './product-catalog.repository.js';
import { ProductCatalogService } from './product-catalog.service.js';
import type { ProductCatalogTransaction, ProductDetail } from './product-catalog.types.js';
import { ProductCatalogError } from './product-catalog.types.js';

const context = {
  companyId: '00000000-0000-4000-8000-000000000001',
  actorId: '00000000-0000-4000-8000-000000000002',
  requestId: 'request',
  correlationId: 'correlation',
  timestamp: new Date('2026-07-27T00:00:00.000Z'),
};

describe('product catalog service validation', () => {
  it('requires default variants for simple, service, and kit products', () => {
    const service = new ProductCatalogService({} as ProductCatalogRepository);
    for (const productType of ['simple', 'service', 'kit'] as const)
      expect(() =>
        service.createProduct(context, productType, {
          code: productType,
          name: productType,
          productType,
          tracksInventory: false,
          status: 'draft',
        }),
      ).toThrow(ProductCatalogError);
  });

  it('allows a draft variable without a variant but rejects an active one', () => {
    const repository = {
      transaction: vi.fn(),
    } as unknown as ProductCatalogRepository;
    const service = new ProductCatalogService(repository);
    expect(() =>
      service.createProduct(context, 'active', {
        code: 'active',
        name: 'Active',
        productType: 'variable',
        tracksInventory: false,
        status: 'active',
      }),
    ).toThrow(ProductCatalogError);
    expect(() =>
      service.createProduct(context, 'draft', {
        code: 'draft',
        name: 'Draft',
        productType: 'variable',
        tracksInventory: false,
        status: 'draft',
      }),
    ).not.toThrow();
  });

  it('rejects explicit inventory tracking for service and kit records', () => {
    const service = new ProductCatalogService({} as ProductCatalogRepository);
    for (const productType of ['service', 'kit'] as const)
      expect(() =>
        service.createProduct(context, productType, {
          code: productType,
          name: productType,
          productType,
          tracksInventory: true,
          status: 'draft',
          defaultVariant: {
            sku: `${productType}-sku`,
            unitOfMeasureCode: 'unit',
            quantityScale: 0,
            standardCost: '0',
            currencyCode: 'MXN',
          },
        }),
      ).toThrow(ProductCatalogError);
  });

  it('excludes generated UUIDs from the idempotency request hash', async () => {
    const hashes: string[] = [];
    const repository = {
      transaction: vi.fn(
        (callback: (client: ProductCatalogTransaction) => Promise<unknown>): Promise<unknown> =>
          callback({ query: (): Promise<unknown> => Promise.resolve({ rows: [] }) }),
      ),
      idempotent: vi.fn(
        (
          _client: ProductCatalogTransaction,
          _context: unknown,
          _operation: string,
          _key: string,
          requestHash: string,
        ): Promise<{ value: ProductDetail; replayed: boolean }> => {
          hashes.push(requestHash);
          return Promise.resolve({ value: {} as ProductDetail, replayed: false });
        },
      ),
    } as unknown as ProductCatalogRepository;
    const service = new ProductCatalogService(repository);
    const input = {
      code: 'variable',
      name: 'Variable',
      productType: 'variable' as const,
      tracksInventory: false,
      status: 'draft' as const,
    };
    await service.createProduct(context, 'one', input);
    await service.createProduct(context, 'two', input);
    expect(hashes).toEqual([hashes[0], hashes[0]]);
  });

  // TASK 16.6 (Productos/Catálogo legacy parity) — validation for the
  // new Extras-tab fields (image/icon/card-appearance/featured/
  // supplier) added to `createProduct`. Each of these throws
  // synchronously before ever touching the repository, mirroring the
  // existing sync-validation tests above.
  it('rejects an icon_key that is not in the platform-defined allowlist', () => {
    const service = new ProductCatalogService({} as ProductCatalogRepository);
    expect(() =>
      service.createProduct(context, 'bad-icon', {
        code: 'bad-icon',
        name: 'Bad icon',
        productType: 'service',
        tracksInventory: false,
        status: 'draft',
        iconKey: 'not-a-real-icon' as never,
        defaultVariant: {
          sku: 'bad-icon-sku',
          unitOfMeasureCode: 'unit',
          quantityScale: 0,
          standardCost: '0',
          currencyCode: 'MXN',
        },
      }),
    ).toThrow(ProductCatalogError);
  });

  it('requires card_color_hex when card_style is not "default"', () => {
    const service = new ProductCatalogService({} as ProductCatalogRepository);
    for (const cardStyle of ['gradient', 'solid'] as const)
      expect(() =>
        service.createProduct(context, `card-${cardStyle}`, {
          code: `card-${cardStyle}`,
          name: 'Card style',
          productType: 'service',
          tracksInventory: false,
          status: 'draft',
          cardStyle,
          defaultVariant: {
            sku: `card-${cardStyle}-sku`,
            unitOfMeasureCode: 'unit',
            quantityScale: 0,
            standardCost: '0',
            currencyCode: 'MXN',
          },
        }),
      ).toThrow(ProductCatalogError);
  });

  it('allows card_style "default" without a card_color_hex, and a valid hex with "solid"', () => {
    const repository = {
      transaction: vi.fn(),
    } as unknown as ProductCatalogRepository;
    const service = new ProductCatalogService(repository);
    expect(() =>
      service.createProduct(context, 'card-default', {
        code: 'card-default',
        name: 'Default card',
        productType: 'service',
        tracksInventory: false,
        status: 'draft',
        defaultVariant: {
          sku: 'card-default-sku',
          unitOfMeasureCode: 'unit',
          quantityScale: 0,
          standardCost: '0',
          currencyCode: 'MXN',
        },
      }),
    ).not.toThrow();
    expect(() =>
      service.createProduct(context, 'card-solid', {
        code: 'card-solid',
        name: 'Solid card',
        productType: 'service',
        tracksInventory: false,
        status: 'draft',
        cardStyle: 'solid',
        cardColorHex: '#6B3FA0',
        defaultVariant: {
          sku: 'card-solid-sku',
          unitOfMeasureCode: 'unit',
          quantityScale: 0,
          standardCost: '0',
          currencyCode: 'MXN',
        },
      }),
    ).not.toThrow();
  });

  it('rejects a malformed card_color_hex', () => {
    const service = new ProductCatalogService({} as ProductCatalogRepository);
    expect(() =>
      service.createProduct(context, 'bad-hex', {
        code: 'bad-hex',
        name: 'Bad hex',
        productType: 'service',
        tracksInventory: false,
        status: 'draft',
        cardStyle: 'solid',
        cardColorHex: 'purple',
        defaultVariant: {
          sku: 'bad-hex-sku',
          unitOfMeasureCode: 'unit',
          quantityScale: 0,
          standardCost: '0',
          currencyCode: 'MXN',
        },
      }),
    ).toThrow(ProductCatalogError);
  });

  it('rejects an image_url that is not an absolute http(s) URL (no SSRF-relevant scheme)', () => {
    const service = new ProductCatalogService({} as ProductCatalogRepository);
    for (const imageUrl of ['ftp://example.com/x.png', 'javascript:alert(1)', 'not-a-url'])
      expect(() =>
        service.createProduct(context, `bad-url-${imageUrl}`, {
          code: `bad-url-${imageUrl}`,
          name: 'Bad url',
          productType: 'service',
          tracksInventory: false,
          status: 'draft',
          imageUrl,
          defaultVariant: {
            sku: `bad-url-sku-${imageUrl}`,
            unitOfMeasureCode: 'unit',
            quantityScale: 0,
            standardCost: '0',
            currencyCode: 'MXN',
          },
        }),
      ).toThrow(ProductCatalogError);
  });

  it('rejects a malformed min_stock on the default variant', () => {
    const service = new ProductCatalogService({} as ProductCatalogRepository);
    expect(() =>
      service.createProduct(context, 'bad-min-stock', {
        code: 'bad-min-stock',
        name: 'Bad min stock',
        productType: 'service',
        tracksInventory: false,
        status: 'draft',
        defaultVariant: {
          sku: 'bad-min-stock-sku',
          unitOfMeasureCode: 'unit',
          quantityScale: 0,
          standardCost: '0',
          currencyCode: 'MXN',
          minStock: '-5',
        },
      }),
    ).toThrow(ProductCatalogError);
  });
});
