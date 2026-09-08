# Opening Day Checklist — AS POS Daily Operating Routine (Inflapark)

TASK 14.2 (part of Section S). A checkbox companion to
[docs/GO_LIVE_CHECKLIST.md](GO_LIVE_CHECKLIST.md), but for a **recurring
daily routine**, not a one-time launch event. `GO_LIVE_CHECKLIST.md` is what
you check off once, the day AS POS first goes live for a store; this
document is what a cashier/manager checks off **every single operating
day** afterward, for as long as the branch operates. The mechanism (this
checklist itself) is generic to any AS POS branch station — Inflapark's own
branch/register/staff names are filled in as the worked example, exactly
like the other two documents in this task.

Every operational claim below is cross-referenced to the real doc/code
that supports it rather than re-derived from scratch — this document does
not duplicate `docs/BACKUP_STRATEGY.md`'s backup script, does not invent a
different Cashier permission list than TASK 14.0's own rehearsal fixed, and
does not claim capabilities (a forced-retry-dedup guarantee, a support
hotline) that the codebase does not actually provide.

---

## BEFORE OPEN

- [ ] **Internet connectivity** confirmed at the station (the browser can
      reach the public internet at all — AS POS is not usable offline for
      the core sale flow; there is no offline-first sale queue in this
      codebase today).
- [ ] **API health** — `GET https://<api origin>/health` returns `200
      {"status":"ok"}`. See
      [docs/OBSERVABILITY_AND_SUPERVISION.md](OBSERVABILITY_AND_SUPERVISION.md)
      §1.5 for exactly what this endpoint checks (a static response, no
      dependency check).
- [ ] **API readiness / database reachable** — `GET https://<api
      origin>/ready` returns `200`. Per
      [OBSERVABILITY_AND_SUPERVISION.md](OBSERVABILITY_AND_SUPERVISION.md)
      §1.5, this gates on **PostgreSQL only** — a Redis-only outage still
      returns `200` here (core sale flow never touches Redis), so a `200`
      on `/ready` is the correct "safe to open" signal for the register.
- [ ] **Printer / browser popup permission** confirmed working at this
      specific station — see
      [docs/INFLAPARK_PRINT_SETUP.md](INFLAPARK_PRINT_SETUP.md) §3 for the
      one-time Chrome/Edge popup-allow setup; this checklist item is the
      **daily spot-check** that it's still allowed (browser updates can
      occasionally reset it), not the initial setup itself.
- [ ] **Owner login** (only if the owner is present and needs to perform an
      owner-only action that day — e.g. adjusting a price, creating a new
      user). Not required for a normal cashier-run opening.
- [ ] **Cashier login** — the scheduled cashier logs in with their own real
      credentials (never a shared/generic account — see
      [docs/INFLAPARK_USER_ONBOARDING.md](INFLAPARK_USER_ONBOARDING.md) for
      how that account was provisioned).
- [ ] **Register exists** — the branch's cash register (`POST
      /api/v1/cash-registers` at setup time, per
      [docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md](PRODUCTION_DEPLOYMENT_RUNBOOK.md)
      §14) is visible and selectable from the POS.
- [ ] **Catalog prices spot-checked** — pick 2-3 real products and confirm
      the price shown in the POS matches what is physically posted at the
      register/signage. This is a manual cross-check against human error
      (a price typo entered the day before), not something the system
      verifies for you.
- [ ] **Inventory loaded** — for any stock-tracked product, confirm the
      opening stock count shown in the POS matches a real physical count
      for that item, if your park tracks inventory for it.
- [ ] **Test print** — print one throwaway/test receipt (or reprint
      yesterday's last sale) and confirm it comes out correctly on the
      physical printer before the first real customer of the day. See
      [docs/INFLAPARK_PRINT_SETUP.md](INFLAPARK_PRINT_SETUP.md) §5 for the
      full test procedure — this is the abbreviated daily version of it.
- [ ] **Opening float counted and entered** — a real, physically counted
      cash amount is entered when opening the cash session (`cash_session
      .open`) — never an assumed/estimated figure.

---

## DURING OPERATING HOURS

- [ ] **Support escalation known** — every cashier working that day knows
      who to call if the register cannot take a sale. **This is a business
      decision this documentation-only pass cannot make for Inflapark** —
      write the real name/phone number here:
      `REQUIRED_OPERATOR_INPUT`. For the *technical* diagnostic steps
      whoever is called should actually run, see
      [docs/OBSERVABILITY_AND_SUPERVISION.md](OBSERVABILITY_AND_SUPERVISION.md)
      Part 2's "Symptom → what to check" table — that document defines
      the diagnostic process; this checklist does not repeat it, only
      points to it.
- [ ] **Failed-sale handling understood** — if `POST /api/v1/sales` (or
      the subsequent payment call) errors or times out, the cashier:
  - Does **not** panic-write a manual paper sale or re-key totals from
    memory — the app deliberately keeps the ticket/cart exactly as it was
    on any failure (confirmed in `pos_shell.dart`: `SaleSession` is cleared
    only after a payment call actually succeeds, never on a failure or a
    cancel), so nothing already entered is lost.
  - Every sale-creation call already carries a required `Idempotency-Key`
    header (confirmed in `sales.routes.ts`); if the exact same request is
    genuinely retried with that same key, the backend returns the original
    result rather than creating a second sale (confirmed:
    `created.replayed` / `idempotency-replayed` response header, per
    [ADR-0005](adr/ADR-0005-idempotency-and-outbox.md)).
  - **Important, verified nuance — do not over-trust this for a manual
    re-tap**: the Flutter POS client generates a **fresh** idempotency key
    on every explicit call to "Cobrar" (confirmed in
    `pos_sales_gateway.dart`'s `_defaultIdempotencyKey`) — the automatic
    same-key replay only covers the app's own internal retry after an
    auth-token refresh, not a cashier manually tapping "Cobrar"/"Reintentar"
    again after seeing an error. **If a sale visibly errors and you are
    unsure whether it actually posted before the error appeared** (e.g. the
    screen froze or the network dropped after tapping Cobrar), check Sales
    History for that amount/time **before** tapping Cobrar again, rather
    than assume the platform automatically prevents a duplicate — a second
    tap is a genuinely new sale-creation attempt if the first one silently
    succeeded server-side. If the sale is confirmed NOT to have posted,
    retrying (same cart, same tap) is safe.
- [ ] **Reprint procedure known** — see
      [docs/INFLAPARK_PRINT_SETUP.md](INFLAPARK_PRINT_SETUP.md) §5, "Test
      procedure" step 3 — open the sale in Sales History, use the reprint
      action; this is a read-only operation and never re-charges or
      re-posts inventory for that sale (per ADR-0012).
- [ ] **Refund authorization known** — who may approve a refund matches
      Inflapark's actual launch role matrix, not a different one invented
      here: `refund.*` permissions are granted to the Cashier role **only
      if** store policy explicitly allows a cashier to self-approve a
      refund; otherwise a cashier's refund attempt is denied with a `403`
      by design (see [docs/GO_LIVE_CHECKLIST.md](GO_LIVE_CHECKLIST.md)'s
      own "Cashier" and "Go-live functional test" sections, and
      [ADR-0015](adr/ADR-0015-returns-and-refunds.md), for the exact
      permission list and denial behavior this platform's own launch
      rehearsal already confirmed). Do not grant a broader refund policy
      here than what was actually configured on the Cashier role.
- [ ] **Cash discrepancy handling known** — if a mid-day cash count doesn't
      match the expected running total, record a real cash movement
      (`cash_movement.create`) explaining the discrepancy rather than
      silently adjusting the till; the final, authoritative discrepancy
      figure is computed automatically at session close (see CLOSE
      section below) — do not try to "fix" the number by hand before then.

---

## CLOSE

- [ ] **Denomination count** — the cashier physically counts the drawer
      (by denomination, if your park's process asks for that level of
      detail) before closing the session.
- [ ] **Close session** — the counted amount is submitted to close the
      cash session (`cash_session.close`).
- [ ] **Discrepancy verified** — confirm the discrepancy the system
      computes (counted vs. expected, based on the opening float plus every
      recorded cash sale/movement) makes sense; investigate before moving
      on if it does not, rather than closing and forgetting an unexplained
      gap.
- [ ] **Backup taken** — run the real backup script
      (`scripts/production/backup-db.mjs`), per
      [docs/BACKUP_STRATEGY.md](BACKUP_STRATEGY.md)'s own "Real tooling"
      section — this checklist does not re-describe that script's flags or
      output format; see that document directly. Verify it (`ops
      backup-verify` / `verify-restore.mjs`) per the same document's
      recommended cadence — not necessarily every single day if your
      park's backup schedule runs on a different (e.g. nightly/cron) cadence
      than "immediately at manual close"; confirm which cadence Inflapark
      actually operates under: `REQUIRED_OPERATOR_INPUT`.
- [ ] **Next-day readiness confirmed** — after closing, confirm a **new**
      cash session can be opened cleanly right away (this platform's own
      design already supports this — TASK 14.1's own staging rehearsal
      explicitly proved "close, then immediately reopen" works, per
      [docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md](PRODUCTION_DEPLOYMENT_RUNBOOK.md)
      §21/"Go-live test"). You do not need to do anything special to
      "reset" the register for tomorrow — closing today's session is the
      only step required before tomorrow's opening float can be entered
      fresh.

---

## References

- [docs/GO_LIVE_CHECKLIST.md](GO_LIVE_CHECKLIST.md) — the one-time launch
  checklist this daily routine is modeled after (tone, checkbox structure)
  but does not duplicate (infrastructure/DNS/TLS/migration items live
  there only, not here).
- [docs/INFLAPARK_PRINT_SETUP.md](INFLAPARK_PRINT_SETUP.md) — the full
  print setup and test procedure this checklist's print items point to.
- [docs/INFLAPARK_USER_ONBOARDING.md](INFLAPARK_USER_ONBOARDING.md) — how
  the cashier/owner accounts referenced above were provisioned.
- [docs/BACKUP_STRATEGY.md](BACKUP_STRATEGY.md) — the real backup/restore
  scripts and their operator-recommended schedule.
- [docs/OBSERVABILITY_AND_SUPERVISION.md](OBSERVABILITY_AND_SUPERVISION.md)
  — health/readiness endpoints and the diagnostic "symptom → what to
  check" table for support escalation.
- [ADR-0005](adr/ADR-0005-idempotency-and-outbox.md) — the idempotency-key
  contract behind the failed-sale-handling guidance above.
- [ADR-0012](adr/ADR-0012-sale-receipt-and-printing.md),
  [ADR-0015](adr/ADR-0015-returns-and-refunds.md) — reprint and refund
  mechanics referenced above.
