import { CatalogDomainError } from './errors.js';

export type ProductType = 'simple' | 'variable' | 'kit' | 'service';
export type ProductStatus = 'draft' | 'active' | 'inactive' | 'retired';

export interface VariantState {
  readonly productId: string;
  readonly status: 'active' | 'inactive' | 'retired';
  readonly isDefault: boolean;
  readonly tracksInventory: boolean;
}

export interface ProductVariantStateInput {
  readonly productId: string;
  readonly productType: ProductType;
  readonly productStatus: ProductStatus;
  readonly tracksInventory: boolean;
  readonly variants: readonly VariantState[];
}

export function validateProductVariantState(input: ProductVariantStateInput): void {
  const variants = input.variants;
  if (variants.some((variant) => variant.productId !== input.productId)) {
    throw new CatalogDomainError(
      'invalid_product_state',
      'Every variant must belong to the product.',
    );
  }

  const activeVariants = variants.filter((variant) => variant.status === 'active');
  const activeDefaults = activeVariants.filter((variant) => variant.isDefault);
  const nonRetiredVariants = variants.filter((variant) => variant.status !== 'retired');
  const intendedDefaults = nonRetiredVariants.filter((variant) => variant.isDefault);

  if (input.productType === 'service' || input.productType === 'kit') {
    if (input.tracksInventory || variants.some((variant) => variant.tracksInventory)) {
      throw new CatalogDomainError(
        'invalid_product_state',
        'Service and kit products and variants cannot track inventory.',
      );
    }
  }

  if (input.productType !== 'variable' && nonRetiredVariants.length === 0) {
    throw new CatalogDomainError(
      'invalid_product_state',
      'Simple, service, and kit products require a default variant.',
    );
  }

  if (input.productType !== 'variable' && intendedDefaults.length !== 1) {
    throw new CatalogDomainError(
      'invalid_product_state',
      'Simple, service, and kit products require exactly one active default variant.',
    );
  }

  if (input.productType === 'variable' && input.productStatus === 'active') {
    if (activeVariants.length === 0 || activeDefaults.length !== 1) {
      throw new CatalogDomainError(
        'invalid_product_state',
        'An active variable product requires active variants and exactly one active default.',
      );
    }
  }
}
