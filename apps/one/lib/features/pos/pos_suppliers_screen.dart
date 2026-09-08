/// TASK 14.4 (Wave 2, Part C.1) — "Proveedores" screen: a real supplier
/// contact directory (search/status-filter/list, create/edit, deactivate).
/// Structural template: `pos_shell.dart`'s own `_CustomersAdmin`/
/// `_CustomerFormDialog`/`_CustomerDetailDialog` (list + search + "+ Nuevo"
/// create/edit dialog + row-tap detail, company-scoped so no branch
/// filter). Deliberately a STANDALONE public file, not embedded in
/// `pos_shell.dart` — so it cannot reach that file's private `_PosCard`/
/// `_SectionHeader`/state-card widgets; every visual building block here
/// is its own small private widget, styled directly off the public
/// [PosPalette] (`pos_tokens.dart`) so it still looks like the rest of the
/// app.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/networking/api_client.dart';
import '../authentication/auth_models.dart';
import 'pos_suppliers_gateway.dart';
import 'pos_tokens.dart';

// Same format the backend's own `suppliers.service.ts` `EMAIL_PATTERN`
// enforces server-side (and, ultimately, `suppliers_email_format_ck` in
// `packages/database/src/schema/suppliers.ts`) — validated client-side
// FIRST so a malformed email never even reaches the network, but the
// backend's own check remains the real source of truth.
final RegExp _emailPattern = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');

enum _SupplierListPhase { loading, empty, failure, ready }

/// The public "Proveedores" module screen. Constructed by
/// `pos_shell.dart`'s `PosModule.suppliers` switch case with the real
/// [AuthenticatedContext] and a real [PosSuppliersGateway] — see this
/// file's header for why it stays a standalone public widget.
class PosSuppliersScreen extends StatefulWidget {
  const PosSuppliersScreen({required this.context, required this.suppliersGateway, super.key});

  final AuthenticatedContext context;
  final PosSuppliersGateway suppliersGateway;

  @override
  State<PosSuppliersScreen> createState() => _PosSuppliersScreenState();
}

class _PosSuppliersScreenState extends State<PosSuppliersScreen> {
  _SupplierListPhase _phase = _SupplierListPhase.loading;
  List<PosSupplier> _items = const [];
  String? _nextCursor;
  bool _loadingMore = false;
  String? _errorMessage;
  String _query = '';
  // `null` = todos los estados — the backend's own default when `status`
  // is omitted from the querystring.
  String? _statusFilter;

  bool get _canRead => widget.context.permissions.contains('supplier.read');
  bool get _canManage => widget.context.permissions.contains('supplier.manage');

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    if (!_canRead) return;
    setState(() {
      _phase = _SupplierListPhase.loading;
      _errorMessage = null;
    });
    try {
      final page = await widget.suppliersGateway.listSuppliers(status: _statusFilter);
      if (!mounted) return;
      setState(() {
        _items = page.items;
        _nextCursor = page.nextCursor;
        _phase = _visibleItems.isEmpty ? _SupplierListPhase.empty : _SupplierListPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _SupplierListPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _SupplierListPhase.failure;
        _errorMessage = 'No fue posible cargar los proveedores.';
      });
    }
  }

  Future<void> _loadMore() async {
    final cursor = _nextCursor;
    if (cursor == null || _loadingMore) return;
    setState(() => _loadingMore = true);
    try {
      final page = await widget.suppliersGateway.listSuppliers(status: _statusFilter, cursor: cursor);
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

  // The backend accepts no server-side text search (see
  // `pos_suppliers_gateway.dart`'s own doc comment) — this filters the
  // real already-fetched items locally by name/contact/phone/email,
  // never a fabricated request.
  List<PosSupplier> get _visibleItems {
    final query = _query.trim().toLowerCase();
    if (query.isEmpty) return _items;
    return _items
        .where(
          (supplier) =>
              supplier.name.toLowerCase().contains(query) ||
              (supplier.contactName?.toLowerCase().contains(query) ?? false) ||
              (supplier.phone?.toLowerCase().contains(query) ?? false) ||
              (supplier.email?.toLowerCase().contains(query) ?? false),
        )
        .toList(growable: false);
  }

  void _onQueryChanged(String value) => setState(() => _query = value);

  void _onStatusFilterChanged(String? value) {
    setState(() => _statusFilter = value);
    unawaited(_load());
  }

  Future<void> _openNewSupplierForm() async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _SupplierFormDialog(suppliersGateway: widget.suppliersGateway),
    );
    if (saved == true) unawaited(_load());
  }

  Future<void> _openDetail(PosSupplier supplier) async {
    final changed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _SupplierDetailDialog(
        supplier: supplier,
        canManage: _canManage,
        suppliersGateway: widget.suppliersGateway,
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
                  'Proveedores',
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 20),
                ),
              ),
              IconButton(
                key: const Key('pos-suppliers-refresh'),
                tooltip: 'Actualizar',
                onPressed: () => unawaited(_load()),
                icon: Icon(Icons.refresh, color: palette.textSecondary),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Directorio de proveedores — búsqueda, alta, edición y baja lógica.',
            style: TextStyle(color: palette.textSecondary, fontSize: 13),
          ),
          const SizedBox(height: 16),
          if (!_canRead)
            const _SupplierPermissionState()
          else ...[
            Row(
              children: [
                Expanded(
                  child: TextField(
                    key: const Key('pos-suppliers-search'),
                    onChanged: _onQueryChanged,
                    decoration: const InputDecoration(
                      isDense: true,
                      hintText: 'Buscar por nombre, contacto, teléfono o correo',
                      prefixIcon: Icon(Icons.search),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                SizedBox(
                  width: 170,
                  child: DropdownButtonFormField<String?>(
                    key: const Key('pos-suppliers-status-filter'),
                    initialValue: _statusFilter,
                    isExpanded: true,
                    decoration: const InputDecoration(isDense: true, labelText: 'Estado'),
                    items: const [
                      DropdownMenuItem(value: null, child: Text('Todos')),
                      DropdownMenuItem(value: 'active', child: Text('Activos')),
                      DropdownMenuItem(value: 'inactive', child: Text('Inactivos')),
                    ],
                    onChanged: _onStatusFilterChanged,
                  ),
                ),
                const SizedBox(width: 10),
                Tooltip(
                  message: _canManage ? 'Nuevo proveedor' : 'Tu sesión no incluye el permiso supplier.manage.',
                  child: FilledButton.icon(
                    key: const Key('pos-suppliers-new'),
                    onPressed: _canManage ? () => unawaited(_openNewSupplierForm()) : null,
                    style: FilledButton.styleFrom(backgroundColor: palette.action),
                    icon: const Icon(Icons.add_business_outlined, size: 16),
                    label: const Text('Nuevo'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            switch (_phase) {
              _SupplierListPhase.loading => const _SupplierLoadingState(),
              _SupplierListPhase.empty => const _SupplierEmptyState(message: 'No hay proveedores registrados.'),
              _SupplierListPhase.failure => _SupplierFailureState(
                message: _errorMessage ?? 'No fue posible cargar los proveedores.',
                onRetry: () => unawaited(_load()),
              ),
              _SupplierListPhase.ready => Builder(
                builder: (context) {
                  final visible = _visibleItems;
                  if (visible.isEmpty) {
                    return const _SupplierEmptyState(message: 'Ningún proveedor coincide con la búsqueda.');
                  }
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      for (final supplier in visible)
                        _SupplierRow(supplier: supplier, onTap: () => unawaited(_openDetail(supplier))),
                      if (_nextCursor != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 12),
                          child: Center(
                            child: OutlinedButton.icon(
                              key: const Key('pos-suppliers-load-more'),
                              onPressed: _loadingMore ? null : () => unawaited(_loadMore()),
                              icon: _loadingMore
                                  ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                                  : const Icon(Icons.expand_more),
                              label: const Text('Cargar más'),
                            ),
                          ),
                        ),
                    ],
                  );
                },
              ),
            },
          ],
        ],
      ),
    );
  }
}

class _SupplierRow extends StatelessWidget {
  const _SupplierRow({required this.supplier, required this.onTap});
  final PosSupplier supplier;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final subtitleParts = [
      if (supplier.contactName != null && supplier.contactName!.isNotEmpty) supplier.contactName!,
      if (supplier.phone != null && supplier.phone!.isNotEmpty) supplier.phone!,
      if (supplier.email != null && supplier.email!.isNotEmpty) supplier.email!,
    ];
    return Card(
      key: Key('pos-suppliers-row-${supplier.id}'),
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
                      supplier.name,
                      style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13),
                    ),
                    if (subtitleParts.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(
                        subtitleParts.join(' · '),
                        style: TextStyle(color: palette.textSecondary, fontSize: 12),
                      ),
                    ],
                  ],
                ),
              ),
              _SupplierStatusChip(status: supplier.status),
              const SizedBox(width: 8),
              Icon(Icons.chevron_right, size: 18, color: palette.textMuted),
            ],
          ),
        ),
      ),
    );
  }
}

class _SupplierStatusChip extends StatelessWidget {
  const _SupplierStatusChip({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final active = status == 'active';
    final color = active ? palette.success : palette.textMuted;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: color.withValues(alpha: .12), borderRadius: BorderRadius.circular(20)),
      child: Text(
        active ? 'Activo' : 'Inactivo',
        style: TextStyle(color: color, fontWeight: FontWeight.w700, fontSize: 11),
      ),
    );
  }
}

/// New/edit supplier dialog — mirrors `_CustomerFormDialog`'s exact shape:
/// only `name` required (Part E-style minimum friction), a 409 conflict on
/// create/rename offers the existing supplier id instead of retrying
/// blindly (`SupplierError`'s own `details` convention).
class _SupplierFormDialog extends StatefulWidget {
  const _SupplierFormDialog({required this.suppliersGateway, this.existing});
  final PosSuppliersGateway suppliersGateway;
  final PosSupplier? existing;

  @override
  State<_SupplierFormDialog> createState() => _SupplierFormDialogState();
}

class _SupplierFormDialogState extends State<_SupplierFormDialog> {
  late final _nameController = TextEditingController(text: widget.existing?.name ?? '');
  late final _contactNameController = TextEditingController(text: widget.existing?.contactName ?? '');
  late final _phoneController = TextEditingController(text: widget.existing?.phone ?? '');
  late final _emailController = TextEditingController(text: widget.existing?.email ?? '');
  late final _notesController = TextEditingController(text: widget.existing?.notes ?? '');
  late String _status = widget.existing?.status ?? 'active';
  bool _busy = false;
  String? _error;
  String? _existingSupplierId;

  bool get _isEdit => widget.existing != null;

  @override
  void dispose() {
    _nameController.dispose();
    _contactNameController.dispose();
    _phoneController.dispose();
    _emailController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final name = _nameController.text.trim();
    if (name.isEmpty) {
      setState(() => _error = 'El nombre es obligatorio.');
      return;
    }
    final email = _emailController.text.trim();
    // Mirrors the backend's own `EMAIL_PATTERN` check in
    // `suppliers.service.ts` — rejected here first so a malformed email
    // never reaches the network.
    if (email.isNotEmpty && !_emailPattern.hasMatch(email)) {
      setState(() => _error = 'El correo no tiene un formato válido.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _existingSupplierId = null;
    });
    final contactName = _contactNameController.text.trim();
    final phone = _phoneController.text.trim();
    final notes = _notesController.text.trim();
    final input = PosSupplierInput(
      name: name,
      contactName: contactName.isEmpty ? null : contactName,
      phone: phone.isEmpty ? null : phone,
      email: email.isEmpty ? null : email,
      notes: notes.isEmpty ? null : notes,
      status: _isEdit ? _status : null,
    );
    try {
      if (_isEdit) {
        await widget.suppliersGateway.updateSupplier(widget.existing!.id, input);
      } else {
        await widget.suppliersGateway.createSupplier(input);
      }
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      if (!mounted) return;
      final conflict = posSupplierConflictFrom(error);
      setState(() {
        _busy = false;
        _error = conflict?.message ?? error.failure.message;
        _existingSupplierId = conflict?.existingSupplierId;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible guardar el proveedor.';
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
          constraints: const BoxConstraints(maxWidth: 420, maxHeight: 640),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  _isEdit ? 'Editar proveedor' : 'Nuevo proveedor',
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
                ),
                const SizedBox(height: 14),
                TextField(
                  key: const Key('pos-suppliers-form-name'),
                  controller: _nameController,
                  decoration: const InputDecoration(isDense: true, labelText: 'Nombre'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-suppliers-form-contact-name'),
                  controller: _contactNameController,
                  decoration: const InputDecoration(isDense: true, labelText: 'Persona de contacto (opcional)'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-suppliers-form-phone'),
                  controller: _phoneController,
                  keyboardType: TextInputType.phone,
                  decoration: const InputDecoration(isDense: true, labelText: 'Teléfono (opcional)'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-suppliers-form-email'),
                  controller: _emailController,
                  keyboardType: TextInputType.emailAddress,
                  decoration: const InputDecoration(isDense: true, labelText: 'Correo (opcional)'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-suppliers-form-notes'),
                  controller: _notesController,
                  maxLines: 2,
                  decoration: const InputDecoration(isDense: true, labelText: 'Notas (opcional)'),
                ),
                if (_isEdit) ...[
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    key: const Key('pos-suppliers-form-status'),
                    initialValue: _status,
                    isExpanded: true,
                    decoration: const InputDecoration(isDense: true, labelText: 'Estado'),
                    items: const [
                      DropdownMenuItem(value: 'active', child: Text('Activo')),
                      DropdownMenuItem(value: 'inactive', child: Text('Inactivo')),
                    ],
                    onChanged: (value) => setState(() => _status = value ?? 'active'),
                  ),
                ],
                if (_error != null) ...[
                  const SizedBox(height: 10),
                  Text(_error!, key: const Key('pos-suppliers-form-error'), style: TextStyle(color: palette.error, fontSize: 12)),
                ],
                if (_existingSupplierId != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    'Id del proveedor existente: $_existingSupplierId',
                    key: const Key('pos-suppliers-form-existing-id'),
                    style: TextStyle(color: palette.textSecondary, fontSize: 11),
                  ),
                ],
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        key: const Key('pos-suppliers-form-cancel'),
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
                        key: const Key('pos-suppliers-form-save'),
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

/// Supplier Detail — the full record plus Editar/Desactivar actions, both
/// gated on the real `supplier.manage` permission (never merely hidden by
/// a client-side guess — the button stays visible-but-disabled with a
/// [Tooltip] explaining why, mirroring `_HeldSalesTable`'s own established
/// disabled+[Tooltip] pattern in `pos_shell.dart`).
class _SupplierDetailDialog extends StatefulWidget {
  const _SupplierDetailDialog({required this.supplier, required this.canManage, required this.suppliersGateway});
  final PosSupplier supplier;
  final bool canManage;
  final PosSuppliersGateway suppliersGateway;

  @override
  State<_SupplierDetailDialog> createState() => _SupplierDetailDialogState();
}

class _SupplierDetailDialogState extends State<_SupplierDetailDialog> {
  late PosSupplier _supplier = widget.supplier;
  bool _changed = false;
  bool _busy = false;
  String? _error;

  bool get _isActive => _supplier.status == 'active';

  Future<void> _edit() async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _SupplierFormDialog(suppliersGateway: widget.suppliersGateway, existing: _supplier),
    );
    if (saved != true || !mounted) return;
    setState(() => _changed = true);
    try {
      final refreshed = await widget.suppliersGateway.supplier(_supplier.id);
      if (!mounted) return;
      setState(() => _supplier = refreshed);
    } on Object {
      // The edit itself already succeeded — a failed refresh here just
      // means the dialog keeps showing the pre-edit snapshot; the caller
      // still reloads the real list on close via `_changed`.
    }
  }

  Future<void> _deactivate() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Desactivar proveedor'),
        content: Text('¿Desactivar a «${_supplier.name}»? Podrás reactivarlo después desde Editar.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(false), child: const Text('Cancelar')),
          FilledButton(
            key: const Key('pos-suppliers-detail-deactivate-confirm'),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Desactivar'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final updated = await widget.suppliersGateway.deactivateSupplier(_supplier.id);
      if (!mounted) return;
      setState(() {
        _supplier = updated;
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
        _error = 'No fue posible desactivar el proveedor.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final supplier = _supplier;
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 440, maxHeight: 560),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        supplier.name,
                        key: const Key('pos-suppliers-detail-name'),
                        style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
                      ),
                    ),
                    _SupplierStatusChip(status: supplier.status),
                  ],
                ),
                const SizedBox(height: 14),
                _SupplierDetailField(label: 'Persona de contacto', value: supplier.contactName),
                _SupplierDetailField(label: 'Teléfono', value: supplier.phone),
                _SupplierDetailField(label: 'Correo', value: supplier.email),
                _SupplierDetailField(label: 'Notas', value: supplier.notes),
                const SizedBox(height: 4),
                Text(
                  'Creado ${_formatTimestamp(supplier.createdAt)} · Actualizado ${_formatTimestamp(supplier.updatedAt)}',
                  style: TextStyle(color: palette.textMuted, fontSize: 11),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 10),
                  Text(_error!, key: const Key('pos-suppliers-detail-error'), style: TextStyle(color: palette.error, fontSize: 12)),
                ],
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: Tooltip(
                        message: widget.canManage
                            ? 'Editar proveedor'
                            : 'Tu sesión no incluye el permiso supplier.manage.',
                        child: OutlinedButton.icon(
                          key: const Key('pos-suppliers-detail-edit'),
                          onPressed: widget.canManage ? () => unawaited(_edit()) : null,
                          icon: const Icon(Icons.edit_outlined, size: 16),
                          label: const Text('Editar'),
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    if (_isActive)
                      Expanded(
                        child: Tooltip(
                          message: widget.canManage
                              ? 'Desactivar proveedor'
                              : 'Tu sesión no incluye el permiso supplier.manage.',
                          child: OutlinedButton.icon(
                            key: const Key('pos-suppliers-detail-deactivate'),
                            onPressed: widget.canManage && !_busy ? () => unawaited(_deactivate()) : null,
                            style: OutlinedButton.styleFrom(foregroundColor: palette.error),
                            icon: _busy
                                ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                                : const Icon(Icons.block, size: 16),
                            label: const Text('Desactivar'),
                          ),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 10),
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton(
                    key: const Key('pos-suppliers-detail-close'),
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

class _SupplierDetailField extends StatelessWidget {
  const _SupplierDetailField({required this.label, required this.value});
  final String label;
  final String? value;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final display = value == null || value!.isEmpty ? '—' : value!;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 140,
            child: Text(label, style: TextStyle(color: palette.textSecondary, fontSize: 12, fontWeight: FontWeight.w600)),
          ),
          Expanded(child: Text(display, style: TextStyle(color: palette.text, fontSize: 13))),
        ],
      ),
    );
  }
}

class _SupplierLoadingState extends StatelessWidget {
  const _SupplierLoadingState();
  @override
  Widget build(BuildContext context) => const Padding(
    padding: EdgeInsets.symmetric(vertical: 40),
    child: Center(child: CircularProgressIndicator()),
  );
}

class _SupplierEmptyState extends StatelessWidget {
  const _SupplierEmptyState({required this.message});
  final String message;
  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 40),
      child: Center(
        child: Text(message, style: TextStyle(color: palette.textMuted, fontSize: 13)),
      ),
    );
  }
}

class _SupplierFailureState extends StatelessWidget {
  const _SupplierFailureState({required this.message, required this.onRetry});
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

class _SupplierPermissionState extends StatelessWidget {
  const _SupplierPermissionState();
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
              'Tu sesión no incluye el permiso de lectura requerido (supplier.read).',
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
