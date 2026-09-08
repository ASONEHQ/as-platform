# Staff Onboarding — AS POS User Provisioning (Inflapark launch)

TASK 14.2 Section J. This document is a platform-level operator guide: **how
to onboard staff for any AS POS branch/company**, using the real
`/api/v1/users`/`/api/v1/roles` administration API TASK 14.0 built and
fixed. Inflapark's own role names (Manager, Cashier) are used as the worked
example because that is the pilot customer actually launching; the same
sequence of API calls onboards staff for any future park, substituting that
park's own people, role names, and branch(es).

Every claim below was verified by reading
`apps/api/src/modules/admin/shared/admin.service.ts` (`createUser`,
`updateMembership`, and the surrounding role/branch-access methods) and
`apps/api/src/modules/auth/auth.passwords.ts` (`validatePasswordStrength`)
directly — not written from memory of what the API "should" do.

## 0. Owner — already provisioned, one-line pointer

Inflapark's owner account is created by the `provision:production-owner`
CLI (TASK 14.1), **not** by anything in this document — see
[docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md](PRODUCTION_DEPLOYMENT_RUNBOOK.md)
§8 ("First-owner provisioning") for that procedure. Everything below
assumes the owner already exists and is logged in — every step here is
performed **by that owner** (or by a Manager the owner has granted
`user.create`/`user.update`/`role.assign`/`branch_access.manage` to).

## 1. Manager / Cashier creation — the real, four-step flow

Whether your park chooses to have a Manager role in addition to Cashier is
a business decision (per store policy) — the sequence below is identical
either way; only the role's own permission set differs (a Manager
typically gets a broader permission set than the minimal Cashier list in
§1.4; the exact Manager permission list is `REQUIRED_OPERATOR_INPUT` — no
task's rehearsal fixed a canonical "Manager" permission set the way TASK
14.0 fixed the Cashier one, so decide and record it explicitly rather than
guessing).

### 1.1 Create the identity — `POST /api/v1/users`

```
POST /api/v1/users
{ "email": "<real staff email>", "display_name": "<real staff name>" }
```

Confirmed in `AdministrationService.createUser`: this inserts a new `users`
row with `status='pending'` and **no password hash at all**, plus a
`company_memberships` row with `status='invited'`. The person cannot log in
yet — there is no code path that sets a password at this step. Requires
the acting admin to hold `user.create`.

### 1.2 Role — create it if it doesn't exist yet, then assign it

If the role doesn't already exist for this company:

```
POST /api/v1/roles
{ "name": "Cajero", "code": "cashier", "description": "..." }

PUT /api/v1/roles/{role_id}/permissions
{ "permissions": [
  { "permission_id": "<catalog.read id>", "effect": "allow" },
  { "permission_id": "<inventory.read id>", "effect": "allow" },
  ... one entry per permission code — for a Cashier role, use exactly the
  minimal permission list TASK 14.0's own live rehearsal confirmed
  sufficient, reproduced in
  `docs/GO_LIVE_CHECKLIST.md`'s "Cashier" section (not re-listed here to
  avoid two copies of the same list drifting apart)
] }
```

`GET /api/v1/permissions` lists every permission code with its id (the
technical seed, `pnpm --filter @asone/database db:seed`, is what inserts
the full catalogue — this must already have run per
`docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md` §7 before any of this).

If the role already exists (e.g. reusing the same "Cajero" role for a
second hire), skip straight to assigning it:

```
POST /api/v1/users/{user_id}/roles
{ "role_id": "<existing role id>", "branch_id": "<optional, for a
  branch-scoped assignment>" }
```

Confirmed in `AdministrationService.assignRole`: this requires the target
membership to already be `active` in `company_memberships` — attempting it
while the membership is still `invited` is rejected with
`company_scope_mismatch` (403), confirmed directly in the code (the same
guard exists in `changeBranchAccess` for the branch-access step below).
**This means activation (§1.4) must happen BEFORE role assignment and
branch-access grant, not after** — creating the role definition itself
(`POST /api/v1/roles`, when the role doesn't already exist) has no such
dependency and can happen at any time, but assigning that role to THIS
user, and granting THIS user branch access, both require the membership to
already be `active`. The correct working order is: create user (§1.1) →
[create the role definition, if needed] → activate with a real password
(§1.4) → assign the role → grant branch access. See the "Summary sequence"
at the end of this document for the exact copy/paste order.

### 1.3 Branch access — `PUT /api/v1/users/{user_id}/branch-access/{branch_id}`

```
PUT /api/v1/users/{user_id}/branch-access/{branch_id}
{ "status": "active", "is_default": true }
```

Requires `branch_access.manage`. `AdministrationService.changeBranchAccess`
also requires the membership to be `active` first (same
`company_scope_mismatch` guard as role assignment above).

### 1.4 Activation with a REAL password — `PATCH /api/v1/users/{user_id}`

```
PATCH /api/v1/users/{user_id}
{ "membership_status": "active", "password": "<a real password>" }
```

**This is the one TASK 14.0 launch-blocker fix that materially changed
this flow, and it is load-bearing — read this carefully.** Before that
fix, `createUser` left a `pending` identity with no password hash and
*nothing anywhere in the codebase* ever set one — a second real staff
account genuinely could not be onboarded through the product at all; only
the dev-only `bootstrap-owner` tooling (excluded from production) could
produce a working login. TASK 14.0 fixed this at
`AdministrationService.updateMembership`, confirmed by reading it directly:

- `isFirstActivation` is true exactly when `status === 'active'` **and**
  the identity's current `users.status` is still `'pending'`.
- On first activation, `password` is **required** — an empty/undefined
  value throws a `validation_error` ("A password is required to activate a
  new account for the first time."), confirmed rejected, not merely
  documented as required.
- The password is checked by `validatePasswordStrength`
  (`auth.passwords.ts`): **at least 12 characters, containing uppercase,
  lowercase, a digit, and a symbol**, and rejected if it contains any of a
  fixed placeholder blocklist (`password`, `changeme`, `change_me`,
  `replace_me`, `example`) — so a lazy placeholder password is refused,
  not merely discouraged.
- Only after passing that check is it hashed (`argon2id`) and written to
  `users.password_hash` in the **same transaction** as the membership
  activation.
- Every subsequent status change for that same identity (suspend/disable/
  reactivate) does **not** re-touch `users.status`/`password_hash` at all —
  `isFirstActivation` is only ever true once, on the very first transition
  out of `pending`. A person who belongs to more than one company stays
  `active` at the identity level for their other companies even if
  suspended at this one, by design.

Requires `user.update`.

## 2. Distributing the initial password — never through this system's own records

The owner (or whoever activates the account) chooses the real password
sent in the `PATCH` call above and must hand it to the new hire through a
channel **outside** AS POS itself: in person, or a secure one-time
channel the business already trusts (never by writing it in a shared
spreadsheet, a group chat, or a sticky note visible to others).

**Confirmed by reading the code directly**: the audit-log call inside
`AdministrationService.updateMembership`'s own `repository.mutate({...})`
invocation passes only `action: 'membership.${status}'`, `entityType:
'company_membership'`, `entityId: userId`, and no `metadata` field at all
for this call (unlike, say, `assignRole`'s `metadata: { user_id, role_id
}`). The plaintext `password` value is read only as a local function
parameter, used solely to call `validatePasswordStrength` and then
`hashPassword` — it is never passed into the audit/outbox mutation, never
logged (per `packages/logger`'s own `redact` list, which explicitly
includes `password` as a defense-in-depth backstop, confirmed in
[docs/OBSERVABILITY_AND_SUPERVISION.md](OBSERVABILITY_AND_SUPERVISION.md)
§1.1), and never stored anywhere except as its `argon2id` hash. There is no
durable system record — audit log or otherwise — that a supervisor could
later query to recover a forgotten initial password; the owner is the only
one who ever knows it, and only until they hand it off.

## 3. Required password change on first login — POST-LAUNCH GAP, not built

**Checked directly, not assumed**: there is no "must change password on
first login" mechanism anywhere in this codebase. `users` carries no
`must_change_password`/`password_expires_at`-style flag, `AuthService`'s
login path (`auth.service.ts`) has no branch that forces a password reset
before issuing a session, and nothing in `admin.service.ts` sets any such
flag at activation time. The owner-chosen password from §1.4 remains the
account's password indefinitely, until someone with `user.update`
explicitly changes it through whatever password-change mechanism exists
(if any — this document does not invent one).

**This is a real gap, documented honestly as POST-LAUNCH**, not something
to fake here: if Inflapark's security posture requires forcing a fresh
staff-chosen password on first login, that is a product/engineering
backlog item (a new `must_change_password` flag plus a login-time gate),
not a launch-day configuration step. For opening day, the operational
mitigation is procedural, not technical: the owner should choose a
sufficiently strong, unique password per hire at activation time (§1.4
already enforces strength) and treat it as that hire's real password going
forward, exactly like any other credential handed to them in person.

## 4. Disabling an employee — `PATCH /api/v1/users/{id}`, confirmed session revocation

```
PATCH /api/v1/users/{user_id}
{ "membership_status": "disabled" }
```

Requires `user.update`. No `password` field is needed or accepted for
this transition (only relevant for the `pending → active` first-activation
case in §1.4).

**Confirmed by reading `updateMembership` directly**: whenever `status !==
'active'` (this covers both `suspended` and `disabled`), the same
transaction that updates `company_memberships.status` also:

- Revokes every currently-`active` row in `sessions` for that
  `(company_id, user_id)` pair (`status='revoked'`,
  `revocation_reason='membership_${status}'`).
- Revokes every `session_refresh_tokens` row belonging to those now-
  revoked sessions.

So disabling (or suspending) an employee **does** immediately revoke their
active sessions and refresh tokens in the same atomic transaction as the
status change — confirmed directly in the code, not merely asserted. A
disabled employee cannot continue using an already-open browser tab/session
after this call completes, and any attempt to use a stored refresh token
to mint a new access token will fail because the refresh token itself is
now `revoked`.

Re-enabling a `disabled` or `suspended` membership (`PATCH` with
`membership_status: "active"`) does **not** count as a first activation
(the identity's `users.status` is already `'active'` from the original
activation, not `'pending'`) — no password is required or accepted for a
re-activation; the person's existing password from §1.4 still applies.

## Summary sequence (copy/paste checklist form)

1. `POST /api/v1/users` — create the pending identity.
2. `POST /api/v1/roles` + `PUT /api/v1/roles/{id}/permissions` — only if
   the role doesn't already exist for this company.
3. `PATCH /api/v1/users/{id}` with `membership_status: "active"` and a
   real, strong `password` — **required** on this first call, confirmed
   rejected otherwise.
4. `POST /api/v1/users/{id}/roles` — assign the (now-active) membership its
   role, optionally branch-scoped.
5. `PUT /api/v1/users/{id}/branch-access/{branch_id}` — grant branch
   access, marking a default branch if applicable.
6. Hand the chosen password to the new hire in person or via a secure
   one-time channel — never through this system's own logs/audit trail
   (confirmed: none of it is ever recorded there).
7. Confirm login works, then confirm the new account is correctly denied
   any action outside its granted permissions (see
   [docs/GO_LIVE_CHECKLIST.md](GO_LIVE_CHECKLIST.md)'s own "Cashier"
   section for the exact denial checks TASK 14.0's rehearsal used).

## References

- `apps/api/src/modules/admin/shared/admin.service.ts` — `createUser`,
  `updateMembership`, `assignRole`, `changeBranchAccess` (source of every
  claim above).
- `apps/api/src/modules/admin/identity/identity.routes.ts` — the exact
  HTTP routes and request/response shapes.
- `apps/api/src/modules/auth/auth.passwords.ts` — `validatePasswordStrength`,
  `hashPassword`.
- [docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md](PRODUCTION_DEPLOYMENT_RUNBOOK.md)
  §8 (owner provisioning), §15 (this same flow summarized at deploy time).
- [docs/GO_LIVE_CHECKLIST.md](GO_LIVE_CHECKLIST.md) — the Cashier
  checklist section and the exact minimal permission list this document's
  §1.4 example role is built from.
- [docs/OBSERVABILITY_AND_SUPERVISION.md](OBSERVABILITY_AND_SUPERVISION.md)
  §1.1 — the logger's own `redact` list, confirming `password` is never
  logged anywhere in this codebase.
