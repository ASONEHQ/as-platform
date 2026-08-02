CREATE TABLE "auth_login_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"eligible_company_ids" uuid[] NOT NULL,
	"selected_company_id" uuid,
	"device_id" uuid,
	"client_type" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"request_id" uuid,
	"correlation_id" uuid,
	"metadata" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_login_challenges_token_hash_uq" UNIQUE("token_hash"),
	CONSTRAINT "auth_login_challenges_token_hash_ck" CHECK ("auth_login_challenges"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "auth_login_challenges_status_ck" CHECK ("auth_login_challenges"."status" in ('pending', 'consumed', 'expired', 'invalidated')),
	CONSTRAINT "auth_login_challenges_client_type_ck" CHECK ("auth_login_challenges"."client_type" in ('browser', 'mobile', 'pos')),
	CONSTRAINT "auth_login_challenges_eligible_companies_ck" CHECK (cardinality("auth_login_challenges"."eligible_company_ids") > 0),
	CONSTRAINT "auth_login_challenges_selected_company_ck" CHECK ("auth_login_challenges"."selected_company_id" is null or "auth_login_challenges"."selected_company_id" = any("auth_login_challenges"."eligible_company_ids")),
	CONSTRAINT "auth_login_challenges_attempts_ck" CHECK ("auth_login_challenges"."attempt_count" >= 0 and "auth_login_challenges"."max_attempts" > 0 and "auth_login_challenges"."attempt_count" <= "auth_login_challenges"."max_attempts"),
	CONSTRAINT "auth_login_challenges_version_ck" CHECK ("auth_login_challenges"."version" >= 1),
	CONSTRAINT "auth_login_challenges_expiry_ck" CHECK ("auth_login_challenges"."expires_at" > "auth_login_challenges"."created_at"),
	CONSTRAINT "auth_login_challenges_timestamps_ck" CHECK ("auth_login_challenges"."updated_at" >= "auth_login_challenges"."created_at"
        and ("auth_login_challenges"."consumed_at" is null or "auth_login_challenges"."consumed_at" >= "auth_login_challenges"."created_at")
        and ("auth_login_challenges"."invalidated_at" is null or "auth_login_challenges"."invalidated_at" >= "auth_login_challenges"."created_at")),
	CONSTRAINT "auth_login_challenges_lifecycle_ck" CHECK (("auth_login_challenges"."status" = 'pending' and "auth_login_challenges"."consumed_at" is null and "auth_login_challenges"."invalidated_at" is null and "auth_login_challenges"."selected_company_id" is null)
        or ("auth_login_challenges"."status" = 'consumed' and "auth_login_challenges"."consumed_at" is not null and "auth_login_challenges"."invalidated_at" is null and "auth_login_challenges"."selected_company_id" is not null)
        or ("auth_login_challenges"."status" = 'expired' and "auth_login_challenges"."consumed_at" is null and "auth_login_challenges"."invalidated_at" is null and "auth_login_challenges"."selected_company_id" is null)
        or ("auth_login_challenges"."status" = 'invalidated' and "auth_login_challenges"."consumed_at" is null and "auth_login_challenges"."invalidated_at" is not null and "auth_login_challenges"."selected_company_id" is null)),
	CONSTRAINT "auth_login_challenges_metadata_ck" CHECK ("auth_login_challenges"."metadata" is null or (jsonb_typeof("auth_login_challenges"."metadata") = 'object' and pg_column_size("auth_login_challenges"."metadata") <= 4096))
);
--> statement-breakpoint
ALTER TABLE "auth_login_challenges" ADD CONSTRAINT "auth_login_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_login_challenges" ADD CONSTRAINT "auth_login_challenges_selected_company_id_companies_id_fk" FOREIGN KEY ("selected_company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_login_challenges" ADD CONSTRAINT "auth_login_challenges_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_login_challenges_user_status_idx" ON "auth_login_challenges" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "auth_login_challenges_status_updated_idx" ON "auth_login_challenges" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "auth_login_challenges_pending_expiry_idx" ON "auth_login_challenges" USING btree ("expires_at") WHERE "auth_login_challenges"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "auth_login_challenges_created_at_idx" ON "auth_login_challenges" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "auth_login_challenges_device_status_idx" ON "auth_login_challenges" USING btree ("device_id","status") WHERE "auth_login_challenges"."device_id" is not null;