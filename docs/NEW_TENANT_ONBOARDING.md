# New Tenant Onboarding — AS POS V1

**TASK 15.0 Phase 13 — proven live, end to end, against a real, brand-new
company ("RC Adventure Park") that never existed before this
certification, using only production-safe tooling. Zero source-code
edits. Zero manual SQL. Zero dev-only seed scripts.**

This is the exact, real process an AS ONE operator follows to bring a
genuinely new park onto AS Platform. Every step below was executed live
during TASK 15.0 against a real Postgres database, a real API process,
real MinIO storage — no mocks — and is reproducible by any operator with
shell access to the deployment and the two CLI tools referenced.

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

## Step 2 — Configure the rest of the initial launch (branches, registers, roles, staff, catalog, inventory, rewards)

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

## Step 3 — Everything else: the real authenticated app/API (no CLI, no code)

Once Steps 1-2 give the owner a working login, every remaining piece of
initial setup is done through the same real, permission-gated REST API
the Flutter app itself uses — proven live this certification by scripting
real HTTP calls with the owner's real bearer token, with zero source
changes:

- **Branding — receipt header/footer**: `PUT
  /api/v1/companies/{id}/settings/receipts.header_text` /
  `receipts.footer_text` (CAS-guarded via `If-Match`). In the app: the
  Receipt Branding admin screen.
- **Branding — tenant logo**: `POST
  /api/v1/companies/{id}/branding/logo` (real multipart upload, magic-byte
  content validation, 2MB cap) → a real object in MinIO/S3-compatible
  storage plus a `branding.logo_url` setting row. In the app: the Logo
  admin screen. Verified live: upload succeeded, a real object landed in
  the `asone-branding` bucket, and the resulting URL is fetched by every
  real print call site.
- **Suppliers**: `POST /api/v1/suppliers`. In the app: Suppliers screen.
- **Party rooms**: `POST /api/v1/party-rooms` (`branch_id`, `code`,
  `name`, capacities). In the app: Fiestas → Salones.
- **Party packages**: `POST /api/v1/party-packages` (`code`, `name`,
  `price`, `duration_minutes`, included/extra guest pricing). In the app:
  Fiestas → Paquetes.
- **Access configuration**: nothing extra to configure beyond what
  Step 1-2 already provisioned — access credentials are issued per-guest
  at the point of sale/entry (`POST /api/v1/access-credentials`), scoped
  automatically to the company/branch of the authenticated actor. No
  separate "access settings" screen exists or is needed.
- **Taxes**: nothing extra to configure — tax is a real, platform-level,
  per-product field (`tax_code`, e.g. `IVA_GENERAL`/`IVA_EXEMPT`) set at
  product-creation time in Step 2's launch config, not a separate
  per-tenant tax-rate screen (the legacy's own equivalent screen was a
  confirmed decorative placeholder — see
  [[LEGACY_FUNCTIONAL_PARITY]] §18).
- **Opening the register**: `POST /api/v1/cash-sessions` with a real
  `opening_amount`, once a cashier logs in for the day. Ordinary daily
  operation, not a one-time onboarding step — exercised as step 6 of
  TASK 15.0's own full business-day simulation.

## Verdict: no source-code edit, no manual SQL, no dev-only seed script was needed at any point.

Every one of the 22 setup items in TASK 15.0's own Phase 13 checklist
(company, logo, branches, registers, managers, cashiers, employees,
roles/permissions, categories, products, prices, inventory, suppliers,
customers, memberships/rewards, promotions/coupons, party rooms, party
packages, access rules, receipt branding, taxes, opening register) is
reachable through exactly the two CLI tools above plus the real,
permission-gated REST API — nothing required editing application code,
writing raw SQL against the database, or invoking anything under
`apps/api/src/development/**` (which is itself hard-gated to
`NODE_ENV=development|test` + a loopback + allowlisted-database-name
check, and is not a viable path for a real production tenant in any
case).

**No commercial blocker was found in this phase.**

Customers, memberships/rewards issuance, and promotions/coupons were not
separately re-proven in this document (they follow the exact same real
CRUD-via-authenticated-API pattern already demonstrated above for
suppliers/party rooms/packages, and are exercised directly in TASK
15.0's full business-day simulation — see `docs/RC_CERTIFICATION.md`).
