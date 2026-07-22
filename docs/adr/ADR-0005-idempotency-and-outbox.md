# ADR-0005: Idempotency and transactional outbox

- Status: Accepted
- Date: 2026-07-22
- Owners: AS ONE Engineering

## Context

Network retries, offline replay, provider callbacks, and horizontal API scaling can repeat commands or lose event delivery after a successful commit.

## Decision

- Every financial, cash, refund, payment, and inventory operation requires a tenant-scoped idempotency key.
- Bind each key to operation scope and request hash. Reuse with different content is a conflict; reuse with identical content returns the established outcome.
- Commit the business effect, authoritative audit evidence, idempotency outcome, and required outbox events in the same PostgreSQL transaction.
- Publish events asynchronously from `outbox_events` with bounded retry and idempotent consumers.
- PostgreSQL is the durable truth. Redis may coordinate caching or fan-out but cannot establish business completion or event durability.
- WebSocket delivery is not complete or durable. Clients recover gaps through APIs and checkpoints.

## Alternatives considered

- **In-memory/Redis-only deduplication:** rejected because expiry, eviction, or outage can repeat financial effects.
- **Publish directly before or after commit:** rejected because it creates ghost events or committed changes with no event.
- **WebSocket as event history:** rejected because connections are transient.

## Consequences

Idempotency records require retention beyond retry and offline replay windows. Outbox backlog, attempts, latency, and dead-letter operational handling require monitoring.

## Validation

Test concurrent duplicates, lost responses, transaction rollback, publisher crash, duplicate publication, consumer replay, and checkpoint recovery.

## References

- [Core data model](../CORE_DATA_MODEL.md)
- [ADR-0003](ADR-0003-offline-command-sync.md)
