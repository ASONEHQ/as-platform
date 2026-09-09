/// TASK 15.1 (commercial admin UX closure) — "Sucursales" screen: a real
/// branch list (create + edit), closing the gap `docs/RC_RELEASE_INVENTORY
/// .md`'s TENANT section documented: `GET/POST /api/v1/companies/{id}/
/// branches` and `GET/PATCH /api/v1/branches/{id}` were real, permission-
/// gated, tenant-scoped, DB-backed backend capabilities with no Flutter
/// admin surface at all — `BranchSelectionScreen`
/// (`apps/one/lib/features/authentication/screens.dart`) only ever READS/
/// selects an already-existing branch at login time. A commercial park
/// owner opening a second location previously had no way to create one
/// from the product UI.
///
/// Structural template: `pos_suppliers_screen.dart`'s own list + "+ Nueva"
/// create/edit dialog + row-tap detail dialog shape (TASK 14.4, Wave 2) —
/// deliberately a STANDALONE public file, not embedded in `pos_shell.dart`
/// (another part of this same task wires this screen into
/// `pos_shell.dart`/`pos_navigation.dart` afterward, sequentially, to avoid
/// collisions — see this task's own constraints), so every visual building
/// block here is its own small private widget, styled directly off the
/// public [PosPalette] (`pos_tokens.dart`), matching `pos_suppliers_screen
/// .dart`'s exact rationale for staying standalone.
///
/// Diverges from `pos_suppliers_screen.dart` only where the real branch
/// contract itself does (see `pos_branch_admin_gateway.dart`'s own header):
///   * No search box and no status filter dropdown at the list level — the
///     `GET .../branches` route accepts no querystring filters at all
///     (unlike suppliers' `status`), so there is nothing honest to filter
///     by; the full permitted list is always shown.
///   * No "load more" — the list route returns every permitted branch in
///     one response, no pagination.
///   * No deactivate action in the detail dialog — there is no dedicated
///     deactivate endpoint for branches (unlike suppliers' own
///     `POST .../deactivate`); a status change (`active`/`inactive`/
///     `closed`) is just one more field on the same edit form, gated the
///     same as every other edit, on `branch.update`.
///   * Two distinct write permissions gate two distinct actions —
///     `branch.create` gates "Nueva sucursal", `branch.update` gates
///     "Editar" in the detail dialog — never a single combined permission
///     the way `supplier.manage` covers both create and edit.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/networking/api_client.dart';
import '../authentication/auth_models.dart';
import 'pos_branch_admin_gateway.dart';
import 'pos_tokens.dart';

enum _BranchListPhase { loading, empty, failure, ready }

/// The public "Sucursales" module screen. Constructed with the real
/// [AuthenticatedContext] and a real [PosBranchAdminGateway].
class PosBranchAdminScreen extends StatefulWidget {
  const PosBranchAdminScreen({required this.context, required this.branchAdminGateway, super.key});

  final AuthenticatedContext context;
  final PosBranchAdminGateway branchAdminGateway;

  @override
  State<PosBranchAdminScreen> createState() => _PosBranchAdminScreenState();
}

class _PosBranchAdminScreenState extends State<PosBranchAdminScreen> {
  _BranchListPhase _phase = _BranchListPhase.loading;
  List<PosBranch> _items = const [];
  String? _errorMessage;

  bool get _canRead => widget.context.permissions.contains('branch.read');
  bool get _canCreate => widget.context.permissions.contains('branch.create');
  bool get _canUpdate => widget.context.permissions.contains('branch.update');

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  // Mirrors `pos_suppliers_screen.dart`'s own `_load` guard exactly: a
  // missing `branch.read` never calls the gateway at all, and `build`
  // renders the honest [_BranchPermissionState] by checking `_canRead`
  // directly rather than through `_phase`.
  Future<void> _load() async {
    if (!_canRead) return;
    setState(() {
      _phase = _BranchListPhase.loading;
      _errorMessage = null;
    });
    try {
      final items = await widget.branchAdminGateway.listBranches(companyId: widget.context.session.companyId);
      if (!mounted) return;
      setState(() {
        _items = items;
        _phase = items.isEmpty ? _BranchListPhase.empty : _BranchListPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _BranchListPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _BranchListPhase.failure;
        _errorMessage = 'No fue posible cargar las sucursales.';
      });
    }
  }

  Future<void> _openNewBranchForm() async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _BranchFormDialog(
        companyId: widget.context.session.companyId,
        branchAdminGateway: widget.branchAdminGateway,
      ),
    );
    if (saved == true) unawaited(_load());
  }

  Future<void> _openDetail(PosBranch branch) async {
    final changed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _BranchDetailDialog(
        branch: branch,
        canUpdate: _canUpdate,
        companyId: widget.context.session.companyId,
        branchAdminGateway: widget.branchAdminGateway,
      ),
    );
    if (changed == true) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Sucursales',
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 20),
                ),
              ),
              IconButton(
                key: const Key('pos-branch-admin-refresh'),
                tooltip: 'Actualizar',
                onPressed: () => unawaited(_load()),
                icon: Icon(Icons.refresh, color: palette.textSecondary),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Sucursales de la empresa — alta y edición.',
            style: TextStyle(color: palette.textSecondary, fontSize: 13),
          ),
          const SizedBox(height: 16),
          if (!_canRead)
            const _BranchPermissionState()
          else ...[
            Align(
              alignment: Alignment.centerRight,
              child: Tooltip(
                message: _canCreate ? 'Nueva sucursal' : 'Tu sesión no incluye el permiso branch.create.',
                child: FilledButton.icon(
                  key: const Key('pos-branch-admin-new'),
                  onPressed: _canCreate ? () => unawaited(_openNewBranchForm()) : null,
                  style: FilledButton.styleFrom(backgroundColor: palette.action),
                  icon: const Icon(Icons.add_business_outlined, size: 16),
                  label: const Text('Nueva'),
                ),
              ),
            ),
            const SizedBox(height: 14),
            switch (_phase) {
              _BranchListPhase.loading => const _BranchLoadingState(),
              _BranchListPhase.empty => const _BranchEmptyState(),
              _BranchListPhase.failure => _BranchFailureState(
                message: _errorMessage ?? 'No fue posible cargar las sucursales.',
                onRetry: () => unawaited(_load()),
              ),
              _BranchListPhase.ready => Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final branch in _items)
                    _BranchRow(branch: branch, onTap: () => unawaited(_openDetail(branch))),
                ],
              ),
            },
          ],
        ],
      ),
    );
  }
}

class _BranchRow extends StatelessWidget {
  const _BranchRow({required this.branch, required this.onTap});
  final PosBranch branch;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Card(
      key: Key('pos-branch-admin-row-${branch.id}'),
      margin: const EdgeInsets.only(bottom: 8),
      color: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: palette.border)),
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
                    Text(
                      branch.name,
                      style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${branch.code} · ${branch.timezone}',
                      style: TextStyle(color: palette.textSecondary, fontSize: 12),
                    ),
                  ],
                ),
              ),
              _BranchStatusChip(status: branch.status),
              const SizedBox(width: 8),
              Icon(Icons.chevron_right, size: 18, color: palette.textMuted),
            ],
          ),
        ),
      ),
    );
  }
}

class _BranchStatusChip extends StatelessWidget {
  const _BranchStatusChip({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final active = status == 'active';
    final color = active ? palette.success : palette.textMuted;
    final label = switch (status) {
      'active' => 'Activa',
      'inactive' => 'Inactiva',
      'closed' => 'Cerrada',
      _ => status,
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: color.withValues(alpha: .12), borderRadius: BorderRadius.circular(20)),
      child: Text(label, style: TextStyle(color: color, fontWeight: FontWeight.w700, fontSize: 11)),
    );
  }
}

/// New/edit branch dialog — `código`/`nombre`/`zona horaria` are required
/// on create (mirroring `branches.routes.ts`'s own create body schema);
/// `estado` only appears when editing an existing branch (creation always
/// starts `active` server-side, per `createBranch`'s own hardcoded insert).
class _BranchFormDialog extends StatefulWidget {
  const _BranchFormDialog({required this.companyId, required this.branchAdminGateway, this.existing});
  final String companyId;
  final PosBranchAdminGateway branchAdminGateway;
  final PosBranch? existing;

  @override
  State<_BranchFormDialog> createState() => _BranchFormDialogState();
}

class _BranchFormDialogState extends State<_BranchFormDialog> {
  late final _codeController = TextEditingController(text: widget.existing?.code ?? '');
  late final _nameController = TextEditingController(text: widget.existing?.name ?? '');
  late final _timezoneController = TextEditingController(text: widget.existing?.timezone ?? '');
  late String _status = widget.existing?.status ?? 'active';
  bool _busy = false;
  String? _error;

  bool get _isEdit => widget.existing != null;

  @override
  void dispose() {
    _codeController.dispose();
    _nameController.dispose();
    _timezoneController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final code = _codeController.text.trim();
    final name = _nameController.text.trim();
    final timezone = _timezoneController.text.trim();
    if (code.isEmpty || name.isEmpty || timezone.isEmpty) {
      setState(() => _error = 'Código, nombre y zona horaria son obligatorios.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final input = PosBranchInput(
      code: code,
      name: name,
      timezone: timezone,
      status: _isEdit ? _status : null,
    );
    try {
      if (_isEdit) {
        await widget.branchAdminGateway.updateBranch(widget.existing!.id, input);
      } else {
        await widget.branchAdminGateway.createBranch(companyId: widget.companyId, input: input);
      }
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
        _error = 'No fue posible guardar la sucursal.';
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
          constraints: const BoxConstraints(maxWidth: 420, maxHeight: 560),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  _isEdit ? 'Editar sucursal' : 'Nueva sucursal',
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
                ),
                const SizedBox(height: 14),
                TextField(
                  key: const Key('pos-branch-admin-form-code'),
                  controller: _codeController,
                  decoration: const InputDecoration(isDense: true, labelText: 'Código'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-branch-admin-form-name'),
                  controller: _nameController,
                  decoration: const InputDecoration(isDense: true, labelText: 'Nombre'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-branch-admin-form-timezone'),
                  controller: _timezoneController,
                  decoration: const InputDecoration(
                    isDense: true,
                    labelText: 'Zona horaria',
                    hintText: 'Ej. America/Mexico_City',
                  ),
                ),
                if (_isEdit) ...[
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    key: const Key('pos-branch-admin-form-status'),
                    initialValue: _status,
                    isExpanded: true,
                    decoration: const InputDecoration(isDense: true, labelText: 'Estado'),
                    items: const [
                      DropdownMenuItem(value: 'active', child: Text('Activa')),
                      DropdownMenuItem(value: 'inactive', child: Text('Inactiva')),
                      DropdownMenuItem(value: 'closed', child: Text('Cerrada')),
                    ],
                    onChanged: (value) => setState(() => _status = value ?? 'active'),
                  ),
                ],
                if (_error != null) ...[
                  const SizedBox(height: 10),
                  Text(
                    _error!,
                    key: const Key('pos-branch-admin-form-error'),
                    style: TextStyle(color: palette.error, fontSize: 12),
                  ),
                ],
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        key: const Key('pos-branch-admin-form-cancel'),
                        onPressed: () => Navigator.of(context).pop(false),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: palette.textSecondary,
                          side: BorderSide(color: palette.border),
                        ),
                        child: const Text('Cancelar'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: FilledButton(
                        key: const Key('pos-branch-admin-form-save'),
                        onPressed: _busy ? null : () => unawaited(_submit()),
                        style: FilledButton.styleFrom(backgroundColor: palette.action),
                        child: _busy
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                              )
                            : const Text('Guardar'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Branch detail — the full record plus a single Editar action, gated on
/// the real `branch.update` permission (never merely hidden by a
/// client-side guess — stays visible-but-disabled with a [Tooltip]
/// explaining why, mirroring `pos_suppliers_screen.dart`'s
/// `_SupplierDetailDialog` own established disabled+[Tooltip] pattern).
class _BranchDetailDialog extends StatefulWidget {
  const _BranchDetailDialog({
    required this.branch,
    required this.canUpdate,
    required this.companyId,
    required this.branchAdminGateway,
  });
  final PosBranch branch;
  final bool canUpdate;
  final String companyId;
  final PosBranchAdminGateway branchAdminGateway;

  @override
  State<_BranchDetailDialog> createState() => _BranchDetailDialogState();
}

class _BranchDetailDialogState extends State<_BranchDetailDialog> {
  late PosBranch _branch = widget.branch;
  bool _changed = false;

  Future<void> _edit() async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _BranchFormDialog(
        companyId: widget.companyId,
        branchAdminGateway: widget.branchAdminGateway,
        existing: _branch,
      ),
    );
    if (saved != true || !mounted) return;
    setState(() => _changed = true);
    try {
      final refreshed = await widget.branchAdminGateway.branch(_branch.id);
      if (!mounted) return;
      setState(() => _branch = refreshed);
    } on Object {
      // The edit itself already succeeded — a failed refresh here just
      // means the dialog keeps showing the pre-edit snapshot; the caller
      // still reloads the real list on close via `_changed`, mirroring
      // `pos_suppliers_screen.dart`'s `_SupplierDetailDialog._edit`.
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final branch = _branch;
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
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        branch.name,
                        key: const Key('pos-branch-admin-detail-name'),
                        style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
                      ),
                    ),
                    _BranchStatusChip(status: branch.status),
                  ],
                ),
                const SizedBox(height: 14),
                _BranchDetailField(label: 'Código', value: branch.code),
                _BranchDetailField(label: 'Zona horaria', value: branch.timezone),
                const SizedBox(height: 4),
                Text(
                  'Creada ${_formatTimestamp(branch.createdAt)} · Actualizada ${_formatTimestamp(branch.updatedAt)}',
                  style: TextStyle(color: palette.textMuted, fontSize: 11),
                ),
                const SizedBox(height: 16),
                Tooltip(
                  message: widget.canUpdate ? 'Editar sucursal' : 'Tu sesión no incluye el permiso branch.update.',
                  child: OutlinedButton.icon(
                    key: const Key('pos-branch-admin-detail-edit'),
                    onPressed: widget.canUpdate ? () => unawaited(_edit()) : null,
                    icon: const Icon(Icons.edit_outlined, size: 16),
                    label: const Text('Editar'),
                  ),
                ),
                const SizedBox(height: 10),
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton(
                    key: const Key('pos-branch-admin-detail-close'),
                    onPressed: () => Navigator.of(context).pop(_changed),
                    child: const Text('Cerrar'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _BranchDetailField extends StatelessWidget {
  const _BranchDetailField({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 140,
            child: Text(label, style: TextStyle(color: palette.textSecondary, fontSize: 12, fontWeight: FontWeight.w600)),
          ),
          Expanded(child: Text(value, style: TextStyle(color: palette.text, fontSize: 13))),
        ],
      ),
    );
  }
}

class _BranchLoadingState extends StatelessWidget {
  const _BranchLoadingState();
  @override
  Widget build(BuildContext context) => const Padding(
    padding: EdgeInsets.symmetric(vertical: 40),
    child: Center(child: CircularProgressIndicator()),
  );
}

class _BranchEmptyState extends StatelessWidget {
  const _BranchEmptyState();
  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 40),
      child: Center(
        child: Text('No hay sucursales registradas.', style: TextStyle(color: palette.textMuted, fontSize: 13)),
      ),
    );
  }
}

class _BranchFailureState extends StatelessWidget {
  const _BranchFailureState({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 32),
      child: Center(
        child: Column(
          children: [
            Text(message, style: TextStyle(color: palette.error, fontSize: 13)),
            const SizedBox(height: 10),
            OutlinedButton(onPressed: onRetry, child: const Text('Reintentar')),
          ],
        ),
      ),
    );
  }
}

class _BranchPermissionState extends StatelessWidget {
  const _BranchPermissionState();
  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 40),
      child: Center(
        child: Column(
          children: [
            Icon(Icons.lock_outline, color: palette.textMuted, size: 28),
            const SizedBox(height: 8),
            Text(
              'Tu sesión no incluye el permiso de lectura requerido (branch.read).',
              style: TextStyle(color: palette.textMuted, fontSize: 13),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

String _formatTimestamp(DateTime value) {
  final local = value.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(local.day)}/${two(local.month)}/${local.year} ${two(local.hour)}:${two(local.minute)}';
}
