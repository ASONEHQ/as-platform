import { describe, expect, it } from 'vitest';

import {
  computePayrollLine,
  payrollDayDetail,
  sumDailyFacts,
  sumDayDetails,
  totalsWithAdjustmentNet,
} from './payroll.service.js';
import type { PayrollDailyFactRow } from './people.repository.js';

/**
 * TASK 17.6 (Payroll V2) — pure unit coverage of the calculation core. The
 * integration suite proves the same rules end to end against PostgreSQL; this
 * file pins the per-day extraction so "the sum of the days equals the week"
 * (the invariant that lets the daily detail and the payroll line never
 * disagree) is checked without a database.
 */

function day(overrides: Partial<PayrollDailyFactRow> = {}): PayrollDailyFactRow {
  return {
    workDate: '2026-02-02',
    scheduledStart: '09:00:00',
    scheduledEnd: '17:00:00',
    isDayOff: false,
    firstClockIn: null,
    lastClockOut: null,
    firstClockInMinutes: null,
    lastClockOutMinutes: null,
    ...overrides,
  };
}
function punched(inAt: string, outAt: string, scheduled: Partial<PayrollDailyFactRow> = {}): PayrollDailyFactRow {
  const firstClockIn = new Date(inAt);
  const lastClockOut = new Date(outAt);
  return day({
    firstClockIn,
    lastClockOut,
    firstClockInMinutes: firstClockIn.getUTCHours() * 60 + firstClockIn.getUTCMinutes(),
    lastClockOutMinutes: lastClockOut.getUTCHours() * 60 + lastClockOut.getUTCMinutes(),
    ...scheduled,
  });
}

describe('payrollDayDetail (TASK 17.6)', () => {
  it('computes the exact recovered per-day rules: 10 minute tolerance, overtime past scheduled end, elapsed worked minutes', () => {
    const detail = payrollDayDetail(punched('2026-02-02T09:12:00.000Z', '2026-02-02T17:30:00.000Z'));
    expect(detail).toMatchObject({
      scheduledMinutes: 480,
      workedMinutes: 498,
      lateMinutes: 2, // 12 minutes late - 10 tolerance
      overtimeMinutes: 30,
      firstInMinute: 552,
      lastOutMinute: 1050,
      attendanceState: 'complete',
    });
  });

  it('arriving within the tolerance is not late, and leaving early is never negative overtime', () => {
    const detail = payrollDayDetail(punched('2026-02-02T09:10:00.000Z', '2026-02-02T16:00:00.000Z'));
    expect(detail.lateMinutes).toBe(0);
    expect(detail.overtimeMinutes).toBe(0);
    expect(detail.workedMinutes).toBe(410);
  });

  it('classifies what actually happened from the facts only, never inventing an absence', () => {
    expect(payrollDayDetail(day()).attendanceState).toBe('no_punches'); // scheduled, nothing punched
    expect(payrollDayDetail(day({ isDayOff: true, scheduledStart: null, scheduledEnd: null })).attendanceState).toBe('day_off');
    expect(payrollDayDetail(day({ scheduledStart: null, scheduledEnd: null })).attendanceState).toBe('no_schedule');
    expect(
      payrollDayDetail(punched('2026-02-02T09:00:00.000Z', '2026-02-02T17:00:00.000Z', { scheduledStart: null, scheduledEnd: null }))
        .attendanceState,
    ).toBe('unscheduled_work');
    const onlyIn = new Date('2026-02-02T09:00:00.000Z');
    const missingOut = payrollDayDetail(day({ firstClockIn: onlyIn, firstClockInMinutes: 540 }));
    expect(missingOut.attendanceState).toBe('missing_clock_out');
    expect(missingOut.workedMinutes).toBe(0); // an open punch never invents worked time
    const onlyOut = new Date('2026-02-02T17:00:00.000Z');
    expect(payrollDayDetail(day({ lastClockOut: onlyOut, lastClockOutMinutes: 1020 })).attendanceState).toBe('missing_clock_in');
  });

  it('a clock-out that is not after the clock-in is an incomplete day, not worked time', () => {
    const detail = payrollDayDetail(punched('2026-02-02T18:00:00.000Z', '2026-02-02T01:00:00.000Z'));
    expect(detail.workedMinutes).toBe(0);
    expect(detail.attendanceState).toBe('missing_clock_out');
  });

  it('the week total is exactly the sum of the days (the daily detail can never disagree with the payroll line)', () => {
    const days = [
      punched('2026-02-02T09:12:00.000Z', '2026-02-02T17:30:00.000Z'),
      day({ workDate: '2026-02-03', isDayOff: true, scheduledStart: null, scheduledEnd: null }),
      day({ workDate: '2026-02-04' }),
      punched('2026-02-05T09:30:00.000Z', '2026-02-05T17:00:00.000Z', { workDate: '2026-02-05' }),
    ];
    const weekly = sumDailyFacts(days);
    expect(weekly).toEqual(sumDayDetails(days.map(payrollDayDetail)));
    expect(weekly).toEqual({ scheduledMinutes: 3 * 480, workedMinutes: 498 + 450, lateMinutes: 2 + 20, overtimeMinutes: 30 });
  });
});

describe('computePayrollLine + adjustments (TASK 17.6)', () => {
  const totals = { scheduledMinutes: 480, workedMinutes: 498, lateMinutes: 2, overtimeMinutes: 30 };

  it('keeps the exact hand-computed formula untouched when there are no adjustments', () => {
    expect(computePayrollLine(totals, '700.0000', 'MXN')).toEqual({
      baseSalarySnapshot: '700.0000',
      deductionAmount: '2.9167',
      bonusAmount: '43.7500',
      adjustmentAmount: '0.0000',
      totalAmount: '740.8333',
      currencyCode: 'MXN',
    });
  });

  it('adds the signed adjustment net on top of the formula result', () => {
    const withBonus = computePayrollLine(totals, '700.0000', 'MXN', 1_500_000n); // +150.0000
    expect(withBonus.adjustmentAmount).toBe('150.0000');
    expect(withBonus.totalAmount).toBe('890.8333');
    const withDeduction = computePayrollLine(totals, '700.0000', 'MXN', -500_000n); // -50.0000
    expect(withDeduction.adjustmentAmount).toBe('-50.0000');
    expect(withDeduction.totalAmount).toBe('690.8333');
  });

  it('never lets a total go negative (DB check) even with a huge deduction', () => {
    expect(computePayrollLine(totals, '700.0000', 'MXN', -99_999_999n).totalAmount).toBe('0.0000');
  });

  it('re-derives a total from the line\'s OWN stored columns (never from live employee data)', () => {
    const stored = { baseSalarySnapshot: '700.0000', deductionAmount: '2.9167', bonusAmount: '43.7500' };
    expect(totalsWithAdjustmentNet(stored, '149.5000')).toEqual({ adjustmentAmount: '149.5000', totalAmount: '890.3333' });
    expect(totalsWithAdjustmentNet(stored, '-50.5000')).toEqual({ adjustmentAmount: '-50.5000', totalAmount: '690.3333' });
    expect(totalsWithAdjustmentNet(stored, '0')).toEqual({ adjustmentAmount: '0.0000', totalAmount: '740.8333' });
  });
});
