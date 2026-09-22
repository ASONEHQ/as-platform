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

// TASK 16.9 — real 80mm physical print QA found the previous
// `paperWidthMm - 6` assumption (74mm of "safe" content on 80mm paper)
// still let real printer-driver margins clip content: `@page` margin is a
// REQUEST, not a guarantee, and a driver's own hardware-reported
// printable area can be narrower than what the CSS asked for. 72mm is
// the printable width most common 80mm thermal printers (the
// Epson TM-T20/TM-88 family and the generic ESC/POS "80mm" class this
// platform is being certified against) actually document; 48mm mirrors
// the same real-hardware convention for a future 58mm roll (58mm paper,
// ~48mm printable is the equivalent common spec for that class of
// printer) — kept as its own explicit case rather than a blind
// percentage-of-paperWidthMm formula, so a genuine 58mm certification
// pass can verify/adjust it independently without touching the 80mm
// value this task actually certifies. Anything else falls back to a
// conservative 8mm total margin.
double _safeContentWidthMm(double paperWidthMm) {
  if (paperWidthMm >= 76) return 72;
  if (paperWidthMm >= 54) return 48;
  return paperWidthMm - 8;
}

// TASK 16.9 — the backend's own `quantity` column is a fixed 6-decimal
// string (`"2.000000"`, or `"2.350000"` for a real weight-based line —
// TASK 14.3 Wave 1 Part B.3), never meant to be shown to a customer
// verbatim. Pure string trimming, never `double.parse` (ADR-0001's own
// "never binary floating point for anything money-adjacent" discipline
// extends here defensively, even though a quantity is a count/weight, not
// money) — a malformed value (no decimal point at all) is returned
// completely unchanged rather than risk mangling it.
String _formatQuantity(String quantity) {
  if (!quantity.contains('.')) return quantity;
  var trimmed = quantity;
  while (trimmed.endsWith('0')) {
    trimmed = trimmed.substring(0, trimmed.length - 1);
  }
  if (trimmed.endsWith('.')) trimmed = trimmed.substring(0, trimmed.length - 1);
  return trimmed;
}

/// Renders [receipt] as a full HTML document string.
///
/// [paperWidthMm] drives the CSS `@page` size — 80mm is the required
/// target; a future 58mm layout is simply a different value here (see
/// ADR-0012's "80mm target, 58mm-ready"). The actual CONTENT width is a
/// separate, deliberately more conservative value (see
/// `_safeContentWidthMm`'s own doc comment — TASK 16.9's real hardware
/// certification) — never assume the full nominal paper width is
/// actually printable.
/// [logoDataUri], when supplied, must already be a complete `data:`
/// URI (e.g. from the bundled `assets/branding/access_go_logo.png`) — this
/// function never fetches or reads a file itself, and never accepts a
/// bare filesystem path.
/// [customerDisplayName], when given, is rendered as one extra line under
/// the folio/cajero meta block — TASK 13.0 (ADR-0017 Part AB/D6). Deliberately
/// a plain caller-supplied `String?`, never read off [receipt] itself: the
/// backend's own `GET /sales/{id}/receipt` response carries no customer
/// field at all (unlike `GET /sales`/`GET /sales/{id}`), so a caller
/// threads the sale's already-known `customer_display_name` (from
/// [SaleSession] right after checkout, or from the `PosSaleSummary` row
/// that opened a reprint) through here instead. `null` renders the
/// receipt byte-identical to before this task — never phone, email, or
/// birth date, per Part AB.
/// [note], when given, is rendered as one extra line beneath the payment
/// section — TASK 14.3 (Wave 1, Part B.4). Deliberately a plain
/// caller-supplied `String?`, never read off [receipt] itself: the
/// backend's own `GET /sales/{id}/receipt` response carries no `note`
/// field (unlike `POST /sales`'s own response — see
/// `PosSaleCreated.note`), mirroring [customerDisplayName]'s own
/// identical precedent above. `null`/empty renders the receipt
/// byte-identical to before this task.
/// [headerText]/[footerText], when given, render the tenant's own
/// configurable receipt branding text (TASK 14.5, Wave 3, Phase 8) — the
/// real, persisted `receipts.header_text`/`receipts.footer_text` company/
/// branch settings (`settings.catalog.ts`), resolved via
/// `GET /companies/{id}/settings/effective` (or the branch equivalent) and
/// threaded through by the caller exactly like [customerDisplayName]/
/// [note] above: this function never fetches settings itself. [headerText]
/// renders as one extra centered line directly under the business name/
/// branch line; [footerText] renders as one extra centered block above the
/// fixed "¡Gracias por tu compra!" line. `null`/empty renders neither —
/// never a placeholder string — so a tenant that has not configured this
/// setting gets a receipt byte-identical to before this task.
String buildReceiptHtml({
  required PosReceipt receipt,
  String? logoDataUri,
  double paperWidthMm = 80,
  String? customerDisplayName,
  String? note,
  String? headerText,
  String? footerText,
}) {
  final sale = receipt.sale;
  final business = receipt.business;
  final cashier = receipt.cashier;
  final currency = sale.currencyCode;
  final contentWidthMm = _safeContentWidthMm(paperWidthMm);

  final logoHtml = logoDataUri == null
      ? ''
      : '<img class="logo" src="${_escape(logoDataUri)}" alt="Logo">';

  final businessNameHtml = _escape(business?.companyName ?? 'AS ONE POS');
  final branchLineParts = <String>[
    if (business != null) business.branchName,
    if (business?.branchAddress?['line1'] is String) business!.branchAddress!['line1']! as String,
  ];
  final branchLineHtml = branchLineParts.isEmpty ? '' : _escape(branchLineParts.join(' · '));

  // TASK 14.5 (Wave 3, Phase 8): the tenant's own configurable header/
  // footer branding text — see this function's own doc comment. Trimmed
  // and re-checked for emptiness here (not just by the caller) so a
  // whitespace-only setting value renders exactly like an unset one.
  final trimmedHeaderText = headerText?.trim() ?? '';
  final trimmedFooterText = footerText?.trim() ?? '';
  final headerTextHtml = trimmedHeaderText.isEmpty
      ? ''
      : '<div class="sub tenant-header">${_escape(trimmedHeaderText)}</div>';
  final footerTextHtml = trimmedFooterText.isEmpty
      ? ''
      : '<div class="tenant-footer">${_escape(trimmedFooterText)}</div>';

  // TASK 12.9: a per-line "PROMO/CUPÓN/DESC." discount row directly under
  // the item it reduced — only ever rendered when that line's own
  // `discount_total` (real since this task; always `"0.0000"` before it)
  // is nonzero, so a legacy/undiscounted receipt renders byte-identical
  // to before (ADR-0016 D14).
  //
  // TASK 16.9: a quantity of exactly 1 unit renders exactly as before
  // (name + line total on the same row — the common case, and the exact
  // shape every pre-existing test already pins). A real quantity greater
  // than 1 adds a second, muted row directly beneath the product name —
  // "{quantity} x {unit price}" on the left, the same line total on the
  // right — mirroring a real paper receipt's own convention and using
  // only already-persisted, frozen snapshot values (`unitPrice`/
  // `quantity`/`lineTotal`), never a client-invented figure.
  final itemsRowsHtml = receipt.items.isEmpty
      ? '<tr><td colspan="2" class="muted">Sin artículos</td></tr>'
      : receipt.items
            .map((item) {
              final isSingleUnit = item.quantity == '1.000000';
              final nameRow = '<tr>'
                  '<td class="item-name">${_escape(item.nameSnapshot)}</td>'
                  '<td class="amount">${isSingleUnit ? _money(item.lineTotal, currency) : ''}</td>'
                  '</tr>';
              final qtyRow = isSingleUnit
                  ? ''
                  : '<tr class="qty-row">'
                        '<td class="item-qty muted">${_formatQuantity(item.quantity)} x ${_money(item.unitPrice, currency)}</td>'
                        '<td class="amount">${_money(item.lineTotal, currency)}</td>'
                        '</tr>';
              final discountRow = _isNonZeroAmount(item.discountTotal)
                  ? '<tr class="discount-row">'
                        '<td class="item-name muted">Descuento</td>'
                        '<td class="amount muted">-${_money(item.discountTotal, currency)}</td>'
                        '</tr>'
                  : '';
              return nameRow + qtyRow + discountRow;
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

  // TASK 16.21 (Phase 20) — summed across every line the membership
  // benefit discounted (never just the first one), using the backend's
  // own label — falls back to the plain "Membresía" the backend always
  // sends anyway, never a fabricated one, and is simply absent from the
  // receipt entirely when the sale had no membership benefit.
  final membershipDiscounts = receipt.membershipDiscounts;
  String membershipDiscountRowHtml = '';
  if (membershipDiscounts.isNotEmpty) {
    var sum = Money.zero(currency);
    for (final entry in membershipDiscounts) {
      try {
        sum = sum + Money.parse(entry.amount, currency);
      } on MoneyFormatException {
        // A malformed single entry never blocks the rest of the receipt.
      }
    }
    final label = membershipDiscounts.first.label;
    membershipDiscountRowHtml =
        '<tr><td>${_escape(label)}</td><td class="amount">-\$${sum.toDisplayString()}</td></tr>';
  }

  return '<!DOCTYPE html><html><head><meta charset="UTF-8">'
      '<title>Ticket ${_escape(sale.saleNumber)}</title>'
      '<style>'
      // TASK 16.9 — real 80mm hardware certification. `margin:0` here
      // deliberately claims the FULL nominal paper width for the page box
      // — the horizontal safety inset lives entirely in `body`'s own
      // `width`/`margin:0 auto` below instead of relying on the printer
      // driver's own (inconsistent, request-not-guarantee) interpretation
      // of an `@page` margin. That single, browser-computed centering
      // rule is what actually determines the printed inset, on screen and
      // on paper alike — never two independent inset mechanisms stacked
      // on top of each other (the previous `@page margin:3mm` PLUS a
      // separately-computed `body` width was exactly that double
      // bookkeeping, and real print QA showed the two disagreeing with
      // the printer's actual printable area).
      '@page{size:${paperWidthMm}mm auto;margin:0}'
      '*{margin:0;padding:0;box-sizing:border-box}'
      'html,body{background:#fff}'
      'body{font-family:"Courier New",Courier,monospace;font-size:12px;color:#000;'
      'width:${contentWidthMm}mm;max-width:${contentWidthMm}mm;margin:0 auto;padding:3mm 0 4mm;'
      '-webkit-print-color-adjust:exact;print-color-adjust:exact}'
      // TASK 16.9: real print QA found the tenant logo printed very faint
      // — a photo-quality/anti-aliased source image dithers into a washed-
      // out, low-contrast pattern on a low-density thermal head.
      // `grayscale`+`contrast` push mid-tone pixels toward pure
      // black/white BEFORE the browser rasterizes for print, giving the
      // printer driver's own dithering algorithm a much more binary
      // source to work from; `print-color-adjust:exact` stops the browser
      // from independently lightening it for print; `crisp-edges` avoids
      // a soft/blurry scale that would only make dithering worse. Sized
      // in `mm` (not `px`) so it scales with the physical page exactly
      // like every other dimension on this ticket, never a separate unit
      // system that could scale inconsistently across browsers/drivers.
      '.logo{display:block;margin:0 auto 4px;max-height:16mm;max-width:${contentWidthMm}mm;'
      'image-rendering:crisp-edges;filter:grayscale(1) contrast(1.6);'
      '-webkit-print-color-adjust:exact;print-color-adjust:exact}'
      'h1{text-align:center;font-size:15px;margin-bottom:2px;font-weight:700}'
      '.sub{text-align:center;font-size:10px;color:#333;margin-bottom:8px}'
      '.tenant-header{white-space:pre-line;overflow-wrap:anywhere}'
      '.divider{border:none;border-top:1px dashed #000;margin:6px 0}'
      // `table-layout:fixed` + a fixed percentage on `.amount` is what
      // actually guarantees "nothing may be horizontally clipped" for a
      // monetary figure (TASK 16.9's own hard requirement): every table
      // on this ticket is exactly two columns (label/name, amount), so
      // reserving a fixed share for the amount column means it can never
      // shrink to accommodate a long label/product name — the NAME column
      // wraps instead (via `.item-name`'s own `word-break`/`overflow-wrap`
      // below), never the amount. Auto table layout (the previous
      // behavior) sizes columns from content, which is exactly how real
      // print QA saw an amount partially clipped alongside a long enough
      // label.
      'table{width:100%;border-collapse:collapse;table-layout:fixed}'
      'td{padding:2px 0;vertical-align:top}'
      '.item-name{word-break:break-word;overflow-wrap:anywhere;padding-right:6px}'
      // TASK 16.9: a real quantity greater than 1 — "{qty} x {unit
      // price}" — directly beneath the product name; see `buildReceiptHtml`
      // itself for the row-building logic. Muted/smaller like the
      // pre-existing `.discount-row` sub-detail convention.
      '.item-qty{font-size:11px;color:#555;padding-right:6px;overflow-wrap:anywhere}'
      '.discount-row td{font-size:11px}'
      '.amount{width:38%;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}'
      '.totals td{padding:1px 0}'
      '.total-row td{font-size:14px;font-weight:700;padding-top:4px;border-top:2px solid #000;'
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
      '.tenant-footer{text-align:center;font-size:10px;color:#333;margin-top:6px;'
      'line-height:1.4;white-space:pre-line;overflow-wrap:anywhere}'
      '.print-action{text-align:center;margin-top:14px}'
      '.print-action button{padding:8px 20px;font-size:13px;cursor:pointer}'
      '@media print{.print-action{display:none!important}}'
      '</style></head>'
      '<body>'
      '$logoHtml'
      '<h1>$businessNameHtml</h1>'
      '${branchLineHtml.isEmpty ? '' : '<div class="sub">$branchLineHtml</div>'}'
      '$headerTextHtml'
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
      // TASK 13.0: a name only — never phone/email/birth date (Part AB).
      '${customerDisplayName == null || customerDisplayName.isEmpty ? '' : '<br>Cliente: ${_escape(customerDisplayName)}'}'
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
      // TASK 16.21 (Phase 20 "Receipt") — a membership benefit shown
      // CLEARLY, as its own sub-line under the generic "Descuentos"
      // aggregate above, never merged into it invisibly and never an
      // internal id — just the backend's own snapshotted label/amount,
      // summed across however many lines it discounted (Phase 4's own
      // worked example: a plan can discount more than one eligible
      // line). Absent entirely for a sale with no membership benefit.
      '$membershipDiscountRowHtml'
      '<tr><td>IVA</td><td class="amount">${_money(sale.taxTotal, currency)}</td></tr>'
      '<tr class="total-row"><td>TOTAL</td><td class="amount">${_money(sale.total, currency)}</td></tr>'
      '</table>'
      '<hr class="divider">'
      '$paymentHtml'
      // TASK 14.3 (Wave 1, Part B.4): a real, non-empty note only — never
      // an empty placeholder line.
      '${note == null || note.isEmpty ? '' : '<hr class="divider"><div class="meta">Nota: ${_escape(note)}</div>'}'
      '<hr class="divider">'
      '$footerTextHtml'
      '<div class="footer">'
      '¡Gracias por tu compra!<br>'
      '${_escape(_cfdiDisclaimer)}'
      '</div>'
      '<div class="print-action">'
      '<button onclick="window.print()">🖨️ Imprimir</button>'
      '</div>'
      '</body></html>';
}
