/// TASK 16.8 — real printable document for a cash-register cut (corte
/// parcial or cierre final). Mirrors `receipt_html.dart`'s exact CSS/
/// typography/paper-width contract (`buildReceiptHtml`) so a corte prints
/// with the same width/margin fidelity a sale receipt already does on the
/// same physical printer — reuses the exact TASK 16.7B infrastructure
/// (`openReceiptPrintWindow`, `receipts.paper_width_mm`,
/// `receipts.header_text`/`footer_text`, `branding.logo_url`) rather than
/// inventing a second printing mechanism.
///
/// The cash-truth block above is deliberately CASH-ONLY in scope: every
/// figure in it comes from `cash_sessions`/`cash_movements`
/// (`PosCashSession`/`PosCashSessionSummary`/`PosCashSessionPartialClose`),
/// which by this platform's own correct design never records card/
/// transfer sales at all (only a `cash_sale` movement's cash leg ever
/// touches the drawer). It never claims to show "sales by payment
/// method" — see `docs/LEGACY_FUNCTIONAL_PARITY.md`'s TASK 16.8 section.
///
/// TASK 16.13 adds an optional, visually SEPARATE "Resumen operativo"
/// section ([operationalSummary]) — Ventas/Taquilla, Cafetería/Snacks,
/// Eventos/Fiestas — printed below the cash-truth block, never mixed
/// into it. It renders only the already-final figures the backend
/// computed and froze at the moment of the cut (`CashPartialCloseOperationalSummary`);
/// this file performs no computation of its own, only formatting.
library;

const String _cashCutDisclaimer = 'Documento interno de control de caja — no es un comprobante fiscal.';

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

String _money(String amount, String currencyCode) {
  final parsed = double.tryParse(amount);
  if (parsed == null) return '\$$amount';
  final sign = parsed < 0 ? '-' : '';
  return '$sign\$${parsed.abs().toStringAsFixed(2)}';
}

/// One row of the cut document — a label/value pair, optionally emphasized
/// (the running total rows).
class CashCutLine {
  const CashCutLine(this.label, this.value, {this.emphasize = false});
  final String label;
  final String value;
  final bool emphasize;
}

/// TASK 16.13 — plain, print-ready mirror of `PosCashOperationalSummary`
/// (`pos_cash_gateway.dart`). Deliberately primitives only, matching this
/// file's own pure-string-building design (no Flutter/gateway import
/// here) — the caller converts from the real gateway model.
class CashCutOperationalSummary {
  const CashCutOperationalSummary({
    required this.posNetSales,
    required this.posTicketCount,
    required this.posRefundsTotal,
    required this.cafeteriaAvailable,
    required this.cafeteriaNetSales,
    required this.cafeteriaTicketCount,
    required this.cafeteriaUnitsSold,
    required this.eventsReservationsCreated,
    required this.eventsDepositsCollected,
    required this.eventsTotalCollected,
    required this.eventsOutstandingForNew,
    required this.eventsOccurringToday,
    required this.eventsCancelledCount,
  });
  final String posNetSales;
  final int posTicketCount;
  final String posRefundsTotal;
  final bool cafeteriaAvailable;
  final String cafeteriaNetSales;
  final int cafeteriaTicketCount;
  final String cafeteriaUnitsSold;
  final int eventsReservationsCreated;
  final String eventsDepositsCollected;
  final String eventsTotalCollected;
  final String eventsOutstandingForNew;
  final int eventsOccurringToday;
  final int eventsCancelledCount;
}

String _units(String raw) {
  final parsed = double.tryParse(raw);
  if (parsed == null) return raw;
  return parsed == parsed.truncateToDouble() ? parsed.truncate().toString() : parsed.toString();
}

/// Renders a cash-register cut (corte parcial or cierre final) as a
/// self-contained, printable HTML document string — pure string building,
/// directly unit-testable, no Flutter widget tree and no browser API.
///
/// [isFinal] distinguishes a real closure (shows counted/expected/
/// difference and, when present, the denomination breakdown) from a
/// partial cut (an in-progress snapshot — no counted/difference section,
/// clearly marked "CORTE PARCIAL — LA CAJA SIGUE ABIERTA" so it is never
/// mistaken for a real closure).
/// [denominationLines], when supplied (final close only, and only when
/// the cashier used the denomination-count entry rather than a single
/// total), renders the real bills/coins breakdown the legacy's own
/// printed corte never included.
String buildCashCutHtml({
  required bool isFinal,
  required String businessName,
  required String branchName,
  required String registerName,
  required String openedByName,
  required DateTime openedAt,
  required String openingAmount,
  required String cashSalesTotal,
  required int cashSalesCount,
  required String externalIncomeTotal,
  required String withdrawalTotal,
  required String expenseTotal,
  required String otherCashInTotal,
  required String otherCashOutTotal,
  required String expectedCash,
  required String currencyCode,
  DateTime? takenAt,
  String? closedByName,
  DateTime? closedAt,
  String? declaredClosingAmount,
  String? discrepancyAmount,
  List<CashCutLine>? denominationLines,
  CashCutOperationalSummary? operationalSummary,
  // TASK 16.14 — already folded into the cash-truth block above via the
  // "Salidas" total (a `cash_refund` movement is a real cash-out), now
  // also surfaced as its own named line, mirroring Retiros/Gastos/
  // Ingresos externos' own precedent. Only rendered when non-zero.
  String? cashRefundTotal,
  // TASK 16.14 §12/§18 — the operator's own optional explanation for a
  // non-zero difference, printed directly under the diferencia banner.
  String? discrepancyReason,
  // TASK 16.14 §6/§18 — "VENTAS POR MÉTODO DE PAGO": real captured-sales
  // totals by tender (never the same figure as `expectedCash` above —
  // see this file's own top doc comment for why cash/card/other sales
  // are deliberately kept out of the cash-truth block). Pre-formatted by
  // the caller (label = human method name, value = formatted money),
  // mirroring [denominationLines]'s own "plain lines, no gateway
  // dependency here" convention. Final close only; `null`/empty omits
  // the whole section.
  List<CashCutLine>? paymentMethodLines,
  double paperWidthMm = 80,
  String? logoDataUri,
  String? headerText,
  String? footerText,
}) {
  final contentWidthMm = paperWidthMm - 6;
  final logoHtml = logoDataUri == null ? '' : '<img class="logo" src="${_escape(logoDataUri)}" alt="Logo">';
  final trimmedHeaderText = headerText?.trim() ?? '';
  final trimmedFooterText = footerText?.trim() ?? '';
  final headerTextHtml = trimmedHeaderText.isEmpty ? '' : '<div class="sub tenant-header">${_escape(trimmedHeaderText)}</div>';
  final footerTextHtml = trimmedFooterText.isEmpty ? '' : '<div class="tenant-footer">${_escape(trimmedFooterText)}</div>';

  String row(String label, String value, {bool emphasize = false}) =>
      '<tr${emphasize ? ' class="total-row"' : ''}><td>${_escape(label)}</td><td class="amount">${_escape(value)}</td></tr>';

  final movementRows = StringBuffer()
    ..write(row('Fondo inicial', _money(openingAmount, currencyCode)))
    ..write(row('Ventas en efectivo ($cashSalesCount)', _money(cashSalesTotal, currencyCode)))
    ..write(row('Ingresos externos', _money(externalIncomeTotal, currencyCode)));
  if (_isNonZero(otherCashInTotal)) movementRows.write(row('Otras entradas', _money(otherCashInTotal, currencyCode)));
  movementRows
    ..write(row('Retiros', '-${_money(withdrawalTotal, currencyCode)}'))
    ..write(row('Gastos', '-${_money(expenseTotal, currencyCode)}'));
  if (_isNonZero(otherCashOutTotal)) movementRows.write(row('Otras salidas', '-${_money(otherCashOutTotal, currencyCode)}'));
  if (cashRefundTotal != null && _isNonZero(cashRefundTotal)) {
    movementRows.write(row('Devoluciones en efectivo', '-${_money(cashRefundTotal, currencyCode)}'));
  }

  final closingSectionHtml = !isFinal
      ? '<div class="banner">CORTE PARCIAL — LA CAJA SIGUE ABIERTA</div>'
      : (declaredClosingAmount == null
            ? ''
            : () {
                final discrepancy = discrepancyAmount ?? '0';
                final isShortage = discrepancy.trim().startsWith('-');
                final isZero = double.tryParse(discrepancy.replaceAll('-', '')) == 0;
                // TASK 16.14 §11/§13/§18 — neutral accounting language,
                // never "CUADRADO".
                final label = isZero ? 'SIN DIFERENCIA' : (isShortage ? 'FALTANTE' : 'SOBRANTE');
                final denomHtml = denominationLines == null || denominationLines.isEmpty
                    ? ''
                    : '<hr class="divider"><div class="meta"><b>Conteo por denominación</b></div><table class="kv">'
                          '${denominationLines.map((l) => '<tr><td>${_escape(l.label)}</td><td class="amount">${_escape(l.value)}</td></tr>').join()}'
                          '</table>';
                final reasonHtml = (discrepancyReason == null || discrepancyReason.trim().isEmpty)
                    ? ''
                    : '<div class="meta">Motivo: ${_escape(discrepancyReason.trim())}</div>';
                return '<hr class="divider">'
                    '<table class="totals">'
                    '${row('Efectivo contado', _money(declaredClosingAmount, currencyCode))}'
                    '${row('Diferencia', _money(discrepancy, currencyCode))}'
                    '</table>'
                    '<div class="banner">$label</div>'
                    '$reasonHtml'
                    '$denomHtml';
              }());

  // TASK 16.14 §6/§18 — visually separate from the cash-truth block
  // above, exactly like RESUMEN OPERATIVO below it — real captured-sales
  // totals by tender, deliberately never mixed into "Efectivo esperado".
  final paymentMethodHtml = paymentMethodLines == null || paymentMethodLines.isEmpty
      ? ''
      : '<hr class="divider">'
            '<div class="meta"><b>VENTAS POR MÉTODO DE PAGO</b></div>'
            '<table class="kv">'
            '${paymentMethodLines.map((l) => row(l.label, l.value)).join()}'
            '</table>';

  // TASK 16.13 — visually separate from the cash-truth block above (its
  // own heading, its own `<hr>`), reporting-only, and Cafetería is
  // explicitly labeled as a subset of Taquilla so the printed page can
  // never be misread as "$X Taquilla + $Y Cafetería = bigger total".
  final operationalHtml = operationalSummary == null
      ? ''
      : () {
          final s = operationalSummary;
          final cafeteriaRows = s.cafeteriaAvailable
              ? '${row('Ventas netas', _money(s.cafeteriaNetSales, currencyCode))}'
                    '${row('Tickets', s.cafeteriaTicketCount.toString())}'
                    '${row('Unidades', _units(s.cafeteriaUnitsSold))}'
              : '<tr><td colspan="2">No configurado</td></tr>';
          return '<hr class="divider">'
              '<div class="meta"><b>RESUMEN OPERATIVO</b></div>'
              '<div class="meta">Ventas / Taquilla</div>'
              '<table class="kv">'
              '${row('Ventas netas', _money(s.posNetSales, currencyCode))}'
              '${row('Tickets', s.posTicketCount.toString())}'
              '${_isNonZero(s.posRefundsTotal) ? row('Devoluciones', '-${_money(s.posRefundsTotal, currencyCode)}') : ''}'
              '</table>'
              '<div class="meta">Cafetería / Snacks (parte de Taquilla)</div>'
              '<table class="kv">$cafeteriaRows</table>'
              '<div class="meta">Eventos / Fiestas</div>'
              '<table class="kv">'
              '${row('Reservados (turno)', s.eventsReservationsCreated.toString())}'
              '${row('Anticipos cobrados', _money(s.eventsDepositsCollected, currencyCode))}'
              '${row('Cobrado', _money(s.eventsTotalCollected, currencyCode))}'
              '${row('Saldo pendiente (nuevas)', _money(s.eventsOutstandingForNew, currencyCode))}'
              '${row('Eventos de hoy', s.eventsOccurringToday.toString())}'
              '${s.eventsCancelledCount > 0 ? row('Cancelaciones', s.eventsCancelledCount.toString()) : ''}'
              '</table>';
        }();

  return '<!DOCTYPE html><html><head><meta charset="UTF-8">'
      '<title>${isFinal ? 'Cierre de caja' : 'Corte parcial'}</title>'
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
      '.amount{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}'
      '.total-row td{font-size:13px;font-weight:700;padding-top:4px;border-top:1px solid #000}'
      '.meta{font-size:11px;margin-bottom:6px;line-height:1.6;overflow-wrap:anywhere}'
      '.kv{font-size:11px}'
      '.kv td{padding:1px 0}'
      '.footer{text-align:center;font-size:10px;color:#333;margin-top:10px;line-height:1.6}'
      '.tenant-footer{text-align:center;font-size:10px;color:#333;margin-top:6px;'
      'line-height:1.4;white-space:pre-line;overflow-wrap:anywhere}'
      '.print-action{text-align:center;margin-top:14px}'
      '.print-action button{padding:8px 20px;font-size:13px;cursor:pointer}'
      '@media print{.print-action{display:none!important}body{margin:0}}'
      '</style></head>'
      '<body>'
      '$logoHtml'
      '<h1>${_escape(businessName)}</h1>'
      '<div class="sub">${[branchName, registerName].where((value) => value.isNotEmpty).map(_escape).join(' · ')}</div>'
      '$headerTextHtml'
      '<hr class="divider">'
      '<div class="meta">'
      '<b>${isFinal ? 'Cierre de caja' : 'Corte parcial'}</b>'
      '<br>Apertura: ${_formatDateTime(openedAt)}${openedByName.isEmpty ? '' : ' · ${_escape(openedByName)}'}'
      '${takenAt == null ? '' : '<br>Registrado: ${_formatDateTime(takenAt)}'}'
      '${closedAt == null ? '' : '<br>Cierre: ${_formatDateTime(closedAt)}${(closedByName == null || closedByName.isEmpty) ? '' : ' · ${_escape(closedByName)}'}'}'
      '</div>'
      '<hr class="divider">'
      '<table class="totals">$movementRows'
      '${row('Efectivo esperado', _money(expectedCash, currencyCode), emphasize: true)}'
      '</table>'
      '$closingSectionHtml'
      '$paymentMethodHtml'
      '$operationalHtml'
      '<hr class="divider">'
      '$footerTextHtml'
      '<div class="footer">${_escape(_cashCutDisclaimer)}</div>'
      '<div class="print-action">'
      '<button onclick="window.print()">🖨️ Imprimir</button>'
      '</div>'
      '</body></html>';
}

bool _isNonZero(String amount) {
  final parsed = double.tryParse(amount);
  return parsed == null ? amount.trim().isNotEmpty : parsed != 0.0;
}
