# V1 Completion Status — AS ONE

TASK 16.27. Builds on TASK 16.26's presentation-readiness audit (`docs/PRESENTATION_READINESS.md`). This document records what TASK 16.27 actually found and changed, and gives an honest module-by-module completion classification — not a plan, a record.

## Scope of this pass

TASK 16.27's own brief listed 35 phases spanning nearly every module in the product (Dashboard, POS, Sales History, Customer 360, Inventory, Cash, Fiestas, Memberships, Rewards, Access, Employees, navigation, filters, tables, money/date/time formatting, notifications, confirmations, permissions, error recovery, keyboard usability, visual polish). Per the brief's own instruction ("Do NOT implement everything found. Prioritize only high-value V1 operational gaps... Do NOT destabilize the product chasing minor polish"), this pass focused on a small number of concrete, high-value, low-risk fixes rather than attempting all 35 phases at equal depth. What follows is honest about what was implemented, what was investigated and deliberately deferred, and what was not re-investigated because TASK 16.26's own recent audit already covered it.

## What was implemented this task

### 1. Checkout completion unification (the flagship ask)

**Before**: an approved Efectivo (cash) sale opened a full `_ReceiptSuccessDialog` (folio, items, totals, payment method, "Imprimir ticket"). An approved Tarjeta or Transferencia sale only showed a toast + a celebratory overlay — no persistent receipt, no way to reprint before leaving the screen.

**After**: Tarjeta and Transferencia sales (CAJERO/staff mode only) now open the exact same `_ReceiptSuccessDialog`, labeled "Tarjeta"/"Transferencia" respectively. The dialog's previously-unconditional "Cambio" row is now suppressed for these methods (`showChange: false`) — there is no physical change concept on a card or transfer payment, and showing a fabricated "Cambio: $0.00" would have been misleading. Kiosk/self-checkout (`_ClienteCardPaymentButton`) deliberately keeps its own, simpler, celebratory-overlay-only completion — a self-checkout customer should not see the staff "Imprimir ticket" dialog; the existing `kiosk` flag already threaded through `_submitSaleForPayment` was reused to gate this, not a new parameter.

**A real bug found and fixed during implementation**: naively awaiting the new modal dialog inside the checkout functions left the Cobrar button's own busy-spinner state (`_busy`) `true` for as long as the dialog stayed open, which is an indeterminate `CircularProgressIndicator` — in a widget test this manifests as `pumpAndSettle` timing out; in the real app it would just be a cosmetically-stuck spinner behind the modal. Fixed by adding an `onBeforeReceiptDialog` callback (mirroring the cash path's own pre-existing `onDialogAboutToOpen`) that flips `_busy` false immediately before the dialog opens.

Files: `apps/one/lib/features/pos/pos_shell.dart` (`_ReceiptSuccessDialog`, `_submitSaleForPayment`, `_submitTransferSaleForPayment`, `_PosCobrarButtonState`). Tests: 2 new in `pos_shell_test.dart` proving the dialog opens with the right label and no Cambio row for each method, plus a strengthened assertion on the existing kiosk-approval test proving the dialog is correctly absent there.

### 2. Payment-method label consistency (Phase 13)

Found via audit: a transfer sale rendered the raw, untranslated backend code `"transfer"` (instead of "Transferencia") in three separate places — the Sales History table, Sale Detail's own payment breakdown, and the Devoluciones (refunds) table — because all three label maps only had `cash`/`card_terminal`/`card_manual` cases and fell through to the raw code for anything else. Also, the checkout pay-method picker itself labeled the button "Transfer" (an English fragment) instead of "Transferencia". All four fixed; the checkout button fix required updating 2 existing tests that asserted the old literal text. New regression test added in `pos_shell_test.dart` for the Sales History case (the most user-visible of the three).

### 3. Dashboard → action navigation (Phase 3)

**Before**: all 10 Dashboard KPI cards and both list cards (Fiestas de hoy, Cajas abiertas) were purely decorative — tapping them did nothing.

**After**: every card with an obvious logical destination is now a real navigation action, reusing the exact same `onNavigateToModule` callback every other module already receives (the identical pattern `_Caja`'s own `onNavigateToCaja` already established) — never a second, parallel navigation mechanism, never a duplicated screen:

| Dashboard card | Navigates to |
|---|---|
| Ventas de hoy | Historial de Ventas |
| Ocupación actual | Control de Acceso |
| Fiestas de hoy / próximas / ingreso / anticipos / completadas / saldo pendiente | Fiestas |
| Cajas abiertas (metric + list card) | Corte de Caja |
| Empleados en turno | Empleados |
| Variantes agotadas | Inventario |
| Fiestas de hoy (list card) | Fiestas |

Threading required adding the callback as a new required field through `_Dashboard` → `_DashboardBody` → `_DashboardReady` (3 constructors), and an optional `onTap`/`InkWell` to `_DashboardMetricCard`/`_DashboardListCard` (both already had a direct precedent for this exact wrap pattern in `_CustomerRow`). 2 new regression tests added in `pos_shell_wave3_dashboard_test.dart` proving an actual tap navigates to the real target screen (not just that a callback exists).

## What was investigated and deliberately NOT implemented

These are real, verified gaps — not guesses — that were judged out of scope for a safe, focused pre-presentation pass. Each is a genuine feature addition or a larger architectural touch, not a small fix, and none is a presentation blocker:

- **Sales History has no payment-method filter UI**, even though the backend model (`PosSaleHistoryFilter.paymentMethod`) already supports it — the filter bar (`_SalesHistoryFilterBar`) simply never exposes a dropdown for it. A real, addressable gap; deferred as a UI-only feature addition, not a fix.
- **Customer 360 (`_CustomerDetailDialog`) does not show a customer's Fiestas/reservation history or coupon-redemption history** — it already unifies visits/sales, membership, and rewards, but has no `partiesGateway` wired in at all. Deferred — this is a real feature addition (a new data-loading call + a new UI section), not a bug fix, and risks its own regressions in an already-large, frequently-tested dialog this close to a presentation.
- **Cash/Register (`_Caja`)** was reviewed end-to-end (current session, expected cash, movements, close, difference, cut history) and found already complete and clear — no gap identified worth changing.
- Every other phase in the original 35-phase brief not named above (global search, filter consistency beyond payment-method labels, table experience, money/date/time formatting sweep, notifications, confirmation-language audit, permission UX, keyboard usability, a full visual-polish sweep) was not re-audited from scratch this task. TASK 16.26's own recent, thorough audit already covered Reports, Dashboard, POS, Inventory, Customers, Access, and Administration and found them presentation-ready with only the two branch-switch bugs it already fixed — there is no new evidence those areas regressed since, and re-auditing them again here would not have been a good use of a focused, high-risk-averse pass this close to the presentation date.

## V1 completion matrix

| Module | Status | Note |
|---|---|---|
| Reports (all 9 tabs) | COMPLETE | TASK 16.25/16.25.2/16.26 |
| Dashboard | COMPLETE WITH P2 GAP | now navigable (this task); minor tile/Inteligencia overlap accepted by design |
| POS checkout | COMPLETE | this task unifies cash/card/transfer completion |
| Sales History | COMPLETE WITH P2 GAP | no payment-method filter UI (backend-ready, deferred) |
| Customer 360 | COMPLETE WITH P2 GAP | no Fiestas/coupon history section (deferred) |
| Inventory | COMPLETE | per TASK 16.26 audit |
| Cash/Register | COMPLETE | reviewed this task, no gap found |
| Fiestas (operational) | COMPLETE | locked, regression-tested, untouched |
| Fiestas (reporting) | COMPLETE | read-only, TASK 16.25 |
| Memberships/Rewards | COMPLETE | per TASK 16.26 audit |
| Access Control | COMPLETE | branch-switch bug fixed in TASK 16.26 |
| Administration | COMPLETE WITH P2 GAP | bare loading spinners, cosmetic (TASK 16.26) |
| Empleados — Plantilla | COMPLETE | full CRUD, search, status filter, responsive grid (TASK 16.29) |
| Empleados — Horarios | COMPLETE | full employee-rows × Mon-Sun matrix (TASK 16.29), replacing TASK 16.28's per-employee day-list |
| Empleados — Checador | COMPLETE | "Checadas de hoy" + branch-wide "Historial de asistencia" panels added (TASK 16.29); real device integration deferred by design |
| Empleados — Nómina | COMPLETE | lateness/overtime already real, exact-arithmetic backend logic — already existed; lines now show the real employee name (TASK 16.29) |
| CFDI / Facturación | OUT OF V1 | explicitly excluded, honest "not yet enabled" state shown |
| Offline POS | OUT OF V1 | explicitly excluded |
| CFDI Nómina (SAT payroll) | OUT OF V1 | explicitly excluded — this system is operational payroll only |

Nothing here should surprise the owner during the Monday presentation.

## TASK 16.28 — Workforce System (Employees/Schedules/Attendance/Payroll)

**Critical audit finding**: the entire 4-tab workforce system (Plantilla/Horarios/Checador/Nómina) already existed, fully backed by a real Postgres schema, real backend services, and a real Flutter UI, before this task began. This task's own scope was therefore an audit-then-close-real-gaps pass, not a build — see `docs/WORKFORCE_SYSTEM.md` for the full architecture writeup, the future-hardware-adapter contract, and the deliberate scope decisions (why Horarios stays a day-list rather than a full matrix, why the lateness tolerance stays a hardcoded constant).

**Implemented this task**:
1. `time_clock_punches.method` — a new, real, stored column (`'manual'`/`'device'`/`'biometric'`) via migration `0047_stiff_joshua_kane.sql`, threaded through the repository/service/routes/gateway/UI. Every punch today is honestly `'manual'` (no device exists) — this is the concrete readiness step for a future attendance terminal, without implementing any hardware.
2. Horarios week quick-navigation (Semana anterior/actual/siguiente), computed from the resolved branch business date, never device-local time.

**Deliberately not changed** (documented, not overlooked): the payroll lateness-tolerance constant stays hardcoded per an already-recorded product decision in the code itself; no PDF export was added for Horarios/Nómina.

## TASK 16.29 — Workforce UX v2 / presentation parity

Built directly on TASK 16.28's architecture, per its own explicit instruction not to rebuild the backend unnecessarily — see `docs/WORKFORCE_SYSTEM.md`'s "TASK 16.29 — what changed" section for the full writeup. In short: Horarios became a real employee × Mon-Sun matrix (closing the P2 gap TASK 16.28 had deliberately left open); Checador gained branch-wide "Checadas de hoy" and "Historial de asistencia" panels reachable with `attendance.read` alone (the "Corregir" action stays `attendance.manage`-gated); Nómina's payroll lines now resolve the real employee name instead of a raw id; a real employee-list pagination bug (never following `next_cursor`) was fixed everywhere the roster is paginated; two small, additive branch-wide backend endpoints (`GET /api/v1/schedules/branch`, `GET /api/v1/time-clock/punches/branch`) were added to avoid an N+1 per-employee fetch pattern for the matrix and the attendance panels. No fake employees, attendance, payroll figures, or device/biometric status were introduced anywhere in this pass.

## Backend

TASK 16.26/16.27: no backend changes.
TASK 16.28: one additive migration (`packages/database/drizzle/0047_stiff_joshua_kane.sql`, adds `time_clock_punches.method`), applied only to the local test database — never production. No table dropped/renamed, no existing column changed, no data migrated.
TASK 16.29: no migration — two new, additive read-only routes/service/repository methods only (see above), applied to the local test database's existing schema. No table dropped/renamed, no existing column changed, no data migrated.

## Tests

TASK 16.28:
- Flutter targeted: `pos_shell_test.dart`, `pos_shell_wave3_dashboard_test.dart`, `pos_people_test.dart` — all green.
- Flutter full suite: **1160/1160 passing**.
- Flutter analyze: 0 errors, no new lint issues (172 pre-existing info/warnings unchanged).
- Flutter web release build: succeeds.
- Backend targeted: `src/modules/people` 22/22, `src/modules/dashboard` + `src/modules/reports` (both read `time_clock_punches`) 42/42 — all against the local test database.

TASK 16.29 — see this task's own final report (and `docs/WORKFORCE_SYSTEM.md`'s "Tests" section) for the complete gate results: targeted `pos_people_test.dart` (23/23), full Flutter suite, `flutter analyze`, `flutter build web --release`, and backend `src/modules/people` (24/24) + `dashboard` regression check.
- Backend typecheck/lint: `@asone/database` and `@asone/api` both clean.
