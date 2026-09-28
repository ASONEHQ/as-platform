/// TASK 16.6 (Productos/Catálogo legacy parity, `AS POS V1.html`'s Extras
/// tab — real image management) — real object storage for a product's
/// photo, built on the SAME generalized `S3ObjectStorage` class
/// (`apps/api/src/infrastructure/object-storage.ts`) extracted from the
/// already-proven tenant-logo upload (`branding.storage.ts`). No image
/// bytes/base64 are ever stored in PostgreSQL — `products.image_url`
/// (see `packages/database/src/schema/catalog.ts`) holds only the
/// resulting object-storage URL, exactly like `branding.logo_url`.
///
/// A separate bucket (`asone-product-images`, distinct from
/// `asone-branding`) with its own `products/{companyId}/{uuid}.{ext}` key
/// layout — every object key is company-scoped, so one tenant's product
/// photos are never addressable through another tenant's own path.
import type { ObjectStorageConfig } from '../../infrastructure/object-storage.js';
import {
  S3ObjectStorage,
  objectStorageConfigFromEnv,
} from '../../infrastructure/object-storage.js';

export const PRODUCT_IMAGES_BUCKET = 'asone-product-images';
const PRODUCT_IMAGES_PREFIX = 'products';

export type { ObjectStorageConfig as ProductImageStorageConfig };
export const productImageStorageConfigFromEnv = objectStorageConfigFromEnv;

export class ProductImageStorage {
  private readonly storage: S3ObjectStorage;

  public constructor(config: ObjectStorageConfig) {
    this.storage = new S3ObjectStorage(config, PRODUCT_IMAGES_BUCKET, PRODUCT_IMAGES_PREFIX);
  }

  public async uploadImage(
    companyId: string,
    body: Buffer,
    contentType: string,
    extension: string,
  ): Promise<{ readonly key: string; readonly url: string }> {
    return this.storage.uploadObject([companyId], body, contentType, extension);
  }

  public keyFromUrl(url: string): string | undefined {
    return this.storage.keyFromUrl(url);
  }

  /** TASK 17.1 -- true only when `key` is a REAL product-image object key
   * generated for exactly `companyId` (`products/{companyId}/{uuid}.ext`,
   * strict equality on `companyId`, never a prefix match). `products
   * .image_url` accepts a client-pasted external URL as a legacy-parity
   * feature (see `product-catalog.routes.ts`'s `image_url` field), so a
   * value read back from a product row can be ANY string a caller with
   * write access to that product chose to submit -- including another
   * company's real, publicly-readable product-image URL. Every caller
   * about to DELETE an object derived from that field MUST check this
   * first; see `ProductCatalogService.deleteProductImage`. */
  public isOwnedKey(key: string, companyId: string): boolean {
    return this.storage.isOwnedKey(key, [companyId]);
  }

  /** Callers MUST check {@link isOwnedKey} first for any key derived from a
   * value that could have been client-submitted (see that method's own
   * doc comment) -- this method itself performs no ownership check. */
  public async deleteObjectBestEffort(key: string): Promise<void> {
    await this.storage.deleteObjectBestEffort(key);
  }
}
