/// TASK 14.5A: real object storage for the operator-uploaded business logo
/// (legacy parity for `AS POS V1.html`'s `cfgNegocioLogoSeleccionado()` /
/// `aplicarBrandingNegocio()`). Wires the MinIO container `compose.yaml`
/// already provisions (service `minio`) via its S3-compatible API --
/// MinIO's own S3 wire-compatibility is the documented reason no new
/// infrastructure service is stood up here, only a real client against
/// what already exists.
///
/// TASK 16.6A: this class now COMPOSES the shared `S3ObjectStorage`
/// (`apps/api/src/infrastructure/object-storage.ts`) instead of
/// duplicating its own S3 client/bucket-provisioning logic -- the exact
/// same real refactor `product-images.storage.ts` already established for
/// the product-image feature, applied here now that this class needs the
/// SAME production-readiness fix (a configurable remote endpoint,
/// per-object ACL) that feature required; the class's own public API
/// (`uploadLogo`/`publicUrl`/`keyFromUrl`/`deleteObjectBestEffort`) is
/// completely unchanged, so `branding.service.ts`/`branding.routes.ts`
/// and this class's own already-shipped tests needed zero changes.
///
/// Configuration reuses the SAME `MINIO_*` env vars already in
/// `.env.example`/`compose.yaml` -- no new env var names are invented for
/// the credentials themselves. `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` are
/// the root credentials (this is local/self-hosted MinIO, not a scoped
/// IAM principal -- the same trust level this codebase's other infra
/// credentials already assume, e.g. `POSTGRES_USER`/`POSTGRES_PASSWORD`).
/// `MINIO_API_PORT` is the container's S3 API port, mapped to the host at
/// `127.0.0.1` by default -- exactly the way `DATABASE_URL`/`REDIS_URL`
/// both already hardcode `127.0.0.1` as the host for their own `*_PORT`
/// variables (see `.env.example`) -- unless the NEW, optional
/// `MINIO_ENDPOINT` (see `object-storage.ts`'s own doc comment) points
/// this at a genuinely remote S3-compatible provider (a MinIO host not
/// co-located with the API, or a managed provider like DigitalOcean
/// Spaces) instead.
///
/// The bucket name (`asone-branding`) and object key layout
/// (`logos/{companyId}/{uuid}.{ext}`) are infrastructure implementation
/// detail, not tenant-specific business logic -- exactly like a hardcoded
/// Postgres table name is not tenant-specific business logic. Every object
/// key is company-scoped so one tenant's objects are never addressable
/// through another tenant's own path.
///
/// Public URL strategy: the bucket is created with a read-only public
/// policy restricted to the `logos/` prefix (this endpoint only ever
/// writes business logos there, never anything sensitive), so the
/// returned URL is immediately usable by the printed ticket / topbar /
/// café watermark the sibling POS-UI task wires this into -- no
/// authenticated download proxy needed for what is, by definition, a
/// brand mark meant to be displayed. Tenant isolation for the *setting*
/// itself (which company's `branding.logo_url` resolves to which URL) is
/// enforced the normal way, by `SettingsService`'s own company-scoped
/// resolution -- unrelated to whether the underlying image bytes are
/// world-readable.
import type { ObjectStorageConfig } from '../../../infrastructure/object-storage.js';
import {
  S3ObjectStorage,
  objectStorageConfigFromEnv,
} from '../../../infrastructure/object-storage.js';

export const BRANDING_BUCKET = 'asone-branding';
const BRANDING_PREFIX = 'logos';

export type { ObjectStorageConfig as BrandingStorageConfig };
export const brandingStorageConfigFromEnv = objectStorageConfigFromEnv;

export interface UploadedLogo {
  readonly key: string;
  readonly url: string;
}

/** Real MinIO/S3 client wrapper for the business-logo bucket. One instance
 * is shared for the process lifetime (see `register-plugins.ts`) --
 * `ensureBucket` is cheap and idempotent so it is safe to call once at
 * startup or lazily before the first upload. */
export class BrandingObjectStorage {
  private readonly storage: S3ObjectStorage;

  public constructor(config: ObjectStorageConfig) {
    this.storage = new S3ObjectStorage(config, BRANDING_BUCKET, BRANDING_PREFIX);
  }

  public async uploadLogo(
    companyId: string,
    body: Buffer,
    contentType: string,
    extension: string,
  ): Promise<UploadedLogo> {
    return this.storage.uploadObject([companyId], body, contentType, extension);
  }

  public publicUrl(key: string): string {
    return this.storage.publicUrl(key);
  }

  /** Extracts the object key from a URL this same class produced (via
   * {@link publicUrl}), or `undefined` if the URL is not one of this
   * bucket's own path-style URLs (e.g. it predates this feature, or was
   * hand-edited) -- callers treat `undefined` as "nothing to delete". */
  public keyFromUrl(url: string): string | undefined {
    return this.storage.keyFromUrl(url);
  }

  /** Best-effort delete -- a missing object (already gone, or the URL
   * belonged to a different bucket layout) is not an error; any other
   * failure is swallowed too since a failed cleanup must never block the
   * setting mutation that already succeeded (see `branding.service.ts`). */
  public async deleteObjectBestEffort(key: string): Promise<void> {
    await this.storage.deleteObjectBestEffort(key);
  }
}
