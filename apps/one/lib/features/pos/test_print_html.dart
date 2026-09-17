/// TASK 16.7B — "Imprimir ticket de prueba" (item I of the task spec): a
/// clearly-marked, zero-side-effect print used only to check that a
/// physical thermal printer actually connected to Windows renders width,
/// typography, logo, margins, and cut point legibly, BEFORE trusting it
/// with a real sale.
///
/// This is deliberately a SEPARATE, pure HTML builder from
/// `buildReceiptHtml` (`receipt_html.dart`) — not a synthetic `PosReceipt`
/// fed through the real receipt renderer — for one concrete reason:
/// `displaySaleFolio` (`sale_folio.dart`) unconditionally prefixes its
/// output with `"SALE-"`, so any synthetic sale number fed through
/// `buildReceiptHtml` would print a folio that *looks* like a real sale
/// reference. A test print must never be mistakable for a real one. This
/// file mirrors `buildReceiptHtml`'s CSS (`@page` width, monospace
/// typography, margins, dashed dividers) byte-for-byte where it matters
/// for the print-quality checks this exists to support, so the test
/// print's physical output is a faithful preview of a real receipt's
/// width/typography/margins — but its CONTENT is unambiguous placeholder
/// data, never anything that could be confused with a real transaction.
///
/// Callers pass only already-resolved display strings/URIs (mirrors
/// `buildReceiptHtml`'s own contract) — this function never fetches
/// settings, never calls a gateway, and has no knowledge of sales,
/// payments, or inventory. It cannot have a financial side effect because
/// it never touches anything financial in the first place.
library;

const String _testPrintBanner = 'PRUEBA DE IMPRESIÓN — NO ES UNA VENTA';

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

/// Renders a self-contained, printable HTML document that exercises the
/// exact same paper-width/typography/margin CSS a real receipt uses,
/// filled with obviously-synthetic sample data and boxed banners top and
/// bottom that make it unmistakable for a real ticket at a glance.
///
/// [paperWidthMm] is the same real, tenant-configured value (58 or 80)
/// `PosPrinterSettingsScreen` reads from `receipts.paper_width_mm` —
/// never hardcoded here.
/// [logoDataUri]/[headerText]/[footerText], when supplied, are the
/// tenant's own real, already-configured receipt branding (so the test
/// print also proves the *real* branding assets render correctly at this
/// paper width) — never fabricated placeholders.
String buildTestPrintHtml({
  required String businessName,
  required String branchName,
  required String cashierName,
  double paperWidthMm = 80,
  String? logoDataUri,
  String? headerText,
  String? footerText,
  DateTime? now,
}) {
  final contentWidthMm = paperWidthMm - 6;
  final timestamp = now ?? DateTime.now();

  final logoHtml = logoDataUri == null
      ? ''
      : '<img class="logo" src="${_escape(logoDataUri)}" alt="Logo">';
  final trimmedHeaderText = headerText?.trim() ?? '';
  final trimmedFooterText = footerText?.trim() ?? '';
  final headerTextHtml = trimmedHeaderText.isEmpty
      ? ''
      : '<div class="sub tenant-header">${_escape(trimmedHeaderText)}</div>';
  final footerTextHtml = trimmedFooterText.isEmpty
      ? ''
      : '<div class="tenant-footer">${_escape(trimmedFooterText)}</div>';

  return '<!DOCTYPE html><html><head><meta charset="UTF-8">'
      '<title>Prueba de impresión</title>'
      '<style>'
      '@page{size:${paperWidthMm}mm auto;margin:3mm}'
      '*{margin:0;padding:0;box-sizing:border-box}'
      'html,body{background:#fff}'
      'body{font-family:"Courier New",Courier,monospace;font-size:12px;color:#000;'
      'width:${contentWidthMm}mm;max-width:${contentWidthMm}mm;margin:6px auto;padding:0 2mm}'
      '.logo{display:block;margin:0 auto 4px;max-height:44px;max-width:${contentWidthMm}mm}'
      'h1{text-align:center;font-size:15px;margin-bottom:2px;font-weight:700}'
      '.sub{text-align:center;font-size:10px;color:#333;margin-bottom:8px}'
      '.tenant-header{white-space:pre-line;overflow-wrap:anywhere}'
      '.divider{border:none;border-top:1px dashed #000;margin:6px 0}'
      '.banner{text-align:center;font-size:12px;font-weight:700;border:2px solid #000;'
      'padding:6px 4px;margin:6px 0;letter-spacing:0.3px}'
      'table{width:100%;border-collapse:collapse}'
      'td{padding:2px 0;vertical-align:top}'
      '.item-name{word-break:break-word;padding-right:6px}'
      '.amount{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}'
      '.meta{font-size:11px;margin-bottom:6px;line-height:1.6;overflow-wrap:anywhere}'
      '.muted{color:#555}'
      '.footer{text-align:center;font-size:10px;color:#333;margin-top:10px;line-height:1.6}'
      '.tenant-footer{text-align:center;font-size:10px;color:#333;margin-top:6px;'
      'line-height:1.4;white-space:pre-line;overflow-wrap:anywhere}'
      '.print-action{text-align:center;margin-top:14px}'
      '.print-action button{padding:8px 20px;font-size:13px;cursor:pointer}'
      '@media print{.print-action{display:none!important}body{margin:0}}'
      '</style></head>'
      '<body>'
      '<div class="banner">$_testPrintBanner</div>'
      '$logoHtml'
      '<h1>${_escape(businessName)}</h1>'
      '<div class="sub">${_escape(branchName)}</div>'
      '$headerTextHtml'
      '<hr class="divider">'
      '<div class="meta">'
      '<b>Prueba</b> · ${_formatDateTime(timestamp)}'
      '<br>Cajero: ${_escape(cashierName)}'
      '<br>Ancho de papel: ${paperWidthMm.toStringAsFixed(0)}mm'
      '</div>'
      '<hr class="divider">'
      '<table>'
      '<tr><td class="item-name">Producto de prueba A</td><td class="amount">\$10.00</td></tr>'
      '<tr><td class="item-name">Producto de prueba con nombre largo B x3</td><td class="amount">\$45.50</td></tr>'
      '<tr><td class="item-name muted">Descuento</td><td class="amount muted">-\$5.00</td></tr>'
      '</table>'
      '<hr class="divider">'
      '<table class="totals">'
      '<tr><td>Subtotal</td><td class="amount">\$50.50</td></tr>'
      '<tr><td>IVA</td><td class="amount">\$8.08</td></tr>'
      '<tr><td><b>TOTAL</b></td><td class="amount"><b>\$58.58</b></td></tr>'
      '</table>'
      '<hr class="divider">'
      '<div class="meta">Abcdefghijklmnopqrstuvwxyz 0123456789<br>ÁÉÍÓÚ Ññ áéíóú — legibilidad</div>'
      '<hr class="divider">'
      '$footerTextHtml'
      '<div class="footer">'
      '${_escape(_cfdiDisclaimerNote)}'
      '</div>'
      '<div class="banner">$_testPrintBanner</div>'
      '<div class="print-action">'
      '<button onclick="window.print()">🖨️ Imprimir</button>'
      '</div>'
      '</body></html>';
}

const String _cfdiDisclaimerNote =
    'Esta es una impresión de prueba. No representa una venta, un movimiento de inventario ni un cargo a caja.';
