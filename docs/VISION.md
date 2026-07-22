# AS ONE — Product Vision

## Purpose

AS ONE is a multi-tenant SaaS platform for entertainment centers, trampoline parks, inflatable parks, family entertainment centers, franchises, and other experience-based businesses.

Inflapark is the pilot customer, not the product boundary. Every capability must work for independent companies with distinct brands, policies, users, branches, catalogs, and data.

## Product ecosystem

- **AS POS:** resilient branch operations and point of sale.
- **AS CEO:** executive visibility, indicators, and operational oversight.
- **AS Rewards:** loyalty, memberships, and customer engagement.
- **AS Events:** reservations and experience operations.
- **AS Tickets:** admission and ticket lifecycle management.
- **AS Snacks:** food and beverage operations.
- **AS Admin:** tenant, branch, user, permission, and platform administration.

## Vision

Provide one secure operational platform that lets experience-based businesses run every branch consistently, continue critical POS work during connectivity failures, and obtain trustworthy real-time information without maintaining disconnected systems.

## Product principles

1. Tenant isolation is a correctness and security requirement.
2. Branch context is explicit wherever operations are branch-scoped.
3. PostgreSQL is the source of truth; offline clients synchronize deliberately.
4. Financial and operational history is auditable and append-oriented.
5. Shared business rules live outside presentation layers.
6. A modular monolith is preferred until extraction has measurable value.
7. Capacity should scale through infrastructure before architectural replacement.
8. Features ship as small, complete, observable vertical slices.

## Target outcomes

- Support hundreds of companies and thousands of POS terminals.
- Preserve acceptable service under high concurrent transaction volume.
- Allow critical POS operations during temporary loss of connectivity.
- Give authorized users near-real-time operational visibility.
- Make every critical action attributable and reviewable.
- Enable future module extraction without rewriting domain logic.

## Current scope

Phase 1 establishes the monorepo, architectural boundaries, engineering standards, tenant model, delivery pipeline, and master documentation.

Sales, inventory, rewards, and events are not implementation targets in Phase 1 unless explicitly authorized.

## Success criteria for Phase 1

- Reproducible local development with documented commands.
- A professional monorepo scaffold matching the approved stack.
- Automated formatting, linting, type checking, and tests.
- A documented tenant and branch isolation strategy.
- Versioned database migrations and API conventions.
- Containerized development and a documented deployment path.
- Architecture decisions recorded in `docs/adr/`.

