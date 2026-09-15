/// TASK 16.6A — production-readiness coverage for the new, optional
/// `MINIO_ENDPOINT` override (see `object-storage.ts`'s own doc comment
/// on `ObjectStorageConfig.endpoint`): confirms every pre-existing
/// deployment (no `MINIO_ENDPOINT` set) is completely unaffected, that a
/// real remote endpoint is honored verbatim, and that a malformed one
/// fails the SAME "storage not configured" path a missing credential
/// already does — never an opaque runtime failure inside an upload.
import { describe, expect, it } from 'vitest';

import { S3ObjectStorage, objectStorageConfigFromEnv } from './object-storage.js';

describe('objectStorageConfigFromEnv', () => {
  it('omits `endpoint` entirely when MINIO_ENDPOINT is unset — byte-for-byte the pre-16.6A shape', () => {
    const config = objectStorageConfigFromEnv({
      MINIO_ROOT_USER: 'u',
      MINIO_ROOT_PASSWORD: 'p',
      MINIO_API_PORT: '9000',
    });
    expect(config).toEqual({ rootUser: 'u', rootPassword: 'p', apiPort: 9000 });
  });

  it('carries a real, valid MINIO_ENDPOINT through verbatim', () => {
    const config = objectStorageConfigFromEnv({
      MINIO_ROOT_USER: 'u',
      MINIO_ROOT_PASSWORD: 'p',
      MINIO_API_PORT: '9000',
      MINIO_ENDPOINT: 'https://nyc3.digitaloceanspaces.com',
    });
    expect(config).toEqual({
      rootUser: 'u',
      rootPassword: 'p',
      apiPort: 9000,
      endpoint: 'https://nyc3.digitaloceanspaces.com',
    });
  });

  it('is undefined for a malformed MINIO_ENDPOINT — never a confusing failure later inside an upload', () => {
    expect(
      objectStorageConfigFromEnv({
        MINIO_ROOT_USER: 'u',
        MINIO_ROOT_PASSWORD: 'p',
        MINIO_API_PORT: '9000',
        MINIO_ENDPOINT: 'not a url',
      }),
    ).toBeUndefined();
  });

  it('is undefined for a non-http(s) MINIO_ENDPOINT scheme', () => {
    expect(
      objectStorageConfigFromEnv({
        MINIO_ROOT_USER: 'u',
        MINIO_ROOT_PASSWORD: 'p',
        MINIO_API_PORT: '9000',
        MINIO_ENDPOINT: 'ftp://example.test',
      }),
    ).toBeUndefined();
  });

  it('ignores MINIO_ENDPOINT the same way missing credentials are ignored (still undefined overall)', () => {
    expect(
      objectStorageConfigFromEnv({ MINIO_ENDPOINT: 'https://nyc3.digitaloceanspaces.com' }),
    ).toBeUndefined();
  });
});

describe('S3ObjectStorage.publicUrl', () => {
  it('builds a loopback path-style URL when no endpoint is configured (pre-16.6A behavior)', () => {
    const storage = new S3ObjectStorage(
      { rootUser: 'u', rootPassword: 'p', apiPort: 9000 },
      'a-bucket',
      'a-prefix',
    );
    expect(storage.publicUrl('a-prefix/x.png')).toBe(
      'http://127.0.0.1:9000/a-bucket/a-prefix/x.png',
    );
  });

  it('builds a real remote URL from a configured endpoint, never the loopback default', () => {
    const storage = new S3ObjectStorage(
      {
        rootUser: 'u',
        rootPassword: 'p',
        apiPort: 9000,
        endpoint: 'https://nyc3.digitaloceanspaces.com',
      },
      'a-bucket',
      'a-prefix',
    );
    const url = storage.publicUrl('a-prefix/x.png');
    expect(url).toBe('https://nyc3.digitaloceanspaces.com/a-bucket/a-prefix/x.png');
    expect(storage.keyFromUrl(url)).toBe('a-prefix/x.png');
  });
});
