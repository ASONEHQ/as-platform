# ADR-0002: UUID strategy

- Status: Accepted
- Date: 2026-07-22
- Owners: AS ONE Engineering

## Context

Core records are created across API instances and offline devices. Identifiers must be globally unique without central sequence allocation while preserving reasonable PostgreSQL index locality.

## Decision

- Use UUIDv7 for newly created entities when the approved runtime and PostgreSQL tooling support a standards-compliant implementation.
- Use a standard random UUID implementation as the fallback when UUIDv7 support is unavailable or unverified.
- Validate UUID syntax at trust boundaries and preserve client-generated UUIDs for idempotent offline commands.
- Never use UUID lexical, timestamp, or insertion order as commercial, fiscal, accounting, receipt, or user-visible order.
- Maintain separate explicit fields for sale numbers, device sequences, timestamps, and business ordering.

## Alternatives considered

- **Database sequences:** rejected as the universal key because offline clients cannot reserve them safely.
- **UUIDv4 only:** acceptable fallback but offers poorer insertion locality than UUIDv7.
- **Custom sortable IDs:** rejected because they add proprietary encoding and implementation risk.

## Consequences

UUIDv7 generation must be tested for standards compliance, collision safety, and clock behavior. Business numbers require independent uniqueness and sequencing policies.

## Validation

Test generation across devices and API instances, fallback compatibility, database indexing, and explicit ordering fields.

## References

- [Core data model](../CORE_DATA_MODEL.md)
