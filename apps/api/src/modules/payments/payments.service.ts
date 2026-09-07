import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

import { normalizeCurrencyCode, normalizeMoneyAmount } from '@asone/database';

import type { CashRepository } from '../cash/cash.repository.js';
import { CashError, type CashSessionRow } from '../cash/cash.types.js';
import type { LoyaltyService } from '../loyalty/loyalty.service.js';
import type { MembershipsService } from '../memberships/memberships.service.js';
import type { RewardsService } from '../rewards/rewards.service.js';
import type { SalesRepository } from '../sales/sales.repository.js';
import type { SaleRow } from '../sales/sales.types.js';
import type { PaymentRepository, PaymentTransaction } from './payments.repository.js';
import { PaymentProviderError, type PaymentProvider } from './providers/payment-provider.js';
import {
  PaymentError,
  paymentAttemptStatuses,
  paymentMethods,
  terminalAttemptStatuses,
  type AttemptTransitionInput,
  type CreateCashPaymentInput,
  type CreatePaymentInput,
  type CreateTerminalInput,
  type PaymentAttemptRow,
  type PaymentMutationContext,
  type PaymentRow,
  type PaymentTerminalRow,
} from './payments.types.js';

function hash(value: object): string {
  return createHash('sha256')
    .update(JSON.stringify(Object.fromEntries(Object.entries(value).sort())))
    .digest('hex');
}
function amount(value: string): string {
  let normalized: string;
  try {
    normalized = normalizeMoneyAmount(value);
  } catch (error) {
    throw new PaymentError(
      'validation_error',
      error instanceof Error ? error.message : 'Invalid amount.',
    );
  }
  // ADR-0001's decimal-string format alone allows an honest "0.0000" (a
  // legitimately free catalog price, see TASK 12.3C) — but a *payment*
  // moving zero currency is never meaningful, so this is a payments-only
  // rule enforced here rather than widening the shared money normalizer.
  if (/^0(\.0{1,4})?$/u.test(normalized))
    throw new PaymentError('validation_error', 'amount must be greater than zero.');
  return normalized;
}
function currency(value: string): string {
  try {
    return normalizeCurrencyCode(value.trim().toUpperCase());
  } catch (error) {
    throw new PaymentError(
      'validation_error',
      error instanceof Error ? error.message : 'Invalid currency code.',
    );
  }
}
function nonBlank(value: string, field: string): string {
  const clean = value.trim();
  if (clean.length === 0) throw new PaymentError('validation_error', `${field} cannot be blank.`);
  if (clean.length > 200)
    throw new PaymentError('validation_error', `${field} is too long.`);
  return clean;
}

// --- Exact decimal arithmetic (ADR-0001: never a JS `number` for money) —
// TASK 12.5A: cash amount-due/change computation needs to *subtract* two
// money values, something no payments-module code has needed before now
// (every prior path here only ever stored/compared a pre-computed decimal
// string). Mirrors `sales.service.ts`'s own independent copy of this exact
// `BigInt`-at-scale algorithm verbatim (same established convention: this
// small helper is deliberately re-implemented per module, not shared —
// see that file's own comment) rather than introducing a new cross-module
// dependency for two functions.
const MONEY_SCALE = 10_000n; // numeric(19,4)

function moneyUnits(value: string): bigint {
  const [whole = '', fraction = ''] = value.split('.');
  const wholeDigits = whole.length === 0 ? '0' : whole;
  const fractionDigits = fraction.padEnd(4, '0').slice(0, 4);
  return BigInt(wholeDigits) * MONEY_SCALE + BigInt(fractionDigits.length === 0 ? '0' : fractionDigits);
}
function formatMoney(units: bigint): string {
  const negative = units < 0n;
  const magnitude = negative ? -units : units;
  const whole = magnitude / MONEY_SCALE;
  const fraction = (magnitude % MONEY_SCALE).toString().padStart(4, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fraction}`;
}

/** Attempt transitions allowed from each non-terminal status — the actual
 * enforcement of "approved cannot go back to processing" etc. Any status
 * in `terminalAttemptStatuses` accepts no further transition at all (a
 * retry requires a brand new attempt row, never mutating this one).
 *
 * `created` may jump directly to any outcome: a cash attempt has no
 * physical terminal round-trip to report, so it goes `created → approved`
 * in one step, while a card_terminal attempt is expected to report
 * `awaiting_terminal`/`processing` first — but the machine does not
 * *require* those intermediate reports, since not every provider surfaces
 * them. What it does forbid is ever moving backwards
 * (`processing → awaiting_terminal`, or anything once terminal). */
const allowedAttemptTransitions: Readonly<Record<string, readonly string[]>> = {
  created: [
    'awaiting_terminal',
    'processing',
    'approved',
    'declined',
    'cancelled',
    'timed_out',
    'failed',
  ],
  awaiting_terminal: ['processing', 'approved', 'declined', 'cancelled', 'timed_out', 'failed'],
  processing: ['approved', 'declined', 'cancelled', 'timed_out', 'failed'],
};

export class PaymentService {
  public constructor(
    private readonly repository: PaymentRepository,
    // TASK 12.4A.1: payments now own a real `sale_id` — this is the
    // minimum cross-module dependency needed to (a) validate a payment's
    // sale before creating it and (b) settle a sale when its payments
    // cover its total (see `createPayment`/`transitionAttempt` below and
    // ADR-0009). `SalesRepository`'s transaction client is structurally
    // identical to `PaymentRepository`'s own, so both calls below run
    // inside this service's own transaction — never a second one.
    private readonly salesRepository: SalesRepository,
    // TASK 12.4B.1: always a real `MercadoPagoPointProvider` instance,
    // even with no Access Token configured — see providers/mercado-pago.client.ts.
    // Its calls fail cleanly and lazily (`PaymentProviderError('not_configured', ...)`)
    // only when a `card_terminal` dispatch is actually attempted, never
    // at boot — "fail safely if configuration is missing" per the task.
    private readonly mercadoPagoProvider: PaymentProvider,
    // TASK 12.7 Part E: `createCashPayment` now requires an open cash
    // session and posts that payment's drawer movement — the same
    // cross-module composition shape `salesRepository` above already
    // established (a sibling module's *repository*, its transaction
    // client structurally identical to this module's own, never a second
    // transaction). See ADR-0014.
    private readonly cashRepository: CashRepository,
    // TASK 13.0 — optional, backward-compatible (same reasoning as
    // `SalesService`'s own `promotionsRepository`/`customersRepository`):
    // only exercised at the exact moment a Sale newly settles (see
    // `applyPostSettlementHooks` below); every pre-existing test/caller
    // that constructs `PaymentService` without these two keeps compiling
    // and behaving identically — no membership/loyalty activation, same
    // as a deployment that never configured the modules at all.
    private readonly membershipsService?: MembershipsService,
    private readonly loyaltyService?: LoyaltyService,
    // TASK 13.1 — same optional/backward-compatible reasoning as the two
    // above. Evaluated AFTER `loyaltyService.earnFromSale` in the same
    // transaction (ADR-0018 "Issuance transaction boundary") — it reads
    // the ledger's own just-updated cumulative total, never a stale
    // pre-earn snapshot.
    private readonly rewardsService?: RewardsService,
  ) {}

  /** Called ONLY at the exact moment `SalesRepository.trySettleSale`
   * returns `settled: true` — i.e. the one instant a Sale genuinely,
   * newly transitions to `completed` (see that method's own doc comment;
   * a replay/retry never reaches this a second time). Same transaction
   * `client` as the settlement itself — see ADR-0017 "Activation
   * boundary"/"Automatic earning": a failure here rolls back the whole
   * settlement, exactly like TASK 12.6's inventory-consumption posting
   * already does at this identical call site. */
  private async applyPostSettlementHooks(
    client: PaymentTransaction,
    context: PaymentMutationContext,
    settledSale: SaleRow,
  ): Promise<void> {
    if (this.membershipsService === undefined && this.loyaltyService === undefined && this.rewardsService === undefined) return;
    const items = await this.salesRepository.saleItems(context.companyId, settledSale.id);
    const productIds = [...new Set(items.map((item) => item.productId).filter((id): id is string => id !== null))];
    if (this.membershipsService !== undefined) {
      await this.membershipsService.activateFromSale(client, {
        companyId: context.companyId,
        branchId: settledSale.branchId,
        saleId: settledSale.id,
        customerId: settledSale.customerId,
        actorId: context.actorId,
        correlationId: context.correlationId,
        timestamp: context.timestamp,
        productIds,
      });
    }
    if (this.loyaltyService !== undefined) {
      await this.loyaltyService.earnFromSale(client, {
        companyId: context.companyId,
        branchId: settledSale.branchId,
        saleId: settledSale.id,
        customerId: settledSale.customerId,
        saleTotal: settledSale.total,
        actorId: context.actorId,
        correlationId: context.correlationId,
        timestamp: context.timestamp,
      });
    }
    if (this.rewardsService !== undefined) {
      await this.rewardsService.evaluateAutomaticIssuance(client, {
        companyId: context.companyId,
        branchId: settledSale.branchId,
        saleId: settledSale.id,
        customerId: settledSale.customerId,
        actorId: context.actorId,
        correlationId: context.correlationId,
        timestamp: context.timestamp,
      });
    }
  }

  // --- Terminals -------------------------------------------------------

  // `async` here (and on every sibling method below that normalizes input
  // before opening a transaction) is load-bearing, not decorative: it
  // ensures a synchronous `throw` from validation — e.g. a malformed
  // amount — becomes a rejected Promise like every other failure path,
  // instead of throwing out of the call synchronously and defeating
  // `await`/`.rejects` at the call site.
  public async createTerminal(
    context: PaymentMutationContext,
    key: string,
    input: CreateTerminalInput,
  ): Promise<{ value: PaymentTerminalRow; replayed: boolean }> {
    const normalized = {
      id: input.id ?? randomUUID(),
      branchId: input.branchId,
      deviceId: input.deviceId,
      provider: input.provider === undefined ? 'unassigned' : nonBlank(input.provider, 'provider'),
      providerTerminalId:
        input.providerTerminalId === undefined
          ? null
          : nonBlank(input.providerTerminalId, 'provider_terminal_id'),
      capabilities: input.capabilities ?? null,
    };
    const requestHash = hash({ ...normalized, id: input.id ?? null });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'payment_terminal.register',
        key,
        requestHash,
        'payment_terminal',
        decodeTerminal,
        async () => {
          await this.repository.validateDevice(
            client,
            context.companyId,
            normalized.branchId,
            normalized.deviceId,
          );
          const created = await this.repository.insertTerminal(client, {
            ...context,
            ...normalized,
          });
          await this.repository.auditAndPublish(client, context, {
            action: 'payment_terminal.registered',
            resourceType: 'payment_terminal',
            resourceId: created.id,
            eventType: 'payment_terminal.registered',
            version: created.version,
            payload: {
              payment_terminal_id: created.id,
              branch_id: created.branchId,
              device_id: created.deviceId,
              provider: created.provider,
              status: created.status,
            },
          });
          return created;
        },
      ),
    );
  }

  public async terminal(companyId: string, id: string): Promise<PaymentTerminalRow> {
    const value = await this.repository.terminal(companyId, id);
    if (value === null)
      throw new PaymentError('resource_not_found', 'The payment terminal was not found.');
    return value;
  }

  public listTerminals(
    companyId: string,
    branchIds: readonly string[],
    input: Parameters<PaymentRepository['listTerminals']>[2],
  ): ReturnType<PaymentRepository['listTerminals']> {
    return this.repository.listTerminals(companyId, branchIds, input);
  }

  // --- Payments ----------------------------------------------------------

  /**
   * Creates a payment (canonical `pending` per §21.3) and its first
   * attempt (`created`) atomically. This is the "PaymentIntent" creation
   * step: it never approves anything itself — a real terminal result must
   * arrive through `transitionAttempt` before the payment can leave
   * `pending`.
   */
  public async createPayment(
    context: PaymentMutationContext,
    branchIds: readonly string[],
    key: string,
    input: CreatePaymentInput,
  ): Promise<{ value: { payment: PaymentRow; attempt: PaymentAttemptRow }; replayed: boolean }> {
    if (!paymentMethods.includes(input.paymentMethod))
      throw new PaymentError('validation_error', 'payment_method is not recognized.');
    if (!branchIds.includes(input.branchId))
      throw new PaymentError('validation_error', 'The branch is not authorized for this actor.');
    if (typeof input.saleId !== 'string' || input.saleId.length === 0)
      throw new PaymentError('validation_error', 'sale_id is required.');
    const normalized = {
      id: input.id ?? randomUUID(),
      branchId: input.branchId,
      saleId: input.saleId,
      paymentMethod: input.paymentMethod,
      amount: amount(input.amount),
      currencyCode: currency(input.currencyCode),
      terminalId: input.terminalId ?? null,
      metadata: input.metadata ?? null,
    };
    if ((normalized.paymentMethod === 'card_terminal') !== (normalized.terminalId !== null))
      throw new PaymentError(
        'terminal_required',
        'card_terminal payments require terminal_id; other methods must omit it.',
      );
    const requestHash = hash({ ...normalized, id: input.id ?? null });
    const created = await this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'payment.create',
        key,
        requestHash,
        'payment',
        decodePaymentWithAttempt,
        async () => {
          // Sale ownership (TASK 12.4A.1, ADR-0009): a payment must
          // belong to a real sale that (a) exists for this company, (b)
          // truly has this exact branch — defense in depth alongside the
          // database's own `payments_sale_scope_fk` triple FK, which would
          // otherwise surface as an opaque constraint violation instead of
          // this clean error — and (c) is still awaiting payment. Locking
          // here (not just reading) also blocks a concurrent
          // cancellation from racing this payment's creation.
          const sale = await this.salesRepository.lockSaleById(
            client,
            context.companyId,
            normalized.saleId,
          );
          if (sale === null) throw new PaymentError('resource_not_found', 'The sale was not found.');
          if (sale.branchId !== normalized.branchId)
            throw new PaymentError('sale_branch_mismatch', 'The sale does not belong to this branch.');
          if (sale.status !== 'pending_payment')
            throw new PaymentError('invalid_sale_state', 'The sale is not awaiting payment.');
          if (sale.currencyCode !== normalized.currencyCode)
            throw new PaymentError('currency_mismatch', "The payment currency does not match the sale's currency.");
          let provider: string | null = null;
          if (normalized.terminalId !== null) {
            const terminal = await this.repository.lockTerminal(
              client,
              context.companyId,
              normalized.terminalId,
            );
            if (terminal === null)
              throw new PaymentError('resource_not_found', 'The payment terminal was not found.');
            if (terminal.branchId !== normalized.branchId)
              throw new PaymentError(
                'terminal_branch_mismatch',
                'The terminal does not belong to the requested branch.',
              );
            if (terminal.status !== 'active' && terminal.status !== 'assigned')
              throw new PaymentError('terminal_not_active', 'The terminal is not active.');
            provider = terminal.provider;
          }
          const created = await this.repository.insertPayment(client, {
            ...context,
            ...normalized,
            provider,
          });
          const firstAttempt = await this.repository.insertAttempt(client, {
            ...context,
            id: randomUUID(),
            paymentId: created.id,
            attemptNumber: 1,
            terminalId: normalized.terminalId,
            status: 'created',
            metadata: null,
          });
          await this.repository.auditAndPublish(client, context, {
            action: 'payment.created',
            resourceType: 'payment',
            resourceId: created.id,
            eventType: 'payment.recorded',
            version: created.version,
            payload: paymentPayload(created),
          });
          return { id: created.id, payment: created, attempt: firstAttempt };
        },
      ),
    );
    // TASK 12.4B.1: dispatched *outside* the transaction above — an
    // outbound HTTP call to Mercado Pago must never hold a database
    // connection/lock open for its duration. `dispatchAttemptToProvider`
    // re-fetches the attempt and only acts while it is still `created`,
    // so this is safe to call unconditionally, including when this whole
    // `createPayment` call was itself an idempotent replay (dispatch
    // already ran, or didn't apply, during the original call either way).
    const dispatched = await this.dispatchAttemptToProvider(
      context,
      branchIds,
      created.value.payment,
      created.value.attempt,
      key,
    );
    return { value: dispatched, replayed: created.replayed };
  }

  /**
   * TASK 12.5A: the cash checkout path — see ADR-0011 for the full
   * design. Unlike `createPayment` + `dispatchAttemptToProvider` +
   * `transitionAttempt` (used by every provider-backed method, and
   * necessarily split across separate transactions because a real
   * `card_terminal` dispatch makes an outbound HTTP call that must never
   * hold a database connection open — see `dispatchAttemptToProvider`'s
   * own comment), cash has no external round-trip at all: the cashier's
   * own physical confirmation of money received *is* the approval event,
   * entirely within this backend's control. So this method runs the
   * whole create → approve → capture → settle sequence in ONE
   * transaction, holding the sale row's `for update` lock continuously
   * from the amount-due computation through payment capture and sale
   * settlement. Splitting it the way the card path is split would only
   * reopen a real race (a second concurrent cash confirmation could read
   * a stale captured-total before the first payment reaches `captured`)
   * for no benefit, since there is no HTTP call here to keep out of the
   * transaction.
   *
   * The amount actually applied to the sale is always the
   * server-computed amount due (`sale.total` minus every already-
   * `captured` payment) — never the tendered amount, and never any
   * client-supplied figure. `tenderedAmount` and the derived
   * `changeAmount` are recorded as payment metadata (receipt/audit data)
   * only; they never affect how much the sale is credited. See the task's
   * own worked example: total 250.00, tendered 500.00 → payment amount
   * 250.00, change 250.00 — never a 500.00 payment.
   */
  /** TASK 12.7 Part E/N: resolves the exact open session a cash payment's
   * drawer movement belongs to. When `cashRegisterId` is supplied, that
   * register's own open session is used (or `cash_session_required` if it
   * has none) — the register must also genuinely belong to the sale's
   * branch, never trusted blindly. When omitted, the sale's branch's
   * single currently-open session is used; zero is `cash_session_required`
   * and more than one is a `validation_error` asking the caller to
   * disambiguate — never a silent "pick the first one" guess (the same
   * discipline TASK 12.6's operational-branch-context work already
   * established for branch selection). */
  private async resolveOpenCashSession(
    client: PaymentTransaction,
    companyId: string,
    branchId: string,
    cashRegisterId: string | undefined,
  ): Promise<CashSessionRow> {
    if (cashRegisterId !== undefined) {
      const registerRow = await this.cashRepository.lockRegister(client, companyId, cashRegisterId);
      if (registerRow?.branchId !== branchId)
        throw new CashError('resource_not_found', 'The register was not found.');
      const openSession = await this.cashRepository.openSessionForRegister(client, companyId, cashRegisterId);
      if (openSession === null)
        throw new CashError('cash_session_required', 'Open a cash session before confirming a cash payment.');
      return openSession;
    }
    const openSessions = await this.cashRepository.openSessionsForBranch(client, companyId, branchId);
    if (openSessions.length === 0)
      throw new CashError('cash_session_required', 'Open a cash session before confirming a cash payment.');
    const [singleSession] = openSessions;
    if (openSessions.length > 1 || singleSession === undefined)
      throw new CashError(
        'validation_error',
        'Multiple open cash sessions exist for this branch; specify cash_register_id.',
      );
    return singleSession;
  }

  public async createCashPayment(
    context: PaymentMutationContext,
    branchIds: readonly string[],
    key: string,
    input: CreateCashPaymentInput,
  ): Promise<{
    value: {
      payment: PaymentRow;
      attempt: PaymentAttemptRow;
      sale: SaleRow;
      tenderedAmount: string;
      changeAmount: string;
    };
    replayed: boolean;
  }> {
    if (typeof input.saleId !== 'string' || input.saleId.length === 0)
      throw new PaymentError('validation_error', 'sale_id is required.');
    const tendered = amount(input.tenderedAmount);
    const paymentId = input.id ?? randomUUID();
    const requestHash = hash({ saleId: input.saleId, tenderedAmount: tendered, id: input.id ?? null });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'payment.create_cash',
        key,
        requestHash,
        'payment',
        decodeCashPayment,
        async () => {
          // Same sale-ownership shape as `createPayment` above (exists,
          // belongs to this company, is awaiting payment) — locked, not
          // just read, so a concurrent cash confirmation or card
          // dispatch against the same sale serializes behind this one
          // rather than racing its amount-due computation.
          const sale = await this.salesRepository.lockSaleById(client, context.companyId, input.saleId);
          if (sale === null) throw new PaymentError('resource_not_found', 'The sale was not found.');
          if (!branchIds.includes(sale.branchId))
            throw new PaymentError(
              'sale_branch_mismatch',
              'The sale does not belong to an authorized branch.',
            );
          if (sale.status !== 'pending_payment')
            throw new PaymentError('invalid_sale_state', 'The sale is not awaiting payment.');
          // TASK 12.7 Part E/N: a cash confirmation independently
          // requires an open cash session — checked here, inside the
          // backend transaction, regardless of whatever Flutter already
          // showed the cashier (that UI-level check is real too, but this
          // is the one that actually matters; see ADR-0014).
          const cashSession = await this.resolveOpenCashSession(client, context.companyId, sale.branchId, input.cashRegisterId);
          // Server-authoritative outstanding balance — Flutter never
          // supplies (and this method never accepts) a sale total or an
          // amount to charge. See `PaymentRepository.capturedTotalForSale`.
          const capturedTotal = await this.repository.capturedTotalForSale(
            client,
            context.companyId,
            sale.id,
          );
          const amountDueUnits = moneyUnits(sale.total) - moneyUnits(capturedTotal);
          if (amountDueUnits <= 0n)
            throw new PaymentError(
              'invalid_sale_state',
              'The sale has no remaining balance due.',
            );
          const tenderedUnits = moneyUnits(tendered);
          if (tenderedUnits < amountDueUnits)
            throw new PaymentError(
              'insufficient_tendered',
              `El efectivo recibido es insuficiente. Faltan ${formatMoney(amountDueUnits - tenderedUnits)}.`,
            );
          const amountDue = formatMoney(amountDueUnits);
          const changeAmount = formatMoney(tenderedUnits - amountDueUnits);
          const insertedPayment = await this.repository.insertPayment(client, {
            ...context,
            id: paymentId,
            branchId: sale.branchId,
            saleId: sale.id,
            paymentMethod: 'cash',
            // The payment amount is the amount *applied to the sale*,
            // never the tendered cash — see this method's own doc comment.
            amount: amountDue,
            currencyCode: sale.currencyCode,
            provider: null,
            terminalId: null,
            metadata: {
              ...(input.metadata ?? {}),
              tendered_amount: tendered,
              change_amount: changeAmount,
            },
          });
          const insertedAttempt = await this.repository.insertAttempt(client, {
            ...context,
            id: randomUUID(),
            paymentId: insertedPayment.id,
            attemptNumber: 1,
            terminalId: null,
            status: 'created',
            metadata: null,
          });
          await this.repository.auditAndPublish(client, context, {
            action: 'payment.created',
            resourceType: 'payment',
            resourceId: insertedPayment.id,
            eventType: 'payment.recorded',
            version: insertedPayment.version,
            payload: paymentPayload(insertedPayment),
          });
          // `created → approved` in one step: a cash attempt has no
          // physical terminal round-trip to report (ADR-0008's own
          // `allowedAttemptTransitions.created` already allows this jump
          // — built and tested in TASK 12.4A specifically for cash). This
          // is not a fake/auto-approval: the cashier already physically
          // confirmed cash receipt in the Flutter UI before this request
          // was even sent (see the "Confirmar pago en efectivo" flow) —
          // this transition is this backend's durable record of that
          // real-world event, the same way a `card_terminal` attempt's
          // `approved` state records Mercado Pago's own report of an
          // event *it* observed. Neither path lets the server invent an
          // approval nobody attested to.
          const approvedAttempt = await this.repository.updateAttemptStatus(
            client,
            context.companyId,
            insertedAttempt.id,
            insertedAttempt.version,
            { status: 'approved', timestamp: context.timestamp, responded: true },
          );
          const capturedPayment = await this.repository.updatePaymentStatus(
            client,
            context.companyId,
            insertedPayment.id,
            insertedPayment.version,
            {
              status: 'captured',
              reasonCode: null,
              timestamp: context.timestamp,
              capturedAt: context.timestamp,
            },
          );
          await this.repository.auditAndPublish(client, context, {
            action: 'payment_attempt.status_changed',
            resourceType: 'payment_attempt',
            resourceId: approvedAttempt.id,
            eventType: 'payment.status_changed',
            version: approvedAttempt.version,
            payload: attemptPayload(capturedPayment, approvedAttempt),
          });
          // TASK 12.7 Part E: stamp the sale's own cash register/session
          // FKs (reserved since ADR-0009, real FKs since ADR-0014) —
          // idempotent to re-set on a replay, since it always writes the
          // exact same values for this exact sale.
          await this.salesRepository.attachCashSession(client, context.companyId, sale.id, {
            cashRegisterId: cashSession.cashRegisterId,
            cashSessionId: cashSession.id,
          });
          // Payment → sale coordination (ADR-0009), identical call to the
          // one `transitionAttempt`'s own `'approved'` branch makes —
          // completes the sale only the first time every captured
          // payment's sum covers its total, idempotent by construction.
          const { sale: settledSale, settled } = await this.salesRepository.trySettleSale(
            client,
            context,
            sale.id,
          );
          if (settled) await this.applyPostSettlementHooks(client, context, settledSale);
          // TASK 12.7 Part E: the drawer's own net fact — exactly
          // `amountDue` ($29 for the task's own $29/$50/$21 example),
          // never the tendered $50. Posted once per captured cash
          // Payment (`cash_movements_payment_reference_uq` — see
          // ADR-0014), independent of whether this payment happened to
          // also complete the sale (a split cash+card sale's cash leg
          // still hits the drawer even if the sale isn't `completed`
          // yet).
          await this.cashRepository.postCashSaleMovement(
            client,
            {
              companyId: context.companyId,
              actorId: context.actorId,
              requestId: context.requestId,
              correlationId: context.correlationId,
              timestamp: context.timestamp,
              deviceId: undefined,
            },
            {
              cashSessionId: cashSession.id,
              branchId: sale.branchId,
              amount: amountDue,
              currencyCode: sale.currencyCode,
              paymentId: capturedPayment.id,
              saleNumber: sale.saleNumber,
            },
          );
          return {
            id: capturedPayment.id,
            payment: capturedPayment,
            attempt: approvedAttempt,
            sale: settledSale,
            tenderedAmount: tendered,
            changeAmount,
          };
        },
      ),
    );
  }

  public async payment(
    companyId: string,
    branchIds: readonly string[],
    id: string,
  ): Promise<{ payment: PaymentRow; attempts: PaymentAttemptRow[] }> {
    const value = await this.repository.payment(companyId, id);
    if (value === null || !branchIds.includes(value.branchId))
      throw new PaymentError('resource_not_found', 'The payment was not found.');
    const attempts = await this.repository.attemptsForPayment(companyId, id);
    return { payment: value, attempts };
  }

  public listPayments(
    companyId: string,
    branchIds: readonly string[],
    input: Parameters<PaymentRepository['listPayments']>[2],
  ): ReturnType<PaymentRepository['listPayments']> {
    return this.repository.listPayments(companyId, branchIds, input);
  }

  /**
   * Records the next attempt for a payment whose current (latest) attempt
   * ended in a non-approved terminal state — a retry, never a mutation of
   * the prior attempt's evidence.
   */
  public async retryAttempt(
    context: PaymentMutationContext,
    branchIds: readonly string[],
    paymentId: string,
    key: string,
  ): Promise<{ value: PaymentAttemptRow; replayed: boolean }> {
    const requestHash = hash({ paymentId });
    const created = await this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'payment_attempt.retry',
        key,
        requestHash,
        'payment_attempt',
        decodeAttempt,
        async () => {
          const payment = await this.repository.lockPayment(
            client,
            context.companyId,
            branchIds,
            paymentId,
          );
          if (payment === null)
            throw new PaymentError('resource_not_found', 'The payment was not found.');
          if (payment.status !== 'pending')
            throw new PaymentError(
              'invalid_payment_state',
              'Only a pending payment can retry an attempt.',
            );
          const attempts = await this.repository.attemptsForPayment(context.companyId, paymentId);
          const latest = attempts.at(-1);
          if (latest === undefined || !terminalAttemptStatuses.has(latest.status))
            throw new PaymentError(
              'invalid_attempt_state',
              'The current attempt has not reached a terminal state yet.',
            );
          if (latest.status === 'approved')
            throw new PaymentError(
              'invalid_attempt_state',
              'An approved attempt cannot be retried.',
            );
          const number = await this.repository.nextAttemptNumber(
            client,
            context.companyId,
            paymentId,
          );
          const created = await this.repository.insertAttempt(client, {
            ...context,
            id: randomUUID(),
            paymentId,
            attemptNumber: number,
            terminalId: payment.terminalId,
            status: 'created',
            metadata: null,
          });
          await this.repository.auditAndPublish(client, context, {
            action: 'payment_attempt.retried',
            resourceType: 'payment_attempt',
            resourceId: created.id,
            eventType: 'payment.status_changed',
            version: created.version,
            payload: attemptPayload(payment, created),
          });
          return created;
        },
      ),
    );
    // Same out-of-transaction dispatch as `createPayment` — see its own
    // comment for why. `retryAttempt` itself never returns the payment
    // row, so it is re-read here (cheap, uncontended by this point).
    const payment = await this.repository.payment(context.companyId, paymentId);
    if (payment === null) return created;
    const dispatched = await this.dispatchAttemptToProvider(
      context,
      branchIds,
      payment,
      created.value,
      key,
    );
    return { value: dispatched.attempt, replayed: created.replayed };
  }

  /**
   * TASK 12.4B.1: sends a still-`created` `card_terminal` attempt to
   * Mercado Pago Point (`createOrder`) and folds the result back through
   * the existing, already-tested `transitionAttempt` state machine —
   * this never mutates attempt/payment rows directly, so every guarantee
   * `transitionAttempt` already provides (version locking, terminal-state
   * protection, idempotency, sale settlement) applies here unchanged.
   *
   * A no-op (returns the input unchanged) for: cash/card_manual/other
   * payment methods; a terminal not configured with `provider:
   * 'mercado_pago'` (still `'unassigned'` — see ADR-0008); or an attempt
   * that has already moved past `created` (the idempotent-replay guard —
   * dispatch is safe to call more than once for the same attempt).
   *
   * Never marks an attempt `approved` here — order creation returning
   * successfully only means Mercado Pago accepted and queued the order,
   * not that anyone paid (ADR-0010). The only legal outcomes of a
   * dispatch are `awaiting_terminal` (order created) or `failed`
   * (terminal misconfigured, or the provider call itself failed).
   */
  private async dispatchAttemptToProvider(
    context: PaymentMutationContext,
    branchIds: readonly string[],
    payment: PaymentRow,
    attempt: PaymentAttemptRow,
    key: string,
  ): Promise<{ payment: PaymentRow; attempt: PaymentAttemptRow }> {
    if (payment.paymentMethod !== 'card_terminal' || payment.terminalId === null)
      return { payment, attempt };
    const current = await this.repository.attempt(context.companyId, attempt.id);
    if (current?.status !== 'created') return { payment, attempt: current ?? attempt };
    const terminal = await this.repository.terminal(context.companyId, payment.terminalId);
    if (terminal?.provider !== 'mercado_pago') return { payment, attempt: current };
    if (terminal.providerTerminalId === null || terminal.providerTerminalId.length === 0) {
      const failed = await this.transitionAttempt(context, branchIds, attempt.id, `${key}:mp-dispatch-config`, {
        status: 'failed',
        declineReason: 'provider_terminal_not_configured',
      });
      return { payment, attempt: failed.value };
    }
    try {
      const order = await this.mercadoPagoProvider.createOrder({
        externalReference: attempt.id,
        amount: payment.amount,
        currencyCode: payment.currencyCode,
        terminalProviderId: terminal.providerTerminalId,
      });
      const updated = await this.transitionAttempt(context, branchIds, attempt.id, `${key}:mp-dispatch`, {
        status: 'awaiting_terminal',
        providerReference: order.providerOrderId,
        metadata: {
          mercado_pago_order_status: order.orderStatus,
          mercado_pago_order_status_detail: order.orderStatusDetail,
        },
      });
      return { payment, attempt: updated.value };
    } catch (error) {
      const reason =
        error instanceof PaymentProviderError ? `provider_error:${error.code}` : 'provider_error:unknown';
      const failed = await this.transitionAttempt(context, branchIds, attempt.id, `${key}:mp-dispatch-failed`, {
        status: 'failed',
        declineReason: reason,
      });
      return { payment, attempt: failed.value };
    }
  }

  /** Resolves which company/branch a Mercado Pago webhook notification
   * is even about — see `PaymentRepository.findAttemptCompanyByProviderReference`
   * for why this is the one deliberately unscoped lookup in this module. */
  public attemptOwnerByProviderReference(
    providerReference: string,
  ): ReturnType<PaymentRepository['findAttemptCompanyByProviderReference']> {
    return this.repository.findAttemptCompanyByProviderReference(providerReference);
  }

  /**
   * Records the next state a single attempt reaches — the mechanism
   * through which a (future) real terminal/provider reports "awaiting
   * card", "processing", "approved", "declined", "cancelled", or
   * "timed_out". Every transition here is itself a committed database
   * fact (never a bare UI hint) and is exactly what the outbox publishes
   * as `payment.status_changed`. Reaching `approved` immediately captures
   * the parent payment (§21.3's `pending → captured` edge) — see
   * ADR-0008 for why this pass does not implement a separate
   * authorize-then-capture flow.
   */
  public async transitionAttempt(
    context: PaymentMutationContext,
    branchIds: readonly string[],
    attemptId: string,
    key: string,
    input: AttemptTransitionInput,
  ): Promise<{ value: PaymentAttemptRow; replayed: boolean }> {
    if (!paymentAttemptStatuses.includes(input.status))
      throw new PaymentError('validation_error', 'status is not a recognized attempt state.');
    const normalized = {
      status: input.status,
      ...(input.providerReference === undefined
        ? {}
        : { providerReference: nonBlank(input.providerReference, 'provider_reference') }),
      ...(input.declineReason === undefined
        ? {}
        : { declineReason: nonBlank(input.declineReason, 'decline_reason') }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    };
    const requestHash = hash({ attemptId, ...normalized });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'payment_attempt.transition',
        key,
        requestHash,
        'payment_attempt',
        decodeAttempt,
        async () => {
          const current = await this.repository.lockAttempt(client, context.companyId, attemptId);
          if (current === null)
            throw new PaymentError('resource_not_found', 'The payment attempt was not found.');
          const payment = await this.repository.lockPayment(
            client,
            context.companyId,
            branchIds,
            current.paymentId,
          );
          if (payment === null)
            throw new PaymentError('resource_not_found', 'The payment was not found.');
          if (terminalAttemptStatuses.has(current.status))
            throw new PaymentError(
              'invalid_attempt_state',
              `Attempt already reached a terminal state (${current.status}); retry with a new attempt instead.`,
            );
          const allowed = allowedAttemptTransitions[current.status] ?? [];
          if (!allowed.includes(normalized.status))
            throw new PaymentError(
              'invalid_attempt_state',
              `Cannot transition attempt from ${current.status} to ${normalized.status}.`,
            );
          const responded = terminalAttemptStatuses.has(normalized.status);
          const updated = await this.repository.updateAttemptStatus(
            client,
            context.companyId,
            attemptId,
            current.version,
            { ...normalized, timestamp: context.timestamp, responded },
          );
          if (normalized.status === 'approved') {
            await this.repository.updatePaymentStatus(
              client,
              context.companyId,
              payment.id,
              payment.version,
              {
                status: 'captured',
                reasonCode: null,
                timestamp: context.timestamp,
                capturedAt: context.timestamp,
              },
            );
            // Payment → sale coordination (ADR-0009): settling reads every
            // `captured` payment for this sale (this one included, already
            // committed on this same connection above) and completes the
            // sale only the first time the sum covers its total —
            // `trySettleSale` is a no-op once the sale has left
            // `pending_payment`, so a replayed provider callback, a client
            // retry, or two workers racing this same transition can never
            // finalize the sale twice. This is the only place a sale
            // transitions to `completed` in this pass.
            const settlement = await this.salesRepository.trySettleSale(client, context, payment.saleId);
            if (settlement.settled) await this.applyPostSettlementHooks(client, context, settlement.sale);
          }
          await this.repository.auditAndPublish(client, context, {
            action: 'payment_attempt.status_changed',
            resourceType: 'payment_attempt',
            resourceId: updated.id,
            eventType: 'payment.status_changed',
            version: updated.version,
            payload: attemptPayload(payment, updated),
            ...(context.actorType === undefined ? {} : { actorType: context.actorType }),
          });
          return updated;
        },
      ),
    );
  }

  /** Cancels a still-`pending` payment. The canonical machine has no
   * distinct `cancelled` payment status (§21.3), so this maps to the
   * machine's own terminal non-success state, `failed`, with an explicit
   * reason code — never a silent, undocumented state. */
  public async cancelPayment(
    context: PaymentMutationContext,
    branchIds: readonly string[],
    paymentId: string,
    key: string,
    reasonCode: string,
  ): Promise<{ value: PaymentRow; replayed: boolean }> {
    const cleanReason = nonBlank(reasonCode, 'reason_code');
    const requestHash = hash({ paymentId, reasonCode: cleanReason });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'payment.cancel',
        key,
        requestHash,
        'payment',
        decodePayment,
        async () => {
          const current = await this.repository.lockPayment(
            client,
            context.companyId,
            branchIds,
            paymentId,
          );
          if (current === null)
            throw new PaymentError('resource_not_found', 'The payment was not found.');
          if (current.status !== 'pending')
            throw new PaymentError(
              'invalid_payment_state',
              'Only a pending payment can be cancelled.',
            );
          const updated = await this.repository.updatePaymentStatus(
            client,
            context.companyId,
            paymentId,
            current.version,
            {
              status: 'failed',
              reasonCode: cleanReason,
              timestamp: context.timestamp,
              failedAt: context.timestamp,
            },
          );
          await this.repository.auditAndPublish(client, context, {
            action: 'payment.cancelled',
            resourceType: 'payment',
            resourceId: updated.id,
            eventType: 'payment.status_changed',
            version: updated.version,
            payload: paymentPayload(updated),
          });
          return updated;
        },
      ),
    );
  }

  /** `POST /payments/{payment_id}/reversals` — exactly matches the
   * already-designed E080 contract and §21.3's `captured → reversed`
   * edge. */
  public async reversePayment(
    context: PaymentMutationContext,
    branchIds: readonly string[],
    paymentId: string,
    key: string,
    reasonCode: string,
  ): Promise<{ value: PaymentRow; replayed: boolean }> {
    const cleanReason = nonBlank(reasonCode, 'reason_code');
    const requestHash = hash({ paymentId, reasonCode: cleanReason });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'payment.reverse',
        key,
        requestHash,
        'payment',
        decodePayment,
        async () => {
          const current = await this.repository.lockPayment(
            client,
            context.companyId,
            branchIds,
            paymentId,
          );
          if (current === null)
            throw new PaymentError('resource_not_found', 'The payment was not found.');
          if (current.status !== 'captured')
            throw new PaymentError(
              'invalid_payment_state',
              'Only a captured payment can be reversed.',
            );
          const updated = await this.repository.updatePaymentStatus(
            client,
            context.companyId,
            paymentId,
            current.version,
            {
              status: 'reversed',
              reasonCode: cleanReason,
              timestamp: context.timestamp,
              reversedAt: context.timestamp,
            },
          );
          await this.repository.auditAndPublish(client, context, {
            action: 'payment.reversed',
            resourceType: 'payment',
            resourceId: updated.id,
            eventType: 'payment.reversed',
            version: updated.version,
            payload: paymentPayload(updated),
          });
          return updated;
        },
      ),
    );
  }
}

function paymentPayload(value: PaymentRow): Readonly<Record<string, unknown>> {
  return {
    payment_id: value.id,
    branch_id: value.branchId,
    sale_id: value.saleId,
    payment_method: value.paymentMethod,
    amount: value.amount,
    currency_code: value.currencyCode,
    status: value.status,
    version: value.version.toString(),
  };
}
function attemptPayload(
  payment: PaymentRow,
  value: PaymentAttemptRow,
): Readonly<Record<string, unknown>> {
  return {
    payment_id: payment.id,
    payment_attempt_id: value.id,
    attempt_number: value.attemptNumber,
    status: value.status,
    version: value.version.toString(),
  };
}

function decodeTerminal(raw: unknown): PaymentTerminalRow {
  const value = raw as Omit<PaymentTerminalRow, 'version' | 'createdAt' | 'updatedAt'> & {
    version: string;
    createdAt: string;
    updatedAt: string;
  };
  return {
    ...value,
    version: BigInt(value.version),
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
  };
}
function decodePayment(raw: unknown): PaymentRow {
  const value = raw as Omit<
    PaymentRow,
    'version' | 'createdAt' | 'updatedAt' | 'authorizedAt' | 'capturedAt' | 'failedAt' | 'reversedAt'
  > & {
    version: string;
    createdAt: string;
    updatedAt: string;
    authorizedAt: string | null;
    capturedAt: string | null;
    failedAt: string | null;
    reversedAt: string | null;
  };
  return {
    ...value,
    version: BigInt(value.version),
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
    authorizedAt: value.authorizedAt === null ? null : new Date(value.authorizedAt),
    capturedAt: value.capturedAt === null ? null : new Date(value.capturedAt),
    failedAt: value.failedAt === null ? null : new Date(value.failedAt),
    reversedAt: value.reversedAt === null ? null : new Date(value.reversedAt),
  };
}
function decodeAttempt(raw: unknown): PaymentAttemptRow {
  const value = raw as Omit<
    PaymentAttemptRow,
    'version' | 'createdAt' | 'updatedAt' | 'requestedAt' | 'respondedAt'
  > & {
    version: string;
    createdAt: string;
    updatedAt: string;
    requestedAt: string;
    respondedAt: string | null;
  };
  return {
    ...value,
    version: BigInt(value.version),
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
    requestedAt: new Date(value.requestedAt),
    respondedAt: value.respondedAt === null ? null : new Date(value.respondedAt),
  };
}
function decodePaymentWithAttempt(raw: unknown): { payment: PaymentRow; attempt: PaymentAttemptRow } {
  const value = raw as { payment: unknown; attempt: unknown };
  return { payment: decodePayment(value.payment), attempt: decodeAttempt(value.attempt) };
}
// TASK 12.5A: `SalesRepository`/`sales.service.ts` keeps its own private
// `decodeSale` for the identical reason — every idempotent-replay decoder
// in this codebase is local to the module that stores the payload, never
// shared, so this is the same pattern, not a new one.
function decodeSale(raw: unknown): SaleRow {
  const value = raw as Omit<
    SaleRow,
    'version' | 'createdAt' | 'updatedAt' | 'occurredAt' | 'completedAt' | 'cancelledAt'
  > & {
    version: string;
    createdAt: string;
    updatedAt: string;
    occurredAt: string;
    completedAt: string | null;
    cancelledAt: string | null;
  };
  return {
    ...value,
    version: BigInt(value.version),
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
    occurredAt: new Date(value.occurredAt),
    completedAt: value.completedAt === null ? null : new Date(value.completedAt),
    cancelledAt: value.cancelledAt === null ? null : new Date(value.cancelledAt),
  };
}
function decodeCashPayment(raw: unknown): {
  payment: PaymentRow;
  attempt: PaymentAttemptRow;
  sale: SaleRow;
  tenderedAmount: string;
  changeAmount: string;
} {
  const value = raw as {
    payment: unknown;
    attempt: unknown;
    sale: unknown;
    tenderedAmount: string;
    changeAmount: string;
  };
  return {
    payment: decodePayment(value.payment),
    attempt: decodeAttempt(value.attempt),
    sale: decodeSale(value.sale),
    tenderedAmount: value.tenderedAmount,
    changeAmount: value.changeAmount,
  };
}
