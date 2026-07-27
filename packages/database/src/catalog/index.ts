export { validateBarcode } from './barcodes.js';
export {
  assertCategoryParentIsAcyclic,
  type CategoryParent,
  type LoadCategoryParent,
} from './category-cycle.js';
export { CatalogDomainError, type CatalogDomainErrorCode } from './errors.js';
export {
  normalizeBarcode,
  normalizeCatalogCode,
  normalizeSku,
  type BarcodeType,
} from './normalization.js';
export { generateOptionSignature, type OptionValuePair } from './option-signature.js';
export {
  validateProductVariantState,
  type ProductStatus,
  type ProductType,
  type ProductVariantStateInput,
  type VariantState,
} from './product-state.js';
