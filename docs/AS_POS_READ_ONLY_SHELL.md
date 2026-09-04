# AS POS Read-Only Shell (TASK 12.2)

## Status and authority

- **Task:** TASK 12.2 — canonical Point of Sale workspace migration, read-only phase
- **Scope:** `apps/one/lib/features/pos/` (Flutter Web, feature module of the existing AS ONE app)
- **Reference:** [AS_POS_V1_FOUNDATION.md](AS_POS_V1_FOUNDATION.md) — Phase 1, "Read-only POS shell"
- **Predecessor:** TASK 12.1 (commit `bdf9734`) added the base shell (dashboard,
  navigation, products, inventory, users). TASK 12.2 adds the POS sale surface
  itself (category strip, search, product grid, ticket panel) inside that
  existing shell.
- **TASK 12.2B** corrected visual fidelity against a direct comparison with
  `AS POS V1.html`: a fixed, non-scrolling workspace (only the product grid
  scrolls, matching `.pos-layout{overflow:hidden}`), 400px ticket panel,
  fluid product-grid tiling, and proportions/typography/shadows/out-of-stock
  styling matched to the canonical CSS. No functional scope changed.
- **TASK 12.2C** completed the pixel-faithful migration: the CAJERO/CLIENTE
  mode switch, the search row's four action buttons, the gradient ticket
  header with "Ticket #1" and note/trash icons, and the full `.t-foot`
  (Subtotal/IVA/Total, coupon entry, payment-method selector, cash-received
  input, Cobrar bar) are now rendered at full canonical visual fidelity.
  None of these are wired to any transaction capability — see "Functional
  vs. visual-only controls" below. No functional scope changed.
- **TASK 12.2D** fixed a real overflow (empty-ticket illustration vs. the
  much taller `.t-foot`, reproducible at real desktop browser heights
  ≲720px — the body now scrolls instead, matching `.t-body{overflow-y:
  auto}`), and corrected the sidebar/topbar chrome shared with every other
  module: the `.sb-brand` two-tone "AS+ POS" wordmark and inline online
  indicator, the dark-mode control's canonical location (`.sb-footer`, not
  the topbar), and the topbar avatar's gradient fill. Sidebar accordion
  group-collapse and a fuller topbar rebuild (role label, clock,
  notification bell, AI assistant button) were evaluated and deliberately
  deferred — see "Remaining differences" in the TASK 12.2D report. No
  functional scope changed.
- **TASK 12.2E** completed the deferred shared-chrome work: `pos_navigation.dart`'s
  group names/membership/order/icons now match `.sb-group-header`/
  `.sb-item[data-nav]` exactly (Ventas, Catálogo, Inventario, Clientes, Caja
  y Finanzas, Administración, Sistema); the sidebar is a real single-open
  accordion (`_expandirGrupoDe`/`toggleSbGroup` semantics — opening a group
  closes the others, selecting a module opens its group), starting
  collapsed to the rail by default; `.sb-item.active` is now a solid accent
  fill with white text/icon, not a tint; and the topbar gained the
  "Manager" role label, a live `es-MX`-style clock, an inert notification
  bell, and an inert gradient "Asistente IA" button, while the hamburger is
  now a single always-present control that both toggles the rail and opens
  the mobile drawer. This is shared chrome (every module inherits it) — see
  the TASK 12.2E report's blast-radius section for the regression approach
  taken. No functional scope changed.
- **TASK 12.2F–G** (see [AS_STARTUP_LOGIN_VISUALS.md](AS_STARTUP_LOGIN_VISUALS.md)) ported the
  startup/login flow and did a typography/logo/motion/performance pass —
  outside this document's scope (`apps/one/lib/features/authentication/`),
  noted here only because TASK 12.2G's real Questrial font and shared
  `AsMotion` tokens now apply to this shell's chrome too.
- **TASK 12.3** (see [AS_POS_SALE_ENGINE.md](AS_POS_SALE_ENGINE.md)) is the first task in this
  arc to add real functional scope: products can now be added to the
  ticket, with quantity/remove/merge and reactive Subtotal/IVA/Total. The
  sections below describing the ticket as permanently empty and every
  control as inert are **no longer fully accurate** — see
  AS_POS_SALE_ENGINE.md for what changed; this document's remaining
  content (out-of-stock detection, no-price limitation, coupon/cash/
  payment-method controls, Cobrar) is still current.
- **TASK 12.3A–B** (see [AS_POS_SALE_ENGINE.md](AS_POS_SALE_ENGINE.md)) added the CLIENTE→CAJERO
  authorization gate and the full canonical CLIENTE (self-service) mode:
  a dedicated locked surface (no sidebar/topbar/admin navigation reachable
  while active), greeting/clock header, per-category stacked catalog with
  a jumpbar, help/coupon actions, and a polished authorization modal. The
  "CLIENTE toggle" description below (CAJERO-only, this shell has no
  client-facing mode) is **superseded** — see AS_POS_SALE_ENGINE.md.

This document describes what was implemented, not what is planned. It records
architecture boundaries and known limitations so a later transactional task
does not have to rediscover them.

## Implemented components

All under `apps/one/lib/features/pos/pos_shell.dart` unless noted:

- `_PosSale` — the `PosModule.pos` screen. Wraps content in a `Focus` node
  that intercepts `F2` to jump focus to the product search field, matching
  the canonical shell's keyboard contract.
- `_PosModeSwitch` — the CAJERO/CLIENTE toggle. CAJERO is the only mode
  this shell renders.
- `_PosSearchRow` — the search field (functional) plus the barcode-scan
  affordance and four circular actions (link customer, reprint, suspend,
  cancel) matching `#pos-toolbar-row`.
- `_PosSaleBody` — lays out the mode switch, search row, category strip, and
  product grid; switches between a persistent side ticket panel (`>= 900px`)
  and a collapsible bottom ticket bar (`< 900px`), reusing the same
  `showModalBottomSheet` pattern as the existing mobile navigation drawer.
- `_CategoryStrip` / `_CategoryChip` — horizontal list of active categories
  (from `PosReadController.categories`) plus an "Todas" option, built on
  Flutter's `ChoiceChip` for built-in keyboard and accessibility semantics.
- `_PosProductGrid` / `_PosProductCard` — a fluid tile grid matching the
  canonical `.prod-grid` (auto-fill, ~120px minimum tile); renders a "Sin
  existencia" out-of-stock indicator per product (see below).
- `_TicketPanel` / `_TicketEmptyState` / `_TicketBar` — a fixed-height,
  always-present ticket frame with the canonical gradient header, static
  Producto/Unidades/Total column row, and the `_TicketFooter` (subtotal,
  coupon entry, IVA, total, payment methods, cash input, Cobrar). It only
  ever renders the empty-cart state; there is no cart, no line items, and no
  real total calculation — every amount shown is `$0.00`, an honest empty
  cart rather than fabricated data.

## Functional vs. visual-only controls

Category selection, search filtering, F2 focus, sidebar navigation, and the
dark-mode toggle are fully functional. Every other interactive-looking POS
control (CLIENTE toggle, the four search-row actions, ticket note/trash
icons, coupon field and Aplicar, payment-method buttons, cash-received
input, Desc. button, Cobrar) is rendered at full canonical visual fidelity
but is wired to a shared `_showReadOnlyNotice` helper that surfaces a
"Modo de solo lectura" SnackBar instead of performing any action —
deliberately visible, not removed, per TASK 12.2C's explicit requirement not
to hide unsupported controls.

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

- `GET /api/v1/products` — parses `category_id`, `tax_code`, `effective_price`
  (TASK 12.3C), and, now that the list route batches it in
  (`ProductCatalogRepository.defaultVariants`, mirroring `effectivePrices`'s
  own batched-query pattern — never per-row), a nested `default_variant.id`
  and `default_variant.sku` into `PosProduct.defaultVariantId`/`.sku`. The
  POS sale screen also passes `branch_id` so a branch-specific price
  override resolves ahead of the company-wide default (ADR-0006).
- `GET /api/v1/categories` — new to the POS gateway, gated by the same
  `catalog.read` permission as products.
- `GET /api/v1/inventory/balances` — unchanged; still keyed by
  `product_variant_id`.

## Read-only limitations (deliberate, not oversights)

- **Out-of-stock detection now works against real data.** TASK 12.3C closed
  the gap described in the previous revision of this document: the list
  endpoint previously never populated `default_variant`, so every real
  product's `defaultVariantId` was `null`. It is resolved now (see above),
  so `posIsOutOfStock`/`posAddabilityBlock` (`pos_models.dart`) evaluate real
  stock for real seeded products, not just fixtures. The indicator itself
  (small red text, full card opacity) still follows the canonical
  reference's own cajero-mode convention — its pulsing red "AGOTADO" badge is
  client-mode only (`body.modo-cliente .prod-agotado-badge`), and this shell
  has no client-facing mode.
- **Real prices and tax are now shown on the POS screen** (TASK 12.3C) — see
  [AS_POS_SALE_ENGINE.md](AS_POS_SALE_ENGINE.md). `barcode` and branch-level
  `product_availability` (E060–E061) are still not consumed anywhere in this
  shell: no route batches barcodes into the list response, and no seeded
  catalog data populates availability records, so surfacing either now would
  mean inventing a value with nothing real behind it.
- **The ticket panel is a real, reactive cart** (TASK 12.3, priced for real
  in TASK 12.3C) — see [AS_POS_SALE_ENGINE.md](AS_POS_SALE_ENGINE.md) for its
  full scope and what remains deliberately out (checkout, payment,
  discounts, customer association).
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
- Out-of-stock indicator renders only for a product whose `defaultVariantId`
  matches a zero-quantity balance; unmatched or in-stock products render
  unaffected.
- Loading, empty, and failure states for the product grid (with retry).
- Ticket panel collapses to a bottom bar below the 900px reference
  breakpoint (matching the canonical `.pos-layout` breakpoint) and expands
  back to a persistent side panel above it.
- `F2` moves keyboard focus to the product search field.
- Workspace renders without layout overflow at the 1024, 1440, and 1920px
  reference widths, and preserves POS proportions/legibility in dark mode
  (TASK 12.2B).
- The mode switch, search-row actions, ticket header, and full transactional
  chrome (Subtotal/IVA/Total, payment methods, Cobrar) render at full
  canonical fidelity; tapping any of Cobrar or CLIENTE surfaces the
  read-only notice instead of performing an action (TASK 12.2C).

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
