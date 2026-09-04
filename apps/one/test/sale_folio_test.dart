import 'package:as_one/features/pos/sale_folio.dart';
import 'package:flutter_test/flutter_test.dart';

/// TASK 12.5B.1: [displaySaleFolio] is a pure function of the canonical
/// `sale_number` — deterministic, stable, display-only, never sent back to
/// the backend. See the doc comment on `sale_folio.dart` for the full
/// contract this locks in.
void main() {
  test('derives a compact SALE-XXXXXXXX folio from the real canonical sale number', () {
    // The real TASK 12.5B QA sale.
    expect(displaySaleFolio('SALE-2517abd73ecf44a2b2206f4eadfeee49'), 'SALE-ADFEEE49');
  });

  test('is deterministic — the same input always produces the same output', () {
    const saleNumber = 'SALE-2517abd73ecf44a2b2206f4eadfeee49';
    final first = displaySaleFolio(saleNumber);
    final second = displaySaleFolio(saleNumber);
    final third = displaySaleFolio(saleNumber);
    expect(first, second);
    expect(second, third);
  });

  test('is always shorter than the canonical 37-character sale number', () {
    const saleNumber = 'SALE-2517abd73ecf44a2b2206f4eadfeee49';
    expect(saleNumber.length, 37);
    expect(displaySaleFolio(saleNumber).length, lessThan(saleNumber.length));
    expect(displaySaleFolio(saleNumber).length, 13); // 'SALE-' + 8 hex chars.
  });

  test('two different sales that differ only outside the trailing 8 hex characters '
      'collide by design — the doc comment states this is not guaranteed unique', () {
    final a = displaySaleFolio('SALE-00000000000000000000000012345678');
    final b = displaySaleFolio('SALE-ffffffffffffffffffffffff12345678');
    expect(a, b);
    expect(a, 'SALE-12345678');
  });

  test('degrades gracefully for a shape shorter than the canonical format, never throws', () {
    expect(displaySaleFolio('SALE-abc'), 'SALE-ABC');
    expect(displaySaleFolio(''), 'SALE-');
  });

  test('always keeps the SALE- prefix even for an unprefixed input', () {
    expect(displaySaleFolio('2517abd73ecf44a2b2206f4eadfeee49'), 'SALE-ADFEEE49');
  });
}
