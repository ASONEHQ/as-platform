import { describe, expect, it, vi } from 'vitest';

import type { ProductCatalogRepository } from './product-catalog.repository.js';
import { ProductCatalogService } from './product-catalog.service.js';
import type { ProductImageStorage } from './product-images.storage.js';
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

// TASK 17.1 — the CRITICAL cross-tenant regression test for the
// product-image object-storage deletion vulnerability found during
// TASK 17.0 (the identical pattern already fixed for branding logos,
// applied here). `products.image_url` accepts a client-pasted external
// URL (a documented legacy-parity feature — see the `imageUrl` validation
// tests above), so a value read back from a product row is not guaranteed
// to be a key this company's own upload produced — it could be another
// company's real, publicly-readable product-image URL.
//
// `deleteProductImage` reads `before.imageUrl`, then delegates the actual
// product mutation to `patchProduct` (a large, independently-tested
// method with its own repository/variant-state machinery — see the
// validation suite above) before ever touching object storage. This
// suite stubs `patchProduct` itself (a real, public method on the same
// class) rather than re-building patchProduct's own repository fakes, so
// it exercises the REAL `deleteProductImage` logic — the exact code this
// task changed — without duplicating unrelated coverage.
describe('ProductCatalogService.deleteProductImage — cross-tenant object-storage safety', () => {
  const companyA = '11111111-1111-1111-1111-111111111111';
  const companyB = '22222222-2222-2222-2222-222222222222';

  function productRow(overrides: Partial<ProductDetail>): ProductDetail {
    return {
      id: 'product-id',
      companyId: companyA,
      categoryId: null,
      brandId: null,
      code: 'code',
      name: 'Name',
      description: null,
      productType: 'service',
      tracksInventory: false,
      taxCode: 'IVA_EXEMPT',
      status: 'active',
      imageUrl: null,
      iconKey: null,
      cardStyle: 'default',
      cardColorHex: null,
      isFeatured: false,
      preferredSupplierId: null,
      version: 1n,
      createdAt: new Date('2026-09-28T00:00:00.000Z'),
      updatedAt: new Date('2026-09-28T00:00:00.000Z'),
      defaultVariant: null,
      effectivePrice: null,
      ...overrides,
    };
  }

  // Plain, arrow-typed double — deliberately NOT typed as the real
  // `ProductImageStorage` class at the point of declaration (only cast at
  // the point it's actually injected into the service), so
  // `expect(imageStorage.deleteObjectBestEffort)` references a plain
  // function property rather than a class method, matching the same
  // pattern already used by `settings.routes.test.ts`'s `ServiceDouble`.
  interface ImageStorageDouble {
    keyFromUrl: ReturnType<typeof vi.fn>;
    isOwnedKey: ReturnType<typeof vi.fn>;
    deleteObjectBestEffort: ReturnType<typeof vi.fn>;
  }

  function fakeImageStorage(): ImageStorageDouble {
    const prefix = 'products';
    return {
      keyFromUrl: vi.fn((url: string): string | undefined => {
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          return undefined;
        }
        const marker = '/asone-product-images/';
        const index = parsed.pathname.indexOf(marker);
        if (index === -1) return undefined;
        const key = parsed.pathname.slice(index + marker.length);
        return key.length === 0 ? undefined : key;
      }),
      isOwnedKey: vi.fn((key: string, companyId: string): boolean => {
        const segments = key.split('/');
        return (
          segments.length === 3 &&
          segments[0] === prefix &&
          segments[1] === companyId &&
          (segments[2]?.length ?? 0) > 0
        );
      }),
      deleteObjectBestEffort: vi.fn(() => Promise.resolve()),
    };
  }

  function serviceWith(
    before: ProductDetail,
    imageStorage: ImageStorageDouble,
  ): ProductCatalogService {
    const repository = {
      product: vi.fn(() => Promise.resolve(before)),
    } as unknown as ProductCatalogRepository;
    const service = new ProductCatalogService(
      repository,
      imageStorage as unknown as ProductImageStorage,
    );
    vi.spyOn(service, 'patchProduct').mockResolvedValue({
      ...before,
      imageUrl: null,
      version: before.version + 1n,
    });
    return service;
  }

  it('CRITICAL: never deletes another company\'s real product-image object, even when this company\'s own product row holds that URL', async () => {
    // Company B's real, genuinely-uploaded product-image object.
    const companyBImageUrl =
      'http://127.0.0.1:9000/asone-product-images/products/' + companyB + '/real-photo.png';
    // Attack precondition: company A's own product has `image_url` set to
    // company B's real URL — possible today because `image_url` accepts
    // any absolute http(s) string via `PATCH /products/:id` (see the
    // `imageUrl` validation tests above), never restricted to a URL this
    // company's own upload produced.
    const before = productRow({ companyId: companyA, imageUrl: companyBImageUrl });
    const imageStorage = fakeImageStorage();
    const service = serviceWith(before, imageStorage);

    const result = await service.deleteProductImage(
      { ...context, companyId: companyA },
      'product-id',
      1n,
    );

    // The product mutation itself still succeeds (clearing company A's OWN
    // product field is always legitimate) —
    expect(result.imageUrl).toBeNull();
    // — but the DESTRUCTIVE storage call must never have been issued
    // against company B's object.
    expect(imageStorage.deleteObjectBestEffort).not.toHaveBeenCalled();
  });

  it('still deletes the object when it genuinely belongs to the acting company', async () => {
    const companyAOwnImageUrl =
      'http://127.0.0.1:9000/asone-product-images/products/' + companyA + '/real-photo.png';
    const before = productRow({ companyId: companyA, imageUrl: companyAOwnImageUrl });
    const imageStorage = fakeImageStorage();
    const service = serviceWith(before, imageStorage);

    await service.deleteProductImage({ ...context, companyId: companyA }, 'product-id', 1n);

    expect(imageStorage.deleteObjectBestEffort).toHaveBeenCalledTimes(1);
    expect(imageStorage.deleteObjectBestEffort).toHaveBeenCalledWith(
      `products/${companyA}/real-photo.png`,
    );
  });

  it('never attempts a delete when there was no previous image at all', async () => {
    const before = productRow({ companyId: companyA, imageUrl: null });
    const imageStorage = fakeImageStorage();
    const service = serviceWith(before, imageStorage);

    await service.deleteProductImage({ ...context, companyId: companyA }, 'product-id', 1n);

    expect(imageStorage.deleteObjectBestEffort).not.toHaveBeenCalled();
  });

  it('rejects a prefix-colliding tenant id rather than treating it as owned', async () => {
    const collidingCompanyId = `${companyA}x`;
    const collidingUrl =
      'http://127.0.0.1:9000/asone-product-images/products/' + collidingCompanyId + '/photo.png';
    const before = productRow({ companyId: companyA, imageUrl: collidingUrl });
    const imageStorage = fakeImageStorage();
    const service = serviceWith(before, imageStorage);

    await service.deleteProductImage({ ...context, companyId: companyA }, 'product-id', 1n);

    expect(imageStorage.deleteObjectBestEffort).not.toHaveBeenCalled();
  });
});
