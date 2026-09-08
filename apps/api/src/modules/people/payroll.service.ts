import { randomUUID } from 'node:crypto';

import type { PayrollDailyFactRow, PeopleRepository } from './people.repository.js';
import { parseTimeToMinutes } from './schedules.service.js';
import {
  PeopleError,
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
 * Steps 1-5 of the recovered formula (see `people.repository.ts`'s
 * `payrollDailyFacts` doc comment for how the per-day facts themselves —
 * local-day bucketing, minutes-since-local-midnight — are computed).
 * Exported for direct unit-style exercise from the integration test
 * alongside the full HTTP round trip.
 */
export function sumDailyFacts(days: readonly PayrollDailyFactRow[]): DailyTotals {
  let scheduledMinutes = 0;
  let workedMinutes = 0;
  let lateMinutes = 0;
  let overtimeMinutes = 0;
  for (const day of days) {
    const scheduledStartMinutes = day.scheduledStart === null ? null : parseTimeToMinutes(day.scheduledStart);
    const scheduledEndMinutes = day.scheduledEnd === null ? null : parseTimeToMinutes(day.scheduledEnd);

    // Step 1 — scheduled minutes for the day (0 if a day off or no schedule row).
    if (!day.isDayOff && scheduledStartMinutes !== null && scheduledEndMinutes !== null)
      scheduledMinutes += scheduledEndMinutes - scheduledStartMinutes;

    // Step 2 — worked minutes: first clock_in to last clock_out, real
    // elapsed-instant duration (timezone-agnostic by construction).
    if (day.firstClockIn !== null && day.lastClockOut !== null && day.lastClockOut > day.firstClockIn)
      workedMinutes += Math.round((day.lastClockOut.getTime() - day.firstClockIn.getTime()) / 60_000);

    // Step 3 — late minutes: actual clock-in vs. scheduled start, minus
    // the recovered 10-minute tolerance, floored at 0.
    if (scheduledStartMinutes !== null && day.firstClockInMinutes !== null)
      lateMinutes += Math.max(0, day.firstClockInMinutes - scheduledStartMinutes - TOLERANCIA_RETARDO_MIN);

    // Step 4 — overtime minutes: actual clock-out vs. scheduled end, floored at 0.
    if (scheduledEndMinutes !== null && day.lastClockOutMinutes !== null)
      overtimeMinutes += Math.max(0, day.lastClockOutMinutes - scheduledEndMinutes);
  }
  return { scheduledMinutes, workedMinutes, lateMinutes, overtimeMinutes };
}

/** Steps 6-8: freezes `baseSalarySnapshot` from the employee's CURRENT
 * `weeklySalary` and computes `deductionAmount`/`bonusAmount`/
 * `totalAmount` with exact bigint arithmetic. `totalAmount` is clamped
 * at 0 (never negative, per the DB's own
 * `payroll_period_lines_total_nonnegative_ck`) — DOCUMENTED DECISION:
 * in every realistic scenario `deductionAmount <= baseSalarySnapshot`
 * (late minutes cannot exceed scheduled minutes by more than a small,
 * bounded margin), so the clamp is a defensive backstop against extreme
 * inputs, never an expected code path. */
export function computePayrollLine(
  totals: DailyTotals,
  weeklySalary: string,
  currencyCode: string,
): { baseSalarySnapshot: string; deductionAmount: string; bonusAmount: string; totalAmount: string; currencyCode: string } {
  const baseUnits = moneyUnits(weeklySalary, 'weekly_salary');
  let deductionUnits = 0n;
  let bonusUnits = 0n;
  if (totals.scheduledMinutes > 0) {
    const scheduled = BigInt(totals.scheduledMinutes);
    deductionUnits = roundHalfUp(BigInt(totals.lateMinutes) * baseUnits, scheduled);
    bonusUnits = roundHalfUp(BigInt(totals.overtimeMinutes) * baseUnits, scheduled);
  }
  let totalUnits = baseUnits - deductionUnits + bonusUnits;
  if (totalUnits < 0n) totalUnits = 0n;
  return {
    baseSalarySnapshot: formatMoney(baseUnits),
    deductionAmount: formatMoney(deductionUnits),
    bonusAmount: formatMoney(bonusUnits),
    totalAmount: formatMoney(totalUnits),
    currencyCode,
  };
}

const PERIOD_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * TASK 14.4 — Nómina (payroll). Ports `calcularNominaEmpleado`
 * (`AS POS V1.html` line ~13008) faithfully — see `sumDailyFacts`/
 * `computePayrollLine` above for the step-by-step port and every
 * documented adaptation (fixed-point arithmetic, branch-timezone-aware
 * local-day bucketing — never a formula change).
 *
 * DESIGN DECISION — inactive employees at calculation time: a NEW
 * `calculate` only considers employees currently `status='active'` in
 * the period's branch (mirrors `activeEmployeesForBranch`) — an
 * employee deactivated before a period is ever calculated has no
 * business appearing in a fresh payroll run. This does NOT touch an
 * ALREADY-FROZEN line for someone later deactivated — `calculate` only
 * ever runs against a still-`draft` period (a `closed` period's lines
 * are permanently immutable, enforced below), so a line computed while
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
        (raw) => {
          const value = raw as Omit<PayrollPeriodRow, 'closedAt' | 'createdAt' | 'updatedAt'> & {
            closedAt: string | null;
            createdAt: string;
            updatedAt: string;
          };
          return {
            ...value,
            closedAt: value.closedAt === null ? null : new Date(value.closedAt),
            createdAt: new Date(value.createdAt),
            updatedAt: new Date(value.updatedAt),
          };
        },
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

  /** Idempotent/re-runnable while `draft` (recalculating REPLACES the
   * period's lines wholesale — nothing is frozen yet); rejected outright
   * once `closed` (`payroll_period_closed`). */
  public async calculate(
    context: PeopleMutationContext,
    branchIds: readonly string[],
    key: string,
    id: string,
  ): Promise<{ value: { period: PayrollPeriodRow; lines: PayrollPeriodLineRow[] }; replayed: boolean }> {
    const period = await this.repository.payrollPeriod(context.companyId, branchIds, id);
    if (period === null) throw new PeopleError('resource_not_found', 'The payroll period was not found.');
    if (period.status === 'closed')
      throw new PeopleError('payroll_period_closed', 'A closed payroll period can never be recalculated.');
    const timezone = await this.repository.branchTimezone(context.companyId, period.branchId);
    if (timezone === null) throw new PeopleError('resource_not_found', 'The branch was not found.');
    const employees = await this.repository.activeEmployeesForBranch(context.companyId, period.branchId);

    const requestHash = JSON.stringify({ id, employeeCount: employees.length });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'payroll_period.calculate',
        key,
        requestHash,
        'payroll_period',
        (raw) => raw as { period: PayrollPeriodRow; lines: PayrollPeriodLineRow[] },
        async () => {
          const computedLines: Parameters<PeopleRepository['replacePayrollPeriodLines']>[3][number][] = [];
          for (const emp of employees) {
            const days = await this.repository.payrollDailyFacts(
              context.companyId,
              emp.id,
              period.periodStart,
              period.periodEnd,
              timezone,
            );
            const totals = sumDailyFacts(days);
            const computed = computePayrollLine(totals, emp.weeklySalary, emp.currencyCode);
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
            });
          }
          const lines = await this.repository.replacePayrollPeriodLines(client, context.companyId, id, computedLines);
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

  public async close(
    context: PeopleMutationContext,
    branchIds: readonly string[],
    key: string,
    id: string,
  ): Promise<{ value: PayrollPeriodRow; replayed: boolean }> {
    return this.transitionStatus(context, branchIds, key, id, true);
  }

  public async reopen(
    context: PeopleMutationContext,
    branchIds: readonly string[],
    key: string,
    id: string,
  ): Promise<{ value: PayrollPeriodRow; replayed: boolean }> {
    return this.transitionStatus(context, branchIds, key, id, false);
  }

  private async transitionStatus(
    context: PeopleMutationContext,
    branchIds: readonly string[],
    key: string,
    id: string,
    close: boolean,
  ): Promise<{ value: PayrollPeriodRow; replayed: boolean }> {
    const current = await this.repository.payrollPeriod(context.companyId, branchIds, id);
    if (current === null) throw new PeopleError('resource_not_found', 'The payroll period was not found.');
    const requestHash = JSON.stringify({ id, close });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        close ? 'payroll_period.close' : 'payroll_period.reopen',
        key,
        requestHash,
        'payroll_period',
        (raw) => {
          const value = raw as Omit<PayrollPeriodRow, 'closedAt' | 'createdAt' | 'updatedAt'> & {
            closedAt: string | null;
            createdAt: string;
            updatedAt: string;
          };
          return {
            ...value,
            closedAt: value.closedAt === null ? null : new Date(value.closedAt),
            createdAt: new Date(value.createdAt),
            updatedAt: new Date(value.updatedAt),
          };
        },
        async () => {
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
          // from an ordinary close (this task's own explicit
          // instruction).
          await this.repository.auditAndPublish(client, context, {
            action: close ? 'payroll_period.closed' : 'payroll_period.reopened',
            resourceType: 'payroll_period',
            resourceId: updated.id,
            eventType: close ? 'payroll_period.closed' : 'payroll_period.reopened',
            branchId: updated.branchId,
            payload: { payroll_period_id: updated.id, status: updated.status },
          });
          return updated;
        },
      ),
    );
  }
}
