/// TASK 14.3 (Wave 4, "Órdenes de compra"): a short, display-only folio
/// derived from the canonical `order_number` — the exact same contract as
/// `sale_folio.dart`'s own [displaySaleFolio], just for purchase orders.
/// See that file's own doc comment for the full rationale; this one only
/// restates what differs.
///
/// The backend's `order_number` is generated once, at purchase-order
/// creation, as `PO-<order.id with hyphens removed, lowercase>` — the same
/// `PREFIX-<32-hex-char UUID>` shape `sale_number`/`movement_number`
/// already establish across this codebase. It is the order's own
/// canonical, immutable reference — used for every API operation, filter,
/// and cross-reference — and this file never changes it, its database
/// column, or its uniqueness contract in any way.
///
/// [displayPurchaseOrderNumber] derives a short, human-friendlier form
/// *purely* from that existing string, for on-screen display only:
///
/// - **Deterministic**: a pure function of `order_number` — the same order
///   always produces the same display folio.
/// - **Stable for the life of the order**: `order_number` itself never
///   changes after creation, so neither does its derived display folio.
/// - **Never random**: no randomness, timestamp, or render-time state is
///   involved — calling it twice for the same order always returns the
///   same string.
/// - **Not guaranteed globally unique**: it keeps only the last 8 hex
///   characters (32 bits) of the order's own UUID — see
///   [displaySaleFolio]'s own doc comment for the exact same birthday-bound
///   caveat, which applies identically here. This value must never be used
///   to look up, filter, or address a specific purchase order — every API
///   call and every internal reference continues to use the full canonical
///   `order_number`/order `id`; this function is display-only and its
///   result must never be sent back to the backend.
library;

/// Derives the short, display-only folio for [orderNumber]. See the
/// library doc comment above for the full contract (deterministic, stable,
/// display-only, not guaranteed unique).
///
/// Accepts the canonical `PO-<32 hex chars>` shape and strips the known
/// `PO-` prefix before taking the trailing 8 characters; if a future or
/// unexpected value does not start with that prefix (or is shorter than 8
/// characters), this still degrades gracefully to the trailing characters
/// of whatever string was actually given — it never throws and never
/// returns an empty string for a non-empty input.
String displayPurchaseOrderNumber(String orderNumber) {
  const prefix = 'PO-';
  final body = orderNumber.startsWith(prefix) ? orderNumber.substring(prefix.length) : orderNumber;
  final tail = body.length > 8 ? body.substring(body.length - 8) : body;
  return 'PO-${tail.toUpperCase()}';
}
