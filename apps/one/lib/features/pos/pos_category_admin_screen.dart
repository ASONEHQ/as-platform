/// TASK 15.1 Phase 4 — "Categorías" admin screen: real category
/// search/status-filter/list, create/edit (`GET/POST /api/v1/categories`,
/// `PATCH /api/v1/categories/:id`, `catalog.routes.ts:141,170,231,250`).
/// Before this file, `PosModule.categories` had no case at all in
/// `pos_shell.dart`'s switch and fell through to `_ComingSoon` — this is
/// the first real create/edit surface for categories anywhere in the app.
///
/// Structural template: `pos_suppliers_screen.dart` (list + search +
/// status filter + "+ Nueva" create/edit dialog), diverging only where the
/// real backend contract itself does — see `pos_category_admin_gateway.dart`'s
/// own header comment for the exact list. Deliberately a STANDALONE public
/// file: never imports `pos_shell.dart`'s private widgets, and never
/// touches `pos_product_variants_screen.dart`.
///
/// Permission gating: the create ("Nueva categoría") and per-row edit
/// controls are gated on `category.manage` — an actor without it sees NO
/// such affordance at all (never merely disabled), but always sees the
/// real, honest read-only category list as long as it has `catalog.read`.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/networking/api_client.dart';
import '../authentication/auth_models.dart';
import 'pos_category_admin_gateway.dart';
import 'pos_tokens.dart';

enum _CategoryListPhase { loading, empty, failure, ready }

/// The public "Categorías" module screen. Constructed with the real
/// [AuthenticatedContext] and a real [PosCategoryAdminGateway] — e.g.
/// `PosCategoryAdminScreen(context: this.context, gateway: categoryAdminGateway)`.
class PosCategoryAdminScreen extends StatefulWidget {
  const PosCategoryAdminScreen({required this.context, required this.gateway, super.key});

  final AuthenticatedContext context;
  final PosCategoryAdminGateway gateway;

  @override
  State<PosCategoryAdminScreen> createState() => _PosCategoryAdminScreenState();
}

class _PosCategoryAdminScreenState extends State<PosCategoryAdminScreen> {
  _CategoryListPhase _phase = _CategoryListPhase.loading;
  List<PosCatalogCategory> _items = const [];
  String? _nextCursor;
  bool _loadingMore = false;
  String? _errorMessage;
  String _query = '';
  // `null` = todos los estados — the backend's own default when `status`
  // is omitted from the querystring.
  String? _statusFilter;

  bool get _canRead => widget.context.permissions.contains('catalog.read');
  bool get _canManage => widget.context.permissions.contains('category.manage');

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    if (!_canRead) return;
    setState(() {
      _phase = _CategoryListPhase.loading;
      _errorMessage = null;
    });
    try {
      final page = await widget.gateway.listCategories(status: _statusFilter);
      if (!mounted) return;
      setState(() {
        _items = page.items;
        _nextCursor = page.nextCursor;
        _phase = _visibleItems.isEmpty ? _CategoryListPhase.empty : _CategoryListPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _CategoryListPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _CategoryListPhase.failure;
        _errorMessage = 'No fue posible cargar las categorías.';
      });
    }
  }

  Future<void> _loadMore() async {
    final cursor = _nextCursor;
    if (cursor == null || _loadingMore) return;
    setState(() => _loadingMore = true);
    try {
      final page = await widget.gateway.listCategories(status: _statusFilter, cursor: cursor);
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

  // The backend accepts a server-side `search` filter too, but this list is
  // typically small enough per company that a local filter over the
  // already-fetched real page keeps the UI responsive without a network
  // round-trip on every keystroke — the same choice
  // `pos_suppliers_screen.dart` makes for its own free-text search.
  List<PosCatalogCategory> get _visibleItems {
    final query = _query.trim().toLowerCase();
    if (query.isEmpty) return _items;
    return _items
        .where(
          (category) =>
              category.name.toLowerCase().contains(query) ||
              category.code.toLowerCase().contains(query),
        )
        .toList(growable: false);
  }

  void _onQueryChanged(String value) => setState(() => _query = value);

  void _onStatusFilterChanged(String? value) {
    setState(() => _statusFilter = value);
    unawaited(_load());
  }

  Future<void> _openNewCategoryForm() async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _CategoryFormDialog(gateway: widget.gateway, existingCategories: _items),
    );
    if (saved == true) unawaited(_load());
  }

  Future<void> _openEditCategoryForm(PosCatalogCategory category) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _CategoryFormDialog(
        gateway: widget.gateway,
        existing: category,
        existingCategories: _items,
      ),
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
                  'Categorías',
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 20),
                ),
              ),
              IconButton(
                key: const Key('pos-category-admin-refresh'),
                tooltip: 'Actualizar',
                onPressed: () => unawaited(_load()),
                icon: Icon(Icons.refresh, color: palette.textSecondary),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Categorías de productos — búsqueda, alta y edición.',
            style: TextStyle(color: palette.textSecondary, fontSize: 13),
          ),
          const SizedBox(height: 16),
          if (!_canRead)
            const _CategoryPermissionState()
          else ...[
            Row(
              children: [
                Expanded(
                  child: TextField(
                    key: const Key('pos-category-admin-search'),
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
                    key: const Key('pos-category-admin-status-filter'),
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
                  message: _canManage ? 'Nueva categoría' : 'Tu sesión no incluye el permiso category.manage.',
                  child: FilledButton.icon(
                    key: const Key('pos-category-admin-new'),
                    onPressed: _canManage ? () => unawaited(_openNewCategoryForm()) : null,
                    style: FilledButton.styleFrom(backgroundColor: palette.action),
                    icon: const Icon(Icons.add, size: 16),
                    label: const Text('Nueva'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            switch (_phase) {
              _CategoryListPhase.loading => const _CategoryLoadingState(),
              _CategoryListPhase.empty => const _CategoryEmptyState(message: 'No hay categorías registradas.'),
              _CategoryListPhase.failure => _CategoryFailureState(
                message: _errorMessage ?? 'No fue posible cargar las categorías.',
                onRetry: () => unawaited(_load()),
              ),
              _CategoryListPhase.ready => Builder(
                builder: (context) {
                  final visible = _visibleItems;
                  if (visible.isEmpty) {
                    return const _CategoryEmptyState(message: 'Ninguna categoría coincide con la búsqueda.');
                  }
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      for (final category in visible)
                        _CategoryRow(
                          category: category,
                          canManage: _canManage,
                          onEdit: () => unawaited(_openEditCategoryForm(category)),
                        ),
                      if (_nextCursor != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 12),
                          child: Center(
                            child: OutlinedButton.icon(
                              key: const Key('pos-category-admin-load-more'),
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

class _CategoryRow extends StatelessWidget {
  const _CategoryRow({required this.category, required this.canManage, required this.onEdit});
  final PosCatalogCategory category;
  final bool canManage;
  final VoidCallback onEdit;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Card(
      key: Key('pos-category-admin-row-${category.id}'),
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
                    Row(
                      children: [
                        Text(
                          category.name,
                          style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13),
                        ),
                        if (category.visualTile) ...[
                          const SizedBox(width: 8),
                          _VisualTileBadge(),
                        ],
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Código ${category.code} · Orden ${category.sortOrder}',
                      style: TextStyle(color: palette.textSecondary, fontSize: 11),
                    ),
                  ],
                ),
              ),
              _StatusChip(status: category.status),
              if (canManage) ...[
                const SizedBox(width: 8),
                IconButton(
                  key: Key('pos-category-admin-edit-${category.id}'),
                  tooltip: 'Editar categoría',
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

class _VisualTileBadge extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(color: palette.blueTint, borderRadius: BorderRadius.circular(20)),
      child: Text(
        'Mosaico visual',
        style: TextStyle(color: palette.blueDeep, fontWeight: FontWeight.w700, fontSize: 10),
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status});
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

/// New/edit category dialog. `code`/`name` are the only backend-required
/// fields on create (`categoryCreateSchema` in `catalog.routes.ts`); `code`
/// is never editable once created (`categoryPatchSchema` carries no `code`
/// property at all — see `pos_category_admin_gateway.dart`'s header note).
class _CategoryFormDialog extends StatefulWidget {
  const _CategoryFormDialog({
    required this.gateway,
    required this.existingCategories,
    this.existing,
  });
  final PosCategoryAdminGateway gateway;
  final List<PosCatalogCategory> existingCategories;
  final PosCatalogCategory? existing;

  @override
  State<_CategoryFormDialog> createState() => _CategoryFormDialogState();
}

class _CategoryFormDialogState extends State<_CategoryFormDialog> {
  late final _codeController = TextEditingController(text: widget.existing?.code ?? '');
  late final _nameController = TextEditingController(text: widget.existing?.name ?? '');
  late final _descriptionController = TextEditingController(text: widget.existing?.description ?? '');
  late final _sortOrderController = TextEditingController(
    text: widget.existing?.sortOrder.toString() ?? '',
  );
  late String? _parentId = widget.existing?.parentId;
  late bool _visualTile = widget.existing?.visualTile ?? false;
  late String _status = widget.existing?.status ?? 'active';
  bool _busy = false;
  String? _error;

  bool get _isEdit => widget.existing != null;

  @override
  void dispose() {
    _codeController.dispose();
    _nameController.dispose();
    _descriptionController.dispose();
    _sortOrderController.dispose();
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
    final sortOrderText = _sortOrderController.text.trim();
    int? sortOrder;
    if (sortOrderText.isNotEmpty) {
      sortOrder = int.tryParse(sortOrderText);
      if (sortOrder == null || sortOrder < 0) {
        setState(() => _error = 'El orden debe ser un entero de 0 en adelante.');
        return;
      }
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final description = _descriptionController.text.trim();
    final input = PosCategoryInput(
      code: _isEdit ? null : code,
      name: name,
      parentId: _parentId,
      description: description.isEmpty ? null : description,
      sortOrder: sortOrder,
      status: _isEdit ? _status : null,
      visualTile: _visualTile,
    );
    try {
      if (_isEdit) {
        await widget.gateway.updateCategory(widget.existing!.id, widget.existing!.version, input);
      } else {
        await widget.gateway.createCategory(input);
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
        _error = 'No fue posible guardar la categoría.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final parentOptions = widget.existingCategories
        .where((category) => widget.existing == null || category.id != widget.existing!.id)
        .toList(growable: false);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 440, maxHeight: 700),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  _isEdit ? 'Editar categoría' : 'Nueva categoría',
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
                ),
                const SizedBox(height: 14),
                if (!_isEdit) ...[
                  TextField(
                    key: const Key('pos-category-admin-form-code'),
                    controller: _codeController,
                    decoration: const InputDecoration(isDense: true, labelText: 'Código'),
                  ),
                  const SizedBox(height: 10),
                ],
                TextField(
                  key: const Key('pos-category-admin-form-name'),
                  controller: _nameController,
                  decoration: const InputDecoration(isDense: true, labelText: 'Nombre'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-category-admin-form-description'),
                  controller: _descriptionController,
                  maxLines: 2,
                  decoration: const InputDecoration(isDense: true, labelText: 'Descripción (opcional)'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-category-admin-form-sort-order'),
                  controller: _sortOrderController,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(isDense: true, labelText: 'Orden (opcional)'),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String?>(
                  key: const Key('pos-category-admin-form-parent'),
                  initialValue: _parentId,
                  isExpanded: true,
                  decoration: const InputDecoration(isDense: true, labelText: 'Categoría padre (opcional)'),
                  items: [
                    const DropdownMenuItem(value: null, child: Text('Ninguna (categoría raíz)')),
                    for (final category in parentOptions)
                      DropdownMenuItem(value: category.id, child: Text(category.name)),
                  ],
                  onChanged: (value) => setState(() => _parentId = value),
                ),
                const SizedBox(height: 6),
                CheckboxListTile(
                  key: const Key('pos-category-admin-form-visual-tile'),
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                  value: _visualTile,
                  onChanged: (value) => setState(() => _visualTile = value ?? false),
                  title: const Text('Mostrar como mosaico visual'),
                ),
                if (_isEdit) ...[
                  const SizedBox(height: 4),
                  DropdownButtonFormField<String>(
                    key: const Key('pos-category-admin-form-status'),
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
                    key: const Key('pos-category-admin-form-error'),
                    style: TextStyle(color: palette.error, fontSize: 12),
                  ),
                ],
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        key: const Key('pos-category-admin-form-cancel'),
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
                        key: const Key('pos-category-admin-form-save'),
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

class _CategoryLoadingState extends StatelessWidget {
  const _CategoryLoadingState();
  @override
  Widget build(BuildContext context) => const Padding(
    padding: EdgeInsets.symmetric(vertical: 40),
    child: Center(child: CircularProgressIndicator()),
  );
}

class _CategoryEmptyState extends StatelessWidget {
  const _CategoryEmptyState({required this.message});
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

class _CategoryFailureState extends StatelessWidget {
  const _CategoryFailureState({required this.message, required this.onRetry});
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

class _CategoryPermissionState extends StatelessWidget {
  const _CategoryPermissionState();
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
