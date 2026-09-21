import type { CashRepository } from '../cash/cash.repository.js';
import type { CashService } from '../cash/cash.service.js';
import type { CashPaymentMethodTotal, CashSessionRow } from '../cash/cash.types.js';
import type { OperationalAreasRepository } from '../operational-areas/operational-areas.repository.js';
import { isValidIanaTimezone, localDateString, zonedDayBounds } from '../promotions/pricing.service.js';
import { BranchConsolidationError } from './branch-consolidation.types.js';
import type {
  BranchConsolidationAreaGroup,
  BranchConsolidationRegister,
  BranchConsolidationResult,
  BranchConsolidationTotals,
} from './branch-consolidation.types.js';

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
function isNonZero(value: string): boolean {
  return moneyUnits(value) !== 0n;
}

/**
 * TASK 16.15 — "Consolidado de sucursal": a READ-ONLY aggregation across
 * every register in one branch, for a resolved branch-local business
 * date. Never a financial transaction, never written to any ledger, and
 * — this is the load-bearing guarantee — never a second, independent
 * calculation of money already computed elsewhere.
 *
 * **No-double-counting proof.** Every dollar in every total this service
 * returns is read from EXACTLY ONE authoritative per-register source,
 * pulled once, summed once:
 *  - An `open`/`closing` register's figures come from `CashService.
 *    summary()` — the exact same live `cash_movements` fold every other
 *    part of this platform already trusts as the one live cash-truth
 *    computation (TASK 16.14's own `paymentMethodTotals` included).
 *  - A `closed` register's figures come from its own frozen TASK 16.14/
 *    16.14A close columns (`cashSalesTotal`, `expectedClosingAmount`,
 *    `paymentMethodTotals`, `cardReconciliation`, …) — read directly off
 *    the row, NEVER recomputed.
 * This service calls each of those exactly once per register and then
 * does pure arithmetic (`+`) over the results — there is no code path
 * anywhere in this file that both sums `cash_movements` directly AND
 * adds a register's own already-summed total on top, which is the
 * specific double-counting shape §15 forbids. A dedicated integration
 * test (`branch-consolidation.integration.test.ts`) proves this exactly:
 * the branch total equals the sum of the individually-verified register
 * totals, to the last cent, for a real multi-register scenario.
 *
 * Business date resolution reuses `pricing.service.ts`'s own
 * `isValidIanaTimezone`/`localDateString`/`zonedDayBounds` — the same
 * branch-local-timezone foundation TASK 16.13A already established and
 * this task's own `zonedDayBounds` extends — never a second, competing
 * date-window implementation (the Dashboard module's own client-supplied-
 * date/naive-UTC-arithmetic mechanism is deliberately NOT reused here).
 */
export class BranchConsolidationService {
  public constructor(
    private readonly cashRepository: CashRepository,
    private readonly cashService: CashService,
    private readonly operationalAreasRepository: OperationalAreasRepository,
  ) {}

  public async consolidate(
    companyId: string,
    branchIds: readonly string[],
    permittedRegisterIds: readonly string[] | null,
    branchId: string,
    date: string | undefined,
  ): Promise<BranchConsolidationResult> {
    if (!branchIds.includes(branchId))
      throw new BranchConsolidationError('resource_not_found', 'The branch was not found.');
    const timezone = await this.cashRepository.branchTimezone(companyId, branchId);
    if (!isValidIanaTimezone(timezone))
      throw new BranchConsolidationError(
        'validation_error',
        `Branch timezone "${timezone}" is not a valid IANA identifier.`,
      );
    const businessDate = date ?? localDateString(new Date(), timezone);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate))
      throw new BranchConsolidationError('validation_error', 'date must be an ISO date (YYYY-MM-DD).');
    const { start: windowStart, end: windowEnd } = zonedDayBounds(businessDate, timezone);

    const registersPage = await this.cashService.listRegisters(companyId, branchIds, {
      limit: 200,
      branchId,
      status: 'active',
      ...(permittedRegisterIds === null ? {} : { registerIds: permittedRegisterIds }),
    });
    const registers = registersPage.items;
    const registerIds = registers.map((register) => register.id);
    const sessions = await this.cashRepository.sessionsForRegistersInWindow(
      companyId,
      registerIds,
      windowStart,
      windowEnd,
    );
    const sessionByRegisterId = new Map(sessions.map((session) => [session.cashRegisterId, session]));

    const areasPage = await this.operationalAreasRepository.list(companyId, branchIds, { branchId, limit: 200 });
    const areaNameById = new Map(areasPage.items.map((area) => [area.id, area.name]));

    const consolidatedRegisters: BranchConsolidationRegister[] = [];
    for (const register of registers) {
      const session = sessionByRegisterId.get(register.id);
      consolidatedRegisters.push(
        await this.registerContribution(companyId, branchIds, permittedRegisterIds, register, session),
      );
    }

    const areaTotals = new Map<string, { name: string | null; units: bigint; count: number }>();
    for (const register of consolidatedRegisters) {
      const key = register.operationalAreaId ?? '';
      const entry = areaTotals.get(key) ?? {
        name: register.operationalAreaId === null ? null : (areaNameById.get(register.operationalAreaId) ?? null),
        units: 0n,
        count: 0,
      };
      entry.units += moneyUnits(register.cashSalesTotal ?? '0');
      entry.count += 1;
      areaTotals.set(key, entry);
    }
    const areas: BranchConsolidationAreaGroup[] = [...areaTotals.entries()].map(([key, value]) => ({
      operationalAreaId: key === '' ? null : key,
      operationalAreaName: value.name,
      cashSalesTotal: formatMoney(value.units),
      registerCount: value.count,
    }));

    const totals = this.buildTotals(consolidatedRegisters);

    return {
      branchId,
      businessDate,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      registers: consolidatedRegisters,
      areas,
      totals,
    };
  }

  private async registerContribution(
    companyId: string,
    branchIds: readonly string[],
    permittedRegisterIds: readonly string[] | null,
    register: { id: string; code: string; name: string; operationalAreaId: string | null },
    session: CashSessionRow | undefined,
  ): Promise<BranchConsolidationRegister> {
    const base = {
      registerId: register.id,
      registerCode: register.code,
      registerName: register.name,
      operationalAreaId: register.operationalAreaId,
    };
    if (session === undefined) {
      return {
        ...base,
        status: 'no_session',
        cashSessionId: null,
        openedAt: null,
        closedAt: null,
        openingAmount: null,
        cashSalesTotal: null,
        cashInTotal: null,
        cashOutTotal: null,
        expectedCash: null,
        countedCash: null,
        discrepancyAmount: null,
        paymentMethodTotals: [],
        cardReconciliation: null,
      };
    }
    if (session.status === 'closed') {
      return {
        ...base,
        status: 'closed',
        cashSessionId: session.id,
        openedAt: session.openedAt.toISOString(),
        closedAt: session.closedAt?.toISOString() ?? null,
        openingAmount: session.openingAmount,
        cashSalesTotal: session.cashSalesTotal,
        cashInTotal: session.cashInTotal,
        cashOutTotal: session.cashOutTotal,
        expectedCash: session.expectedClosingAmount,
        countedCash: session.declaredClosingAmount,
        discrepancyAmount: session.discrepancyAmount,
        paymentMethodTotals: session.paymentMethodTotals ?? [],
        cardReconciliation: session.cardReconciliation,
      };
    }
    // `open`/`closing` — the cash-truth figures (cashSalesTotal/
    // cashInTotal/cashOutTotal/expectedCash) come from `CashService.
    // summary()`'s own `cash_movements` fold, which is ALREADY genuinely
    // register-scoped (movements are keyed by `cash_session_id`, one
    // session per register — no branch-wide leakage). `paymentMethodTotals`
    // is a DIFFERENT story: `summary()`'s own version of that figure is
    // branch+window scoped by design (TASK 16.13/16.14's original,
    // correct-for-a-single-register point), which would silently double-
    // (or N-times-) count every OTHER register's own card sales in the
    // same window if reused here per-register — so this reads the
    // dedicated register-scoped query instead (`paymentMethodTotalsForRegister`,
    // see its own doc comment for the exact failure mode this avoids).
    const [summary, paymentMethodTotals] = await Promise.all([
      this.cashService.summary(companyId, branchIds, session.id, permittedRegisterIds),
      this.cashRepository.paymentMethodTotalsForRegister(companyId, register.id, session.openedAt, new Date()),
    ]);
    return {
      ...base,
      status: session.status === 'closing' ? 'closing' : 'open',
      cashSessionId: session.id,
      openedAt: session.openedAt.toISOString(),
      closedAt: null,
      openingAmount: summary.openingAmount,
      cashSalesTotal: summary.cashSalesTotal,
      cashInTotal: summary.cashInTotal,
      cashOutTotal: summary.cashOutTotal,
      expectedCash: summary.expectedCash,
      countedCash: null,
      discrepancyAmount: null,
      paymentMethodTotals,
      cardReconciliation: null,
    };
  }

  private buildTotals(registers: readonly BranchConsolidationRegister[]): BranchConsolidationTotals {
    let openingUnits = 0n;
    let cashSalesUnits = 0n;
    let cashInUnits = 0n;
    let cashOutUnits = 0n;
    let expectedUnits = 0n;
    let countedUnits = 0n;
    let differenceUnits = 0n;
    let cardSystemNetUnits = 0n;
    let cardTerminalUnits = 0n;
    let cardDifferenceUnits = 0n;
    let openCount = 0;
    let closingCount = 0;
    let closedCount = 0;
    let noSessionCount = 0;
    let discrepantCount = 0;
    let cardPendingOrDiscrepantCount = 0;
    const paymentMethodUnits = new Map<string, { gross: bigint; refunds: bigint; tickets: number }>();

    for (const register of registers) {
      if (register.status === 'open') openCount += 1;
      else if (register.status === 'closing') closingCount += 1;
      else if (register.status === 'closed') closedCount += 1;
      else noSessionCount += 1;

      if (register.status === 'no_session') continue;
      openingUnits += moneyUnits(register.openingAmount ?? '0');
      cashSalesUnits += moneyUnits(register.cashSalesTotal ?? '0');
      cashInUnits += moneyUnits(register.cashInTotal ?? '0');
      cashOutUnits += moneyUnits(register.cashOutTotal ?? '0');
      expectedUnits += moneyUnits(register.expectedCash ?? '0');
      for (const line of register.paymentMethodTotals) {
        const entry = paymentMethodUnits.get(line.method) ?? { gross: 0n, refunds: 0n, tickets: 0 };
        entry.gross += moneyUnits(line.grossSalesTotal);
        entry.refunds += moneyUnits(line.refundsTotal);
        entry.tickets += line.ticketCount;
        paymentMethodUnits.set(line.method, entry);
        // "System net card" is available the moment a card sale exists —
        // live (via the register's own `summary()` fold) for an open
        // register, frozen (via its own `payment_method_totals`) for a
        // closed one — the SAME single source either way, never a second
        // calculation. `terminalTotal`/`difference`/status below remain
        // close-time-only concepts (a terminal ticket is only ever
        // entered at close), so those stay sourced from
        // `cardReconciliation` exclusively.
        if (line.method === 'card_terminal' || line.method === 'card_manual')
          cardSystemNetUnits += moneyUnits(line.netTotal);
      }

      if (register.status !== 'closed') continue;
      countedUnits += moneyUnits(register.countedCash ?? '0');
      const discrepancy = register.discrepancyAmount ?? '0';
      differenceUnits += moneyUnits(discrepancy);
      if (isNonZero(discrepancy)) discrepantCount += 1;
      const reconciliation = register.cardReconciliation;
      if (reconciliation !== null) {
        cardTerminalUnits += moneyUnits(reconciliation.terminalTotal);
        cardDifferenceUnits += moneyUnits(reconciliation.difference);
        if (reconciliation.status === 'pending' || reconciliation.status === 'discrepancy')
          cardPendingOrDiscrepantCount += 1;
      }
    }

    const paymentMethodTotals: CashPaymentMethodTotal[] = [...paymentMethodUnits.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([method, value]) => ({
        method,
        grossSalesTotal: formatMoney(value.gross),
        refundsTotal: formatMoney(value.refunds),
        netTotal: formatMoney(value.gross - value.refunds),
        ticketCount: value.tickets,
      }));

    return {
      cashOpeningTotal: formatMoney(openingUnits),
      cashSalesTotal: formatMoney(cashSalesUnits),
      cashInTotal: formatMoney(cashInUnits),
      cashOutTotal: formatMoney(cashOutUnits),
      expectedCashTotal: formatMoney(expectedUnits),
      countedCashTotal: formatMoney(countedUnits),
      cashDifferenceTotal: formatMoney(differenceUnits),
      paymentMethodTotals,
      cardSystemNetTotal: formatMoney(cardSystemNetUnits),
      cardTerminalTotal: formatMoney(cardTerminalUnits),
      cardDifferenceTotal: formatMoney(cardDifferenceUnits),
      openRegisterCount: openCount,
      closingRegisterCount: closingCount,
      closedRegisterCount: closedCount,
      noSessionRegisterCount: noSessionCount,
      discrepantRegisterCount: discrepantCount,
      cardPendingOrDiscrepantRegisterCount: cardPendingOrDiscrepantCount,
    };
  }
}
