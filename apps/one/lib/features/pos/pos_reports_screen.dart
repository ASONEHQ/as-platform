/// TASK 14.4 (Wave 2, Part D): "Reportes / BI" — Report Center. The FIRST
/// real metrics UI in this app (the pre-existing `_Dashboard` in
/// `pos_shell.dart` is explicitly context-only — "Sin métricas
/// simuladas"). Every number rendered below comes straight off
/// `pos_reports_gateway.dart`'s own typed report models, which in turn
/// mirror `reports.types.ts`/`reports.routes.ts` field-for-field — nothing
/// here invents a metric, a percentage, or a ratio the backend did not
/// actually return, and a genuinely empty range renders real zeros/empty
/// tables rather than an error (see `_ReportsMoneyList`/`_ReportsCountRow`
/// below).
///
/// No l10n (hardcoded Spanish strings, matching the rest of this app), no
/// Riverpod/Bloc (`StatefulWidget`+`setState`), and visual consistency via
/// `PosPalette.of(context)` only (`pos_tokens.dart` is public; this file
/// deliberately never imports `pos_shell.dart`'s own private widgets).
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../../app/app.dart';
import '../../core/networking/api_client.dart';
import '../authentication/auth_models.dart';
import 'money.dart';
import 'pos_reports_csv_download.dart';
import 'pos_reports_gateway.dart';
import 'pos_tokens.dart';

enum _ReportArea {
  sales('Ventas', Icons.point_of_sale_outlined),
  financial('Financiero', Icons.account_balance_wallet_outlined),
  inventory('Inventario', Icons.inventory_2_outlined),
  customers('Clientes', Icons.people_outline),
  employees('Empleados', Icons.badge_outlined),
  parties('Fiestas', Icons.celebration_outlined),
  access('Accesos', Icons.qr_code_scanner_outlined),
  // TASK 14.5 (Wave 3, Phase 7, Item 4): the 8th real report area.
  promotions('Promociones', Icons.local_offer_outlined);

  const _ReportArea(this.label, this.icon);
  final String label;
  final IconData icon;
}

enum _ReportPhase { loading, ready, failure }

String _isoDate(DateTime value) =>
    '${value.year.toString().padLeft(4, '0')}-'
    '${value.month.toString().padLeft(2, '0')}-'
    '${value.day.toString().padLeft(2, '0')}';

/// Public entry point — reached from `PosModule.reports` ("Reportes") in
/// `pos_shell.dart`'s module switch (see that file's own wiring for this
/// screen, applied centrally by the orchestrator per this task's own
/// constraint).
class PosReportsScreen extends StatefulWidget {
  const PosReportsScreen({required this.context, required this.reportsGateway, super.key});

  final AuthenticatedContext context;
  final PosReportsGateway reportsGateway;

  @override
  State<PosReportsScreen> createState() => _PosReportsScreenState();
}

class _PosReportsScreenState extends State<PosReportsScreen> {
  _ReportArea _area = _ReportArea.sales;
  late DateTime _dateFrom;
  late DateTime _dateTo;
  // TASK 16.23B (F-05) — the resolved BUSINESS "today", kept separate from
  // `_dateTo` (which the user's own range picker freely changes) so the
  // picker's own upper bound stays correct even after a manual pick. Only
  // ever the provisional `initState` value until `_resolveBusinessToday`
  // corrects it, exactly like `_dateTo`/`_dateFrom` themselves.
  late DateTime _businessToday;

  @override
  void initState() {
    super.initState();
    // A sensible pre-filled convenience range ("últimos 7 días") — the
    // user can change it, but no report call ever fires before a real
    // range (however chosen) exists; this task's own instruction forbids
    // any silent "all time" default, and this is not that.
    //
    // TASK 16.23B (F-05) — the device's own clock is only ever a
    // PROVISIONAL placeholder here, corrected immediately below via the
    // real branch/company business date (never the final, authoritative
    // value — the exact bug this task closes). `initState` cannot itself
    // `await`, so this two-step (provisional-then-corrected) shape is the
    // same one `_DashboardTopBanner`'s own async summary fetch already
    // uses for the identical reason.
    final now = DateTime.now();
    _businessToday = DateTime(now.year, now.month, now.day);
    _dateTo = _businessToday;
    _dateFrom = _dateTo.subtract(const Duration(days: 6));
  }

  bool _businessTodayRequested = false;
  // TASK 16.23B (F-05) — gates the report panels' first construction: each
  // panel below is keyed by `_rangeKey` (derived from `_dateFrom`/`_dateTo`),
  // so rendering one against the provisional device-local range and then
  // correcting it would re-key the panel, tearing it down and rebuilding
  // it — firing the report gateway a second time. Exactly the same failure
  // mode `_Dashboard`/`_DashboardBody` had in `pos_shell.dart` (see that
  // file's own `_today` doc comment); resolved the same way, by never
  // constructing the panel until resolution (success, fallback, or a
  // missing timezone) has completed.
  bool _businessTodayResolved = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _resolveBusinessToday();
  }

  // Guarded by `_businessTodayRequested` exactly like `_DashboardTopBanner
  // ._requestBannerSummary` — `didChangeDependencies` can fire more than
  // once (e.g. a theme/locale change), and this must only ever correct
  // the PROVISIONAL initState guess once, never re-fire and silently
  // discard a user's own manually-picked range on an unrelated rebuild.
  void _resolveBusinessToday() {
    if (_businessTodayRequested) return;
    final timezone = widget.context.businessTimezone;
    if (timezone == null) {
      // No timezone available — keep the provisional range and unblock
      // the panels immediately; never crash the screen over this.
      _businessTodayRequested = true;
      setState(() => _businessTodayResolved = true);
      return;
    }
    _businessTodayRequested = true;
    PlatformScope.of(context).posReadGateway.businessDate(timezone: timezone).then((today) {
      if (!mounted) return;
      final parts = today.split('-').map(int.parse).toList(growable: false);
      final businessToday = DateTime(parts[0], parts[1], parts[2]);
      // Only auto-correct the DEFAULT range (the user has not yet picked
      // one of their own) — a real pick is never silently overwritten by
      // a background timezone correction that lands after the fact.
      final defaultRangeStillActive = _dateTo == _businessToday && _dateFrom == _businessToday.subtract(const Duration(days: 6));
      setState(() {
        _businessTodayResolved = true;
        if (businessToday == _businessToday) return; // Provisional guess was already correct — no redundant rebuild.
        _businessToday = businessToday;
        if (defaultRangeStillActive) {
          _dateTo = businessToday;
          _dateFrom = businessToday.subtract(const Duration(days: 6));
        }
      });
    }).catchError((Object _) {
      if (!mounted) return;
      // Keep the provisional range on failure — a best-effort correction,
      // never a reason to block the whole Reports screen from rendering.
      setState(() => _businessTodayResolved = true);
    });
  }

  /// Mirrors `_HeldSales`'s own `_filter` getter exactly (see
  /// `pos_shell.dart`): company-wide access reports across every branch
  /// the session permits (`branchId: null`), never a project-invented
  /// "all branches everywhere" bypass; a branch-scoped session always
  /// reports its own single branch.
  String? get _branchId => widget.context.companyWideAccess ? null : widget.context.session.branchId;

  PosReportFilter get _filter =>
      PosReportFilter(dateFrom: _isoDate(_dateFrom), dateTo: _isoDate(_dateTo), branchId: _branchId);

  PosReportDateRange get _range => PosReportDateRange(dateFrom: _isoDate(_dateFrom), dateTo: _isoDate(_dateTo));

  String get _rangeKey => '${_filter.dateFrom}_${_filter.dateTo}_${_filter.branchId ?? 'all'}';

  Future<void> _pickRange() async {
    // TASK 16.23B (F-05) — bounded by the resolved BUSINESS today, not
    // the device's own clock (which could disagree by a day at either
    // edge of a UTC boundary and wrongly allow/forbid picking it).
    final picked = await showDateRangePicker(
      context: context,
      firstDate: DateTime(_businessToday.year - 5),
      lastDate: _businessToday,
      initialDateRange: DateTimeRange(start: _dateFrom, end: _dateTo),
      helpText: 'Selecciona el rango del reporte',
      cancelText: 'Cancelar',
      confirmText: 'Aplicar',
      saveText: 'Aplicar',
    );
    if (picked == null || !mounted) return;
    setState(() {
      _dateFrom = DateTime(picked.start.year, picked.start.month, picked.start.day);
      _dateTo = DateTime(picked.end.year, picked.end.month, picked.end.day);
    });
  }

  @override
  Widget build(BuildContext context) {
    final allowed = widget.context.permissions.contains('report.read');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _ReportsHeader(
          dateFrom: _dateFrom,
          dateTo: _dateTo,
          branchLabel: widget.context.companyWideAccess
              ? 'Todas las sucursales'
              : (widget.context.currentBranch?.name ?? 'Sucursal actual'),
          onPickRange: _pickRange,
        ),
        const SizedBox(height: 14),
        _ReportsAreaTabs(selected: _area, onSelected: (area) => setState(() => _area = area)),
        const SizedBox(height: 14),
        if (!allowed)
          const _ReportsPermissionState()
        else if (!_businessTodayResolved)
          // Business date still resolving — never construct a report panel
          // against a provisional guess (see `_businessTodayResolved`'s own
          // doc comment).
          const _ReportsLoadingState()
        else
          switch (_area) {
            _ReportArea.sales => _SalesReportPanel(
              key: ValueKey('pos-reports-sales-$_rangeKey'),
              filter: _filter,
              gateway: widget.reportsGateway,
            ),
            _ReportArea.financial => _FinancialReportPanel(
              key: ValueKey('pos-reports-financial-$_rangeKey'),
              filter: _filter,
              gateway: widget.reportsGateway,
            ),
            _ReportArea.inventory => _InventoryReportPanel(
              key: ValueKey('pos-reports-inventory-$_rangeKey'),
              filter: _filter,
              gateway: widget.reportsGateway,
            ),
            _ReportArea.customers => _CustomersReportPanel(
              key: ValueKey('pos-reports-customers-$_rangeKey'),
              range: _range,
              gateway: widget.reportsGateway,
            ),
            _ReportArea.employees => _EmployeesReportPanel(
              key: ValueKey('pos-reports-employees-$_rangeKey'),
              filter: _filter,
              gateway: widget.reportsGateway,
            ),
            _ReportArea.parties => _PartiesReportPanel(
              key: ValueKey('pos-reports-parties-$_rangeKey'),
              filter: _filter,
              gateway: widget.reportsGateway,
            ),
            _ReportArea.access => _AccessReportPanel(
              key: ValueKey('pos-reports-access-$_rangeKey'),
              filter: _filter,
              gateway: widget.reportsGateway,
            ),
            _ReportArea.promotions => _PromotionsReportPanel(
              key: ValueKey('pos-reports-promotions-$_rangeKey'),
              filter: _filter,
              gateway: widget.reportsGateway,
            ),
          },
      ],
    );
  }
}

// --- Header / tabs -----------------------------------------------------

class _ReportsHeader extends StatelessWidget {
  const _ReportsHeader({
    required this.dateFrom,
    required this.dateTo,
    required this.branchLabel,
    required this.onPickRange,
  });

  final DateTime dateFrom;
  final DateTime dateTo;
  final String branchLabel;
  final VoidCallback onPickRange;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Centro de Reportes',
                style: TextStyle(color: palette.text, fontSize: 22, fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 4),
              Text(
                'Cifras reales calculadas por el servidor para el rango y sucursal seleccionados. '
                'Sin métricas simuladas ni estimaciones no provistas por el backend.',
                style: TextStyle(color: palette.textSecondary, fontSize: 12.5),
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Icon(Icons.store_outlined, size: 15, color: palette.textMuted),
                  const SizedBox(width: 5),
                  Text(branchLabel, style: TextStyle(color: palette.textMuted, fontSize: 12.5)),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(width: 12),
        OutlinedButton.icon(
          key: const Key('pos-reports-range-button'),
          onPressed: onPickRange,
          icon: const Icon(Icons.date_range_outlined, size: 17),
          label: Text('${_isoDate(dateFrom)} → ${_isoDate(dateTo)}'),
          style: OutlinedButton.styleFrom(
            foregroundColor: palette.blueDeep,
            side: BorderSide(color: palette.border),
          ),
        ),
      ],
    );
  }
}

class _ReportsAreaTabs extends StatelessWidget {
  const _ReportsAreaTabs({required this.selected, required this.onSelected});
  final _ReportArea selected;
  final ValueChanged<_ReportArea> onSelected;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          for (final area in _ReportArea.values)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: ChoiceChip(
                key: Key('pos-reports-area-${area.name}'),
                selected: area == selected,
                onSelected: (_) => onSelected(area),
                avatar: Icon(
                  area.icon,
                  size: 16,
                  color: area == selected ? palette.surface : palette.textSecondary,
                ),
                label: Text(area.label),
                labelStyle: TextStyle(
                  color: area == selected ? palette.surface : palette.text,
                  fontWeight: FontWeight.w700,
                ),
                selectedColor: palette.action,
                backgroundColor: palette.surface,
                side: BorderSide(color: palette.border),
              ),
            ),
        ],
      ),
    );
  }
}

// --- Shared state shell (phase enum + loading/failure) ------------------

/// A reusable "phase enum + loading/failure state" shell — mirrors
/// `_HeldSales`/`_CutHistory`'s own load/error handling shape in
/// `pos_shell.dart`, generalized once here instead of hand-duplicated
/// across all 7 report areas. Callers key each instance by their own
/// date-range/branch/area combination (see `PosReportsScreen`'s
/// `ValueKey`s above) so a filter change always tears down and reloads
/// from scratch — the same structural guarantee `_Caja` uses when keyed
/// by branch.
class _ReportPanel<T> extends StatefulWidget {
  const _ReportPanel({required this.load, required this.builder, super.key});

  final Future<T> Function() load;
  final Widget Function(BuildContext context, T data) builder;

  @override
  State<_ReportPanel<T>> createState() => _ReportPanelState<T>();
}

class _ReportPanelState<T> extends State<_ReportPanel<T>> {
  _ReportPhase _phase = _ReportPhase.loading;
  T? _data;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    setState(() {
      _phase = _ReportPhase.loading;
      _errorMessage = null;
    });
    try {
      final data = await widget.load();
      if (!mounted) return;
      setState(() {
        _data = data;
        _phase = _ReportPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _ReportPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _ReportPhase.failure;
        _errorMessage = 'No fue posible cargar el reporte.';
      });
    }
  }

  @override
  Widget build(BuildContext context) => switch (_phase) {
    _ReportPhase.loading => const _ReportsLoadingState(),
    _ReportPhase.failure => _ReportsFailureState(
      message: _errorMessage ?? 'No fue posible cargar el reporte.',
      onRetry: () => unawaited(_load()),
    ),
    // A `ready` report is never "empty" as a distinct phase — the backend
    // always returns a real object; a genuinely empty range simply comes
    // back with real zero counts and empty sub-lists, rendered plainly by
    // each area's own builder below (see `_ReportsMoneyList`/
    // `_ReportsStatusTable`'s own empty-state text).
    _ReportPhase.ready => widget.builder(context, _data as T),
  };
}

// --- Per-area panels ------------------------------------------------------

class _SalesReportPanel extends StatelessWidget {
  const _SalesReportPanel({required this.filter, required this.gateway, super.key});
  final PosReportFilter filter;
  final PosReportsGateway gateway;

  Future<void> _export(BuildContext context) => _exportCsv(
    context: context,
    filenamePrefix: 'ventas',
    filter: filter,
    fetch: () => gateway.exportSalesCsv(filter: filter),
  );

  @override
  Widget build(BuildContext context) => _ReportPanel<PosSalesReport>(
    load: () => gateway.salesReport(filter: filter),
    builder: (context, report) => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _ReportSectionHeader(
          title: 'Ventas',
          action: _CsvExportButton(
            reportsKey: 'pos-reports-sales-export-csv',
            onPressed: () => unawaited(_export(context)),
          ),
        ),
        Row(
          children: [
            Expanded(
              child: _ReportsStatTile(label: 'Transacciones completadas', value: '${report.transactionCount}'),
            ),
            const SizedBox(width: 12),
            Expanded(child: _ReportsStatTile(label: 'Devoluciones completadas', value: '${report.refundCount}')),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(child: _ReportsMoneySection(title: 'Ventas brutas', amounts: report.grossSales)),
            const SizedBox(width: 12),
            Expanded(child: _ReportsMoneySection(title: 'Total devuelto', amounts: report.refundsTotal)),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(child: _ReportsMoneySection(title: 'Ventas netas', amounts: report.netSales)),
            const SizedBox(width: 12),
            Expanded(child: _ReportsMoneySection(title: 'Ticket promedio', amounts: report.averageTicket)),
          ],
        ),
      ],
    ),
  );
}

class _FinancialReportPanel extends StatelessWidget {
  const _FinancialReportPanel({required this.filter, required this.gateway, super.key});
  final PosReportFilter filter;
  final PosReportsGateway gateway;

  Future<void> _export(BuildContext context) => _exportCsv(
    context: context,
    filenamePrefix: 'financiero',
    filter: filter,
    fetch: () => gateway.exportFinancialCsv(filter: filter),
  );

  @override
  Widget build(BuildContext context) => _ReportPanel<PosFinancialReport>(
    load: () => gateway.financialReport(filter: filter),
    builder: (context, report) => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _ReportSectionHeader(
          title: 'Financiero',
          action: _CsvExportButton(
            reportsKey: 'pos-reports-financial-export-csv',
            onPressed: () => unawaited(_export(context)),
          ),
        ),
        Row(
          children: [
            Expanded(
              child: _ReportsStatTile(label: 'Sesiones de caja abiertas', value: '${report.sessionsOpenedCount}'),
            ),
            const SizedBox(width: 12),
            Expanded(child: _ReportsMoneySection(title: 'Movimiento neto de caja', amounts: report.netCashMovement)),
          ],
        ),
        const SizedBox(height: 12),
        _ReportsCard(
          title: 'Movimientos por tipo',
          child: report.movementTotals.isEmpty
              ? const _ReportsEmptyNote(message: 'Sin movimientos de caja en este rango.')
              : _ReportsTable(
                  columns: const ['Tipo', 'Moneda', 'Monto', 'Cantidad'],
                  rows: [
                    for (final entry in report.movementTotals)
                      [entry.movementType, entry.currencyCode, _formatAmountString(entry.amount, entry.currencyCode), '${entry.count}'],
                  ],
                ),
        ),
        const SizedBox(height: 12),
        _ReportsCard(
          title: 'Sesiones de caja cerradas',
          child: report.closedSessions.isEmpty
              ? const _ReportsEmptyNote(message: 'Ninguna sesión de caja se cerró en este rango.')
              : _ReportsTable(
                  columns: const ['Moneda', 'Sesiones', 'Declarado', 'Esperado', 'Diferencia'],
                  rows: [
                    for (final entry in report.closedSessions)
                      [
                        entry.currencyCode,
                        '${entry.sessionCount}',
                        _formatAmountString(entry.declaredClosingTotal, entry.currencyCode),
                        _formatAmountString(entry.expectedClosingTotal, entry.currencyCode),
                        _formatAmountString(entry.discrepancyTotal, entry.currencyCode),
                      ],
                  ],
                ),
        ),
      ],
    ),
  );
}

class _InventoryReportPanel extends StatelessWidget {
  const _InventoryReportPanel({required this.filter, required this.gateway, super.key});
  final PosReportFilter filter;
  final PosReportsGateway gateway;

  // TASK 14.5 (Wave 3, Phase 7, Item 2) — real Kardex CSV export, reusing
  // the exact same `_exportCsv`/`downloadCsvFile` mechanism every other
  // report area's export button already uses (never a second, divergent
  // download path).
  Future<void> _exportKardex(BuildContext context) => _exportCsv(
    context: context,
    filenamePrefix: 'kardex',
    filter: filter,
    fetch: () => gateway.exportKardexCsv(filter: filter),
  );

  @override
  Widget build(BuildContext context) => _ReportPanel<PosInventoryReport>(
    load: () => gateway.inventoryReport(filter: filter),
    builder: (context, report) => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _ReportSectionHeader(
          title: 'Inventario',
          action: _CsvExportButton(
            reportsKey: 'pos-reports-kardex-export-csv',
            onPressed: () => unawaited(_exportKardex(context)),
          ),
        ),
        Text(
          'Existencias en tiempo real (no filtradas por fecha); el movimiento de abajo sí respeta el rango seleccionado.',
          style: TextStyle(color: PosPalette.of(context).textMuted, fontSize: 12),
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(child: _ReportsStatTile(label: 'Variantes con inventario', value: '${report.trackedVariantCount}')),
            const SizedBox(width: 12),
            Expanded(child: _ReportsStatTile(label: 'Variantes agotadas', value: '${report.outOfStockVariantCount}')),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(child: _ReportsStatTile(label: 'Cantidad disponible', value: report.quantityOnHandTotal, unit: 'unidades')),
            const SizedBox(width: 12),
            Expanded(child: _ReportsStatTile(label: 'Cantidad reservada', value: report.quantityReservedTotal, unit: 'unidades')),
            const SizedBox(width: 12),
            Expanded(child: _ReportsStatTile(label: 'En tránsito', value: report.quantityInTransitTotal, unit: 'unidades')),
          ],
        ),
        const SizedBox(height: 12),
        _ReportsMoneySection(title: 'Valor de inventario', amounts: report.inventoryValue),
        const SizedBox(height: 12),
        _ReportsCard(
          title: 'Movimiento de inventario en el rango',
          child: report.movementVolume.isEmpty
              ? const _ReportsEmptyNote(message: 'Sin movimientos de inventario en este rango.')
              : _ReportsTable(
                  columns: const ['Tipo de movimiento', 'Cantidad de movimientos', 'Unidades base'],
                  rows: [
                    for (final entry in report.movementVolume)
                      [entry.movementType, '${entry.movementCount}', entry.totalBaseQuantity],
                  ],
                ),
        ),
      ],
    ),
  );
}

class _CustomersReportPanel extends StatelessWidget {
  const _CustomersReportPanel({required this.range, required this.gateway, super.key});
  final PosReportDateRange range;
  final PosReportsGateway gateway;

  @override
  Widget build(BuildContext context) => _ReportPanel<PosCustomersReport>(
    load: () => gateway.customersReport(range: range),
    builder: (context, report) => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const _ReportSectionHeader(title: 'Clientes'),
        Text(
          'Sin dimensión de sucursal: los clientes son una identidad a nivel de empresa.',
          style: TextStyle(color: PosPalette.of(context).textMuted, fontSize: 12),
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(child: _ReportsStatTile(label: 'Clientes totales', value: '${report.totalCustomers}')),
            const SizedBox(width: 12),
            Expanded(child: _ReportsStatTile(label: 'Clientes nuevos en el rango', value: '${report.newCustomersInRange}')),
            const SizedBox(width: 12),
            Expanded(
              child: _ReportsStatTile(label: 'Cuentas de lealtad activas', value: '${report.activeLoyaltyAccountCount}'),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: _ReportsCard(
                title: 'Clientes por estado',
                child: _ReportsStatusTable(items: report.customersByStatus),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _ReportsCard(
                title: 'Membresías por estado',
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _ReportsStatusTable(items: report.membershipsByStatus),
                    const SizedBox(height: 8),
                    Text(
                      'Membresías nuevas en el rango: ${report.newMembershipsInRange}',
                      style: TextStyle(color: PosPalette.of(context).textSecondary, fontSize: 12.5),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ],
    ),
  );
}

class _EmployeesReportPanel extends StatelessWidget {
  const _EmployeesReportPanel({required this.filter, required this.gateway, super.key});
  final PosReportFilter filter;
  final PosReportsGateway gateway;

  @override
  Widget build(BuildContext context) => _ReportPanel<PosEmployeesReport>(
    load: () => gateway.employeesReport(filter: filter),
    builder: (context, report) => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const _ReportSectionHeader(title: 'Empleados'),
        Row(
          children: [
            Expanded(child: _ReportsStatTile(label: 'Entradas de asistencia', value: '${report.clockInCount}')),
            const SizedBox(width: 12),
            Expanded(child: _ReportsStatTile(label: 'Salidas de asistencia', value: '${report.clockOutCount}')),
            const SizedBox(width: 12),
            Expanded(
              child: _ReportsStatTile(label: 'Empleados distintos', value: '${report.distinctEmployeesPunched}'),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: _ReportsCard(title: 'Empleados por estado', child: _ReportsStatusTable(items: report.employeesByStatus)),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _ReportsCard(
                title: 'Nómina de periodos cerrados',
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      'Periodos cerrados en el rango: ${report.closedPayrollPeriodCount}',
                      style: TextStyle(color: PosPalette.of(context).textSecondary, fontSize: 12.5),
                    ),
                    const SizedBox(height: 8),
                    _ReportsMoneyList(amounts: report.closedPayrollTotals),
                  ],
                ),
              ),
            ),
          ],
        ),
      ],
    ),
  );
}

class _PartiesReportPanel extends StatelessWidget {
  const _PartiesReportPanel({required this.filter, required this.gateway, super.key});
  final PosReportFilter filter;
  final PosReportsGateway gateway;

  @override
  Widget build(BuildContext context) => _ReportPanel<PosPartiesReport>(
    load: () => gateway.partiesReport(filter: filter),
    builder: (context, report) => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const _ReportSectionHeader(title: 'Fiestas'),
        Row(
          children: [
            Expanded(child: _ReportsStatTile(label: 'Salones activos', value: '${report.activeRoomCount}')),
            const SizedBox(width: 12),
            Expanded(child: _ReportsStatTile(label: 'Salones reservados en el rango', value: '${report.roomsBookedCount}')),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(child: _ReportsMoneySection(title: 'Ingreso cotizado', amounts: report.bookedRevenue)),
            const SizedBox(width: 12),
            Expanded(child: _ReportsMoneySection(title: 'Ingreso cobrado', amounts: report.collectedRevenue)),
          ],
        ),
        const SizedBox(height: 12),
        _ReportsCard(title: 'Reservaciones por estado', child: _ReportsStatusTable(items: report.reservationsByStatus)),
      ],
    ),
  );
}

class _AccessReportPanel extends StatelessWidget {
  const _AccessReportPanel({required this.filter, required this.gateway, super.key});
  final PosReportFilter filter;
  final PosReportsGateway gateway;

  @override
  Widget build(BuildContext context) => _ReportPanel<PosAccessReport>(
    load: () => gateway.accessReport(filter: filter),
    builder: (context, report) => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const _ReportSectionHeader(title: 'Control de acceso'),
        Row(
          children: [
            Expanded(child: _ReportsStatTile(label: 'Entradas en el rango', value: '${report.entryCount}')),
            const SizedBox(width: 12),
            Expanded(child: _ReportsStatTile(label: 'Salidas en el rango', value: '${report.exitCount}')),
            const SizedBox(width: 12),
            Expanded(child: _ReportsStatTile(label: 'Ocupación actual', value: '${report.currentOccupancy}')),
          ],
        ),
        const SizedBox(height: 8),
        Text(
          'La ocupación actual es una foto en tiempo real (no filtrada por fecha).',
          style: TextStyle(color: PosPalette.of(context).textMuted, fontSize: 12),
        ),
      ],
    ),
  );
}

// TASK 14.5 (Wave 3, Phase 7, Item 4) — the 8th real report area, over
// `coupon_redemptions`/`sale_discounts`. No CSV export here (unlike Sales/
// Financial/Kardex): this report's own purpose is the "at a glance"
// aggregate + top-coupons list, not a row-level export — matching how
// Inventory/Customers/Employees/Parties/Access also carry no export
// button.
class _PromotionsReportPanel extends StatelessWidget {
  const _PromotionsReportPanel({required this.filter, required this.gateway, super.key});
  final PosReportFilter filter;
  final PosReportsGateway gateway;

  @override
  Widget build(BuildContext context) => _ReportPanel<PosPromotionsReport>(
    load: () => gateway.promotionsReport(filter: filter),
    builder: (context, report) => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const _ReportSectionHeader(title: 'Promociones y cupones'),
        Text(
          'Uso real de cupones y promociones aplicadas en ventas — descuentos manuales y recompensas '
          'tienen su propio reporte y nunca se mezclan aquí.',
          style: TextStyle(color: PosPalette.of(context).textMuted, fontSize: 12),
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(child: _ReportsStatTile(label: 'Cupones canjeados', value: '${report.couponRedemptionCount}')),
            const SizedBox(width: 12),
            Expanded(
              child: _ReportsStatTile(label: 'Descuentos por promoción', value: '${report.promotionDiscountCount}'),
            ),
            const SizedBox(width: 12),
            Expanded(child: _ReportsStatTile(label: 'Descuentos por cupón', value: '${report.couponDiscountCount}')),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(child: _ReportsMoneySection(title: 'Total canjeado en cupones', amounts: report.couponRedemptionsTotal)),
            const SizedBox(width: 12),
            Expanded(child: _ReportsMoneySection(title: 'Descuento por promociones', amounts: report.promotionDiscountTotal)),
            const SizedBox(width: 12),
            Expanded(child: _ReportsMoneySection(title: 'Descuento por cupones', amounts: report.couponDiscountTotal)),
          ],
        ),
        const SizedBox(height: 12),
        _ReportsCard(
          title: 'Cupones más canjeados',
          child: report.topCoupons.isEmpty
              ? const _ReportsEmptyNote(message: 'Ningún cupón fue canjeado en este rango.')
              : _ReportsTable(
                  columns: const ['Código', 'Canjes'],
                  rows: [
                    for (final entry in report.topCoupons) [entry.code, '${entry.redemptionCount}'],
                  ],
                ),
        ),
      ],
    ),
  );
}

// --- CSV export -------------------------------------------------------

Future<void> _exportCsv({
  required BuildContext context,
  required String filenamePrefix,
  required PosReportFilter filter,
  required Future<String> Function() fetch,
}) async {
  final messenger = ScaffoldMessenger.maybeOf(context);
  try {
    final csv = await fetch();
    final filename = '$filenamePrefix-${filter.dateFrom}-${filter.dateTo}.csv';
    final downloaded = downloadCsvFile(filename: filename, csvContent: csv);
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
    messenger?.showSnackBar(const SnackBar(content: Text('No fue posible exportar el CSV.')));
  }
}

// --- Shared display widgets ------------------------------------------

class _ReportSectionHeader extends StatelessWidget {
  const _ReportSectionHeader({required this.title, this.action});
  final String title;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        children: [
          Expanded(
            child: Text(title, style: TextStyle(color: palette.text, fontSize: 17, fontWeight: FontWeight.w800)),
          ),
          if (action != null) action!,
        ],
      ),
    );
  }
}

class _CsvExportButton extends StatelessWidget {
  const _CsvExportButton({required this.reportsKey, required this.onPressed});
  final String reportsKey;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return OutlinedButton.icon(
      key: Key(reportsKey),
      onPressed: onPressed,
      icon: const Icon(Icons.download_outlined, size: 16),
      label: const Text('Exportar CSV'),
      style: OutlinedButton.styleFrom(foregroundColor: palette.blueDeep, side: BorderSide(color: palette.border)),
    );
  }
}

class _ReportsCard extends StatelessWidget {
  const _ReportsCard({required this.child, this.title});
  final Widget child;
  final String? title;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: palette.surface,
        border: Border.all(color: palette.border),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (title != null) ...[
            Text(title!, style: TextStyle(color: palette.text, fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
          ],
          child,
        ],
      ),
    );
  }
}

/// Counts as counts (never dressed up as money). [unit] adds an honest
/// label (e.g. "unidades") for a raw, non-currency quantity — never a
/// fabricated conversion.
class _ReportsStatTile extends StatelessWidget {
  const _ReportsStatTile({required this.label, required this.value, this.unit});
  final String label;
  final String value;
  final String? unit;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return _ReportsCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(color: palette.textSecondary, fontSize: 11.5),
          ),
          const SizedBox(height: 6),
          // A `Column` (never a side-by-side `Row`) so a long value — a raw
          // decimal quantity plus its unit label, e.g. "340.000000
          // unidades" — never overflows a narrow stat tile horizontally;
          // wraps honestly instead of truncating a real number.
          Text(
            value,
            style: TextStyle(color: palette.text, fontSize: 20, fontWeight: FontWeight.w800),
          ),
          if (unit != null)
            Text(unit!, style: TextStyle(color: palette.textMuted, fontSize: 11.5)),
        ],
      ),
    );
  }
}

/// Right-aligned money, proper 2-decimal formatting via `Money`, one line
/// per currency actually present — never summed across currencies (see
/// `PosReportCurrencyAmount`'s own doc comment). A genuinely empty range
/// shows a plain, honest "sin movimientos" note, never an error and never
/// a fabricated `0.00` in an unknown currency.
class _ReportsMoneySection extends StatelessWidget {
  const _ReportsMoneySection({required this.title, required this.amounts});
  final String title;
  final List<PosReportCurrencyAmount> amounts;

  @override
  Widget build(BuildContext context) => _ReportsCard(
    title: title,
    child: _ReportsMoneyList(amounts: amounts),
  );
}

class _ReportsMoneyList extends StatelessWidget {
  const _ReportsMoneyList({required this.amounts});
  final List<PosReportCurrencyAmount> amounts;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    if (amounts.isEmpty) {
      return const _ReportsEmptyNote(message: 'Sin movimientos en este rango.');
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        for (final amount in amounts)
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Text(
              _formatAmountString(amount.amount, amount.currencyCode),
              textAlign: TextAlign.right,
              style: TextStyle(color: palette.text, fontSize: 18, fontWeight: FontWeight.w800),
            ),
          ),
      ],
    );
  }
}

class _ReportsStatusTable extends StatelessWidget {
  const _ReportsStatusTable({required this.items});
  final List<PosReportStatusCount> items;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) {
      return const _ReportsEmptyNote(message: 'Sin registros en este rango.');
    }
    final palette = PosPalette.of(context);
    return Column(
      children: [
        for (final item in items)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Row(
              children: [
                Expanded(child: Text(item.status, style: TextStyle(color: palette.text))),
                Text(
                  '${item.count}',
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w800),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

/// A small, honest data table — real column headers, real rows, no
/// invented derived column. Wrapped in horizontal scroll for narrow
/// viewports rather than truncating a real value.
class _ReportsTable extends StatelessWidget {
  const _ReportsTable({required this.columns, required this.rows});
  final List<String> columns;
  final List<List<String>> rows;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: DataTable(
        headingRowHeight: 34,
        dataRowMinHeight: 32,
        dataRowMaxHeight: 40,
        columns: [
          for (final column in columns)
            DataColumn(label: Text(column, style: TextStyle(color: palette.textSecondary, fontSize: 12))),
        ],
        rows: [
          for (final row in rows)
            DataRow(
              cells: [
                for (var i = 0; i < row.length; i++)
                  DataCell(
                    Text(
                      row[i],
                      textAlign: i == 0 ? TextAlign.left : TextAlign.right,
                      style: TextStyle(color: palette.text, fontSize: 12.5),
                    ),
                  ),
              ],
            ),
        ],
      ),
    );
  }
}

class _ReportsEmptyNote extends StatelessWidget {
  const _ReportsEmptyNote({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) =>
      Text(message, style: TextStyle(color: PosPalette.of(context).textMuted, fontSize: 12.5));
}

class _ReportsLoadingState extends StatelessWidget {
  const _ReportsLoadingState();

  @override
  Widget build(BuildContext context) => const SizedBox(
    height: 220,
    child: Center(child: CircularProgressIndicator(key: Key('pos-reports-loading'))),
  );
}

class _ReportsFailureState extends StatelessWidget {
  const _ReportsFailureState({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return _ReportsCard(
      child: SizedBox(
        height: 180,
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.error_outline, size: 34, color: palette.blueDeep),
              const SizedBox(height: 8),
              Text('No fue posible cargar', style: TextStyle(color: palette.text, fontWeight: FontWeight.w800)),
              const SizedBox(height: 4),
              Text(
                message,
                textAlign: TextAlign.center,
                style: TextStyle(color: palette.textSecondary, fontSize: 12.5),
              ),
              const SizedBox(height: 10),
              TextButton.icon(
                key: const Key('pos-reports-failure-retry'),
                onPressed: onRetry,
                icon: const Icon(Icons.refresh),
                label: const Text('Reintentar'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ReportsPermissionState extends StatelessWidget {
  const _ReportsPermissionState();

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return _ReportsCard(
      child: SizedBox(
        key: const Key('pos-reports-permission-state'),
        height: 180,
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.lock_outline, size: 34, color: palette.blueDeep),
              const SizedBox(height: 8),
              Text('Acceso no autorizado', style: TextStyle(color: palette.text, fontWeight: FontWeight.w800)),
              const SizedBox(height: 4),
              Text(
                'Tu sesión no incluye el permiso de lectura de reportes (report.read).',
                textAlign: TextAlign.center,
                style: TextStyle(color: palette.textSecondary, fontSize: 12.5),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Formats a raw ADR-0001 decimal amount via `Money` (proper 2-decimal
/// rounding, never a re-parsed `double`) — mirrors `pos_shell.dart`'s own
/// `_formatMoney` exactly: `Money` only models non-negative amounts, so a
/// leading `-` (e.g. a cash-discrepancy or net-movement figure that came
/// out negative) is stripped before parsing and reattached to the
/// formatted result, rather than falling back to an unrounded raw string.
/// Always the real backend value, never a crash and never a silently
/// dropped sign. The currency code is always appended (unlike
/// `_formatMoney`'s single-currency Caja context) — a report can carry
/// more than one currency, and ADR-0001 forbids ever presenting an amount
/// without knowing which currency it's actually in.
String _formatAmountString(String amount, String currencyCode) {
  final trimmed = amount.trim();
  final negative = trimmed.startsWith('-');
  final magnitude = negative ? trimmed.substring(1) : trimmed;
  try {
    final money = Money.parse(magnitude, currencyCode);
    return '${negative ? '-' : ''}${money.toDisplayString()} $currencyCode';
  } on MoneyFormatException {
    return '$amount $currencyCode';
  }
}
