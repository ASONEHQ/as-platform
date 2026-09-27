import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';

import { postSaleConsumption, SaleInventoryPostingError } from './sale-consumption.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;

interface QueryResult<T> {
  rows: T[];
}
function result<T>(value: unknown): QueryResult<T> {
  return value as QueryResult<T>;
}

/**
 * TASK 16.32 — proves `postSaleConsumption`'s recipe (bill-of-materials)
 * expansion: a sold product with an active `product_recipes` row must
 * decrement its ingredients' *own* inventory, multiplied by the quantity
 * sold, unit-converted safely (recipe authored in grams, ingredient stocked
 * in kilograms), aggregated correctly across multiple recipe-bearing
 * products in one sale while staying individually traceable, exactly-once
 * even under a retried settlement, and fully atomic — a mid-recipe stock
 * shortfall must leave every ingredient's balance completely untouched, not
 * partially consumed. A product with no recipe at all must behave exactly
 * as it did before this task (`product-recipes` is empty for it).
 *
 * Recipe rows are inserted directly via SQL — this file deliberately does
 * NOT exercise the `product-recipes` admin CRUD API (covered by its own
 * integration test); it only proves the sale-settlement consumption side,
 * which is the business-critical path.
 */
integration('PostgreSQL recipe (BOM) inventory consumption (TASK 16.32)', () => {
  let database: DatabaseClient;

  const companyId = randomUUID();
  const branchId = randomUUID();
  const actorId = randomUUID();
  const locationId = randomUUID();
  const context = {
    companyId,
    actorId,
    correlationId: 'recipe-e2e-correlation',
    timestamp: new Date('2026-09-01T12:00:00.000Z'),
  };

  // Ingredients (real, stock-tracked variants).
  const doughId = randomUUID();
  const cheeseId = randomUUID();
  const pepperoniId = randomUUID();
  const sauceId = randomUUID();
  // Sellable, recipe-bearing products (never themselves stock-tracked —
  // they are "made from" their recipe, not stocked directly).
  const pizzaId = randomUUID();
  const nachosId = randomUUID();
  // A sellable, stock-tracked product with NO recipe at all — the backward
  // compatibility control (Phase 28).
  const plainId = randomUUID();

  const pizzaRecipeId = randomUUID();
  const nachosRecipeId = randomUUID();

  async function insertProductAndVariant(
    productId: string,
    variantId: string,
    sku: string,
    unitOfMeasureCode: string,
    tracksInventory: boolean,
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
        tracks_inventory,standard_cost,currency_code,is_default,option_signature,status,created_by,updated_by)
       values($1,$2,$3,$4,$4,$4,$5,6,$6,0,'MXN',true,$7,'active',$8,$8)`,
      [
        variantId,
        companyId,
        productId,
        sku,
        unitOfMeasureCode,
        tracksInventory,
        randomUUID().replaceAll('-', '').padEnd(64, '0'),
        actorId,
      ],
    );
  }

  async function insertRecipe(
    recipeId: string,
    productVariantId: string,
    components: readonly { variantId: string; quantity: string; unitOfMeasureCode: string }[],
  ): Promise<void> {
    await database.pool.query(
      `insert into product_recipes
       (id,company_id,product_variant_id,is_active,created_by,updated_by)
       values($1,$2,$3,true,$4,$4)`,
      [recipeId, companyId, productVariantId, actorId],
    );
    for (const [index, component] of components.entries()) {
      await database.pool.query(
        `insert into product_recipe_components
         (id,company_id,recipe_id,component_variant_id,quantity,unit_of_measure_code,created_at,created_by,updated_by)
         values($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
        [
          randomUUID(),
          companyId,
          recipeId,
          component.variantId,
          component.quantity,
          component.unitOfMeasureCode,
          new Date(context.timestamp.getTime() + index),
          actorId,
        ],
      );
    }
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

  beforeAll(async () => {
    if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({
      connectionString: databaseUrl,
      applicationName: 'asone-recipe-consumption-integration',
    });
    const schema = await database.pool.query<{ present: string | null }>(
      `select to_regclass('public.product_recipes')::text present`,
    );
    if (schema.rows[0]?.present === null)
      throw new Error('Migration 0048_add_product_recipes must be applied before this test.');
    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'Recipe E2E','Recipe E2E',$2,'active','UTC','MXN','es-MX')`,
      [companyId, `recipe-e2e-${companyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'Sucursal Receta','R','active','UTC')`,
      [branchId, companyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'Recipe E2E User','active')`,
      [actorId, `recipe-e2e-${actorId}@example.test`],
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
         ('kg','Kilogramo','mass',3,1000,'active'),
         ('ml','Mililitro','volume',3,1,'active'),
         ('l','Litro','volume',3,1000,'active')
       on conflict (code) do nothing`,
    );

    await insertProductAndVariant(randomUUID(), doughId, `dough-${doughId}`, 'unit', true);
    await insertProductAndVariant(randomUUID(), cheeseId, `cheese-${cheeseId}`, 'kg', true);
    await insertProductAndVariant(randomUUID(), pepperoniId, `pepperoni-${pepperoniId}`, 'kg', true);
    await insertProductAndVariant(randomUUID(), sauceId, `sauce-${sauceId}`, 'kg', true);
    await insertProductAndVariant(pizzaId, pizzaId, `pizza-${pizzaId}`, 'unit', false);
    await insertProductAndVariant(nachosId, nachosId, `nachos-${nachosId}`, 'unit', false);
    await insertProductAndVariant(plainId, plainId, `plain-${plainId}`, 'unit', true);

    await insertRecipe(pizzaRecipeId, pizzaId, [
      { variantId: doughId, quantity: '1', unitOfMeasureCode: 'unit' },
      { variantId: cheeseId, quantity: '180', unitOfMeasureCode: 'g' },
      { variantId: pepperoniId, quantity: '80', unitOfMeasureCode: 'g' },
      { variantId: sauceId, quantity: '120', unitOfMeasureCode: 'g' },
    ]);
    await insertRecipe(nachosRecipeId, nachosId, [
      { variantId: cheeseId, quantity: '100', unitOfMeasureCode: 'g' },
    ]);
  });

  afterAll(async () => {
    await database.pool.query('delete from outbox_events where company_id=$1', [companyId]);
    await database.pool.query('delete from audit_log where company_id=$1', [companyId]);
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

  it('consumes recipe ingredients multiplied by quantity sold, unit-converted from grams into the ingredients own kilogram stock', async () => {
    await openingBalance(doughId, '50');
    await openingBalance(cheeseId, '10');
    await openingBalance(pepperoniId, '5');
    await openingBalance(sauceId, '8');

    const sale = await postSaleConsumption(
      database.pool,
      context,
      { id: randomUUID(), branchId, saleNumber: 'RECIPE-SALE-1' },
      [{ productVariantId: pizzaId, quantity: '2', nameSnapshot: 'Pizza Pepperoni' }],
    );
    expect(sale.posted).toBe(true);

    // Phase 41's exact expected delta: 2 pizzas -> -2 dough, -360g cheese,
    // -160g pepperoni, -240g sauce — each correctly converted from the
    // recipe's own grams into the ingredient's native kilograms.
    expect(await onHand(doughId)).toBe('48.000000');
    expect(await onHand(cheeseId)).toBe('9.640000');
    expect(await onHand(pepperoniId)).toBe('4.840000');
    expect(await onHand(sauceId)).toBe('7.760000');

    const lines = result<{ product_variant_id: string; metadata: Record<string, unknown> | null }>(
      await database.pool.query(
        `select product_variant_id, metadata from inventory_movement_lines
         where company_id=$1 and inventory_movement_id=$2`,
        [companyId, sale.movementId],
      ),
    ).rows;
    const cheeseLine = lines.find((line) => line.product_variant_id === cheeseId);
    expect(cheeseLine?.metadata).toMatchObject({
      source: 'recipe',
      sold_product_variant_id: pizzaId,
      recipe_component_quantity: '180.000000',
      recipe_component_unit_of_measure_code: 'g',
    });
  });

  it('aggregates the same ingredient across multiple recipe-bearing products in one sale as separate, traceable lines', async () => {
    const before = await onHand(cheeseId);
    const sale = await postSaleConsumption(
      database.pool,
      context,
      { id: randomUUID(), branchId, saleNumber: 'RECIPE-SALE-2' },
      [
        { productVariantId: pizzaId, quantity: '2', nameSnapshot: 'Pizza Pepperoni' },
        { productVariantId: nachosId, quantity: '1', nameSnapshot: 'Nachos' },
      ],
    );
    expect(sale.posted).toBe(true);
    // 2 x 180g (pizza) + 1 x 100g (nachos) = 460g = 0.460kg total.
    const expected = (Number(before) - 0.46).toFixed(6);
    expect(await onHand(cheeseId)).toBe(expected);

    const cheeseLines = result<{ quantity: string }>(
      await database.pool.query(
        `select quantity::text from inventory_movement_lines
         where company_id=$1 and inventory_movement_id=$2 and product_variant_id=$3
         order by line_number asc`,
        [companyId, sale.movementId, cheeseId],
      ),
    ).rows;
    // Preserved as two separate, individually traceable lines — never
    // silently merged into one aggregate line (Phase 15).
    expect(cheeseLines).toHaveLength(2);
    expect(cheeseLines.map((line) => line.quantity).sort()).toEqual(['0.100000', '0.360000']);
  });

  it('rejects a second consumption attempt for the same sale (idempotency) without any further stock movement', async () => {
    // Reuses the running `doughId` balance carried over from the earlier
    // tests in this file (an existing `inventory_balances` row already
    // exists for it — a second `openingBalance` insert here would violate
    // that table's own one-row-per-variant-per-location uniqueness).
    const doughBefore = await onHand(doughId);
    const sale = { id: randomUUID(), branchId, saleNumber: 'RECIPE-SALE-IDEMPOTENT' };
    const items = [{ productVariantId: pizzaId, quantity: '1', nameSnapshot: 'Pizza Pepperoni' }];

    const first = await postSaleConsumption(database.pool, context, sale, items);
    expect(first.posted).toBe(true);
    const doughAfterFirst = await onHand(doughId);
    expect(doughAfterFirst).toBe((Number(doughBefore) - 1).toFixed(6));

    // A retried settlement (e.g. a replayed payment confirmation) calling
    // this again for the exact same sale must be rejected by the database
    // itself — `inventory_movements_sale_reference_uq` — never silently
    // double-consume.
    await expect(postSaleConsumption(database.pool, context, sale, items)).rejects.toThrow();
    expect(await onHand(doughId)).toBe(doughAfterFirst);
  });

  it('never partially consumes a recipe: a mid-recipe stock shortfall rolls back every ingredient touched in the same settlement transaction', async () => {
    await database.pool.query(
      `update inventory_balances set quantity_on_hand=$3
       where company_id=$1 and product_variant_id=$2`,
      [companyId, pepperoniId, '0.010'],
    );
    const before = {
      dough: await onHand(doughId),
      cheese: await onHand(cheeseId),
      pepperoni: await onHand(pepperoniId),
      sauce: await onHand(sauceId),
    };

    const client = await database.pool.connect();
    try {
      await client.query('begin');
      await expect(
        postSaleConsumption(
          client,
          context,
          { id: randomUUID(), branchId, saleNumber: 'RECIPE-SALE-SHORTFALL' },
          [{ productVariantId: pizzaId, quantity: '1', nameSnapshot: 'Pizza Pepperoni' }],
        ),
      ).rejects.toThrow(SaleInventoryPostingError);
      await client.query('rollback');
    } finally {
      client.release();
    }

    expect(await onHand(doughId)).toBe(before.dough);
    expect(await onHand(cheeseId)).toBe(before.cheese);
    expect(await onHand(pepperoniId)).toBe(before.pepperoni);
    expect(await onHand(sauceId)).toBe(before.sauce);
  });

  it('leaves a product with no recipe entirely unaffected by this feature (backward compatibility)', async () => {
    await openingBalance(plainId, '20');
    const sale = await postSaleConsumption(
      database.pool,
      context,
      { id: randomUUID(), branchId, saleNumber: 'RECIPE-SALE-PLAIN' },
      [{ productVariantId: plainId, quantity: '3', nameSnapshot: 'Plain Item' }],
    );
    expect(sale.posted).toBe(true);
    expect(await onHand(plainId)).toBe('17.000000');

    const lines = result<{ metadata: unknown }>(
      await database.pool.query(
        `select metadata from inventory_movement_lines
         where company_id=$1 and inventory_movement_id=$2`,
        [companyId, sale.movementId],
      ),
    ).rows;
    expect(lines).toHaveLength(1);
    expect(lines[0]?.metadata).toBeNull();
  });
});
