# Monday Presentation Risk Register — AS ONE

TASK 16.30. Every remaining known issue as of this task's own audit, classified P0-P3. Companion to `docs/MONDAY_DEMO_RUNBOOK.md` (the walkthrough script) and `docs/PRESENTATION_READINESS.md` (TASK 16.26's own prior audit, whose findings are folded in here and marked accordingly).

**Classification**:
- **P0** — presentation blocker. None found.
- **P1** — materially damages the demo (visible, embarrassing, or confusing to a first-time audience). Two found this task; both fixed.
- **P2** — visible but acceptable (a first-time viewer might notice, none would consider it broken).
- **P3** — post-demo polish (a developer would notice; a business audience would not).

## Summary

| Severity | Found this task | Fixed this task | Remaining |
|---|---|---|---|
| P0 | 0 | — | **0** |
| P1 | 2 | 2 | **0** |
| P2 | 3 | 0 (documented) | 3 |
| P3 | 6 | 0 (documented) | 6 |

Combined with TASK 16.26's own prior audit (`docs/PRESENTATION_READINESS.md`, still valid — no regression found this task): **0 P0, 0 P1 open across both audits.**

---

## P1 — found and fixed this task

### P1-1. Raw English/enum status words rendered verbatim across the app

- **Route/module**: shared `_StatusChip` widget (`pos_shell.dart`) — used by Productos (POS grid card), Promociones, Cupones, Corte de Caja (register open/closed), Clientes, Membresías, Planes de membresía, Fiestas → Ajustes (room/package status dropdowns); shared `_StatusPill` widget (`pos_inventory_admin_screen.dart`) — used by Movimientos/Traspasos/Conteos/Reservas/Ajustes(Hallazgos)/Ubicaciones; `_ReportsStatusTable` (`pos_reports_screen.dart`) — Reportes → Clientes "Clientes por estado"/"Membresías por estado".
- **Symptom**: chips/tables/dropdowns showed the raw backend value verbatim — English words like `active`/`inactive`/`closed`, or raw snake_case like `expired`/`cancelled`/`counting`/`maintenance`/`out_of_service` — instead of a Spanish label, in a Spanish-language product.
- **Impact**: highly visible — these are some of the most-viewed widgets in the app (every list row, every register status). Would read as unfinished/untranslated in front of an audience.
- **Fix**: each of the three widgets now translates its raw value to Spanish for display only; color/positivity classification still keys off the original raw value, so no behavior changed. Corte de Caja's "open" register state is now a distinct key (`'open'` → "Abierta") from generic "Activo," matching this same screen's own pre-existing "Abierta"/"Cerrada" vocabulary (its Cortes de caja history filter already used those words). Verified no other test or screen collides with the new Spanish words (two legitimate pre-existing collisions found and handled: a count/transfer detail dialog's own "Enviado"/"Aprobado: <fecha>" rows now legitimately co-occur with the same-worded status pill — not a duplicate the fix introduced, covered by an updated test comment).
- **Workaround if seen anyway**: none needed — fixed and test-covered.
- **Recommended post-demo task**: none required; consider auditing for any other raw-enum display in modules not sampled this pass (Compras, Consolidado de Sucursal) as a low-priority follow-up.

### P1-2. Raw snake_case enum values in inventory movement/reservation/count displays

- **Route/module**: Inventario → Admin. Inventario → Movimientos (list row + detail), Conteos (list row + detail "Alcance"), Reservas (list row + detail "Propietario").
- **Symptom**: `movement.movementType` (e.g. `transfer_shipment`, `opening_balance`), `count.scopeType` (e.g. `all_balanced_variants`), and `reservation.ownerType` (e.g. `pos_cart`) rendered as raw snake_case, even though the equivalent create-dialogs already had the correct Spanish label to reuse.
- **Impact**: this is a real, frequently-used operations screen (stock movements/counts/reservations) — raw snake_case here reads as an unfinished internal tool rather than a finished product.
- **Fix**: added small label maps reusing the exact same Spanish wording the corresponding create-dialogs already use (no new vocabulary invented). `reservation.ownerId` (a raw UUID) is intentionally left as-is — see P2-1 below.
- **Recommended post-demo task**: none required for the fixed values.

---

## P2 — visible but acceptable, not fixed this task

### P2-1. Access Control shows a raw customer/sale id, not a resolved name

- **Route/module**: Administración → Control de Acceso, credential detail ("Cliente: `<uuid>`" / "Venta: `<uuid>`").
- **Symptom**: `PosAccessCredential` carries only a raw `customerId`/`saleId` — no name/folio field exists on the model, and no existing customer-lookup gateway is wired into this screen.
- **Impact**: this is the screen a cashier looks at on every real scan, in front of a customer — a raw id is a real, visible rough edge, though it never blocks the actual access-control decision (grant/deny still works correctly on real data).
- **Why not fixed this task**: resolving it requires either a new client-side join against a customer/sale list (a real, non-trivial new cross-module dependency and fetch/loading-state addition) or a backend model change — both larger than a "prefer frontend-only, small fixes" pass this close to a deadline, and this task's own instructions require a genuine P0/P1 to justify a backend change.
- **Workaround for the demo**: see `MONDAY_DEMO_RUNBOOK.md` Step 10 — browse occupancy, avoid dwelling on a scanned credential's raw id fields; if asked, describe it honestly as a known next-iteration polish item.
- **Recommended post-demo task**: add a client-side customer-name/sale-folio join to `PosAccessScreen`, mirroring the pattern already established for Nómina's employee-name join (TASK 16.29).

### P2-2. "Historial de Ventas" lives under Administración, not Ventas

- **Route/module**: sidebar — `Historial de Ventas` (Administración group) vs. `Punto de Venta`/`Ventas Suspendidas`/`Devoluciones` (Ventas group).
- **Symptom**: every other sales-transaction screen lives in the Ventas group; this one is grouped with Dashboard/Reportes/Usuarios/etc. instead.
- **Impact**: a first-time user looking for "where did my sales go" would plausibly check Ventas first.
- **Why not fixed this task**: the code's own comments confirm this placement deliberately mirrors a legacy HTML sidebar structure. Moving a sidebar entry is a real information-architecture change with its own regression surface (navigation tests, muscle memory for existing users) — the task's own instructions explicitly say not to move this "merely for aesthetics," and the evidence here, while real, is not strong enough to justify a nav change days before a presentation.
- **Workaround for the demo**: mention its location explicitly if walking through Ventas ("sales history itself lives under Administración").
- **Recommended post-demo task**: a deliberate, tested IA decision (not a quick fix) — either move it to Ventas or explicitly document the reasoning for keeping it in Administración in user-facing help copy.

### P2-3. Confusable sidebar label/icon pairs

- **Route/module**: sidebar-wide.
- **Symptom**: "Inventario" vs. "Admin. Inventario" (subset naming); "Marcas" (Catálogo) vs. "Marca del Ticket" (Sistema); "Clientes" (group header) vs. "Clientes" (its own first child item, same label); "Catálogo" vs. "Catálogo Avanzado"; three group headers (Clientes/Administración/Sistema) share their icon with their own first/primary child item.
- **Impact**: low — a first-time user might briefly hesitate, but every item is still reachable and correctly labeled once opened; nothing is mislabeled, only similarly named.
- **Why not fixed this task**: the codebase's own comments confirm these are deliberate, legacy-mirrored conventions (icon reuse on a group's primary item is explicitly documented as intentional). Renaming established, already-shipped business concepts without stronger evidence of user confusion is explicitly out of scope this task.
- **Recommended post-demo task**: a future, dedicated IA/naming pass with real user feedback — not a pre-demo guess.

---

## P3 — post-demo polish, not fixed this task

1. **~12 admin screens show a bare, unlabeled loading spinner** (branch admin, branch consolidation, readiness, etc.) — functionally harmless, all bounded (never indefinite). Documented in TASK 16.26's own audit; unchanged.
2. **All payment-method checkout failures surface through a generic (but message-specific) SnackBar** rather than a dedicated failure widget. Not misleading, just plain. Documented in TASK 16.26's own audit; unchanged.
3. **`Facturación CFDI` has no dedicated "deferred" marker** in `pos_navigation.dart` the way a couple of other removed/deferred modules do — it simply falls through to the generic `_ComingSoon` state. Functionally correct and honest (never claims to be enabled), just worth a one-line doc comment for a future maintainer's clarity.
4. **Reports → Inventario's own "movementType" cell** (a *different* raw value, `restock`, on the Reports side — not the Admin. Inventario screen fixed this task) is not yet run through a label map. Lower urgency than P1-2 since Reports' own tab is a read-only summary view seen less often than the operational Inventario screens.
5. **No PDF export exists for Horarios or Nómina.** Documented already in `docs/WORKFORCE_SYSTEM.md`; unchanged, deliberate deferral.
6. **Lateness tolerance and overtime rate remain hardcoded constants**, not tenant-configurable. Documented already in `docs/WORKFORCE_SYSTEM.md`; a deliberate, already-reviewed product decision, not an oversight.

---

## Explicitly NOT inflated to P0/P1

Per this task's own instruction not to treat cosmetic preferences as blockers, the following were considered and deliberately left as **P2/P3 or not-an-issue**, not escalated:

- Sidebar icon/group conventions (P2-3) — a legacy-mirrored, documented design choice, not a defect.
- "Historial de Ventas" placement (P2-2) — real but insufficient evidence to justify a pre-demo IA change.
- CFDI's honest "coming soon" state — this is the **correct, intended** behavior for an explicitly out-of-scope V1 feature, not a gap to fix.
- Bare loading spinners (P3-1) — cosmetic, bounded, never indefinite.

## Regression check against TASK 16.26's prior audit

Re-confirmed still true, no regression: Fiestas untouched and fully test-covered; Control de Acceso and Empleados branch-switch remount fixes (TASK 16.26) still present; POS unified checkout completion (TASK 16.27) still present; Reports' loading-label fix and sidebar "Control de Acceso"/icon fixes (TASK 16.26) still present.

**PUSH: NO. DEPLOY: NO. PRODUCTION WRITES: ZERO.**
