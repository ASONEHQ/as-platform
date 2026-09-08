ALTER TABLE "company_memberships" ADD COLUMN "pin_hash" text;--> statement-breakpoint
ALTER TABLE "company_memberships" ADD COLUMN "qr_secret_hash" text;--> statement-breakpoint
ALTER TABLE "company_memberships" ADD COLUMN "qr_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "company_memberships_company_pin_idx" ON "company_memberships" USING btree ("company_id") WHERE "company_memberships"."pin_hash" is not null;--> statement-breakpoint
CREATE INDEX "company_memberships_company_qr_idx" ON "company_memberships" USING btree ("company_id") WHERE "company_memberships"."qr_secret_hash" is not null;--> statement-breakpoint
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_pin_hash_nonblank_ck" CHECK ("company_memberships"."pin_hash" is null or length(btrim("company_memberships"."pin_hash")) >= 20);--> statement-breakpoint
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_qr_secret_hash_nonblank_ck" CHECK ("company_memberships"."qr_secret_hash" is null or length(btrim("company_memberships"."qr_secret_hash")) >= 20);--> statement-breakpoint
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_qr_pair_ck" CHECK (("company_memberships"."qr_secret_hash" is null) = ("company_memberships"."qr_expires_at" is null));