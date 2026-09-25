/// TASK 16.25 (Phase 13) — reusable Reports/Inteligencia chart
/// components. No new chart-library dependency (`pubspec.yaml` carries
/// none today, and this task's own instruction is "do not add a heavy
/// new chart dependency unless necessary") — every widget here is plain
/// Flutter composition (`Row`/`Column`/`LinearProgressIndicator`), never
/// a hand-rolled `CustomPainter`, so it stays easy to test and to keep
/// visually consistent with the rest of `pos_tokens.dart`'s palette.
///
/// Every widget honestly handles zero/empty data (a real "sin datos"
/// state, never a fabricated placeholder bar) — see each widget's own
/// empty-state branch.
library;

import 'package:flutter/material.dart';

import 'pos_tokens.dart';

/// One bar in a [PosBarChart] — [value] must be `>= 0`; the caller
/// supplies [valueLabel] pre-formatted (e.g. via `Money`) so this widget
/// never reformats currency itself.
class PosChartBar {
  const PosChartBar({required this.label, required this.value, required this.valueLabel});
  final String label;
  final double value;
  final String valueLabel;
}

/// A simple vertical bar chart — e.g. "ventas por hora". Bars scale to
/// the tallest real value in [bars]; a genuinely empty/all-zero series
/// renders an honest "Sin datos para graficar." line instead of a
/// misleading flat row of bars.
class PosBarChart extends StatelessWidget {
  const PosBarChart({required this.bars, this.height = 150, this.barColor, super.key});
  final List<PosChartBar> bars;
  final double height;
  final Color? barColor;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final maxValue = bars.isEmpty ? 0.0 : bars.map((bar) => bar.value).reduce((a, b) => a > b ? a : b);
    if (bars.isEmpty || maxValue <= 0) {
      return SizedBox(
        height: height,
        child: Center(
          child: Text('Sin datos para graficar.', style: TextStyle(color: palette.textMuted, fontSize: 12)),
        ),
      );
    }
    const labelsHeight = 34.0;
    final barAreaHeight = height - labelsHeight;
    return SizedBox(
      height: height,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          for (final bar in bars)
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 2),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    Text(
                      bar.valueLabel,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 9, color: palette.textSecondary, fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 2),
                    Container(
                      height: (barAreaHeight - 14).clamp(2.0, double.infinity) * (bar.value / maxValue),
                      decoration: BoxDecoration(
                        color: barColor ?? palette.action,
                        borderRadius: const BorderRadius.vertical(top: Radius.circular(3)),
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      bar.label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 9, color: palette.textMuted),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// One row in a [PosRankingBars] list.
class PosRankingEntry {
  const PosRankingEntry({required this.label, required this.value, required this.valueLabel});
  final String label;
  final double value;
  final String valueLabel;
}

/// Horizontal ranking bars — e.g. "top productos" or a payment-method
/// breakdown. [entries] are rendered in the order given (the caller
/// sorts — this widget never re-sorts real backend-returned data).
class PosRankingBars extends StatelessWidget {
  const PosRankingBars({required this.entries, this.barColor, super.key});
  final List<PosRankingEntry> entries;
  final Color? barColor;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    if (entries.isEmpty) {
      return Text('Sin datos para este rango.', style: TextStyle(color: palette.textMuted, fontSize: 12));
    }
    final maxValue = entries.map((entry) => entry.value).reduce((a, b) => a > b ? a : b);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final entry in entries)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        entry.label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: palette.text, fontSize: 12.5, fontWeight: FontWeight.w600),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      entry.valueLabel,
                      style: TextStyle(color: palette.textSecondary, fontSize: 12.5, fontWeight: FontWeight.w700),
                    ),
                  ],
                ),
                const SizedBox(height: 3),
                ClipRRect(
                  borderRadius: BorderRadius.circular(3),
                  child: LinearProgressIndicator(
                    value: maxValue <= 0 ? 0 : (entry.value / maxValue).clamp(0.0, 1.0),
                    minHeight: 8,
                    backgroundColor: palette.border,
                    valueColor: AlwaysStoppedAnimation<Color>(barColor ?? palette.action),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

/// A compact "vs. yesterday"-style comparison indicator. `null` means
/// honestly "no comparison data" (e.g. yesterday's total was zero) —
/// never a fabricated 0% or an arrow with no real direction behind it.
class PosTrendChip extends StatelessWidget {
  const PosTrendChip({required this.percentChange, super.key});
  final double? percentChange;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final change = percentChange;
    if (change == null) {
      return Text('Sin datos de ayer', style: TextStyle(color: palette.textMuted, fontSize: 11.5));
    }
    final up = change >= 0;
    final color = up ? palette.success : palette.error;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: color.withValues(alpha: .12), borderRadius: BorderRadius.circular(20)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(up ? Icons.arrow_upward : Icons.arrow_downward, size: 12, color: color),
          const SizedBox(width: 3),
          Text(
            '${change.abs().toStringAsFixed(1)}% vs. ayer',
            style: TextStyle(color: color, fontSize: 11.5, fontWeight: FontWeight.w700),
          ),
        ],
      ),
    );
  }
}
