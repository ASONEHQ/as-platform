import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';

import type { DatabaseClient as CashDatabaseClient } from '@asone/database';

import { CashRepository } from '../cash/cash.repository.js';
import { ProductCatalogRepository } from '../catalog/product-catalog.repository.js';
import { ProductCatalogService } from '../catalog/product-catalog.service.js';
import { PaymentRepository } from '../payments/payments.repository.js';
import { PaymentService } from '../payments/payments.service.js';
import { MercadoPagoClient } from '../payments/providers/mercado-pago.client.js';
import { MercadoPagoPointProvider } from '../payments/providers/mercado-pago.provider.js';
import { SalesRepository } from './sales.repository.js';
import { SalesService } from './sales.service.js';
import { SaleError } from './sales.types.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;
const migrationsPath = resolve(import.meta.dirname, '../../../../../packages/database/drizzle');

/** TASK 12.7: every nested describe block below whose tests reach
 * `PaymentService.createCashPayment` now needs an open cash session for
 * the branch(es) it exercises — one register per branch, a real
 * (non-fabricated) float. Cash-session behavior itself has its own
 * dedicated coverage; this is only what's needed to keep these
 * pre-existing cash-payment tests exercising the real end-to-end path. */
async function openCashSessionForBranch(
  database: CashDatabaseClient,
  companyId: string,
  branchId: string,
  actorId: string,
  timestamp: Date,
): Promise<string> {
  const registerId = randomUUID();
  await database.pool.query(
    `insert into cash_registers (id,company_id,branch_id,code,normalized_code,name,status,created_by,updated_by)
     values ($1,$2,$3,'MAIN','main','Main','active',$4,$4)`,
    [registerId, companyId, branchId, actorId],
  );
  await database.pool.query(
    `insert into cash_sessions (id,company_id,branch_id,cash_register_id,opened_by,opened_at,opening_amount,currency_code,status)
     values ($1,$2,$3,$4,$5,$6,'0.0000','MXN','open')`,
    [randomUUID(), companyId, branchId, registerId, actorId, timestamp],
  );
  return registerId;
}

integration('PostgreSQL sale foundation (TASK 12.4A.1)', { concurrent: false }, () => {
  let database: DatabaseClient;
  let sales: SalesService;
  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const branchId = randomUUID();
  const otherBranchId = randomUUID();
  const foreignBranchId = randomUUID();
  const userId = randomUUID();
  const otherCompanyUserId = randomUUID();
  // 16% (IVA_GENERAL) product, 40.0000 MXN — a 46.4000 total for 1 unit.
  const productId = randomUUID();
  // Exempt (0%) product, 20.0000 MXN — a 20.0000 total for 1 unit.
  const exemptProductId = randomUUID();
  // No active price at all — drives the "missing price" test.
  const noPriceProductId = randomUUID();
  // Draft (not active) — drives the "product not active" test.
  const draftProductId = randomUUID();
  const otherCompanyProductId = randomUUID();
  const context = {
    companyId,
    actorId: userId,
    requestId: 'sale-request',
    correlationId: 'sale-correlation',
    timestamp: new Date('2026-08-01T12:00:00.000Z'),
  };
  const branchIds = [branchId, otherBranchId];

  beforeAll(async () => {
    if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({
      connectionString: databaseUrl,
      applicationName: 'asone-sales-integration',
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
    // TASK 12.6 (Part A4/A2): `sale_items.product_variant_id` and the
    // `sale_consumption` movement type/idempotency index.
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
    // TASK 12.7: `cash_registers`/`cash_sessions`/`cash_movements` —
    // required by every cash-payment test in this file (nested
    // describe blocks below), which all now go through
    // `PaymentService.createCashPayment`'s mandatory open-session check.
    const cashTablesPresent = await database.pool.query<{ present: string | null }>(
      `select to_regclass('public.cash_registers')::text present`,
    );
    if (cashTablesPresent.rows[0]?.present === null) {
      for (const file of ['0016_jittery_slayback.sql', '0017_gifted_vertigo.sql']) {
        const sql = await readFile(resolve(migrationsPath, file), 'utf8');
        for (const statement of sql.split('--> statement-breakpoint'))
          if (statement.trim().length > 0) await database.pool.query(statement);
      }
    }
    // TASK 12.7 (Part J follow-up): `denomination_counts` — a later
    // migration than 0016/0017, so a test database that already had the
    // cash tables from an earlier run still needs this checked
    // independently.
    const denominationColumnPresent = await database.pool.query<{ present: boolean }>(
      `select exists(select 1 from information_schema.columns where table_name='cash_sessions' and column_name='denomination_counts') present`,
    );
    if (denominationColumnPresent.rows[0]?.present !== true) {
      const sql = await readFile(resolve(migrationsPath, '0018_glossy_mongu.sql'), 'utf8');
      for (const statement of sql.split('--> statement-breakpoint'))
        if (statement.trim().length > 0) await database.pool.query(statement);
    }
    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'Sales','Sales',$2,'active','UTC','MXN','es-MX'),
             ($3,'Other Sales','Other Sales',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `sales-${companyId}`, otherCompanyId, `sales-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'Main','MAIN','active','UTC'),
             ($3,$2,'Second','SECOND','active','UTC'),
             ($4,$5,'Foreign','FOREIGN','active','UTC')`,
      [branchId, companyId, otherBranchId, foreignBranchId, otherCompanyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'Sale User','active'),
             ($3,$4,$4,'Other Company User','active')`,
      [userId, `sales-${userId}@example.test`, otherCompanyUserId, `sales-${otherCompanyUserId}@example.test`],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status)
       values($1,$2,$3,'active'),
             ($4,$5,$6,'active')`,
      [randomUUID(), companyId, userId, randomUUID(), otherCompanyId, otherCompanyUserId],
    );
    await database.pool.query(
      `insert into products
       (id,company_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
       values($1,$2,'SALE-GENERAL','sale-general','General Product','simple',false,'IVA_GENERAL','active',$3,$3),
             ($4,$2,'SALE-EXEMPT','sale-exempt','Exempt Product','simple',false,'IVA_EXEMPT','active',$3,$3),
             ($5,$2,'SALE-NOPRICE','sale-noprice','No Price Product','simple',false,'IVA_GENERAL','active',$3,$3),
             ($6,$2,'SALE-DRAFT','sale-draft','Draft Product','simple',false,'IVA_GENERAL','draft',$3,$3),
             ($7,$8,'SALE-GENERAL','sale-general','Other Company Product','simple',false,'IVA_GENERAL','active',$9,$9)`,
      [
        productId,
        companyId,
        userId,
        exemptProductId,
        noPriceProductId,
        draftProductId,
        otherCompanyProductId,
        otherCompanyId,
        otherCompanyUserId,
      ],
    );
    await database.pool.query(
      `insert into product_prices
       (id,company_id,product_id,amount,currency_code,status,created_by,updated_by)
       values($1,$2,$3,'40.0000','MXN','active',$4,$4),
             ($5,$2,$6,'20.0000','MXN','active',$4,$4),
             ($7,$8,$9,'40.0000','MXN','active',$10,$10)`,
      [
        randomUUID(),
        companyId,
        productId,
        userId,
        randomUUID(),
        exemptProductId,
        randomUUID(),
        otherCompanyId,
        otherCompanyProductId,
        otherCompanyUserId,
      ],
    );
    const salesRepository = new SalesRepository(database);
    sales = new SalesService(salesRepository);
  });

  afterAll(async () => {
    await database.pool.query('delete from sale_items where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from sales where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from product_prices where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from products where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from idempotency_keys where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from outbox_events where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from audit_log where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from company_memberships where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from branches where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from companies where id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from users where id in ($1,$2)', [userId, otherCompanyUserId]);
    await database.close();
  });

  // --- Authoritative price/tax computation -------------------------------

  it('creates a sale, resolving server-authoritative price and IVA_GENERAL tax, never trusting a client total', async () => {
    const created = await sales.createSale(context, branchIds, 'sale-create-1', {
      branchId,
      items: [{ productId, quantity: '2' }],
    });
    expect(created.replayed).toBe(false);
    // 2 x 40.0000 = 80.0000 subtotal; 16% => 12.8000 tax; 92.8000 total.
    expect(created.value.sale).toMatchObject({
      branchId,
      status: 'pending_payment',
      currencyCode: 'MXN',
      subtotal: '80.0000',
      taxTotal: '12.8000',
      discountTotal: '0.0000',
      total: '92.8000',
    });
    expect(created.value.sale.saleNumber).toMatch(/^SALE-[0-9a-f]{32}$/u);
    expect(created.value.items).toHaveLength(1);
    expect(created.value.items[0]).toMatchObject({
      lineNumber: 1,
      productId,
      quantity: '2.000000',
      unitPrice: '40.0000',
      subtotal: '80.0000',
      taxTotal: '12.8000',
      lineTotal: '92.8000',
    });
    // Idempotent replay.
    const replay = await sales.createSale(context, branchIds, 'sale-create-1', {
      branchId,
      items: [{ productId, quantity: '2' }],
    });
    expect(replay.replayed).toBe(true);
    expect(replay.value.sale.id).toBe(created.value.sale.id);
  });

  it('computes zero tax for an IVA_EXEMPT product and sums multiple lines correctly', async () => {
    const created = await sales.createSale(context, branchIds, 'sale-create-multi-line', {
      branchId,
      items: [
        { productId, quantity: '1' },
        { productId: exemptProductId, quantity: '3' },
      ],
    });
    // Line 1: 40.0000 subtotal, 6.4000 tax. Line 2: 60.0000 subtotal, 0 tax.
    expect(created.value.sale).toMatchObject({
      subtotal: '100.0000',
      taxTotal: '6.4000',
      total: '106.4000',
    });
    expect(created.value.items).toHaveLength(2);
    expect(created.value.items[1]).toMatchObject({ taxTotal: '0.0000', lineTotal: '60.0000' });
  });

  it('ignores any client-submitted total — CreateSaleInput has no such field to tamper', async () => {
    const created = await sales.createSale(context, branchIds, 'sale-tamper-attempt', {
      branchId,
      items: [{ productId, quantity: '1' }],
      // @ts-expect-error deliberately attempting to inject a fabricated total
      total: '0.01',
    });
    expect(created.value.sale.total).toBe('46.4000');
  });

  // --- Validation ----------------------------------------------------------

  it('rejects a zero or malformed quantity', async () => {
    await expect(
      sales.createSale(context, branchIds, 'sale-qty-zero', {
        branchId,
        items: [{ productId, quantity: '0' }],
      }),
    ).rejects.toMatchObject({ code: 'validation_error' });
    await expect(
      sales.createSale(context, branchIds, 'sale-qty-malformed', {
        branchId,
        items: [{ productId, quantity: 'abc' }],
      }),
    ).rejects.toMatchObject({ code: 'validation_error' });
  });

  it('rejects an empty item list and a missing product_id', async () => {
    await expect(
      sales.createSale(context, branchIds, 'sale-empty-items', { branchId, items: [] }),
    ).rejects.toMatchObject({ code: 'validation_error' });
    await expect(
      sales.createSale(context, branchIds, 'sale-missing-product', {
        branchId,
        items: [{ productId: '', quantity: '1' }],
      }),
    ).rejects.toMatchObject({ code: 'validation_error' });
  });

  it('rejects an invalid (nonexistent) product', async () => {
    await expect(
      sales.createSale(context, branchIds, 'sale-invalid-product', {
        branchId,
        items: [{ productId: randomUUID(), quantity: '1' }],
      }),
    ).rejects.toMatchObject({ code: 'product_not_found' });
  });

  it('rejects a product that is not active (draft)', async () => {
    await expect(
      sales.createSale(context, branchIds, 'sale-draft-product', {
        branchId,
        items: [{ productId: draftProductId, quantity: '1' }],
      }),
    ).rejects.toMatchObject({ code: 'product_not_active' });
  });

  it('rejects a product with no active price', async () => {
    await expect(
      sales.createSale(context, branchIds, 'sale-missing-price', {
        branchId,
        items: [{ productId: noPriceProductId, quantity: '1' }],
      }),
    ).rejects.toMatchObject({ code: 'price_not_found' });
  });

  it('rejects a branch the actor is not authorized for', async () => {
    await expect(
      sales.createSale(context, branchIds, 'sale-foreign-branch', {
        branchId: foreignBranchId,
        items: [{ productId, quantity: '1' }],
      }),
    ).rejects.toMatchObject({ code: 'validation_error' });
  });

  // --- Isolation -------------------------------------------------------

  it('isolates sales by tenant — a foreign company cannot resolve this company product or read this sale', async () => {
    await expect(
      sales.createSale(
        { ...context, companyId: otherCompanyId },
        [foreignBranchId],
        'sale-cross-company-product',
        { branchId: foreignBranchId, items: [{ productId, quantity: '1' }] },
      ),
    ).rejects.toMatchObject({ code: 'product_not_found' });

    const created = await sales.createSale(context, branchIds, 'sale-for-isolation-read', {
      branchId,
      items: [{ productId, quantity: '1' }],
    });
    await expect(
      sales.sale(otherCompanyId, [foreignBranchId], created.value.sale.id),
    ).rejects.toMatchObject({ code: 'resource_not_found' });
  });

  it('isolates sales by branch — a session without this branch cannot read the sale', async () => {
    const created = await sales.createSale(context, branchIds, 'sale-for-branch-isolation', {
      branchId,
      items: [{ productId, quantity: '1' }],
    });
    await expect(sales.sale(companyId, [otherBranchId], created.value.sale.id)).rejects.toMatchObject({
      code: 'resource_not_found',
    });
    const read = await sales.sale(companyId, branchIds, created.value.sale.id);
    expect(read.sale.id).toBe(created.value.sale.id);
  });

  // --- Idempotency / duplicate replay -------------------------------------

  it('replays an exact duplicate creation request as a safe no-op, never creating a second sale', async () => {
    const first = await sales.createSale(context, branchIds, 'sale-duplicate-replay', {
      branchId,
      items: [{ productId, quantity: '1' }],
    });
    const replay = await sales.createSale(context, branchIds, 'sale-duplicate-replay', {
      branchId,
      items: [{ productId, quantity: '1' }],
    });
    expect(replay.replayed).toBe(true);
    expect(replay.value.sale.id).toBe(first.value.sale.id);
    const count = await database.pool.query<{ count: string }>(
      `select count(*)::text count from sales where company_id=$1 and id=$2`,
      [companyId, first.value.sale.id],
    );
    expect(count.rows[0]?.count).toBe('1');
  });

  it('rejects replaying the same idempotency key with a different request body', async () => {
    await sales.createSale(context, branchIds, 'sale-conflict-key', {
      branchId,
      items: [{ productId, quantity: '1' }],
    });
    await expect(
      sales.createSale(context, branchIds, 'sale-conflict-key', {
        branchId,
        items: [{ productId, quantity: '2' }],
      }),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' });
  });

  // --- Cancellation --------------------------------------------------------

  it('cancels a pending_payment sale and rejects cancelling an already-cancelled one', async () => {
    const created = await sales.createSale(context, branchIds, 'sale-for-cancel', {
      branchId,
      items: [{ productId, quantity: '1' }],
    });
    const cancelled = await sales.cancelSale(
      context,
      branchIds,
      created.value.sale.id,
      'sale-cancel-key',
      'customer_changed_mind',
    );
    expect(cancelled.value).toMatchObject({ status: 'cancelled', reasonCode: 'customer_changed_mind' });
    expect(cancelled.value.cancelledAt).not.toBeNull();
    expect(cancelled.value.cancelledBy).toBe(userId);
    await expect(
      sales.cancelSale(context, branchIds, created.value.sale.id, 'sale-cancel-again', 'too_late'),
    ).rejects.toMatchObject({ code: 'invalid_sale_state' });
  });

  it('replays an exact duplicate cancellation request as a safe no-op', async () => {
    const created = await sales.createSale(context, branchIds, 'sale-for-cancel-replay', {
      branchId,
      items: [{ productId, quantity: '1' }],
    });
    const first = await sales.cancelSale(
      context,
      branchIds,
      created.value.sale.id,
      'sale-cancel-replay-key',
      'test_reason',
    );
    const replay = await sales.cancelSale(
      context,
      branchIds,
      created.value.sale.id,
      'sale-cancel-replay-key',
      'test_reason',
    );
    expect(replay.replayed).toBe(true);
    expect(replay.value.version).toBe(first.value.version);
  });

  // --- Audit / outbox ----------------------------------------------------

  it('commits audit and outbox events atomically for a sale creation and its cancellation', async () => {
    const created = await sales.createSale(context, branchIds, 'sale-audit-outbox', {
      branchId,
      items: [{ productId, quantity: '1' }],
    });
    await sales.cancelSale(context, branchIds, created.value.sale.id, 'sale-audit-outbox-cancel', 'operator_error');
    const audit = await database.pool.query<{ count: string }>(
      `select count(*)::text count from audit_log where company_id=$1 and entity_id=$2`,
      [companyId, created.value.sale.id],
    );
    expect(Number(audit.rows[0]?.count)).toBeGreaterThanOrEqual(2);
    const outbox = await database.pool.query<{ event_type: string }>(
      `select event_type from outbox_events where company_id=$1 and aggregate_id=$2 order by occurred_at asc`,
      [companyId, created.value.sale.id],
    );
    expect(outbox.rows.map((row) => row.event_type)).toEqual(['sale.created', 'sale.cancelled']);
  });

  it('never stores money as a JS float — the sale total round-trips as an exact decimal string', async () => {
    const created = await sales.createSale(context, branchIds, 'sale-decimal-precision', {
      branchId,
      items: [{ productId, quantity: '3' }],
    });
    expect(typeof created.value.sale.total).toBe('string');
    const raw = await database.pool.query<{ total: string }>(`select total::text from sales where id=$1`, [
      created.value.sale.id,
    ]);
    // 3 x 40.0000 = 120.0000; +16% = 19.2000; total 139.2000.
    expect(raw.rows[0]?.total).toBe('139.2000');
    expect(created.value.sale.total).toBe('139.2000');
  });

  it('is a genuine SaleError subclass for every domain rejection', async () => {
    await expect(
      sales.createSale(context, branchIds, 'sale-error-type', { branchId, items: [] }),
    ).rejects.toBeInstanceOf(SaleError);
  });

  // --- Sale notes (TASK 14.3 Wave 1 Part B.4) -----------------------------
  // The legacy app's own save button never actually persisted this field —
  // every legacy sale note was permanently empty (see
  // `docs/LEGACY_FUNCTIONAL_PARITY.md`). This is the real, working fix:
  // written once at creation, immutable thereafter (no PATCH endpoint), and
  // it must round-trip through a real fetch, never just the in-memory
  // create response.
  describe('sale notes', () => {
    it('creates a sale with a note and the exact note string round-trips through a real fetch', async () => {
      const created = await sales.createSale(context, branchIds, 'sale-note-present-1', {
        branchId,
        items: [{ productId, quantity: '1' }],
        note: '  Cliente pidió factura — llamar antes de entregar.  ',
      });
      expect(created.value.sale.note).toBe('Cliente pidió factura — llamar antes de entregar.');

      const reread = await sales.sale(companyId, branchIds, created.value.sale.id);
      expect(reread.sale.note).toBe('Cliente pidió factura — llamar antes de entregar.');

      const raw = await database.pool.query<{ note: string | null }>(`select note from sales where id=$1`, [
        created.value.sale.id,
      ]);
      expect(raw.rows[0]?.note).toBe('Cliente pidió factura — llamar antes de entregar.');
    });

    it('creates a sale with no note and it reads back as null — never a silently-dropped empty string', async () => {
      const created = await sales.createSale(context, branchIds, 'sale-note-absent-1', {
        branchId,
        items: [{ productId, quantity: '1' }],
      });
      expect(created.value.sale.note).toBeNull();

      const reread = await sales.sale(companyId, branchIds, created.value.sale.id);
      expect(reread.sale.note).toBeNull();

      const raw = await database.pool.query<{ note: string | null }>(`select note from sales where id=$1`, [
        created.value.sale.id,
      ]);
      expect(raw.rows[0]?.note).toBeNull();
    });

    it('a whitespace-only note normalizes to null rather than being stored as an empty string', async () => {
      const created = await sales.createSale(context, branchIds, 'sale-note-blank-1', {
        branchId,
        items: [{ productId, quantity: '1' }],
        note: '   ',
      });
      expect(created.value.sale.note).toBeNull();
    });

    it('rejects a note over 2000 characters', async () => {
      await expect(
        sales.createSale(context, branchIds, 'sale-note-toolong-1', {
          branchId,
          items: [{ productId, quantity: '1' }],
          note: 'x'.repeat(2001),
        }),
      ).rejects.toMatchObject({ code: 'validation_error' });
    });
  });

  // --- Receipt (TASK 12.5B) -----------------------------------------------
  // The HTTP composition itself (`GET /sales/{id}/receipt`) is covered
  // with mocks in sales.routes.test.ts — this exercises the real,
  // persisted data every piece of that composition reads: `sales.sale`
  // and `SalesRepository.receiptOrganization` (this module), plus a real
  // `PaymentService` constructed the same way `payments.integration.test.ts`
  // does, needed to create a genuine captured cash payment.
  describe('receipt', () => {
    let payments: PaymentService;

    beforeAll(async () => {
      const paymentRepository = new PaymentRepository(database);
      const salesRepository = new SalesRepository(database);
      // Every terminal fixture in this describe stays 'unassigned' (none
      // are ever registered) — an unconfigured Mercado Pago client is
      // safe to construct, mirroring payments.integration.test.ts's own
      // identical justification.
      const mercadoPagoProvider = new MercadoPagoPointProvider(
        new MercadoPagoClient({ accessToken: undefined, apiBaseUrl: 'https://api.mercadopago.com' }),
      );
      const cashRepository = new CashRepository(database);
      payments = new PaymentService(paymentRepository, salesRepository, mercadoPagoProvider, cashRepository);
      await openCashSessionForBranch(database, companyId, branchId, userId, context.timestamp);
    });

    afterAll(async () => {
      // TASK 12.7: `sales.cash_register_id`/`cash_session_id` are real
      // FKs now. `sales`/`sale_items` are normally cleaned by the outer
      // `afterAll` (which runs *after* this one), so — since cash tables
      // can only be deleted once no `sales` row still references them —
      // this nested block deletes `sales`/`sale_items` itself too (the
      // outer afterAll's own later delete is then just a safe no-op).
      await database.pool.query('delete from payment_attempts where company_id in ($1,$2)', [
        companyId,
        otherCompanyId,
      ]);
      await database.pool.query('delete from payments where company_id in ($1,$2)', [companyId, otherCompanyId]);
      await database.pool.query('delete from sale_items where company_id in ($1,$2)', [companyId, otherCompanyId]);
      await database.pool.query('delete from sales where company_id in ($1,$2)', [companyId, otherCompanyId]);
      await database.pool.query('delete from cash_movements where company_id in ($1,$2)', [companyId, otherCompanyId]);
      await database.pool.query('delete from cash_sessions where company_id in ($1,$2)', [companyId, otherCompanyId]);
      await database.pool.query('delete from cash_registers where company_id in ($1,$2)', [companyId, otherCompanyId]);
    });

    it('composes a completed cash sale into a full receipt — business, cashier, items, and payment', async () => {
      const created = await sales.createSale(context, branchIds, 'receipt-cash-sale-1', {
        branchId,
        items: [{ productId, quantity: '1' }],
      });
      const cash = await payments.createCashPayment(context, branchIds, 'receipt-cash-payment-1', {
        saleId: created.value.sale.id,
        tenderedAmount: '50.00',
      });
      expect(cash.value.sale.status).toBe('completed');

      const { sale, items } = await sales.sale(companyId, branchIds, created.value.sale.id);
      expect(sale.status).toBe('completed');
      const organization = await sales.receiptOrganization(companyId, sale.id);
      expect(organization).toMatchObject({
        companyName: 'Sales',
        branchName: 'Main',
        cashierId: userId,
        cashierName: 'Sale User',
      });
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ nameSnapshot: 'General Product', unitPrice: '40.0000' });

      const { items: paymentRows } = await payments.listPayments(companyId, branchIds, { saleId: sale.id, limit: 50 });
      expect(paymentRows).toHaveLength(1);
      expect(paymentRows[0]).toMatchObject({
        paymentMethod: 'cash',
        status: 'captured',
        amount: '46.4000',
      });
      // Cash tender/change come from the persisted payment metadata
      // (TASK 12.5A) — never recomputed here.
      expect(paymentRows[0]?.metadata).toMatchObject({
        tendered_amount: '50.0000',
        change_amount: '3.6000',
      });
    });

    it("freezes the receipt's item name/price at sale time — a later product rename or price change never changes it", async () => {
      const created = await sales.createSale(context, branchIds, 'receipt-snapshot-sale-1', {
        branchId,
        items: [{ productId, quantity: '1' }],
      });
      // Rename the product and change its active price *after* the sale.
      await database.pool.query(`update products set name=$1 where id=$2`, [
        'Renamed Product (post-sale)',
        productId,
      ]);
      await database.pool.query(
        `update product_prices set status='cancelled' where company_id=$1 and product_id=$2 and status='active'`,
        [companyId, productId],
      );
      await database.pool.query(
        `insert into product_prices(id,company_id,product_id,amount,currency_code,status,created_by,updated_by)
         values($1,$2,$3,'999.0000','MXN','active',$4,$4)`,
        [randomUUID(), companyId, productId, userId],
      );

      const { items } = await sales.sale(companyId, branchIds, created.value.sale.id);
      // The receipt's own snapshot columns are untouched by either change.
      expect(items[0]).toMatchObject({ nameSnapshot: 'General Product', unitPrice: '40.0000' });

      // Restore the fixture for every test that runs after this one.
      await database.pool.query(`update products set name='General Product' where id=$1`, [productId]);
      await database.pool.query(
        `delete from product_prices where company_id=$1 and product_id=$2 and amount='999.0000'`,
        [companyId, productId],
      );
      await database.pool.query(
        `update product_prices set status='active' where company_id=$1 and product_id=$2 and amount='40.0000'`,
        [companyId, productId],
      );
    });

    it('returns a receipt for a pending_payment sale honestly — no payments yet, never an error', async () => {
      const created = await sales.createSale(context, branchIds, 'receipt-pending-sale-1', {
        branchId,
        items: [{ productId, quantity: '1' }],
      });
      const { sale } = await sales.sale(companyId, branchIds, created.value.sale.id);
      expect(sale.status).toBe('pending_payment');
      const { items: paymentRows } = await payments.listPayments(companyId, branchIds, {
        saleId: sale.id,
        limit: 50,
      });
      expect(paymentRows).toHaveLength(0);
    });

    it('returns a receipt for a cancelled sale honestly — reflects reality, never an error', async () => {
      const created = await sales.createSale(context, branchIds, 'receipt-cancelled-sale-1', {
        branchId,
        items: [{ productId, quantity: '1' }],
      });
      await sales.cancelSale(context, branchIds, created.value.sale.id, 'receipt-cancelled-sale-1-cancel', 'test');
      const { sale } = await sales.sale(companyId, branchIds, created.value.sale.id);
      expect(sale.status).toBe('cancelled');
    });

    it('isolates receipt organization data by tenant and rejects a nonexistent sale', async () => {
      const created = await sales.createSale(context, branchIds, 'receipt-tenant-isolation-1', {
        branchId,
        items: [{ productId, quantity: '1' }],
      });
      // A foreign company's own `receiptOrganization` lookup for this
      // sale finds nothing — scoped by `company_id`, exactly like `sale()`.
      const foreign = await sales.receiptOrganization(otherCompanyId, created.value.sale.id);
      expect(foreign).toBeNull();
      await expect(sales.sale(otherCompanyId, [otherBranchId], created.value.sale.id)).rejects.toMatchObject({
        code: 'resource_not_found',
      });

      const missing = await sales.receiptOrganization(companyId, randomUUID());
      expect(missing).toBeNull();
      await expect(sales.sale(companyId, branchIds, randomUUID())).rejects.toMatchObject({
        code: 'resource_not_found',
      });
    });

    it('isolates receipt reads by branch — a sale outside the authorized branch list is not found', async () => {
      const created = await sales.createSale(context, branchIds, 'receipt-branch-isolation-1', {
        branchId,
        items: [{ productId, quantity: '1' }],
      });
      await expect(sales.sale(companyId, [otherBranchId], created.value.sale.id)).rejects.toMatchObject({
        code: 'resource_not_found',
      });
    });

    it('receipt retrieval is read-only and idempotent — repeated retrieval never creates a duplicate payment or sale, or changes the sale version', async () => {
      const created = await sales.createSale(context, branchIds, 'receipt-readonly-sale-1', {
        branchId,
        items: [{ productId, quantity: '1' }],
      });
      await payments.createCashPayment(context, branchIds, 'receipt-readonly-payment-1', {
        saleId: created.value.sale.id,
        tenderedAmount: '46.40',
      });
      const first = await sales.sale(companyId, branchIds, created.value.sale.id);
      const countBefore = await database.pool.query<{ count: string }>(
        `select count(*)::text count from payments where sale_id=$1`,
        [created.value.sale.id],
      );
      // Retrieve the exact same "receipt" three more times.
      for (let i = 0; i < 3; i += 1) {
        await sales.sale(companyId, branchIds, created.value.sale.id);
        await sales.receiptOrganization(companyId, created.value.sale.id);
        await payments.listPayments(companyId, branchIds, { saleId: created.value.sale.id, limit: 50 });
      }
      const second = await sales.sale(companyId, branchIds, created.value.sale.id);
      const countAfter = await database.pool.query<{ count: string }>(
        `select count(*)::text count from payments where sale_id=$1`,
        [created.value.sale.id],
      );
      expect(second.sale.version).toBe(first.sale.version);
      expect(second.sale.status).toBe(first.sale.status);
      expect(countAfter.rows[0]?.count).toBe(countBefore.rows[0]?.count);
      expect(countAfter.rows[0]?.count).toBe('1');
    });
  });

  // --- Real-world QA regression: operational branch + company-wide price --
  //
  // A real browser QA session against the local dev database (a named
  // branch, a company-level-priced, inventory-tracked product, one unit)
  // hit `relation "sales" does not exist` — the local dev database's own
  // migrations 0012–0014 (`payment_and_terminal_foundation`,
  // `sale_foundation`, `sale_id_required`) had simply never been applied
  // to it (`pnpm --filter @asone/database db:migrate` had never been run
  // there — every integration test file instead bootstraps its own test
  // database fresh in `beforeAll`, so this gap was invisible to the
  // automated suite). This is not an application-code defect: `db:check`
  // already validates the migration files themselves, and every existing
  // test in this file already proves the pricing/tax/branch logic is
  // correct once the schema is actually present. This block instead
  // durably re-proves the exact *shape* of that real scenario — a named
  // branch, a single-unit, company-wide-priced, inventory-tracked,
  // 16%-tax product — never the real seeded ids/branch name themselves
  // (never hardcoded here), so a schema-provisioning regression would
  // still surface as a connection/relation failure in CI (which always
  // migrates fresh) rather than silently passing.
  describe('operational branch checkout (real-world QA regression)', () => {
    // A third, dedicated branch — deliberately distinct from `branchId`/
    // `otherBranchId` above, so "branch authorization remains enforced"
    // is proven against a branch this describe block owns end-to-end,
    // not one already implicitly authorized by outer fixtures.
    const qaBranchId = randomUUID();
    // $25.00 MXN, 16% IVA, company-wide price (no branch override) —
    // the exact real-world numbers the QA session hit ($25.00 subtotal +
    // $4.00 IVA = $29.00 total for one unit), on a synthetic product.
    const qaProductId = randomUUID();
    const qaVariantId = randomUUID();
    const qaLocationId = randomUUID();
    let payments: PaymentService;

    beforeAll(async () => {
      await database.pool.query(
        `insert into branches(id,company_id,name,code,status,timezone)
         values($1,$2,'QA Branch','QABR','active','UTC')`,
        [qaBranchId, companyId],
      );
      await database.pool.query(
        `insert into products
         (id,company_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
         values($1,$2,'QA-AGUA','qa-agua','QA Agua','simple',true,'IVA_GENERAL','active',$3,$3)`,
        [qaProductId, companyId, userId],
      );
      await database.pool.query(
        `insert into product_variants
         (id,company_id,product_id,sku,normalized_sku,name,unit_of_measure_code,quantity_scale,
          tracks_inventory,standard_cost,currency_code,is_default,option_signature,status,created_by,updated_by)
         values($1,$2,$3,'QA-AGUA','qa-agua','Variante','unit',0,true,10,'MXN',true,$4,'active',$5,$5)`,
        [qaVariantId, companyId, qaProductId, '0'.repeat(64), userId],
      );
      // TASK 12.6 (Part A3): the branch's own single active default
      // inventory location — proven against the real seeded database
      // (every one of the 6 real branches has exactly one) before relying
      // on it here. Without this row, `trySettleSale`'s inventory
      // sale-consumption posting would correctly refuse to guess a
      // location and throw `inventory_location_not_found`.
      await database.pool.query(
        `insert into inventory_locations
         (id,company_id,branch_id,code,normalized_code,name,location_type,status,
          allows_receiving,allows_issuing,is_default,created_by,updated_by)
         values($1,$2,$3,'MAIN','main','QA Almacén principal','main','active',true,true,true,$4,$4)`,
        [qaLocationId, companyId, qaBranchId, userId],
      );
      await database.pool.query(
        `insert into inventory_balances
         (id,company_id,branch_id,inventory_location_id,product_variant_id,
          quantity_on_hand,quantity_reserved,quantity_in_transit,average_unit_cost,version)
         values($1,$2,$3,$4,$5,'50.000000',0,0,0,1)`,
        [randomUUID(), companyId, qaBranchId, qaLocationId, qaVariantId],
      );
      // Company-wide price — `branch_id` is deliberately omitted (NULL),
      // mirroring TASK 12.3C's own seeded pricing scope, which
      // `SalesRepository.resolveProductLines` already resolves as
      // "branch override, else company default" (ADR-0009).
      await database.pool.query(
        `insert into product_prices
         (id,company_id,product_id,amount,currency_code,status,created_by,updated_by)
         values($1,$2,$3,'25.0000','MXN','active',$4,$4)`,
        [randomUUID(), companyId, qaProductId, userId],
      );
      const paymentRepository = new PaymentRepository(database);
      const salesRepository = new SalesRepository(database);
      const mercadoPagoProvider = new MercadoPagoPointProvider(
        new MercadoPagoClient({ accessToken: undefined, apiBaseUrl: 'https://api.mercadopago.com' }),
      );
      const cashRepository = new CashRepository(database);
      payments = new PaymentService(paymentRepository, salesRepository, mercadoPagoProvider, cashRepository);
      await openCashSessionForBranch(database, companyId, qaBranchId, userId, context.timestamp);
    });

    afterAll(async () => {
      await database.pool.query('delete from outbox_events where company_id=$1 and branch_id=$2', [
        companyId,
        qaBranchId,
      ]);
      await database.pool.query(
        'delete from audit_log where company_id=$1 and entity_id in (select id from inventory_movements where company_id=$1 and branch_id=$2)',
        [companyId, qaBranchId],
      );
      await database.pool.query('update inventory_balances set last_movement_id=null where company_id=$1 and branch_id=$2', [
        companyId,
        qaBranchId,
      ]);
      await database.pool.query(
        'delete from inventory_movement_lines where company_id=$1 and inventory_movement_id in (select id from inventory_movements where company_id=$1 and branch_id=$2)',
        [companyId, qaBranchId],
      );
      await database.pool.query('delete from inventory_movements where company_id=$1 and branch_id=$2', [
        companyId,
        qaBranchId,
      ]);
      await database.pool.query('delete from inventory_balances where company_id=$1 and branch_id=$2', [
        companyId,
        qaBranchId,
      ]);
      await database.pool.query('delete from inventory_locations where company_id=$1 and branch_id=$2', [
        companyId,
        qaBranchId,
      ]);
      await database.pool.query('delete from payment_attempts where company_id=$1', [companyId]);
      await database.pool.query('delete from payments where company_id=$1 and sale_id in (select id from sales where branch_id=$2)', [
        companyId,
        qaBranchId,
      ]);
      await database.pool.query('delete from sale_items where company_id=$1 and sale_id in (select id from sales where branch_id=$2)', [
        companyId,
        qaBranchId,
      ]);
      await database.pool.query('delete from sales where company_id=$1 and branch_id=$2', [companyId, qaBranchId]);
      // TASK 12.7: `sales.cash_register_id`/`cash_session_id` are real
      // FKs now — deleted only after `sales` itself is gone.
      await database.pool.query('delete from cash_movements where company_id=$1 and branch_id=$2', [
        companyId,
        qaBranchId,
      ]);
      await database.pool.query('delete from cash_sessions where company_id=$1 and branch_id=$2', [
        companyId,
        qaBranchId,
      ]);
      await database.pool.query('delete from cash_registers where company_id=$1 and branch_id=$2', [
        companyId,
        qaBranchId,
      ]);
      await database.pool.query('delete from product_prices where company_id=$1 and product_id=$2', [
        companyId,
        qaProductId,
      ]);
      await database.pool.query('delete from product_variants where company_id=$1 and product_id=$2', [
        companyId,
        qaProductId,
      ]);
      await database.pool.query('delete from products where id=$1', [qaProductId]);
      await database.pool.query('delete from branches where id=$1', [qaBranchId]);
    });

    it('creates a real pending_payment Sale for the operational branch with the authoritative $29.00 total', async () => {
      const created = await sales.createSale(context, [...branchIds, qaBranchId], 'qa-regression-sale-1', {
        branchId: qaBranchId,
        items: [{ productId: qaProductId, quantity: '1' }],
      });
      expect(created.value.sale).toMatchObject({
        branchId: qaBranchId,
        status: 'pending_payment',
        currencyCode: 'MXN',
        subtotal: '25.0000',
        taxTotal: '4.0000',
        discountTotal: '0.0000',
        total: '29.0000',
      });
    });

    it('still enforces branch authorization for the operational branch — an actor without it cannot sell there', async () => {
      await expect(
        sales.createSale(context, branchIds /* qaBranchId deliberately excluded */, 'qa-regression-unauth-1', {
          branchId: qaBranchId,
          items: [{ productId: qaProductId, quantity: '1' }],
        }),
      ).rejects.toMatchObject({ code: 'validation_error' });
    });

    it('reaches a real captured cash payment and completed Sale for the operational branch — the exact path '
      + '_CashPaymentDialog confirms — with the authoritative $29.00 total, never a fake/hardcoded total', async () => {
      const created = await sales.createSale(context, [...branchIds, qaBranchId], 'qa-regression-sale-2', {
        branchId: qaBranchId,
        items: [{ productId: qaProductId, quantity: '1' }],
      });
      expect(created.value.sale.total).toBe('29.0000');

      const cash = await payments.createCashPayment(context, [...branchIds, qaBranchId], 'qa-regression-cash-1', {
        saleId: created.value.sale.id,
        tenderedAmount: '29.00',
      });
      expect(cash.value.payment).toMatchObject({
        paymentMethod: 'cash',
        status: 'captured',
        amount: '29.0000',
        provider: null,
        terminalId: null,
      });
      expect(cash.value.changeAmount).toBe('0.0000');
      expect(cash.value.sale.status).toBe('completed');

      // TASK 12.6: the exact same real completion this QA regression
      // already proves also posts the sale's own inventory consumption —
      // one `sale_consumption` movement, referencing this sale, with the
      // branch's real default location and the real 1-unit quantity.
      const movement = await database.pool.query<{
        movement_type: string;
        status: string;
        reference_type: string;
        reference_id: string;
        branch_id: string;
      }>(
        `select movement_type, status, reference_type, reference_id, branch_id
         from inventory_movements where company_id=$1 and reference_id=$2`,
        [companyId, created.value.sale.id],
      );
      expect(movement.rows).toEqual([
        expect.objectContaining({
          movement_type: 'sale_consumption',
          status: 'posted',
          reference_type: 'sale',
          reference_id: created.value.sale.id,
          branch_id: qaBranchId,
        }),
      ]);
      const balance = await database.pool.query<{ quantity_on_hand: string }>(
        `select quantity_on_hand::text from inventory_balances
         where company_id=$1 and branch_id=$2 and inventory_location_id=$3 and product_variant_id=$4`,
        [companyId, qaBranchId, qaLocationId, qaVariantId],
      );
      // Two units consumed so far across this describe block's own two
      // completed sales (`qa-regression-cash-1` is this test's own; no
      // other test in this block captures a payment) — started at 50.
      expect(balance.rows[0]?.quantity_on_hand).toBe('49.000000');
    });
  });

  // --- TASK 12.6 Part A: inventory sale-consumption posting -------------
  describe('inventory sale-consumption posting (TASK 12.6)', () => {
    const invBranchId = randomUUID();
    const invBranch2Id = randomUUID();
    const noLocationBranchId = randomUUID();
    const invLocationId = randomUUID();
    const invLocation2Id = randomUUID();
    const trackedProductId = randomUUID();
    const trackedVariantId = randomUUID();
    const untrackedProductId = randomUUID();
    const untrackedVariantId = randomUUID();
    const lowStockProductId = randomUUID();
    const lowStockVariantId = randomUUID();
    const noLocationProductId = randomUUID();
    const noLocationVariantId = randomUUID();
    const otherCompanyBranchId = randomUUID();
    const otherCompanyLocationId = randomUUID();
    const otherCompanyProductId2 = randomUUID();
    const otherCompanyVariantId = randomUUID();
    let payments: PaymentService;

    async function insertProduct(
      id: string,
      variantId: string,
      company: string,
      code: string,
      tracks: boolean,
      user: string,
    ): Promise<void> {
      await database.pool.query(
        `insert into products
         (id,company_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
         values($1,$2,$3,$4,$5,'simple',$6,'IVA_GENERAL','active',$7,$7)`,
        [id, company, code, code.toLowerCase(), `Inv ${code}`, tracks, user],
      );
      await database.pool.query(
        `insert into product_variants
         (id,company_id,product_id,sku,normalized_sku,name,unit_of_measure_code,quantity_scale,
          tracks_inventory,standard_cost,currency_code,is_default,option_signature,status,created_by,updated_by)
         values($1,$2,$3,$4,$5,'Variante','unit',0,$6,10,'MXN',true,$7,'active',$8,$8)`,
        [
          variantId,
          company,
          id,
          code,
          code.toLowerCase(),
          tracks,
          randomUUID().replaceAll('-', '').padEnd(64, '0'),
          user,
        ],
      );
      await database.pool.query(
        `insert into product_prices (id,company_id,product_id,amount,currency_code,status,created_by,updated_by)
         values($1,$2,$3,'10.0000','MXN','active',$4,$4)`,
        [randomUUID(), company, id, user],
      );
    }

    beforeAll(async () => {
      await database.pool.query(
        `insert into branches(id,company_id,name,code,status,timezone)
         values($1,$2,'Inv Branch','INVB','active','UTC'),
               ($3,$2,'Inv Branch 2','INVB2','active','UTC'),
               ($4,$2,'No Location Branch','NOLOC','active','UTC')`,
        [invBranchId, companyId, invBranch2Id, noLocationBranchId],
      );
      await database.pool.query(
        `insert into branches(id,company_id,name,code,status,timezone) values($1,$2,'Inv Other Co Branch','INVOC','active','UTC')`,
        [otherCompanyBranchId, otherCompanyId],
      );
      await database.pool.query(
        `insert into inventory_locations
         (id,company_id,branch_id,code,normalized_code,name,location_type,status,allows_receiving,allows_issuing,is_default,created_by,updated_by)
         values($1,$2,$3,'MAIN','main','Main','main','active',true,true,true,$4,$4),
               ($5,$2,$6,'MAIN','main','Main 2','main','active',true,true,true,$4,$4)`,
        [invLocationId, companyId, invBranchId, userId, invLocation2Id, invBranch2Id],
      );
      await database.pool.query(
        `insert into inventory_locations
         (id,company_id,branch_id,code,normalized_code,name,location_type,status,allows_receiving,allows_issuing,is_default,created_by,updated_by)
         values($1,$2,$3,'MAIN','main','Other Co Main','main','active',true,true,true,$4,$4)`,
        [otherCompanyLocationId, otherCompanyId, otherCompanyBranchId, otherCompanyUserId],
      );
      await insertProduct(trackedProductId, trackedVariantId, companyId, 'INV-TRACKED', true, userId);
      await insertProduct(untrackedProductId, untrackedVariantId, companyId, 'INV-UNTRACKED', false, userId);
      await insertProduct(lowStockProductId, lowStockVariantId, companyId, 'INV-LOWSTOCK', true, userId);
      await insertProduct(noLocationProductId, noLocationVariantId, companyId, 'INV-NOLOC', true, userId);
      await insertProduct(otherCompanyProductId2, otherCompanyVariantId, otherCompanyId, 'INV-OTHERCO', true, otherCompanyUserId);
      await database.pool.query(
        `insert into inventory_balances
         (id,company_id,branch_id,inventory_location_id,product_variant_id,quantity_on_hand,quantity_reserved,quantity_in_transit,average_unit_cost,version)
         values
           ($1,$2,$3,$4,$5,'1000.000000',0,0,0,1),
           ($6,$2,$7,$8,$5,'1000.000000',0,0,0,1),
           ($9,$2,$3,$4,$10,'0.500000',0,0,0,1)`,
        [
          randomUUID(),
          companyId,
          invBranchId,
          invLocationId,
          trackedVariantId,
          randomUUID(),
          invBranch2Id,
          invLocation2Id,
          randomUUID(),
          lowStockVariantId,
        ],
      );
      await database.pool.query(
        `insert into inventory_balances
         (id,company_id,branch_id,inventory_location_id,product_variant_id,quantity_on_hand,quantity_reserved,quantity_in_transit,average_unit_cost,version)
         values($1,$2,$3,$4,$5,'10.000000',0,0,0,1)`,
        [randomUUID(), otherCompanyId, otherCompanyBranchId, otherCompanyLocationId, otherCompanyVariantId],
      );
      const paymentRepository = new PaymentRepository(database);
      const salesRepository = new SalesRepository(database);
      const mercadoPagoProvider = new MercadoPagoPointProvider(
        new MercadoPagoClient({ accessToken: undefined, apiBaseUrl: 'https://api.mercadopago.com' }),
      );
      const cashRepository = new CashRepository(database);
      payments = new PaymentService(paymentRepository, salesRepository, mercadoPagoProvider, cashRepository);
      // TASK 12.7: `noLocationBranchId` also needs an open session — its
      // own test expects `inventory_location_not_found` specifically,
      // which must still be the *first* rejection reached, not masked by
      // a `cash_session_required` this branch would otherwise also
      // legitimately hit.
      for (const branch of [invBranchId, noLocationBranchId])
        await openCashSessionForBranch(database, companyId, branch, userId, context.timestamp);
    });

    afterAll(async () => {
      const branches = [invBranchId, invBranch2Id, noLocationBranchId];
      await database.pool.query('delete from outbox_events where company_id=$1', [companyId]);
      await database.pool.query(
        `delete from audit_log where company_id=$1 and entity_id in (select id from inventory_movements where company_id=$1)`,
        [companyId],
      );
      await database.pool.query('update inventory_balances set last_movement_id=null where company_id=$1', [companyId]);
      await database.pool.query(
        `delete from inventory_movement_lines where company_id=$1 and inventory_movement_id in (select id from inventory_movements where company_id=$1)`,
        [companyId],
      );
      await database.pool.query('delete from inventory_movements where company_id=$1', [companyId]);
      await database.pool.query('delete from inventory_balances where company_id in ($1,$2)', [
        companyId,
        otherCompanyId,
      ]);
      await database.pool.query('delete from inventory_locations where company_id in ($1,$2)', [
        companyId,
        otherCompanyId,
      ]);
      await database.pool.query(
        'delete from payment_attempts where company_id=$1 and payment_id in (select id from payments where branch_id=any($2::uuid[]))',
        [companyId, branches],
      );
      await database.pool.query('delete from payments where company_id=$1 and branch_id=any($2::uuid[])', [
        companyId,
        branches,
      ]);
      await database.pool.query('delete from sale_items where company_id=$1 and branch_id=any($2::uuid[])', [
        companyId,
        branches,
      ]);
      await database.pool.query('delete from sales where company_id=$1 and branch_id=any($2::uuid[])', [
        companyId,
        branches,
      ]);
      // TASK 12.7: real FKs now — deleted only after `sales` is gone.
      await database.pool.query('delete from cash_movements where company_id=$1', [companyId]);
      await database.pool.query('delete from cash_sessions where company_id=$1', [companyId]);
      await database.pool.query('delete from cash_registers where company_id=$1', [companyId]);
      await database.pool.query('delete from idempotency_keys where company_id in ($1,$2)', [
        companyId,
        otherCompanyId,
      ]);
      await database.pool.query('delete from product_prices where company_id in ($1,$2)', [
        companyId,
        otherCompanyId,
      ]);
      await database.pool.query('delete from product_variants where company_id in ($1,$2)', [
        companyId,
        otherCompanyId,
      ]);
      await database.pool.query('delete from products where company_id in ($1,$2) and code like $3', [
        companyId,
        otherCompanyId,
        'INV-%',
      ]);
      await database.pool.query('delete from branches where id=any($1::uuid[])', [
        [...branches, otherCompanyBranchId],
      ]);
    });

    async function completedSale(
      branchId: string,
      productId: string,
      quantity: string,
      key: string,
      companyIdOverride?: string,
      userIdOverride?: string,
      branchIdsOverride?: readonly string[],
    ): Promise<{ saleId: string }> {
      const localSales = new SalesService(new SalesRepository(database));
      const created = await localSales.createSale(
        { ...context, companyId: companyIdOverride ?? companyId, actorId: userIdOverride ?? userId },
        branchIdsOverride ?? [branchId],
        `${key}-create`,
        { branchId, items: [{ productId, quantity }] },
      );
      return { saleId: created.value.sale.id };
    }

    async function trackedBalance(): Promise<string> {
      const balance = await database.pool.query<{ quantity_on_hand: string }>(
        `select quantity_on_hand::text from inventory_balances
         where company_id=$1 and inventory_location_id=$2 and product_variant_id=$3`,
        [companyId, invLocationId, trackedVariantId],
      );
      const value = balance.rows[0]?.quantity_on_hand;
      if (value === undefined) throw new Error('Expected the tracked balance row to exist.');
      return value;
    }

    it('posts one sale_consumption movement and reduces the branch balance by the exact quantity sold', async () => {
      const before = await trackedBalance();
      const { saleId } = await completedSale(invBranchId, trackedProductId, '1', 'inv-basic-1');
      const cash = await payments.createCashPayment(context, [invBranchId], 'inv-basic-1-cash', {
        saleId,
        tenderedAmount: '11.60',
      });
      expect(cash.value.sale.status).toBe('completed');
      expect(Number(await trackedBalance())).toBe(Number(before) - 1);
      const movements = await database.pool.query(
        `select movement_type, status from inventory_movements where company_id=$1 and reference_id=$2`,
        [companyId, saleId],
      );
      expect(movements.rows).toEqual([{ movement_type: 'sale_consumption', status: 'posted' }]);
    });

    it('posts the exact quantity for a quantity greater than one', async () => {
      const before = await trackedBalance();
      const { saleId } = await completedSale(invBranchId, trackedProductId, '3', 'inv-qty3-1');
      await payments.createCashPayment(context, [invBranchId], 'inv-qty3-1-cash', { saleId, tenderedAmount: '34.80' });
      expect(Number(await trackedBalance())).toBe(Number(before) - 3);
    });

    it('does not consume inventory for a non-stock-tracked product, and posts no movement at all', async () => {
      const { saleId } = await completedSale(invBranchId, untrackedProductId, '5', 'inv-untracked-1');
      const cash = await payments.createCashPayment(context, [invBranchId], 'inv-untracked-1-cash', {
        saleId,
        tenderedAmount: '58.00',
      });
      expect(cash.value.sale.status).toBe('completed');
      const movements = await database.pool.query(`select 1 from inventory_movements where company_id=$1 and reference_id=$2`, [
        companyId,
        saleId,
      ]);
      expect(movements.rows).toHaveLength(0);
    });

    it('a mixed Sale (tracked + non-tracked lines) consumes only the tracked line', async () => {
      const before = await trackedBalance();
      const localSales = new SalesService(new SalesRepository(database));
      const created = await localSales.createSale(context, [invBranchId], 'inv-mixed-1-create', {
        branchId: invBranchId,
        items: [
          { productId: trackedProductId, quantity: '1' },
          { productId: untrackedProductId, quantity: '2' },
        ],
      });
      await payments.createCashPayment(context, [invBranchId], 'inv-mixed-1-cash', {
        saleId: created.value.sale.id,
        tenderedAmount: created.value.sale.total,
      });
      const lines = await database.pool.query<{ product_variant_id: string }>(
        `select ml.product_variant_id from inventory_movement_lines ml
         join inventory_movements m on m.id = ml.inventory_movement_id
         where m.company_id=$1 and m.reference_id=$2`,
        [companyId, created.value.sale.id],
      );
      expect(lines.rows).toEqual([{ product_variant_id: trackedVariantId }]);
      expect(Number(await trackedBalance())).toBe(Number(before) - 1);
    });

    it('a duplicate settlement attempt for an already-completed sale never double-consumes', async () => {
      const before = await trackedBalance();
      const { saleId } = await completedSale(invBranchId, trackedProductId, '1', 'inv-dup-settle-1');
      await payments.createCashPayment(context, [invBranchId], 'inv-dup-settle-1-cash', { saleId, tenderedAmount: '11.60' });
      const salesRepository = new SalesRepository(database);
      // Directly re-invokes the settlement coordination point a second
      // time, exactly as a replayed provider callback or a second worker
      // racing the same approval would — outside any HTTP idempotency key,
      // proving `trySettleSale`'s own idempotency (already-`completed`
      // sales are left untouched) rather than the key's.
      const second = await salesRepository.transaction((client) => salesRepository.trySettleSale(client, context, saleId));
      expect(second.settled).toBe(false);
      const movements = await database.pool.query<{ count: number }>(`select count(*)::int as count from inventory_movements where company_id=$1 and reference_id=$2`, [
        companyId,
        saleId,
      ]);
      expect(movements.rows[0]?.count).toBe(1);
      expect(Number(await trackedBalance())).toBe(Number(before) - 1);
    });

    it('a replayed cash-payment confirmation (same idempotency key) never double-consumes', async () => {
      const before = await trackedBalance();
      const { saleId } = await completedSale(invBranchId, trackedProductId, '1', 'inv-dup-key-1');
      const first = await payments.createCashPayment(context, [invBranchId], 'inv-dup-key-1-cash', {
        saleId,
        tenderedAmount: '11.60',
      });
      expect(first.replayed).toBe(false);
      const replay = await payments.createCashPayment(context, [invBranchId], 'inv-dup-key-1-cash', {
        saleId,
        tenderedAmount: '11.60',
      });
      expect(replay.replayed).toBe(true);
      const movements = await database.pool.query<{ count: number }>(`select count(*)::int as count from inventory_movements where company_id=$1 and reference_id=$2`, [
        companyId,
        saleId,
      ]);
      expect(movements.rows[0]?.count).toBe(1);
      expect(Number(await trackedBalance())).toBe(Number(before) - 1);
    });

    it('the database itself refuses a second sale_consumption movement for the same sale (A6 durable guarantee)', async () => {
      const { saleId } = await completedSale(invBranchId, trackedProductId, '1', 'inv-db-uq-1');
      await payments.createCashPayment(context, [invBranchId], 'inv-db-uq-1-cash', { saleId, tenderedAmount: '11.60' });
      // Bypasses every application-level guard entirely — a raw duplicate
      // INSERT for the same (company_id, reference_id) where
      // reference_type='sale', proving the partial unique index itself
      // (`inventory_movements_sale_reference_uq`) rejects it, not just
      // `trySettleSale`'s own "already completed" check.
      await expect(
        database.pool.query(
          `insert into inventory_movements
           (id,company_id,branch_id,movement_number,movement_type,status,reference_type,reference_id,
            version,occurred_at,posted_at,posted_by,created_by,created_at,updated_at)
           values($1,$2,$3,$4,'sale_consumption','posted','sale',$5,1,now(),now(),$6,$6,now(),now())`,
          [randomUUID(), companyId, invBranchId, `IMV-${randomUUID().replaceAll('-', '')}`, saleId, userId],
        ),
      ).rejects.toMatchObject({ constraint: 'inventory_movements_sale_reference_uq' });
    });

    it('receipt retrieval after completion never posts or changes inventory again', async () => {
      const { saleId } = await completedSale(invBranchId, trackedProductId, '1', 'inv-receipt-ro-1');
      await payments.createCashPayment(context, [invBranchId], 'inv-receipt-ro-1-cash', { saleId, tenderedAmount: '11.60' });
      const balanceBefore = await database.pool.query<{ quantity_on_hand: string }>(
        `select quantity_on_hand::text from inventory_balances where company_id=$1 and inventory_location_id=$2 and product_variant_id=$3`,
        [companyId, invLocationId, trackedVariantId],
      );
      // Reprint/detail reads (GET /sales/{id}, GET /sales/{id}/receipt)
      // are exactly `SalesService.sale`/`receiptOrganization` — pure
      // reads, called repeatedly here to prove they never touch inventory.
      await sales.sale(companyId, [invBranchId], saleId);
      await sales.sale(companyId, [invBranchId], saleId);
      await sales.receiptOrganization(companyId, saleId);
      const balanceAfter = await database.pool.query<{ quantity_on_hand: string }>(
        `select quantity_on_hand::text from inventory_balances where company_id=$1 and inventory_location_id=$2 and product_variant_id=$3`,
        [companyId, invLocationId, trackedVariantId],
      );
      expect(balanceAfter.rows[0]?.quantity_on_hand).toBe(balanceBefore.rows[0]?.quantity_on_hand);
      const movements = await database.pool.query<{ count: number }>(`select count(*)::int as count from inventory_movements where company_id=$1 and reference_id=$2`, [
        companyId,
        saleId,
      ]);
      expect(movements.rows[0]?.count).toBe(1);
    });

    it('branch inventory isolation — consuming at one branch never changes another branch\'s balance for the same variant', async () => {
      const before = await database.pool.query<{ quantity_on_hand: string }>(
        `select quantity_on_hand::text from inventory_balances where company_id=$1 and inventory_location_id=$2 and product_variant_id=$3`,
        [companyId, invLocation2Id, trackedVariantId],
      );
      const { saleId } = await completedSale(invBranchId, trackedProductId, '1', 'inv-branch-iso-1');
      await payments.createCashPayment(context, [invBranchId], 'inv-branch-iso-1-cash', { saleId, tenderedAmount: '11.60' });
      const after = await database.pool.query<{ quantity_on_hand: string }>(
        `select quantity_on_hand::text from inventory_balances where company_id=$1 and inventory_location_id=$2 and product_variant_id=$3`,
        [companyId, invLocation2Id, trackedVariantId],
      );
      expect(after.rows[0]?.quantity_on_hand).toBe(before.rows[0]?.quantity_on_hand);
      const movementsAtOtherBranch = await database.pool.query(
        `select 1 from inventory_movements where company_id=$1 and branch_id=$2 and reference_id=$3`,
        [companyId, invBranch2Id, saleId],
      );
      expect(movementsAtOtherBranch.rows).toHaveLength(0);
    });

    it('tenant isolation — a sale in one company never posts or touches another company\'s inventory balance', async () => {
      const before = await database.pool.query<{ quantity_on_hand: string }>(
        `select quantity_on_hand::text from inventory_balances where company_id=$1 and inventory_location_id=$2 and product_variant_id=$3`,
        [otherCompanyId, otherCompanyLocationId, otherCompanyVariantId],
      );
      const { saleId } = await completedSale(invBranchId, trackedProductId, '1', 'inv-tenant-iso-1');
      await payments.createCashPayment(context, [invBranchId], 'inv-tenant-iso-1-cash', { saleId, tenderedAmount: '11.60' });
      const after = await database.pool.query<{ quantity_on_hand: string }>(
        `select quantity_on_hand::text from inventory_balances where company_id=$1 and inventory_location_id=$2 and product_variant_id=$3`,
        [otherCompanyId, otherCompanyLocationId, otherCompanyVariantId],
      );
      expect(after.rows[0]?.quantity_on_hand).toBe(before.rows[0]?.quantity_on_hand);
      const crossTenantMovements = await database.pool.query(
        `select 1 from inventory_movements where company_id=$1 and reference_id=$2`,
        [otherCompanyId, saleId],
      );
      expect(crossTenantMovements.rows).toHaveLength(0);
    });

    it('posts against the branch\'s real default inventory location', async () => {
      const { saleId } = await completedSale(invBranchId, trackedProductId, '1', 'inv-location-1');
      await payments.createCashPayment(context, [invBranchId], 'inv-location-1-cash', { saleId, tenderedAmount: '11.60' });
      const lines = await database.pool.query<{ source_location_id: string }>(
        `select ml.source_location_id from inventory_movement_lines ml
         join inventory_movements m on m.id = ml.inventory_movement_id
         where m.company_id=$1 and m.reference_id=$2`,
        [companyId, saleId],
      );
      expect(lines.rows).toEqual([{ source_location_id: invLocationId }]);
    });

    it('preserves the existing block-negative-stock policy — insufficient inventory rolls back the whole settlement, including the payment', async () => {
      const { saleId } = await completedSale(invBranchId, lowStockProductId, '1', 'inv-negative-1');
      // Only 0.5 unit on hand; selling 1 must be blocked, not allowed to
      // go negative — the same policy `InventoryPostingService.post()`
      // already enforces everywhere else, extended here rather than
      // invented fresh.
      await expect(
        payments.createCashPayment(context, [invBranchId], 'inv-negative-1-cash', { saleId, tenderedAmount: '11.60' }),
      ).rejects.toMatchObject({ code: 'insufficient_inventory' });
      const sale = await sales.sale(companyId, [invBranchId], saleId);
      expect(sale.sale.status).toBe('pending_payment');
      const capturedPayments = await database.pool.query(`select 1 from payments where company_id=$1 and sale_id=$2 and status='captured'`, [
        companyId,
        saleId,
      ]);
      expect(capturedPayments.rows).toHaveLength(0);
      const balance = await database.pool.query<{ quantity_on_hand: string }>(
        `select quantity_on_hand::text from inventory_balances where company_id=$1 and product_variant_id=$2`,
        [companyId, lowStockVariantId],
      );
      expect(balance.rows[0]?.quantity_on_hand).toBe('0.500000');
    });

    it('a branch with no active default inventory location blocks settlement instead of guessing one', async () => {
      const { saleId } = await completedSale(noLocationBranchId, noLocationProductId, '1', 'inv-noloc-1', undefined, undefined, [
        noLocationBranchId,
      ]);
      await expect(
        payments.createCashPayment(context, [noLocationBranchId], 'inv-noloc-1-cash', { saleId, tenderedAmount: '11.60' }),
      ).rejects.toMatchObject({ code: 'inventory_location_not_found' });
      const sale = await sales.sale(companyId, [noLocationBranchId], saleId);
      expect(sale.sale.status).toBe('pending_payment');
      const capturedPayments = await database.pool.query(`select 1 from payments where company_id=$1 and sale_id=$2 and status='captured'`, [
        companyId,
        saleId,
      ]);
      expect(capturedPayments.rows).toHaveLength(0);
    });

    it('emits the canonical inventory.movement.created and inventory.stock.changed outbox events, and an audit log entry', async () => {
      const { saleId } = await completedSale(invBranchId, trackedProductId, '1', 'inv-audit-1');
      await payments.createCashPayment(context, [invBranchId], 'inv-audit-1-cash', { saleId, tenderedAmount: '11.60' });
      const movement = await database.pool.query<{ id: string }>(
        `select id from inventory_movements where company_id=$1 and reference_id=$2`,
        [companyId, saleId],
      );
      const movementId = movement.rows[0]?.id;
      const events = await database.pool.query<{ event_type: string }>(
        `select event_type from outbox_events where company_id=$1 and (aggregate_id=$2::uuid or payload->>'movement_id'=$2::text) order by event_type`,
        [companyId, movementId],
      );
      expect(events.rows.map((row) => row.event_type)).toEqual(['inventory.movement.created', 'inventory.stock.changed']);
      const audit = await database.pool.query(`select action from audit_log where company_id=$1 and entity_id=$2`, [
        companyId,
        movementId,
      ]);
      expect(audit.rows).toEqual([{ action: 'inventory_movement.posted' }]);
    });
  });

  // TASK 16.6C — the real financial-history regression this task
  // explicitly requires: a `ProductCatalogService.changeProductPrice`
  // call (TASK 16.6C's own new "cambiar precio" operation) must never
  // alter a sale that was already recorded at the old price.
  // `sale_items.unit_price` is an immutable commercial snapshot frozen at
  // sale-creation time (see its own doc comment in
  // `packages/database/src/schema/sales.ts`) with no live reference back
  // to `product_prices` — this test proves that structural guarantee
  // holds end-to-end through the real service, not just by reading the
  // schema comment.
  it('a later price change never alters an already-recorded sale — a new sale after the change uses the new price (TASK 16.6C)', async () => {
    const products = new ProductCatalogService(new ProductCatalogRepository(database));
    const created = await products.createProduct(context, 'price-history-sale-product', {
      code: 'price-history-sale',
      name: 'Price History Sale Product',
      productType: 'simple',
      tracksInventory: false,
      status: 'active',
      defaultVariant: {
        sku: 'price-history-sale',
        unitOfMeasureCode: 'unit',
        quantityScale: 0,
        standardCost: '0',
        currencyCode: 'MXN',
      },
    });
    const historyProductId = created.value.id;
    await products.createProductPrice(context, historyProductId, 'price-history-initial-price', {
      amount: '250.00',
      currencyCode: 'MXN',
    });

    // A real sale, recorded at the real $250 price.
    const oldSale = await sales.createSale(context, branchIds, 'price-history-old-sale', {
      branchId,
      items: [{ productId: historyProductId, quantity: '1' }],
    });
    expect(oldSale.value.items[0]).toMatchObject({ unitPrice: '250.0000' });

    // Change the price — a genuinely later context, mirroring two
    // separate real requests (this file's own shared `context.timestamp`
    // is fixed, which would otherwise collide with
    // `product_prices_valid_interval_ck` when closing a price whose own
    // `valid_from` was set from that same fixed instant).
    const laterContext = { ...context, timestamp: new Date(context.timestamp.getTime() + 60_000) };
    await products.changeProductPrice(laterContext, historyProductId, 'price-history-change', {
      amount: '260.00',
      currencyCode: 'MXN',
    });

    // A new sale, created AFTER the change, uses the new $260 price.
    const newSale = await sales.createSale(laterContext, branchIds, 'price-history-new-sale', {
      branchId,
      items: [{ productId: historyProductId, quantity: '1' }],
    });
    expect(newSale.value.items[0]).toMatchObject({ unitPrice: '260.0000' });

    // The historical sale's own line is untouched — re-read fresh from
    // the database, not from any in-memory value captured earlier.
    const reread = await database.pool.query<{ unit_price: string }>(
      'select unit_price from sale_items where company_id=$1 and sale_id=$2',
      [companyId, oldSale.value.sale.id],
    );
    expect(reread.rows[0]?.unit_price).toBe('250.0000');

    // Cleanup — this test creates its own product outside the shared
    // beforeAll/afterAll fixtures.
    await database.pool.query('delete from sale_items where company_id=$1 and sale_id=any($2::uuid[])', [
      companyId,
      [oldSale.value.sale.id, newSale.value.sale.id],
    ]);
    await database.pool.query('delete from sales where company_id=$1 and id=any($2::uuid[])', [
      companyId,
      [oldSale.value.sale.id, newSale.value.sale.id],
    ]);
    await database.pool.query('delete from product_prices where company_id=$1 and product_id=$2', [
      companyId,
      historyProductId,
    ]);
    await database.pool.query('delete from product_variants where company_id=$1 and product_id=$2', [
      companyId,
      historyProductId,
    ]);
    await database.pool.query('delete from idempotency_keys where company_id=$1 and key like $2', [
      companyId,
      'price-history-%',
    ]);
    await database.pool.query('delete from products where company_id=$1 and id=$2', [companyId, historyProductId]);
  });

  // TASK 16.7B (fiscal forensic audit item D8): a later change to a
  // product's tax classification (`products.tax_code`) must never alter
  // an already-recorded sale's own frozen `tax_snapshot` — mirrors the
  // price-change test immediately above, for tax rate instead of price.
  // `sale_items.taxSnapshot` (`{tax_code, basis_points}`, set once at sale
  // creation — `sales.service.ts`) is exactly the mechanism that makes
  // this true; this test proves it end to end, not just by code reading.
  it('a later tax_code change never alters an already-recorded sale — a new sale after the change uses the new rate (TASK 16.7B)', async () => {
    const products = new ProductCatalogService(new ProductCatalogRepository(database));
    const created = await products.createProduct(context, 'tax-history-sale-product', {
      code: 'tax-history-sale',
      name: 'Tax History Sale Product',
      productType: 'simple',
      tracksInventory: false,
      taxCode: 'IVA_GENERAL',
      status: 'active',
      defaultVariant: {
        sku: 'tax-history-sale',
        unitOfMeasureCode: 'unit',
        quantityScale: 0,
        standardCost: '0',
        currencyCode: 'MXN',
      },
    });
    const taxHistoryProductId = created.value.id;
    await products.createProductPrice(context, taxHistoryProductId, 'tax-history-initial-price', {
      amount: '100.00',
      currencyCode: 'MXN',
    });

    // A real sale, recorded while the product is still IVA_GENERAL (16%).
    const oldSale = await sales.createSale(context, branchIds, 'tax-history-old-sale', {
      branchId,
      items: [{ productId: taxHistoryProductId, quantity: '1' }],
    });
    expect(oldSale.value.items[0]).toMatchObject({ taxTotal: '16.0000' });
    expect(oldSale.value.sale).toMatchObject({ subtotal: '100.0000', taxTotal: '16.0000', total: '116.0000' });

    // Re-classify the product as tax-exempt — a genuinely later context,
    // mirroring the price-change test's own reasoning for why this must
    // not reuse the shared fixed `context.timestamp`.
    const laterContext = { ...context, timestamp: new Date(context.timestamp.getTime() + 60_000) };
    await products.patchProduct(laterContext, taxHistoryProductId, created.value.version, {
      taxCode: 'IVA_EXEMPT',
    });

    // A new sale, created AFTER the reclassification, is genuinely
    // tax-exempt.
    const newSale = await sales.createSale(laterContext, branchIds, 'tax-history-new-sale', {
      branchId,
      items: [{ productId: taxHistoryProductId, quantity: '1' }],
    });
    expect(newSale.value.items[0]).toMatchObject({ taxTotal: '0.0000' });
    expect(newSale.value.sale).toMatchObject({ subtotal: '100.0000', taxTotal: '0.0000', total: '100.0000' });

    // The historical sale's own line and its frozen tax_snapshot are
    // untouched — re-read fresh from the database, not from any
    // in-memory value captured earlier.
    const reread = await database.pool.query<{ tax_total: string; tax_snapshot: { tax_code: string; basis_points: number } }>(
      'select tax_total, tax_snapshot from sale_items where company_id=$1 and sale_id=$2',
      [companyId, oldSale.value.sale.id],
    );
    expect(reread.rows[0]?.tax_total).toBe('16.0000');
    expect(reread.rows[0]?.tax_snapshot).toEqual({ tax_code: 'IVA_GENERAL', basis_points: 1600 });

    // Cleanup — this test creates its own product outside the shared
    // beforeAll/afterAll fixtures.
    await database.pool.query('delete from sale_items where company_id=$1 and sale_id=any($2::uuid[])', [
      companyId,
      [oldSale.value.sale.id, newSale.value.sale.id],
    ]);
    await database.pool.query('delete from sales where company_id=$1 and id=any($2::uuid[])', [
      companyId,
      [oldSale.value.sale.id, newSale.value.sale.id],
    ]);
    await database.pool.query('delete from product_prices where company_id=$1 and product_id=$2', [
      companyId,
      taxHistoryProductId,
    ]);
    await database.pool.query('delete from product_variants where company_id=$1 and product_id=$2', [
      companyId,
      taxHistoryProductId,
    ]);
    await database.pool.query('delete from idempotency_keys where company_id=$1 and key like $2', [
      companyId,
      'tax-history-%',
    ]);
    await database.pool.query('delete from products where company_id=$1 and id=$2', [companyId, taxHistoryProductId]);
  });

  it(
    "freezes the product's category operational_group onto sale_items.operational_group_snapshot at sale-creation time, " +
      'and a later category reassignment never rewrites that historical fact (TASK 16.13A)',
    async () => {
      const opGroupCategoryId = randomUUID();
      await database.pool.query(
        `insert into product_categories
         (id,company_id,code,normalized_code,name,status,operational_group,created_by,updated_by)
         values ($1,$2,'SALES-CAFETERIA','sales-cafeteria','Cafetería (sales test)','active','cafeteria',$3,$3)`,
        [opGroupCategoryId, companyId, userId],
      );
      const products = new ProductCatalogService(new ProductCatalogRepository(database));
      const created = await products.createProduct(context, 'opgroup-snapshot-product', {
        code: 'opgroup-snapshot',
        name: 'OpGroup Snapshot Product',
        productType: 'simple',
        tracksInventory: false,
        taxCode: 'IVA_EXEMPT',
        status: 'active',
        categoryId: opGroupCategoryId,
        defaultVariant: {
          sku: 'opgroup-snapshot',
          unitOfMeasureCode: 'unit',
          quantityScale: 0,
          standardCost: '0',
          currencyCode: 'MXN',
        },
      });
      const opGroupProductId = created.value.id;
      await products.createProductPrice(context, opGroupProductId, 'opgroup-snapshot-price', {
        amount: '50.00',
        currencyCode: 'MXN',
      });

      // A real sale, recorded while the category is still tagged Cafetería.
      const cafeteriaSale = await sales.createSale(context, branchIds, 'opgroup-cafeteria-sale', {
        branchId,
        items: [{ productId: opGroupProductId, quantity: '1' }],
      });
      expect(cafeteriaSale.value.items[0]).toMatchObject({ operationalGroupSnapshot: 'cafeteria' });

      // The category is reclassified AFTER the sale — no longer Cafetería.
      await database.pool.query('update product_categories set operational_group=null where id=$1', [
        opGroupCategoryId,
      ]);

      // A new sale, created AFTER the reclassification, correctly gets
      // no classification at all — never the stale 'cafeteria' value.
      const laterContext = { ...context, timestamp: new Date(context.timestamp.getTime() + 60_000) };
      const generalSale = await sales.createSale(laterContext, branchIds, 'opgroup-general-sale', {
        branchId,
        items: [{ productId: opGroupProductId, quantity: '1' }],
      });
      expect(generalSale.value.items[0]).toMatchObject({ operationalGroupSnapshot: null });

      // The FIRST sale's own line, re-read fresh from the database, is
      // untouched — still 'cafeteria', exactly as recorded at the time.
      const reread = await database.pool.query<{ operational_group_snapshot: string | null }>(
        'select operational_group_snapshot from sale_items where company_id=$1 and sale_id=$2',
        [companyId, cafeteriaSale.value.sale.id],
      );
      expect(reread.rows[0]?.operational_group_snapshot).toBe('cafeteria');

      // Cleanup — this test creates its own product/category outside the
      // shared beforeAll/afterAll fixtures.
      await database.pool.query('delete from sale_items where company_id=$1 and sale_id=any($2::uuid[])', [
        companyId,
        [cafeteriaSale.value.sale.id, generalSale.value.sale.id],
      ]);
      await database.pool.query('delete from sales where company_id=$1 and id=any($2::uuid[])', [
        companyId,
        [cafeteriaSale.value.sale.id, generalSale.value.sale.id],
      ]);
      await database.pool.query('delete from product_prices where company_id=$1 and product_id=$2', [
        companyId,
        opGroupProductId,
      ]);
      await database.pool.query('delete from product_variants where company_id=$1 and product_id=$2', [
        companyId,
        opGroupProductId,
      ]);
      await database.pool.query('delete from idempotency_keys where company_id=$1 and key like $2', [
        companyId,
        'opgroup-%',
      ]);
      await database.pool.query('delete from products where company_id=$1 and id=$2', [companyId, opGroupProductId]);
      await database.pool.query('delete from product_categories where id=$1', [opGroupCategoryId]);
    },
  );
});
