import { randomUUID } from 'node:crypto';

import type { PayrollDailyFactRow, PeopleRepository, PeopleTransaction } from './people.repository.js';
import { parseTimeToMinutes } from './schedules.service.js';
import {
  PeopleError,
  payrollAdjustmentKinds,
  type PayrollAdjustmentKind,
  type PayrollAdjustmentRow,
  type PayrollAttendanceState,
  type PayrollLineDayRow,
  type PayrollPeriodLineRow,
  type PayrollPeriodRow,
  type PeopleMutationContext,
} from './people.types.js';

// --- Exact decimal arithmetic (ADR-0001) — this module's own
// self-contained copy of the same scaled-BigInt helpers every other
// module keeps independently (see `purchasing.service.ts`'s identical
// pattern/doc comment) — never floating-point money math anywhere in
// this file. ---
const MONEY_SCALE = 10_000n; // numeric(19,4) — matches employees.weekly_salary/payroll_period_lines.* exactly.

function moneyUnits(value: string, field: string): bigint {
  const match = /^(\d{1,15})(?:\.(\d{1,4}))?$/u.exec(value);
  if (match?.[1] === undefined) throw new PeopleError('validation_error', `${field} is invalid.`);
  return BigInt(match[1]) * MONEY_SCALE + BigInt((match[2] ?? '').padEnd(4, '0'));
}
function formatMoney(units: bigint): string {
  const whole = units / MONEY_SCALE;
  const fraction = (units % MONEY_SCALE).toString().padStart(4, '0');
  return `${whole.toString()}.${fraction}`;
}
/** Signed variants — only the adjustment NET can be negative (a net of
 * deductions); every other payroll figure is non-negative by DB check. */
function signedMoneyUnits(value: string, field: string): bigint {
  return value.startsWith('-') ? -moneyUnits(value.slice(1), field) : moneyUnits(value, field);
}
function formatSignedMoney(units: bigint): string {
  return units < 0n ? `-${formatMoney(-units)}` : formatMoney(units);
}
/** Round-half-up on a single bigint multiply-then-divide — computed ONCE
 * per figure (never an intermediate per-minute rate rounded separately
 * first). This is a DELIBERATE, documented improvement over the legacy's
 * own floating-point double-rounding (per this task's own explicit
 * instruction) — never a formula change: the legacy's
 * `tarifaMin = pagoSemanal / horasProgramadas` intermediate rate, then
 * `tarifaMin * minutosRetardo`, is mathematically the same ratio as
 * `(minutosRetardo * pagoSemanal) / horasProgramadas`, just computed
 * without JS float rounding twice. */
function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/**
 * The exact recovered legacy tolerance constant
 * (`TOLERANCIA_RETARDO_MIN = 10` in `AS POS V1.html`'s
 * `calcularNominaEmpleado`, line ~13008) — a global constant in the
 * legacy source, NOT tenant-configurable (no evidence the legacy ever
 * varied it), so it is hardcoded here rather than exposed as a setting.
 */
const TOLERANCIA_RETARDO_MIN = 10;

interface DailyTotals {
  scheduledMinutes: number;
  workedMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;
}

/**
 * Steps 1-4 of the recovered formula for ONE local day (see
 * `people.repository.ts`'s `payrollDailyFacts` doc comment for how the
 * per-day facts themselves — local-day bucketing, minutes-since-local-
 * midnight — are computed). TASK 17.6 extracted this from the old
 * all-days loop WITHOUT changing a single rule so the same numbers can be
 * shown per day (employee detail) and summed per week (the payroll line);
 * `sumDailyFacts` below is literally the sum of these, so the two can never
 * drift apart. Also classifies what actually happened that day
 * (`attendanceState`) strictly from the facts — never an inferred "absence".
 */
export function payrollDayDetail(day: PayrollDailyFactRow): PayrollLineDayRow {
  const scheduledStartMinutes = day.scheduledStart === null ? null : parseTimeToMinutes(day.scheduledStart);
  const scheduledEndMinutes = day.scheduledEnd === null ? null : parseTimeToMinutes(day.scheduledEnd);
  const scheduled = !day.isDayOff && scheduledStartMinutes !== null && scheduledEndMinutes !== null;

  // Step 1 — scheduled minutes for the day (0 if a day off or no schedule row).
  const scheduledMinutes = scheduled ? scheduledEndMinutes - scheduledStartMinutes : 0;

  // Step 2 — worked minutes: first clock_in to last clock_out, real
  // elapsed-instant duration (timezone-agnostic by construction).
  const { firstClockIn, lastClockOut } = day;
  const validPair = firstClockIn !== null && lastClockOut !== null && lastClockOut > firstClockIn;
  const workedMinutes = validPair ? Math.round((lastClockOut.getTime() - firstClockIn.getTime()) / 60_000) : 0;

  // Step 3 — late minutes: actual clock-in vs. scheduled start, minus the
  // recovered 10-minute tolerance, floored at 0.
  const lateMinutes =
    scheduledStartMinutes !== null && day.firstClockInMinutes !== null
      ? Math.max(0, day.firstClockInMinutes - scheduledStartMinutes - TOLERANCIA_RETARDO_MIN)
      : 0;

  // Step 4 — overtime minutes: actual clock-out vs. scheduled end, floored at 0.
  const overtimeMinutes =
    scheduledEndMinutes !== null && day.lastClockOutMinutes !== null
      ? Math.max(0, day.lastClockOutMinutes - scheduledEndMinutes)
      : 0;

  const hasIn = day.firstClockIn !== null;
  const hasOut = day.lastClockOut !== null;
  let attendanceState: PayrollAttendanceState;
  if (hasIn && hasOut) {
    if (!validPair) attendanceState = 'missing_clock_out';
    else attendanceState = scheduled || day.isDayOff ? 'complete' : 'unscheduled_work';
  } else if (hasIn) attendanceState = 'missing_clock_out';
  else if (hasOut) attendanceState = 'missing_clock_in';
  else if (day.isDayOff) attendanceState = 'day_off';
  else attendanceState = scheduled ? 'no_punches' : 'no_schedule';

  return {
    workDate: day.workDate,
    scheduledStart: day.scheduledStart,
    scheduledEnd: day.scheduledEnd,
    isDayOff: day.isDayOff,
    scheduledMinutes,
    workedMinutes,
    lateMinutes,
    overtimeMinutes,
    firstInMinute: day.firstClockInMinutes,
    lastOutMinute: day.lastClockOutMinutes,
    attendanceState,
  };
}

/** The weekly totals of the per-day facts — see [payrollDayDetail]. Exported
 * for direct unit-style exercise alongside the full HTTP round trip. */
export function sumDailyFacts(days: readonly PayrollDailyFactRow[]): DailyTotals {
  return sumDayDetails(days.map(payrollDayDetail));
}

export function sumDayDetails(days: readonly PayrollLineDayRow[]): DailyTotals {
  const totals: DailyTotals = { scheduledMinutes: 0, workedMinutes: 0, lateMinutes: 0, overtimeMinutes: 0 };
  for (const day of days) {
    totals.scheduledMinutes += day.scheduledMinutes;
    totals.workedMinutes += day.workedMinutes;
    totals.lateMinutes += day.lateMinutes;
    totals.overtimeMinutes += day.overtimeMinutes;
  }
  return totals;
}

/** `total = max(0, base - deduction + bonus + adjustment)` — the single place
 * the clamp lives, shared by calculation and by every adjustment write so the
 * stored total can always be re-derived from the line's own stored columns. */
function lineTotalUnits(baseUnits: bigint, deductionUnits: bigint, bonusUnits: bigint, adjustmentUnits: bigint): bigint {
  const total = baseUnits - deductionUnits + bonusUnits + adjustmentUnits;
  return total < 0n ? 0n : total;
}

/** Steps 6-8: freezes `baseSalarySnapshot` from the employee's CURRENT
 * `weeklySalary` and computes `deductionAmount`/`bonusAmount`/
 * `totalAmount` with exact bigint arithmetic. `totalAmount` is clamped
 * at 0 (never negative, per the DB's own
 * `payroll_period_lines_total_nonnegative_ck`) — DOCUMENTED DECISION:
 * in every realistic scenario `deductionAmount <= baseSalarySnapshot`
 * (late minutes cannot exceed scheduled minutes by more than a small,
 * bounded margin), so the clamp is a defensive backstop against extreme
 * inputs, never an expected code path.
 *
 * TASK 17.6: `adjustmentUnits` is the signed NET of the period's
 * non-voided manual adjustments; it is added on top of the formula result
 * (it never changes the formula itself). */
export function computePayrollLine(
  totals: DailyTotals,
  weeklySalary: string,
  currencyCode: string,
  adjustmentUnits = 0n,
): {
  baseSalarySnapshot: string;
  deductionAmount: string;
  bonusAmount: string;
  adjustmentAmount: string;
  totalAmount: string;
  currencyCode: string;
} {
  const baseUnits = moneyUnits(weeklySalary, 'weekly_salary');
  let deductionUnits = 0n;
  let bonusUnits = 0n;
  if (totals.scheduledMinutes > 0) {
    const scheduled = BigInt(totals.scheduledMinutes);
    deductionUnits = roundHalfUp(BigInt(totals.lateMinutes) * baseUnits, scheduled);
    bonusUnits = roundHalfUp(BigInt(totals.overtimeMinutes) * baseUnits, scheduled);
  }
  return {
    baseSalarySnapshot: formatMoney(baseUnits),
    deductionAmount: formatMoney(deductionUnits),
    bonusAmount: formatMoney(bonusUnits),
    adjustmentAmount: formatSignedMoney(adjustmentUnits),
    totalAmount: formatMoney(lineTotalUnits(baseUnits, deductionUnits, bonusUnits, adjustmentUnits)),
    currencyCode,
  };
}

/** Re-derives a line's total from its OWN stored columns plus a new
 * adjustment net — used when an adjustment is created/voided so the figure
 * never depends on live employee data. */
export function totalsWithAdjustmentNet(
  line: Pick<PayrollPeriodLineRow, 'baseSalarySnapshot' | 'deductionAmount' | 'bonusAmount'>,
  adjustmentNet: string,
): { adjustmentAmount: string; totalAmount: string } {
  const adjustmentUnits = signedMoneyUnits(adjustmentNet, 'adjustment_net');
  return {
    adjustmentAmount: formatSignedMoney(adjustmentUnits),
    totalAmount: formatMoney(
      lineTotalUnits(
        moneyUnits(line.baseSalarySnapshot, 'base_salary_snapshot'),
        moneyUnits(line.deductionAmount, 'deduction_amount'),
        moneyUnits(line.bonusAmount, 'bonus_amount'),
        adjustmentUnits,
      ),
    ),
  };
}

/** Server-side column totals for a period, grouped by currency (a period has no
 * single currency: each employee carries their own). The client only ever
 * DISPLAYS these — it never adds payroll money itself. */
export interface PayrollCurrencyTotals {
  currencyCode: string;
  employeeCount: number;
  baseSalary: string;
  deduction: string;
  bonus: string;
  adjustment: string;
  total: string;
}

export function payrollTotals(lines: readonly PayrollPeriodLineRow[]): PayrollCurrencyTotals[] {
  const byCurrency = new Map<
    string,
    { count: number; base: bigint; deduction: bigint; bonus: bigint; adjustment: bigint; total: bigint }
  >();
  for (const line of lines) {
    const acc = byCurrency.get(line.currencyCode) ?? {
      count: 0,
      base: 0n,
      deduction: 0n,
      bonus: 0n,
      adjustment: 0n,
      total: 0n,
    };
    acc.count += 1;
    acc.base += moneyUnits(line.baseSalarySnapshot, 'base_salary_snapshot');
    acc.deduction += moneyUnits(line.deductionAmount, 'deduction_amount');
    acc.bonus += moneyUnits(line.bonusAmount, 'bonus_amount');
    acc.adjustment += signedMoneyUnits(line.adjustmentAmount, 'adjustment_amount');
    acc.total += moneyUnits(line.totalAmount, 'total_amount');
    byCurrency.set(line.currencyCode, acc);
  }
  return [...byCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currencyCode, acc]) => ({
      currencyCode,
      employeeCount: acc.count,
      baseSalary: formatMoney(acc.base),
      deduction: formatMoney(acc.deduction),
      bonus: formatMoney(acc.bonus),
      adjustment: formatSignedMoney(acc.adjustment),
      total: formatMoney(acc.total),
    }));
}

const PERIOD_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

type PeriodDecoded = Omit<PayrollPeriodRow, 'closedAt' | 'createdAt' | 'updatedAt'> & {
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
/** Idempotent replays come back as stored JSON, where every `Date` is an ISO
 * string — revived here so a replayed response is byte-identical to the
 * original (the routes call `.toISOString()` on these). */
function decodePeriod(raw: unknown): PayrollPeriodRow {
  const value = raw as PeriodDecoded;
  return {
    ...value,
    closedAt: value.closedAt === null ? null : new Date(value.closedAt),
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
  };
}
function decodeLine(raw: unknown): PayrollPeriodLineRow {
  const value = raw as Omit<PayrollPeriodLineRow, 'computedAt'> & { computedAt: string };
  return { ...value, computedAt: new Date(value.computedAt) };
}
function decodeAdjustment(raw: unknown): PayrollAdjustmentRow {
  const value = raw as Omit<PayrollAdjustmentRow, 'createdAt' | 'voidedAt'> & {
    createdAt: string;
    voidedAt: string | null;
  };
  return {
    ...value,
    createdAt: new Date(value.createdAt),
    voidedAt: value.voidedAt === null ? null : new Date(value.voidedAt),
  };
}

const REASON_MIN = 3;
const REASON_MAX = 500;
function cleanReason(raw: string, field: string): string {
  const reason = raw.trim();
  if (reason.length < REASON_MIN || reason.length > REASON_MAX)
    throw new PeopleError('validation_error', `${field} must be between ${String(REASON_MIN)} and ${String(REASON_MAX)} characters.`);
  return reason;
}

export interface PayrollEmployeeDetail {
  period: PayrollPeriodRow;
  line: PayrollPeriodLineRow;
  days: PayrollLineDayRow[];
  adjustments: PayrollAdjustmentRow[];
}

/**
 * TASK 14.4 — Nómina (payroll). Ports `calcularNominaEmpleado`
 * (`AS POS V1.html` line ~13008) faithfully — see `payrollDayDetail`/
 * `computePayrollLine` above for the step-by-step port and every
 * documented adaptation (fixed-point arithmetic, branch-timezone-aware
 * local-day bucketing — never a formula change).
 *
 * TASK 17.6 (Payroll V2) — adds, WITHOUT touching those rules: a frozen
 * per-day breakdown written with the lines, employee identity snapshots,
 * manual auditable adjustments (create/void — never deleted) that survive
 * recalculation, row-locked mutations (no calculate-vs-close race), a close
 * that refuses an empty payroll, and a reopen that demands a reason. See
 * `docs/PAYROLL_V2_IMPLEMENTATION.md` for the decisions deliberately left
 * open (permanent finalization, mid-week hires, overnight shifts).
 *
 * DESIGN DECISION — inactive employees at calculation time: a NEW
 * `calculate` only considers employees currently `status='active'` in
 * the period's branch (mirrors `activeEmployeesForBranch`) — an
 * employee deactivated before a period is ever calculated has no
 * business appearing in a fresh payroll run. This does NOT touch an
 * ALREADY-FROZEN line for someone later deactivated — `calculate` only
 * ever runs against a still-`draft` period, so a line computed while
 * someone was active is never retroactively removed just because they
 * were deactivated afterward.
 */
export class PayrollService {
  public constructor(private readonly repository: PeopleRepository) {}

  public async createPeriod(
    context: PeopleMutationContext,
    branchIds: readonly string[],
    key: string,
    input: { branchId: string; periodStart: string; periodEnd: string },
  ): Promise<{ value: PayrollPeriodRow; replayed: boolean }> {
    if (!branchIds.includes(input.branchId)) throw new PeopleError('resource_not_found', 'The branch was not found.');
    if (!PERIOD_DATE_PATTERN.test(input.periodStart) || !PERIOD_DATE_PATTERN.test(input.periodEnd))
      throw new PeopleError('validation_error', 'period_start/period_end must be YYYY-MM-DD dates.');
    if (input.periodEnd < input.periodStart)
      throw new PeopleError('validation_error', 'period_end must not be before period_start.');

    const id = randomUUID();
    const requestHash = JSON.stringify({ branchId: input.branchId, periodStart: input.periodStart, periodEnd: input.periodEnd });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'payroll_period.create',
        key,
        requestHash,
        'payroll_period',
        decodePeriod,
        async () => {
          const row = await this.repository.insertPayrollPeriod(client, {
            id,
            companyId: context.companyId,
            branchId: input.branchId,
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
            createdBy: context.actorId,
            timestamp: context.timestamp,
          });
          await this.repository.auditAndPublish(client, context, {
            action: 'payroll_period.created',
            resourceType: 'payroll_period',
            resourceId: row.id,
            eventType: 'payroll_period.created',
            branchId: row.branchId,
            payload: { payroll_period_id: row.id, branch_id: row.branchId, period_start: row.periodStart, period_end: row.periodEnd },
          });
          return row;
        },
      ),
    );
  }

  public async period(
    companyId: string,
    branchIds: readonly string[],
    id: string,
  ): Promise<{ period: PayrollPeriodRow; lines: PayrollPeriodLineRow[] }> {
    const value = await this.repository.payrollPeriod(companyId, branchIds, id);
    if (value === null) throw new PeopleError('resource_not_found', 'The payroll period was not found.');
    const lines = await this.repository.payrollPeriodLines(companyId, id);
    return { period: value, lines };
  }

  public listPeriods(
    companyId: string,
    branchIds: readonly string[],
    input: { branchId?: string; status?: string; limit: number },
  ): Promise<PayrollPeriodRow[]> {
    return this.repository.listPayrollPeriods(companyId, branchIds, input);
  }

  /** One employee's week: the frozen line, its frozen per-day breakdown and
   * the adjustments (including voided ones — the audit trail stays visible).
   * Everything comes from what the last `calculate` wrote; nothing is
   * recomputed from live schedules/punches, so a closed period's detail can
   * never silently disagree with its frozen total. */
  public async employeeDetail(
    companyId: string,
    branchIds: readonly string[],
    periodId: string,
    employeeId: string,
  ): Promise<PayrollEmployeeDetail> {
    const period = await this.repository.payrollPeriod(companyId, branchIds, periodId);
    if (period === null) throw new PeopleError('resource_not_found', 'The payroll period was not found.');
    const line = await this.repository.payrollLine(companyId, periodId, employeeId);
    if (line === null)
      throw new PeopleError('resource_not_found', 'The employee has no payroll line in this period.');
    const [days, adjustments] = await Promise.all([
      this.repository.payrollLineDays(companyId, periodId, employeeId),
      this.repository.payrollAdjustments(companyId, periodId, employeeId),
    ]);
    return { period, line, days, adjustments };
  }

  public async adjustments(
    companyId: string,
    branchIds: readonly string[],
    periodId: string,
  ): Promise<PayrollAdjustmentRow[]> {
    const period = await this.repository.payrollPeriod(companyId, branchIds, periodId);
    if (period === null) throw new PeopleError('resource_not_found', 'The payroll period was not found.');
    return this.repository.payrollAdjustments(companyId, periodId);
  }

  /** Idempotent/re-runnable while `draft` (recalculating REPLACES the
   * period's lines and daily detail wholesale — nothing is frozen yet, and
   * manual adjustments, which live in their own table, are folded back in);
   * rejected outright once `closed` (`payroll_period_closed`). The period
   * row is locked for the whole transaction, so it can never interleave with
   * a concurrent close/adjustment. */
  public async calculate(
    context: PeopleMutationContext,
    branchIds: readonly string[],
    key: string,
    id: string,
  ): Promise<{ value: { period: PayrollPeriodRow; lines: PayrollPeriodLineRow[] }; replayed: boolean }> {
    const requestHash = JSON.stringify({ id });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'payroll_period.calculate',
        key,
        requestHash,
        'payroll_period',
        (raw) => {
          const value = raw as { id: string; period: unknown; lines: unknown[] };
          return { id: value.id, period: decodePeriod(value.period), lines: value.lines.map(decodeLine) };
        },
        async () => {
          const period = await this.lockedDraftPeriod(client, context, branchIds, id);
          const timezone = await this.repository.branchTimezone(context.companyId, period.branchId);
          if (timezone === null) throw new PeopleError('resource_not_found', 'The branch was not found.');
          const employees = await this.repository.activeEmployeesForBranch(context.companyId, period.branchId);
          const adjustmentNet = await this.repository.activeAdjustmentNetByEmployee(client, context.companyId, id);

          const computedLines: Parameters<PeopleRepository['replacePayrollPeriodLines']>[3][number][] = [];
          const computedDays: (PayrollLineDayRow & { employeeId: string })[] = [];
          for (const emp of employees) {
            const facts = await this.repository.payrollDailyFacts(
              context.companyId,
              emp.id,
              period.periodStart,
              period.periodEnd,
              timezone,
            );
            const days = facts.map(payrollDayDetail);
            const totals = sumDayDetails(days);
            const computed = computePayrollLine(
              totals,
              emp.weeklySalary,
              emp.currencyCode,
              signedMoneyUnits(adjustmentNet.get(emp.id) ?? '0', 'adjustment_net'),
            );
            computedLines.push({
              employeeId: emp.id,
              scheduledMinutes: totals.scheduledMinutes,
              workedMinutes: totals.workedMinutes,
              lateMinutes: totals.lateMinutes,
              overtimeMinutes: totals.overtimeMinutes,
              baseSalarySnapshot: computed.baseSalarySnapshot,
              deductionAmount: computed.deductionAmount,
              bonusAmount: computed.bonusAmount,
              totalAmount: computed.totalAmount,
              currencyCode: computed.currencyCode,
              computedBy: context.actorId,
              timestamp: context.timestamp,
              adjustmentAmount: computed.adjustmentAmount,
              employeeNameSnapshot: emp.displayName,
              employeeCodeSnapshot: emp.code,
              jobTitleSnapshot: emp.jobTitle,
            });
            for (const day of days) computedDays.push({ ...day, employeeId: emp.id });
          }
          const lines = await this.repository.replacePayrollPeriodLines(client, context.companyId, id, computedLines);
          await this.repository.replacePayrollLineDays(client, context.companyId, id, computedDays);
          await this.repository.auditAndPublish(client, context, {
            action: 'payroll_period.calculated',
            resourceType: 'payroll_period',
            resourceId: id,
            eventType: 'payroll_period.calculated',
            branchId: period.branchId,
            payload: { payroll_period_id: id, employee_count: lines.length },
          });
          return { id, period, lines };
        },
      ),
    ).then(({ value, replayed }) => ({ value: { period: value.period, lines: value.lines }, replayed }));
  }

  /** Locks the period and requires it to be an editable `draft`. */
  private async lockedDraftPeriod(
    client: PeopleTransaction,
    context: PeopleMutationContext,
    branchIds: readonly string[],
    id: string,
  ): Promise<PayrollPeriodRow> {
    const period = await this.repository.lockPayrollPeriod(client, context.companyId, branchIds, id);
    if (period === null) throw new PeopleError('resource_not_found', 'The payroll period was not found.');
    if (period.status === 'closed')
      throw new PeopleError('payroll_period_closed', 'A closed payroll period can not be changed.');
    return period;
  }

  public async createAdjustment(
    context: PeopleMutationContext,
    branchIds: readonly string[],
    key: string,
    periodId: string,
    input: { employeeId: string; kind: string; amount: string; reason: string },
  ): Promise<{ value: PayrollAdjustmentRow & { line: PayrollPeriodLineRow }; replayed: boolean }> {
    if (!payrollAdjustmentKinds.includes(input.kind as PayrollAdjustmentKind))
      throw new PeopleError('validation_error', 'kind must be bonus or deduction.');
    const kind = input.kind as PayrollAdjustmentKind;
    const amountUnits = moneyUnits(input.amount, 'amount');
    if (amountUnits <= 0n) throw new PeopleError('validation_error', 'amount must be greater than zero.');
    const reason = cleanReason(input.reason, 'reason');
    const amount = formatMoney(amountUnits);
    const id = randomUUID();
    const requestHash = JSON.stringify({ periodId, employeeId: input.employeeId, kind, amount, reason });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'payroll_adjustment.create',
        key,
        requestHash,
        'payroll_adjustment',
        (raw) => {
          const value = raw as PayrollAdjustmentRow & { line: unknown };
          return { ...decodeAdjustment(value), line: decodeLine(value.line) };
        },
        async () => {
          const period = await this.lockedDraftPeriod(client, context, branchIds, periodId);
          const line = await this.repository.lockPayrollLine(client, context.companyId, periodId, input.employeeId);
          if (line === null)
            throw new PeopleError(
              'payroll_incomplete',
              'The employee has no payroll line in this period; calculate the period first.',
            );
          const row = await this.repository.insertPayrollAdjustment(client, {
            id,
            companyId: context.companyId,
            branchId: period.branchId,
            payrollPeriodId: periodId,
            employeeId: input.employeeId,
            kind,
            amount,
            currencyCode: line.currencyCode,
            reason,
            createdBy: context.actorId,
            timestamp: context.timestamp,
          });
          const updated = await this.refoldLine(client, context, periodId, line);
          await this.repository.auditAndPublish(client, context, {
            action: 'payroll_adjustment.created',
            resourceType: 'payroll_adjustment',
            resourceId: row.id,
            eventType: 'payroll_adjustment.created',
            branchId: period.branchId,
            payload: {
              payroll_period_id: periodId,
              employee_id: input.employeeId,
              kind,
              amount,
              currency_code: line.currencyCode,
              reason,
            },
          });
          return { ...row, line: updated };
        },
      ),
    );
  }

  public async voidAdjustment(
    context: PeopleMutationContext,
    branchIds: readonly string[],
    key: string,
    periodId: string,
    adjustmentId: string,
    rawReason: string,
  ): Promise<{ value: PayrollAdjustmentRow & { line: PayrollPeriodLineRow }; replayed: boolean }> {
    const reason = cleanReason(rawReason, 'reason');
    const requestHash = JSON.stringify({ periodId, adjustmentId, reason });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'payroll_adjustment.void',
        key,
        requestHash,
        'payroll_adjustment',
        (raw) => {
          const value = raw as PayrollAdjustmentRow & { line: unknown };
          return { ...decodeAdjustment(value), line: decodeLine(value.line) };
        },
        async () => {
          const period = await this.lockedDraftPeriod(client, context, branchIds, periodId);
          const existing = await this.repository.lockPayrollAdjustment(client, context.companyId, periodId, adjustmentId);
          if (existing === null) throw new PeopleError('resource_not_found', 'The payroll adjustment was not found.');
          if (existing.voidedAt !== null)
            throw new PeopleError('resource_conflict', 'The payroll adjustment is already voided.');
          const line = await this.repository.lockPayrollLine(client, context.companyId, periodId, existing.employeeId);
          if (line === null) throw new PeopleError('resource_not_found', 'The payroll line was not found.');
          const row = await this.repository.voidPayrollAdjustment(client, context.companyId, adjustmentId, {
            actorId: context.actorId,
            reason,
            timestamp: context.timestamp,
          });
          const updated = await this.refoldLine(client, context, periodId, line);
          await this.repository.auditAndPublish(client, context, {
            action: 'payroll_adjustment.voided',
            resourceType: 'payroll_adjustment',
            resourceId: row.id,
            eventType: 'payroll_adjustment.voided',
            branchId: period.branchId,
            payload: {
              payroll_period_id: periodId,
              employee_id: existing.employeeId,
              kind: existing.kind,
              amount: existing.amount,
              reason,
            },
          });
          return { ...row, line: updated };
        },
      ),
    );
  }

  /** Re-derives the line's adjustment net/total from its OWN stored columns
   * and the current non-voided adjustments (never from live employee data). */
  private async refoldLine(
    client: PeopleTransaction,
    context: PeopleMutationContext,
    periodId: string,
    line: PayrollPeriodLineRow,
  ): Promise<PayrollPeriodLineRow> {
    const nets = await this.repository.activeAdjustmentNetByEmployee(client, context.companyId, periodId);
    const folded = totalsWithAdjustmentNet(line, nets.get(line.employeeId) ?? '0');
    return this.repository.updatePayrollLineAdjustment(client, context.companyId, line.id, folded);
  }

  public async close(
    context: PeopleMutationContext,
    branchIds: readonly string[],
    key: string,
    id: string,
  ): Promise<{ value: PayrollPeriodRow; replayed: boolean }> {
    return this.transitionStatus(context, branchIds, key, id, true, undefined);
  }

  public async reopen(
    context: PeopleMutationContext,
    branchIds: readonly string[],
    key: string,
    id: string,
    reason: string,
  ): Promise<{ value: PayrollPeriodRow; replayed: boolean }> {
    return this.transitionStatus(context, branchIds, key, id, false, cleanReason(reason, 'reason'));
  }

  private async transitionStatus(
    context: PeopleMutationContext,
    branchIds: readonly string[],
    key: string,
    id: string,
    close: boolean,
    reason: string | undefined,
  ): Promise<{ value: PayrollPeriodRow; replayed: boolean }> {
    const requestHash = JSON.stringify({ id, close, reason: reason ?? null });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        close ? 'payroll_period.close' : 'payroll_period.reopen',
        key,
        requestHash,
        'payroll_period',
        decodePeriod,
        async () => {
          const current = await this.repository.lockPayrollPeriod(client, context.companyId, branchIds, id);
          if (current === null) throw new PeopleError('resource_not_found', 'The payroll period was not found.');
          if (current.status !== (close ? 'draft' : 'closed'))
            throw new PeopleError(
              'resource_conflict',
              close ? 'Only a draft payroll period can be closed.' : 'Only a closed payroll period can be reopened.',
            );
          let summary: { employeeCount: number; totalAmount: string; adjustmentCount: number } | undefined;
          if (close) {
            // Closing freezes what the manager reviewed: the lines (and their
            // per-day detail and adjustment net) written by the last
            // `calculate`/adjustment. An empty payroll has nothing to freeze.
            const lines = await this.repository.payrollPeriodLines(context.companyId, id);
            if (lines.length === 0)
              throw new PeopleError(
                'payroll_incomplete',
                'The payroll period has no calculated lines; calculate it before closing.',
              );
            const total = lines.reduce((sum, line) => sum + moneyUnits(line.totalAmount, 'total_amount'), 0n);
            const adjustmentRows = await this.repository.payrollAdjustments(context.companyId, id);
            summary = {
              employeeCount: lines.length,
              totalAmount: formatMoney(total),
              adjustmentCount: adjustmentRows.filter((row) => row.voidedAt === null).length,
            };
          }
          const updated = await this.repository.setPayrollPeriodStatus(client, context.companyId, id, {
            close,
            actorId: context.actorId,
            timestamp: context.timestamp,
          });
          if (updated === null)
            throw new PeopleError(
              'resource_conflict',
              close ? 'Only a draft payroll period can be closed.' : 'Only a closed payroll period can be reopened.',
            );
          // A reopen is a materially privileged, audited action —
          // deliberately its OWN distinct `action`/`event_type`
          // (`payroll_period.reopened`), never reusing
          // `payroll_period.closed`'s own strings with a flipped flag, so
          // it is unambiguously distinguishable in the audit log/outbox
          // from an ordinary close. TASK 17.6: a reopen now also records WHY.
          await this.repository.auditAndPublish(client, context, {
            action: close ? 'payroll_period.closed' : 'payroll_period.reopened',
            resourceType: 'payroll_period',
            resourceId: updated.id,
            eventType: close ? 'payroll_period.closed' : 'payroll_period.reopened',
            branchId: updated.branchId,
            payload: {
              payroll_period_id: updated.id,
              status: updated.status,
              ...(summary === undefined
                ? {}
                : {
                    employee_count: summary.employeeCount,
                    total_amount: summary.totalAmount,
                    adjustment_count: summary.adjustmentCount,
                  }),
              ...(reason === undefined ? {} : { reason }),
            },
          });
          return updated;
        },
      ),
    );
  }
}
