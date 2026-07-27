# Scoped Company and Branch Settings

## Status

TASK 09.3 implements the closed, non-secret settings catalog used by REST contracts E016–E019. It includes catalog types, default resolution, validation, PostgreSQL persistence, authenticated HTTP behavior, optimistic concurrency, and transactional audit/outbox evidence.

## Scope

Settings are typed, versioned configuration overrides for one authenticated company or one explicitly authorized branch. They are not a secret store and must never contain credentials, passwords, API keys, tokens, private keys, or unrestricted arbitrary JSON.

The catalog is closed and versioned in code. Clients cannot create keys or change their declared types. Setting writes are online-only. Safe effective values may later be cached read-only by authorized clients.

## Resolution

Company settings resolve in this order:

1. Active company setting.
2. Current approved field from `companies`, when the catalog defines one.
3. Technical catalog fallback.

Branch settings resolve in this order:

1. Active branch override.
2. Active company setting.
3. Current approved field from `companies`, when the catalog defines one.
4. Technical catalog fallback.

Updating a base company field does not create or update setting rows. It changes the effective value only when no active override shadows that field. Retiring a company setting returns to the current company field or technical fallback. Retiring a branch setting returns to the current effective company value.

Every effective value identifies its source as `default`, `company`, or `branch`.

## Catalog version 1

| Key | Type | Effective default | Branch override | Validation |
| --- | --- | --- | --- | --- |
| `business.display_name` | string | `companies.display_name`, then empty string | Yes | Trimmed; explicit values contain 1–120 characters |
| `business.timezone` | string | `companies.timezone`, then `America/Mexico_City` | Yes | Valid IANA timezone |
| `business.locale` | string | `companies.locale`, then `es-MX` | Yes | `es-MX` or `en-US` |
| `business.currency` | string | `companies.currency_code`, then `MXN` | No | `MXN` or `USD` |
| `operations.day_start_time` | string | `09:00` | Yes | 24-hour `HH:mm` |
| `operations.day_end_time` | string | `21:00` | Yes | 24-hour `HH:mm` |
| `receipts.header_text` | string | Empty string | Yes | Maximum 500 characters |
| `receipts.footer_text` | string | Empty string | Yes | Maximum 500 characters |
| `receipts.show_company_tax_id` | boolean | `false` | Yes | Boolean |
| `security.session_idle_minutes` | integer | `30` | No | Integer from 5 through 1440 |
| `security.require_manager_for_voids` | boolean | `true` | Yes | Boolean |
| `ui.date_format` | string | `DD/MM/YYYY` | Yes | `DD/MM/YYYY`, `MM/DD/YYYY`, or `YYYY-MM-DD` |
| `ui.time_format` | string | `24h` | Yes | `12h` or `24h` |

All version 1 entries are public. No secret entry exists.

## Version and cache design

An effective catalog value with no persisted setting begins at virtual version `1`. The first explicit persisted write creates version `2`; every subsequent update, retirement, or reactivation increments the same row. A base-company-field change affects the effective collection checkpoint but does not increment a setting row.

E016 and E018 calculate a canonical SHA-256 checkpoint from the catalog version and sorted effective entries. The checkpoint includes key, type, source, individual version, and normalized effective value. It is returned in the representation and collection ETag, so a relevant base company field change invalidates the effective-settings cache.

E017 and E019 use the individual numeric version for `ETag` and mandatory `If-Match`.

## Retirement

Retirement is logical. It increments the existing row version, changes its status to `retired`, records `deleted_at`, and retains the previously persisted value for traceability. Reactivation reuses that row. Although E017 and E019 require `value` and `value_type` for a retirement request, the service validates those fields without replacing the last persisted value.

## Security and tenant boundaries

- `company_id` comes exclusively from the authenticated session.
- A path company must match the authenticated company.
- A branch must belong to that company and appear in the actor's explicit branch access.
- An empty branch-access list grants no branch access.
- Unknown keys, mismatched types, and prohibited branch overrides are rejected.
- Setting mutation, audit evidence, and outbox event commit in one PostgreSQL transaction.
- Audit and outbox payloads omit complete setting values.
- Events are `company_setting.changed` and `branch_setting.changed`.

## Effective version semantics

- No persisted row: version `1`.
- Active company row: its persisted version.
- Retired company row: inherited value with the retired row's current version.
- Active branch row: its persisted version.
- Retired branch row: inherited company/default value with the retired branch row's version.
- No branch row: the effective company version.
- A branch row for a non-overridable key is ignored safely and never affects value, source, or version.
- A base company field change affects the effective value and collection checkpoint when no active override shadows it. It never increments a persisted setting version.

## Canonical checkpoint

The canonical UTF-8 input is a JSON array whose first item is the catalog version. Every remaining item is an explicitly ordered tuple:

```text
[key, type, source, decimal version string, normalized effective value]
```

Entries are sorted by key. The serialization excludes tenant identity, row IDs, timestamps, request/correlation IDs, retired non-effective values, and audit metadata. SHA-256 produces `settings:<64 lowercase hexadecimal characters>`. Equal effective collections may therefore share a checkpoint across tenants.

## Persistence and concurrency

Repository reads always include `company_id`; branch reads also include `branch_id`. Existing rows may be locked with `SELECT ... FOR UPDATE`, while mutations retain an atomic `WHERE version = expected_version` predicate.

The first write requires virtual version `1` and inserts persisted version `2`. A concurrent unique violation is translated to internal `version_conflict`. Updates, retirement, and reactivation increment `version` atomically and return the changed row. Retirement never replaces the last persisted value. There is no hard delete.

Mutation methods accept an existing SQL transaction. When none is provided, the repository can create one. This allows the later audit/outbox block to compose all writes in one transaction without nesting transactions.

## Transactional audit and outbox

E017 and E019 execute setting mutation, audit evidence, and outbox insertion inside one PostgreSQL transaction. Any failure rolls back all three writes. Reads, cache validation, and `304` responses do not create audit or outbox records.

Audit actions are:

- `company_setting.updated`
- `company_setting.retired`
- `branch_setting.updated`
- `branch_setting.retired`

Audit metadata records the key, declared type, final status, effective source before and after, version before and after, and whether the normalized effective value or its type changed. It never records the previous value, new value, request body, headers, credentials, or database error details.

Outbox events are `company_setting.changed` and `branch_setting.changed`. Their aggregate is the concrete persisted setting row:

- `aggregate_type`: `company_setting` or `branch_setting`
- `aggregate_id`: stable UUID of the company or branch setting row
- `aggregate_version`: new persisted row version

The schema version is `1`. The safe payload contains only `key`, `value_type`, final `status`, effective `source`, `effective_value_changed`, and `version`. It deliberately omits the setting value; consumers retrieve the current authorized representation through E016 or E018.

Audit and outbox share the HTTP correlation ID and operation timestamp. Audit also retains the request ID and authenticated user actor. Branch mutations retain `branch_id` in both records.

`effective_value_changed` compares normalized effective value and declared type, not source alone. A source transition with the same effective value is therefore `false`; retirement that inherits a different value is `true`.

## Validation

The migration history `0000` through `0003` is executable from an empty dedicated PostgreSQL database. Database constraint tests cover tenant ownership, lifecycle, value types, and initial version semantics. Repository and HTTP integration tests cover resolution, optimistic concurrency, rollback, audit/outbox evidence, authorization, caching, and safe error behavior.

Run the complete validation with a disposable database whose name contains `test`:

```text
DATABASE_TEST_URL=<dedicated-test-url> pnpm db:test
DATABASE_TEST_URL=<dedicated-test-url> pnpm --filter @asone/api test
pnpm lint
pnpm typecheck
pnpm test
pnpm db:check
pnpm db:generate
```
