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
    await database.pool.query('delete from party_reservations where company_id=any($1)', [[companyId, otherCompanyId]]);
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
