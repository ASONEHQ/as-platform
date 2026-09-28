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

// TASK 17.1 — cross-tenant object-storage deletion fix: `keyFromUrl`'s new
// origin check, and the new `isOwnedKey` ownership primitive every delete
// call site (`BrandingService.deleteLogo`, `ProductCatalogService
// .deleteProductImage`) must consult before issuing a destructive
// `DeleteObjectCommand` against a key derived from a client-influenced
// value (a settings string, a pasted `image_url`).
describe('S3ObjectStorage.keyFromUrl — origin hardening', () => {
  const storage = new S3ObjectStorage(
    { rootUser: 'u', rootPassword: 'p', apiPort: 9000, host: '127.0.0.1' },
    'a-bucket',
    'a-prefix',
  );

  it('extracts the key from a URL this instance genuinely produced', () => {
    const url = storage.publicUrl('a-prefix/company/x.png');
    expect(storage.keyFromUrl(url)).toBe('a-prefix/company/x.png');
  });

  it('rejects a URL on a different host, even with an identical bucket/key path', () => {
    expect(
      storage.keyFromUrl('http://evil.example.test:9000/a-bucket/a-prefix/company/x.png'),
    ).toBeUndefined();
  });

  it('rejects a lookalike hostname', () => {
    expect(
      storage.keyFromUrl('http://127.0.0.1.evil.test:9000/a-bucket/a-prefix/company/x.png'),
    ).toBeUndefined();
  });

  it('rejects a different port on the same host', () => {
    expect(
      storage.keyFromUrl('http://127.0.0.1:9001/a-bucket/a-prefix/company/x.png'),
    ).toBeUndefined();
  });

  it('rejects a different bucket on the same host', () => {
    expect(
      storage.keyFromUrl('http://127.0.0.1:9000/some-other-bucket/a-prefix/company/x.png'),
    ).toBeUndefined();
  });

  it('rejects a malformed URL', () => {
    expect(storage.keyFromUrl('not a url at all')).toBeUndefined();
  });

  it('rejects an empty-string URL', () => {
    expect(storage.keyFromUrl('')).toBeUndefined();
  });

  it('rejects a same-host URL whose path never contains the bucket marker', () => {
    expect(storage.keyFromUrl('http://127.0.0.1:9000/completely/unrelated/path')).toBeUndefined();
  });
});

describe('S3ObjectStorage.isOwnedKey', () => {
  const storage = new S3ObjectStorage(
    { rootUser: 'u', rootPassword: 'p', apiPort: 9000, host: '127.0.0.1' },
    'a-bucket',
    'a-prefix',
  );

  it('accepts a key genuinely scoped to the given segments', () => {
    expect(storage.isOwnedKey('a-prefix/company-a/x.png', ['company-a'])).toBe(true);
  });

  it('rejects a key scoped to a different tenant', () => {
    expect(storage.isOwnedKey('a-prefix/company-b/x.png', ['company-a'])).toBe(false);
  });

  // TASK 17.1's own explicit regression case — a naive `startsWith` (or
  // any substring) ownership check would wrongly accept this: the STRING
  // "company-a" is a literal prefix of "company-abc", but they are two
  // entirely different tenant ids.
  it('never accepts a prefix-colliding tenant id (startsWith is NOT ownership)', () => {
    expect(storage.isOwnedKey('a-prefix/company-abc/x.png', ['company-a'])).toBe(false);
    expect(storage.isOwnedKey('a-prefix/company-a/x.png', ['company-abc'])).toBe(false);
  });

  it('rejects a key under the wrong storage prefix entirely', () => {
    expect(storage.isOwnedKey('other-prefix/company-a/x.png', ['company-a'])).toBe(false);
  });

  it('rejects a key with the wrong number of path segments', () => {
    expect(storage.isOwnedKey('a-prefix/company-a/nested/x.png', ['company-a'])).toBe(false);
    expect(storage.isOwnedKey('a-prefix/x.png', ['company-a'])).toBe(false);
  });

  it('rejects an empty key', () => {
    expect(storage.isOwnedKey('', ['company-a'])).toBe(false);
  });

  it('rejects a key containing an empty path segment', () => {
    expect(storage.isOwnedKey('a-prefix//x.png', ['company-a'])).toBe(false);
  });

  it('rejects a key containing a literal dot-segment', () => {
    expect(storage.isOwnedKey('a-prefix/./x.png', ['company-a'])).toBe(false);
    expect(storage.isOwnedKey('a-prefix/../x.png', ['company-a'])).toBe(false);
    expect(storage.isOwnedKey('../a-prefix/company-a/x.png', ['company-a'])).toBe(false);
  });

  it('supports multi-segment scopes (e.g. company + branch) with the same strict-equality rule', () => {
    expect(storage.isOwnedKey('a-prefix/co/br/x.png', ['co', 'br'])).toBe(true);
    expect(storage.isOwnedKey('a-prefix/co/br2/x.png', ['co', 'br'])).toBe(false);
  });
});
