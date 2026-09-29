# ACCESS GO Product Polish — TASK 17.5

Audit-first product-quality pass over the production-backed ACCESS GO release.
Preserves all backend, security, RBAC, multi-branch authorization, inventory
ledger, recipes, sellability, and PIN security exactly as they were.

## What changed

### Dashboard
- **KPI density**: the 8-card KPI grid was compacted (`childAspectRatio`
  1.5/2.6 → 1.9/3.4, tighter icon/gap/font sizes) — every real metric unchanged,
  the row now consumes noticeably less of the first viewport.
- **Sales/hour sparse-state fix**: `PosBarChart` (shared with Reports/
  Inteligencia) used to give every bar an `Expanded` column, so 1-2 real
  datapoints stretched to fill the entire chart width *and* height — a "solid
  rectangle" with no visual meaning. Six bars or fewer now render at a fixed,
  centered width instead; a normal 24-hour day (more than 6 bars) is unchanged.
  No zero-value hour is ever fabricated to "fill out" the chart.
- **Alerts / Parties-today / Open-registers**: audited and found already correct
  — real data, already-compact empty states. No change needed (see audit notes
  below — the original "giant empty container" concern did not reproduce in the
  current code).
- **Development-era copy removed**: "calculado por el servidor. Sin métricas
  simuladas." and "datos reales del backend" style assurances removed from the
  Dashboard, Users, Employees, and Caja headers — the underlying honesty
  guarantee (never a fabricated metric) is unchanged, only the internal-sounding
  copy is gone.

### POS / Cafetería product cards
Audited in detail. The card already matches the target hierarchy (image →
category badge → name → description → price → add action), SKU is already
small/muted (9px, not visually dominant), there is **no** "turns solid blue when
selected" state anywhere in the code (a tap adds to cart immediately — no
selection concept exists to over-style). Cafetería confirmed to still share the
identical `_PosProductCard` widget, single call site pattern. No changes made —
the production concern did not reproduce in this exact codebase state.

### Catalog — sale price UX
- **Money formatting**: the branch price-override list showed the raw 4-decimal
  backend wire format (`"50.0000"`) verbatim. Now renders via `Money.
  toDisplayString()` (`"$50.00"`) — presentation only, stored/calculated
  precision unchanged.
- **Price vs. cost / save semantics**: audited in detail. The sale-price and
  cost fields are already styled identically (no "looks disabled" bug found);
  "Guardar precio" and "Guardar costo y stock mínimo" are two genuinely separate,
  correctly-wired mutations, and the modal-level "Guardar" never touches
  price/cost — no dead button, no misleading double-save found. No change made.

### Inventory Existencias
- **Redundant identity removed**: the desktop table's Producto cell used
  `displayName` (`"calcetas (calcetas)"`) right next to its own dedicated SKU
  column showing the SKU again. Now uses a name-only accessor for the table
  specifically (every other `displayName` call site — dropdowns with no adjacent
  SKU field — is unchanged, since the SKU is still useful context there).
- **Unit humanization**: the table's unit-of-measure column showed the raw code
  (`"unit"`) verbatim. Now reuses this file's own existing, tested, pluralization-
  aware `_unitLabel` resolver (already used by every movement/transfer/count line)
  instead of a second, invented mapping.
- **Thousands separators**: quantities now render `1,000` instead of `1000` —
  presentation only, the underlying parse/truncate logic (and its 6-decimal
  backend precision) is unchanged.
- **Actions column**: audited. Real content only for `Insumo`-type rows with a
  variants gateway ("Usado en"); every other row's Acciones cell is a genuine
  empty `SizedBox.shrink()`, not a fake/placeholder control. Left as-is — adding
  more actions to that cell would need wiring existing adjustment dialogs
  in, which was judged out of scope for this pass; not a fake-control problem.
- **Valuation**: confirmed still honestly "Valor no disponible" — unchanged,
  correct.

### Users / Roles
- **Protected-permission presentation**: a disabled `Switch(value: true)` for a
  protected (Owner) role's granted permission read visually close to "disabled
  and absent" — exactly the production concern raised. Owner-role permissions
  now render as an unmistakable read-only "Otorgado"/"No otorgado" pill instead
  of a `Switch` nobody could ever operate anyway; every editable role's `Switch`
  is completely unchanged.
- **User/KPI card density**: audited — both already compact for their real
  content (a prior task already shortened them). No further change made.

### Employees
- **Hire date**: replaced the plain `TextField` expecting a manually-typed
  `YYYY-MM-DD` string with a real `showDatePicker`, writing the exact same ISO
  date string into the same save path. A "Quitar fecha" affordance was added
  since the field is now `readOnly`.
- **Linked user (`Id de usuario vinculado`)**: audited — `PosIdentityAdminGateway.
  listUsers()` already exists and could back a real search/selector without any
  backend change. **Not implemented this pass** (a genuine new UI surface, not a
  small fix) — flagged as a ready, low-risk next step in this document rather
  than rushed.
- **Salary RBAC**: confirmed unchanged (`_canManage`/`showSalary` gate intact).

### Reports — inventory valuation honesty fix
Found, while auditing Inventory Existencias, that the **Reports** module's
`inventory_value` field (a different endpoint than the Inventory admin screen,
which was already honest) always computed `sum(quantity_on_hand * average_unit_cost)`
against a column that is hardcoded to `0` on every write path in this codebase —
i.e., it always silently returned a fabricated "$0.00" rather than the honest
"unavailable" the Inventory admin screen already showed for the identical
underlying gap. This directly violated this task's own "no fake inventory
valuation" invariant, so it was fixed: the backend now returns
`inventory_value_available: false` with a real reason string, and the Reports
screen shows that reason instead of a misleading zero. `inventoryValueByCurrency`
is left in the repository, unused, for whenever a real costing method lands.

### Configuration / System Status
Audited in detail (scope clarity, logo, System Status density). Company-vs-branch
scope clarity for Negocio/Ticket/Hardware settings was confirmed as a real,
presentation-only gap (all three are genuinely company-scoped; the UI never says
so, and the topbar's branch chip could reasonably be misread as implying
branch scope). **Not implemented this pass** — flagged as a small, safe next
step (a one-line "Aplica a todas las sucursales" label). System Status density
was found already reasonably compact; no change made.

### Schedules / Time Clock
Audited — both confirmed real, backend-wired, and honest (Checador's
"Próximamente" biometric-device disclosure preserved verbatim). No changes made.

## Payroll V2 and Parties commercial flow

Both are MAJOR workstreams per this task's own framing and were audited in full
depth (see `docs/PAYROLL_V2_ARCHITECTURE_GAP.md` and
`docs/PARTIES_COMMERCIAL_FLOW_GAP.md`). Summary: the parts of both that already
exist are genuinely real and server-authoritative (payroll's salary snapshot,
close/reopen audit trail, and totals; parties' balance calculation, idempotency,
and audit trail). The concrete gaps identified — manual payroll adjustments,
payroll historical-finalization guarantees, saved/printable party quotations, and
a payment-method (card/transfer) distinction for parties — each require either a
schema change or a business-rule decision this task is not authorized to make
silently, and none were implemented. A payroll receipt/PDF was identified as
architecturally safe (existing HTML+print infrastructure, all data already
returned) but was not built this pass — see the gap doc for why.

## Training readiness

`docs/ROLE_PERMISSION_TRAINING_MATRIX.md` documents current role/permission
behavior from code (never from role names), distinguishing implemented current
state from business decisions still required — most notably whether a seeded
"Gerente" role should see Dashboard/Reports (currently: yes, as seeded, but fully
editable per tenant) and the fact that no support-contact channel exists or was
invented.

## Explicitly NOT implemented (and why)

- **Party payment method (card/transfer)**: no schema column exists for it;
  adding a selector without deciding the cash-session accounting question first
  would have either miscounted cash drawers or misled operators. See gap doc.
- **Saved/printable party quotations**: no entity exists to save; building one
  requires a new table and an expiration/editability policy decision. See gap
  doc.
- **Payroll manual adjustments**: would be silently erased by the next
  recalculation without a new column; not built without that column. See gap
  doc.
- **Payroll receipt/PDF**: identified as safe and ready, deferred for scope/time,
  not because of any architecture blocker.
- **Employee linked-user selector**: identified as safe and ready (existing
  `listUsers()` API), deferred for scope/time.
- **Configuration company-wide scope label**: identified as safe and ready,
  deferred for scope/time.

None of these were faked, stubbed, or partially built — each is either fully
real or not present at all.

## Preserved (explicitly verified unchanged)

- Sellability guard, recipe consumption, inventory ledger authority — no
  backend inventory/recipe file was touched.
- TASK 17.3 multi-branch authorization, company/branch isolation, Owner
  protection, self-escalation protection — no `auth.*` backend file was touched.
- PIN security (TASK 17.4.4/17.4.5): hashed server-side, never returned/logged/
  displayed, verified server-side — untouched this task.
- TASK 17.1 object-storage branding ownership — `pos_branding_screen.dart`
  itself was not touched.
- Salary RBAC gating.

## Responsive

See the final report's RESPONSIVE section for the certified size matrix
(1440×900 / 1365×768 / 1024×768 / 390×844) across every changed module. The
pre-existing Movimientos/Traspasos/Conteos/Reservas narrow-width overflow
(documented since TASK 17.4.1/17.4.2) is unrelated to this task's changes and was
not touched.
