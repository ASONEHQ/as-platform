# Users + Employees — Visual/Operational Upgrade (TASK 16.31)

Recovers the visual density and hierarchy of an earlier reference implementation (dense cards, master/detail, KPI strips, permission chips) on top of the CURRENT, real V1 architecture and RBAC model — never the reverse. The reference screenshots were a visual/functional benchmark only; none of their sample names, roles, or numbers were introduced as app data.

## Users vs. Employees — the separation, unchanged

Confirmed against the real schema (`packages/database/src/schema/`), not assumed:

- **Users** (`users`, `company_memberships`, `roles`, `role_permissions`, `user_roles`, `user_branch_access`) = authentication, roles, permissions, branch scope, session/security. Lives in `pos_user_administration_screen.dart`.
- **Employees** (`employees`) = workforce/HR — job info, schedules, attendance, payroll. Lives in `pos_people_screen.dart` (TASK 16.28/16.29/16.29.3).
- **The link**: `employees.user_id` is a nullable FK into `(company_memberships.company_id, company_memberships.user_id)` — an employee MAY link to a user; neither side requires the other. This task adds **presentation only** on top of that existing relationship — see "User ↔ Employee visual link" below. No record was merged, duplicated, or auto-created across the boundary.

## Architecture audit — answers to this task's own Phase 1 questions

1. **Fields that already existed but weren't displayed**: `PosUser`/`PosUserDetail` already carried enough (via `GET /users/{id}?include=roles,branches`) to show a real role badge and branch scope per user — just never fetched/rendered on the list. `PosRole.description`/`isSystem` existed but weren't shown on the list row. `PosEmployee.phone` existed but wasn't on the card (only in the detail dialog).
2. **Old visual features recoverable with current real data**: dense user/employee cards, KPI strip (with 2 of 4 metrics honestly substituted — see below), role master/detail with icon/color/protected badge, a real commercial permission matrix (this already existed, TASK 16.16A — reused, not rebuilt), permission chips on a real session tab.
3. **Old features NOT supported, and why** (never faked):
   - **"Hora de entrada" (login time)** — `users.last_login_at` exists as a schema column but is **never written or read anywhere** in the backend. Confirmed dead by a full grep across `apps/api/src`. Omitted entirely.
   - **"Equipo"/"IP" (device/IP)** — no IP address field exists anywhere in the schema (not on `sessions`, not on `audit_log`). `device_id` exists (a real, admin-registered POS terminal, not an ad hoc browser fingerprint) but showing it wasn't judged worth a second real fetch for this pass. Omitted.
   - **"Cambiar contraseña"** — no endpoint exists to change an already-active user's password (`PATCH /users/{id}`'s `password` field is silently ignored unless the user is transitioning out of `pending` for the very first time). No button was added.
   - **"Cambiar usuario rápido" (quick user switch)** — see its own section below.
   - **A per-role "N usuarios" count on the role list** — no reverse aggregate endpoint exists (`role → users`); computing it would mean fetching every user's own role assignments just to render a handful of role rows, a real N+1 the pre-existing `_RoleRow` doc comment had already declined for the exact same reason. Left off the role card; the Usuarios tab's own "Roles en uso"/"Sin rol asignado" KPIs are the honest, differently-derived substitute.
   - **A resolved "empleado" name/title on the Users card** — `PosUser`/`PosUserDetail` carry no employee link at all; resolving one would require wiring the Employees gateway into the Users screen (a new cross-module dependency). Deliberately deferred — see "User ↔ Employee visual link" below.
4. **Quick-user-switching security audit**: see its own section.
5. **User card fields, all from real data**: name, email, real role name(s) (or an honest "Sin rol"), real branch scope ("Todas las sucursales" when any active role assignment has `branch_id = null`, else the resolved real branch name(s) from `user_branch_access`, else "Sin sucursal asignada"), a real permission count (union of the user's active roles' own granted permissions — bounded-cost, cached per role, see below), and status.
6. **Employee card fields, all from real data**: avatar/initials, name, job title (or "Sin puesto asignado"), status, code, weekly salary (gated on `employee.manage`), and now **phone** (omitted elegantly when absent — never "—"/"null"). "Employment type" does not exist on `PosEmployee` at all — never fabricated; not shown.
7. **Mutations, exactly as they existed before this task** (none invented, none removed): create/update user, activate/deactivate membership, assign/revoke role, grant/revoke branch access, grant/revoke register access, create/update role, replace a role's permissions (with its own pre-existing self-escalation guard), create/update/deactivate employee. This task changed **presentation only** around every one of these.

## Visual system

New, small, shared pieces added only where the existing shapes didn't already cover the need:

- **`_AdminMetricCard`** (Usuarios' KPI tiles) — new.
- **`_UserCard`/`_RoleCard`** — replace the old flat `_UserRow`/`_RoleRow`; same real data, denser presentation, real Spanish status labels via a new `_statusPillLabel` (previously `_StatusPill` rendered the raw backend value verbatim — `active`/`invited`/`suspended`/etc. — a real gap this task closed the same way TASK 16.30 closed it elsewhere in the app).
- **Role icon/color** (`_roleIcon`/`_roleColor`) — deterministic, presentation-only, derived from the role's own real `code` (keyword-matched, with a stable hashed-color fallback for any custom role). `PosRole` has no icon/color column — never pretended otherwise.
- **The existing, already-excellent permission matrix** (`_PermissionPicker`/`_PermissionDomainGroup`/`_PermissionRow`, TASK 16.16A) was reused verbatim — grouped by real domain, real commercial Spanish labels (`pos_permission_presentation.dart`), self-escalation guard intact. This task did not rebuild it.

## Usuarios — top-level structure

`SegmentedButton` tabs: **Usuarios / Roles y permisos / Sesión actual** (previously Usuarios/Roles/Permisos — "Roles" and "Permisos" merge into one master/detail tab; "Sesión actual" is new).

**KPI strip** (real data only): Usuarios totales, Activos, Roles en uso, Sin rol asignado. "Con sesión hoy" from the reference is deliberately absent (see the dead-column finding above) — replaced with two differently-real metrics rather than faked as `0`.

**Toolbar**: search (name/email/role name), a real role filter (populated from `listRoles()`), "Nuevo usuario" (RBAC-gated, disabled+tooltip'd, never hidden).

**Card grid**: responsive (3/2/1 columns), each card enriched via one `userDetail(id)` call per visible user, fired in parallel right after the base list resolves — the same "join after the list, once, bounded" convention Nómina's employee-name join already established (TASK 16.29). A role's own full permission set is fetched **once per distinct role**, cached, and reused across every user who shares it — never once per user.

## Roles y permisos — master/detail

Desktop: a ~320px-wide left pane (role cards: icon/color, name, "Protegido" badge for `is_system`, status pill, selection highlight) beside an expanded right pane (the selected role's detail — reusing `_RoleDetailDialog`'s exact existing logic, now rendered inline via a new `embedded` flag instead of only ever as a modal `Dialog`; the close button is omitted in embedded mode, since there is no route to pop back to). Narrow widths (<860px) stack list-then-detail instead of a crushed two-column row. Nothing selected → the exact same real permission-catalog browse the old standalone "Permisos" tab showed (relocated, not removed — see `_PermissionCatalogBrowse`), independently gated on `permission.read` even for an actor who lacks `role.read`.

Creating a role (from a template or blank) now selects it immediately in the master/detail view instead of opening a second modal — the same underlying `_RoleDetailDialog` content, just inline.

## Sesión actual

Left: a real user card (avatar/initials, name, email, resolved role via one `userDetail` call, branch/company scope from the already-loaded `AuthenticatedContext`), plus "Cerrar sesión" wired to the exact same real logout callback the topbar account menu already uses (`PosShell`'s own `onLogout`, threaded through `_Content` → `PosUserAdministrationScreen`). Right: "Mis permisos activos" as real permission chips (`permissionLabel(code)` — never a raw code as the primary text), sourced directly from `AuthenticatedContext.permissions` with zero extra network calls.

## Quick user switching — audited, deliberately NOT implemented

The backend's `POST /api/v1/auth/pin-login` is real and secure: PIN-hash-verified against the acting company's own memberships (argon2id), and on a match it mints a genuinely new, independent session for the matched user (a real `auth.login_succeeded` audit entry, its own access/refresh tokens), inheriting the calling session's branch/device/transport so it stays pinned to the same physical terminal. **However, the Flutter app's own `_StaffQuickSwitchDialog` deliberately never adopts that new session as the active one today** — it uses `pinLogin` purely as an identity-verification check (kiosk-exit re-auth, staff-presence confirmation), by explicit prior design (see `pos_auth_gateway.dart`'s own header doc comment).

Actually wiring up a live "become this other user" hand-off would mean replacing the app's active session/token state at the `app.dart`/`bootstrap.dart` root — real, security-sensitive plumbing (token storage, refresh-rotation, in-flight-request invalidation) that does not exist today. Building that is a genuine, separate follow-up task, not a decorative addition to a presentation-focused pass. Per this task's own explicit instruction ("if not already securely supported end-to-end: do not implement it — document it as a future product capability"), **no quick-switch UI was added to Usuarios or Sesión actual**, and the existing kiosk/staff-switch verification dialog is untouched.

## RBAC

Every existing gate is unchanged: `user.read`/`role.read`/`permission.read` each independently gate their own pane (see the master/detail split above); every mutation (`user.create`/`user.update`/`role.create`/`role.update`/`role.permission.manage`/`role.assign`/`branch_access.manage`) stays visible-but-disabled with an explanatory tooltip when absent, never hidden, never a looser or stricter mirror than the real server-side check. The role-permission self-escalation guard (a checkbox for a permission the acting session doesn't itself hold stays disabled) is untouched.

## Files modified

`pos_user_administration_screen.dart` (the bulk of this task), `pos_people_screen.dart` (Employee card phone + detail reorg + user-link section), `pos_shell.dart` (threads the real `onLogout` callback down to the new Sesión actual tab), `pos_user_administration_test.dart` + `pos_people_test.dart` (updated/added tests).

**No backend file was touched.** No migration, no schema change, no seed/permission-catalogue change.
