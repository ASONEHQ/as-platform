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

  public async deleteObjectBestEffort(key: string): Promise<void> {
    await this.storage.deleteObjectBestEffort(key);
  }
}
