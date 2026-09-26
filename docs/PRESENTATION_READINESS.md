# Presentation Readiness — AS ONE V1

TASK 16.26. Release candidate for the Monday owner presentation.

- **Branch**: `release/as-pos-v1`
- **Release candidate commit**: on top of `eaede45` (TASK 16.25.2, "restore reporting dashboard visual hierarchy") plus this task's own presentation-hardening commit(s) — see the branch log for the exact SHA.
- **Scope**: polish, consistency, reporting completion, demo reliability. No new features, no redesign, no backend changes, no migrations.

This document is the pre-demo reference: what to show, what to avoid clicking, and what gaps are known and accepted.

## How this audit was performed

Four parallel, read-only code audits covered: (1) all 8 non-Inteligencia Reports tabs against their real backend fields; (2) empty-state/dead-control/navigation patterns app-wide; (3) Dashboard, POS checkout, Inventory, Customers/Memberships/Rewards; (4) Access Control and the four admin screens (Usuarios/Roles/Permisos, Sucursales, Áreas Operativas, Empleados). Findings were triaged into P0/P1/P2, and every safe P0/P1 finding was fixed with a regression test. **No live browser/pixel walkthrough was performed** — every finding below is either a static-code read or a Flutter widget-test assertion (many already run at 1440×900 and 1365×768 test surfaces). This is stated explicitly wherever it matters; treat this document as source-verified, not visually verified.

## Presentation readiness summary

**Overall: no P0 blockers found.** Two real P1s were found and fixed (branch-switch staleness on Control de Acceso and Empleados). A handful of P2 polish items were fixed (loading label, a navigation label typo, a duplicate icon). Everything else audited was already presentation-ready or is a known, accepted, low-risk gap documented below — none block a demo.

| Severity | Count | Status |
|---|---|---|
| P0 | 0 | none found |
| P1 | 0 remaining | 2 found, both fixed |
| P2 | 3 remaining (documented below) | low-risk, non-blocking |

## Reports — per-area status

All 8 non-Inteligencia tabs were confirmed **PRESENTATION READY**: every field the backend actually computes is rendered somewhere in the UI, no tab collapses its whole workspace into a generic empty-state card on zero data (each sub-widget — money list, status table, chart, ranking bars — owns its own local, honest empty-state text instead), and no placeholder/TODO copy is visible to a user.

- **Inteligencia** — accepted in TASK 16.25.2 (hero, compact KPI row, two-column ops grid). Out of scope for this task; unchanged.
- **Ventas** — gross/net sales, transaction count, refund count/total, average ticket, sales-by-hour chart, top products all render from real backend fields. Payment-method breakdown and discount totals are deliberately NOT on this tab — they live on Financiero and Promociones respectively, by original design; nothing backend-computed is being withheld here.
- **Financiero** — cash-drawer movements, payment-method totals (cash/card terminal/card manual/transfer), and closed cash sessions are each in their own clearly labeled card. The payment-method card has its own explanatory PDF footnote clarifying it is never the same figure as cash-drawer movements — sales, cash, and transfers stay visually and conceptually separate, as required.
- **Inventario** — tracked variants, on-hand/reserved/in-transit quantities, out-of-stock count, inventory value, and movement volume all render from real fields; Kardex CSV export works.
- **Clientes** — total/new customers, status breakdown, membership breakdown, active loyalty accounts, all real.
- **Empleados** (report tab) — clock-in/out counts, distinct employees punched, closed payroll totals, all real. No subjective score of any kind.
- **Fiestas** (report tab, read-only) — reservation status breakdown, booked/collected revenue, room activity, all real. Confirmed the empty-state-collapse bug from the original Fiestas incident does **not** recur here.
- **Accesos** — entry/exit counts, live current occupancy, and average stay (honest "Sin datos suficientes" when there are zero completed stay pairs — never the legacy's hardcoded 95) all real.
- **Promociones** — a real 9th reporting area (backend endpoint added in TASK 14.5, predating this task), not part of the legacy's original 8-tab reference but genuinely backed by real coupon/promotion data — kept intentionally, documented inline in code.

**Filters**: date-range picker + 6 quick presets (Hoy/Ayer/Esta semana/Semana pasada/Este mes/Mes pasado) + branch scope, consistent across every tab.
**CSV**: Ventas, Financiero, Inventario (Kardex) — all real, backend-generated exports.
**PDF**: Ventas, Financiero — real HTML-document print-to-PDF via the same mechanism the app's receipts already use (`openReceiptPrintWindow`); honestly reports "no se puede abrir la ventana de impresión" in the Dart VM test host, which is expected — a real browser will open the native print dialog.

## Dashboard

Real KPIs from a real, live `GET /api/v1/dashboard/summary` endpoint (ventas de hoy, ocupación, fiestas de hoy/próximas, ingreso/anticipos de fiestas, fiestas completadas/canceladas, cajas abiertas, saldo pendiente, empleados en turno, variantes agotadas). Zero-data day preserves structure (honest `'0'`, never a fabricated currency string) and a real retry-capable failure state. No fake numbers anywhere.

**Known, accepted overlap (not a bug)**: 3 of the Dashboard's 10 tiles (ventas de hoy, ocupación actual, variantes agotadas) also appear on Reports → Inteligencia. This is normal "quick pulse vs. analysis" overlap for an executive dashboard, not a duplication of the whole Inteligencia screen (7 of 10 Dashboard tiles plus both list cards are unique operational content Inteligencia doesn't show at all). No change made; flagging here as a reviewed, accepted design choice, not a gap.

## POS core sale flow

Cash, Tarjeta, and Transferencia are three distinct, correctly labeled buttons; TASK 16.24's transfer support is intact and visually separate from cash. A cash sale gets a full real receipt dialog (fetches actual configured branding); card and transfer sales currently finish with a toast + success overlay rather than the same persistent receipt dialog. All three payment failures surface through a generic (but message-specific, backend-driven) SnackBar rather than a dedicated failure widget. **Neither is a blocker** — every payment method completes a real sale through the identical `SaleSession`/`createSale` path, and this is a real, pre-existing UX inconsistency, not a regression from this task. Documented as a known P2 for a future pass; not touched here to avoid destabilizing checkout two days before the demo. **Recommendation for the demo**: prefer a **cash** sale when you want to show the full receipt experience.

## Catálogo / Inventario

Real backend-driven balances, stock-status pills (agotado/stock bajo) sourced from the server's own `stock_status` field, filters and table headers stay visible through an empty result set. No dead controls found. No "Kardex" naming exists in the code itself (the equivalent is the Existencias/Movimientos tabs) — worth aligning terminology verbally with the audience if they expect that specific word.

## Clientes / Membresías / Rewards

Real, debounced, server-side customer search. Consistent shared empty/loading/failure state family. TASK 16.24's Rewards QR issuance path (`_issueRewardToken` → `rewardsGateway.issuePresentationToken()`) confirmed intact and reachable. Loyalty shows an honest "Sin actividad de rewards" for an account with none — never a fabricated zero balance. **Do not redeem a real reward during the demo** — issuing a presentation token is safe to show; redemption is a real, consequential state change.

## Fiestas — regression lock

Confirmed intact and covered by the full existing Fiestas test suite (all passing, unmodified):
- **Lista/Calendario/Cotizador/Ajustes** — exactly 4 top-level tabs, Calendario and Cotizador are never rendered simultaneously.
- **Calendar** — Month grid, Week structure, Day structure, and List each keep their own real, honest structure with zero reservations (only List may legitimately show an empty-state card, since it's a pure data list).
- **Cotizador** — zero active packages still renders the full quoting workspace with an honest inline message, never a fake package; "Configurar paquetes" navigation only for an authorized actor.
- Day→Cotizador date pre-fill, availability checking, reservation-conflict handling, consumables (event socks/snacks correction UX), and package configuration all verified via their existing, unmodified, still-green tests.

**No Fiestas code was touched this task.**

## Control de Acceso — fixed

**Real bug found and fixed**: `PosAccessScreen` was constructed with no widget key, and its occupancy/"actualmente dentro"/events data was only ever fetched in `initState`. Switching branches from the top bar while on this screen left the **previous** branch's live occupancy count on screen until a manual refresh — a real risk for a demo that switches branches on stage. Fixed by keying the screen with the same `ValueKey('access-$branchId')` convention already used by Caja and the Dashboard (`pos_shell.dart`), forcing a full remount — and therefore a fresh fetch — on every branch switch. Covered by a new regression test in `pos_access_test.dart` that proves a key change discards the old branch's gateway/data and queries the new one exactly once.

## Administración

- **Usuarios / Roles / Permisos**: presentation ready. Confirmed the TASK 16.23E (F-13) auth-refresh fix is present and correctly wired — a real 401/403 now maps to its own specific message via `AppFailure.fromCode`, never a generic fallback.
- **Sucursales**: presentation ready (company-scoped, no branch-context concern).
- **Áreas Operativas**: has its own independent, visible branch selector by design — does not auto-follow the global branch switcher, but this is an intentional, visibly-labeled choice, not a hidden staleness bug.
- **Empleados (admin)**: had the exact same branch-switch staleness bug as Control de Acceso (roster fetched once in `initState`, `PosPeopleScreen` never keyed). Fixed the same way — `ValueKey('employees-$branchId')` — with its own new regression test in `pos_people_test.dart` proving the previous branch's roster is discarded on remount.

**Do not alter production users/roles/permissions or branch/area configuration during the demo.**

## Empty / loading / error states

- No recurrence anywhere in the codebase of the original Fiestas-style bug (an early `if (list.isEmpty) return <wholeScreenEmptyState>` destroying a workspace). Every genuine early-return empty check found is a narrow leaf widget (a product grid, a money list, a ranking chart) nested inside a parent that always renders its own filters/header first.
- The generic string `"Revisa la información e intenta nuevamente"`-equivalent (`AppFailure.fromCode`'s validation-error default) is never used as a stand-in for an auth failure anywhere audited — every screen's `catch (ApiException error)` uses `error.failure.message`, so a real 401/403 correctly renders its own specific text.
- **Fixed**: Reports' own shared loading state (`_ReportsLoadingState`, used by all 9 tabs) was a bare spinner with no label — added "Cargando reporte…" beneath it. Low-risk, high-visibility (every tab switch hits this).
- **Known, not fixed (P2)**: roughly a dozen other screens' own loading states (`_LoadingState` in branch admin, branch consolidation, readiness, etc.) are similarly bare spinners. Functionally harmless (all are bounded, not full-screen/indefinite) — left as-is to avoid a broad, low-value, multi-file change this close to the demo.

## Navigation

- **Fixed**: sidebar label "Control Acceso" → "**Control de Acceso**" (grammatically consistent with every other multi-word label in the file).
- **Fixed**: "Marca del Ticket" (Sistema) had the exact same icon as "Facturación CFDI" (Caja y Finanzas) — gave it its own distinct icon.
- **Known, not fixed (P2)**: 3 of 7 sidebar groups (Ventas, Inventario, Caja y Finanzas) use a different icon for their primary item than their own group icon, diverging from a stated-but-not-fully-honored convention in the file's own doc comment. Cosmetic only; left as-is — touching group icons broadly was judged lower value than the risk of an inconsistent-feeling last-minute icon change across many destinations.
- **"Facturación CFDI"** is a real, sidebar-reachable, permission-gated destination that renders an honest "Esta sección aún no tiene funcionalidad habilitada" — this is an intentional, documented scope cut (CFDI is explicitly out of scope for this task and V1), not a bug. If a presenter is asked about invoicing, this is the honest answer to give.

## Responsive / visual

Both `1440×900` and `1365×768`-equivalent widths are exercised by many existing widget tests across the suite (branch admin, branch consolidation, brand admin, branding, and the new Access/Reports tests added this task); no `RenderFlex` overflow was encountered in the full test run at any of these configured sizes. Reports' own two-column operations grid was previously verified (TASK 16.25.2) to switch cleanly between a real two-column layout above 900px content width and a stacked column below it, with no horizontal overflow. **No live/pixel browser render was performed** for the rest of the app — this is a source- and widget-test-level confirmation only.

## Backend

**No backend changes.** Every fix this task made was Flutter-only (widget keying, copy, an icon). No new endpoints, no migrations, no schema changes, no production data touched.

## Tests

- **Flutter targeted**: `pos_reports_test.dart` (33/33), `pos_access_test.dart` (20/20, incl. new branch-remount test), `pos_people_test.dart` (18/18, incl. new branch-remount test), `pos_shell_test.dart` full file (all Fiestas/consumables/receipt/kiosk groups) — all green.
- **Flutter full suite**: **1153/1153 passing** (1151 prior baseline + 2 new regression tests).
- **Flutter analyze**: 0 errors; pre-existing info/warning count unchanged by this task's edits (verified file-by-file — no new lint issues introduced).
- **Flutter web release build**: succeeds.
- **Backend**: not touched — no backend quality gates were run this task since no backend file changed.

## Presentation walkthrough (read-only, no production writes)

1. **Login** — show real session/branch context in the top bar.
2. **Dashboard** — quick pulse: today's sales, occupancy, cash sessions, parties. Zero-data days render real `0`s, not blank.
3. **Reports → Inteligencia** — hero, KPI row, ops grid. If today has zero sales, the hero/grid still render (structure intact).
4. **Reports → Ventas** — gross/net, hourly chart, top products. Try a date-range preset ("Este mes") live.
5. **Reports → Financiero** — point out the three separate cards (cash-drawer movements / payment methods / closed sessions) to make the "sales ≠ cash ≠ transfer" distinction concrete.
6. **Reports → Inventario** — stock/out-of-stock/movement volume.
7. **Reports → Clientes** — customer/membership totals.
8. **Reports → Fiestas** — read-only reservation/revenue summary.
9. **Reports → Accesos** — live occupancy + average stay.
10. **Catálogo** — browse products; **avoid** creating/editing a real product unless intended.
11. **Inventario** — browse Existencias/Movimientos; **avoid** any adjustment/count action.
12. **Clientes** — search a real customer; safe to open detail. **Avoid** editing/deleting.
13. **Fiestas → Calendario** — show Month/Week/Day, tap a day's "+" to demonstrate the date pre-fill into Cotizador.
14. **Fiestas → Cotizador** — build a quote; **avoid** actually converting it to a reservation unless intended as a real booking.
15. **Membresías / Rewards** — safe to show a customer's entitlement and issue a presentation QR token; **do not redeem** it.
16. **Control de Acceso** — safe to view occupancy/entries; **avoid** scanning/voiding a real credential. If demonstrating a branch switch live, this screen now refreshes correctly (fixed this task).
17. **Administración** — Usuarios/Roles/Permisos/Sucursales/Áreas Operativas/Empleados are safe to open and browse; **avoid** creating/deactivating a real user, role, branch, or employee.

## Remaining non-blocking gaps (P2)

1. POS checkout: card/transfer sales finish with a toast instead of the same persistent receipt dialog cash gets (pre-existing, not a regression; prefer cash for the full-receipt demo moment).
2. ~12 admin screens still show a bare, unlabeled loading spinner (functionally harmless, cosmetic only).
3. 3 of 7 sidebar groups have a primary-item icon that doesn't match their own group icon (cosmetic only).

None of these block a Monday presentation.

## Files / commits

Flutter-only change set (no backend files): `pos_shell.dart`, `pos_navigation.dart`, `pos_reports_screen.dart`, `pos_access_test.dart`, `pos_people_test.dart`, plus this document. See the branch's commit log for the exact commit boundary of this task's work.

**PUSH: NO. DEPLOY: NO. PRODUCTION WRITES: ZERO.**
