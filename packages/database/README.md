# AS ONE Database

Typed PostgreSQL persistence foundation for AS ONE, implemented with Drizzle ORM and Drizzle Kit.

## Contents

- `src/schema/`: authoritative TypeScript table definitions.
- `src/client.ts`: lazy PostgreSQL pool, typed Drizzle client, readiness, and shutdown.
- `src/transaction.ts`: injectable transaction boundary for future atomic state, audit, and outbox writes.
- `src/seeds/`: deterministic approved technical permission definitions.
- `src/testing/`: schema, lifecycle, transaction, and PostgreSQL integration tests.
- `drizzle/`: immutable versioned SQL migrations and Drizzle snapshots.
- `drizzle.config.ts`: migration generation configuration.

## Commands

```shell
pnpm db:generate
pnpm db:check
pnpm db:migrate
pnpm db:seed
pnpm db:test
```

`db:migrate` requires a validated PostgreSQL `DATABASE_URL`. `db:test` requires a disposable `DATABASE_TEST_URL` whose database name contains `test`. Neither seeds nor destructive reset operations run automatically.

After a migration is applied or published, never edit it. Add a forward migration instead. Rollback uses a reviewed compensating migration or restoration into a new database; production data is never silently dropped.

UUIDv7 values are generated in the application through the maintained `uuid` package. PostgreSQL stores ordinary `uuid` values and does not infer commercial ordering from them.

## Identity and tenant context

`users` stores global human identity, with globally unique `normalized_email`. Tenant access is explicit in `company_memberships`; one user may hold one membership in each of multiple companies. Roles are assigned to a membership and are optionally constrained to a branch in that same company.

Future sessions retain the global user plus one active company membership. Composite foreign keys ensure the user, membership, role, branch, and optional device cannot be combined across companies. Only `token_hash` is stored. Authentication, refresh rotation, and runtime authorization are intentionally not implemented yet.
