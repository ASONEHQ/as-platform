# RC Tenant-Hardcoding Scan — AS POS V1 Release Candidate (TASK 15.0 Phase 2)

**Purpose**: prove no live, production-executing code path in this
repository is hardcoded to the original pilot tenant ("Inflapark"/
`inflapark-group`), so the platform can be provisioned for a brand-new
customer (proven in practice with the real second tenant "RC Adventure
Park" — see `docs/RC_FINANCIAL_INVARIANTS.md`,
`docs/RC_INVENTORY_INVARIANTS.md`, `docs/RC_FAILURE_RECOVERY_MATRIX.md`)
without any code change.

**Method**: case-insensitive full-repository grep (ripgrep, gitignore-
respecting — `node_modules/`, `dist/`, `coverage/`, etc. excluded) for
`inflapark` across every file in the worktree — `docs/`, `apps/`,
`packages/`, `config/`, root files. Every distinct pilot-brand term found
while reading matches (branch names `Puerta La Victoria` / `Portal
Centro` / `Universidad` / `Juriquilla` / `CDMX` / `Campeche`, the slug
`inflapark-group`, the email pattern `*@inflapark.local`/`.mx`) was then
separately re-grepped to confirm no occurrence existed outside the file
set already found by the base `inflapark` search. No hardcoded UUID tied
to the pilot tenant was found anywhere (`bootstrap-owner.service.ts`
generates the pilot company's id at runtime via `createUuidV7()`, never a
literal UUID constant).

**Result**: **120 occurrences across 32 files.** Every occurrence was
read in context and classified below.

## Classification key

- **A** — test fixture (`*.test.ts`/`*.spec.ts`/`*_test.dart`, or clearly
  test-only data). Acceptable.
- **B** — documentation: a `.md` file, or a source-code comment
  explaining history/design intent/usage example that has no effect on
  execution. Acceptable.
- **C** — gated dev-only seed/bootstrap tooling behind the
  `validateBootstrapEnvironment`/`validateSeedEnvironment` guard
  (loopback-only, allowlisted database name, `NODE_ENV` in
  `{development,test}` only — confirmed present in every file so
  classified, via `grep -l validateBootstrapEnvironment|validateSeedEnvironment
  apps/api/src/development/*`). Acceptable — cannot run against a real
  production/new-tenant database.
- **D** — a real, live, production code path (route/service/repository/
  migration/config default) hardcoded to the pilot tenant. Genuine
  blocker. **None found — see verdict.**

## Full classified table

| # | File | Line | Excerpt | Class | Reasoning |
|---|------|------|---------|-------|-----------|
| 1 | `AGENTS.md` | 9 | "The platform must not be designed specifically for Inflapark." | B | Root doc file, explicit anti-hardcoding principle statement. |
| 2 | `AGENTS.md` | 10 | "Inflapark is the first pilot customer, but all features must support" | B | Same doc, same paragraph. |
| 3 | `apps/api/src/business-config/business-config.cli.ts` | 17 | `--config=config/launch/inflapark.launch.example.json` | B | Inside a JSDoc usage-example comment block; the CLI itself takes `--config` as a required flag with no default — verified `business-config.service.ts`/`.types.ts`/`launch-config.validate.ts` contain zero occurrences of "inflapark". |
| 4 | `apps/api/src/business-config/business-config.cli.ts` | 20 | `[--users-password-env-prefix=INFLAPARK_LAUNCH]` | B | Same JSDoc example block, illustrative flag value only. |
| 5 | `apps/api/src/business-config/business-config.cli.ts` | 38 | "`ana.perez@inflapark.mx` → `ANA_PEREZ_INFLAPARK_MX`" | B | Same JSDoc example block, illustrating env-var name derivation. |
| 6 | `apps/api/src/business-config/business-config.integration.test.ts` | 19 | "never the literal `inflapark-group`) so this never collides with real seed data" | A | Test file; comment explicitly documents the test avoids the literal slug, uses a unique randomly-suffixed company instead. |
| 7 | `apps/api/src/development/README.md` | 5 | "creates or safely reconciles `Inflapark Group`, six active development branches, `ceo@inflapark.local`" | B | `.md` documentation for the gated dev bootstrap tool. |
| 8 | `apps/api/src/development/README.md` | 29 | "sign in as `ceo@inflapark.local` using the value supplied through `AS_DEV_BOOTSTRAP_PASSWORD`" | B | Same doc file. |
| 9 | `apps/api/src/development/README.md` | 35 | "It targets only the `inflapark-group` company and its branches created by `dev:bootstrap-owner`" | B | Same doc file, describing gated dev seed behavior. |
| 10 | `apps/api/src/development/README.md` | 49 | `{"company":"inflapark-group","branches":6,...}` | B | Example CLI output in doc file. |
| 11 | `apps/api/src/development/README.md` | 56 | "`dev:seed-cash-registers` creates ... per existing branch of the `inflapark-group` development company" | B | Same doc file. |
| 12 | `apps/api/src/development/README.md` | 68 | `{"company":"inflapark-group","registers":{"created":6,"existing":0},"success":true}` | B | Example CLI output in doc file. |
| 13 | `apps/api/src/development/README.md` | 75 | "for the `inflapark-group` development company" | B | Same doc file. |
| 14 | `apps/api/src/development/README.md` | 77 | "It targets only the fixed `inflapark-group` company created by `dev:bootstrap-owner`" | B | Same doc file, reiterates gating. |
| 15 | `apps/api/src/development/README.md` | 89 | `{"company":"inflapark-group","program":{"id":"<uuid>",...}}` | B | Example CLI output in doc file. |
| 16 | `apps/api/src/development/bootstrap-owner.integration.test.ts` | 92 | `where normalized_email='ceo@inflapark.local'` | A | Test file asserting against the gated dev fixture the bootstrap tool creates. |
| 17 | `apps/api/src/development/bootstrap-owner.integration.test.ts` | 201 | `where c.slug='inflapark-group' and b.status='active'` | A | Test file, same fixture assertion. |
| 18 | `apps/api/src/development/bootstrap-owner.integration.test.ts` | 242 | `where c.slug='inflapark-group' and u.normalized_email='ceo@inflapark.local'` | A | Test file, same fixture assertion. |
| 19 | `apps/api/src/development/bootstrap-owner.service.ts` | 20 | `const companySlug = 'inflapark-group';` | C | Dev-only bootstrap service; confirmed guarded by `validateBootstrapEnvironment` (loopback/allowlisted-db/`NODE_ENV` dev\|test only) — cannot run against a real production or new-tenant database. |
| 20 | `apps/api/src/development/bootstrap-owner.service.ts` | 21 | `const ownerEmail = 'ceo@inflapark.local';` | C | Same gated service. |
| 21 | `apps/api/src/development/bootstrap-owner.service.ts` | 280 | `legalName: 'Inflapark Group',` | C | Same gated service. |
| 22 | `apps/api/src/development/bootstrap-owner.service.ts` | 281 | `displayName: 'Inflapark Group',` | C | Same gated service. |
| 23 | `apps/api/src/development/bootstrap-owner.service.ts` | 292 | `legalName: 'Inflapark Group',` | C | Same gated service (reconciliation branch). |
| 24 | `apps/api/src/development/bootstrap-owner.service.ts` | 293 | `displayName: 'Inflapark Group',` | C | Same gated service (reconciliation branch). |
| 25 | `apps/api/src/development/seed-cash-registers.integration.test.ts` | 54 | `company: 'inflapark-group',` | A | Test file asserting against gated dev fixture. |
| 26 | `apps/api/src/development/seed-cash-registers.integration.test.ts` | 62 | `where c.slug='inflapark-group' order by b.code` | A | Test file, same. |
| 27 | `apps/api/src/development/seed-cash-registers.integration.test.ts` | 69 | `where c.slug='inflapark-group'` | A | Test file, same. |
| 28 | `apps/api/src/development/seed-cash-registers.integration.test.ts` | 76 | `where c.slug='inflapark-group'` | A | Test file, same. |
| 29 | `apps/api/src/development/seed-cash-registers.service.ts` | 34 | `const companySlug = 'inflapark-group';` | C | Guarded by `validateSeedEnvironment`, same pattern as bootstrap-owner. |
| 30 | `apps/api/src/development/seed-cash-registers.service.ts` | 35 | `const ownerEmail = 'ceo@inflapark.local';` | C | Same gated service. |
| 31 | `apps/api/src/development/seed-cash-registers.service.ts` | 41 | `readonly company: 'inflapark-group';` | C | Same gated service (return type literal). |
| 32 | `apps/api/src/development/seed-loyalty-rewards.service.ts` | 28 | "`inflapark-group` development company created by `dev:bootstrap-owner`" | C | Guarded by `validateSeedEnvironment`. |
| 33 | `apps/api/src/development/seed-loyalty-rewards.service.ts` | 57 | `const companySlug = 'inflapark-group';` | C | Same gated service. |
| 34 | `apps/api/src/development/seed-loyalty-rewards.service.ts` | 58 | `const ownerEmail = 'ceo@inflapark.local';` | C | Same gated service. |
| 35 | `apps/api/src/development/seed-loyalty-rewards.service.ts` | 65 | `readonly company: 'inflapark-group';` | C | Same gated service (return type literal). |
| 36 | `apps/api/src/development/seed-pos-catalog.integration.test.ts` | 58 | `company: 'inflapark-group',` | A | Test file, same gated-fixture assertion pattern. |
| 37 | `apps/api/src/development/seed-pos-catalog.integration.test.ts` | 107 | `where c.slug='inflapark-group' order by p.code` | A | Test file. |
| 38 | `apps/api/src/development/seed-pos-catalog.integration.test.ts` | 131 | `where c.slug='inflapark-group' order by b.code,v.sku` | A | Test file. |
| 39 | `apps/api/src/development/seed-pos-catalog.integration.test.ts` | 150 | `where c.slug='inflapark-group')::text categories,` | A | Test file. |
| 40 | `apps/api/src/development/seed-pos-catalog.integration.test.ts` | 151 | `where c.slug='inflapark-group')::text products,` | A | Test file. |
| 41 | `apps/api/src/development/seed-pos-catalog.integration.test.ts` | 152 | `where c.slug='inflapark-group')::text variants,` | A | Test file. |
| 42 | `apps/api/src/development/seed-pos-catalog.integration.test.ts` | 153 | `where c.slug='inflapark-group')::text prices,` | A | Test file. |
| 43 | `apps/api/src/development/seed-pos-catalog.integration.test.ts` | 154 | `where c.slug='inflapark-group')::text locations,` | A | Test file. |
| 44 | `apps/api/src/development/seed-pos-catalog.integration.test.ts` | 155 | `where c.slug='inflapark-group')::text balances,` | A | Test file. |
| 45 | `apps/api/src/development/seed-pos-catalog.integration.test.ts` | 156 | `where c.slug='inflapark-group')::text movements,` | A | Test file. |
| 46 | `apps/api/src/development/seed-pos-catalog.integration.test.ts` | 157 | `where c.slug='inflapark-group' and m.status='posted')::text posted_movements` | A | Test file. |
| 47 | `apps/api/src/development/seed-pos-catalog.service.ts` | 21 | "targets only the `inflapark-group`" | C | Guarded by `validateSeedEnvironment`. |
| 48 | `apps/api/src/development/seed-pos-catalog.service.ts` | 43 | `const companySlug = 'inflapark-group';` | C | Same gated service. |
| 49 | `apps/api/src/development/seed-pos-catalog.service.ts` | 44 | `const ownerEmail = 'ceo@inflapark.local';` | C | Same gated service. |
| 50 | `apps/api/src/development/seed-pos-catalog.service.ts` | 251 | `readonly company: 'inflapark-group';` | C | Same gated service (return type literal). |
| 51 | `apps/one/README.md` | 90 | "The local identifier is `ceo@inflapark.local`; no password is stored in this repository." | B | `.md` documentation. |
| 52 | `apps/one/lib/features/pos/pos_models.dart` | 194 | "never an Inflapark-specific hardcode of a product/price/policy." | B | Doc comment (`///`) explaining a design principle in production Flutter code; not itself a hardcoded value — the actual constant it describes (`posWeightBasedUnitOfMeasureCodes = {'kg','g'}`) is a platform-wide unit-of-measure fact, not tenant data. |
| 53 | `apps/one/test/pos_shell_test.dart` | 2179 | `companyName: 'Inflapark Group',` | A | Flutter widget test fixture. |
| 54 | `apps/one/test/receipt_html_test.dart` | 257 | `companyName: 'Inflapark Group',` | A | Flutter unit test fixture. |
| 55 | `config/launch/inflapark.launch.example.json` | 2 | `"_launch_note": "TASK 14.2 EXAMPLE launch configuration for Inflapark Group ... This file is a TEMPLATE, not a ready-to-run config ..."` | B | Explicitly-labeled example/template artifact, never referenced by default from any script or code (`grep` of all `package.json` files for this filename returns none); requires an operator to pass `--config=<path>` explicitly. The CLI/service it feeds is fully generic (zero "inflapark" occurrences in `business-config.service.ts`/`.types.ts`/`launch-config.validate.ts`). |
| 56 | `config/launch/inflapark.launch.example.json` | 5 | `"legal_name": "Inflapark Group",` | B | Same template file. |
| 57 | `config/launch/inflapark.launch.example.json` | 6 | `"display_name": "Inflapark Group",` | B | Same template file. |
| 58 | `config/launch/inflapark.launch.example.json` | 7 | `"slug": "inflapark-group",` | B | Same template file. |
| 59 | `config/launch/inflapark.launch.example.json` | 22 | `"_registers_note": "No real register configuration exists anywhere yet for Inflapark. ..."` | B | Same template file. |
| 60 | `config/launch/inflapark.staging-rehearsal.json` | 2 | `"_staging_note": "TASK 14.2 FINAL STAGING REHEARSAL config — NOT a real launch config. Concrete values below are STAGING-ONLY placeholders ..."` | B | Explicitly-labeled staging-only rehearsal artifact, same non-default/explicit-flag reasoning as row 55. |
| 61 | `config/launch/inflapark.staging-rehearsal.json` | 5 | `"legal_name": "Inflapark Group",` | B | Same staging file. |
| 62 | `config/launch/inflapark.staging-rehearsal.json` | 6 | `"display_name": "Inflapark Group",` | B | Same staging file. |
| 63 | `config/launch/inflapark.staging-rehearsal.json` | 7 | `"slug": "inflapark-group",` | B | Same staging file. |
| 64 | `config/launch/inflapark.staging-rehearsal.json` | 47 | `"email": "cajero-staging@inflapark.local", ... "branch_code": "PLV"` | B | Same staging file, marked "(TEST ACCOUNT)". |
| 65 | `config/launch/inflapark.staging-rehearsal.json` | 48 | `"email": "gerente-staging@inflapark.local", ... "branch_code": "PLV"` | B | Same staging file, marked "(TEST ACCOUNT)". |
| 66 | `docs/INFLAPARK_LAUNCH_CONFIG.md` | 1 | `# Inflapark Launch Configuration` | B | `.md` documentation. |
| 67 | `docs/INFLAPARK_LAUNCH_CONFIG.md` | 3 | "How Inflapark's real business configuration gets into AS POS" | B | Same doc. |
| 68 | `docs/INFLAPARK_LAUNCH_CONFIG.md` | 5 | "Nothing here is Inflapark-specific in the *code*; only" | B | Same doc — states the platform-agnostic design explicitly. |
| 69 | `docs/INFLAPARK_LAUNCH_CONFIG.md` | 15 | "`config/launch/inflapark.launch.example.json` — the real, reviewable" | B | Same doc. |
| 70 | `docs/INFLAPARK_LAUNCH_CONFIG.md` | 16 | "Inflapark template validated against that schema" | B | Same doc. |
| 71 | `docs/INFLAPARK_LAUNCH_CONFIG.md` | 26 | `--config=config/launch/inflapark.launch.example.json \` | B | Same doc, usage example. |
| 72 | `docs/INFLAPARK_LAUNCH_CONFIG.md` | 29 | `[--users-password-env-prefix=INFLAPARK_LAUNCH]` | B | Same doc, usage example. |
| 73 | `docs/INFLAPARK_LAUNCH_CONFIG.md` | 62 | `Company: legal name "Inflapark Group", timezone` | B | Same doc. |
| 74 | `docs/INFLAPARK_LAUNCH_CONFIG.md` | 109 | `[[INFLAPARK_USER_ONBOARDING]]` | B | Same doc, cross-reference link. |
| 75 | `docs/INFLAPARK_LAUNCH_CONFIG.md` | 111 | `[[INFLAPARK_OPENING_DAY_CHECKLIST]]` | B | Same doc, cross-reference link. |
| 76 | `docs/INFLAPARK_LAUNCH_CONFIG.md` | 112 | `[[INFLAPARK_PRINT_SETUP]]` | B | Same doc, cross-reference link. |
| 77 | `docs/INFLAPARK_OPENING_DAY_CHECKLIST.md` | 1 | `# Opening Day Checklist ... (Inflapark)` | B | `.md` documentation. |
| 78 | `docs/INFLAPARK_OPENING_DAY_CHECKLIST.md` | 9 | "generic to any AS POS branch station — Inflapark's own" | B | Same doc. |
| 79 | `docs/INFLAPARK_OPENING_DAY_CHECKLIST.md` | 41 | `[docs/INFLAPARK_PRINT_SETUP.md]` | B | Same doc, link. |
| 80 | `docs/INFLAPARK_OPENING_DAY_CHECKLIST.md` | 50 | `[docs/INFLAPARK_USER_ONBOARDING.md]` | B | Same doc, link. |
| 81 | `docs/INFLAPARK_OPENING_DAY_CHECKLIST.md` | 67 | `[docs/INFLAPARK_PRINT_SETUP.md]` | B | Same doc, link. |
| 82 | `docs/INFLAPARK_OPENING_DAY_CHECKLIST.md` | 79 | "this documentation-only pass cannot make for Inflapark" | B | Same doc. |
| 83 | `docs/INFLAPARK_OPENING_DAY_CHECKLIST.md` | 115 | `[docs/INFLAPARK_PRINT_SETUP.md]` | B | Same doc, link. |
| 84 | `docs/INFLAPARK_OPENING_DAY_CHECKLIST.md` | 120 | "Inflapark's actual launch role matrix" | B | Same doc. |
| 85 | `docs/INFLAPARK_OPENING_DAY_CHECKLIST.md` | 159 | "confirm which cadence Inflapark" | B | Same doc. |
| 86 | `docs/INFLAPARK_OPENING_DAY_CHECKLIST.md` | 179 | `[docs/INFLAPARK_PRINT_SETUP.md]` | B | Same doc, link. |
| 87 | `docs/INFLAPARK_OPENING_DAY_CHECKLIST.md` | 181 | `[docs/INFLAPARK_USER_ONBOARDING.md]` | B | Same doc, link. |
| 88 | `docs/INFLAPARK_PRINT_SETUP.md` | 1 | `# Receipt Printing Setup ... (Inflapark launch)` | B | `.md` documentation. |
| 89 | `docs/INFLAPARK_PRINT_SETUP.md` | 7 | "identical for every tenant on the platform. Inflapark is used throughout as" | B | Same doc, states platform-agnostic design explicitly. |
| 90 | `docs/INFLAPARK_PRINT_SETUP.md` | 9 | "nothing below is Inflapark-specific machinery" | B | Same doc. |
| 91 | `docs/INFLAPARK_PRINT_SETUP.md` | 11 | "Inflapark's." | B | Same doc. |
| 92 | `docs/INFLAPARK_PRINT_SETUP.md` | 108 | "for Inflapark or anyone else" | B | Same doc. |
| 93 | `docs/INFLAPARK_PRINT_SETUP.md` | 115 | "physical printer model Inflapark actually uses" | B | Same doc. |
| 94 | `docs/INFLAPARK_PRINT_SETUP.md` | 215 | "Inflapark cannot get **its own** logo" | B | Same doc. |
| 95 | `docs/INFLAPARK_PRINT_SETUP.md` | 220 | "how Inflapark" | B | Same doc. |
| 96 | `docs/INFLAPARK_PRINT_SETUP.md` | 224 | "if Inflapark wants its own logo" | B | Same doc. |
| 97 | `docs/INFLAPARK_USER_ONBOARDING.md` | 1 | `# Staff Onboarding ... (Inflapark launch)` | B | `.md` documentation. |
| 98 | `docs/INFLAPARK_USER_ONBOARDING.md` | 6 | "Inflapark's own role names (Manager, Cashier)" | B | Same doc. |
| 99 | `docs/INFLAPARK_USER_ONBOARDING.md` | 19 | "Inflapark's owner account is created by the `provision:production-owner`" | B | Same doc. |
| 100 | `docs/INFLAPARK_USER_ONBOARDING.md` | 188 | "if Inflapark's security posture requires forcing a fresh" | B | Same doc. |
| 101 | `docs/LEGACY_FIESTAS_RECOVERY.md` | 3 | `` `C:\Users\InMagic\Downloads\punto de venta INFLAPARK\AS POS V1.html` `` | B | `.md` documentation citing the legacy source-of-truth file path (historical/forensic reference). |
| 102 | `docs/LEGACY_FUNCTIONAL_PARITY.md` | 58 | `` `C:\Users\InMagic\Downloads\punto de venta INFLAPARK\AS POS V1.html` `` | B | Same reasoning, `.md` documentation. |
| 103 | `docs/LEGACY_FUNCTIONAL_PARITY.md` | 831 | "Inflapark company. ✅" | B | Same doc. |
| 104 | `docs/LEGACY_MISSING_PORTS.md` | 135 | "beyond Inflapark specifically:" | B | `.md` documentation. |
| 105 | `docs/RC_FLUTTER_UX_CERTIFICATION.md` | 5 | "logged in as the real Inflapark fixture" | B | `.md` RC certification doc, describing that certification used the gated dev fixture (bucket-C tooling) as its real data source. |
| 106 | `docs/RC_FLUTTER_UX_CERTIFICATION.md` | 6 | `` (`ceo@inflapark.local`) `` | B | Same doc. |
| 107 | `docs/RC_FLUTTER_UX_CERTIFICATION.md` | 16 | "served real Inflapark fixture" | B | Same doc. |
| 108 | `docs/RC_FLUTTER_UX_CERTIFICATION.md` | 82 | "real backend, real Inflapark data, real cookie-based session" | B | Same doc. |
| 109 | `docs/RC_FLUTTER_UX_CERTIFICATION.md` | 114 | "9 real Inflapark SKUs" | B | Same doc. |
| 110 | `docs/RC_FLUTTER_UX_CERTIFICATION.md` | 251 | `` for `ceo@inflapark.local` `` | B | Same doc. |
| 111 | `docs/RC_SECURITY_CERTIFICATION.md` | 29 | `` (`ceo@inflapark.local`, company `inflapark-group`) `` | B | `.md` doc; describes that the security review used the gated dev fixture as its test subject. |
| 112 | `docs/RC_SECURITY_CERTIFICATION.md` | 74 | "The dev bootstrap tooling is hardcoded to a single fixture (`companySlug = 'inflapark-group'`, `bootstrap-owner.service.ts:20`)" | B | Same doc — this is the certification *itself* explaining/documenting the gated (bucket-C) hardcoding as a known, acceptable limitation of the dev tool, not a new finding. |
| 113 | `docs/RC_SECURITY_CERTIFICATION.md` | 75 | `` (`cashier-test@inflapark.local`) was created via the real admin API `` | B | Same doc, describing a live probe performed against the pilot's real dev fixture company. |
| 114 | `docs/RC_SECURITY_CERTIFICATION.md` | 211 | "The dev bootstrap tooling is hardcoded to one fixture company (`inflapark-group`)" | B | Same doc, restates the same known bucket-C limitation. |
| 115 | `docs/README.md` | 5 | "Inflapark is the first pilot customer, but the platform is designed for independent companies" | B | `.md` documentation. |
| 116 | `docs/VISION.md` | 7 | "Inflapark is the pilot customer, not the product boundary." | B | `.md` documentation. |
| 117 | `docs/V1_LAUNCH_SCOPE.md` | 209 | "No Inflapark-specific value was hardcoded into shared application logic" | B | `.md` documentation, states the anti-hardcoding conclusion this scan re-verifies. |
| 118 | `docs/V1_PRODUCT_INVENTORY.md` | 106 | "applied the real `inflapark.launch.example.json` template" | B | `.md` documentation describing use of the example template (row 55-59) during TASK 14.2 provisioning. |
| 119 | `docs/adr/ADR-0014-cash-register-operations.md` | 73 | "per existing branch of the `inflapark-group` development company" | B | `.md` Architecture Decision Record documentation. |
| 120 | `packages/database/src/schema/parties.ts` | 32 | "reads correctly for any park/FEC, not just Inflapark. No park-specific" | B | Doc comment in the schema file explicitly stating the domain is generic/non-tenant-specific; not a hardcoded value. |

## Verification of pilot-brand terms beyond "inflapark"

Also grepped case-insensitively, repo-wide: `inflapark-group` (55 code/
config occurrences, all already in the table above), the six real pilot
branch names (`Puerta La Victoria`, `Portal Centro`, `Universidad`,
`Juriquilla`, `CDMX`, `Campeche` — all six matches fall inside files
already covered above: the two `config/launch/*.json` templates, the
gated `bootstrap-owner.service.ts`, `docs/RC_FLUTTER_UX_CERTIFICATION.md`,
and the two Flutter test files), and the pilot email domain pattern
(`@inflapark.local`/`.mx`, likewise fully covered above). No occurrence
of any pilot-specific literal was found outside the 32 files already
listed. No hardcoded UUID tied to the pilot tenant exists anywhere — the
pilot company's id is generated at runtime (`createUuidV7()`) by the
gated dev bootstrap tool, never a literal constant. A repo-wide search
for the second tenant's name ("RC Adventure Park") confirmed zero leakage
into source/config files (only appears in the RC_*.md certification
docs), ruling out the opposite failure mode of the fix having merely
swapped one hardcoded tenant for another.

## Final tally

| Bucket | Count | Description |
|--------|-------|-------------|
| A | 21 | Test fixtures (`*.test.ts`/`*_test.dart`) |
| B | 82 | Documentation (`.md` files, usage-example/history comments, explicitly-labeled example/template config files never referenced by default) |
| C | 17 | Gated dev-only seed/bootstrap tooling (`validateBootstrapEnvironment`/`validateSeedEnvironment`-guarded) |
| D | **0** | Real, live production code path hardcoded to the pilot tenant |
| **Total** | **120** | |

## Verdict: 🟢 GREEN

**D = 0.** No real, live production code path (route, service,
repository, migration, config default, or any code that would execute
against a new tenant's real traffic) was found hardcoded to the pilot
tenant. Every occurrence of "Inflapark"/`inflapark-group`/pilot branch
names/pilot emails found in the entire repository falls into exactly one
of:

- a test fixture (A),
- documentation, a source comment, or an explicitly-labeled non-default
  example/template artifact (B), or
- dev-only tooling that is provably unable to run outside a local
  loopback development/test database (C).

The two "live production" CLIs that touch business configuration —
`business-config.cli.ts`/`business-config.service.ts` (real launch
provisioning) and `provisioning/production-owner.cli.ts` (owner
provisioning) — were independently confirmed to contain **zero**
occurrences of "inflapark" in their actual logic; every pilot reference
near them is confined to JSDoc usage-example comments or to the
explicitly-labeled example/template JSON files under `config/launch/`
that must be passed in by an operator via an explicit `--config` flag
and are never a default. This is independently corroborated by the real
second-tenant end-to-end run ("RC Adventure Park") already exercised and
documented in `docs/RC_FINANCIAL_INVARIANTS.md`,
`docs/RC_INVENTORY_INVARIANTS.md`, and
`docs/RC_FAILURE_RECOVERY_MATRIX.md`.

**No fix was required or made under this pass.** This is a
verification-only deliverable per `docs/RC_FREEZE_POLICY.md` — no source
files were modified, no tests were rerun (none needed rerunning), and no
commit was made.
