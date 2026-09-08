# Inflapark Launch Configuration

How Inflapark's real business configuration gets into AS POS before opening
day, and — deliberately — the exact same mechanism any future park's
onboarding reuses. Nothing here is Inflapark-specific in the *code*; only
the config file's own *content* is. See [[V1_LAUNCH_SCOPE]] for what this
unlocks and [[V1_POST_LAUNCH_BACKLOG]] for what it doesn't.

## The two files

- `config/launch/launch-config.schema.json` — a generic JSON Schema
  (draft-07). Its enums are cross-checked against the real catalog/admin
  route contracts (`product-catalog.types.ts`, `catalog.routes.ts`), not
  invented. This file never changes per park.
- `config/launch/inflapark.launch.example.json` — the real, reviewable
  Inflapark template validated against that schema: company, branches,
  registers, roles, users, categories, products, opening inventory
  balances, and the rewards program. Onboarding the next park means
  writing a new file in this same shape — never touching the schema, the
  CLI, or any shared service.

## Applying it: `provision:business-config`

```bash
pnpm --filter @asone/api provision:business-config -- \
  --config=config/launch/inflapark.launch.example.json \
  [--database-url=postgresql://...] \
  [--dry-run] \
  [--users-password-env-prefix=INFLAPARK_LAUNCH] \
  [--yes]
```

- **Always dry-run first.** `--dry-run` reports the exact plan (rows to
  create vs. rows already present) with zero writes.
- **CLI-only** — no HTTP route exists for this; it must be run by someone
  with real database access, exactly like `provision:production-owner`
  (see `docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md`).
- **Idempotent by natural key** — branch code, register code, role code,
  category code, product code, normalized email. Re-running the same
  config after fixing one field only creates what's missing; it never
  duplicates or silently overwrites a conflicting existing row (a real
  conflict is reported and skipped, not resolved for you).
- **Reuses real, already-tested services** — `CatalogService`/
  `ProductCatalogService`, `AdministrationService`, the cash-registers
  service, `InventoryDraftService`/`InventoryPostingService`, and
  `LoyaltyService`/`RewardsService`. No raw SQL. Every write gets a real
  `audit_log` row and a real `outbox_events` row, like any other
  authenticated mutation.
- **New-user passwords are never stored in the config file.** With a TTY,
  the CLI prompts twice (masked) per new user. Non-interactively, it reads
  `<PREFIX>_<SANITIZED_EMAIL>` (or `<PREFIX>_USER_<N>` positionally) from
  the environment — set them, run the command, then unset them
  immediately, the same convention `PROVISION_OWNER_PASSWORD` already
  uses.

## What's already confirmed real, not placeholder

Pulled straight from `apps/api/src/development/bootstrap-owner.service.ts`
and the company's own registration during TASK 14.1's rehearsal — these
are safe to launch with as-is:

- Company: legal name "Inflapark Group", timezone `America/Mexico_City`,
  currency `MXN`, locale `es-MX`.
- 6 branch codes/names (PLV, PCE, UNI, JUR, CDMX, CAM) and their
  timezones.
- Category structure: Entradas, Paquetes, Atracciones, Tienda,
  Membresías, Extras.
- 10 catalog products with dev-fixture-derived prices — see the
  `unit_price_is_confirmed_final: false` flag on every one; the *codes*
  and *structure* are real, the *prices* are not yet operator-confirmed
  (Section T below).
- The Cajero/Gerente permission split (12 codes for Cajero; +4
  refund.* codes for Gerente) — refunds are manager-gated at launch,
  cashiers do not self-approve their own refunds.
- The "Sellos VIP (5+1)" rewards program shape — proven end-to-end in
  this task's own staging rehearsal (see the final report), shipped
  **disabled** (`rewards.enabled: false`) by deliberate business default;
  turning it on for real launch is a one-field config change plus a
  re-run of the CLI, not a code change.

## What is still `REQUIRED_OPERATOR_INPUT` — must be filled in before a real run

The business-config CLI refuses to run while any of these remain the
literal placeholder string:

1. **Which branch(es) actually open first.** The template config
   provisions all 6; do not assume simultaneous launch. Trim the
   `branches`/`registers` arrays to just the branch(es) opening Sept 15
   if that's fewer than 6 — see the staging rehearsal's own
   single-branch config for the pattern.
2. **Real staff identities** — `users[].display_name` and `.email` for
   the actual Cajero(s) and Gerente(s) at each opening branch. Never put
   a password in this file.
3. **Final confirmed pricing** — every product's `unit_price` is
   dev-fixture-derived, not business-confirmed. Flip
   `unit_price_is_confirmed_final` to `true` only once someone who owns
   pricing has actually signed off.
4. **Opening inventory counts** — `inventory_opening_balances[].quantity`
   for TDA-CALCETAS/TDA-AGUA/TDA-REFRESCO (and any additional
   stock-tracked product added before launch) must be a real physical
   count taken on the day, not a guess.
5. **Whether rewards launches enabled.** The template ships disabled; if
   the business wants "Sellos VIP" live on day one, flip
   `rewards.enabled` to `true` — the mechanism itself needs no further
   engineering (proven in the staging rehearsal).

## Related

- [[INFLAPARK_USER_ONBOARDING]] — how a new Cajero/Gerente actually gets
  their first login.
- [[INFLAPARK_OPENING_DAY_CHECKLIST]] — the runbook for opening morning.
- [[INFLAPARK_PRINT_SETUP]] — receipt printing/branding setup.
- `docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md` — the infrastructure this config
  gets applied on top of.
