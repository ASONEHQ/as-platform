import 'package:flutter/foundation.dart';

import 'money.dart';
import 'pos_models.dart';
import 'pos_promotions_gateway.dart';

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

  // TASK 12.9: coupon codes the cashier has successfully applied (i.e.
  // NOT present in a quote's own `rejected_coupons` — a rejected code is
  // never persisted here) plus at most one manual-discount request. Both
  // are plain *intent*, never an authoritative amount — see [quote] below,
  // the only place a discount figure actually comes from (ADR-0016 D1).
  List<String> _couponCodes = const [];
  PosManualDiscountRequest? _manualDiscount;

  /// The most recent successful `POST /sales/pricing-quotes` response for
  /// the CURRENT cart/coupon/discount combination — `null` whenever the
  /// cart, coupon list, or manual discount has changed since the last
  /// quote (see the invalidation in every mutator below), so a caller can
  /// simply check `quote != null` rather than re-deriving staleness
  /// itself. Never partially trusted: [displaySubtotal]/
  /// [displayDiscountTotal]/[displayTaxTotal]/[displayTotal] only ever
  /// read straight off this value once it exists.
  PosPricingQuote? _quote;

  List<String> get couponCodes => List.unmodifiable(_couponCodes);
  PosManualDiscountRequest? get manualDiscount => _manualDiscount;
  PosPricingQuote? get quote => _quote;

  // TASK 13.0: the customer optionally attached to this ticket — plain
  // *intent*, threaded straight into `POST /sales`'s own `customer_id`
  // (ADR-0017 D6); never required, never blocks checkout. `null` is
  // "Venta sin cliente", the default/fast path.
  String? _customerId;
  String? _customerDisplayName;

  String? get customerId => _customerId;
  String? get customerDisplayName => _customerDisplayName;
  bool get hasCustomer => _customerId != null;

  // TASK 13.2: the customer's own reward entitlement (e.g. a VIP Pass)
  // optionally attached to this ticket — plain *intent*, threaded into
  // both `POST /sales/pricing-quotes` and `POST /sales`'s own
  // `reward_entitlement_id` (ADR-0019). Never valid without an attached
  // customer (see [setRewardEntitlement]/[setCustomer]/[clearCustomer]
  // below) — mirrors [couponCodes]'s own "intent only, the backend alone
  // derives the real amount" contract.
  String? _rewardEntitlementId;

  String? get rewardEntitlementId => _rewardEntitlementId;

  void setCustomer({required String customerId, required String displayName}) {
    _customerId = customerId;
    _customerDisplayName = displayName;
    // TASK 13.2: a newly-attached customer never inherits the previous
    // customer's reward entitlement — it belongs to that other customer
    // and can never legitimately apply here. Only invalidates the quote
    // when there actually was one to clear, so plain "attach a customer,
    // no reward involved" keeps behaving exactly like pre-TASK-13.2.
    final hadReward = _rewardEntitlementId != null;
    _rewardEntitlementId = null;
    if (hadReward) _quote = null;
    notifyListeners();
  }

  void clearCustomer() {
    if (_customerId == null) return;
    _customerId = null;
    _customerDisplayName = null;
    // TASK 13.2: a reward entitlement can never outlive the customer it
    // belongs to on this ticket — see [setRewardEntitlement]'s own
    // "customer must already be attached" precondition.
    final hadReward = _rewardEntitlementId != null;
    _rewardEntitlementId = null;
    if (hadReward) _quote = null;
    notifyListeners();
  }

  /// Attaches [entitlementId] as the reward benefit to apply to this
  /// ticket — the caller (`_TicketFooter`'s reward dialog) must already
  /// have confirmed a customer is attached and a fresh quote accepted this
  /// exact entitlement before calling this; this method itself only
  /// records the intent and invalidates the stale quote, exactly like
  /// [addCouponCode]. A no-op without an attached customer — mirrors this
  /// same file's "selecting a reward with no customer attached must never
  /// be possible" rule.
  void setRewardEntitlement(String entitlementId) {
    if (_customerId == null) return;
    if (_rewardEntitlementId == entitlementId) return;
    _rewardEntitlementId = entitlementId;
    _quote = null;
    notifyListeners();
  }

  /// Removes/deselects the currently-attached reward entitlement — a
  /// no-op when none is attached, matching [removeCouponCode]'s own
  /// idempotent shape.
  void clearRewardEntitlement() {
    if (_rewardEntitlementId == null) return;
    _rewardEntitlementId = null;
    _quote = null;
    notifyListeners();
  }

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

  // --- TASK 12.9: backend-quote-derived display totals -----------------
  //
  // Never an authoritative computation of this app's own — each getter
  // reads straight off [_quote] (the backend's own `PricingResult`) once
  // one exists for the current cart, falling back to the plain
  // catalog-only [subtotal]/[iva]/[total] above (mathematically identical
  // to what a discount-free quote would return) only while no quote has
  // arrived yet. A malformed backend amount falls back the same way
  // rather than crashing the ticket display.

  Money get displaySubtotal {
    final quote = _quote;
    if (quote == null) return subtotal;
    try {
      return Money.parse(quote.subtotal, quote.currencyCode);
    } on MoneyFormatException {
      return subtotal;
    }
  }

  Money get displayDiscountTotal {
    final quote = _quote;
    if (quote == null) return Money.zero(_currencyCode);
    try {
      return Money.parse(quote.discountTotal, quote.currencyCode);
    } on MoneyFormatException {
      return Money.zero(_currencyCode);
    }
  }

  Money get displayTaxTotal {
    final quote = _quote;
    if (quote == null) return iva;
    try {
      return Money.parse(quote.taxTotal, quote.currencyCode);
    } on MoneyFormatException {
      return iva;
    }
  }

  Money get displayTotal {
    final quote = _quote;
    if (quote == null) return total;
    try {
      return Money.parse(quote.total, quote.currencyCode);
    } on MoneyFormatException {
      return total;
    }
  }

  /// Records a fresh quote for the CURRENT cart/coupon/discount
  /// combination — the caller (the ticket footer) is responsible for
  /// only calling this with a quote it just fetched for the exact
  /// present state; every mutator below independently invalidates this
  /// back to `null` the instant that state changes again, so a stale
  /// quote can never linger and be displayed as if still current.
  void setQuote(PosPricingQuote? quote) {
    _quote = quote;
    notifyListeners();
  }

  /// Appends an already-backend-accepted coupon code (never one present
  /// in a quote's own `rejected_coupons` — the caller checks that first).
  /// A no-op for an empty/already-applied code.
  void addCouponCode(String code) {
    final normalized = code.trim();
    if (normalized.isEmpty || _couponCodes.contains(normalized)) return;
    _couponCodes = [..._couponCodes, normalized];
    _quote = null;
    notifyListeners();
  }

  void removeCouponCode(String code) {
    if (!_couponCodes.contains(code)) return;
    _couponCodes = _couponCodes.where((existing) => existing != code).toList(growable: false);
    _quote = null;
    notifyListeners();
  }

  /// `null` clears any previously-applied manual discount.
  void setManualDiscount(PosManualDiscountRequest? discount) {
    _manualDiscount = discount;
    _quote = null;
    notifyListeners();
  }

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
    // TASK 12.9: the cart itself changed — any previously-fetched quote
    // no longer describes the current ticket (ADR-0016: a quote must
    // never be displayed once stale).
    _quote = null;
    notifyListeners();
    return true;
  }

  void increaseQuantity(String productId) {
    final index = _lines.indexWhere((line) => line.productId == productId);
    if (index == -1) return;
    _lines[index] = _lines[index].copyWith(
      quantity: _lines[index].quantity + 1,
    );
    _quote = null;
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
    _quote = null;
    notifyListeners();
  }

  void removeLine(String productId) {
    _lines.removeWhere((line) => line.productId == productId);
    _quote = null;
    notifyListeners();
  }

  /// TASK 12.5A: "Nueva venta" — resets the ticket to empty after a
  /// *confirmed successful* sale completion. Must never be called
  /// speculatively (before the backend confirms the sale completed) or on
  /// any failure path; a cash/card checkout error must leave the ticket
  /// exactly as it was so the cashier can retry without re-ringing every
  /// item. `_currencyCode` deliberately does not reset — the branch's
  /// catalog currency does not change between sales.
  ///
  /// TASK 12.9: also clears any applied coupon codes/manual discount/quote
  /// — a brand-new ticket never silently inherits the previous customer's
  /// discount.
  ///
  /// TASK 13.0: also clears any attached customer, for the identical
  /// reason — a brand-new ticket never silently carries the previous
  /// customer over to a different guest's sale.
  ///
  /// TASK 13.2: also clears any attached reward entitlement, for the same
  /// reason — it belongs to the previous ticket's customer and can never
  /// legitimately carry over.
  void clearAll() {
    final hadDiscountState =
        _couponCodes.isNotEmpty || _manualDiscount != null || _quote != null;
    final hadCustomer = _customerId != null;
    final hadReward = _rewardEntitlementId != null;
    if (_lines.isEmpty && !hadDiscountState && !hadCustomer && !hadReward) return;
    _lines.clear();
    _couponCodes = const [];
    _manualDiscount = null;
    _quote = null;
    _customerId = null;
    _customerDisplayName = null;
    _rewardEntitlementId = null;
    notifyListeners();
  }
}
