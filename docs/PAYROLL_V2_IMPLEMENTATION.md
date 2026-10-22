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
- Holiday / rest-day multipliers, and any overtime premium (a closed decision: none).
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

## 4. Calculation rules (business decisions closed in TASK 17.6.1)

### Late tolerance — 10 minutes (official policy)

- One authoritative definition: `PAYROLL_LATE_TOLERANCE_MINUTES = 10` in
  `payroll.service.ts`. Nothing else re-implements it; the API returns
  `late_minutes` and Flutter only displays it.
- Semantics: `late = max(0, clock_in − scheduled_start − 10)` (the tolerance is
  *subtracted*; the first minutes are forgiven, they are not a cliff). With a
  09:00 start: 09:00 / 09:09 / **09:10 → 0 late minutes**; **09:11 → 1**;
  09:12 → 2; 09:20 → 10. Arriving early is never negative.
- Not tenant-configurable. Overnight shifts are **not supported**: a schedule
  must end after it starts (API validation and the `employee_schedules_range_ck`
  CHECK), so the day-bucketing never has to split a shift across midnight.
- A missing punch is **never** read as "on time": the day is flagged
  (`missing_clock_in`, `missing_clock_out`, `no_punches`) and worked minutes stay
  0 — the manager decides, e.g. with an explicit adjustment.

### Overtime — information, not money

- Overtime minutes (clock-out past the scheduled end) are calculated and shown as
  attendance information ("Extra" / "Tiempo extra (solo asistencia)").
- **No automatic monetary premium.** `bonus_amount` is 0 for every calculation
  made since TASK 17.6.1; nothing is multiplied (no 1.5×, 2× or hourly
  equivalent) and no labor-law formula is applied. Extra pay enters a payroll
  only through an explicit manual **adjustment** (with reason and audit trail).
- The column `bonus_amount` and the Flutter model are kept so a period calculated
  *before* this decision still shows what it paid. Such a period is labeled
  "Pago por tiempo extra (cálculo anterior)"; it is never recalculated unless it
  is still a draft, and recalculating a draft drops the old automatic overtime
  pay (that is the new policy). The UI, the weekly PDF and the receipt state:
  "Las horas extra se muestran como información de asistencia. No generan un pago
  automático."

### The rest of the formula (unchanged)

- Days are bucketed in the **branch timezone**; the first `clock_in` and the
  last `clock_out` of the local day are used; worked minutes are the elapsed time
  between them.
- `deduction = late_minutes × weekly_salary / scheduled_minutes`, in fixed-point
  `BigInt` (scale 10 000), rounded half up.
- `total = max(0, base − deduction + adjustment_net)`.
- The period totals are the sum of the per-day facts and the line figures; the
  Flutter client performs **no** money arithmetic.

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

- `payroll.service.test.ts` — 22 unit tests (day facts, rounding, clamping,
  adjustment folding, totals, the late-tolerance boundaries 09:00/09:09/09:10/09:11/09:20,
  and "overtime never adds money").
- `payroll-v2.integration.test.ts` — 19 integration tests on Postgres
  (late tolerance end to end, overtime-is-information, overnight shifts rejected,
  calculation, daily detail, adjustments incl. void, recalculation keeps
  adjustments, close/reopen rules, frozen snapshot, scope, permissions).
- `payroll.integration.test.ts` updated for the reason-bearing reopen.
- Flutter: `payroll_html_test.dart`, `pos_payroll_gateway_test.dart`,
  `pos_people_test.dart` (Nómina group, incl. 1440 / 1365 / 1024 / 390 widths).

## 8. Open business decisions

Closed in TASK 17.6.1 (no longer open): **late tolerance = 10 minutes**, **no
automatic overtime premium**.


1. **Missing punches.** A day with a missing clock-out counts zero worked
   minutes and is flagged for the manager to fix with a manual adjustment.
   Confirm whether a punch-correction workflow is wanted instead.
2. **Holidays / rest days / vacations / sick leave** are not modeled.
3. **Salary scheme** beyond a flat weekly amount (hourly, per-day, mixed).
4. **Legal deductions** (taxes, social security) and who owns that calculation.
5. **Payroll payment** (cash out of the drawer, transfer, receipt signature)
   and its accounting.
6. **Retention** of daily-detail rows for old periods.
7. **Multi-currency** payroll: totals are per currency, but employees are
   assumed to be paid in the company currency.
8. **Pre-0050 periods** have no snapshot or daily detail; they can be
    recalculated while draft, but closed ones stay as they were.
