/// TASK 16.8 — pure unit tests for `buildCashCutHtml`.
library;

import 'package:as_one/features/pos/cash_cut_html.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('a partial cut is clearly marked open and never shows a counted/difference section', () {
    final html = buildCashCutHtml(
      isFinal: false,
      businessName: 'AS ONE Park',
      branchName: 'Puerta La Victoria',
      registerName: 'Caja 1',
      openedByName: 'Ana Cajera',
      openedAt: DateTime.utc(2026, 9, 17, 9, 0),
      takenAt: DateTime.utc(2026, 9, 17, 12, 0),
      openingAmount: '1000.0000',
      cashSalesTotal: '580.0000',
      cashSalesCount: 3,
      externalIncomeTotal: '100.0000',
      withdrawalTotal: '200.0000',
      expenseTotal: '50.0000',
      otherCashInTotal: '0.0000',
      otherCashOutTotal: '0.0000',
      expectedCash: '1430.0000',
      currencyCode: 'MXN',
    );

    expect(html, contains('CORTE PARCIAL'));
    expect(html, contains('LA CAJA SIGUE ABIERTA'));
    // TASK 16.14 §11/§13 — neutral accounting language; the zero-
    // discrepancy label is "SIN DIFERENCIA", never "CUADRADO".
    expect(html, isNot(contains('SIN DIFERENCIA')));
    expect(html, isNot(contains('FALTANTE')));
    expect(html, isNot(contains('SOBRANTE')));
    expect(html, isNot(contains('Efectivo contado')));
    expect(html, contains(r'$1000.00'));
    expect(html, contains(r'$580.00'));
    expect(html, contains(r'$1430.00'));
  });

  test('a final close renders counted/expected/difference and a SIN DIFERENCIA/FALTANTE/SOBRANTE verdict', () {
    final shortage = buildCashCutHtml(
      isFinal: true,
      businessName: 'AS ONE Park',
      branchName: 'Puerta La Victoria',
      registerName: 'Caja 1',
      openedByName: 'Ana Cajera',
      openedAt: DateTime.utc(2026, 9, 17, 9, 0),
      closedByName: 'Ana Cajera',
      closedAt: DateTime.utc(2026, 9, 17, 18, 0),
      openingAmount: '1000.0000',
      cashSalesTotal: '580.0000',
      cashSalesCount: 3,
      externalIncomeTotal: '100.0000',
      withdrawalTotal: '200.0000',
      expenseTotal: '50.0000',
      otherCashInTotal: '0.0000',
      otherCashOutTotal: '0.0000',
      expectedCash: '1430.0000',
      declaredClosingAmount: '1400.0000',
      discrepancyAmount: '-30.0000',
      currencyCode: 'MXN',
    );

    expect(shortage, contains('FALTANTE'));
    expect(shortage, isNot(contains('CORTE PARCIAL')));
    expect(shortage, contains(r'$1400.00'));
    expect(shortage, contains(r'-$30.00'));

    final balanced = buildCashCutHtml(
      isFinal: true,
      businessName: 'AS ONE Park',
      branchName: 'Puerta La Victoria',
      registerName: 'Caja 1',
      openedByName: 'Ana Cajera',
      openedAt: DateTime.utc(2026, 9, 17, 9, 0),
      openingAmount: '1000.0000',
      cashSalesTotal: '0.0000',
      cashSalesCount: 0,
      externalIncomeTotal: '0.0000',
      withdrawalTotal: '0.0000',
      expenseTotal: '0.0000',
      otherCashInTotal: '0.0000',
      otherCashOutTotal: '0.0000',
      expectedCash: '1000.0000',
      declaredClosingAmount: '1000.0000',
      discrepancyAmount: '0.0000',
      currencyCode: 'MXN',
    );
    expect(balanced, contains('SIN DIFERENCIA'));
  });

  test('renders the real denomination breakdown when supplied', () {
    final html = buildCashCutHtml(
      isFinal: true,
      businessName: 'AS ONE Park',
      branchName: 'Puerta La Victoria',
      registerName: 'Caja 1',
      openedByName: 'Ana Cajera',
      openedAt: DateTime.utc(2026, 9, 17, 9, 0),
      openingAmount: '1000.0000',
      cashSalesTotal: '0.0000',
      cashSalesCount: 0,
      externalIncomeTotal: '0.0000',
      withdrawalTotal: '0.0000',
      expenseTotal: '0.0000',
      otherCashInTotal: '0.0000',
      otherCashOutTotal: '0.0000',
      expectedCash: '1000.0000',
      declaredClosingAmount: '1000.0000',
      discrepancyAmount: '0.0000',
      currencyCode: 'MXN',
      denominationLines: const [CashCutLine('\$500 x 2', '\$1000.00')],
    );

    expect(html, contains('Conteo por denominación'));
    expect(html, contains(r'$500 x 2'));
  });

  test('renders the real configured paper width, branding, and business/branch/register — never hardcoded', () {
    final html = buildCashCutHtml(
      isFinal: false,
      businessName: 'AS ONE Park',
      branchName: 'Puerta La Victoria',
      registerName: 'Caja 1',
      openedByName: 'Ana Cajera',
      openedAt: DateTime.utc(2026, 9, 17, 9, 0),
      openingAmount: '1000.0000',
      cashSalesTotal: '0.0000',
      cashSalesCount: 0,
      externalIncomeTotal: '0.0000',
      withdrawalTotal: '0.0000',
      expenseTotal: '0.0000',
      otherCashInTotal: '0.0000',
      otherCashOutTotal: '0.0000',
      expectedCash: '1000.0000',
      currencyCode: 'MXN',
      paperWidthMm: 58,
      logoDataUri: 'https://cdn.example.test/logo.png',
      headerText: 'Bienvenido',
      footerText: 'Gracias',
    );

    expect(html, contains('size:58.0mm auto'));
    expect(html, contains('Puerta La Victoria'));
    expect(html, contains('Caja 1'));
    expect(html, contains('src="https://cdn.example.test/logo.png"'));
    expect(html, contains('Bienvenido'));
    expect(html, contains('Gracias'));
    expect(html, isNot(contains('INFLAPARK')));
  });

  group('TASK 16.13 — Resumen operativo section', () {
    String buildWithOperationalSummary({CashCutOperationalSummary? operationalSummary}) =>
        buildCashCutHtml(
          isFinal: false,
          businessName: 'AS ONE Park',
          branchName: 'Puerta La Victoria',
          registerName: 'Caja 1',
          openedByName: 'Ana Cajera',
          openedAt: DateTime.utc(2026, 9, 17, 9, 0),
          takenAt: DateTime.utc(2026, 9, 17, 12, 0),
          openingAmount: '1000.0000',
          cashSalesTotal: '580.0000',
          cashSalesCount: 3,
          externalIncomeTotal: '0.0000',
          withdrawalTotal: '0.0000',
          expenseTotal: '0.0000',
          otherCashInTotal: '0.0000',
          otherCashOutTotal: '0.0000',
          expectedCash: '1580.0000',
          currencyCode: 'MXN',
          operationalSummary: operationalSummary,
        );

    test('omits the section entirely when no operational summary is supplied (old partial cuts)', () {
      final html = buildWithOperationalSummary();
      expect(html, isNot(contains('RESUMEN OPERATIVO')));
    });

    test('renders Ventas/Taquilla, Cafetería (labeled as a subset), and Eventos — never implying a bigger total', () {
      final html = buildWithOperationalSummary(
        operationalSummary: const CashCutOperationalSummary(
          posNetSales: '450.0000',
          posTicketCount: 5,
          posRefundsTotal: '0.0000',
          cafeteriaAvailable: true,
          cafeteriaNetSales: '150.0000',
          cafeteriaTicketCount: 3,
          cafeteriaUnitsSold: '3.000000',
          eventsReservationsCreated: 1,
          eventsDepositsCollected: '500.0000',
          eventsTotalCollected: '500.0000',
          eventsOutstandingForNew: '1500.0000',
          eventsOccurringToday: 0,
          eventsCancelledCount: 0,
        ),
      );

      expect(html, contains('RESUMEN OPERATIVO'));
      expect(html, contains('Ventas / Taquilla'));
      expect(html, contains(r'$450.00')); // pos net sales
      // Cafetería is explicitly labeled a SUBSET of Taquilla — never two
      // independent totals a reader could add together.
      expect(html, contains('Cafetería / Snacks (parte de Taquilla)'));
      expect(html, contains(r'$150.00')); // cafeteria net sales
      expect(html, contains('Eventos / Fiestas'));
      expect(html, contains(r'$500.00')); // deposits/collected
      expect(html, contains(r'$1500.00')); // outstanding for new reservations
      // Units formatted without noisy trailing zeros.
      expect(html, isNot(contains('3.000000')));
    });

    test('shows an honest "not configured" notice when no Cafetería category exists — never a misleading \$0', () {
      final html = buildWithOperationalSummary(
        operationalSummary: const CashCutOperationalSummary(
          posNetSales: '300.0000',
          posTicketCount: 2,
          posRefundsTotal: '0.0000',
          cafeteriaAvailable: false,
          cafeteriaNetSales: '0.0000',
          cafeteriaTicketCount: 0,
          cafeteriaUnitsSold: '0.000000',
          eventsReservationsCreated: 0,
          eventsDepositsCollected: '0.0000',
          eventsTotalCollected: '0.0000',
          eventsOutstandingForNew: '0.0000',
          eventsOccurringToday: 0,
          eventsCancelledCount: 0,
        ),
      );
      expect(html, contains('No configurado'));
    });
  });

  group('TASK 16.14 — commercial final close', () {
    String buildFinal({
      String? cashRefundTotal,
      String? discrepancyReason,
      List<CashCutLine>? paymentMethodLines,
    }) => buildCashCutHtml(
      isFinal: true,
      businessName: 'AS ONE Park',
      branchName: 'Puerta La Victoria',
      registerName: 'Caja 1',
      openedByName: 'Ana Cajera',
      openedAt: DateTime.utc(2026, 9, 17, 9, 0),
      closedByName: 'Ana Cajera',
      closedAt: DateTime.utc(2026, 9, 17, 18, 0),
      openingAmount: '500.0000',
      cashSalesTotal: '150.0000',
      cashSalesCount: 2,
      externalIncomeTotal: '300.0000',
      withdrawalTotal: '0.0000',
      expenseTotal: '10.0000',
      otherCashInTotal: '20.0000',
      otherCashOutTotal: '0.0000',
      expectedCash: '935.0000',
      declaredClosingAmount: '940.0000',
      discrepancyAmount: '5.0000',
      currencyCode: 'MXN',
      cashRefundTotal: cashRefundTotal,
      discrepancyReason: discrepancyReason,
      paymentMethodLines: paymentMethodLines,
    );

    test('omits "Devoluciones en efectivo" when there is no cash refund, and renders it when there is', () {
      final withoutRefund = buildFinal(cashRefundTotal: '0.0000');
      expect(withoutRefund, isNot(contains('Devoluciones en efectivo')));

      final withRefund = buildFinal(cashRefundTotal: '25.0000');
      expect(withRefund, contains('Devoluciones en efectivo'));
      expect(withRefund, contains(r'-$25.00'));
    });

    test('renders the discrepancy reason directly under the verdict banner when supplied, omits it otherwise', () {
      final withoutReason = buildFinal();
      expect(withoutReason, isNot(contains('Motivo:')));

      final withReason = buildFinal(discrepancyReason: 'Propina en efectivo no registrada.');
      expect(withReason, contains('Motivo: Propina en efectivo no registrada.'));
    });

    test('renders "VENTAS POR MÉTODO DE PAGO" only when payment-method lines are supplied — never a fabricated line', () {
      final withoutMethods = buildFinal();
      expect(withoutMethods, isNot(contains('VENTAS POR MÉTODO DE PAGO')));

      final withMethods = buildFinal(
        paymentMethodLines: const [
          CashCutLine('Efectivo', r'$125.00'),
          CashCutLine('Tarjeta', r'$200.00'),
        ],
      );
      expect(withMethods, contains('VENTAS POR MÉTODO DE PAGO'));
      expect(withMethods, contains('Efectivo'));
      expect(withMethods, contains(r'$125.00'));
      expect(withMethods, contains('Tarjeta'));
      expect(withMethods, contains(r'$200.00'));
      // Never a fabricated "Transferencia" line — nothing in this
      // scenario produced one, and this builder never invents one.
      expect(withMethods, isNot(contains('Transferencia')));
    });

    test('uses neutral "SIN DIFERENCIA"/"FALTANTE"/"SOBRANTE" language — never "CUADRADO"', () {
      final html = buildFinal();
      expect(html, isNot(contains('CUADRADO')));
      expect(html, contains('SOBRANTE')); // this fixture's own $5 surplus.
    });
  });
}
