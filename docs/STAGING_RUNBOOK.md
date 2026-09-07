# Staging Runbook

A staging environment mirrors production closely enough to rehearse a real
deployment without any real business risk. TASK 14.1 ran the FULL procedure
below once, live, against a disposable database
(`asone_staging_rehearsal_14_1`, created and dropped within this task —
never `asone_local`/`asone_test`) — every command here is proven, not
speculative.

## What makes an environment "staging" here

- **Separate database** — its own Postgres database/instance, never
  `asone_local` (dev), `asone_test` (the CI/integration test suite depends
  on its exact state), or the real production database.
- **Separate secrets** — its own `AUTH_ACCESS_TOKEN_SECRET`,
  `REDIS_URL`, etc. Never the production secret values, even if staging
  otherwise runs `NODE_ENV=production` to exercise the production config
  hardening (weak-secret rejection, TLS requirement) for real.
- **Non-production customer data** — real-shaped but fake company/owner/
  customer records created through the exact same provisioning/API path a
  real launch uses, never a copy of real customer PII.
- **Mercado Pago LIVE disabled** — identical to production right now
  (paused); staging never becomes the first place MP LIVE is turned on.
- **Production build artifacts** — the compiled `dist/server.js`
  (never `tsx watch`) and a real `flutter build web --release` pointed at
  the staging API's own URL, not `flutter run`.

## Rehearsal procedure (exactly what this task ran)

1. Create a fresh, empty database: `CREATE DATABASE asone_staging_rehearsal_14_1`.
2. Migrate it: `DATABASE_URL=<staging URL> pnpm --filter @asone/database db:migrate`.
3. Seed it: `DATABASE_URL=<staging URL> pnpm --filter @asone/database db:seed` (75 permission codes inserted).
4. Provision the first owner:
   ```
   DATABASE_URL=<staging URL> PROVISION_OWNER_PASSWORD=<real-looking test password> \
     node dist/provisioning/production-owner.cli.js \
     --company-legal-name="Tienda Rehearsal S.A. de C.V." --company-slug=tienda-rehearsal \
     --owner-name="Ana Owner" --owner-email=ana@tienda-rehearsal.mx \
     --branch-name="Sucursal Centro" --branch-code=CTR --yes
   ```
5. Build once: `pnpm build` (root) — produces every workspace's `dist/`.
6. Start the compiled API against the staging database and a staging-only port/secret set: `node dist/server.js`.
7. Confirm `/health` and `/ready` both succeed.
8. Log in as the owner; create a real cash register (`POST /api/v1/cash-registers`); create + activate a real cashier with a minimal role (see `docs/GO_LIVE_CHECKLIST.md`'s exact permission list); log in as the cashier.
9. Open the register; create a real category/product/price through the authenticated catalog API (confirmed a fresh tenant's catalog starts genuinely empty — no demo data leaks in); set the product `active` (it defaults to `draft`).
10. Complete a real cash sale; confirm the receipt; confirm Sales History.
11. Close the register; confirm the discrepancy calculation.
12. **Restart the API process** (kill + restart `node dist/server.js` against the same database) — confirms nothing was held only in memory.
13. Log in again (both owner and cashier); confirm the closed session, the completed sale, Sales History, and the catalog product all survived the restart intact.
14. Open a brand-new session and complete one more sale, proving the system keeps operating normally after the full restart cycle, not just that old data persisted.
15. Tear down: drop the disposable staging database, stop the staging API process.

Every one of these 15 steps passed with zero real findings on this task's
own run — the only failures encountered along the way were rehearsal-script
mistakes (wrong request field names), never a real product defect.

## What staging is NOT for

- It is not a substitute for the real production secrets/DNS/TLS
  configuration — those are exercised for real only at actual launch.
- It is not where Mercado Pago LIVE gets its first real test — that
  remains explicitly out of scope until a future, separately-authorized
  task.
- It does not need to survive indefinitely — the database created for a
  rehearsal is disposable and should be dropped afterward, exactly as this
  task's own rehearsal database was.
