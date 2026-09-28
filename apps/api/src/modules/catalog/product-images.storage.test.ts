/// TASK 17.1 — unit coverage for `ProductImageStorage.isOwnedKey`, the
/// boundary `ProductCatalogService.deleteProductImage` must consult before
/// deleting an object derived from `products.image_url`. That field can
/// hold ANY client-pasted external URL (a documented legacy-parity
/// feature — see `product-catalog.routes.ts`'s `image_url` schema), so it
/// is not guaranteed to be a key this company's own upload produced.
import { describe, expect, it } from 'vitest';

import { ProductImageStorage } from './product-images.storage.js';

describe('ProductImageStorage.isOwnedKey', () => {
  const storage = new ProductImageStorage({
    rootUser: 'u',
    rootPassword: 'p',
    apiPort: 9000,
    host: '127.0.0.1',
  });
  const companyA = '11111111-1111-1111-1111-111111111111';
  const companyB = '22222222-2222-2222-2222-222222222222';

  it('accepts a real key that was actually generated for this company', () => {
    expect(storage.isOwnedKey(`products/${companyA}/abc.png`, companyA)).toBe(true);
  });

  it('rejects a key that belongs to a different company', () => {
    expect(storage.isOwnedKey(`products/${companyB}/abc.png`, companyA)).toBe(false);
  });

  it('never accepts a prefix-colliding company id', () => {
    expect(storage.isOwnedKey(`products/${companyA}x/abc.png`, companyA)).toBe(false);
  });

  it('rejects a key under an unrelated prefix (e.g. the branding bucket layout)', () => {
    expect(storage.isOwnedKey(`logos/${companyA}/abc.png`, companyA)).toBe(false);
  });

  it('rejects a URL on a different host even when the path looks like a real key', () => {
    const foreignHostUrl = `http://evil.example.test:9000/asone-product-images/products/${companyA}/abc.png`;
    expect(storage.keyFromUrl(foreignHostUrl)).toBeUndefined();
  });

  it('end-to-end: the URL/key round-trip for company A never validates as owned by company B', () => {
    const url = `http://127.0.0.1:9000/asone-product-images/products/${companyA}/abc.png`;
    const key = storage.keyFromUrl(url);
    if (key === undefined) throw new Error('expected keyFromUrl to recover a real key');
    expect(storage.isOwnedKey(key, companyB)).toBe(false);
    expect(storage.isOwnedKey(key, companyA)).toBe(true);
  });
});
