import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';
import { AppError } from '@asone/errors';

import type { AuthContext } from '../auth/auth.types.js';
import type { AuthService } from '../auth/auth.service.js';
import { CashRepository } from '../cash/cash.repository.js';
import { CashService } from '../cash/cash.service.js';
import { CustomersRepository } from '../customers/customers.repository.js';
import { CustomersService } from '../customers/customers.service.js';
import { PartiesRepository } from './parties.repository.js';
import { PartyError, type PartyMutationContext } from './parties.types.js';
import { PartyRoomsService } from './party-rooms.service.js';
import { PartyPackagesService, packageQuoteInput } from './party-packages.service.js';
import { PartyReservationsService } from './party-reservations.service.js';
import { registerPartyRoomRoutes } from './party-rooms.routes.js';
import { registerPartyPackageRoutes } from './party-packages.routes.js';
import { registerPartyReservationRoutes } from './party-reservations.routes.js';

/** TASK 14.3 (Wave 1, Part A) — the real "Fiestas" backend domain.
 * Reconciled against `docs/LEGACY_FIESTAS_RECOVERY.md` and
 * `packages/database/src/schema/parties.ts` (already migrated — this
 * suite never re-runs or modifies migrations). */
const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;

function context(
  companyId: string,
  actorId: string,
  timestamp = new Date('2026-09-07T10:00:00.000Z'),
): PartyMutationContext {
  return {
    companyId,
    actorId,
    requestId: `req-${randomUUID()}`,
    correlationId: `corr-${randomUUID()}`,
    timestamp,
    deviceId: undefined,
  };
}

integration('PostgreSQL party reservations domain (TASK 14.3 Wave 1 Part A)', { concurrent: false }, () => {
  let database: DatabaseClient;
  let partiesRepository: PartiesRepository;
  let rooms: PartyRoomsService;
  let packages: PartyPackagesService;
  let reservations: PartyReservationsService;
  let cash: CashService;
  let cashRepository: CashRepository;
  let customers: CustomersService;

  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const branchId = randomUUID();
  const otherBranchId = randomUUID();
  const otherCompanyBranchId = randomUUID();
  const userId = randomUUID();
  const otherCompanyUserId = randomUUID();

  let customerId: string;
  let roomA: string; // branchId
  let roomB: string; // branchId
  let roomOtherCompany: string; // otherCompanyBranchId
  let packageId: string;
  let trackedVariantId: string;
  let inventoryLocationId: string;
  let snackProductId: string;

  const branchIds = [branchId, otherBranchId];

  beforeAll(async () => {
    if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({ connectionString: databaseUrl, applicationName: 'asone-parties-integration' });

    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'Parties Co','Parties Co',$2,'active','UTC','MXN','es-MX'),
             ($3,'Other Parties Co','Other Parties Co',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `parties-${companyId}`, otherCompanyId, `parties-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'Parties Main','PMAIN','active','UTC'),
             ($3,$2,'Parties Second','PSECOND','active','UTC'),
             ($4,$5,'Parties Other Co','POTHER','active','UTC')`,
      [branchId, companyId, otherBranchId, otherCompanyBranchId, otherCompanyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'Parties Actor','active'),($3,$4,$4,'Parties Other Co User','active')`,
      [userId, `parties-${userId}@example.test`, otherCompanyUserId, `parties-${otherCompanyUserId}@example.test`],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status)
       values($1,$2,$3,'active'),($4,$5,$6,'active')`,
      [randomUUID(), companyId, userId, randomUUID(), otherCompanyId, otherCompanyUserId],
    );

    // Real inventory fixtures for the socks stock-deduction test.
    const productId = randomUUID();
    snackProductId = randomUUID();
    await database.pool.query(
      `insert into products
       (id,company_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
       values($1,$2,'PARTY-SOCK','party-sock','Party Sock','simple',true,'IVA_EXEMPT','active',$3,$3),
             ($4,$2,'PARTY-SNACK','party-snack','Party Snack','simple',false,'IVA_EXEMPT','active',$3,$3)`,
      [productId, companyId, userId, snackProductId],
    );
    await database.pool.query(
      `insert into product_prices (id,company_id,product_id,amount,currency_code,status,created_by,updated_by)
       values($1,$2,$3,'25.0000','MXN','active',$4,$4)`,
      [randomUUID(), companyId, snackProductId, userId],
    );
    trackedVariantId = randomUUID();
    await database.pool.query(
      `insert into product_variants
       (id,company_id,product_id,sku,normalized_sku,name,unit_of_measure_code,quantity_scale,tracks_inventory,standard_cost,currency_code,is_default,option_signature,status,created_by,updated_by)
       values($1,$2,$3,'PARTY-SOCK-M','party-sock-m','Sock M','unit',0,true,10,'MXN',true,$4,'active',$5,$5)`,
      [trackedVariantId, companyId, productId, '3'.repeat(64), userId],
    );
    inventoryLocationId = randomUUID();
    await database.pool.query(
      `insert into inventory_locations (id,company_id,branch_id,code,normalized_code,name,location_type,status,allows_receiving,allows_issuing,is_default,created_by,updated_by)
       values($1,$2,$3,'MAIN','main','Main','main','active',true,true,true,$4,$4)`,
      [inventoryLocationId, companyId, branchId, userId],
    );
    await database.pool.query(
      `insert into inventory_balances (id,company_id,branch_id,inventory_location_id,product_variant_id,quantity_on_hand,quantity_reserved,quantity_in_transit,average_unit_cost,version)
       values($1,$2,$3,$4,$5,'50',0,0,0,1)`,
      [randomUUID(), companyId, branchId, inventoryLocationId, trackedVariantId],
    );

    partiesRepository = new PartiesRepository(database);
    rooms = new PartyRoomsService(partiesRepository);
    packages = new PartyPackagesService(partiesRepository);
    cashRepository = new CashRepository(database);
    cash = new CashService(cashRepository);
    reservations = new PartyReservationsService(partiesRepository, cashRepository);
    customers = new CustomersService(new CustomersRepository(database));

    // --- Fixtures used across many tests below ---
    const roomAResult = await rooms.createRoom(context(companyId, userId), branchIds, `room-a-${randomUUID()}`, {
      branchId,
      code: 'SALON-A',
      name: 'Salon A',
      capacityChildren: 20,
      capacityAdults: 10,
    });
    roomA = roomAResult.value.id;
    const roomBResult = await rooms.createRoom(context(companyId, userId), branchIds, `room-b-${randomUUID()}`, {
      branchId,
      code: 'SALON-B',
      name: 'Salon B',
    });
    roomB = roomBResult.value.id;
    const roomOtherResult = await rooms.createRoom(
      context(otherCompanyId, otherCompanyUserId),
      [otherCompanyBranchId],
      `room-other-${randomUUID()}`,
      { branchId: otherCompanyBranchId, code: 'SALON-A', name: 'Other Co Salon A' },
    );
    roomOtherCompany = roomOtherResult.value.id;

    const packageResult = await packages.createPackage(context(companyId, userId), branchIds, `pkg-${randomUUID()}`, {
      branchId,
      code: 'BASIC',
      name: 'Basic Package',
      price: '3500.0000',
      durationMinutes: 120,
      childrenIncluded: 10,
      adultsIncluded: 5,
      childExtraCost: '80.0000',
      adultExtraCost: '50.0000',
      extraHalfHourCost: '250.0000',
    });
    packageId = packageResult.value.id;

    const created = await customers.createCustomer(
      { companyId, actorId: userId, actorPermissions: ['customer.create'], requestId: 'r', correlationId: 'c', timestamp: new Date() },
      `cust-${randomUUID()}`,
      { firstName: 'Ana', lastName: 'Reyes', phone: '5551234567' },
    );
    customerId = created.value.id;
  });

  afterAll(async () => {
    await database.pool.query('delete from party_reservation_documents where company_id=any($1)', [[companyId, otherCompanyId]]);
    await database.pool.query('delete from party_reservation_payments where company_id=any($1)', [[companyId, otherCompanyId]]);
    await database.pool.query('delete from party_reservation_socks where company_id=any($1)', [[companyId, otherCompanyId]]);
    await database.pool.query('delete from party_reservation_snacks where company_id=any($1)', [[companyId, otherCompanyId]]);
    await database.pool.query('delete from party_reservation_coupon_redemptions where company_id=any($1)', [[companyId, otherCompanyId]]);
    await database.pool.query('delete from party_reservations where company_id=any($1)', [[companyId, otherCompanyId]]);
    await database.pool.query('delete from coupons where company_id=any($1)', [[companyId, otherCompanyId]]);
    await database.pool.query('delete from party_packages where company_id=any($1)', [[companyId, otherCompanyId]]);
    await database.pool.query('delete from party_rooms where company_id=any($1)', [[companyId, otherCompanyId]]);
    await database.pool.query('delete from cash_movements where company_id=any($1)', [[companyId, otherCompanyId]]);
    await database.pool.query('delete from cash_sessions where company_id=any($1)', [[companyId, otherCompanyId]]);
    await database.pool.query('delete from cash_registers where company_id=any($1)', [[companyId, otherCompanyId]]);
    await database.pool.query('delete from customers where company_id=any($1)', [[companyId, otherCompanyId]]);
    await database.pool.query('delete from inventory_balances where company_id=any($1)', [[companyId, otherCompanyId]]);
    await database.pool.query('delete from inventory_movement_lines where company_id=any($1)', [[companyId, otherCompanyId]]);
    await database.pool.query('delete from inventory_movements where company_id=any($1)', [[companyId, otherCompanyId]]);
    await database.pool.query('delete from inventory_locations where company_id=any($1)', [[companyId, otherCompanyId]]);
    await database.pool.query('delete from product_variants where company_id=any($1)', [[companyId, otherCompanyId]]);
    await database.pool.query('delete from product_prices where company_id=any($1)', [[companyId, otherCompanyId]]);
    await database.pool.query('delete from products where company_id=any($1)', [[companyId, otherCompanyId]]);
    await database.pool.query('delete from idempotency_keys where company_id=any($1)', [[companyId, otherCompanyId]]);
    await database.pool.query('delete from outbox_events where company_id=any($1)', [[companyId, otherCompanyId]]);
    await database.pool.query('delete from audit_log where company_id=any($1)', [[companyId, otherCompanyId]]);
    await database.pool.query('delete from company_memberships where company_id=any($1)', [[companyId, otherCompanyId]]);
    await database.pool.query('delete from branches where company_id=any($1)', [[companyId, otherCompanyId]]);
    await database.pool.query('delete from companies where id=any($1)', [[companyId, otherCompanyId]]);
    await database.pool.query('delete from users where id=any($1)', [[userId, otherCompanyUserId]]);
    await database.close();
  });

  it('creates a room, a package, and a customer (fixtures set up in beforeAll)', () => {
    expect(roomA).toBeTruthy();
    expect(roomB).toBeTruthy();
    expect(packageId).toBeTruthy();
    expect(customerId).toBeTruthy();
  });

  it('creates a reservation (happy path), freezing the customer display name/phone snapshot and computing quotedTotal server-side', async () => {
    const created = await reservations.createReservation(context(companyId, userId), branchIds, `res-happy-${randomUUID()}`, {
      branchId,
      customerId,
      celebrantName: 'Sofia',
      celebrantAge: 7,
      roomId: roomA,
      packageId,
      eventDate: '2026-10-10',
      startTime: '10:00',
      endTime: '12:00',
      childrenCount: 12, // 2 over the 10 included -> 2*80 = 160 extra
    });
    expect(created.value.reservationNumber).toMatch(/^PARTY-/);
    expect(created.value.status).toBe('held');
    expect(created.value.customerDisplayName).toBe('Ana Reyes');
    expect(created.value.customerPhone).toBe('5551234567');
    // base 3500 + childrenExtra (2*80=160) + adultsExtra(0) + timeExtra(0) =
    // subtotal 3660; TASK 16.19 adds tax on top — the package defaults to
    // IVA_GENERAL (16%): 3660 * 1.16 = 4245.60.
    expect(created.value.subtotalAmount).toBe('3660.0000');
    expect(created.value.taxTotal).toBe('585.6000');
    expect(created.value.quotedTotal).toBe('4245.6000');

    // Restart-persistence honesty check: read back via a FRESH query, not
    // any in-process cache — a genuinely new repository instance over the
    // SAME real Postgres connection pool.
    const freshRepository = new PartiesRepository(database);
    const reread = await freshRepository.reservation(companyId, created.value.id);
    expect(reread?.quotedTotal).toBe('4245.6000');
  });

  it('edits a reservation (children_count change recomputes quotedTotal; notes/celebrant update)', async () => {
    const created = await reservations.createReservation(context(companyId, userId), branchIds, `res-edit-${randomUUID()}`, {
      branchId,
      roomId: roomB,
      packageId,
      eventDate: '2026-10-11',
      startTime: '09:00',
      endTime: '11:00',
      childrenCount: 5,
    });
    // subtotal 3500 (within included counts), tax 16% = 560.00.
    expect(created.value.quotedTotal).toBe('4060.0000');

    const updated = await reservations.updateReservation(context(companyId, userId), branchIds, created.value.id, created.value.version, {
      childrenCount: 15, // 5 over included -> 5*80=400 extra
      notes: 'Bring extra chairs',
    });
    expect(updated.childrenCount).toBe(15);
    expect(updated.notes).toBe('Bring extra chairs');
    // subtotal 3900 (3500 + 400 extra), tax 16% = 624.00.
    expect(updated.subtotalAmount).toBe('3900.0000');
    expect(updated.quotedTotal).toBe('4524.0000');
    expect(updated.version).toBe(created.value.version + 1n);
  });

  it('rejects an overlapping room booking with a clean party_conflict error, never a raw Postgres exception', async () => {
    const first = await reservations.createReservation(context(companyId, userId), branchIds, `res-conflict-a-${randomUUID()}`, {
      branchId,
      roomId: roomA,
      packageId,
      eventDate: '2026-11-01',
      startTime: '10:00',
      endTime: '12:00',
    });
    expect(first.value.id).toBeTruthy();

    await expect(
      reservations.createReservation(context(companyId, userId), branchIds, `res-conflict-b-${randomUUID()}`, {
        branchId,
        roomId: roomA,
        packageId,
        eventDate: '2026-11-01',
        startTime: '11:00',
        endTime: '13:00',
      }),
    ).rejects.toMatchObject({ code: 'party_conflict' });
  });

  it('accepts an adjacent, non-overlapping booking on the same room (half-open interval, no false conflict)', async () => {
    const a = await reservations.createReservation(context(companyId, userId), branchIds, `res-adj-a-${randomUUID()}`, {
      branchId,
      roomId: roomA,
      packageId,
      eventDate: '2026-11-02',
      startTime: '10:00',
      endTime: '12:00',
    });
    const b = await reservations.createReservation(context(companyId, userId), branchIds, `res-adj-b-${randomUUID()}`, {
      branchId,
      roomId: roomA,
      packageId,
      eventDate: '2026-11-02',
      startTime: '12:00',
      endTime: '14:00',
    });
    expect(a.value.id).not.toBe(b.value.id);
  });

  it('accepts two bookings at the same time in different rooms', async () => {
    const a = await reservations.createReservation(context(companyId, userId), branchIds, `res-diffroom-a-${randomUUID()}`, {
      branchId,
      roomId: roomA,
      packageId,
      eventDate: '2026-11-03',
      startTime: '15:00',
      endTime: '17:00',
    });
    const b = await reservations.createReservation(context(companyId, userId), branchIds, `res-diffroom-b-${randomUUID()}`, {
      branchId,
      roomId: roomB,
      packageId,
      eventDate: '2026-11-03',
      startTime: '15:00',
      endTime: '17:00',
    });
    expect(a.value.id).not.toBe(b.value.id);
  });

  it('accepts the same time/date under a different company (proves the exclusion constraint is scoped by company_id)', async () => {
    const otherPackage = await packages.createPackage(
      context(otherCompanyId, otherCompanyUserId),
      [otherCompanyBranchId],
      `pkg-other-${randomUUID()}`,
      { branchId: otherCompanyBranchId, code: 'BASIC', name: 'Other Co Basic', price: '1000.0000', durationMinutes: 60 },
    );
    const a = await reservations.createReservation(context(companyId, userId), branchIds, `res-tenant-a-${randomUUID()}`, {
      branchId,
      roomId: roomA,
      packageId,
      eventDate: '2026-11-04',
      startTime: '09:00',
      endTime: '10:00',
    });
    const b = await reservations.createReservation(
      context(otherCompanyId, otherCompanyUserId),
      [otherCompanyBranchId],
      `res-tenant-b-${randomUUID()}`,
      {
        branchId: otherCompanyBranchId,
        roomId: roomOtherCompany,
        packageId: otherPackage.value.id,
        eventDate: '2026-11-04',
        startTime: '09:00',
        endTime: '10:00',
      },
    );
    expect(a.value.id).not.toBe(b.value.id);
  });

  it('rejects a reservation whose room does not belong to the given branch', async () => {
    await expect(
      reservations.createReservation(context(companyId, userId), branchIds, `res-branch-mismatch-${randomUUID()}`, {
        branchId: otherBranchId, // roomA belongs to `branchId`, not `otherBranchId`
        roomId: roomA,
        packageId,
        eventDate: '2026-11-05',
        startTime: '09:00',
        endTime: '10:00',
      }),
    ).rejects.toMatchObject({ code: 'resource_not_found' });
  });

  it('enforces tenant isolation: company A cannot read company B rooms/packages/reservations', async () => {
    await expect(rooms.room(otherCompanyId, [otherCompanyBranchId], roomA)).rejects.toBeInstanceOf(PartyError);
    await expect(packages.packageRow(otherCompanyId, [otherCompanyBranchId], packageId)).rejects.toBeInstanceOf(PartyError);
    const created = await reservations.createReservation(context(companyId, userId), branchIds, `res-isolation-${randomUUID()}`, {
      branchId,
      roomId: roomA,
      packageId,
      eventDate: '2026-11-06',
      startTime: '09:00',
      endTime: '10:00',
    });
    await expect(reservations.reservation(otherCompanyId, [otherCompanyBranchId], created.value.id)).rejects.toBeInstanceOf(PartyError);
  });

  it('computes exact, deterministic quote math via the package quote endpoint helper', async () => {
    const pkg = await packages.packageRow(companyId, branchIds, packageId);
    const breakdown = packageQuoteInput(pkg, { children: 15, adults: 8, extraHalfHours: 2 });
    // 15 children (10 included -> 5 extra @80 = 400), 8 adults (5 included -> 3 extra @50=150), 2 extra half hours @250=500
    // TASK 16.19: subtotal 4550, tax 16% = 728.00, total 5278.00.
    expect(breakdown).toEqual({
      base: '3500.0000',
      childrenExtra: '400.0000',
      adultsExtra: '150.0000',
      timeExtra: '500.0000',
      subtotal: '4550.0000',
      discountTotal: '0.0000',
      taxTotal: '728.0000',
      total: '5278.0000',
    });
  });

  describe('deposits, balance, cancellation, socks, snacks, documents', () => {
    let reservationId: string;
    let reservationVersion: bigint;
    let cashSessionId: string;

    beforeAll(async () => {
      const registerResult = await cash.createRegister(context(companyId, userId), branchIds, `reg-${randomUUID()}`, {
        branchId,
        code: `PARTY-REG-${randomUUID().slice(0, 8)}`,
        name: 'Party Register',
      });
      const sessionResult = await cash.openSession(context(companyId, userId), branchIds, `sess-${randomUUID()}`, {
        cashRegisterId: registerResult.value.id,
        openingAmount: '0',
      });
      cashSessionId = sessionResult.value.id;

      const created = await reservations.createReservation(context(companyId, userId), branchIds, `res-full-${randomUUID()}`, {
        branchId,
        customerId,
        celebrantName: 'Mateo',
        celebrantAge: 8,
        roomId: roomA,
        packageId,
        eventDate: '2026-12-01',
        startTime: '10:00',
        endTime: '12:00',
        childrenCount: 10,
      });
      reservationId = created.value.id;
      reservationVersion = created.value.version;
    });

    it('records a deposit, verifies the balance reflects it, then records a second payment and verifies cumulative totals', async () => {
      // childrenCount:10 is exactly the included count -> subtotal 3500,
      // tax 16% = 560.00, quotedTotal (grand total) 4060.00 (TASK 16.19).
      const before = await reservations.balance(companyId, branchIds, reservationId);
      expect(before.quotedTotal).toBe('4060.0000');
      expect(before.totalPaid).toBe('0.0000');
      expect(before.outstandingBalance).toBe('4060.0000');

      const deposit = await reservations.recordPayment(context(companyId, userId), branchIds, `pay-deposit-${randomUUID()}`, reservationId, {
        purpose: 'deposit',
        amount: '1000.0000',
        cashSessionId,
      });
      expect(deposit.value.purpose).toBe('deposit');
      expect(deposit.value.amountSnapshot).toBe('1000.0000');

      const afterDeposit = await reservations.balance(companyId, branchIds, reservationId);
      expect(afterDeposit.totalPaid).toBe('1000.0000');
      expect(afterDeposit.outstandingBalance).toBe('3060.0000');

      const balancePayment = await reservations.recordPayment(context(companyId, userId), branchIds, `pay-balance-${randomUUID()}`, reservationId, {
        purpose: 'balance',
        amount: '3060.0000',
        cashSessionId,
      });
      expect(balancePayment.value.amountSnapshot).toBe('3060.0000');

      const finalBalance = await reservations.balance(companyId, branchIds, reservationId);
      expect(finalBalance.totalPaid).toBe('4060.0000');
      expect(finalBalance.outstandingBalance).toBe('0.0000');

      // Verify the real cash movement was actually posted, thin-linked
      // correctly — never a second, invented ledger.
      const movements = await cashRepository.listMovements(companyId, cashSessionId, { limit: 50 });
      const partyMovements = movements.items.filter((m) => m.referenceType === 'party_reservation' && m.referenceId === reservationId);
      expect(partyMovements).toHaveLength(2);
      expect(partyMovements.map((m) => m.reasonCode).sort()).toEqual(['party_balance', 'party_deposit']);
    });

    it('adds a catalog-linked snack and a custom one-off snack', async () => {
      const catalogSnack = await reservations.addSnack(context(companyId, userId), branchIds, reservationId, {
        productId: snackProductId,
        quantity: '3',
      });
      expect(catalogSnack.nameSnapshot).toBe('Party Snack');
      expect(catalogSnack.unitPriceSnapshot).toBe('25.0000');
      expect(catalogSnack.lineTotal).toBe('75.0000');

      const customSnack = await reservations.addSnack(context(companyId, userId), branchIds, reservationId, {
        nameSnapshot: 'Custom Piñata Candy',
        unitPriceSnapshot: '12.5000',
        quantity: '2',
      });
      expect(customSnack.productId).toBeNull();
      // TASK 16.19: a custom, catalog-less snack is taxed at the
      // reservation's own package tax code (IVA_GENERAL, 16%, since this
      // package fixture doesn't set one) — 12.50*2=25.00 subtotal, +16% tax
      // = 29.00 tax-inclusive line total.
      expect(customSnack.taxTotal).toBe('4.0000');
      expect(customSnack.lineTotal).toBe('29.0000');

      const list = await reservations.listSnacks(companyId, branchIds, reservationId);
      expect(list).toHaveLength(2);
    });

    it('adds a sock line and performs a real, guarded, one-way stock deduction', async () => {
      const sock = await reservations.addSock(context(companyId, userId), branchIds, reservationId, {
        size: 'M',
        quantity: 4,
        productVariantId: trackedVariantId,
      });
      expect(sock.stockDeducted).toBe('pending');

      const before = await database.pool.query<{ quantity_on_hand: string }>(
        `select quantity_on_hand::text from inventory_balances where company_id=$1 and product_variant_id=$2`,
        [companyId, trackedVariantId],
      );
      expect(before.rows[0]?.quantity_on_hand).toBe('50.000000');

      const deducted = await reservations.deductSock(context(companyId, userId), branchIds, reservationId, sock.id);
      expect(deducted.stockDeducted).toBe('deducted');
      expect(deducted.stockDeductedAt).not.toBeNull();

      const after = await database.pool.query<{ quantity_on_hand: string }>(
        `select quantity_on_hand::text from inventory_balances where company_id=$1 and product_variant_id=$2`,
        [companyId, trackedVariantId],
      );
      expect(after.rows[0]?.quantity_on_hand).toBe('46.000000');

      // Guard against double-deduction — real, server-side, idempotent.
      await expect(reservations.deductSock(context(companyId, userId), branchIds, reservationId, sock.id)).rejects.toMatchObject({
        code: 'resource_conflict',
      });

      // Stock unchanged by the rejected second attempt.
      const stillAfter = await database.pool.query<{ quantity_on_hand: string }>(
        `select quantity_on_hand::text from inventory_balances where company_id=$1 and product_variant_id=$2`,
        [companyId, trackedVariantId],
      );
      expect(stillAfter.rows[0]?.quantity_on_hand).toBe('46.000000');
    });

    it('generates a real waiver/contract HTML document with real reservation data, and audits the generation', async () => {
      const contract = await reservations.generateDocument(context(companyId, userId), branchIds, reservationId, 'contract');
      expect(contract.html).toContain('Mateo');
      expect(contract.html).toContain('2026-12-01');
      expect(contract.html).toContain('3500.0000');
      expect(contract.html).toContain('Contrato');
      expect(contract.document.documentType).toBe('contract');

      const waiver = await reservations.generateDocument(context(companyId, userId), branchIds, reservationId, 'waiver');
      expect(waiver.html).toContain('Mateo');
      expect(waiver.html).toContain('Deslinde');

      const auditRows = await database.pool.query<{ count: string }>(
        `select count(*)::text as count from party_reservation_documents where company_id=$1 and reservation_id=$2`,
        [companyId, reservationId],
      );
      expect(auditRows.rows[0]?.count).toBe('2');

      const detail = await reservations.reservationDetail(companyId, branchIds, reservationId);
      expect(detail.documentsSummary.count).toBe(2);
    });

    it('cancels with existing payment history: surfaces hasPriorPayments/totalPaid honestly, auto-creates NO refund/cash-out, and preserves prior payment rows', async () => {
      const paymentsBefore = await partiesRepository.paymentsForReservation(companyId, reservationId);
      expect(paymentsBefore).toHaveLength(2);
      const movementsBefore = await cashRepository.listMovements(companyId, cashSessionId, { limit: 50 });
      const cashOutBefore = movementsBefore.items.filter((m) => m.movementType === 'cash_out');
      expect(cashOutBefore).toHaveLength(0);

      const result = await reservations.cancelReservation(context(companyId, userId), branchIds, `cancel-${randomUUID()}`, reservationId, reservationVersion, {
        reasonCode: 'customer_request',
      });
      expect(result.value.reservation.status).toBe('cancelled');
      expect(result.value.hasPriorPayments).toBe(true);
      expect(result.value.totalPaid).toBe('4060.0000');
      expect(result.value.reservation.cancellationReason).toBe('customer_request');
      expect(result.value.reservation.cancelledBy).toBe(userId);
      expect(result.value.reservation.cancelledAt).not.toBeNull();

      // No refund/cash-out was auto-created.
      const movementsAfter = await cashRepository.listMovements(companyId, cashSessionId, { limit: 50 });
      const cashOutAfter = movementsAfter.items.filter((m) => m.movementType === 'cash_out');
      expect(cashOutAfter).toHaveLength(0);
      expect(movementsAfter.items).toHaveLength(movementsBefore.items.length);

      // The reservation's own prior payment rows are untouched — financial
      // history preserved, never deleted/modified by a cancellation.
      const paymentsAfter = await partiesRepository.paymentsForReservation(companyId, reservationId);
      expect(paymentsAfter).toHaveLength(2);
      expect(paymentsAfter.map((p) => p.amountSnapshot).sort()).toEqual(paymentsBefore.map((p) => p.amountSnapshot).sort());

      // A cancelled reservation cannot be edited/cancelled again.
      await expect(
        reservations.updateReservation(context(companyId, userId), branchIds, reservationId, result.value.reservation.version, {
          notes: 'should fail',
        }),
      ).rejects.toMatchObject({ code: 'invalid_reservation_state' });
    });
  });

  // TASK 16.20 (Parts D-H) — the mandatory Event Consumable Inventory
  // Certification. Exercises the exact acceptance numbers the task itself
  // specifies: a generic sock product and a generic snack/drink product,
  // each starting at 100 units; a package including 25 of each; quote and
  // reservation-creation must NOT move stock; issuing 23 socks + 20 drinks
  // must bring both to exactly 77/80; a retried issue must NOT
  // double-decrement; +2 additional socks must bring the total to 75;
  // cancellation before/after issuance must behave honestly.
  describe('TASK 16.20 — event consumable inventory certification', () => {
    let sockVariantId: string;
    let drinkVariantId: string;
    let drinkProductId: string;
    let untrackedSnackAgainId: string;
    let eventLocationId: string;
    let certPackageId: string;

    async function balanceOf(variantId: string): Promise<string> {
      const row = await database.pool.query<{ quantity_on_hand: string }>(
        `select quantity_on_hand::text from inventory_balances where company_id=$1 and branch_id=$2 and product_variant_id=$3`,
        [companyId, branchId, variantId],
      );
      return row.rows[0]?.quantity_on_hand ?? 'MISSING';
    }
    async function movementCount(referenceType: string, referenceId: string): Promise<number> {
      const row = await database.pool.query<{ count: string }>(
        `select count(*)::text as count from inventory_movements where company_id=$1 and reference_type=$2 and reference_id=$3`,
        [companyId, referenceType, referenceId],
      );
      return Number(row.rows[0]?.count ?? '0');
    }

    beforeAll(async () => {
      // A SEPARATE inventory location from the other describe blocks'
      // fixture, so this certification's balances are never polluted by
      // (or pollute) unrelated tests sharing the same branch.
      eventLocationId = randomUUID();
      await database.pool.query(
        `insert into inventory_locations (id,company_id,branch_id,code,normalized_code,name,location_type,status,allows_receiving,allows_issuing,is_default,created_by,updated_by)
         values($1,$2,$3,'EVENTCERT','eventcert','Event Certification','event_storage','active',true,true,false,$4,$4)`,
        [eventLocationId, companyId, branchId, userId],
      );
      // `postPartySockDeduction`/`postPartySnackDeduction` both resolve the
      // branch's single active `is_default=true` location — flip the
      // existing default fixture location off and this new one on, so
      // this certification's movements land here, not on `inventoryLocationId`.
      await database.pool.query(`update inventory_locations set is_default=false where id=$1`, [inventoryLocationId]);
      await database.pool.query(`update inventory_locations set is_default=true where id=$1`, [eventLocationId]);

      const sockProductId = randomUUID();
      drinkProductId = randomUUID();
      const untrackedSnackProductId = randomUUID();
      await database.pool.query(
        `insert into products
         (id,company_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
         values($1,$2,'CERT-SOCK','cert-sock','Certification Sock','simple',true,'IVA_EXEMPT','active',$3,$3),
               ($4,$2,'CERT-DRINK','cert-drink','Certification Drink','simple',true,'IVA_GENERAL','active',$3,$3),
               ($5,$2,'CERT-UNTRACKED','cert-untracked','Untracked Snack','simple',false,'IVA_GENERAL','active',$3,$3)`,
        [sockProductId, companyId, userId, drinkProductId, untrackedSnackProductId],
      );
      await database.pool.query(
        `insert into product_prices (id,company_id,product_id,amount,currency_code,status,created_by,updated_by)
         values($1,$2,$3,'15.0000','MXN','active',$4,$4),($5,$2,$6,'0.0000','MXN','active',$4,$4)`,
        [randomUUID(), companyId, drinkProductId, userId, randomUUID(), untrackedSnackProductId],
      );
      sockVariantId = randomUUID();
      drinkVariantId = randomUUID();
      await database.pool.query(
        `insert into product_variants
         (id,company_id,product_id,sku,normalized_sku,name,unit_of_measure_code,quantity_scale,tracks_inventory,standard_cost,currency_code,is_default,option_signature,status,created_by,updated_by)
         values($1,$2,$3,'CERT-SOCK-DEFAULT','cert-sock-default','Certification Sock','unit',0,true,5,'MXN',true,$4,'active',$5,$5),
               ($6,$2,$7,'CERT-DRINK-DEFAULT','cert-drink-default','Certification Drink','unit',6,true,3,'MXN',true,$8,'active',$5,$5)`,
        [sockVariantId, companyId, sockProductId, '4'.repeat(64), userId, drinkVariantId, drinkProductId, '5'.repeat(64)],
      );
      await database.pool.query(
        `insert into inventory_balances (id,company_id,branch_id,inventory_location_id,product_variant_id,quantity_on_hand,quantity_reserved,quantity_in_transit,average_unit_cost,version)
         values($1,$2,$3,$4,$5,'100',0,0,0,1),($6,$2,$3,$4,$7,'100.000000',0,0,0,1)`,
        [randomUUID(), companyId, branchId, eventLocationId, sockVariantId, randomUUID(), drinkVariantId],
      );
      untrackedSnackAgainId = untrackedSnackProductId;

      // The package: 25 socks + 25 drinks included, auto-planned (never
      // auto-consumed) at reservation-creation time (Part D4/E).
      const pkgResult = await packages.createPackage(context(companyId, userId), branchIds, `pkg-cert-${randomUUID()}`, {
        branchId,
        code: 'CERT-PKG',
        name: 'Certification Package',
        price: '1000.0000',
        durationMinutes: 60,
        includedConsumables: [
          { kind: 'sock', label: 'Certification Sock', quantity: 25, productId: sockProductId, size: 'Unica' },
          { kind: 'snack', label: 'Certification Drink', quantity: 25, productId: drinkProductId },
        ],
      });
      certPackageId = pkgResult.value.id;
      expect(pkgResult.value.includedConsumables).toHaveLength(2);
    });

    afterAll(async () => {
      await database.pool.query(`update inventory_locations set is_default=false where id=$1`, [eventLocationId]);
      await database.pool.query(`update inventory_locations set is_default=true where id=$1`, [inventoryLocationId]);
    });

    it('quoting a package never touches inventory (a quote is a pure computation, no DB write at all)', async () => {
      const pkg = await packages.packageRow(companyId, branchIds, certPackageId);
      packageQuoteInput(pkg, { children: 0, adults: 0, extraHalfHours: 0 });
      expect(await balanceOf(sockVariantId)).toBe('100.000000');
      expect(await balanceOf(drinkVariantId)).toBe('100.000000');
    });

    it('creating a reservation from the package auto-plans socks/snacks WITHOUT moving any inventory', async () => {
      const created = await reservations.createReservation(context(companyId, userId), branchIds, `res-cert-create-${randomUUID()}`, {
        branchId,
        roomId: roomB,
        packageId: certPackageId,
        eventDate: '2026-12-10',
        startTime: '09:00',
        endTime: '11:00',
      });
      const detail = await reservations.reservationDetail(companyId, branchIds, created.value.id);
      expect(detail.socks).toHaveLength(1);
      expect(detail.socks[0]?.quantity).toBe(25);
      expect(detail.socks[0]?.includedInPackage).toBe(true);
      expect(detail.socks[0]?.stockDeducted).toBe('pending');
      expect(detail.snacks).toHaveLength(1);
      expect(detail.snacks[0]?.quantity).toBe('25.000000');
      expect(detail.snacks[0]?.includedInPackage).toBe(true);
      expect(detail.snacks[0]?.stockDeducted).toBe('pending');
      // Stock unchanged by mere reservation existence (Part D3).
      expect(await balanceOf(sockVariantId)).toBe('100.000000');
      expect(await balanceOf(drinkVariantId)).toBe('100.000000');

      // Cancel-before-issuance certification, on this SAME reservation:
      // no sock/snack was ever deducted, so cancelling posts NO
      // compensating movement at all (nothing to compensate).
      await reservations.cancelReservation(context(companyId, userId), branchIds, `cancel-cert-preissue-${randomUUID()}`, created.value.id, created.value.version, {
        reasonCode: 'customer_request',
      });
      expect(await balanceOf(sockVariantId)).toBe('100.000000');
      expect(await balanceOf(drinkVariantId)).toBe('100.000000');
      expect(await movementCount('party_reservation_sock', detail.socks[0]?.id ?? '')).toBe(0);
      expect(await movementCount('party_reservation_snack', detail.snacks[0]?.id ?? '')).toBe(0);
    });

    describe('the full issue/retry/additional/cancel-after-issue lifecycle', () => {
      let reservationId: string;
      let sockLineId: string;
      let snackLineId: string;

      beforeAll(async () => {
        const created = await reservations.createReservation(context(companyId, userId), branchIds, `res-cert-lifecycle-${randomUUID()}`, {
          branchId,
          roomId: roomB,
          packageId: certPackageId,
          eventDate: '2026-12-11',
          startTime: '09:00',
          endTime: '11:00',
        });
        reservationId = created.value.id;
        const detail = await reservations.reservationDetail(companyId, branchIds, reservationId);
        sockLineId = detail.socks[0]?.id ?? '';
        snackLineId = detail.snacks[0]?.id ?? '';
      });

      it('issuing 23 of 25 planned socks and 20 of 25 planned drinks brings stock to exactly 77/80', async () => {
        const sockDeducted = await reservations.deductSock(context(companyId, userId), branchIds, reservationId, sockLineId, {
          issuedQuantity: 23,
        });
        expect(sockDeducted.stockDeducted).toBe('deducted');
        expect(sockDeducted.issuedQuantity).toBe(23);
        expect(await balanceOf(sockVariantId)).toBe('77.000000');

        const snackDeducted = await reservations.deductSnack(context(companyId, userId), branchIds, reservationId, snackLineId, {
          issuedQuantity: '20',
        });
        expect(snackDeducted.stockDeducted).toBe('deducted');
        expect(snackDeducted.issuedQuantity).toBe('20.000000');
        expect(await balanceOf(drinkVariantId)).toBe('80.000000');

        // Exactly one movement each — traceable to this exact reservation.
        expect(await movementCount('party_reservation_sock', sockLineId)).toBe(1);
        expect(await movementCount('party_reservation_snack', snackLineId)).toBe(1);
      });

      it('retrying the same issue never double-decrements (idempotent, stays 77/80)', async () => {
        await expect(
          reservations.deductSock(context(companyId, userId), branchIds, reservationId, sockLineId, { issuedQuantity: 23 }),
        ).rejects.toMatchObject({ code: 'resource_conflict' });
        await expect(
          reservations.deductSnack(context(companyId, userId), branchIds, reservationId, snackLineId, { issuedQuantity: '20' }),
        ).rejects.toMatchObject({ code: 'resource_conflict' });
        expect(await balanceOf(sockVariantId)).toBe('77.000000');
        expect(await balanceOf(drinkVariantId)).toBe('80.000000');
        expect(await movementCount('party_reservation_sock', sockLineId)).toBe(1);
        expect(await movementCount('party_reservation_snack', snackLineId)).toBe(1);
      });

      it('additional socks beyond the plan are a SEPARATE, traceable row — +2 brings stock to exactly 75', async () => {
        const extra = await reservations.addSock(context(companyId, userId), branchIds, reservationId, {
          size: 'Unica',
          quantity: 2,
          productVariantId: sockVariantId,
        });
        expect(extra.includedInPackage).toBe(false);
        const extraDeducted = await reservations.deductSock(context(companyId, userId), branchIds, reservationId, extra.id);
        expect(extraDeducted.issuedQuantity).toBe(2);
        expect(await balanceOf(sockVariantId)).toBe('75.000000');
        // The ORIGINAL planned row's own history is untouched — never
        // rewritten to absorb the extra amount.
        const originalStillIssued = await partiesRepository.lockSock(
          { query: (sql, values) => database.pool.query(sql, values as unknown[]) },
          companyId,
          reservationId,
          sockLineId,
        );
        expect(originalStillIssued?.issuedQuantity).toBe(23);
      });

      it('a non-inventory-tracked snack honestly stays not_applicable and cannot be deducted', async () => {
        const custom = await reservations.addSnack(context(companyId, userId), branchIds, reservationId, {
          productId: untrackedSnackAgainId,
          quantity: '1',
        });
        expect(custom.stockDeducted).toBe('not_applicable');
        // `productVariantId===null` is checked before `stockDeducted`
        // (mirrors `deductSock`'s own check order exactly) — an honest
        // "nothing to deduct" rejection either way, never a fabricated
        // success.
        await expect(
          reservations.deductSnack(context(companyId, userId), branchIds, reservationId, custom.id),
        ).rejects.toMatchObject({ code: 'validation_error' });
      });

      it('insufficient stock is honestly rejected, never a fabricated success or a negative balance', async () => {
        const hugeSock = await reservations.addSock(context(companyId, userId), branchIds, reservationId, {
          size: 'Unica',
          quantity: 9999,
          productVariantId: sockVariantId,
        });
        await expect(
          reservations.deductSock(context(companyId, userId), branchIds, reservationId, hugeSock.id),
        ).rejects.toMatchObject({ code: 'insufficient_inventory' });
        expect(await balanceOf(sockVariantId)).toBe('75.000000');
      });

      it('cancelling AFTER issuance does not silently restore stock — 75/80 remains, no fabricated return-to-stock', async () => {
        const current = await reservations.reservation(companyId, branchIds, reservationId);
        await reservations.cancelReservation(context(companyId, userId), branchIds, `cancel-cert-postissue-${randomUUID()}`, reservationId, current.version, {
          reasonCode: 'customer_request',
        });
        expect(await balanceOf(sockVariantId)).toBe('75.000000');
        expect(await balanceOf(drinkVariantId)).toBe('80.000000');
        // The already-posted movements are untouched — cancellation never
        // rewrites or deletes inventory history.
        expect(await movementCount('party_reservation_sock', sockLineId)).toBe(1);
        expect(await movementCount('party_reservation_snack', snackLineId)).toBe(1);
      });
    });
  });

  // TASK 16.20 (Part L1) — resolves the TASK 16.19-disclosed gap: a real,
  // backend-authoritative, concurrency-safe coupon integration for party
  // reservations, sharing the platform's real `coupons` catalog (never a
  // parallel/fake discount mechanism) while using a dedicated redemption
  // table so the certified sales-coupon path is never touched.
  // TASK 16.20 (Part P) — resolves the TASK 16.19-disclosed gap: real
  // tenant-configurable contract/waiver text, with genuine
  // version/snapshot behavior so an already-generated document's wording
  // never silently mutates.
  describe('TASK 16.20 — tenant-configurable contract/waiver terms (Part P)', () => {
    async function setCompanySetting(key: string, value: string): Promise<void> {
      await database.pool.query(
        `insert into company_settings (id,company_id,key,value,value_type,status,created_by,updated_by)
         values ($1,$2,$3,$4::jsonb,'string','active',$5,$5)
         on conflict (company_id,key) do update set value=excluded.value, status='active'`,
        [randomUUID(), companyId, key, JSON.stringify(value), userId],
      );
    }
    async function setBranchSetting(key: string, value: string): Promise<void> {
      await database.pool.query(
        `insert into branch_settings (id,company_id,branch_id,key,value,value_type,status,created_by,updated_by)
         values ($1,$2,$3,$4,$5::jsonb,'string','active',$6,$6)
         on conflict (company_id,branch_id,key) do update set value=excluded.value, status='active'`,
        [randomUUID(), companyId, branchId, key, JSON.stringify(value), userId],
      );
    }
    afterAll(async () => {
      await database.pool.query(`delete from company_settings where company_id=$1 and key like 'parties.%'`, [companyId]);
      await database.pool.query(`delete from branch_settings where company_id=$1 and key like 'parties.%'`, [companyId]);
    });

    it('uses the generic tenant-neutral default when no setting is configured', async () => {
      const created = await reservations.createReservation(context(companyId, userId), branchIds, `res-terms-default-${randomUUID()}`, {
        branchId,
        roomId: roomA,
        packageId,
        eventDate: '2027-02-01',
        startTime: '09:00',
        endTime: '10:00',
      });
      const contract = await reservations.generateDocument(context(companyId, userId), branchIds, created.value.id, 'contract');
      expect(contract.html).toContain('El cliente acepta la fecha, horario, salón y paquete');
    });

    it('uses a real company-configured clause set, and freezes it against a later setting change (never mutates on reprint)', async () => {
      await setCompanySetting('parties.contract_terms', 'Cláusula única de la empresa para esta prueba.');
      const created = await reservations.createReservation(context(companyId, userId), branchIds, `res-terms-company-${randomUUID()}`, {
        branchId,
        roomId: roomA,
        packageId,
        eventDate: '2027-02-02',
        startTime: '09:00',
        endTime: '10:00',
      });
      const first = await reservations.generateDocument(context(companyId, userId), branchIds, created.value.id, 'contract');
      expect(first.html).toContain('Cláusula única de la empresa para esta prueba.');
      expect(first.html).not.toContain('El cliente acepta la fecha, horario, salón y paquete');

      // Change the tenant's setting AFTER the document was first generated.
      await setCompanySetting('parties.contract_terms', 'Cláusula MODIFICADA — nunca debe verse en el reprint anterior.');

      const reprint = await reservations.generateDocument(context(companyId, userId), branchIds, created.value.id, 'contract');
      expect(reprint.html).toContain('Cláusula única de la empresa para esta prueba.');
      expect(reprint.html).not.toContain('MODIFICADA');
    });

    it('a branch-level override wins over the company-wide setting', async () => {
      await setCompanySetting('parties.waiver_terms', 'Deslinde de nivel empresa.');
      await setBranchSetting('parties.waiver_terms', 'Deslinde específico de esta sucursal.');
      const created = await reservations.createReservation(context(companyId, userId), branchIds, `res-terms-branch-${randomUUID()}`, {
        branchId,
        roomId: roomA,
        packageId,
        eventDate: '2027-02-03',
        startTime: '09:00',
        endTime: '10:00',
      });
      const waiver = await reservations.generateDocument(context(companyId, userId), branchIds, created.value.id, 'waiver');
      expect(waiver.html).toContain('Deslinde específico de esta sucursal.');
      expect(waiver.html).not.toContain('Deslinde de nivel empresa.');
    });
  });

  describe('TASK 16.20 — coupon integration (Part L1)', () => {
    let percentageCouponId: string;
    let fixedCouponId: string;
    let inactiveCouponId: string;
    let minSubtotalCouponId: string;
    let limitedCouponId: string;

    beforeAll(async () => {
      percentageCouponId = randomUUID();
      fixedCouponId = randomUUID();
      inactiveCouponId = randomUUID();
      minSubtotalCouponId = randomUUID();
      limitedCouponId = randomUUID();
      await database.pool.query(
        `insert into coupons(id,company_id,code,normalized_code,benefit_type,benefit_percentage_basis_points,active,created_by,updated_by)
         values($1,$2,'PARTY10','PARTY10','percentage',1000,true,$3,$3)`,
        [percentageCouponId, companyId, userId],
      );
      await database.pool.query(
        `insert into coupons(id,company_id,code,normalized_code,benefit_type,benefit_fixed_amount,active,created_by,updated_by)
         values($1,$2,'PARTY500','PARTY500','fixed_amount','500.0000',true,$3,$3)`,
        [fixedCouponId, companyId, userId],
      );
      await database.pool.query(
        `insert into coupons(id,company_id,code,normalized_code,benefit_type,benefit_percentage_basis_points,active,created_by,updated_by)
         values($1,$2,'PARTYOFF','PARTYOFF','percentage',1000,false,$3,$3)`,
        [inactiveCouponId, companyId, userId],
      );
      await database.pool.query(
        `insert into coupons(id,company_id,code,normalized_code,benefit_type,benefit_percentage_basis_points,min_subtotal,active,created_by,updated_by)
         values($1,$2,'PARTYBIG','PARTYBIG','percentage',1000,'5000.0000',true,$3,$3)`,
        [minSubtotalCouponId, companyId, userId],
      );
      await database.pool.query(
        `insert into coupons(id,company_id,code,normalized_code,benefit_type,benefit_percentage_basis_points,usage_limit_total,active,created_by,updated_by)
         values($1,$2,'PARTY1USE','PARTY1USE','percentage',1000,1,true,$3,$3)`,
        [limitedCouponId, companyId, userId],
      );
    });

    async function newReservation(eventDate: string): Promise<{ id: string; version: bigint }> {
      const created = await reservations.createReservation(context(companyId, userId), branchIds, `res-coupon-${randomUUID()}`, {
        branchId,
        roomId: roomA,
        packageId,
        eventDate,
        startTime: '09:00',
        endTime: '10:00',
        childrenCount: 10,
      });
      return { id: created.value.id, version: created.value.version };
    }

    it('applies a percentage coupon: recomputes discount/tax/total exactly, and rejects a second apply on the same reservation', async () => {
      const { id } = await newReservation('2027-01-05');
      // childrenCount:10 == included -> subtotal 3500.00; 10% off = 350.00;
      // discounted base 3150.00; 16% tax = 504.00; total 3654.00.
      const updated = await reservations.applyCoupon(context(companyId, userId), branchIds, id, { code: 'party10' });
      expect(updated.discountTotal).toBe('350.0000');
      expect(updated.taxTotal).toBe('504.0000');
      expect(updated.quotedTotal).toBe('3654.0000');
      expect(updated.couponId).toBe(percentageCouponId);
      expect(updated.couponCodeSnapshot).toBe('PARTY10');

      await expect(reservations.applyCoupon(context(companyId, userId), branchIds, id, { code: 'PARTY10' })).rejects.toMatchObject({
        code: 'resource_conflict',
      });

      const redemptions = await database.pool.query<{ count: string }>(
        `select count(*)::text as count from party_reservation_coupon_redemptions where company_id=$1 and reservation_id=$2`,
        [companyId, id],
      );
      expect(redemptions.rows[0]?.count).toBe('1');
    });

    it('applies a fixed-amount coupon, then removes it — reverting to the original undiscounted total and freeing the redemption slot', async () => {
      const { id } = await newReservation('2027-01-06');
      const applied = await reservations.applyCoupon(context(companyId, userId), branchIds, id, { code: 'PARTY500' });
      expect(applied.discountTotal).toBe('500.0000');
      expect(applied.taxTotal).toBe('480.0000'); // (3500-500)*0.16
      expect(applied.quotedTotal).toBe('3480.0000');

      const removed = await reservations.removeCoupon(context(companyId, userId), branchIds, id);
      expect(removed.discountTotal).toBe('0.0000');
      expect(removed.taxTotal).toBe('560.0000');
      expect(removed.quotedTotal).toBe('4060.0000');
      expect(removed.couponId).toBeNull();
      expect(removed.couponCodeSnapshot).toBeNull();

      const redemptions = await database.pool.query<{ count: string }>(
        `select count(*)::text as count from party_reservation_coupon_redemptions where company_id=$1 and reservation_id=$2`,
        [companyId, id],
      );
      expect(redemptions.rows[0]?.count).toBe('0');

      // The slot is genuinely free — the SAME coupon can be reapplied.
      const reapplied = await reservations.applyCoupon(context(companyId, userId), branchIds, id, { code: 'PARTY500' });
      expect(reapplied.discountTotal).toBe('500.0000');
    });

    it('an inactive coupon, a below-minimum subtotal, and an unknown code are all honestly rejected — never a fabricated discount', async () => {
      const { id: idA } = await newReservation('2027-01-07');
      await expect(reservations.applyCoupon(context(companyId, userId), branchIds, idA, { code: 'PARTYOFF' })).rejects.toMatchObject({
        code: 'coupon_inactive',
      });

      const { id: idB } = await newReservation('2027-01-08');
      await expect(reservations.applyCoupon(context(companyId, userId), branchIds, idB, { code: 'PARTYBIG' })).rejects.toMatchObject({
        code: 'coupon_min_subtotal_not_met',
      });

      const { id: idC } = await newReservation('2027-01-09');
      await expect(reservations.applyCoupon(context(companyId, userId), branchIds, idC, { code: 'NOSUCHCODE' })).rejects.toMatchObject({
        code: 'resource_not_found',
      });
    });

    it('a usage-limit-1 coupon can be redeemed once; a second reservation is rejected; cancelling the first frees the slot for a third', async () => {
      const { id: idA } = await newReservation('2027-01-10');
      await reservations.applyCoupon(context(companyId, userId), branchIds, idA, { code: 'PARTY1USE' });

      const { id: idB } = await newReservation('2027-01-11');
      await expect(reservations.applyCoupon(context(companyId, userId), branchIds, idB, { code: 'PARTY1USE' })).rejects.toMatchObject({
        code: 'coupon_usage_limit_reached',
      });

      // Cancelling the first reservation releases its redemption slot
      // (ADR-0016's own "released on cancellation" window, mirrored).
      const currentA = await reservations.reservation(companyId, branchIds, idA);
      await reservations.cancelReservation(context(companyId, userId), branchIds, `cancel-coupon-${randomUUID()}`, idA, currentA.version, {
        reasonCode: 'customer_request',
      });

      const { id: idC } = await newReservation('2027-01-12');
      const appliedC = await reservations.applyCoupon(context(companyId, userId), branchIds, idC, { code: 'PARTY1USE' });
      expect(appliedC.couponCodeSnapshot).toBe('PARTY1USE');
    });
  });

  // TASK 16.20A (Parts 7-17) — the party-specific correction workflow: a
  // real, delta-only compensating movement for an already-issued
  // consumable, reusing TASK 16.20's own certified inventory-posting
  // architecture (never the generic full-movement reversal endpoint,
  // never editing/deleting the original movement).
  // TASK 16.20A (Parts 1-5, 18, 21) — real, tenant-scoped FK validation
  // for a package's `included_consumables`, and the mandatory proof that
  // editing a package's consumables never retroactively mutates an
  // already-created reservation's own planned quantities.
  describe('TASK 16.20A — package consumables: validation and historical snapshot safety', () => {
    let adminProductId: string;
    let adminVariantId: string;
    let otherProductVariantId: string;

    beforeAll(async () => {
      adminProductId = randomUUID();
      const otherProductId = randomUUID();
      await database.pool.query(
        `insert into products (id,company_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
         values($1,$2,'ADMIN-SOCK','admin-sock','Admin Test Sock','simple',true,'IVA_EXEMPT','active',$3,$3),
               ($4,$2,'ADMIN-OTHER','admin-other','Admin Other Product','simple',true,'IVA_EXEMPT','active',$3,$3)`,
        [adminProductId, companyId, userId, otherProductId],
      );
      adminVariantId = randomUUID();
      otherProductVariantId = randomUUID();
      await database.pool.query(
        `insert into product_variants
         (id,company_id,product_id,sku,normalized_sku,name,unit_of_measure_code,quantity_scale,tracks_inventory,standard_cost,currency_code,is_default,option_signature,status,created_by,updated_by)
         values($1,$2,$3,'ADMIN-SOCK-DEFAULT','admin-sock-default','Admin Sock','unit',0,true,5,'MXN',true,$4,'active',$5,$5),
               ($6,$2,$7,'ADMIN-OTHER-DEFAULT','admin-other-default','Admin Other','unit',0,true,5,'MXN',true,$8,'active',$5,$5)`,
        [adminVariantId, companyId, adminProductId, '1'.repeat(64), userId, otherProductVariantId, otherProductId, '2'.repeat(64)],
      );
    });

    it('rejects a JSON entry naming a productId that does not exist in this company\'s catalog', async () => {
      await expect(
        packages.createPackage(context(companyId, userId), branchIds, `pkg-badproduct-${randomUUID()}`, {
          branchId,
          code: `BADPROD-${randomUUID().slice(0, 8)}`,
          name: 'Bad Product Package',
          price: '500.0000',
          durationMinutes: 60,
          includedConsumables: [{ kind: 'sock', label: 'Ghost Sock', quantity: 5, productId: randomUUID() }],
        }),
      ).rejects.toMatchObject({ code: 'resource_not_found' });
    });

    it('rejects a productVariantId that does not belong to the given productId', async () => {
      await expect(
        packages.createPackage(context(companyId, userId), branchIds, `pkg-badvariant-${randomUUID()}`, {
          branchId,
          code: `BADVAR-${randomUUID().slice(0, 8)}`,
          name: 'Bad Variant Package',
          price: '500.0000',
          durationMinutes: 60,
          includedConsumables: [
            { kind: 'sock', label: 'Mismatched Sock', quantity: 5, productId: adminProductId, productVariantId: otherProductVariantId },
          ],
        }),
      ).rejects.toMatchObject({ code: 'resource_not_found' });
    });

    it('rejects a duplicate entry for the same product/variant — never silently merged', async () => {
      await expect(
        packages.createPackage(context(companyId, userId), branchIds, `pkg-dup-${randomUUID()}`, {
          branchId,
          code: `DUP-${randomUUID().slice(0, 8)}`,
          name: 'Duplicate Package',
          price: '500.0000',
          durationMinutes: 60,
          includedConsumables: [
            { kind: 'sock', label: 'Sock A', quantity: 5, productId: adminProductId, productVariantId: adminVariantId },
            { kind: 'sock', label: 'Sock A again', quantity: 3, productId: adminProductId, productVariantId: adminVariantId },
          ],
        }),
      ).rejects.toMatchObject({ code: 'validation_error' });
    });

    it('rejects a non-positive quantity', async () => {
      await expect(
        packages.createPackage(context(companyId, userId), branchIds, `pkg-zeroqty-${randomUUID()}`, {
          branchId,
          code: `ZEROQTY-${randomUUID().slice(0, 8)}`,
          name: 'Zero Quantity Package',
          price: '500.0000',
          durationMinutes: 60,
          includedConsumables: [{ kind: 'sock', label: 'Zero Sock', quantity: 0, productId: adminProductId }],
        }),
      ).rejects.toMatchObject({ code: 'validation_error' });
    });

    it('persists a valid, tenant-scoped included_consumables array with an explicit variant, returned unchanged on read', async () => {
      const created = await packages.createPackage(context(companyId, userId), branchIds, `pkg-valid-${randomUUID()}`, {
        branchId,
        code: `VALID-${randomUUID().slice(0, 8)}`,
        name: 'Valid Consumables Package',
        price: '500.0000',
        durationMinutes: 60,
        includedConsumables: [{ kind: 'sock', label: 'Real Sock', quantity: 5, productId: adminProductId, productVariantId: adminVariantId }],
      });
      expect(created.value.includedConsumables).toEqual([
        { kind: 'sock', label: 'Real Sock', quantity: 5, productId: adminProductId, productVariantId: adminVariantId },
      ]);
      const reread = await packages.packageRow(companyId, branchIds, created.value.id);
      expect(reread.includedConsumables).toEqual(created.value.includedConsumables);
    });

    // Part 18 — the mandatory proof: editing a package's consumables
    // must NEVER retroactively rewrite an already-created reservation's
    // own planned quantities; only a NEW reservation picks up the edit.
    it('editing a package after a reservation exists leaves that reservation\'s planned quantities untouched; a later reservation uses the edited values', async () => {
      const pkg = await packages.createPackage(context(companyId, userId), branchIds, `pkg-snapshot-${randomUUID()}`, {
        branchId,
        code: `SNAP-${randomUUID().slice(0, 8)}`,
        name: 'Snapshot Safety Package',
        price: '800.0000',
        durationMinutes: 60,
        includedConsumables: [{ kind: 'sock', label: 'Snapshot Sock', quantity: 25, productId: adminProductId, productVariantId: adminVariantId }],
      });

      const reservationA = await reservations.createReservation(context(companyId, userId), branchIds, `res-snap-a-${randomUUID()}`, {
        branchId,
        roomId: roomB,
        packageId: pkg.value.id,
        eventDate: '2027-04-01',
        startTime: '09:00',
        endTime: '10:00',
      });
      const detailA = await reservations.reservationDetail(companyId, branchIds, reservationA.value.id);
      expect(detailA.socks[0]?.quantity).toBe(25);

      // Edit the package's own consumables plan AFTER reservation A exists.
      await packages.updatePackage(context(companyId, userId), branchIds, pkg.value.id, pkg.value.version, {
        includedConsumables: [{ kind: 'sock', label: 'Snapshot Sock', quantity: 30, productId: adminProductId, productVariantId: adminVariantId }],
      });

      // Reservation A's own already-created plan is untouched.
      const detailAAfterEdit = await reservations.reservationDetail(companyId, branchIds, reservationA.value.id);
      expect(detailAAfterEdit.socks[0]?.quantity).toBe(25);
      expect(detailAAfterEdit.socks[0]?.id).toBe(detailA.socks[0]?.id); // the SAME row, never replaced.

      // A NEW reservation created after the edit uses the updated plan.
      const reservationB = await reservations.createReservation(context(companyId, userId), branchIds, `res-snap-b-${randomUUID()}`, {
        branchId,
        roomId: roomB,
        packageId: pkg.value.id,
        eventDate: '2027-04-02',
        startTime: '09:00',
        endTime: '10:00',
      });
      const detailB = await reservations.reservationDetail(companyId, branchIds, reservationB.value.id);
      expect(detailB.socks[0]?.quantity).toBe(30);
    });
  });

  describe('TASK 16.20A — consumable correction workflow', () => {
    let sockVariantId: string;
    let drinkVariantId: string;
    let correctionLocationId: string;
    let correctionPackageId: string;

    async function balanceOf(variantId: string): Promise<string> {
      const row = await database.pool.query<{ quantity_on_hand: string }>(
        `select quantity_on_hand::text from inventory_balances where company_id=$1 and branch_id=$2 and product_variant_id=$3`,
        [companyId, branchId, variantId],
      );
      return row.rows[0]?.quantity_on_hand ?? 'MISSING';
    }
    async function movementsFor(referenceType: string, referenceId: string): Promise<readonly { movement_type: string; quantity: string }[]> {
      const rows = await database.pool.query<{ movement_type: string; quantity: string }>(
        `select m.movement_type, l.quantity::text
         from inventory_movements m
         join inventory_movement_lines l on l.inventory_movement_id=m.id
         where m.company_id=$1 and m.reference_type=$2 and m.reference_id=$3
         order by m.created_at asc`,
        [companyId, referenceType, referenceId],
      );
      return rows.rows;
    }

    beforeAll(async () => {
      correctionLocationId = randomUUID();
      await database.pool.query(
        `insert into inventory_locations (id,company_id,branch_id,code,normalized_code,name,location_type,status,allows_receiving,allows_issuing,is_default,created_by,updated_by)
         values($1,$2,$3,'CORRECTLOC','correctloc','Correction Test Location','event_storage','active',true,true,false,$4,$4)`,
        [correctionLocationId, companyId, branchId, userId],
      );
      await database.pool.query(`update inventory_locations set is_default=false where id=$1`, [inventoryLocationId]);
      await database.pool.query(`update inventory_locations set is_default=true where id=$1`, [correctionLocationId]);

      const sockProductId = randomUUID();
      const drinkProductId = randomUUID();
      await database.pool.query(
        `insert into products (id,company_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
         values($1,$2,'CORR-SOCK','corr-sock','Correction Sock','simple',true,'IVA_EXEMPT','active',$3,$3),
               ($4,$2,'CORR-DRINK','corr-drink','Correction Drink','simple',true,'IVA_GENERAL','active',$3,$3)`,
        [sockProductId, companyId, userId, drinkProductId],
      );
      sockVariantId = randomUUID();
      drinkVariantId = randomUUID();
      await database.pool.query(
        `insert into product_variants
         (id,company_id,product_id,sku,normalized_sku,name,unit_of_measure_code,quantity_scale,tracks_inventory,standard_cost,currency_code,is_default,option_signature,status,created_by,updated_by)
         values($1,$2,$3,'CORR-SOCK-DEFAULT','corr-sock-default','Correction Sock','unit',0,true,5,'MXN',true,$4,'active',$5,$5),
               ($6,$2,$7,'CORR-DRINK-DEFAULT','corr-drink-default','Correction Drink','unit',6,true,3,'MXN',true,$8,'active',$5,$5)`,
        [sockVariantId, companyId, sockProductId, '8'.repeat(64), userId, drinkVariantId, drinkProductId, '9'.repeat(64)],
      );
      // A large starting stock (not 100) — this describe block runs
      // MANY sequential tests against the SAME shared variant/balance
      // (fresh reservations, but cumulative stock), so every test below
      // asserts RELATIVE deltas around its own `before` snapshot, never
      // a hardcoded absolute total — this starting size just needs to be
      // comfortably larger than the sum of everything this block ever
      // issues, so no test's own insufficient-stock assertion is ever
      // accidentally triggered by a PRIOR test's cumulative consumption.
      await database.pool.query(
        `insert into inventory_balances (id,company_id,branch_id,inventory_location_id,product_variant_id,quantity_on_hand,quantity_reserved,quantity_in_transit,average_unit_cost,version)
         values($1,$2,$3,$4,$5,'100000',0,0,0,1),($6,$2,$3,$4,$7,'100000.000000',0,0,0,1)`,
        [randomUUID(), companyId, branchId, correctionLocationId, sockVariantId, randomUUID(), drinkVariantId],
      );
      const pkgResult = await packages.createPackage(context(companyId, userId), branchIds, `pkg-corr-${randomUUID()}`, {
        branchId,
        code: 'CORR-PKG',
        name: 'Correction Package',
        price: '1000.0000',
        durationMinutes: 60,
        includedConsumables: [
          { kind: 'sock', label: 'Correction Sock', quantity: 25, productId: sockProductId, size: 'Unica' },
          { kind: 'snack', label: 'Correction Drink', quantity: 25, productId: drinkProductId },
        ],
      });
      correctionPackageId = pkgResult.value.id;
    });

    afterAll(async () => {
      await database.pool.query(`update inventory_locations set is_default=false where id=$1`, [correctionLocationId]);
      await database.pool.query(`update inventory_locations set is_default=true where id=$1`, [inventoryLocationId]);
    });

    async function freshReservation(eventDate: string): Promise<{ id: string; sockLineId: string; snackLineId: string }> {
      const created = await reservations.createReservation(context(companyId, userId), branchIds, `res-corr-${randomUUID()}`, {
        branchId,
        roomId: roomB,
        packageId: correctionPackageId,
        eventDate,
        startTime: '09:00',
        endTime: '11:00',
      });
      const detail = await reservations.reservationDetail(companyId, branchIds, created.value.id);
      return { id: created.value.id, sockLineId: detail.socks[0]?.id ?? '', snackLineId: detail.snacks[0]?.id ?? '' };
    }

    it('downward correction: issue 25, correct to 23 — net -23, a +2 compensating return, original movement untouched', async () => {
      const { id, sockLineId } = await freshReservation('2027-03-01');
      const before = Number(await balanceOf(sockVariantId));
      await reservations.deductSock(context(companyId, userId), branchIds, id, sockLineId);
      expect(before - Number(await balanceOf(sockVariantId))).toBe(25);

      const corrected = await reservations.correctSock(context(companyId, userId), branchIds, id, sockLineId, { correctedQuantity: 23 });
      expect(corrected.issuedQuantity).toBe(23);
      expect(before - Number(await balanceOf(sockVariantId))).toBe(23); // net consumption is now exactly 23, not 25.

      const movements = await movementsFor('party_reservation_sock', sockLineId);
      expect(movements).toEqual([
        { movement_type: 'issue', quantity: '25.000000' },
        { movement_type: 'return', quantity: '2.000000' },
      ]);
    });

    it('retrying the identical correction is idempotent — no duplicate movement posted', async () => {
      const { id, sockLineId } = await freshReservation('2027-03-02');
      const before = Number(await balanceOf(sockVariantId));
      await reservations.deductSock(context(companyId, userId), branchIds, id, sockLineId);
      await reservations.correctSock(context(companyId, userId), branchIds, id, sockLineId, { correctedQuantity: 23 });
      const afterFirstCorrection = Number(await balanceOf(sockVariantId));
      await reservations.correctSock(context(companyId, userId), branchIds, id, sockLineId, { correctedQuantity: 23 });
      await reservations.correctSock(context(companyId, userId), branchIds, id, sockLineId, { correctedQuantity: 23 });

      const movements = await movementsFor('party_reservation_sock', sockLineId);
      expect(movements).toHaveLength(2); // original issue + exactly ONE correction, never three.
      expect(before - afterFirstCorrection).toBe(23);
      expect(Number(await balanceOf(sockVariantId))).toBe(afterFirstCorrection); // the two retries changed nothing further.
    });

    it('upward correction: 23 corrected up to 25 — an additional -2 issue movement, net consumption -25', async () => {
      const { id, sockLineId } = await freshReservation('2027-03-03');
      await reservations.deductSock(context(companyId, userId), branchIds, id, sockLineId, { issuedQuantity: 23 });
      const stockAfterIssue = await balanceOf(sockVariantId);

      const corrected = await reservations.correctSock(context(companyId, userId), branchIds, id, sockLineId, { correctedQuantity: 25 });
      expect(corrected.issuedQuantity).toBe(25);
      expect(Number(stockAfterIssue) - Number(await balanceOf(sockVariantId))).toBe(2);

      const movements = await movementsFor('party_reservation_sock', sockLineId);
      expect(movements).toEqual([
        { movement_type: 'issue', quantity: '23.000000' },
        { movement_type: 'issue', quantity: '2.000000' },
      ]);
    });

    it('an upward correction beyond available stock is honestly rejected, never a fabricated success', async () => {
      const { id, sockLineId } = await freshReservation('2027-03-04');
      await reservations.deductSock(context(companyId, userId), branchIds, id, sockLineId, { issuedQuantity: 1 });
      const stockBefore = await balanceOf(sockVariantId);
      await expect(
        reservations.correctSock(context(companyId, userId), branchIds, id, sockLineId, { correctedQuantity: 999_999 }),
      ).rejects.toMatchObject({ code: 'insufficient_inventory' });
      expect(await balanceOf(sockVariantId)).toBe(stockBefore);
    });

    it('rejects correcting a line that was never delivered', async () => {
      const { id, sockLineId } = await freshReservation('2027-03-05');
      await expect(
        reservations.correctSock(context(companyId, userId), branchIds, id, sockLineId, { correctedQuantity: 10 }),
      ).rejects.toMatchObject({ code: 'resource_conflict' });
    });

    it('correcting the snack line works identically (decimal quantity) and stays independent of socks', async () => {
      const { id, snackLineId } = await freshReservation('2027-03-06');
      const before = Number(await balanceOf(drinkVariantId));
      await reservations.deductSnack(context(companyId, userId), branchIds, id, snackLineId, { issuedQuantity: '25' });
      expect(before - Number(await balanceOf(drinkVariantId))).toBe(25);

      const corrected = await reservations.correctSnack(context(companyId, userId), branchIds, id, snackLineId, { correctedQuantity: '20' });
      expect(corrected.issuedQuantity).toBe('20.000000');
      expect(before - Number(await balanceOf(drinkVariantId))).toBe(20);

      const movements = await movementsFor('party_reservation_snack', snackLineId);
      expect(movements).toEqual([
        { movement_type: 'issue', quantity: '25.000000' },
        { movement_type: 'return', quantity: '5.000000' },
      ]);
    });

    it('rejects a cross-tenant correction attempt with a clean not-found, never leaking or mutating another company\'s stock', async () => {
      const { id, sockLineId } = await freshReservation('2027-03-07');
      const before = Number(await balanceOf(sockVariantId));
      await reservations.deductSock(context(companyId, userId), branchIds, id, sockLineId);
      await expect(
        reservations.correctSock(context(otherCompanyId, otherCompanyUserId), [otherCompanyBranchId], id, sockLineId, { correctedQuantity: 1 }),
      ).rejects.toMatchObject({ code: 'resource_not_found' });
      // The rejected cross-tenant attempt changed nothing — stock
      // reflects only this company's own real issue (25), never a
      // leaked/foreign mutation.
      expect(before - Number(await balanceOf(sockVariantId))).toBe(25);
    });

    it('concurrent corrections of the same line serialize safely — no lost update, no corrupted stock', async () => {
      const { id, sockLineId } = await freshReservation('2027-03-08');
      const before = Number(await balanceOf(sockVariantId));
      await reservations.deductSock(context(companyId, userId), branchIds, id, sockLineId); // issued 25, stock -25
      expect(before - Number(await balanceOf(sockVariantId))).toBe(25);

      const [a, b] = await Promise.allSettled([
        reservations.correctSock(context(companyId, userId), branchIds, id, sockLineId, { correctedQuantity: 20 }),
        reservations.correctSock(context(companyId, userId), branchIds, id, sockLineId, { correctedQuantity: 18 }),
      ]);
      expect(a.status).toBe('fulfilled');
      expect(b.status).toBe('fulfilled');

      const finalRow = await database.pool.query<{ issued_quantity: number }>(
        `select issued_quantity from party_reservation_socks where company_id=$1 and id=$2`,
        [companyId, sockLineId],
      );
      const finalIssued = finalRow.rows[0]?.issued_quantity;
      expect([18, 20]).toContain(finalIssued); // whichever correction committed last legitimately wins — never a third, corrupted value.
      // Net consumption exactly matches the final issued quantity — no drift.
      expect(before - Number(await balanceOf(sockVariantId))).toBe(finalIssued);
      // Exactly 3 movements total: the original issue + one real
      // correction per concurrent call (never fewer — both calls did
      // real, distinct work relative to what they each observed after
      // acquiring the row lock; never more — no phantom duplicates).
      const movements = await movementsFor('party_reservation_sock', sockLineId);
      expect(movements).toHaveLength(3);
    });
  });

  describe('status transitions (5-state machine)', () => {
    it('walks held -> pending_deposit -> confirmed -> completed, and rejects an invalid direct jump', async () => {
      const created = await reservations.createReservation(context(companyId, userId), branchIds, `res-status-${randomUUID()}`, {
        branchId,
        roomId: roomB,
        packageId,
        eventDate: '2026-12-15',
        startTime: '09:00',
        endTime: '11:00',
      });
      expect(created.value.status).toBe('held');

      // held -> completed is NOT a valid direct jump.
      await expect(
        reservations.transitionStatus(context(companyId, userId), branchIds, `status-invalid-${randomUUID()}`, created.value.id, created.value.version, 'completed'),
      ).rejects.toMatchObject({ code: 'invalid_reservation_state' });

      const toPending = await reservations.transitionStatus(
        context(companyId, userId),
        branchIds,
        `status-pending-${randomUUID()}`,
        created.value.id,
        created.value.version,
        'pending_deposit',
      );
      expect(toPending.value.status).toBe('pending_deposit');

      const toConfirmed = await reservations.transitionStatus(
        context(companyId, userId),
        branchIds,
        `status-confirmed-${randomUUID()}`,
        created.value.id,
        toPending.value.version,
        'confirmed',
      );
      expect(toConfirmed.value.status).toBe('confirmed');

      const toCompleted = await reservations.transitionStatus(
        context(companyId, userId),
        branchIds,
        `status-completed-${randomUUID()}`,
        created.value.id,
        toConfirmed.value.version,
        'completed',
      );
      expect(toCompleted.value.status).toBe('completed');

      // A completed reservation cannot be edited.
      await expect(
        reservations.updateReservation(context(companyId, userId), branchIds, created.value.id, toCompleted.value.version, { notes: 'x' }),
      ).rejects.toMatchObject({ code: 'invalid_reservation_state' });
    });
  });

  describe('HTTP layer: real, server-enforced permission checks', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      const readOnlyContext: AuthContext = {
        sessionId: randomUUID(),
        userId,
        membershipId: randomUUID(),
        companyId,
        branchId,
        expiresAt: new Date(Date.now() + 60_000),
        companyWideAccess: true,
        permissions: ['party.read'], // deliberately NO party.manage/party.cancel/party.payment.record
        permittedBranchIds: [branchId, otherBranchId],
      };
      const authentication = {
        authenticate: vi.fn(() => Promise.resolve(readOnlyContext)),
        requirePermission: vi.fn((_context: AuthContext, permission: string) => {
          if (!readOnlyContext.permissions.includes(permission))
            throw new AppError({ code: 'permission_denied', message: 'Permission denied.', statusCode: 403 });
        }),
        requireBranchAccess: vi.fn(() => undefined),
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
            meta: { request_id: request.requestContext.requestId, correlation_id: request.requestContext.correlationId },
          });
        return reply.code(500).send({ error: { code: 'internal_error', message: (error as Error).message } });
      });

      registerPartyRoomRoutes(app, authentication, rooms);
      registerPartyPackageRoutes(app, authentication, packages);
      registerPartyReservationRoutes(app, authentication, reservations);
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    it('rejects (403) creating a reservation when the actor lacks party.manage', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/party-reservations',
        headers: { authorization: 'Bearer x', 'idempotency-key': `http-create-${randomUUID()}`, 'content-type': 'application/json' },
        payload: {
          branch_id: branchId,
          room_id: roomA,
          package_id: packageId,
          event_date: '2027-01-01',
          start_time: '10:00',
          end_time: '12:00',
        },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json<{ error: { code: string } }>().error.code).toBe('permission_denied');
    });

    it('allows (200) reading a reservation when the actor has party.read', async () => {
      const createdDirectly = await reservations.createReservation(context(companyId, userId), branchIds, `http-fixture-${randomUUID()}`, {
        branchId,
        roomId: roomB,
        packageId,
        eventDate: '2027-01-02',
        startTime: '09:00',
        endTime: '10:00',
      });
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/party-reservations/${createdDirectly.value.id}`,
        headers: { authorization: 'Bearer x' },
      });
      expect(response.statusCode).toBe(200);
    });

    it('serves a real, printable HTML document over HTTP (raw text/html, not the JSON envelope)', async () => {
      const createdDirectly = await reservations.createReservation(context(companyId, userId), branchIds, `http-doc-fixture-${randomUUID()}`, {
        branchId,
        celebrantName: 'HttpCelebrant',
        roomId: roomB,
        packageId,
        eventDate: '2027-01-03',
        startTime: '09:00',
        endTime: '10:00',
      });
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/party-reservations/${createdDirectly.value.id}/documents/contract`,
        headers: { authorization: 'Bearer x' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('HttpCelebrant');
      expect(response.body).toContain('<html');
    });

    it('rejects (403) reading a room when the actor lacks party.read', async () => {
      const noReadContext: AuthContext = {
        sessionId: randomUUID(),
        userId,
        membershipId: randomUUID(),
        companyId,
        branchId,
        expiresAt: new Date(Date.now() + 60_000),
        companyWideAccess: true,
        permissions: [],
        permittedBranchIds: [branchId, otherBranchId],
      };
      const noReadAuthentication = {
        authenticate: vi.fn(() => Promise.resolve(noReadContext)),
        requirePermission: vi.fn((_context: AuthContext, permission: string) => {
          if (!noReadContext.permissions.includes(permission))
            throw new AppError({ code: 'permission_denied', message: 'Permission denied.', statusCode: 403 });
        }),
        requireBranchAccess: vi.fn(() => undefined),
      } as unknown as AuthService;
      const noReadApp = Fastify();
      noReadApp.addHook('onRequest', (request, _reply, done) => {
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
      noReadApp.setErrorHandler((error, request, reply) => {
        if (error instanceof AppError)
          return reply.code(error.statusCode).send({
            error: { code: error.code, message: error.message },
            meta: { request_id: request.requestContext.requestId, correlation_id: request.requestContext.correlationId },
          });
        return reply.code(500).send({ error: { code: 'internal_error', message: (error as Error).message } });
      });
      registerPartyRoomRoutes(noReadApp, noReadAuthentication, rooms);
      await noReadApp.ready();

      const response = await noReadApp.inject({ method: 'GET', url: `/api/v1/party-rooms/${roomA}`, headers: { authorization: 'Bearer x' } });
      expect(response.statusCode).toBe(403);
      await noReadApp.close();
    });
  });
});
