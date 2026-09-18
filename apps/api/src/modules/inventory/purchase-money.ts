/**
 * TASK 12.2 — the exact decimal-arithmetic helpers `purchase-receipt.ts`
 * (TASK 14.3, direct purchases) already established, extracted verbatim
 * into their own tiny shared module so `purchase-order-receipt.ts` (this
 * task's new PO receiving path) can reuse the SAME byte-identical math —
 * never a second, possibly-drifting implementation of decimal quantity/
 * money scaling. Both `quantity` (numeric(19,6)) and `unit_cost`/
 * `total_cost`/`line_total` (numeric(19,4)) scales below match
 * `direct_purchases`/`purchase_orders`/`purchase_order_lines` exactly.
 */

export const QUANTITY_SCALE = 1_000_000n; // numeric(19,6).
export const MONEY_SCALE = 10_000n; // numeric(19,4).

export function decimalUnits(value: string, scale: bigint, digits: number): bigint {
  const [whole = '', fraction = ''] = value.split('.');
  const wholeDigits = whole.length === 0 ? '0' : whole;
  const fractionDigits = fraction.padEnd(digits, '0').slice(0, digits);
  return BigInt(wholeDigits) * scale + BigInt(fractionDigits.length === 0 ? '0' : fractionDigits);
}
export function formatUnits(units: bigint, scale: bigint, digits: number): string {
  const negative = units < 0n;
  const magnitude = negative ? -units : units;
  const whole = magnitude / scale;
  const fraction = (magnitude % scale).toString().padStart(digits, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fraction}`;
}
export function quantityUnits(value: string): bigint {
  return decimalUnits(value, QUANTITY_SCALE, 6);
}
export function formatQuantity(units: bigint): string {
  return formatUnits(units, QUANTITY_SCALE, 6);
}
export function moneyUnits(value: string): bigint {
  return decimalUnits(value, MONEY_SCALE, 4);
}
export function formatMoney(units: bigint): string {
  return formatUnits(units, MONEY_SCALE, 4);
}
/** Same round-half-up algorithm `refunds.service.ts`'s own
 * `multiplyMoneyByQuantity` established — reused for the exact same
 * reason: a money amount times a quantity must round consistently
 * everywhere it is computed, never a second, possibly-drifting
 * implementation. */
export function extendedCostUnits(unitCostUnits: bigint, qtyUnits: bigint): bigint {
  const numerator = unitCostUnits * qtyUnits;
  return (numerator + QUANTITY_SCALE / 2n) / QUANTITY_SCALE;
}
