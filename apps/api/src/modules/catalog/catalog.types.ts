export type CatalogStatus = 'active' | 'inactive' | 'retired';

export interface Category {
  readonly id: string;
  readonly companyId: string;
  readonly parentId: string | null;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly sortOrder: number;
  readonly status: CatalogStatus;
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
