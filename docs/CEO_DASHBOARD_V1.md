# AS ONE CEO Dashboard V1 Contract

## 1. Status and purpose

This document is the canonical inspection and product contract for the first AS ONE CEO dashboard. It records what the repository can support now and prevents the frontend from presenting invented metrics, inferred totals, or data from domains that do not yet exist.

This task defines documentation only. It does not reserve new endpoint IDs, implement reporting projections, add database objects, or change the current Flutter interface.

## 2. Inspection basis

The inspection covers the repository at `1888e87` plus the uncommitted TASK 10.4B development-bootstrap work. Evidence was taken from:

- registered Fastify routes under `apps/api/src/modules`;
- PostgreSQL schemas and migrations `0000` through `0010`;
- the approved REST contracts in `API_CONTRACTS.md`;
- the event vocabulary in `REALTIME_EVENTS.md`;
- the permission seed in `packages/database/src/seeds/technical-permissions.ts`;
- the current Flutter Web application under `apps/one`;
- operational, authentication, administration, catalog, and inventory tests.

Contract documentation alone is not evidence that a runtime capability exists. A capability is considered implemented only when its route or executable application layer, persistence, authorization, and relevant tests are present.

## 3. Capability status vocabulary

| Status | Meaning |
| --- | --- |
| Implemented | Runtime code and its required persistence exist and are tested. |
| Partial | A usable subset exists, but a named dashboard requirement cannot be represented completely. |
| Missing | No executable backend capability or authoritative persistence exists. |
| Blocked | A dashboard result depends on another missing authoritative domain or approved projection. |
| Future | The capability belongs to a later roadmap phase and must not appear in Dashboard V1. |

## 4. Capability matrix

| Domain | Status | Repository evidence | Dashboard V1 decision |
| --- | --- | --- | --- |
| Sales | Blocked | E073-E080 and sale permissions are documented, but no sales tables, module, repository, service, or registered routes exist. | Exclude revenue, sales totals, tickets sold, average ticket, trends, and comparisons. |
| Tickets | Future | Product ecosystem and roadmap references exist; there is no ticket schema, contract, permission, or runtime module. | Exclude. |
| Admissions | Future | Admissions appear only as future product language and catalog examples. There is no admission ledger or endpoint. | Exclude. |
| Parties and events | Future | AS Events is planned, but there is no event, party, booking, capacity, or attendance persistence or API. Inventory reservation owner types are not an events implementation. | Exclude. |
| Inventory | Implemented | Locations, balances, movements, transfers, reservations, counts, reconciliation findings, posting, reversal, repair, tenant scope, audit, and outbox are implemented and tested. | Include bounded operational read cards only. Do not infer monetary value or low-stock state. |
| Memberships | Future | `company_memberships` represents workforce/user access to a tenant; it is not a customer membership product. No customer membership lifecycle exists. | Exclude membership activity. |
| Rewards | Future | Product and roadmap references only; no rewards account, earn, redeem, balance, or permission model exists. | Exclude. |
| Branches | Implemented | E009 and E012-E015 are registered with authenticated company and branch isolation. | Include authorized branch context and directory. Do not calculate performance. |
| Companies | Implemented | E008 and E010-E011 are registered; company settings are also implemented. | Include current company and eligible-company context. |
| Realtime events | Partial | Transactional outbox writes and a 70-event contract exist. No WebSocket server, subscriber authorization, dispatcher, replay API, or reporting projection publisher is implemented. | Dashboard V1 uses HTTP refresh only. Contracted event names are not runtime support. |
| Audit | Partial | `audit_log` exists and implemented mutations write audit records atomically. Contract E093 is not registered. | Do not include an audit feed or audit KPI. |
| Reports | Missing | No reporting module, reporting tables, aggregate endpoints, or materialized CEO projections exist. Contracted CEO summary events explicitly remain projection proposals. | Exclude executive totals, rankings, trends, forecasts, and comparisons. |
| POS | Partial | Device identity, catalog, inventory, browser authentication, and operational foundations exist. Sales, cash registers, cash sessions, payments, offline sync, and a production POS application do not. | Do not present POS transaction or register status. |
| Users | Implemented | E020-E033 cover tenant-scoped users, memberships, roles, permissions, and branch access. | The directory is available, but it is not a staff-presence source. Exclude staff status from V1. |
| Employees | Missing | A global user with a company membership is an authorization identity, not an employee, schedule, time-clock, or presence record. | Exclude headcount, attendance, shifts, and online staff. |
| Cash registers | Blocked | E038-E048 and permissions are documented, but no cash-register or cash-session persistence and no routes are implemented. | Exclude register status, cash position, openings, closures, and discrepancies. |
| Transactions | Partial | Inventory transactions are authoritative and implemented. Financial sales, payments, refunds, and cash transactions are contracts only. | Include inventory movements only; never label them as sales or financial transactions. |
| Catalog | Implemented | Categories, brands, products, variants, options, values, and barcodes have tenant-scoped APIs and tests. Prices and branch availability remain absent. | Include a product directory, not price or availability summaries. |
| Authentication and context | Implemented | Browser login, E164 bootstrap, refresh, session, permissions, eligible companies, authoritative branches, and switching are implemented. | Use as the mandatory dashboard shell and scope authority. |
| Notifications | Missing | No notification persistence, delivery service, user inbox, preference model, or endpoint exists. | Exclude. |

## 5. Dashboard V1 boundary

Dashboard V1 is a read-only operational landing page. It is not yet an executive financial dashboard. It may show only authoritative records returned by currently registered endpoints and scoped by the authenticated company and branch context.

The dashboard must not:

- calculate revenue, admissions, branch rankings, sales trends, or average transaction values;
- treat a page length or `has_more` flag as a total;
- calculate inventory valuation without `inventory.cost.read` and an approved valuation contract;
- translate inventory reconciliation findings into low-stock alerts;
- treat user memberships as employees or customer memberships;
- claim realtime behavior while no realtime transport is running;
- persist dashboard responses across logout, company switch, or branch switch;
- combine data from unauthorized branches;
- show placeholder values that resemble production metrics.

## 6. Included sections

### 6.1 Executive context

This section establishes who is signed in and which company and branch scope authorizes every downstream request. It is the only executive-summary content currently supported.

### 6.2 Branch directory

This section lists authorized active branches and the current selection. It does not rank branches or imply operational performance.

### 6.3 Catalog directory

This section provides a bounded product directory for navigation and operational awareness. It does not expose price, availability, sales, or product-performance metrics.

### 6.4 Inventory operations

This section provides bounded authoritative lists for balances, movements, counts, transfers, reservations, and reconciliation findings. Each card preserves the endpoint's filters, pagination, exact decimal strings, permissions, and branch scope.

## 7. Excluded expected sections

| Expected section | Decision | Reason |
| --- | --- | --- |
| Executive Summary | Limited | Only authenticated company, branch, session, and permission context is authoritative. No business summary is available. |
| Today's Revenue | Excluded | No sales or payment implementation. |
| Admissions | Excluded | No admissions domain. |
| Branch Performance | Excluded | Branches exist, but sales/reporting facts and ranking projections do not. |
| Active Events | Excluded | No events or booking domain. |
| Inventory Alerts | Excluded | Reconciliation findings exist, but no approved low-stock policy or alert projection exists. A finding must not be relabeled as a stock alert. |
| Staff Status | Excluded | Users are authorization identities; employee presence and scheduling do not exist. |
| Membership Activity | Excluded | No customer membership domain. |
| Notifications | Excluded | No notification domain or inbox. |
| CEO Insights | Excluded | No reporting projections, formulas, freshness objectives, or analytics contract. |

## 8. Dashboard card contracts

All paths below are existing paths. Dashboard V1 does not create dashboard-specific endpoints.

### 8.1 Active operating context

| Field | Contract |
| --- | --- |
| Title | Active operating context |
| Description | Shows the authenticated user, current company, current branch or explicit company-wide context, and available context-switch choices. |
| Backend source | Authenticated session and administration context services. |
| Endpoint | `GET /api/v1/auth/session`, `GET /api/v1/auth/me`, `GET /api/v1/context/companies`, `GET /api/v1/context/branches` |
| Refresh strategy | Load after browser session recovery and refresh after company or branch switching. No interval polling is required while context remains unchanged. |
| Realtime support | None required; context is revalidated by REST. Session revocation events are contracted but no realtime transport exists. |
| Permission required | Authenticated active membership; no business permission. |
| Caching policy | Session-memory only. Purge on logout, expiry, company switch, branch switch, or authorization failure. Never share between users. |
| Empty state | Explain that no active company or branch is available and prevent operational cards from loading. |
| Loading state | Keep the authenticated shell visible and show a bounded context-loading indicator. |
| Failure state | Use the safe API error; expired sessions return to login, and scope failures require context rediscovery. |

### 8.2 Authorized branches

| Field | Contract |
| --- | --- |
| Title | Authorized branches |
| Description | Lists branches visible in the current company and marks the current and default branch. It reports no performance measure. |
| Backend source | Branch and branch-access records. |
| Endpoint | `GET /api/v1/context/branches`; use `GET /api/v1/companies/{company_id}/branches` only when the actor has `branch.read` and the richer directory is required. |
| Refresh strategy | Refresh on context change and manual refresh; otherwise at most every five minutes. |
| Realtime support | No runtime support. `branch.updated` is contracted only. |
| Permission required | Active membership for E009; `branch.read` for E012. |
| Caching policy | Memory cache keyed by user, company, and effective branch scope for up to five minutes. Invalidate on context change or 401/403. |
| Empty state | State that the actor has no authorized active branches; never interpret an empty list as company-wide access. |
| Loading state | Skeleton rows without synthetic branch names. |
| Failure state | Preserve current context and offer retry; do not display a stale branch as authorized after a scope error. |

### 8.3 Product directory

| Field | Contract |
| --- | --- |
| Title | Product directory |
| Description | Shows a bounded, filterable list of authorized products and variants for operational navigation. It is not a product-performance card. |
| Backend source | Product and product-variant catalog tables. |
| Endpoint | `GET /api/v1/products`; product detail may use `GET /api/v1/products/{id}`. |
| Refresh strategy | Load on section entry, context change, filter change, and manual refresh; background refresh no more frequently than five minutes. |
| Realtime support | No runtime support. Catalog events exist only in the approved event contract/outbox. |
| Permission required | `catalog.read`. |
| Caching policy | Scope-keyed in-memory pages for up to five minutes. Do not persist data across authentication sessions. |
| Empty state | No products match the authorized scope and filters. |
| Loading state | Bounded list skeleton preserving the selected filters. |
| Failure state | Safe error with retry; retain filters but not an unverified stale result after a scope change. |

### 8.4 Inventory balances

| Field | Contract |
| --- | --- |
| Title | Inventory balances |
| Description | Displays authoritative quantity projections by authorized branch, location, and variant. It does not calculate stock value or low-stock status. |
| Backend source | Rebuildable `inventory_balances` projection. |
| Endpoint | `GET /api/v1/inventory/balances` |
| Refresh strategy | Refresh on context/filter change, manual action, and every 30 seconds while visible. Show the response freshness/checkpoint where available. |
| Realtime support | No runtime transport. `inventory.stock.changed` is contracted for a future enhancement; REST remains authoritative. |
| Permission required | `inventory.read`; cost fields additionally require `inventory.cost.read` and are outside the initial card. |
| Caching policy | In-memory only, keyed by company, branch, location, variant filters, and cursor. Maximum freshness window 30 seconds while visible. |
| Empty state | No balances exist in the selected authorized scope. This does not mean zero inventory for hidden locations. |
| Loading state | Quantity-safe skeletons; never render zero as a loading placeholder. |
| Failure state | Mark data unavailable or stale with its last retrieval time and provide retry; never silently retain values after a context change. |

### 8.5 Recent inventory movements

| Field | Contract |
| --- | --- |
| Title | Recent inventory movements |
| Description | Displays a bounded ledger history of authorized inventory movements in server-defined order. |
| Backend source | `inventory_movements` and its read service. |
| Endpoint | `GET /api/v1/inventory/movements` |
| Refresh strategy | Refresh on context/filter change, manual action, and every 30 seconds while visible. Use endpoint cursors; do not merge pages by client timestamp alone. |
| Realtime support | No runtime transport. Future movement events may trigger an HTTP refresh but never replace ledger recovery. |
| Permission required | `inventory.read`. |
| Caching policy | In-memory cursor pages for no more than 30 seconds; invalidate after a successful inventory mutation in the same client. |
| Empty state | No movements match the selected authorized scope and period. |
| Loading state | Timeline/list skeleton without fabricated movement numbers. |
| Failure state | Safe error and retry; maintain an explicit stale indicator if a previously loaded page remains visible. |

### 8.6 Inventory work queues

| Field | Contract |
| --- | --- |
| Title | Inventory work queues |
| Description | Provides separate bounded lists for counts, transfers, and reservations in selected lifecycle states. It must not combine them into an unsupported total. |
| Backend source | Inventory count, transfer, and reservation aggregates. |
| Endpoint | `GET /api/v1/inventory/counts`, `GET /api/v1/inventory/transfers`, `GET /api/v1/inventory/reservations` |
| Refresh strategy | Refresh the selected queue on context/status change, manual action, and every 60 seconds while visible. |
| Realtime support | No runtime transport. Contracted lifecycle events may support invalidation later. |
| Permission required | `inventory.read`. |
| Caching policy | In-memory pages keyed by company, branch, queue type, lifecycle filter, and cursor for up to 60 seconds. |
| Empty state | No records match the selected queue and state. Do not show `0` as a company-wide total. |
| Loading state | One skeleton for the selected queue; do not request every lifecycle state simultaneously. |
| Failure state | Isolate failure to the selected queue and allow retry without clearing other successfully loaded cards. |

### 8.7 Reconciliation findings

| Field | Contract |
| --- | --- |
| Title | Reconciliation findings |
| Description | Lists authoritative inventory integrity findings by status and severity. These are reconciliation findings, not low-stock alerts. |
| Backend source | `inventory_reconciliation_findings` and repair read service. |
| Endpoint | `GET /api/v1/inventory/reconciliation/findings` |
| Refresh strategy | Refresh on context/filter change, manual action, and every 60 seconds while visible. |
| Realtime support | No runtime transport. No dashboard alert projection exists. |
| Permission required | `inventory.reconcile`. |
| Caching policy | Scope-keyed in-memory pages for up to 60 seconds. Purge immediately when effective permission is lost. |
| Empty state | No findings match the selected status, severity, and authorized scope. Do not claim that all inventory is healthy beyond that scope. |
| Loading state | Severity-neutral skeleton rows. |
| Failure state | Safe error with retry; do not downgrade an unknown state to healthy. |

## 9. Shared data and interaction rules

1. Company and branch scope comes exclusively from the authenticated session.
2. Cards load only when their exact permission is present in E007.
3. A company-wide session may aggregate only records returned by existing authorized collection endpoints. It must not infer inaccessible branches.
4. Decimal quantities remain strings through transport and presentation formatting.
5. Collection cards preserve opaque cursors and `has_more`; they never manufacture totals.
6. Every card displays the active company/branch context inherited from the shell.
7. A company or branch switch cancels in-flight requests and clears all previous-scope cache entries.
8. `401` initiates the approved browser recovery flow. `403` hides or disables the affected card after permission rediscovery. `404` does not reveal cross-tenant existence.
9. Partial card failure does not blank successful cards, but the page exposes that its view is incomplete.
10. No dashboard response is stored in IndexedDB or local storage in V1.

## 10. Refresh and realtime policy

Dashboard V1 is HTTP-first. Polling is visibility-aware and stops when the browser tab is hidden. Manual refresh remains available. Requests for the same card, scope, and filters are coalesced client-side.

The existing event document is a contract, not an implemented delivery channel. Dashboard V1 must not open a WebSocket or claim live updates until all of the following exist:

- authenticated subscription transport;
- company and branch authorization per event;
- outbox dispatcher and retry policy;
- client deduplication and checkpoint recovery;
- the authoritative recovery endpoints;
- documented freshness and retention objectives.

When those gates are met, events may invalidate cards and trigger authoritative REST recovery. Event payloads do not become the dashboard's source of truth.

## 11. Responsive layout contract

The layout retains the existing AS ONE responsive shell and design tokens. It does not redesign the brand.

| Viewport | Navigation and context | Content grid | Card behavior |
| ---: | --- | --- | --- |
| 390 px | Compact header; company and branch actions remain reachable without horizontal scrolling. | One column; 16 px outer gutter. | Cards use natural height; tables become short vertical lists; filters open in a compact overlay. |
| 768 px | Compact/tablet navigation with persistent context label. | Two equal columns; 24 px gutter. | Active context spans both columns. Inventory lists may span both columns; no horizontal page scroll. |
| 1024 px | Desktop navigation may remain visible. | Twelve-column grid; cards normally span 4 or 6 columns. | Context and primary inventory balances span 6 or 12 columns; work queues may use tabs. |
| 1440 px | Persistent desktop navigation and context controls. | Twelve-column grid in a centered content region; 24 px gaps. | Three 4-column summary/navigation cards or two 6-column operational cards per row. |
| 1920 px | Same desktop shell; content remains centered instead of stretching indefinitely. | Maximum content width 1600 px, twelve columns, 32 px outer margins or greater. | Up to four compact directory cards per row only when readable; ledger and queue cards remain at least 6 columns wide. |

Across all sizes:

- keyboard order follows visual order;
- loading, empty, stale, and failure states occupy the same card boundary;
- no information is encoded by color alone;
- exact quantities remain readable without truncating sign, scale, or unit;
- cards are reordered by section, never by assumed business importance derived from missing metrics.

## 12. Missing backend capabilities

The following capabilities are required before the excluded executive sections can be introduced:

1. Sales, sale lines, payments, refunds, and cash-session implementation using approved financial contracts.
2. Read-only reporting endpoints or projections with authoritative formulas, period boundaries, currency handling, tenant scope, and freshness checkpoints.
3. Tickets and admissions ledgers with lifecycle and capacity semantics.
4. Events, parties, bookings, attendance, and capacity models.
5. Customer identities and customer membership lifecycle distinct from company user memberships.
6. Rewards accounts, earn/redeem ledger, balances, and expiration policy.
7. Employee, shift, attendance, and presence models distinct from authorization users.
8. Notification inbox, delivery state, preferences, and permission model.
9. Low-stock policy and alert projection; current balances alone do not define an alert.
10. Audit read E093 if an audit card is later approved.
11. Realtime transport, dispatcher, authorized subscriptions, and recovery endpoints.
12. CEO reporting permissions if executive reads must be narrower or broader than existing domain reads.

## 13. Recommended implementation order

1. Implement the current read-only Dashboard V1 cards using existing context, branch, catalog, and inventory endpoints.
2. Add card-level tests for permission gating, tenant/branch switching, pagination, empty/loading/failure states, and stale-data labeling.
3. Complete cash-register and cash-session foundations before exposing cash operations.
4. Implement the sales/payment source of truth before defining any revenue card.
5. Approve reporting formulas, time zones, currency aggregation, freshness objectives, and dedicated read contracts before building executive summaries or rankings.
6. Implement the reporting projections and their recovery semantics; then add realtime invalidation as an optimization.
7. Deliver tickets/admissions, events, customer memberships/rewards, employees, and notifications in their owning roadmap phases before adding their dashboard sections.

Each future card requires its own evidence-backed contract and must preserve current tenant, branch, permission, audit, and privacy rules.

## 14. Acceptance criteria

Dashboard V1 is contract-compliant when:

- every visible card maps to one of the existing endpoints in section 8;
- missing permissions remove the affected card without exposing data;
- a context switch clears previous-scope data;
- no list length is presented as a total;
- no revenue, admission, event, membership, rewards, staff, notification, low-stock, ranking, forecast, or insight value appears;
- all states and layouts defined here are implemented accessibly;
- the UI identifies stale or failed data and never substitutes fabricated values.
