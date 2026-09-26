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
import 'pos_report_charts.dart';
import 'pos_report_pdf.dart';
import 'pos_reports_csv_download.dart';
import 'pos_reports_gateway.dart';
import 'pos_tokens.dart';
import 'receipt_print.dart';

enum _ReportArea {
  // TASK 16.25 — the management-overview area, first/default per the
  // owner's own "Centro de Reportes → Inteligencia" reference. Composes
  // the SAME `PosReportsGateway` calls the other tabs already use
  // (sales/access/customers/inventory) rather than a bespoke endpoint —
  // see `_IntelligenceReportPanel`'s own doc comment.
  intelligence('Inteligencia', Icons.insights_outlined),
  sales('Ventas', Icons.point_of_sale_outlined),
  financial('Financiero', Icons.account_balance_wallet_outlined),
  inventory('Inventario', Icons.inventory_2_outlined),
  customers('Clientes', Icons.people_outline),
  employees('Empleados', Icons.badge_outlined),
  parties('Fiestas', Icons.celebration_outlined),
  access('Accesos', Icons.qr_code_scanner_outlined),
  // TASK 14.5 (Wave 3, Phase 7, Item 4) — a 9TH real report area, added
  // to this product after (and beyond) the owner's original 8-area
  // reference (Inteligencia/Ventas/Financiero/Inventario/Clientes/
  // Empleados/Fiestas/Accesos). TASK 16.25.2's own audit confirmed it is
  // NOT inherited navigation or visual clutter: it is backed by a real
  // backend endpoint (`GET /api/v1/reports/promotions`,
  // `ReportsService.promotionsReport`) computing real coupon/promotion
  // discount counts and totals — see `_PromotionsReportPanel` below.
  // Kept for that reason; it is simply not part of the legacy's own
  // 8-tab list because it didn't exist as a reporting concept there.
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
  _ReportArea _area = _ReportArea.intelligence;
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

  // TASK 16.25 (Phase 4) — fast, real date-range presets, all computed
  // from the resolved BUSINESS today (never device-local `DateTime.now()`
  // — see `_businessToday`'s own doc comment), matching `_pickRange`'s
  // own day-precision `DateTime(y,m,d)` construction exactly.
  void _applyPreset(_ReportsDatePreset preset) {
    final today = _businessToday;
    final (from, to) = switch (preset) {
      _ReportsDatePreset.today => (today, today),
      _ReportsDatePreset.yesterday => (
        today.subtract(const Duration(days: 1)),
        today.subtract(const Duration(days: 1)),
      ),
      _ReportsDatePreset.thisWeek => (today.subtract(Duration(days: today.weekday - 1)), today),
      _ReportsDatePreset.lastWeek => (
        today.subtract(Duration(days: today.weekday - 1 + 7)),
        today.subtract(Duration(days: today.weekday)),
      ),
      _ReportsDatePreset.thisMonth => (DateTime(today.year, today.month), today),
      _ReportsDatePreset.lastMonth => (
        DateTime(today.year, today.month - 1),
        DateTime(today.year, today.month, 0),
      ),
    };
    setState(() {
      _dateFrom = from;
      _dateTo = to;
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
          onPreset: _applyPreset,
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
            _ReportArea.intelligence => _IntelligenceReportPanel(
              // Keyed by branch only (never the shared date range) — see
              // this panel's own doc comment on why it's always "today,"
              // independent of the other tabs' arbitrary period.
              key: ValueKey('pos-reports-intelligence-${_filter.branchId ?? 'all'}'),
              businessToday: _businessToday,
              branchId: _branchId,
              gateway: widget.reportsGateway,
            ),
            _ReportArea.sales => _SalesReportPanel(
              key: ValueKey('pos-reports-sales-$_rangeKey'),
              filter: _filter,
              gateway: widget.reportsGateway,
              companyName: widget.context.currentCompany?.name ?? 'AS ONE',
              branchLabel: widget.context.companyWideAccess
                  ? 'Todas las sucursales'
                  : (widget.context.currentBranch?.name ?? 'Sucursal actual'),
            ),
            _ReportArea.financial => _FinancialReportPanel(
              key: ValueKey('pos-reports-financial-$_rangeKey'),
              filter: _filter,
              gateway: widget.reportsGateway,
              companyName: widget.context.currentCompany?.name ?? 'AS ONE',
              branchLabel: widget.context.companyWideAccess
                  ? 'Todas las sucursales'
                  : (widget.context.currentBranch?.name ?? 'Sucursal actual'),
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

// TASK 16.25 (Phase 4) — real, fast date-range presets. Computed from
// the resolved business today in `_applyPreset` above — this enum only
// carries the label/ordering.
enum _ReportsDatePreset {
  today('Hoy'),
  yesterday('Ayer'),
  thisWeek('Esta semana'),
  lastWeek('Semana pasada'),
  thisMonth('Este mes'),
  lastMonth('Mes pasado');

  const _ReportsDatePreset(this.label);
  final String label;
}

class _ReportsHeader extends StatelessWidget {
  const _ReportsHeader({
    required this.dateFrom,
    required this.dateTo,
    required this.branchLabel,
    required this.onPickRange,
    required this.onPreset,
  });

  final DateTime dateFrom;
  final DateTime dateTo;
  final String branchLabel;
  final VoidCallback onPickRange;
  final ValueChanged<_ReportsDatePreset> onPreset;

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
                  Flexible(
                    child: Text(
                      branchLabel,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: palette.textMuted, fontSize: 12.5),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(width: 12),
        // A `Wrap` (never a rigid `Row`) — at a narrower desktop width
        // the preset menu and range buttons stack onto a second line
        // instead of overflowing the header horizontally.
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            PopupMenuButton<_ReportsDatePreset>(
              key: const Key('pos-reports-preset-menu'),
              tooltip: 'Periodos rápidos',
              onSelected: onPreset,
              itemBuilder: (context) => [
                for (final preset in _ReportsDatePreset.values)
                  PopupMenuItem(
                    key: Key('pos-reports-preset-${preset.name}'),
                    value: preset,
                    child: Text(preset.label),
                  ),
              ],
              child: IgnorePointer(
                child: OutlinedButton.icon(
                  onPressed: () {},
                  icon: const Icon(Icons.bolt_outlined, size: 16),
                  label: const Text('Periodos'),
                  style: OutlinedButton.styleFrom(foregroundColor: palette.textSecondary, side: BorderSide(color: palette.border)),
                ),
              ),
            ),
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

/// TASK 16.25 (Phase 5) — "Inteligencia," the management-overview area.
/// Composes ONLY the same `PosReportsGateway` calls the other tabs
/// already use (sales/access/customers/inventory) — no bespoke backend
/// endpoint, no second rewards/dashboard protocol. Always scoped to
/// TODAY (`businessToday`, the resolved BUSINESS date — never device-
/// local `DateTime.now()`), independent of the other tabs' own
/// arbitrary shared date range, matching the product intent of an "at a
/// glance today" screen.
///
/// TASK 16.25.2 — production visual review found this panel had drifted
/// into a generic 3-column KPI-card dashboard, losing the owner's
/// original "management command center" hierarchy (hero → compact KPI
/// row → dense two-column operations grid). This rebuild restores that
/// composition using ONLY the same real data this panel already loaded
/// — no new gateway call, no new metric.
///
/// "Meta del día" (no configurable daily-sales target exists anywhere
/// in this platform — inventing one would violate this task's own "no
/// fabricated business data" rule) renders as a prominent hero panel
/// that gracefully shows "No configurada" and suppresses any percentage
/// — never an invented target or completion ratio. "Estancia promedio"
/// IS now shown here too (per this correction's own explicit
/// composition), sourced from the exact same `access.averageStayMinutes`
/// the Accesos tab shows — never a second, independently-rounded
/// computation. Both `estancia promedio` and the legacy's own
/// water-park "real-time occupancy" concept were themselves HARDCODED
/// FAKE VALUES in the legacy product (`prom_estancia=95`, always-0
/// occupancy — see `docs/LEGACY_FUNCTIONAL_PARITY.md` §12) — this
/// screen replaces both with the real, live
/// `access.currentOccupancy`/`averageStayMinutes` this platform
/// actually computes. There is deliberately no per-area occupancy
/// breakdown ("Area X: n personas") — no such concept exists anywhere
/// in the backend, and inventing area names/counts would itself be
/// fabricated data; the occupancy panel shows the one real, live count
/// this platform has, honestly, rather than a plausible-looking table
/// of made-up rows.
class _IntelligenceReportPanel extends StatefulWidget {
  const _IntelligenceReportPanel({required this.businessToday, required this.branchId, required this.gateway, super.key});
  final DateTime businessToday;
  final String? branchId;
  final PosReportsGateway gateway;

  @override
  State<_IntelligenceReportPanel> createState() => _IntelligenceReportPanelState();
}

class _IntelligenceData {
  const _IntelligenceData({
    required this.today,
    required this.yesterday,
    required this.access,
    required this.customers,
    required this.inventory,
  });
  final PosSalesReport today;
  final PosSalesReport yesterday;
  final PosAccessReport access;
  final PosCustomersReport customers;
  final PosInventoryReport inventory;
}

class _IntelligenceReportPanelState extends State<_IntelligenceReportPanel> {
  _ReportPhase _phase = _ReportPhase.loading;
  _IntelligenceData? _data;
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
    final todayIso = _isoDate(widget.businessToday);
    final yesterdayIso = _isoDate(widget.businessToday.subtract(const Duration(days: 1)));
    final todayFilter = PosReportFilter(dateFrom: todayIso, dateTo: todayIso, branchId: widget.branchId);
    final yesterdayFilter = PosReportFilter(dateFrom: yesterdayIso, dateTo: yesterdayIso, branchId: widget.branchId);
    try {
      final results = await Future.wait([
        widget.gateway.salesReport(filter: todayFilter),
        widget.gateway.salesReport(filter: yesterdayFilter),
        widget.gateway.accessReport(filter: todayFilter),
        widget.gateway.customersReport(range: PosReportDateRange(dateFrom: todayIso, dateTo: todayIso)),
        widget.gateway.inventoryReport(filter: todayFilter),
      ]);
      if (!mounted) return;
      setState(() {
        _data = _IntelligenceData(
          today: results[0] as PosSalesReport,
          yesterday: results[1] as PosSalesReport,
          access: results[2] as PosAccessReport,
          customers: results[3] as PosCustomersReport,
          inventory: results[4] as PosInventoryReport,
        );
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
        _errorMessage = 'No fue posible cargar Inteligencia.';
      });
    }
  }

  /// `null` (never a fabricated 0%) when today or yesterday has no sales
  /// in a common currency to compare — matches `PosTrendChip`'s own
  /// "honest no-comparison" contract.
  double? _percentChange(PosSalesReport today, PosSalesReport yesterday) {
    if (today.grossSales.isEmpty) return null;
    final todayAmount = today.grossSales.first;
    final yesterdayEntry = yesterday.grossSales.where((entry) => entry.currencyCode == todayAmount.currencyCode).firstOrNull;
    if (yesterdayEntry == null) return null;
    final todayValue = double.tryParse(todayAmount.amount);
    final yesterdayValue = double.tryParse(yesterdayEntry.amount);
    if (todayValue == null || yesterdayValue == null || yesterdayValue == 0) return null;
    return (todayValue - yesterdayValue) / yesterdayValue * 100;
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    switch (_phase) {
      case _ReportPhase.loading:
        return const _ReportsLoadingState();
      case _ReportPhase.failure:
        return _ReportsFailureState(message: _errorMessage ?? 'No fue posible cargar Inteligencia.', onRetry: () => unawaited(_load()));
      case _ReportPhase.ready:
        final data = _data!;
        final activeMemberships = data.customers.membershipsByStatus.where((entry) => entry.status == 'active').firstOrNull?.count ?? 0;
        final alerts = <String>[
          if (data.inventory.outOfStockVariantCount > 0) '${data.inventory.outOfStockVariantCount} variante(s) agotada(s) en inventario.',
        ];
        // TASK 16.25.2 — "Ventas / hora": the mean of the SAME real
        // per-hour buckets the chart below already renders (one line per
        // currency actually present — never a new aggregation, never a
        // silently-summed cross-currency total).
        final hourlyByCurrency = <String, List<double>>{};
        for (final hour in data.today.salesByHour) {
          (hourlyByCurrency[hour.currencyCode] ??= <double>[]).add(double.tryParse(hour.grossSales) ?? 0);
        }
        final salesPerHour = <MapEntry<String, double>>[
          for (final entry in hourlyByCurrency.entries) MapEntry(entry.key, entry.value.reduce((a, b) => a + b) / entry.value.length),
        ];
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const _ReportSectionHeader(title: 'Inteligencia — hoy'),
            _MetaDelDiaHero(
              grossToday: data.today.grossSales,
              averageTicket: data.today.averageTicket,
              transactionCount: data.today.transactionCount,
              percentChange: _percentChange(data.today, data.yesterday),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 12,
              runSpacing: 12,
              children: [
                SizedBox(width: 170, child: _ReportsStatTile(label: 'Aforo actual', value: '${data.access.currentOccupancy}')),
                SizedBox(
                  width: 170,
                  child: _ReportsStatTile(
                    label: 'Ventas / hora',
                    value: salesPerHour.isEmpty
                        ? 'Sin datos'
                        : salesPerHour.map((entry) => _formatAmountString(entry.value.toStringAsFixed(2), entry.key)).join('\n'),
                  ),
                ),
                SizedBox(
                  width: 170,
                  child: _ReportsStatTile(
                    label: 'Estancia promedio',
                    value: data.access.averageStayMinutes == null ? 'Sin datos suficientes' : '${data.access.averageStayMinutes}',
                    unit: data.access.averageStayMinutes == null ? null : 'min',
                  ),
                ),
                SizedBox(width: 170, child: _ReportsStatTile(label: 'Membresías activas', value: '$activeMemberships')),
              ],
            ),
            const SizedBox(height: 12),
            _ReportsTwoColumnRow(
              rowKey: const Key('pos-reports-intelligence-ops-row-1'),
              left: _OccupancyPanel(
                currentOccupancy: data.access.currentOccupancy,
                entryCount: data.access.entryCount,
                exitCount: data.access.exitCount,
              ),
              right: _ReportsCard(
                title: 'Top productos del día',
                child: PosRankingBars(
                  key: const Key('pos-reports-intelligence-top-products'),
                  entries: [
                    for (final product in data.today.topProducts)
                      PosRankingEntry(
                        label: product.name,
                        value: double.tryParse(product.revenue) ?? 0,
                        valueLabel: _formatAmountString(product.revenue, product.currencyCode),
                      ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            _ReportsTwoColumnRow(
              rowKey: const Key('pos-reports-intelligence-ops-row-2'),
              left: _ReportsCard(
                title: 'Ventas por hora (hoy)',
                child: PosBarChart(
                  key: const Key('pos-reports-intelligence-hourly-chart'),
                  bars: [
                    for (final hour in data.today.salesByHour)
                      PosChartBar(
                        label: '${hour.hour}h',
                        value: double.tryParse(hour.grossSales) ?? 0,
                        valueLabel: _formatAmountString(hour.grossSales, hour.currencyCode),
                      ),
                  ],
                ),
              ),
              right: _ReportsCard(
                key: const Key('pos-reports-intelligence-alerts'),
                title: 'Alertas del sistema',
                child: alerts.isEmpty
                    ? const _ReportsEmptyNote(message: 'Sin alertas activas.')
                    : Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          for (final alert in alerts)
                            Padding(
                              padding: const EdgeInsets.symmetric(vertical: 3),
                              child: Row(
                                children: [
                                  Icon(Icons.warning_amber_outlined, size: 16, color: palette.warning),
                                  const SizedBox(width: 6),
                                  Expanded(child: Text(alert, style: TextStyle(color: palette.text, fontSize: 12.5))),
                                ],
                              ),
                            ),
                        ],
                      ),
              ),
            ),
          ],
        );
    }
  }
}

/// TASK 16.25.2 — the "Meta del día" management hero: production visual
/// review requires a prominent full-width band (the original product's
/// own blue-gradient composition — see `pos_shell.dart`'s established
/// `LinearGradient(colors: [palette.action, palette.blue])` convention,
/// reused here rather than inventing a new hero color), NOT the small
/// ordinary KPI card this had regressed into. No configurable daily-sales
/// target exists anywhere in this platform (verified — see
/// `_IntelligenceReportPanel`'s own class doc comment) — the center
/// completion indicator therefore ALWAYS renders as a neutral dash, never
/// a percentage computed against an invented denominator.
class _MetaDelDiaHero extends StatelessWidget {
  const _MetaDelDiaHero({
    required this.grossToday,
    required this.averageTicket,
    required this.transactionCount,
    required this.percentChange,
  });

  final List<PosReportCurrencyAmount> grossToday;
  final List<PosReportCurrencyAmount> averageTicket;
  final int transactionCount;
  final double? percentChange;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    const labelStyle = TextStyle(color: Colors.white70, fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: .4);
    const valueStyle = TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.w800);

    final left = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        const Text('META DEL DÍA', style: labelStyle),
        const SizedBox(height: 6),
        const Text(
          'No configurada',
          key: Key('pos-reports-intelligence-daily-goal'),
          style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 6),
        const Text('Ventas de hoy', style: TextStyle(color: Colors.white70, fontSize: 11.5)),
        const SizedBox(height: 2),
        if (grossToday.isEmpty)
          const Text('0', style: TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.w700))
        else
          for (final amount in grossToday)
            Text(
              _formatAmountString(amount.amount, amount.currencyCode),
              style: const TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.w700),
            ),
      ],
    );

    final center = Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          key: const Key('pos-reports-intelligence-hero-progress'),
          width: 72,
          height: 72,
          alignment: Alignment.center,
          decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: Colors.white38, width: 3)),
          child: const Text('—', style: TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.w800)),
        ),
        const SizedBox(height: 6),
        const Text('Sin meta configurada', style: TextStyle(color: Colors.white70, fontSize: 10.5)),
      ],
    );

    final right = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (percentChange == null)
              const Text('Sin datos de ayer', style: TextStyle(color: Colors.white70, fontSize: 12))
            else ...[
              Icon(
                percentChange! >= 0 ? Icons.arrow_upward : Icons.arrow_downward,
                size: 14,
                color: percentChange! >= 0 ? Colors.greenAccent.shade200 : Colors.redAccent.shade100,
              ),
              const SizedBox(width: 3),
              Text('${percentChange!.abs().toStringAsFixed(1)}% vs. ayer', style: valueStyle.copyWith(fontSize: 12.5)),
            ],
          ],
        ),
        const SizedBox(height: 10),
        const Text('TICKETS HOY', style: labelStyle),
        const SizedBox(height: 2),
        Text('$transactionCount', style: valueStyle),
        const SizedBox(height: 8),
        const Text('TICKET PROMEDIO', style: labelStyle),
        const SizedBox(height: 2),
        Text(
          averageTicket.isEmpty
              ? '0'
              : averageTicket.map((amount) => _formatAmountString(amount.amount, amount.currencyCode)).join(' · '),
          style: valueStyle,
        ),
      ],
    );

    return Container(
      key: const Key('pos-reports-intelligence-hero'),
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: LinearGradient(colors: [palette.action, palette.blue]),
        borderRadius: BorderRadius.circular(14),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          if (constraints.maxWidth < 640) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [left, const SizedBox(height: 16), center, const SizedBox(height: 16), right],
            );
          }
          return Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Expanded(flex: 2, child: left),
              Container(width: 1, height: 64, color: Colors.white24, margin: const EdgeInsets.symmetric(horizontal: 16)),
              center,
              Container(width: 1, height: 64, color: Colors.white24, margin: const EdgeInsets.symmetric(horizontal: 16)),
              Expanded(flex: 2, child: right),
            ],
          );
        },
      ),
    );
  }
}

/// TASK 16.25.2 — the dense two-column "operations grid" the original
/// Reports product used: a large left panel paired with a narrower right
/// panel, stacking gracefully at narrower widths (never a horizontal
/// overflow). The breakpoint (900px) sits above this screen's own widget
/// test harness content width (~760px, see `pos_reports_test.dart`'s
/// `_pump` doc comment) so ordinary tests exercise the stacked/narrow
/// form, and a dedicated wide-surface test exercises the two-column form
/// — see that test file's own "Desktop density" group.
class _ReportsTwoColumnRow extends StatelessWidget {
  const _ReportsTwoColumnRow({required this.left, required this.right, this.rowKey});
  final Widget left;
  final Widget right;
  // Applied to the actually-built `Row`/`Column` (never to this wrapper's
  // own `key`) — a widget-test can then find that single element and
  // check its `runtimeType` to prove which layout actually rendered. Using
  // this wrapper's own `key` instead would put the SAME key on two
  // elements at once (this `StatelessWidget` and its child), which is
  // exactly the "Too many elements" bug this comment now documents.
  final Key? rowKey;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      if (constraints.maxWidth < 900) {
        return Column(
          key: rowKey,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [left, const SizedBox(height: 12), right],
        );
      }
      return Row(
        key: rowKey,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(flex: 2, child: left),
          const SizedBox(width: 12),
          Expanded(child: right),
        ],
      );
    },
  );
}

/// TASK 16.25.2 — "Ocupación en tiempo real": there is deliberately no
/// per-area breakdown table (no "Alberca: 12, Toboganes: 4" style rows) —
/// no such concept exists anywhere in the backend (`PosAccessReport` has
/// exactly one real, live count: `currentOccupancy`), and inventing area
/// names/counts would itself be fabricated business data. The panel
/// structure always renders — a genuinely idle branch shows the real `0`
/// plus an honest inline note, never a giant generic empty-state card
/// replacing the whole panel.
class _OccupancyPanel extends StatelessWidget {
  const _OccupancyPanel({required this.currentOccupancy, required this.entryCount, required this.exitCount});
  final int currentOccupancy;
  final int entryCount;
  final int exitCount;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return _ReportsCard(
      key: const Key('pos-reports-intelligence-occupancy'),
      title: 'Ocupación en tiempo real',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.groups_outlined, size: 26, color: palette.action),
              const SizedBox(width: 10),
              Text('$currentOccupancy', style: TextStyle(color: palette.text, fontSize: 28, fontWeight: FontWeight.w800)),
              const SizedBox(width: 8),
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text('personas dentro', style: TextStyle(color: palette.textSecondary, fontSize: 12.5)),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Entradas hoy', style: TextStyle(color: palette.textSecondary, fontSize: 11.5)),
                    const SizedBox(height: 3),
                    Text('$entryCount', style: TextStyle(color: palette.text, fontSize: 15, fontWeight: FontWeight.w700)),
                  ],
                ),
              ),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Salidas hoy', style: TextStyle(color: palette.textSecondary, fontSize: 11.5)),
                    const SizedBox(height: 3),
                    Text('$exitCount', style: TextStyle(color: palette.text, fontSize: 15, fontWeight: FontWeight.w700)),
                  ],
                ),
              ),
            ],
          ),
          if (currentOccupancy == 0 && entryCount == 0 && exitCount == 0) ...[
            const SizedBox(height: 8),
            const _ReportsEmptyNote(message: 'Sin movimientos de acceso registrados en el rango.'),
          ],
        ],
      ),
    );
  }
}

class _SalesReportPanel extends StatelessWidget {
  const _SalesReportPanel({
    required this.filter,
    required this.gateway,
    required this.companyName,
    required this.branchLabel,
    super.key,
  });
  final PosReportFilter filter;
  final PosReportsGateway gateway;
  final String companyName;
  final String branchLabel;

  Future<void> _export(BuildContext context) => _exportCsv(
    context: context,
    filenamePrefix: 'ventas',
    filter: filter,
    fetch: () => gateway.exportSalesCsv(filter: filter),
  );

  // TASK 16.25 (Phase 17) — real KPIs + the same hourly/top-product data
  // already on screen, never a re-derived summary; see
  // `pos_report_pdf.dart`'s own doc comment for why this is the
  // established browser-print mechanism, not a new PDF stack.
  void _exportPdf(BuildContext context, PosSalesReport report) {
    final html = buildReportPdfHtml(
      companyName: companyName,
      branchLabel: branchLabel,
      areaLabel: 'Ventas',
      dateFrom: filter.dateFrom,
      dateTo: filter.dateTo,
      generatedAt: DateTime.now(),
      kpis: [
        ReportPdfKpi('Transacciones completadas', '${report.transactionCount}'),
        ReportPdfKpi('Devoluciones completadas', '${report.refundCount}'),
        for (final amount in report.grossSales) ReportPdfKpi('Ventas brutas', _formatAmountString(amount.amount, amount.currencyCode)),
        for (final amount in report.netSales) ReportPdfKpi('Ventas netas', _formatAmountString(amount.amount, amount.currencyCode)),
        for (final amount in report.averageTicket) ReportPdfKpi('Ticket promedio', _formatAmountString(amount.amount, amount.currencyCode)),
      ],
      tables: [
        ReportPdfTable(
          title: 'Ventas por hora',
          columns: const ['Hora', 'Moneda', 'Transacciones', 'Ventas brutas'],
          rows: [
            for (final hour in report.salesByHour)
              ['${hour.hour}:00', hour.currencyCode, '${hour.transactionCount}', _formatAmountString(hour.grossSales, hour.currencyCode)],
          ],
        ),
        ReportPdfTable(
          title: 'Productos más vendidos',
          columns: const ['Producto', 'Cantidad', 'Ingresos'],
          rows: [
            for (final product in report.topProducts)
              [product.name, product.quantitySold, _formatAmountString(product.revenue, product.currencyCode)],
          ],
        ),
      ],
    );
    final opened = openReceiptPrintWindow(html);
    ScaffoldMessenger.maybeOf(context)?.showSnackBar(
      SnackBar(
        content: Text(
          opened
              ? 'Se abrió la vista de impresión/PDF.'
              : 'Este entorno no puede abrir la ventana de impresión.',
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => _ReportPanel<PosSalesReport>(
    load: () => gateway.salesReport(filter: filter),
    builder: (context, report) => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _ReportSectionHeader(
          title: 'Ventas',
          action: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              _PdfExportButton(
                reportsKey: 'pos-reports-sales-export-pdf',
                onPressed: () => _exportPdf(context, report),
              ),
              const SizedBox(width: 8),
              _CsvExportButton(
                reportsKey: 'pos-reports-sales-export-csv',
                onPressed: () => unawaited(_export(context)),
              ),
            ],
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
        const SizedBox(height: 12),
        _ReportsCard(
          title: 'Ventas por hora',
          child: PosBarChart(
            key: const Key('pos-reports-sales-by-hour-chart'),
            bars: [
              for (final hour in report.salesByHour)
                PosChartBar(
                  label: '${hour.hour}h',
                  value: double.tryParse(hour.grossSales) ?? 0,
                  valueLabel: _formatAmountString(hour.grossSales, hour.currencyCode),
                ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        _ReportsCard(
          title: 'Productos más vendidos',
          child: PosRankingBars(
            key: const Key('pos-reports-top-products'),
            entries: [
              for (final product in report.topProducts)
                PosRankingEntry(
                  label: product.name,
                  value: double.tryParse(product.revenue) ?? 0,
                  valueLabel: _formatAmountString(product.revenue, product.currencyCode),
                ),
            ],
          ),
        ),
      ],
    ),
  );
}

class _FinancialReportPanel extends StatelessWidget {
  const _FinancialReportPanel({
    required this.filter,
    required this.gateway,
    required this.companyName,
    required this.branchLabel,
    super.key,
  });
  final PosReportFilter filter;
  final PosReportsGateway gateway;
  final String companyName;
  final String branchLabel;

  Future<void> _export(BuildContext context) => _exportCsv(
    context: context,
    filenamePrefix: 'financiero',
    filter: filter,
    fetch: () => gateway.exportFinancialCsv(filter: filter),
  );

  void _exportPdf(BuildContext context, PosFinancialReport report) {
    final html = buildReportPdfHtml(
      companyName: companyName,
      branchLabel: branchLabel,
      areaLabel: 'Financiero',
      dateFrom: filter.dateFrom,
      dateTo: filter.dateTo,
      generatedAt: DateTime.now(),
      kpis: [
        ReportPdfKpi('Sesiones de caja abiertas', '${report.sessionsOpenedCount}'),
        for (final amount in report.netCashMovement)
          ReportPdfKpi('Movimiento neto de caja', _formatAmountString(amount.amount, amount.currencyCode)),
      ],
      tables: [
        ReportPdfTable(
          title: 'Movimientos por tipo (caja)',
          columns: const ['Tipo', 'Moneda', 'Monto', 'Cantidad'],
          rows: [
            for (final entry in report.movementTotals)
              [entry.movementType, entry.currencyCode, _formatAmountString(entry.amount, entry.currencyCode), '${entry.count}'],
          ],
        ),
        ReportPdfTable(
          title: 'Cómo pagó el cliente (método de pago)',
          columns: const ['Método', 'Moneda', 'Monto', 'Cantidad'],
          rows: [
            for (final entry in report.paymentMethodTotals)
              [entry.paymentMethod, entry.currencyCode, _formatAmountString(entry.amount, entry.currencyCode), '${entry.count}'],
          ],
        ),
        ReportPdfTable(
          title: 'Sesiones de caja cerradas',
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
      ],
      note:
          'El movimiento de caja (arriba) refleja lo que físicamente entra/sale del cajón — nunca incluye '
          'transferencias ni pagos con tarjeta, que se liquidan fuera de la caja física.',
    );
    final opened = openReceiptPrintWindow(html);
    ScaffoldMessenger.maybeOf(context)?.showSnackBar(
      SnackBar(
        content: Text(
          opened
              ? 'Se abrió la vista de impresión/PDF.'
              : 'Este entorno no puede abrir la ventana de impresión.',
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => _ReportPanel<PosFinancialReport>(
    load: () => gateway.financialReport(filter: filter),
    builder: (context, report) => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _ReportSectionHeader(
          title: 'Financiero',
          action: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              _PdfExportButton(
                reportsKey: 'pos-reports-financial-export-pdf',
                onPressed: () => _exportPdf(context, report),
              ),
              const SizedBox(width: 8),
              _CsvExportButton(
                reportsKey: 'pos-reports-financial-export-csv',
                onPressed: () => unawaited(_export(context)),
              ),
            ],
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
          title: 'Movimientos por tipo (caja)',
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
        // TASK 16.25 (Phase 7) — deliberately a SEPARATE card from the
        // cash-drawer movements above: this is how the CUSTOMER paid
        // (cash/transfer/card), never conflated with what physically
        // sits in the drawer — see `PosPaymentMethodTotal`'s own doc
        // comment in `pos_reports_gateway.dart`.
        _ReportsCard(
          title: 'Cómo pagó el cliente (método de pago)',
          child: report.paymentMethodTotals.isEmpty
              ? const _ReportsEmptyNote(message: 'Sin pagos capturados en este rango.')
              : PosRankingBars(
                  key: const Key('pos-reports-payment-method-totals'),
                  entries: [
                    for (final entry in report.paymentMethodTotals)
                      PosRankingEntry(
                        label: _paymentMethodLabel(entry.paymentMethod),
                        value: double.tryParse(entry.amount) ?? 0,
                        valueLabel: _formatAmountString(entry.amount, entry.currencyCode),
                      ),
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

String _paymentMethodLabel(String method) => switch (method) {
  'cash' => 'Efectivo',
  'card_terminal' => 'Tarjeta (terminal)',
  'card_manual' => 'Tarjeta (manual)',
  'transfer' => 'Transferencia',
  'other' => 'Otro',
  _ => method,
};

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
        const SizedBox(height: 12),
        // TASK 16.25 (Phase 12) — real average over completed entry→exit
        // pairs only; `null` (never a fabricated 0 or the legacy's own
        // hardcoded 95) renders an honest "sin datos suficientes" note.
        _ReportsStatTile(
          label: 'Estancia promedio',
          value: report.averageStayMinutes == null ? 'Sin datos suficientes' : '${report.averageStayMinutes} min',
        ),
        const SizedBox(height: 8),
        Text(
          'La ocupación actual es una foto en tiempo real (no filtrada por fecha). La estancia promedio solo '
          'considera entradas con una salida registrada en este rango.',
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

/// TASK 16.25 (Phase 17) — opens the browser's real print dialog over a
/// real report document (see `pos_report_pdf.dart`); never a fake
/// "Descargar PDF" that silently does nothing (the legacy's own
/// documented naming defect this button deliberately avoids repeating).
class _PdfExportButton extends StatelessWidget {
  const _PdfExportButton({required this.reportsKey, required this.onPressed});
  final String reportsKey;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return OutlinedButton.icon(
      key: Key(reportsKey),
      onPressed: onPressed,
      icon: const Icon(Icons.picture_as_pdf_outlined, size: 16),
      label: const Text('Imprimir / PDF'),
      style: OutlinedButton.styleFrom(foregroundColor: palette.blueDeep, side: BorderSide(color: palette.border)),
    );
  }
}

class _ReportsCard extends StatelessWidget {
  const _ReportsCard({required this.child, this.title, super.key});
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
