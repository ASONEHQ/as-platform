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
    super.key,
  });

  final AuthenticatedContext context;
  final PosIdentityAdminGateway gateway;
  final PosOperationalAreasGateway areasGateway;
  final PosCashGateway cashGateway;

  @override
  State<PosUserAdministrationScreen> createState() => _PosUserAdministrationScreenState();
}

enum _AdminTab { usuarios, roles, permisos }

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
        _AdminTab.roles => _RolesTab(context: widget.context, gateway: widget.gateway),
        _AdminTab.permisos => _PermissionsTab(context: widget.context, gateway: widget.gateway),
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
                Text('Usuarios y permisos', style: TextStyle(color: palette.text, fontSize: 22, fontWeight: FontWeight.w800)),
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
            segments: const [
              ButtonSegment(value: _AdminTab.usuarios, label: Text('Usuarios')),
              ButtonSegment(value: _AdminTab.roles, label: Text('Roles')),
              ButtonSegment(value: _AdminTab.permisos, label: Text('Permisos')),
            ],
            selected: {tab},
            onSelectionChanged: (value) => onTabChanged(value.first),
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
      child: Text(label, style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.w800)),
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
  String? _errorMessage;
  String _query = '';

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
      if (!mounted) return;
      setState(() {
        _items = items;
        _phase = _visibleItems.isEmpty ? _ListPhase.empty : _ListPhase.ready;
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
        _errorMessage = 'No fue posible cargar los usuarios.';
      });
    }
  }

  List<PosUser> get _visibleItems {
    final query = _query.trim().toLowerCase();
    if (query.isEmpty) return _items;
    return _items
        .where(
          (user) => user.displayName.toLowerCase().contains(query) || user.email.toLowerCase().contains(query),
        )
        .toList(growable: false);
  }

  Future<void> _openNewForm() async {
    if (!_canCreate) return;
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _UserFormDialog(gateway: widget.gateway),
    );
    if (saved == true) unawaited(_load());
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

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    if (!_canRead) return const _PermissionDenied(permission: 'user.read');
    final newDisabledReason = _canCreate ? '' : 'Se requiere el permiso user.create.';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: TextField(
                key: const Key('pos-users-search'),
                onChanged: (value) => setState(() {
                  _query = value;
                  if (_items.isNotEmpty) {
                    _phase = _visibleItems.isEmpty ? _ListPhase.empty : _ListPhase.ready;
                  }
                }),
                decoration: const InputDecoration(isDense: true, hintText: 'Buscar por nombre o correo', prefixIcon: Icon(Icons.search)),
              ),
            ),
            const SizedBox(width: 10),
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
          _ListPhase.empty => const _Empty(message: 'No hay usuarios registrados.'),
          _ListPhase.failure => _Failure(
            message: _errorMessage ?? 'No fue posible cargar los usuarios.',
            onRetry: () => unawaited(_load()),
          ),
          _ListPhase.ready => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final user in _visibleItems) _UserRow(user: user, onTap: () => unawaited(_openDetail(user))),
            ],
          ),
        },
      ],
    );
  }
}

class _UserRow extends StatelessWidget {
  const _UserRow({required this.user, required this.onTap});
  final PosUser user;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return _Card(
      key: Key('pos-user-row-${user.id}'),
      padding: EdgeInsets.zero,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(user.displayName, style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13)),
                    const SizedBox(height: 2),
                    Text(user.email, style: TextStyle(color: palette.textSecondary, fontSize: 11)),
                  ],
                ),
              ),
              _StatusPill(label: user.membershipStatus),
              const SizedBox(width: 8),
              Icon(Icons.chevron_right, size: 18, color: palette.textMuted),
            ],
          ),
        ),
      ),
    );
  }
}

/// New-user dialog — only ever reachable through an already-`user.create`-
/// gated entry point, mirrors `_EmployeeFormDialog`'s own convention of
/// carrying no separate internal permission gate.
class _UserFormDialog extends StatefulWidget {
  const _UserFormDialog({required this.gateway});
  final PosIdentityAdminGateway gateway;

  @override
  State<_UserFormDialog> createState() => _UserFormDialogState();
}

class _UserFormDialogState extends State<_UserFormDialog> {
  final _emailController = TextEditingController();
  final _nameController = TextEditingController();
  bool _busy = false;
  String? _error;

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
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.gateway.createUser(email: email, displayName: name);
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
        _error = 'No fue posible crear el usuario.';
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
              Text('Nuevo usuario', style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16)),
              const SizedBox(height: 4),
              Text(
                'El usuario se crea invitado. Actívalo desde su ficha para asignarle una contraseña.',
                style: TextStyle(color: palette.textSecondary, fontSize: 11),
              ),
              const SizedBox(height: 14),
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
              if (_error != null) ...[
                const SizedBox(height: 10),
                Text(_error!, key: const Key('pos-user-form-error'), style: TextStyle(color: palette.error, fontSize: 12)),
              ],
              const SizedBox(height: 16),
              _DialogButtons(
                busy: _busy,
                onCancel: () => Navigator.of(context).pop(false),
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
                      '${_branchLabel(grant.branchId)} · '
                      '${grant.operationalAreaId != null ? 'área ${grant.operationalAreaId}' : 'caja ${grant.cashRegisterId}'}',
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

class _RolesTabState extends State<_RolesTab> {
  _ListPhase _phase = _ListPhase.loading;
  List<PosRole> _items = const [];
  String? _errorMessage;

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
    final saved = await showDialog<bool>(context: context, builder: (dialogContext) => _RoleFormDialog(gateway: widget.gateway));
    if (saved == true) unawaited(_load());
  }

  Future<void> _openDetail(PosRole role) async {
    final changed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _RoleDetailDialog(
        role: role,
        gateway: widget.gateway,
        actorPermissions: widget.context.permissions,
        canUpdate: _canUpdate,
        canManagePermissions: _canManagePermissions,
      ),
    );
    if (changed == true) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    if (!_canRead) return const _PermissionDenied(permission: 'role.read');
    final newDisabledReason = _canCreate ? '' : 'Se requiere el permiso role.create.';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Align(
          alignment: Alignment.centerRight,
          child: Tooltip(
            message: newDisabledReason,
            child: FilledButton.icon(
              key: const Key('pos-roles-new'),
              onPressed: newDisabledReason.isEmpty ? () => unawaited(_openNewForm()) : null,
              style: FilledButton.styleFrom(backgroundColor: palette.action),
              icon: const Icon(Icons.add_moderator_outlined, size: 16),
              label: const Text('Nuevo rol'),
            ),
          ),
        ),
        const SizedBox(height: 12),
        switch (_phase) {
          _ListPhase.loading => const _Loading(),
          _ListPhase.empty => const _Empty(message: 'No hay roles registrados.'),
          _ListPhase.failure => _Failure(
            message: _errorMessage ?? 'No fue posible cargar los roles.',
            onRetry: () => unawaited(_load()),
          ),
          _ListPhase.ready => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [for (final role in _items) _RoleRow(role: role, onTap: () => unawaited(_openDetail(role)))],
          ),
        },
      ],
    );
  }
}

class _RoleRow extends StatelessWidget {
  const _RoleRow({required this.role, required this.onTap});
  final PosRole role;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return _Card(
      key: Key('pos-role-row-${role.id}'),
      padding: EdgeInsets.zero,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(role.name, style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13)),
                        if (role.isSystem) ...[
                          const SizedBox(width: 6),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(color: palette.blueTint, borderRadius: BorderRadius.circular(20)),
                            child: Text('Sistema', style: TextStyle(color: palette.blueDeep, fontSize: 9, fontWeight: FontWeight.w800)),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(role.code, style: TextStyle(color: palette.textSecondary, fontSize: 11)),
                  ],
                ),
              ),
              _StatusPill(label: role.status),
              const SizedBox(width: 8),
              Icon(Icons.chevron_right, size: 18, color: palette.textMuted),
            ],
          ),
        ),
      ),
    );
  }
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
      await widget.gateway.createRole(name: name, code: code, description: description.isEmpty ? null : description);
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
                onCancel: () => Navigator.of(context).pop(false),
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
  });

  final PosRole role;
  final PosIdentityAdminGateway gateway;
  final List<String> actorPermissions;
  final bool canUpdate;
  final bool canManagePermissions;

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
      setState(() {
        _allPermissions = all;
        _selectedPermissionIds = Set.of(ids);
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
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560, maxHeight: 720),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(child: Text(_role.name, style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16))),
                    IconButton(
                      key: const Key('pos-role-detail-close'),
                      tooltip: 'Cerrar',
                      onPressed: () => Navigator.of(context).pop(_changed),
                      icon: Icon(Icons.close, color: palette.textMuted, size: 18),
                    ),
                  ],
                ),
                if (_role.isSystem)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Text(_systemTooltip, style: TextStyle(color: palette.warning, fontSize: 11)),
                  ),
                TextField(
                  key: const Key('pos-role-detail-name'),
                  controller: _nameController,
                  enabled: _editable,
                  decoration: const InputDecoration(isDense: true, labelText: 'Nombre'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-role-detail-description'),
                  controller: _descriptionController,
                  enabled: _editable,
                  maxLines: 2,
                  decoration: const InputDecoration(isDense: true, labelText: 'Descripción'),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
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
                const Divider(height: 28),
                Text('Permisos', style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13)),
                const SizedBox(height: 8),
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
            ),
          ),
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
// ---------------------------------------------------------------------

class _PermissionsTab extends StatefulWidget {
  const _PermissionsTab({required this.context, required this.gateway});
  final AuthenticatedContext context;
  final PosIdentityAdminGateway gateway;

  @override
  State<_PermissionsTab> createState() => _PermissionsTabState();
}

class _PermissionsTabState extends State<_PermissionsTab> {
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
    if (!_canRead) return const _PermissionDenied(permission: 'permission.read');
    return switch (_phase) {
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
    };
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
class _PermissionPicker extends StatelessWidget {
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

  bool get _editable => selectedIds != null;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final grouped = <String, List<PosPermission>>{};
    for (final permission in permissions) {
      grouped.putIfAbsent(permission.domain, () => []).add(permission);
    }
    final domains = grouped.keys.toList(growable: false)..sort();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_editable && !enabled && disabledReason != null && disabledReason!.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(disabledReason!, style: TextStyle(color: palette.warning, fontSize: 11)),
          ),
        for (final domain in domains)
          _PermissionDomainGroup(
            domain: domain,
            permissions: grouped[domain]!,
            selectedIds: selectedIds,
            actorPermissionCodes: actorPermissionCodes,
            enabled: enabled,
            onToggle: onToggle,
          ),
      ],
    );
  }
}

class _PermissionDomainGroup extends StatelessWidget {
  const _PermissionDomainGroup({
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
    return Card(
      key: Key('pos-permission-domain-$domain'),
      margin: const EdgeInsets.only(bottom: 8),
      color: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10), side: BorderSide(color: palette.border)),
      child: ExpansionTile(
        title: Text(
          _editable ? '${_domainLabel(domain)} ($selectedCount/${permissions.length})' : _domainLabel(domain),
          style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13),
        ),
        subtitle: Text(domain, style: TextStyle(color: palette.textMuted, fontSize: 10)),
        children: [for (final permission in permissions) _PermissionRow(permission: permission, picker: this)],
      ),
    );
  }
}

class _PermissionRow extends StatelessWidget {
  const _PermissionRow({required this.permission, required this.picker});
  final PosPermission permission;
  final _PermissionDomainGroup picker;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    if (picker.selectedIds == null) {
      return ListTile(
        key: Key('pos-permission-row-${permission.id}'),
        dense: true,
        title: Text(permission.code, style: TextStyle(color: palette.text, fontSize: 12, fontWeight: FontWeight.w700)),
        subtitle: permission.description == null
            ? null
            : Text(permission.description!, style: TextStyle(color: palette.textSecondary, fontSize: 11)),
      );
    }
    final isChecked = picker.selectedIds!.contains(permission.id);
    final actorHasIt = picker.actorPermissionCodes?.contains(permission.code) ?? false;
    final checkboxEnabled = picker.enabled && (actorHasIt || isChecked);
    final tooltip = !picker.enabled
        ? ''
        : (!checkboxEnabled ? 'Tu sesión no tiene el permiso ${permission.code} — no puedes otorgarlo.' : '');
    return Tooltip(
      message: tooltip,
      child: CheckboxListTile(
        key: Key('pos-permission-checkbox-${permission.id}'),
        dense: true,
        value: isChecked,
        onChanged: checkboxEnabled ? (_) => picker.onToggle?.call(permission) : null,
        controlAffinity: ListTileControlAffinity.leading,
        title: Text(permission.code, style: TextStyle(color: palette.text, fontSize: 12, fontWeight: FontWeight.w700)),
        subtitle: permission.description == null
            ? null
            : Text(permission.description!, style: TextStyle(color: palette.textSecondary, fontSize: 11)),
      ),
    );
  }
}

const Map<String, String> _domainLabels = {
  'company': 'Empresa',
  'company_settings': 'Configuración de empresa',
  'branch': 'Sucursales',
  'branch_settings': 'Configuración de sucursal',
  'user': 'Usuarios',
  'role': 'Roles',
  'permission': 'Permisos',
  'branch_access': 'Acceso a sucursales',
  'device': 'Dispositivos',
  'cash_register': 'Cajas registradoras',
  'cash_session': 'Turnos de caja',
  'cash_movement': 'Movimientos de caja',
  'catalog': 'Catálogo',
  'category': 'Categorías',
  'product': 'Productos',
  'price': 'Precios',
  'availability': 'Disponibilidad',
  'inventory': 'Inventario',
  'sale': 'Ventas',
  'payment': 'Pagos',
  'refund': 'Reembolsos',
  'promotion': 'Promociones',
  'coupon': 'Cupones',
  'discount': 'Descuentos',
  'customer': 'Clientes',
  'membership': 'Membresías',
  'loyalty': 'Lealtad',
  'reward': 'Recompensas',
  'sync': 'Sincronización',
  'audit': 'Auditoría',
  'recovery': 'Recuperación',
  'party': 'Fiestas',
  'held_sale': 'Ventas en espera',
  'purchase': 'Compras',
  'employee': 'Empleados',
  'schedule': 'Horarios',
  'attendance': 'Checador',
  'payroll': 'Nómina',
  'supplier': 'Proveedores',
  'report': 'Reportes',
  'access': 'Accesos',
  'staff_credential': 'Credenciales de personal',
};

/// A human-readable Spanish label for a permission's [domain] (the text
/// before its first `.`, e.g. `sale.create` → `sale` → "Ventas"). Every
/// domain [packages/database/src/seeds/technical-permissions.ts] defines
/// today is covered by [_domainLabels]; an unknown future domain falls
/// back to a capitalized version of the raw string — never a blank or a
/// thrown error, since this catalog is server-authoritative and may grow.
String _domainLabel(String domain) {
  final label = _domainLabels[domain];
  if (label != null) return label;
  if (domain.isEmpty) return domain;
  return domain[0].toUpperCase() + domain.substring(1).replaceAll('_', ' ');
}
