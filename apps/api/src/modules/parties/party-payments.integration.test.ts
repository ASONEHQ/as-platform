import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';
import { AppError } from '@asone/errors';

import type { AuthService } from '../auth/auth.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CashRepository } from '../cash/cash.repository.js';
import { CashService } from '../cash/cash.service.js';
import { DashboardRepository } from '../dashboard/dashboard.repository.js';
import { PartiesRepository } from './parties.repository.js';
import { PartyError, type PartyMutationContext } from './parties.types.js';
import { PartyPackagesService } from './party-packages.service.js';
import { registerPartyReservationRoutes } from './party-reservations.routes.js';
import { PartyReservationsService } from './party-reservations.service.js';
import { PartyRoomsService } from './party-rooms.service.js';

/** TASK 17.6 — the party payment ledger (methods, history, void, balance). */
const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;

// Each call gets a later timestamp, like real requests, so ordering by time is deterministic.
let tick = 0;
function context(companyId: string, actorId: string): PartyMutationContext {
  tick += 1;
  return {
    companyId,
    actorId,
    requestId: `req-${randomUUID()}`,
    correlationId: `corr-${randomUUID()}`,
    timestamp: new Date(Date.UTC(2026, 9, 1, 10, 0, 0) + tick * 1000),
    deviceId: undefined,
  };
}

async function expectError(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).not.toBeNull();
  expect((error as { code?: string }).code).toBe(code);
}

integration('PostgreSQL party payment ledger (TASK 17.6)', { concurrent: false }, () => {
  let database: DatabaseClient;
  let reservations: PartyReservationsService;
  let cash: CashService;
  let cashRepository: CashRepository;

  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const branchId = randomUUID();
  const otherBranchId = randomUUID();
  const otherCompanyBranchId = randomUUID();
  const userId = randomUUID();
  const otherCompanyUserId = randomUUID();
  const branchIds = [branchId];

  let roomId: string;
  let packageId: string;
  let sessionA: string;
  let sessionB: string;
  let otherBranchSession: string;
  let dayCounter = 0;

  /** A fresh reservation; childrenCount 10 => subtotal 3500, IVA 16% => 4060.00. */
  async function newReservation(): Promise<string> {
    dayCounter += 1;
    const date = new Date(Date.UTC(2029, 0, 1 + dayCounter)).toISOString().slice(0, 10);
    const created = await reservations.createReservation(context(companyId, userId), branchIds, `r-${randomUUID()}`, {
      branchId,
      roomId,
      packageId,
      eventDate: date,
      startTime: '10:00',
      endTime: '12:00',
      childrenCount: 10,
    });
    return created.value.id;
  }

  interface PayInput {
    purpose?: 'deposit' | 'balance' | 'additional';
    amount?: string;
    method?: 'cash' | 'card' | 'transfer';
    reference?: string;
    notes?: string;
    /** `null` = send no session at all. */
    cashSessionId?: string | null;
  }
  const pay = (
    reservationId: string,
    input: PayInput = {},
    key = `p-${randomUUID()}`,
  ): ReturnType<PartyReservationsService['recordPayment']> => {
    const session = input.cashSessionId === undefined ? sessionA : input.cashSessionId;
    return reservations.recordPayment(context(companyId, userId), branchIds, key, reservationId, {
      purpose: input.purpose ?? 'deposit',
      amount: input.amount ?? '1000.0000',
      method: input.method ?? 'cash',
      ...(input.reference === undefined ? {} : { reference: input.reference }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
      ...(session === null ? {} : { cashSessionId: session }),
    });
  };

  beforeAll(async () => {
    if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({ connectionString: databaseUrl, applicationName: 'asone-party-payments-integration' });
    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'Pay Co','Pay Co',$2,'active','UTC','MXN','es-MX'),
             ($3,'Other Pay Co','Other Pay Co',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `pay-${companyId}`, otherCompanyId, `pay-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'Pay Main','PYMAIN','active','UTC'),
             ($3,$2,'Pay Second','PYSECOND','active','UTC'),
             ($4,$5,'Pay Other Co','PYOTHER','active','UTC')`,
      [branchId, companyId, otherBranchId, otherCompanyBranchId, otherCompanyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'Pay Actor','active'),($3,$4,$4,'Other Pay User','active')`,
      [userId, `pay-${userId}@example.test`, otherCompanyUserId, `pay-${otherCompanyUserId}@example.test`],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status)
       values($1,$2,$3,'active'),($4,$5,$6,'active')`,
      [randomUUID(), companyId, userId, randomUUID(), otherCompanyId, otherCompanyUserId],
    );

    const repository = new PartiesRepository(database);
    cashRepository = new CashRepository(database);
    cash = new CashService(cashRepository);
    reservations = new PartyReservationsService(repository, cashRepository);
    const rooms = new PartyRoomsService(repository);
    const packages = new PartyPackagesService(repository);

    roomId = (
      await rooms.createRoom(context(companyId, userId), [branchId, otherBranchId], `room-${randomUUID()}`, {
        branchId,
        code: 'PY-A',
        name: 'Salon Pagos',
        capacityChildren: 40,
        capacityAdults: 20,
      })
    ).value.id;
    packageId = (
      await packages.createPackage(context(companyId, userId), [branchId, otherBranchId], `pkg-${randomUUID()}`, {
        branchId,
        code: 'PYBASIC',
        name: 'Paquete Pagos',
        price: '3500.0000',
        durationMinutes: 120,
        childrenIncluded: 10,
        adultsIncluded: 5,
        childExtraCost: '80.0000',
        adultExtraCost: '50.0000',
        extraHalfHourCost: '250.0000',
      })
    ).value.id;

    const open = async (targetBranch: string): Promise<string> => {
      const register = await cash.createRegister(context(companyId, userId), [branchId, otherBranchId], `reg-${randomUUID()}`, {
        branchId: targetBranch,
        code: `PY-${randomUUID().slice(0, 8)}`,
        name: 'Caja pagos',
      });
      const session = await cash.openSession(context(companyId, userId), [branchId, otherBranchId], `s-${randomUUID()}`, {
        cashRegisterId: register.value.id,
        openingAmount: '0',
      });
      return session.value.id;
    };
    sessionA = await open(branchId);
    sessionB = await open(branchId);
    otherBranchSession = await open(otherBranchId);
  });

  afterAll(async () => {
    const ids = [[companyId, otherCompanyId]];
    await database.pool.query('delete from party_reservation_payments where company_id=any($1)', ids);
    await database.pool.query('delete from party_reservation_socks where company_id=any($1)', ids);
    await database.pool.query('delete from party_reservation_snacks where company_id=any($1)', ids);
    await database.pool.query('delete from party_reservations where company_id=any($1)', ids);
    await database.pool.query('delete from party_packages where company_id=any($1)', ids);
    await database.pool.query('delete from party_rooms where company_id=any($1)', ids);
    await database.pool.query('delete from cash_movements where company_id=any($1)', ids);
    await database.pool.query('delete from cash_sessions where company_id=any($1)', ids);
    await database.pool.query('delete from cash_registers where company_id=any($1)', ids);
    await database.pool.query('delete from idempotency_keys where company_id=any($1)', ids);
    await database.pool.query('delete from outbox_events where company_id=any($1)', ids);
    await database.pool.query('delete from audit_log where company_id=any($1)', ids);
    await database.pool.query('delete from company_memberships where company_id=any($1)', ids);
    await database.pool.query('delete from branches where company_id=any($1)', ids);
    await database.pool.query('delete from companies where id=any($1)', ids);
    await database.pool.query('delete from users where id=any($1)', [[userId, otherCompanyUserId]]);
    await database.close();
  });

  async function movementsOf(sessionId: string, reservationId: string): Promise<Awaited<ReturnType<CashRepository['listMovements']>>['items']> {
    const all = await cashRepository.listMovements(companyId, sessionId, { limit: 100 });
    return all.items.filter((m) => m.referenceType === 'party_reservation' && m.referenceId === reservationId);
  }

  describe('recording by method', () => {
    it('cash posts a cash movement and requires an open session of the same branch', async () => {
      const reservationId = await newReservation();
      const payment = await pay(reservationId);
      expect(payment.value.method).toBe('cash');
      expect(payment.value.cashMovementId).not.toBeNull();
      expect(await movementsOf(sessionA, reservationId)).toHaveLength(1);

      await expectError(pay(reservationId, { cashSessionId: null }), 'validation_error');
      await expectError(pay(reservationId, { cashSessionId: otherBranchSession }), 'resource_not_found');
    });

    it('card and transfer are RECORDED without touching cash: no movement, no session, with reference and notes', async () => {
      const reservationId = await newReservation();
      const card = await pay(reservationId, {
        method: 'card',
        cashSessionId: null,
        amount: '500.0000',
        reference: 'AUT-4821',
        notes: 'Terminal 2',
      });
      const transfer = await pay(reservationId, {
        method: 'transfer',
        cashSessionId: null,
        purpose: 'balance',
        amount: '700.0000',
        reference: 'SPEI-99',
      });
      expect(card.value.method).toBe('card');
      expect(card.value.cashMovementId).toBeNull();
      expect(card.value.reference).toBe('AUT-4821');
      expect(card.value.notes).toBe('Terminal 2');
      expect(transfer.value.cashMovementId).toBeNull();
      expect(await movementsOf(sessionA, reservationId)).toHaveLength(0);

      // They count in the paid total, because the operator recorded them.
      const balance = await reservations.balance(companyId, branchIds, reservationId);
      expect(balance.totalPaid).toBe('1200.0000');
      expect(balance.remainingBalance).toBe('2860.0000');
      expect(balance.paymentsCount).toBe(2);

      // A card/transfer payment must not claim a cash drawer.
      await expectError(pay(reservationId, { method: 'card', cashSessionId: sessionA }), 'validation_error');
    });

    it('validates method, amount and text fields', async () => {
      const reservationId = await newReservation();
      await expectError(pay(reservationId, { method: 'bitcoin' as 'cash' }), 'validation_error');
      await expectError(pay(reservationId, { amount: '0' }), 'validation_error');
      await expectError(pay(reservationId, { amount: '-5' }), 'validation_error');
      await expectError(
        pay(reservationId, { method: 'transfer', cashSessionId: null, reference: 'x'.repeat(121) }),
        'validation_error',
      );
    });

    it('does not duplicate money on a double submit (same idempotency key) and rejects a reused key with another body', async () => {
      const reservationId = await newReservation();
      const key = `p-dbl-${randomUUID()}`;
      const first = await pay(reservationId, {}, key);
      const second = await pay(reservationId, {}, key);
      expect(second.replayed).toBe(true);
      expect(second.value.id).toBe(first.value.id);
      expect(second.value.createdAt).toBeInstanceOf(Date);
      expect((await reservations.balance(companyId, branchIds, reservationId)).totalPaid).toBe('1000.0000');
      expect(await movementsOf(sessionA, reservationId)).toHaveLength(1);
      await expectError(pay(reservationId, { amount: '2000.0000' }, key), 'idempotency_conflict');
    });

    it('refuses a payment on a cancelled reservation', async () => {
      const reservationId = await newReservation();
      await expect(
        reservations.cancelReservation(context(companyId, userId), branchIds, `c-${randomUUID()}`, reservationId, 1n, {
          reasonCode: 'customer_request',
        }),
      ).resolves.toBeDefined();
      await expectError(pay(reservationId), 'invalid_reservation_state');
    });
  });

  describe('balance', () => {
    it('reports paid, remaining and overpaid server-side, and keeps outstanding_balance', async () => {
      const reservationId = await newReservation();
      await pay(reservationId, { amount: '4060.0000' });
      let balance = await reservations.balance(companyId, branchIds, reservationId);
      expect(balance.quotedTotal).toBe('4060.0000');
      expect(balance.totalPaid).toBe('4060.0000');
      expect(balance.remainingBalance).toBe('0.0000');
      expect(balance.overpaidAmount).toBe('0.0000');
      expect(balance.outstandingBalance).toBe('0.0000');

      await pay(reservationId, { amount: '100.0000', purpose: 'additional' });
      balance = await reservations.balance(companyId, branchIds, reservationId);
      expect(balance.totalPaid).toBe('4160.0000');
      expect(balance.remainingBalance).toBe('0.0000');
      expect(balance.overpaidAmount).toBe('100.0000');
    });
  });

  describe('history and void', () => {
    it('lists the full history oldest first, and a void keeps the row (never deleted) with who/when/why', async () => {
      const reservationId = await newReservation();
      const first = await pay(reservationId, { amount: '1000.0000' });
      const second = await pay(reservationId, {
        method: 'transfer',
        cashSessionId: null,
        amount: '500.0000',
        reference: 'SPEI-1',
      });
      const voided = await reservations.voidPayment(context(companyId, userId), branchIds, `v-${randomUUID()}`, reservationId, second.value.id, {
        reason: 'Transferencia no llego',
      });
      expect(voided.value.voidedAt).toBeInstanceOf(Date);
      expect(voided.value.voidedBy).toBe(userId);
      expect(voided.value.voidReason).toBe('Transferencia no llego');
      expect(voided.value.voidCashMovementId).toBeNull();

      const history = await reservations.listPayments(companyId, branchIds, reservationId);
      expect(history.map((p) => p.id)).toEqual([first.value.id, second.value.id]);
      expect(history[1]?.voidedAt).not.toBeNull();

      const balance = await reservations.balance(companyId, branchIds, reservationId);
      expect(balance.totalPaid).toBe('1000.0000');
      expect(balance.paymentsCount).toBe(1);
      expect(balance.voidedPaymentsCount).toBe(1);
      const detail = await reservations.reservationDetail(companyId, branchIds, reservationId);
      expect(detail.paymentsSummary).toEqual({ totalPaid: '1000.0000', count: 1 });

      const rows = await database.pool.query<{ n: string }>(
        'select count(*)::text n from party_reservation_payments where reservation_id=$1',
        [reservationId],
      );
      expect(rows.rows[0]?.n).toBe('2');
    });

    it('voids a CASH payment with a compensating cash_out linked to the original movement, into the supplied open session', async () => {
      const reservationId = await newReservation();
      const payment = await pay(reservationId, { amount: '1500.0000' });
      const voided = await reservations.voidPayment(context(companyId, userId), branchIds, `v-${randomUUID()}`, reservationId, payment.value.id, {
        reason: 'Cobro duplicado',
        cashSessionId: sessionB,
      });
      expect(voided.value.voidCashMovementId).not.toBeNull();
      const reversal = (await movementsOf(sessionB, reservationId)).find((m) => m.id === voided.value.voidCashMovementId);
      expect(reversal?.movementType).toBe('cash_out');
      expect(reversal?.amount).toBe('1500.0000');
      expect(reversal?.reversalOfId).toBe(payment.value.cashMovementId);
      expect((await reservations.balance(companyId, branchIds, reservationId)).totalPaid).toBe('0.0000');
    });

    it('requires an open session of the same branch to void a cash payment, and a non-cash void must not name one', async () => {
      const reservationId = await newReservation();
      const cashPayment = await pay(reservationId);
      const transfer = await pay(reservationId, { method: 'transfer', cashSessionId: null, amount: '200.0000' });
      const ctx = (): PartyMutationContext => context(companyId, userId);
      await expectError(
        reservations.voidPayment(ctx(), branchIds, `v-${randomUUID()}`, reservationId, cashPayment.value.id, { reason: 'sin sesion' }),
        'validation_error',
      );
      await expectError(
        reservations.voidPayment(ctx(), branchIds, `v-${randomUUID()}`, reservationId, cashPayment.value.id, {
          reason: 'otra sucursal',
          cashSessionId: otherBranchSession,
        }),
        'resource_not_found',
      );
      await expectError(
        reservations.voidPayment(ctx(), branchIds, `v-${randomUUID()}`, reservationId, transfer.value.id, {
          reason: 'no usa caja',
          cashSessionId: sessionA,
        }),
        'validation_error',
      );
      // Nothing was voided by the failed attempts.
      expect((await reservations.balance(companyId, branchIds, reservationId)).totalPaid).toBe('1200.0000');
    });

    it('cannot void twice, and the idempotent replay returns the same void without a second reversal', async () => {
      const reservationId = await newReservation();
      const payment = await pay(reservationId);
      const key = `v-rep-${randomUUID()}`;
      const input = { reason: 'Error de captura', cashSessionId: sessionA };
      const first = await reservations.voidPayment(context(companyId, userId), branchIds, key, reservationId, payment.value.id, input);
      const replay = await reservations.voidPayment(context(companyId, userId), branchIds, key, reservationId, payment.value.id, input);
      expect(replay.replayed).toBe(true);
      expect(replay.value.id).toBe(first.value.id);
      await expectError(
        reservations.voidPayment(context(companyId, userId), branchIds, `v-${randomUUID()}`, reservationId, payment.value.id, input),
        'payment_already_voided',
      );
      const reversals = (await movementsOf(sessionA, reservationId)).filter((m) => m.movementType === 'cash_out');
      expect(reversals).toHaveLength(1);
    });

    it('two concurrent voids of one payment produce exactly one void and one compensating movement', async () => {
      const reservationId = await newReservation();
      const payment = await pay(reservationId);
      const attempt = (): Promise<string> =>
        reservations
          .voidPayment(context(companyId, userId), branchIds, `v-${randomUUID()}`, reservationId, payment.value.id, {
            reason: 'Doble clic simultaneo',
            cashSessionId: sessionA,
          })
          .then(
            () => 'ok' as const,
            (error: unknown) => (error as { code?: string }).code ?? 'unknown',
          );
      const outcomes = await Promise.all([attempt(), attempt()]);
      expect(outcomes.filter((outcome) => outcome === 'ok')).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome === 'payment_already_voided')).toHaveLength(1);
      expect((await movementsOf(sessionA, reservationId)).filter((m) => m.movementType === 'cash_out')).toHaveLength(1);
    });

    it('two concurrent submissions with the SAME key record the money once', async () => {
      const reservationId = await newReservation();
      const key = `p-conc-${randomUUID()}`;
      const results = await Promise.all([pay(reservationId, {}, key), pay(reservationId, {}, key)]);
      expect(results[0].value.id).toBe(results[1].value.id);
      expect((await reservations.balance(companyId, branchIds, reservationId)).totalPaid).toBe('1000.0000');
      expect(await movementsOf(sessionA, reservationId)).toHaveLength(1);
    });

    it('requires a real reason and 404s on an unknown payment', async () => {
      const reservationId = await newReservation();
      const payment = await pay(reservationId);
      await expectError(
        reservations.voidPayment(context(companyId, userId), branchIds, `v-${randomUUID()}`, reservationId, payment.value.id, {
          reason: 'x',
          cashSessionId: sessionA,
        }),
        'validation_error',
      );
      await expectError(
        reservations.voidPayment(context(companyId, userId), branchIds, `v-${randomUUID()}`, reservationId, randomUUID(), {
          reason: 'no existe',
          cashSessionId: sessionA,
        }),
        'resource_not_found',
      );
    });

    it('blocks the generic cash reversal of a party payment movement (it would leave the payment active)', async () => {
      const reservationId = await newReservation();
      const payment = await pay(reservationId);
      await expectError(
        cash.reverseMovement(context(companyId, userId), branchIds, `rv-${randomUUID()}`, sessionA, payment.value.cashMovementId ?? '', {
          reasonCode: 'mistake',
        }),
        'cash_movement_not_reversible',
      );
      expect((await reservations.balance(companyId, branchIds, reservationId)).totalPaid).toBe('1000.0000');
    });

    it('audits recorded and voided payments', async () => {
      const reservationId = await newReservation();
      const payment = await pay(reservationId, { method: 'card', cashSessionId: null, reference: 'AUD-1' });
      await reservations.voidPayment(context(companyId, userId), branchIds, `v-${randomUUID()}`, reservationId, payment.value.id, {
        reason: 'Revisado en auditoria',
      });
      const audit = await database.pool.query<{ action: string }>(
        `select action from audit_log where company_id=$1 and entity_type='party_reservation_payment' and entity_id=$2 order by occurred_at`,
        [companyId, payment.value.id],
      );
      expect(audit.rows.map((r) => r.action)).toEqual(['party_reservation.payment_recorded', 'party_reservation.payment_voided']);
    });
  });

  describe('scope isolation', () => {
    it('hides reservations and payments outside the branch scope (404) and in other companies', async () => {
      const reservationId = await newReservation();
      const payment = await pay(reservationId);
      await expectError(reservations.listPayments(companyId, [otherBranchId], reservationId), 'resource_not_found');
      await expectError(reservations.listPayments(otherCompanyId, [otherCompanyBranchId], reservationId), 'resource_not_found');
      await expectError(
        reservations.voidPayment(context(companyId, userId), [otherBranchId], `v-${randomUUID()}`, reservationId, payment.value.id, {
          reason: 'fuera de alcance',
          cashSessionId: sessionA,
        }),
        'resource_not_found',
      );
      await expectError(
        reservations.recordPayment(context(companyId, userId), [otherBranchId], `p-${randomUUID()}`, reservationId, {
          purpose: 'deposit',
          amount: '10.0000',
          method: 'transfer',
        }),
        'resource_not_found',
      );
    });
  });

  describe('downstream sums ignore voided payments', () => {
    it('keeps the cash operational summary and dashboard outstanding in line with active payments only', async () => {
      const reservationId = await newReservation();
      const keep = await pay(reservationId, { amount: '600.0000' });
      const drop = await pay(reservationId, { amount: '400.0000' });
      const card = await pay(reservationId, { method: 'card', cashSessionId: null, amount: '300.0000' });
      await reservations.voidPayment(context(companyId, userId), branchIds, `v-${randomUUID()}`, reservationId, drop.value.id, {
        reason: 'Cobro duplicado',
        cashSessionId: sessionA,
      });
      expect(keep.value.id).not.toBe(drop.value.id);
      expect(card.value.method).toBe('card');

      const summary = await cashRepository.operationalSummary(
        companyId,
        branchId,
        new Date('2020-01-01T00:00:00.000Z'),
        new Date('2100-01-01T00:00:00.000Z'),
        '2026-10-01',
      );
      const expected = await database.pool.query<{ cash_total: string; all_total: string }>(
        `select coalesce(sum(amount_snapshot) filter (where method='cash' and voided_at is null),0)::text cash_total,
                coalesce(sum(amount_snapshot) filter (where voided_at is null),0)::text all_total
         from party_reservation_payments where company_id=$1 and branch_id=$2`,
        [companyId, branchId],
      );
      // The drawer figure counts only ACTIVE CASH payments: the card record is not in the drawer
      // and the voided cash payment is gone.
      expect(Number(summary.events.totalCollected)).toBeCloseTo(Number(expected.rows[0]?.cash_total), 4);
      expect(Number(expected.rows[0]?.all_total)).toBeGreaterThan(Number(expected.rows[0]?.cash_total));

      const outstanding = await new DashboardRepository(database).outstandingPartyBalances(companyId, branchIds);
      const paid = await database.pool.query<{ total: string }>(
        `select coalesce(sum(amount_snapshot),0)::text total from party_reservation_payments p
         join party_reservations r on r.company_id=p.company_id and r.id=p.reservation_id
         where p.company_id=$1 and p.voided_at is null and r.status in ('held','pending_deposit','confirmed')`,
        [companyId],
      );
      expect(Number(outstanding[0]?.paidTotal)).toBeCloseTo(Number(paid.rows[0]?.total), 4);
    });
  });

  describe('HTTP layer', () => {
    function buildApp(permissions: string[], permitted: string[]): FastifyInstance {
      const authContext: AuthContext = {
        sessionId: randomUUID(),
        userId,
        membershipId: randomUUID(),
        companyId,
        branchId,
        expiresAt: new Date(Date.now() + 60_000),
        companyWideAccess: false,
        permissions,
        permittedBranchIds: permitted,
      };
      const authentication = {
        authenticate: vi.fn(() => Promise.resolve(authContext)),
        requirePermission: vi.fn((_context: AuthContext, permission: string) => {
          if (!authContext.permissions.includes(permission))
            throw new AppError({ code: 'permission_denied', message: 'Permission denied.', statusCode: 403 });
        }),
        requireBranchAccess: vi.fn(() => undefined),
      } as unknown as AuthService;
      const app = Fastify();
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
      registerPartyReservationRoutes(app, authentication, reservations);
      return app;
    }
    const headers = (): Record<string, string> => ({
      authorization: 'Bearer x',
      'idempotency-key': `http-${randomUUID()}`,
      'content-type': 'application/json',
    });

    it('records a card payment, lists history, and voids it over HTTP with honest recorded_only semantics', async () => {
      const app = buildApp(['party.read', 'party.payment.record', 'party.cancel'], [branchId]);
      await app.ready();
      try {
        const reservationId = await newReservation();
        const created = await app.inject({
          method: 'POST',
          url: `/api/v1/party-reservations/${reservationId}/payments`,
          headers: headers(),
          payload: { purpose: 'deposit', amount: '800.0000', method: 'card', reference: 'AUT-77' },
        });
        expect(created.statusCode).toBe(201);
        const body = created.json<{ data: { id: string; method: string; recorded_only: boolean; cash_movement_id: string | null; status: string } }>().data;
        expect(body.method).toBe('card');
        expect(body.recorded_only).toBe(true);
        expect(body.cash_movement_id).toBeNull();
        expect(body.status).toBe('active');

        const list = await app.inject({ method: 'GET', url: `/api/v1/party-reservations/${reservationId}/payments`, headers: { authorization: 'Bearer x' } });
        expect(list.statusCode).toBe(200);
        expect(list.json<{ data: { id: string }[] }>().data.map((p) => p.id)).toEqual([body.id]);

        const voided = await app.inject({
          method: 'POST',
          url: `/api/v1/party-reservations/${reservationId}/payments/${body.id}/void`,
          headers: headers(),
          payload: { reason: 'Cargo rechazado' },
        });
        expect(voided.statusCode).toBe(200);
        expect(voided.json<{ data: { status: string; void_reason: string } }>().data).toMatchObject({ status: 'voided', void_reason: 'Cargo rechazado' });

        const again = await app.inject({
          method: 'POST',
          url: `/api/v1/party-reservations/${reservationId}/payments/${body.id}/void`,
          headers: headers(),
          payload: { reason: 'Otra vez' },
        });
        expect(again.statusCode).toBe(409);

        const balance = await app.inject({ method: 'GET', url: `/api/v1/party-reservations/${reservationId}/balance`, headers: { authorization: 'Bearer x' } });
        expect(balance.json<{ data: { total_paid: string; remaining_balance: string; voided_payments_count: number } }>().data).toMatchObject({
          total_paid: '0.0000',
          remaining_balance: '4060.0000',
          voided_payments_count: 1,
        });
      } finally {
        await app.close();
      }
    });

    it('enforces permissions: record needs party.payment.record, void needs party.cancel, history needs party.read', async () => {
      const recordOnly = buildApp(['party.read', 'party.payment.record'], [branchId]);
      const noRead = buildApp([], [branchId]);
      await recordOnly.ready();
      await noRead.ready();
      try {
        const reservationId = await newReservation();
        const payment = await pay(reservationId);
        const voidAttempt = await recordOnly.inject({
          method: 'POST',
          url: `/api/v1/party-reservations/${reservationId}/payments/${payment.value.id}/void`,
          headers: headers(),
          payload: { reason: 'sin permiso', cash_session_id: sessionA },
        });
        expect(voidAttempt.statusCode).toBe(403);
        expect((await noRead.inject({ method: 'GET', url: `/api/v1/party-reservations/${reservationId}/payments`, headers: { authorization: 'Bearer x' } })).statusCode).toBe(403);
        expect(
          (
            await noRead.inject({
              method: 'POST',
              url: `/api/v1/party-reservations/${reservationId}/payments`,
              headers: headers(),
              payload: { purpose: 'deposit', amount: '10.0000', method: 'transfer' },
            })
          ).statusCode,
        ).toBe(403);
        expect((await reservations.balance(companyId, branchIds, reservationId)).totalPaid).toBe('1000.0000');
      } finally {
        await recordOnly.close();
        await noRead.close();
      }
    });
  });

  it('exports PartyError for scope assertions', () => {
    expect(new PartyError('validation_error', 'x').code).toBe('validation_error');
  });
});
