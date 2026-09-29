/// TASK 15.1 (Phase 2) — "Users / Roles / Permissions admin"
/// (`docs/RC_RELEASE_INVENTORY.md`'s TENANT section, "Users / Roles /
/// Permissions admin" row, verdict YELLOW): before this file, `pos_shell.
/// dart`'s `_Users` widget was **read-only** and there was no Flutter
/// caller anywhere for role creation, role permission assignment, user
/// creation, membership activation, role assignment, or branch access —
/// every real environment had to be provisioned via direct API/SQL calls.
/// This is the real, standalone screen that closes that gap: a park owner
/// can now manage staff access — who can log in, what they can do, and
/// where — without the CLI/API/SQL, entirely through real calls to the
/// already-real, already-tested, already-permission-guarded backend
/// (`apps/api/src/modules/admin/identity/identity.routes.ts`,
/// `AdministrationService` in `apps/api/src/modules/admin/shared/
/// admin.service.ts`).
///
/// DESIGN DECISIONS (see this task's own report-back requirements):
///  - Structural template: `pos_people_screen.dart` — a single top-level
///    `SegmentedButton`-tabbed screen (this codebase's own real tabbed-
///    screen convention; there is no `TabBar`/`TabBarView` usage anywhere
///    in `apps/one/lib/features/pos` — confirmed by grep), NOT a generic
///    Flutter `TabBar` tutorial pattern. Every private helper widget below
///    (`_Card`/`_Loading`/`_Empty`/`_Failure`/`_PermissionDenied`/
///    `_StatusPill`/`_DialogButtons`/etc.) is a small, file-private
///    redeclaration of the equivalent shapes in `pos_people_screen.dart`
///    (itself a redeclaration of `pos_shell.dart`'s own private shapes,
///    per that file's own doc comment) — those stay private to their own
///    files, so redeclaring a handful of tiny stateless widgets here keeps
///    the visual language identical without touching any barred file.
///  - Gateway: `pos_identity_admin_gateway.dart`, a NEW file — see its own
///    doc comment for why this is not folded into `pos_read_gateway.dart`
///    (whose read-only `PosReadGateway.users()`/`PosUser` this screen
///    reuses unmodified) or `pos_people_gateway.dart` (a different domain).
///  - Permission gating: mirrors `pos_people_screen.dart`'s own convention
///    exactly — a whole tab hides behind `_PermissionDenied` when the
///    actor lacks that tab's `*.read` permission (`user.read`/`role.read`/
///    `permission.read`), while every individual MUTATING control
///    (create/edit/activate/assign/revoke/grant) stays visible but
///    disabled, wrapped in a `Tooltip` naming the exact missing permission
///    — never hidden, never a looser or stricter rule than the real route
///    guard it mirrors. The server remains the sole authority: every
///    disabled-control decision here only mirrors
///    `widget.context.permissions.contains('...')`, exactly like every
///    other screen in this app (`pos_receipt_branding_screen.dart`'s
///    `_canManage`), and a real 403 from the server is still handled
///    honestly wherever the client-side mirror could be stale (e.g. the
///    role.permission.manage self-escalation guard below is a UX signal
///    ON TOP OF, never a replacement for, the server's own already-proven
///    403 — see `docs/RC_SECURITY_CERTIFICATION.md`'s privilege-escalation
///    probe, which this screen's own escalation guard is designed to
///    never contradict or weaken).
///  - Self-escalation guard (`_PermissionPicker`): when assigning
///    permissions to a role, a checkbox for a permission the ACTING
///    session itself does not hold is disabled with an explanatory
///    `Tooltip` — an actor can still freely UNCHECK an already-granted
///    permission it doesn't itself hold (a restriction, not an
///    escalation), but can never CHECK one it doesn't hold. This is a
///    genuine, honest UI signal — never the sole enforcement; the real
///    403 (`role.permission.manage` failing server-side for a
///    minimally-permissioned actor attempting exactly this) remains the
///    actual gate, and this screen surfaces that 403's message verbatim
///    if it is somehow ever reached anyway (stale client permission
///    cache, a second concurrent session, etc.).
///  - Branch scope: `roles` themselves are COMPANY-scoped only (no
///    `branch_id` column — `packages/database/src/schema/identity.ts:
///    119-139`); only a role ASSIGNMENT to a user optionally carries a
///    `branch_id` (`user_roles.branch_id`, nullable — `null` means
///    company-wide). The Roles tab therefore has no branch-scope control
///    on the role entity itself (there is nothing to scope), matching
///    "read the schema — don't invent a scope model." Branch pickers here
///    (role-assignment branch, branch-access grant) are built from the
///    acting admin's own already-loaded `AuthenticatedContext.branches` —
///    this screen calls no separate branch-listing endpoint (out of this
///    task's endpoint list; see `pos_identity_admin_gateway.dart`'s own
///    doc comment), mirroring `pos_receipt_branding_screen.dart` and other
///    screens' own established precedent for branch pickers.
library;

import 'dart:async';

import 'package:flutter/foundation.dart' show setEquals;
import 'package:flutter/material.dart';

import '../../core/networking/api_client.dart';
import '../authentication/auth_models.dart';
import 'pos_cash_gateway.dart';
import 'pos_identity_admin_gateway.dart';
import 'pos_operational_areas_gateway.dart';
import 'pos_permission_presentation.dart';
import 'pos_tokens.dart';

/// The public entry point. Constructed with the real
/// [AuthenticatedContext] and a real [PosIdentityAdminGateway] — a fully
/// standalone, self-contained widget (mirrors `pos_people_screen.dart`'s
/// own `PosPeopleScreen`): no import of, or edit to, `pos_shell.dart` or
/// `pos_navigation.dart` is required for this screen to exist, build, or
/// be tested in isolation. Wiring it into the app's navigation is a
/// separate, later step outside this file's scope.
class PosUserAdministrationScreen extends StatefulWidget {
  const PosUserAdministrationScreen({
    required this.context,
    required this.gateway,
    // TASK 16.15: optional, additive — every pre-existing call site of
    // this screen keeps working unmodified with the `Empty...` defaults
    // (no register/area-scoped access grant UI, exactly like before this
    // task). Only used to populate the "Otorgar acceso a caja/área"
    // dialog's own area/register pickers — see `_GrantRegisterAccessDialog`.
    this.areasGateway = const EmptyPosOperationalAreasGateway(),
    this.cashGateway = const EmptyPosCashGateway(),
    // TASK 16.31 — optional, additive (same convention as above): only
    // "Sesión actual" → "Cerrar sesión" uses this; every pre-existing
    // call site (including every test) keeps working unmodified against
    // a safe no-op default. `pos_shell.dart`'s real call site passes the
    // exact same real logout callback the topbar account menu uses.
    this.onLogout,
    super.key,
  });

  final AuthenticatedContext context;
  final PosIdentityAdminGateway gateway;
  final PosOperationalAreasGateway areasGateway;
  final PosCashGateway cashGateway;
  final VoidCallback? onLogout;

  @override
  State<PosUserAdministrationScreen> createState() => _PosUserAdministrationScreenState();
}

// TASK 16.31 — `roles`/`permisos` merge into one "Roles y permisos"
// master/detail tab (Phase 4/9); `sesion` is new (Phase 13). The
// underlying `identifier` string is what `_AdminHeader`'s own
// `SegmentedButton` shows and what widget tests navigate by
// (`tester.tap(find.text(tab.label))`, mirroring this file's own
// pre-existing `tab: 'Roles'`-style test convention).
enum _AdminTab {
  usuarios('Usuarios'),
  rolesPermisos('Roles y permisos'),
  sesion('Sesión actual');

  const _AdminTab(this.label);
  final String label;
}

class _PosUserAdministrationScreenState extends State<PosUserAdministrationScreen> {
  _AdminTab _tab = _AdminTab.usuarios;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      _AdminHeader(tab: _tab, onTabChanged: (value) => setState(() => _tab = value)),
      switch (_tab) {
        _AdminTab.usuarios => _UsersTab(
          context: widget.context,
          gateway: widget.gateway,
          areasGateway: widget.areasGateway,
          cashGateway: widget.cashGateway,
        ),
        _AdminTab.rolesPermisos => _RolesTab(context: widget.context, gateway: widget.gateway),
        _AdminTab.sesion => _SessionTab(
          context: widget.context,
          gateway: widget.gateway,
          onLogout: widget.onLogout,
        ),
      },
    ],
  );
}

class _AdminHeader extends StatelessWidget {
  const _AdminHeader({required this.tab, required this.onTabChanged});
  final _AdminTab tab;
  final ValueChanged<_AdminTab> onTabChanged;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Wrap(
        crossAxisAlignment: WrapCrossAlignment.start,
        runSpacing: 10,
        children: [
          SizedBox(
            width: 420,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Usuarios y roles', style: TextStyle(color: palette.text, fontSize: 22, fontWeight: FontWeight.w800)),
                const SizedBox(height: 4),
                Text(
                  'Usuarios, roles y permisos — datos reales del backend.',
                  style: TextStyle(color: palette.textSecondary, fontSize: 12),
                ),
              ],
            ),
          ),
          SegmentedButton<_AdminTab>(
            key: const Key('pos-user-admin-tabs'),
            segments: [for (final value in _AdminTab.values) ButtonSegment(value: value, label: Text(value.label))],
            selected: {tab},
            onSelectionChanged: (value) => onTabChanged(value.first),
          ),
        ],
      ),
    );
  }
}

/// TASK 16.31 (Phase 3) — a compact KPI tile shared by the Usuarios
/// strip. [value] is a pre-formatted string so a caller can show a
/// small loading indicator in its place while real data is still
/// resolving — this widget never renders a placeholder `0` for data
/// that hasn't loaded yet.
class _AdminMetricCard extends StatelessWidget {
  const _AdminMetricCard({required this.label, required this.value, required this.icon});
  final String label;
  final Widget value;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return _Card(
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(color: palette.actionTint, borderRadius: BorderRadius.circular(10)),
            child: Icon(icon, size: 18, color: palette.blueDeep),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                DefaultTextStyle(
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 18),
                  child: value,
                ),
                Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: palette.textMuted, fontSize: 11, fontWeight: FontWeight.w600),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------
// Shared, file-private widgets/helpers — small redeclarations of
// `pos_people_screen.dart`'s own private shapes (see this file's own top
// doc comment for why).
// ---------------------------------------------------------------------

enum _ListPhase { loading, empty, ready, failure }

class _Card extends StatelessWidget {
  const _Card({required this.child, this.padding = const EdgeInsets.all(14), super.key});
  final Widget child;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        color: palette.surface,
        border: Border.all(color: palette.border),
        borderRadius: BorderRadius.circular(12),
        boxShadow: [BoxShadow(color: palette.text.withValues(alpha: .06), blurRadius: 8, offset: const Offset(0, 2))],
      ),
      child: child,
    );
  }
}

class _StateBlock extends StatelessWidget {
  const _StateBlock({required this.icon, required this.title, required this.message, this.action});
  final IconData icon;
  final String title;
  final String message;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return _Card(
      child: SizedBox(
        height: 160,
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 34, color: palette.blueDeep),
              const SizedBox(height: 10),
              Text(title, style: TextStyle(color: palette.text, fontWeight: FontWeight.w800)),
              const SizedBox(height: 5),
              Text(message, textAlign: TextAlign.center, style: TextStyle(color: palette.textSecondary)),
              if (action != null) ...[const SizedBox(height: 8), action!],
            ],
          ),
        ),
      ),
    );
  }
}

class _Loading extends StatelessWidget {
  const _Loading();
  @override
  Widget build(BuildContext context) =>
      const _Card(child: SizedBox(height: 160, child: Center(child: CircularProgressIndicator())));
}

class _Empty extends StatelessWidget {
  const _Empty({required this.message});
  final String message;
  @override
  Widget build(BuildContext context) => _StateBlock(icon: Icons.inbox_outlined, title: 'Sin información', message: message);
}

class _PermissionDenied extends StatelessWidget {
  const _PermissionDenied({required this.permission});
  final String permission;
  @override
  Widget build(BuildContext context) => _StateBlock(
    icon: Icons.lock_outline,
    title: 'Acceso no autorizado',
    message: 'Tu sesión no incluye el permiso $permission.',
  );
}

class _Failure extends StatelessWidget {
  const _Failure({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) => _StateBlock(
    icon: Icons.error_outline,
    title: 'No fue posible cargar',
    message: message,
    action: TextButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: const Text('Reintentar')),
  );
}

// TASK 16.31 (Phase 3) — the real, raw status shared by
// `membershipStatus`/`identityStatus` (users), role-assignment/branch-
// access/register-grant `status`, and `PosRole.status`. Display only —
// the color-positivity check below still keys off the ORIGINAL raw
// value. An unrecognized value still renders (never hidden), just
// untranslated.
String _statusPillLabel(String raw) => switch (raw) {
  'active' => 'Activo',
  'inactive' => 'Inactivo',
  'retired' => 'Retirado',
  'pending' => 'Pendiente',
  'invited' => 'Invitado',
  'suspended' => 'Suspendido',
  'disabled' => 'Deshabilitado',
  'revoked' => 'Revocado',
  _ => raw,
};

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final positive = label == 'active';
    final color = positive ? palette.success : palette.warning;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: color.withValues(alpha: .12), borderRadius: BorderRadius.circular(20)),
      child: Text(_statusPillLabel(label), style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.w800)),
    );
  }
}

/// TASK 16.31 (Phase 3/8) — a small, dense label/value row, matching
/// `pos_people_screen.dart`'s own `_DetailRow` shape exactly (this
/// file's own header doc comment already establishes the convention of
/// small, file-private redeclarations rather than a shared import).
class _DetailRow extends StatelessWidget {
  const _DetailRow({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 100, child: Text(label, style: TextStyle(color: palette.textMuted, fontSize: 11))),
          Expanded(child: Text(value, style: TextStyle(color: palette.text, fontSize: 12, fontWeight: FontWeight.w600))),
        ],
      ),
    );
  }
}

class _DialogButtons extends StatelessWidget {
  const _DialogButtons({
    required this.busy,
    required this.onCancel,
    required this.onSave,
    this.saveKey,
    this.saveEnabled = true,
    this.disabledTooltip = '',
  });
  final bool busy;
  final VoidCallback onCancel;
  final VoidCallback onSave;
  final Key? saveKey;
  final bool saveEnabled;
  final String disabledTooltip;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Row(
      children: [
        Expanded(
          child: OutlinedButton(
            onPressed: onCancel,
            style: OutlinedButton.styleFrom(foregroundColor: palette.textSecondary, side: BorderSide(color: palette.border)),
            child: const Text('Cancelar'),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Tooltip(
            message: saveEnabled ? '' : disabledTooltip,
            child: FilledButton(
              key: saveKey,
              onPressed: busy || !saveEnabled ? null : onSave,
              style: FilledButton.styleFrom(backgroundColor: palette.action),
              child: busy
                  ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Text('Guardar'),
            ),
          ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------
// Usuarios — gated by `user.read`; mutations by `user.create`/
// `user.update`/`role.assign`/`branch_access.manage` individually.
// ---------------------------------------------------------------------

class _UsersTab extends StatefulWidget {
  const _UsersTab({
    required this.context,
    required this.gateway,
    this.areasGateway = const EmptyPosOperationalAreasGateway(),
    this.cashGateway = const EmptyPosCashGateway(),
  });
  final AuthenticatedContext context;
  final PosIdentityAdminGateway gateway;
  final PosOperationalAreasGateway areasGateway;
  final PosCashGateway cashGateway;

  @override
  State<_UsersTab> createState() => _UsersTabState();
}

class _UsersTabState extends State<_UsersTab> {
  _ListPhase _phase = _ListPhase.loading;
  List<PosUser> _items = const [];
  List<PosRole> _roles = const [];
  String? _errorMessage;
  String _query = '';
  String? _roleFilter;

  // TASK 16.31 (Phase 7) — `PosUser`/`listUsers()` carry no role/branch/
  // permission-count field at all (confirmed against the real backend —
  // see docs/USERS_EMPLOYEES_UX.md's own architecture-audit section).
  // Enriching the grid with that data therefore means one additional
  // `userDetail(id)` call per VISIBLE user, fired in parallel right after
  // the base list resolves — the exact same "join after the base fetch"
  // convention already established by Nómina's employee-name join (TASK
  // 16.29). Bounded to one page's worth of users (this screen has no
  // pagination today), never a per-role reverse aggregate (that WOULD be
  // a real N+1 over every user just to render a handful of role rows —
  // deliberately not done, matching `_RoleRow`'s own pre-existing,
  // documented decision not to compute a user-count there).
  final Map<String, PosUserDetail> _details = {};
  final Map<String, Set<String>> _rolePermissionIds = {};
  bool _enrichmentLoading = false;

  bool get _canRead => widget.context.permissions.contains('user.read');
  bool get _canCreate => widget.context.permissions.contains('user.create');
  bool get _canUpdate => widget.context.permissions.contains('user.update');
  bool get _canAssignRole => widget.context.permissions.contains('role.assign');
  bool get _canManageBranchAccess => widget.context.permissions.contains('branch_access.manage');

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    if (!_canRead) return;
    setState(() {
      _phase = _ListPhase.loading;
      _errorMessage = null;
    });
    try {
      final items = await widget.gateway.listUsers();
      // Honest fallback — no `role.read` means no role filter/KPIs, never
      // a blocked Usuarios tab (`user.read` alone already got us here).
      List<PosRole> roles = const [];
      try {
        roles = await widget.gateway.listRoles();
      } on Object {
        // Swallowed deliberately — see comment above.
      }
      if (!mounted) return;
      setState(() {
        _items = items;
        _roles = roles;
        _phase = _visibleItems.isEmpty ? _ListPhase.empty : _ListPhase.ready;
      });
      unawaited(_loadEnrichment(items));
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _ListPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _ListPhase.failure;
        _errorMessage = 'No fue posible cargar los usuarios.';
      });
    }
  }

  Future<void> _loadEnrichment(List<PosUser> items) async {
    setState(() => _enrichmentLoading = true);
    final results = await Future.wait([
      for (final user in items)
        widget.gateway
            .userDetail(user.id)
            .then<PosUserDetail?>((detail) => detail)
            .catchError((Object _) => null),
    ]);
    if (!mounted) return;
    setState(() {
      for (var i = 0; i < items.length; i++) {
        final detail = results[i];
        if (detail != null) _details[items[i].id] = detail;
      }
      _enrichmentLoading = false;
    });
    unawaited(_loadRolePermissionCounts());
  }

  /// TASK 16.31 (Phase 7) — a real, derived "permission count" per user:
  /// the union of every ACTIVE role assignment's own granted permission
  /// ids. Cost is bounded by the number of DISTINCT roles actually
  /// assigned across the loaded users (typically a handful), cached here
  /// so the same role is never re-fetched for a second user who shares
  /// it.
  Future<void> _loadRolePermissionCounts() async {
    final roleIds =
        {
          for (final detail in _details.values)
            for (final assignment in detail.roles)
              if (assignment.status == 'active') assignment.roleId,
        }..removeWhere(_rolePermissionIds.containsKey);
    for (final roleId in roleIds) {
      try {
        final assignments = await widget.gateway.rolePermissions(roleId);
        if (!mounted) return;
        setState(() {
          _rolePermissionIds[roleId] = assignments
              .where((assignment) => assignment.effect == 'allow')
              .map((assignment) => assignment.permissionId)
              .toSet();
        });
      } on Object {
        // Leave this role's contribution uncounted rather than crash the
        // whole grid over one role's transient failure.
      }
    }
  }

  /// `null` = still resolving (a role's own permission set hasn't loaded
  /// yet) — the card shows a small loading affordance instead of a
  /// number, never a fabricated `0`.
  int? _permissionCountFor(PosUserDetail detail) {
    final activeRoleIds = detail.roles.where((r) => r.status == 'active').map((r) => r.roleId).toSet();
    if (activeRoleIds.isEmpty) return 0;
    if (!activeRoleIds.every(_rolePermissionIds.containsKey)) return null;
    final ids = <String>{};
    for (final roleId in activeRoleIds) {
      ids.addAll(_rolePermissionIds[roleId]!);
    }
    return ids.length;
  }

  List<PosUser> get _visibleItems {
    final query = _query.trim().toLowerCase();
    return _items.where((user) {
      if (query.isNotEmpty) {
        final matchesBase = user.displayName.toLowerCase().contains(query) || user.email.toLowerCase().contains(query);
        final matchesRole = _details[user.id]?.roles.any((r) => r.roleName.toLowerCase().contains(query)) ?? false;
        if (!matchesBase && !matchesRole) return false;
      }
      final roleFilter = _roleFilter;
      if (roleFilter != null) {
        final hasRole = _details[user.id]?.roles.any((r) => r.status == 'active' && r.roleId == roleFilter) ?? false;
        if (!hasRole) return false;
      }
      return true;
    }).toList(growable: false);
  }

  void _refilter() => setState(() {
    if (_items.isNotEmpty) {
      _phase = _visibleItems.isEmpty ? _ListPhase.empty : _ListPhase.ready;
    }
  });

  Future<void> _openNewForm() async {
    if (!_canCreate) return;
    final outcome = await showDialog<_UserFormOutcome>(
      context: context,
      builder: (dialogContext) => _UserFormDialog(
        gateway: widget.gateway,
        branches: widget.context.branches,
        roles: _roles,
        canAssignRole: _canAssignRole,
        canManageBranchAccess: _canManageBranchAccess,
      ),
    );
    if (outcome == null) return;
    unawaited(_load());
    // The user itself was created either way — a partial/failed branch
    // setup is never reported as if creation failed, only as "some
    // branches need attention".
    if (!outcome.hasIssues) return;
    if (!mounted) return;
    final reviewRequested = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _BranchSetupSummaryDialog(results: outcome.branchResults),
    );
    if (reviewRequested == true) unawaited(_openDetail(outcome.user));
  }

  Future<void> _openDetail(PosUser user) async {
    final changed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _UserDetailDialog(
        user: user,
        gateway: widget.gateway,
        areasGateway: widget.areasGateway,
        cashGateway: widget.cashGateway,
        adminContext: widget.context,
        canUpdate: _canUpdate,
        canAssignRole: _canAssignRole,
        canManageBranchAccess: _canManageBranchAccess,
      ),
    );
    if (changed == true) unawaited(_load());
  }

  Widget _metricValue(Key key, String value) => Text(value, key: key);
  Widget _metricLoading(Key key) => SizedBox(
    key: key,
    width: 16,
    height: 16,
    child: const CircularProgressIndicator(strokeWidth: 2),
  );

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    if (!_canRead) return const _PermissionDenied(permission: 'user.read');
    final newDisabledReason = _canCreate ? '' : 'Se requiere el permiso user.create.';
    final rolesInUse = <String>{
      for (final detail in _details.values)
        for (final assignment in detail.roles)
          if (assignment.status == 'active') assignment.roleId,
    };
    // `!_enrichmentLoading` alone — never additionally require
    // `_details.length == _items.length`: a real per-user enrichment
    // failure (an honest, caught, non-fatal case — see `_loadEnrichment`)
    // must still let the KPI strip settle on whatever DID resolve,
    // rather than spin forever waiting for a completion that will never
    // come.
    final enrichmentReady = !_enrichmentLoading;
    final withoutRole = _details.values.where((d) => !d.roles.any((r) => r.status == 'active')).length;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // TASK 16.31 (Phase 5) — every tile is real data. "Con sesión
        // hoy" from the old reference is deliberately NOT here: the
        // backend's `users.last_login_at` column is never written or
        // read anywhere (confirmed dead — see docs/USERS_EMPLOYEES_UX.
        // md), so faking that metric was never an option. "Roles en
        // uso"/"Sin rol" are real, honestly-derived replacements.
        LayoutBuilder(
          builder: (context, constraints) {
            final columns = constraints.maxWidth >= 820 ? 4 : (constraints.maxWidth >= 560 ? 2 : 1);
            return GridView.count(
              key: const Key('pos-users-kpi-strip'),
              crossAxisCount: columns,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              crossAxisSpacing: 10,
              mainAxisSpacing: 10,
              childAspectRatio: 2.6,
              children: [
                _AdminMetricCard(
                  label: 'Usuarios totales',
                  icon: Icons.people_alt_outlined,
                  value: _metricValue(const Key('pos-users-kpi-total'), '${_items.length}'),
                ),
                _AdminMetricCard(
                  label: 'Activos',
                  icon: Icons.check_circle_outline,
                  value: _metricValue(
                    const Key('pos-users-kpi-active'),
                    '${_items.where((u) => u.membershipStatus == 'active').length}',
                  ),
                ),
                _AdminMetricCard(
                  label: 'Roles en uso',
                  icon: Icons.badge_outlined,
                  value: enrichmentReady
                      ? _metricValue(const Key('pos-users-kpi-roles-in-use'), '${rolesInUse.length}')
                      : _metricLoading(const Key('pos-users-kpi-roles-in-use')),
                ),
                _AdminMetricCard(
                  label: 'Sin rol asignado',
                  icon: Icons.person_off_outlined,
                  value: enrichmentReady
                      ? _metricValue(const Key('pos-users-kpi-without-role'), '$withoutRole')
                      : _metricLoading(const Key('pos-users-kpi-without-role')),
                ),
              ],
            );
          },
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 10,
          runSpacing: 10,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            SizedBox(
              width: 280,
              child: TextField(
                key: const Key('pos-users-search'),
                onChanged: (value) {
                  _query = value;
                  _refilter();
                },
                decoration: const InputDecoration(isDense: true, hintText: 'Buscar por nombre, correo o rol', prefixIcon: Icon(Icons.search)),
              ),
            ),
            if (_roles.isNotEmpty)
              SizedBox(
                width: 200,
                child: DropdownButtonFormField<String?>(
                  key: const Key('pos-users-role-filter'),
                  initialValue: _roleFilter,
                  isExpanded: true,
                  decoration: const InputDecoration(isDense: true, labelText: 'Rol'),
                  items: [
                    const DropdownMenuItem(value: null, child: Text('Todos los roles')),
                    for (final role in _roles) DropdownMenuItem(value: role.id, child: Text(role.name)),
                  ],
                  onChanged: (value) {
                    _roleFilter = value;
                    _refilter();
                  },
                ),
              ),
            Tooltip(
              message: newDisabledReason,
              child: FilledButton.icon(
                key: const Key('pos-users-new'),
                onPressed: newDisabledReason.isEmpty ? () => unawaited(_openNewForm()) : null,
                style: FilledButton.styleFrom(backgroundColor: palette.action),
                icon: const Icon(Icons.person_add_alt_outlined, size: 16),
                label: const Text('Nuevo usuario'),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        switch (_phase) {
          _ListPhase.loading => const _Loading(),
          _ListPhase.empty => const _Empty(message: 'No hay usuarios para mostrar.'),
          _ListPhase.failure => _Failure(
            message: _errorMessage ?? 'No fue posible cargar los usuarios.',
            onRetry: () => unawaited(_load()),
          ),
          _ListPhase.ready => LayoutBuilder(
            builder: (context, constraints) {
              final columns = constraints.maxWidth >= 980
                  ? 3
                  : constraints.maxWidth >= 620
                  ? 2
                  : 1;
              return GridView.count(
                key: const Key('pos-users-grid'),
                crossAxisCount: columns,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                crossAxisSpacing: 12,
                mainAxisSpacing: 12,
                // TASK 16.31.3 (Phase 13) — shorter cards: the real
                // content (avatar row + one chip row) never needed the
                // taller box the old ratio reserved, which is exactly
                // the "large empty lower portion" the reference
                // screenshot showed.
                childAspectRatio: columns == 1 ? 3.4 : 2.6,
                children: [
                  for (final user in _visibleItems)
                    _UserCard(
                      key: Key('pos-user-row-${user.id}'),
                      user: user,
                      detail: _details[user.id],
                      branches: widget.context.branches,
                      permissionCount: _details[user.id] == null ? null : _permissionCountFor(_details[user.id]!),
                      onTap: () => unawaited(_openDetail(user)),
                    ),
                ],
              );
            },
          ),
        },
      ],
    );
  }
}

/// TASK 16.31 (Phase 7) — the Usuarios card. Every field shown comes from
/// the real `PosUser`, or from the real `PosUserDetail` enrichment once
/// it resolves (role/branch scope/permission count) — never a fabricated
/// job title (that would require an Employees-gateway cross-reference
/// this screen deliberately does not take on, see
/// docs/USERS_EMPLOYEES_UX.md) and never a raw UUID as primary text.
class _UserCard extends StatelessWidget {
  const _UserCard({
    required this.user,
    required this.detail,
    required this.branches,
    required this.permissionCount,
    required this.onTap,
    super.key,
  });
  final PosUser user;
  final PosUserDetail? detail;
  final List<BranchSummary> branches;
  final int? permissionCount;
  final VoidCallback onTap;

  String get _initials {
    final parts = user.displayName.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    final first = parts.first.characters.first;
    final last = parts.length > 1 ? parts.last.characters.first : '';
    return (first + last).toUpperCase();
  }

  String? get _roleName {
    final active = detail?.roles.where((r) => r.status == 'active');
    if (active == null || active.isEmpty) return null;
    return active.map((r) => r.roleName).join(', ');
  }

  String get _branchScope {
    final active = detail?.roles.where((r) => r.status == 'active') ?? const [];
    if (active.any((r) => r.branchId == null)) return 'Todas las sucursales';
    final branchAccess = detail?.branchAccess.where((b) => b.status == 'active') ?? const [];
    if (branchAccess.isEmpty) return 'Sin sucursal asignada';
    final names = branchAccess
        .map((access) => branches.where((b) => b.id == access.branchId).firstOrNull?.name ?? access.branchId)
        .toList(growable: false);
    return names.join(', ');
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return _Card(
      padding: EdgeInsets.zero,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  CircleAvatar(
                    radius: 18,
                    backgroundColor: palette.actionTint,
                    child: Text(_initials, style: TextStyle(color: palette.blueDeep, fontWeight: FontWeight.w800, fontSize: 13)),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          user.displayName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13.5),
                        ),
                        Text(
                          user.email,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(color: palette.textSecondary, fontSize: 11),
                        ),
                      ],
                    ),
                  ),
                  _StatusPill(label: user.membershipStatus),
                ],
              ),
              const SizedBox(height: 10),
              Wrap(
                spacing: 10,
                runSpacing: 6,
                children: [
                  _CardMetaChip(
                    icon: Icons.badge_outlined,
                    key: const Key('pos-user-card-role'),
                    label: _roleName ?? (detail == null ? 'Cargando…' : 'Sin rol'),
                  ),
                  _CardMetaChip(icon: Icons.store_outlined, label: detail == null ? 'Cargando…' : _branchScope),
                  _CardMetaChip(
                    icon: Icons.key_outlined,
                    key: const Key('pos-user-card-permission-count'),
                    label: permissionCount == null ? 'Permisos…' : '$permissionCount permisos',
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CardMetaChip extends StatelessWidget {
  const _CardMetaChip({required this.icon, required this.label, super.key});
  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 13, color: palette.textMuted),
        const SizedBox(width: 3),
        ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 150),
          child: Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(color: palette.textMuted, fontSize: 11),
          ),
        ),
      ],
    );
  }
}

/// New-user dialog — only ever reachable through an already-`user.create`-
/// gated entry point, mirrors `_EmployeeFormDialog`'s own convention of
/// carrying no separate internal permission gate.
// TASK 17.3.2 — createUser()/assignRole()/changeBranchAccess() are three
// separate backend requests, not one transaction: a failure partway
// through the per-branch loop below must never look like total success,
// and must never silently stop at the first failed branch (every
// SELECTED branch is always attempted, independently). The backend stays
// the sole source of truth for every authorization rule (company/branch
// scope, role validity, system-role protection, self-escalation,
// duplicate-assignment idempotency) — this only orchestrates the calls
// it already made one at a time and reports what actually happened.
enum _BranchSetupOutcome { success, partial, failed }

class _BranchSetupResult {
  const _BranchSetupResult({required this.branchName, required this.outcome, this.detail});
  final String branchName;
  final _BranchSetupOutcome outcome;
  final String? detail;
}

/// The user is a real, already-created fact by the time this exists —
/// `branchResults` only ever reports what happened AFTER creation, never
/// whether creation itself succeeded (a failed creation never reaches
/// this point at all — see `_UserFormDialogState._submit`).
class _UserFormOutcome {
  const _UserFormOutcome({required this.user, this.branchResults = const []});
  final PosUser user;
  final List<_BranchSetupResult> branchResults;
  bool get hasIssues => branchResults.any((result) => result.outcome != _BranchSetupOutcome.success);
}

class _UserFormDialog extends StatefulWidget {
  const _UserFormDialog({
    required this.gateway,
    this.branches = const [],
    this.roles = const [],
    this.canAssignRole = false,
    this.canManageBranchAccess = false,
  });
  final PosIdentityAdminGateway gateway;
  final List<BranchSummary> branches;
  final List<PosRole> roles;
  final bool canAssignRole;
  final bool canManageBranchAccess;

  @override
  State<_UserFormDialog> createState() => _UserFormDialogState();
}

class _UserFormDialogState extends State<_UserFormDialog> {
  final _emailController = TextEditingController();
  final _nameController = TextEditingController();
  bool _busy = false;
  String? _error;

  // TASK 17.3 — "Acceso" section: role + branches selected up front, so
  // creating a user doesn't force an admin to immediately re-open the
  // fresh user's own detail dialog just to make the account usable. Every
  // call this makes on submit is one of the SAME two already-existing,
  // already-correct endpoints `_AssignRoleDialog`/`_GrantBranchAccessDialog`
  // already use one at a time — this only sequences them, never a new
  // authorization model. `null` role / empty branches means "skip", which
  // reproduces today's exact create-only behavior unchanged.
  String? _selectedRoleId;
  bool _allBranches = false;
  final Set<String> _selectedBranchIds = {};

  List<PosRole> get _activeRoles => widget.roles.where((role) => role.status == 'active').toList(growable: false);

  bool get _showRoleSection => widget.canAssignRole && _activeRoles.isNotEmpty;
  bool get _showBranchSection => widget.canManageBranchAccess && widget.branches.isNotEmpty && _selectedRoleId != null;

  @override
  void dispose() {
    _emailController.dispose();
    _nameController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final email = _emailController.text.trim();
    final name = _nameController.text.trim();
    if (email.isEmpty) {
      setState(() => _error = 'El correo es obligatorio.');
      return;
    }
    if (name.isEmpty) {
      setState(() => _error = 'El nombre es obligatorio.');
      return;
    }
    final roleId = _selectedRoleId;
    if (_showBranchSection && !_allBranches && _selectedBranchIds.isEmpty) {
      setState(() => _error = 'Selecciona al menos una sucursal o "Todas las sucursales".');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final PosUser created;
    try {
      created = await widget.gateway.createUser(email: email, displayName: name);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.failure.message;
      });
      return;
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible crear el usuario.';
      });
      return;
    }
    final results = <_BranchSetupResult>[];
    if (roleId != null) {
      if (_allBranches || !widget.canManageBranchAccess || widget.branches.isEmpty) {
        // Company-wide (branch_id: null) is a single grant — there is no
        // per-branch access call to split it into (a company-wide role
        // already bypasses the branch-access check entirely — see
        // `docs/MULTI_BRANCH_AUTHORIZATION.md` §4).
        try {
          await widget.gateway.assignRole(created.id, roleId: roleId, branchId: null);
          results.add(const _BranchSetupResult(branchName: 'Todas las sucursales', outcome: _BranchSetupOutcome.success));
        } on ApiException catch (error) {
          results.add(
            _BranchSetupResult(branchName: 'Todas las sucursales', outcome: _BranchSetupOutcome.failed, detail: error.failure.message),
          );
        } on Object {
          results.add(
            const _BranchSetupResult(
              branchName: 'Todas las sucursales',
              outcome: _BranchSetupOutcome.failed,
              detail: 'No fue posible asignar el rol.',
            ),
          );
        }
      } else {
        // Every selected branch is attempted independently — a failure on
        // one branch must never stop the rest from being attempted, and
        // must never be reported as if the whole operation succeeded.
        for (final branchId in _selectedBranchIds) {
          final branchName = widget.branches.where((branch) => branch.id == branchId).firstOrNull?.name ?? branchId;
          bool roleAssigned;
          String? roleError;
          try {
            await widget.gateway.assignRole(created.id, roleId: roleId, branchId: branchId);
            roleAssigned = true;
          } on ApiException catch (error) {
            roleAssigned = false;
            roleError = error.failure.message;
          } on Object {
            roleAssigned = false;
            roleError = 'No fue posible asignar el rol.';
          }
          if (!roleAssigned) {
            results.add(_BranchSetupResult(branchName: branchName, outcome: _BranchSetupOutcome.failed, detail: roleError));
            continue;
          }
          // The default branch goes to the first branch that actually
          // finishes configured — not merely the first attempted — so an
          // earlier failure never leaves the user without any default.
          final isDefault = !results.any((result) => result.outcome == _BranchSetupOutcome.success);
          try {
            await widget.gateway.changeBranchAccess(created.id, branchId, status: 'active', isDefault: isDefault);
            results.add(_BranchSetupResult(branchName: branchName, outcome: _BranchSetupOutcome.success));
          } on ApiException catch (error) {
            // The role WAS assigned — this is a partial outcome, never a
            // plain failure and never a silent success.
            results.add(
              _BranchSetupResult(branchName: branchName, outcome: _BranchSetupOutcome.partial, detail: error.failure.message),
            );
          } on Object {
            results.add(
              _BranchSetupResult(
                branchName: branchName,
                outcome: _BranchSetupOutcome.partial,
                detail: 'No fue posible completar el acceso.',
              ),
            );
          }
        }
      }
    }
    if (!mounted) return;
    Navigator.of(context).pop(_UserFormOutcome(user: created, branchResults: results));
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Nuevo usuario', style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16)),
              const SizedBox(height: 4),
              Text(
                'El usuario se crea invitado. Actívalo desde su ficha para asignarle una contraseña.',
                style: TextStyle(color: palette.textSecondary, fontSize: 11),
              ),
              const SizedBox(height: 14),
              Text('General', style: TextStyle(color: palette.textSecondary, fontWeight: FontWeight.w700, fontSize: 11)),
              const SizedBox(height: 8),
              TextField(
                key: const Key('pos-user-form-email'),
                controller: _emailController,
                keyboardType: TextInputType.emailAddress,
                decoration: const InputDecoration(isDense: true, labelText: 'Correo'),
              ),
              const SizedBox(height: 10),
              TextField(
                key: const Key('pos-user-form-name'),
                controller: _nameController,
                decoration: const InputDecoration(isDense: true, labelText: 'Nombre completo'),
              ),
              if (_showRoleSection) ...[
                const SizedBox(height: 16),
                Text('Acceso', style: TextStyle(color: palette.textSecondary, fontWeight: FontWeight.w700, fontSize: 11)),
                const SizedBox(height: 8),
                DropdownButtonFormField<String?>(
                  key: const Key('pos-user-form-role'),
                  initialValue: _selectedRoleId,
                  isExpanded: true,
                  decoration: const InputDecoration(isDense: true, labelText: 'Rol (opcional)'),
                  items: [
                    const DropdownMenuItem<String?>(value: null, child: Text('Sin rol')),
                    for (final role in _activeRoles) DropdownMenuItem<String?>(value: role.id, child: Text(role.name)),
                  ],
                  onChanged: (value) => setState(() => _selectedRoleId = value),
                ),
                if (_showBranchSection) ...[
                  const SizedBox(height: 10),
                  CheckboxListTile(
                    key: const Key('pos-user-form-all-branches'),
                    value: _allBranches,
                    onChanged: (value) => setState(() => _allBranches = value ?? false),
                    contentPadding: EdgeInsets.zero,
                    controlAffinity: ListTileControlAffinity.leading,
                    title: const Text('Todas las sucursales', style: TextStyle(fontSize: 12)),
                  ),
                  if (!_allBranches)
                    for (final branch in widget.branches)
                      CheckboxListTile(
                        key: Key('pos-user-form-branch-${branch.id}'),
                        value: _selectedBranchIds.contains(branch.id),
                        onChanged: (value) => setState(() {
                          if (value ?? false) {
                            _selectedBranchIds.add(branch.id);
                          } else {
                            _selectedBranchIds.remove(branch.id);
                          }
                        }),
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                        controlAffinity: ListTileControlAffinity.leading,
                        title: Text(branch.name, style: const TextStyle(fontSize: 12)),
                      ),
                ],
              ],
              if (_error != null) ...[
                const SizedBox(height: 10),
                Text(_error!, key: const Key('pos-user-form-error'), style: TextStyle(color: palette.error, fontSize: 12)),
              ],
              const SizedBox(height: 16),
              _DialogButtons(
                busy: _busy,
                onCancel: () => Navigator.of(context).pop(),
                onSave: () => unawaited(_submit()),
                saveKey: const Key('pos-user-form-save'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Shown only when at least one selected branch ended up
/// partial/failed — the user itself was already created successfully by
/// this point, so this is never framed as "the operation failed", only as
/// "some branches need attention". "Revisar usuario" reuses the existing
/// user detail flow — no new administration surface.
class _BranchSetupSummaryDialog extends StatelessWidget {
  const _BranchSetupSummaryDialog({required this.results});
  final List<_BranchSetupResult> results;

  static String _icon(_BranchSetupOutcome outcome) => switch (outcome) {
    _BranchSetupOutcome.success => '✓',
    _BranchSetupOutcome.partial => '⚠',
    _BranchSetupOutcome.failed => '✕',
  };

  static String _label(_BranchSetupOutcome outcome) => switch (outcome) {
    _BranchSetupOutcome.success => 'configurado',
    _BranchSetupOutcome.partial => 'rol asignado; no se pudo completar el acceso',
    _BranchSetupOutcome.failed => 'no se pudo configurar',
  };

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 440),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Usuario creado, pero algunas sucursales requieren atención.',
                key: const Key('pos-user-form-summary-title'),
                style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 15),
              ),
              const SizedBox(height: 14),
              for (final result in results)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(_icon(result.outcome), style: const TextStyle(fontSize: 13)),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              '${result.branchName} — ${_label(result.outcome)}',
                              key: Key('pos-user-form-summary-branch-${result.branchName}'),
                              style: TextStyle(color: palette.text, fontSize: 12, fontWeight: FontWeight.w600),
                            ),
                            if (result.detail != null)
                              Text(result.detail!, style: TextStyle(color: palette.textSecondary, fontSize: 11)),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              const SizedBox(height: 8),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    key: const Key('pos-user-form-summary-close'),
                    onPressed: () => Navigator.of(context).pop(false),
                    child: const Text('Cerrar'),
                  ),
                  const SizedBox(width: 8),
                  FilledButton(
                    key: const Key('pos-user-form-summary-review'),
                    onPressed: () => Navigator.of(context).pop(true),
                    child: const Text('Revisar usuario'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

enum _DetailPhase { loading, ready, failure }

/// The user detail view: account status, role assignments, branch access.
/// Always reachable with `user.read` (the tab itself is already gated on
/// it); every mutating action inside stays its own individually-gated,
/// disabled+`Tooltip`'d control.
class _UserDetailDialog extends StatefulWidget {
  const _UserDetailDialog({
    required this.user,
    required this.gateway,
    this.areasGateway = const EmptyPosOperationalAreasGateway(),
    this.cashGateway = const EmptyPosCashGateway(),
    required this.adminContext,
    required this.canUpdate,
    required this.canAssignRole,
    required this.canManageBranchAccess,
  });

  final PosUser user;
  final PosIdentityAdminGateway gateway;
  final PosOperationalAreasGateway areasGateway;
  final PosCashGateway cashGateway;
  final AuthenticatedContext adminContext;
  final bool canUpdate;
  final bool canAssignRole;
  final bool canManageBranchAccess;

  @override
  State<_UserDetailDialog> createState() => _UserDetailDialogState();
}

class _UserDetailDialogState extends State<_UserDetailDialog> {
  _DetailPhase _phase = _DetailPhase.loading;
  String? _loadError;
  PosUserDetail? _detail;
  bool _changed = false;

  // TASK 16.5 — populated the first time [_openGrantBranchAccess] fetches
  // fresh branches (see that method and [PosIdentityAdminGateway
  // .listGrantableBranches]'s own doc comment). [_branchLabel] prefers
  // this over `widget.adminContext.branches` so a branch access row for a
  // just-granted, brand-new branch resolves to its real name instead of
  // falling back to its raw id — the same staleness this task fixed for
  // the grant dialog itself would otherwise resurface here right after a
  // successful grant.
  List<BranchSummary> _freshBranches = const [];

  // TASK 16.15 — this user's current register/area-scoped access grants,
  // narrowing on top of the branch access above. Loaded alongside
  // `_detail` in [_load] (a separate call: `GET .../register-access` is
  // its own route, not embedded in `userDetail()`'s response).
  List<PosRegisterAccessGrant> _registerAccess = const [];

  // TASK 16.16A — best-effort NAME cache for the register/area access
  // grant rows below, resolved lazily per branch actually referenced by
  // `_registerAccess`, reusing the exact same gateways
  // `_GrantRegisterAccessDialog` already uses for its own dropdowns
  // (`widget.areasGateway`/`widget.cashGateway`) — never a new endpoint.
  // [_registerAccessScopeLabel] falls back to the raw id if a lookup
  // genuinely fails (a deleted area/register, a caller still on the
  // default `Empty...` gateways) — never blocking or breaking this
  // dialog's own load, exactly like [_branchLabel] already does for a
  // branch it cannot resolve.
  final Map<String, PosOperationalArea> _areasById = {};
  final Map<String, PosCashRegister> _registersById = {};
  final Set<String> _registerAccessLookedUpBranchIds = {};

  late String _statusValue = widget.user.membershipStatus == 'invited' ? 'active' : widget.user.membershipStatus;
  final _passwordController = TextEditingController();
  bool _statusBusy = false;
  String? _statusError;

  static const _updateTooltip = 'Se requiere el permiso user.update.';
  static const _assignTooltip = 'Se requiere el permiso role.assign.';
  static const _branchAccessTooltip = 'Se requiere el permiso branch_access.manage.';

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _phase = _DetailPhase.loading;
      _loadError = null;
    });
    try {
      final detail = await widget.gateway.userDetail(widget.user.id);
      // TASK 16.15 — best-effort: an actor without `branch_access.manage`
      // (see `widget.canManageBranchAccess`) gets a real 403 here, which
      // must never fail the whole dialog load — it just means the
      // "Acceso a caja/área" section renders empty/hidden for them,
      // exactly like `_freshBranches` above already does nothing special
      // on failure.
      List<PosRegisterAccessGrant> registerAccess = const [];
      if (widget.canManageBranchAccess) {
        try {
          registerAccess = await widget.gateway.listRegisterAccess(widget.user.id);
        } on Object {
          registerAccess = const [];
        }
      }
      if (!mounted) return;
      setState(() {
        _detail = detail;
        _registerAccess = registerAccess;
        _phase = _DetailPhase.ready;
        _statusValue = detail.user.membershipStatus == 'invited' ? 'active' : detail.user.membershipStatus;
      });
      if (registerAccess.isNotEmpty) {
        unawaited(_loadRegisterAccessNames(registerAccess));
      }
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _DetailPhase.failure;
        _loadError = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _DetailPhase.failure;
        _loadError = 'No fue posible cargar el usuario.';
      });
    }
  }

  bool get _isFirstActivation => _detail?.user.identityStatus == 'pending' && _statusValue == 'active';

  Future<void> _saveStatus() async {
    if (!widget.canUpdate || _statusBusy) return;
    final password = _passwordController.text;
    if (_isFirstActivation && password.isEmpty) {
      setState(() => _statusError = 'Se requiere una contraseña para activar por primera vez.');
      return;
    }
    setState(() {
      _statusBusy = true;
      _statusError = null;
    });
    try {
      await widget.gateway.updateMembership(
        widget.user.id,
        _statusValue,
        password: _isFirstActivation ? password : null,
      );
      _changed = true;
      _passwordController.clear();
      if (!mounted) return;
      await _load();
      if (!mounted) return;
      setState(() => _statusBusy = false);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _statusBusy = false;
        _statusError = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _statusBusy = false;
        _statusError = 'No fue posible actualizar el estado del usuario.';
      });
    }
  }

  Future<void> _openAssignRole() async {
    final assigned = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _AssignRoleDialog(
        userId: widget.user.id,
        gateway: widget.gateway,
        branches: widget.adminContext.branches,
      ),
    );
    if (assigned == true) {
      _changed = true;
      unawaited(_load());
    }
  }

  Future<void> _revokeRole(PosUserRoleAssignment assignment) async {
    if (!widget.canAssignRole) return;
    try {
      await widget.gateway.revokeRoleAssignment(widget.user.id, assignment.id);
      _changed = true;
      unawaited(_load());
    } on ApiException catch (error) {
      if (!mounted) return;
      _showSnack(error.failure.message);
    } on Object {
      if (!mounted) return;
      _showSnack('No fue posible quitar el rol.');
    }
  }

  Future<void> _openGrantBranchAccess() async {
    // TASK 16.5 — fetched fresh here, deliberately NOT
    // `widget.adminContext.branches` (populated only once, at login/token
    // refresh — see `pos_identity_admin_gateway.dart`'s own header doc
    // comment on [PosIdentityAdminGateway.listGrantableBranches] for the
    // real production bootstrap bug this fixes: a brand-new company's
    // first Owner creates their first branch, then finds "Otorgar acceso"
    // shows it as unavailable because the session snapshot predates it).
    List<BranchSummary> branches;
    try {
      branches = await widget.gateway.listGrantableBranches(widget.adminContext.session.companyId);
    } on Object {
      if (!mounted) return;
      _showSnack('No fue posible cargar las sucursales.');
      return;
    }
    if (!mounted) return;
    setState(() => _freshBranches = branches);
    final granted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _GrantBranchAccessDialog(
        userId: widget.user.id,
        gateway: widget.gateway,
        branches: branches,
      ),
    );
    if (granted == true) {
      _changed = true;
      unawaited(_load());
    }
  }

  Future<void> _revokeBranchAccess(PosUserBranchAccess access) async {
    if (!widget.canManageBranchAccess) return;
    try {
      await widget.gateway.revokeBranchAccess(widget.user.id, access.branchId);
      _changed = true;
      unawaited(_load());
    } on ApiException catch (error) {
      if (!mounted) return;
      _showSnack(error.failure.message);
    } on Object {
      if (!mounted) return;
      _showSnack('No fue posible revocar el acceso a la sucursal.');
    }
  }

  // TASK 16.15 — "Otorgar acceso a caja/área": narrows this user's ALREADY-
  // granted branch access (the section immediately above) down to specific
  // register(s)/area(s). Mirrors [_openGrantBranchAccess] exactly, reusing
  // the SAME `branch_access.manage` permission — never a new one.
  Future<void> _openGrantRegisterAccess() async {
    final granted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _GrantRegisterAccessDialog(
        userId: widget.user.id,
        gateway: widget.gateway,
        areasGateway: widget.areasGateway,
        cashGateway: widget.cashGateway,
        branches: widget.adminContext.branches,
      ),
    );
    if (granted == true) {
      _changed = true;
      unawaited(_load());
    }
  }

  Future<void> _revokeRegisterAccess(PosRegisterAccessGrant grant) async {
    if (!widget.canManageBranchAccess) return;
    try {
      await widget.gateway.revokeRegisterAccess(widget.user.id, grant.id);
      _changed = true;
      unawaited(_load());
    } on ApiException catch (error) {
      if (!mounted) return;
      _showSnack(error.failure.message);
    } on Object {
      if (!mounted) return;
      _showSnack('No fue posible revocar el acceso a la caja/área.');
    }
  }

  void _showSnack(String message) {
    ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(message)));
  }

  String _branchLabel(String? branchId) {
    if (branchId == null) return 'Todas las sucursales';
    final match =
        _freshBranches.where((branch) => branch.id == branchId).firstOrNull ??
        widget.adminContext.branches.where((branch) => branch.id == branchId).firstOrNull;
    return match == null ? branchId : '${match.name} (${match.code})';
  }

  // TASK 16.16A — best-effort: fetches every operational area/cash register
  // for each branch actually referenced by [grants], once per branch
  // (`_registerAccessLookedUpBranchIds` de-dupes across repeated `_load()`
  // calls, e.g. after granting/revoking access). Deliberately omits the
  // `status: 'active'` filter `_GrantRegisterAccessDialog` uses for its own
  // picker — a grant can reference an area/register that has since been
  // deactivated, and this only needs to DISPLAY its name, not offer it as
  // a selectable choice. A failure here is silently absorbed: the affected
  // rows just keep showing the raw id via [_registerAccessScopeLabel]'s
  // own fallback, never a blocked or broken dialog.
  Future<void> _loadRegisterAccessNames(List<PosRegisterAccessGrant> grants) async {
    final branchIds = {for (final grant in grants) grant.branchId}
      ..removeWhere(_registerAccessLookedUpBranchIds.contains);
    if (branchIds.isEmpty) return;
    for (final branchId in branchIds) {
      _registerAccessLookedUpBranchIds.add(branchId);
      try {
        final areasPage = await widget.areasGateway.listAreas(branchId: branchId);
        final registers = await widget.cashGateway.registersForBranch(branchId);
        if (!mounted) return;
        setState(() {
          for (final area in areasPage.items) {
            _areasById[area.id] = area;
          }
          for (final register in registers) {
            _registersById[register.id] = register;
          }
        });
      } on Object {
        // Best-effort only — see this method's own doc comment.
      }
    }
  }

  // TASK 16.16A — resolves a register/area access grant's scope to a
  // human name ("área Zona A (ZONA-A)" / "caja Caja 1 (CAJA-1)") instead
  // of the raw UUID this row used to print unconditionally. Falls back to
  // the raw id only when the lookup genuinely can't resolve it (deleted
  // area/register, or a caller still on the default `Empty...` gateways)
  // — never a thrown error, never a blank.
  String _registerAccessScopeLabel(PosRegisterAccessGrant grant) {
    final areaId = grant.operationalAreaId;
    if (areaId != null) {
      final area = _areasById[areaId];
      return area == null ? 'área $areaId' : 'área ${area.name} (${area.code})';
    }
    final registerId = grant.cashRegisterId;
    if (registerId == null) return 'caja no especificada';
    final register = _registersById[registerId];
    return register == null ? 'caja $registerId' : 'caja ${register.name} (${register.code})';
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520, maxHeight: 680),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(widget.user.displayName, style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16)),
                    ),
                    IconButton(
                      key: const Key('pos-user-detail-close'),
                      tooltip: 'Cerrar',
                      onPressed: () => Navigator.of(context).pop(_changed),
                      icon: Icon(Icons.close, color: palette.textMuted, size: 18),
                    ),
                  ],
                ),
                Text(widget.user.email, style: TextStyle(color: palette.textSecondary, fontSize: 12)),
                const SizedBox(height: 14),
                switch (_phase) {
                  _DetailPhase.loading => const Padding(padding: EdgeInsets.symmetric(vertical: 30), child: Center(child: CircularProgressIndicator())),
                  _DetailPhase.failure => Text(_loadError ?? 'No fue posible cargar el usuario.', style: TextStyle(color: palette.error, fontSize: 12)),
                  _DetailPhase.ready => _buildReady(palette),
                },
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildReady(PosPalette palette) {
    final detail = _detail!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Text('Identidad: ', style: TextStyle(color: palette.textMuted, fontSize: 11)),
            _StatusPill(label: detail.user.identityStatus),
            const SizedBox(width: 12),
            Text('Membresía: ', style: TextStyle(color: palette.textMuted, fontSize: 11)),
            _StatusPill(label: detail.user.membershipStatus),
          ],
        ),
        const SizedBox(height: 16),
        Text('Estado de la cuenta', style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13)),
        const SizedBox(height: 8),
        DropdownButtonFormField<String>(
          key: const Key('pos-user-detail-membership-status'),
          initialValue: _statusValue,
          isExpanded: true,
          decoration: const InputDecoration(isDense: true, labelText: 'Estado de membresía'),
          items: const [
            DropdownMenuItem(value: 'active', child: Text('Activo')),
            DropdownMenuItem(value: 'suspended', child: Text('Suspendido')),
            DropdownMenuItem(value: 'disabled', child: Text('Deshabilitado')),
          ],
          onChanged: widget.canUpdate ? (value) => setState(() => _statusValue = value ?? _statusValue) : null,
        ),
        if (_isFirstActivation) ...[
          const SizedBox(height: 10),
          TextField(
            key: const Key('pos-user-detail-password-field'),
            controller: _passwordController,
            obscureText: true,
            enabled: widget.canUpdate,
            decoration: const InputDecoration(isDense: true, labelText: 'Contraseña (requerida en la primera activación)'),
          ),
        ],
        if (_statusError != null) ...[
          const SizedBox(height: 8),
          Text(_statusError!, key: const Key('pos-user-detail-status-error'), style: TextStyle(color: palette.error, fontSize: 12)),
        ],
        const SizedBox(height: 10),
        Align(
          alignment: Alignment.centerRight,
          child: Tooltip(
            message: widget.canUpdate ? '' : _updateTooltip,
            child: FilledButton.icon(
              key: const Key('pos-user-detail-save-status'),
              onPressed: widget.canUpdate && !_statusBusy ? () => unawaited(_saveStatus()) : null,
              style: FilledButton.styleFrom(backgroundColor: palette.action),
              icon: _statusBusy
                  ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.save_outlined, size: 16),
              label: const Text('Guardar estado'),
            ),
          ),
        ),
        const Divider(height: 28),
        Row(
          children: [
            Expanded(child: Text('Roles asignados', style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13))),
            Tooltip(
              message: widget.canAssignRole ? '' : _assignTooltip,
              child: OutlinedButton.icon(
                key: const Key('pos-user-detail-assign-role'),
                onPressed: widget.canAssignRole ? () => unawaited(_openAssignRole()) : null,
                icon: const Icon(Icons.add, size: 14),
                label: const Text('Asignar rol'),
              ),
            ),
          ],
        ),
        const SizedBox(height: 4),
        // TASK 16.16A Phase 7 — same short, muted-caption tone/length as
        // "Acceso a caja/área"'s own existing helper text below, so a
        // first-time administrator understands what a role actually
        // controls without needing to already know the architecture.
        Text(
          'Un rol define qué puede hacer este usuario: el conjunto de permisos activados para él.',
          style: TextStyle(color: palette.textMuted, fontSize: 11),
        ),
        const SizedBox(height: 6),
        if (detail.roles.isEmpty)
          Text('Sin roles asignados.', style: TextStyle(color: palette.textMuted, fontSize: 12))
        else
          for (final assignment in detail.roles)
            Padding(
              key: Key('pos-user-role-row-${assignment.id}'),
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      '${assignment.roleName} · ${_branchLabel(assignment.branchId)}',
                      style: TextStyle(color: palette.text, fontSize: 12, fontWeight: FontWeight.w600),
                    ),
                  ),
                  _StatusPill(label: assignment.status),
                  const SizedBox(width: 6),
                  Tooltip(
                    message: widget.canAssignRole ? '' : _assignTooltip,
                    child: IconButton(
                      key: Key('pos-user-role-revoke-${assignment.id}'),
                      onPressed: widget.canAssignRole && assignment.status == 'active'
                          ? () => unawaited(_revokeRole(assignment))
                          : null,
                      icon: Icon(Icons.close, size: 16, color: palette.error),
                      tooltip: widget.canAssignRole ? 'Quitar rol' : _assignTooltip,
                    ),
                  ),
                ],
              ),
            ),
        const Divider(height: 28),
        Row(
          children: [
            Expanded(child: Text('Acceso a sucursales', style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13))),
            Tooltip(
              message: widget.canManageBranchAccess ? '' : _branchAccessTooltip,
              child: OutlinedButton.icon(
                key: const Key('pos-user-detail-grant-branch-access'),
                onPressed: widget.canManageBranchAccess ? () => unawaited(_openGrantBranchAccess()) : null,
                icon: const Icon(Icons.add, size: 14),
                label: const Text('Otorgar acceso'),
              ),
            ),
          ],
        ),
        const SizedBox(height: 4),
        // TASK 16.16A Phase 7 — same tone/length as "Acceso a caja/área"'s
        // own existing helper text below.
        Text(
          'Controla en qué sucursales puede trabajar este usuario, además del alcance que ya le da su rol.',
          style: TextStyle(color: palette.textMuted, fontSize: 11),
        ),
        const SizedBox(height: 6),
        if (detail.branchAccess.isEmpty)
          // TASK 16.5 — an active company-wide (branch_id null) role
          // already grants every branch, present and future, with no
          // explicit `user_branch_access` row needed at all (see
          // `auth.repository.ts`'s `resolveContext`) — showing a plain
          // "sin acceso" here for that actor was misleading, not merely
          // stale: it read as "this user cannot access any branch," which
          // was never true and is exactly what made the reported
          // bootstrap bug look worse than it was.
          Text(
            detail.roles.any((assignment) => assignment.branchId == null && assignment.status == 'active')
                ? 'Todas las sucursales (por rol de alcance completo).'
                : 'Sin acceso a sucursales.',
            style: TextStyle(color: palette.textMuted, fontSize: 12),
          )
        else
          for (final access in detail.branchAccess)
            Padding(
              key: Key('pos-user-branch-access-row-${access.branchId}'),
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      '${_branchLabel(access.branchId)}${access.isDefault ? ' · predeterminada' : ''}',
                      style: TextStyle(color: palette.text, fontSize: 12, fontWeight: FontWeight.w600),
                    ),
                  ),
                  _StatusPill(label: access.status),
                  const SizedBox(width: 6),
                  Tooltip(
                    message: widget.canManageBranchAccess ? '' : _branchAccessTooltip,
                    child: IconButton(
                      key: Key('pos-user-branch-access-revoke-${access.branchId}'),
                      onPressed: widget.canManageBranchAccess && access.status == 'active'
                          ? () => unawaited(_revokeBranchAccess(access))
                          : null,
                      icon: Icon(Icons.close, size: 16, color: palette.error),
                      tooltip: widget.canManageBranchAccess ? 'Revocar acceso' : _branchAccessTooltip,
                    ),
                  ),
                ],
              ),
            ),
        const Divider(height: 28),
        // TASK 16.15 — "presence narrows, absence means unrestricted": a
        // user with ZERO rows here for a branch they already have access
        // to (the section above) is UNRESTRICTED within that branch —
        // they can use ANY register there. Each row below NARROWS them
        // down to only that one area/register. Never the reverse.
        Row(
          children: [
            Expanded(
              child: Text(
                'Acceso a caja/área',
                style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13),
              ),
            ),
            Tooltip(
              message: widget.canManageBranchAccess ? '' : _branchAccessTooltip,
              child: OutlinedButton.icon(
                key: const Key('pos-user-detail-grant-register-access'),
                onPressed: widget.canManageBranchAccess ? () => unawaited(_openGrantRegisterAccess()) : null,
                icon: const Icon(Icons.add, size: 14),
                label: const Text('Otorgar acceso'),
              ),
            ),
          ],
        ),
        const SizedBox(height: 4),
        Text(
          'Sin filas aquí, este usuario puede usar cualquier caja de las sucursales que ya tiene '
          'asignadas arriba. Cada fila abajo lo limita a una caja o área específica.',
          style: TextStyle(color: palette.textMuted, fontSize: 11),
        ),
        const SizedBox(height: 6),
        if (_registerAccess.isEmpty)
          Text(
            'Sin restricciones de caja/área (acceso a cualquier caja de sus sucursales).',
            style: TextStyle(color: palette.textMuted, fontSize: 12),
          )
        else
          for (final grant in _registerAccess)
            Padding(
              key: Key('pos-user-register-access-row-${grant.id}'),
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      '${_branchLabel(grant.branchId)} · ${_registerAccessScopeLabel(grant)}',
                      style: TextStyle(color: palette.text, fontSize: 12, fontWeight: FontWeight.w600),
                    ),
                  ),
                  _StatusPill(label: grant.status),
                  const SizedBox(width: 6),
                  Tooltip(
                    message: widget.canManageBranchAccess ? '' : _branchAccessTooltip,
                    child: IconButton(
                      key: Key('pos-user-register-access-revoke-${grant.id}'),
                      onPressed: widget.canManageBranchAccess && grant.status == 'active'
                          ? () => unawaited(_revokeRegisterAccess(grant))
                          : null,
                      icon: Icon(Icons.close, size: 16, color: palette.error),
                      tooltip: widget.canManageBranchAccess ? 'Revocar acceso' : _branchAccessTooltip,
                    ),
                  ),
                ],
              ),
            ),
      ],
    );
  }
}

/// `Asignar rol` dialog — reachable only from an already-`role.assign`-
/// gated entry point.
class _AssignRoleDialog extends StatefulWidget {
  const _AssignRoleDialog({required this.userId, required this.gateway, required this.branches});
  final String userId;
  final PosIdentityAdminGateway gateway;
  final List<BranchSummary> branches;

  @override
  State<_AssignRoleDialog> createState() => _AssignRoleDialogState();
}

class _AssignRoleDialogState extends State<_AssignRoleDialog> {
  _ListPhase _phase = _ListPhase.loading;
  List<PosRole> _roles = const [];
  String? _selectedRoleId;
  String? _selectedBranchId;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_loadRoles());
  }

  Future<void> _loadRoles() async {
    try {
      final roles = await widget.gateway.listRoles();
      if (!mounted) return;
      setState(() {
        _roles = roles.where((role) => role.status == 'active').toList(growable: false);
        _phase = _roles.isEmpty ? _ListPhase.empty : _ListPhase.ready;
        _selectedRoleId = _roles.firstOrNull?.id;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _ListPhase.failure;
        _error = 'No fue posible cargar los roles.';
      });
    }
  }

  Future<void> _submit() async {
    final roleId = _selectedRoleId;
    if (roleId == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.gateway.assignRole(widget.userId, roleId: roleId, branchId: _selectedBranchId);
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible asignar el rol.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Asignar rol', style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16)),
              const SizedBox(height: 14),
              if (_phase == _ListPhase.loading) const Center(child: CircularProgressIndicator()),
              if (_phase == _ListPhase.empty) Text('No hay roles activos disponibles.', style: TextStyle(color: palette.textMuted, fontSize: 12)),
              if (_phase == _ListPhase.ready) ...[
                DropdownButtonFormField<String>(
                  key: const Key('pos-assign-role-role'),
                  initialValue: _selectedRoleId,
                  isExpanded: true,
                  decoration: const InputDecoration(isDense: true, labelText: 'Rol'),
                  items: [for (final role in _roles) DropdownMenuItem(value: role.id, child: Text(role.name))],
                  onChanged: (value) => setState(() => _selectedRoleId = value),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String?>(
                  key: const Key('pos-assign-role-branch'),
                  initialValue: _selectedBranchId,
                  isExpanded: true,
                  decoration: const InputDecoration(isDense: true, labelText: 'Sucursal (opcional)'),
                  items: [
                    const DropdownMenuItem<String?>(value: null, child: Text('Todas las sucursales')),
                    for (final branch in widget.branches) DropdownMenuItem<String?>(value: branch.id, child: Text(branch.name)),
                  ],
                  onChanged: (value) => setState(() => _selectedBranchId = value),
                ),
              ],
              if (_error != null) ...[
                const SizedBox(height: 10),
                Text(_error!, key: const Key('pos-assign-role-error'), style: TextStyle(color: palette.error, fontSize: 12)),
              ],
              const SizedBox(height: 16),
              _DialogButtons(
                busy: _busy,
                onCancel: () => Navigator.of(context).pop(false),
                onSave: () => unawaited(_submit()),
                saveKey: const Key('pos-assign-role-save'),
                saveEnabled: _selectedRoleId != null,
                disabledTooltip: 'Selecciona un rol.',
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// `Otorgar acceso a sucursal` dialog — reachable only from an already-
/// `branch_access.manage`-gated entry point.
class _GrantBranchAccessDialog extends StatefulWidget {
  const _GrantBranchAccessDialog({required this.userId, required this.gateway, required this.branches});
  final String userId;
  final PosIdentityAdminGateway gateway;
  final List<BranchSummary> branches;

  @override
  State<_GrantBranchAccessDialog> createState() => _GrantBranchAccessDialogState();
}

class _GrantBranchAccessDialogState extends State<_GrantBranchAccessDialog> {
  String? _selectedBranchId;
  bool _isDefault = false;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _selectedBranchId = widget.branches.firstOrNull?.id;
  }

  Future<void> _submit() async {
    final branchId = _selectedBranchId;
    if (branchId == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.gateway.changeBranchAccess(widget.userId, branchId, status: 'active', isDefault: _isDefault);
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible otorgar el acceso.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Otorgar acceso a sucursal', style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16)),
              const SizedBox(height: 14),
              if (widget.branches.isEmpty)
                Text('No hay sucursales disponibles en tu sesión.', style: TextStyle(color: palette.textMuted, fontSize: 12))
              else ...[
                DropdownButtonFormField<String>(
                  key: const Key('pos-grant-branch-access-branch'),
                  initialValue: _selectedBranchId,
                  isExpanded: true,
                  decoration: const InputDecoration(isDense: true, labelText: 'Sucursal'),
                  items: [for (final branch in widget.branches) DropdownMenuItem(value: branch.id, child: Text(branch.name))],
                  onChanged: (value) => setState(() => _selectedBranchId = value),
                ),
                CheckboxListTile(
                  key: const Key('pos-grant-branch-access-default'),
                  value: _isDefault,
                  onChanged: (value) => setState(() => _isDefault = value ?? false),
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                  title: const Text('Sucursal predeterminada', style: TextStyle(fontSize: 12)),
                ),
              ],
              if (_error != null) ...[
                const SizedBox(height: 10),
                Text(_error!, key: const Key('pos-grant-branch-access-error'), style: TextStyle(color: palette.error, fontSize: 12)),
              ],
              const SizedBox(height: 16),
              _DialogButtons(
                busy: _busy,
                onCancel: () => Navigator.of(context).pop(false),
                onSave: () => unawaited(_submit()),
                saveKey: const Key('pos-grant-branch-access-save'),
                saveEnabled: _selectedBranchId != null,
                disabledTooltip: 'Selecciona una sucursal.',
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// `Otorgar acceso a caja/área` dialog — TASK 16.15, reachable only from an
/// already-`branch_access.manage`-gated entry point. Narrows a user's
/// ALREADY-granted branch access (see `_GrantBranchAccessDialog` above)
/// down to either "every register in one operational area" or "one
/// specific register", per the exact XOR the backend requires
/// (`POST /users/{id}/register-access`'s own `operational_area_id` XOR
/// `cash_register_id` body schema).
class _GrantRegisterAccessDialog extends StatefulWidget {
  const _GrantRegisterAccessDialog({
    required this.userId,
    required this.gateway,
    required this.areasGateway,
    required this.cashGateway,
    required this.branches,
  });
  final String userId;
  final PosIdentityAdminGateway gateway;
  final PosOperationalAreasGateway areasGateway;
  final PosCashGateway cashGateway;
  final List<BranchSummary> branches;

  @override
  State<_GrantRegisterAccessDialog> createState() => _GrantRegisterAccessDialogState();
}

enum _RegisterAccessScopeMode { area, register }

class _GrantRegisterAccessDialogState extends State<_GrantRegisterAccessDialog> {
  String? _selectedBranchId;
  _RegisterAccessScopeMode _mode = _RegisterAccessScopeMode.area;
  List<PosOperationalArea> _areas = const [];
  List<PosCashRegister> _registers = const [];
  String? _selectedAreaId;
  String? _selectedRegisterId;
  bool _loadingOptions = false;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _selectedBranchId = widget.branches.firstOrNull?.id;
    unawaited(_loadOptions());
  }

  Future<void> _loadOptions() async {
    final branchId = _selectedBranchId;
    if (branchId == null) return;
    setState(() {
      _loadingOptions = true;
      _selectedAreaId = null;
      _selectedRegisterId = null;
    });
    try {
      final areasPage = await widget.areasGateway.listAreas(branchId: branchId, status: 'active');
      final registers = await widget.cashGateway.registersForBranch(branchId);
      if (!mounted) return;
      setState(() {
        _areas = areasPage.items;
        _registers = registers;
        _selectedAreaId = areasPage.items.firstOrNull?.id;
        _selectedRegisterId = registers.firstOrNull?.id;
        _loadingOptions = false;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _areas = const [];
        _registers = const [];
        _loadingOptions = false;
      });
    }
  }

  Future<void> _submit() async {
    final branchId = _selectedBranchId;
    if (branchId == null) return;
    final areaId = _mode == _RegisterAccessScopeMode.area ? _selectedAreaId : null;
    final registerId = _mode == _RegisterAccessScopeMode.register ? _selectedRegisterId : null;
    if (areaId == null && registerId == null) {
      setState(
        () => _error = _mode == _RegisterAccessScopeMode.area
            ? 'Selecciona un área operativa.'
            : 'Selecciona una caja.',
      );
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.gateway.grantRegisterAccess(
        widget.userId,
        branchId: branchId,
        operationalAreaId: areaId,
        cashRegisterId: registerId,
      );
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible otorgar el acceso.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 440, maxHeight: 480),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Otorgar acceso a caja/área',
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
                ),
                const SizedBox(height: 4),
                Text(
                  'Esto LIMITA al usuario a la caja o área elegida dentro de la sucursal — sin esta '
                  'regla, ya puede usar cualquier caja de las sucursales que tiene asignadas.',
                  style: TextStyle(color: palette.textMuted, fontSize: 11),
                ),
                const SizedBox(height: 14),
                if (widget.branches.isEmpty)
                  Text('No hay sucursales disponibles en tu sesión.', style: TextStyle(color: palette.textMuted, fontSize: 12))
                else ...[
                  DropdownButtonFormField<String>(
                    key: const Key('pos-grant-register-access-branch'),
                    initialValue: _selectedBranchId,
                    isExpanded: true,
                    decoration: const InputDecoration(isDense: true, labelText: 'Sucursal'),
                    items: [for (final branch in widget.branches) DropdownMenuItem(value: branch.id, child: Text(branch.name))],
                    onChanged: (value) {
                      setState(() => _selectedBranchId = value);
                      unawaited(_loadOptions());
                    },
                  ),
                  const SizedBox(height: 10),
                  SegmentedButton<_RegisterAccessScopeMode>(
                    key: const Key('pos-grant-register-access-mode'),
                    segments: const [
                      ButtonSegment(value: _RegisterAccessScopeMode.area, label: Text('Área operativa')),
                      ButtonSegment(value: _RegisterAccessScopeMode.register, label: Text('Caja específica')),
                    ],
                    selected: {_mode},
                    onSelectionChanged: (value) => setState(() => _mode = value.first),
                  ),
                  const SizedBox(height: 10),
                  if (_loadingOptions)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 12),
                      child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
                    )
                  else if (_mode == _RegisterAccessScopeMode.area)
                    _areas.isEmpty
                        ? Text('Esta sucursal no tiene áreas operativas activas.', style: TextStyle(color: palette.textMuted, fontSize: 12))
                        : DropdownButtonFormField<String>(
                            key: const Key('pos-grant-register-access-area'),
                            initialValue: _selectedAreaId,
                            isExpanded: true,
                            decoration: const InputDecoration(isDense: true, labelText: 'Área operativa'),
                            items: [for (final area in _areas) DropdownMenuItem(value: area.id, child: Text(area.name))],
                            onChanged: (value) => setState(() => _selectedAreaId = value),
                          )
                  else
                    _registers.isEmpty
                        ? Text('Esta sucursal no tiene cajas activas.', style: TextStyle(color: palette.textMuted, fontSize: 12))
                        : DropdownButtonFormField<String>(
                            key: const Key('pos-grant-register-access-register'),
                            initialValue: _selectedRegisterId,
                            isExpanded: true,
                            decoration: const InputDecoration(isDense: true, labelText: 'Caja'),
                            items: [
                              for (final register in _registers)
                                DropdownMenuItem(value: register.id, child: Text('${register.name} (${register.code})')),
                            ],
                            onChanged: (value) => setState(() => _selectedRegisterId = value),
                          ),
                ],
                if (_error != null) ...[
                  const SizedBox(height: 10),
                  Text(
                    _error!,
                    key: const Key('pos-grant-register-access-error'),
                    style: TextStyle(color: palette.error, fontSize: 12),
                  ),
                ],
                const SizedBox(height: 16),
                _DialogButtons(
                  busy: _busy,
                  onCancel: () => Navigator.of(context).pop(false),
                  onSave: () => unawaited(_submit()),
                  saveKey: const Key('pos-grant-register-access-save'),
                  saveEnabled: _selectedBranchId != null,
                  disabledTooltip: 'Selecciona una sucursal.',
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------
// Roles — gated by `role.read`; mutations by `role.create`/`role.update`/
// `role.permission.manage` individually.
// ---------------------------------------------------------------------

class _RolesTab extends StatefulWidget {
  const _RolesTab({required this.context, required this.gateway});
  final AuthenticatedContext context;
  final PosIdentityAdminGateway gateway;

  @override
  State<_RolesTab> createState() => _RolesTabState();
}

// TASK 16.31 (Phase 9) — presentation-only role icon/color, deterministic
// from the role's own real `code`/`name` (never a fabricated backend
// field — `PosRole` has no icon/color column, confirmed against the
// schema). The same role always renders the same icon/color; a role
// this keyword list doesn't recognize still gets a stable color (hashed
// from its code) and a sensible generic icon, never a crash or a blank.
IconData _roleIcon(PosRole role) {
  final code = role.code.toLowerCase();
  if (code.contains('owner') || code.contains('dueñ')) return Icons.workspace_premium_outlined;
  if (code.contains('admin')) return Icons.admin_panel_settings_outlined;
  if (code.contains('manager') || code.contains('gerente')) return Icons.supervisor_account_outlined;
  if (code.contains('cashier') || code.contains('cajer')) return Icons.point_of_sale_outlined;
  if (code.contains('kitchen') || code.contains('cocina')) return Icons.soup_kitchen_outlined;
  if (code.contains('cafe')) return Icons.local_cafe_outlined;
  return Icons.shield_outlined;
}

Color _roleColor(PosPalette palette, PosRole role) {
  final accents = [palette.blueDeep, palette.action, palette.success, palette.warning, palette.cyan];
  final hash = role.code.codeUnits.fold<int>(0, (sum, unit) => sum + unit);
  return accents[hash % accents.length];
}

class _RolesTabState extends State<_RolesTab> {
  _ListPhase _phase = _ListPhase.loading;
  List<PosRole> _items = const [];
  String? _errorMessage;
  String? _selectedRoleId;
  List<String>? _selectedTemplateCodes;

  bool get _canRead => widget.context.permissions.contains('role.read');
  bool get _canCreate => widget.context.permissions.contains('role.create');
  bool get _canUpdate => widget.context.permissions.contains('role.update');
  bool get _canManagePermissions => widget.context.permissions.contains('role.permission.manage');

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    if (!_canRead) return;
    setState(() {
      _phase = _ListPhase.loading;
      _errorMessage = null;
    });
    try {
      final items = await widget.gateway.listRoles();
      if (!mounted) return;
      setState(() {
        _items = items;
        _phase = items.isEmpty ? _ListPhase.empty : _ListPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _ListPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _ListPhase.failure;
        _errorMessage = 'No fue posible cargar los roles.';
      });
    }
  }

  Future<void> _openNewForm() async {
    if (!_canCreate) return;
    final result = await showDialog<_RoleFormResult>(
      context: context,
      builder: (dialogContext) => _RoleFormDialog(gateway: widget.gateway),
    );
    if (result == null) return;
    unawaited(_load());
    // TASK 16.16/16.31 — a role created from a template immediately
    // selects itself in the master/detail view below, pre-checked with
    // that template's own permission codes (see `_RoleFormResult`'s own
    // doc comment) — the same continuation the old modal-dialog flow
    // used to do, now inline instead of a second dialog. Never attempted
    // when the acting admin can't manage permissions at all — mirrors
    // every other `role.permission.manage` gate in this file.
    setState(() {
      _selectedRoleId = result.role.id;
      _selectedTemplateCodes = _canManagePermissions ? result.templatePermissionCodes : null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    // TASK 16.31 — lacking `role.read` blocks only the LEFT pane (role
    // list); the RIGHT pane's own default content (the permission
    // catalog browse) is independently gated on `permission.read` by
    // `_PermissionCatalogBrowse` itself and must still render for an
    // actor who holds that permission but not `role.read` — the same
    // real capability the old, separate "Permisos" tab always gave
    // them, never silently withdrawn by this task's own visual merge.
    if (!_canRead) {
      return Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Expanded(child: _PermissionDenied(permission: 'role.read')),
          const SizedBox(width: 16),
          Expanded(
            child: _PermissionCatalogBrowse(gateway: widget.gateway, context: widget.context),
          ),
        ],
      );
    }
    final newDisabledReason = _canCreate ? '' : 'Se requiere el permiso role.create.';
    final selectedRole = _selectedRoleId == null ? null : _items.where((r) => r.id == _selectedRoleId).firstOrNull;

    final leftPane = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Tooltip(
          message: newDisabledReason,
          child: FilledButton.icon(
            key: const Key('pos-roles-new'),
            onPressed: newDisabledReason.isEmpty ? () => unawaited(_openNewForm()) : null,
            style: FilledButton.styleFrom(backgroundColor: palette.action),
            icon: const Icon(Icons.add_moderator_outlined, size: 16),
            label: const Text('Nuevo rol'),
          ),
        ),
        const SizedBox(height: 12),
        switch (_phase) {
          _ListPhase.loading => const _Loading(),
          _ListPhase.empty => const _Empty(message: 'No hay roles disponibles.'),
          _ListPhase.failure => _Failure(
            message: _errorMessage ?? 'No fue posible cargar los roles.',
            onRetry: () => unawaited(_load()),
          ),
          _ListPhase.ready => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final role in _items)
                _RoleCard(
                  role: role,
                  selected: role.id == _selectedRoleId,
                  onTap: () => setState(() {
                    _selectedRoleId = role.id;
                    _selectedTemplateCodes = null;
                  }),
                ),
            ],
          ),
        },
      ],
    );

    final rightPane = selectedRole == null
        ? _PermissionCatalogBrowse(key: const Key('pos-role-detail-empty'), gateway: widget.gateway, context: widget.context)
        : _RoleDetailDialog(
            key: ValueKey('pos-role-detail-${selectedRole.id}'),
            role: selectedRole,
            gateway: widget.gateway,
            actorPermissions: widget.context.permissions,
            canUpdate: _canUpdate,
            canManagePermissions: _canManagePermissions,
            initialTemplatePermissionCodes: _selectedTemplateCodes,
            embedded: true,
            onSaved: () => unawaited(_load()),
          );

    // TASK 16.31 (Phase 23) — desktop master/detail (≈30/70) collapses to
    // a stacked list-then-detail column at narrow widths, never a
    // horizontally-crushed two-column layout.
    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth < 860) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              leftPane,
              if (selectedRole != null || _phase != _ListPhase.ready) ...[
                const SizedBox(height: 16),
                const Divider(),
                const SizedBox(height: 8),
                rightPane,
              ],
            ],
          );
        }
        // TASK 16.31.3 (Phase 2) — a proportional ~26/74 split (not a
        // fixed pixel width) so the role rail stays compact rather than
        // wide, at any desktop width.
        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(flex: 26, child: leftPane),
            const SizedBox(width: 16),
            Expanded(flex: 74, child: rightPane),
          ],
        );
      },
    );
  }
}

/// TASK 16.31 (Phase 9/10) + TASK 16.31.3 (Phase 3) — the left-pane role
/// card: icon/color (see `_roleIcon`/`_roleColor`), name as the PRIMARY
/// information, "Protegido" badge for `is_system`, selection highlight.
/// Status is deliberately visually secondary now — `active` (the
/// overwhelming majority case) renders no pill at all; only a real,
/// non-default status (`inactive`/`retired`) shows a small muted label,
/// since a status pill on every single row added little scannable
/// information for the common case. Deliberately still no "N usuarios"
/// count (see this file's own pre-existing doc comment on the reasoning
/// — computing that here would mean an aggregate the real backend has
/// no endpoint for at all, worse than the N+1 the old `_RoleRow` doc
/// comment already declined; see docs/USERS_EMPLOYEES_UX.md).
class _RoleCard extends StatelessWidget {
  const _RoleCard({required this.role, required this.selected, required this.onTap});
  final PosRole role;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final accent = _roleColor(palette, role);
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Material(
        key: Key('pos-role-row-${role.id}'),
        color: selected ? palette.actionTint : palette.surface,
        borderRadius: BorderRadius.circular(10),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(10),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: selected ? accent : palette.border, width: selected ? 1.5 : 1),
            ),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(5),
                  decoration: BoxDecoration(color: accent.withValues(alpha: .14), shape: BoxShape.circle),
                  child: Icon(_roleIcon(role), size: 12, color: accent),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    role.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: palette.text,
                      fontWeight: selected ? FontWeight.w800 : FontWeight.w700,
                      fontSize: 13,
                    ),
                  ),
                ),
                if (role.isSystem) ...[
                  const SizedBox(width: 6),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(color: palette.blueTint, borderRadius: BorderRadius.circular(20)),
                    child: Text(
                      'Protegido',
                      style: TextStyle(color: palette.blueDeep, fontSize: 9, fontWeight: FontWeight.w800),
                    ),
                  ),
                ] else if (role.status != 'active') ...[
                  const SizedBox(width: 6),
                  Text(
                    _statusPillLabel(role.status),
                    style: TextStyle(color: palette.textMuted, fontSize: 9.5, fontWeight: FontWeight.w700),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// TASK 16.16 — [_RoleFormDialog]'s own result: the freshly-created role,
/// plus (only when the admin picked a real template rather than
/// "Personalizado / en blanco") that template's RAW permission codes —
/// never yet resolved to ids, never yet filtered to what the acting admin
/// holds. `_RolesTabState._openNewForm` is the one caller, and immediately
/// hands [templatePermissionCodes] to `_RoleDetailDialog` (via
/// `initialTemplatePermissionCodes`), which does that resolution/filtering
/// itself — the same place every other permission decision for that dialog
/// already lives.
class _RoleFormResult {
  const _RoleFormResult({required this.role, this.templatePermissionCodes});
  final PosRole role;
  final List<String>? templatePermissionCodes;
}

class _RoleFormDialog extends StatefulWidget {
  const _RoleFormDialog({required this.gateway});
  final PosIdentityAdminGateway gateway;

  @override
  State<_RoleFormDialog> createState() => _RoleFormDialogState();
}

class _RoleFormDialogState extends State<_RoleFormDialog> {
  final _nameController = TextEditingController();
  final _codeController = TextEditingController();
  final _descriptionController = TextEditingController();
  bool _busy = false;
  String? _error;

  // TASK 16.16 — template-selection step. `null` (the default) means
  // "Personalizado / en blanco": today's exact original behavior, fully
  // preserved — three raw free-text fields, an ordinary empty role.
  List<PosRoleTemplate> _templates = const [];
  String? _selectedTemplateKey;
  // The label this dialog itself last typed into `_nameController` on the
  // admin's behalf (picking a template) — lets template switches keep
  // re-filling the name field, WITHOUT ever clobbering a name the admin
  // typed or edited by hand.
  String? _autoFilledName;

  @override
  void initState() {
    super.initState();
    unawaited(_loadTemplates());
  }

  // Best-effort only, exactly like every other secondary/decorative fetch
  // in this file (e.g. `_DashboardScreenState._requestBannerSummary`) — a
  // failed load just means the template picker offers nothing but
  // "Personalizado / en blanco", never a blocked or broken dialog.
  Future<void> _loadTemplates() async {
    try {
      final templates = await widget.gateway.listRoleTemplates();
      if (!mounted) return;
      setState(() => _templates = templates);
    } on Object {
      // Silently absent — see this method's own doc comment.
    }
  }

  void _selectTemplate(String? key) {
    setState(() {
      _selectedTemplateKey = key;
      if (key == null) return;
      final template = _templates.where((item) => item.key == key).firstOrNull;
      if (template == null) return;
      final currentName = _nameController.text;
      // Only overwrite when the field is empty or still holds exactly
      // whatever THIS dialog auto-filled last — never a name the admin
      // typed or edited themselves (a business might want "Cajero de
      // Taquilla" for their own operation, never forced back to the
      // template's generic label).
      if (currentName.isEmpty || currentName == _autoFilledName) {
        _nameController.text = template.label;
        _autoFilledName = template.label;
      }
    });
  }

  @override
  void dispose() {
    _nameController.dispose();
    _codeController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final name = _nameController.text.trim();
    final code = _codeController.text.trim();
    final description = _descriptionController.text.trim();
    if (name.isEmpty) {
      setState(() => _error = 'El nombre es obligatorio.');
      return;
    }
    if (code.isEmpty) {
      setState(() => _error = 'El código es obligatorio.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final role = await widget.gateway.createRole(
        name: name,
        code: code,
        description: description.isEmpty ? null : description,
      );
      if (!mounted) return;
      final template = _selectedTemplateKey == null
          ? null
          : _templates.where((item) => item.key == _selectedTemplateKey).firstOrNull;
      Navigator.of(context).pop(
        _RoleFormResult(role: role, templatePermissionCodes: template?.permissionCodes),
      );
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible crear el rol.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Nuevo rol', style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16)),
              const SizedBox(height: 14),
              if (_templates.isNotEmpty) ...[
                DropdownButtonFormField<String?>(
                  key: const Key('pos-role-form-template'),
                  initialValue: _selectedTemplateKey,
                  isExpanded: true,
                  decoration: const InputDecoration(isDense: true, labelText: 'Plantilla'),
                  items: [
                    const DropdownMenuItem<String?>(value: null, child: Text('Personalizado / en blanco')),
                    for (final template in _templates)
                      DropdownMenuItem<String?>(
                        value: template.key,
                        key: Key('pos-role-form-template-${template.key}'),
                        child: Text(template.label),
                      ),
                  ],
                  onChanged: _selectTemplate,
                ),
                if (_selectedTemplateKey != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      _templates.where((item) => item.key == _selectedTemplateKey).first.description ??
                          'Los permisos de esta plantilla se podrán revisar y ajustar antes de guardarlos.',
                      style: TextStyle(color: palette.textSecondary, fontSize: 11),
                    ),
                  ),
                const SizedBox(height: 10),
              ],
              TextField(
                key: const Key('pos-role-form-name'),
                controller: _nameController,
                decoration: const InputDecoration(isDense: true, labelText: 'Nombre'),
              ),
              const SizedBox(height: 10),
              TextField(
                key: const Key('pos-role-form-code'),
                controller: _codeController,
                decoration: const InputDecoration(isDense: true, labelText: 'Código (ej. supervisor)'),
              ),
              const SizedBox(height: 10),
              TextField(
                key: const Key('pos-role-form-description'),
                controller: _descriptionController,
                maxLines: 2,
                decoration: const InputDecoration(isDense: true, labelText: 'Descripción (opcional)'),
              ),
              if (_error != null) ...[
                const SizedBox(height: 10),
                Text(_error!, key: const Key('pos-role-form-error'), style: TextStyle(color: palette.error, fontSize: 12)),
              ],
              const SizedBox(height: 16),
              _DialogButtons(
                busy: _busy,
                onCancel: () => Navigator.of(context).pop(),
                onSave: () => unawaited(_submit()),
                saveKey: const Key('pos-role-form-save'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Role detail/edit dialog: name/description/status, plus the permission
/// picker (shared with the standalone Permisos tab via [_PermissionPicker]).
class _RoleDetailDialog extends StatefulWidget {
  const _RoleDetailDialog({
    required this.role,
    required this.gateway,
    required this.actorPermissions,
    required this.canUpdate,
    required this.canManagePermissions,
    this.initialTemplatePermissionCodes,
    // TASK 16.31 (Phase 9) — `true` renders this same content INLINE in
    // the Roles master/detail right pane (no `Dialog` chrome, no close
    // button — there's nothing to "close" back to, the left pane stays
    // visible the whole time); `false` (every pre-existing caller) keeps
    // the original modal `Dialog` wrapper unchanged. Either way, every
    // field/mutation/self-escalation-guard below is IDENTICAL — only the
    // outer shell differs. [onSaved] replaces the old `Navigator.pop
    // (_changed)` contract for the embedded case (there's no route to
    // pop); the modal case still pops as before.
    this.embedded = false,
    this.onSaved,
    super.key,
  });

  final PosRole role;
  final PosIdentityAdminGateway gateway;
  final List<String> actorPermissions;
  final bool canUpdate;
  final bool canManagePermissions;
  // TASK 16.16 — set only right after creating a role from a template
  // (`_RolesTabState._openNewForm`); `null` for every other caller
  // (opening an existing role's own detail), which keeps today's exact
  // original behavior. See `_RoleDetailDialogState._loadPermissions` for
  // how this gets resolved to permission ids and filtered to what the
  // acting admin actually holds.
  final List<String>? initialTemplatePermissionCodes;
  final bool embedded;
  final VoidCallback? onSaved;

  @override
  State<_RoleDetailDialog> createState() => _RoleDetailDialogState();
}

class _RoleDetailDialogState extends State<_RoleDetailDialog> {
  late PosRole _role = widget.role;
  late final _nameController = TextEditingController(text: widget.role.name);
  late final _descriptionController = TextEditingController(text: widget.role.description ?? '');
  late String _statusValue = widget.role.status;
  bool _detailBusy = false;
  String? _detailError;
  bool _changed = false;

  _ListPhase _permissionsPhase = _ListPhase.loading;
  List<PosPermission> _allPermissions = const [];
  Set<String> _selectedPermissionIds = {};
  Set<String> _initialPermissionIds = {};
  bool _permissionsBusy = false;
  String? _permissionsError;

  static const _updateTooltip = 'Se requiere el permiso role.update.';
  static const _systemTooltip = 'Los roles del sistema no se pueden modificar.';
  static const _manageTooltip = 'Se requiere el permiso role.permission.manage.';

  bool get _editable => widget.canUpdate && !_role.isSystem;
  bool get _permissionsEditable => widget.canManagePermissions && !_role.isSystem;
  bool get _permissionsDirty => !setEquals(_selectedPermissionIds, _initialPermissionIds);

  @override
  void initState() {
    super.initState();
    unawaited(_loadPermissions());
  }

  @override
  void dispose() {
    _nameController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  Future<void> _loadPermissions() async {
    setState(() {
      _permissionsPhase = _ListPhase.loading;
      _permissionsError = null;
    });
    try {
      final all = await widget.gateway.listPermissions();
      final current = await widget.gateway.rolePermissions(_role.id);
      if (!mounted) return;
      final ids = current.where((item) => item.effect == 'allow').map((item) => item.permissionId).toSet();
      // TASK 16.16 — a role freshly created from a template starts with
      // NO real server-side permissions yet (`ids` is empty), so this pre-
      // checks the template's own codes on top, resolved to ids via this
      // same already-fetched `all` catalogue. Deliberately filtered to
      // codes the ACTING ADMIN also holds — the existing self-escalation
      // guard (`_PermissionRow`'s own `checkboxEnabled`) only disables a
      // NOT-yet-checked box the actor doesn't hold; pre-checking one here
      // would instead render it checked-and-editable, letting an admin
      // save a grant that would 403 server-side. Never pre-checking it at
      // all is this task's own explicitly-sanctioned simpler fallback —
      // see `_RoleFormDialog`'s own header doc comment.
      final templateCodes = widget.initialTemplatePermissionCodes;
      final preSelected = templateCodes == null
          ? ids
          : {
              ...ids,
              for (final permission in all)
                if (templateCodes.contains(permission.code) &&
                    widget.actorPermissions.contains(permission.code))
                  permission.id,
            };
      setState(() {
        _allPermissions = all;
        _selectedPermissionIds = Set.of(preSelected);
        _initialPermissionIds = Set.of(ids);
        _permissionsPhase = all.isEmpty ? _ListPhase.empty : _ListPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _permissionsPhase = _ListPhase.failure;
        _permissionsError = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _permissionsPhase = _ListPhase.failure;
        _permissionsError = 'No fue posible cargar los permisos.';
      });
    }
  }

  Future<void> _saveDetails() async {
    if (!_editable || _detailBusy) return;
    final name = _nameController.text.trim();
    if (name.isEmpty) {
      setState(() => _detailError = 'El nombre es obligatorio.');
      return;
    }
    setState(() {
      _detailBusy = true;
      _detailError = null;
    });
    try {
      final updated = await widget.gateway.updateRole(
        _role.id,
        name: name,
        description: _descriptionController.text.trim(),
        status: _statusValue,
      );
      if (!mounted) return;
      setState(() {
        _role = updated;
        _detailBusy = false;
        _changed = true;
      });
      widget.onSaved?.call();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _detailBusy = false;
        _detailError = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _detailBusy = false;
        _detailError = 'No fue posible guardar el rol.';
      });
    }
  }

  Future<void> _savePermissions() async {
    if (!_permissionsEditable || _permissionsBusy) return;
    setState(() {
      _permissionsBusy = true;
      _permissionsError = null;
    });
    try {
      final assignments = [
        for (final id in _selectedPermissionIds) PosPermissionEffect(permissionId: id),
      ];
      final result = await widget.gateway.replaceRolePermissions(_role.id, assignments);
      if (!mounted) return;
      final ids = result.where((item) => item.effect == 'allow').map((item) => item.permissionId).toSet();
      setState(() {
        _selectedPermissionIds = Set.of(ids);
        _initialPermissionIds = Set.of(ids);
        _permissionsBusy = false;
        _changed = true;
      });
      widget.onSaved?.call();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _permissionsBusy = false;
        _permissionsError = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _permissionsBusy = false;
        _permissionsError = 'No fue posible guardar los permisos.';
      });
    }
  }

  void _togglePermission(PosPermission permission) {
    setState(() {
      if (_selectedPermissionIds.contains(permission.id)) {
        _selectedPermissionIds = Set.of(_selectedPermissionIds)..remove(permission.id);
      } else {
        _selectedPermissionIds = Set.of(_selectedPermissionIds)..add(permission.id);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final headerAccent = _roleColor(palette, _role);
    final content = Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // TASK 16.31.3 (Phase 4) — compact selected-role header: icon +
        // name + "Protegido" badge on one line, real description (when
        // present) directly beneath — never a fabricated one.
        Row(
          children: [
            Container(
              padding: const EdgeInsets.all(7),
              decoration: BoxDecoration(color: headerAccent.withValues(alpha: .14), shape: BoxShape.circle),
              child: Icon(_roleIcon(_role), size: 16, color: headerAccent),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(_role.name, style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16)),
            ),
            if (_role.isSystem)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(color: palette.blueTint, borderRadius: BorderRadius.circular(20)),
                child: Text('Protegido', style: TextStyle(color: palette.blueDeep, fontSize: 10.5, fontWeight: FontWeight.w800)),
              ),
            // TASK 16.31 — embedded in the master/detail right pane,
            // there is no dialog route to close back to (the left pane
            // stays visible the whole time) — omit the button entirely
            // rather than have it pop the wrong, enclosing route.
            if (!widget.embedded)
              IconButton(
                key: const Key('pos-role-detail-close'),
                tooltip: 'Cerrar',
                onPressed: () => Navigator.of(context).pop(_changed),
                icon: Icon(Icons.close, color: palette.textMuted, size: 18),
              ),
          ],
        ),
        if (_role.description != null && _role.description!.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(_role.description!, style: TextStyle(color: palette.textSecondary, fontSize: 12)),
          ),
        // TASK 16.16A Phase 7 — "Cajero / 12 permisos" style summary,
        // computed from the SAME `rolePermissions()` call
        // `_loadPermissions` already makes to feed the picker below
        // (never a new/extra network call — see `_RoleRow`'s own doc
        // comment for why that summary does NOT live in the list row
        // instead). Reflects the currently SAVED grant count
        // (`_initialPermissionIds`), not unsaved in-progress checkbox
        // edits, so it never claims a save that hasn't happened yet.
        Padding(
          padding: const EdgeInsets.only(top: 6, bottom: 8),
          child: Text(
            _permissionsPhase == _ListPhase.ready
                ? '${_role.code} · ${_initialPermissionIds.length} '
                      '${_initialPermissionIds.length == 1 ? 'permiso' : 'permisos'}'
                : _role.code,
            key: const Key('pos-role-detail-summary'),
            style: TextStyle(color: palette.textSecondary, fontSize: 11),
          ),
        ),
        if (_role.isSystem)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(_systemTooltip, style: TextStyle(color: palette.warning, fontSize: 11)),
          ),
        // TASK 16.31.3 (Phase 4/10) — kept always visible (never behind
        // an accordion) per this task's own explicit "keep the save
        // action clearly visible" instruction — Name/Status share a row
        // instead of stacking, which is where the real compaction here
        // comes from.
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
                Expanded(
                  flex: 3,
                  child: TextField(
                    key: const Key('pos-role-detail-name'),
                    controller: _nameController,
                    enabled: _editable,
                    style: const TextStyle(fontSize: 13),
                    decoration: const InputDecoration(isDense: true, labelText: 'Nombre'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  flex: 2,
                  child: DropdownButtonFormField<String>(
                    key: const Key('pos-role-detail-status'),
                    initialValue: _statusValue,
                    isExpanded: true,
                    decoration: const InputDecoration(isDense: true, labelText: 'Estado'),
                    items: const [
                      DropdownMenuItem(value: 'active', child: Text('Activo')),
                      DropdownMenuItem(value: 'inactive', child: Text('Inactivo')),
                      DropdownMenuItem(value: 'retired', child: Text('Retirado')),
                    ],
                    onChanged: _editable ? (value) => setState(() => _statusValue = value ?? _statusValue) : null,
                  ),
                ),
          ],
        ),
        const SizedBox(height: 8),
        TextField(
          key: const Key('pos-role-detail-description'),
          controller: _descriptionController,
          enabled: _editable,
          // TASK 16.31.5 (Phase 5) — content-driven height: a single
          // line when empty/short (never dominates the viewport for a
          // role with no description), grows to 2 only if the admin
          // actually types more.
          minLines: 1,
          maxLines: 2,
          style: const TextStyle(fontSize: 12.5),
          decoration: const InputDecoration(isDense: true, labelText: 'Descripción'),
        ),
        if (_detailError != null) ...[
          const SizedBox(height: 8),
          Text(_detailError!, key: const Key('pos-role-detail-error'), style: TextStyle(color: palette.error, fontSize: 12)),
        ],
        const SizedBox(height: 10),
                Align(
                  alignment: Alignment.centerRight,
                  child: Tooltip(
                    message: _editable ? '' : (widget.canUpdate ? _systemTooltip : _updateTooltip),
                    child: FilledButton.icon(
                      key: const Key('pos-role-detail-save'),
                      onPressed: _editable && !_detailBusy ? () => unawaited(_saveDetails()) : null,
                      style: FilledButton.styleFrom(backgroundColor: palette.action),
                      icon: _detailBusy
                          ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                          : const Icon(Icons.save_outlined, size: 16),
                      label: const Text('Guardar datos'),
                    ),
                  ),
                ),
        const SizedBox(height: 4),
        // TASK 16.31.3 (Phase 5/6) — "PERMISOS" replaces the old
        // "Permisos avanzados" heading + a 2-line explanatory paragraph:
        // the density this task asks for comes from showing permissions
        // immediately, not from a longer intro above them.
        Text(
          'PERMISOS',
          style: TextStyle(color: palette.textSecondary, fontWeight: FontWeight.w800, fontSize: 11, letterSpacing: .4),
        ),
        const Padding(padding: EdgeInsets.symmetric(vertical: 4), child: Divider(height: 1)),
        switch (_permissionsPhase) {
                  _ListPhase.loading => const Padding(padding: EdgeInsets.symmetric(vertical: 20), child: Center(child: CircularProgressIndicator())),
                  _ListPhase.empty => Text('El catálogo de permisos está vacío.', style: TextStyle(color: palette.textMuted, fontSize: 12)),
                  _ListPhase.failure => Text(_permissionsError ?? 'No fue posible cargar los permisos.', style: TextStyle(color: palette.error, fontSize: 12)),
                  _ListPhase.ready => _PermissionPicker(
                    permissions: _allPermissions,
                    selectedIds: _selectedPermissionIds,
                    actorPermissionCodes: widget.actorPermissions.toSet(),
                    enabled: _permissionsEditable,
                    disabledReason: !widget.canManagePermissions ? _manageTooltip : (_role.isSystem ? _systemTooltip : null),
                    onToggle: _togglePermission,
                  ),
                },
                if (_permissionsPhase == _ListPhase.ready) ...[
                  if (_permissionsError != null) ...[
                    const SizedBox(height: 8),
                    Text(_permissionsError!, key: const Key('pos-role-permissions-error'), style: TextStyle(color: palette.error, fontSize: 12)),
                  ],
                  const SizedBox(height: 10),
                  Align(
                    alignment: Alignment.centerRight,
                    child: Tooltip(
                      message: _permissionsEditable ? '' : (widget.canManagePermissions ? _systemTooltip : _manageTooltip),
                      child: FilledButton.icon(
                        key: const Key('pos-role-detail-save-permissions'),
                        onPressed: _permissionsEditable && _permissionsDirty && !_permissionsBusy
                            ? () => unawaited(_savePermissions())
                            : null,
                        style: FilledButton.styleFrom(backgroundColor: palette.action),
                        icon: _permissionsBusy
                            ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                            : const Icon(Icons.save_outlined, size: 16),
                        label: const Text('Guardar permisos'),
                      ),
                    ),
                  ),
                ],
              ],
            );
    if (widget.embedded) {
      return SingleChildScrollView(child: content);
    }
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560, maxHeight: 720),
          child: SingleChildScrollView(child: content),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------
// Permisos — gated by `permission.read`; a real, understandable, read-only
// browser of the live server-authoritative catalog, grouped by domain.
// This is the SAME `_PermissionPicker` widget the Roles tab's edit flow
// uses (`readOnly` mode below), not a separate implementation.
//
// TASK 16.31 (Phase 9) — this used to be its own standalone "Permisos"
// tab; it is now the Roles y permisos master/detail view's own DEFAULT
// right-pane content (no role selected yet) — never removed, just
// relocated, so the full-catalog browse capability (and its own
// dedicated permission) is never lost.
// ---------------------------------------------------------------------

class _PermissionCatalogBrowse extends StatefulWidget {
  const _PermissionCatalogBrowse({required this.context, required this.gateway, super.key});
  final AuthenticatedContext context;
  final PosIdentityAdminGateway gateway;

  @override
  State<_PermissionCatalogBrowse> createState() => _PermissionCatalogBrowseState();
}

class _PermissionCatalogBrowseState extends State<_PermissionCatalogBrowse> {
  _ListPhase _phase = _ListPhase.loading;
  List<PosPermission> _items = const [];
  String? _errorMessage;

  bool get _canRead => widget.context.permissions.contains('permission.read');

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    if (!_canRead) return;
    setState(() {
      _phase = _ListPhase.loading;
      _errorMessage = null;
    });
    try {
      final items = await widget.gateway.listPermissions();
      if (!mounted) return;
      setState(() {
        _items = items;
        _phase = items.isEmpty ? _ListPhase.empty : _ListPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _ListPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _ListPhase.failure;
        _errorMessage = 'No fue posible cargar los permisos.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    if (!_canRead) return const _PermissionDenied(permission: 'permission.read');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Selecciona un rol para ver o editar sus permisos',
          style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 15),
        ),
        const SizedBox(height: 4),
        Text(
          'Mientras tanto, este es el catálogo completo de permisos disponibles.',
          style: TextStyle(color: palette.textSecondary, fontSize: 12),
        ),
        const SizedBox(height: 12),
        switch (_phase) {
          _ListPhase.loading => const _Loading(),
          _ListPhase.empty => const _Empty(message: 'El catálogo de permisos está vacío.'),
          _ListPhase.failure => _Failure(
            message: _errorMessage ?? 'No fue posible cargar los permisos.',
            onRetry: () => unawaited(_load()),
          ),
          _ListPhase.ready => _PermissionPicker(
            permissions: _items,
            selectedIds: null,
            actorPermissionCodes: null,
            enabled: false,
            onToggle: null,
          ),
        },
      ],
    );
  }
}

// ---------------------------------------------------------------------
// Sesión actual (TASK 16.31, Phase 13/14/15) — real `AuthenticatedContext`
// data only. The old reference screenshot's "Hora de entrada"/"Equipo"/
// "IP" are deliberately NOT here: confirmed against the real backend
// that no login timestamp, device/station, or IP address is captured
// anywhere (not even in the audit log) — see docs/USERS_EMPLOYEES_UX.md.
// "Cambiar contraseña" is also absent: no endpoint exists to change an
// already-active user's password. "Cambiar usuario rápido" is absent
// too — see this file's own architecture-audit doc for why (the backend
// CAN mint a new session via PIN, but this app's frontend deliberately
// never adopts it as the active session; building that hand-off is a
// real, separate follow-up, not a decorative visual add-on here).
// ---------------------------------------------------------------------

class _SessionTab extends StatefulWidget {
  const _SessionTab({required this.context, required this.gateway, this.onLogout});
  final AuthenticatedContext context;
  final PosIdentityAdminGateway gateway;
  final VoidCallback? onLogout;

  @override
  State<_SessionTab> createState() => _SessionTabState();
}

class _SessionTabState extends State<_SessionTab> {
  PosUserDetail? _detail;
  bool _loadingRole = true;

  @override
  void initState() {
    super.initState();
    unawaited(_loadRole());
  }

  Future<void> _loadRole() async {
    try {
      final detail = await widget.gateway.userDetail(widget.context.session.userId);
      if (!mounted) return;
      setState(() {
        _detail = detail;
        _loadingRole = false;
      });
    } on Object {
      if (!mounted) return;
      // Honest fallback — no `user.read` (or a transient failure) just
      // means the role badge stays omitted; every other field on this
      // tab (name/email/branch/permissions) comes straight from the
      // already-loaded `AuthenticatedContext` and needs no network call
      // at all.
      setState(() => _loadingRole = false);
    }
  }

  String get _initials {
    final parts = widget.context.user.displayName.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    final first = parts.first.characters.first;
    final last = parts.length > 1 ? parts.last.characters.first : '';
    return (first + last).toUpperCase();
  }

  String get _scopeLabel {
    if (widget.context.companyWideAccess) return 'Todas las sucursales';
    return widget.context.currentBranch?.name ?? 'Sin sucursal asignada';
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final roleNames = _detail?.roles.where((r) => r.status == 'active').map((r) => r.roleName).join(', ');
    return LayoutBuilder(
      builder: (context, constraints) {
        final stacked = constraints.maxWidth < 760;
        final userCard = _Card(
          key: const Key('pos-session-user-card'),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Usuario en sesión', style: TextStyle(color: palette.textMuted, fontSize: 11, fontWeight: FontWeight.w800)),
              const SizedBox(height: 12),
              Row(
                children: [
                  CircleAvatar(
                    radius: 26,
                    backgroundColor: palette.actionTint,
                    child: Text(_initials, style: TextStyle(color: palette.blueDeep, fontWeight: FontWeight.w800, fontSize: 18)),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          widget.context.user.displayName,
                          style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
                        ),
                        Text(widget.context.user.email, style: TextStyle(color: palette.textSecondary, fontSize: 12)),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              _DetailRow(
                label: 'Rol',
                value: _loadingRole ? 'Cargando…' : (roleNames == null || roleNames.isEmpty ? 'Sin rol asignado' : roleNames),
              ),
              _DetailRow(label: 'Sucursal', value: _scopeLabel),
              const SizedBox(height: 14),
              Tooltip(
                message: widget.onLogout == null ? 'Cerrar sesión no está disponible en este contexto.' : '',
                child: OutlinedButton.icon(
                  key: const Key('pos-session-logout'),
                  onPressed: widget.onLogout,
                  icon: const Icon(Icons.logout, size: 16),
                  label: const Text('Cerrar sesión'),
                ),
              ),
            ],
          ),
        );
        final permissionsCard = _Card(
          key: const Key('pos-session-permissions-card'),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Mis permisos activos', style: TextStyle(color: palette.textMuted, fontSize: 11, fontWeight: FontWeight.w800)),
              const SizedBox(height: 4),
              Text(
                '${widget.context.permissions.length} permisos otorgados a esta sesión.',
                style: TextStyle(color: palette.textSecondary, fontSize: 12),
              ),
              const SizedBox(height: 10),
              if (widget.context.permissions.isEmpty)
                Text('Sin permisos otorgados.', style: TextStyle(color: palette.textMuted, fontSize: 12))
              else
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final code in widget.context.permissions)
                      Container(
                        key: Key('pos-session-permission-chip-$code'),
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                        decoration: BoxDecoration(color: palette.actionTint, borderRadius: BorderRadius.circular(20)),
                        child: Text(
                          permissionLabel(code),
                          style: TextStyle(color: palette.blueDeep, fontSize: 11.5, fontWeight: FontWeight.w700),
                        ),
                      ),
                  ],
                ),
            ],
          ),
        );
        if (stacked) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [userCard, const SizedBox(height: 16), permissionsCard],
          );
        }
        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(width: 340, child: userCard),
            const SizedBox(width: 16),
            Expanded(child: permissionsCard),
          ],
        );
      },
    );
  }
}

/// The reusable permission picker/browser: groups the real permission
/// catalog by domain (the text before the first `.`, e.g. `sale.create` →
/// `sale`) with a human-readable Spanish label. Two modes:
///  - Browse (`selectedIds == null`): the standalone Permisos tab — every
///    permission is listed with its code/description, no checkbox, purely
///    informational.
///  - Edit (`selectedIds != null`): the Roles tab's "assign permissions"
///    flow — a real checkbox per permission. [enabled] gates the whole
///    picker (`role.permission.manage` AND not a system role); even when
///    [enabled] is true, an individual checkbox stays disabled unless
///    [actorPermissionCodes] contains that permission's own code OR it is
///    already selected — the self-escalation guard this task requires: an
///    actor can freely un-grant a permission it doesn't itself hold (a
///    restriction), but can never grant one it doesn't hold.
class _PermissionPicker extends StatefulWidget {
  const _PermissionPicker({
    required this.permissions,
    required this.selectedIds,
    required this.actorPermissionCodes,
    required this.enabled,
    this.disabledReason,
    this.onToggle,
  });

  final List<PosPermission> permissions;
  final Set<String>? selectedIds;
  final Set<String>? actorPermissionCodes;
  final bool enabled;
  final String? disabledReason;
  final ValueChanged<PosPermission>? onToggle;

  @override
  State<_PermissionPicker> createState() => _PermissionPickerState();
}

class _PermissionPickerState extends State<_PermissionPicker> {
  String _query = '';

  bool get _editable => widget.selectedIds != null;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    // TASK 16.31.3 (Phase 11) — a purely client-side filter over the
    // already-loaded real catalogue (never a new backend call, never a
    // change to what's actually granted/grantable). Matches the
    // commercial label or the raw technical code.
    final query = _query.trim().toLowerCase();
    final visible = query.isEmpty
        ? widget.permissions
        : widget.permissions
              .where(
                (p) => permissionLabel(p.code).toLowerCase().contains(query) || p.code.toLowerCase().contains(query),
              )
              .toList(growable: false);
    final grouped = <String, List<PosPermission>>{};
    for (final permission in visible) {
      grouped.putIfAbsent(permission.domain, () => []).add(permission);
    }
    final domains = grouped.keys.toList(growable: false)..sort();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_editable && !widget.enabled && widget.disabledReason != null && widget.disabledReason!.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(widget.disabledReason!, style: TextStyle(color: palette.warning, fontSize: 11)),
          ),
        if (widget.permissions.length > 8)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: TextField(
              key: const Key('pos-permission-search'),
              onChanged: (value) => setState(() => _query = value),
              decoration: const InputDecoration(isDense: true, hintText: 'Buscar permiso…', prefixIcon: Icon(Icons.search, size: 16)),
            ),
          ),
        if (domains.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Text('Sin coincidencias.', style: TextStyle(color: palette.textMuted, fontSize: 12)),
          ),
        for (final domain in domains)
          _PermissionDomainSection(
            domain: domain,
            permissions: grouped[domain]!,
            selectedIds: widget.selectedIds,
            actorPermissionCodes: widget.actorPermissionCodes,
            enabled: widget.enabled,
            onToggle: widget.onToggle,
          ),
      ],
    );
  }
}

/// TASK 16.31.3 (Phase 7) — replaces the old collapsed-by-default
/// `ExpansionTile` accordion: a compact, ALWAYS-VISIBLE section (a small
/// header + a divider, never a card the user must tap open) so every
/// permission in the loaded catalogue is scannable without interaction —
/// the density this task's own Phase 5/12 explicitly asks for. Domain
/// grouping itself is preserved (Phase 7's own "keep the organization,
/// lose the accordion").
class _PermissionDomainSection extends StatelessWidget {
  const _PermissionDomainSection({
    required this.domain,
    required this.permissions,
    required this.selectedIds,
    required this.actorPermissionCodes,
    required this.enabled,
    required this.onToggle,
  });

  final String domain;
  final List<PosPermission> permissions;
  final Set<String>? selectedIds;
  final Set<String>? actorPermissionCodes;
  final bool enabled;
  final ValueChanged<PosPermission>? onToggle;

  bool get _editable => selectedIds != null;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final selectedCount = _editable ? permissions.where((p) => selectedIds!.contains(p.id)).length : 0;
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        key: Key('pos-permission-domain-$domain'),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Text(
                permissionCategoryLabel(domain).toUpperCase(),
                style: TextStyle(color: palette.textSecondary, fontWeight: FontWeight.w800, fontSize: 11, letterSpacing: .4),
              ),
              if (_editable) ...[
                const SizedBox(width: 6),
                Text('$selectedCount/${permissions.length}', style: TextStyle(color: palette.textMuted, fontSize: 10.5)),
              ],
            ],
          ),
          Padding(padding: const EdgeInsets.symmetric(vertical: 4), child: Divider(height: 1, color: palette.border)),
          LayoutBuilder(
            builder: (context, constraints) {
              // Phase 15 — two columns on desktop/medium width, one
              // column narrow enough that two would crush the label.
              if (constraints.maxWidth < 520) {
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [for (final permission in permissions) _PermissionSwitchRow(permission: permission, picker: this)],
                );
              }
              final left = <PosPermission>[];
              final right = <PosPermission>[];
              for (var i = 0; i < permissions.length; i++) {
                (i.isEven ? left : right).add(permissions[i]);
              }
              return Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [for (final permission in left) _PermissionSwitchRow(permission: permission, picker: this)],
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [for (final permission in right) _PermissionSwitchRow(permission: permission, picker: this)],
                    ),
                  ),
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}

/// TASK 16.31.3 (Phase 8) — one compact, single-line-label permission
/// row. The full commercial description (a whole sentence) that used to
/// render unconditionally under every row was the single biggest
/// consumer of vertical space in the old accordion layout — it is now a
/// long-press/hover `Tooltip` on the row instead of always-visible text,
/// so the density target is met by BETTER LAYOUT, never smaller
/// typography (the label itself keeps its original font size). The
/// short "Código técnico: <code>" caption stays directly visible
/// (unlike the description) — it is what a support conversation or a
/// developer actually needs to reference, and existing tests already
/// depend on it being real, findable text.
class _PermissionSwitchRow extends StatelessWidget {
  const _PermissionSwitchRow({required this.permission, required this.picker});
  final PosPermission permission;
  final _PermissionDomainSection picker;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    // TASK 16.31.5 — the raw technical code is real, useful data (worth
    // keeping reachable — e.g. for a support conversation or cross-
    // referencing the API), but no longer consumes its own permanently-
    // visible line: it now lives in the SAME hover/long-press Tooltip as
    // the commercial description, right below it. The single visible
    // label line is what drives the real density gain here.
    final label = Tooltip(
      message: '${permissionDescription(permission.code)}\n\nCódigo técnico: ${permission.code}',
      child: Text(
        permissionLabel(permission.code),
        key: Key('pos-permission-row-${permission.id}'),
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(color: palette.text, fontSize: 12.5, fontWeight: FontWeight.w600),
      ),
    );
    if (picker.selectedIds == null) {
      return Padding(padding: const EdgeInsets.symmetric(vertical: 7), child: label);
    }
    final isChecked = picker.selectedIds!.contains(permission.id);
    final actorHasIt = picker.actorPermissionCodes?.contains(permission.code) ?? false;
    final switchEnabled = picker.enabled && (actorHasIt || isChecked);
    final reason = !picker.enabled
        ? ''
        : (!switchEnabled ? 'Tu sesión no tiene el permiso ${permission.code} — no puedes otorgarlo.' : '');
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(
        children: [
          Expanded(child: label),
          const SizedBox(width: 6),
          Tooltip(
            message: reason,
            // TASK 16.31.5 (Phase 12) — visually smaller/more refined
            // than a default Material switch (matching the reference's
            // own compact control scale), while `shrinkWrap` (not a
            // further-shrunk custom hit box) keeps a reasonable tap
            // area around the visibly smaller track/thumb.
            child: Transform.scale(
              scale: 0.82,
              child: Switch(
                key: Key('pos-permission-checkbox-${permission.id}'),
                value: isChecked,
                onChanged: switchEnabled ? (_) => picker.onToggle?.call(permission) : null,
                materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
