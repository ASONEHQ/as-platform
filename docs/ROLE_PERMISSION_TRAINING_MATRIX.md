# Role & Permission Training Matrix (TASK 17.5)

Purpose: answer, from the actual repository code (never from a role's *name*, never
inferred intent), "what does a role really do in ACCESS GO today?" — so training
material and future policy decisions start from ground truth, not assumption.

Everything under **IMPLEMENTED CURRENT STATE** is verified directly against
`apps/api/src/modules/auth/auth.repository.ts`, `apps/api/src/modules/admin/shared/admin.service.ts`,
`packages/database/src/seeds/role-templates.ts`, `packages/database/src/seeds/system-role-permissions.ts`,
`packages/database/src/seeds/technical-permissions.ts`, and `apps/one/lib/features/pos/pos_navigation.dart`.
Nothing here was changed by TASK 17.5 — this document is research, not a policy change.

## 1. Roles are tenant-configurable — there is no fixed role enum

Every company can create arbitrary roles (`is_system=false`) with any permission
combination via `POST /roles` / `PUT /roles/{id}/permissions`. There is no backend
concept of a company having exactly "an Owner, a Manager, a Cashier" — that's a
*convention*, not a constraint.

The only role that is ever forced is **Owner**, created once per company at
provisioning (`ProductionOwnerProvisioner` / `DevelopmentOwnerBootstrap`) and marked
`is_system=true`. It is granted **every permission in the catalogue**
(`syncSystemRolePermissions`, `packages/database/src/seeds/system-role-permissions.ts:40-51`).

## 2. The four seeded "starter templates" (UI pre-fill only — never enforced)

`packages/database/src/seeds/role-templates.ts:290-328` defines four checklists used
only to *pre-fill* the "create role" form. They are **not** read by any authorization
check, and an admin can freely edit every checkbox before saving:

| Template label | Internal key | Permission count | Notes |
|---|---|---|---|
| Administrador | `administrator` | full catalogue | every technical permission |
| Gerente | `manager` | 84 | includes `report.read` (line 134) |
| Cajero | `cashier` | 19 | sale/cash/basic catalog scope |
| Administrador de pruebas | `beta_tester` | hand-picked | TASK 16.18 |

**A real tenant's actual "Gerente" role may look nothing like this template** — it's
only what a fresh checkbox-list starts as.

## 3. Owner / system-role protection (IMPLEMENTED)

`roles.is_system` is the only protection flag. In `admin.service.ts`:

- `updateRole` — blocks renaming/status changes on a system role (line 556-565).
- `replaceRolePermissions` — blocks any permission change on a system role (line 640-650).
- `revokeRoleAssignment` — blocks un-assigning a system role from its holder (line 700-714).
- `assignRole` — blocks attaching a system role to anyone through the ordinary endpoint (line 794-816).

Net effect: the Owner role is **entirely outside** the standard role-management
endpoints' reach — not just "extra-protected," structurally unreachable.

## 4. Self-escalation protection (IMPLEMENTED)

Centralized, not role-name-based:

- `replaceRolePermissions` (`admin.service.ts:605-628`) rejects granting any `allow`
  permission the acting admin does not themself currently hold (`deny` is exempt).
- `assignRole` (`admin.service.ts:745-767`) rejects attaching a role to *anyone*
  (including the actor) if that role grants a permission the actor lacks.

Both checks key off the actor's live, deny-aware effective permission set — never
off a role's or actor's name/title.

## 5. Dashboard / Reports — CURRENT BEHAVIOR vs. POLICY DECISION REQUIRED

**CURRENT BEHAVIOR (implemented, verified):**
`apps/one/lib/features/pos/pos_navigation.dart`'s `_posModuleRequiredAnyPermission`
gates both `PosModule.dashboard` and `PosModule.reports` on a single shared code:
`report.read`. This is purely permission-code-based — grep confirms no role-name
check exists anywhere in the Flutter admin UI (the only place a role's `name`/`code`
string is even read is a cosmetic icon/color picker in the role list, with zero
effect on authorization).

As seeded today, the `manager` starter template's permission list **includes**
`report.read` (`role-templates.ts:134`) — so a role created unmodified from that
template would see Dashboard and Reports.

**POLICY DECISION REQUIRED:** the concern raised in review — *"Gerente no vería
Dashboard ni Reportes"* — is a statement about what the business **wants**, not
about what the code currently does. Whether a real tenant's actual Manager role
should or shouldn't carry `report.read` is a business policy call for that tenant to
make (roles are per-company and fully editable), not something this task changed or
should change silently. If ACCESS GO wants a *different default* for future
tenants, that means editing the `manager` starter template's checkbox list — never
hardcoding a role-name check in the Flutter navigation layer, which would violate
this codebase's own permission-code-only convention.

## 6. Branch scope resolution (IMPLEMENTED, unchanged by this task)

`resolveContext` (`auth.repository.ts:69-180`):

- A role assignment with `user_roles.branch_id IS NULL` is **company-wide** — the
  actor gets every active branch in the company (`permittedBranchIds`), narrowed no
  further by register.
- Otherwise, branches come from `user_branch_access` rows and branch-scoped
  `user_roles.branch_id` matches, optionally narrowed again to specific registers
  via `user_register_access`.

This is the same resolution path every login (password, PIN, QR) uses — verified
directly for the PIN quick-switch path in TASK 17.4.4/17.4.5.

## 7. Sensitive permission codes (reference — real codes only)

From `packages/database/src/seeds/technical-permissions.ts`:

- **User/role management:** `user.read`, `user.create`, `user.update`, `role.read`,
  `role.create`, `role.update`, `role.permission.manage`, `role.assign`, `permission.read`
- **PIN/credential management:** `staff_credential.manage` — deliberately distinct
  from `employee.manage`/`user.update`; governs a staff member's own PIN/QR only
- **Financial mutation:** `payment.read`, `payment.create`, `payment.reverse`,
  `refund.read`, `refund.create`, `refund.approve`, `refund.complete`, `refund.cancel`
- **Inventory adjustment:** `inventory.adjust`, `inventory.approve`, `inventory.count`,
  `inventory.reverse`, `inventory.reconcile`, `inventory.transfer`, `inventory.receive`
- **Party payments:** `party.payment.record`
- **Employee data:** `employee.read`, `employee.manage` (payroll/schedule — distinct
  from `staff_credential.manage`)

## 8. Support contact — BUSINESS INPUT REQUIRED

No support phone number, email, or WhatsApp reference exists anywhere in this
codebase. Every "contact support" string in the product
(`pos_readiness_presentation.dart:96,100,104`, `app_error.dart:345`,
`pos_branding_screen.dart:397`, `pos_shell.dart:13043`, `sales.service.ts:393`) is a
generic instruction with **no actual channel attached** — this is intentional
honesty, not an oversight, and TASK 17.5 does not invent one.

`company_settings` (`packages/database/src/schema/settings.ts:50-77`) is a real,
generic per-company key/value table that *could* structurally hold a support-contact
value, but the application-layer settings catalogue
(`apps/api/src/modules/admin/settings/settings.catalog.ts`) does not currently list
any support-contact key — writing one would be rejected as `unknown_key`.

**BUSINESS INPUT REQUIRED:** a real support phone/email/WhatsApp channel, and a
decision on whether it's global (one number for all of ACCESS GO) or per-tenant
(via a new `company_settings` catalogue key — no migration needed, since the table
is already generic). Until that input exists, no contact information should be
added to the product.

## Summary

| Question | Answer |
|---|---|
| Fixed role enum? | No — fully tenant-configurable |
| Owner protected? | Yes — structurally unreachable via standard endpoints |
| Self-escalation blocked? | Yes — centralized, permission-code-based |
| Dashboard/Reports gate | `report.read` only, no role-name check anywhere |
| Does seeded "Gerente" see Dashboard/Reports? | Yes, as currently seeded (editable) |
| Should it? | **Policy decision required — not answered by this task** |
| Support contact configured? | No — **business input required** |
