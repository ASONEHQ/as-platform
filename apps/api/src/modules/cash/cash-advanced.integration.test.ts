import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';

import { CashRepository } from './cash.repository.js';
import { CashService } from './cash.service.js';
import { CashError, type CashSessionRow } from './cash.types.js';

/** TASK 14.4 (Wave 2, Part F) — "Advanced Cash Operations": categorized
 * cash_in/cash_out movements (withdrawal/expense/external_income/other)
 * and the "corte parcial" (partial close) audit snapshot. This EXTENDS
 * TASK 12.7's cash module (see cash.integration.test.ts for the
 * foundation — 3-state session machine, opening float, manual cash in/
 * out, cash sale/refund integration, close) without changing any of its
 * existing behavior. */
const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;
const migrationsPath = resolve(import.meta.dirname, '../../../../../packages/database/drizzle');

integration('PostgreSQL cash advanced operations (TASK 14.4 Wave 2)', { concurrent: false }, () => {
  let database: DatabaseClient;
  let cash: CashService;
  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const branchId = randomUUID();
  const otherBranchId = randomUUID();
  const otherCompanyBranchId = randomUUID();
  const userId = randomUUID();
  const otherCompanyUserId = randomUUID();
  const context = {
    companyId,
    actorId: userId,
    requestId: 'cash-advanced-request',
    correlationId: 'cash-advanced-correlation',
    timestamp: new Date('2026-09-07T09:00:00.000Z'),
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

  async function applyMigrationFile(file: string): Promise<void> {
    const sql = await readFile(resolve(migrationsPath, file), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint'))
      if (statement.trim().length > 0) await database.pool.query(statement);
  }

  async function openRegisterAndSession(
    key: string,
    openingAmount: string,
  ): Promise<{ registerId: string; session: CashSessionRow }> {
    const register = await cash.createRegister(context, branchIds, `${key}-reg`, {
      branchId,
      code: `REG-${key.toUpperCase()}`,
      name: `Caja ${key}`,
    });
    const opened = await cash.openSession(context, branchIds, `${key}-session`, {
      cashRegisterId: register.value.id,
      openingAmount,
    });
    return { registerId: register.value.id, session: opened.value };
  }

  beforeAll(async () => {
    if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({
      connectionString: databaseUrl,
      applicationName: 'asone-cash-advanced-integration',
    });
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
    if (variantColumnPresent.rows[0]?.present !== true) await applyMigrationFile('0015_true_molecule_man.sql');
    await applyIfMissing('cash_registers', ['0016_jittery_slayback.sql', '0017_gifted_vertigo.sql']);
    const denominationColumnPresent = await database.pool.query<{ present: boolean }>(
      `select exists(select 1 from information_schema.columns where table_name='cash_sessions' and column_name='denomination_counts') present`,
    );
    if (denominationColumnPresent.rows[0]?.present !== true) await applyMigrationFile('0018_glossy_mongu.sql');
    // TASK 13.0/13.1/14.x tables this suite doesn't otherwise touch, but
    // which 0025's own migration file depends on existing first (its own
    // FK targets) — applied idempotently, matching the exact pattern
    // above.
    await applyIfMissing('refund_items', ['0019_nosy_the_twelve.sql']);
    await applyIfMissing('coupon_redemptions', ['0020_broad_ben_grimm.sql']);
    await applyIfMissing('customer_memberships', ['0021_powerful_ezekiel_stane.sql']);
    await applyIfMissing('reward_entitlement_tokens', ['0022_cheerful_scrambler.sql']);
    await applyIfMissing('loyalty_program_reward_categories', ['0023_tan_luke_cage.sql']);
    await applyIfMissing('held_sale_carts', ['0024_vengeful_metal_master.sql']);
    // TASK 14.4 Wave 2 Part F's own schema: `cash_movements.category` and
    // `cash_session_partial_closes`.
    const categoryColumnPresent = await database.pool.query<{ present: boolean }>(
      `select exists(select 1 from information_schema.columns where table_name='cash_movements' and column_name='category') present`,
    );
    if (categoryColumnPresent.rows[0]?.present !== true) await applyMigrationFile('0025_worried_the_captain.sql');

    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'Cash Adv Co','Cash Adv Co',$2,'active','UTC','MXN','es-MX'),
             ($3,'Cash Adv Other Co','Cash Adv Other Co',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `cash-adv-${companyId}`, otherCompanyId, `cash-adv-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'Cash Adv Main','CADVMAIN','active','UTC'),
             ($3,$2,'Cash Adv Second','CADVSECOND','active','UTC'),
             ($4,$5,'Cash Adv Other Co','CADVOTHER','active','UTC')`,
      [branchId, companyId, otherBranchId, otherCompanyBranchId, otherCompanyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'Cash Adv Cashier','active'),($3,$4,$4,'Cash Adv Other Co User','active')`,
      [userId, `cash-adv-${userId}@example.test`, otherCompanyUserId, `cash-adv-${otherCompanyUserId}@example.test`],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status)
       values($1,$2,$3,'active'),($4,$5,$6,'active')`,
      [randomUUID(), companyId, userId, randomUUID(), otherCompanyId, otherCompanyUserId],
    );
    const cashRepository = new CashRepository(database);
    cash = new CashService(cashRepository);
  });

  afterAll(async () => {
    await database.pool.query('delete from cash_session_partial_closes where company_id in ($1,$2)', [
      companyId,
      otherCompanyId,
    ]);
    await database.pool.query('delete from cash_movements where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from cash_sessions where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from cash_registers where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from idempotency_keys where company_id in ($1,$2)', [companyId, otherCompanyId]);
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

  // --- Categorized manual movements (Part F.1) ------------------------------

  describe('categorized movements', () => {
    it('posts a cash_out movement with category=withdrawal, retrievable with that category', async () => {
      const { session } = await openRegisterAndSession('cat-withdrawal', '0');
      const created = await cash.createMovement(context, branchIds, 'cat-withdrawal-move-1', session.id, {
        movementType: 'cash_out',
        amount: '150.0000',
        reasonCode: 'safe_drop',
        category: 'withdrawal',
      });
      expect(created.value.category).toBe('withdrawal');
      const page = await cash.listMovements(companyId, branchIds, session.id, { limit: 50 });
      const retrieved = page.items.find((item) => item.id === created.value.id);
      expect(retrieved?.category).toBe('withdrawal');
    });

    it('rejects cash_out with category=external_income (mismatched direction) before any DB write', async () => {
      const { session } = await openRegisterAndSession('cat-mismatch', '0');
      await expect(
        cash.createMovement(context, branchIds, 'cat-mismatch-move-1', session.id, {
          movementType: 'cash_out',
          amount: '50.0000',
          reasonCode: 'bad-category-marker',
          category: 'external_income',
        }),
      ).rejects.toMatchObject({ code: 'validation_error' });
      const rows = await database.pool.query(
        `select 1 from cash_movements where company_id=$1 and cash_session_id=$2 and reason_code='bad-category-marker'`,
        [companyId, session.id],
      );
      expect(rows.rows).toHaveLength(0);
    });

    it('rejects cash_in with category=withdrawal (mismatched direction) before any DB write', async () => {
      const { session } = await openRegisterAndSession('cat-mismatch-2', '0');
      await expect(
        cash.createMovement(context, branchIds, 'cat-mismatch-2-move-1', session.id, {
          movementType: 'cash_in',
          amount: '50.0000',
          reasonCode: 'bad-category-marker-2',
          category: 'withdrawal',
        }),
      ).rejects.toMatchObject({ code: 'validation_error' });
      const rows = await database.pool.query(
        `select 1 from cash_movements where company_id=$1 and cash_session_id=$2 and reason_code='bad-category-marker-2'`,
        [companyId, session.id],
      );
      expect(rows.rows).toHaveLength(0);
    });

    it('posts a cash_in movement with category=external_income successfully', async () => {
      const { session } = await openRegisterAndSession('cat-extincome', '0');
      const created = await cash.createMovement(context, branchIds, 'cat-extincome-move-1', session.id, {
        movementType: 'cash_in',
        amount: '75.0000',
        reasonCode: 'extra_income',
        category: 'external_income',
      });
      expect(created.value.category).toBe('external_income');
    });

    it('accepts category=other on either direction', async () => {
      const { session } = await openRegisterAndSession('cat-other', '0');
      const inMovement = await cash.createMovement(context, branchIds, 'cat-other-in-1', session.id, {
        movementType: 'cash_in',
        amount: '10.0000',
        reasonCode: 'misc_in',
        category: 'other',
      });
      expect(inMovement.value.category).toBe('other');
      const outMovement = await cash.createMovement(context, branchIds, 'cat-other-out-1', session.id, {
        movementType: 'cash_out',
        amount: '5.0000',
        reasonCode: 'misc_out',
        category: 'other',
      });
      expect(outMovement.value.category).toBe('other');
    });

    it('leaves an uncategorized movement with category=null — behavior unchanged from TASK 12.7', async () => {
      const { session } = await openRegisterAndSession('cat-null', '0');
      const created = await cash.createMovement(context, branchIds, 'cat-null-move-1', session.id, {
        movementType: 'cash_in',
        amount: '10.0000',
        reasonCode: 'additional_float',
      });
      expect(created.value.category).toBeNull();
    });

    it('rejects an unrecognized category value', async () => {
      const { session } = await openRegisterAndSession('cat-invalid', '0');
      await expect(
        cash.createMovement(context, branchIds, 'cat-invalid-move-1', session.id, {
          movementType: 'cash_in',
          amount: '10.0000',
          reasonCode: 'test',
          // @ts-expect-error — deliberately not a recognized category, to
          // prove the service rejects it even past the type system.
          category: 'not-a-real-category',
        }),
      ).rejects.toMatchObject({ code: 'validation_error' });
    });

    it('rejects a categorized movement for an unauthorized branch', async () => {
      const { session } = await openRegisterAndSession('cat-branch-unauth', '0');
      await expect(
        cash.createMovement(context, [otherBranchId] /* branchId deliberately excluded */, 'cat-branch-unauth-1', session.id, {
          movementType: 'cash_out',
          amount: '10.0000',
          reasonCode: 'test',
          category: 'withdrawal',
        }),
      ).rejects.toMatchObject({ code: 'resource_not_found' });
    });
  });

  // --- Expected-cash reconciliation (Part F.2) -------------------------------

  describe('expected-cash math with categorized movements', () => {
    it('correctly incorporates a mix of categorized and uncategorized movements', async () => {
      const { session } = await openRegisterAndSession('cat-mix', '1000.0000');
      // Simulates a completed cash sale's own drawer movement directly —
      // this suite targets the fold formula itself; the real Sales/
      // Payments -> cash_sale integration is already exhaustively covered
      // by cash.integration.test.ts.
      await database.pool.query(
        `insert into cash_movements (id,company_id,branch_id,cash_session_id,movement_type,amount,currency_code,reason_code,occurred_at,created_by)
         values ($1,$2,$3,$4,'cash_sale','29.0000','MXN','cash_sale',$5,$6)`,
        [randomUUID(), companyId, branchId, session.id, context.timestamp, userId],
      );
      await cash.createMovement(context, branchIds, 'cat-mix-withdrawal-1', session.id, {
        movementType: 'cash_out',
        amount: '100.0000',
        reasonCode: 'safe_drop',
        category: 'withdrawal',
      });
      await cash.createMovement(context, branchIds, 'cat-mix-expense-1', session.id, {
        movementType: 'cash_out',
        amount: '40.0000',
        reasonCode: 'supplies',
        category: 'expense',
      });
      await cash.createMovement(context, branchIds, 'cat-mix-extincome-1', session.id, {
        movementType: 'cash_in',
        amount: '60.0000',
        reasonCode: 'extra_income',
        category: 'external_income',
      });
      // An uncategorized cash_in, folded into cash_in_total exactly as
      // before — proving category is transparent to the direction fold.
      await cash.createMovement(context, branchIds, 'cat-mix-uncategorized-1', session.id, {
        movementType: 'cash_in',
        amount: '15.0000',
        reasonCode: 'additional_float',
      });

      const summary = await cash.summary(companyId, branchIds, session.id);
      // 1000 (opening) + 29 (cash sale) + 60 (external income) + 15
      // (uncategorized cash_in) - 100 (withdrawal) - 40 (expense) = 964.
      expect(summary.expectedCash).toBe('964.0000');
      expect(summary.cashSalesTotal).toBe('29.0000');
      expect(summary.cashInTotal).toBe('75.0000');
      expect(summary.cashOutTotal).toBe('140.0000');
      expect(summary.withdrawalTotal).toBe('100.0000');
      expect(summary.expenseTotal).toBe('40.0000');
      expect(summary.externalIncomeTotal).toBe('60.0000');
    });
  });

  // --- Partial close / "corte parcial" (Part F.3) ----------------------------

  describe('partial close ("corte parcial")', () => {
    it('persists a snapshot matching a fresh summary(), and never closes the session', async () => {
      const { session } = await openRegisterAndSession('partial-basic', '500.0000');
      await cash.createMovement(context, branchIds, 'partial-basic-in-1', session.id, {
        movementType: 'cash_in',
        amount: '20.0000',
        reasonCode: 'extra_income',
        category: 'external_income',
      });
      const summaryBefore = await cash.summary(companyId, branchIds, session.id);
      const partial = await cash.partialClose(context, branchIds, 'partial-basic-close-1', session.id);
      expect(partial.replayed).toBe(false);
      expect(partial.value).toMatchObject({
        cashSessionId: session.id,
        openingAmount: summaryBefore.openingAmount,
        cashSalesTotal: summaryBefore.cashSalesTotal,
        cashInTotal: summaryBefore.cashInTotal,
        cashOutTotal: summaryBefore.cashOutTotal,
        expectedCash: summaryBefore.expectedCash,
      });

      // The session's own status must remain completely untouched.
      const reread = await cash.session(companyId, branchIds, session.id);
      expect(reread.status).toBe('open');

      // A second partial close can be taken later on the same
      // still-open session — never blocked by the first.
      const laterContext = { ...context, timestamp: new Date(context.timestamp.getTime() + 3_600_000) };
      const second = await cash.partialClose(laterContext, branchIds, 'partial-basic-close-2', session.id);
      expect(second.value.id).not.toBe(partial.value.id);
      const rereadAfterSecond = await cash.session(companyId, branchIds, session.id);
      expect(rereadAfterSecond.status).toBe('open');
    });

    it('lists partial-close history for a session in chronological order', async () => {
      const { session } = await openRegisterAndSession('partial-history', '0');
      const firstContext = { ...context, timestamp: new Date('2026-09-07T10:00:00.000Z') };
      const secondContext = { ...context, timestamp: new Date('2026-09-07T11:00:00.000Z') };
      const thirdContext = { ...context, timestamp: new Date('2026-09-07T12:00:00.000Z') };
      const first = await cash.partialClose(firstContext, branchIds, 'partial-history-1', session.id);
      const second = await cash.partialClose(secondContext, branchIds, 'partial-history-2', session.id);
      const third = await cash.partialClose(thirdContext, branchIds, 'partial-history-3', session.id);
      const history = await cash.partialCloses(companyId, branchIds, session.id);
      expect(history.map((item) => item.id)).toEqual([first.value.id, second.value.id, third.value.id]);
    });

    it('replays a duplicate partial-close request (same idempotency key) as a safe no-op — never two rows', async () => {
      const { session } = await openRegisterAndSession('partial-replay', '0');
      const first = await cash.partialClose(context, branchIds, 'partial-replay-1', session.id);
      expect(first.replayed).toBe(false);
      const replay = await cash.partialClose(context, branchIds, 'partial-replay-1', session.id);
      expect(replay.replayed).toBe(true);
      expect(replay.value.id).toBe(first.value.id);
      const count = await database.pool.query<{ count: string }>(
        `select count(*)::text as count from cash_session_partial_closes where company_id=$1 and cash_session_id=$2`,
        [companyId, session.id],
      );
      expect(count.rows[0]?.count).toBe('1');
    });

    it('rejects a partial-close attempt against a session that is not open', async () => {
      const { session } = await openRegisterAndSession('partial-closed', '0');
      await cash.closeSession(context, branchIds, 'partial-closed-close-1', session.id, {
        declaredClosingAmount: '0',
      });
      await expect(cash.partialClose(context, branchIds, 'partial-closed-partial-1', session.id)).rejects.toMatchObject({
        code: 'cash_session_not_open',
      });
    });

    it('is a genuine CashError subclass for a partial-close rejection', async () => {
      await expect(cash.partialClose(context, branchIds, 'partial-notfound-1', randomUUID())).rejects.toBeInstanceOf(
        CashError,
      );
    });

    // --- Tenant/branch isolation -----------------------------------------

    it('rejects a partial-close for an unauthorized branch, and tenant/branch-isolates history', async () => {
      const { session } = await openRegisterAndSession('partial-iso', '0');
      const created = await cash.partialClose(context, branchIds, 'partial-iso-close-1', session.id);
      await expect(
        cash.partialClose(context, [otherBranchId] /* branchId deliberately excluded */, 'partial-iso-close-2', session.id),
      ).rejects.toMatchObject({ code: 'resource_not_found' });
      await expect(cash.partialCloses(companyId, [otherBranchId], session.id)).rejects.toMatchObject({
        code: 'resource_not_found',
      });
      await expect(cash.partialCloses(otherCompanyId, [otherCompanyBranchId], session.id)).rejects.toMatchObject({
        code: 'resource_not_found',
      });
      // Sanity: the authorized read still finds exactly the one snapshot.
      const history = await cash.partialCloses(companyId, branchIds, session.id);
      expect(history.map((item) => item.id)).toEqual([created.value.id]);
    });
  });
});
