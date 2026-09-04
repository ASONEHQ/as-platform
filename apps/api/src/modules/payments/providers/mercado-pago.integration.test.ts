import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';

import { CashRepository } from '../../cash/cash.repository.js';
import { SalesRepository } from '../../sales/sales.repository.js';
import { SalesService } from '../../sales/sales.service.js';
import { PaymentRepository } from '../payments.repository.js';
import { PaymentService } from '../payments.service.js';
import { mapMercadoPagoOrderToAttemptStatus } from './mercado-pago.status-mapping.js';
import { MercadoPagoClient } from './mercado-pago.client.js';
import { MercadoPagoPointProvider } from './mercado-pago.provider.js';
import type { ProviderOrderSnapshot } from './payment-provider.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;
const migrationsPath = resolve(import.meta.dirname, '../../../../../../packages/database/drizzle');

function jsonResponse(status: number, body: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

integration(
  'Mercado Pago Point dispatch and settlement (TASK 12.4B.1)',
  { concurrent: false },
  () => {
    let database: DatabaseClient;
    let payments: PaymentService;
    let sales: SalesService;
    let fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>;
    const companyId = randomUUID();
    const branchId = randomUUID();
    const otherBranchId = randomUUID();
    const userId = randomUUID();
    const productId = randomUUID();
    const context = {
      companyId,
      actorId: userId,
      requestId: 'mp-request',
      correlationId: 'mp-correlation',
      timestamp: new Date('2026-09-05T12:00:00.000Z'),
    };
    const branchIds = [branchId, otherBranchId];

    beforeAll(async () => {
      if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
        throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
      database = createDatabaseClient({
        connectionString: databaseUrl,
        applicationName: 'asone-mercado-pago-integration',
      });
      const present = await database.pool.query<{ present: string | null }>(
        `select to_regclass('public.companies')::text present`,
      );
      if (present.rows[0]?.present === null) {
        for (const name of [
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
        ]) {
          const sql = await readFile(resolve(migrationsPath, name), 'utf8');
          for (const statement of sql.split('--> statement-breakpoint'))
            if (statement.trim().length > 0) await database.pool.query(statement);
        }
      }
      for (const [table, file] of [
        ['product_prices', '0011_product_pricing_foundation.sql'],
        ['payment_terminals', '0012_payment_and_terminal_foundation.sql'],
      ] as const) {
        const check = await database.pool.query<{ present: string | null }>(
          `select to_regclass('public.${table}')::text present`,
        );
        if (check.rows[0]?.present === null) {
          const sql = await readFile(resolve(migrationsPath, file), 'utf8');
          for (const statement of sql.split('--> statement-breakpoint'))
            if (statement.trim().length > 0) await database.pool.query(statement);
        }
      }
      const salesPresent = await database.pool.query<{ present: string | null }>(
        `select to_regclass('public.sales')::text present`,
      );
      if (salesPresent.rows[0]?.present === null) {
        for (const file of ['0013_sale_foundation.sql', '0014_sale_id_required.sql']) {
          const sql = await readFile(resolve(migrationsPath, file), 'utf8');
          for (const statement of sql.split('--> statement-breakpoint'))
            if (statement.trim().length > 0) await database.pool.query(statement);
        }
      }
      // TASK 12.6: `sale_items.product_variant_id` — every `insertSaleItem`
      // call (including this file's own `createSale` helper) now writes it.
      const variantColumnPresent = await database.pool.query<{ present: boolean }>(
        `select exists(
           select 1 from information_schema.columns
           where table_name='sale_items' and column_name='product_variant_id'
         ) present`,
      );
      if (variantColumnPresent.rows[0]?.present !== true) {
        const sql = await readFile(resolve(migrationsPath, '0015_true_molecule_man.sql'), 'utf8');
        for (const statement of sql.split('--> statement-breakpoint'))
          if (statement.trim().length > 0) await database.pool.query(statement);
      }
      await database.pool.query(
        `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
         values($1,'MP Co','MP Co',$2,'active','UTC','MXN','es-MX')`,
        [companyId, `mp-${companyId}`],
      );
      await database.pool.query(
        `insert into branches(id,company_id,name,code,status,timezone)
         values($1,$2,'Main','MAIN','active','UTC'),($3,$2,'Second','SECOND','active','UTC')`,
        [branchId, companyId, otherBranchId],
      );
      await database.pool.query(
        `insert into users(id,email,normalized_email,display_name,status)
         values($1,$2,$2,'MP User','active')`,
        [userId, `mp-${userId}@example.test`],
      );
      await database.pool.query(
        `insert into company_memberships(id,company_id,user_id,status) values($1,$2,$3,'active')`,
        [randomUUID(), companyId, userId],
      );
      await database.pool.query(
        `insert into products
         (id,company_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
         values($1,$2,'MP-PRODUCT','mp-product','MP Product','simple',false,'IVA_GENERAL','active',$3,$3)`,
        [productId, companyId, userId],
      );
      await database.pool.query(
        `insert into product_prices (id,company_id,product_id,amount,currency_code,status,created_by,updated_by)
         values($1,$2,$3,'100.0000','MXN','active',$4,$4)`,
        [randomUUID(), companyId, productId, userId],
      );
      const paymentRepository = new PaymentRepository(database);
      const salesRepository = new SalesRepository(database);
      fetchImpl = vi.fn(() => jsonResponse(201, { id: 'ORD-DEFAULT', status: 'created' }));
      const mercadoPagoProvider = new MercadoPagoPointProvider(
        new MercadoPagoClient({
          accessToken: 'TEST-fixture-token',
          apiBaseUrl: 'https://api.mercadopago.com',
          fetchImpl,
        }),
      );
      payments = new PaymentService(paymentRepository, salesRepository, mercadoPagoProvider, new CashRepository(database));
      sales = new SalesService(salesRepository);
    });

    afterAll(async () => {
      await database.pool.query('delete from payment_attempts where company_id=$1', [companyId]);
      await database.pool.query('delete from payments where company_id=$1', [companyId]);
      await database.pool.query('delete from payment_terminals where company_id=$1', [companyId]);
      await database.pool.query('delete from sale_items where company_id=$1', [companyId]);
      await database.pool.query('delete from sales where company_id=$1', [companyId]);
      await database.pool.query('delete from product_prices where company_id=$1', [companyId]);
      await database.pool.query('delete from products where company_id=$1', [companyId]);
      await database.pool.query('delete from devices where company_id=$1', [companyId]);
      await database.pool.query('delete from idempotency_keys where company_id=$1', [companyId]);
      await database.pool.query('delete from outbox_events where company_id=$1', [companyId]);
      await database.pool.query('delete from audit_log where company_id=$1', [companyId]);
      await database.pool.query('delete from company_memberships where company_id=$1', [companyId]);
      await database.pool.query('delete from branches where company_id=$1', [companyId]);
      await database.pool.query('delete from companies where id=$1', [companyId]);
      await database.pool.query('delete from users where id=$1', [userId]);
      await database.close();
    });

    async function insertMercadoPagoTerminal(targetBranchId = branchId): Promise<{ terminalId: string }> {
      const deviceId = randomUUID();
      await database.pool.query(
        `insert into devices(id,company_id,branch_id,device_code,name,device_type,status)
         values($1,$2,$3,$4,'MP Terminal','card_terminal','active')`,
        [deviceId, companyId, targetBranchId, `MP-DEV-${deviceId.slice(0, 8)}`],
      );
      const terminalId = randomUUID();
      await database.pool.query(
        `insert into payment_terminals
         (id,company_id,branch_id,device_id,provider,provider_terminal_id,status,created_at,updated_at)
         values($1,$2,$3,$4,'mercado_pago','NEWLAND_N950__FIXTURE','assigned',now(),now())`,
        [terminalId, companyId, targetBranchId, deviceId],
      );
      return { terminalId };
    }

    async function createSale(): Promise<string> {
      const created = await sales.createSale(context, branchIds, randomUUID(), {
        branchId,
        items: [{ productId, quantity: '1' }],
      });
      return created.value.sale.id; // total: 116.0000 (100 + 16% IVA)
    }

    it('dispatches a card_terminal payment to Mercado Pago and lands on awaiting_terminal — never approved by order creation alone', async () => {
      const { terminalId } = await insertMercadoPagoTerminal();
      fetchImpl.mockImplementationOnce(() =>
        jsonResponse(201, {
          id: 'ORD-DISPATCH-1',
          type: 'point',
          status: 'created',
          status_detail: 'created',
          transactions: { payments: [{ id: 'PAY-1', amount: '116.00', status: 'created' }] },
        }),
      );
      const saleId = await createSale();
      const created = await payments.createPayment(context, branchIds, `mp-dispatch-${randomUUID()}`, {
        branchId,
        saleId,
        paymentMethod: 'card_terminal',
        amount: '116.00',
        currencyCode: 'MXN',
        terminalId,
      });
      expect(created.value.attempt.status).toBe('awaiting_terminal');
      expect(created.value.attempt.providerReference).toBe('ORD-DISPATCH-1');
      expect(created.value.payment.status).toBe('pending');

      const [, init] = fetchImpl.mock.calls.at(-1) as unknown as [URL, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body).toMatchObject({ type: 'point', transactions: { payments: [{ amount: '116.0000' }] } });
    });

    it('never dispatches to a terminal belonging to another branch — rejected before any provider call', async () => {
      const { terminalId: otherBranchTerminalId } = await insertMercadoPagoTerminal(otherBranchId);
      const saleId = await createSale();
      const callsBefore = fetchImpl.mock.calls.length;
      await expect(
        payments.createPayment(context, branchIds, `mp-branch-mismatch-${randomUUID()}`, {
          branchId,
          saleId,
          paymentMethod: 'card_terminal',
          amount: '116.00',
          currencyCode: 'MXN',
          terminalId: otherBranchTerminalId,
        }),
      ).rejects.toMatchObject({ code: 'terminal_branch_mismatch' });
      expect(fetchImpl.mock.calls.length).toBe(callsBefore);
    });

    it('fails the attempt cleanly (never approved) when Mercado Pago rejects order creation, and a retry can then succeed', async () => {
      const { terminalId } = await insertMercadoPagoTerminal();
      fetchImpl.mockImplementationOnce(() => jsonResponse(500, { message: 'internal error' }));
      const saleId = await createSale();
      const created = await payments.createPayment(context, branchIds, `mp-dispatch-fail-${randomUUID()}`, {
        branchId,
        saleId,
        paymentMethod: 'card_terminal',
        amount: '116.00',
        currencyCode: 'MXN',
        terminalId,
      });
      expect(created.value.attempt.status).toBe('failed');
      expect(created.value.attempt.declineReason).toContain('provider_error');

      fetchImpl.mockImplementationOnce(() =>
        jsonResponse(201, {
          id: 'ORD-RETRY-1',
          status: 'created',
          transactions: { payments: [{ id: 'PAY-RETRY-1', amount: '116.00', status: 'created' }] },
        }),
      );
      const retried = await payments.retryAttempt(context, branchIds, created.value.payment.id, `mp-retry-${randomUUID()}`);
      expect(retried.value.status).toBe('awaiting_terminal');
      expect(retried.value.providerReference).toBe('ORD-RETRY-1');
    });

    it('fails the attempt cleanly when Mercado Pago rate-limits order creation (429)', async () => {
      const { terminalId } = await insertMercadoPagoTerminal();
      fetchImpl.mockImplementationOnce(() => jsonResponse(429, { message: 'too many requests' }));
      const saleId = await createSale();
      const created = await payments.createPayment(context, branchIds, `mp-rate-limit-${randomUUID()}`, {
        branchId,
        saleId,
        paymentMethod: 'card_terminal',
        amount: '116.00',
        currencyCode: 'MXN',
        terminalId,
      });
      expect(created.value.attempt.status).toBe('failed');
      expect(created.value.attempt.declineReason).toContain('rate_limited');
    });

    it('never sends a second Mercado Pago order on an idempotent replay of the same payment-creation request', async () => {
      const { terminalId } = await insertMercadoPagoTerminal();
      fetchImpl.mockImplementationOnce(() =>
        jsonResponse(201, {
          id: 'ORD-IDEMPOTENT-1',
          status: 'created',
          transactions: { payments: [{ id: 'PAY-IDEMPOTENT-1', amount: '116.00', status: 'created' }] },
        }),
      );
      const saleId = await createSale();
      const key = `mp-idempotent-${randomUUID()}`;
      const first = await payments.createPayment(context, branchIds, key, {
        branchId,
        saleId,
        paymentMethod: 'card_terminal',
        amount: '116.00',
        currencyCode: 'MXN',
        terminalId,
      });
      const callsAfterFirst = fetchImpl.mock.calls.length;
      const replay = await payments.createPayment(context, branchIds, key, {
        branchId,
        saleId,
        paymentMethod: 'card_terminal',
        amount: '116.00',
        currencyCode: 'MXN',
        terminalId,
      });
      expect(replay.replayed).toBe(true);
      expect(replay.value.payment.id).toBe(first.value.payment.id);
      expect(fetchImpl.mock.calls.length).toBe(callsAfterFirst);
    });

    it('completes the full flow end-to-end: dispatch → authoritative accredited mapping → approved → sale settled', async () => {
      const { terminalId } = await insertMercadoPagoTerminal();
      fetchImpl.mockImplementationOnce(() =>
        jsonResponse(201, {
          id: 'ORD-SETTLE-1',
          status: 'created',
          transactions: { payments: [{ id: 'PAY-SETTLE-1', amount: '116.00', status: 'created' }] },
        }),
      );
      const saleId = await createSale();
      const created = await payments.createPayment(context, branchIds, `mp-settle-${randomUUID()}`, {
        branchId,
        saleId,
        paymentMethod: 'card_terminal',
        amount: '116.00',
        currencyCode: 'MXN',
        terminalId,
      });
      expect(created.value.attempt.status).toBe('awaiting_terminal');

      // Simulate what the webhook route does after a valid signature and a
      // GET /v1/orders/{id} re-fetch: map the authoritative order, then
      // apply it through the same `transitionAttempt` the webhook uses.
      const authoritativeOrder: ProviderOrderSnapshot = {
        providerOrderId: 'ORD-SETTLE-1',
        orderStatus: 'processed',
        orderStatusDetail: 'processed',
        transactionId: 'PAY-SETTLE-1',
        transactionStatus: 'processed',
        transactionStatusDetail: 'accredited',
        paidAmount: '116.0000',
        currencyCode: null,
        raw: {},
      };
      const mapped = mapMercadoPagoOrderToAttemptStatus(authoritativeOrder, created.value.payment.amount);
      expect(mapped.accredited).toBe(true);
      await payments.transitionAttempt(context, branchIds, created.value.attempt.id, `mp-webhook-${randomUUID()}`, {
        status: mapped.attemptStatus,
        providerReference: 'ORD-SETTLE-1',
      });

      const settled = await payments.payment(companyId, branchIds, created.value.payment.id);
      expect(settled.payment.status).toBe('captured');
      const saleAfter = await sales.sale(companyId, branchIds, saleId);
      expect(saleAfter.sale.status).toBe('completed');
    });

    it('does not approve or settle when the accredited amount does not match the authoritative sale/payment amount', async () => {
      const { terminalId } = await insertMercadoPagoTerminal();
      fetchImpl.mockImplementationOnce(() =>
        jsonResponse(201, {
          id: 'ORD-MISMATCH-1',
          status: 'created',
          transactions: { payments: [{ id: 'PAY-MISMATCH-1', amount: '116.00', status: 'created' }] },
        }),
      );
      const saleId = await createSale();
      const created = await payments.createPayment(context, branchIds, `mp-mismatch-${randomUUID()}`, {
        branchId,
        saleId,
        paymentMethod: 'card_terminal',
        amount: '116.00',
        currencyCode: 'MXN',
        terminalId,
      });

      const tamperedOrder: ProviderOrderSnapshot = {
        providerOrderId: 'ORD-MISMATCH-1',
        orderStatus: 'processed',
        orderStatusDetail: 'processed',
        transactionId: 'PAY-MISMATCH-1',
        transactionStatus: 'processed',
        transactionStatusDetail: 'accredited',
        paidAmount: '1.0000', // far less than the real 116.0000
        currencyCode: null,
        raw: {},
      };
      const mapped = mapMercadoPagoOrderToAttemptStatus(tamperedOrder, created.value.payment.amount);
      expect(mapped.accredited).toBe(false);
      expect(mapped.attemptStatus).not.toBe('approved');
    });
  },
);
