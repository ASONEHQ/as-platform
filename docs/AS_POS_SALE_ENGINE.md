# AS POS Sale Engine (TASK 12.3)

## Status and authority

- **Task:** TASK 12.3 — the first fully working sale ticket. Not
  checkout: the engine that powers the ticket (add/quantity/remove/
  merge/totals), reactively, with no payment behind it yet.
- **Scope:** `apps/one/lib/features/pos/` (Flutter Web) — no backend,
  schema, migration, or API contract changes. No layout, color,
  typography, navigation, animation, or theme changes — TASK 12.2's
  approved visuals are the canonical AS POS shell and were not touched.
- **Reference:** the same canonical `AS POS V1.html` used throughout
  TASK 12.2 (SHA-256 `c7fc92d8…16ace`, unchanged) — specifically its
  `renderTicket()`/`.t-item`/`.qty-stepper`/`.tqty` line-item structure,
  ported for the first time here (TASK 12.2 only ever rendered the empty
  state, since there was no engine behind it yet).
- **Predecessor:** TASK 12.2 ([AS_POS_READ_ONLY_SHELL.md](AS_POS_READ_ONLY_SHELL.md)) built the
  read-only shell; TASK 12.2B–G ([AS_STARTUP_LOGIN_VISUALS.md](AS_STARTUP_LOGIN_VISUALS.md)) refined
  its fidelity. TASK 12.3 is the first task in this arc to add real,
  stateful, non-visual business logic.

## What TASK 12.3 implements

- **`SaleSession`** (`lib/features/pos/sale_session.dart`) — the single
  source of truth for the current ticket. A `ChangeNotifier`, owned once
  by `_PosSaleState` (survives rebuilds; not a scattered `build()`-local
  variable). `SaleLine` holds exactly the required fields: `productId`,
  `name`, `sku`, `quantity`, `unitPrice`, plus a computed `subtotal`.
  `SaleSession` computes `subtotal`/`iva`/`total` centrally — no widget
  recomputes these itself.
- **Add / merge** — tapping a product card calls `SaleSession.addProduct`,
  which merges into an existing line (increments quantity) instead of
  duplicating one, matching the task's explicit requirement.
- **Increase / decrease / remove** — the ticket's `.tqty`-style
  minus/plus buttons and its trash button call `increaseQuantity`/
  `decreaseQuantity`/`removeLine`; decreasing to 0 removes the line
  (matching V1's own `decQty()`).
- **Reactive totals, no manual refresh** — `_TicketPanel`/
  `_ClienteTicketPreview` each wrap their content in a single
  `ListenableBuilder(listenable: saleSession, ...)`, scoped to just that
  panel (not the product grid/search beside it) so the rest of the screen
  doesn't rebuild on every ticket change.
- **Cobrar** — now shows the real, reactive total (`Cobrar — $X.XX`
  instead of a static `$0.00`), but tapping it always shows the exact
  required message **"Disponible en TASK 12.4"** — payment itself is out
  of scope here.

## The pricing limitation (TASK 12.3, superseded by TASK 12.3C)

**`unitPrice` defaulted to `0` for every line.** Confirmed by inspection
before writing any code: there was no `price`/`sale_price`/`tax`/`iva`
column anywhere in `packages/database`, no such field in
`GET /api/v1/products`'s response shape, and no such field parsed by
`PosProduct.fromJson`. This was the exact same "$0.00, not fabricated"
convention the ticket panel used since TASK 12.2C for its static totals —
extended here to real, non-empty lines. The **engine** (add, merge,
quantity, subtotal/IVA/total math) was fully real and correct at the time;
what was missing was a backend price source to feed it.

## TASK 12.3C — real backend prices and tax close the gap

`packages/database/src/schema/catalog.ts`'s `product_prices` table and
`products.tax_code` (see `docs/API_CONTRACTS.md` §14.2) now give
`GET /api/v1/products` a real `effective_price`/`tax_code` per item. This
engine consumes them instead of a placeholder:

- **`Money`** (`lib/features/pos/money.dart`) — an exact fixed-point value
  (`BigInt`-backed, never a Dart `double`), matching ADR-0001 and the
  backend's own `numeric(19,4)` scale. `SaleLine.unitPrice`/`.subtotal` and
  `SaleSession.subtotal`/`.iva`/`.total` are all `Money`.
- **`PosPricing`** (`pos_models.dart`) — parses `effective_price` into one
  of four honest states: `valid`, `free` (a real, intentional `$0.00`),
  `missing` (`effective_price: null` — no active price yet), or
  `malformed` (a price row existed but failed to parse). Missing and free
  are never conflated.
- **`posIvaBasisPointsFor(taxCode)`** replaces the old single flat
  `posIvaRate` multiplier: each `SaleLine` carries its own `taxCode` and
  computes its own IVA from it, so `SaleSession.iva` is a real sum of
  per-line tax, not one rate applied blindly to the whole ticket. The rate
  mapping (`IVA_GENERAL` 16%, `IVA_EXEMPT` 0%) is still a Flutter-side
  federal-law constant — the backend returns a *classification*, not a
  computed rate, matching the pre-existing `posIvaRate` precedent's own
  reasoning, just applied per line now instead of once.
- **`posAddabilityBlock(product, balances)`** (`pos_models.dart`) — the one
  function CAJERO and CLIENTE both gate `addProduct` taps through: out of
  stock, missing price, malformed price, and an unrateable tax code all
  block a tap the same way, with the same notice message, in both modes.
  `SaleSession.addProduct` re-checks it itself as a defensive backstop —
  the backend remains the pricing authority; the UI gate is a courtesy,
  not the only guard.
- The product tile's previously-empty price line (the canonical
  reference's own `.prod-precio`, left blank in TASK 12.3 for lack of
  data) now shows the real price, or an honest "Sin precio"/"Precio
  inválido" caption instead of `$0.00` for a missing/malformed one.

`default_variant` (variant id + SKU) is now also batched into the list
response (`ProductCatalogRepository.defaultVariants`, mirroring
`effectivePrices`'s own batching) — see
[AS_POS_READ_ONLY_SHELL.md](AS_POS_READ_ONLY_SHELL.md) for that gap's
closure. `barcode` and branch-level availability (E060–E061) remain
unconsumed: no route batches barcodes into this response and no seeded
data populates availability, so nothing real exists yet to show.

## CLIENTE mode — shared state, read-only preview (addendum)

CAJERO and CLIENTE **always observe the exact same `SaleSession`
instance** — never a copy, never reset on mode switch (see
`pos_shell_test.dart`'s "CAJERO and CLIENTE observe the exact same
SaleSession" test, which proves this directly: lines added in CAJERO
appear in CLIENTE, and a removal in CAJERO is reflected in CLIENTE,
without switching modes twice or losing state). Toggling
CAJERO/CLIENTE only swaps which *view* renders over that one session:

- **CAJERO** (`_TicketPanel`) — full read/write control, unchanged from
  TASK 12.2/12.2C-G.
- **CLIENTE** (`_ClienteTicketPreview`) — the same lines/quantities/
  totals, entirely read-only: no quantity steppers, no remove buttons, no
  coupon/cash-received fields, no Efectivo/Tarjeta/Transfer grid, no
  "Nota de venta"/"Limpiar ticket" actions. Per the explicit business
  rule, **CLIENTE is card-payment-only** and must never expose cash,
  transfer, manual discounts, refunds, or any administrative/cashier
  control. The single payable action is a card-payment button
  (`_ClienteCardPaymentButton`) — itself still inert for TASK 12.3.

Calculations are never duplicated: both surfaces read the identical
`saleSession.subtotal`/`.iva`/`.total` getters; nothing is recomputed
inside a cashier-only or customer-only widget.

## Read-only limits (explicit, not oversights)

- **Payment is not implemented.** Cobrar (CAJERO) and the card-payment
  button (CLIENTE) are both visually complete and inert. No approved
  payment is simulated, no discount/refund logic exists, and no provider
  transaction id is fabricated anywhere in this task.
- **No persistence.** `SaleSession` is purely in-memory, scoped to the
  `_PosSale` widget's lifetime. There is no sale record, no backend
  submission, and no inventory effect from adding/removing lines.
- **Coupon, cash-received, and the payment-method grid are unchanged**
  from TASK 12.2C — still visually faithful, still wired to the generic
  read-only notice. They were not in TASK 12.3's explicit scope.

## CLIENTE → CAJERO authorization (TASK 12.3A addendum)

**Canonical behavior found.** `AS POS V1.html`'s `cambiarModoPOS(modo)`
(~line 6989) has no gate on CAJERO→CLIENTE (only an open-shift check, out
of scope — this app has no turno/shift concept). The `else` branch —
CLIENTE→CAJERO — **always** calls `requiereEmpleado('PIN o contraseña
para volver a modo Cajero:', callback)`, by the code's own comment
"SIEMPRE pide PIN, sin importar desde dónde se llame." That opens
`modal-empleado-pin`; `confirmarPinEmpleado()` (~line 7042) resolves it
with:
```js
var ok = (DB.usuarios||[]).filter(u => u.estado==='Activo')
  .some(u => String(u.pin)===String(pin) || String(u.pass)===String(pin));
```
a **plain-text, fully client-side comparison against any active
employee's PIN or password held in the local `DB` object**. This is
distinct from V1's separate admin-only gate (`requiereMasterOAdmin`/
`pedirPinAdmin`, used e.g. for editing fiestas) — CLIENTE→CAJERO uses the
broader "any active employee" gate, not the admin-only one. This local
comparison is exactly the insecure pattern TASK 12.3A forbids
recreating.

**Investigation of current real auth contracts** (before writing any
code): no PIN/step-up-auth backend contract exists anywhere in AS
Platform. No PIN column/table in `packages/database/src/schema/*.ts`
(`identity.ts` only has `passwordHash`); no elevation/step-up/
reauthenticate endpoint in `apps/api/src/modules/auth/auth.routes.ts`
(every credentialed endpoint there — login, refresh, logout, etc. —
mints a brand-new session/token pair, none does a lightweight "confirm
current password" check); no supervisor/override permission in the real
63-entry permission catalog (`packages/database/src/seeds/
technical-permissions.ts`); no client-side password-confirmation UI
pattern anywhere else in `apps/one`. Calling the real `POST /auth/login`
a second time as an ad hoc "verify password" check was considered and
rejected: a wrong-password attempt would flip `AuthPhase` to `failure`,
and the router's redirect logic would force the **entire app** back to
`/login` — a disproportionate, unrecoverable side effect for what should
be a small, local failure — and a successful call risks silently
rotating the browser's refresh-token cookie out from under the real
session.

**Secure implementation chosen.** `_CajeroReturnAuthDialog`
(`pos_shell.dart`) reuses the currently-authenticated session's own real
`sale.create` permission (sourced from `AuthenticatedContext.permissions`,
itself populated from the genuine `GET /api/v1/auth/permissions`
response) as the authorization gate — one of the two options the task
itself allowed ("use the currently authenticated session only if
explicitly authorized by an existing permission"). The dialog keeps
V1's canonical PIN-entry visual (title, message, masked input, Cancelar/
Confirmar) for fidelity, but **the typed input is never stored or
compared to anything** — the field exists for visual continuity only,
and an in-dialog caption discloses that real-time PIN verification is
deferred pending a real backend contract. This satisfies every explicit
constraint: no PIN stored or compared in Flutter, no hardcoded master
PIN, no bypass of the real authentication system, and no fabricated
validation result.

**Behavior.** CAJERO→CLIENTE (`_PosSaleState._handleModeChanged(true)`)
switches immediately, no dialog — matching the canonical rule.
CLIENTE→CAJERO (`_handleModeChanged(false)` →
`_requestCajeroReturn()`) always opens `_CajeroReturnAuthDialog`:
Cancelar or a missing-`sale.create` confirmation leaves `clienteMode`
unchanged (CLIENTE stays active) and the underlying `SaleSession` is
never touched; a `sale.create`-authorized Confirmar pops `true`, which
flips `clienteMode` to `false` — the same `SaleSession` instance
continues to back both views throughout, so the ticket and its totals
are provably unchanged by the transition (see tests below).

**Still deferred.** A real PIN/step-up-authorization backend contract
(a dedicated re-auth endpoint, or a PIN column plus a narrowly-scoped
verification route) does not exist yet and must be designed — ideally
alongside TASK 12.4, since both need a "confirm the operator without
disrupting the active session" primitive.

## Deferred: TASK 12.4 — Integrated Card Payment Terminal

Required architecture, per the explicit business rules given for this
task (not yet designed, let alone implemented):

1. CAJERO may eventually support cash, card, and transfer per permissions
   and branch configuration; **CLIENTE is card-only**, always.
2. The payable total sent to a terminal/provider must come from a
   backend-authoritative sale/payment intent — never re-entered manually
   client-side.
3. The ticket must lock (no line edits) while a payment is in flight.
4. A sale finalizes only on an authoritative *approved* result from the
   provider/terminal — never client-simulated.
5. Declined, cancelled, expired, or disconnected payment attempts must
   leave the sale open and must **not** reduce inventory.
6. Payment attempts must be idempotent (no duplicate charges on retry).
7. **Never store full card numbers, CVV, or other sensitive card data** in
   AS Platform — only safe provider references and masked metadata the
   payment contract permits.
8. Must begin with **provider/device discovery and contract design**
   before any implementation — which terminal/provider, what its
   API/SDK contract looks like, and what `SaleSession` needs to grow
   (a lock/status field, a payment-intent reference, an idempotency key)
   to support it safely. None of that exists yet; `SaleSession` was kept
   deliberately clean and easy to extend rather than pre-built with
   speculative, unused fields.

## TASK 12.3B — Canonical full CLIENTE mode

TASK 12.3's CLIENTE preview was a panel swapped in *inside* the same
admin shell — sidebar, topbar, search, and category tabs all stayed
visible, which V1 never does. TASK 12.3B replaces that with the full
canonical CLIENTE experience: a dedicated locked surface.

**Architecture.** `SaleSession` and `clienteMode` moved from
`_PosSaleState` up to `_PosShellState` — the level that actually owns
the sidebar/topbar. When `clienteMode` is true,
`_PosShellState.build()` renders `_ClienteLockedShell` and *nothing
else*: no `_Sidebar`, no `_Topbar`, no `_Content` module switch exist
anywhere in that subtree. This matches V1's actual architecture (CLIENTE
is the same `.pos-layout` with `body.modo-cliente` CSS toggles, not a
separate DOM tree) while being structurally *stronger* than V1's
CSS-only `display:none` — there is nothing in the tree for a customer to
navigate toward, not just something visually hidden. A side effect: the
ticket now also survives switching away from the POS module and back
(previously `_PosSaleState`, and its `SaleSession`, was torn down
whenever `_Content`'s `switch(module)` stopped building `_PosSale`).

**What's implemented**, matching V1's `renderPosClienteApilado()`/
`cambiarModoPOS('cliente')`:
- `_ClienteHeader` — logo, the exact static greeting V1 uses ("¡Hola!
  👋" / "Selecciona lo que deseas" — never personalized to a customer
  name, matching V1's own hard-coded copy), a live clock
  (`_LiveClockText`, refactored out of `_TopbarClock` so both the
  CAJERO topbar clock and this one share one implementation, exactly as
  V1 drives both DOM nodes from its single `actualizarRelojTopbar()`),
  and "Volver a cajero" (`_ClienteVolverButton`, reusing the
  `pos-mode-cajero` key — V1 also reuses the literal same button/id for
  both roles, relabeled in place).
- `_ClienteJumpbar` + `_ClienteCategorySections` — products stacked into
  per-category sticky sections (`CustomScrollView`/
  `SliverPersistentHeader(pinned: true)`), not CAJERO's flat
  single-category grid. Tapping a jumpbar pill calls
  `Scrollable.ensureVisible` on that section's `GlobalKey` (400ms,
  `Curves.easeOut`, matching V1's own `_scrollACategoriaCliente`/
  `_scrollSuaveA` timing) — a generous `cacheExtent` keeps every
  section's `GlobalKey.currentContext` valid even before it scrolls
  into view. An empty category still renders its sticky title with the
  canonical "Sin productos en esta categoría" text (matching
  `_renderSeccionProductos([])`'s exact copy) instead of the whole
  catalog collapsing to one generic message; zero active categories
  falls back to an honest "No hay categorías disponibles." Product
  cards are the exact same `_PosProductCard` CAJERO uses (same tap-to-
  add, same out-of-stock blocking) — V1's `prodCard(p)` is likewise one
  function shared by both modes.
- `_ClienteAyudaBar` — "¿Necesitas ayuda?" and "Tengo un cupón".
  Neither has a real backend contract (confirmed by inspection: no
  staff-notification/coupon-validation endpoint or table exists
  anywhere in `apps/api`/`packages/database`), so both surface an
  honest "no está disponible" notice instead of V1's own fabricated
  bits: V1's "🔔 Un miembro del equipo viene en camino a ayudarte" toast
  promises a real staff dispatch this app cannot make happen, so it is
  not reproduced.
- `_CuponClienteDialog` + `_CuponVirtualKeyboard` — the coupon flow's
  visual shape (read-only code display, full-QWERTY on-screen keyboard
  distinct from the numeric `StartupPinKeypad`, matching V1's own
  separate `#teclado-virtual-cupon` component) without ever validating:
  Aplicar always shows the same honest "not available" text, never a
  fabricated accept/reject result. V1's success/collapse animation is
  not reproduced either, since it would require simulating acceptance.
- Ticket: reuses `_ClienteTicketPreview`/`_ClienteTicketFooter`/
  `_ClienteCardPaymentButton` unchanged from TASK 12.3 — same
  `SaleSession`, still read-only, still card-only. **One deliberate
  deviation from raw V1 fidelity carries forward**: V1's CLIENTE ticket
  is fully editable; this one stays read-only, per the explicit
  "CLIENTE is card-payment-only, never exposes cashier controls"
  business rule from TASK 12.3's own addendum, which this task does not
  rescind.

**Routing/security.** The app has exactly one authenticated route
(`/dashboard`) with no per-module sub-routes — confirmed by inspection
of `router.dart` before making any change. Deep-linking to a specific
admin module and browser back/forward exposing one are therefore
already structurally impossible today, independent of CLIENTE mode —
not a guarantee this task added, an existing property of the current
router being reported honestly rather than overclaimed. `clienteMode`
is in-memory only (like V1's own `modo-cliente` body class, never
persisted to storage), so a refresh always returns to the safe default:
CAJERO, empty ticket.

**Authorization modal polish** (`_CajeroReturnAuthDialog`, TASK
12.3A's gate): the canonical AS logo mark, a fade+scale entrance
(`ScaleTransition` layered on `showDialog`'s own default fade, driven
by the route's `animation` — no new custom route), Escape-to-cancel
(`CallbackShortcuts`), and a visual numeric keypad (`StartupPinKeypad`,
reused from the login PIN tab — V1's own `#empleado-pin-input` is
`type="password"`, so its global on-screen keyboard appears beside it
in the canonical HTML; this reproduces that keypad's *presence*, not a
real PIN comparison, which remains forbidden). The previous in-dialog
"requires a backend contract" caption was removed from this
customer/staff-facing surface — that explanation now lives only in the
class's doc comment and in this document, per "no developer/backend-
contract text in production UI."

**Still deferred**, for a dedicated future task:
- Payment **confirmation** UI (beyond the single inert action here).
- Customer QR (identification, loyalty scan-in, etc.).
- Rewards+/loyalty program surfaces.
- A genuinely separate customer-facing *device* (today, CLIENTE is a
  locked view reachable from the same cashier-operated screen, not a
  second physical display).
- Real backend contracts for coupon validation, staff assistance, and
  PIN/step-up authorization — none exist anywhere in AS Platform today
  (confirmed by inspection); all three are honestly deferred rather
  than faked.

## Test coverage

- `apps/one/test/sale_session_test.dart` (new) — unit coverage of
  `SaleSession`/`SaleLine` in isolation: empty state, add/merge,
  increase/decrease/remove (including the "decrease to 0 removes the
  line" and "unknown product is a no-op" edge cases), centralized
  subtotal/IVA/total derivation, `notifyListeners` firing, and the
  read-only `lines` snapshot.
- `apps/one/test/pos_shell_test.dart`, `group('Sale engine (TASK 12.3)')`
  (new) — widget-level: tap-to-add is reactive with no manual refresh;
  tapping the same product merges instead of duplicating; quantity
  buttons increase/decrease/remove; the trash button removes a line
  directly; an out-of-stock product cannot be added; Subtotal/IVA/Total
  recompute automatically; and the explicit shared-state proof (CAJERO
  changes visible in CLIENTE and vice versa, without reset/duplication).
  The pre-existing TASK 12.2C test was updated for Cobrar's new message
  and a new CLIENTE-mode test covers the read-only preview and its
  card-only restriction.
- `apps/one/test/pos_shell_test.dart`, `group('CLIENTE → CAJERO
  authorization (TASK 12.3A)')` (new) — CAJERO→CLIENTE is direct, no
  dialog; CLIENTE→CAJERO always opens `_CajeroReturnAuthDialog`;
  Cancelar leaves CLIENTE active; an unauthorized session (missing
  `sale.create`, via the new `_contextWithoutSaleCreate` fixture) shows
  the error and leaves CLIENTE active; a `sale.create`-authorized
  Confirmar returns to CAJERO; and a full round-trip test proving the
  ticket's lines/quantities/total are byte-identical before and after
  CLIENTE→dialog→CAJERO. The two pre-existing tests that toggle CLIENTE→
  CAJERO (the TASK 12.3 addendum test and the shared-`SaleSession` proof
  test) were updated to confirm through the dialog, since the shared
  `_context` fixture now carries `sale.create`.
- `apps/one/test/pos_shell_test.dart`, `group('Canonical CLIENTE locked
  surface (TASK 12.3B)')` (new) — admin navigation is structurally
  unreachable while CLIENTE is active (sidebar/topbar/hamburger/every
  `nav-*` key all `findsNothing`); the greeting header, live clock,
  jumpbar, and stacked sections render for each active category;
  tapping a jumpbar pill scrolls without throwing; an out-of-stock
  product inside a stacked section is still blocked; a category with no
  matching products keeps its section (honest empty text, not a
  collapsed catalog) via the new `_ClienteCatalogGateway` fixture; zero
  active categories shows an honest empty state; "¿Necesitas ayuda?"
  and "Tengo un cupón" both surface deferred, non-fabricated notices —
  explicitly asserting V1's own "viene en camino" staff-dispatch toast
  text never appears; the coupon modal's virtual keyboard types/
  backspaces into the read-only field and Aplicar never accepts or
  rejects a code; the CLIENTE surface renders without overflow at
  1024×600, 1366×768, 1440×900, and 1920×1080 and in dark mode; and the
  authorization dialog's polish (canonical logo present, numeric keypad
  types into the field, Escape cancels back to CLIENTE, no backend-
  contract text leaks into the dialog).
  - The pre-existing "CLIENTE mode swaps in..." test (TASK 12.3
    addendum) was updated: it previously asserted the sidebar stayed
    visible while CLIENTE was active — TASK 12.3B makes that assertion
    incorrect on purpose (the whole point of the locked surface), so it
    now asserts `pos-sidebar`/`pos-topbar` are absent and
    `pos-cliente-shell` is present instead.
