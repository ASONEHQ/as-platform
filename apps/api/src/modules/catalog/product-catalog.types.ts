import type { MutationContext } from './catalog.types.js';

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
  status: ProductStatus;
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
  barcodeType: BarcodeType;
  value: string;
  isPrimary: boolean;
  status: 'active' | 'inactive';
}

export type ProductDetail = ProductRow & { defaultVariant: ProductVariantRow | null };

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
}

export interface ProductPage {
  items: ProductRow[];
  nextCursor: string | null;
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
  status: ProductStatus;
  categoryId?: string;
  brandId?: string;
  defaultVariant?: CreateDefaultVariantInput;
}

export interface UpdateProductInput {
  name?: string;
  description?: string | null;
  tracksInventory?: boolean;
  status?: ProductStatus;
  categoryId?: string | null;
  brandId?: string | null;
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
  | 'duplicate_product_code'
  | 'duplicate_sku'
  | 'idempotency_conflict'
  | 'invalid_product_state'
  | 'invalid_variant_state'
  | 'inventory_unit_locked'
  | 'option_combination_conflict'
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
