# AS ONE Inventory Operations Design

## Status

This is the TASK 09.4 Block 3.1 design report. It creates no schema, migration,
route, or production code. Authority remains, in order: accepted ADRs, published
contracts, the reconciled core model, and this implementation design.

TASK 09.4 Block 3.2A now implements the physical foundation in migration
`0005_inventory_operations_foundation`: `inventory_locations`,
`inventory_balances`, `inventory_movements`, and
`inventory_movement_lines`. This does not implement posting, balance mutation,
transfers, reservations, or HTTP behavior.

Physical decisions confirmed by 0005:

- every location and movement is branch-owned, including transit locations;
- no default location is inserted or backfilled by the migration;
- default creation is deferred to the controlled idempotent location service;
- quantities are `numeric(19,6)` and costs are `numeric(19,4)`;
- movement numbers and location codes are limited to 64 characters;
- UOM uses the existing `unit_of_measure_code` primary key;
- metadata is an optional JSON object limited to 8192 serialized bytes;
- `quantity_available` remains derived and is not stored;
- no lookup tables, seed rows, triggers, transfer tables, or reservation tables

Physical decisions confirmed by
`0006_inventory_transfers_and_reservations`:

- exactly four tables: `inventory_transfers`, `inventory_transfer_lines`,
  `inventory_reservations`, and `inventory_reservation_lines`
- transfer states are `requested`, `approved`, `shipped`,
  `partially_received`, `received`, `rejected`, `cancelled`, and
  `remainder_rejected`
- reservation states are `active`, `confirmed`, `released`, `expired`, and
  `cancelled`; owner types are `pos_cart`, `event`, `booking`, and `order`
- quantities use `numeric(19,6)` and remaining reservation quantity is derived
- reservation location belongs to each line; a defensive line `branch_id`
  supports branch-safe composite foreign keys without changing aggregate scope
- lifecycle checks are row-local; movement compatibility, orchestration,
  posting, balance mutation, expiration jobs, audit, and outbox behavior remain
  deferred to service blocks
  are introduced.

## Executive summary

AS ONE will use an immutable movement ledger as inventory accounting truth and a
transactionally maintained balance projection for fast reads. Stock identity is
`company -> branch -> inventory_location -> product_variant`. Every posting
commits its ledger lines, balances, workflow state, cost projection, audit,
outbox, and idempotency result in one PostgreSQL transaction.

V1 prohibits negative stock. Posted facts are immutable; corrections and
reversals create compensating movements. Transfers use a parent document plus
shipment and receipt movements. Reservations change reserved quantity, never
physical on-hand quantity. PostgreSQL row locks in deterministic order prevent
overselling and partial posting.

## Inspection report

### Existing decisions and reusable primitives

- ADR-0004: immutable ledger, rebuildable balance projection, compensating
  corrections, and default denial of negative inventory.
- ADR-0005: idempotency, audit, outbox, and domain effects commit together;
  Redis and WebSockets are not sources of truth.
- ADR-0006: company scope comes from authentication; tenant-safe composite
  foreign keys defend company and branch isolation.
- Migration 0004: variant catalog, exact UOM, quantity scale, and cost
  foundations. No inventory operations table exists yet.
- Existing `audit_log`, `outbox_events`, and `idempotency_keys` are reusable.
- Current repositories already demonstrate deterministic locking, safe
  constraint mapping, sanitized unknown errors, and stored idempotent responses.
- E064-E072 reserve locations, balances, adjustments, counts, reversals, and
  recovery. E108-E135 reserve transfers, durable counts, reservations, kardex,
  costs, policies, receipts, and consumption.
- Existing seeded inventory permissions are `inventory.read`,
  `inventory.cost.read`, `inventory_location.manage`, `inventory.adjust`,
  `inventory.count`, and `inventory.reverse`.

### Contradictions reconciled

| Topic | Existing conflict | Design decision |
| --- | --- | --- |
| Stock identity | Resolved | `product_variant_id`; `product_id` is catalog metadata only |
| Movement state | Resolved | `draft,pending,posted,cancelled,reversed`; `committed` is not a persisted inventory state |
| Adjustment sign | Resolved | E069 uses positive quantity plus `adjustment_in|adjustment_out` |
| Insufficient-stock code | Resolved | `insufficient_inventory`; `insufficient_stock` is replaced |
| Balance event | Resolved | Only `inventory.stock.changed`; `inventory.balance_changed` is replaced |
| Location permission | Resolved | `inventory_location.manage` |
| Count model | E070 is immediate while E115-E123 are durable | Preserve both; E070 does not replace the durable workflow |

No existing endpoint ID or event name is reassigned.

### Block 3.1A contract readiness

The inventory identity, movement state, quantity direction, insufficient-stock
error, stock-change event, and location-management permission are now reconciled
across the core model, API contract, realtime contract, and inventory design.
Migration 0005 may use these canonical names without compatibility columns,
duplicate states, duplicate events, or permission aliases.

## Business model

Each inventory-enabled branch has exactly one default `main` location, created
through an idempotent bootstrap command. Existing branches use the same command
during deployment. No product stores a default location.

| Location type | Purpose | Holds stock |
| --- | --- | --- |
| `main` | Default branch warehouse | Yes |
| `sales_floor` | POS-accessible stock | Yes |
| `cafeteria` | Snacks and ingredient stock | Yes |
| `event_storage` | Event operational stock | Yes |
| `damaged` | Quarantined or damaged goods | Yes |
| `returns` | Returns awaiting disposition | Yes |
| `transit` | System-managed shipped stock | Yes |
| `virtual` | Routing/reporting anchor | No |

Damaged quantity is stock in a `damaged` location, not a special balance column.
A location lifecycle is `active`, `inactive`, or terminal `retired`. Independent
`receiving_enabled` and `issuing_enabled` flags can block one direction without
retiring the location. Virtual locations reject physical effects. Retirement
requires zero quantities and no open reservation, transfer, or count.

## Quantities

All quantities use exact `numeric(19,6)` and JSON decimal strings.

| Quantity | Definition | Stored or derived |
| --- | --- | --- |
| `quantity_on_hand` | Physical quantity under location custody | Stored projection |
| `quantity_reserved` | On-hand allocated to active reservations | Stored projection |
| `quantity_available` | New commitment capacity | Derived: on hand minus reserved |
| `quantity_in_transit` | Shipped, not finally received/rejected | Stored in destination-scoped transit balance |
| `quantity_damaged` | On-hand in damaged locations | Derived |
| `quantity_expected` | Approved future receipt | Derived from future procurement/transfer workflow; not V1 balance |

```text
quantity_available = quantity_on_hand - quantity_reserved
quantity_on_hand >= 0
quantity_reserved >= 0
quantity_reserved <= quantity_on_hand
quantity_in_transit >= 0
```

Shipment removes source on-hand and adds destination-branch transit custody.
Receipt removes transit and adds destination on-hand. This keeps one ledger
authority and avoids a separate transfer quantity ledger.

## Source of truth and invariants

The chosen model is **immutable movement ledger plus transactionally maintained
balance projection**. It is not general event sourcing.

1. Every posted line has positive input quantity and an explicit effect.
2. Every line changes at least one balance component.
3. A posted movement has at least one posted line.
4. Transfer custody balances by workflow reference and variant.
5. Ledger, projection, workflow, cost, audit, outbox, and idempotency commit or
   roll back together.
6. Posted/reversed lines cannot be updated or deleted; a posted header can only become `reversed` after its compensating movement posts.
7. Reversal creates a new movement and transitions the original header to `reversed`.
8. Folding posted lines reconstructs all balance quantities.
9. Drift is detected and never silently repaired.
10. Important records are retired or compensated, never destructively deleted.

## Proposed physical tables

Every company table has a tenant-safe key including `company_id`; every
branch-owned table also carries `branch_id`. IDs use UUIDv7 where supported.

### `inventory_locations`

- Primary key: `id`.
- Ownership: `company_id`, `branch_id`; composite branch FK.
- Fields: normalized `code`, `name`, `location_type`, `status`, `is_default`,
  receive/issue flags, `version`, actors and UTC timestamps.
- Checks: valid type/status; virtual cannot receive/issue; retired timestamp
  matches status.
- Unique: `(company_id,id)`, `(company_id,branch_id,id)`, active normalized
  `(company_id,branch_id,code)`.
- Partial indexes: one active default per branch; active branch/type lookup.
- Soft retirement only.

### `inventory_balances`

- Primary key: `id`.
- Ownership: company, branch, location, variant with tenant-safe FKs.
- Stored: on-hand, reserved, in-transit, moving-average cost,
  last-purchase cost, currency, version, last movement, updated timestamp.
- Unique: `(company_id,inventory_location_id,product_variant_id)`.
- Checks: quantity invariants, nonnegative costs, valid currency.
- Indexes: branch/variant, location/available expression, changed checkpoint.
- No external write/delete. Rebuild uses a validated shadow projection.
- Available is generated/selected, never client input.

### `inventory_movements`

- Primary key: `id`; company and primary branch ownership.
- Fields: type, reason, status, reference type/ID, reversal/transfer/reservation
  references, actor/device, version, occurrence/post/cancel/create timestamps.
- Checks: state/timestamp consistency.
- Partial unique: one successful full reversal per original.
- Indexes: company/branch occurrence cursor, type, reference, reversal.
- Posted rows are immutable and never deleted.

### `inventory_movement_lines`

- Primary key: `id`; unique `(company_id,movement_id,line_number)`.
- Fields: variant, source/destination location, positive quantity, UOM and
  conversion snapshot, base quantity, effect type, on-hand/reserved/transit
  deltas, before/after values and versions, exact cost evidence.
- Checks: positive quantity/base quantity, valid endpoints for effect type,
  nonzero effect, exact extended cost.
- Indexes: location/variant/occurrence and business reference lookup.
- No incomplete lot/serial columns in V1. Metadata is allowlisted and
  non-authoritative.

Quantity is always positive. Direction is explicit. UOM conversion uses the
variant's locked base unit, exact decimals, and quantity scale.

### `inventory_transfers` and `inventory_transfer_lines`

`inventory_transfers` is the canonical parent business document; no parallel
`inventory_transfer_details` table is created.

- Parent: company, source/destination branch/location, status, version,
  reason/note, actors, lifecycle timestamps.
- Lines: variant and requested/shipped/received/rejected exact quantities.
- Checks: different locations, one company, and
  `received + rejected <= shipped <= requested`.
- Indexes: company/status/time, source/destination branch/status, open transfer
  partial indexes.
- Shipment and receipt movements reference the transfer transition.
- No physical deletion after approval.

### `inventory_reservations` and `inventory_reservation_lines`

- Parent: company, branch, location, allowlisted `owner_type`, opaque
  `owner_id`, status, expiration, version, terminal reason/time, actor/device.
- Lines: location, variant, positive exact quantity, UOM snapshot, consumed or
  released evidence.
- Unique line: company/reservation/location/variant.
- Indexes: active expiration, owner, branch/location/status.
- Terminal rows remain. Reservations never create physical on-hand movements.

## Movement model

Canonical types remain deliberately small:

| Type | Use |
| --- | --- |
| `opening_balance` | Controlled initialization |
| `receipt` | Manual or future purchase receipt |
| `issue` | Sale, consumption, waste, or event use |
| `return` | Sale or operational return |
| `adjustment` | Count/correction with explicit reason and direction |
| `transfer_shipment` | Source to transit |
| `transfer_receipt` | Transit to destination/disposition |
| `reversal` | Full compensation of one posted movement |

Purchase, sale, waste, and event use are reason/reference classifications rather
than redundant movement types.

```text
draft -> pending -> posted
draft|pending -> cancelled
posted -> reversed: compensating movement posted
```

Posted lines are immutable. Cancellation means no stock effect occurred. A
successful full reversal posts a new compensating movement and atomically
transitions the original header from `posted` to `reversed`.

## Negative inventory

V1 denies negative stock and exposes no override. A future setting cannot become
effective until a separate decision approves precedence, authorization, offline
behavior, and audit. `inventory.override_negative` is not added now.

The posting transaction locks balances, computes results, and enforces
invariants. Database CHECK constraints provide defense in depth; an application
pre-check alone is never sufficient.

## Costing

- Variant `standard_cost` remains catalog metadata.
- Balance stores moving weighted-average and last-purchase cost in company
  currency.
- Qualifying receipts update moving average under the balance lock:

```text
new_average =
  ((old_on_hand * old_average) + (received_quantity * receipt_unit_cost))
  / (old_on_hand + received_quantity)
```

- Zero stock retains the last known average.
- Negative stock is prohibited.
- Transfers preserve source cost through transit and receipt.
- Returns use original cost when available, otherwise documented current moving
  average policy.
- FIFO remains a future compatible extension.
- Only `inventory.cost.read` exposes cost and valuation.

## Transfers

The transfer document produces paired ledger movements:

```text
requested -> approved -> shipped -> partially_received -> received
requested|approved -> cancelled
requested -> rejected
partially_received -> remainder_rejected
```

Request has no stock effect. Approval freezes quantities and endpoints. Shipment
moves source stock to transit. One or more receipts move transit to destination.
Any remainder requires explicit return, damage, or adjustment disposition.
Same-location transfer is invalid; same-branch and cross-branch operations share
one workflow. Transition command IDs prevent double shipment or receipt.

## Reservations

Reservations are approved for schema Block 3.2B and service Block 3.3D, after the
posting engine proves concurrency safety.

- Owner types initially include POS cart, event, booking, and order.
- Lines target concrete location/variant pairs.
- Active reservations increase reserved only.
- Release, expiry, and cancellation decrease reserved.
- Consumption decreases reserved and on-hand atomically.
- Every terminal command is idempotent.
- No scheduler is included initially; a later worker invokes the same service.

## Posting algorithm and concurrency

One PostgreSQL transaction:

1. Derives company/branch/device scope and authorizes.
2. Claims the operation-scoped idempotency key and compares canonical hash.
3. Locks workflow aggregate when present, then movement.
4. Validates draft/pending status, version, and unchanged lines.
5. Resolves active variants, UOM, locations, and policies.
6. Sorts balance keys by
   `(company_id,branch_id,location_id,product_variant_id)`.
7. Safely creates missing zero rows under the unique key, then locks all rows in
   that order.
8. Revalidates location flags, quantity scale, workflow limits, and stock policy.
9. Calculates exact quantity and cost deltas.
10. Inserts immutable lines and updates balance/cost projections.
11. Marks the movement posted and updates the owning workflow aggregate.
12. Inserts audit and outbox records.
13. Stores the safe idempotent response.
14. Commits.

No network call occurs inside the transaction. All writers use the same lock
order. Expected deadlock/serialization failures may receive a small bounded
retry only when the complete command is idempotent. Business conflicts are not
retried. Concurrent sale, adjustment, reservation, transfer, and first-row
creation therefore serialize on the authoritative balance rows.

## Reversals

- Only posted movements may be reversed.
- A new reversal mirrors every original quantity and cost effect.
- The original lines remain unchanged and its header becomes `reversed`.
- One full reversal is allowed per original.
- Partial reversal is outside initial scope; returns and transfer discrepancies
  use their own commands.
- Current stock policy is revalidated. An unsafe compensation returns
  reconciliation required.
- Permission, reason, actor, request/correlation IDs, audit, outbox, and
  idempotency are mandatory.

## Reconciliation

A scheduled detector folds posted lines and compares:

- ledger totals with on-hand/reserved/transit projections;
- active reservation lines with reserved quantity;
- shipped-minus-resolved transfer lines with transit quantity;
- balance version/last movement with ledger order.

Detection records metrics and an audited finding. It never repairs silently.
Repair requires `inventory.reconcile`, a reviewed finding, and a correcting
movement through the ordinary posting engine. Full rebuild uses a shadow
projection and validated controlled swap.

Monitor drift count/value/age, posting failures, idempotency conflicts,
deadlock/serialization retries, negative rejects, open-transit age,
expired-active reservations, outbox lag, and checkpoint lag.

## Multi-tenancy and security

- Company comes only from authenticated context.
- Branch/location input can narrow but never expand access.
- Empty branch access grants no inventory access; deny overrides allow.
- Devices are company/branch scoped and revoked devices cannot submit commands.
- POS uses an internal sale capability, not `inventory.adjust`.
- Unauthorized external resources follow the existing non-leaking 404 pattern.
- V1 location scope derives from branch access; E136-E138 remain unimplemented.
- Costs and cost-bearing event fields are omitted without
  `inventory.cost.read`.
- Manager approval is a separate authenticated, versioned, idempotent, audited
  command.

## Permission matrix

| Permission | Status | Purpose |
| --- | --- | --- |
| `inventory.read` | Seeded | Locations, balances, history, transfers, reservations, redacted kardex |
| `inventory.cost.read` | Seeded | Costs and valuation |
| `inventory_location.manage` | Seeded | E065-E066 |
| `inventory.adjust` | Seeded | E069, E134-E135 |
| `inventory.count` | Seeded | E070, E115-E120, E123 |
| `inventory.reverse` | Seeded | E071 |
| `inventory.update` | Documented, not seeded | E133 metadata |
| `inventory.transfer` | Documented, not seeded | E109, E112, E114 |
| `inventory.receive` | Documented, not seeded | E113 |
| `inventory.approve` | Documented, not seeded | E111 and count approval |
| `inventory.reservation.manage` | Documented, not seeded | E125-E128 |
| `inventory.reconcile` | Missing; add before service | Findings and controlled repair |
| `inventory.override_negative` | Not approved | No V1 override |

## Event catalog

Use the existing envelope, exact decimal strings, aggregate version, and
transactional outbox. General events never contain costs.

| Event | Aggregate and minimum safe data |
| --- | --- |
| `inventory_location.created` | Location/branch IDs, type, status, flags, version |
| `inventory_location.updated` | ID, safe changed fields, status, version |
| `inventory.stock.changed` | Location/variant, exact quantities, balance version, movement |
| `inventory.movement.created` | ID, type, status, reference, time, line count |
| `inventory.movement_reversed` | Reversal/original IDs, reason, resulting versions |
| `inventory.transfer.created` | Endpoints, status, line count, version |
| `inventory.transfer.approved` | Decision, status, version |
| `inventory.transfer.shipped` | Safe quantities, movement, version |
| `inventory.transfer.received` | Partial/final summary, movement, version |
| `inventory.transfer.cancelled` | Reason/disposition, status, version |
| `inventory.reservation.created` | Owner, location, expiry, lines, version |
| `inventory.reservation.confirmed` | Movement, terminal time, version |
| `inventory.reservation.released` | Terminal status/reason/time/version |
| `inventory.count.completed` | Scope, variance summary, movements, version |

Compatibility events `inventory.adjusted` and `inventory.count_applied` remain
for their published routes. Never emit both balance event names for one effect.
Consumers recover gaps through E072/E095 and checkpoints.

## Endpoint catalog

| Area | Reserved IDs | Contract rules |
| --- | --- | --- |
| Locations | E064-E066 | Read/create/update; POST idempotent, PATCH `If-Match` |
| Balances | E067 | Cursor/filter read; no mutation; cost redaction |
| Movements | E068-E069 | Stable history and idempotent adjustment |
| Count/reversal/recovery | E070-E072 | Idempotent commands and checkpoint recovery |
| Transfers | E108-E114 | Cursor/detail and versioned idempotent transitions |
| Durable counts | E115-E123 | No stock effect before application |
| Reservations | E124-E128 | Cursor/detail and idempotent terminal commands |
| Kardex/cost/policy | E129-E133 | Stable cursors, cost permission, policy ETag |
| Receipt/consumption | E134-E135 | Idempotent, reason required, strict stock policy |
| Editable movement drafts | E145-E152 | Header/detail/cancel and line CRUD; parent ETag; no posting |
| Movement submit/post | E153-E154 | Freeze draft, then atomic quantity-only posting; no preview or reversal |

E153-E154 now reserve generic submit/post; they remain proposed and
unimplemented. Typed commands preserve authorization and invariants. E136-E138
remain non-V1.
Collections use stable opaque cursors and allowlisted filters. Mutations use
strict schemas, audit, applicable idempotency and required ETag/base version.
An outbox fact is required only when the canonical event catalogue defines one;
draft edits deliberately define none.

### Editable movement draft contract

E145-E152 reserve the documentation-only contract for draft headers and lines.
They do not implement posting, reversal, transfers, reservations, balance
mutation, or E129.

- `inventory.adjust` authorizes draft header/line mutation;
  `inventory.read` authorizes detail and line reads.
- Only `opening_balance` and `adjustment` are manually authorable through the
  generic draft aggregate.
- E145 creates a header without lines. IDs, movement number, `draft` status,
  version, actors, and timestamps are server-owned.
- The E145 number is `IMV-<lowercase UUIDv7 without hyphens>` and matches
  `^IMV-[0-9a-f]{32}$`. It is derived deterministically from the generated
  movement ID and persisted with it in the same insert transaction.
- Movement numbers are opaque, immutable, non-sequential, non-reusable, and
  contain no company, branch, year, type, fiscal, accounting, or legal-folio
  semantics. Exact idempotency replay returns the stored ID/number pair.
- Number allocation uses no `MAX()+1`, sequence, folio table, or allocation
  lock. UUIDv7 generation is safe across concurrent API instances, while the
  existing `(company_id,movement_number)` unique constraint remains defense in
  depth.
- E147, E148, and E150-E152 use the parent movement strong ETag. Every successful
  mutation increments the parent version once; lines have no version.
- E145, E148, and E150 require tenant/actor/operation-scoped idempotency.
- Draft cancellation retains the aggregate and lines, writes audit evidence,
  and has no stock effect.
- Persisted line numbers are stable; deletion does not renumber survivors.
- Quantities are positive exact strings. The temporary UOM rule requires the
  variant base UOM and derives an equal base quantity.
- Draft cost input is prohibited. Cost remains posting-owned and read-redacted.
- Draft mutations write audit actions but no public outbox event.
  `inventory.movement.created` remains a posted movement fact.

The complete strict schemas, errors, replay behavior, direction rules, and
response shapes are authoritative in
[API_CONTRACTS.md](API_CONTRACTS.md#193-proposed-editable-inventory-movement-drafts--e145e152).

### Canonical generic posting contract

E153 and E154 reserve the minimal generic lifecycle without altering the draft
contract:

```text
E153: nonempty draft --inventory.adjust--> pending
E154: pending --inventory.approve--> posted
```

Both commands require tenant/actor/operation-scoped idempotency and the current
strong movement ETag. Submission performs final line validation, increments
the movement version, and writes `inventory_movement.submitted` audit evidence;
it changes no balance, cost, line, or public event. Posting increments movement
version once, sets server-owned posting actor/time, writes
`inventory_movement.posted`, and atomically stores its outbox and idempotency
outcome. Exact replay duplicates none of those effects.

The public endpoint allowlist is `opening_balance,adjustment`. Typed receipt,
consumption, sale, return, transfer, reservation, and reversal workflows remain
outside E154 but may later invoke the same internal engine inside their owning
transaction.

Posting folds positive exact `base_quantity` values into aggregate deltas keyed
by `(company_id,branch_id,inventory_location_id,product_variant_id)`. Opening
balance and adjustment-in increase destination on-hand; adjustment-out
decreases source on-hand. Reserved and in-transit do not change, and available
remains derived. Missing inbound rows are created safely under the existing
unique key; missing outbound rows and aggregate insufficiency fail the entire
transaction. No negative-stock override exists.

The canonical lock order is idempotency ownership, movement, stable lines,
sorted balance keys, existing balance rows, and safely created inbound rows.
All writers sort by company, branch, location, and variant. After complete
validation, every affected balance is updated once, then movement, audit,
outbox, and idempotency result commit together.

This slice is quantity-only. Because drafts cannot capture cost and the
physical model has no approved opening-valuation source, posting retains
existing average cost, initializes a new inbound balance with zero cost/null
currency, and leaves line valuation fields null. Weighted average, purchase
cost, transfer cost, and valuation correction require a dedicated contract.
Zero-cost opening stock means valuation is not established.

E154 emits `inventory.movement.created` once per posted movement and
`inventory.stock.changed` once per affected balance. Stock events contain exact
previous/delta/new on-hand, reserved and derived available quantities, balance
version, movement identity, correlation, and no costs. Event IDs are durable
outbox identities created once in the posting transaction; they are not API
response fields.

The posting permission is the already documented `inventory.approve`, which is
also reserved by E111 and E121-E122 but is not yet present in the technical
permission seed. Implementing E154 therefore requires seeding and assigning
that permission in a later code block. No `inventory.post` permission is
invented, and ordinary cashiers receive no implicit grant.

## Error catalog

| Code | Meaning |
| --- | --- |
| `insufficient_inventory` | Insufficient available/on-hand quantity |
| `negative_inventory_not_allowed` | V1 nonnegative invariant would fail |
| `inventory_location_not_found` | Absent or hidden location |
| `inventory_location_inactive` | Lifecycle/direction blocks command |
| `invalid_movement_state` | Illegal movement transition |
| `movement_already_posted` | Posted movement cannot mutate |
| `movement_already_reversed` | Full reversal exists |
| `transfer_not_shippable` | Transfer cannot ship |
| `transfer_not_receivable` | No receivable shipped quantity |
| `transfer_quantity_exceeded` | Quantity exceeds remainder |
| `reservation_expired` | Reservation cannot consume |
| `reservation_insufficient_inventory` | Reservation acquisition failed |
| `inventory_unit_locked` | UOM/scale has history |
| `inventory_balance_conflict` | Expected balance version is stale |
| `inventory_reconciliation_required` | State cannot be accepted safely |
| `version_conflict` | Aggregate ETag/base version mismatch |
| `idempotency_conflict` | Key reused with different canonical payload |

The earlier aliases `insufficient_stock`, `inventory_version_conflict`,
`reconciliation_required`, and `idempotency_payload_mismatch` are replaced for
inventory operations and are not active canonical errors. Unknown PostgreSQL
errors stay sanitized.

## Test matrix

| Layer | Required coverage |
| --- | --- |
| Unit | States, formulas, UOM/scale, costing, negative policy, transfers, reservations, reversals |
| PostgreSQL | Tenant FKs, CHECKs/indexes, immutability, rebuild, first-row creation, atomic rollback |
| Concurrency | Final-unit issues, reservations, transfer/adjustment race, lock ordering, retries, duplicates |
| HTTP | Permissions/scopes, 404 isolation, strict schemas, ETag, idempotency, cursors, errors, cost redaction |
| Recovery | Drift, transfer/reservation totals, event gaps, checkpoints, replay |

PostgreSQL verification uses a disposable database and requires zero failed,
skipped, and omitted tests.

## Migration and implementation plan

| Block | Scope | Exit criteria |
| --- | --- | --- |
| 3.2A | Locations, movements/lines, balances, constraints/indexes | Fresh chain; tenant, immutability, numeric, index tests |
| 3.2B | Transfers/lines and reservations/lines | State/quantity checks, tenant FKs, migration audit |
| 3.3A | Location services, balance/movement reads and drafts | E064-E068, isolation, cost redaction |
| 3.3B | Posting, adjustment, receipt, consumption, reversal | Real concurrency, rebuild, rollback, idempotency |
| 3.3C | Transfer workflow | E108-E114, partial receipt, transit, retries |
| 3.3D | Reservations and reconciliation detector | E124-E128, oversell prevention, drift detection |
| 3.3E | Immediate/durable counts | E070/E115-E123, apply-once and scope locks |
| 3.4 | Recovery, events, load, rebuild/restore runbooks | Zero skipped DB tests and measured evidence |

Migrations are additive after 0004, generated once, manually audited, and tested
from an empty PostgreSQL 17 database. Historical migrations remain untouched.

## Risks

1. Contract aliases can fragment clients unless reconciled before implementation.
2. Hot balance rows may become contention points; measure before partitioning.
3. Transit discrepancies need operational SLAs and explicit disposition.
4. Reservation expiry needs a reliable monitored worker after service proof.
5. Moving-average corrections need exact historical cost evidence.
6. Human counts need bounded locks and abandonment recovery.
7. Outbox projections may be coalesced, but ledger facts cannot be dropped.
8. Default-location bootstrap must be idempotent for existing branches.
9. Procurement absence limits expected quantity and receipt valuation.
10. Approval and separation-of-duties thresholds remain business policy.

## Open decisions

- Approval thresholds and requester/approver separation.
- Default location per future register, channel, event, and cafeteria operation.
- Reservation duration overrides and maximum offline age.
- Count lock duration and abandoned-count escalation.
- Manual receipt valuation when source cost is unavailable.
- Transit discrepancy SLA and allowed final dispositions.
- Cost-policy administration permission and effective setting.
- Reconciliation schedule, severity, retention, and operational owner.
- Load-based partition and archival thresholds.

## Explicit non-goals

- No production code, route, migration, schema, dependency, worker, producer, or
  consumer.
- No negative-stock override.
- No suppliers, purchase orders, manufacturing, recipes, forecasting,
  replenishment, lots, expiration, serials, RFID/NFC, or physical-unit identity.
- No direct balance mutation endpoint.
- No microservices, RLS, partitioning, or new authorization model.
- No partial reversals in the initial posting engine.
