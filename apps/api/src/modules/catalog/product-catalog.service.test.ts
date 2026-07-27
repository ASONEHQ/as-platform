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

  it('rejects non-empty option sets until product options are implemented', () => {
    const service = new ProductCatalogService({} as ProductCatalogRepository);
    expect(() =>
      service.createVariant(context, crypto.randomUUID(), 'key', {
        sku: 'sku',
        unitOfMeasureCode: 'unit',
        quantityScale: 0,
        standardCost: '0',
        currencyCode: 'MXN',
        isDefault: true,
        status: 'active',
        optionValueIds: [crypto.randomUUID()] as never,
      }),
    ).toThrow(ProductCatalogError);
  });
});
