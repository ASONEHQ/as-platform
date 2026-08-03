# Local owner bootstrap

This development-only command provisions the first database-backed AS ONE owner identity. It is guarded to `development` or `test`, loopback PostgreSQL, and an allowlisted database name. It refuses staging, demo, production, ambiguous environments, weak passwords, and protected database targets.

The bootstrap creates or safely reconciles `Inflapark Group`, six active development branches, `ceo@inflapark.local`, one active membership, the company-wide `owner` role, existing approved administrative permissions, explicit access to all six branches, and one sanitized audit record. It creates no business or financial data.

## Local sequence

From the repository root in PowerShell:

```powershell
Copy-Item .env.example .env
# Edit .env locally and set AS_DEV_BOOTSTRAP_PASSWORD to a unique strong temporary value.
docker compose up -d --force-recreate postgres redis
docker compose ps
pnpm.cmd db:migrate
pnpm.cmd db:seed
pnpm.cmd --filter @asone/api dev:bootstrap-owner
pnpm.cmd --filter @asone/api dev
```

In a second terminal:

```powershell
cd apps/one
C:\src\flutter\bin\flutter.bat run -d chrome --web-hostname=127.0.0.1 --web-port=8080 --dart-define=AS_ENV=local --dart-define=AS_API_BASE_URL=http://127.0.0.1:3000
```

Open `http://127.0.0.1:8080` and sign in as `ceo@inflapark.local` using the value supplied through `AS_DEV_BOOTSTRAP_PASSWORD`.

The `.env` file is ignored by Git. Never reuse the local password, database password, Redis password, or JWT secret in staging or production. The bootstrap output contains status and counts only; it never returns password material, hashes, tokens, or connection strings.
