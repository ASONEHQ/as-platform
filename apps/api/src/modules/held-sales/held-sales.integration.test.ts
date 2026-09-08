import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';

import { CashRepository } from '../cash/cash.repository.js';
import { PaymentRepository } from '../payments/payments.repository.js';
import { PaymentService } from '../payments/payments.service.js';
import { MercadoPagoClient } from '../payments/providers/mercado-pago.client.js';
import { MercadoPagoPointProvider } from '../payments/providers/mercado-pago.provider.js';
import { SalesRepository } from '../sales/sales.repository.js';
import { SalesService } from '../sales/sales.service.js';
import { HeldSaleCartsRepository } from './held-sales.repository.js';
import { HeldSaleCartsService } from './held-sales.service.js';
import { HeldSaleCartError } from './held-sales.types.js';

/** TASK 14.3 (Wave 1, Part B.1/B.4) — suspended/held sale carts. See
 * `docs/LEGACY_FUNCTIONAL_PARITY.md`'s Ventas/UI-flows sections for the
 * behavioral evidence this recovers, and `held-sales.repository.ts`'s own
 * doc comment for the resume/link-sale two-step handshake's exact
 * reconciliation against `held_sale_carts_resumed_fields_ck`.
 *
 * Every assertion below that claims a mutation "persisted" re-reads the
 * row via `held.cart(...)` — a plain `this.database.pool.query(...)`
 * against real Postgres, never an in-memory cache of any kind (there is
 * none anywhere in this module) — rather than trusting the value handed
 * back by the mutating call itself. Running against a real, restartable
 * Postgres instance (never an in-process fake) is therefore itself the
 * proof that a suspended cart, a resume, a link, or a discard all
 * genuinely survive a process restart: nothing here is held in memory
 * between one call and the next. */
const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;
const migrationsPath = resolve(import.meta.dirname, '../../../../../packages/database/drizzle');

integration('PostgreSQL held sale carts (TASK 14.3 Wave 1 Part B.1)', { concurrent: false }, () => {
  let database: DatabaseClient;
  let held: HeldSaleCartsService;
  let sales: SalesService;
  let payments: PaymentService;
  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const branchId = randomUUID();
  const otherBranchId = randomUUID();
  const otherCompanyBranchId = randomUUID();
  const userId = randomUUID();
  const secondUserId = randomUUID();
  const otherCompanyUserId = randomUUID();
  const productId = randomUUID();
  const productId2 = randomUUID();
  const branchIds = [branchId, otherBranchId];
  const context = {
    companyId,
    actorId: userId,
    requestId: 'held-sale-request',
    correlationId: 'held-sale-correlation',
    timestamp: new Date('2026-09-07T09:00:00.000Z'),
  };

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
  async function applyIfColumnMissing(table: string, column: string, files: readonly string[]): Promise<void> {
    const check = await database.pool.query<{ present: boolean }>(
      `select exists(select 1 from information_schema.columns where table_name='${table}' and column_name='${column}') present`,
    );
    if (check.rows[0]?.present === true) return;
    for (const file of files) {
      const sql = await readFile(resolve(migrationsPath, file), 'utf8');
      for (const statement of sql.split('--> statement-breakpoint'))
        if (statement.trim().length > 0) await database.pool.query(statement);
    }
  }

  beforeAll(async () => {
    if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({ connectionString: databaseUrl, applicationName: 'asone-held-sales-integration' });
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
    await applyIfColumnMissing('sale_items', 'product_variant_id', ['0015_true_molecule_man.sql']);
    await applyIfMissing('cash_registers', ['0016_jittery_slayback.sql', '0017_gifted_vertigo.sql']);
    await applyIfColumnMissing('cash_sessions', 'denomination_counts', ['0018_glossy_mongu.sql']);
    // TASK 14.3's own migration 0024 (already applied to `asone_test` per
    // this task's own setup) — this defensive catch-up only runs against
    // a test database that somehow never had it applied at all.
    await applyIfMissing('held_sale_carts', [
      '0019_nosy_the_twelve.sql',
      '0020_broad_ben_grimm.sql',
      '0021_powerful_ezekiel_stane.sql',
      '0022_cheerful_scrambler.sql',
      '0023_tan_luke_cage.sql',
      '0024_vengeful_metal_master.sql',
    ]);
    await applyIfColumnMissing('sales', 'note', ['0024_vengeful_metal_master.sql']);

    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'Held Sales Co','Held Sales Co',$2,'active','UTC','MXN','es-MX'),
             ($3,'Other Held Sales Co','Other Held Sales Co',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `held-${companyId}`, otherCompanyId, `held-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'Held Main','HMAIN','active','UTC'),
             ($3,$2,'Held Second','HSECOND','active','UTC'),
             ($4,$5,'Held Other Co','HOTHER','active','UTC')`,
      [branchId, companyId, otherBranchId, otherCompanyBranchId, otherCompanyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'Held Cashier','active'),($3,$4,$4,'Held Second Cashier','active'),($5,$6,$6,'Held Other Co User','active')`,
      [
        userId,
        `held-${userId}@example.test`,
        secondUserId,
        `held-${secondUserId}@example.test`,
        otherCompanyUserId,
        `held-${otherCompanyUserId}@example.test`,
      ],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status)
       values($1,$2,$3,'active'),($4,$2,$5,'active'),($6,$7,$8,'active')`,
      [randomUUID(), companyId, userId, randomUUID(), secondUserId, randomUUID(), otherCompanyId, otherCompanyUserId],
    );
    await database.pool.query(
      // IVA_EXEMPT so a $29.00 price yields an exact $29.00 total.
      `insert into products
       (id,company_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
       values($1,$2,'HELD-PRODUCT-1','held-product-1','Held Product 1','simple',false,'IVA_EXEMPT','active',$3,$3),
             ($4,$2,'HELD-PRODUCT-2','held-product-2','Held Product 2','simple',false,'IVA_EXEMPT','active',$3,$3)`,
      [productId, companyId, userId, productId2],
    );
    await database.pool.query(
      `insert into product_prices (id,company_id,product_id,amount,currency_code,status,created_by,updated_by)
       values($1,$2,$3,'29.0000','MXN','active',$4,$4),
             ($5,$2,$6,'15.0000','MXN','active',$4,$4)`,
      [randomUUID(), companyId, productId, userId, randomUUID(), productId2],
    );

    const heldRepository = new HeldSaleCartsRepository(database);
    const salesRepository = new SalesRepository(database);
    held = new HeldSaleCartsService(heldRepository, salesRepository);
    sales = new SalesService(salesRepository);
    const cashRepository = new CashRepository(database);
    const paymentRepository = new PaymentRepository(database);
    const mercadoPagoProvider = new MercadoPagoPointProvider(
      new MercadoPagoClient({ accessToken: undefined, apiBaseUrl: 'https://api.mercadopago.com' }),
    );
    payments = new PaymentService(paymentRepository, salesRepository, mercadoPagoProvider, cashRepository);
  });

  afterAll(async () => {
    await database.pool.query('delete from payment_attempts where company_id=$1', [companyId]);
    await database.pool.query('delete from payments where company_id=$1', [companyId]);
    await database.pool.query('delete from sale_items where company_id=$1', [companyId]);
    await database.pool.query('delete from sales where company_id=$1', [companyId]);
    await database.pool.query('delete from held_sale_carts where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from cash_movements where company_id=$1', [companyId]);
    await database.pool.query('delete from cash_sessions where company_id=$1', [companyId]);
    await database.pool.query('delete from cash_registers where company_id=$1', [companyId]);
    await database.pool.query('delete from idempotency_keys where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from outbox_events where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from audit_log where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from product_prices where company_id=$1', [companyId]);
    await database.pool.query('delete from products where company_id=$1', [companyId]);
    await database.pool.query('delete from company_memberships where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from branches where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from companies where id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from users where id in ($1,$2,$3)', [userId, secondUserId, otherCompanyUserId]);
    await database.close();
  });

  it('suspends a cart and GET detail confirms the exact status/items held', async () => {
    const created = await held.createCart(context, branchIds, 'held-create-1', {
      branchId,
      items: [
        { productId, quantity: '2' },
        { productId: productId2, quantity: '1' },
      ],
    });
    expect(created.replayed).toBe(false);
    expect(created.value.status).toBe('held');
    expect(created.value.items).toEqual([
      { productId, quantity: '2' },
      { productId: productId2, quantity: '1' },
    ]);

    // Re-read fresh from the database — never trust the mutating call's
    // own return value for "did this persist."
    const reread = await held.cart(companyId, branchIds, created.value.id);
    expect(reread.status).toBe('held');
    expect(reread.items).toEqual(created.value.items);
    expect(reread.resumedSaleId).toBeNull();
    expect(reread.discardedAt).toBeNull();
  });

  it('resumes (claims) a cart, hands back the exact held items, flips to resuming — never resumed until linked — and cleanly rejects a second claim', async () => {
    const created = await held.createCart(context, branchIds, 'held-resume-create-1', {
      branchId,
      items: [{ productId, quantity: '3' }],
    });

    const resumed = await held.resumeCart(context, branchIds, created.value.id, 'held-resume-1');
    expect(resumed.replayed).toBe(false);
    // TASK 14.3A: resuming, NOT resumed — no real sale exists yet, and
    // the status says so honestly (no sentinel, no premature terminal
    // state).
    expect(resumed.value.status).toBe('resuming');
    expect(resumed.value.items).toEqual(created.value.items);
    expect(resumed.value.claimedBy).toBe(userId);
    expect(resumed.value.claimedAt).not.toBeNull();
    // Genuinely null — not a sentinel of any kind — until `linkSale`.
    expect(resumed.value.resumedSaleId).toBeNull();
    expect(resumed.value.resumedAt).toBeNull();
    expect(resumed.value.resumedBy).toBeNull();

    // Restart-safety: re-read fresh, never trust the in-memory return.
    const reread = await held.cart(companyId, branchIds, created.value.id);
    expect(reread.status).toBe('resuming');
    expect(reread.claimedBy).toBe(userId);
    expect(reread.claimedAt).not.toBeNull();
    expect(reread.resumedSaleId).toBeNull();

    // The exact same idempotency key is a safe replay, never an error.
    const replay = await held.resumeCart(context, branchIds, created.value.id, 'held-resume-1');
    expect(replay.replayed).toBe(true);

    // A genuinely new attempt (different idempotency key) to claim an
    // already-claimed cart is cleanly rejected — never a raw DB error.
    await expect(
      held.resumeCart(context, branchIds, created.value.id, 'held-resume-2-distinct-key'),
    ).rejects.toMatchObject({ code: 'invalid_cart_state' });
    await expect(
      held.resumeCart(context, branchIds, created.value.id, 'held-resume-2-distinct-key'),
    ).rejects.toBeInstanceOf(HeldSaleCartError);
  });

  it('link-sale is the real, terminal resumed transition — sets resumedSaleId atomically with status, and rejects a second link', async () => {
    const created = await held.createCart(context, branchIds, 'held-link-create-1', {
      branchId,
      items: [{ productId, quantity: '1' }],
    });
    const resumed = await held.resumeCart(context, branchIds, created.value.id, 'held-link-resume-1');
    expect(resumed.value.status).toBe('resuming');
    expect(resumed.value.resumedSaleId).toBeNull();

    // The client's normal `POST /sales` flow, fed the exact items the
    // resume handed back — this module never calls `SalesService`
    // itself (see its own doc comment).
    const createdSale = await sales.createSale(context, branchIds, 'held-link-sale-1', {
      branchId,
      items: resumed.value.items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
    });
    expect(createdSale.value.sale.total).toBe('29.0000');

    const linked = await held.linkSale(
      context,
      branchIds,
      created.value.id,
      'held-link-linksale-1',
      createdSale.value.sale.id,
    );
    expect(linked.replayed).toBe(false);
    // TASK 14.3A: NOW it's really `resumed` — status and resumedSaleId
    // flip together, atomically, to real values.
    expect(linked.value.status).toBe('resumed');
    expect(linked.value.resumedSaleId).toBe(createdSale.value.sale.id);
    expect(linked.value.resumedBy).toBe(userId);
    expect(linked.value.resumedAt).not.toBeNull();
    // The claim trace from the first step survives, as history.
    expect(linked.value.claimedBy).toBe(userId);

    // Restart-safety: re-read fresh.
    const reread = await held.cart(companyId, branchIds, created.value.id);
    expect(reread.status).toBe('resumed');
    expect(reread.resumedSaleId).toBe(createdSale.value.sale.id);

    // Same idempotency key replays safely.
    const replay = await held.linkSale(
      context,
      branchIds,
      created.value.id,
      'held-link-linksale-1',
      createdSale.value.sale.id,
    );
    expect(replay.replayed).toBe(true);

    // A distinct second attempt to link (a new idempotency key) is
    // cleanly rejected — the cart was already linked.
    await expect(
      held.linkSale(context, branchIds, created.value.id, 'held-link-linksale-2-distinct-key', createdSale.value.sale.id),
    ).rejects.toMatchObject({ code: 'invalid_cart_state' });
  });

  it('TASK 14.3A — two concurrent resume attempts on the same cart: exactly one succeeds, the loser gets a deterministic conflict, no duplicate claim', async () => {
    const created = await held.createCart(context, branchIds, 'held-concurrent-create-1', {
      branchId,
      items: [{ productId, quantity: '1' }],
    });
    const secondActorContext = { ...context, actorId: secondUserId };

    const [first, second] = await Promise.allSettled([
      held.resumeCart(context, branchIds, created.value.id, 'held-concurrent-resume-actor-1'),
      held.resumeCart(secondActorContext, branchIds, created.value.id, 'held-concurrent-resume-actor-2'),
    ]);

    const outcomes = [first, second];
    const fulfilled = outcomes.filter(
      (o): o is PromiseFulfilledResult<Awaited<ReturnType<typeof held.resumeCart>>> => o.status === 'fulfilled',
    );
    const rejected = outcomes.filter((o): o is PromiseRejectedResult => o.status === 'rejected');
    // Exactly one wins, exactly one loses — a real, deterministic
    // conflict from the database's own CAS `WHERE status='held'` guard,
    // never a race that lets both through.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: 'invalid_cart_state' });

    // No duplicate claim: re-reading fresh shows exactly one claimant.
    const reread = await held.cart(companyId, branchIds, created.value.id);
    expect(reread.status).toBe('resuming');
    expect([userId, secondUserId]).toContain(reread.claimedBy);
  });

  it('TASK 14.3A — an abandoned claim (resuming) is never permanently stuck: release makes the cart claimable again, then a fresh resume/link/checkout cycle completes normally', async () => {
    const created = await held.createCart(context, branchIds, 'held-release-create-1', {
      branchId,
      items: [{ productId, quantity: '1' }],
    });
    const resumed = await held.resumeCart(context, branchIds, created.value.id, 'held-release-resume-1');
    expect(resumed.value.status).toBe('resuming');

    // A different actor without sale.cancel cannot release someone
    // else's claim.
    await expect(
      held.releaseCart(
        { ...context, actorId: secondUserId, actorPermissions: [] },
        branchIds,
        created.value.id,
        'held-release-wrong-actor-1',
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });

    // The claimant itself can release — the recovery rule this task
    // requires: an abandoned `resuming` cart is never permanently stuck.
    const released = await held.releaseCart(context, branchIds, created.value.id, 'held-release-1');
    expect(released.value.status).toBe('held');
    // The claim trace survives as history — never cleared.
    expect(released.value.claimedBy).toBe(userId);
    expect(released.value.claimedAt).not.toBeNull();
    expect(released.value.resumedSaleId).toBeNull();

    // Restart-safety.
    const reread = await held.cart(companyId, branchIds, created.value.id);
    expect(reread.status).toBe('held');

    // Releasing an already-held (never-claimed, or already-released)
    // cart is cleanly rejected, never a silent no-op.
    await expect(
      held.releaseCart(context, branchIds, created.value.id, 'held-release-2-distinct-key'),
    ).rejects.toMatchObject({ code: 'invalid_cart_state' });

    // A fresh claim/link/checkout cycle now completes normally — the
    // cart genuinely is available again, not just "released" in name.
    const secondClaim = await held.resumeCart(context, branchIds, created.value.id, 'held-release-reclaim-1');
    expect(secondClaim.value.status).toBe('resuming');
    const secondSale = await sales.createSale(context, branchIds, 'held-release-reclaim-sale-1', {
      branchId,
      items: secondClaim.value.items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
    });
    const secondLink = await held.linkSale(
      context,
      branchIds,
      created.value.id,
      'held-release-reclaim-link-1',
      secondSale.value.sale.id,
    );
    expect(secondLink.value.status).toBe('resumed');
    expect(secondLink.value.resumedSaleId).toBe(secondSale.value.sale.id);
  });

  it('TASK 14.3A — a claimed (resuming) cart can be discarded directly, without a release round-trip first, and can never be resumed again', async () => {
    const created = await held.createCart(context, branchIds, 'held-discard-resuming-create-1', {
      branchId,
      items: [{ productId, quantity: '1' }],
    });
    const resumed = await held.resumeCart(context, branchIds, created.value.id, 'held-discard-resuming-resume-1');
    expect(resumed.value.status).toBe('resuming');

    const discarded = await held.discardCart(
      context,
      branchIds,
      created.value.id,
      'held-discard-resuming-1',
      'cajero canceló',
    );
    expect(discarded.value.status).toBe('discarded');

    await expect(
      held.resumeCart(context, branchIds, created.value.id, 'held-discard-resuming-resume-2'),
    ).rejects.toMatchObject({ code: 'invalid_cart_state' });
    await expect(
      held.releaseCart(context, branchIds, created.value.id, 'held-discard-resuming-release-1'),
    ).rejects.toMatchObject({ code: 'invalid_cart_state' });
  });

  it('TASK 14.3A — a resumed (completed) cart can never be resumed, released, or discarded again', async () => {
    const created = await held.createCart(context, branchIds, 'held-terminal-create-1', {
      branchId,
      items: [{ productId, quantity: '1' }],
    });
    const resumed = await held.resumeCart(context, branchIds, created.value.id, 'held-terminal-resume-1');
    const sale = await sales.createSale(context, branchIds, 'held-terminal-sale-1', {
      branchId,
      items: resumed.value.items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
    });
    const linked = await held.linkSale(context, branchIds, created.value.id, 'held-terminal-link-1', sale.value.sale.id);
    expect(linked.value.status).toBe('resumed');

    await expect(
      held.resumeCart(context, branchIds, created.value.id, 'held-terminal-resume-2'),
    ).rejects.toMatchObject({ code: 'invalid_cart_state' });
    await expect(
      held.releaseCart(context, branchIds, created.value.id, 'held-terminal-release-1'),
    ).rejects.toMatchObject({ code: 'invalid_cart_state' });
    await expect(
      held.discardCart(context, branchIds, created.value.id, 'held-terminal-discard-1', undefined),
    ).rejects.toMatchObject({ code: 'invalid_cart_state' });
  });

  it('rejects link-sale before the cart has been resumed', async () => {
    const created = await held.createCart(context, branchIds, 'held-link-unresumed-create-1', {
      branchId,
      items: [{ productId, quantity: '1' }],
    });
    await expect(
      held.linkSale(context, branchIds, created.value.id, 'held-link-unresumed-1', randomUUID()),
    ).rejects.toMatchObject({ code: 'invalid_cart_state' });
  });

  it('discards a held cart, and a discarded cart can never be resumed', async () => {
    const created = await held.createCart(context, branchIds, 'held-discard-create-1', {
      branchId,
      items: [{ productId, quantity: '1' }],
    });
    const discarded = await held.discardCart(context, branchIds, created.value.id, 'held-discard-1', 'cliente se fue');
    expect(discarded.value.status).toBe('discarded');
    expect(discarded.value.discardedBy).toBe(userId);

    const reread = await held.cart(companyId, branchIds, created.value.id);
    expect(reread.status).toBe('discarded');
    expect(reread.discardedAt).not.toBeNull();

    await expect(
      held.resumeCart(context, branchIds, created.value.id, 'held-discard-then-resume-1'),
    ).rejects.toMatchObject({ code: 'invalid_cart_state' });
    await expect(
      held.discardCart(context, branchIds, created.value.id, 'held-discard-twice-1', undefined),
    ).rejects.toMatchObject({ code: 'invalid_cart_state' });
  });

  it('discard permission: the creator may always discard; a different actor needs sale.cancel', async () => {
    const created = await held.createCart(context, branchIds, 'held-discard-perm-create-1', {
      branchId,
      items: [{ productId, quantity: '1' }],
    });
    const otherActorContext = { ...context, actorId: secondUserId, actorPermissions: [] as readonly string[] };
    // A different actor (same company) with no `sale.cancel` is cleanly
    // rejected.
    await expect(
      held.discardCart(otherActorContext, branchIds, created.value.id, 'held-discard-perm-1', undefined),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // The same different actor, now WITH `sale.cancel`, may discard it.
    const otherActorWithPermission = { ...context, actorId: secondUserId, actorPermissions: ['sale.cancel'] };
    const discarded = await held.discardCart(
      otherActorWithPermission,
      branchIds,
      created.value.id,
      'held-discard-perm-2',
      undefined,
    );
    expect(discarded.value.status).toBe('discarded');
    expect(discarded.value.discardedBy).toBe(secondUserId);
  });

  it('the creator itself never needs sale.cancel to discard their own cart', async () => {
    const created = await held.createCart(context, branchIds, 'held-discard-self-create-1', {
      branchId,
      items: [{ productId, quantity: '1' }],
    });
    const selfContext = { ...context, actorPermissions: [] as readonly string[] };
    const discarded = await held.discardCart(selfContext, branchIds, created.value.id, 'held-discard-self-1', undefined);
    expect(discarded.value.status).toBe('discarded');
  });

  it('tenant isolation — another company can never see, resume, or discard this held cart', async () => {
    const created = await held.createCart(context, branchIds, 'held-tenantiso-create-1', {
      branchId,
      items: [{ productId, quantity: '1' }],
    });
    const otherCompanyContext = {
      companyId: otherCompanyId,
      actorId: otherCompanyUserId,
      requestId: 'held-tenantiso-request',
      correlationId: 'held-tenantiso-correlation',
      timestamp: context.timestamp,
    };
    const otherCompanyBranchIds = [otherCompanyBranchId];
    await expect(held.cart(otherCompanyId, otherCompanyBranchIds, created.value.id)).rejects.toMatchObject({
      code: 'resource_not_found',
    });
    await expect(
      held.resumeCart(otherCompanyContext, otherCompanyBranchIds, created.value.id, 'held-tenantiso-resume-1'),
    ).rejects.toMatchObject({ code: 'resource_not_found' });
    await expect(
      held.discardCart(otherCompanyContext, otherCompanyBranchIds, created.value.id, 'held-tenantiso-discard-1', undefined),
    ).rejects.toMatchObject({ code: 'resource_not_found' });
    // The cart itself is untouched by these rejected cross-tenant
    // attempts.
    const stillHeld = await held.cart(companyId, branchIds, created.value.id);
    expect(stillHeld.status).toBe('held');
  });

  it('branch isolation — a cart from branch X is not visible via a branch-Y-scoped list query', async () => {
    const created = await held.createCart(context, branchIds, 'held-branchiso-create-1', {
      branchId,
      items: [{ productId, quantity: '1' }],
    });
    const scopedToOtherBranchOnly = await held.listCarts(companyId, [otherBranchId], { limit: 50 });
    expect(scopedToOtherBranchOnly.items.some((item) => item.id === created.value.id)).toBe(false);
    const scopedToOwnBranch = await held.listCarts(companyId, [branchId], { limit: 50, branchId });
    expect(scopedToOwnBranch.items.some((item) => item.id === created.value.id)).toBe(true);
    // A direct read scoped only to the other branch also fails — never
    // just filtered out of a list.
    await expect(held.cart(companyId, [otherBranchId], created.value.id)).rejects.toMatchObject({
      code: 'resource_not_found',
    });
  });

  it('list defaults to status=held ("what is currently paused") unless a status filter says otherwise', async () => {
    const held1 = await held.createCart(context, branchIds, 'held-liststatus-create-1', {
      branchId,
      items: [{ productId, quantity: '1' }],
    });
    const toDiscard = await held.createCart(context, branchIds, 'held-liststatus-create-2', {
      branchId,
      items: [{ productId, quantity: '1' }],
    });
    await held.discardCart(context, branchIds, toDiscard.value.id, 'held-liststatus-discard-1', undefined);

    const defaultView = await held.listCarts(companyId, branchIds, { limit: 100 });
    expect(defaultView.items.some((item) => item.id === held1.value.id)).toBe(true);
    expect(defaultView.items.some((item) => item.id === toDiscard.value.id)).toBe(false);

    const discardedView = await held.listCarts(companyId, branchIds, { limit: 100, status: 'discarded' });
    expect(discardedView.items.some((item) => item.id === toDiscard.value.id)).toBe(true);
    expect(discardedView.items.some((item) => item.id === held1.value.id)).toBe(false);
  });

  it('end-to-end: suspend a 2-item cart -> resume -> build+pay a real sale from those exact items -> the sale completes', async () => {
    const registerId = randomUUID();
    await database.pool.query(
      `insert into cash_registers (id,company_id,branch_id,code,normalized_code,name,status,created_by,updated_by)
       values ($1,$2,$3,'HELD-E2E','held-e2e','Held E2E','active',$4,$4)`,
      [registerId, companyId, branchId, userId],
    );
    const sessionId = randomUUID();
    await database.pool.query(
      `insert into cash_sessions (id,company_id,branch_id,cash_register_id,opened_by,opened_at,opening_amount,currency_code,status)
       values ($1,$2,$3,$4,$5,$6,'0.0000','MXN','open')`,
      [sessionId, companyId, branchId, registerId, userId, context.timestamp],
    );

    const created = await held.createCart(context, branchIds, 'held-e2e-create-1', {
      branchId,
      items: [
        { productId, quantity: '2' },
        { productId: productId2, quantity: '1' },
      ],
    });
    const resumed = await held.resumeCart(context, branchIds, created.value.id, 'held-e2e-resume-1');
    expect(resumed.value.items).toEqual([
      { productId, quantity: '2' },
      { productId: productId2, quantity: '1' },
    ]);

    // 2×29.00 + 1×15.00 = 73.00.
    const createdSale = await sales.createSale(context, branchIds, 'held-e2e-sale-1', {
      branchId,
      items: resumed.value.items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
    });
    expect(createdSale.value.sale.total).toBe('73.0000');

    const paid = await payments.createCashPayment(context, branchIds, 'held-e2e-pay-1', {
      saleId: createdSale.value.sale.id,
      tenderedAmount: '73.00',
      cashRegisterId: registerId,
    });
    expect(paid.value.sale.status).toBe('completed');

    await held.linkSale(context, branchIds, created.value.id, 'held-e2e-linksale-1', createdSale.value.sale.id);
    const finalCart = await held.cart(companyId, branchIds, created.value.id);
    expect(finalCart.status).toBe('resumed');
    expect(finalCart.resumedSaleId).toBe(createdSale.value.sale.id);

    const finalSale = await sales.sale(companyId, branchIds, createdSale.value.sale.id);
    expect(finalSale.sale.status).toBe('completed');
    expect(finalSale.items).toHaveLength(2);
  });

  it('is a genuine HeldSaleCartError subclass for every domain rejection', async () => {
    await expect(held.cart(companyId, branchIds, randomUUID())).rejects.toBeInstanceOf(HeldSaleCartError);
  });
});
