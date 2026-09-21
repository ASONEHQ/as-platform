CREATE TABLE "user_register_access" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"operational_area_id" uuid,
	"cash_register_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "user_register_access_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "user_register_access_status_ck" CHECK ("user_register_access"."status" in ('active', 'revoked')),
	CONSTRAINT "user_register_access_revocation_ck" CHECK ("user_register_access"."status" <> 'revoked' or "user_register_access"."revoked_at" is not null),
	CONSTRAINT "user_register_access_scope_ck" CHECK (("user_register_access"."operational_area_id" is not null and "user_register_access"."cash_register_id" is null)
        or ("user_register_access"."operational_area_id" is null and "user_register_access"."cash_register_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "operational_areas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"code" text NOT NULL,
	"normalized_code" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operational_areas_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "operational_areas_company_branch_id_uq" UNIQUE("company_id","branch_id","id"),
	CONSTRAINT "operational_areas_code_nonblank_ck" CHECK (length(btrim("operational_areas"."code")) > 0),
	CONSTRAINT "operational_areas_normalized_code_ck" CHECK (length("operational_areas"."normalized_code") > 0 and "operational_areas"."normalized_code" = lower(btrim("operational_areas"."normalized_code"))),
	CONSTRAINT "operational_areas_name_nonblank_ck" CHECK (length(btrim("operational_areas"."name")) > 0),
	CONSTRAINT "operational_areas_status_ck" CHECK ("operational_areas"."status" in ('active','inactive')),
	CONSTRAINT "operational_areas_version_ck" CHECK ("operational_areas"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "cash_registers" ADD COLUMN "operational_area_id" uuid;--> statement-breakpoint
ALTER TABLE "user_register_access" ADD CONSTRAINT "user_register_access_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_register_access" ADD CONSTRAINT "user_register_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_register_access" ADD CONSTRAINT "user_register_access_membership_scope_fk" FOREIGN KEY ("company_id","membership_id","user_id") REFERENCES "public"."company_memberships"("company_id","id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_register_access" ADD CONSTRAINT "user_register_access_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_register_access" ADD CONSTRAINT "user_register_access_area_scope_fk" FOREIGN KEY ("company_id","operational_area_id") REFERENCES "public"."operational_areas"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_register_access" ADD CONSTRAINT "user_register_access_register_scope_fk" FOREIGN KEY ("company_id","cash_register_id") REFERENCES "public"."cash_registers"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_areas" ADD CONSTRAINT "operational_areas_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_areas" ADD CONSTRAINT "operational_areas_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_areas" ADD CONSTRAINT "operational_areas_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_areas" ADD CONSTRAINT "operational_areas_updated_by_membership_fk" FOREIGN KEY ("company_id","updated_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_register_access_unique_target_uq" ON "user_register_access" USING btree ("company_id","membership_id","operational_area_id","cash_register_id") WHERE "user_register_access"."status" = 'active';--> statement-breakpoint
CREATE INDEX "user_register_access_membership_idx" ON "user_register_access" USING btree ("company_id","membership_id");--> statement-breakpoint
CREATE INDEX "user_register_access_branch_idx" ON "user_register_access" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "operational_areas_company_branch_code_active_uq" ON "operational_areas" USING btree ("company_id","branch_id","normalized_code") WHERE "operational_areas"."status" = 'active';--> statement-breakpoint
CREATE INDEX "operational_areas_company_branch_idx" ON "operational_areas" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE INDEX "operational_areas_company_status_idx" ON "operational_areas" USING btree ("company_id","status");--> statement-breakpoint
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_operational_area_scope_fk" FOREIGN KEY ("company_id","operational_area_id") REFERENCES "public"."operational_areas"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_registers_company_area_idx" ON "cash_registers" USING btree ("company_id","operational_area_id");