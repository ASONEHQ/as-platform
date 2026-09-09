/// TASK 15.1 Phase 4 — "Marcas" admin screen: real brand
/// search/status-filter/list, create/edit (`GET/POST /api/v1/brands`,
/// `PATCH /api/v1/brands/:id`, `catalog.routes.ts:305,333,379`). Before
/// this file, brands had zero Flutter usage anywhere in the app.
///
/// Structural template: `pos_category_admin_screen.dart` (this wave's own
/// sibling), trimmed to a brand's flatter shape (no parent/sort-order/
/// visual-tile fields — see `pos_brand_admin_gateway.dart`'s header).
/// Deliberately a STANDALONE public file.
///
/// Permission gating: create ("Nueva marca") and per-row edit are gated on
/// `product.manage` (the real permission `POST/PATCH /api/v1/brands`
/// requires — NOT `brand.manage`, which does not exist as a permission in
/// this backend) — an actor without it sees no such affordance at all, but
/// always sees the real read-only brand list with `catalog.read`.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/networking/api_client.dart';
import '../authentication/auth_models.dart';
import 'pos_brand_admin_gateway.dart';
import 'pos_tokens.dart';

enum _BrandListPhase { loading, empty, failure, ready }

/// The public "Marcas" module screen. Constructed with the real
/// [AuthenticatedContext] and a real [PosBrandAdminGateway] — e.g.
/// `PosBrandAdminScreen(context: this.context, gateway: brandAdminGateway)`.
class PosBrandAdminScreen extends StatefulWidget {
  const PosBrandAdminScreen({required this.context, required this.gateway, super.key});

  final AuthenticatedContext context;
  final PosBrandAdminGateway gateway;

  @override
  State<PosBrandAdminScreen> createState() => _PosBrandAdminScreenState();
}

class _PosBrandAdminScreenState extends State<PosBrandAdminScreen> {
  _BrandListPhase _phase = _BrandListPhase.loading;
  List<PosCatalogBrand> _items = const [];
  String? _nextCursor;
  bool _loadingMore = false;
  String? _errorMessage;
  String _query = '';
  String? _statusFilter;

  bool get _canRead => widget.context.permissions.contains('catalog.read');
  bool get _canManage => widget.context.permissions.contains('product.manage');

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    if (!_canRead) return;
    setState(() {
      _phase = _BrandListPhase.loading;
      _errorMessage = null;
    });
    try {
      final page = await widget.gateway.listBrands(status: _statusFilter);
      if (!mounted) return;
      setState(() {
        _items = page.items;
        _nextCursor = page.nextCursor;
        _phase = _visibleItems.isEmpty ? _BrandListPhase.empty : _BrandListPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _BrandListPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _BrandListPhase.failure;
        _errorMessage = 'No fue posible cargar las marcas.';
      });
    }
  }

  Future<void> _loadMore() async {
    final cursor = _nextCursor;
    if (cursor == null || _loadingMore) return;
    setState(() => _loadingMore = true);
    try {
      final page = await widget.gateway.listBrands(status: _statusFilter, cursor: cursor);
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

  List<PosCatalogBrand> get _visibleItems {
    final query = _query.trim().toLowerCase();
    if (query.isEmpty) return _items;
    return _items
        .where(
          (brand) => brand.name.toLowerCase().contains(query) || brand.code.toLowerCase().contains(query),
        )
        .toList(growable: false);
  }

  void _onQueryChanged(String value) => setState(() => _query = value);

  void _onStatusFilterChanged(String? value) {
    setState(() => _statusFilter = value);
    unawaited(_load());
  }

  Future<void> _openNewBrandForm() async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _BrandFormDialog(gateway: widget.gateway),
    );
    if (saved == true) unawaited(_load());
  }

  Future<void> _openEditBrandForm(PosCatalogBrand brand) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _BrandFormDialog(gateway: widget.gateway, existing: brand),
    );
    if (saved == true) unawaited(_load());
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
                  'Marcas',
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 20),
                ),
              ),
              IconButton(
                key: const Key('pos-brand-admin-refresh'),
                tooltip: 'Actualizar',
                onPressed: () => unawaited(_load()),
                icon: Icon(Icons.refresh, color: palette.textSecondary),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Marcas de productos — búsqueda, alta y edición.',
            style: TextStyle(color: palette.textSecondary, fontSize: 13),
          ),
          const SizedBox(height: 16),
          if (!_canRead)
            const _BrandPermissionState()
          else ...[
            Row(
              children: [
                Expanded(
                  child: TextField(
                    key: const Key('pos-brand-admin-search'),
                    onChanged: _onQueryChanged,
                    decoration: const InputDecoration(
                      isDense: true,
                      hintText: 'Buscar por nombre o código',
                      prefixIcon: Icon(Icons.search),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                SizedBox(
                  width: 170,
                  child: DropdownButtonFormField<String?>(
                    key: const Key('pos-brand-admin-status-filter'),
                    initialValue: _statusFilter,
                    isExpanded: true,
                    decoration: const InputDecoration(isDense: true, labelText: 'Estado'),
                    items: const [
                      DropdownMenuItem(value: null, child: Text('Todos')),
                      DropdownMenuItem(value: 'active', child: Text('Activas')),
                      DropdownMenuItem(value: 'inactive', child: Text('Inactivas')),
                      DropdownMenuItem(value: 'retired', child: Text('Retiradas')),
                    ],
                    onChanged: _onStatusFilterChanged,
                  ),
                ),
                const SizedBox(width: 10),
                Tooltip(
                  message: _canManage ? 'Nueva marca' : 'Tu sesión no incluye el permiso product.manage.',
                  child: FilledButton.icon(
                    key: const Key('pos-brand-admin-new'),
                    onPressed: _canManage ? () => unawaited(_openNewBrandForm()) : null,
                    style: FilledButton.styleFrom(backgroundColor: palette.action),
                    icon: const Icon(Icons.add, size: 16),
                    label: const Text('Nueva'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            switch (_phase) {
              _BrandListPhase.loading => const _BrandLoadingState(),
              _BrandListPhase.empty => const _BrandEmptyState(message: 'No hay marcas registradas.'),
              _BrandListPhase.failure => _BrandFailureState(
                message: _errorMessage ?? 'No fue posible cargar las marcas.',
                onRetry: () => unawaited(_load()),
              ),
              _BrandListPhase.ready => Builder(
                builder: (context) {
                  final visible = _visibleItems;
                  if (visible.isEmpty) {
                    return const _BrandEmptyState(message: 'Ninguna marca coincide con la búsqueda.');
                  }
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      for (final brand in visible)
                        _BrandRow(
                          brand: brand,
                          canManage: _canManage,
                          onEdit: () => unawaited(_openEditBrandForm(brand)),
                        ),
                      if (_nextCursor != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 12),
                          child: Center(
                            child: OutlinedButton.icon(
                              key: const Key('pos-brand-admin-load-more'),
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

class _BrandRow extends StatelessWidget {
  const _BrandRow({required this.brand, required this.canManage, required this.onEdit});
  final PosCatalogBrand brand;
  final bool canManage;
  final VoidCallback onEdit;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Card(
      key: Key('pos-brand-admin-row-${brand.id}'),
      margin: const EdgeInsets.only(bottom: 8),
      color: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: palette.border)),
      child: InkWell(
        onTap: canManage ? onEdit : null,
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
                      brand.name,
                      style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Código ${brand.code}',
                      style: TextStyle(color: palette.textSecondary, fontSize: 11),
                    ),
                  ],
                ),
              ),
              _BrandStatusChip(status: brand.status),
              if (canManage) ...[
                const SizedBox(width: 8),
                IconButton(
                  key: Key('pos-brand-admin-edit-${brand.id}'),
                  tooltip: 'Editar marca',
                  onPressed: onEdit,
                  icon: Icon(Icons.edit_outlined, size: 18, color: palette.textSecondary),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _BrandStatusChip extends StatelessWidget {
  const _BrandStatusChip({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final color = switch (status) {
      'active' => palette.success,
      'inactive' => palette.textMuted,
      _ => palette.error,
    };
    final label = switch (status) {
      'active' => 'Activa',
      'inactive' => 'Inactiva',
      _ => 'Retirada',
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: color.withValues(alpha: .12), borderRadius: BorderRadius.circular(20)),
      child: Text(label, style: TextStyle(color: color, fontWeight: FontWeight.w700, fontSize: 11)),
    );
  }
}

/// New/edit brand dialog. `code`/`name` are the only backend-required
/// fields on create (`brandCreateSchema` in `catalog.routes.ts`); `code` is
/// never editable once created.
class _BrandFormDialog extends StatefulWidget {
  const _BrandFormDialog({required this.gateway, this.existing});
  final PosBrandAdminGateway gateway;
  final PosCatalogBrand? existing;

  @override
  State<_BrandFormDialog> createState() => _BrandFormDialogState();
}

class _BrandFormDialogState extends State<_BrandFormDialog> {
  late final _codeController = TextEditingController(text: widget.existing?.code ?? '');
  late final _nameController = TextEditingController(text: widget.existing?.name ?? '');
  late final _descriptionController = TextEditingController(text: widget.existing?.description ?? '');
  late String _status = widget.existing?.status ?? 'active';
  bool _busy = false;
  String? _error;

  bool get _isEdit => widget.existing != null;

  @override
  void dispose() {
    _codeController.dispose();
    _nameController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final code = _codeController.text.trim();
    if (!_isEdit && code.isEmpty) {
      setState(() => _error = 'El código es obligatorio.');
      return;
    }
    final name = _nameController.text.trim();
    if (name.isEmpty) {
      setState(() => _error = 'El nombre es obligatorio.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final description = _descriptionController.text.trim();
    final input = PosBrandInput(
      code: _isEdit ? null : code,
      name: name,
      description: description.isEmpty ? null : description,
      status: _isEdit ? _status : null,
    );
    try {
      if (_isEdit) {
        await widget.gateway.updateBrand(widget.existing!.id, widget.existing!.version, input);
      } else {
        await widget.gateway.createBrand(input);
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
        _error = 'No fue posible guardar la marca.';
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
                  _isEdit ? 'Editar marca' : 'Nueva marca',
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
                ),
                const SizedBox(height: 14),
                if (!_isEdit) ...[
                  TextField(
                    key: const Key('pos-brand-admin-form-code'),
                    controller: _codeController,
                    decoration: const InputDecoration(isDense: true, labelText: 'Código'),
                  ),
                  const SizedBox(height: 10),
                ],
                TextField(
                  key: const Key('pos-brand-admin-form-name'),
                  controller: _nameController,
                  decoration: const InputDecoration(isDense: true, labelText: 'Nombre'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-brand-admin-form-description'),
                  controller: _descriptionController,
                  maxLines: 2,
                  decoration: const InputDecoration(isDense: true, labelText: 'Descripción (opcional)'),
                ),
                if (_isEdit) ...[
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    key: const Key('pos-brand-admin-form-status'),
                    initialValue: _status,
                    isExpanded: true,
                    decoration: const InputDecoration(isDense: true, labelText: 'Estado'),
                    items: const [
                      DropdownMenuItem(value: 'active', child: Text('Activa')),
                      DropdownMenuItem(value: 'inactive', child: Text('Inactiva')),
                      DropdownMenuItem(value: 'retired', child: Text('Retirada')),
                    ],
                    onChanged: (value) => setState(() => _status = value ?? 'active'),
                  ),
                ],
                if (_error != null) ...[
                  const SizedBox(height: 10),
                  Text(
                    _error!,
                    key: const Key('pos-brand-admin-form-error'),
                    style: TextStyle(color: palette.error, fontSize: 12),
                  ),
                ],
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        key: const Key('pos-brand-admin-form-cancel'),
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
                        key: const Key('pos-brand-admin-form-save'),
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

class _BrandLoadingState extends StatelessWidget {
  const _BrandLoadingState();
  @override
  Widget build(BuildContext context) => const Padding(
    padding: EdgeInsets.symmetric(vertical: 40),
    child: Center(child: CircularProgressIndicator()),
  );
}

class _BrandEmptyState extends StatelessWidget {
  const _BrandEmptyState({required this.message});
  final String message;
  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 40),
      child: Center(child: Text(message, style: TextStyle(color: palette.textMuted, fontSize: 13))),
    );
  }
}

class _BrandFailureState extends StatelessWidget {
  const _BrandFailureState({required this.message, required this.onRetry});
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

class _BrandPermissionState extends StatelessWidget {
  const _BrandPermissionState();
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
              'Tu sesión no incluye el permiso de lectura requerido (catalog.read).',
              style: TextStyle(color: palette.textMuted, fontSize: 13),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}
