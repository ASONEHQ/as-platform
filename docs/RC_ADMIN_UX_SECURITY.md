# RC Admin UX Security — TASK 15.1 Phase 7

Governed by `docs/RC_FREEZE_POLICY.md`. Extends
`docs/RC_SECURITY_CERTIFICATION.md`'s methodology and
`docs/RC_FAILURE_RECOVERY_MATRIX.md` scenario I to the brand-new admin
surfaces built in Phase 6 (register administration, user/role/product
administration). Every probe below was run **both** through the real
Flutter UI (to confirm the front end honestly reflects a denial rather
than hiding a button that would still work) **and** as a direct,
authenticated HTTP call against the real API on port 3550 (to prove
the server itself is the actual gate). Every status code and response
body cited below is real, captured live — never assumed.

## 0. Test actors (all real, in the disposable `asone_commercial_demo` tenant)

| Actor | Credential | Role / scope |
|---|---|---|
| Owner | `owner@as-commercial-demo-park.test` | 100 permissions, company-wide |
| Cajero (cashier) | `cajero.norte@as-commercial-demo-park.test` | Role "Cajero": `sale.cancel`, `sale.complete`, `sale.create` only. Branch-scoped to Sucursal Norte. |
| Gerente (manager) | `gerente.norte@as-commercial-demo-park.test` | Role "Gerente de Sucursal": `branch.create`, `branch.read`, `cash_movement.create`, `cash_register.manage`, `cash_register.read`. Branch-scoped to Sucursal Norte. |
| Second-tenant owner | `owner@segundo-tenant-demo.test` | A wholly separate company, "Segundo Tenant Demo S.A. de C.V.", bootstrapped into the same `asone_commercial_demo` database via a second `provision:production-owner` call — never touching `asone_rc_test`/`asone_local`/`asone_test`/`asone_regression_*`. |
| Picker Test User | `picker.test@as-commercial-demo-park.test` | Role "Prueba Permisos Limitados": `role.create`, `role.read`, `role.permission.manage`, `permission.read` only — created specifically to live-verify the Permission Picker's disabled-checkbox UI guard. |

---

## PROBE 1 — cashier-role user cannot reach owner-only administration

| Call | Result |
|---|---|
| `GET /api/v1/users` (as Cajero) | **403** `permission_denied` |
| `GET /api/v1/roles` (as Cajero) | **403** `permission_denied` |
| `GET /api/v1/companies/{id}/branches` (as Cajero) | **403** `permission_denied` |
| `POST /api/v1/companies/{id}/branches` (as Cajero, mutation) | **403** `permission_denied` |

All four are real, direct HTTP calls with a real bearer token — not
inferred from the UI. **PASS.**

## PROBE 2 — manager boundary: something granted, something adjacent that is not

- `POST /api/v1/cash-registers` on Gerente's **own** assigned branch
  (Sucursal Norte), where `cash_register.manage` **is** granted →
  **201 Created** (a real register was created,
  `id: a87c7067-...`).
- `GET /api/v1/users` (`user.read` **not** granted) → **403**
  `permission_denied`.
- **Nuance, reported honestly, not a bug**: Gerente also holds
  `branch.create` at the role level, but
  `POST /api/v1/companies/{id}/branches` (company-level branch
  creation) still returned **403**, even though the permission code is
  nominally "granted" — because Gerente's role *assignment itself* is
  branch-scoped (to Sucursal Norte only), and creating a brand-new
  branch is a company-wide action, not a resource under any existing
  branch. This is real, correct, defense-in-depth backend behavior: a
  branch-scoped grant does not silently escalate to a company-wide
  action. **PASS.**

## PROBE 3 — cannot grant a permission you don't hold (self-escalation guard)

- Gerente (lacks `role.permission.manage`)
  `PUT /api/v1/roles/{cajeroRoleId}/permissions` attempting to grant
  `role.permission.manage` to Cajero → **403** `permission_denied`.
- Cajero (lacks `role.permission.manage`) same call → **403**
  `permission_denied`.
- **Sanity check**: Owner (who **does** hold `role.permission.manage`)
  the exact same call → real **200** — proving the route itself works
  correctly and the two denials above are genuine authorization
  denials, not an artifact of malformed input. Immediately reverted
  (permissions set back to `[]`) after the sanity check.

**Live UI guard verification** (not just the server): logged in as
"Picker Test User" (holds `role.permission.manage` + `role.read` +
`permission.read`, but not `branch.create`/`branch.read`/etc.), opened
Usuarios → Roles → Cajero → Permisos, expanded the "Sucursales" domain
group: all 3 checkboxes (`branch.create`/`branch.read`/`branch.suprede`)
render visibly disabled (greyed), and a deliberate click on
`branch.create` did **not** toggle it — the Permission Picker's
disabled-checkbox guard is real client-side reinforcement of the same
server-side rule, not merely a server-side check with a misleadingly
enabled-looking UI. **PASS.**

## PROBE 4 — tenant isolation

- Second-tenant owner `GET /api/v1/users` → **200**, own tenant only
  (sanity).
- Second-tenant owner `GET /api/v1/companies/{own-id}/branches` →
  **200**, only `["UNI"]` (their own single branch).
- Second-tenant owner `GET /api/v1/companies/{FIRST-tenant-id}/branches`
  (the *first* tenant's `company_id` substituted directly into the
  URL) → **403** `company_scope_mismatch`.
- Second-tenant owner `GET /api/v1/branches/{first-tenant's-Sucursal-Principal-id}`
  (a direct object reference to the first tenant's own branch) →
  **403** `branch_scope_mismatch`.

Both cross-tenant attempts — company-scoped listing and direct object
access by id — were real, denied server-side. **PASS.**

## PROBE 5 — branch-scoped manager cannot mutate a branch they are not assigned to

- Gerente (scoped to Sucursal Norte only)
  `PATCH /api/v1/branches/{Sucursal-Principal-id}` (a branch they are
  **not** assigned to) → **403** `permission_denied`. **PASS.**

## PROBE 6 — a deactivated user cannot continue using a previously-issued session, specifically against the new Phase 6 admin endpoints

This extends `docs/RC_FAILURE_RECOVERY_MATRIX.md` scenario I
(unchanged there) to the brand-new Phase 6 admin endpoints (cash
register administration) specifically, both read and write.

1. Gerente logs in fresh — a real, currently-valid session.
2. **Before** deactivation, with that session: `POST
   /api/v1/cash-registers` (a brand-new Phase 6 admin endpoint) →
   **201** (separately reconfirmed in Probe 2a; the repeat attempt in
   this run hit a duplicate-code `400`, which is itself proof the
   earlier create was real and persisted).
3. Owner: `PATCH /api/v1/users/{gerenteId} {membership_status: "disabled"}`
   → **200**.
4. **Same, still-in-hand** Gerente access token, **same** new admin
   endpoint, a write: `POST /api/v1/cash-registers` → **401**
   `session_expired`.
5. **Same** dead token, a **read** on the same new admin domain:
   `GET /api/v1/cash-registers` → **401** `session_expired` (reads
   are blocked too, not just writes).
6. Owner reactivates Gerente (`membership_status: "active"`) → **200**.
7. The **old** token, reused **after** reactivation → still **401**
   `session_expired` — reactivation does not retroactively resurrect a
   dead session.
8. A **fresh login** for Gerente after reactivation → **200** (the
   real, working recovery path).

Both read and write are fail-closed for a dead session against the
brand-new admin surface, and reactivation correctly requires a new
login rather than reviving the old token. **PASS.**

## PROBE 7 — direct URL/navigation manipulation

Read `apps/one/lib/app/router.dart`: the `go_router` route table only
defines `/bootstrap`, `/login`, `/dev/first-run-preview`,
`/select-company`, `/select-branch`, `/dashboard`, `/unavailable`,
`/session-ended`. None of the POS shell's internal modules (Usuarios,
Roles, Sucursales, Admin. Inventario, Catálogo Avanzado, etc.) are
registered `go_router` paths at all — they are managed entirely as
in-memory shell state (an internal "selected module" value), never
URL-addressable.

**Live-verified**: navigated the real browser directly to
`http://127.0.0.1:8095/#/users` while deep inside Roles → Permisos —
the app made no navigation change whatsoever; the URL fragment isn't
even a route the shell recognizes, and session/module state was
completely unaffected. There is no client-side deep-link bypass
surface to begin with. Given that, the meaningful test is that the
**server** remains the actual gate regardless of any URL manipulation
— already proven exhaustively by Probes 1-6 above, every one of which
is a raw HTTP call that bypasses the Flutter UI entirely and is denied
exactly where it should be. **PASS.**

---

## Cleanup notes

Test fixtures intentionally left in the disposable demo tenant (all
real, all inside `asone_commercial_demo`, none touching a protected
database): role "Prueba Permisos Limitados" + user "Picker Test User";
second tenant "Segundo Tenant Demo S.A. de C.V." (+ its owner);
Gerente's extra test cash register(s) on Sucursal Norte from Probes
2a/6. No production/RC database was touched. No commit. No push.

## Verdict

**GREEN.** Every probe — cashier boundary, manager boundary (granted
vs. not, including a genuine branch-scope-vs-company-scope nuance),
self-escalation guard (server **and** live UI), tenant isolation
(company-scoped listing **and** direct object reference), branch-scope
mutation boundary, dead-session fail-closed behavior on the brand-new
admin endpoints (read and write, plus no session resurrection on
reactivation), and direct URL manipulation — resolved exactly as
expected, with real HTTP evidence for every claim. Zero gaps found in
this phase; no fix was required.
