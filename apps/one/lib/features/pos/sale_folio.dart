/// TASK 12.5B.1: a short, display-only folio derived from the canonical
/// `sale_number`.
///
/// The backend's `sale_number` is generated once, at sale creation, as
/// `SALE-<sale.id with hyphens removed, lowercase>` (see
/// `apps/api/src/modules/sales/sales.service.ts`) — the exact same
/// `PREFIX-<32-hex-char UUID>` shape the inventory module's
/// `movement_number` already documents (`docs/API_CONTRACTS.md`, "Movement
/// number"). It is the sale's own canonical, immutable, globally-unique
/// (per `UNIQUE(company_id, branch_id, sale_number)`) reference — used for
/// every API operation, filter, and cross-reference — and this task does
/// not change it, its database column, or its uniqueness contract in any
/// way.
///
/// That canonical value is 37 characters long, which wraps across lines on
/// an 80mm thermal receipt and crowds a compact dialog row. [displaySaleFolio]
/// derives a short, human-friendlier form *purely* from that existing
/// string, for on-screen/printed display only:
///
/// - **Deterministic**: a pure function of `sale_number` — the same sale
///   always produces the same display folio.
/// - **Stable for the life of the Sale**: `sale_number` itself never
///   changes after creation, so neither does its derived display folio.
/// - **Never random**: no randomness, timestamp, or render-time state is
///   involved — calling it twice for the same sale always returns the same
///   string.
/// - **Not guaranteed globally unique**: it keeps only the last 8 hex
///   characters (32 bits) of the sale's own UUID. Two different sales can,
///   in principle, share a display folio — the odds become non-negligible
///   only after tens of thousands of sales at a single company (a 32-bit
///   birthday-bound: ~50% chance of one collision anywhere in that
///   population), but it is not exact, so this value must never be used
///   to look up, filter, or address a specific sale. Every API call and
///   every internal reference continues to use the full canonical
///   `sale_number`/`sale.id` — this function is display-only and its
///   result must never be sent back to the backend.
///
/// Given `sale_number = "SALE-2517abd73ecf44a2b2206f4eadfeee49"` (the real
/// TASK 12.5B QA sale), this returns `"SALE-ADFEEE49"` — the trailing 8 hex
/// characters of the sale's own UUID, upper-cased for readability.
library;

/// Derives the short, display-only folio for [saleNumber]. See the library
/// doc comment above for the full contract (deterministic, stable,
/// display-only, not guaranteed unique).
///
/// Accepts the canonical `SALE-<32 hex chars>` shape and strips the known
/// `SALE-` prefix before taking the trailing 8 characters; if a future or
/// unexpected value does not start with that prefix (or is shorter than 8
/// characters), this still degrades gracefully to the trailing characters
/// of whatever string was actually given — it never throws and never
/// returns an empty string for a non-empty input.
String displaySaleFolio(String saleNumber) {
  const prefix = 'SALE-';
  final body = saleNumber.startsWith(prefix) ? saleNumber.substring(prefix.length) : saleNumber;
  final tail = body.length > 8 ? body.substring(body.length - 8) : body;
  return 'SALE-${tail.toUpperCase()}';
}
