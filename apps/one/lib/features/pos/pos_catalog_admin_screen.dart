/// TASK 15.1 Phase 4 — "Catálogo (precios y opciones)" admin screen: the
/// remaining real, permissioned, DB-backed catalog capabilities
/// `docs/RC_RELEASE_INVENTORY.md`'s POS section flagged YELLOW for having
/// no Flutter caller at all — branch price overrides, custom
/// options/values + variant barcodes, and the product CSV export. Product/
/// variant CRUD itself is already real and wired via
/// `pos_product_variants_screen.dart` — this is a NEW, SIBLING screen that
/// adds only what that one doesn't cover; it never imports or edits that
/// file.
///
/// Two tabs (`SegmentedButton`, mirrors `pos_people_screen.dart`'s own
/// tabbed-screen convention) plus one persistent header action:
///   * "Precios por sucursal" — `POST /api/v1/products/{id}/prices`
///     (`price.manage`).
///   * "Opciones y código de barras" —  `product-options.routes.ts`'s 8
///     endpoints (`product.manage`).
///   * "Exportar catálogo (CSV)" header button — `GET
///     /api/v1/products/export.csv` (`catalog.read`), downloaded via this
///     app's own already-established `downloadCsvFile` mechanism (see
///     `pos_reports_csv_download.dart` — the exact same Blob+`<a
///     download>` pattern `pos_reports_screen.dart`'s own CSV exports use;
///     never a second, divergent download path).
///
/// HONEST LIMITATION (see `pos_catalog_admin_gateway.dart`'s own header):
/// `product-options.routes.ts` has NO route to list a variant's existing
/// barcodes — only create (`POST .../barcodes`) and soft-retire
/// (`DELETE /product-barcodes/{id}`). This screen never fabricates a full
/// barcode list it cannot actually fetch: the barcode section shows only
/// the barcodes created in the CURRENT session (kept in local state,
/// clearly labeled), with a real Retirar action for each. Adding a list
/// route would be backend scope expansion beyond this task's narrow
/// front-end mandate — flagged in this file's own report-back, not
/// silently worked around.
///
/// Permission gating: every mutating affordance (new price, new/edit
/// option, new/edit value, new/retire barcode) is gated on the real
/// permission its own route requires; an actor without it never sees that
/// control at all (mirrors `pos_product_variants_screen.dart`'s own
/// established convention), while the read-only views stay visible with
/// just `catalog.read`.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/networking/api_client.dart';
import '../authentication/auth_models.dart';
import 'pos_catalog_admin_gateway.dart';
import 'pos_reports_csv_download.dart';
import 'pos_tokens.dart';

final RegExp _amountPattern = RegExp(r'^(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,4})?$');
final RegExp _currencyPattern = RegExp(r'^[A-Za-z]{3}$');

enum _CatalogAdminTab { prices, options }

enum _Phase { idle, loading, empty, failure, ready }

/// Maps a 409 `price_conflict` [ApiException] (`createProductPrice`) to an
/// honest, actionable Spanish message — the backend's own real constraint
/// (`product_prices_company_active_uq`/`_branch_active_uq` in
/// `packages/database/src/schema/catalog.ts`): only ONE active,
/// open-ended price may exist per product+scope at a time, so replacing one
/// requires giving the NEW price an explicit end date, never a silent
/// failure.
///
/// TASK 16.6B — public (not `_`-prefixed) so `_EditProductDialog`'s own
/// "Guardar precio" action (`pos_shell.dart`) shows this same honest,
/// actionable message instead of a second, divergent one for the exact
/// same real backend error.
String? priceConflictMessage(ApiException error) {
  if (error.failure.code != 'price_conflict') return null;
  return 'Ya existe un precio activo y sin fecha de fin para este producto en este alcance. '
      'Especifica una fecha de vigencia final para el nuevo precio, o retira el anterior desde la base de datos.';
}

/// The public "Catálogo (precios y opciones)" module screen. Constructed
/// with the real [AuthenticatedContext] and a real
/// [PosCatalogAdminGateway] — e.g. `PosCatalogAdminScreen(context:
/// this.context, gateway: catalogAdminGateway)`.
class PosCatalogAdminScreen extends StatefulWidget {
  const PosCatalogAdminScreen({required this.context, required this.gateway, super.key});

  final AuthenticatedContext context;
  final PosCatalogAdminGateway gateway;

  @override
  State<PosCatalogAdminScreen> createState() => _PosCatalogAdminScreenState();
}

class _PosCatalogAdminScreenState extends State<PosCatalogAdminScreen> {
  _CatalogAdminTab _tab = _CatalogAdminTab.prices;
  bool _exporting = false;

  bool get _canRead => widget.context.permissions.contains('catalog.read');

  Future<void> _exportCsv() async {
    final messenger = ScaffoldMessenger.maybeOf(context);
    setState(() => _exporting = true);
    try {
      final csv = await widget.gateway.exportProductsCsv();
      final stamp = DateTime.now().toUtc();
      String two(int n) => n.toString().padLeft(2, '0');
      final filename =
          'product-catalog-export-${stamp.year}${two(stamp.month)}${two(stamp.day)}.csv';
      final downloaded = downloadCsvFile(filename: filename, csvContent: csv);
      if (!mounted) return;
      messenger?.showSnackBar(
        SnackBar(
          content: Text(
            downloaded
                ? 'Se descargó $filename.'
                : 'El CSV se generó, pero este entorno no puede iniciar la descarga del navegador.',
          ),
        ),
      );
    } on ApiException catch (error) {
      messenger?.showSnackBar(SnackBar(content: Text(error.failure.message)));
    } on Object {
      messenger?.showSnackBar(const SnackBar(content: Text('No fue posible exportar el catálogo.')));
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
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
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Catálogo — precios y opciones',
                      style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 20),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Precios por sucursal, opciones/valores personalizados, códigos de barras y exportación.',
                      style: TextStyle(color: palette.textSecondary, fontSize: 13),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              Tooltip(
                message: _canRead ? 'Exportar catálogo (CSV)' : 'Tu sesión no incluye el permiso catalog.read.',
                child: OutlinedButton.icon(
                  key: const Key('pos-catalog-admin-export-csv'),
                  onPressed: _canRead && !_exporting ? () => unawaited(_exportCsv()) : null,
                  icon: _exporting
                      ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.download_outlined, size: 16),
                  label: const Text('Exportar catálogo (CSV)'),
                  style: OutlinedButton.styleFrom(foregroundColor: palette.blueDeep, side: BorderSide(color: palette.border)),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          if (!_canRead)
            const _PermissionState()
          else ...[
            SegmentedButton<_CatalogAdminTab>(
              key: const Key('pos-catalog-admin-tabs'),
              segments: const [
                ButtonSegment(value: _CatalogAdminTab.prices, label: Text('Precios por sucursal')),
                ButtonSegment(value: _CatalogAdminTab.options, label: Text('Opciones y código de barras')),
              ],
              selected: {_tab},
              onSelectionChanged: (value) => setState(() => _tab = value.first),
            ),
            const SizedBox(height: 16),
            switch (_tab) {
              _CatalogAdminTab.prices => _PricesTab(context: widget.context, gateway: widget.gateway),
              _CatalogAdminTab.options => _OptionsTab(context: widget.context, gateway: widget.gateway),
            },
          ],
        ],
      ),
    );
  }
}

// =======================================================================
// Precios por sucursal
// =======================================================================

class _PricesTab extends StatefulWidget {
  const _PricesTab({required this.context, required this.gateway});
  final AuthenticatedContext context;
  final PosCatalogAdminGateway gateway;

  @override
  State<_PricesTab> createState() => _PricesTabState();
}

class _PricesTabState extends State<_PricesTab> {
  _Phase _phase = _Phase.loading;
  List<PosCatalogProduct> _products = const [];
  String? _errorMessage;
  String _query = '';
  Timer? _debounce;
  // `null` = precio general de la empresa (sin sucursal).
  String? _branchId;

  bool get _canManage => widget.context.permissions.contains('price.manage');

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _phase = _Phase.loading;
      _errorMessage = null;
    });
    try {
      final trimmed = _query.trim();
      final page = await widget.gateway.listProducts(
        search: trimmed.isEmpty ? null : trimmed,
        branchId: _branchId,
      );
      if (!mounted) return;
      setState(() {
        _products = page.items;
        _phase = _products.isEmpty ? _Phase.empty : _Phase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _Phase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _Phase.failure;
        _errorMessage = 'No fue posible cargar los productos.';
      });
    }
  }

  void _onQueryChanged(String value) {
    setState(() => _query = value);
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () => unawaited(_load()));
  }

  void _onBranchChanged(String? value) {
    setState(() => _branchId = value);
    unawaited(_load());
  }

  Future<void> _openPriceForm(PosCatalogProduct product) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _PriceFormDialog(
        gateway: widget.gateway,
        product: product,
        branches: widget.context.branches,
        initialBranchId: _branchId,
        defaultCurrencyCode: widget.context.companyCurrencyCode,
      ),
    );
    if (saved == true) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: TextField(
                key: const Key('pos-catalog-admin-prices-search'),
                onChanged: _onQueryChanged,
                decoration: const InputDecoration(
                  isDense: true,
                  hintText: 'Buscar producto por nombre, código o SKU',
                  prefixIcon: Icon(Icons.search),
                ),
              ),
            ),
            const SizedBox(width: 10),
            SizedBox(
              width: 260,
              child: DropdownButtonFormField<String?>(
                key: const Key('pos-catalog-admin-prices-branch'),
                initialValue: _branchId,
                isExpanded: true,
                decoration: const InputDecoration(isDense: true, labelText: 'Sucursal'),
                items: [
                  const DropdownMenuItem(value: null, child: Text('Precio general (toda la empresa)')),
                  for (final branch in widget.context.branches)
                    DropdownMenuItem(value: branch.id, child: Text(branch.name)),
                ],
                onChanged: _onBranchChanged,
              ),
            ),
          ],
        ),
        const SizedBox(height: 6),
        Text(
          'El precio mostrado es el que aplicaría hoy para la sucursal elegida (o el precio general si no eliges ninguna).',
          style: TextStyle(color: palette.textMuted, fontSize: 11),
        ),
        const SizedBox(height: 14),
        switch (_phase) {
          _Phase.idle || _Phase.loading => const _LoadingState(),
          _Phase.empty => const _EmptyState(message: 'No hay productos que coincidan.'),
          _Phase.failure => _FailureState(
            message: _errorMessage ?? 'No fue posible cargar los productos.',
            onRetry: () => unawaited(_load()),
          ),
          _Phase.ready => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final product in _products)
                _ProductPriceRow(
                  product: product,
                  canManage: _canManage,
                  onNewPrice: () => unawaited(_openPriceForm(product)),
                ),
            ],
          ),
        },
      ],
    );
  }
}

class _ProductPriceRow extends StatelessWidget {
  const _ProductPriceRow({required this.product, required this.canManage, required this.onNewPrice});
  final PosCatalogProduct product;
  final bool canManage;
  final VoidCallback onNewPrice;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final price = product.effectivePrice;
    return Card(
      key: Key('pos-catalog-admin-price-row-${product.id}'),
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
                  Text(product.name, style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13)),
                  const SizedBox(height: 2),
                  Text(product.code, style: TextStyle(color: palette.textSecondary, fontSize: 11)),
                ],
              ),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  price == null ? 'Sin precio vigente' : '${price.amount} ${price.currencyCode}',
                  key: Key('pos-catalog-admin-price-value-${product.id}'),
                  style: TextStyle(
                    color: price == null ? palette.textMuted : palette.text,
                    fontWeight: FontWeight.w700,
                    fontSize: 13,
                  ),
                ),
                if (price != null)
                  Text(
                    price.branchId == null ? 'Precio general' : 'Precio de sucursal',
                    style: TextStyle(color: palette.textMuted, fontSize: 10),
                  ),
              ],
            ),
            if (canManage) ...[
              const SizedBox(width: 10),
              IconButton(
                key: Key('pos-catalog-admin-new-price-${product.id}'),
                tooltip: 'Nuevo precio',
                onPressed: onNewPrice,
                icon: Icon(Icons.attach_money, size: 18, color: palette.textSecondary),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _PriceFormDialog extends StatefulWidget {
  const _PriceFormDialog({
    required this.gateway,
    required this.product,
    required this.branches,
    required this.initialBranchId,
    required this.defaultCurrencyCode,
  });
  final PosCatalogAdminGateway gateway;
  final PosCatalogProduct product;
  final List<BranchSummary> branches;
  final String? initialBranchId;

  /// The tenant's own currency (`AuthenticatedContext.companyCurrencyCode`)
  /// — what the field starts with when the product has no price yet.
  final String defaultCurrencyCode;

  @override
  State<_PriceFormDialog> createState() => _PriceFormDialogState();
}

class _PriceFormDialogState extends State<_PriceFormDialog> {
  late final _amountController = TextEditingController(text: widget.product.effectivePrice?.amount ?? '');
  late final _currencyController = TextEditingController(
    text: widget.product.effectivePrice?.currencyCode ?? widget.defaultCurrencyCode,
  );
  late String? _branchId = widget.initialBranchId;
  DateTime? _validUntil;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _amountController.dispose();
    _currencyController.dispose();
    super.dispose();
  }

  Future<void> _pickValidUntil() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _validUntil ?? now.add(const Duration(days: 1)),
      firstDate: now,
      lastDate: DateTime(now.year + 5),
    );
    if (picked != null) setState(() => _validUntil = picked);
  }

  Future<void> _submit() async {
    final amount = _amountController.text.trim();
    if (amount.isEmpty || !_amountPattern.hasMatch(amount)) {
      setState(() => _error = 'El monto no tiene un formato válido (ej. 12.50).');
      return;
    }
    final currency = _currencyController.text.trim();
    if (currency.isEmpty || !_currencyPattern.hasMatch(currency)) {
      setState(() => _error = 'La moneda debe tener 3 letras (ej. ${widget.defaultCurrencyCode}).');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final input = PosProductPriceInput(
      amount: amount,
      currencyCode: currency.toUpperCase(),
      branchId: _branchId,
      validUntil: _validUntil,
    );
    try {
      await widget.gateway.createProductPrice(widget.product.id, input);
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = priceConflictMessage(error) ?? error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible guardar el precio.';
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
          constraints: const BoxConstraints(maxWidth: 440, maxHeight: 620),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Nuevo precio — ${widget.product.name}',
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
                ),
                const SizedBox(height: 14),
                DropdownButtonFormField<String?>(
                  key: const Key('pos-catalog-admin-price-form-branch'),
                  initialValue: _branchId,
                  isExpanded: true,
                  decoration: const InputDecoration(isDense: true, labelText: 'Alcance'),
                  items: [
                    const DropdownMenuItem(value: null, child: Text('Precio general (toda la empresa)')),
                    for (final branch in widget.branches)
                      DropdownMenuItem(value: branch.id, child: Text(branch.name)),
                  ],
                  onChanged: (value) => setState(() => _branchId = value),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-catalog-admin-price-form-amount'),
                  controller: _amountController,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(isDense: true, labelText: 'Monto (ej. 149.00)'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-catalog-admin-price-form-currency'),
                  controller: _currencyController,
                  decoration: InputDecoration(isDense: true, labelText: 'Moneda (ej. ${widget.defaultCurrencyCode})'),
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        _validUntil == null
                            ? 'Sin fecha de fin (precio abierto)'
                            : 'Vigente hasta: ${_validUntil!.toLocal().toString().split(' ').first}',
                        style: TextStyle(color: palette.textSecondary, fontSize: 12),
                      ),
                    ),
                    TextButton(
                      key: const Key('pos-catalog-admin-price-form-valid-until'),
                      onPressed: () => unawaited(_pickValidUntil()),
                      child: Text(_validUntil == null ? 'Elegir fecha' : 'Cambiar'),
                    ),
                    if (_validUntil != null)
                      IconButton(
                        key: const Key('pos-catalog-admin-price-form-clear-valid-until'),
                        tooltip: 'Quitar fecha de fin',
                        onPressed: () => setState(() => _validUntil = null),
                        icon: const Icon(Icons.close, size: 16),
                      ),
                  ],
                ),
                if (_error != null) ...[
                  const SizedBox(height: 10),
                  Text(
                    _error!,
                    key: const Key('pos-catalog-admin-price-form-error'),
                    style: TextStyle(color: palette.error, fontSize: 12),
                  ),
                ],
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        key: const Key('pos-catalog-admin-price-form-cancel'),
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
                        key: const Key('pos-catalog-admin-price-form-save'),
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

// =======================================================================
// Opciones, valores y códigos de barras
// =======================================================================

class _OptionsTab extends StatefulWidget {
  const _OptionsTab({required this.context, required this.gateway});
  final AuthenticatedContext context;
  final PosCatalogAdminGateway gateway;

  @override
  State<_OptionsTab> createState() => _OptionsTabState();
}

class _OptionsTabState extends State<_OptionsTab> {
  _Phase _productPhase = _Phase.loading;
  List<PosCatalogProduct> _products = const [];
  String? _productsError;
  String _productQuery = '';
  Timer? _debounce;

  PosCatalogProduct? _selectedProduct;

  _Phase _optionsPhase = _Phase.idle;
  List<PosProductOption> _options = const [];
  String? _optionsError;

  PosProductOption? _selectedOption;
  _Phase _valuesPhase = _Phase.idle;
  List<PosProductOptionValue> _values = const [];
  String? _valuesError;

  _Phase _variantsPhase = _Phase.idle;
  List<PosCatalogVariant> _variants = const [];
  String? _variantsError;
  final Map<String, List<PosProductBarcode>> _sessionBarcodesByVariant = {};

  bool get _canManage => widget.context.permissions.contains('product.manage');

  @override
  void initState() {
    super.initState();
    unawaited(_loadProducts());
  }

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  Future<void> _loadProducts() async {
    setState(() {
      _productPhase = _Phase.loading;
      _productsError = null;
    });
    try {
      final trimmed = _productQuery.trim();
      final page = await widget.gateway.listProducts(search: trimmed.isEmpty ? null : trimmed);
      if (!mounted) return;
      setState(() {
        _products = page.items;
        _productPhase = _products.isEmpty ? _Phase.empty : _Phase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _productPhase = _Phase.failure;
        _productsError = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _productPhase = _Phase.failure;
        _productsError = 'No fue posible cargar los productos.';
      });
    }
  }

  void _onProductQueryChanged(String value) {
    setState(() => _productQuery = value);
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () => unawaited(_loadProducts()));
  }

  Future<void> _selectProduct(PosCatalogProduct product) async {
    setState(() {
      _selectedProduct = product;
      _selectedOption = null;
      _values = const [];
      _valuesPhase = _Phase.idle;
      _sessionBarcodesByVariant.clear();
    });
    await Future.wait([_loadOptions(), _loadVariants()]);
  }

  Future<void> _loadOptions() async {
    final product = _selectedProduct;
    if (product == null) return;
    setState(() {
      _optionsPhase = _Phase.loading;
      _optionsError = null;
    });
    try {
      final page = await widget.gateway.listOptions(product.id);
      if (!mounted) return;
      setState(() {
        _options = page.items;
        _optionsPhase = _options.isEmpty ? _Phase.empty : _Phase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _optionsPhase = _Phase.failure;
        _optionsError = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _optionsPhase = _Phase.failure;
        _optionsError = 'No fue posible cargar las opciones.';
      });
    }
  }

  Future<void> _loadVariants() async {
    final product = _selectedProduct;
    if (product == null) return;
    setState(() {
      _variantsPhase = _Phase.loading;
      _variantsError = null;
    });
    try {
      final page = await widget.gateway.listVariants(product.id);
      if (!mounted) return;
      setState(() {
        _variants = page.items;
        _variantsPhase = _variants.isEmpty ? _Phase.empty : _Phase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _variantsPhase = _Phase.failure;
        _variantsError = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _variantsPhase = _Phase.failure;
        _variantsError = 'No fue posible cargar las variantes.';
      });
    }
  }

  Future<void> _selectOption(PosProductOption option) async {
    setState(() {
      _selectedOption = option;
      _valuesPhase = _Phase.loading;
      _valuesError = null;
    });
    try {
      final page = await widget.gateway.listOptionValues(option.id);
      if (!mounted) return;
      setState(() {
        _values = page.items;
        _valuesPhase = _values.isEmpty ? _Phase.empty : _Phase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _valuesPhase = _Phase.failure;
        _valuesError = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _valuesPhase = _Phase.failure;
        _valuesError = 'No fue posible cargar los valores.';
      });
    }
  }

  Future<void> _openNewOptionForm() async {
    final product = _selectedProduct;
    if (product == null) return;
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _OptionFormDialog(
        keyPrefix: 'pos-catalog-admin-option',
        title: 'Nueva opción',
        onSubmit: (input) => widget.gateway.createOption(product.id, input),
      ),
    );
    if (saved == true) unawaited(_loadOptions());
  }

  Future<void> _openEditOptionForm(PosProductOption option) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _OptionFormDialog(
        keyPrefix: 'pos-catalog-admin-option',
        title: 'Editar opción',
        existingName: option.name,
        existingDisplayOrder: option.displayOrder,
        existingStatus: option.status,
        onPatch: (input) => widget.gateway.updateOption(option.id, option.version, input),
      ),
    );
    if (saved == true) unawaited(_loadOptions());
  }

  Future<void> _openNewValueForm() async {
    final option = _selectedOption;
    if (option == null) return;
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _OptionFormDialog(
        keyPrefix: 'pos-catalog-admin-value',
        title: 'Nuevo valor',
        onSubmit: (input) => widget.gateway.createOptionValue(option.id, input),
      ),
    );
    if (saved == true) unawaited(_selectOption(option));
  }

  Future<void> _openEditValueForm(PosProductOptionValue value) async {
    final option = _selectedOption;
    if (option == null) return;
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _OptionFormDialog(
        keyPrefix: 'pos-catalog-admin-value',
        title: 'Editar valor',
        existingName: value.name,
        existingDisplayOrder: value.displayOrder,
        existingStatus: value.status,
        onPatch: (input) => widget.gateway.updateOptionValue(value.id, value.version, input),
      ),
    );
    if (saved == true) unawaited(_selectOption(option));
  }

  Future<void> _openNewBarcodeForm(PosCatalogVariant variant) async {
    final created = await showDialog<PosProductBarcode>(
      context: context,
      builder: (dialogContext) => _BarcodeFormDialog(gateway: widget.gateway, variantId: variant.id),
    );
    if (created == null || !mounted) return;
    setState(() {
      final existing = _sessionBarcodesByVariant[variant.id] ?? const <PosProductBarcode>[];
      _sessionBarcodesByVariant[variant.id] = [...existing, created];
    });
  }

  Future<void> _retireBarcode(String variantId, PosProductBarcode barcode) async {
    try {
      await widget.gateway.retireBarcode(barcode.id, barcode.version);
      if (!mounted) return;
      setState(() {
        final existing = _sessionBarcodesByVariant[variantId] ?? const <PosProductBarcode>[];
        _sessionBarcodesByVariant[variantId] = existing.where((item) => item.id != barcode.id).toList();
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(error.failure.message)));
    } on Object {
      if (!mounted) return;
      ScaffoldMessenger.maybeOf(
        context,
      )?.showSnackBar(const SnackBar(content: Text('No fue posible retirar el código de barras.')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          key: const Key('pos-catalog-admin-options-search'),
          onChanged: _onProductQueryChanged,
          decoration: const InputDecoration(
            isDense: true,
            hintText: 'Buscar producto por nombre, código o SKU',
            prefixIcon: Icon(Icons.search),
          ),
        ),
        const SizedBox(height: 12),
        switch (_productPhase) {
          _Phase.idle || _Phase.loading => const _LoadingState(),
          _Phase.empty => const _EmptyState(message: 'No hay productos que coincidan.'),
          _Phase.failure => _FailureState(
            message: _productsError ?? 'No fue posible cargar los productos.',
            onRetry: () => unawaited(_loadProducts()),
          ),
          _Phase.ready => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final product in _products)
                _OptionsProductRow(
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
          const _EmptyState(message: 'Selecciona un producto arriba para administrar sus opciones y códigos de barras.')
        else ...[
          Row(
            children: [
              Expanded(
                child: Text(
                  'Opciones de «${_selectedProduct!.name}»',
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 15),
                ),
              ),
              if (_canManage)
                OutlinedButton.icon(
                  key: const Key('pos-catalog-admin-new-option'),
                  onPressed: () => unawaited(_openNewOptionForm()),
                  icon: const Icon(Icons.add, size: 16),
                  label: const Text('Nueva opción'),
                ),
            ],
          ),
          const SizedBox(height: 8),
          switch (_optionsPhase) {
            _Phase.idle => const SizedBox.shrink(),
            _Phase.loading => const _LoadingState(),
            _Phase.empty => const _EmptyState(message: 'Este producto todavía no tiene opciones.'),
            _Phase.failure => _FailureState(
              message: _optionsError ?? 'No fue posible cargar las opciones.',
              onRetry: () => unawaited(_loadOptions()),
            ),
            _Phase.ready => Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final option in _options)
                  _NamedEntityRow(
                    keyPrefix: 'pos-catalog-admin-option-row',
                    id: option.id,
                    code: option.code,
                    name: option.name,
                    displayOrder: option.displayOrder,
                    status: option.status,
                    selected: _selectedOption?.id == option.id,
                    canManage: _canManage,
                    onTap: () => unawaited(_selectOption(option)),
                    onEdit: () => unawaited(_openEditOptionForm(option)),
                  ),
              ],
            ),
          },
          if (_selectedOption != null) ...[
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Valores de «${_selectedOption!.name}»',
                    style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 14),
                  ),
                ),
                if (_canManage)
                  OutlinedButton.icon(
                    key: const Key('pos-catalog-admin-new-value'),
                    onPressed: () => unawaited(_openNewValueForm()),
                    icon: const Icon(Icons.add, size: 16),
                    label: const Text('Nuevo valor'),
                  ),
              ],
            ),
            const SizedBox(height: 8),
            switch (_valuesPhase) {
              _Phase.idle => const SizedBox.shrink(),
              _Phase.loading => const _LoadingState(),
              _Phase.empty => const _EmptyState(message: 'Esta opción todavía no tiene valores.'),
              _Phase.failure => _FailureState(
                message: _valuesError ?? 'No fue posible cargar los valores.',
                onRetry: () => unawaited(_selectOption(_selectedOption!)),
              ),
              _Phase.ready => Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final value in _values)
                    _NamedEntityRow(
                      keyPrefix: 'pos-catalog-admin-value-row',
                      id: value.id,
                      code: value.code,
                      name: value.name,
                      displayOrder: value.displayOrder,
                      status: value.status,
                      selected: false,
                      canManage: _canManage,
                      onTap: null,
                      onEdit: () => unawaited(_openEditValueForm(value)),
                    ),
                ],
              ),
            },
          ],
          const SizedBox(height: 18),
          Divider(color: palette.border),
          const SizedBox(height: 12),
          Text(
            'Variantes y códigos de barras',
            style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 15),
          ),
          const SizedBox(height: 4),
          Text(
            'El backend no ofrece una lista de códigos de barras existentes por variante — solo se muestran aquí '
            'los que agregues en esta sesión.',
            style: TextStyle(color: palette.textMuted, fontSize: 11),
          ),
          const SizedBox(height: 8),
          switch (_variantsPhase) {
            _Phase.idle || _Phase.loading => const _LoadingState(),
            _Phase.empty => const _EmptyState(message: 'Este producto todavía no tiene variantes.'),
            _Phase.failure => _FailureState(
              message: _variantsError ?? 'No fue posible cargar las variantes.',
              onRetry: () => unawaited(_loadVariants()),
            ),
            _Phase.ready => Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final variant in _variants)
                  _VariantBarcodeRow(
                    variant: variant,
                    canManage: _canManage,
                    sessionBarcodes: _sessionBarcodesByVariant[variant.id] ?? const [],
                    onNewBarcode: () => unawaited(_openNewBarcodeForm(variant)),
                    onRetireBarcode: (barcode) => unawaited(_retireBarcode(variant.id, barcode)),
                  ),
              ],
            ),
          },
        ],
      ],
    );
  }
}

class _OptionsProductRow extends StatelessWidget {
  const _OptionsProductRow({required this.product, required this.selected, required this.onTap});
  final PosCatalogProduct product;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Card(
      key: Key('pos-catalog-admin-options-product-${product.id}'),
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
                    Text(product.code, style: TextStyle(color: palette.textSecondary, fontSize: 11)),
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

class _NamedEntityRow extends StatelessWidget {
  const _NamedEntityRow({
    required this.keyPrefix,
    required this.id,
    required this.code,
    required this.name,
    required this.displayOrder,
    required this.status,
    required this.selected,
    required this.canManage,
    required this.onTap,
    required this.onEdit,
  });
  final String keyPrefix;
  final String id;
  final String code;
  final String name;
  final int displayOrder;
  final String status;
  final bool selected;
  final bool canManage;
  final VoidCallback? onTap;
  final VoidCallback onEdit;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Card(
      key: Key('$keyPrefix-$id'),
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
                    Text(name, style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13)),
                    const SizedBox(height: 2),
                    Text(
                      'Código $code · Orden $displayOrder',
                      style: TextStyle(color: palette.textSecondary, fontSize: 11),
                    ),
                  ],
                ),
              ),
              _StatusChip(status: status),
              if (canManage) ...[
                const SizedBox(width: 8),
                IconButton(
                  key: Key('$keyPrefix-edit-$id'),
                  tooltip: 'Editar',
                  onPressed: onEdit,
                  icon: Icon(Icons.edit_outlined, size: 16, color: palette.textSecondary),
                ),
              ],
              if (onTap != null) Icon(Icons.chevron_right, size: 18, color: palette.textMuted),
            ],
          ),
        ),
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
      'active' => 'Activo',
      'inactive' => 'Inactivo',
      _ => 'Retirado',
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: color.withValues(alpha: .12), borderRadius: BorderRadius.circular(20)),
      child: Text(label, style: TextStyle(color: color, fontWeight: FontWeight.w700, fontSize: 11)),
    );
  }
}

/// Shared create/edit dialog for BOTH options and values — the two routes
/// accept the exact same request shape (`namedBody`/`namedPatch` in
/// `product-options.routes.ts`). Exactly one of [onSubmit] (create) /
/// [onPatch] (edit) is ever provided by the caller, matching which one it
/// is being used for; this dialog itself stays agnostic about which
/// network call happens.
class _OptionFormDialog extends StatefulWidget {
  const _OptionFormDialog({
    required this.keyPrefix,
    required this.title,
    this.existingName,
    this.existingDisplayOrder,
    this.existingStatus,
    this.onSubmit,
    this.onPatch,
  });
  final String keyPrefix;
  final String title;
  final String? existingName;
  final int? existingDisplayOrder;
  final String? existingStatus;
  final Future<Object> Function(PosNamedCreateInput input)? onSubmit;
  final Future<Object> Function(PosNamedPatchInput input)? onPatch;

  @override
  State<_OptionFormDialog> createState() => _OptionFormDialogState();
}

class _OptionFormDialogState extends State<_OptionFormDialog> {
  late final _codeController = TextEditingController();
  late final _nameController = TextEditingController(text: widget.existingName ?? '');
  late final _displayOrderController = TextEditingController(
    text: widget.existingDisplayOrder?.toString() ?? '',
  );
  late String _status = widget.existingStatus ?? 'active';
  bool _busy = false;
  String? _error;

  bool get _isEdit => widget.onPatch != null;

  @override
  void dispose() {
    _codeController.dispose();
    _nameController.dispose();
    _displayOrderController.dispose();
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
    final displayOrderText = _displayOrderController.text.trim();
    int? displayOrder;
    if (displayOrderText.isNotEmpty) {
      displayOrder = int.tryParse(displayOrderText);
      if (displayOrder == null || displayOrder < 0) {
        setState(() => _error = 'El orden debe ser un entero de 0 en adelante.');
        return;
      }
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (_isEdit) {
        await widget.onPatch!(
          PosNamedPatchInput(name: name, displayOrder: displayOrder, status: _status),
        );
      } else {
        await widget.onSubmit!(PosNamedCreateInput(code: code, name: name, displayOrder: displayOrder));
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
        _error = 'No fue posible guardar.';
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
                Text(widget.title, style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16)),
                const SizedBox(height: 14),
                if (!_isEdit) ...[
                  TextField(
                    key: Key('${widget.keyPrefix}-form-code'),
                    controller: _codeController,
                    decoration: const InputDecoration(isDense: true, labelText: 'Código'),
                  ),
                  const SizedBox(height: 10),
                ],
                TextField(
                  key: Key('${widget.keyPrefix}-form-name'),
                  controller: _nameController,
                  decoration: const InputDecoration(isDense: true, labelText: 'Nombre'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: Key('${widget.keyPrefix}-form-display-order'),
                  controller: _displayOrderController,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(isDense: true, labelText: 'Orden (opcional)'),
                ),
                if (_isEdit) ...[
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    key: Key('${widget.keyPrefix}-form-status'),
                    initialValue: _status,
                    isExpanded: true,
                    decoration: const InputDecoration(isDense: true, labelText: 'Estado'),
                    items: const [
                      DropdownMenuItem(value: 'active', child: Text('Activo')),
                      DropdownMenuItem(value: 'inactive', child: Text('Inactivo')),
                      DropdownMenuItem(value: 'retired', child: Text('Retirado')),
                    ],
                    onChanged: (value) => setState(() => _status = value ?? 'active'),
                  ),
                ],
                if (_error != null) ...[
                  const SizedBox(height: 10),
                  Text(
                    _error!,
                    key: Key('${widget.keyPrefix}-form-error'),
                    style: TextStyle(color: palette.error, fontSize: 12),
                  ),
                ],
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        key: Key('${widget.keyPrefix}-form-cancel'),
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
                        key: Key('${widget.keyPrefix}-form-save'),
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

class _VariantBarcodeRow extends StatelessWidget {
  const _VariantBarcodeRow({
    required this.variant,
    required this.canManage,
    required this.sessionBarcodes,
    required this.onNewBarcode,
    required this.onRetireBarcode,
  });
  final PosCatalogVariant variant;
  final bool canManage;
  final List<PosProductBarcode> sessionBarcodes;
  final VoidCallback onNewBarcode;
  final ValueChanged<PosProductBarcode> onRetireBarcode;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Card(
      key: Key('pos-catalog-admin-variant-row-${variant.id}'),
      margin: const EdgeInsets.only(bottom: 8),
      color: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: palette.border)),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(variant.sku, style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13)),
                      if (variant.name != null && variant.name!.isNotEmpty)
                        Text(variant.name!, style: TextStyle(color: palette.textSecondary, fontSize: 11)),
                    ],
                  ),
                ),
                _StatusChip(status: variant.status),
                if (canManage) ...[
                  const SizedBox(width: 8),
                  OutlinedButton.icon(
                    key: Key('pos-catalog-admin-new-barcode-${variant.id}'),
                    onPressed: onNewBarcode,
                    icon: const Icon(Icons.qr_code, size: 14),
                    label: const Text('Código de barras'),
                  ),
                ],
              ],
            ),
            if (sessionBarcodes.isNotEmpty) ...[
              const SizedBox(height: 8),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  for (final barcode in sessionBarcodes)
                    Chip(
                      key: Key('pos-catalog-admin-barcode-${barcode.id}'),
                      label: Text('${barcode.barcode} (${barcode.barcodeType})'),
                      onDeleted: canManage ? () => onRetireBarcode(barcode) : null,
                      deleteIcon: const Icon(Icons.close, size: 14),
                    ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _BarcodeFormDialog extends StatefulWidget {
  const _BarcodeFormDialog({required this.gateway, required this.variantId});
  final PosCatalogAdminGateway gateway;
  final String variantId;

  @override
  State<_BarcodeFormDialog> createState() => _BarcodeFormDialogState();
}

class _BarcodeFormDialogState extends State<_BarcodeFormDialog> {
  late final _valueController = TextEditingController();
  String _type = 'ean13';
  bool _isPrimary = true;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _valueController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final value = _valueController.text.trim();
    if (value.isEmpty) {
      setState(() => _error = 'El código es obligatorio.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final created = await widget.gateway.createBarcode(
        widget.variantId,
        PosProductBarcodeInput(barcode: value, barcodeType: _type, isPrimary: _isPrimary),
      );
      if (!mounted) return;
      Navigator.of(context).pop(created);
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
        _error = 'No fue posible guardar el código de barras.';
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
          constraints: const BoxConstraints(maxWidth: 400, maxHeight: 460),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Nuevo código de barras',
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
                ),
                const SizedBox(height: 14),
                TextField(
                  key: const Key('pos-catalog-admin-barcode-form-value'),
                  controller: _valueController,
                  decoration: const InputDecoration(isDense: true, labelText: 'Código'),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  key: const Key('pos-catalog-admin-barcode-form-type'),
                  initialValue: _type,
                  isExpanded: true,
                  decoration: const InputDecoration(isDense: true, labelText: 'Tipo'),
                  items: const [
                    DropdownMenuItem(value: 'ean13', child: Text('EAN-13')),
                    DropdownMenuItem(value: 'upca', child: Text('UPC-A')),
                    DropdownMenuItem(value: 'code128', child: Text('Code 128')),
                    DropdownMenuItem(value: 'qr', child: Text('QR')),
                    DropdownMenuItem(value: 'internal', child: Text('Interno')),
                  ],
                  onChanged: (value) => setState(() => _type = value ?? 'ean13'),
                ),
                const SizedBox(height: 6),
                CheckboxListTile(
                  key: const Key('pos-catalog-admin-barcode-form-primary'),
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                  value: _isPrimary,
                  onChanged: (value) => setState(() => _isPrimary = value ?? true),
                  title: const Text('Código principal de la variante'),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 10),
                  Text(
                    _error!,
                    key: const Key('pos-catalog-admin-barcode-form-error'),
                    style: TextStyle(color: palette.error, fontSize: 12),
                  ),
                ],
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        key: const Key('pos-catalog-admin-barcode-form-cancel'),
                        onPressed: () => Navigator.of(context).pop(),
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
                        key: const Key('pos-catalog-admin-barcode-form-save'),
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

// =======================================================================
// Shared small state widgets
// =======================================================================

class _LoadingState extends StatelessWidget {
  const _LoadingState();
  @override
  Widget build(BuildContext context) =>
      const Padding(padding: EdgeInsets.symmetric(vertical: 24), child: Center(child: CircularProgressIndicator()));
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.message});
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

class _FailureState extends StatelessWidget {
  const _FailureState({required this.message, required this.onRetry});
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

class _PermissionState extends StatelessWidget {
  const _PermissionState();
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
