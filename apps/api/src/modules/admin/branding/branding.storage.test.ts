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

// TASK 17.1 — `branding.logo_url` is a plain, tenant-writable settings
// string (see `settings.catalog.ts`), so a value read back from it is not
// guaranteed to be a key THIS company's own upload produced. `isOwnedKey`
// is the boundary `BrandingService.deleteLogo` must consult before
// deleting an object derived from that value.
describe('BrandingObjectStorage.isOwnedKey', () => {
  const storage = new BrandingObjectStorage({
    rootUser: 'u',
    rootPassword: 'p',
    apiPort: 9000,
    host: '127.0.0.1',
  });
  const companyA = '11111111-1111-1111-1111-111111111111';
  const companyB = '22222222-2222-2222-2222-222222222222';

  it('accepts a real key that was actually generated for this company', () => {
    expect(storage.isOwnedKey(`logos/${companyA}/abc.png`, companyA)).toBe(true);
  });

  it('rejects a key that belongs to a different company', () => {
    expect(storage.isOwnedKey(`logos/${companyB}/abc.png`, companyA)).toBe(false);
  });

  it('never accepts a prefix-colliding company id', () => {
    // `companyA + 'x'` is NOT company A, even though it shares every
    // character of company A's own id as a literal string prefix.
    expect(storage.isOwnedKey(`logos/${companyA}x/abc.png`, companyA)).toBe(false);
  });

  it('rejects a key under an unrelated prefix', () => {
    expect(storage.isOwnedKey(`products/${companyA}/abc.png`, companyA)).toBe(false);
  });

  it('end-to-end: the URL/key round-trip for company A never validates as owned by company B', () => {
    const url = storage.publicUrl(`logos/${companyA}/abc.png`);
    const key = storage.keyFromUrl(url);
    if (key === undefined) throw new Error('expected keyFromUrl to recover a real key');
    expect(storage.isOwnedKey(key, companyB)).toBe(false);
    expect(storage.isOwnedKey(key, companyA)).toBe(true);
  });
});
