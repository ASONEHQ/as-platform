/// TASK 14.4 (Wave 2): "People" — Empleados / Horarios / Checador / Nómina.
/// A single top-level, `SegmentedButton`-tabbed screen (mirrors `_Caja`'s
/// own shape in `pos_shell.dart`) rather than four separate `PosModule`
/// entries — these four sub-areas share one employee-centric domain and one
/// already-reserved `PosModule.employees` nav slot.
///
/// DESIGN DECISIONS (see the task's own report-back requirements):
///  - Gateway split: ONE file, `pos_people_gateway.dart`, with four small
///    interface groups (`PosEmployeesGateway`/`PosSchedulesGateway`/
///    `PosTimeClockGateway`/`PosPayrollGateway`) — mirrors the backend's own
///    choice to keep one shared `people` module rather than four top-level
///    ones.
///  - Palette access: this screen is always mounted inside `pos_shell.dart`'s
///    own `PosShell`/`Theme` tree, so `PosPalette.of(context)` (a PUBLIC
///    static helper on the PUBLIC `PosPalette` `ThemeExtension` — see
///    `pos_tokens.dart`) resolves to the exact same palette `pos_shell.dart`
///    itself uses, without importing any of its PRIVATE widget classes.
///  - Every private helper widget below (`_Card`/`_Loading`/`_Empty`/
///    `_Failure`/`_PermissionDenied`/`_StatusPill`/etc.) is a small,
///    file-private redeclaration of the equivalent shapes in
///    `pos_shell.dart` (`_PosCard`/`_LoadingState`/…) — those are private to
///    that file and cannot be imported; redeclaring a handful of tiny
///    stateless widgets here keeps the visual language identical without
///    touching the barred shared file.
///  - Permission gating: mirrors `_HeldSales`'s own `_canDiscard`-style
///    pattern exactly — whole READ-gated sections hide behind
///    `_PermissionDenied` (mirrors `_Caja`/`_CustomersAdmin`'s own
///    `_PermissionState` convention for `*.read`), while every individual
///    MUTATING action button stays visible but disabled, wrapped in a
///    `Tooltip` naming the exact missing permission (mirrors `_HeldSales`'s
///    `_canDiscard`/`_canRelease` `Tooltip` pattern for `*.manage`/
///    `*.close`) — never a looser or stricter rule than the backend route
///    guard it mirrors (see each tab's own doc comment for the exact
///    permission code).
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/networking/api_client.dart';
import '../authentication/auth_models.dart';
import 'money.dart';
import 'pos_people_gateway.dart';
import 'pos_tokens.dart';

/// The public entry point — importable from `pos_shell.dart`'s
/// `PosModule.employees` switch case (see this module's own report-back).
class PosPeopleScreen extends StatefulWidget {
  const PosPeopleScreen({
    super.key,
    required this.context,
    required this.employeesGateway,
    required this.schedulesGateway,
    required this.timeClockGateway,
    required this.payrollGateway,
  });

  final AuthenticatedContext context;
  final PosEmployeesGateway employeesGateway;
  final PosSchedulesGateway schedulesGateway;
  final PosTimeClockGateway timeClockGateway;
  final PosPayrollGateway payrollGateway;

  @override
  State<PosPeopleScreen> createState() => _PosPeopleScreenState();
}

enum _PeopleTab { empleados, horarios, checador, nomina }

class _PosPeopleScreenState extends State<PosPeopleScreen> {
  _PeopleTab _tab = _PeopleTab.empleados;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      _PeopleHeader(tab: _tab, onTabChanged: (value) => setState(() => _tab = value)),
      switch (_tab) {
        _PeopleTab.empleados => _EmpleadosTab(context: widget.context, gateway: widget.employeesGateway),
        _PeopleTab.horarios => _HorariosTab(
          context: widget.context,
          employeesGateway: widget.employeesGateway,
          schedulesGateway: widget.schedulesGateway,
        ),
        _PeopleTab.checador => _ChecadorTab(
          context: widget.context,
          employeesGateway: widget.employeesGateway,
          timeClockGateway: widget.timeClockGateway,
        ),
        _PeopleTab.nomina => _NominaTab(
          context: widget.context,
          employeesGateway: widget.employeesGateway,
          payrollGateway: widget.payrollGateway,
        ),
      },
    ],
  );
}

class _PeopleHeader extends StatelessWidget {
  const _PeopleHeader({required this.tab, required this.onTabChanged});
  final _PeopleTab tab;
  final ValueChanged<_PeopleTab> onTabChanged;

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
                Text('Empleados', style: TextStyle(color: palette.text, fontSize: 22, fontWeight: FontWeight.w800)),
                const SizedBox(height: 4),
                Text(
                  'Empleados, horarios, checador y nómina — datos reales del backend.',
                  style: TextStyle(color: palette.textSecondary, fontSize: 12),
                ),
              ],
            ),
          ),
          SegmentedButton<_PeopleTab>(
            key: const Key('pos-people-tabs'),
            segments: const [
              ButtonSegment(value: _PeopleTab.empleados, label: Text('Empleados')),
              ButtonSegment(value: _PeopleTab.horarios, label: Text('Horarios')),
              ButtonSegment(value: _PeopleTab.checador, label: Text('Checador')),
              ButtonSegment(value: _PeopleTab.nomina, label: Text('Nómina')),
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
// `pos_shell.dart`'s own private shapes (see this file's own top doc
// comment for why).
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
  const _PermissionDenied();
  @override
  Widget build(BuildContext context) => const _StateBlock(
    icon: Icons.lock_outline,
    title: 'Acceso no autorizado',
    message: 'Tu sesión no incluye el permiso de lectura requerido.',
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
    final positive = label == 'active' || label == 'draft';
    final color = positive ? palette.success : palette.warning;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: color.withValues(alpha: .12), borderRadius: BorderRadius.circular(20)),
      child: Text(label, style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.w800)),
    );
  }
}

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
          SizedBox(width: 170, child: Text(label, style: TextStyle(color: palette.textMuted, fontSize: 11))),
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
    this.saveLabel = 'Guardar',
    this.saveEnabled = true,
    this.disabledTooltip = '',
  });
  final bool busy;
  final VoidCallback onCancel;
  final VoidCallback onSave;
  final Key? saveKey;
  final String saveLabel;
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
                  : Text(saveLabel),
            ),
          ),
        ),
      ],
    );
  }
}

String _isoDate(DateTime value) {
  final local = value.toLocal();
  return '${local.year.toString().padLeft(4, '0')}-${local.month.toString().padLeft(2, '0')}-${local.day.toString().padLeft(2, '0')}';
}

String _formatTime(DateTime value) {
  final local = value.toLocal();
  return '${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
}

String _formatDateTime(DateTime value) {
  final local = value.toLocal();
  return '${local.day.toString().padLeft(2, '0')}/${local.month.toString().padLeft(2, '0')}/${local.year} ${_formatTime(value)}';
}

String _formatMoney(String raw, String currencyCode) {
  final trimmed = raw.trim();
  final negative = trimmed.startsWith('-');
  final magnitude = negative ? trimmed.substring(1) : trimmed;
  try {
    final money = Money.parse(magnitude, currencyCode);
    return '${negative ? '-' : ''}\$${money.toDisplayString()}';
  } on MoneyFormatException {
    return raw;
  }
}

final RegExp _datePattern = RegExp(r'^\d{4}-\d{2}-\d{2}$');
final RegExp _timePattern = RegExp(r'^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$');

int _minutesOf(String value) {
  final parts = value.split(':');
  return int.parse(parts[0]) * 60 + int.parse(parts[1]);
}

// ---------------------------------------------------------------------
// Empleados — gated by `employee.read`/`employee.manage`.
// ---------------------------------------------------------------------

class _EmpleadosTab extends StatefulWidget {
  const _EmpleadosTab({required this.context, required this.gateway});
  final AuthenticatedContext context;
  final PosEmployeesGateway gateway;

  @override
  State<_EmpleadosTab> createState() => _EmpleadosTabState();
}

class _EmpleadosTabState extends State<_EmpleadosTab> {
  _ListPhase _phase = _ListPhase.loading;
  List<PosEmployee> _items = const [];
  String? _nextCursor;
  bool _loadingMore = false;
  String? _errorMessage;
  String _query = '';
  String _statusFilter = 'all';

  bool get _canRead => widget.context.permissions.contains('employee.read');
  bool get _canManage => widget.context.permissions.contains('employee.manage');
  String? get _branchId => widget.context.session.branchId;

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
      final page = await widget.gateway.listEmployees(
        branchId: _branchId,
        status: _statusFilter == 'all' ? null : _statusFilter,
      );
      if (!mounted) return;
      setState(() {
        _items = page.items;
        _nextCursor = page.nextCursor;
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
        _errorMessage = 'No fue posible cargar los empleados.';
      });
    }
  }

  Future<void> _loadMore() async {
    final cursor = _nextCursor;
    if (cursor == null || _loadingMore) return;
    setState(() => _loadingMore = true);
    try {
      final page = await widget.gateway.listEmployees(
        branchId: _branchId,
        status: _statusFilter == 'all' ? null : _statusFilter,
        cursor: cursor,
      );
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

  List<PosEmployee> get _visibleItems {
    final query = _query.trim().toLowerCase();
    if (query.isEmpty) return _items;
    return _items
        .where(
          (employee) =>
              employee.displayName.toLowerCase().contains(query) ||
              employee.code.toLowerCase().contains(query) ||
              (employee.jobTitle?.toLowerCase().contains(query) ?? false),
        )
        .toList(growable: false);
  }

  Future<void> _openNewForm() async {
    final branchId = _branchId;
    if (branchId == null || !_canManage) return;
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _EmployeeFormDialog(gateway: widget.gateway, branchId: branchId),
    );
    if (saved == true) unawaited(_load());
  }

  Future<void> _openDetail(PosEmployee employee) async {
    final changed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _EmployeeDetailDialog(employee: employee, gateway: widget.gateway, canManage: _canManage),
    );
    if (changed == true) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    if (!_canRead) return const _PermissionDenied();
    final newDisabledReason = !_canManage
        ? 'Se requiere el permiso employee.manage.'
        : (_branchId == null ? 'Selecciona una sucursal para dar de alta empleados.' : '');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: TextField(
                key: const Key('pos-employees-search'),
                onChanged: (value) => setState(() => _query = value),
                decoration: const InputDecoration(
                  isDense: true,
                  hintText: 'Buscar por nombre, código o puesto',
                  prefixIcon: Icon(Icons.search),
                ),
              ),
            ),
            const SizedBox(width: 10),
            SizedBox(
              width: 150,
              child: DropdownButtonFormField<String>(
                key: const Key('pos-employees-status-filter'),
                initialValue: _statusFilter,
                isExpanded: true,
                decoration: const InputDecoration(isDense: true, labelText: 'Estado'),
                items: const [
                  DropdownMenuItem(value: 'all', child: Text('Todos')),
                  DropdownMenuItem(value: 'active', child: Text('Activos')),
                  DropdownMenuItem(value: 'inactive', child: Text('Inactivos')),
                ],
                onChanged: (value) {
                  setState(() => _statusFilter = value ?? 'all');
                  unawaited(_load());
                },
              ),
            ),
            const SizedBox(width: 10),
            Tooltip(
              message: newDisabledReason,
              child: FilledButton.icon(
                key: const Key('pos-employees-new'),
                onPressed: newDisabledReason.isEmpty ? () => unawaited(_openNewForm()) : null,
                style: FilledButton.styleFrom(backgroundColor: palette.action),
                icon: const Icon(Icons.badge_outlined, size: 16),
                label: const Text('Nuevo empleado'),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        switch (_phase) {
          _ListPhase.loading => const _Loading(),
          _ListPhase.empty => const _Empty(message: 'No hay empleados registrados.'),
          _ListPhase.failure => _Failure(
            message: _errorMessage ?? 'No fue posible cargar los empleados.',
            onRetry: () => unawaited(_load()),
          ),
          _ListPhase.ready => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final employee in _visibleItems)
                _EmployeeRow(employee: employee, onTap: () => unawaited(_openDetail(employee))),
              if (_nextCursor != null)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Center(
                    child: OutlinedButton.icon(
                      key: const Key('pos-employees-load-more'),
                      onPressed: _loadingMore ? null : () => unawaited(_loadMore()),
                      icon: _loadingMore
                          ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                          : const Icon(Icons.expand_more),
                      label: const Text('Cargar más'),
                    ),
                  ),
                ),
            ],
          ),
        },
      ],
    );
  }
}

class _EmployeeRow extends StatelessWidget {
  const _EmployeeRow({required this.employee, required this.onTap});
  final PosEmployee employee;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return _Card(
      key: Key('pos-employee-row-${employee.id}'),
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
                    Text(
                      employee.displayName,
                      style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      employee.jobTitle == null ? employee.code : '${employee.code} · ${employee.jobTitle}',
                      style: TextStyle(color: palette.textSecondary, fontSize: 11),
                    ),
                  ],
                ),
              ),
              _StatusPill(label: employee.status),
              const SizedBox(width: 8),
              Icon(Icons.chevron_right, size: 18, color: palette.textMuted),
            ],
          ),
        ),
      ),
    );
  }
}

/// New/edit employee dialog — only ever reachable through an
/// already-`employee.manage`-gated entry point (see `_EmpleadosTabState`'s
/// `pos-employees-new` and `_EmployeeDetailDialog`'s `pos-employee-detail-
/// edit`, both disabled+`Tooltip`-explained otherwise), so this dialog
/// itself carries no separate internal permission gate.
class _EmployeeFormDialog extends StatefulWidget {
  const _EmployeeFormDialog({required this.gateway, required this.branchId, this.existing});
  final PosEmployeesGateway gateway;
  final String branchId;
  final PosEmployee? existing;

  @override
  State<_EmployeeFormDialog> createState() => _EmployeeFormDialogState();
}

class _EmployeeFormDialogState extends State<_EmployeeFormDialog> {
  late final _codeController = TextEditingController(text: widget.existing?.code ?? '');
  late final _nameController = TextEditingController(text: widget.existing?.displayName ?? '');
  late final _phoneController = TextEditingController(text: widget.existing?.phone ?? '');
  late final _emailController = TextEditingController(text: widget.existing?.email ?? '');
  late final _jobTitleController = TextEditingController(text: widget.existing?.jobTitle ?? '');
  late final _hireDateController = TextEditingController(text: widget.existing?.hireDate ?? '');
  late final _weeklySalaryController = TextEditingController(text: widget.existing?.weeklySalary ?? '');
  late final _currencyController = TextEditingController(text: widget.existing?.currencyCode ?? 'MXN');
  late final _userIdController = TextEditingController(text: widget.existing?.userId ?? '');
  late final _notesController = TextEditingController(text: widget.existing?.notes ?? '');
  bool _busy = false;
  String? _error;

  bool get _isEdit => widget.existing != null;

  @override
  void dispose() {
    _codeController.dispose();
    _nameController.dispose();
    _phoneController.dispose();
    _emailController.dispose();
    _jobTitleController.dispose();
    _hireDateController.dispose();
    _weeklySalaryController.dispose();
    _currencyController.dispose();
    _userIdController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final code = _codeController.text.trim();
    final name = _nameController.text.trim();
    final weeklySalary = _weeklySalaryController.text.trim();
    final currency = _currencyController.text.trim().toUpperCase();
    if (!_isEdit && code.isEmpty) {
      setState(() => _error = 'El código es obligatorio.');
      return;
    }
    if (name.isEmpty) {
      setState(() => _error = 'El nombre es obligatorio.');
      return;
    }
    if (weeklySalary.isEmpty) {
      setState(() => _error = 'El salario semanal es obligatorio.');
      return;
    }
    if (currency.length != 3) {
      setState(() => _error = 'La moneda debe tener 3 letras (ej. MXN).');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final phone = _phoneController.text.trim();
    final email = _emailController.text.trim();
    final jobTitle = _jobTitleController.text.trim();
    final hireDate = _hireDateController.text.trim();
    final userId = _userIdController.text.trim();
    final notes = _notesController.text.trim();
    try {
      if (_isEdit) {
        await widget.gateway.updateEmployee(
          widget.existing!.id,
          PosEmployeeUpdateInput(
            displayName: name,
            phone: phone.isEmpty ? null : phone,
            email: email.isEmpty ? null : email,
            jobTitle: jobTitle.isEmpty ? null : jobTitle,
            hireDate: hireDate.isEmpty ? null : hireDate,
            weeklySalary: weeklySalary,
            currencyCode: currency,
            userId: userId.isEmpty ? null : userId,
            notes: notes.isEmpty ? null : notes,
          ),
          version: widget.existing!.version,
        );
      } else {
        await widget.gateway.createEmployee(
          PosEmployeeCreateInput(
            branchId: widget.branchId,
            code: code,
            displayName: name,
            phone: phone.isEmpty ? null : phone,
            email: email.isEmpty ? null : email,
            jobTitle: jobTitle.isEmpty ? null : jobTitle,
            hireDate: hireDate.isEmpty ? null : hireDate,
            weeklySalary: weeklySalary,
            currencyCode: currency,
            userId: userId.isEmpty ? null : userId,
            notes: notes.isEmpty ? null : notes,
          ),
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
        _error = 'No fue posible guardar el empleado.';
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
          constraints: const BoxConstraints(maxWidth: 440, maxHeight: 680),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  _isEdit ? 'Editar empleado' : 'Nuevo empleado',
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
                ),
                const SizedBox(height: 14),
                if (!_isEdit) ...[
                  TextField(
                    key: const Key('pos-employee-form-code'),
                    controller: _codeController,
                    decoration: const InputDecoration(isDense: true, labelText: 'Código'),
                  ),
                  const SizedBox(height: 10),
                ],
                TextField(
                  key: const Key('pos-employee-form-name'),
                  controller: _nameController,
                  decoration: const InputDecoration(isDense: true, labelText: 'Nombre completo'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-employee-form-phone'),
                  controller: _phoneController,
                  keyboardType: TextInputType.phone,
                  decoration: const InputDecoration(isDense: true, labelText: 'Teléfono (opcional)'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-employee-form-email'),
                  controller: _emailController,
                  keyboardType: TextInputType.emailAddress,
                  decoration: const InputDecoration(isDense: true, labelText: 'Correo (opcional)'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-employee-form-job-title'),
                  controller: _jobTitleController,
                  decoration: const InputDecoration(isDense: true, labelText: 'Puesto (opcional)'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-employee-form-hire-date'),
                  controller: _hireDateController,
                  decoration: const InputDecoration(isDense: true, labelText: 'Fecha de contratación (YYYY-MM-DD, opcional)'),
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        key: const Key('pos-employee-form-weekly-salary'),
                        controller: _weeklySalaryController,
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        decoration: const InputDecoration(isDense: true, labelText: 'Salario semanal'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    SizedBox(
                      width: 100,
                      child: TextField(
                        key: const Key('pos-employee-form-currency'),
                        controller: _currencyController,
                        decoration: const InputDecoration(isDense: true, labelText: 'Moneda'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-employee-form-user-id'),
                  controller: _userIdController,
                  decoration: const InputDecoration(isDense: true, labelText: 'Id de usuario vinculado (opcional)'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-employee-form-notes'),
                  controller: _notesController,
                  maxLines: 2,
                  decoration: const InputDecoration(isDense: true, labelText: 'Notas (opcional)'),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 10),
                  Text(_error!, key: const Key('pos-employee-form-error'), style: TextStyle(color: palette.error, fontSize: 12)),
                ],
                const SizedBox(height: 16),
                _DialogButtons(
                  busy: _busy,
                  onCancel: () => Navigator.of(context).pop(false),
                  onSave: () => unawaited(_submit()),
                  saveKey: const Key('pos-employee-form-save'),
                  saveLabel: 'Guardar',
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The employee detail read view — always reachable with `employee.read`
/// (mirrors `_CustomerDetailDialog`'s own always-open-on-row-tap shape);
/// every mutating action inside (Editar/Desactivar/Reactivar) stays its own
/// individually `employee.manage`-gated, disabled+`Tooltip`'d button.
class _EmployeeDetailDialog extends StatefulWidget {
  const _EmployeeDetailDialog({required this.employee, required this.gateway, required this.canManage});
  final PosEmployee employee;
  final PosEmployeesGateway gateway;
  final bool canManage;

  @override
  State<_EmployeeDetailDialog> createState() => _EmployeeDetailDialogState();
}

class _EmployeeDetailDialogState extends State<_EmployeeDetailDialog> {
  late PosEmployee _employee = widget.employee;
  bool _busy = false;
  String? _error;
  bool _changed = false;

  static const _manageTooltip = 'Se requiere el permiso employee.manage.';

  Future<void> _edit() async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _EmployeeFormDialog(gateway: widget.gateway, branchId: _employee.branchId, existing: _employee),
    );
    if (saved != true) return;
    _changed = true;
    try {
      final refreshed = await widget.gateway.employee(_employee.id);
      if (!mounted) return;
      setState(() => _employee = refreshed);
    } on Object {
      // The edit itself already succeeded; the caller's own list refresh
      // (triggered by `_changed` on close) still shows the real result —
      // this refetch failing just keeps the dialog's own copy stale.
    }
  }

  Future<void> _toggleActive() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final updated = _employee.isActive
          ? await widget.gateway.deactivateEmployee(_employee.id)
          : await widget.gateway.reactivateEmployee(_employee.id);
      if (!mounted) return;
      setState(() {
        _employee = updated;
        _busy = false;
        _changed = true;
      });
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
        _error = 'No fue posible actualizar el estado del empleado.';
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
          constraints: const BoxConstraints(maxWidth: 440, maxHeight: 640),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        _employee.displayName,
                        style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
                      ),
                    ),
                    _StatusPill(label: _employee.status),
                  ],
                ),
                const SizedBox(height: 12),
                _DetailRow(label: 'Código', value: _employee.code),
                _DetailRow(label: 'Puesto', value: _employee.jobTitle ?? '—'),
                _DetailRow(label: 'Teléfono', value: _employee.phone ?? '—'),
                _DetailRow(label: 'Correo', value: _employee.email ?? '—'),
                _DetailRow(label: 'Fecha de contratación', value: _employee.hireDate ?? '—'),
                _DetailRow(label: 'Salario semanal', value: _formatMoney(_employee.weeklySalary, _employee.currencyCode)),
                _DetailRow(label: 'Id de usuario vinculado', value: _employee.userId ?? '—'),
                _DetailRow(label: 'Notas', value: _employee.notes ?? '—'),
                if (_error != null) ...[
                  const SizedBox(height: 10),
                  Text(
                    _error!,
                    key: const Key('pos-employee-detail-error'),
                    style: TextStyle(color: palette.error, fontSize: 12),
                  ),
                ],
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: Tooltip(
                        message: widget.canManage ? '' : _manageTooltip,
                        child: OutlinedButton.icon(
                          key: const Key('pos-employee-detail-edit'),
                          onPressed: widget.canManage ? () => unawaited(_edit()) : null,
                          icon: const Icon(Icons.edit_outlined, size: 16),
                          label: const Text('Editar'),
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Tooltip(
                        message: widget.canManage ? '' : _manageTooltip,
                        child: FilledButton.icon(
                          key: Key(_employee.isActive ? 'pos-employee-detail-deactivate' : 'pos-employee-detail-reactivate'),
                          onPressed: _busy || !widget.canManage ? null : () => unawaited(_toggleActive()),
                          style: FilledButton.styleFrom(backgroundColor: _employee.isActive ? palette.error : palette.success),
                          icon: Icon(_employee.isActive ? Icons.person_off_outlined : Icons.person_add_alt_1_outlined, size: 16),
                          label: Text(_employee.isActive ? 'Desactivar' : 'Reactivar'),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Center(
                  child: TextButton(onPressed: () => Navigator.of(context).pop(_changed), child: const Text('Cerrar')),
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
// Horarios — gated by `schedule.read`/`schedule.manage`.
// ---------------------------------------------------------------------

class _HorariosTab extends StatefulWidget {
  const _HorariosTab({required this.context, required this.employeesGateway, required this.schedulesGateway});
  final AuthenticatedContext context;
  final PosEmployeesGateway employeesGateway;
  final PosSchedulesGateway schedulesGateway;

  @override
  State<_HorariosTab> createState() => _HorariosTabState();
}

class _HorariosTabState extends State<_HorariosTab> {
  bool get _canRead => widget.context.permissions.contains('schedule.read');
  bool get _canManage => widget.context.permissions.contains('schedule.manage');

  List<PosEmployee> _employees = const [];
  PosEmployee? _selectedEmployee;
  final _manualEmployeeIdController = TextEditingController();
  late final _dateFromController = TextEditingController(text: _isoDate(DateTime.now().subtract(const Duration(days: 7))));
  late final _dateToController = TextEditingController(text: _isoDate(DateTime.now().add(const Duration(days: 7))));

  _ListPhase _phase = _ListPhase.empty;
  List<PosEmployeeSchedule> _schedules = const [];
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    unawaited(_loadEmployees());
  }

  @override
  void dispose() {
    _manualEmployeeIdController.dispose();
    _dateFromController.dispose();
    _dateToController.dispose();
    super.dispose();
  }

  Future<void> _loadEmployees() async {
    try {
      final page = await widget.employeesGateway.listEmployees(branchId: widget.context.session.branchId, status: 'active');
      if (!mounted) return;
      setState(() => _employees = page.items);
    } on Object {
      // Honest fallback — no `employee.read` means no picker, but a
      // `schedule.manage` actor can still type an employee id manually.
    }
  }

  String? get _employeeId =>
      _selectedEmployee?.id ?? (_manualEmployeeIdController.text.trim().isEmpty ? null : _manualEmployeeIdController.text.trim());

  Future<void> _load() async {
    final employeeId = _employeeId;
    if (employeeId == null || !_canRead) return;
    setState(() {
      _phase = _ListPhase.loading;
      _errorMessage = null;
    });
    try {
      final items = await widget.schedulesGateway.listSchedules(
        employeeId: employeeId,
        dateFrom: _dateFromController.text.trim(),
        dateTo: _dateToController.text.trim(),
      );
      if (!mounted) return;
      setState(() {
        _schedules = items;
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
        _errorMessage = 'No fue posible cargar los horarios.';
      });
    }
  }

  Future<void> _openDayEditor([PosEmployeeSchedule? existing]) async {
    final employeeId = _employeeId;
    if (employeeId == null) return;
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _ScheduleFormDialog(
        gateway: widget.schedulesGateway,
        employeeId: employeeId,
        canManage: _canManage,
        existing: existing,
      ),
    );
    if (saved == true) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    if (!_canRead) return const _PermissionDenied();
    final employeeId = _employeeId;
    final newDisabledReason = employeeId == null
        ? 'Selecciona un empleado.'
        : (!_canManage ? 'Se requiere el permiso schedule.manage.' : '');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _Card(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (_employees.isNotEmpty)
                DropdownButtonFormField<PosEmployee>(
                  key: const Key('pos-schedule-employee-select'),
                  initialValue: _selectedEmployee,
                  isExpanded: true,
                  decoration: const InputDecoration(isDense: true, labelText: 'Empleado'),
                  items: [
                    for (final employee in _employees)
                      DropdownMenuItem(value: employee, child: Text('${employee.displayName} (${employee.code})')),
                  ],
                  onChanged: (value) => setState(() => _selectedEmployee = value),
                )
              else
                TextField(
                  key: const Key('pos-schedule-employee-id'),
                  controller: _manualEmployeeIdController,
                  onChanged: (_) => setState(() {}),
                  decoration: const InputDecoration(isDense: true, labelText: 'Id del empleado'),
                ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      key: const Key('pos-schedule-date-from'),
                      controller: _dateFromController,
                      decoration: const InputDecoration(isDense: true, labelText: 'Desde (YYYY-MM-DD)'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: TextField(
                      key: const Key('pos-schedule-date-to'),
                      controller: _dateToController,
                      decoration: const InputDecoration(isDense: true, labelText: 'Hasta (YYYY-MM-DD)'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  OutlinedButton.icon(
                    key: const Key('pos-schedule-load'),
                    onPressed: employeeId == null ? null : () => unawaited(_load()),
                    icon: const Icon(Icons.search, size: 16),
                    label: const Text('Cargar horarios'),
                  ),
                  const Spacer(),
                  Tooltip(
                    message: newDisabledReason,
                    child: FilledButton.icon(
                      key: const Key('pos-schedule-new'),
                      onPressed: newDisabledReason.isEmpty ? () => unawaited(_openDayEditor()) : null,
                      style: FilledButton.styleFrom(backgroundColor: palette.action),
                      icon: const Icon(Icons.add, size: 16),
                      label: const Text('Definir turno'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        switch (_phase) {
          _ListPhase.loading => const _Loading(),
          _ListPhase.empty => const _Empty(message: 'No hay turnos definidos en ese rango de fechas.'),
          _ListPhase.failure => _Failure(
            message: _errorMessage ?? 'No fue posible cargar los horarios.',
            onRetry: () => unawaited(_load()),
          ),
          _ListPhase.ready => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final schedule in _schedules)
                _ScheduleRow(schedule: schedule, onTap: () => unawaited(_openDayEditor(schedule))),
            ],
          ),
        },
      ],
    );
  }
}

class _ScheduleRow extends StatelessWidget {
  const _ScheduleRow({required this.schedule, required this.onTap});
  final PosEmployeeSchedule schedule;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return _Card(
      key: Key('pos-schedule-day-${schedule.workDate}'),
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
                    Text(schedule.workDate, style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13)),
                    const SizedBox(height: 2),
                    Text(
                      schedule.isDayOff ? 'Día de descanso' : '${schedule.scheduledStart} – ${schedule.scheduledEnd}',
                      style: TextStyle(color: palette.textSecondary, fontSize: 11),
                    ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right, size: 18, color: palette.textMuted),
            ],
          ),
        ),
      ),
    );
  }
}

/// A day's schedule editor — always reachable with `schedule.read` (it also
/// functions as the read view when [canManage] is `false`); Save stays a
/// single, individually `schedule.manage`-gated action. Client-side
/// validation in [_validate] mirrors `schedules.service.ts`'s exact rule
/// (day off ⇒ no times; otherwise both required and `end > start`) — shown
/// before ever submitting; a real backend rejection is still surfaced
/// honestly via [_error] on failure.
class _ScheduleFormDialog extends StatefulWidget {
  const _ScheduleFormDialog({
    required this.gateway,
    required this.employeeId,
    required this.canManage,
    this.existing,
  });
  final PosSchedulesGateway gateway;
  final String employeeId;
  final bool canManage;
  final PosEmployeeSchedule? existing;

  @override
  State<_ScheduleFormDialog> createState() => _ScheduleFormDialogState();
}

class _ScheduleFormDialogState extends State<_ScheduleFormDialog> {
  late final _dateController = TextEditingController(text: widget.existing?.workDate ?? _isoDate(DateTime.now()));
  late bool _isDayOff = widget.existing?.isDayOff ?? false;
  late final _startController = TextEditingController(text: widget.existing?.scheduledStart ?? '');
  late final _endController = TextEditingController(text: widget.existing?.scheduledEnd ?? '');
  late final _notesController = TextEditingController(text: widget.existing?.notes ?? '');
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _dateController.dispose();
    _startController.dispose();
    _endController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  String? _validate() {
    final date = _dateController.text.trim();
    if (!_datePattern.hasMatch(date)) return 'La fecha debe tener el formato YYYY-MM-DD.';
    if (_isDayOff) {
      if (_startController.text.trim().isNotEmpty || _endController.text.trim().isNotEmpty) {
        return 'Un día de descanso no debe incluir hora de inicio ni de fin.';
      }
      return null;
    }
    final start = _startController.text.trim();
    final end = _endController.text.trim();
    if (start.isEmpty || end.isEmpty) {
      return 'La hora de inicio y de fin son obligatorias si no es un día de descanso.';
    }
    if (!_timePattern.hasMatch(start) || !_timePattern.hasMatch(end)) {
      return 'La hora debe tener el formato HH:MM.';
    }
    if (_minutesOf(end) <= _minutesOf(start)) {
      return 'La hora de fin debe ser posterior a la hora de inicio.';
    }
    return null;
  }

  Future<void> _submit() async {
    final validationError = _validate();
    if (validationError != null) {
      setState(() => _error = validationError);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final notes = _notesController.text.trim();
    try {
      await widget.gateway.upsertSchedule(
        PosScheduleUpsertInput(
          id: widget.existing?.id,
          employeeId: widget.employeeId,
          workDate: _dateController.text.trim(),
          isDayOff: _isDayOff,
          scheduledStart: _isDayOff ? null : _startController.text.trim(),
          scheduledEnd: _isDayOff ? null : _endController.text.trim(),
          notes: notes.isEmpty ? null : notes,
        ),
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
        _error = 'No fue posible guardar el horario.';
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
                  widget.existing == null ? 'Definir turno' : 'Editar turno',
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
                ),
                const SizedBox(height: 14),
                TextField(
                  key: const Key('pos-schedule-form-date'),
                  controller: _dateController,
                  decoration: const InputDecoration(isDense: true, labelText: 'Fecha (YYYY-MM-DD)'),
                ),
                const SizedBox(height: 10),
                SwitchListTile(
                  key: const Key('pos-schedule-form-dayoff'),
                  contentPadding: EdgeInsets.zero,
                  value: _isDayOff,
                  onChanged: (value) => setState(() {
                    _isDayOff = value;
                    if (value) {
                      _startController.clear();
                      _endController.clear();
                    }
                  }),
                  title: const Text('Día de descanso'),
                ),
                if (!_isDayOff) ...[
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          key: const Key('pos-schedule-form-start'),
                          controller: _startController,
                          decoration: const InputDecoration(isDense: true, labelText: 'Hora de inicio (HH:MM)'),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: TextField(
                          key: const Key('pos-schedule-form-end'),
                          controller: _endController,
                          decoration: const InputDecoration(isDense: true, labelText: 'Hora de fin (HH:MM)'),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                ],
                TextField(
                  key: const Key('pos-schedule-form-notes'),
                  controller: _notesController,
                  maxLines: 2,
                  decoration: const InputDecoration(isDense: true, labelText: 'Notas (opcional)'),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 10),
                  Text(_error!, key: const Key('pos-schedule-form-error'), style: TextStyle(color: palette.error, fontSize: 12)),
                ],
                const SizedBox(height: 16),
                _DialogButtons(
                  busy: _busy,
                  onCancel: () => Navigator.of(context).pop(false),
                  onSave: () => unawaited(_submit()),
                  saveKey: const Key('pos-schedule-form-save'),
                  saveLabel: 'Guardar',
                  saveEnabled: widget.canManage,
                  disabledTooltip: 'Se requiere el permiso schedule.manage.',
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
// Checador — gated by `attendance.read`/`attendance.manage`.
// ---------------------------------------------------------------------

class _ChecadorTab extends StatefulWidget {
  const _ChecadorTab({required this.context, required this.employeesGateway, required this.timeClockGateway});
  final AuthenticatedContext context;
  final PosEmployeesGateway employeesGateway;
  final PosTimeClockGateway timeClockGateway;

  @override
  State<_ChecadorTab> createState() => _ChecadorTabState();
}

class _ChecadorTabState extends State<_ChecadorTab> {
  bool get _canReadAttendance => widget.context.permissions.contains('attendance.read');
  bool get _canManageAttendance => widget.context.permissions.contains('attendance.manage');

  List<PosEmployee> _employees = const [];
  PosEmployee? _selfEmployee;
  final _selfEmployeeIdController = TextEditingController();
  bool _selfBusy = false;
  String? _selfMessage;
  bool _selfMessageIsError = false;

  PosEmployee? _managedEmployee;
  final _manageEmployeeIdController = TextEditingController();
  late final _manageDateFromController = TextEditingController(text: _isoDate(DateTime.now().subtract(const Duration(days: 7))));
  late final _manageDateToController = TextEditingController(text: _isoDate(DateTime.now()));
  _ListPhase _managePhase = _ListPhase.empty;
  List<PosTimeClockPunch> _punches = const [];
  String? _manageErrorMessage;

  @override
  void initState() {
    super.initState();
    unawaited(_loadEmployees());
  }

  @override
  void dispose() {
    _selfEmployeeIdController.dispose();
    _manageEmployeeIdController.dispose();
    _manageDateFromController.dispose();
    _manageDateToController.dispose();
    super.dispose();
  }

  Future<void> _loadEmployees() async {
    try {
      final page = await widget.employeesGateway.listEmployees(branchId: widget.context.session.branchId, status: 'active');
      if (!mounted) return;
      setState(() {
        _employees = page.items;
        _selfEmployee = page.items.where((employee) => employee.userId == widget.context.session.userId).firstOrNull;
      });
    } on Object {
      // Honest fallback — no `employee.read` means no auto-detected self
      // employee and no employee picker; manual employee id entry still
      // lets both sections below work.
    }
  }

  String? get _selfEmployeeId =>
      _selfEmployee?.id ?? (_selfEmployeeIdController.text.trim().isEmpty ? null : _selfEmployeeIdController.text.trim());
  String? get _manageEmployeeId =>
      _managedEmployee?.id ?? (_manageEmployeeIdController.text.trim().isEmpty ? null : _manageEmployeeIdController.text.trim());

  Future<void> _punch(bool clockIn) async {
    final employeeId = _selfEmployeeId;
    if (employeeId == null) return;
    setState(() {
      _selfBusy = true;
      _selfMessage = null;
    });
    try {
      final punch = clockIn
          ? await widget.timeClockGateway.clockIn(employeeId: employeeId)
          : await widget.timeClockGateway.clockOut(employeeId: employeeId);
      if (!mounted) return;
      setState(() {
        _selfBusy = false;
        _selfMessageIsError = false;
        _selfMessage = clockIn
            ? 'Entrada registrada a las ${_formatTime(punch.occurredAt)}.'
            : 'Salida registrada a las ${_formatTime(punch.occurredAt)}.';
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _selfBusy = false;
        _selfMessageIsError = true;
        _selfMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _selfBusy = false;
        _selfMessageIsError = true;
        _selfMessage = 'No fue posible registrar el movimiento.';
      });
    }
  }

  Future<void> _loadPunches() async {
    final employeeId = _manageEmployeeId;
    if (employeeId == null) return;
    setState(() {
      _managePhase = _ListPhase.loading;
      _manageErrorMessage = null;
    });
    try {
      final items = await widget.timeClockGateway.listPunches(
        employeeId: employeeId,
        dateFrom: _manageDateFromController.text.trim().isEmpty ? null : _manageDateFromController.text.trim(),
        dateTo: _manageDateToController.text.trim().isEmpty ? null : _manageDateToController.text.trim(),
      );
      if (!mounted) return;
      setState(() {
        _punches = items;
        _managePhase = items.isEmpty ? _ListPhase.empty : _ListPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _managePhase = _ListPhase.failure;
        _manageErrorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _managePhase = _ListPhase.failure;
        _manageErrorMessage = 'No fue posible cargar las marcaciones.';
      });
    }
  }

  Future<void> _openCorrection(PosTimeClockPunch punch) async {
    final employeeId = _manageEmployeeId;
    if (employeeId == null) return;
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _CorrectionDialog(
        gateway: widget.timeClockGateway,
        employeeId: employeeId,
        original: punch,
        canManage: _canManageAttendance,
      ),
    );
    if (saved == true) unawaited(_loadPunches());
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    if (!_canReadAttendance) return const _PermissionDenied();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _Card(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Mi checador', style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 14)),
              const SizedBox(height: 8),
              if (_selfEmployee != null)
                Text(
                  '${_selfEmployee!.displayName} (${_selfEmployee!.code})',
                  style: TextStyle(color: palette.textSecondary, fontSize: 12),
                )
              else
                TextField(
                  key: const Key('pos-timeclock-self-employee-id'),
                  controller: _selfEmployeeIdController,
                  onChanged: (_) => setState(() {}),
                  decoration: const InputDecoration(isDense: true, labelText: 'Id de tu empleado'),
                ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: FilledButton.icon(
                      key: const Key('pos-timeclock-clock-in'),
                      onPressed: _selfBusy || _selfEmployeeId == null ? null : () => unawaited(_punch(true)),
                      style: FilledButton.styleFrom(backgroundColor: palette.success),
                      icon: const Icon(Icons.login, size: 16),
                      label: const Text('Registrar entrada'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: FilledButton.icon(
                      key: const Key('pos-timeclock-clock-out'),
                      onPressed: _selfBusy || _selfEmployeeId == null ? null : () => unawaited(_punch(false)),
                      style: FilledButton.styleFrom(backgroundColor: palette.warning),
                      icon: const Icon(Icons.logout, size: 16),
                      label: const Text('Registrar salida'),
                    ),
                  ),
                ],
              ),
              if (_selfMessage != null) ...[
                const SizedBox(height: 10),
                Text(
                  _selfMessage!,
                  key: const Key('pos-timeclock-status-message'),
                  style: TextStyle(color: _selfMessageIsError ? palette.error : palette.success, fontSize: 12),
                ),
              ],
            ],
          ),
        ),
        const SizedBox(height: 12),
        if (!_canManageAttendance)
          const _PermissionDenied()
        else ...[
          _Card(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('Marcaciones por empleado', style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 14)),
                const SizedBox(height: 8),
                if (_employees.isNotEmpty)
                  DropdownButtonFormField<PosEmployee>(
                    key: const Key('pos-timeclock-manage-employee-select'),
                    initialValue: _managedEmployee,
                    isExpanded: true,
                    decoration: const InputDecoration(isDense: true, labelText: 'Empleado'),
                    items: [
                      for (final employee in _employees)
                        DropdownMenuItem(value: employee, child: Text('${employee.displayName} (${employee.code})')),
                    ],
                    onChanged: (value) => setState(() => _managedEmployee = value),
                  )
                else
                  TextField(
                    key: const Key('pos-timeclock-manage-employee-id'),
                    controller: _manageEmployeeIdController,
                    onChanged: (_) => setState(() {}),
                    decoration: const InputDecoration(isDense: true, labelText: 'Id del empleado'),
                  ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        key: const Key('pos-timeclock-manage-date-from'),
                        controller: _manageDateFromController,
                        decoration: const InputDecoration(isDense: true, labelText: 'Desde (YYYY-MM-DD)'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: TextField(
                        key: const Key('pos-timeclock-manage-date-to'),
                        controller: _manageDateToController,
                        decoration: const InputDecoration(isDense: true, labelText: 'Hasta (YYYY-MM-DD)'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    OutlinedButton.icon(
                      key: const Key('pos-timeclock-manage-load'),
                      onPressed: _manageEmployeeId == null ? null : () => unawaited(_loadPunches()),
                      icon: const Icon(Icons.search, size: 16),
                      label: const Text('Buscar'),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          switch (_managePhase) {
            _ListPhase.loading => const _Loading(),
            _ListPhase.empty => const _Empty(message: 'No hay marcaciones en ese rango.'),
            _ListPhase.failure => _Failure(
              message: _manageErrorMessage ?? 'No fue posible cargar las marcaciones.',
              onRetry: () => unawaited(_loadPunches()),
            ),
            _ListPhase.ready => Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [for (final punch in _punches) _PunchRow(punch: punch, onCorrect: () => unawaited(_openCorrection(punch)))],
            ),
          },
        ],
      ],
    );
  }
}

class _PunchRow extends StatelessWidget {
  const _PunchRow({required this.punch, required this.onCorrect});
  final PosTimeClockPunch punch;
  final VoidCallback onCorrect;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final isClockIn = punch.punchType == 'clock_in';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: _Card(
        key: Key('pos-timeclock-punch-row-${punch.id}'),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        child: Row(
          children: [
            Icon(isClockIn ? Icons.login : Icons.logout, size: 16, color: isClockIn ? palette.success : palette.warning),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${isClockIn ? 'Entrada' : 'Salida'} · ${_formatDateTime(punch.occurredAt)}',
                    style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 12),
                  ),
                  if (punch.isCorrection)
                    Text(
                      'Corrección · ${punch.correctionReason ?? ''}',
                      style: TextStyle(color: palette.textSecondary, fontSize: 10),
                    ),
                ],
              ),
            ),
            TextButton.icon(
              key: Key('pos-timeclock-correction-open-${punch.id}'),
              onPressed: onCorrect,
              icon: const Icon(Icons.edit_note, size: 16),
              label: const Text('Corregir'),
            ),
          ],
        ),
      ),
    );
  }
}

/// A correction NEVER edits or deletes [original] — it always inserts a
/// NEW punch referencing it (mirrors `time-clock.service.ts`'s own doc
/// comment) — hence the dialog's own copy/labels never say "editar"/
/// "eliminar" anywhere. Only reachable through `_ChecadorTabState`'s own
/// `attendance.manage`-gated management section, but Save stays its own
/// individually-gated action too (defense in depth, mirrors every other
/// dialog in this file).
class _CorrectionDialog extends StatefulWidget {
  const _CorrectionDialog({
    required this.gateway,
    required this.employeeId,
    required this.original,
    required this.canManage,
  });
  final PosTimeClockGateway gateway;
  final String employeeId;
  final PosTimeClockPunch original;
  final bool canManage;

  @override
  State<_CorrectionDialog> createState() => _CorrectionDialogState();
}

class _CorrectionDialogState extends State<_CorrectionDialog> {
  late String _punchType = widget.original.punchType;
  late final _occurredAtController = TextEditingController(text: widget.original.occurredAt.toIso8601String());
  final _stationController = TextEditingController();
  final _reasonController = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _occurredAtController.dispose();
    _stationController.dispose();
    _reasonController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final occurredAt = _occurredAtController.text.trim();
    final parsed = DateTime.tryParse(occurredAt);
    if (parsed == null) {
      setState(() => _error = 'La fecha/hora debe ser un valor ISO-8601 válido.');
      return;
    }
    final reason = _reasonController.text.trim();
    if (reason.isEmpty) {
      setState(() => _error = 'El motivo de la corrección es obligatorio.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final station = _stationController.text.trim();
    try {
      await widget.gateway.correctPunch(
        PosTimeClockCorrectionInput(
          employeeId: widget.employeeId,
          punchType: _punchType,
          occurredAt: parsed.toUtc().toIso8601String(),
          station: station.isEmpty ? null : station,
          correctionReason: reason,
          correctedPunchId: widget.original.id,
        ),
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
        _error = 'No fue posible registrar la corrección.';
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
          constraints: const BoxConstraints(maxWidth: 440, maxHeight: 580),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Registrar corrección',
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
                ),
                const SizedBox(height: 4),
                Text(
                  'Esto agrega una NUEVA marcación que referencia a la original — la marcación original nunca se edita ni se elimina.',
                  style: TextStyle(color: palette.textSecondary, fontSize: 11),
                ),
                const SizedBox(height: 14),
                DropdownButtonFormField<String>(
                  key: const Key('pos-timeclock-correction-type'),
                  initialValue: _punchType,
                  isExpanded: true,
                  decoration: const InputDecoration(isDense: true, labelText: 'Tipo de marcación'),
                  items: const [
                    DropdownMenuItem(value: 'clock_in', child: Text('Entrada')),
                    DropdownMenuItem(value: 'clock_out', child: Text('Salida')),
                  ],
                  onChanged: (value) => setState(() => _punchType = value ?? _punchType),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-timeclock-correction-occurred-at'),
                  controller: _occurredAtController,
                  decoration: const InputDecoration(isDense: true, labelText: 'Fecha/hora real (ISO-8601)'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-timeclock-correction-station'),
                  controller: _stationController,
                  decoration: const InputDecoration(isDense: true, labelText: 'Estación (opcional)'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-timeclock-correction-reason'),
                  controller: _reasonController,
                  maxLines: 2,
                  decoration: const InputDecoration(isDense: true, labelText: 'Motivo de la corrección'),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 10),
                  Text(
                    _error!,
                    key: const Key('pos-timeclock-correction-error'),
                    style: TextStyle(color: palette.error, fontSize: 12),
                  ),
                ],
                const SizedBox(height: 16),
                _DialogButtons(
                  busy: _busy,
                  onCancel: () => Navigator.of(context).pop(false),
                  onSave: () => unawaited(_submit()),
                  saveKey: const Key('pos-timeclock-correction-save'),
                  saveLabel: 'Guardar corrección',
                  saveEnabled: widget.canManage,
                  disabledTooltip: 'Se requiere el permiso attendance.manage.',
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
// Nómina — gated by `payroll.read`/`payroll.manage`/`payroll.close`.
// ---------------------------------------------------------------------

class _NominaTab extends StatefulWidget {
  const _NominaTab({required this.context, required this.employeesGateway, required this.payrollGateway});
  final AuthenticatedContext context;
  final PosEmployeesGateway employeesGateway;
  final PosPayrollGateway payrollGateway;

  @override
  State<_NominaTab> createState() => _NominaTabState();
}

class _NominaTabState extends State<_NominaTab> {
  bool get _canRead => widget.context.permissions.contains('payroll.read');
  bool get _canManage => widget.context.permissions.contains('payroll.manage');
  bool get _canClose => widget.context.permissions.contains('payroll.close');

  _ListPhase _phase = _ListPhase.loading;
  List<PosPayrollPeriod> _periods = const [];
  String? _errorMessage;
  String _statusFilter = 'all';
  Map<String, String> _employeeNames = const {};

  @override
  void initState() {
    super.initState();
    unawaited(_loadEmployeeNames());
    unawaited(_load());
  }

  Future<void> _loadEmployeeNames() async {
    try {
      final page = await widget.employeesGateway.listEmployees(branchId: widget.context.session.branchId, limit: 100);
      if (!mounted) return;
      setState(() => _employeeNames = {for (final employee in page.items) employee.id: employee.displayName});
    } on Object {
      // Honest fallback — no `employee.read` means payroll lines show the
      // real employee id instead of a resolved name; never fabricated.
    }
  }

  Future<void> _load() async {
    if (!_canRead) return;
    setState(() {
      _phase = _ListPhase.loading;
      _errorMessage = null;
    });
    try {
      final items = await widget.payrollGateway.listPeriods(
        branchId: widget.context.session.branchId,
        status: _statusFilter == 'all' ? null : _statusFilter,
      );
      if (!mounted) return;
      setState(() {
        _periods = items;
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
        _errorMessage = 'No fue posible cargar los periodos de nómina.';
      });
    }
  }

  Future<void> _openNewPeriod() async {
    final branchId = widget.context.session.branchId;
    if (branchId == null || !_canManage) return;
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _PayrollPeriodFormDialog(gateway: widget.payrollGateway, branchId: branchId),
    );
    if (saved == true) unawaited(_load());
  }

  Future<void> _openDetail(PosPayrollPeriod period) async {
    final changed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _PayrollPeriodDetailDialog(
        period: period,
        gateway: widget.payrollGateway,
        employeeNames: _employeeNames,
        canManage: _canManage,
        canClose: _canClose,
      ),
    );
    if (changed == true) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    if (!_canRead) return const _PermissionDenied();
    final branchId = widget.context.session.branchId;
    final newDisabledReason = !_canManage
        ? 'Se requiere el permiso payroll.manage.'
        : (branchId == null ? 'Selecciona una sucursal para crear un periodo.' : '');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            SizedBox(
              width: 170,
              child: DropdownButtonFormField<String>(
                key: const Key('pos-payroll-status-filter'),
                initialValue: _statusFilter,
                isExpanded: true,
                decoration: const InputDecoration(isDense: true, labelText: 'Estado'),
                items: const [
                  DropdownMenuItem(value: 'all', child: Text('Todos')),
                  DropdownMenuItem(value: 'draft', child: Text('Borrador')),
                  DropdownMenuItem(value: 'closed', child: Text('Cerrados')),
                ],
                onChanged: (value) {
                  setState(() => _statusFilter = value ?? 'all');
                  unawaited(_load());
                },
              ),
            ),
            const Spacer(),
            Tooltip(
              message: newDisabledReason,
              child: FilledButton.icon(
                key: const Key('pos-payroll-new'),
                onPressed: newDisabledReason.isEmpty ? () => unawaited(_openNewPeriod()) : null,
                style: FilledButton.styleFrom(backgroundColor: palette.action),
                icon: const Icon(Icons.add, size: 16),
                label: const Text('Nuevo periodo'),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        switch (_phase) {
          _ListPhase.loading => const _Loading(),
          _ListPhase.empty => const _Empty(message: 'No hay periodos de nómina.'),
          _ListPhase.failure => _Failure(
            message: _errorMessage ?? 'No fue posible cargar los periodos de nómina.',
            onRetry: () => unawaited(_load()),
          ),
          _ListPhase.ready => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [for (final period in _periods) _PayrollPeriodRow(period: period, onTap: () => unawaited(_openDetail(period)))],
          ),
        },
      ],
    );
  }
}

class _PayrollPeriodRow extends StatelessWidget {
  const _PayrollPeriodRow({required this.period, required this.onTap});
  final PosPayrollPeriod period;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return _Card(
      key: Key('pos-payroll-period-row-${period.id}'),
      padding: EdgeInsets.zero,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  '${period.periodStart} – ${period.periodEnd}',
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13),
                ),
              ),
              _StatusPill(label: period.status),
              const SizedBox(width: 8),
              Icon(Icons.chevron_right, size: 18, color: palette.textMuted),
            ],
          ),
        ),
      ),
    );
  }
}

class _PayrollPeriodFormDialog extends StatefulWidget {
  const _PayrollPeriodFormDialog({required this.gateway, required this.branchId});
  final PosPayrollGateway gateway;
  final String branchId;

  @override
  State<_PayrollPeriodFormDialog> createState() => _PayrollPeriodFormDialogState();
}

class _PayrollPeriodFormDialogState extends State<_PayrollPeriodFormDialog> {
  late final _startController = TextEditingController(text: _isoDate(DateTime.now()));
  late final _endController = TextEditingController(text: _isoDate(DateTime.now().add(const Duration(days: 6))));
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _startController.dispose();
    _endController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final start = _startController.text.trim();
    final end = _endController.text.trim();
    if (!_datePattern.hasMatch(start) || !_datePattern.hasMatch(end)) {
      setState(() => _error = 'Las fechas deben tener el formato YYYY-MM-DD.');
      return;
    }
    if (end.compareTo(start) < 0) {
      setState(() => _error = 'La fecha de fin no puede ser anterior a la fecha de inicio.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.gateway.createPeriod(branchId: widget.branchId, periodStart: start, periodEnd: end);
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
        _error = 'No fue posible crear el periodo.';
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
          constraints: const BoxConstraints(maxWidth: 400, maxHeight: 380),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Nuevo periodo de nómina',
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
                ),
                const SizedBox(height: 14),
                TextField(
                  key: const Key('pos-payroll-form-start'),
                  controller: _startController,
                  decoration: const InputDecoration(isDense: true, labelText: 'Inicio (YYYY-MM-DD)'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-payroll-form-end'),
                  controller: _endController,
                  decoration: const InputDecoration(isDense: true, labelText: 'Fin (YYYY-MM-DD)'),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 10),
                  Text(_error!, key: const Key('pos-payroll-form-error'), style: TextStyle(color: palette.error, fontSize: 12)),
                ],
                const SizedBox(height: 16),
                _DialogButtons(
                  busy: _busy,
                  onCancel: () => Navigator.of(context).pop(false),
                  onSave: () => unawaited(_submit()),
                  saveKey: const Key('pos-payroll-form-save'),
                  saveLabel: 'Crear',
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

enum _DetailPhase { loading, ready, failure }

/// The payroll period detail — always reachable with `payroll.read`;
/// "Calcular" (`payroll.manage`) and "Cerrar periodo"/"Reabrir"
/// (`payroll.close`, its own distinct action per direction — see
/// `payroll.service.ts`'s own doc comment) each stay individually gated,
/// disabled+`Tooltip`'d buttons. Every figure shown here is exactly what
/// [PosPayrollGateway.period]/`calculate` returned — never recomputed
/// client-side.
class _PayrollPeriodDetailDialog extends StatefulWidget {
  const _PayrollPeriodDetailDialog({
    required this.period,
    required this.gateway,
    required this.employeeNames,
    required this.canManage,
    required this.canClose,
  });
  final PosPayrollPeriod period;
  final PosPayrollGateway gateway;
  final Map<String, String> employeeNames;
  final bool canManage;
  final bool canClose;

  @override
  State<_PayrollPeriodDetailDialog> createState() => _PayrollPeriodDetailDialogState();
}

class _PayrollPeriodDetailDialogState extends State<_PayrollPeriodDetailDialog> {
  _DetailPhase _phase = _DetailPhase.loading;
  late PosPayrollPeriod _period = widget.period;
  List<PosPayrollPeriodLine> _lines = const [];
  String? _errorMessage;
  bool _busy = false;
  bool _changed = false;

  static const _manageTooltip = 'Se requiere el permiso payroll.manage.';
  static const _closeTooltip = 'Se requiere el permiso payroll.close.';

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    setState(() {
      _phase = _DetailPhase.loading;
      _errorMessage = null;
    });
    try {
      final detail = await widget.gateway.period(_period.id);
      if (!mounted) return;
      setState(() {
        _period = detail.period;
        _lines = detail.lines;
        _phase = _DetailPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _DetailPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _DetailPhase.failure;
        _errorMessage = 'No fue posible cargar el periodo.';
      });
    }
  }

  Future<void> _calculate() async {
    setState(() {
      _busy = true;
      _errorMessage = null;
    });
    try {
      final detail = await widget.gateway.calculate(_period.id);
      if (!mounted) return;
      setState(() {
        _period = detail.period;
        _lines = detail.lines;
        _busy = false;
        _changed = true;
        _phase = _DetailPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _errorMessage = 'No fue posible calcular la nómina.';
      });
    }
  }

  Future<void> _close() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Cerrar periodo'),
        content: const Text(
          'Al cerrar este periodo, sus líneas quedarán permanentemente inmutables. Esta acción no se puede deshacer.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(false), child: const Text('Cancelar')),
          FilledButton(
            key: const Key('pos-payroll-close-confirm'),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Cerrar periodo'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    setState(() {
      _busy = true;
      _errorMessage = null;
    });
    try {
      final updated = await widget.gateway.close(_period.id);
      if (!mounted) return;
      setState(() {
        _period = updated;
        _busy = false;
        _changed = true;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _errorMessage = 'No fue posible cerrar el periodo.';
      });
    }
  }

  Future<void> _reopen() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Reabrir periodo'),
        content: const Text(
          'Reabrir este periodo lo regresa a borrador para poder recalcularlo. Esta acción queda registrada de forma '
          'independiente al cierre.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(false), child: const Text('Cancelar')),
          FilledButton(
            key: const Key('pos-payroll-reopen-confirm'),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Reabrir periodo'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    setState(() {
      _busy = true;
      _errorMessage = null;
    });
    try {
      final updated = await widget.gateway.reopen(_period.id);
      if (!mounted) return;
      setState(() {
        _period = updated;
        _busy = false;
        _changed = true;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _errorMessage = 'No fue posible reabrir el periodo.';
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
          constraints: const BoxConstraints(maxWidth: 640, maxHeight: 700),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        '${_period.periodStart} – ${_period.periodEnd}',
                        style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
                      ),
                    ),
                    _StatusPill(label: _period.status),
                  ],
                ),
                const SizedBox(height: 14),
                if (_phase == _DetailPhase.loading)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 24),
                    child: Center(child: CircularProgressIndicator()),
                  )
                else if (_phase == _DetailPhase.failure)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: Text(_errorMessage ?? 'No fue posible cargar el periodo.', style: TextStyle(color: palette.error)),
                  )
                else if (_lines.isEmpty)
                  Text('Este periodo aún no ha sido calculado.', style: TextStyle(color: palette.textSecondary, fontSize: 12))
                else
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      for (final line in _lines) _PayrollLineRow(line: line, employeeName: widget.employeeNames[line.employeeId]),
                    ],
                  ),
                if (_errorMessage != null && _phase == _DetailPhase.ready) ...[
                  const SizedBox(height: 10),
                  Text(
                    _errorMessage!,
                    key: const Key('pos-payroll-detail-error'),
                    style: TextStyle(color: palette.error, fontSize: 12),
                  ),
                ],
                const SizedBox(height: 16),
                Wrap(
                  spacing: 10,
                  runSpacing: 10,
                  children: [
                    if (!_period.isClosed)
                      Tooltip(
                        message: widget.canManage ? '' : _manageTooltip,
                        child: FilledButton.icon(
                          key: const Key('pos-payroll-calculate'),
                          onPressed: _busy || !widget.canManage ? null : () => unawaited(_calculate()),
                          style: FilledButton.styleFrom(backgroundColor: palette.action),
                          icon: const Icon(Icons.calculate_outlined, size: 16),
                          label: const Text('Calcular'),
                        ),
                      ),
                    if (!_period.isClosed)
                      Tooltip(
                        message: widget.canClose ? '' : _closeTooltip,
                        child: OutlinedButton.icon(
                          key: const Key('pos-payroll-close'),
                          onPressed: _busy || !widget.canClose ? null : () => unawaited(_close()),
                          icon: const Icon(Icons.lock_clock_outlined, size: 16),
                          label: const Text('Cerrar periodo'),
                        ),
                      ),
                    if (_period.isClosed)
                      Tooltip(
                        message: widget.canClose ? '' : _closeTooltip,
                        child: OutlinedButton.icon(
                          key: const Key('pos-payroll-reopen'),
                          onPressed: _busy || !widget.canClose ? null : () => unawaited(_reopen()),
                          icon: const Icon(Icons.lock_open_outlined, size: 16),
                          label: const Text('Reabrir'),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 8),
                Center(child: TextButton(onPressed: () => Navigator.of(context).pop(_changed), child: const Text('Cerrar'))),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _PayrollLineRow extends StatelessWidget {
  const _PayrollLineRow({required this.line, this.employeeName});
  final PosPayrollPeriodLine line;
  final String? employeeName;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: _Card(
        key: Key('pos-payroll-line-row-${line.id}'),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              employeeName ?? line.employeeId,
              style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13),
            ),
            const SizedBox(height: 6),
            Wrap(
              spacing: 14,
              runSpacing: 4,
              children: [
                _MiniStat(label: 'Programado', value: '${line.scheduledMinutes} min'),
                _MiniStat(label: 'Trabajado', value: '${line.workedMinutes} min'),
                _MiniStat(label: 'Retardo', value: '${line.lateMinutes} min'),
                _MiniStat(label: 'Extra', value: '${line.overtimeMinutes} min'),
              ],
            ),
            const SizedBox(height: 6),
            Wrap(
              spacing: 14,
              runSpacing: 4,
              children: [
                _MiniStat(label: 'Base', value: _formatMoney(line.baseSalarySnapshot, line.currencyCode)),
                _MiniStat(label: 'Deducción', value: _formatMoney(line.deductionAmount, line.currencyCode)),
                _MiniStat(label: 'Bono', value: _formatMoney(line.bonusAmount, line.currencyCode)),
                _MiniStat(label: 'Total', value: _formatMoney(line.totalAmount, line.currencyCode)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _MiniStat extends StatelessWidget {
  const _MiniStat({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: TextStyle(color: palette.textMuted, fontSize: 9)),
        Text(value, style: TextStyle(color: palette.text, fontSize: 11, fontWeight: FontWeight.w700)),
      ],
    );
  }
}
