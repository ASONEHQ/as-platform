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

interface QueryResult<T> {
  rows: T[];
}
function result<T>(value: unknown): QueryResult<T> {
  return value as QueryResult<T>;
}

/**
 * TASK 17.2 — proves the two required end-to-end scenarios against a real
 * Postgres instance, plus the two genuinely new backend pieces this task
 * added (`InventoryOverviewService`, `ProductRecipeService.usedIn`):
 *
 * - The "AGUA case" (§30): a direct-stock product, opening balance 10,
 *   sell 2 -> exactly one posted `sale_consumption` movement referencing
 *   the sale, balance settles at 8, no recipe movement is produced (AGUA
 *   has no recipe), and a retried settlement for the SAME sale produces
 *   no duplicate movement and no further balance change.
 * - "Usado en" (§17): given an ingredient variant, the reverse lookup
 *   returns the real recipe that consumes it, with the real per-unit
 *   quantity — never a fabricated relationship.
 * - The Inventory Overview endpoint's real KPI counts, low-stock/
 *   out-of-stock alerts, honest `valuation.available=false`, and
 *   branch-timezone-correct "movements today" count — sourced from the
 *   SAME `inventory_balances`/`inventory_movements` rows the rest of the
 *   module already reads, never a second aggregate.
 *
 * The Pizza Pepperoni recipe-consumption case (§29) already has full,
 * passing coverage in `recipe-consumption.integration.test.ts` (see its
 * "consumes recipe ingredients multiplied by quantity sold" test) with the
 * exact numbers TASK 17.2 §29 specifies — deliberately not duplicated here.
 */
integration('PostgreSQL Inventory V2 — overview, AGUA case, and usado en (TASK 17.2)', () => {
  let database: DatabaseClient;
  let overview: InventoryOverviewService;
  let recipes: ProductRecipeService;

  const companyId = randomUUID();
  const branchId = randomUUID();
  const actorId = randomUUID();
  const locationId = randomUUID();
  const context = {
    companyId,
    actorId,
    correlationId: 'inventory-overview-e2e-correlation',
    timestamp: new Date('2026-09-01T12:00:00.000Z'),
  };

  const aguaId = randomUUID();
  const cheeseId = randomUUID();
  const doughId = randomUUID();
  const pizzaId = randomUUID();
  const pizzaRecipeId = randomUUID();
  // A variant kept permanently at zero stock, to exercise the overview's
  // real `out_of_stock` KPI/alert.
  const outOfStockId = randomUUID();
  // A variant with a real `min_stock` and a balance under it, to exercise
  // the overview's real `low_stock` KPI/alert.
  const lowStockId = randomUUID();

  async function insertProductAndVariant(
    productId: string,
    variantId: string,
    sku: string,
    unitOfMeasureCode: string,
    tracksInventory: boolean,
    minStock: string | null = null,
  ): Promise<void> {
    await database.pool.query(
      `insert into products
       (id,company_id,code,normalized_code,name,product_type,tracks_inventory,status,created_by,updated_by)
       values($1,$2,$3,$3,$3,'simple',$4,'active',$5,$5)`,
      [productId, companyId, sku, tracksInventory, actorId],
    );
    await database.pool.query(
      `insert into product_variants
       (id,company_id,product_id,sku,normalized_sku,name,unit_of_measure_code,quantity_scale,
        tracks_inventory,min_stock,standard_cost,currency_code,is_default,option_signature,status,created_by,updated_by)
       values($1,$2,$3,$4,$4,$4,$5,6,$6,$9,0,'MXN',true,$7,'active',$8,$8)`,
      [
        variantId,
        companyId,
        productId,
        sku,
        unitOfMeasureCode,
        tracksInventory,
        randomUUID().replaceAll('-', '').padEnd(64, '0'),
        actorId,
        minStock,
      ],
    );
  }

  async function openingBalance(variantId: string, quantity: string): Promise<void> {
    await database.pool.query(
      `insert into inventory_balances
       (id,company_id,branch_id,inventory_location_id,product_variant_id,quantity_on_hand,version)
       values($1,$2,$3,$4,$5,$6,1)`,
      [randomUUID(), companyId, branchId, locationId, variantId, quantity],
    );
  }

  async function onHand(variantId: string): Promise<string> {
    const row = result<{ quantity_on_hand: string }>(
      await database.pool.query(
        `select quantity_on_hand::text from inventory_balances
         where company_id=$1 and inventory_location_id=$2 and product_variant_id=$3`,
        [companyId, locationId, variantId],
      ),
    ).rows[0];
    return row?.quantity_on_hand ?? '0.000000';
  }

  async function movementsFor(variantId: string): Promise<
    { movement_type: string; status: string; reference_type: string | null; reference_id: string | null }[]
  > {
    return result<{
      movement_type: string;
      status: string;
      reference_type: string | null;
      reference_id: string | null;
    }>(
      await database.pool.query(
        `select m.movement_type, m.status, m.reference_type, m.reference_id
         from inventory_movements m
         join inventory_movement_lines l on l.company_id=m.company_id and l.inventory_movement_id=m.id
         where m.company_id=$1 and l.product_variant_id=$2`,
        [companyId, variantId],
      ),
    ).rows;
  }

  beforeAll(async () => {
    if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({
      connectionString: databaseUrl,
      applicationName: 'asone-inventory-overview-integration',
    });
    const schema = await database.pool.query<{ present: string | null }>(
      `select to_regclass('public.product_recipes')::text present`,
    );
    if (schema.rows[0]?.present === null)
      throw new Error('Migration 0048_add_product_recipes must be applied before this test.');
    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'Inventory Overview E2E','Inventory Overview E2E',$2,'active','UTC','MXN','es-MX')`,
      [companyId, `inventory-overview-e2e-${companyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'Sucursal Overview','O','active','UTC')`,
      [branchId, companyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'Inventory Overview E2E User','active')`,
      [actorId, `inventory-overview-e2e-${actorId}@example.test`],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status) values($1,$2,$3,'active')`,
      [randomUUID(), companyId, actorId],
    );
    await database.pool.query(
      `insert into inventory_locations
       (id,company_id,branch_id,code,normalized_code,name,location_type,is_default,created_by,updated_by)
       values($1,$2,$3,'MAIN','main','Principal','main',true,$4,$4)`,
      [locationId, companyId, branchId, actorId],
    );
    await database.pool.query(
      `insert into units_of_measure (code,name,dimension,quantity_scale,conversion_factor_to_base,status)
       values
         ('unit','Unit','count',0,1,'active'),
         ('g','Gramo','mass',3,1,'active'),
         ('kg','Kilogramo','mass',3,1000,'active')
       on conflict (code) do nothing`,
    );

    await insertProductAndVariant(aguaId, aguaId, `agua-${aguaId}`, 'unit', true);
    await insertProductAndVariant(cheeseId, cheeseId, `cheese-${cheeseId}`, 'kg', true);
    await insertProductAndVariant(doughId, doughId, `dough-${doughId}`, 'unit', true);
    await insertProductAndVariant(pizzaId, pizzaId, `pizza-${pizzaId}`, 'unit', false);
    await insertProductAndVariant(outOfStockId, outOfStockId, `out-${outOfStockId}`, 'unit', true);
    await insertProductAndVariant(lowStockId, lowStockId, `low-${lowStockId}`, 'unit', true, '5');

    await database.pool.query(
      `insert into product_recipes (id,company_id,product_variant_id,is_active,created_by,updated_by)
       values($1,$2,$3,true,$4,$4)`,
      [pizzaRecipeId, companyId, pizzaId, actorId],
    );
    await database.pool.query(
      `insert into product_recipe_components
       (id,company_id,recipe_id,component_variant_id,quantity,unit_of_measure_code,created_at,created_by,updated_by)
       values($1,$2,$3,$4,'180',$5,$6,$7,$7),($8,$2,$3,$9,'1','unit',$6,$7,$7)`,
      [randomUUID(), companyId, pizzaRecipeId, cheeseId, 'g', context.timestamp, actorId, randomUUID(), doughId],
    );

    await openingBalance(aguaId, '10');
    await openingBalance(cheeseId, '20');
    await openingBalance(doughId, '20');
    await openingBalance(outOfStockId, '0');
    await openingBalance(lowStockId, '2');

    overview = new InventoryOverviewService(new InventoryOverviewRepository(database));
    recipes = new ProductRecipeService(new ProductRecipeRepository(database));
  });

  afterAll(async () => {
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
    await database.pool.query('delete from users where id=$1', [actorId]);
    await database.close();
  });

  it('AGUA case: sells 2 of 10, settles at 8 with exactly one referenced movement and no duplicate on retry', async () => {
    const saleId = randomUUID();
    const sale = await postSaleConsumption(
      database.pool,
      context,
      { id: saleId, branchId, saleNumber: 'OVERVIEW-AGUA-SALE-1' },
      [{ productVariantId: aguaId, quantity: '2', nameSnapshot: 'Agua' }],
    );
    expect(sale.posted).toBe(true);
    expect(await onHand(aguaId)).toBe('8.000000');

    const movements = await movementsFor(aguaId);
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      movement_type: 'sale_consumption',
      status: 'posted',
      reference_type: 'sale',
      reference_id: saleId,
    });

    // Retrying the SAME sale must not duplicate the movement or move the
    // balance again — the database itself rejects it via the unique
    // `(company_id, reference_id)` index where `reference_type='sale'`
    // (`inventory_movements_sale_reference_uq`), matching the established
    // behavior proven in `recipe-consumption.integration.test.ts`'s own
    // idempotency test: this function does not swallow the conflict, the
    // caller is expected to treat it as "already settled."
    await expect(
      postSaleConsumption(
        database.pool,
        context,
        { id: saleId, branchId, saleNumber: 'OVERVIEW-AGUA-SALE-1' },
        [{ productVariantId: aguaId, quantity: '2', nameSnapshot: 'Agua' }],
      ),
    ).rejects.toThrow();
    expect(await onHand(aguaId)).toBe('8.000000');
    expect(await movementsFor(aguaId)).toHaveLength(1);
  });

  it('TASK 17.2.4 — recentActivity reports one real row per movement LINE, with real product identity, direction, and recipe-vs-direct metadata', async () => {
    // Sells 1 Pizza Pepperoni: a recipe-driven product (tracksInventory=
    // false), so this posts ONE movement with 2 recipe lines (cheese +
    // dough) — no direct line, since Pizza itself is never stock-tracked.
    const pizzaSaleId = randomUUID();
    const pizzaSale = await postSaleConsumption(
      database.pool,
      context,
      { id: pizzaSaleId, branchId, saleNumber: 'OVERVIEW-PIZZA-SALE-1' },
      [{ productVariantId: pizzaId, quantity: '1', nameSnapshot: 'Pizza Pepperoni' }],
    );
    expect(pizzaSale.posted).toBe(true);

    const snapshot = await overview.get(companyId, branchId);
    const cheeseActivity = snapshot.recentActivity.find((activity) => activity.productVariantId === cheeseId);
    const doughActivity = snapshot.recentActivity.find((activity) => activity.productVariantId === doughId);
    const aguaActivity = snapshot.recentActivity.find((activity) => activity.productVariantId === aguaId);

    // The AGUA sale (direct, non-recipe) — real product identity, real
    // quantity, direction derived structurally (source set, destination
    // null => 'out'), and metadata genuinely null.
    expect(aguaActivity).toMatchObject({
      referenceType: 'sale',
      quantity: '2.000000',
      unitOfMeasureCode: 'unit',
      direction: 'out',
      metadata: null,
    });
    expect(aguaActivity?.productName).toBeTruthy();

    // The Pizza recipe lines — TWO separate activity rows (never collapsed
    // into one "Pizza" row that would misattribute which real ingredient
    // moved), each with the real, authoritative `metadata.source==='recipe'`
    // signal and the real frozen sold-product-name snapshot — never
    // inferred from `is_sellable` or product naming.
    expect(cheeseActivity).toMatchObject({
      referenceType: 'sale',
      quantity: '0.180000',
      unitOfMeasureCode: 'kg',
      direction: 'out',
      metadata: { source: 'recipe', sold_product_name_snapshot: 'Pizza Pepperoni' },
    });
    expect(doughActivity).toMatchObject({
      referenceType: 'sale',
      quantity: '1.000000',
      unitOfMeasureCode: 'unit',
      direction: 'out',
      metadata: { source: 'recipe', sold_product_name_snapshot: 'Pizza Pepperoni' },
    });
  });

  it('TASK 17.2.4 — the movements list enriches a single-line movement with real product identity, and reports an honest line_count for a multi-line one', async () => {
    const movements = new InventoryMovementReadService(new InventoryMovementReadRepository(database));
    const page = await movements.list(companyId, [branchId], { limit: 20 });

    const aguaMovement = page.items.find(
      (item) => (item as { reference_type?: string; source_document_number?: string }).source_document_number === 'OVERVIEW-AGUA-SALE-1',
    ) as Record<string, unknown> | undefined;
    expect(aguaMovement).toMatchObject({
      line_count: 1,
      product_variant_id: aguaId,
      quantity: '2.000000',
      unit_of_measure_code: 'unit',
      direction: 'out',
      metadata: null,
    });
    expect(aguaMovement?.product_name).toEqual(expect.any(String));

    const pizzaMovement = page.items.find(
      (item) => (item as { source_document_number?: string }).source_document_number === 'OVERVIEW-PIZZA-SALE-1',
    ) as Record<string, unknown> | undefined;
    // Two real lines (cheese + dough) — never collapsed into a fabricated
    // single product for the whole movement.
    expect(pizzaMovement).toMatchObject({
      line_count: 2,
      product_variant_id: null,
      product_name: null,
      quantity: null,
      direction: null,
    });
  });

  it('usado en: reports the real recipe(s) that consume an ingredient, with the real per-unit quantity', async () => {
    const usages = await recipes.usedIn(companyId, cheeseId);
    expect(usages).toHaveLength(1);
    expect(usages[0]).toMatchObject({
      recipeId: pizzaRecipeId,
      isRecipeActive: true,
      soldProductVariantId: pizzaId,
      quantity: '180.000000',
      unitOfMeasureCode: 'g',
    });

    // An ingredient nothing references must report no usage, not an error.
    expect(await recipes.usedIn(companyId, aguaId)).toEqual([]);
  });

  it('overview: reports real KPI counts, real low-stock/out-of-stock alerts, and an honest unavailable valuation', async () => {
    const snapshot = await overview.get(companyId, branchId);

    expect(snapshot.itemCount).toBe(5);
    expect(snapshot.outOfStockCount).toBe(1);
    expect(snapshot.lowStockCount).toBe(1);
    expect(snapshot.valuation.available).toBe(false);
    expect(snapshot.valuation.reason).toContain('costo');

    const alertIds = snapshot.alerts.map((alert) => alert.productVariantId);
    expect(alertIds).toContain(outOfStockId);
    expect(alertIds).toContain(lowStockId);
    const outOfStockAlert = snapshot.alerts.find((alert) => alert.productVariantId === outOfStockId);
    expect(outOfStockAlert?.stockStatus).toBe('out_of_stock');
    const lowStockAlert = snapshot.alerts.find((alert) => alert.productVariantId === lowStockId);
    expect(lowStockAlert?.stockStatus).toBe('low_stock');
    expect(lowStockAlert?.minStock).toBe('5.000000');

    // The AGUA sale from the earlier test in this file is dated by the
    // fixture's own fixed `context.timestamp` (2026-09-01), not real
    // "today" — it must NOT be counted. Only a movement genuinely
    // `occurred_at=now()` should count, proving the query's
    // branch-timezone-correct "today" boundary is real, not a pass-through
    // of every historical row.
    expect(snapshot.movementsTodayCount).toBe(0);
    await database.pool.query(
      `insert into inventory_movements
       (id,company_id,branch_id,movement_number,movement_type,status,version,
        occurred_at,posted_at,posted_by,created_by,updated_by)
       values($1,$2,$3,'IMV-OVERVIEW-TODAY','adjustment','posted',1,now(),now(),$4,$4,$4)`,
      [randomUUID(), companyId, branchId, actorId],
    );
    const withTodayMovement = await overview.get(companyId, branchId);
    expect(withTodayMovement.movementsTodayCount).toBe(1);

    const byLocation = snapshot.byLocation.find((location) => location.locationId === locationId);
    expect(byLocation?.itemCount).toBe(5);
    expect(byLocation?.outOfStockCount).toBe(1);
    expect(byLocation?.lowStockCount).toBe(1);
  });

  it('overview: rejects a branch with no matching active branch row rather than silently defaulting a timezone', async () => {
    await expect(overview.get(companyId, randomUUID())).rejects.toMatchObject({
      code: 'branch_timezone_invalid',
    });
  });
});
