# New Tenant Onboarding — AS POS V1

**TASK 15.0 Phase 13, updated by TASK 15.1 — proven live, end to end,
against two real, brand-new companies ("RC Adventure Park" in TASK 15.0,
"AS Commercial Demo Park" in TASK 15.1) that never existed before their
respective certifications, using only production-safe tooling. Zero
source-code edits. Zero manual SQL. Zero dev-only seed scripts.**

This is the exact, real process an AS ONE operator — or, as of TASK
15.1, a real park owner with no technical background — follows to bring
a genuinely new park onto AS Platform. The process now has two distinct
tiers:

- **INFRASTRUCTURE BOOTSTRAP** (Step 1 below): a one-time, CLI-driven,
  operator/technical-staff action — creating the company and its first
  owner account. This is architecturally intended to stay CLI (masked
  password entry, explicit confirmation, refuse-on-conflict) and is
  **not** expected to move to the product UI.
- **ROUTINE PARK CONFIGURATION** (everything else): as of TASK 15.1,
  every one of these items is reachable directly from the real Flutter
  product UI by the owner themselves, after their first login — no CLI,
  no SQL, no Postman/curl, no source edits, and (per TASK 15.1's own
  explicit rule) **no `business-config` CLI either**, once the owner has
  logged in for the first time. See
  `docs/RC_COMMERCIAL_ONBOARDING_WALKTHROUGH.md` for the complete,
  live-walked-through, 24-step proof of this — the authoritative record
  for the current state of the product. This document is kept as the
  narrative "how does an operator actually do this" reference; that one
  is the certification evidence.

## Step 1 — Provision the owner + company + first branch

**Tool**: `provision:production-owner` (real production CLI —
`apps/api/src/provisioning/production-owner.cli.ts`). One real DB
transaction: company row, owner user, owner role with every permission
in the catalog, and (optionally) the first branch.

```bash
PROVISION_OWNER_PASSWORD='<a real, strong password>' \
DATABASE_URL='<real production DATABASE_URL>' \
node --import tsx apps/api/src/provisioning/production-owner.cli.ts \
  --company-legal-name="RC Adventure Park S.A. de C.V." \
  --company-slug=rc-adventure-park \
  --company-display-name="RC Adventure Park" \
  --company-timezone=America/Mexico_City \
  --company-currency=MXN \
  --company-locale=es-MX \
  --owner-name="RC Owner" \
  --owner-email=owner@rc-adventure-park.test \
  --branch-name="Centro" --branch-code=CTR \
  --yes
```

Prerequisite the CLI itself enforces: the technical-permissions catalog
must already be seeded (`pnpm --filter @asone/database db:seed`) — this
is a one-time, per-database step, not per-tenant.

**Not exposed via the REST API on purpose** (confirmed during this
certification's Phase 1 inventory) — company creation is CLI-only, a
deliberate, high-stakes, masked-password, refuses-on-conflict action.

## Step 2 (optional, bulk/automated alternative) — `business-config` CLI

**As of TASK 15.1, this step is no longer required** — every item it
covers is now reachable through the real Flutter product UI (see Step 3
below and `docs/RC_COMMERCIAL_ONBOARDING_WALKTHROUGH.md`), which is now
the recommended path for a real park owner onboarding their own
business. `business-config` remains real, tested, and valid as an
**optional, bulk-import alternative** for a technical operator
onboarding many entities at once from a prepared JSON file (e.g. a
large existing catalog migrated from another system) — but per TASK
15.1's own explicit rule, it is not the sanctioned path for routine,
ongoing, owner-driven configuration once the owner has logged in for
the first time.

**Tool**: `provision:business-config`
(`apps/api/src/business-config/business-config.cli.ts`), driven by a
single JSON launch-config file — no code touched, no template literal
edited. The file lists everything the business wants at launch; the CLI
diffs it against the database and only creates what's missing
(idempotent — safe to re-run, e.g. after fixing a typo).

Real example used for this certification (trimmed — see
`docs/RC_RELEASE_INVENTORY.md` for the full JSON): company match by
slug, a second branch ("Norte"), 3 cash registers across the two
branches, two new roles ("Cajero", "Gerente") with an explicit permission
list each (never company-wide access), 3 new staff users (2 cashiers, 1
manager — passwords supplied out-of-band via
`--users-password-env-prefix`, never written into the config file), 3
product categories, 4 products with real prices, opening inventory
balances for the stock-tracked products, and a real loyalty/rewards
program.

```bash
DATABASE_URL='<real production DATABASE_URL>' \
node --import tsx apps/api/src/business-config/business-config.cli.ts \
  --config=/path/to/rc-adventure-park.launch.json \
  --dry-run --yes      # validate first — writes nothing
node --import tsx apps/api/src/business-config/business-config.cli.ts \
  --config=/path/to/rc-adventure-park.launch.json \
  --users-password-env-prefix=RC_LAUNCH \
  --yes                # then apply for real
```

**Verified live result**: 1 branch created (Norte) + 1 matched existing
(Centro); 3 registers created; 2 roles created + 1 matched (owner); 3
users created; 3 categories created; 4 products + prices created; 2
inventory locations + 4 opening balances created; rewards program
created. `success: true`.

## Step 3 — Everything else: the real Flutter product UI (owner-driven, no CLI, no API scripting, no code)

Once Step 1 gives the owner a working login, **every** remaining piece
of initial setup is done directly through the real, running Flutter web
app — proven live in TASK 15.1's own 24-step commercial onboarding
walkthrough (`docs/RC_COMMERCIAL_ONBOARDING_WALKTHROUGH.md`), driven
through a real browser against a real backend, exactly as a real park
owner would use it. Every item below links to the real screen that
covers it; every one was live-created and re-confirmed as real,
persisted server state (not optimistic local UI state) during that
walkthrough:

- **Branding — tenant logo**: "Marca del Ticket" → "Logo del negocio"
  button → `PosBrandingScreen` (real multipart upload, magic-byte
  content validation, 2MB cap) → a real object in MinIO/S3-compatible
  storage plus a `branding.logo_url` setting row.
- **Branding — receipt header/footer**: `PosReceiptBrandingScreen`
  (CAS-guarded via `If-Match`).
- **Branches**: `PosBranchAdminScreen` ("Sucursales") — create/edit,
  closing the one real gap TASK 15.0 found (`BranchSelectionScreen`
  only ever read/selected branches, never created one).
- **Cash registers**: the Caja screen's "Nueva caja" action — a real
  gap TASK 15.1 found and fixed (the backend route existed with zero
  Flutter caller, a genuine onboarding dead end) and re-verified live.
- **Users (managers, cashiers, employees) + roles + permissions**:
  `PosUserAdministrationScreen` ("Usuarios") — three tabs
  (Usuarios/Roles/Permisos): create/edit/activate-deactivate users,
  branch/role assignment, real role creation, a server-authoritative
  grouped permission picker with a live-verified self-escalation guard.
- **Inventory locations, movement adjustments, transfers, counts,
  reservations, reconciliation**: `PosInventoryAdminScreen` ("Admin.
  Inventario") — six tabs, closing TASK 15.0's widest-found gap.
- **Suppliers**: existing Proveedores screen.
- **Categories**: `PosCategoryAdminScreen` — previously had **no
  screen at all**, not even read-only; now real.
- **Brands**: `PosBrandAdminScreen`.
- **Products (normal/barcode/weighted) + prices + branch price
  overrides + custom options/barcodes + CSV export**: the Productos
  screen's new "Nuevo producto" dialog, plus `PosCatalogAdminScreen`
  ("Catálogo Avanzado") for price overrides/options/export — closing a
  real, severe TASK 15.1 finding: base-product creation itself had zero
  Flutter caller before this pass (see the walkthrough doc for the full
  four-bug chain this fix surfaced and closed).
- **Opening inventory / restock**: existing Compras (Direct Purchase)
  screen.
- **Customers**: existing Clientes screen.
- **Memberships / rewards config**: existing Membresías screen.
- **Promotions / coupons**: existing Cupones/Promos screen.
- **Party rooms + packages**: existing Fiestas screen.
- **Access setup**: existing Control de Acceso screen — credentials are
  issued per-guest at the point of sale/entry, scoped automatically to
  the authenticated actor's company/branch.
- **Taxes**: nothing extra to configure — a real, platform-level,
  per-product field (`tax_code`) set at product-creation time, not a
  separate per-tenant tax-rate screen (the legacy's own equivalent
  screen was a confirmed decorative placeholder — see
  [[LEGACY_FUNCTIONAL_PARITY]] §18).
- **Opening the register**: the Caja screen's ordinary daily
  "open session" action.
- **PIN/QR quick-switch for cashiers**: "Cambiar cajero" in the POS
  toolbar — a real, live-verified session hand-off (TASK 15.1), not
  merely a verification dialog.

## Verdict: no source-code edit, no manual SQL, no dev-only seed script, and (as of TASK 15.1) no CLI beyond the one owner-bootstrap step was needed at any point.

Every one of the 24 setup items in TASK 15.1's own Phase 6 checklist is
reachable directly through the real Flutter product UI — nothing
required editing application code, writing raw SQL against the
database, using Postman/curl, or invoking anything under
`apps/api/src/development/**` (which is itself hard-gated to
`NODE_ENV=development|test` + a loopback + allowlisted-database-name
check, and is not a viable path for a real production tenant in any
case). 23 of the 24 steps were completed entirely inside the browser;
the one exception (the logo file's own OS-native file-picker dialog)
could not be driven by browser automation tooling specifically — a
tooling limitation of the certification process itself, not a gap in
the product — and was independently confirmed working via the real
upload endpoint plus UI-side verification of the persisted result.

**No commercial blocker remains after this phase.** Four genuine,
launch-blocking gaps were found live during the walkthrough (register
creation, user-creation false-failure, product creation missing
entirely, and its three cascading follow-on bugs) — every one was a
real dead end a paying customer's owner would have hit on day one, and
every one was fixed and re-verified live, end to end, including a real
completed POS sale proving the full create-product → price → restock →
sell pipeline. See `docs/RC_COMMERCIAL_ONBOARDING_WALKTHROUGH.md` for
the complete evidence.
