# AS ONE — Approved Technology Stack

## Decision policy

This file records approved technology families. Exact versions belong in committed manifests and lockfiles. New technologies require a documented need, alternatives, operational impact, security review, and an ADR when the choice is architectural.

## Frontend

- **Flutter Web / Dart:** product applications and reusable UI packages.
- **Responsive desktop-first UI:** optimized for operational workstations while remaining usable at supported widths.
- **PWA capabilities:** used where installation, caching, or offline POS behavior provides clear value.

Business rules must live in domain/application layers, not widgets. Generated client code must come from versioned contracts and be reproducible.

## Backend

- **Node.js:** supported LTS release pinned by repository configuration.
- **TypeScript:** strict mode enabled; unsafe escape hatches require justification.
- **Fastify:** HTTP transport, validation integration, hooks, and plugin composition.

The backend is a modular monolith with explicit public module interfaces.

## Data

- **PostgreSQL:** authoritative transactional store.
- **SQLite or IndexedDB:** durable local POS data selected per client runtime.
- **Redis:** cache, ephemeral state, rate limits, locks/coordination, and real-time fan-out.
- **Cloudflare R2 or S3-compatible storage:** binary objects with ownership metadata in PostgreSQL.

Redis, browser storage, and object storage must not replace PostgreSQL as the source of business truth.

## Infrastructure and delivery

- Docker and Docker Compose for development and initial deployments.
- NGINX or Traefik for ingress/reverse proxy.
- Cloudflare for DNS, TLS edge controls, and applicable protection/caching.
- GitHub Actions for continuous integration and controlled delivery.

## Deferred technologies

RabbitMQ/NATS, OpenSearch, ClickHouse, and Kubernetes are not foundation dependencies. They may be adopted only after measured needs exceed the approved stack's capabilities.

## Quality tool expectations

The scaffold must provide deterministic commands for formatting, linting, type checking, unit/integration tests, builds, migrations, and dependency/security checks. CI uses the same commands as local development.

## Version and dependency policy

- Pin runtime versions and commit lockfiles.
- Prefer actively maintained dependencies with compatible licenses.
- Minimize direct and transitive dependency surface.
- Automate update visibility, but review upgrades deliberately.
- Never execute untrusted lifecycle scripts without review.

