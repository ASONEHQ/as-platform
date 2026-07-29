import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';

import { InventoryLocationRepository } from './inventory.repository.js';
import { InventoryLocationService } from './inventory.service.js';
import { InventoryTransferRepository } from './inventory-transfers.repository.js';
import { InventoryTransferService } from './inventory-transfers.service.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;

integration('PostgreSQL inventory transfers E108-E114', () => {
  let database: DatabaseClient;
  let transfers: InventoryTransferService;
  let locations: InventoryLocationService;

  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const sourceBranchId = randomUUID();
  const destinationBranchId = randomUUID();
  const otherBranchId = randomUUID();
  const actorId = randomUUID();
  const productId = randomUUID();
  const variantId = randomUUID();
  const context = {
    companyId,
    actorId,
    requestId: 'transfer-request',
    correlationId: 'transfer-correlation',
    timestamp: new Date('2026-07-29T12:00:00.000Z'),
  };
  let sourceLocationId: string;
  let destinationLocationId: string;
  let transitLocationId: string;

  beforeAll(async () => {
    if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({
      connectionString: databaseUrl,
      applicationName: 'asone-transfer-api-integration',
    });
    const schema = await database.pool.query<{ present: string | null }>(
      `select to_regclass('public.inventory_transfers')::text present`,
    );
    if (schema.rows[0]?.present === null)
      throw new Error('Migrations 0000-0006 must be applied before transfer integration tests.');
    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'Transfers','Transfers',$2,'active','UTC','MXN','es-MX'),
             ($3,'Other Transfers','Other Transfers',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `transfers-${companyId}`, otherCompanyId, `transfers-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'Source','SOURCE','active','UTC'),
             ($3,$2,'Destination','DEST','active','UTC'),
             ($4,$5,'Other','OTHER','active','UTC')`,
      [sourceBranchId, companyId, destinationBranchId, otherBranchId, otherCompanyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'Transfer User','active')`,
      [actorId, `transfers-${actorId}@example.test`],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status)
       values($1,$2,$3,'active'),($4,$5,$3,'active')`,
      [randomUUID(), companyId, actorId, randomUUID(), otherCompanyId],
    );
    await database.pool.query(
      `insert into products
       (id,company_id,code,normalized_code,name,product_type,tracks_inventory,status,
        created_by,updated_by)
       values($1,$2,'TRANSFER','transfer','Transfer product','simple',true,'active',$3,$3)`,
      [productId, companyId, actorId],
    );
    await database.pool.query(
      `insert into product_variants
       (id,company_id,product_id,sku,normalized_sku,name,unit_of_measure_code,quantity_scale,
        tracks_inventory,standard_cost,currency_code,is_default,option_signature,status,
        created_by,updated_by)
       values($1,$2,$3,'TRANSFER-SKU','transfer-sku','Transfer variant','unit',0,true,
        12.3400,'MXN',true,$4,'active',$5,$5)`,
      [variantId, companyId, productId, '1'.repeat(64), actorId],
    );
    locations = new InventoryLocationService(new InventoryLocationRepository(database));
    transfers = new InventoryTransferService(new InventoryTransferRepository(database));
    sourceLocationId = (
      await locations.create(context, 'transfer-source', {
        branchId: sourceBranchId,
        code: 'SOURCE',
        name: 'Source',
        locationType: 'main',
      })
    ).value.id;
    destinationLocationId = (
      await locations.create(context, 'transfer-destination', {
        branchId: destinationBranchId,
        code: 'DESTINATION',
        name: 'Destination',
        locationType: 'main',
      })
    ).value.id;
    transitLocationId = (
      await locations.create(context, 'transfer-transit', {
        branchId: destinationBranchId,
        code: 'TRANSIT',
        name: 'Transit',
        locationType: 'transit',
      })
    ).value.id;
    await database.pool.query(
      `insert into inventory_balances
       (id,company_id,branch_id,inventory_location_id,product_variant_id,
        quantity_on_hand,quantity_reserved,quantity_in_transit,average_unit_cost,currency_code)
       values($1,$2,$3,$4,$5,20,2,0,12.3400,'MXN')`,
      [randomUUID(), companyId, sourceBranchId, sourceLocationId, variantId],
    );
  });

  afterAll(async () => {
    await database.pool.query('delete from outbox_events where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from audit_log where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from idempotency_keys where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from inventory_transfer_lines where company_id=$1', [
      companyId,
    ]);
    await database.pool.query('delete from inventory_transfers where company_id=$1', [companyId]);
    await database.pool.query('delete from inventory_movement_lines where company_id=$1', [
      companyId,
    ]);
    await database.pool.query('delete from inventory_balances where company_id=$1', [companyId]);
    await database.pool.query('delete from inventory_movements where company_id=$1', [companyId]);
    await database.pool.query('delete from inventory_locations where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from product_variants where company_id=$1', [companyId]);
    await database.pool.query('delete from products where company_id=$1', [companyId]);
    await database.pool.query('delete from company_memberships where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from branches where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from companies where id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from users where id=$1', [actorId]);
    await database.close();
  });

  const create = (key: string, quantity = '5'): ReturnType<InventoryTransferService['create']> =>
    transfers.create(context, [sourceBranchId, destinationBranchId], key, {
      sourceBranchId,
      destinationBranchId,
      sourceLocationId,
      destinationLocationId,
      transitLocationId,
      lines: [
        {
          productVariantId: variantId,
          quantity,
          unitOfMeasureCode: 'unit',
        },
      ],
    });

  it('creates, lists, reads and replays the complete requested aggregate without stock effects', async () => {
    const before = await balance(sourceLocationId);
    const first = await create('transfer-create');
    const replay = await create('transfer-create');
    expect(first.replayed).toBe(false);
    expect(replay).toEqual({ value: first.value, replayed: true });
    expect(first.value).toMatchObject({ status: 'requested', version: 1 });
    expect(first.value.transfer_number).toMatch(/^ITR-[0-9a-f]{32}$/u);
    expect(await balance(sourceLocationId)).toEqual(before);
    const id = String(first.value.id);
    expect((await transfers.get(companyId, [sourceBranchId], id)).lines).toHaveLength(1);
    expect((await transfers.list(companyId, [destinationBranchId], { limit: 10 })).items).toEqual([
      expect.objectContaining({ id }),
    ]);
    await expect(transfers.get(otherCompanyId, [otherBranchId], id)).rejects.toMatchObject({
      code: 'resource_not_found',
    });
    await expect(create('transfer-create', '6')).rejects.toMatchObject({
      code: 'idempotency_conflict',
    });
  });

  it('approves, ships and receives atomically with exact balances, movements, replay and ETags', async () => {
    const created = await create('transfer-lifecycle', '5');
    const id = String(created.value.id);
    const approved = await transfers.decision(
      context,
      [sourceBranchId, destinationBranchId],
      id,
      1n,
      'transfer-approve',
      { decision: 'approve' },
    );
    expect(approved.value).toMatchObject({ status: 'approved', version: 2 });
    const ship = await transfers.ship(
      context,
      [sourceBranchId, destinationBranchId],
      id,
      2n,
      'transfer-ship',
      {},
    );
    const shipReplay = await transfers.ship(
      context,
      [sourceBranchId, destinationBranchId],
      id,
      2n,
      'transfer-ship',
      {},
    );
    expect(ship.value).toMatchObject({ status: 'shipped', version: 3 });
    expect(shipReplay).toEqual({ value: ship.value, replayed: true });
    expect(await balance(sourceLocationId)).toMatchObject({
      quantity_on_hand: '15.000000',
      quantity_reserved: '2.000000',
      quantity_in_transit: '0.000000',
      average_unit_cost: '12.3400',
      currency_code: 'MXN',
    });
    expect(await balance(transitLocationId)).toMatchObject({
      quantity_on_hand: '0.000000',
      quantity_in_transit: '5.000000',
      average_unit_cost: '0.0000',
      currency_code: null,
    });
    expect(await balance(destinationLocationId)).toBeNull();

    const receipt = await transfers.receive(
      context,
      [destinationBranchId],
      id,
      3n,
      'transfer-receive',
      {},
    );
    expect(receipt.value).toMatchObject({ status: 'received', version: 4 });
    expect(await balance(transitLocationId)).toMatchObject({
      quantity_in_transit: '0.000000',
    });
    expect(await balance(destinationLocationId)).toMatchObject({
      quantity_on_hand: '5.000000',
      average_unit_cost: '0.0000',
      currency_code: null,
    });
    const evidence = await database.pool.query<{
      types: string[];
      transfer_audits: string;
      transfer_events: string;
      movement_events: string;
      cost_lines: string;
    }>(
      `select
       array_agg(movement_type order by occurred_at) types,
       (select count(*)::text from audit_log where company_id=$1 and entity_id=$2) transfer_audits,
       (select count(*)::text from outbox_events where company_id=$1
         and aggregate_id=$2 and event_type like 'inventory.transfer.%') transfer_events,
       (select count(*)::text from outbox_events where company_id=$1
         and payload->>'transfer_id'=$2::text and event_type='inventory.movement.created') movement_events,
       (select count(*)::text from inventory_movement_lines l
         join inventory_movements m on m.company_id=l.company_id and m.id=l.inventory_movement_id
         where l.company_id=$1 and m.reference_id=$2 and
         (l.unit_cost is not null or l.extended_cost is not null or l.currency_code is not null))
         cost_lines
       from inventory_movements where company_id=$1 and reference_id=$2`,
      [companyId, id],
    );
    expect(evidence.rows[0]).toEqual({
      types: ['transfer_shipment', 'transfer_receipt'],
      transfer_audits: '4',
      transfer_events: '4',
      movement_events: '2',
      cost_lines: '0',
    });
  });

  it('rejects or cancels only valid pre-shipment states and serializes decisions', async () => {
    const rejected = await create('transfer-reject');
    const rejectedId = String(rejected.value.id);
    const outcomes = await Promise.allSettled([
      transfers.decision(
        context,
        [sourceBranchId, destinationBranchId],
        rejectedId,
        1n,
        'decision-approve',
        { decision: 'approve' },
      ),
      transfers.decision(
        context,
        [sourceBranchId, destinationBranchId],
        rejectedId,
        1n,
        'decision-reject',
        { decision: 'reject', reasonCode: 'NOT_REQUIRED' },
      ),
    ]);
    expect(outcomes.filter((value) => value.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((value) => value.status === 'rejected')).toHaveLength(1);

    const requested = await create('transfer-cancel-requested');
    const cancelledRequested = await transfers.cancel(
      context,
      [sourceBranchId, destinationBranchId],
      String(requested.value.id),
      1n,
      'cancel-requested',
      { reasonCode: 'ENTRY_ERROR' },
    );
    expect(cancelledRequested.value).toMatchObject({ status: 'cancelled', version: 2 });

    const approved = await create('transfer-cancel-approved');
    const approvedId = String(approved.value.id);
    await transfers.decision(
      context,
      [sourceBranchId, destinationBranchId],
      approvedId,
      1n,
      'approve-cancel',
      { decision: 'approve' },
    );
    const cancelledApproved = await transfers.cancel(
      context,
      [sourceBranchId, destinationBranchId],
      approvedId,
      2n,
      'cancel-approved',
      { reasonCode: 'NO_LONGER_REQUIRED' },
    );
    expect(cancelledApproved.value).toMatchObject({ status: 'cancelled', version: 3 });
  });

  it('protects reserved stock and rolls back every shipment side effect', async () => {
    const created = await create('transfer-insufficient', '14');
    const id = String(created.value.id);
    await transfers.decision(
      context,
      [sourceBranchId, destinationBranchId],
      id,
      1n,
      'approve-insufficient',
      { decision: 'approve' },
    );
    await expect(
      transfers.ship(
        context,
        [sourceBranchId, destinationBranchId],
        id,
        2n,
        'ship-insufficient',
        {},
      ),
    ).rejects.toMatchObject({ code: 'insufficient_inventory' });
    expect(await transfers.get(companyId, [sourceBranchId], id)).toMatchObject({
      status: 'approved',
      version: 2n,
      shipmentMovementId: null,
    });
    const effects = await database.pool.query<{
      movements: string;
      audits: string;
      events: string;
    }>(
      `select
       (select count(*)::text from inventory_movements where company_id=$1
         and reference_id=$2) movements,
       (select count(*)::text from audit_log where company_id=$1 and entity_id=$2
         and action='inventory_transfer.shipped') audits,
       (select count(*)::text from outbox_events where company_id=$1
         and aggregate_id=$2 and event_type='inventory.transfer.shipped') events`,
      [companyId, id],
    );
    expect(effects.rows[0]).toEqual({ movements: '0', audits: '0', events: '0' });
  });

  it('permits one winner for duplicate ship/receive and competing transfers', async () => {
    const duplicate = await create('transfer-duplicate-command', '1');
    const duplicateId = String(duplicate.value.id);
    await transfers.decision(
      context,
      [sourceBranchId, destinationBranchId],
      duplicateId,
      1n,
      'approve-duplicate-command',
      { decision: 'approve' },
    );
    const ships = await Promise.allSettled([
      transfers.ship(
        context,
        [sourceBranchId, destinationBranchId],
        duplicateId,
        2n,
        'ship-duplicate-a',
        {},
      ),
      transfers.ship(
        context,
        [sourceBranchId, destinationBranchId],
        duplicateId,
        2n,
        'ship-duplicate-b',
        {},
      ),
    ]);
    expect(ships.filter((value) => value.status === 'fulfilled')).toHaveLength(1);
    const receipts = await Promise.allSettled([
      transfers.receive(context, [destinationBranchId], duplicateId, 3n, 'receive-duplicate-a', {}),
      transfers.receive(context, [destinationBranchId], duplicateId, 3n, 'receive-duplicate-b', {}),
    ]);
    expect(receipts.filter((value) => value.status === 'fulfilled')).toHaveLength(1);

    const first = await create('transfer-competing-a', '7');
    const second = await create('transfer-competing-b', '7');
    const firstId = String(first.value.id);
    const secondId = String(second.value.id);
    await transfers.decision(
      context,
      [sourceBranchId, destinationBranchId],
      firstId,
      1n,
      'approve-competing-a',
      { decision: 'approve' },
    );
    await transfers.decision(
      context,
      [sourceBranchId, destinationBranchId],
      secondId,
      1n,
      'approve-competing-b',
      { decision: 'approve' },
    );
    const competitors = await Promise.allSettled([
      transfers.ship(
        context,
        [sourceBranchId, destinationBranchId],
        firstId,
        2n,
        'ship-competing-a',
        {},
      ),
      transfers.ship(
        context,
        [sourceBranchId, destinationBranchId],
        secondId,
        2n,
        'ship-competing-b',
        {},
      ),
    ]);
    expect(competitors.filter((value) => value.status === 'fulfilled')).toHaveLength(1);
    expect(competitors.filter((value) => value.status === 'rejected')).toHaveLength(1);
  });

  async function balance(locationId: string): Promise<{
    quantity_on_hand: string;
    quantity_reserved: string;
    quantity_in_transit: string;
    average_unit_cost: string;
    currency_code: string | null;
  } | null> {
    return (
      (
        await database.pool.query<{
          quantity_on_hand: string;
          quantity_reserved: string;
          quantity_in_transit: string;
          average_unit_cost: string;
          currency_code: string | null;
        }>(
          `select quantity_on_hand::text,quantity_reserved::text,quantity_in_transit::text,
           average_unit_cost::text,currency_code from inventory_balances
           where company_id=$1 and inventory_location_id=$2 and product_variant_id=$3`,
          [companyId, locationId, variantId],
        )
      ).rows[0] ?? null
    );
  }
});
