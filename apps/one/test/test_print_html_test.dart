/// TASK 16.7B — pure unit tests for `buildTestPrintHtml`: the generated
/// document must be unmistakably a test print (task spec item I), never
/// confusable with a real sale receipt.
library;

import 'package:as_one/features/pos/test_print_html.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('is clearly marked as a test print, twice, and states it is not a sale', () {
    final html = buildTestPrintHtml(
      businessName: 'AS ONE Park',
      branchName: 'Puerta La Victoria',
      cashierName: 'Ana Cajera',
      now: DateTime.utc(2026, 9, 17, 10, 30),
    );

    expect('PRUEBA DE IMPRESIÓN'.allMatches(html).length, 2);
    expect(html, contains('NO ES UNA VENTA'));
    expect(html, contains('No representa una venta'));
  });

  test('never contains a real-looking sale folio (SALE- prefix)', () {
    final html = buildTestPrintHtml(
      businessName: 'AS ONE Park',
      branchName: 'Puerta La Victoria',
      cashierName: 'Ana Cajera',
      now: DateTime.utc(2026, 9, 17, 10, 30),
    );

    expect(html.toUpperCase(), isNot(contains('SALE-')));
    expect(html, isNot(contains('Folio')));
  });

  test('renders the real configured paper width, branch, and cashier — never hardcoded', () {
    final html = buildTestPrintHtml(
      businessName: 'AS ONE Park',
      branchName: 'Puerta La Victoria',
      cashierName: 'Ana Cajera',
      paperWidthMm: 58,
      now: DateTime.utc(2026, 9, 17, 10, 30),
    );

    expect(html, contains('size:58.0mm auto'));
    expect(html, contains('Puerta La Victoria'));
    expect(html, contains('Ana Cajera'));
    expect(html, contains('Ancho de papel: 58mm'));
  });

  test('renders the real configured header/footer/logo when supplied, and omits them when not', () {
    final withBranding = buildTestPrintHtml(
      businessName: 'AS ONE Park',
      branchName: 'Puerta La Victoria',
      cashierName: 'Ana Cajera',
      logoDataUri: 'https://cdn.example.test/logo.png',
      headerText: 'Bienvenido',
      footerText: 'Gracias por su visita',
      now: DateTime.utc(2026, 9, 17, 10, 30),
    );
    expect(withBranding, contains('src="https://cdn.example.test/logo.png"'));
    expect(withBranding, contains('Bienvenido'));
    expect(withBranding, contains('Gracias por su visita'));

    final withoutBranding = buildTestPrintHtml(
      businessName: 'AS ONE Park',
      branchName: 'Puerta La Victoria',
      cashierName: 'Ana Cajera',
      now: DateTime.utc(2026, 9, 17, 10, 30),
    );
    expect(withoutBranding, isNot(contains('<img')));
  });
}
