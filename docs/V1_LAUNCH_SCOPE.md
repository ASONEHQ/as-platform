# V1 Launch Scope — September 15, 2026

Derived from `docs/V1_PRODUCT_INVENTORY.md`, applying the launch scope
rule stated in TASK 14.2: for every module, "does a real park need this to
operate the V1 workflow on September 15?"

**TASK 14.2R update**: a full forensic parity audit against the
canonical legacy prototype (`AS POS V1.html`) is now complete — see
[[LEGACY_FUNCTIONAL_PARITY]], [[LEGACY_TO_CURRENT_MAPPING]], and
[[LEGACY_MISSING_PORTS]]. It confirms the core scope below remains
correct (the proven transaction/cash/refund/reward workflow is fully
ported, several parts categorically improved) and surfaces two
additional candidate P0 items worth an explicit business decision — see
the new subsection below — plus a longer P1/P2 list that does not change
this task's own scope.

**TASK 14.3 (Wave 1) update**: both candidate P0 items below, plus
Fiestas (brought forward from its own deferred future task by explicit
later instruction), barcode scanning, weight-based products, and sale
notes are now backend-complete and proven (100+ new integration tests,
a live 40-step end-to-end simulation, zero regressions in the full
929-test suite). Flutter UI is in progress. See [[LEGACY_FUNCTIONAL_PARITY]]
for per-capability status.

**TASK 14.4 (Wave 2) update — 2026-09-08**: five items originally listed
below as OUT OF SCOPE / POST-LAUNCH are now backend-and-Flutter-complete
and proven, ahead of when they were required — People/HR (roster,
scheduling, time clock, payroll), Suppliers CRUD (+ Compra Directa
linkage), the per-area Reports screen, Partial cash close + categorized
cash movements, and Access/Occupancy (a documented safe replacement of
the confirmed-fake legacy ticket-scan, not a port of it). None of these
were ever a Sept 15 *requirement* — being done early doesn't change the
launch-critical scope in "IN SCOPE for September 15" above, it just means
the business now has the option to enable them at or before launch if it
wants to. See [[LEGACY_FUNCTIONAL_PARITY]] for per-capability status.

**TASK 14.5 (Wave 3) update — 2026-09-08**: several more items originally
listed below as OUT OF SCOPE / POST-LAUNCH are now real and proven, ahead
of when they were required — a consolidated Dashboard screen, NFC
wristband activate/block/unblock, an AI assistant, register-style
keyboard shortcuts, PIN/QR staff quick-switch login, catalog CSV export,
inventory Kardex CSV export, a Flutter product-variants admin screen, and
a promotions usage report. None of these were ever a Sept 15
*requirement* — being done early doesn't change the launch-critical scope
below. Genuinely still not built, independently re-confirmed rather than
taken on faith: post-sale animation/sound, Kiosk/self-checkout mode,
scheduled email reports, per-tenant logo upload. The new Dashboard
deliberately omits the legacy's real sales-trend and active-membership
metrics; the new receipt header/footer admin screen persists real data
but isn't yet rendered on a printed receipt. See
[[LEGACY_FUNCTIONAL_PARITY]] for per-capability status.

## IN SCOPE for September 15

- Authentication, sessions, roles/permissions (real staff onboarding, not
  just the dev owner)
- Company, branch, cash register provisioning
- Catalog: categories, products, variants, prices, tax codes
- Inventory: stock-tracked products, opening balances, sale
  consumption/refund restoration
- Sales: multi-line, customer-attached, exact/change cash tender,
  cancellation
- Cash payments only (Mercado Pago LIVE explicitly paused for this launch)
- Receipts: print + historical reprint
- Refunds (partial/full), gated to whichever role the business assigns
  (cashier or manager — see the role matrix in `docs/GO_LIVE_CHECKLIST.md`)
- Customers: create/search/attach
- Cash register: open, movements, close, reopen next session, restart
  recovery
- Sales History / Cash Session Summary / Refunds list / Inventory
  Balances as the launch's reporting surface

## CONDITIONALLY IN SCOPE — real business decision required, not an
## implementation gap

- **Memberships**: fully built and proven; in scope ONLY if the business
  actually sells a real membership product at launch. If not, the module
  stays present but unused — it does not need to be disabled.
- **Promotions/Coupons**: fully built and proven; launch with an empty
  catalog of promotions/coupons unless the business supplies real ones.
  POS operates correctly either way.
- **AS Rewards+ / VIP 5+1 loyalty program**: fully built, concurrency-
  proven, and live-QA'd (TASK 13.1/13.2/14.0). Launch default is
  **inactive** per this task's own explicit instruction ("do not force
  launch dependency on Rewards"). If the business confirms they want it
  live at launch, enabling it is a configuration change
  (`rewards.enabled: true` in the launch config), not new code.

## CANDIDATE P0 ITEMS — RESOLVED in TASK 14.3 (Wave 1)

Both items below were flagged by the legacy parity audit and have now
been built — real backend, real tests, proven live end-to-end. Flutter
UI is in progress:

- **Suspended/held sales** — pause an in-progress ticket to serve another
  customer, recover it later. Built as `held_sale_carts`: real server-
  persisted cart snapshots (never browser-only), suspend/resume/discard,
  restart-proof (proven live: suspend → real process kill+restart →
  resume with exact items intact → checkout → pay).
- **Direct purchase / quick restock** — a manager records newly-arrived
  stock immediately without a formal purchase order. Built as
  `direct_purchases`: a real, atomic, idempotent commercial record
  alongside a real `receipt`-type inventory movement — proven live to
  correctly increase real, immediately-sellable stock.

## FIESTAS — brought into scope in TASK 14.3 (Wave 1)

Originally deferred as its own dedicated future task (see the original
reasoning preserved just below), Fiestas/party-reservations was later
explicitly brought into Wave 1 scope. The backend is now complete and
proven: real rooms/packages/reservations, database-enforced room-
conflict prevention (a GIST exclusion constraint), a deterministic
quote engine, deposit/balance tracking via the existing real cash-
movement system, on-demand contract/waiver document generation, and
real server-enforced permissions — 27/27 integration tests passing plus
a live 20-step end-to-end proof. Flutter UI is in progress. See
[[LEGACY_FIESTAS_RECOVERY]] and [[LEGACY_FUNCTIONAL_PARITY]] for detail.

**Original deferral reasoning (preserved for context, no longer the
active scope decision)**:

- ~~**Events / parties / scheduling** — genuinely unbuilt anywhere in this
  repository's history, and now confirmed by direct legacy-code
  inspection to have been a real, substantially-built module in the
  pre-migration prototype (calendar with genuine room-conflict
  detection, admin-managed rooms/packages, a live quoting tool, real
  contract/waiver generation) — see [[LEGACY_FIESTAS_RECOVERY]] for the
  full recovery. Per explicit user decision this session, this becomes
  its OWN dedicated future task (its own design pass, likely its own
  ADR), not rushed into TASK 14.2 alongside everything else. Cash-only
  POS checkout does not depend on it.~~

## OUT OF SCOPE for September 15 (see `docs/V1_POST_LAUNCH_BACKLOG.md`)
- **Mercado Pago LIVE** — explicitly paused per every task this session.
- **A dedicated aggregate Reports/BI dashboard** — ~~the underlying data
  is fully queryable today via existing screens~~ **the per-area report
  screens are DONE (TASK 14.4 Wave 2, extended TASK 14.5 Wave 3)**: 8 real
  report areas (Sales/Financial/Inventory/Customers/Employees/Parties/
  Access/Promotions), server-side aggregated, CSV export on Sales/
  Financial/Inventory Kardex. Still a POST-LAUNCH nicety, not a launch
  requirement — **the single consolidated "today at a glance" dashboard
  screen is also now DONE (TASK 14.5 Wave 3)**: real today's sales,
  occupancy, parties, open register/session status, outstanding party
  balances, employee attendance — deliberately NOT including the legacy's
  real %-vs-yesterday sales trend or active-membership count (consciously
  scoped out, not fabricated fields), see [[LEGACY_MISSING_PORTS]].
- **Per-tenant receipt branding (custom logo per company)** — today's logo
  is one shared, app-bundled mark, still true for the logo specifically.
  **TASK 14.5 (Wave 3) partial update**: receipt header/footer text now
  has a real admin screen that persists real data, but is independently
  confirmed NOT yet threaded into any of the 4 real print call sites — so
  configured text does not appear on a printed receipt yet. Per-tenant
  logo upload itself remains fully undone (no file-upload infrastructure
  exists anywhere).
- **Forced password-change-on-first-login policy** — no such mechanism
  exists; mitigated procedurally (the owner hands out a real password
  directly) for launch.
- **CFDI / fiscal tax invoicing** — explicitly out of scope per ADR-0012;
  the printed receipt self-labels as "not a fiscal invoice." The legacy
  audit additionally confirms the prototype's own CFDI feature never
  really worked either (simulated fiscal stamping, self-admitted in its
  own code and toasts) — there is no working capability being deferred.
  **Unchanged and untouched by TASK 14.4 (Wave 2)** — no billing/CFDI
  work was done this wave.
- **Employee payroll (nómina), time clock, shift scheduling** —
  ~~a genuinely real, substantively-built domain in the legacy prototype
  with zero current equivalent~~ **DONE (TASK 14.4 Wave 2)**: real
  `employees`/`employee_schedules`/`time_clock_punches`/
  `payroll_periods`/`payroll_period_lines`, with payroll calculation a
  faithful port of the legacy's own `calcularNominaEmpleado()` formula.
  Still not a Sept 15 POS-operation *requirement* — see
  [[LEGACY_MISSING_PORTS]].
- **Purchasing / suppliers (formal PO workflow + supplier CRUD)** — the
  legacy's own formal purchase-order workflow never actually worked
  (discarded entered data), so rebuilding it owes nothing to its own
  implementation; **the formal PO workflow remains out of scope,
  re-confirmed this wave**. Direct purchase/quick restock is DONE (Wave
  1) and supplier CRUD is now also **DONE (TASK 14.4 Wave 2)** — a real
  `suppliers` table + module + Flutter screen, linked into Compra Directa
  via a frozen-name-snapshot `supplier_id`.
- **A dedicated Flutter "manage staff"/"company settings" admin screen** —
  the authenticated API already supports everything needed; provisioning
  happens via CLI/API today, a Flutter screen for it is a POST-LAUNCH
  convenience.

## Explicit non-goals for this task

- No speculative features were added.
- No module was rebuilt that already existed and worked.
- No Inflapark-specific value was hardcoded into shared application logic
  (independently audited — see TASK 14.2's own final report).
