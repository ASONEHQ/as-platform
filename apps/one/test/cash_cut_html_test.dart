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
    expect(html, isNot(contains('CUADRADO')));
    expect(html, isNot(contains('FALTANTE')));
    expect(html, isNot(contains('SOBRANTE')));
    expect(html, isNot(contains('Efectivo contado')));
    expect(html, contains(r'$1000.00'));
    expect(html, contains(r'$580.00'));
    expect(html, contains(r'$1430.00'));
  });

  test('a final close renders counted/expected/difference and a CUADRADO/FALTANTE/SOBRANTE verdict', () {
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
    expect(balanced, contains('CUADRADO'));
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
}
