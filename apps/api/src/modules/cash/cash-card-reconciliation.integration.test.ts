import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';

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

/** TASK 16.14A — "CONCILIACIÓN DE TARJETAS": comparing ACCESS GO's own
 * recorded card-payment totals against a physical card terminal's own
 * settlement/lote total, entered manually by the operator. A dedicated
 * file, separate from `cash-final-close-commercial.integration.test.ts`
 * (TASK 16.14), because this feature's own scenarios (multi-terminal,
 * pending-vs-zero, discrepancy notes) are numerous enough to deserve their
 * own fixture set — reusing that file's exact same product/company/branch
 * fixture SHAPE (not its actual rows) so the two files can run
 * independently and in any order.
 *
 * `card_terminal` payments are deliberately NOT separately exercised here
 * (only `card_manual`, mirroring TASK 16.14's own `cardSale()` helper) —
 * creating one requires a full `payment_terminals`+`devices` fixture
 * chain for a feature (a live Mercado Pago Point pairing) this task's own
 * scope guard explicitly forbids touching. `card_terminal`'s inclusion in
 * the system card total is instead verified by code inspection
 * (`CARD_RECONCILIATION_METHODS` in `cash.service.ts`) and by the fact
 * that `payments`/`refunds` treat both methods through 100% identical
 * columns/queries — there is no method-specific branch anywhere in
 * `paymentMethodTotals`/`buildCardReconciliation` that could behave
 * differently for one versus the other. */
const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;

integration('PostgreSQL card-terminal reconciliation at final close (TASK 16.14A)', { concurrent: false }, () => {
  let database: DatabaseClient;
  let cash: CashService;
  let sales: SalesService;
  let payments: PaymentService;
  let refunds: RefundsService;

  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const branchId = randomUUID();
  const otherCompanyBranchId = randomUUID();
  const userId = randomUUID();
  const otherCompanyUserId = randomUUID();
  const branchIds = [branchId];

  const cashProductId = randomUUID();
  const cardProductId = randomUUID();

  function cashContext(timestamp: Date): CashMutationContext {
    return { companyId, actorId: userId, requestId: `req-${randomUUID()}`, correlationId: `corr-${randomUUID()}`, timestamp };
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

  // $100/unit product — always a single $100 cash sale in this file's
  // scenarios.
  async function cashSale(timestamp: Date, registerId: string): Promise<{ saleId: string }> {
    const ctx = cashContext(timestamp);
    const sale = await sales.createSale(ctx, branchIds, `sale-${randomUUID()}`, {
      branchId,
      items: [{ productId: cashProductId, quantity: '1' }],
    });
    await payments.createCashPayment(ctx, branchIds, `pay-${randomUUID()}`, {
      saleId: sale.value.sale.id,
      tenderedAmount: sale.value.sale.total,
      cashRegisterId: registerId,
    });
    return { saleId: sale.value.sale.id };
  }
  async function cardSale(timestamp: Date, amount: string): Promise<{ saleId: string }> {
    const ctx = cashContext(timestamp);
    // $100/unit product — quantity chosen to hit the exact requested
    // amount, mirroring the scenario's own round numbers.
    const quantity = (Number(amount) / 100).toString();
    const sale = await sales.createSale(ctx, branchIds, `sale-${randomUUID()}`, {
      branchId,
      items: [{ productId: cardProductId, quantity }],
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
    database = createDatabaseClient({ connectionString: databaseUrl, applicationName: 'asone-cash-card-reconciliation-integration' });

    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'CardRecon Co','CardRecon Co',$2,'active','UTC','MXN','es-MX'),
             ($3,'Other CardRecon Co','Other CardRecon Co',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `cardrecon-${companyId}`, otherCompanyId, `cardrecon-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'CardRecon Main','CRMAIN','active','America/Mexico_City'),
             ($3,$4,'CardRecon Other Co','CROTHER','active','UTC')`,
      [branchId, companyId, otherCompanyBranchId, otherCompanyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'CardRecon Actor','active'),($3,$4,$4,'CardRecon Other Co User','active')`,
      [userId, `cardrecon-${userId}@example.test`, otherCompanyUserId, `cardrecon-${otherCompanyUserId}@example.test`],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status) values($1,$2,$3,'active'),($4,$5,$6,'active')`,
      [randomUUID(), companyId, userId, randomUUID(), otherCompanyId, otherCompanyUserId],
    );
    await database.pool.query(
      `insert into products
       (id,company_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
       values($1,$2,'CR-CASH','cr-cash','Entrada','simple',false,'IVA_EXEMPT','active',$3,$3),
             ($4,$2,'CR-CARD','cr-card','Entrada Premium','simple',false,'IVA_EXEMPT','active',$3,$3)`,
      [cashProductId, companyId, userId, cardProductId],
    );
    await database.pool.query(
      `insert into product_prices (id,company_id,product_id,amount,currency_code,status,created_by,updated_by)
       values($1,$2,$3,'100.0000','MXN','active',$4,$4),
             ($5,$2,$6,'100.0000','MXN','active',$4,$4)`,
      [randomUUID(), companyId, cashProductId, userId, randomUUID(), cardProductId],
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
  });

  afterAll(async () => {
    const companyIds = [companyId, otherCompanyId];
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
    await database.pool.query('delete from product_prices where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from products where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from idempotency_keys where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from outbox_events where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from audit_log where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from company_memberships where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from branches where company_id=any($1)', [companyIds]);
    await database.pool.query('delete from companies where id=any($1)', [companyIds]);
    await database.pool.query('delete from users where id=any($1)', [[userId, otherCompanyUserId]]);
    await database.close();
  });

  describe('deterministic reconciliation (TASK 16.14A §20)', () => {
    it('an exact-match reconciliation across two terminals leaves cash expected untouched', async () => {
      const register = await cash.createRegister(cashContext(new Date('2026-09-20T07:00:00.000Z')), branchIds, `reg-${randomUUID()}`, {
        branchId,
        code: `CR-REG-${randomUUID().slice(0, 8)}`,
        name: 'Caja CardRecon',
      });
      const opened = await cash.openSession(cashContext(new Date('2026-09-20T08:00:00.000Z')), branchIds, `open-${randomUUID()}`, {
        cashRegisterId: register.value.id,
        openingAmount: '500.0000',
      });

      // Cash sale — 100. Card payments — 600 + 400 = 1000 gross, then a
      // 100 card refund → net 900.
      await cashSale(new Date('2026-09-20T09:00:00.000Z'), register.value.id);
      const { saleId: cardSaleId } = await cardSale(new Date('2026-09-20T09:05:00.000Z'), '600.0000');
      await cardSale(new Date('2026-09-20T09:10:00.000Z'), '400.0000');
      const cardSaleDetail = await sales.sale(companyId, branchIds, cardSaleId);
      const cardLine = cardSaleDetail.items[0];
      if (cardLine === undefined) throw new Error('unreachable');
      const refundCreated = await refunds.createRefund(refundContext(new Date('2026-09-20T09:15:00.000Z')), branchIds, `refund-${randomUUID()}`, {
        saleId: cardSaleId,
        reasonCode: 'customer_changed_mind',
        items: [{ saleItemId: cardLine.id, quantity: '1' }],
      });
      const refundCompleted = await refunds.completeRefund(
        refundContext(new Date('2026-09-20T09:16:00.000Z')),
        branchIds,
        `refund-complete-${randomUUID()}`,
        refundCreated.value.id,
        { cashRegisterId: register.value.id },
      );
      expect(refundCompleted.value.refundMethod).toBe('card_manual');
      expect(refundCompleted.value.total).toBe('100.0000');

      // Cash expected is 500 (open) + 100 (cash sale) = 600 — the card
      // sales/refund never touch it (§3).
      const summaryBefore = await cash.summary(companyId, branchIds, opened.value.id);
      expect(summaryBefore.expectedCash).toBe('600.0000');
      const cardPreview = summaryBefore.paymentMethodTotals.find((row) => row.method === 'card_manual');
      expect(cardPreview).toMatchObject({ grossSalesTotal: '1000.0000', refundsTotal: '100.0000', netTotal: '900.0000' });

      const closed = await cash.closeSession(cashContext(new Date('2026-09-20T18:00:00.000Z')), branchIds, `close-${randomUUID()}`, opened.value.id, {
        declaredClosingAmount: '600.0000',
        cardReconciliation: {
          entries: [
            { label: 'Terminal A', amount: '500.0000' },
            { label: 'Terminal B', amount: '400.0000' },
          ],
        },
      });

      // Cash-drawer figures are bit-for-bit what they'd be with NO card
      // reconciliation submitted at all — the two are structurally
      // independent (§3).
      expect(closed.value.expectedClosingAmount).toBe('600.0000');
      expect(closed.value.discrepancyAmount).toBe('0.0000');

      const reconciliation = closed.value.cardReconciliation;
      expect(reconciliation).not.toBeNull();
      if (reconciliation === null) throw new Error('unreachable');
      expect(reconciliation.systemGrossTotal).toBe('1000.0000');
      expect(reconciliation.systemRefundTotal).toBe('100.0000');
      expect(reconciliation.systemNetTotal).toBe('900.0000');
      expect(reconciliation.terminalEntries).toHaveLength(2);
      expect(reconciliation.terminalEntries.map((entry) => entry.label)).toEqual(['Terminal A', 'Terminal B']);
      expect(reconciliation.terminalTotal).toBe('900.0000');
      expect(reconciliation.difference).toBe('0.0000');
      expect(reconciliation.status).toBe('reconciled');
      expect(reconciliation.note).toBeNull();
      // Each entry gets a real, unique, server-generated id — never
      // client-supplied.
      const ids = reconciliation.terminalEntries.map((entry) => entry.id);
      expect(new Set(ids).size).toBe(2);
    });

    it('a mismatched terminal total is a discrepancy, carries the operator note, and still never touches cash', async () => {
      const register = await cash.createRegister(cashContext(new Date('2026-09-21T07:00:00.000Z')), branchIds, `reg-${randomUUID()}`, {
        branchId,
        code: `CR-REG-B-${randomUUID().slice(0, 8)}`,
        name: 'Caja CardRecon Discrepancy',
      });
      const opened = await cash.openSession(cashContext(new Date('2026-09-21T08:00:00.000Z')), branchIds, `open-${randomUUID()}`, {
        cashRegisterId: register.value.id,
        openingAmount: '0.0000',
      });
      await cardSale(new Date('2026-09-21T09:00:00.000Z'), '900.0000');

      const closed = await cash.closeSession(cashContext(new Date('2026-09-21T18:00:00.000Z')), branchIds, `close-${randomUUID()}`, opened.value.id, {
        declaredClosingAmount: '0.0000',
        cardReconciliation: {
          entries: [{ label: 'Terminal Único', amount: '875.0000' }],
          note: 'Prueba de conciliación.',
        },
      });

      expect(closed.value.expectedClosingAmount).toBe('0.0000');
      expect(closed.value.discrepancyAmount).toBe('0.0000');
      const reconciliation = closed.value.cardReconciliation;
      expect(reconciliation).not.toBeNull();
      if (reconciliation === null) throw new Error('unreachable');
      expect(reconciliation.systemNetTotal).toBe('900.0000');
      expect(reconciliation.terminalTotal).toBe('875.0000');
      // terminalTotal - systemNetTotal = 875 - 900 = -25.
      expect(reconciliation.difference).toBe('-25.0000');
      expect(reconciliation.status).toBe('discrepancy');
      expect(reconciliation.note).toBe('Prueba de conciliación.');
    });
  });

  describe('pending vs. zero vs. not applicable (TASK 16.14A §10)', () => {
    it('zero card sales never asks for reconciliation at all', async () => {
      const register = await cash.createRegister(cashContext(new Date('2026-09-22T07:00:00.000Z')), branchIds, `reg-${randomUUID()}`, {
        branchId,
        code: `CR-REG-C-${randomUUID().slice(0, 8)}`,
        name: 'Caja Sin Tarjeta',
      });
      const opened = await cash.openSession(cashContext(new Date('2026-09-22T08:00:00.000Z')), branchIds, `open-${randomUUID()}`, {
        cashRegisterId: register.value.id,
        openingAmount: '0.0000',
      });
      await cashSale(new Date('2026-09-22T09:00:00.000Z'), register.value.id);

      const closed = await cash.closeSession(cashContext(new Date('2026-09-22T18:00:00.000Z')), branchIds, `close-${randomUUID()}`, opened.value.id, {
        declaredClosingAmount: '100.0000',
      });
      const reconciliation = closed.value.cardReconciliation;
      expect(reconciliation).not.toBeNull();
      if (reconciliation === null) throw new Error('unreachable');
      expect(reconciliation.status).toBe('not_applicable');
      expect(reconciliation.systemGrossTotal).toBe('0.0000');
      expect(reconciliation.terminalEntries).toEqual([]);
    });

    it('card sales with reconciliation omitted are honestly PENDING, never a fabricated zero-difference reconciliation', async () => {
      const register = await cash.createRegister(cashContext(new Date('2026-09-29T07:30:00.000Z')), branchIds, `reg-${randomUUID()}`, {
        branchId,
        code: `CR-REG-D-${randomUUID().slice(0, 8)}`,
        name: 'Caja Pendiente',
      });
      const opened = await cash.openSession(cashContext(new Date('2026-09-29T08:30:00.000Z')), branchIds, `open-${randomUUID()}`, {
        cashRegisterId: register.value.id,
        openingAmount: '0.0000',
      });
      await cardSale(new Date('2026-09-29T09:30:00.000Z'), '300.0000');

      // No `cardReconciliation` key at all — the operator closed without
      // ever opening that section of the dialog.
      const closed = await cash.closeSession(cashContext(new Date('2026-09-29T18:30:00.000Z')), branchIds, `close-${randomUUID()}`, opened.value.id, {
        declaredClosingAmount: '0.0000',
      });
      const reconciliation = closed.value.cardReconciliation;
      expect(reconciliation).not.toBeNull();
      if (reconciliation === null) throw new Error('unreachable');
      expect(reconciliation.status).toBe('pending');
      expect(reconciliation.systemGrossTotal).toBe('300.0000');
      expect(reconciliation.terminalEntries).toEqual([]);
      // `pending` is the field the UI/print must key off — never treat a
      // `pending` reconciliation's own numeric `difference` as a real
      // shortage to display (see `_CommercialCloseSummary`'s own status
      // gate in `pos_shell.dart`).
    });

    it('an explicit zero-terminal reconciliation IS reconciled/discrepancy, never confused with pending', async () => {
      const register = await cash.createRegister(cashContext(new Date('2026-09-30T08:00:00.000Z')), branchIds, `reg-${randomUUID()}`, {
        branchId,
        code: `CR-REG-E-${randomUUID().slice(0, 8)}`,
        name: 'Caja Cero Explícito',
      });
      const opened = await cash.openSession(cashContext(new Date('2026-09-30T09:00:00.000Z')), branchIds, `open-${randomUUID()}`, {
        cashRegisterId: register.value.id,
        openingAmount: '0.0000',
      });
      await cardSale(new Date('2026-09-30T10:00:00.000Z'), '150.0000');

      const closed = await cash.closeSession(cashContext(new Date('2026-09-30T18:00:00.000Z')), branchIds, `close-${randomUUID()}`, opened.value.id, {
        declaredClosingAmount: '0.0000',
        cardReconciliation: { entries: [] },
      });
      const reconciliation = closed.value.cardReconciliation;
      expect(reconciliation).not.toBeNull();
      if (reconciliation === null) throw new Error('unreachable');
      // Explicitly submitted (even empty) → a real reconciliation attempt,
      // never `pending`.
      expect(reconciliation.status).toBe('discrepancy');
      expect(reconciliation.terminalTotal).toBe('0.0000');
      expect(reconciliation.difference).toBe('-150.0000');
    });
  });

  describe('idempotency (TASK 16.14A §21)', () => {
    it('a retried close with the same reconciliation replays without duplicating entries; a different reconciliation under the same key conflicts', async () => {
      const register = await cash.createRegister(cashContext(new Date('2026-09-23T07:00:00.000Z')), branchIds, `reg-${randomUUID()}`, {
        branchId,
        code: `CR-REG-F-${randomUUID().slice(0, 8)}`,
        name: 'Caja Idempotencia',
      });
      const opened = await cash.openSession(cashContext(new Date('2026-09-23T08:00:00.000Z')), branchIds, `open-${randomUUID()}`, {
        cashRegisterId: register.value.id,
        openingAmount: '0.0000',
      });
      await cardSale(new Date('2026-09-23T09:00:00.000Z'), '200.0000');

      const key = `close-cardrecon-${randomUUID()}`;
      const body = {
        declaredClosingAmount: '0.0000',
        cardReconciliation: { entries: [{ label: 'Terminal Único', amount: '200.0000' }] },
      };
      const closed = await cash.closeSession(cashContext(new Date('2026-09-23T18:00:00.000Z')), branchIds, key, opened.value.id, body);
      const firstEntryId = closed.value.cardReconciliation?.terminalEntries[0]?.id;
      expect(firstEntryId).toBeDefined();

      const replayed = await cash.closeSession(cashContext(new Date('2026-09-23T18:00:01.000Z')), branchIds, key, opened.value.id, body);
      expect(replayed.replayed).toBe(true);
      // The exact same persisted entry, never a freshly-generated second
      // one — proves the replay returns the STORED result rather than
      // re-running `buildCardReconciliation` (which would mint a new
      // `randomUUID()` for the entry).
      expect(replayed.value.cardReconciliation?.terminalEntries[0]?.id).toBe(firstEntryId);
      expect(replayed.value.cardReconciliation?.terminalEntries).toHaveLength(1);

      await expect(
        cash.closeSession(cashContext(new Date('2026-09-23T18:00:02.000Z')), branchIds, key, opened.value.id, {
          declaredClosingAmount: '0.0000',
          cardReconciliation: { entries: [{ label: 'Terminal Distinto', amount: '999.0000' }] },
        }),
      ).rejects.toMatchObject({ code: 'idempotency_conflict' });
    });
  });

  describe('no sensitive card data (TASK 16.14A §19)', () => {
    it('no field anywhere in the reconciliation shape can hold a PAN, CVV, or expiration', async () => {
      const register = await cash.createRegister(cashContext(new Date('2026-09-24T07:00:00.000Z')), branchIds, `reg-${randomUUID()}`, {
        branchId,
        code: `CR-REG-G-${randomUUID().slice(0, 8)}`,
        name: 'Caja PCI',
      });
      const opened = await cash.openSession(cashContext(new Date('2026-09-24T08:00:00.000Z')), branchIds, `open-${randomUUID()}`, {
        cashRegisterId: register.value.id,
        openingAmount: '0.0000',
      });
      await cardSale(new Date('2026-09-24T09:00:00.000Z'), '100.0000');
      const closed = await cash.closeSession(cashContext(new Date('2026-09-24T18:00:00.000Z')), branchIds, `close-${randomUUID()}`, opened.value.id, {
        declaredClosingAmount: '0.0000',
        cardReconciliation: {
          entries: [{ label: 'BBVA', amount: '100.0000', reference: 'LOTE-0042', note: 'Ticket físico archivado.' }],
        },
      });
      const reconciliation = closed.value.cardReconciliation;
      expect(reconciliation).not.toBeNull();
      if (reconciliation === null) throw new Error('unreachable');
      const shapeKeys = [
        ...Object.keys(reconciliation),
        ...reconciliation.terminalEntries.flatMap((entry) => Object.keys(entry)),
      ];
      const forbidden = /pan|card_number|cvv|cvc|expir|track|pin/i;
      for (const key of shapeKeys) expect(key).not.toMatch(forbidden);
      // The audit payload is equally clean — see `CashService.closeSession`'s
      // own `card_reconciliation_*` fields (status/difference/note only).
    });
  });

  describe('old close compatibility (TASK 16.14A §16)', () => {
    it('a session closed before this task reads back with card_reconciliation null, never fabricated', async () => {
      const register = await cash.createRegister(cashContext(new Date('2026-09-25T07:00:00.000Z')), branchIds, `reg-${randomUUID()}`, {
        branchId,
        code: `CR-REG-H-${randomUUID().slice(0, 8)}`,
        name: 'Caja Legacy CardRecon',
      });
      const opened = await cash.openSession(cashContext(new Date('2026-09-25T08:00:00.000Z')), branchIds, `open-${randomUUID()}`, {
        cashRegisterId: register.value.id,
        openingAmount: '0.0000',
      });
      // Simulate a TASK-16.14-but-pre-16.14A close: every 16.14 column
      // populated, `card_reconciliation` left NULL — exactly the shape
      // every real session closed before this migration has today.
      await database.pool.query(
        `update cash_sessions set status='closed', closed_by=$2, closed_at=$3,
           declared_closing_amount='0.0000', expected_closing_amount='0.0000',
           discrepancy_amount='0.0000', cash_sales_total='0.0000', cash_sales_count=0,
           cash_in_total='0.0000', cash_out_total='0.0000', withdrawal_total='0.0000',
           expense_total='0.0000', external_income_total='0.0000', cash_refund_total='0.0000',
           cash_refund_count=0, payment_method_totals='[]'::jsonb, version=version+1
         where company_id=$1 and id=$4`,
        [companyId, userId, new Date('2026-09-25T18:00:00.000Z'), opened.value.id],
      );
      const legacyClosed = await cash.session(companyId, branchIds, opened.value.id);
      expect(legacyClosed.status).toBe('closed');
      expect(legacyClosed.cashSalesTotal).toBe('0.0000');
      expect(legacyClosed.cardReconciliation).toBeNull();
    });
  });

  describe('tenant isolation (TASK 16.14A §22)', () => {
    it('another company cannot read this session’s card reconciliation', async () => {
      const register = await cash.createRegister(cashContext(new Date('2026-09-26T07:00:00.000Z')), branchIds, `reg-${randomUUID()}`, {
        branchId,
        code: `CR-REG-I-${randomUUID().slice(0, 8)}`,
        name: 'Caja Tenant',
      });
      const opened = await cash.openSession(cashContext(new Date('2026-09-26T08:00:00.000Z')), branchIds, `open-${randomUUID()}`, {
        cashRegisterId: register.value.id,
        openingAmount: '0.0000',
      });
      await cash.closeSession(cashContext(new Date('2026-09-26T18:00:00.000Z')), branchIds, `close-${randomUUID()}`, opened.value.id, {
        declaredClosingAmount: '0.0000',
        cardReconciliation: { entries: [] },
      });
      await expect(cash.session(otherCompanyId, [otherCompanyBranchId], opened.value.id)).rejects.toMatchObject({
        code: 'resource_not_found',
      });
    });
  });
});
