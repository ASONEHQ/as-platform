# Operational & visual polish (TASK 17.4)

A large audit-first task: bring visual/operational strengths from an
older UI reference into ACCESS GO's current architecture, without
regressing tenant isolation, branch isolation, multi-branch authorization
(TASK 17.3), recipes, inventory, or sales. The old UI is a **structural
reference only** — the current backend is the source of truth, and
nothing here is built without a real, already-authoritative data source
behind it.

## Baseline

Started at `release/as-pos-v1` = `a434af61e846673c109c323d2b7957f2470aad65`
(the TASK 17.3 push), ahead/behind 0/0, clean tree. TASK 17.3's
authorization model is treated as an invariant throughout — nothing in
this task touches `auth.repository.ts`, `auth.service.ts`, or
`admin.service.ts`.

## Audit matrix

Six parallel audits covered every requested area. Several findings
materially correct the task's own stated premises — the codebase had
moved on since those assumptions were written, and the audit is the
authoritative check, not the prompt.

| Area | Class | Finding |
|---|---|---|
| POS product cards | A | Image, name, price, stock, featured-star already render (`_PosProductCard`, `pos_shell.dart`). No category badge/description/round add-button — pure polish, not backend work. |
| POS categories | A | Already 100% backend-driven (`_CategoryStrip` reads the real `PosCategory` list) — zero hardcoding to fix. |
| Cafetería | A | Not a fork of POS — the same `_PosSale`/`_PosProductCard` surface, scoped by the real `operational_group='cafeteria'` classification (TASK 16.13A). Any POS card polish applies here automatically. |
| Product images | **A — premise was wrong** | The full stack already exists: `products.image_url`, dedicated S3-style object storage mirroring the branding-logo pattern (`product-images.storage.ts`), upload/delete routes, `Image.network` rendering with icon fallback, already wired into `_PosProductCard`. Nothing was missing. |
| Sellable-only guarantee | A | Backend-enforced on both the list fetch and the barcode/SKU lookup path (same query, same predicate) — confirmed by an existing integration test. Untouched. |
| Product archive/delete | A | Real `status` state machine (`draft`/`active`/`inactive`/`retired`) with an enforced soft-delete (`deleted_at`) check constraint. No hard-delete route exists to design around. |
| Inventory Existencias | A | Real card-list with every field a denser table would need already fetched. Converting to a table is pure layout work. |
| Inventory KPIs | A | The 4-tile strip already matches the real overview model exactly. |
| Inventory valuation | **F — stays unavailable** | Re-confirmed still zero authoritative unit-cost source anywhere (`average_unit_cost` hardcoded to `0` on every write path; the backend type is a `false` literal, not `boolean`). Must keep showing "No disponible" — never fabricated. |
| Inventory activity | A | TASK 17.2.4's human-language presentation is intact and regression-tested (a test explicitly asserts `sale_consumption` never reappears as primary text). |
| Dashboard | D → **fixed this task** | 11 equal-weight KPI cards, no alerts panel, `birthdaysToday` fetched but unused. See §Dashboard below. |
| Fiestas del día | A | Already exists as a list card on the Dashboard — needs restyling, not new plumbing (not restyled this task; see Deferred). |
| Ventas/hora | **B → fixed this task** | The Dashboard's own `salesReport` call already computed `salesByHour` — it was simply never read out of the response. |
| Alertas | **B → fixed this task** | No panel existed. `inventory-overview`'s low/out-of-stock signals and the party `pending_deposit` status were both already real, computed data — composable without new queries. |
| User cards | A/D | Name/status/role/branch-scope/permission-count are real and complete. No job-title/phone — `PosUser` has no such fields at all; adding them needs a new cross-module Employee lookup that doesn't exist today (no reverse `user_id` filter on `GET /employees`). |
| User Datos/Acceso/Permisos (3-tab edit) | B/E | Effective-permissions union is already computed server-side per role. No per-user permission overrides exist anywhere in the schema — must never be invented. Not implemented this task (see Deferred). |
| Admin verification (PIN gate before sensitive edits) | **E — do not build on `pinLogin`** | `pinLogin` authenticates as **any** staff member whose PIN matches — it does not verify "this is specifically the currently-logged-in admin." Using it for a step-up gate would silently accept a different employee's correct PIN. A real "confirm it's you" endpoint does not exist. Deferred, not repurposed. |
| User PIN storage | A | `company_memberships.pin_hash`/`qr_secret_hash` already exist, argon2id, byte-identical convention to password hashing. A PIN-management UI is safely buildable without any migration — just not built this task (see Deferred). |
| Cashier switch | **A — prior finding was stale** | Re-verified against current HEAD, not trusted from old docs: `_StaffQuickSwitchDialog` → `AuthController.quickSwitchByPin/Qr` → real token replacement + session re-hydration is genuinely wired in production (`dashboard_screen.dart`). Not a gap. |
| Employee cards | A | Already rich (initials, status, position, phone, salary, code). |
| Employee creation | **A — premise was wrong** | Fully wired end-to-end already; enabled whenever `employee.manage` + a branch are present. Nothing was disabled. |
| Employee edit | A | Full `PUT` + `If-Match` flow already real. |
| User ≠ Employee | A | `employees.user_id` nullable, explicit-link-only, zero automatic name/email matching. Confirmed intact, unmodified. |
| — (real bug found) | — | `_EmployeeDetailDialog` showed weekly salary unconditionally to anyone with mere `employee.read` — the card already correctly gated it behind `employee.manage`. **Fixed this task.** |
| Configuración | **F — premise was wrong** | The "Configuración" nav item is the TASK 16.17 tenant-readiness/go-live checklist, not a settings editor. Real settings live as separate sibling nav items ("Marca del Ticket", "Impresora de Tickets"). Repurposing it would collide with its real identity — not done. |
| Logo | **B → fixed this task** | Full backend + `PosBrandingScreen` already existed (TASK 17.1-protected storage) but had zero nav entry anywhere — reachable only via a button buried inside "Marca del Ticket". |
| Impuestos | **E — stays deferred** | No tax-rate settings model exists anywhere; tax is a fixed 2-value classification (`IVA_GENERAL`/`IVA_EXEMPT`), not a configurable rate. |
| Notifications | **E — stays deferred** | Zero backend of any kind. |
| Zona de riesgo | **E — stays deferred, correctly** | No delete/reset/wipe operation exists; the settings module doesn't even expose its own internal `retire*` methods over HTTP. No destructive UI was built. |

## Implemented this task

1. **Employee compensation-visibility fix** (`pos_people_screen.dart`) —
   `_EmployeeDetailDialog` now gates weekly salary behind
   `employee.manage`, matching `_EmployeeCard`'s own pre-existing gate.
   Proven by two new tests: a read-only actor never sees it, a
   manage-permitted actor still does.

2. **Dashboard reorganization with real alerts** (`dashboard.*`,
   `reports.repository.ts`, `pos_dashboard_gateway.dart`,
   `pos_shell.dart`):
   - Backend: `reports.repository.ts`'s `inventoryBalanceTotals` now
     also computes `lowStockVariantCount`, using the exact same
     `min_stock` threshold `inventory.repository.ts`'s own
     `STOCK_STATUS_EXPR` already uses elsewhere — never a second,
     divergent low-stock definition. `salesByHour` is forwarded from
     the same `reportsService.salesReport()` call the Dashboard was
     already making — no new query.
   - Frontend: a new "Alertas" panel pulls the out-of-stock signal off
     the flat KPI grid (removed as a duplicate tile, not kept in both
     places) and adds low-stock and party-pending-deposit rows, each
     from data already in the payload (`partyStatusBreakdown['pending_
     deposit']` was already fetched, just unused). Every row navigates
     to its real module. An honest "Sin alertas activas." when there is
     nothing to show — never a hidden panel.
   - A new "Ventas por hora" chart reuses `PosBarChart` verbatim, the
     same widget already proven in the Reports screen.
   - Birthdays were deliberately **not** added to this tab: they're
     already shown by the always-visible top banner in
     `dashboard_screen.dart` (a separate, independent fetch of the same
     gateway). Adding them here too would duplicate, not close, a gap.

3. **Logo screen nav entry** (`pos_navigation.dart`, `pos_shell.dart`) —
   `PosBrandingScreen` (unmodified) now has a real "Logo del Negocio"
   entry in the Sistema group, gated on `company_settings.read` like its
   siblings. No new backend, no new storage, no new screen.

## Deferred (real gaps, not attempted this task)

Given the scope certified by the audit, these are genuine, scoped gaps —
not attempted here because each needs either a larger, carefully-tested
UI effort or new backend design that this pass's "implement what is
safe" mandate does not cover in one sitting:

- **POS/Cafetería product card visual polish** (category badge,
  description line, round add-button) — backend fully supports it
  today; zero blockers, just not yet built.
- **Inventory Existencias dense-table redesign** — every field is
  already available; a genuine layout rewrite, not attempted.
- **Users 3-tab edit flow (Datos/Acceso/Permisos)** — the existing
  detail dialog already covers Acceso/Permisos reasonably; a full
  redesign with a dedicated "Datos" tab needs the Employee cross-module
  lookup this task's audit found missing (see Users Datos row above).
- **Employee card visual redesign** — already functionally rich; not
  restyled.
- **User PIN management UI** — storage and hashing are real and ready;
  the UI itself (set/reset PIN from a user's Acceso tab) was not built.
- **Admin step-up verification before sensitive edits** — explicitly
  NOT built on `pinLogin` per the audit's own finding (§Audit matrix);
  a real, narrower "confirm it's you" endpoint would need to be
  designed first. Reported as a blocker, not worked around.
- **Fiestas del día restyling** — functionally present, not visually
  promoted within the Dashboard.
- **Full Configuración reorganization** — blocked by the premise
  correction above (Configuración ≠ settings editor); a real redesign
  would need to either repurpose the readiness-checklist nav slot
  (colliding with its own identity) or introduce a genuinely new
  settings hub, neither of which this task attempts unreviewed.

None of these are blocked by the backend — every one of them is real,
buildable work with a known, already-audited path forward.

## Known, deliberate non-goals (confirmed, not just skipped)

- **Inventory valuation** stays "No disponible" — no authoritative unit
  cost exists anywhere in the system.
- **Tax configuration UI** — no configurable rate model exists; tax is a
  fixed classification.
- **Notification preferences** — no backend of any kind exists.
- **"Zona de riesgo" destructive reset** — no safe backend operation
  exists to back it; never recreated.
- **Cashier-switch UI polish** — the underlying mechanism is already
  real and correct (re-verified against current HEAD, not assumed from
  stale docs); no changes needed.

## Security

Every mutation touched or reasoned about in this task keeps the backend
as the sole authority:

- The employee salary fix only changes what the Flutter client *shows*
  — `employees.routes.ts`'s own response shape was not touched, and the
  fix only closes a client-side over-disclosure, not a server-side
  authorization gap (the server already required `employee.read` for
  the underlying data; the leak was purely that a lesser-privileged
  actor could see a field the UI should have hidden from them, matching
  what the card already did).
- The Dashboard alerts panel and sales-by-hour chart expose only
  already-permission-gated (`report.read`) and already-branch-scoped
  data; no new endpoint, no new permission, no new query pattern.
- The logo nav entry points at an unmodified, already-protected screen
  (`company_settings.update` on the underlying mutations, TASK 17.1's
  object-storage ownership checks unchanged).

## Tests

- `pos_people_test.dart`: 2 new tests (salary hidden/shown by
  permission) — 33/33 passing.
- `apps/api` `dashboard.integration.test.ts`: extended with a low-stock
  fixture variant (proving `lowStockVariantCount` counts independently
  from, never double-counted with, out-of-stock) and a `sales.by_hour`
  assertion against the real branch-timezone hour bucket — 14/14
  passing against real Postgres.
- `apps/api` `reports.repository.ts`/`reports.service.ts`/
  `reports.routes.ts`: covered by the existing Reports integration
  suite — 28/28 passing, unchanged behavior for every pre-existing
  field.
- `pos_shell_wave3_dashboard_test.dart`: extended with a new "Dashboard
  Alertas" group (4 new tests: real counts render as distinct rows,
  pending-deposit renders its own row, tapping an alert row navigates
  via the real `onNavigateToModule` callback, the sales-by-hour chart
  renders real bars) plus an honest-empty-state assertion — 13/13
  passing.
- `pos_shell_test.dart`: the fixed module-count test (32 → 33) updated
  to reflect the new `PosModule.logo` entry — 284/284 passing full
  suite.
- `pos_branding_test.dart`: unaffected, 10/10 passing (the screen itself
  was not modified, only given a new front door).

## Responsive

Not independently re-verified this task beyond the pre-existing
Dashboard/Users/Employees responsive coverage — no layout was changed
in a way that alters narrow-width behavior (the Alertas panel and
sales-by-hour chart reuse the same `_PosCard`/`_DashboardListCard`
chrome and the already-narrow-safe `PosBarChart` widget).

## Files changed

Four local commits, no push:
- `fix: gate compensation visibility in employee detail dialog`
- `feat: reorganize dashboard with operational alerts`
- `feat: give the logo screen its own nav entry`
- `docs: document operational visual polish` (this file)
