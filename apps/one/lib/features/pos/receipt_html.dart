/// TASK 12.5B: renders a [PosReceipt] into a self-contained, printable
/// HTML document — pure string building, no Flutter widget tree and no
/// browser API, so it is directly unit-testable on the Dart VM (see
/// ADR-0012's "Printing" decision for why this is a *separate document*
/// rather than `window.print()` on the running app). The generated
/// document intentionally contains nothing from the running POS UI: no
/// sidebar, no navigation, no app chrome — only the receipt itself plus
/// one on-screen "Imprimir" convenience button, which `@media print`
/// hides from the actual printed page.
library;

import 'money.dart';
import 'pos_receipt.dart';
import 'sale_folio.dart';

const String _cfdiDisclaimer = 'Comprobante de compra — no es un comprobante fiscal (CFDI).';

String _escape(String value) => value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

// TASK 12.9: a plain decimal-string nonzero check — never parses through
// `Money` just to compare against zero, and never crashes the receipt over
// a malformed value (falls back to "show nothing" rather than "show a
// garbled discount row").
bool _isNonZeroAmount(String amount) {
  try {
    return !Money.parse(amount, 'MXN').isZero;
  } on MoneyFormatException {
    return false;
  }
}

String _money(String amount, String currencyCode) {
  try {
    return '\$${Money.parse(amount, currencyCode).toDisplayString()}';
  } on MoneyFormatException {
    // Never crash a receipt render over a malformed backend value —
    // fall back to the raw wire string rather than hide the amount.
    return '\$$amount';
  }
}

String _formatDateTime(DateTime value) {
  final local = value.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(local.day)}/${two(local.month)}/${local.year} ${two(local.hour)}:${two(local.minute)}';
}

String _paymentMethodLabel(String method) => switch (method) {
  'cash' => 'Efectivo',
  'card_terminal' => 'Tarjeta',
  'card_manual' => 'Tarjeta (manual)',
  _ => method,
};

/// Renders [receipt] as a full HTML document string.
///
/// [paperWidthMm] drives both the CSS `@page` size and the content
/// width — 80mm is the required target; a future 58mm layout is simply
/// a different value here (see ADR-0012's "80mm target, 58mm-ready").
/// [logoDataUri], when supplied, must already be a complete `data:`
/// URI (e.g. from the bundled `assets/branding/as_logo_mark.png`) — this
/// function never fetches or reads a file itself, and never accepts a
/// bare filesystem path.
String buildReceiptHtml({
  required PosReceipt receipt,
  String? logoDataUri,
  double paperWidthMm = 80,
}) {
  final sale = receipt.sale;
  final business = receipt.business;
  final cashier = receipt.cashier;
  final currency = sale.currencyCode;
  final contentWidthMm = paperWidthMm - 6; // page minus 3mm margins each side.

  final logoHtml = logoDataUri == null
      ? ''
      : '<img class="logo" src="${_escape(logoDataUri)}" alt="Logo">';

  final businessNameHtml = _escape(business?.companyName ?? 'AS ONE POS');
  final branchLineParts = <String>[
    if (business != null) business.branchName,
    if (business?.branchAddress?['line1'] is String) business!.branchAddress!['line1']! as String,
  ];
  final branchLineHtml = branchLineParts.isEmpty ? '' : _escape(branchLineParts.join(' · '));

  // TASK 12.9: a per-line "PROMO/CUPÓN/DESC." discount row directly under
  // the item it reduced — only ever rendered when that line's own
  // `discount_total` (real since this task; always `"0.0000"` before it)
  // is nonzero, so a legacy/undiscounted receipt renders byte-identical
  // to before (ADR-0016 D14).
  final itemsRowsHtml = receipt.items.isEmpty
      ? '<tr><td colspan="2" class="muted">Sin artículos</td></tr>'
      : receipt.items
            .map((item) {
              final qty = item.quantity;
              final qtySuffix = qty == '1.000000' ? '' : ' x$qty';
              final discountRow = _isNonZeroAmount(item.discountTotal)
                  ? '<tr class="discount-row">'
                        '<td class="item-name muted">Descuento</td>'
                        '<td class="amount muted">-${_money(item.discountTotal, currency)}</td>'
                        '</tr>'
                  : '';
              return '<tr>'
                      '<td class="item-name">${_escape(item.nameSnapshot)}$qtySuffix</td>'
                      '<td class="amount">${_money(item.lineTotal, currency)}</td>'
                      '</tr>' +
                  discountRow;
            })
            .join();

  // TASK 12.5B.1: rendered as a `kv` table (same right-aligned,
  // tabular-nums `.amount` cell the items/totals tables already use) so
  // every monetary figure on the ticket — line items, subtotal/IVA/TOTAL,
  // and the payment section's monto aplicado/efectivo recibido/cambio —
  // lines up on one consistent right edge, instead of the previous plain
  // `<div>label: value</div>` lines whose amounts didn't align with
  // anything else on the page. `Cambio` (the figure a customer actually
  // double-checks) gets the same visual weight as TOTAL via `.change-row`.
  final paymentHtml = receipt.payments.isEmpty
      ? '<div class="muted">Sin pagos registrados.</div>'
      : receipt.payments
            .map((payment) {
              final rows = StringBuffer()
                ..write(
                  '<tr><td>Método</td><td class="amount">${_escape(_paymentMethodLabel(payment.paymentMethod))}</td></tr>',
                )
                ..write(
                  '<tr><td>Monto aplicado</td><td class="amount">${_money(payment.amount, payment.currencyCode)}</td></tr>',
                );
              if (payment.isCash) {
                if (payment.tenderedAmount != null) {
                  rows.write(
                    '<tr><td>Efectivo recibido</td><td class="amount">${_money(payment.tenderedAmount!, payment.currencyCode)}</td></tr>',
                  );
                }
                if (payment.changeAmount != null) {
                  rows.write(
                    '<tr class="change-row"><td>Cambio</td><td class="amount">${_money(payment.changeAmount!, payment.currencyCode)}</td></tr>',
                  );
                }
              } else if (payment.providerReference != null) {
                // Provider-safe reference only — never a PAN/CVV/track
                // datum, none of which this backend ever stores at all.
                rows.write(
                  '<tr><td>Referencia</td><td class="amount">${_escape(payment.providerReference!)}</td></tr>',
                );
              }
              return '<table class="kv payment-block">${rows.toString()}</table>';
            })
            .join('<hr class="divider">');

  return '<!DOCTYPE html><html><head><meta charset="UTF-8">'
      '<title>Ticket ${_escape(sale.saleNumber)}</title>'
      '<style>'
      '@page{size:${paperWidthMm}mm auto;margin:3mm}'
      '*{margin:0;padding:0;box-sizing:border-box}'
      'html,body{background:#fff}'
      'body{font-family:"Courier New",Courier,monospace;font-size:12px;color:#000;'
      'width:${contentWidthMm}mm;max-width:${contentWidthMm}mm;margin:6px auto;padding:0 2mm}'
      '.logo{display:block;margin:0 auto 4px;max-height:44px;max-width:${contentWidthMm}mm}'
      'h1{text-align:center;font-size:15px;margin-bottom:2px;font-weight:700}'
      '.sub{text-align:center;font-size:10px;color:#333;margin-bottom:8px}'
      '.divider{border:none;border-top:1px dashed #000;margin:6px 0}'
      'table{width:100%;border-collapse:collapse}'
      'td{padding:2px 0;vertical-align:top}'
      '.item-name{word-break:break-word;padding-right:6px}'
      '.discount-row td{font-size:11px}'
      '.amount{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}'
      '.totals td{padding:1px 0}'
      '.total-row td{font-size:14px;font-weight:700;padding-top:4px;border-top:1px solid #000;'
      'letter-spacing:0.4px}'
      // `overflow-wrap:anywhere` is a defense-in-depth safety net for the
      // folio line specifically (see `displaySaleFolio` in `sale_folio.dart`
      // — the value here is already short by design) so that any future
      // unexpectedly long value wraps within the ticket's own width
      // instead of overflowing it, matching the completed-sale dialog's
      // equivalent fix.
      '.meta{font-size:11px;margin-bottom:6px;line-height:1.6;overflow-wrap:anywhere}'
      '.kv{font-size:12px}'
      '.kv td{padding:1px 0}'
      '.payment-block{line-height:1.6}'
      '.change-row td{font-size:13px;font-weight:700;padding-top:3px;border-top:1px dashed #000}'
      '.muted{color:#555}'
      '.footer{text-align:center;font-size:10px;color:#333;margin-top:10px;line-height:1.6}'
      '.print-action{text-align:center;margin-top:14px}'
      '.print-action button{padding:8px 20px;font-size:13px;cursor:pointer}'
      '@media print{.print-action{display:none!important}body{margin:0}}'
      '</style></head>'
      '<body>'
      '$logoHtml'
      '<h1>$businessNameHtml</h1>'
      '${branchLineHtml.isEmpty ? '' : '<div class="sub">$branchLineHtml</div>'}'
      '<hr class="divider">'
      '<div class="meta">'
      // TASK 12.5B.1: the printed, customer-facing folio is the short,
      // deterministic `displaySaleFolio` derived from the canonical
      // `sale_number` (see `sale_folio.dart`) — not the raw 37-character
      // `SALE-<32-hex>` value, which real 80mm print QA showed wrapping
      // across lines. The canonical `sale_number` itself is unchanged and
      // still the document `<title>` above (never printed on paper) and
      // every API reference; this is a display-only substitution.
      '<b>Folio ${_escape(displaySaleFolio(sale.saleNumber))}</b> · ${_formatDateTime(sale.completedAt ?? sale.occurredAt)}'
      '${cashier == null ? '' : '<br>Cajero: ${_escape(cashier.displayName)}'}'
      '</div>'
      '<hr class="divider">'
      '<table>$itemsRowsHtml</table>'
      '<hr class="divider">'
      '<table class="totals">'
      '<tr><td>Subtotal</td><td class="amount">${_money(sale.subtotal, currency)}</td></tr>'
      // TASK 12.9: only ever shown for a real, nonzero discount — a
      // legacy sale (`discount_total = '0.0000'`, ADR-0016 D14) renders
      // this exact table unchanged from before this task.
      '${_isNonZeroAmount(sale.discountTotal) ? '<tr><td>Descuentos</td><td class="amount">-${_money(sale.discountTotal, currency)}</td></tr>' : ''}'
      '<tr><td>IVA</td><td class="amount">${_money(sale.taxTotal, currency)}</td></tr>'
      '<tr class="total-row"><td>TOTAL</td><td class="amount">${_money(sale.total, currency)}</td></tr>'
      '</table>'
      '<hr class="divider">'
      '$paymentHtml'
      '<hr class="divider">'
      '<div class="footer">'
      '¡Gracias por tu compra!<br>'
      '${_escape(_cfdiDisclaimer)}'
      '</div>'
      '<div class="print-action">'
      '<button onclick="window.print()">🖨️ Imprimir</button>'
      '</div>'
      '</body></html>';
}
