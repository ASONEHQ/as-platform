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
- Transfer V1 is quantity-only. Source-cost preservation, transfer valuation,
  currency handling, and accounting effects require a later approved contract.
- Returns use original cost when available, otherwise documented current moving
  average policy.
- FIFO remains a future compatible extension.
- Only `inventory.cost.read` exposes cost and valuation.

## Transfers

The transfer document produces paired ledger movements. The existing physical
and endpoint contracts prevail: there is no `draft` or `submitted` state and no
public update/submit route.

```text
create -> requested -> approved -> shipped -> received
requested|approved -> cancelled
requested -> rejected
```

E109 creates a complete, nonempty request. Request and approval have no stock
effect; approval freezes quantities and endpoints. E112 ships every approved
line once, removes source on-hand, and increases `quantity_in_transit` at the
validated active transit location selected in the destination branch.
E113 receives every
shipped line once, decreases that transit projection, and increases destination
on-hand. The transfer owns distinct posted `transfer_shipment` and
`transfer_receipt` movements linked by
`reference_type=inventory_transfer`, `reference_id`, and the header movement
IDs.

V1 produces neither `partially_received` nor `remainder_rejected`, although the
physical schema preserves those states for a future approved discrepancy
workflow. There are no split deliveries, over-receipts, substitutions, or
line-level rejection in V1. `received`, `rejected`, and `cancelled` are
terminal. A shipped transfer cannot be cancelled or edited; later correction
requires a future explicit compensating transfer workflow.

Same-location transfer is invalid; same-branch and cross-branch operations
share one workflow. Creation, approval, shipment, and pre-shipment cancellation
require authorization for both endpoint branches; receipt requires destination
access. Every mutation claims idempotency, locks the aggregate, validates its
strong ETag where applicable, increments version exactly once, and commits
movement, balances, transfer, audit, outbox, and stored response atomically.
Balance locks follow company, branch, location, and variant order.

## Reservations

Reservations were previously planned for service Block 3.3D. Blocks 3.3D.1 and
3.3D.2 were instead published as transfer contract reconciliation and transfer
engine implementation. That history is not rewritten. Block 3.3E now freezes
the E124-E128 reservation contract, and future Block 3.3F implements it.

- The initial state is `active`; `confirmed`, `released`, `expired`, and
  `cancelled` are mutually exclusive terminal states.
- Owner types are `pos_cart`, `event`, `booking`, and `order`. `owner_id` is the
  opaque identifier in that owning domain; it is not a user or device grant.
- A reservation belongs to one company and branch but may contain multiple
  concrete location/variant lines within that branch.
- Creation increases `quantity_reserved`; it changes neither on-hand nor
  in-transit quantity.
- Release, expiry, and cancellation decrease reserved only.
- Full confirmation decreases reserved and on-hand atomically and creates a
  posted `issue` movement with `reference_type=inventory_reservation` and the
  reservation ID as `reference_id`. No partial confirmation is approved.
- E125, E127, and E128 are idempotent. E127 and E128 also require the current
  strong ETag and increment the aggregate version exactly once.
- `expires_at` is optional UTC `timestamptz`. An active reservation with
  `expires_at <= transaction_timestamp()` cannot confirm. A command that first
  discovers expiry may atomically expire it under that authenticated actor.
- No scheduler is included initially. A future worker must invoke the same
  command service and requires an approved technical-actor representation.
- The current tables need no reservation migration for V1. Terminal reasons
  remain bounded command/audit evidence, and the confirmation movement is
  recovered through its typed reference; adding denormalized reason or movement
  columns is not authorized by this contract.

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
- A new generic reversal mirrors every original quantity effect. Cost reversal
  remains deferred until a valuation-reconciliation contract is approved.
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
| `inventory.transfer` | Documented, not seeded | E109, E112, E114; both endpoint branches |
| `inventory.receive` | Documented, not seeded | E113 |
| `inventory.approve` | Seeded | E111 approve/reject, E121-E122, and E154 |
| `inventory.reservation.manage` | Seeded | E125-E128 |
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
| `inventory.transfer.rejected` | Safe rejection reason, terminal status, version |
| `inventory.transfer.shipped` | Safe quantities, movement, version |
| `inventory.transfer.received` | Full received summary, movement, version |
| `inventory.transfer.cancelled` | Pre-shipment reason, status, version |
| `inventory.reservation.created` | Owner, location IDs/count, expiry, lines, version |
| `inventory.reservation.confirmed` | Movement, terminal time, version |
| `inventory.reservation.released` | Released status/reason/time/version |
| `inventory.reservation.expired` | Expired status/reason/time/version |
| `inventory.reservation.cancelled` | Cancelled status/reason/time/version |
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

The posting permission is the seeded `inventory.approve`, which is also used by
E111 and E121-E122. No `inventory.post` permission is invented, and ordinary
cashiers receive no implicit grant.

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

## Immediate and durable count decision

### Reconciliation outcome

E070 and E115-E123 intentionally share `/inventory/counts` but are different
commands. E070 is the existing immediate one-variant count and has no durable
count aggregate. E116 creates a durable count session. Their strict schemas,
headers, response shapes, and lifecycle distinguish them; no alias or endpoint
renumbering is introduced.

E070 requires `inventory.count`, `Idempotency-Key`, and the target balance
strong ETag. It locks one balance and calculates an exact signed delta from the
absolute counted quantity. A nonzero result reuses the Posting Engine to create
and post one `adjustment` movement with `inventory_count_immediate` reference.
A zero result creates no empty ledger fact: audit, outbox, and the idempotency
result record that the count was accepted. The command never consumes reserved
stock, never leaves on hand below reserved, and rolls back as one unit.

### Durable V1 scope and lifecycle

A durable count owns exactly one active `inventory_location`. Its scope is
immutable after creation and is one of:

- `all_inventory_variants`: every active inventory-tracked variant with a
  balance at the location when E118 starts, including zero balances;
- `explicit_variants`: a nonempty unique set selected at E116 and validated as
  active, inventory-tracked variants of the company.

Services, virtual kits, non-inventory variants, and retired variants are
excluded. A variant physically found but absent from the frozen scope cannot be
added through E119; the count must be cancelled and recreated with explicit
scope. New catalog variants or balances created after start do not enter the
snapshot. V1 deliberately rejects ambiguous dynamic and category scopes.

```text
draft -> counting -> submitted -> approved -> applied
draft|counting|submitted -> cancelled
```

`draft` and `counting` are editable only through their defined commands;
`submitted` is approvable; `approved` is applicable; `applied` and `cancelled`
are terminal. `rejected` and reopening are outside V1. Approval by the counter
is allowed when the actor independently holds `inventory.approve`.

### Snapshot and movement policy

E118 atomically acquires the domain lock, sets `baseline_at`, and materializes
one line per scoped variant. Each line stores exact `expected_quantity`, the
baseline balance version, nullable baseline last movement ID, UOM code, and
nullable `counted_quantity`. `difference_quantity` is derived as counted minus
expected and is not persisted. Explicit zero differs from an uncounted null.
Header line and discrepancy counts are derived by queries and are not stored.

Normal inventory operation continues while humans count; no PostgreSQL
transaction or row lock remains open. E121 and E122 compare every baseline
version and last movement identity with the current balance. Any relevant drift
returns `inventory_reconciliation_required`; V1 has no silent rebase. A new
count is required after the conflicting operation. This favors correctness over
an implicit historical adjustment whose physical meaning cannot be proven.

### Durable domain lock

The minimal domain lock is represented by the active count header, not Redis,
advisory locks, or a third table. The lock key is `(company_id,
inventory_location_id)` and a partial unique index covers statuses `counting`,
`submitted`, and `approved`. `lock_acquired_at` and `lock_expires_at` are
persisted. Any successful E119-E121 command renews expiry within a bounded
server policy; clients cannot choose it.

An expired lock never authorizes another count implicitly. A subsequent E118
may take over only by atomically cancelling the abandoned, non-applied owner
with a system audit fact, then acquiring the unique scope. No worker is required
for correctness. Expiry or ownership failure returns `count_lock_expired`;
collision with a valid owner returns `inventory_count_in_progress`. Apply locks
the count and all affected balances in canonical `(location_id,variant_id)`
order, so concurrent approval/application cannot create duplicate effects.

### Physical model for 3.3G.2

`inventory_counts` will persist:

- UUIDv7 `id`; server-owned immutable `count_number` equal to `CNT-` plus the
  lowercase UUID without hyphens, matching `^CNT-[0-9a-f]{32}$`;
- tenant-safe `company_id`, `branch_id`, and `inventory_location_id`;
- `status`, `scope_type`, immutable JSON scope, reason code, bounded note, and
  object metadata;
- nullable baseline, lock, lifecycle timestamps and corresponding membership
  actors for start, submit, approve, apply, and cancel;
- nullable tenant-safe `application_movement_id`;
- integer `version >= 1`, `created_at`, and `updated_at`.

It will not persist derived line/discrepancy counts. Lifecycle CHECKs require
timestamps/actors only for reached states, require an application movement only
for `applied`, and prohibit it otherwise.

`inventory_count_lines` will persist UUIDv7 `id`, tenant-safe count and variant
references, UOM code, exact `expected_quantity`, nullable exact
`counted_quantity`, baseline balance version, nullable baseline last movement
ID, first/last-counted timestamps, last counter membership, integer version,
object metadata, and timestamps. `(company_id,count_id,product_variant_id)` is
unique. Expected quantity and baseline evidence are immutable after start;
counted quantity may be replaced while counting. Difference is derived.

### Submit, approve, apply, and cancel

E120 refuses null counted quantities with `count_has_incomplete_lines`. E121
rechecks drift and exposes exact discrepancy summaries before changing status.
E122 serializes on the count row, validates a live domain lock and unchanged
baseline, locks balances deterministically, and derives deltas against the
unchanged expected quantities. Zero-delta lines produce no movement line.

One or more nonzero deltas produce exactly one posted `adjustment` movement
referenced to the count, with positive movement-line quantities and direction
encoded by source/destination location as required by the Posting Engine.
Application may not leave on hand negative or below reserved. Count state,
movement/lines, balances, application movement link, audit, outbox, stock
events, idempotency result, and lock release commit together. A wholly
zero-difference application creates no movement but still atomically marks the
count applied. Partial application and cost mutation are prohibited.

E123 allows cancellation only from draft, counting, or submitted. It records a
bounded reason, releases any lock, increments the version once, and creates no
movement. Approved counts require application or a future privileged recovery
contract.

### Permissions, concurrency, errors, and evidence

E115/E117 use `inventory.read`; E116/E118-E120/E123 use `inventory.count`;
E121/E122 use the already seeded `inventory.approve`. No new permission is
needed and `inventory.reconcile` remains reserved for the separate 3.3I
detector. Every mutation is tenant/actor/operation-scoped idempotent except the
E119 replacement, whose parent strong ETag provides command concurrency.

Canonical count errors are `resource_not_found`,
`inventory_count_in_progress`, `inventory_reconciliation_required`,
`inventory_balance_conflict`, `insufficient_inventory`,
`invalid_movement_line`, `version_conflict`, `idempotency_conflict`,
`permission_denied`, and `validation_error`. 3.3H may add
`count_not_editable`, `count_has_incomplete_lines`, `count_not_approvable`,
`count_not_applicable`, `count_lock_expired`, and `count_already_applied` only
when implementing their frozen mappings.

Audit actions are `inventory_count.created`, `inventory_count.started`,
`inventory_count.line_recorded`, `inventory_count.submitted`,
`inventory_count.approved`, `inventory_count.applied`, and
`inventory_count.cancelled`. Safe evidence includes count/company/branch/
location IDs, status, actor, bounded discrepancy summary, movement ID,
request/correlation IDs, and version; notes, idempotency keys, request hashes,
and costs are excluded from public events.

Durable commands emit `inventory.count.created`, `inventory.count.started`,
`inventory.count.submitted`, `inventory.count.approved`,
`inventory.count.completed`, or `inventory.count.cancelled` after commit.
E122 additionally emits `inventory.movement.created` when a movement exists and
one `inventory.stock.changed` per changed balance. The compatibility event
`inventory.count_applied` is exclusive to E070; E122 emits only
`inventory.count.completed`, preventing duplicate semantic count events.

### Delivery split

Block 3.3G.1 is this contract reconciliation and changes documentation only.
Block 3.3G.2 will add exactly `inventory_counts`, `inventory_count_lines`, their
schema exports, constraints/indexes, and migration
`0007_inventory_counts_foundation`, followed by fresh-chain and PostgreSQL
concurrency verification. Block 3.3H will implement E115-E123. No schema or
migration is created while reviewing 3.3G.1.

## Inventory reconciliation detector contract

Block 3.3I defines detection only. It does not mutate a balance, create a
movement, repair a workflow, rebuild a projection, publish a realtime event,
or reserve an HTTP endpoint. The detector compares a bounded, tenant-scoped
snapshot with independently reconstructed expectations and reports safe
findings. PostgreSQL remains the source of truth.

### Authority and reconstructible projections

| Concern | Authority | Reconstructed expectation |
| --- | --- | --- |
| On hand | Posted movement headers and immutable movement lines | Exact signed fold of `base_quantity` by company, branch, location, and variant |
| Reserved | Nonterminal reservation lines | `reserved_quantity - consumed_quantity - released_quantity` for `active` reservations |
| In transit | Shipped transfer workflow plus its posted shipment/receipt movements | Shipped base quantity not yet received, represented in the approved destination transit location |
| Balance version | Successful projection writes | Monotonic evidence used for concurrency; it is not a substitute for ledger reconstruction |
| Last movement | Latest posted movement with an effect on the balance | Canonically ordered by `posted_at`, then movement UUID and line order |
| Counts | Count workflow and referenced adjustment movement | Applied discrepancies must be explained by at most one linked posted adjustment |

The on-hand fold includes every posted effect. An original movement later marked
`reversed` remains part of history; its distinct posted compensating reversal
neutralizes it. Excluding the original would double-reverse the result. Source
locations contribute negative `base_quantity`, destination locations contribute
positive `base_quantity`, and all arithmetic uses exact `numeric(19,6)` values.
Invalid or ambiguous lines are findings and are not silently omitted from a
claimed clean result.

Reserved reconstruction includes only `active` reservations. Confirmed,
released, expired, and cancelled reservations contribute zero. Each active line
contributes its exact remaining quantity. Negative remainder, consumed or
released quantity above reserved, terminal remainder, wrong branch/location,
or incompatible owner/lifecycle evidence is a workflow-integrity finding.

In-transit reconstruction supports the implemented full-shipment V1 workflow.
`shipped` contributes the complete shipped quantity at the validated transit
location in the destination branch. `received`, `requested`, `approved`,
`rejected`, and `cancelled` contribute zero. Physical future states for partial
receipt are not interpreted until their application contract exists. Shipment
or receipt quantities, movements, branches, locations, and balance evidence must
agree; over-receipt or negative transit is critical.

`last_movement_id` identifies the latest posted movement that actually changed
the balance. Ordering is `(posted_at, movement_id, line_number)`; physical row
order is irrelevant. The detector reports a missing reference, cross-tenant or
cross-branch reference, a movement with no effect on that key, a stale
reference, NULL despite activity, or a value despite no activity. Detection
never rewrites this field.

### V1 detection matrix

| Class | Finding | Demonstrable with current schema | Default severity |
| --- | --- | --- | --- |
| Projection | `balance_on_hand_drift` | Yes: ledger fold differs from balance | critical |
| Projection | `balance_reserved_drift` | Yes: active reservation remainder differs | critical |
| Projection | `balance_in_transit_drift` | Yes for implemented full-shipment V1 | critical |
| Projection | `last_movement_mismatch` | Yes from ordered posted effects | warning |
| Projection | `missing_balance` | Yes when ledger/workflow activity has no balance | critical |
| Projection | `orphan_balance` | Yes when all quantities are zero and no ledger/workflow reference exists | info |
| Ledger | `invalid_posted_movement` | Yes for physical direction, quantity, state, tenant and relationship invariants | critical |
| Workflow | `invalid_reversal_relationship` | Yes for header links, type, state and uniqueness; line pairing is positional because no line FK exists | critical |
| Workflow | `transfer_movement_mismatch` | Yes for implemented shipment/receipt lifecycle | critical |
| Workflow | `reservation_movement_mismatch` | Yes for confirmed issue and active/terminal reserved evidence | critical |
| Workflow | `count_application_mismatch` | Yes for applied state, discrepancy, reference, movement type and uniqueness | critical |
| Evidence | `missing_outbox_event` | Conditional; reliable only while the relevant retention window is guaranteed | warning |
| Evidence | `missing_audit_record` | Conditional; reliable only while the relevant retention window is guaranteed | warning |
| Unknown | `unsupported_or_unknown` | Used when the detector cannot prove a canonical interpretation | warning |

The detector can also report incompatible terminal timestamps/actors, duplicate
typed workflow movements, impossible quantity totals, wrong company/branch
relationships, and an applied count linked to a non-count adjustment. Database
constraints prevent many new invalid rows but do not prove historical
projection equivalence.

The current schema cannot prove why a row was absent before retention began,
whether an audit/outbox record was archived legitimately, historical publisher
delivery, business intent beyond stored reason/reference fields, partial future
transfer semantics, or cost/accounting correctness. Those cases must not be
presented as confirmed drift.

### Workflow invariants

- A reversed original has one `reversed_by_movement_id`; the compensating posted
  reversal points back through `reversal_of_movement_id`, uses the correct type,
  and is unique. Both remain in the ledger fold.
- A shipped transfer has its posted shipment movement with matching transfer,
  company, endpoint branches, locations and exact line quantities. A received
  transfer additionally has exactly one compatible posted receipt movement and
  no remaining V1 transit quantity.
- A confirmed reservation has exactly one posted issue movement identified by
  `reference_type=inventory_reservation` and its ID. Active reservations have no
  confirmation issue; terminal reservations retain no reserved remainder.
- An applied count with nonzero frozen discrepancies has exactly one posted
  `adjustment` referenced by `inventory_count` and stored in
  `application_movement_id`. A zero-difference applied count may have no
  movement. No count may apply twice.

### Persistent finding model

Enterprise operation requires persistent findings rather than an ephemeral-only
report. Persistence enables acknowledgement, deduplication, remediation review,
history and SLA measurement. Block 3.3I approves the logical model only; a
future physical block must add it through an additive migration.

| Field | Contract |
| --- | --- |
| Identity | UUIDv7 `finding_id`; immutable normalized fingerprint |
| Scope | Required `company_id`; optional branch, location and variant IDs; aggregate type and ID |
| Classification | Stable `finding_type`, `severity`, `status`, and explicit `detector_version` |
| Time | `first_detected_at`, `last_detected_at`, `detected_at` snapshot evidence, optional acknowledged/resolved/dismissed timestamps |
| Actors | Optional acknowledged/resolved/dismissed actor; never derived from client tenant input |
| Evidence | Bounded expected/actual summaries, safe evidence and sanitized object metadata |
| Tracking | `occurrence_count`, correlation ID, snapshot/watermark, optimistic version |

Finding states are `open`, `acknowledged`, `resolved`, and `dismissed`.
Detection creates `open`. Acknowledgement accepts operational ownership but does
not correct data. Resolution requires a later scan proving equivalence or an
approved repair/rebuild result. Dismissal requires a bounded reason and
`inventory.reconcile`; it is not data repair. Recurrence of the same active
identity updates `last_detected_at` and occurrence count. A resolved or dismissed
identity that reappears becomes `open` as a new revision while preserving its
history.

The normalized identity material is:

```text
company_id
+ finding_type
+ aggregate_type
+ aggregate_id
+ normalized branch/location/variant scope
+ detector_version
```

Its SHA-256 fingerprint, not free text, provides deduplication. Evidence changes
update the current revision without changing identity. Findings absent from a
complete compatible scan may be auto-resolved only when the scan covered the
same scope, detector version and watermark semantics; partial scans never resolve
findings outside their proven coverage.

Canonical severities are `info`, `warning`, and `critical`. Critical projection,
corrupt-ledger, double-application, reserved/oversell and transit findings may
cause affected commands to return `inventory_reconciliation_required` after an
implementation block defines the exact guard scope. Warning alone does not
block. Info never blocks.

### Scan consistency, scope and concurrency

Every scan requires one authenticated company. Optional narrower filters are
branch, location, product variant, or one aggregate. There is no cross-tenant
scan and no client-selected expansion of branch access. Company-wide work is
chunked; it is not one long transaction.

V1 scans use short `REPEATABLE READ` read-only transactions per location or
bounded chunk. Each chunk records `snapshot_at`, detector version and a stable
watermark based on committed occurrence/posting time plus UUID tie-breaker.
Operations committed after the watermark belong to a later scan. The detector
does not take balance write locks or hold database transactions across network
responses.

Posting, receipt, confirmation and count application may continue while a scan
runs. Snapshot isolation prevents mixing pre- and post-command state inside one
chunk. Two detectors may scan the same scope; fingerprint uniqueness and an
atomic upsert deduplicate findings. A global advisory lock is not correctness
authority. Future repair must revalidate the finding and current versions under
its own transaction rather than trust stale scan evidence.

### Authorization, errors and evidence boundaries

`inventory.reconcile` does not currently exist. A future physical/endpoint block
must seed it explicitly and assign it only to controlled operational roles.
Manual scans, full finding detail, acknowledgement, dismissal and every repair
require it. Sanitized aggregate indicators may later be shown under
`inventory.read`, but ordinary POS operators receive no new authority.

No endpoint IDs are reserved because no approved range follows E154. Endpoint
reservation is a separate contract block. Likely future capabilities are scan,
finding list/detail, acknowledge/dismiss, repair preview/application and
projection rebuild, but none is an API contract yet.

Existing applicable errors remain `inventory_reconciliation_required`,
`inventory_balance_conflict`, `resource_not_found`, `permission_denied`,
`validation_error`, `version_conflict`, and `idempotency_conflict`. Candidate
scan/finding/repair errors remain unfrozen until their endpoint block. No error
is added to `@asone/errors` here.

Audit/outbox absence checks are optional until retention and archival policy is
accepted. Pending unpublished outbox rows are not missing. Archived evidence is
not missing. A scan execution may later audit safe start/completion summaries;
finding acknowledgement/dismissal and repair are auditable commands. Detection
never emits `inventory.stock.changed`. Reconciliation realtime events remain
unapproved until the persistent physical and endpoint contracts exist, so
`REALTIME_EVENTS.md` is unchanged.

### Repair, rebuild and delivery boundaries

Detection identifies and classifies only. Repair is a later approved command
that may create a compensating movement, rebuild a projection component,
restore `last_movement_id`, or re-emit a demonstrably missing outbox fact. Rebuild
folds authoritative sources into a validated shadow result before controlled
replacement. Neither may edit/delete posted movements, rewrite history, mutate
balances silently, or bypass audit, idempotency and authorization.

The delivery split is:

| Block | Scope |
| --- | --- |
| 3.3I.1 | This detector contract and logical persistent finding model |
| 3.3I.2 | Findings physical foundation, permission seed and additive migration |
| 3.3I.3 | Read-only detector implementation, chunking, deduplication and PostgreSQL evidence |
| 3.3I.4 | Repair/rebuild contract, approvals and endpoint reservation; no implementation implied |
| 3.4 | Runbooks, scheduling/workers, monitoring, SLAs, load/partitioning, backup/restore and disaster recovery |

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
| 3.3C | Previously planned transfer workflow | Superseded by the published 3.3D.1/3.3D.2 sequence |
| 3.3D.1 | Transfer contract reconciliation | Implemented under commit history; E108-E114 frozen |
| 3.3D.2 | Transfer engine implementation | Implemented under commit history; full V1 shipment/receipt |
| 3.3E | Reservation contract reconciliation | E124-E128, ownership, expiry, multi-location payloads, locking |
| 3.3F | Reservation engine implementation | E124-E128, oversell prevention, PostgreSQL concurrency evidence |
| 3.3G.1 | Count contract reconciliation | E070/E115-E123, scope, snapshots, expiring locks, migration design |
| 3.3G.2 | Future count physical foundation | Two count tables, migration 0007, fresh-chain and concurrency evidence |
| 3.3H | Future durable count engine | E115-E123, apply-once and scope-lock behavior |
| 3.3I.1 | Reconciliation detector contract | Ledger/projection algorithms, persistent finding model and execution boundaries |
| 3.3I.2 | Future findings physical foundation | Finding table, indexes, permission seed and additive migration |
| 3.3I.3 | Future detector implementation | Read-only chunked scans, deduplication and PostgreSQL evidence |
| 3.3I.4 | Future repair/rebuild contract | Approval, endpoint reservation and recovery boundaries |
| 3.4 | Recovery, events, load, rebuild/restore runbooks | Zero skipped DB tests and measured evidence |

Migrations are additive after 0004, generated once, manually audited, and tested
from an empty PostgreSQL 17 database. Historical migrations remain untouched.

## E071 reversal reconciliation

E071 is the only generic reversal contract and retains
`POST /inventory/movements/{movement_id}/reversals`. It is an immediate,
idempotent, full quantity compensation under `inventory.reverse`, not an
editable draft or a generic status mutation. The original must be a posted
manual `opening_balance` or `adjustment`; workflow-owned movement types and
reversals are ineligible.

The compensating movement is created directly as `posted` with
`movement_type=reversal`, positive quantities, inverted source/destination,
and `reversal_of_movement_id`. In the same transaction the original becomes
`reversed`, increments once, and stores `reversed_by_movement_id`,
`reversed_at`, and `reversed_by`. The physical foreign keys and partial unique
index already support both links and exactly one full reversal, so no schema
change or migration is required.

The command consumes the original strong ETag and a strict body containing
required `reason_code` and optional bounded `note`. The server owns all inverse
lines and effects. Exact replay returns the stored result and original ETag;
different keys racing are serialized by the original row and relationship
uniqueness. The balance phase aggregates and locks in E154 order. Outbound
inverse effects require sufficient unreserved availability; inbound inverse
effects may create a missing balance safely.

Reversal remains quantity-only and cannot modify cost. It records
`inventory_movement.reversal_created` and `inventory_movement.reversed`
audits, then emits `inventory.movement.created`,
`inventory.movement_reversed`, and the affected
`inventory.stock.changed` facts atomically. E064–E072 and E145–E154 retain
their IDs and existing non-reversal behavior; E129 remains proposed.

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
- Reservation duration overrides, maximum offline age, and approved technical
  actor for a future expiration worker.
- Count lock duration and abandoned-count escalation.
- Manual receipt valuation when source cost is unavailable.
- Transit discrepancy SLA and allowed final dispositions.
- Cost-policy administration permission and effective setting.
- Finding retention, operational ownership, repair approvals and scheduling
  remain open after the 3.3I.1 logical detector contract. Physical persistence,
  implementation and repair remain separate blocks.
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
