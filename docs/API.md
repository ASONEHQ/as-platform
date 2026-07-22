# AS ONE — API Conventions

## Scope

The primary API is a versioned HTTPS JSON interface served by Fastify. Contracts are product-neutral and tenant-aware. OpenAPI should be generated or validated from the same schemas used at runtime.

## Resource conventions

- Prefix public routes with a stable version such as `/v1`.
- Use nouns for resources and explicit action endpoints only when a resource transition is not clear.
- Use UUIDs in path parameters.
- Use ISO 8601 UTC timestamps in payloads.
- Use strings or integer minor units for money according to the documented contract, never JSON floating-point assumptions.

## Authentication and context

Protected endpoints derive actor, tenant, branch permissions, and session from verified credentials. A requested branch may narrow an authorized context but cannot expand it. `tenant_id` and `branch_id` from payloads are validated against the trusted context.

## Authorization

Authorization occurs at the use-case boundary and is enforced again in tenant-scoped data access. Permissions are action-oriented and resource-aware. Cross-tenant operations require explicit platform-level privileges and dedicated endpoints.

## Validation

Validate path, query, headers, and body with explicit schemas. Reject unknown or unsafe fields where practical. Normalize only after validation and never expose internal stack traces.

## Response and error envelope

Successful responses use predictable resource or collection shapes. Errors use a stable structure:

```json
{
  "error": {
    "code": "stable_machine_code",
    "message": "Safe human-readable message",
    "request_id": "uuid",
    "details": []
  }
}
```

Validation details must not reveal secrets or internal implementation.

## Collections

Use cursor pagination for large or changing collections. Define deterministic ordering and stable filters. Responses include the next cursor, never unbounded datasets.

## Idempotency and concurrency

Critical commands accept an idempotency key scoped to tenant and operation. Concurrent updates use explicit versioning, conditional requests, or domain invariants; last-write-wins is not acceptable for financial records.

## Compatibility

- Prefer additive changes.
- Do not repurpose existing fields or enum values.
- Deprecations include migration guidance and an announced removal policy.
- Breaking changes require explicit approval and a new contract version when necessary.

## Real-time events

Events include event ID, type, schema version, occurred-at time, tenant scope, branch scope where applicable, aggregate identity, and correlation/causation IDs. Subscribers must tolerate duplicate delivery and recover missed events through API synchronization.

## Offline synchronization

POS synchronization endpoints accept ordered, idempotent commands and return per-command outcomes plus a new checkpoint. The server revalidates authentication, authorization, tenant/branch ownership, and business invariants for every command.

## Documentation and testing

Every endpoint needs schema examples, permission requirements, error cases, tenant/branch behavior, and idempotency semantics. Contract tests cover positive behavior, validation, authorization denial, and cross-tenant isolation.

