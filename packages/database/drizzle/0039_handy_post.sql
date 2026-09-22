ALTER TABLE "party_packages" ADD COLUMN "tax_code" text DEFAULT 'IVA_GENERAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "party_reservation_snacks" ADD COLUMN "tax_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "party_reservation_snacks" ADD COLUMN "tax_total" numeric(19, 4) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "party_reservations" ADD COLUMN "room_name_snapshot" text;--> statement-breakpoint
ALTER TABLE "party_reservations" ADD COLUMN "package_name_snapshot" text;--> statement-breakpoint
ALTER TABLE "party_reservations" ADD COLUMN "adults_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "party_reservations" ADD COLUMN "subtotal_amount" numeric(19, 4);--> statement-breakpoint
ALTER TABLE "party_reservations" ADD COLUMN "discount_total" numeric(19, 4) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "party_reservations" ADD COLUMN "tax_total" numeric(19, 4) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "party_packages" ADD CONSTRAINT "party_packages_tax_code_ck" CHECK ("party_packages"."tax_code" in ('IVA_GENERAL', 'IVA_EXEMPT'));--> statement-breakpoint
ALTER TABLE "party_reservation_snacks" ADD CONSTRAINT "party_reservation_snacks_tax_total_ck" CHECK ("party_reservation_snacks"."tax_total" >= 0);--> statement-breakpoint
ALTER TABLE "party_reservation_snacks" ADD CONSTRAINT "party_reservation_snacks_tax_snapshot_object_ck" CHECK ("party_reservation_snacks"."tax_snapshot" is null or jsonb_typeof("party_reservation_snacks"."tax_snapshot") = 'object');--> statement-breakpoint
ALTER TABLE "party_reservations" ADD CONSTRAINT "party_reservations_adults_count_ck" CHECK ("party_reservations"."adults_count" >= 0);--> statement-breakpoint
ALTER TABLE "party_reservations" ADD CONSTRAINT "party_reservations_subtotal_amount_ck" CHECK ("party_reservations"."subtotal_amount" is null or "party_reservations"."subtotal_amount" >= 0);--> statement-breakpoint
ALTER TABLE "party_reservations" ADD CONSTRAINT "party_reservations_discount_total_ck" CHECK ("party_reservations"."discount_total" >= 0);--> statement-breakpoint
ALTER TABLE "party_reservations" ADD CONSTRAINT "party_reservations_tax_total_ck" CHECK ("party_reservations"."tax_total" >= 0);--> statement-breakpoint
-- TASK 16.19 — one-time, additive backfill for any reservation created
-- before this migration (existing-tenant safety, per this task's own
-- constraint: "Existing events/reservations, if present, must be
-- migrated/preserved correctly"). Freezes `room_name_snapshot`/
-- `package_name_snapshot` from the room/package as they stand TODAY (the
-- best available truth for a pre-migration row, which never had a
-- snapshot at all) so `generateDocument` can stop live-joining for every
-- row going forward; sets `subtotal_amount` equal to the row's own
-- existing `quoted_total` (every pre-migration reservation was booked
-- with zero tax/discount applied, so subtotal == the total already
-- charged — this does not change what any customer was ever billed).
-- A NULL `room_name_snapshot`/`package_name_snapshot` after this UPDATE
-- (the room or package was hard-deleted, which this schema's own
-- `onDelete: 'restrict'` foreign keys make impossible in practice) is
-- still handled by a live-join fallback in application code, never
-- assumed impossible here.
UPDATE "party_reservations" AS pr
SET "room_name_snapshot" = pr_room."name",
    "package_name_snapshot" = pr_pkg."name",
    "subtotal_amount" = pr."quoted_total"
FROM "party_rooms" AS pr_room, "party_packages" AS pr_pkg
WHERE pr."room_id" = pr_room."id"
  AND pr."company_id" = pr_room."company_id"
  AND pr."package_id" = pr_pkg."id"
  AND pr."company_id" = pr_pkg."company_id"
  AND pr."room_name_snapshot" IS NULL;