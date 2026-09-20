export type CatalogStatus = 'active' | 'inactive' | 'retired';

// TASK 16.13 — the one approved value today. A structured, queryable
// classification anchor for the partial cash-cut's "Cafetería / Snacks"
// operational summary — see the schema column's own doc comment in
// `packages/database/src/schema/catalog.ts`.
export type CategoryOperationalGroup = 'cafeteria';
export const categoryOperationalGroups: readonly CategoryOperationalGroup[] = ['cafeteria'];

export interface Category {
  readonly id: string;
  readonly companyId: string;
  readonly parentId: string | null;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly sortOrder: number;
  readonly status: CatalogStatus;
  // TASK 14.5 (Wave 3, Phase 6): generic, tenant-configurable "visual/
  // compact tile" display hint — see the schema column's own doc comment
  // in `packages/database/src/schema/catalog.ts`. Purely a rendering
  // hint; carries no pricing/checkout/inventory meaning.
  readonly visualTile: boolean;
  // TASK 16.13 — `null` means "not classified into any operational
  // reporting group" (the overwhelming default for most categories);
  // never inferred from `name`.
  readonly operationalGroup: CategoryOperationalGroup | null;
  readonly version: bigint;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

export interface Brand {
  readonly id: string;
  readonly companyId: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: CatalogStatus;
  readonly version: bigint;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

export interface CatalogPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export interface MutationContext {
  readonly companyId: string;
  readonly actorId: string;
  readonly requestId: string;
  readonly correlationId: string;
  readonly timestamp: Date;
}

export class CatalogApplicationError extends Error {
  public constructor(
    public readonly code:
      | 'category_cycle_detected'
      | 'duplicate_brand_code'
      | 'duplicate_category_code'
      | 'idempotency_conflict'
      | 'invalid_input'
      | 'product_has_active_dependencies'
      | 'resource_not_found'
      | 'version_conflict',
    message: string,
    public readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'CatalogApplicationError';
  }
}
