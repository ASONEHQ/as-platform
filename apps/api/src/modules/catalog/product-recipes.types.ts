import type { MutationContext } from './catalog.types.js';

// Mirrors `product-catalog.types.ts`'s own `ProductCatalogTransaction`/
// `ProductMutationContext`/`ProductCatalogError` shape exactly — this
// module's own copy, per this codebase's established "each module owns its
// helpers, never a shared base class" convention (see
// `product-catalog.repository.ts`'s `transaction`/`idempotent`/
// `auditAndPublish` and `sales.repository.ts`'s near-identical copies).
export interface ProductRecipeTransaction {
  query(sql: string, values?: readonly unknown[]): Promise<unknown>;
}
export type ProductRecipeMutationContext = MutationContext;

export interface ProductRecipeComponentRow {
  id: string;
  companyId: string;
  recipeId: string;
  componentVariantId: string;
  // Always a decimal string (ADR-0001), never a JS number — see
  // `packages/database/src/schema/product-recipes.ts`'s `quantity` column
  // doc comment (numeric(19,6)).
  quantity: string;
  unitOfMeasureCode: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductRecipeRow {
  id: string;
  companyId: string;
  productVariantId: string;
  isActive: boolean;
  version: bigint;
  createdAt: Date;
  updatedAt: Date;
  components: ProductRecipeComponentRow[];
}

export interface ProductRecipeComponentInput {
  componentVariantId: string;
  quantity: string;
  unitOfMeasureCode: string;
}

export interface ReplaceProductRecipeInput {
  isActive?: boolean;
  components: readonly ProductRecipeComponentInput[];
}

export type ProductRecipeErrorCode =
  | 'idempotency_conflict'
  | 'resource_not_found'
  | 'validation_error'
  | 'version_conflict';

export class ProductRecipeError extends Error {
  constructor(
    readonly code: ProductRecipeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProductRecipeError';
  }
}
