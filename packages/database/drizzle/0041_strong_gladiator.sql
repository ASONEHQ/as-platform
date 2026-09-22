CREATE TABLE "party_reservation_coupon_redemptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"coupon_id" uuid NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"redeemed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "party_reservation_coupon_redemptions_company_coupon_reservation_uq" UNIQUE("company_id","coupon_id","reservation_id"),
	CONSTRAINT "party_reservation_coupon_redemptions_amount_ck" CHECK ("party_reservation_coupon_redemptions"."amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "party_reservations" ADD COLUMN "coupon_id" uuid;--> statement-breakpoint
ALTER TABLE "party_reservations" ADD COLUMN "coupon_code_snapshot" text;--> statement-breakpoint
ALTER TABLE "party_reservation_coupon_redemptions" ADD CONSTRAINT "party_reservation_coupon_redemptions_coupon_scope_fk" FOREIGN KEY ("company_id","coupon_id") REFERENCES "public"."coupons"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_reservation_coupon_redemptions" ADD CONSTRAINT "party_reservation_coupon_redemptions_reservation_scope_fk" FOREIGN KEY ("company_id","reservation_id") REFERENCES "public"."party_reservations"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "party_reservation_coupon_redemptions_coupon_idx" ON "party_reservation_coupon_redemptions" USING btree ("company_id","coupon_id");--> statement-breakpoint
CREATE INDEX "party_reservation_coupon_redemptions_reservation_idx" ON "party_reservation_coupon_redemptions" USING btree ("company_id","reservation_id");--> statement-breakpoint
ALTER TABLE "party_reservations" ADD CONSTRAINT "party_reservations_coupon_scope_fk" FOREIGN KEY ("company_id","coupon_id") REFERENCES "public"."coupons"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_reservations" ADD CONSTRAINT "party_reservations_coupon_snapshot_ck" CHECK (("party_reservations"."coupon_id" is null) = ("party_reservations"."coupon_code_snapshot" is null));