# Workforce System — Employees · Schedules · Attendance · Payroll

TASK 16.28 (foundation) + TASK 16.29 (UX v2 / presentation parity) + TASK 16.29.3 (Checador terminal UX). Administración → Empleados: Plantilla / Horarios / Checador / Nómina.

## TASK 16.29 — what changed

TASK 16.29's own brief was explicit: reuse TASK 16.28's architecture, do not rebuild the backend unnecessarily, and close this system's remaining UX gaps for a presentation-ready experience. Concretely:

1. **Horarios is now a real employee-rows × Monday–Sunday-columns matrix** (`_ScheduleMatrix`/`_ScheduleCell` in `pos_people_screen.dart`), replacing the per-employee day-list TASK 16.28 deliberately kept. Editing a cell reuses the exact same, unmodified `_ScheduleFormDialog`/upsert validation — only the surrounding navigation/rendering changed. Week navigation (Semana anterior/actual/siguiente) still resolves the real business date, never device-local time. Zero employees preserves the matrix header/week-nav chrome with an honest inline message; an employee with no schedule for a given day renders that cell honestly as "Sin turno" rather than a blank cell.
2. **A new backend pair, additive only**: `GET /api/v1/schedules/branch` and `GET /api/v1/time-clock/punches/branch` (repository methods `listSchedulesForBranch`/`listPunchesForBranch`, same `schedule.read`/`attendance.read` permissions as the existing per-employee endpoints, same branch-ownership validation convention as `PayrollService.createPeriod`). This was a deliberate, narrow addition — the matrix needs one branch-wide fetch per week, not one HTTP call per employee per week; the alternative (N+1 calls) was audited and rejected as a real, repeated performance problem before writing any code.
3. **A real pagination bug fixed**: the Flutter employees gateway/screens never followed the API's own `next_cursor` — any branch with more than 50 (default) or 100 (max page size) active employees silently lost the rest from every list that paginates over employees (Horarios' roster, Nómina's employee-name lookup, Checador's self-service picker). Fixed with a `do { … } while (cursor != null)` loop wherever the full roster is needed for a client-side join or a matrix's rows.
4. **Checador is now a real operational workspace**: "Registrar entrada/salida" (self-service, unchanged logic) plus two new, always-visible, branch-wide panels — "Checadas de hoy" (auto-loaded for the resolved business date, columns Empleado/Tipo/Hora/Método) and "Historial de asistencia" (an optional employee filter over one `listPunchesForBranch` fetch, replacing the old "pick an employee, then load" flow). Both panels are reachable with `attendance.read` alone; "Corregir" only ever renders when `attendance.manage` is present, and is omitted entirely (not disabled) for a read-only viewer — the same read/manage split TASK 16.28 already established for hiding dangerous actions. A punch made today can legitimately appear in both panels at once; `_PunchRow` takes a `keyPrefix` so the two renderings of the same punch never collide as widget keys.
5. **Nómina's payroll lines now show the real employee display name**, not a raw UUID — a client-side join (`_NominaTabState._loadEmployeeNames`, paginated with the same cursor-following fix) against the already-fetched branch roster, resolved by `_PayrollPeriodDetailDialog.employeeNames[line.employeeId]`. Falls back to the raw id only when `employee.read` is unavailable — never a fabricated name.
6. **Device/biometric UX stays documentation-and-copy only** (Phase 5, explicit instruction): no device registry, no fake "Conectado"/serial/online-status UI was added. The only change is one neutral, honestly-worded line in the entrada/salida panel ("Conecta un lector compatible para registro automático (próximamente).") — it never claims a device exists or is connected. See "Future attendance device integration" below, unchanged in substance from TASK 16.28.

**Not touched this task**: Users vs. Employees separation (already correct, see below), the RBAC permission catalogue (no new permission was invented), the payroll calculation engine itself (only its lines' display now resolves a name), the lateness-tolerance/overtime constants.

## TASK 16.29.3 — Checador terminal UX

A frontend-only presentation pass on top of TASK 16.29's Checador (no backend change; no migration; the real `clockIn`/`clockOut`/`correctPunch`/`listPunches(ForBranch)` endpoints are unchanged). The upper "Registrar entrada/salida" panel became a terminal-style panel (`pos-timeclock-terminal` in `pos_people_screen.dart`):

- **Title + live clock + business date.** "CHECADOR", a ticking `HH:MM:SS a.m./p.m.` clock (`_TerminalClock`, its own 1s `Timer`, device-local wall-clock time — deliberately the same convention `pos_shell.dart`'s own topbar clock already uses, so a shared terminal never shows a second, competing time source), and the resolved BUSINESS date in long Spanish form ("sábado, 26 septiembre 2026", via the new `_longSpanishDate` helper) — the same `_businessToday` every other timezone-aware panel in this file already resolves, not `DateTime.now()`.
- **Employee identification.** One always-visible field, "Código o ID del empleado". Typed text first resolves against the real, already-fetched branch roster by `code` (case-insensitive) — a genuine client-side match against real data, never an invented backend "lookup by name" endpoint (the backend's `employee_id` fields are still, and only ever, the real UUID `employees.id`). No match in the roster (a deactivated employee, `employee.read` unavailable, a raw id) forwards the typed text unchanged, exactly as the prior manual-entry field already did — the real endpoint remains the sole authority on validity. If the session's own linked employee resolves, the field is prefilled with their code as a convenience (never hidden, never auto-submitted) so a shared terminal still lets anyone override it.
- **Entrada/Salida stay a client-side "is something typed" gate only** — never an inference of which action is currently legal; that sequencing (duplicate clock-in, clock-out with no open clock-in, etc.) remains entirely server-owned and is surfaced from the real rejection message, unchanged from TASK 16.28/16.29.
- **Success confirmation.** A dialog (`_PunchConfirmationDialog`) shows "Entrada registrada"/"Salida registrada" with the real employee label (resolved from the branch roster, falling back to the raw id — never a fabricated name), the real server `occurred_at`, and the real stored `method` — all straight off the `PosTimeClockPunch` the backend returned. Dismissing it clears the identification field for the next employee at a shared terminal.
- **Device/biometric placeholder** stays copy-only ("Checador automático · Lector / biométrico" / "Conecta un lector compatible para registro automático. Próximamente.") — still no registry, no fake connected/online state, no hardware.
- "Checadas de hoy" and "Historial de asistencia" (below the terminal) are unchanged in substance from TASK 16.29 — same branch-wide data, same RBAC split.

**Available now vs. future**, stated explicitly per this task's own instruction:

- **AVAILABLE NOW**: manual employee attendance (typed code or id, resolved against real data); real entry/exit records via the unchanged `clockIn`/`clockOut` endpoints; today's punches and attendance history (branch-wide, real); corrections under `attendance.manage` RBAC; payroll consumption of this same real attendance data (unchanged).
- **FUTURE, not built**: a physical attendance reader, a biometric reader, NFC/QR or any other device-based identification — none exist in this codebase; the `method` column and the adapter boundary documented above are the only readiness step taken, and the terminal's own placeholder text never claims otherwise.

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

### 2. Horarios week-quick-navigation (TASK 16.28) → full matrix (TASK 16.29)

TASK 16.28 added "Semana anterior / Semana actual / Semana siguiente" buttons to the then-existing per-employee day-editor, jumping its date-range fields to real Monday-Sunday week boundaries computed from the resolved **business date** (the same `GET /api/v1/context/business-date` primitive `_Dashboard`/Reports already use — never `DateTime.now()`, preserving TASK 16.23B's timezone semantics).

TASK 16.29 replaced that day-editor entirely with the full employee-rows × weekday-columns matrix originally deferred in TASK 16.28 (see that task's note below, kept for history) — see "TASK 16.29 — what changed" above for the details. The business-date resolution and week-navigation logic carried over unchanged; only the surrounding rendering (a table of real employees × real days instead of one employee's date-range list) changed.

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

- No device registry/management UI exists — there is no real device to register (see "Future attendance device integration" below); TASK 16.29 confirmed this and deliberately did not build one for appearance.
- No PDF export exists for Horarios or Nómina — no request to add one was safely scoped this task; the existing PDF infrastructure (`openReceiptPrintWindow`) could support it in a future task.
- Lateness tolerance and overtime rate remain fixed, not tenant-configurable (see above) — a deliberate decision, not an oversight.
- No standalone attendance-history/aggregation report endpoint beyond what Nómina's own calculation and the Checador history panel already produce.

## Tests

TASK 16.28 — Backend: `time-clock.integration.test.ts` (9, incl. 1 new for `method`), `employees.integration.test.ts`, `payroll.integration.test.ts` — 22/22 passing. `dashboard`/`reports` module tests (which also read `time_clock_punches`) re-verified unaffected — 42/42 passing. Frontend: `pos_people_test.dart` — 19/19 passing. Full Flutter suite: 1160/1160. `flutter analyze`: 0 errors. `flutter build web --release`: succeeds.

TASK 16.29 — Backend: `src/modules/people` 24/24 passing (22 prior + 2 new: branch-wide schedules, branch-wide punches, both incl. an unauthorized-branch-id rejection case). `dashboard` module re-verified unaffected. Frontend: `pos_people_test.dart` — 23/23 passing (4 rewritten + 2 new for Horarios' matrix; 1 rewritten + 2 new for Checador's branch-wide panels).

TASK 16.29.3 — Frontend-only; backend untouched (no re-run needed, confirmed by an empty `git diff` under `apps/api`). Frontend: `pos_people_test.dart` — 29/29 passing (1 rewritten success-confirmation assertion + 6 new: terminal title/clock/date/field, disabled-until-identified, code-resolution, device-placeholder honesty, desktop/narrow no-overflow). See this task's own final report for the full/whole-suite and `flutter analyze`/`flutter build web` gate results.
