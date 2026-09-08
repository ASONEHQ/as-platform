CREATE TABLE "held_sale_carts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"cash_register_id" uuid,
	"customer_id" uuid,
	"label" text,
	"items" jsonb NOT NULL,
	"status" text DEFAULT 'held' NOT NULL,
	"created_by" uuid NOT NULL,
	"claimed_at" timestamp with time zone,
	"claimed_by" uuid,
	"resumed_at" timestamp with time zone,
	"resumed_by" uuid,
	"resumed_sale_id" uuid,
	"discarded_at" timestamp with time zone,
	"discarded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "held_sale_carts_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "held_sale_carts_status_ck" CHECK ("held_sale_carts"."status" in ('held', 'resuming', 'resumed', 'discarded')),
	CONSTRAINT "held_sale_carts_items_array_ck" CHECK (jsonb_typeof("held_sale_carts"."items") = 'array'),
	CONSTRAINT "held_sale_carts_items_nonempty_ck" CHECK (jsonb_array_length("held_sale_carts"."items") > 0),
	CONSTRAINT "held_sale_carts_claimed_fields_ck" CHECK ("held_sale_carts"."status" not in ('resuming', 'resumed') or ("held_sale_carts"."claimed_at" is not null and "held_sale_carts"."claimed_by" is not null)),
	CONSTRAINT "held_sale_carts_resumed_fields_ck" CHECK (("held_sale_carts"."status" = 'resumed') = ("held_sale_carts"."resumed_at" is not null and "held_sale_carts"."resumed_by" is not null and "held_sale_carts"."resumed_sale_id" is not null)),
	CONSTRAINT "held_sale_carts_discarded_fields_ck" CHECK (("held_sale_carts"."status" = 'discarded') = ("held_sale_carts"."discarded_at" is not null and "held_sale_carts"."discarded_by" is not null))
);
--> statement-breakpoint
CREATE TABLE "party_packages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"price" numeric(19, 4) NOT NULL,
	"currency_code" char(3) NOT NULL,
	"duration_minutes" integer NOT NULL,
	"children_included" integer DEFAULT 0 NOT NULL,
	"adults_included" integer DEFAULT 0 NOT NULL,
	"child_extra_cost" numeric(19, 4) DEFAULT 0 NOT NULL,
	"adult_extra_cost" numeric(19, 4) DEFAULT 0 NOT NULL,
	"capacity_max" integer,
	"extra_half_hour_cost" numeric(19, 4) DEFAULT 0 NOT NULL,
	"includes" jsonb,
	"restrictions" jsonb,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "party_packages_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "party_packages_code_nonblank_ck" CHECK (length(btrim("party_packages"."code")) > 0),
	CONSTRAINT "party_packages_name_nonblank_ck" CHECK (length(btrim("party_packages"."name")) > 0),
	CONSTRAINT "party_packages_status_ck" CHECK ("party_packages"."status" in ('active', 'inactive')),
	CONSTRAINT "party_packages_price_nonnegative_ck" CHECK ("party_packages"."price" >= 0),
	CONSTRAINT "party_packages_currency_code_ck" CHECK ("party_packages"."currency_code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "party_packages_duration_positive_ck" CHECK ("party_packages"."duration_minutes" > 0),
	CONSTRAINT "party_packages_children_included_ck" CHECK ("party_packages"."children_included" >= 0),
	CONSTRAINT "party_packages_adults_included_ck" CHECK ("party_packages"."adults_included" >= 0),
	CONSTRAINT "party_packages_child_extra_cost_ck" CHECK ("party_packages"."child_extra_cost" >= 0),
	CONSTRAINT "party_packages_adult_extra_cost_ck" CHECK ("party_packages"."adult_extra_cost" >= 0),
	CONSTRAINT "party_packages_extra_half_hour_cost_ck" CHECK ("party_packages"."extra_half_hour_cost" >= 0),
	CONSTRAINT "party_packages_capacity_max_ck" CHECK ("party_packages"."capacity_max" is null or "party_packages"."capacity_max" >= 0),
	CONSTRAINT "party_packages_version_ck" CHECK ("party_packages"."version" >= 1),
	CONSTRAINT "party_packages_includes_object_ck" CHECK ("party_packages"."includes" is null or jsonb_typeof("party_packages"."includes") = 'object'),
	CONSTRAINT "party_packages_restrictions_object_ck" CHECK ("party_packages"."restrictions" is null or jsonb_typeof("party_packages"."restrictions") = 'object')
);
--> statement-breakpoint
CREATE TABLE "party_reservation_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"document_type" text NOT NULL,
	"generated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "party_reservation_documents_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "party_reservation_documents_type_ck" CHECK ("party_reservation_documents"."document_type" in ('waiver', 'contract'))
);
--> statement-breakpoint
CREATE TABLE "party_reservation_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"cash_movement_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"amount_snapshot" numeric(19, 4) NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "party_reservation_payments_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "party_reservation_payments_movement_uq" UNIQUE("company_id","cash_movement_id"),
	CONSTRAINT "party_reservation_payments_purpose_ck" CHECK ("party_reservation_payments"."purpose" in ('deposit', 'balance', 'additional')),
	CONSTRAINT "party_reservation_payments_amount_positive_ck" CHECK ("party_reservation_payments"."amount_snapshot" > 0)
);
--> statement-breakpoint
CREATE TABLE "party_reservation_snacks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"product_id" uuid,
	"name_snapshot" text NOT NULL,
	"unit_price_snapshot" numeric(19, 4) NOT NULL,
	"quantity" numeric(19, 6) NOT NULL,
	"line_total" numeric(19, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "party_reservation_snacks_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "party_reservation_snacks_name_nonblank_ck" CHECK (length(btrim("party_reservation_snacks"."name_snapshot")) > 0),
	CONSTRAINT "party_reservation_snacks_unit_price_ck" CHECK ("party_reservation_snacks"."unit_price_snapshot" >= 0),
	CONSTRAINT "party_reservation_snacks_quantity_positive_ck" CHECK ("party_reservation_snacks"."quantity" > 0),
	CONSTRAINT "party_reservation_snacks_line_total_ck" CHECK ("party_reservation_snacks"."line_total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "party_reservation_socks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"size" text NOT NULL,
	"quantity" integer NOT NULL,
	"product_variant_id" uuid,
	"stock_deducted" text DEFAULT 'pending' NOT NULL,
	"stock_deducted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "party_reservation_socks_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "party_reservation_socks_size_nonblank_ck" CHECK (length(btrim("party_reservation_socks"."size")) > 0),
	CONSTRAINT "party_reservation_socks_quantity_positive_ck" CHECK ("party_reservation_socks"."quantity" > 0),
	CONSTRAINT "party_reservation_socks_stock_deducted_ck" CHECK ("party_reservation_socks"."stock_deducted" in ('pending', 'deducted', 'not_applicable')),
	CONSTRAINT "party_reservation_socks_stock_deducted_at_ck" CHECK (("party_reservation_socks"."stock_deducted" = 'deducted') = ("party_reservation_socks"."stock_deducted_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "party_reservations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"reservation_number" text NOT NULL,
	"customer_id" uuid,
	"customer_display_name" text,
	"customer_phone" text,
	"celebrant_name" text,
	"celebrant_age" integer,
	"room_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"event_date" date NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"children_count" integer DEFAULT 0 NOT NULL,
	"seller_user_id" uuid,
	"status" text DEFAULT 'held' NOT NULL,
	"account_status" text DEFAULT 'open' NOT NULL,
	"quoted_total" numeric(19, 4) NOT NULL,
	"currency_code" char(3) NOT NULL,
	"notes" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancellation_reason" text,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "party_reservations_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "party_reservations_company_branch_id_uq" UNIQUE("company_id","branch_id","id"),
	CONSTRAINT "party_reservations_reservation_number_nonblank_ck" CHECK (length(btrim("party_reservations"."reservation_number")) > 0),
	CONSTRAINT "party_reservations_status_ck" CHECK ("party_reservations"."status" in ('held', 'pending_deposit', 'confirmed', 'completed', 'cancelled')),
	CONSTRAINT "party_reservations_account_status_ck" CHECK ("party_reservations"."account_status" in ('open', 'closed')),
	CONSTRAINT "party_reservations_children_count_ck" CHECK ("party_reservations"."children_count" >= 0),
	CONSTRAINT "party_reservations_quoted_total_ck" CHECK ("party_reservations"."quoted_total" >= 0),
	CONSTRAINT "party_reservations_currency_code_ck" CHECK ("party_reservations"."currency_code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "party_reservations_celebrant_age_ck" CHECK ("party_reservations"."celebrant_age" is null or "party_reservations"."celebrant_age" >= 0),
	CONSTRAINT "party_reservations_end_after_start_ck" CHECK ("party_reservations"."end_time" > "party_reservations"."start_time"),
	CONSTRAINT "party_reservations_customer_display_name_ck" CHECK ("party_reservations"."customer_id" is null or ("party_reservations"."customer_display_name" is not null and length(btrim("party_reservations"."customer_display_name")) > 0)),
	CONSTRAINT "party_reservations_cancellation_fields_ck" CHECK (("party_reservations"."status" <> 'cancelled' and "party_reservations"."cancelled_at" is null and "party_reservations"."cancelled_by" is null and "party_reservations"."cancellation_reason" is null)
        or ("party_reservations"."status" = 'cancelled' and "party_reservations"."cancelled_at" is not null and "party_reservations"."cancelled_by" is not null and "party_reservations"."cancellation_reason" is not null)),
	CONSTRAINT "party_reservations_version_ck" CHECK ("party_reservations"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "party_rooms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"capacity_children" integer,
	"capacity_adults" integer,
	"capacity_total" integer,
	"color" text,
	"notes" text,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "party_rooms_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "party_rooms_company_branch_id_uq" UNIQUE("company_id","branch_id","id"),
	CONSTRAINT "party_rooms_code_nonblank_ck" CHECK (length(btrim("party_rooms"."code")) > 0),
	CONSTRAINT "party_rooms_name_nonblank_ck" CHECK (length(btrim("party_rooms"."name")) > 0),
	CONSTRAINT "party_rooms_status_ck" CHECK ("party_rooms"."status" in ('active', 'maintenance', 'out_of_service')),
	CONSTRAINT "party_rooms_capacity_children_ck" CHECK ("party_rooms"."capacity_children" is null or "party_rooms"."capacity_children" >= 0),
	CONSTRAINT "party_rooms_capacity_adults_ck" CHECK ("party_rooms"."capacity_adults" is null or "party_rooms"."capacity_adults" >= 0),
	CONSTRAINT "party_rooms_capacity_total_ck" CHECK ("party_rooms"."capacity_total" is null or "party_rooms"."capacity_total" >= 0),
	CONSTRAINT "party_rooms_version_ck" CHECK ("party_rooms"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "direct_purchases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"supplier_name" text,
	"product_variant_id" uuid NOT NULL,
	"quantity" numeric(19, 6) NOT NULL,
	"unit_cost" numeric(19, 4) NOT NULL,
	"currency_code" text NOT NULL,
	"total_cost" numeric(19, 4) NOT NULL,
	"purchase_date" text NOT NULL,
	"notes" text,
	"inventory_movement_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "direct_purchases_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "direct_purchases_movement_uq" UNIQUE("company_id","inventory_movement_id"),
	CONSTRAINT "direct_purchases_quantity_positive_ck" CHECK ("direct_purchases"."quantity" > 0),
	CONSTRAINT "direct_purchases_unit_cost_nonnegative_ck" CHECK ("direct_purchases"."unit_cost" >= 0),
	CONSTRAINT "direct_purchases_currency_code_ck" CHECK ("direct_purchases"."currency_code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "direct_purchases_total_cost_nonnegative_ck" CHECK ("direct_purchases"."total_cost" >= 0)
);
--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "held_sale_carts" ADD CONSTRAINT "held_sale_carts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "held_sale_carts" ADD CONSTRAINT "held_sale_carts_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "held_sale_carts" ADD CONSTRAINT "held_sale_carts_register_scope_fk" FOREIGN KEY ("company_id","branch_id","cash_register_id") REFERENCES "public"."cash_registers"("company_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "held_sale_carts" ADD CONSTRAINT "held_sale_carts_customer_scope_fk" FOREIGN KEY ("company_id","customer_id") REFERENCES "public"."customers"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "held_sale_carts" ADD CONSTRAINT "held_sale_carts_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "held_sale_carts" ADD CONSTRAINT "held_sale_carts_claimed_by_membership_fk" FOREIGN KEY ("company_id","claimed_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "held_sale_carts" ADD CONSTRAINT "held_sale_carts_resumed_by_membership_fk" FOREIGN KEY ("company_id","resumed_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "held_sale_carts" ADD CONSTRAINT "held_sale_carts_discarded_by_membership_fk" FOREIGN KEY ("company_id","discarded_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_packages" ADD CONSTRAINT "party_packages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_packages" ADD CONSTRAINT "party_packages_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_packages" ADD CONSTRAINT "party_packages_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_packages" ADD CONSTRAINT "party_packages_updated_by_membership_fk" FOREIGN KEY ("company_id","updated_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_reservation_documents" ADD CONSTRAINT "party_reservation_documents_reservation_scope_fk" FOREIGN KEY ("company_id","reservation_id") REFERENCES "public"."party_reservations"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_reservation_documents" ADD CONSTRAINT "party_reservation_documents_generated_by_membership_fk" FOREIGN KEY ("company_id","generated_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_reservation_payments" ADD CONSTRAINT "party_reservation_payments_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_reservation_payments" ADD CONSTRAINT "party_reservation_payments_reservation_scope_fk" FOREIGN KEY ("company_id","reservation_id") REFERENCES "public"."party_reservations"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_reservation_payments" ADD CONSTRAINT "party_reservation_payments_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_reservation_snacks" ADD CONSTRAINT "party_reservation_snacks_reservation_scope_fk" FOREIGN KEY ("company_id","reservation_id") REFERENCES "public"."party_reservations"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_reservation_socks" ADD CONSTRAINT "party_reservation_socks_reservation_scope_fk" FOREIGN KEY ("company_id","reservation_id") REFERENCES "public"."party_reservations"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_reservations" ADD CONSTRAINT "party_reservations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_reservations" ADD CONSTRAINT "party_reservations_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_reservations" ADD CONSTRAINT "party_reservations_customer_scope_fk" FOREIGN KEY ("company_id","customer_id") REFERENCES "public"."customers"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_reservations" ADD CONSTRAINT "party_reservations_room_scope_fk" FOREIGN KEY ("company_id","branch_id","room_id") REFERENCES "public"."party_rooms"("company_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_reservations" ADD CONSTRAINT "party_reservations_package_scope_fk" FOREIGN KEY ("company_id","package_id") REFERENCES "public"."party_packages"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_reservations" ADD CONSTRAINT "party_reservations_seller_membership_fk" FOREIGN KEY ("company_id","seller_user_id") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_reservations" ADD CONSTRAINT "party_reservations_cancelled_by_membership_fk" FOREIGN KEY ("company_id","cancelled_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_reservations" ADD CONSTRAINT "party_reservations_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_reservations" ADD CONSTRAINT "party_reservations_updated_by_membership_fk" FOREIGN KEY ("company_id","updated_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_rooms" ADD CONSTRAINT "party_rooms_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_rooms" ADD CONSTRAINT "party_rooms_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_rooms" ADD CONSTRAINT "party_rooms_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_rooms" ADD CONSTRAINT "party_rooms_updated_by_membership_fk" FOREIGN KEY ("company_id","updated_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_purchases" ADD CONSTRAINT "direct_purchases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_purchases" ADD CONSTRAINT "direct_purchases_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_purchases" ADD CONSTRAINT "direct_purchases_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "held_sale_carts_company_branch_status_idx" ON "held_sale_carts" USING btree ("company_id","branch_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "party_packages_company_code_uq" ON "party_packages" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "party_packages_company_branch_idx" ON "party_packages" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE INDEX "party_packages_company_status_idx" ON "party_packages" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "party_reservation_documents_reservation_idx" ON "party_reservation_documents" USING btree ("company_id","reservation_id");--> statement-breakpoint
CREATE INDEX "party_reservation_payments_reservation_idx" ON "party_reservation_payments" USING btree ("company_id","reservation_id");--> statement-breakpoint
CREATE INDEX "party_reservation_snacks_reservation_idx" ON "party_reservation_snacks" USING btree ("company_id","reservation_id");--> statement-breakpoint
CREATE INDEX "party_reservation_socks_reservation_idx" ON "party_reservation_socks" USING btree ("company_id","reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "party_reservations_company_number_uq" ON "party_reservations" USING btree ("company_id","reservation_number");--> statement-breakpoint
CREATE INDEX "party_reservations_company_branch_idx" ON "party_reservations" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE INDEX "party_reservations_company_status_idx" ON "party_reservations" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "party_reservations_company_customer_idx" ON "party_reservations" USING btree ("company_id","customer_id");--> statement-breakpoint
CREATE INDEX "party_reservations_company_room_date_idx" ON "party_reservations" USING btree ("company_id","room_id","event_date");--> statement-breakpoint
CREATE UNIQUE INDEX "party_rooms_company_branch_code_uq" ON "party_rooms" USING btree ("company_id","branch_id","code");--> statement-breakpoint
CREATE INDEX "party_rooms_company_branch_idx" ON "party_rooms" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE INDEX "party_rooms_company_status_idx" ON "party_rooms" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "direct_purchases_company_branch_idx" ON "direct_purchases" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE INDEX "direct_purchases_company_variant_idx" ON "direct_purchases" USING btree ("company_id","product_variant_id");--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_note_length_ck" CHECK ("sales"."note" is null or length("sales"."note") <= 2000);
-- TASK 14.3 (Wave 1, Part A.5) — real, database-enforced room-conflict
-- prevention (docs/LEGACY_FIESTAS_RECOVERY.md Capability 2). btree_gist
-- is the standard, supported Postgres extension providing an equality
-- operator class usable inside a GIST exclusion constraint alongside a
-- range-overlap operator — the standard mechanism for "no two rows with
-- equal keys may have overlapping ranges," never a bespoke conflict
-- algorithm invented in application code alone. Application code
-- (`PartyReservationsService`) additionally takes a `SELECT ... FOR
-- UPDATE` row lock on the target room before insert/update, purely to
-- turn a rejected-by-constraint race into a clean, friendly application
-- error rather than a raw Postgres exception — this constraint is the
-- actual last-line guarantee, race-free even if that application-level
-- lock were somehow bypassed.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
-- `date + time` uses Postgres's own native, IMMUTABLE date/time
-- arithmetic operators (never a text-parse-then-cast, which Postgres
-- correctly refuses inside an index/exclusion expression as STABLE at
-- best, not IMMUTABLE — confirmed live: the text-concatenation version
-- of this constraint failed to apply with exactly that error).
ALTER TABLE "party_reservations" ADD CONSTRAINT "party_reservations_room_time_excl"
  EXCLUDE USING gist (
    company_id WITH =,
    room_id WITH =,
    event_date WITH =,
    tsrange(
      (event_date + start_time),
      (event_date + end_time),
      '[)'
    ) WITH &&
  )
  WHERE (status <> 'cancelled');
