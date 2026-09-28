import type { FastifyInstance, FastifyRequest } from 'fastify';

import { responseMeta, successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requirePermission } from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import { idempotencyKey, parseIfMatch } from './catalog.schemas.js';
import { withProductRecipeErrors } from './product-recipes.http-errors.js';
import type { ProductRecipeService } from './product-recipes.service.js';
import type { ProductRecipeMutationContext, ProductRecipeRow } from './product-recipes.types.js';

interface VariantParams {
  variant_id: string;
}
interface ComponentBody {
  component_variant_id: string;
  quantity: string;
  unit_of_measure_code: string;
}
interface ReplaceBody {
  is_active?: boolean;
  components: ComponentBody[];
}

const uuid = { type: 'string', format: 'uuid' } as const;
const rejectUnknown = { not: {} } as const;
const response = { type: 'object', additionalProperties: true } as const;
const error = { type: 'object', additionalProperties: true } as const;
const errors = { 400: error, 401: error, 403: error, 404: error, 409: error } as const;
const variantParams = {
  type: 'object',
  additionalProperties: false,
  required: ['variant_id'],
  properties: { variant_id: uuid },
} as const;
const componentBody = {
  type: 'object',
  additionalProperties: rejectUnknown,
  required: ['component_variant_id', 'quantity', 'unit_of_measure_code'],
  properties: {
    component_variant_id: uuid,
    quantity: { type: 'string', minLength: 1, maxLength: 32 },
    unit_of_measure_code: { type: 'string', minLength: 1, maxLength: 32 },
  },
} as const;
const replaceBody = {
  type: 'object',
  additionalProperties: rejectUnknown,
  required: ['components'],
  properties: {
    is_active: { type: 'boolean' },
    components: { type: 'array', items: componentBody },
  },
} as const;
const idempotencyHeaders = {
  type: 'object',
  required: ['idempotency-key'],
  properties: { 'idempotency-key': { type: 'string', minLength: 1 } },
} as const;
const ifMatchHeaders = {
  type: 'object',
  required: ['if-match'],
  properties: { 'if-match': { type: 'string' } },
} as const;

function context(
  request: FastifyRequest,
  companyId: string,
  actorId: string,
): ProductRecipeMutationContext {
  return {
    companyId,
    actorId,
    requestId: request.requestContext.requestId,
    correlationId: request.requestContext.correlationId,
    timestamp: new Date(),
  };
}
function presented(value: ProductRecipeRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    product_variant_id: value.productVariantId,
    is_active: value.isActive,
    components: value.components.map((item) => ({
      id: item.id,
      component_variant_id: item.componentVariantId,
      // TASK 16.32.9 — resolved fresh from the catalog on every read (see
      // `ProductRecipeRepository.ingredientIdentities`), never persisted
      // on `product_recipe_components` itself.
      ingredient_name: item.ingredientName,
      ingredient_sku: item.ingredientSku,
      quantity: item.quantity,
      unit_of_measure_code: item.unitOfMeasureCode,
    })),
    version: Number(value.version),
    created_at: value.createdAt.toISOString(),
    updated_at: value.updatedAt.toISOString(),
  };
}

export function registerProductRecipeRoutes(
  app: FastifyInstance,
  authentication: AuthService,
  service: ProductRecipeService,
): void {
  app.get<{ Params: VariantParams }>(
    '/api/v1/product-variants/:variant_id/recipe',
    {
      schema: {
        tags: ['catalog'],
        params: variantParams,
        response: { 200: response, ...errors },
      },
    },
    async (request, reply) =>
      withProductRecipeErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'catalog.read');
        const recipe = await service.getRecipe(auth.companyId, request.params.variant_id);
        return reply.send({
          data: recipe === null ? null : presented(recipe),
          meta: responseMeta(request.requestContext),
        });
      }),
  );
  // TASK 17.2 §17 — "Usado en" (where used): the reverse lookup, given an
  // ingredient variant, which sold products' recipes reference it.
  app.get<{ Params: VariantParams }>(
    '/api/v1/product-variants/:variant_id/used-in',
    {
      schema: {
        tags: ['catalog'],
        params: variantParams,
        response: { 200: response, ...errors },
      },
    },
    async (request, reply) =>
      withProductRecipeErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'catalog.read');
        const usages = await service.usedIn(auth.companyId, request.params.variant_id);
        return reply.send({
          data: usages.map((usage) => ({
            recipe_id: usage.recipeId,
            is_recipe_active: usage.isRecipeActive,
            sold_product_variant_id: usage.soldProductVariantId,
            sold_product_name: usage.soldProductName,
            quantity: usage.quantity,
            unit_of_measure_code: usage.unitOfMeasureCode,
          })),
          meta: responseMeta(request.requestContext),
        });
      }),
  );
  app.put<{ Params: VariantParams; Body: ReplaceBody }>(
    '/api/v1/product-variants/:variant_id/recipe',
    {
      schema: {
        tags: ['catalog'],
        params: variantParams,
        headers: idempotencyHeaders,
        body: replaceBody,
        response: { 200: response, ...errors },
      },
    },
    async (request, reply) =>
      withProductRecipeErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'product.manage');
        const b = request.body;
        const result = await service.replaceRecipe(
          context(request, auth.companyId, auth.userId),
          request.params.variant_id,
          idempotencyKey(request.headers['idempotency-key']),
          {
            ...(b.is_active === undefined ? {} : { isActive: b.is_active }),
            components: b.components.map((item) => ({
              componentVariantId: item.component_variant_id,
              quantity: item.quantity,
              unitOfMeasureCode: item.unit_of_measure_code,
            })),
          },
        );
        if (result.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .code(200)
          .header('etag', `"${result.value.version.toString()}"`)
          .send(successResponse(presented(result.value), request.requestContext));
      }),
  );
  app.delete<{ Params: VariantParams }>(
    '/api/v1/product-variants/:variant_id/recipe',
    {
      schema: {
        tags: ['catalog'],
        params: variantParams,
        headers: ifMatchHeaders,
        response: { 200: response, ...errors },
      },
    },
    async (request, reply) =>
      withProductRecipeErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'product.manage');
        const result = await service.deleteRecipe(
          context(request, auth.companyId, auth.userId),
          request.params.variant_id,
          parseIfMatch(request.headers['if-match']),
        );
        return reply.send(successResponse(result, request.requestContext));
      }),
  );
}
