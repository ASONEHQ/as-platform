import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';

import { ProductRecipeRepository } from '../catalog/product-recipes.repository.js';
import { ProductRecipeService } from '../catalog/product-recipes.service.js';
import { InventoryOverviewRepository, InventoryOverviewService } from './inventory-overview.js';
import { InventoryMovementReadRepository } from './inventory.repository.js';
import { InventoryMovementReadService } from './inventory.service.js';
import { postSaleConsumption } from './sale-consumption.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;

/**
 * TASK 17.2.2 §10/§11 — dedicated cross-tenant and cross-branch negative
 * tests for the two endpoints TASK 17.2's own pre-push gate flagged as
 * "structurally sound but not explicitly proven by a new dedicated
 * automated test": `GET /inventory/overview` and
 * `GET /product-variants/:variant_id/used-in`. Exercises the SAME
 * `InventoryOverviewService`/`ProductRecipeService` the real HTTP routes
 * call — every one of those routes' own tenant/branch guards
 * (`requireBranchAccess`, `auth.companyId`-bound queries) already reduce to
 * "pass the AUTHENTICATED company's id, never a client-suppliable one,"
 * which is exactly what these tests hold constant while varying which
 * company/branch is asking.
 */
integration('PostgreSQL Inventory V2 — cross-tenant/cross-branch isolation (TASK 17.2.2)', () => {
  let database: DatabaseClient;
  let overview: InventoryOverviewService;
  let recipes: ProductRecipeService;
  let movements: InventoryMovementReadService;

  const actorId = randomUUID();

  // Company A — two branches, to also prove branch-level isolation WITHIN
  // one tenant (§10 case C).
  const companyAId = randomUUID();
  const branchA1Id = randomUUID();
  const branchA2Id = randomUUID();
  const locationA1Id = randomUUID();
  const locationA2Id = randomUUID();
  const variantA1Id = randomUUID();
  const variantA2Id = randomUUID();

  // Company B — fully separate tenant, real recognizable data ("Queso
  // Secreto B") that must never surface in a Company A response.
  const companyBId = randomUUID();
  const branchBId = randomUUID();
  const locationBId = randomUUID();
  const ingredientBId = randomUUID();
  const soldBId = randomUUID();
  const recipeBId = randomUUID();

  async function insertCompany(companyId: string, name: string): Promise<void> {
    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,$2,$2,$3,'active','UTC','MXN','es-MX')`,
      [companyId, name, `isolation-${companyId}`],
    );
  }
  async function insertBranch(companyId: string, branchId: string, code: string): Promise<void> {
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,$3,$3,'active','UTC')`,
      [branchId, companyId, code],
    );
  }
  async function insertLocation(companyId: string, branchId: string, locationId: string, code: string): Promise<void> {
    await database.pool.query(
      `insert into inventory_locations
       (id,company_id,branch_id,code,normalized_code,name,location_type,is_default,created_by,updated_by)
       values($1,$2,$3,$4,$5,$4,'main',true,$6,$6)`,
      [locationId, companyId, branchId, code, code.toLowerCase(), actorId],
    );
  }
  async function insertVariant(
    companyId: string,
    productId: string,
    variantId: string,
    sku: string,
    name: string,
  ): Promise<void> {
    await database.pool.query(
      `insert into products
       (id,company_id,code,normalized_code,name,product_type,tracks_inventory,status,created_by,updated_by)
       values($1,$2,$3,$4,$5,'simple',true,'active',$6,$6)`,
      [productId, companyId, sku, sku.toLowerCase(), name, actorId],
    );
    await database.pool.query(
      `insert into product_variants
       (id,company_id,product_id,sku,normalized_sku,name,unit_of_measure_code,quantity_scale,
        tracks_inventory,standard_cost,currency_code,is_default,option_signature,status,created_by,updated_by)
       values($1,$2,$3,$4,$5,$6,'unit',0,true,0,'MXN',true,$7,'active',$8,$8)`,
      [
        variantId,
        companyId,
        productId,
        sku,
        sku.toLowerCase(),
        name,
        randomUUID().replaceAll('-', '').padEnd(64, '0'),
        actorId,
      ],
    );
  }
  async function insertBalance(
    companyId: string,
    branchId: string,
    locationId: string,
    variantId: string,
    quantity: string,
  ): Promise<void> {
    await database.pool.query(
      `insert into inventory_balances
       (id,company_id,branch_id,inventory_location_id,product_variant_id,quantity_on_hand,version)
       values($1,$2,$3,$4,$5,$6,1)`,
      [randomUUID(), companyId, branchId, locationId, variantId, quantity],
    );
  }

  beforeAll(async () => {
    if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({
      connectionString: databaseUrl,
      applicationName: 'asone-inventory-isolation-integration',
    });
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'Isolation Test User','active')`,
      [actorId, `inventory-isolation-${actorId}@example.test`],
    );

    await insertCompany(companyAId, 'Isolation Company A');
    await insertCompany(companyBId, 'Isolation Company B');
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status) values($1,$2,$3,'active'),($4,$5,$3,'active')`,
      [randomUUID(), companyAId, actorId, randomUUID(), companyBId],
    );

    await insertBranch(companyAId, branchA1Id, 'A1');
    await insertBranch(companyAId, branchA2Id, 'A2');
    await insertBranch(companyBId, branchBId, 'B1');
    await insertLocation(companyAId, branchA1Id, locationA1Id, 'A1-MAIN');
    await insertLocation(companyAId, branchA2Id, locationA2Id, 'A2-MAIN');
    await insertLocation(companyBId, branchBId, locationBId, 'B1-MAIN');

    await insertVariant(companyAId, variantA1Id, variantA1Id, 'A1-SKU', 'Producto Sucursal A1');
    await insertVariant(companyAId, variantA2Id, variantA2Id, 'A2-SKU', 'Producto Sucursal A2');
    await insertVariant(companyBId, ingredientBId, ingredientBId, 'B-INSUMO-SKU', 'Queso Secreto B');
    await insertVariant(companyBId, soldBId, soldBId, 'B-VENDIDO-SKU', 'Producto Vendido B');

    await insertBalance(companyAId, branchA1Id, locationA1Id, variantA1Id, '20');
    await insertBalance(companyAId, branchA2Id, locationA2Id, variantA2Id, '30');
    await insertBalance(companyBId, branchBId, locationBId, ingredientBId, '40');

    // A real Company B recipe, so a leaked used-in response would be
    // unmistakable (a real recipe id, sold-product name, and quantity —
    // never fabricated, never accidentally shared with Company A).
    await database.pool.query(
      `insert into product_recipes (id,company_id,product_variant_id,is_active,created_by,updated_by)
       values($1,$2,$3,true,$4,$4)`,
      [recipeBId, companyBId, soldBId, actorId],
    );
    await database.pool.query(
      `insert into product_recipe_components
       (id,company_id,recipe_id,component_variant_id,quantity,unit_of_measure_code,created_at,created_by,updated_by)
       values($1,$2,$3,$4,'250','g',now(),$5,$5)`,
      [randomUUID(), companyBId, recipeBId, ingredientBId, actorId],
    );

    // TASK 17.2.4 §16 — a real Company B movement/sale, distinctly named,
    // so a leaked recentActivity/movements-list row would be unmistakable.
    await postSaleConsumption(
      database.pool,
      { companyId: companyBId, actorId, correlationId: 'isolation-b-sale', timestamp: new Date() },
      { id: randomUUID(), branchId: branchBId, saleNumber: 'ISOLATION-B-SALE-1' },
      [{ productVariantId: ingredientBId, quantity: '3', nameSnapshot: 'Queso Secreto B' }],
    );

    overview = new InventoryOverviewService(new InventoryOverviewRepository(database));
    recipes = new ProductRecipeService(new ProductRecipeRepository(database));
    movements = new InventoryMovementReadService(new InventoryMovementReadRepository(database));
  });

  afterAll(async () => {
    for (const companyId of [companyAId, companyBId]) {
      await database.pool.query('delete from outbox_events where company_id=$1', [companyId]);
      await database.pool.query('delete from audit_log where company_id=$1', [companyId]);
      await database.pool.query('delete from idempotency_keys where company_id=$1', [companyId]);
      await database.pool.query('delete from inventory_movement_lines where company_id=$1', [companyId]);
      await database.pool.query('delete from inventory_balances where company_id=$1', [companyId]);
      await database.pool.query('delete from inventory_movements where company_id=$1', [companyId]);
      await database.pool.query('delete from product_recipe_components where company_id=$1', [companyId]);
      await database.pool.query('delete from product_recipes where company_id=$1', [companyId]);
      await database.pool.query('delete from inventory_locations where company_id=$1', [companyId]);
      await database.pool.query('delete from product_variants where company_id=$1', [companyId]);
      await database.pool.query('delete from products where company_id=$1', [companyId]);
      await database.pool.query('delete from company_memberships where company_id=$1', [companyId]);
      await database.pool.query('delete from branches where company_id=$1', [companyId]);
      await database.pool.query('delete from companies where id=$1', [companyId]);
    }
    await database.pool.query('delete from users where id=$1', [actorId]);
    await database.close();
  });

  describe('GET /inventory/overview isolation', () => {
    it('§10.A — Company A cannot access Company B branch overview', async () => {
      await expect(overview.get(companyAId, branchBId)).rejects.toMatchObject({
        code: 'branch_timezone_invalid',
      });
    });

    it("§10.B — Company A's own overview never contains Company B balances, alerts, or locations", async () => {
      const snapshot = await overview.get(companyAId, branchA1Id);

      // Only Company A's own branch A1 item is counted/visible — Company
      // B's balance (and its own branch A2's balance) never appears.
      expect(snapshot.itemCount).toBe(1);
      expect(snapshot.byLocation.map((location) => location.locationId)).not.toContain(locationBId);
      expect(snapshot.byLocation.map((location) => location.locationName)).not.toContain('B1-MAIN');
      expect(snapshot.alerts.map((alert) => alert.productVariantId)).not.toContain(ingredientBId);
      expect(snapshot.alerts.map((alert) => alert.productName)).not.toContain('Queso Secreto B');
      // Company A's branch A1 genuinely has zero movements of its own —
      // its recentActivity is empty, never Company B's real sale.
      expect(snapshot.recentActivity.map((activity) => activity.movementId)).toEqual([]);
      expect(snapshot.recentActivity.map((activity) => activity.productName)).not.toContain('Queso Secreto B');

      // Positive control: Company B's OWN overview genuinely DOES show its
      // real sale — proving the empty result above is real isolation, not
      // a query bug that would hide the activity from everyone.
      const companyBSnapshot = await overview.get(companyBId, branchBId);
      expect(companyBSnapshot.recentActivity).toHaveLength(1);
      expect(companyBSnapshot.recentActivity[0]).toMatchObject({
        productVariantId: ingredientBId,
        productName: 'Queso Secreto B',
        quantity: '3.000000',
      });
    });

    it('§10.C — Branch A1 overview never leaks Branch A2 data within the same company', async () => {
      const snapshot = await overview.get(companyAId, branchA1Id);

      expect(snapshot.itemCount).toBe(1);
      expect(snapshot.byLocation).toHaveLength(1);
      expect(snapshot.byLocation[0]?.locationId).toBe(locationA1Id);
      expect(snapshot.byLocation.map((location) => location.locationId)).not.toContain(locationA2Id);

      const otherBranch = await overview.get(companyAId, branchA2Id);
      expect(otherBranch.byLocation).toHaveLength(1);
      expect(otherBranch.byLocation[0]?.locationId).toBe(locationA2Id);
    });
  });

  describe('GET /product-variants/:variant_id/used-in isolation', () => {
    it("§11.A/§11.B — Company A querying a Company B variant receives no recipe data at all, never a leaked recipe/product/SKU", async () => {
      await expect(recipes.usedIn(companyAId, ingredientBId)).rejects.toMatchObject({
        code: 'resource_not_found',
      });
    });

    it('§11.C — a valid, same-company ingredient returns exactly its own real recipe relationships', async () => {
      const usages = await recipes.usedIn(companyBId, ingredientBId);
      expect(usages).toHaveLength(1);
      expect(usages[0]).toMatchObject({
        recipeId: recipeBId,
        isRecipeActive: true,
        soldProductVariantId: soldBId,
        soldProductName: 'Producto Vendido B',
        quantity: '250.000000',
        unitOfMeasureCode: 'g',
      });

      // Company A has no recipe referencing Company B's ingredient — and,
      // structurally, could not even name it: `usedIn` 404s before ever
      // reaching the recipe-lookup query (proven by the test immediately
      // above).
      const variantA1Usages = await recipes.usedIn(companyAId, variantA1Id);
      expect(variantA1Usages).toEqual([]);
    });
  });

  // TASK 17.2.4 §16/§21.I/§21.J — the movement-list enrichment
  // (`InventoryMovementReadService.list`'s `line_count`/product-identity
  // fields, see `movement-line-summaries.ts`) reuses the exact same
  // company-scoped query pattern; proven separately here since it is a
  // genuinely new enrichment this task added.
  describe('GET /inventory/movements isolation', () => {
    it("Company A's movement list never contains Company B's movement, product identity, or reference data", async () => {
      const page = await movements.list(companyAId, [branchA1Id, branchA2Id], { limit: 50 });
      const productNames = page.items.map((item) => item.product_name);
      const sourceDocuments = page.items.map((item) => item.source_document_number);
      expect(productNames).not.toContain('Queso Secreto B');
      expect(sourceDocuments).not.toContain('ISOLATION-B-SALE-1');

      // Positive control: Company B's own movement list genuinely does
      // show its real sale, with real enrichment — proving the above is
      // real isolation, not a query bug hiding it from everyone.
      const companyBPage = await movements.list(companyBId, [branchBId], { limit: 50 });
      const companyBMovement = companyBPage.items.find(
        (item) => item.source_document_number === 'ISOLATION-B-SALE-1',
      );
      expect(companyBMovement).toMatchObject({
        line_count: 1,
        product_variant_id: ingredientBId,
        product_name: 'Queso Secreto B',
        quantity: '3.000000',
        direction: 'out',
      });
    });
  });
});
