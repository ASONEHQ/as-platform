# AS ONE — Roadmap

## Roadmap rules

This roadmap communicates sequence, not fixed dates. A phase advances only when its exit criteria are met. Product scope changes require documentation and, when architectural, an ADR.

## Phase 1 — Foundation (current)

### Objectives

- Establish the monorepo and module boundaries.
- Configure Flutter Web, Node.js, Fastify, and TypeScript foundations.
- Define PostgreSQL migrations, Redis integration boundaries, and local POS storage contracts.
- Establish CI, containers, configuration conventions, and observability basics.
- Define identity, tenants, branches, roles, permissions, and audit concepts.

### Deliverables

- Top-level repository scaffold described in `ARCHITECTURE.md`.
- Development, test, lint, type-check, build, and migration commands.
- Initial health/readiness endpoints and API error contract.
- Database migration framework with tenant-safe conventions.
- GitHub Actions validation pipeline.
- Docker Compose development environment.
- Master documentation and initial ADRs.

### Exit criteria

- A new contributor can start the platform from documented steps.
- CI validates every proposed change.
- Tenant boundaries are testable and enforced by design.
- No secrets are committed.
- Foundation decisions are documented and reviewable.

## Phase 2 — Identity and administration

- Authentication, session management, rotating refresh tokens, and recovery.
- Tenant and branch lifecycle management.
- Role- and permission-based authorization.
- User invitations and branch assignments.
- Security-sensitive audit events.
- Initial AS Admin experience.

## Phase 3 — POS operational core

- Terminal registration and device identity.
- Offline command/outbox model and deterministic synchronization.
- Catalog and price read models needed by POS.
- Cash-session foundations and idempotent transaction submission.
- Conflict, retry, and reconciliation workflows.

Detailed sales and inventory behavior requires separate approval before implementation.

## Phase 4 — Customer-facing experiences

- AS Tickets and admission workflows.
- AS Events reservations and capacity controls.
- AS Rewards accounts, earning, and redemption.
- Customer communication and consent management.

## Phase 5 — Operations and intelligence

- AS CEO dashboards and cross-branch reporting.
- AS Snacks operational workflows.
- Advanced observability, anomaly detection, and reconciliation.
- Read-optimized analytics introduced only when PostgreSQL is insufficient.

## Phase 6 — Scale and selective extraction

- Horizontal scaling and regional deployment where justified.
- Queueing, search, or analytics platforms based on measured constraints.
- Extraction of modules only when ownership, scale, reliability, or deployment needs justify it.
- Kubernetes only after operational complexity and scale warrant it.

## Cross-cutting work in every phase

- Security threat review and tenant-isolation tests.
- Accessibility and responsive desktop-first UX.
- Auditability, observability, backup, and recovery validation.
- API compatibility and migration safety.
- Performance measurement against explicit service objectives.

