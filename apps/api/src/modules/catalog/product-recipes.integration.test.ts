// TASK 16.32 — real Postgres + real Fastify HTTP coverage of the product
// recipe (bill-of-materials) authoring API, mirroring
// `product-catalog.routes.integration.test.ts`'s own structure (real
// `Fastify()` instance, `app.inject`, a mocked `AuthService` selecting one
// of several fixed `AuthContext`s by bearer token so RBAC and cross-tenant
// isolation are exercised exactly as a real request would hit them) rather
// than `product-options.integration.test.ts`'s direct-service-call harness,
// because this task's own verification list requires real 403s from
// `requirePermission` and real cross-tenant 404s from the route layer
// itself, neither of which a direct service call ever passes through.
//
// This file covers ONLY the recipe-authoring CRUD API (GET/PUT/DELETE).
// Actual sale-time inventory consumption against a recipe is covered
// separately (by `sale-consumption.ts`'s own test), per this task's scope.
import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';
import { AppError } from '@asone/errors';

import type { AuthService } from '../auth/auth.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { ProductRecipeRepository } from './product-recipes.repository.js';
import { registerProductRecipeRoutes } from './product-recipes.routes.js';
import { ProductRecipeService } from './product-recipes.service.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;

interface Variant {
  productId: string;
  variantId: string;
}

integration('PostgreSQL product recipe authoring API', { concurrent: false }, () => {
  let app: FastifyInstance;
  let database: DatabaseClient;
  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const userId = randomUUID();
  const otherUserId = randomUUID();

  // Fixtures created once in `beforeAll` and reused (read-only) by most
  // tests; each mutating test creates its OWN variant/recipe pair so
  // tests never fight over each other's version sequence.
  let mozzarella: Variant; // tracks inventory, unit 'g' (mass)
  let pepperoni: Variant; // tracks inventory, unit 'g' (mass)
  let salsa: Variant; // tracks inventory, unit 'l' (volume) — for dimension-mismatch coverage
  let nonTrackedIngredient: Variant; // tracks_inventory = false
  let otherCompanyIngredient: Variant; // real variant, but in `otherCompanyId`
  let noRecipeVariant: Variant; // a finished-good variant that never gets a recipe
  let otherCompanyFinishedGood: Variant; // a finished-good variant owned by `otherCompanyId`

  beforeAll(async () => {
    if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({
      connectionString: databaseUrl,
      applicationName: 'asone-product-recipes-integration',
    });

    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'Recipes Co','Recipes Co',$2,'active','UTC','MXN','es-MX'),
             ($3,'Other Recipes Co','Other Recipes Co',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `recipes-${companyId}`, otherCompanyId, `recipes-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'Recipes User','active'),($3,$4,$4,'Other Recipes User','active')`,
      [userId, `recipes-${userId}@example.test`, otherUserId, `recipes-${otherUserId}@example.test`],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status)
       values($1,$2,$3,'active'),($4,$5,$6,'active')`,
      [randomUUID(), companyId, userId, randomUUID(), otherCompanyId, otherUserId],
    );
    await database.pool.query(
      `insert into units_of_measure(code,name,dimension,quantity_scale,conversion_factor_to_base,status)
       values ('g','Gram','mass',6,1,'active'),
              ('l','Liter','volume',6,1,'active'),
              ('unit','Unit','count',0,1,'active')
       on conflict (code) do nothing`,
    );

    mozzarella = await insertVariant(companyId, 'recipe-mozzarella', {
      unitOfMeasureCode: 'g',
      tracksInventory: true,
    });
    pepperoni = await insertVariant(companyId, 'recipe-pepperoni', {
      unitOfMeasureCode: 'g',
      tracksInventory: true,
    });
    salsa = await insertVariant(companyId, 'recipe-salsa', {
      unitOfMeasureCode: 'l',
      tracksInventory: true,
    });
    nonTrackedIngredient = await insertVariant(companyId, 'recipe-non-tracked', {
      unitOfMeasureCode: 'unit',
      tracksInventory: false,
    });
    otherCompanyIngredient = await insertVariant(otherCompanyId, 'recipe-other-ingredient', {
      unitOfMeasureCode: 'g',
      tracksInventory: true,
    });
    noRecipeVariant = await insertVariant(companyId, 'recipe-no-recipe', {
      unitOfMeasureCode: 'unit',
      tracksInventory: false,
    });
    otherCompanyFinishedGood = await insertVariant(otherCompanyId, 'recipe-other-finished-good', {
      unitOfMeasureCode: 'unit',
      tracksInventory: false,
    });

    const authContext: AuthContext = {
      sessionId: randomUUID(),
      userId,
      membershipId: randomUUID(),
      companyId,
      branchId: randomUUID(),
      expiresAt: new Date(Date.now() + 60_000),
      permissions: ['catalog.read', 'product.manage'],
      permittedBranchIds: [],
    };
    const otherAuthContext: AuthContext = {
      ...authContext,
      sessionId: randomUUID(),
      userId: otherUserId,
      companyId: otherCompanyId,
      branchId: randomUUID(),
    };
    // Same tenant as `authContext`, but missing `product.manage` — proves
    // PUT/DELETE are gated server-side, not merely by hiding a UI button.
    const readOnlyAuthContext: AuthContext = {
      ...authContext,
      sessionId: randomUUID(),
      permissions: ['catalog.read'],
    };
    // Same tenant, missing even `catalog.read` — proves GET is gated too.
    const noPermissionAuthContext: AuthContext = {
      ...authContext,
      sessionId: randomUUID(),
      permissions: [],
    };
    const authentication = {
      authenticate: vi.fn((token: string) =>
        Promise.resolve(
          token === 'recipes-other'
            ? otherAuthContext
            : token === 'recipes-readonly'
              ? readOnlyAuthContext
              : token === 'recipes-none'
                ? noPermissionAuthContext
                : authContext,
        ),
      ),
      requirePermission: vi.fn((context: AuthContext, permission: string) => {
        if (!context.permissions.includes(permission))
          throw new AppError({
            code: 'permission_denied',
            message: 'Permission denied.',
            statusCode: 403,
          });
      }),
    } as unknown as AuthService;

    app = Fastify();
    app.addHook('onRequest', (request, _reply, done) => {
      request.requestContext = {
        requestId: randomUUID(),
        correlationId: randomUUID(),
        companyId: undefined,
        branchId: undefined,
        userId: undefined,
        sessionId: undefined,
        deviceId: undefined,
      };
      done();
    });
    app.setErrorHandler((error, request, reply) => {
      if (error instanceof AppError)
        return reply.code(error.statusCode).send({
          error: { code: error.code, message: error.message },
          meta: { request_id: request.requestContext.requestId },
        });
      console.error(error);
      return reply.code(500).send({ error: { code: 'internal_error' } });
    });
    registerProductRecipeRoutes(
      app,
      authentication,
      new ProductRecipeService(new ProductRecipeRepository(database)),
    );
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    for (const table of [
      'product_recipe_components',
      'product_recipes',
      'product_variants',
      'products',
      'outbox_events',
      'audit_log',
      'idempotency_keys',
    ])
      await database.pool.query(`delete from ${table} where company_id in ($1,$2)`, [
        companyId,
        otherCompanyId,
      ]);
    await database.pool.query('delete from company_memberships where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from companies where id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from users where id in ($1,$2)', [userId, otherUserId]);
    await database.close();
  });

  async function insertVariant(
    forCompanyId: string,
    code: string,
    options: { unitOfMeasureCode: string; tracksInventory: boolean },
  ): Promise<Variant> {
    const productId = randomUUID();
    const variantId = randomUUID();
    const actorId = forCompanyId === otherCompanyId ? otherUserId : userId;
    await database.pool.query(
      `insert into products(id,company_id,code,normalized_code,name,product_type,tracks_inventory,status,created_by,updated_by)
       values ($1,$2,$3,$3,$3,'simple',$4,'active',$5,$5)`,
      [productId, forCompanyId, code, options.tracksInventory, actorId],
    );
    await database.pool.query(
      `insert into product_variants
       (id,company_id,product_id,sku,normalized_sku,name,unit_of_measure_code,quantity_scale,
        tracks_inventory,standard_cost,currency_code,is_default,option_signature,status,created_by,updated_by)
       values ($1,$2,$3,$4,$4,$4,$5,0,$6,0,'MXN',true,$7,'active',$8,$8)`,
      [
        variantId,
        forCompanyId,
        productId,
        code,
        options.unitOfMeasureCode,
        options.tracksInventory,
        '0'.repeat(64),
        actorId,
      ],
    );
    return { productId, variantId };
  }

  function auth(token = 'x'): { authorization: string } {
    return { authorization: `Bearer ${token}` };
  }

  it('creates a recipe with two components, then replaces it wholesale', async () => {
    const pizza = await insertVariant(companyId, 'recipe-pizza-replace', {
      unitOfMeasureCode: 'unit',
      tracksInventory: false,
    });
    const created = await app.inject({
      method: 'PUT',
      url: `/api/v1/product-variants/${pizza.variantId}/recipe`,
      headers: { ...auth(), 'idempotency-key': 'create-pizza-recipe' },
      payload: {
        components: [
          { component_variant_id: mozzarella.variantId, quantity: '180', unit_of_measure_code: 'g' },
          { component_variant_id: pepperoni.variantId, quantity: '80', unit_of_measure_code: 'g' },
        ],
      },
    });
    expect(created.statusCode).toBe(200);
    expect(created.headers.etag).toBe('"1"');
    const createdBody = created.json<{
      data: { id: string; is_active: boolean; version: number; components: unknown[] };
    }>().data;
    expect(createdBody.is_active).toBe(true);
    expect(createdBody.version).toBe(1);
    expect(createdBody.components).toHaveLength(2);

    const fetched = await app.inject({
      method: 'GET',
      url: `/api/v1/product-variants/${pizza.variantId}/recipe`,
      headers: auth(),
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json<{ data: { components: unknown[] } }>().data.components).toHaveLength(2);

    // Full replace: a single-ingredient list overwrites the previous two.
    const replaced = await app.inject({
      method: 'PUT',
      url: `/api/v1/product-variants/${pizza.variantId}/recipe`,
      headers: { ...auth(), 'idempotency-key': 'replace-pizza-recipe' },
      payload: {
        components: [
          { component_variant_id: salsa.variantId, quantity: '0.25', unit_of_measure_code: 'l' },
        ],
      },
    });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.headers.etag).toBe('"2"');
    const replacedBody = replaced.json<{
      data: { version: number; components: { component_variant_id: string; quantity: string }[] };
    }>().data;
    expect(replacedBody.version).toBe(2);
    expect(replacedBody.components).toHaveLength(1);
    expect(replacedBody.components[0]?.component_variant_id).toBe(salsa.variantId);
    expect(replacedBody.components[0]?.quantity).toBe('0.250000');
  });

  it('returns 200 with null data for a variant that has no recipe', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/product-variants/${noRecipeVariant.variantId}/recipe`,
      headers: auth(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: unknown }>().data).toBeNull();
  });

  it('accepts an explicit empty components array as a valid, zero-ingredient recipe', async () => {
    const empty = await insertVariant(companyId, 'recipe-empty', {
      unitOfMeasureCode: 'unit',
      tracksInventory: false,
    });
    const response = await app.inject({
      method: 'PUT',
      url: `/api/v1/product-variants/${empty.variantId}/recipe`,
      headers: { ...auth(), 'idempotency-key': 'empty-recipe' },
      payload: { components: [] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: { components: unknown[] } }>().data.components).toEqual([]);
  });

  it('rejects a quantity that is not a positive decimal with at most six decimal places', async () => {
    const target = await insertVariant(companyId, 'recipe-bad-quantity', {
      unitOfMeasureCode: 'unit',
      tracksInventory: false,
    });
    for (const quantity of ['0', '-1', 'abc', '1.1234567']) {
      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/product-variants/${target.variantId}/recipe`,
        headers: { ...auth(), 'idempotency-key': `bad-quantity-${quantity}` },
        payload: {
          components: [
            { component_variant_id: mozzarella.variantId, quantity, unit_of_measure_code: 'g' },
          ],
        },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<{ error: { code: string } }>().error.code).toBe('validation_error');
    }
  });

  it('rejects a component_variant_id that does not exist or belongs to another company', async () => {
    const target = await insertVariant(companyId, 'recipe-bad-ingredient', {
      unitOfMeasureCode: 'unit',
      tracksInventory: false,
    });
    const nonexistent = await app.inject({
      method: 'PUT',
      url: `/api/v1/product-variants/${target.variantId}/recipe`,
      headers: { ...auth(), 'idempotency-key': 'bad-ingredient-nonexistent' },
      payload: {
        components: [
          { component_variant_id: randomUUID(), quantity: '1', unit_of_measure_code: 'g' },
        ],
      },
    });
    expect(nonexistent.statusCode).toBe(400);
    expect(nonexistent.json<{ error: { code: string } }>().error.code).toBe('validation_error');

    // Cross-tenant: a real variant, but owned by `otherCompanyId` — never a
    // 500, never silently accepted.
    const crossTenant = await app.inject({
      method: 'PUT',
      url: `/api/v1/product-variants/${target.variantId}/recipe`,
      headers: { ...auth(), 'idempotency-key': 'bad-ingredient-cross-tenant' },
      payload: {
        components: [
          {
            component_variant_id: otherCompanyIngredient.variantId,
            quantity: '1',
            unit_of_measure_code: 'g',
          },
        ],
      },
    });
    expect(crossTenant.statusCode).toBe(400);
    expect(crossTenant.json<{ error: { code: string } }>().error.code).toBe('validation_error');
  });

  it('rejects an ingredient variant that does not track inventory', async () => {
    const target = await insertVariant(companyId, 'recipe-non-tracked-target', {
      unitOfMeasureCode: 'unit',
      tracksInventory: false,
    });
    const response = await app.inject({
      method: 'PUT',
      url: `/api/v1/product-variants/${target.variantId}/recipe`,
      headers: { ...auth(), 'idempotency-key': 'non-tracked-ingredient' },
      payload: {
        components: [
          {
            component_variant_id: nonTrackedIngredient.variantId,
            quantity: '1',
            unit_of_measure_code: 'unit',
          },
        ],
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('validation_error');
  });

  it('rejects a recipe that references itself as an ingredient', async () => {
    const target = await insertVariant(companyId, 'recipe-self-reference', {
      unitOfMeasureCode: 'unit',
      tracksInventory: true,
    });
    const response = await app.inject({
      method: 'PUT',
      url: `/api/v1/product-variants/${target.variantId}/recipe`,
      headers: { ...auth(), 'idempotency-key': 'self-reference' },
      payload: {
        components: [
          { component_variant_id: target.variantId, quantity: '1', unit_of_measure_code: 'unit' },
        ],
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('validation_error');
  });

  it('rejects duplicate component_variant_id entries within the same request', async () => {
    const target = await insertVariant(companyId, 'recipe-duplicate-ingredient', {
      unitOfMeasureCode: 'unit',
      tracksInventory: false,
    });
    const response = await app.inject({
      method: 'PUT',
      url: `/api/v1/product-variants/${target.variantId}/recipe`,
      headers: { ...auth(), 'idempotency-key': 'duplicate-ingredient' },
      payload: {
        components: [
          { component_variant_id: mozzarella.variantId, quantity: '100', unit_of_measure_code: 'g' },
          { component_variant_id: mozzarella.variantId, quantity: '50', unit_of_measure_code: 'g' },
        ],
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('validation_error');
  });

  it('rejects a unit_of_measure_code that does not exist', async () => {
    const target = await insertVariant(companyId, 'recipe-bad-uom', {
      unitOfMeasureCode: 'unit',
      tracksInventory: false,
    });
    const response = await app.inject({
      method: 'PUT',
      url: `/api/v1/product-variants/${target.variantId}/recipe`,
      headers: { ...auth(), 'idempotency-key': 'bad-uom' },
      payload: {
        components: [
          {
            component_variant_id: mozzarella.variantId,
            quantity: '10',
            unit_of_measure_code: 'not-a-real-unit',
          },
        ],
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('validation_error');
  });

  it("rejects a quantity unit whose dimension does not match the ingredient's own unit", async () => {
    const target = await insertVariant(companyId, 'recipe-dimension-mismatch', {
      unitOfMeasureCode: 'unit',
      tracksInventory: false,
    });
    const response = await app.inject({
      method: 'PUT',
      url: `/api/v1/product-variants/${target.variantId}/recipe`,
      headers: { ...auth(), 'idempotency-key': 'dimension-mismatch' },
      payload: {
        // `salsa` is natively stocked in liters (volume) — grams (mass) is
        // a nonsensical conversion and must be rejected.
        components: [
          { component_variant_id: salsa.variantId, quantity: '10', unit_of_measure_code: 'g' },
        ],
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('validation_error');
  });

  it('returns 404 when :variant_id itself does not exist', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/api/v1/product-variants/${randomUUID()}/recipe`,
      headers: { ...auth(), 'idempotency-key': 'missing-variant' },
      payload: { components: [] },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('not_found');
  });

  it('deletes a recipe, rejects a stale If-Match, and leaves GET returning null afterward', async () => {
    const target = await insertVariant(companyId, 'recipe-delete-target', {
      unitOfMeasureCode: 'unit',
      tracksInventory: false,
    });
    const created = await app.inject({
      method: 'PUT',
      url: `/api/v1/product-variants/${target.variantId}/recipe`,
      headers: { ...auth(), 'idempotency-key': 'delete-target-create' },
      payload: {
        components: [
          { component_variant_id: mozzarella.variantId, quantity: '10', unit_of_measure_code: 'g' },
        ],
      },
    });
    expect(created.statusCode).toBe(200);

    const staleDelete = await app.inject({
      method: 'DELETE',
      url: `/api/v1/product-variants/${target.variantId}/recipe`,
      headers: { ...auth(), 'if-match': '"99"' },
    });
    expect(staleDelete.statusCode).toBe(409);
    expect(staleDelete.json<{ error: { code: string } }>().error.code).toBe('version_conflict');

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/product-variants/${target.variantId}/recipe`,
      headers: { ...auth(), 'if-match': '"1"' },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json<{ data: { deleted: boolean } }>().data.deleted).toBe(true);

    const afterDelete = await app.inject({
      method: 'GET',
      url: `/api/v1/product-variants/${target.variantId}/recipe`,
      headers: auth(),
    });
    expect(afterDelete.statusCode).toBe(200);
    expect(afterDelete.json<{ data: unknown }>().data).toBeNull();

    const deleteAgain = await app.inject({
      method: 'DELETE',
      url: `/api/v1/product-variants/${target.variantId}/recipe`,
      headers: { ...auth(), 'if-match': '"1"' },
    });
    expect(deleteAgain.statusCode).toBe(404);
    expect(deleteAgain.json<{ error: { code: string } }>().error.code).toBe('not_found');
  });

  it("enforces tenant isolation: company B can never read, replace, or delete company A's recipe", async () => {
    const target = await insertVariant(companyId, 'recipe-cross-tenant-target', {
      unitOfMeasureCode: 'unit',
      tracksInventory: false,
    });
    await app.inject({
      method: 'PUT',
      url: `/api/v1/product-variants/${target.variantId}/recipe`,
      headers: { ...auth(), 'idempotency-key': 'cross-tenant-setup' },
      payload: {
        components: [
          { component_variant_id: mozzarella.variantId, quantity: '10', unit_of_measure_code: 'g' },
        ],
      },
    });

    const crossRead = await app.inject({
      method: 'GET',
      url: `/api/v1/product-variants/${target.variantId}/recipe`,
      headers: auth('recipes-other'),
    });
    expect(crossRead.statusCode).toBe(404);
    expect(crossRead.json<{ error: { code: string } }>().error.code).toBe('not_found');

    const crossPut = await app.inject({
      method: 'PUT',
      url: `/api/v1/product-variants/${target.variantId}/recipe`,
      headers: { ...auth('recipes-other'), 'idempotency-key': 'cross-tenant-put' },
      payload: { components: [] },
    });
    expect(crossPut.statusCode).toBe(404);

    const crossDelete = await app.inject({
      method: 'DELETE',
      url: `/api/v1/product-variants/${target.variantId}/recipe`,
      headers: { ...auth('recipes-other'), 'if-match': '"1"' },
    });
    expect(crossDelete.statusCode).toBe(404);

    // Also exercise the reverse direction with a real cross-tenant
    // *finished good* variant (not just a recipe row), so a same-tenant
    // caller pointed at a genuinely different company's variant id never
    // learns it exists.
    const crossReadOtherCompanyVariant = await app.inject({
      method: 'GET',
      url: `/api/v1/product-variants/${otherCompanyFinishedGood.variantId}/recipe`,
      headers: auth(),
    });
    expect(crossReadOtherCompanyVariant.statusCode).toBe(404);
  });

  it('enforces RBAC server-side: catalog.read for GET, product.manage for PUT/DELETE', async () => {
    const target = await insertVariant(companyId, 'recipe-rbac-target', {
      unitOfMeasureCode: 'unit',
      tracksInventory: false,
    });

    const getWithoutCatalogRead = await app.inject({
      method: 'GET',
      url: `/api/v1/product-variants/${target.variantId}/recipe`,
      headers: auth('recipes-none'),
    });
    expect(getWithoutCatalogRead.statusCode).toBe(403);
    expect(getWithoutCatalogRead.json<{ error: { code: string } }>().error.code).toBe(
      'permission_denied',
    );

    const putWithoutProductManage = await app.inject({
      method: 'PUT',
      url: `/api/v1/product-variants/${target.variantId}/recipe`,
      headers: { ...auth('recipes-readonly'), 'idempotency-key': 'rbac-put' },
      payload: { components: [] },
    });
    expect(putWithoutProductManage.statusCode).toBe(403);

    const deleteWithoutProductManage = await app.inject({
      method: 'DELETE',
      url: `/api/v1/product-variants/${target.variantId}/recipe`,
      headers: { ...auth('recipes-readonly'), 'if-match': '"1"' },
    });
    expect(deleteWithoutProductManage.statusCode).toBe(403);
  });
});
