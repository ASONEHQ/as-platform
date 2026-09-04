/// TASK 12.8: renders a [PosRefund] into a self-contained, printable HTML
/// return/refund receipt — the exact same architecture as
/// `receipt_html.dart`'s `buildReceiptHtml` (pure string building, no
/// Flutter widget tree, `@media print` hides the on-screen "Imprimir"
/// button) — see ADR-0015 D17: no dedicated backend receipt endpoint
/// exists, so this composes `GET /refunds/{id}` (E083)'s own item/total
/// data with the same sale/organization/branch data the existing sale
/// receipt already fetches (`salesGateway.receipt`) plus the refundable-
/// balance (E081) already fetched to gate the refund action, which is the
/// only place a refund line's name/unit price can be joined back in
/// (`refund_items` itself stores no name snapshot). Printing/reprinting
/// is a pure read — this function never calls the backend and never
/// mutates anything.
library;

import 'money.dart';
import 'pos_receipt.dart';
import 'pos_refunds_gateway.dart';
import 'sale_folio.dart';

String _escape(String value) => value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

String _money(String amount, String currencyCode) {
  try {
    return '\$${Money.parse(amount, currencyCode).toDisplayString()}';
  } on MoneyFormatException {
    // Never crash a receipt render over a malformed backend value — fall
    // back to the raw wire string rather than hide the amount.
    return '\$$amount';
  }
}

String _formatDateTime(DateTime value) {
  final local = value.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(local.day)}/${two(local.month)}/${local.year} ${two(local.hour)}:${two(local.minute)}';
}

String _refundMethodLabel(String method) => switch (method) {
  'cash' => 'Efectivo',
  'card_terminal' => 'Tarjeta',
  'card_manual' => 'Tarjeta (manual)',
  _ => method,
};

String _refundStatusLabel(String status) => switch (status) {
  'completed' => 'Completada',
  'approved' => 'Aprobada — pendiente de completar',
  'requested' => 'Solicitada',
  'pending_approval' => 'Pendiente de aprobación',
  'cancelled' => 'Cancelada',
  'rejected' => 'Rechazada',
  _ => status,
};

/// Renders [refund] as a full HTML document string — the "REEMBOLSO"
/// banner keeps this visually distinguishable from a sale receipt at a
/// glance, never confusable with one (the task's own explicit
/// requirement). [lineInfoBySaleItemId] supplies each line's own name/unit
/// price (from [PosRefundableBalance.lineFor], keyed by `sale_item_id`) —
/// a missing entry (e.g. the balance could not be refetched) falls back to
/// a plain "Artículo" label rather than fabricating one.
String buildRefundReceiptHtml({
  required PosRefund refund,
  required PosReceiptSale sale,
  PosReceiptBusiness? business,
  PosReceiptCashier? cashier,
  Map<String, PosRefundableLine> lineInfoBySaleItemId = const {},
  String? logoDataUri,
  double paperWidthMm = 80,
}) {
  final currency = refund.currencyCode;
  final contentWidthMm = paperWidthMm - 6;
  final items = refund.items ?? const <PosRefundItem>[];

  final logoHtml = logoDataUri == null
      ? ''
      : '<img class="logo" src="${_escape(logoDataUri)}" alt="Logo">';

  final businessNameHtml = _escape(business?.companyName ?? 'AS ONE POS');
  final branchLineParts = <String>[
    if (business != null) business.branchName,
    if (business?.branchAddress?['line1'] is String) business!.branchAddress!['line1']! as String,
  ];
  final branchLineHtml = branchLineParts.isEmpty ? '' : _escape(branchLineParts.join(' · '));

  final itemsRowsHtml = items.isEmpty
      ? '<tr><td colspan="2" class="muted">Sin artículos</td></tr>'
      : items
            .map((item) {
              final info = lineInfoBySaleItemId[item.saleItemId];
              final name = info?.nameSnapshot ?? 'Artículo';
              final qty = item.quantity;
              final qtySuffix = qty == '1.000000' ? '' : ' x$qty';
              return '<tr>'
                  '<td class="item-name">${_escape(name)}$qtySuffix</td>'
                  '<td class="amount">${_money(item.lineTotal, currency)}</td>'
                  '</tr>';
            })
            .join();

  final reasonRows = StringBuffer()
    ..write(
      '<tr><td>Motivo</td><td class="amount">${_escape(refund.reasonCode)}</td></tr>',
    );
  if (refund.reasonNote != null && refund.reasonNote!.trim().isNotEmpty) {
    reasonRows.write(
      '<tr><td>Nota</td><td class="amount">${_escape(refund.reasonNote!.trim())}</td></tr>',
    );
  }
  reasonRows
    ..write(
      '<tr><td>Método</td><td class="amount">${_escape(_refundMethodLabel(refund.refundMethod))}</td></tr>',
    )
    ..write(
      '<tr><td>Estado</td><td class="amount">${_escape(_refundStatusLabel(refund.status))}</td></tr>',
    );

  return '<!DOCTYPE html><html><head><meta charset="UTF-8">'
      '<title>Reembolso ${_escape(refund.refundNumber)}</title>'
      '<style>'
      '@page{size:${paperWidthMm}mm auto;margin:3mm}'
      '*{margin:0;padding:0;box-sizing:border-box}'
      'html,body{background:#fff}'
      'body{font-family:"Courier New",Courier,monospace;font-size:12px;color:#000;'
      'width:${contentWidthMm}mm;max-width:${contentWidthMm}mm;margin:6px auto;padding:0 2mm}'
      '.logo{display:block;margin:0 auto 4px;max-height:44px;max-width:${contentWidthMm}mm}'
      '.doc-type{text-align:center;font-size:13px;font-weight:700;letter-spacing:1.5px;'
      'border:1.5px solid #000;padding:3px 0;margin-bottom:6px}'
      'h1{text-align:center;font-size:15px;margin-bottom:2px;font-weight:700}'
      '.sub{text-align:center;font-size:10px;color:#333;margin-bottom:8px}'
      '.divider{border:none;border-top:1px dashed #000;margin:6px 0}'
      'table{width:100%;border-collapse:collapse}'
      'td{padding:2px 0;vertical-align:top}'
      '.item-name{word-break:break-word;padding-right:6px}'
      '.amount{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}'
      '.totals td{padding:1px 0}'
      '.total-row td{font-size:14px;font-weight:700;padding-top:4px;border-top:1px solid #000;'
      'letter-spacing:0.4px}'
      '.meta{font-size:11px;margin-bottom:6px;line-height:1.6;overflow-wrap:anywhere}'
      '.kv{font-size:12px}'
      '.kv td{padding:1px 0}'
      '.muted{color:#555}'
      '.footer{text-align:center;font-size:10px;color:#333;margin-top:10px;line-height:1.6}'
      '.print-action{text-align:center;margin-top:14px}'
      '.print-action button{padding:8px 20px;font-size:13px;cursor:pointer}'
      '@media print{.print-action{display:none!important}body{margin:0}}'
      '</style></head>'
      '<body>'
      '$logoHtml'
      '<div class="doc-type">REEMBOLSO</div>'
      '<h1>$businessNameHtml</h1>'
      '${branchLineHtml.isEmpty ? '' : '<div class="sub">$branchLineHtml</div>'}'
      '<hr class="divider">'
      '<div class="meta">'
      '<b>Folio ${_escape(refund.refundNumber)}</b> · ${_formatDateTime(refund.occurredAt)}'
      '<br>Venta original: ${_escape(displaySaleFolio(sale.saleNumber))}'
      '${cashier == null ? '' : '<br>Cajero: ${_escape(cashier.displayName)}'}'
      '</div>'
      '<hr class="divider">'
      '<table>$itemsRowsHtml</table>'
      '<hr class="divider">'
      '<table class="totals">'
      '<tr><td>Subtotal</td><td class="amount">${_money(refund.subtotal, currency)}</td></tr>'
      '<tr><td>IVA</td><td class="amount">${_money(refund.taxTotal, currency)}</td></tr>'
      '<tr class="total-row"><td>TOTAL</td><td class="amount">${_money(refund.total, currency)}</td></tr>'
      '</table>'
      '<hr class="divider">'
      '<table class="kv">${reasonRows.toString()}</table>'
      '<hr class="divider">'
      '<div class="footer">'
      '${_escape('Comprobante de devolución — no es un comprobante fiscal (CFDI).')}'
      '</div>'
      '<div class="print-action">'
      '<button onclick="window.print()">🖨️ Imprimir</button>'
      '</div>'
      '</body></html>';
}
