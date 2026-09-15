/// TASK 16.6 — generic S3-compatible object storage, extracted from the
/// real, already-proven pattern `apps/api/src/modules/admin/branding
/// /branding.storage.ts` built for the tenant logo upload (which stays
/// exactly as-is, untouched, to avoid any regression risk on an already
/// shipped, tested feature). This is the "generalize the existing
/// object-storage implementation" half of that reuse: a bucket-agnostic
/// class any feature needing real, tenant-isolated file storage (never
/// binary/base64 in PostgreSQL, never browser-only persistence) can
/// instantiate for its own bucket — `apps/api/src/modules/catalog
/// /product-images.storage.ts` is the first real consumer, for product
/// images.
///
/// Configuration reuses the SAME `MINIO_*` env vars `branding.storage.ts`
/// already established (`MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`/
/// `MINIO_API_PORT`) — no new env var names are invented, and the same
/// `127.0.0.1` host convention `DATABASE_URL`/`REDIS_URL` already use is
/// followed here too.
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

export interface ObjectStorageConfig {
  readonly rootUser: string;
  readonly rootPassword: string;
  readonly apiPort: number;
  /** Overridable only for tests; production/dev always resolves to the
   * documented `127.0.0.1` convention described in this file's header. */
  readonly host?: string;
}

export function objectStorageConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ObjectStorageConfig | undefined {
  const rootUser = env.MINIO_ROOT_USER;
  const rootPassword = env.MINIO_ROOT_PASSWORD;
  const apiPort = Number(env.MINIO_API_PORT ?? '9000');
  if (rootUser === undefined || rootUser.length === 0) return undefined;
  if (rootPassword === undefined || rootPassword.length === 0) return undefined;
  if (!Number.isInteger(apiPort) || apiPort <= 0) return undefined;
  return { rootUser, rootPassword, apiPort };
}

export interface UploadedObject {
  readonly key: string;
  readonly url: string;
}

/** A real MinIO/S3 client wrapper for ONE bucket + key prefix, with a
 * public-read policy scoped to that prefix (mirrors `BrandingObjectStorage`
 * exactly — see that class's own doc comment for the full "why public-read
 * is safe here" reasoning: this is for content deliberately meant to be
 * displayed, e.g. a business logo or a product photo, never anything
 * sensitive). One instance per bucket is cheap and safe to construct
 * per-request or share for the process lifetime — `ensureBucket` is
 * idempotent. */
export class S3ObjectStorage {
  private readonly client: S3Client;
  private readonly host: string;
  private readonly port: number;
  private readonly bucket: string;
  private readonly prefix: string;
  private ensured: Promise<void> | undefined;

  public constructor(config: ObjectStorageConfig, bucket: string, prefix: string) {
    this.host = config.host ?? '127.0.0.1';
    this.port = config.apiPort;
    this.bucket = bucket;
    this.prefix = prefix;
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

  /** Idempotent — safe to call before every upload. Creates the bucket if
   * missing and (re)applies the public-read policy for this instance's own
   * prefix; both operations are naturally idempotent against MinIO. */
  public async ensureBucket(): Promise<void> {
    this.ensured ??= this.ensureBucketOnce();
    return this.ensured;
  }

  private async ensureBucketOnce(): Promise<void> {
    const exists = await this.bucketExists();
    if (!exists) {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      } catch (error) {
        if (!isBucketAlreadyOwned(error)) throw error;
      }
    }
    await this.client.send(
      new PutBucketPolicyCommand({
        Bucket: this.bucket,
        Policy: JSON.stringify(publicReadPolicy(this.bucket, this.prefix)),
      }),
    );
  }

  private async bucketExists(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch (error) {
      if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404)
        return false;
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  /** `scopeSegments` are joined under this instance's own prefix, in
   * order — e.g. `[companyId]` for a company-scoped object, so one
   * tenant's objects are never addressable through another tenant's own
   * path, exactly like `branding.storage.ts`'s `logos/{companyId}/...`
   * layout. */
  public async uploadObject(
    scopeSegments: readonly string[],
    body: Buffer,
    contentType: string,
    extension: string,
  ): Promise<UploadedObject> {
    await this.ensureBucket();
    const key = [this.prefix, ...scopeSegments, `${randomUUID()}.${extension}`].join('/');
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return { key, url: this.publicUrl(key) };
  }

  public publicUrl(key: string): string {
    return `http://${this.host}:${String(this.port)}/${this.bucket}/${key}`;
  }

  /** Extracts the object key from a URL this same instance produced (via
   * {@link publicUrl}), or `undefined` if the URL is not one of this
   * bucket's own path-style URLs — callers treat `undefined` as "nothing
   * to delete". */
  public keyFromUrl(url: string): string | undefined {
    const marker = `/${this.bucket}/`;
    let pathname: string;
    try {
      pathname = new URL(url).pathname;
    } catch {
      return undefined;
    }
    const index = pathname.indexOf(marker);
    if (index === -1) return undefined;
    return pathname.slice(index + marker.length);
  }

  /** Best-effort delete — a missing object, or any other failure, is
   * swallowed: object cleanup must never block the caller's own request,
   * which by the time this runs has usually already succeeded. */
  public async deleteObjectBestEffort(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
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
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'NotFound'
  );
}

function publicReadPolicy(bucket: string, prefix: string): Readonly<Record<string, unknown>> {
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { AWS: ['*'] },
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${bucket}/${prefix}/*`],
      },
    ],
  };
}
