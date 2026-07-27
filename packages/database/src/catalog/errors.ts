export type CatalogDomainErrorCode =
  | 'category_cycle_detected'
  | 'invalid_barcode'
  | 'invalid_catalog_code'
  | 'invalid_option_combination'
  | 'invalid_product_state'
  | 'invalid_sku';

export class CatalogDomainError extends Error {
  readonly code: CatalogDomainErrorCode;

  constructor(code: CatalogDomainErrorCode, message: string) {
    super(message);
    this.name = 'CatalogDomainError';
    this.code = code;
  }
}
