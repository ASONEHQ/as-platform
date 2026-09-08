import type { ProductTaxCode } from '@asone/database';

import type { MutationContext } from './catalog.types.js';

export type { ProductTaxCode };
export const productTaxCodes: readonly ProductTaxCode[] = ['IVA_GENERAL', 'IVA_EXEMPT'];

export const productTypes = ['simple', 'variable', 'kit', 'service'] as const;
export type ProductType = (typeof productTypes)[number];
export const productStatuses = ['draft', 'active', 'inactive', 'retired'] as const;
export type ProductStatus = (typeof productStatuses)[number];
export const variantStatuses = ['active', 'inactive', 'retired'] as const;
export type VariantStatus = (typeof variantStatuses)[number];
export const barcodeTypes = ['ean13', 'upca', 'code128', 'qr', 'internal'] as const;
export type BarcodeType = (typeof barcodeTypes)[number];

export interface ProductRow {
  id: string;
  companyId: string;
  categoryId: string | null;
  brandId: string | null;
  code: string;
  name: string;
  description: string | null;
  productType: ProductType;
  tracksInventory: boolean;
  // TASK 12.3C: an explicit tax *classification*, not a computed rate —
  // see packages/database/src/schema/catalog.ts's `products.tax_code`.
  taxCode: ProductTaxCode;
  status: ProductStatus;
  version: bigint;
  createdAt: Date;
  updatedAt: Date;
}

/** TASK 12.3C: `product_prices` — see
 * packages/database/src/schema/catalog.ts for the full design rationale.
 * `amount`/`currencyCode` are always a decimal string / ISO 4217 code
 * (ADR-0001), never a JS number. */
export interface ProductPriceRow {
  id: string;
  companyId: string;
  branchId: string | null;
  productId: string;
  priceType: string;
  amount: string;
  currencyCode: string;
  validFrom: Date;
  validUntil: Date | null;
  status: 'active' | 'expired' | 'cancelled';
  version: bigint;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductVariantRow {
  id: string;
  companyId: string;
  productId: string;
  sku: string;
  name: string | null;
  unitOfMeasureCode: string;
  quantityScale: number;
  tracksInventory: boolean;
  standardCost: string;
  currencyCode: string;
  isDefault: boolean;
  status: VariantStatus;
  version: bigint;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductBarcodeRow {
  id: string;
  companyId: string;
  productVariantId: string;
  barcodeType: BarcodeType;
  value: string;
  isPrimary: boolean;
  status: VariantStatus;
  version: bigint;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductOptionRow {
  id: string;
  companyId: string;
  productId: string;
  code: string;
  name: string;
  displayOrder: number;
  status: VariantStatus;
  version: bigint;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductOptionValueRow {
  id: string;
  companyId: string;
  productId: string;
  optionDefinitionId: string;
  code: string;
  name: string;
  displayOrder: number;
  status: VariantStatus;
  version: bigint;
  createdAt: Date;
  updatedAt: Date;
}

// TASK 12.3C: `effectivePrice` is the single, backend-resolved authoritative
// price for the caller's company (and branch, when supplied) at the
// current moment — never computed or overridden client-side. `null` means
// "no active price exists yet," which must stay distinguishable from an
// honest `0.0000` (a genuinely free item) — see product-catalog.service.ts.
export type ProductDetail = ProductRow & {
  defaultVariant: ProductVariantRow | null;
  effectivePrice: ProductPriceRow | null;
};
// TASK 12.3C follow-up: `defaultVariant` closes the previously-documented
// gap where the list route never expanded the variant (see
// docs/AS_POS_READ_ONLY_SHELL.md, "Read-only limitations") — resolved via
// ProductCatalogRepository.defaultVariants, batched the same way as
// effectivePrices, never a per-row lookup.
export type ProductListItem = ProductRow & {
  effectivePrice: ProductPriceRow | null;
  defaultVariant: ProductVariantRow | null;
};

export interface ProductFilters {
  status?: ProductStatus;
  productType?: ProductType;
  categoryId?: string;
  brandId?: string;
  search?: string;
  sku?: string;
  barcode?: string;
  cursor?: string;
  limit: number;
  /** Resolves branch-specific price overrides in addition to the
   * company-wide default; derived only from authenticated server context
   * (ADR-0006) — a caller may narrow to one of their own authorized
   * branches, never widen scope. */
  branchId?: string;
}

export interface ProductPage {
  items: ProductListItem[];
  nextCursor: string | null;
}

// TASK 14.5 (Wave 3, Phase 7, Item 1): the real, un-paginated row shape
// `GET /api/v1/products/export.csv` streams — a faithful port of AS POS
// V1's own genuine CSV Blob download (`docs/LEGACY_FUNCTIONAL_PARITY.md`
// §3, "Export catalog (CSV/PDF)"), driven by the SAME company-scoped
// filters `listProducts` already accepts (minus `cursor`/`limit` — an
// export is never paginated), never a second, divergent filter shape.
export type ProductExportFilters = Omit<ProductFilters, 'cursor' | 'limit'>;

export interface ProductExportRow {
  id: string;
  code: string;
  name: string;
  productType: ProductType;
  tracksInventory: boolean;
  taxCode: ProductTaxCode;
  status: ProductStatus;
  categoryId: string | null;
  categoryName: string | null;
  brandId: string | null;
  brandName: string | null;
  defaultSku: string | null;
  defaultCost: string | null;
  defaultCurrencyCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface ProductVariantPage {
  items: ProductVariantRow[];
  nextCursor: string | null;
}

export interface CreateBarcodeInput {
  type: BarcodeType;
  value: string;
  isPrimary: boolean;
}

export interface CreateDefaultVariantInput {
  sku: string;
  name?: string;
  unitOfMeasureCode: string;
  quantityScale: number;
  tracksInventory?: boolean;
  standardCost: string;
  currencyCode: string;
  barcode?: CreateBarcodeInput;
}

export interface CreateProductInput {
  id?: string;
  code: string;
  name: string;
  description?: string;
  productType: ProductType;
  tracksInventory: boolean;
  taxCode?: ProductTaxCode;
  status: ProductStatus;
  categoryId?: string;
  brandId?: string;
  defaultVariant?: CreateDefaultVariantInput;
}

export interface UpdateProductInput {
  name?: string;
  description?: string | null;
  tracksInventory?: boolean;
  taxCode?: ProductTaxCode;
  status?: ProductStatus;
  categoryId?: string | null;
  brandId?: string | null;
}

/** TASK 12.3C: E058-equivalent — creates one effective-dated price. Only
 * a single "standard" price type is supported for now (see the schema's
 * `product_prices_price_type_ck`) — discounts/promotions/dynamic pricing
 * are explicitly out of scope. */
export interface CreateProductPriceInput {
  id?: string;
  /** `undefined`/omitted creates a company-wide default price; an
   * explicit branch id creates a branch-specific override. */
  branchId?: string;
  amount: string;
  currencyCode: string;
  validFrom?: Date;
  validUntil?: Date;
}

export interface CreateVariantInput {
  id?: string;
  sku: string;
  name?: string;
  unitOfMeasureCode: string;
  quantityScale: number;
  tracksInventory?: boolean;
  standardCost: string;
  currencyCode: string;
  isDefault: boolean;
  status: VariantStatus;
  optionValueIds: readonly string[];
  barcode?: CreateBarcodeInput;
}

export interface UpdateVariantInput {
  sku?: string;
  name?: string | null;
  unitOfMeasureCode?: string;
  quantityScale?: number;
  tracksInventory?: boolean;
  standardCost?: string;
  currencyCode?: string;
  isDefault?: boolean;
  status?: VariantStatus;
}

export interface ProductCatalogTransaction {
  query(sql: string, values?: readonly unknown[]): Promise<unknown>;
}
export type ProductMutationContext = MutationContext;
export type ProductCatalogErrorCode =
  | 'duplicate_barcode'
  | 'duplicate_option_code'
  | 'duplicate_option_selection'
  | 'duplicate_option_value_code'
  | 'duplicate_product_code'
  | 'duplicate_sku'
  | 'idempotency_conflict'
  | 'invalid_product_state'
  | 'invalid_option_state'
  | 'invalid_option_value_state'
  | 'invalid_variant_state'
  | 'inventory_unit_locked'
  | 'option_combination_conflict'
  | 'option_value_wrong_product'
  // TASK 12.3C: reserved by docs/API_CONTRACTS.md §5 for an overlapping/
  // conflicting price submission (maps to HTTP 409, same as every other
  // non-validation code here).
  | 'price_conflict'
  | 'resource_not_found'
  | 'validation_error'
  | 'version_conflict';

export class ProductCatalogError extends Error {
  constructor(
    readonly code: ProductCatalogErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProductCatalogError';
  }
}
