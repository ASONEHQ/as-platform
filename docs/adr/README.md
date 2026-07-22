# Architecture Decision Records

## Purpose

An Architecture Decision Record (ADR) is a concise, durable account of a significant technical decision, its context, considered alternatives, and consequences. ADRs preserve the reasoning that code and configuration alone cannot explain.

Every future decision that materially affects architecture, module boundaries, data ownership, tenant isolation, offline synchronization, security, public contracts, infrastructure, or adoption or removal of a major technology must be stored in this directory.

## Accepted decisions

| ADR | Decision |
| --- | --- |
| [ADR-0001](ADR-0001-money-and-rounding.md) | Exact money representation and MXN rounding baseline |
| [ADR-0002](ADR-0002-uuid-strategy.md) | UUIDv7 preference with standard UUID fallback |
| [ADR-0003](ADR-0003-offline-command-sync.md) | Command-based offline synchronization and outcomes |
| [ADR-0004](ADR-0004-inventory-ledger.md) | Immutable inventory ledger and rebuildable balances |
| [ADR-0005](ADR-0005-idempotency-and-outbox.md) | Transactional idempotency, audit, and outbox |
| [ADR-0006](ADR-0006-tenant-isolation.md) | Authenticated tenant scope and composite isolation |

## When to create an ADR

Create an ADR before implementation when a decision is costly to reverse, changes a platform-wide convention, introduces a dependency or service, affects security or reliability, or resolves an important trade-off. Routine implementation details that already follow an accepted standard do not need an ADR.

## Naming convention

Use a four-digit sequential number and a short lowercase kebab-case title:

```text
0001-use-fastify.md
0002-use-postgresql.md
0003-use-flutter.md
0004-use-cloudflare.md
```

Numbers are never reused, including for rejected or superseded decisions.

## Lifecycle

| Status | Meaning |
| --- | --- |
| Proposed | Under review and not yet authoritative |
| Accepted | Approved and in force |
| Rejected | Considered but not approved |
| Deprecated | Retained for history but no longer recommended |
| Superseded | Replaced by a newer ADR |

Accepted ADRs are immutable historical records apart from status and links. To change a decision, create a new ADR, mark the old record as superseded, and link both records.

## ADR template

```markdown
# ADR-NNNN: Decision title

- Status: Proposed
- Date: YYYY-MM-DD
- Owners: team or decision owners
- Supersedes: ADR-NNNN (optional)

## Context

What problem, constraints, and forces require a decision?

## Decision

What is being decided and where does it apply?

## Alternatives considered

What credible alternatives were evaluated and why were they not selected?

## Consequences

What positive, negative, operational, security, cost, and migration effects follow?

## Validation

How will the decision be tested or measured?

## References

Links to relevant documentation, issues, or evidence.
```

## Review process

1. Create the ADR as `Proposed` in the same change that needs the decision.
2. Identify affected modules, owners, security boundaries, operational impact, and migration needs.
3. Review alternatives using current evidence, not preference alone.
4. Obtain the required technical and product approval.
5. Set the final status and merge the ADR before or with implementation.
6. Update related master documentation.

## Additional ADR candidates

- Use a modular monolith as the initial architecture.
- Use Fastify for the HTTP API.
- Use PostgreSQL as the transactional source of truth.
- Use Flutter Web for product applications.
- Use Cloudflare for edge services and R2 object storage.
- Define authentication and rotating refresh-token sessions.
