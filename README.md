# AS ONE Platform

AS ONE is a multi-tenant, multi-branch SaaS platform for entertainment and experience-based businesses. This repository is the professional monorepo for AS POS, AS CEO, AS Rewards, AS Events, AS Tickets, AS Snacks, and AS Admin.

The current implementation is a foundation bootstrap only. It contains no business entities, authentication, transactional APIs, WebSockets, domain schema, migrations, POS interface, or worker processing.

## Requirements

| Tool           | Required version                                     |
| -------------- | ---------------------------------------------------- |
| Node.js        | `24.18.0` LTS (Krypton), pinned in `.nvmrc`          |
| pnpm           | `11.9.0`, pinned through `packageManager`            |
| Docker         | Engine/Desktop 27 or newer (optional for unit tests) |
| Docker Compose | v2.30 or newer (optional for unit tests)             |

Enable the pinned package manager with Corepack when needed:

```shell
corepack enable
corepack prepare pnpm@11.9.0 --activate
```

## Setup

```shell
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Use `.env.example` as the local configuration reference. Do not commit a real `.env` file.

## Development

```shell
pnpm dev
```

The HTTP foundation reads validated environment settings. Use `.env.example` as the local reference and keep real `.env` files outside source control.

| Variable                   | Purpose                                                         |
| -------------------------- | --------------------------------------------------------------- |
| `OPENAPI_UI_ENABLED`       | Expose the interactive OpenAPI UI; off by default in production |
| `METRICS_ENABLED`          | Expose Prometheus metrics; off by default in production         |
| `CORS_ALLOWED_ORIGINS`     | Comma-separated explicit origin allowlist                       |
| `RATE_LIMIT_MAX`           | Maximum requests in the global rate-limit window                |
| `RATE_LIMIT_WINDOW_MS`     | Rate-limit window in milliseconds                               |
| `REQUEST_BODY_LIMIT_BYTES` | Maximum accepted request body size                              |
| `REQUEST_TIMEOUT_MS`       | Request processing timeout                                      |
| `KEEP_ALIVE_TIMEOUT_MS`    | HTTP keep-alive timeout                                         |
| `TRUST_PROXY`              | Explicit Fastify proxy-trust setting                            |

The API exposes technical endpoints only:

- `GET /api/v1` — versioned API entry point
- `GET /health` — application status and safe version
- `GET /live` — process liveness only
- `GET /ready` — PostgreSQL and Redis connectivity without internal endpoints or credentials
- `GET /documentation` — OpenAPI UI when explicitly enabled
- `GET /metrics` — Prometheus text format when explicitly enabled

No business routes are registered. OpenAPI generation remains available internally even when its public UI is disabled. See [Backend Foundation](docs/BACKEND_FOUNDATION.md) for lifecycle, contracts, and operating decisions.

## Local services

```shell
pnpm docker:up
docker compose ps
pnpm docker:down
```

See [infrastructure/docker/README.md](infrastructure/docker/README.md) for service URLs, logs, and local data reset instructions.

## Workspace

```text
apps/api/                    Fastify technical bootstrap
apps/worker/                 Empty safe worker bootstrap
packages/config/             Zod environment validation
packages/logger/             Pino logger and redaction policy
packages/errors/             Safe infrastructure error primitives
packages/typescript-config/  Shared strict compiler profiles
packages/eslint-config/      Shared lint policy
infrastructure/docker/       Local service operations guide
docs/                        Approved engineering documentation
```

## Root commands

| Command             | Purpose                                                 |
| ------------------- | ------------------------------------------------------- |
| `pnpm dev`          | Run workspace development processes                     |
| `pnpm build`        | Build all implementation workspaces                     |
| `pnpm typecheck`    | Check strict TypeScript contracts                       |
| `pnpm lint`         | Run ESLint across workspaces                            |
| `pnpm format`       | Apply Prettier formatting                               |
| `pnpm format:check` | Verify formatting                                       |
| `pnpm test`         | Run Vitest once                                         |
| `pnpm test:watch`   | Run Vitest in watch mode                                |
| `pnpm clean`        | Remove generated workspace output and root dependencies |
| `pnpm docker:*`     | Manage local Docker services                            |

Architecture and product decisions remain authoritative in [docs/README.md](docs/README.md) and `AGENTS.md`.
