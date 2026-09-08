/// TASK 12.2 — "Variantes de producto" admin screen: a product picker
/// (search + list, `GET /api/v1/products`) whose selection loads and shows
/// EVERY variant of that product (`GET /api/v1/products/{id}/variants`),
/// plus create/edit for those variants (`POST .../variants`,
/// `PATCH /api/v1/product-variants/{id}`). Styled after
/// `pos_suppliers_screen.dart`/`pos_reports_screen.dart` (this wave's
/// assigned structural templates): `PosPalette.of(context)` only
/// (`pos_tokens.dart`), hardcoded Spanish strings (no l10n), plain
/// `StatefulWidget`+`setState` (no Riverpod/Bloc). Deliberately a
/// STANDALONE public file — it never imports `pos_shell.dart`'s private
/// widgets, mirroring why `pos_suppliers_screen.dart` stays standalone too.
///
/// Reached from `pos_shell.dart`'s pre-existing `PosModule.products`
/// ("Productos") destination — see this file's own header comment on
/// [PosProductVariantsScreen] for the exact wiring an orchestrator would
/// add (this file cannot edit `pos_shell.dart`/`pos_navigation.dart`
/// itself; those are owned centrally).
///
/// Permission gating: the create ("Nueva variante") and per-row edit
/// controls are gated on `product.manage` — an actor without it sees NO
/// such affordance at all (never merely disabled), but always sees the
/// real, honest read-only variant list as long as it has `catalog.read`.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/networking/api_client.dart';
import '../authentication/auth_models.dart';
import 'pos_product_variants_gateway.dart';
import 'pos_tokens.dart';

final RegExp _costPattern = RegExp(r'^(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,4})?$');
final RegExp _currencyPattern = RegExp(r'^[A-Za-z]{3}$');

enum _ProductListPhase { loading, empty, failure, ready }

enum _VariantListPhase { idle, loading, empty, failure, ready }

/// The public "Variantes de producto" screen. See this file's own header
/// for how `pos_shell.dart`'s `PosModule.products` switch case would
/// construct it: `PosProductVariantsScreen(context: this.context, gateway:
/// productVariantsGateway)`.
class PosProductVariantsScreen extends StatefulWidget {
  const PosProductVariantsScreen({required this.context, required this.gateway, super.key});

  final AuthenticatedContext context;
  final PosProductVariantsGateway gateway;

  @override
  State<PosProductVariantsScreen> createState() => _PosProductVariantsScreenState();
}

class _PosProductVariantsScreenState extends State<PosProductVariantsScreen> {
  _ProductListPhase _productPhase = _ProductListPhase.loading;
  List<PosVariantProduct> _products = const [];
  String? _productsError;
  String _productQuery = '';
  Timer? _searchDebounce;

  PosVariantProduct? _selectedProduct;
  _VariantListPhase _variantPhase = _VariantListPhase.idle;
  List<PosProductVariant> _variants = const [];
  String? _variantsNextCursor;
  bool _loadingMoreVariants = false;
  String? _variantsError;

  bool get _canRead => widget.context.permissions.contains('catalog.read');
  bool get _canManage => widget.context.permissions.contains('product.manage');

  @override
  void initState() {
    super.initState();
    unawaited(_loadProducts());
  }

  @override
  void dispose() {
    _searchDebounce?.cancel();
    super.dispose();
  }

  Future<void> _loadProducts() async {
    if (!_canRead) return;
    setState(() {
      _productPhase = _ProductListPhase.loading;
      _productsError = null;
    });
    try {
      final trimmed = _productQuery.trim();
      final page = await widget.gateway.listProducts(search: trimmed.isEmpty ? null : trimmed);
      if (!mounted) return;
      setState(() {
        _products = page.items;
        _productPhase = _products.isEmpty ? _ProductListPhase.empty : _ProductListPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _productPhase = _ProductListPhase.failure;
        _productsError = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _productPhase = _ProductListPhase.failure;
        _productsError = 'No fue posible cargar los productos.';
      });
    }
  }

  void _onProductQueryChanged(String value) {
    setState(() => _productQuery = value);
    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 350), () => unawaited(_loadProducts()));
  }

  Future<void> _selectProduct(PosVariantProduct product) async {
    setState(() {
      _selectedProduct = product;
      _variants = const [];
      _variantsNextCursor = null;
      _variantsError = null;
      _variantPhase = _VariantListPhase.loading;
    });
    await _loadVariants();
  }

  Future<void> _loadVariants() async {
    final product = _selectedProduct;
    if (product == null || !_canRead) return;
    setState(() {
      _variantPhase = _VariantListPhase.loading;
      _variantsError = null;
    });
    try {
      final page = await widget.gateway.listVariants(product.id);
      if (!mounted) return;
      setState(() {
        _variants = page.items;
        _variantsNextCursor = page.nextCursor;
        _variantPhase = _variants.isEmpty ? _VariantListPhase.empty : _VariantListPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _variantPhase = _VariantListPhase.failure;
        _variantsError = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _variantPhase = _VariantListPhase.failure;
        _variantsError = 'No fue posible cargar las variantes.';
      });
    }
  }

  Future<void> _loadMoreVariants() async {
    final product = _selectedProduct;
    final cursor = _variantsNextCursor;
    if (product == null || cursor == null || _loadingMoreVariants) return;
    setState(() => _loadingMoreVariants = true);
    try {
      final page = await widget.gateway.listVariants(product.id, cursor: cursor);
      if (!mounted) return;
      setState(() {
        _variants = [..._variants, ...page.items];
        _variantsNextCursor = page.nextCursor;
        _loadingMoreVariants = false;
      });
    } on Object {
      if (!mounted) return;
      setState(() => _loadingMoreVariants = false);
    }
  }

  Future<void> _openNewVariantForm() async {
    final product = _selectedProduct;
    if (product == null) return;
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _VariantFormDialog(gateway: widget.gateway, productId: product.id),
    );
    if (saved == true) unawaited(_loadVariants());
  }

  Future<void> _openEditVariantForm(PosProductVariant variant) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) =>
          _VariantFormDialog(gateway: widget.gateway, productId: variant.productId, existing: variant),
    );
    if (saved == true) unawaited(_loadVariants());
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
                  'Variantes de producto',
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 20),
                ),
              ),
              IconButton(
                key: const Key('pos-product-variants-refresh'),
                tooltip: 'Actualizar',
                onPressed: () {
                  unawaited(_loadProducts());
                  if (_selectedProduct != null) unawaited(_loadVariants());
                },
                icon: Icon(Icons.refresh, color: palette.textSecondary),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Elige un producto para ver y administrar todas sus variantes.',
            style: TextStyle(color: palette.textSecondary, fontSize: 13),
          ),
          const SizedBox(height: 16),
          if (!_canRead)
            const _VariantsPermissionState()
          else ...[
            TextField(
              key: const Key('pos-product-variants-search'),
              onChanged: _onProductQueryChanged,
              decoration: const InputDecoration(
                isDense: true,
                hintText: 'Buscar producto por nombre, código o SKU',
                prefixIcon: Icon(Icons.search),
              ),
            ),
            const SizedBox(height: 12),
            switch (_productPhase) {
              _ProductListPhase.loading => const _InlineLoadingState(),
              _ProductListPhase.empty => const _InlineEmptyState(message: 'No hay productos que coincidan.'),
              _ProductListPhase.failure => _InlineFailureState(
                message: _productsError ?? 'No fue posible cargar los productos.',
                onRetry: () => unawaited(_loadProducts()),
              ),
              _ProductListPhase.ready => Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final product in _products)
                    _ProductRow(
                      product: product,
                      selected: _selectedProduct?.id == product.id,
                      onTap: () => unawaited(_selectProduct(product)),
                    ),
                ],
              ),
            },
            const SizedBox(height: 18),
            Divider(color: palette.border),
            const SizedBox(height: 12),
            if (_selectedProduct == null)
              const _InlineEmptyState(message: 'Selecciona un producto arriba para ver sus variantes.')
            else ...[
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'Variantes de «${_selectedProduct!.name}»',
                      style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 15),
                    ),
                  ),
                  if (_canManage)
                    FilledButton.icon(
                      key: const Key('pos-product-variants-new'),
                      onPressed: () => unawaited(_openNewVariantForm()),
                      style: FilledButton.styleFrom(backgroundColor: palette.action),
                      icon: const Icon(Icons.add, size: 16),
                      label: const Text('Nueva variante'),
                    ),
                ],
              ),
              const SizedBox(height: 10),
              switch (_variantPhase) {
                _VariantListPhase.idle => const SizedBox.shrink(),
                _VariantListPhase.loading => const _InlineLoadingState(),
                _VariantListPhase.empty => const _InlineEmptyState(
                  message: 'Este producto todavía no tiene variantes.',
                ),
                _VariantListPhase.failure => _InlineFailureState(
                  message: _variantsError ?? 'No fue posible cargar las variantes.',
                  onRetry: () => unawaited(_loadVariants()),
                ),
                _VariantListPhase.ready => Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (final variant in _variants)
                      _VariantRow(
                        variant: variant,
                        canManage: _canManage,
                        onEdit: () => unawaited(_openEditVariantForm(variant)),
                      ),
                    if (_variantsNextCursor != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Center(
                          child: OutlinedButton.icon(
                            key: const Key('pos-product-variants-load-more'),
                            onPressed: _loadingMoreVariants ? null : () => unawaited(_loadMoreVariants()),
                            icon: _loadingMoreVariants
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
          ],
        ],
      ),
    );
  }
}

class _ProductRow extends StatelessWidget {
  const _ProductRow({required this.product, required this.selected, required this.onTap});
  final PosVariantProduct product;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Card(
      key: Key('pos-product-variants-product-${product.id}'),
      margin: const EdgeInsets.only(bottom: 6),
      color: selected ? palette.actionTint : palette.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: BorderSide(color: selected ? palette.action : palette.border),
      ),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(product.name, style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13)),
                    const SizedBox(height: 2),
                    Text(
                      product.defaultVariantSku == null
                          ? product.code
                          : '${product.code} · SKU ${product.defaultVariantSku}',
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

class _VariantRow extends StatelessWidget {
  const _VariantRow({required this.variant, required this.canManage, required this.onEdit});
  final PosProductVariant variant;
  final bool canManage;
  final VoidCallback onEdit;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final costParts = <String>[
      if (variant.standardCost != null) variant.standardCost!,
      if (variant.currencyCode != null) variant.currencyCode!,
    ];
    return Card(
      key: Key('pos-product-variants-row-${variant.id}'),
      margin: const EdgeInsets.only(bottom: 8),
      color: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: palette.border)),
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
                        variant.sku,
                        style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13),
                      ),
                      if (variant.isDefault) ...[
                        const SizedBox(width: 8),
                        _DefaultBadge(),
                      ],
                    ],
                  ),
                  if (variant.name != null && variant.name!.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(variant.name!, style: TextStyle(color: palette.textSecondary, fontSize: 12)),
                  ],
                  const SizedBox(height: 4),
                  Text(
                    [
                      'Unidad: ${variant.unitOfMeasureCode}',
                      if (costParts.isNotEmpty) 'Costo: ${costParts.join(' ')}',
                    ].join(' · '),
                    style: TextStyle(color: palette.textMuted, fontSize: 11),
                  ),
                ],
              ),
            ),
            _VariantStatusChip(status: variant.status),
            if (canManage) ...[
              const SizedBox(width: 8),
              IconButton(
                key: Key('pos-product-variants-edit-${variant.id}'),
                tooltip: 'Editar variante',
                onPressed: onEdit,
                icon: Icon(Icons.edit_outlined, size: 18, color: palette.textSecondary),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _DefaultBadge extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(color: palette.blueTint, borderRadius: BorderRadius.circular(20)),
      child: Text(
        'Predeterminada',
        style: TextStyle(color: palette.blueDeep, fontWeight: FontWeight.w700, fontSize: 10),
      ),
    );
  }
}

class _VariantStatusChip extends StatelessWidget {
  const _VariantStatusChip({required this.status});
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

/// New/edit variant dialog. `sku`/`unit_of_measure_code` are the only
/// backend-required fields on create (`variantBodySchema` in
/// `product-catalog.routes.ts`); every other field mirrors that schema's
/// own client-side pattern validation before ever calling the gateway, so
/// a malformed request never reaches the network. `status` is only shown
/// when editing — the create schema itself only accepts `active`/
/// `inactive` and this form never invents a status the user did not pick.
class _VariantFormDialog extends StatefulWidget {
  const _VariantFormDialog({required this.gateway, required this.productId, this.existing});
  final PosProductVariantsGateway gateway;
  final String productId;
  final PosProductVariant? existing;

  @override
  State<_VariantFormDialog> createState() => _VariantFormDialogState();
}

class _VariantFormDialogState extends State<_VariantFormDialog> {
  late final _skuController = TextEditingController(text: widget.existing?.sku ?? '');
  late final _nameController = TextEditingController(text: widget.existing?.name ?? '');
  late final _unitController = TextEditingController(text: widget.existing?.unitOfMeasureCode ?? '');
  late final _quantityScaleController = TextEditingController(
    text: widget.existing?.quantityScale.toString() ?? '',
  );
  late final _costController = TextEditingController(text: widget.existing?.standardCost ?? '');
  late final _currencyController = TextEditingController(text: widget.existing?.currencyCode ?? '');
  late bool _isDefault = widget.existing?.isDefault ?? false;
  late String _status = widget.existing?.status ?? 'active';
  bool _busy = false;
  String? _error;

  bool get _isEdit => widget.existing != null;

  @override
  void dispose() {
    _skuController.dispose();
    _nameController.dispose();
    _unitController.dispose();
    _quantityScaleController.dispose();
    _costController.dispose();
    _currencyController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final sku = _skuController.text.trim();
    if (sku.isEmpty) {
      setState(() => _error = 'El SKU es obligatorio.');
      return;
    }
    final unit = _unitController.text.trim();
    if (unit.isEmpty) {
      setState(() => _error = 'La unidad de medida es obligatoria.');
      return;
    }
    final quantityScaleText = _quantityScaleController.text.trim();
    int? quantityScale;
    if (quantityScaleText.isNotEmpty) {
      quantityScale = int.tryParse(quantityScaleText);
      if (quantityScale == null || quantityScale < 0 || quantityScale > 6) {
        setState(() => _error = 'La escala de cantidad debe ser un entero entre 0 y 6.');
        return;
      }
    }
    final cost = _costController.text.trim();
    if (cost.isNotEmpty && !_costPattern.hasMatch(cost)) {
      setState(() => _error = 'El costo no tiene un formato válido (ej. 12.50).');
      return;
    }
    final currency = _currencyController.text.trim();
    if (currency.isNotEmpty && !_currencyPattern.hasMatch(currency)) {
      setState(() => _error = 'La moneda debe tener 3 letras (ej. MXN).');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final name = _nameController.text.trim();
    final input = PosProductVariantInput(
      sku: sku,
      name: name.isEmpty ? null : name,
      unitOfMeasureCode: unit,
      quantityScale: quantityScale,
      standardCost: cost.isEmpty ? null : cost,
      currencyCode: currency.isEmpty ? null : currency,
      isDefault: _isDefault,
      status: _isEdit ? _status : null,
    );
    try {
      if (_isEdit) {
        await widget.gateway.updateVariant(widget.existing!.id, widget.existing!.version, input);
      } else {
        await widget.gateway.createVariant(widget.productId, input);
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
        _error = 'No fue posible guardar la variante.';
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
                  _isEdit ? 'Editar variante' : 'Nueva variante',
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
                ),
                const SizedBox(height: 14),
                TextField(
                  key: const Key('pos-product-variants-form-sku'),
                  controller: _skuController,
                  decoration: const InputDecoration(isDense: true, labelText: 'SKU'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-product-variants-form-name'),
                  controller: _nameController,
                  decoration: const InputDecoration(isDense: true, labelText: 'Nombre (opcional)'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-product-variants-form-unit'),
                  controller: _unitController,
                  decoration: const InputDecoration(isDense: true, labelText: 'Unidad de medida (ej. unit, kg)'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-product-variants-form-quantity-scale'),
                  controller: _quantityScaleController,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(isDense: true, labelText: 'Escala de cantidad (opcional, 0-6)'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-product-variants-form-cost'),
                  controller: _costController,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(isDense: true, labelText: 'Costo estándar (opcional)'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-product-variants-form-currency'),
                  controller: _currencyController,
                  decoration: const InputDecoration(isDense: true, labelText: 'Moneda (opcional, ej. MXN)'),
                ),
                const SizedBox(height: 6),
                CheckboxListTile(
                  key: const Key('pos-product-variants-form-default'),
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                  value: _isDefault,
                  onChanged: (value) => setState(() => _isDefault = value ?? false),
                  title: const Text('Variante predeterminada'),
                ),
                if (_isEdit) ...[
                  const SizedBox(height: 4),
                  DropdownButtonFormField<String>(
                    key: const Key('pos-product-variants-form-status'),
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
                    key: const Key('pos-product-variants-form-error'),
                    style: TextStyle(color: palette.error, fontSize: 12),
                  ),
                ],
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        key: const Key('pos-product-variants-form-cancel'),
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
                        key: const Key('pos-product-variants-form-save'),
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

class _InlineLoadingState extends StatelessWidget {
  const _InlineLoadingState();
  @override
  Widget build(BuildContext context) =>
      const Padding(padding: EdgeInsets.symmetric(vertical: 24), child: Center(child: CircularProgressIndicator()));
}

class _InlineEmptyState extends StatelessWidget {
  const _InlineEmptyState({required this.message});
  final String message;
  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 20),
      child: Center(child: Text(message, style: TextStyle(color: palette.textMuted, fontSize: 13))),
    );
  }
}

class _InlineFailureState extends StatelessWidget {
  const _InlineFailureState({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 20),
      child: Center(
        child: Column(
          children: [
            Text(message, style: TextStyle(color: palette.error, fontSize: 13)),
            const SizedBox(height: 8),
            OutlinedButton(onPressed: onRetry, child: const Text('Reintentar')),
          ],
        ),
      ),
    );
  }
}

class _VariantsPermissionState extends StatelessWidget {
  const _VariantsPermissionState();
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
