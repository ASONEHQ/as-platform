/// TASK 16.16 — "where should a freshly-authenticated actor land, and does
/// their previously-picked cash register still make sense?" Pure,
/// UI-independent resolution logic, mirroring `pos_register_scope.dart`'s
/// own shape and rigor (TASK 16.15): a pure resolver function plus a doc
/// comment explaining every rule and why it is capability-derived, never
/// role-name-derived. Extracted into its own file, rather than living
/// inline inside `pos_shell.dart`'s `_PosShellState`, specifically so this
/// behavior is unit-testable without driving the entire POS shell (see
/// `pos_register_scope.dart`'s own header comment for the identical
/// rationale).
///
/// **The single most important constraint in this file** (and this whole
/// task): nothing here may ever read a role's NAME or CODE. `permissions`
/// (the actor's own real, backend-issued permission codes) and
/// `companyWideAccess` (the actor's own real, backend-resolved unrestricted-
/// access flag) are the ONLY signals consulted — the exact same two fields
/// `AuthenticatedContext` already exposes for every other decision in this
/// app. A role called "Cajero" and a role called "Taquillero" holding the
/// identical permission set must resolve identically here, always.
///
/// The backend remains the sole security authority — every permission is
/// independently re-verified server-side on every request regardless of
/// where this resolver lands the actor. Everything in this file is UX only:
/// which screen to show first, and whether a stale local UI selection
/// should be cleared, never a grant or a denial.
library;

import 'pos_navigation.dart';

/// "Management signal" permissions: holding ANY of these marks an actor as
/// having at least some administrative/back-office responsibility, distinct
/// from a purely operational, till-facing job. Deliberately a fixed set of
/// real permission codes from the backend's own catalogue — never a role
/// name/code, never derived from `PosModule` gating. Exactly the set this
/// task's own spec calls out.
const posManagementSignalPermissions = {
  'report.read',
  'user.read',
  'role.read',
  'branch.read',
  'branch_consolidation.read',
  'employee.read',
  'inventory_location.manage',
  'supplier.read',
  'purchase.read',
};

/// Resolves which [PosModule] a freshly-authenticated (or freshly-
/// rehydrated) actor should land on, in this exact priority order:
///
///  1. [companyWideAccess] `true` → [PosModule.dashboard]. This is today's
///     existing default, completely unchanged — it correctly captures
///     "Owner/full-access admin" using the REAL existing signal for "an
///     unrestricted, company-wide role holder," never a role-name check.
///
///  2. Else, if [permissions] contains NONE of
///     [posManagementSignalPermissions] AND contains `sale.create` OR
///     `cash_session.open` (i.e. this is a purely operational actor with no
///     management-tier permission at all) → skip the Dashboard entirely and
///     land directly in the POS/register workspace ([PosModule.pos]). This
///     is the "single-register operational cashier logs in and goes
///     straight to their register" case this task explicitly asks for.
///     Register auto-selection/switcher resolution itself is NOT this
///     function's job — that stays exactly `resolvePosRegisterScope`'s
///     responsibility (TASK 16.15, `pos_register_scope.dart`), invoked
///     independently once the POS screen is actually showing; this
///     resolver only decides WHICH module to select first.
///
///  3. Else → [PosModule.dashboard], same as today. This covers "Manager"
///     (holds some management-signal permission but isn't company-wide) and
///     any edge case (e.g. an actor with neither an operational nor a
///     management permission — freshly created with zero grants yet).
///     Dashboard's own body already adapts its content to whatever
///     permissions the actor actually has (e.g. the sales-trend banner is
///     already gated by `report.read`, `_Dashboard.build`'s own `report.
///     read` check gates the whole metrics grid) — so this is a genuine
///     "landing surface appropriate to their scope," never a dead end, and
///     never worse than today's unconditional default.
///
/// Reusing [PosModule.dashboard] for "Manager" — rather than inventing a
/// distinct dedicated landing screen — is a deliberate, disclosed scope
/// decision for this task, not an oversight: Dashboard is already the
/// correct general-purpose "start here" surface for anyone whose job isn't
/// purely operational, and building a second one would be a second, largely
/// redundant "what does my day look like" screen.
PosModule resolvePosStartRoute({
  required bool companyWideAccess,
  required List<String> permissions,
}) {
  if (companyWideAccess) return PosModule.dashboard;
  final permissionSet = permissions.toSet();
  final hasManagementSignal = posManagementSignalPermissions.any(
    permissionSet.contains,
  );
  final hasOperationalPermission =
      permissionSet.contains('sale.create') ||
      permissionSet.contains('cash_session.open');
  if (!hasManagementSignal && hasOperationalPermission) {
    return PosModule.pos;
  }
  return PosModule.dashboard;
}

/// `true` exactly when a previously-picked [selectedRegisterId] no longer
/// makes sense under the actor's CURRENT [permittedRegisterIds] — e.g. an
/// admin revoked the cashier's register grant mid-shift, and a session
/// refresh (`AuthController.refresh`/`_acceptCredentials`) just delivered a
/// freshly-narrowed `SessionContext.permittedRegisterIds` that no longer
/// includes the register `SaleSession.cashRegisterId` was holding onto.
///
/// [permittedRegisterIds] `null` means unrestricted (see `SessionContext.
/// permittedRegisterIds`'s own doc comment) — a `null` scope can never make
/// an existing selection stale, so this always returns `false` for it. A
/// `null`/absent [selectedRegisterId] (nothing was ever picked) is likewise
/// never stale — there's nothing to clear.
///
/// This is a convenience UX check only, exactly like
/// `resolvePosRegisterScope` itself — the backend independently
/// re-validates register scope on every request regardless of what the
/// Flutter-side `SaleSession.cashRegisterId` currently holds. The one real
/// caller (`_PosShellState.didUpdateWidget` in `pos_shell.dart`) clears the
/// stale selection via `SaleSession.setCashRegister(null)`, letting the
/// normal auto-select/switcher/empty-state resolution re-run from scratch,
/// exactly as if the cashier had never picked one.
bool isStaleSelectedRegister({
  required String? selectedRegisterId,
  required List<String>? permittedRegisterIds,
}) {
  if (selectedRegisterId == null) return false;
  if (permittedRegisterIds == null) return false;
  return !permittedRegisterIds.contains(selectedRegisterId);
}
