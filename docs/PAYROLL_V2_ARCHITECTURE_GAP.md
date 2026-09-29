# Payroll V2 — Architecture Gap (TASK 17.5)

Audit-only document. Nothing in this file was implemented by TASK 17.5 — every item
below either requires a business-rule decision, a schema change, or both, and per
this task's own migration rule, no migration was created.

## What already works (verified against real code, not assumed)

Payroll's core calculation pipeline is real, tested against a live Postgres
database, and genuinely server-authoritative:

- **Weekly salary snapshot**: `computePayrollLine` freezes `baseSalarySnapshot` at
  calculation time (`payroll.service.ts:104-126`). A post-close salary edit does
  **not** retroactively change an already-closed, never-reopened period — proven by
  `payroll.integration.test.ts:346-366`.
- **Scheduled/worked minutes**: real joins to `employee_schedules` and
  `time_clock_punches` (`people.repository.ts:868-882`).
- **Late/overtime minutes**: computed server-side (`payroll.service.ts:85-90`).
- **Totals**: computed and clamped server-side; the Flutter client never recomputes
  a payroll figure (`pos_people_gateway.dart:806-807`; confirmed by grep — zero
  arithmetic on money fields in `pos_people_screen.dart`).
- **Close/reopen**: real, audited (`payroll_period.closed` / `.reopened` in
  `audit_log`), permission-gated (`payroll.close`).
- **History**: real `GET /payroll-periods?status=closed` list.

## Gaps requiring a decision before further work

### 1. Manual adjustments (bonus/deduction) — FOLLOW-UP ARCHITECTURE REQUIRED

**Why current model is insufficient:** `deductionAmount`/`bonusAmount` on a payroll
line are purely formula-derived (late-minute penalty / overtime bonus) and are
**wholly overwritten** on every `calculate()` call (`replacePayrollPeriodLines`
deletes+reinserts every line). There is no column, table, or endpoint for a manager
to add a one-off adjustment (e.g. "$200 holiday bonus") that survives a
recalculation.

**Proposed design** (not created this task):
- New table `payroll_period_line_adjustments`: `id`, `company_id`, `payroll_period_line_id`
  (FK), `label` (text), `amount` (numeric, signed), `created_by`, `created_at`.
- `calculate()` must be changed to **preserve** adjustment rows across a
  wholesale-replace (join them back onto the newly computed line by employee id,
  or key adjustments to the period+employee rather than the line row's own id if
  lines are truly ephemeral).
- Business rule needed: can adjustments be added to a **closed** period, or only
  while `draft`? Who can approve one (new permission, or reuse `payroll.manage`)?
- **Tenant key:** `company_id`. **Branch key:** none needed (inherits from the
  period). **Audit:** a new `payroll_line_adjustment.created` action.

### 2. Daily-detail payroll view — FOLLOW-UP (partially E, partially F)

**Why current model is insufficient:** `payrollDailyFacts`
(`people.repository.ts:856-913`) computes real per-day scheduled/entrada/salida/
retardo/extra facts, but this is **internal only** — never persisted, never
returned by any route. The Flutter payroll UI only shows weekly aggregates
(`_PayrollLineRow`, `pos_people_screen.dart:3412-3458`).

**For a still-`draft` period** this is a safe **E** (no migration): add a read-only
`GET /payroll-periods/:id/employees/:employeeId/daily` endpoint that recomputes and
returns `payrollDailyFacts` on demand.

**For a `closed` period**, this is **F**: there is no daily-snapshot table, so a
closed period's "daily breakdown" would have to be recomputed from the *current*
(non-snapshotted) `employee_schedules`/`time_clock_punches` rows — which could
silently disagree with the frozen weekly total if a punch was edited afterward.
Building an honest closed-period daily view requires the historical-snapshot design
in item 3 below.

### 3. Historical snapshot immutability — the critical caveat

**Current state (verified, not assumed):** a closed-and-**never-reopened** period is
genuinely immutable — its weekly line display never joins live `employees`/
`company_memberships` tables for money fields (`people.repository.ts:940-1046`).

**The caveat:** `reopen` is a real, deliberately-designed, audited operation
(`payroll_period.reopened`) that flips status back to `draft`, after which
`calculate()` **wholesale-replaces** every line using *then-current* salary/
schedule/punch data (`payroll.service.ts:240-241`, tested at
`payroll.integration.test.ts:379-380`). This is not a bug — it is how a legitimate
correction workflow would work — but it means **"closed" is not a permanent
guarantee** absent a policy on who may reopen a period and why.

**Proposed design if a stronger guarantee is wanted** (FOLLOW-UP, requires business
decision first — do not build until the policy question is answered):
- A `payroll_periods.finalized_at` / `finalized_by` pair distinct from `closed_at`/
  `closed_by`, set only when a *separate*, more-restricted permission
  (`payroll.finalize`, new) is used — reopening a merely-`closed` (not
  `finalized`) period stays as-is; reopening a `finalized` one requires a
  reason/justification captured in `audit_log`.
- Alternatively (larger, F): a true append-only `payroll_period_snapshots` table
  capturing every field of every line at close time, immune to any later reopen —
  the current design would then always create a **new** snapshot row on each
  close, never mutate the original.
- **State machine impact:** would add at least one more status distinguishing
  "closed, still correctable" from "finalized, requires justification to touch."
- **API impact:** `close`/`reopen` routes would need a `finalize` counterpart;
  every payroll-detail read would need to say which snapshot it's showing.

### 4. Payroll PDF/receipt — identified as safe (D), not built this pass

**Why it's safe:** all data needed for a weekly receipt (business identity via the
already-real Configuración/branding settings, employee name/job title, week range,
the 8 real weekly-aggregate fields) is already returned by `GET /payroll-periods/:id`
— no backend change required. The exact same HTML-document +
`openReceiptPrintWindow` browser-print pattern already used for sales receipts
(`receipt_html.dart`, `receipt_print.dart`) and the cash-cut/refund receipts is
directly reusable; no new PDF library, no hardcoded tenant name.

**Why it was not built in this pass:** it is a genuinely new UI surface (an HTML
template + a "Descargar / Imprimir PDF" button wired into
`_PayrollPeriodDetailDialog`), and this task prioritized breadth of correctness
fixes and honest-presentation polish across many already-existing screens over
building one new feature end-to-end under the same time budget. Recommended as the
next payroll-focused task — no architecture blocker exists.

## Explicitly NOT done (and correctly so)

- No hardcoded 10-minute tolerance, deduction formula, or bonus formula was ever
  found in Flutter — payroll money logic is, and remains, 100% server-side
  (`payroll.service.ts`'s own `TOLERANCIA_RETARDO_MIN = 10` constant, explicitly
  documented as not tenant-configurable).
- No manual adjustment UI was built without the backend column to support it
  (would have been silently erased on the next recalculate — a real correctness
  bug, not a cosmetic gap).
