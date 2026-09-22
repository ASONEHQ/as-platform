ALTER TABLE "party_packages" ADD COLUMN "included_consumables" jsonb;--> statement-breakpoint
ALTER TABLE "party_reservation_snacks" ADD COLUMN "product_variant_id" uuid;--> statement-breakpoint
ALTER TABLE "party_reservation_snacks" ADD COLUMN "stock_deducted" text DEFAULT 'not_applicable' NOT NULL;--> statement-breakpoint
ALTER TABLE "party_reservation_snacks" ADD COLUMN "stock_deducted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "party_reservation_snacks" ADD COLUMN "issued_quantity" numeric(19, 6);--> statement-breakpoint
ALTER TABLE "party_reservation_snacks" ADD COLUMN "included_in_package" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "party_reservation_socks" ADD COLUMN "issued_quantity" integer;--> statement-breakpoint
ALTER TABLE "party_reservation_socks" ADD COLUMN "included_in_package" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "party_packages" ADD CONSTRAINT "party_packages_included_consumables_array_ck" CHECK ("party_packages"."included_consumables" is null or jsonb_typeof("party_packages"."included_consumables") = 'array');--> statement-breakpoint
ALTER TABLE "party_reservation_snacks" ADD CONSTRAINT "party_reservation_snacks_stock_deducted_ck" CHECK ("party_reservation_snacks"."stock_deducted" in ('pending', 'deducted', 'not_applicable'));--> statement-breakpoint
ALTER TABLE "party_reservation_snacks" ADD CONSTRAINT "party_reservation_snacks_stock_deducted_at_ck" CHECK (("party_reservation_snacks"."stock_deducted" = 'deducted') = ("party_reservation_snacks"."stock_deducted_at" is not null));--> statement-breakpoint
ALTER TABLE "party_reservation_snacks" ADD CONSTRAINT "party_reservation_snacks_issued_quantity_ck" CHECK (("party_reservation_snacks"."stock_deducted" = 'deducted') = ("party_reservation_snacks"."issued_quantity" is not null));--> statement-breakpoint
ALTER TABLE "party_reservation_snacks" ADD CONSTRAINT "party_reservation_snacks_issued_quantity_positive_ck" CHECK ("party_reservation_snacks"."issued_quantity" is null or "party_reservation_snacks"."issued_quantity" > 0);--> statement-breakpoint
ALTER TABLE "party_reservation_socks" ADD CONSTRAINT "party_reservation_socks_issued_quantity_ck" CHECK (("party_reservation_socks"."stock_deducted" = 'deducted') = ("party_reservation_socks"."issued_quantity" is not null));--> statement-breakpoint
ALTER TABLE "party_reservation_socks" ADD CONSTRAINT "party_reservation_socks_issued_quantity_positive_ck" CHECK ("party_reservation_socks"."issued_quantity" is null or "party_reservation_socks"."issued_quantity" > 0);