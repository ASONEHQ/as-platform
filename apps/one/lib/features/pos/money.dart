/// TASK 12.3C: an exact, fixed-point money value.
///
/// ADR-0001 (`docs/adr/0001-money-and-rounding.md`) prohibits binary
/// floating point — JS `number`, Dart `double`, DB floats — as the
/// authoritative representation of money, and requires exact ISO 4217
/// currency and decimal-string HTTP serialization. This type is the Flutter
/// side of that contract: it stores an amount as an integer count of
/// 1/10000ths of the major currency unit (`BigInt`, never `double`),
/// matching the backend's own `numeric(19,4)` scale (see
/// `packages/database/src/schema/catalog.ts`'s `product_prices.amount`)
/// exactly, so parsing the wire value never rounds away precision the
/// backend actually carries. All arithmetic (`+`, multiply-by-quantity,
/// multiply-by-tax-rate) is done in that same integer domain.
library;

/// The decimal scale this type stores internally — 4 fractional digits,
/// matching `numeric(19,4)` (ADR-0001) exactly.
const int moneyScale = 10000;

/// Thrown by [Money.parse] for any string that is not a plain,
/// non-negative decimal with at most 4 fractional digits. Never caught to
/// silently fall back to zero — a caller that wants to treat a malformed
/// amount as "cannot be sold" must catch this explicitly and represent
/// that as its own state, not coerce it to a value.
class MoneyFormatException implements Exception {
  const MoneyFormatException(this.message);
  final String message;

  @override
  String toString() => 'MoneyFormatException: $message';
}

final RegExp _decimalPattern = RegExp(r'^(\d{1,15})(?:\.(\d{1,4}))?$');
final RegExp _currencyPattern = RegExp(r'^[A-Z]{3}$');

/// TASK 14.3 (Wave 1, Part B.3): a non-negative decimal with up to 6
/// fractional digits — the same scale the backend's own held-sale-cart/
/// sale-item `quantity` column carries (never 4, like [Money] itself),
/// used only for [Money.multiplyByDecimalQuantity] below.
final RegExp _quantityDecimalPattern = RegExp(r'^(\d{1,15})(?:\.(\d{1,6}))?$');

class Money {
  const Money._(this._minorUnits, this.currencyCode);

  /// Parses an ADR-0001 decimal string exactly as the backend serializes
  /// it (e.g. `"149.00"`, `"0.0000"`) alongside its ISO 4217 currency code.
  /// Throws [MoneyFormatException] — never silently zero — for a negative,
  /// non-decimal, malformed, or non-3-letter-currency value.
  factory Money.parse(String amount, String currencyCode) {
    final match = _decimalPattern.firstMatch(amount);
    if (match == null) {
      throw MoneyFormatException('"$amount" is not a valid decimal amount.');
    }
    if (!_currencyPattern.hasMatch(currencyCode)) {
      throw MoneyFormatException('"$currencyCode" is not a valid ISO 4217 code.');
    }
    final whole = BigInt.parse(match.group(1)!);
    final fraction = (match.group(2) ?? '').padRight(4, '0');
    final minorUnits =
        whole * BigInt.from(moneyScale) + BigInt.parse(fraction.isEmpty ? '0' : fraction);
    return Money._(minorUnits, currencyCode);
  }

  /// 1/10000th of a unit of [currencyCode] (see [moneyScale]).
  final BigInt _minorUnits;
  final String currencyCode;

  static Money zero(String currencyCode) => Money._(BigInt.zero, currencyCode);

  bool get isZero => _minorUnits == BigInt.zero;
  bool get isPositive => _minorUnits > BigInt.zero;

  Money operator +(Money other) {
    _assertSameCurrency(other);
    return Money._(_minorUnits + other._minorUnits, currencyCode);
  }

  /// TASK 12.5A: cash change/amount-due preview. The result may be
  /// negative (e.g. tendered minus a still-larger total) — check
  /// [isNegative] rather than assuming a sign; this type never clamps or
  /// silently floors at zero.
  Money operator -(Money other) {
    _assertSameCurrency(other);
    return Money._(_minorUnits - other._minorUnits, currencyCode);
  }

  bool get isNegative => _minorUnits < BigInt.zero;

  /// Exact integer scaling — [quantity] is always a whole unit count in
  /// this ticket engine (no fractional-quantity lines exist yet), so this
  /// is plain `BigInt` multiplication, never floating point.
  Money operator *(int quantity) => Money._(_minorUnits * BigInt.from(quantity), currencyCode);

  /// Multiplies by a tax rate expressed as an exact integer count of
  /// basis points (e.g. `1600` for 16.00%) — never a `double` rate — then
  /// divides back down to the original scale, rounding half-up.
  Money multiplyByRateBasisPoints(int basisPoints) {
    final numerator = _minorUnits * BigInt.from(basisPoints);
    const denominator = 10000;
    final rounded =
        (numerator + BigInt.from(denominator ~/ 2)) ~/ BigInt.from(denominator);
    return Money._(rounded, currencyCode);
  }

  /// TASK 14.3 (Wave 1, Part B.3): multiplies by an exact decimal
  /// quantity carrying up to 6 fractional digits — e.g. a weight-based
  /// line's `"2.350000"` kg — never a `double`. Both operands stay exact
  /// `BigInt`s: this money's own 4-decimal minor units times the
  /// quantity's 6-decimal micro-units, then divided back down to this
  /// money's own scale, rounding half-up exactly like
  /// [multiplyByRateBasisPoints]. Throws [MoneyFormatException] for a
  /// negative or malformed [quantity] — a weight-based line total is
  /// never silently computed from garbage input.
  Money multiplyByDecimalQuantity(String quantity) {
    final match = _quantityDecimalPattern.firstMatch(quantity.trim());
    if (match == null) {
      throw MoneyFormatException('"$quantity" is not a valid decimal quantity.');
    }
    final whole = BigInt.parse(match.group(1)!);
    final fraction = (match.group(2) ?? '').padRight(6, '0');
    final quantityMicros =
        whole * BigInt.from(1000000) + BigInt.parse(fraction.isEmpty ? '0' : fraction);
    final numerator = _minorUnits * quantityMicros;
    const denominator = 1000000;
    final rounded = (numerator + BigInt.from(denominator ~/ 2)) ~/ BigInt.from(denominator);
    return Money._(rounded, currencyCode);
  }

  void _assertSameCurrency(Money other) {
    if (other.currencyCode != currencyCode) {
      throw StateError(
        'Cannot combine ${other.currencyCode} with $currencyCode.',
      );
    }
  }

  /// The exact 2-decimal display amount (e.g. `"149.00"`) — rounds
  /// half-up from the internal 4-decimal scale using integer division
  /// only, never `double`.
  String toDisplayString() {
    final centavos =
        (_minorUnits + BigInt.from(50)) ~/ BigInt.from(100);
    final negative = centavos < BigInt.zero;
    final magnitude = negative ? -centavos : centavos;
    final pesos = magnitude ~/ BigInt.from(100);
    final cents = (magnitude % BigInt.from(100)).toString().padLeft(2, '0');
    return '${negative ? '-' : ''}$pesos.$cents';
  }

  /// The exact 4-decimal wire format (ADR-0001) — what this value must be
  /// serialized as when *sent back* to the backend (e.g. TASK 12.5A's
  /// `tendered_amount`), never the rounded 2-decimal [toDisplayString].
  String toApiString() {
    final negative = _minorUnits < BigInt.zero;
    final magnitude = negative ? -_minorUnits : _minorUnits;
    final whole = magnitude ~/ BigInt.from(moneyScale);
    final fraction = (magnitude % BigInt.from(moneyScale)).toString().padLeft(4, '0');
    return '${negative ? '-' : ''}$whole.$fraction';
  }

  @override
  bool operator ==(Object other) =>
      other is Money &&
      other._minorUnits == _minorUnits &&
      other.currencyCode == currencyCode;

  @override
  int get hashCode => Object.hash(_minorUnits, currencyCode);

  @override
  String toString() => '${toDisplayString()} $currencyCode';
}
