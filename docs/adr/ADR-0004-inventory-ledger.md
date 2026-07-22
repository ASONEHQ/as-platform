# ADR-0004: Inventory ledger

- Status: Accepted
- Date: 2026-07-22
- Owners: AS ONE Engineering

## Context

The prototype mutates stock values directly. Production inventory must explain every change, reconcile offline commands, and remain correct under concurrent terminals.

## Decision

- `inventory_movements` is the authoritative, immutable inventory ledger.
- `inventory_balances` is a rebuildable projection maintained transactionally from accepted movements.
- Every adjustment requires a movement type, exact quantity, actor, reason, time, company, branch, location, product, and correlation context.
- Corrections use compensating movements; existing ledger entries are never edited or deleted.
- The initial policy prohibits negative inventory.
- A future explicit company or branch setting may permit negative inventory only after defining precedence, authorization, reporting, offline conflict, and audit behavior in a new decision.
- Offline inventory commands require an idempotency key and expected/base balance version.

## Alternatives considered

- **Editable balance only:** rejected because it loses causality and cannot be reliably audited or rebuilt.
- **Allow negative stock by default:** rejected because it hides operational and synchronization errors.
- **Periodic snapshots as authority:** rejected; snapshots may optimize reads but do not replace movements.

## Consequences

All sales, refunds, counts, adjustments, and future transfers must create movements. Projection rebuild and reconciliation tooling are required before production.

## Validation

Prove that balances equal the ordered fold of committed movements; test concurrency, reversals, duplicate commands, and negative-stock rejection.

## References

- [Core data model](../CORE_DATA_MODEL.md)
