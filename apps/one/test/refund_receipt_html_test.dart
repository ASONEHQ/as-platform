/// TASK 14.5A: `refund_receipt_html.dart`'s own `headerText`/`footerText`
/// params (`buildRefundReceiptHtml`) had zero test coverage before this
/// file — `receipt_html_test.dart` already covers the equivalent
/// normal-sale case (its own "tenant header/footer branding text" group)
/// but nothing exercised the refund receipt's identical params. This
/// mirrors that existing group's exact structure/assertions, applied to
/// [buildRefundReceiptHtml] instead, closing that gap: the legacy's own
/// branding applied to both sale AND refund receipts alike (see this
/// task's final report).
library;

import 'package:as_one/features/pos/pos_receipt.dart';
import 'package:as_one/features/pos/pos_refunds_gateway.dart';
import 'package:as_one/features/pos/refund_receipt_html.dart';
import 'package:flutter_test/flutter_test.dart';

PosRefund _refund() => PosRefund(
  id: 'refund-1',
  branchId: 'branch-1',
  saleId: 'sale-1',
  cashSessionId: 'session-1',
  paymentId: 'payment-1',
  refundNumber: 'REFUND-abc123',
  status: 'completed',
  refundMethod: 'cash',
  reasonCode: 'customer_request',
  reasonNote: null,
  currencyCode: 'MXN',
  subtotal: '20.0000',
  taxTotal: '3.2000',
  total: '23.2000',
  occurredAt: DateTime.utc(2026, 9, 8, 12),
  completedAt: DateTime.utc(2026, 9, 8, 12, 5),
  createdBy: 'user-1',
  approvedBy: 'user-1',
  items: const [
    PosRefundItem(
      id: 'item-1',
      saleItemId: 'sale-item-1',
      quantity: '1.000000',
      subtotal: '20.0000',
      taxTotal: '3.2000',
      lineTotal: '23.2000',
      restockDisposition: 'restock',
    ),
  ],
);

PosReceiptSale _sale() => PosReceiptSale(
  id: 'sale-1',
  saleNumber: 'SALE-2517abd73ecf44a2b2206f4eadfeee49',
  status: 'completed',
  currencyCode: 'MXN',
  branchId: 'branch-1',
  occurredAt: DateTime.utc(2026, 9, 8, 11),
  completedAt: DateTime.utc(2026, 9, 8, 11, 2),
  subtotal: '20.0000',
  discountTotal: '0.0000',
  taxTotal: '3.2000',
  total: '23.2000',
);

const _business = PosReceiptBusiness(
  companyName: 'AS ONE Demo Co.',
  branchName: 'Sucursal Centro',
  branchAddress: null,
);

void main() {
  group('TASK 14.5A — refund receipt tenant header/footer branding text', () {
    test(
      'renders no tenant-header/tenant-footer DIV at all when both are '
      'omitted — byte-identical to before this task for a tenant that '
      'never configured this',
      () {
        final html = buildRefundReceiptHtml(refund: _refund(), sale: _sale(), business: _business);
        expect(html, isNot(contains('class="sub tenant-header"')));
        expect(html, isNot(contains('class="tenant-footer"')));
      },
    );

    test('renders the header text under the business/branch line, before the first divider', () {
      final html = buildRefundReceiptHtml(
        refund: _refund(),
        sale: _sale(),
        business: _business,
        headerText: 'Sucursal Centro',
      );
      expect(html, contains('<div class="sub tenant-header">Sucursal Centro</div>'));
      final businessIndex = html.indexOf('AS ONE Demo Co.');
      final headerBlockIndex = html.indexOf('<div class="sub tenant-header">');
      final firstDividerIndex = html.indexOf('<hr class="divider">');
      expect(businessIndex, lessThan(headerBlockIndex));
      expect(headerBlockIndex, lessThan(firstDividerIndex));
    });

    test('renders the footer text above the fixed refund disclosure line', () {
      final html = buildRefundReceiptHtml(
        refund: _refund(),
        sale: _sale(),
        business: _business,
        footerText: 'Cambios en 7 días con ticket.',
      );
      expect(html, contains('<div class="tenant-footer">Cambios en 7 días con ticket.</div>'));
      final footerBlockIndex = html.indexOf('<div class="tenant-footer">');
      final disclosureIndex = html.indexOf('Comprobante de devolución');
      expect(footerBlockIndex, lessThan(disclosureIndex));
    });

    test('an empty or whitespace-only header/footer renders nothing extra, never a blank block', () {
      final html = buildRefundReceiptHtml(
        refund: _refund(),
        sale: _sale(),
        business: _business,
        headerText: '   ',
        footerText: '',
      );
      expect(html, isNot(contains('class="sub tenant-header"')));
      expect(html, isNot(contains('class="tenant-footer"')));
    });

    test('header and footer text are HTML-escaped like every other tenant-supplied value', () {
      final html = buildRefundReceiptHtml(
        refund: _refund(),
        sale: _sale(),
        business: _business,
        headerText: '<b>Hola</b> & bienvenido',
        footerText: '<script>alert(1)</script>',
      );
      expect(html, contains('&lt;b&gt;Hola&lt;/b&gt; &amp; bienvenido'));
      expect(html, contains('&lt;script&gt;alert(1)&lt;/script&gt;'));
      expect(html, isNot(contains('<b>Hola</b>')));
      expect(html, isNot(contains('<script>alert(1)</script>')));
    });

    test('both header and footer render together in the same refund receipt', () {
      final html = buildRefundReceiptHtml(
        refund: _refund(),
        sale: _sale(),
        business: _business,
        headerText: 'Sucursal Centro',
        footerText: 'Cambios en 7 días con ticket.',
      );
      expect(html, contains('<div class="sub tenant-header">Sucursal Centro</div>'));
      expect(html, contains('<div class="tenant-footer">Cambios en 7 días con ticket.</div>'));
      // Still a genuine refund receipt, not a sale receipt — the REEMBOLSO
      // banner and refund-specific fields stay unaffected by branding.
      expect(html, contains('REEMBOLSO'));
      expect(html, contains('REFUND-abc123'));
    });
  });
}
