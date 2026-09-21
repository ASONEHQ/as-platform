import 'package:flutter/foundation.dart';

import 'money.dart';
import 'pos_held_sales_gateway.dart';
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
    this.weightQuantity,
    this.unitOfMeasureCode = 'unit',
  }) : assert(quantity > 0, 'A ticket line must have a positive quantity.');

  final String productId;
  final String name;
  final String sku;

  /// Whole-unit count — always `1` (never incremented) for a
  /// [isWeightBased] line; [weightQuantity] carries that line's real
  /// quantity instead. Kept non-nullable/positive so every pre-existing
  /// whole-unit call site is unaffected.
  final int quantity;
  final Money unitPrice;
  final String taxCode;

  /// TASK 14.3 (Wave 1, Part B.3): non-`null` only for a weight-based
  /// (`kg`/`g`, see `posIsWeightBased`) line — the cashier-entered exact
  /// decimal weight (up to 6 fractional digits, matching the backend's
  /// own sale-item/held-sale-cart quantity scale), e.g. `"2.350000"`.
  /// Never derived from [quantity], which stays a meaningless `1` for
  /// this kind of line.
  final String? weightQuantity;

  /// The default variant's own `unit_of_measure_code` this line was
  /// added under (e.g. `kg`, `g`) — `'unit'` for a plain whole-unit line.
  final String unitOfMeasureCode;

  bool get isWeightBased => weightQuantity != null;

  Money get subtotal =>
      weightQuantity != null ? unitPrice.multiplyByDecimalQuantity(weightQuantity!) : unitPrice * quantity;

  /// The exact quantity this line must be sent to the backend as (`POST
  /// /sales`, `POST /sales/pricing-quotes`, `POST /held-sale-carts`) —
  /// the real decimal weight for a weight-based line, the plain
  /// whole-unit count otherwise. Never `line.quantity.toString()` alone,
  /// which would silently drop a weight-based line's real quantity.
  String get quantityForApi => weightQuantity ?? quantity.toString();

  /// A human-readable quantity for the ticket UI — e.g. `"2.350 kg"` for
  /// a weight-based line (trims trailing fractional zeros down to a
  /// minimum of 3 decimals, a real weight-display convention, never
  /// rounded to a whole number), or the plain unit count otherwise.
  String get displayQuantity {
    final weight = weightQuantity;
    if (weight == null) return '$quantity';
    return '${_trimWeightDisplay(weight)} $unitOfMeasureCode';
  }

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
    weightQuantity: weightQuantity,
    unitOfMeasureCode: unitOfMeasureCode,
  );
}

String _trimWeightDisplay(String value) {
  final parts = value.split('.');
  if (parts.length == 1) return value;
  var fraction = parts[1];
  while (fraction.length > 3 && fraction.endsWith('0')) {
    fraction = fraction.substring(0, fraction.length - 1);
  }
  return '${parts[0]}.$fraction';
}

final RegExp _weightMicrosPattern = RegExp(r'^(\d{1,9})(?:\.(\d{1,6}))?$');

/// Parses an exact decimal weight string into an integer count of
/// 1/1,000,000ths — matching the backend's own sale-item/held-sale-cart
/// quantity scale (never `double`). `null` for a malformed, empty, or
/// negative value.
BigInt? _parseWeightMicros(String value) {
  final match = _weightMicrosPattern.firstMatch(value.trim());
  if (match == null) return null;
  final whole = BigInt.parse(match.group(1)!);
  final fraction = (match.group(2) ?? '').padRight(6, '0');
  return whole * BigInt.from(1000000) + BigInt.parse(fraction.isEmpty ? '0' : fraction);
}

String _formatWeightMicros(BigInt micros) {
  final whole = micros ~/ BigInt.from(1000000);
  final fraction = (micros % BigInt.from(1000000)).toString().padLeft(6, '0');
  return '$whole.$fraction';
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

  // TASK 14.3 (Wave 1, Part B.4): an optional, cashier-entered note for
  // this ticket — plain *intent*, threaded straight into `POST /sales`'s
  // own optional `note` field (frozen at creation, never edited after —
  // see `sales.routes.ts`'s own doc comment on `SaleBody.note`). `null`/
  // empty means no note, exactly matching every sale created before this
  // task.
  String? _note;

  String? get note => _note;

  void setNote(String? value) {
    final normalized = (value == null || value.trim().isEmpty) ? null : value.trim();
    if (normalized == _note) return;
    _note = normalized;
    notifyListeners();
  }

  // TASK 14.3 (Wave 1, Part B.1): non-`null` only while this ticket was
  // built by resuming a held-sale cart (see [resumeFromHeldCart]) —
  // carries the cart's own id forward so the checkout path can call the
  // real `POST /held-sale-carts/{id}/link-sale` handshake once the
  // resulting sale genuinely exists (see `held-sales.routes.ts`'s own
  // doc comment on `link-sale`). Cleared on [clearAll] exactly like every
  // other per-ticket intent above.
  String? _resumedHeldCartId;

  String? get resumedHeldCartId => _resumedHeldCartId;

  // TASK 16.15: which physical cash register the cashier is currently
  // operating — a convenience UX selection only (see `SessionContext.
  // permittedRegisterIds`'s own doc comment; the backend independently
  // re-verifies register scope on every request), threaded straight into
  // `POST /sales`'s own optional `cash_register_id` (see `pos_shell.dart`'s
  // `_submitSaleForPayment`/`_submitCashSaleForPayment`/
  // `_submitZeroTotalSale`, all three of which already receive this same
  // `SaleSession`). Deliberately NOT cleared by [clearAll] — mirrors
  // [_currencyCode]'s own "survives across tickets" rationale: the
  // cashier's physical register doesn't change just because they rang a
  // new sale. `null` reproduces the exact pre-TASK-16.15 behavior (no
  // register id ever sent). See `pos_register_scope.dart` for how the one
  // real caller (`_PosSaleState`) resolves and applies this.
  String? _cashRegisterId;

  String? get cashRegisterId => _cashRegisterId;

  void setCashRegister(String? registerId) {
    if (_cashRegisterId == registerId) return;
    _cashRegisterId = registerId;
    notifyListeners();
  }

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

  /// TASK 14.3 (Wave 1, Part B.3): adds a weight-based (`kg`/`g`, see
  /// `posIsWeightBased`) [product] as a line carrying the cashier-entered
  /// [weightDecimal] (an exact decimal string, up to 6 fractional digits)
  /// as its real quantity, instead of the whole-unit `1` [addProduct]
  /// always uses. Merges into an existing line for the same product by
  /// SUMMING the weight (never overwriting it) — mirrors [addProduct]'s
  /// own dedupe-by-product-id behavior. Returns `false`, changing
  /// nothing, for the same reasons [addProduct] can refuse, or when
  /// [weightDecimal] itself is missing/zero/malformed.
  bool addWeightedProduct(
    PosProduct product,
    String weightDecimal,
    List<PosInventoryBalance> balances,
  ) {
    if (posAddabilityBlock(product, balances) != null) return false;
    final unitPrice = product.pricing.amount;
    final taxCode = product.taxCode;
    if (unitPrice == null || taxCode == null) return false;
    final parsed = _parseWeightMicros(weightDecimal);
    if (parsed == null || parsed <= BigInt.zero) return false;
    if (_lines.isNotEmpty && unitPrice.currencyCode != _currencyCode) {
      throw StateError(
        'Cannot add a ${unitPrice.currencyCode} line to a $_currencyCode ticket.',
      );
    }
    _currencyCode = unitPrice.currencyCode;
    final unitOfMeasureCode = product.unitOfMeasureCode ?? 'unit';
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
          weightQuantity: _formatWeightMicros(parsed),
          unitOfMeasureCode: unitOfMeasureCode,
        ),
      );
    } else {
      final existing = _lines[index];
      final existingMicros = _parseWeightMicros(existing.weightQuantity ?? '0') ?? BigInt.zero;
      _lines[index] = SaleLine(
        productId: existing.productId,
        name: existing.name,
        sku: existing.sku,
        quantity: existing.quantity,
        unitPrice: existing.unitPrice,
        taxCode: existing.taxCode,
        weightQuantity: _formatWeightMicros(existingMicros + parsed),
        unitOfMeasureCode: existing.unitOfMeasureCode,
      );
    }
    _quote = null;
    notifyListeners();
    return true;
  }

  /// TASK 14.3 (Wave 1, Part B.1): repopulates this (freshly-cleared)
  /// ticket from a resumed held-sale cart's raw `{product_id, quantity}`
  /// pairs — never trusting a stale snapshot: each item's price/name/tax
  /// code is re-resolved fresh through [products], the exact same
  /// currently-loaded catalog the product grid itself uses (see
  /// `held-sales.service.ts`'s own `resumeCart` doc comment — resuming
  /// always re-prices fresh through the real catalog; this only rebuilds
  /// the CLIENT-side ticket so the cashier can see/adjust it before that
  /// real re-price happens at `POST /sales` time). Records [cartId] so
  /// the checkout path can later call the real `link-sale` handshake.
  /// Returns the ids of any items that could not be restored (product no
  /// longer found in [products], or no longer addable per
  /// [posAddabilityBlock]) — the caller must surface these honestly,
  /// never silently drop them.
  List<String> resumeFromHeldCart({
    required String cartId,
    required List<PosHeldSaleCartItem> items,
    required List<PosProduct> products,
    required List<PosInventoryBalance> balances,
  }) {
    clearAll();
    final skipped = <String>[];
    for (final item in items) {
      PosProduct? product;
      for (final candidate in products) {
        if (candidate.id == item.productId) {
          product = candidate;
          break;
        }
      }
      if (product == null) {
        skipped.add(item.productId);
        continue;
      }
      if (posIsWeightBased(product)) {
        if (!addWeightedProduct(product, item.quantity, balances)) {
          skipped.add(item.productId);
        }
        continue;
      }
      final micros = _parseWeightMicros(item.quantity);
      final wholeUnits = micros == null || micros % BigInt.from(1000000) != BigInt.zero
          ? null
          : (micros ~/ BigInt.from(1000000)).toInt();
      if (wholeUnits == null || wholeUnits <= 0) {
        skipped.add(item.productId);
        continue;
      }
      var addedAny = false;
      for (var i = 0; i < wholeUnits; i++) {
        if (addProduct(product, balances)) addedAny = true;
      }
      if (!addedAny) skipped.add(item.productId);
    }
    _resumedHeldCartId = cartId;
    notifyListeners();
    return skipped;
  }

  void increaseQuantity(String productId) {
    final index = _lines.indexWhere((line) => line.productId == productId);
    if (index == -1 || _lines[index].isWeightBased) return;
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
    if (index == -1 || _lines[index].isWeightBased) return;
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
  ///
  /// TASK 14.3 (Wave 1, Part B): also clears any sale note and any
  /// resumed-held-cart id, for the same reason — both belong to the
  /// ticket that just completed (or was suspended again) and can never
  /// legitimately carry over to a brand-new one.
  void clearAll() {
    final hadDiscountState =
        _couponCodes.isNotEmpty || _manualDiscount != null || _quote != null;
    final hadCustomer = _customerId != null;
    final hadReward = _rewardEntitlementId != null;
    final hadNoteOrResume = _note != null || _resumedHeldCartId != null;
    if (_lines.isEmpty && !hadDiscountState && !hadCustomer && !hadReward && !hadNoteOrResume) {
      return;
    }
    _lines.clear();
    _couponCodes = const [];
    _manualDiscount = null;
    _quote = null;
    _customerId = null;
    _customerDisplayName = null;
    _rewardEntitlementId = null;
    _note = null;
    _resumedHeldCartId = null;
    notifyListeners();
  }
}
