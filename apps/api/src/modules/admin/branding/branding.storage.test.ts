import { describe, expect, it } from 'vitest';

import { BrandingObjectStorage, brandingStorageConfigFromEnv } from './branding.storage.js';

describe('brandingStorageConfigFromEnv', () => {
  it('reads the exact MINIO_* env vars already provisioned by compose.yaml/.env.example', () => {
    const config = brandingStorageConfigFromEnv({
      MINIO_ROOT_USER: 'asone_local_minio',
      MINIO_ROOT_PASSWORD: 'local_minio_password_change_me',
      MINIO_API_PORT: '9000',
    });
    expect(config).toEqual({ rootUser: 'asone_local_minio', rootPassword: 'local_minio_password_change_me', apiPort: 9000 });
  });

  it('is undefined when any required MINIO_* var is missing (no new env var names invented as a substitute)', () => {
    expect(brandingStorageConfigFromEnv({})).toBeUndefined();
    expect(brandingStorageConfigFromEnv({ MINIO_ROOT_USER: 'u' })).toBeUndefined();
  });
});

describe('BrandingObjectStorage URL/key round-trip', () => {
  const storage = new BrandingObjectStorage({
    rootUser: 'u',
    rootPassword: 'p',
    apiPort: 9000,
    host: '127.0.0.1',
  });

  it('builds a path-style public URL and recovers the same object key from it', () => {
    const key = 'logos/11111111-1111-1111-1111-111111111111/abc.png';
    const url = storage.publicUrl(key);
    expect(url).toBe(`http://127.0.0.1:9000/asone-branding/${key}`);
    expect(storage.keyFromUrl(url)).toBe(key);
  });

  it('returns undefined for a URL that is not one of this bucket\'s own URLs', () => {
    expect(storage.keyFromUrl('http://127.0.0.1:9000/some-other-bucket/x.png')).toBeUndefined();
    expect(storage.keyFromUrl('not a url at all')).toBeUndefined();
  });
});
