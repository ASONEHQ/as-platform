# Architecture Decision Records

This directory contains durable records of significant AS ONE architecture decisions.

## When an ADR is required

Create an ADR for choices that affect module boundaries, data ownership, tenant isolation, offline synchronization, security architecture, public contracts, infrastructure, or the adoption/removal of a major technology.

## Naming

Use sequential names:

```text
0001-modular-monolith.md
0002-tenant-isolation-strategy.md
```

## Template

```markdown
# ADR-NNNN: Decision title

- Status: Proposed | Accepted | Superseded | Deprecated
- Date: YYYY-MM-DD
- Decision owners: names or team
- Supersedes: ADR-NNNN (optional)

## Context

What problem, constraints, and forces require a decision?

## Decision

What is being decided?

## Alternatives considered

What credible alternatives were evaluated and why were they not selected?

## Consequences

What positive, negative, operational, security, and migration effects follow?

## Validation

How will the decision be tested or measured?
```

Accepted ADRs are immutable historical records. If a decision changes, create a new ADR that supersedes the old one and update both statuses.

## Initial ADR backlog

1. Modular monolith as the initial architecture.
2. Tenant and branch isolation strategy.
3. Offline POS synchronization and idempotency.
4. Authentication and rotating session tokens.
5. Transactional outbox for reliable events.
6. Monorepo tooling and package boundaries.

