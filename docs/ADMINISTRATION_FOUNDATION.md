# Administration Foundation

## Purpose and scope

TASK 09.2 establishes the authenticated administration foundation for AS ONE. TASK 09.3 completes contracts E016–E019 with scoped company and branch settings. Together they cover E008–E037 for company context, branches, typed settings, global identities, company memberships, roles, permissions, explicit branch access, and devices.

## Architecture

Administration is part of the modular Fastify monolith. Routes authenticate the request, services enforce permissions and tenant boundaries, repositories execute parameterized PostgreSQL operations, and every material mutation commits its domain effect, audit record, and outbox event in one transaction.

## Identity and tenant isolation

`users` are global identities. Access to a tenant exists only through `company_memberships`. The API derives `company_id`, membership, permissions, and permitted branches from the authenticated session; client-provided tenant identifiers never establish scope. Cross-company resources return the same safe not-found behavior as missing resources.

Suspending or disabling a membership revokes that user's active sessions and refresh tokens for the affected company. Other company memberships remain isolated.

## Companies and branches

Company and branch reads and mutations are restricted to the current company. Branch-scoped access is explicit. An empty permitted-branch list means no branch access, never company-wide access.

## Company and branch settings

Settings use a closed, versioned, non-secret catalog. Effective company values resolve from an active override, an approved company field, or a technical fallback. Effective branch values additionally allow an authorized branch override. Persisted writes require `If-Match`, use logical retirement, and retain a monotonically increasing version. Collection checkpoints and ETags are derived from normalized effective values.

Company scope comes from the authenticated session. Branch routes additionally require explicit branch access and verify tenant ownership. Mutation, safe audit metadata, and an outbox event commit atomically. Full setting values are omitted from audit and outbox payloads. See [SETTINGS_FOUNDATION.md](SETTINGS_FOUNDATION.md) for the catalog and resolution semantics.

## Roles and permissions

Roles belong to one company and are assigned to company memberships, optionally for one branch. System roles cannot be changed through unsafe role or grant mutations. Assignments use logical `active` and `revoked` states with `revoked_at`; a matching revoked assignment can be safely reactivated.

Role permissions support `allow` and `deny`. Effective authorization evaluates active assignments and gives `deny` precedence over `allow`. Replacing a role's permission set is atomic and rejects duplicate or unknown permission identifiers.

## Explicit branch access

`user_branch_access` records membership-to-branch access. Grants validate that membership and active branch share the authenticated company. Revocation is logical, clears default status, and revokes sessions and refresh tokens scoped to that user and branch. Only one active default branch is permitted per membership.

## Devices

Devices are unique by `(company_id, device_code)`. Registration validates an authorized active branch. Responses omit public keys, token material, and secrets. Device revocation is idempotent, marks the device revoked, records `revoked_at`, and revokes associated sessions and refresh tokens in the same transaction.

## Audit, outbox, and request tracing

Material mutations write `audit_log` and `outbox_events` inside the mutation transaction. Audit records retain the authenticated actor, tenant and optional branch, action, resource, safe metadata, `request_id`, and `correlation_id`. Redis and WebSocket delivery are not sources of truth; the committed outbox is.

## Contract coverage

| Contracts | Status | Notes |
| --- | --- | --- |
| E008–E015 | Implemented | Context, company, and branch administration |
| E016–E019 | Implemented | Typed company/branch settings, effective resolution, ETags, retirement, audit, and outbox |
| E020–E023 | Implemented | Users and company memberships; E022 supports `roles` and `branches` includes |
| E024–E033 | Implemented | Roles, allow/deny permissions, assignments, and explicit branch access |
| E034–E037 | Implemented | Device registration, reads, and revocation |

No auxiliary public administration endpoints were introduced.

## Security decisions

- Tenant scope always comes from the authenticated context.
- Branch scope must be explicitly authorized.
- Deny grants override allow grants.
- Sensitive identity, password, token, and device-key material is never returned.
- Cross-company lookups do not disclose resource existence.
- Critical state is soft-revoked and remains auditable.

## Testing and validation

Unit tests run with Vitest and validate transaction boundaries, rollback, audit, and outbox behavior without external services. PostgreSQL migration integration tests run only when `DATABASE_TEST_URL` identifies a dedicated test database. Validate with:

```text
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm db:generate
pnpm db:check
DATABASE_TEST_URL=<dedicated-test-url> pnpm db:test
DATABASE_TEST_URL=<dedicated-test-url> pnpm --filter @asone/api test
```

## Current limitations

- Database-backed concurrency and constraint behavior require a disposable PostgreSQL test environment.
- Device enrollment returns device state only; secure one-time credential delivery remains an explicit future decision.
