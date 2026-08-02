# ADR-0007: Browser authentication and context selection

- Status: Accepted
- Date: 2026-08-02
- Owners: AS ONE Engineering

## Context

The existing bearer contract creates a company-bound session during login. A
user with multiple companies cannot discover eligible companies because the
context endpoint already requires such a session. Browser refresh credentials
also need protection from JavaScript without weakening mobile and POS clients.

## Decision

- Use a short-lived, single-use, hashed company-selection challenge after valid
  credentials when no unique company can be selected.
- Keep every normal session company-bound and server-authorized.
- Create a replacement session for company switching; rotate the current
  session generation for branch switching.
- Keep browser access tokens in memory and browser refresh tokens in a host-only
  `HttpOnly`, `Secure`, `SameSite=Strict` cookie.
- Require Origin validation and a rotating per-session CSRF header for
  cookie-authenticated mutations.
- Preserve body-transport refresh tokens for mobile and POS secure storage.
- Represent company-wide authority explicitly; never infer it from an empty
  branch list.

## Alternatives considered

- **Expose memberships before credential validation:** rejected because it
  enables enumeration.
- **Create a tenantless normal session:** rejected because it weakens the
  company-bound authorization invariant.
- **Store browser refresh tokens in localStorage:** rejected due to XSS impact.
- **Use one cookie across AS ONE subdomains:** rejected because host-only scope
  is narrower.
- **Require cookies for all clients:** rejected because mobile and POS need
  platform-secure bearer transport.

## Consequences

An additive challenge table and migration are required before implementation.
The API must support two explicit refresh transports, CSRF validation, and
credential replacement during context switches. The design preserves current
bearer clients and tenant isolation while making browser authentication viable.

## Validation

Test anti-enumeration, challenge expiry/single use/attempt limits, cross-user
and cross-company denial, atomic context replacement, refresh races and reuse,
cookie attributes, CSRF and CORS rejection, branch/company-wide cases, and
bearer compatibility.

## References

- [Browser authentication and context contract](../BROWSER_AUTHENTICATION_CONTEXT.md)
- [API contracts](../API_CONTRACTS.md)
- [Authentication foundation](../AUTHENTICATION_FOUNDATION.md)
- [Tenant isolation](ADR-0006-tenant-isolation.md)
