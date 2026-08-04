# AS POS Read-Only Shell (TASK 12.2)

## Status and authority

- **Task:** TASK 12.2 — canonical Point of Sale workspace migration, read-only phase
- **Scope:** `apps/one/lib/features/pos/` (Flutter Web, feature module of the existing AS ONE app)
- **Reference:** [AS_POS_V1_FOUNDATION.md](AS_POS_V1_FOUNDATION.md) — Phase 1, "Read-only POS shell"
- **Predecessor:** TASK 12.1 (commit `bdf9734`) added the base shell (dashboard,
  navigation, products, inventory, users). TASK 12.2 adds the POS sale surface
  itself (category strip, search, product grid, ticket panel) inside that
  existing shell.

This document describes what was implemented, not what is planned. It records
architecture boundaries and known limitations so a later transactional task
does not have to rediscover them.

## Implemented components

All under `apps/one/lib/features/pos/pos_shell.dart` unless noted:

- `_PosSale` — the `PosModule.pos` screen. Wraps content in a `Focus` node
  that intercepts `F2` to jump focus to the product search field, matching
  the canonical shell's keyboard contract.
- `_PosSaleBody` — lays out the category strip, search field, and product
  grid; switches between a persistent side ticket panel (`>= 1000px`) and a
  collapsible bottom ticket bar (`< 1000px`), reusing the same
  `showModalBottomSheet` pattern as the existing mobile navigation drawer.
- `_CategoryStrip` / `_CategoryChip` — horizontal list of active categories
  (from `PosReadController.categories`) plus an "Todas" option, built on
  Flutter's `ChoiceChip` for built-in keyboard and accessibility semantics.
- `_PosProductGrid` / `_PosProductCard` — reuses the existing responsive
  column-count breakpoints from the Products screen; renders an "Agotado"
  (out of stock) badge per product (see below).
- `_TicketPanel` / `_TicketEmptyState` / `_TicketBar` — a fixed-height,
  always-present ticket frame. It only ever renders the empty state; there is
  no cart, no line items, and no total calculation.

## Architecture boundaries

- No new state-management or routing framework was introduced. POS is a
  `PosModule` selected inside `PosShell`'s existing internal
  `StatefulWidget` state — not a separate `go_router` route.
- All data flows through the existing `PosReadGateway` /
  `PosReadController` pattern. `PosCategory` and `PosReadController.categories`
  /`loadCategories()` were added following the exact template already used by
  `products`, `balances`, and `users`.
- No business logic lives in widgets. Filtering (`_PosSaleBody._filter`) and
  out-of-stock matching (`_PosProductGrid._isOutOfStock`) are pure, tested
  static functions operating on controller state — they do not call the
  gateway or perform I/O.
- No tenant, authority, or permission values are hard-coded in widgets;
  `catalog.read` gating reuses the existing `_PermissionState` widget already
  used by Products and Inventory.

## Data source behavior

The POS screen calls three read endpoints on selection, via
`PosReadController`: `loadProducts()`, `loadCategories()`, and
`loadBalances(branchId: ...)`. These are the same endpoints the Products and
Inventory screens already use — no new backend surface was added.

- `GET /api/v1/products` — now also parses `category_id` and, when present,
  a nested `default_variant.id` into `PosProduct.defaultVariantId`.
- `GET /api/v1/categories` — new to the POS gateway, gated by the same
  `catalog.read` permission as products.
- `GET /api/v1/inventory/balances` — unchanged; still keyed by
  `product_variant_id`.

## Read-only limitations (deliberate, not oversights)

- **Out-of-stock detection depends on `default_variant.id`, which the list
  endpoint does not populate today.** `GET /api/v1/products` returns
  `ProductRow` fields only; `default_variant` is only expanded by the
  single-item `GET /api/v1/products/:id` detail endpoint. `_isOutOfStock`
  is fully implemented and unit-tested against fixtures, but in production,
  every product's `defaultVariantId` is currently `null`, so the "Agotado"
  badge will not appear for any real product until the backend adds a
  variant projection to the list endpoint. This was a deliberate choice over
  fabricating a client-side products↔balances join or a fake price/stock
  field — see the "Backend gaps" section of
  [AS_POS_V1_FOUNDATION.md](AS_POS_V1_FOUNDATION.md).
- **No price is shown anywhere on the POS screen.** There is no approved
  price or tax read endpoint yet (see the same backend-gaps section).
- **The ticket panel is permanently empty.** There is no cart state, no
  quantity, no discount, no customer association, and no checkout — matching
  TASK 12.2's explicit scope.
- **`pos_tokens.dart` sets `fontFamily: 'Questrial'`, but no such font asset
  is declared in `apps/one/pubspec.yaml`.** This predates TASK 12.2 (same
  class of gap as an already-fixed SF Pro issue elsewhere in AS ONE+) and was
  left unaddressed here because it is out of this task's scope; noted for a
  future task rather than silently patched.

## Test coverage

`apps/one/test/pos_shell_test.dart`, `group('Punto de Venta (TASK 12.2)')`:

- Shell renders category strip, search, product grid, and empty ticket panel.
- Category selection filters the product grid; "Todas" clears the filter.
- Search filters the product grid by name.
- Out-of-stock badge renders only for a product whose `defaultVariantId`
  matches a zero-quantity balance; unmatched or in-stock products render
  unaffected.
- Loading, empty, and failure states for the product grid (with retry).
- Ticket panel collapses to a bottom bar below the 1000px reference
  breakpoint and expands back to a persistent side panel above it.
- `F2` moves keyboard focus to the product search field.

`apps/one/test/pos_read_gateway_test.dart` was extended to assert
`categories()` and the `category_id` field on `products()`.

## Deferred transactional work (explicitly out of scope here)

Cart mutations, quantity changes, discounts, coupons, price overrides,
customer association, checkout, payments, cash-session mutations, sale
creation or completion, inventory mutations, offline command submission,
receipts, printing, suspended sales, returns, new backend endpoints, schema
changes, migrations, and realtime/WebSocket transport. These belong to
Phase 2 onward in
[AS_POS_V1_FOUNDATION.md](AS_POS_V1_FOUNDATION.md#recommended-implementation-phases).
