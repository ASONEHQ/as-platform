# AS POS V1 Visual and Functional Foundation

## Status and authority

- **Artifact:** `AS POS V1.html`
- **SHA-256:** `C7FC92D81FD1148288D2646EE853C05E68D2960CF39BAE3178E71C8029D16ACE`
- **Artifact size:** 1,766,927 bytes
- **Inspection date:** 2026-08-02
- **Scope:** inspection and migration planning only
- **Visual authority:** the existing AS POS interface is the canonical product reference

This document reconciles the current AS POS V1 product definition with the
backend that exists in the repository. Migration to Flutter must preserve the
interface identity, hierarchy, density, navigation, feedback, and operator
workflows. It does not authorize a redesign or implementation.

The prototype is authoritative for visual and workflow intent, but it is not an
authority for security, persistence, tenant isolation, monetary arithmetic, or
backend architecture. Those concerns remain governed by `AGENTS.md`, the ADRs,
the approved contracts, and the production code.

## Inspection method

The complete HTML source, eleven embedded style blocks, two scripts, embedded
assets, navigation targets, modal identifiers, keyboard handler, persistence
calls, and responsive rules were inspected. The artifact hash matches the
previously audited reference. Browser execution was not used because the
available controlled browser rejects local `file:` navigation; behavioral
findings therefore come from source evidence rather than a runtime claim.

Repository reconciliation covered implemented API modules, PostgreSQL schema,
migrations 0000-0010, permissions, outbox/audit behavior, realtime contracts,
and the existing Flutter AS ONE design system.

### Source metrics

| Measure | Finding |
| --- | ---: |
| Navigable areas | 25 |
| Page containers | 24; Cafeteria reuses the POS page |
| Modal overlays detected | 45 |
| Inputs / selects / textareas | 276 / 90 / 14 |
| Buttons / tables | 594 / 50 |
| Named functions | 660 |
| Inline event bindings | 768 |
| Embedded style blocks | 11 |
| Inline scripts | 2 |
| Images | 23 |
| Static `data:` resources | 7 |
| `fetch` / WebSocket connections | 0 / 0 |

## Preservation rules

1. Preserve the AS blue, white, violet-blue, status-color, and dark-mode
   relationships found in the reference.
2. Preserve the compact desktop-first shell: 56 px topbar, collapsible sidebar,
   dense work area, round utility actions, and persistent operational context.
3. Preserve POS category navigation, product cards, persistent ticket panel,
   cashier/customer modes, keypad, modal workflows, and keyboard accelerators.
4. Preserve labels and operational vocabulary unless an approved contract
   requires a precise correction.
5. Rebuild reusable visual patterns as Flutter components; do not copy browser
   global state, inline handlers, mock authority, or direct DOM behavior.
6. Do not infer that a simulated feature has backend support.

## Visual language

### Color system

| Role | Light reference | Dark reference | Usage |
| --- | --- | --- | --- |
| Background | `#F4F6FB` | `#15131F` | Main workspace |
| Surface | `#FFFFFF` | `#1E1B2E` | Cards, topbar, panels, dialogs |
| Primary blue | `#29ABE2` | `#3FBBEF` | Brand and primary accents |
| Deep blue | `#1A8BBF` | `#7DD3F7` | Active/hover emphasis |
| Pale blue | `#E8F6FC` | `#16303A` | Selected backgrounds |
| Action blue | `#1677FF` | `#29A8FF` | Primary actions and focus |
| Strong action blue | `#0D47F7` | `#6BB6FF` | Gradients and emphasis |
| Neutral action tint | `#F2F4F7` | `#0F1E4D` | Secondary emphasis |
| Primary text | `#1A1535` | `#F1EFFA` | Titles and values |
| Secondary text | `#5A5880` | `#B7B3D1` | Labels and descriptions |
| Muted text | `#9896B0` | `#7A7699` | Hints and metadata |
| Border | `#E2E1F0` | `#322D4A` | Component boundaries |
| Success | `#2E7D32` | `#5FD86A` | Paid, active, available |
| Warning | `#B45309` | `#FBBF24` | Attention and pending state |
| Error | `#B91C1C` | `#F87171` | Failure, cancellation, stock-out |
| Informational cyan | `#0891B2` | `#22D3EE` | Informational status |

These are reference values, not permission to replace the current AS ONE token
system wholesale. POS-specific tokens should be added by evidence and aligned
without changing their observed relationships.

### Typography

- Primary typeface: embedded **Questrial**, with `sans-serif` fallback.
- Operational values use stronger weight rather than a separate display face.
- Monospace appears for codes or machine-like values.
- The interface relies on compact 9-17 px labels, 18 px card values, and a clear
  weight hierarchy.
- Flutter migration must preserve density and hierarchy while meeting browser
  accessibility and text-scaling requirements.

### Layout, spacing, and shape

- Global radius token: 12 px.
- Topbar: 56 px.
- Expanded sidebar: 224 px; collapsed navigation is icon-first.
- Common spacing increments observed: 4, 6, 8, 9, 10, 12, 14, 16, 20, 24,
  and 30 px. Flutter should normalize these to the existing 4 px AS scale
  without visibly changing composition.
- Cards use one-pixel or 1.5-pixel borders and 10-16 px radii.
- Pills and badges use approximately 20 px or fully rounded radii.
- Primary touch actions commonly use 36-48 px minimum heights.

### Buttons and controls

- Standard buttons: compact bordered surfaces, 9 px radius, icon plus label,
  36 px minimum height, and a 120 ms transition.
- Circular utility buttons: 30-40 px with subtle shadow.
- Primary actions: blue or violet-blue emphasis.
- Checkout: full-width green gradient, 15 px padding, 12 px radius, strong
  white label, and a green shadow.
- Numeric keypad: circular 52 px keys with a two-pixel action-blue border.
- Destructive and warning actions retain explicit semantic colors.

### Cards, elevation, and effects

- Cards and product tiles are bordered surfaces rather than high-elevation
  floating Material cards.
- Shadows are restrained: utility actions use roughly 2 px / 6-8 px blur;
  emphasized actions use 3-4 px / 12-14 px blur.
- Modal backdrops use `rgba(0,0,0,.5)` plus 4 px backdrop blur.
- Glass/blur is limited to overlays; it is not the primary card treatment.
- AI and avatar elements use a violet-to-blue gradient. This treatment belongs
  only where the reference uses it.

### Motion and feedback

Observed motion includes `pulse`, `spin`, `slideUp`, `flotar`, `agotadoPulse`,
AI entrance/dots/reaction, payment confirmation, and splash logo/halo/spark
sequences. Most component transitions are 100-150 ms; confirmation effects use
approximately 300-360 ms and spring-like easing.

Flutter must preserve the purpose and cadence of these motions and respect
reduced-motion preferences. Animation must not become decorative redesign.

### Application shell

- Fixed topbar with hamburger, centered clock, utility actions, notifications,
  contextual user/avatar, and AI affordance.
- Collapsible grouped sidebar with active state, icon/label modes, online state,
  brand, and footer controls.
- Dense content workspace with page headers, action rows, tabs, filters, cards,
  tables, and modal flows.
- POS mode replaces the ordinary content layout with category/product browsing
  and a persistent ticket/payment panel.

### State language

| State | Existing expression | Flutter requirement |
| --- | --- | --- |
| Loading | Spinners, animated dots, splash sequences | Preserve compact local progress; add accessible semantics |
| Empty | Centered muted message, optional primary action | Preserve wording and placement per screen |
| Error | Red status, toast, or modal | Stable backend error envelope; no sensitive details |
| Success | Green toast/badge and payment confirmation | Preserve strong transactional confirmation |
| Warning | Amber badge, alert row, or confirmation | Preserve explicit operator decision points |
| Disabled | Muted text/background and unavailable action | Must remain visually and semantically disabled |
| Offline | Connectivity/sync indicators | Display only after real checkpoint semantics exist |

### Icons and imagery

- Tabler Icons webfont supplies the operational icon language.
- Logos, favicon, Questrial font, and several previews are embedded as data URLs.
- Product and event images are card content, not decorative backgrounds.
- Flutter should map icons semantically and consistently; it must not mix icon
  families arbitrarily or replace the product imagery style.

## Functional and backend capability model

Status meanings:

- **Supported:** production route and persistence exist for the required core.
- **Partial:** a useful dependency exists, but the screen workflow is incomplete.
- **Missing:** no production module or route implements the workflow.
- **Future:** explicitly postponed or requires a separately approved domain.

An existing permission code or a documented future contract is not proof of an
implemented workflow.

## Module and screen inventory

| AS POS area | Purpose and current visual implementation | Current prototype functionality | Backend status and dependency | Realtime / permission | Priority |
| --- | --- | --- | --- | --- | --- |
| Dashboard | KPI cards, charts, alerts, occupancy, flows, and compact summaries | Synthesizes mock in-memory values | **Partial:** context, catalog, and inventory reads exist; sales/admissions/events/staff projections are missing. Use only the evidence-based `CEO_DASHBOARD_V1` boundary | No realtime transport. Read permissions vary by source | P3 after transactional domains |
| Punto de Venta | Category strip, searchable product grid, persistent ticket, quick actions, customer/cashier modes | Cart, quantities, weighted products, notes, discounts, coupons, price override, customer link, checkout, reprint, suspend/cancel | **Partial:** catalog and inventory availability exist. Sale, price, tax, promotion, cash-session, payment, receipt, and offline command endpoints are missing | Future sale/inventory events; `catalog.read`, `inventory.read`, future sale/cash permissions | P0 |
| Cafetería | Reuses POS shell with distinct product presentation | Shared cart/checkout behavior | **Partial:** same foundation and blockers as POS; preparation workflow is not implemented | Same as POS | P1 after core POS |
| Ventas Suspendidas | List/card recovery surface with resume/cancel actions | Stores draft tickets in memory | **Missing:** durable sale drafts, ownership, expiration, and recovery contracts | Future sale-draft events and permissions | P1 |
| Devoluciones | Search, sale selection, line/refund workflow and confirmation | Simulated return and stock mutation | **Missing:** returns/refunds and authoritative stock effect | Future refund events; reserved refund permissions are not implementation | P2 |
| Productos | Catalog tables/cards, editor modal, pricing, variants, related items, import/export tabs | CRUD-like mock catalog editing | **Supported/partial:** products, variants, options, values, barcodes, categories, and brands exist. Pricing, media, availability, imports/exports, and related products remain incomplete | Outbox exists, no client realtime; `catalog.read`, `product.manage`, future price/availability support | P1 |
| Categorías | Category cards/list and editor dialogs | Local CRUD and POS ordering | **Supported/partial:** category hierarchy and lifecycle exist; POS presentation ordering may need a contract | Outbox only; `catalog.read`, `category.manage` | P1 |
| Proveedores | Table/list and supplier editor concepts | Local supplier records | **Missing:** supplier domain and endpoints | None; future purchasing permission | P4 |
| Inventario | Tabs for stock, entries, transfers, Kardex, replenishment, and movement views | Direct stock mutation plus in-memory Kardex | **Supported/partial:** locations, balances, movements, posting, reversal, transfers, reservations, counts, and reconciliation exist. Supplier receiving and some POS-facing availability projections remain missing | Transactional outbox only; inventory permissions implemented | P1 |
| Compras | Purchase list, direct purchase, receiving/supply dialogs | Mock purchasing and stock changes | **Missing:** suppliers, purchase orders, receipts, payable lifecycle | Future purchasing events/permissions | P4 |
| Clientes | Search/list, customer cards and editor/select dialogs | Local profiles, sale/event association, credit concepts | **Missing:** customer identity, privacy, consent, deduplication, and credit ledger | None | P2 after sales core |
| Fiestas | Calendar/list views, event editor/detail, rooms, packages, quotes, documents, socks/snacks | Rich event quoting, scheduling, conflict, payment, and reservation simulation | **Missing:** event, booking, room, package, capacity, document, and payment domains | Future availability/booking events and permissions | P4 |
| Membresías | Plans/members, lifecycle status and access concepts | Local enrollment/status changes | **Missing:** customer memberships and entitlements. `company_memberships` are employee/operator access and must not be reused | None | P5 |
| Cupones / Promos | Promotion/coupon cards, editors, application and customer coupon modal | In-browser qualification, usage, discount mutation | **Missing:** versioned promotion rules, redemption ledger, limits, and conflict handling | Future promotion events/permissions | P2 |
| Corte de Caja | Current shift, movements, denominations, partial/final cuts, history and printable summaries | Opening, expenses, withdrawals, income, expected cash, counts and close in memory | **Missing:** cash registers, sessions, movements and close endpoints. Reserved cash permissions alone are not support | Future cash-session events; reserved cash permissions | P0 with sales |
| Facturación CFDI | Invoice/customer data, invoice list/detail and issuance actions | Simulated fiscal document behavior | **Future:** compliant fiscal model and provider integration absent | Online-only future permissions/events | P6 |
| Reportes | Tabbed sales, finance, inventory, customer, staff, event and access reports | Calculates mock charts/tables and simulated exports | **Partial:** raw inventory reads and operations diagnostics exist; no reporting projections/jobs/exports | No report realtime; source permissions only | P5 |
| Control Acceso | Register/wristband cards, capacity and admission log | Mock activation, validation and access recording | **Missing:** admission credentials, device verification, capacity checkpoints | Future device/admission events and permissions | P5 |
| Usuarios | User/role tabs, editors and permission matrix | Client-side identities, roles, overrides and PIN gates | **Supported/partial:** global users, company memberships, roles, allow/deny permissions, branch access, devices, and sessions exist. Prototype PIN/QR flows are not production features | Outbox only; user/role/permission/branch-access permissions | P2 administrative surface |
| Empleados | Staff cards/list, schedules, clock, payroll, history and receipt dialogs | Mock workforce and payroll calculations | **Missing:** workforce domain. Users/company memberships are not employee records | None | P6 |
| Historial de Ventas | Search/filter table, detail, receipt/reprint/cancel actions | Reads memory sales and opens print views | **Missing:** authoritative sales query/detail/receipt endpoints | Future `sale.read` and sale events | P1 |
| Documentos | Event/business document cards, generation and print actions | Browser HTML/print simulation | **Missing:** templates, object storage metadata, access control, versions and retention | Future file/document events | P5 |
| Sincronización | Monitor, registers, data, wristbands, backup, email reports, logs, and settings | Fake timers, queue, states, conflicts and backup records | **Missing:** offline command transport, checkpoints, device sync and reconciliation API. Devices and idempotency foundations exist only as dependencies | No WebSocket; `sync.execute` is reserved | P1 after sale commands |
| Notificaciones | Notification feed, filters, read state and preferences | In-memory messages and simulated delivery | **Missing:** notification intents, preferences, provider attempts and durable status | None | P5 |
| Configuración | Business identity, branding, tickets, POS/event settings, sync/hardware placeholders and theme | Some values persisted in localStorage; demo reset | **Partial:** scoped company/branch settings, companies and branches exist. Branding files, ticket templates, hardware and many keys need approved definitions | Settings outbox only; company/branch settings permissions | P2 |

### Global and modal experiences

| Experience | Reference behavior | Migration disposition |
| --- | --- | --- |
| Splash and activation | Animated branded entry and distributor/license gates | Preserve branded entry only where product-approved; do not migrate client secrets or factory credentials |
| Login | Full-screen gate with password/PIN concepts | Use implemented browser authentication and server permissions; visual identity may be preserved |
| Administrator/employee PIN | Modal privilege gates | Do not treat a client PIN modal as authorization; requires explicit future contract if retained |
| Generic confirmation | Shared destructive/important action modal | Shared Flutter component with typed consequences and backend concurrency handling |
| Product detail/weight | Modal item options and numeric capture | Preserve; requires catalog details and eventual sale draft domain |
| Discount/coupon/price | Modal approval and adjustment flows | Preserve visuals; blocked by pricing/promotion/authorization contracts |
| Customer selection | Search/select modal | Preserve; blocked by customer backend |
| Payment | Multi-method payment panel and change confirmation | Preserve exactly; blocked by sale/payment/cash contracts |
| Cash dialogs | Opening, close, denomination, expense, withdrawal, income and print | Preserve; blocked by cash backend |
| Event dialogs | Event, calendar day, room, package, documents, socks | Preserve; blocked by events backend |
| Numeric keyboard | Reusable round-key overlay/input surface | Flutter POS-local shared component |
| Toasts and status badges | Compact colored transactional feedback | Shared AS component with accessibility semantics |
| Print windows | Receipt, cut, document and invoice HTML | Replace implementation with approved artifacts while preserving output appearance |
| AI assistant | Gradient floating panel with scripted responses | Future; do not include in initial POS migration |

## Navigation and keyboard contract

The prototype swaps page containers through `data-nav`; Flutter should use
typed routes/state while preserving the visible sidebar grouping and active
selection. Cafeteria intentionally shares the POS page shell.

| Shortcut | Current action | Migration requirement |
| --- | --- | --- |
| F2 | Focus product search | Preserve on desktop web |
| F3 | Select customer, except customer-facing mode | Preserve when customer domain exists |
| F4 | Open reprint | Preserve when receipt endpoint exists |
| F5 | Suspend sale | Preserve when durable drafts exist |
| F6 | Cancel sale | Preserve with permission and confirmation |
| F8 | Charge / checkout | Preserve as primary checkout accelerator |
| Escape | Close open modals except mandatory login; refocus search | Preserve modal-stack semantics |
| Enter in search | Resolve exact barcode or sole search result | Preserve deterministic scanner/keyboard behavior |

Shortcut handling must be disabled or scoped while text editing or when a modal
owns the key event. Scanner input must not rely on timing heuristics without a
separate approved device design.

## Responsive behavior

The reference includes breakpoints at 480, 500, 520, 600, 768, 800, and 900 px,
plus a modal transition at 640 px. Its behavior is desktop-first:

- Large screens retain the sidebar, dense product grid, and persistent ticket.
- Narrow screens collapse or simplify navigation and reduce grid density.
- Modals become bottom-aligned sheets below 640 px and centered dialogs above it.
- POS customer mode changes visible actions and prioritizes product exploration.
- Tables and action rows use wrapping, scrolling, or stacked layouts rather than
  silently removing data.

Flutter should encode these observed transitions as layout rules, not impose a
new generic mobile design. Exact breakpoint acceptance requires approved visual
captures of the reference at target sizes.

## Flutter component inventory

### Application shell

- `AsPosShell`
- `AsPosTopbar`
- `AsPosSidebar`
- `AsPosSidebarGroup`
- `AsPosSidebarItem`
- `AsPosContextHeader`
- `AsPosOnlineIndicator`
- `AsPosNotificationButton`
- `AsPosUserMenu`
- `AsPosPageHeader`
- `AsPosToolbar`
- `AsPosTabBar`

### POS transaction surface

- `AsPosCategoryStrip`
- `AsPosCategoryTile`
- `AsPosProductGrid`
- `AsPosProductCard`
- `AsPosProductImage`
- `AsPosOutOfStockBadge`
- `AsPosSearchField`
- `AsPosScannerInput`
- `AsPosTicketPanel`
- `AsPosTicketHeader`
- `AsPosCartItem`
- `AsPosQuantityControl`
- `AsPosTicketTotals`
- `AsPosQuickActionGrid`
- `AsPosCheckoutButton`
- `AsPosCashierModeSwitch`
- `AsPosCustomerDisplay`
- `AsPosCustomerHelpBar`
- `AsPosCustomerJumpBar`

### Payment, cash, and numeric input

- `AsPosPaymentPanel`
- `AsPosPaymentMethodTile`
- `AsPosAmountField`
- `AsPosChangeSummary`
- `AsPosPaymentSuccess`
- `AsPosNumericKeypad`
- `AsPosDenominationRow`
- `AsPosCashMovementCard`
- `AsPosCashSummary`

### Catalog and operational data

- `AsPosDataTable`
- `AsPosFilterBar`
- `AsPosSearchToolbar`
- `AsPosStatusChip`
- `AsPosBadge`
- `AsPosMetricCard`
- `AsPosActionCard`
- `AsPosAlertRow`
- `AsPosProgressBar`
- `AsPosDonutLegend`
- `AsPosTimeline`
- `AsPosCalendar`
- `AsPosScheduleGrid`

### Overlay and feedback

- `AsPosDialog`
- `AsPosBottomSheet`
- `AsPosConfirmationDialog`
- `AsPosFormDialog`
- `AsPosDetailDialog`
- `AsPosDrawer`
- `AsPosToast`
- `AsPosLoadingState`
- `AsPosSkeleton`
- `AsPosEmptyState`
- `AsPosErrorState`
- `AsPosSuccessState`
- `AsPosOfflineBanner`

### Forms and identity

- `AsPosPrimaryButton`
- `AsPosSecondaryButton`
- `AsPosDangerButton`
- `AsPosIconButton`
- `AsPosTextField`
- `AsPosMoneyField`
- `AsPosQuantityField`
- `AsPosSelectField`
- `AsPosDateTimeField`
- `AsPosSwitch`
- `AsPosAvatar`
- `AsPosPermissionMatrix`

Names describe migration boundaries, not approved public APIs. Components should
be promoted to the shared AS design system only when their semantics are useful
outside POS and their visual behavior remains compatible.

## Shared AS Design System candidates

Existing reusable Flutter components are `AsPrimaryButton`,
`AsSecondaryButton`, `AsTextField`, `AsPasswordField`, `AsCard`,
`AsStatusBadge`, `AsLoadingIndicator`, `AsEmptyState`, `AsErrorState`,
`AsPageHeader`, `AsAppLogo`, and `AsContextChip`.

They provide structural primitives, but they do not yet reproduce every POS
reference detail. Reuse must be based on visual equivalence, not name similarity.

Strong shared candidates:

- Semantic primary, secondary, destructive, and circular icon buttons.
- Status chips and badges.
- Page header, toolbar, tabs, filter bar, and search field.
- Bordered card and action-card primitives.
- Dialog, bottom sheet, confirmation, toast, and drawer foundations.
- Loading, skeleton, empty, error, and success states.
- Avatar, context chip, notification button, data table, pagination, and timeline.
- Spacing, radius, motion, border, shadow, and semantic status tokens.

POS-specific candidates that should remain in the POS feature until proven
generic include product cards, ticket/cart rows, quantity controls, checkout,
payment methods, change display, numeric keypad, denomination entry, cashier
mode, scanner input, and customer-facing display.

## Screen-by-screen migration map

| Order | Existing screen | Flutter destination | Required backend | Dependencies |
| ---: | --- | --- | --- | --- |
| 1 | Login and operating context | AS ONE auth/context gateway into `AsPosShell` | Existing auth/session/context APIs | TASK 10 browser session, device/context policy |
| 2 | POS product browser | `PosSaleScreen` catalog pane | Existing products/categories/variants/barcodes and inventory reads | Pricing/tax read model still required |
| 3 | Ticket/cart | `PosSaleScreen` ticket pane | Future durable sale draft and calculation contract | Exact money, taxes, permissions, idempotency |
| 4 | Cash opening | `CashSessionOpenScreen` | Future register/session endpoint | Device/register binding and cash permissions |
| 5 | Checkout/payment | `CheckoutScreen` / payment panel | Future sale completion, payment, receipt endpoints | Open cash session, payment rules, idempotency |
| 6 | Receipt/reprint/history | `SalesHistoryScreen` and receipt viewer | Future sales query/detail/receipt APIs | Storage/print policy |
| 7 | Suspend/resume/cancel | `SuspendedSalesScreen` | Future sale-draft commands | Ownership, expiry, offline reconciliation |
| 8 | Cash movements and close | `CashSessionScreen` / close sheet | Future cash movement/close/reconcile APIs | Audit, concurrency, denomination rules |
| 9 | Products and categories | `CatalogScreen` | Existing catalog APIs | Missing price/media/availability contracts as needed |
| 10 | Inventory and Kardex | `InventoryScreen` | Existing inventory APIs | Branch/location context and inventory permissions |
| 11 | Customers | `CustomersScreen` and selector | Future customer APIs | Privacy, consent, merge policy |
| 12 | Discounts/promotions/coupons | POS overlays and `PromotionsScreen` | Future pricing/promotion evaluation/redemption | Rule versions, limits, offline policy |
| 13 | Returns | `ReturnsScreen` | Future refund/return commands | Sales/payment/inventory reversal policies |
| 14 | Configuration | `PosSettingsScreen` | Existing scoped settings plus future approved keys | Branding/files and hardware definitions |
| 15 | Users/roles | Shared administration screens | Existing administration APIs | Permission-aware navigation |
| 16 | Cafeteria | `CafeteriaSaleScreen` over shared sale components | Core sale foundation plus future preparation needs | Core POS complete |
| 17 | Sync monitor | `SyncStatusScreen` | Future offline command/checkpoint APIs | IndexedDB strategy and registered device |
| 18 | Suppliers/purchases | Future purchasing feature | Future supplier/purchase/receiving APIs | Inventory foundation |
| 19 | Events/parties | Future events application feature | Future event/booking/capacity/payment APIs | Separate approved task |
| 20 | Membership/access | Future membership/admission feature | Future customer membership/access APIs | Separate approved task |
| 21 | Reports/dashboard | Future reporting feature | Future projections and report jobs | Reliable transaction history |
| 22 | Documents/notifications | Future shared platform features | Future file and notification APIs | Object storage/provider policies |
| 23 | Employees/payroll | Future workforce feature | Future workforce APIs | Separate security/compliance scope |
| 24 | CFDI | Future fiscal feature | Future compliant billing integration | Country-specific fiscal decision |
| 25 | AI assistant | Future research only | No approved backend capability | Value, privacy, safety, and data-boundary decisions |

## Backend gaps that block the first production POS slice

1. Authoritative price, tax, rounding, discount, and promotion calculation.
2. Durable sale draft, sale lines, payment, completion, cancellation, and receipt.
3. Cash register/device binding and cash-session lifecycle.
4. Server-authoritative inventory effect of a completed/reversed sale.
5. Customer records and consent boundary if customer association is in V1.
6. Offline command queue, checkpoints, replay outcomes, and reconciliation.
7. POS-specific realtime delivery or a documented polling strategy.
8. Receipt artifact and browser printing contract.
9. Branch-scoped product availability and price projection where existing
   catalog data is insufficient.
10. Negative and cross-tenant integration tests for every transactional flow.

## Known prototype risks that must not be migrated

The following risk catalog was identified during the original static analysis
of `AS POS V1.html` (2026-07-21, same artifact hash as above), archived at
[`docs/archive/POS_V1_AUDIT.md`](archive/POS_V1_AUDIT.md). Each item is
classified against the architecture and backend state reconciled in this
document. A classification of *already mitigated* or *historical prototype
risk* does not assert that a domain's user-facing workflow is complete; it
asserts only that the specific risk mechanism is avoided, replaced, or does
not apply going forward. Status must always be verified against the module
inventory above and the authoritative backend before a screen is built.

| # | Prototype risk | Classification | Rationale |
| ---: | --- | --- | --- |
| 1 | Privileged factory credentials embedded in browser source | Historical prototype risk | Specific to the prototype's client-side activation/distributor mechanism; the current architecture has no equivalent client-embedded credential pattern |
| 2 | Client-visible license-signing secret makes activation forgeable | Historical prototype risk | Same activation mechanism as #1; not part of the approved architecture |
| 3 | Passwords and PINs stored and compared in plaintext | Already mitigated | `SECURITY.md` requires memory-hard password hashing and prohibits storing or logging plaintext credentials; user/role authentication is implemented per the module inventory above |
| 4 | Authentication entirely client-side, bypassable via developer tools | Already mitigated | Authentication is server-issued (bearer/session tokens per `API_CONTRACTS.md`'s `S` header profile), not a mutable browser flag |
| 5 | Authorization is mutable client state | Already mitigated | `API_CONTRACTS.md`: authority derives exclusively from authenticated server context; client-supplied scope mismatches are rejected |
| 6 | Tenant ownership absent from the data model | Already mitigated | ADR-0006 (tenant isolation, accepted); enforced on every protected query/mutation per `SECURITY.md` |
| 7 | Branch scope inconsistent, represented only as display strings | Already mitigated | Same tenant/branch isolation enforcement as #6; branch scope is a first-class authorization dimension in `API_CONTRACTS.md` |
| 8 | Sensitive user access data persisted unencrypted in `localStorage` | Still relevant during Flutter migration | Client-side storage choices are an active discipline for the Flutter app (token/credential storage), not solely a backend guarantee |
| 9 | Audit entries client-generated, mutable, and lost on reload | Still relevant during Flutter migration | `SECURITY.md` establishes the audit requirement, but a durable, queryable audit read surface is not confirmed implemented in the module inventory above |
| 10 | Inline event handlers and unrestricted script execution prevent a strong Content Security Policy | Historical prototype risk | Specific to the single-document HTML/inline-script implementation; does not apply to the Flutter rendering model |
| 11 | Extensive `innerHTML` composition creates cross-site scripting risk | Historical prototype risk | Same reasoning as #10; Flutter does not render arbitrary HTML the way the prototype did |
| 12 | Unpinned CDN dependency (`@latest`) | Still relevant during Flutter migration | `SECURITY.md` requires pinning dependencies to reviewed versions; an ongoing discipline for every dependency added, not a one-time fix |
| 13 | Uploaded base64 content lacks authoritative type, size, malware, and ownership controls | Still relevant during Flutter migration | `SECURITY.md` requires bounding and scanning uploads; branding/file upload contracts are noted above as not yet approved |
| 14 | Browser print windows interpolate values into HTML without a trusted rendering boundary | Deferred operational concern | Receipt/document generation is not yet implemented; disposition already recorded above as "replace implementation with approved artifacts while preserving output appearance" |
| 15 | Operational data not durable, lost on reload | Still relevant during Flutter migration | Durable sale/cash/payment persistence remains an open backend gap listed above |
| 16 | Simulated offline queue is memory-only with no delivery guarantee | Still relevant during Flutter migration | ADR-0003 (offline command sync, accepted) governs this architecturally; offline queue, checkpoints, and reconciliation for POS are listed above as not yet implemented |
| 17 | Simulated backups provide false assurance | Historical prototype risk | Prototype UI theater; backup/restore is not part of the POS interface scope |
| 18 | JavaScript floating-point arithmetic unsafe for authoritative currency calculations | Already mitigated | ADR-0001 (money and rounding, accepted); `API_CONTRACTS.md` requires money as decimal strings, never floats, system-wide |
| 19 | Multi-step sale, cash, stock, and return mutations not transactional | Still relevant during Flutter migration | ADR-0005 (idempotency and outbox, accepted) governs this architecturally, but sale/cash/payment endpoints remain unimplemented per the module inventory above |
| 20 | Sequential in-memory IDs can collide across terminals and restarts | Already mitigated | ADR-0002 (UUID strategy, accepted); `API_CONTRACTS.md` requires UUID public identifiers system-wide |
| 21 | No idempotency protection for retries or duplicated offline commands | Still relevant during Flutter migration | Already required for inventory (ADR-0004 mandates an idempotency key for offline inventory commands); not yet implemented for POS sale/cash |
| 22 | Stock is a mutable field rather than an auditable movement ledger | Already mitigated | ADR-0004 (inventory ledger, accepted); movements, balances, posting, and reversal are implemented per the Inventario row above |
| 23 | Concurrent terminals have no locking, versioning, or conflict-safe source of truth | Still relevant during Flutter migration | Optimistic concurrency (`version` / `ETag` / `If-Match`) already exists for inventory; sale/cash transactional concurrency is not yet implemented |
| 24 | A single global `DB` and many secondary globals create inconsistent state | Historical prototype risk | Specific to the single-file browser architecture; superseded by a modular backend with PostgreSQL as the source of truth |
| 25 | Hundreds of functions share mutable state and lack module boundaries | Historical prototype risk | Specific to the prototype's construction; the current repository enforces modular app/package boundaries |
| 26 | Business logic and DOM manipulation interleaved, cannot be tested independently | Historical prototype risk | The current Flutter POS shell already separates shell, controller, and gateway layers (`pos_shell.dart`, `pos_read_controller.dart`, `pos_read_gateway.dart`) |
| 27 | Similar rendering, lookup, formatting, and helper logic duplicated | Historical prototype risk | Specific to the prototype's lack of shared components; the Shared AS Design System section above exists to prevent recurrence |
| 28 | Hard-coded branches, IP addresses, roles, users, dates, catalog items, and mock metrics | Historical prototype risk | Specific to the prototype's demo data; the current architecture uses real tenant-scoped data under ADR-0006 |
| 29 | Timers and fake network states diverge from UI state and leak across navigation/session changes | Historical prototype risk | Specific to the prototype's simulated infrastructure; not applicable once real network/session state is in place |
| 30 | Simulated CFDI, email, WhatsApp, AI, PDF/Excel, synchronization, and backup behaviors | Deferred operational concern | Each is explicitly postponed to a separately approved task per the phased plan below (CFDI, AI, notifications, and synchronization are outside the current POS scope) |

## Recommended implementation phases

### Phase 0 — Reference freeze and acceptance evidence

- Preserve the canonical HTML and hash.
- Capture approved screen states and breakpoint evidence outside this task.
- Define visual-regression acceptance without changing the design.

### Phase 1 — Read-only POS shell

- Reproduce shell, sidebar, topbar, category strip, product cards, ticket frame,
  loading/empty/error states, and keyboard focus behavior.
- Connect only authentication, context, catalog, and authorized inventory reads.
- **Status:** implemented (TASK 12.2) in `apps/one/lib/features/pos/`. See
  `docs/AS_POS_READ_ONLY_SHELL.md` for the implemented component inventory,
  data-source behavior, and read-only limitations. No mutation, checkout, or
  transaction capability exists yet — that remains Phase 2 onward.

### Phase 2 — Transaction contracts and backend

- Approve sale, pricing, tax, payment, cash-session, receipt, inventory-effect,
  idempotency, audit, and outbox contracts before Flutter mutation flows.

### Phase 3 — Core sale vertical slice

- Open cash session, build ticket, charge, complete sale, update inventory,
  produce receipt, and recover exact idempotent outcomes.

### Phase 4 — Operational recovery

- Suspended sales, reprint, cancellation, returns, cash movements, partial cut,
  close, discrepancy, and offline reconciliation.

### Phase 5 — Catalog administration and customer capability

- Complete missing POS catalog projections and approved customer workflows.

### Phase 6 — Deferred modules

- Migrate Cafeteria, promotions, purchasing, events, memberships, access,
  reporting, notifications, workforce, billing, and AI only through separate
  approved tasks.

## Acceptance criteria for future Flutter work

- The visual hierarchy is recognizably AS POS V1 at first glance.
- Navigation order, operator vocabulary, shortcuts, POS density, modal purpose,
  and feedback semantics are preserved.
- Existing AS ONE components are reused only when visually compatible.
- No client-side value is treated as tenant, branch, permission, price, total,
  payment, inventory, or audit authority.
- Unsupported screens never display fake production data.
- Offline and realtime indicators reflect real backend checkpoints.
- Responsive behavior is verified against approved reference captures.
- Accessibility improvements preserve identity and do not alter the visual
  product definition without approval.

## Conclusion

AS POS V1 is a broad and coherent product reference whose strongest assets are
its dense operator shell, category/product navigation, persistent ticket,
checkout feedback, keyboard efficiency, modal vocabulary, cash workflows, and
consistent blue-and-white visual system. These must be migrated, not redesigned.

The current backend can support authentication, operating context, portions of
catalog administration, and substantial inventory operations. It cannot yet
support an authoritative sale, payment, cash session, receipt, customer,
promotion, event, membership, report, workforce, billing, notification, or
offline synchronization workflow. The first Flutter POS implementation must
therefore begin as a faithful read-only shell while the transactional contracts
are designed and implemented in their proper backend modules.
