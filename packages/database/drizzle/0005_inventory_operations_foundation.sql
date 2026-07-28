CREATE TABLE "inventory_balances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"inventory_location_id" uuid NOT NULL,
	"product_variant_id" uuid NOT NULL,
	"quantity_on_hand" numeric(19, 6) DEFAULT '0' NOT NULL,
	"quantity_reserved" numeric(19, 6) DEFAULT '0' NOT NULL,
	"quantity_in_transit" numeric(19, 6) DEFAULT '0' NOT NULL,
	"average_unit_cost" numeric(19, 4) DEFAULT '0' NOT NULL,
	"currency_code" char(3),
	"version" bigint DEFAULT 1 NOT NULL,
	"last_movement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_balances_company_location_variant_uq" UNIQUE("company_id","inventory_location_id","product_variant_id"),
	CONSTRAINT "inventory_balances_on_hand_ck" CHECK ("inventory_balances"."quantity_on_hand" >= 0),
	CONSTRAINT "inventory_balances_reserved_ck" CHECK ("inventory_balances"."quantity_reserved" >= 0),
	CONSTRAINT "inventory_balances_in_transit_ck" CHECK ("inventory_balances"."quantity_in_transit" >= 0),
	CONSTRAINT "inventory_balances_reserved_on_hand_ck" CHECK ("inventory_balances"."quantity_reserved" <= "inventory_balances"."quantity_on_hand"),
	CONSTRAINT "inventory_balances_average_cost_ck" CHECK ("inventory_balances"."average_unit_cost" >= 0),
	CONSTRAINT "inventory_balances_currency_ck" CHECK (("inventory_balances"."average_unit_cost" = 0 and "inventory_balances"."currency_code" is null)
        or ("inventory_balances"."currency_code" is not null and "inventory_balances"."currency_code" ~ '^[A-Z]{3}$')),
	CONSTRAINT "inventory_balances_version_ck" CHECK ("inventory_balances"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "inventory_locations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"code" varchar(64) NOT NULL,
	"normalized_code" varchar(64) NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" varchar(1000),
	"location_type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"allows_receiving" boolean DEFAULT true NOT NULL,
	"allows_issuing" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	CONSTRAINT "inventory_locations_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "inventory_locations_company_branch_id_id_uq" UNIQUE("company_id","branch_id","id"),
	CONSTRAINT "inventory_locations_code_nonblank_ck" CHECK (length(btrim("inventory_locations"."code")) > 0),
	CONSTRAINT "inventory_locations_normalized_code_ck" CHECK (length("inventory_locations"."normalized_code") > 0 and "inventory_locations"."normalized_code" = lower(btrim("inventory_locations"."normalized_code"))),
	CONSTRAINT "inventory_locations_name_nonblank_ck" CHECK (length(btrim("inventory_locations"."name")) > 0),
	CONSTRAINT "inventory_locations_type_ck" CHECK ("inventory_locations"."location_type" in ('main','sales_floor','cafeteria','event_storage','damaged','returns','transit','virtual')),
	CONSTRAINT "inventory_locations_status_ck" CHECK ("inventory_locations"."status" in ('active','inactive','retired')),
	CONSTRAINT "inventory_locations_version_ck" CHECK ("inventory_locations"."version" >= 1),
	CONSTRAINT "inventory_locations_retirement_ck" CHECK (("inventory_locations"."status" = 'retired' and "inventory_locations"."deleted_at" is not null)
        or ("inventory_locations"."status" <> 'retired' and "inventory_locations"."deleted_at" is null)),
	CONSTRAINT "inventory_locations_direction_flags_ck" CHECK (("inventory_locations"."status" = 'active' or (not "inventory_locations"."allows_receiving" and not "inventory_locations"."allows_issuing"))
        and ("inventory_locations"."location_type" <> 'virtual' or (not "inventory_locations"."allows_receiving" and not "inventory_locations"."allows_issuing"))),
	CONSTRAINT "inventory_locations_default_active_ck" CHECK (not "inventory_locations"."is_default" or ("inventory_locations"."status" = 'active' and "inventory_locations"."deleted_at" is null))
);
--> statement-breakpoint
CREATE TABLE "inventory_movement_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"inventory_movement_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"product_variant_id" uuid NOT NULL,
	"source_location_id" uuid,
	"destination_location_id" uuid,
	"quantity" numeric(19, 6) NOT NULL,
	"unit_of_measure_code" text NOT NULL,
	"base_quantity" numeric(19, 6) NOT NULL,
	"unit_cost" numeric(19, 4),
	"extended_cost" numeric(19, 4),
	"currency_code" char(3),
	"reason_code" varchar(64),
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_movement_lines_company_movement_line_uq" UNIQUE("company_id","inventory_movement_id","line_number"),
	CONSTRAINT "inventory_movement_lines_line_number_ck" CHECK ("inventory_movement_lines"."line_number" >= 1),
	CONSTRAINT "inventory_movement_lines_quantity_ck" CHECK ("inventory_movement_lines"."quantity" > 0),
	CONSTRAINT "inventory_movement_lines_base_quantity_ck" CHECK ("inventory_movement_lines"."base_quantity" > 0),
	CONSTRAINT "inventory_movement_lines_direction_ck" CHECK (("inventory_movement_lines"."source_location_id" is not null or "inventory_movement_lines"."destination_location_id" is not null)
        and ("inventory_movement_lines"."source_location_id" is null or "inventory_movement_lines"."destination_location_id" is null or "inventory_movement_lines"."source_location_id" <> "inventory_movement_lines"."destination_location_id")),
	CONSTRAINT "inventory_movement_lines_cost_ck" CHECK ("inventory_movement_lines"."unit_cost" is null or "inventory_movement_lines"."unit_cost" >= 0),
	CONSTRAINT "inventory_movement_lines_extended_cost_ck" CHECK ("inventory_movement_lines"."extended_cost" is null or "inventory_movement_lines"."extended_cost" >= 0),
	CONSTRAINT "inventory_movement_lines_cost_currency_ck" CHECK (("inventory_movement_lines"."unit_cost" is null and "inventory_movement_lines"."extended_cost" is null and "inventory_movement_lines"."currency_code" is null)
        or ("inventory_movement_lines"."unit_cost" is not null and "inventory_movement_lines"."extended_cost" is not null and "inventory_movement_lines"."currency_code" ~ '^[A-Z]{3}$')),
	CONSTRAINT "inventory_movement_lines_metadata_ck" CHECK ("inventory_movement_lines"."metadata" is null
        or (jsonb_typeof("inventory_movement_lines"."metadata") = 'object' and octet_length("inventory_movement_lines"."metadata"::text) <= 8192))
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"movement_number" varchar(64) NOT NULL,
	"movement_type" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"reason_code" varchar(64),
	"reference_type" varchar(64),
	"reference_id" uuid,
	"source_document_number" varchar(128),
	"notes" varchar(2000),
	"version" bigint DEFAULT 1 NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"posted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"reversed_at" timestamp with time zone,
	"reversal_of_movement_id" uuid,
	"reversed_by_movement_id" uuid,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"posted_by" uuid,
	"cancelled_by" uuid,
	"reversed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_movements_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "inventory_movements_company_number_uq" UNIQUE("company_id","movement_number"),
	CONSTRAINT "inventory_movements_number_nonblank_ck" CHECK (length(btrim("inventory_movements"."movement_number")) > 0),
	CONSTRAINT "inventory_movements_type_ck" CHECK ("inventory_movements"."movement_type" in ('opening_balance','receipt','issue','return','adjustment','transfer_shipment','transfer_receipt','reversal')),
	CONSTRAINT "inventory_movements_status_ck" CHECK ("inventory_movements"."status" in ('draft','pending','posted','cancelled','reversed')),
	CONSTRAINT "inventory_movements_version_ck" CHECK ("inventory_movements"."version" >= 1),
	CONSTRAINT "inventory_movements_reference_pair_ck" CHECK (("inventory_movements"."reference_type" is null) = ("inventory_movements"."reference_id" is null)),
	CONSTRAINT "inventory_movements_reversal_type_ck" CHECK (("inventory_movements"."movement_type" = 'reversal') = ("inventory_movements"."reversal_of_movement_id" is not null)),
	CONSTRAINT "inventory_movements_not_self_reversal_ck" CHECK (("inventory_movements"."reversal_of_movement_id" is null or "inventory_movements"."reversal_of_movement_id" <> "inventory_movements"."id")
        and ("inventory_movements"."reversed_by_movement_id" is null or "inventory_movements"."reversed_by_movement_id" <> "inventory_movements"."id")),
	CONSTRAINT "inventory_movements_lifecycle_ck" CHECK (("inventory_movements"."status" in ('draft','pending')
          and "inventory_movements"."posted_at" is null and "inventory_movements"."posted_by" is null
          and "inventory_movements"."cancelled_at" is null and "inventory_movements"."cancelled_by" is null
          and "inventory_movements"."reversed_at" is null and "inventory_movements"."reversed_by" is null
          and "inventory_movements"."reversed_by_movement_id" is null)
        or ("inventory_movements"."status" = 'posted'
          and "inventory_movements"."posted_at" is not null and "inventory_movements"."posted_by" is not null
          and "inventory_movements"."cancelled_at" is null and "inventory_movements"."cancelled_by" is null
          and "inventory_movements"."reversed_at" is null and "inventory_movements"."reversed_by" is null
          and "inventory_movements"."reversed_by_movement_id" is null)
        or ("inventory_movements"."status" = 'cancelled'
          and "inventory_movements"."posted_at" is null and "inventory_movements"."posted_by" is null
          and "inventory_movements"."cancelled_at" is not null and "inventory_movements"."cancelled_by" is not null
          and "inventory_movements"."reversed_at" is null and "inventory_movements"."reversed_by" is null
          and "inventory_movements"."reversed_by_movement_id" is null)
        or ("inventory_movements"."status" = 'reversed'
          and "inventory_movements"."posted_at" is not null and "inventory_movements"."posted_by" is not null
          and "inventory_movements"."cancelled_at" is null and "inventory_movements"."cancelled_by" is null
          and "inventory_movements"."reversed_at" is not null and "inventory_movements"."reversed_by" is not null
          and "inventory_movements"."reversed_by_movement_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_location_scope_fk" FOREIGN KEY ("company_id","branch_id","inventory_location_id") REFERENCES "public"."inventory_locations"("company_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_variant_scope_fk" FOREIGN KEY ("company_id","product_variant_id") REFERENCES "public"."product_variants"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_last_movement_scope_fk" FOREIGN KEY ("company_id","last_movement_id") REFERENCES "public"."inventory_movements"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_locations" ADD CONSTRAINT "inventory_locations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_locations" ADD CONSTRAINT "inventory_locations_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_locations" ADD CONSTRAINT "inventory_locations_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_locations" ADD CONSTRAINT "inventory_locations_updated_by_membership_fk" FOREIGN KEY ("company_id","updated_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movement_lines" ADD CONSTRAINT "inventory_movement_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movement_lines" ADD CONSTRAINT "inventory_movement_lines_unit_of_measure_code_units_of_measure_code_fk" FOREIGN KEY ("unit_of_measure_code") REFERENCES "public"."units_of_measure"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movement_lines" ADD CONSTRAINT "inventory_movement_lines_movement_scope_fk" FOREIGN KEY ("company_id","inventory_movement_id") REFERENCES "public"."inventory_movements"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movement_lines" ADD CONSTRAINT "inventory_movement_lines_variant_scope_fk" FOREIGN KEY ("company_id","product_variant_id") REFERENCES "public"."product_variants"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movement_lines" ADD CONSTRAINT "inventory_movement_lines_source_scope_fk" FOREIGN KEY ("company_id","source_location_id") REFERENCES "public"."inventory_locations"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movement_lines" ADD CONSTRAINT "inventory_movement_lines_destination_scope_fk" FOREIGN KEY ("company_id","destination_location_id") REFERENCES "public"."inventory_locations"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_reversal_of_scope_fk" FOREIGN KEY ("company_id","reversal_of_movement_id") REFERENCES "public"."inventory_movements"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_reversed_by_scope_fk" FOREIGN KEY ("company_id","reversed_by_movement_id") REFERENCES "public"."inventory_movements"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_updated_by_membership_fk" FOREIGN KEY ("company_id","updated_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_posted_by_membership_fk" FOREIGN KEY ("company_id","posted_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_cancelled_by_membership_fk" FOREIGN KEY ("company_id","cancelled_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_reversed_by_membership_fk" FOREIGN KEY ("company_id","reversed_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_balances_company_variant_idx" ON "inventory_balances" USING btree ("company_id","product_variant_id");--> statement-breakpoint
CREATE INDEX "inventory_balances_company_location_idx" ON "inventory_balances" USING btree ("company_id","inventory_location_id");--> statement-breakpoint
CREATE INDEX "inventory_balances_branch_idx" ON "inventory_balances" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE INDEX "inventory_balances_availability_idx" ON "inventory_balances" USING btree ("company_id","branch_id",("quantity_on_hand" - "quantity_reserved"));--> statement-breakpoint
CREATE INDEX "inventory_balances_updated_idx" ON "inventory_balances" USING btree ("company_id","updated_at");--> statement-breakpoint
CREATE INDEX "inventory_balances_last_movement_idx" ON "inventory_balances" USING btree ("company_id","last_movement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_locations_company_branch_code_active_uq" ON "inventory_locations" USING btree ("company_id","branch_id","normalized_code") WHERE "inventory_locations"."status" <> 'retired' and "inventory_locations"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_locations_company_branch_default_active_uq" ON "inventory_locations" USING btree ("company_id","branch_id") WHERE "inventory_locations"."is_default" is true and "inventory_locations"."status" = 'active' and "inventory_locations"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "inventory_locations_company_idx" ON "inventory_locations" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "inventory_locations_branch_idx" ON "inventory_locations" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE INDEX "inventory_locations_company_status_idx" ON "inventory_locations" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "inventory_locations_company_type_idx" ON "inventory_locations" USING btree ("company_id","location_type");--> statement-breakpoint
CREATE INDEX "inventory_locations_company_normalized_code_idx" ON "inventory_locations" USING btree ("company_id","normalized_code");--> statement-breakpoint
CREATE INDEX "inventory_locations_active_idx" ON "inventory_locations" USING btree ("company_id","branch_id","location_type") WHERE "inventory_locations"."status" = 'active' and "inventory_locations"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "inventory_movement_lines_movement_idx" ON "inventory_movement_lines" USING btree ("company_id","inventory_movement_id");--> statement-breakpoint
CREATE INDEX "inventory_movement_lines_variant_idx" ON "inventory_movement_lines" USING btree ("company_id","product_variant_id");--> statement-breakpoint
CREATE INDEX "inventory_movement_lines_source_idx" ON "inventory_movement_lines" USING btree ("company_id","source_location_id");--> statement-breakpoint
CREATE INDEX "inventory_movement_lines_destination_idx" ON "inventory_movement_lines" USING btree ("company_id","destination_location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_movements_reversal_of_posted_uq" ON "inventory_movements" USING btree ("company_id","reversal_of_movement_id") WHERE "inventory_movements"."reversal_of_movement_id" is not null and "inventory_movements"."status" in ('posted','reversed');--> statement-breakpoint
CREATE INDEX "inventory_movements_company_idx" ON "inventory_movements" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "inventory_movements_branch_idx" ON "inventory_movements" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE INDEX "inventory_movements_company_type_idx" ON "inventory_movements" USING btree ("company_id","movement_type");--> statement-breakpoint
CREATE INDEX "inventory_movements_company_status_idx" ON "inventory_movements" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "inventory_movements_company_occurred_idx" ON "inventory_movements" USING btree ("company_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "inventory_movements_company_posted_idx" ON "inventory_movements" USING btree ("company_id","posted_at");--> statement-breakpoint
CREATE INDEX "inventory_movements_company_reference_idx" ON "inventory_movements" USING btree ("company_id","reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "inventory_movements_reversal_of_idx" ON "inventory_movements" USING btree ("company_id","reversal_of_movement_id");--> statement-breakpoint
CREATE INDEX "inventory_movements_company_created_idx" ON "inventory_movements" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "inventory_movements_open_idx" ON "inventory_movements" USING btree ("company_id","branch_id","status") WHERE "inventory_movements"."status" in ('draft','pending');--> statement-breakpoint
CREATE INDEX "inventory_movements_posted_date_idx" ON "inventory_movements" USING btree ("company_id","branch_id","posted_at") WHERE "inventory_movements"."status" in ('posted','reversed');--> statement-breakpoint
CREATE INDEX "inventory_movements_unreversed_posted_idx" ON "inventory_movements" USING btree ("company_id","id") WHERE "inventory_movements"."status" = 'posted' and "inventory_movements"."reversed_by_movement_id" is null;
