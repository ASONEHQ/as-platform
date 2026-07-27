import { CatalogDomainError } from './errors.js';
import { normalizeBarcode, type BarcodeType } from './normalization.js';

function hasValidMod10CheckDigit(value: string): boolean {
  const digits = Array.from(value, Number);
  const checkDigit = digits.pop();
  if (checkDigit === undefined) return false;
  const weightedSum = digits.reduce(
    (sum, digit, index) => sum + digit * ((digits.length - 1 - index) % 2 === 0 ? 3 : 1),
    0,
  );
  return (10 - (weightedSum % 10)) % 10 === checkDigit;
}

export function validateBarcode(type: BarcodeType, value: string): string {
  const normalized = normalizeBarcode(type, value);
  if (type === 'ean13' && (normalized.length !== 13 || !hasValidMod10CheckDigit(normalized))) {
    throw new CatalogDomainError('invalid_barcode', 'The EAN-13 check digit is invalid.');
  }
  if (type === 'upca' && (normalized.length !== 12 || !hasValidMod10CheckDigit(normalized))) {
    throw new CatalogDomainError('invalid_barcode', 'The UPC-A check digit is invalid.');
  }
  return normalized;
}
