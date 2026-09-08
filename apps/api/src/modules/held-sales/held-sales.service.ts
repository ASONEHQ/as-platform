import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

import type { HeldSaleCartsRepository } from './held-sales.repository.js';
import {
  HeldSaleCartError,
  type HeldSaleCartItem,
  type HeldSaleCartMutationContext,
  type HeldSaleCartRow,
  type HeldSaleCartStatus,
} from './held-sales.types.js';

/** Optional cross-module read — used ONLY by `linkSale` to confirm the
 * `sale_id` the client supplies genuinely exists in this same company
 * before recording the link, exactly the same defense-in-depth
 * `SalesService`/`PaymentService` already apply to every other
 * cross-module id (never trust a bare id from the request body). Kept as
 * a minimal structural interface (not an import of the concrete
 * `SalesRepository` class) so this module never depends on the sales
 * module's own internals — mirrors this codebase's established
 * "structurally identical transaction interface" convention rather than
 * a concrete cross-module dependency. */
export interface SaleExistenceLookup {
  sale(companyId: string, id: string): Promise<{ id: string } | null>;
}

function hash(value: object): string {
  return createHash('sha256')
    .update(JSON.stringify(Object.fromEntries(Object.entries(value).sort())))
    .digest('hex');
}
function nonBlank(value: string, field: string): string {
  const clean = value.trim();
  if (clean.length === 0) throw new HeldSaleCartError('validation_error', `${field} cannot be blank.`);
  if (clean.length > 200) throw new HeldSaleCartError('validation_error', `${field} is too long.`);
  return clean;
}
const QUANTITY_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/u;
function quantity(value: string, field: string): string {
  if (!QUANTITY_PATTERN.test(value)) throw new HeldSaleCartError('validation_error', `${field} is invalid.`);
  if (Number(value) <= 0) throw new HeldSaleCartError('validation_error', `${field} must be greater than zero.`);
  return value;
}
function productId(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new HeldSaleCartError('validation_error', `${field} is required.`);
  return value;
}

function cartPayload(value: HeldSaleCartRow): Readonly<Record<string, unknown>> {
  return {
    held_sale_cart_id: value.id,
    branch_id: value.branchId,
    status: value.status,
    item_count: value.items.length,
  };
}

export class HeldSaleCartsService {
  public constructor(
    private readonly repository: HeldSaleCartsRepository,
    private readonly salesLookup?: SaleExistenceLookup,
  ) {}

  /**
   * Suspends an in-progress cart: a JSON snapshot of
   * `{product_id, quantity}` pairs ONLY (no price/tax — see
   * `held-sales.types.ts`'s own doc comment and ADR-0009). Deliberately
   * does not validate the products themselves exist/are active here —
   * that re-validation genuinely only matters at `resumeCart` ->
   * `POST /sales` time (a product could be discontinued between
   * suspend and resume; re-pricing fresh through the real catalog is the
   * whole point, see the schema's own doc comment), so this create step
   * stays cheap and never duplicates that check.
   */
  public async createCart(
    context: HeldSaleCartMutationContext,
    branchIds: readonly string[],
    key: string,
    input: {
      id?: string;
      branchId: string;
      cashRegisterId?: string;
      customerId?: string;
      label?: string;
      items: readonly { productId: string; quantity: string }[];
    },
  ): Promise<{ value: HeldSaleCartRow; replayed: boolean }> {
    if (!branchIds.includes(input.branchId))
      throw new HeldSaleCartError('validation_error', 'The branch is not authorized for this actor.');
    if (input.items.length === 0)
      throw new HeldSaleCartError('validation_error', 'A held cart must have at least one item.');
    if (input.items.length > 200) throw new HeldSaleCartError('validation_error', 'Too many items.');
    const items: HeldSaleCartItem[] = input.items.map((item, index) => ({
      productId: productId(item.productId, `items[${String(index)}].product_id`),
      quantity: quantity(item.quantity, `items[${String(index)}].quantity`),
    }));
    const normalized = {
      id: input.id ?? randomUUID(),
      branchId: input.branchId,
      cashRegisterId: input.cashRegisterId ?? null,
      customerId: input.customerId ?? null,
      label: input.label === undefined ? null : nonBlank(input.label, 'label'),
      items,
    };
    const requestHash = hash({
      branchId: normalized.branchId,
      cashRegisterId: normalized.cashRegisterId,
      customerId: normalized.customerId,
      label: normalized.label,
      items: normalized.items,
      id: input.id ?? null,
    });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'held_sale_cart.create',
        key,
        requestHash,
        'held_sale_cart',
        decodeCart,
        async () => {
          const created = await this.repository.insertCart(client, {
            id: normalized.id,
            companyId: context.companyId,
            branchId: normalized.branchId,
            cashRegisterId: normalized.cashRegisterId,
            customerId: normalized.customerId,
            label: normalized.label,
            items: normalized.items,
            createdBy: context.actorId,
            timestamp: context.timestamp,
          });
          await this.repository.auditAndPublish(client, context, {
            action: 'held_sale_cart.held',
            resourceId: created.id,
            eventType: 'held_sale_cart.held',
            branchId: created.branchId,
            generation: 1n,
            payload: cartPayload(created),
          });
          return created;
        },
      ),
    );
  }

  public async cart(companyId: string, branchIds: readonly string[], id: string): Promise<HeldSaleCartRow> {
    const value = await this.repository.cart(companyId, id);
    if (value === null || !branchIds.includes(value.branchId))
      throw new HeldSaleCartError('resource_not_found', 'The held sale cart was not found.');
    return value;
  }

  public listCarts(
    companyId: string,
    branchIds: readonly string[],
    input: {
      limit: number;
      cursor?: string;
      branchId?: string;
      status?: HeldSaleCartStatus;
      cashRegisterId?: string;
    },
  ): ReturnType<HeldSaleCartsRepository['listCarts']> {
    // "What's currently paused" is the default, common view (Part B.1's
    // own explicit instruction) — an explicit `status` filter (including
    // `'resumed'`/`'discarded'`, e.g. an audit screen) always wins.
    return this.repository.listCarts(companyId, branchIds, {
      ...input,
      status: input.status ?? 'held',
    });
  }

  /**
   * The real recovery action — first half of the two-step handshake.
   * Returns the cart's held `items` as-is for the client to feed
   * straight into its normal `POST /sales` flow — this method never
   * itself creates a Sale (see this class's own top doc comment and
   * ADR-0009).
   *
   * TASK 14.3A (Wave 1 hardening): this CLAIMS the cart —
   * `held -> resuming` — rather than marking it terminally `resumed`.
   * Resuming and actually completing the sale are genuinely two separate
   * HTTP round-trips from the client's perspective: this call cannot
   * know the eventual sale's id yet (the client hasn't even called
   * `POST /sales` when this returns), and a claimed cart the cashier
   * then decides to abandon (no sale ever created from it) is a
   * legitimate, real outcome — handled by `releaseCart`/`discardCart`
   * below, never by lying about a sale that doesn't exist. A held cart
   * can only ever be claimed by ONE caller (see
   * `HeldSaleCartsRepository.claimCart`'s own CAS `WHERE status='held'`
   * clause) — a losing concurrent claim attempt gets a clean, immediate
   * `invalid_cart_state` (409), never a duplicate claim and never a
   * partial/inconsistent state. `resumedSaleId` on the returned value is
   * genuinely `null` here — no sale exists yet, and this is not a
   * sentinel, it's the real column value (TASK 14.3A removed the earlier
   * self-referential-sentinel design entirely — see
   * `held-sales.repository.ts`'s own doc comment for the history).
   */
  public async resumeCart(
    context: HeldSaleCartMutationContext,
    branchIds: readonly string[],
    id: string,
    key: string,
  ): Promise<{ value: HeldSaleCartRow; replayed: boolean }> {
    const requestHash = hash({ id });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'held_sale_cart.resume',
        key,
        requestHash,
        'held_sale_cart',
        decodeCart,
        async () => {
          const current = await this.repository.lockCart(client, context.companyId, id);
          if (current === null || !branchIds.includes(current.branchId))
            throw new HeldSaleCartError('resource_not_found', 'The held sale cart was not found.');
          if (current.status !== 'held')
            throw new HeldSaleCartError(
              'invalid_cart_state',
              'This cart is not available to resume — it was already claimed, resumed, or discarded.',
            );
          const updated = await this.repository.claimCart(client, context.companyId, id, {
            claimedAt: context.timestamp,
            claimedBy: context.actorId,
          });
          if (updated === null)
            throw new HeldSaleCartError(
              'invalid_cart_state',
              'This cart is not available to resume — it was already claimed, resumed, or discarded.',
            );
          await this.repository.auditAndPublish(client, context, {
            action: 'held_sale_cart.claimed',
            resourceId: updated.id,
            eventType: 'held_sale_cart.claimed',
            branchId: updated.branchId,
            generation: 2n,
            payload: cartPayload(updated),
          });
          return updated;
        },
      ),
    );
  }

  /** Second, optional call — see `resumeCart`'s own doc comment for the
   * full two-step handshake this completes. `resuming -> resumed`: the
   * real, terminal transition, only ever reachable once a real sale
   * genuinely exists (verified via `salesLookup` before this is ever
   * written). Rejects cleanly if the cart isn't `'resuming'` (never
   * claimed, already resumed, already discarded, or released back to
   * `held`) — calling this twice, or concurrently, is deterministically
   * rejected by `HeldSaleCartsRepository.linkSale`'s own CAS
   * `WHERE status='resuming'` clause (the second caller simply finds no
   * matching row). */
  public async linkSale(
    context: HeldSaleCartMutationContext,
    branchIds: readonly string[],
    id: string,
    key: string,
    saleId: string,
  ): Promise<{ value: HeldSaleCartRow; replayed: boolean }> {
    const cleanSaleId = nonBlank(saleId, 'sale_id');
    const requestHash = hash({ id, saleId: cleanSaleId });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'held_sale_cart.link_sale',
        key,
        requestHash,
        'held_sale_cart',
        decodeCart,
        async () => {
          const current = await this.repository.lockCart(client, context.companyId, id);
          if (current === null || !branchIds.includes(current.branchId))
            throw new HeldSaleCartError('resource_not_found', 'The held sale cart was not found.');
          if (current.status !== 'resuming')
            throw new HeldSaleCartError(
              'invalid_cart_state',
              'Only a claimed (resuming) cart can be linked to a sale.',
            );
          if (this.salesLookup !== undefined) {
            const sale = await this.salesLookup.sale(context.companyId, cleanSaleId);
            if (sale === null) throw new HeldSaleCartError('validation_error', 'The sale was not found.');
          }
          const updated = await this.repository.linkSale(client, context.companyId, id, cleanSaleId, {
            resumedAt: context.timestamp,
            resumedBy: context.actorId,
          });
          if (updated === null)
            throw new HeldSaleCartError(
              'invalid_cart_state',
              'Only a claimed (resuming) cart can be linked to a sale.',
            );
          await this.repository.auditAndPublish(client, context, {
            action: 'held_sale_cart.resumed',
            resourceId: updated.id,
            eventType: 'held_sale_cart.resumed',
            branchId: updated.branchId,
            generation: 3n,
            payload: { ...cartPayload(updated), sale_id: cleanSaleId },
          });
          return updated;
        },
      ),
    );
  }

  /**
   * TASK 14.3A (Wave 1 hardening) — the explicit, audited recovery rule
   * for an abandoned claim: `resuming -> held`, making the cart
   * available to be claimed again. No automatic/background expiry
   * exists (this task's own instruction: "do not over-engineer this
   * into a distributed workflow system") — recovery is always a real,
   * permission-gated, human action, exactly like `discardCart` below.
   * Same permission rule: the actor who claimed it, or an actor with
   * `sale.cancel`.
   */
  public async releaseCart(
    context: HeldSaleCartMutationContext,
    branchIds: readonly string[],
    id: string,
    key: string,
  ): Promise<{ value: HeldSaleCartRow; replayed: boolean }> {
    const requestHash = hash({ id, op: 'release' });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'held_sale_cart.release',
        key,
        requestHash,
        'held_sale_cart',
        decodeCart,
        async () => {
          const current = await this.repository.lockCart(client, context.companyId, id);
          if (current === null || !branchIds.includes(current.branchId))
            throw new HeldSaleCartError('resource_not_found', 'The held sale cart was not found.');
          if (current.status !== 'resuming')
            throw new HeldSaleCartError('invalid_cart_state', 'Only a claimed (resuming) cart can be released.');
          if (current.claimedBy !== context.actorId && !(context.actorPermissions ?? []).includes('sale.cancel'))
            throw new HeldSaleCartError(
              'forbidden',
              "Only the cart's own claimant or an actor with sale.cancel may release it.",
            );
          const updated = await this.repository.releaseCart(client, context.companyId, id);
          if (updated === null)
            throw new HeldSaleCartError('invalid_cart_state', 'Only a claimed (resuming) cart can be released.');
          await this.repository.auditAndPublish(client, context, {
            action: 'held_sale_cart.released',
            resourceId: updated.id,
            eventType: 'held_sale_cart.released',
            branchId: updated.branchId,
            generation: 2n,
            payload: cartPayload(updated),
          });
          return updated;
        },
      ),
    );
  }

  /** Permission: the cart's own creator, OR (if it's currently claimed)
   * the actor who claimed it, OR an actor who additionally holds
   * `sale.cancel` — mirroring `sales.routes.ts`'s own
   * `POST /sales/:id/cancellations` gating shape (discarding someone
   * else's held cart is treated as the same class of action as
   * cancelling someone else's sale). Discardable from `held` OR
   * `resuming` (TASK 14.3A) — a manager cleaning up a stuck claim can
   * discard it directly, without a separate release round-trip first. */
  public async discardCart(
    context: HeldSaleCartMutationContext,
    branchIds: readonly string[],
    id: string,
    key: string,
    reasonCode: string | undefined,
  ): Promise<{ value: HeldSaleCartRow; replayed: boolean }> {
    const cleanReason = reasonCode === undefined ? null : nonBlank(reasonCode, 'reason');
    const requestHash = hash({ id, reasonCode: cleanReason });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'held_sale_cart.discard',
        key,
        requestHash,
        'held_sale_cart',
        decodeCart,
        async () => {
          const current = await this.repository.lockCart(client, context.companyId, id);
          if (current === null || !branchIds.includes(current.branchId))
            throw new HeldSaleCartError('resource_not_found', 'The held sale cart was not found.');
          if (current.status !== 'held' && current.status !== 'resuming')
            throw new HeldSaleCartError(
              'invalid_cart_state',
              'This cart can no longer be discarded — it was already resumed or discarded.',
            );
          const isOwnCart = current.createdBy === context.actorId;
          const isOwnClaim = current.status === 'resuming' && current.claimedBy === context.actorId;
          if (!isOwnCart && !isOwnClaim && !(context.actorPermissions ?? []).includes('sale.cancel'))
            throw new HeldSaleCartError(
              'forbidden',
              "Only the cart's own creator, its current claimant, or an actor with sale.cancel may discard it.",
            );
          const updated = await this.repository.markDiscarded(client, context.companyId, id, {
            discardedAt: context.timestamp,
            discardedBy: context.actorId,
          });
          if (updated === null)
            throw new HeldSaleCartError(
              'invalid_cart_state',
              'This cart can no longer be discarded — it was already resumed or discarded.',
            );
          await this.repository.auditAndPublish(client, context, {
            action: 'held_sale_cart.discarded',
            resourceId: updated.id,
            eventType: 'held_sale_cart.discarded',
            branchId: updated.branchId,
            generation: 2n,
            payload: { ...cartPayload(updated), reason_code: cleanReason },
          });
          return updated;
        },
      ),
    );
  }
}

function decodeCart(raw: unknown): HeldSaleCartRow {
  const value = raw as Omit<HeldSaleCartRow, 'createdAt' | 'resumedAt' | 'discardedAt'> & {
    createdAt: string;
    resumedAt: string | null;
    discardedAt: string | null;
  };
  return {
    ...value,
    createdAt: new Date(value.createdAt),
    resumedAt: value.resumedAt === null ? null : new Date(value.resumedAt),
    discardedAt: value.discardedAt === null ? null : new Date(value.discardedAt),
  };
}
