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
- Persist a server-owned `transport_mode` (`browser|bearer`) on every normal
  session. Never infer it from request headers, cookies, or `User-Agent` after
  session creation.
- Keep challenge `client_type` distinct: `browser` maps to browser transport;
  `mobile` and `pos` map to bearer transport. Reject incompatible combinations.
- Resolve refresh credentials through their parent session and enforce its
  stored mode; do not duplicate transport mode on refresh-token rows.
- Preserve transport through context changes: company switching copies it to
  the replacement session and branch switching retains it. V1 exposes no
  authenticated transport-switch operation.
- Represent company-wide authority explicitly; never infer it from an empty
  branch list.
- Restore browser sessions after reload through E164: validate the canonical
  cookie, exact Origin, stored browser mode, active session, and generation;
  return only a short-lived signed CSRF proof, then let E002 rotate normally.
  E164 never issues access credentials or context and requires no persistent
  CSRF storage.
- Use E008 as the authenticated actor's complete active company-switch
  directory, derived from the global user in the session; E009 remains the
  server-authoritative current-company branch directory.

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

Migration `0009` provides the additive challenge table. A second minimal,
additive migration, `0010_auth_session_transport_mode`, is required before the
browser engine: add `sessions.transport_mode` as `NOT NULL`, checked to
`browser|bearer`, with `bearer` as the historical-row default. No refresh-token
column is required. The API must support two explicit refresh transports, CSRF
validation, and credential replacement during context switches. Existing
bearer clients remain compatible; new session creation writes its validated
mode explicitly.

E164 and the E008 response clarification reuse existing session, refresh,
membership, company, transport, and signing state. They require no schema
change, no CSRF table, and no migration `0011`.

## Validation

Test anti-enumeration, challenge expiry/single use/attempt limits, cross-user
and cross-company denial, atomic context replacement, refresh races and reuse,
cookie attributes, CSRF and CORS rejection, stored-mode/source mismatch,
conflicting sources, branch/company-wide cases, and bearer compatibility.

## References

- [Browser authentication and context contract](../BROWSER_AUTHENTICATION_CONTEXT.md)
- [API contracts](../API_CONTRACTS.md)
- [Authentication foundation](../AUTHENTICATION_FOUNDATION.md)
- [Tenant isolation](ADR-0006-tenant-isolation.md)
