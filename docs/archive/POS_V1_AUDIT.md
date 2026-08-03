> **Archival notice**
>
> This document is historical. It is retained for provenance only and is not
> an active engineering contract. It has been superseded by
> [`docs/AS_POS_V1_FOUNDATION.md`](../AS_POS_V1_FOUNDATION.md), which
> reconciles the same artifact against the current backend and is the
> canonical active reference for AS POS migration. The unique 30-item
> security and scalability risk catalog from this audit has been merged into
> `AS_POS_V1_FOUNDATION.md` under "Known prototype risks that must not be
> migrated." Everything else in this document — metrics, module inventory,
> migration matrix, and backend mapping — is duplicated or superseded there
> and must not be treated as current status.

# AS POS V1 Prototype Audit

- **Audit date:** 2026-07-21
- **Artifact:** `AS POS V1.html`
- **SHA-256:** `C7FC92D81FD1148288D2646EE853C05E68D2960CF39BAE3178E71C8029D16ACE`
- **Scope:** static analysis and product review; the artifact was not executed or modified
- **Classification:** product and UX reference, not production architecture

## Executive summary

AS POS V1 is an unusually broad single-file prototype covering POS, cafeteria, sales recovery, catalog, inventory, purchasing, customers, events, memberships, promotions, cash management, access control, reporting, personnel, billing, synchronization, notifications, configuration, and audit concepts. It is valuable as a workflow and visual reference.

It is not a deployable foundation. The 1.77 MB HTML file combines markup, eleven style blocks, two inline scripts, mock data, presentation state, business calculations, authorization, persistence, print templates, and simulated infrastructure. It contains 25 navigable functional areas, 49 modal identifiers, 658 named function declarations, 768 inline event bindings, 214 `innerHTML` assignments, and one large mutable global `DB` object.

Only the theme and a small configuration subset—business identity, users, and license—are persisted through `localStorage`. Operational records are memory-only and disappear on reload. IndexedDB is mentioned in the interface but not implemented. The synchronization queue, backups, terminal connectivity, email delivery, AI, CFDI, PDF/Excel exports, and real-time behavior are simulations. There is no API, WebSocket, backend, or real database connection.

The highest-priority blocker is security: privileged factory credentials and a license-signing secret are embedded client-side, passwords and PINs are stored and compared in plaintext, and authorization is enforced only by mutable browser code. These mechanisms must not be migrated as-is.

The recommended strategy is to preserve the strongest interaction patterns and product vocabulary, extract and verify business rules, replace all authority and durable state with tenant-aware backend modules, and postpone secondary capabilities until the core POS, cash, identity, audit, catalog, and offline synchronization foundations are proven.

## Audit method and evidence

The audit read the complete artifact and repository engineering documentation. Static analysis covered markup, navigation attributes, page and modal identifiers, functions, global variables, persistence calls, network primitives, embedded resources, and data collections. No browser execution was used, so visual and behavioral conclusions are based on source evidence rather than end-to-end runtime testing.

| Metric                        |                              Finding |
| ----------------------------- | -----------------------------------: |
| File size                     |                      1,766,927 bytes |
| Lines                         |                               14,713 |
| Navigable areas               |                                   25 |
| Page containers               | 24 (`cafeteria` reuses the POS page) |
| Modal identifiers             |                                   49 |
| Inputs / selects / textareas  |                        276 / 90 / 14 |
| Buttons / tables              |                             594 / 50 |
| Named function declarations   |                                  658 |
| Inline event attributes       |                                  768 |
| Direct DOM query/create calls |                                  126 |
| `innerHTML` assignments       |                                  214 |
| Static `data:` resources      |                                    6 |
| External runtime requests     |                                    0 |

## Existing interface and functional modules

### Navigation and screens

The sidebar exposes 25 primary areas:

1. Dashboard.
2. Punto de Venta.
3. Cafetería.
4. Ventas Suspendidas.
5. Devoluciones.
6. Productos.
7. Categorías.
8. Proveedores.
9. Inventario.
10. Compras.
11. Clientes.
12. Fiestas.
13. Membresías.
14. Cupones / Promociones.
15. Corte de Caja.
16. Facturación CFDI.
17. Reportes.
18. Control de Acceso.
19. Usuarios.
20. Empleados.
21. Historial de Ventas.
22. Documentos.
23. Sincronización.
24. Notificaciones.
25. Configuración.

Additional global experiences include initial setup and activation, mandatory login, dark mode, a global numeric keyboard, notifications, confirmation dialogs, an AI-style assistant, client-facing POS mode, print windows, and a distributor panel.

### Menus, submenus, and dashboards

- **POS:** cashier/client modes, ticket list, product/category browsing, cafeteria presentation, customer association, coupons, suggested promotions, general and line discounts, price override, weighted items, notes, payment methods, change, suspended sales, reprint, cancellation, and returns.
- **Products:** catalog, wholesale/special prices, variants, related products, and import/export tabs.
- **Inventory:** stock overview, entries/replenishment, transfers, Kardex, supplier and purchasing views.
- **Events:** list, month/week/day/list calendar, quote builder, rooms, packages, documents, socks, snacks, promotions, and reservation details.
- **Cash:** current shift, expenses, withdrawals, movements, partial cuts, closing count, closing summary, and cut history.
- **Reports:** intelligence, sales, finance, inventory, customers, employees, parties/events, and access tabs.
- **Users:** user and role tabs plus custom permissions.
- **Employees:** staff list, weekly schedules, time clock, payroll calculation, payroll history, and receipts.
- **Synchronization:** monitor, registers, data, wristbands, backup, email reports, logs, and configuration.
- **Configuration:** business branding, tickets, POS categories, event settings, hardware/IVA placeholders, synchronization preferences, and demo reset.

The Dashboard presents synthesized KPIs and charts derived from the in-memory collections. It is not backed by an analytical store or server-generated metrics.

### Modal inventory

The source contains modal flows for:

- **Identity and authorization:** login, administrator PIN, employee PIN, user, password change, and generic confirmation.
- **POS and payments:** product detail, weight, discount, coupon/customer coupon, price override, customer selection, reprint, and generic note.
- **Cash:** opening, closing, expense, withdrawal, income, printed cut, and category detail.
- **Catalog and inventory:** product, POS category, product categories, purchase, direct purchase, replenishment, and transfer-related flows.
- **Customers and billing:** customer, customer search/list, CFDI, and invoice detail.
- **Events:** event editor/detail, calendar day, room, package, event documents, and socks.
- **Promotions and access:** promotion, coupon, new register, and new wristband.
- **Personnel:** employee, payroll detail, and payroll history.

There are no semantic `<form>` elements; form behavior is implemented through individual inputs and inline JavaScript handlers.

### Workflow observations

#### Sale and payment

Products are copied from `DB` into a global cart. Totals, promotions, coupons, discounts, weighted quantities, change, and payment completion are calculated in browser functions. Completing a sale mutates memory collections, shift totals, stock, history, audit entries, and simulated synchronization state. No server transaction exists, so atomicity and durability are absent.

#### Cash register

The prototype supports opening funds, expenses, withdrawals, income, expected cash, denomination counting, partial cuts, closing, history, and printable summaries. These operations are local mutations and can be bypassed or lost. They must eventually execute as authorized backend transactions.

#### Inventory

Inventory is held on product objects and modified by sales, replenishment, transfers, event sock allocation, purchases, and direct adjustments. A separate in-memory `kardexMovs` array represents movement history. There is no authoritative movement ledger or concurrency control.

#### Events

The event workflow is one of the richest references: rooms, packages, schedules, capacity/conflict checks, quotes, discounts, reservation conversion, documents/contracts, snacks, socks, payments, and status transitions. It combines UI, calculations, and document generation in the browser.

#### Users and permissions

The prototype defines roles, a permission matrix, per-user overrides, login by password/PIN/QR, administrative PIN gates, and an audit log. All are client-controlled. The concepts are useful; the enforcement implementation is not.

## Technical architecture found

### HTML structure

The artifact is a single document with a fixed top bar, collapsible sidebar, page containers toggled by `data-nav`, modal overlays, POS-specific layouts, and several components injected into `document.body` from script strings. Navigation hides and shows DOM sections instead of routing.

### CSS organization

CSS is embedded. The principal style block defines global tokens and sections for layout, pages, cards, tables, tabs, modals, POS, cafeteria, customer mode, users, cash, reports, synchronization, charts, access, events, responsive behavior, and AI. Additional `<style>` blocks are embedded in payment overlays and dynamically generated print/document windows. A Questrial font is embedded as base64. There is no modular stylesheet boundary, build pipeline, or component-level ownership.

### JavaScript organization

Almost all behavior is contained in one global script beginning around line 4,282. Functions are grouped loosely by comments but share globals and mutate the DOM directly. A smaller earlier script drives splash audio. There are no modules, imports, type system, dependency injection, test boundaries, or formal state transitions.

### Global state

The central `DB` object contains business identity, POS categories, products, memberships, rooms, event packages, events, customers, suppliers, promotions, coupons, roles, permission definitions, role permissions, users, audit entries, purchases, credits, registers, branches, sync configuration/logs, email reports, wristbands, current shift, cuts, suspended sales, returns, sale history, access logs, employees, time entries, payroll, and invoices.

Additional independent globals include cart and payment state, selected customer/product, promotion/coupon state, event/calendar editors, quote state, access count, current user, permission selection, cash movements, report filters, offline queue, backup history, Kardex, transfers, employee/payroll editors, timers, and mutable counters. This creates multiple overlapping sources of truth.

### Business logic versus interface logic

Functions containing business behavior include total and change calculation, coupon/promotion eligibility, event pricing and conflict checks, sale completion/cancellation/return, stock decrement, cash expectation and closing, payroll calculation, permission evaluation, access capacity, inventory/Kardex movements, and offline conflict simulation.

Predominantly interface functions include navigation, modal open/close, tabs, sidebar behavior, render functions, DOM searches, previews, animations, toasts, keyboard positioning, print-window composition, and field population. Many functions mix both categories, which prevents isolated testing and safe reuse.

### External libraries and assets

- Tabler Icons is loaded from jsDelivr using an unpinned `@latest` URL.
- Questrial font data, favicon, logos, and preview/upload images use embedded data URLs or base64.
- No JavaScript library is loaded externally.
- Generated documents use browser windows, HTML strings, and print dialogs rather than real PDF generation.

## Data model inferred from the prototype

The following are conceptual aggregates inferred from mock collections, not approved production tables:

| Domain                | Inferred records                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| Tenant and branch     | business, branches, business/event document settings                                                        |
| Identity              | users, roles, permissions, role permissions, sessions implied by globals                                    |
| POS                   | categories, products, cart, sales, sale lines, payments, suspended sales, returns, coupons, promotions      |
| Cash                  | registers, shifts, expenses, withdrawals, income, partial/final cuts, cash movements                        |
| Inventory             | products/stock, suppliers, purchases, purchase lines, Kardex movements, transfers                           |
| Customers             | customers, credits, associations to sales/events/memberships                                                |
| Events                | rooms, packages, reservations/events, schedules, snacks, socks, documents, payments                         |
| Membership and access | memberships, wristbands, access log, capacity state                                                         |
| Workforce             | employees, schedules, clock entries, payroll calculations and history                                       |
| Billing               | invoice/CFDI records and concepts                                                                           |
| Platform operations   | audit log, terminals, sync log/configuration, offline queue, backups, report-email schedules, notifications |

Prototype identifiers are counters or hard-coded strings, not UUIDs. Tenant ownership is absent. Branch scope appears as mutable display strings and is not consistently present. Currency uses JavaScript floating-point numbers. Many timestamps are locale-formatted strings. Referential integrity exists only by convention.

## Persistence analysis

### Persisted data

| Storage key       | Content                                             | Notes                                                                                               |
| ----------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `aspos_v1_tema`   | `dark` or `light`                                   | UI preference only                                                                                  |
| `aspos_v1_config` | `DB.negocio`, `DB.usuarios`, and activation license | JSON in browser localStorage; includes sensitive user access data and possibly base64 business logo |

No other calls to `localStorage` were found.

### Memory-only data

All operational data is memory-only, including products and stock changes, POS categories, cart, payments, sales history, suspended sales, returns, customers, events, memberships, promotions, coupons, suppliers, purchases, cash shifts and movements, cuts, access/wristbands, audit records, sync logs, offline queue, backups, reports, notifications, employees, attendance, payroll, and invoices.

Uploaded product/event assets stored as base64 in objects are also memory-only unless they happen to be part of the persisted business configuration.

### Data lost on reload

Reloading reconstructs mock `DB` defaults and discards every operational mutation listed above. The theme, business configuration, persisted users, license, and business logo may survive. The current authenticated session is not durably modeled; a new in-memory session gate is created.

### IndexedDB, API, real-time, and backend status

- **IndexedDB:** not implemented. The text “IndexedDB · 2.1 MB used” is a visual claim only; there are no IndexedDB APIs.
- **Offline mode:** simulated with booleans, an in-memory queue, timers, and fake status/log changes. The queue is lost on reload.
- **Backups:** simulated records and timers; no file, database dump, encryption, upload, or restore occurs.
- **REST/API:** none. No `fetch`, XMLHttpRequest, Axios, or equivalent network client exists.
- **WebSockets:** none. No WebSocket, EventSource, or real-time connection exists.
- **Backend/database:** none.
- **Email/WhatsApp/CFDI/AI:** UI simulations or browser URL/print behavior; no trusted service integration exists.

## Migration matrix

| Existing area                                        | Classification                          | Direction                                                                     |
| ---------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------- |
| Dashboard                                            | 1 — Preserve visually                   | Rebuild from authorized server metrics with freshness indicators              |
| POS catalog and ticket layout                        | 1 — Preserve visually                   | Recreate responsive cashier/client experience in Flutter                      |
| Cafeteria presentation                               | 1 — Preserve visually                   | Keep distinct visual mode over shared product/sale contracts                  |
| Cart, totals, discounts, coupons, and change         | 2 — Preserve logic with refactoring     | Specify and test rules; backend remains authoritative                         |
| Sale commit, cancellation, return, and reprint       | 3 — Replace with backend implementation | Transactional, idempotent, audited commands                                   |
| Suspended sales                                      | 3 — Replace with backend implementation | Durable tenant/branch/register ownership and expiry policy                    |
| Products and categories                              | 2 — Preserve logic with refactoring     | Keep useful fields and workflows; normalize ownership and validation          |
| Suppliers and purchases                              | 5 — Postpone                            | Define after inventory foundation and approval                                |
| Inventory and Kardex                                 | 3 — Replace with backend implementation | Immutable movement ledger and projections                                     |
| Customers and credits                                | 3 — Replace with backend implementation | Tenant isolation, consent, privacy, and credit policy                         |
| Events, calendar, rooms, packages, and quote builder | 2 — Preserve logic with refactoring     | Preserve workflow concepts; split into tested event services                  |
| Event-generated contracts/documents                  | 3 — Replace with backend implementation | Server templates, controlled files, audit, and versioning                     |
| Memberships                                          | 3 — Replace with backend implementation | Durable lifecycle and entitlements                                            |
| Promotions and coupons                               | 2 — Preserve logic with refactoring     | Formal deterministic rules evaluated authoritatively                          |
| Cash shifts and cuts                                 | 3 — Replace with backend implementation | Transactional register service with immutable evidence                        |
| Billing/CFDI                                         | 5 — Postpone                            | Requires compliant provider integration and fiscal review                     |
| Reports                                              | 3 — Replace with backend implementation | Governed definitions, server queries, jobs, and exports                       |
| Access control and wristbands                        | 5 — Postpone                            | Requires device/security design after identity and events                     |
| Users, roles, permissions, and login                 | 4 — Replace completely                  | Never reuse client-side credentials or authorization implementation           |
| Employees, attendance, schedules, and payroll        | 5 — Postpone                            | Separate workforce scope and legal requirements                               |
| Audit log                                            | 3 — Replace with backend implementation | Append-oriented server evidence; client events are untrusted                  |
| Synchronization and offline queue                    | 4 — Replace completely                  | Durable local store, idempotent commands, checkpoints, reconciliation         |
| Backup/restore UI                                    | 4 — Replace completely                  | Operational backup system outside ordinary POS authority                      |
| Notifications and scheduled email reports            | 5 — Postpone                            | Provider adapters and consent after core operations                           |
| Configuration, branding, and theme                   | 2 — Preserve logic with refactoring     | Typed tenant/branch configuration; local theme preference only                |
| Embedded AI assistant                                | 5 — Postpone                            | Current response logic is scripted; define safe value and data boundary later |

## Backend mapping

The following contracts are expected design inputs, not implemented endpoints or schemas. Every protected request derives tenant and branch authority from the authenticated server context.

| Existing area                | Backend module                                                     | Expected entities                                                       | Expected REST contract                                                 | Expected WebSocket events                                                | Permissions, scope, and offline behavior                                                                    |
| ---------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Dashboard                    | `dashboard_ceo`, `reportes`                                        | KPI projection, snapshot, freshness checkpoint                          | `GET /v1/dashboard`, `GET /v1/dashboard/branches/{id}`                 | `dashboard.snapshot.updated`, `dashboard.freshness.degraded`             | View company/assigned branches; online-first, cache last read only                                          |
| POS                          | `ventas`, `cajas`                                                  | sale, line, payment, idempotency outcome                                | `POST /v1/sales`, `GET /v1/sales/{id}`, cancellation/reversal commands | `sale.accepted`, `sale.rejected`, `sale.cancelled`                       | Create/view/cancel/reverse; tenant+branch+register; durable offline command outbox                          |
| Cafeteria                    | `ventas`, `productos`, `inventario`                                | shared sale/product plus preparation projection if later approved       | Shared sales/catalog contracts                                         | `sale.accepted`, `inventory.availability.changed`                        | Branch-scoped; same offline rules as POS                                                                    |
| Suspended sales              | `ventas`                                                           | suspended sale/draft, ownership, expiry                                 | `POST/GET /v1/suspended-sales`, resume/cancel commands                 | `suspended_sale.created`, `resumed`, `expired`                           | Operate own/register or manage branch; durable local draft plus reconciliation                              |
| Returns                      | `ventas`, `inventario`, `auditoria`                                | return, return line, refund, inventory effect                           | `POST /v1/sales/{id}/returns`, `GET /v1/returns/{id}`                  | `return.accepted`, `return.rejected`                                     | Authorize returns; branch scope; high-risk commands require online confirmation unless policy permits       |
| Sales history/reprint        | `ventas`, `archivos`                                               | sale receipt projection, print artifact metadata                        | `GET /v1/sales`, `GET /v1/sales/{id}/receipt`                          | `sale.receipt.available`                                                 | View/reprint in authorized scope; cache only explicitly allowed receipts                                    |
| Products                     | `productos`                                                        | product, availability, price reference, media reference                 | `GET/POST/PATCH /v1/products`                                          | `product.created`, `updated`, `availability.changed`                     | Catalog administration; tenant scope with branch availability; offline read model                           |
| Categories                   | `categorias`                                                       | category, hierarchy/order, classification                               | `GET/POST/PATCH /v1/categories`                                        | `category.updated`, `reordered`                                          | Catalog administration; tenant scope; offline read model                                                    |
| Suppliers/purchases          | `inventario` or future approved purchasing boundary                | supplier, purchase order, receipt, line                                 | Future `/v1/suppliers`, `/v1/purchases`, receipt commands              | `purchase.received`, `stock.changed`                                     | Purchasing/receiving roles; branch/location scope; generally online                                         |
| Inventory/Kardex/transfers   | `inventario`                                                       | location, movement, count, transfer, stock projection                   | `GET /v1/inventory`, movement/count/transfer commands                  | `inventory.changed`, `count.completed`, `transfer.updated`               | View/modify/count/transfer; tenant+branch/location; offline counts may queue, final conflicts reconcile     |
| Customers                    | `clientes`                                                         | customer, contacts, consent, merge history                              | `GET/POST/PATCH /v1/customers`                                         | `customer.updated`, `consent.changed`                                    | View/manage/export with privacy controls; tenant scope; minimal offline cache                               |
| Credits                      | Future decision under `clientes` or a dedicated approved module    | credit account, ledger, limit, settlement                               | Future credit commands and ledger queries                              | `credit.balance.changed`, `credit.limit.changed`                         | Financial permission; tenant+branch policy; no informal offline credit mutation                             |
| Events                       | `eventos`                                                          | event, schedule, room, package, capacity, reservation, attendee         | `/v1/events`, `/v1/event-schedules`, `/v1/reservations`                | `availability.changed`, `reservation.created`, `cancelled`, `checked_in` | Manage/reserve/check in; tenant+branch; offline check-in requires signed/checkpointed policy                |
| Event documents              | `eventos`, `archivos`                                              | template version, generated document metadata, signature/status         | `POST /v1/reservations/{id}/documents`, controlled download            | `reservation.document.available`                                         | View/generate/send; tenant+branch; sensitive documents not broadly cached                                   |
| Memberships                  | `membresias`                                                       | plan, membership, entitlement, lifecycle history                        | `/v1/membership-plans`, `/v1/memberships`, lifecycle commands          | `membership.started`, `renewed`, `suspended`, `expired`                  | Configure/enroll/renew/cancel; tenant scope, branch applicability; offline lookup limited                   |
| Promotions/coupons           | `promociones`                                                      | promotion, condition, benefit, coupon, usage ledger                     | `/v1/promotions`, `/v1/coupons`, evaluation/redemption commands        | `promotion.changed`, `coupon.redeemed`, `limit.reached`                  | Configure/evaluate/redeem; tenant+branch scope; offline uses versioned rules and server reconciliation      |
| Cash                         | `cajas`                                                            | register, terminal, shift, movement, declared count, cut, discrepancy   | `/v1/registers`, shift open/movement/close/reconcile commands          | `register.shift.opened`, `closed`, `discrepancy.detected`                | Open/operate/close/reconcile; branch+register; offline movements queue with strict idempotency              |
| Billing                      | Future compliant billing boundary, coordinated with `ventas`       | fiscal customer, invoice, concept, provider result                      | Future `/v1/invoices` issuance/status/cancellation                     | `invoice.issued`, `failed`, `cancelled`                                  | Fiscal permissions; tenant scope; online-only provider operations                                           |
| Reports                      | `reportes`, `archivos`, `notificaciones`                           | report definition, job, result, retention                               | `/v1/reports`, generation/status/download                              | `report.completed`, `failed`, `expired`                                  | Scoped view/export; tenant and assigned branches; online generation                                         |
| Access/wristbands            | `eventos`, `membresias`, future device adapter                     | credential, activation, admission, status                               | activation, validate, block, extend, check-in commands                 | `credential.activated`, `blocked`, `admission.recorded`                  | Access-control permission; branch/device scope; offline validation requires signed local policy             |
| Users/roles/permissions/auth | `autenticacion`, `usuarios`, `roles`, `permisos`                   | identity, credential, session, membership, role, permission, assignment | `/v1/auth/*`, `/v1/users`, `/v1/roles`, `/v1/permissions`              | `session.revoked`, `user.updated`, `role.assignment.changed`             | Server RBAC; tenant+branch assignments; offline authentication requires a separately approved device design |
| Employees/time/payroll       | Future workforce boundary plus `usuarios` where identities overlap | employee, schedule, clock entry, payroll period/result                  | Future workforce contracts                                             | `clock_entry.recorded`, `payroll.generated`                              | HR/payroll permissions; tenant+branch; clock entries may queue with device evidence                         |
| Audit                        | `auditoria`                                                        | immutable audit entry, integrity/retention metadata                     | `GET /v1/audit-events`, controlled export                              | Security alerts only; audit feed not broadcast generally                 | Privileged scoped view/export; writes originate server-side; local events remain untrusted evidence         |
| Synchronization              | cross-cutting service contracts coordinated by owning modules      | device, command, checkpoint, outcome, conflict                          | `/v1/sync/commands`, `/v1/sync/checkpoints`, reconciliation            | `sync.outcome.available`, `device.status.changed`                        | Registered device and scoped operator; durable IndexedDB/SQLite outbox, replay, checkpoint, conflict policy |
| Notifications                | `notificaciones`                                                   | intent, preference, template, attempt, status                           | `/v1/notifications`, `/v1/notification-preferences`                    | `notification.status.changed`                                            | Request/manage preferences; tenant scope; provider delivery online                                          |
| Configuration/branding/files | `configuracion`, `archivos`, `empresas`, `sucursales`              | definition, scoped value, history, object metadata                      | `/v1/configuration`, `/v1/files/upload-intents`                        | `configuration.changed`, `file.available`                                | Scoped administration; cache safe effective values, never secrets                                           |

## Security and scalability risks

Thirty material risks were identified:

1. Privileged factory credentials are embedded in browser source.
2. A client-visible license-signing secret makes activation forgeable.
3. Passwords and PINs are stored and compared in plaintext.
4. Authentication is entirely client-side and bypassable through developer tools.
5. Authorization is mutable client state and cannot protect data or operations.
6. Tenant ownership is absent from the data model.
7. Branch scope is inconsistent and often represented only by display strings.
8. Sensitive user access data is persisted unencrypted in `localStorage`.
9. Audit entries are client-generated, mutable, and lost on reload.
10. Inline event handlers and unrestricted script execution prevent a strong Content Security Policy.
11. Extensive `innerHTML` composition creates cross-site scripting risk when values become external.
12. Unpinned CDN use (`@latest`) creates supply-chain and reproducibility risk.
13. Uploaded base64 content lacks authoritative type, size, malware, and ownership controls.
14. Browser print windows interpolate values into HTML without a trusted rendering boundary.
15. Operational data is not durable and is lost on reload or browser failure.
16. The simulated offline queue is memory-only and cannot guarantee delivery.
17. Simulated backups provide false assurance and cannot restore data.
18. JavaScript floating-point arithmetic is unsafe for authoritative currency calculations.
19. Multi-step sale, cash, stock, and return mutations are not transactional.
20. Sequential in-memory IDs can collide across terminals and restarts.
21. There is no idempotency protection for retries or duplicated offline commands.
22. Stock is a mutable field rather than an auditable movement ledger.
23. Concurrent terminals have no locking, versioning, or conflict-safe source of truth.
24. A single global `DB` and many secondary globals create inconsistent state.
25. Hundreds of functions share mutable state and lack module boundaries.
26. Business logic and DOM manipulation are interleaved and cannot be tested independently.
27. Similar rendering, lookup, formatting, and helper logic is duplicated.
28. Hard-coded branches, IP addresses, roles, users, dates, catalog items, and mock metrics distort portability.
29. Timers and fake network states can diverge from UI state and leak across navigation/session changes.
30. Simulated CFDI, email, WhatsApp, AI, PDF/Excel, synchronization, and backup behaviors are production blockers if mistaken for real integrations.

## Recommended migration sequence

1. **Freeze the reference:** retain the audited HTML and hash as a read-only product artifact; capture approved screenshots and workflows separately.
2. **Define the first vertical slice:** cashier authentication, tenant/branch/register context, catalog read model, cart, cash shift, idempotent sale submission, receipt, audit, and stock effect.
3. **Specify contracts and invariants:** exact money rules, taxes, discounts, promotion precedence, cancellation/return policy, permissions, offline acceptance, and conflict behavior.
4. **Build identity and isolation first:** backend authentication, rotating sessions, RBAC, tenant/branch repositories, terminal identity, and negative isolation tests.
5. **Establish durable data:** PostgreSQL migrations, UUIDs, UTC timestamps, transactions, audit evidence, sale/payment records, and inventory movement ledger.
6. **Implement offline foundations:** IndexedDB or SQLite outbox, client-generated command IDs, checkpoints, retry, duplicate outcomes, and explicit reconciliation.
7. **Rebuild the core UI:** preserve proven POS and cafeteria interaction patterns in Flutter while keeping business rules out of widgets.
8. **Add cash and operational recovery:** register opening/closing, movements, suspended sales, reprints, cancellation, and returns with server authorization.
9. **Expand catalog and customer capability:** products, categories, branch availability, customers, consent, and controlled assets.
10. **Migrate events and promotions:** translate the strongest prototype workflows into independently tested modules and contracts.
11. **Add reporting projections:** server-governed KPIs, exports, freshness, and authorization after reliable transactional data exists.
12. **Evaluate postponed areas separately:** billing, workforce/payroll, access devices, notifications, automated reports, and AI each require their own approved scope and security review.

## Features to preserve

- Fast category-based POS navigation and clear product cards.
- Distinct cashier and customer-facing modes.
- Cafeteria visual treatment over shared sale behavior.
- Persistent ticket panel, quantity controls, weighted products, and clear payment/change feedback.
- Suspended-sale recovery, reprint, cancellation, and return workflows as product requirements.
- Cash opening, movements, denomination count, partial cut, final close, and discrepancy concepts.
- Event calendar, quote builder, rooms, packages, conflict visibility, documents, snacks, and socks workflows.
- Configurable categories, products, promotions, coupons, roles, and permissions as concepts.
- Branch-aware dashboard/report filtering and data-freshness presentation.
- Offline/synchronization status visibility, once backed by real checkpoints and outcomes.
- Responsive desktop-first styling, global touch keypad, theme preference, and business branding.

Preservation means retaining user value and visual intent, not copying the single-file implementation.

## Features to postpone

- CFDI issuance and fiscal integrations.
- Payroll and full workforce management.
- Hardware access/wristband integrations beyond interface research.
- Automated email reports and notification-provider delivery.
- Backup/restore controls inside the ordinary POS interface.
- AI assistant functionality.
- Distributor activation mechanisms.
- Advanced analytics or specialized analytical infrastructure.
- Any “PDF” or “Excel” behavior that is only a renamed print/CSV simulation.

## Final conclusion

AS POS V1 demonstrates substantial product exploration and should remain a first-class reference for workflows, terminology, information architecture, and visual direction. Its breadth also makes it unsuitable for direct evolution into production: it centralizes authority, data, business rules, and presentation in one browser document and provides no durable or secure operational boundary.

Migration should be selective. Preserve the interaction patterns that reduce operator effort; formally specify and test the business rules that appear valuable; replace identity, permissions, persistence, transactions, synchronization, audit, integrations, and multi-tenancy with the approved AS ONE architecture. The prototype should never receive production credentials or real customer data.
