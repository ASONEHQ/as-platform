// TASK 17.5 §6.1 — focused coverage for `PosBarChart`'s sparse-data
// handling: a single real datapoint must render as an honest, bounded
// single bar, never a "solid rectangle" stretched across the entire
// chart width via an unconstrained `Expanded`.
library;

import 'package:as_one/features/pos/pos_report_charts.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  Future<void> pump(WidgetTester tester, Widget child, {double width = 600}) async {
    await tester.pumpWidget(
      MaterialApp(home: Scaffold(body: Center(child: SizedBox(width: width, child: child)))),
    );
  }

  testWidgets('zero datapoints shows an honest empty state, never a fabricated bar', (tester) async {
    await pump(tester, const PosBarChart(bars: []));
    expect(find.text('Sin datos para graficar.'), findsOneWidget);
    expect(find.byType(Container), findsNothing);
  });

  testWidgets('a single real datapoint renders one bounded bar, not a full-width rectangle', (tester) async {
    await pump(
      tester,
      const PosBarChart(bars: [PosChartBar(label: '9h', value: 3, valueLabel: r'$30.00')]),
      width: 600,
    );

    expect(find.text('9h'), findsOneWidget);
    expect(find.text(r'$30.00'), findsOneWidget);
    // The bar's own column stays at the fixed narrow width used for
    // sparse series (56px) rather than stretching across the full
    // 600px chart width an `Expanded` single child would otherwise
    // claim.
    final sizedBoxes = tester.widgetList<SizedBox>(find.byType(SizedBox));
    expect(sizedBoxes.any((box) => box.width == 56), isTrue);
    expect(find.byType(Expanded), findsNothing);
  });

  testWidgets('two real datapoints still use the bounded/centered layout', (tester) async {
    await pump(
      tester,
      const PosBarChart(
        bars: [
          PosChartBar(label: '9h', value: 1, valueLabel: r'$10.00'),
          PosChartBar(label: '14h', value: 3, valueLabel: r'$30.00'),
        ],
      ),
    );

    expect(find.text('9h'), findsOneWidget);
    expect(find.text('14h'), findsOneWidget);
    expect(find.byType(Expanded), findsNothing);
  });

  testWidgets('a normal multi-hour series (more than 6 bars) fills the width as before', (tester) async {
    await pump(
      tester,
      PosBarChart(
        bars: [
          for (var hour = 0; hour < 10; hour++)
            PosChartBar(label: '${hour}h', value: (hour + 1).toDouble(), valueLabel: r'$' '$hour.00'),
        ],
      ),
    );

    expect(find.byType(Expanded), findsNWidgets(10));
  });
}
