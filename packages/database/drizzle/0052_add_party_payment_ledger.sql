ALTER TABLE "party_reservation_payments" ALTER COLUMN "cash_movement_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "party_reservation_payments" ADD COLUMN "method" text DEFAULT 'cash' NOT NULL;--> statement-breakpoint
ALTER TABLE "party_reservation_payments" ADD COLUMN "reference" text;--> statement-breakpoint
ALTER TABLE "party_reservation_payments" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "party_reservation_payments" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "party_reservation_payments" ADD COLUMN "voided_by" uuid;--> statement-breakpoint
ALTER TABLE "party_reservation_payments" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "party_reservation_payments" ADD COLUMN "void_cash_movement_id" uuid;--> statement-breakpoint
ALTER TABLE "party_reservation_payments" ADD CONSTRAINT "party_reservation_payments_voided_by_membership_fk" FOREIGN KEY ("company_id","voided_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_reservation_payments" ADD CONSTRAINT "party_reservation_payments_void_movement_uq" UNIQUE("company_id","void_cash_movement_id");--> statement-breakpoint
ALTER TABLE "party_reservation_payments" ADD CONSTRAINT "party_reservation_payments_method_ck" CHECK ("party_reservation_payments"."method" in ('cash', 'card', 'transfer'));--> statement-breakpoint
ALTER TABLE "party_reservation_payments" ADD CONSTRAINT "party_reservation_payments_method_movement_ck" CHECK (("party_reservation_payments"."method" = 'cash') = ("party_reservation_payments"."cash_movement_id" is not null));--> statement-breakpoint
ALTER TABLE "party_reservation_payments" ADD CONSTRAINT "party_reservation_payments_reference_ck" CHECK ("party_reservation_payments"."reference" is null or char_length(btrim("party_reservation_payments"."reference")) between 1 and 120);--> statement-breakpoint
ALTER TABLE "party_reservation_payments" ADD CONSTRAINT "party_reservation_payments_notes_ck" CHECK ("party_reservation_payments"."notes" is null or char_length(btrim("party_reservation_payments"."notes")) between 1 and 500);--> statement-breakpoint
ALTER TABLE "party_reservation_payments" ADD CONSTRAINT "party_reservation_payments_void_ck" CHECK (("party_reservation_payments"."voided_at" is null and "party_reservation_payments"."voided_by" is null and "party_reservation_payments"."void_reason" is null and "party_reservation_payments"."void_cash_movement_id" is null)
        or ("party_reservation_payments"."voided_at" is not null and "party_reservation_payments"."voided_by" is not null and "party_reservation_payments"."void_reason" is not null
            and char_length(btrim("party_reservation_payments"."void_reason")) between 3 and 500
            and (("party_reservation_payments"."method" = 'cash') = ("party_reservation_payments"."void_cash_movement_id" is not null))));