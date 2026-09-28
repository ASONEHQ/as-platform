import { createHash } from 'node:crypto';

import type { ProductRecipeRepository, RecipeUsage } from './product-recipes.repository.js';
import type {
  ProductRecipeComponentInput,
  ProductRecipeComponentRow,
  ProductRecipeMutationContext,
  ProductRecipeRow,
  ProductRecipeTransaction,
  ReplaceProductRecipeInput,
} from './product-recipes.types.js';
import { ProductRecipeError } from './product-recipes.types.js';

function fingerprint(value: Readonly<Record<string, unknown>>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
// Mirrors `product-catalog.service.ts`'s own `money()`/`stockAmount()`
// regex-normalization style, but requires the value to be strictly
// positive (scale 6, matching `product_recipe_components.quantity`'s own
// `numeric(19,6)` column and its `> 0` check constraint).
function quantity(value: string): string {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec(value.trim());
  if (match?.[1] === undefined)
    throw new ProductRecipeError(
      'validation_error',
      'quantity must be a positive decimal with at most six decimal places.',
    );
  const whole = match[1];
  const fraction = (match[2] ?? '').padEnd(6, '0');
  if (whole === '0' && /^0+$/.test(fraction))
    throw new ProductRecipeError('validation_error', 'quantity must be greater than zero.');
  return `${whole}.${fraction}`;
}
function decodeRecipe(raw: unknown): ProductRecipeRow {
  const value = raw as ProductRecipeRow & {
    version: string;
    createdAt: string;
    updatedAt: string;
    components: readonly (ProductRecipeComponentRow & { createdAt: string; updatedAt: string })[];
  };
  return {
    ...value,
    version: BigInt(value.version),
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
    components: value.components.map((item) => ({
      ...item,
      createdAt: new Date(item.createdAt),
      updatedAt: new Date(item.updatedAt),
    })),
  };
}

export class ProductRecipeService {
  public constructor(private readonly repository: ProductRecipeRepository) {}

  public async getRecipe(companyId: string, variantId: string): Promise<ProductRecipeRow | null> {
    const exists = await this.repository.variantExists(companyId, variantId);
    if (!exists)
      throw new ProductRecipeError('resource_not_found', 'The product variant was not found.');
    return this.repository.recipeByVariant(companyId, variantId);
  }

  /** TASK 17.2 §17 — "Usado en" (where used): which recipes consume this
   * variant as an ingredient. */
  public async usedIn(companyId: string, variantId: string): Promise<RecipeUsage[]> {
    const exists = await this.repository.variantExists(companyId, variantId);
    if (!exists)
      throw new ProductRecipeError('resource_not_found', 'The product variant was not found.');
    return this.repository.usedIn(companyId, variantId);
  }

  public replaceRecipe(
    context: ProductRecipeMutationContext,
    variantId: string,
    key: string,
    input: ReplaceProductRecipeInput,
  ): Promise<{ value: ProductRecipeRow; replayed: boolean }> {
    const components = this.normalizeComponents(variantId, input.components);
    const isActive = input.isActive ?? true;
    const fingerprinted = { productVariantId: variantId, isActive, components };
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'product_recipe.replace',
        key,
        fingerprint(fingerprinted),
        'product_recipe',
        decodeRecipe,
        async () => {
          const variant = await this.repository.lockVariant(client, context.companyId, variantId);
          if (variant === null)
            throw new ProductRecipeError('resource_not_found', 'The product variant was not found.');
          // TASK 16.32.3 — the V1 invariant: a variant may track its own
          // inventory directly OR use a recipe, never both (see
          // `docs/PRODUCT_RECIPES.md`). Checked unconditionally, even for
          // an empty `components` array or an `is_active: false` save —
          // this variant must never acquire a `product_recipes` row at
          // all while it tracks its own inventory.
          if (variant.tracksInventory)
            throw new ProductRecipeError(
              'variant_direct_stock_conflict',
              'This product variant tracks inventory directly and cannot also use a recipe. Disable direct inventory tracking on the product before configuring a recipe.',
            );
          await this.validateComponents(client, context.companyId, components);
          const existing = await this.repository.lockRecipeByVariant(
            client,
            context.companyId,
            variantId,
          );
          const header = await this.repository.upsertRecipe(client, context, {
            productVariantId: variantId,
            isActive,
            existing,
          });
          const savedComponents = await this.repository.replaceComponents(
            client,
            context,
            header.id,
            components,
          );
          const value: ProductRecipeRow = {
            id: header.id,
            companyId: context.companyId,
            productVariantId: variantId,
            isActive: header.isActive,
            version: header.version,
            createdAt: header.createdAt,
            updatedAt: header.updatedAt,
            components: savedComponents,
          };
          await this.repository.auditAndPublish(client, context, {
            action: 'product_recipe.replaced',
            resourceType: 'product_recipe',
            resourceId: value.id,
            eventType: 'product_recipe.replaced',
            version: value.version,
            payload: {
              product_variant_id: variantId,
              component_count: savedComponents.length,
            },
          });
          return value;
        },
      ),
    );
  }

  public deleteRecipe(
    context: ProductRecipeMutationContext,
    variantId: string,
    expectedVersion: bigint,
  ): Promise<{ deleted: true }> {
    return this.repository.transaction(async (client) => {
      const existing = await this.repository.lockRecipeByVariant(
        client,
        context.companyId,
        variantId,
      );
      if (existing === null)
        throw new ProductRecipeError('resource_not_found', 'The recipe was not found.');
      if (existing.version !== expectedVersion)
        throw new ProductRecipeError('version_conflict', 'The recipe version changed.');
      await this.repository.deleteRecipe(client, context.companyId, existing.id);
      await this.repository.auditAndPublish(client, context, {
        action: 'product_recipe.deleted',
        resourceType: 'product_recipe',
        resourceId: existing.id,
        eventType: 'product_recipe.deleted',
        version: existing.version,
        payload: {
          product_variant_id: variantId,
          component_count: existing.components.length,
        },
      });
      return { deleted: true };
    });
  }

  private normalizeComponents(
    variantId: string,
    components: readonly ProductRecipeComponentInput[],
  ): ProductRecipeComponentInput[] {
    const seen = new Set<string>();
    const normalized: ProductRecipeComponentInput[] = [];
    for (const item of components) {
      if (item.componentVariantId === variantId)
        throw new ProductRecipeError(
          'validation_error',
          'A product cannot consume itself as a recipe ingredient.',
        );
      if (seen.has(item.componentVariantId))
        throw new ProductRecipeError(
          'validation_error',
          'component_variant_id must not repeat within the same recipe.',
        );
      seen.add(item.componentVariantId);
      normalized.push({
        componentVariantId: item.componentVariantId,
        quantity: quantity(item.quantity),
        unitOfMeasureCode: item.unitOfMeasureCode.trim(),
      });
    }
    return normalized;
  }

  private async validateComponents(
    client: ProductRecipeTransaction,
    companyId: string,
    components: readonly ProductRecipeComponentInput[],
  ): Promise<void> {
    if (components.length === 0) return;
    const ingredientIds = components.map((item) => item.componentVariantId);
    const ingredients = await this.repository.ingredientVariants(client, companyId, ingredientIds);
    const codes = Array.from(new Set(components.map((item) => item.unitOfMeasureCode)));
    const units = await this.repository.unitsOfMeasure(client, codes);
    for (const item of components) {
      const ingredient = ingredients.get(item.componentVariantId);
      if (ingredient === undefined)
        throw new ProductRecipeError(
          'validation_error',
          'component_variant_id does not reference a valid ingredient in this company.',
        );
      if (!ingredient.tracksInventory)
        throw new ProductRecipeError(
          'validation_error',
          'The ingredient variant does not track inventory and cannot be used in a recipe.',
        );
      const unit = units.get(item.unitOfMeasureCode);
      if (unit === undefined)
        throw new ProductRecipeError(
          'validation_error',
          'unit_of_measure_code does not reference a valid unit of measure.',
        );
      if (unit.dimension !== ingredient.unitOfMeasureDimension)
        throw new ProductRecipeError(
          'validation_error',
          "Quantity unit is not compatible with the ingredient's own unit of measure.",
        );
    }
  }
}
