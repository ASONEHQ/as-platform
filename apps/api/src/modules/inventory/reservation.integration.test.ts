import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';

import { InventoryLocationRepository } from './inventory.repository.js';
import { InventoryLocationService } from './inventory.service.js';
import { InventoryReservationRepository } from './reservation.repository.js';
import { InventoryReservationService } from './reservation.service.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;

integration('PostgreSQL inventory reservations E124-E128', () => {
  let database: DatabaseClient;
  let reservations: InventoryReservationService;
  let locations: InventoryLocationService;

  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const branchId = randomUUID();
  const otherBranchId = randomUUID();
  const actorId = randomUUID();
  const productId = randomUUID();
  const variantId = randomUUID();
  const baseContext = {
    companyId,
    actorId,
    requestId: 'reservation-request',
    correlationId: 'reservation-correlation',
    timestamp: new Date('2026-07-31T12:00:00.000Z'),
  };
  let firstLocationId: string;
  let secondLocationId: string;

  beforeAll(async () => {
    if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({
      connectionString: databaseUrl,
      applicationName: 'asone-reservation-api-integration',
    });
    const schema = await database.pool.query<{ present: string | null }>(
      `select to_regclass('public.inventory_reservations')::text present`,
    );
    if (schema.rows[0]?.present === null)
      throw new Error('Migrations 0000-0006 must be applied before reservation integration tests.');
    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'Reservations','Reservations',$2,'active','UTC','MXN','es-MX'),
             ($3,'Other Reservations','Other Reservations',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `reservations-${companyId}`, otherCompanyId, `reservations-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'Reservation Branch','RES','active','UTC'),
             ($3,$4,'Other Branch','OTHER','active','UTC')`,
      [branchId, companyId, otherBranchId, otherCompanyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'Reservation User','active')`,
      [actorId, `reservations-${actorId}@example.test`],
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
       values($1,$2,'RESERVATION','reservation','Reservation product','simple',true,'active',$3,$3)`,
      [productId, companyId, actorId],
    );
    await database.pool.query(
      `insert into product_variants
       (id,company_id,product_id,sku,normalized_sku,name,unit_of_measure_code,quantity_scale,
        tracks_inventory,standard_cost,currency_code,is_default,option_signature,status,
        created_by,updated_by)
       values($1,$2,$3,'RESERVATION-SKU','reservation-sku','Reservation variant','unit',0,true,
        0,'MXN',true,$4,'active',$5,$5)`,
      [variantId, companyId, productId, '2'.repeat(64), actorId],
    );
    locations = new InventoryLocationService(new InventoryLocationRepository(database));
    reservations = new InventoryReservationService(new InventoryReservationRepository(database));
    firstLocationId = (
      await locations.create(baseContext, 'reservation-location-one', {
        branchId,
        code: 'RES-ONE',
        name: 'Reservation One',
        locationType: 'main',
      })
    ).value.id;
    secondLocationId = (
      await locations.create(baseContext, 'reservation-location-two', {
        branchId,
        code: 'RES-TWO',
        name: 'Reservation Two',
        locationType: 'main',
      })
    ).value.id;
    await database.pool.query(
      `insert into inventory_balances
       (id,company_id,branch_id,inventory_location_id,product_variant_id,
        quantity_on_hand,quantity_reserved,quantity_in_transit,average_unit_cost,currency_code)
       values($1,$2,$3,$4,$5,20,0,0,0,'MXN'),($6,$2,$3,$7,$5,10,0,0,0,'MXN')`,
      [
        randomUUID(),
        companyId,
        branchId,
        firstLocationId,
        variantId,
        randomUUID(),
        secondLocationId,
      ],
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
    await database.pool.query('delete from inventory_reservation_lines where company_id=$1', [
      companyId,
    ]);
    await database.pool.query('delete from inventory_reservations where company_id=$1', [
      companyId,
    ]);
    await database.pool.query('delete from inventory_movement_lines where company_id=$1', [
      companyId,
    ]);
    await database.pool.query('delete from inventory_balances where company_id=$1', [companyId]);
    await database.pool.query('delete from inventory_movements where company_id=$1', [companyId]);
    await database.pool.query('delete from inventory_locations where company_id=$1', [companyId]);
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

  const create = (
    key: string,
    quantity = '2',
    expiresAt?: Date,
  ): ReturnType<InventoryReservationService['create']> =>
    reservations.create(baseContext, [branchId], key, {
      branchId,
      ownerType: 'pos_cart',
      ownerId: `cart-${key}`,
      ...(expiresAt === undefined ? {} : { expiresAt }),
      lines: [
        {
          locationId: firstLocationId,
          productVariantId: variantId,
          quantity,
          unitOfMeasureCode: 'unit',
        },
      ],
    });

  it('creates, lists and reads a multi-location reservation with exact replay and tenant isolation', async () => {
    const created = await reservations.create(baseContext, [branchId], 'reservation-create', {
      branchId,
      ownerType: 'order',
      ownerId: 'order-1',
      lines: [
        {
          locationId: firstLocationId,
          productVariantId: variantId,
          quantity: '2',
          unitOfMeasureCode: 'unit',
        },
        {
          locationId: secondLocationId,
          productVariantId: variantId,
          quantity: '3',
          unitOfMeasureCode: 'unit',
        },
      ],
    });
    expect(created.value).toMatchObject({ status: 'active', version: 1, location_count: 2 });
    const replay = await reservations.create(baseContext, [branchId], 'reservation-create', {
      branchId,
      ownerType: 'order',
      ownerId: 'order-1',
      lines: [
        {
          locationId: firstLocationId,
          productVariantId: variantId,
          quantity: '2',
          unitOfMeasureCode: 'unit',
        },
        {
          locationId: secondLocationId,
          productVariantId: variantId,
          quantity: '3',
          unitOfMeasureCode: 'unit',
        },
      ],
    });
    expect(replay.replayed).toBe(true);
    const id = String(created.value.id);
    expect(
      (await reservations.list(companyId, [branchId], { limit: 10, ownerType: 'order' })).items,
    ).toHaveLength(1);
    await expect(reservations.get(otherCompanyId, [otherBranchId], id)).rejects.toMatchObject({
      code: 'resource_not_found',
    });
    expect(await balance(firstLocationId)).toMatchObject({
      quantity_on_hand: '20.000000',
      quantity_reserved: '2.000000',
    });
    expect(await balance(secondLocationId)).toMatchObject({
      quantity_on_hand: '10.000000',
      quantity_reserved: '3.000000',
    });
  });

  it('confirms completely with one issue movement, atomic balances, audit and outbox', async () => {
    const created = await create('reservation-confirm', '4');
    const id = String(created.value.id);
    const confirmed = await reservations.confirm(
      baseContext,
      [branchId],
      id,
      1n,
      'reservation-confirm-command',
    );
    expect(confirmed.value).toMatchObject({ status: 'confirmed', version: 2 });
    await expect(
      reservations.confirm(baseContext, [branchId], id, 2n, 'reservation-double-confirm'),
    ).rejects.toMatchObject({
      code: 'reservation_already_completed',
    });
    const evidence = await database.pool.query<{
      movements: string;
      audits: string;
      reservation_events: string;
      movement_events: string;
    }>(
      `select
       (select count(*)::text from inventory_movements where company_id=$1 and reference_id=$2
         and movement_type='issue' and status='posted') movements,
       (select count(*)::text from audit_log where company_id=$1 and entity_id=$2) audits,
       (select count(*)::text from outbox_events where company_id=$1 and aggregate_id=$2
         and event_type like 'inventory.reservation.%') reservation_events,
       (select count(*)::text from outbox_events where company_id=$1 and payload->>'reservation_id'=$2::text
         and event_type='inventory.movement.created') movement_events`,
      [companyId, id],
    );
    expect(evidence.rows[0]).toEqual({
      movements: '1',
      audits: '2',
      reservation_events: '2',
      movement_events: '1',
    });
  });

  it('releases, cancels and atomically expires without an on-hand movement', async () => {
    for (const action of ['release', 'cancel'] as const) {
      const created = await create(`reservation-${action}`);
      const transitioned = await reservations.release(
        baseContext,
        [branchId],
        String(created.value.id),
        1n,
        `reservation-${action}-command`,
        { action, reasonCode: 'OWNER_COMMAND' },
      );
      expect(transitioned.value).toMatchObject({
        status: action === 'release' ? 'released' : 'cancelled',
        version: 2,
      });
    }
    const created = await create('reservation-expiring', '1', new Date('2026-07-31T12:01:00.000Z'));
    const expiredContext = { ...baseContext, timestamp: new Date('2026-07-31T12:02:00.000Z') };
    await expect(
      reservations.confirm(
        expiredContext,
        [branchId],
        String(created.value.id),
        1n,
        'expired-confirm',
      ),
    ).rejects.toMatchObject({ code: 'reservation_expired' });
    expect(await reservations.get(companyId, [branchId], String(created.value.id))).toMatchObject({
      status: 'expired',
      version: 2n,
    });
  });

  it('serializes competing reservations for the last available units', async () => {
    const current = await balance(firstLocationId);
    const available =
      Number(current?.quantity_on_hand ?? 0) - Number(current?.quantity_reserved ?? 0);
    const amount = String(Math.max(1, Math.floor(available / 2) + 1));
    const outcomes = await Promise.allSettled([
      create('reservation-race-a', amount),
      create('reservation-race-b', amount),
    ]);
    expect(outcomes.filter((value) => value.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((value) => value.status === 'rejected')).toHaveLength(1);
  });

  it('rolls back idempotency, audit and outbox when creation cannot reserve stock', async () => {
    const before = await database.pool.query<{
      idempotency: string;
      audits: string;
      events: string;
    }>(
      `select
       (select count(*)::text from idempotency_keys where company_id=$1
         and key='reservation-rollback') idempotency,
       (select count(*)::text from audit_log where company_id=$1
         and metadata->>'owner_id'='cart-reservation-rollback') audits,
       (select count(*)::text from outbox_events where company_id=$1
         and payload->>'owner_id'='cart-reservation-rollback') events`,
      [companyId],
    );
    await expect(create('reservation-rollback', '999999')).rejects.toMatchObject({
      code: 'insufficient_inventory',
    });
    const after = await database.pool.query<{
      idempotency: string;
      audits: string;
      events: string;
    }>(
      `select
       (select count(*)::text from idempotency_keys where company_id=$1
         and key='reservation-rollback') idempotency,
       (select count(*)::text from audit_log where company_id=$1
         and metadata->>'owner_id'='cart-reservation-rollback') audits,
       (select count(*)::text from outbox_events where company_id=$1
         and payload->>'owner_id'='cart-reservation-rollback') events`,
      [companyId],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  async function balance(locationId: string): Promise<{
    quantity_on_hand: string;
    quantity_reserved: string;
  } | null> {
    return (
      (
        await database.pool.query<{ quantity_on_hand: string; quantity_reserved: string }>(
          `select quantity_on_hand::text,quantity_reserved::text from inventory_balances
           where company_id=$1 and inventory_location_id=$2 and product_variant_id=$3`,
          [companyId, locationId, variantId],
        )
      ).rows[0] ?? null
    );
  }
});
