# Multi-branch authorization (TASK 17.3)

How ACCESS GO decides *who* can act *where* across a company's branches.
This documents the real, already-implemented model — it introduces no new
tables, no new endpoints, and no second authorization system. See
[`AUTHENTICATION_FOUNDATION.md`](AUTHENTICATION_FOUNDATION.md) for login/
session mechanics and [`USERS_EMPLOYEES_UX.md`](USERS_EMPLOYEES_UX.md) for
the admin UI this model backs.

## 1. The five entities, and why they're kept separate

| Entity | Answers | Table |
| --- | --- | --- |
| Company | the tenant | `companies` |
| Branch | a physical location within a company | `branches` |
| User | a login identity (email + password/PIN) | `users` |
| Employee | a person on payroll/schedule | `employees` |
| Role | a named bundle of permissions | `roles` |
| Permission | one grantable capability (`sale.create`, `branch_access.manage`, …) | `permissions` |

**User ≠ Employee.** A login account and a payroll record are different
concepts on purpose: `employees.user_id` is an optional foreign key, not a
required one. Someone can be scheduled and paid without ever logging into
the POS (a costume performer at a party, say), and a login can exist
without a linked employee record (an external accountant given read-only
report access). Never assume one implies the other.

**Role = what. Branch assignment = where.** A role never encodes a branch,
and a branch grant never encodes a permission. The two compose:

- `roles` / `role_permissions` — company-scoped, no branch concept at all.
  "Gerente" grants the same permissions everywhere it's assigned.
- `user_roles` — the join between a membership and a role, with an
  **optional** `branch_id`. `branch_id IS NULL` means "this role's
  permissions apply company-wide." A non-null `branch_id` scopes that
  specific grant to one branch. A user can hold the same role — or
  different roles — scoped to different branches via multiple rows.
- `user_branch_access` — an explicit "can this membership use this
  branch at all" grant (`status`: active/revoked, `is_default`), narrowed
  further by `user_register_access` (TASK 16.15) to a specific cash
  register or operational area.

A membership's real, enforced set of usable branches
(`permittedBranchIds`) is the union of every branch it has an **active,
branch-scoped `user_roles` row** for, plus every branch it has an
**active `user_branch_access` row** for — see §4. Either one alone is
sufficient; granting both (which the admin UI's combined create/edit flow
now does — §6) is what gives a user real permissions *and* the ability to
switch to that branch.

## 2. Owner semantics

"Owner" is the one `is_system = true` role auto-provisioned per company at
onboarding, holding every permission and always assigned with
`branch_id IS NULL` (company-wide). It is not a special-cased role name —
`is_system` is what makes it structurally different:

- **Unconditionally immutable** via the generic admin API. An `is_system`
  role holder can never be suspended, reassigned, or have that role
  revoked through `PUT/DELETE /users/:id/roles/...` at all — not "the
  last one," *every* one. This is stronger than a count-based "last
  admin" check and needs no such check.
- Company-wide access (`branch_id IS NULL`) means the branch-listing SQL
  skips the per-branch join entirely (§4) — an Owner sees every branch in
  the company today, and automatically sees a branch created tomorrow,
  with no separate grant needed.

Example: **Owner** — every INFLAPARK branch, present and future, forever
(until the role itself is edited by another Owner).

## 3. Multi-branch, non-Owner users

A user can hold zero, one, several, or all of a company's branches
without being an Owner, by holding multiple branch-scoped `user_roles`
rows (or the union with `user_branch_access` rows):

- **Gerente — Puerta La Victoria**: one `user_roles` row,
  `branch_id = <Puerta La Victoria>`.
- **Regional — Puerta La Victoria + Juriquilla**: two `user_roles` rows,
  same role, two different `branch_id` values. Not company-wide — a
  future third branch is invisible to this user until explicitly granted.
- **Cajero — Juriquilla**: one `user_roles` row, `branch_id = <Juriquilla>`.

This is proven end-to-end by
[`multi-branch-authorization.integration.test.ts`](../apps/api/src/modules/auth/multi-branch-authorization.integration.test.ts)
using exactly this shape (Company A with branches A1/A2/A3, a REGIONAL_A
actor holding A1+A2 but never A3, alongside OWNER_A/MANAGER_A1/CASHIER_A2
and a fully isolated OWNER_B in a separate Company B).

## 4. Server-side enforcement — never trust the client

**The Flutter branch selector is not an authorization boundary.** It is a
convenience list built from a context the server already computed and
already trusts nothing else about. Every request that touches
branch-scoped data is checked again, server-side, against fresh data.

### Per-request, never cached

`AuthContext` — including `permittedBranchIds` and `companyWideAccess` —
is recomputed by `PostgresAuthRepository.resolveContext()`
(`apps/api/src/modules/auth/auth.repository.ts`) on **every single
request**. The JWT carries only an opaque `sessionId` and `userId`; it
never embeds permissions, roles, or branch grants. There is no server-side
cache of this data either. A revoked grant or a newly-assigned role is
enforced on the *next* request, full stop — no logout, no token refresh,
no propagation delay.

The exact query (`auth.repository.ts:98-116`):

```sql
-- "does this membership hold an active, active-role, branch_id IS NULL grant?"
select 1 from user_roles ur join roles r on r.id = ur.role_id and r.company_id = ur.company_id
where ur.membership_id = $1 and ur.company_id = $2 and ur.branch_id is null
  and ur.status = 'active' and r.status = 'active' limit 1
-- companyWideAccess = (that query found a row)

-- if companyWideAccess: every active branch in the company.
-- otherwise: every active branch this membership has EITHER an active
-- branch-scoped user_roles row OR an active user_branch_access row for.
select distinct b.id from branches b
  left join user_roles ur on ur.branch_id = b.id and ur.company_id = b.company_id
  left join roles r on r.id = ur.role_id and r.company_id = ur.company_id and r.status = 'active'
  left join user_branch_access uba on uba.branch_id = b.id and uba.company_id = b.company_id
    and uba.membership_id = $1 and uba.status = 'active'
where b.company_id = $2 and b.status = 'active'
  and ((ur.membership_id = $1 and ur.status = 'active' and r.id is not null) or uba.id is not null)
```

### The enforcement point

`AuthService.requireBranchAccess(context, branchId)`
(`apps/api/src/modules/auth/auth.service.ts:884`) throws
`branch_scope_mismatch` (403) whenever `branchId` is not in that fresh
`context.permittedBranchIds` array. Every branch-scoped route calls this
— a client-supplied `branch_id` is only ever a *request parameter*, never
a trust signal. Passing a different branch's id manually (DevTools,
curl, a modified app build) is rejected exactly the same way the UI's own
"no such option in the dropdown" would have prevented, because it's the
same check either way.

### Branch switching

`POST /api/v1/auth/branch-switches` doesn't flip a flag — it re-runs
`resolveContext()` for the target branch and, on success, rotates the
session token. If the membership's access to that branch was revoked a
moment earlier, the switch itself fails with `branch_scope_mismatch`
before any new token is ever issued.

## 5. Revocation is immediate

Because `resolveContext()` is fresh per request with no cache, revoking a
role assignment (`DELETE /users/:id/roles/:assignment_id`) or a branch
grant (`DELETE /users/:id/branch-access/:branch_id`) takes effect on the
user's very next API call — mid-session, no re-login required. A
long-lived open tab loses access the moment it makes its next request.

## 6. Creating and editing multi-branch users

The admin UI (`PosUserAdministrationScreen` →
`apps/one/lib/features/pos/pos_user_administration_screen.dart`) calls
only the already-existing identity admin endpoints — this task added no
new backend route:

- `POST /users` — create (invited status; a password is set on first
  activation, from the user's own detail view).
- `POST /users/:id/roles` (`assignRole`, optional `branch_id`) — grant a
  role, company-wide (`branch_id: null`) or scoped to one branch.
- `PUT/DELETE /users/:id/branch-access/:branch_id` (`changeBranchAccess`)
  — grant/revoke explicit branch access, with an `is_default` flag.
- `POST/GET/DELETE /users/:id/register-access` — narrow further to a
  specific register/operational area (TASK 16.15, unchanged by this
  task).

**Create** (`_UserFormDialog`) now presents role + branch access together
instead of forcing "create, then open the detail view, then assign a
role, then grant each branch one at a time": a "General" section
(name/email) and an "Acceso" section (a role dropdown, plus either
"Todas las sucursales" or a per-branch checkbox list). On submit it
sequences the *same two calls above* — one `assignRole` per selected
branch plus a matching `changeBranchAccess` grant (the first selected
branch becomes the default), or a single company-wide `assignRole` call
when "Todas las sucursales" is checked. If user creation succeeds but the
subsequent access assignment fails (e.g. the acting admin tried to grant
a permission they don't themselves hold — §7), the dialog says so
explicitly and points the admin at the user's own detail view to finish
the job; it never reports success silently or leaves the admin guessing.

**Edit** (`_UserDetailDialog`) already presented this correctly before
this task and is intentionally left as-is: real branch names (never a raw
UUID), individually permission-gated add/revoke actions
(`role.assign`/`branch_access.manage`, each with a `Tooltip` explaining
why a control is disabled rather than hiding it), and the same two
endpoints reused a la carte for ongoing changes after creation.

**"Todas las sucursales" is never a fake checkbox.** Checking it performs
the real `branch_id: null` company-wide grant described in §2/§4 — the
same mechanism the Owner role itself uses — not a client-side convenience
that silently expands to "every branch id we currently know about."

## 7. Self-escalation and safety invariants

- **An actor can never grant what they don't hold.** Assigning a role or
  permission that exceeds the acting admin's own grants is rejected
  server-side, uniformly whether the target is another user or the actor
  themself. Proven by `workspace-scope.integration.test.ts`'s own
  "self-escalation guard" case.
- **Every `is_system = true` role holder is immune to modification**
  through the generic admin API (§2) — stronger than a "last Owner"
  count, since it never depends on how many exist.
- **Cross-company isolation is absolute.** `resolveContext()`'s own
  membership lookup requires `m.id = membershipId AND m.company_id =
  companyId AND m.user_id = userId` to all match; supplying a real
  membership id or branch id from a *different* company returns `null`
  outright — it never leaks that the other company's data exists, let
  alone reads it. Proven both by `workspace-scope.integration.test.ts`'s
  §28 case and by this task's own `multi-branch-authorization.
  integration.test.ts` (OWNER_B cannot resolve into Company A even with
  Company A's real ids, and a stolen membership id paired with the wrong
  user id also fails).
- **Cross-branch isolation is enforced, not merely hidden.** A
  branch-scoped user attempting a request for a branch they don't hold
  gets a real `branch_scope_mismatch` (403) from `requireBranchAccess`,
  not just an absent dropdown option — proven for every named actor in
  §3's matrix.

## 8. Audit logging

Every admin mutation (create user, assign/revoke role, grant/revoke
branch access, register access changes) already flows through
`AdminRepository.mutate`'s existing `audit_log` write — reused as-is,
never duplicated. The new combined create-dialog flow produces the exact
same audit rows a manual create-then-assign-then-grant sequence would
have, since it calls the exact same endpoints.

## 9. Known, deliberate limitations

- **Company/branch creation and editing is out of scope for this task.**
  This task is about *user access* to existing branches, not a
  branch-management redesign. `pos_branch_admin_screen.dart` already
  covers branch create/edit separately.
- **No schema or migration changes.** The branch-membership model
  described here already existed in full before this task; nothing here
  required a new table, column, or migration.
- **The Roles & Permissions screen is unchanged.** Roles are
  intentionally company-wide-only entities with no branch concept on the
  role itself (branch scoping lives on the *assignment*, `user_roles.
  branch_id` — §1); redesigning the role editor to imply otherwise would
  misrepresent the model, so it wasn't touched.

## 10. Example roster

| User | Branches | Mechanism |
| --- | --- | --- |
| Owner | Every INFLAPARK branch, always | `is_system` role, `branch_id IS NULL` |
| Gerente | Puerta La Victoria | one branch-scoped `user_roles` row |
| Regional | Puerta La Victoria + Juriquilla | two branch-scoped `user_roles` rows |
| Cajero | Juriquilla | one branch-scoped `user_roles` row |

No real personal credentials appear in this document or in any of this
task's fixtures — every example above and every integration-test actor
uses a synthetic `@example.test` identity.
