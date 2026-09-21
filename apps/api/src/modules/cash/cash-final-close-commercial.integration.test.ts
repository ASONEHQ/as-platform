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
import { RefundsRepository } from '../refunds/refunds.repository.js';
import { RefundsService } from '../refunds/refunds.service.js';
import type { RefundMutationContext } from '../refunds/refunds.types.js';
import { SalesRepository } from '../sales/sales.repository.js';
import { SalesService } from '../sales/sales.service.js';
import { CashRepository } from './cash.repository.js';
import { CashService } from './cash.service.js';
import type { CashMutationContext } from './cash.types.js';

/** TASK 16.14 — "CERRAR CAJA" complete commercial final close: the
 * frozen financial + payment-method + operational (Taquilla/Cafetería/
 * Eventos) snapshot, the optional discrepancy reason, and every
 * no-double-count/backward-compatibility guarantee this task requires.
 * A dedicated file, separate from `cash.integration.test.ts`/
 * `cash-operational-summary.integration.test.ts`/`cash-e2e.integration.
 * test.ts`, because this feature spans cash+sales+refunds+parties and
 * needs its own multi-domain fixture set (a Cafetería category, a card
 * product, a refundable product, a party room/package/customer). */
const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;

integration('PostgreSQL cash final-close commercial summary (TASK 16.14)', { concurrent: false }, () => {
  let database: DatabaseClient;
  let cash: CashService;
  let sales: SalesService;
  let payments: PaymentService;
  let refunds: RefundsService;
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

  // Taquilla (plain, non-cafeteria) cash-payable product.
  const cashProductId = randomUUID();
  // A card-payable product (same price shape, different tender).
  const cardProductId = randomUUID();
  // Cafetería category + product, real structured classification.
  const cafeteriaCategoryId = randomUUID();
  const cafeteriaProductId = randomUUID();
  // A refundable product, sold and then refunded within the shift.
  const refundableProductId = randomUUID();

  let roomId: string;
  let packageId: string;
  let customerId: string;

  function cashContext(timestamp: Date): CashMutationContext {
    return { companyId, actorId: userId, requestId: `req-${randomUUID()}`, correlationId: `corr-${randomUUID()}`, timestamp };
  }
  function partyContext(timestamp: Date): PartyMutationContext {
    return { companyId, actorId: userId, requestId: `req-${randomUUID()}`, correlationId: `corr-${randomUUID()}`, timestamp, deviceId: undefined };
  }
  function refundContext(timestamp: Date): RefundMutationContext {
    return {
      companyId,
      actorId: userId,
      actorPermissions: ['refund.create', 'refund.approve', 'refund.complete', 'refund.read'],
      requestId: `req-${randomUUID()}`,
      correlationId: `corr-${randomUUID()}`,
      timestamp,
    };
  }

  async function cashSale(timestamp: Date, productId: string, registerId: string): Promise<{ saleId: string }> {
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
  async function cardSale(timestamp: Date, productId: string): Promise<{ saleId: string }> {
    const ctx = cashContext(timestamp);
    const sale = await sales.createSale(ctx, branchIds, `sale-${randomUUID()}`, {
      branchId,
      items: [{ productId, quantity: '1' }],
    });
    const created = await payments.createPayment(ctx, branchIds, `pay-${randomUUID()}`, {
      branchId,
      saleId: sale.value.sale.id,
      paymentMethod: 'card_manual',
      amount: sale.value.sale.total,
      currencyCode: 'MXN',
    });
    await payments.transitionAttempt(ctx, branchIds, created.value.attempt.id, `approve-${randomUUID()}`, { status: 'approved' });
    return { saleId: sale.value.sale.id };
  }

  beforeAll(async () => {
    if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({ connectionString: databaseUrl, applicationName: 'asone-cash-final-close-integration' });

    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'FinalClose Co','FinalClose Co',$2,'active','UTC','MXN','es-MX'),
             ($3,'Other FinalClose Co','Other FinalClose Co',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `finclose-${companyId}`, otherCompanyId, `finclose-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'FinalClose Main','FMAIN','active','America/Mexico_City'),
             ($3,$2,'FinalClose Second','FSECOND','active','UTC'),
             ($4,$5,'FinalClose Other Co','FOTHER','active','UTC')`,
      [branchId, companyId, otherBranchId, otherCompanyBranchId, otherCompanyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'FinalClose Actor','active'),($3,$4,$4,'FinalClose Other Co User','active')`,
      [userId, `finclose-${userId}@example.test`, otherCompanyUserId, `finclose-${otherCompanyUserId}@example.test`],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status) values($1,$2,$3,'active'),($4,$5,$6,'active')`,
      [randomUUID(), companyId, userId, randomUUID(), otherCompanyId, otherCompanyUserId],
    );

    await database.pool.query(
      `insert into products
       (id,company_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
       values($1,$2,'FIN-CASH','fin-cash','Entrada General','simple',false,'IVA_EXEMPT','active',$3,$3),
             ($4,$2,'FIN-CARD','fin-card','Entrada Premium','simple',false,'IVA_EXEMPT','active',$3,$3),
             ($5,$2,'FIN-REFUND','fin-refund','Souvenir','simple',false,'IVA_EXEMPT','active',$3,$3)`,
      [cashProductId, companyId, userId, cardProductId, refundableProductId],
    );
    await database.pool.query(
      `insert into product_prices (id,company_id,product_id,amount,currency_code,status,created_by,updated_by)
       values($1,$2,$3,'100.0000','MXN','active',$4,$4),
             ($5,$2,$6,'200.0000','MXN','active',$4,$4),
             ($7,$2,$8,'25.0000','MXN','active',$4,$4)`,
      [randomUUID(), companyId, cashProductId, userId, randomUUID(), cardProductId, randomUUID(), refundableProductId],
    );
    await database.pool.query(
      `insert into product_categories
       (id,company_id,code,normalized_code,name,status,operational_group,created_by,updated_by)
       values($1,$2,'FIN-CAFE','fin-cafe','Cafetería','active','cafeteria',$3,$3)`,
      [cafeteriaCategoryId, companyId, userId],
    );
    await database.pool.query(
      `insert into products
       (id,company_id,category_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
       values($1,$2,$3,'FIN-SNACK','fin-snack','Palomitas','simple',false,'IVA_EXEMPT','active',$4,$4)`,
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
    const refundsRepository = new RefundsRepository(database);
    refunds = new RefundsService(refundsRepository, paymentRepository, cashRepository, mercadoPagoProvider);

    const partiesRepository = new PartiesRepository(database);
    rooms = new PartyRoomsService(partiesRepository);
    packages = new PartyPackagesService(partiesRepository);
    reservations = new PartyReservationsService(partiesRepository, cashRepository);
    customers = new CustomersService(new CustomersRepository(database));

    const roomResult = await rooms.createRoom(partyContext(new Date('2026-09-01T00:00:00.000Z')), branchIds, `room-${randomUUID()}`, {
      branchId,
      code: 'SALON-FIN',
      name: 'Salón FinalClose',
      capacityChildren: 20,
      capacityAdults: 10,
    });
    roomId = roomResult.value.id;
    const packageResult = await packages.createPackage(partyContext(new Date('2026-09-01T00:00:00.000Z')), branchIds, `pkg-${randomUUID()}`, {
      branchId,
      code: 'FIN-PKG',
      name: 'Paquete FinalClose',
      price: '1000.0000',
      durationMinutes: 120,
      childrenIncluded: 10,
      adultsIncluded: 5,
      childExtraCost: '80.0000',
      adultExtraCost: '50.0000',
      extraHalfHourCost: '250.0000',
    });
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
      { firstName: 'Renata', lastName: 'Flores', phone: '5551234567' },
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

  describe('deterministic full-shift commercial close (TASK 16.14 §23)', () => {
    it(
      'carries a real shift (cash+card+cafetería sales, cash in/out, a cash refund, an event deposit, a partial ' +
        'cut, an intentional $5 discrepancy with a reason) through close with exact numbers, then survives reload, ' +
        'history, and a later category reassignment unchanged',
      async () => {
        // NOTE on the task's own suggested scenario: it lists a "Transfer
        // sale: 75" line, but this codebase's `payments.payment_method`
        // has no `transfer` value at all (`cash|card_terminal|card_manual|
        // other` — confirmed by forensic audit; the POS's own "Transfer"
        // button is a documented no-op, see `pos_shell.dart`'s
        // `_PosPayGrid`). Substituted with a `card_manual` $75 sale
        // instead of fabricating a payment method nothing in this
        // codebase can actually produce — see this task's own
        // `docs/LEGACY_FUNCTIONAL_PARITY.md` section for the full
        // explanation. Exact values used, all in MXN:
        //   opening float:        500
        //   cash Taquilla sale:   100
        //   cash Cafetería sale:   50
        //   card sale (premium): 200
        //   manual cash in:       +20
        //   manual cash out:      -10
        //   cash refund:          -25 (refunding the $50 cafetería sale, partial $25)
        //   event cash deposit:   +300 (posts cash_in, never a sale)
        //   declared/counted:  expected + 5 (an intentional surplus)
        const register = await cash.createRegister(cashContext(new Date('2026-09-15T07:00:00.000Z')), branchIds, `reg-${randomUUID()}`, {
          branchId,
          code: `FIN-REG-${randomUUID().slice(0, 8)}`,
          name: 'Caja FinalClose',
        });
        const opened = await cash.openSession(cashContext(new Date('2026-09-15T08:00:00.000Z')), branchIds, `open-${randomUUID()}`, {
          cashRegisterId: register.value.id,
          openingAmount: '500.0000',
        });

        // Cash Taquilla sale — $100.
        await cashSale(new Date('2026-09-15T09:00:00.000Z'), cashProductId, register.value.id);
        // Cash Cafetería sale — $50 (will be partially refunded below).
        const { saleId: cafeteriaSaleId } = await cashSale(new Date('2026-09-15T09:05:00.000Z'), cafeteriaProductId, register.value.id);
        // One card sale — $200 — never touching the drawer at all.
        await cardSale(new Date('2026-09-15T09:10:00.000Z'), cardProductId);

        // Manual cash in/out.
        await cash.createMovement(cashContext(new Date('2026-09-15T09:20:00.000Z')), branchIds, `in-${randomUUID()}`, opened.value.id, {
          movementType: 'cash_in',
          amount: '20.0000',
          reasonCode: 'found_change',
          category: 'other',
        });
        await cash.createMovement(cashContext(new Date('2026-09-15T09:21:00.000Z')), branchIds, `out-${randomUUID()}`, opened.value.id, {
          movementType: 'cash_out',
          amount: '10.0000',
          reasonCode: 'expense',
          category: 'expense',
        });

        // Cash refund — partial refund of the $50 cafetería sale, $25.
        const cafeteriaSaleDetail = await sales.sale(companyId, branchIds, cafeteriaSaleId);
        const cafeteriaLine = cafeteriaSaleDetail.items[0];
        if (cafeteriaLine === undefined) throw new Error('unreachable');
        const refundCreated = await refunds.createRefund(refundContext(new Date('2026-09-15T09:30:00.000Z')), branchIds, `refund-${randomUUID()}`, {
          saleId: cafeteriaSaleId,
          reasonCode: 'customer_changed_mind',
          items: [{ saleItemId: cafeteriaLine.id, quantity: '0.5' }],
        });
        expect(refundCreated.value.status).toBe('approved');
        const refundCompleted = await refunds.completeRefund(
          refundContext(new Date('2026-09-15T09:31:00.000Z')),
          branchIds,
          `refund-complete-${randomUUID()}`,
          refundCreated.value.id,
          { cashRegisterId: register.value.id },
        );
        expect(refundCompleted.value.status).toBe('completed');
        expect(refundCompleted.value.refundMethod).toBe('cash');
        expect(refundCompleted.value.total).toBe('25.0000');

        // Event deposit — cash, posts cash_in with reference_type
        // 'party_reservation', NEVER a sales/sale_items row.
        const reservation = await reservations.createReservation(partyContext(new Date('2026-09-15T09:35:00.000Z')), branchIds, `res-${randomUUID()}`, {
          branchId,
          customerId,
          celebrantName: 'Ximena',
          celebrantAge: 7,
          roomId,
          packageId,
          eventDate: '2026-12-20',
          startTime: '10:00',
          endTime: '12:00',
          childrenCount: 8,
        });
        await reservations.recordPayment(partyContext(new Date('2026-09-15T09:36:00.000Z')), branchIds, `dep-${randomUUID()}`, reservation.value.id, {
          purpose: 'deposit',
          amount: '300.0000',
          cashSessionId: opened.value.id,
        });

        // Partial cut — must NOT mutate the session or block further
        // activity.
        const cut = await cash.partialClose(cashContext(new Date('2026-09-15T09:40:00.000Z')), branchIds, `cut-${randomUUID()}`, opened.value.id);
        expect(cut.value.operationalSummary).not.toBeNull();
        const sessionAfterCut = await cash.session(companyId, branchIds, opened.value.id);
        expect(sessionAfterCut.status).toBe('open');

        // Expected cash: 500 (open) + 100 (cash sale) + 50 (cafetería
        // sale) + 20 (cash in) − 10 (cash out) − 25 (cash refund) + 300
        // (event deposit, itself a cash_in movement) = 935.
        const summaryBeforeClose = await cash.summary(companyId, branchIds, opened.value.id);
        expect(summaryBeforeClose.expectedCash).toBe('935.0000');
        expect(summaryBeforeClose.cashRefundTotal).toBe('25.0000');
        expect(summaryBeforeClose.cashRefundCount).toBe(1);

        // Intentional $5 surplus, with a required-by-commercial-practice
        // (but never backend-enforced) reason.
        const closed = await cash.closeSession(cashContext(new Date('2026-09-15T18:00:00.000Z')), branchIds, `close-${randomUUID()}`, opened.value.id, {
          declaredClosingAmount: '940.0000',
          discrepancyReason: 'Propina en efectivo no registrada como venta.',
        });
        expect(closed.value).toMatchObject({
          status: 'closed',
          expectedClosingAmount: '935.0000',
          declaredClosingAmount: '940.0000',
          discrepancyAmount: '5.0000',
          discrepancyReason: 'Propina en efectivo no registrada como venta.',
        });

        // Frozen financial breakdown, persisted on the row itself.
        expect(closed.value).toMatchObject({
          cashSalesTotal: '150.0000', // 100 + 50
          cashSalesCount: 2,
          cashInTotal: '320.0000', // 20 (manual) + 300 (event deposit)
          cashOutTotal: '10.0000',
          expenseTotal: '10.0000',
          cashRefundTotal: '25.0000',
          cashRefundCount: 1,
        });

        // Payment-method totals — real `payments` totals, NEVER derived
        // from cash_movements. Cash gross = 100+50=150 (the two cash
        // sales), refunds=25 (the cash refund), net=125. Card gross = 200
        // (the one captured card sale).
        const cashMethod = closed.value.paymentMethodTotals?.find((line) => line.method === 'cash');
        const cardMethod = closed.value.paymentMethodTotals?.find((line) => line.method === 'card_manual');
        expect(cashMethod).toMatchObject({ grossSalesTotal: '150.0000', refundsTotal: '25.0000', netTotal: '125.0000', ticketCount: 2 });
        expect(cardMethod).toMatchObject({ grossSalesTotal: '200.0000', ticketCount: 1 });
        // No fabricated "transfer" line — nothing in this scenario ever
        // produced one, and none should ever silently appear.
        expect(closed.value.paymentMethodTotals?.some((line) => line.method === 'transfer')).toBe(false);

        // Operational summary — Cafetería is a SUBSET of Taquilla, event
        // deposit is genuinely separate, never double-counted.
        const opSummary = closed.value.operationalSummary;
        expect(opSummary).not.toBeNull();
        if (opSummary === null) throw new Error('unreachable');
        // `pos` covers EVERY sale in the branch/window, any payment
        // method (TASK 16.13's own semantics — never cash-session-scoped):
        // 100 (cash) + 50 (cafetería, pre-refund) + 200 (card) = 350;
        // net = 350 − 25 (refund) = 325.
        expect(opSummary.pos.grossSales).toBe('350.0000');
        expect(opSummary.pos.netSales).toBe('325.0000');
        expect(opSummary.cafeteria.available).toBe(true);
        expect(opSummary.cafeteria.netSales).toBe('25.0000'); // 50 − 25 refund
        expect(opSummary.events.reservationsCreated).toBe(1);
        expect(opSummary.events.depositsCollected).toBe('300.0000');

        // --- Reload: a fresh, independent DB client — simulating a
        // completely separate process/request re-reading persisted
        // state, exactly like `cash-e2e.integration.test.ts` already
        // certifies for the pre-16.14 fields. ---
        const freshDatabase = createDatabaseClient({ connectionString: databaseUrl!, applicationName: 'asone-cash-final-close-reread' });
        try {
          const freshCash = new CashService(new CashRepository(freshDatabase));
          const reread = await freshCash.session(companyId, branchIds, opened.value.id);
          expect(reread).toMatchObject({
            status: 'closed',
            expectedClosingAmount: '935.0000',
            declaredClosingAmount: '940.0000',
            discrepancyAmount: '5.0000',
            discrepancyReason: 'Propina en efectivo no registrada como venta.',
            cashSalesTotal: '150.0000',
          });
          expect(reread.operationalSummary?.cafeteria.netSales).toBe('25.0000');
          expect(reread.paymentMethodTotals?.find((line) => line.method === 'cash')).toMatchObject({ netTotal: '125.0000' });

          const history = await freshCash.listSessions(companyId, branchIds, { limit: 20, branchId });
          const historyEntry = history.items.find((item) => item.id === opened.value.id);
          expect(historyEntry).toMatchObject({ status: 'closed', discrepancyAmount: '5.0000' });
        } finally {
          await freshDatabase.close();
        }

        // --- Historical immutability: reassign the Cafetería category
        // AFTER the close, exactly mirroring TASK 16.13A's own historical-
        // stability proof — the CLOSED session's frozen snapshot must not
        // move even though a fresh `operationalSummary()` query would now
        // compute differently. ---
        await database.pool.query(`update product_categories set operational_group=null where id=$1`, [cafeteriaCategoryId]);
        const rereadAfterReclassify = await cash.session(companyId, branchIds, opened.value.id);
        expect(rereadAfterReclassify.operationalSummary?.cafeteria.netSales).toBe('25.0000');
        expect(rereadAfterReclassify.operationalSummary?.cafeteria.available).toBe(true);
        // Restore for any later test in this file that assumes the
        // category is still classified.
        await database.pool.query(`update product_categories set operational_group='cafeteria' where id=$1`, [cafeteriaCategoryId]);

        // --- Post-close guards, re-certified in this task's own scenario. ---
        await expect(
          cash.createMovement(cashContext(new Date('2026-09-15T18:05:00.000Z')), branchIds, `late-${randomUUID()}`, opened.value.id, {
            movementType: 'cash_out',
            amount: '1.0000',
            reasonCode: 'too_late',
          }),
        ).rejects.toMatchObject({ code: 'cash_session_closed' });
        await expect(
          cash.partialClose(cashContext(new Date('2026-09-15T18:06:00.000Z')), branchIds, `late-cut-${randomUUID()}`, opened.value.id),
        ).rejects.toMatchObject({ code: 'cash_session_not_open' });
        await expect(
          cash.closeSession(cashContext(new Date('2026-09-15T18:07:00.000Z')), branchIds, `second-close-${randomUUID()}`, opened.value.id, {
            declaredClosingAmount: '940.0000',
          }),
        ).rejects.toMatchObject({ code: 'cash_session_closed' });

        // --- Tenant isolation. ---
        await expect(cash.session(otherCompanyId, [otherCompanyBranchId], opened.value.id)).rejects.toMatchObject({
          code: 'resource_not_found',
        });
      },
    );
  });

  describe('non-cash refund semantics (TASK 16.14 §10)', () => {
    it('a card refund never touches the cash drawer, but still shows up honestly in the payment-method refunds column', async () => {
      const register = await cash.createRegister(cashContext(new Date('2026-09-18T07:00:00.000Z')), branchIds, `reg-${randomUUID()}`, {
        branchId,
        code: `FIN-REG-E-${randomUUID().slice(0, 8)}`,
        name: 'Caja NonCash',
      });
      const opened = await cash.openSession(cashContext(new Date('2026-09-18T08:00:00.000Z')), branchIds, `open-${randomUUID()}`, {
        cashRegisterId: register.value.id,
        openingAmount: '0.0000',
      });
      const { saleId } = await cardSale(new Date('2026-09-18T09:00:00.000Z'), cardProductId);
      const saleDetail = await sales.sale(companyId, branchIds, saleId);
      const line = saleDetail.items[0];
      if (line === undefined) throw new Error('unreachable');

      const expectedBefore = await cash.summary(companyId, branchIds, opened.value.id);
      expect(expectedBefore.expectedCash).toBe('0.0000'); // the card sale never touched it in the first place.

      const refundCreated = await refunds.createRefund(refundContext(new Date('2026-09-18T09:10:00.000Z')), branchIds, `refund-${randomUUID()}`, {
        saleId,
        reasonCode: 'card_return',
        items: [{ saleItemId: line.id, quantity: '1' }],
      });
      const refundCompleted = await refunds.completeRefund(
        refundContext(new Date('2026-09-18T09:11:00.000Z')),
        branchIds,
        `refund-complete-${randomUUID()}`,
        refundCreated.value.id,
        { cashRegisterId: register.value.id },
      );
      expect(refundCompleted.value.status).toBe('completed');
      expect(refundCompleted.value.refundMethod).toBe('card_manual');
      // No cash-session link at all for a non-cash refund (the DB check
      // `refunds_cash_session_only_when_cash_ck` enforces this).
      expect(refundCompleted.value.cashSessionId).toBeNull();

      const expectedAfter = await cash.summary(companyId, branchIds, opened.value.id);
      expect(expectedAfter.expectedCash).toBe('0.0000');
      expect(expectedAfter.cashRefundTotal).toBe('0.0000');
      expect(expectedAfter.cashRefundCount).toBe(0);

      const closed = await cash.closeSession(cashContext(new Date('2026-09-18T18:00:00.000Z')), branchIds, `close-${randomUUID()}`, opened.value.id, {
        declaredClosingAmount: '0.0000',
      });
      expect(closed.value.discrepancyAmount).toBe('0.0000');
      expect(closed.value.cashRefundTotal).toBe('0.0000');
      const cardLine = closed.value.paymentMethodTotals?.find((row) => row.method === 'card_manual');
      // The GROSS sale still shows (the card sale itself happened), and
      // the refund is honestly visible too — informational, never fed
      // into any cash-drawer figure above.
      expect(cardLine).toMatchObject({ grossSalesTotal: '200.0000', refundsTotal: '200.0000', netTotal: '0.0000' });
    });
  });

  describe('branch isolation (TASK 16.14 §22)', () => {
    it('a payment/operational snapshot for one branch never includes another branch’s activity, even within the same company', async () => {
      const registerMain = await cash.createRegister(cashContext(new Date('2026-09-19T07:00:00.000Z')), branchIds, `reg-${randomUUID()}`, {
        branchId,
        code: `FIN-REG-F-${randomUUID().slice(0, 8)}`,
        name: 'Caja Main',
      });
      const openedMain = await cash.openSession(cashContext(new Date('2026-09-19T08:00:00.000Z')), branchIds, `open-${randomUUID()}`, {
        cashRegisterId: registerMain.value.id,
        openingAmount: '0.0000',
      });
      const registerOther = await cash.createRegister(cashContext(new Date('2026-09-19T07:00:00.000Z')), branchIds, `reg-${randomUUID()}`, {
        branchId: otherBranchId,
        code: `FIN-REG-G-${randomUUID().slice(0, 8)}`,
        name: 'Caja Second',
      });
      const openedOther = await cash.openSession(cashContext(new Date('2026-09-19T08:00:00.000Z')), branchIds, `open-${randomUUID()}`, {
        cashRegisterId: registerOther.value.id,
        openingAmount: '0.0000',
      });

      // A sale on the MAIN branch's register only.
      await cashSale(new Date('2026-09-19T09:00:00.000Z'), cashProductId, registerMain.value.id);
      // A sale on the OTHER branch — needs its own createSale call since
      // the `cashSale` helper always targets `branchId`.
      const ctx = cashContext(new Date('2026-09-19T09:05:00.000Z'));
      const otherSale = await sales.createSale(ctx, branchIds, `sale-${randomUUID()}`, {
        branchId: otherBranchId,
        items: [{ productId: cashProductId, quantity: '1' }],
      });
      await payments.createCashPayment(ctx, branchIds, `pay-${randomUUID()}`, {
        saleId: otherSale.value.sale.id,
        tenderedAmount: otherSale.value.sale.total,
        cashRegisterId: registerOther.value.id,
      });

      const closedMain = await cash.closeSession(cashContext(new Date('2026-09-19T18:00:00.000Z')), branchIds, `close-${randomUUID()}`, openedMain.value.id, {
        declaredClosingAmount: '100.0000',
      });
      // Only the main branch's own $100 sale — the other branch's own
      // $100 sale never leaks in, even though both are the same company.
      expect(closedMain.value.cashSalesTotal).toBe('100.0000');
      expect(closedMain.value.operationalSummary?.pos.grossSales).toBe('100.0000');
      expect(closedMain.value.paymentMethodTotals?.find((row) => row.method === 'cash')).toMatchObject({
        grossSalesTotal: '100.0000',
      });

      const closedOther = await cash.closeSession(cashContext(new Date('2026-09-19T18:05:00.000Z')), branchIds, `close-${randomUUID()}`, openedOther.value.id, {
        declaredClosingAmount: '100.0000',
      });
      expect(closedOther.value.cashSalesTotal).toBe('100.0000');
      expect(closedOther.value.operationalSummary?.pos.grossSales).toBe('100.0000');
    });
  });

  describe('discrepancy reason (TASK 16.14 §12)', () => {
    it('persists only when provided, never required, and the idempotency key conflicts on a different reason', async () => {
      const register = await cash.createRegister(cashContext(new Date('2026-09-16T07:00:00.000Z')), branchIds, `reg-${randomUUID()}`, {
        branchId,
        code: `FIN-REG-B-${randomUUID().slice(0, 8)}`,
        name: 'Caja Reason',
      });
      const opened = await cash.openSession(cashContext(new Date('2026-09-16T08:00:00.000Z')), branchIds, `open-${randomUUID()}`, {
        cashRegisterId: register.value.id,
        openingAmount: '0.0000',
      });
      const key = `close-reason-${randomUUID()}`;
      const closed = await cash.closeSession(cashContext(new Date('2026-09-16T09:00:00.000Z')), branchIds, key, opened.value.id, {
        declaredClosingAmount: '0.0000',
      });
      expect(closed.value.discrepancyReason).toBeNull();
      expect(closed.value.discrepancyAmount).toBe('0.0000');

      // Same key, same body → real replay, never a duplicate close.
      const replayed = await cash.closeSession(cashContext(new Date('2026-09-16T09:00:01.000Z')), branchIds, key, opened.value.id, {
        declaredClosingAmount: '0.0000',
      });
      expect(replayed.replayed).toBe(true);
      expect(replayed.value.id).toBe(closed.value.id);

      // Same key, a DIFFERENT reason → a genuinely different request,
      // rejected as an idempotency conflict rather than silently
      // overwriting or ignoring the new text.
      await expect(
        cash.closeSession(cashContext(new Date('2026-09-16T09:00:02.000Z')), branchIds, key, opened.value.id, {
          declaredClosingAmount: '0.0000',
          discrepancyReason: 'Should conflict.',
        }),
      ).rejects.toMatchObject({ code: 'idempotency_conflict' });

      // A second session, this time WITH a reason from the start —
      // proves the field genuinely persists when supplied, is trimmed,
      // and rejects a whitespace-only value as blank.
      const register2 = await cash.createRegister(cashContext(new Date('2026-09-16T10:00:00.000Z')), branchIds, `reg-${randomUUID()}`, {
        branchId,
        code: `FIN-REG-C-${randomUUID().slice(0, 8)}`,
        name: 'Caja Reason 2',
      });
      const opened2 = await cash.openSession(cashContext(new Date('2026-09-16T10:01:00.000Z')), branchIds, `open-${randomUUID()}`, {
        cashRegisterId: register2.value.id,
        openingAmount: '0.0000',
      });
      await expect(
        cash.closeSession(cashContext(new Date('2026-09-16T10:05:00.000Z')), branchIds, `close-${randomUUID()}`, opened2.value.id, {
          declaredClosingAmount: '0.0000',
          discrepancyReason: '   ',
        }),
      ).rejects.toMatchObject({ code: 'validation_error' });
      const closed2 = await cash.closeSession(cashContext(new Date('2026-09-16T10:06:00.000Z')), branchIds, `close-${randomUUID()}`, opened2.value.id, {
        declaredClosingAmount: '0.0000',
        discrepancyReason: '  Sobrante de propinas.  ',
      });
      expect(closed2.value.discrepancyReason).toBe('Sobrante de propinas.');
    });
  });

  describe('old close compatibility (TASK 16.14 §25)', () => {
    it('a session closed before this task (all new columns null) reads back honestly, never fabricating zeros', async () => {
      const register = await cash.createRegister(cashContext(new Date('2026-09-17T07:00:00.000Z')), branchIds, `reg-${randomUUID()}`, {
        branchId,
        code: `FIN-REG-D-${randomUUID().slice(0, 8)}`,
        name: 'Caja Legacy',
      });
      const opened = await cash.openSession(cashContext(new Date('2026-09-17T08:00:00.000Z')), branchIds, `open-${randomUUID()}`, {
        cashRegisterId: register.value.id,
        openingAmount: '100.0000',
      });
      // Simulate a pre-TASK-16.14 close: only the ORIGINAL closure
      // columns populated, every new commercial column left NULL — this
      // is exactly the shape every real session closed before this
      // migration has today.
      await database.pool.query(
        `update cash_sessions set status='closed', closed_by=$2, closed_at=$3,
           declared_closing_amount='100.0000', expected_closing_amount='100.0000',
           discrepancy_amount='0.0000', version=version+1
         where company_id=$1 and id=$4`,
        [companyId, userId, new Date('2026-09-17T18:00:00.000Z'), opened.value.id],
      );
      const legacyClosed = await cash.session(companyId, branchIds, opened.value.id);
      expect(legacyClosed.status).toBe('closed');
      expect(legacyClosed.discrepancyAmount).toBe('0.0000');
      expect(legacyClosed.cashSalesTotal).toBeNull();
      expect(legacyClosed.cashRefundTotal).toBeNull();
      expect(legacyClosed.paymentMethodTotals).toBeNull();
      expect(legacyClosed.operationalSummary).toBeNull();
      expect(legacyClosed.discrepancyReason).toBeNull();
    });
  });
});
