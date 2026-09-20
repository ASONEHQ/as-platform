import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';

import { CustomersRepository } from '../customers/customers.repository.js';
import { CustomersService } from '../customers/customers.service.js';
import { PartiesRepository } from '../parties/parties.repository.js';
import type { PartyMutationContext } from '../parties/parties.types.js';
import { PartyPackagesService } from '../parties/party-packages.service.js';
import { PartyReservationsService } from '../parties/party-reservations.service.js';
import { PartyRoomsService } from '../parties/party-rooms.service.js';
import { PaymentRepository } from '../payments/payments.repository.js';
import { PaymentService } from '../payments/payments.service.js';
import { MercadoPagoClient } from '../payments/providers/mercado-pago.client.js';
import { MercadoPagoPointProvider } from '../payments/providers/mercado-pago.provider.js';
import { SalesRepository } from '../sales/sales.repository.js';
import { SalesService } from '../sales/sales.service.js';
import { CashRepository } from './cash.repository.js';
import { CashService } from './cash.service.js';
import type { CashMutationContext } from './cash.types.js';

/** TASK 16.13 — "Resumen operativo" (Ventas/Taquilla, Cafetería/Snacks,
 * Eventos/Fiestas) inside the partial cash cut. A dedicated file, separate
 * from `cash.integration.test.ts`, because this feature genuinely spans
 * three domains (cash, catalog, parties) and needs its own multi-domain
 * fixture set (a tagged Cafetería category, a party room/package/customer)
 * that would otherwise clutter that already-large suite. */
const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;

integration('PostgreSQL cash partial-close operational summary (TASK 16.13)', { concurrent: false }, () => {
  let database: DatabaseClient;
  let cash: CashService;
  let sales: SalesService;
  let payments: PaymentService;
  let rooms: PartyRoomsService;
  let packages: PartyPackagesService;
  let reservations: PartyReservationsService;
  let customers: CustomersService;

  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const branchId = randomUUID();
  const otherBranchId = randomUUID();
  const otherCompanyBranchId = randomUUID();
  const userId = randomUUID();
  const otherCompanyUserId = randomUUID();
  const branchIds = [branchId, otherBranchId];

  // Taquilla (plain, non-cafeteria) product.
  const taquillaProductId = randomUUID();
  // Cafetería category + product, tagged with the real, structured
  // `operational_group='cafeteria'` classification (TASK 16.13) — never
  // matched by name.
  const cafeteriaCategoryId = randomUUID();
  const cafeteriaProductId = randomUUID();

  let roomId: string;
  let packageId: string;
  let customerId: string;

  function cashContext(timestamp: Date): CashMutationContext {
    return {
      companyId,
      actorId: userId,
      requestId: `req-${randomUUID()}`,
      correlationId: `corr-${randomUUID()}`,
      timestamp,
    };
  }
  function partyContext(timestamp: Date): PartyMutationContext {
    return {
      companyId,
      actorId: userId,
      requestId: `req-${randomUUID()}`,
      correlationId: `corr-${randomUUID()}`,
      timestamp,
      deviceId: undefined,
    };
  }

  async function completedCashSale(
    timestamp: Date,
    productId: string,
    registerId: string,
  ): Promise<{ saleId: string }> {
    const ctx = cashContext(timestamp);
    const sale = await sales.createSale(ctx, branchIds, `sale-${randomUUID()}`, {
      branchId,
      items: [{ productId, quantity: '1' }],
    });
    await payments.createCashPayment(ctx, branchIds, `pay-${randomUUID()}`, {
      saleId: sale.value.sale.id,
      tenderedAmount: sale.value.sale.total,
      cashRegisterId: registerId,
    });
    return { saleId: sale.value.sale.id };
  }

  beforeAll(async () => {
    if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({ connectionString: databaseUrl, applicationName: 'asone-cash-opsummary-integration' });

    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'OpSummary Co','OpSummary Co',$2,'active','UTC','MXN','es-MX'),
             ($3,'Other OpSummary Co','Other OpSummary Co',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `opsum-${companyId}`, otherCompanyId, `opsum-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'OpSummary Main','OMAIN','active','UTC'),
             ($3,$2,'OpSummary Second','OSECOND','active','UTC'),
             ($4,$5,'OpSummary Other Co','OOTHER','active','UTC')`,
      [branchId, companyId, otherBranchId, otherCompanyBranchId, otherCompanyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'OpSummary Actor','active'),($3,$4,$4,'OpSummary Other Co User','active')`,
      [userId, `opsum-${userId}@example.test`, otherCompanyUserId, `opsum-${otherCompanyUserId}@example.test`],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status)
       values($1,$2,$3,'active'),($4,$5,$6,'active')`,
      [randomUUID(), companyId, userId, randomUUID(), otherCompanyId, otherCompanyUserId],
    );

    // Taquilla product — no category, so it is NEVER counted as Cafetería.
    await database.pool.query(
      `insert into products
       (id,company_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
       values($1,$2,'OPSUM-TAQUILLA','opsum-taquilla','Entrada General','simple',false,'IVA_EXEMPT','active',$3,$3)`,
      [taquillaProductId, companyId, userId],
    );
    await database.pool.query(
      `insert into product_prices (id,company_id,product_id,amount,currency_code,status,created_by,updated_by)
       values($1,$2,$3,'150.0000','MXN','active',$4,$4)`,
      [randomUUID(), companyId, taquillaProductId, userId],
    );

    // Cafetería category (TASK 16.13's real structured classification
    // anchor) + a product filed under it.
    await database.pool.query(
      `insert into product_categories
       (id,company_id,code,normalized_code,name,status,operational_group,created_by,updated_by)
       values($1,$2,'CAFETERIA','cafeteria','Cafetería','active','cafeteria',$3,$3)`,
      [cafeteriaCategoryId, companyId, userId],
    );
    await database.pool.query(
      `insert into products
       (id,company_id,category_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
       values($1,$2,$3,'OPSUM-SNACK','opsum-snack','Papas','simple',false,'IVA_EXEMPT','active',$4,$4)`,
      [cafeteriaProductId, companyId, cafeteriaCategoryId, userId],
    );
    await database.pool.query(
      `insert into product_prices (id,company_id,product_id,amount,currency_code,status,created_by,updated_by)
       values($1,$2,$3,'50.0000','MXN','active',$4,$4)`,
      [randomUUID(), companyId, cafeteriaProductId, userId],
    );

    const cashRepository = new CashRepository(database);
    cash = new CashService(cashRepository);
    const salesRepository = new SalesRepository(database);
    sales = new SalesService(salesRepository);
    const paymentRepository = new PaymentRepository(database);
    const mercadoPagoProvider = new MercadoPagoPointProvider(
      new MercadoPagoClient({ accessToken: undefined, apiBaseUrl: 'https://api.mercadopago.com' }),
    );
    payments = new PaymentService(paymentRepository, salesRepository, mercadoPagoProvider, cashRepository);

    const partiesRepository = new PartiesRepository(database);
    rooms = new PartyRoomsService(partiesRepository);
    packages = new PartyPackagesService(partiesRepository);
    reservations = new PartyReservationsService(partiesRepository, cashRepository);
    customers = new CustomersService(new CustomersRepository(database));

    const roomResult = await rooms.createRoom(partyContext(new Date('2026-09-01T00:00:00.000Z')), branchIds, `room-${randomUUID()}`, {
      branchId,
      code: 'SALON-OPSUM',
      name: 'Salón OpSummary',
      capacityChildren: 20,
      capacityAdults: 10,
    });
    roomId = roomResult.value.id;
    const packageResult = await packages.createPackage(
      partyContext(new Date('2026-09-01T00:00:00.000Z')),
      branchIds,
      `pkg-${randomUUID()}`,
      {
        branchId,
        code: 'OPSUM-PKG',
        name: 'Paquete OpSummary',
        price: '2000.0000',
        durationMinutes: 120,
        childrenIncluded: 10,
        adultsIncluded: 5,
        childExtraCost: '80.0000',
        adultExtraCost: '50.0000',
        extraHalfHourCost: '250.0000',
      },
    );
    packageId = packageResult.value.id;
    const customerResult = await customers.createCustomer(
      {
        companyId,
        actorId: userId,
        actorPermissions: ['customer.create'],
        requestId: 'r',
        correlationId: 'c',
        timestamp: new Date('2026-09-01T00:00:00.000Z'),
      },
      `cust-${randomUUID()}`,
      { firstName: 'Sofía', lastName: 'Domínguez', phone: '5559876543' },
    );
    customerId = customerResult.value.id;
  });

  afterAll(async () => {
    const companyIds = [companyId, otherCompanyId];
    await database.pool.query('delete from party_reservation_payments where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from party_reservations where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from party_packages where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from party_rooms where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from refund_items where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from refunds where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from payment_attempts where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from payments where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from sale_items where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from sales where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from cash_movements where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from cash_session_partial_closes where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from cash_sessions where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from cash_registers where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from customers where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from product_prices where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from products where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from product_categories where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from idempotency_keys where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from outbox_events where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from audit_log where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from company_memberships where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from branches where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from companies where id=any($1)', [companyIds]);
    await database.pool.query('delete from users where id=any($1)', [[userId, otherCompanyUserId]]);
    await database.close();
  });

  describe('deterministic multi-domain shift (TASK 16.13 §18)', () => {
    it(
      'reports POS/Cafetería/Eventos with no double counting, distinguishes sold-today from occurring-today, ' +
        'stays frozen on reload, and reflects new activity in a second cut',
      async () => {
        const register = await cash.createRegister(cashContext(new Date('2026-09-10T07:00:00.000Z')), branchIds, `reg-${randomUUID()}`, {
          branchId,
          code: `OPSUM-REG-${randomUUID().slice(0, 8)}`,
          name: 'Caja OpSummary',
        });
        const opened = await cash.openSession(cashContext(new Date('2026-09-10T08:00:00.000Z')), branchIds, `open-${randomUUID()}`, {
          cashRegisterId: register.value.id,
          openingAmount: '0',
        });

        // A reservation whose EVENT happens on the cut's own calendar day
        // (2026-09-10) but was booked well before the shift even opened —
        // must count toward `reservationsOccurringToday`, never toward
        // `reservationsCreated` (TASK 16.13 §8's explicit distinction).
        const earlyBooked = await reservations.createReservation(
          partyContext(new Date('2026-09-02T09:00:00.000Z')),
          branchIds,
          `res-early-${randomUUID()}`,
          {
            branchId,
            customerId,
            celebrantName: 'Booked Ahead',
            roomId,
            packageId,
            eventDate: '2026-09-10',
            startTime: '09:00',
            endTime: '11:00',
            childrenCount: 5,
          },
        );
        expect(earlyBooked.value.status).toBe('held');

        // --- Taquilla: 2 completed sales = $300 -----------------------
        await completedCashSale(new Date('2026-09-10T09:00:00.000Z'), taquillaProductId, register.value.id);
        await completedCashSale(new Date('2026-09-10T09:05:00.000Z'), taquillaProductId, register.value.id);

        // --- Cafetería: 3 sales = $150, an authoritatively-classified
        // SUBSET of the POS total above, never additive on top of it. ---
        await completedCashSale(new Date('2026-09-10T09:10:00.000Z'), cafeteriaProductId, register.value.id);
        await completedCashSale(new Date('2026-09-10T09:11:00.000Z'), cafeteriaProductId, register.value.id);
        await completedCashSale(new Date('2026-09-10T09:12:00.000Z'), cafeteriaProductId, register.value.id);

        // --- Eventos: 1 new reservation booked THIS shift, contract
        // $2,000, deposit $500 collected, $1,500 still outstanding. Event
        // date is far in the future — never "occurring today". ----------
        const created = await reservations.createReservation(
          partyContext(new Date('2026-09-10T09:15:00.000Z')),
          branchIds,
          `res-new-${randomUUID()}`,
          {
            branchId,
            customerId,
            celebrantName: 'Mateo',
            celebrantAge: 8,
            roomId,
            packageId,
            eventDate: '2026-12-25',
            startTime: '10:00',
            endTime: '12:00',
            childrenCount: 10,
          },
        );
        expect(created.value.quotedTotal).toBe('2000.0000');
        await reservations.recordPayment(partyContext(new Date('2026-09-10T09:16:00.000Z')), branchIds, `dep-${randomUUID()}`, created.value.id, {
          purpose: 'deposit',
          amount: '500.0000',
          cashSessionId: opened.value.id,
        });
        const balance = await reservations.balance(companyId, branchIds, created.value.id);
        expect(balance.outstandingBalance).toBe('1500.0000');

        // --- First partial close ----------------------------------------
        const cut1 = await cash.partialClose(cashContext(new Date('2026-09-10T09:20:00.000Z')), branchIds, `cut1-${randomUUID()}`, opened.value.id);
        const summary1 = cut1.value.operationalSummary;
        expect(summary1).not.toBeNull();
        if (summary1 === null) throw new Error('unreachable');

        // POS: gross includes BOTH taquilla and cafetería sales (they are
        // the same `sales` domain) — 300 + 150 = 450.
        expect(summary1.pos.grossSales).toBe('450.0000');
        expect(summary1.pos.netSales).toBe('450.0000');
        expect(summary1.pos.ticketCount).toBe(5);

        // Cafetería is a SUBSET, not additive: 150 out of the 450 above.
        expect(summary1.cafeteria.available).toBe(true);
        expect(summary1.cafeteria.netSales).toBe('150.0000');
        expect(summary1.cafeteria.ticketCount).toBe(3);
        expect(summary1.cafeteria.unitsSold).toBe('3.000000');

        // Events: genuinely independent of pos/cafeteria — never summed
        // into `pos.grossSales` (450 stays 450, not 450+500=950).
        expect(summary1.events.reservationsCreated).toBe(1);
        expect(summary1.events.contractedValue).toBe('2000.0000');
        expect(summary1.events.collectedForNewReservations).toBe('500.0000');
        expect(summary1.events.outstandingForNewReservations).toBe('1500.0000');
        expect(summary1.events.depositsCollected).toBe('500.0000');
        expect(summary1.events.totalCollected).toBe('500.0000');
        expect(summary1.events.cancelledCount).toBe(0);
        // The early-booked reservation (created well before the window,
        // so excluded from `reservationsCreated` above) has an event date
        // matching the cut's own calendar day — the newly-created
        // reservation's event date is 2026-12-25, not today, so only the
        // early-booked one counts here. Proves "sold today" and
        // "occurring today" are genuinely different metrics (TASK 16.13
        // §8).
        expect(summary1.events.reservationsOccurringToday).toBe(1);

        // --- Immutability: reload the same cut, must be byte-identical ---
        const historyBeforeMore = await cash.partialCloses(companyId, branchIds, opened.value.id);
        const reread1 = historyBeforeMore.find((item) => item.id === cut1.value.id);
        expect(reread1?.operationalSummary).toEqual(summary1);

        // --- More activity AFTER the first cut ---------------------------
        await completedCashSale(new Date('2026-09-10T09:30:00.000Z'), taquillaProductId, register.value.id);

        // The FIRST cut, reread again, must remain frozen at its original
        // numbers — never recalculated from the new sale above.
        const historyAfterMore = await cash.partialCloses(companyId, branchIds, opened.value.id);
        const reread1Again = historyAfterMore.find((item) => item.id === cut1.value.id);
        expect(reread1Again?.operationalSummary?.pos.grossSales).toBe('450.0000');

        // --- Second partial close reflects the new activity --------------
        const cut2 = await cash.partialClose(cashContext(new Date('2026-09-10T09:40:00.000Z')), branchIds, `cut2-${randomUUID()}`, opened.value.id);
        const summary2 = cut2.value.operationalSummary;
        expect(summary2).not.toBeNull();
        expect(summary2?.pos.grossSales).toBe('600.0000');
        expect(summary2?.pos.ticketCount).toBe(6);
        // Cafetería subset is unchanged (the new sale was a taquilla item).
        expect(summary2?.cafeteria.netSales).toBe('150.0000');
      },
    );
  });

  describe('refunds and cancellations net out, never double count (TASK 16.13 §16/§17)', () => {
    it('a completed refund nets out of both POS and Cafetería net sales, gross stays reported separately', async () => {
      const register = await cash.createRegister(cashContext(new Date('2026-09-11T07:00:00.000Z')), branchIds, `reg-${randomUUID()}`, {
        branchId,
        code: `OPSUM-REFUND-REG-${randomUUID().slice(0, 8)}`,
        name: 'Caja Devoluciones',
      });
      const opened = await cash.openSession(cashContext(new Date('2026-09-11T08:00:00.000Z')), branchIds, `open-${randomUUID()}`, {
        cashRegisterId: register.value.id,
        openingAmount: '0',
      });

      const ctx = cashContext(new Date('2026-09-11T09:00:00.000Z'));
      const sale = await sales.createSale(ctx, branchIds, `sale-${randomUUID()}`, {
        branchId,
        items: [{ productId: cafeteriaProductId, quantity: '1' }],
      });
      const payment = await payments.createCashPayment(ctx, branchIds, `pay-${randomUUID()}`, {
        saleId: sale.value.sale.id,
        tenderedAmount: sale.value.sale.total,
        cashRegisterId: register.value.id,
      });
      const saleItemRow = await database.pool.query<{ id: string; subtotal: string; tax_total: string; line_total: string }>(
        'select id,subtotal,tax_total,line_total from sale_items where sale_id=$1',
        [sale.value.sale.id],
      );
      const saleItemId = saleItemRow.rows[0]?.id;
      if (saleItemId === undefined) throw new Error('sale item not found');

      // Directly insert a completed refund — this suite is exercising
      // the CASH module's own read of `refunds`/`refund_items`, not the
      // refunds workflow itself (already covered by `refunds.
      // integration.test.ts`), mirroring this file's own convention of
      // raw-SQL supporting fixtures for anything not under test.
      const refundId = randomUUID();
      await database.pool.query(
        `insert into refunds
         (id,company_id,branch_id,sale_id,cash_session_id,payment_id,refund_number,status,refund_method,
          reason_code,currency_code,subtotal,tax_total,total,occurred_at,completed_at,created_by)
         values ($1,$2,$3,$4,$5,$6,$7,'completed','cash','customer_request','MXN',$8,$9,$10,$11,$11,$12)`,
        [
          refundId,
          companyId,
          branchId,
          sale.value.sale.id,
          opened.value.id,
          payment.value.payment.id,
          `REF-${refundId.slice(0, 8)}`,
          sale.value.sale.subtotal,
          sale.value.sale.taxTotal,
          sale.value.sale.total,
          new Date('2026-09-11T09:05:00.000Z'),
          userId,
        ],
      );
      await database.pool.query(
        `insert into refund_items (id,company_id,branch_id,refund_id,sale_item_id,quantity,subtotal,tax_total,line_total,restock_disposition)
         values ($1,$2,$3,$4,$5,'1',$6,$7,$8,'no_restock')`,
        [randomUUID(), companyId, branchId, refundId, saleItemId, saleItemRow.rows[0]?.subtotal, saleItemRow.rows[0]?.tax_total, saleItemRow.rows[0]?.line_total],
      );

      const cut = await cash.partialClose(cashContext(new Date('2026-09-11T09:10:00.000Z')), branchIds, `cut-${randomUUID()}`, opened.value.id);
      const summary = cut.value.operationalSummary;
      expect(summary?.pos.grossSales).toBe('50.0000');
      expect(summary?.pos.refundsTotal).toBe('50.0000');
      expect(summary?.pos.netSales).toBe('0.0000');
      expect(summary?.cafeteria.grossSales).toBe('50.0000');
      expect(summary?.cafeteria.refundsTotal).toBe('50.0000');
      expect(summary?.cafeteria.netSales).toBe('0.0000');

      await database.pool.query('delete from refund_items where refund_id=$1', [refundId]);
      await database.pool.query('delete from refunds where id=$1', [refundId]);
    });

    it('a reservation cancelled within the window is excluded from contracted value but counted in cancelledCount', async () => {
      const register = await cash.createRegister(cashContext(new Date('2026-09-12T07:00:00.000Z')), branchIds, `reg-${randomUUID()}`, {
        branchId,
        code: `OPSUM-CANCEL-REG-${randomUUID().slice(0, 8)}`,
        name: 'Caja Cancelaciones',
      });
      const opened = await cash.openSession(cashContext(new Date('2026-09-12T08:00:00.000Z')), branchIds, `open-${randomUUID()}`, {
        cashRegisterId: register.value.id,
        openingAmount: '0',
      });
      const created = await reservations.createReservation(
        partyContext(new Date('2026-09-12T08:30:00.000Z')),
        branchIds,
        `res-cancel-${randomUUID()}`,
        {
          branchId,
          customerId,
          celebrantName: 'Cancelled Party',
          roomId,
          packageId,
          eventDate: '2027-01-15',
          startTime: '10:00',
          endTime: '12:00',
          childrenCount: 8,
        },
      );
      await reservations.cancelReservation(
        partyContext(new Date('2026-09-12T08:45:00.000Z')),
        branchIds,
        `cancel-${randomUUID()}`,
        created.value.id,
        created.value.version,
        { reasonCode: 'Cliente canceló' },
      );

      const cut = await cash.partialClose(cashContext(new Date('2026-09-12T09:00:00.000Z')), branchIds, `cut-${randomUUID()}`, opened.value.id);
      const summary = cut.value.operationalSummary;
      // Excluded from contracted value — a cancelled booking is not real
      // contracted revenue (TASK 16.13 §16).
      expect(summary?.events.contractedValue).toBe('0.0000');
      expect(summary?.events.reservationsCreated).toBe(0);
      expect(summary?.events.cancelledCount).toBe(1);
    });

    it('an event deposit is never reflected in POS/Cafetería sales — proven with zero POS activity in the window', async () => {
      const register = await cash.createRegister(cashContext(new Date('2026-09-13T07:00:00.000Z')), branchIds, `reg-${randomUUID()}`, {
        branchId,
        code: `OPSUM-ISOLATED-REG-${randomUUID().slice(0, 8)}`,
        name: 'Caja Aislada',
      });
      const opened = await cash.openSession(cashContext(new Date('2026-09-13T08:00:00.000Z')), branchIds, `open-${randomUUID()}`, {
        cashRegisterId: register.value.id,
        openingAmount: '0',
      });
      const created = await reservations.createReservation(
        partyContext(new Date('2026-09-13T08:30:00.000Z')),
        branchIds,
        `res-isolated-${randomUUID()}`,
        {
          branchId,
          customerId,
          celebrantName: 'Isolated Party',
          roomId,
          packageId,
          eventDate: '2027-02-01',
          startTime: '10:00',
          endTime: '12:00',
          childrenCount: 4,
        },
      );
      await reservations.recordPayment(partyContext(new Date('2026-09-13T08:35:00.000Z')), branchIds, `dep-${randomUUID()}`, created.value.id, {
        purpose: 'deposit',
        amount: '750.0000',
        cashSessionId: opened.value.id,
      });

      const cut = await cash.partialClose(cashContext(new Date('2026-09-13T09:00:00.000Z')), branchIds, `cut-${randomUUID()}`, opened.value.id);
      const summary = cut.value.operationalSummary;
      // The $750 deposit shows up as event cash collected...
      expect(summary?.events.depositsCollected).toBe('750.0000');
      expect(summary?.events.totalCollected).toBe('750.0000');
      // ...and, since it posts through `cash_movements` (not `sales`), the
      // session's own cash-truth total sees it too (this is the SAME real
      // cash-in fact, viewed from the drawer side).
      expect(cut.value.cashInTotal).toBe('750.0000');
      // ...but NEVER as a POS or Cafetería sale — proving the two domains
      // are structurally disjoint, not merely coincidentally non-
      // overlapping in the bigger scenario above.
      expect(summary?.pos.grossSales).toBe('0.0000');
      expect(summary?.pos.ticketCount).toBe(0);
      expect(summary?.cafeteria.grossSales).toBe('0.0000');
    });
  });

  describe('tenant/branch isolation (TASK 16.13 §14)', () => {
    it("never includes another branch's or another company's POS/events activity", async () => {
      // Activity in a DIFFERENT branch of the SAME company.
      const otherBranchRegister = await cash.createRegister(
        cashContext(new Date('2026-09-14T07:00:00.000Z')),
        branchIds,
        `reg-${randomUUID()}`,
        { branchId: otherBranchId, code: `OPSUM-OTHERBRANCH-REG-${randomUUID().slice(0, 8)}`, name: 'Caja Otra Sucursal' },
      );
      await sales.createSale(cashContext(new Date('2026-09-14T08:30:00.000Z')), branchIds, `sale-${randomUUID()}`, {
        branchId: otherBranchId,
        items: [{ productId: taquillaProductId, quantity: '1' }],
      });
      const otherBranchRoom = await rooms.createRoom(partyContext(new Date('2026-09-14T07:00:00.000Z')), branchIds, `room-otherbranch-${randomUUID()}`, {
        branchId: otherBranchId,
        code: 'SALON-OTHERBRANCH',
        name: 'Salón Otra Sucursal',
      });
      const otherBranchPackage = await packages.createPackage(
        partyContext(new Date('2026-09-14T07:00:00.000Z')),
        branchIds,
        `pkg-otherbranch-${randomUUID()}`,
        {
          branchId: otherBranchId,
          code: 'OTHERBRANCH-PKG',
          name: 'Paquete Otra Sucursal',
          price: '1000.0000',
          durationMinutes: 60,
          childrenIncluded: 5,
          adultsIncluded: 2,
          childExtraCost: '50.0000',
          adultExtraCost: '30.0000',
          extraHalfHourCost: '100.0000',
        },
      );
      await reservations.createReservation(partyContext(new Date('2026-09-14T08:31:00.000Z')), branchIds, `res-otherbranch-${randomUUID()}`, {
        branchId: otherBranchId,
        customerId,
        celebrantName: 'Other Branch Party',
        roomId: otherBranchRoom.value.id,
        packageId: otherBranchPackage.value.id,
        eventDate: '2027-03-01',
        startTime: '10:00',
        endTime: '12:00',
        childrenCount: 3,
      });

      // Activity in a DIFFERENT company entirely.
      const otherCompanyContext: CashMutationContext = {
        companyId: otherCompanyId,
        actorId: otherCompanyUserId,
        requestId: `req-${randomUUID()}`,
        correlationId: `corr-${randomUUID()}`,
        timestamp: new Date('2026-09-14T07:00:00.000Z'),
      };
      const otherCompanyProductId = randomUUID();
      await database.pool.query(
        `insert into products (id,company_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
         values($1,$2,'OTHERCO-PRODUCT','otherco-product','Other Co Product','simple',false,'IVA_EXEMPT','active',$3,$3)`,
        [otherCompanyProductId, otherCompanyId, otherCompanyUserId],
      );
      await database.pool.query(
        `insert into product_prices (id,company_id,product_id,amount,currency_code,status,created_by,updated_by)
         values($1,$2,$3,'999.0000','MXN','active',$4,$4)`,
        [randomUUID(), otherCompanyId, otherCompanyProductId, otherCompanyUserId],
      );
      await sales.createSale(otherCompanyContext, [otherCompanyBranchId], `sale-${randomUUID()}`, {
        branchId: otherCompanyBranchId,
        items: [{ productId: otherCompanyProductId, quantity: '1' }],
      });

      // Now open a session in THIS test's own `branchId` and confirm its
      // partial close sees none of the above.
      const register = await cash.createRegister(cashContext(new Date('2026-09-14T07:00:00.000Z')), branchIds, `reg-${randomUUID()}`, {
        branchId,
        code: `OPSUM-ISO-REG-${randomUUID().slice(0, 8)}`,
        name: 'Caja Aislamiento',
      });
      const opened = await cash.openSession(cashContext(new Date('2026-09-14T08:00:00.000Z')), branchIds, `open-${randomUUID()}`, {
        cashRegisterId: register.value.id,
        openingAmount: '0',
      });
      const cut = await cash.partialClose(cashContext(new Date('2026-09-14T09:00:00.000Z')), branchIds, `cut-${randomUUID()}`, opened.value.id);
      const summary = cut.value.operationalSummary;
      expect(summary?.pos.grossSales).toBe('0.0000');
      expect(summary?.pos.ticketCount).toBe(0);
      expect(summary?.events.reservationsCreated).toBe(0);

      await database.pool.query('delete from sale_items where company_id=$1 and branch_id=$2', [otherCompanyId, otherCompanyBranchId]);
      await database.pool.query('delete from sales where company_id=$1 and branch_id=$2', [otherCompanyId, otherCompanyBranchId]);
      await database.pool.query('delete from product_prices where product_id=$1', [otherCompanyProductId]);
      await database.pool.query('delete from products where id=$1', [otherCompanyProductId]);
      await database.pool.query('delete from cash_registers where id=$1', [otherBranchRegister.value.id]);
    });
  });

  describe('structural honesty when Cafetería is not configured (TASK 16.13 §7)', () => {
    it('reports cafeteria.available=false for a company with no operational_group=cafeteria category, never a misleading $0', async () => {
      const otherCompanyContext: CashMutationContext = {
        companyId: otherCompanyId,
        actorId: otherCompanyUserId,
        requestId: `req-${randomUUID()}`,
        correlationId: `corr-${randomUUID()}`,
        timestamp: new Date('2026-09-15T07:00:00.000Z'),
      };
      const otherCompanyBranchIds = [otherCompanyBranchId];
      const otherCompanyCashRepository = new CashRepository(database);
      const otherCompanyCash = new CashService(otherCompanyCashRepository);
      const register = await otherCompanyCash.createRegister(otherCompanyContext, otherCompanyBranchIds, `reg-${randomUUID()}`, {
        branchId: otherCompanyBranchId,
        code: `OPSUM-NOCAT-REG-${randomUUID().slice(0, 8)}`,
        name: 'Caja Sin Cafetería',
      });
      const opened = await otherCompanyCash.openSession(
        { ...otherCompanyContext, timestamp: new Date('2026-09-15T08:00:00.000Z') },
        otherCompanyBranchIds,
        `open-${randomUUID()}`,
        { cashRegisterId: register.value.id, openingAmount: '0' },
      );
      const cut = await otherCompanyCash.partialClose(
        { ...otherCompanyContext, timestamp: new Date('2026-09-15T09:00:00.000Z') },
        otherCompanyBranchIds,
        `cut-${randomUUID()}`,
        opened.value.id,
      );
      expect(cut.value.operationalSummary?.cafeteria.available).toBe(false);
      expect(cut.value.operationalSummary?.cafeteria.netSales).toBe('0.0000');
    });
  });

  describe('old partial-close compatibility (TASK 16.13 §13)', () => {
    it('a pre-TASK-16.13 row with no operational_summary reads back as operationalSummary: null, never crashes', async () => {
      const register = await cash.createRegister(cashContext(new Date('2026-09-16T07:00:00.000Z')), branchIds, `reg-${randomUUID()}`, {
        branchId,
        code: `OPSUM-LEGACY-REG-${randomUUID().slice(0, 8)}`,
        name: 'Caja Legacy',
      });
      const opened = await cash.openSession(cashContext(new Date('2026-09-16T08:00:00.000Z')), branchIds, `open-${randomUUID()}`, {
        cashRegisterId: register.value.id,
        openingAmount: '0',
      });
      // Simulates a row inserted before this column existed — never
      // synthesized by the application code path.
      const legacyId = randomUUID();
      await database.pool.query(
        `insert into cash_session_partial_closes
         (id,company_id,branch_id,cash_session_id,taken_at,opening_amount,cash_sales_total,cash_in_total,cash_out_total,expected_cash,created_by,created_at)
         values ($1,$2,$3,$4,$5,'0','0','0','0','0',$6,$5)`,
        [legacyId, companyId, branchId, opened.value.id, new Date('2026-09-16T08:30:00.000Z'), userId],
      );
      const history = await cash.partialCloses(companyId, branchIds, opened.value.id);
      const legacyRow = history.find((item) => item.id === legacyId);
      expect(legacyRow).toBeDefined();
      expect(legacyRow?.operationalSummary).toBeNull();
    });
  });
});
