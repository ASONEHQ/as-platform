CREATE TABLE "inventory_reconciliation_findings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"inventory_location_id" uuid,
	"product_variant_id" uuid,
	"aggregate_type" varchar(64) NOT NULL,
	"aggregate_id" varchar(128) NOT NULL,
	"finding_type" varchar(64) NOT NULL,
	"severity" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"identity_key" varchar(512) NOT NULL,
	"fingerprint_sha256" char(64) NOT NULL,
	"detector_version" varchar(64) NOT NULL,
	"correlation_id" uuid,
	"snapshot_at" timestamp with time zone NOT NULL,
	"first_detected_at" timestamp with time zone NOT NULL,
	"last_detected_at" timestamp with time zone NOT NULL,
	"occurrence_count" bigint DEFAULT 1 NOT NULL,
	"expected_summary" jsonb NOT NULL,
	"actual_summary" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"metadata" jsonb,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"dismissed_at" timestamp with time zone,
	"dismissed_by" uuid,
	"resolution_reason_code" varchar(64),
	"resolution_note" varchar(1000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "inventory_reconciliation_findings_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "inventory_reconciliation_findings_aggregate_type_ck" CHECK (length(btrim("inventory_reconciliation_findings"."aggregate_type")) > 0 and "inventory_reconciliation_findings"."aggregate_type" = lower(btrim("inventory_reconciliation_findings"."aggregate_type"))),
	CONSTRAINT "inventory_reconciliation_findings_aggregate_id_ck" CHECK (length(btrim("inventory_reconciliation_findings"."aggregate_id")) > 0),
	CONSTRAINT "inventory_reconciliation_findings_type_ck" CHECK ("inventory_reconciliation_findings"."finding_type" in ('balance_on_hand_drift','balance_reserved_drift','balance_in_transit_drift','last_movement_mismatch','missing_balance','orphan_balance','invalid_posted_movement','invalid_reversal_relationship','transfer_movement_mismatch','reservation_movement_mismatch','count_application_mismatch','missing_outbox_event','missing_audit_record','unsupported_or_unknown')),
	CONSTRAINT "inventory_reconciliation_findings_severity_ck" CHECK ("inventory_reconciliation_findings"."severity" in ('info','warning','critical')),
	CONSTRAINT "inventory_reconciliation_findings_status_ck" CHECK ("inventory_reconciliation_findings"."status" in ('open','acknowledged','resolved','dismissed')),
	CONSTRAINT "inventory_reconciliation_findings_identity_key_ck" CHECK (length(btrim("inventory_reconciliation_findings"."identity_key")) > 0 and "inventory_reconciliation_findings"."identity_key" = lower(btrim("inventory_reconciliation_findings"."identity_key"))),
	CONSTRAINT "inventory_reconciliation_findings_fingerprint_ck" CHECK ("inventory_reconciliation_findings"."fingerprint_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "inventory_reconciliation_findings_detector_version_ck" CHECK (length(btrim("inventory_reconciliation_findings"."detector_version")) > 0),
	CONSTRAINT "inventory_reconciliation_findings_detection_time_ck" CHECK ("inventory_reconciliation_findings"."first_detected_at" <= "inventory_reconciliation_findings"."last_detected_at" and "inventory_reconciliation_findings"."snapshot_at" <= "inventory_reconciliation_findings"."last_detected_at"),
	CONSTRAINT "inventory_reconciliation_findings_occurrence_count_ck" CHECK ("inventory_reconciliation_findings"."occurrence_count" >= 1),
	CONSTRAINT "inventory_reconciliation_findings_version_ck" CHECK ("inventory_reconciliation_findings"."version" >= 1),
	CONSTRAINT "inventory_reconciliation_findings_updated_at_ck" CHECK ("inventory_reconciliation_findings"."updated_at" >= "inventory_reconciliation_findings"."created_at"),
	CONSTRAINT "inventory_reconciliation_findings_expected_summary_ck" CHECK (jsonb_typeof("inventory_reconciliation_findings"."expected_summary") = 'object' and octet_length("inventory_reconciliation_findings"."expected_summary"::text) <= 8192),
	CONSTRAINT "inventory_reconciliation_findings_actual_summary_ck" CHECK (jsonb_typeof("inventory_reconciliation_findings"."actual_summary") = 'object' and octet_length("inventory_reconciliation_findings"."actual_summary"::text) <= 8192),
	CONSTRAINT "inventory_reconciliation_findings_evidence_ck" CHECK (jsonb_typeof("inventory_reconciliation_findings"."evidence") = 'object' and octet_length("inventory_reconciliation_findings"."evidence"::text) <= 8192),
	CONSTRAINT "inventory_reconciliation_findings_metadata_ck" CHECK ("inventory_reconciliation_findings"."metadata" is null or (jsonb_typeof("inventory_reconciliation_findings"."metadata") = 'object' and octet_length("inventory_reconciliation_findings"."metadata"::text) <= 8192)),
	CONSTRAINT "inventory_reconciliation_findings_lifecycle_ck" CHECK ((
        "inventory_reconciliation_findings"."status" = 'open'
        and "inventory_reconciliation_findings"."acknowledged_at" is null and "inventory_reconciliation_findings"."acknowledged_by" is null
        and "inventory_reconciliation_findings"."resolved_at" is null and "inventory_reconciliation_findings"."resolved_by" is null
        and "inventory_reconciliation_findings"."dismissed_at" is null and "inventory_reconciliation_findings"."dismissed_by" is null
        and "inventory_reconciliation_findings"."resolution_reason_code" is null and "inventory_reconciliation_findings"."resolution_note" is null
      ) or (
        "inventory_reconciliation_findings"."status" = 'acknowledged'
        and "inventory_reconciliation_findings"."acknowledged_at" is not null and "inventory_reconciliation_findings"."acknowledged_by" is not null
        and "inventory_reconciliation_findings"."resolved_at" is null and "inventory_reconciliation_findings"."resolved_by" is null
        and "inventory_reconciliation_findings"."dismissed_at" is null and "inventory_reconciliation_findings"."dismissed_by" is null
        and "inventory_reconciliation_findings"."resolution_reason_code" is null and "inventory_reconciliation_findings"."resolution_note" is null
      ) or (
        "inventory_reconciliation_findings"."status" = 'resolved'
        and "inventory_reconciliation_findings"."resolved_at" is not null and "inventory_reconciliation_findings"."resolved_by" is not null
        and "inventory_reconciliation_findings"."dismissed_at" is null and "inventory_reconciliation_findings"."dismissed_by" is null
      ) or (
        "inventory_reconciliation_findings"."status" = 'dismissed'
        and "inventory_reconciliation_findings"."dismissed_at" is not null and "inventory_reconciliation_findings"."dismissed_by" is not null
        and "inventory_reconciliation_findings"."resolved_at" is null and "inventory_reconciliation_findings"."resolved_by" is null
        and "inventory_reconciliation_findings"."resolution_reason_code" is not null
        and length(btrim("inventory_reconciliation_findings"."resolution_reason_code")) > 0
      ))
);
--> statement-breakpoint
ALTER TABLE "inventory_reconciliation_findings" ADD CONSTRAINT "inventory_reconciliation_findings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reconciliation_findings" ADD CONSTRAINT "inventory_reconciliation_findings_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reconciliation_findings" ADD CONSTRAINT "inventory_reconciliation_findings_location_scope_fk" FOREIGN KEY ("company_id","inventory_location_id") REFERENCES "public"."inventory_locations"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reconciliation_findings" ADD CONSTRAINT "inventory_reconciliation_findings_branch_location_scope_fk" FOREIGN KEY ("company_id","branch_id","inventory_location_id") REFERENCES "public"."inventory_locations"("company_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reconciliation_findings" ADD CONSTRAINT "inventory_reconciliation_findings_variant_scope_fk" FOREIGN KEY ("company_id","product_variant_id") REFERENCES "public"."product_variants"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reconciliation_findings" ADD CONSTRAINT "inventory_reconciliation_findings_acknowledged_by_membership_fk" FOREIGN KEY ("company_id","acknowledged_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reconciliation_findings" ADD CONSTRAINT "inventory_reconciliation_findings_resolved_by_membership_fk" FOREIGN KEY ("company_id","resolved_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reconciliation_findings" ADD CONSTRAINT "inventory_reconciliation_findings_dismissed_by_membership_fk" FOREIGN KEY ("company_id","dismissed_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_reconciliation_findings_active_identity_uq" ON "inventory_reconciliation_findings" USING btree ("company_id","identity_key") WHERE "inventory_reconciliation_findings"."status" in ('open','acknowledged');--> statement-breakpoint
CREATE INDEX "inventory_reconciliation_findings_company_status_severity_idx" ON "inventory_reconciliation_findings" USING btree ("company_id","status","severity");--> statement-breakpoint
CREATE INDEX "inventory_reconciliation_findings_company_type_status_idx" ON "inventory_reconciliation_findings" USING btree ("company_id","finding_type","status");--> statement-breakpoint
CREATE INDEX "inventory_reconciliation_findings_company_branch_status_idx" ON "inventory_reconciliation_findings" USING btree ("company_id","branch_id","status");--> statement-breakpoint
CREATE INDEX "inventory_reconciliation_findings_company_location_status_idx" ON "inventory_reconciliation_findings" USING btree ("company_id","inventory_location_id","status");--> statement-breakpoint
CREATE INDEX "inventory_reconciliation_findings_company_variant_status_idx" ON "inventory_reconciliation_findings" USING btree ("company_id","product_variant_id","status");--> statement-breakpoint
CREATE INDEX "inventory_reconciliation_findings_company_aggregate_idx" ON "inventory_reconciliation_findings" USING btree ("company_id","aggregate_type","aggregate_id");--> statement-breakpoint
CREATE INDEX "inventory_reconciliation_findings_last_detected_idx" ON "inventory_reconciliation_findings" USING btree ("last_detected_at");--> statement-breakpoint
CREATE INDEX "inventory_reconciliation_findings_snapshot_idx" ON "inventory_reconciliation_findings" USING btree ("snapshot_at");--> statement-breakpoint
CREATE INDEX "inventory_reconciliation_findings_detector_version_idx" ON "inventory_reconciliation_findings" USING btree ("detector_version");--> statement-breakpoint
CREATE INDEX "inventory_reconciliation_findings_open_critical_idx" ON "inventory_reconciliation_findings" USING btree ("company_id","last_detected_at") WHERE "inventory_reconciliation_findings"."status" in ('open','acknowledged') and "inventory_reconciliation_findings"."severity" = 'critical';