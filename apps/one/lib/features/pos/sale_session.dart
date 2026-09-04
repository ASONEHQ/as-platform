import 'package:flutter/foundation.dart';

import 'money.dart';
import 'pos_models.dart';

/// Mexico's standard general IVA rate, as a `double` — retained only for
/// existing call sites that still want a display-oriented rate constant.
/// TASK 12.3C: real per-line tax now comes from [posIvaBasisPointsFor],
/// keyed by each line's own `taxCode`, not a single flat multiplier
/// applied to the whole ticket. TASK 12.3.
const double posIvaRate = 0.16;

/// One line of a working sale ticket — TASK 12.3, priced for real in
/// TASK 12.3C.
///
/// [unitPrice] and [subtotal] are [Money] — an exact fixed-point value,
/// never a Dart `double` (ADR-0001; see `money.dart`) — resolved from the
/// backend's `effective_price` at the moment the line was added. [taxCode]
/// carries the product's backend tax classification so [SaleSession.iva]
/// can compute real per-line tax instead of a single blind rate.
@immutable
class SaleLine {
  const SaleLine({
    required this.productId,
    required this.name,
    required this.sku,
    required this.quantity,
    required this.unitPrice,
    required this.taxCode,
  }) : assert(quantity > 0, 'A ticket line must have a positive quantity.');

  final String productId;
  final String name;
  final String sku;
  final int quantity;
  final Money unitPrice;
  final String taxCode;

  Money get subtotal => unitPrice * quantity;

  /// This line's own IVA, from its own tax code — `null` only if
  /// [taxCode] is not a recognized classification, which
  /// `SaleSession.addProduct` never allows onto the ticket in the first
  /// place (see `pos_models.dart`'s `posAddabilityBlock`).
  Money? get iva {
    final basisPoints = posIvaBasisPointsFor(taxCode);
    if (basisPoints == null) return null;
    return subtotal.multiplyByRateBasisPoints(basisPoints);
  }

  SaleLine copyWith({int? quantity}) => SaleLine(
    productId: productId,
    name: name,
    sku: sku,
    quantity: quantity ?? this.quantity,
    unitPrice: unitPrice,
    taxCode: taxCode,
  );
}

/// The real, reactive state of the current sale ticket — TASK 12.3, wired
/// to real backend prices in TASK 12.3C.
///
/// Owned once per `_PosShellState` (its `State`, not a `build()`-local
/// variable) so it survives rebuilds; a `ChangeNotifier`, the same
/// reactive pattern already used by `PosReadController`/`AuthController`
/// elsewhere in this app. Adding a product already on the ticket merges
/// into the existing line (increments its quantity) instead of
/// duplicating a row.
///
/// The backend remains the sole pricing authority: [addProduct] never
/// computes, guesses, or overrides a price — it only reads what
/// [PosProduct.pricing] already resolved from the API, and refuses to add
/// a line at all when [posAddabilityBlock] finds a reason (out of stock,
/// missing price, malformed price, or an unrateable tax code).
///
/// Deliberately out of scope here (TASK 12.4): payment, checkout, coupons,
/// discounts, customer association, suspending/recovering a sale, and any
/// backend/persisted sale record — this is purely local, in-memory ticket
/// state, matching the task's explicit "this is NOT checkout yet" scope.
/// Authoritative totals for a completed sale remain a backend concern;
/// this engine's subtotal/IVA/total are a real, live *display* of what the
/// backend already priced, not an authoritative checkout calculation.
class SaleSession extends ChangeNotifier {
  final List<SaleLine> _lines = [];

  /// The currency of the ticket, taken from the first line added — kept
  /// so `subtotal`/`iva`/`total` have a currency to report even before any
  /// line exists. Every line must share one currency (mixed-currency
  /// tickets are not a real scenario for one company/branch catalog); a
  /// currency mismatch is a defensive `StateError`, not silently ignored.
  String _currencyCode = 'MXN';

  /// Read-only snapshot — mutate only through the methods below so every
  /// change goes through `notifyListeners()`.
  List<SaleLine> get lines => List.unmodifiable(_lines);

  bool get isEmpty => _lines.isEmpty;
  bool get isNotEmpty => _lines.isNotEmpty;
  int get lineCount => _lines.length;
  int get totalUnits => _lines.fold(0, (sum, line) => sum + line.quantity);

  Money get subtotal => _lines.fold(
    Money.zero(_currencyCode),
    (sum, line) => sum + line.subtotal,
  );

  /// Sum of every line's own [SaleLine.iva] — real per-line tax by tax
  /// code, not one flat rate applied to the whole ticket. Lines with an
  /// unrateable tax code cannot exist on the ticket (see [addProduct]), so
  /// `line.iva` is never `null` here in practice; a defensive zero is
  /// used instead of crashing the totals display if that invariant is
  /// ever violated.
  Money get iva => _lines.fold(
    Money.zero(_currencyCode),
    (sum, line) => sum + (line.iva ?? Money.zero(_currencyCode)),
  );

  Money get total => subtotal + iva;

  /// Adds [product] to the ticket — merges into an existing line for the
  /// same product (increments quantity by 1) instead of creating a
  /// duplicate. Returns `true` when a line was actually added/merged.
  ///
  /// Returns `false`, changing nothing, when [posAddabilityBlock] finds a
  /// reason the product cannot be sold right now (out of stock, missing
  /// price, malformed price, or an unrateable tax code) — this is a
  /// defensive backstop; the UI is expected to have already checked the
  /// same function before ever calling this.
  bool addProduct(PosProduct product, List<PosInventoryBalance> balances) {
    if (posAddabilityBlock(product, balances) != null) return false;
    final unitPrice = product.pricing.amount;
    final taxCode = product.taxCode;
    if (unitPrice == null || taxCode == null) return false;
    if (_lines.isNotEmpty && unitPrice.currencyCode != _currencyCode) {
      throw StateError(
        'Cannot add a ${unitPrice.currencyCode} line to a $_currencyCode ticket.',
      );
    }
    _currencyCode = unitPrice.currencyCode;
    final index = _lines.indexWhere((line) => line.productId == product.id);
    if (index == -1) {
      _lines.add(
        SaleLine(
          productId: product.id,
          name: product.name,
          sku: product.sku ?? product.code,
          quantity: 1,
          unitPrice: unitPrice,
          taxCode: taxCode,
        ),
      );
    } else {
      _lines[index] = _lines[index].copyWith(
        quantity: _lines[index].quantity + 1,
      );
    }
    notifyListeners();
    return true;
  }

  void increaseQuantity(String productId) {
    final index = _lines.indexWhere((line) => line.productId == productId);
    if (index == -1) return;
    _lines[index] = _lines[index].copyWith(
      quantity: _lines[index].quantity + 1,
    );
    notifyListeners();
  }

  /// Decrementing a line to 0 removes it entirely (matching V1's own
  /// `decQty()`: quantity can never be shown as 0 while a line exists).
  void decreaseQuantity(String productId) {
    final index = _lines.indexWhere((line) => line.productId == productId);
    if (index == -1) return;
    final next = _lines[index].quantity - 1;
    if (next <= 0) {
      _lines.removeAt(index);
    } else {
      _lines[index] = _lines[index].copyWith(quantity: next);
    }
    notifyListeners();
  }

  void removeLine(String productId) {
    _lines.removeWhere((line) => line.productId == productId);
    notifyListeners();
  }

  /// TASK 12.5A: "Nueva venta" — resets the ticket to empty after a
  /// *confirmed successful* sale completion. Must never be called
  /// speculatively (before the backend confirms the sale completed) or on
  /// any failure path; a cash/card checkout error must leave the ticket
  /// exactly as it was so the cashier can retry without re-ringing every
  /// item. `_currencyCode` deliberately does not reset — the branch's
  /// catalog currency does not change between sales.
  void clearAll() {
    if (_lines.isEmpty) return;
    _lines.clear();
    notifyListeners();
  }
}
