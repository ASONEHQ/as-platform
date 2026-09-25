/// TASK 16.25 (Phase 17) — "PDF export" for a report area, built the
/// same way this app's OTHER real "PDF" surface already works
/// (`cash_cut_html.dart`/`receipt_html.dart`): a real, full HTML
/// document with the report's own real data, opened via the SAME
/// `openReceiptPrintWindow` (`receipt_print.dart`) every other printable
/// document in this app already uses, and printed through the browser's
/// own native print-to-PDF — never a second, unrelated PDF-rendering
/// stack. This mirrors the legacy's own `exportarInventarioPDF`/
/// `exportarKardexPDF` mechanism too (`window.open` + `document.write` +
/// `window.print()` — see `docs/LEGACY_FUNCTIONAL_PARITY.md`), just
/// honestly labeled: this app's own button says "Imprimir / PDF", never
/// a misleading "Descargar PDF" that doesn't actually auto-download
/// (the legacy's own documented naming defect).
///
/// Pure string-building, no Flutter import — mirrors
/// `cash_cut_html.dart`'s own deliberate shape exactly, so this stays
/// trivially unit-testable and has zero risk of ever leaking the running
/// app's own DOM into the printed page.
library;

String _escape(String value) => value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

String _formatDateTime(DateTime value) {
  final local = value.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(local.day)}/${two(local.month)}/${local.year} ${two(local.hour)}:${two(local.minute)}';
}

/// One KPI card in the printed report's summary grid.
class ReportPdfKpi {
  const ReportPdfKpi(this.label, this.value);
  final String label;
  final String value;
}

/// One detail table in the printed report (mirrors the on-screen
/// `_ReportsTable`'s own columns/rows shape — the caller passes exactly
/// what it already renders on screen, never a re-derived summary).
class ReportPdfTable {
  const ReportPdfTable({required this.title, required this.columns, required this.rows});
  final String title;
  final List<String> columns;
  final List<List<String>> rows;
}

/// Builds the full printable HTML document for one report area. Every
/// value here is a plain, pre-formatted string the caller already
/// computed for the on-screen panel — this function performs no
/// aggregation of its own, only layout.
String buildReportPdfHtml({
  required String companyName,
  required String branchLabel,
  required String areaLabel,
  required String dateFrom,
  required String dateTo,
  required DateTime generatedAt,
  required List<ReportPdfKpi> kpis,
  List<ReportPdfTable> tables = const [],
  String? note,
}) {
  final kpiCardsHtml = kpis
      .map(
        (kpi) =>
            '<div class="kpi"><div class="kpi-label">${_escape(kpi.label)}</div>'
            '<div class="kpi-value">${_escape(kpi.value)}</div></div>',
      )
      .join();
  final tablesHtml = tables
      .map((table) {
        final headerHtml = table.columns.map((column) => '<th>${_escape(column)}</th>').join();
        final rowsHtml = table.rows.isEmpty
            ? '<tr><td colspan="${table.columns.length}" class="empty">Sin registros en este rango.</td></tr>'
            : table.rows
                  .map((row) => '<tr>${row.map((cell) => '<td>${_escape(cell)}</td>').join()}</tr>')
                  .join();
        return '<h2>${_escape(table.title)}</h2>'
            '<table class="detail"><thead><tr>$headerHtml</tr></thead><tbody>$rowsHtml</tbody></table>';
      })
      .join();

  return '<!DOCTYPE html><html><head><meta charset="UTF-8">'
      '<title>${_escape(areaLabel)} — ${_escape(companyName)}</title>'
      '<style>'
      '@page{size:A4;margin:14mm}'
      '*{margin:0;padding:0;box-sizing:border-box}'
      'html,body{background:#fff}'
      'body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#111;padding:0 4mm}'
      'header{border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:14px}'
      'h1{font-size:20px;font-weight:800}'
      '.meta{font-size:11px;color:#444;margin-top:4px;line-height:1.6}'
      '.kpis{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:18px}'
      '.kpi{border:1px solid #ccc;border-radius:6px;padding:8px 12px;min-width:130px}'
      '.kpi-label{font-size:10px;color:#555;text-transform:uppercase;letter-spacing:.3px}'
      '.kpi-value{font-size:17px;font-weight:800;margin-top:3px}'
      'h2{font-size:14px;font-weight:700;margin:16px 0 6px}'
      'table.detail{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:10px}'
      'table.detail th{text-align:left;border-bottom:1.5px solid #111;padding:4px 6px;background:#f4f4f4}'
      'table.detail td{border-bottom:1px solid #ddd;padding:4px 6px}'
      'table.detail td.empty{text-align:center;color:#777;padding:10px 6px}'
      '.note{font-size:10.5px;color:#555;margin-top:10px;line-height:1.5}'
      '.footer{font-size:10px;color:#777;margin-top:22px;border-top:1px solid #ccc;padding-top:6px}'
      '.print-action{text-align:center;margin-top:18px}'
      '.print-action button{padding:8px 20px;font-size:13px;cursor:pointer}'
      '@media print{.print-action{display:none!important}}'
      '</style></head><body>'
      '<header>'
      '<h1>${_escape(areaLabel)}</h1>'
      '<div class="meta">'
      '${_escape(companyName)} · ${_escape(branchLabel)}'
      '<br>Periodo: ${_escape(dateFrom)} — ${_escape(dateTo)}'
      '<br>Generado: ${_formatDateTime(generatedAt)}'
      '</div>'
      '</header>'
      '<div class="kpis">$kpiCardsHtml</div>'
      '$tablesHtml'
      '${note == null ? '' : '<div class="note">${_escape(note)}</div>'}'
      '<div class="footer">Cifras reales calculadas por el servidor para el rango y sucursal seleccionados. Sin métricas simuladas.</div>'
      '<div class="print-action"><button onclick="window.print()">🖨️ Imprimir / Guardar como PDF</button></div>'
      '</body></html>';
}
