# Payroll V2 — Implementation (TASK 17.6)

This document records what Payroll V2 **is today** in the code: what existed
before, what changed, the data model, the rules, permissions and scoping, the
integrity guarantees, and the business decisions that are still open. It
supersedes the "gap" findings in `PAYROLL_V2_ARCHITECTURE_GAP.md` (TASK 17.5)
for the items implemented here; anything not listed under *Implemented* is not
implemented.

Commits: `451dc94` (financial model + detail API) and `1fc1f8a` (workspace +
reports), both local to `release/as-pos-v1`, nothing pushed or deployed.

## 1. What existed before

- Weekly payroll periods with a calculation pipeline already real and
  server-authoritative: flat weekly salary snapshot, scheduled minutes from
  `employee_schedules`, worked minutes from `time_clock_punches`, late
  (10-minute tolerance) and overtime minutes, deduction/bonus proportional to
  `minutes × weekly_salary / scheduled_minutes`, total clamped at zero.
- Close / reopen with audit and the `payroll.close` permission.
- A flat per-employee list in Flutter with no daily breakdown, no manual
  adjustments, no printable output and a reopen without a reason.

## 2. What changed

### Implemented

| Capability | Where |
| --- | --- |
| Per-employee **daily detail** (scheduled window, first-in/last-out, scheduled/worked/late/overtime minutes, attendance state) persisted with the calculation | `payroll_period_line_days`, `GET /payroll-periods/:id/employees/:employeeId` |
| **Manual adjustments** (bonus / deduction) with a mandatory reason, created and **voided — never deleted** | `payroll_period_adjustments`, `POST/GET …/adjustments`, `POST …/adjustments/:id/void` |
| Adjustments survive recalculation (the period is recalculated, active adjustments are folded back in) | `PayrollService.calculate` |
| **Frozen snapshot on every line**: employee name, code and job title at calculation time | columns on `payroll_period_lines` |
| **Close refuses an empty payroll** (`payroll_incomplete`, 409) | `PayrollService.close` |
| **Reopen requires a reason** (3–500 chars, written to the audit payload) | `POST …/reopen {reason}` |
| Per-currency **period totals** computed on the server | `totals[]` in period responses |
| Weekly table: Empleado / Programado / Trabajado / Retardo / Extra / Base / Ajuste / Total | Flutter `pos_payroll_workspace.dart` |
| Employee daily-detail dialog with adjustments (add / void) | same |
| **History** of closed periods | list endpoint + workspace |
| **Weekly PDF** and **employee receipt** (HTML rendered by the browser print dialog → "Save as PDF") | `payroll_html.dart` |

### Not implemented (do not read the above as covering these)

- Tax / social-security / legal withholdings, payroll stamping or any
  government filing. Totals are an internal operational figure.
- Hourly or per-day salary schemes. The salary model is still a flat weekly
  amount.
- Holiday / rest-day / overtime-premium multipliers.
- Payment of the payroll (no money movement is created by closing a period).
- Server-generated binary PDF. The PDF is the browser's print-to-PDF of the
  generated HTML.

## 3. Data model (migration `0050_add_payroll_v2_adjustments_and_daily_detail`)

Purely additive: no drop, no backfill, existing rows are untouched.

- `payroll_period_lines` gains `adjustment_amount numeric(19,4) default 0`
  and `employee_name_snapshot`, `employee_code_snapshot`, `job_title_snapshot`
  (nullable). Lines created **before** this migration have no snapshot; the API
  reports `snapshot_available: false` and the UI shows the live name instead of
  inventing a historical one.
- `payroll_period_adjustments`: `kind ∈ {bonus, deduction}`, `amount > 0`,
  `currency_code`, `reason` 3–500 chars, `created_by/at`, and the void trio
  `voided_at / voided_by / void_reason` (all-or-none CHECK). Composite FKs keep
  every row inside its company and branch. Index on
  `(company, period, employee)`.
- `payroll_period_line_days`: one row per employee per local day with
  `work_date`, scheduled start/end, `is_day_off`, the four minute counters,
  `first_in_minute / last_out_minute` (0..1439) and `attendance_state ∈
  {complete, unscheduled_work, missing_clock_out, missing_clock_in, no_punches,
  day_off, no_schedule}`. Unique per `(company, period, employee, work_date)`.

## 4. Calculation rules (unchanged formula, now explicit per day)

- Days are bucketed in the **branch timezone**; the first `clock_in` and the
  last `clock_out` of the local day are used.
- Lateness = minutes after `scheduled_start`, minus the 10-minute tolerance
  (never negative). Overtime = minutes after `scheduled_end`.
- `deduction = late_minutes × weekly_salary / scheduled_minutes` and
  `bonus = overtime_minutes × weekly_salary / scheduled_minutes`, in fixed-point
  `BigInt` (scale 10 000), rounded half up.
- `total = max(0, base − deduction + bonus + adjustment_net)`.
- The period totals are the sum of the per-day facts and the line figures; the
  Flutter client performs **no** money arithmetic.
- A day with a punch problem is **flagged** (`missing_clock_out`,
  `missing_clock_in`, `no_punches`, `unscheduled_work`) — it is shown to the
  manager as such. Nothing is guessed or filled in.

## 5. Permissions and scoping

| Action | Permission |
| --- | --- |
| List / read period, employee detail, adjustments | `payroll.read` |
| Create period, calculate, add / void adjustment | `payroll.manage` |
| Close, reopen | `payroll.close` |

Scope is enforced on the server from the token context (`permittedBranchIds`);
repositories filter by company **and** branch. A period or employee outside the
actor's scope answers 404, never 403, so existence is not leaked. The client
never sends a company or scope it could forge.

## 6. Integrity guarantees

- `calculate`, `createAdjustment`, `voidAdjustment` and `close` take a row lock
  on the period (and the affected line), so concurrent calls cannot interleave.
- Adjustments and calculations are only accepted while the period is **draft**.
  A closed period cannot be changed by live edits; changing an employee's
  salary or name afterwards does not alter it.
- Closing freezes the lines; the snapshot columns freeze identity.
- Every mutation writes `audit_log` (+ outbox event); idempotency keys protect
  create/calculate/adjust/void; replays return the stored result with dates
  revived (a bug found and fixed in this task).
- Voids keep the row, the author, the time and the reason.

## 7. Tests

- `payroll.service.test.ts` — 11 unit tests (day facts, rounding, clamping,
  adjustment folding, totals).
- `payroll-v2.integration.test.ts` — 15 integration tests on Postgres
  (calculation, daily detail, adjustments incl. void, recalculation keeps
  adjustments, close/reopen rules, frozen snapshot, scope, permissions).
- `payroll.integration.test.ts` updated for the reason-bearing reopen.
- Flutter: `payroll_html_test.dart`, `pos_payroll_gateway_test.dart`,
  `pos_people_test.dart` (Nómina group, incl. 1440 / 1365 / 1024 / 390 widths).

## 8. Open business decisions (not decided here)

1. **Late tolerance and rounding.** 10 minutes is recovered from the legacy
   formula; confirm it is the policy, and whether it should be configurable per
   company/branch.
2. **Overtime pay.** Overtime is paid at the straight proportional rate, with no
   premium. Confirm.
3. **Missing punches.** A day with a missing clock-out counts zero worked
   minutes and is flagged for the manager to fix with a manual adjustment.
   Confirm whether a punch-correction workflow is wanted instead.
4. **Holidays / rest days / vacations / sick leave** are not modeled.
5. **Salary scheme** beyond a flat weekly amount (hourly, per-day, mixed).
6. **Legal deductions** (taxes, social security) and who owns that calculation.
7. **Payroll payment** (cash out of the drawer, transfer, receipt signature)
   and its accounting.
8. **Retention** of daily-detail rows for old periods.
9. **Multi-currency** payroll: totals are per currency, but employees are
   assumed to be paid in the company currency.
10. **Pre-0050 periods** have no snapshot or daily detail; they can be
    recalculated while draft, but closed ones stay as they were.
