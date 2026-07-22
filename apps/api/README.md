# AS ONE API

Fastify HTTP foundation for AS ONE. It provides the versioned technical entry point, health probes, request context, common response contracts, centralized errors, security headers, CORS, rate limiting, OpenAPI, metrics, safe logging, and graceful shutdown.

Run from the repository root with `pnpm dev`. See [`docs/BACKEND_FOUNDATION.md`](../../docs/BACKEND_FOUNDATION.md) for lifecycle and configuration details.

Authentication and identity live under `src/modules/auth`, separated into HTTP, application, persistence, password, token, authorization, and audit responsibilities. Only contract endpoints E001–E007 are implemented. See [`docs/AUTHENTICATION_FOUNDATION.md`](../../docs/AUTHENTICATION_FOUNDATION.md).

Business routes, authentication, WebSockets, repositories, migrations, schemas of record, and domain behavior are intentionally absent.
