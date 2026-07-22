# AS ONE Engineering Documentation

## What is AS ONE?

AS ONE is a multi-tenant, multi-branch SaaS platform for entertainment centers, trampoline and inflatable parks, family entertainment centers, franchises, and other experience-based businesses. Inflapark is the first pilot customer, but the platform is designed for independent companies with isolated data, brands, branches, users, and operating policies.

## Product ecosystem

| Product | Responsibility |
| --- | --- |
| AS POS | Resilient point-of-sale and branch operations |
| AS CEO | Executive dashboards and operational oversight |
| AS Rewards | Loyalty, memberships, and engagement |
| AS Events | Reservations and event operations |
| AS Tickets | Admissions and ticket lifecycle |
| AS Snacks | Food and beverage operations |
| AS Admin | Tenant, branch, user, and platform administration |

## Repository purpose

`ASONEHQ/as-platform` is the official AS ONE monorepo. It will contain product applications, the modular backend, shared packages, database assets, infrastructure configuration, automation, and the engineering documentation that governs their evolution.

## Documentation index

| Document | Purpose |
| --- | --- |
| [VISION.md](VISION.md) | Product purpose, market, and long-term outcomes |
| [ROADMAP.md](ROADMAP.md) | Delivery phases, objectives, and expected deliverables |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System boundaries, data flow, isolation, offline behavior, and scaling |
| [TECH_STACK.md](TECH_STACK.md) | Approved technologies and selection rationale |
| [DATABASE.md](DATABASE.md) | Data conventions, integrity, migrations, and recovery |
| [CORE_DATA_MODEL.md](CORE_DATA_MODEL.md) | Authoritative logical model for the first commercial transactional core |
| [API.md](API.md) | HTTP and real-time contract standards |
| [SECURITY.md](SECURITY.md) | Identity, authorization, application, and operational security |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Environments, delivery, observability, rollback, and recovery |
| [POS_V1_AUDIT.md](POS_V1_AUDIT.md) | Technical and functional audit of the AS POS V1 prototype |
| [adr/README.md](adr/README.md) | Architecture Decision Record process |

`AGENTS.md` at the repository root is the permanent rulebook for contributors and AI agents. This directory is the detailed engineering knowledge base.

## Current project status

AS ONE is in **Phase 1 â€” Foundation**. The current focus is the professional monorepo scaffold and master technical documentation. Product features, database tables, backend services, Flutter applications, and infrastructure definitions are outside the present documentation-only task.

## Engineering principles

1. Enforce tenant and branch isolation at every protected boundary.
2. Start with a modular monolith and preserve explicit module contracts.
3. Keep business logic independent from user interfaces and infrastructure.
4. Treat PostgreSQL as the transactional source of truth.
5. Design POS operations for safe offline use and deterministic synchronization.
6. Make critical actions auditable, secure, observable, and testable.
7. Scale infrastructure before introducing distributed-system complexity.
8. Prefer backward-compatible contracts and incremental delivery.
9. Store secrets outside source control and apply least privilege.
10. Record material technical decisions as ADRs.

## Documentation governance

Update documentation in the same change as the decision or behavior it describes. Significant architectural changes require an ADR. Documentation must distinguish approved decisions from proposals and must never contain credentials, production data, or unverified claims.

