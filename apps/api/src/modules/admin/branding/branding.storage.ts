/// TASK 14.5A: real object storage for the operator-uploaded business logo
/// (legacy parity for `AS POS V1.html`'s `cfgNegocioLogoSeleccionado()` /
/// `aplicarBrandingNegocio()`). Wires the MinIO container `compose.yaml`
/// already provisions (service `minio`) via its S3-compatible API --
/// MinIO's own S3 wire-compatibility is the documented reason no new
/// infrastructure service is stood up here, only a real client against
/// what already exists.
///
/// Configuration reuses the SAME `MINIO_*` env vars already in
/// `.env.example`/`compose.yaml` -- no new env var names are invented.
/// `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` are the root credentials (this
/// is local/self-hosted MinIO, not a scoped IAM principal -- the same
/// trust level this codebase's other infra credentials already assume,
/// e.g. `POSTGRES_USER`/`POSTGRES_PASSWORD`). `MINIO_API_PORT` is the
/// container's S3 API port, mapped to the host at `127.0.0.1` exactly the
/// way `DATABASE_URL`/`REDIS_URL` both already hardcode `127.0.0.1` as the
/// host for their own `*_PORT` variables (see `.env.example`) -- this
/// module follows that SAME established convention rather than inventing
/// a `MINIO_ENDPOINT`/`MINIO_HOST` variable nowhere else in this codebase
/// has a sibling for.
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
import { randomUUID } from 'node:crypto';

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';

export const BRANDING_BUCKET = 'asone-branding';
const BRANDING_PREFIX = 'logos';

export interface BrandingStorageConfig {
  readonly rootUser: string;
  readonly rootPassword: string;
  readonly apiPort: number;
  /** Overridable only for tests; production/dev always resolves to the
   * documented `127.0.0.1` convention described in this file's header. */
  readonly host?: string;
}

export function brandingStorageConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): BrandingStorageConfig | undefined {
  const rootUser = env.MINIO_ROOT_USER;
  const rootPassword = env.MINIO_ROOT_PASSWORD;
  const apiPort = Number(env.MINIO_API_PORT ?? '9000');
  if (rootUser === undefined || rootUser.length === 0) return undefined;
  if (rootPassword === undefined || rootPassword.length === 0) return undefined;
  if (!Number.isInteger(apiPort) || apiPort <= 0) return undefined;
  return { rootUser, rootPassword, apiPort };
}

export interface UploadedLogo {
  readonly key: string;
  readonly url: string;
}

/** Real MinIO/S3 client wrapper for the business-logo bucket. One instance
 * is shared for the process lifetime (see `register-plugins.ts`) --
 * `ensureBucket` is cheap and idempotent so it is safe to call once at
 * startup or lazily before the first upload. */
export class BrandingObjectStorage {
  private readonly client: S3Client;
  private readonly host: string;
  private readonly port: number;
  private ensured: Promise<void> | undefined;

  public constructor(config: BrandingStorageConfig) {
    this.host = config.host ?? '127.0.0.1';
    this.port = config.apiPort;
    this.client = new S3Client({
      endpoint: `http://${this.host}:${String(this.port)}`,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.rootUser,
        secretAccessKey: config.rootPassword,
      },
    });
  }

  /** Idempotent -- safe to call before every upload. Creates the bucket if
   * missing and (re)applies the public-read policy for the `logos/`
   * prefix; both operations are naturally idempotent against MinIO. */
  public async ensureBucket(): Promise<void> {
    this.ensured ??= this.ensureBucketOnce();
    return this.ensured;
  }

  private async ensureBucketOnce(): Promise<void> {
    const exists = await this.bucketExists();
    if (!exists) {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: BRANDING_BUCKET }));
      } catch (error) {
        if (!isBucketAlreadyOwned(error)) throw error;
      }
    }
    await this.client.send(
      new PutBucketPolicyCommand({
        Bucket: BRANDING_BUCKET,
        Policy: JSON.stringify(publicReadPolicy()),
      }),
    );
  }

  private async bucketExists(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: BRANDING_BUCKET }));
      return true;
    } catch (error) {
      if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404)
        return false;
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  public async uploadLogo(
    companyId: string,
    body: Buffer,
    contentType: string,
    extension: string,
  ): Promise<UploadedLogo> {
    await this.ensureBucket();
    const key = `${BRANDING_PREFIX}/${companyId}/${randomUUID()}.${extension}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: BRANDING_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return { key, url: this.publicUrl(key) };
  }

  public publicUrl(key: string): string {
    return `http://${this.host}:${String(this.port)}/${BRANDING_BUCKET}/${key}`;
  }

  /** Extracts the object key from a URL this same class produced (via
   * {@link publicUrl}), or `undefined` if the URL is not one of this
   * bucket's own path-style URLs (e.g. it predates this feature, or was
   * hand-edited) -- callers treat `undefined` as "nothing to delete". */
  public keyFromUrl(url: string): string | undefined {
    const prefix = `/${BRANDING_BUCKET}/`;
    let pathname: string;
    try {
      pathname = new URL(url).pathname;
    } catch {
      return undefined;
    }
    const index = pathname.indexOf(prefix);
    if (index === -1) return undefined;
    return pathname.slice(index + prefix.length);
  }

  /** Best-effort delete -- a missing object (already gone, or the URL
   * belonged to a different bucket layout) is not an error; any other
   * failure is swallowed too since a failed cleanup must never block the
   * setting mutation that already succeeded (see `branding.service.ts`). */
  public async deleteObjectBestEffort(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: BRANDING_BUCKET, Key: key }));
    } catch {
      // Best-effort: never let object cleanup fail the caller's own request.
    }
  }
}

function isBucketAlreadyOwned(error: unknown): boolean {
  if (!(error instanceof S3ServiceException)) return false;
  return error.name === 'BucketAlreadyOwnedByYou' || error.name === 'BucketAlreadyExists';
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'NotFound';
}

function publicReadPolicy(): Readonly<Record<string, unknown>> {
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { AWS: ['*'] },
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${BRANDING_BUCKET}/${BRANDING_PREFIX}/*`],
      },
    ],
  };
}
