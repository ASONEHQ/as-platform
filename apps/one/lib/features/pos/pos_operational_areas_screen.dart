/// TASK 16.15 — "Áreas Operativas" admin screen: real, branch-scoped
/// operational-area list/create/rename/activate-deactivate
/// (`GET/POST /api/v1/operational-areas`, `GET/PUT /api/v1/operational-
/// areas/{id}`).
///
/// An operational area is entirely TENANT-DEFINED data — one tenant's own
/// "Admisiones/Alimentos/Eventos", another's "Taquilla/Cafetería/Eventos",
/// a third tenant's own entirely different set. Every name/code shown here
/// comes straight from [PosOperationalArea]/the create-area form's own
/// text fields — this file never hardcodes a specific area name anywhere.
///
/// Structural template: `pos_category_admin_gateway.dart`'s own screen
/// shape (list + status filter + "+ Nueva" create/edit dialog, real
/// `version`/`If-Match` optimistic concurrency) — the two contracts are
/// structurally identical. Diverges only where the real contract itself
/// does: an operational area always belongs to exactly one branch, so this
/// screen adds a branch selector (defaulting to the caller's own current
/// branch) that `pos_category_admin_screen.dart` has no equivalent of.
///
/// Permission gating: "Nueva área" and each row's "Editar" are gated on
/// `operational_area.manage` — an actor without it sees NO such affordance
/// at all (never merely disabled), but always sees the real, honest
/// read-only list as long as it has `operational_area.read`.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/networking/api_client.dart';
import '../authentication/auth_models.dart';
import 'pos_cash_gateway.dart';
import 'pos_operational_areas_gateway.dart';
import 'pos_tokens.dart';

enum _AreaListPhase { loading, empty, failure, ready }

/// The public "Áreas Operativas" module screen. Constructed with the real
/// [AuthenticatedContext] and a real [PosOperationalAreasGateway] — e.g.
/// `PosOperationalAreasScreen(context: this.context, gateway:
/// operationalAreasGateway)`. [cashGateway] is optional/additive — only
/// used to populate the area detail dialog's own "Cajas asignadas" section
/// (assigning/clearing which registers belong to an area); every
/// pre-existing call site keeps working with its `Empty...` default.
class PosOperationalAreasScreen extends StatefulWidget {
  const PosOperationalAreasScreen({
    required this.context,
    required this.gateway,
    this.cashGateway = const EmptyPosCashGateway(),
    super.key,
  });

  final AuthenticatedContext context;
  final PosOperationalAreasGateway gateway;
  final PosCashGateway cashGateway;

  @override
  State<PosOperationalAreasScreen> createState() => _PosOperationalAreasScreenState();
}

class _PosOperationalAreasScreenState extends State<PosOperationalAreasScreen> {
  _AreaListPhase _phase = _AreaListPhase.loading;
  List<PosOperationalArea> _items = const [];
  String? _nextCursor;
  bool _loadingMore = false;
  String? _errorMessage;
  // `null` = todos los estados — the backend's own default when `status`
  // is omitted from the querystring.
  String? _statusFilter;
  late String? _branchId = widget.context.session.branchId ?? _firstBranchId;

  String? get _firstBranchId => widget.context.branches.isEmpty ? null : widget.context.branches.first.id;

  bool get _canRead => widget.context.permissions.contains('operational_area.read');
  bool get _canManage => widget.context.permissions.contains('operational_area.manage');

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    if (!_canRead) return;
    final branchId = _branchId;
    if (branchId == null) {
      setState(() {
        _phase = _AreaListPhase.empty;
        _items = const [];
      });
      return;
    }
    setState(() {
      _phase = _AreaListPhase.loading;
      _errorMessage = null;
    });
    try {
      final page = await widget.gateway.listAreas(branchId: branchId, status: _statusFilter);
      if (!mounted) return;
      setState(() {
        _items = page.items;
        _nextCursor = page.nextCursor;
        _phase = page.items.isEmpty ? _AreaListPhase.empty : _AreaListPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _AreaListPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _AreaListPhase.failure;
        _errorMessage = 'No fue posible cargar las áreas operativas.';
      });
    }
  }

  Future<void> _loadMore() async {
    final cursor = _nextCursor;
    final branchId = _branchId;
    if (cursor == null || _loadingMore || branchId == null) return;
    setState(() => _loadingMore = true);
    try {
      final page = await widget.gateway.listAreas(branchId: branchId, status: _statusFilter, cursor: cursor);
      if (!mounted) return;
      setState(() {
        _items = [..._items, ...page.items];
        _nextCursor = page.nextCursor;
        _loadingMore = false;
      });
    } on Object {
      if (!mounted) return;
      setState(() => _loadingMore = false);
    }
  }

  void _selectBranch(String? branchId) {
    if (branchId == _branchId) return;
    setState(() => _branchId = branchId);
    unawaited(_load());
  }

  void _selectStatus(String? status) {
    if (status == _statusFilter) return;
    setState(() => _statusFilter = status);
    unawaited(_load());
  }

  Future<void> _openNewAreaForm() async {
    final branchId = _branchId;
    if (branchId == null) return;
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _AreaFormDialog(branchId: branchId, gateway: widget.gateway),
    );
    if (saved == true) unawaited(_load());
  }

  Future<void> _openDetail(PosOperationalArea area) async {
    final changed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _AreaDetailDialog(
        area: area,
        canManage: _canManage,
        gateway: widget.gateway,
        cashGateway: widget.cashGateway,
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
                  'Áreas Operativas',
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 20),
                ),
              ),
              IconButton(
                key: const Key('pos-operational-areas-refresh'),
                tooltip: 'Actualizar',
                onPressed: () => unawaited(_load()),
                icon: Icon(Icons.refresh, color: palette.textSecondary),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Agrupa tus cajas en áreas propias del negocio (por ejemplo, admisiones, '
            'alimentos y eventos) — tú decides los nombres.',
            style: TextStyle(color: palette.textSecondary, fontSize: 13),
          ),
          const SizedBox(height: 16),
          if (!_canRead)
            const _AreaPermissionState()
          else ...[
            Row(
              children: [
                Expanded(
                  child: DropdownButtonFormField<String>(
                    key: const Key('pos-operational-areas-branch-filter'),
                    initialValue: _branchId,
                    isExpanded: true,
                    decoration: const InputDecoration(isDense: true, labelText: 'Sucursal'),
                    items: [
                      for (final branch in widget.context.branches)
                        DropdownMenuItem(value: branch.id, child: Text(branch.name)),
                    ],
                    onChanged: _selectBranch,
                  ),
                ),
                const SizedBox(width: 10),
                SizedBox(
                  width: 170,
                  child: DropdownButtonFormField<String?>(
                    key: const Key('pos-operational-areas-status-filter'),
                    initialValue: _statusFilter,
                    isExpanded: true,
                    decoration: const InputDecoration(isDense: true, labelText: 'Estado'),
                    items: const [
                      DropdownMenuItem(value: null, child: Text('Todos')),
                      DropdownMenuItem(value: 'active', child: Text('Activas')),
                      DropdownMenuItem(value: 'inactive', child: Text('Inactivas')),
                    ],
                    onChanged: _selectStatus,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            Align(
              alignment: Alignment.centerRight,
              child: Tooltip(
                message: _canManage
                    ? 'Nueva área operativa'
                    : 'Tu sesión no incluye el permiso operational_area.manage.',
                child: FilledButton.icon(
                  key: const Key('pos-operational-areas-new'),
                  onPressed: _canManage && _branchId != null ? () => unawaited(_openNewAreaForm()) : null,
                  style: FilledButton.styleFrom(backgroundColor: palette.action),
                  icon: const Icon(Icons.add, size: 16),
                  label: const Text('Nueva'),
                ),
              ),
            ),
            const SizedBox(height: 14),
            switch (_phase) {
              _AreaListPhase.loading => const _AreaLoadingState(),
              _AreaListPhase.empty => const _AreaEmptyState(),
              _AreaListPhase.failure => _AreaFailureState(
                message: _errorMessage ?? 'No fue posible cargar las áreas operativas.',
                onRetry: () => unawaited(_load()),
              ),
              _AreaListPhase.ready => Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final area in _items) _AreaRow(area: area, onTap: () => unawaited(_openDetail(area))),
                  if (_nextCursor != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Center(
                        child: OutlinedButton(
                          key: const Key('pos-operational-areas-load-more'),
                          onPressed: _loadingMore ? null : () => unawaited(_loadMore()),
                          child: _loadingMore
                              ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                              : const Text('Cargar más'),
                        ),
                      ),
                    ),
                ],
              ),
            },
          ],
        ],
      ),
    );
  }
}

class _AreaRow extends StatelessWidget {
  const _AreaRow({required this.area, required this.onTap});
  final PosOperationalArea area;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Card(
      key: Key('pos-operational-areas-row-${area.id}'),
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
                    Text(area.name, style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13)),
                    const SizedBox(height: 2),
                    Text(area.code, style: TextStyle(color: palette.textSecondary, fontSize: 12)),
                  ],
                ),
              ),
              _AreaStatusChip(status: area.status),
              const SizedBox(width: 8),
              Icon(Icons.chevron_right, size: 18, color: palette.textMuted),
            ],
          ),
        ),
      ),
    );
  }
}

class _AreaStatusChip extends StatelessWidget {
  const _AreaStatusChip({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final active = status == 'active';
    final color = active ? palette.success : palette.textMuted;
    final label = active ? 'Activa' : 'Inactiva';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: color.withValues(alpha: .12), borderRadius: BorderRadius.circular(20)),
      child: Text(label, style: TextStyle(color: color, fontWeight: FontWeight.w700, fontSize: 11)),
    );
  }
}

/// New/edit area dialog — `código`/`nombre` are required on create
/// (`operational-areas.routes.ts`'s own create body schema); `código` is
/// immutable afterwards (the update route schema has no such property).
class _AreaFormDialog extends StatefulWidget {
  const _AreaFormDialog({required this.branchId, required this.gateway, this.existing});
  final String branchId;
  final PosOperationalAreasGateway gateway;
  final PosOperationalArea? existing;

  @override
  State<_AreaFormDialog> createState() => _AreaFormDialogState();
}

class _AreaFormDialogState extends State<_AreaFormDialog> {
  late final _codeController = TextEditingController(text: widget.existing?.code ?? '');
  late final _nameController = TextEditingController(text: widget.existing?.name ?? '');
  late String _status = widget.existing?.status ?? 'active';
  bool _busy = false;
  String? _error;

  bool get _isEdit => widget.existing != null;

  @override
  void dispose() {
    _codeController.dispose();
    _nameController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final code = _codeController.text.trim();
    final name = _nameController.text.trim();
    if (!_isEdit && code.isEmpty) {
      setState(() => _error = 'El código es obligatorio.');
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
      if (_isEdit) {
        await widget.gateway.updateArea(
          widget.existing!.id,
          widget.existing!.version,
          PosOperationalAreaInput(name: name, status: _status),
        );
      } else {
        await widget.gateway.createArea(
          PosOperationalAreaInput(branchId: widget.branchId, code: code, name: name),
        );
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
        _error = 'No fue posible guardar el área operativa.';
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
          constraints: const BoxConstraints(maxWidth: 420, maxHeight: 480),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  _isEdit ? 'Editar área operativa' : 'Nueva área operativa',
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
                ),
                const SizedBox(height: 14),
                if (!_isEdit) ...[
                  TextField(
                    key: const Key('pos-operational-areas-form-code'),
                    controller: _codeController,
                    decoration: const InputDecoration(isDense: true, labelText: 'Código'),
                  ),
                  const SizedBox(height: 10),
                ],
                TextField(
                  key: const Key('pos-operational-areas-form-name'),
                  controller: _nameController,
                  decoration: const InputDecoration(isDense: true, labelText: 'Nombre'),
                ),
                if (_isEdit) ...[
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    key: const Key('pos-operational-areas-form-status'),
                    initialValue: _status,
                    isExpanded: true,
                    decoration: const InputDecoration(isDense: true, labelText: 'Estado'),
                    items: const [
                      DropdownMenuItem(value: 'active', child: Text('Activa')),
                      DropdownMenuItem(value: 'inactive', child: Text('Inactiva')),
                    ],
                    onChanged: (value) => setState(() => _status = value ?? 'active'),
                  ),
                ],
                if (_error != null) ...[
                  const SizedBox(height: 10),
                  Text(
                    _error!,
                    key: const Key('pos-operational-areas-form-error'),
                    style: TextStyle(color: palette.error, fontSize: 12),
                  ),
                ],
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        key: const Key('pos-operational-areas-form-cancel'),
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
                        key: const Key('pos-operational-areas-form-save'),
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

class _AreaDetailDialog extends StatefulWidget {
  const _AreaDetailDialog({
    required this.area,
    required this.canManage,
    required this.gateway,
    this.cashGateway = const EmptyPosCashGateway(),
  });
  final PosOperationalArea area;
  final bool canManage;
  final PosOperationalAreasGateway gateway;
  final PosCashGateway cashGateway;

  @override
  State<_AreaDetailDialog> createState() => _AreaDetailDialogState();
}

class _AreaDetailDialogState extends State<_AreaDetailDialog> {
  late PosOperationalArea _area = widget.area;
  bool _changed = false;

  // TASK 16.15 — "Cajas asignadas": every active register in this area's
  // own branch, so an operator can assign/clear which ones belong to it.
  // `null` = "Sin área" is a genuine, functional state for a register —
  // never fabricated here.
  List<PosCashRegister> _branchRegisters = const [];
  bool _loadingRegisters = true;
  String? _registerActionError;
  String? _busyRegisterId;

  @override
  void initState() {
    super.initState();
    unawaited(_loadRegisters());
  }

  Future<void> _loadRegisters() async {
    setState(() => _loadingRegisters = true);
    try {
      final registers = await widget.cashGateway.registersForBranch(_area.branchId);
      if (!mounted) return;
      setState(() {
        _branchRegisters = registers;
        _loadingRegisters = false;
      });
    } on Object {
      if (!mounted) return;
      setState(() => _loadingRegisters = false);
    }
  }

  Future<void> _toggleRegister(PosCashRegister register, bool assign) async {
    if (!widget.canManage || _busyRegisterId != null) return;
    setState(() {
      _busyRegisterId = register.id;
      _registerActionError = null;
    });
    try {
      await widget.cashGateway.assignOperationalArea(
        register.id,
        register.version,
        assign ? _area.id : null,
      );
      _changed = true;
      if (!mounted) return;
      await _loadRegisters();
      if (!mounted) return;
      setState(() => _busyRegisterId = null);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busyRegisterId = null;
        _registerActionError = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busyRegisterId = null;
        _registerActionError = 'No fue posible actualizar la caja.';
      });
    }
  }

  Future<void> _edit() async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _AreaFormDialog(branchId: _area.branchId, gateway: widget.gateway, existing: _area),
    );
    if (saved != true || !mounted) return;
    setState(() => _changed = true);
    try {
      final refreshed = await widget.gateway.area(_area.id);
      if (!mounted) return;
      setState(() => _area = refreshed);
    } on Object {
      // The edit itself already succeeded — a failed refresh here just
      // means the dialog keeps showing the pre-edit snapshot; the caller
      // still reloads the real list on close via `_changed`.
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final area = _area;
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 460, maxHeight: 560),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        area.name,
                        key: const Key('pos-operational-areas-detail-name'),
                        style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
                      ),
                    ),
                    _AreaStatusChip(status: area.status),
                  ],
                ),
                const SizedBox(height: 14),
                _AreaDetailField(label: 'Código', value: area.code),
                const SizedBox(height: 16),
                Tooltip(
                  message: widget.canManage
                      ? 'Editar área operativa'
                      : 'Tu sesión no incluye el permiso operational_area.manage.',
                  child: OutlinedButton.icon(
                    key: const Key('pos-operational-areas-detail-edit'),
                    onPressed: widget.canManage ? () => unawaited(_edit()) : null,
                    icon: const Icon(Icons.edit_outlined, size: 16),
                    label: const Text('Editar'),
                  ),
                ),
                const Divider(height: 28),
                Text(
                  'Cajas asignadas',
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13),
                ),
                const SizedBox(height: 6),
                if (_loadingRegisters)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 12),
                    child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
                  )
                else if (_branchRegisters.isEmpty)
                  Text(
                    'Esta sucursal no tiene cajas registradas.',
                    style: TextStyle(color: palette.textMuted, fontSize: 12),
                  )
                else
                  for (final register in _branchRegisters)
                    _RegisterAssignmentRow(
                      register: register,
                      assigned: register.operationalAreaId == area.id,
                      busy: _busyRegisterId == register.id,
                      canManage: widget.canManage,
                      onChanged: (value) => unawaited(_toggleRegister(register, value)),
                    ),
                if (_registerActionError != null) ...[
                  const SizedBox(height: 6),
                  Text(
                    _registerActionError!,
                    key: const Key('pos-operational-areas-register-error'),
                    style: TextStyle(color: palette.error, fontSize: 12),
                  ),
                ],
                const SizedBox(height: 10),
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton(
                    key: const Key('pos-operational-areas-detail-close'),
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

/// One "Cajas asignadas" row — a real checkbox toggling that register's
/// `operational_area_id` between this area's own id and `null` ("Sin
/// área"). Disabled (never hidden) without `operational_area.manage`.
class _RegisterAssignmentRow extends StatelessWidget {
  const _RegisterAssignmentRow({
    required this.register,
    required this.assigned,
    required this.busy,
    required this.canManage,
    required this.onChanged,
  });
  final PosCashRegister register;
  final bool assigned;
  final bool busy;
  final bool canManage;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Padding(
      key: Key('pos-operational-areas-register-${register.id}'),
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          SizedBox(
            width: 24,
            height: 24,
            child: busy
                ? const Padding(padding: EdgeInsets.all(3), child: CircularProgressIndicator(strokeWidth: 2))
                : Checkbox(
                    value: assigned,
                    onChanged: canManage ? (value) => onChanged(value ?? false) : null,
                  ),
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              '${register.name} (${register.code})',
              style: TextStyle(color: palette.text, fontSize: 12),
            ),
          ),
        ],
      ),
    );
  }
}

class _AreaDetailField extends StatelessWidget {
  const _AreaDetailField({required this.label, required this.value});
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
            width: 100,
            child: Text(label, style: TextStyle(color: palette.textSecondary, fontSize: 12, fontWeight: FontWeight.w600)),
          ),
          Expanded(child: Text(value, style: TextStyle(color: palette.text, fontSize: 13))),
        ],
      ),
    );
  }
}

class _AreaLoadingState extends StatelessWidget {
  const _AreaLoadingState();
  @override
  Widget build(BuildContext context) => const Padding(
    padding: EdgeInsets.symmetric(vertical: 40),
    child: Center(child: CircularProgressIndicator()),
  );
}

class _AreaEmptyState extends StatelessWidget {
  const _AreaEmptyState();
  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 40),
      child: Center(
        child: Text('No hay áreas operativas registradas.', style: TextStyle(color: palette.textMuted, fontSize: 13)),
      ),
    );
  }
}

class _AreaFailureState extends StatelessWidget {
  const _AreaFailureState({required this.message, required this.onRetry});
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

class _AreaPermissionState extends StatelessWidget {
  const _AreaPermissionState();
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
              'Tu sesión no incluye el permiso de lectura requerido (operational_area.read).',
              style: TextStyle(color: palette.textMuted, fontSize: 13),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}
