# ADR-0006: Tenant and branch isolation

- Status: Accepted
- Date: 2026-07-22
- Owners: AS ONE Engineering

## Context

AS ONE serves independent companies and branches. A single missing filter or mismatched foreign key must not expose or connect data across tenants.

## Decision

- Derive `company_id` and permitted `branch_id` values exclusively from authenticated server-side user, membership, permission, and device context.
- A client may request a narrower authorized branch but never determine or expand its own scope.
- Require `company_id` on tenant-owned rows and both `company_id` and `branch_id` on branch-owned rows.
- Use composite foreign keys and tenant-prefixed unique constraints to prevent cross-company and cross-branch references.
- Require application authorization and scoped repository interfaces on every protected operation.
- Keep PostgreSQL Row-Level Security as a future defense-in-depth option, not an MVP requirement.
- If RLS is later adopted, application authorization remains mandatory and connection-pool context must be proven safe.
- Scope outbox events, WebSocket delivery, audit access, idempotency, and offline commands by company and branch.

## Alternatives considered

- **Client-provided tenant filters:** rejected because they are untrusted authorization input.
- **Application filters without database constraints:** rejected because relationship mistakes remain possible.
- **RLS as the only control:** rejected because authorization includes actions and business context beyond row visibility.
- **Database per tenant for MVP:** rejected because it adds operational complexity not currently justified.

## Consequences

Composite keys add schema and query verbosity but provide necessary defense. Cross-tenant negative tests are mandatory for repositories, APIs, jobs, events, exports, and synchronization.

## Validation

Attempt cross-company and cross-branch reads, writes, references, events, exports, and replay through every protected boundary.

## References

- [Core data model](../CORE_DATA_MODEL.md)
- [Security standard](../SECURITY.md)
