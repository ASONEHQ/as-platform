# Database Foundation

## Scope and tool

TASK 08.3 establishes the first PostgreSQL persistence boundary for identity, organization, authorization, devices, sessions, audit evidence, idempotency, and transactional outbox records. It implements no authentication flow or business endpoint.

The foundation uses **Drizzle ORM** for typed PostgreSQL access and **Drizzle Kit** for deterministic, human-reviewable SQL migrations. One ORM and migration tool is used. Drizzle preserves direct visibility of PostgreSQL constraints and indexes without generating a proprietary runtime service.

## Structure

```text
packages/database/
├── drizzle/             Versioned SQL and migration metadata
├── src/client.ts        Pool-backed injectable client
├── src/schema/          Typed schema grouped by domain
├── src/seeds/           Approved deterministic technical data
├── src/testing/         Unit and optional PostgreSQL integration tests
├── src/transaction.ts   Shared atomic transaction boundary
└── drizzle.config.ts    Generation configuration
```

Drizzle's migration journal is the only schema-version authority. AS ONE does not duplicate it with a `schema_versions` table.

## Conventions

- Tables, columns, indexes, foreign keys, and constraints use stable `snake_case` names.
- Entity identifiers use PostgreSQL `uuid`; application defaults use standards-compliant UUIDv7.
- UUID ordering is never a commercial, accounting, or fiscal sequence.
- Time values use `timestamptz` and are stored in UTC.
- Mutable records have `created_at` and `updated_at`; append-only records omit `updated_at`.
- Status vocabularies use named `CHECK` constraints rather than PostgreSQL enums, allowing controlled future additions through ordinary migrations.
- Foreign keys use `RESTRICT` for foundational records; operational deletion is not implied.
- No PostgreSQL extension is required by this migration.

## Entities

| Table | Responsibility |
| --- | --- |
| `companies` | Tenant root and global slug |
| `branches` | Company-owned operating location and structured optional address |
| `users` | Platform-global human identity and optional future password hash |
| `company_memberships` | Explicit relationship between one global identity and one company |
| `roles` | Company-owned authorization bundle |
| `permissions` | Global approved capability vocabulary |
| `role_permissions` | Tenant-safe role-to-permission assignment |
| `user_roles` | Company-wide or branch-scoped role assignment for a membership |
| `devices` | Company/device identity with conditional branch ownership and revocation |
| `sessions` | Future identity session bound to an active company membership and containing only a token hash |
| `audit_log` | Append-only evidence of critical actions |
| `outbox_events` | Durable server-created event records for future at-least-once publication |
| `idempotency_keys` | Tenant-scoped command deduplication records and bounded safe responses |

`users` is platform-global and grants no tenant access by itself. `normalized_email` is globally unique. A user may have one `company_memberships` row per company and therefore belong to multiple companies without duplicating identity or credential data. Disabling a membership removes that company relationship without deleting the global user.

Authentication remains unimplemented. The optional `password_hash` is retained only as a future-compatible protected field; no login, refresh, hashing, or token issuance behavior exists in this task.

## Multi-company and branch isolation

Tenant-owned rows include `company_id`. Scoped tables expose composite ownership targets, and dependent tables use foreign keys such as `(company_id, branch_id)`, `(company_id, membership_id)`, and `(company_id, role_id)`. `company_memberships` references a global user and is unique by `(company_id, user_id)`. These constraints prevent accidental cross-company references even when application code is defective.

`user_roles` references the membership, role, and optional branch through the same `company_id`. Separate partial unique indexes prevent duplicate company-wide and branch-scoped grants. PostgreSQL RLS remains deferred under ADR-0006; application authorization is still mandatory when runtime features begin.

Sessions preserve the global `user_id`, the active `company_id`, and its `membership_id`. A three-column foreign key `(company_id, membership_id, user_id)` prevents a session from combining an identity with a company it does not belong to. An optional device must also belong to that company. Branch authority is deliberately not persisted in the session and must be recomputed from current grants in future authentication work.

## Migrations and rollback

`db:generate` compares the typed schema with the latest Drizzle snapshot and emits ordered SQL. Generated SQL must be reviewed for types, foreign keys, checks, indexes, destructive statements, and secrets before publication. `db:check` validates migration consistency and performs an additional static safety scan.

Published migrations are immutable. PostgreSQL transactional DDL provides failure atomicity where supported. Production rollback uses one of:

1. a reviewed forward compensating migration when data remains compatible;
2. application rollback while retaining the forward-compatible schema;
3. restoration into a new database followed by controlled cutover for unrecoverable migration failure.

There is no automatic `db:reset` command. Data is never dropped silently.

## Seeds

The technical seed contains exactly the 52 permission keys approved by `API_CONTRACTS.md`. IDs are deterministic UUIDv5 values under a project namespace so repeated execution is safe. The seed contains no company, branch, user, password, customer, or credential and never runs automatically in production.

## Audit, outbox, and idempotency

`audit_log` and `outbox_events` omit mutation timestamps and deletion fields. Application repositories must expose insert/read behavior only. Audit metadata and outbox payloads must be safe allowlisted JSON objects without credentials or unnecessary personal data.

The outbox stores unique `event_id`, positive schema and aggregate versions, nonempty object payloads, nonnegative attempts, and a partial pending index on unpublished events ordered by availability. A future publisher will claim rows with bounded `SKIP LOCKED` processing and provide at-least-once delivery; no publisher exists in this task.

Idempotency is unique by `(company_id, operation, key)`. Request hashes are mandatory, response status is bounded, stored response JSON is limited to 64 KiB, and retention expiry is mandatory. Retention duration remains an operational/legal decision.

## Transactions and client lifecycle

The database client owns a lazy `pg` pool unless a test supplies an external pool. It applies bounded connection and idle timeouts, never logs the connection URL, supports readiness checks, and closes owned resources. API and worker reuse this package, eliminating duplicate PostgreSQL pools.

`withTransaction` supplies the future boundary in which a business state change, audit row, idempotency outcome, and outbox event must commit atomically. Current tests demonstrate the boundary without implementing a business operation.

## Validation

Unit tests inspect table and column names, global email uniqueness, membership and tenant constraints, absence of plaintext session token columns, append-only shapes, seed count, client ownership, and transaction delegation. `db:check` reviews generated SQL and required scope constraints statically without Docker.

Real constraint and migration execution requires PostgreSQL and is isolated behind `DATABASE_TEST_URL`. The database name must contain `test`; SQLite and in-memory PostgreSQL substitutes are prohibited. When Docker is unavailable, `db:migrate` and `db:test` remain explicitly pending rather than reported as successful.

## Decisions pending

- Define credential storage and refresh-token rotation behavior before authentication work; the current session table establishes only identity and tenant context.
- Define audit, outbox, and idempotency retention periods.
- Select RLS only through a future accepted ADR and proven pool context.
- Establish partition thresholds from measured production volume.
- Define production migration approvals, backup gates, and recovery objectives.
