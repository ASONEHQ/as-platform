# AS ONE — Database and Data Conventions

## Source of truth

PostgreSQL is authoritative for transactional business data. Redis, SQLite, IndexedDB, search indexes, analytics stores, and object storage are derived or specialized stores with defined reconciliation paths.

## Identifiers and time

- Use UUID primary identifiers unless an approved ADR selects another strategy.
- Store timestamps in UTC using timezone-aware PostgreSQL types.
- Preserve the originating business timezone when it affects reporting or rules.
- Use database-generated or reliably sortable timestamps only when their semantics are documented.

## Tenant and branch ownership

- Every tenant-owned table includes non-null `tenant_id`.
- Branch-scoped tables include non-null `tenant_id` and `branch_id`.
- Foreign keys must prevent branch/tenant mismatches, using composite constraints where appropriate.
- Tenant-relative uniqueness includes `tenant_id`; branch-relative uniqueness also includes `branch_id`.
- Repository/query APIs require trusted tenant context rather than accepting an optional filter.

Defense in depth may include PostgreSQL row-level security, but application authorization and tests remain mandatory.

## Money and quantities

- Store currency amounts with exact decimal or integer-minor-unit representations.
- Never use floating point for currency.
- Record currency explicitly when more than one currency can exist.
- Define rounding at business boundaries and test it.

## Transactional integrity

Sales, payments, inventory movements, and cash operations use database transactions. External side effects are not performed inside an open transaction; use an outbox or resumable workflow.

Client commands and external callbacks include idempotency keys with tenant-scoped uniqueness. Duplicate delivery must return the established outcome rather than repeat the effect.

## Lifecycle and deletion

Critical transactional records are not physically deleted. Use cancellation/reversal records, status transitions, or controlled soft deletion. Corrections preserve who, when, why, and the prior value where relevant.

## Audit data

Critical actions record actor, tenant, branch when applicable, action, target, timestamp, correlation ID, source, and safe before/after context. Audit records are append-only to ordinary application roles.

## Migrations

- All schema changes use versioned migrations committed with the code that needs them.
- Migrations are forward-safe, reviewable, and tested against representative data.
- Destructive changes use expand/migrate/contract steps.
- Deployments run migrations as a controlled job, not concurrently from every API instance.
- Production rollbacks prefer corrective forward migrations when data may have changed.

## Indexing and performance

Indexes begin with actual access patterns. Tenant and branch scope should lead composite indexes when queries filter by them. Query plans for critical paths are reviewed with realistic cardinality.

## Backup and recovery

Define encrypted backups, retention, restore procedures, and recovery objectives before production. Restore tests are required; a backup without a tested restore is not considered reliable.

