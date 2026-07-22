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

The API exposes technical endpoints only:

- `GET /health` — application status and safe version
- `GET /live` — process liveness only
- `GET /ready` — PostgreSQL and Redis connectivity without internal endpoints or credentials

No business route prefix is registered yet.

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
