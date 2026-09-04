import 'package:as_one/features/pos/money.dart';
import 'package:as_one/features/pos/pos_models.dart';
import 'package:as_one/features/pos/sale_session.dart';
import 'package:flutter_test/flutter_test.dart';

/// TASK 12.3: unit coverage for the shared sale-domain layer itself —
/// `SaleSession` is the single source of truth `_TicketPanel` (CAJERO) and
/// `_ClienteTicketPreview` (CLIENTE) both read from; these tests prove the
/// engine's correctness independent of any widget tree. TASK 12.3C: rewired
/// to real backend prices/tax — every price here is exact `Money`, never a
/// `double`, and addability (stock/price/tax) is enforced the same way the
/// UI gates a tap.
void main() {
  PosProduct priced({
    required String id,
    required String code,
    required String name,
    String amount = '10.00',
    String currencyCode = 'MXN',
    String taxCode = 'IVA_GENERAL',
    bool tracksInventory = false,
    String? defaultVariantId,
  }) => PosProduct(
    id: id,
    code: code,
    name: name,
    type: 'simple',
    status: 'active',
    tracksInventory: tracksInventory,
    defaultVariantId: defaultVariantId,
    sku: code,
    taxCode: taxCode,
    pricing: PosPricing.fromJson({
      'amount': amount,
      'currency_code': currencyCode,
    }),
  );

  final productA = priced(id: 'a', code: 'SKU-A', name: 'Producto A');
  final productB = priced(
    id: 'b',
    code: 'SKU-B',
    name: 'Producto B',
    amount: '25.00',
  );

  test('starts empty', () {
    final session = SaleSession();
    expect(session.isEmpty, isTrue);
    expect(session.lines, isEmpty);
    expect(session.subtotal.isZero, isTrue);
    expect(session.iva.isZero, isTrue);
    expect(session.total.isZero, isTrue);
  });

  test('addProduct creates a line with the real backend price', () {
    final session = SaleSession();
    final added = session.addProduct(productA, const []);

    expect(added, isTrue);
    expect(session.lines, hasLength(1));
    final line = session.lines.single;
    expect(line.productId, 'a');
    expect(line.name, 'Producto A');
    expect(line.sku, 'SKU-A');
    expect(line.quantity, 1);
    expect(line.unitPrice, Money.parse('10.00', 'MXN'));
    expect(line.subtotal, Money.parse('10.00', 'MXN'));
  });

  test('adding the same product again merges instead of duplicating', () {
    final session = SaleSession();
    session.addProduct(productA, const []);
    session.addProduct(productA, const []);
    session.addProduct(productA, const []);

    expect(session.lines, hasLength(1));
    expect(session.lines.single.quantity, 3);
    expect(session.totalUnits, 3);
  });

  test('addProduct notifies listeners', () {
    final session = SaleSession();
    var notified = 0;
    session.addListener(() => notified++);

    session.addProduct(productA, const []);

    expect(notified, 1);
  });

  test('a genuinely free product is added at exactly \$0.00', () {
    final free = priced(id: 'c', code: 'SKU-C', name: 'Cortesía', amount: '0.00');
    final session = SaleSession();
    final added = session.addProduct(free, const []);

    expect(added, isTrue);
    expect(session.lines.single.unitPrice.isZero, isTrue);
    expect(session.lines.single.unitPrice, Money.parse('0.0000', 'MXN'));
  });

  test('a product with no active price cannot be added', () {
    final noPrice = PosProduct(
      id: 'd',
      code: 'SKU-D',
      name: 'Sin precio',
      type: 'simple',
      status: 'active',
      tracksInventory: false,
      taxCode: 'IVA_GENERAL',
      // pricing defaults to PosPricing.missing().
    );
    final session = SaleSession();
    final added = session.addProduct(noPrice, const []);

    expect(added, isFalse);
    expect(session.isEmpty, isTrue);
    expect(posAddabilityBlock(noPrice, const []), PosAddabilityBlock.missingPrice);
  });

  test('a product with a malformed price cannot be added', () {
    final malformed = PosProduct(
      id: 'e',
      code: 'SKU-E',
      name: 'Precio inválido',
      type: 'simple',
      status: 'active',
      tracksInventory: false,
      taxCode: 'IVA_GENERAL',
      pricing: PosPricing.fromJson({'amount': 'not-a-number', 'currency_code': 'MXN'}),
    );
    final session = SaleSession();
    final added = session.addProduct(malformed, const []);

    expect(added, isFalse);
    expect(session.isEmpty, isTrue);
    expect(malformed.pricing.status, PosPricingStatus.malformed);
    expect(posAddabilityBlock(malformed, const []), PosAddabilityBlock.malformedPrice);
  });

  test('an out-of-stock product cannot be added', () {
    final tracked = priced(
      id: 'f',
      code: 'SKU-F',
      name: 'Agotado',
      tracksInventory: true,
      defaultVariantId: 'variant-f',
    );
    const balances = [
      PosInventoryBalance(
        id: 'bal-1',
        branchId: 'branch-1',
        locationId: 'loc-1',
        variantId: 'variant-f',
        onHand: '0.000000',
        reserved: '0.000000',
        inTransit: '0.000000',
      ),
    ];
    final session = SaleSession();
    final added = session.addProduct(tracked, balances);

    expect(added, isFalse);
    expect(session.isEmpty, isTrue);
    expect(posAddabilityBlock(tracked, balances), PosAddabilityBlock.outOfStock);
  });

  test('a stock-tracked product with real on-hand balance can be added', () {
    final tracked = priced(
      id: 'g',
      code: 'SKU-G',
      name: 'Con existencia',
      tracksInventory: true,
      defaultVariantId: 'variant-g',
    );
    const balances = [
      PosInventoryBalance(
        id: 'bal-2',
        branchId: 'branch-1',
        locationId: 'loc-1',
        variantId: 'variant-g',
        onHand: '50.000000',
        reserved: '0.000000',
        inTransit: '0.000000',
      ),
    ];
    final session = SaleSession();
    final added = session.addProduct(tracked, balances);

    expect(added, isTrue);
    expect(session.lines, hasLength(1));
  });

  test('a non-stock product is always addable regardless of balances', () {
    expect(posIsOutOfStock(productA, const []), isFalse);
    expect(posAddabilityBlock(productA, const []), isNull);
  });

  test('increaseQuantity increments an existing line', () {
    final session = SaleSession()..addProduct(productA, const []);
    session.increaseQuantity('a');
    expect(session.lines.single.quantity, 2);
  });

  test('increaseQuantity on an unknown product is a no-op', () {
    final session = SaleSession();
    session.increaseQuantity('missing');
    expect(session.lines, isEmpty);
  });

  test('decreaseQuantity decrements an existing line', () {
    final session = SaleSession()..addProduct(productA, const []);
    session.increaseQuantity('a'); // qty 2
    session.decreaseQuantity('a');
    expect(session.lines.single.quantity, 1);
  });

  test('decreaseQuantity to zero removes the line entirely', () {
    final session = SaleSession()..addProduct(productA, const []);
    session.decreaseQuantity('a');
    expect(session.isEmpty, isTrue);
  });

  test('removeLine deletes a line regardless of quantity', () {
    final session = SaleSession()..addProduct(productA, const []);
    session.increaseQuantity('a');
    session.increaseQuantity('a'); // qty 3
    session.removeLine('a');
    expect(session.isEmpty, isTrue);
  });

  test('removeLine on an unknown product is a harmless no-op', () {
    final session = SaleSession()..addProduct(productA, const []);
    session.removeLine('missing');
    expect(session.lines, hasLength(1));
  });

  test('subtotal/IVA/total derive from real per-line prices and tax codes', () {
    final session = SaleSession()..addProduct(productA, const []); // $10.00
    session.addProduct(productB, const []); // $25.00
    session.increaseQuantity('b'); // qty 2 => $50.00

    expect(session.subtotal, Money.parse('60.00', 'MXN')); // 10 + 50
    expect(session.iva, Money.parse('9.60', 'MXN')); // 60 * 16%
    expect(session.total, Money.parse('69.60', 'MXN'));
    expect(session.lineCount, 2);
    expect(session.totalUnits, 3); // 1 of A + 2 of B
  });

  test('an IVA_EXEMPT line contributes no tax', () {
    final exempt = priced(
      id: 'h',
      code: 'SKU-H',
      name: 'Exento',
      amount: '20.00',
      taxCode: 'IVA_EXEMPT',
    );
    final session = SaleSession()..addProduct(exempt, const []);

    expect(session.subtotal, Money.parse('20.00', 'MXN'));
    expect(session.iva.isZero, isTrue);
    expect(session.total, Money.parse('20.00', 'MXN'));
  });

  test('SaleLine.subtotal is unitPrice * quantity', () {
    final line = SaleLine(
      productId: 'x',
      name: 'X',
      sku: 'SKU-X',
      quantity: 4,
      unitPrice: Money.parse('12.50', 'MXN'),
      taxCode: 'IVA_GENERAL',
    );
    expect(line.subtotal, Money.parse('50.00', 'MXN'));
  });

  test('SaleLine.copyWith replaces only quantity', () {
    final line = SaleLine(
      productId: 'x',
      name: 'X',
      sku: 'SKU-X',
      quantity: 1,
      unitPrice: Money.parse('3.00', 'MXN'),
      taxCode: 'IVA_GENERAL',
    );
    final updated = line.copyWith(quantity: 5);
    expect(updated.quantity, 5);
    expect(updated.productId, 'x');
    expect(updated.name, 'X');
    expect(updated.sku, 'SKU-X');
    expect(updated.unitPrice, Money.parse('3.00', 'MXN'));
  });

  test('lines getter is a read-only snapshot', () {
    final session = SaleSession()..addProduct(productA, const []);
    expect(() => session.lines.add(session.lines.first), throwsUnsupportedError);
  });
}
