CREATE TABLE "branch_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"value_type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"is_secret" boolean DEFAULT false NOT NULL,
	"version" bigint DEFAULT 2 NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "branch_settings_company_branch_key_uq" UNIQUE("company_id","branch_id","key"),
	CONSTRAINT "branch_settings_key_nonblank_ck" CHECK (length(btrim("branch_settings"."key")) > 0),
	CONSTRAINT "branch_settings_value_type_ck" CHECK ("branch_settings"."value_type" in ('string', 'boolean', 'integer')),
	CONSTRAINT "branch_settings_status_ck" CHECK ("branch_settings"."status" in ('active', 'retired')),
	CONSTRAINT "branch_settings_version_ck" CHECK ("branch_settings"."version" >= 2),
	CONSTRAINT "branch_settings_not_secret_ck" CHECK ("branch_settings"."is_secret" is false),
	CONSTRAINT "branch_settings_retirement_ck" CHECK (("branch_settings"."status" = 'active' and "branch_settings"."deleted_at" is null) or ("branch_settings"."status" = 'retired' and "branch_settings"."deleted_at" is not null)),
	CONSTRAINT "branch_settings_value_structure_ck" CHECK (("branch_settings"."value_type" = 'string' and jsonb_typeof("branch_settings"."value") = 'string')
      or ("branch_settings"."value_type" = 'boolean' and jsonb_typeof("branch_settings"."value") = 'boolean')
      or ("branch_settings"."value_type" = 'integer' and jsonb_typeof("branch_settings"."value") = 'number'
        and ("branch_settings"."value" #>> '{}')::numeric = trunc(("branch_settings"."value" #>> '{}')::numeric)))
);
--> statement-breakpoint
CREATE TABLE "company_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"value_type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"is_secret" boolean DEFAULT false NOT NULL,
	"version" bigint DEFAULT 2 NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "company_settings_company_key_uq" UNIQUE("company_id","key"),
	CONSTRAINT "company_settings_key_nonblank_ck" CHECK (length(btrim("company_settings"."key")) > 0),
	CONSTRAINT "company_settings_value_type_ck" CHECK ("company_settings"."value_type" in ('string', 'boolean', 'integer')),
	CONSTRAINT "company_settings_status_ck" CHECK ("company_settings"."status" in ('active', 'retired')),
	CONSTRAINT "company_settings_version_ck" CHECK ("company_settings"."version" >= 2),
	CONSTRAINT "company_settings_not_secret_ck" CHECK ("company_settings"."is_secret" is false),
	CONSTRAINT "company_settings_retirement_ck" CHECK (("company_settings"."status" = 'active' and "company_settings"."deleted_at" is null) or ("company_settings"."status" = 'retired' and "company_settings"."deleted_at" is not null)),
	CONSTRAINT "company_settings_value_structure_ck" CHECK (("company_settings"."value_type" = 'string' and jsonb_typeof("company_settings"."value") = 'string')
      or ("company_settings"."value_type" = 'boolean' and jsonb_typeof("company_settings"."value") = 'boolean')
      or ("company_settings"."value_type" = 'integer' and jsonb_typeof("company_settings"."value") = 'number'
        and ("company_settings"."value" #>> '{}')::numeric = trunc(("company_settings"."value" #>> '{}')::numeric)))
);
--> statement-breakpoint
ALTER TABLE "branch_settings" ADD CONSTRAINT "branch_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_settings" ADD CONSTRAINT "branch_settings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_settings" ADD CONSTRAINT "branch_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_settings" ADD CONSTRAINT "branch_settings_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;