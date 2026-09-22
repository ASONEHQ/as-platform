import 'dart:io';

import 'package:as_one/features/pos/pos_receipt.dart';
import 'package:as_one/features/pos/receipt_html.dart';
import 'package:flutter_test/flutter_test.dart';

/// TASK 12.5B: PRINT VALIDATION — [buildReceiptHtml] is pure string
/// building (no Flutter widget tree, no browser API), so this generates
/// and inspects the actual print HTML on the Dart VM, exactly per the
/// task's own "no physical printer hardware required" instruction.
void main() {
  PosReceipt receipt({String? longName, int itemCount = 1}) => PosReceipt(
    sale: PosReceiptSale(
      id: 'sale-1',
      saleNumber: 'SALE-abc123',
      status: 'completed',
      currencyCode: 'MXN',
      branchId: 'branch-1',
      occurredAt: DateTime.utc(2026, 8, 1, 18, 30),
      completedAt: DateTime.utc(2026, 8, 1, 18, 32),
      subtotal: '100.0000',
      discountTotal: '0.0000',
      taxTotal: '16.0000',
      total: '116.0000',
    ),
    business: const PosReceiptBusiness(
      companyName: 'AS ONE Demo Co.',
      branchName: 'Sucursal Centro',
      branchAddress: {'line1': 'Av. Siempre Viva 123'},
    ),
    cashier: const PosReceiptCashier(id: 'user-1', displayName: 'Ana Cajera'),
    items: [
      for (var i = 0; i < itemCount; i++)
        PosReceiptItem(
          lineNumber: i + 1,
          nameSnapshot: longName ?? 'Producto $i',
          skuSnapshot: 'SKU-$i',
          quantity: '2.000000',
          unitPrice: '50.0000',
          discountTotal: '0.0000',
          taxTotal: '16.0000',
          lineTotal: '116.0000',
        ),
    ],
    payments: const [
      PosReceiptPayment(
        id: 'payment-1',
        paymentMethod: 'cash',
        status: 'captured',
        amount: '116.0000',
        currencyCode: 'MXN',
        capturedAt: null,
        tenderedAmount: '120.0000',
        changeAmount: '4.0000',
        provider: null,
        terminalId: null,
        providerReference: null,
      ),
    ],
  );

  test('targets 80mm by default via a real CSS @page rule, and a conservative, real-hardware-verified '
      'content width (TASK 16.9) — never the full nominal paper width', () {
    final html = buildReceiptHtml(receipt: receipt());
    expect(html, contains('@page{size:80.0mm auto;margin:0}'));
    // 72mm — not 74mm (paperWidthMm - 6) — real 80mm print QA found that
    // more optimistic figure still clipped against a real printer
    // driver's own non-printable margins.
    expect(html, contains('width:72.0mm'));
  });

  test('a different paperWidthMm cheaply retargets the page — 58mm-ready per ADR-0012', () {
    final html = buildReceiptHtml(receipt: receipt(), paperWidthMm: 58);
    expect(html, contains('@page{size:58.0mm auto;margin:0}'));
    expect(html, contains('width:48.0mm'));
  });

  test('renders exact backend totals, never clipped or re-derived — subtotal, IVA, and TOTAL all present', () {
    final html = buildReceiptHtml(receipt: receipt());
    expect(html, contains(r'$100.00')); // subtotal
    expect(html, contains(r'$16.00')); // IVA
    expect(html, contains(r'$116.00')); // total
    expect(html, contains('TOTAL'));
    // The amount column is right-aligned/tabular so totals line up —
    // never left-aligned free text.
    expect(html, contains('class="amount"'));
    expect(html, contains('font-variant-numeric:tabular-nums'));
  });

  test('shows the cash tender and exact backend change — never recomputed', () {
    final html = buildReceiptHtml(receipt: receipt());
    expect(html, contains(r'$120.00')); // efectivo recibido
    expect(html, contains(r'$4.00')); // cambio
    expect(html, contains('Efectivo'));
  });

  test('a long item name gets a wrap-safe cell, never a fixed-width clip', () {
    final html = buildReceiptHtml(
      receipt: receipt(longName: 'Paquete de globos metálicos personalizados con listón dorado XL'),
    );
    expect(html, contains('Paquete de globos metálicos personalizados con listón dorado XL'));
    expect(html, contains('word-break:break-word'));
    // No fixed pixel width or `nowrap`/`overflow:hidden` on the name cell
    // that would clip a long name instead of wrapping it.
    expect(html, isNot(contains('.item-name{width')));
  });

  test('contains no POS chrome at all — no sidebar/navigation/Cobrar/module strings', () {
    final html = buildReceiptHtml(receipt: receipt());
    for (final forbidden in ['Sidebar', 'sidebar', 'Cobrar', 'CAJERO', 'CLIENTE', 'Punto de Venta', 'nav-']) {
      expect(html, isNot(contains(forbidden)), reason: '"$forbidden" must never appear in print output');
    }
  });

  test('the on-screen print button is excluded from the actual printed page via @media print', () {
    final html = buildReceiptHtml(receipt: receipt());
    expect(html, contains('print-action'));
    expect(html, contains('@media print{.print-action{display:none!important}'));
  });

  test('never claims to be a CFDI/tax invoice and invents no fiscal identifiers', () {
    final html = buildReceiptHtml(receipt: receipt());
    expect(html, contains('no es un comprobante fiscal'));
    for (final forbidden in ['CFDI:', 'sello', 'cadena original', 'RFC:', 'UUID']) {
      expect(html, isNot(contains(forbidden)));
    }
  });

  test('never renders a bare filesystem path for the logo — only an already-built data URI, or none', () {
    final withoutLogo = buildReceiptHtml(receipt: receipt());
    expect(withoutLogo, isNot(contains('C:\\')));
    expect(withoutLogo, isNot(contains('<img')));

    final withLogo = buildReceiptHtml(receipt: receipt(), logoDataUri: 'data:image/png;base64,QUJD');
    expect(withLogo, contains('<img class="logo" src="data:image/png;base64,QUJD"'));
  });

  test('never prints a provider_reference, terminal id, or provider payload for a cash payment', () {
    final html = buildReceiptHtml(receipt: receipt());
    // The fixture's only payment is cash — nothing card/provider-shaped
    // should appear anywhere in the output.
    expect(html, isNot(contains('Referencia')));
    expect(html, isNot(contains('mercado_pago')));
  });

  test('shows a safe provider reference for a real captured card payment — never a fake placeholder', () {
    final base = receipt();
    final withCard = PosReceipt(
      sale: base.sale,
      business: base.business,
      cashier: base.cashier,
      items: base.items,
      payments: const [
        PosReceiptPayment(
          id: 'payment-2',
          paymentMethod: 'card_terminal',
          status: 'captured',
          amount: '116.0000',
          currencyCode: 'MXN',
          capturedAt: null,
          tenderedAmount: null,
          changeAmount: null,
          provider: 'mercado_pago',
          terminalId: 'terminal-1',
          providerReference: 'order-safe-ref-123',
        ),
      ],
    );
    final html = buildReceiptHtml(receipt: withCard);
    expect(html, contains('Tarjeta'));
    expect(html, contains('order-safe-ref-123'));
    // Still no tendered/change section for a non-cash payment.
    expect(html, isNot(contains('Efectivo recibido')));
  });

  test('escapes item names and business text — no raw HTML injection from a snapshot value', () {
    final html = buildReceiptHtml(receipt: receipt(longName: '<script>evil()</script> & "quoted"'));
    expect(html, isNot(contains('<script>evil()</script>')));
    expect(html, contains('&lt;script&gt;'));
    expect(html, contains('&amp;'));
  });

  group('TASK 12.9 — discount lines', () {
    test('never renders a Descuento line for a zero-discount sale (legacy/undiscounted, ADR-0016 D14)', () {
      final html = buildReceiptHtml(receipt: receipt());
      expect(html, isNot(contains('Descuento')));
    });

    test('renders a Descuento total row and a per-line discount row for a real, nonzero discount', () {
      final discounted = PosReceipt(
        sale: PosReceiptSale(
          id: 'sale-1',
          saleNumber: 'SALE-discount',
          status: 'completed',
          currencyCode: 'MXN',
          branchId: 'branch-1',
          occurredAt: DateTime.utc(2026, 9, 4),
          completedAt: DateTime.utc(2026, 9, 4, 0, 1),
          subtotal: '100.0000',
          discountTotal: '10.0000',
          taxTotal: '14.4000',
          total: '104.4000',
        ),
        business: const PosReceiptBusiness(
          companyName: 'AS ONE Demo Co.',
          branchName: 'Sucursal Centro',
          branchAddress: null,
        ),
        cashier: const PosReceiptCashier(id: 'user-1', displayName: 'Ana Cajera'),
        items: const [
          PosReceiptItem(
            lineNumber: 1,
            nameSnapshot: 'Entrada General',
            skuSnapshot: 'SKU-1',
            quantity: '1.000000',
            unitPrice: '100.0000',
            discountTotal: '10.0000',
            taxTotal: '14.4000',
            lineTotal: '104.4000',
          ),
        ],
        payments: const [
          PosReceiptPayment(
            id: 'payment-1',
            paymentMethod: 'cash',
            status: 'captured',
            amount: '104.4000',
            currencyCode: 'MXN',
            capturedAt: null,
            tenderedAmount: '110.0000',
            changeAmount: '5.6000',
            provider: null,
            terminalId: null,
            providerReference: null,
          ),
        ],
      );
      final html = buildReceiptHtml(receipt: discounted);
      expect(html, contains('Descuento'));
      expect(html, contains(r'-$10.00'));
      expect(html, contains(r'$104.40')); // TOTAL, never recomputed
    });
  });

  group('TASK 16.21 — membership benefit line (Phase 20 "show membership benefit clearly")', () {
    PosReceipt withDiscounts(List<PosReceiptDiscount> discounts) => PosReceipt(
      sale: PosReceiptSale(
        id: 'sale-1',
        saleNumber: 'SALE-membership',
        status: 'completed',
        currencyCode: 'MXN',
        branchId: 'branch-1',
        occurredAt: DateTime.utc(2026, 9, 4),
        completedAt: DateTime.utc(2026, 9, 4, 0, 1),
        subtotal: '200.0000',
        discountTotal: '10.0000',
        taxTotal: '0.0000',
        total: '190.0000',
      ),
      business: const PosReceiptBusiness(companyName: 'AS ONE Demo Co.', branchName: 'Sucursal Centro', branchAddress: null),
      cashier: const PosReceiptCashier(id: 'user-1', displayName: 'Ana Cajera'),
      items: const [
        PosReceiptItem(
          lineNumber: 1,
          nameSnapshot: 'Producto A',
          skuSnapshot: 'SKU-A',
          quantity: '1.000000',
          unitPrice: '100.0000',
          discountTotal: '10.0000',
          taxTotal: '0.0000',
          lineTotal: '90.0000',
        ),
        PosReceiptItem(
          lineNumber: 2,
          nameSnapshot: 'Producto B',
          skuSnapshot: 'SKU-B',
          quantity: '1.000000',
          unitPrice: '100.0000',
          discountTotal: '0.0000',
          taxTotal: '0.0000',
          lineTotal: '100.0000',
        ),
      ],
      payments: const [
        PosReceiptPayment(
          id: 'payment-1',
          paymentMethod: 'cash',
          status: 'captured',
          amount: '190.0000',
          currencyCode: 'MXN',
          capturedAt: null,
          tenderedAmount: '200.0000',
          changeAmount: '10.0000',
          provider: null,
          terminalId: null,
          providerReference: null,
        ),
      ],
      discounts: discounts,
    );

    test('a membership-sourced discount renders its own labeled line, using the backend\'s own snapshotted label', () {
      final html = buildReceiptHtml(
        receipt: withDiscounts(const [
          PosReceiptDiscount(saleItemId: 'item-1', sourceType: 'membership', label: 'Membresía', amount: '10.0000'),
        ]),
      );
      expect(html, contains('Membresía'));
      expect(html, contains(r'-$10.00'));
    });

    test('sums membership discount amounts across every eligible line into one displayed total', () {
      final html = buildReceiptHtml(
        receipt: withDiscounts(const [
          PosReceiptDiscount(saleItemId: 'item-1', sourceType: 'membership', label: 'Membresía', amount: '6.0000'),
          PosReceiptDiscount(saleItemId: 'item-2', sourceType: 'membership', label: 'Membresía', amount: '4.0000'),
        ]),
      );
      expect(html, contains(r'-$10.00'));
    });

    test('never shows a membership line for a non-membership discount (promotion/coupon)', () {
      final html = buildReceiptHtml(
        receipt: withDiscounts(const [
          PosReceiptDiscount(saleItemId: 'item-1', sourceType: 'promotion', label: 'Promoción', amount: '10.0000'),
        ]),
      );
      expect(html, isNot(contains('Membresía')));
    });

    test('no discounts at all renders no membership line, byte-identical to before this task', () {
      final html = buildReceiptHtml(receipt: withDiscounts(const []));
      expect(html, isNot(contains('Membresía')));
    });
  });

  group('TASK 12.5B.1 — folio and 80mm polish', () {
    PosReceipt realQaReceipt() => PosReceipt(
      sale: PosReceiptSale(
        id: '2517abd7-3ecf-44a2-b220-6f4eadfeee49',
        // The real TASK 12.5B QA sale number — 37 characters, the exact
        // shape real 80mm print QA showed wrapping across lines.
        saleNumber: 'SALE-2517abd73ecf44a2b2206f4eadfeee49',
        status: 'completed',
        currencyCode: 'MXN',
        branchId: 'branch-plv',
        occurredAt: DateTime.utc(2026, 9, 3, 12, 0),
        completedAt: DateTime.utc(2026, 9, 3, 12, 1),
        subtotal: '25.0000',
        discountTotal: '0.0000',
        taxTotal: '4.0000',
        total: '29.0000',
      ),
      business: const PosReceiptBusiness(
        companyName: 'Inflapark Group',
        branchName: 'Puerta La Victoria',
        branchAddress: null,
      ),
      cashier: const PosReceiptCashier(id: 'user-1', displayName: 'Bryant Aguilera Sánchez'),
      items: const [
        PosReceiptItem(
          lineNumber: 1,
          nameSnapshot: 'Agua',
          skuSnapshot: 'AGUA-1',
          quantity: '1.000000',
          unitPrice: '25.0000',
          discountTotal: '0.0000',
          taxTotal: '4.0000',
          lineTotal: '29.0000',
        ),
      ],
      payments: const [
        PosReceiptPayment(
          id: 'payment-1',
          paymentMethod: 'cash',
          status: 'captured',
          amount: '29.0000',
          currencyCode: 'MXN',
          capturedAt: null,
          tenderedAmount: '50.0000',
          changeAmount: '21.0000',
          provider: null,
          terminalId: null,
          providerReference: null,
        ),
      ],
    );

    test('prints the real \$25/\$4/\$29/\$50/\$21 QA shape exactly, never recomputed', () {
      final html = buildReceiptHtml(receipt: realQaReceipt());
      expect(html, contains(r'$25.00')); // subtotal
      expect(html, contains(r'$4.00')); // IVA
      expect(html, contains(r'$29.00')); // TOTAL and monto aplicado
      expect(html, contains(r'$50.00')); // efectivo recibido
      expect(html, contains(r'$21.00')); // cambio
    });

    test('the printed folio is the short display folio, not the 37-char canonical value', () {
      final html = buildReceiptHtml(receipt: realQaReceipt());
      expect(html, contains('Folio SALE-ADFEEE49'));
      // The full canonical value never appears in the printed body — only
      // (harmlessly) in the non-printed document <title>.
      final bodyStart = html.indexOf('<body>');
      expect(
        html.substring(bodyStart),
        isNot(contains('SALE-2517abd73ecf44a2b2206f4eadfeee49')),
      );
      // ...but the canonical reference is still the (unprinted) tab title.
      expect(html, contains('<title>Ticket SALE-2517abd73ecf44a2b2206f4eadfeee49</title>'));
    });

    test('the folio line wraps safely instead of overflowing for any unexpectedly long value', () {
      final html = buildReceiptHtml(receipt: realQaReceipt());
      expect(html, contains('overflow-wrap:anywhere'));
    });

    test('monetary figures in the payment section share the same right-aligned, tabular-nums '
        'column as the items/totals tables — Cambio gets TOTAL-equivalent emphasis', () {
      final html = buildReceiptHtml(receipt: realQaReceipt());
      expect(html, contains('class="kv payment-block"'));
      expect(html, contains('class="change-row"'));
      // Cambio's own amount cell is still the shared `.amount` (right
      // aligned/tabular) cell, like every other monetary figure.
      expect(html, contains('<tr class="change-row"><td>Cambio</td><td class="amount">'));
    });

    test('cash receipt remains payment-method aware — a card payment never shows tendered/change', () {
      final cashHtml = buildReceiptHtml(receipt: realQaReceipt());
      expect(cashHtml, contains('Efectivo'));
      expect(cashHtml, contains('Efectivo recibido'));

      final base = realQaReceipt();
      final cardHtml = buildReceiptHtml(
        receipt: PosReceipt(
          sale: base.sale,
          business: base.business,
          cashier: base.cashier,
          items: base.items,
          payments: const [
            PosReceiptPayment(
              id: 'payment-2',
              paymentMethod: 'card_terminal',
              status: 'captured',
              amount: '29.0000',
              currencyCode: 'MXN',
              capturedAt: null,
              tenderedAmount: null,
              changeAmount: null,
              provider: 'mercado_pago',
              terminalId: 'terminal-1',
              providerReference: 'order-safe-ref-456',
            ),
          ],
        ),
      );
      expect(cardHtml, contains('Tarjeta'));
      expect(cardHtml, isNot(contains('Efectivo recibido')));
      expect(cardHtml, isNot(contains('Cambio')));
    });
  });

  group('TASK 13.0 — customer name on the receipt', () {
    test('renders no Cliente line at all when customerDisplayName is omitted — '
        'a walk-in sale prints byte-identical to before this task (ADR-0017 D6)', () {
      final html = buildReceiptHtml(receipt: receipt());
      expect(html, isNot(contains('Cliente:')));
    });

    test('renders the customer name under the folio/cajero meta block when given', () {
      final html = buildReceiptHtml(receipt: receipt(), customerDisplayName: 'Ana Pérez');
      expect(html, contains('Cliente: Ana Pérez'));
    });

    test('never renders phone, email, or birth date — the caller only ever supplies a name '
        '(Part AB) — and the name is HTML-escaped like every other snapshot value', () {
      final html = buildReceiptHtml(receipt: receipt(), customerDisplayName: '<b>Ana</b> & Cía');
      expect(html, contains('Cliente: &lt;b&gt;Ana&lt;/b&gt; &amp; Cía'));
      expect(html, isNot(contains('<b>Ana</b>')));
    });

    test('an empty customerDisplayName renders nothing extra, never a bare "Cliente:" label', () {
      final html = buildReceiptHtml(receipt: receipt(), customerDisplayName: '');
      expect(html, isNot(contains('Cliente:')));
    });
  });

  group('TASK 14.5 (Wave 3, Phase 8) — tenant header/footer branding text', () {
    test('renders no tenant-header/tenant-footer DIV at all when both are omitted — '
        'byte-identical to before this task for a tenant that never configured this '
        '(the static .tenant-header/.tenant-footer CSS rules stay in the stylesheet '
        'either way — only the rendered content block is conditional)', () {
      final html = buildReceiptHtml(receipt: receipt());
      expect(html, isNot(contains('class="sub tenant-header"')));
      expect(html, isNot(contains('class="tenant-footer"')));
    });

    test('renders the header text under the business/branch line, before the first divider', () {
      final html = buildReceiptHtml(receipt: receipt(), headerText: 'Sucursal Centro');
      expect(html, contains('<div class="sub tenant-header">Sucursal Centro</div>'));
      final businessIndex = html.indexOf('AS ONE Demo Co.');
      final headerBlockIndex = html.indexOf('<div class="sub tenant-header">');
      final firstDividerIndex = html.indexOf('<hr class="divider">');
      expect(businessIndex, lessThan(headerBlockIndex));
      expect(headerBlockIndex, lessThan(firstDividerIndex));
    });

    test('renders the footer text above the fixed "¡Gracias por tu compra!" line', () {
      final html = buildReceiptHtml(receipt: receipt(), footerText: 'Cambios en 7 días con ticket.');
      expect(html, contains('<div class="tenant-footer">Cambios en 7 días con ticket.</div>'));
      final footerBlockIndex = html.indexOf('<div class="tenant-footer">');
      final thanksIndex = html.indexOf('¡Gracias por tu compra!');
      expect(footerBlockIndex, lessThan(thanksIndex));
    });

    test('an empty or whitespace-only header/footer renders nothing extra, never a blank block', () {
      final html = buildReceiptHtml(receipt: receipt(), headerText: '   ', footerText: '');
      expect(html, isNot(contains('class="sub tenant-header"')));
      expect(html, isNot(contains('class="tenant-footer"')));
    });

    test('header and footer text are HTML-escaped like every other tenant-supplied value', () {
      final html = buildReceiptHtml(
        receipt: receipt(),
        headerText: '<b>Hola</b> & bienvenido',
        footerText: '<script>alert(1)</script>',
      );
      expect(html, contains('&lt;b&gt;Hola&lt;/b&gt; &amp; bienvenido'));
      expect(html, contains('&lt;script&gt;alert(1)&lt;/script&gt;'));
      expect(html, isNot(contains('<b>Hola</b>')));
      expect(html, isNot(contains('<script>alert(1)</script>')));
    });
  });

  group('TASK 16.9 — real 80mm physical thermal print certification', () {
    test('carries real thermal print CSS: an explicit @page rule, print-color-adjust for faithful '
        'monochrome output, and @media print to hide the on-screen-only print button', () {
      final html = buildReceiptHtml(receipt: receipt());
      expect(html, contains('@page{size:80.0mm auto'));
      expect(html, contains('-webkit-print-color-adjust:exact'));
      expect(html, contains('print-color-adjust:exact'));
      expect(html, contains('@media print{.print-action{display:none!important}}'));
    });

    test('the 80mm content width is a conservative, real-printable value — never the full nominal '
        'paper width, and never a desktop-viewport assumption', () {
      final html = buildReceiptHtml(receipt: receipt());
      // 72mm of 80mm nominal paper — real hardware margin, not 100% of
      // the paper claimed as printable.
      expect(html, contains('width:72.0mm'));
      expect(html, isNot(contains('width:80.0mm')));
      // No desktop-scale pixel width anywhere driving the page layout —
      // the whole document is dimensioned in `mm`, tied to the physical
      // page, never a fixed on-screen pixel viewport.
      expect(RegExp(r'width:\d+px').hasMatch(html), isFalse);
    });

    test('every monetary table uses a fixed table layout with a guaranteed amount-column width — '
        'the amount can never shrink to make room for a long label, only the label wraps', () {
      final html = buildReceiptHtml(receipt: receipt());
      expect(html, contains('table-layout:fixed'));
      expect(html, contains('.amount{width:38%'));
    });

    test('an extremely long product name still leaves the amount fully visible, never clipped, by '
        'wrapping the name instead of shrinking the reserved amount column', () {
      final html = buildReceiptHtml(
        receipt: receipt(
          longName: 'Paquete familiar todo incluido para cumpleaños infantil con decoración temática '
              'personalizada y servicio de mesero dedicado durante todo el evento',
        ),
      );
      expect(html, contains(r'$116.00'));
      expect(html, contains('overflow-wrap:anywhere'));
    });

    test('large, multi-digit amounts (5+ figures) print in full — never truncated or clipped', () {
      final bigReceipt = PosReceipt(
        sale: PosReceiptSale(
          id: 'sale-big',
          saleNumber: 'SALE-big000000000000000000000000000',
          status: 'completed',
          currencyCode: 'MXN',
          branchId: 'branch-1',
          occurredAt: DateTime.utc(2026, 9, 17, 10, 0),
          completedAt: DateTime.utc(2026, 9, 17, 10, 1),
          subtotal: '9482.7586',
          discountTotal: '0.0000',
          taxTotal: '1517.2414',
          total: '11000.0000',
        ),
        business: const PosReceiptBusiness(
          companyName: 'AS ONE Demo Co.',
          branchName: 'Sucursal Centro',
          branchAddress: null,
        ),
        cashier: const PosReceiptCashier(id: 'user-1', displayName: 'Ana Cajera'),
        items: const [
          PosReceiptItem(
            lineNumber: 1,
            nameSnapshot: 'Renta de salón',
            skuSnapshot: 'SALON-1',
            quantity: '1.000000',
            unitPrice: '11000.0000',
            discountTotal: '0.0000',
            taxTotal: '1517.2414',
            lineTotal: '11000.0000',
          ),
        ],
        payments: const [
          PosReceiptPayment(
            id: 'payment-1',
            paymentMethod: 'cash',
            status: 'captured',
            amount: '11000.0000',
            currencyCode: 'MXN',
            capturedAt: null,
            tenderedAmount: '15000.0000',
            changeAmount: '4000.0000',
            provider: null,
            terminalId: null,
            providerReference: null,
          ),
        ],
      );
      final html = buildReceiptHtml(receipt: bigReceipt);
      // TASK 16.9: verified against the real `Money.toDisplayString()`
      // this app's ENTIRE money display already relies on everywhere
      // (`money.dart`) before asserting — it does not insert thousands
      // separators today (no `NumberFormat`/grouping exists anywhere in
      // this codebase's money path). Adding one would be a cross-cutting
      // change to every money display in the app, not something this
      // hardware/CSS certification task should do — what actually matters
      // here is that a real 5-figure amount prints in full, unsplit,
      // regardless of separator style.
      expect(html, contains(r'$9482.76')); // subtotal, rounded half-up
      expect(html, contains(r'$1517.24')); // IVA
      expect(html, contains(r'$11000.00')); // TOTAL and line total
      expect(html, contains(r'$15000.00')); // efectivo recibido
      expect(html, contains(r'$4000.00')); // cambio
      // The amount column is `white-space:nowrap` — confirm a real
      // 5-digit amount is never split mid-string by anything this
      // function itself controls (the printer/driver is the only other
      // place a genuine physical clip could still happen).
      expect(html, isNot(contains('1100\n0')));
      expect(html, isNot(contains('1500\n0')));
    });

    test('a real quantity greater than 1 renders "{qty} x {unit price}" beneath the product name, '
        'using only already-persisted snapshot values — never a client-invented figure', () {
      final html = buildReceiptHtml(receipt: receipt()); // fixture quantity is 2.000000, unitPrice 50.0000
      expect(html, contains('class="item-qty muted">2 x \$50.00<'));
      expect(html, contains('class="qty-row"'));
    });

    test('a quantity of exactly 1 unit renders the classic single-row shape unchanged — no qty sub-row', () {
      final singleUnitHtml = buildReceiptHtml(
        receipt: PosReceipt(
          sale: PosReceiptSale(
            id: 'sale-1',
            saleNumber: 'SALE-single',
            status: 'completed',
            currencyCode: 'MXN',
            branchId: 'branch-1',
            occurredAt: DateTime.utc(2026, 9, 17),
            completedAt: DateTime.utc(2026, 9, 17, 0, 1),
            subtotal: '25.0000',
            discountTotal: '0.0000',
            taxTotal: '4.0000',
            total: '29.0000',
          ),
          business: const PosReceiptBusiness(
            companyName: 'AS ONE Demo Co.',
            branchName: 'Sucursal Centro',
            branchAddress: null,
          ),
          cashier: const PosReceiptCashier(id: 'user-1', displayName: 'Ana Cajera'),
          items: const [
            PosReceiptItem(
              lineNumber: 1,
              nameSnapshot: 'Agua',
              skuSnapshot: 'AGUA-1',
              quantity: '1.000000',
              unitPrice: '25.0000',
              discountTotal: '0.0000',
              taxTotal: '4.0000',
              lineTotal: '29.0000',
            ),
          ],
          payments: const [],
        ),
      );
      expect(singleUnitHtml, isNot(contains('class="qty-row"')));
      expect(singleUnitHtml, isNot(contains('class="item-qty')));
      expect(singleUnitHtml, contains('<title>Ticket'));
    });

    test('the tenant logo receives thermal-legible high-contrast treatment (grayscale + boosted '
        'contrast), never printed at its raw, potentially washed-out source contrast', () {
      final html = buildReceiptHtml(receipt: receipt(), logoDataUri: 'data:image/png;base64,QUJD');
      expect(html, contains('filter:grayscale(1) contrast(1.6)'));
      expect(html, contains('image-rendering:crisp-edges'));
    });

    test('no INFLAPARK-specific data ever appears for a different tenant\'s receipt — shared print '
        'logic carries no customer-specific hardcoding', () {
      final otherTenant = PosReceipt(
        sale: PosReceiptSale(
          id: 'sale-other',
          saleNumber: 'SALE-othertenant00000000000000000',
          status: 'completed',
          currencyCode: 'MXN',
          branchId: 'branch-other',
          occurredAt: DateTime.utc(2026, 9, 17),
          completedAt: DateTime.utc(2026, 9, 17, 0, 1),
          subtotal: '200.0000',
          discountTotal: '0.0000',
          taxTotal: '32.0000',
          total: '232.0000',
        ),
        business: const PosReceiptBusiness(
          companyName: 'Multi-Tenant Test Corp',
          branchName: 'Sucursal Alterna',
          branchAddress: {'line1': 'Calle Genérica 456'},
        ),
        cashier: const PosReceiptCashier(id: 'user-other', displayName: 'Otro Cajero'),
        items: const [
          PosReceiptItem(
            lineNumber: 1,
            nameSnapshot: 'Producto genérico',
            skuSnapshot: 'GEN-1',
            quantity: '1.000000',
            unitPrice: '200.0000',
            discountTotal: '0.0000',
            taxTotal: '32.0000',
            lineTotal: '232.0000',
          ),
        ],
        payments: const [
          PosReceiptPayment(
            id: 'payment-other',
            paymentMethod: 'cash',
            status: 'captured',
            amount: '232.0000',
            currencyCode: 'MXN',
            capturedAt: null,
            tenderedAmount: '250.0000',
            changeAmount: '18.0000',
            provider: null,
            terminalId: null,
            providerReference: null,
          ),
        ],
      );
      final html = buildReceiptHtml(receipt: otherTenant);
      expect(html, contains('Multi-Tenant Test Corp'));
      expect(html, contains('Sucursal Alterna'));
      for (final forbidden in ['INFLAPARK', 'Inflapark', 'Puerta La Victoria', 'Bryant', 'AGUA', 'Agua']) {
        expect(html, isNot(contains(forbidden)), reason: '"$forbidden" must never leak into another tenant\'s receipt');
      }
    });

    test('the shared print builder source itself contains no hardcoded INFLAPARK/customer-specific '
        'literal — every tenant-facing value is a parameter or a field read off the receipt', () {
      final source = File(
        '${Directory.current.path}/lib/features/pos/receipt_html.dart',
      ).readAsStringSync();
      for (final forbidden in ['INFLAPARK', 'Inflapark', 'Puerta La Victoria', 'AGUA']) {
        expect(source, isNot(contains(forbidden)), reason: '"$forbidden" must never be hardcoded in shared print logic');
      }
    });
  });
}
