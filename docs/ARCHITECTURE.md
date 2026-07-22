# AS ONE — Architecture

## Architectural style

AS ONE begins as a modular monolith. It is deployed as a small number of runtime units while preserving strict internal module boundaries. Microservices are prohibited unless explicitly requested and justified by evidence.

## System context

- Flutter Web applications provide product-specific experiences.
- The Fastify API authenticates requests, establishes tenant and branch context, authorizes actions, and invokes application use cases.
- PostgreSQL is the transactional source of truth.
- Redis supports cache, ephemeral coordination, rate limiting, and real-time fan-out; it is never the sole store for business truth.
- POS clients use SQLite or IndexedDB for offline state and a durable outbox.
- R2 or compatible S3 storage holds objects; PostgreSQL holds their ownership and metadata.

## Monorepo structure

```text
apps/            Flutter Web applications
backend/         Fastify modular monolith
packages/        Shared contracts and tooling
database/        Migrations, seeds, and database tooling
infrastructure/  Containers, proxy, and deployment configuration
docs/            Product and technical documentation
scripts/         Repeatable development and operations scripts
assets/          Shared non-generated assets
.github/         CI, templates, and repository automation
```

## Backend module contract

Each domain module should own its application services, domain model, persistence adapters, HTTP handlers, events, and tests. Modules communicate through explicit public interfaces or internal events, not direct access to another module's tables or private code.

Recommended dependency direction:

```text
transport -> application -> domain
                    |
                    v
              infrastructure
```

Domain code must not depend on Fastify, Flutter, PostgreSQL, Redis, or vendor SDKs.

## Request boundary

Every protected request must establish an immutable context containing actor, tenant, permitted branches, roles/permissions, request ID, and authentication/session metadata. Client-provided `tenant_id` or `branch_id` never establishes authorization.

## Multi-tenancy

- Tenant-owned records contain `tenant_id`.
- Branch-owned records contain both `tenant_id` and `branch_id`.
- Queries scope by authorized tenant and branch at the repository boundary.
- Unique constraints include tenant scope where uniqueness is tenant-relative.
- Cross-tenant administration uses separate, explicit privileged paths.
- Isolation is covered by negative tests that attempt cross-tenant access.

## Offline POS model

POS writes are represented by client-generated, idempotent commands. The local store maintains required read data, pending commands, synchronization checkpoints, and reconciliation state. The server validates authority and invariants on synchronization; local acceptance is not final settlement.

Conflict policies must be explicit per operation. Financial records are never silently overwritten. Acknowledgements identify accepted, rejected, duplicated, or reconciliation-required commands.

## Real-time behavior

The database transaction commits before durable business events are published, preferably through a transactional outbox. Clients receive authorized tenant/branch-scoped events and recover gaps through cursor-based resynchronization.

## Scalability

API instances remain stateless and horizontally scalable. Shared coordination uses PostgreSQL or Redis according to durability needs. Optimize indexes, queries, caching, connection pools, and read models before extracting services.

## Reliability and observability

- Correlation IDs propagate across requests, jobs, events, and logs.
- Health and readiness checks distinguish process health from dependency readiness.
- Logs are structured and exclude secrets and sensitive payloads.
- Metrics cover latency, errors, saturation, synchronization backlog, and business-critical failures.
- Retries are bounded, observable, and safe only for idempotent operations.

## Architecture decisions

Material decisions belong in `docs/adr/`. Initial ADR candidates include modular monolith, tenant isolation, offline synchronization, authentication/session strategy, and transactional outbox.

