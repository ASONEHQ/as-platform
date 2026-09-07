# Go-Live Checklist

A checkbox-oriented companion to `docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md` —
that document explains *how*; this one is what you physically check off on
launch day. Every item below was exercised at least once during TASK
14.1's own staging rehearsal against a disposable database.

## Infrastructure

- [ ] DNS records created for the chosen domains (e.g. `app.asone.mx`, `api.asone.mx`)
- [ ] HTTPS certificates issued and terminating at the reverse proxy/load balancer in front of the API (Fastify itself never terminates TLS)
- [ ] `TRUST_PROXY` set correctly for that proxy topology

## Environment / secrets

- [ ] Every required variable in `docs/PRODUCTION_ENVIRONMENT.md` is set — none left at a placeholder/example value
- [ ] `AUTH_ACCESS_TOKEN_SECRET` is a real, high-entropy value (config validation rejects it otherwise in production — confirmed by test)
- [ ] `CORS_ALLOWED_ORIGINS` lists the real Flutter origin only — never `*`
- [ ] No secret value has been pasted into a chat, ticket, or committed to git

## Database TLS

- [ ] `DATABASE_URL` carries `sslmode=require`/`verify-ca`/`verify-full`, OR `DATABASE_TLS_EXTERNALLY_TERMINATED=true` is explicitly set with a documented reason
- [ ] Confirmed the API fails to boot against a non-TLS production `DATABASE_URL` (this is enforced by config validation, not operator discipline alone)

## Migration

- [ ] Backup taken and verified (`ops backup-verify`) before migrating an existing database
- [ ] `pnpm --filter @asone/database db:migrate` run against production `DATABASE_URL`, completed with exit code 0
- [ ] Migration count matches the repo's own count (24 as of this task — check `packages/database/drizzle/meta/_journal.json` for the current true count)

## Technical seed

- [ ] `pnpm --filter @asone/database db:seed` run against production `DATABASE_URL`
- [ ] No `dev:seed-*` / `dev:bootstrap-owner` command was ever run against this database (they refuse against a non-loopback host anyway, but confirm none was attempted)

## Owner

- [ ] First-owner provisioning CLI run (fresh tenant only) — `provision:production-owner` — with a real legal company name, real slug, real owner name/email
- [ ] Owner's password entered via the masked interactive prompt (or `PROVISION_OWNER_PASSWORD` set and then immediately unset) — never a placeholder
- [ ] Owner login confirmed working before proceeding
- [ ] Provisioning summary contained no plaintext password

## Branch

- [ ] At least one real branch exists (created at provisioning or via `POST /api/v1/companies/{id}/branches`)
- [ ] Branch has a real name/code/timezone — not a placeholder

## Register

- [ ] At least one real cash register created for the branch (`POST /api/v1/cash-registers`)
- [ ] Register successfully opened with a real counted opening float

## Cashier

- [ ] Real cashier user created (`POST /api/v1/users`)
- [ ] A minimal Cashier role created and granted ONLY what a launch cashier needs — verified in this task's own rehearsal as sufficient for the full core flow:
      `catalog.read`, `inventory.read`, `cash_register.read`, `cash_session.open`, `cash_session.read`, `cash_movement.create`, `cash_session.close`, `sale.create`, `sale.read`, `payment.create`, `customer.read`, `customer.create`
      (add `reward.read`+`reward.redeem` if the loyalty/rewards program is in use; add `refund.*` ONLY if store policy lets a cashier self-approve refunds — see ADR-0015)
- [ ] Cashier activated with a real password (first activation now REQUIRES one — confirmed rejected otherwise)
- [ ] Cashier assigned to the correct branch
- [ ] Cashier login confirmed working
- [ ] Confirmed the cashier is correctly DENIED admin-only actions (creating a promotion, creating a user, editing company settings) — a 403, not a silent success

## Catalog / prices / tax / inventory

- [ ] Real categories/products created through the authenticated catalog API — NOT a demo/dev seed
- [ ] Each product explicitly set to `status: "active"` (defaults to `draft` — a draft product cannot be sold, confirmed during this task's own rehearsal)
- [ ] Each sellable product has a real effective price set
- [ ] Tax codes assigned correctly per product
- [ ] Inventory-tracked products have real opening stock counts, if applicable

## Receipt / printing

- [ ] A completed sale's receipt opens reliably in the browser print path
- [ ] Reprinting a historical sale produces an identical receipt
- [ ] No PII (phone/email) or raw internal tokens appear on the receipt

## Backup

- [ ] Pre-deploy backup taken (`scripts/production/backup-db.mjs`) and verified (`ops backup-verify`)
- [ ] Backup file stored somewhere OTHER than the API host itself (offsite/encrypted per `docs/BACKUP_STRATEGY.md`) — never left only in a local, unencrypted directory

## API health

- [ ] `GET /health` returns `200 {"status":"ok"}`
- [ ] `GET /ready` returns `200` once Postgres is reachable (a Redis outage alone no longer blocks this — confirmed by test)
- [ ] API process is running under real supervision (systemd/Docker Compose — not a bare foreground terminal command)

## Go-live functional test

- [ ] Owner login works
- [ ] Cash register opens with a real float
- [ ] A real cash sale (exact tender) completes
- [ ] A real cash sale WITH change completes, change amount correct
- [ ] Receipt reprints correctly
- [ ] Refund permission matches actual store policy (either a real test refund works correctly, or it's cleanly denied if cashiers shouldn't self-approve)
- [ ] Cash register closes with a correct discrepancy calculation
- [ ] A NEW session opens cleanly right after closing (proves the daily cycle repeats)

## Monitoring / support

- [ ] Operator knows how to check `/health`/`/ready` and read the API's own startup/fatal-error log lines (see `docs/OBSERVABILITY_AND_SUPERVISION.md`)
- [ ] A support contact/escalation process exists for the launch day (who to call if the register can't take a sale)

## Explicitly disabled / deferred

- [ ] **Mercado Pago LIVE remains intentionally disabled/paused** — cash is the only payment method at launch
- [ ] Wallet, advanced Rewards UX, QR scanner polish, analytics/reports, thermal printer integration, and other POST-LAUNCH items are confirmed NOT required for launch day
