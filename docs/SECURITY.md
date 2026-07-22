# AS ONE — Security Baseline

## Security principles

Use least privilege, deny by default, defense in depth, secure defaults, auditable actions, and explicit tenant boundaries. Security applies to design, implementation, delivery, and operations.

## Identity and sessions

- Hash passwords with a modern memory-hard algorithm using maintained libraries.
- Never store or log plaintext passwords.
- Use short-lived access tokens and rotating refresh tokens.
- Detect refresh-token reuse and revoke affected sessions.
- Protect recovery and enrollment flows against enumeration and abuse.
- Require stronger authentication for platform and tenant administrators when supported.

## Authorization and tenant isolation

- Combine roles with granular permissions.
- Resolve authorization from trusted server-side membership and branch assignments.
- Apply tenant scope on every protected query and mutation.
- Never trust client-provided tenant or branch identifiers without authorization checks.
- Test cross-tenant and cross-branch denial explicitly.
- Separate platform-administration paths from tenant operations.

## Application security

- Validate all external input and encode output for its destination.
- Use parameterized database access.
- Apply CSRF defenses where cookie-based authentication is used.
- Configure restrictive CORS, security headers, and content policies.
- Rate-limit authentication, recovery, payment-adjacent, and sensitive endpoints.
- Bound uploads by type and size; scan or quarantine where risk requires it.
- Prevent SSRF by allowlisting destinations and restricting egress where possible.

## Secrets and cryptography

Secrets live in an approved secret store or deployment environment, never source control, images, logs, or client bundles. Rotate credentials and scope them per environment. Use maintained platform cryptography and TLS in production; do not design custom cryptographic protocols.

## Audit and monitoring

Record authentication changes, permission changes, tenant/branch administration, financial operations, exports, sensitive reads, and security-control changes. Protect audit integrity and restrict access. Alert on repeated failures, privilege escalation, unusual exports, cross-tenant denial patterns, and token-reuse signals.

## Data protection

- Classify sensitive data and minimize collection.
- Encrypt data in transit and sensitive backups at rest.
- Keep sensitive payloads and credentials out of logs.
- Define retention and deletion rules consistent with transactional audit requirements.
- Use synthetic or sanitized data outside production.

## Supply chain and CI/CD

- Pin dependencies and actions to reviewed versions.
- Scan dependencies, containers, and committed secrets.
- Protect default branches and require CI.
- Restrict deployment credentials to required environments and operations.
- Produce traceable artifacts from reviewed source.

## Vulnerability response

Security findings must be reported privately, triaged by severity, contained, remediated, tested, and documented. Suspected exposed credentials are rotated immediately. Do not publish exploit details before containment.

## Security review checklist

Every feature identifies assets, actors, trust boundaries, tenant/branch scope, permissions, inputs, sensitive data, audit events, abuse/rate-limit needs, offline implications, and failure behavior.

