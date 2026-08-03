# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Governing documents

`AGENTS.md` at the repo root is the permanent rulebook (product scope, approved stack, development rules, working method). Read it before implementing a feature. `docs/README.md` indexes the engineering knowledge base; `docs/adr/` holds accepted architecture decisions. Documentation must be updated in the same change as the behavior it describes, and material architectural decisions require a new ADR.

## Commands

Node toolchain is pinned: Node `24.18.0` (`.nvmrc`), pnpm `11.9.0` (`packageManager`). Use `corepack enable && corepack prepare pnpm@11.9.0 --activate` if pnpm is missing.

```shell
pnpm install
pnpm lint            # turbo -> eslint per workspace
pnpm typecheck       # turbo -> tsc --noEmit per workspace
pnpm test            # turbo -> vitest run (integration tests excluded)
pnpm build           # turbo -> tsc -p tsconfig.build.json per workspace
pnpm format:check    # prettier
pnpm dev             # turbo run dev (tsx watch)
```

Scoping to one workspace and running a single test file:

```shell
pnpm --filter @asone/api test
pnpm --filter @asone/api exec vitest run src/modules/catalog/catalog.service.test.ts
pnpm --filter @asone/api exec vitest run -t 'partial test name'
```

### Local services and database

```shell
pnpm docker:up       # postgres 17, redis 8, minio, mailpit (compose.yaml, loopback-bound)
pnpm docker:down
pnpm docker:reset    # drops volumes

pnpm db:generate     # drizzle-kit generate from src/schema/index.ts
pnpm db:check        # drizzle-kit check + custom safety/coverage script
pnpm db:migrate      # applies drizzle/*.sql to DATABASE_URL
pnpm db:seed         # deterministic technical permissions
pnpm db:test         # PostgreSQL migration/constraint integration tests
```

Copy `.env.example` to `.env` for local values; never commit a real `.env`.

### Integration tests

`*.integration.test.ts` files are excluded from the default `test` script and self-skip unless `DATABASE_TEST_URL` is set. The URL's database name **must** contain `test` — the tests assert this and refuse to run otherwise (they truncate/insert real rows). SQLite or in-memory PostgreSQL substitutes are prohibited.

```shell
DATABASE_TEST_URL=<dedicated-test-url> pnpm db:test
DATABASE_TEST_URL=<dedicated-test-url> pnpm --filter @asone/api exec vitest run src/modules/inventory/inventory.integration.test.ts
```

When Docker is unavailable, report migration/integration steps as _pending_, not passing.

### Flutter web app (`apps/one`)

Not part of the pnpm workspace — it has its own toolchain and is excluded from Prettier.

```shell
cd apps/one
flutter pub get
flutter analyze
flutter test
flutter run -d chrome --web-hostname=127.0.0.1 --web-port=8080 \
  --dart-define=AS_ENV=local --dart-define=AS_API_BASE_URL=http://127.0.0.1:3000
```

Use hostname `127.0.0.1` for both Flutter and the API so the `SameSite=Strict` refresh cookie behaves; the tracked local `CORS_ALLOWED_ORIGINS` allows exactly `http://127.0.0.1:8080`.

### Operational CLI

```shell
pnpm --filter @asone/api ops -- <command> [--json] [--timeout <ms>]
```

Read-only diagnostics only (dependency checks, outbox/inventory findings, shadow comparison, backup-manifest verification, restore precondition validation). Exit codes are meaningful — see `apps/api/src/operations/README.md`.

## Architecture

Modular monolith, multi-tenant (company) and multi-branch. Do not introduce microservices; preserve module boundaries so modules can be extracted later.

```
apps/api/         Fastify HTTP application (@asone/api)
apps/worker/      Background worker bootstrap (@asone/worker)
apps/one/         Flutter Web client (auth, context, read-only dashboard + POS shell)
packages/database Drizzle schema, migrations, pooled client, transactions (@asone/database)
packages/config   Zod-validated environment (@asone/config)
packages/logger   Pino + redaction policy (@asone/logger)
packages/errors   AppError and safe error primitives (@asone/errors)
packages/{typescript,eslint}-config  Shared strict profiles
```

### API composition

`src/server.ts` → `bootstrap/create-app.ts` → `bootstrap/register-plugins.ts`. `register-plugins.ts` is the single composition root: it wires plugins in order (request context → observability → security → OpenAPI → error handler → health → `/api/v1`) and then hand-constructs every module's repository/service/route triple. Adding a module means adding its wiring there — there is no DI container or auto-discovery.

Infrastructure (`src/infrastructure/dependencies.ts`) is injectable: when `database` is absent, business routes are simply not registered and only technical endpoints exist. Tests exploit this to run the app without PostgreSQL.

### Module layering

Each module under `src/modules/<name>/` follows `*.routes.ts` → `*.service.ts` → `*.repository.ts`, with `*.schemas.ts` (JSON Schema/validation), `*.types.ts`, and `*.http-errors.ts` (domain error → HTTP mapping). Keep business logic in services; routes only validate, authorize, and shape envelopes. Repositories are the only layer touching Drizzle.

Current modules: `auth`, `admin` (companies, branches, devices, identity, context, settings), `catalog` (categories/brands, products, options/variants), `inventory` (locations, drafts, posting, reversal, transfers, reservations, counts, reconciliation/repair).

### Request/response contract

- Success: `{ data, meta: { request_id, correlation_id } }` via `http/response.ts`.
- Errors: thrown `AppError` (from `@asone/errors`) carrying `code`/`statusCode`, normalized by `plugins/error-handler.ts` into `{ error: { code, message, details }, meta: { request_id, correlation_id } }`. Validation details are sanitized to `{ field, rule }`; never leak internals.
- **JSON payloads use `snake_case`; TypeScript internals use `camelCase`.** Routes translate at the boundary.
- Cursor pagination with deterministic ordering (`schemas/pagination.ts`); mutations accept idempotency keys and use `If-Match`/version for optimistic concurrency.
- `/__test/*` routes register only when `NODE_ENV=test`.

### Authorization and tenant isolation

`modules/auth/auth.guards.ts` is the entry point: `requireAuthenticatedUser` → `requireActiveMembership` → `requirePermission` / `requireBranchAccess`. Company and branch scope come from the verified token context, never from the request body — a client-supplied `company_id`/`branch_id` may only narrow an authorized scope, never widen it. The same scope is re-applied in repository queries; composite foreign keys `(company_id, branch_id)` enforce it at the database level (ADR-0006).

### Data conventions

- UUIDv7 primary keys via `idColumn()` in `packages/database/src/schema/common.ts`.
- Money is `numeric(19,4)` with explicit ISO 4217 currency. JS `number` and Dart `double` are prohibited for authoritative money; round half-up to 2 decimals only at documented commercial boundaries (ADR-0001).
- UTC `timestamptz` everywhere.
- Transactional records are never physically deleted — use status/cancellation/soft deletion.
- Every critical action writes to `audit_log`, and integration events go to `outbox_events` in the **same transaction** as the business write (ADR-0005). Inventory is an immutable ledger with rebuildable balances (ADR-0004).
- Use `withTransaction` from `@asone/database` for sales, payments, inventory, and cash operations.

### Migrations

Generated by drizzle-kit into `packages/database/drizzle/`, applied in order by `scripts/migrate.ts`. `db:check` runs `scripts/check-migrations.ts`, which **fails on `DROP TABLE`, `DROP COLUMN`, or connection-string-like text** and asserts a required table list is present. Migrations are append-only: never edit a committed SQL file — add a new one.

### Flutter client

Single `ChangeNotifier` auth controller owns session state; `go_router` guards derive redirects exclusively from an explicit phase machine (`bootstrapping`, `unauthenticated`, `companySelectionRequired`, `branchSelectionRequired`, `authenticated`, `refreshing`, `expired`, `revoked`, …). Access tokens live in `MemoryTokenVault` only; the refresh token is an HttpOnly `__Host-asone_refresh` cookie the browser transports (`BrowserClient.withCredentials = true`) and is never visible to Dart. Refresh is single-flight; safe GETs may retry once after refresh, mutations never retry. Do not add a second state-management or routing framework. Config arrives through non-secret `--dart-define` values only.

## Code style

- TypeScript is strict beyond `strict`: `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `isolatedModules`, `NodeNext`. ESM with explicit `.js` extensions in relative imports.
- ESLint runs `strictTypeChecked` + `stylisticTypeChecked` with `no-console`, `no-explicit-any`, `strict-boolean-expressions` (no truthy strings), `explicit-function-return-type`, and `consistent-type-imports` all as errors.
- Prefer `readonly` interfaces and `Object.freeze` for returned value objects — the existing code does this consistently.
- Prettier: 100 cols, single quotes, semicolons, trailing commas. `apps/one/**`, `docs/**`, and `AGENTS.md` are Prettier-ignored.
- Dart lints add `prefer_single_quotes`, `require_trailing_commas`, `sort_constructors_first`, `avoid_dynamic_calls`, `avoid_print`.

## Working expectations

Implement the smallest complete vertical slice: database model → API contract → permissions/tenant boundaries → real-time events → offline behavior → tests. Do not claim a task is complete unless `lint`, `typecheck`, `test`, and `build` have actually passed — and state explicitly which steps were skipped for lack of Docker or a test database.
