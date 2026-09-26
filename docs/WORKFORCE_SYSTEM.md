# Workforce System — Employees · Schedules · Attendance · Payroll

TASK 16.28. Administración → Empleados: Plantilla / Horarios / Checador / Nómina.

**Important finding from this task's own audit, stated up front**: this system was NOT built from scratch. All four workspaces already existed, fully backed by real backend modules and a real Postgres schema, before this task started (`apps/api/src/modules/people/`, `packages/database/src/schema/people.ts`, migration `0025_worried_the_captain.sql`, frontend `apps/one/lib/features/pos/pos_people_screen.dart` + `pos_people_gateway.dart`). This task's own job was to audit that existing system against the original product reference, find genuine gaps, and close only those — never to rebuild working, tested code. What follows documents the system as it now stands, including what was already there and what this task added.

## Employee vs. User — a deliberate, enforced separation

`employees` and `users`/`company_memberships` are two separate tables. An employee is a person working in the operation; a user is a login/auth identity. `employees.user_id` is a **nullable, optional** link (composite FK against `company_memberships(company_id, user_id)`, not directly against `users`) — a real employee (kitchen staff, maintenance) can exist with `user_id = null` and never log into AS ONE at all. Nothing in this system collapses the two concepts: Usuarios/Roles/Permisos (authentication/authorization) and Empleados (workforce/HR) remain entirely separate screens, separate gateways, separate permission namespaces.

**Where the link matters**: `TimeClockService`'s self-service authorization (an employee can clock themself in/out with only `attendance.read` if `employees.user_id` matches their own session `userId`; otherwise `attendance.manage` is required). An employee with no linked user can never self-service — only a manager can record their punches. This is intentional, not a gap.

## Data model (already existed; unchanged by this task except one additive column)

All four tables were created together in a single migration (`packages/database/drizzle/0025_worried_the_captain.sql`):

- **`employees`**: id, company_id, branch_id, code, display_name, phone, email, job_title, status (`active`/`inactive`), hire_date, weekly_salary (numeric 19,4), currency_code, user_id (nullable), notes, deactivated_at/by, version, timestamps.
- **`employee_schedules`**: one row per employee per calendar date (not 7 rows/week, not a date range) — employee_id, work_date, scheduled_start/end, is_day_off, notes. Unique on (company_id, employee_id, work_date). A check constraint enforces day-off rows have null start/end while working rows require both, with end > start.
- **`time_clock_punches`**: employee_id, branch_id, punch_type (`clock_in`/`clock_out`), occurred_at, station, **method** (new — see below), is_correction, correction_reason, corrected_punch_id, created_by, created_at.
- **`payroll_periods`** / **`payroll_period_lines`**: a period (draft/closed) with per-employee lines (scheduled/worked/late/overtime minutes, base salary snapshot, deduction/bonus/total amounts, currency).

## What this task added

### 1. `time_clock_punches.method` (new column, migration `0047_stiff_joshua_kane.sql`)

Every punch previously carried only a free-text `station` field — no honest way to say a punch came from a real attendance device versus an ordinary manual entry. This task adds `method text not null default 'manual'`, check-constrained to `('manual', 'device', 'biometric')`.

**Every punch recorded today is, and can only be, `'manual'`** — there is no attendance terminal or fingerprint reader connected (see "Future attendance device integration" below). The column exists now, ahead of any real hardware, precisely so a future device integration is additive, not a breaking change to the attendance/payroll model. `TimeClockService.recordPunch`/`correctPunch` set `method: 'manual'` themselves — it is never accepted from the client request body, so no caller can mislabel a manual entry as automated.

The Checador UI now shows this honestly on every punch row ("Método: Manual" today; "Dispositivo"/"Biométrico" only once a real integration exists and actually reports one of those values).

### 2. Horarios week-quick-navigation

The existing Horarios workspace lets a manager pick one employee and a date range, and edit each day's schedule individually — a real, working, validated UI, just not styled as an all-employees × Mon-Sun matrix. This task added "Semana anterior / Semana actual / Semana siguiente" buttons that jump the same date-range fields to real Monday-Sunday week boundaries, computed from the resolved **business date** (the same `GET /api/v1/context/business-date` primitive `_Dashboard`/Reports already use — never `DateTime.now()`, preserving TASK 16.23B's timezone semantics). The initial date range still shows a provisional device-local guess for one frame, exactly like `_Dashboard`'s own documented pattern, then corrects itself the instant the real business date resolves.

A true employee-rows × weekday-columns matrix view was considered and explicitly **not** built this task — it would be a much larger UI rewrite of an already-working, already-tested screen, and the per-employee day-editor shape already covers the same real capability (define/edit any employee's schedule for any day, validated identically). Documented here as a known, deliberate scope decision, not an oversight.

## Attendance model

An attendance event is a real domain row (`time_clock_punches`), never derived only from UI state. `TimeClockService` is the single, private-then-public service boundary every punch goes through (`recordPunch` → `clockIn`/`clockOut`; `correctPunch` for corrections) — the UI never owns attendance business logic; it only calls this service through the HTTP routes.

**Corrections never mutate history.** A correction is always a NEW row referencing the punch it corrects (`corrected_punch_id`, `is_correction=true`, `correction_reason` required) — the original, possibly-wrong punch is never edited or deleted. Ordinary clock-in/out timestamps are always the server clock at request time (`context.timestamp`); only an authorized correction (`attendance.manage`) can record a different, client-submitted `occurred_at`, because that is precisely what a correction is for.

**Worked-hours calculation** happens server-side, in `PayrollService.sumDailyFacts`, pairing each day's first `clock_in` with its last `clock_out` (via `PeopleRepository.payrollDailyFacts`, a branch-timezone-aware local-day bucketing SQL CTE). An incomplete day (no matching clock-out) contributes zero worked minutes for that day — never a fabricated completed session. This aggregation is payroll-triggered; there is no separate standalone "attendance report" endpoint today.

## Future attendance device integration

**No hardware was implemented or connected this task**, per explicit instruction. What exists is the readiness for one:

- **Adapter boundary**: `TimeClockService.clockIn`/`clockOut`/`correctPunch` already is the clean service boundary a future device adapter would call — the UI (and, when it exists, a device adapter) never touches `people.repository.ts` or the database directly.
- **Event contract** a future device adapter needs to supply (conceptually, matching what `recordPunch` already accepts plus the new `method`):

  | Field | Notes |
  |---|---|
  | employee identifier | must resolve to a real `employees.id` in the acting company/branch scope |
  | branch identifier | derived from the employee's own `branch_id`, not client-supplied |
  | timestamp | for an ordinary punch, always the server clock at processing time; a correction may carry an explicit past timestamp |
  | event type | `clock_in` / `clock_out` |
  | device identifier | maps to the existing free-text `station` field |
  | method/source | the new `method` column — `'device'` or `'biometric'`, never silently defaulted to `'manual'` for a real device punch |
  | idempotency key | the existing `idempotency-key` header mechanism every mutation in this API already uses |

- **What a real integration would need, not built here**: a separate, device-authenticated entry point (its own auth mechanism — a device is not a logged-in user with a session, so it cannot reuse `requireAuthenticatedUser`), which then calls into the same `recordPunch`-style logic with `method` set to whatever the device honestly reports. No vendor SDK, no browser USB/WebHID access, and no hardware-specific code exists anywhere in this codebase — by design, until a real device is chosen.

## Payroll calculation model

`PayrollService.computePayrollLine` ports the recovered legacy formula (`calcularNominaEmpleado`) faithfully, using exact fixed-point (scaled-bigint) arithmetic — never floating-point money math. `totalAmount = base − deduction (lateness) + bonus (overtime)`, clamped at 0.

**Lateness tolerance is a hardcoded 10-minute constant** (`TOLERANCIA_RETARDO_MIN` in `payroll.service.ts`), **by deliberate, already-documented design** — the code's own comment states this is the exact recovered legacy value, with no evidence the legacy ever varied it per tenant, so it was intentionally hardcoded rather than exposed as a setting. This task's own audit re-examined that decision (confirming `company_settings`/`branch_settings` tables do exist but are unused by payroll) and chose **not to override a considered, already-shipped product decision** without new evidence it needs to change — converting it to a tenant setting now would be a real behavior-risk change to the highest-stakes calculation in this system, undertaken for a hypothetical need, not a concrete one. If a real tenant ever needs a different tolerance, that is a genuine future product decision, not a bug fix.

**Overtime** is computed the same way — actual clock-out minus scheduled end, in minutes, converted to a bonus amount at the same per-minute rate as the base salary. This is already real, server-computed, exact-arithmetic domain logic, not something hardcoded in a widget.

## Payroll closure semantics

`PayrollService.close()` is guarded two ways against double-closure: the database update itself is conditional (`update ... where status='draft'`; a no-op update on an already-closed period is detected and rejected), and the request-level idempotency wrapper guards duplicate submissions of the same close request. `calculate()` refuses to run against a closed period. Closed period lines are permanently immutable, enforced at the service layer — no ordinary UI path can mutate a closed period's figures.

## Permissions

Existing catalogue (`packages/database/src/seeds/technical-permissions.ts`), unchanged this task: `employee.read`, `employee.manage`, `schedule.read`, `schedule.manage`, `attendance.read`, `attendance.manage`, `payroll.read`, `payroll.manage`, `payroll.close`. `payroll.close` is deliberately separate from `payroll.manage` — a materially higher-risk, harder-to-undo action. There is no `attendance.punch` permission — punching is authorized by a data check (the employee's own linked user, or `attendance.manage`), not a route-level permission string.

## Branch / timezone behavior

`PosPeopleScreen` is keyed `ValueKey('employees-${branchId}')` at its call site in `pos_shell.dart` (TASK 16.26), so a branch switch fully remounts all four tabs and re-fetches fresh — no stale data from a previous branch in Plantilla, Horarios, Checador, or Nómina. Worked-hours/lateness/overtime calculation is branch-timezone-aware (local-day bucketing in `payrollDailyFacts`). Horarios' new week-navigation (this task) resolves the same real business date every other timezone-aware screen uses.

## Known, deliberate deferrals

- Horarios remains a per-employee day-list, not a full employee × weekday matrix (see above).
- No PDF export exists for Horarios or Nómina — no request to add one was safely scoped this task; the existing PDF infrastructure (`openReceiptPrintWindow`) could support it in a future task.
- Lateness tolerance and overtime rate remain fixed, not tenant-configurable (see above) — a deliberate decision, not an oversight.
- No standalone attendance-history/aggregation report endpoint beyond what Nómina's own calculation already produces.

## Tests

Backend: `time-clock.integration.test.ts` (9, incl. 1 new for `method`), `employees.integration.test.ts`, `payroll.integration.test.ts` — 22/22 passing. `dashboard`/`reports` module tests (which also read `time_clock_punches`) re-verified unaffected — 42/42 passing.
Frontend: `pos_people_test.dart` — 19/19 passing (2 new: method-label honesty, week-navigation).
Full Flutter suite: 1160/1160. `flutter analyze`: 0 errors. `flutter build web --release`: succeeds.
