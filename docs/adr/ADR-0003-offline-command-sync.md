# ADR-0003: Offline command synchronization

- Status: Accepted
- Date: 2026-07-22
- Owners: AS ONE Engineering

## Context

POS terminals must continue approved operations during temporary connectivity loss without treating local browser state as the source of truth or duplicating financial effects after retries.

## Decision

- Synchronize domain commands, not complete mutable tables.
- Every offline command carries a client-generated UUID, monotonic per-device sequence, idempotency key, payload hash, aggregate identity, and known base version when applicable.
- Persist pending commands in approved durable local storage and retain them until a terminal server outcome is recorded.
- Derive company and branch scope from the authenticated device/session; client ownership fields cannot grant access.
- Never apply last-write-wins to money, inventory, payments, refunds, cash, or completed sales.
- Return exactly one outcome category: `accepted`, `duplicate`, `rejected`, or `reconciliation_required`.
- Advance durable checkpoints only through recorded server outcomes; clients recover missed state through checkpointed API reads.

## Alternatives considered

- **Full-table replication:** rejected because ownership, conflicts, and financial invariants cannot be safely inferred from object timestamps.
- **Last-write-wins:** rejected for transactional domains because it can erase committed facts.
- **Memory-only queue:** rejected because reload or device failure loses commands.

## Consequences

Every offline-capable command needs explicit authorization, version, idempotency, conflict, and reconciliation semantics. Maximum offline duration, batch limits, and sequence-reset recovery remain open operational decisions.

## Validation

Test lost responses, duplicate delivery, reordered batches, stale versions, device revocation, partial failure, and cross-tenant rejection.

## References

- [Core data model](../CORE_DATA_MODEL.md)
- [ADR-0005](ADR-0005-idempotency-and-outbox.md)
