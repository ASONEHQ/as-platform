import { CatalogDomainError } from './errors.js';

const catalogCodePattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const skuPattern = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/u;
const internalBarcodePattern = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/u;
const printableAsciiPattern = /^[\x20-\x7e]+$/u;
const noControlCharactersPattern = /^[^\p{Cc}\p{Cs}]+$/u;

export type BarcodeType = 'ean13' | 'upca' | 'code128' | 'qr' | 'internal';

function normalizeRequired(value: string, code: 'invalid_catalog_code' | 'invalid_sku'): string {
  const normalized = value.normalize('NFKC').trim().toLowerCase();
  if (normalized.length === 0) {
    throw new CatalogDomainError(code, 'The normalized value cannot be empty.');
  }
  return normalized;
}

export function normalizeCatalogCode(value: string): string {
  const normalized = normalizeRequired(value, 'invalid_catalog_code');
  if (!catalogCodePattern.test(normalized)) {
    throw new CatalogDomainError(
      'invalid_catalog_code',
      'Catalog codes may contain lowercase letters, digits, dots, underscores, and hyphens.',
    );
  }
  return normalized;
}

export function normalizeSku(value: string): string {
  const normalized = normalizeRequired(value, 'invalid_sku');
  if (!skuPattern.test(normalized)) {
    throw new CatalogDomainError(
      'invalid_sku',
      'SKUs may contain lowercase letters, digits, dots, underscores, colons, slashes, and hyphens.',
    );
  }
  return normalized;
}

export function normalizeBarcode(type: BarcodeType, value: string): string {
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length === 0) {
    throw new CatalogDomainError(
      'invalid_barcode',
      'A barcode cannot normalize to an empty value.',
    );
  }

  switch (type) {
    case 'ean13':
    case 'upca':
      if (!/^\d+$/u.test(normalized)) {
        throw new CatalogDomainError(
          'invalid_barcode',
          'EAN-13 and UPC-A barcodes contain digits only.',
        );
      }
      return normalized;
    case 'code128':
      if (normalized.length > 80 || !printableAsciiPattern.test(normalized)) {
        throw new CatalogDomainError(
          'invalid_barcode',
          'Code 128 values must contain 1 to 80 printable ASCII characters.',
        );
      }
      return normalized;
    case 'qr':
      if (normalized.length > 512 || !noControlCharactersPattern.test(normalized)) {
        throw new CatalogDomainError(
          'invalid_barcode',
          'QR values must contain 1 to 512 non-control Unicode characters.',
        );
      }
      return normalized;
    case 'internal': {
      const internal = normalized.toLowerCase();
      if (internal.length > 80 || !internalBarcodePattern.test(internal)) {
        throw new CatalogDomainError(
          'invalid_barcode',
          'Internal barcodes must use the approved catalog identifier characters.',
        );
      }
      return internal;
    }
  }
}
