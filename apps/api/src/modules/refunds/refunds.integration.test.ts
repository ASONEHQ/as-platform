import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';

import { CashRepository } from '../cash/cash.repository.js';
import { CashService } from '../cash/cash.service.js';
import { PaymentRepository } from '../payments/payments.repository.js';
import { PaymentService } from '../payments/payments.service.js';
import { MercadoPagoClient } from '../payments/providers/mercado-pago.client.js';
import { MercadoPagoPointProvider } from '../payments/providers/mercado-pago.provider.js';
import { SalesRepository } from '../sales/sales.repository.js';
import { SalesService } from '../sales/sales.service.js';
import { RefundsRepository } from './refunds.repository.js';
import { RefundsService } from './refunds.service.js';
import { RefundError } from './refunds.types.js';

/** TASK 12.8 — the post-sale correction lifecycle: full/partial return,
 * exact snapshot-derived reversal, cash/inventory/payment atomicity, and
 * legacy-sale safety. Reconciled against `docs/CORE_DATA_MODEL.md` §6.6
 * and `docs/API_CONTRACTS.md` §17/§21.4 (E081–E086) — see ADR-0015 for
 * the full design. */
const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;
const migrationsPath = resolve(import.meta.dirname, '../../../../../packages/database/drizzle');

integration('PostgreSQL returns/refunds operations (TASK 12.8)', { concurrent: false }, () => {
  let database: DatabaseClient;
  let refunds: RefundsService;
  let sales: SalesService;
  let payments: PaymentService;
  let cash: CashService;
  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const branchId = randomUUID();
  const otherBranchId = randomUUID();
  const userId = randomUUID();
  const otherCompanyUserId = randomUUID();
  // A stock-tracked product priced at an intentionally awkward amount —
  // "rounding correct" needs a genuine non-round unit price, not a
  // coincidentally-exact one.
  const trackedProductId = randomUUID();
  const trackedVariantId = randomUUID();
  const locationId = randomUUID();
  // A non-stock (service/admission-style) product — Part I: proves a
  // non-trackable line is refunded (money) but never touches inventory.
  const serviceProductId = randomUUID();
  const context = {
    companyId,
    actorId: userId,
    actorPermissions: ['refund.create', 'refund.approve', 'refund.complete', 'refund.read'],
    requestId: 'refund-request',
    correlationId: 'refund-correlation',
    timestamp: new Date('2026-09-10T09:00:00.000Z'),
  };
  const branchIds = [branchId, otherBranchId];

  async function applyIfMissing(regclass: string, files: readonly string[]): Promise<void> {
    const check = await database.pool.query<{ present: string | null }>(
      `select to_regclass('public.${regclass}')::text present`,
    );
    if (check.rows[0]?.present !== null) return;
    for (const file of files) {
      const sql = await readFile(resolve(migrationsPath, file), 'utf8');
      for (const statement of sql.split('--> statement-breakpoint'))
        if (statement.trim().length > 0) await database.pool.query(statement);
    }
  }

  beforeAll(async () => {
    if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({ connectionString: databaseUrl, applicationName: 'asone-refunds-integration' });
    await applyIfMissing('companies', [
      '0000_fantastic_black_cat.sql',
      '0001_high_thor.sql',
      '0002_true_sugar_man.sql',
      '0003_curved_zuras.sql',
      '0004_pink_nehzno.sql',
      '0005_inventory_operations_foundation.sql',
      '0006_inventory_transfers_and_reservations.sql',
      '0007_inventory_counts_foundation.sql',
      '0008_inventory_reconciliation_findings.sql',
      '0009_auth_login_challenges.sql',
      '0010_auth_session_transport_mode.sql',
    ]);
    await applyIfMissing('product_prices', ['0011_product_pricing_foundation.sql']);
    await applyIfMissing('payment_terminals', ['0012_payment_and_terminal_foundation.sql']);
    await applyIfMissing('sales', ['0013_sale_foundation.sql', '0014_sale_id_required.sql']);
    const variantColumnPresent = await database.pool.query<{ present: boolean }>(
      `select exists(select 1 from information_schema.columns where table_name='sale_items' and column_name='product_variant_id') present`,
    );
    if (variantColumnPresent.rows[0]?.present !== true) {
      const sql = await readFile(resolve(migrationsPath, '0015_true_molecule_man.sql'), 'utf8');
      for (const statement of sql.split('--> statement-breakpoint'))
        if (statement.trim().length > 0) await database.pool.query(statement);
    }
    await applyIfMissing('cash_registers', ['0016_jittery_slayback.sql', '0017_gifted_vertigo.sql']);
    const denominationColumnPresent = await database.pool.query<{ present: boolean }>(
      `select exists(select 1 from information_schema.columns where table_name='cash_sessions' and column_name='denomination_counts') present`,
    );
    if (denominationColumnPresent.rows[0]?.present !== true) {
      const sql = await readFile(resolve(migrationsPath, '0018_glossy_mongu.sql'), 'utf8');
      for (const statement of sql.split('--> statement-breakpoint'))
        if (statement.trim().length > 0) await database.pool.query(statement);
    }
    await applyIfMissing('refunds', ['0019_nosy_the_twelve.sql']);

    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'Refund Co','Refund Co',$2,'active','UTC','MXN','es-MX'),
             ($3,'Other Refund Co','Other Refund Co',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `refund-${companyId}`, otherCompanyId, `refund-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'Refund Main','RMAIN','active','UTC'),($3,$2,'Refund Second','RSECOND','active','UTC')`,
      [branchId, companyId, otherBranchId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'Refund Cashier','active'),($3,$4,$4,'Other Co User','active')`,
      [userId, `refund-${userId}@example.test`, otherCompanyUserId, `refund-${otherCompanyUserId}@example.test`],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status)
       values($1,$2,$3,'active'),($4,$5,$6,'active')`,
      [randomUUID(), companyId, userId, randomUUID(), otherCompanyId, otherCompanyUserId],
    );
    await database.pool.query(
      `insert into products
       (id,company_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
       values($1,$2,'REFUND-TRACKED','refund-tracked','Refund Tracked','simple',true,'IVA_GENERAL','active',$3,$3),
             ($4,$2,'REFUND-SERVICE','refund-service','Refund Service','simple',false,'IVA_EXEMPT','active',$3,$3)`,
      [trackedProductId, companyId, userId, serviceProductId],
    );
    await database.pool.query(
      `insert into product_variants
       (id,company_id,product_id,sku,normalized_sku,name,unit_of_measure_code,quantity_scale,tracks_inventory,standard_cost,currency_code,is_default,option_signature,status,created_by,updated_by)
       values($1,$2,$3,'REFUND-TRACKED','refund-tracked','Variante','unit',0,true,5,'MXN',true,$4,'active',$5,$5)`,
      [trackedVariantId, companyId, trackedProductId, '2'.repeat(64), userId],
    );
    await database.pool.query(
      // 3.3333 is deliberately awkward — proves partial-return rounding
      // uses the exact same round-half-up algorithm as sale creation,
      // never a coincidentally-round number that would hide a bug.
      `insert into product_prices (id,company_id,product_id,amount,currency_code,status,created_by,updated_by)
       values($1,$2,$3,'3.3333','MXN','active',$4,$4),
             ($5,$2,$6,'20.0000','MXN','active',$4,$4)`,
      [randomUUID(), companyId, trackedProductId, userId, randomUUID(), serviceProductId],
    );
    await database.pool.query(
      `insert into inventory_locations (id,company_id,branch_id,code,normalized_code,name,location_type,status,allows_receiving,allows_issuing,is_default,created_by,updated_by)
       values($1,$2,$3,'MAIN','main','Main','main','active',true,true,true,$4,$4)`,
      [locationId, companyId, branchId, userId],
    );
    await database.pool.query(
      `insert into inventory_balances (id,company_id,branch_id,inventory_location_id,product_variant_id,quantity_on_hand,quantity_reserved,quantity_in_transit,average_unit_cost,version)
       values($1,$2,$3,$4,$5,'100',0,0,0,1)`,
      [randomUUID(), companyId, branchId, locationId, trackedVariantId],
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
    await database.pool.query('delete from refund_items where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from refunds where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from payment_attempts where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from payments where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from sale_items where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from sales where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from inventory_movement_lines where company_id in ($1,$2)', [companyId, otherCompanyId]);
    // `inventory_balances` FK-references its own `last_movement_id` back
    // into `inventory_movements`, so it must be cleared before the
    // movements themselves are deleted — the reverse order (movements
    // first) violates `inventory_balances_last_movement_scope_fk`.
    await database.pool.query('delete from inventory_balances where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from inventory_movements where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from inventory_locations where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from cash_movements where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from cash_sessions where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from cash_registers where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from idempotency_keys where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from outbox_events where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from audit_log where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from product_variants where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from product_prices where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from products where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from company_memberships where company_id in ($1,$2)', [companyId, otherCompanyId]);
    // The card-refund fixture test inserts its own `payment_terminals`/
    // `devices` rows directly — both must be cleared before `branches`
    // (devices FK-references branches; payment_terminals FK-references
    // devices).
    await database.pool.query('delete from payment_terminals where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from devices where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from branches where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from companies where id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from users where id in ($1,$2)', [userId, otherCompanyUserId]);
    await database.close();
  });

  /** Opens a register+session for [forBranchId] and completes a real cash
   * sale of [quantity] units of the tracked product, tendering
   * [tenderedAmount]. Returns the completed sale id and the session id
   * that received the `cash_sale` movement. */
  async function createTrackedCashSale(
    keySuffix: string,
    forBranchId: string,
    quantity: string,
    tenderedAmount: string,
  ): Promise<{ saleId: string; sessionId: string; registerId: string; total: string }> {
    const register = await cash.createRegister(context, branchIds, `reg-${keySuffix}`, {
      branchId: forBranchId,
      code: `REG-${keySuffix}`,
      name: `Caja ${keySuffix}`,
    });
    const session = await cash.openSession(context, branchIds, `session-${keySuffix}`, {
      cashRegisterId: register.value.id,
      openingAmount: '1000.0000',
    });
    const createdSale = await sales.createSale(context, branchIds, `sale-${keySuffix}`, {
      branchId: forBranchId,
      items: [{ productId: trackedProductId, quantity }],
    });
    const paid = await payments.createCashPayment(context, branchIds, `pay-${keySuffix}`, {
      saleId: createdSale.value.sale.id,
      tenderedAmount,
      cashRegisterId: register.value.id,
    });
    return {
      saleId: createdSale.value.sale.id,
      sessionId: session.value.id,
      registerId: register.value.id,
      total: paid.value.sale.total,
    };
  }

  // --- Full/partial return, snapshot pricing, rounding --------------------

  describe('return semantics and exact snapshot pricing', () => {
    it('a full return refunds the exact original line total using the frozen unit price, never today\'s catalog price', async () => {
      const { saleId } = await createTrackedCashSale('full-1', branchId, '3', '15.0000');
      // Change today's price — the refund must still use the *frozen*
      // 3.3333 snapshot, never this new value.
      await database.pool.query(
        `update product_prices set amount='999.0000' where company_id=$1 and product_id=$2`,
        [companyId, trackedProductId],
      );
      const saleRow = await sales.sale(companyId, branchIds, saleId);
      const item = saleRow.items[0];
      if (item === undefined) throw new Error('Expected a sale item.');
      // 3 × 3.3333 = 9.9999 subtotal; tax = round(9.9999*0.16) = 1.6000.
      expect(saleRow.sale.total).toBe('11.5999');
      const created = await refunds.createRefund(context, branchIds, `refund-full-1`, {
        saleId,
        reasonCode: 'customer_changed_mind',
        items: [{ saleItemId: item.id, quantity: '3' }],
      });
      expect(created.value.status).toBe('approved');
      expect(created.value.total).toBe(saleRow.sale.total); // exact match — frozen snapshot, not today's price.
      expect(created.value.subtotal).toBe('9.9999');
      expect(created.value.taxTotal).toBe('1.6000');

      await database.pool.query(`update product_prices set amount='3.3333' where company_id=$1 and product_id=$2`, [
        companyId,
        trackedProductId,
      ]);
    });

    it('a partial return refunds only the requested quantity, with exact round-half-up arithmetic', async () => {
      const { saleId } = await createTrackedCashSale('partial-1', branchId, '3', '20.0000');
      const saleRow = await sales.sale(companyId, branchIds, saleId);
      const item = saleRow.items[0];
      if (item === undefined) throw new Error('Expected a sale item.');
      const created = await refunds.createRefund(context, branchIds, `refund-partial-1`, {
        saleId,
        reasonCode: 'damaged',
        items: [{ saleItemId: item.id, quantity: '1' }],
      });
      // 1 × 3.3333 = 3.3333 subtotal; tax = round(3.3333*0.16) = 0.5333.
      expect(created.value.subtotal).toBe('3.3333');
      expect(created.value.taxTotal).toBe('0.5333');
      expect(created.value.total).toBe('3.8666');
    });

    it('multiple partial returns of the same sale item accumulate correctly and never exceed sold quantity', async () => {
      const { saleId } = await createTrackedCashSale('multi-1', branchId, '5', '30.0000');
      const saleRow = await sales.sale(companyId, branchIds, saleId);
      const item = saleRow.items[0];
      if (item === undefined) throw new Error('Expected a sale item.');
      const first = await refunds.createRefund(context, branchIds, 'refund-multi-1a', {
        saleId,
        reasonCode: 'partial_1',
        items: [{ saleItemId: item.id, quantity: '2' }],
      });
      expect(first.value.status).toBe('approved');
      const balanceAfterFirst = await refunds.refundableBalance(companyId, branchIds, saleId);
      expect(balanceAfterFirst.lines[0]?.refundableQuantity).toBe('3.000000');

      const second = await refunds.createRefund(context, branchIds, 'refund-multi-1b', {
        saleId,
        reasonCode: 'partial_2',
        items: [{ saleItemId: item.id, quantity: '3' }],
      });
      expect(second.value.status).toBe('approved');
      const balanceAfterSecond = await refunds.refundableBalance(companyId, branchIds, saleId);
      expect(balanceAfterSecond.lines[0]?.refundableQuantity).toBe('0.000000');
    });

    it('cannot exceed the sold quantity — a single over-limit request is rejected, and so is a second request that would push cumulative refunds over the limit', async () => {
      const { saleId } = await createTrackedCashSale('limit-1', branchId, '2', '10.0000');
      const saleRow = await sales.sale(companyId, branchIds, saleId);
      const item = saleRow.items[0];
      if (item === undefined) throw new Error('Expected a sale item.');
      await expect(
        refunds.createRefund(context, branchIds, 'refund-limit-1a', {
          saleId,
          reasonCode: 'x',
          items: [{ saleItemId: item.id, quantity: '3' }],
        }),
      ).rejects.toMatchObject({ code: 'refund_limit_exceeded' });

      // The database-locked cumulative check: 1 succeeds, then a second
      // request for 2 more (1+2=3 > sold 2) is rejected even though
      // neither request alone exceeds the sold quantity.
      await refunds.createRefund(context, branchIds, 'refund-limit-1b', {
        saleId,
        reasonCode: 'first',
        items: [{ saleItemId: item.id, quantity: '1' }],
      });
      await expect(
        refunds.createRefund(context, branchIds, 'refund-limit-1c', {
          saleId,
          reasonCode: 'second',
          items: [{ saleItemId: item.id, quantity: '2' }],
        }),
      ).rejects.toMatchObject({ code: 'refund_limit_exceeded' });
    });

    it('requires a non-blank reason', async () => {
      const { saleId } = await createTrackedCashSale('reason-1', branchId, '1', '10.0000');
      const saleRow = await sales.sale(companyId, branchIds, saleId);
      const item = saleRow.items[0];
      if (item === undefined) throw new Error('Expected a sale item.');
      await expect(
        refunds.createRefund(context, branchIds, 'refund-reason-1', {
          saleId,
          reasonCode: '   ',
          items: [{ saleItemId: item.id, quantity: '1' }],
        }),
      ).rejects.toMatchObject({ code: 'validation_error' });
    });

    it('only a completed sale is refundable', async () => {
      const created = await sales.createSale(context, branchIds, 'refund-notcompleted-1', {
        branchId,
        items: [{ productId: trackedProductId, quantity: '1' }],
      });
      const uncompletedItem = created.value.items[0];
      if (uncompletedItem === undefined) throw new Error('Expected a sale item.');
      await expect(
        refunds.createRefund(context, branchIds, 'refund-notcompleted-1-attempt', {
          saleId: created.value.sale.id,
          reasonCode: 'x',
          items: [{ saleItemId: uncompletedItem.id, quantity: '1' }],
        }),
      ).rejects.toMatchObject({ code: 'sale_not_refundable' });
      const balance = await refunds.refundableBalance(companyId, branchIds, created.value.sale.id);
      expect(balance.refundable).toBe(false);
    });

    it('idempotent duplicate creation replays the same refund, never creating two', async () => {
      const { saleId } = await createTrackedCashSale('idem-1', branchId, '1', '10.0000');
      const saleRow = await sales.sale(companyId, branchIds, saleId);
      const item = saleRow.items[0];
      if (item === undefined) throw new Error('Expected a sale item.');
      const first = await refunds.createRefund(context, branchIds, 'refund-idem-1', {
        saleId,
        reasonCode: 'x',
        items: [{ saleItemId: item.id, quantity: '1' }],
      });
      expect(first.replayed).toBe(false);
      const second = await refunds.createRefund(context, branchIds, 'refund-idem-1', {
        saleId,
        reasonCode: 'x',
        items: [{ saleItemId: item.id, quantity: '1' }],
      });
      expect(second.replayed).toBe(true);
      expect(second.value.id).toBe(first.value.id);
      const balance = await refunds.refundableBalance(companyId, branchIds, saleId);
      expect(balance.lines[0]?.refundableQuantity).toBe('0.000000'); // not double-counted.
    });

    it('an actor without refund.approve is rejected outright — never a silently stuck pending_approval row', async () => {
      const { saleId } = await createTrackedCashSale('noapprove-1', branchId, '1', '10.0000');
      const saleRow = await sales.sale(companyId, branchIds, saleId);
      const item = saleRow.items[0];
      if (item === undefined) throw new Error('Expected a sale item.');
      const unauthorizedContext = { ...context, actorPermissions: ['refund.create'] };
      await expect(
        refunds.createRefund(unauthorizedContext, branchIds, 'refund-noapprove-1', {
          saleId,
          reasonCode: 'x',
          items: [{ saleItemId: item.id, quantity: '1' }],
        }),
      ).rejects.toMatchObject({ code: 'refund_approval_required' });
    });

    it('branch isolation — a sale item outside the actor\'s authorized branches cannot be refunded', async () => {
      const { saleId } = await createTrackedCashSale('branchiso-1', branchId, '1', '10.0000');
      const saleRow = await sales.sale(companyId, branchIds, saleId);
      const item = saleRow.items[0];
      if (item === undefined) throw new Error('Expected a sale item.');
      await expect(
        refunds.createRefund(context, [otherBranchId] /* branchId excluded */, 'refund-branchiso-1', {
          saleId,
          reasonCode: 'x',
          items: [{ saleItemId: item.id, quantity: '1' }],
        }),
      ).rejects.toMatchObject({ code: 'resource_not_found' });
    });

    it('tenant isolation — a refund can never be read across companies', async () => {
      const { saleId } = await createTrackedCashSale('tenantiso-1', branchId, '1', '10.0000');
      const saleRow = await sales.sale(companyId, branchIds, saleId);
      const item = saleRow.items[0];
      if (item === undefined) throw new Error('Expected a sale item.');
      const created = await refunds.createRefund(context, branchIds, 'refund-tenantiso-1', {
        saleId,
        reasonCode: 'x',
        items: [{ saleItemId: item.id, quantity: '1' }],
      });
      await expect(refunds.refund(otherCompanyId, branchIds, created.value.id)).rejects.toMatchObject({
        code: 'resource_not_found',
      });
    });
  });

  // --- Cash refund atomicity/session semantics ------------------------------

  describe('cash refund transaction and session semantics', () => {
    it('a full cash refund withdraws exactly the sale total from the drawer — never the tendered amount', async () => {
      const { saleId, sessionId, registerId } = await createTrackedCashSale('cashfull-1', branchId, '3', '50.0000');
      const saleRow = await sales.sale(companyId, branchIds, saleId);
      const item = saleRow.items[0];
      if (item === undefined) throw new Error('Expected a sale item.');
      const before = await cash.summary(companyId, branchIds, sessionId);
      const created = await refunds.createRefund(context, branchIds, 'refund-cashfull-1', {
        saleId,
        reasonCode: 'customer_changed_mind',
        items: [{ saleItemId: item.id, quantity: '3' }],
      });
      // 3 × 3.3333 = 9.9999 + tax 1.6000 = 11.5999 — never the $50 tendered.
      expect(created.value.total).toBe('11.5999');
      const completed = await refunds.completeRefund(context, branchIds, 'refund-cashfull-1-complete', created.value.id, {
        cashRegisterId: registerId,
      });
      expect(completed.value.status).toBe('completed');
      expect(completed.value.cashSessionId).toBe(sessionId);
      const after = await cash.summary(companyId, branchIds, sessionId);
      const beforeUnits = Math.round(Number(before.expectedCash) * 10_000);
      const afterUnits = Math.round(Number(after.expectedCash) * 10_000);
      // Exact -$11.5999 drawer effect (compared via 4-decimal integer
      // units, never floating-point equality).
      expect(afterUnits).toBe(beforeUnits - 115_999);
      const movement = await database.pool.query<{ amount: string; movement_type: string }>(
        `select amount::text, movement_type from cash_movements where company_id=$1 and reference_type='refund' and reference_id=$2`,
        [companyId, created.value.id],
      );
      expect(movement.rows).toEqual([{ amount: '11.5999', movement_type: 'cash_refund' }]);
    });

    it('the current open session receives the refund movement; the original (now closed) session is never touched', async () => {
      const { saleId, sessionId: originalSessionId, registerId } = await createTrackedCashSale(
        'oldsession-1',
        branchId,
        '1',
        '10.0000',
      );
      const saleRow = await sales.sale(companyId, branchIds, saleId);
      const item = saleRow.items[0];
      if (item === undefined) throw new Error('Expected a sale item.');
      // Close the original session — simulates "yesterday's cash cut".
      await cash.closeSession(context, branchIds, 'oldsession-1-close', originalSessionId, {
        declaredClosingAmount: '1003.3333',
      });
      const closedBefore = await cash.session(companyId, branchIds, originalSessionId);
      expect(closedBefore.status).toBe('closed');

      // A new session opens today to process the refund.
      const newSession = await cash.openSession(context, branchIds, 'oldsession-1-newsession', {
        cashRegisterId: registerId,
        openingAmount: '500.0000',
      });
      const created = await refunds.createRefund(context, branchIds, 'refund-oldsession-1', {
        saleId,
        reasonCode: 'late_return',
        items: [{ saleItemId: item.id, quantity: '1' }],
      });
      const completed = await refunds.completeRefund(context, branchIds, 'refund-oldsession-1-complete', created.value.id, {
        cashRegisterId: registerId,
      });
      expect(completed.value.cashSessionId).toBe(newSession.value.id);
      expect(completed.value.cashSessionId).not.toBe(originalSessionId);

      const closedAfter = await cash.session(companyId, branchIds, originalSessionId);
      // The original closed session's own immutable closure fields are
      // completely unchanged.
      expect(closedAfter).toEqual(closedBefore);
      const movementsOnOldSession = await database.pool.query(
        `select 1 from cash_movements where company_id=$1 and cash_session_id=$2 and reference_type='refund'`,
        [companyId, originalSessionId],
      );
      expect(movementsOnOldSession.rows).toHaveLength(0);
    });

    it('completing a cash refund with no open session fails safely — no session is silently created', async () => {
      const { saleId, registerId } = await createTrackedCashSale('nosession-1', branchId, '1', '10.0000');
      const saleRow = await sales.sale(companyId, branchIds, saleId);
      const item = saleRow.items[0];
      if (item === undefined) throw new Error('Expected a sale item.');
      const created = await refunds.createRefund(context, branchIds, 'refund-nosession-1', {
        saleId,
        reasonCode: 'x',
        items: [{ saleItemId: item.id, quantity: '1' }],
      });
      // Close the sale's own register's session — the only open session
      // for that specific register — before attempting completion.
      const openSession = await cash.currentSession(companyId, branchIds, registerId);
      if (openSession === null) throw new Error('Expected an open session.');
      await cash.closeSession(context, branchIds, 'session-nosession-1-close', openSession.id, {
        declaredClosingAmount: openSession.openingAmount,
      });
      await expect(
        refunds.completeRefund(context, branchIds, 'refund-nosession-1-complete', created.value.id, {
          cashRegisterId: registerId,
        }),
      ).rejects.toMatchObject({ code: 'cash_session_required' });
    });

    it('duplicate completion retry never posts a second drawer movement', async () => {
      const { saleId, sessionId, registerId } = await createTrackedCashSale('dupcomplete-1', branchId, '1', '10.0000');
      const saleRow = await sales.sale(companyId, branchIds, saleId);
      const item = saleRow.items[0];
      if (item === undefined) throw new Error('Expected a sale item.');
      const created = await refunds.createRefund(context, branchIds, 'refund-dupcomplete-1', {
        saleId,
        reasonCode: 'x',
        items: [{ saleItemId: item.id, quantity: '1' }],
      });
      const first = await refunds.completeRefund(context, branchIds, 'refund-dupcomplete-1-complete', created.value.id, { cashRegisterId: registerId });
      expect(first.replayed).toBe(false);
      const second = await refunds.completeRefund(context, branchIds, 'refund-dupcomplete-1-complete', created.value.id, { cashRegisterId: registerId });
      expect(second.replayed).toBe(true);
      const count = await database.pool.query<{ count: string }>(
        `select count(*)::text as count from cash_movements where company_id=$1 and reference_type='refund' and reference_id=$2`,
        [companyId, created.value.id],
      );
      expect(count.rows[0]?.count).toBe('1');
      void sessionId;
    });

    it('the database itself refuses a second cash_refund movement for the same refund (durable guarantee)', async () => {
      const { saleId, sessionId, registerId } = await createTrackedCashSale('dbuq-1', branchId, '1', '10.0000');
      const saleRow = await sales.sale(companyId, branchIds, saleId);
      const item = saleRow.items[0];
      if (item === undefined) throw new Error('Expected a sale item.');
      const created = await refunds.createRefund(context, branchIds, 'refund-dbuq-1', {
        saleId,
        reasonCode: 'x',
        items: [{ saleItemId: item.id, quantity: '1' }],
      });
      await refunds.completeRefund(context, branchIds, 'refund-dbuq-1-complete', created.value.id, { cashRegisterId: registerId });
      await expect(
        database.pool.query(
          `insert into cash_movements (id,company_id,branch_id,cash_session_id,movement_type,amount,currency_code,reason_code,reference_type,reference_id,occurred_at,created_by)
           values ($1,$2,$3,$4,'cash_refund','1.0000','MXN','cash_refund','refund',$5,$6,$7)`,
          [randomUUID(), companyId, branchId, sessionId, created.value.id, context.timestamp, userId],
        ),
      ).rejects.toMatchObject({ constraint: 'cash_movements_refund_reference_uq' });
    });
  });

  // --- Inventory restoration -------------------------------------------------

  describe('inventory restoration', () => {
    it('restores exactly the returned quantity for a stock-tracked product, and a non-stock line is never posted to inventory', async () => {
      const balanceBefore = await database.pool.query<{ quantity_on_hand: string }>(
        `select quantity_on_hand::text from inventory_balances where company_id=$1 and branch_id=$2 and product_variant_id=$3`,
        [companyId, branchId, trackedVariantId],
      );
      const before = Number(balanceBefore.rows[0]?.quantity_on_hand ?? '0');

      const { saleId, registerId } = await createTrackedCashSale('restock-1', branchId, '4', '20.0000');
      const saleRow = await sales.sale(companyId, branchIds, saleId);
      const trackedItem = saleRow.items[0];
      if (trackedItem === undefined) throw new Error('Expected a sale item.');
      const afterSale = await database.pool.query<{ quantity_on_hand: string }>(
        `select quantity_on_hand::text from inventory_balances where company_id=$1 and branch_id=$2 and product_variant_id=$3`,
        [companyId, branchId, trackedVariantId],
      );
      expect(Number(afterSale.rows[0]?.quantity_on_hand)).toBe(before - 4);

      const created = await refunds.createRefund(context, branchIds, 'refund-restock-1', {
        saleId,
        reasonCode: 'defective',
        items: [{ saleItemId: trackedItem.id, quantity: '3' }], // partial: 3 of 4.
      });
      const completed = await refunds.completeRefund(context, branchIds, 'refund-restock-1-complete', created.value.id, {
        cashRegisterId: registerId,
      });
      expect(completed.value.status).toBe('completed');

      const afterReturn = await database.pool.query<{ quantity_on_hand: string }>(
        `select quantity_on_hand::text from inventory_balances where company_id=$1 and branch_id=$2 and product_variant_id=$3`,
        [companyId, branchId, trackedVariantId],
      );
      // before - 4 (sold) + 3 (returned) = before - 1.
      expect(Number(afterReturn.rows[0]?.quantity_on_hand)).toBe(before - 1);

      const returnMovement = await database.pool.query<{ movement_type: string; reference_type: string }>(
        `select movement_type, reference_type from inventory_movements where company_id=$1 and reference_type='refund' and reference_id=$2`,
        [companyId, created.value.id],
      );
      expect(returnMovement.rows).toEqual([{ movement_type: 'return', reference_type: 'refund' }]);

      // The original sale_consumption movement is completely untouched
      // (still posted, still referencing the sale — never edited/deleted).
      const originalMovement = await database.pool.query<{ status: string; movement_type: string }>(
        `select status, movement_type from inventory_movements where company_id=$1 and reference_type='sale' and reference_id=$2`,
        [companyId, saleId],
      );
      expect(originalMovement.rows).toEqual([{ status: 'posted', movement_type: 'sale_consumption' }]);
    });

    it('a non-stock (service) product refund never posts any inventory movement', async () => {
      const register = await cash.createRegister(context, branchIds, 'reg-nonstock-1', {
        branchId,
        code: 'REG-NONSTOCK-1',
        name: 'Caja NonStock',
      });
      await cash.openSession(context, branchIds, 'session-nonstock-1', {
        cashRegisterId: register.value.id,
        openingAmount: '0',
      });
      const createdSale = await sales.createSale(context, branchIds, 'sale-nonstock-1', {
        branchId,
        items: [{ productId: serviceProductId, quantity: '1' }],
      });
      await payments.createCashPayment(context, branchIds, 'pay-nonstock-1', {
        saleId: createdSale.value.sale.id,
        tenderedAmount: '20.00',
        cashRegisterId: register.value.id,
      });
      const saleRow = await sales.sale(companyId, branchIds, createdSale.value.sale.id);
      const item = saleRow.items[0];
      if (item === undefined) throw new Error('Expected a sale item.');
      const created = await refunds.createRefund(context, branchIds, 'refund-nonstock-1', {
        saleId: createdSale.value.sale.id,
        reasonCode: 'x',
        items: [{ saleItemId: item.id, quantity: '1' }],
      });
      const completed = await refunds.completeRefund(context, branchIds, 'refund-nonstock-1-complete', created.value.id, {
        cashRegisterId: register.value.id,
      });
      expect(completed.value.status).toBe('completed');
      const movements = await database.pool.query(
        `select 1 from inventory_movements where company_id=$1 and reference_type='refund' and reference_id=$2`,
        [companyId, created.value.id],
      );
      expect(movements.rows).toHaveLength(0);
      const items = await refunds.refundItems(companyId, branchIds, created.value.id);
      expect(items[0]?.restockDisposition).toBe('no_restock');
    });

    it('duplicate completion never restores inventory twice', async () => {
      const balanceBefore = await database.pool.query<{ quantity_on_hand: string }>(
        `select quantity_on_hand::text from inventory_balances where company_id=$1 and branch_id=$2 and product_variant_id=$3`,
        [companyId, branchId, trackedVariantId],
      );
      const before = Number(balanceBefore.rows[0]?.quantity_on_hand ?? '0');
      const { saleId, registerId } = await createTrackedCashSale('duprestock-1', branchId, '1', '10.0000');
      const saleRow = await sales.sale(companyId, branchIds, saleId);
      const item = saleRow.items[0];
      if (item === undefined) throw new Error('Expected a sale item.');
      const created = await refunds.createRefund(context, branchIds, 'refund-duprestock-1', {
        saleId,
        reasonCode: 'x',
        items: [{ saleItemId: item.id, quantity: '1' }],
      });
      await refunds.completeRefund(context, branchIds, 'refund-duprestock-1-complete', created.value.id, {
        cashRegisterId: registerId,
      });
      await refunds.completeRefund(context, branchIds, 'refund-duprestock-1-complete', created.value.id, {
        cashRegisterId: registerId,
      });
      const balanceAfter = await database.pool.query<{ quantity_on_hand: string }>(
        `select quantity_on_hand::text from inventory_balances where company_id=$1 and branch_id=$2 and product_variant_id=$3`,
        [companyId, branchId, trackedVariantId],
      );
      // before - 1 (sold) + 1 (returned once) = before — never restored
      // twice.
      expect(Number(balanceAfter.rows[0]?.quantity_on_hand)).toBe(before);
    });
  });

  // --- Payment reversal / card provider-neutral behavior ---------------------

  describe('payment reversal and card refund behavior', () => {
    it('a full refund reverses the original captured cash payment to `reversed`', async () => {
      const { saleId, registerId } = await createTrackedCashSale('paymentreverse-1', branchId, '1', '10.0000');
      const saleRow = await sales.sale(companyId, branchIds, saleId);
      const item = saleRow.items[0];
      if (item === undefined) throw new Error('Expected a sale item.');
      const created = await refunds.createRefund(context, branchIds, 'refund-paymentreverse-1', {
        saleId,
        reasonCode: 'x',
        items: [{ saleItemId: item.id, quantity: '1' }],
      });
      const completed = await refunds.completeRefund(
        context,
        branchIds,
        'refund-paymentreverse-1-complete',
        created.value.id,
        { cashRegisterId: registerId },
      );
      expect(completed.value.paymentId).not.toBeNull();
      const paymentRow = await database.pool.query<{ status: string }>(
        `select status from payments where company_id=$1 and id=$2`,
        [companyId, completed.value.paymentId],
      );
      expect(paymentRow.rows[0]?.status).toBe('reversed');
    });

    it('a partial refund never reverses the original payment — it stays captured', async () => {
      const { saleId, registerId } = await createTrackedCashSale('partialpayment-1', branchId, '4', '20.0000');
      const saleRow = await sales.sale(companyId, branchIds, saleId);
      const item = saleRow.items[0];
      if (item === undefined) throw new Error('Expected a sale item.');
      const paymentBefore = await database.pool.query<{ id: string; status: string }>(
        `select id, status from payments where company_id=$1 and sale_id=$2`,
        [companyId, saleId],
      );
      const created = await refunds.createRefund(context, branchIds, 'refund-partialpayment-1', {
        saleId,
        reasonCode: 'x',
        items: [{ saleItemId: item.id, quantity: '1' }], // 1 of 4 — partial.
      });
      await refunds.completeRefund(context, branchIds, 'refund-partialpayment-1-complete', created.value.id, {
        cashRegisterId: registerId,
      });
      const paymentAfter = await database.pool.query<{ status: string }>(
        `select status from payments where company_id=$1 and id=$2`,
        [companyId, paymentBefore.rows[0]?.id],
      );
      expect(paymentAfter.rows[0]?.status).toBe('captured');
    });

    it('a card refund is honestly rejected while Mercado Pago remains unconfigured — never a simulated success', async () => {
      const register = await cash.createRegister(context, branchIds, 'reg-card-1', {
        branchId,
        code: 'REG-CARD-1',
        name: 'Caja Card',
      });
      await cash.openSession(context, branchIds, 'session-card-1', {
        cashRegisterId: register.value.id,
        openingAmount: '0',
      });
      const createdSale = await sales.createSale(context, branchIds, 'sale-card-1', {
        branchId,
        items: [{ productId: trackedProductId, quantity: '1' }],
      });
      // Simulates a captured card_terminal payment (Mercado Pago paused —
      // never actually dispatched through the real provider) with a
      // fixture approved attempt carrying a provider order reference, the
      // exact shape `completeRefund` needs to even attempt a real
      // provider call.
      const deviceId = randomUUID();
      const terminalId = randomUUID();
      await database.pool.query(
        `insert into devices (id,company_id,branch_id,device_code,name,device_type,status)
         values ($1,$2,$3,'TERM-CARD-1','Card Terminal','card_terminal','active')`,
        [deviceId, companyId, branchId],
      );
      await database.pool.query(
        `insert into payment_terminals (id,company_id,branch_id,device_id,provider,provider_terminal_id,status)
         values ($1,$2,$3,$4,'mercado_pago','fixture-provider-terminal-id','active')`,
        [terminalId, companyId, branchId, deviceId],
      );
      const cardPaymentId = randomUUID();
      await database.pool.query(
        `insert into payments (id,company_id,branch_id,sale_id,payment_method,amount,currency_code,provider,terminal_id,status,created_by,captured_at,version,created_at,updated_at)
         values ($1,$2,$3,$4,'card_terminal',$5,'MXN','mercado_pago',$8,'captured',$6,$7,1,$7,$7)`,
        [
          cardPaymentId,
          companyId,
          branchId,
          createdSale.value.sale.id,
          createdSale.value.sale.total,
          userId,
          context.timestamp,
          terminalId,
        ],
      );
      await database.pool.query(
        `insert into payment_attempts (id,company_id,payment_id,attempt_number,status,provider_reference,requested_at,responded_at,version,created_at,updated_at)
         values ($1,$2,$3,1,'approved','fixture-order-id',$4,$4,1,$4,$4)`,
        [randomUUID(), companyId, cardPaymentId, context.timestamp],
      );
      await database.pool.query(`update sales set status='completed', completed_at=$3, paid_total=total where company_id=$1 and id=$2`, [
        companyId,
        createdSale.value.sale.id,
        context.timestamp,
      ]);
      const saleRow = await sales.sale(companyId, branchIds, createdSale.value.sale.id);
      const item = saleRow.items[0];
      if (item === undefined) throw new Error('Expected a sale item.');
      const created = await refunds.createRefund(context, branchIds, 'refund-card-1', {
        saleId: createdSale.value.sale.id,
        reasonCode: 'x',
        items: [{ saleItemId: item.id, quantity: '1' }],
      });
      expect(created.value.refundMethod).toBe('card_terminal');
      await expect(
        refunds.completeRefund(context, branchIds, 'refund-card-1-complete', created.value.id, {}),
      ).rejects.toMatchObject({ code: 'payment_not_reversible' });
      // Never partially committed: the refund stays `approved`, not a
      // fabricated `completed`.
      const after = await refunds.refund(companyId, branchIds, created.value.id);
      expect(after.status).toBe('approved');
      expect(after.completedAt).toBeNull();
    });
  });

  // --- Legacy sales -----------------------------------------------------------

  describe('legacy pre-12.8 sales', () => {
    it('a historical completed sale (inserted with the exact shape a pre-12.8 completion produced) can still be safely refunded', async () => {
      const register = await cash.createRegister(context, branchIds, 'reg-legacy-1', {
        branchId,
        code: 'REG-LEGACY-1',
        name: 'Caja Legacy',
      });
      const session = await cash.openSession(context, branchIds, 'session-legacy-1', {
        cashRegisterId: register.value.id,
        openingAmount: '0',
      });
      const legacySaleId = randomUUID();
      const legacyItemId = randomUUID();
      const legacyPaymentId = randomUUID();
      await database.pool.query(
        // cash_register_id/cash_session_id null — exactly what a genuine
        // pre-12.7 (and therefore pre-12.8) completed Sale looks like.
        `insert into sales (id,company_id,branch_id,sale_number,status,currency_code,subtotal,discount_total,tax_total,total,paid_total,occurred_at,completed_at,created_by,created_at,updated_at)
         values ($1,$2,$3,$4,'completed','MXN','20.0000','0.0000','3.2000','23.2000','23.2000',$5,$5,$6,$5,$5)`,
        [legacySaleId, companyId, branchId, `SALE-${legacySaleId.replaceAll('-', '')}`, context.timestamp, userId],
      );
      await database.pool.query(
        `insert into sale_items (id,company_id,branch_id,sale_id,line_number,product_id,product_variant_id,name_snapshot,quantity,unit_price,subtotal,tax_total,line_total,tax_snapshot,created_at)
         values ($1,$2,$3,$4,1,$5,$6,'Legacy Item','1.000000','20.0000','20.0000','3.2000','23.2000',$7,$8)`,
        [
          legacyItemId,
          companyId,
          branchId,
          legacySaleId,
          trackedProductId,
          trackedVariantId,
          JSON.stringify({ tax_code: 'IVA_GENERAL', basis_points: 1600 }),
          context.timestamp,
        ],
      );
      await database.pool.query(
        `insert into payments (id,company_id,branch_id,sale_id,payment_method,amount,currency_code,status,created_by,captured_at,version,created_at,updated_at)
         values ($1,$2,$3,$4,'cash','23.2000','MXN','captured',$5,$6,1,$6,$6)`,
        [legacyPaymentId, companyId, branchId, legacySaleId, userId, context.timestamp],
      );
      const created = await refunds.createRefund(context, branchIds, 'refund-legacy-1', {
        saleId: legacySaleId,
        reasonCode: 'legacy_return',
        items: [{ saleItemId: legacyItemId, quantity: '1' }],
      });
      expect(created.value.total).toBe('23.2000');
      const completed = await refunds.completeRefund(context, branchIds, 'refund-legacy-1-complete', created.value.id, {
        cashRegisterId: register.value.id,
      });
      expect(completed.value.status).toBe('completed');
      expect(completed.value.cashSessionId).toBe(session.value.id);
      // The legacy sale itself is completely unmodified — no backfill of
      // cash_register_id/cash_session_id, no mutation of its own rows.
      const legacyAfter = await database.pool.query<{ cash_register_id: string | null; cash_session_id: string | null }>(
        `select cash_register_id, cash_session_id from sales where id=$1`,
        [legacySaleId],
      );
      expect(legacyAfter.rows[0]).toEqual({ cash_register_id: null, cash_session_id: null });
    });
  });

  // --- Sales History refund state (Part Q) ------------------------------------

  describe('Sales History refund state derivation', () => {
    it('reports not_refunded, partially_refunded, and fully_refunded from the same batched lookup — never mutating sales.status', async () => {
      const { saleId: notRefundedSaleId } = await createTrackedCashSale('refundstate-none', branchId, '1', '10.0000');

      const { saleId: partialSaleId, registerId: partialRegisterId } = await createTrackedCashSale(
        'refundstate-partial',
        branchId,
        '4',
        '20.0000',
      );
      const partialSaleRow = await sales.sale(companyId, branchIds, partialSaleId);
      const partialItem = partialSaleRow.items[0];
      if (partialItem === undefined) throw new Error('Expected a sale item.');
      const partialRefund = await refunds.createRefund(context, branchIds, 'refund-refundstate-partial', {
        saleId: partialSaleId,
        reasonCode: 'x',
        items: [{ saleItemId: partialItem.id, quantity: '1' }], // 1 of 4 — partial.
      });
      await refunds.completeRefund(context, branchIds, 'refund-refundstate-partial-complete', partialRefund.value.id, {
        cashRegisterId: partialRegisterId,
      });

      const { saleId: fullSaleId, registerId: fullRegisterId } = await createTrackedCashSale(
        'refundstate-full',
        branchId,
        '2',
        '10.0000',
      );
      const fullSaleRow = await sales.sale(companyId, branchIds, fullSaleId);
      const fullItem = fullSaleRow.items[0];
      if (fullItem === undefined) throw new Error('Expected a sale item.');
      const fullRefund = await refunds.createRefund(context, branchIds, 'refund-refundstate-full', {
        saleId: fullSaleId,
        reasonCode: 'x',
        items: [{ saleItemId: fullItem.id, quantity: '2' }], // all 2 of 2 — full.
      });
      await refunds.completeRefund(context, branchIds, 'refund-refundstate-full-complete', fullRefund.value.id, {
        cashRegisterId: fullRegisterId,
      });

      const states = await sales.refundStatesForSales(companyId, [notRefundedSaleId, partialSaleId, fullSaleId]);
      expect(states.get(notRefundedSaleId)).toBe('not_refunded');
      expect(states.get(partialSaleId)).toBe('partially_refunded');
      expect(states.get(fullSaleId)).toBe('fully_refunded');

      // The original Sale rows themselves are completely untouched by any
      // of this — `status` stays `completed`, never a project-invented
      // 6th value, and the refund state is derived, not stored on the
      // sale (see ADR-0015).
      const statusRows = await database.pool.query<{ id: string; status: string }>(
        `select id, status from sales where id = any($1::uuid[])`,
        [[notRefundedSaleId, partialSaleId, fullSaleId]],
      );
      expect(statusRows.rows.every((row) => row.status === 'completed')).toBe(true);
    });

    it('a requested-but-not-yet-completed refund never flips the sale away from not_refunded', async () => {
      const { saleId } = await createTrackedCashSale('refundstate-pending', branchId, '1', '10.0000');
      const saleRow = await sales.sale(companyId, branchIds, saleId);
      const item = saleRow.items[0];
      if (item === undefined) throw new Error('Expected a sale item.');
      // Created (and self-approved to `approved`) but never completed —
      // no inventory/cash/payment effect has actually posted yet.
      await refunds.createRefund(context, branchIds, 'refund-refundstate-pending', {
        saleId,
        reasonCode: 'x',
        items: [{ saleItemId: item.id, quantity: '1' }],
      });
      const states = await sales.refundStatesForSales(companyId, [saleId]);
      expect(states.get(saleId)).toBe('not_refunded');
    });
  });

  it('is a genuine RefundError subclass for every domain rejection', async () => {
    await expect(refunds.refund(companyId, branchIds, randomUUID())).rejects.toBeInstanceOf(RefundError);
  });
});
