# AS ONE — Deployment

## Deployment principles

Deploy immutable, reproducible artifacts through GitHub Actions. Environments are isolated, secrets remain outside source control, schema changes are controlled, and every release has observable health and a rollback or forward-fix plan.

## Initial topology

- Cloudflare provides DNS, edge TLS, and applicable protection.
- NGINX or Traefik terminates internal ingress responsibilities and routes services.
- Stateless Fastify API containers scale horizontally.
- Flutter Web artifacts are served as immutable static assets with controlled cache headers.
- PostgreSQL, Redis, and object storage use environment-specific managed or containerized services according to stage.
- Docker Compose supports local development and the initial non-complex deployment stage.

## Domains

`www.asone.mx`, `app.asone.mx`, `api.asone.mx`, `pos.asone.mx`, `ceo.asone.mx`, `rewards.asone.mx`, `events.asone.mx`, `admin.asone.mx`, `docs.asone.mx`, and `status.asone.mx` are routed independently while sharing approved platform infrastructure.

## Environments

At minimum use local, staging, and production. Each has separate credentials, data, storage prefixes/buckets, Redis namespaces or instances, and deployment approvals. Production data is never copied into lower environments without sanitization.

## CI pipeline

Pull requests should run formatting checks, linting, type checks, unit/integration tests, contract checks, migration validation, builds, secret scanning, dependency checks, and container scanning when images exist.

## Delivery pipeline

1. Build once from a reviewed commit.
2. Generate traceable versioned artifacts and metadata.
3. Deploy to staging and run smoke/readiness checks.
4. Obtain required production approval.
5. Run controlled backward-compatible migrations.
6. Deploy progressively and monitor service indicators.
7. Complete smoke tests and record the release.

## Configuration and secrets

Configuration is validated at startup. Secret values come from the environment or an approved secret manager. `.env.example` contains names and safe examples only. Frontend builds contain no server secrets.

## Health and observability

Liveness checks process health; readiness checks required dependencies. Deployments monitor request latency, error rate, saturation, database/Redis health, synchronization backlog, and critical business failures. Logs include release and correlation identifiers.

## Database changes

Use expand/migrate/contract changes for zero-downtime evolution. A single controlled job runs migrations. Application releases remain compatible with both sides of a rolling deployment.

## Rollback and recovery

Application artifacts must support rapid rollback when schema compatibility permits. Data-affecting incidents generally use a tested forward fix. Backups are encrypted, retained by policy, and restored in scheduled exercises.

## Scaling path

Scale stateless containers, database resources/read patterns, Redis capacity, and CDN caching before adding new distributed systems. Adopt queues, search, analytics stores, or Kubernetes only from measured constraints and an approved ADR.

## Production readiness gate

Before production, confirm TLS, DNS, secret rotation, least-privilege access, backups and restore test, migrations, monitoring/alerts, incident ownership, capacity expectations, security checks, smoke tests, and rollback/forward-fix procedures.

