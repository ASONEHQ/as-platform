import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';

import {
  InventoryBalanceReadRepository,
  InventoryLocationRepository,
  InventoryMovementReadRepository,
} from './inventory.repository.js';
import {
  InventoryBalanceReadService,
  InventoryLocationService,
  InventoryMovementReadService,
} from './inventory.service.js';
import { InventoryDraftRepository } from './inventory-drafts.repository.js';
import { InventoryDraftService } from './inventory-drafts.service.js';
import { InventoryPostingRepository } from './inventory-posting.repository.js';
import { InventoryPostingService } from './inventory-posting.service.js';
import { postSaleConsumption } from './sale-consumption.js';
import { postSaleReturn } from './sale-return.js';
import { InventoryTransferRepository } from './inventory-transfers.repository.js';
import { InventoryTransferService } from './inventory-transfers.service.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;

function defined<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

/**
 * TASK 16.7 §14 — the exact commercial end-to-end scenario the task spec
 * demands, proven as a real automated test rather than a manual
 * click-through: one product ("Agua" — a test fixture only, per the spec's
 * own "No hardcodear 'Agua' en producción" instruction, never referenced by
 * any production code path), two real branches with independent balances,
 * chained through every capability this task closes — a real sale
 * (`sale_consumption`), a real return (`return`), a real manual adjustment
 * (draft → submit → post), and a real atomic branch-to-branch transfer
 * (requested → approved → shipped → received) — asserting the exact
 * expected running balance after every step, that every step left a real
 * Kardex trail, and that "reload"/"logout-login" persistence holds (this
 * backend has no client- or session-scoped balance cache anywhere: every
 * read below is a fresh, independent query against the same authoritative
 * `inventory_balances` rows, which is the whole proof).
 */
integration('PostgreSQL inventory end-to-end commercial scenario (TASK 16.7 §14)', () => {
  let database: DatabaseClient;
  let locations: InventoryLocationService;
  let balances: InventoryBalanceReadService;
  let movements: InventoryMovementReadService;
  let drafts: InventoryDraftService;
  let posting: InventoryPostingService;
  let transfers: InventoryTransferService;

  const companyId = randomUUID();
  const branchA = randomUUID();
  const branchB = randomUUID();
  const actorId = randomUUID();
  const productId = randomUUID();
  const variantId = randomUUID();
  const context = {
    companyId,
    actorId,
    requestId: 'e2e-request',
    correlationId: 'e2e-correlation',
    timestamp: new Date('2026-09-01T12:00:00.000Z'),
  };
  let locationA: string;
  let locationB: string;
  let transitB: string;

  beforeAll(async () => {
    if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({
      connectionString: databaseUrl,
      applicationName: 'asone-inventory-e2e-integration',
    });
    const schema = await database.pool.query<{ present: string | null }>(
      `select to_regclass('public.inventory_transfers')::text present`,
    );
    if (schema.rows[0]?.present === null)
      throw new Error('Migrations 0000-0006 must be applied before this end-to-end test.');
    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'E2E Inventory','E2E Inventory',$2,'active','UTC','MXN','es-MX')`,
      [companyId, `inventory-e2e-${companyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$3,'Sucursal A','A','active','UTC'),($2,$3,'Sucursal B','B','active','UTC')`,
      [branchA, branchB, companyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'E2E User','active')`,
      [actorId, `inventory-e2e-${actorId}@example.test`],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status) values($1,$2,$3,'active')`,
      [randomUUID(), companyId, actorId],
    );
    // TASK 16.7 §14: "Agua" is this test's own fixture, never a production
    // seed — the spec's own explicit instruction.
    await database.pool.query(
      `insert into products
       (id,company_id,code,normalized_code,name,product_type,tracks_inventory,status,created_by,updated_by)
       values($1,$2,'AGUA-E2E','agua-e2e','Agua',$3,true,'active',$4,$4)`,
      [productId, companyId, 'simple', actorId],
    );
    await database.pool.query(
      `insert into product_variants
       (id,company_id,product_id,sku,normalized_sku,name,unit_of_measure_code,quantity_scale,
        tracks_inventory,standard_cost,currency_code,is_default,option_signature,status,created_by,updated_by)
       values($1,$2,$3,'AGUA-E2E-1','agua-e2e-1','Agua',$5,0,true,10.0000,'MXN',true,$6,'active',$4,$4)`,
      [variantId, companyId, productId, actorId, 'unit', '3'.repeat(64)],
    );
    locations = new InventoryLocationService(new InventoryLocationRepository(database));
    balances = new InventoryBalanceReadService(new InventoryBalanceReadRepository(database));
    movements = new InventoryMovementReadService(new InventoryMovementReadRepository(database));
    drafts = new InventoryDraftService(new InventoryDraftRepository(database));
    posting = new InventoryPostingService(new InventoryPostingRepository(database));
    transfers = new InventoryTransferService(new InventoryTransferRepository(database));
    locationA = (
      await locations.create(context, 'e2e-location-a', {
        branchId: branchA,
        code: 'A-MAIN',
        name: 'Sucursal A — Principal',
        locationType: 'main',
        isDefault: true,
      })
    ).value.id;
    locationB = (
      await locations.create(context, 'e2e-location-b', {
        branchId: branchB,
        code: 'B-MAIN',
        name: 'Sucursal B — Principal',
        locationType: 'main',
        isDefault: true,
      })
    ).value.id;
    transitB = (
      await locations.create(context, 'e2e-transit-b', {
        branchId: branchB,
        code: 'B-TRANSITO',
        name: 'Sucursal B — Tránsito',
        locationType: 'transit',
      })
    ).value.id;
  });

  afterAll(async () => {
    await database.pool.query('delete from outbox_events where company_id=$1', [companyId]);
    await database.pool.query('delete from audit_log where company_id=$1', [companyId]);
    await database.pool.query('delete from idempotency_keys where company_id=$1', [companyId]);
    await database.pool.query('delete from inventory_transfer_lines where company_id=$1', [companyId]);
    await database.pool.query('delete from inventory_transfers where company_id=$1', [companyId]);
    await database.pool.query('delete from inventory_movement_lines where company_id=$1', [companyId]);
    await database.pool.query('delete from inventory_balances where company_id=$1', [companyId]);
    await database.pool.query('delete from inventory_movements where company_id=$1', [companyId]);
    await database.pool.query('delete from inventory_locations where company_id=$1', [companyId]);
    await database.pool.query('delete from product_variants where company_id=$1', [companyId]);
    await database.pool.query('delete from products where company_id=$1', [companyId]);
    await database.pool.query('delete from company_memberships where company_id=$1', [companyId]);
    await database.pool.query('delete from branches where company_id=$1', [companyId]);
    await database.pool.query('delete from companies where id=$1', [companyId]);
    await database.pool.query('delete from users where id=$1', [actorId]);
    await database.close();
  });

  async function onHand(branchId: string, locationId: string): Promise<string> {
    const page = await balances.list(companyId, [branchId], false, {
      limit: 10,
      locationId,
      productVariantId: variantId,
    });
    return page.items[0]?.quantity_on_hand as string | undefined ?? '0.000000';
  }

  async function openingBalance(branchId: string, locationId: string, quantity: string): Promise<void> {
    const created = await drafts.create(context, [branchId], `e2e-opening-${locationId}`, {
      branchId,
      movementType: 'opening_balance',
      reasonCode: 'SALDO_INICIAL',
    });
    const movementId = String(created.value.id);
    await drafts.addLine(
      context,
      [branchId],
      movementId,
      1n,
      `e2e-opening-line-${locationId}`,
      {
        productVariantId: variantId,
        sourceLocationId: null,
        destinationLocationId: locationId,
        quantity,
        unitOfMeasureCode: 'unit',
      },
      false,
    );
    const submitted = await posting.submit(context, [branchId], movementId, 2n, `e2e-opening-submit-${locationId}`);
    await posting.post(
      context,
      [branchId],
      movementId,
      BigInt(submitted.value.version as number),
      `e2e-opening-post-${locationId}`,
    );
  }

  it('carries Agua through venta, devolución, ajuste and traspaso with exact balances at every step, real Kardex trails, and stable reads', async () => {
    // Initial state: Sucursal A = 20, Sucursal B = 5.
    await openingBalance(branchA, locationA, '20');
    await openingBalance(branchB, locationB, '5');
    expect(await onHand(branchA, locationA)).toBe('20.000000');
    expect(await onHand(branchB, locationB)).toBe('5.000000');

    // Venta de 2 en A -> A = 18.
    const sale = await postSaleConsumption(
      database.pool,
      context,
      { id: randomUUID(), branchId: branchA, saleNumber: 'E2E-SALE-1' },
      [{ productVariantId: variantId, quantity: '2', nameSnapshot: 'Agua' }],
    );
    expect(sale.posted).toBe(true);
    expect(await onHand(branchA, locationA)).toBe('18.000000');

    // Devolución/reintegro de 1 -> A = 19.
    const refund = await postSaleReturn(
      database.pool,
      context,
      { id: randomUUID(), branchId: branchA, refundNumber: 'E2E-REFUND-1' },
      [{ productVariantId: variantId, quantity: '1', nameSnapshot: 'Agua' }],
    );
    expect(refund.posted).toBe(true);
    expect(await onHand(branchA, locationA)).toBe('19.000000');

    // Ajuste -3 con motivo -> A = 16.
    const adjustment = await drafts.create(context, [branchA], 'e2e-adjustment', {
      branchId: branchA,
      movementType: 'adjustment',
      reasonCode: 'MERMA_PRUEBA',
    });
    const adjustmentId = String(adjustment.value.id);
    await drafts.addLine(
      context,
      [branchA],
      adjustmentId,
      1n,
      'e2e-adjustment-line',
      {
        productVariantId: variantId,
        sourceLocationId: locationA,
        destinationLocationId: null,
        quantity: '3',
        unitOfMeasureCode: 'unit',
        reasonCode: 'MERMA_PRUEBA',
      },
      false,
    );
    const adjustmentSubmitted = await posting.submit(context, [branchA], adjustmentId, 2n, 'e2e-adjustment-submit');
    await posting.post(
      context,
      [branchA],
      adjustmentId,
      BigInt(adjustmentSubmitted.value.version as number),
      'e2e-adjustment-post',
    );
    expect(await onHand(branchA, locationA)).toBe('16.000000');

    // Traspaso de 4, A -> B: A = 12, B = 9.
    const transfer = await transfers.create(context, [branchA, branchB], 'e2e-transfer', {
      sourceBranchId: branchA,
      destinationBranchId: branchB,
      sourceLocationId: locationA,
      destinationLocationId: locationB,
      transitLocationId: transitB,
      lines: [{ productVariantId: variantId, quantity: '4', unitOfMeasureCode: 'unit' }],
    });
    const transferId = String(transfer.value.id);
    const approved = await transfers.decision(context, [branchA, branchB], transferId, 1n, 'e2e-transfer-approve', {
      decision: 'approve',
    });
    const shipped = await transfers.ship(
      context,
      [branchA, branchB],
      transferId,
      BigInt(approved.value.version as number),
      'e2e-transfer-ship',
      {},
    );
    await transfers.receive(
      context,
      [branchB],
      transferId,
      BigInt(shipped.value.version as number),
      'e2e-transfer-receive',
      {},
    );
    expect(await onHand(branchA, locationA)).toBe('12.000000');
    expect(await onHand(branchB, locationB)).toBe('9.000000');

    // "Recarga" / "cierre y reapertura de sesión": this backend keeps no
    // client- or session-scoped balance cache anywhere — every read is
    // already a fresh, independent, authoritative query. Re-querying with
    // brand-new service/repository instances (simulating a fresh process,
    // not merely a fresh request) proves the same numbers hold.
    const freshDatabase = createDatabaseClient({
      // `databaseUrl` is narrowed to `string` inside `beforeAll`'s own
      // guard, not here (a sibling `it` closure) — `exactOptionalPropertyTypes`
      // correctly flags the unnarrowed `string | undefined` without this
      // assertion; the module-level `beforeAll` guard already throws
      // before any test body runs if it were ever actually undefined.
      connectionString: databaseUrl!,
      applicationName: 'asone-inventory-e2e-reload',
    });
    try {
      const freshBalances = new InventoryBalanceReadService(new InventoryBalanceReadRepository(freshDatabase));
      const reloadedA = await freshBalances.list(companyId, [branchA], false, {
        limit: 10,
        locationId: locationA,
        productVariantId: variantId,
      });
      const reloadedB = await freshBalances.list(companyId, [branchB], false, {
        limit: 10,
        locationId: locationB,
        productVariantId: variantId,
      });
      expect(reloadedA.items[0]).toMatchObject({ quantity_on_hand: '12.000000' });
      expect(reloadedB.items[0]).toMatchObject({ quantity_on_hand: '9.000000' });
    } finally {
      await freshDatabase.close();
    }

    // Real Kardex traceability: every step above left exactly one real,
    // posted movement, in each branch's own history, with the real domain
    // movement types the model actually uses — never invented labels.
    const branchAMovements = await movements.list(companyId, [branchA], {
      limit: 20,
      branchId: branchA,
      productVariantId: variantId,
    });
    const branchATypes = branchAMovements.items.map((item) => item.movement_type).sort();
    expect(branchATypes).toEqual(
      ['adjustment', 'opening_balance', 'return', 'sale_consumption', 'transfer_shipment'].sort(),
    );
    expect(branchAMovements.items.every((item) => item.status === 'posted')).toBe(true);

    const branchBMovements = await movements.list(companyId, [branchB], {
      limit: 20,
      branchId: branchB,
      productVariantId: variantId,
    });
    const branchBTypes = branchBMovements.items.map((item) => item.movement_type).sort();
    expect(branchBTypes).toEqual(['opening_balance', 'transfer_receipt'].sort());
    expect(branchBMovements.items.every((item) => item.status === 'posted')).toBe(true);
  });
});
