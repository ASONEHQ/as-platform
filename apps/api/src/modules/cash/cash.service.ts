import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

import { normalizeCurrencyCode } from '@asone/database';

import type { CashRepository } from './cash.repository.js';
import {
  canonicalCashDenominationsForCurrency,
  CashError,
  type CashAuditLogEntry,
  type CashMovementCategory,
  cashMovementCategories,
  cashMovementCategoryDirection,
  cashMovementDirection,
  type CashMovementRow,
  type CashMutationContext,
  type CashRegisterRow,
  type CashSessionPartialCloseRow,
  type CashSessionRow,
  type DenominationCount,
} from './cash.types.js';

const MONEY_SCALE = 10_000n;
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
function amount(value: string, field: string): string {
  const units = moneyUnits(value);
  if (units <= 0n) throw new CashError('validation_error', `${field} must be greater than zero.`);
  return formatMoney(units);
}
function nonNegativeAmount(value: string, field: string): string {
  const units = moneyUnits(value);
  if (units < 0n) throw new CashError('validation_error', `${field} cannot be negative.`);
  return formatMoney(units);
}
function nonBlank(value: string, field: string): string {
  const clean = value.trim();
  if (clean.length === 0) throw new CashError('validation_error', `${field} cannot be blank.`);
  if (clean.length > 200) throw new CashError('validation_error', `${field} is too long.`);
  return clean;
}
/** Part J — validates an optional bills/coins breakdown against the
 * canonical AS POS V1 denomination set and requires it to sum to exactly
 * `declaredClosingAmount` (the same figure the cashier would otherwise
 * type directly). Never a second source of truth for the counted total —
 * see the doc comment on `cash_sessions.denomination_counts`. */
function validateDenominationCounts(
  input: readonly { value: string; quantity: number }[] | undefined,
  declaredClosingAmount: string,
  currencyCode: string,
): readonly DenominationCount[] | null {
  if (input === undefined) return null;
  if (input.length === 0) throw new CashError('validation_error', 'denomination_counts cannot be empty.');
  const denominations = canonicalCashDenominationsForCurrency(currencyCode);
  const seen = new Set<string>();
  let totalUnits = 0n;
  const normalized: DenominationCount[] = [];
  for (const line of input) {
    const canonicalValue = denominations.find(
      (candidate) => moneyUnits(candidate) === moneyUnits(line.value),
    );
    if (canonicalValue === undefined)
      throw new CashError(
        'validation_error',
        `${line.value} is not a recognized ${currencyCode} denomination.`,
      );
    if (seen.has(canonicalValue))
      throw new CashError('validation_error', `Denomination ${canonicalValue} was listed more than once.`);
    seen.add(canonicalValue);
    if (!Number.isInteger(line.quantity) || line.quantity < 0)
      throw new CashError('validation_error', 'Each denomination quantity must be a non-negative integer.');
    totalUnits += moneyUnits(canonicalValue) * BigInt(line.quantity);
    normalized.push({ value: canonicalValue, quantity: line.quantity });
  }
  if (totalUnits !== moneyUnits(declaredClosingAmount))
    throw new CashError(
      'validation_error',
      'denomination_counts do not sum to declared_closing_amount.',
    );
  normalized.sort((a, b) => (moneyUnits(b.value) > moneyUnits(a.value) ? 1 : -1));
  return normalized;
}
/** TASK 14.4 (Wave 2, Part F.1) — the exact same rule as the database's
 * own `cash_movements_category_direction_ck`, checked server-side
 * BEFORE the insert is attempted, so a mismatched category is a clean
 * `validation_error` rather than a raw constraint violation. Keep in
 * lockstep with that check and with `cash.ts`'s `cashMovementCategoryDirection`
 * table — never let the two drift apart. */
function validateMovementCategory(
  movementType: 'cash_in' | 'cash_out',
  category: CashMovementCategory | undefined,
): CashMovementCategory | null {
  if (category === undefined) return null;
  if (!cashMovementCategories.includes(category))
    throw new CashError('validation_error', `category must be one of: ${cashMovementCategories.join(', ')}.`);
  const requiredType = cashMovementCategoryDirection[category];
  if (requiredType !== null && requiredType !== movementType)
    throw new CashError('validation_error', `category "${category}" is only valid for a ${requiredType} movement.`);
  return category;
}

function hash(value: object): string {
  return createHash('sha256')
    .update(JSON.stringify(Object.fromEntries(Object.entries(value).sort())))
    .digest('hex');
}

function registerPayload(value: CashRegisterRow): Readonly<Record<string, unknown>> {
  return {
    register_id: value.id,
    branch_id: value.branchId,
    code: value.code,
    status: value.status,
    version: value.version.toString(),
  };
}
function sessionPayload(value: CashSessionRow): Readonly<Record<string, unknown>> {
  return {
    session_id: value.id,
    branch_id: value.branchId,
    cash_register_id: value.cashRegisterId,
    status: value.status,
    opening_amount: value.openingAmount,
    version: value.version.toString(),
  };
}

export interface CashSessionSummary {
  session: CashSessionRow;
  openingAmount: string;
  cashSalesTotal: string;
  cashSalesCount: number;
  cashInTotal: string;
  cashOutTotal: string;
  // TASK 14.4 (Wave 2, Part F.2) — new NAMED breakdowns mirroring
  // `cashSalesTotal`/`cashInTotal`/`cashOutTotal`'s own precedent
  // exactly. Each is a strict subset already folded into `cashInTotal`/
  // `cashOutTotal` above (never a second amount source — `category` is
  // read-only reporting metadata over the same movements), so
  // `expectedCash` needs no new term: `cash_in`/`cash_out`'s existing
  // direction already carries a categorized movement's contribution.
  withdrawalTotal: string;
  expenseTotal: string;
  externalIncomeTotal: string;
  expectedCash: string;
}

export class CashService {
  public constructor(private readonly repository: CashRepository) {}

  // --- Registers -----------------------------------------------------------

  public async createRegister(
    context: CashMutationContext,
    branchIds: readonly string[],
    key: string,
    input: { id?: string; branchId: string; code: string; name: string; deviceId?: string },
  ): Promise<{ value: CashRegisterRow; replayed: boolean }> {
    if (!branchIds.includes(input.branchId))
      throw new CashError('validation_error', 'The branch is not authorized for this actor.');
    const code = nonBlank(input.code, 'code');
    const name = nonBlank(input.name, 'name');
    const normalized = { id: input.id ?? randomUUID(), branchId: input.branchId, code, name, deviceId: input.deviceId ?? null };
    const requestHash = hash({ branchId: normalized.branchId, code, name, deviceId: normalized.deviceId, id: input.id ?? null });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'cash_register.create',
        key,
        requestHash,
        'cash_register',
        decodeRegister,
        async () => {
          if (normalized.deviceId !== null) {
            const device = await client.query(
              `select 1 from devices where company_id=$1 and id=$2 and branch_id=$3`,
              [context.companyId, normalized.deviceId, normalized.branchId],
            );
            if ((device as { rows: unknown[] }).rows.length === 0)
              throw new CashError('validation_error', 'The device does not belong to this branch.');
          }
          const created = await this.repository.insertRegister(client, {
            id: normalized.id,
            companyId: context.companyId,
            branchId: normalized.branchId,
            code: normalized.code,
            name: normalized.name,
            deviceId: normalized.deviceId,
            actorId: context.actorId,
            timestamp: context.timestamp,
          });
          await this.repository.auditAndPublish(client, context, {
            action: 'cash_register.created',
            resourceType: 'cash_register',
            resourceId: created.id,
            eventType: 'cash_register.created',
            branchId: created.branchId,
            version: created.version,
            payload: registerPayload(created),
          });
          return created;
        },
      ),
    );
  }

  public async register(companyId: string, branchIds: readonly string[], id: string): Promise<CashRegisterRow> {
    const value = await this.repository.register(companyId, id);
    if (value === null || !branchIds.includes(value.branchId))
      throw new CashError('resource_not_found', 'The register was not found.');
    return value;
  }

  public listRegisters(
    companyId: string,
    branchIds: readonly string[],
    input: Parameters<CashRepository['listRegisters']>[2],
  ): ReturnType<CashRepository['listRegisters']> {
    return this.repository.listRegisters(companyId, branchIds, input);
  }

  public async assignDevice(
    context: CashMutationContext,
    branchIds: readonly string[],
    id: string,
    expectedVersion: bigint,
    deviceId: string | null,
  ): Promise<CashRegisterRow> {
    return this.repository.transaction(async (client) => {
      const current = await this.repository.lockRegister(client, context.companyId, id);
      if (current === null || !branchIds.includes(current.branchId))
        throw new CashError('resource_not_found', 'The register was not found.');
      if (deviceId !== null) {
        const device = await client.query(`select 1 from devices where company_id=$1 and id=$2 and branch_id=$3`, [
          context.companyId,
          deviceId,
          current.branchId,
        ]);
        if ((device as { rows: unknown[] }).rows.length === 0)
          throw new CashError('validation_error', 'The device does not belong to this branch.');
      }
      const updated = await this.repository.assignDevice(client, context.companyId, id, expectedVersion, {
        deviceId,
        timestamp: context.timestamp,
        updatedBy: context.actorId,
      });
      await this.repository.auditAndPublish(client, context, {
        action: 'cash_register.device_assigned',
        resourceType: 'cash_register',
        resourceId: updated.id,
        eventType: 'cash_register.device_assigned',
        branchId: updated.branchId,
        version: updated.version,
        payload: { register_id: updated.id, device_id: updated.deviceId, version: updated.version.toString() },
      });
      return updated;
    });
  }

  // --- Sessions --------------------------------------------------------------

  /** E042 — opens a session for one register. The database's own
   * `cash_sessions_register_active_uq` partial unique index is the real
   * "at most one open session per register" guarantee (Part B); this
   * pre-check only produces the friendlier, documented
   * `cash_session_already_open` error instead of a raw constraint
   * violation for the common case. */
  public async openSession(
    context: CashMutationContext,
    branchIds: readonly string[],
    key: string,
    input: { id?: string; cashRegisterId: string; openingAmount: string; currencyCode?: string },
  ): Promise<{ value: CashSessionRow; replayed: boolean }> {
    const openingAmount = nonNegativeAmount(input.openingAmount, 'opening_amount');
    const requestHash = hash({ cashRegisterId: input.cashRegisterId, openingAmount, id: input.id ?? null });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'cash_session.open',
        key,
        requestHash,
        'cash_session',
        decodeSession,
        async () => {
          const registerRow = await this.repository.lockRegister(client, context.companyId, input.cashRegisterId);
          if (registerRow === null || !branchIds.includes(registerRow.branchId))
            throw new CashError('resource_not_found', 'The register was not found.');
          if (registerRow.status !== 'active')
            throw new CashError('validation_error', 'The register is not active.');
          const existing = await this.repository.openSessionForRegister(client, context.companyId, input.cashRegisterId);
          if (existing !== null)
            throw new CashError('cash_session_already_open', 'The register already has an open session.');
          // TASK 16.11A — the tenant's own authoritative configured
          // currency (never a hardcoded 'MXN' literal, which silently
          // mistagged every session for any non-MXN company — see
          // `CashRepository.companyCurrencyCode`'s own doc comment). The
          // explicit override remains for the rare caller that already
          // knows the exact currency it wants (e.g. this module's own
          // test fixtures) — real Flutter callers never send one.
          const currencyCode =
            input.currencyCode === undefined
              ? await this.repository.companyCurrencyCode(client, context.companyId)
              : normalizeCurrencyCode(input.currencyCode);
          const id = input.id ?? randomUUID();
          const created = await this.repository.insertSession(client, {
            ...context,
            id,
            branchId: registerRow.branchId,
            cashRegisterId: registerRow.id,
            openingAmount,
            currencyCode,
          });
          // Part D/H: the opening float is itself a ledger fact — every
          // dollar in the expected-cash formula comes from folding
          // movements, never a special-cased `opening_amount` field plus
          // movements bolted on top. Skipped only for a genuine $0.00
          // open (amount>0 forbids a zero-amount movement row) — expected
          // cash is still correctly $0 either way.
          if (moneyUnits(openingAmount) > 0n) {
            await this.repository.insertMovement(client, {
              id: randomUUID(),
              companyId: context.companyId,
              branchId: created.branchId,
              cashSessionId: created.id,
              movementType: 'opening_float',
              amount: openingAmount,
              currencyCode,
              reasonCode: 'opening_float',
              note: null,
              referenceType: null,
              referenceId: null,
              occurredAt: context.timestamp,
              createdBy: context.actorId,
              deviceId: context.deviceId ?? null,
            });
          }
          await this.repository.auditAndPublish(client, context, {
            action: 'cash_session.opened',
            resourceType: 'cash_session',
            resourceId: created.id,
            eventType: 'cash_session.opened',
            branchId: created.branchId,
            version: created.version,
            payload: sessionPayload(created),
          });
          return created;
        },
      ),
    );
  }

  public async session(companyId: string, branchIds: readonly string[], id: string): Promise<CashSessionRow> {
    const value = await this.repository.session(companyId, id);
    if (value === null || !branchIds.includes(value.branchId))
      throw new CashError('resource_not_found', 'The session was not found.');
    return value;
  }

  /** E043 — "find open session". Exactly one of `cashRegisterId` is
   * required (this app has no bound `device_id` to key off — see
   * ADR-0009's own note on browser-session CAJERO), and `null` is a
   * legitimate, honest answer (no open session), never an error. */
  public async currentSession(
    companyId: string,
    branchIds: readonly string[],
    cashRegisterId: string,
  ): Promise<CashSessionRow | null> {
    const registerRow = await this.repository.register(companyId, cashRegisterId);
    if (registerRow === null || !branchIds.includes(registerRow.branchId))
      throw new CashError('resource_not_found', 'The register was not found.');
    return this.repository.openSessionForRegister(null, companyId, cashRegisterId);
  }

  public listSessions(
    companyId: string,
    branchIds: readonly string[],
    input: Parameters<CashRepository['listSessions']>[2],
  ): ReturnType<CashRepository['listSessions']> {
    return this.repository.listSessions(companyId, branchIds, input);
  }

  // --- Movements ---------------------------------------------------------

  /** E045 — manual cash in/out only; `cash_sale`/`opening_float` are
   * system-posted (`postCashSaleMovement`/`openSession`), never through
   * this caller-facing route — enforced by the type union below. */
  public async createMovement(
    context: CashMutationContext,
    branchIds: readonly string[],
    key: string,
    cashSessionId: string,
    input: {
      id?: string;
      movementType: 'cash_in' | 'cash_out';
      amount: string;
      reasonCode: string;
      note?: string;
      category?: CashMovementCategory;
    },
  ): Promise<{ value: CashMovementRow; replayed: boolean }> {
    const movementAmount = amount(input.amount, 'amount');
    const reasonCode = nonBlank(input.reasonCode, 'reason_code');
    // Part F.1 — validated BEFORE the transaction/DB write, using the
    // exact same rule as `cash_movements_category_direction_ck`.
    const category = validateMovementCategory(input.movementType, input.category);
    const requestHash = hash({
      cashSessionId,
      movementType: input.movementType,
      amount: movementAmount,
      reasonCode,
      category,
      id: input.id ?? null,
    });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'cash_movement.create',
        key,
        requestHash,
        'cash_movement',
        decodeMovement,
        async () => {
          const sessionRow = await this.repository.lockSession(client, context.companyId, cashSessionId);
          if (sessionRow === null || !branchIds.includes(sessionRow.branchId))
            throw new CashError('resource_not_found', 'The session was not found.');
          if (sessionRow.status !== 'open') throw new CashError('cash_session_closed', 'The session is not open.');
          const created = await this.repository.insertMovement(client, {
            id: input.id ?? randomUUID(),
            companyId: context.companyId,
            branchId: sessionRow.branchId,
            cashSessionId: sessionRow.id,
            movementType: input.movementType,
            amount: movementAmount,
            currencyCode: sessionRow.currencyCode,
            reasonCode,
            note: input.note === undefined ? null : nonBlank(input.note, 'note'),
            referenceType: null,
            referenceId: null,
            occurredAt: context.timestamp,
            createdBy: context.actorId,
            deviceId: context.deviceId ?? null,
            category,
          });
          await this.repository.auditAndPublish(client, context, {
            action: 'cash_movement.created',
            resourceType: 'cash_movement',
            resourceId: created.id,
            eventType: 'cash_movement.created',
            branchId: created.branchId,
            version: 1n,
            payload: {
              movement_id: created.id,
              cash_session_id: created.cashSessionId,
              movement_type: created.movementType,
              amount: created.amount,
              reason_code: created.reasonCode,
              category: created.category,
            },
          });
          return created;
        },
      ),
    );
  }

  /** TASK 16.11 (§6) — "Never delete posted financial movements.
   * Corrections must use reversal/compensating architecture." Posts a new
   * movement of the OPPOSITE direction/type for the SAME amount, with
   * `reversalOfId` pointing at the original — never mutates or deletes the
   * original row. Only a client-postable `cash_in`/`cash_out` movement can
   * be reversed; `opening_float`/`cash_sale`/`cash_refund` are
   * system-posted and have their own correction paths elsewhere (e.g. the
   * sale/refund they mirror) — reversing those here would let a drawer
   * count silently diverge from the sale/refund ledger it's supposed to
   * mirror. */
  public async reverseMovement(
    context: CashMutationContext,
    branchIds: readonly string[],
    key: string,
    cashSessionId: string,
    movementId: string,
    input: { reasonCode: string; note?: string },
  ): Promise<{ value: CashMovementRow; replayed: boolean }> {
    const reasonCode = nonBlank(input.reasonCode, 'reason_code');
    const requestHash = hash({ cashSessionId, movementId, reasonCode, note: input.note ?? null });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'cash_movement.reverse',
        key,
        requestHash,
        'cash_movement',
        decodeMovement,
        async () => {
          const sessionRow = await this.repository.lockSession(client, context.companyId, cashSessionId);
          if (sessionRow === null || !branchIds.includes(sessionRow.branchId))
            throw new CashError('resource_not_found', 'The session was not found.');
          if (sessionRow.status !== 'open') throw new CashError('cash_session_closed', 'The session is not open.');
          const original = await this.repository.lockMovement(client, context.companyId, sessionRow.id, movementId);
          if (original === null) throw new CashError('resource_not_found', 'The movement was not found.');
          if (original.movementType !== 'cash_in' && original.movementType !== 'cash_out')
            throw new CashError(
              'cash_movement_not_reversible',
              `A ${original.movementType} movement cannot be reversed here; it is system-posted and corrected through the record it mirrors.`,
            );
          if (original.reversalOfId !== null)
            throw new CashError('cash_movement_not_reversible', 'A reversal itself cannot be reversed.');
          if (await this.repository.hasReversal(client, context.companyId, original.id))
            throw new CashError('cash_movement_already_reversed', 'This movement was already reversed.');
          const reversedType: 'cash_in' | 'cash_out' = original.movementType === 'cash_in' ? 'cash_out' : 'cash_in';
          const created = await this.repository.insertMovement(client, {
            id: randomUUID(),
            companyId: context.companyId,
            branchId: sessionRow.branchId,
            cashSessionId: sessionRow.id,
            movementType: reversedType,
            amount: original.amount,
            currencyCode: sessionRow.currencyCode,
            reasonCode,
            note: input.note === undefined ? null : nonBlank(input.note, 'note'),
            referenceType: null,
            referenceId: null,
            occurredAt: context.timestamp,
            createdBy: context.actorId,
            deviceId: context.deviceId ?? null,
            category: null,
            reversalOfId: original.id,
          });
          await this.repository.auditAndPublish(client, context, {
            action: 'cash_movement.reversed',
            resourceType: 'cash_movement',
            resourceId: created.id,
            eventType: 'cash_movement.reversed',
            branchId: created.branchId,
            version: 1n,
            payload: {
              movement_id: created.id,
              reversal_of_id: original.id,
              cash_session_id: created.cashSessionId,
              movement_type: created.movementType,
              amount: created.amount,
              reason_code: created.reasonCode,
            },
          });
          return created;
        },
      ),
    );
  }

  public async listMovements(
    companyId: string,
    branchIds: readonly string[],
    cashSessionId: string,
    input: Parameters<CashRepository['listMovements']>[2],
  ): Promise<{ items: CashMovementRow[]; nextCursor: string | null }> {
    const sessionRow = await this.session(companyId, branchIds, cashSessionId);
    return this.repository.listMovements(companyId, sessionRow.id, input);
  }

  // --- Summary / expected cash (Part H / E048) ----------------------------

  public async summary(companyId: string, branchIds: readonly string[], cashSessionId: string): Promise<CashSessionSummary> {
    const sessionRow = await this.session(companyId, branchIds, cashSessionId);
    const movements = await this.repository.movementsForSession(companyId, sessionRow.id);
    let expectedUnits = 0n;
    let cashSalesUnits = 0n;
    let cashSalesCount = 0;
    let cashInUnits = 0n;
    let cashOutUnits = 0n;
    // Part F.2 — strict subsets of `cashOutUnits`/`cashInUnits` above,
    // never a second amount source: `category` doesn't change
    // `movementType`/`amount`, so every dollar counted here was already
    // counted in `expectedUnits` via the existing direction fold.
    let withdrawalUnits = 0n;
    let expenseUnits = 0n;
    let externalIncomeUnits = 0n;
    for (const item of movements) {
      const units = moneyUnits(item.amount);
      expectedUnits += units * BigInt(cashMovementDirection[item.movementType]);
      if (item.movementType === 'cash_sale') {
        cashSalesUnits += units;
        cashSalesCount += 1;
      } else if (item.movementType === 'cash_in') {
        cashInUnits += units;
        if (item.category === 'external_income') externalIncomeUnits += units;
      } else if (item.movementType === 'cash_out') {
        cashOutUnits += units;
        if (item.category === 'withdrawal') withdrawalUnits += units;
        else if (item.category === 'expense') expenseUnits += units;
      }
    }
    return {
      session: sessionRow,
      openingAmount: sessionRow.openingAmount,
      cashSalesTotal: formatMoney(cashSalesUnits),
      cashSalesCount,
      cashInTotal: formatMoney(cashInUnits),
      cashOutTotal: formatMoney(cashOutUnits),
      withdrawalTotal: formatMoney(withdrawalUnits),
      expenseTotal: formatMoney(expenseUnits),
      externalIncomeTotal: formatMoney(externalIncomeUnits),
      expectedCash: formatMoney(expectedUnits),
    };
  }

  // --- Close (E047 / Part I) ------------------------------------------------

  /** §21.1: `open -> closing -> closed` (or `closing -> open` on a safe
   * failure). This implementation's own closure has no external-provider
   * dependency (unlike a payment capture) — it's pure arithmetic over
   * already-committed ledger facts — so the `closing` transition and the
   * final `closed` commit happen inside one database transaction; a
   * thrown error rolls the whole transaction back, which *is* the
   * "closing -> open" safe-failure path (the session is simply left
   * exactly as it was, still `open`, never stuck in `closing`). See
   * ADR-0014. */
  public async closeSession(
    context: CashMutationContext,
    branchIds: readonly string[],
    key: string,
    cashSessionId: string,
    input: {
      declaredClosingAmount: string;
      denominationCounts?: readonly { value: string; quantity: number }[];
    },
  ): Promise<{ value: CashSessionRow; replayed: boolean }> {
    const declaredClosingAmount = nonNegativeAmount(input.declaredClosingAmount, 'declared_closing_amount');
    // TASK 16.11 — the denomination set depends on the SESSION's own
    // currency (see `canonicalCashDenominationsForCurrency`'s own doc
    // comment), which is only known once the session row is loaded
    // below, inside the transaction — never validated here against a
    // blind MXN assumption. The idempotency request hash therefore
    // covers the RAW input, not a pre-validated/normalized shape (still
    // fully deterministic per distinct request).
    const requestHash = hash({ cashSessionId, declaredClosingAmount, denominationCounts: input.denominationCounts });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'cash_session.close',
        key,
        requestHash,
        'cash_session',
        decodeSession,
        async () => {
          const sessionRow = await this.repository.lockSession(client, context.companyId, cashSessionId);
          if (sessionRow === null || !branchIds.includes(sessionRow.branchId))
            throw new CashError('resource_not_found', 'The session was not found.');
          if (sessionRow.status === 'closed')
            throw new CashError('cash_session_closed', 'The session is already closed.');
          const denominationCounts = validateDenominationCounts(
            input.denominationCounts,
            declaredClosingAmount,
            sessionRow.currencyCode,
          );
          // Formal `open -> closing` transition (§21.1) — real inside
          // this one transaction, not merely conceptual.
          const closingRow = await this.repository.transitionSessionStatus(
            client,
            context.companyId,
            sessionRow.id,
            sessionRow.version,
            'closing',
            context.timestamp,
          );
          const movements = await this.repository.movementsForSession(context.companyId, sessionRow.id);
          let expectedUnits = 0n;
          for (const item of movements)
            expectedUnits += moneyUnits(item.amount) * BigInt(cashMovementDirection[item.movementType]);
          const expectedClosingAmount = formatMoney(expectedUnits);
          // Part I: backend computes the difference — `declared -
          // expected`, exact BigInt arithmetic, never accepted as
          // client-submitted input.
          const discrepancyAmount = formatMoney(moneyUnits(declaredClosingAmount) - expectedUnits);
          const closed = await this.repository.closeSession(client, context.companyId, sessionRow.id, closingRow.version, {
            closedBy: context.actorId,
            closedAt: context.timestamp,
            declaredClosingAmount,
            expectedClosingAmount,
            discrepancyAmount,
            denominationCounts,
          });
          await this.repository.auditAndPublish(client, context, {
            action: 'cash_session.closed',
            resourceType: 'cash_session',
            resourceId: closed.id,
            eventType: 'cash_session.closed',
            branchId: closed.branchId,
            version: closed.version,
            payload: {
              session_id: closed.id,
              declared_closing_amount: closed.declaredClosingAmount,
              expected_closing_amount: closed.expectedClosingAmount,
              discrepancy_amount: closed.discrepancyAmount,
              denomination_counts: closed.denominationCounts,
              version: closed.version.toString(),
            },
          });
          return closed;
        },
      ),
    );
  }

  // --- Partial close ("corte parcial") (TASK 14.4 Wave 2 Part F.3) -------

  /** A pure, persisted, audited SNAPSHOT of `summary()`'s own fold at
   * this instant — never a second drawer-balance calculation path (the
   * fold below is exactly `summary()`'s, deliberately re-run here rather
   * than reusing `summary()` itself so it reads the same still-locked
   * session row `closeSession` already establishes as the pattern for a
   * mutation that needs the session's current state). Critically, this
   * NEVER transitions `cashSessions.status` — no `transitionSessionStatus`
   * call anywhere in this method, unlike `closeSession` above. */
  public async partialClose(
    context: CashMutationContext,
    branchIds: readonly string[],
    key: string,
    cashSessionId: string,
  ): Promise<{ value: CashSessionPartialCloseRow; replayed: boolean }> {
    const requestHash = hash({ cashSessionId, takenAt: context.timestamp.toISOString() });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'cash_session.partial_close',
        key,
        requestHash,
        'cash_session_partial_close',
        decodePartialClose,
        async () => {
          const sessionRow = await this.repository.lockSession(client, context.companyId, cashSessionId);
          if (sessionRow === null || !branchIds.includes(sessionRow.branchId))
            throw new CashError('resource_not_found', 'The session was not found.');
          // A partial close only ever makes sense against a live, still-
          // open session — a `closing`/`closed` session already has its
          // own authoritative, permanent closure figures.
          if (sessionRow.status !== 'open')
            throw new CashError('cash_session_not_open', 'The session is not open.');
          const movements = await this.repository.movementsForSession(context.companyId, sessionRow.id);
          let expectedUnits = 0n;
          let cashSalesUnits = 0n;
          let cashInUnits = 0n;
          let cashOutUnits = 0n;
          for (const item of movements) {
            const units = moneyUnits(item.amount);
            expectedUnits += units * BigInt(cashMovementDirection[item.movementType]);
            if (item.movementType === 'cash_sale') cashSalesUnits += units;
            else if (item.movementType === 'cash_in') cashInUnits += units;
            else if (item.movementType === 'cash_out') cashOutUnits += units;
          }
          // TASK 16.13 — "Resumen operativo": reporting-only, computed
          // fresh from this exact window (session open → this instant)
          // and persisted alongside the cash-truth figures above so a
          // historical partial close stays a frozen snapshot forever (see
          // `CashRepository.operationalSummary`'s own doc comment for the
          // double-counting analysis). Never influences `expectedUnits`/
          // `cashSalesUnits`/etc. above in any way.
          const operationalSummary = await this.repository.operationalSummary(
            context.companyId,
            sessionRow.branchId,
            sessionRow.openedAt,
            context.timestamp,
            context.timestamp.toISOString().slice(0, 10),
          );
          const created = await this.repository.insertPartialClose(client, {
            id: randomUUID(),
            companyId: context.companyId,
            branchId: sessionRow.branchId,
            cashSessionId: sessionRow.id,
            takenAt: context.timestamp,
            openingAmount: sessionRow.openingAmount,
            cashSalesTotal: formatMoney(cashSalesUnits),
            cashInTotal: formatMoney(cashInUnits),
            cashOutTotal: formatMoney(cashOutUnits),
            expectedCash: formatMoney(expectedUnits),
            createdBy: context.actorId,
            operationalSummary,
          });
          // Same audit/outbox pattern every other mutation in this module
          // already uses (`auditAndPublish`) — never a second, separate
          // audit database/table.
          await this.repository.auditAndPublish(client, context, {
            action: 'cash_session.partial_closed',
            resourceType: 'cash_session_partial_close',
            resourceId: created.id,
            eventType: 'cash_session.partial_closed',
            branchId: created.branchId,
            version: 1n,
            payload: {
              partial_close_id: created.id,
              cash_session_id: created.cashSessionId,
              taken_at: created.takenAt.toISOString(),
              opening_amount: created.openingAmount,
              cash_sales_total: created.cashSalesTotal,
              cash_in_total: created.cashInTotal,
              cash_out_total: created.cashOutTotal,
              expected_cash: created.expectedCash,
              operational_summary: created.operationalSummary,
            },
          });
          return created;
        },
      ),
    );
  }

  public async partialCloses(
    companyId: string,
    branchIds: readonly string[],
    cashSessionId: string,
  ): Promise<readonly CashSessionPartialCloseRow[]> {
    const sessionRow = await this.session(companyId, branchIds, cashSessionId);
    return this.repository.partialClosesForSession(companyId, sessionRow.id);
  }

  // --- Audit trail ("Bitácora") (TASK 16.11 §13) ----------------------------

  public async auditLog(
    companyId: string,
    branchIds: readonly string[],
    cashSessionId: string,
    limit: number,
  ): Promise<readonly CashAuditLogEntry[]> {
    const sessionRow = await this.session(companyId, branchIds, cashSessionId);
    return this.repository.auditLogForSession(companyId, sessionRow.id, limit);
  }
}

function decodeRegister(raw: unknown): CashRegisterRow {
  const value = raw as Omit<CashRegisterRow, 'version' | 'createdAt' | 'updatedAt' | 'deletedAt'> & {
    version: string;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
  };
  return {
    ...value,
    version: BigInt(value.version),
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
    deletedAt: value.deletedAt === null ? null : new Date(value.deletedAt),
  };
}
function decodeSession(raw: unknown): CashSessionRow {
  const value = raw as Omit<CashSessionRow, 'version' | 'createdAt' | 'updatedAt' | 'openedAt' | 'closedAt'> & {
    version: string;
    createdAt: string;
    updatedAt: string;
    openedAt: string;
    closedAt: string | null;
  };
  return {
    ...value,
    version: BigInt(value.version),
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
    openedAt: new Date(value.openedAt),
    closedAt: value.closedAt === null ? null : new Date(value.closedAt),
  };
}
function decodeMovement(raw: unknown): CashMovementRow {
  const value = raw as Omit<CashMovementRow, 'createdAt' | 'occurredAt'> & { createdAt: string; occurredAt: string };
  return { ...value, createdAt: new Date(value.createdAt), occurredAt: new Date(value.occurredAt) };
}
function decodePartialClose(raw: unknown): CashSessionPartialCloseRow {
  const value = raw as Omit<CashSessionPartialCloseRow, 'createdAt' | 'takenAt'> & {
    createdAt: string;
    takenAt: string;
  };
  return { ...value, createdAt: new Date(value.createdAt), takenAt: new Date(value.takenAt) };
}
