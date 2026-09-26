/// TASK 14.4 (Wave 2, Part D): widget tests for the Report Center
/// (`pos_reports_screen.dart`/`pos_reports_gateway.dart`) — real widget
/// tests with a recording fake gateway, mirroring
/// `pos_shell_wave1_partbc_test.dart`'s own `_Recording*Gateway`/`_context`
/// fixture pattern exactly. `PosReportsScreen` is pumped directly (not
/// through the full `PosShell`), matching how this screen is actually
/// reached in the real app: `pos_shell.dart`'s module switch hands it a
/// real `AuthenticatedContext` and a real `PosReportsGateway`, nothing
/// more.
library;

import 'package:as_one/app/app.dart' show PlatformScope;
import 'package:as_one/features/authentication/auth_models.dart';
import 'package:as_one/features/pos/pos_read_gateway.dart';
import 'package:as_one/features/pos/pos_reports_gateway.dart';
import 'package:as_one/features/pos/pos_reports_screen.dart';
import 'package:as_one/features/pos/pos_tokens.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('Report areas load and display real fixture numbers', () {
    testWidgets('Ventas: transaction/refund counts and money totals render verbatim', (tester) async {
      final gateway = _RecordingReportsGateway();
      await _pump(tester, gateway: gateway);
      // TASK 16.25 — Inteligencia (now the default tab) already fired its
      // own `salesReport` calls (today + yesterday) on this same pump;
      // clear that noise so this test's own assertions only see the
      // Ventas tab's own real call.
      gateway.salesCalls.clear();
      await _tapArea(tester, 'sales');

      expect(gateway.salesCalls, hasLength(1));
      expect(gateway.salesCalls.single.branchId, 'branch-id');

      expect(find.text('42'), findsOneWidget); // transactionCount
      expect(find.text('3'), findsOneWidget); // refundCount
      // grossSales and netSales share this fixture amount — real, not a
      // fabricated duplicate.
      expect(find.text('1050.00 MXN'), findsNWidgets(2));
      expect(find.text('75.00 MXN'), findsOneWidget); // refundsTotal
      expect(find.text('25.00 MXN'), findsOneWidget); // averageTicket
    });

    testWidgets('Financiero: movement/session tables and CSV button render', (tester) async {
      final gateway = _RecordingReportsGateway();
      await _pump(tester, gateway: gateway);
      await _tapArea(tester, 'financial');

      expect(gateway.financialCalls, hasLength(1));
      expect(find.text('2'), findsOneWidget); // sessionsOpenedCount
      expect(find.text('sale'), findsOneWidget); // movementType
      expect(find.text('5'), findsOneWidget); // closedSessions.sessionCount
      expect(find.text('500.00 MXN'), findsNWidgets(2)); // declared + expected closing total
      expect(find.byKey(const Key('pos-reports-financial-export-csv')), findsOneWidget);
    });

    testWidgets('Inventario: stock counts and movement volume render', (tester) async {
      final gateway = _RecordingReportsGateway();
      await _pump(tester, gateway: gateway);
      // See the Ventas test above for why this clears Inteligencia's own
      // initial-load noise first.
      gateway.inventoryCalls.clear();
      await _tapArea(tester, 'inventory');

      expect(gateway.inventoryCalls, hasLength(1));
      expect(find.text('12'), findsOneWidget); // trackedVariantCount
      expect(find.text('2'), findsOneWidget); // outOfStockVariantCount
      expect(find.text('340.000000'), findsOneWidget); // quantityOnHandTotal
      expect(find.text('restock'), findsOneWidget); // movementType
    });

    testWidgets('Clientes: company-scoped totals render with no branch_id sent', (tester) async {
      final gateway = _RecordingReportsGateway();
      await _pump(tester, gateway: gateway);
      // See the Ventas test above for why this clears Inteligencia's own
      // initial-load noise first.
      gateway.customersCalls.clear();
      await _tapArea(tester, 'customers');

      expect(gateway.customersCalls, hasLength(1));
      expect(find.text('180'), findsOneWidget); // totalCustomers
      expect(find.text('9'), findsOneWidget); // newCustomersInRange
      expect(find.text('160'), findsOneWidget); // customersByStatus count
      expect(find.text('40'), findsOneWidget); // membershipsByStatus count
      // Both tables genuinely have their own real "active" row — not a
      // fabricated duplicate.
      expect(find.text('active'), findsNWidgets(2));
    });

    testWidgets('Empleados: attendance and payroll totals render', (tester) async {
      final gateway = _RecordingReportsGateway();
      await _pump(tester, gateway: gateway);
      await _tapArea(tester, 'employees');

      expect(gateway.employeesCalls, hasLength(1));
      expect(find.text('14'), findsOneWidget); // clockInCount
      expect(find.text('2000.00 MXN'), findsOneWidget); // closedPayrollTotals
    });

    testWidgets('Fiestas: reservation revenue and status table render', (tester) async {
      final gateway = _RecordingReportsGateway();
      await _pump(tester, gateway: gateway);
      await _tapArea(tester, 'parties');

      expect(gateway.partiesCalls, hasLength(1));
      expect(find.text('600.00 MXN'), findsOneWidget); // bookedRevenue
      expect(find.text('confirmed'), findsOneWidget); // reservationsByStatus label
    });

    testWidgets('Accesos: entry/exit counts and live occupancy render', (tester) async {
      final gateway = _RecordingReportsGateway();
      await _pump(tester, gateway: gateway);
      // See the Ventas test above for why this clears Inteligencia's own
      // initial-load noise first.
      gateway.accessCalls.clear();
      await _tapArea(tester, 'access');

      expect(gateway.accessCalls, hasLength(1));
      expect(find.text('30'), findsOneWidget); // entryCount
      expect(find.text('7'), findsOneWidget); // currentOccupancy
    });

    // TASK 14.5 (Wave 3, Phase 7, Item 4).
    testWidgets('Promociones: coupon/promotion totals and top-coupons table render, never blended with manual discounts', (
      tester,
    ) async {
      final gateway = _RecordingReportsGateway();
      await _pump(tester, gateway: gateway);
      await _tapArea(tester, 'promotions');

      expect(gateway.promotionsCalls, hasLength(1));
      // couponRedemptionCount stat tile AND the top-coupons table's own
      // redemption-count column share this fixture value — real, not a
      // fabricated duplicate.
      expect(find.text('2'), findsNWidgets(2));
      expect(find.text('1'), findsNWidgets(2)); // promotionDiscountCount + couponDiscountCount
      expect(find.text('17.40 MXN'), findsOneWidget); // couponRedemptionsTotal
      expect(find.text('RPT10'), findsOneWidget); // topCoupons code
    });
  });

  group('Inteligencia — management overview (TASK 16.25)', () {
    testWidgets('is the default tab and shows real today KPIs — tickets, ventas, ticket promedio, aforo, membresías', (
      tester,
    ) async {
      final gateway = _RecordingReportsGateway();
      await _pump(tester, gateway: gateway);

      // Reached without any tap — Inteligencia is the default/first area.
      expect(find.text('${_fixtureSalesReport.transactionCount}'), findsWidgets); // tickets hoy
      expect(find.text('1050.00 MXN'), findsWidgets); // ventas hoy / ticket promedio share this fixture amount
      expect(find.text('${_fixtureAccessReport.currentOccupancy}'), findsWidgets); // aforo actual
      expect(find.text('40'), findsWidgets); // membresías activas (membershipsByStatus 'active' count)

      // Both today AND yesterday were fetched — never just one.
      expect(gateway.salesCalls, hasLength(2));
      expect(gateway.accessCalls, hasLength(1));
      expect(gateway.customersCalls, hasLength(1));
      expect(gateway.inventoryCalls, hasLength(1));
    });

    testWidgets('Meta del día shows an honest "No configurada" state — no daily-goal setting exists to show a real number', (
      tester,
    ) async {
      final gateway = _RecordingReportsGateway();
      await _pump(tester, gateway: gateway);

      expect(find.byKey(const Key('pos-reports-intelligence-daily-goal')), findsOneWidget);
      expect(find.text('No configurada'), findsOneWidget);
    });

    testWidgets('shows a real "vs. ayer" percentage when yesterday had real sales', (tester) async {
      final gateway = _RecordingReportsGateway(
        yesterdaySalesReport: const PosSalesReport(
          dateFrom: '2026-01-06',
          dateTo: '2026-01-06',
          branchId: 'branch-id',
          transactionCount: 20,
          grossSales: [PosReportCurrencyAmount(currencyCode: 'MXN', amount: '500.0000')],
          refundCount: 0,
          refundsTotal: [],
          netSales: [PosReportCurrencyAmount(currencyCode: 'MXN', amount: '500.0000')],
          averageTicket: [PosReportCurrencyAmount(currencyCode: 'MXN', amount: '25.0000')],
          salesByHour: [],
          topProducts: [],
        ),
      );
      await _pump(tester, gateway: gateway);

      // today 1050 vs yesterday 500 → +110.0%.
      expect(find.textContaining('110.0%'), findsOneWidget);
    });

    testWidgets('shows an honest "sin datos" trend when yesterday has no comparable sales — never a fabricated 0%', (tester) async {
      final gateway = _RecordingReportsGateway(yesterdaySalesReport: _emptySalesReport);
      await _pump(tester, gateway: gateway);

      expect(find.text('Sin datos de ayer'), findsOneWidget);
    });

    testWidgets('zero data across the board still renders the full structure — never a generic empty-state card', (tester) async {
      final gateway = _RecordingReportsGateway(
        salesReport: _emptySalesReport,
        yesterdaySalesReport: _emptySalesReport,
        accessReportResult: _emptyAccessReport,
        customersReportResult: _emptyCustomersReport,
        inventoryReportResult: _emptyInventoryReport,
      );
      await _pump(tester, gateway: gateway);

      // The section itself, the chart, and the ranking all still render
      // — with honest empty-state content, never replaced entirely.
      expect(find.text('Inteligencia — hoy'), findsOneWidget);
      expect(find.text('Sin datos para graficar.'), findsOneWidget); // hourly chart
      expect(find.text('Sin datos para este rango.'), findsOneWidget); // top products ranking
      expect(find.text('Sin alertas activas.'), findsOneWidget); // no real alert condition
      expect(find.text('No configurada'), findsOneWidget); // Meta del día still shows
    });

    testWidgets('a real out-of-stock condition surfaces as a real, actionable alert — never an invented "AI alert"', (tester) async {
      final gateway = _RecordingReportsGateway(
        inventoryReportResult: const PosInventoryReport(
          dateFrom: '2026-01-01',
          dateTo: '2026-01-07',
          branchId: 'branch-id',
          trackedVariantCount: 12,
          quantityOnHandTotal: '340.000000',
          quantityReservedTotal: '5.000000',
          quantityInTransitTotal: '0.000000',
          outOfStockVariantCount: 5,
          inventoryValue: [],
          movementVolume: [],
        ),
      );
      await _pump(tester, gateway: gateway);

      expect(find.textContaining('5 variante(s) agotada(s)'), findsOneWidget);
      expect(find.text('Sin alertas activas.'), findsNothing);
    });

    testWidgets('renders real hourly sales and top-products data from the fixture', (tester) async {
      final gateway = _RecordingReportsGateway();
      await _pump(tester, gateway: gateway);

      expect(find.byKey(const Key('pos-reports-intelligence-hourly-chart')), findsOneWidget);
      expect(find.text('9h'), findsOneWidget);
      expect(find.text('14h'), findsOneWidget);
      expect(find.byKey(const Key('pos-reports-intelligence-top-products')), findsOneWidget);
      expect(find.text('Boleto General'), findsOneWidget);
      expect(find.text('Refresco'), findsOneWidget);
    });
  });

  // TASK 16.25.2 — production visual review found Inteligencia had drifted
  // into a generic 3-column KPI-card dashboard, losing the original
  // "management command center" hierarchy (hero → compact KPI row → dense
  // two-column operations grid). These tests prove that hierarchy is back,
  // and that every panel in it survives real zero data structurally intact.
  group('Inteligencia — hero & operations grid (TASK 16.25.2)', () {
    testWidgets('Meta del día hero renders even though no target is configured', (tester) async {
      final gateway = _RecordingReportsGateway();
      await _pump(tester, gateway: gateway);

      expect(find.byKey(const Key('pos-reports-intelligence-hero')), findsOneWidget);
      expect(find.byKey(const Key('pos-reports-intelligence-daily-goal')), findsOneWidget);
      expect(find.text('No configurada'), findsOneWidget);
    });

    testWidgets('the hero suppresses a completion percentage — no fake target amount ever appears', (tester) async {
      // Deliberately forces the "no comparison data" path (empty
      // yesterday) so the ONLY possible '%' text would be a fabricated
      // completion ratio against the unconfigured daily goal — proving
      // none exists. (The default fixture's own real "vs. ayer" trend can
      // legitimately contain a '%', which is a different, honest number —
      // see the dedicated trend tests above.)
      final gateway = _RecordingReportsGateway(yesterdaySalesReport: _emptySalesReport);
      await _pump(tester, gateway: gateway);

      expect(find.byKey(const Key('pos-reports-intelligence-hero-progress')), findsOneWidget);
      // A neutral dash — never a percentage computed against an invented
      // denominator (there is no real daily-goal setting to compare against).
      expect(find.text('—'), findsOneWidget);
      expect(find.text('Sin meta configurada'), findsOneWidget);
      expect(find.text('Sin datos de ayer'), findsOneWidget);
      expect(find.textContaining('%'), findsNothing);
    });

    testWidgets('tickets hoy and ticket promedio remain available inside the hero', (tester) async {
      final gateway = _RecordingReportsGateway();
      await _pump(tester, gateway: gateway);

      final hero = find.byKey(const Key('pos-reports-intelligence-hero'));
      expect(find.descendant(of: hero, matching: find.text('TICKETS HOY')), findsOneWidget);
      expect(find.descendant(of: hero, matching: find.text('TICKET PROMEDIO')), findsOneWidget);
      expect(find.descendant(of: hero, matching: find.text('${_fixtureSalesReport.transactionCount}')), findsOneWidget);
    });

    testWidgets('the four compact operational KPIs render with zero data, each with its own honest state', (tester) async {
      final gateway = _RecordingReportsGateway(
        salesReport: _emptySalesReport,
        yesterdaySalesReport: _emptySalesReport,
        accessReportResult: _emptyAccessReport,
        customersReportResult: _emptyCustomersReport,
        inventoryReportResult: _emptyInventoryReport,
      );
      await _pump(tester, gateway: gateway);

      expect(find.text('Aforo actual'), findsOneWidget);
      expect(find.text('Ventas / hora'), findsOneWidget);
      expect(find.text('Estancia promedio'), findsOneWidget);
      expect(find.text('Membresías activas'), findsOneWidget);
      expect(find.text('Sin datos'), findsOneWidget); // Ventas / hora — no hourly buckets today
      expect(find.text('Sin datos suficientes'), findsOneWidget); // Estancia promedio — no completed stay pairs
    });

    testWidgets('Ocupación en tiempo real keeps its panel structure with zero occupancy — never a giant empty card', (tester) async {
      final gateway = _RecordingReportsGateway(accessReportResult: _emptyAccessReport);
      await _pump(tester, gateway: gateway);

      expect(find.byKey(const Key('pos-reports-intelligence-occupancy')), findsOneWidget);
      expect(find.text('Ocupación en tiempo real'), findsOneWidget);
      expect(find.text('Entradas hoy'), findsOneWidget);
      expect(find.text('Salidas hoy'), findsOneWidget);
      expect(find.text('Sin movimientos de acceso registrados en el rango.'), findsOneWidget);
    });

    testWidgets('Top productos del día keeps its panel structure with zero sales', (tester) async {
      final gateway = _RecordingReportsGateway(salesReport: _emptySalesReport, yesterdaySalesReport: _emptySalesReport);
      await _pump(tester, gateway: gateway);

      expect(find.byKey(const Key('pos-reports-intelligence-top-products')), findsOneWidget);
      expect(find.text('Top productos del día'), findsOneWidget);
      expect(find.text('Sin datos para este rango.'), findsOneWidget);
    });

    testWidgets('Ventas por hora (hoy) keeps its panel structure with zero sales', (tester) async {
      final gateway = _RecordingReportsGateway(salesReport: _emptySalesReport, yesterdaySalesReport: _emptySalesReport);
      await _pump(tester, gateway: gateway);

      expect(find.byKey(const Key('pos-reports-intelligence-hourly-chart')), findsOneWidget);
      expect(find.text('Ventas por hora (hoy)'), findsOneWidget);
      expect(find.text('Sin datos para graficar.'), findsOneWidget);
    });

    testWidgets('Alertas del sistema keeps its panel structure with zero alerts', (tester) async {
      final gateway = _RecordingReportsGateway(inventoryReportResult: _emptyInventoryReport);
      await _pump(tester, gateway: gateway);

      expect(find.byKey(const Key('pos-reports-intelligence-alerts')), findsOneWidget);
      expect(find.text('Alertas del sistema'), findsOneWidget);
      expect(find.text('Sin alertas activas.'), findsOneWidget);
    });

    testWidgets('at desktop width the operations grid uses a real two-column Row, not a stacked Column', (tester) async {
      tester.view.physicalSize = const Size(1440, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      final gateway = _RecordingReportsGateway();
      await _pump(tester, gateway: gateway);

      final row1 = find.byKey(const Key('pos-reports-intelligence-ops-row-1'));
      final row2 = find.byKey(const Key('pos-reports-intelligence-ops-row-2'));
      expect(tester.widget(row1).runtimeType, Row);
      expect(tester.widget(row2).runtimeType, Row);
      // Both panels of each row are genuinely on screen side by side —
      // not scrolled away by an accidental full-height stack.
      expect(find.byKey(const Key('pos-reports-intelligence-occupancy')), findsOneWidget);
      expect(find.byKey(const Key('pos-reports-intelligence-top-products')), findsOneWidget);
    });

    testWidgets('at narrow widths the operations grid stacks into a Column — no horizontal overflow', (tester) async {
      final gateway = _RecordingReportsGateway();
      await _pump(tester, gateway: gateway); // default 800×600 test surface → narrow content width.

      final row1 = find.byKey(const Key('pos-reports-intelligence-ops-row-1'));
      expect(tester.widget(row1).runtimeType, Column);
      expect(tester.takeException(), isNull);
    });
  });

  group('Date-range presets', () {
    testWidgets('selecting "Hoy" applies a single-day range and re-fetches', (tester) async {
      final gateway = _RecordingReportsGateway();
      await _pump(tester, gateway: gateway);
      gateway.salesCalls.clear();
      await _tapArea(tester, 'sales');
      expect(gateway.salesCalls, hasLength(1));

      final presetMenuFinder = find.byKey(const Key('pos-reports-preset-menu'));
      await tester.ensureVisible(presetMenuFinder);
      await tester.pumpAndSettle();
      await tester.tap(presetMenuFinder);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-reports-preset-today')));
      await tester.pumpAndSettle();

      expect(gateway.salesCalls, hasLength(2));
      expect(gateway.salesCalls.last.dateFrom, gateway.salesCalls.last.dateTo);
    });
  });

  group('PDF export', () {
    testWidgets('Imprimir / PDF on Ventas opens (or honestly reports it could not open) a print window', (tester) async {
      final gateway = _RecordingReportsGateway();
      await _pump(tester, gateway: gateway);
      await _tapArea(tester, 'sales');

      await tester.tap(find.byKey(const Key('pos-reports-sales-export-pdf')));
      await tester.pumpAndSettle();

      // The Dart VM test host has no browser `window.open` — the honest
      // result is "could not open a print window," never a fabricated
      // success (mirrors the CSV export's own VM-host honesty above).
      expect(find.text('Este entorno no puede abrir la ventana de impresión.'), findsOneWidget);
    });
  });

  group('Date-range change re-fetches', () {
    testWidgets('changing the range via the picker issues a fresh sales call with the new dates', (tester) async {
      final gateway = _RecordingReportsGateway();
      await _pump(tester, gateway: gateway);
      // See the Ventas test in the group above for why this clears
      // Inteligencia's own initial-load noise first.
      gateway.salesCalls.clear();
      await _tapArea(tester, 'sales');
      expect(gateway.salesCalls, hasLength(1));

      // TASK 16.25 — Ventas now has real chart/ranking content below the
      // header, so the range button can legitimately sit below the fold
      // on a real page; the page itself is genuinely scrollable, so
      // scrolling it into view mirrors what a real operator would do.
      final rangeButtonFinder = find.byKey(const Key('pos-reports-range-button'));
      await tester.ensureVisible(rangeButtonFinder);
      await tester.pumpAndSettle();
      await tester.tap(rangeButtonFinder);
      await tester.pumpAndSettle();

      // Switch the built-in `showDateRangePicker` to its keyboard-entry
      // mode (Material3 → `Icons.edit_outlined`) — far more reliable to
      // drive in a widget test than tapping specific calendar day cells.
      await tester.tap(find.byIcon(Icons.edit_outlined));
      await tester.pumpAndSettle();

      final fields = find.byType(TextField);
      expect(fields, findsNWidgets(2));
      await tester.enterText(fields.at(0), '01/05/2026');
      await tester.enterText(fields.at(1), '01/10/2026');
      await tester.pump();

      await tester.tap(find.text('Aplicar'));
      await tester.pumpAndSettle();

      expect(gateway.salesCalls, hasLength(2));
      expect(gateway.salesCalls.last.dateFrom, '2026-01-05');
      expect(gateway.salesCalls.last.dateTo, '2026-01-10');
      expect(find.text('2026-01-05 → 2026-01-10'), findsOneWidget);
    });
  });

  group('Empty dataset shows real zeros, never an error', () {
    testWidgets('a zero-result range renders honest zero counts and empty-state notes', (tester) async {
      final gateway = _RecordingReportsGateway(salesReport: _emptySalesReport);
      await _pump(tester, gateway: gateway);
      await _tapArea(tester, 'sales');

      expect(find.byKey(const Key('pos-reports-failure-retry')), findsNothing);
      expect(find.text('0'), findsWidgets); // transactionCount and refundCount both zero
      expect(find.text('Sin movimientos en este rango.'), findsWidgets);
    });
  });

  group('Permission gating', () {
    testWidgets('an actor without report.read sees the permission state, never report data', (tester) async {
      final gateway = _RecordingReportsGateway();
      await _pump(tester, gateway: gateway, permissions: const []);

      expect(find.byKey(const Key('pos-reports-permission-state')), findsOneWidget);
      expect(find.text('42'), findsNothing);
      expect(gateway.salesCalls, isEmpty);
    });
  });

  group('CSV export', () {
    testWidgets('Exportar CSV on Ventas calls exportSalesCsv with the active filter', (tester) async {
      final gateway = _RecordingReportsGateway();
      await _pump(tester, gateway: gateway);
      await _tapArea(tester, 'sales');

      await tester.tap(find.byKey(const Key('pos-reports-sales-export-csv')));
      await tester.pumpAndSettle();

      expect(gateway.exportSalesCalls, hasLength(1));
      expect(gateway.exportSalesCalls.single.branchId, 'branch-id');
      // The Dart VM test host has no browser `Blob`/anchor API — the
      // gateway call is still real, but the honest result is "could not
      // start a browser download here", never a fabricated success toast.
      expect(
        find.text('El CSV se generó, pero este entorno no puede iniciar la descarga del navegador.'),
        findsOneWidget,
      );
    });

    testWidgets('Exportar CSV on Financiero calls exportFinancialCsv with the active filter', (tester) async {
      final gateway = _RecordingReportsGateway();
      await _pump(tester, gateway: gateway);
      await _tapArea(tester, 'financial');

      await tester.tap(find.byKey(const Key('pos-reports-financial-export-csv')));
      await tester.pumpAndSettle();

      expect(gateway.exportFinancialCalls, hasLength(1));
      expect(gateway.exportFinancialCalls.single.branchId, 'branch-id');
    });

    // TASK 14.5 (Wave 3, Phase 7, Item 2).
    testWidgets('Exportar CSV on Inventario calls exportKardexCsv with the active filter', (tester) async {
      final gateway = _RecordingReportsGateway();
      await _pump(tester, gateway: gateway);
      await _tapArea(tester, 'inventory');

      await tester.tap(find.byKey(const Key('pos-reports-kardex-export-csv')));
      await tester.pumpAndSettle();

      expect(gateway.exportKardexCalls, hasLength(1));
      expect(gateway.exportKardexCalls.single.branchId, 'branch-id');
    });
  });
}

Future<void> _pump(
  WidgetTester tester, {
  required _RecordingReportsGateway gateway,
  List<String> permissions = const ['report.read'],
}) async {
  await tester.pumpWidget(
    // TASK 16.23B (F-05) — `PosReportsScreen` now resolves its default
    // date range's "business today" via `PlatformScope.of(context)
    // .posReadGateway`, which throws with no such ancestor — mirrors the
    // real app's own tree (`AsOneApp`'s `MaterialApp.builder` wraps every
    // route in `PlatformScope`, see `app.dart`).
    PlatformScope(
      posReadGateway: const EmptyPosReadGateway(),
      child: MaterialApp(
        theme: PosTheme.light(),
        home: Scaffold(
          // Mirrors `pos_shell.dart`'s own `_Content` wrapper exactly (every
          // non-POS module renders inside a `SingleChildScrollView`) — this
          // screen itself is a plain, non-scrolling `Column`.
          body: SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: PosReportsScreen(context: _context(permissions), reportsGateway: gateway),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

/// Scrolls the target area chip into view before tapping it — the chip row
/// is its own horizontally-scrolling strip (`_ReportsAreaTabs`), so a chip
/// past the initial viewport is not directly hit-testable without this,
/// exactly like any other off-screen item in a real horizontal list.
Future<void> _tapArea(WidgetTester tester, String area) async {
  final finder = find.byKey(Key('pos-reports-area-$area'));
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

AuthenticatedContext _context(List<String> permissions) => AuthenticatedContext(
  session: SessionContext(
    id: 'session-id',
    userId: 'user-id',
    companyId: 'company-id',
    branchId: 'branch-id',
    permittedBranchIds: const ['branch-id'],
    companyWideAccess: false,
    expiresAt: DateTime.utc(2099),
  ),
  user: const UserSummary(id: 'user-id', displayName: 'Usuario AS', email: 'user@example.test'),
  companies: const [CompanySummary(id: 'company-id', name: 'Empresa AS', current: true)],
  branches: const [
    BranchSummary(
      id: 'branch-id',
      code: 'CENTRO',
      name: 'Sucursal Centro',
      timezone: 'America/Mexico_City',
      current: true,
    ),
  ],
  companyWideAccess: false,
  permissions: permissions,
);

// --- Fixtures ---------------------------------------------------------

const _fixtureSalesReport = PosSalesReport(
  dateFrom: '2026-01-01',
  dateTo: '2026-01-07',
  branchId: 'branch-id',
  transactionCount: 42,
  grossSales: [PosReportCurrencyAmount(currencyCode: 'MXN', amount: '1050.0000')],
  refundCount: 3,
  refundsTotal: [PosReportCurrencyAmount(currencyCode: 'MXN', amount: '75.0000')],
  netSales: [PosReportCurrencyAmount(currencyCode: 'MXN', amount: '1050.0000')],
  averageTicket: [PosReportCurrencyAmount(currencyCode: 'MXN', amount: '25.0000')],
  salesByHour: [
    PosHourlySales(hour: 9, currencyCode: 'MXN', transactionCount: 10, grossSales: '250.0000'),
    PosHourlySales(hour: 14, currencyCode: 'MXN', transactionCount: 32, grossSales: '800.0000'),
  ],
  topProducts: [
    PosTopProduct(productId: 'product-1', name: 'Boleto General', quantitySold: '20.000000', currencyCode: 'MXN', revenue: '600.0000'),
    PosTopProduct(productId: 'product-2', name: 'Refresco', quantitySold: '15.000000', currencyCode: 'MXN', revenue: '150.0000'),
  ],
);

const _emptySalesReport = PosSalesReport(
  dateFrom: '2026-01-01',
  dateTo: '2026-01-07',
  branchId: 'branch-id',
  transactionCount: 0,
  grossSales: [],
  refundCount: 0,
  refundsTotal: [],
  netSales: [],
  averageTicket: [],
  salesByHour: [],
  topProducts: [],
);

const _fixtureFinancialReport = PosFinancialReport(
  dateFrom: '2026-01-01',
  dateTo: '2026-01-07',
  branchId: 'branch-id',
  movementTotals: [
    PosCashMovementTotal(movementType: 'sale', currencyCode: 'MXN', amount: '1050.0000', count: 42),
  ],
  netCashMovement: [PosReportCurrencyAmount(currencyCode: 'MXN', amount: '900.0000')],
  closedSessions: [
    PosClosedSessionTotal(
      currencyCode: 'MXN',
      sessionCount: 5,
      declaredClosingTotal: '500.0000',
      expectedClosingTotal: '500.0000',
      discrepancyTotal: '0.0000',
    ),
  ],
  sessionsOpenedCount: 2,
  paymentMethodTotals: [
    PosPaymentMethodTotal(paymentMethod: 'cash', currencyCode: 'MXN', amount: '600.0000', count: 25),
    PosPaymentMethodTotal(paymentMethod: 'transfer', currencyCode: 'MXN', amount: '300.0000', count: 12),
    PosPaymentMethodTotal(paymentMethod: 'card_terminal', currencyCode: 'MXN', amount: '150.0000', count: 5),
  ],
);

const _fixtureInventoryReport = PosInventoryReport(
  dateFrom: '2026-01-01',
  dateTo: '2026-01-07',
  branchId: 'branch-id',
  trackedVariantCount: 12,
  quantityOnHandTotal: '340.000000',
  quantityReservedTotal: '5.000000',
  quantityInTransitTotal: '0.000000',
  outOfStockVariantCount: 2,
  inventoryValue: [PosReportCurrencyAmount(currencyCode: 'MXN', amount: '8400.0000')],
  movementVolume: [
    PosInventoryMovementVolume(movementType: 'restock', movementCount: 4, totalBaseQuantity: '120.000000'),
  ],
);

const _fixtureCustomersReport = PosCustomersReport(
  dateFrom: '2026-01-01',
  dateTo: '2026-01-07',
  totalCustomers: 180,
  customersByStatus: [PosReportStatusCount(status: 'active', count: 160)],
  newCustomersInRange: 9,
  membershipsByStatus: [PosReportStatusCount(status: 'active', count: 40)],
  newMembershipsInRange: 3,
  activeLoyaltyAccountCount: 55,
);

const _fixtureEmployeesReport = PosEmployeesReport(
  dateFrom: '2026-01-01',
  dateTo: '2026-01-07',
  branchId: 'branch-id',
  employeesByStatus: [PosReportStatusCount(status: 'active', count: 8)],
  clockInCount: 14,
  clockOutCount: 13,
  distinctEmployeesPunched: 6,
  closedPayrollTotals: [PosReportCurrencyAmount(currencyCode: 'MXN', amount: '2000.0000')],
  closedPayrollPeriodCount: 1,
);

const _fixturePartiesReport = PosPartiesReport(
  dateFrom: '2026-01-01',
  dateTo: '2026-01-07',
  branchId: 'branch-id',
  reservationsByStatus: [PosReportStatusCount(status: 'confirmed', count: 5)],
  bookedRevenue: [PosReportCurrencyAmount(currencyCode: 'MXN', amount: '600.0000')],
  collectedRevenue: [PosReportCurrencyAmount(currencyCode: 'MXN', amount: '450.0000')],
  activeRoomCount: 3,
  roomsBookedCount: 5,
);

const _fixtureAccessReport = PosAccessReport(
  dateFrom: '2026-01-01',
  dateTo: '2026-01-07',
  branchId: 'branch-id',
  entryCount: 30,
  exitCount: 23,
  currentOccupancy: 7,
  // Deliberately NOT 95 — the legacy's own hardcoded `prom_estancia`
  // fake value — so this fixture never looks like it's reproducing it.
  averageStayMinutes: 63,
);

// TASK 16.25 — zero-data fixtures for Inteligencia's own empty-state
// tests (structure must survive real zero data — never collapse into a
// generic empty-state card).
const _emptyAccessReport = PosAccessReport(
  dateFrom: '2026-01-01',
  dateTo: '2026-01-07',
  branchId: 'branch-id',
  entryCount: 0,
  exitCount: 0,
  currentOccupancy: 0,
  averageStayMinutes: null,
);

const _emptyCustomersReport = PosCustomersReport(
  dateFrom: '2026-01-01',
  dateTo: '2026-01-07',
  totalCustomers: 0,
  customersByStatus: [],
  newCustomersInRange: 0,
  membershipsByStatus: [],
  newMembershipsInRange: 0,
  activeLoyaltyAccountCount: 0,
);

const _emptyInventoryReport = PosInventoryReport(
  dateFrom: '2026-01-01',
  dateTo: '2026-01-07',
  branchId: 'branch-id',
  trackedVariantCount: 0,
  quantityOnHandTotal: '0.000000',
  quantityReservedTotal: '0.000000',
  quantityInTransitTotal: '0.000000',
  outOfStockVariantCount: 0,
  inventoryValue: [],
  movementVolume: [],
);

// TASK 14.5 (Wave 3, Phase 7, Item 4).
const _fixturePromotionsReport = PosPromotionsReport(
  dateFrom: '2026-01-01',
  dateTo: '2026-01-07',
  branchId: 'branch-id',
  couponRedemptionCount: 2,
  couponRedemptionsTotal: [PosReportCurrencyAmount(currencyCode: 'MXN', amount: '17.4000')],
  promotionDiscountCount: 1,
  promotionDiscountTotal: [PosReportCurrencyAmount(currencyCode: 'MXN', amount: '5.0000')],
  couponDiscountCount: 1,
  couponDiscountTotal: [PosReportCurrencyAmount(currencyCode: 'MXN', amount: '11.6000')],
  topCoupons: [PosTopCoupon(couponId: 'coupon-id', code: 'RPT10', redemptionCount: 2)],
);

// --- Recording fake gateway ---------------------------------------------

class _RecordingReportsGateway implements PosReportsGateway {
  _RecordingReportsGateway({
    PosSalesReport salesReport = _fixtureSalesReport,
    this.yesterdaySalesReport,
    this.accessReportResult = _fixtureAccessReport,
    this.customersReportResult = _fixtureCustomersReport,
    this.inventoryReportResult = _fixtureInventoryReport,
  }) : _salesReport = salesReport;

  final PosSalesReport _salesReport;
  // TASK 16.25 — Inteligencia calls `salesReport` TWICE (today, then
  // yesterday, in that exact order — see `_IntelligenceReportPanelState
  // ._load`'s own `Future.wait` list order). `null` (the default) means
  // "yesterday looks the same as today," preserving every EXISTING
  // test's behavior unchanged.
  final PosSalesReport? yesterdaySalesReport;
  final PosAccessReport accessReportResult;
  final PosCustomersReport customersReportResult;
  final PosInventoryReport inventoryReportResult;

  final List<PosReportFilter> salesCalls = [];
  final List<PosReportFilter> exportSalesCalls = [];
  final List<PosReportFilter> financialCalls = [];
  final List<PosReportFilter> exportFinancialCalls = [];
  final List<PosReportFilter> inventoryCalls = [];
  final List<PosReportDateRange> customersCalls = [];
  final List<PosReportFilter> employeesCalls = [];
  final List<PosReportFilter> partiesCalls = [];
  final List<PosReportFilter> accessCalls = [];
  final List<PosReportFilter> exportKardexCalls = [];
  final List<PosReportFilter> promotionsCalls = [];

  @override
  Future<PosSalesReport> salesReport({required PosReportFilter filter}) async {
    final isYesterdayCall = yesterdaySalesReport != null && salesCalls.length == 1;
    salesCalls.add(filter);
    return isYesterdayCall ? yesterdaySalesReport! : _salesReport;
  }

  @override
  Future<String> exportSalesCsv({required PosReportFilter filter}) async {
    exportSalesCalls.add(filter);
    return 'id,sale_number\nsale-1,SALE-0001\n';
  }

  @override
  Future<PosFinancialReport> financialReport({required PosReportFilter filter}) async {
    financialCalls.add(filter);
    return _fixtureFinancialReport;
  }

  @override
  Future<String> exportFinancialCsv({required PosReportFilter filter}) async {
    exportFinancialCalls.add(filter);
    return 'id,movement_type\nmv-1,sale\n';
  }

  @override
  Future<PosInventoryReport> inventoryReport({required PosReportFilter filter}) async {
    inventoryCalls.add(filter);
    return inventoryReportResult;
  }

  @override
  Future<PosCustomersReport> customersReport({required PosReportDateRange range}) async {
    customersCalls.add(range);
    return customersReportResult;
  }

  @override
  Future<PosEmployeesReport> employeesReport({required PosReportFilter filter}) async {
    employeesCalls.add(filter);
    return _fixtureEmployeesReport;
  }

  @override
  Future<PosPartiesReport> partiesReport({required PosReportFilter filter}) async {
    partiesCalls.add(filter);
    return _fixturePartiesReport;
  }

  @override
  Future<PosAccessReport> accessReport({required PosReportFilter filter}) async {
    accessCalls.add(filter);
    return accessReportResult;
  }

  @override
  Future<String> exportKardexCsv({required PosReportFilter filter, String? productVariantId}) async {
    exportKardexCalls.add(filter);
    return 'movement_id,sku\nmv-1,RPT-TRACKED\n';
  }

  @override
  Future<PosPromotionsReport> promotionsReport({required PosReportFilter filter}) async {
    promotionsCalls.add(filter);
    return _fixturePromotionsReport;
  }
}
