import { CatalogDomainError } from './errors.js';

export interface CategoryParent {
  readonly id: string;
  readonly parentId: string | null;
}

export type LoadCategoryParent = (categoryId: string) => Promise<CategoryParent | null>;

export async function assertCategoryParentIsAcyclic(
  categoryId: string,
  proposedParentId: string | null,
  loadCategory: LoadCategoryParent,
): Promise<void> {
  if (proposedParentId === null) return;

  const visited = new Set<string>([categoryId]);
  let currentId: string | null = proposedParentId;

  while (currentId !== null) {
    if (visited.has(currentId)) {
      throw new CatalogDomainError(
        'category_cycle_detected',
        'The category parent creates a cycle.',
      );
    }
    visited.add(currentId);
    const current = await loadCategory(currentId);
    if (current === null) return;
    currentId = current.parentId;
  }
}
