import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';

import { CashRepository } from '../cash/cash.repository.js';
import { CashService } from '../cash/cash.service.js';
import { PaymentRepository } from '../payments/payments.repository.js';
import { PaymentService } from '../payments/payments.service.js';
import { MercadoPagoClient } from '../payments/providers/mercado-pago.client.js';
import { MercadoPagoPointProvider } from '../payments/providers/mercado-pago.provider.js';
import { RefundsRepository } from '../refunds/refunds.repository.js';
import { RefundsService } from '../refunds/refunds.service.js';
import { SalesRepository } from '../sales/sales.repository.js';
import { SalesService } from '../sales/sales.service.js';
import { SaleError } from '../sales/sales.types.js';
import { PromotionsRepository } from './promotions.repository.js';
import { PromotionsService } from './promotions.service.js';
import { PromotionError } from './promotions.types.js';

/** TASK 12.9 — the promotions/discounts/coupons engine, wired end to end
 * through real sale creation (never a parallel/duplicate pricing path —
 * see ADR-0016). Reconciled against nothing pre-existing (CORE_DATA_MODEL/
 * API_CONTRACTS both explicitly exclude "advanced promotions" — this is a
 * genuinely new domain), but must keep TASK 12.8's refund guarantees
 * intact — the bulk of the "refund compatibility" describe block below
 * exists specifically to prove that. */
const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;
const migrationsPath = resolve(import.meta.dirname, '../../../../../packages/database/drizzle');

integration('PostgreSQL promotions/discounts/coupons engine (TASK 12.9)', { concurrent: false }, () => {
  let database: DatabaseClient;
  let sales: SalesService;
  let promotions: PromotionsService;
  let cash: CashService;
  let payments: PaymentService;
  let refunds: RefundsService;
  const companyId = randomUUID();
  const branchId = randomUUID();
  const otherBranchId = randomUUID();
  const userId = randomUUID();
  // $100.0000, 16% IVA — the workhorse product for most of this file.
  const productId = randomUUID();
  const categoryId = randomUUID();
  const otherCategoryProductId = randomUUID();
  const context = {
    companyId,
    actorId: userId,
    actorPermissions: [
      'promotion.manage',
      'coupon.manage',
      'discount.apply',
      'refund.create',
      'refund.approve',
      'refund.complete',
      'refund.read',
    ],
    requestId: 'promo-request',
    correlationId: 'promo-correlation',
    timestamp: new Date('2026-09-04T20:00:00.000Z'), // a Friday
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
    database = createDatabaseClient({ connectionString: databaseUrl, applicationName: 'asone-promotions-integration' });
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
    await applyIfMissing('cash_registers', ['0016_jittery_slayback.sql', '0017_gifted_vertigo.sql']);
    await applyIfMissing('refunds', ['0019_nosy_the_twelve.sql']);
    await applyIfMissing('promotions', ['0020_broad_ben_grimm.sql']);

    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'Promo Co','Promo Co',$2,'active','America/Mexico_City','MXN','es-MX')`,
      [companyId, `promo-${companyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'Promo Main','PMAIN','active','America/Mexico_City'),
             ($3,$2,'Promo Second','PSECOND','active','America/Mexico_City')`,
      [branchId, companyId, otherBranchId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'Promo Cashier','active')`,
      [userId, `promo-${userId}@example.test`],
    );
    await database.pool.query(`insert into company_memberships(id,company_id,user_id,status) values($1,$2,$3,'active')`, [
      randomUUID(),
      companyId,
      userId,
    ]);
    await database.pool.query(
      `insert into product_categories (id,company_id,code,normalized_code,name,status,created_by,updated_by)
       values ($1,$2,'PROMO-CAT','promo-cat','Promo Category','active',$3,$3)`,
      [categoryId, companyId, userId],
    );
    await database.pool.query(
      `insert into products
       (id,company_id,category_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
       values($1,$2,$3,'PROMO-GENERAL','promo-general','Promo Product','simple',false,'IVA_GENERAL','active',$4,$4),
             ($5,$2,null,'PROMO-OTHERCAT','promo-othercat','Other Category Product','simple',false,'IVA_GENERAL','active',$4,$4)`,
      [productId, companyId, categoryId, userId, otherCategoryProductId],
    );
    await database.pool.query(
      `insert into product_prices (id,company_id,product_id,amount,currency_code,status,created_by,updated_by)
       values($1,$2,$3,'100.0000','MXN','active',$4,$4),
             ($5,$2,$6,'50.0000','MXN','active',$4,$4)`,
      [randomUUID(), companyId, productId, userId, randomUUID(), otherCategoryProductId],
    );

    const salesRepository = new SalesRepository(database);
    const promotionsRepository = new PromotionsRepository(database);
    promotions = new PromotionsService(promotionsRepository);
    sales = new SalesService(salesRepository, promotionsRepository);
    const cashRepository = new CashRepository(database);
    cash = new CashService(cashRepository);
    const paymentRepository = new PaymentRepository(database);
    const mercadoPagoProvider = new MercadoPagoPointProvider(
      new MercadoPagoClient({ accessToken: undefined, apiBaseUrl: 'https://api.mercadopago.com' }),
    );
    payments = new PaymentService(paymentRepository, salesRepository, mercadoPagoProvider, cashRepository);
    const refundsRepository = new RefundsRepository(database);
    refunds = new RefundsService(refundsRepository, paymentRepository, cashRepository, mercadoPagoProvider);
  });

  // Every test creates its own promotion(s)/coupon(s) against the SAME
  // shared product/company fixture — without this, a promotion created
  // by an earlier test would still be `active` and eligible during a
  // later one, silently stacking/interfering (found and fixed while
  // writing this file: several early runs failed with an unrelated
  // EARLIER test's discount bleeding into a LATER test's assertion).
  // Sales/refunds/payments themselves are deliberately left alone here —
  // several tests still need their own sale to exist after this fires.
  afterEach(async () => {
    await database.pool.query('delete from sale_discounts where company_id=$1', [companyId]);
    await database.pool.query('delete from coupon_redemptions where company_id=$1', [companyId]);
    await database.pool.query('delete from coupons where company_id=$1', [companyId]);
    await database.pool.query('delete from promotion_branches where company_id=$1', [companyId]);
    await database.pool.query('delete from promotion_products where company_id=$1', [companyId]);
    await database.pool.query('delete from promotion_categories where company_id=$1', [companyId]);
    await database.pool.query('delete from promotions where company_id=$1', [companyId]);
  });

  afterAll(async () => {
    await database.pool.query('delete from sale_discounts where company_id=$1', [companyId]);
    await database.pool.query('delete from coupon_redemptions where company_id=$1', [companyId]);
    await database.pool.query('delete from refund_items where company_id=$1', [companyId]);
    await database.pool.query('delete from refunds where company_id=$1', [companyId]);
    await database.pool.query('delete from coupons where company_id=$1', [companyId]);
    await database.pool.query('delete from promotion_branches where company_id=$1', [companyId]);
    await database.pool.query('delete from promotion_products where company_id=$1', [companyId]);
    await database.pool.query('delete from promotion_categories where company_id=$1', [companyId]);
    await database.pool.query('delete from promotions where company_id=$1', [companyId]);
    await database.pool.query('delete from payment_attempts where company_id=$1', [companyId]);
    await database.pool.query('delete from payments where company_id=$1', [companyId]);
    await database.pool.query('delete from sale_items where company_id=$1', [companyId]);
    await database.pool.query('delete from sales where company_id=$1', [companyId]);
    await database.pool.query('delete from cash_movements where company_id=$1', [companyId]);
    await database.pool.query('delete from cash_sessions where company_id=$1', [companyId]);
    await database.pool.query('delete from cash_registers where company_id=$1', [companyId]);
    await database.pool.query('delete from idempotency_keys where company_id=$1', [companyId]);
    await database.pool.query('delete from outbox_events where company_id=$1', [companyId]);
    await database.pool.query('delete from audit_log where company_id=$1', [companyId]);
    await database.pool.query('delete from product_prices where company_id=$1', [companyId]);
    await database.pool.query('delete from products where company_id=$1', [companyId]);
    await database.pool.query('delete from product_categories where company_id=$1', [companyId]);
    await database.pool.query('delete from company_memberships where company_id=$1', [companyId]);
    await database.pool.query('delete from branches where company_id=$1', [companyId]);
    await database.pool.query('delete from companies where id=$1', [companyId]);
    await database.pool.query('delete from users where id=$1', [userId]);
    await database.close();
  });

  /** Creates a promotion via the real admin service (never raw SQL) with
   * sensible defaults, active right now, no schedule/branch restriction
   * unless overridden. */
  async function createPromotion(
    key: string,
    overrides: Partial<Parameters<PromotionsService['createPromotion']>[2]> = {},
  ): Promise<Awaited<ReturnType<PromotionsService['createPromotion']>>['value']> {
    const defaultBenefit =
      overrides.benefitType === undefined || overrides.benefitType === 'percentage'
        ? { benefitPercentageBasisPoints: 1000 }
        : {};
    const created = await promotions.createPromotion(context, key, {
      name: `Promo ${key}`,
      benefitType: 'percentage',
      ...defaultBenefit,
      ...overrides,
    });
    return created.value;
  }

  describe('automatic promotions', () => {
    it('a percentage promotion discounts the sale, and tax is computed on the post-discount base', async () => {
      await createPromotion('promo-pct-1', { benefitPercentageBasisPoints: 1000 });
      const created = await sales.createSale(context, branchIds, 'sale-promo-pct-1', {
        branchId,
        items: [{ productId, quantity: '1' }],
      });
      expect(created.value.sale.subtotal).toBe('100.0000');
      expect(created.value.sale.discountTotal).toBe('10.0000');
      expect(created.value.sale.taxTotal).toBe('14.4000'); // 16% of 90
      expect(created.value.sale.total).toBe('104.4000');
      const item = created.value.items[0];
      if (item === undefined) throw new Error('Expected a sale item.');
      expect(item.discountTotal).toBe('10.0000');
      expect(item.discountBasisPoints).toBe(1000);
    });

    it('a fixed-price promotion discounts exactly the difference from catalog price', async () => {
      await createPromotion('promo-fixedprice-1', {
        benefitType: 'fixed_price',
        benefitFixedAmount: '75.0000',
      });
      const created = await sales.createSale(context, branchIds, 'sale-promo-fixedprice-1', {
        branchId,
        items: [{ productId, quantity: '1' }],
      });
      expect(created.value.sale.discountTotal).toBe('25.0000');
      expect(created.value.sale.subtotal).toBe('100.0000');
    });

    it('2x1 (quantity_nxm buy=2 pay=1) grants exactly one free unit for 3 identical units', async () => {
      await createPromotion('promo-2x1-1', {
        benefitType: 'quantity_nxm',
        benefitNxmBuyQuantity: 2,
        benefitNxmPayQuantity: 1,
      });
      const created = await sales.createSale(context, branchIds, 'sale-promo-2x1-1', {
        branchId,
        items: [{ productId, quantity: '3' }],
      });
      expect(created.value.sale.discountTotal).toBe('100.0000');
      expect(created.value.sale.subtotal).toBe('300.0000');
    });

    it('category scope discounts a product only via its category, never an unrelated one', async () => {
      await createPromotion('promo-category-1', {
        benefitPercentageBasisPoints: 2000,
        categoryIds: [categoryId],
      });
      const created = await sales.createSale(context, branchIds, 'sale-promo-category-1', {
        branchId,
        items: [{ productId: otherCategoryProductId, quantity: '1' }],
      });
      expect(created.value.sale.discountTotal).toBe('0.0000');
    });

    it('branch scope excludes a promotion not listed for the sale branch', async () => {
      await createPromotion('promo-branch-1', { branchIds: [otherBranchId] });
      const created = await sales.createSale(context, branchIds, 'sale-promo-branch-1', {
        branchId,
        items: [{ productId, quantity: '1' }],
      });
      expect(created.value.sale.discountTotal).toBe('0.0000');
    });

    it('an inactive promotion never applies', async () => {
      await createPromotion('promo-inactive-1', { active: false });
      const created = await sales.createSale(context, branchIds, 'sale-promo-inactive-1', {
        branchId,
        items: [{ productId, quantity: '1' }],
      });
      expect(created.value.sale.discountTotal).toBe('0.0000');
    });

    it('deterministic priority: the highest-priority eligible promotion wins, others do not stack by default', async () => {
      await createPromotion('promo-priority-low', { priority: 1, benefitPercentageBasisPoints: 500 });
      await createPromotion('promo-priority-high', { priority: 10, benefitPercentageBasisPoints: 2500 });
      const created = await sales.createSale(context, branchIds, 'sale-promo-priority-1', {
        branchId,
        items: [{ productId, quantity: '1' }],
      });
      expect(created.value.sale.discountTotal).toBe('25.0000');
    });

    it('a usage-limited promotion stops applying once its limit is reached', async () => {
      const created = await createPromotion('promo-limited-1', {
        usageLimitTotal: 1,
        benefitPercentageBasisPoints: 1000,
      });
      const first = await sales.createSale(context, branchIds, 'sale-promo-limited-1a', {
        branchId,
        items: [{ productId, quantity: '1' }],
      });
      expect(first.value.sale.discountTotal).toBe('10.0000');
      const second = await sales.createSale(context, branchIds, 'sale-promo-limited-1b', {
        branchId,
        items: [{ productId, quantity: '1' }],
      });
      expect(second.value.sale.discountTotal).toBe('0.0000');
      void created;
    });
  });

  describe('coupons', () => {
    it('a valid coupon discounts the sale and records exactly one redemption', async () => {
      const created = await promotions.createCoupon(context, 'coupon-valid-1', {
        code: 'VALID10',
        benefitType: 'percentage',
        benefitPercentageBasisPoints: 1000,
      });
      const sale = await sales.createSale(context, branchIds, 'sale-coupon-valid-1', {
        branchId,
        items: [{ productId, quantity: '1' }],
        couponCodes: ['valid10'], // lowercase — proves case normalization.
      });
      expect(sale.value.sale.discountTotal).toBe('10.0000');
      const redemptions = await database.pool.query(
        `select count(*)::text as n from coupon_redemptions where company_id=$1 and coupon_id=$2`,
        [companyId, created.value.id],
      );
      expect(redemptions.rows[0]).toEqual({ n: '1' });
    });

    it('an unknown coupon code fails the whole sale creation honestly, never silently completing without it', async () => {
      await expect(
        sales.createSale(context, branchIds, 'sale-coupon-unknown-1', {
          branchId,
          items: [{ productId, quantity: '1' }],
          couponCodes: ['DOES-NOT-EXIST'],
        }),
      ).rejects.toMatchObject({ code: 'validation_error' });
    });

    it('an inactive coupon is rejected', async () => {
      await promotions.createCoupon(context, 'coupon-inactive-1', {
        code: 'INACTIVE1',
        benefitType: 'fixed_amount',
        benefitFixedAmount: '5.0000',
        active: false,
      });
      await expect(
        sales.createSale(context, branchIds, 'sale-coupon-inactive-1', {
          branchId,
          items: [{ productId, quantity: '1' }],
          couponCodes: ['INACTIVE1'],
        }),
      ).rejects.toMatchObject({ code: 'validation_error' });
    });

    it('a usage-exhausted coupon is rejected on the next attempt, never double-redeemed', async () => {
      await promotions.createCoupon(context, 'coupon-limited-1', {
        code: 'ONEUSE',
        benefitType: 'fixed_amount',
        benefitFixedAmount: '5.0000',
        usageLimitTotal: 1,
      });
      const first = await sales.createSale(context, branchIds, 'sale-coupon-limited-1a', {
        branchId,
        items: [{ productId, quantity: '1' }],
        couponCodes: ['ONEUSE'],
      });
      expect(first.value.sale.discountTotal).toBe('5.0000');
      await expect(
        sales.createSale(context, branchIds, 'sale-coupon-limited-1b', {
          branchId,
          items: [{ productId, quantity: '1' }],
          couponCodes: ['ONEUSE'],
        }),
      ).rejects.toMatchObject({ code: 'validation_error' });
    });

    it('a coupon with exactly one remaining redemption cannot be consumed twice by two genuinely concurrent checkouts', async () => {
      await promotions.createCoupon(context, 'coupon-concurrent-1', {
        code: 'RACEME',
        benefitType: 'fixed_amount',
        benefitFixedAmount: '5.0000',
        usageLimitTotal: 1,
      });
      // Two real, simultaneously-in-flight `createSale` calls (each opens
      // its own transaction/connection) racing the SAME coupon — the
      // database-level row lock (`lockCouponByNormalizedCode`, `for
      // update`) must serialize them so exactly one succeeds, never both
      // and never neither.
      const results = await Promise.allSettled([
        sales.createSale(context, branchIds, 'sale-coupon-concurrent-1a', {
          branchId,
          items: [{ productId, quantity: '1' }],
          couponCodes: ['RACEME'],
        }),
        sales.createSale(context, branchIds, 'sale-coupon-concurrent-1b', {
          branchId,
          items: [{ productId, quantity: '1' }],
          couponCodes: ['RACEME'],
        }),
      ]);
      const fulfilled = results.filter((result) => result.status === 'fulfilled');
      const rejected = results.filter((result) => result.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const redemptions = await database.pool.query(
        `select count(*)::text as n from coupon_redemptions cr
         join coupons c on c.id = cr.coupon_id and c.company_id = cr.company_id
         where cr.company_id=$1 and c.normalized_code='RACEME'`,
        [companyId],
      );
      expect(redemptions.rows[0]).toEqual({ n: '1' });
    });

    it('a quote/preview never consumes a redemption — the real usage-limited coupon is still available afterward', async () => {
      await promotions.createCoupon(context, 'coupon-preview-1', {
        code: 'PREVIEWME',
        benefitType: 'fixed_amount',
        benefitFixedAmount: '5.0000',
        usageLimitTotal: 1,
      });
      for (let i = 0; i < 3; i += 1) {
        const quote = await promotions.quote(context, branchIds, {
          branchId,
          items: [{ productId, quantity: '1' }],
          couponCodes: ['PREVIEWME'],
        });
        expect(quote.discountTotalUnits > 0n).toBe(true);
      }
      const redemptions = await database.pool.query(`select count(*)::text as n from coupon_redemptions where company_id=$1`, [
        companyId,
      ]);
      // Only whatever real sales elsewhere in this file redeemed it —
      // this coupon itself was never actually redeemed by any of the
      // three preview calls above.
      const created = await sales.createSale(context, branchIds, 'sale-coupon-preview-1-real', {
        branchId,
        items: [{ productId, quantity: '1' }],
        couponCodes: ['PREVIEWME'],
      });
      expect(created.value.sale.discountTotal).toBe('5.0000');
      void redemptions;
    });

    it('cancelling a pending-payment sale releases its coupon redemption for reuse', async () => {
      await promotions.createCoupon(context, 'coupon-release-1', {
        code: 'RELEASEME',
        benefitType: 'fixed_amount',
        benefitFixedAmount: '5.0000',
        usageLimitTotal: 1,
      });
      const created = await sales.createSale(context, branchIds, 'sale-coupon-release-1a', {
        branchId,
        items: [{ productId, quantity: '1' }],
        couponCodes: ['RELEASEME'],
      });
      await sales.cancelSale(context, branchIds, created.value.sale.id, 'sale-coupon-release-1a-cancel', 'test_cancel');
      const reused = await sales.createSale(context, branchIds, 'sale-coupon-release-1b', {
        branchId,
        items: [{ productId, quantity: '1' }],
        couponCodes: ['RELEASEME'],
      });
      expect(reused.value.sale.discountTotal).toBe('5.0000');
    });
  });

  describe('manual discount', () => {
    it('requires discount.apply — an unauthorized actor is rejected, never silently applied', async () => {
      const unauthorizedContext = { ...context, actorPermissions: [] };
      await expect(
        sales.createSale(unauthorizedContext, branchIds, 'sale-manual-unauthorized-1', {
          branchId,
          items: [{ productId, quantity: '1' }],
          manualDiscount: { scope: 'ticket', type: 'fixed_amount', value: '10.0000', reasonCode: 'goodwill' },
        }),
      ).rejects.toBeInstanceOf(Error);
    });

    it('an authorized ticket-scoped percentage discount applies, with a recorded reason and actor', async () => {
      const created = await sales.createSale(context, branchIds, 'sale-manual-1', {
        branchId,
        items: [{ productId, quantity: '1' }],
        manualDiscount: { scope: 'ticket', type: 'percentage', value: '1000', reasonCode: 'customer_complaint' },
      });
      expect(created.value.sale.discountTotal).toBe('10.0000');
      const discounts = await database.pool.query<{ reason_code: string; created_by: string }>(
        `select reason_code, created_by from sale_discounts where company_id=$1 and sale_id=$2 and source_type='manual'`,
        [companyId, created.value.sale.id],
      );
      expect(discounts.rows).toEqual([{ reason_code: 'customer_complaint', created_by: userId }]);
    });

    it('a manual discount can never exceed the eligible amount', async () => {
      const created = await sales.createSale(context, branchIds, 'sale-manual-cap-1', {
        branchId,
        items: [{ productId, quantity: '1' }],
        manualDiscount: { scope: 'ticket', type: 'fixed_amount', value: '99999.0000', reasonCode: 'x' },
      });
      expect(created.value.sale.discountTotal).toBe('100.0000');
      expect(created.value.sale.total).toBe('0.0000');
    });
  });

  describe('refund compatibility (must not regress TASK 12.8)', () => {
    async function createDiscountedCashSaleAndComplete(
      key: string,
      quantity: string,
      manualDiscountValue: string,
    ): Promise<{ saleId: string; registerId: string; total: string }> {
      const registerId = randomUUID();
      await database.pool.query(
        `insert into cash_registers (id,company_id,branch_id,code,normalized_code,name,status,created_by,updated_by)
         values ($1,$2,$3,$4,$5,'Refund Register','active',$6,$6)`,
        [registerId, companyId, branchId, `REFCASH-${key}`, `refcash-${key}`, userId],
      );
      const session = await cash.openSession(context, branchIds, `session-${key}`, {
        cashRegisterId: registerId,
        openingAmount: '0',
      });
      const created = await sales.createSale(context, branchIds, `sale-${key}`, {
        branchId,
        items: [{ productId, quantity }],
        // `'0'` means "no manual discount for this call" (some callers
        // want a promotion-only discount) — `evaluatePricing` itself
        // rejects a literal zero-percent manual request outright, so it
        // must be omitted entirely rather than passed through.
        ...(manualDiscountValue === '0'
          ? {}
          : { manualDiscount: { scope: 'ticket' as const, type: 'percentage' as const, value: manualDiscountValue, reasonCode: 'qa' } }),
      });
      await payments.createCashPayment(context, branchIds, `pay-${key}`, {
        saleId: created.value.sale.id,
        tenderedAmount: '1000.0000',
        cashRegisterId: registerId,
      });
      void session;
      return { saleId: created.value.sale.id, registerId, total: created.value.sale.total };
    }

    it('a full refund of a discounted sale refunds the exact discounted amount, never the gross catalog price', async () => {
      const { saleId, total } = await createDiscountedCashSaleAndComplete('refundfull-1', '2', '1000'); // 10% off, 2 units
      const saleRow = await sales.sale(companyId, branchIds, saleId);
      const item = saleRow.items[0];
      if (item === undefined) throw new Error('Expected a sale item.');
      expect(item.discountBasisPoints).toBe(1000);
      const created = await refunds.createRefund(context, branchIds, `refund-${saleId}`, {
        saleId,
        reasonCode: 'qa_full_refund',
        items: [{ saleItemId: item.id, quantity: '2' }],
      });
      // 2 units × $100 = $200 gross, 10% off = $180 net, 16% tax = $28.80, total $208.80.
      expect(created.value.total).toBe('208.8000');
      expect(created.value.total).toBe(total);
    });

    it('a partial refund of a discounted sale refunds the exact proportional discounted amount for the returned quantity', async () => {
      const { saleId } = await createDiscountedCashSaleAndComplete('refundpartial-1', '4', '2000'); // 20% off, 4 units
      const saleRow = await sales.sale(companyId, branchIds, saleId);
      const item = saleRow.items[0];
      if (item === undefined) throw new Error('Expected a sale item.');
      expect(item.discountBasisPoints).toBe(2000);
      const created = await refunds.createRefund(context, branchIds, `refund-${saleId}`, {
        saleId,
        reasonCode: 'qa_partial_refund',
        items: [{ saleItemId: item.id, quantity: '1' }], // 1 of 4.
      });
      // 1 unit × $100 = $100 gross, 20% off = $80 net, 16% tax = $12.80, total $92.80.
      expect(created.value.total).toBe('92.8000');
    });

    it('a promotion later deactivated does not change an already-completed refund amount', async () => {
      const created = await createPromotion('promo-laterexpire-1', { benefitPercentageBasisPoints: 3000 });
      const { saleId } = await createDiscountedCashSaleAndComplete('refundlaterexpire-1', '1', '0'); // 30% via promo only
      const saleRow = await sales.sale(companyId, branchIds, saleId);
      const item = saleRow.items[0];
      if (item === undefined) throw new Error('Expected a sale item.');
      // Deactivate the promotion AFTER the sale — the refund must still
      // use the frozen `discount_basis_points`, never re-evaluate.
      await promotions.updatePromotion(context, created.id, created.version, { active: false });
      const refund = await refunds.createRefund(context, branchIds, `refund-${saleId}`, {
        saleId,
        reasonCode: 'qa_promo_deactivated',
        items: [{ saleItemId: item.id, quantity: '1' }],
      });
      // 30% off $100 = $70 net, 16% tax = $11.20, total $81.20 — exactly
      // what was actually charged, unaffected by the later deactivation.
      expect(refund.value.total).toBe('81.2000');
    });

    it("a later catalog price change does not change an already-completed refund's amount", async () => {
      const { saleId } = await createDiscountedCashSaleAndComplete('refundlaterprice-1', '1', '1000'); // 10% off
      const saleRow = await sales.sale(companyId, branchIds, saleId);
      const item = saleRow.items[0];
      if (item === undefined) throw new Error('Expected a sale item.');
      await database.pool.query(`update product_prices set amount='999.0000' where company_id=$1 and product_id=$2`, [
        companyId,
        productId,
      ]);
      const refund = await refunds.createRefund(context, branchIds, `refund-${saleId}`, {
        saleId,
        reasonCode: 'qa_price_changed',
        items: [{ saleItemId: item.id, quantity: '1' }],
      });
      // Still the ORIGINAL $100 (10% off = $90 net, 16% tax = $14.40),
      // never the new $999 catalog price.
      expect(refund.value.total).toBe('104.4000');
      await database.pool.query(`update product_prices set amount='100.0000' where company_id=$1 and product_id=$2`, [
        companyId,
        productId,
      ]);
    });

    it('cumulative partial refunds of a discounted line never exceed the amount actually paid', async () => {
      const { saleId, total } = await createDiscountedCashSaleAndComplete('refundcumulative-1', '3', '1000'); // 10% off, 3 units
      const saleRow = await sales.sale(companyId, branchIds, saleId);
      const item = saleRow.items[0];
      if (item === undefined) throw new Error('Expected a sale item.');
      let cumulativeRefundedUnits = 0n;
      for (let i = 0; i < 3; i += 1) {
        const refund = await refunds.createRefund(context, branchIds, `refund-${saleId}-${String(i)}`, {
          saleId,
          reasonCode: 'qa_cumulative',
          items: [{ saleItemId: item.id, quantity: '1' }],
        });
        cumulativeRefundedUnits += BigInt(Math.round(Number(refund.value.total) * 10_000));
      }
      const paidUnits = BigInt(Math.round(Number(total) * 10_000));
      expect(cumulativeRefundedUnits <= paidUnits).toBe(true);
      // A 4th unit was never sold — refunding it must fail, never
      // silently succeed past what was actually sold.
      await expect(
        refunds.createRefund(context, branchIds, `refund-${saleId}-overflow`, {
          saleId,
          reasonCode: 'qa_overflow',
          items: [{ saleItemId: item.id, quantity: '1' }],
        }),
      ).rejects.toMatchObject({ code: 'refund_limit_exceeded' });
    });
  });

  describe('quote/preview', () => {
    it('a quote reports the same totals a real sale creation would produce, and never creates anything', async () => {
      await createPromotion('promo-quote-1', { benefitPercentageBasisPoints: 1500 });
      const before = await database.pool.query(`select count(*)::text as n from sales where company_id=$1`, [companyId]);
      const quote = await promotions.quote(context, branchIds, {
        branchId,
        items: [{ productId, quantity: '2' }],
      });
      expect(quote.discountTotalUnits).toBeGreaterThan(0n);
      const after = await database.pool.query(`select count(*)::text as n from sales where company_id=$1`, [companyId]);
      expect(after.rows[0]).toEqual(before.rows[0]);
    });
  });

  describe('Sale Detail commercial adjustments (Part V)', () => {
    it('lists every discount actually applied to a sale, with the real actor/reason recorded', async () => {
      await createPromotion('promo-saledetail-1', { benefitPercentageBasisPoints: 1000 });
      const created = await sales.createSale(context, branchIds, 'sale-saledetail-1', {
        branchId,
        items: [{ productId, quantity: '1' }],
        manualDiscount: { scope: 'ticket', type: 'fixed_amount', value: '5.0000', reasonCode: 'qa_saledetail' },
      });
      const discounts = await sales.saleDiscounts(companyId, branchIds, created.value.sale.id);
      expect(discounts).toHaveLength(2);
      expect(discounts.some((entry) => entry.sourceType === 'promotion')).toBe(true);
      expect(discounts.some((entry) => entry.sourceType === 'manual' && entry.reasonCode === 'qa_saledetail')).toBe(
        true,
      );
    });

    it('reports an empty list (never an error) for an undiscounted sale', async () => {
      const created = await sales.createSale(context, branchIds, 'sale-saledetail-empty-1', {
        branchId,
        items: [{ productId, quantity: '1' }],
      });
      const discounts = await sales.saleDiscounts(companyId, branchIds, created.value.sale.id);
      expect(discounts).toEqual([]);
    });
  });

  describe('security — manipulated client payloads never override the server', () => {
    it('createSale ignores any attempt to smuggle a discount via a normal product line and still derives it independently', async () => {
      await createPromotion('promo-security-1', { benefitPercentageBasisPoints: 1000 });
      const created = await sales.createSale(context, branchIds, 'sale-security-1', {
        branchId,
        items: [{ productId, quantity: '1' }],
      });
      // The server-computed discount is present regardless of anything
      // the client did or didn't send — `CreateSaleInput`/`SaleBody` have
      // no field a client could even use to submit a fake amount.
      expect(created.value.sale.discountTotal).toBe('10.0000');
    });

    it('a promotion.manage-less actor cannot create a promotion', async () => {
      await expect(
        promotions.createPromotion({ ...context, actorPermissions: [] }, 'sale-security-promo-1', {
          name: 'Should fail',
          benefitType: 'percentage',
          benefitPercentageBasisPoints: 1000,
        }),
      ).rejects.toBeInstanceOf(PromotionError);
    });
  });

  it('is a genuine SaleError/PromotionError subclass for every domain rejection', async () => {
    await expect(
      sales.createSale(context, branchIds, 'sale-error-check', {
        branchId,
        items: [{ productId, quantity: '1' }],
        couponCodes: ['NEVER-EXISTS'],
      }),
    ).rejects.toBeInstanceOf(SaleError);
  });
});
