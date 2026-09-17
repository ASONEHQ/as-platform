-- Custom SQL migration file, put your code below! --

-- TASK 16.8B — production data repair: "Mexico_City" is not a valid IANA
-- timezone identifier (the real one is "America/Mexico_City"). It was
-- entered through the production branch-admin UI before any server-side
-- IANA validation existed anywhere in this platform (the `timezone`
-- column was only ever checked for non-blank text — see
-- `packages/database/src/schema/organizations.ts`'s
-- `companies_timezone_nonblank_ck`/`branches_timezone_nonblank_ck`), and
-- caused a real production 500 on `POST /api/v1/sales`:
-- `RangeError: Invalid time zone specified: Mexico_City`, thrown from
-- `PricingService.localWeekdayAndTime` -> `Intl.DateTimeFormat`.
--
-- Idempotent by construction: after the first run, no row anywhere ever
-- matches `timezone = 'Mexico_City'` again, so re-running this migration
-- (as the DigitalOcean migration job may do on a retry) is always a safe
-- no-op the second time.
--
-- This is the ONE known-unambiguous mapping this task was asked to fix.
-- No other timezone value is rewritten here — see the detection-only
-- report below.
update companies set timezone = 'America/Mexico_City' where timezone = 'Mexico_City';
update branches set timezone = 'America/Mexico_City' where timezone = 'Mexico_City';
--> statement-breakpoint

-- Detection-only report for any OTHER company/branch timezone value this
-- migration does not know how to safely repair. Never blindly rewritten —
-- per the task's own explicit instruction, guessing an unknown value's
-- intended timezone would risk silently corrupting a real tenant's
-- business-date/reporting truth. Compared against `pg_timezone_names`,
-- Postgres's own real, engine-native IANA/Olson timezone database (not a
-- hand-maintained list) — surfaced as `NOTICE` lines in the migration
-- job's own log output; this block never fails the migration and never
-- mutates any row.
do $$
declare
  bad_company record;
  bad_branch record;
  found_any boolean := false;
begin
  for bad_company in
    select id, timezone from companies
    where timezone not in (select name from pg_timezone_names)
  loop
    found_any := true;
    raise notice 'TASK 16.8B: company % has an unrecognized timezone value: %', bad_company.id, bad_company.timezone;
  end loop;
  for bad_branch in
    select id, timezone from branches
    where timezone not in (select name from pg_timezone_names)
  loop
    found_any := true;
    raise notice 'TASK 16.8B: branch % has an unrecognized timezone value: %', bad_branch.id, bad_branch.timezone;
  end loop;
  if not found_any then
    raise notice 'TASK 16.8B: no remaining unrecognized company/branch timezone values found.';
  end if;
end $$;
