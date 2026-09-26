# Monday Demo Runbook — AS ONE

TASK 16.30. A deterministic, step-by-step presentation path against real production data (INFLAPARK) or a real local/test environment. This is a **walkthrough script**, not a feature list — see `docs/PRESENTATION_READINESS.md` and `docs/WORKFORCE_SYSTEM.md` for the underlying architecture/audit detail behind each step, and `docs/MONDAY_PRESENTATION_RISKS.md` for everything not fixed yet.

**Ground rule for the whole runbook**: every screen shows real data or an honest empty state. Nothing below asks you to click something that fabricates a number, a name, or a status. Where a step says "avoid," it's because the action is real and consequential (creates/edits/deletes production data), not because the screen is broken.

---

## 1. Login

- **Click**: sign in with a real INFLAPARK user, select company/branch if prompted.
- **Say**: "This is the real login — the same session and permission system every screen below respects."
- **Proves**: real authentication, real branch/company scoping, real session context shown in the top bar for the rest of the demo.
- **Don't click**: don't create a new user or change your own password here.
- **Safe against INFLAPARK**: yes — read-only.
- **Expected empty state**: n/a.

## 2. Dashboard

- **Click**: land on Dashboard (default post-login screen). Point at 2-3 KPI tiles; tap one (e.g. "Empleados en turno") to show it navigates to its real source module.
- **Say**: "Every number here comes from a live backend summary endpoint for today's business date — not a mock."
- **Proves**: real server-aggregated KPIs, real branch/business-date awareness, real tile→module navigation (TASK 16.27).
- **Don't click**: nothing destructive is reachable from here.
- **Safe against INFLAPARK**: yes — read-only.
- **Expected empty state**: a day with zero sales/activity still renders every tile with an honest `0` (never a blank tile, never a fabricated currency string).

## 3. Reports

- **Click**: Reportes → walk Inteligencia → Ventas → Financiero → Inventario → Clientes. Try one date-range preset (e.g. "Este mes") live on Ventas.
- **Say**: "Nine real report areas, each backed by its own backend aggregation — Financiero is deliberately split into cash-drawer movements / payment-method totals / closed sessions, because those are three different real numbers, not one."
- **Proves**: real filtering, real CSV export buttons (Ventas/Financiero/Inventario), real PDF print buttons (Ventas/Financiero).
- **Don't click**: don't rely on "Imprimir/PDF" actually opening a window if the browser blocks popups — see Recovery below.
- **Safe against INFLAPARK**: yes — read-only.
- **Expected empty state**: a zero-result range renders real zero counts and each card's own honest "sin datos"-style note — never an error, never a collapsed screen.

## 4. POS (Punto de Venta)

- **Click**: add 1-2 real products to a cart, show quantity/discount controls, walk through Cash → Tarjeta → Transferencia payment selection without necessarily completing all three.
- **Say**: "One unified checkout completion for every payment method — card and transfer show the same real receipt dialog cash does" (TASK 16.27).
- **Proves**: real product search/cart, real payment-method selection, real receipt/confirmation dialog with real totals.
- **Don't click**: **do not complete a real sale** unless you intend to create a real INFLAPARK transaction — a completed sale is a real, persisted, hard-to-cleanly-reverse business record. If you must show a completed checkout, use a trivial/low-value product and mention it's a real transaction.
- **Safe against INFLAPARK**: cart-building and payment-method browsing are safe; **completing checkout is a real production write**.
- **Expected empty state**: an empty cart shows the real "agrega productos" prompt, never a fake starter cart.

## 5. Catálogo (Productos)

- **Click**: browse Productos, search, open one product's detail.
- **Say**: "Full CRUD exists here, but today I'll just browse the real catalog."
- **Proves**: real search, real status pill (now correctly shows "Activo"/"Inactivo"/"Borrador"/"Retirado" — TASK 16.30), real product detail.
- **Don't click**: avoid creating/editing/duplicating a real product.
- **Safe against INFLAPARK**: yes, for browsing only.
- **Expected empty state**: a search with no matches shows an honest "no hay productos" note, toolbar intact.

## 6. Inventario

- **Click**: Inventario → Existencias (stock levels), then Admin. Inventario → Movimientos tab to show one real ledger entry.
- **Say**: "This is a real, audited ledger — every movement, transfer, and count is a recorded event; there's no button anywhere that lets someone silently overwrite a stock number."
- **Proves**: real stock levels, real movement history with a real, now-translated Spanish movement type ("Entrada"/"Salida"/"Ajuste"/etc. — TASK 16.30), real status pills.
- **Don't click**: avoid creating a new adjustment, transfer, or count unless intended as a real inventory event.
- **Safe against INFLAPARK**: yes, for browsing (Existencias/Movimientos/Traspasos/Conteos lists).
- **Expected empty state**: a location/branch with no movements shows an honest empty list, filters/toolbar intact.

## 7. Clientes

- **Click**: search a real customer by name, open their detail.
- **Say**: "Real, debounced server-side search — not a client-side filter over a small cached list."
- **Proves**: real customer directory, real detail view (history, membership/reward relationship).
- **Don't click**: avoid editing/deleting a real customer record.
- **Safe against INFLAPARK**: yes, for search/browse.
- **Expected empty state**: no matches shows an honest "sin resultados," search box stays usable.

## 8. Fiestas

- **Click**: Fiestas → Calendario (show Month/Week/Day/List), tap a day's "+" to show the Cotizador date pre-fill; optionally build (not submit) a quote.
- **Say**: "This is the most complex module in the app and it's fully regression-locked — nothing was touched this presentation cycle."
- **Proves**: real reservation calendar, real package/room/tax/promotion-aware quoting, real conflict detection.
- **Don't click**: avoid converting a quote into a real reservation, avoid editing room/package status in Ajustes unless intended (those dropdowns now show translated Spanish labels, not raw enum values — TASK 16.30).
- **Safe against INFLAPARK**: yes, for calendar browsing and quote-building (without submitting).
- **Expected empty state**: zero packages still renders the full Cotizador workspace with an honest inline message — never a fake package.

## 9. Membresías / Rewards

- **Click**: open a real customer with a membership, show their benefits/visit progress; issue a presentation reward QR token if you want to show that flow.
- **Say**: "Issuing a presentation token is safe and reversible; redeeming one is a real, consequential state change, so I won't redeem it live."
- **Proves**: real membership/benefit data, real QR issuance.
- **Don't click**: **do not redeem** a real reward.
- **Safe against INFLAPARK**: yes for browsing and issuing a token; redemption is a real write — avoid.
- **Expected empty state**: an account with no reward activity shows an honest "sin actividad," never a fabricated zero balance.

## 10. Control de Acceso

- **Click**: show current occupancy for the branch; if demonstrating a branch switch, do it here — this screen correctly refreshes on switch (TASK 16.26 fix, still intact).
- **Say**: "Live occupancy count, not a cached or stale number."
- **Proves**: real occupancy, real branch-switch remount safety.
- **Don't click**: avoid scanning/voiding a real credential. **Known cosmetic gap**: a scanned credential's "Cliente:"/"Venta:" lines show the real customer/sale id, not yet a resolved name — see the risk register. If asked, say this is a known next-iteration polish item, not a data bug.
- **Safe against INFLAPARK**: yes, for viewing occupancy; avoid a real scan/void action.
- **Expected empty state**: zero occupancy shows a real "0," not a blank panel.

## 11. Empleados (Plantilla)

- **Click**: Administración → Empleados → Empleados tab, browse the real employee grid, open one card.
- **Say**: "Real employee roster — weekly salary only shows if your session is authorized to see it."
- **Proves**: real CRUD-capable roster, real RBAC on salary visibility.
- **Don't click**: avoid creating/editing/deactivating a real employee.
- **Safe against INFLAPARK**: yes, for browsing.
- **Expected empty state**: "No hay empleados registrados en esta sucursal," toolbar intact.

## 12. Horarios

- **Click**: Empleados → Horarios tab. Show the employee × Monday-Sunday matrix, use week navigation (Semana anterior/actual/siguiente), tap one cell to show the real schedule editor (don't have to save).
- **Say**: "A real matrix, not a mockup — every cell reflects a real schedule row or an honest 'Sin turno.'"
- **Proves**: real branch-wide schedule data in one view, real business-date-aware week navigation.
- **Don't click**: avoid saving a schedule change unless intended as a real edit.
- **Safe against INFLAPARK**: yes, for browsing/navigating; a saved cell edit is a real write.
- **Expected empty state**: zero employees preserves the matrix header/week-nav chrome with an honest inline message.

## 13. Checador

- **Click**: Empleados → Checador tab. Point out the live clock, the business date, the employee identification field, and the "Checadas de hoy"/"Historial de asistencia" panels.
- **Say**: "This is a real terminal experience now, not a bare form — but it's still backed by the exact same clock-in/clock-out endpoints as before. The device/biometric line is honest: there's no reader connected yet."
- **Proves**: real live clock (device time, matching the topbar convention), real resolved business date, real code/id-based employee identification against the real roster, real Entrada/Salida with a real confirmation dialog, real "Checadas de hoy" and "Historial de asistencia."
- **Don't click**: **avoid completing a real Entrada/Salida** unless you intend to create a real attendance record for a real employee — recommend using a low-consequence test employee if your INFLAPARK data has one, or simply show the terminal without tapping Entrada/Salida.
- **Safe against INFLAPARK**: browsing/typing is safe; **completing a punch is a real production write**.
- **Expected empty state**: "Sin checadas hoy." / "No hay marcaciones en este rango." — both panels stay visible.

## 14. Nómina

- **Click**: Empleados → Nómina tab. Show a period's status filter, open a period's detail to show the real per-employee lines (Programado/Trabajado/Retardo/Extra/Base/Ajuste/Total) with real employee names.
- **Say**: "Every figure here is computed server-side with exact fixed-point arithmetic — nothing is recalculated in the app."
- **Proves**: real payroll periods, real employee-name resolution (TASK 16.29), real Borrador/Cerrada status labels, real close/reopen safeguards.
- **Don't click**: avoid calculating or closing a real period unless intended — closing is real and requires its own confirmation; reopening is a separate, distinctly-permissioned action.
- **Safe against INFLAPARK**: yes, for browsing an already-existing period. Calculating/closing/reopening are real writes.
- **Expected empty state**: "No hay periodos de nómina," toolbar intact; an uncalculated period shows "Este periodo aún no ha sido calculado."

## 15. Usuarios / Roles / Permisos

- **Click**: Administración → Usuarios, browse the user list, open Roles/Permisos tabs to show the real permission catalogue.
- **Say**: "Users and Employees are deliberately separate concepts — this is login/authorization, Empleados is HR/workforce."
- **Proves**: real user/role/permission CRUD, real F-13 auth-refresh fix (a real 401/403 shows its own specific message).
- **Don't click**: avoid creating/editing/deactivating a real user, role, or permission grant.
- **Safe against INFLAPARK**: yes, for browsing.
- **Expected empty state**: n/a for a live tenant (there will always be at least the logged-in user).

## 16. Sucursales / Áreas Operativas

- **Click**: Administración → Sucursales (branch list, timezone/code visible), Áreas Operativas (tenant-defined operational areas).
- **Say**: "Áreas Operativas has its own independent branch selector by design — it doesn't silently follow the global switcher."
- **Proves**: real branch CRUD-capable admin, real per-area configuration.
- **Don't click**: avoid creating/editing/deactivating a real branch or area.
- **Safe against INFLAPARK**: yes, for browsing.
- **Expected empty state**: an unlikely empty branch list would show an honest empty state; in practice INFLAPARK always has at least one branch.

## 17. Sistema

- **Click**: Configuración (readiness checklist), Marca del Ticket (receipt branding editor — browse only), Impresora de Tickets (print a real, obviously-labeled test ticket if a printer is connected), Asistente (ask it a real FAQ question).
- **Say**: "Facturación CFDI is intentionally not enabled yet — that's an honest, marked scope cut, not a bug." (Reachable from Caja y Finanzas, not Sistema — mention if asked.)
- **Proves**: real readiness/go-live checklist, real receipt branding config, a real (harmless) test print, a real deterministic FAQ assistant — no simulated typing, no fabricated confidence score.
- **Don't click**: avoid changing real receipt branding or printer settings unless intended.
- **Safe against INFLAPARK**: yes, for browsing; the test print is safe by design (obviously marked "PRUEBA DE IMPRESIÓN — NO ES UNA VENTA").
- **Expected empty state**: n/a — these are configuration screens, not data lists.

---

## DEMO RECOVERY

**If the API temporarily fails** (a request errors out): every screen audited shows a real, retry-capable failure state with the backend's own message — tap the visible "Reintentar" action, or navigate away and back. Never wait on a spinner with no retry option; if one appears, refresh the whole page once.

**If the session expires mid-demo**: you'll be routed back to Login. This is the real, correct auth behavior — log back in and resume from wherever you were; no state is lost server-side.

**If the browser cache shows an old build**: hard-refresh (Ctrl+Shift+R / Cmd+Shift+R). If a screen looks structurally different from what this runbook describes, this is the most likely cause — confirm the deployed build matches the expected release SHA before assuming a real regression.

**If a route loads slowly**: every screen's own loading state preserves its structural chrome (filters, headers, toolbars) rather than a blank page — this is expected, not a hang. Give it a few seconds before assuming a failure.

**If production has zero records for a step above**: that is the "expected empty state" listed for that step — treat it as a feature to point out ("even with no data today, the screen stays intact and readable"), not a problem to route around.

**If a module returns an honest empty/unavailable state** (e.g., Facturación CFDI's "Coming soon"): say so plainly — "this is intentionally not enabled yet in V1." Never imply it's broken or about to be fixed on the spot.

---

**PUSH: NO. DEPLOY: NO. This runbook describes an existing, already-deployed build — it does not itself change any code or data.**
