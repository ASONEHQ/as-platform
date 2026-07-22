# AS ONE â€” Instructions for Codex

## Project

AS ONE is a multi-tenant SaaS platform for entertainment centers,
trampoline parks, inflatable parks, family entertainment centers,
franchises and experience-based businesses.

The platform must not be designed specifically for Inflapark.
Inflapark is the first pilot customer, but all features must support
multiple independent companies and branches.

## Product ecosystem

- AS POS
- AS CEO
- AS Rewards
- AS Events
- AS Tickets
- AS Snacks
- AS Admin

## Main objective

Build a secure, modular and scalable platform capable of supporting
hundreds of companies, thousands of POS terminals and high concurrent
transaction volumes.

The software must scale primarily by increasing infrastructure capacity,
without requiring a complete rewrite.

## Architecture

Use a modular monolith initially.

Do not create microservices unless explicitly requested.

The code must preserve clear module boundaries so individual modules
can be extracted into services in the future.

The system must be:

- Multi-tenant
- Multi-branch
- Offline-capable for POS operations
- Real-time
- Auditable
- Secure
- Modular
- Testable
- Prepared for horizontal scaling

## Approved technology stack

Frontend:
- Flutter Web
- Responsive desktop-first interface
- PWA support where appropriate

Backend:
- Node.js
- Fastify
- TypeScript

Database:
- PostgreSQL as the source of truth
- SQLite or IndexedDB for local/offline POS storage
- Redis for cache, temporary data, rate limiting and real-time coordination

Infrastructure:
- Docker
- Docker Compose during the initial stage
- NGINX or Traefik
- Cloudflare
- Cloudflare R2 or S3-compatible object storage
- GitHub Actions

Future technologies, only when justified:
- RabbitMQ or NATS
- OpenSearch
- ClickHouse
- Kubernetes

## Domain structure

- www.asone.mx
- app.asone.mx
- api.asone.mx
- pos.asone.mx
- ceo.asone.mx
- rewards.asone.mx
- events.asone.mx
- admin.asone.mx
- docs.asone.mx
- status.asone.mx

## Repository strategy

Use a monorepo during the initial development stage.

Expected top-level structure:

- apps/
- backend/
- packages/
- database/
- infrastructure/
- docs/
- scripts/
- assets/
- .github/

## Development rules

1. Do not introduce a new technology without documenting why.
2. Do not duplicate business logic.
3. Keep business logic out of UI components.
4. Validate all external input.
5. Every business record must include tenant ownership.
6. Branch-scoped records must include branch ownership.
7. Never trust tenant_id or branch_id sent directly by a client without authorization checks.
8. Use database migrations for all schema changes.
9. Use transactions for sales, payments, inventory and cash operations.
10. Add tests for critical business logic.
11. Do not commit secrets, passwords, tokens or production credentials.
12. Keep backwards compatibility in public API contracts whenever possible.
13. Document important architecture decisions in docs/adr/.
14. Prefer simple, maintainable implementations over premature complexity.
15. Do not claim a task is complete unless tests and validation have passed.

## Data conventions

Use UUIDs for primary identifiers unless another strategy is explicitly approved.

Use UTC timestamps in the database.

Use decimal-safe types for money. Never use floating-point values for currency.

Important transactional records must not be physically deleted.
Use status fields, cancellation records or soft deletion when appropriate.

Every critical action must be auditable.

## Security

- Hash passwords with a modern password-hashing algorithm.
- Use short-lived access tokens and rotating refresh tokens.
- Apply role-based and permission-based authorization.
- Apply tenant isolation on every protected query.
- Use HTTPS in production.
- Rate-limit authentication and sensitive endpoints.
- Store secrets outside source control.
- Record security-sensitive actions in an audit log.

## Working method

Before implementing a feature:

1. Explain the problem being solved.
2. Identify affected modules.
3. Define or update the database model.
4. Define the API contract.
5. Identify permissions and tenant boundaries.
6. Identify real-time events.
7. Identify offline behavior.
8. Implement the smallest complete vertical slice.
9. Run tests and document the result.

## Current project stage

AS ONE is currently in Phase 1: Foundation.

Completed:

- Domain: asone.mx
- Cloudflare account and DNS zone
- GitHub organization: ASONEHQ
- Repository: ASONEHQ/as-platform
- Initial docs directory

Current goal:

Create the initial professional monorepo scaffold and master technical documentation.

Do not implement sales, inventory, rewards or events yet unless explicitly requested.