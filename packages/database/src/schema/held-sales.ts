import { sql } from 'drizzle-orm';
import { check, foreignKey, index, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { cashRegisters } from './cash.js';
import { companyIdColumn, createdAtColumn, idColumn } from './common.js';
import { customers } from './customers.js';
import { companyMemberships } from './identity.js';
import { branches, companies } from './organizations.js';

/**
 * TASK 14.3 (Wave 1, Part B.1) — "suspended sales," recovered from
 * `docs/LEGACY_FUNCTIONAL_PARITY.md`'s Ventas section. Deliberately
 * modeled as a held, unpriced CART SNAPSHOT — never a partially-built
 * `sales`/`sale_items` row — because the legacy behavior it recovers is
 * "pause the cart before checkout, resume it later, keep editing," and
 * the current platform's `sales` domain treats a sale's items as fixed
 * at creation time (see ADR-0009). Recovering the legacy behavior
 * therefore means holding the pre-submission cart, not touching the
 * already-proven, heavily-tested Sale state machine at all.
 *
 * `items` is a JSON snapshot of `{product_id, quantity}` pairs ONLY —
 * never a price/tax/discount snapshot. Resuming a held cart always
 * re-prices every line fresh through the real catalog/promotions engine
 * at `POST /sales` time, exactly like building a new ticket — so a
 * price change between suspend and resume is reflected correctly,
 * never a stale, silently-wrong total (unlike copying the legacy's own
 * behavior of freezing a total at suspend time, which this deliberately
 * does not do).
 *
 * TASK 14.3A (Wave 1 hardening) — the state machine is a real 4-state
 * machine, `held -> resuming -> resumed`, plus `discarded` (reachable
 * from `held` or `resuming`) and `resuming -> held` (an explicit,
 * audited release — see `PART B.1`'s own recovery rule below). This
 * replaces an earlier TASK 14.3 design that stored a held cart's own id
 * as a self-referential sentinel in `resumed_sale_id` to satisfy a
 * too-strict constraint while the two-step resume/link-sale handshake
 * was in flight — that sentinel is gone; every column now holds only
 * real, honest values:
 *   - `held`: available to be claimed. `claimed_at`/`claimed_by`/
 *     `resumed_at`/`resumed_by`/`resumed_sale_id` may hold a STALE trace
 *     of a past claim/release cycle (kept as history, see below) but
 *     never describe the current state — only `status` does.
 *   - `resuming`: claimed by `claimed_by` at `claimed_at` — an actor has
 *     committed to building a real sale from these items but hasn't
 *     finished yet. `resumed_sale_id` is genuinely NULL here — no sale
 *     exists yet, and the database says so honestly.
 *   - `resumed`: terminal, real. `resumed_at`/`resumed_by`/
 *     `resumed_sale_id` are ALL set, atomically, in the exact same
 *     transaction that verified the referenced sale is real (see
 *     `HeldSaleCartsService.linkSale`). `resumed_sale_id` is never a
 *     placeholder of any kind.
 *   - `discarded`: terminal, never resumable again.
 * `claimed_at`/`claimed_by` are a historical trace, not a "current
 * claim" pointer — they are set once a cart is first claimed and are
 * NEVER cleared by a release (an intentional design choice: "this cart
 * was claimed by X, then released" is a real fact worth keeping in the
 * row for audit, and the release's own `audit_log` entry already
 * carries the authoritative timeline) — only `status` decides whether a
 * claim is currently in effect.
 */
export const heldSaleCartStatuses = ['held', 'resuming', 'resumed', 'discarded'] as const;

export const heldSaleCarts = pgTable(
  'held_sale_carts',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').notNull(),
    cashRegisterId: uuid('cash_register_id'),
    customerId: uuid('customer_id'),
    label: text('label'),
    items: jsonb('items').notNull().$type<readonly { productId: string; quantity: string }[]>(),
    status: text('status').notNull().default('held'),
    createdBy: uuid('created_by').notNull(),
    // TASK 14.3A: set once, at `held -> resuming` — the historical trace
    // of the most recent claim attempt (see this table's own top doc
    // comment for why these are never cleared by a release).
    claimedAt: timestamp('claimed_at', { withTimezone: true, mode: 'date' }),
    claimedBy: uuid('claimed_by'),
    // Set ONLY at the real, terminal `resuming -> resumed` transition,
    // all three together, always a real sale id — never a placeholder.
    resumedAt: timestamp('resumed_at', { withTimezone: true, mode: 'date' }),
    resumedBy: uuid('resumed_by'),
    resumedSaleId: uuid('resumed_sale_id'),
    discardedAt: timestamp('discarded_at', { withTimezone: true, mode: 'date' }),
    discardedBy: uuid('discarded_by'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    unique('held_sale_carts_company_id_id_uq').on(table.companyId, table.id),
    foreignKey({
      columns: [table.companyId, table.branchId],
      foreignColumns: [branches.companyId, branches.id],
      name: 'held_sale_carts_branch_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.branchId, table.cashRegisterId],
      foreignColumns: [cashRegisters.companyId, cashRegisters.branchId, cashRegisters.id],
      name: 'held_sale_carts_register_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.customerId],
      foreignColumns: [customers.companyId, customers.id],
      name: 'held_sale_carts_customer_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.createdBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'held_sale_carts_created_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.claimedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'held_sale_carts_claimed_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.resumedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'held_sale_carts_resumed_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.discardedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'held_sale_carts_discarded_by_membership_fk',
    }).onDelete('restrict'),
    index('held_sale_carts_company_branch_status_idx').on(table.companyId, table.branchId, table.status),
    check(
      'held_sale_carts_status_ck',
      sql`${table.status} in ('held', 'resuming', 'resumed', 'discarded')`,
    ),
    check('held_sale_carts_items_array_ck', sql`jsonb_typeof(${table.items}) = 'array'`),
    check('held_sale_carts_items_nonempty_ck', sql`jsonb_array_length(${table.items}) > 0`),
    // One-directional: a cart currently `resuming` or `resumed` MUST
    // carry a real claim trace — but the trace is deliberately allowed
    // to survive a later release back to `held` (see the table's own
    // top doc comment), so this is never a two-way `=` like the others.
    check(
      'held_sale_carts_claimed_fields_ck',
      sql`${table.status} not in ('resuming', 'resumed') or (${table.claimedAt} is not null and ${table.claimedBy} is not null)`,
    ),
    // Strict two-way pairing: `resumed` is terminal and real — every one
    // of these three is set together, exactly once, with a genuine sale
    // id, never a sentinel of any kind, never partially populated.
    check(
      'held_sale_carts_resumed_fields_ck',
      sql`(${table.status} = 'resumed') = (${table.resumedAt} is not null and ${table.resumedBy} is not null and ${table.resumedSaleId} is not null)`,
    ),
    check(
      'held_sale_carts_discarded_fields_ck',
      sql`(${table.status} = 'discarded') = (${table.discardedAt} is not null and ${table.discardedBy} is not null)`,
    ),
  ],
);

export type HeldSaleCart = typeof heldSaleCarts.$inferSelect;
export type NewHeldSaleCart = typeof heldSaleCarts.$inferInsert;
