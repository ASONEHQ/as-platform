import { describe, expect, it } from 'vitest';

import { validateBarcode } from './barcodes.js';
import { assertCategoryParentIsAcyclic } from './category-cycle.js';
import { CatalogDomainError } from './errors.js';
import { normalizeBarcode, normalizeCatalogCode, normalizeSku } from './normalization.js';
import { generateOptionSignature } from './option-signature.js';
import { normalizeCurrencyCode, normalizeMoneyAmount, normalizeProductTaxCode } from './pricing.js';
import { validateProductVariantState } from './product-state.js';

const productId = '018f0000-0000-7000-8000-000000000001';
const definitionOne = '018f0000-0000-7000-8000-000000000010';
const definitionTwo = '018f0000-0000-7000-8000-000000000020';
const valueOne = '018f0000-0000-7000-8000-000000000011';
const valueTwo = '018f0000-0000-7000-8000-000000000021';

describe('catalog normalization', () => {
  it('normalizes codes and SKUs deterministically with NFKC', () => {
    expect(normalizeCatalogCode('  ＡCCESS-General  ')).toBe('access-general');
    expect(normalizeSku(' SKU:ABC/01 ')).toBe('sku:abc/01');
  });

  it('rejects empty and ambiguous characters instead of transliterating', () => {
    expect(() => normalizeCatalogCode('   ')).toThrow(CatalogDomainError);
    expect(() => normalizeCatalogCode('café')).toThrow(CatalogDomainError);
    expect(() => normalizeSku('ABC 123')).toThrow(CatalogDomainError);
  });

  it('normalizes each barcode representation without hardware semantics', () => {
    expect(normalizeBarcode('ean13', ' 4006381333931 ')).toBe('4006381333931');
    expect(normalizeBarcode('internal', ' ACCESS:01 ')).toBe('access:01');
    expect(normalizeBarcode('code128', ' AbC-01 ')).toBe('AbC-01');
    expect(normalizeBarcode('qr', ' https://asone.mx/T/ABC ')).toBe('https://asone.mx/T/ABC');
  });
});

describe('barcode validation', () => {
  it('accepts valid EAN-13 and UPC-A values', () => {
    expect(validateBarcode('ean13', '4006381333931')).toBe('4006381333931');
    expect(validateBarcode('upca', '036000291452')).toBe('036000291452');
  });

  it('rejects malformed values and invalid check digits', () => {
    expect(() => validateBarcode('ean13', '4006381333932')).toThrow(CatalogDomainError);
    expect(() => validateBarcode('upca', '036000291453')).toThrow(CatalogDomainError);
    expect(() => validateBarcode('code128', 'line\nbreak')).toThrow(CatalogDomainError);
    expect(() => validateBarcode('qr', '\u0000')).toThrow(CatalogDomainError);
  });
});

describe('option signatures', () => {
  it('is order-independent and changes when a value changes', () => {
    const forward = generateOptionSignature([
      { optionDefinitionId: definitionOne, optionValueId: valueOne },
      { optionDefinitionId: definitionTwo, optionValueId: valueTwo },
    ]);
    const reverse = generateOptionSignature([
      { optionDefinitionId: definitionTwo, optionValueId: valueTwo },
      { optionDefinitionId: definitionOne, optionValueId: valueOne },
    ]);
    expect(forward).toBe(reverse);
    expect(
      generateOptionSignature([
        { optionDefinitionId: definitionOne, optionValueId: valueTwo },
        { optionDefinitionId: definitionTwo, optionValueId: valueOne },
      ]),
    ).not.toBe(forward);
  });

  it('rejects duplicate definitions and has a stable empty signature', () => {
    expect(() =>
      generateOptionSignature([
        { optionDefinitionId: definitionOne, optionValueId: valueOne },
        { optionDefinitionId: definitionOne, optionValueId: valueTwo },
      ]),
    ).toThrow(CatalogDomainError);
    expect(generateOptionSignature([])).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});

describe('product and category domain invariants', () => {
  it('allows a draft variable without variants and rejects invalid activation', () => {
    expect(() => {
      validateProductVariantState({
        productId,
        productType: 'variable',
        productStatus: 'draft',
        tracksInventory: true,
        variants: [],
      });
    }).not.toThrow();
    expect(() => {
      validateProductVariantState({
        productId,
        productType: 'variable',
        productStatus: 'active',
        tracksInventory: true,
        variants: [],
      });
    }).toThrow(CatalogDomainError);
  });

  it('requires defaults and prohibits inventory for services and kits', () => {
    for (const productType of ['simple', 'service', 'kit'] as const) {
      expect(() => {
        validateProductVariantState({
          productId,
          productType,
          productStatus: 'active',
          tracksInventory: productType === 'simple',
          variants: [],
        });
      }).toThrow(CatalogDomainError);
    }
    expect(() => {
      validateProductVariantState({
        productId,
        productType: 'service',
        productStatus: 'active',
        tracksInventory: false,
        variants: [{ productId, status: 'active', isDefault: true, tracksInventory: true }],
      });
    }).toThrow(CatalogDomainError);
    expect(() => {
      validateProductVariantState({
        productId,
        productType: 'simple',
        productStatus: 'draft',
        tracksInventory: true,
        variants: [
          {
            productId,
            status: 'inactive',
            isDefault: true,
            tracksInventory: true,
          },
        ],
      });
    }).not.toThrow();
    expect(() => {
      validateProductVariantState({
        productId,
        productType: 'simple',
        productStatus: 'active',
        tracksInventory: true,
        variants: [
          {
            productId: valueOne,
            status: 'active',
            isDefault: true,
            tracksInventory: true,
          },
        ],
      });
    }).toThrow(CatalogDomainError);
  });

  it('detects direct and multi-level category cycles', async () => {
    const parents = new Map<string, string | null>([
      ['a', 'b'],
      ['b', 'c'],
      ['c', null],
    ]);
    const load = (id: string): Promise<{ id: string; parentId: string | null } | null> => {
      const parentId = parents.get(id);
      return Promise.resolve(parentId === undefined ? null : { id, parentId });
    };
    await expect(assertCategoryParentIsAcyclic('a', 'a', load)).rejects.toThrow(CatalogDomainError);
    parents.set('c', 'a');
    await expect(assertCategoryParentIsAcyclic('a', 'b', load)).rejects.toThrow(CatalogDomainError);
    parents.set('c', null);
    await expect(assertCategoryParentIsAcyclic('a', 'b', load)).resolves.toBeUndefined();
  });
});

// TASK 12.3C: ADR-0001 (money-and-rounding) — decimal strings only, never
// floating point, and never a silent fallback to zero for an invalid value.
describe('pricing normalization', () => {
  it('pads a valid decimal amount to exactly 4 fractional digits', () => {
    expect(normalizeMoneyAmount('45')).toBe('45.0000');
    expect(normalizeMoneyAmount('45.5')).toBe('45.5000');
    expect(normalizeMoneyAmount('45.5000')).toBe('45.5000');
    expect(normalizeMoneyAmount('0')).toBe('0.0000');
  });

  it('rejects negative, malformed, and non-decimal-string amounts', () => {
    expect(() => normalizeMoneyAmount('-1')).toThrow(CatalogDomainError);
    expect(() => normalizeMoneyAmount('45.00001')).toThrow(CatalogDomainError);
    expect(() => normalizeMoneyAmount('1e10')).toThrow(CatalogDomainError);
    expect(() => normalizeMoneyAmount('abc')).toThrow(CatalogDomainError);
    expect(() => normalizeMoneyAmount('')).toThrow(CatalogDomainError);
    expect(() => normalizeMoneyAmount('01')).toThrow(CatalogDomainError);
  });

  it('accepts only exactly-3-uppercase-letter currency codes', () => {
    expect(normalizeCurrencyCode('MXN')).toBe('MXN');
    expect(() => normalizeCurrencyCode('mxn')).toThrow(CatalogDomainError);
    expect(() => normalizeCurrencyCode('MX')).toThrow(CatalogDomainError);
    expect(() => normalizeCurrencyCode('MXNN')).toThrow(CatalogDomainError);
  });

  it('accepts only the documented product tax codes', () => {
    expect(normalizeProductTaxCode('IVA_GENERAL')).toBe('IVA_GENERAL');
    expect(normalizeProductTaxCode('IVA_EXEMPT')).toBe('IVA_EXEMPT');
    expect(() => normalizeProductTaxCode('VAT_STANDARD')).toThrow(CatalogDomainError);
    expect(() => normalizeProductTaxCode('')).toThrow(CatalogDomainError);
  });
});
