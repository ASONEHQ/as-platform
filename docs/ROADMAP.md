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
- Persistent inventory reconciliation findings, read-only drift detection, and
  contractually defined repair/rebuild semantics. The physical finding model
  and detector are complete; endpoint reservation, bounded repair application
  and operational recovery remain separately gated.
- Advanced observability and anomaly detection.
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

## Visible platform entrypoint delivery gates

1. **10.1 — Discovery (complete):** confirm that no production frontend exists
   and select a read-only AS ONE dashboard as the first visible product.
2. **10.2 — Browser authentication and context contract (complete):** resolve
   multi-company bootstrap, company/branch switching, browser refresh cookies,
   CSRF, CORS, compatibility, and the future additive migration contract. See
   [BROWSER_AUTHENTICATION_CONTEXT.md](BROWSER_AUTHENTICATION_CONTEXT.md).
   **10.2B.1** completes that contract by freezing durable, server-owned
   `sessions.transport_mode`; implementation requires the reviewed additive
   migration `0010_auth_session_transport_mode` before TASK 10.2B resumes.
   **10.4A** reserves E164 for secure post-reload CSRF bootstrap and clarifies
   E008 as the complete authenticated company-switch directory; both require
   application implementation before the visible login flow resumes.
   **10.4A.1** implements E164, the valid `__Host-` cookie attributes, and the
   authoritative E008/E009 discovery responses without schema changes.
3. **10.3 — Web foundation:** create the approved Flutter Web application,
   design tokens, typed minimal API client, and non-secret environment model.
4. **10.4 — Login and session UI:** implement credential, company, branch,
   refresh, expiry, permission, and logout states after the server contract is
   implemented.
5. **10.5 — Read-only dashboard:** show real authorized context, catalog, and
   inventory reads without introducing sales or payment behavior.
6. **10.6 — Deployment foundation:** add reviewed static/API artifacts, CI,
   ingress, secrets, observability, and rollback controls.
7. **10.7 — Secure demo:** publish synthetic demo data only after DNS, TLS,
   browser security, migrations, backup, and smoke-test gates pass.

## Inventory recovery delivery gates

1. **3.3I.4 — Repair contract (complete):** repair strategies, finding
   eligibility, preview, approval, locking, idempotency, audit and event reuse
   are frozen without implementation.
2. **3.3I.4.1 — API and permission reservation (current):** reserve E155-E160
   and `inventory.reconcile`. The future implementation seeds the permission;
   no public route exists in this block.
3. **3.3I.5 — Bounded repair application:** implement finding management and
   proven projection repairs with PostgreSQL concurrency evidence.
4. **3.4A — Operational recovery contract and runbooks (current):** freeze
   recovery objectives, backup/restore policy, shadow-rebuild controls,
   monitoring, incident roles and validation exercises without executable
   automation. See [OPERATIONAL_RUNBOOKS.md](OPERATIONAL_RUNBOOKS.md),
   [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md),
   [BACKUP_STRATEGY.md](BACKUP_STRATEGY.md), and
   [MONITORING.md](MONITORING.md).
5. **3.4B — Operational automation foundation:** implement internal read-only
   checks, readiness, scoped shadow comparison, backup-manifest verification,
   restore guards and stable commands. Public endpoints, scheduled workers,
   repair, destructive restore and provider deployment remain unavailable.

