CREATE TABLE "inventory_reservation_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"inventory_reservation_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"inventory_location_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"product_variant_id" uuid NOT NULL,
	"reserved_quantity" numeric(19, 6) NOT NULL,
	"consumed_quantity" numeric(19, 6) DEFAULT '0' NOT NULL,
	"released_quantity" numeric(19, 6) DEFAULT '0' NOT NULL,
	"unit_of_measure_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_reservation_lines_company_reservation_line_uq" UNIQUE("company_id","inventory_reservation_id","line_number"),
	CONSTRAINT "inventory_reservation_lines_company_reservation_location_variant_uq" UNIQUE("company_id","inventory_reservation_id","inventory_location_id","product_variant_id"),
	CONSTRAINT "inventory_reservation_lines_line_number_ck" CHECK ("inventory_reservation_lines"."line_number" >= 1),
	CONSTRAINT "inventory_reservation_lines_reserved_ck" CHECK ("inventory_reservation_lines"."reserved_quantity" > 0),
	CONSTRAINT "inventory_reservation_lines_consumed_ck" CHECK ("inventory_reservation_lines"."consumed_quantity" >= 0),
	CONSTRAINT "inventory_reservation_lines_released_ck" CHECK ("inventory_reservation_lines"."released_quantity" >= 0),
	CONSTRAINT "inventory_reservation_lines_totals_ck" CHECK ("inventory_reservation_lines"."consumed_quantity" + "inventory_reservation_lines"."released_quantity" <= "inventory_reservation_lines"."reserved_quantity")
);
--> statement-breakpoint
CREATE TABLE "inventory_reservations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"reservation_number" varchar(64) NOT NULL,
	"owner_type" varchar(32) NOT NULL,
	"owner_id" varchar(128) NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"confirmed_by" uuid,
	"released_by" uuid,
	"expired_by" uuid,
	"cancelled_by" uuid,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_reservations_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "inventory_reservations_company_branch_id_id_uq" UNIQUE("company_id","branch_id","id"),
	CONSTRAINT "inventory_reservations_company_number_uq" UNIQUE("company_id","reservation_number"),
	CONSTRAINT "inventory_reservations_number_nonblank_ck" CHECK (length(btrim("inventory_reservations"."reservation_number")) > 0),
	CONSTRAINT "inventory_reservations_owner_type_ck" CHECK ("inventory_reservations"."owner_type" in ('pos_cart','event','booking','order')),
	CONSTRAINT "inventory_reservations_owner_id_ck" CHECK (length(btrim("inventory_reservations"."owner_id")) > 0),
	CONSTRAINT "inventory_reservations_status_ck" CHECK ("inventory_reservations"."status" in ('active','confirmed','released','expired','cancelled')),
	CONSTRAINT "inventory_reservations_version_ck" CHECK ("inventory_reservations"."version" >= 1),
	CONSTRAINT "inventory_reservations_lifecycle_ck" CHECK (("inventory_reservations"."status" = 'active'
          and "inventory_reservations"."confirmed_at" is null and "inventory_reservations"."confirmed_by" is null
          and "inventory_reservations"."released_at" is null and "inventory_reservations"."released_by" is null
          and "inventory_reservations"."expired_at" is null and "inventory_reservations"."expired_by" is null
          and "inventory_reservations"."cancelled_at" is null and "inventory_reservations"."cancelled_by" is null)
        or ("inventory_reservations"."status" = 'confirmed'
          and "inventory_reservations"."confirmed_at" is not null and "inventory_reservations"."confirmed_by" is not null
          and "inventory_reservations"."released_at" is null and "inventory_reservations"."released_by" is null
          and "inventory_reservations"."expired_at" is null and "inventory_reservations"."expired_by" is null
          and "inventory_reservations"."cancelled_at" is null and "inventory_reservations"."cancelled_by" is null)
        or ("inventory_reservations"."status" = 'released'
          and "inventory_reservations"."confirmed_at" is null and "inventory_reservations"."confirmed_by" is null
          and "inventory_reservations"."released_at" is not null and "inventory_reservations"."released_by" is not null
          and "inventory_reservations"."expired_at" is null and "inventory_reservations"."expired_by" is null
          and "inventory_reservations"."cancelled_at" is null and "inventory_reservations"."cancelled_by" is null)
        or ("inventory_reservations"."status" = 'expired'
          and "inventory_reservations"."expires_at" is not null
          and "inventory_reservations"."confirmed_at" is null and "inventory_reservations"."confirmed_by" is null
          and "inventory_reservations"."released_at" is null and "inventory_reservations"."released_by" is null
          and "inventory_reservations"."expired_at" is not null and "inventory_reservations"."expired_by" is not null
          and "inventory_reservations"."cancelled_at" is null and "inventory_reservations"."cancelled_by" is null)
        or ("inventory_reservations"."status" = 'cancelled'
          and "inventory_reservations"."confirmed_at" is null and "inventory_reservations"."confirmed_by" is null
          and "inventory_reservations"."released_at" is null and "inventory_reservations"."released_by" is null
          and "inventory_reservations"."expired_at" is null and "inventory_reservations"."expired_by" is null
          and "inventory_reservations"."cancelled_at" is not null and "inventory_reservations"."cancelled_by" is not null))
);
--> statement-breakpoint
CREATE TABLE "inventory_transfer_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"inventory_transfer_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"product_variant_id" uuid NOT NULL,
	"requested_quantity" numeric(19, 6) NOT NULL,
	"shipped_quantity" numeric(19, 6) DEFAULT '0' NOT NULL,
	"received_quantity" numeric(19, 6) DEFAULT '0' NOT NULL,
	"rejected_quantity" numeric(19, 6) DEFAULT '0' NOT NULL,
	"unit_of_measure_code" text NOT NULL,
	"notes" varchar(2000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_transfer_lines_company_transfer_line_uq" UNIQUE("company_id","inventory_transfer_id","line_number"),
	CONSTRAINT "inventory_transfer_lines_company_transfer_variant_uq" UNIQUE("company_id","inventory_transfer_id","product_variant_id"),
	CONSTRAINT "inventory_transfer_lines_line_number_ck" CHECK ("inventory_transfer_lines"."line_number" >= 1),
	CONSTRAINT "inventory_transfer_lines_requested_ck" CHECK ("inventory_transfer_lines"."requested_quantity" > 0),
	CONSTRAINT "inventory_transfer_lines_shipped_ck" CHECK ("inventory_transfer_lines"."shipped_quantity" >= 0),
	CONSTRAINT "inventory_transfer_lines_received_ck" CHECK ("inventory_transfer_lines"."received_quantity" >= 0),
	CONSTRAINT "inventory_transfer_lines_rejected_ck" CHECK ("inventory_transfer_lines"."rejected_quantity" >= 0),
	CONSTRAINT "inventory_transfer_lines_totals_ck" CHECK ("inventory_transfer_lines"."shipped_quantity" <= "inventory_transfer_lines"."requested_quantity"
        and "inventory_transfer_lines"."received_quantity" + "inventory_transfer_lines"."rejected_quantity" <= "inventory_transfer_lines"."shipped_quantity")
);
--> statement-breakpoint
CREATE TABLE "inventory_transfers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"transfer_number" varchar(64) NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"source_branch_id" uuid NOT NULL,
	"destination_branch_id" uuid NOT NULL,
	"source_location_id" uuid NOT NULL,
	"destination_location_id" uuid NOT NULL,
	"transit_location_id" uuid,
	"requested_at" timestamp with time zone NOT NULL,
	"approved_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"first_received_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"remainder_rejected_at" timestamp with time zone,
	"requested_by" uuid NOT NULL,
	"approved_by" uuid,
	"shipped_by" uuid,
	"received_by" uuid,
	"rejected_by" uuid,
	"cancelled_by" uuid,
	"remainder_rejected_by" uuid,
	"shipment_movement_id" uuid,
	"receipt_movement_id" uuid,
	"notes" varchar(2000),
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_transfers_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "inventory_transfers_company_number_uq" UNIQUE("company_id","transfer_number"),
	CONSTRAINT "inventory_transfers_number_nonblank_ck" CHECK (length(btrim("inventory_transfers"."transfer_number")) > 0),
	CONSTRAINT "inventory_transfers_status_ck" CHECK ("inventory_transfers"."status" in ('requested','approved','shipped','partially_received','received','rejected','cancelled','remainder_rejected')),
	CONSTRAINT "inventory_transfers_locations_different_ck" CHECK ("inventory_transfers"."source_location_id" <> "inventory_transfers"."destination_location_id"
        and ("inventory_transfers"."transit_location_id" is null
          or ("inventory_transfers"."transit_location_id" <> "inventory_transfers"."source_location_id"
            and "inventory_transfers"."transit_location_id" <> "inventory_transfers"."destination_location_id"))),
	CONSTRAINT "inventory_transfers_movements_different_ck" CHECK ("inventory_transfers"."shipment_movement_id" is null or "inventory_transfers"."receipt_movement_id" is null
        or "inventory_transfers"."shipment_movement_id" <> "inventory_transfers"."receipt_movement_id"),
	CONSTRAINT "inventory_transfers_version_ck" CHECK ("inventory_transfers"."version" >= 1),
	CONSTRAINT "inventory_transfers_lifecycle_ck" CHECK (("inventory_transfers"."status" = 'requested'
          and "inventory_transfers"."approved_at" is null and "inventory_transfers"."approved_by" is null
          and "inventory_transfers"."shipped_at" is null and "inventory_transfers"."shipped_by" is null
          and "inventory_transfers"."first_received_at" is null and "inventory_transfers"."received_at" is null and "inventory_transfers"."received_by" is null
          and "inventory_transfers"."rejected_at" is null and "inventory_transfers"."rejected_by" is null
          and "inventory_transfers"."cancelled_at" is null and "inventory_transfers"."cancelled_by" is null
          and "inventory_transfers"."remainder_rejected_at" is null and "inventory_transfers"."remainder_rejected_by" is null)
        or ("inventory_transfers"."status" = 'approved'
          and "inventory_transfers"."approved_at" is not null and "inventory_transfers"."approved_by" is not null
          and "inventory_transfers"."shipped_at" is null and "inventory_transfers"."shipped_by" is null
          and "inventory_transfers"."first_received_at" is null and "inventory_transfers"."received_at" is null and "inventory_transfers"."received_by" is null
          and "inventory_transfers"."rejected_at" is null and "inventory_transfers"."rejected_by" is null
          and "inventory_transfers"."cancelled_at" is null and "inventory_transfers"."cancelled_by" is null
          and "inventory_transfers"."remainder_rejected_at" is null and "inventory_transfers"."remainder_rejected_by" is null)
        or ("inventory_transfers"."status" = 'shipped'
          and "inventory_transfers"."approved_at" is not null and "inventory_transfers"."approved_by" is not null
          and "inventory_transfers"."shipped_at" is not null and "inventory_transfers"."shipped_by" is not null
          and "inventory_transfers"."first_received_at" is null and "inventory_transfers"."received_at" is null and "inventory_transfers"."received_by" is null
          and "inventory_transfers"."rejected_at" is null and "inventory_transfers"."rejected_by" is null
          and "inventory_transfers"."cancelled_at" is null and "inventory_transfers"."cancelled_by" is null
          and "inventory_transfers"."remainder_rejected_at" is null and "inventory_transfers"."remainder_rejected_by" is null)
        or ("inventory_transfers"."status" = 'partially_received'
          and "inventory_transfers"."approved_at" is not null and "inventory_transfers"."approved_by" is not null
          and "inventory_transfers"."shipped_at" is not null and "inventory_transfers"."shipped_by" is not null
          and "inventory_transfers"."first_received_at" is not null and "inventory_transfers"."received_at" is null
          and "inventory_transfers"."rejected_at" is null and "inventory_transfers"."rejected_by" is null
          and "inventory_transfers"."cancelled_at" is null and "inventory_transfers"."cancelled_by" is null
          and "inventory_transfers"."remainder_rejected_at" is null and "inventory_transfers"."remainder_rejected_by" is null)
        or ("inventory_transfers"."status" = 'received'
          and "inventory_transfers"."approved_at" is not null and "inventory_transfers"."approved_by" is not null
          and "inventory_transfers"."shipped_at" is not null and "inventory_transfers"."shipped_by" is not null
          and "inventory_transfers"."first_received_at" is not null and "inventory_transfers"."received_at" is not null and "inventory_transfers"."received_by" is not null
          and "inventory_transfers"."rejected_at" is null and "inventory_transfers"."rejected_by" is null
          and "inventory_transfers"."cancelled_at" is null and "inventory_transfers"."cancelled_by" is null
          and "inventory_transfers"."remainder_rejected_at" is null and "inventory_transfers"."remainder_rejected_by" is null)
        or ("inventory_transfers"."status" = 'rejected'
          and "inventory_transfers"."approved_at" is null and "inventory_transfers"."approved_by" is null
          and "inventory_transfers"."shipped_at" is null and "inventory_transfers"."shipped_by" is null
          and "inventory_transfers"."first_received_at" is null and "inventory_transfers"."received_at" is null and "inventory_transfers"."received_by" is null
          and "inventory_transfers"."rejected_at" is not null and "inventory_transfers"."rejected_by" is not null
          and "inventory_transfers"."cancelled_at" is null and "inventory_transfers"."cancelled_by" is null
          and "inventory_transfers"."remainder_rejected_at" is null and "inventory_transfers"."remainder_rejected_by" is null)
        or ("inventory_transfers"."status" = 'cancelled'
          and "inventory_transfers"."shipped_at" is null and "inventory_transfers"."shipped_by" is null
          and "inventory_transfers"."first_received_at" is null and "inventory_transfers"."received_at" is null and "inventory_transfers"."received_by" is null
          and "inventory_transfers"."rejected_at" is null and "inventory_transfers"."rejected_by" is null
          and "inventory_transfers"."cancelled_at" is not null and "inventory_transfers"."cancelled_by" is not null
          and "inventory_transfers"."remainder_rejected_at" is null and "inventory_transfers"."remainder_rejected_by" is null)
        or ("inventory_transfers"."status" = 'remainder_rejected'
          and "inventory_transfers"."approved_at" is not null and "inventory_transfers"."approved_by" is not null
          and "inventory_transfers"."shipped_at" is not null and "inventory_transfers"."shipped_by" is not null
          and "inventory_transfers"."first_received_at" is not null and "inventory_transfers"."received_at" is null
          and "inventory_transfers"."rejected_at" is null and "inventory_transfers"."rejected_by" is null
          and "inventory_transfers"."cancelled_at" is null and "inventory_transfers"."cancelled_by" is null
          and "inventory_transfers"."remainder_rejected_at" is not null and "inventory_transfers"."remainder_rejected_by" is not null))
);
--> statement-breakpoint
ALTER TABLE "inventory_reservation_lines" ADD CONSTRAINT "inventory_reservation_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservation_lines" ADD CONSTRAINT "inventory_reservation_lines_unit_of_measure_code_units_of_measure_code_fk" FOREIGN KEY ("unit_of_measure_code") REFERENCES "public"."units_of_measure"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservation_lines" ADD CONSTRAINT "inventory_reservation_lines_reservation_scope_fk" FOREIGN KEY ("company_id","branch_id","inventory_reservation_id") REFERENCES "public"."inventory_reservations"("company_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservation_lines" ADD CONSTRAINT "inventory_reservation_lines_variant_scope_fk" FOREIGN KEY ("company_id","product_variant_id") REFERENCES "public"."product_variants"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservation_lines" ADD CONSTRAINT "inventory_reservation_lines_location_scope_fk" FOREIGN KEY ("company_id","branch_id","inventory_location_id") REFERENCES "public"."inventory_locations"("company_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_confirmed_by_membership_fk" FOREIGN KEY ("company_id","confirmed_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_released_by_membership_fk" FOREIGN KEY ("company_id","released_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_expired_by_membership_fk" FOREIGN KEY ("company_id","expired_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_cancelled_by_membership_fk" FOREIGN KEY ("company_id","cancelled_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfer_lines" ADD CONSTRAINT "inventory_transfer_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfer_lines" ADD CONSTRAINT "inventory_transfer_lines_unit_of_measure_code_units_of_measure_code_fk" FOREIGN KEY ("unit_of_measure_code") REFERENCES "public"."units_of_measure"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfer_lines" ADD CONSTRAINT "inventory_transfer_lines_transfer_scope_fk" FOREIGN KEY ("company_id","inventory_transfer_id") REFERENCES "public"."inventory_transfers"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfer_lines" ADD CONSTRAINT "inventory_transfer_lines_variant_scope_fk" FOREIGN KEY ("company_id","product_variant_id") REFERENCES "public"."product_variants"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_source_branch_scope_fk" FOREIGN KEY ("company_id","source_branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_destination_branch_scope_fk" FOREIGN KEY ("company_id","destination_branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_source_location_scope_fk" FOREIGN KEY ("company_id","source_branch_id","source_location_id") REFERENCES "public"."inventory_locations"("company_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_destination_location_scope_fk" FOREIGN KEY ("company_id","destination_branch_id","destination_location_id") REFERENCES "public"."inventory_locations"("company_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_transit_location_scope_fk" FOREIGN KEY ("company_id","destination_branch_id","transit_location_id") REFERENCES "public"."inventory_locations"("company_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_shipment_movement_scope_fk" FOREIGN KEY ("company_id","shipment_movement_id") REFERENCES "public"."inventory_movements"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_receipt_movement_scope_fk" FOREIGN KEY ("company_id","receipt_movement_id") REFERENCES "public"."inventory_movements"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_requested_by_membership_fk" FOREIGN KEY ("company_id","requested_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_approved_by_membership_fk" FOREIGN KEY ("company_id","approved_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_shipped_by_membership_fk" FOREIGN KEY ("company_id","shipped_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_received_by_membership_fk" FOREIGN KEY ("company_id","received_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_rejected_by_membership_fk" FOREIGN KEY ("company_id","rejected_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_cancelled_by_membership_fk" FOREIGN KEY ("company_id","cancelled_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_remainder_rejected_by_membership_fk" FOREIGN KEY ("company_id","remainder_rejected_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_reservation_lines_reservation_idx" ON "inventory_reservation_lines" USING btree ("company_id","inventory_reservation_id");--> statement-breakpoint
CREATE INDEX "inventory_reservation_lines_variant_idx" ON "inventory_reservation_lines" USING btree ("company_id","product_variant_id");--> statement-breakpoint
CREATE INDEX "inventory_reservation_lines_location_idx" ON "inventory_reservation_lines" USING btree ("company_id","inventory_location_id");--> statement-breakpoint
CREATE INDEX "inventory_reservation_lines_active_quantity_idx" ON "inventory_reservation_lines" USING btree ("company_id","inventory_location_id","product_variant_id") WHERE "inventory_reservation_lines"."reserved_quantity" > "inventory_reservation_lines"."consumed_quantity" + "inventory_reservation_lines"."released_quantity";--> statement-breakpoint
CREATE INDEX "inventory_reservation_lines_updated_idx" ON "inventory_reservation_lines" USING btree ("company_id","updated_at");--> statement-breakpoint
CREATE INDEX "inventory_reservations_company_idx" ON "inventory_reservations" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "inventory_reservations_branch_idx" ON "inventory_reservations" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE INDEX "inventory_reservations_status_idx" ON "inventory_reservations" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "inventory_reservations_owner_idx" ON "inventory_reservations" USING btree ("company_id","owner_type","owner_id");--> statement-breakpoint
CREATE INDEX "inventory_reservations_expires_idx" ON "inventory_reservations" USING btree ("company_id","expires_at");--> statement-breakpoint
CREATE INDEX "inventory_reservations_created_idx" ON "inventory_reservations" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "inventory_reservations_active_idx" ON "inventory_reservations" USING btree ("company_id","branch_id","expires_at") WHERE "inventory_reservations"."status" = 'active';--> statement-breakpoint
CREATE INDEX "inventory_reservations_expiration_worker_idx" ON "inventory_reservations" USING btree ("expires_at","id") WHERE "inventory_reservations"."status" = 'active' and "inventory_reservations"."expires_at" is not null;--> statement-breakpoint
CREATE INDEX "inventory_transfer_lines_transfer_idx" ON "inventory_transfer_lines" USING btree ("company_id","inventory_transfer_id");--> statement-breakpoint
CREATE INDEX "inventory_transfer_lines_variant_idx" ON "inventory_transfer_lines" USING btree ("company_id","product_variant_id");--> statement-breakpoint
CREATE INDEX "inventory_transfer_lines_discrepancy_idx" ON "inventory_transfer_lines" USING btree ("company_id","inventory_transfer_id","updated_at") WHERE "inventory_transfer_lines"."received_quantity" + "inventory_transfer_lines"."rejected_quantity" < "inventory_transfer_lines"."shipped_quantity";--> statement-breakpoint
CREATE INDEX "inventory_transfer_lines_updated_idx" ON "inventory_transfer_lines" USING btree ("company_id","updated_at");--> statement-breakpoint
CREATE INDEX "inventory_transfers_company_idx" ON "inventory_transfers" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "inventory_transfers_company_status_idx" ON "inventory_transfers" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "inventory_transfers_source_branch_idx" ON "inventory_transfers" USING btree ("company_id","source_branch_id");--> statement-breakpoint
CREATE INDEX "inventory_transfers_destination_branch_idx" ON "inventory_transfers" USING btree ("company_id","destination_branch_id");--> statement-breakpoint
CREATE INDEX "inventory_transfers_source_location_idx" ON "inventory_transfers" USING btree ("company_id","source_location_id");--> statement-breakpoint
CREATE INDEX "inventory_transfers_destination_location_idx" ON "inventory_transfers" USING btree ("company_id","destination_location_id");--> statement-breakpoint
CREATE INDEX "inventory_transfers_requested_idx" ON "inventory_transfers" USING btree ("company_id","requested_at");--> statement-breakpoint
CREATE INDEX "inventory_transfers_shipped_idx" ON "inventory_transfers" USING btree ("company_id","shipped_at");--> statement-breakpoint
CREATE INDEX "inventory_transfers_received_idx" ON "inventory_transfers" USING btree ("company_id","received_at");--> statement-breakpoint
CREATE INDEX "inventory_transfers_shipment_movement_idx" ON "inventory_transfers" USING btree ("company_id","shipment_movement_id");--> statement-breakpoint
CREATE INDEX "inventory_transfers_receipt_movement_idx" ON "inventory_transfers" USING btree ("company_id","receipt_movement_id");--> statement-breakpoint
CREATE INDEX "inventory_transfers_open_idx" ON "inventory_transfers" USING btree ("company_id","status","requested_at") WHERE "inventory_transfers"."status" in ('requested','approved','shipped','partially_received');--> statement-breakpoint
CREATE INDEX "inventory_transfers_pending_receipt_idx" ON "inventory_transfers" USING btree ("company_id","destination_branch_id","shipped_at") WHERE "inventory_transfers"."status" in ('shipped','partially_received');