CREATE TABLE "party_quotes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"quote_number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"customer_id" uuid,
	"customer_display_name" text,
	"customer_phone" text,
	"seller_user_id" uuid,
	"package_id" uuid NOT NULL,
	"package_snapshot" jsonb NOT NULL,
	"children_count" integer DEFAULT 0 NOT NULL,
	"adults_count" integer DEFAULT 0 NOT NULL,
	"extra_half_hours" integer DEFAULT 0 NOT NULL,
	"currency_code" char(3) NOT NULL,
	"subtotal_amount" numeric(19, 4) NOT NULL,
	"discount_total" numeric(19, 4) DEFAULT 0 NOT NULL,
	"tax_total" numeric(19, 4) NOT NULL,
	"total_amount" numeric(19, 4) NOT NULL,
	"breakdown" jsonb NOT NULL,
	"room_id" uuid,
	"event_date" date,
	"start_time" time,
	"notes" text,
	"converted_reservation_id" uuid,
	"converted_at" timestamp with time zone,
	"converted_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancel_reason" text,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "party_quotes_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "party_quotes_company_quote_number_uq" UNIQUE("company_id","quote_number"),
	CONSTRAINT "party_quotes_status_ck" CHECK ("party_quotes"."status" in ('draft', 'cancelled', 'converted')),
	CONSTRAINT "party_quotes_counts_ck" CHECK ("party_quotes"."children_count" >= 0 and "party_quotes"."adults_count" >= 0 and "party_quotes"."extra_half_hours" >= 0),
	CONSTRAINT "party_quotes_amounts_ck" CHECK ("party_quotes"."subtotal_amount" >= 0 and "party_quotes"."discount_total" >= 0 and "party_quotes"."tax_total" >= 0 and "party_quotes"."total_amount" >= 0),
	CONSTRAINT "party_quotes_currency_code_ck" CHECK ("party_quotes"."currency_code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "party_quotes_converted_fields_ck" CHECK (("party_quotes"."status" = 'converted') = ("party_quotes"."converted_reservation_id" is not null and "party_quotes"."converted_at" is not null and "party_quotes"."converted_by" is not null)),
	CONSTRAINT "party_quotes_cancelled_fields_ck" CHECK (("party_quotes"."status" = 'cancelled') = ("party_quotes"."cancelled_at" is not null and "party_quotes"."cancelled_by" is not null and "party_quotes"."cancel_reason" is not null)),
	CONSTRAINT "party_quotes_cancel_reason_ck" CHECK ("party_quotes"."cancel_reason" is null or char_length(btrim("party_quotes"."cancel_reason")) between 3 and 500)
);
--> statement-breakpoint
ALTER TABLE "party_quotes" ADD CONSTRAINT "party_quotes_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_quotes" ADD CONSTRAINT "party_quotes_customer_scope_fk" FOREIGN KEY ("company_id","customer_id") REFERENCES "public"."customers"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_quotes" ADD CONSTRAINT "party_quotes_package_scope_fk" FOREIGN KEY ("company_id","package_id") REFERENCES "public"."party_packages"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_quotes" ADD CONSTRAINT "party_quotes_room_scope_fk" FOREIGN KEY ("company_id","branch_id","room_id") REFERENCES "public"."party_rooms"("company_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_quotes" ADD CONSTRAINT "party_quotes_converted_reservation_scope_fk" FOREIGN KEY ("company_id","converted_reservation_id") REFERENCES "public"."party_reservations"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_quotes" ADD CONSTRAINT "party_quotes_seller_membership_fk" FOREIGN KEY ("company_id","seller_user_id") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_quotes" ADD CONSTRAINT "party_quotes_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_quotes" ADD CONSTRAINT "party_quotes_updated_by_membership_fk" FOREIGN KEY ("company_id","updated_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_quotes" ADD CONSTRAINT "party_quotes_converted_by_membership_fk" FOREIGN KEY ("company_id","converted_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_quotes" ADD CONSTRAINT "party_quotes_cancelled_by_membership_fk" FOREIGN KEY ("company_id","cancelled_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "party_quotes_converted_reservation_uq" ON "party_quotes" USING btree ("company_id","converted_reservation_id") WHERE "party_quotes"."converted_reservation_id" is not null;--> statement-breakpoint
CREATE INDEX "party_quotes_company_branch_created_idx" ON "party_quotes" USING btree ("company_id","branch_id","created_at");--> statement-breakpoint
CREATE INDEX "party_quotes_company_status_idx" ON "party_quotes" USING btree ("company_id","status");