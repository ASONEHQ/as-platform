CREATE TABLE "inventory_count_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"inventory_count_id" uuid NOT NULL,
	"product_variant_id" uuid NOT NULL,
	"unit_of_measure_code" text NOT NULL,
	"expected_quantity" numeric(19, 6) NOT NULL,
	"counted_quantity" numeric(19, 6),
	"baseline_balance_version" bigint NOT NULL,
	"baseline_last_movement_id" uuid,
	"first_counted_at" timestamp with time zone,
	"last_counted_at" timestamp with time zone,
	"counted_by" uuid,
	"version" bigint DEFAULT 1 NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_count_lines_company_count_variant_uq" UNIQUE("company_id","inventory_count_id","product_variant_id"),
	CONSTRAINT "inventory_count_lines_expected_ck" CHECK ("inventory_count_lines"."expected_quantity" >= 0),
	CONSTRAINT "inventory_count_lines_counted_ck" CHECK ("inventory_count_lines"."counted_quantity" is null or "inventory_count_lines"."counted_quantity" >= 0),
	CONSTRAINT "inventory_count_lines_baseline_version_ck" CHECK ("inventory_count_lines"."baseline_balance_version" >= 1),
	CONSTRAINT "inventory_count_lines_version_ck" CHECK ("inventory_count_lines"."version" >= 1),
	CONSTRAINT "inventory_count_lines_metadata_ck" CHECK ("inventory_count_lines"."metadata" is null or jsonb_typeof("inventory_count_lines"."metadata") = 'object'),
	CONSTRAINT "inventory_count_lines_counting_evidence_ck" CHECK (("inventory_count_lines"."counted_quantity" is null
          and "inventory_count_lines"."first_counted_at" is null and "inventory_count_lines"."last_counted_at" is null and "inventory_count_lines"."counted_by" is null)
        or ("inventory_count_lines"."counted_quantity" is not null
          and "inventory_count_lines"."first_counted_at" is not null and "inventory_count_lines"."last_counted_at" is not null and "inventory_count_lines"."counted_by" is not null
          and "inventory_count_lines"."last_counted_at" >= "inventory_count_lines"."first_counted_at"))
);
--> statement-breakpoint
CREATE TABLE "inventory_counts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"inventory_location_id" uuid NOT NULL,
	"count_number" varchar(36) NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"scope_type" text NOT NULL,
	"scope_definition" jsonb NOT NULL,
	"baseline_at" timestamp with time zone,
	"lock_acquired_at" timestamp with time zone,
	"lock_expires_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"started_by" uuid,
	"submitted_at" timestamp with time zone,
	"submitted_by" uuid,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"applied_at" timestamp with time zone,
	"applied_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"application_movement_id" uuid,
	"reason_code" varchar(64) NOT NULL,
	"note" varchar(2000),
	"metadata" jsonb,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_counts_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "inventory_counts_company_branch_id_id_uq" UNIQUE("company_id","branch_id","id"),
	CONSTRAINT "inventory_counts_company_number_uq" UNIQUE("company_id","count_number"),
	CONSTRAINT "inventory_counts_number_ck" CHECK ("inventory_counts"."count_number" ~ '^CNT-[0-9a-f]{32}$'),
	CONSTRAINT "inventory_counts_status_ck" CHECK ("inventory_counts"."status" in ('draft','counting','submitted','approved','applied','cancelled')),
	CONSTRAINT "inventory_counts_scope_type_ck" CHECK ("inventory_counts"."scope_type" in ('all_balanced_variants','explicit_variants')),
	CONSTRAINT "inventory_counts_scope_definition_ck" CHECK (jsonb_typeof("inventory_counts"."scope_definition") = 'object'),
	CONSTRAINT "inventory_counts_reason_code_ck" CHECK (length(btrim("inventory_counts"."reason_code")) > 0),
	CONSTRAINT "inventory_counts_metadata_ck" CHECK ("inventory_counts"."metadata" is null or jsonb_typeof("inventory_counts"."metadata") = 'object'),
	CONSTRAINT "inventory_counts_version_ck" CHECK ("inventory_counts"."version" >= 1),
	CONSTRAINT "inventory_counts_actor_timestamp_pairs_ck" CHECK (("inventory_counts"."started_at" is null) = ("inventory_counts"."started_by" is null)
        and ("inventory_counts"."submitted_at" is null) = ("inventory_counts"."submitted_by" is null)
        and ("inventory_counts"."approved_at" is null) = ("inventory_counts"."approved_by" is null)
        and ("inventory_counts"."applied_at" is null) = ("inventory_counts"."applied_by" is null)
        and ("inventory_counts"."cancelled_at" is null) = ("inventory_counts"."cancelled_by" is null)),
	CONSTRAINT "inventory_counts_lock_pair_ck" CHECK (("inventory_counts"."lock_acquired_at" is null) = ("inventory_counts"."lock_expires_at" is null)
        and ("inventory_counts"."lock_expires_at" is null or "inventory_counts"."lock_expires_at" > "inventory_counts"."lock_acquired_at")),
	CONSTRAINT "inventory_counts_lifecycle_ck" CHECK (("inventory_counts"."status" = 'draft'
          and "inventory_counts"."baseline_at" is null and "inventory_counts"."lock_acquired_at" is null
          and "inventory_counts"."started_at" is null and "inventory_counts"."submitted_at" is null
          and "inventory_counts"."approved_at" is null and "inventory_counts"."applied_at" is null
          and "inventory_counts"."cancelled_at" is null and "inventory_counts"."application_movement_id" is null)
        or ("inventory_counts"."status" = 'counting'
          and "inventory_counts"."baseline_at" is not null and "inventory_counts"."lock_acquired_at" is not null
          and "inventory_counts"."started_at" is not null and "inventory_counts"."submitted_at" is null
          and "inventory_counts"."approved_at" is null and "inventory_counts"."applied_at" is null
          and "inventory_counts"."cancelled_at" is null and "inventory_counts"."application_movement_id" is null)
        or ("inventory_counts"."status" = 'submitted'
          and "inventory_counts"."baseline_at" is not null and "inventory_counts"."lock_acquired_at" is not null
          and "inventory_counts"."started_at" is not null and "inventory_counts"."submitted_at" is not null
          and "inventory_counts"."approved_at" is null and "inventory_counts"."applied_at" is null
          and "inventory_counts"."cancelled_at" is null and "inventory_counts"."application_movement_id" is null)
        or ("inventory_counts"."status" = 'approved'
          and "inventory_counts"."baseline_at" is not null and "inventory_counts"."lock_acquired_at" is not null
          and "inventory_counts"."started_at" is not null and "inventory_counts"."submitted_at" is not null
          and "inventory_counts"."approved_at" is not null and "inventory_counts"."applied_at" is null
          and "inventory_counts"."cancelled_at" is null and "inventory_counts"."application_movement_id" is null)
        or ("inventory_counts"."status" = 'applied'
          and "inventory_counts"."baseline_at" is not null and "inventory_counts"."lock_acquired_at" is not null
          and "inventory_counts"."started_at" is not null and "inventory_counts"."submitted_at" is not null
          and "inventory_counts"."approved_at" is not null and "inventory_counts"."applied_at" is not null
          and "inventory_counts"."cancelled_at" is null)
        or ("inventory_counts"."status" = 'cancelled'
          and "inventory_counts"."approved_at" is null and "inventory_counts"."applied_at" is null
          and "inventory_counts"."cancelled_at" is not null and "inventory_counts"."application_movement_id" is null)),
	CONSTRAINT "inventory_counts_application_movement_ck" CHECK ("inventory_counts"."application_movement_id" is null or "inventory_counts"."status" = 'applied')
);
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_company_branch_id_id_uq" UNIQUE("company_id","branch_id","id");--> statement-breakpoint
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_unit_of_measure_code_units_of_measure_code_fk" FOREIGN KEY ("unit_of_measure_code") REFERENCES "public"."units_of_measure"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_count_scope_fk" FOREIGN KEY ("company_id","branch_id","inventory_count_id") REFERENCES "public"."inventory_counts"("company_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_variant_scope_fk" FOREIGN KEY ("company_id","product_variant_id") REFERENCES "public"."product_variants"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_baseline_movement_scope_fk" FOREIGN KEY ("company_id","branch_id","baseline_last_movement_id") REFERENCES "public"."inventory_movements"("company_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_counted_by_membership_fk" FOREIGN KEY ("company_id","counted_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_location_scope_fk" FOREIGN KEY ("company_id","branch_id","inventory_location_id") REFERENCES "public"."inventory_locations"("company_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_application_movement_scope_fk" FOREIGN KEY ("company_id","branch_id","application_movement_id") REFERENCES "public"."inventory_movements"("company_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_started_by_membership_fk" FOREIGN KEY ("company_id","started_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_submitted_by_membership_fk" FOREIGN KEY ("company_id","submitted_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_approved_by_membership_fk" FOREIGN KEY ("company_id","approved_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_applied_by_membership_fk" FOREIGN KEY ("company_id","applied_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_cancelled_by_membership_fk" FOREIGN KEY ("company_id","cancelled_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_count_lines_count_idx" ON "inventory_count_lines" USING btree ("company_id","inventory_count_id");--> statement-breakpoint
CREATE INDEX "inventory_count_lines_variant_idx" ON "inventory_count_lines" USING btree ("company_id","product_variant_id");--> statement-breakpoint
CREATE INDEX "inventory_count_lines_incomplete_idx" ON "inventory_count_lines" USING btree ("company_id","inventory_count_id") WHERE "inventory_count_lines"."counted_quantity" is null;--> statement-breakpoint
CREATE INDEX "inventory_count_lines_baseline_movement_idx" ON "inventory_count_lines" USING btree ("company_id","baseline_last_movement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_counts_active_location_uq" ON "inventory_counts" USING btree ("company_id","inventory_location_id") WHERE "inventory_counts"."status" in ('counting','submitted','approved');--> statement-breakpoint
CREATE INDEX "inventory_counts_company_status_idx" ON "inventory_counts" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "inventory_counts_branch_status_idx" ON "inventory_counts" USING btree ("company_id","branch_id","status");--> statement-breakpoint
CREATE INDEX "inventory_counts_location_status_idx" ON "inventory_counts" USING btree ("company_id","inventory_location_id","status");--> statement-breakpoint
CREATE INDEX "inventory_counts_lock_expiry_idx" ON "inventory_counts" USING btree ("lock_expires_at","id") WHERE "inventory_counts"."status" in ('counting','submitted','approved');--> statement-breakpoint
CREATE INDEX "inventory_counts_created_idx" ON "inventory_counts" USING btree ("company_id","created_at","id");
