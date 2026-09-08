# V1 Product Inventory

TASK 14.2 — a repository-wide inventory of every operational module actually
found in this codebase, built from direct inspection (routes, schema,
Flutter screens, permissions, tests) rather than assumption. The repository
is the source of truth; nothing here is inferred from what a "mature POS
platform" is generally expected to have.

**TASK 14.2R update**: this inventory has now also been cross-checked
against the canonical pre-migration legacy prototype
(`AS POS V1.html`, forensically inspected in full) — see
[[LEGACY_FUNCTIONAL_PARITY]] for the complete evidence-backed matrix,
[[LEGACY_TO_CURRENT_MAPPING]] for the module-by-module narrative,
[[LEGACY_MISSING_PORTS]] for the P0/P1/P2 action-plan grouping, and
[[LEGACY_FIESTAS_RECOVERY]] for the dedicated Fiestas deep-dive. Rows
below are annotated where that audit changed or reinforced a finding.

## Classification key

1. **COMPLETE + LAUNCH READY** — backend, database, Flutter UI,
   permissions, and (where applicable) live end-to-end QA all confirmed
   working together.
2. **IMPLEMENTED BUT NOT CONNECTED** — real code exists on both sides but
   isn't wired together (e.g. an endpoint no screen calls).
3. **PARTIALLY IMPLEMENTED** — a genuine subset works; a genuine subset
   doesn't.
4. **UI EXISTS BUT BACKEND MISSING**
5. **BACKEND EXISTS BUT UI MISSING**
6. **BROKEN / BLOCKER**
7. **PLANNED ONLY / POST-LAUNCH** — no real implementation exists; a
   deliberate, documented deferral (not found and not built here).

## Matrix

| Module | Status | Backend | Database | UI | Permissions | E2E Tested | Launch Status | Remaining Gap |
|---|---|---|---|---|---|---|---|---|
| Auth (login/session/refresh/logout) | 1 | ✅ | ✅ | ✅ | ✅ | ✅ (TASK 14.0 live QA) | 🟢 GREEN | none |
| Company/Branch administration | 1 | ✅ | ✅ | — (API-driven; no dedicated Flutter screen, used via provisioning) | ✅ | ✅ (staging rehearsals, TASK 14.1) | 🟢 GREEN | none for launch — a dedicated Flutter "company settings" screen is POST-LAUNCH nicety |
| Users / Roles / Permissions admin | 1 | ✅ | ✅ | — (API-driven; provisioned via CLI/API, no dedicated Flutter admin screen) | ✅ (TASK 14.0 fixed the real launch blocker: first-activation password requirement) | ✅ (TASK 14.0 live cashier-onboarding rehearsal) | 🟢 GREEN | a Flutter "manage staff" screen is POST-LAUNCH; the authenticated API path is fully sufficient for launch |
| Cash Register (registers/sessions/movements/close) | 1 | ✅ | ✅ | ✅ | ✅ | ✅ (TASK 14.0/14.1 full-day + restart rehearsals) | 🟢 GREEN | none |
| Catalog (categories/products/variants/prices) | 1 | ✅ | ✅ | ✅ (admin catalog screens) | ✅ | ✅ | 🟢 GREEN | products default to `draft` on creation — must be explicitly activated (documented gotcha, not a defect) |
| Inventory (locations/balances/movements/drafts/posting/reservations/counts/reconciliation) | 1 | ✅ | ✅ | ✅ (balances/movements visible in POS flows) | ✅ | ✅ | 🟢 GREEN | none for launch — reconciliation/repair tooling is admin/ops-only by design |
| Sales (creation/completion/cancellation/history) | 1 | ✅ | ✅ | ✅ | ✅ | ✅ | 🟢 GREEN | none |
| Payments — Cash | 1 | ✅ | ✅ | ✅ | ✅ | ✅ | 🟢 GREEN | none |
| Payments — Card terminal / Mercado Pago | 7 | ✅ (built, TASK 12.4B) | ✅ | ✅ (dispatch UI exists) | ✅ | not exercised (MP LIVE intentionally paused) | 🟡 YELLOW (by explicit instruction) | **not a real gap** — Mercado Pago LIVE is deliberately paused for this launch; cash is the sole payment method at launch by design |
| Receipts (browser print/reprint) | 1 | ✅ | ✅ | ✅ | n/a | ✅ | 🟢 GREEN | logo is a shared app-wide mark, not per-tenant branding (POST-LAUNCH) |
| Refunds (partial/full) | 1 | ✅ | ✅ | ✅ | ✅ (manager-gated by launch policy — see `docs/GO_LIVE_CHECKLIST.md`) | ✅ | 🟢 GREEN | none |
| Promotions / Coupons | 1 | ✅ | ✅ | ✅ (admin form, cashier discount display, CLIENTE coupon-entry dialog confirmed in `pos_shell.dart`) | ✅ | ✅ | 🟢 GREEN | launch with promotions/coupons **empty** unless the business supplies real ones — a business decision, not an implementation gap |
| Customers | 1 | ✅ | ✅ | ✅ | ✅ | ✅ | 🟢 GREEN | none |
| Memberships (plan → sale → payment → activation → validation → renew/cancel) | 1 | ✅ | ✅ | ✅ (renew/cancel/validate buttons confirmed wired in `pos_shell.dart`) | ✅ | ✅ | 🟢 GREEN | launch-enabled only if the business sells a real membership product — data decision, not a code gap |
| AS Rewards+ loyalty ledger + reward entitlements/redemption + checkout benefit application | 1 | ✅ | ✅ | ✅ | ✅ | ✅ (TASK 13.1/13.2 concurrency-proven, TASK 14.0 live QA) | 🟡 YELLOW (by business decision) | **not an implementation gap** — fully built and proven; launch default is `enabled: false` per this task's own instruction ("do not force launch dependency on Rewards") until the business confirms the 5+1/VIP program for real |
| Events / Parties (Fiestas) / Scheduling | 1 (backend) | ✅ | ✅ | 🟡 Flutter in progress | ✅ (real, server-enforced `party.*` codes) | ✅ (27/27 integration tests + a live 20-step E2E proof) | 🟢 GREEN (backend), 🟡 YELLOW (Flutter UI in progress) | **TASK 14.3 (Wave 1) built this for real** — real `party_rooms`/`party_packages`/`party_reservations` (+snacks/socks/payments/documents), database-enforced room-conflict prevention (GIST exclusion constraint), a deterministic quote engine, deposit/balance tracking reusing the existing real cash-movement system, on-demand contract/waiver HTML generation. Originally deferred as its own future task (`docs/LEGACY_FIESTAS_RECOVERY.md`), later explicitly brought into Wave 1 scope. Remaining gap: Flutter UI (calendar/list/quoter/settings/detail screens) |
| Reports (daily sales, cash close, refunds, inventory) | 1 (as real underlying data/API), UI via existing screens | ✅ (Sales History, Cash Session Summary, Refunds list, Inventory Balances — all real, filterable, paginated) | ✅ | ✅ (Sales History screen, Cash Session summary screen) | ✅ | ✅ | 🟢 GREEN | no dedicated aggregate "Reports" dashboard exists — deliberately out of scope per this task's own "do not attempt a giant BI platform" instruction; the underlying data is fully queryable today |
| Multi-branch operations / tenant isolation | 1 | ✅ | ✅ (composite `(company_id, ...)` FKs audited across all 24 migrations, zero violations — TASK 14.0) | ✅ (branch-scoped throughout) | ✅ | ✅ | 🟢 GREEN | none |
| Production deployment / infrastructure (TASK 14.1) | 1 | ✅ | ✅ | n/a | n/a | ✅ (full staging rehearsal, restart, backup/restore) | 🟢 GREEN | real DNS/TLS/hosting provisioning remains an operator/business step, not a code gap |
| Business configuration provisioning (TASK 14.2) | 1 | ✅ | ✅ | n/a (CLI, by design) | ✅ | ✅ | 🟢 GREEN | `provision:business-config` CLI applied the real `inflapark.launch.example.json` template (6 branches/registers, 2 roles, 2 users, 6 categories, 10 products+prices, opening inventory, rewards program) against a disposable DB — dry-run matched the real apply exactly, and a second identical run proved full idempotency (0 created, all "already exists"). A genuine launch-blocker (`createBranch` writing a JSON `null` instead of a SQL NULL for an omitted `address`, failing `branches_address_object_ck`) was found and fixed in `admin.service.ts` with a regression test, not merely worked around |

## Dependency map for a real park to operate on September 15

```
Infrastructure (TASK 14.1, GREEN)
   └── Company + Owner provisioned (provision:production-owner, GREEN)
         └── Business config applied: branch, register, roles, users, catalog, prices, tax, opening inventory
               (TASK 14.2's own new provision:business-config tool)
               └── Cashier can log in
                     └── Register can open
                           └── Catalog is loadable and priced
                                 └── A sale can be created, paid in cash, and completed
                                       └── A receipt can print/reprint
                                       └── A refund can be issued (if policy allows)
                                       └── The register can close and reopen next day
```

Everything below this chain is OPTIONAL, launch-independent, and does not
block the core loop above:
- Rewards/loyalty (business decision — see `docs/V1_LAUNCH_SCOPE.md`)
- Promotions/coupons (business decision — launch empty is a valid state)
- Mercado Pago LIVE (explicitly paused)
- Events/parties (genuinely unbuilt — its own future task)
- A dedicated Reports dashboard (existing screens already cover the
  minimum operational need)
