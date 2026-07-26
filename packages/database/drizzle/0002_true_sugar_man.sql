CREATE TABLE "user_branch_access" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "user_branch_access_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "user_branch_access_company_membership_branch_uq" UNIQUE("company_id","membership_id","branch_id"),
	CONSTRAINT "user_branch_access_status_ck" CHECK ("user_branch_access"."status" in ('active', 'revoked')),
	CONSTRAINT "user_branch_access_revocation_ck" CHECK ("user_branch_access"."status" <> 'revoked' or "user_branch_access"."revoked_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "device_code" text;--> statement-breakpoint
UPDATE "devices" SET "device_code" = "id"::text WHERE "device_code" IS NULL;--> statement-breakpoint
ALTER TABLE "devices" ALTER COLUMN "device_code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD COLUMN "effect" text DEFAULT 'allow' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_roles" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_roles" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_branch_access" ADD CONSTRAINT "user_branch_access_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_branch_access" ADD CONSTRAINT "user_branch_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_branch_access" ADD CONSTRAINT "user_branch_access_membership_scope_fk" FOREIGN KEY ("company_id","membership_id","user_id") REFERENCES "public"."company_memberships"("company_id","id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_branch_access" ADD CONSTRAINT "user_branch_access_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_branch_access_default_uq" ON "user_branch_access" USING btree ("company_id","membership_id") WHERE "user_branch_access"."is_default" is true and "user_branch_access"."status" = 'active';--> statement-breakpoint
CREATE INDEX "user_branch_access_membership_idx" ON "user_branch_access" USING btree ("company_id","membership_id");--> statement-breakpoint
CREATE INDEX "user_branch_access_branch_idx" ON "user_branch_access" USING btree ("company_id","branch_id");--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_company_code_uq" UNIQUE("company_id","device_code");--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_code_nonblank_ck" CHECK (length(btrim("devices"."device_code")) > 0);--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_effect_ck" CHECK ("role_permissions"."effect" in ('allow', 'deny'));
--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_status_ck" CHECK ("user_roles"."status" in ('active', 'revoked'));
--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_revocation_ck" CHECK ("user_roles"."status" <> 'revoked' or "user_roles"."revoked_at" is not null);
