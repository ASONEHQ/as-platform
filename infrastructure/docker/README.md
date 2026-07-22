# Local Docker infrastructure

The root [`compose.yaml`](../../compose.yaml) provides PostgreSQL, Redis, MinIO, and Mailpit exclusively for local development. Its default credentials are fictitious and intentionally unsuitable for production.

## Requirements

- Docker Engine or Docker Desktop 27 or newer
- Docker Compose v2.30 or newer (`docker compose`, not legacy `docker-compose`)

## Commands

Copy `.env.example` to a local `.env` only when custom ports or credentials are needed. `.env` is ignored by Git.

```shell
pnpm docker:up
docker compose ps
pnpm docker:logs
pnpm docker:down
```

To delete all local service data and start clean:

```shell
pnpm docker:reset
pnpm docker:up
```

`docker:reset` removes the named local volumes and is destructive to local-only data.

## Local endpoints

| Service       | Default local endpoint  |
| ------------- | ----------------------- |
| PostgreSQL    | `127.0.0.1:5432`        |
| Redis         | `127.0.0.1:6379`        |
| MinIO S3 API  | `http://127.0.0.1:9000` |
| MinIO console | `http://127.0.0.1:9001` |
| Mailpit SMTP  | `127.0.0.1:1025`        |
| Mailpit UI    | `http://127.0.0.1:8025` |

Check health with `docker compose ps`. Application readiness also performs safe PostgreSQL `SELECT 1` and Redis `PING` checks without exposing connection strings.

Do not expose these services to public networks, reuse their credentials, or treat this Compose topology as production infrastructure.
